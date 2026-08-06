import type { AiTask } from './types';

export type AiLifecycle =
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'started'
  | 'validation_failed';

export interface AiTelemetryPayload extends Record<string, unknown> {
  lifecycle?: AiLifecycle;
  task?: AiTask;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  durationMs?: number;
  errorCode?: string;
  generationId?: string;
}

const LIFECYCLES = new Set<AiLifecycle>([
  'cancelled',
  'completed',
  'failed',
  'started',
  'validation_failed',
]);
const TASKS = new Set<AiTask>(['prd', 'summary', 'translation', 'custom']);
const MODEL_PATTERN = /^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;

/**
 * Build the only payload shape permitted for AI diagnostics or analytics.
 * Document text, instructions, selections, responses, diffs, file names,
 * paths, credentials, and unrecognized properties are intentionally dropped.
 */
export function sanitizeAiTelemetry(
  input: Record<string, unknown>,
): AiTelemetryPayload {
  const payload: AiTelemetryPayload = {};

  if (
    typeof input.lifecycle === 'string' &&
    LIFECYCLES.has(input.lifecycle as AiLifecycle)
  ) {
    payload.lifecycle = input.lifecycle as AiLifecycle;
  }
  if (typeof input.task === 'string' && TASKS.has(input.task as AiTask)) {
    payload.task = input.task as AiTask;
  }
  if (
    typeof input.model === 'string' &&
    input.model.length <= 200 &&
    MODEL_PATTERN.test(input.model)
  ) {
    payload.model = input.model;
  }

  copyCount(input, payload, 'promptTokens');
  copyCount(input, payload, 'completionTokens');
  copyCount(input, payload, 'totalTokens');
  if (
    typeof input.costUsd === 'number' &&
    Number.isFinite(input.costUsd) &&
    input.costUsd >= 0
  ) {
    payload.costUsd = Math.round(input.costUsd * 1_000_000) / 1_000_000;
  }
  if (
    typeof input.durationMs === 'number' &&
    Number.isFinite(input.durationMs) &&
    input.durationMs >= 0
  ) {
    payload.durationMs = Math.round(input.durationMs);
  }
  if (
    typeof input.errorCode === 'string' &&
    SAFE_IDENTIFIER_PATTERN.test(input.errorCode)
  ) {
    payload.errorCode = input.errorCode;
  }
  if (
    typeof input.generationId === 'string' &&
    SAFE_IDENTIFIER_PATTERN.test(input.generationId)
  ) {
    payload.generationId = input.generationId;
  }

  return payload;
}

function copyCount(
  input: Record<string, unknown>,
  output: AiTelemetryPayload,
  key: 'completionTokens' | 'promptTokens' | 'totalTokens',
) {
  const value = input[key];
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    output[key] = Math.floor(value);
  }
}
