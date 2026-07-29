import { fuzzyScore } from './fuzzy';

export type SkillSuggestionPrefix = '/' | '$';

export type SkillSuggestionQuery = {
  prefix: SkillSuggestionPrefix;
  query: string;
  from: number;
  to: number;
};

export type SkillSuggestion = {
  name: string;
  token: string;
};

const SKILL_QUERY_PATTERN =
  /(?:^|\s)([/$])([A-Za-z0-9_-]*(?::[A-Za-z0-9_-]*)?)$/;

export function findSkillSuggestionQuery(
  textBeforeCaret: string,
): SkillSuggestionQuery | null {
  const match = SKILL_QUERY_PATTERN.exec(textBeforeCaret);
  if (!match) return null;

  const prefix = match[1] as SkillSuggestionPrefix;
  const query = match[2] ?? '';
  const tokenLength = prefix.length + query.length;

  return {
    prefix,
    query,
    from: textBeforeCaret.length - tokenLength,
    to: textBeforeCaret.length,
  };
}

export function buildSkillSuggestions(
  prefix: SkillSuggestionPrefix,
  query: string,
  skillNames: Iterable<string>,
): SkillSuggestion[] {
  const uniqueNames = [...new Set(skillNames)].sort((left, right) =>
    left.localeCompare(right),
  );
  const normalizedQuery = query.toLowerCase();
  const prefixMatches = uniqueNames.filter((name) =>
    name.toLowerCase().startsWith(normalizedQuery),
  );
  const candidateNames =
    query.length > 0 && prefixMatches.length > 0 ? prefixMatches : uniqueNames;

  return candidateNames
    .map((name) => ({
      name,
      score: fuzzyScore(name, query),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.name.localeCompare(right.name),
    )
    .map(({ name }) => ({
      name,
      token: `${prefix}${name}`,
    }));
}
