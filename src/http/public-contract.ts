import { randomUUID } from 'crypto';

export const GATEWAY_REQUEST_ID_HEADER = 'x-siftgate-request-id';
export const LEGACY_REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_REQUEST_ID_HEADER = 'x-correlation-id';
export const MCP_REQUEST_ID_HEADER = 'x-siftgate-mcp-request-id';

export type PublicErrorProtocol = 'openai' | 'anthropic';

type HeaderWriter = {
  headersSent?: boolean;
  setHeader: (name: string, value: string) => unknown;
};

type JsonResponseWriter = HeaderWriter & {
  status: (statusCode: number) => JsonResponseWriter;
  json?: (body: unknown) => unknown;
  send?: (body: unknown) => unknown;
  type?: (contentType: string) => unknown;
};

export interface PublicResponsePayload {
  statusCode: number;
  body: Record<string, unknown> | Buffer | string;
  contentType?: string;
  requestId?: string;
}

export interface PublicErrorResponseOptions {
  type?: string;
  code?: string;
  details?: unknown;
  requestId?: string;
  extraHeaders?: string[];
}

export function protocolForPublicPath(
  path: string | undefined | null,
): PublicErrorProtocol {
  return path?.startsWith('/v1/messages') ? 'anthropic' : 'openai';
}

export function ensureGatewayRequestId(
  value: string | undefined | null,
): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : randomUUID();
}

export function extractRequestIdFromHeaders(
  headers: Record<string, unknown> | undefined | null,
): string | undefined {
  if (!headers) return undefined;

  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return firstHeaderValue(
    normalized[GATEWAY_REQUEST_ID_HEADER],
    normalized[LEGACY_REQUEST_ID_HEADER],
    normalized[CORRELATION_REQUEST_ID_HEADER],
    normalized[MCP_REQUEST_ID_HEADER],
  );
}

export function extractRequestIdFromBody(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;

  const direct = readString(body, 'request_id') || readString(body, 'requestId');
  if (direct) return direct;

  if (isRecord(body.error)) {
    return (
      readString(body.error, 'request_id') ||
      readString(body.error, 'requestId') ||
      readString(body.error, 'id')
    );
  }

  return undefined;
}

export function sendPublicResponse(
  res: JsonResponseWriter,
  response: PublicResponsePayload,
  extraHeaders: string[] = [],
): string | undefined {
  if (res.headersSent) return undefined;

  const requestId = ensureGatewayRequestId(
    response.requestId || extractRequestIdFromBody(response.body),
  );
  setRequestIdHeaders(res, requestId, extraHeaders);

  if (response.contentType) {
    if (typeof res.type === 'function') {
      res.type(response.contentType);
    } else {
      res.setHeader('content-type', response.contentType);
    }
  }

  const writer = res.status(response.statusCode);
  if (Buffer.isBuffer(response.body) || typeof response.body === 'string') {
    if (typeof writer.send === 'function') {
      writer.send(response.body);
    } else if (typeof writer.json === 'function') {
      writer.json(response.body);
    }
  } else if (typeof writer.json === 'function') {
    writer.json(response.body);
  } else if (typeof writer.send === 'function') {
    writer.send(response.body);
  }

  return requestId;
}

export function sendPublicErrorResponse(
  res: JsonResponseWriter,
  statusCode: number,
  protocol: PublicErrorProtocol,
  message: string,
  options: PublicErrorResponseOptions = {},
): string | undefined {
  if (res.headersSent) return undefined;

  const requestId = ensureGatewayRequestId(options.requestId);
  setRequestIdHeaders(res, requestId, options.extraHeaders || []);

  const type = options.type || defaultErrorType(statusCode);
  const error = {
    message,
    type,
    ...(options.code ? { code: options.code } : {}),
    ...(options.details !== undefined ? { details: options.details } : {}),
    request_id: requestId,
  };

  const body =
    protocol === 'anthropic'
      ? { type: 'error', error }
      : { error };

  const writer = res.status(statusCode);
  if (typeof writer.json === 'function') {
    writer.json(body);
  } else if (typeof writer.send === 'function') {
    writer.send(body);
  }

  return requestId;
}

function setRequestIdHeaders(
  res: HeaderWriter,
  requestId: string,
  extraHeaders: string[],
): void {
  res.setHeader(GATEWAY_REQUEST_ID_HEADER, requestId);
  res.setHeader(LEGACY_REQUEST_ID_HEADER, requestId);
  for (const header of extraHeaders) {
    if (typeof header === 'string' && header.trim().length > 0) {
      res.setHeader(header, requestId);
    }
  }
}

function defaultErrorType(statusCode: number): string {
  switch (statusCode) {
    case 401:
      return 'authentication_error';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 408:
      return 'timeout';
    case 413:
      return 'payload_too_large';
    case 429:
      return 'rate_limit_exceeded';
    default:
      return statusCode >= 500 ? 'internal_error' : 'invalid_request_error';
  }
}

function firstHeaderValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const nested = firstHeaderValue(...value);
      if (nested) return nested;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof value[key] === 'string' && value[key].trim().length > 0
    ? (value[key] as string).trim()
    : undefined;
}
