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
  pricing_confidence?: string | null;
  pricing_stale?: boolean | null;
  pricing_used_from?: string;
  missing_price_units?: string[];
  estimated_cost_basis?: string | null;
  catalog_source: string | null;
}

export interface RouteDecisionCacheEvidence {
  local_prompt_cache_eligible: boolean;
  local_prompt_cache_hit: boolean;
  local_prompt_cache_lookup: 'hit' | 'miss' | 'disabled' | 'skipped' | null;
  provider_prompt_cache: boolean;
  provider_read_cache: boolean;
  provider_write_cache: boolean;
  supports_cache?: boolean;
  cache_type?: string | null;
  cache_min_tokens?: number | null;
  cache_read_discount?: number | null;
  observed_cache_hit_rate: number | null;
  observed_cache_read_tokens: number;
  observed_cache_creation_tokens: number;
  input_price_per_mtok: number | null;
  cache_read_price_per_mtok: number | null;
  cache_write_price_per_mtok: number | null;
  estimated_base_cost_usd: number | null;
  estimated_cache_adjusted_cost_usd: number | null;
  estimated_cache_savings_usd: number | null;
  cache_score: number | null;
  cache_affinity_active?: boolean;
  cache_affinity_reason?: string | null;
  cache_affinity_bonus?: number | null;
  provider_cache_ttl_seconds?: number | null;
  time_since_last_cache_hit_seconds?: number | null;
  estimated_cache_hit_probability?: number | null;
  reason: string;
}

export interface RouteDecisionCompatibilityEvidence {
  provider_id: string | null;
  compatibility_profile: string[];
  endpoint_strategy: string | null;
  protocol_strategy: string | null;
  passthrough_fields: string[];
  downgraded_fields: string[];
  unsupported_fields: string[];
  selected_reason: string;
  filtered_by_profile_reason: string | null;
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
    cache?: number | null;
  };
  metrics: {
    estimated_cost_usd: number | null;
    avg_latency_ms: number | null;
    p95_latency_ms: number | null;
    max_context_tokens: number | null;
    context_fit: 'safe' | 'near_limit' | 'overflow' | 'unknown';
    structured_output: boolean | null;
    reasoning?: boolean | null;
    provider_cache_hit_rate?: number | null;
    estimated_cache_savings_usd?: number | null;
  };
  capability_evidence?: RouteDecisionCandidateCapabilityEvidence;
  cache_evidence?: RouteDecisionCacheEvidence;
  compatibility_evidence?: RouteDecisionCompatibilityEvidence;
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
  session_id?: string | null;
  trace_id?: string | null;
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
    requires_reasoning?: boolean;
    reasoning_effort?: string | null;
    reasoning_budget_tokens?: number | null;
    reasoning_strategy?: string | null;
    local_prompt_cache_eligible?: boolean;
    local_prompt_cache_hit?: boolean;
    local_prompt_cache_lookup?: 'hit' | 'miss' | 'disabled' | 'skipped' | null;
    semantic_cache_enabled?: boolean;
    semantic_cache_match?: boolean;
    semantic_cache_hit?: boolean;
    semantic_cache_score?: number | null;
    semantic_cache_threshold?: number | null;
    semantic_cache_metadata_only?: boolean;
    semantic_cache_reason?: string | null;
  };
  modality_evidence?: RouteDecisionModalityEvidence;
  cache_evidence?: {
    local_prompt_cache_eligible: boolean;
    local_prompt_cache_hit: boolean;
    local_prompt_cache_lookup: 'hit' | 'miss' | 'disabled' | 'skipped' | null;
    semantic_cache_enabled?: boolean;
    semantic_cache_match?: boolean;
    semantic_cache_hit?: boolean;
    semantic_cache_score?: number | null;
    semantic_cache_threshold?: number | null;
    semantic_cache_metadata_only?: boolean;
    semantic_cache_reason?: string | null;
    cache_aware_routing: boolean;
    provider_cache_preference: boolean;
    notes: string[];
  };
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
