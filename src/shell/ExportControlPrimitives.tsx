import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ExportRangeControlProps {
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

export function ExportRangeControl({
  id,
  label,
  value,
  min,
  max,
  step,
  suffix,
  disabled,
  onChange,
}: ExportRangeControlProps) {
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
          {value}
          {suffix}
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

export interface ExportColorControlProps {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

export function ExportColorControl({
  id,
  label,
  value,
  disabled,
  onChange,
}: ExportColorControlProps) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label
        htmlFor={id}
        className="truncate text-xs font-medium text-foreground/85"
        title={label}
      >
        {label}
      </Label>
      <div className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-1.5">
        <Input
          id={id}
          aria-label={label}
          type="color"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-8 shrink-0 cursor-pointer rounded border-0 p-0 shadow-none"
        />
        <span className="min-w-0 truncate font-mono text-[10px] uppercase text-muted-foreground">
          {value}
        </span>
      </div>
    </div>
  );
}
