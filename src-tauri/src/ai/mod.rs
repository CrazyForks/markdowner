use std::{
    collections::HashMap,
    fmt, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use markdowner_core::ai_document::{
    AiDocumentEnvelope, ByteRange, PrdResponse, SelectionResponse, TranslationResponse,
    ValidatedDocument, ValidationError, validate_prd_response, validate_selection_response,
    validate_translation,
};
use serde::{Deserialize, Serialize};
use tauri::{State, ipc::Channel};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

use self::{
    keychain::{AiKeyStatus, KeychainService},
    openrouter::{
        AiCompletionRequest, AiKeyMetadata, AiModel, AiModelPricing, AiTask, AiUsage,
        OpenRouterClient, redact_sensitive,
    },
};

#[cfg(test)]
mod evaluation;
pub mod keychain;
pub mod openrouter;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation_id: Option<String>,
}

impl AiError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retry_after_seconds: None,
            generation_id: None,
        }
    }
}

impl fmt::Display for AiError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for AiError {}

#[derive(Clone)]
pub struct RequestScheduler {
    inner: Arc<RequestSchedulerInner>,
}

struct RequestSchedulerInner {
    app_slots: Arc<Semaphore>,
    active: Mutex<HashMap<String, ActiveRequest>>,
}

struct ActiveRequest {
    request_id: String,
    cancellation: CancellationToken,
}

impl RequestScheduler {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RequestSchedulerInner {
                app_slots: Arc::new(Semaphore::new(2)),
                active: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub async fn acquire(
        &self,
        document_id: &str,
        request_id: &str,
    ) -> Result<RequestPermit, AiError> {
        self.try_acquire(document_id, request_id)
    }

    pub fn try_acquire(
        &self,
        document_id: &str,
        request_id: &str,
    ) -> Result<RequestPermit, AiError> {
        let mut active = self.inner.active.lock().map_err(|_| {
            AiError::new(
                "scheduler_error",
                "The AI request scheduler is unavailable.",
            )
        })?;
        if active.contains_key(document_id) {
            return Err(AiError::new(
                "document_busy",
                "This document already has an AI request in progress.",
            ));
        }
        let app_permit = self
            .inner
            .app_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| {
                AiError::new(
                    "app_busy",
                    "Markdowner already has two AI requests in progress.",
                )
            })?;
        let cancellation = CancellationToken::new();
        active.insert(
            document_id.to_string(),
            ActiveRequest {
                request_id: request_id.to_string(),
                cancellation: cancellation.clone(),
            },
        );
        Ok(RequestPermit {
            scheduler: self.clone(),
            document_id: document_id.to_string(),
            request_id: request_id.to_string(),
            cancellation,
            _app_permit: app_permit,
        })
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        let Ok(active) = self.inner.active.lock() else {
            return false;
        };
        let Some(request) = active
            .values()
            .find(|request| request.request_id == request_id)
        else {
            return false;
        };
        request.cancellation.cancel();
        true
    }
}

impl Default for RequestScheduler {
    fn default() -> Self {
        Self::new()
    }
}

pub struct RequestPermit {
    scheduler: RequestScheduler,
    document_id: String,
    request_id: String,
    cancellation: CancellationToken,
    _app_permit: OwnedSemaphorePermit,
}

impl fmt::Debug for RequestPermit {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RequestPermit")
            .field("document_id", &self.document_id)
            .field("request_id", &self.request_id)
            .finish_non_exhaustive()
    }
}

impl RequestPermit {
    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancellation.clone()
    }
}

impl Drop for RequestPermit {
    fn drop(&mut self) {
        let Ok(mut active) = self.scheduler.inner.active.lock() else {
            return;
        };
        if active
            .get(&self.document_id)
            .is_some_and(|request| request.request_id == self.request_id)
        {
            active.remove(&self.document_id);
        }
    }
}

const MODEL_CACHE_MAX_AGE_SECONDS: u64 = 24 * 60 * 60;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogCacheFile {
    saved_at: u64,
    models: Vec<AiModel>,
}

pub struct CatalogCache {
    path: PathBuf,
}

impl CatalogCache {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            path: app_data_dir.join("ai").join("openrouter-models.json"),
        }
    }

    #[cfg(test)]
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<Vec<AiModel>, AiError> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => {
                return Err(AiError::new(
                    "cache_error",
                    "Could not read the cached OpenRouter model catalog.",
                ));
            }
        };
        let cache: CatalogCacheFile = serde_json::from_slice(&bytes).map_err(|_| {
            AiError::new(
                "cache_error",
                "The cached OpenRouter model catalog is invalid.",
            )
        })?;
        let now = unix_timestamp();
        if now.saturating_sub(cache.saved_at) > MODEL_CACHE_MAX_AGE_SECONDS {
            return Ok(Vec::new());
        }
        Ok(cache.models)
    }

    pub fn save(&self, models: &[AiModel]) -> Result<(), AiError> {
        let parent = self.path.parent().ok_or_else(|| {
            AiError::new("cache_error", "The OpenRouter model cache path is invalid.")
        })?;
        fs::create_dir_all(parent).map_err(|_| {
            AiError::new(
                "cache_error",
                "Could not create the OpenRouter model cache.",
            )
        })?;
        let payload = serde_json::to_vec(&CatalogCacheFile {
            saved_at: unix_timestamp(),
            models: models.to_vec(),
        })
        .map_err(|_| {
            AiError::new(
                "cache_error",
                "Could not encode the OpenRouter model cache.",
            )
        })?;
        let temporary = self.path.with_extension("json.tmp");
        fs::write(&temporary, payload).map_err(|_| {
            AiError::new("cache_error", "Could not write the OpenRouter model cache.")
        })?;
        fs::rename(&temporary, &self.path).map_err(|_| {
            AiError::new(
                "cache_error",
                "Could not finish the OpenRouter model cache update.",
            )
        })
    }
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub struct AiState {
    keychain: KeychainService,
    client: OpenRouterClient,
    scheduler: RequestScheduler,
    cache: CatalogCache,
    results: Mutex<HashMap<String, ValidatedDocument>>,
}

impl AiState {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, AiError> {
        Ok(Self {
            keychain: KeychainService::system(),
            client: OpenRouterClient::new()?,
            scheduler: RequestScheduler::new(),
            cache: CatalogCache::new(&app_data_dir),
            results: Mutex::new(HashMap::new()),
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRunRequest {
    pub request_id: String,
    pub document_id: String,
    pub source: String,
    pub selection: Option<ByteRange>,
    pub task: AiTask,
    pub model: String,
    pub target_language: Option<String>,
    pub instruction: Option<String>,
    pub zdr_only: bool,
    pub max_output_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AiStreamEvent {
    Started {
        request_id: String,
        generation_id: Option<String>,
    },
    Progress {
        request_id: String,
        received_characters: usize,
    },
    Completed {
        request_id: String,
        generation_id: Option<String>,
    },
    Failed {
        request_id: String,
        code: String,
        message: String,
    },
    Cancelled {
        request_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiValidationIssue {
    pub code: String,
    pub message: String,
    pub segment_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRunResult {
    pub request_id: String,
    pub document_id: String,
    pub task: AiTask,
    pub model: String,
    pub generation_id: Option<String>,
    pub result: Option<ValidatedDocument>,
    pub validation_issues: Vec<AiValidationIssue>,
    pub raw_diagnostic: Option<String>,
    pub usage: Option<AiUsage>,
    pub retry_after_seconds: Option<u64>,
}

#[tauri::command]
pub fn ai_key_status(state: State<'_, AiState>) -> Result<AiKeyStatus, AiError> {
    state.keychain.status()
}

#[tauri::command]
pub fn ai_save_key(state: State<'_, AiState>, api_key: String) -> Result<AiKeyStatus, AiError> {
    state.keychain.save(&api_key)
}

#[tauri::command]
pub async fn ai_verify_key(state: State<'_, AiState>) -> Result<AiKeyMetadata, AiError> {
    let secret = state.keychain.read_secret()?;
    let status = state.keychain.status()?;
    state.client.verify_key(&secret, status.masked_label).await
}

#[tauri::command]
pub fn ai_delete_key(state: State<'_, AiState>) -> Result<AiKeyStatus, AiError> {
    state.keychain.delete()
}

#[tauri::command]
pub async fn ai_list_models(state: State<'_, AiState>) -> Result<Vec<AiModel>, AiError> {
    let secret = state.keychain.read_secret()?;
    match state.client.list_models(&secret).await {
        Ok(models) => {
            let _ = state.cache.save(&models);
            Ok(models)
        }
        Err(error)
            if matches!(
                error.code.as_str(),
                "network_error" | "request_timeout" | "provider_error" | "provider_unavailable"
            ) =>
        {
            let cached = state.cache.load()?;
            if cached.is_empty() {
                Err(error)
            } else {
                Ok(cached)
            }
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub async fn ai_model_pricing(
    state: State<'_, AiState>,
    model_id: String,
) -> Result<AiModelPricing, AiError> {
    let secret = state.keychain.read_secret()?;
    state.client.model_pricing(&secret, &model_id).await
}

#[tauri::command]
pub fn ai_cancel(state: State<'_, AiState>, request_id: String) -> bool {
    state.scheduler.cancel(&request_id)
}

#[tauri::command]
pub fn ai_render_selected_operations(
    state: State<'_, AiState>,
    request_id: String,
    operation_ids: Vec<String>,
) -> Result<String, AiError> {
    let results = state
        .results
        .lock()
        .map_err(|_| AiError::new("result_unavailable", "The AI result is unavailable."))?;
    let result = results.get(&request_id).ok_or_else(|| {
        AiError::new(
            "result_unavailable",
            "This transient AI result is no longer available.",
        )
    })?;
    result.render_selected(&operation_ids).map_err(|error| {
        AiError::new(
            "invalid_operation_selection",
            format!("Could not render the selected AI changes: {error}"),
        )
    })
}

#[tauri::command]
pub fn ai_discard_result(state: State<'_, AiState>, request_id: String) {
    if let Ok(mut results) = state.results.lock() {
        results.remove(&request_id);
    }
}

#[tauri::command]
pub async fn ai_run(
    state: State<'_, AiState>,
    request: AiRunRequest,
    on_event: Channel<AiStreamEvent>,
) -> Result<AiRunResult, AiError> {
    validate_run_request(&request)?;
    let permit = state
        .scheduler
        .acquire(&request.document_id, &request.request_id)
        .await?;
    let cancellation = permit.cancellation_token();
    let envelope =
        AiDocumentEnvelope::new(&request.document_id, &request.source, request.selection)
            .map_err(|error| AiError::new("invalid_document", error.to_string()))?;
    let document = serde_json::to_value(&envelope).map_err(|_| {
        AiError::new(
            "invalid_document",
            "Could not prepare the document for the AI request.",
        )
    })?;
    let completion_request = AiCompletionRequest {
        task: request.task,
        model: request.model.clone(),
        document,
        selection: request.selection.is_some(),
        target_language: request.target_language.clone(),
        instruction: request.instruction.clone(),
        zdr_only: request.zdr_only,
        max_output_tokens: request.max_output_tokens,
    };
    let _ = on_event.send(AiStreamEvent::Started {
        request_id: request.request_id.clone(),
        generation_id: None,
    });
    let secret = state.keychain.read_secret()?;
    let mut last_progress = 0;
    let completion = state
        .client
        .stream_completion(
            &secret,
            &completion_request,
            &cancellation,
            |received_characters| {
                if received_characters >= last_progress + 64 {
                    last_progress = received_characters;
                    let _ = on_event.send(AiStreamEvent::Progress {
                        request_id: request.request_id.clone(),
                        received_characters,
                    });
                }
            },
        )
        .await;
    drop(secret);
    let completion = match completion {
        Ok(completion) => completion,
        Err(error) if error.code == "cancelled" => {
            let _ = on_event.send(AiStreamEvent::Cancelled {
                request_id: request.request_id.clone(),
            });
            return Err(error);
        }
        Err(error) => {
            let _ = on_event.send(AiStreamEvent::Failed {
                request_id: request.request_id.clone(),
                code: error.code.clone(),
                message: error.message.clone(),
            });
            return Err(error);
        }
    };
    let (result, validation_issues) =
        validate_provider_result(&envelope, request.task, &completion.content);
    if let Some(validated) = &result {
        state
            .results
            .lock()
            .map_err(|_| AiError::new("result_unavailable", "Could not retain the AI result."))?
            .insert(request.request_id.clone(), validated.clone());
    }
    let raw_diagnostic = result
        .is_none()
        .then(|| redact_sensitive(&completion.content, None));
    let _ = on_event.send(AiStreamEvent::Completed {
        request_id: request.request_id.clone(),
        generation_id: completion.generation_id.clone(),
    });
    Ok(AiRunResult {
        request_id: request.request_id,
        document_id: request.document_id,
        task: request.task,
        model: request.model,
        generation_id: completion.generation_id,
        result,
        validation_issues,
        raw_diagnostic,
        usage: completion.usage,
        retry_after_seconds: None,
    })
}

fn validate_run_request(request: &AiRunRequest) -> Result<(), AiError> {
    if request.request_id.trim().is_empty() || request.document_id.trim().is_empty() {
        return Err(AiError::new(
            "invalid_request",
            "The AI request and document IDs are required.",
        ));
    }
    if request.source.is_empty() {
        return Err(AiError::new(
            "empty_document",
            "Add document text before running an AI task.",
        ));
    }
    if request.model.trim().is_empty()
        || request.model.len() > 200
        || request.model.chars().any(char::is_whitespace)
    {
        return Err(AiError::new(
            "invalid_model",
            "Select a valid OpenRouter model.",
        ));
    }
    if request.max_output_tokens == 0 || request.max_output_tokens > 100_000 {
        return Err(AiError::new(
            "invalid_output_limit",
            "Maximum output tokens must be between 1 and 100,000.",
        ));
    }
    if request.task == AiTask::Translation
        && request
            .target_language
            .as_deref()
            .is_none_or(|language| language.trim().is_empty())
    {
        return Err(AiError::new(
            "target_language_required",
            "Choose a translation target language.",
        ));
    }
    if request.task == AiTask::Custom
        && request
            .instruction
            .as_deref()
            .is_none_or(|instruction| instruction.trim().is_empty())
    {
        return Err(AiError::new(
            "instruction_required",
            "Enter an instruction for the custom AI task.",
        ));
    }
    Ok(())
}

fn validate_provider_result(
    envelope: &AiDocumentEnvelope,
    task: AiTask,
    content: &str,
) -> (Option<ValidatedDocument>, Vec<AiValidationIssue>) {
    let validated = match task {
        AiTask::Translation => serde_json::from_str::<TranslationResponse>(content)
            .map_err(schema_error)
            .and_then(|response| {
                validate_translation(envelope, response).map_err(validation_issues)
            }),
        AiTask::Prd => serde_json::from_str::<PrdResponse>(content)
            .map_err(schema_error)
            .and_then(|response| {
                validate_prd_response(envelope, response).map_err(validation_issues)
            }),
        AiTask::Custom if envelope.selection.is_some() => {
            serde_json::from_str::<SelectionResponse>(content)
                .map_err(schema_error)
                .and_then(|response| {
                    validate_selection_response(envelope, response).map_err(validation_issues)
                })
        }
        AiTask::Custom => serde_json::from_str::<PrdResponse>(content)
            .map_err(schema_error)
            .and_then(|response| {
                validate_prd_response(envelope, response).map_err(validation_issues)
            }),
    };
    match validated {
        Ok(validated) => (Some(validated), Vec::new()),
        Err(issues) => (None, issues),
    }
}

fn schema_error(error: serde_json::Error) -> Vec<AiValidationIssue> {
    vec![AiValidationIssue {
        code: "invalid_schema".to_string(),
        message: format!("The provider response did not match the required schema: {error}"),
        segment_id: None,
    }]
}

fn validation_issues(error: ValidationError) -> Vec<AiValidationIssue> {
    error
        .issues
        .into_iter()
        .map(|issue| AiValidationIssue {
            code: serde_json::to_value(issue.code)
                .ok()
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_else(|| "validation_error".to_string()),
            message: issue.message,
            segment_id: issue.segment_id,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        CatalogCache, RequestScheduler,
        openrouter::{AiModel, AiModelPricing, AiTask},
        validate_provider_result,
    };
    use markdowner_core::ai_document::{AiDocumentEnvelope, ByteRange};

    #[tokio::test]
    async fn limits_two_app_requests_and_one_per_document() {
        let scheduler = RequestScheduler::new();
        let first = scheduler.acquire("doc-a", "r1").await.unwrap();
        let _second = scheduler.acquire("doc-b", "r2").await.unwrap();

        assert_eq!(
            scheduler.try_acquire("doc-c", "r3").unwrap_err().code,
            "app_busy"
        );
        assert_eq!(
            scheduler.try_acquire("doc-a", "r4").unwrap_err().code,
            "document_busy"
        );

        drop(first);
        assert!(scheduler.try_acquire("doc-c", "r3").is_ok());
    }

    #[tokio::test]
    async fn cancelling_a_registered_request_signals_its_token() {
        let scheduler = RequestScheduler::new();
        let permit = scheduler.acquire("doc-a", "request-1").await.unwrap();
        let cancelled = permit.cancellation_token();

        assert!(scheduler.cancel("request-1"));
        assert!(cancelled.is_cancelled());
        assert!(!scheduler.cancel("missing"));
    }

    #[test]
    fn catalog_cache_round_trips_without_credentials() {
        let directory = tempfile::tempdir().unwrap();
        let cache = CatalogCache::new(directory.path());
        let models = vec![AiModel {
            id: "z-ai/glm-5.2".to_string(),
            name: "GLM 5.2".to_string(),
            description: None,
            context_length: 1_048_576,
            input_modalities: vec!["text".to_string()],
            output_modalities: vec!["text".to_string()],
            supported_parameters: vec!["structured_outputs".to_string()],
            pricing: AiModelPricing {
                prompt: Some(0.000_001),
                completion: Some(0.000_002),
                updated_at: "now".to_string(),
            },
        }];

        cache.save(&models).unwrap();
        let serialized = std::fs::read_to_string(cache.path()).unwrap();

        assert_eq!(cache.load().unwrap(), models);
        assert!(!serialized.contains("sk-or-"));
        assert!(!serialized.contains("authorization"));
    }

    #[test]
    fn invalid_provider_schema_fails_closed_without_a_result() {
        let envelope = AiDocumentEnvelope::new("doc-1", "# PRD\n\nVague.", None).unwrap();

        let (result, issues) = validate_provider_result(&envelope, AiTask::Prd, "not valid json");

        assert!(result.is_none());
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "invalid_schema");
    }

    #[test]
    fn mock_prd_and_translation_results_validate_without_network() {
        let envelope = AiDocumentEnvelope::new("doc-1", "Vague requirement.", None).unwrap();
        let prd = serde_json::json!({
            "schema_version": 1,
            "summary": "Clarify the requirement.",
            "findings": [],
            "operations": [],
            "assumptions": []
        })
        .to_string();
        let (prd_result, prd_issues) = validate_provider_result(&envelope, AiTask::Prd, &prd);
        assert!(prd_result.is_some());
        assert!(prd_issues.is_empty());

        let translation = serde_json::json!({
            "schema_version": 1,
            "detected_source_language": "en",
            "target_language": "ko",
            "segments": envelope
                .segments
                .iter()
                .map(|segment| serde_json::json!({
                    "id": segment.id,
                    "translated_text": segment.text
                }))
                .collect::<Vec<_>>(),
            "warnings": []
        })
        .to_string();
        let (translation_result, translation_issues) =
            validate_provider_result(&envelope, AiTask::Translation, &translation);
        assert!(translation_result.is_some());
        assert!(translation_issues.is_empty());
    }

    #[test]
    fn mock_selection_result_validates_without_network() {
        let source = "Make this clear.";
        let envelope = AiDocumentEnvelope::new(
            "doc-1",
            source,
            Some(ByteRange {
                start: 0,
                end: source.len(),
            }),
        )
        .unwrap();
        let response = serde_json::json!({
            "schema_version": 1,
            "replacement_text": "Make this measurable.",
            "warnings": []
        })
        .to_string();

        let (result, issues) = validate_provider_result(&envelope, AiTask::Custom, &response);

        assert_eq!(
            result.map(|result| result.proposed_markdown),
            Some("Make this measurable.".to_string())
        );
        assert!(issues.is_empty());
    }

    #[test]
    fn unsafe_selection_replacement_fails_closed_without_a_result() {
        let source = "Keep `cargo test` exactly.";
        let start = source.find('K').unwrap();
        let envelope = AiDocumentEnvelope::new(
            "doc-1",
            source,
            Some(ByteRange {
                start,
                end: source.len(),
            }),
        )
        .unwrap();
        let response = serde_json::json!({
            "schema_version": 1,
            "replacement_text": "Remove the command."
        })
        .to_string();

        let (result, issues) = validate_provider_result(&envelope, AiTask::Custom, &response);

        assert!(result.is_none());
        assert!(!issues.is_empty());
        assert!(
            issues
                .iter()
                .any(|issue| issue.code == "protected_token_missing")
        );
    }
}
