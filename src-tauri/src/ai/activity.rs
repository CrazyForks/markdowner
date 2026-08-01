use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};

use super::{AiError, openrouter::AiTask};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiDocumentRef {
    pub document_id: String,
    pub path: Option<String>,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AiRunScope {
    Document {
        target: AiDocumentRef,
    },
    Workspace {
        root_path: String,
        target: Option<AiDocumentRef>,
        document_count: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActiveStatus {
    Queued,
    Running,
    Cancelling,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityProgress {
    pub stage: String,
    pub file_completed: Option<u32>,
    pub file_total: Option<u32>,
    pub chunk_completed: Option<u32>,
    pub chunk_total: Option<u32>,
    pub label: Option<String>,
    pub received_characters: usize,
}

impl ActivityProgress {
    #[cfg(test)]
    pub fn translation(
        file_completed: u32,
        file_total: u32,
        chunk_completed: u32,
        chunk_total: u32,
        label: impl Into<String>,
    ) -> Self {
        Self {
            stage: "translating".to_string(),
            file_completed: Some(file_completed),
            file_total: Some(file_total),
            chunk_completed: Some(chunk_completed),
            chunk_total: Some(chunk_total),
            label: Some(label.into()),
            received_characters: 0,
        }
    }

    pub fn streaming(received_characters: usize) -> Self {
        Self {
            stage: "streaming".to_string(),
            received_characters,
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveAiRun {
    pub request_id: String,
    pub task: AiTask,
    pub model: String,
    pub scope: AiRunScope,
    pub status: ActiveStatus,
    pub progress: ActivityProgress,
    pub started_at: i64,
    pub cancelable: bool,
}

#[derive(Debug, Clone, Default)]
pub struct ActivityRegistry {
    inner: Arc<Mutex<HashMap<String, ActiveAiRun>>>,
}

impl ActivityRegistry {
    pub fn start(&self, run: ActiveAiRun) -> Result<(), AiError> {
        let mut active = self.lock()?;
        if active.contains_key(&run.request_id) {
            return Err(AiError::new(
                "activity_conflict",
                "This AI request is already active.",
            ));
        }
        active.insert(run.request_id.clone(), run);
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<ActiveAiRun>, AiError> {
        let mut active = self.lock()?.values().cloned().collect::<Vec<_>>();
        active.sort_by(|left, right| {
            left.started_at
                .cmp(&right.started_at)
                .then_with(|| left.request_id.cmp(&right.request_id))
        });
        Ok(active)
    }

    pub fn progress(&self, request_id: &str, progress: ActivityProgress) -> Result<(), AiError> {
        let mut active = self.lock()?;
        let run = active.get_mut(request_id).ok_or_else(activity_not_found)?;
        run.progress = progress;
        Ok(())
    }

    pub fn mark_cancelling(&self, request_id: &str) -> Result<bool, AiError> {
        let mut active = self.lock()?;
        let Some(run) = active.get_mut(request_id) else {
            return Ok(false);
        };
        run.status = ActiveStatus::Cancelling;
        run.cancelable = false;
        Ok(true)
    }

    pub fn finish(&self, request_id: &str) -> Result<bool, AiError> {
        Ok(self.lock()?.remove(request_id).is_some())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, ActiveAiRun>>, AiError> {
        self.inner.lock().map_err(|_| {
            AiError::new(
                "activity_unavailable",
                "AI request activity is temporarily unavailable.",
            )
        })
    }
}

fn activity_not_found() -> AiError {
    AiError::new("activity_not_found", "This AI request is no longer active.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::openrouter::AiTask;

    fn fixture_activity(request_id: &str, started_at: i64) -> ActiveAiRun {
        ActiveAiRun {
            request_id: request_id.to_string(),
            task: AiTask::Translation,
            model: "z-ai/glm-5.2".to_string(),
            scope: AiRunScope::Document {
                target: AiDocumentRef {
                    document_id: "doc-a".to_string(),
                    path: Some("notes/a.md".to_string()),
                    label: "a.md".to_string(),
                },
            },
            status: ActiveStatus::Running,
            progress: ActivityProgress::default(),
            started_at,
            cancelable: true,
        }
    }

    #[test]
    fn registry_reports_progress_in_start_order_and_removes_terminal_runs() {
        let registry = ActivityRegistry::default();
        registry.start(fixture_activity("run-2", 20)).unwrap();
        registry.start(fixture_activity("run-1", 10)).unwrap();
        registry
            .progress(
                "run-1",
                ActivityProgress::translation(2, 5, 3, 8, "Architecture"),
            )
            .unwrap();

        let active = registry.list().unwrap();
        assert_eq!(
            active
                .iter()
                .map(|run| run.request_id.as_str())
                .collect::<Vec<_>>(),
            vec!["run-1", "run-2"]
        );
        assert_eq!(active[0].progress.chunk_completed, Some(3));
        assert_eq!(active[0].progress.label.as_deref(), Some("Architecture"));

        assert!(registry.mark_cancelling("run-1").unwrap());
        assert_eq!(registry.list().unwrap()[0].status, ActiveStatus::Cancelling);
        registry.finish("run-1").unwrap();
        assert_eq!(registry.list().unwrap().len(), 1);
    }

    #[test]
    fn duplicate_and_missing_transitions_fail_closed() {
        let registry = ActivityRegistry::default();
        registry.start(fixture_activity("run-1", 10)).unwrap();

        assert_eq!(
            registry
                .start(fixture_activity("run-1", 11))
                .unwrap_err()
                .code,
            "activity_conflict"
        );
        assert_eq!(
            registry
                .progress("missing", ActivityProgress::default())
                .unwrap_err()
                .code,
            "activity_not_found"
        );
        assert!(!registry.mark_cancelling("missing").unwrap());
    }
}
