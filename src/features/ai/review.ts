import type { AiRunRequest, AiRunResult, AiTask } from './types';
import type {
  LocalAgentKind,
  LocalAgentRunRequest,
  LocalAgentRunResult,
  LocalAgentTargetKind,
} from './localAgents/types';
import {
  isValidLocalAgentTargetSnapshot,
  type LocalAgentTargetSnapshot,
} from './localAgents/targets';

export type AiReviewOrigin =
  | { kind: 'openrouter' }
  | { kind: 'localAgent'; agent: LocalAgentKind; target: LocalAgentTargetKind };

export interface AiReview {
  id: string;
  requestId: string;
  sourceDocumentId: string;
  sourceDocumentName: string;
  sourceSnapshot: string;
  request: AiRunRequest;
  status: 'running' | 'complete' | 'failed' | 'cancelled';
  statusMessage: string | null;
  runResult: AiRunResult | null;
  createdAt: number;
  origin: AiReviewOrigin;
}

export interface ReviewActions {
  applySelected: boolean;
  applyAll: boolean;
  openAsDocument: boolean;
  rerun: boolean;
}

export function createAiReview(
  request: AiRunRequest,
  runResult: AiRunResult,
  sourceDocumentName = 'Untitled',
  now = Date.now(),
): AiReview {
  return {
    id: `ai-review:${request.requestId}`,
    requestId: request.requestId,
    sourceDocumentId: request.documentId,
    sourceDocumentName,
    sourceSnapshot: request.source,
    request,
    status: 'complete',
    statusMessage: null,
    runResult,
    createdAt: now,
    origin: { kind: 'openrouter' },
  };
}

export function createPendingAiReview(
  request: AiRunRequest,
  sourceDocumentName = 'Untitled',
  now = Date.now(),
): AiReview {
  return {
    id: `ai-review:${request.requestId}`,
    requestId: request.requestId,
    sourceDocumentId: request.documentId,
    sourceDocumentName,
    sourceSnapshot: request.source,
    request,
    status: 'running',
    statusMessage: 'AI request in progress…',
    runResult: null,
    createdAt: now,
    origin: { kind: 'openrouter' },
  };
}

export function createLocalAgentReview(
  snapshot: LocalAgentTargetSnapshot,
  request: LocalAgentRunRequest,
  result: LocalAgentRunResult,
  sourceDocumentName = 'Untitled',
): AiReview {
  if (!localAgentMetadataMatches(snapshot, request, result)) {
    throw new Error('Local-agent metadata does not match the captured target.');
  }

  const operation = localReviewOperation(snapshot, result.markdown);
  const proposedMarkdown = applyLocalReviewOperation(snapshot, result.markdown);
  const syntheticRequest: AiRunRequest = {
    requestId: request.requestId,
    documentId: request.documentId,
    source: request.source,
    selection: request.selection ? { ...request.selection } : null,
    task: 'custom',
    model: `local-agent/${request.agent}`,
    targetLanguage: null,
    instruction: request.instruction,
    zdrOnly: false,
    maxOutputTokens: 0,
    recordHistory: false,
  };
  const syntheticResult: AiRunResult = {
    requestId: request.requestId,
    documentId: request.documentId,
    task: 'custom',
    model: syntheticRequest.model,
    generationId: null,
    result: {
      sourceRevisionHash: `local-agent:${request.requestId}`,
      proposedMarkdown,
      validation: { passed: true, issues: [] },
      operations: [operation],
      hunks: [
        {
          operationId: operation.id,
          sourceRange: { ...operation.sourceRange },
          originalMarkdown: operation.originalMarkdown,
          proposedMarkdown: operation.proposedMarkdown,
        },
      ],
      summary: result.summary,
      findings: [],
      assumptions: [],
      detectedSourceLanguage: null,
      targetLanguage: null,
      warnings: [...result.warnings],
    },
    validationIssues: [],
    rawDiagnostic: null,
    usage: null,
    retryAfterSeconds: null,
  };

  return {
    ...createAiReview(syntheticRequest, syntheticResult, sourceDocumentName),
    origin: { kind: 'localAgent', agent: request.agent, target: request.target },
  };
}

export function settlePendingAiReview(
  review: AiReview,
  status: 'failed' | 'cancelled',
  statusMessage: string,
): AiReview {
  return {
    ...review,
    status,
    statusMessage,
    runResult: null,
  };
}

export function isReviewSourceCurrent(
  review: AiReview,
  currentSource: string | null,
): boolean {
  return currentSource !== null && currentSource === review.sourceSnapshot;
}

export function resolveReviewActions(input: {
  task: AiTask;
  sourcePresent: boolean;
  sourceRevisionMatches: boolean;
  validationPassed: boolean;
}): ReviewActions {
  const validResult = input.validationPassed;
  const canApply =
    input.task !== 'summary' &&
    validResult &&
    input.sourcePresent &&
    input.sourceRevisionMatches;

  return {
    applySelected: canApply,
    applyAll: canApply,
    openAsDocument: validResult,
    rerun: true,
  };
}

function localAgentMetadataMatches(
  snapshot: LocalAgentTargetSnapshot,
  request: LocalAgentRunRequest,
  result: LocalAgentRunResult,
): boolean {
  if (
    !isValidLocalAgentTargetSnapshot(snapshot) ||
    result.schemaVersion !== 1 ||
    request.documentId !== snapshot.documentId ||
    result.documentId !== request.documentId ||
    request.source !== snapshot.source ||
    request.target !== snapshot.kind ||
    result.requestId !== request.requestId ||
    result.agent !== request.agent ||
    result.target !== request.target
  ) {
    return false;
  }

  if (snapshot.kind === 'document') {
    return request.selection === null && request.cursor === null;
  }
  if (!snapshot.byteRange || !snapshot.characterRange) return false;
  if (snapshot.kind === 'selection') {
    return (
      request.selection?.start === snapshot.byteRange.start &&
      request.selection.end === snapshot.byteRange.end &&
      request.cursor === null
    );
  }
  return request.selection === null && request.cursor === snapshot.byteRange.start;
}

function localReviewOperation(
  snapshot: LocalAgentTargetSnapshot,
  markdown: string,
): NonNullable<AiRunResult['result']>['operations'][number] {
  if (snapshot.kind === 'document') {
    return {
      id: 'local-agent:document',
      kind: 'replace',
      targetSegmentId: 'document',
      sourceRange: { start: 0, end: utf8Length(snapshot.source) },
      originalMarkdown: snapshot.source,
      proposedMarkdown: markdown,
      findingIds: [],
    };
  }

  const byteRange = snapshot.byteRange;
  if (!byteRange) throw new Error('Local-agent target range is missing.');
  return {
    id: `local-agent:${snapshot.kind}`,
    kind: snapshot.kind === 'selection' ? 'replace' : 'insert_after',
    targetSegmentId: snapshot.kind,
    sourceRange: { ...byteRange },
    originalMarkdown: snapshot.selectedText,
    proposedMarkdown: markdown,
    findingIds: [],
  };
}

function applyLocalReviewOperation(
  snapshot: LocalAgentTargetSnapshot,
  markdown: string,
): string {
  if (snapshot.kind === 'document') return markdown;
  const range = snapshot.characterRange;
  if (!range) throw new Error('Local-agent target range is missing.');
  return (
    snapshot.source.slice(0, range.start) +
    markdown +
    snapshot.source.slice(range.end)
  );
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}
