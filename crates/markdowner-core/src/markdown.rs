use crate::{Block, Document};

pub fn parse_markdown(source: &str) -> Document {
    let normalized = source.replace("\r\n", "\n");
    let mut blocks = Vec::new();
    let mut paragraph_lines = Vec::new();
    let mut code_language: Option<Option<String>> = None;
    let mut code_lines = Vec::new();

    let flush_paragraph = |paragraph_lines: &mut Vec<String>, blocks: &mut Vec<Block>| {
        if paragraph_lines.is_empty() {
            return;
        }

        blocks.push(Block::Paragraph(paragraph_lines.join("\n")));
        paragraph_lines.clear();
    };

    for line in normalized.lines() {
        if let Some(language) = code_language.as_ref() {
            if line.starts_with("```") {
                blocks.push(Block::CodeFence {
                    language: language.clone(),
                    code: code_lines.join("\n"),
                });
                code_language = None;
                code_lines.clear();
            } else {
                code_lines.push(line.to_string());
            }
            continue;
        }

        if line.trim().is_empty() {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            continue;
        }

        if let Some(rest) = line.strip_prefix("```") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            let language = match rest.trim() {
                "" => None,
                value => Some(value.to_string()),
            };
            code_language = Some(language);
            continue;
        }

        if let Some((level, text)) = parse_heading(line) {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::Heading { level, text });
            continue;
        }

        if let Some(text) = line.strip_prefix("> ") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::Quote(text.to_string()));
            continue;
        }

        if let Some(text) = line.strip_prefix("- [x] ") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::ChecklistItem {
                checked: true,
                text: text.to_string(),
            });
            continue;
        }

        if let Some(text) = line.strip_prefix("- [ ] ") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::ChecklistItem {
                checked: false,
                text: text.to_string(),
            });
            continue;
        }

        if let Some(text) = line.strip_prefix("- ") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            blocks.push(Block::BulletItem(text.to_string()));
            continue;
        }

        paragraph_lines.push(line.to_string());
    }

    if let Some(language) = code_language {
        blocks.push(Block::CodeFence {
            language,
            code: code_lines.join("\n"),
        });
    } else {
        flush_paragraph(&mut paragraph_lines, &mut blocks);
    }

    Document::new(blocks)
}

pub fn serialize_markdown(document: &Document) -> String {
    document
        .blocks()
        .iter()
        .map(|block| match block {
            Block::Heading { level, text } => format!("{} {}", "#".repeat((*level).into()), text),
            Block::Paragraph(text) => text.clone(),
            Block::Quote(text) => format!("> {text}"),
            Block::BulletItem(text) => format!("- {text}"),
            Block::ChecklistItem { checked, text } => {
                format!("- [{}] {text}", if *checked { "x" } else { " " })
            }
            Block::CodeFence { language, code } => match language {
                Some(language) => format!("```{language}\n{code}\n```"),
                None => format!("```\n{code}\n```"),
            },
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn parse_heading(line: &str) -> Option<(u8, String)> {
    let level = line.bytes().take_while(|byte| *byte == b'#').count();
    if !(1..=6).contains(&level) {
        return None;
    }

    let text = line.get(level + 1..)?;
    if line.as_bytes().get(level).is_none_or(|byte| *byte != b' ') {
        return None;
    }

    Some((level as u8, text.to_string()))
}
