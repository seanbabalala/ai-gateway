import type { LogSinkType } from '../config/gateway.config';

export type LogSinkDeliveryState =
  | 'idle'
  | 'queued'
  | 'sent'
  | 'failed'
  | 'dropped'
  | 'unsupported';

export interface LogSinkRuntimeStatus {
  name: string;
  type: LogSinkType;
  enabled: boolean;
  queued: number;
  delivered: number;
  dropped: number;
  failed_batches: number;
  last_status: LogSinkDeliveryState;
  last_error: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
}

export interface LogSinkBatchPayload {
  version: 'siftgate.call_log_batch.v1';
  events: Record<string, unknown>[];
}
