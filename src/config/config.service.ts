import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Subject, Subscription } from 'rxjs';
import {
  GatewayConfig,
  NodeConfig,
  RoutingConfig,
  RetryConfig,
  BudgetConfig,
  CacheConfig,
  ControlPlaneConfig,
  HotReloadConfig,
  ModelPricing,
  ServerConfig,
  DatabaseConfig,
  AuthConfig,
  DashboardConfig,
  FallbackPolicyConfig,
} from './gateway.config';
import { buildNodeModelDiagnostics } from './config-diagnostics';
import type { ConfigDiagnostic } from './config-diagnostics';
import type { EventBusService } from '../plugins/event-bus.service';

export type { ConfigDiagnostic, ConfigDiagnosticSeverity } from './config-diagnostics';

export type ConfigReloadSource = 'manual' | 'dashboard' | 'sighup' | 'watcher';

export interface ConfigSnapshot {
  version: number;
  loaded_at: string;
  path: string;
  node_count: number;
  node_ids: string[];
  route_tiers: string[];
  control_plane_enabled: boolean;
  hot_reload_watch: boolean;
}

export interface ConfigChangeSummary {
  nodes_added: string[];
  nodes_removed: string[];
  nodes_changed: boolean;
  routing_changed: boolean;
  budget_changed: boolean;
  pricing_changed: boolean;
  control_plane_changed: boolean;
  hot_reload_changed: boolean;
}

export interface ConfigReloadResult {
  success: boolean;
  source: ConfigReloadSource;
  message: string;
  previous: ConfigSnapshot;
  current: ConfigSnapshot;
  changed: ConfigChangeSummary;
  rolled_back: boolean;
  error?: {
    name: string;
    message: string;
  };
}

export interface ConfigReloadOptions {
  source?: ConfigReloadSource;
  throwOnError?: boolean;
}

export class ConfigReloadError extends Error {
  constructor(public readonly result: ConfigReloadResult) {
    super(result.message);
    this.name = 'ConfigReloadError';
  }
}

@Injectable()
export class ConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConfigService.name);
  private config!: GatewayConfig;
  private configPath!: string;
  private configVersion = 0;
  private loadedAt = new Date(0);
  private eventBus?: EventBusService;
  private readonly reloadSubject = new Subject<ConfigReloadResult>();
  private sighupHandler?: NodeJS.SignalsListener;
  private configWatcher?: fs.FSWatcher;
  private watcherDebounceTimer?: NodeJS.Timeout;
  private watcherDebounceMs = 0;

  constructor() {
    // Load eagerly in constructor so config is available during module initialization
    // (e.g. TypeORM's forRootAsync factory needs database config before onModuleInit)
    this.loadConfig();
  }

  onModuleInit(): void {
    this.registerSighupHandler();
    this.syncConfigWatcher();
  }

  onModuleDestroy(): void {
    this.unregisterSighupHandler();
    this.stopConfigWatcher();
    this.reloadSubject.complete();
  }

  setEventBus(eventBus: EventBusService): void {
    this.eventBus = eventBus;
  }

  private loadConfig(): void {
    this.configPath = this.resolveConfigPath();
    const nextConfig = this.loadConfigFromDisk();
    this.commitConfig(nextConfig);

    this.logger.log(
      `Configuration loaded from ${this.configPath} — ${this.config.nodes.length} node(s) configured`,
    );
  }

  private resolveConfigPath(): string {
    return (
      process.env.GATEWAY_CONFIG_PATH ||
      path.resolve(process.cwd(), 'gateway.config.yaml')
    );
  }

  private loadConfigFromDisk(): GatewayConfig {
    if (!fs.existsSync(this.configPath)) {
      throw new Error(`Configuration file not found: ${this.configPath}`);
    }
    const raw = fs.readFileSync(this.configPath, 'utf8');
    const parsed = yaml.load(raw) as GatewayConfig;
    const resolved = this.resolveEnvVars(parsed) as GatewayConfig;
    this.normalizeConfig(resolved);
    this.validateConfigShape(resolved);
    return resolved;
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

  private normalizeConfig(config: GatewayConfig): void {
    if (config && typeof config === 'object') {
      config.auth ??= { api_keys: [] };
      config.models_pricing ??= {};
      if (config.routing?.tiers) {
        for (const tier of Object.values(config.routing.tiers)) {
          tier.fallbacks ??= [];
        }
      }
    }
  }

  private validateConfigShape(config: GatewayConfig): void {
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid configuration: YAML root must be an object');
    }
    if (!config.server || typeof config.server !== 'object') {
      throw new Error('Invalid configuration: server is required');
    }
    if (!config.database || typeof config.database !== 'object') {
      throw new Error('Invalid configuration: database is required');
    }
    if (!Array.isArray(config.nodes) || config.nodes.length === 0) {
      throw new Error('Invalid configuration: nodes must be a non-empty array');
    }
    for (const [idx, node] of config.nodes.entries()) {
      if (!node?.id || !node.name || !node.protocol || !node.base_url || !node.endpoint) {
        throw new Error(`Invalid configuration: nodes[${idx}] is missing required fields`);
      }
      if (!Array.isArray(node.models) || node.models.length === 0) {
        throw new Error(`Invalid configuration: node "${node.id}" must define at least one model`);
      }
    }
    if (!config.routing?.tiers || typeof config.routing.tiers !== 'object') {
      throw new Error('Invalid configuration: routing.tiers is required');
    }
    if (!config.routing.scoring || typeof config.routing.scoring !== 'object') {
      throw new Error('Invalid configuration: routing.scoring is required');
    }
    for (const [tierName, tier] of Object.entries(config.routing.tiers)) {
      const hasTargets = Array.isArray(tier?.targets) && tier.targets.length > 0;
      if (!hasTargets && (!tier?.primary?.node || !tier.primary.model)) {
        throw new Error(`Invalid configuration: routing.tiers.${tierName}.primary is required`);
      }
      if (!hasTargets && !Array.isArray(tier.fallbacks)) {
        throw new Error(`Invalid configuration: routing.tiers.${tierName}.fallbacks must be an array`);
      }
    }
    if (!config.budget || typeof config.budget !== 'object') {
      throw new Error('Invalid configuration: budget is required');
    }
  }

  private commitConfig(config: GatewayConfig): void {
    this.config = config;
    this.configVersion += 1;
    this.loadedAt = new Date();
    this.warnAboutNodeModelResolutionConflicts();
  }

  /** Reload configuration from disk with atomic swap and rollback-on-failure semantics. */
  reload(options: ConfigReloadOptions = {}): ConfigReloadResult {
    const source = options.source ?? 'manual';
    const throwOnError = options.throwOnError ?? true;
    const previousConfig = this.config;
    const previous = this.getSnapshot();

    try {
      const nextConfig = this.loadConfigFromDisk();
      const changed = this.describeChanges(previousConfig, nextConfig);
      this.commitConfig(nextConfig);
      const current = this.getSnapshot();
      const result: ConfigReloadResult = {
        success: true,
        source,
        message: 'Configuration reloaded',
        previous,
        current,
        changed,
        rolled_back: false,
      };

      this.logger.log(
        `Configuration reloaded from ${this.configPath} — version ${current.version}`,
      );
      this.emitReloadResult(result);
      this.syncConfigWatcher();
      return result;
    } catch (err) {
      const error = err as Error;
      const current = this.getSnapshot();
      const result: ConfigReloadResult = {
        success: false,
        source,
        message: `Configuration reload failed; retained previous config: ${error.message}`,
        previous,
        current,
        changed: this.emptyChangeSummary(),
        rolled_back: true,
        error: {
          name: error.name || 'Error',
          message: error.message,
        },
      };

      this.logger.error(result.message);
      this.emitReloadResult(result);
      if (throwOnError) {
        throw new ConfigReloadError(result);
      }
      return result;
    }
  }

  onReload(
    handler: (result: ConfigReloadResult) => void | Promise<void>,
  ): Subscription {
    return this.reloadSubject.subscribe((result) => {
      try {
        const maybePromise = handler(result);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.catch((err) => {
            this.logger.error(`Config reload handler failed: ${(err as Error).message}`);
          });
        }
      } catch (err) {
        this.logger.error(`Config reload handler failed: ${(err as Error).message}`);
      }
    });
  }

  onReloadSuccess(
    handler: (result: ConfigReloadResult) => void | Promise<void>,
  ): Subscription {
    return this.onReload((result) => {
      if (result.success) {
        return handler(result);
      }
      return undefined;
    });
  }

  onReloadFailed(
    handler: (result: ConfigReloadResult) => void | Promise<void>,
  ): Subscription {
    return this.onReload((result) => {
      if (!result.success) {
        return handler(result);
      }
      return undefined;
    });
  }

  getSnapshot(): ConfigSnapshot {
    return {
      version: this.configVersion,
      loaded_at: this.loadedAt.toISOString(),
      path: this.configPath,
      node_count: this.config.nodes.length,
      node_ids: this.config.nodes.map((node) => node.id),
      route_tiers: Object.keys(this.config.routing.tiers || {}),
      control_plane_enabled: Boolean(this.config.control_plane?.enabled),
      hot_reload_watch: Boolean(this.config.hot_reload?.watch),
    };
  }

  private emitReloadResult(result: ConfigReloadResult): void {
    this.reloadSubject.next(result);
    const topic = result.success ? 'config.reload.success' : 'config.reload.failed';
    try {
      this.eventBus?.emit(topic, result);
    } catch (err) {
      this.logger.error(`Failed to emit ${topic}: ${(err as Error).message}`);
    }
  }

  private registerSighupHandler(): void {
    if (this.sighupHandler) return;
    this.sighupHandler = () => {
      this.logger.log('SIGHUP received; reloading configuration');
      this.reload({ source: 'sighup', throwOnError: false });
    };
    process.on('SIGHUP', this.sighupHandler);
  }

  private unregisterSighupHandler(): void {
    if (!this.sighupHandler) return;
    process.off('SIGHUP', this.sighupHandler);
    this.sighupHandler = undefined;
  }

  private syncConfigWatcher(): void {
    const hotReload = this.hotReload;
    if (!hotReload.watch) {
      this.stopConfigWatcher();
      return;
    }
    if (this.configWatcher && this.watcherDebounceMs === hotReload.debounce_ms) {
      return;
    }
    this.stopConfigWatcher();
    this.startConfigWatcher(hotReload.debounce_ms);
  }

  private startConfigWatcher(debounceMs: number): void {
    try {
      this.configWatcher = fs.watch(this.configPath, { persistent: false }, () => {
        if (this.watcherDebounceTimer) {
          clearTimeout(this.watcherDebounceTimer);
        }
        this.watcherDebounceTimer = setTimeout(() => {
          this.reload({ source: 'watcher', throwOnError: false });
        }, debounceMs);
        this.watcherDebounceTimer.unref?.();
      });
      this.configWatcher.on('error', (err) => {
        this.logger.warn(`Config watcher error: ${err.message}`);
      });
      this.watcherDebounceMs = debounceMs;
      this.logger.log(`Config file watcher enabled (${debounceMs}ms debounce)`);
    } catch (err) {
      this.logger.warn(`Failed to start config watcher: ${(err as Error).message}`);
    }
  }

  private stopConfigWatcher(): void {
    if (this.watcherDebounceTimer) {
      clearTimeout(this.watcherDebounceTimer);
      this.watcherDebounceTimer = undefined;
    }
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = undefined;
      this.watcherDebounceMs = 0;
    }
  }

  private describeChanges(
    previous: GatewayConfig,
    next: GatewayConfig,
  ): ConfigChangeSummary {
    const previousNodeIds = new Set(previous.nodes.map((node) => node.id));
    const nextNodeIds = new Set(next.nodes.map((node) => node.id));
    return {
      nodes_added: [...nextNodeIds].filter((id) => !previousNodeIds.has(id)),
      nodes_removed: [...previousNodeIds].filter((id) => !nextNodeIds.has(id)),
      nodes_changed: JSON.stringify(previous.nodes) !== JSON.stringify(next.nodes),
      routing_changed: JSON.stringify(previous.routing) !== JSON.stringify(next.routing),
      budget_changed: JSON.stringify(previous.budget) !== JSON.stringify(next.budget),
      pricing_changed: JSON.stringify(previous.models_pricing) !== JSON.stringify(next.models_pricing),
      control_plane_changed: JSON.stringify(previous.control_plane || null) !== JSON.stringify(next.control_plane || null),
      hot_reload_changed: JSON.stringify(previous.hot_reload || null) !== JSON.stringify(next.hot_reload || null),
    };
  }

  private emptyChangeSummary(): ConfigChangeSummary {
    return {
      nodes_added: [],
      nodes_removed: [],
      nodes_changed: false,
      routing_changed: false,
      budget_changed: false,
      pricing_changed: false,
      control_plane_changed: false,
      hot_reload_changed: false,
    };
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

  /** Get v0.3 fallback policy with conservative defaults. */
  get fallbackPolicy(): Required<FallbackPolicyConfig> & {
    timeout: {
      enabled: boolean;
      threshold_ms?: number;
      race_fallback: boolean;
    };
    structured_output: {
      enabled: boolean;
      fallback_on_parse_error: boolean;
      fallback_on_schema_error: boolean;
    };
    cost_downgrade: {
      enabled: boolean;
      max_estimated_cost_usd?: number;
    };
  } {
    const policy = this.config.routing.fallback_policy;
    return {
      immediate_429: policy?.immediate_429 ?? false,
      timeout: {
        enabled: policy?.timeout?.enabled ?? false,
        threshold_ms: policy?.timeout?.threshold_ms,
        race_fallback: policy?.timeout?.race_fallback ?? false,
      },
      structured_output: {
        enabled: policy?.structured_output?.enabled ?? false,
        fallback_on_parse_error:
          policy?.structured_output?.fallback_on_parse_error ?? true,
        fallback_on_schema_error:
          policy?.structured_output?.fallback_on_schema_error ?? true,
      },
      cost_downgrade: {
        enabled: policy?.cost_downgrade?.enabled ?? false,
        max_estimated_cost_usd:
          policy?.cost_downgrade?.max_estimated_cost_usd,
      },
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

  get hotReload(): Required<HotReloadConfig> {
    const hotReload = this.config.hot_reload;
    return {
      watch: hotReload?.watch ?? false,
      debounce_ms: hotReload?.debounce_ms ?? 500,
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
      tierConfig.fallbacks = (tierConfig.fallbacks || []).filter(
        (fb) => fb.node !== deletedNodeId,
      );

      // If primary was the deleted node, promote
      if (tierConfig.primary?.node === deletedNodeId) {
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

      if (tierConfig.targets) {
        tierConfig.targets = tierConfig.targets.filter(t => t.node !== deletedNodeId);
        if (tierConfig.targets.length === 0) {
          delete tierConfig.targets;
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
      primary?: { node: string; model: string };
      fallbacks?: { node: string; model: string }[];
      strategy?: 'weighted' | 'round_robin' | 'least_latency' | 'random';
      targets?: { node: string; model: string; weight?: number; name?: string }[];
      split?: { node: string; model: string; weight: number; name?: string }[];
    }>;
    scoring?: { simple_max: number; standard_max: number; complex_max: number };
    domain_preferences?: Record<string, string[]>;
  }): void {
    if (updates.tiers) {
      // Validate all referenced nodes exist
      for (const [tierName, tier] of Object.entries(updates.tiers)) {
        if (!tier.primary && (!tier.targets || tier.targets.length === 0)) {
          throw new Error(`Tier "${tierName}" must define primary or targets`);
        }
        if (tier.strategy && !['weighted', 'round_robin', 'least_latency', 'random'].includes(tier.strategy)) {
          throw new Error(`Tier "${tierName}" strategy "${tier.strategy}" is not supported`);
        }
        if (tier.primary) {
          this.validateRouteTarget(tier.primary, tierName, 'primary');
        }
        (tier.fallbacks || []).forEach((fb, i) => this.validateRouteTarget(fb, tierName, `fallback[${i}]`));
        if (tier.targets) {
          if (tier.targets.length === 0) {
            throw new Error(`Tier "${tierName}" targets must not be empty`);
          }
          let totalWeight = 0;
          for (const [idx, target] of tier.targets.entries()) {
            this.validateRouteTarget(target, tierName, `targets[${idx}]`);
            const weight = target.weight ?? 1;
            if (weight < 0) {
              throw new Error(`Tier "${tierName}" targets[${idx}] weight must be >= 0`);
            }
            totalWeight += weight;
          }
          if ((tier.strategy || 'weighted') === 'weighted' && totalWeight <= 0) {
            throw new Error(`Tier "${tierName}" weighted targets must have total weight > 0`);
          }
        }

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
