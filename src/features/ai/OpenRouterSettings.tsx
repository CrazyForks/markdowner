import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  aiDeleteKey,
  aiKeyStatus,
  aiSaveKey,
  aiVerifyKey,
} from '@/lib/desktop';

import type { AiKeyMetadata, AiKeyStatus } from './types';

export interface OpenRouterSettingsServices {
  keyStatus: () => Promise<AiKeyStatus>;
  saveKey: (apiKey: string) => Promise<AiKeyStatus>;
  verifyKey: () => Promise<AiKeyMetadata>;
  deleteKey: () => Promise<AiKeyStatus>;
}

export interface OpenRouterSettingsProps {
  zdrOnly: boolean;
  disclosureAccepted: boolean;
  onZdrOnlyChange: (enabled: boolean) => void;
  onDisclosureAcceptedChange: (accepted: boolean) => void;
  services?: OpenRouterSettingsServices;
}

const DEFAULT_SERVICES: OpenRouterSettingsServices = {
  keyStatus: aiKeyStatus,
  saveKey: aiSaveKey,
  verifyKey: aiVerifyKey,
  deleteKey: aiDeleteKey,
};

export function OpenRouterSettings({
  zdrOnly,
  disclosureAccepted,
  onZdrOnlyChange,
  onDisclosureAcceptedChange,
  services = DEFAULT_SERVICES,
}: OpenRouterSettingsProps) {
  const [status, setStatus] = useState<AiKeyStatus>({
    configured: false,
    maskedLabel: null,
  });
  const [metadata, setMetadata] = useState<AiKeyMetadata | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    services
      .keyStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [services]);

  const handleSaveAndVerify = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const saved = await services.saveKey(draft);
      setStatus(saved);
      setDraft('');
      const verified = await services.verifyKey();
      setMetadata(verified);
      setStatus({
        configured: verified.configured,
        maskedLabel: verified.maskedLabel,
      });
      setMessage('OpenRouter connection verified.');
    } catch (reason) {
      setDraft('');
      setError(errorMessage(reason));
      try {
        setStatus(await services.keyStatus());
      } catch {
        // Keep the last known masked status. The plaintext draft is already gone.
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setStatus(await services.deleteKey());
      setMetadata(null);
      setDraft('');
      setMessage('OpenRouter key deleted from Keychain.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const connectedLabel = metadata?.label?.trim() || status.maskedLabel;

  return (
    <section
      aria-labelledby="openrouter-settings-heading"
      data-testid="settings-openrouter"
      className="flex min-w-0 flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3
            id="openrouter-settings-heading"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <KeyRound className="size-4" />
            AI &amp; OpenRouter
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The API key is stored in macOS Keychain and is never read back into the
            editor.
          </p>
        </div>
        {status.configured ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3" />
            Connected
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          Checking Keychain…
        </p>
      ) : status.configured ? (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="text-sm font-medium">
            {metadata?.label
              ? `Connected as ${metadata.label}`
              : `Connected · ${connectedLabel}`}
          </p>
          {metadata ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatCreditMetadata(metadata)}
            </p>
          ) : (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {status.maskedLabel}
            </p>
          )}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          Connect OpenRouter to use AI tools.
        </p>
      )}

      <div className="grid gap-2">
        <Label htmlFor="openrouter-api-key">
          {status.configured ? 'Replace OpenRouter API key' : 'OpenRouter API key'}
        </Label>
        <Input
          id="openrouter-api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="sk-or-…"
          disabled={busy}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSaveAndVerify()}
            disabled={busy || !draft.trim()}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
            Save and verify
          </Button>
          {status.configured ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleDelete()}
              disabled={busy}
            >
              <Trash2 />
              Delete key
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <Label
          htmlFor="ai-cloud-disclosure"
          className="flex flex-col items-start gap-1 text-left"
        >
          <span>Allow cloud AI processing</span>
          <span className="text-xs font-normal leading-relaxed text-muted-foreground">
            Document content is sent to OpenRouter and the selected model provider only
            when you press Run.
          </span>
        </Label>
        <Switch
          id="ai-cloud-disclosure"
          checked={disclosureAccepted}
          onCheckedChange={onDisclosureAcceptedChange}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <Label
          htmlFor="ai-zdr-only"
          className="flex flex-col items-start gap-1 text-left"
        >
          <span>Zero Data Retention endpoints only</span>
          <span className="text-xs font-normal leading-relaxed text-muted-foreground">
            Requests fail instead of silently relaxing this provider policy.
          </span>
        </Label>
        <Switch id="ai-zdr-only" checked={zdrOnly} onCheckedChange={onZdrOnlyChange} />
      </div>

      {!zdrOnly ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200"
        >
          Zero Data Retention is off. Selected providers may retain document input and
          output under their own policies.
        </p>
      ) : null}

      <p
        aria-live="polite"
        className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
      >
        {error || message}
      </p>
    </section>
  );
}

function formatCreditMetadata(metadata: AiKeyMetadata): string {
  const parts: string[] = [];
  if (metadata.limitRemaining !== null) {
    parts.push(`USD ${metadata.limitRemaining.toFixed(2)} remaining`);
  } else if (metadata.usage !== null) {
    parts.push(`USD ${metadata.usage.toFixed(2)} used`);
  }
  if (metadata.isFreeTier !== null) {
    parts.push(metadata.isFreeTier ? 'free tier' : 'paid account');
  }
  return parts.length > 0 ? parts.join(' · ') : 'Credential verified';
}

function errorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason) {
    return String(reason.message);
  }
  return reason instanceof Error ? reason.message : String(reason);
}
