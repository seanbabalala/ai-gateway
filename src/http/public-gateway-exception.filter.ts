import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  isPublicGatewayPath,
  mapPublicGatewayError,
} from './public-error-handling';
import { sendPublicErrorResponse } from './public-contract';

@Catch()
export class PublicGatewayExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(PublicGatewayExceptionFilter.name);

  constructor(adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      super.catch(exception as Error, host);
      return;
    }

    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const path = request?.originalUrl || request?.url;

    if (!isPublicGatewayPath(path)) {
      super.catch(exception as Error, host);
      return;
    }

    if (response.headersSent) {
      super.catch(exception as Error, host);
      return;
    }

    const mapped = mapPublicGatewayError(exception, request);
    const logLine = `${request.method} ${path} -> ${mapped.statusCode} ${mapped.type} (${mapped.requestId}) ${mapped.message}`;
    const userAgent =
      this.firstHeader(request.headers['user-agent']) || '<none>';
    const contentType =
      this.firstHeader(request.headers['content-type']) || '<none>';
    const diagnosticSuffix = `ua="${userAgent}" content-type="${contentType}"`;

    if (mapped.statusCode >= 500) {
      this.logger.error(`${logLine} ${diagnosticSuffix}`);
    } else if (
      mapped.statusCode === 404 ||
      !(exception instanceof HttpException && mapped.statusCode < 500)
    ) {
      this.logger.warn(`${logLine} ${diagnosticSuffix}`);
      if (mapped.statusCode === 404) {
        this.logger.warn(
          `404 diagnostics ${this.formatRequestDiagnostics(request)}`,
        );
      }
    }

    sendPublicErrorResponse(
      response,
      mapped.statusCode,
      mapped.protocol,
      mapped.message,
      {
        type: mapped.type,
        code: mapped.code,
        details: mapped.details,
        requestId: mapped.requestId,
        extraHeaders: mapped.extraHeaders,
      },
    );
  }

  private firstHeader(
    value: string | string[] | undefined,
  ): string | undefined {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.find((item) => item.trim().length > 0);
    }
    return undefined;
  }

  private formatRequestDiagnostics(request: Request): string {
    const req = request as Request & {
      body?: unknown;
      baseUrl?: string;
      path?: string;
      route?: unknown;
    };
    const auth = this.firstHeader(request.headers['authorization']);
    const xApiKey = this.firstHeader(request.headers['x-api-key']);
    const anthropicBeta = this.firstHeader(request.headers['anthropic-beta']);
    const accept = this.firstHeader(request.headers['accept']);
    const contentLength = this.firstHeader(request.headers['content-length']);
    const transferEncoding = this.firstHeader(
      request.headers['transfer-encoding'],
    );
    const body = this.summarizeBody(req.body);
    const url = request.url || '';
    const originalUrl = request.originalUrl || '';
    const path = req.path || '';

    return JSON.stringify({
      method: request.method,
      url,
      originalUrl,
      path,
      baseUrl: req.baseUrl || '',
      hasRoute: Boolean(req.route),
      urlCodes: this.charCodes(url),
      originalUrlCodes: this.charCodes(originalUrl),
      pathCodes: this.charCodes(path),
      headers: {
        authorization: auth ? 'present' : 'missing',
        xApiKey: xApiKey ? 'present' : 'missing',
        anthropicBeta: anthropicBeta || null,
        accept: accept || null,
        contentType: this.firstHeader(request.headers['content-type']) || null,
        contentLength: contentLength || null,
        transferEncoding: transferEncoding || null,
      },
      body,
    });
  }

  private summarizeBody(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object') {
      return { kind: typeof body };
    }
    const record = body as Record<string, unknown>;
    const messages = Array.isArray(record.messages)
      ? record.messages.length
      : undefined;
    const input = Array.isArray(record.input)
      ? record.input.length
      : typeof record.input;

    return {
      model: typeof record.model === 'string' ? record.model : null,
      stream: typeof record.stream === 'boolean' ? record.stream : null,
      messageCount: messages,
      input,
    };
  }

  private charCodes(value: string): number[] {
    return Array.from(value).map((char) => char.charCodeAt(0));
  }
}
