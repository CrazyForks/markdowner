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
