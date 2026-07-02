use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSearchOptions {
    #[serde(default)]
    case_sensitive: bool,
    #[serde(default)]
    whole_word: bool,
    #[serde(default)]
    regex: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSearchMatch {
    line: u32,
    column: u32,
    preview: String,
    match_start: u32,
    match_end: u32,
    absolute_offset: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSearchFile {
    path: String,
    matches: Vec<WorkspaceSearchMatch>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSearchResult {
    files: Vec<WorkspaceSearchFile>,
}

const WORKSPACE_SEARCH_PREVIEW_RADIUS: usize = 80;
const WORKSPACE_SEARCH_MAX_MATCHES_PER_FILE: usize = 200;
const WORKSPACE_SEARCH_MAX_TOTAL_MATCHES: usize = 2000;

fn is_word_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn line_column_for_offset(source: &str, offset: usize) -> (u32, u32) {
    let mut line: u32 = 1;
    let mut last_newline: usize = 0;
    for (idx, ch) in source.char_indices() {
        if idx >= offset {
            break;
        }
        if ch == '\n' {
            line += 1;
            last_newline = idx + 1;
        }
    }
    let column_chars = source[last_newline..offset].chars().count();
    (line, (column_chars as u32) + 1)
}

fn preview_window(
    line_text: &str,
    match_start_in_line: usize,
    match_end_in_line: usize,
) -> (String, usize, usize) {
    let char_indices: Vec<(usize, char)> = line_text.char_indices().collect();
    let start_char_idx = char_indices
        .iter()
        .position(|(byte_idx, _)| *byte_idx >= match_start_in_line)
        .unwrap_or(char_indices.len());
    let end_char_idx = char_indices
        .iter()
        .position(|(byte_idx, _)| *byte_idx >= match_end_in_line)
        .unwrap_or(char_indices.len());
    let preview_char_start = start_char_idx.saturating_sub(WORKSPACE_SEARCH_PREVIEW_RADIUS);
    let preview_char_end = (end_char_idx + WORKSPACE_SEARCH_PREVIEW_RADIUS).min(char_indices.len());
    let preview_byte_start = char_indices
        .get(preview_char_start)
        .map(|(byte_idx, _)| *byte_idx)
        .unwrap_or(0);
    let preview_byte_end = if preview_char_end == char_indices.len() {
        line_text.len()
    } else {
        char_indices[preview_char_end].0
    };
    let preview = line_text[preview_byte_start..preview_byte_end].to_string();
    let highlight_start = match_start_in_line.saturating_sub(preview_byte_start);
    let highlight_end = (match_end_in_line.saturating_sub(preview_byte_start)).min(preview.len());
    (preview, highlight_start, highlight_end)
}

fn search_file_contents(
    source: &str,
    pattern: &regex::Regex,
    whole_word: bool,
    remaining_budget: usize,
) -> Vec<WorkspaceSearchMatch> {
    let mut matches: Vec<WorkspaceSearchMatch> = Vec::new();
    let limit = remaining_budget.min(WORKSPACE_SEARCH_MAX_MATCHES_PER_FILE);
    if limit == 0 {
        return matches;
    }

    let bytes = source.as_bytes();
    for capture in pattern.find_iter(source) {
        let start = capture.start();
        let end = capture.end();
        if start == end {
            continue;
        }

        if whole_word {
            let before_ok = start == 0 || !is_word_char(bytes[start - 1]);
            let after_ok = end >= bytes.len() || !is_word_char(bytes[end]);
            if !(before_ok && after_ok) {
                continue;
            }
        }

        let line_start = source[..start].rfind('\n').map(|p| p + 1).unwrap_or(0);
        let line_end = source[end..]
            .find('\n')
            .map(|offset| end + offset)
            .unwrap_or(source.len());
        let line_text = &source[line_start..line_end];
        let match_start_in_line = start - line_start;
        let match_end_in_line = end - line_start;
        let (preview, highlight_start, highlight_end) =
            preview_window(line_text, match_start_in_line, match_end_in_line);
        let (line, column) = line_column_for_offset(source, start);
        matches.push(WorkspaceSearchMatch {
            line,
            column,
            preview,
            match_start: highlight_start as u32,
            match_end: highlight_end as u32,
            absolute_offset: start as u32,
        });

        if matches.len() >= limit {
            break;
        }
    }

    matches
}

fn compile_search_pattern(
    query: &str,
    options: &WorkspaceSearchOptions,
) -> Result<regex::Regex, String> {
    let escaped = if options.regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let mut builder = regex::RegexBuilder::new(&escaped);
    builder.case_insensitive(!options.case_sensitive);
    builder.multi_line(true);
    builder
        .build()
        .map_err(|error| format!("Invalid pattern: {}", error))
}

#[tauri::command]
pub(crate) fn search_workspace(
    query: String,
    options: WorkspaceSearchOptions,
    paths: Vec<String>,
) -> Result<WorkspaceSearchResult, String> {
    if query.is_empty() {
        return Ok(WorkspaceSearchResult { files: Vec::new() });
    }

    let pattern = compile_search_pattern(&query, &options)?;
    let mut files: Vec<WorkspaceSearchFile> = Vec::new();
    let mut total = 0usize;

    for raw_path in paths {
        if total >= WORKSPACE_SEARCH_MAX_TOTAL_MATCHES {
            break;
        }
        let path = Path::new(&raw_path);
        let Ok(source) = std::fs::read_to_string(path) else {
            continue;
        };
        let remaining = WORKSPACE_SEARCH_MAX_TOTAL_MATCHES - total;
        let matches = search_file_contents(&source, &pattern, options.whole_word, remaining);
        if matches.is_empty() {
            continue;
        }
        total += matches.len();
        files.push(WorkspaceSearchFile {
            path: raw_path,
            matches,
        });
    }

    Ok(WorkspaceSearchResult { files })
}

#[cfg(test)]
mod tests {
    use super::{
        compile_search_pattern, preview_window, search_file_contents, WorkspaceSearchOptions,
    };

    #[test]
    fn search_file_contents_respects_whole_word_boundaries() {
        let options = WorkspaceSearchOptions {
            case_sensitive: true,
            whole_word: true,
            regex: false,
        };
        let pattern = compile_search_pattern("cat", &options).unwrap();

        let matches = search_file_contents("cat scatter cat_ cat", &pattern, true, 10);

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].column, 1);
        assert_eq!(matches[1].column, 18);
    }

    #[test]
    fn preview_window_reports_highlight_offsets_relative_to_the_preview() {
        let (preview, start, end) = preview_window("prefix needle suffix", 7, 13);

        assert_eq!(preview, "prefix needle suffix");
        assert_eq!((start, end), (7, 13));
    }
}
