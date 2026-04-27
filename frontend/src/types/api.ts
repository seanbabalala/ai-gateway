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
  session_key: string | null
  error: string | null
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
  type: string
  limit: number
  current: number
  percentage: number
  exceeded: boolean
  alert: boolean
  periodStart: string
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

export interface NodeInfo {
  id: string
  name: string
  protocol: 'chat_completions' | 'responses' | 'messages'
  base_url: string
  endpoint: string
  models: string[]
  capabilities: string[]
  tags: string[]
  aliases: Record<string, string>
  circuit: CircuitBreaker
  healthy: boolean
}

export interface NodesResponse {
  nodes: NodeInfo[]
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

// ── Config ──

export interface TierRoute {
  primary: { node: string; model: string }
  fallbacks: { node: string; model: string }[]
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
  auth: { api_keys: { name: string; key: string }[] }
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
  budget: {
    daily_token_limit: number
    daily_cost_limit: number
    alert_threshold: number
  }
  models_pricing: Record<string, ModelPricing>
}

// ── SSE Events ──

export type SSEEvent =
  | { type: 'connected'; timestamp: string }
  | { type: 'log'; log: CallLog }
  | { type: 'heartbeat'; timestamp: string }

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
  capabilities?: string[]
  tags?: string[]
  model_aliases?: Record<string, string>
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
  capabilities?: string[]
  tags?: string[]
  model_aliases?: Record<string, string>
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
