use std::path::{Path, PathBuf};

use crate::{Document, ThemeSelection};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EditorMode {
    #[default]
    Wysiwyg,
    Source,
    Preview,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenDocument {
    path: PathBuf,
    document: Document,
}

impl OpenDocument {
    pub fn new(path: PathBuf, document: Document) -> Self {
        Self { path, document }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn document(&self) -> &Document {
        &self.document
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WorkspaceState {
    root_dir: Option<PathBuf>,
    open_documents: Vec<OpenDocument>,
    recent_documents: Vec<PathBuf>,
    active_document: Option<PathBuf>,
    theme: ThemeSelection,
    mode: EditorMode,
}

impl WorkspaceState {
    pub fn set_root_dir(&mut self, root_dir: PathBuf) {
        self.root_dir = Some(root_dir);
    }

    pub fn root_dir(&self) -> Option<&Path> {
        self.root_dir.as_deref()
    }

    pub fn open_document(&mut self, path: PathBuf, document: Document) {
        if let Some(existing) = self
            .open_documents
            .iter_mut()
            .find(|open_document| open_document.path == path)
        {
            existing.document = document;
        } else {
            self.open_documents
                .push(OpenDocument::new(path.clone(), document));
        }

        self.active_document = Some(path.clone());
        self.remember_recent(path);
    }

    pub fn open_documents(&self) -> &[OpenDocument] {
        &self.open_documents
    }

    pub fn recent_documents(&self) -> &[PathBuf] {
        &self.recent_documents
    }

    pub fn active_document_path(&self) -> Option<&Path> {
        self.active_document.as_deref()
    }

    pub fn set_mode(&mut self, mode: EditorMode) {
        self.mode = mode;
    }

    pub fn mode(&self) -> EditorMode {
        self.mode
    }

    pub fn set_theme(&mut self, theme: ThemeSelection) {
        self.theme = theme;
    }

    pub fn theme(&self) -> &ThemeSelection {
        &self.theme
    }

    pub fn remember_recent(&mut self, path: PathBuf) {
        self.recent_documents.retain(|existing| existing != &path);
        self.recent_documents.insert(0, path);
    }
}
