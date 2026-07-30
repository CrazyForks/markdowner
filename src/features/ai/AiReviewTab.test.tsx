import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AiRunRequest, AiRunResult } from './types';
import { createAiReview, createPendingAiReview } from './review';
import { AiReviewTab } from './AiReviewTab';

afterEach(cleanup);

const request: AiRunRequest = {
  requestId: 'request-1',
  documentId: 'doc-1',
  source: '# PRD\n\nVague.',
  selection: null,
  task: 'prd',
  model: 'z-ai/glm-5.2',
  targetLanguage: null,
  instruction: null,
  zdrOnly: true,
  maxOutputTokens: 4096,
};

const runResult: AiRunResult = {
  requestId: 'request-1',
  documentId: 'doc-1',
  task: 'prd',
  model: 'z-ai/glm-5.2',
  generationId: 'generation-1',
  result: {
    sourceRevisionHash: 'revision-1',
    proposedMarkdown: '# PRD\n\nMeasurable.',
    validation: {
      passed: true,
      issues: [],
    },
    operations: [
      {
        id: 'operation-1',
        kind: 'replace',
        targetSegmentId: 'segment-1',
        sourceRange: { start: 7, end: 13 },
        originalMarkdown: 'Vague.',
        proposedMarkdown: 'Measurable.',
        findingIds: ['finding-1'],
      },
    ],
    hunks: [
      {
        operationId: 'operation-1',
        sourceRange: { start: 7, end: 13 },
        originalMarkdown: 'Vague.',
        proposedMarkdown: 'Measurable.',
      },
    ],
    summary: 'Make the requirement measurable.',
    findings: [
      {
        id: 'finding-1',
        severity: 'high',
        category: 'ambiguity',
        evidenceSegmentId: 'segment-1',
        rationale: 'No measurable threshold.',
      },
    ],
    assumptions: [],
    detectedSourceLanguage: null,
    targetLanguage: null,
    warnings: [],
  },
  validationIssues: [],
  rawDiagnostic: null,
  usage: {
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    costUsd: 0.002,
    costCalculated: true,
  },
  retryAfterSeconds: null,
};

describe('AiReviewTab', () => {
  it('renders a non-applicable running state before a full-document result arrives', () => {
    render(
      <AiReviewTab
        review={createPendingAiReview(request, 'requirements.md')}
        currentSource={request.source}
        sourcePresent
        onApply={vi.fn()}
        onRenderSelected={vi.fn()}
        onOpenAsDocument={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    expect(screen.getByText(/AI request in progress/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply all' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rerun' })).toBeDisabled();
  });

  it('renders findings and diff hunks, then applies the full validated proposal', () => {
    const onApply = vi.fn();
    render(
      <AiReviewTab
        review={createAiReview(request, runResult, 'requirements.md')}
        currentSource={request.source}
        sourcePresent
        onApply={onApply}
        onRenderSelected={vi.fn()}
        onOpenAsDocument={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    expect(screen.getByText('No measurable threshold.')).toBeInTheDocument();
    expect(screen.getByText('− Vague.')).toBeInTheDocument();
    expect(screen.getByText('+ Measurable.')).toBeInTheDocument();
    expect(
      screen.getByText(/Prompt 100 · Completion 20 · Total 120/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/\$0.0020 · calculated/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply all' }));

    expect(onApply).toHaveBeenCalledWith('# PRD\n\nMeasurable.');
  });

  it('disables apply when the source changed but keeps the proposal exportable', () => {
    render(
      <AiReviewTab
        review={createAiReview(request, runResult, 'requirements.md')}
        currentSource="# PRD\n\nChanged locally."
        sourcePresent
        onApply={vi.fn()}
        onRenderSelected={vi.fn()}
        onOpenAsDocument={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    expect(screen.getByText(/source document changed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply all' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Open as new document' }),
    ).toBeEnabled();
  });

  it('supports translation-only review and exposes language and hunk controls', () => {
    const translationRequest: AiRunRequest = {
      ...request,
      task: 'translation',
      targetLanguage: 'ko',
    };
    const translationResult: AiRunResult = {
      ...runResult,
      task: 'translation',
      result: runResult.result
        ? {
            ...runResult.result,
            proposedMarkdown: '# 요구사항\n\n측정 가능합니다.',
            detectedSourceLanguage: 'en',
            targetLanguage: 'ko',
          }
        : null,
    };

    render(
      <AiReviewTab
        review={createAiReview(
          translationRequest,
          translationResult,
          'requirements.md',
        )}
        currentSource={request.source}
        sourcePresent
        onApply={vi.fn()}
        onRenderSelected={vi.fn()}
        onOpenAsDocument={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    expect(screen.getByText(/Detected en · Target ko/i)).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /Select change for segment-1/i }),
    ).toBeChecked();
    expect(screen.getByRole('heading', { name: 'Source' })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Show translation only' }),
    );

    expect(screen.queryByRole('heading', { name: 'Source' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Translation' })).toBeInTheDocument();
  });
});
