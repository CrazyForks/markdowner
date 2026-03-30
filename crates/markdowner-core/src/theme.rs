use crate::Document;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeKind {
    BuiltInLight,
    BuiltInDark,
    CustomCss,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThemeSelection {
    kind: ThemeKind,
    stylesheet: Option<String>,
}

impl ThemeSelection {
    pub fn new(kind: ThemeKind, stylesheet: Option<String>) -> Self {
        Self { kind, stylesheet }
    }

    pub fn kind(&self) -> ThemeKind {
        self.kind
    }

    pub fn stylesheet(&self) -> Option<&str> {
        self.stylesheet.as_deref()
    }
}

impl Default for ThemeSelection {
    fn default() -> Self {
        Self::new(ThemeKind::BuiltInLight, None)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThemePalette {
    background: String,
    foreground: String,
    accent: String,
    code_background: String,
}

impl ThemePalette {
    fn new(
        background: impl Into<String>,
        foreground: impl Into<String>,
        accent: impl Into<String>,
        code_background: impl Into<String>,
    ) -> Self {
        Self {
            background: background.into(),
            foreground: foreground.into(),
            accent: accent.into(),
            code_background: code_background.into(),
        }
    }

    pub fn background(&self) -> &str {
        &self.background
    }

    pub fn foreground(&self) -> &str {
        &self.foreground
    }

    pub fn accent(&self) -> &str {
        &self.accent
    }

    pub fn code_background(&self) -> &str {
        &self.code_background
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppliedTheme {
    palette: ThemePalette,
    stylesheet: Option<String>,
}

impl AppliedTheme {
    pub fn palette(&self) -> &ThemePalette {
        &self.palette
    }

    pub fn stylesheet(&self) -> Option<&str> {
        self.stylesheet.as_deref()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StyledDocument {
    document: Document,
    theme: AppliedTheme,
}

impl StyledDocument {
    pub fn document(&self) -> &Document {
        &self.document
    }

    pub fn theme(&self) -> &AppliedTheme {
        &self.theme
    }
}

pub fn apply_theme(document: &Document, selection: &ThemeSelection) -> StyledDocument {
    let palette = match selection.kind() {
        ThemeKind::BuiltInLight => ThemePalette::new("#ffffff", "#161616", "#2f6fed", "#f4f6fa"),
        ThemeKind::BuiltInDark => ThemePalette::new("#14161a", "#f5f7fa", "#7fb0ff", "#21252b"),
        ThemeKind::CustomCss => ThemePalette::new("#ffffff", "#161616", "#4c7fff", "#eef2ff"),
    };

    StyledDocument {
        document: document.clone(),
        theme: AppliedTheme {
            palette,
            stylesheet: selection.stylesheet.clone(),
        },
    }
}
