import { StreamErrorEvent } from '../../canonical/canonical.types';
import { redactProviderErrorText } from '../provider-error-redaction';

export interface StreamErrorClassification {
  statusCode: number;
  failureType: 'timeout' | 'rate_limited' | 'http_error' | 'network_error';
}

export function classifyStreamError(
  event: StreamErrorEvent,
): StreamErrorClassification {
  const explicitStatusCode =
    numericField(event.error.status_code) ??
    numericField((event.error as Record<string, unknown>).statusCode);
  if (explicitStatusCode && explicitStatusCode >= 400 && explicitStatusCode < 600) {
    return {
      statusCode: explicitStatusCode,
      failureType: explicitStatusCode === 429 ? 'rate_limited' : 'http_error',
    };
  }

  const numericCode = numericField(event.error.code);
  if (numericCode && numericCode >= 400 && numericCode < 600) {
    return {
      statusCode: numericCode,
      failureType: numericCode === 429 ? 'rate_limited' : 'http_error',
    };
  }

  const text = errorTextForClassification(event.error);
  if (
    containsAny(text, [
      'rate_limit_exceeded',
      'rate limit',
      'too many requests',
      'concurrency limit',
      'high demand',
      'no_capacity',
    ])
  ) {
    return { statusCode: 429, failureType: 'rate_limited' };
  }
  if (containsAny(text, ['unauthorized', 'invalid_api_key'])) {
    return { statusCode: 401, failureType: 'http_error' };
  }
  if (containsAny(text, ['forbidden', 'permission denied', 'not allowed'])) {
    return { statusCode: 403, failureType: 'http_error' };
  }
  if (containsAny(text, ['not_found', 'not found', 'model_not_found'])) {
    return { statusCode: 404, failureType: 'http_error' };
  }

  return { statusCode: 502, failureType: 'http_error' };
}

export function streamErrorMessage(event: StreamErrorEvent): string {
  const message = redactProviderErrorText(event.error.message);
  const code = event.error.code
    ? ` code=${redactProviderErrorText(String(event.error.code))}`
    : '';
  const type = event.error.type
    ? ` type=${redactProviderErrorText(String(event.error.type))}`
    : '';
  return `${message}${code}${type}`;
}

function numericField(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function errorTextForClassification(value: unknown): string {
  const parts: string[] = [];
  collectClassificationText(value, parts, 0);
  return parts.join(' ').toLowerCase();
}

function collectClassificationText(
  value: unknown,
  parts: string[],
  depth: number,
): void {
  if (depth > 4 || parts.length > 100) return;
  if (typeof value === 'string') {
    parts.push(value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    parts.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectClassificationText(item, parts, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (
      key === 'code' ||
      key === 'error' ||
      key === 'message' ||
      key === 'reason' ||
      key === 'type' ||
      key === 'status_code' ||
      key === 'statusCode'
    ) {
      parts.push(key);
      collectClassificationText(nested, parts, depth + 1);
    }
  }
}

function containsAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}
