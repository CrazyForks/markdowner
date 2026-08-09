export type SelectionActionId =
  | 'improve'
  | 'rewrite'
  | 'shorten'
  | 'expand'
  | 'make_table'
  | 'custom';

export interface SelectionAction {
  id: SelectionActionId;
  label: string;
  instruction: string | null;
}

export const SELECTION_ACTIONS: readonly SelectionAction[] = [
  {
    id: 'improve',
    label: 'Improve',
    instruction:
      'Improve clarity, grammar, flow, and readability while preserving meaning, facts, language, links, and useful Markdown structure.',
  },
  {
    id: 'rewrite',
    label: 'Rewrite',
    instruction:
      'Rewrite substantially while preserving intent, supported facts, language, links, and Markdown semantics.',
  },
  {
    id: 'shorten',
    label: 'Shorten',
    instruction:
      'Make the selection concise without dropping essential facts, decisions, constraints, or links.',
  },
  {
    id: 'expand',
    label: 'Expand',
    instruction:
      'Add useful explanation from the selection and surrounding document context without inventing facts or commitments.',
  },
  {
    id: 'make_table',
    label: 'Make table',
    instruction:
      'Return exactly one valid GFM table with neutral headers and only facts supported by the selection. Leave missing source fields empty. Return no surrounding explanation.',
  },
  { id: 'custom', label: 'Custom instruction', instruction: null },
];

export function resolveSelectionInstruction(
  actionId: SelectionActionId,
  customInstruction: string,
): string | null {
  const action = SELECTION_ACTIONS.find((candidate) => candidate.id === actionId);
  if (action?.instruction) return action.instruction;
  const trimmed = customInstruction.trim();
  return trimmed.length > 0 ? trimmed : null;
}
