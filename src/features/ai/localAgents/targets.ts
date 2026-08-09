import type { AiByteRange } from '../types';
import type { AiSelectionSnapshot } from '../selection';

import type {
  LocalAgentRunRequest,
  LocalAgentRunResult,
  LocalAgentTargetKind,
} from './types';

export interface LocalAgentTargetSnapshot {
  documentId: string;
  source: string;
  surface: 'source' | 'wysiwyg';
  kind: LocalAgentTargetKind;
  characterRange: AiByteRange | null;
  byteRange: AiByteRange | null;
  selectedText: string;
  proseMirrorRange: AiByteRange | null;
}

export function captureSourceLocalAgentTarget(input: {
  source: string;
  anchor: number;
  head: number;
  documentId: string;
}): LocalAgentTargetSnapshot | null {
  return captureLocalAgentTarget({
    source: input.source,
    start: Math.min(input.anchor, input.head),
    end: Math.max(input.anchor, input.head),
    documentId: input.documentId,
    surface: 'source',
    proseMirrorRange: null,
  });
}

export function captureWysiwygLocalAgentTarget(input: {
  source: string;
  markdownAnchor?: number;
  markdownHead?: number;
  markdownStart?: number;
  markdownEnd?: number;
  proseMirrorFrom: number;
  proseMirrorTo: number;
  documentId: string;
}): LocalAgentTargetSnapshot | null {
  const anchor = input.markdownAnchor ?? input.markdownStart;
  const head = input.markdownHead ?? input.markdownEnd;
  if (anchor === undefined || head === undefined) return null;

  return captureLocalAgentTarget({
    source: input.source,
    start: Math.min(anchor, head),
    end: Math.max(anchor, head),
    documentId: input.documentId,
    surface: 'wysiwyg',
    proseMirrorRange: {
      start: clampNonNegativeOffset(Math.min(input.proseMirrorFrom, input.proseMirrorTo)),
      end: clampNonNegativeOffset(Math.max(input.proseMirrorFrom, input.proseMirrorTo)),
    },
  });
}

export function asDocumentLocalAgentTarget(
  snapshot: LocalAgentTargetSnapshot,
): LocalAgentTargetSnapshot {
  return {
    ...snapshot,
    kind: 'document',
    characterRange: null,
    byteRange: null,
    selectedText: '',
    proseMirrorRange: null,
  };
}

export function localAgentTargetFromAiSelectionSnapshot(
  snapshot: AiSelectionSnapshot,
): LocalAgentTargetSnapshot {
  return {
    documentId: snapshot.documentId,
    source: snapshot.source,
    surface: snapshot.surface,
    kind: 'selection',
    characterRange: { ...snapshot.characterRange },
    byteRange: { ...snapshot.byteRange },
    selectedText: snapshot.selectedText,
    proseMirrorRange: snapshot.proseMirrorRange
      ? { ...snapshot.proseMirrorRange }
      : null,
  };
}

export function applySourceLocalAgentResult(input: {
  view: {
    dispatch: (transaction: {
      changes: { from: number; to: number; insert: string };
      selection: { anchor: number };
      scrollIntoView: boolean;
    }) => void;
  };
  snapshot: LocalAgentTargetSnapshot;
  currentDocumentId: string;
  currentSource: string;
  request: LocalAgentRunRequest;
  result: LocalAgentRunResult;
}): string | null {
  const range = validApplicationRange(input);
  if (input.snapshot.surface !== 'source' || !range) return null;

  const nextSource =
    input.currentSource.slice(0, range.start) +
    input.result.markdown +
    input.currentSource.slice(range.end);
  input.view.dispatch({
    changes: { from: range.start, to: range.end, insert: input.result.markdown },
    selection: { anchor: range.start + input.result.markdown.length },
    scrollIntoView: true,
  });
  return nextSource;
}

export function applyWysiwygLocalAgentResult(input: {
  editor: {
    chain: () => {
      focus: () => {
        insertContentAt: (
          range: { from: number; to: number },
          content: string,
          options: { contentType: 'markdown' },
        ) => { run: () => boolean };
      };
    };
  };
  snapshot: LocalAgentTargetSnapshot;
  currentDocumentId: string;
  currentSource: string;
  request: LocalAgentRunRequest;
  result: LocalAgentRunResult;
}): boolean {
  const range = validApplicationRange(input);
  const proseMirrorRange = input.snapshot.proseMirrorRange;
  if (input.snapshot.surface !== 'wysiwyg' || !range || !proseMirrorRange) {
    return false;
  }

  return (
    input.editor
      .chain()
      .focus()
      .insertContentAt(
        { from: proseMirrorRange.start, to: proseMirrorRange.end },
        input.result.markdown,
        { contentType: 'markdown' },
      )
      .run() !== false
  );
}

function captureLocalAgentTarget(input: {
  source: string;
  start: number;
  end: number;
  documentId: string;
  surface: 'source' | 'wysiwyg';
  proseMirrorRange: AiByteRange | null;
}): LocalAgentTargetSnapshot | null {
  const start = clampCharacterOffset(input.source, input.start);
  const end = clampCharacterOffset(input.source, input.end);
  if (
    !input.documentId.trim() ||
    splitsSurrogatePair(input.source, start) ||
    splitsSurrogatePair(input.source, end)
  ) {
    return null;
  }

  const selectedText = input.source.slice(start, end);
  return {
    documentId: input.documentId,
    source: input.source,
    surface: input.surface,
    kind: start === end ? 'insert' : 'selection',
    characterRange: { start, end },
    byteRange: {
      start: utf8Length(input.source.slice(0, start)),
      end: utf8Length(input.source.slice(0, end)),
    },
    selectedText,
    proseMirrorRange: input.proseMirrorRange,
  };
}

function validApplicationRange(input: {
  snapshot: LocalAgentTargetSnapshot;
  currentDocumentId: string;
  currentSource: string;
  request: LocalAgentRunRequest;
  result: LocalAgentRunResult;
}): AiByteRange | null {
  const { snapshot, request, result } = input;
  const characterRange = snapshot.characterRange;
  const byteRange = snapshot.byteRange;
  if (
    snapshot.kind === 'document' ||
    !characterRange ||
    !byteRange ||
    input.currentDocumentId !== snapshot.documentId ||
    input.currentSource !== snapshot.source ||
    input.currentSource.slice(characterRange.start, characterRange.end) !==
      snapshot.selectedText ||
    request.documentId !== snapshot.documentId ||
    request.source !== snapshot.source ||
    request.target !== snapshot.kind ||
    result.schemaVersion !== 1 ||
    result.requestId !== request.requestId ||
    result.documentId !== request.documentId ||
    result.agent !== request.agent ||
    result.target !== request.target
  ) {
    return null;
  }

  if (snapshot.kind === 'selection') {
    if (!sameRange(request.selection, byteRange) || request.cursor !== null) {
      return null;
    }
  } else if (request.selection !== null || request.cursor !== byteRange.start) {
    return null;
  }

  return characterRange;
}

function sameRange(left: AiByteRange | null, right: AiByteRange): boolean {
  return left?.start === right.start && left.end === right.end;
}

function clampCharacterOffset(source: string, value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(source.length, Math.round(value)));
}

function clampNonNegativeOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function splitsSurrogatePair(source: string, offset: number): boolean {
  if (offset <= 0 || offset >= source.length) return false;
  const previous = source.charCodeAt(offset - 1);
  const next = source.charCodeAt(offset);
  return (
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
  );
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}
