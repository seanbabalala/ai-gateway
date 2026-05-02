import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  GatewayConfig,
  NodeConfig,
  RoutingConfig,
  RetryConfig,
  BudgetConfig,
  CacheConfig,
  ControlPlaneConfig,
  ModelPricing,
  ServerConfig,
  DatabaseConfig,
  AuthConfig,
  DashboardConfig,
} from './gateway.config';
import { buildNodeModelDiagnostics } from './config-diagnostics';
import type { ConfigDiagnostic } from './config-diagnostics';

export type { ConfigDiagnostic, ConfigDiagnosticSeverity } from './config-diagnostics';

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private config!: GatewayConfig;
  private configPath!: string;

  constructor() {
    // Load eagerly in constructor so config is available during module initialization
    // (e.g. TypeORM's forRootAsync factory needs database config before onModuleInit)
    this.loadConfig();
  }

  private loadConfig(): void {
    this.configPath =
      process.env.GATEWAY_CONFIG_PATH ||
      path.resolve(process.cwd(), 'gateway.config.yaml');

    if (!fs.existsSync(this.configPath)) {
      throw new Error(`Configuration file not found: ${this.configPath}`);
    }

    const raw = fs.readFileSync(this.configPath, 'utf8');
    const parsed = yaml.load(raw) as GatewayConfig;

    // Resolve environment variables in string values
    this.config = this.resolveEnvVars(parsed);
    this.warnAboutNodeModelResolutionConflicts();

    this.logger.log(
      `Configuration loaded from ${this.configPath} — ${this.config.nodes.length} node(s) configured`,
    );
  }

  /**
   * Recursively resolve ${ENV_VAR} patterns in string values.
   * Supports default values: ${ENV_VAR:-default}
   */
  private resolveEnvVars<T>(obj: T): T {
    if (typeof obj === 'string') {
      return obj.replace(
        /\$\{([^}]+)\}/g,
        (_match: string, expr: string) => {
          const [envKey, defaultValue] = expr.split(':-');
          const value = process.env[envKey.trim()];
          if (value !== undefined) return value;
          if (defaultValue !== undefined) return defaultValue;
          this.logger.warn(
            `Environment variable ${envKey.trim()} is not set and has no default`,
          );
          return '';
        },
      ) as T;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.resolveEnvVars(item)) as T;
    }

    if (obj !== null && typeof obj === 'object') {
      const resolved: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.resolveEnvVars(value);
      }
      return resolved as T;
    }

    return obj;
  }

  /** Reload configuration from disk (useful for runtime updates) */
  reload(): void {
    this.loadConfig();
    this.logger.log('Configuration reloaded');
  }

  // ===== Accessors =====

  get server(): ServerConfig {
    return this.config.server;
  }

  get database(): DatabaseConfig {
    return this.config.database;
  }

  get auth(): AuthConfig {
    return this.config.auth;
  }

  get dashboard(): DashboardConfig | undefined {
    return this.config.dashboard;
  }

  /** Get the dashboard password hash (if set) */
  get dashboardPasswordHash(): string | undefined {
    return this.config.dashboard?.password;
  }

  /** Update the dashboard password hash and persist to YAML */
  setDashboardPasswordHash(hash: string): void {
    if (!this.config.dashboard) {
      this.config.dashboard = {};
    }
    this.config.dashboard.password = hash;
    this.saveConfig();
    this.logger.log('Dashboard password hash updated');
  }

  get nodes(): NodeConfig[] {
    return this.config.nodes;
  }

  get routing(): RoutingConfig {
    return this.config.routing;
  }

  /** Get retry config with defaults */
  get retry(): RetryConfig {
    const r = this.config.routing.retry;
    return {
      max_retries: r?.max_retries ?? 0,
      backoff_base_ms: r?.backoff_base_ms ?? 500,
      backoff_max_ms: r?.backoff_max_ms ?? 5000,
      retryable_status: r?.retryable_status ?? [429, 502, 503],
    };
  }

  get budget(): BudgetConfig {
    return this.config.budget;
  }

  /** Get cache config with defaults */
  get cache(): CacheConfig {
    const c = this.config.cache;
    return {
      enabled: c?.enabled ?? false,
      ttl_seconds: c?.ttl_seconds ?? 300,
      max_entries: c?.max_entries ?? 1000,
      exclude_tool_use: c?.exclude_tool_use ?? true,
    };
  }

  get modelsPricing(): Record<string, ModelPricing> {
    return this.config.models_pricing;
  }

  /** Get hosted control-plane config with safe privacy-preserving defaults. */
  get controlPlane(): Required<ControlPlaneConfig> & {
    telemetry: {
      upload_interval_seconds: number;
      include_prompt: boolean;
      include_response: boolean;
    };
  } {
    const cp = this.config.control_plane;
    return {
      enabled: cp?.enabled ?? false,
      url: cp?.url ?? '',
      gateway_id: cp?.gateway_id ?? '',
      registration_token: cp?.registration_token ?? '',
      telemetry: {
        upload_interval_seconds: cp?.telemetry?.upload_interval_seconds ?? 30,
        include_prompt: cp?.telemetry?.include_prompt ?? false,
        include_response: cp?.telemetry?.include_response ?? false,
      },
    };
  }

  /** Get a specific node by ID */
  getNode(nodeId: string): NodeConfig | undefined {
    return this.config.nodes.find((n) => n.id === nodeId);
  }

  /** Get pricing for a specific model */
  getModelPricing(model: string): ModelPricing | undefined {
    return this.config.models_pricing[model];
  }

  /** Get the full raw config (for dashboard API) */
  getFullConfig(): GatewayConfig {
    return this.config;
  }

  /** Get structured node/model naming diagnostics for dashboard and tests. */
  getNodeModelDiagnostics(): ConfigDiagnostic[] {
    return buildNodeModelDiagnostics(this.config);
  }

  // ===== Model Resolution =====

  /**
   * Resolve a user-provided model name to { nodeId, model }.
   *
   * Resolution order:
   *   1. Exact match: model ID exists in some node's `models[]`
   *   2. Alias match: model name matches some node's `model_aliases`
   *   3. Node ID shortcut: model name matches a node's `id` → use that node's first model
   *   4. Node prefix match: model name starts with a node's `id` + separator (e.g. "anthropic-prod/my-custom")
   *      → route to that node, pass-through the model name as-is
   *   5. Model-family prefix match: model name starts with the node id or an explicit
   *      `model_prefixes[]` entry followed by "-" (e.g. "claude-opus-4-6")
   *      → route to that node, pass model through as-is
   *   6. null: truly unknown — will fall through to auto routing
   *
   * This design allows users to send ANY model name. If it can be associated
   * with a node, it gets routed there with the model name passed through
   * to the upstream API. The upstream decides if the model is valid.
   */
  resolveModel(name: string): { nodeId: string; model: string } | null {
    // 1. Exact match against node models[]
    for (const node of this.config.nodes) {
      if (node.models.includes(name)) {
        return { nodeId: node.id, model: name };
      }
    }

    // 2. Alias match against node model_aliases
    for (const node of this.config.nodes) {
      if (node.model_aliases) {
        const resolved = node.model_aliases[name];
        if (resolved) {
          return { nodeId: node.id, model: resolved };
        }
      }
    }

    // 3. Node ID shortcut — "claude" → claude node's first model
    const nodeById = this.config.nodes.find((n) => n.id === name);
    if (nodeById) {
      return { nodeId: nodeById.id, model: nodeById.models[0] };
    }

    // 4. Prefix match — "gpt/my-custom-model" or "claude:my-ft" → route to node, pass model through
    const separators = ['/', ':'];
    for (const sep of separators) {
      const idx = name.indexOf(sep);
      if (idx > 0) {
        const prefix = name.substring(0, idx);
        const modelPart = name.substring(idx + 1);
        const prefixNode = this.config.nodes.find((n) => n.id === prefix);
        if (prefixNode && modelPart) {
          return { nodeId: prefixNode.id, model: modelPart };
        }
      }
    }

    // 5. Model-family prefix match — "claude-opus-4-6" → anthropic node, pass model through
    for (const node of this.config.nodes) {
      const prefixes = [node.id, ...(node.model_prefixes || [])];
      for (const prefix of prefixes) {
        if (prefix && name.startsWith(`${prefix}-`)) {
          return { nodeId: node.id, model: name };
        }
      }
    }

    // 6. Not found
    return null;
  }

  /**
   * Get all available models (for GET /v1/models endpoint).
   * Returns model IDs, aliases, and node ID shortcuts.
   */
  listModels(): {
    id: string;
    node: string;
    nodeName: string;
    aliases: string[];
    isAlias: boolean;
  }[] {
    const models: {
      id: string;
      node: string;
      nodeName: string;
      aliases: string[];
      isAlias: boolean;
    }[] = [];

    for (const node of this.config.nodes) {
      for (const modelId of node.models) {
        // Collect all aliases pointing to this model
        const aliases: string[] = [];
        if (node.model_aliases) {
          for (const [alias, target] of Object.entries(node.model_aliases)) {
            if (target === modelId) {
              aliases.push(alias);
            }
          }
        }
        // Node ID is always an implicit alias for models[0]
        if (modelId === node.models[0]) {
          aliases.push(node.id);
        }

        models.push({
          id: modelId,
          node: node.id,
          nodeName: node.name,
          aliases,
          isAlias: false,
        });
      }
    }

    return models;
  }

  // ===== Config Persistence =====

  /**
   * Write the current in-memory config back to the YAML file.
   * We re-read the raw file first to preserve any env-var placeholders,
   * then patch the nodes / models_pricing sections and write back.
   *
   * NOTE: For simplicity, we dump the full config. Environment variable
   * references (${VAR}) will be replaced with their resolved values.
   * This is intentional — once a value is edited via the dashboard,
   * the literal value is persisted.
   */
  private saveConfig(): void {
    const yamlStr = yaml.dump(this.config, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    });
    fs.writeFileSync(this.configPath, yamlStr, 'utf8');
    this.logger.log(`Configuration saved to ${this.configPath}`);
  }

  // ===== Node CRUD =====

  /** Add a new node. Throws if a node with the same ID already exists. */
  addNode(node: NodeConfig): void {
    if (this.config.nodes.some((n) => n.id === node.id)) {
      throw new Error(`Node with id "${node.id}" already exists`);
    }
    this.config.nodes.push(node);
    this.warnAboutNodeModelResolutionConflicts();
    this.saveConfig();
    this.logger.log(`Node "${node.id}" added`);
  }

  /**
   * Update an existing node. The `id` field cannot be changed.
   * Only provided fields are merged; omitted fields keep their current value.
   */
  updateNode(nodeId: string, updates: Partial<Omit<NodeConfig, 'id'>>): void {
    const idx = this.config.nodes.findIndex((n) => n.id === nodeId);
    if (idx === -1) {
      throw new Error(`Node "${nodeId}" not found`);
    }
    this.config.nodes[idx] = { ...this.config.nodes[idx], ...updates, id: nodeId };
    this.warnAboutNodeModelResolutionConflicts();
    this.saveConfig();
    this.logger.log(`Node "${nodeId}" updated`);
  }

  /**
   * Delete a node by ID. Also cleans up routing references.
   * Throws if trying to delete the last remaining node.
   */
  deleteNode(nodeId: string): void {
    const idx = this.config.nodes.findIndex((n) => n.id === nodeId);
    if (idx === -1) {
      throw new Error(`Node "${nodeId}" not found`);
    }
    if (this.config.nodes.length <= 1) {
      throw new Error('Cannot delete the last remaining node');
    }

    this.config.nodes.splice(idx, 1);
    this.cleanupRoutingReferences(nodeId);
    this.saveConfig();
    this.logger.log(`Node "${nodeId}" deleted`);
  }

  /**
   * Remove a deleted node from all routing tier references.
   * - If the node is a fallback, simply remove it from the fallbacks array
   * - If the node is the primary, promote the first fallback to primary
   * - If no fallbacks remain, assign the first available node
   */
  private cleanupRoutingReferences(deletedNodeId: string): void {
    const tiers = this.config.routing.tiers;
    const firstAvailableNodeId = this.config.nodes[0]?.id;

    for (const [tierName, tierConfig] of Object.entries(tiers)) {
      // Remove from fallbacks
      tierConfig.fallbacks = tierConfig.fallbacks.filter(
        (fb) => fb.node !== deletedNodeId,
      );

      // If primary was the deleted node, promote
      if (tierConfig.primary.node === deletedNodeId) {
        if (tierConfig.fallbacks.length > 0) {
          tierConfig.primary = tierConfig.fallbacks.shift()!;
        } else if (firstAvailableNodeId) {
          // Assign first available node with its first model
          const fallbackNode = this.config.nodes[0];
          tierConfig.primary = {
            node: fallbackNode.id,
            model: fallbackNode.models[0],
          };
        }
        this.logger.warn(
          `Tier "${tierName}": primary was deleted node "${deletedNodeId}", promoted new primary`,
        );
      }

      // Clean up split variants referencing the deleted node
      if (tierConfig.split) {
        tierConfig.split = tierConfig.split.filter(v => v.node !== deletedNodeId);
        if (tierConfig.split.length === 0) {
          delete tierConfig.split;  // All variants removed, disable split
        } else {
          // Renormalize weights to sum to 100
          const total = tierConfig.split.reduce((s, v) => s + v.weight, 0);
          if (total !== 100 && total > 0) {
            tierConfig.split.forEach(v => { v.weight = Math.round(v.weight * 100 / total); });
          }
        }
      }
    }

    // Clean up domain_preferences
    if (this.config.routing.domain_preferences) {
      for (const [domain, nodeIds] of Object.entries(
        this.config.routing.domain_preferences,
      )) {
        this.config.routing.domain_preferences[domain] = nodeIds.filter(
          (id) => id !== deletedNodeId,
        );
      }
    }
  }

  /**
   * Direct model resolution is intentionally permissive, but ambiguous names
   * are hard for users to reason about. Warn instead of throwing so existing
   * configs keep working while operators get a clear fix path.
   */
  private warnAboutNodeModelResolutionConflicts(): void {
    for (const diagnostic of buildNodeModelDiagnostics(this.config)) {
      this.logger.warn(diagnostic.message);
    }
  }

  // ===== Model Pricing CRUD =====

  /** Set or update pricing for a model. */
  setModelPricing(model: string, pricing: ModelPricing): void {
    this.config.models_pricing[model] = pricing;
    this.saveConfig();
    this.logger.log(`Pricing set for model "${model}"`);
  }

  /** Delete pricing for a model. */
  deleteModelPricing(model: string): void {
    if (!(model in this.config.models_pricing)) {
      throw new Error(`Pricing for model "${model}" not found`);
    }
    delete this.config.models_pricing[model];
    this.saveConfig();
    this.logger.log(`Pricing deleted for model "${model}"`);
  }

  // ===== Routing Update =====

  /** Update routing configuration (tiers, scoring thresholds, domain preferences). */
  updateRouting(updates: {
    tiers?: Record<string, {
      primary: { node: string; model: string };
      fallbacks: { node: string; model: string }[];
      split?: { node: string; model: string; weight: number; name?: string }[];
    }>;
    scoring?: { simple_max: number; standard_max: number; complex_max: number };
    domain_preferences?: Record<string, string[]>;
  }): void {
    if (updates.tiers) {
      // Validate all referenced nodes exist
      for (const [tierName, tier] of Object.entries(updates.tiers)) {
        this.validateRouteTarget(tier.primary, tierName, 'primary');
        tier.fallbacks.forEach((fb, i) => this.validateRouteTarget(fb, tierName, `fallback[${i}]`));

        // Validate split variants if present
        if (tier.split) {
          const totalWeight = tier.split.reduce((sum, v) => sum + v.weight, 0);
          if (totalWeight !== 100) {
            throw new Error(`Tier "${tierName}" split weights must sum to 100, got ${totalWeight}`);
          }
          for (const v of tier.split) {
            this.validateRouteTarget({ node: v.node, model: v.model }, tierName, 'split variant');
          }
        }
      }
      this.config.routing.tiers = updates.tiers;
    }
    if (updates.scoring) {
      this.config.routing.scoring = updates.scoring;
    }
    if (updates.domain_preferences !== undefined) {
      this.config.routing.domain_preferences = updates.domain_preferences;
    }
    this.saveConfig();
    this.logger.log('Routing configuration updated');
  }

  private validateRouteTarget(
    target: { node: string; model: string },
    tierName: string,
    label: string,
  ): void {
    const node = this.config.nodes.find((n) => n.id === target.node);
    if (!node) {
      throw new Error(`Tier "${tierName}" ${label}: node "${target.node}" not found`);
    }
  }
}
