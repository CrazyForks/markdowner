import { cn } from '@/lib/utils';
import { Files, Search, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ActivityBarProps {
  className?: string;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
}

export function ActivityBar({ className, onToggleSidebar, isSidebarOpen }: ActivityBarProps) {
  return (
    <div className={cn("flex flex-col items-center py-2 bg-muted/50 border-r border-border h-full", className)}>
      <div className="flex flex-col gap-2 w-full px-2">
        <Button 
          variant="ghost" 
          size="icon" 
          className={cn("w-8 h-8 rounded-md", isSidebarOpen && "bg-accent text-accent-foreground")}
          onClick={onToggleSidebar}
          title="Explorer (Cmd+B)"
        >
          <Files className="w-5 h-5" />
        </Button>
        <Button variant="ghost" size="icon" className="w-8 h-8 rounded-md text-muted-foreground hover:text-foreground">
          <Search className="w-5 h-5" />
        </Button>
      </div>
      <div className="mt-auto flex flex-col gap-2 w-full px-2 mb-2">
        <Button variant="ghost" size="icon" className="w-8 h-8 rounded-md text-muted-foreground hover:text-foreground">
          <Settings className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
