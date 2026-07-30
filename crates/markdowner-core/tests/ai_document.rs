use markdowner_core::ai_document::{
    AiDocumentEnvelope, ByteRange, OperationKind, PrdFinding, PrdOperation, PrdResponse,
    SelectionResponse, TranslationResponse, TranslationSegment, ValidationIssueCode,
    validate_prd_response, validate_selection_response, validate_translation,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SafetyFixture {
    id: String,
    source: String,
    expected_protected: String,
}

fn translated_identity(envelope: &AiDocumentEnvelope) -> TranslationResponse {
    TranslationResponse {
        schema_version: 1,
        detected_source_language: "en".to_string(),
        target_language: "ko".to_string(),
        segments: envelope
            .segments
            .iter()
            .map(|segment| TranslationSegment {
                id: segment.id.clone(),
                translated_text: segment.text.clone(),
            })
            .collect(),
        warnings: Vec::new(),
    }
}

#[test]
fn envelope_protects_markdown_and_skills_while_round_tripping_exactly() {
    let source = concat!(
        "---\n",
        "title: 제품 42\n",
        "---\n",
        "# [문서](/docs?q=1)\n\n",
        "`cargo test`와 $git-commit\n\n",
        "```rust\n",
        "fn main() {}\n",
        "```\n",
    );
    let envelope = AiDocumentEnvelope::new("doc-1", source, None).expect("envelope");

    assert_eq!(envelope.reconstruct_original().expect("round trip"), source);
    assert!(
        envelope
            .protected
            .iter()
            .any(|item| item.original == "/docs?q=1")
    );
    assert!(
        envelope
            .protected
            .iter()
            .any(|item| item.original == "`cargo test`")
    );
    assert!(
        envelope
            .protected
            .iter()
            .any(|item| item.original == "$git-commit")
    );
    assert!(
        envelope
            .protected
            .iter()
            .any(|item| item.original.contains("fn main"))
    );
}

#[test]
fn translation_identity_preserves_every_source_byte() {
    let source = "# Heading\n\n- Keep `code()` and [URL](https://example.com/a?q=1).\n";
    let envelope = AiDocumentEnvelope::new("doc-1", source, None).expect("envelope");

    let validated =
        validate_translation(&envelope, translated_identity(&envelope)).expect("valid response");

    assert!(validated.validation.passed);
    assert_eq!(validated.proposed_markdown, source);
    assert_eq!(validated.detected_source_language.as_deref(), Some("en"));
}

#[test]
fn translation_rejects_a_changed_or_missing_protected_token() {
    let source = "Use `x()` and [docs](/a).\n";
    let envelope = AiDocumentEnvelope::new("doc-1", source, None).expect("envelope");
    let mut response = translated_identity(&envelope);
    response.segments[0].translated_text = "사용".to_string();

    let error = validate_translation(&envelope, response).expect_err("must fail closed");

    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::ProtectedTokenMissing)
    );
}

#[test]
fn envelope_protects_link_delimiters_checkboxes_and_crlf_boundaries() {
    let source = "- [ ] Translate **bold** [label](/docs)\r\n";
    let envelope = AiDocumentEnvelope::new("doc-1", source, None).expect("envelope");
    let originals = envelope
        .protected
        .iter()
        .map(|token| token.original.as_str())
        .collect::<Vec<_>>();

    assert!(originals.contains(&"[ ] "));
    assert!(originals.contains(&"["));
    assert!(originals.contains(&"]("));
    assert!(originals.contains(&")"));
    assert!(originals.contains(&"**"));
    assert!(originals.contains(&"\r\n"));
}

#[test]
fn translation_rejects_duplicate_and_missing_segment_ids() {
    let source = "# One\n\nTwo\n";
    let envelope = AiDocumentEnvelope::new("doc-1", source, None).expect("envelope");
    assert!(envelope.segments.len() >= 2);
    let mut response = translated_identity(&envelope);
    response.segments.pop();
    response.segments.push(response.segments[0].clone());

    let error = validate_translation(&envelope, response).expect_err("must fail closed");

    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::DuplicateSegment)
    );
    assert!(
        error
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::MissingSegment)
    );
}

#[test]
fn selected_prd_operations_leave_unselected_bytes_unchanged() {
    let source = "# A\n\nFirst.\n\n# B\n\nSecond.\n";
    let envelope = AiDocumentEnvelope::new("doc-1", source, None).expect("envelope");
    let first = envelope
        .segments
        .iter()
        .find(|segment| segment.text.contains("First"))
        .expect("first segment");
    let second = envelope
        .segments
        .iter()
        .find(|segment| segment.text.contains("Second"))
        .expect("second segment");
    let response = PrdResponse {
        schema_version: 1,
        summary: "Two measurable edits".to_string(),
        findings: vec![
            PrdFinding {
                id: "finding-a".to_string(),
                severity: "major".to_string(),
                category: "ambiguity".to_string(),
                evidence_segment_id: Some(first.id.clone()),
                rationale: "First is vague".to_string(),
            },
            PrdFinding {
                id: "finding-b".to_string(),
                severity: "major".to_string(),
                category: "measurability".to_string(),
                evidence_segment_id: Some(second.id.clone()),
                rationale: "Second is vague".to_string(),
            },
        ],
        operations: vec![
            PrdOperation {
                id: "op-a".to_string(),
                kind: OperationKind::Replace,
                target_segment_id: first.id.clone(),
                markdown: first.text.replace("First.", "Improved first."),
                finding_ids: vec!["finding-a".to_string()],
            },
            PrdOperation {
                id: "op-b".to_string(),
                kind: OperationKind::Replace,
                target_segment_id: second.id.clone(),
                markdown: second.text.replace("Second.", "Improved second."),
                finding_ids: vec!["finding-b".to_string()],
            },
        ],
        assumptions: Vec::new(),
    };

    let validated = validate_prd_response(&envelope, response).expect("valid response");
    let first_only = validated
        .render_selected(&["op-a".to_string()])
        .expect("selected render");

    assert!(first_only.contains("Improved first."));
    assert!(first_only.contains("# B\n\nSecond."));
    assert!(!first_only.contains("Improved second."));
}

#[test]
fn revision_hash_covers_document_source_and_selection() {
    let source = "가나다 alpha";
    let whole = AiDocumentEnvelope::new("doc-1", source, None).expect("whole");
    let selected = AiDocumentEnvelope::new(
        "doc-1",
        source,
        Some(ByteRange {
            start: "가".len(),
            end: "가나다".len(),
        }),
    )
    .expect("selected");
    let changed = AiDocumentEnvelope::new("doc-1", "가나다 beta", None).expect("changed");

    assert_ne!(whole.revision_hash, selected.revision_hash);
    assert_ne!(whole.revision_hash, changed.revision_hash);
}

#[test]
fn selection_replacement_validates_utf8_range_and_protected_tokens() {
    let source = "앞 `code()` 뒤";
    let start = "앞 ".len();
    let end = source.len();
    let envelope = AiDocumentEnvelope::new("doc-1", source, Some(ByteRange { start, end }))
        .expect("selection envelope");
    let replacement = envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>()
        .replace("뒤", "다음");
    let valid = validate_selection_response(
        &envelope,
        SelectionResponse {
            schema_version: 1,
            replacement_text: replacement,
            warnings: Vec::new(),
        },
    )
    .expect("selection valid");

    assert_eq!(valid.proposed_markdown, "앞 `code()` 다음");

    let invalid = AiDocumentEnvelope::new(
        "doc-1",
        source,
        Some(ByteRange {
            start: 1,
            end: source.len(),
        }),
    )
    .expect_err("mid-codepoint range must fail");
    assert!(
        invalid
            .issues
            .iter()
            .any(|issue| issue.code == ValidationIssueCode::InvalidUtf8Boundary)
    );
}

#[test]
fn markdown_safety_fixtures_preserve_every_source_byte() {
    let fixtures: Vec<SafetyFixture> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/ai/markdown-safety.json"
    ))
    .expect("fixture JSON");
    assert!(
        fixtures.len() >= 60,
        "MVP requires at least 60 Markdown safety fixtures"
    );

    for fixture in fixtures {
        let envelope =
            AiDocumentEnvelope::new(&fixture.id, &fixture.source, None).expect("envelope");
        assert_eq!(
            envelope.reconstruct_original().expect("round trip"),
            fixture.source,
            "{} failed exact reconstruction",
            fixture.id
        );
        assert!(
            envelope
                .protected
                .iter()
                .any(|token| token.original.contains(&fixture.expected_protected)),
            "{} did not protect {:?}",
            fixture.id,
            fixture.expected_protected
        );
        let validated =
            validate_translation(&envelope, translated_identity(&envelope)).expect("identity");
        assert_eq!(
            validated.proposed_markdown, fixture.source,
            "{} changed bytes during identity validation",
            fixture.id
        );
    }
}
