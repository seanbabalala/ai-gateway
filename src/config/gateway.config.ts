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
}

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

export interface NodeConfig {
  id: string;
  name: string;
  protocol: NodeProtocol;
  base_url: string;
  endpoint: string;
  api_key: string;
  auth_type?: AuthType; // Default: 'bearer' for chat_completions/responses, 'x-api-key' for messages
  models: string[];
  timeout_ms: number;
  headers?: Record<string, string>;

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
}

// ===== Routing =====
export interface RoutingConfig {
  tiers: Record<string, TierConfig>;
  scoring: ScoringThresholds;
  retry?: RetryConfig;

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

export interface TierConfig {
  primary: RouteTarget;
  fallbacks: RouteTarget[];
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
  /** OTel service name (default: 'ai-gateway') */
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
