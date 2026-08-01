import { LoaderCircle, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { AiActiveRun, AiTask } from './types';

export function AiActivityTab({
  runs,
  loading = false,
  error = null,
  onCancel,
}: {
  runs: readonly AiActiveRun[];
  loading?: boolean;
  error?: string | null;
  onCancel: (requestId: string) => void;
}) {
  if (loading && runs.length === 0) {
    return (
      <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        Loading active requests…
      </p>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No active AI requests</p>
        <p className="mt-1 text-xs leading-relaxed">
          Requests continue here even when you switch documents.
        </p>
        {error ? <p className="mt-2 text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {runs.map((run) => (
        <article key={run.requestId} className="rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-medium">{taskLabel(run.task)}</h3>
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {run.model}
              </p>
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {run.status}
            </span>
          </div>
          <p className="mt-2 truncate text-xs text-muted-foreground">
            {scopeLabel(run)}
          </p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              {run.progress.chunkCompleted !== null && run.progress.chunkTotal !== null ? (
                <p className="text-lg font-semibold tabular-nums">
                  {run.progress.chunkCompleted} / {run.progress.chunkTotal}
                </p>
              ) : run.progress.receivedCharacters > 0 ? (
                <p className="text-sm font-medium tabular-nums">
                  {run.progress.receivedCharacters.toLocaleString()} characters
                </p>
              ) : (
                <p className="text-sm font-medium capitalize">{run.progress.stage || 'Preparing'}</p>
              )}
              {run.progress.fileCompleted !== null && run.progress.fileTotal !== null ? (
                <p className="text-[11px] text-muted-foreground">
                  {run.progress.fileCompleted} of {run.progress.fileTotal} files
                  {run.progress.label ? ` · ${run.progress.label}` : ''}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`Cancel ${taskLabel(run.task)}`}
              disabled={!run.cancelable}
              onClick={() => onCancel(run.requestId)}
            >
              <Square className="size-3" />
              Cancel
            </Button>
          </div>
        </article>
      ))}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function taskLabel(task: AiTask): string {
  if (task === 'prd') return 'Improve PRD';
  if (task === 'translation') return 'Translate document';
  return 'Custom prompt';
}

function scopeLabel(run: AiActiveRun): string {
  if (run.scope.kind === 'document') return run.scope.target.label;
  return run.scope.target?.label ?? `${run.scope.documentCount} Markdown files`;
}
