import type { CanonicalRequestMetadata } from '../canonical.types';

export function normalizeRequestIdentityHeaders(
  headers: Record<string, string>,
): Pick<CanonicalRequestMetadata, 'session_id' | 'session_key' | 'trace_id'> {
  const sessionId = firstHeader(headers, [
    'x-session-id',
    'x-session-key',
    'x-siftgate-session-id',
    'session-id',
  ]);
  const traceId =
    firstHeader(headers, ['x-trace-id', 'x-siftgate-trace-id']) ||
    traceIdFromTraceparent(firstHeader(headers, ['traceparent'])) ||
    firstHeader(headers, ['x-siftgate-request-id', 'x-request-id', 'request-id']);

  return {
    session_id: sessionId,
    session_key: sessionId,
    trace_id: traceId,
  };
}

function firstHeader(
  headers: Record<string, string>,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = headers[name] || headers[name.toLowerCase()];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function traceIdFromTraceparent(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parts = value.trim().split('-');
  const traceId = parts[1];
  if (traceId && /^[a-f0-9]{32}$/i.test(traceId)) {
    return traceId.toLowerCase();
  }
  return undefined;
}
