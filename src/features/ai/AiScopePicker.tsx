import { Label } from '@/components/ui/label';

import type { AiDocumentRef, AiRunScope, AiTask } from './types';

export interface AiScopePickerProps {
  value: AiRunScope;
  task: AiTask;
  currentDocument: AiDocumentRef;
  openDocuments: readonly AiDocumentRef[];
  workspaceRoot: string | null;
  workspaceFileCount: number;
  disabled?: boolean;
  onChange: (scope: AiRunScope) => void;
}

const selectClass =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function AiScopePicker({
  value,
  task,
  currentDocument,
  openDocuments,
  workspaceRoot,
  workspaceFileCount,
  disabled = false,
  onChange,
}: AiScopePickerProps) {
  const documents = deduplicateDocuments(currentDocument, openDocuments);
  const selectedDocument =
    value.kind === 'document' ? value.target : value.target ?? currentDocument;

  const chooseScope = (kind: 'document' | 'workspace') => {
    if (kind === 'document') {
      onChange({ kind: 'document', target: selectedDocument });
      return;
    }
    if (!workspaceRoot) return;
    onChange({
      kind: 'workspace',
      rootPath: workspaceRoot,
      target: task === 'translation' ? null : selectedDocument,
      documentCount: workspaceFileCount,
    });
  };

  const chooseDocument = (documentId: string) => {
    const target = documents.find((document) => document.documentId === documentId);
    if (!target) return;
    if (value.kind === 'workspace' && workspaceRoot) {
      onChange({
        kind: 'workspace',
        rootPath: workspaceRoot,
        target,
        documentCount: workspaceFileCount,
      });
      return;
    }
    onChange({ kind: 'document', target });
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor="ai-scope">Scope</Label>
      <select
        id="ai-scope"
        aria-label="Scope"
        className={selectClass}
        value={value.kind}
        disabled={disabled}
        onChange={(event) => chooseScope(event.target.value as 'document' | 'workspace')}
      >
        <option value="document">Document</option>
        <option value="workspace" disabled={!workspaceRoot}>
          Workspace{workspaceRoot ? ` · ${workspaceFileCount} Markdown files` : ' · open a folder first'}
        </option>
      </select>

      {value.kind === 'document' || task !== 'translation' ? (
        <div className="grid gap-1.5">
          <Label htmlFor="ai-scope-document">
            {value.kind === 'workspace' ? 'Target document' : 'Document'}
          </Label>
          <select
            id="ai-scope-document"
            aria-label={value.kind === 'workspace' ? 'Target document' : 'Document'}
            className={selectClass}
            value={selectedDocument.documentId}
            disabled={disabled}
            onChange={(event) => chooseDocument(event.target.value)}
          >
            {documents.map((document) => (
              <option key={document.documentId} value={document.documentId}>
                {document.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
          Sequential Markdown batch · {workspaceFileCount} files
        </p>
      )}
    </div>
  );
}

function deduplicateDocuments(
  currentDocument: AiDocumentRef,
  openDocuments: readonly AiDocumentRef[],
): AiDocumentRef[] {
  const byId = new Map<string, AiDocumentRef>();
  byId.set(currentDocument.documentId, currentDocument);
  for (const document of openDocuments) {
    byId.set(document.documentId, document);
  }
  return [...byId.values()];
}
