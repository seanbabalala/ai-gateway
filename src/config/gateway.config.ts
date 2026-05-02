// ===================================================================
// Gateway Configuration — Type Definitions
// ===================================================================
// Types matching the structure of gateway.config.yaml
// ===================================================================

import type { Modality } from './modality';
import type { PluginConfigEntry } from '../plugins/types';

export interface GatewayConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  auth: AuthConfig;
  dashboard?: DashboardConfig;
  nodes: NodeConfig[];
  routing: RoutingConfig;
  budget: BudgetConfig;
  cache?: CacheConfig;
  models_pricing: Record<string, ModelPricing>;

  /** Plugin declarations — loaded at startup in order */
  plugins?: PluginConfigEntry[];

  /** OpenTelemetry observability — disabled by default */
  telemetry?: TelemetryConfig;

  /** Runtime config reload behavior — watcher disabled by default */
  hot_reload?: HotReloadConfig;

  /** Optional OSS-local alerting channels — disabled by default */
  alerts?: AlertsConfig;

  /** Optional external call-log sinks — disabled by default */
  logging?: LoggingConfig;

  /** Optional shared runtime state backend — memory by default */
  state?: StateBackendConfig;

  /** Optional hosted control-plane connection — disabled by default */
  control_plane?: ControlPlaneConfig;
}

// ===== Shared State Backend =====
export type StateBackendType = 'memory' | 'redis';
export type StateUnavailablePolicy = 'fail_open' | 'fail_closed';

export interface StateBackendConfig {
  /** Runtime state backend (default: memory). Redis is optional for multi-instance deployments. */
  backend?: StateBackendType;
  /** Behavior when Redis is configured but unavailable (default: fail_open). */
  unavailable_policy?: StateUnavailablePolicy;
  redis?: RedisStateBackendConfig;
}

export interface RedisStateBackendConfig {
  /** redis:// or rediss:// URL. May use ${REDIS_URL}. */
  url?: string;
  /** Key prefix used for all SiftGate runtime state (default: siftgate:state:). */
  prefix?: string;
  /** Per-command timeout in milliseconds (default: 500). */
  timeout_ms?: number;
  /** Poll interval for sync-only local mirrors such as circuit/momentum (default: 2000). */
  sync_interval_ms?: number;
}

// ===== Hot Reload =====
export interface HotReloadConfig {
  /** Watch gateway.config.yaml for changes (default: false) */
  watch?: boolean;
  /** Debounce file watcher reloads in milliseconds (default: 500) */
  debounce_ms?: number;
}

// ===== Alerts =====
export type AlertEventType =
  | 'budget_threshold'
  | 'budget_exceeded'
  | 'node_down'
  | 'node_recovered'
  | 'circuit_open'
  | 'circuit_close'
  | 'error_spike'
  | 'latency_spike';

export interface AlertsConfig {
  /** Master switch for local alert dispatch (default: false) */
  enabled?: boolean;
  /** Webhook-only OSS channel list. Empty by default. */
  channels?: WebhookAlertChannelConfig[];
  /** Recent alert delivery records retained for Dashboard (default: 50) */
  history_size?: number;
  /** Local sliding-window rule for error spikes. */
  error_spike?: AlertSpikeRuleConfig;
  /** Local sliding-window rule for p95 latency spikes. */
  latency_spike?: AlertLatencySpikeRuleConfig;
}

export interface WebhookAlertChannelConfig {
  type: 'webhook';
  /** Stable display name used in Dashboard and debounce keys. */
  name?: string;
  url: string;
  /** Optional outbound headers. Values may use environment references. */
  headers?: Record<string, string>;
  /** Events delivered by this channel. Unset means all supported events. */
  events?: AlertEventType[];
  /** Per-channel debounce window in seconds (default: 300). */
  debounce_seconds?: number;
  /** Webhook retry and timeout controls. */
  retry?: AlertWebhookRetryConfig;
}

export interface AlertWebhookRetryConfig {
  /** Total delivery attempts, including the first attempt (default: 3). */
  attempts?: number;
  /** Delay between failed attempts in milliseconds (default: 1000). */
  backoff_ms?: number;
  /** Per-attempt HTTP timeout in milliseconds (default: 5000). */
  timeout_ms?: number;
}

export interface AlertSpikeRuleConfig {
  /** Enable this detector when alerting is enabled (default: true). */
  enabled?: boolean;
  /** Sliding window in seconds (default: 300). */
  window_seconds?: number;
  /** Minimum samples before evaluating (default: 20). */
  min_requests?: number;
  /** Error-rate threshold as 0-1 (default: 0.1). */
  error_rate?: number;
}

export interface AlertLatencySpikeRuleConfig {
  /** Enable this detector when alerting is enabled (default: true). */
  enabled?: boolean;
  /** Sliding window in seconds (default: 300). */
  window_seconds?: number;
  /** Minimum samples before evaluating (default: 20). */
  min_requests?: number;
  /** p95 latency threshold in milliseconds (default: 10000). */
  p95_ms?: number;
}

// ===== External Log Sinks =====
export type LogSinkType = 'file' | 'webhook' | 's3' | 'elasticsearch';
export type LogSinkOverflowPolicy = 'drop_oldest' | 'drop_newest';

export interface LoggingConfig {
  /** Master switch for local external log sinks (default: false) */
  enabled?: boolean;
  /** External sink list. SQLite/Postgres call_log remains authoritative. */
  sinks?: LogSinkConfig[];
}

export interface LogSinkRetryConfig {
  /** Total delivery attempts, including the first attempt (default: 3). */
  attempts?: number;
  /** Delay between failed attempts in milliseconds (default: 1000). */
  backoff_ms?: number;
  /** Per-attempt HTTP timeout in milliseconds (default: 5000). */
  timeout_ms?: number;
}

export interface BaseLogSinkConfig {
  type: LogSinkType;
  /** Stable name used in logs, stats, and queue state. */
  name?: string;
  /** Disable one sink without deleting it (default: true). */
  enabled?: boolean;
  /** Records delivered per flush (default: 100). */
  batch_size?: number;
  /** Background flush interval in milliseconds (default: 5000). */
  flush_interval_ms?: number;
  /** Per-sink in-memory queue limit (default: 10000). */
  max_queue?: number;
  /** Queue overflow behavior (default: drop_oldest). */
  overflow?: LogSinkOverflowPolicy;
  /** Optional allow-list of output fields. Empty/unset means all safe fields. */
  fields?: string[];
  /** Optional deny-list applied after fields. */
  exclude_fields?: string[];
  /** Delivery retry controls. */
  retry?: LogSinkRetryConfig;
}

export interface FileLogSinkConfig extends BaseLogSinkConfig {
  type: 'file';
  /** JSONL output path. Parent directories are created automatically. */
  path: string;
}

export interface WebhookLogSinkConfig extends BaseLogSinkConfig {
  type: 'webhook';
  url: string;
  /** Optional outbound headers. Values may use environment references. */
  headers?: Record<string, string>;
}

export interface S3LogSinkConfig extends BaseLogSinkConfig {
  type: 's3';
  bucket: string;
  region?: string;
  prefix?: string;
}

export interface ElasticsearchLogSinkConfig extends BaseLogSinkConfig {
  type: 'elasticsearch';
  url: string;
  index: string;
  headers?: Record<string, string>;
}

export type LogSinkConfig =
  | FileLogSinkConfig
  | WebhookLogSinkConfig
  | S3LogSinkConfig
  | ElasticsearchLogSinkConfig;

// ===== Dashboard =====
export interface DashboardConfig {
  password?: string;
}

// ===== Server =====
export interface CorsConfig {
  origin: boolean | string | string[];  // true = all origins, string[] = whitelist
  credentials?: boolean;                // default: true
}

export interface ServerConfig {
  port: number;
  host: string;
  cors?: CorsConfig;              // default: { origin: true }
  trust_proxy?: boolean | string; // default: false
  body_limit?: string;            // default: '1mb'
  shutdown_timeout_ms?: number;   // default: 5000
  helmet?: boolean;               // default: true
}

// ===== Database =====
export interface DatabaseConfig {
  type: 'sqlite' | 'postgres';
  path?: string; // SQLite file path
  url?: string; // PostgreSQL connection URL
  log_retention_days?: number; // Auto-delete logs older than N days (default: 30)
}

// ===== Auth =====
export interface AuthConfig {
  api_keys: ApiKeyEntry[];
  rate_limit?: RateLimitConfig;
}

export interface ApiKeyBudgetOverride {
  daily_token_limit?: number;   // per-key token limit (unset = no per-key token limit)
  daily_cost_limit?: number;    // per-key cost limit (unset = no per-key cost limit)
  alert_threshold?: number;     // defaults to global alert_threshold
}

export interface ApiKeyEntry {
  key: string;
  name: string;
  budget?: ApiKeyBudgetOverride;  // optional per-key budget limits
}

/**
 * Rate limiting configuration.
 * Uses in-memory sliding window counters.
 */
export interface RateLimitConfig {
  /** Max requests per minute per API key (default: 60) */
  requests_per_minute: number;
  /** Max requests per minute per IP when no API key (default: 30) */
  requests_per_minute_ip: number;
  /** Max tracked IPs/keys in sliding-window map (default: 10000, FIFO eviction) */
  max_entries?: number;
  /** Max login attempts per IP per minute (default: 5) */
  login_requests_per_minute?: number;
}

// ===== Node (AI Provider) =====
export type NodeProtocol = 'chat_completions' | 'responses' | 'messages';

export type AuthType = 'bearer' | 'x-api-key';

export type QueuePolicy = 'wait' | 'fallback' | 'reject';

export type HealthCheckMethod = 'HEAD' | 'GET' | 'POST';

export interface ModelCapabilityConfig {
  /** Maximum total context window for this model, including input and reserved output tokens. */
  max_context_tokens?: number;
  /** Whether this model should be considered safe for structured output requests. */
  structured_output?: boolean;
  /** Supported embedding output dimensions for embedding models. */
  dimensions?: number | number[];
  /** Optional per-node/model pricing override used by routing and cost accounting. */
  pricing?: ModelPricing;
  /** Optional operator-supplied quality hint; higher values win for optimization: quality. */
  quality_score?: number;
}

export interface NodeHealthCheckConfig {
  /** Enable active background probes for this node (default: false) */
  enabled?: boolean;
  /** Probe interval in seconds (default: 30) */
  interval_seconds?: number;
  /** Probe timeout in milliseconds (default: min(node.timeout_ms, 5000)) */
  timeout_ms?: number;
  /** Probe HTTP method (default: POST when lightweight_model is set, otherwise HEAD) */
  method?: HealthCheckMethod;
  /** Probe path relative to base_url (default: node.endpoint) */
  path?: string;
  /** Optional cheap model to probe with a synthetic 1-token request */
  lightweight_model?: string;
}

export interface NodeConfig {
  id: string;
  name: string;
  protocol: NodeProtocol;
  base_url: string;
  endpoint: string;
  api_key: string;
  auth_type?: AuthType; // Default: 'bearer' for chat_completions/responses, 'x-api-key' for messages
  models: string[];
  /** Optional OpenAI-compatible embeddings endpoint path (default: /v1/embeddings). */
  embeddings_endpoint?: string;
  /** Embedding-capable model IDs exposed by this node. */
  embedding_models?: string[];
  timeout_ms: number;
  max_concurrency?: number; // Optional per-node upstream concurrency limit
  queue_timeout_ms?: number; // Default: 10000 when max_concurrency is set
  queue_policy?: QueuePolicy; // wait (default) | fallback | reject
  headers?: Record<string, string>;
  health_check?: NodeHealthCheckConfig;
  /** Node-level default context window used when a model-specific value is omitted. */
  max_context_tokens?: number;
  /** Node-level default structured-output support flag. */
  structured_output?: boolean;
  /** Optional per-model capability and pricing metadata. Keys are model IDs. */
  model_capabilities?: Record<string, ModelCapabilityConfig>;

  /**
   * Structured capability tags — describe what this node is good at.
   * Used for tier recommendation and routing suggestions.
   *
   * Valid capability IDs:
   *   coding, coding_frontend, coding_backend, reasoning, analysis,
   *   creative, long_context, tool_use, fast, multilingual, vision
   *
   * Example: capabilities: ["coding", "coding_backend", "reasoning"]
   */
  capabilities?: string[];

  /**
   * Explicitly declare which modalities this node supports.
   * When set, this takes highest priority over model-name inference and capability fallback.
   *
   * Valid modalities: "text", "vision", "audio"
   *
   * If omitted, modalities are inferred from model names or capabilities.
   * Unknown models default to ["text"] (text-only).
   *
   * Example: modalities: ["text", "vision"]
   */
  modalities?: Modality[];

  /**
   * Free-text tags — describe what this node is good at.
   * Used by domain-hint routing to prefer nodes matching the request domain.
   * If `capabilities` is not set, capabilities are inferred from tags.
   *
   * Common tags:
   *   frontend, backend, reasoning, creative, fast, cheap,
   *   code, math, multilingual, vision, long-context
   *
   * Example: tags: ["backend", "reasoning", "code"]
   */
  tags?: string[];

  /**
   * Model aliases — user-friendly short names that map to actual model IDs.
   * Allows users to send e.g. "claude" instead of "claude-opus-4-6-v1".
   *
   * Users can also send arbitrary model names using the "nodeId/model" prefix syntax
   * (e.g. "claude/my-fine-tuned-model") without needing to register them here.
   * The gateway will route to the correct node and pass the model name through.
   *
   * Example:
   *   model_aliases:
   *     claude: claude-opus-4-6-v1
   *     opus: claude-opus-4-6-v1
   */
  model_aliases?: Record<string, string>;

  /**
   * Model pass-through prefixes handled by this node.
   * Use this when the node id is a stable provider/channel id (e.g. "anthropic-prod")
   * but clients should still be able to direct-route model families like
   * "claude-sonnet-..." without registering every future model id.
   *
   * Example:
   *   model_prefixes: ["claude"]
   */
  model_prefixes?: string[];
}

// ===== Routing =====
export interface RoutingConfig {
  tiers: Record<string, TierConfig>;
  scoring: ScoringThresholds;
  retry?: RetryConfig;
  /** Optional v0.3 same-capability optimization mode for automatic routing. */
  optimization?: RoutingOptimization;
  /** Optional v0.3 fallback trigger policies. */
  fallback_policy?: FallbackPolicyConfig;

  /**
   * Domain-based node preference.
   * Maps a domain hint (from scoring) → ordered list of preferred node IDs.
   *
   * When a request is scored with a domain hint (e.g. "frontend"),
   * the routing engine reorders available nodes to prefer those listed here.
   *
   * Example:
   *   domain_preferences:
   *     frontend: [gemini, gpt]
   *     backend: [claude, gpt]
   *     math: [claude]
   *     creative: [gpt, gemini]
   *
   * If not configured, nodes with matching tags are auto-preferred.
   */
  domain_preferences?: Record<string, string[]>;
}

/**
 * v0.3 fallback policy controls.
 * Defaults are conservative: existing retry/fallback behavior is preserved unless
 * a policy is explicitly enabled.
 */
export interface FallbackPolicyConfig {
  /** Skip same-node retries on HTTP 429 and immediately try the next fallback. */
  immediate_429?: boolean;
  /** Timeout-driven fallback behavior for upstream calls. */
  timeout?: TimeoutFallbackConfig;
  /** Validate structured-output responses and fallback on invalid JSON/schema. */
  structured_output?: StructuredOutputFallbackConfig;
  /** Downgrade to a cheaper fallback before calling upstream when estimated cost is high. */
  cost_downgrade?: CostDowngradeFallbackConfig;
}

export interface TimeoutFallbackConfig {
  /** Enable timeout fallback (default: false). */
  enabled?: boolean;
  /** Per-upstream attempt timeout before falling back. Defaults to the node timeout. */
  threshold_ms?: number;
  /**
   * Start the first fallback while the primary is still running after threshold_ms.
   * Disabled by default because it can create extra provider cost.
   */
  race_fallback?: boolean;
}

export interface StructuredOutputFallbackConfig {
  /** Enable structured-output parse/schema validation (default: false). */
  enabled?: boolean;
  /** Fallback when JSON parsing fails (default: true). */
  fallback_on_parse_error?: boolean;
  /** Fallback when a simple JSON schema check fails (default: true). */
  fallback_on_schema_error?: boolean;
}

export interface CostDowngradeFallbackConfig {
  /** Enable pre-upstream cost downgrade (default: false). */
  enabled?: boolean;
  /** Estimated request cost threshold in USD. Required when enabled. */
  max_estimated_cost_usd?: number;
}

/**
 * Retry configuration for upstream provider calls.
 * Controls how the gateway retries failed requests before moving to the next fallback.
 */
export interface RetryConfig {
  /** Max retries per node (default: 0 = no retry, only fallback) */
  max_retries: number;
  /** Initial backoff delay in ms (default: 500) */
  backoff_base_ms: number;
  /** Maximum backoff delay in ms (default: 5000) */
  backoff_max_ms: number;
  /** HTTP status codes eligible for retry (default: [429, 502, 503]) */
  retryable_status: number[];
}

export interface SplitVariant {
  node: string;
  model: string;
  weight: number;      // 1-100, all variants in a tier must sum to 100
  name?: string;       // optional alias (e.g. "control", "challenger"), defaults to "node:model"
}

export type LoadBalancingStrategy = 'weighted' | 'round_robin' | 'least_latency' | 'random';

export type RoutingOptimization = 'cost' | 'latency' | 'balanced' | 'quality';

export interface WeightedRouteTarget extends RouteTarget {
  weight?: number;      // used by weighted strategy; defaults to 1
  name?: string;        // optional display label
}

export interface TierConfig {
  /** Legacy schema: still supported and used when targets is omitted. */
  primary?: RouteTarget;
  fallbacks?: RouteTarget[];
  /** New unified load-balancing schema. Ignored while split is configured. */
  strategy?: LoadBalancingStrategy;
  targets?: WeightedRouteTarget[];
  split?: SplitVariant[];  // A/B testing: when set, overrides primary/fallbacks with weighted routing
}

export interface RouteTarget {
  node: string;
  model: string;
}

export interface ScoringThresholds {
  simple_max: number;
  standard_max: number;
  complex_max: number;
  // anything above complex_max → reasoning

  /**
   * Override default dimension weights.
   * Keys match dimension names: simpleIndicators, codeGeneration, codeFrontend,
   * codeBackend, formalLogic, technicalTerms, multiStep, analyticalReasoning,
   * tokenCount, toolCount, conversationDepth, constraintDensity, expectedOutputLength, codeToProse.
   *
   * Example: { formalLogic: 0.15, codeGeneration: 0.12 }
   */
  weights?: Record<string, number>;

  /**
   * Custom keywords to inject into existing dimension tries.
   * Each entry adds keywords to the specified dimension's trie.
   *
   * Example:
   *   custom_keywords:
   *     - pattern: "kubernetes|k8s|helm"
   *       dimension: codeBackend
   *       weight: 1.0
   *     - pattern: "legal|contract|compliance"
   *       dimension: analyticalReasoning
   *       weight: 1.0
   */
  custom_keywords?: CustomKeywordEntry[];
}

export interface CustomKeywordEntry {
  /** Pipe-separated keywords: "keyword1|keyword2|keyword3" */
  pattern: string;
  /** Target dimension name */
  dimension: string;
  /** Weight for these keywords (default: 1.0) */
  weight?: number;
}

// ===== Budget =====
export interface BudgetConfig {
  daily_token_limit: number;
  daily_cost_limit: number;
  alert_threshold: number;
}

// ===== Cache =====
export interface CacheConfig {
  /** Master switch (default: false) */
  enabled: boolean;
  /** Cache TTL in seconds (default: 300 = 5 minutes) */
  ttl_seconds: number;
  /** Max cache entries, LRU eviction (default: 1000) */
  max_entries: number;
  /** Skip caching responses with tool_use stop reason (default: true) */
  exclude_tool_use: boolean;
}

// ===== Model Pricing =====
export interface ModelPricing {
  input: number; // cost per 1M input tokens (USD)
  output: number; // cost per 1M output tokens (USD)
  cache_creation_input?: number; // cost per 1M cache-write tokens (e.g. Anthropic: 1.25x input)
  cache_read_input?: number;     // cost per 1M cache-read tokens (e.g. Anthropic: 0.1x input; OpenAI: 0.5x)
}

// ===== Telemetry (OpenTelemetry) =====
export interface TelemetryConfig {
  /** Master switch — when false (default), SDK is not initialized, all calls are no-op */
  enabled: boolean;
  /** OTel service name (default: 'siftgate') */
  service_name?: string;
  /** Trace export configuration */
  traces?: {
    /** OTLP endpoint for traces (default: 'http://localhost:4318/v1/traces') */
    endpoint?: string;
    /** Sampling rate 0.0–1.0 (default: 1.0 = sample everything) */
    sample_rate?: number;
  };
  /** Metrics export configuration */
  metrics?: {
    /** Port for Prometheus scrape endpoint (default: 9464) */
    prometheus_port?: number;
    /** Optional OTLP endpoint for metrics push */
    otlp_endpoint?: string;
  };
}

// ===== Hosted Control Plane (Connected Gateway) =====
export interface ControlPlaneTelemetryConfig {
  /** Batch upload interval in seconds (default: 30) */
  upload_interval_seconds?: number;
  /** Never enabled by default. Reserved for explicit enterprise opt-in. */
  include_prompt?: boolean;
  /** Never enabled by default. Reserved for explicit enterprise opt-in. */
  include_response?: boolean;
}

export interface ControlPlaneConfig {
  /** Master switch. When false/omitted, the gateway never contacts a control plane. */
  enabled?: boolean;
  /** Hosted control-plane base URL, e.g. https://cloud.example.com */
  url?: string;
  /** Stable local gateway identifier shown in the hosted fleet view. */
  gateway_id?: string;
  /** One-time or long-lived registration token issued by the hosted control plane. */
  registration_token?: string;
  /** Metadata upload privacy and batching settings. */
  telemetry?: ControlPlaneTelemetryConfig;
}
