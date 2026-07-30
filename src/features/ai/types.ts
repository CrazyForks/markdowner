export type AiTask = 'prd' | 'translation' | 'custom';
export type AiScope = 'document' | 'selection';

export interface AiModelPricing {
  /** USD per token. */
  prompt: number | null;
  /** USD per token. */
  completion: number | null;
  updatedAt: string;
}

export interface AiModel {
  id: string;
  name: string;
  description?: string | null;
  contextLength: number;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  pricing: AiModelPricing;
}

export interface AiModelOption extends AiModel {
  pinned: boolean;
  enabled: boolean;
  disabledReason: string | null;
}

export interface AiKeyStatus {
  configured: boolean;
  maskedLabel: string | null;
}

export interface AiKeyMetadata extends AiKeyStatus {
  label: string | null;
  limit: number | null;
  limitRemaining: number | null;
  usage: number | null;
  expiresAt: string | null;
  isFreeTier: boolean | null;
}

export interface AiByteRange {
  start: number;
  end: number;
}

export interface AiRunRequest {
  requestId: string;
  documentId: string;
  source: string;
  selection: AiByteRange | null;
  task: AiTask;
  model: string;
  targetLanguage: string | null;
  instruction: string | null;
  zdrOnly: boolean;
  maxOutputTokens: number;
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number | null;
  costCalculated: boolean;
}

export type AiStreamEvent =
  | { type: 'started'; requestId: string; generationId: string | null }
  | { type: 'progress'; requestId: string; receivedCharacters: number }
  | { type: 'completed'; requestId: string; generationId: string | null }
  | { type: 'failed'; requestId: string; code: string; message: string }
  | { type: 'cancelled'; requestId: string };

export interface AiValidationIssue {
  code: string;
  message: string;
  segmentId: string | null;
}

export interface AiValidatedOperation {
  id: string;
  kind: 'replace' | 'insert_before' | 'insert_after';
  targetSegmentId: string;
  sourceRange: AiByteRange;
  originalMarkdown: string;
  proposedMarkdown: string;
  findingIds: string[];
}

export interface AiFinding {
  id: string;
  severity: string;
  category: string;
  evidenceSegmentId: string | null;
  rationale: string;
}

export interface AiValidatedDocument {
  sourceRevisionHash: string;
  proposedMarkdown: string;
  validation: {
    passed: boolean;
    issues: AiValidationIssue[];
  };
  operations: AiValidatedOperation[];
  hunks: Array<{
    operationId: string;
    sourceRange: AiByteRange;
    originalMarkdown: string;
    proposedMarkdown: string;
  }>;
  summary: string | null;
  findings: AiFinding[];
  assumptions: string[];
  detectedSourceLanguage: string | null;
  targetLanguage: string | null;
  warnings: string[];
}

export interface AiRunResult {
  requestId: string;
  documentId: string;
  task: AiTask;
  model: string;
  generationId: string | null;
  result: AiValidatedDocument | null;
  validationIssues: AiValidationIssue[];
  rawDiagnostic: string | null;
  usage: AiUsage | null;
  retryAfterSeconds: number | null;
}
