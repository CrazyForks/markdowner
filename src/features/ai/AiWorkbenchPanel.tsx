import { useEffect, useMemo, useState } from 'react';
import { Ban, LoaderCircle, Sparkles, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  aiCancel,
  aiKeyStatus,
  aiListModels,
  aiModelPricing,
  aiRun,
  openExternalUrlInNewWindow,
} from '@/lib/desktop';
import type { Settings } from '@/lib/settings';

import {
  detectDocumentLanguage,
  estimateAiRun,
  orderModels,
  resolveUsageCost,
  resolveRunGate,
  searchLanguages,
} from './model';
import type {
  AiByteRange,
  AiKeyStatus,
  AiModel,
  AiModelOption,
  AiModelPricing,
  AiRunRequest,
  AiRunResult,
  AiStreamEvent,
  AiTask,
} from './types';

export interface AiWorkbenchServices {
  keyStatus: () => Promise<AiKeyStatus>;
  listModels: () => Promise<AiModel[]>;
  modelPricing?: (
    modelId: string,
    zdrOnly: boolean,
  ) => Promise<AiModelPricing>;
  run: (
    request: AiRunRequest,
    onEvent: (event: AiStreamEvent) => void,
  ) => Promise<AiRunResult>;
  cancel: (requestId: string) => Promise<boolean>;
  openActivity?: () => Promise<void>;
}

export interface AiWorkbenchPanelProps {
  documentId: string;
  source: string;
  selection: AiByteRange | null;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onOpenSettings?: () => void;
  onStart?: (request: AiRunRequest) => void;
  onFailure?: (request: AiRunRequest, reason: unknown) => void;
  onResult: (result: AiRunResult, request: AiRunRequest) => void;
  services?: AiWorkbenchServices;
}

const DEFAULT_SERVICES: AiWorkbenchServices = {
  keyStatus: aiKeyStatus,
  listModels: aiListModels,
  modelPricing: aiModelPricing,
  run: aiRun,
  cancel: aiCancel,
  openActivity: () =>
    openExternalUrlInNewWindow('https://openrouter.ai/activity'),
};

const selectClass =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function AiWorkbenchPanel({
  documentId,
  source,
  selection,
  settings,
  onSettingsChange,
  onOpenSettings,
  onStart,
  onFailure,
  onResult,
  services = DEFAULT_SERVICES,
}: AiWorkbenchPanelProps) {
  const [task, setTask] = useState<AiTask>('prd');
  const [scope, setScope] = useState<'document' | 'selection'>('document');
  const [models, setModels] = useState<AiModel[]>([]);
  const [model, setModel] = useState(settings.aiPrdModel);
  const [modelQuery, setModelQuery] = useState('');
  const [livePricing, setLivePricing] = useState<{
    modelId: string;
    pricing: AiModelPricing;
  } | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState(
    settings.aiTranslationTargetLanguage,
  );
  const [languageQuery, setLanguageQuery] = useState('');
  const [instruction, setInstruction] = useState('');
  const [keyStatus, setKeyStatus] = useState<AiKeyStatus | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [runningRequestId, setRunningRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [showActivityLink, setShowActivityLink] = useState(false);

  useEffect(() => {
    let cancelled = false;
    services
      .keyStatus()
      .then((nextStatus) => {
        if (cancelled) return;
        setKeyStatus(nextStatus);
        if (!nextStatus.configured) return;
        setCatalogLoading(true);
        services
          .listModels()
          .then((nextModels) => {
            if (!cancelled) setModels(nextModels);
          })
          .catch((reason) => {
            if (!cancelled) setError(errorMessage(reason));
          })
          .finally(() => {
            if (!cancelled) setCatalogLoading(false);
          });
      })
      .catch((reason) => {
        if (!cancelled) {
          setKeyStatus({ configured: false, maskedLabel: null });
          setError(errorMessage(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [services]);

  useEffect(() => {
    const defaultModel =
      task === 'prd'
        ? settings.aiPrdModel
        : task === 'translation'
          ? settings.aiTranslationModel
          : settings.aiCustomPromptModel;
    setModel(defaultModel);
    setConfirmed(false);
  }, [
    settings.aiCustomPromptModel,
    settings.aiPrdModel,
    settings.aiTranslationModel,
    task,
  ]);

  useEffect(() => {
    if (!selection && scope === 'selection') setScope('document');
  }, [scope, selection]);

  const modelOptions = useMemo(() => orderModels(models, task), [models, task]);
  const visibleModelOptions = useMemo(
    () => searchModels(modelOptions, modelQuery),
    [modelOptions, modelQuery],
  );
  const selectedModel =
    modelOptions.find((candidate) => candidate.id === model) ?? null;
  const selectedModelId = selectedModel?.id ?? null;
  const configured = keyStatus?.configured === true;
  const selectedModelUnavailable =
    configured && !catalogLoading && selectedModel === null;
  const selectedPricing =
    selectedModel && services.modelPricing
      ? livePricing?.modelId === selectedModel.id
        ? livePricing.pricing
        : {
            prompt: null,
            completion: null,
            updatedAt: '',
          }
      : selectedModel?.pricing ?? null;
  const pricedSelectedModel =
    selectedModel && selectedPricing
      ? { ...selectedModel, pricing: selectedPricing }
      : selectedModel;

  useEffect(() => {
    if (!configured || !selectedModelId || !services.modelPricing) {
      setLivePricing(null);
      setPricingLoading(false);
      return;
    }

    let cancelled = false;
    setLivePricing(null);
    setPricingLoading(true);
    services
      .modelPricing(selectedModelId, settings.aiZdrOnly)
      .then((pricing) => {
        if (!cancelled) {
          setLivePricing({ modelId: selectedModelId, pricing });
        }
      })
      .catch((reason) => {
        if (cancelled) return;
        setLivePricing({
          modelId: selectedModelId,
          pricing: {
            prompt: null,
            completion: null,
            updatedAt: '',
          },
        });
        setError(errorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setPricingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [configured, selectedModelId, services, settings.aiZdrOnly]);

  const scopedSource =
    scope === 'selection' && selection
      ? sourceForByteRange(source, selection)
      : source;
  const estimate = pricedSelectedModel
    ? estimateAiRun({
        source: scopedSource,
        scope,
        model: pricedSelectedModel,
        maxOutputTokens: 4_096,
      })
    : null;
  const gate =
    estimate && selectedModel
      ? resolveRunGate({
          scope,
          inputTokens: estimate.inputTokens,
          contextLength: selectedModel.contextLength,
          maxCostUsd: estimate.maxCostUsd,
        })
      : null;
  const languages = searchLanguages(languageQuery).slice(0, 12);
  const requiresInstruction = task === 'custom';
  const targetRequired = task === 'translation';
  const taskDefaultModel =
    task === 'prd'
      ? settings.aiPrdModel
      : task === 'translation'
        ? settings.aiTranslationModel
        : settings.aiCustomPromptModel;
  const detectedSourceLanguage = useMemo(
    () => (targetRequired ? detectDocumentLanguage(source) : null),
    [source, targetRequired],
  );
  const normalizedTargetLanguage = targetLanguage
    .trim()
    .toLocaleLowerCase()
    .split('-')[0];
  const sameLanguage =
    targetRequired &&
    detectedSourceLanguage !== null &&
    detectedSourceLanguage === normalizedTargetLanguage;
  const disclosureAccepted = settings.aiCloudDisclosureAccepted;
  const canRun =
    !runningRequestId &&
    !pricingLoading &&
    configured &&
    disclosureAccepted &&
    source.length > 0 &&
    selectedModel?.enabled === true &&
    gate?.kind !== 'blocked' &&
    (gate?.kind !== 'confirm' || confirmed) &&
    (!requiresInstruction || instruction.trim().length > 0) &&
    (!targetRequired || targetLanguage.trim().length > 0) &&
    !sameLanguage;

  const chooseTargetLanguage = (language: string) => {
    setTargetLanguage(language);
    setLanguageQuery('');
    if (language !== settings.aiTranslationTargetLanguage) {
      onSettingsChange({
        ...settings,
        aiTranslationTargetLanguage: language,
      });
    }
  };

  const chooseModel = (modelId: string) => {
    setModel(modelId);
    setModelQuery('');
    setConfirmed(false);
  };

  const saveModelAsDefault = () => {
    if (!selectedModel || selectedModel.id === taskDefaultModel) return;
    onSettingsChange(
      task === 'prd'
        ? { ...settings, aiPrdModel: selectedModel.id }
        : task === 'translation'
          ? { ...settings, aiTranslationModel: selectedModel.id }
          : { ...settings, aiCustomPromptModel: selectedModel.id },
    );
  };

  const handleRun = async () => {
    if (!canRun || !selectedModel) return;
    const requestId = createRequestId();
    const request: AiRunRequest = {
      requestId,
      documentId,
      source,
      selection: scope === 'selection' ? selection : null,
      task,
      model: selectedModel.id,
      targetLanguage: targetRequired ? targetLanguage : null,
      instruction: instruction.trim() || null,
      zdrOnly: settings.aiZdrOnly,
      maxOutputTokens: 4_096,
    };
    setRunningRequestId(requestId);
    setShowActivityLink(false);
    setError('');
    setStatus('Starting OpenRouter request…');
    onStart?.(request);
    try {
      const result = await services.run(request, (event) => {
        if (event.requestId !== requestId) return;
        if (event.type === 'progress') {
          setStatus(`Receiving structured result · ${event.receivedCharacters} characters`);
        } else if (event.type === 'cancelled') {
          setStatus('Request cancelled. The provider may still report partial usage.');
          setShowActivityLink(true);
        } else if (event.type === 'failed') {
          setError(event.message);
        }
      });
      setStatus(
        result.result
          ? 'AI result is ready for review.'
          : 'The response failed local validation and is available for inspection.',
      );
      if (result.usage) setShowActivityLink(false);
      onResult(
        result.usage
          ? {
              ...result,
              usage: resolveUsageCost(
                result.usage,
                selectedPricing ?? selectedModel.pricing,
              ),
            }
          : result,
        request,
      );
    } catch (reason) {
      onFailure?.(request, reason);
      if (errorCode(reason) === 'cancelled') {
        setError('');
        setStatus('Request cancelled. Final usage is unavailable.');
        setShowActivityLink(true);
      } else {
        setError(errorMessage(reason));
        setStatus('');
      }
    } finally {
      setRunningRequestId(null);
    }
  };

  const handleCancel = async () => {
    if (!runningRequestId) return;
    setStatus('Cancelling… partial provider usage may still be charged.');
    try {
      await services.cancel(runningRequestId);
      setShowActivityLink(true);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const handleOpenActivity = async () => {
    try {
      await (services.openActivity ?? DEFAULT_SERVICES.openActivity)?.();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <section
      aria-labelledby="ai-workbench-heading"
      className="ai-motion-surface flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="ai-workbench-panel"
    >
      <header className="border-b border-border px-3 py-3">
        <h2
          id="ai-workbench-heading"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <Sparkles className="size-4" />
          AI Workbench
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Improve, translate, or transform the active Markdown document.
        </p>
      </header>

      <div className="flex flex-col gap-4 p-3">
        {!configured && keyStatus !== null ? (
          <div className="rounded-md border border-dashed border-border px-3 py-3">
            <p className="text-sm font-medium">Connect OpenRouter to use AI tools.</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Add a key in Settings → AI &amp; OpenRouter. Markdowner never sends a
              document automatically.
            </p>
            {onOpenSettings ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={onOpenSettings}
              >
                Open AI settings
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="ai-task">AI task</Label>
          <select
            id="ai-task"
            aria-label="AI task"
            className={selectClass}
            value={task}
            disabled={Boolean(runningRequestId)}
            onChange={(event) => setTask(event.target.value as AiTask)}
          >
            <option value="prd">Improve PRD</option>
            <option value="translation">Translate document</option>
            <option value="custom">Custom prompt</option>
          </select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ai-scope">Scope</Label>
          <select
            id="ai-scope"
            aria-label="AI scope"
            className={selectClass}
            value={scope}
            disabled={Boolean(runningRequestId)}
            onChange={(event) =>
              setScope(event.target.value as 'document' | 'selection')
            }
          >
            <option value="document">Current document</option>
            <option value="selection" disabled={!selection}>
              Current selection
            </option>
          </select>
        </div>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ai-model">Model</Label>
            {catalogLoading ? (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin" />
                Refreshing
              </span>
            ) : null}
          </div>
          <Input
            type="search"
            aria-label="Search models"
            value={modelQuery}
            onChange={(event) => setModelQuery(event.target.value)}
            placeholder="Search models by name or slug"
            disabled={Boolean(runningRequestId)}
          />
          <select
            id="ai-model"
            aria-label="AI model"
            className={selectClass}
            value={
              selectedModelUnavailable
                ? model
                : visibleModelOptions.some(
                      (candidate) => candidate.id === selectedModel?.id,
                    )
                ? selectedModel?.id
                : ''
            }
            disabled={Boolean(runningRequestId)}
            onChange={(event) => chooseModel(event.target.value)}
          >
            {selectedModelUnavailable ? (
              <option value={model} disabled>
                {model} · unavailable
              </option>
            ) : null}
            {selectedModel &&
            !visibleModelOptions.some(
              (candidate) => candidate.id === selectedModel.id,
            ) ? (
              <option value="" disabled>
                Choose a matching model
              </option>
            ) : null}
            {visibleModelOptions.map((option) => (
              <option
                key={option.id}
                value={option.id}
                disabled={!option.enabled}
              >
                {option.name} · {option.id}
              </option>
            ))}
          </select>
          {modelQuery && visibleModelOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No text-output models match this search.
            </p>
          ) : null}
          {pricingLoading ? (
            <p className="text-[11px] text-muted-foreground">
              Checking eligible endpoint pricing…
            </p>
          ) : null}
          {selectedModel?.disabledReason ? (
            <p className="text-xs text-destructive">{selectedModel.disabledReason}</p>
          ) : null}
          {selectedModelUnavailable ? (
            <p role="alert" className="text-xs text-destructive">
              The saved model is unavailable or blocked. Choose another model
              explicitly.
            </p>
          ) : null}
          {selectedModel && selectedModel.id !== taskDefaultModel ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-fit"
              disabled={Boolean(runningRequestId)}
              onClick={saveModelAsDefault}
            >
              Save as {taskLabel(task)} default
            </Button>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Task default · change the selector for this request only.
            </p>
          )}
        </div>

        {targetRequired ? (
          <div className="grid gap-2">
            <Label htmlFor="ai-target-language">Target language</Label>
            <Input
              id="ai-target-language"
              value={languageQuery || targetLanguage}
              onFocus={() => setLanguageQuery('')}
              onChange={(event) => {
                setLanguageQuery(event.target.value);
                if (/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(event.target.value)) {
                  chooseTargetLanguage(event.target.value);
                }
              }}
              placeholder="Search by language or BCP 47 code"
              disabled={Boolean(runningRequestId)}
            />
            <div className="flex flex-wrap gap-1.5" aria-label="Language choices">
              {languages.map((language) => (
                <button
                  type="button"
                  key={language.code}
                  className={
                    language.code === targetLanguage
                      ? 'rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground'
                      : 'rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground'
                  }
                  onClick={() => chooseTargetLanguage(language.code)}
                  disabled={Boolean(runningRequestId)}
                >
                  {language.name} · {language.code}
                </button>
              ))}
            </div>
            {sameLanguage ? (
              <p
                role="alert"
                className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200"
              >
                This document already appears to be{' '}
                {languageName(detectedSourceLanguage)}. Choose a different target
                language before running.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="ai-instruction">
            {requiresInstruction ? 'Prompt' : 'Additional instruction'}
          </Label>
          <textarea
            id="ai-instruction"
            aria-label={requiresInstruction ? 'Custom prompt' : 'Additional instruction'}
            rows={requiresInstruction ? 5 : 3}
            className="w-full resize-y rounded-md border border-input bg-background px-2 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={
              requiresInstruction
                ? 'Describe the exact transformation…'
                : 'Optional constraints for this run…'
            }
            disabled={Boolean(runningRequestId)}
          />
        </div>

        {estimate ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <p className="font-medium">
              Estimated input · {estimate.inputTokens.toLocaleString()} tokens
            </p>
            <p className="mt-1 text-muted-foreground">
              Output cap · {estimate.maxOutputTokens.toLocaleString()} tokens
            </p>
            <p className="mt-1 text-muted-foreground">
              Estimated maximum cost ·{' '}
              {estimate.maxCostUsd === null
                ? 'unknown'
                : `USD ${estimate.maxCostUsd.toFixed(4)}`}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Estimate only. Actual provider usage can differ.
            </p>
            {estimate.pricingUpdatedAt ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Pricing checked · {estimate.pricingUpdatedAt}
              </p>
            ) : null}
          </div>
        ) : null}

        {gate?.reason ? (
          <div
            role={gate.kind === 'blocked' ? 'alert' : undefined}
            className={
              gate.kind === 'blocked'
                ? 'rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive'
                : 'rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200'
            }
          >
            {gate.reason}
            {gate.kind === 'confirm' ? (
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I understand and want to run this request.
              </label>
            ) : null}
          </div>
        ) : null}

        {!disclosureAccepted ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              You must approve cloud processing before Run is enabled.
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <Label htmlFor="ai-panel-disclosure" className="text-xs">
                Approve cloud processing
              </Label>
              <Switch
                id="ai-panel-disclosure"
                checked={disclosureAccepted}
                onCheckedChange={(accepted) =>
                  onSettingsChange({
                    ...settings,
                    aiCloudDisclosureAccepted: accepted,
                  })
                }
              />
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          {runningRequestId ? (
            <Button type="button" variant="destructive" onClick={() => void handleCancel()}>
              <Square />
              Cancel
            </Button>
          ) : (
            <Button type="button" onClick={() => void handleRun()} disabled={!canRun}>
              <Sparkles />
              Run
            </Button>
          )}
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            {settings.aiZdrOnly ? (
              'ZDR only'
            ) : (
              <>
                <Ban className="size-3" />
                Retention allowed
              </>
            )}
          </span>
        </div>

        <p
          aria-live="polite"
          className={error ? 'min-h-5 text-xs text-destructive' : 'min-h-5 text-xs text-muted-foreground'}
        >
          {error || status}
        </p>
        {showActivityLink ? (
          <Button
            type="button"
            size="sm"
            variant="link"
            className="h-auto w-fit px-0 text-xs"
            onClick={() => void handleOpenActivity()}
          >
            OpenRouter Activity
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sourceForByteRange(source: string, range: AiByteRange): string {
  const bytes = new TextEncoder().encode(source);
  const start = Math.max(0, Math.min(bytes.length, range.start));
  const end = Math.max(start, Math.min(bytes.length, range.end));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(start, end));
}

function errorMessage(reason: unknown): string {
  const retryAfterSeconds =
    reason &&
    typeof reason === 'object' &&
    'retryAfterSeconds' in reason &&
    typeof reason.retryAfterSeconds === 'number'
      ? reason.retryAfterSeconds
      : null;
  let message: string;
  if (reason && typeof reason === 'object' && 'message' in reason) {
    message = String(reason.message);
  } else {
    message = reason instanceof Error ? reason.message : String(reason);
  }
  return retryAfterSeconds === null
    ? message
    : `${message} Retry after ${retryAfterSeconds} seconds.`;
}

function errorCode(reason: unknown): string | null {
  return reason &&
    typeof reason === 'object' &&
    'code' in reason &&
    typeof reason.code === 'string'
    ? reason.code
    : null;
}

function languageName(code: string): string {
  if (typeof Intl.DisplayNames !== 'function') return code.toLocaleUpperCase();
  return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
}

function taskLabel(task: AiTask): string {
  return task === 'prd' ? 'PRD' : task === 'translation' ? 'translation' : 'custom';
}

function searchModels(
  models: readonly AiModelOption[],
  query: string,
): AiModelOption[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...models];
  return models.filter((model) =>
    [model.name, model.id, model.description ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(normalized),
    ),
  );
}
