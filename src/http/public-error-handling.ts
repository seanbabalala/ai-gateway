import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { BudgetExceededError } from '../budget/budget.service';
import {
  MCP_REQUEST_ID_HEADER,
  PublicErrorProtocol,
  ensureGatewayRequestId,
  extractRequestIdFromBody,
  extractRequestIdFromHeaders,
  protocolForPublicPath,
  sendPublicErrorResponse,
} from './public-contract';

export { sendPublicResponse } from './public-contract';

type HeaderWriter = {
  headersSent?: boolean;
};

type JsonResponseWriter = HeaderWriter & {
  status: (statusCode: number) => JsonResponseWriter;
  json: (body: unknown) => unknown;
  setHeader: (name: string, value: string) => unknown;
};

export interface PublicGatewayErrorOptions {
  statusCode: number;
  type?: string;
  code?: string;
  details?: unknown;
  requestId?: string;
  protocol?: PublicErrorProtocol;
  extraHeaders?: string[];
}

export interface PublicGatewayMappingOptions {
  fallbackMessage?: string;
  protocol?: PublicErrorProtocol;
  requestId?: string;
  extraHeaders?: string[];
  statusCode?: number;
  type?: string;
  code?: string;
  details?: unknown;
}

export interface MappedPublicGatewayError {
  statusCode: number;
  protocol: PublicErrorProtocol;
  message: string;
  type: string;
  code?: string;
  details?: unknown;
  requestId: string;
  extraHeaders: string[];
}

export class PublicGatewayError extends Error {
  readonly statusCode: number;
  readonly type?: string;
  readonly code?: string;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly protocol?: PublicErrorProtocol;
  readonly extraHeaders?: string[];

  constructor(message: string, options: PublicGatewayErrorOptions) {
    super(message);
    this.name = 'PublicGatewayError';
    this.statusCode = options.statusCode;
    this.type = options.type;
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId;
    this.protocol = options.protocol;
    this.extraHeaders = options.extraHeaders;
  }
}

export function isPublicGatewayPath(path: string | undefined): boolean {
  return Boolean(path && (path.startsWith('/v1') || path.startsWith('/mcp')));
}

export function mapPublicGatewayError(
  exception: unknown,
  request: Pick<Request, 'headers' | 'originalUrl' | 'url'>,
  options: PublicGatewayMappingOptions = {},
): MappedPublicGatewayError {
  const path = request.originalUrl || request.url;
  const routeKind = publicRouteKind(path);
  const protocol = options.protocol || protocolForPublicPath(path);
  const statusCode = options.statusCode ?? resolveStatusCode(exception);
  const extractedBody = extractBodyFromException(exception);
  const requestId = ensureGatewayRequestId(
    options.requestId ||
      extractRequestIdFromException(exception) ||
      extractRequestIdFromBody(extractedBody) ||
      extractRequestIdFromHeaders((request.headers || {}) as Record<string, unknown>),
  );
  const message =
    resolveMessage(exception, extractedBody, statusCode, routeKind, options.fallbackMessage);
  const type = options.type || resolveType(exception, extractedBody, statusCode, routeKind);
  const code = options.code ?? resolveCode(exception, extractedBody);
  const details =
    options.details !== undefined ? options.details : resolveDetails(exception, extractedBody);

  return {
    statusCode,
    protocol,
    message,
    type,
    code,
    details,
    requestId,
    extraHeaders: options.extraHeaders || extraHeadersForRouteKind(routeKind),
  };
}

export function sendMappedPublicErrorResponse(
  res: JsonResponseWriter,
  request: Pick<Request, 'headers' | 'originalUrl' | 'url'>,
  exception: unknown,
  options: PublicGatewayMappingOptions = {},
): string | undefined {
  if (res.headersSent) return undefined;
  const mapped = mapPublicGatewayError(exception, request, options);
  return sendPublicErrorResponse(res, mapped.statusCode, mapped.protocol, mapped.message, {
    type: mapped.type,
    code: mapped.code,
    details: mapped.details,
    requestId: mapped.requestId,
    extraHeaders: mapped.extraHeaders,
  });
}

function publicRouteKind(path: string | undefined): 'openai' | 'anthropic' | 'batch' | 'mcp' | 'video' {
  if (path?.startsWith('/mcp')) return 'mcp';
  if (path?.startsWith('/v1/batches')) return 'batch';
  if (path?.startsWith('/v1/videos')) return 'video';
  if (path?.startsWith('/v1/messages')) return 'anthropic';
  return 'openai';
}

function extraHeadersForRouteKind(
  routeKind: ReturnType<typeof publicRouteKind>,
): string[] {
  return routeKind === 'mcp' ? [MCP_REQUEST_ID_HEADER] : [];
}

function resolveStatusCode(exception: unknown): number {
  if (exception instanceof PublicGatewayError) return exception.statusCode;
  if (exception instanceof BudgetExceededError) return 429;
  if (exception instanceof HttpException) return exception.getStatus();

  const statusCode = firstNumber([
    readNumber(exception, 'statusCode'),
    readNumber(exception, 'status'),
  ]);
  if (statusCode && statusCode >= 400 && statusCode <= 599) {
    return statusCode;
  }
  return 500;
}

function resolveMessage(
  exception: unknown,
  extractedBody: unknown,
  statusCode: number,
  routeKind: ReturnType<typeof publicRouteKind>,
  fallbackMessage?: string,
): string {
  if (exception instanceof BudgetExceededError) {
    return exception.message;
  }
  const bodyMessage = extractMessageFromBody(extractedBody);
  if (bodyMessage) return bodyMessage;
  if (isPayloadTooLargeError(exception)) {
    return 'Request body is too large.';
  }
  if (isJsonParseError(exception)) {
    return 'Request body is not valid JSON.';
  }
  if (
    fallbackMessage &&
    statusCode >= 500 &&
    !(exception instanceof PublicGatewayError) &&
    !(exception instanceof HttpException)
  ) {
    return fallbackMessage;
  }
  if (exception instanceof Error && exception.message.trim()) {
    return exception.message;
  }
  if (routeKind === 'batch' && statusCode >= 500) {
    return 'Batch proxy request failed.';
  }
  if (routeKind === 'mcp' && statusCode >= 500) {
    return 'MCP proxy request failed.';
  }
  if (statusCode === 404) {
    return 'Resource not found.';
  }
  return 'Gateway request failed.';
}

function resolveType(
  exception: unknown,
  extractedBody: unknown,
  statusCode: number,
  routeKind: ReturnType<typeof publicRouteKind>,
): string {
  if (exception instanceof PublicGatewayError && exception.type) {
    return exception.type;
  }
  if (exception instanceof BudgetExceededError) {
    return 'budget_exceeded';
  }
  const bodyType = extractTypeFromBody(extractedBody);
  if (bodyType) return bodyType;
  if (isPayloadTooLargeError(exception)) return 'payload_too_large';
  if (isJsonParseError(exception)) return 'invalid_request_error';

  switch (statusCode) {
    case 400:
      return 'invalid_request_error';
    case 401:
      return 'authentication_error';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 405:
      return 'method_not_allowed';
    case 408:
      return 'timeout';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    case 422:
      return 'invalid_request_error';
    case 429:
      return 'rate_limit_exceeded';
    case 502:
    case 503:
    case 504:
      if (routeKind === 'batch') return 'batch_proxy_error';
      if (routeKind === 'mcp') return 'mcp_proxy_error';
      if (routeKind === 'video') return 'video_proxy_error';
      return 'upstream_error';
    default:
      break;
  }

  if (statusCode >= 500) {
    if (routeKind === 'batch') return 'batch_proxy_error';
    if (routeKind === 'mcp') return 'mcp_proxy_error';
    if (routeKind === 'video') return 'video_proxy_error';
    return 'internal_error';
  }

  return 'invalid_request_error';
}

function resolveCode(
  exception: unknown,
  extractedBody: unknown,
): string | undefined {
  if (exception instanceof PublicGatewayError && exception.code) {
    return exception.code;
  }
  if (exception instanceof BudgetExceededError) {
    return exception.budgetType;
  }
  return extractCodeFromBody(extractedBody);
}

function resolveDetails(exception: unknown, extractedBody: unknown): unknown {
  if (exception instanceof PublicGatewayError && exception.details !== undefined) {
    return exception.details;
  }
  if (exception instanceof BudgetExceededError) {
    return exception.toDetails();
  }
  const bodyDetails = extractDetailsFromBody(extractedBody);
  if (bodyDetails !== undefined) return bodyDetails;

  if (isRecord(exception)) {
    if (exception.details !== undefined) return exception.details;
    const details: Record<string, unknown> = {};
    if (typeof exception.type === 'string') details.source_type = exception.type;
    if (typeof exception.expose === 'boolean') details.expose = exception.expose;
    if (typeof exception.limit === 'number') details.limit = exception.limit;
    if (typeof exception.length === 'number') details.length = exception.length;
    if (typeof exception.expected === 'number') details.expected = exception.expected;
    if (typeof exception.received === 'number') details.received = exception.received;
    return Object.keys(details).length ? details : undefined;
  }

  return undefined;
}

function extractBodyFromException(exception: unknown): unknown {
  if (exception instanceof HttpException) {
    return exception.getResponse();
  }
  if (exception instanceof PublicGatewayError) {
    return undefined;
  }
  if (isRecord(exception) && exception.body !== undefined) {
    return exception.body;
  }
  return undefined;
}

function extractRequestIdFromException(exception: unknown): string | undefined {
  if (exception instanceof PublicGatewayError) {
    return exception.requestId;
  }
  if (exception instanceof HttpException) {
    return extractRequestIdFromBody(exception.getResponse());
  }
  if (!isRecord(exception)) return undefined;
  if (typeof exception.requestId === 'string') return exception.requestId;
  if (typeof exception.request_id === 'string') return exception.request_id;
  return undefined;
}

function extractMessageFromBody(body: unknown): string | undefined {
  if (typeof body === 'string' && body.trim()) return body;
  if (!isRecord(body)) return undefined;
  if (isRecord(body.error) && typeof body.error.message === 'string') {
    return body.error.message;
  }
  if (typeof body.message === 'string') {
    return body.message;
  }
  return undefined;
}

function extractTypeFromBody(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (isRecord(body.error) && typeof body.error.type === 'string') {
    return body.error.type;
  }
  if (typeof body.type === 'string' && body.type !== 'error') {
    return body.type;
  }
  return undefined;
}

function extractCodeFromBody(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (isRecord(body.error) && typeof body.error.code === 'string') {
    return body.error.code;
  }
  if (typeof body.code === 'string') {
    return body.code;
  }
  return undefined;
}

function extractDetailsFromBody(body: unknown): unknown {
  if (!isRecord(body)) return undefined;
  if (isRecord(body.error) && body.error.details !== undefined) {
    return body.error.details;
  }
  if (body.details !== undefined) {
    return body.details;
  }
  return undefined;
}

function isPayloadTooLargeError(exception: unknown): boolean {
  return (
    resolveStatusCode(exception) === 413 ||
    readString(exception, 'type') === 'entity.too.large'
  );
}

function isJsonParseError(exception: unknown): boolean {
  return (
    resolveStatusCode(exception) === 400 &&
    (readString(exception, 'type') === 'entity.parse.failed' ||
      exception instanceof SyntaxError)
  );
}

function readString(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  return isRecord(value) && typeof value[key] === 'number' ? value[key] : undefined;
}

function firstNumber(values: Array<number | undefined>): number | undefined {
  return values.find((value) => typeof value === 'number');
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
