import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  normalizeImageExportOptions,
  type ImageExportFormat,
  type ImageExportLayout,
  type ImageExportOptions,
  type ImageExportScale,
} from '@/lib/imageExport';

export interface ImageExportControlsProps {
  value: ImageExportOptions;
  disabled: boolean;
  onChange: (value: ImageExportOptions) => void;
  idPrefix?: string;
}

const selectClassName =
  'h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function ImageExportControls({
  value,
  disabled,
  onChange,
  idPrefix = 'image-export',
}: ImageExportControlsProps) {
  const update = (patch: Partial<ImageExportOptions>) => {
    onChange(normalizeImageExportOptions({ ...value, ...patch }));
  };

  return (
    <fieldset className="grid gap-4 border-b border-border pb-4">
      <legend className="sr-only">Image output</legend>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-format`} className="text-xs font-medium text-foreground/85">
          Format
        </Label>
        <select
          id={`${idPrefix}-format`}
          aria-label="Image format"
          value={value.format}
          disabled={disabled}
          onChange={(event) => update({ format: event.target.value as ImageExportFormat })}
          className={selectClassName}
        >
          <option value="png">PNG · lossless</option>
          <option value="jpeg">JPEG</option>
          <option value="webp">WebP</option>
        </select>
      </div>

      <div className="grid gap-2">
        <span className="text-xs font-medium text-foreground/85">Layout</span>
        <div
          role="group"
          aria-label="Image layout"
          className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1"
        >
          {(
            [
              ['pages', 'Pages'],
              ['long', 'Long image'],
            ] as const
          ).map(([layout, label]) => (
            <Button
              key={layout}
              type="button"
              variant={value.layout === layout ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={value.layout === layout}
              disabled={disabled}
              onClick={() => update({ layout: layout as ImageExportLayout })}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <span className="text-xs font-medium text-foreground/85">Resolution</span>
        <div
          role="group"
          aria-label="Image resolution"
          className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/40 p-1"
        >
          {([1, 2, 3] as const).map((scale) => (
            <Button
              key={scale}
              type="button"
              variant={value.scale === scale ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={value.scale === scale}
              disabled={disabled}
              onClick={() => update({ scale: scale as ImageExportScale })}
            >
              {scale}×
            </Button>
          ))}
        </div>
      </div>

      {value.format === 'png' ? null : (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <Label
              htmlFor={`${idPrefix}-quality`}
              className="text-xs font-medium text-foreground/85"
            >
              Quality
            </Label>
            <output
              htmlFor={`${idPrefix}-quality`}
              className="min-w-10 rounded-md bg-muted px-1.5 py-0.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground"
            >
              {value.quality}
            </output>
          </div>
          <input
            id={`${idPrefix}-quality`}
            type="range"
            aria-label="Image quality"
            min={1}
            max={100}
            step={1}
            value={value.quality}
            disabled={disabled}
            onChange={(event) => update({ quality: Number(event.target.value) })}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      )}
    </fieldset>
  );
}
