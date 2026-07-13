import { FileDown, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_EXPORT_STYLE,
  buildExportHtml,
  normalizeExportStyle,
  type ExportFormat,
  type ExportHtmlOptions,
  type ExportScope,
  type ExportStyle,
} from '@/lib/exportDocument';
import { cn } from '@/lib/utils';

export interface ExportDialogRequest {
  format: ExportFormat;
  scope: ExportScope;
  title: string;
  source: string;
  activeDocumentPath: string | null;
  targetCount: number;
}

export interface ExportDialogProps {
  open: boolean;
  request: ExportDialogRequest | null;
  initialStyle: ExportStyle;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (style: ExportStyle) => void;
  buildPreview?: (options: ExportHtmlOptions) => Promise<string>;
}

type NumericStyleKey =
  | 'fontSize'
  | 'lineHeight'
  | 'paragraphSpacing'
  | 'contentPadding';

interface RangeControlProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  disabled: boolean;
  onChange: (value: number) => void;
}

function RangeControl({
  id,
  label,
  value,
  min,
  max,
  step,
  suffix,
  disabled,
  onChange,
}: RangeControlProps) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-xs font-medium text-foreground/85">
          {label}
        </Label>
        <output
          htmlFor={id}
          className="min-w-12 rounded-md bg-muted px-1.5 py-0.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {value}{suffix}
        </output>
      </div>
      <Input
        id={id}
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 cursor-pointer appearance-none border-0 bg-muted p-0 accent-foreground shadow-none focus-visible:ring-2"
      />
    </div>
  );
}

function exportActionLabel(request: ExportDialogRequest, busy: boolean): string {
  if (busy) return 'Exporting…';
  const format = request.format.toUpperCase();
  return request.scope === 'workspace'
    ? `Export ${request.targetCount} ${format} files`
    : `Export ${format}`;
}

function requestDescription(request: ExportDialogRequest): string {
  if (request.scope === 'workspace') {
    return `${request.targetCount} Markdown files`;
  }
  return request.activeDocumentPath ?? 'Unsaved document';
}

export function ExportDialog({
  open,
  request,
  initialStyle,
  busy,
  onOpenChange,
  onConfirm,
  buildPreview = buildExportHtml,
}: ExportDialogProps) {
  const idPrefix = useId();
  const [draftStyle, setDraftStyle] = useState<ExportStyle>(() =>
    normalizeExportStyle(initialStyle),
  );
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewStatus, setPreviewStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const previewRequestRef = useRef(0);
  const requestIdentity = request
    ? `${request.format}:${request.scope}:${request.activeDocumentPath ?? ''}:${request.title}`
    : '';

  useEffect(() => {
    if (!open || !request) return;
    setDraftStyle(normalizeExportStyle(initialStyle));
  }, [initialStyle, open, request, requestIdentity]);

  useEffect(() => {
    if (!open || !request) return;
    const previewRequest = ++previewRequestRef.current;
    setPreviewStatus('loading');

    void buildPreview({
      title: request.title,
      source: request.source,
      activeDocumentPath: request.activeDocumentPath,
      forPrint: request.format === 'pdf',
      paperSize: draftStyle.paperSize,
      style: draftStyle,
    })
      .then((html) => {
        if (previewRequest !== previewRequestRef.current) return;
        setPreviewHtml(html);
        setPreviewStatus('ready');
      })
      .catch(() => {
        if (previewRequest !== previewRequestRef.current) return;
        setPreviewHtml('');
        setPreviewStatus('error');
      });
  }, [buildPreview, draftStyle, open, request]);

  if (!request) {
    return <Dialog open={false} />;
  }

  const updateNumber = (key: NumericStyleKey, value: number) => {
    setDraftStyle((current) => normalizeExportStyle({ ...current, [key]: value }));
  };
  const controlId = (name: string) => `${idPrefix}-${name}`;
  const formatLabel = request.format.toUpperCase();
  const isPdf = request.format === 'pdf';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="h-[min(780px,calc(100vh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[min(1120px,calc(100vw-2rem))]"
        overlayClassName="bg-black/45 supports-backdrop-filter:backdrop-blur-[2px]"
      >
        <DialogHeader className="border-b border-border/80 bg-muted/20 px-5 py-4">
          <div className="flex items-start gap-3 pr-8">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-background shadow-sm">
              <FileDown className="size-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-lg tracking-[-0.02em]">Export Studio</DialogTitle>
              <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[11px] font-semibold tracking-[0.12em] text-foreground">
                  {formatLabel}
                </span>
                <span aria-hidden="true">·</span>
                <span className="truncate" title={requestDescription(request)}>
                  {requestDescription(request)}
                </span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="overflow-y-auto border-b border-border bg-background px-4 py-4 lg:border-r lg:border-b-0">
            <div className="mb-4">
              <p className="font-heading text-sm font-medium">Appearance</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Tune the artifact itself. The preview and exported file share these values.
              </p>
            </div>

            <div className="grid gap-5">
              <RangeControl
                id={controlId('font-size')}
                label="Body size"
                value={draftStyle.fontSize}
                min={10}
                max={24}
                step={1}
                suffix=" px"
                disabled={busy}
                onChange={(value) => updateNumber('fontSize', value)}
              />

              <div className="grid gap-2">
                <Label htmlFor={controlId('font-family')} className="text-xs font-medium text-foreground/85">
                  Font family
                </Label>
                <select
                  id={controlId('font-family')}
                  aria-label="Font family"
                  value={draftStyle.fontFamily}
                  disabled={busy}
                  onChange={(event) =>
                    setDraftStyle((current) =>
                      normalizeExportStyle({ ...current, fontFamily: event.target.value }),
                    )
                  }
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <option value="sans">Sans — clean</option>
                  <option value="serif">Serif — editorial</option>
                  <option value="mono">Mono — technical</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor={controlId('text-color')} className="text-xs font-medium text-foreground/85">
                    Text color
                  </Label>
                  <Input
                    id={controlId('text-color')}
                    aria-label="Text color"
                    type="color"
                    value={draftStyle.textColor}
                    disabled={busy}
                    onChange={(event) =>
                      setDraftStyle((current) =>
                        normalizeExportStyle({ ...current, textColor: event.target.value }),
                      )
                    }
                    className="h-9 cursor-pointer p-1"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={controlId('background-color')} className="text-xs font-medium text-foreground/85">
                    Background color
                  </Label>
                  <Input
                    id={controlId('background-color')}
                    aria-label="Background color"
                    type="color"
                    value={draftStyle.backgroundColor}
                    disabled={busy}
                    onChange={(event) =>
                      setDraftStyle((current) =>
                        normalizeExportStyle({ ...current, backgroundColor: event.target.value }),
                      )
                    }
                    className="h-9 cursor-pointer p-1"
                  />
                </div>
              </div>

              <RangeControl
                id={controlId('line-height')}
                label="Line height"
                value={draftStyle.lineHeight}
                min={1.2}
                max={2.2}
                step={0.1}
                suffix="×"
                disabled={busy}
                onChange={(value) => updateNumber('lineHeight', value)}
              />
              <RangeControl
                id={controlId('paragraph-spacing')}
                label="Paragraph spacing"
                value={draftStyle.paragraphSpacing}
                min={0}
                max={32}
                step={1}
                suffix=" px"
                disabled={busy}
                onChange={(value) => updateNumber('paragraphSpacing', value)}
              />
              <RangeControl
                id={controlId('content-padding')}
                label="Content padding"
                value={draftStyle.contentPadding}
                min={0}
                max={72}
                step={2}
                suffix=" px"
                disabled={busy}
                onChange={(value) => updateNumber('contentPadding', value)}
              />

              {isPdf ? (
                <div className="grid gap-2">
                  <Label htmlFor={controlId('paper-size')} className="text-xs font-medium text-foreground/85">
                    Paper size
                  </Label>
                  <select
                    id={controlId('paper-size')}
                    aria-label="Paper size"
                    value={draftStyle.paperSize}
                    disabled={busy}
                    onChange={(event) =>
                      setDraftStyle((current) =>
                        normalizeExportStyle({ ...current, paperSize: event.target.value }),
                      )
                    }
                    className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    <option value="A4">A4 · 210 × 297 mm</option>
                    <option value="Letter">Letter · 8.5 × 11 in</option>
                  </select>
                </div>
              ) : null}
            </div>
          </aside>

          <section className="relative min-h-0 overflow-auto bg-[radial-gradient(circle_at_1px_1px,color-mix(in_srgb,var(--border)_70%,transparent)_1px,transparent_0)] bg-[length:18px_18px] p-4 sm:p-6">
            <div
              className={cn(
                'relative mx-auto overflow-hidden border border-black/10 bg-white shadow-[0_24px_80px_-30px_rgba(0,0,0,0.55)]',
                isPdf ? 'min-h-full max-w-[680px]' : 'h-full w-full max-w-[820px]',
              )}
              style={isPdf ? { aspectRatio: draftStyle.paperSize === 'A4' ? '210 / 297' : '8.5 / 11' } : undefined}
            >
              {previewHtml ? (
                <iframe
                  title={`${formatLabel} export preview`}
                  sandbox=""
                  srcDoc={previewHtml}
                  className="h-full min-h-[520px] w-full border-0 bg-white"
                />
              ) : null}
              {previewStatus === 'loading' ? (
                <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-muted" role="status" aria-live="polite">
                  <span className="block h-full w-1/3 animate-pulse bg-foreground/70" />
                  <span className="sr-only">Updating preview…</span>
                </div>
              ) : null}
              {previewStatus === 'error' ? (
                <div className="absolute inset-0 grid place-items-center bg-background p-8 text-center" role="alert">
                  <div>
                    <p className="font-heading text-base font-medium">Preview unavailable</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Check document images and try opening Export Studio again.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <DialogFooter className="m-0 rounded-none px-4 py-3 sm:items-center">
          <Button
            type="button"
            variant="ghost"
            className="sm:mr-auto"
            disabled={busy}
            onClick={() => setDraftStyle({ ...DEFAULT_EXPORT_STYLE })}
          >
            <RotateCcw />
            Reset
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || previewStatus !== 'ready'}
            onClick={() => onConfirm(normalizeExportStyle(draftStyle))}
          >
            <FileDown />
            {exportActionLabel(request, busy)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
