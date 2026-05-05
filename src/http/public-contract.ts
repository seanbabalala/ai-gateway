import { HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';

export const GATEWAY_REQUEST_ID_HEADER = 'x-siftgate-request-id';
export const LEGACY_REQUEST_ID_HEADER = 'x-request-id';
export const MCP_REQUEST_ID_HEADER = 'x-siftgate-mcp-request-id';

export type PublicErrorProtocol = 'openai' | 'anthropic';

type HeaderWriter = {
  setHeader: (name: string, value: string) => unknown;
};

type JsonResponseWriter = HeaderWriter & {
  status: (statusCode: number) => JsonResponseWriter;
  json: (body: unknown) => unknown;
};

type BodyResponseWriter = JsonResponseWriter & {
  type: (value: string) => BodyResponseWriter;
  send: (body: unknown) => unknown;
};

type ErrorBodyOptions = {
  type?: string;
  code?: string;
  details?: unknown;
  requestId?: string;
};

export function ensureGatewayRequestId(requestId?: string): string {
  if (typeof requestId === 'string' && requestId.trim()) {
    return requestId.trim();
  }
  return randomUUID();
}

export function applyGatewayRequestIdHeaders(
  res: HeaderWriter,
  requestId?: string,
  extraHeaders: string[] = [],
): void {
  if (!requestId) return;
  res.setHeader(GATEWAY_REQUEST_ID_HEADER, requestId);
  res.setHeader(LEGACY_REQUEST_ID_HEADER, requestId);
  for (const header of extraHeaders) {
    res.setHeader(header, requestId);
  }
}

export function extractRequestIdFromHeaders(
  headers: Record<string, unknown>,
): string | undefined {
  return firstHeader(headers, [
    GATEWAY_REQUEST_ID_HEADER,
    LEGACY_REQUEST_ID_HEADER,
    'x-correlation-id',
  ]);
}

export function protocolForPublicPath(
  path: string | undefined,
): PublicErrorProtocol {
  return path?.includes('/v1/messages') ? 'anthropic' : 'openai';
}

export function buildPublicErrorBody(
  protocol: PublicErrorProtocol,
  message: string,
  options: ErrorBodyOptions = {},
): Record<string, unknown> {
  if (protocol === 'anthropic') {
    return anthropicCompatibleError(message, {
      type: options.type || 'api_error',
      details: options.details,
      requestId: options.requestId,
    });
  }
  return openAiCompatibleError(message, {
    type: options.type || 'internal_error',
    code: options.code,
    details: options.details,
    requestId: options.requestId,
  });
}

export function sendPublicErrorResponse(
  res: JsonResponseWriter,
  statusCode: number,
  protocol: PublicErrorProtocol,
  message: string,
  options: ErrorBodyOptions & { extraHeaders?: string[] } = {},
): string {
  const requestId = ensureGatewayRequestId(options.requestId);
  applyGatewayRequestIdHeaders(res, requestId, options.extraHeaders);
  res.status(statusCode).json(
    buildPublicErrorBody(protocol, message, {
      type: options.type,
      code: options.code,
      details: options.details,
      requestId,
    }),
  );
  return requestId;
}

export function sendPublicResponse(
  res: BodyResponseWriter,
  response: {
    statusCode: number;
    body: Record<string, unknown> | Buffer | string;
    contentType?: string;
    requestId?: string;
  },
  extraHeaders: string[] = [],
): void {
  applyGatewayRequestIdHeaders(res, response.requestId, extraHeaders);
  res.status(response.statusCode);
  if (Buffer.isBuffer(response.body)) {
    res.type(response.contentType || 'application/octet-stream').send(response.body);
    return;
  }
  if (response.contentType && !response.contentType.includes('application/json')) {
    res.type(response.contentType).send(response.body);
    return;
  }
  res.json(response.body);
}

export function openAiCompatibleError(
  message: string,
  options: ErrorBodyOptions = {},
): Record<string, unknown> {
  const error: Record<string, unknown> = {
    message,
    type: options.type || 'server_error',
  };
  if (options.code !== undefined) error.code = options.code;
  if (options.details !== undefined) error.details = options.details;
  if (options.requestId) error.request_id = options.requestId;
  return { error };
}

export function anthropicCompatibleError(
  message: string,
  options: ErrorBodyOptions = {},
): Record<string, unknown> {
  const error: Record<string, unknown> = {
    type: options.type || 'api_error',
    message,
  };
  if (options.details !== undefined) error.details = options.details;
  if (options.requestId) error.request_id = options.requestId;
  return {
    type: 'error',
    error,
  };
}

export function genericGatewayError(
  message: string,
  options: ErrorBodyOptions = {},
): Record<string, unknown> {
  return openAiCompatibleError(message, {
    type: options.type || 'internal_error',
    code: options.code,
    details: options.details,
    requestId: options.requestId,
  });
}

export function extractRequestIdFromHttpException(
  error: HttpException,
): string | undefined {
  return extractRequestIdFromBody(error.getResponse());
}

export function normalizeHttpExceptionBody(
  error: HttpException,
  fallbackType = 'internal_error',
): Record<string, unknown> {
  const response = error.getResponse();
  if (typeof response === 'string') {
    return genericGatewayError(response, { type: fallbackType });
  }
  if (isRecord(response)) {
    return response as Record<string, unknown>;
  }
  return genericGatewayError(error.message, { type: fallbackType });
}

export function extractRequestIdFromBody(
  body: unknown,
): string | undefined {
  if (!isRecord(body)) return undefined;
  if (isRecord(body.error) && typeof body.error.request_id === 'string') {
    return body.error.request_id;
  }
  if (typeof body.request_id === 'string') {
    return body.request_id;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstHeader(
  headers: Record<string, unknown>,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}
