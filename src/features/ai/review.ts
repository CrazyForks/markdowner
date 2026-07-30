import type { AiRunRequest, AiRunResult } from './types';

export interface AiReview {
  id: string;
  requestId: string;
  sourceDocumentId: string;
  sourceDocumentName: string;
  sourceSnapshot: string;
  request: AiRunRequest;
  runResult: AiRunResult;
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
    runResult,
    createdAt: now,
  };
}

export function isReviewSourceCurrent(
  review: AiReview,
  currentSource: string | null,
): boolean {
  return currentSource !== null && currentSource === review.sourceSnapshot;
}

export function resolveReviewActions(input: {
  sourcePresent: boolean;
  sourceRevisionMatches: boolean;
  validationPassed: boolean;
}): ReviewActions {
  const validResult = input.validationPassed;
  const canApply =
    validResult && input.sourcePresent && input.sourceRevisionMatches;

  return {
    applySelected: canApply,
    applyAll: canApply,
    openAsDocument: validResult,
    rerun: true,
  };
}
