use markdowner_core::ai_document::{
    AI_SCHEMA_VERSION, AiDocumentEnvelope, ByteRange, OperationKind, PrdFinding, PrdOperation,
    PrdResponse, ProtectionPolicy, SelectionResponse, SummaryResponse, TranslationResponse,
    TranslationSegment, ValidationIssueCode, markdown_block_ranges, validate_prd_response,
    validate_selection_response, validate_summary_response, validate_translation,
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

fn summary_response(
    detected_source_language: &str,
    summary_language: &str,
    summary_markdown: &str,
) -> SummaryResponse {
    SummaryResponse {
        schema_version: AI_SCHEMA_VERSION,
        detected_source_language: detected_source_language.to_string(),
        summary_language: summary_language.to_string(),
        summary_markdown: summary_markdown.to_string(),
        warnings: vec!["Date copied from source.".to_string()],
    }
}

#[test]
fn summary_validation_builds_a_standalone_operation_free_document() {
    let envelope =
        AiDocumentEnvelope::new("doc-1", "# Plan\n\nShip Friday.", None).expect("envelope");

    let validated = validate_summary_response(
        &envelope,
        summary_response("en", "ko", "# 요약\n\n금요일에 출시합니다."),
        Some("ko-KR"),
    )
    .expect("valid summary");

    assert_eq!(
        validated.proposed_markdown,
        "# 요약\n\n금요일에 출시합니다."
    );
    assert!(validated.operations.is_empty());
    assert!(validated.hunks.is_empty());
    assert!(validated.findings.is_empty());
    assert!(validated.assumptions.is_empty());
    assert_eq!(validated.detected_source_language.as_deref(), Some("en"));
    assert_eq!(validated.target_language.as_deref(), Some("ko"));
    assert_eq!(validated.warnings, vec!["Date copied from source."]);
}

#[test]
fn summary_validation_rejects_invalid_content_and_languages() {
    let envelope = AiDocumentEnvelope::new("doc-1", "English source", None).expect("envelope");
    let cases = [
        (
            summary_response("en", "ko", "   \n"),
            Some("ko"),
            ValidationIssueCode::EmptySummary,
        ),
        (
            summary_response("en", "ko", "# Sum\0mary"),
            Some("ko"),
            ValidationIssueCode::InvalidSummary,
        ),
        (
            SummaryResponse {
                schema_version: AI_SCHEMA_VERSION + 1,
                ..summary_response("en", "ko", "# 요약")
            },
            Some("ko"),
            ValidationIssueCode::InvalidSchemaVersion,
        ),
        (
            summary_response("", "ko", "# 요약"),
            Some("ko"),
            ValidationIssueCode::InvalidLanguage,
        ),
        (
            summary_response("en", "", "# Summary"),
            None,
            ValidationIssueCode::InvalidLanguage,
        ),
        (
            summary_response("en", "ja", "# Summary"),
            Some("ko"),
            ValidationIssueCode::LanguageMismatch,
        ),
        (
            summary_response("en-US", "ko", "# 요약"),
            None,
            ValidationIssueCode::LanguageMismatch,
        ),
    ];

    for (response, requested_language, expected_code) in cases {
        let error = validate_summary_response(&envelope, response, requested_language)
            .expect_err("invalid summary must fail closed");
        assert_eq!(error.issues[0].code, expected_code);
    }
}

#[test]
fn source_language_summary_accepts_matching_primary_subtags() {
    let envelope = AiDocumentEnvelope::new("doc-1", "English source", None).expect("envelope");

    let validated = validate_summary_response(
        &envelope,
        summary_response("en-US", "en-GB", "# Summary"),
        None,
    )
    .expect("matching primary language");

    assert_eq!(validated.detected_source_language.as_deref(), Some("en-us"));
    assert_eq!(validated.target_language.as_deref(), Some("en-gb"));
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
fn obsidian_frontmatter_is_task_aware_and_round_trips_exactly() {
    let source = include_str!("../../../tests/fixtures/obsidian-frontmatter.md");
    let default_envelope = AiDocumentEnvelope::new("obsidian-default", source, None)
        .expect("default envelope");
    assert!(default_envelope.protected.iter().any(|token| {
        token.original
            .contains("title: \"AI가 코드를 짜주는 시대에, 우리는 왜 개발자를 찾을까요?\"")
    }));

    let translation_envelope = AiDocumentEnvelope::with_policy(
        "obsidian-translation",
        source,
        None,
        ProtectionPolicy {
            translate_frontmatter_values: true,
            ..ProtectionPolicy::default()
        },
    )
    .expect("translation envelope");
    let editable = translation_envelope
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<String>();
    assert!(editable.contains("AI가 코드를 짜주는 시대에, 우리는 왜 개발자를 찾을까요?"));
    assert!(editable.contains("More"));
    assert!(translation_envelope
        .protected
        .iter()
        .any(|token| token.original.contains("source: \"https://medium.com/")));
    assert!(translation_envelope
        .protected
        .iter()
        .any(|token| token.original.contains("[[Career]]")));
    assert!(translation_envelope
        .protected
        .iter()
        .any(|token| token.original.contains("published: 2026-07-14")));

    let validated = validate_translation(
        &translation_envelope,
        translated_identity(&translation_envelope),
    )
    .expect("identity translation");
    assert_eq!(validated.proposed_markdown, source);
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

#[test]
fn provider_responses_accept_the_prd_snake_case_schema() {
    let translation: TranslationResponse = serde_json::from_value(serde_json::json!({
        "schema_version": 1,
        "detected_source_language": "en",
        "target_language": "ko",
        "segments": [{"id": "segment-1", "translated_text": "번역"}],
        "warnings": []
    }))
    .expect("translation schema");
    let prd: PrdResponse = serde_json::from_value(serde_json::json!({
        "schema_version": 1,
        "summary": "Clearer acceptance criteria",
        "findings": [{
            "id": "finding-1",
            "severity": "high",
            "category": "ambiguity",
            "evidence_segment_id": "segment-1",
            "rationale": "No measurable threshold"
        }],
        "operations": [{
            "id": "operation-1",
            "kind": "replace",
            "target_segment_id": "segment-1",
            "markdown": "Measurable",
            "finding_ids": ["finding-1"]
        }],
        "assumptions": []
    }))
    .expect("PRD schema");
    let selection: SelectionResponse = serde_json::from_value(serde_json::json!({
        "schema_version": 1,
        "replacement_text": "Rewritten",
        "warnings": []
    }))
    .expect("selection schema");

    assert_eq!(translation.schema_version, 1);
    assert_eq!(translation.segments[0].translated_text, "번역");
    assert_eq!(prd.operations[0].target_segment_id, "segment-1");
    assert_eq!(selection.replacement_text, "Rewritten");
}

#[test]
fn markdown_block_ranges_partition_frontmatter_tables_and_fences_exactly() {
    let source = concat!(
        "---\r\n",
        "title: Test\r\n",
        "---\r\n",
        "# Heading\r\n\r\n",
        "| A | B |\r\n",
        "| - | - |\r\n",
        "| 1 | 2 |\r\n\r\n",
        "```rust\r\n",
        "fn main() {}\r\n",
        "```\r\n",
    );

    let blocks = markdown_block_ranges(source);
    let reconstructed = blocks
        .iter()
        .map(|block| &source[block.range.start..block.range.end])
        .collect::<String>();

    assert_eq!(reconstructed, source);
    assert!(blocks.iter().any(|block| block.heading.as_deref() == Some("Heading")));
    assert!(blocks.iter().all(|block| {
        source.is_char_boundary(block.range.start) && source.is_char_boundary(block.range.end)
    }));
}
