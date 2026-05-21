import { normalizeFinalNewline } from './sourceText';

type ResolveActiveDraftSyncPlanInput = {
  activeDocumentOpen: boolean;
  activeDocumentSource: string | null;
  localDraft: string;
  flushedDraft: string | null;
  forFinalSave?: boolean;
};

type ActiveDraftSyncPlan = {
  outgoingDraft: string;
  shouldReplaceActiveSource: boolean;
  shouldUpdateLocalDraft: boolean;
};

export function resolveActiveDraftSyncPlan(
  input: ResolveActiveDraftSyncPlanInput,
): ActiveDraftSyncPlan | null {
  if (!input.activeDocumentOpen || input.activeDocumentSource === null) {
    return null;
  }

  const draft = input.flushedDraft ?? input.localDraft;
  const outgoingDraft = input.forFinalSave ? normalizeFinalNewline(draft) : draft;

  return {
    outgoingDraft,
    shouldReplaceActiveSource:
      normalizeFinalNewline(outgoingDraft) !== normalizeFinalNewline(input.activeDocumentSource),
    shouldUpdateLocalDraft: outgoingDraft !== draft,
  };
}
