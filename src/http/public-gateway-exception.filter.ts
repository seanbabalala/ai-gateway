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

    if (mapped.statusCode >= 500) {
      this.logger.error(logLine);
    } else if (!(exception instanceof HttpException && mapped.statusCode < 500)) {
      this.logger.warn(logLine);
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
}
