use std::path::PathBuf;

use crate::{Document, WorkspaceState};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileDialogOptions {
    title: String,
    allowed_extensions: Vec<String>,
}

impl FileDialogOptions {
    pub fn new(title: impl Into<String>, allowed_extensions: Vec<String>) -> Self {
        Self {
            title: title.into(),
            allowed_extensions,
        }
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    pub fn allowed_extensions(&self) -> &[String] {
        &self.allowed_extensions
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowDescriptor {
    id: String,
    title: String,
}

impl WindowDescriptor {
    pub fn new(id: impl Into<String>, title: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn title(&self) -> &str {
        &self.title
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuItem {
    command: String,
    title: String,
}

impl MenuItem {
    pub fn new(command: impl Into<String>, title: impl Into<String>) -> Self {
        Self {
            command: command.into(),
            title: title.into(),
        }
    }

    pub fn command(&self) -> &str {
        &self.command
    }

    pub fn title(&self) -> &str {
        &self.title
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuDescriptor {
    items: Vec<MenuItem>,
}

impl MenuDescriptor {
    pub fn new(items: Vec<MenuItem>) -> Self {
        Self { items }
    }

    pub fn items(&self) -> &[MenuItem] {
        &self.items
    }
}

pub trait PlatformAdapter {
    fn open_file(&mut self, options: &FileDialogOptions) -> Option<PathBuf>;
    fn open_folder(&mut self, title: &str) -> Option<PathBuf>;
    fn present_window(&mut self, descriptor: &WindowDescriptor);
    fn install_menu(&mut self, descriptor: &MenuDescriptor);
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EditorRuntime {
    workspace: WorkspaceState,
}

impl EditorRuntime {
    pub fn new(workspace: WorkspaceState) -> Self {
        Self { workspace }
    }

    pub fn workspace(&self) -> &WorkspaceState {
        &self.workspace
    }

    pub fn workspace_mut(&mut self) -> &mut WorkspaceState {
        &mut self.workspace
    }

    pub fn bootstrap_ui(&mut self, adapter: &mut impl PlatformAdapter) {
        adapter.present_window(&WindowDescriptor::new("main", "Markdowner"));
        adapter.install_menu(&MenuDescriptor::new(vec![
            MenuItem::new("open-document", "Open…"),
            MenuItem::new("open-workspace", "Open Folder…"),
        ]));
    }

    pub fn open_document_via(&mut self, adapter: &mut impl PlatformAdapter) -> Option<PathBuf> {
        let path = adapter.open_file(&FileDialogOptions::new(
            "Open Markdown",
            vec!["md".to_string()],
        ))?;
        self.workspace
            .open_document(path.clone(), Document::default());
        Some(path)
    }

    pub fn open_workspace_via(&mut self, adapter: &mut impl PlatformAdapter) -> Option<PathBuf> {
        let path = adapter.open_folder("Open Workspace")?;
        self.workspace.set_root_dir(path.clone());
        Some(path)
    }
}
