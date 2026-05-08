import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Request } from 'express';
import type { GatewayApiKeyContext } from '../auth/gateway-api-key.service';
import { WORKSPACE_HEADER } from './workspace.constants';
import { WorkspaceContextService } from './workspace-context.service';
import { WorkspaceService } from './workspace.service';

@Injectable()
export class WorkspaceContextInterceptor implements NestInterceptor {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly context: WorkspaceContextService,
  ) {}

  async intercept(
    executionContext: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = executionContext.switchToHttp().getRequest<Request>();
    const apiKey = (request as unknown as Record<string, unknown>)
      .gatewayApiKey as GatewayApiKeyContext | undefined;
    const requestedWorkspace = apiKey?.workspace_id
      ? apiKey.workspace_id
      : firstStringHeader(request.headers[WORKSPACE_HEADER]) ||
        firstStringHeader(request.headers[WORKSPACE_HEADER.toLowerCase()]) ||
        stringQueryValue(request.query?.workspace_id);
    const workspaceId = await this.workspaces.resolveWorkspaceId(
      requestedWorkspace,
      apiKey?.workspace_id,
    );
    (request as unknown as Record<string, unknown>).workspaceId = workspaceId;
    return new Observable((subscriber) =>
      this.context.run({ workspaceId }, () =>
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        }),
      ),
    );
  }
}

function firstStringHeader(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === 'string') || null;
  }
  return null;
}

function stringQueryValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === 'string') || null;
  }
  return null;
}
