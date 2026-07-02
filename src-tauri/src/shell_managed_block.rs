#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ManagedShellBlock {
    begin_marker: &'static str,
    end_marker: &'static str,
}

impl ManagedShellBlock {
    pub(crate) const fn new(begin_marker: &'static str, end_marker: &'static str) -> Self {
        Self {
            begin_marker,
            end_marker,
        }
    }

    pub(crate) fn render(&self, body: &str) -> String {
        format!("{}\n{}\n{}\n", self.begin_marker, body, self.end_marker)
    }

    pub(crate) fn remove_from(&self, contents: &str) -> String {
        let Some(start) = contents.find(self.begin_marker) else {
            return contents.to_string();
        };
        let Some(end_relative) = contents[start..].find(self.end_marker) else {
            return contents.to_string();
        };

        let end = start + end_relative + self.end_marker.len();
        let remove_end = if contents[end..].starts_with("\r\n") {
            end + 2
        } else if contents[end..].starts_with('\n') {
            end + 1
        } else {
            end
        };

        format!("{}{}", &contents[..start], &contents[remove_end..])
    }

    pub(crate) fn append_to(&self, mut contents: String, block: &str) -> String {
        if !contents.is_empty() && !contents.ends_with('\n') {
            contents.push('\n');
        }
        if !contents.trim().is_empty() && !contents.ends_with("\n\n") {
            contents.push('\n');
        }
        contents.push_str(block);
        contents
    }

    pub(crate) fn marker_is_present(&self, contents: &str) -> bool {
        contents.contains(self.begin_marker)
    }
}

#[cfg(test)]
mod tests {
    use super::ManagedShellBlock;

    const BLOCK: ManagedShellBlock = ManagedShellBlock::new("# begin", "# end");

    #[test]
    fn remove_from_deletes_the_managed_block_and_one_trailing_newline() {
        let contents = "before\n# begin\nmanaged\n# end\nafter\n";

        assert_eq!(BLOCK.remove_from(contents), "before\nafter\n");
    }

    #[test]
    fn remove_from_preserves_contents_when_end_marker_is_missing() {
        let contents = "before\n# begin\nmanaged\n";

        assert_eq!(BLOCK.remove_from(contents), contents);
    }

    #[test]
    fn append_to_separates_user_contents_from_the_managed_block() {
        let block = BLOCK.render("managed");

        assert_eq!(
            BLOCK.append_to("before".to_string(), &block),
            "before\n\n# begin\nmanaged\n# end\n"
        );
    }
}
