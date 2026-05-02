use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub auto_save: bool,
    pub editor_font_size: u32,
    pub editor_font_family: String,
}
