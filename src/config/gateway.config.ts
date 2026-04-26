// ===================================================================
// Gateway Configuration — Type Definitions
// ===================================================================
// Types matching the structure of gateway.config.yaml
// ===================================================================

export interface GatewayConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  auth: AuthConfig;
  nodes: NodeConfig[];
  routing: RoutingConfig;
  budget: BudgetConfig;
  models_pricing: Record<string, ModelPricing>;
}

// ===== Server =====
export interface ServerConfig {
  port: number;
  host: string;
}

// ===== Database =====
export interface DatabaseConfig {
  type: 'sqlite' | 'postgres';
  path?: string; // SQLite file path
  url?: string; // PostgreSQL connection URL
}

// ===== Auth =====
export interface AuthConfig {
  api_keys: ApiKeyEntry[];
}

export interface ApiKeyEntry {
  key: string;
  name: string;
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
   * Capability tags — describe what this node is good at.
   * Used by domain-hint routing to prefer nodes matching the request domain.
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

export interface TierConfig {
  primary: RouteTarget;
  fallbacks: RouteTarget[];
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
}

// ===== Budget =====
export interface BudgetConfig {
  daily_token_limit: number;
  daily_cost_limit: number;
  alert_threshold: number;
}

// ===== Model Pricing =====
export interface ModelPricing {
  input: number; // cost per 1M input tokens (USD)
  output: number; // cost per 1M output tokens (USD)
}
