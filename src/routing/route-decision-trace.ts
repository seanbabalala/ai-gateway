import type { RouteTarget } from '../config/gateway.config';
import type { Tier } from '../canonical/canonical.types';
import type { EffectiveRoutingStrategy } from './routing.service';

export type RouteDecisionTraceMode =
  | 'auto'
  | 'direct'
  | 'pinned'
  | 'embedding_auto'
  | 'embedding_direct'
  | 'rerank_auto'
  | 'rerank_direct'
  | 'media_auto'
  | 'media_direct'
  | 'cache'
  | 'hook';

export interface RouteDecisionModalityFilterEvidence {
  node: string;
  model: string;
  reason: string;
  missing_capabilities?: string[];
  byte_size?: number | null;
  max_file_size?: number | null;
}

export interface RouteDecisionModalityEvidence {
  requested_modality: string | null;
  input_types: string[];
  output_types: string[];
  file_count: number | null;
  byte_size: number | null;
  required_capabilities: string[];
  endpoint_strategy: string | null;
  filtered_by_capability: RouteDecisionModalityFilterEvidence[];
  filtered_by_file_size: RouteDecisionModalityFilterEvidence[];
}

export interface RouteDecisionCandidateCapabilityEvidence {
  requested_modality: string | null;
  supported_modalities: string[];
  input_types: string[];
  output_types: string[];
  required_capabilities: string[];
  matched_capabilities: string[];
  missing_capabilities: string[];
  endpoint_strategy: string | null;
  endpoint_status: string;
  endpoint: string | null;
  file_count: number | null;
  byte_size: number | null;
  max_file_size: number | null;
  filtered_by_capability: boolean;
  filtered_by_file_size: boolean;
  pricing_source: string | null;
  catalog_source: string | null;
}

export interface RouteDecisionTraceCandidate {
  node: string;
  model: string;
  weight: number | null;
  position: number;
  circuit_state: string;
  circuit_available: boolean;
  selected: boolean;
  fallback: boolean;
  filter_reasons: string[];
  scores: {
    cost: number | null;
    latency: number | null;
    context: number | null;
  };
  metrics: {
    estimated_cost_usd: number | null;
    avg_latency_ms: number | null;
    p95_latency_ms: number | null;
    max_context_tokens: number | null;
    context_fit: 'safe' | 'near_limit' | 'overflow' | 'unknown';
    structured_output: boolean | null;
  };
  capability_evidence?: RouteDecisionCandidateCapabilityEvidence;
}

export interface RouteDecisionTraceFilter {
  node: string;
  model: string;
  stage: string;
  reason: string;
}

export interface RouteDecisionTrace {
  version: 1;
  request_id?: string;
  source_format?: string;
  requested_model?: string | null;
  mode: RouteDecisionTraceMode;
  tier: Tier;
  score: number;
  domain_hints: {
    domain: string | null;
    modalities: string[];
    fast_path?: string | null;
  };
  scoring: {
    tier: Tier;
    score: number;
    momentum_adjusted: boolean;
  };
  constraints: {
    estimated_input_tokens: number | null;
    estimated_output_tokens: number | null;
    estimated_context_tokens: number | null;
    requires_structured_output: boolean;
  };
  modality_evidence?: RouteDecisionModalityEvidence;
  candidate_targets: RouteDecisionTraceCandidate[];
  filters: RouteDecisionTraceFilter[];
  load_balancing: {
    strategy: EffectiveRoutingStrategy | 'direct' | 'embedding' | 'rerank' | 'media' | 'cache' | 'hook';
    source: 'primary_fallback' | 'targets' | 'split' | 'direct' | 'embedding' | 'rerank' | 'media' | 'cache' | 'hook';
    selected: RouteTarget | null;
    target_count: number;
    reason: string;
  };
  fallback_chain: RouteTarget[];
  cost_downgrade?: {
    applied: boolean;
    from: RouteTarget;
    to: RouteTarget;
    reason: string;
  } | null;
  final_selection: {
    node: string | null;
    model: string | null;
    reason: string;
    is_fallback: boolean;
    fallback_reason: string | null;
  };
  outcome?: {
    status_code: number;
    error: string | null;
  };
  privacy: {
    prompt: false;
    response: false;
    raw_headers: false;
    provider_keys: false;
  };
}

export function routeTargetKey(target: RouteTarget): string {
  return `${target.node}:${target.model}`;
}
