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

export type RequestActivityPhase =
  | 'routed'
  | 'streaming'
  | 'completed'
  | 'failed';

/**
 * Privacy-preserving request lifecycle metadata for lightweight live clients.
 * Prompt/response bodies, raw headers, keys, tool payloads, and provider
 * secrets must never be added to this contract.
 */
export interface RequestActivityEvent {
  request_id: string;
  phase: RequestActivityPhase;
  timestamp: string;
  workspace_id: string;
  source_format: string;
  stream: boolean;
  node_id: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  status_code: number | null;
  estimated_usage?: boolean;
  is_fallback?: boolean;
  fallback_reason?: string | null;
  first_token_latency_ms?: number | null;
  tokens_per_second?: number | null;
}

export interface RequestActivityPerformance {
  firstTokenLatencyMs?: number | null;
  tokensPerSecond?: number | null;
}

@Injectable()
export class LogEventBus {
  private readonly subject = new Subject<CallLog>();
  private readonly activitySubject = new Subject<RequestActivityEvent>();

  constructor(
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /** Push a new log event (called by PipelineService after saving) */
  emit(log: CallLog, performance: RequestActivityPerformance = {}): void {
    const outputTokens = Number(log.output_tokens || 0);
    const latencyMs = Number(log.latency_ms || 0);
    const tokensPerSecond = performance.tokensPerSecond === undefined
      ? outputTokens > 0 && latencyMs > 0
        ? Number((outputTokens / (latencyMs / 1000)).toFixed(1))
        : null
      : performance.tokensPerSecond;
    this.emitActivity({
      request_id: log.request_id,
      phase:
        log.status_code >= 200 && log.status_code < 400 && !log.error
          ? 'completed'
          : 'failed',
      timestamp: (log.timestamp || new Date()).toISOString(),
      workspace_id: log.workspace_id || 'default',
      source_format: log.source_format,
      stream: Boolean(log.stream),
      node_id: log.node_id,
      model: log.model,
      input_tokens: Number(log.input_tokens || 0),
      output_tokens: outputTokens,
      cost_usd: Number(log.cost_usd || 0),
      latency_ms: latencyMs,
      status_code: Number(log.status_code || 0),
      estimated_usage: false,
      is_fallback: Boolean(log.is_fallback),
      fallback_reason: log.fallback_reason || null,
      first_token_latency_ms: performance.firstTokenLatencyMs ?? null,
      tokens_per_second: tokensPerSecond,
    });
    // Lifecycle clients de-duplicate terminal events by request id. Publish the
    // richer activity payload first so they retain stream-only performance
    // fields before the backward-compatible full log event arrives.
    this.subject.next(log);
    // Forward to plugin event bus if available
    this.eventBus?.emit('log', log);
  }

  /** Push metadata-only request lifecycle updates for live surfaces. */
  emitActivity(event: RequestActivityEvent): void {
    this.activitySubject.next(event);
  }

  /** Subscribe to log events (used by SSE endpoint) */
  get events$(): Observable<CallLog> {
    return this.subject.asObservable();
  }

  /** Subscribe to request lifecycle updates (used by the Dashboard SSE endpoint). */
  get activityEvents$(): Observable<RequestActivityEvent> {
    return this.activitySubject.asObservable();
  }
}
