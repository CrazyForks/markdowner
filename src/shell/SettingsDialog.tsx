import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your Markdowner workspace preferences.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <h4 className="text-sm font-medium leading-none">CLI Launcher</h4>
            <p className="text-sm text-muted-foreground">
              To use the markdowner CLI, run:
            </p>
            <pre className="p-2 rounded bg-muted text-xs font-mono">
              alias markdowner="/Applications/Markdowner.app/Contents/MacOS/markdowner"
            </pre>
          </div>
          <Separator />
          <div className="grid gap-2">
            <h4 className="text-sm font-medium leading-none">Editor Preferences</h4>
            <p className="text-sm text-muted-foreground">
              Additional preferences will be available in a future update.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
