import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';

export type { Settings } from '@/lib/settings';

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

const switchFieldClass = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4';
const inputFieldClass =
  'grid gap-2 sm:grid-cols-[minmax(8rem,1fr)_minmax(0,14rem)] sm:items-center';
const toggleFieldClass =
  'grid gap-2 sm:grid-cols-[minmax(8rem,1fr)_minmax(0,1fr)] sm:items-center';
const toggleGroupClass = 'h-auto w-full min-w-0 flex-wrap justify-start sm:justify-end';
const toggleItemClass = 'min-w-0 flex-1 basis-[5.75rem] sm:flex-none sm:basis-auto';

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
}: SettingsDialogProps) {
  const handleSettingChange = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const fontSizeValue = settings.editorFontSize || DEFAULT_SETTINGS.editorFontSize;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-3rem)] w-[min(calc(100vw-1rem),34rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-11">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your Markdowner workspace preferences.
          </DialogDescription>
        </DialogHeader>
        <div
          data-testid="settings-dialog-body"
          className="grid gap-4 overflow-y-auto px-4 py-4"
        >
          <div className="grid gap-2">
            <h4 className="text-sm font-medium leading-none">CLI Launcher</h4>
            <p className="text-sm text-muted-foreground">
              To use the markdowner CLI, add this to your shell config:
            </p>
            <pre className="min-w-0 whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">
              alias markdowner="/Applications/Markdowner.app/Contents/MacOS/markdowner"
            </pre>
          </div>
          <Separator />
          <div className="grid gap-3">
            <h4 className="text-sm font-medium leading-none">Editor Preferences</h4>

            <div className={switchFieldClass}>
              <Label htmlFor="auto-save" className="text-sm">Auto Save</Label>
              <Switch
                id="auto-save"
                checked={settings.autoSave}
                onCheckedChange={(checked) => handleSettingChange('autoSave', checked)}
              />
            </div>

            <div className={inputFieldClass}>
              <Label htmlFor="font-size" className="text-sm">Font Size</Label>
              <Input
                id="font-size"
                type="number"
                min={8}
                max={48}
                className="h-8 w-full min-w-0"
                value={fontSizeValue}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  handleSettingChange(
                    'editorFontSize',
                    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.editorFontSize,
                  );
                }}
              />
            </div>

            <div data-testid="settings-field-font-family" className={inputFieldClass}>
              <Label htmlFor="font-family" className="text-sm">Font Family</Label>
              <Input
                id="font-family"
                type="text"
                placeholder="System default"
                className="h-8 w-full min-w-0"
                value={settings.editorFontFamily}
                onChange={(event) => handleSettingChange('editorFontFamily', event.target.value)}
              />
            </div>

            <div className={inputFieldClass}>
              <Label htmlFor="asset-folder" className="text-sm">Asset Folder</Label>
              <Input
                id="asset-folder"
                type="text"
                placeholder={DEFAULT_SETTINGS.assetFolder}
                className="h-8 w-full min-w-0"
                value={settings.assetFolder}
                onChange={(event) => {
                  const nextValue = event.target.value.trim();
                  handleSettingChange(
                    'assetFolder',
                    nextValue.length > 0 ? nextValue : DEFAULT_SETTINGS.assetFolder,
                  );
                }}
              />
            </div>

            <div className={switchFieldClass}>
              <Label htmlFor="line-wrap" className="text-sm">Word Wrap</Label>
              <Switch
                id="line-wrap"
                checked={settings.editorLineWrap}
                onCheckedChange={(checked) => handleSettingChange('editorLineWrap', checked)}
              />
            </div>

            <div className={switchFieldClass}>
              <Label htmlFor="focus-mode" className="text-sm">Focus Mode</Label>
              <Switch
                id="focus-mode"
                checked={settings.focusModeEnabled}
                onCheckedChange={(checked) => handleSettingChange('focusModeEnabled', checked)}
              />
            </div>

            <div className={switchFieldClass}>
              <Label htmlFor="typewriter-mode" className="text-sm">Typewriter Mode</Label>
              <Switch
                id="typewriter-mode"
                checked={settings.typewriterModeEnabled}
                onCheckedChange={(checked) => handleSettingChange('typewriterModeEnabled', checked)}
              />
            </div>

            <div className={toggleFieldClass}>
              <Label htmlFor="default-mode" className="text-sm">Default Startup Mode</Label>
              <ToggleGroup
                id="default-mode"
                data-testid="settings-default-mode-toggle"
                type="single"
                value={settings.defaultMode}
                onValueChange={(value) => {
                  if (!value) return;
                  handleSettingChange('defaultMode', value as Settings['defaultMode']);
                }}
                variant="outline"
                size="sm"
                className={toggleGroupClass}
              >
                <ToggleGroupItem
                  value="Editor"
                  aria-label="Editor"
                  title="Editor startup mode"
                  className={toggleItemClass}
                >
                  Editor
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="Wysiwyg"
                  aria-label="WYSIWYG"
                  title="WYSIWYG startup mode"
                  className={toggleItemClass}
                >
                  WYSIWYG
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="SplitView"
                  aria-label="Split View"
                  title="Split View startup mode"
                  className={toggleItemClass}
                >
                  Split View
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className={switchFieldClass}>
              <Label htmlFor="theme-follow-system" className="text-sm">Follow System Theme</Label>
              <Switch
                id="theme-follow-system"
                checked={settings.themeFollowSystem}
                onCheckedChange={(checked) => handleSettingChange('themeFollowSystem', checked)}
              />
            </div>

            <div className={toggleFieldClass}>
              <Label htmlFor="pdf-paper-size" className="text-sm">PDF Paper Size</Label>
              <ToggleGroup
                id="pdf-paper-size"
                data-testid="settings-pdf-paper-size-toggle"
                type="single"
                value={settings.pdfPaperSize}
                onValueChange={(value) => {
                  if (!value) return;
                  handleSettingChange('pdfPaperSize', value as Settings['pdfPaperSize']);
                }}
                variant="outline"
                size="sm"
                className={toggleGroupClass}
              >
                <ToggleGroupItem
                  value="A4"
                  aria-label="A4"
                  title="A4 PDF paper size"
                  className={toggleItemClass}
                >
                  A4
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="Letter"
                  aria-label="Letter"
                  title="Letter PDF paper size"
                  className={toggleItemClass}
                >
                  Letter
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className={switchFieldClass}>
              <Label htmlFor="diagnostics-enabled" className="text-sm">Diagnostics Logging</Label>
              <Switch
                id="diagnostics-enabled"
                checked={settings.diagnosticsEnabled}
                onCheckedChange={(checked) => handleSettingChange('diagnosticsEnabled', checked)}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-muted/50 px-4 py-3">
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => onSettingsChange({ ...DEFAULT_SETTINGS })}
            title="Reset all editor preferences to factory defaults"
          >
            Reset to Defaults
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
