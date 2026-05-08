import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { AuditRequestContextService } from './audit-request-context.service';

@Injectable()
export class AuditRequestContextInterceptor implements NestInterceptor {
  constructor(private readonly context: AuditRequestContextService) {}

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = executionContext.switchToHttp().getRequest<
      Request & {
        dashboardUserId?: string;
        gatewayApiKey?: { id?: string };
      }
    >();

    const requestId = firstStringHeader(request.headers['x-request-id'])
      || firstStringHeader(request.headers['x-correlation-id'])
      || randomUUID();

    const actorId =
      request.dashboardUserId ||
      request.gatewayApiKey?.id ||
      'anonymous';
    const actorType = request.dashboardUserId
      ? 'dashboard'
      : request.gatewayApiKey?.id
        ? 'gateway_api_key'
        : 'anonymous';

    return this.context.run(
      {
        requestId,
        actorType,
        actorId,
        method: request.method || 'GET',
        path: request.path || request.url || '',
        source: request.path?.startsWith('/api/dashboard') ? 'dashboard' : 'api',
      },
      () => next.handle(),
    );
  }
}

function firstStringHeader(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === 'string' && item.trim().length > 0) || null;
  }
  return null;
}
