import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AI_MODEL,
  PINNED_AI_MODELS,
  estimateAiRun,
  orderModels,
  resolveRunGate,
  searchLanguages,
  type AiModel,
} from './model';

function model(overrides: Partial<AiModel>): AiModel {
  return {
    id: 'vendor/model',
    name: 'Model',
    contextLength: 100_000,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportedParameters: ['response_format', 'structured_outputs'],
    pricing: {
      prompt: 0.000001,
      completion: 0.000002,
      updatedAt: '2026-07-31T00:00:00Z',
    },
    ...overrides,
  };
}

describe('AI model policy', () => {
  it('uses GLM by default and pins Kimi directly after it', () => {
    expect(DEFAULT_AI_MODEL).toBe('z-ai/glm-5.2');
    expect(PINNED_AI_MODELS).toEqual([
      'z-ai/glm-5.2',
      'moonshotai/kimi-k3',
    ]);
  });

  it('pins the fixed models and disables non-structured models for built-ins', () => {
    const options = orderModels(
      [
        model({ id: 'plain/text', supportedParameters: [] }),
        model({ id: 'moonshotai/kimi-k3', name: 'Kimi K3' }),
        model({ id: 'z-ai/glm-5.2', name: 'GLM 5.2' }),
      ],
      'translation',
    );

    expect(options.slice(0, 2).map((entry) => entry.id)).toEqual([
      'z-ai/glm-5.2',
      'moonshotai/kimi-k3',
    ]);
    expect(options.find((entry) => entry.id === 'plain/text')).toMatchObject({
      enabled: false,
      disabledReason: 'Structured output is required for this task.',
    });
  });

  it('keeps text-only custom prompt models enabled without structured output', () => {
    const [option] = orderModels(
      [model({ id: 'plain/text', supportedParameters: [] })],
      'custom',
    );

    expect(option.enabled).toBe(true);
  });
});

describe('AI estimates and run gates', () => {
  it('calculates a safe maximum cost from prompt and completion prices', () => {
    const estimate = estimateAiRun({
      source: '한글과 English text',
      scope: 'document',
      model: model({
        contextLength: 200_000,
        pricing: {
          prompt: 0.000001,
          completion: 0.000002,
          updatedAt: '2026-07-31T00:00:00Z',
        },
      }),
      maxOutputTokens: 4_000,
    });

    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.maxCostUsd).toBeCloseTo(
      estimate.inputTokens * 0.000001 + 4_000 * 0.000002,
    );
    expect(estimate.pricingUpdatedAt).toBe('2026-07-31T00:00:00Z');
  });

  it('requires confirmation at one dollar or eighty percent context', () => {
    expect(
      resolveRunGate({
        scope: 'document',
        inputTokens: 800,
        contextLength: 1_000,
        maxCostUsd: 0.2,
      }).kind,
    ).toBe('confirm');
    expect(
      resolveRunGate({
        scope: 'document',
        inputTokens: 100,
        contextLength: 1_000,
        maxCostUsd: 1,
      }).kind,
    ).toBe('confirm');
  });

  it('blocks unknown cost and never truncates scope limits', () => {
    expect(
      resolveRunGate({
        scope: 'document',
        inputTokens: 50_001,
        contextLength: 1_000_000,
        maxCostUsd: 0.2,
      }),
    ).toMatchObject({ kind: 'blocked', code: 'input_limit' });
    expect(
      resolveRunGate({
        scope: 'selection',
        inputTokens: 20_001,
        contextLength: 1_000_000,
        maxCostUsd: 0.2,
      }),
    ).toMatchObject({ kind: 'blocked', code: 'input_limit' });
    expect(
      resolveRunGate({
        scope: 'document',
        inputTokens: 100,
        contextLength: 1_000_000,
        maxCostUsd: null,
      }),
    ).toMatchObject({ kind: 'blocked', code: 'unknown_cost' });
  });
});

describe('translation languages', () => {
  it('searches by BCP 47 code and localized language name', () => {
    expect(searchLanguages('ja', 'en').slice(0, 1)).toMatchObject([
      { code: 'ja' },
    ]);
    expect(searchLanguages('Korean', 'en')).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ko' })]),
    );
  });
});
