// ===================================================================
// Gateway Configuration — Type Definitions
// ===================================================================
// Types matching the structure of gateway.config.yaml
// ===================================================================

import type {
  CapabilityEndpoint,
  CapabilityIOType,
  Modality,
} from './modality';
import type { PluginConfigEntry } from '../plugins/types';

export interface GatewayConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  auth: AuthConfig;
  dashboard?: DashboardConfig;
  catalog?: CatalogConfig;
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

  /** Optional OSS-local embeddings request batching — disabled by default */
  embedding_batching?: EmbeddingBatchingConfig;

  /** Experimental OpenAI Realtime-compatible WebSocket preview — disabled by default */
  realtime?: RealtimeConfig;

  /** Optional shared state backend; memory remains the default single-node mode */
  state?: StateBackendConfig;

  /** Optional multi-instance cluster mode; enabled explicitly or by state.backend=redis */
  cluster?: ClusterConfig;

  /** Optional OSS-local alerting channels — disabled by default */
  alerts?: AlertsConfig;

  /** Optional external call-log sinks — disabled by default */
  logging?: LoggingConfig;

  /** Optional OSS-local namespaces — no enterprise workspace/org features */
  namespaces?: NamespaceConfig[];

  /** Optional async shadow traffic mirror — disabled by default */
  shadow?: ShadowTrafficConfig;

  /** Optional local config audit log and rollback history. */
  config_audit?: ConfigAuditConfig;

  /** Optional secret reference backends; env references are enabled by default */
  secret_manager?: SecretManagerConfig;

  /** Optional hosted control-plane connection — disabled by default */
  control_plane?: ControlPlaneConfig;
}

export interface CatalogConfig {
  /** Local model/provider catalog override file. Defaults to catalog.override.yaml. */
  override_file?: string;
}

// ===== Config Audit / Rollback =====
export interface ConfigAuditConfig {
  /** Master switch for local config audit/version history (default: true). */
  enabled?: boolean;
  /** Maximum stored config versions before oldest versions are pruned (default: 50). */
  max_versions?: number;
  /** Maximum audit events returned by Dashboard APIs (default: 200). */
  max_events?: number;
  /** Capture a startup baseline snapshot on boot (default: false). */
  capture_startup_snapshot?: boolean;
}

// ===== Secret References =====
export type SecretManagerFailurePolicy = 'fail_closed' | 'fail_open_for_optional';

export interface SecretManagerConfig {
  /** Local in-process cache TTL for resolved references (default: 300 seconds). */
  cache_ttl_seconds?: number;
  /** Runtime behavior when a reference fails to resolve (default: fail_closed). */
  failure_policy?: SecretManagerFailurePolicy;
  /** Env is enabled by default. Vault/AWS/GCP are disabled unless explicitly enabled. */
  backends?: SecretManagerBackendsConfig;
}

export interface SecretManagerBackendsConfig {
  env?: {
    enabled?: boolean;
  };
  vault?: VaultSecretManagerConfig;
  aws_sm?: AwsSecretsManagerConfig;
  gcp_sm?: GcpSecretManagerConfig;
}

export interface VaultSecretManagerConfig {
  enabled?: boolean;
  /** Vault address, for example https://vault.example.com. May use ${env:VAULT_ADDR}. */
  address?: string;
  /** Vault token. May use ${env:VAULT_TOKEN}; never returned by Dashboard APIs. */
  token?: string;
  /** KV mount name used when a reference does not already include /data/. */
  mount?: string;
  /** Vault KV version (default: 2). */
  kv_version?: 1 | 2;
  timeout_ms?: number;
}

export interface AwsSecretsManagerConfig {
  enabled?: boolean;
  region?: string;
  /** Optional custom endpoint for local/mocked Secrets Manager-compatible services. */
  endpoint?: string;
  access_key_id?: string;
  secret_access_key?: string;
  session_token?: string;
  timeout_ms?: number;
}

export interface GcpSecretManagerConfig {
  enabled?: boolean;
  project_id?: string;
  /** Optional custom endpoint for local/mocked Secret Manager-compatible services. */
  endpoint?: string;
  access_token?: string;
  /** Allow Compute metadata token lookup when access_token is omitted (default: true). */
  use_metadata?: boolean;
  timeout_ms?: number;
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

// ===== Cluster =====
export interface ClusterConfig {
  /** Explicit cluster switch. state.backend=redis also enables cluster status/heartbeats. */
  enabled?: boolean;
  /** Stable instance id. Defaults to hostname + process id. */
  instance_id?: string;
  /** Redis override for cluster Pub/Sub. Falls back to state.redis. */
  redis?: RedisStateBackendConfig;
  /** Heartbeat publish/write interval in seconds (default: 10). */
  heartbeat_interval_seconds?: number;
  /** Instance heartbeat TTL in seconds (default: max(30, interval*3)). */
  heartbeat_ttl_seconds?: number;
  /** Broadcast successful local config reloads to peers (default: true). */
  reload_broadcast?: boolean;
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
  synchronize?: boolean; // TypeORM schema sync; keep true for local dev, set false in production Postgres
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
  namespace_id?: string;
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

// ===== Local Namespaces (OSS Data Plane) =====
export interface NamespaceBudgetConfig {
  daily_token_limit?: number;
  daily_cost_limit?: number;
  alert_threshold?: number;
}

export interface NamespaceRateLimitConfig {
  requests_per_minute?: number;
}

export interface NamespaceConfig {
  /** Stable local namespace id. This is not a Cloud workspace/org id. */
  id: string;
  name?: string;
  allowed_nodes?: string[];
  allowed_models?: string[];
  budget?: NamespaceBudgetConfig;
  rate_limit?: NamespaceRateLimitConfig;
}

// ===== Shadow Traffic =====
export interface ShadowTrafficCompareConfig {
  /** Store sanitized prompt/input samples for comparison. Default: false. */
  store_prompts?: boolean;
  /** Store sanitized response samples for comparison. Default: false. */
  store_responses?: boolean;
}

export interface ShadowTrafficConfig {
  /** Master switch. Disabled by default. */
  enabled?: boolean;
  /** 0-1 fraction of eligible successful requests to mirror. Default: 0. */
  sample_rate?: number;
  /** Test node that receives shadow traffic asynchronously. */
  target_node?: string;
  /** Optional target model. Defaults to the primary response/request model. */
  target_model?: string;
  /** Per-shadow request timeout. Default: target node timeout. */
  timeout_ms?: number;
  /** Recent result rows retained for Dashboard. Default: 100. */
  max_recent_results?: number;
  /** Explicit comparison storage opt-in. Defaults keep prompt/response out. */
  compare?: ShadowTrafficCompareConfig;
}

// ===== Node (AI Provider) =====
export type NodeProtocol = 'chat_completions' | 'responses' | 'messages';

export type AuthType = 'bearer' | 'x-api-key';

export type QueuePolicy = 'wait' | 'fallback' | 'reject';

export type HealthCheckMethod = 'HEAD' | 'GET' | 'POST';

export interface ModelCapabilityConfig {
  /** Explicit modalities supported by this model. "vision" remains supported as the legacy image-input alias. */
  modalities?: Modality[];
  /** Endpoint paths or absolute URLs used by future protocol-specific provider calls. */
  endpoints?: Partial<Record<CapabilityEndpoint, string>>;
  /** Input media/data types accepted by this model. */
  input_types?: CapabilityIOType[] | string[];
  /** Output media/data types emitted by this model. */
  output_types?: CapabilityIOType[] | string[];
  /** Maximum accepted uploaded or inline file size in bytes. */
  max_file_size?: number;
  /** Whether this model supports streaming responses. */
  supports_streaming?: boolean;
  /** Whether this model supports realtime sessions/events. */
  supports_realtime?: boolean;
  /** Whether this model supports rerank requests. */
  supports_rerank?: boolean;
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

export interface NodeConnectionConfig {
  /** Enable undici per-node pooling when this block is present (default: true). */
  enabled?: boolean;
  /** Keep upstream sockets alive between requests (default: true). */
  keep_alive?: boolean;
  /** Maximum open upstream sockets for this node (default: 10). */
  pool_size?: number;
  /** Idle keep-alive timeout in milliseconds (default: 60000). */
  keep_alive_ms?: number;
  /** Timeout while waiting for upstream response headers in milliseconds. */
  headers_timeout_ms?: number;
  /** Timeout between upstream response body chunks in milliseconds; 0 disables. */
  body_timeout_ms?: number;
  /** Experimental HTTP/2 ALPN support through undici allowH2 (default: false). */
  http2?: boolean;
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
  /** Optional OpenAI/common-compatible rerank endpoint path (default: /v1/rerank). */
  rerank_endpoint?: string;
  /** Rerank-capable model IDs exposed by this node. */
  rerank_models?: string[];
  /** Optional OpenAI-compatible image generation endpoint path (default: /v1/images/generations). */
  images_generations_endpoint?: string;
  /** Optional OpenAI-compatible image edit endpoint path (default: /v1/images/edits). */
  images_edits_endpoint?: string;
  /** Optional OpenAI-compatible image variation endpoint path (default: /v1/images/variations). */
  images_variations_endpoint?: string;
  /** Image-capable model IDs exposed by this node. */
  image_models?: string[];
  /** Optional OpenAI-compatible audio transcription endpoint path (default: /v1/audio/transcriptions). */
  audio_transcriptions_endpoint?: string;
  /** Optional OpenAI-compatible audio translation endpoint path (default: /v1/audio/translations). */
  audio_translations_endpoint?: string;
  /** Optional OpenAI-compatible text-to-speech endpoint path (default: /v1/audio/speech). */
  audio_speech_endpoint?: string;
  /** Audio-capable model IDs exposed by this node. */
  audio_models?: string[];
  /** Optional OpenAI-compatible video generation endpoint path reserved for video-capable providers. */
  video_generations_endpoint?: string;
  /** Experimental video generation endpoint path (default: /v1/videos/generations). */
  video_endpoint?: string;
  /** Optional endpoint path for async video job status lookups. */
  video_status_endpoint?: string;
  /** Optional endpoint path for async video content retrieval. */
  video_content_endpoint?: string;
  /** Optional endpoint path for async video job cancellation. */
  video_cancel_endpoint?: string;
  /** Video-capable model IDs exposed by this node. */
  video_models?: string[];
  /** Experimental OpenAI-compatible realtime WebSocket endpoint path (default: /v1/realtime). */
  realtime_endpoint?: string;
  /** Realtime-capable model IDs exposed by this node. */
  realtime_models?: string[];
  timeout_ms: number;
  max_concurrency?: number; // Optional per-node upstream concurrency limit
  queue_timeout_ms?: number; // Default: 10000 when max_concurrency is set
  queue_policy?: QueuePolicy; // wait (default) | fallback | reject
  headers?: Record<string, string>;
  health_check?: NodeHealthCheckConfig;
  /** Optional per-node upstream HTTP connection pooling and timeout controls. */
  connection?: NodeConnectionConfig;
  /** Node-level default context window used when a model-specific value is omitted. */
  max_context_tokens?: number;
  /** Node-level default structured-output support flag. */
  structured_output?: boolean;
  /** Node-level default multimodal capability declarations. */
  endpoints?: Partial<Record<CapabilityEndpoint, string>>;
  input_types?: CapabilityIOType[] | string[];
  output_types?: CapabilityIOType[] | string[];
  max_file_size?: number;
  supports_streaming?: boolean;
  supports_realtime?: boolean;
  supports_rerank?: boolean;
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
   * Valid modalities: "text", "vision", "image", "audio", "video", "embedding", "rerank", "realtime"
   * "vision" is kept for backwards compatibility and is treated as compatible with "image".
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
  /** Explicit stream-cache controls. Disabled by default even when cache.enabled=true. */
  stream_cache?: StreamCacheConfig;
}

export interface StreamCacheConfig {
  /** Cache and replay completed stream responses as SSE (default: false). */
  enabled?: boolean;
}

// ===== Model Pricing =====
export interface ModelPricing {
  input: number; // cost per 1M input tokens (USD)
  output: number; // cost per 1M output tokens (USD)
  cache_creation_input?: number; // cost per 1M cache-write tokens (e.g. Anthropic: 1.25x input)
  cache_read_input?: number;     // cost per 1M cache-read tokens (e.g. Anthropic: 0.1x input; OpenAI: 0.5x)
}

// ===== Embedding Batching =====
export interface EmbeddingBatchingConfig {
  /** Master switch (default: false). */
  enabled?: boolean;
  /** Short collection window before dispatching a merged upstream batch. */
  window_ms?: number;
  /** Maximum upstream input items per merged batch. */
  max_batch_size?: number;
  /** Only requests with this many input items or fewer are batched. */
  max_input_items?: number;
  /** Maximum queued embedding requests across local in-memory batches. */
  max_queue?: number;
  /** Per-request queue/dispatch timeout. */
  timeout_ms?: number;
}

// ===== Experimental Realtime Preview =====
export interface RealtimeConfig {
  /** Master switch for the experimental WebSocket proxy. Disabled by default. */
  enabled?: boolean;
  /** Local WebSocket path exposed by the gateway (default: /v1/realtime). */
  path?: string;
  /** Maximum concurrent realtime client connections across this gateway instance. */
  max_connections?: number;
  /** Maximum concurrent realtime connections to a single upstream node. */
  max_connections_per_node?: number;
  /** Close idle client/upstream sessions after this many milliseconds. */
  idle_timeout_ms?: number;
  /** Timeout while opening the upstream realtime WebSocket. */
  upstream_connect_timeout_ms?: number;
  /** Hard cap for a realtime session lifetime. */
  max_session_ms?: number;
  /** Optional default node used when model=auto or no model is supplied. */
  default_node?: string;
  /** Optional default realtime model used when model=auto or no model is supplied. */
  default_model?: string;
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
