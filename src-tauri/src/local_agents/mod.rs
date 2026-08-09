use std::{ffi::OsString, fmt, path::PathBuf};

use markdowner_core::ai_document::ByteRange;
use serde::{Deserialize, Serialize};

pub mod adapters;
mod discovery;

pub fn discover_all() -> Vec<LocalAgentStatus> {
    discovery::discover_all()
}

pub fn resolve_compatible_agent(kind: LocalAgentKind) -> Result<ResolvedAgent, LocalAgentError> {
    discovery::resolve_compatible_agent(kind)
}

pub(crate) fn login_shell_path_value() -> Option<OsString> {
    discovery::login_shell_path_value()
}

pub(super) const OPEN_CODE_OWNED_AGENT: &str = "markdowner";

const OPEN_CODE_CONFIG_CONTENT: &str = r#"{"share":"disabled","default_agent":"markdowner","tools":{"*":false,"edit":false},"permission":{"*":"deny","read":"deny","edit":"deny","glob":"deny","grep":"deny","list":"deny","bash":"deny","task":"deny","skill":"deny","lsp":"deny","question":"deny","webfetch":"deny","websearch":"deny","external_directory":"deny","todowrite":"deny","doom_loop":"deny"},"agent":{"markdowner":{"mode":"primary","tools":{"*":false,"edit":false},"permission":{"*":"deny","read":"deny","edit":"deny","glob":"deny","grep":"deny","list":"deny","bash":"deny","task":"deny","skill":"deny","lsp":"deny","question":"deny","webfetch":"deny","websearch":"deny","external_directory":"deny","todowrite":"deny","doom_loop":"deny"}}}}"#;

pub(super) fn owned_opencode_environment() -> Vec<(OsString, OsString)> {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalAgentKind {
    Claude,
    Codex,
    Opencode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalAgentTargetKind {
    Insert,
    Selection,
    Document,
}

impl LocalAgentTargetKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::Selection => "selection",
            Self::Document => "document",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAgentRunRequest {
    pub request_id: String,
    pub document_id: String,
    pub agent: LocalAgentKind,
    pub target: LocalAgentTargetKind,
    pub source: String,
    pub selection: Option<ByteRange>,
    pub cursor: Option<usize>,
    pub instruction: String,
}

impl LocalAgentKind {
    pub const ALL: [Self; 3] = [Self::Claude, Self::Codex, Self::Opencode];

    pub const fn executable_basename(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Opencode => "opencode",
        }
    }

    pub const fn mention(self) -> &'static str {
        match self {
            Self::Claude => "@claude",
            Self::Codex => "@codex",
            Self::Opencode => "@opencode",
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
            Self::Opencode => "OpenCode",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentStatus {
    pub kind: LocalAgentKind,
    pub mention: &'static str,
    pub label: &'static str,
    pub installed: bool,
    pub compatible: bool,
    pub path_label: Option<String>,
    pub version: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, PartialEq, Eq)]
pub struct ResolvedAgent {
    pub kind: LocalAgentKind,
    pub path: PathBuf,
    pub path_label: String,
}

impl fmt::Debug for ResolvedAgent {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ResolvedAgent")
            .field("kind", &self.kind)
            .field("path_label", &self.path_label)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalAgentError {
    NotInstalled,
    ProbeSpawnFailed,
    ProbeTimedOut,
    ProbeOutputTooLarge,
    MalformedProbeOutput,
    ProbeFailed,
    Incompatible(&'static str),
    InvalidAdapterRequest,
    AdapterSetupFailed,
    InvalidAdapterResult,
}

impl LocalAgentError {
    pub const fn reason(self) -> &'static str {
        match self {
            Self::NotInstalled => "Executable was not found in PATH.",
            Self::ProbeSpawnFailed => "Capability probe could not start.",
            Self::ProbeTimedOut => discovery::CAPABILITY_PROBE_TIMEOUT_REASON,
            Self::ProbeOutputTooLarge => "Capability probe output exceeded the safe limit.",
            Self::MalformedProbeOutput => "Capability probe returned malformed output.",
            Self::ProbeFailed => "Capability probe failed.",
            Self::Incompatible(reason) => reason,
            Self::InvalidAdapterRequest => "The local agent request is invalid.",
            Self::AdapterSetupFailed => "The local agent could not be prepared.",
            Self::InvalidAdapterResult => "The agent returned an invalid result.",
        }
    }
}

impl fmt::Display for LocalAgentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.reason())
    }
}

impl std::error::Error for LocalAgentError {}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{LocalAgentKind, LocalAgentStatus};

    #[test]
    fn fixed_registry_exposes_only_the_three_supported_executables() {
        assert_eq!(
            LocalAgentKind::ALL.map(LocalAgentKind::executable_basename),
            ["claude", "codex", "opencode"]
        );
        assert_eq!(
            LocalAgentKind::ALL.map(LocalAgentKind::mention),
            ["@claude", "@codex", "@opencode"]
        );
        assert_eq!(
            LocalAgentKind::ALL.map(LocalAgentKind::label),
            ["Claude Code", "Codex", "OpenCode"]
        );
    }

    #[test]
    fn status_serialization_is_camel_case_and_contains_only_a_redacted_path_label() {
        let status = LocalAgentStatus {
            kind: LocalAgentKind::Claude,
            mention: "@claude",
            label: "Claude Code",
            installed: true,
            compatible: false,
            path_label: Some("bin/claude".to_string()),
            version: Some("2.1.226".to_string()),
            reason: Some("Required Claude Code safety flags are unavailable.".to_string()),
        };

        assert_eq!(
            serde_json::to_value(status).unwrap(),
            json!({
                "kind": "claude",
                "mention": "@claude",
                "label": "Claude Code",
                "installed": true,
                "compatible": false,
                "pathLabel": "bin/claude",
                "version": "2.1.226",
                "reason": "Required Claude Code safety flags are unavailable."
            })
        );
    }

    #[test]
    fn resolved_agent_debug_output_redacts_the_canonical_path() {
        let resolved = super::ResolvedAgent {
            kind: LocalAgentKind::Claude,
            path: "/private/secret-user/bin/claude".into(),
            path_label: "bin/claude".to_string(),
        };

        let debug = format!("{resolved:?}");

        assert!(debug.contains("bin/claude"));
        assert!(!debug.contains("private/secret-user"));
    }
}
