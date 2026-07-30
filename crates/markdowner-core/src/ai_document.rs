use std::{
    collections::{HashMap, HashSet},
    fmt,
    sync::OnceLock,
};

use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const AI_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ByteRange {
    pub start: usize,
    pub end: usize,
}

impl ByteRange {
    fn validate(self, source: &str) -> Result<Self, ValidationError> {
        if self.start >= self.end || self.end > source.len() {
            return Err(ValidationError::single(
                ValidationIssueCode::InvalidRange,
                "Selection must be a non-empty byte range inside the source.",
            ));
        }
        if !source.is_char_boundary(self.start) || !source.is_char_boundary(self.end) {
            return Err(ValidationError::single(
                ValidationIssueCode::InvalidUtf8Boundary,
                "Selection starts or ends inside a UTF-8 code point.",
            ));
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtectedKind {
    Blank,
    BlockCode,
    InlineCode,
    LinkDestination,
    FrontmatterKey,
    MarkdownMarker,
    TableDelimiter,
    HtmlTag,
    SkillToken,
    Literal,
    Identifier,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedToken {
    pub id: String,
    pub segment_id: String,
    pub placeholder: String,
    pub range: ByteRange,
    pub original: String,
    pub kind: ProtectedKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditableSegment {
    pub id: String,
    pub range: ByteRange,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionPolicy {
    #[serde(default)]
    pub allow_literal_changes: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiDocumentEnvelope {
    pub document_id: String,
    pub source: String,
    pub selection: Option<ByteRange>,
    pub revision_hash: String,
    pub segments: Vec<EditableSegment>,
    pub protected: Vec<ProtectedToken>,
    pub policy: ProtectionPolicy,
}

impl AiDocumentEnvelope {
    pub fn new(
        document_id: impl Into<String>,
        source: impl Into<String>,
        selection: Option<ByteRange>,
    ) -> Result<Self, ValidationError> {
        Self::with_policy(document_id, source, selection, ProtectionPolicy::default())
    }

    pub fn with_policy(
        document_id: impl Into<String>,
        source: impl Into<String>,
        selection: Option<ByteRange>,
        policy: ProtectionPolicy,
    ) -> Result<Self, ValidationError> {
        let document_id = document_id.into();
        let source = source.into();
        if document_id.trim().is_empty() {
            return Err(ValidationError::single(
                ValidationIssueCode::InvalidDocumentId,
                "Document ID cannot be empty.",
            ));
        }
        let selection = selection.map(|range| range.validate(&source)).transpose()?;
        let revision_hash = revision_hash(&document_id, &source, selection);
        let scope = selection.unwrap_or(ByteRange {
            start: 0,
            end: source.len(),
        });
        let (segments, protected) = segment_source(&source, scope, &revision_hash, policy)?;
        Ok(Self {
            document_id,
            source,
            selection,
            revision_hash,
            segments,
            protected,
            policy,
        })
    }

    pub fn scope(&self) -> ByteRange {
        self.selection.unwrap_or(ByteRange {
            start: 0,
            end: self.source.len(),
        })
    }

    pub fn reconstruct_original(&self) -> Result<String, ValidationError> {
        let transformed = self
            .segments
            .iter()
            .map(|segment| (segment.id.as_str(), segment.text.as_str()))
            .collect::<HashMap<_, _>>();
        reconstruct_segments(self, &transformed)
    }
}

pub fn revision_hash(document_id: &str, source: &str, selection: Option<ByteRange>) -> String {
    let mut hash = Sha256::new();
    hash.update(document_id.as_bytes());
    hash.update([0]);
    hash.update(source.as_bytes());
    hash.update([0]);
    if let Some(range) = selection {
        hash.update(range.start.to_le_bytes());
        hash.update(range.end.to_le_bytes());
    }
    format!("{:x}", hash.finalize())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationSegment {
    pub id: String,
    pub translated_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResponse {
    pub schema_version: u32,
    pub detected_source_language: String,
    pub target_language: String,
    pub segments: Vec<TranslationSegment>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdFinding {
    pub id: String,
    pub severity: String,
    pub category: String,
    pub evidence_segment_id: Option<String>,
    pub rationale: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    Replace,
    InsertBefore,
    InsertAfter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdOperation {
    pub id: String,
    pub kind: OperationKind,
    pub target_segment_id: String,
    pub markdown: String,
    #[serde(default)]
    pub finding_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdResponse {
    pub schema_version: u32,
    pub summary: String,
    #[serde(default)]
    pub findings: Vec<PrdFinding>,
    #[serde(default)]
    pub operations: Vec<PrdOperation>,
    #[serde(default)]
    pub assumptions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionResponse {
    pub schema_version: u32,
    pub replacement_text: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub operation_id: String,
    pub source_range: ByteRange,
    pub original_markdown: String,
    pub proposed_markdown: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedOperation {
    pub id: String,
    pub kind: OperationKind,
    pub target_segment_id: String,
    pub source_range: ByteRange,
    pub original_markdown: String,
    pub proposed_markdown: String,
    pub finding_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub passed: bool,
    pub issues: Vec<ValidationIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedDocument {
    pub source_revision_hash: String,
    pub proposed_markdown: String,
    pub validation: ValidationReport,
    pub operations: Vec<ValidatedOperation>,
    pub hunks: Vec<DiffHunk>,
    pub summary: Option<String>,
    pub findings: Vec<PrdFinding>,
    pub assumptions: Vec<String>,
    pub detected_source_language: Option<String>,
    pub target_language: Option<String>,
    pub warnings: Vec<String>,
    #[serde(skip)]
    source: String,
    #[serde(skip)]
    scope: ByteRange,
    #[serde(skip)]
    segments: Vec<EditableSegment>,
}

impl ValidatedDocument {
    pub fn render_selected(&self, operation_ids: &[String]) -> Result<String, ValidationError> {
        let selected = operation_ids
            .iter()
            .map(String::as_str)
            .collect::<HashSet<_>>();
        let known = self
            .operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<HashSet<_>>();
        let unknown = selected.difference(&known).copied().collect::<Vec<_>>();
        if !unknown.is_empty() {
            return Err(ValidationError::single(
                ValidationIssueCode::UnknownOperation,
                format!("Unknown operation IDs: {}", unknown.join(", ")),
            ));
        }

        let mut rendered = String::with_capacity(self.source.len());
        rendered.push_str(&self.source[..self.scope.start]);
        for segment in &self.segments {
            for operation in self.operations.iter().filter(|operation| {
                operation.target_segment_id == segment.id
                    && operation.kind == OperationKind::InsertBefore
                    && selected.contains(operation.id.as_str())
            }) {
                rendered.push_str(&operation.proposed_markdown);
            }

            let replacements = self
                .operations
                .iter()
                .filter(|operation| {
                    operation.target_segment_id == segment.id
                        && operation.kind == OperationKind::Replace
                        && selected.contains(operation.id.as_str())
                })
                .collect::<Vec<_>>();
            if replacements.len() > 1 {
                return Err(ValidationError::single(
                    ValidationIssueCode::OverlappingOperation,
                    format!("Segment {} has multiple selected replacements.", segment.id),
                ));
            }
            if let Some(replacement) = replacements.first() {
                rendered.push_str(&replacement.proposed_markdown);
            } else {
                rendered.push_str(&self.source[segment.range.start..segment.range.end]);
            }

            for operation in self.operations.iter().filter(|operation| {
                operation.target_segment_id == segment.id
                    && operation.kind == OperationKind::InsertAfter
                    && selected.contains(operation.id.as_str())
            }) {
                rendered.push_str(&operation.proposed_markdown);
            }
        }
        rendered.push_str(&self.source[self.scope.end..]);
        validate_markdown_structure(&self.source, &rendered)?;
        Ok(rendered)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationIssueCode {
    InvalidDocumentId,
    InvalidRange,
    InvalidUtf8Boundary,
    InvalidSchemaVersion,
    UnknownSegment,
    DuplicateSegment,
    MissingSegment,
    UnknownOperation,
    DuplicateOperation,
    OverlappingOperation,
    UnknownFinding,
    ProtectedTokenMissing,
    ProtectedTokenChanged,
    ProtectedTokenReordered,
    UnknownProtectedToken,
    MarkdownStructureChanged,
    SelectionRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub code: ValidationIssueCode,
    pub message: String,
    pub segment_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationError {
    pub issues: Vec<ValidationIssue>,
}

impl ValidationError {
    fn single(code: ValidationIssueCode, message: impl Into<String>) -> Self {
        Self {
            issues: vec![ValidationIssue {
                code,
                message: message.into(),
                segment_id: None,
            }],
        }
    }

    fn for_segment(
        code: ValidationIssueCode,
        message: impl Into<String>,
        segment_id: impl Into<String>,
    ) -> Self {
        Self {
            issues: vec![ValidationIssue {
                code,
                message: message.into(),
                segment_id: Some(segment_id.into()),
            }],
        }
    }

    fn extend(&mut self, other: Self) {
        self.issues.extend(other.issues);
    }
}

impl fmt::Display for ValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{}",
            self.issues
                .iter()
                .map(|issue| issue.message.as_str())
                .collect::<Vec<_>>()
                .join("; ")
        )
    }
}

impl std::error::Error for ValidationError {}

pub fn validate_translation(
    envelope: &AiDocumentEnvelope,
    response: TranslationResponse,
) -> Result<ValidatedDocument, ValidationError> {
    validate_schema_version(response.schema_version)?;
    let transformed = validate_segment_collection(
        envelope,
        response
            .segments
            .iter()
            .map(|segment| (segment.id.as_str(), segment.translated_text.as_str())),
    )?;
    let proposed_markdown = reconstruct_segments(envelope, &transformed)?;
    validate_markdown_structure(&envelope.source, &proposed_markdown)?;

    let mut operations = Vec::new();
    for segment in &envelope.segments {
        let proposed = restore_segment(
            envelope,
            segment,
            transformed
                .get(segment.id.as_str())
                .copied()
                .unwrap_or_default(),
        )?;
        let original = envelope.source[segment.range.start..segment.range.end].to_string();
        if proposed != original {
            operations.push(ValidatedOperation {
                id: format!("translate:{}", segment.id),
                kind: OperationKind::Replace,
                target_segment_id: segment.id.clone(),
                source_range: segment.range,
                original_markdown: original,
                proposed_markdown: proposed,
                finding_ids: Vec::new(),
            });
        }
    }
    let hunks = hunks_for_operations(&operations);

    Ok(ValidatedDocument {
        source_revision_hash: envelope.revision_hash.clone(),
        proposed_markdown,
        validation: ValidationReport {
            passed: true,
            issues: Vec::new(),
        },
        operations,
        hunks,
        summary: None,
        findings: Vec::new(),
        assumptions: Vec::new(),
        detected_source_language: Some(response.detected_source_language),
        target_language: Some(response.target_language),
        warnings: response.warnings,
        source: envelope.source.clone(),
        scope: envelope.scope(),
        segments: envelope.segments.clone(),
    })
}

pub fn validate_prd_response(
    envelope: &AiDocumentEnvelope,
    response: PrdResponse,
) -> Result<ValidatedDocument, ValidationError> {
    validate_schema_version(response.schema_version)?;
    let segment_map = envelope
        .segments
        .iter()
        .map(|segment| (segment.id.as_str(), segment))
        .collect::<HashMap<_, _>>();
    let finding_ids = response
        .findings
        .iter()
        .map(|finding| finding.id.as_str())
        .collect::<HashSet<_>>();
    let mut issues = ValidationError { issues: Vec::new() };
    let mut seen_operations = HashSet::new();
    let mut replaced_segments = HashSet::new();
    let mut operations = Vec::new();

    for finding in &response.findings {
        if let Some(segment_id) = &finding.evidence_segment_id
            && !segment_map.contains_key(segment_id.as_str())
        {
            issues.extend(ValidationError::for_segment(
                ValidationIssueCode::UnknownSegment,
                format!(
                    "Finding {} references unknown segment {segment_id}.",
                    finding.id
                ),
                segment_id,
            ));
        }
    }

    for operation in &response.operations {
        if operation.id.trim().is_empty() || !seen_operations.insert(operation.id.as_str()) {
            issues.extend(ValidationError::single(
                ValidationIssueCode::DuplicateOperation,
                format!("Duplicate or empty operation ID: {}", operation.id),
            ));
            continue;
        }
        let Some(target) = segment_map.get(operation.target_segment_id.as_str()) else {
            issues.extend(ValidationError::for_segment(
                ValidationIssueCode::UnknownSegment,
                format!(
                    "Operation {} references unknown segment {}.",
                    operation.id, operation.target_segment_id
                ),
                &operation.target_segment_id,
            ));
            continue;
        };
        let unknown_findings = operation
            .finding_ids
            .iter()
            .filter(|id| !finding_ids.contains(id.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        if !unknown_findings.is_empty() {
            issues.extend(ValidationError::single(
                ValidationIssueCode::UnknownFinding,
                format!(
                    "Operation {} references unknown findings: {}.",
                    operation.id,
                    unknown_findings.join(", ")
                ),
            ));
            continue;
        }
        if operation.kind == OperationKind::Replace
            && !replaced_segments.insert(operation.target_segment_id.as_str())
        {
            issues.extend(ValidationError::for_segment(
                ValidationIssueCode::OverlappingOperation,
                format!(
                    "Multiple replacements target segment {}.",
                    operation.target_segment_id
                ),
                &operation.target_segment_id,
            ));
            continue;
        }

        let original = envelope.source[target.range.start..target.range.end].to_string();
        let proposed = match operation.kind {
            OperationKind::Replace => restore_segment(envelope, target, &operation.markdown)?,
            OperationKind::InsertBefore | OperationKind::InsertAfter => {
                reject_unknown_placeholders(envelope, &operation.markdown)?;
                operation.markdown.clone()
            }
        };
        operations.push(ValidatedOperation {
            id: operation.id.clone(),
            kind: operation.kind,
            target_segment_id: operation.target_segment_id.clone(),
            source_range: target.range,
            original_markdown: original,
            proposed_markdown: proposed,
            finding_ids: operation.finding_ids.clone(),
        });
    }

    if !issues.issues.is_empty() {
        return Err(issues);
    }
    let hunks = hunks_for_operations(&operations);
    let mut validated = ValidatedDocument {
        source_revision_hash: envelope.revision_hash.clone(),
        proposed_markdown: String::new(),
        validation: ValidationReport {
            passed: true,
            issues: Vec::new(),
        },
        operations,
        hunks,
        summary: Some(response.summary),
        findings: response.findings,
        assumptions: response.assumptions,
        detected_source_language: None,
        target_language: None,
        warnings: Vec::new(),
        source: envelope.source.clone(),
        scope: envelope.scope(),
        segments: envelope.segments.clone(),
    };
    let all_ids = validated
        .operations
        .iter()
        .map(|operation| operation.id.clone())
        .collect::<Vec<_>>();
    validated.proposed_markdown = validated.render_selected(&all_ids)?;
    Ok(validated)
}

pub fn validate_selection_response(
    envelope: &AiDocumentEnvelope,
    response: SelectionResponse,
) -> Result<ValidatedDocument, ValidationError> {
    validate_schema_version(response.schema_version)?;
    let Some(scope) = envelope.selection else {
        return Err(ValidationError::single(
            ValidationIssueCode::SelectionRequired,
            "A non-empty selection is required for direct replacement.",
        ));
    };
    validate_all_protected_tokens(envelope, &response.replacement_text)?;
    let replacement = restore_text(envelope, &response.replacement_text)?;
    let proposed_markdown = format!(
        "{}{}{}",
        &envelope.source[..scope.start],
        replacement,
        &envelope.source[scope.end..]
    );
    validate_markdown_structure(&envelope.source, &proposed_markdown)?;
    let original = envelope.source[scope.start..scope.end].to_string();
    let operation = ValidatedOperation {
        id: "selection:replace".to_string(),
        kind: OperationKind::Replace,
        target_segment_id: "selection".to_string(),
        source_range: scope,
        original_markdown: original.clone(),
        proposed_markdown: replacement,
        finding_ids: Vec::new(),
    };

    Ok(ValidatedDocument {
        source_revision_hash: envelope.revision_hash.clone(),
        proposed_markdown,
        validation: ValidationReport {
            passed: true,
            issues: Vec::new(),
        },
        hunks: vec![DiffHunk {
            operation_id: operation.id.clone(),
            source_range: scope,
            original_markdown: original,
            proposed_markdown: operation.proposed_markdown.clone(),
        }],
        operations: vec![operation],
        summary: None,
        findings: Vec::new(),
        assumptions: Vec::new(),
        detected_source_language: None,
        target_language: None,
        warnings: response.warnings,
        source: envelope.source.clone(),
        scope,
        segments: envelope.segments.clone(),
    })
}

fn validate_schema_version(version: u32) -> Result<(), ValidationError> {
    if version == AI_SCHEMA_VERSION {
        Ok(())
    } else {
        Err(ValidationError::single(
            ValidationIssueCode::InvalidSchemaVersion,
            format!("Unsupported schema version {version}; expected {AI_SCHEMA_VERSION}."),
        ))
    }
}

fn validate_segment_collection<'a>(
    envelope: &'a AiDocumentEnvelope,
    segments: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Result<HashMap<&'a str, &'a str>, ValidationError> {
    let known = envelope
        .segments
        .iter()
        .map(|segment| segment.id.as_str())
        .collect::<HashSet<_>>();
    let mut transformed = HashMap::new();
    let mut issues = ValidationError { issues: Vec::new() };

    for (id, text) in segments {
        if !known.contains(id) {
            issues.extend(ValidationError::for_segment(
                ValidationIssueCode::UnknownSegment,
                format!("Unknown segment ID {id}."),
                id,
            ));
            continue;
        }
        if transformed.insert(id, text).is_some() {
            issues.extend(ValidationError::for_segment(
                ValidationIssueCode::DuplicateSegment,
                format!("Duplicate segment ID {id}."),
                id,
            ));
        }
    }
    for id in known {
        if !transformed.contains_key(id) {
            issues.extend(ValidationError::for_segment(
                ValidationIssueCode::MissingSegment,
                format!("Missing segment ID {id}."),
                id,
            ));
        }
    }
    if issues.issues.is_empty() {
        Ok(transformed)
    } else {
        Err(issues)
    }
}

fn reconstruct_segments(
    envelope: &AiDocumentEnvelope,
    transformed: &HashMap<&str, &str>,
) -> Result<String, ValidationError> {
    let scope = envelope.scope();
    let mut reconstructed = String::with_capacity(envelope.source.len());
    reconstructed.push_str(&envelope.source[..scope.start]);
    for segment in &envelope.segments {
        let text = transformed
            .get(segment.id.as_str())
            .copied()
            .ok_or_else(|| {
                ValidationError::for_segment(
                    ValidationIssueCode::MissingSegment,
                    format!("Missing segment {}.", segment.id),
                    &segment.id,
                )
            })?;
        reconstructed.push_str(&restore_segment(envelope, segment, text)?);
    }
    reconstructed.push_str(&envelope.source[scope.end..]);
    Ok(reconstructed)
}

fn restore_segment(
    envelope: &AiDocumentEnvelope,
    segment: &EditableSegment,
    text: &str,
) -> Result<String, ValidationError> {
    let expected = envelope
        .protected
        .iter()
        .filter(|token| token.segment_id == segment.id)
        .collect::<Vec<_>>();
    validate_protected_sequence(envelope, text, &expected, Some(&segment.id))?;
    restore_text(envelope, text)
}

fn validate_all_protected_tokens(
    envelope: &AiDocumentEnvelope,
    text: &str,
) -> Result<(), ValidationError> {
    let expected = envelope.protected.iter().collect::<Vec<_>>();
    validate_protected_sequence(envelope, text, &expected, None)
}

fn validate_protected_sequence(
    envelope: &AiDocumentEnvelope,
    text: &str,
    expected: &[&ProtectedToken],
    segment_id: Option<&str>,
) -> Result<(), ValidationError> {
    let mut issues = ValidationError { issues: Vec::new() };
    let mut positions = Vec::with_capacity(expected.len());
    for token in expected {
        let count = text.matches(&token.placeholder).count();
        if count == 0 {
            issues.issues.push(ValidationIssue {
                code: ValidationIssueCode::ProtectedTokenMissing,
                message: format!("Protected token {} is missing.", token.id),
                segment_id: segment_id.map(ToOwned::to_owned),
            });
        } else if count != 1 {
            issues.issues.push(ValidationIssue {
                code: ValidationIssueCode::ProtectedTokenChanged,
                message: format!(
                    "Protected token {} occurs {count} times; expected exactly once.",
                    token.id
                ),
                segment_id: segment_id.map(ToOwned::to_owned),
            });
        } else if let Some(position) = text.find(&token.placeholder) {
            positions.push(position);
        }
    }
    if positions.windows(2).any(|window| window[0] >= window[1]) {
        issues.issues.push(ValidationIssue {
            code: ValidationIssueCode::ProtectedTokenReordered,
            message: "Protected tokens changed order.".to_string(),
            segment_id: segment_id.map(ToOwned::to_owned),
        });
    }
    if let Err(error) = reject_unknown_placeholders(envelope, text) {
        issues.extend(error);
    }
    if issues.issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

fn reject_unknown_placeholders(
    envelope: &AiDocumentEnvelope,
    text: &str,
) -> Result<(), ValidationError> {
    let known = envelope
        .protected
        .iter()
        .map(|token| token.placeholder.as_str())
        .collect::<HashSet<_>>();
    for candidate in extract_placeholders(text) {
        if !known.contains(candidate) {
            return Err(ValidationError::single(
                ValidationIssueCode::UnknownProtectedToken,
                format!("Unknown protected token {candidate}."),
            ));
        }
    }
    Ok(())
}

fn extract_placeholders(text: &str) -> Vec<&str> {
    let mut placeholders = Vec::new();
    let mut cursor = 0;
    while let Some(relative_start) = text[cursor..].find("⟪MDNER_") {
        let start = cursor + relative_start;
        let Some(relative_end) = text[start..].find('⟫') else {
            break;
        };
        let end = start + relative_end + '⟫'.len_utf8();
        placeholders.push(&text[start..end]);
        cursor = end;
    }
    placeholders
}

fn restore_text(envelope: &AiDocumentEnvelope, text: &str) -> Result<String, ValidationError> {
    reject_unknown_placeholders(envelope, text)?;
    let mut restored = text.to_string();
    for token in &envelope.protected {
        restored = restored.replace(&token.placeholder, &token.original);
    }
    Ok(restored)
}

fn hunks_for_operations(operations: &[ValidatedOperation]) -> Vec<DiffHunk> {
    operations
        .iter()
        .map(|operation| DiffHunk {
            operation_id: operation.id.clone(),
            source_range: operation.source_range,
            original_markdown: operation.original_markdown.clone(),
            proposed_markdown: operation.proposed_markdown.clone(),
        })
        .collect()
}

fn validate_markdown_structure(original: &str, proposed: &str) -> Result<(), ValidationError> {
    if markdown_fence_lines(original) != markdown_fence_lines(proposed) {
        return Err(ValidationError::single(
            ValidationIssueCode::MarkdownStructureChanged,
            "Markdown fence structure changed.",
        ));
    }
    let original_html = html_tag_regex()
        .find_iter(original)
        .map(|matched| matched.as_str())
        .collect::<Vec<_>>();
    let proposed_html = html_tag_regex()
        .find_iter(proposed)
        .map(|matched| matched.as_str())
        .collect::<Vec<_>>();
    if original_html != proposed_html {
        return Err(ValidationError::single(
            ValidationIssueCode::MarkdownStructureChanged,
            "Raw HTML tag structure changed.",
        ));
    }
    Ok(())
}

fn markdown_fence_lines(source: &str) -> Vec<&str> {
    source
        .lines()
        .map(str::trim_start)
        .filter(|line| line.starts_with("```") || line.starts_with("~~~"))
        .collect()
}

#[derive(Debug, Clone)]
struct LocalProtectedRange {
    start: usize,
    end: usize,
    kind: ProtectedKind,
}

fn segment_source(
    source: &str,
    scope: ByteRange,
    revision: &str,
    policy: ProtectionPolicy,
) -> Result<(Vec<EditableSegment>, Vec<ProtectedToken>), ValidationError> {
    if scope.start == scope.end {
        return Ok((Vec::new(), Vec::new()));
    }
    let scoped = &source[scope.start..scope.end];
    let line_ranges = line_ranges(scoped, scope.start);
    let mut segments = Vec::new();
    let mut protected = Vec::new();
    let mut line_index = 0;
    let mut in_frontmatter = scope.start == 0
        && scoped
            .lines()
            .next()
            .is_some_and(|line| line.trim() == "---");

    while line_index < line_ranges.len() {
        let line_range = line_ranges[line_index];
        let line = &source[line_range.start..line_range.end];
        let trimmed = line.trim_start();

        if let Some(marker) = fence_marker(trimmed) {
            let block_start = line_range.start;
            let mut block_end = line_range.end;
            line_index += 1;
            while line_index < line_ranges.len() {
                let candidate = line_ranges[line_index];
                block_end = candidate.end;
                let candidate_text = source[candidate.start..candidate.end].trim_start();
                line_index += 1;
                if candidate_text.starts_with(marker) {
                    break;
                }
            }
            add_segment(
                source,
                ByteRange {
                    start: block_start,
                    end: block_end,
                },
                vec![LocalProtectedRange {
                    start: 0,
                    end: block_end - block_start,
                    kind: ProtectedKind::BlockCode,
                }],
                revision,
                &mut segments,
                &mut protected,
            )?;
            continue;
        }

        if is_indented_code(line) {
            let block_start = line_range.start;
            let mut block_end = line_range.end;
            line_index += 1;
            while line_index < line_ranges.len() {
                let candidate = line_ranges[line_index];
                let candidate_text = &source[candidate.start..candidate.end];
                if !is_indented_code(candidate_text) && !candidate_text.trim().is_empty() {
                    break;
                }
                block_end = candidate.end;
                line_index += 1;
            }
            add_segment(
                source,
                ByteRange {
                    start: block_start,
                    end: block_end,
                },
                vec![LocalProtectedRange {
                    start: 0,
                    end: block_end - block_start,
                    kind: ProtectedKind::BlockCode,
                }],
                revision,
                &mut segments,
                &mut protected,
            )?;
            continue;
        }

        let frontmatter_marker = in_frontmatter && line.trim() == "---";
        let ranges = protected_ranges_for_line(line, in_frontmatter, frontmatter_marker, policy);
        add_segment(
            source,
            line_range,
            ranges,
            revision,
            &mut segments,
            &mut protected,
        )?;
        if in_frontmatter && frontmatter_marker && line_range.start > scope.start {
            in_frontmatter = false;
        }
        line_index += 1;
    }
    Ok((segments, protected))
}

fn line_ranges(scoped: &str, base: usize) -> Vec<ByteRange> {
    let mut ranges = Vec::new();
    let mut cursor = 0;
    for piece in scoped.split_inclusive('\n') {
        let end = cursor + piece.len();
        ranges.push(ByteRange {
            start: base + cursor,
            end: base + end,
        });
        cursor = end;
    }
    ranges
}

fn add_segment(
    source: &str,
    range: ByteRange,
    ranges: Vec<LocalProtectedRange>,
    revision: &str,
    segments: &mut Vec<EditableSegment>,
    protected: &mut Vec<ProtectedToken>,
) -> Result<(), ValidationError> {
    if !source.is_char_boundary(range.start) || !source.is_char_boundary(range.end) {
        return Err(ValidationError::single(
            ValidationIssueCode::InvalidUtf8Boundary,
            "Segment boundary is not a UTF-8 boundary.",
        ));
    }
    let segment_id = format!("seg-{:04}", segments.len() + 1);
    let line = &source[range.start..range.end];
    let ranges = merge_local_ranges(ranges, line.len());
    let mut masked = String::with_capacity(line.len());
    let mut cursor = 0;
    for local in ranges {
        if !line.is_char_boundary(local.start) || !line.is_char_boundary(local.end) {
            return Err(ValidationError::for_segment(
                ValidationIssueCode::InvalidUtf8Boundary,
                "Protected token boundary is not a UTF-8 boundary.",
                &segment_id,
            ));
        }
        masked.push_str(&line[cursor..local.start]);
        let token_id = format!("p-{:05}", protected.len() + 1);
        let placeholder = format!(
            "⟪MDNER_{}_P{:05}⟫",
            &revision[..12.min(revision.len())],
            protected.len() + 1
        );
        masked.push_str(&placeholder);
        protected.push(ProtectedToken {
            id: token_id,
            segment_id: segment_id.clone(),
            placeholder,
            range: ByteRange {
                start: range.start + local.start,
                end: range.start + local.end,
            },
            original: line[local.start..local.end].to_string(),
            kind: local.kind,
        });
        cursor = local.end;
    }
    masked.push_str(&line[cursor..]);
    segments.push(EditableSegment {
        id: segment_id,
        range,
        text: masked,
    });
    Ok(())
}

fn protected_ranges_for_line(
    line: &str,
    in_frontmatter: bool,
    frontmatter_marker: bool,
    policy: ProtectionPolicy,
) -> Vec<LocalProtectedRange> {
    if line.trim().is_empty() {
        return vec![LocalProtectedRange {
            start: 0,
            end: line.len(),
            kind: ProtectedKind::Blank,
        }];
    }
    if frontmatter_marker || is_table_delimiter(line) {
        return vec![LocalProtectedRange {
            start: 0,
            end: line.len(),
            kind: if frontmatter_marker {
                ProtectedKind::MarkdownMarker
            } else {
                ProtectedKind::TableDelimiter
            },
        }];
    }

    let mut ranges = Vec::new();
    if let Some(marker_end) = markdown_prefix_end(line) {
        ranges.push(LocalProtectedRange {
            start: 0,
            end: marker_end,
            kind: ProtectedKind::MarkdownMarker,
        });
        if let Some(task_marker) = task_marker_regex().find(&line[marker_end..]) {
            ranges.push(LocalProtectedRange {
                start: marker_end + task_marker.start(),
                end: marker_end + task_marker.end(),
                kind: ProtectedKind::MarkdownMarker,
            });
        }
    }
    if in_frontmatter && let Some(colon) = line.find(':') {
        let key = &line[..colon];
        if !key.trim().is_empty() && !key.chars().any(char::is_whitespace) {
            ranges.push(LocalProtectedRange {
                start: 0,
                end: colon + 1,
                kind: ProtectedKind::FrontmatterKey,
            });
        }
    }
    for (start, end) in inline_code_ranges(line) {
        ranges.push(LocalProtectedRange {
            start,
            end,
            kind: ProtectedKind::InlineCode,
        });
    }
    for captures in inline_link_regex().captures_iter(line) {
        for (name, kind) in [
            ("prefix", ProtectedKind::MarkdownMarker),
            ("middle", ProtectedKind::MarkdownMarker),
            ("destination", ProtectedKind::LinkDestination),
            ("close", ProtectedKind::MarkdownMarker),
        ] {
            if let Some(token) = captures.name(name) {
                ranges.push(LocalProtectedRange {
                    start: token.start(),
                    end: token.end(),
                    kind,
                });
            }
        }
    }
    for matched in inline_delimiter_regex().find_iter(line) {
        ranges.push(LocalProtectedRange {
            start: matched.start(),
            end: matched.end(),
            kind: ProtectedKind::MarkdownMarker,
        });
    }
    for matched in markdown_escape_regex().find_iter(line) {
        ranges.push(LocalProtectedRange {
            start: matched.start(),
            end: matched.end(),
            kind: ProtectedKind::MarkdownMarker,
        });
    }
    for matched in html_comment_regex().find_iter(line) {
        ranges.push(LocalProtectedRange {
            start: matched.start(),
            end: matched.end(),
            kind: ProtectedKind::HtmlTag,
        });
    }
    for matched in reference_link_regex().find_iter(line) {
        if let Some(destination) = matched.as_str().split_once("]:").map(|(_, value)| value) {
            let relative = matched.as_str().find(destination).unwrap_or_default();
            ranges.push(LocalProtectedRange {
                start: matched.start(),
                end: matched.start() + relative + destination.len(),
                kind: ProtectedKind::LinkDestination,
            });
        }
    }
    for matched in html_tag_regex().find_iter(line) {
        ranges.push(LocalProtectedRange {
            start: matched.start(),
            end: matched.end(),
            kind: ProtectedKind::HtmlTag,
        });
    }
    for captures in skill_token_regex().captures_iter(line) {
        if let Some(token) = captures.name("token") {
            ranges.push(LocalProtectedRange {
                start: token.start(),
                end: token.end(),
                kind: ProtectedKind::SkillToken,
            });
        }
    }
    for matched in model_identifier_regex().find_iter(line) {
        ranges.push(LocalProtectedRange {
            start: matched.start(),
            end: matched.end(),
            kind: ProtectedKind::Identifier,
        });
    }
    if !policy.allow_literal_changes {
        for matched in literal_regex().find_iter(line) {
            ranges.push(LocalProtectedRange {
                start: matched.start(),
                end: matched.end(),
                kind: ProtectedKind::Literal,
            });
        }
    }
    for (index, byte) in line.bytes().enumerate() {
        if byte == b'|' {
            ranges.push(LocalProtectedRange {
                start: index,
                end: index + 1,
                kind: ProtectedKind::TableDelimiter,
            });
        }
    }
    if line.ends_with("\r\n") {
        ranges.push(LocalProtectedRange {
            start: line.len() - 2,
            end: line.len(),
            kind: ProtectedKind::MarkdownMarker,
        });
    } else if line.ends_with('\n') {
        ranges.push(LocalProtectedRange {
            start: line.len() - 1,
            end: line.len(),
            kind: ProtectedKind::MarkdownMarker,
        });
    }
    ranges
}

fn merge_local_ranges(
    mut ranges: Vec<LocalProtectedRange>,
    line_len: usize,
) -> Vec<LocalProtectedRange> {
    ranges.retain(|range| range.start < range.end && range.end <= line_len);
    ranges.sort_by_key(|range| (range.start, std::cmp::Reverse(range.end)));
    let mut merged: Vec<LocalProtectedRange> = Vec::new();
    for range in ranges {
        if let Some(last) = merged.last_mut()
            && range.start < last.end
        {
            last.end = last.end.max(range.end);
            continue;
        }
        merged.push(range);
    }
    merged
}

fn fence_marker(line: &str) -> Option<&str> {
    if line.starts_with("```") {
        Some("```")
    } else if line.starts_with("~~~") {
        Some("~~~")
    } else {
        None
    }
}

fn is_indented_code(line: &str) -> bool {
    line.starts_with("    ") || line.starts_with('\t')
}

fn is_table_delimiter(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.contains('-')
        && trimmed
            .bytes()
            .all(|byte| matches!(byte, b'|' | b':' | b'-' | b' ' | b'\t'))
}

fn markdown_prefix_end(line: &str) -> Option<usize> {
    markdown_prefix_regex()
        .find(line)
        .map(|matched| matched.end())
}

fn markdown_prefix_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"^(?: {0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-+*][ \t]+|\d+[.)][ \t]+))")
            .expect("valid markdown prefix regex")
    })
}

fn task_marker_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"^\[(?: |x|X)\][ \t]+").expect("valid task marker regex"))
}

fn inline_code_ranges(line: &str) -> Vec<(usize, usize)> {
    let bytes = line.as_bytes();
    let mut ranges = Vec::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let Some(relative_start) = bytes[cursor..].iter().position(|byte| *byte == b'`') else {
            break;
        };
        let start = cursor + relative_start;
        let mut run_end = start;
        while run_end < bytes.len() && bytes[run_end] == b'`' {
            run_end += 1;
        }
        let delimiter = &line[start..run_end];
        let Some(relative_close) = line[run_end..].find(delimiter) else {
            cursor = run_end;
            continue;
        };
        let end = run_end + relative_close + delimiter.len();
        ranges.push((start, end));
        cursor = end;
    }
    ranges
}

fn inline_link_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"(?P<prefix>!?\[)(?P<label>[^\]\n]*)(?P<middle>\]\()(?P<destination>[^)\n]+)(?P<close>\))",
        )
        .expect("valid inline link regex")
    })
}

fn inline_delimiter_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"[*_~]+").expect("valid inline delimiter regex"))
}

fn markdown_escape_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\\[\\`*{}\[\]()#+\-.!_>]").expect("valid escape regex"))
}

fn reference_link_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"^[ \t]*\[[^\]\n]+\]:[ \t]*\S+").expect("valid reference link regex")
    })
}

fn html_tag_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"</?[A-Za-z][^>\n]*>").expect("valid HTML tag regex"))
}

fn html_comment_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"<!--[^>\n]*-->").expect("valid HTML comment regex"))
}

fn skill_token_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?:^|[\s(])(?P<token>[/\$][A-Za-z0-9][A-Za-z0-9._-]*)")
            .expect("valid skill token regex")
    })
}

fn model_identifier_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"\b[A-Za-z0-9][A-Za-z0-9._-]+/[A-Za-z0-9][A-Za-z0-9._-]+\b")
            .expect("valid model identifier regex")
    })
}

fn literal_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"\b\d+(?:[.,]\d+)*(?:[ \t]?(?:%|ms|s|kg|KB|MB|GB|TB|USD|KRW|원|명|건))?\b")
            .expect("valid literal regex")
    })
}
