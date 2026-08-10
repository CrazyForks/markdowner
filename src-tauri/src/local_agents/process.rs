use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    ffi::{CStr, OsStr, OsString},
    fmt,
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant as StdInstant},
};

#[cfg(unix)]
use std::os::unix::{
    fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    io::{AsRawFd, FromRawFd},
    process::CommandExt,
};

use sha2::{Digest, Sha256};
use tempfile::{Builder, TempDir};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command},
    sync::mpsc,
    task::JoinHandle,
    time::Instant as TokioInstant,
};
use tokio_util::sync::CancellationToken;

use super::{
    LocalAgentError, LocalAgentKind, adapters::AdapterInvocation, discovery::ExecutableProof,
};

pub(super) const MAX_PROCESS_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_PROCESS_STDIN_BYTES: usize = 8 * 1024 * 1024;
pub(super) const STDERR_TAIL_BYTES: usize = 64 * 1024;

const PROCESS_CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);
const PROCESS_GROUP_POLL_INTERVAL: Duration = Duration::from_millis(5);
const PROCESS_GROUP_ABSENCE_CONFIRMATION: Duration = Duration::from_millis(25);
const RESULT_FILE_MONITOR_INTERVAL: Duration = Duration::from_millis(5);
const OPENCODE_CONFIG_DIRECTORY: &str = "opencode-config";
const OPENCODE_CACHE_DIRECTORY: &str = "opencode-cache";
const OPENCODE_DATA_DIRECTORY: &str = "opencode-data";
const OPENCODE_STATE_DIRECTORY: &str = "opencode-state";
const OPENCODE_DATA_AGENT_DIRECTORY: &str = "opencode";
const OPENCODE_AUTH_FILE: &str = "auth.json";
const CODEX_HOME_DIRECTORY: &str = "codex-home";
const CODEX_AUTH_FILE: &str = "auth.json";
const MAX_AGENT_AUTH_BYTES: usize = 1024 * 1024;
const MAX_TEMP_CLEANUP_ENTRIES: usize = 16 * 1024;
const MAX_TEMP_CLEANUP_DEPTH: usize = 32;
const ALLOWED_INHERITED_ENVIRONMENT: &[&str] = &["HOME", "PATH", "LANG", "LC_ALL"];
const FINAL_COMMON_ENVIRONMENT: &[&str] = &["HOME", "LANG", "LC_ALL"];
const CLAUDE_ENVIRONMENT: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_WORKSPACE_ID",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "CLAUDE_CODE_CERT_STORE",
    "CLAUDE_CODE_CLIENT_CERT",
    "CLAUDE_CODE_CLIENT_KEY",
    "CLAUDE_CODE_CLIENT_KEY_PASSPHRASE",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_MANTLE",
    "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
    "CLAUDE_CODE_SKIP_MANTLE_AUTH",
    "AWS_REGION",
    "AWS_PROFILE",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_ROLE_ARN",
    "ANTHROPIC_BEDROCK_BASE_URL",
    "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
    "ANTHROPIC_BEDROCK_REGION_PREFIX",
    "ANTHROPIC_BEDROCK_SERVICE_TIER",
    "ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_SKIP_VERTEX_AUTH",
    "CLOUD_ML_REGION",
    "ANTHROPIC_VERTEX_PROJECT_ID",
    "GCLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "ANTHROPIC_VERTEX_BASE_URL",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
    "ANTHROPIC_FOUNDRY_API_KEY",
    "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
    "ANTHROPIC_FOUNDRY_RESOURCE",
    "ANTHROPIC_FOUNDRY_BASE_URL",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS",
    "ANTHROPIC_AWS_WORKSPACE_ID",
    "ANTHROPIC_AWS_API_KEY",
    "ANTHROPIC_AWS_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
];
const CODEX_ENVIRONMENT: &[&str] = &[
    "CODEX_API_KEY",
    "CODEX_ACCESS_TOKEN",
    "CODEX_CA_CERTIFICATE",
    "SSL_CERT_FILE",
];
const OPENCODE_ENVIRONMENT: &[&str] = &[
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "AWS_REGION",
    "AWS_PROFILE",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_ROLE_ARN",
    "AZURE_RESOURCE_NAME",
    "AZURE_COGNITIVE_SERVICES_RESOURCE_NAME",
    "DIGITALOCEAN_ACCESS_TOKEN",
    "AICORE_SERVICE_KEY",
    "AICORE_DEPLOYMENT_ID",
    "AICORE_RESOURCE_GROUP",
    "SNOWFLAKE_ACCOUNT",
    "SNOWFLAKE_CORTEX_TOKEN",
    "SNOWFLAKE_CORTEX_PAT",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENCODE_API_KEY",
];

#[cfg(unix)]
static LIVE_PROCESS_GROUPS: OnceLock<Mutex<ProcessGroupRegistry>> = OnceLock::new();

#[cfg(unix)]
#[derive(Default)]
struct ProcessGroupRegistry {
    process_groups: BTreeSet<i32>,
    rejected_cleanups: usize,
    active_operations: usize,
    shutting_down: bool,
}

#[cfg(unix)]
impl ProcessGroupRegistry {
    fn register(&mut self, process_group: i32) -> bool {
        if self.shutting_down || process_group <= 0 {
            return false;
        }
        self.process_groups.insert(process_group);
        true
    }

    fn unregister(&mut self, process_group: i32) {
        self.process_groups.remove(&process_group);
    }

    fn snapshot(&self) -> Vec<i32> {
        self.process_groups.iter().copied().collect()
    }

    fn begin_shutdown(&mut self) -> Vec<i32> {
        self.shutting_down = true;
        self.snapshot()
    }

    fn begin_rejected_cleanup(&mut self) {
        self.rejected_cleanups = self.rejected_cleanups.saturating_add(1);
    }

    fn finish_rejected_cleanup(&mut self) {
        self.rejected_cleanups = self.rejected_cleanups.saturating_sub(1);
    }

    fn begin_operation(&mut self) -> bool {
        if self.shutting_down {
            false
        } else {
            self.active_operations = self.active_operations.saturating_add(1);
            true
        }
    }

    fn finish_operation(&mut self) {
        self.active_operations = self.active_operations.saturating_sub(1);
    }

    fn is_idle(&self) -> bool {
        self.process_groups.is_empty() && self.rejected_cleanups == 0 && self.active_operations == 0
    }
}

pub(super) struct ProcessOutput {
    pub stdout: Vec<u8>,
    pub stderr_tail: Vec<u8>,
    pub result_file: Option<Vec<u8>>,
    temp_dir: Option<TempDir>,
    temp_identity: Option<FileIdentity>,
    temp_handle: Option<File>,
}

impl fmt::Debug for ProcessOutput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProcessOutput")
            .field("stdout_bytes", &self.stdout.len())
            .field("stderr_tail_bytes", &self.stderr_tail.len())
            .field(
                "result_file_bytes",
                &self.result_file.as_ref().map(Vec::len),
            )
            .finish()
    }
}

impl ProcessOutput {
    pub(super) fn close_temp_dir(&mut self) -> Result<(), LocalAgentError> {
        close_temp_dir(
            &mut self.temp_dir,
            self.temp_identity.as_ref(),
            &mut self.temp_handle,
        )
    }
}

impl Drop for ProcessOutput {
    fn drop(&mut self) {
        let _ = self.close_temp_dir();
    }
}

pub(super) fn create_owned_temp_dir() -> Result<TempDir, LocalAgentError> {
    let base = env::temp_dir().canonicalize().map_err(|_| {
        LocalAgentError::run(
            "local_agent_setup_failed",
            "The local agent could not be prepared.",
        )
    })?;
    let mut builder = Builder::new();
    builder.prefix("markdowner-local-agent-");
    #[cfg(unix)]
    builder.permissions(fs::Permissions::from_mode(0o700));
    let directory = builder.tempdir_in(base).map_err(|_| {
        LocalAgentError::run(
            "local_agent_setup_failed",
            "The local agent could not be prepared.",
        )
    })?;
    verify_owned_directory(directory.path())?;
    Ok(directory)
}

pub(super) struct OwnedProcessInvocation {
    invocation: AdapterInvocation,
    agent_kind: LocalAgentKind,
    temp_dir: Option<TempDir>,
    temp_identity: FileIdentity,
    temp_handle: Option<File>,
    executable_identity: FileIdentity,
    executable_proof: ExecutableProof,
    inherited_environment: BTreeMap<OsString, OsString>,
    _executable_handle: File,
    owned_files: Vec<OwnedFile>,
    owned_directories: Vec<OwnedDirectory>,
    retained_auth_sources: Vec<RetainedSourceFile>,
    result_path: Option<PathBuf>,
}

impl fmt::Debug for OwnedProcessInvocation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OwnedProcessInvocation")
            .field("argument_count", &self.invocation.args.len())
            .field("stdin_bytes", &self.invocation.stdin.len())
            .field("owned_file_count", &self.owned_files.len())
            .field("owned_directory_count", &self.owned_directories.len())
            .field(
                "retained_auth_source_count",
                &self.retained_auth_sources.len(),
            )
            .field("has_result_file", &self.result_path.is_some())
            .finish_non_exhaustive()
    }
}

impl OwnedProcessInvocation {
    pub(super) fn prepare(
        invocation: AdapterInvocation,
        temp_dir: TempDir,
        executable_proof: ExecutableProof,
        agent_kind: LocalAgentKind,
        cancellation: &CancellationToken,
        deadline: StdInstant,
    ) -> Result<Self, LocalAgentError> {
        Self::prepare_with_inherited_environment(
            invocation,
            temp_dir,
            executable_proof,
            agent_kind,
            cancellation,
            deadline,
            env::vars_os().collect(),
        )
    }

    fn prepare_with_inherited_environment(
        mut invocation: AdapterInvocation,
        temp_dir: TempDir,
        executable_proof: ExecutableProof,
        agent_kind: LocalAgentKind,
        cancellation: &CancellationToken,
        deadline: StdInstant,
        inherited_environment: BTreeMap<OsString, OsString>,
    ) -> Result<Self, LocalAgentError> {
        ensure_process_active(cancellation, deadline)?;
        if invocation.stdin.len() > MAX_PROCESS_STDIN_BYTES {
            return Err(LocalAgentError::run(
                "request_too_large",
                "The prepared local agent request is too large.",
            ));
        }
        let temp_path = temp_dir.path().to_path_buf();
        verify_owned_directory(&temp_path)?;
        if invocation.cwd != temp_path {
            return Err(LocalAgentError::run(
                "invalid_temp_directory",
                "The local agent temporary directory is invalid.",
            ));
        }
        invocation.cwd = temp_path.clone();
        let temp_handle = open_owned_directory(&temp_path)?;
        let temp_identity =
            FileIdentity::from_handle_and_path(&temp_handle, &temp_path, FileRole::OwnedDirectory)?;

        if !invocation.executable.is_absolute()
            || invocation.executable.canonicalize().ok().as_ref() != Some(&invocation.executable)
        {
            return Err(LocalAgentError::run(
                "invalid_executable",
                "The local agent executable is invalid.",
            ));
        }
        verify_executable_proof(
            &executable_proof,
            &invocation.executable,
            cancellation,
            deadline,
        )?;
        let executable_handle = open_no_follow(&invocation.executable, false)?;
        let executable_identity = FileIdentity::from_handle_and_path(
            &executable_handle,
            &invocation.executable,
            FileRole::Executable,
        )?;

        let result_path = invocation.result_file.clone();
        if let Some(path) = result_path.as_deref()
            && path.parent() != Some(temp_path.as_path())
        {
            return Err(LocalAgentError::run(
                "invalid_result_file",
                "The local agent result file is invalid.",
            ));
        }

        let mut owned_files = Vec::new();
        let mut owned_directories = Vec::new();
        let mut retained_auth_sources = Vec::new();
        let mut private_directory_paths = BTreeSet::new();
        if agent_kind == LocalAgentKind::Opencode {
            for name in [
                OPENCODE_CONFIG_DIRECTORY,
                OPENCODE_CACHE_DIRECTORY,
                OPENCODE_DATA_DIRECTORY,
                OPENCODE_STATE_DIRECTORY,
            ] {
                let path = temp_path.join(name);
                owned_directories.push(create_owned_directory(&path)?);
                private_directory_paths.insert(path);
            }
            let agent_data_path = temp_path
                .join(OPENCODE_DATA_DIRECTORY)
                .join(OPENCODE_DATA_AGENT_DIRECTORY);
            owned_directories.push(create_owned_directory(&agent_data_path)?);
            if let Some((source, auth_file)) = copy_auth_file(
                opencode_auth_source(&inherited_environment)?,
                &agent_data_path.join(OPENCODE_AUTH_FILE),
                cancellation,
                deadline,
            )? {
                retained_auth_sources.push(source);
                owned_files.push(auth_file);
            }
        } else if agent_kind == LocalAgentKind::Codex {
            let codex_home = temp_path.join(CODEX_HOME_DIRECTORY);
            owned_directories.push(create_owned_directory(&codex_home)?);
            private_directory_paths.insert(codex_home.clone());
            if let Some((source, auth_file)) = copy_auth_file(
                home_auth_source(&inherited_environment, &[".codex", CODEX_AUTH_FILE])?,
                &codex_home.join(CODEX_AUTH_FILE),
                cancellation,
                deadline,
            )? {
                retained_auth_sources.push(source);
                owned_files.push(auth_file);
            }
        }
        for entry in fs::read_dir(&temp_path).map_err(|_| {
            LocalAgentError::run(
                "invalid_temp_directory",
                "The local agent temporary directory is invalid.",
            )
        })? {
            let path = entry
                .map_err(|_| {
                    LocalAgentError::run(
                        "invalid_temp_directory",
                        "The local agent temporary directory is invalid.",
                    )
                })?
                .path();
            if private_directory_paths.contains(&path) {
                continue;
            }
            if path.parent() != Some(temp_path.as_path()) {
                return Err(LocalAgentError::run(
                    "invalid_temp_directory",
                    "The local agent temporary directory is invalid.",
                ));
            }
            let handle = open_no_follow(&path, true)?;
            let identity = FileIdentity::from_handle_and_path(&handle, &path, FileRole::OwnedFile)?;
            owned_files.push(OwnedFile {
                is_result: result_path.as_deref() == Some(path.as_path()),
                mutable_private: false,
                path,
                handle,
                identity,
            });
        }
        if result_path.is_some() && !owned_files.iter().any(|file| file.is_result) {
            return Err(LocalAgentError::run(
                "invalid_result_file",
                "The local agent result file is invalid.",
            ));
        }

        Ok(Self {
            invocation,
            agent_kind,
            temp_dir: Some(temp_dir),
            temp_identity,
            temp_handle: Some(temp_handle),
            executable_identity,
            executable_proof,
            inherited_environment,
            _executable_handle: executable_handle,
            owned_files,
            owned_directories,
            retained_auth_sources,
            result_path,
        })
    }

    fn verify_before_spawn(
        &self,
        cancellation: &CancellationToken,
        deadline: StdInstant,
    ) -> Result<(), LocalAgentError> {
        ensure_process_active(cancellation, deadline)?;
        self.temp_identity
            .verify_path(&self.invocation.cwd, FileRole::OwnedDirectory)?;
        self.executable_identity
            .verify_path(&self.invocation.executable, FileRole::Executable)?;
        verify_executable_proof(
            &self.executable_proof,
            &self.invocation.executable,
            cancellation,
            deadline,
        )?;
        for file in &self.owned_files {
            file.verify_identity()?;
        }
        for directory in &self.owned_directories {
            directory.verify_identity()?;
        }
        for source in &self.retained_auth_sources {
            source.verify_identity()?;
        }
        Ok(())
    }

    fn read_result_file(&mut self) -> Result<Option<Vec<u8>>, LocalAgentError> {
        let Some(file) = self.owned_files.iter_mut().find(|file| file.is_result) else {
            return Ok(None);
        };
        file.verify_identity()?;
        let size = file
            .handle
            .metadata()
            .map_err(|_| invalid_result_file())?
            .len();
        if size > MAX_PROCESS_OUTPUT_BYTES as u64 {
            return Err(LocalAgentError::run(
                "local_agent_output_too_large",
                "The local agent output exceeded the safe limit.",
            ));
        }
        file.handle
            .seek(SeekFrom::Start(0))
            .map_err(|_| invalid_result_file())?;
        let mut bytes = Vec::with_capacity((size as usize).min(MAX_PROCESS_OUTPUT_BYTES));
        Read::by_ref(&mut file.handle)
            .take((MAX_PROCESS_OUTPUT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| invalid_result_file())?;
        if bytes.len() > MAX_PROCESS_OUTPUT_BYTES {
            return Err(LocalAgentError::run(
                "local_agent_output_too_large",
                "The local agent output exceeded the safe limit.",
            ));
        }
        if bytes.len() as u64 != size {
            return Err(invalid_result_file());
        }
        file.verify_identity()?;
        if file
            .handle
            .metadata()
            .map_err(|_| invalid_result_file())?
            .len()
            != size
        {
            return Err(invalid_result_file());
        }
        Ok(Some(bytes))
    }

    fn close_temp_dir(&mut self) -> Result<(), LocalAgentError> {
        close_temp_dir(
            &mut self.temp_dir,
            Some(&self.temp_identity),
            &mut self.temp_handle,
        )
    }
}

impl Drop for OwnedProcessInvocation {
    fn drop(&mut self) {
        let _ = self.close_temp_dir();
    }
}

fn close_temp_dir(
    temp_dir: &mut Option<TempDir>,
    identity: Option<&FileIdentity>,
    directory_handle: &mut Option<File>,
) -> Result<(), LocalAgentError> {
    let Some(directory) = temp_dir.take() else {
        return Ok(());
    };
    let path = directory.path().to_path_buf();
    if let Some(identity) = identity {
        let Some(handle) = directory_handle.as_ref() else {
            let _ = directory.keep();
            return Err(process_cleanup_error());
        };
        if let Err(error) = identity.verify_owned_directory_for_deletion(handle, &path) {
            let _ = directory.keep();
            return Err(error);
        }
    }
    if fs::remove_dir_all(&path).is_ok() {
        let _ = directory.keep();
        directory_handle.take();
        return Ok(());
    }

    if let Some(identity) = identity {
        let Some(handle) = directory_handle.as_ref() else {
            let _ = directory.keep();
            return Err(process_cleanup_error());
        };
        if identity
            .verify_owned_directory_for_deletion(handle, &path)
            .is_err()
        {
            let _ = directory.keep();
            return Err(temp_cleanup_error());
        }
        #[cfg(unix)]
        if unsafe { libc::fchmod(handle.as_raw_fd(), 0o700) } != 0
            || identity
                .verify_owned_directory_for_deletion(handle, &path)
                .is_err()
        {
            let _ = directory.keep();
            return Err(temp_cleanup_error());
        }
        #[cfg(unix)]
        if repair_owned_temp_tree(handle).is_err()
            || identity
                .verify_owned_directory_for_deletion(handle, &path)
                .is_err()
        {
            let _ = directory.keep();
            return Err(temp_cleanup_error());
        }
    }
    if fs::remove_dir_all(&path).is_err() {
        let _ = directory.keep();
        return Err(temp_cleanup_error());
    }
    let _ = directory.keep();
    directory_handle.take();
    Ok(())
}

fn temp_cleanup_error() -> LocalAgentError {
    LocalAgentError::run(
        "local_agent_cleanup_failed",
        "The local agent temporary directory could not be removed.",
    )
}

#[cfg(unix)]
fn repair_owned_temp_tree(root: &File) -> Result<(), LocalAgentError> {
    let mut remaining_entries = MAX_TEMP_CLEANUP_ENTRIES;
    repair_owned_directory_entries(root.as_raw_fd(), 0, &mut remaining_entries)
}

#[cfg(unix)]
fn repair_owned_directory_entries(
    directory_fd: std::os::fd::RawFd,
    depth: usize,
    remaining_entries: &mut usize,
) -> Result<(), LocalAgentError> {
    if depth > MAX_TEMP_CLEANUP_DEPTH {
        return Err(process_cleanup_error());
    }
    let duplicate = unsafe { libc::fcntl(directory_fd, libc::F_DUPFD_CLOEXEC, 0) };
    if duplicate < 0 {
        return Err(process_cleanup_error());
    }
    let stream = unsafe { libc::fdopendir(duplicate) };
    if stream.is_null() {
        unsafe {
            libc::close(duplicate);
        }
        return Err(process_cleanup_error());
    }

    let result = (|| {
        loop {
            let entry = unsafe { libc::readdir(stream) };
            if entry.is_null() {
                break;
            }
            let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
            if name.to_bytes() == b"." || name.to_bytes() == b".." {
                continue;
            }
            let Some(next_remaining) = remaining_entries.checked_sub(1) else {
                return Err(process_cleanup_error());
            };
            *remaining_entries = next_remaining;

            let mut captured = std::mem::MaybeUninit::<libc::stat>::uninit();
            if unsafe {
                libc::fstatat(
                    directory_fd,
                    name.as_ptr(),
                    captured.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            } != 0
            {
                return Err(process_cleanup_error());
            }
            let captured = unsafe { captured.assume_init() };
            if captured.st_mode & libc::S_IFMT != libc::S_IFDIR {
                continue;
            }
            if captured.st_uid != unsafe { libc::geteuid() }
                || unsafe {
                    libc::fchmodat(
                        directory_fd,
                        name.as_ptr(),
                        0o700,
                        libc::AT_SYMLINK_NOFOLLOW,
                    )
                } != 0
            {
                return Err(process_cleanup_error());
            }

            let child_fd = unsafe {
                libc::openat(
                    directory_fd,
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if child_fd < 0 {
                return Err(process_cleanup_error());
            }
            let child = unsafe { File::from_raw_fd(child_fd) };
            let mut opened = std::mem::MaybeUninit::<libc::stat>::uninit();
            if unsafe { libc::fstat(child.as_raw_fd(), opened.as_mut_ptr()) } != 0 {
                return Err(process_cleanup_error());
            }
            let opened = unsafe { opened.assume_init() };
            if opened.st_dev != captured.st_dev
                || opened.st_ino != captured.st_ino
                || opened.st_uid != captured.st_uid
                || opened.st_mode & libc::S_IFMT != libc::S_IFDIR
                || unsafe { libc::fchmod(child.as_raw_fd(), 0o700) } != 0
            {
                return Err(process_cleanup_error());
            }
            repair_owned_directory_entries(child.as_raw_fd(), depth + 1, remaining_entries)?;
        }
        Ok(())
    })();
    unsafe {
        libc::closedir(stream);
    }
    result
}

struct OwnedFile {
    path: PathBuf,
    handle: File,
    identity: FileIdentity,
    is_result: bool,
    mutable_private: bool,
}

struct OwnedDirectory {
    path: PathBuf,
    handle: File,
    identity: FileIdentity,
}

impl OwnedDirectory {
    fn verify_identity(&self) -> Result<(), LocalAgentError> {
        self.identity
            .verify_handle_and_path(&self.handle, &self.path, FileRole::OwnedDirectory)
    }
}

fn create_owned_directory(path: &Path) -> Result<OwnedDirectory, LocalAgentError> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    builder.mode(0o700);
    builder.create(path).map_err(|_| {
        LocalAgentError::run(
            "local_agent_setup_failed",
            "The local agent could not be prepared.",
        )
    })?;
    let handle = open_owned_directory(path)?;
    let identity = FileIdentity::from_handle_and_path(&handle, path, FileRole::OwnedDirectory)?;
    Ok(OwnedDirectory {
        path: path.to_path_buf(),
        handle,
        identity,
    })
}

struct RetainedSourceFile {
    path: PathBuf,
    handle: File,
    identity: FileIdentity,
    content_sha256: [u8; 32],
}

impl RetainedSourceFile {
    fn verify_identity(&self) -> Result<(), LocalAgentError> {
        self.identity
            .verify_handle_and_path(&self.handle, &self.path, FileRole::OwnedFile)
            .map_err(|_| invalid_environment_error())?;
        let mut handle = self
            .handle
            .try_clone()
            .map_err(|_| invalid_environment_error())?;
        handle
            .seek(SeekFrom::Start(0))
            .map_err(|_| invalid_environment_error())?;
        let mut bytes = Vec::new();
        Read::by_ref(&mut handle)
            .take((MAX_AGENT_AUTH_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| invalid_environment_error())?;
        let matches = bytes.len() <= MAX_AGENT_AUTH_BYTES
            && <[u8; 32]>::from(Sha256::digest(&bytes)) == self.content_sha256;
        bytes.fill(0);
        if matches {
            Ok(())
        } else {
            Err(invalid_environment_error())
        }
    }
}

fn copy_auth_file(
    source: Option<PathBuf>,
    destination: &Path,
    cancellation: &CancellationToken,
    deadline: StdInstant,
) -> Result<Option<(RetainedSourceFile, OwnedFile)>, LocalAgentError> {
    let Some(source) = source else {
        return Ok(None);
    };
    match fs::symlink_metadata(&source) {
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(invalid_environment_error()),
        Ok(_) => {}
    }
    ensure_process_active(cancellation, deadline)?;
    let mut source_handle =
        open_no_follow(&source, false).map_err(|_| invalid_environment_error())?;
    let source_identity =
        FileIdentity::from_handle_and_path(&source_handle, &source, FileRole::OwnedFile)
            .map_err(|_| invalid_environment_error())?;
    let source_size = source_handle
        .metadata()
        .map_err(|_| invalid_environment_error())?
        .len();
    if source_size > MAX_AGENT_AUTH_BYTES as u64 {
        return Err(invalid_environment_error());
    }
    let mut bytes = Vec::with_capacity(source_size as usize);
    Read::by_ref(&mut source_handle)
        .take((MAX_AGENT_AUTH_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid_environment_error())?;
    if bytes.len() > MAX_AGENT_AUTH_BYTES
        || bytes.len() as u64 != source_size
        || source_handle
            .metadata()
            .map_err(|_| invalid_environment_error())?
            .len()
            != source_size
    {
        return Err(invalid_environment_error());
    }
    if bytes.contains(&0)
        || !serde_json::from_slice::<serde_json::Value>(&bytes).is_ok_and(|value| value.is_object())
    {
        bytes.fill(0);
        return Err(invalid_environment_error());
    }
    source_identity
        .verify_handle_and_path(&source_handle, &source, FileRole::OwnedFile)
        .map_err(|_| invalid_environment_error())?;
    ensure_process_active(cancellation, deadline)?;
    let source_sha256 = <[u8; 32]>::from(Sha256::digest(&bytes));

    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    options
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let mut handle = options.open(destination).map_err(|_| {
        LocalAgentError::run(
            "local_agent_setup_failed",
            "The local agent could not be prepared.",
        )
    })?;
    handle
        .write_all(&bytes)
        .and_then(|()| handle.sync_all())
        .map_err(|_| {
            LocalAgentError::run(
                "local_agent_setup_failed",
                "The local agent could not be prepared.",
            )
        })?;
    bytes.fill(0);
    let identity = FileIdentity::from_handle_and_path(&handle, destination, FileRole::OwnedFile)?;
    ensure_process_active(cancellation, deadline)?;
    Ok(Some((
        RetainedSourceFile {
            path: source,
            handle: source_handle,
            identity: source_identity,
            content_sha256: source_sha256,
        },
        OwnedFile {
            path: destination.to_path_buf(),
            handle,
            identity,
            is_result: false,
            mutable_private: true,
        },
    )))
}

fn home_auth_source(
    inherited: &BTreeMap<OsString, OsString>,
    components: &[&str],
) -> Result<Option<PathBuf>, LocalAgentError> {
    let Some(home) = inherited.get(OsStr::new("HOME")) else {
        return Ok(None);
    };
    let home = PathBuf::from(normalized_safe_home(home)?);
    Ok(Some(
        components
            .iter()
            .fold(home, |path, component| path.join(component)),
    ))
}

fn opencode_auth_source(
    inherited: &BTreeMap<OsString, OsString>,
) -> Result<Option<PathBuf>, LocalAgentError> {
    if let Some(data_home) = inherited.get(OsStr::new("XDG_DATA_HOME")) {
        let data_home = PathBuf::from(normalized_safe_home(data_home)?);
        return Ok(Some(
            data_home
                .join(OPENCODE_DATA_AGENT_DIRECTORY)
                .join(OPENCODE_AUTH_FILE),
        ));
    }
    home_auth_source(
        inherited,
        &[".local", "share", "opencode", OPENCODE_AUTH_FILE],
    )
}

impl OwnedFile {
    fn verify_identity(&self) -> Result<(), LocalAgentError> {
        self.identity
            .verify_handle_and_path(&self.handle, &self.path, FileRole::OwnedFile)
            .map_err(|_| {
                if self.is_result {
                    invalid_result_file()
                } else {
                    LocalAgentError::run(
                        "invalid_temp_file",
                        "A local agent temporary file is invalid.",
                    )
                }
            })
    }
}

#[derive(Debug, Clone, Copy)]
enum FileRole {
    Executable,
    OwnedDirectory,
    OwnedFile,
}

#[derive(Clone)]
struct FileIdentity {
    canonical_path: PathBuf,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(unix)]
    owner: u32,
    #[cfg(unix)]
    mode: u32,
}

impl FileIdentity {
    fn from_path(path: &Path, role: FileRole) -> Result<Self, LocalAgentError> {
        let metadata = fs::symlink_metadata(path).map_err(|_| identity_error(role))?;
        Self::from_metadata(path, &metadata, role)
    }

    fn from_handle_and_path(
        handle: &File,
        path: &Path,
        role: FileRole,
    ) -> Result<Self, LocalAgentError> {
        let path_metadata = fs::symlink_metadata(path).map_err(|_| identity_error(role))?;
        let handle_metadata = handle.metadata().map_err(|_| identity_error(role))?;
        let identity = Self::from_metadata(path, &path_metadata, role)?;
        if !identity.matches_metadata(&handle_metadata, role) {
            return Err(identity_error(role));
        }
        Ok(identity)
    }

    fn from_metadata(
        path: &Path,
        metadata: &fs::Metadata,
        role: FileRole,
    ) -> Result<Self, LocalAgentError> {
        if metadata.file_type().is_symlink()
            || matches!(role, FileRole::OwnedDirectory) != metadata.is_dir()
            || !matches!(role, FileRole::OwnedDirectory) && !metadata.is_file()
        {
            return Err(identity_error(role));
        }
        let canonical_path = path.canonicalize().map_err(|_| identity_error(role))?;
        if canonical_path != path {
            return Err(identity_error(role));
        }
        #[cfg(unix)]
        {
            let mode = metadata.mode();
            match role {
                FileRole::Executable if mode & 0o111 == 0 => {
                    return Err(identity_error(role));
                }
                FileRole::OwnedDirectory
                    if mode & 0o777 != 0o700 || metadata.uid() != unsafe { libc::geteuid() } =>
                {
                    return Err(identity_error(role));
                }
                FileRole::OwnedFile
                    if mode & 0o077 != 0
                        || metadata.uid() != unsafe { libc::geteuid() }
                        || metadata.nlink() != 1 =>
                {
                    return Err(identity_error(role));
                }
                _ => {}
            }
            Ok(Self {
                canonical_path,
                device: metadata.dev(),
                inode: metadata.ino(),
                owner: metadata.uid(),
                mode,
            })
        }
        #[cfg(not(unix))]
        {
            Ok(Self { canonical_path })
        }
    }

    fn verify_path(&self, path: &Path, role: FileRole) -> Result<(), LocalAgentError> {
        let metadata = fs::symlink_metadata(path).map_err(|_| identity_error(role))?;
        if path.canonicalize().ok().as_ref() != Some(&self.canonical_path)
            || !self.matches_metadata(&metadata, role)
        {
            return Err(identity_error(role));
        }
        Ok(())
    }

    fn verify_handle_and_path(
        &self,
        handle: &File,
        path: &Path,
        role: FileRole,
    ) -> Result<(), LocalAgentError> {
        self.verify_path(path, role)?;
        let metadata = handle.metadata().map_err(|_| identity_error(role))?;
        if !self.matches_metadata(&metadata, role) {
            return Err(identity_error(role));
        }
        Ok(())
    }

    fn verify_owned_directory_for_deletion(
        &self,
        handle: &File,
        path: &Path,
    ) -> Result<(), LocalAgentError> {
        let metadata =
            fs::symlink_metadata(path).map_err(|_| identity_error(FileRole::OwnedDirectory))?;
        let handle_metadata = handle
            .metadata()
            .map_err(|_| identity_error(FileRole::OwnedDirectory))?;
        if path.canonicalize().ok().as_ref() != Some(&self.canonical_path)
            || !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || !handle_metadata.is_dir()
        {
            return Err(identity_error(FileRole::OwnedDirectory));
        }
        #[cfg(unix)]
        if self.device != metadata.dev()
            || self.inode != metadata.ino()
            || self.owner != metadata.uid()
            || self.device != handle_metadata.dev()
            || self.inode != handle_metadata.ino()
            || self.owner != handle_metadata.uid()
        {
            return Err(identity_error(FileRole::OwnedDirectory));
        }
        Ok(())
    }

    fn matches_metadata(&self, metadata: &fs::Metadata, role: FileRole) -> bool {
        if metadata.file_type().is_symlink()
            || matches!(role, FileRole::OwnedDirectory) != metadata.is_dir()
            || !matches!(role, FileRole::OwnedDirectory) && !metadata.is_file()
        {
            return false;
        }
        #[cfg(unix)]
        {
            let mode = metadata.mode();
            self.device == metadata.dev()
                && self.inode == metadata.ino()
                && self.owner == metadata.uid()
                && self.mode == mode
                && (!matches!(role, FileRole::OwnedFile) || metadata.nlink() == 1)
        }
        #[cfg(not(unix))]
        {
            true
        }
    }
}

fn verify_owned_directory(path: &Path) -> Result<(), LocalAgentError> {
    FileIdentity::from_path(path, FileRole::OwnedDirectory).map(|_| ())
}

fn identity_error(role: FileRole) -> LocalAgentError {
    match role {
        FileRole::Executable => LocalAgentError::run(
            "invalid_executable",
            "The local agent executable is invalid.",
        ),
        FileRole::OwnedDirectory => LocalAgentError::run(
            "invalid_temp_directory",
            "The local agent temporary directory is invalid.",
        ),
        FileRole::OwnedFile => LocalAgentError::run(
            "invalid_temp_file",
            "A local agent temporary file is invalid.",
        ),
    }
}

fn invalid_result_file() -> LocalAgentError {
    LocalAgentError::run(
        "invalid_result_file",
        "The local agent result file is invalid.",
    )
}

fn verify_executable_proof(
    proof: &ExecutableProof,
    path: &Path,
    cancellation: &CancellationToken,
    deadline: StdInstant,
) -> Result<(), LocalAgentError> {
    proof
        .verify_path_with_constraints(path, Some(cancellation), Some(deadline))
        .map_err(|_| {
            if cancellation.is_cancelled() {
                cancelled_error()
            } else if StdInstant::now() >= deadline {
                timeout_error()
            } else {
                identity_error(FileRole::Executable)
            }
        })
}

fn open_no_follow(path: &Path, write: bool) -> Result<File, LocalAgentError> {
    let mut options = OpenOptions::new();
    options.read(true).write(write);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    options
        .open(path)
        .map_err(|_| LocalAgentError::run("invalid_temp_file", "A local agent file is invalid."))
}

fn open_owned_directory(path: &Path) -> Result<File, LocalAgentError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
    options.open(path).map_err(|_| {
        LocalAgentError::run(
            "invalid_temp_directory",
            "The local agent temporary directory is invalid.",
        )
    })
}

pub(super) fn controlled_environment(
    inherited: BTreeMap<OsString, OsString>,
    overrides: &[(OsString, OsString)],
    cwd: &Path,
) -> Result<BTreeMap<OsString, OsString>, LocalAgentError> {
    let mut environment = BTreeMap::new();
    for name in ALLOWED_INHERITED_ENVIRONMENT {
        let name = OsString::from(name);
        if let Some(value) = inherited.get(&name) {
            let value = match name.to_str() {
                Some("PATH") => normalized_safe_path(value)?,
                Some("HOME") => normalized_safe_home(value)?,
                _ => value.clone(),
            };
            environment.insert(name, value);
        }
    }
    environment.insert(OsString::from("TMPDIR"), cwd.as_os_str().to_owned());
    environment.insert(OsString::from("PWD"), cwd.as_os_str().to_owned());
    for (name, value) in overrides {
        if !valid_environment_name(name) {
            return Err(LocalAgentError::run(
                "invalid_environment",
                "The local agent environment is invalid.",
            ));
        }
        let value = match name.to_str() {
            Some("PATH") => normalized_safe_path(value)?,
            Some("HOME") => normalized_safe_home(value)?,
            _ => value.clone(),
        };
        environment.insert(name.clone(), value);
    }
    Ok(environment)
}

fn controlled_environment_for_agent(
    inherited: BTreeMap<OsString, OsString>,
    overrides: &[(OsString, OsString)],
    cwd: &Path,
    agent_kind: LocalAgentKind,
    proof_environment_path: &OsStr,
) -> Result<BTreeMap<OsString, OsString>, LocalAgentError> {
    let mut environment = BTreeMap::new();
    for name in FINAL_COMMON_ENVIRONMENT
        .iter()
        .chain(agent_environment_allowlist(agent_kind))
    {
        let name = OsString::from(name);
        if let Some(value) = inherited.get(&name) {
            if value.is_empty() && name != OsStr::new("HOME") {
                continue;
            }
            let value = if name == OsStr::new("HOME") {
                normalized_safe_home(value)?
            } else {
                value.clone()
            };
            environment.insert(name, value);
        }
    }
    environment.insert(
        OsString::from("PATH"),
        normalized_safe_path(proof_environment_path)?,
    );
    environment.insert(OsString::from("TMPDIR"), cwd.as_os_str().to_owned());
    environment.insert(OsString::from("PWD"), cwd.as_os_str().to_owned());
    for (name, value) in overrides {
        if !valid_environment_name(name) || protected_final_environment_name(name) {
            return Err(invalid_environment_error());
        }
        environment.insert(name.clone(), value.clone());
    }
    if agent_kind == LocalAgentKind::Claude {
        for (skip_auth, use_provider, provider_base) in [
            (
                "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
                "CLAUDE_CODE_USE_BEDROCK",
                "ANTHROPIC_BEDROCK_BASE_URL",
            ),
            (
                "CLAUDE_CODE_SKIP_MANTLE_AUTH",
                "CLAUDE_CODE_USE_MANTLE",
                "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
            ),
            (
                "CLAUDE_CODE_SKIP_VERTEX_AUTH",
                "CLAUDE_CODE_USE_VERTEX",
                "ANTHROPIC_VERTEX_BASE_URL",
            ),
            (
                "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
                "CLAUDE_CODE_USE_FOUNDRY",
                "ANTHROPIC_FOUNDRY_BASE_URL",
            ),
        ] {
            if !environment_switch_enabled(&environment, use_provider)
                || !environment_value_is_nonempty(&environment, provider_base)
            {
                environment.remove(OsStr::new(skip_auth));
            }
        }
        if ![
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_BEDROCK_BASE_URL",
            "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
            "ANTHROPIC_VERTEX_BASE_URL",
            "ANTHROPIC_FOUNDRY_BASE_URL",
            "ANTHROPIC_AWS_BASE_URL",
        ]
        .iter()
        .any(|name| {
            environment
                .get(OsStr::new(name))
                .is_some_and(|value| !value.is_empty())
        }) {
            environment.remove(OsStr::new("ANTHROPIC_CUSTOM_HEADERS"));
        }
        environment.insert(
            OsString::from("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB"),
            OsString::from("1"),
        );
        environment.insert(
            OsString::from("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"),
            OsString::from("1"),
        );
    } else if agent_kind == LocalAgentKind::Codex {
        environment.insert(
            OsString::from("CODEX_HOME"),
            cwd.join(CODEX_HOME_DIRECTORY).into_os_string(),
        );
    } else if agent_kind == LocalAgentKind::Opencode {
        for (name, directory) in [
            ("XDG_CONFIG_HOME", OPENCODE_CONFIG_DIRECTORY),
            ("XDG_CACHE_HOME", OPENCODE_CACHE_DIRECTORY),
            ("XDG_DATA_HOME", OPENCODE_DATA_DIRECTORY),
            ("XDG_STATE_HOME", OPENCODE_STATE_DIRECTORY),
        ] {
            environment.insert(OsString::from(name), cwd.join(directory).into_os_string());
        }
        environment.insert(
            OsString::from("OPENCODE_DISABLE_CLAUDE_CODE"),
            OsString::from("1"),
        );
        environment.insert(
            OsString::from("OPENCODE_DISABLE_DEFAULT_PLUGINS"),
            OsString::from("true"),
        );
    }
    Ok(environment)
}

fn environment_value_is_nonempty(environment: &BTreeMap<OsString, OsString>, name: &str) -> bool {
    environment
        .get(OsStr::new(name))
        .is_some_and(|value| !value.is_empty())
}

fn environment_switch_enabled(environment: &BTreeMap<OsString, OsString>, name: &str) -> bool {
    let Some(value) = environment
        .get(OsStr::new(name))
        .and_then(|value| value.to_str())
    else {
        return false;
    };
    let value = value.trim();
    !value.is_empty()
        && !["0", "false", "no", "off"]
            .iter()
            .any(|disabled| value.eq_ignore_ascii_case(disabled))
}

fn agent_environment_allowlist(agent_kind: LocalAgentKind) -> &'static [&'static str] {
    match agent_kind {
        LocalAgentKind::Claude => CLAUDE_ENVIRONMENT,
        LocalAgentKind::Codex => CODEX_ENVIRONMENT,
        LocalAgentKind::Opencode => OPENCODE_ENVIRONMENT,
    }
}

fn protected_final_environment_name(name: &OsStr) -> bool {
    matches!(
        name.to_str(),
        Some(
            "HOME"
                | "PATH"
                | "TMPDIR"
                | "PWD"
                | "NODE_OPTIONS"
                | "BUN_OPTIONS"
                | "NODE_TLS_REJECT_UNAUTHORIZED"
                | "BASH_ENV"
                | "ENV"
                | "LD_PRELOAD"
                | "CODEX_HOME"
                | "SQLITE_HOME"
                | "CODEX_SQLITE_HOME"
                | "CLAUDE_CONFIG_DIR"
                | "OPENCODE_CONFIG"
                | "OPENCODE_CONFIG_DIR"
                | "XDG_CONFIG_HOME"
                | "XDG_CACHE_HOME"
                | "XDG_DATA_HOME"
                | "XDG_STATE_HOME"
                | "OPENCODE_DISABLE_CLAUDE_CODE"
                | "OPENCODE_DISABLE_DEFAULT_PLUGINS"
                | "EDITOR"
                | "VISUAL"
                | "PAGER"
                | "GIT_PAGER"
                | "BROWSER"
        )
    ) || name.to_str().is_some_and(|name| name.starts_with("DYLD_"))
}

fn normalized_safe_path(value: &OsStr) -> Result<OsString, LocalAgentError> {
    let mut seen = BTreeSet::new();
    let mut safe_directories = Vec::new();
    for directory in env::split_paths(value) {
        let Some(canonical) = canonical_safe_directory(&directory, false) else {
            continue;
        };
        if seen.insert(canonical.clone()) {
            safe_directories.push(canonical);
        }
    }
    if safe_directories.is_empty() {
        return Err(LocalAgentError::run(
            "invalid_environment",
            "The local agent environment is invalid.",
        ));
    }
    env::join_paths(safe_directories).map_err(|_| {
        LocalAgentError::run(
            "invalid_environment",
            "The local agent environment is invalid.",
        )
    })
}

fn normalized_safe_home(value: &OsStr) -> Result<OsString, LocalAgentError> {
    canonical_safe_directory(Path::new(value), true)
        .map(PathBuf::into_os_string)
        .ok_or_else(invalid_environment_error)
}

fn canonical_safe_directory(path: &Path, require_current_owner: bool) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let canonical = path.canonicalize().ok()?;
    for (index, ancestor) in canonical.ancestors().enumerate() {
        let metadata = fs::metadata(ancestor).ok()?;
        if !metadata.is_dir() {
            return None;
        }
        #[cfg(unix)]
        {
            let effective_user = unsafe { libc::geteuid() };
            if (index == 0 && require_current_owner && metadata.uid() != effective_user)
                || (metadata.uid() != 0 && metadata.uid() != effective_user)
                || metadata.mode() & 0o022 != 0
            {
                return None;
            }
        }
    }
    Some(canonical)
}

fn invalid_environment_error() -> LocalAgentError {
    LocalAgentError::run(
        "invalid_environment",
        "The local agent environment is invalid.",
    )
}

fn valid_environment_name(name: &OsStr) -> bool {
    !name.is_empty() && !name.as_encoded_bytes().contains(&b'=')
}

#[derive(Debug, Clone, Copy)]
enum StreamFault {
    OutputTooLarge,
    Io,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StdinWriteOutcome {
    Complete,
    BrokenPipe,
}

pub(super) async fn run_process(
    mut owned: OwnedProcessInvocation,
    cancellation: CancellationToken,
    deadline: StdInstant,
) -> Result<ProcessOutput, LocalAgentError> {
    let result = run_process_inner(&mut owned, cancellation, deadline).await;
    match result {
        Err(error) => match owned.close_temp_dir() {
            Ok(()) => Err(error),
            Err(cleanup_error) => Err(cleanup_error),
        },
        Ok(mut output) => {
            output.temp_dir = owned.temp_dir.take();
            output.temp_identity = Some(owned.temp_identity.clone());
            output.temp_handle = owned.temp_handle.take();
            Ok(output)
        }
    }
}

async fn run_process_inner(
    owned: &mut OwnedProcessInvocation,
    cancellation: CancellationToken,
    absolute_deadline: StdInstant,
) -> Result<ProcessOutput, LocalAgentError> {
    ensure_process_active(&cancellation, absolute_deadline)?;
    owned.verify_before_spawn(&cancellation, absolute_deadline)?;
    let mut inherited = std::mem::take(&mut owned.inherited_environment);
    inherited.insert(
        OsString::from("PATH"),
        owned.executable_proof.environment_path().to_owned(),
    );
    let environment = controlled_environment_for_agent(
        inherited,
        &owned.invocation.env,
        &owned.invocation.cwd,
        owned.agent_kind,
        owned.executable_proof.environment_path(),
    )?;
    ensure_process_active(&cancellation, absolute_deadline)?;
    let mut command = Command::new(&owned.invocation.executable);
    command
        .args(&owned.invocation.args)
        .current_dir(&owned.invocation.cwd)
        .env_clear()
        .envs(environment)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        command.as_std_mut().process_group(0);
        unsafe {
            command
                .as_std_mut()
                .pre_exec(configure_child_file_size_limit);
        }
    }

    let mut child = command.spawn().map_err(|_| {
        LocalAgentError::run(
            "local_agent_spawn_failed",
            "The local agent could not be started.",
        )
    })?;
    let process_group_id = child_process_group_id(&child)?;
    let mut process_group = match RegisteredProcessGroup::register(process_group_id) {
        Ok(process_group) => process_group,
        Err(mut rejected) => {
            kill_unregistered_group_and_reap(&mut child, &mut rejected).await?;
            drop(rejected);
            return Err(cancelled_error());
        }
    };
    if let Err(error) = verify_executable_proof(
        &owned.executable_proof,
        &owned.invocation.executable,
        &cancellation,
        absolute_deadline,
    ) {
        let cleanup = terminate_and_reap(&mut child, &mut process_group).await;
        cleanup?;
        return Err(error);
    }
    owned.retained_auth_sources.clear();
    let (stdin, stdout, stderr) =
        take_child_pipes_or_cleanup(&mut child, &mut process_group).await?;
    let stdin_bytes = std::mem::take(&mut owned.invocation.stdin);
    let (fault_sender, mut fault_receiver) = mpsc::unbounded_channel();
    let _fault_sender_guard = fault_sender.clone();
    let mut stdin_task = Some(tokio::spawn(write_stdin(
        stdin,
        stdin_bytes,
        fault_sender.clone(),
    )));
    let mut stdout_task = Some(tokio::spawn(read_capped(
        stdout,
        MAX_PROCESS_OUTPUT_BYTES,
        fault_sender.clone(),
    )));
    let mut stderr_task = Some(tokio::spawn(read_capped(
        stderr,
        STDERR_TAIL_BYTES,
        fault_sender,
    )));
    let deadline = TokioInstant::from_std(absolute_deadline);
    let mut result_monitor = Box::pin(monitor_result_file(
        owned.owned_files.iter().find(|file| file.is_result),
    ));

    let status = tokio::select! {
        biased;
        _ = cancellation.cancelled() => {
            let cleanup = terminate_and_reap(&mut child, &mut process_group).await;
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            cleanup?;
            return Err(cancelled_error());
        }
        _ = tokio::time::sleep_until(deadline) => {
            let cleanup = terminate_and_reap(&mut child, &mut process_group).await;
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            cleanup?;
            return Err(timeout_error());
        }
        result_error = &mut result_monitor => {
            let cleanup = terminate_and_reap(&mut child, &mut process_group).await;
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            cleanup?;
            return Err(result_error);
        }
        fault = fault_receiver.recv() => {
            let cleanup = terminate_and_reap(&mut child, &mut process_group).await;
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            cleanup?;
            return Err(stream_fault_error(fault.unwrap_or(StreamFault::Io)));
        }
        status = child.wait() => match status {
            Ok(status) => status,
            Err(_) => {
                let cleanup = terminate_and_reap(&mut child, &mut process_group).await;
                abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
                cleanup?;
                return Err(io_error());
            }
        },
    };
    drop(result_monitor);

    if let Err(error) = terminate_process_group(&mut process_group).await {
        abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
        return Err(error);
    }
    if cancellation.is_cancelled() {
        abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
        return Err(cancelled_error());
    }
    if TokioInstant::now() >= deadline {
        abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
        return Err(timeout_error());
    }
    if let Ok(fault) = fault_receiver.try_recv() {
        abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
        return Err(stream_fault_error(fault));
    }

    let stdin_outcome = match await_stream_task(&mut stdin_task, deadline, &cancellation).await {
        Ok(outcome) => outcome,
        Err(error) => {
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            return Err(error);
        }
    };
    let stdout = match await_stream_task(&mut stdout_task, deadline, &cancellation).await {
        Ok(stdout) => stdout,
        Err(error) => {
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            return Err(error);
        }
    };
    let stderr_tail = match await_stream_task(&mut stderr_task, deadline, &cancellation).await {
        Ok(stderr) => stderr,
        Err(error) => {
            abort_stream_tasks(&mut stdin_task, &mut stdout_task, &mut stderr_task).await;
            return Err(error);
        }
    };

    if cancellation.is_cancelled() {
        return Err(cancelled_error());
    }
    if TokioInstant::now() >= deadline {
        return Err(timeout_error());
    }
    if !status.success() {
        return Err(LocalAgentError::run(
            "local_agent_failed",
            "The local agent did not complete successfully.",
        ));
    }
    if stdin_outcome == StdinWriteOutcome::BrokenPipe {
        return Err(io_error());
    }
    owned
        .temp_identity
        .verify_path(&owned.invocation.cwd, FileRole::OwnedDirectory)?;
    for file in owned
        .owned_files
        .iter()
        .filter(|file| !file.mutable_private)
    {
        file.verify_identity()?;
    }
    for directory in &owned.owned_directories {
        directory.verify_identity()?;
    }
    if cancellation.is_cancelled() {
        return Err(cancelled_error());
    }
    let result_file = owned.read_result_file()?;
    if cancellation.is_cancelled() {
        return Err(cancelled_error());
    }
    if TokioInstant::now() >= deadline {
        return Err(timeout_error());
    }
    Ok(ProcessOutput {
        stdout,
        stderr_tail,
        result_file,
        temp_dir: None,
        temp_identity: None,
        temp_handle: None,
    })
}

async fn write_stdin(
    mut stdin: tokio::process::ChildStdin,
    bytes: Vec<u8>,
    faults: mpsc::UnboundedSender<StreamFault>,
) -> Result<StdinWriteOutcome, LocalAgentError> {
    if let Err(error) = stdin.write_all(&bytes).await {
        if error.kind() == ErrorKind::BrokenPipe {
            return Ok(StdinWriteOutcome::BrokenPipe);
        }
        let _ = faults.send(StreamFault::Io);
        return Err(io_error());
    }
    if let Err(error) = stdin.shutdown().await {
        if error.kind() == ErrorKind::BrokenPipe {
            return Ok(StdinWriteOutcome::BrokenPipe);
        }
        let _ = faults.send(StreamFault::Io);
        return Err(io_error());
    }
    Ok(StdinWriteOutcome::Complete)
}

#[cfg(unix)]
fn configure_child_file_size_limit() -> std::io::Result<()> {
    let limit = (MAX_PROCESS_OUTPUT_BYTES + 1) as libc::rlim_t;
    let limits = libc::rlimit {
        rlim_cur: limit,
        rlim_max: limit,
    };
    if unsafe { libc::setrlimit(libc::RLIMIT_FSIZE, &limits) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

async fn monitor_result_file(file: Option<&OwnedFile>) -> LocalAgentError {
    let Some(file) = file else {
        return std::future::pending::<LocalAgentError>().await;
    };
    loop {
        if let Err(error) = file.verify_identity() {
            return error;
        }
        let size = match file.handle.metadata() {
            Ok(metadata) => metadata.len(),
            Err(_) => return invalid_result_file(),
        };
        if size > MAX_PROCESS_OUTPUT_BYTES as u64 {
            return stream_fault_error(StreamFault::OutputTooLarge);
        }
        tokio::time::sleep(RESULT_FILE_MONITOR_INTERVAL).await;
    }
}

async fn read_capped<R>(
    mut reader: R,
    limit: usize,
    faults: mpsc::UnboundedSender<StreamFault>,
) -> Result<Vec<u8>, LocalAgentError>
where
    R: AsyncRead + Unpin,
{
    let mut bytes = Vec::with_capacity(limit.min(8192));
    let mut chunk = [0_u8; 8192];
    loop {
        let read = match reader.read(&mut chunk).await {
            Ok(read) => read,
            Err(_) => {
                let _ = faults.send(StreamFault::Io);
                return Err(io_error());
            }
        };
        if read == 0 {
            return Ok(bytes);
        }
        if bytes.len().saturating_add(read) > limit {
            let _ = faults.send(StreamFault::OutputTooLarge);
            return Err(stream_fault_error(StreamFault::OutputTooLarge));
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
}

async fn await_stream_task<T>(
    task: &mut Option<JoinHandle<Result<T, LocalAgentError>>>,
    deadline: TokioInstant,
    cancellation: &CancellationToken,
) -> Result<T, LocalAgentError> {
    let mut task = task.take().ok_or_else(io_error)?;
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => {
            task.abort();
            let _ = task.await;
            Err(cancelled_error())
        }
        _ = tokio::time::sleep_until(deadline) => {
            task.abort();
            let _ = task.await;
            Err(timeout_error())
        }
        result = &mut task => result.unwrap_or_else(|_| Err(io_error())),
    }
}

async fn abort_stream_tasks(
    stdin: &mut Option<JoinHandle<Result<StdinWriteOutcome, LocalAgentError>>>,
    stdout: &mut Option<JoinHandle<Result<Vec<u8>, LocalAgentError>>>,
    stderr: &mut Option<JoinHandle<Result<Vec<u8>, LocalAgentError>>>,
) {
    if let Some(stdin) = stdin.take() {
        stdin.abort();
        let _ = stdin.await;
    }
    if let Some(stdout) = stdout.take() {
        stdout.abort();
        let _ = stdout.await;
    }
    if let Some(stderr) = stderr.take() {
        stderr.abort();
        let _ = stderr.await;
    }
}

pub(super) struct RegisteredProcessGroup {
    id: i32,
    armed: bool,
}

pub(super) struct ProcessActivityGuard {
    active: bool,
}

impl ProcessActivityGuard {
    pub(super) fn begin() -> Option<Self> {
        #[cfg(unix)]
        {
            let mut registry = live_process_groups()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            registry.begin_operation().then_some(Self { active: true })
        }
        #[cfg(not(unix))]
        {
            Some(Self { active: true })
        }
    }
}

impl Drop for ProcessActivityGuard {
    fn drop(&mut self) {
        #[cfg(unix)]
        if self.active {
            live_process_groups()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .finish_operation();
            self.active = false;
        }
    }
}

impl RegisteredProcessGroup {
    #[cfg(test)]
    fn from_child(child: &Child) -> Result<Self, LocalAgentError> {
        let id = child_process_group_id(child)?;
        Self::register(id).map_err(|_| cancelled_error())
    }

    pub(super) fn register(id: i32) -> Result<Self, RejectedProcessGroup> {
        if id <= 0 {
            return Err(RejectedProcessGroup {
                id,
                tracked: false,
                confirmed: true,
            });
        }
        #[cfg(unix)]
        if !register_process_group(id) {
            let rejected = RejectedProcessGroup {
                id,
                tracked: true,
                confirmed: false,
            };
            rejected.terminate();
            return Err(rejected);
        }
        Ok(Self { id, armed: true })
    }

    pub(super) const fn id(&self) -> i32 {
        self.id
    }

    fn disarm_after_confirmed_disappearance(&mut self) {
        #[cfg(unix)]
        unregister_process_group(self.id);
        self.armed = false;
    }

    pub(super) fn terminate(&self) {
        #[cfg(unix)]
        unsafe {
            let _ = libc::kill(-self.id, libc::SIGKILL);
        }
    }

    pub(super) fn terminate_and_confirm(&mut self, timeout: Duration) -> bool {
        self.terminate();
        #[cfg(unix)]
        if !wait_for_group_exit_sync(self.id, timeout, true) {
            return false;
        }
        self.disarm_after_confirmed_disappearance();
        true
    }
}

#[derive(Debug)]
pub(super) struct RejectedProcessGroup {
    id: i32,
    tracked: bool,
    confirmed: bool,
}

impl RejectedProcessGroup {
    pub(super) fn terminate(&self) {
        #[cfg(unix)]
        if self.id > 0 {
            unsafe {
                let _ = libc::kill(-self.id, libc::SIGKILL);
            }
        }
    }

    pub(super) fn terminate_and_confirm(&mut self, timeout: Duration) -> bool {
        self.terminate();
        #[cfg(unix)]
        if !wait_for_group_exit_sync(self.id, timeout, true) {
            return false;
        }
        self.confirmed = true;
        true
    }
}

impl Drop for RejectedProcessGroup {
    fn drop(&mut self) {
        self.terminate();
        #[cfg(unix)]
        if self.tracked {
            if self.confirmed {
                finish_deferred_cleanup_tracking();
            } else {
                spawn_deferred_cleanup(DeferredCleanupTicket { id: self.id });
            }
            self.tracked = false;
        }
    }
}

fn child_process_group_id(child: &Child) -> Result<i32, LocalAgentError> {
    i32::try_from(child.id().ok_or_else(io_error)?)
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(io_error)
}

async fn kill_unregistered_group_and_reap(
    child: &mut Child,
    rejected: &mut RejectedProcessGroup,
) -> Result<(), LocalAgentError> {
    rejected.terminate();
    let _ = child.start_kill();
    let deadline = TokioInstant::now() + PROCESS_CLEANUP_TIMEOUT;
    let leader = tokio::time::timeout_at(deadline, child.wait()).await;
    let group = wait_for_group_exit_until(rejected.id, deadline, true).await;
    if matches!(leader, Ok(Ok(_))) && group.is_ok() {
        rejected.confirmed = true;
        Ok(())
    } else {
        Err(process_cleanup_error())
    }
}

async fn take_child_pipes_or_cleanup(
    child: &mut Child,
    process_group: &mut RegisteredProcessGroup,
) -> Result<(ChildStdin, ChildStdout, ChildStderr), LocalAgentError> {
    let pipes = (child.stdin.take(), child.stdout.take(), child.stderr.take());
    let (Some(stdin), Some(stdout), Some(stderr)) = pipes else {
        terminate_and_reap(child, process_group).await?;
        return Err(io_error());
    };
    Ok((stdin, stdout, stderr))
}

impl Drop for RegisteredProcessGroup {
    fn drop(&mut self) {
        if self.armed {
            self.terminate();
            #[cfg(unix)]
            {
                let cleanup = unregister_for_deferred_cleanup(self.id);
                spawn_deferred_cleanup(cleanup);
            }
            self.armed = false;
        }
    }
}

#[cfg(unix)]
fn live_process_groups() -> &'static Mutex<ProcessGroupRegistry> {
    LIVE_PROCESS_GROUPS.get_or_init(|| Mutex::new(ProcessGroupRegistry::default()))
}

#[cfg(unix)]
fn register_process_group(process_group: i32) -> bool {
    let mut registry = live_process_groups()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if registry.register(process_group) {
        true
    } else {
        registry.begin_rejected_cleanup();
        false
    }
}

#[cfg(unix)]
fn unregister_process_group(process_group: i32) {
    live_process_groups()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .unregister(process_group);
}

#[cfg(unix)]
fn unregister_for_deferred_cleanup(process_group: i32) -> DeferredCleanupTicket {
    let mut registry = live_process_groups()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    registry.unregister(process_group);
    registry.begin_rejected_cleanup();
    DeferredCleanupTicket { id: process_group }
}

#[cfg(unix)]
struct DeferredCleanupTicket {
    id: i32,
}

#[cfg(unix)]
impl DeferredCleanupTicket {
    fn terminate(&self) {
        if self.id > 0 {
            unsafe {
                let _ = libc::kill(-self.id, libc::SIGKILL);
            }
        }
    }
}

#[cfg(unix)]
impl Drop for DeferredCleanupTicket {
    fn drop(&mut self) {
        self.terminate();
        finish_deferred_cleanup_tracking();
    }
}

#[cfg(unix)]
fn finish_deferred_cleanup_tracking() {
    live_process_groups()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .finish_rejected_cleanup();
}

#[cfg(unix)]
fn spawn_deferred_cleanup(cleanup: DeferredCleanupTicket) {
    let process_group = cleanup.id;
    let _ = std::thread::Builder::new()
        .name("local-agent-group-cleanup".to_string())
        .spawn(move || {
            let _cleanup_tracking = cleanup;
            let _ = wait_for_group_exit_sync(process_group, PROCESS_CLEANUP_TIMEOUT, true);
        });
}

#[cfg(unix)]
fn wait_for_group_exit_sync(
    process_group: i32,
    timeout: Duration,
    repeat_termination: bool,
) -> bool {
    let deadline = StdInstant::now() + timeout;
    let mut absent_since = None;
    loop {
        let now = StdInstant::now();
        if process_group_exists(process_group) {
            absent_since = None;
        } else {
            let first_absent = *absent_since.get_or_insert(now);
            if now.duration_since(first_absent) >= PROCESS_GROUP_ABSENCE_CONFIRMATION {
                return true;
            }
        }
        if now >= deadline {
            return false;
        }
        if repeat_termination {
            unsafe {
                let _ = libc::kill(-process_group, libc::SIGKILL);
            }
        }
        std::thread::sleep(PROCESS_GROUP_POLL_INTERVAL.min(deadline.duration_since(now)));
    }
}

#[cfg(all(unix, test))]
fn process_group_is_registered(process_group: i32) -> bool {
    live_process_groups()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .process_groups
        .contains(&process_group)
}

#[cfg(unix)]
fn process_group_exists(process_group: i32) -> bool {
    if process_group <= 0 {
        return false;
    }
    if unsafe { libc::kill(-process_group, 0) } == 0 {
        #[cfg(target_os = "macos")]
        if let Some(has_live_member) = macos_process_group_has_live_member(process_group) {
            return has_live_member;
        }
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

#[cfg(target_os = "macos")]
fn macos_process_group_has_live_member(process_group: i32) -> Option<bool> {
    const PROC_PGRP_ONLY: u32 = 2;
    let required_bytes = unsafe {
        libc::proc_listpids(
            PROC_PGRP_ONLY,
            u32::try_from(process_group).ok()?,
            std::ptr::null_mut(),
            0,
        )
    };
    if required_bytes < 0 {
        return None;
    }
    let pid_size = std::mem::size_of::<libc::pid_t>();
    let capacity = usize::try_from(required_bytes)
        .ok()?
        .checked_div(pid_size)?
        + 32;
    let mut process_ids = vec![0; capacity];
    let buffer_bytes = process_ids.len().checked_mul(pid_size)?;
    let written_bytes = unsafe {
        libc::proc_listpids(
            PROC_PGRP_ONLY,
            u32::try_from(process_group).ok()?,
            process_ids.as_mut_ptr().cast(),
            i32::try_from(buffer_bytes).ok()?,
        )
    };
    if written_bytes < 0 {
        return None;
    }
    let written_bytes = usize::try_from(written_bytes).ok()?;
    if written_bytes >= buffer_bytes || written_bytes % pid_size != 0 {
        return None;
    }
    process_ids.truncate(written_bytes.checked_div(pid_size)?);
    for process_id in process_ids.into_iter().filter(|process_id| *process_id > 0) {
        let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::uninit();
        let info_size = std::mem::size_of::<libc::proc_bsdinfo>();
        let read = unsafe {
            libc::proc_pidinfo(
                process_id,
                libc::PROC_PIDTBSDINFO,
                0,
                info.as_mut_ptr().cast(),
                i32::try_from(info_size).ok()?,
            )
        };
        if read != i32::try_from(info_size).ok()? {
            return None;
        }
        let info = unsafe { info.assume_init() };
        if info.pbi_pgid == u32::try_from(process_group).ok()? && info.pbi_status != libc::SZOMB {
            return Some(true);
        }
    }
    Some(false)
}

pub(super) fn terminate_all_process_groups() {
    #[cfg(unix)]
    {
        let registry = live_process_groups()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        terminate_process_groups(registry.snapshot());
    }
}

pub(super) fn begin_process_shutdown() {
    #[cfg(unix)]
    {
        let mut registry = live_process_groups()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let process_groups = registry.begin_shutdown();
        terminate_process_groups(process_groups);
    }
}

pub(super) async fn wait_for_process_groups_idle(timeout: Duration) -> bool {
    let deadline = TokioInstant::now() + timeout;
    loop {
        #[cfg(unix)]
        if live_process_groups()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_idle()
        {
            return true;
        }
        #[cfg(not(unix))]
        return true;

        let now = TokioInstant::now();
        if now >= deadline {
            return false;
        }
        tokio::time::sleep_until((now + Duration::from_millis(5)).min(deadline)).await;
    }
}

#[cfg(unix)]
fn terminate_process_groups(process_groups: Vec<i32>) {
    for process_group in process_groups {
        if process_group > 0 {
            unsafe {
                let _ = libc::kill(-process_group, libc::SIGKILL);
            }
        }
    }
}

async fn terminate_process_group(
    process_group: &mut RegisteredProcessGroup,
) -> Result<(), LocalAgentError> {
    process_group.terminate();
    wait_for_group_exit_until(
        process_group.id(),
        TokioInstant::now() + PROCESS_CLEANUP_TIMEOUT,
        true,
    )
    .await?;
    process_group.disarm_after_confirmed_disappearance();
    Ok(())
}

async fn terminate_and_reap(
    child: &mut Child,
    process_group: &mut RegisteredProcessGroup,
) -> Result<(), LocalAgentError> {
    process_group.terminate();
    let _ = child.start_kill();
    let deadline = TokioInstant::now() + PROCESS_CLEANUP_TIMEOUT;
    let leader = tokio::time::timeout_at(deadline, child.wait()).await;
    let group = wait_for_group_exit_until(process_group.id(), deadline, true).await;
    if group.is_ok() {
        process_group.disarm_after_confirmed_disappearance();
    }
    if !matches!(leader, Ok(Ok(_))) {
        return Err(process_cleanup_error());
    }
    group
}

#[cfg(test)]
async fn wait_for_group_exit(process_group: i32, timeout: Duration) -> Result<(), LocalAgentError> {
    wait_for_group_exit_until(process_group, TokioInstant::now() + timeout, false).await
}

async fn wait_for_group_exit_until(
    process_group: i32,
    deadline: TokioInstant,
    repeat_termination: bool,
) -> Result<(), LocalAgentError> {
    #[cfg(unix)]
    {
        let mut absent_since = None;
        loop {
            let now = TokioInstant::now();
            if process_group_exists(process_group) {
                absent_since = None;
            } else {
                let first_absent = *absent_since.get_or_insert(now);
                if now.duration_since(first_absent) >= PROCESS_GROUP_ABSENCE_CONFIRMATION {
                    return Ok(());
                }
            }
            if now >= deadline {
                return Err(process_cleanup_error());
            }
            if repeat_termination {
                unsafe {
                    let _ = libc::kill(-process_group, libc::SIGKILL);
                }
            }
            tokio::time::sleep_until((now + PROCESS_GROUP_POLL_INTERVAL).min(deadline)).await;
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (process_group, deadline, repeat_termination);
        Ok(())
    }
}

fn stream_fault_error(fault: StreamFault) -> LocalAgentError {
    match fault {
        StreamFault::OutputTooLarge => LocalAgentError::run(
            "local_agent_output_too_large",
            "The local agent output exceeded the safe limit.",
        ),
        StreamFault::Io => io_error(),
    }
}

fn cancelled_error() -> LocalAgentError {
    LocalAgentError::run(
        "local_agent_cancelled",
        "The local agent request was cancelled.",
    )
}

fn ensure_process_active(
    cancellation: &CancellationToken,
    deadline: StdInstant,
) -> Result<(), LocalAgentError> {
    if cancellation.is_cancelled() {
        Err(cancelled_error())
    } else if StdInstant::now() >= deadline {
        Err(timeout_error())
    } else {
        Ok(())
    }
}

fn timeout_error() -> LocalAgentError {
    LocalAgentError::run("local_agent_timeout", "The local agent request timed out.")
}

fn process_cleanup_error() -> LocalAgentError {
    LocalAgentError::run(
        "local_agent_cleanup_failed",
        "The local agent process could not be stopped safely.",
    )
}

fn io_error() -> LocalAgentError {
    LocalAgentError::run(
        "local_agent_io",
        "The local agent process could not be read safely.",
    )
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        env,
        ffi::{OsStr, OsString},
        fs,
        path::{Path, PathBuf},
        time::{Duration, Instant as StdInstant},
    };

    #[cfg(unix)]
    use std::os::unix::{
        fs::{OpenOptionsExt, PermissionsExt},
        process::CommandExt,
    };

    use tempfile::{TempDir, tempdir};
    #[cfg(unix)]
    use tokio::process::Command;
    use tokio_util::sync::CancellationToken;

    use super::{
        MAX_PROCESS_OUTPUT_BYTES, MAX_PROCESS_STDIN_BYTES, OwnedProcessInvocation,
        STDERR_TAIL_BYTES, controlled_environment, controlled_environment_for_agent,
        create_owned_temp_dir, run_process as run_process_until,
    };
    #[cfg(unix)]
    use super::{
        ProcessGroupRegistry, RegisteredProcessGroup, process_group_is_registered,
        terminate_and_reap, wait_for_group_exit,
    };
    use crate::local_agents::{
        LocalAgentKind, adapters::AdapterInvocation, discovery::ExecutableProof,
    };

    #[cfg(unix)]
    fn fake_executable(script: &str) -> (TempDir, PathBuf) {
        let directory = tempdir().unwrap();
        let executable = directory.path().join("fake-agent");
        fs::write(&executable, script).unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        let executable = executable.canonicalize().unwrap();
        (directory, executable)
    }

    fn invocation(
        executable: PathBuf,
        cwd: &Path,
        env: Vec<(OsString, OsString)>,
        result_file: Option<PathBuf>,
    ) -> AdapterInvocation {
        AdapterInvocation {
            executable,
            args: Vec::new(),
            env,
            cwd: cwd.to_path_buf(),
            stdin: b"private prompt with captured source".to_vec(),
            result_file,
        }
    }

    fn prepare_owned(
        invocation: AdapterInvocation,
        temp_dir: TempDir,
    ) -> Result<OwnedProcessInvocation, crate::local_agents::LocalAgentError> {
        let proof = ExecutableProof::capture(&invocation.executable).unwrap();
        OwnedProcessInvocation::prepare(
            invocation,
            temp_dir,
            proof,
            LocalAgentKind::Claude,
            &CancellationToken::new(),
            StdInstant::now() + Duration::from_secs(30),
        )
    }

    fn prepare_owned_for_kind_with_environment(
        invocation: AdapterInvocation,
        temp_dir: TempDir,
        agent_kind: LocalAgentKind,
        inherited_environment: BTreeMap<OsString, OsString>,
    ) -> Result<OwnedProcessInvocation, crate::local_agents::LocalAgentError> {
        let proof = ExecutableProof::capture(&invocation.executable).unwrap();
        OwnedProcessInvocation::prepare_with_inherited_environment(
            invocation,
            temp_dir,
            proof,
            agent_kind,
            &CancellationToken::new(),
            StdInstant::now() + Duration::from_secs(30),
            inherited_environment,
        )
    }

    async fn run_process(
        owned: OwnedProcessInvocation,
        cancellation: CancellationToken,
        timeout: Duration,
    ) -> Result<super::ProcessOutput, crate::local_agents::LocalAgentError> {
        run_process_until(owned, cancellation, StdInstant::now() + timeout).await
    }

    #[cfg(unix)]
    fn prepared(script: &str) -> (TempDir, PathBuf, OwnedProcessInvocation) {
        let body = script.strip_prefix("#!/bin/sh\n").unwrap_or(script);
        let script = format!("#!/bin/sh\n/bin/cat >/dev/null\n{body}");
        let (executable_dir, executable) = fake_executable(&script);
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
        )
        .unwrap();
        (executable_dir, owned_path, prepared)
    }

    #[cfg(unix)]
    fn read_positive_pid(path: &Path) -> Option<i32> {
        fs::read_to_string(path)
            .ok()?
            .trim()
            .parse::<i32>()
            .ok()
            .filter(|pid| *pid > 0)
    }

    #[cfg(unix)]
    async fn wait_for_positive_pid(path: &Path) -> i32 {
        let deadline = StdInstant::now() + Duration::from_secs(1);
        loop {
            if let Some(pid) = read_positive_pid(path) {
                return pid;
            }
            assert!(
                StdInstant::now() < deadline,
                "fake process did not publish a positive PID"
            );
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    }

    #[cfg(unix)]
    async fn wait_for_positive_pid_pair(first: &Path, second: &Path) -> (i32, i32) {
        let deadline = StdInstant::now() + Duration::from_secs(1);
        loop {
            if let (Some(first), Some(second)) =
                (read_positive_pid(first), read_positive_pid(second))
            {
                return (first, second);
            }
            assert!(
                StdInstant::now() < deadline,
                "fake processes did not publish positive PIDs"
            );
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    }

    #[cfg(unix)]
    async fn wait_for_aborted_group_cleanup(leader_pid: i32, child_pid: i32) {
        let deadline = StdInstant::now() + super::PROCESS_CLEANUP_TIMEOUT;
        loop {
            if !process_exists(child_pid)
                && !process_exists(leader_pid)
                && !process_group_is_registered(leader_pid)
            {
                return;
            }
            assert!(
                StdInstant::now() < deadline,
                "aborted process group cleanup exceeded its bound"
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn successful_process_keeps_its_owned_temp_dir_until_result_validation_finishes() {
        let (executable_dir, owned_path, prepared) = prepared("#!/bin/sh\nprintf 'valid result'");
        let sibling = executable_dir.path().join("keep-me");
        fs::write(&sibling, b"outside").unwrap();

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();

        assert_eq!(output.stdout, b"valid result");
        assert!(output.result_file.is_none());
        assert!(output.stderr_tail.is_empty());
        assert!(owned_path.exists());
        output.close_temp_dir().unwrap();
        assert!(!owned_path.exists());
        assert_eq!(fs::read(sibling).unwrap(), b"outside");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn directory_identity_allows_owned_child_entries_to_change_link_count() {
        let (_executable_dir, owned_path, prepared) =
            prepared("#!/bin/sh\n/bin/mkdir nested\nprintf valid");

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();

        assert_eq!(output.stdout, b"valid");
        assert!(owned_path.join("nested").is_dir());
        output.close_temp_dir().unwrap();
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cleanup_repairs_nontraversable_nested_directories_without_following_symlinks() {
        let outside = tempdir().unwrap();
        let outside_sentinel = outside.path().join("sentinel");
        fs::write(&outside_sentinel, b"outside-content").unwrap();
        fs::set_permissions(outside.path(), fs::Permissions::from_mode(0o500)).unwrap();
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\n/bin/mkdir nested\nprintf secret > nested/file\n/bin/chmod 000 nested\n/bin/ln -s \"$OUTSIDE_ROOT\" outside-link\nprintf valid",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("OUTSIDE_ROOT"),
                    outside.path().as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();
        let close_result = output.close_temp_dir();
        let root_was_removed = !owned_path.exists();
        if !root_was_removed {
            fs::set_permissions(owned_path.join("nested"), fs::Permissions::from_mode(0o700))
                .unwrap();
            fs::remove_dir_all(&owned_path).unwrap();
        }

        assert_eq!(output.stdout, b"valid");
        assert!(close_result.is_ok());
        assert!(root_was_removed);
        assert_eq!(fs::read(&outside_sentinel).unwrap(), b"outside-content");
        assert_eq!(
            fs::metadata(outside.path()).unwrap().permissions().mode() & 0o777,
            0o500
        );
        fs::set_permissions(outside.path(), fs::Permissions::from_mode(0o700)).unwrap();
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn dropping_unparsed_output_repairs_nontraversable_nested_directories() {
        let (_executable_dir, owned_path, prepared) = prepared(
            "#!/bin/sh\n/bin/mkdir nested\nprintf secret > nested/file\n/bin/chmod 000 nested\nprintf invalid",
        );

        let output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();
        drop(output);
        let root_was_removed = !owned_path.exists();
        if !root_was_removed {
            fs::set_permissions(owned_path.join("nested"), fs::Permissions::from_mode(0o700))
                .unwrap();
            fs::remove_dir_all(&owned_path).unwrap();
        }

        assert!(root_was_removed);
    }

    #[cfg(unix)]
    #[test]
    fn readable_tree_deeper_than_repair_budget_is_removed_without_repair() {
        let directory = create_owned_temp_dir().unwrap();
        let owned_path = directory.path().to_path_buf();
        let mut handle = Some(super::open_owned_directory(&owned_path).unwrap());
        let identity = super::FileIdentity::from_handle_and_path(
            handle.as_ref().unwrap(),
            &owned_path,
            super::FileRole::OwnedDirectory,
        )
        .unwrap();
        let mut nested = owned_path.clone();
        for depth in 0..=super::MAX_TEMP_CLEANUP_DEPTH {
            nested.push(format!("level-{depth}"));
            fs::create_dir(&nested).unwrap();
        }
        fs::write(nested.join("sentinel"), b"readable").unwrap();
        let mut directory = Some(directory);

        let close_result = super::close_temp_dir(&mut directory, Some(&identity), &mut handle);
        let root_was_removed = !owned_path.exists();
        if !root_was_removed {
            fs::remove_dir_all(&owned_path).unwrap();
        }

        assert!(close_result.is_ok());
        assert!(root_was_removed);
    }

    #[cfg(unix)]
    #[test]
    fn readable_tree_larger_than_repair_entry_budget_is_removed_without_repair() {
        let directory = create_owned_temp_dir().unwrap();
        let owned_path = directory.path().to_path_buf();
        let mut handle = Some(super::open_owned_directory(&owned_path).unwrap());
        let identity = super::FileIdentity::from_handle_and_path(
            handle.as_ref().unwrap(),
            &owned_path,
            super::FileRole::OwnedDirectory,
        )
        .unwrap();
        for index in 0..=super::MAX_TEMP_CLEANUP_ENTRIES {
            fs::write(owned_path.join(format!("entry-{index}")), b"").unwrap();
        }
        let mut directory = Some(directory);

        let close_result = super::close_temp_dir(&mut directory, Some(&identity), &mut handle);
        let root_was_removed = !owned_path.exists();
        if !root_was_removed {
            fs::remove_dir_all(&owned_path).unwrap();
        }

        assert!(close_result.is_ok());
        assert!(root_was_removed);
    }

    #[cfg(unix)]
    #[test]
    fn inaccessible_tree_beyond_repair_budget_fails_closed_and_is_retained() {
        let directory = create_owned_temp_dir().unwrap();
        let owned_path = directory.path().to_path_buf();
        let mut handle = Some(super::open_owned_directory(&owned_path).unwrap());
        let identity = super::FileIdentity::from_handle_and_path(
            handle.as_ref().unwrap(),
            &owned_path,
            super::FileRole::OwnedDirectory,
        )
        .unwrap();
        let mut nested = owned_path.clone();
        for depth in 0..=super::MAX_TEMP_CLEANUP_DEPTH {
            nested.push(format!("level-{depth}"));
            fs::create_dir(&nested).unwrap();
        }
        fs::write(nested.join("sentinel"), b"private").unwrap();
        fs::set_permissions(&nested, fs::Permissions::from_mode(0o000)).unwrap();
        let mut directory = Some(directory);

        let error =
            super::close_temp_dir(&mut directory, Some(&identity), &mut handle).unwrap_err();

        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert!(owned_path.exists());
        fs::set_permissions(&nested, fs::Permissions::from_mode(0o700)).unwrap();
        fs::remove_dir_all(&owned_path).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn mutable_temp_directory_mode_never_prevents_exact_owned_cleanup() {
        let (_executable_dir, owned_path, prepared) =
            prepared("#!/bin/sh\n/bin/chmod 0755 \"$PWD\"\nprintf invalid");

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "invalid_temp_directory");
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stdout_overflow_is_bounded_and_cleans_the_owned_temp_dir() {
        let script = format!(
            "#!/bin/sh\n/usr/bin/head -c {} /dev/zero",
            MAX_PROCESS_OUTPUT_BYTES + 1
        );
        let (_executable_dir, owned_path, prepared) = prepared(&script);

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(2))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_output_too_large");
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn child_regular_files_cannot_grow_beyond_the_kernel_file_size_limit() {
        let script = format!(
            "#!/bin/sh\n/usr/bin/head -c {} /dev/zero > capped.bin || true\n/usr/bin/wc -c < capped.bin",
            MAX_PROCESS_OUTPUT_BYTES + 4096
        );
        let (_executable_dir, _owned_path, prepared) = prepared(&script);

        let output = run_process(prepared, CancellationToken::new(), Duration::from_secs(2))
            .await
            .unwrap();
        let capped_size = std::str::from_utf8(&output.stdout)
            .unwrap()
            .trim()
            .parse::<usize>()
            .unwrap();

        assert!(capped_size <= MAX_PROCESS_OUTPUT_BYTES + 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn pre_cancelled_request_never_spawns_the_executable() {
        let marker_dir = tempdir().unwrap();
        let marker = marker_dir.path().join("spawned");
        let (executable_dir, executable) =
            fake_executable("#!/bin/sh\n/usr/bin/touch \"$SPAWN_MARKER\"\n/bin/cat >/dev/null");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("SPAWN_MARKER"),
                    marker.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        let error = run_process(prepared, cancellation, Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_cancelled");
        assert!(!marker.exists());
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn expired_absolute_deadline_never_starts_a_fresh_process_budget() {
        let marker_dir = tempdir().unwrap();
        let marker = marker_dir.path().join("spawned");
        let (executable_dir, executable) =
            fake_executable("#!/bin/sh\n/usr/bin/touch \"$SPAWN_MARKER\"");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("SPAWN_MARKER"),
                    marker.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process_until(
            prepared,
            CancellationToken::new(),
            StdInstant::now() - Duration::from_millis(1),
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, "local_agent_timeout");
        assert!(!marker.exists());
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stderr_overflow_kills_the_group_without_returning_captured_content() {
        let pid_dir = tempdir().unwrap();
        let pid_file = pid_dir.path().join("agent.pid");
        let script = format!(
            "#!/bin/sh\n/bin/cat >/dev/null\nprintf '%s' \"$$\" > \"$FAKE_AGENT_PID_FILE\"\nprintf 'captured source private prompt' >&2\n/usr/bin/head -c {} /dev/zero >&2\n/bin/sleep 30",
            STDERR_TAIL_BYTES
        );
        let (executable_dir, executable) = fake_executable(&script);
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("FAKE_AGENT_PID_FILE"),
                    pid_file.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();
        let agent_pid = fs::read_to_string(pid_file)
            .unwrap()
            .parse::<i32>()
            .unwrap();

        assert_eq!(error.code, "local_agent_output_too_large");
        let debug = format!("{error:?}");
        assert!(!debug.contains("captured source"));
        assert!(!debug.contains("private prompt"));
        assert!(!process_exists(agent_pid));
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stderr_at_the_limit_is_returned_only_to_the_internal_caller() {
        let script = format!(
            "#!/bin/sh\n/usr/bin/head -c {} /dev/zero >&2\nprintf ok",
            STDERR_TAIL_BYTES
        );
        let (_executable_dir, _owned_path, prepared) = prepared(&script);

        let output = run_process(prepared, CancellationToken::new(), Duration::from_secs(2))
            .await
            .unwrap();

        assert_eq!(output.stdout, b"ok");
        assert_eq!(output.stderr_tail.len(), STDERR_TAIL_BYTES);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_kills_the_group_reaps_the_leader_and_cleans_temp() {
        let (_executable_dir, owned_path, prepared) = prepared("#!/bin/sh\n/bin/sleep 30");

        let error = run_process(
            prepared,
            CancellationToken::new(),
            Duration::from_millis(50),
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, "local_agent_timeout");
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn process_group_confirmation_timeout_is_a_sanitized_cleanup_error() {
        let current_process_group = unsafe { libc::getpgrp() };

        let error = wait_for_group_exit(current_process_group, Duration::from_millis(10))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert!(!error.message.contains(&current_process_group.to_string()));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn process_group_disappearance_requires_a_stable_absence_window() {
        let nonexistent_process_group = i32::MAX;
        assert!(!super::process_group_exists(nonexistent_process_group));
        let started = StdInstant::now();

        wait_for_group_exit(nonexistent_process_group, Duration::from_millis(100))
            .await
            .unwrap();

        assert!(started.elapsed() >= Duration::from_millis(20));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn group_guard_stays_registered_until_disappearance_is_confirmed() {
        let mut command = Command::new("/bin/sleep");
        command.arg("30").kill_on_drop(true);
        command.as_std_mut().process_group(0);
        let mut child = command.spawn().unwrap();
        let mut guard = RegisteredProcessGroup::from_child(&child).unwrap();
        let process_group = guard.id();

        let error = wait_for_group_exit(process_group, Duration::from_millis(10))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert!(process_group_is_registered(process_group));
        terminate_and_reap(&mut child, &mut guard).await.unwrap();
        assert!(!process_group_is_registered(process_group));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn dropping_an_unconfirmed_group_guard_kills_and_removes_its_registration() {
        let mut command = Command::new("/bin/sleep");
        command.arg("30").kill_on_drop(true);
        command.as_std_mut().process_group(0);
        let mut child = command.spawn().unwrap();
        let guard = RegisteredProcessGroup::from_child(&child).unwrap();
        let process_group = guard.id();

        let error = wait_for_group_exit(process_group, Duration::from_millis(10))
            .await
            .unwrap_err();
        assert_eq!(error.code, "local_agent_cleanup_failed");
        assert!(process_group_is_registered(process_group));

        drop(guard);
        tokio::time::timeout(Duration::from_secs(1), child.wait())
            .await
            .unwrap()
            .unwrap();

        assert!(!process_group_is_registered(process_group));
        assert!(!process_exists(process_group));
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_latch_rejects_late_registration_without_global_state() {
        let mut registry = ProcessGroupRegistry::default();
        assert!(registry.register(41_001));
        assert!(registry.begin_operation());
        assert!(!registry.is_idle());

        let active_at_shutdown = registry.begin_shutdown();

        assert_eq!(active_at_shutdown, vec![41_001]);
        assert!(!registry.register(41_002));
        assert!(!registry.begin_operation());
        assert_eq!(registry.snapshot(), vec![41_001]);
        registry.unregister(41_001);
        registry.finish_operation();
        registry.begin_rejected_cleanup();
        assert!(!registry.is_idle());
        registry.finish_rejected_cleanup();
        assert!(registry.is_idle());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejected_registration_cleanup_kills_and_reaps_the_direct_child() {
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg("/bin/sleep 30").process_group(0);
        let mut child = command.spawn().unwrap();
        let process_group = i32::try_from(child.id().unwrap()).unwrap();
        let mut rejected = super::RejectedProcessGroup {
            id: process_group,
            tracked: false,
            confirmed: false,
        };

        super::kill_unregistered_group_and_reap(&mut child, &mut rejected)
            .await
            .unwrap();

        assert!(rejected.confirmed);
        assert!(!process_exists(process_group));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn missing_spawn_pipe_kills_reaps_and_unregisters_the_group() {
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("/bin/sleep 30")
            .process_group(0)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped());
        let mut child = command.spawn().unwrap();
        let process_group = i32::try_from(child.id().unwrap()).unwrap();
        let mut guard = RegisteredProcessGroup::register(process_group).unwrap();

        let error = match super::take_child_pipes_or_cleanup(&mut child, &mut guard).await {
            Ok(_) => panic!("a missing stdout pipe must fail closed"),
            Err(error) => error,
        };

        assert_eq!(error.code, "local_agent_io");
        assert!(!process_group_is_registered(process_group));
        assert!(!process_exists(process_group));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_kills_pipe_holding_descendants_and_never_returns_partial_output() {
        let pid_dir = tempdir().unwrap();
        let pid_file = pid_dir.path().join("child.pid");
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\n/bin/sleep 30 &\nprintf '%s' \"$!\" > \"$FAKE_CHILD_PID_FILE\"\nprintf 'partial output'\n/bin/sleep 30",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("FAKE_CHILD_PID_FILE"),
                    pid_file.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();
        let cancellation = CancellationToken::new();
        let task_cancellation = cancellation.clone();
        let task = tokio::spawn(async move {
            run_process(prepared, task_cancellation, Duration::from_secs(5)).await
        });
        let child_pid = wait_for_positive_pid(&pid_file).await;

        cancellation.cancel();
        let error = task.await.unwrap().unwrap_err();

        assert_eq!(error.code, "local_agent_cancelled");
        assert!(!owned_path.exists());
        assert!(!process_exists(child_pid));
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn successful_leader_still_kills_pipe_holding_descendants_before_returning() {
        let pid_dir = tempdir().unwrap();
        let pid_file = pid_dir.path().join("child.pid");
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\n/bin/sleep 30 &\nprintf '%s' \"$!\" > \"$FAKE_CHILD_PID_FILE\"\nprintf complete",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("FAKE_CHILD_PID_FILE"),
                    pid_file.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(3))
            .await
            .unwrap();
        let child_pid = fs::read_to_string(&pid_file)
            .unwrap()
            .parse::<i32>()
            .unwrap();

        assert_eq!(output.stdout, b"complete");
        assert!(!process_exists(child_pid));
        assert!(owned_path.exists());
        output.close_temp_dir().unwrap();
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn nonzero_exit_never_accepts_partial_output_or_exposes_stderr() {
        let (_executable_dir, owned_path, prepared) = prepared(
            "#!/bin/sh\nprintf 'partial output'\nprintf 'captured source private prompt' >&2\nexit 7",
        );

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_failed");
        assert!(!error.message.contains("captured source"));
        assert!(!error.message.contains("private prompt"));
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn broken_pipe_while_writing_stdin_defers_to_the_child_exit_status() {
        let (executable_dir, executable) = fake_executable("#!/bin/sh\nexit 7");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let mut adapter_invocation = invocation(executable, &owned_path, Vec::new(), None);
        adapter_invocation.stdin = vec![b'x'; MAX_PROCESS_STDIN_BYTES];
        let prepared = prepare_owned(adapter_invocation, owned_temp).unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_failed");
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn successful_child_after_broken_stdin_never_accepts_partial_output() {
        let (executable_dir, executable) =
            fake_executable("#!/bin/sh\nprintf hardcoded-without-reading-stdin\nexit 0");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let mut adapter_invocation = invocation(executable, &owned_path, Vec::new(), None);
        adapter_invocation.stdin = vec![b'x'; MAX_PROCESS_STDIN_BYTES];
        let prepared = prepare_owned(adapter_invocation, owned_temp).unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "local_agent_io");
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn result_path_substitution_is_rejected_without_reading_or_deleting_the_target() {
        let outside = tempdir().unwrap();
        let outside_file = outside.path().join("outside.json");
        let pid_file = outside.path().join("agent.pid");
        fs::write(&outside_file, b"private outside bytes").unwrap();
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\nprintf '%s' \"$$\" > \"$FAKE_AGENT_PID_FILE\"\n/bin/rm -f \"$RESULT_FILE\"\n/bin/ln -s \"$OUTSIDE_FILE\" \"$RESULT_FILE\"\n/bin/sleep 30",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let result_file = owned_path.join("result.json");
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        options.mode(0o600);
        options.open(&result_file).unwrap();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![
                    (
                        OsString::from("RESULT_FILE"),
                        result_file.as_os_str().to_owned(),
                    ),
                    (
                        OsString::from("OUTSIDE_FILE"),
                        outside_file.as_os_str().to_owned(),
                    ),
                    (
                        OsString::from("FAKE_AGENT_PID_FILE"),
                        pid_file.as_os_str().to_owned(),
                    ),
                ],
                Some(result_file),
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();
        let agent_pid = fs::read_to_string(pid_file)
            .unwrap()
            .parse::<i32>()
            .unwrap();

        assert_eq!(error.code, "invalid_result_file");
        assert_eq!(fs::read(&outside_file).unwrap(), b"private outside bytes");
        assert!(!process_exists(agent_pid));
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn temp_directory_identity_substitution_is_rejected_without_deleting_either_inode() {
        let outside = tempdir().unwrap();
        let moved_directory = outside.path().join("moved-owned-directory");
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\n/bin/mv \"$PWD\" \"$MOVED_DIRECTORY\"\n/bin/mkdir \"$PWD\"\n/bin/chmod 700 \"$PWD\"\nprintf replacement > \"$PWD/replacement\"",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![(
                    OsString::from("MOVED_DIRECTORY"),
                    moved_directory.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "invalid_temp_directory");
        assert_eq!(
            fs::read(owned_path.join("replacement")).unwrap(),
            b"replacement"
        );
        assert!(moved_directory.exists());
        assert!(executable_dir.path().exists());
        fs::remove_dir_all(&owned_path).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn temp_root_symlink_substitution_never_chmods_or_deletes_the_target() {
        let outside = tempdir().unwrap();
        let outside_sentinel = outside.path().join("sentinel");
        fs::write(&outside_sentinel, b"outside-content").unwrap();
        fs::set_permissions(outside.path(), fs::Permissions::from_mode(0o755)).unwrap();
        let moved_root = outside.path().join("moved-owned-root");
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\n/bin/mv \"$PWD\" \"$MOVED_ROOT\"\n/bin/ln -s \"$OUTSIDE_ROOT\" \"$PWD\"",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![
                    (
                        OsString::from("MOVED_ROOT"),
                        moved_root.as_os_str().to_owned(),
                    ),
                    (
                        OsString::from("OUTSIDE_ROOT"),
                        outside.path().as_os_str().to_owned(),
                    ),
                ],
                None,
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "invalid_temp_directory");
        assert_eq!(fs::read(&outside_sentinel).unwrap(), b"outside-content");
        assert_eq!(
            fs::metadata(outside.path()).unwrap().permissions().mode() & 0o777,
            0o755
        );
        assert!(owned_path.is_symlink());
        assert!(moved_root.is_dir());
        assert!(executable_dir.path().exists());
        fs::remove_file(&owned_path).unwrap();
        fs::remove_dir_all(&moved_root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn oversized_result_file_is_rejected_before_it_is_read() {
        let pid_dir = tempdir().unwrap();
        let pid_file = pid_dir.path().join("agent.pid");
        let script = format!(
            "#!/bin/sh\n/bin/cat >/dev/null\nprintf '%s' \"$$\" > \"$FAKE_AGENT_PID_FILE\"\n/usr/bin/head -c {} /dev/zero > \"$RESULT_FILE\"\n/bin/sleep 30",
            MAX_PROCESS_OUTPUT_BYTES + 1
        );
        let (executable_dir, executable) = fake_executable(&script);
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let result_file = owned_path.join("result.json");
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true).mode(0o600);
        options.open(&result_file).unwrap();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![
                    (
                        OsString::from("RESULT_FILE"),
                        result_file.as_os_str().to_owned(),
                    ),
                    (
                        OsString::from("FAKE_AGENT_PID_FILE"),
                        pid_file.as_os_str().to_owned(),
                    ),
                ],
                Some(result_file),
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();
        let agent_pid = fs::read_to_string(pid_file)
            .unwrap()
            .parse::<i32>()
            .unwrap();

        assert_eq!(error.code, "local_agent_output_too_large");
        assert!(!process_exists(agent_pid));
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn hard_linking_the_reserved_result_file_is_rejected() {
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\nprintf result > \"$RESULT_FILE\"\n/bin/ln \"$RESULT_FILE\" \"$RESULT_LINK\"",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let result_file = owned_path.join("result.json");
        let result_link = owned_path.join("result-link.json");
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true).mode(0o600);
        options.open(&result_file).unwrap();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![
                    (
                        OsString::from("RESULT_FILE"),
                        result_file.as_os_str().to_owned(),
                    ),
                    (
                        OsString::from("RESULT_LINK"),
                        result_link.as_os_str().to_owned(),
                    ),
                ],
                Some(result_file),
            ),
            owned_temp,
        )
        .unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "invalid_result_file");
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn aborting_the_run_future_kills_the_entire_process_group() {
        let pid_dir = tempdir().unwrap();
        let leader_pid_file = pid_dir.path().join("leader.pid");
        let child_pid_file = pid_dir.path().join("child.pid");
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n/bin/cat >/dev/null\nprintf '%s' \"$$\" > \"$FAKE_LEADER_PID_FILE\"\n/bin/sleep 30 &\nprintf '%s' \"$!\" > \"$FAKE_CHILD_PID_FILE\"\n/bin/sleep 30",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(
                executable,
                &owned_path,
                vec![
                    (
                        OsString::from("FAKE_LEADER_PID_FILE"),
                        leader_pid_file.as_os_str().to_owned(),
                    ),
                    (
                        OsString::from("FAKE_CHILD_PID_FILE"),
                        child_pid_file.as_os_str().to_owned(),
                    ),
                ],
                None,
            ),
            owned_temp,
        )
        .unwrap();
        let task = tokio::spawn(async move {
            run_process(prepared, CancellationToken::new(), Duration::from_secs(30)).await
        });
        let (leader_pid, child_pid) =
            wait_for_positive_pid_pair(&leader_pid_file, &child_pid_file).await;

        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        wait_for_aborted_group_cleanup(leader_pid, child_pid).await;

        assert!(!process_exists(child_pid));
        assert!(!process_exists(leader_pid));
        assert!(!process_group_is_registered(leader_pid));
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn executable_identity_substitution_is_rejected_before_spawn() {
        let (executable_dir, executable) = fake_executable("#!/bin/sh\nprintf original");
        let replacement = executable_dir.path().join("replacement");
        fs::write(&replacement, b"#!/bin/sh\nprintf replaced").unwrap();
        fs::set_permissions(&replacement, fs::Permissions::from_mode(0o700)).unwrap();
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned(
            invocation(executable.clone(), &owned_path, Vec::new(), None),
            owned_temp,
        )
        .unwrap();
        fs::remove_file(&executable).unwrap();
        std::os::unix::fs::symlink(&replacement, &executable).unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "invalid_executable");
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn preparation_rejects_a_proof_captured_from_another_executable() {
        let (_proof_directory, proof_executable) = fake_executable("#!/bin/sh\nprintf proof");
        let proof = ExecutableProof::capture(&proof_executable).unwrap();
        let (_invocation_directory, invocation_executable) =
            fake_executable("#!/bin/sh\nprintf invocation");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();

        let error = OwnedProcessInvocation::prepare(
            invocation(invocation_executable, &owned_path, Vec::new(), None),
            owned_temp,
            proof,
            LocalAgentKind::Claude,
            &CancellationToken::new(),
            StdInstant::now() + Duration::from_secs(30),
        )
        .unwrap_err();

        assert_eq!(error.code, "invalid_executable");
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn executable_content_is_rechecked_against_discovery_proof_before_spawn() {
        let marker_dir = tempdir().unwrap();
        let marker = marker_dir.path().join("spawned");
        let (executable_dir, executable) =
            fake_executable("#!/bin/sh\n/usr/bin/touch \"$SPAWN_MARKER\"");
        let proof = ExecutableProof::capture(&executable).unwrap();
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = OwnedProcessInvocation::prepare(
            invocation(
                executable.clone(),
                &owned_path,
                vec![(
                    OsString::from("SPAWN_MARKER"),
                    marker.as_os_str().to_owned(),
                )],
                None,
            ),
            owned_temp,
            proof,
            LocalAgentKind::Claude,
            &CancellationToken::new(),
            StdInstant::now() + Duration::from_secs(30),
        )
        .unwrap();
        fs::write(
            &executable,
            b"#!/bin/sh\n# changed in place\n/usr/bin/touch \"$SPAWN_MARKER\"",
        )
        .unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();

        let error = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap_err();

        assert_eq!(error.code, "invalid_executable");
        assert!(!marker.exists());
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[test]
    fn inherited_environment_is_allowlisted_and_adapter_overrides_win() {
        let home = tempdir().unwrap();
        let inherited = BTreeMap::from([
            (OsString::from("HOME"), home.path().as_os_str().to_owned()),
            (
                OsString::from("PATH"),
                OsString::from("/safe/bin:/usr/bin:/bin"),
            ),
            (OsString::from("LANG"), OsString::from("en_US.UTF-8")),
            (OsString::from("USER"), OsString::from("test")),
            (OsString::from("LOGNAME"), OsString::from("test")),
            (OsString::from("SHELL"), OsString::from("/bin/zsh")),
            (
                OsString::from("NODE_OPTIONS"),
                OsString::from("--require evil"),
            ),
            (
                OsString::from("CLAUDE_CONFIG_DIR"),
                OsString::from("/tmp/evil"),
            ),
            (
                OsString::from("PRIVATE_SOURCE"),
                OsString::from("captured source"),
            ),
        ]);
        let overrides = vec![
            (OsString::from("LANG"), OsString::from("ko_KR.UTF-8")),
            (
                OsString::from("OPENCODE_DISABLE_AUTOUPDATE"),
                OsString::from("true"),
            ),
        ];
        let cwd = Path::new("/private/owned-agent-dir");

        let environment = controlled_environment(inherited, &overrides, cwd).unwrap();

        assert_eq!(
            environment.get(&OsString::from("HOME")),
            Some(&home.path().canonicalize().unwrap().into_os_string())
        );
        assert_eq!(
            environment.get(&OsString::from("LANG")),
            Some(&OsString::from("ko_KR.UTF-8"))
        );
        assert_eq!(
            environment.get(&OsString::from("TMPDIR")),
            Some(&cwd.as_os_str().to_owned())
        );
        assert_eq!(
            environment.get(&OsString::from("PWD")),
            Some(&cwd.as_os_str().to_owned())
        );
        assert_eq!(
            environment.get(&OsString::from("OPENCODE_DISABLE_AUTOUPDATE")),
            Some(&OsString::from("true"))
        );
        assert!(!environment.contains_key(&OsString::from("NODE_OPTIONS")));
        assert!(!environment.contains_key(&OsString::from("CLAUDE_CONFIG_DIR")));
        assert!(!environment.contains_key(&OsString::from("PRIVATE_SOURCE")));
        assert!(!environment.contains_key(&OsString::from("USER")));
        assert!(!environment.contains_key(&OsString::from("LOGNAME")));
        assert!(!environment.contains_key(&OsString::from("SHELL")));
    }

    #[test]
    fn final_environment_uses_proof_path_and_per_agent_provider_allowlists() {
        let home = tempdir().unwrap();
        let inherited = BTreeMap::from([
            (OsString::from("HOME"), home.path().as_os_str().to_owned()),
            (
                OsString::from("PATH"),
                OsString::from("relative-attacker-bin"),
            ),
            (
                OsString::from("ANTHROPIC_API_KEY"),
                OsString::from("anthropic-secret"),
            ),
            (
                OsString::from("CODEX_API_KEY"),
                OsString::from("codex-secret"),
            ),
            (
                OsString::from("OPENAI_API_KEY"),
                OsString::from("openai-secret"),
            ),
            (
                OsString::from("HTTPS_PROXY"),
                OsString::from("http://proxy.invalid"),
            ),
            (
                OsString::from("NODE_OPTIONS"),
                OsString::from("--require attacker"),
            ),
            (
                OsString::from("CODEX_HOME"),
                OsString::from("/tmp/attacker"),
            ),
            (
                OsString::from("OPENCODE_CONFIG"),
                OsString::from("/tmp/attacker.json"),
            ),
        ]);
        let proof_path = OsStr::new("/usr/bin:/bin");
        let cwd = Path::new("/private/owned-agent-dir");

        let claude = controlled_environment_for_agent(
            inherited.clone(),
            &[],
            cwd,
            LocalAgentKind::Claude,
            proof_path,
        )
        .unwrap();
        let codex = controlled_environment_for_agent(
            inherited.clone(),
            &[],
            cwd,
            LocalAgentKind::Codex,
            proof_path,
        )
        .unwrap();
        let opencode = controlled_environment_for_agent(
            inherited,
            &[],
            cwd,
            LocalAgentKind::Opencode,
            proof_path,
        )
        .unwrap();

        let expected_path = super::normalized_safe_path(proof_path).unwrap();
        for environment in [&claude, &codex, &opencode] {
            assert_eq!(environment.get(OsStr::new("PATH")), Some(&expected_path));
            assert!(!environment.contains_key(OsStr::new("NODE_OPTIONS")));
            assert!(!environment.contains_key(OsStr::new("OPENCODE_CONFIG")));
        }
        assert!(claude.contains_key(OsStr::new("ANTHROPIC_API_KEY")));
        assert!(claude.contains_key(OsStr::new("HTTPS_PROXY")));
        assert_eq!(
            claude.get(OsStr::new("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB")),
            Some(&OsString::from("1"))
        );
        assert!(!claude.contains_key(OsStr::new("CODEX_API_KEY")));
        assert!(!claude.contains_key(OsStr::new("OPENAI_API_KEY")));

        assert!(codex.contains_key(OsStr::new("CODEX_API_KEY")));
        assert_eq!(
            codex.get(OsStr::new("CODEX_HOME")),
            Some(&cwd.join("codex-home").into_os_string())
        );
        assert!(!codex.contains_key(OsStr::new("ANTHROPIC_API_KEY")));
        assert!(!codex.contains_key(OsStr::new("OPENAI_API_KEY")));
        assert!(!codex.contains_key(OsStr::new("HTTPS_PROXY")));

        assert!(opencode.contains_key(OsStr::new("ANTHROPIC_API_KEY")));
        assert!(opencode.contains_key(OsStr::new("OPENAI_API_KEY")));
        assert!(opencode.contains_key(OsStr::new("HTTPS_PROXY")));
        assert!(!opencode.contains_key(OsStr::new("CODEX_API_KEY")));
        assert_eq!(
            opencode.get(OsStr::new("XDG_DATA_HOME")),
            Some(&cwd.join("opencode-data").into_os_string())
        );
    }

    #[test]
    fn final_environment_rejects_protected_overrides_without_leaking_values() {
        let secret = "private-loader-secret";
        let error = controlled_environment_for_agent(
            BTreeMap::new(),
            &[(OsString::from("NODE_OPTIONS"), OsString::from(secret))],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
        assert!(!format!("{error:?}").contains(secret));
    }

    #[test]
    fn claude_custom_headers_require_an_explicit_provider_base_url() {
        let inherited = BTreeMap::from([(
            OsString::from("ANTHROPIC_CUSTOM_HEADERS"),
            OsString::from("authorization: private-header"),
        )]);
        let without_base = controlled_environment_for_agent(
            inherited.clone(),
            &[],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap();
        let mut with_empty_base_inherited = inherited.clone();
        with_empty_base_inherited.insert(OsString::from("ANTHROPIC_BASE_URL"), OsString::new());
        let with_empty_base = controlled_environment_for_agent(
            with_empty_base_inherited,
            &[],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap();
        let mut with_base_inherited = inherited;
        with_base_inherited.insert(
            OsString::from("ANTHROPIC_BASE_URL"),
            OsString::from("https://provider.invalid"),
        );
        let with_base = controlled_environment_for_agent(
            with_base_inherited,
            &[],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap();

        assert!(!without_base.contains_key(OsStr::new("ANTHROPIC_CUSTOM_HEADERS")));
        assert!(!with_empty_base.contains_key(OsStr::new("ANTHROPIC_CUSTOM_HEADERS")));
        assert!(with_base.contains_key(OsStr::new("ANTHROPIC_CUSTOM_HEADERS")));
    }

    #[test]
    fn claude_preserves_reviewed_routing_vars_and_gates_skip_auth_flags() {
        let mut inherited = BTreeMap::from([
            (
                OsString::from("ANTHROPIC_WORKSPACE_ID"),
                OsString::from("workspace"),
            ),
            (
                OsString::from("ANTHROPIC_BEDROCK_REGION_PREFIX"),
                OsString::from("us"),
            ),
            (
                OsString::from("ANTHROPIC_BEDROCK_SERVICE_TIER"),
                OsString::from("priority"),
            ),
            (
                OsString::from("ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION"),
                OsString::from("us-east-1"),
            ),
            (
                OsString::from("ANTHROPIC_MODEL"),
                OsString::from("primary-model"),
            ),
            (
                OsString::from("ANTHROPIC_DEFAULT_OPUS_MODEL"),
                OsString::from("opus-model"),
            ),
            (
                OsString::from("ANTHROPIC_DEFAULT_SONNET_MODEL"),
                OsString::from("sonnet-model"),
            ),
            (
                OsString::from("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
                OsString::from("haiku-model"),
            ),
            (
                OsString::from("ANTHROPIC_DEFAULT_FABLE_MODEL"),
                OsString::from("fable-model"),
            ),
        ]);
        for (skip, use_name, base_name) in [
            (
                "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
                "CLAUDE_CODE_USE_BEDROCK",
                "ANTHROPIC_BEDROCK_BASE_URL",
            ),
            (
                "CLAUDE_CODE_SKIP_MANTLE_AUTH",
                "CLAUDE_CODE_USE_MANTLE",
                "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
            ),
            (
                "CLAUDE_CODE_SKIP_VERTEX_AUTH",
                "CLAUDE_CODE_USE_VERTEX",
                "ANTHROPIC_VERTEX_BASE_URL",
            ),
            (
                "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
                "CLAUDE_CODE_USE_FOUNDRY",
                "ANTHROPIC_FOUNDRY_BASE_URL",
            ),
        ] {
            inherited.insert(OsString::from(skip), OsString::from("1"));
            inherited.insert(OsString::from(use_name), OsString::from("1"));
            inherited.insert(
                OsString::from(base_name),
                OsString::from("https://provider.invalid"),
            );
        }
        let environment = controlled_environment_for_agent(
            inherited,
            &[],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap();

        for name in [
            "ANTHROPIC_WORKSPACE_ID",
            "ANTHROPIC_BEDROCK_REGION_PREFIX",
            "ANTHROPIC_BEDROCK_SERVICE_TIER",
            "ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION",
            "ANTHROPIC_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "ANTHROPIC_DEFAULT_FABLE_MODEL",
            "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
            "CLAUDE_CODE_SKIP_MANTLE_AUTH",
            "CLAUDE_CODE_SKIP_VERTEX_AUTH",
            "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
        ] {
            assert!(environment.contains_key(OsStr::new(name)), "missing {name}");
        }

        let ungated = controlled_environment_for_agent(
            BTreeMap::from([
                (
                    OsString::from("CLAUDE_CODE_SKIP_BEDROCK_AUTH"),
                    OsString::from("1"),
                ),
                (
                    OsString::from("CLAUDE_CODE_USE_BEDROCK"),
                    OsString::from("1"),
                ),
                (
                    OsString::from("ANTHROPIC_BEDROCK_BASE_URL"),
                    OsString::new(),
                ),
                (
                    OsString::from("CLAUDE_CODE_SKIP_VERTEX_AUTH"),
                    OsString::from("1"),
                ),
                (
                    OsString::from("ANTHROPIC_VERTEX_BASE_URL"),
                    OsString::from("https://provider.invalid"),
                ),
            ]),
            &[],
            Path::new("/private/owned-agent-dir"),
            LocalAgentKind::Claude,
            OsStr::new("/usr/bin:/bin"),
        )
        .unwrap();

        assert!(!ungated.contains_key(OsStr::new("CLAUDE_CODE_SKIP_BEDROCK_AUTH")));
        assert!(!ungated.contains_key(OsStr::new("CLAUDE_CODE_SKIP_VERTEX_AUTH")));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn opencode_uses_private_xdg_roots_and_a_bounded_owned_auth_copy() {
        let home = tempdir().unwrap();
        let source_directory = home.path().join(".local/share/opencode");
        fs::create_dir_all(&source_directory).unwrap();
        let source_auth = source_directory.join("auth.json");
        let secret = br#"{"token":"private-opencode-auth"}"#;
        let mut source_options = fs::OpenOptions::new();
        source_options.write(true).create_new(true).mode(0o600);
        std::io::Write::write_all(&mut source_options.open(&source_auth).unwrap(), secret).unwrap();
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n\
             /bin/cat >/dev/null\n\
             [ \"$XDG_CONFIG_HOME\" = \"$PWD/opencode-config\" ] || exit 11\n\
             [ \"$XDG_CACHE_HOME\" = \"$PWD/opencode-cache\" ] || exit 12\n\
             [ \"$XDG_DATA_HOME\" = \"$PWD/opencode-data\" ] || exit 13\n\
             [ \"$XDG_STATE_HOME\" = \"$PWD/opencode-state\" ] || exit 14\n\
             [ \"$OPENCODE_DISABLE_CLAUDE_CODE\" = 1 ] || exit 15\n\
             [ \"$OPENCODE_DISABLE_DEFAULT_PLUGINS\" = true ] || exit 16\n\
             [ -f \"$XDG_DATA_HOME/opencode/auth.json\" ] || exit 17\n\
             /bin/rm \"$XDG_DATA_HOME/opencode/auth.json\"\n\
             printf '{\"rotated\":true}' > \"$XDG_DATA_HOME/opencode/auth.json\"\n\
             /bin/chmod 600 \"$XDG_DATA_HOME/opencode/auth.json\"\n\
             printf isolated",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            LocalAgentKind::Opencode,
            BTreeMap::from([
                (OsString::from("HOME"), home.path().as_os_str().to_owned()),
                (
                    OsString::from("XDG_CONFIG_HOME"),
                    OsString::from("/tmp/attacker"),
                ),
            ]),
        )
        .unwrap();
        for directory in [
            "opencode-config",
            "opencode-cache",
            "opencode-data",
            "opencode-state",
            "opencode-data/opencode",
        ] {
            assert_eq!(
                fs::metadata(owned_path.join(directory))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        let copied_auth = owned_path.join("opencode-data/opencode/auth.json");
        assert_eq!(fs::read(&copied_auth).unwrap(), secret);
        assert_eq!(
            fs::metadata(&copied_auth).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(!format!("{prepared:?}").contains("private-opencode-auth"));

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();

        assert_eq!(output.stdout, b"isolated");
        assert_eq!(fs::read(&source_auth).unwrap(), secret);
        output.close_temp_dir().unwrap();
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[test]
    fn opencode_rejects_symlinked_auth_without_reading_or_modifying_its_target() {
        let home = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let source_directory = home.path().join(".local/share/opencode");
        fs::create_dir_all(&source_directory).unwrap();
        let outside_auth = outside.path().join("auth.json");
        fs::write(&outside_auth, b"outside-private-auth").unwrap();
        std::os::unix::fs::symlink(&outside_auth, source_directory.join("auth.json")).unwrap();
        let (_executable_dir, executable) = fake_executable("#!/bin/sh\nexit 0");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();

        let error = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            LocalAgentKind::Opencode,
            BTreeMap::from([(OsString::from("HOME"), home.path().as_os_str().to_owned())]),
        )
        .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
        assert_eq!(fs::read(outside_auth).unwrap(), b"outside-private-auth");
        assert!(!owned_path.exists());
        assert!(!format!("{error:?}").contains("outside-private-auth"));
    }

    #[cfg(unix)]
    #[test]
    fn opencode_copies_auth_from_validated_custom_xdg_data_home_without_forwarding_it() {
        let home = tempdir().unwrap();
        let custom_data = tempdir().unwrap();
        let custom_auth_directory = custom_data.path().join("opencode");
        fs::create_dir(&custom_auth_directory).unwrap();
        let custom_auth = custom_auth_directory.join("auth.json");
        let secret = br#"{"token":"custom-xdg-auth"}"#;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true).mode(0o600);
        std::io::Write::write_all(&mut options.open(&custom_auth).unwrap(), secret).unwrap();
        let (_executable_dir, executable) = fake_executable("#!/bin/sh\nexit 0");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();

        let prepared = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            LocalAgentKind::Opencode,
            BTreeMap::from([
                (OsString::from("HOME"), home.path().as_os_str().to_owned()),
                (
                    OsString::from("XDG_DATA_HOME"),
                    custom_data.path().as_os_str().to_owned(),
                ),
            ]),
        )
        .unwrap();

        assert_eq!(
            fs::read(owned_path.join("opencode-data/opencode/auth.json")).unwrap(),
            secret
        );
        assert!(!format!("{prepared:?}").contains("custom-xdg-auth"));
        drop(prepared);
        assert!(!owned_path.exists());
        assert_eq!(fs::read(custom_auth).unwrap(), secret);
    }

    #[cfg(unix)]
    #[test]
    fn opencode_rejects_oversized_auth_without_retaining_private_copies() {
        let home = tempdir().unwrap();
        let source_directory = home.path().join(".local/share/opencode");
        fs::create_dir_all(&source_directory).unwrap();
        let source_auth = source_directory.join("auth.json");
        let mut source_options = fs::OpenOptions::new();
        source_options.write(true).create_new(true).mode(0o600);
        std::io::Write::write_all(
            &mut source_options.open(&source_auth).unwrap(),
            &vec![b'x'; super::MAX_AGENT_AUTH_BYTES + 1],
        )
        .unwrap();
        let (_executable_dir, executable) = fake_executable("#!/bin/sh\nexit 0");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();

        let error = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            LocalAgentKind::Opencode,
            BTreeMap::from([(OsString::from("HOME"), home.path().as_os_str().to_owned())]),
        )
        .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_uses_a_private_home_with_only_an_owned_auth_copy() {
        let home = tempdir().unwrap();
        let source_directory = home.path().join(".codex");
        fs::create_dir(&source_directory).unwrap();
        fs::set_permissions(&source_directory, fs::Permissions::from_mode(0o700)).unwrap();
        let source_auth = source_directory.join("auth.json");
        let source_agents = source_directory.join("AGENTS.md");
        let secret = br#"{"tokens":{"access_token":"private-codex-auth"}}"#;
        let mut source_options = fs::OpenOptions::new();
        source_options.write(true).create_new(true).mode(0o600);
        std::io::Write::write_all(&mut source_options.open(&source_auth).unwrap(), secret).unwrap();
        fs::write(&source_agents, b"global rules must not be copied").unwrap();
        let (executable_dir, executable) = fake_executable(
            "#!/bin/sh\n\
             /bin/cat >/dev/null\n\
             [ \"$CODEX_HOME\" = \"$PWD/codex-home\" ] || exit 21\n\
             [ -f \"$CODEX_HOME/auth.json\" ] || exit 22\n\
             [ ! -e \"$CODEX_HOME/AGENTS.md\" ] || exit 23\n\
             printf isolated",
        );
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();
        let prepared = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            LocalAgentKind::Codex,
            BTreeMap::from([(OsString::from("HOME"), home.path().as_os_str().to_owned())]),
        )
        .unwrap();
        let copied_auth = owned_path.join("codex-home/auth.json");
        assert_eq!(
            fs::metadata(owned_path.join("codex-home"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(fs::read(&copied_auth).unwrap(), secret);
        assert_eq!(
            fs::metadata(&copied_auth).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(!owned_path.join("codex-home/AGENTS.md").exists());
        assert!(!format!("{prepared:?}").contains("private-codex-auth"));

        let mut output = run_process(prepared, CancellationToken::new(), Duration::from_secs(1))
            .await
            .unwrap();

        assert_eq!(output.stdout, b"isolated");
        assert_eq!(
            fs::read(&source_agents).unwrap(),
            b"global rules must not be copied"
        );
        output.close_temp_dir().unwrap();
        assert!(!owned_path.exists());
        assert!(executable_dir.path().exists());
    }

    #[cfg(unix)]
    #[test]
    fn codex_rejects_symlinked_auth_without_reading_its_target() {
        let home = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let source_directory = home.path().join(".codex");
        fs::create_dir(&source_directory).unwrap();
        let outside_auth = outside.path().join("auth.json");
        fs::write(&outside_auth, br#"{"token":"outside-private-auth"}"#).unwrap();
        std::os::unix::fs::symlink(&outside_auth, source_directory.join("auth.json")).unwrap();
        let (_executable_dir, executable) = fake_executable("#!/bin/sh\nexit 0");
        let owned_temp = create_owned_temp_dir().unwrap();
        let owned_path = owned_temp.path().to_path_buf();

        let error = prepare_owned_for_kind_with_environment(
            invocation(executable, &owned_path, Vec::new(), None),
            owned_temp,
            LocalAgentKind::Codex,
            BTreeMap::from([(OsString::from("HOME"), home.path().as_os_str().to_owned())]),
        )
        .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
        assert_eq!(
            fs::read(outside_auth).unwrap(),
            br#"{"token":"outside-private-auth"}"#
        );
        assert!(!owned_path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn malformed_or_oversized_codex_auth_fails_closed_without_private_copies() {
        for bytes in [
            b"[] trailing".to_vec(),
            vec![b'x'; super::MAX_AGENT_AUTH_BYTES + 1],
        ] {
            let home = tempdir().unwrap();
            let source_directory = home.path().join(".codex");
            fs::create_dir(&source_directory).unwrap();
            let mut source_options = fs::OpenOptions::new();
            source_options.write(true).create_new(true).mode(0o600);
            std::io::Write::write_all(
                &mut source_options
                    .open(source_directory.join("auth.json"))
                    .unwrap(),
                &bytes,
            )
            .unwrap();
            let (_executable_dir, executable) = fake_executable("#!/bin/sh\nexit 0");
            let owned_temp = create_owned_temp_dir().unwrap();
            let owned_path = owned_temp.path().to_path_buf();

            let error = prepare_owned_for_kind_with_environment(
                invocation(executable, &owned_path, Vec::new(), None),
                owned_temp,
                LocalAgentKind::Codex,
                BTreeMap::from([(OsString::from("HOME"), home.path().as_os_str().to_owned())]),
            )
            .unwrap_err();

            assert_eq!(error.code, "invalid_environment");
            assert!(!owned_path.exists());
            assert!(!format!("{error:?}").contains("trailing"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn inherited_path_is_canonical_deduplicated_and_limited_to_safe_directories() {
        let root = tempdir().unwrap();
        let safe = root.path().join("safe-bin");
        let unsafe_writable = root.path().join("writable-bin");
        let not_a_directory = root.path().join("plain-file");
        let safe_alias = root.path().join("safe-alias");
        fs::create_dir(&safe).unwrap();
        fs::create_dir(&unsafe_writable).unwrap();
        fs::write(&not_a_directory, b"not a directory").unwrap();
        fs::set_permissions(&safe, fs::Permissions::from_mode(0o755)).unwrap();
        fs::set_permissions(&unsafe_writable, fs::Permissions::from_mode(0o777)).unwrap();
        std::os::unix::fs::symlink(&safe, &safe_alias).unwrap();
        let inherited_path = env::join_paths([
            PathBuf::new(),
            PathBuf::from("relative-bin"),
            safe_alias,
            safe.clone(),
            unsafe_writable,
            not_a_directory,
            root.path().join("missing"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ])
        .unwrap();
        let inherited = BTreeMap::from([(OsString::from("PATH"), inherited_path)]);

        let environment =
            controlled_environment(inherited, &[], Path::new("/private/owned-agent-dir")).unwrap();
        let normalized =
            env::split_paths(environment.get(&OsString::from("PATH")).unwrap()).collect::<Vec<_>>();
        let mut expected = vec![safe.canonicalize().unwrap()];
        for system_directory in [PathBuf::from("/usr/bin"), PathBuf::from("/bin")] {
            let canonical = system_directory.canonicalize().unwrap();
            if !expected.contains(&canonical) {
                expected.push(canonical);
            }
        }

        assert_eq!(normalized, expected);
    }

    #[cfg(unix)]
    #[test]
    fn inherited_path_without_any_safe_directory_fails_closed() {
        let root = tempdir().unwrap();
        let unsafe_writable = root.path().join("writable-bin");
        fs::create_dir(&unsafe_writable).unwrap();
        fs::set_permissions(&unsafe_writable, fs::Permissions::from_mode(0o777)).unwrap();
        let inherited = BTreeMap::from([(
            OsString::from("PATH"),
            env::join_paths([PathBuf::new(), PathBuf::from("relative"), unsafe_writable]).unwrap(),
        )]);

        let error = controlled_environment(inherited, &[], Path::new("/private/owned-agent-dir"))
            .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
    }

    #[cfg(unix)]
    #[test]
    fn inherited_path_rejects_a_safe_leaf_below_a_writable_ancestor() {
        let root = tempdir().unwrap();
        let writable_parent = root.path().join("writable-parent");
        let safe_leaf = writable_parent.join("safe-leaf");
        fs::create_dir(&writable_parent).unwrap();
        fs::create_dir(&safe_leaf).unwrap();
        fs::set_permissions(&writable_parent, fs::Permissions::from_mode(0o777)).unwrap();
        fs::set_permissions(&safe_leaf, fs::Permissions::from_mode(0o755)).unwrap();
        let inherited =
            BTreeMap::from([(OsString::from("PATH"), safe_leaf.as_os_str().to_owned())]);

        let error = controlled_environment(inherited, &[], Path::new("/private/owned-agent-dir"))
            .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
    }

    #[cfg(unix)]
    #[test]
    fn inherited_home_rejects_a_user_owned_leaf_below_a_writable_ancestor() {
        let root = tempdir().unwrap();
        let writable_parent = root.path().join("writable-parent");
        let home = writable_parent.join("home");
        fs::create_dir(&writable_parent).unwrap();
        fs::create_dir(&home).unwrap();
        fs::set_permissions(&writable_parent, fs::Permissions::from_mode(0o777)).unwrap();
        fs::set_permissions(&home, fs::Permissions::from_mode(0o700)).unwrap();
        let inherited = BTreeMap::from([
            (OsString::from("HOME"), home.as_os_str().to_owned()),
            (OsString::from("PATH"), OsString::from("/usr/bin:/bin")),
        ]);

        let error = controlled_environment(inherited, &[], Path::new("/private/owned-agent-dir"))
            .unwrap_err();

        assert_eq!(error.code, "invalid_environment");
    }

    #[cfg(unix)]
    #[test]
    fn preparation_requires_user_only_owned_paths_and_bounded_stdin() {
        let (_executable_dir, executable) = fake_executable("#!/bin/sh\nexit 0");
        let owned_temp = create_owned_temp_dir().unwrap();
        assert_eq!(
            fs::metadata(owned_temp.path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        let mut oversized = invocation(executable, owned_temp.path(), Vec::new(), None);
        oversized.stdin = vec![b'x'; MAX_PROCESS_STDIN_BYTES + 1];
        let error = prepare_owned(oversized, owned_temp).unwrap_err();
        assert_eq!(error.code, "request_too_large");
    }

    #[cfg(unix)]
    fn process_exists(pid: i32) -> bool {
        if unsafe { libc::kill(pid, 0) } != 0 {
            return false;
        }
        #[cfg(target_os = "macos")]
        {
            let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::uninit();
            let info_size = std::mem::size_of::<libc::proc_bsdinfo>();
            let read = unsafe {
                libc::proc_pidinfo(
                    pid,
                    libc::PROC_PIDTBSDINFO,
                    0,
                    info.as_mut_ptr().cast(),
                    i32::try_from(info_size).unwrap(),
                )
            };
            read == i32::try_from(info_size).unwrap()
                && unsafe { info.assume_init() }.pbi_status != libc::SZOMB
        }
        #[cfg(not(target_os = "macos"))]
        {
            true
        }
    }
}
