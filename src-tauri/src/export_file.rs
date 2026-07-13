use std::path::Path;

pub fn write_text_file(path: &str, contents: &str) -> Result<(), String> {
    let path = Path::new(path);
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(path, contents).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::write_text_file;

    #[test]
    fn creates_nested_export_directories() {
        let temp = tempfile::tempdir().unwrap();
        let output = temp.path().join("exports/docs/guide.html");

        write_text_file(output.to_str().unwrap(), "<h1>Guide</h1>").unwrap();

        assert_eq!(std::fs::read_to_string(output).unwrap(), "<h1>Guide</h1>");
    }
}
