use serde::{Deserialize, Serialize};

use crate::EditorMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_save: bool,
    pub editor_font_size: u32,
    pub editor_font_family: String,
    pub editor_line_wrap: bool,
    pub default_mode: EditorMode,
    pub focus_mode_enabled: bool,
    pub typewriter_mode_enabled: bool,
    pub asset_folder: String,
    pub theme_follow_system: bool,
    pub pdf_paper_size: String,
    pub diagnostics_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_save: false,
            editor_font_size: 0,
            editor_font_family: String::new(),
            editor_line_wrap: true,
            default_mode: EditorMode::Wysiwyg,
            focus_mode_enabled: false,
            typewriter_mode_enabled: false,
            asset_folder: "assets".to_string(),
            theme_follow_system: true,
            pdf_paper_size: "A4".to_string(),
            diagnostics_enabled: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Settings;

    #[test]
    fn legacy_settings_json_without_line_wrap_defaults_to_enabled() {
        let legacy = r#"{"autoSave":true,"editorFontSize":16,"editorFontFamily":"Mono"}"#;
        let parsed: Settings = serde_json::from_str(legacy).expect("legacy settings.json parses");
        assert!(parsed.auto_save);
        assert_eq!(parsed.editor_font_size, 16);
        assert_eq!(parsed.editor_font_family, "Mono");
        assert!(
            parsed.editor_line_wrap,
            "missing editorLineWrap should default to true"
        );
    }

    #[test]
    fn settings_round_trip_preserves_line_wrap_disabled() {
        let original = Settings {
            auto_save: false,
            editor_font_size: 14,
            editor_font_family: String::new(),
            editor_line_wrap: false,
            ..Default::default()
        };
        let payload = serde_json::to_string(&original).expect("serialize");
        assert!(payload.contains("\"editorLineWrap\":false"));
        let parsed: Settings = serde_json::from_str(&payload).expect("parse");
        assert!(!parsed.editor_line_wrap);
    }
}
