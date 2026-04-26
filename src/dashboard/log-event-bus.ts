// ===================================================================
// LogEventBus — In-process event bus for real-time log streaming
// ===================================================================
// Decouples PipelineService (producer) from DashboardController (consumer).
// Uses a simple Subject pattern — no external dependencies.
// ===================================================================

import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { CallLog } from '../database/entities/call-log.entity';

@Injectable()
export class LogEventBus {
  private readonly subject = new Subject<CallLog>();

  /** Push a new log event (called by PipelineService after saving) */
  emit(log: CallLog): void {
    this.subject.next(log);
  }

  /** Subscribe to log events (used by SSE endpoint) */
  get events$(): Observable<CallLog> {
    return this.subject.asObservable();
  }
}
