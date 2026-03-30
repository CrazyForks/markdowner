use std::path::PathBuf;

use markdowner_core::{
    EditorRuntime, FileDialogOptions, MenuDescriptor, PlatformAdapter, WindowDescriptor,
    WorkspaceState,
};

use crate::appkit_bridge::AppKitBridge;

#[derive(Debug, Default)]
pub struct MacPlatformAdapter {
    bridge: AppKitBridge,
}

impl MacPlatformAdapter {
    pub fn new() -> Self {
        Self {
            bridge: AppKitBridge::new(),
        }
    }

    pub fn with_next_file_selection(mut self, path: Option<PathBuf>) -> Self {
        self.bridge.set_next_file_selection(path);
        self
    }

    pub fn with_next_folder_selection(mut self, path: Option<PathBuf>) -> Self {
        self.bridge.set_next_folder_selection(path);
        self
    }

    #[cfg(test)]
    fn window_titles(&self) -> Vec<String> {
        self.bridge.window_titles()
    }

    #[cfg(test)]
    fn installed_menu_commands(&self) -> Vec<String> {
        self.bridge.installed_menu_commands().to_vec()
    }
}

impl PlatformAdapter for MacPlatformAdapter {
    fn open_file(&mut self, options: &FileDialogOptions) -> Option<PathBuf> {
        self.bridge.choose_file(options)
    }

    fn open_folder(&mut self, title: &str) -> Option<PathBuf> {
        self.bridge.choose_folder(title)
    }

    fn present_window(&mut self, descriptor: &WindowDescriptor) {
        self.bridge.create_window(descriptor);
    }

    fn install_menu(&mut self, descriptor: &MenuDescriptor) {
        self.bridge.install_menu(descriptor);
    }
}

#[derive(Debug, Default)]
pub struct MacShell {
    runtime: EditorRuntime,
    adapter: MacPlatformAdapter,
}

impl MacShell {
    pub fn new(workspace: WorkspaceState) -> Self {
        Self {
            runtime: EditorRuntime::new(workspace),
            adapter: MacPlatformAdapter::new(),
        }
    }

    pub fn with_adapter(runtime: EditorRuntime, adapter: MacPlatformAdapter) -> Self {
        Self { runtime, adapter }
    }

    pub fn bootstrap(&mut self) {
        self.runtime.bootstrap_ui(&mut self.adapter);
    }

    pub fn request_document_open(&mut self) -> Option<PathBuf> {
        self.runtime.open_document_via(&mut self.adapter)
    }

    pub fn request_workspace_open(&mut self) -> Option<PathBuf> {
        self.runtime.open_workspace_via(&mut self.adapter)
    }

    pub fn workspace(&self) -> &WorkspaceState {
        self.runtime.workspace()
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use markdowner_core::WorkspaceState;

    use super::{EditorRuntime, MacPlatformAdapter, MacShell};

    #[test]
    fn mac_shell_keeps_appkit_details_behind_private_bridge() {
        let adapter = MacPlatformAdapter::new()
            .with_next_file_selection(Some(PathBuf::from("/tmp/notes.md")))
            .with_next_folder_selection(Some(PathBuf::from("/tmp/workspace")));
        let runtime = EditorRuntime::default();
        let mut shell = MacShell::with_adapter(runtime, adapter);

        shell.bootstrap();
        let document = shell.request_document_open();
        let workspace = shell.request_workspace_open();

        assert_eq!(
            document.as_deref(),
            Some(PathBuf::from("/tmp/notes.md").as_path())
        );
        assert_eq!(
            workspace.as_deref(),
            Some(PathBuf::from("/tmp/workspace").as_path())
        );
        assert_eq!(
            shell.workspace().active_document_path(),
            Some(PathBuf::from("/tmp/notes.md").as_path())
        );
    }

    #[test]
    fn mac_platform_adapter_records_window_and_menu_requests() {
        let mut shell = MacShell::new(WorkspaceState::default());

        shell.bootstrap();

        assert_eq!(
            shell.adapter.window_titles(),
            vec!["Markdowner".to_string()]
        );
        assert_eq!(
            shell.adapter.installed_menu_commands(),
            vec!["open-document".to_string(), "open-workspace".to_string()]
        );
    }
}
