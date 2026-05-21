function normalizeCloseDecision(decision: unknown): unknown {
  return typeof decision === 'string'
    ? decision.trim().toLowerCase().replace(/[\u2019']/g, "'")
    : decision;
}

export function isSaveCloseDecision(decision: unknown): boolean {
  const normalized = normalizeCloseDecision(decision);
  return normalized === true || normalized === 'save' || normalized === 'yes';
}

export function isDiscardCloseDecision(decision: unknown): boolean {
  const normalized = normalizeCloseDecision(decision);
  return (
    normalized === false ||
    normalized === 'no' ||
    normalized === "don't save" ||
    normalized === 'dont save' ||
    normalized === 'discard'
  );
}

export type CloseDecisionAction =
  | { kind: 'save' }
  | { kind: 'discard' }
  | { kind: 'ignore' }
  | { kind: 'warn'; decision: unknown };

export function resolveCloseDecisionAction(decision: unknown): CloseDecisionAction {
  if (isSaveCloseDecision(decision)) {
    return { kind: 'save' };
  }
  if (isDiscardCloseDecision(decision)) {
    return { kind: 'discard' };
  }
  if (decision === undefined) {
    return { kind: 'ignore' };
  }
  return { kind: 'warn', decision };
}
