import { recordDiagnosticsEvent } from './settings';

type ConsoleLevel = 'debug' | 'error' | 'info' | 'log' | 'warn';

const CONSOLE_LEVELS: ConsoleLevel[] = ['debug', 'error', 'info', 'log', 'warn'];
const SAFE_LABEL_PATTERNS = [
  /^Failed\b/i,
  /^Uncaught error\b/i,
  /^Unrecognized\b/i,
  /^Update\b/i,
  /^Pre-install\b/i,
  /^\[Markdowner]/,
  /^\[IME]/,
];

let installed = false;

export function sanitizeDiagnosticsConsoleLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return `[${diagnosticsArgumentType(value)}]`;
  }

  const trimmed = value.trim();
  if (!trimmed) return '[empty]';
  if (/[\r\n]/.test(trimmed)) return '[multiline]';

  if (!SAFE_LABEL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return '[redacted]';
  }

  return trimmed
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/(?:~|\/(?:Users|Volumes|private|var|tmp|home))\/[^\s"'<>]+/g, '[path]')
    .slice(0, 180);
}

function diagnosticsArgumentType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Error) return 'error';
  return typeof value;
}

function recordConsoleEvent(level: ConsoleLevel, args: unknown[]) {
  const first = args[0];
  if (
    typeof first === 'string' &&
    first.startsWith('Failed to record diagnostics event:')
  ) {
    return;
  }

  void recordDiagnosticsEvent('frontend.console', {
    level,
    label: sanitizeDiagnosticsConsoleLabel(first),
    argumentCount: args.length,
    argumentTypes: args.map(diagnosticsArgumentType),
  });
}

function recordWindowError(event: ErrorEvent) {
  void recordDiagnosticsEvent('frontend.error', {
    label: sanitizeDiagnosticsConsoleLabel(event.message),
    errorType:
      event.error instanceof Error ? event.error.name : diagnosticsArgumentType(event.error),
  });
}

function recordUnhandledRejection(event: PromiseRejectionEvent) {
  const reason = event.reason;
  void recordDiagnosticsEvent('frontend.unhandledRejection', {
    errorType: reason instanceof Error ? reason.name : diagnosticsArgumentType(reason),
  });
}

export function installDiagnosticsLogging() {
  if (installed) return;
  installed = true;

  for (const level of CONSOLE_LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      recordConsoleEvent(level, args);
    };
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('error', recordWindowError);
    window.addEventListener('unhandledrejection', recordUnhandledRejection);
  }
}
