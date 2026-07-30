use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{Map, Value, json};

const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "markdowner.log";
const ROTATED_LOG_FILE_NAME: &str = "markdowner.log.1";
const DEFAULT_MAX_LOG_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsLogStatus {
    pub enabled: bool,
    pub log_path: Option<String>,
}

pub fn diagnostics_log_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(LOG_DIR_NAME).join(LOG_FILE_NAME)
}

pub fn diagnostics_status(app_data_dir: &Path, enabled: bool) -> DiagnosticsLogStatus {
    DiagnosticsLogStatus {
        enabled,
        log_path: Some(
            diagnostics_log_path(app_data_dir)
                .to_string_lossy()
                .into_owned(),
        ),
    }
}

pub fn ensure_diagnostics_log_file(app_data_dir: &Path) -> io::Result<PathBuf> {
    let log_path = diagnostics_log_path(app_data_dir);
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)?;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    Ok(log_path)
}

pub fn write_diagnostics_event(
    app_data_dir: &Path,
    event_name: &str,
    payload: Value,
) -> io::Result<PathBuf> {
    write_diagnostics_event_with_limit(app_data_dir, event_name, payload, DEFAULT_MAX_LOG_BYTES)
}

pub fn write_diagnostics_event_with_limit(
    app_data_dir: &Path,
    event_name: &str,
    payload: Value,
    max_log_bytes: u64,
) -> io::Result<PathBuf> {
    let event_name = event_name.trim();
    if event_name.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "diagnostics event name cannot be empty",
        ));
    }

    let log_path = diagnostics_log_path(app_data_dir);
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let line = render_event_line(event_name, sanitize_payload(event_name, payload))?;
    rotate_log_if_needed(&log_path, line.len() as u64, max_log_bytes)?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    file.write_all(line.as_bytes())?;
    file.flush()?;
    file.sync_data()?;

    Ok(log_path)
}

fn render_event_line(event_name: &str, payload: Value) -> io::Result<String> {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let mut line = serde_json::to_string(&json!({
        "timestampMs": timestamp_ms,
        "event": event_name,
        "payload": payload,
    }))
    .map_err(io::Error::other)?;
    line.push('\n');
    Ok(line)
}

fn sanitize_payload(event_name: &str, payload: Value) -> Value {
    if event_name == "ai.lifecycle" {
        let Value::Object(payload) = payload else {
            return Value::Object(Map::new());
        };
        let allowed = [
            "lifecycle",
            "task",
            "model",
            "promptTokens",
            "completionTokens",
            "totalTokens",
            "costUsd",
            "durationMs",
            "errorCode",
            "generationId",
        ];
        return Value::Object(
            payload
                .into_iter()
                .filter(|(key, _)| allowed.contains(&key.as_str()))
                .map(|(key, value)| (key, sanitize_value(value)))
                .collect(),
        );
    }
    sanitize_value(payload)
}

fn sanitize_value(value: Value) -> Value {
    match value {
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .filter(|(key, _)| !forbidden_diagnostics_key(key))
                .map(|(key, value)| (key, sanitize_value(value)))
                .collect(),
        ),
        Value::Array(values) => {
            Value::Array(values.into_iter().map(sanitize_value).collect::<Vec<_>>())
        }
        Value::String(value) if contains_credential_pattern(&value) => {
            Value::String("[redacted]".to_string())
        }
        other => other,
    }
}

fn forbidden_diagnostics_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    [
        "apikey",
        "authorization",
        "credential",
        "secret",
        "prompt",
        "source",
        "response",
        "translation",
        "diff",
        "content",
        "path",
        "document",
        "selection",
    ]
    .iter()
    .any(|forbidden| normalized.contains(forbidden))
}

fn contains_credential_pattern(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    normalized.contains("sk-or-") || normalized.contains("bearer ")
}

fn rotate_log_if_needed(
    log_path: &Path,
    incoming_bytes: u64,
    max_log_bytes: u64,
) -> io::Result<()> {
    if max_log_bytes == 0 || !log_path.exists() {
        return Ok(());
    }

    let current_bytes = fs::metadata(log_path)?.len();
    if current_bytes.saturating_add(incoming_bytes) <= max_log_bytes {
        return Ok(());
    }

    let rotated_path = log_path.with_file_name(ROTATED_LOG_FILE_NAME);
    if rotated_path.exists() {
        fs::remove_file(&rotated_path)?;
    }
    fs::rename(log_path, rotated_path)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;
    use tempfile::tempdir;

    use super::{
        diagnostics_log_path, diagnostics_status, ensure_diagnostics_log_file,
        write_diagnostics_event, write_diagnostics_event_with_limit,
    };

    #[test]
    fn disabled_status_reports_log_path_without_creating_log_directory() {
        let temp = tempdir().unwrap();

        let status = diagnostics_status(temp.path(), false);

        assert!(!status.enabled);
        assert_eq!(
            status.log_path.as_deref(),
            Some(diagnostics_log_path(temp.path()).to_string_lossy().as_ref())
        );
        assert!(!temp.path().join("logs").exists());
    }

    #[test]
    fn ensure_log_file_creates_empty_log_file_under_logs() {
        let temp = tempdir().unwrap();

        let log_path = ensure_diagnostics_log_file(temp.path()).unwrap();

        assert_eq!(log_path, diagnostics_log_path(temp.path()));
        assert!(log_path.exists());
        assert_eq!(fs::read_to_string(&log_path).unwrap(), "");
    }

    #[test]
    fn write_event_creates_json_log_under_app_data_logs() {
        let temp = tempdir().unwrap();

        let log_path = write_diagnostics_event(
            temp.path(),
            "settings.changed",
            json!({ "diagnosticsEnabled": true }),
        )
        .unwrap();

        assert_eq!(log_path, diagnostics_log_path(temp.path()));
        let contents = fs::read_to_string(&log_path).unwrap();
        assert!(contents.contains("\"event\":\"settings.changed\""));
        assert!(contents.contains("\"diagnosticsEnabled\":true"));
        assert!(contents.ends_with('\n'));
    }

    #[test]
    fn write_event_rotates_existing_log_when_limit_is_reached() {
        let temp = tempdir().unwrap();
        let log_path = diagnostics_log_path(temp.path());
        fs::create_dir_all(log_path.parent().unwrap()).unwrap();
        fs::write(&log_path, "stale log entry that should rotate\n").unwrap();

        write_diagnostics_event_with_limit(
            temp.path(),
            "settings.changed",
            json!({ "editorLineWrap": false }),
            16,
        )
        .unwrap();

        assert!(log_path.with_file_name("markdowner.log.1").exists());
        let contents = fs::read_to_string(&log_path).unwrap();
        assert!(contents.contains("\"event\":\"settings.changed\""));
        assert!(!contents.contains("stale log entry"));
    }

    #[test]
    fn write_event_removes_ai_secrets_and_document_content() {
        let temp = tempdir().unwrap();

        let log_path = write_diagnostics_event(
            temp.path(),
            "ai.lifecycle",
            json!({
                "lifecycle": "failed",
                "task": "translation",
                "model": "z-ai/glm-5.2",
                "errorCode": "invalid_schema",
                "apiKey": "sk-or-private-key",
                "authorization": "Bearer private-key",
                "prompt": "translate this secret",
                "source": "# private source",
                "response": "private response",
                "translation": "비밀 번역",
                "diff": "- old\n+ private",
                "path": "/Users/example/private.md",
                "selection": "private range"
            }),
        )
        .unwrap();

        let contents = fs::read_to_string(&log_path).unwrap();
        assert!(contents.contains("\"errorCode\":\"invalid_schema\""));
        assert!(contents.contains("\"model\":\"z-ai/glm-5.2\""));
        for secret in [
            "sk-or-private-key",
            "Bearer private-key",
            "translate this secret",
            "# private source",
            "private response",
            "비밀 번역",
            "/Users/example/private.md",
            "private range",
        ] {
            assert!(!contents.contains(secret), "leaked {secret}");
        }
    }
}
