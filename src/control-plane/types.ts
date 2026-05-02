import type { Tier } from '../canonical/canonical.types';

export interface ControlPlaneRegistrationResponse {
  workspace_id?: string;
  gateway_id?: string;
  access_token?: string;
}

export interface PolicyBundle {
  version: number;
  workspace_id?: string;
  gateway_id?: string;
  mode?: 'recommendation' | 'enforced' | 'recommendation_or_enforced' | string;
  routing?: Record<string, unknown>;
  budgets?: Record<string, unknown>;
  rate_limits?: Record<string, unknown>;
  api_key_policies?: Record<string, unknown>;
  emergency_overrides?: unknown[];
  created_at?: string;
  expires_at?: string;
}

export interface ControlPlaneTelemetryEvent {
  workspace_id: string | null;
  gateway_id: string;
  request_id: string;
  api_key_id: string | null;
  node_id: string;
  model: string;
  tier: Tier | string;
  score: number;
  domain_hint: string | null;
  modality: string[];
  latency_ms: number;
  status_code: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  fallback_used: boolean;
  retry_count: number;
  cache_hit: boolean;
  policy_hits: string[];
  timestamp: string;
}
