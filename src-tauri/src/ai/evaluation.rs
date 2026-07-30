use std::collections::HashSet;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdEvaluationFixture {
    pub id: String,
    pub language: String,
    pub source: String,
    pub labels: Vec<String>,
    #[serde(default)]
    pub unsupported_claims: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationEvaluationFixture {
    pub id: String,
    pub direction: String,
    pub source: String,
    pub target_language: String,
    pub protected_tokens: Vec<String>,
    pub required_literals: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptInjectionFixture {
    pub id: String,
    pub language: String,
    pub source: String,
    pub attack_type: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PrdEvaluationScore {
    pub recall: f64,
    pub precision: f64,
    pub unsupported_fact_rate: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TranslationEvaluationScore {
    pub protected_byte_preservation: f64,
    pub required_literal_preservation: f64,
    pub applicable: bool,
}

pub fn load_prd_fixtures() -> Result<Vec<PrdEvaluationFixture>, serde_json::Error> {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/ai/prd-evaluation.json"
    ))
}

pub fn load_translation_fixtures() -> Result<Vec<TranslationEvaluationFixture>, serde_json::Error> {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/ai/translation-evaluation.json"
    ))
}

pub fn load_prompt_injection_fixtures() -> Result<Vec<PromptInjectionFixture>, serde_json::Error> {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/ai/prompt-injection-evaluation.json"
    ))
}

pub fn score_prd_labels(
    fixture: &PrdEvaluationFixture,
    predicted_labels: &[String],
    unsupported_facts: &[String],
) -> PrdEvaluationScore {
    let expected = fixture
        .labels
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let predicted = predicted_labels
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let true_positives = expected.intersection(&predicted).count() as f64;
    let recall = ratio(true_positives, expected.len());
    let precision = ratio(true_positives, predicted.len());
    let unsupported_fact_rate = ratio(unsupported_facts.len() as f64, predicted.len());
    PrdEvaluationScore {
        recall,
        precision,
        unsupported_fact_rate,
    }
}

pub fn score_translation_output(
    fixture: &TranslationEvaluationFixture,
    output: &str,
    applicable: bool,
) -> TranslationEvaluationScore {
    let protected = fixture
        .protected_tokens
        .iter()
        .filter(|token| output.contains(token.as_str()))
        .count() as f64;
    let required = fixture
        .required_literals
        .iter()
        .filter(|literal| output.contains(literal.as_str()))
        .count() as f64;
    TranslationEvaluationScore {
        protected_byte_preservation: ratio(protected, fixture.protected_tokens.len()),
        required_literal_preservation: ratio(required, fixture.required_literals.len()),
        applicable,
    }
}

fn ratio(numerator: f64, denominator: usize) -> f64 {
    if denominator == 0 {
        return if numerator == 0.0 { 1.0 } else { 0.0 };
    }
    numerator / denominator as f64
}

#[cfg(test)]
mod tests {
    use super::{
        load_prd_fixtures, load_prompt_injection_fixtures, load_translation_fixtures,
        score_prd_labels, score_translation_output,
    };

    #[test]
    fn evaluation_corpora_meet_mvp_counts_and_language_balance() {
        let prd = load_prd_fixtures().expect("load PRD fixtures");
        let translation = load_translation_fixtures().expect("load translation fixtures");

        assert_eq!(prd.len(), 30);
        assert_eq!(prd.iter().filter(|item| item.language == "ko").count(), 15);
        assert_eq!(prd.iter().filter(|item| item.language == "en").count(), 15);
        assert!(prd.iter().all(|item| {
            !item.id.is_empty()
                && !item.source.is_empty()
                && !item.labels.is_empty()
                && item
                    .unsupported_claims
                    .iter()
                    .all(|claim| !claim.trim().is_empty())
                && item.labels.iter().all(|label| !label.trim().is_empty())
        }));

        assert_eq!(translation.len(), 40);
        for direction in ["ko->en", "en->ko", "ja->ko", "zh->ko"] {
            assert_eq!(
                translation
                    .iter()
                    .filter(|item| item.direction == direction)
                    .count(),
                10,
                "{direction} fixture count"
            );
        }
        assert!(translation.iter().all(|item| {
            ["ko->en", "en->ko", "ja->ko", "zh->ko"].contains(&item.direction.as_str())
        }));
        assert!(translation.iter().all(|item| {
            !item.id.is_empty()
                && item.direction.contains("->")
                && !item.source.is_empty()
                && !item.target_language.is_empty()
                && !item.protected_tokens.is_empty()
                && !item.required_literals.is_empty()
                && item
                    .protected_tokens
                    .iter()
                    .all(|token| item.source.contains(token))
                && item
                    .required_literals
                    .iter()
                    .all(|literal| item.source.contains(literal))
        }));
    }

    #[test]
    fn offline_scores_are_deterministic_and_need_no_provider() {
        let prd = load_prd_fixtures().unwrap();
        let fixture = &prd[0];
        let score = score_prd_labels(fixture, &fixture.labels, &[]);
        assert_eq!(score.recall, 1.0);
        assert_eq!(score.precision, 1.0);
        assert_eq!(score.unsupported_fact_rate, 0.0);

        let translation = load_translation_fixtures().unwrap();
        let fixture = &translation[0];
        let output = fixture
            .protected_tokens
            .iter()
            .chain(fixture.required_literals.iter())
            .cloned()
            .collect::<Vec<_>>()
            .join(" ");
        let score = score_translation_output(fixture, &output, true);
        assert_eq!(score.protected_byte_preservation, 1.0);
        assert_eq!(score.required_literal_preservation, 1.0);
        assert!(score.applicable);
    }

    #[test]
    fn prompt_injection_corpus_has_twenty_labeled_documents() {
        let fixtures = load_prompt_injection_fixtures().expect("load injection fixtures");

        assert_eq!(fixtures.len(), 20);
        assert!(fixtures.iter().all(|fixture| {
            !fixture.id.is_empty()
                && !fixture.language.is_empty()
                && !fixture.source.is_empty()
                && !fixture.attack_type.is_empty()
        }));
    }
}
