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
  session_key: string | null
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

export interface NodeInfo {
  id: string
  name: string
  protocol: 'chat_completions' | 'responses' | 'messages'
  base_url: string
  endpoint: string
  models: string[]
  embedding_models?: string[]
  rerank_models?: string[]
  capabilities: string[]
  modalities: string[]
  tags: string[]
  aliases: Record<string, string>
  model_prefixes: string[]
  circuit: CircuitBreaker
  modelCircuits: Record<string, CircuitBreaker>
  concurrency: ConcurrencySnapshot
  healthy: boolean
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

// ── Config ──

export interface SplitVariant {
  node: string
  model: string
  weight: number
  name?: string
}

export type LoadBalancingStrategy = 'weighted' | 'round_robin' | 'least_latency' | 'random'

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
  strategy: LoadBalancingStrategy | 'primary_fallback' | 'split'
  source: 'primary_fallback' | 'targets' | 'split'
  targets: RoutingTargetMetrics[]
  last_selected: {
    node: string
    model: string
    selected_at: string
    strategy: LoadBalancingStrategy | 'primary_fallback' | 'split'
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
  models_pricing: Record<string, ModelPricing>
  diagnostics: ConfigDiagnostic[]
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
  auth_type?: 'bearer' | 'x-api-key'
}

export interface UpdateNodeRequest {
  name?: string
  protocol?: 'chat_completions' | 'responses' | 'messages'
  base_url?: string
  endpoint?: string
  api_key?: string
  models?: string[]
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
  auth_type?: 'bearer' | 'x-api-key'
}

export interface TestNodeRequest {
  protocol: 'chat_completions' | 'responses' | 'messages'
  base_url: string
  endpoint: string
  api_key: string
  model: string
  auth_type?: 'bearer' | 'x-api-key'
  headers?: Record<string, string>
}

export interface TestNodeResponse {
  success: boolean
  status: number
  latency_ms: number
  message: string
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
  namespace_id: string | null
  namespace_name: string | null
  daily_token_limit: number | null
  daily_cost_limit: number | null
  rate_limit_per_minute: number | null
  created_at: string
  updated_at: string
  last_used_at: string | null
  last_used_ip: string | null
  today: {
    calls: number
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
  namespace_id?: string | null
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
  }
  privacy: {
    stores_prompts: boolean
    stores_responses: boolean
    raw_headers: boolean
    provider_keys: boolean
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

export interface ShadowTrafficResponse {
  status: ShadowTrafficStatus
  recent: ShadowTrafficResult[]
}
