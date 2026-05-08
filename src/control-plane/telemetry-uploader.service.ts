import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { ConfigService } from '../config/config.service';
import { CallLog } from '../database/entities/call-log.entity';
import { ControlPlaneClientService } from './control-plane-client.service';
import type { ControlPlaneTelemetryEvent } from './types';

export interface TelemetryContext {
  domainHint?: string | null;
  modalities?: string[];
  policyHits?: string[];
  cacheHit?: boolean;
}

@Injectable()
export class TelemetryUploaderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryUploaderService.name);
  private readonly maxQueueSize = 5000;
  private queue: ControlPlaneTelemetryEvent[] = [];
  private uploadTimer: NodeJS.Timeout | null = null;
  private uploadIntervalMs = 0;
  private flushInFlight = false;
  private configReloadSub?: Subscription;

  constructor(
    private readonly config: ConfigService,
    private readonly client: ControlPlaneClientService,
  ) {}

  onModuleInit(): void {
    this.syncUploadTimer();
    this.configReloadSub = this.config.onReloadSuccess(() => this.syncUploadTimer());
  }

  onModuleDestroy(): void {
    this.configReloadSub?.unsubscribe();
    this.stopUploadTimer();
  }

  enqueue(log: CallLog, context: TelemetryContext = {}): void {
    if (!this.client.enabled) return;

    const state = this.client.state;
    const event: ControlPlaneTelemetryEvent = {
      workspace_id: state.workspaceId,
      gateway_id: state.gatewayId,
      request_id: log.request_id,
      api_key_id: log.api_key_id || null,
      node_id: log.node_id,
      model: log.model,
      tier: log.tier,
      score: Number(log.score || 0),
      domain_hint: context.domainHint || null,
      modality: context.modalities || [],
      latency_ms: Number(log.latency_ms || 0),
      stream: Boolean(log.stream),
      status_code: Number(log.status_code || 0),
      input_tokens: Number(log.input_tokens || 0),
      output_tokens: Number(log.output_tokens || 0),
      cost_usd: Number(log.cost_usd || 0),
      fallback_used: Boolean(log.is_fallback),
      fallback_reason: log.fallback_reason || null,
      structured_output_requested: Boolean(log.structured_output_requested),
      structured_output_type: log.structured_output_type || null,
      structured_output_strategy: log.structured_output_strategy || null,
      structured_output_supported: log.structured_output_supported ?? null,
      reasoning_requested: Boolean(log.reasoning_requested),
      reasoning_effort: log.reasoning_effort || null,
      reasoning_strategy: log.reasoning_strategy || null,
      reasoning_supported: log.reasoning_supported ?? null,
      media_type: log.media_type || null,
      media_operation: log.media_operation || null,
      media_byte_size: log.media_byte_size ?? null,
      media_provider_content_type: log.media_provider_response_type || null,
      retry_count: Number(log.retry_count || 0),
      cache_hit: context.cacheHit ?? (log.tier === 'cached' || log.node_id === 'cache'),
      policy_hits: context.policyHits || [],
      timestamp: log.timestamp instanceof Date
        ? log.timestamp.toISOString()
        : new Date(log.timestamp || Date.now()).toISOString(),
    };

    this.queue.push(event);
    if (this.queue.length > this.maxQueueSize) {
      this.queue.splice(0, this.queue.length - this.maxQueueSize);
    }
  }

  async flush(): Promise<boolean> {
    if (!this.client.enabled || this.flushInFlight || this.queue.length === 0) {
      return true;
    }

    this.flushInFlight = true;
    const batch = this.queue.splice(0, 200);
    try {
      const uploaded = await this.client.uploadTelemetry(batch);
      if (!uploaded) {
        this.requeue(batch);
      }
      return uploaded;
    } finally {
      this.flushInFlight = false;
    }
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  private requeue(batch: ControlPlaneTelemetryEvent[]): void {
    this.queue = [...batch, ...this.queue].slice(0, this.maxQueueSize);
  }

  private syncUploadTimer(): void {
    if (!this.client.enabled) {
      this.stopUploadTimer();
      return;
    }
    const intervalMs = Math.max(
      5,
      this.config.controlPlane.telemetry.upload_interval_seconds,
    ) * 1000;
    if (this.uploadTimer && this.uploadIntervalMs === intervalMs) {
      return;
    }

    this.stopUploadTimer();
    this.uploadIntervalMs = intervalMs;
    this.uploadTimer = setInterval(() => {
      void this.flush();
    }, intervalMs);
    this.uploadTimer.unref?.();
    this.logger.log(`Control-plane telemetry upload enabled (${intervalMs / 1000}s interval)`);
  }

  private stopUploadTimer(): void {
    if (this.uploadTimer) {
      clearInterval(this.uploadTimer);
      this.uploadTimer = null;
      this.uploadIntervalMs = 0;
      this.logger.log('Control-plane telemetry upload disabled');
    }
  }
}
