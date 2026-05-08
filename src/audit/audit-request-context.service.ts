import { AsyncLocalStorage } from 'async_hooks';
import { Injectable } from '@nestjs/common';

export interface AuditRequestContext {
  requestId: string;
  actorType: string;
  actorId: string;
  method: string;
  path: string;
  source: string;
}

@Injectable()
export class AuditRequestContextService {
  private readonly storage = new AsyncLocalStorage<AuditRequestContext>();

  run<T>(context: AuditRequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  current(): AuditRequestContext | null {
    return this.storage.getStore() ?? null;
  }
}
