import type { Request } from 'express';
import type { GatewayApiKeyContext } from '../auth/gateway-api-key.service';
import type { BatchJob } from '../database/entities';

export type BatchOperation = 'create' | 'retrieve' | 'cancel' | 'output';

export interface BatchRequestContext {
  requestId: string;
  operation: BatchOperation;
  apiKey?: GatewayApiKeyContext;
  headers: Record<string, string>;
  startedAt: number;
  session_id?: string;
  trace_id?: string;
  client_source?: string;
}

export interface BatchProxyResponse {
  statusCode: number;
  contentType: string;
  body: Record<string, unknown> | Buffer | string;
  headers?: Record<string, string>;
  requestId: string;
  nodeId: string;
  model: string;
  endpoint: string | null;
  providerBatchId?: string | null;
  status?: string | null;
  error?: string | null;
}

export interface BatchProviderResponse {
  statusCode: number;
  contentType: string;
  body: Record<string, unknown> | Buffer | string;
  headers: Record<string, string>;
  latencyMs: number;
}

export interface BatchTarget {
  nodeId: string;
  model: string;
  endpoint: string | null;
}

export interface BatchCreateInput {
  req: Request;
  body: Record<string, unknown>;
  context: BatchRequestContext;
}

export interface BatchExistingJobInput {
  id: string;
  req: Request;
  context: BatchRequestContext;
}

export interface BatchDownloadInput extends BatchExistingJobInput {
  fileKind: 'output' | 'error';
}

export interface BatchDashboardItem {
  id: number;
  request_id: string;
  provider_batch_id: string | null;
  node_id: string;
  model: string;
  endpoint: string | null;
  input_file_id: string | null;
  output_file_id: string | null;
  error_file_id: string | null;
  completion_window: string | null;
  metadata_keys: string[];
  request_counts: {
    total: number;
    completed: number;
    failed: number;
  };
  api_key_id: string | null;
  api_key_name: string | null;
  namespace_id: string | null;
  namespace_name: string | null;
  status: string;
  error: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BatchDashboardResponse {
  metadata_only: true;
  items: BatchDashboardItem[];
  totals: {
    total: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  filters: {
    period: string;
    status: string | null;
    node: string | null;
    namespace: string | null;
    api_key_id: string | null;
  };
}

export function batchDashboardItem(job: BatchJob): BatchDashboardItem {
  return {
    id: job.id,
    request_id: job.request_id,
    provider_batch_id: job.provider_batch_id,
    node_id: job.node_id,
    model: job.model,
    endpoint: job.endpoint,
    input_file_id: job.input_file_id,
    output_file_id: job.output_file_id,
    error_file_id: job.error_file_id,
    completion_window: job.completion_window,
    metadata_keys: parseMetadataKeys(job.metadata_keys_json),
    request_counts: {
      total: job.request_counts_total,
      completed: job.request_counts_completed,
      failed: job.request_counts_failed,
    },
    api_key_id: job.api_key_id,
    api_key_name: job.api_key_name,
    namespace_id: job.namespace_id,
    namespace_name: job.namespace_name,
    status: job.status,
    error: job.error,
    expires_at: job.expires_at,
    created_at: job.created_at.toISOString(),
    updated_at: job.updated_at.toISOString(),
  };
}

function parseMetadataKeys(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}
