import {
  LineCounter,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Node,
  type Pair,
} from 'yaml';

export type FrontMatterPropertyKind =
  | 'string'
  | 'date'
  | 'number'
  | 'boolean'
  | 'string-list'
  | 'complex';

export interface FrontMatterProperty {
  key: string;
  kind: FrontMatterPropertyKind;
  displayValue: string | string[];
  keyRange: readonly [number, number];
  valueRange: readonly [number, number] | null;
  structuredEditable: boolean;
}

export interface FrontMatterIssue {
  message: string;
  line: number;
  column: number;
}

export interface ParsedFrontMatter {
  hasFrontMatter: boolean;
  raw: string;
  body: string;
  bodyOffset: number;
  newline: '\n' | '\r\n';
  closingMarker: '---' | '...' | null;
  valid: boolean;
  issues: readonly FrontMatterIssue[];
  properties: readonly FrontMatterProperty[];
}

export class FrontMatterMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrontMatterMutationError';
  }
}

interface LeadingBlock {
  rawEnd: number;
  payloadStart: number;
  payloadEnd: number;
  closingStart: number;
  closingMarker: '---' | '...';
  newline: '\n' | '\r\n';
}

type RangedNode = Node & { range?: [number, number, number] };

export function parseLeadingFrontMatter(markdown: string): ParsedFrontMatter {
  const leading = findLeadingBlock(markdown);
  if (!leading) return emptyProjection(markdown);

  const payload = markdown.slice(leading.payloadStart, leading.payloadEnd);
  const lineCounter = new LineCounter();
  const document = parseDocument(payload, {
    lineCounter,
    keepSourceTokens: true,
    prettyErrors: false,
    uniqueKeys: true,
    version: '1.2',
  });
  const issues = [...document.errors, ...document.warnings].map((issue) => {
    const offset = issue.pos?.[0] ?? 0;
    const position = lineCounter.linePos(offset);
    return {
      message: issue.message,
      line: position.line + 1,
      column: position.col,
    };
  });
  const ambiguous = hasAmbiguousYaml(payload);
  const valid = issues.length === 0 && isMap(document.contents) && !ambiguous;
  if (ambiguous) {
    issues.push({
      message: 'This YAML uses syntax that requires raw editing to preserve it safely.',
      line: 2,
      column: 1,
    });
  }
  const properties = isMap(document.contents)
    ? document.contents.items.flatMap((pair) =>
        projectPair(pair, payload, leading.payloadStart, valid),
      )
    : [];

  return {
    hasFrontMatter: true,
    raw: markdown.slice(0, leading.rawEnd),
    body: markdown.slice(leading.rawEnd),
    bodyOffset: leading.rawEnd,
    newline: leading.newline,
    closingMarker: leading.closingMarker,
    valid,
    issues,
    properties,
  };
}

export function replaceFrontMatterProperty(
  markdown: string,
  key: string,
  nextValue: unknown,
): string {
  const parsed = parseLeadingFrontMatter(markdown);
  requireStructured(parsed);
  const matches = parsed.properties.filter((property) => property.key === key);
  if (matches.length !== 1) {
    throw new FrontMatterMutationError(`Property ${key} is missing or ambiguous.`);
  }
  const property = matches[0];
  if (!property.structuredEditable || !property.valueRange) {
    throw new FrontMatterMutationError(`Property ${key} requires raw editing.`);
  }
  const current = markdown.slice(property.valueRange[0], property.valueRange[1]);
  const replacement = formatPropertyValue(
    nextValue,
    property.kind,
    current,
    indentationAt(markdown, property.keyRange[0]) + '  ',
    parsed.newline,
  );
  return replaceRange(markdown, property.valueRange, replacement);
}

export function addFrontMatterProperty(
  markdown: string,
  key: string,
  value: unknown,
): string {
  const parsed = parseLeadingFrontMatter(markdown);
  requireStructured(parsed);
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
    throw new FrontMatterMutationError('Use a simple YAML property name.');
  }
  if (parsed.properties.some((property) => property.key === key)) {
    throw new FrontMatterMutationError(`Property ${key} already exists.`);
  }
  const leading = findLeadingBlock(markdown);
  if (!leading) throw new FrontMatterMutationError('Front matter is missing.');
  const formatted = formatNewValue(value, '  ', parsed.newline);
  const line = formatted.startsWith(parsed.newline)
    ? `${key}:${formatted}${parsed.newline}`
    : `${key}: ${formatted}${parsed.newline}`;
  return `${markdown.slice(0, leading.closingStart)}${line}${markdown.slice(leading.closingStart)}`;
}

export function deleteFrontMatterProperty(markdown: string, key: string): string {
  const parsed = parseLeadingFrontMatter(markdown);
  requireStructured(parsed);
  const matches = parsed.properties.filter((property) => property.key === key);
  if (matches.length !== 1 || !matches[0].structuredEditable) {
    throw new FrontMatterMutationError(`Property ${key} requires raw editing.`);
  }
  const property = matches[0];
  const lineStart = markdown.lastIndexOf('\n', property.keyRange[0] - 1) + 1;
  const valueEnd = property.valueRange?.[1] ?? property.keyRange[1];
  const nextLine = markdown.indexOf('\n', valueEnd);
  const lineEnd = nextLine === -1 ? valueEnd : nextLine + 1;
  return `${markdown.slice(0, lineStart)}${markdown.slice(lineEnd)}`;
}

export function markdownBody(markdown: string): string {
  return parseLeadingFrontMatter(markdown).body;
}

export function frontMatterStatus(raw: string): Pick<ParsedFrontMatter, 'valid' | 'issues'> {
  const parsed = parseLeadingFrontMatter(raw);
  return { valid: parsed.valid, issues: parsed.issues };
}

function findLeadingBlock(markdown: string): LeadingBlock | null {
  if (markdown.startsWith('\uFEFF')) return null;
  const firstBreak = markdown.indexOf('\n');
  const firstEnd = firstBreak === -1 ? markdown.length : firstBreak;
  const firstLine = markdown.slice(0, firstEnd).replace(/\r$/, '');
  if (firstLine !== '---' || firstBreak === -1) return null;
  const newline: '\n' | '\r\n' = markdown[firstBreak - 1] === '\r' ? '\r\n' : '\n';
  let cursor = firstBreak + 1;
  while (cursor <= markdown.length) {
    const nextBreak = markdown.indexOf('\n', cursor);
    const lineEnd = nextBreak === -1 ? markdown.length : nextBreak;
    const line = markdown.slice(cursor, lineEnd).replace(/\r$/, '');
    if (line === '---' || line === '...') {
      return {
        rawEnd: nextBreak === -1 ? lineEnd : nextBreak + 1,
        payloadStart: firstBreak + 1,
        payloadEnd: cursor,
        closingStart: cursor,
        closingMarker: line,
        newline,
      };
    }
    if (nextBreak === -1) break;
    cursor = nextBreak + 1;
  }
  return null;
}

function projectPair(
  pair: Pair,
  payload: string,
  payloadStart: number,
  documentValid: boolean,
): FrontMatterProperty[] {
  if (!isScalar(pair.key) || typeof pair.key.value !== 'string') return [];
  const keyRange = nodeRange(pair.key as RangedNode);
  if (!keyRange) return [];
  const value = pair.value as RangedNode | null;
  const valueRange = value ? nodeRange(value) : null;
  const projection = classifyValue(value, payload, valueRange);
  return [{
    key: pair.key.value,
    kind: projection.kind,
    displayValue: projection.displayValue,
    keyRange: [payloadStart + keyRange[0], payloadStart + keyRange[1]],
    valueRange: valueRange
      ? [payloadStart + valueRange[0], payloadStart + valueRange[1]]
      : null,
    structuredEditable:
      documentValid && projection.kind !== 'complex' && valueRange !== null,
  }];
}

function classifyValue(
  value: RangedNode | null,
  payload: string,
  range: readonly [number, number] | null,
): { kind: FrontMatterPropertyKind; displayValue: string | string[] } {
  if (!value || !range) return { kind: 'complex', displayValue: '' };
  if (isScalar(value)) {
    if (typeof value.value === 'boolean') return { kind: 'boolean', displayValue: String(value.value) };
    if (typeof value.value === 'number') return { kind: 'number', displayValue: String(value.value) };
    if (typeof value.value === 'string') {
      const raw = payload.slice(range[0], range[1]);
      return {
        kind: /^['"]?\d{4}-\d{2}-\d{2}['"]?$/.test(raw.trim()) ? 'date' : 'string',
        displayValue: value.value,
      };
    }
    return { kind: 'complex', displayValue: String(value.value ?? '') };
  }
  if (isSeq(value)) {
    const values = value.items.map((item) => isScalar(item) && typeof item.value === 'string' ? item.value : null);
    return values.every((item): item is string => item !== null)
      ? { kind: 'string-list', displayValue: values }
      : { kind: 'complex', displayValue: payload.slice(range[0], range[1]) };
  }
  return { kind: 'complex', displayValue: payload.slice(range[0], range[1]) };
}

function nodeRange(node: RangedNode): readonly [number, number] | null {
  return node.range ? [node.range[0], node.range[1]] : null;
}

function hasAmbiguousYaml(payload: string): boolean {
  return /(^|\n)[ \t]*[^#\n]+:[ \t]*[|>][+-]?[ \t]*(?:\r?\n|$)/.test(payload)
    || /(^|[\s[{,])(?:[&*!][^\s,\]}]+|<<[ \t]*:)/.test(payload);
}

function requireStructured(parsed: ParsedFrontMatter): void {
  if (!parsed.hasFrontMatter || !parsed.valid) {
    throw new FrontMatterMutationError('This front matter requires raw editing.');
  }
}

function formatPropertyValue(
  value: unknown,
  kind: FrontMatterPropertyKind,
  current: string,
  indent: string,
  newline: '\n' | '\r\n',
): string {
  if (kind === 'string-list') {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      throw new FrontMatterMutationError('This property requires a list of text values.');
    }
    const prefix = current.startsWith(newline) ? newline : '';
    return `${prefix}${value.map((item) => `${indent}- ${quoteString(item)}`).join(newline)}`;
  }
  if (kind === 'number' && typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (kind === 'boolean' && typeof value === 'boolean') return String(value);
  if ((kind === 'string' || kind === 'date') && typeof value === 'string') {
    if (current.trimStart().startsWith('"')) return JSON.stringify(value);
    if (current.trimStart().startsWith("'")) return `'${value.split("'").join("''")}'`;
    return safePlainScalar(value) ? value : quoteString(value);
  }
  throw new FrontMatterMutationError('The new value does not match this property type.');
}

function formatNewValue(value: unknown, indent: string, newline: '\n' | '\r\n'): string {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return `${newline}${value.map((item) => `${indent}- ${quoteString(item)}`).join(newline)}`;
  }
  if (typeof value === 'string') return quoteString(value);
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  throw new FrontMatterMutationError('Only scalar and text-list properties can be added safely.');
}

function quoteString(value: string): string {
  return JSON.stringify(value);
}

function safePlainScalar(value: string): boolean {
  return value.length > 0
    && value.trim() === value
    && !/[:#\[\]{}&,*!|>'"%@`\r\n]/.test(value)
    && !/^(?:true|false|null|~|[-+]?\d+(?:\.\d+)?)$/i.test(value);
}

function indentationAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  return source.slice(lineStart, offset).match(/^[ \t]*/)?.[0] ?? '';
}

function replaceRange(
  source: string,
  range: readonly [number, number],
  replacement: string,
): string {
  return `${source.slice(0, range[0])}${replacement}${source.slice(range[1])}`;
}

function emptyProjection(markdown: string): ParsedFrontMatter {
  return {
    hasFrontMatter: false,
    raw: '',
    body: markdown,
    bodyOffset: 0,
    newline: markdown.includes('\r\n') ? '\r\n' : '\n',
    closingMarker: null,
    valid: false,
    issues: [],
    properties: [],
  };
}
