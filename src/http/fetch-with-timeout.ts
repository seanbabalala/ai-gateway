import {
  redactErrorText,
  type ErrorRedactionOptions,
} from '../security/error-redaction';

export const FETCH_ERROR_REDACTION: ErrorRedactionOptions = {
  bearerReplacement: 'Bearer [redacted]',
  gatewayKeyReplacement: 'gw_sk_[redacted]',
  skKeyReplacement: 'sk-[redacted]',
  providerKeyReplacement: '[redacted-provider-key]',
  sensitiveValueReplacement: '[redacted]',
  maxLength: 300,
};

export class FetchTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, message?: string) {
    super(message || `Fetch request timed out after ${timeoutMs}ms.`);
    this.name = 'FetchTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export interface FetchWithTimeoutOptions {
  timeoutMs: number;
  timeoutMessage?: string | ((timeoutMs: number) => string);
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchWithTimeoutOptions,
): Promise<Response> {
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let timedOut = false;

  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) {
    controller.abort();
  } else {
    upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timeout.unref?.();

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new FetchTimeoutError(timeoutMs, timeoutMessage(options, timeoutMs));
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}

export function isFetchAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function fetchErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return [error.message, causeErrorMessage(error)].filter(Boolean).join(' ');
  }
  return String(error);
}

export function redactedFetchErrorMessage(
  error: unknown,
  options: ErrorRedactionOptions = FETCH_ERROR_REDACTION,
): string {
  return redactErrorText(fetchErrorMessage(error), options);
}

function timeoutMessage(
  options: FetchWithTimeoutOptions,
  timeoutMs: number,
): string {
  if (typeof options.timeoutMessage === 'function') {
    return options.timeoutMessage(timeoutMs);
  }
  return options.timeoutMessage || `Fetch request timed out after ${timeoutMs}ms.`;
}

function normalizeTimeoutMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) return 1;
  return Math.max(1, Math.floor(timeoutMs));
}

function causeErrorMessage(error: Error): string {
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause) return '';
  if (cause instanceof Error) return cause.message;
  if (isRecord(cause)) {
    const message = typeof cause.message === 'string' ? cause.message : '';
    const code = typeof cause.code === 'string' ? cause.code : '';
    return [message, code].filter(Boolean).join(' ');
  }
  return String(cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
