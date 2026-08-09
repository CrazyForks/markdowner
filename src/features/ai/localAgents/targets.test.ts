import { describe, expect, it, vi } from 'vitest';

import {
  applySourceLocalAgentResult,
  applyWysiwygLocalAgentResult,
  asDocumentLocalAgentTarget,
  captureSourceLocalAgentTarget,
  captureWysiwygLocalAgentTarget,
  isValidLocalAgentTargetSnapshot,
  localAgentTargetFromAiSelectionSnapshot,
} from './targets';
import type { LocalAgentRunRequest, LocalAgentRunResult } from './types';

function requestFor(
  snapshot: ReturnType<typeof captureSourceLocalAgentTarget>,
): LocalAgentRunRequest {
  if (!snapshot) throw new Error('target required');
  return {
    requestId: 'request-1',
    documentId: snapshot.documentId,
    agent: 'codex',
    target: snapshot.kind,
    source: snapshot.source,
    selection: snapshot.kind === 'selection' ? snapshot.byteRange : null,
    cursor: snapshot.kind === 'insert' ? snapshot.byteRange?.start ?? null : null,
    instruction: 'Make this clearer',
  };
}

function resultFor(request: LocalAgentRunRequest): LocalAgentRunResult {
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    documentId: request.documentId,
    agent: request.agent,
    target: request.target,
    markdown: 'BETA',
    summary: 'Rewrote the target.',
    warnings: [],
  };
}

describe('local-agent targets', () => {
  it('captures UTF-8 selection ranges without mutating source', () => {
    const source = '가나다 alpha';

    expect(
      captureSourceLocalAgentTarget({
        source,
        anchor: 1,
        head: 3,
        documentId: 'doc-1',
      }),
    ).toMatchObject({
      kind: 'selection',
      characterRange: { start: 1, end: 3 },
      byteRange: { start: 3, end: 9 },
      selectedText: '나다',
    });
    expect(source).toBe('가나다 alpha');
  });

  it('captures a collapsed source caret as an insert target', () => {
    expect(
      captureSourceLocalAgentTarget({
        source: 'alpha',
        anchor: 2,
        head: 2,
        documentId: 'doc-1',
      }),
    ).toMatchObject({ kind: 'insert', characterRange: { start: 2, end: 2 } });
  });

  it('clamps offsets but rejects a surrogate-pair split', () => {
    expect(
      captureSourceLocalAgentTarget({
        source: 'alpha',
        anchor: -20,
        head: 99,
        documentId: 'doc-1',
      }),
    ).toMatchObject({ characterRange: { start: 0, end: 5 } });
    expect(
      captureSourceLocalAgentTarget({
        source: 'a😀b',
        anchor: 1,
        head: 2,
        documentId: 'doc-1',
      }),
    ).toBeNull();
  });

  it('retains WYSIWYG ProseMirror insertion bounds and converts prior snapshots', () => {
    const target = captureWysiwygLocalAgentTarget({
      source: 'alpha beta',
      markdownAnchor: 6,
      markdownHead: 10,
      proseMirrorFrom: 7,
      proseMirrorTo: 11,
      proseMirrorDocumentSize: 12,
      documentId: 'doc-1',
    });
    expect(target).toMatchObject({
      surface: 'wysiwyg',
      kind: 'selection',
      proseMirrorRange: { start: 7, end: 11 },
    });
    expect(
      localAgentTargetFromAiSelectionSnapshot({
        documentId: 'doc-1',
        source: 'alpha beta',
        surface: 'source',
        characterRange: { start: 6, end: 10 },
        byteRange: { start: 6, end: 10 },
        selectedText: 'beta',
        proseMirrorRange: null,
      }),
    ).toMatchObject({ kind: 'selection', selectedText: 'beta' });
  });

  it('requires WYSIWYG markdown and ProseMirror ranges to have the same collapse state', () => {
    expect(
      captureWysiwygLocalAgentTarget({
        source: 'alpha',
        markdownAnchor: 2,
        markdownHead: 2,
        proseMirrorFrom: 7,
        proseMirrorTo: 7,
        documentId: 'doc-1',
      } as never),
    ).toBeNull();
    expect(
      captureWysiwygLocalAgentTarget({
        source: 'alpha',
        markdownAnchor: 2,
        markdownHead: 2,
        proseMirrorFrom: 7,
        proseMirrorTo: 8,
        proseMirrorDocumentSize: 10,
        documentId: 'doc-1',
      }),
    ).toBeNull();
    expect(
      captureWysiwygLocalAgentTarget({
        source: 'alpha',
        markdownAnchor: 2,
        markdownHead: 2,
        proseMirrorFrom: 7,
        proseMirrorTo: 7,
        proseMirrorDocumentSize: 10,
        documentId: 'doc-1',
      }),
    ).toMatchObject({
      kind: 'insert',
      proseMirrorRange: { start: 7, end: 7 },
    });
    expect(
      captureWysiwygLocalAgentTarget({
        source: 'alpha',
        markdownAnchor: 1,
        markdownHead: 3,
        proseMirrorFrom: 7,
        proseMirrorTo: 7,
        proseMirrorDocumentSize: 6,
        documentId: 'doc-1',
      }),
    ).toBeNull();
  });

  it('rejects forged Unicode snapshot metadata before any application', () => {
    const korean = captureSourceLocalAgentTarget({
      source: '가나다',
      anchor: 1,
      head: 3,
      documentId: 'doc-1',
    });
    if (!korean) throw new Error('target required');
    const emojiSplit = {
      ...korean,
      source: 'a😀b',
      characterRange: { start: 1, end: 2 },
      byteRange: { start: 1, end: 5 },
      selectedText: '\ud83d',
    };

    expect(isValidLocalAgentTargetSnapshot({ ...korean, selectedText: '다' })).toBe(
      false,
    );
    expect(
      isValidLocalAgentTargetSnapshot({
        ...korean,
        byteRange: { start: 3, end: 8 },
      }),
    ).toBe(false);
    expect(isValidLocalAgentTargetSnapshot(emojiSplit)).toBe(false);
  });

  it('applies source results in one transaction only for the exact captured request', () => {
    const snapshot = captureSourceLocalAgentTarget({
      source: 'alpha beta',
      anchor: 6,
      head: 10,
      documentId: 'doc-1',
    });
    if (!snapshot) throw new Error('target required');
    const request = requestFor(snapshot);
    const result = resultFor(request);
    const dispatch = vi.fn();

    expect(
      applySourceLocalAgentResult({
        view: { dispatch },
        snapshot,
        currentDocumentId: 'doc-1',
        currentSource: 'alpha beta',
        request,
        result,
      }),
    ).toBe('alpha BETA');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      changes: { from: 6, to: 10, insert: 'BETA' },
      selection: { anchor: 10 },
      scrollIntoView: true,
    });
  });

  it('rejects stale source, stale documents, and mismatched metadata without dispatching', () => {
    const snapshot = captureSourceLocalAgentTarget({
      source: 'alpha beta',
      anchor: 6,
      head: 10,
      documentId: 'doc-1',
    });
    if (!snapshot) throw new Error('target required');
    const request = requestFor(snapshot);
    const dispatch = vi.fn();

    expect(
      applySourceLocalAgentResult({
        view: { dispatch },
        snapshot,
        currentDocumentId: 'doc-1',
        currentSource: 'alpha BETA',
        request,
        result: resultFor(request),
      }),
    ).toBeNull();
    expect(
      applySourceLocalAgentResult({
        view: { dispatch },
        snapshot,
        currentDocumentId: 'doc-2',
        currentSource: 'alpha beta',
        request,
        result: resultFor(request),
      }),
    ).toBeNull();
    expect(
      applySourceLocalAgentResult({
        view: { dispatch },
        snapshot,
        currentDocumentId: 'doc-1',
        currentSource: 'alpha beta',
        request,
        result: { ...resultFor(request), requestId: 'another-request' },
      }),
    ).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('applies exact WYSIWYG ranges through one Markdown insertion transaction', () => {
    const snapshot = captureWysiwygLocalAgentTarget({
      source: 'alpha beta',
      markdownAnchor: 6,
      markdownHead: 10,
      proseMirrorFrom: 7,
      proseMirrorTo: 11,
      proseMirrorDocumentSize: 12,
      documentId: 'doc-1',
    });
    if (!snapshot) throw new Error('target required');
    const request = requestFor(snapshot);
    const run = vi.fn(() => true);
    const insertContentAt = vi.fn(() => ({ run }));
    const focus = vi.fn(() => ({ insertContentAt }));
    const editor = {
      chain: vi.fn(() => ({ focus })),
      state: { doc: { content: { size: 12 } } },
    };

    expect(
      applyWysiwygLocalAgentResult({
        editor,
        snapshot,
        currentDocumentId: 'doc-1',
        currentSource: 'alpha beta',
        request,
        result: resultFor(request),
      }),
    ).toBe(true);
    expect(insertContentAt).toHaveBeenCalledTimes(1);
    expect(insertContentAt).toHaveBeenCalledWith(
      { from: 7, to: 11 },
      'BETA',
      { contentType: 'markdown' },
    );
  });

  it('revalidates the ProseMirror target before inserting', () => {
    const snapshot = captureWysiwygLocalAgentTarget({
      source: 'alpha',
      markdownAnchor: 2,
      markdownHead: 2,
      proseMirrorFrom: 7,
      proseMirrorTo: 7,
      proseMirrorDocumentSize: 12,
      documentId: 'doc-1',
    });
    if (!snapshot) throw new Error('target required');
    const request = requestFor(snapshot);
    const run = vi.fn(() => true);
    const insertContentAt = vi.fn(() => ({ run }));
    const focus = vi.fn(() => ({ insertContentAt }));

    expect(
      applyWysiwygLocalAgentResult({
        editor: {
          chain: vi.fn(() => ({ focus })),
          state: { doc: { content: { size: 6 } } },
        },
        snapshot,
        currentDocumentId: 'doc-1',
        currentSource: 'alpha',
        request,
        result: resultFor(request),
      }),
    ).toBe(false);
    expect(insertContentAt).not.toHaveBeenCalled();
  });

  it('fails closed before starting a WYSIWYG chain without the current document size', () => {
    const snapshot = captureWysiwygLocalAgentTarget({
      source: 'alpha',
      markdownAnchor: 2,
      markdownHead: 2,
      proseMirrorFrom: 7,
      proseMirrorTo: 7,
      proseMirrorDocumentSize: 12,
      documentId: 'doc-1',
    });
    if (!snapshot) throw new Error('target required');
    const request = requestFor(snapshot);
    const chain = vi.fn();

    expect(
      applyWysiwygLocalAgentResult({
        editor: { chain } as never,
        snapshot,
        currentDocumentId: 'doc-1',
        currentSource: 'alpha',
        request,
        result: resultFor(request),
      }),
    ).toBe(false);
    expect(chain).not.toHaveBeenCalled();
  });

  it('converts any captured target into a range-free document target', () => {
    const snapshot = captureSourceLocalAgentTarget({
      source: 'alpha',
      anchor: 2,
      head: 2,
      documentId: 'doc-1',
    });
    if (!snapshot) throw new Error('target required');

    expect(asDocumentLocalAgentTarget(snapshot)).toMatchObject({
      kind: 'document',
      characterRange: null,
      byteRange: null,
      selectedText: '',
      proseMirrorRange: null,
    });
  });
});
