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

pub(super) const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const PROBE_STDOUT_LIMIT: usize = 256 * 1024;
const PROBE_STDERR_LIMIT: usize = 64 * 1024;
const LOGIN_SHELL_PATH_LIMIT: usize = 64 * 1024;

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
    "todowrite",
    "doom_loop",
];

const OPEN_CODE_OWNED_AGENT: &str = "markdowner";
const OPEN_CODE_CONFIG_CONTENT: &str = r#"{"share":"disabled","default_agent":"markdowner","tools":{"*":false,"edit":false},"permission":{"*":"deny","read":"deny","edit":"deny","glob":"deny","grep":"deny","list":"deny","bash":"deny","task":"deny","skill":"deny","lsp":"deny","question":"deny","webfetch":"deny","websearch":"deny","external_directory":"deny","todowrite":"deny","doom_loop":"deny"},"agent":{"markdowner":{"mode":"primary","tools":{"*":false,"edit":false},"permission":{"*":"deny","read":"deny","edit":"deny","glob":"deny","grep":"deny","list":"deny","bash":"deny","task":"deny","skill":"deny","lsp":"deny","question":"deny","webfetch":"deny","websearch":"deny","external_directory":"deny","todowrite":"deny","doom_loop":"deny"}}}}"#;

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
        let process_group = ProbeProcessGroup::from_child(&child);
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
                    terminate_probe(process_group, &mut child);
                    return Err(LocalAgentError::ProbeTimedOut);
                }
                Err(_) => {
                    terminate_probe(process_group, &mut child);
                    return Err(LocalAgentError::ProbeFailed);
                }
            }
        };

        let stdout = match receive_probe_output(stdout_receiver, deadline) {
            Ok(stdout) => stdout,
            Err(error) => {
                terminate_probe(process_group, &mut child);
                return Err(error);
            }
        };
        let stderr = match receive_probe_output(stderr_receiver, deadline) {
            Ok(stderr) => stderr,
            Err(error) => {
                terminate_probe(process_group, &mut child);
                return Err(error);
            }
        };
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
#[derive(Clone, Copy)]
struct ProbeProcessGroup(Option<i32>);

#[cfg(unix)]
impl ProbeProcessGroup {
    fn from_child(child: &std::process::Child) -> Self {
        Self(i32::try_from(child.id()).ok().filter(|pid| *pid > 0))
    }

    fn terminate(self) {
        const SIGKILL: i32 = 9;

        unsafe extern "C" {
            fn kill(pid: i32, signal: i32) -> i32;
        }

        if let Some(process_group) = self.0 {
            // Negative PID targets the independently retained process-group ID,
            // even after the direct child has already exited and been reaped.
            unsafe {
                let _ = kill(-process_group, SIGKILL);
            }
        }
    }
}

#[cfg(not(unix))]
#[derive(Clone, Copy)]
struct ProbeProcessGroup;

#[cfg(not(unix))]
impl ProbeProcessGroup {
    fn from_child(_child: &std::process::Child) -> Self {
        Self
    }

    fn terminate(self) {}
}

#[cfg(unix)]
fn terminate_probe(process_group: ProbeProcessGroup, child: &mut std::process::Child) {
    process_group.terminate();
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(not(unix))]
fn terminate_probe(_process_group: ProbeProcessGroup, child: &mut std::process::Child) {
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
    let paths = current_search_path_directories_with_runner(runner);
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
    let resolved = resolve_from_paths(kind, &current_search_path_directories_with_runner(runner))
        .ok_or(LocalAgentError::NotInstalled)?;
    probe_agent(&resolved, runner)?;
    Ok(resolved)
}

fn current_search_path_directories_with_runner(runner: &impl ProbeRunner) -> Vec<PathBuf> {
    let gui_path = env::var_os("PATH");
    let shell = env::var_os("SHELL").unwrap_or_else(|| OsString::from("/bin/sh"));
    search_path_directories_with_runner(gui_path.as_deref(), Path::new(&shell), runner)
}

pub(super) fn login_shell_path_value() -> Option<OsString> {
    let shell = env::var_os("SHELL").unwrap_or_else(|| OsString::from("/bin/sh"));
    login_shell_path_value_with_runner(Path::new(&shell), &BoundedProbeRunner).ok()
}

fn login_shell_path_value_with_runner(
    shell: &Path,
    runner: &impl ProbeRunner,
) -> Result<OsString, LocalAgentError> {
    if !shell.is_absolute() {
        return Err(LocalAgentError::ProbeSpawnFailed);
    }
    let output = runner.run(
        shell,
        &[
            OsString::from("-l"),
            OsString::from("-c"),
            OsString::from("printf %s \"$PATH\""),
        ],
        &[],
    )?;
    if !output.success {
        return Err(LocalAgentError::ProbeFailed);
    }
    if output.stdout.len() > LOGIN_SHELL_PATH_LIMIT || output.stderr.len() > PROBE_STDERR_LIMIT {
        return Err(LocalAgentError::ProbeOutputTooLarge);
    }
    let path =
        std::str::from_utf8(&output.stdout).map_err(|_| LocalAgentError::MalformedProbeOutput)?;
    if path.is_empty()
        || path
            .bytes()
            .any(|byte| matches!(byte, b'\0' | b'\n' | b'\r'))
    {
        return Err(LocalAgentError::MalformedProbeOutput);
    }
    Ok(OsString::from(path))
}

fn search_path_directories_with_runner(
    gui_path: Option<&OsStr>,
    shell: &Path,
    runner: &impl ProbeRunner,
) -> Vec<PathBuf> {
    let login_path = login_shell_path_value_with_runner(shell, runner).ok();
    search_path_directories(gui_path, login_path.as_deref())
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
    if config.get("share").and_then(Value::as_str) != Some("disabled")
        || config.get("default_agent").and_then(Value::as_str) != Some(OPEN_CODE_OWNED_AGENT)
        || !legacy_mode_is_empty(config.get("mode"))
        || !permission_map_is_denied(config.get("permission"), true)
        || !tools_map_is_disabled(config.get("tools"), true)
    {
        return false;
    }

    let Some(agents) = config.get("agent").and_then(Value::as_object) else {
        return false;
    };
    let Some(owned_agent) = agents.get(OPEN_CODE_OWNED_AGENT).and_then(Value::as_object) else {
        return false;
    };
    if owned_agent.get("mode").and_then(Value::as_str) != Some("primary")
        || !permission_map_is_denied(owned_agent.get("permission"), true)
        || !tools_map_is_disabled(owned_agent.get("tools"), true)
    {
        return false;
    }

    agents.values().all(agent_overrides_are_denied)
}

fn legacy_mode_is_empty(mode: Option<&Value>) -> bool {
    match mode {
        None | Some(Value::Null) => true,
        Some(Value::Object(mode)) => mode.is_empty(),
        _ => false,
    }
}

fn agent_overrides_are_denied(agent: &Value) -> bool {
    let Some(agent) = agent.as_object() else {
        return false;
    };
    agent
        .get("permission")
        .is_none_or(|permission| permission_map_is_denied(Some(permission), false))
        && agent
            .get("tools")
            .is_none_or(|tools| tools_map_is_disabled(Some(tools), false))
}

fn permission_map_is_denied(permission: Option<&Value>, require_all_known: bool) -> bool {
    let Some(permission) = permission else {
        return false;
    };
    let Some(permission) = permission.as_object() else {
        return permission.as_str() == Some("deny") && !require_all_known;
    };
    if permission.is_empty()
        || !permission.values().all(permission_rule_is_denied)
        || (require_all_known
            && OPEN_CODE_REQUIRED_PERMISSIONS
                .iter()
                .any(|name| !permission.get(*name).is_some_and(permission_rule_is_denied)))
    {
        return false;
    }
    true
}

fn permission_rule_is_denied(rule: &Value) -> bool {
    match rule {
        Value::String(action) => action == "deny",
        Value::Object(patterns) => {
            !patterns.is_empty() && patterns.values().all(permission_rule_is_denied)
        }
        _ => false,
    }
}

fn tools_map_is_disabled(tools: Option<&Value>, require_wildcard: bool) -> bool {
    let Some(tools) = tools else {
        return false;
    };
    let Some(tools) = tools.as_object() else {
        return false;
    };
    !tools.is_empty()
        && (!require_wildcard || tools.get("*") == Some(&Value::Bool(false)))
        && tools.values().all(tool_rule_is_disabled)
}

fn tool_rule_is_disabled(rule: &Value) -> bool {
    match rule {
        Value::Bool(false) => true,
        Value::Object(rules) => !rules.is_empty() && rules.values().all(tool_rule_is_disabled),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        ffi::{OsStr, OsString},
        fs,
        path::{Path, PathBuf},
        sync::Mutex,
        thread,
        time::{Duration, Instant},
    };

    use serde_json::{Value, json};
    use tempfile::tempdir;

    use super::{
        BoundedProbeRunner, CAPABILITY_PROBE_TIMEOUT_REASON, CLAUDE_FLAGS_REASON,
        CODEX_FEATURES_REASON, LOGIN_SHELL_PATH_LIMIT, OPEN_CODE_PERMISSIONS_REASON, PROBE_TIMEOUT,
        ProbeOutput, ProbeRunner, codex_feature_probe_args, evaluate_claude_help,
        evaluate_codex_features, evaluate_codex_help, evaluate_opencode_help,
        login_shell_path_value_with_runner, opencode_permissions_are_denied,
        opencode_probe_environment, probe_resolved_agent, resolve_from_paths,
        search_path_directories, search_path_directories_with_runner,
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
        create_executable_script(path, "#!/bin/sh\nexit 0\n");
    }

    #[cfg(unix)]
    fn create_executable_script(path: &Path, script: &str) {
        use std::os::unix::fs::PermissionsExt;

        fs::write(path, script).unwrap();
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(path, permissions).unwrap();
    }

    #[cfg(unix)]
    fn process_exists(pid: i32) -> bool {
        unsafe extern "C" {
            fn kill(pid: i32, signal: i32) -> i32;
        }

        // Signal zero performs an existence/permission check only.
        unsafe { kill(pid, 0) == 0 }
    }

    #[cfg(unix)]
    fn kill_test_process(pid: i32) {
        const SIGKILL: i32 = 9;

        unsafe extern "C" {
            fn kill(pid: i32, signal: i32) -> i32;
        }

        unsafe {
            let _ = kill(pid, SIGKILL);
        }
    }

    #[cfg(unix)]
    fn process_disappears(pid: i32, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if !process_exists(pid) {
                return true;
            }
            thread::sleep(Duration::from_millis(10));
        }
        !process_exists(pid)
    }

    fn denied_open_code_permission_map() -> Value {
        json!({
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
            "external_directory": "deny",
            "todowrite": "deny",
            "doom_loop": "deny"
        })
    }

    fn fully_denied_open_code_config() -> Value {
        let permission = denied_open_code_permission_map();
        json!({
            "share": "disabled",
            "default_agent": "markdowner",
            "mode": {},
            "tools": {"*": false, "edit": false},
            "permission": permission.clone(),
            "agent": {
                "markdowner": {
                    "mode": "primary",
                    "tools": {"*": false, "edit": false},
                    "permission": permission
                }
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
            &fully_denied_open_code_config()
        ));
        assert!(!opencode_permissions_are_denied(&json!({
            "permission": {"*": "deny", "bash": "allow"}
        })));

        let mut future_override = fully_denied_open_code_config();
        future_override["permission"]["future_capability"] = json!("allow");
        assert!(!opencode_permissions_are_denied(&future_override));

        let mut missing_required = fully_denied_open_code_config();
        missing_required["permission"]
            .as_object_mut()
            .unwrap()
            .remove("websearch");
        assert!(!opencode_permissions_are_denied(&missing_required));
    }

    #[test]
    fn open_code_rejects_agent_permission_overrides_at_every_depth() {
        let mut direct = fully_denied_open_code_config();
        direct["agent"]["build"] = json!({"permission": {"bash": "allow"}});
        assert!(!opencode_permissions_are_denied(&direct));

        let mut nested = fully_denied_open_code_config();
        nested["agent"]["build"] = json!({
            "permission": {"bash": {"*": "allow"}}
        });
        assert!(!opencode_permissions_are_denied(&nested));

        let mut mixed_pattern = fully_denied_open_code_config();
        mixed_pattern["agent"]["build"] = json!({
            "permission": {"bash": {"*": "deny", "git *": "allow"}}
        });
        assert!(!opencode_permissions_are_denied(&mixed_pattern));
    }

    #[test]
    fn open_code_rejects_enabled_global_or_agent_legacy_tools() {
        let mut global = fully_denied_open_code_config();
        global["tools"]["edit"] = json!(true);
        assert!(!opencode_permissions_are_denied(&global));

        let mut agent = fully_denied_open_code_config();
        agent["agent"]["markdowner"]["tools"]["edit"] = json!(true);
        assert!(!opencode_permissions_are_denied(&agent));

        let mut nested = fully_denied_open_code_config();
        nested["agent"]["build"] = json!({"tools": {"group": {"edit": true}}});
        assert!(!opencode_permissions_are_denied(&nested));
    }

    #[test]
    fn open_code_rejects_builtin_custom_or_legacy_default_agent_overrides() {
        let mut builtin = fully_denied_open_code_config();
        builtin["default_agent"] = json!("build");
        assert!(!opencode_permissions_are_denied(&builtin));

        let mut custom = fully_denied_open_code_config();
        custom["default_agent"] = json!("custom");
        custom["agent"]["custom"] = json!({
            "mode": "primary",
            "permission": {"*": "deny"},
            "tools": {"*": false}
        });
        assert!(!opencode_permissions_are_denied(&custom));

        let mut legacy_mode = fully_denied_open_code_config();
        legacy_mode["mode"] = json!({
            "build": {"permission": {"bash": "allow"}}
        });
        assert!(!opencode_permissions_are_denied(&legacy_mode));
    }

    #[test]
    fn open_code_accepts_only_fully_denied_pattern_and_agent_overrides() {
        let mut config = fully_denied_open_code_config();
        config["permission"]["bash"] = json!({"*": "deny", "git *": "deny"});
        config["agent"]["markdowner"]["permission"]["bash"] = json!({"*": "deny", "git *": "deny"});
        config["agent"]["review"] = json!({
            "mode": "subagent",
            "permission": {"bash": {"*": "deny"}},
            "tools": {"edit": false}
        });

        assert!(opencode_permissions_are_denied(&config));
    }

    #[test]
    #[cfg(unix)]
    fn bounded_runner_kills_pipe_holding_descendants_after_parent_exit() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("probe");
        let pid_file = temp.path().join("descendant.pid");
        create_executable_script(
            &script,
            "#!/bin/sh\n(/bin/sleep 30) &\ndescendant=$!\nprintf '%s' \"$descendant\" > \"$1\"\nexit 0\n",
        );

        let started = Instant::now();
        let error = match BoundedProbeRunner.run(&script, &[pid_file.as_os_str().to_owned()], &[]) {
            Err(error) => error,
            Ok(_) => panic!("pipe-holding probe unexpectedly succeeded"),
        };
        let pid: i32 = fs::read_to_string(&pid_file).unwrap().parse().unwrap();
        let disappeared = process_disappears(pid, Duration::from_millis(500));
        if !disappeared {
            kill_test_process(pid);
        }

        assert_eq!(error, LocalAgentError::ProbeTimedOut);
        assert!(started.elapsed() < Duration::from_secs(7));
        assert!(disappeared, "pipe-holding descendant survived timeout");
        assert!(
            !error
                .reason()
                .contains(temp.path().to_string_lossy().as_ref())
        );
    }

    #[test]
    #[cfg(unix)]
    fn bounded_runner_kills_descendants_when_probe_output_exceeds_the_cap() {
        let temp = tempdir().unwrap();
        let script = temp.path().join("probe");
        let pid_file = temp.path().join("descendant.pid");
        create_executable_script(
            &script,
            "#!/bin/sh\n(/bin/sleep 30) &\ndescendant=$!\nprintf '%s' \"$descendant\" > \"$1\"\n/usr/bin/yes x | /usr/bin/head -c 300000\nexit 0\n",
        );

        let error = match BoundedProbeRunner.run(&script, &[pid_file.as_os_str().to_owned()], &[]) {
            Err(error) => error,
            Ok(_) => panic!("oversized probe unexpectedly succeeded"),
        };
        let pid: i32 = fs::read_to_string(&pid_file).unwrap().parse().unwrap();
        let disappeared = process_disappears(pid, Duration::from_millis(500));
        if !disappeared {
            kill_test_process(pid);
        }

        assert_eq!(error, LocalAgentError::ProbeOutputTooLarge);
        assert!(
            disappeared,
            "probe descendant survived output-limit failure"
        );
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

    struct OversizedShellRunner;

    impl ProbeRunner for OversizedShellRunner {
        fn run(
            &self,
            _executable: &Path,
            _args: &[OsString],
            _env: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            Ok(ProbeOutput {
                success: true,
                stdout: vec![b'x'; LOGIN_SHELL_PATH_LIMIT + 1],
                stderr: Vec::new(),
            })
        }
    }

    type ProbeCall = (PathBuf, Vec<OsString>, Vec<(OsString, OsString)>);

    struct ShellOutputRunner {
        success: bool,
        stdout: Vec<u8>,
        calls: Mutex<Vec<ProbeCall>>,
    }

    impl ProbeRunner for ShellOutputRunner {
        fn run(
            &self,
            executable: &Path,
            args: &[OsString],
            environment: &[(OsString, OsString)],
        ) -> Result<ProbeOutput, LocalAgentError> {
            self.calls.lock().unwrap().push((
                executable.to_path_buf(),
                args.to_vec(),
                environment.to_vec(),
            ));
            Ok(ProbeOutput {
                success: self.success,
                stdout: self.stdout.clone(),
                stderr: Vec::new(),
            })
        }
    }

    #[test]
    fn login_shell_path_uses_fixed_arguments_after_gui_path_and_deduplicates() {
        let temp = tempdir().unwrap();
        let gui_bin = temp.path().join("gui-bin");
        let login_bin = temp.path().join("login-bin");
        fs::create_dir_all(&gui_bin).unwrap();
        fs::create_dir_all(&login_bin).unwrap();
        let gui_path = std::env::join_paths([&gui_bin]).unwrap();
        let login_path = std::env::join_paths([&login_bin, &gui_bin]).unwrap();
        let shell = Path::new("/private/fake-login-shell");
        let runner = ShellOutputRunner {
            success: true,
            stdout: login_path.to_string_lossy().as_bytes().to_vec(),
            calls: Mutex::new(Vec::new()),
        };

        let paths = search_path_directories_with_runner(Some(&gui_path), shell, &runner);

        assert_eq!(paths, vec![gui_bin, login_bin]);
        assert_eq!(
            *runner.calls.lock().unwrap(),
            vec![(
                shell.to_path_buf(),
                vec![
                    OsString::from("-l"),
                    OsString::from("-c"),
                    OsString::from("printf %s \"$PATH\"")
                ],
                Vec::new()
            )]
        );
    }

    #[test]
    fn login_shell_timeout_is_sanitized_and_falls_back_to_gui_path() {
        let temp = tempdir().unwrap();
        let gui_bin = temp.path().join("gui-bin");
        fs::create_dir_all(&gui_bin).unwrap();
        let gui_path = std::env::join_paths([&gui_bin]).unwrap();
        let shell = Path::new("/private/secret-user/login-shell");

        let error = login_shell_path_value_with_runner(shell, &TimeoutRunner).unwrap_err();
        let paths = search_path_directories_with_runner(Some(&gui_path), shell, &TimeoutRunner);

        assert_eq!(error, LocalAgentError::ProbeTimedOut);
        assert!(!error.reason().contains("secret-user"));
        assert_eq!(paths, vec![gui_bin]);
    }

    #[test]
    fn oversized_login_shell_path_is_rejected_without_losing_gui_path() {
        let temp = tempdir().unwrap();
        let gui_bin = temp.path().join("gui-bin");
        fs::create_dir_all(&gui_bin).unwrap();
        let gui_path = std::env::join_paths([&gui_bin]).unwrap();
        let shell = Path::new("/private/secret-user/login-shell");

        let error = login_shell_path_value_with_runner(shell, &OversizedShellRunner).unwrap_err();
        let paths =
            search_path_directories_with_runner(Some(&gui_path), shell, &OversizedShellRunner);

        assert_eq!(error, LocalAgentError::ProbeOutputTooLarge);
        assert!(!error.reason().contains("secret-user"));
        assert_eq!(paths, vec![gui_bin]);
    }

    #[test]
    fn nonzero_login_shell_exit_is_sanitized_and_falls_back_to_gui_path() {
        let temp = tempdir().unwrap();
        let gui_bin = temp.path().join("gui-bin");
        fs::create_dir_all(&gui_bin).unwrap();
        let gui_path = std::env::join_paths([&gui_bin]).unwrap();
        let shell = Path::new("/private/secret-user/login-shell");
        let runner = ShellOutputRunner {
            success: false,
            stdout: temp.path().to_string_lossy().as_bytes().to_vec(),
            calls: Mutex::new(Vec::new()),
        };

        let error = login_shell_path_value_with_runner(shell, &runner).unwrap_err();
        let paths = search_path_directories_with_runner(Some(&gui_path), shell, &runner);

        assert_eq!(error, LocalAgentError::ProbeFailed);
        assert!(
            !error
                .reason()
                .contains(temp.path().to_string_lossy().as_ref())
        );
        assert_eq!(paths, vec![gui_bin]);
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
