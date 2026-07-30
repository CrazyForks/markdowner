import { describe, expect, it } from 'vitest';

import { sanitizeAiTelemetry } from './telemetry';

describe('AI telemetry privacy', () => {
  it('keeps only content-free lifecycle metadata', () => {
    const payload = sanitizeAiTelemetry({
      lifecycle: 'completed',
      task: 'translation',
      model: 'z-ai/glm-5.2',
      promptTokens: 123.9,
      completionTokens: 45,
      totalTokens: 168,
      costUsd: 0.00123456789,
      durationMs: 987.6,
      errorCode: 'provider_unavailable',
      generationId: 'gen-123',
      apiKey: 'sk-or-secret',
      authorization: 'Bearer secret',
      prompt: 'Translate my private plan',
      source: '# Private roadmap',
      response: 'Private result',
      translation: '기밀 결과',
      diff: '- old\\n+ secret',
      path: '/Users/example/private.md',
      selection: 'private fragment',
      arbitrary: { content: 'still private' },
    });

    expect(payload).toEqual({
      lifecycle: 'completed',
      task: 'translation',
      model: 'z-ai/glm-5.2',
      promptTokens: 123,
      completionTokens: 45,
      totalTokens: 168,
      costUsd: 0.001235,
      durationMs: 988,
      errorCode: 'provider_unavailable',
      generationId: 'gen-123',
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('sk-or-secret');
    expect(serialized).not.toContain('Private');
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('기밀');
  });

  it('drops invalid enum, identifier, and numeric values', () => {
    expect(
      sanitizeAiTelemetry({
        lifecycle: 'private prompt',
        task: 'unknown',
        model: 'vendor/model with spaces',
        promptTokens: -1,
        costUsd: Number.POSITIVE_INFINITY,
        errorCode: 'raw provider error: private response',
        generationId: '../private',
      }),
    ).toEqual({});
  });
});
