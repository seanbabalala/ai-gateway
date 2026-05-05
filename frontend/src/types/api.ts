// ── Stats ──

export interface StatsTotal {
  calls: number
  success: number
  failed: number
  successRate: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  avgLatencyMs: number
  uniqueSessions: number
}

export interface TierDistribution {
  tier: string
  count: number
}

export interface NodeDistribution {
  nodeId: string
  count: number
  avgLatencyMs: number
}

export interface StatsResponse {
  total: StatsTotal
  last24h: {
    calls: number
    costUsd: number
    tokens: number
  }
  tierDistribution: TierDistribution[]
  nodeDistribution: NodeDistribution[]
}

// ── MCP Gateway Preview ──

export interface McpToolSummary {
  name: string
  description: string | null
  has_input_schema: boolean
}

export interface McpServerSummary {
  id: string
  name: string
  description: string | null
  enabled: boolean
  transport: string
  endpoint: string
  allowed_namespaces: string[]
  tools: McpToolSummary[]
  tags: string[]
  recent_calls: number
  recent_errors: number
  last_called_at: string | null
}

export interface McpAuditEntry {
  id: string
  timestamp: string
  server_id: string
  server_name: string
  method: string
  tool_name: string | null
  batch_size: number
  api_key_id: string | null
  api_key_name: string | null
  namespace_id: string | null
  status_code: number
  success: boolean
  latency_ms: number
  error_type: string | null
  request_bytes: number
}

export interface McpErrorSummary {
  server_id: string
  error_type: string
  count: number
  last_seen_at: string
}

export interface McpGatewayResponse {
  enabled: boolean
  path: string
  metadata_only: boolean
  servers: McpServerSummary[]
  recent_calls: McpAuditEntry[]
  error_summary: McpErrorSummary[]
  totals: {
    servers: number
    enabled_servers: number
    tools: number
    recent_calls: number
    recent_errors: number
  }
}

// ── Logs ──

export interface CallLog {
  id: number
  request_id: string
  timestamp: string
  source_format: string
  tier: string
  score: number
  node_id: string
  model: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  latency_ms: number
  status_code: number
  is_fallback: boolean
  fallback_reason: string | null
  retry_count?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  semantic_cache_hit?: boolean
  semantic_cache_score?: number | null
  experiment_group?: string | null
  structured_output_requested?: boolean
  structured_output_type?: string | null
  structured_output_strategy?: string | null
  structured_output_supported?: boolean | null
  structured_output_schema_name?: string | null
  reasoning_requested?: boolean
  reasoning_effort?: string | null
  reasoning_strategy?: string | null
  reasoning_supported?: boolean | null
  reasoning_budget_tokens?: number | null
  reasoning_source?: string | null
  reasoning_reason?: string | null
  media_type?: string | null
  media_operation?: string | null
  media_multipart?: boolean | null
  media_file_count?: number | null
  media_byte_size?: number | null
  media_requested_format?: string | null
  media_response_format?: string | null
  media_provider_response_type?: string | null
  session_id?: string | null
  session_key: string | null
  trace_id?: string | null
  error: string | null
  api_key_id?: string | null
  api_key_name?: string | null
  namespace_id?: string | null
}

export interface LogsPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface LogsResponse {
  data: CallLog[]
  pagination: LogsPagination
}

// ── Route Decisions ──

export interface RouteDecisionTarget {
  node: string
  model: string
}

export interface RouteDecisionCandidate {
  node: string
  model: string
  weight: number | null
  position: number
  circuit_state: string
  circuit_available: boolean
  selected: boolean
  fallback: boolean
  filter_reasons: string[]
  scores: {
    cost: number | null
    latency: number | null
    context: number | null
    cache?: number | null
  }
  metrics: {
    estimated_cost_usd: number | null
    avg_latency_ms: number | null
    p95_latency_ms: number | null
    max_context_tokens: number | null
    context_fit: 'safe' | 'near_limit' | 'overflow' | 'unknown'
    structured_output: boolean | null
    reasoning?: boolean | null
    provider_cache_hit_rate?: number | null
    estimated_cache_savings_usd?: number | null
  }
  capability_evidence?: {
    requested_modality: string | null
    supported_modalities: string[]
    input_types: string[]
    output_types: string[]
    required_capabilities: string[]
    matched_capabilities: string[]
    missing_capabilities: string[]
    endpoint_strategy: string | null
    endpoint_status: string
    endpoint: string | null
    file_count: number | null
    byte_size: number | null
    max_file_size: number | null
    filtered_by_capability: boolean
    filtered_by_file_size: boolean
    pricing_source: string | null
    pricing_confidence?: string | null
    pricing_stale?: boolean | null
    pricing_used_from?: string
    missing_price_units?: string[]
    estimated_cost_basis?: string | null
    catalog_source: string | null
  }
  cache_evidence?: {
    local_prompt_cache_eligible: boolean
    local_prompt_cache_hit: boolean
    local_prompt_cache_lookup: 'hit' | 'miss' | 'disabled' | 'skipped' | null
    provider_prompt_cache: boolean
    provider_read_cache: boolean
    provider_write_cache: boolean
    observed_cache_hit_rate: number | null
    observed_cache_read_tokens: number
    observed_cache_creation_tokens: number
    input_price_per_mtok: number | null
    cache_read_price_per_mtok: number | null
    cache_write_price_per_mtok: number | null
    estimated_base_cost_usd: number | null
    estimated_cache_adjusted_cost_usd: number | null
    estimated_cache_savings_usd: number | null
    cache_score: number | null
    reason: string
  }
  compatibility_evidence?: RouteDecisionCompatibilityEvidence
}

export interface RouteDecisionCompatibilityEvidence {
  provider_id: string | null
  compatibility_profile: string[]
  endpoint_strategy: string | null
  protocol_strategy: string | null
  passthrough_fields: string[]
  downgraded_fields: string[]
  unsupported_fields: string[]
  selected_reason: string
  filtered_by_profile_reason: string | null
}

export interface RouteDecisionFilter {
  node: string
  model: string
  stage: string
  reason: string
}

export interface RouteDecisionTrace {
  version: 1
  request_id?: string
  session_id?: string | null
  trace_id?: string | null
  source_format?: string
  requested_model?: string | null
  mode: string
  tier: string
  score: number
  domain_hints: {
    domain: string | null
    modalities: string[]
    fast_path?: string | null
  }
  scoring: {
    tier: string
    score: number
    momentum_adjusted: boolean
  }
  constraints: {
    estimated_input_tokens: number | null
    estimated_output_tokens: number | null
    estimated_context_tokens: number | null
    requires_structured_output: boolean
    requires_reasoning?: boolean
    reasoning_effort?: string | null
    reasoning_budget_tokens?: number | null
    reasoning_strategy?: string | null
    local_prompt_cache_eligible?: boolean
    local_prompt_cache_hit?: boolean
    local_prompt_cache_lookup?: 'hit' | 'miss' | 'disabled' | 'skipped' | null
  }
  modality_evidence?: {
    requested_modality: string | null
    input_types: string[]
    output_types: string[]
    file_count: number | null
    byte_size: number | null
    required_capabilities: string[]
    endpoint_strategy: string | null
    filtered_by_capability: Array<{
      node: string
      model: string
      reason: string
      missing_capabilities?: string[]
      byte_size?: number | null
      max_file_size?: number | null
    }>
    filtered_by_file_size: Array<{
      node: string
      model: string
      reason: string
      missing_capabilities?: string[]
      byte_size?: number | null
      max_file_size?: number | null
    }>
  }
  cache_evidence?: {
    local_prompt_cache_eligible: boolean
    local_prompt_cache_hit: boolean
    local_prompt_cache_lookup: 'hit' | 'miss' | 'disabled' | 'skipped' | null
    semantic_cache_enabled?: boolean
    semantic_cache_match?: boolean
    semantic_cache_hit?: boolean
    semantic_cache_score?: number | null
    semantic_cache_threshold?: number | null
    semantic_cache_metadata_only?: boolean
    semantic_cache_reason?: string | null
    cache_aware_routing: boolean
    provider_cache_preference: boolean
    notes: string[]
  }
  candidate_targets: RouteDecisionCandidate[]
  filters: RouteDecisionFilter[]
  load_balancing: {
    strategy: string
    source: string
    selected: RouteDecisionTarget | null
    target_count: number
    reason: string
  }
  fallback_chain: RouteDecisionTarget[]
  cost_downgrade?: {
    applied: boolean
    from: RouteDecisionTarget
    to: RouteDecisionTarget
    reason: string
  } | null
  final_selection: {
    node: string | null
    model: string | null
    reason: string | null
    is_fallback: boolean
    fallback_reason: string | null
  }
  outcome?: {
    status_code: number
    error: string | null
  }
  privacy: {
    prompt: false
    response: false
    raw_headers: false
    provider_keys: false
  }
}

export interface RouteDecisionSummary {
  id: number
  request_id: string
  timestamp: string
  source_format: string
  tier: string
  score: number
  route_mode: string | null
  strategy: string | null
  selected: RouteDecisionTarget
  final_selection: RouteDecisionTrace['final_selection']
  domain_hint: string | null
  candidate_count: number
  filtered_count: number
  status_code: number
  is_fallback: boolean
  fallback_reason: string | null
  session_id?: string | null
  trace_id?: string | null
  api_key_name: string | null
  api_key_id: string | null
  namespace_id: string | null
  summary: {
    reason: string | null
    fallback_chain: RouteDecisionTarget[]
    filters: RouteDecisionFilter[]
    compatibility?: RouteDecisionCompatibilityEvidence | null
    privacy: RouteDecisionTrace['privacy']
  }
  trace?: RouteDecisionTrace | null
}

export interface RouteDecisionsResponse {
  data: RouteDecisionSummary[]
  pagination: LogsPagination
}

// ── Sessions / Trace View ──

export interface SessionSummary {
  session_id: string
  first_seen_at: string | null
  last_seen_at: string | null
  request_count: number
  error_count: number
  fallback_count: number
  model_switch_count: number
  total_cost_usd: number
  total_tokens: number
  avg_latency_ms: number
  models: string[]
  nodes: string[]
  source_formats: string[]
  trace_ids: string[]
  latest_request_id: string | null
  latest_trace_id: string | null
  latest_status_code: number | null
  api_key_id: string | null
  api_key_name: string | null
  namespace_id: string | null
}

export interface SessionTimelineEvent {
  request_id: string
  session_id: string | null
  trace_id: string | null
  timestamp: string
  source_format: string
  tier: string
  score: number
  node_id: string
  model: string
  status_code: number
  latency_ms: number
  cost_usd: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  is_fallback: boolean
  fallback_reason: string | null
  error: string | null
  route_decision_link: string | null
  has_route_decision: boolean
  route_decision: {
    id: number
    selected_node_id: string | null
    selected_model: string | null
    candidate_count: number
    filtered_count: number
    route_mode: string | null
    strategy: string | null
    final_reason: string | null
  } | null
  shadow: {
    count: number
    statuses: Record<string, number>
    nodes: string[]
    models: string[]
    avg_latency_ms: number | null
  }
  guardrails: {
    count: number
    kinds: string[]
    actions: string[]
    rules: string[]
  }
}

export interface SessionPrivacy {
  prompt: false
  response: false
  raw_headers: false
  provider_keys: false
  media_bytes: false
  video_bytes: false
  storage: 'metadata_only'
}

export interface SessionsResponse {
  data: SessionSummary[]
  pagination: LogsPagination
  filters: Record<string, string | null>
  privacy: SessionPrivacy
}

export interface SessionDetailResponse {
  session_id: string
  summary: SessionSummary
  timeline: SessionTimelineEvent[]
  filters: Record<string, string | null>
  links: {
    route_decisions: number
    shadow_results: number
    guardrails_findings: number
  }
  privacy: SessionPrivacy
}

// ── Budget ──

export interface BudgetRule {
  id: number
  type: string
  scope: 'global' | 'api_key' | 'namespace'
  apiKeyName: string | null
  apiKeyId: string | null
  namespaceId: string | null
  limit: number
  current: number
  percentage: number
  exceeded: boolean
  alert: boolean
  periodStart: string
  resetAt: string | null
}

export interface BudgetResponse {
  rules: BudgetRule[]
}

// ── Nodes ──

export interface CircuitBreaker {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  consecutiveFailures: number
  lastFailureAt: string | null
}

export interface ConcurrencySnapshot {
  node: string
  model?: string
  max_concurrency: number | null
  queue_timeout_ms: number
  queue_policy: 'wait' | 'fallback' | 'reject'
  active: number
  queued: number
}

export interface RealtimeNodeStatus {
  enabled: boolean
  experimental: true
  supported: boolean
  endpoint: string | null
  models: string[]
  active_connections: number
  max_connections_per_node: number
  last_connected_at: string | null
  last_closed_at: string | null
  last_error: string | null
}

export type ProviderCompatibilityCapability =
  | 'chat'
  | 'responses'
  | 'messages'
  | 'embeddings'
  | 'rerank'
  | 'images'
  | 'audio'
  | 'video'
  | 'realtime'
  | 'batch'

export type ProviderCompatibilityStatus = 'pass' | 'warning' | 'fail' | 'skipped'

export interface ProviderCompatibilityMatrixItem {
  capability: ProviderCompatibilityCapability
  configured: boolean
  tested: boolean
  last_status: ProviderCompatibilityStatus | null
  last_checked_at: string | null
  failure_reason: string | null
  latency_ms: number | null
  status_code: number | null
  test_mode: string | null
  requires_confirmation: boolean
  compatibility_profiles?: string[]
  profile_supported?: boolean
}

export interface NodeInfo {
  id: string
  name: string
  protocol: 'chat_completions' | 'responses' | 'messages'
  base_url: string
  endpoint: string
  endpoints?: Record<string, string>
  models: string[]
  embeddings_endpoint?: string | null
  embedding_models?: string[]
  rerank_endpoint?: string | null
  rerank_models?: string[]
  images_generations_endpoint?: string | null
  images_edits_endpoint?: string | null
  images_variations_endpoint?: string | null
  image_models?: string[]
  audio_transcriptions_endpoint?: string | null
  audio_translations_endpoint?: string | null
  audio_speech_endpoint?: string | null
  audio_models?: string[]
  video_generations_endpoint?: string | null
  video_endpoint?: string | null
  video_status_endpoint?: string | null
  video_content_endpoint?: string | null
  video_cancel_endpoint?: string | null
  video_models?: string[]
  batch_endpoint?: string | null
  batch_status_endpoint?: string | null
  batch_cancel_endpoint?: string | null
  batch_result_endpoint?: string | null
  compatibility_profile?: string[]
  resolved_compatibility_profiles?: string[]
  realtime_endpoint?: string | null
  realtime_models?: string[]
  capabilities: string[]
  modalities: string[]
  model_capabilities?: Record<string, ModelCapabilityInfo>
  tags: string[]
  aliases: Record<string, string>
  model_prefixes: string[]
  circuit: CircuitBreaker
  modelCircuits: Record<string, CircuitBreaker>
  concurrency: ConcurrencySnapshot
  realtime?: RealtimeNodeStatus
  compatibility_matrix?: ProviderCompatibilityMatrixItem[]
  healthy: boolean
}

export interface ModelCapabilityInfo {
  modalities: string[]
  endpoints?: Record<string, string>
  input_types?: string[]
  output_types?: string[]
  max_file_size?: number
  supports_streaming?: boolean
  supports_realtime?: boolean
  supports_rerank?: boolean
  supports_reasoning?: boolean | null
  max_context_tokens?: number
  structured_output: boolean | null
  dimensions?: number | number[]
  pricing?: ModelPricing
  quality_score?: number
}

export type ConfigDiagnosticCode =
  | 'duplicate_model_id'
  | 'model_id_matches_node_id'
  | 'alias_conflicts_with_model_id'
  | 'alias_matches_node_id'
  | 'duplicate_alias'
  | 'duplicate_model_prefix'
  | 'missing_model_pricing'
  | 'route_references_unknown_node'
  | 'route_references_unknown_model'
  | 'split_overrides_targets'
  | 'provider_compatibility_failed'
  | 'provider_compatibility_untested'

export interface ConfigDiagnostic {
  severity: 'warning'
  code: ConfigDiagnosticCode
  message: string
  nodes: string[]
  model?: string
  alias?: string
  matchingNodes?: string[]
  tier?: string
  target?: string
  capability?: string
}

export interface NodesResponse {
  nodes: NodeInfo[]
  diagnostics: ConfigDiagnostic[]
}

// ── Health ──

export interface HealthNodeStatus {
  id: string
  name: string
  protocol: string
  circuit: string
  consecutiveFailures: number
  lastFailureAt: string | null
  healthy: boolean
  concurrency: ConcurrencySnapshot
  realtime?: RealtimeNodeStatus
}

export interface HealthBudgetStatus {
  type: string
  current: number
  limit: number
  percentage: number
  exceeded: boolean
  alert: boolean
}

export interface HealthResponse {
  status: 'healthy' | 'degraded'
  uptime_ms: number
  uptime_human: string
  timestamp: string
  nodes: HealthNodeStatus[]
  budget: HealthBudgetStatus[]
}

// ── Alerts ──

export type AlertEventType =
  | 'budget_threshold'
  | 'budget_exceeded'
  | 'node_down'
  | 'node_recovered'
  | 'circuit_open'
  | 'circuit_close'
  | 'error_spike'
  | 'latency_spike'

export type AlertDeliveryState = 'queued' | 'sent' | 'failed' | 'debounced'

export interface AlertDeliveryStatus {
  id: string
  event: AlertEventType
  severity: 'info' | 'warning' | 'critical'
  channel: string
  status: AlertDeliveryState
  attempts: number
  timestamp: string
  message: string
  dedupe_key: string | null
  last_error: string | null
  sent_at: string | null
}

export interface AlertChannelStatus {
  name: string
  type: 'webhook'
  events: AlertEventType[]
  last_status: AlertDeliveryState | null
  last_error: string | null
  last_event: AlertEventType | null
  last_sent_at: string | null
}

export interface AlertsResponse {
  enabled: boolean
  configured_channels: number
  channels: AlertChannelStatus[]
  recent: AlertDeliveryStatus[]
}

// ── Guardrails ──

export type GuardrailAction = 'audit' | 'redact' | 'block' | 'allow' | 'webhook'
export type GuardrailDeliveryState = 'queued' | 'sent' | 'failed' | 'debounced' | 'dropped'

export interface GuardrailFindingSummary {
  request_id?: string
  direction: 'input' | 'output'
  kind: string
  rule: string
  action: GuardrailAction
  severity: 'low' | 'medium' | 'high'
  path: string
  category?: string
  match_count?: number
  message?: string
}

export interface GuardrailsWebhookStatus {
  id: string
  status: GuardrailDeliveryState
  attempts: number
  timestamp: string
  finding_count: number
  rules: string[]
  actions: string[]
  last_error: string | null
  sent_at: string | null
}

export interface GuardrailsResponse {
  enabled: boolean
  mode: 'audit' | 'redact' | 'block'
  rules: {
    total: number
    by_kind: Record<string, number>
    by_action: Record<string, number>
    schema: {
      input_enabled: boolean
      output_enabled: boolean
      input_strict: boolean
      output_strict: boolean
    }
  }
  findings: {
    total: number
    by_kind: Record<string, number>
    by_action: Record<string, number>
    last_seen_at: string | null
    recent: GuardrailFindingSummary[]
  }
  webhook: {
    enabled: boolean
    configured: boolean
    queue_depth: number
    max_queue: number
    drop_policy: 'drop_newest' | 'drop_oldest'
    dropped: number
    last_status: GuardrailDeliveryState | null
    last_error: string | null
    last_sent_at: string | null
    recent: GuardrailsWebhookStatus[]
  }
  privacy: {
    prompt: false
    response: false
    raw_headers: false
    provider_keys: false
    media_bytes: false
  }
}

// ── Config ──

export interface SplitVariant {
  node: string
  model: string
  weight: number
  name?: string
}

export type LoadBalancingStrategy = 'weighted' | 'round_robin' | 'least_latency' | 'random'
export type RoutingOptimization = 'cost' | 'latency' | 'balanced' | 'quality'

export interface WeightedRouteTarget {
  node: string
  model: string
  weight?: number
  name?: string
}

export interface TierRoute {
  primary?: { node: string; model: string }
  fallbacks?: { node: string; model: string }[]
  strategy?: LoadBalancingStrategy
  targets?: WeightedRouteTarget[]
  split?: SplitVariant[]
}

export interface RoutingTargetMetrics {
  node: string
  model: string
  weight: number | null
  samples: number
  avg_latency_ms: number | null
  p95_latency_ms: number | null
  last_latency_ms: number | null
  last_status_code: number | null
}

export interface RoutingTierStatus {
  strategy: LoadBalancingStrategy | RoutingOptimization | 'primary_fallback' | 'split'
  source: 'primary_fallback' | 'targets' | 'split'
  targets: RoutingTargetMetrics[]
  last_selected: {
    node: string
    model: string
    selected_at: string
    strategy: LoadBalancingStrategy | RoutingOptimization | 'primary_fallback' | 'split'
    reason: string
  } | null
}

export interface RoutingConfig {
  tiers: Record<string, TierRoute>
  scoring: {
    simple_max: number
    standard_max: number
    complex_max: number
  }
  domain_preferences: Record<string, string[]>
}

export interface ModelPricing {
  input: number
  output: number
  cache_creation_input?: number
  cache_read_input?: number
}

export interface ConfigResponse {
  server: { port: number; host: string }
  database: { type: string }
  auth: { api_keys: { name: string; key: string }[]; managed_in_dashboard?: boolean }
  nodes: {
    id: string
    name: string
    protocol: string
    base_url: string
    models: string[]
    embedding_models?: string[]
    rerank_models?: string[]
    image_models?: string[]
    audio_models?: string[]
    video_models?: string[]
    realtime_models?: string[]
    model_capabilities?: Record<string, ModelCapabilityInfo>
    tags: string[]
    api_key: string
  }[]
  routing: RoutingConfig
  routing_status?: Record<string, RoutingTierStatus>
  budget: {
    daily_token_limit: number
    daily_cost_limit: number
    alert_threshold: number
  }
  namespaces?: NamespaceInfo[]
  shadow?: ShadowTrafficStatus
  config_audit?: {
    enabled: boolean
    max_versions: number
    max_events: number
    capture_startup_snapshot: boolean
    storage: string
    secrets: string
  }
  models_pricing: Record<string, ModelPricing>
  diagnostics: ConfigDiagnostic[]
}

// ── Config Audit / Rollback ──

export interface ConfigAuditPrivacy {
  local_only: boolean
  prompt_response_stored: boolean
  raw_headers_stored: boolean
  provider_keys_stored_in_audit: boolean
  provider_keys_exposed_by_api: boolean
  snapshot_storage: string
}

export interface ConfigVersionSummary {
  id: number
  version_id: string
  created_at: string
  created_by: string
  source: 'dashboard' | 'cli' | 'reload' | 'rollback' | 'system'
  checksum: string
  config_path: string
  runtime_version: number
  node_count: number
  node_ids: string[]
  route_tiers: string[]
  sanitized_summary: Record<string, unknown>
}

export interface ConfigVersionDetail extends ConfigVersionSummary {
  sanitized_config: unknown
  privacy: ConfigAuditPrivacy
}

export interface ConfigVersionsResponse {
  data: ConfigVersionSummary[]
  pagination: { limit: number; count: number }
  privacy: ConfigAuditPrivacy
}

export interface ConfigAuditEvent {
  id: number
  event_id: string
  timestamp: string
  actor: string
  action: string
  target: string
  before_summary: Record<string, unknown>
  after_summary: Record<string, unknown>
  result: 'success' | 'failure'
  failure_reason: string | null
  source: string | null
  version_id: string | null
  previous_version_id: string | null
  metadata: Record<string, unknown>
}

export interface ConfigAuditEventsResponse {
  data: ConfigAuditEvent[]
  pagination: { limit: number; count: number }
  privacy: ConfigAuditPrivacy
}

export interface ConfigRollbackResponse extends ActionResponse {
  target_version: ConfigVersionSummary
  previous_version: ConfigVersionSummary | null
  restored_version: ConfigVersionSummary | null
  reload: unknown
}

// ── SSE Events ──

export type SSEEvent =
  | { type: 'connected'; timestamp: string }
  | { type: 'log'; log: CallLog }
  | { type: 'heartbeat'; timestamp: string }

// ── Cost Analytics ──

export interface CostAnalyticsDailyTrend {
  date: string
  calls: number
  cost: number
  inputTokens: number
  outputTokens: number
}

export interface CostAnalyticsGroupItem {
  model?: string
  nodeId?: string
  tier?: string
  calls: number
  cost: number
  inputTokens: number
  outputTokens: number
  avgLatency?: number
  avgCostPerCall?: number
}

export interface CostAnalyticsResponse {
  period: number
  total: {
    calls: number
    cost: number
    inputTokens: number
    outputTokens: number
    avgCostPerCall: number
  }
  dailyTrend: CostAnalyticsDailyTrend[]
  byModel: CostAnalyticsGroupItem[]
  byNode: CostAnalyticsGroupItem[]
  byTier: CostAnalyticsGroupItem[]
}

// ── Benchmark Report ──

export type BenchmarkCheckStatus = 'pass' | 'warn' | 'fail'

export interface BenchmarkLatencySummary {
  avg_ms: number
  p50_ms: number
  p75_ms: number
  p95_ms: number
  p99_ms: number
  max_ms: number
}

export interface BenchmarkThroughputEstimate {
  requests_per_minute: number
  requests_per_second: number
  period_requests_per_minute: number
  basis: 'observed_active_window'
}

export interface BenchmarkCostSummary {
  total_usd: number
  avg_usd_per_request: number
}

export interface BenchmarkTokenSummary {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  avg_tokens_per_request: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export interface BenchmarkCacheSummary {
  local_prompt_cache_hits: number
  local_prompt_cache_hit_rate: number
  provider_cache_read_hits: number
  provider_cache_hit_rate: number
  provider_cache_creation_hits: number
  cache_aware_requests: number
  cache_aware_request_rate: number
  cache_read_token_ratio: number
}

export interface BenchmarkMetrics {
  calls: number
  total_requests: number
  success: number
  failed: number
  success_rate: number
  error_rate: number
  fallback_rate: number
  cache_hit_rate: number
  cache_miss_rate: number
  total_cost_usd: number
  avg_cost_usd: number
  total_tokens: number
  avg_tokens: number
  throughput_rpm: number
  period_rpm: number
  throughput: BenchmarkThroughputEstimate
  cost_summary: BenchmarkCostSummary
  token_summary: BenchmarkTokenSummary
  cache_summary: BenchmarkCacheSummary
  latency_ms: BenchmarkLatencySummary
}

export interface BenchmarkCatalogEvidence {
  known_model: boolean
  provider: string | null
  modalities: string[]
  pricing_source: string | null
  pricing_confidence?: string | null
  pricing_stale?: boolean | null
  pricing_used_from?: string | null
  catalog_source: string | null
}

export interface BenchmarkCheck {
  check: 'sample_size' | 'success_rate' | 'p95_latency' | 'p99_latency' | 'fallback_rate'
  status: BenchmarkCheckStatus
  value: number
  actual: string
  target: string
}

export interface BenchmarkGroup extends BenchmarkMetrics {
  node_id: string
  model: string
  source_formats: string[]
  status: BenchmarkCheckStatus
  catalog: BenchmarkCatalogEvidence
}

export interface BenchmarkStatusBucket {
  status_code: number
  calls: number
  rate: number
}

export interface BenchmarkErrorBucket {
  error: string
  calls: number
}

export interface BenchmarkReportResponse {
  generated_at: string
  period: '1h' | '24h' | '7d' | '30d' | '90d'
  window: {
    requested_since: string
    observed_start: string | null
    observed_end: string | null
    active_minutes: number
    sample_limit: number
    truncated: boolean
  }
  filters: {
    api_key: string | null
    api_key_id: string | null
    namespace: string | null
    node: string | null
    model: string | null
    source_format: string | null
  }
  summary: BenchmarkMetrics
  checks: BenchmarkCheck[]
  by_node_model: BenchmarkGroup[]
  by_source_format: Array<BenchmarkMetrics & { source_format: string; source_family: string }>
  by_source_family: Array<BenchmarkMetrics & { source_family: string }>
  status_breakdown: BenchmarkStatusBucket[]
  top_errors: BenchmarkErrorBucket[]
  route_trace_coverage: {
    matched_requests: number
    coverage_rate: number
  }
  comparison_guidance: Array<{
    target: string
    purpose: string
    method: string
  }>
  methodology: {
    source: 'call_logs'
    synthetic_run_script: string
    direct_baseline_required: boolean
    notes: string[]
  }
  privacy: {
    prompt_response_stored: false
    raw_headers_stored: false
    provider_keys_exposed: false
    media_bytes_stored: false
    metadata_only: true
  }
}

// ── Batch Jobs ──

export interface BatchDashboardItem {
  id: number
  request_id: string
  provider_batch_id: string | null
  node_id: string
  model: string
  endpoint: string | null
  input_file_id: string | null
  output_file_id: string | null
  error_file_id: string | null
  completion_window: string | null
  metadata_keys: string[]
  request_counts: {
    total: number
    completed: number
    failed: number
  }
  api_key_id: string | null
  api_key_name: string | null
  namespace_id: string | null
  namespace_name: string | null
  status: string
  error: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface BatchDashboardResponse {
  metadata_only: true
  items: BatchDashboardItem[]
  totals: {
    total: number
    active: number
    completed: number
    failed: number
    cancelled: number
  }
  filters: {
    period: string
    status: string | null
    node: string | null
    namespace: string | null
    api_key_id: string | null
  }
}

// ── Evaluation Reports ──

export type EvalRunStatus = 'queued' | 'running' | 'completed' | 'failed'
export type EvalWinner = 'primary' | 'candidate' | 'tie' | null

export interface EvalTargetReport {
  node_id: string | null
  model: string
  success_rate: number
  avg_latency_ms: number
  total_cost_usd: number
  fallback_rate: number
}

export interface EvalRunSummary {
  id: string
  dataset_id: string | null
  dataset_name: string
  status: EvalRunStatus
  sample_count: number
  primary: EvalTargetReport
  candidate: EvalTargetReport
  judge: {
    node_id: string | null
    model: string | null
    avg_score: number | null
  }
  winner: EvalWinner
  summary: {
    success_delta?: number
    latency_delta_ms?: number
    cost_delta_usd?: number
    fallback_delta?: number
    judge_sample_coverage?: number
    [key: string]: unknown
  }
  privacy: EvalPrivacy
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface EvalPrivacy {
  prompt_response_stored: boolean
  sample_previews_stored: boolean
  raw_headers_stored: false
  provider_keys_exposed: false
  metadata_only: boolean
  requires_explicit_sample_storage: true
}

export interface EvalReportsResponse {
  generated_at: string
  metadata_only: true
  filters: {
    period: string
    status: string | null
    dataset_id: string | null
  }
  totals: {
    runs: number
    completed: number
    failed: number
    samples: number
    avg_judge_score: number | null
  }
  items: EvalRunSummary[]
  privacy: EvalPrivacy
}

export interface EvalSampleSummary {
  id: number
  sample_id: string | null
  sample_hash: string
  request_ids: {
    primary: string | null
    candidate: string | null
    judge: string | null
  }
  primary: {
    status_code: number | null
    success: boolean
    latency_ms: number
    cost_usd: number
    fallback: boolean
  }
  candidate: {
    status_code: number | null
    success: boolean
    latency_ms: number
    cost_usd: number
    fallback: boolean
  }
  judge: {
    score: number | null
    label: string | null
    reason_summary: string | null
  }
  error_type: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface EvalReportDetailResponse {
  generated_at: string
  metadata_only: true
  run: EvalRunSummary & {
    judge_config: Record<string, unknown>
  }
  samples: EvalSampleSummary[]
  privacy: EvalPrivacy
}

// ── Dashboard Playground ──

export type PlaygroundEndpoint =
  | 'chat_completions'
  | 'responses'
  | 'messages'
  | 'embeddings'
  | 'rerank'
  | 'images'
  | 'audio'
  | 'video'
  | 'realtime'

export type PlaygroundOperation =
  | PlaygroundEndpoint
  | 'image_generation'
  | 'image_edit'
  | 'image_variation'
  | 'audio_speech'
  | 'audio_transcription'
  | 'audio_translation'
  | 'video_generation'
  | 'realtime_probe'

export interface PlaygroundRunRequest {
  endpoint: PlaygroundEndpoint
  operation?: PlaygroundOperation
  model: string
  api_key_id?: string | null
  namespace_id?: string | null
  routing_hint?: unknown
  stream?: boolean
  body?: Record<string, unknown>
}

export interface PlaygroundRunResponse {
  success: boolean
  endpoint: PlaygroundEndpoint
  operation: PlaygroundOperation
  stream: boolean
  request: {
    method: string
    path: string
    model: string
    api_key_id: string | null
    namespace_id: string | null
    routing_hint: unknown
    body_preview: string
  }
  response_summary: {
    status_code: number
    content_type: string
    body_type: 'json' | 'text' | 'sse' | 'binary'
    body_preview: string
    bytes: number
    event_count: number
    truncated: boolean
  }
  usage: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
  cost_usd: number
  latency_ms: number
  status_code: number
  route_decision: {
    request_id: string
    link: string
    available: boolean
  } | null
  privacy: {
    prompt_response_stored: false
    raw_headers_stored: false
    provider_keys_exposed: false
    media_bytes_stored: false
    standard_call_log_metadata: boolean
  }
}

// ── Cache ──

export interface CacheStats {
  enabled: boolean
  entries: number
  maxEntries: number
  hits: number
  misses: number
  hitRate: number
  totalSizeBytes: number
  memoryMb: number
}

// ── Mutation Responses ──

export interface ActionResponse {
  success: boolean
  message: string
}

// ── Node CRUD ──

export interface CreateNodeRequest {
  id: string
  name: string
  protocol: 'chat_completions' | 'responses' | 'messages'
  base_url: string
  endpoint: string
  api_key: string
  models: string[]
  embeddings_endpoint?: string
  embedding_models?: string[]
  rerank_endpoint?: string
  rerank_models?: string[]
  images_generations_endpoint?: string
  images_edits_endpoint?: string
  images_variations_endpoint?: string
  image_models?: string[]
  audio_transcriptions_endpoint?: string
  audio_translations_endpoint?: string
  audio_speech_endpoint?: string
  audio_models?: string[]
  video_generations_endpoint?: string
  video_status_endpoint?: string
  video_models?: string[]
  realtime_models?: string[]
  realtime_endpoint?: string
  video_endpoint?: string
  video_content_endpoint?: string
  video_cancel_endpoint?: string
  batch_endpoint?: string
  batch_status_endpoint?: string
  batch_cancel_endpoint?: string
  batch_result_endpoint?: string
  timeout_ms: number
  max_concurrency?: number
  queue_timeout_ms?: number
  queue_policy?: 'wait' | 'fallback' | 'reject'
  capabilities?: string[]
  modalities?: string[]
  tags?: string[]
  model_aliases?: Record<string, string>
  model_prefixes?: string[]
  headers?: Record<string, string>
  model_capabilities?: Record<string, Partial<ModelCapabilityInfo>>
  auth_type?: 'bearer' | 'x-api-key'
  health_check?: HealthCheckRequest
  compatibility_profile?: string[]
}

export interface UpdateNodeRequest {
  name?: string
  protocol?: 'chat_completions' | 'responses' | 'messages'
  base_url?: string
  endpoint?: string
  api_key?: string
  models?: string[]
  embeddings_endpoint?: string
  embedding_models?: string[]
  rerank_endpoint?: string
  rerank_models?: string[]
  images_generations_endpoint?: string
  images_edits_endpoint?: string
  images_variations_endpoint?: string
  image_models?: string[]
  audio_transcriptions_endpoint?: string
  audio_translations_endpoint?: string
  audio_speech_endpoint?: string
  audio_models?: string[]
  video_generations_endpoint?: string
  video_status_endpoint?: string
  video_models?: string[]
  realtime_models?: string[]
  realtime_endpoint?: string
  video_endpoint?: string
  video_content_endpoint?: string
  video_cancel_endpoint?: string
  batch_endpoint?: string
  batch_status_endpoint?: string
  batch_cancel_endpoint?: string
  batch_result_endpoint?: string
  timeout_ms?: number
  max_concurrency?: number
  queue_timeout_ms?: number
  queue_policy?: 'wait' | 'fallback' | 'reject'
  capabilities?: string[]
  modalities?: string[]
  tags?: string[]
  model_aliases?: Record<string, string>
  model_prefixes?: string[]
  headers?: Record<string, string>
  model_capabilities?: Record<string, Partial<ModelCapabilityInfo>>
  auth_type?: 'bearer' | 'x-api-key'
  health_check?: HealthCheckRequest
  compatibility_profile?: string[]
}

export interface HealthCheckRequest {
  enabled?: boolean
  interval_seconds?: number
  timeout_ms?: number
  method?: 'HEAD' | 'GET' | 'POST'
  path?: string
  lightweight_model?: string
}

export interface TestNodeRequest {
  protocol: 'chat_completions' | 'responses' | 'messages'
  base_url: string
  endpoint: string
  api_key: string
  model: string
  auth_type?: 'bearer' | 'x-api-key'
  headers?: Record<string, string>
  capabilities?: ProviderCompatibilityCapability[]
  confirm_expensive?: boolean
}

export interface TestNodeResponse {
  success: boolean
  status: number
  latency_ms: number
  message: string
  matrix?: ProviderCompatibilityMatrixItem[]
}

// ── Provider / Model Catalog ──

export type CatalogModality =
  | 'text'
  | 'vision'
  | 'image'
  | 'audio'
  | 'video'
  | 'embedding'
  | 'rerank'
  | 'realtime'
  | 'batch'
  | 'mcp'

export type CatalogEndpoint =
  | 'chat_completions'
  | 'responses'
  | 'messages'
  | 'embeddings'
  | 'image_generations'
  | 'image_edits'
  | 'audio_transcriptions'
  | 'audio_speech'
  | 'video_generations'
  | 'video_status'
  | 'video_content'
  | 'video_cancel'
  | 'rerank'
  | 'realtime'
  | 'batch'
  | 'mcp'

export type CatalogAuthType =
  | 'bearer'
  | 'x-api-key'
  | 'api-key-header'
  | 'query-key'
  | 'none'
  | 'custom'

export interface CatalogPricing {
  input?: number | null
  output?: number | null
  image?: number | null
  audio?: number | null
  video?: number | null
  rerank?: number | null
  embedding?: number | null
  cache_read_input?: number | null
  cache_creation_input?: number | null
  billing_unit?: string
  input_per_1m_tokens?: number | null
  output_per_1m_tokens?: number | null
  cache_read_per_1m_tokens?: number | null
  cache_write_per_1m_tokens?: number | null
  embedding_per_1m_tokens?: number | null
  rerank_per_1k_requests?: number | null
  rerank_per_1k_docs?: number | null
  image_per_generation?: number | null
  image_per_edit?: number | null
  audio_per_minute?: number | null
  audio_per_1m_chars?: number | null
  video_per_second?: number | null
  video_per_generation?: number | null
  realtime_per_minute?: number | null
  batch_discount?: number | null
  unit?: string
  units?: Partial<Record<string, string>>
  currency?: string
  source_type?: 'official_docs' | 'provider_api' | 'aggregator_api' | 'operator_override' | 'docs_review' | 'unknown'
  source: string
  source_url?: string
  last_updated: string
  last_sync?: string
  retrieved_at?: string
  last_verified_at?: string
  manual_review_required: boolean
  review_reason?: string
  stale_after_days?: number
  pricing_confidence?: 'high' | 'medium' | 'low' | 'unknown'
  notes?: string
}

export interface CatalogPricingHygiene {
  status: 'fresh' | 'stale' | 'placeholder' | 'review_required' | 'missing' | 'invalid'
  currency: string | null
  source_type?: 'official_docs' | 'provider_api' | 'aggregator_api' | 'operator_override' | 'docs_review' | 'unknown' | null
  source: string | null
  source_url?: string | null
  manual_review_required: boolean
  review_reason?: string | null
  pricing_confidence: 'high' | 'medium' | 'low' | 'unknown' | null
  last_updated: string | null
  last_verified_at?: string | null
  retrieved_at?: string | null
  age_days: number | null
  stale_after_days: number | null
  stale: boolean
  placeholder: boolean
  review_required?: boolean
  source_missing?: boolean
  source_url_missing?: boolean
  missing_price_dimensions: string[]
  unit_mismatches: string[]
  warnings: string[]
}

export interface CatalogModel {
  id: string
  name?: string
  display_name?: string
  provider?: string
  provider_id: string
  modalities: CatalogModality[]
  endpoints: CatalogEndpoint[]
  input_types: string[]
  output_types: string[]
  capabilities: string[]
  limits?: {
    max_context_tokens?: number
    max_output_tokens?: number
    max_file_size?: number
    dimensions?: number[]
  }
  pricing: CatalogPricing
  pricing_hygiene?: CatalogPricingHygiene
  structured_output?: boolean
  supports_streaming?: boolean
  supports_realtime?: boolean
  supports_rerank?: boolean
  manual_review_required?: boolean
  source?: 'builtin' | 'sync_cache' | 'override'
  overridden?: boolean
  synced?: boolean
  notes?: string
}

export type CatalogProviderFamily =
  | 'foundation'
  | 'aggregators'
  | 'cloud'
  | 'china'
  | 'self_hosted'
  | 'image_video'
  | 'speech_audio'
  | 'embedding_rerank'

export type CatalogProviderType =
  | 'direct'
  | 'aggregator'
  | 'cloud'
  | 'self_hosted'
  | 'media'
  | 'speech'
  | 'local'
  | 'custom'
  | 'compatible'

export type CatalogCompatibilityProfile =
  | 'native'
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'google-compatible'
  | 'local'
  | 'custom'

export interface CatalogProviderModelBuckets {
  models: string[]
  embedding_models: string[]
  rerank_models: string[]
  image_models: string[]
  audio_models: string[]
  video_models: string[]
  realtime_models: string[]
  batch_models?: string[]
}

export interface CatalogProvider {
  id: string
  provider_id?: string
  name: string
  display_name?: string
  description?: string
  base_url: string
  base_url_matchers: string[]
  protocols: Array<'chat_completions' | 'responses' | 'messages'>
  default_protocol: 'chat_completions' | 'responses' | 'messages'
  endpoints: Partial<Record<CatalogEndpoint, string>>
  compatibility_profiles?: string[]
  auth_type: CatalogAuthType
  key_placeholder?: string
  modalities: CatalogModality[]
  input_types?: string[]
  output_types?: string[]
  capabilities: string[]
  pricing: CatalogPricing
  pricing_hygiene?: CatalogPricingHygiene
  aliases?: string[]
  family?: CatalogProviderFamily
  category?: CatalogProviderFamily | string
  provider_type?: CatalogProviderType
  compatibility_profile?: CatalogCompatibilityProfile | string
  logo_id?: string
  homepage_url?: string | null
  docs_url?: string | null
  pricing_url?: string | null
  model_buckets?: CatalogProviderModelBuckets
  limits?: {
    model_count?: number
    max_context_tokens?: number | null
    max_file_size?: number | null
  }
  pricing_units?: Record<string, string>
  model_prefixes?: string[]
  tags?: string[]
  allows_unknown_models?: boolean
  manual_review_required?: boolean
  source?: 'builtin' | 'sync_cache' | 'override'
  overridden?: boolean
  synced?: boolean
  models: CatalogModel[]
}

export interface ProviderCompatibilityProfile {
  profile_id: string
  display_name: string
  protocol_family: string
  request_style: string
  response_style: string
  auth_strategy: string
  endpoint_strategy: string
  streaming_strategy: string
  multipart_strategy: string
  async_job_strategy: string
  supported_source_formats: string[]
  supported_modalities: string[]
  passthrough_fields: string[]
  downgraded_fields: string[]
  unsupported_fields: string[]
  known_limitations: string[]
}

export interface CatalogSyncStatus {
  enabled: boolean
  scheduled: boolean
  write_to: 'cache' | 'override'
  interval_minutes: number
  run_on_startup: boolean
  cache_file: string
  cache_found: boolean
  override_file: string
  override_found: boolean
  supported_adapters: string[]
  enabled_adapters: string[]
  providers: Array<{
    provider: string
    label: string
    enabled: boolean
    supported: boolean
    automatic: boolean
    status: 'disabled' | 'fresh' | 'stale' | 'never_synced' | 'manual_only' | 'unsupported' | 'failed' | 'synced'
    last_sync: string | null
    source_url: string
    confidence: string | null
    stale: boolean
    stale_after_days: number | null
    age_days: number | null
    last_error: string | null
  }>
  issues: Array<{ severity: string; code: string; message: string; path?: string }>
}

export interface CatalogProvidersResponse {
  version: string
  source: 'builtin_static'
  last_updated: string
  auto_update: boolean
  refresh_sources?: Array<{
    provider: string
    label: string
    mode: 'public_api' | 'authenticated_api' | 'docs_review' | 'operator_local'
    source_url: string
    automatic: boolean
    pricing: 'live' | 'docs_only' | 'operator_required'
    notes: string
  }>
  sync_status?: CatalogSyncStatus
  override_file?: string
  override_found?: boolean
  sync_cache_file?: string
  sync_cache_found?: boolean
  issues?: Array<{ severity: string; code: string; message: string; path?: string }>
  compatibility_profiles?: ProviderCompatibilityProfile[]
  providers: CatalogProvider[]
}

export interface CatalogModelsResponse {
  version: string
  source: 'builtin_static'
  last_updated: string
  auto_update: boolean
  refresh_sources?: CatalogProvidersResponse['refresh_sources']
  sync_status?: CatalogSyncStatus
  override_file?: string
  override_found?: boolean
  sync_cache_file?: string
  sync_cache_found?: boolean
  issues?: Array<{ severity: string; code: string; message: string; path?: string }>
  models: CatalogModel[]
}

// ── Capabilities ──

export interface CapabilityDefinition {
  id: string
  label: { en: string; cn: string }
  icon: string
  description: { en: string; cn: string }
  tierAffinity: {
    simple: number
    standard: number
    complex: number
    reasoning: number
  }
}

export interface CapabilitiesResponse {
  capabilities: CapabilityDefinition[]
}

export interface TierRecommendationItem {
  tier: string
  score: number
  suitable: boolean
  label: string
}

export interface TierRecommendationResponse {
  recommendations: TierRecommendationItem[]
}

export interface RoutingRecommendationItem {
  tier: string
  primary: { node: string; model: string } | null
  fallbacks: { node: string; model: string }[]
  score: number
}

export interface RoutingRecommendationResponse {
  recommendations: RoutingRecommendationItem[]
}

// ── Adaptive Routing Recommendations ──

export interface AdaptiveRouteTargetStats {
  key: string
  tier?: string
  node: string
  model: string
  calls: number
  successes: number
  failures: number
  success_rate: number
  fallback_calls: number
  fallback_rate: number
  retry_count: number
  avg_latency_ms: number
  p50_latency_ms: number
  p95_latency_ms: number
  total_cost_usd: number
  avg_cost_usd: number
  cost_per_1k_calls_usd: number
  first_seen_at: string | null
  last_seen_at: string | null
}

export interface AdaptiveTierStats {
  tier: string
  calls: number
  fallback_calls: number
  fallback_rate: number
  targets: AdaptiveRouteTargetStats[]
}

export interface AdaptiveRoutingStatsWindow {
  generated_at: string
  window_hours: number
  sample_limit: number
  min_samples: number
  observed_calls: number
  targets: AdaptiveRouteTargetStats[]
  tiers: AdaptiveTierStats[]
}

export interface AdaptiveRoutingSavings {
  cost_usd_per_1k_calls: number
  window_cost_usd: number
  p50_latency_ms: number
  p95_latency_ms: number
}

export interface AdaptiveRoutingRecommendation {
  id: string
  tier: string
  type: 'promote_primary' | 'investigate_primary' | 'collect_more_data'
  current_primary: { node: string; model: string }
  suggested_primary: { node: string; model: string } | null
  suggested_fallbacks: { node: string; model: string }[]
  reasons: string[]
  confidence: number
  potential_savings: AdaptiveRoutingSavings
  risks: string[]
  evidence: {
    current: AdaptiveRouteTargetStats | null
    candidate: AdaptiveRouteTargetStats | null
    tier_calls: number
  }
}

export interface AdaptiveRoutingRecommendationsResponse {
  mode: 'recommendation_only'
  generated_at: string
  stats: AdaptiveRoutingStatsWindow
  recommendations: AdaptiveRoutingRecommendation[]
}

// ── Experiment Analytics ──

export interface ExperimentGroupStats {
  experimentGroup: string
  calls: number
  totalCost: number
  avgCost: number
  avgLatency: number
  totalTokens: number
  successCount: number
  successRate: number
}

export interface ExperimentDailyTrend {
  date: string
  experimentGroup: string
  calls: number
  avgLatency: number
  avgCost: number
}

export interface ExperimentAnalyticsResponse {
  byGroup: ExperimentGroupStats[]
  dailyTrend: ExperimentDailyTrend[]
  activeSplits: Record<string, SplitVariant[]>
  period: number
}

// ── Per-Key Budget ──

export interface BudgetPerKeyResponse {
  rules: BudgetRule[]
  perKeyRules: BudgetRule[]
  apiKeyName: string | null
  apiKeyId: string | null
}

export interface BudgetKeyItem {
  id: string
  name: string
  key_prefix: string
  daily_token_limit: number | null
  daily_cost_limit: number | null
  rate_limit_per_minute: number | null
}

export interface BudgetKeysResponse {
  keys: string[]
  items: BudgetKeyItem[]
}

export interface ApiKeysResponse {
  keys: string[]
  items: GatewayApiKey[]
}

export interface LocalTeam {
  id: string
  name: string
  description: string | null
  status: 'active' | 'disabled'
  namespace_id: string | null
  namespace_name: string | null
  allowed_nodes: string[]
  allowed_models: string[]
  allowed_endpoints: string[]
  allowed_modalities: string[]
  daily_token_limit: number | null
  daily_cost_limit: number | null
  rate_limit_per_minute: number | null
  created_at: string
  updated_at: string
  last_used_at: string | null
  today: {
    calls: number
    errors: number
    error_rate: number
    cost_usd: number
    input_tokens: number
    output_tokens: number
  }
}

export interface TeamsResponse {
  teams: LocalTeam[]
  mode: 'local_only'
  enterprise_features: {
    workspace: boolean
    sso: boolean
    scim: boolean
    org_billing: boolean
  }
}

export interface CreateTeamRequest {
  name: string
  description?: string | null
  namespace_id?: string | null
  allowed_nodes: string[]
  allowed_models: string[]
  allowed_endpoints: string[]
  allowed_modalities: string[]
  daily_token_limit?: number | null
  daily_cost_limit?: number | null
  rate_limit_per_minute?: number | null
}

export type UpdateTeamRequest = Partial<CreateTeamRequest> & {
  status?: 'active' | 'disabled'
}

export interface TeamMutationResponse extends ActionResponse {
  item: LocalTeam
}

// ── Gateway API Keys ──

export interface GatewayApiKey {
  id: string
  name: string
  description: string | null
  key_prefix: string
  status: 'active' | 'disabled'
  allow_auto: boolean
  allow_direct: boolean
  allowed_nodes: string[]
  allowed_models: string[]
  allowed_endpoints: string[]
  allowed_modalities: string[]
  namespace_id: string | null
  namespace_name: string | null
  team_id: string | null
  team_name: string | null
  daily_token_limit: number | null
  daily_cost_limit: number | null
  rate_limit_per_minute: number | null
  created_at: string
  updated_at: string
  last_used_at: string | null
  last_used_ip: string | null
  today: {
    calls: number
    errors: number
    error_rate: number
    cost_usd: number
    input_tokens: number
    output_tokens: number
  }
}

export interface CreateGatewayApiKeyRequest {
  name: string
  description?: string | null
  allow_auto: boolean
  allow_direct: boolean
  allowed_nodes: string[]
  allowed_models: string[]
  allowed_endpoints: string[]
  allowed_modalities: string[]
  namespace_id?: string | null
  team_id?: string | null
  daily_token_limit?: number | null
  daily_cost_limit?: number | null
  rate_limit_per_minute?: number | null
}

export type UpdateGatewayApiKeyRequest = Partial<CreateGatewayApiKeyRequest> & {
  status?: 'active' | 'disabled'
}

export interface GatewayApiKeyMutationResponse extends ActionResponse {
  item: GatewayApiKey
  key?: string
}

// ── Local Namespaces + Shadow Traffic ──

export interface NamespaceInfo {
  id: string
  name: string
  allowed_nodes: string[]
  allowed_models: string[]
  rate_limit_per_minute: number | null
  budget: {
    daily_token_limit?: number
    daily_cost_limit?: number
    alert_threshold?: number
  } | null
  budget_status: BudgetRule[]
}

export interface NamespacesResponse {
  namespaces: NamespaceInfo[]
  mode: 'local_only'
  enterprise_features: {
    workspace: boolean
    sso: boolean
    scim: boolean
    org_billing: boolean
  }
}

export interface ShadowTrafficStatus {
  enabled: boolean
  sample_rate: number
  target_node: string | null
  target_model: string | null
  timeout_ms: number | null
  max_recent_results: number
  compare: {
    store_prompts: boolean
    store_responses: boolean
    sample_max_chars?: number
  }
  privacy: {
    stores_prompts: boolean
    stores_responses: boolean
    raw_headers: boolean
    provider_keys: boolean
    media_bytes?: boolean
    video_bytes?: boolean
    sample_redaction?: boolean
  }
}

export interface ShadowTrafficResult {
  id: number
  timestamp: string
  request_id: string
  kind: 'chat' | 'embeddings'
  namespace_id: string | null
  api_key_id: string | null
  api_key_name: string | null
  source_format: string
  primary_node: string
  primary_model: string
  shadow_node: string
  shadow_model: string
  status: 'sent' | 'failed' | 'skipped'
  latency_ms: number | null
  status_code: number | null
  error: string | null
  input_tokens: number
  output_tokens: number
  prompt_sample: string | null
  response_sample: string | null
}

export interface ShadowReportFilters {
  namespace?: string
  api_key?: string
  api_key_id?: string
  node?: string
  model?: string
  period?: string
  source_format?: string
}

export interface ShadowConfidence {
  level: 'low' | 'medium' | 'high'
  score: number
}

export interface ShadowComparisonPair {
  primary_node: string
  primary_model: string
  shadow_node: string
  shadow_model: string
  calls: number
  primary_success_rate: number | null
  shadow_success_rate: number | null
  primary_p50_latency_ms: number | null
  shadow_p50_latency_ms: number | null
  primary_p95_latency_ms: number | null
  shadow_p95_latency_ms: number | null
  cost_delta_usd: number
  token_delta: number
  fallback_delta: number
}

export interface ShadowComparisonReport {
  generated_at: string
  filters: {
    namespace_id: string | null
    api_key_id: string | null
    api_key_name: string | null
    node: string | null
    model: string | null
    period: string
    source_format: string | null
  }
  window: {
    start_at: string
    end_at: string
    rows: number
    comparable: number
    missing_primary_logs: number
  }
  primary_success_rate: number | null
  shadow_success_rate: number | null
  latency_delta_ms: number | null
  p50_latency_comparison: {
    primary_ms: number | null
    shadow_ms: number | null
    delta_ms: number | null
  }
  p95_latency_comparison: {
    primary_ms: number | null
    shadow_ms: number | null
    delta_ms: number | null
  }
  cost_delta_usd: number
  potential_savings_usd: number
  token_delta: number
  fallback_delta: number
  quality_sample_coverage: number
  confidence: ShadowConfidence
  risk_notes: string[]
  primary: {
    calls: number
    success_rate: number | null
    p50_latency_ms: number | null
    p95_latency_ms: number | null
    total_cost_usd: number
    total_tokens: number
    fallback_rate: number | null
  }
  shadow: {
    calls: number
    success_rate: number | null
    p50_latency_ms: number | null
    p95_latency_ms: number | null
    total_cost_usd: number
    total_tokens: number
    fallback_rate: number | null
    pricing_missing: number
  }
  pairs: ShadowComparisonPair[]
  privacy: ShadowTrafficStatus['privacy']
}

export interface ShadowResultComparison {
  result_id: number
  request_id: string
  timestamp: string
  source_format: string
  namespace_id: string | null
  api_key_id: string | null
  api_key_name: string | null
  primary: {
    node: string
    model: string
    success: boolean | null
    status_code: number | null
    latency_ms: number | null
    cost_usd: number | null
    input_tokens: number
    output_tokens: number
    is_fallback: boolean | null
    fallback_reason: string | null
  }
  shadow: {
    node: string
    model: string
    success: boolean
    status: string
    status_code: number | null
    latency_ms: number | null
    estimated_cost_usd: number
    input_tokens: number
    output_tokens: number
    error: string | null
  }
  deltas: {
    latency_ms: number | null
    cost_usd: number | null
    tokens: number | null
    fallback: number | null
  }
  samples: {
    prompt_stored: boolean
    response_stored: boolean
    prompt_preview: string | null
    response_preview: string | null
  }
  risk_notes: string[]
  privacy: ShadowTrafficStatus['privacy']
}

export interface ShadowTrafficResponse {
  status: ShadowTrafficStatus
  recent: ShadowTrafficResult[]
}
