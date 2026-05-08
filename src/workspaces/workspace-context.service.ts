import { AsyncLocalStorage } from 'async_hooks';
import { Injectable } from '@nestjs/common';
import { DEFAULT_WORKSPACE_ID } from './workspace.constants';

export interface WorkspaceRequestContext {
  workspaceId: string;
}

@Injectable()
export class WorkspaceContextService {
  private readonly storage = new AsyncLocalStorage<WorkspaceRequestContext>();

  run<T>(context: WorkspaceRequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  currentWorkspaceId(): string {
    return this.storage.getStore()?.workspaceId || DEFAULT_WORKSPACE_ID;
  }
}
