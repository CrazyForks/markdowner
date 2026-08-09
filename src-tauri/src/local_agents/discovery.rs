use std::{
    collections::{BTreeMap, HashSet},
    env,
    ffi::{OsStr, OsString},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use serde_json::Value;

use super::{LocalAgentError, LocalAgentKind, LocalAgentStatus, ResolvedAgent};
use crate::login_shell_path_value;

pub(super) const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const PROBE_STDOUT_LIMIT: usize = 256 * 1024;
const PROBE_STDERR_LIMIT: usize = 64 * 1024;

pub(super) const CAPABILITY_PROBE_TIMEOUT_REASON: &str = "Capability probe timed out.";
const CLAUDE_FLAGS_REASON: &str = "Required Claude Code safety flags are unavailable.";
const CODEX_FLAGS_REASON: &str = "Required Codex safety flags are unavailable.";
const CODEX_FEATURES_REASON: &str = "Codex feature restrictions could not be verified.";
const OPEN_CODE_FLAGS_REASON: &str = "Required OpenCode safety flags are unavailable.";
const OPEN_CODE_PERMISSIONS_REASON: &str = "OpenCode permissions are not fully denied.";

pub(super) const CODEX_DENIED_FEATURES: &[&str] = &[
    "apps",
    "auth_elicitation",
    "browser_use",
    "browser_use_external",
    "browser_use_full_cdp_access",
    "chronicle",
    "code_mode",
    "code_mode_host",
    "computer_use",
    "enable_mcp_apps",
    "goals",
    "guardian_approval",
    "hooks",
    "image_generation",
    "in_app_browser",
    "in_app_updates",
    "memories",
    "multi_agent",
    "multi_agent_v2",
    "plugin_sharing",
    "plugins",
    "recommended_plugins",
    "remote_plugin",
    "shell_snapshot",
    "shell_tool",
    "skill_mcp_dependency_install",
    "skill_search",
    "standalone_web_search",
    "tool_call_mcp_elicitation",
    "tool_suggest",
    "unified_exec",
    "view_image",
    "workspace_dependencies",
];

pub(super) const PASSIVE_CODEX_FEATURES: &[&str] = &[
    "collaboration_modes",
    "enable_request_compression",
    "fast_mode",
    "item_ids",
    "mentions_v2",
    "personality",
    "remote_compaction_v2",
    "resize_all_images",
    "sqlite",
    "steer",
    "terminal_resize_reflow",
    "tool_search_always_defer_mcp_tools",
    "tui_app_server",
];

const CLAUDE_REQUIRED_FLAGS: &[&str] = &[
    "--safe-mode",
    "--print",
    "--tools",
    "--permission-mode",
    "--strict-mcp-config",
    "--mcp-config",
    "--no-session-persistence",
    "--output-format",
    "--json-schema",
];

const CODEX_REQUIRED_FLAGS: &[&str] = &[
    "--strict-config",
    "--sandbox",
    "--ephemeral",
    "--skip-git-repo-check",
    "--output-schema",
    "--output-last-message",
    "--disable",
    "-c",
];

const OPEN_CODE_REQUIRED_PERMISSIONS: &[&str] = &[
    "*",
    "read",
    "edit",
    "glob",
    "grep",
    "list",
    "bash",
    "task",
    "skill",
    "lsp",
    "question",
    "webfetch",
    "websearch",
    "external_directory",
];

const OPEN_CODE_CONFIG_CONTENT: &str = r#"{"share":"disabled","permission":{"*":"deny","read":"deny","edit":"deny","glob":"deny","grep":"deny","list":"deny","bash":"deny","task":"deny","skill":"deny","lsp":"deny","question":"deny","webfetch":"deny","websearch":"deny","external_directory":"deny"}}"#;

#[derive(Clone, PartialEq, Eq)]
pub(super) struct ProbeOutput {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

pub(super) trait ProbeRunner {
    fn run(
        &self,
        executable: &Path,
        args: &[OsString],
        env: &[(OsString, OsString)],
    ) -> Result<ProbeOutput, LocalAgentError>;
}

struct BoundedProbeRunner;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReaderError {
    Io,
    TooLarge,
}

impl ProbeRunner for BoundedProbeRunner {
    fn run(
        &self,
        executable: &Path,
        args: &[OsString],
        environment: &[(OsString, OsString)],
    ) -> Result<ProbeOutput, LocalAgentError> {
        let mut command = Command::new(executable);
        command
            .args(args)
            .envs(environment.iter().cloned())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_probe_process_group(&mut command);

        let mut child = command
            .spawn()
            .map_err(|_| LocalAgentError::ProbeSpawnFailed)?;
        let stdout = child
            .stdout
            .take()
            .ok_or(LocalAgentError::ProbeSpawnFailed)?;
        let stderr = child
            .stderr
            .take()
            .ok_or(LocalAgentError::ProbeSpawnFailed)?;
        let stdout_receiver = spawn_capped_reader(stdout, PROBE_STDOUT_LIMIT);
        let stderr_receiver = spawn_capped_reader(stderr, PROBE_STDERR_LIMIT);
        let deadline = Instant::now() + PROBE_TIMEOUT;

        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(10));
                }
                Ok(None) => {
                    terminate_probe(&mut child);
                    return Err(LocalAgentError::ProbeTimedOut);
                }
                Err(_) => {
                    terminate_probe(&mut child);
                    return Err(LocalAgentError::ProbeFailed);
                }
            }
        };

        let stdout = receive_probe_output(stdout_receiver, deadline)?;
        let stderr = receive_probe_output(stderr_receiver, deadline)?;
        Ok(ProbeOutput {
            success: status.success(),
            stdout,
            stderr,
        })
    }
}

#[cfg(unix)]
fn configure_probe_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_probe_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_probe(child: &mut std::process::Child) {
    const SIGKILL: i32 = 9;

    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }

    if let Ok(process_group) = i32::try_from(child.id()) {
        // The child starts in its own process group, so a negative PID targets
        // only that probe and any descendants it spawned.
        unsafe {
            let _ = kill(-process_group, SIGKILL);
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(not(unix))]
fn terminate_probe(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn spawn_capped_reader<R>(
    mut reader: R,
    limit: usize,
) -> mpsc::Receiver<Result<Vec<u8>, ReaderError>>
where
    R: Read + Send + 'static,
{
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut bytes = Vec::with_capacity(limit.min(8192));
        let result = match reader
            .by_ref()
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes)
        {
            Ok(_) if bytes.len() <= limit => Ok(bytes),
            Ok(_) => Err(ReaderError::TooLarge),
            Err(_) => Err(ReaderError::Io),
        };
        let _ = sender.send(result);
    });
    receiver
}

fn receive_probe_output(
    receiver: mpsc::Receiver<Result<Vec<u8>, ReaderError>>,
    deadline: Instant,
) -> Result<Vec<u8>, LocalAgentError> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    match receiver.recv_timeout(remaining) {
        Ok(Ok(bytes)) => Ok(bytes),
        Ok(Err(ReaderError::TooLarge)) => Err(LocalAgentError::ProbeOutputTooLarge),
        Ok(Err(ReaderError::Io)) | Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err(LocalAgentError::ProbeFailed)
        }
        Err(mpsc::RecvTimeoutError::Timeout) => Err(LocalAgentError::ProbeTimedOut),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CapabilityEvaluation {
    compatible: bool,
    reason: Option<&'static str>,
}

impl CapabilityEvaluation {
    const fn compatible() -> Self {
        Self {
            compatible: true,
            reason: None,
        }
    }

    const fn incompatible(reason: &'static str) -> Self {
        Self {
            compatible: false,
            reason: Some(reason),
        }
    }

    fn into_result(self) -> Result<(), LocalAgentError> {
        if self.compatible {
            Ok(())
        } else {
            Err(LocalAgentError::Incompatible(self.reason.unwrap_or(
                "Capability restrictions could not be verified.",
            )))
        }
    }
}

pub fn discover_all() -> Vec<LocalAgentStatus> {
    discover_all_with_runner(&BoundedProbeRunner)
}

pub fn resolve_compatible_agent(kind: LocalAgentKind) -> Result<ResolvedAgent, LocalAgentError> {
    resolve_compatible_agent_with_runner(kind, &BoundedProbeRunner)
}

fn discover_all_with_runner(runner: &impl ProbeRunner) -> Vec<LocalAgentStatus> {
    let paths = current_search_path_directories();
    LocalAgentKind::ALL
        .into_iter()
        .map(|kind| match resolve_from_paths(kind, &paths) {
            Some(resolved) => probe_resolved_agent(resolved, runner),
            None => unavailable_status(kind),
        })
        .collect()
}

fn resolve_compatible_agent_with_runner(
    kind: LocalAgentKind,
    runner: &impl ProbeRunner,
) -> Result<ResolvedAgent, LocalAgentError> {
    let resolved = resolve_from_paths(kind, &current_search_path_directories())
        .ok_or(LocalAgentError::NotInstalled)?;
    probe_agent(&resolved, runner)?;
    Ok(resolved)
}

fn current_search_path_directories() -> Vec<PathBuf> {
    let gui_path = env::var_os("PATH");
    let login_path = login_shell_path_value();
    search_path_directories(gui_path.as_deref(), login_path.as_deref())
}

fn search_path_directories(gui_path: Option<&OsStr>, login_path: Option<&OsStr>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    gui_path
        .into_iter()
        .chain(login_path)
        .flat_map(env::split_paths)
        .filter(|path| path.is_absolute())
        .filter(|path| {
            let identity = path.canonicalize().unwrap_or_else(|_| path.clone());
            seen.insert(identity)
        })
        .collect()
}

fn resolve_from_paths(kind: LocalAgentKind, paths: &[PathBuf]) -> Option<ResolvedAgent> {
    let basename = kind.executable_basename();
    paths.iter().find_map(|directory| {
        let candidate = directory.join(basename);
        if !is_executable_file(&candidate) {
            return None;
        }
        let canonical_path = candidate.canonicalize().ok()?;
        if !canonical_path.is_absolute() || !is_executable_file(&canonical_path) {
            return None;
        }
        Some(ResolvedAgent {
            kind,
            path_label: redacted_path_label(basename),
            path: canonical_path,
        })
    })
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.metadata().is_ok_and(|metadata| metadata.is_file())
}

fn redacted_path_label(basename: &str) -> String {
    format!("bin/{basename}")
}

fn unavailable_status(kind: LocalAgentKind) -> LocalAgentStatus {
    LocalAgentStatus {
        kind,
        mention: kind.mention(),
        label: kind.label(),
        installed: false,
        compatible: false,
        path_label: None,
        version: None,
        reason: Some(LocalAgentError::NotInstalled.reason().to_string()),
    }
}

fn probe_resolved_agent(resolved: ResolvedAgent, runner: &impl ProbeRunner) -> LocalAgentStatus {
    let kind = resolved.kind;
    let mut status = LocalAgentStatus {
        kind,
        mention: kind.mention(),
        label: kind.label(),
        installed: true,
        compatible: false,
        path_label: Some(resolved.path_label.clone()),
        version: None,
        reason: None,
    };

    let version = match probe_version(&resolved, runner) {
        Ok(version) => version,
        Err(error) => {
            status.reason = Some(error.reason().to_string());
            return status;
        }
    };
    status.version = Some(version);

    match probe_capabilities(&resolved, runner) {
        Ok(()) => status.compatible = true,
        Err(error) => status.reason = Some(error.reason().to_string()),
    }
    status
}

fn probe_agent(
    resolved: &ResolvedAgent,
    runner: &impl ProbeRunner,
) -> Result<String, LocalAgentError> {
    let version = probe_version(resolved, runner)?;
    probe_capabilities(resolved, runner)?;
    Ok(version)
}

fn probe_version(
    resolved: &ResolvedAgent,
    runner: &impl ProbeRunner,
) -> Result<String, LocalAgentError> {
    let version_output = runner.run(&resolved.path, &[OsString::from("--version")], &[])?;
    parse_version(&successful_probe_text(&version_output)?)
}

fn probe_capabilities(
    resolved: &ResolvedAgent,
    runner: &impl ProbeRunner,
) -> Result<(), LocalAgentError> {
    match resolved.kind {
        LocalAgentKind::Claude => probe_claude(&resolved.path, runner)?,
        LocalAgentKind::Codex => probe_codex(&resolved.path, runner)?,
        LocalAgentKind::Opencode => probe_opencode(&resolved.path, runner)?,
    }
    Ok(())
}

fn probe_claude(executable: &Path, runner: &impl ProbeRunner) -> Result<(), LocalAgentError> {
    let output = runner.run(executable, &[OsString::from("--help")], &[])?;
    evaluate_claude_help(&successful_probe_text(&output)?).into_result()
}

fn probe_codex(executable: &Path, runner: &impl ProbeRunner) -> Result<(), LocalAgentError> {
    let help = runner.run(
        executable,
        &[OsString::from("exec"), OsString::from("--help")],
        &[],
    )?;
    evaluate_codex_help(&successful_probe_text(&help)?).into_result()?;

    let features = runner.run(executable, &codex_feature_probe_args(), &[])?;
    evaluate_codex_features(&successful_probe_text(&features)?).into_result()
}

fn probe_opencode(executable: &Path, runner: &impl ProbeRunner) -> Result<(), LocalAgentError> {
    let run_help = runner.run(
        executable,
        &[OsString::from("run"), OsString::from("--help")],
        &[],
    )?;
    let debug_help = runner.run(
        executable,
        &[
            OsString::from("debug"),
            OsString::from("config"),
            OsString::from("--help"),
        ],
        &[],
    )?;
    evaluate_opencode_help(
        &successful_probe_text(&run_help)?,
        &successful_probe_text(&debug_help)?,
    )
    .into_result()?;

    let environment = opencode_probe_environment();
    let config = runner.run(
        executable,
        &[
            OsString::from("debug"),
            OsString::from("config"),
            OsString::from("--pure"),
        ],
        &environment,
    )?;
    if !config.success {
        return Err(LocalAgentError::ProbeFailed);
    }
    let text =
        std::str::from_utf8(&config.stdout).map_err(|_| LocalAgentError::MalformedProbeOutput)?;
    let value: Value =
        serde_json::from_str(text).map_err(|_| LocalAgentError::MalformedProbeOutput)?;
    if opencode_permissions_are_denied(&value) {
        Ok(())
    } else {
        Err(LocalAgentError::Incompatible(OPEN_CODE_PERMISSIONS_REASON))
    }
}

fn successful_probe_text(output: &ProbeOutput) -> Result<String, LocalAgentError> {
    if !output.success {
        return Err(LocalAgentError::ProbeFailed);
    }
    let bytes = if output.stdout.is_empty() {
        &output.stderr
    } else {
        &output.stdout
    };
    std::str::from_utf8(bytes)
        .map(str::to_owned)
        .map_err(|_| LocalAgentError::MalformedProbeOutput)
}

fn parse_version(output: &str) -> Result<String, LocalAgentError> {
    output
        .split_ascii_whitespace()
        .map(|token| token.trim_matches(['(', ')', ',', ';']))
        .find(|token| {
            token.len() <= 64
                && token.as_bytes().first().is_some_and(u8::is_ascii_digit)
                && token.contains('.')
                && token.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+' | '_')
                })
        })
        .map(str::to_string)
        .ok_or(LocalAgentError::MalformedProbeOutput)
}

fn evaluate_claude_help(help: &str) -> CapabilityEvaluation {
    evaluate_required_flags(help, CLAUDE_REQUIRED_FLAGS, CLAUDE_FLAGS_REASON)
}

fn evaluate_codex_help(help: &str) -> CapabilityEvaluation {
    evaluate_required_flags(help, CODEX_REQUIRED_FLAGS, CODEX_FLAGS_REASON)
}

fn evaluate_opencode_help(run_help: &str, debug_help: &str) -> CapabilityEvaluation {
    if ["--pure", "--format", "--dir"]
        .into_iter()
        .all(|flag| help_has_flag(run_help, flag))
        && help_has_word(run_help, "json")
        && help_has_flag(debug_help, "--pure")
    {
        CapabilityEvaluation::compatible()
    } else {
        CapabilityEvaluation::incompatible(OPEN_CODE_FLAGS_REASON)
    }
}

fn evaluate_required_flags(
    help: &str,
    required: &[&str],
    reason: &'static str,
) -> CapabilityEvaluation {
    if required.iter().all(|flag| help_has_flag(help, flag)) {
        CapabilityEvaluation::compatible()
    } else {
        CapabilityEvaluation::incompatible(reason)
    }
}

fn help_has_flag(help: &str, flag: &str) -> bool {
    help.split_ascii_whitespace().any(|token| {
        let token = token.trim_matches(['[', ']', '(', ')', '{', '}', ',', ';']);
        token == flag
            || token
                .strip_prefix(flag)
                .is_some_and(|suffix| suffix.starts_with('='))
    })
}

fn help_has_word(help: &str, word: &str) -> bool {
    help.split(|character: char| {
        !(character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    })
    .any(|token| token.eq_ignore_ascii_case(word))
}

fn codex_feature_probe_args() -> Vec<OsString> {
    let mut args = Vec::with_capacity(2 + CODEX_DENIED_FEATURES.len() * 2 + 2);
    args.extend([OsString::from("features"), OsString::from("list")]);
    for feature in CODEX_DENIED_FEATURES {
        args.extend([OsString::from("--disable"), OsString::from(feature)]);
    }
    args.extend([OsString::from("-c"), OsString::from("mcp_servers={}")]);
    args
}

fn evaluate_codex_features(output: &str) -> CapabilityEvaluation {
    let mut features = BTreeMap::new();
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let columns: Vec<&str> = line.split_ascii_whitespace().collect();
        if columns.len() < 3
            || !is_feature_field(columns[0])
            || !columns[1..columns.len() - 1]
                .iter()
                .all(|stage| is_feature_field(stage))
        {
            return CapabilityEvaluation::incompatible(CODEX_FEATURES_REASON);
        }
        let enabled = match columns[columns.len() - 1] {
            "true" => true,
            "false" => false,
            _ => return CapabilityEvaluation::incompatible(CODEX_FEATURES_REASON),
        };
        if features.insert(columns[0], enabled).is_some() {
            return CapabilityEvaluation::incompatible(CODEX_FEATURES_REASON);
        }
    }

    if features.is_empty()
        || CODEX_DENIED_FEATURES
            .iter()
            .any(|feature| features.get(feature) != Some(&false))
        || features
            .iter()
            .any(|(feature, enabled)| *enabled && !PASSIVE_CODEX_FEATURES.contains(feature))
    {
        CapabilityEvaluation::incompatible(CODEX_FEATURES_REASON)
    } else {
        CapabilityEvaluation::compatible()
    }
}

fn is_feature_field(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
}

fn opencode_probe_environment() -> Vec<(OsString, OsString)> {
    vec![
        (
            OsString::from("OPENCODE_CONFIG_CONTENT"),
            OsString::from(OPEN_CODE_CONFIG_CONTENT),
        ),
        (
            OsString::from("OPENCODE_DISABLE_AUTOUPDATE"),
            OsString::from("true"),
        ),
    ]
}

fn opencode_permissions_are_denied(config: &Value) -> bool {
    let Some(permissions) = config.get("permission").and_then(Value::as_object) else {
        return false;
    };
    OPEN_CODE_REQUIRED_PERMISSIONS
        .iter()
        .all(|permission| permissions.get(*permission) == Some(&Value::String("deny".into())))
        && permissions
            .values()
            .all(|value| value == &Value::String("deny".into()))
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        ffi::{OsStr, OsString},
        fs,
        path::{Path, PathBuf},
        sync::Mutex,
        time::Duration,
    };

    use serde_json::{Value, json};
    use tempfile::tempdir;

    use super::{
        CAPABILITY_PROBE_TIMEOUT_REASON, CLAUDE_FLAGS_REASON, CODEX_FEATURES_REASON,
        OPEN_CODE_PERMISSIONS_REASON, PROBE_TIMEOUT, ProbeOutput, ProbeRunner,
        codex_feature_probe_args, evaluate_claude_help, evaluate_codex_features,
        evaluate_codex_help, evaluate_opencode_help, opencode_permissions_are_denied,
        opencode_probe_environment, probe_resolved_agent, resolve_from_paths,
        search_path_directories,
    };
    use crate::local_agents::{LocalAgentError, LocalAgentKind, ResolvedAgent};

    const SAFE_CODEX_FEATURES: &str = "\
apps stable false
auth_elicitation experimental false
browser_use experimental false
browser_use_external experimental false
browser_use_full_cdp_access experimental false
chronicle experimental false
code_mode experimental false
code_mode_host experimental false
computer_use experimental false
enable_mcp_apps experimental false
goals experimental false
guardian_approval experimental false
hooks experimental false
image_generation experimental false
in_app_browser experimental false
in_app_updates stable false
memories experimental false
multi_agent experimental false
multi_agent_v2 experimental false
plugin_sharing experimental false
plugins experimental false
recommended_plugins experimental false
remote_plugin experimental false
shell_snapshot stable false
shell_tool stable false
skill_mcp_dependency_install experimental false
skill_search experimental false
standalone_web_search experimental false
tool_call_mcp_elicitation experimental false
tool_suggest experimental false
unified_exec stable false
view_image stable false
workspace_dependencies experimental false
collaboration_modes stable true
enable_request_compression stable true
fast_mode stable true
item_ids stable true
mentions_v2 stable true
personality stable true
remote_compaction_v2 stable true
resize_all_images stable true
sqlite stable true
steer stable true
terminal_resize_reflow stable true
tool_search_always_defer_mcp_tools stable true
tui_app_server stable true
";

    const CODEX_EXEC_HELP: &str = "\
Usage: codex exec [OPTIONS] [PROMPT]
  --strict-config
  --sandbox <SANDBOX>
  --ephemeral
  --skip-git-repo-check
  --output-schema <FILE>
  --output-last-message <FILE>
  --disable <FEATURE>
  -c <KEY=VALUE>
";

    const CLAUDE_HELP: &str = "\
Usage: claude [options]
  --safe-mode
  --print
  --tools <tools>
  --permission-mode <mode>
  --strict-mcp-config
  --mcp-config <config>
  --no-session-persistence
  --output-format <format>
  --json-schema <schema>
";

    const OPEN_CODE_RUN_HELP: &str = "\
Usage: opencode run [message..]
  --pure
  --format <format>  output format: default or json
  --dir <path>
";

    const OPEN_CODE_DEBUG_CONFIG_HELP: &str = "\
Usage: opencode debug config
  --pure
";

    #[cfg(unix)]
    fn create_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;

        fs::write(path, "#!/bin/sh\nexit 0\n").unwrap();
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(path, permissions).unwrap();
    }

    fn denied_open_code_permissions() -> Value {
        json!({
            "permission": {
                "*": "deny",
                "read": "deny",
                "edit": "deny",
                "glob": "deny",
                "grep": "deny",
                "list": "deny",
                "bash": "deny",
                "task": "deny",
                "skill": "deny",
                "lsp": "deny",
                "question": "deny",
                "webfetch": "deny",
                "websearch": "deny",
                "external_directory": "deny"
            }
        })
    }

    #[test]
    #[cfg(unix)]
    fn resolution_prefers_the_first_path_and_returns_a_canonical_redacted_result() {
        let temp = tempdir().unwrap();
        let first_bin = temp.path().join("first/bin");
        let second_bin = temp.path().join("second/bin");
        fs::create_dir_all(&first_bin).unwrap();
        fs::create_dir_all(&second_bin).unwrap();
        let first_claude = first_bin.join("claude");
        let second_claude = second_bin.join("claude");
        create_executable(&first_claude);
        create_executable(&second_claude);

        let resolved =
            resolve_from_paths(LocalAgentKind::Claude, &[first_bin, second_bin]).unwrap();

        assert_eq!(resolved.path, first_claude.canonicalize().unwrap());
        assert!(resolved.path.is_absolute());
        assert_eq!(resolved.path_label, "bin/claude");
        assert!(
            !resolved
                .path_label
                .contains(temp.path().to_string_lossy().as_ref())
        );
    }

    #[test]
    #[cfg(unix)]
    fn redacted_label_never_uses_a_potentially_sensitive_parent_name() {
        let temp = tempdir().unwrap();
        let sensitive_parent = temp.path().join("private-user-name");
        fs::create_dir_all(&sensitive_parent).unwrap();
        create_executable(&sensitive_parent.join("claude"));

        let resolved = resolve_from_paths(LocalAgentKind::Claude, &[sensitive_parent]).unwrap();

        assert_eq!(resolved.path_label, "bin/claude");
        assert!(!resolved.path_label.contains("private-user-name"));
    }

    #[test]
    #[cfg(unix)]
    fn resolution_rejects_missing_non_executable_and_renamed_candidates() {
        let temp = tempdir().unwrap();
        let bin = temp.path().join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(bin.join("claude"), "not executable").unwrap();
        create_executable(&bin.join("claude-custom"));

        assert!(resolve_from_paths(LocalAgentKind::Claude, &[bin]).is_none());
    }

    #[test]
    #[cfg(unix)]
    fn resolution_uses_only_the_compiled_basename_for_the_requested_kind() {
        let temp = tempdir().unwrap();
        let bin = temp.path().join("bin");
        fs::create_dir_all(&bin).unwrap();
        create_executable(&bin.join("claude"));
        let codex = bin.join("codex");
        create_executable(&codex);

        let resolved = resolve_from_paths(LocalAgentKind::Codex, &[bin]).unwrap();

        assert_eq!(resolved.path, codex.canonicalize().unwrap());
        assert_eq!(resolved.path.file_name(), Some(OsStr::new("codex")));
    }

    #[test]
    fn gui_and_login_shell_paths_are_ordered_and_canonical_duplicates_are_removed() {
        let temp = tempdir().unwrap();
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        let gui = std::env::join_paths([&first, &second]).unwrap();
        let login = std::env::join_paths([&second, &first]).unwrap();

        assert_eq!(
            search_path_directories(Some(&gui), Some(&login)),
            vec![first, second]
        );
    }

    #[test]
    fn path_search_rejects_empty_and_relative_entries() {
        let temp = tempdir().unwrap();
        let absolute = temp.path().join("bin");
        fs::create_dir_all(&absolute).unwrap();
        let gui = std::env::join_paths([
            PathBuf::new(),
            PathBuf::from("relative/bin"),
            absolute.clone(),
        ])
        .unwrap();

        assert_eq!(search_path_directories(Some(&gui), None), vec![absolute]);
    }

    #[test]
    fn claude_help_requires_each_safety_flag_by_its_exact_name() {
        assert!(evaluate_claude_help(CLAUDE_HELP).compatible);

        let renamed = CLAUDE_HELP.replace("--json-schema", "--json-schema-v2");
        let evaluation = evaluate_claude_help(&renamed);

        assert!(!evaluation.compatible);
        assert_eq!(evaluation.reason, Some(CLAUDE_FLAGS_REASON));
    }

    #[test]
    fn codex_help_requires_every_execution_restriction() {
        assert!(evaluate_codex_help(CODEX_EXEC_HELP).compatible);

        let missing_strict_config = CODEX_EXEC_HELP.replace("--strict-config", "--strict");
        assert!(!evaluate_codex_help(&missing_strict_config).compatible);
    }

    #[test]
    fn codex_feature_probe_uses_the_full_denylist_without_strict_config() {
        let actual: Vec<String> = codex_feature_probe_args()
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();
        let expected_denied = [
            "apps",
            "auth_elicitation",
            "browser_use",
            "browser_use_external",
            "browser_use_full_cdp_access",
            "chronicle",
            "code_mode",
            "code_mode_host",
            "computer_use",
            "enable_mcp_apps",
            "goals",
            "guardian_approval",
            "hooks",
            "image_generation",
            "in_app_browser",
            "in_app_updates",
            "memories",
            "multi_agent",
            "multi_agent_v2",
            "plugin_sharing",
            "plugins",
            "recommended_plugins",
            "remote_plugin",
            "shell_snapshot",
            "shell_tool",
            "skill_mcp_dependency_install",
            "skill_search",
            "standalone_web_search",
            "tool_call_mcp_elicitation",
            "tool_suggest",
            "unified_exec",
            "view_image",
            "workspace_dependencies",
        ];

        assert_eq!(&actual[..2], ["features", "list"]);
        assert!(!actual.iter().any(|value| value == "--strict-config"));
        let denied: Vec<&str> = actual[2..actual.len() - 2]
            .chunks_exact(2)
            .map(|pair| {
                assert_eq!(pair[0], "--disable");
                pair[1].as_str()
            })
            .collect();
        assert_eq!(denied, expected_denied);
        assert_eq!(&actual[actual.len() - 2..], ["-c", "mcp_servers={}"]);
    }

    #[test]
    fn codex_features_require_all_denied_features_to_be_present_and_false() {
        assert!(evaluate_codex_features(SAFE_CODEX_FEATURES).compatible);

        let installed_stage_shape = SAFE_CODEX_FEATURES.replace(
            "code_mode experimental false",
            "code_mode under development false",
        );
        assert!(evaluate_codex_features(&installed_stage_shape).compatible);

        let enabled_shell =
            SAFE_CODEX_FEATURES.replace("shell_tool stable false", "shell_tool stable true");
        let evaluation = evaluate_codex_features(&enabled_shell);

        assert!(!evaluation.compatible);
        assert_eq!(evaluation.reason, Some(CODEX_FEATURES_REASON));
    }

    #[test]
    fn codex_features_reject_unknown_enabled_or_malformed_rows() {
        let unknown = format!("{SAFE_CODEX_FEATURES}future_tool stable true\n");
        assert!(!evaluate_codex_features(&unknown).compatible);
        assert!(!evaluate_codex_features("future_tool stable maybe\n").compatible);
        assert!(!evaluate_codex_features("shell_tool false\n").compatible);
        assert!(!evaluate_codex_features("\n").compatible);
    }

    #[test]
    fn open_code_help_requires_pure_json_run_and_pure_resolved_config() {
        assert!(evaluate_opencode_help(OPEN_CODE_RUN_HELP, OPEN_CODE_DEBUG_CONFIG_HELP).compatible);

        let renamed_dir = OPEN_CODE_RUN_HELP.replace("--dir", "--directory");
        assert!(!evaluate_opencode_help(&renamed_dir, OPEN_CODE_DEBUG_CONFIG_HELP).compatible);
        let no_json = OPEN_CODE_RUN_HELP.replace("default or json", "default or text");
        assert!(!evaluate_opencode_help(&no_json, OPEN_CODE_DEBUG_CONFIG_HELP).compatible);
    }

    #[test]
    fn open_code_effective_permissions_require_wildcard_and_every_named_deny() {
        assert!(opencode_permissions_are_denied(
            &denied_open_code_permissions()
        ));
        assert!(!opencode_permissions_are_denied(&json!({
            "permission": {"*": "deny", "bash": "allow"}
        })));

        let mut future_override = denied_open_code_permissions();
        future_override["permission"]["future_capability"] = json!("allow");
        assert!(!opencode_permissions_are_denied(&future_override));

        let mut missing_required = denied_open_code_permissions();
        missing_required["permission"]
            .as_object_mut()
            .unwrap()
            .remove("websearch");
        assert!(!opencode_permissions_are_denied(&missing_required));
    }

    struct TimeoutRunner;

    impl ProbeRunner for TimeoutRunner {
        fn run(
            &self,
            _executable: &Path,
            _args: &[OsString],
            _env: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            Err(LocalAgentError::ProbeTimedOut)
        }
    }

    struct IncompatibleClaudeRunner {
        calls: Mutex<usize>,
    }

    impl ProbeRunner for IncompatibleClaudeRunner {
        fn run(
            &self,
            _executable: &Path,
            _args: &[OsString],
            _env: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            let mut calls = self.calls.lock().unwrap();
            let output = if *calls == 0 {
                ProbeOutput {
                    success: true,
                    stdout: b"claude 2.1.226\n".to_vec(),
                    stderr: Vec::new(),
                }
            } else {
                ProbeOutput {
                    success: true,
                    stdout: CLAUDE_HELP
                        .replace("--json-schema", "--json-schema-v2")
                        .into_bytes(),
                    stderr: Vec::new(),
                }
            };
            *calls += 1;
            Ok(output)
        }
    }

    #[test]
    fn installed_incompatible_status_keeps_only_the_sanitized_version() {
        let resolved = ResolvedAgent {
            kind: LocalAgentKind::Claude,
            path: PathBuf::from("/private/secret/bin/claude"),
            path_label: "bin/claude".to_string(),
        };
        let runner = IncompatibleClaudeRunner {
            calls: Mutex::new(0),
        };

        let status = probe_resolved_agent(resolved, &runner);

        assert!(status.installed);
        assert!(!status.compatible);
        assert_eq!(status.version.as_deref(), Some("2.1.226"));
        assert_eq!(status.reason.as_deref(), Some(CLAUDE_FLAGS_REASON));
        assert!(
            !serde_json::to_string(&status)
                .unwrap()
                .contains("private/secret")
        );
    }

    #[test]
    fn open_code_probe_environment_contains_valid_fixed_denials_only() {
        let environment: BTreeMap<OsString, OsString> =
            opencode_probe_environment().into_iter().collect();
        let config: Value = serde_json::from_str(
            environment
                .get(OsStr::new("OPENCODE_CONFIG_CONTENT"))
                .unwrap()
                .to_str()
                .unwrap(),
        )
        .unwrap();

        assert_eq!(config["share"], "disabled");
        assert!(opencode_permissions_are_denied(&config));
        assert_eq!(
            environment.get(OsStr::new("OPENCODE_DISABLE_AUTOUPDATE")),
            Some(&OsString::from("true"))
        );
        assert_eq!(environment.len(), 2);
    }

    #[test]
    fn capability_timeout_is_five_seconds_and_returns_a_stable_sanitized_reason() {
        assert_eq!(PROBE_TIMEOUT, Duration::from_secs(5));
        let resolved = ResolvedAgent {
            kind: LocalAgentKind::Claude,
            path: PathBuf::from("/private/secret/bin/claude"),
            path_label: "bin/claude".to_string(),
        };

        let status = probe_resolved_agent(resolved, &TimeoutRunner);

        assert!(!status.compatible);
        assert_eq!(
            status.reason.as_deref(),
            Some(CAPABILITY_PROBE_TIMEOUT_REASON)
        );
        assert!(!status.reason.unwrap().contains("/private/secret"));
    }

    #[test]
    fn open_code_permission_failure_reason_is_stable() {
        let evaluation = if opencode_permissions_are_denied(&json!({
            "permission": {"*": "deny", "bash": "allow"}
        })) {
            unreachable!()
        } else {
            super::CapabilityEvaluation::incompatible(OPEN_CODE_PERMISSIONS_REASON)
        };

        assert_eq!(evaluation.reason, Some(OPEN_CODE_PERMISSIONS_REASON));
    }

    #[allow(dead_code)]
    fn _assert_probe_output_shape(output: ProbeOutput) {
        let ProbeOutput {
            success,
            stdout,
            stderr,
        } = output;
        let _: (bool, Vec<u8>, Vec<u8>) = (success, stdout, stderr);
    }

    #[allow(dead_code)]
    fn _assert_error_is_safe_to_group(error: LocalAgentError) {
        let mut grouped = BTreeMap::new();
        grouped.insert(error.reason(), 1_u8);
    }
}
