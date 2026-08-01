import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

import { Button } from '@/components/ui/button';
import {
  addFrontMatterProperty,
  deleteFrontMatterProperty,
  frontMatterStatus,
  parseLeadingFrontMatter,
  replaceFrontMatterProperty,
  type FrontMatterProperty,
} from '@/lib/frontMatter';
import { openExternalUrl } from '@/lib/desktop';

export function FrontMatterView({ node, updateAttributes }: NodeViewProps) {
  const raw = typeof node.attrs.raw === 'string' ? node.attrs.raw : '';
  const parsed = useMemo(() => parseLeadingFrontMatter(raw), [raw]);
  const [expanded, setExpanded] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [rawMode, setRawMode] = useState(false);
  const [rawDraft, setRawDraft] = useState(raw);
  const [error, setError] = useState('');
  const skipNextBlur = useRef(false);
  const title = parsed.properties.find((property) => property.key === 'title');
  const tags = parsed.properties.find((property) => property.key === 'tags');

  const updateRaw = (nextRaw: string) => {
    const status = frontMatterStatus(nextRaw);
    updateAttributes({ raw: nextRaw, ...status });
    setError('');
  };

  const startEdit = (property: FrontMatterProperty) => {
    setEditingKey(property.key);
    setDraft(
      Array.isArray(property.displayValue)
        ? property.displayValue.join(', ')
        : property.displayValue,
    );
  };

  const commitEdit = (property: FrontMatterProperty) => {
    try {
      if (property.kind === 'boolean' && !matchesBoolean(draft)) {
        throw new Error('Use true or false for a boolean property.');
      }
      const value = property.kind === 'string-list'
        ? draft.split(',').map((item) => item.trim()).filter(Boolean)
        : property.kind === 'number'
          ? Number(draft)
          : property.kind === 'boolean'
            ? draft === 'true'
            : draft;
      updateRaw(replaceFrontMatterProperty(raw, property.key, value));
      setEditingKey(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const saveRaw = () => {
    const next = parseLeadingFrontMatter(rawDraft);
    if (!next.hasFrontMatter) {
      setError('Raw front matter needs a closing --- or ... delimiter.');
      return;
    }
    updateRaw(rawDraft);
    setRawMode(false);
  };

  return (
    <NodeViewWrapper
      as="section"
      contentEditable={false}
      className="front-matter-card"
      data-front-matter=""
      aria-label="Document properties"
    >
      <button
        type="button"
        className="front-matter-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span className="font-medium">Properties</span>
        <span className="text-muted-foreground">{parsed.properties.length}</span>
        {typeof title?.displayValue === 'string' ? (
          <span className="min-w-0 truncate text-muted-foreground">{title.displayValue}</span>
        ) : null}
        {Array.isArray(tags?.displayValue) ? (
          <span className="ml-auto truncate text-muted-foreground">{tags.displayValue.join(', ')}</span>
        ) : null}
      </button>

      {expanded ? (
        <div className="front-matter-content">
          {!parsed.valid ? (
            <p role="alert" className="text-xs text-destructive">
              {parsed.issues[0]?.message ?? 'This YAML requires raw editing.'}
            </p>
          ) : null}

          {!rawMode ? (
            <dl className="front-matter-properties">
              {parsed.properties.map((property) => (
                <div key={`${property.key}:${property.keyRange[0]}`} className="front-matter-property">
                  <dt title={property.key}>{property.key}</dt>
                  <dd>
                    {editingKey === property.key ? (
                      <input
                        autoFocus
                        aria-label={`Edit ${property.key}`}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            skipNextBlur.current = true;
                            setEditingKey(null);
                            setDraft('');
                          } else if (event.key === 'Enter') {
                            event.preventDefault();
                            skipNextBlur.current = true;
                            commitEdit(property);
                          }
                        }}
                        onBlur={() => {
                          if (skipNextBlur.current) {
                            skipNextBlur.current = false;
                            return;
                          }
                          commitEdit(property);
                        }}
                      />
                    ) : (
                      <PropertyValue property={property} />
                    )}
                  </dd>
                  {property.structuredEditable ? (
                    <div className="front-matter-actions">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`Edit ${property.key}`}
                        onClick={() => startEdit(property)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`Delete ${property.key}`}
                        onClick={() => {
                          try {
                            updateRaw(deleteFrontMatterProperty(raw, property.key));
                          } catch (reason) {
                            setError(errorMessage(reason));
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </dl>
          ) : (
            <div className="grid gap-2">
              <label htmlFor={`front-matter-raw-${node.attrs.raw.length}`} className="text-xs font-medium">
                Raw front matter
              </label>
              <textarea
                id={`front-matter-raw-${node.attrs.raw.length}`}
                aria-label="Raw front matter"
                rows={10}
                value={rawDraft}
                onChange={(event) => setRawDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setRawDraft(raw);
                    setRawMode(false);
                  } else if (event.key === 'Enter' && !event.shiftKey && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    saveRaw();
                  }
                }}
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={saveRaw}>Save raw</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setRawDraft(raw); setRawMode(false); }}>Cancel</Button>
              </div>
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            {parsed.valid && !rawMode ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  try {
                    updateRaw(addFrontMatterProperty(raw, nextPropertyName(parsed.properties.map((property) => property.key)), ''));
                  } catch (reason) {
                    setError(errorMessage(reason));
                  }
                }}
              >
                <Plus /> Add property
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => { setRawDraft(raw); setRawMode(true); }}
            >
              Edit raw front matter
            </Button>
          </div>
          {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

function PropertyValue({ property }: { property: FrontMatterProperty }) {
  const values = Array.isArray(property.displayValue)
    ? property.displayValue
    : [property.displayValue];
  if (property.key === 'source' && values.length === 1 && /^https?:\/\//.test(values[0])) {
    return (
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-1 truncate text-primary underline-offset-2 hover:underline"
        title={values[0]}
        onClick={() => void openExternalUrl(values[0])}
      >
        <span className="truncate">{values[0]}</span><ExternalLink className="size-3" />
      </button>
    );
  }
  return (
    <span className={Array.isArray(property.displayValue) ? 'flex flex-wrap gap-1' : 'block truncate'} title={values.join(', ')}>
      {values.map((value, index) => (
        <span key={`${value}:${index}`} className={Array.isArray(property.displayValue) ? 'rounded border border-border px-1.5 py-0.5' : undefined}>{value}</span>
      ))}
    </span>
  );
}

function nextPropertyName(keys: readonly string[]): string {
  let index = 1;
  while (keys.includes(`property_${index}`)) index += 1;
  return `property_${index}`;
}

function matchesBoolean(value: string): boolean {
  return value === 'true' || value === 'false';
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
