import type { AiRunRequest, AiRunResult, AiTask } from './types';

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
