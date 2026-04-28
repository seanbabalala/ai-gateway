// ===================================================================
// LogEventBus — In-process event bus for real-time log streaming
// ===================================================================
// Decouples PipelineService (producer) from DashboardController (consumer).
// Uses a simple Subject pattern — no external dependencies.
//
// Also forwards log events to the plugin EventBusService so plugins
// can subscribe to 'log' events.
// ===================================================================

import { Injectable, Optional } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { CallLog } from '../database/entities/call-log.entity';
import { EventBusService } from '../plugins/event-bus.service';

@Injectable()
export class LogEventBus {
  private readonly subject = new Subject<CallLog>();

  constructor(
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /** Push a new log event (called by PipelineService after saving) */
  emit(log: CallLog): void {
    this.subject.next(log);
    // Forward to plugin event bus if available
    this.eventBus?.emit('log', log);
  }

  /** Subscribe to log events (used by SSE endpoint) */
  get events$(): Observable<CallLog> {
    return this.subject.asObservable();
  }
}
