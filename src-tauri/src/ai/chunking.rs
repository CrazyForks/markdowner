use std::ops::Range;

use markdowner_core::ai_document::{
    MarkdownBlockKind, MarkdownBlockRange, markdown_block_ranges,
};
use serde::{Deserialize, Serialize};

use super::AiError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationChunk {
    pub index: u32,
    pub source_range: Range<usize>,
    pub source: String,
    pub heading: Option<String>,
    pub estimated_input_tokens: u32,
    pub subdivision_depth: u8,
}

pub fn plan_translation_chunks(
    source: &str,
    max_estimated_tokens: u32,
) -> Result<Vec<TranslationChunk>, AiError> {
    if max_estimated_tokens == 0 {
        return Err(AiError::new(
            "invalid_chunk_limit",
            "Translation chunk size must be greater than zero.",
        ));
    }
    if source.is_empty() {
        return Ok(Vec::new());
    }
    let max_bytes = usize::try_from(max_estimated_tokens)
        .unwrap_or(usize::MAX)
        .saturating_mul(4);
    let mut atomic = Vec::new();
    for block in markdown_block_ranges(source) {
        if estimated_tokens(block.range.end - block.range.start) <= max_estimated_tokens
            || !can_split(block.kind)
        {
            atomic.push(block);
        } else {
            atomic.extend(split_text_block(source, &block, max_bytes));
        }
    }

    let mut chunks = Vec::new();
    let mut start = atomic.first().map(|block| block.range.start).unwrap_or(0);
    let mut end = start;
    let mut heading: Option<String> = None;
    for block in atomic {
        let next_tokens = estimated_tokens(block.range.end.saturating_sub(start));
        if end > start && next_tokens > max_estimated_tokens {
            push_chunk(&mut chunks, source, start, end, heading.clone(), 0);
            start = block.range.start;
        }
        if let Some(next_heading) = block.heading {
            heading = Some(next_heading);
        }
        end = block.range.end;
    }
    if end > start {
        push_chunk(&mut chunks, source, start, end, heading, 0);
    }
    if chunks.iter().any(|chunk| !balanced_fences(&chunk.source)) {
        return Err(AiError::new(
            "unbalanced_markdown_fence",
            "A translation chunk would separate a fenced code block.",
        ));
    }
    Ok(chunks)
}

pub fn subdivide_translation_chunk(
    chunk: &TranslationChunk,
) -> Result<Vec<TranslationChunk>, AiError> {
    if chunk.subdivision_depth >= 3 {
        return Err(AiError::new(
            "translation_chunk_exhausted",
            "The response remained truncated after three safe subdivisions.",
        ));
    }
    let target_tokens = (chunk.estimated_input_tokens / 2).max(1);
    let mut planned = plan_translation_chunks(&chunk.source, target_tokens)?;
    if planned.len() < 2 {
        return Err(AiError::new(
            "translation_chunk_unsplittable",
            "This Markdown block cannot be split without changing its structure.",
        ));
    }
    for (index, planned_chunk) in planned.iter_mut().enumerate() {
        planned_chunk.index = u32::try_from(index).unwrap_or(u32::MAX);
        planned_chunk.source_range =
            (chunk.source_range.start + planned_chunk.source_range.start)
                ..(chunk.source_range.start + planned_chunk.source_range.end);
        planned_chunk.subdivision_depth = chunk.subdivision_depth + 1;
        if planned_chunk.heading.is_none() {
            planned_chunk.heading = chunk.heading.clone();
        }
    }
    Ok(planned)
}

pub fn balanced_fences(source: &str) -> bool {
    let mut active: Option<&str> = None;
    for line in source.lines() {
        let trimmed = line.trim_start();
        let marker = if trimmed.starts_with("```") {
            Some("```")
        } else if trimmed.starts_with("~~~") {
            Some("~~~")
        } else {
            None
        };
        if let Some(marker) = marker {
            active = match active {
                Some(current) if current == marker => None,
                None => Some(marker),
                Some(current) => Some(current),
            };
        }
    }
    active.is_none()
}

fn can_split(kind: MarkdownBlockKind) -> bool {
    matches!(kind, MarkdownBlockKind::Paragraph | MarkdownBlockKind::Blank)
}

fn split_text_block(
    source: &str,
    block: &MarkdownBlockRange,
    max_bytes: usize,
) -> Vec<MarkdownBlockRange> {
    let mut ranges = Vec::new();
    let mut cursor = block.range.start;
    while block.range.end.saturating_sub(cursor) > max_bytes {
        let desired_end = cursor.saturating_add(max_bytes).min(block.range.end);
        let split = safe_text_boundary(source, cursor, desired_end, block.range.end);
        if split <= cursor || split >= block.range.end {
            break;
        }
        ranges.push(MarkdownBlockRange {
            range: markdowner_core::ai_document::ByteRange { start: cursor, end: split },
            kind: block.kind,
            heading: block.heading.clone(),
        });
        cursor = split;
    }
    ranges.push(MarkdownBlockRange {
        range: markdowner_core::ai_document::ByteRange {
            start: cursor,
            end: block.range.end,
        },
        kind: block.kind,
        heading: block.heading.clone(),
    });
    ranges
}

fn safe_text_boundary(source: &str, start: usize, desired_end: usize, end: usize) -> usize {
    let mut desired_end = desired_end;
    while desired_end > start && !source.is_char_boundary(desired_end) {
        desired_end -= 1;
    }
    let candidate = &source[start..desired_end];
    let mut best = None;
    for (offset, character) in candidate.char_indices() {
        if character == '\n'
            || matches!(character, '.' | '!' | '?' | '。' | '！' | '？')
        {
            best = Some(start + offset + character.len_utf8());
        }
    }
    if let Some(best) = best.filter(|best| *best > start) {
        return best;
    }
    if desired_end > start {
        return desired_end;
    }
    source[start..end]
        .char_indices()
        .nth(1)
        .map(|(offset, _)| start + offset)
        .unwrap_or(end)
}

fn push_chunk(
    chunks: &mut Vec<TranslationChunk>,
    source: &str,
    start: usize,
    end: usize,
    heading: Option<String>,
    subdivision_depth: u8,
) {
    chunks.push(TranslationChunk {
        index: u32::try_from(chunks.len()).unwrap_or(u32::MAX),
        source_range: start..end,
        source: source[start..end].to_string(),
        heading,
        estimated_input_tokens: estimated_tokens(end.saturating_sub(start)),
        subdivision_depth,
    });
}

fn estimated_tokens(bytes: usize) -> u32 {
    u32::try_from(bytes.saturating_add(3) / 4).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_plan_preserves_headings_tables_and_fences() {
        let source = include_str!("../../../tests/fixtures/ai/long-translation.md");
        let chunks = plan_translation_chunks(source, 80).unwrap();
        let reconstructed = chunks.iter().map(|chunk| chunk.source.as_str()).collect::<String>();

        assert!(chunks.len() > 2);
        assert!(chunks.iter().all(|chunk| balanced_fences(&chunk.source)));
        assert_eq!(reconstructed, source);
        assert!(chunks.iter().any(|chunk| chunk.heading.as_deref() == Some("Scope")));
    }

    #[test]
    fn subdivision_is_bounded_and_preserves_global_ranges() {
        let source = "One sentence. Two sentence. Three sentence. Four sentence. ".repeat(20);
        let chunk = TranslationChunk {
            index: 4,
            source_range: 100..100 + source.len(),
            source,
            heading: Some("Details".into()),
            estimated_input_tokens: 300,
            subdivision_depth: 2,
        };

        let split = subdivide_translation_chunk(&chunk).unwrap();

        assert!(split.len() >= 2);
        assert_eq!(split.first().unwrap().source_range.start, 100);
        assert_eq!(split.last().unwrap().source_range.end, chunk.source_range.end);
        assert!(split.iter().all(|item| item.subdivision_depth == 3));
    }
}
