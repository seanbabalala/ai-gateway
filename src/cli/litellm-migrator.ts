import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  GatewayConfig,
  LoadBalancingStrategy,
  NodeConfig,
  RouteTarget,
  RoutingOptimization,
} from '../config/gateway.config';

export interface MigrationReportItem {
  path: string;
  message: string;
  suggestion?: string;
}

export interface MigrationReport {
  compatible: MigrationReportItem[];
  incompatible: MigrationReportItem[];
  manual: MigrationReportItem[];
}

export interface LiteLlmMigrationResult {
  sourcePath: string;
  outputPath?: string;
  config: GatewayConfig;
  yaml: string;
  report: MigrationReport;
}

export type MigrationConfigType = 'siftgate' | 'litellm' | 'newapi' | 'oneapi';

export interface ConfigMigrationResult {
  sourceType: MigrationConfigType;
  targetType: MigrationConfigType;
  sourcePath: string;
  outputPath?: string;
  /** Target-format object. For target=siftgate this is a GatewayConfig. */
  output: unknown;
  /** Convenience alias when target=siftgate. */
  config?: GatewayConfig;
  yaml: string;
  report: MigrationReport;
}

export interface MigrateConfigFileOptions {
  from: MigrationConfigType;
  to?: MigrationConfigType;
  configPath: string;
  cwd?: string;
  outputPath?: string;
  overwrite?: boolean;
  write?: boolean;
}

interface LiteLlmModelEntry {
  model_name?: unknown;
  litellm_params?: Record<string, unknown>;
  model_info?: Record<string, unknown>;
}

interface NormalizedLiteLlmModel {
  index: number;
  modelName: string;
  upstreamModel: string;
  provider: string;
  params: Record<string, unknown>;
  info: Record<string, unknown>;
}

interface ProviderDefaults {
  protocol: NodeConfig['protocol'];
  baseUrl?: string;
  endpoint: string;
  authType?: NodeConfig['auth_type'];
  apiKeyEnv: string;
  headers?: Record<string, string>;
}

export interface MigrateLiteLlmFileOptions {
  configPath: string;
  cwd?: string;
  outputPath?: string;
  overwrite?: boolean;
  write?: boolean;
}

interface NormalizedChannelEntry {
  index: number;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  aliases: Record<string, string>;
  weight: number;
  disabled: boolean;
  rawType?: string | number;
  raw: Record<string, unknown>;
}

const DEFAULT_PROVIDER: ProviderDefaults = {
  protocol: 'chat_completions',
  endpoint: '/v1/chat/completions',
  apiKeyEnv: 'OPENAI_API_KEY',
};

const PROVIDERS: Record<string, ProviderDefaults> = {
  anthropic: {
    protocol: 'messages',
    baseUrl: 'https://api.anthropic.com',
    endpoint: '/v1/messages',
    authType: 'x-api-key',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    headers: { 'anthropic-version': '2023-06-01' },
  },
  azure: {
    protocol: 'chat_completions',
    endpoint: '/openai/deployments/{model}/chat/completions?api-version={apiVersion}',
    authType: 'x-api-key',
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
  },
  azure_ai: {
    protocol: 'chat_completions',
    endpoint: '/openai/deployments/{model}/chat/completions?api-version={apiVersion}',
    authType: 'x-api-key',
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
  },
  openai: {
    protocol: 'chat_completions',
    baseUrl: 'https://api.openai.com',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  openai_compatible: DEFAULT_PROVIDER,
  custom_openai: DEFAULT_PROVIDER,
  groq: {
    protocol: 'chat_completions',
    baseUrl: 'https://api.groq.com/openai',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'GROQ_API_KEY',
  },
  mistral: {
    protocol: 'chat_completions',
    baseUrl: 'https://api.mistral.ai',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'MISTRAL_API_KEY',
  },
  openrouter: {
    protocol: 'chat_completions',
    baseUrl: 'https://openrouter.ai/api',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
  perplexity: {
    protocol: 'chat_completions',
    baseUrl: 'https://api.perplexity.ai',
    endpoint: '/chat/completions',
    apiKeyEnv: 'PERPLEXITY_API_KEY',
  },
  together_ai: {
    protocol: 'chat_completions',
    baseUrl: 'https://api.together.xyz',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'TOGETHER_API_KEY',
  },
};

const CHANNEL_TYPE_PROVIDERS: Record<number, string> = {
  1: 'openai',
  3: 'azure',
  8: 'openai_compatible',
  14: 'anthropic',
};

const KNOWN_ROUTING_OPTIMIZATIONS = new Set<RoutingOptimization>([
  'cost',
  'latency',
  'balanced',
  'quality',
]);

export function migrateLiteLlmConfigFile(
  options: MigrateLiteLlmFileOptions,
): LiteLlmMigrationResult {
  const cwd = options.cwd || process.cwd();
  const sourcePath = path.resolve(cwd, options.configPath);
  const raw = fs.readFileSync(sourcePath, 'utf8');
  const parsed = yaml.load(raw);
  const result = migrateLiteLlmConfig(parsed, sourcePath);
  const outputPath = options.outputPath
    ? path.resolve(cwd, options.outputPath)
    : path.resolve(cwd, 'gateway.config.yaml');

  if (options.write !== false) {
    if (fs.existsSync(outputPath) && options.overwrite !== true) {
      throw new Error(
        `Refusing to overwrite existing ${outputPath}. Use --out with a new path or pass --overwrite.`,
      );
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, result.yaml, 'utf8');
  }

  return { ...result, outputPath };
}

export function migrateConfigFile(
  options: MigrateConfigFileOptions,
): ConfigMigrationResult {
  const cwd = options.cwd || process.cwd();
  const sourcePath = path.resolve(cwd, options.configPath);
  const raw = fs.readFileSync(sourcePath, 'utf8');
  const parsed = yaml.load(raw);
  const result = migrateConfig(parsed, {
    from: options.from,
    to: options.to,
    sourcePath,
  });
  const outputPath = options.outputPath
    ? path.resolve(cwd, options.outputPath)
    : path.resolve(
        cwd,
        result.targetType === 'siftgate'
          ? 'gateway.config.yaml'
          : `${result.targetType}.generated.yaml`,
      );

  if (options.write !== false) {
    if (fs.existsSync(outputPath) && options.overwrite !== true) {
      throw new Error(
        `Refusing to overwrite existing ${outputPath}. Use --out with a new path or pass --overwrite.`,
      );
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, result.yaml, 'utf8');
  }

  return { ...result, outputPath };
}

export function migrateConfig(
  value: unknown,
  options: {
    from: MigrationConfigType;
    to?: MigrationConfigType;
    sourcePath?: string;
  },
): ConfigMigrationResult {
  const sourcePath = options.sourcePath || `${options.from}.config.yaml`;
  const targetType = options.to || 'siftgate';

  if (options.from === targetType) {
    throw new Error(`Migration source and target are both "${options.from}".`);
  }

  if (targetType === 'siftgate') {
    if (options.from === 'litellm') {
      const result = migrateLiteLlmConfig(value, sourcePath);
      return {
        sourceType: 'litellm',
        targetType,
        sourcePath,
        output: result.config,
        config: result.config,
        yaml: result.yaml,
        report: result.report,
      };
    }

    if (options.from === 'newapi' || options.from === 'oneapi') {
      const result = migrateChannelConfigToSiftGate(value, options.from, sourcePath);
      return {
        sourceType: options.from,
        targetType,
        sourcePath,
        output: result.config,
        config: result.config,
        yaml: result.yaml,
        report: result.report,
      };
    }
  }

  if (options.from === 'siftgate') {
    const config = normalizeSiftGateConfig(value);
    if (targetType === 'litellm') {
      return exportSiftGateConfig(config, targetType, sourcePath);
    }
    if (targetType === 'newapi' || targetType === 'oneapi') {
      return exportSiftGateConfig(config, targetType, sourcePath);
    }
  }

  throw new Error(
    `Unsupported migration path: --from ${options.from} --to ${targetType}.`,
  );
}

export function migrateLiteLlmConfig(
  value: unknown,
  sourcePath = 'litellm_config.yaml',
): LiteLlmMigrationResult {
  if (!isRecord(value)) {
    throw new Error('LiteLLM config must be a YAML object.');
  }

  const report = emptyReport();
  const modelList = value.model_list;
  if (!Array.isArray(modelList) || modelList.length === 0) {
    throw new Error('LiteLLM config must contain a non-empty model_list array.');
  }

  const models = modelList
    .map((entry, index) => normalizeModelEntry(entry, index, report))
    .filter((entry): entry is NormalizedLiteLlmModel => entry !== null);

  if (models.length === 0) {
    throw new Error('No LiteLLM model_list entries could be migrated.');
  }

  const nodes = models.map((entry) => buildNode(entry, report));
  const targetByModelName = buildTargetLookup(models, nodes);
  const routerSettings = isRecord(value.router_settings)
    ? value.router_settings
    : {};
  const routing = buildRouting(models, nodes, targetByModelName, routerSettings, report);
  const modelsPricing = buildModelsPricing(models, report);

  if (isRecord(value.litellm_settings)) {
    report.manual.push({
      path: 'litellm_settings',
      message: 'Global LiteLLM runtime settings do not map directly to SiftGate.',
      suggestion: 'Review timeout, telemetry, cache, and provider-specific options manually.',
    });
  }

  const config: GatewayConfig = {
    server: { port: 2099, host: '0.0.0.0' },
    database: { type: 'sqlite', path: './data/gateway.db' },
    auth: { api_keys: [] },
    nodes,
    routing,
    budget: {
      daily_token_limit: 5_000_000,
      daily_cost_limit: 50,
      alert_threshold: 0.8,
    },
    models_pricing: modelsPricing,
    cache: {
      enabled: false,
      ttl_seconds: 300,
      max_entries: 1000,
      exclude_tool_use: true,
    },
    telemetry: { enabled: false },
  };

  const outputYaml = dumpGatewayConfig(config, report, sourcePath);
  return {
    sourcePath,
    config,
    yaml: outputYaml,
    report,
  };
}

export function formatMigrationReport(result: LiteLlmMigrationResult): string {
  const lines = [
    'SiftGate LiteLLM migration',
    `Source: ${path.resolve(result.sourcePath)}`,
  ];
  if (result.outputPath) {
    lines.push(`Output: ${path.resolve(result.outputPath)}`);
  }
  lines.push(
    '',
    formatReportGroup('Compatible', result.report.compatible),
    '',
    formatReportGroup('Incompatible', result.report.incompatible),
    '',
    formatReportGroup('Manual review', result.report.manual),
  );
  return lines.join('\n');
}

export function formatConfigMigrationReport(result: ConfigMigrationResult): string {
  const lines = [
    'SiftGate config migration',
    `Source: ${result.sourceType} (${path.resolve(result.sourcePath)})`,
    `Target: ${result.targetType}`,
  ];
  if (result.outputPath) {
    lines.push(`Output: ${path.resolve(result.outputPath)}`);
  }
  lines.push(
    '',
    formatReportGroup('Compatible', result.report.compatible),
    '',
    formatReportGroup('Incompatible', result.report.incompatible),
    '',
    formatReportGroup('Manual review', result.report.manual),
  );
  return lines.join('\n');
}

function migrateChannelConfigToSiftGate(
  value: unknown,
  sourceType: 'newapi' | 'oneapi',
  sourcePath: string,
): LiteLlmMigrationResult {
  if (!isRecord(value) && !Array.isArray(value)) {
    throw new Error(`${formatSourceName(sourceType)} config must be a YAML object or array.`);
  }

  const report = emptyReport();
  const channels = normalizeChannelEntries(value, sourceType, report);
  if (channels.length === 0) {
    throw new Error(`${formatSourceName(sourceType)} config did not contain any migratable channels.`);
  }

  const nodes = channels.map((channel) => buildNodeFromChannel(channel, sourceType, report));
  const primary = {
    node: nodes[0].id,
    model: nodes[0].models[0],
  };
  const fallbacks = nodes
    .slice(1)
    .map((node) => ({ node: node.id, model: node.models[0] }));
  const targets = nodes.map((node, index) => ({
    node: node.id,
    model: node.models[0],
    weight: Math.max(1, channels[index].weight),
  }));
  const modelsPricing = buildPlaceholderPricing(nodes, sourceType, report);

  report.compatible.push({
    path: 'routing.tiers',
    message: `Generated SiftGate routing tiers from ${formatSourceName(sourceType)} channels.`,
  });

  const config: GatewayConfig = {
    server: { port: 2099, host: '0.0.0.0' },
    database: { type: 'sqlite', path: './data/gateway.db' },
    auth: { api_keys: [] },
    nodes,
    routing: {
      optimization: 'balanced',
      tiers: {
        simple: {
          primary,
          fallbacks,
          strategy: 'weighted',
          targets,
        },
        standard: {
          primary,
          fallbacks,
          strategy: 'weighted',
          targets,
        },
        complex: { primary, fallbacks },
        reasoning: { primary, fallbacks },
      },
      scoring: {
        simple_max: -0.1,
        standard_max: 0.08,
        complex_max: 0.35,
      },
      retry: {
        max_retries: 2,
        backoff_base_ms: 500,
        backoff_max_ms: 5000,
        retryable_status: [429, 502, 503],
      },
    },
    budget: {
      daily_token_limit: 5_000_000,
      daily_cost_limit: 50,
      alert_threshold: 0.8,
    },
    models_pricing: modelsPricing,
    cache: {
      enabled: false,
      ttl_seconds: 300,
      max_entries: 1000,
      exclude_tool_use: true,
    },
    telemetry: { enabled: false },
  };

  return {
    sourcePath,
    config,
    yaml: dumpGatewayConfigFromSource(config, report, sourcePath, sourceType),
    report,
  };
}

function exportSiftGateConfig(
  config: GatewayConfig,
  targetType: 'litellm' | 'newapi' | 'oneapi',
  sourcePath: string,
): ConfigMigrationResult {
  const report = emptyReport();
  const output =
    targetType === 'litellm'
      ? exportSiftGateToLiteLlm(config, report)
      : exportSiftGateToChannelConfig(config, targetType, report);

  return {
    sourceType: 'siftgate',
    targetType,
    sourcePath,
    output,
    yaml: dumpTargetConfig(output, report, sourcePath, targetType),
    report,
  };
}

function normalizeChannelEntries(
  value: unknown,
  sourceType: 'newapi' | 'oneapi',
  report: MigrationReport,
): NormalizedChannelEntry[] {
  const entries = extractChannelEntries(value);
  if (entries.length === 0) {
    report.incompatible.push({
      path: 'channels',
      message: `No ${formatSourceName(sourceType)} channels array found.`,
      suggestion: 'Export channels as an array or a top-level channels/data/items collection.',
    });
    return [];
  }

  return entries
    .map((entry, index) => normalizeChannelEntry(entry, index, sourceType, report))
    .filter((entry): entry is NormalizedChannelEntry => entry !== null);
}

function normalizeChannelEntry(
  value: unknown,
  index: number,
  sourceType: 'newapi' | 'oneapi',
  report: MigrationReport,
): NormalizedChannelEntry | null {
  if (!isRecord(value)) {
    report.incompatible.push({
      path: `channels[${index}]`,
      message: 'Channel entry is not an object.',
    });
    return null;
  }

  const name =
    stringValue(value.name) ||
    stringValue(value.display_name) ||
    stringValue(value.channel_name) ||
    `channel-${index + 1}`;
  const rawType = channelTypeValue(value);
  const provider = providerFromChannel(rawType, value);
  const defaults = PROVIDERS[provider] || {
    ...DEFAULT_PROVIDER,
    apiKeyEnv: `${toEnvPrefix(provider)}_API_KEY`,
  };
  const baseUrl = channelBaseUrl(value, provider, defaults, index, report);
  const apiKey = channelApiKey(value, provider, index, report);
  const aliases = parseModelMapping(value.model_mapping ?? value.model_map ?? value.modelMap);
  const models = channelModels(value, aliases, index, report);
  const weight = positiveInteger(value.weight ?? value.priority, 1);
  const disabled = Boolean(value.disabled) || value.status === 2 || value.status === 'disabled';

  report.compatible.push({
    path: `channels[${index}]`,
    message: `Mapped ${formatSourceName(sourceType)} channel "${name}" to provider "${provider}".`,
  });
  if (disabled) {
    report.manual.push({
      path: `channels[${index}].status`,
      message: 'Source channel appears disabled; generated the node for review but routing still includes it.',
      suggestion: 'Remove the node or routing target if this channel should remain inactive.',
    });
  }

  return {
    index,
    name,
    provider,
    baseUrl,
    apiKey,
    models,
    aliases,
    weight,
    disabled,
    rawType,
    raw: value,
  };
}

function buildNodeFromChannel(
  channel: NormalizedChannelEntry,
  sourceType: 'newapi' | 'oneapi',
  report: MigrationReport,
): NodeConfig {
  const defaults = PROVIDERS[channel.provider] || {
    ...DEFAULT_PROVIDER,
    apiKeyEnv: `${toEnvPrefix(channel.provider)}_API_KEY`,
  };
  const nodeId = uniqueSafeId(`${sourceType}-${channel.name}`, channel.index);
  const endpoint =
    stringValue(channel.raw.endpoint) ||
    stringValue(channel.raw.chat_endpoint) ||
    defaults.endpoint;
  const timeoutMs =
    secondsOrMsToMilliseconds(channel.raw.timeout) ||
    secondsOrMsToMilliseconds(channel.raw.response_time_out) ||
    60_000;
  const chatModels = channel.models.filter((model) => !isEmbeddingModel(model));
  const embeddingModels = channel.models.filter(isEmbeddingModel);

  const node: NodeConfig = {
    id: nodeId,
    name: `${formatSourceName(sourceType)} ${channel.name}`,
    protocol: defaults.protocol,
    base_url: channel.baseUrl,
    endpoint,
    api_key: channel.apiKey,
    models: chatModels.length > 0 ? chatModels : channel.models,
    timeout_ms: timeoutMs,
  };

  if (defaults.authType) {
    node.auth_type = defaults.authType;
  }
  if (defaults.headers) {
    node.headers = { ...defaults.headers };
  }
  if (Object.keys(channel.aliases).length > 0) {
    node.model_aliases = channel.aliases;
  }
  if (embeddingModels.length > 0) {
    node.embeddings_endpoint = '/v1/embeddings';
    node.embedding_models = embeddingModels;
    report.compatible.push({
      path: `channels[${channel.index}].models`,
      message: `Detected ${embeddingModels.length} embedding model(s) for SiftGate embedding routing.`,
    });
  }
  if (channel.provider === 'azure') {
    report.manual.push({
      path: `channels[${channel.index}]`,
      message: 'Azure channel endpoint may need deployment-specific path and api-version review.',
      suggestion: 'Confirm nodes[].endpoint before production traffic.',
    });
  }

  return node;
}

function exportSiftGateToLiteLlm(
  config: GatewayConfig,
  report: MigrationReport,
): Record<string, unknown> {
  const modelList: Array<Record<string, unknown>> = [];
  for (const node of config.nodes) {
    for (const model of node.models) {
      const provider = providerFromSiftGateNode(node);
      const modelName = aliasForModel(node, model) || model;
      const params: Record<string, unknown> = {
        model: `${provider}/${model}`,
        api_key: safeExportedApiKey(node.api_key, node.id, report, `nodes.${node.id}.api_key`),
        api_base: node.base_url,
        timeout: Math.round(node.timeout_ms / 1000),
      };
      if (provider === 'openai_compatible') {
        params.custom_llm_provider = 'openai';
      }
      const modelInfo: Record<string, unknown> = {};
      const maxContext =
        node.model_capabilities?.[model]?.max_context_tokens ||
        node.max_context_tokens;
      if (maxContext) {
        modelInfo.max_input_tokens = maxContext;
      }
      modelList.push({
        model_name: modelName,
        litellm_params: params,
        ...(Object.keys(modelInfo).length > 0 ? { model_info: modelInfo } : {}),
      });
    }
  }

  const standardTier = config.routing.tiers.standard || Object.values(config.routing.tiers)[0];
  const fallbacks = standardTier?.primary
    ? [{
        [targetModelName(config, standardTier.primary)]:
          (standardTier.fallbacks || []).map((target) => targetModelName(config, target)),
      }]
    : [];
  const routingStrategy = mapSiftGateStrategyToLiteLlm(standardTier?.strategy);
  report.compatible.push({
    path: 'nodes',
    message: `Exported ${modelList.length} SiftGate model route(s) to LiteLLM model_list.`,
  });
  report.manual.push({
    path: 'router_settings',
    message: 'Generated one LiteLLM fallback map from the standard SiftGate tier.',
    suggestion: 'Review per-tier routing if simple/complex/reasoning differ from standard.',
  });

  return {
    model_list: modelList,
    router_settings: {
      routing_strategy: routingStrategy,
      fallbacks,
      num_retries: config.routing.retry?.max_retries ?? 2,
    },
  };
}

function exportSiftGateToChannelConfig(
  config: GatewayConfig,
  targetType: 'newapi' | 'oneapi',
  report: MigrationReport,
): Record<string, unknown> {
  const channels = config.nodes.map((node, index) => {
    const provider = providerFromSiftGateNode(node);
    const channelType = providerToChannelType(provider);
    const key = safeExportedApiKey(node.api_key, node.id, report, `nodes.${node.id}.api_key`);
    const models = Array.from(
      new Set([
        ...node.models,
        ...(node.embedding_models || []),
        ...(node.rerank_models || []),
        ...(node.image_models || []),
        ...(node.audio_models || []),
        ...(node.realtime_models || []),
      ]),
    );
    return {
      id: index + 1,
      name: node.name || node.id,
      type: channelType,
      base_url: node.base_url,
      key,
      models: models.join(','),
      status: 1,
      weight: 1,
      ...(node.model_aliases ? { model_mapping: node.model_aliases } : {}),
    };
  });
  report.compatible.push({
    path: 'nodes',
    message: `Exported ${channels.length} SiftGate node(s) as ${formatSourceName(targetType)} channel scaffold.`,
  });
  report.manual.push({
    path: 'channels',
    message: `${formatSourceName(targetType)} export is a declarative scaffold, not a direct database dump.`,
    suggestion: 'Import through the admin UI or adapt fields to your deployed schema before writing the database.',
  });

  return { channels };
}

function normalizeModelEntry(
  value: unknown,
  index: number,
  report: MigrationReport,
): NormalizedLiteLlmModel | null {
  if (!isRecord(value)) {
    report.incompatible.push({
      path: `model_list[${index}]`,
      message: 'Model entry is not an object.',
    });
    return null;
  }

  const modelName = stringValue(value.model_name);
  const params = isRecord(value.litellm_params) ? value.litellm_params : {};
  if (!modelName) {
    report.incompatible.push({
      path: `model_list[${index}].model_name`,
      message: 'Missing LiteLLM model_name.',
    });
    return null;
  }

  const rawModel = stringValue(params.model) || modelName;
  const provider = normalizeProvider(
    stringValue(params.custom_llm_provider) ||
      providerFromModel(rawModel) ||
      inferProviderFromModel(rawModel),
  );
  const upstreamModel = stripProviderPrefix(rawModel, provider) || modelName;

  report.compatible.push({
    path: `model_list[${index}]`,
    message: `Mapped LiteLLM model "${modelName}" to provider "${provider}" model "${upstreamModel}".`,
  });

  return {
    index,
    modelName,
    upstreamModel,
    provider,
    params,
    info: isRecord(value.model_info) ? value.model_info : {},
  };
}

function buildNode(
  entry: NormalizedLiteLlmModel,
  report: MigrationReport,
): NodeConfig {
  const providerDefaults = PROVIDERS[entry.provider] || {
    ...DEFAULT_PROVIDER,
    apiKeyEnv: `${toEnvPrefix(entry.provider)}_API_KEY`,
  };
  const baseUrl = resolveBaseUrl(entry, providerDefaults, report);
  const endpoint = resolveEndpoint(entry, providerDefaults, report);
  const apiKey = resolveApiKey(entry, providerDefaults, report);
  const nodeId = uniqueSafeId(`${entry.provider}-${entry.modelName}`, entry.index);
  const timeoutMs =
    secondsOrMsToMilliseconds(entry.params.timeout) ||
    secondsOrMsToMilliseconds(entry.params.request_timeout) ||
    60_000;

  const node: NodeConfig = {
    id: nodeId,
    name: `LiteLLM ${entry.modelName}`,
    protocol: providerDefaults.protocol,
    base_url: baseUrl,
    endpoint,
    api_key: apiKey,
    models: [entry.upstreamModel],
    timeout_ms: timeoutMs,
  };

  if (providerDefaults.authType) {
    node.auth_type = providerDefaults.authType;
  }
  if (providerDefaults.headers) {
    node.headers = { ...providerDefaults.headers };
  }

  const maxContext = numericValue(entry.info.max_input_tokens) ||
    numericValue(entry.info.max_tokens) ||
    numericValue(entry.params.max_input_tokens) ||
    numericValue(entry.params.max_tokens);
  if (maxContext) {
    node.max_context_tokens = maxContext;
    node.model_capabilities = {
      [entry.upstreamModel]: { max_context_tokens: maxContext },
    };
  }

  if (entry.modelName !== entry.upstreamModel) {
    node.model_aliases = { [entry.modelName]: entry.upstreamModel };
  }

  return node;
}

function buildRouting(
  models: NormalizedLiteLlmModel[],
  nodes: NodeConfig[],
  targetByModelName: Map<string, RouteTarget>,
  routerSettings: Record<string, unknown>,
  report: MigrationReport,
): GatewayConfig['routing'] {
  const allTargets = nodes.map((node) => ({
    node: node.id,
    model: node.models[0],
    weight: 1,
  }));
  const fallbackTargets = resolveFallbackTargets(
    routerSettings.fallbacks,
    targetByModelName,
    report,
  );
  const primary =
    fallbackTargets.primary ||
    targetByModelName.get(models[0].modelName) ||
    { node: nodes[0].id, model: nodes[0].models[0] };
  const fallbacks =
    fallbackTargets.fallbacks.length > 0
      ? fallbackTargets.fallbacks
      : allTargets
          .filter((target) => target.node !== primary.node || target.model !== primary.model)
          .map(({ node, model }) => ({ node, model }));
  const strategy = mapRoutingStrategy(routerSettings.routing_strategy, report);
  const optimization = mapRoutingOptimization(routerSettings, report);

  report.compatible.push({
    path: 'routing.tiers',
    message: 'Generated simple/standard/complex/reasoning tiers from LiteLLM router targets.',
  });

  return {
    optimization,
    tiers: {
      simple: {
        primary,
        fallbacks,
        strategy,
        targets: allTargets,
      },
      standard: {
        primary,
        fallbacks,
        strategy,
        targets: allTargets,
      },
      complex: { primary, fallbacks },
      reasoning: { primary, fallbacks },
    },
    scoring: {
      simple_max: -0.1,
      standard_max: 0.08,
      complex_max: 0.35,
    },
    retry: {
      max_retries: positiveInteger(routerSettings.num_retries, 0),
      backoff_base_ms: positiveInteger(routerSettings.retry_after, 500),
      backoff_max_ms: positiveInteger(routerSettings.retry_after_max, 5000),
      retryable_status: [429, 502, 503],
    },
  };
}

function resolveFallbackTargets(
  fallbacks: unknown,
  targetByModelName: Map<string, RouteTarget>,
  report: MigrationReport,
): { primary: RouteTarget | null; fallbacks: RouteTarget[] } {
  const mappings: Array<[string, unknown]> = [];
  if (Array.isArray(fallbacks)) {
    for (const item of fallbacks) {
      if (!isRecord(item)) continue;
      for (const [primaryName, fallbackList] of Object.entries(item)) {
        mappings.push([primaryName, fallbackList]);
      }
    }
  } else if (isRecord(fallbacks)) {
    for (const [primaryName, fallbackList] of Object.entries(fallbacks)) {
      mappings.push([primaryName, fallbackList]);
    }
  }

  if (mappings.length === 0) {
    report.manual.push({
      path: 'router_settings.fallbacks',
      message: 'No LiteLLM fallbacks found; generated SiftGate fallback order from model_list order.',
    });
    return { primary: null, fallbacks: [] };
  }

  const [primaryName, rawFallbacks] = mappings[0];
  const primary = targetByModelName.get(primaryName) || null;
  if (!primary) {
    report.manual.push({
      path: `router_settings.fallbacks.${primaryName}`,
      message: `Fallback primary "${primaryName}" did not match a migrated model.`,
    });
  }

  const fallbackNames = Array.isArray(rawFallbacks)
    ? rawFallbacks.filter((item): item is string => typeof item === 'string')
    : [];
  const resolvedFallbacks = fallbackNames
    .map((name) => targetByModelName.get(name))
    .filter((target): target is RouteTarget => target !== undefined);

  if (resolvedFallbacks.length !== fallbackNames.length) {
    report.manual.push({
      path: `router_settings.fallbacks.${primaryName}`,
      message: 'Some LiteLLM fallback model names did not match migrated models.',
      suggestion: 'Review routing.tiers.*.fallbacks after migration.',
    });
  } else {
    report.compatible.push({
      path: `router_settings.fallbacks.${primaryName}`,
      message: 'Mapped LiteLLM fallback chain to SiftGate tier fallbacks.',
    });
  }

  if (mappings.length > 1) {
    report.manual.push({
      path: 'router_settings.fallbacks',
      message: 'LiteLLM supports per-model fallback maps; SiftGate generated one tier fallback chain from the first map.',
      suggestion: 'Review whether additional fallback maps should become separate tiers or targets.',
    });
  }

  return { primary, fallbacks: resolvedFallbacks };
}

function buildTargetLookup(
  models: NormalizedLiteLlmModel[],
  nodes: NodeConfig[],
): Map<string, RouteTarget> {
  const lookup = new Map<string, RouteTarget>();
  models.forEach((model, index) => {
    const target = { node: nodes[index].id, model: nodes[index].models[0] };
    lookup.set(model.modelName, target);
    lookup.set(model.upstreamModel, target);
  });
  return lookup;
}

function buildModelsPricing(
  models: NormalizedLiteLlmModel[],
  report: MigrationReport,
): GatewayConfig['models_pricing'] {
  const pricing: GatewayConfig['models_pricing'] = {};
  for (const model of models) {
    const inputCost =
      numericValue(model.params.input_cost_per_token) ||
      numericValue(model.info.input_cost_per_token);
    const outputCost =
      numericValue(model.params.output_cost_per_token) ||
      numericValue(model.info.output_cost_per_token);

    if (inputCost !== undefined && outputCost !== undefined) {
      pricing[model.upstreamModel] = {
        input: perTokenToPerMillion(inputCost),
        output: perTokenToPerMillion(outputCost),
      };
      report.compatible.push({
        path: `model_list[${model.index}].litellm_params`,
        message: `Mapped token pricing for "${model.upstreamModel}".`,
      });
    } else {
      pricing[model.upstreamModel] = { input: 0, output: 0 };
      report.manual.push({
        path: `models_pricing.${model.upstreamModel}`,
        message: 'LiteLLM pricing was not present; generated 0.00 placeholder pricing.',
        suggestion: 'Set per-1M-token input/output pricing before enforcing budgets.',
      });
    }
  }
  return pricing;
}

function resolveBaseUrl(
  entry: NormalizedLiteLlmModel,
  defaults: ProviderDefaults,
  report: MigrationReport,
): string {
  const base =
    stringValue(entry.params.api_base) ||
    stringValue(entry.params.base_url) ||
    stringValue(entry.params.api_endpoint) ||
    defaults.baseUrl;

  if (base) {
    return base.replace(/\/+$/, '');
  }

  report.incompatible.push({
    path: `model_list[${entry.index}].litellm_params.api_base`,
    message: `Provider "${entry.provider}" needs an OpenAI-compatible base URL for SiftGate.`,
    suggestion: 'Add api_base to the LiteLLM entry or edit nodes[].base_url after migration.',
  });
  return `https://${entry.provider}.example.invalid`;
}

function resolveEndpoint(
  entry: NormalizedLiteLlmModel,
  defaults: ProviderDefaults,
  report: MigrationReport,
): string {
  if (entry.provider === 'azure' || entry.provider === 'azure_ai') {
    const apiVersion = stringValue(entry.params.api_version) || '2024-02-01';
    if (!entry.params.api_version) {
      report.manual.push({
        path: `model_list[${entry.index}].litellm_params.api_version`,
        message: 'Azure api_version was missing; used 2024-02-01.',
      });
    }
    return defaults.endpoint
      .replace('{model}', encodeURIComponent(entry.upstreamModel))
      .replace('{apiVersion}', encodeURIComponent(apiVersion));
  }

  return stringValue(entry.params.endpoint) || defaults.endpoint;
}

function resolveApiKey(
  entry: NormalizedLiteLlmModel,
  defaults: ProviderDefaults,
  report: MigrationReport,
): string {
  const rawApiKey = stringValue(entry.params.api_key);
  const envRef = parseEnvReference(rawApiKey);
  if (envRef) {
    report.compatible.push({
      path: `model_list[${entry.index}].litellm_params.api_key`,
      message: `Mapped API key reference to \${${envRef}}.`,
    });
    return `\${${envRef}}`;
  }

  if (rawApiKey) {
    const fallbackEnv = `${toEnvPrefix(entry.provider)}_${toEnvPrefix(entry.modelName)}_API_KEY`;
    report.manual.push({
      path: `model_list[${entry.index}].litellm_params.api_key`,
      message: 'Literal API key values are not copied into generated SiftGate config.',
      suggestion: `Move the secret to ${fallbackEnv} and set nodes[].api_key to \${${fallbackEnv}}.`,
    });
    return `\${${fallbackEnv}}`;
  }

  report.manual.push({
    path: `model_list[${entry.index}].litellm_params.api_key`,
    message: `No API key reference found; used provider default \${${defaults.apiKeyEnv}}.`,
  });
  return `\${${defaults.apiKeyEnv}}`;
}

function mapRoutingStrategy(
  value: unknown,
  report: MigrationReport,
): LoadBalancingStrategy {
  const raw = stringValue(value).toLowerCase();
  if (!raw) return 'weighted';
  if (['simple-shuffle', 'random', 'shuffle'].includes(raw)) {
    report.compatible.push({
      path: 'router_settings.routing_strategy',
      message: `Mapped LiteLLM routing strategy "${raw}" to SiftGate random.`,
    });
    return 'random';
  }
  if (['latency-based-routing', 'least_latency', 'least-latency'].includes(raw)) {
    report.compatible.push({
      path: 'router_settings.routing_strategy',
      message: `Mapped LiteLLM routing strategy "${raw}" to SiftGate least_latency.`,
    });
    return 'least_latency';
  }
  if (['usage-based-routing', 'least-busy', 'simple-shuffle-v2'].includes(raw)) {
    report.manual.push({
      path: 'router_settings.routing_strategy',
      message: `LiteLLM strategy "${raw}" has no exact SiftGate equivalent; generated weighted targets.`,
    });
    return 'weighted';
  }
  report.manual.push({
    path: 'router_settings.routing_strategy',
    message: `Unknown LiteLLM routing strategy "${raw}"; generated weighted targets.`,
  });
  return 'weighted';
}

function mapRoutingOptimization(
  routerSettings: Record<string, unknown>,
  report: MigrationReport,
): RoutingOptimization {
  const raw =
    stringValue(routerSettings.siftgate_optimization) ||
    stringValue(routerSettings.optimization);
  if (KNOWN_ROUTING_OPTIMIZATIONS.has(raw as RoutingOptimization)) {
    return raw as RoutingOptimization;
  }

  const strategy = stringValue(routerSettings.routing_strategy).toLowerCase();
  if (strategy.includes('latency')) return 'latency';
  if (strategy.includes('cost')) return 'cost';
  if (raw) {
    report.manual.push({
      path: 'router_settings.optimization',
      message: `Unknown optimization "${raw}"; used balanced.`,
    });
  }
  return 'balanced';
}

function extractChannelEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  const candidates = [
    value.channels,
    value.data,
    value.items,
    value.records,
    isRecord(value.data) ? value.data.channels : undefined,
    isRecord(value.data) ? value.data.items : undefined,
    isRecord(value.data) ? value.data.records : undefined,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  if ('type' in value || 'base_url' in value || 'models' in value) {
    return [value];
  }
  return [];
}

function channelTypeValue(value: Record<string, unknown>): string | number | undefined {
  const raw = value.type ?? value.channel_type ?? value.provider ?? value.provider_type;
  return typeof raw === 'number' || typeof raw === 'string' ? raw : undefined;
}

function providerFromChannel(
  rawType: string | number | undefined,
  value: Record<string, unknown>,
): string {
  if (typeof rawType === 'number') {
    return CHANNEL_TYPE_PROVIDERS[rawType] || inferProviderFromChannelValue(value);
  }
  if (typeof rawType === 'string' && rawType.trim().length > 0) {
    const numeric = Number(rawType);
    if (Number.isInteger(numeric) && CHANNEL_TYPE_PROVIDERS[numeric]) {
      return CHANNEL_TYPE_PROVIDERS[numeric];
    }
    const normalized = normalizeProvider(rawType);
    if (normalized === 'claude') return 'anthropic';
    if (normalized === 'openai_compatible' || normalized === 'custom') return 'openai_compatible';
    return normalized;
  }
  return inferProviderFromChannelValue(value);
}

function inferProviderFromChannelValue(value: Record<string, unknown>): string {
  const baseUrl = stringValue(value.base_url) || stringValue(value.baseUrl) || stringValue(value.api_base);
  const lowered = baseUrl.toLowerCase();
  if (lowered.includes('anthropic')) return 'anthropic';
  if (lowered.includes('azure')) return 'azure';
  if (lowered.includes('groq')) return 'groq';
  if (lowered.includes('mistral')) return 'mistral';
  if (lowered.includes('openrouter')) return 'openrouter';
  if (lowered.includes('perplexity')) return 'perplexity';
  if (lowered.includes('together')) return 'together_ai';
  if (lowered.includes('openai')) return 'openai';

  const models = splitModelList(value.models ?? value.model_list ?? value.model_name);
  const first = models[0] || '';
  return inferProviderFromModel(first);
}

function channelBaseUrl(
  value: Record<string, unknown>,
  provider: string,
  defaults: ProviderDefaults,
  index: number,
  report: MigrationReport,
): string {
  const base =
    stringValue(value.base_url) ||
    stringValue(value.baseUrl) ||
    stringValue(value.api_base) ||
    stringValue(value.apiBase) ||
    stringValue(value.url) ||
    defaults.baseUrl;
  if (base) return base.replace(/\/+$/, '');

  report.incompatible.push({
    path: `channels[${index}].base_url`,
    message: `Provider "${provider}" needs a base URL for SiftGate.`,
    suggestion: 'Set base_url/api_base or edit nodes[].base_url after migration.',
  });
  return `https://${provider}.example.invalid`;
}

function channelApiKey(
  value: Record<string, unknown>,
  provider: string,
  index: number,
  report: MigrationReport,
): string {
  const raw =
    stringValue(value.key) ||
    stringValue(value.api_key) ||
    stringValue(value.apiKey) ||
    stringValue(value.token);
  const envRef = parseEnvReference(raw);
  if (envRef) {
    report.compatible.push({
      path: `channels[${index}].key`,
      message: `Mapped API key reference to \${${envRef}}.`,
    });
    return `\${${envRef}}`;
  }
  if (raw) {
    const fallbackEnv = `${toEnvPrefix(provider)}_CHANNEL_${index + 1}_API_KEY`;
    report.manual.push({
      path: `channels[${index}].key`,
      message: 'Literal channel key values are not copied into generated SiftGate config.',
      suggestion: `Move the secret to ${fallbackEnv} and set nodes[].api_key to \${${fallbackEnv}}.`,
    });
    return `\${${fallbackEnv}}`;
  }

  const fallbackEnv = `${toEnvPrefix(provider)}_API_KEY`;
  report.manual.push({
    path: `channels[${index}].key`,
    message: `No API key reference found; used provider default \${${fallbackEnv}}.`,
  });
  return `\${${fallbackEnv}}`;
}

function channelModels(
  value: Record<string, unknown>,
  aliases: Record<string, string>,
  index: number,
  report: MigrationReport,
): string[] {
  const models = splitModelList(
    value.models ??
      value.model_list ??
      value.modelList ??
      value.model_name ??
      value.model,
  );
  for (const mapped of Object.values(aliases)) {
    if (!models.includes(mapped)) models.push(mapped);
  }
  if (models.length > 0) return models;

  report.incompatible.push({
    path: `channels[${index}].models`,
    message: 'No model list found for channel.',
    suggestion: 'Add source channel models or edit nodes[].models after migration.',
  });
  return [`review-model-${index + 1}`];
}

function splitModelList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => splitModelList(item))
      .filter(Boolean);
  }
  if (isRecord(value)) {
    return Object.keys(value).filter((item) => item.length > 0);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseModelMapping(value: unknown): Record<string, string> {
  const parsed = parsePossiblyJsonObject(value);
  if (!parsed) return {};
  const mapping: Record<string, string> = {};
  for (const [key, raw] of Object.entries(parsed)) {
    if (typeof raw === 'string' && raw.length > 0) {
      mapping[key] = raw;
    }
  }
  return mapping;
}

function parsePossiblyJsonObject(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isEmbeddingModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes('embedding') || normalized.includes('embed');
}

function buildPlaceholderPricing(
  nodes: NodeConfig[],
  sourceType: 'newapi' | 'oneapi',
  report: MigrationReport,
): GatewayConfig['models_pricing'] {
  const pricing: GatewayConfig['models_pricing'] = {};
  for (const node of nodes) {
    for (const model of [
      ...node.models,
      ...(node.embedding_models || []),
      ...(node.rerank_models || []),
      ...(node.image_models || []),
      ...(node.audio_models || []),
      ...(node.realtime_models || []),
    ]) {
      pricing[model] = { input: 0, output: 0 };
    }
  }
  report.manual.push({
    path: 'models_pricing',
    message: `${formatSourceName(sourceType)} channel exports do not include authoritative pricing; generated 0.00 placeholders.`,
    suggestion: 'Set per-1M-token input/output pricing before enforcing budgets or cost routing.',
  });
  return pricing;
}

function normalizeSiftGateConfig(value: unknown): GatewayConfig {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !isRecord(value.routing)) {
    throw new Error('SiftGate config must contain nodes[] and routing.');
  }
  return value as unknown as GatewayConfig;
}

function providerFromSiftGateNode(node: NodeConfig): string {
  const base = node.base_url.toLowerCase();
  if (node.protocol === 'messages' || base.includes('anthropic')) return 'anthropic';
  if (base.includes('azure')) return 'azure';
  if (base.includes('groq')) return 'groq';
  if (base.includes('mistral')) return 'mistral';
  if (base.includes('openrouter')) return 'openrouter';
  if (base.includes('perplexity')) return 'perplexity';
  if (base.includes('together')) return 'together_ai';
  if (base.includes('openai.com')) return 'openai';
  return 'openai_compatible';
}

function aliasForModel(node: NodeConfig, model: string): string | undefined {
  if (!node.model_aliases) return undefined;
  return Object.entries(node.model_aliases).find(([, target]) => target === model)?.[0];
}

function targetModelName(config: GatewayConfig, target: RouteTarget): string {
  const node = config.nodes.find((item) => item.id === target.node);
  return (node && aliasForModel(node, target.model)) || target.model;
}

function mapSiftGateStrategyToLiteLlm(strategy: LoadBalancingStrategy | undefined): string {
  if (strategy === 'least_latency') return 'latency-based-routing';
  if (strategy === 'random') return 'simple-shuffle';
  return 'simple-shuffle-v2';
}

function safeExportedApiKey(
  value: string,
  nodeId: string,
  report: MigrationReport,
  reportPath: string,
): string {
  const envRef = parseEnvReference(value);
  if (envRef) return `\${${envRef}}`;
  if (!value) return `\${${toEnvPrefix(nodeId)}_API_KEY}`;
  const fallbackEnv = `${toEnvPrefix(nodeId)}_API_KEY`;
  report.manual.push({
    path: reportPath,
    message: 'Literal provider API keys are not copied into exported config.',
    suggestion: `Move the secret to ${fallbackEnv} and set the exported key to \${${fallbackEnv}}.`,
  });
  return `\${${fallbackEnv}}`;
}

function providerToChannelType(provider: string): number | string {
  const entry = Object.entries(CHANNEL_TYPE_PROVIDERS).find(
    ([, value]) => value === provider,
  );
  return entry ? Number(entry[0]) : provider;
}

function dumpGatewayConfigFromSource(
  config: GatewayConfig,
  report: MigrationReport,
  sourcePath: string,
  sourceType: MigrationConfigType,
): string {
  const header = [
    '# ============================================================',
    `# SiftGate configuration generated from ${formatSourceName(sourceType)}`,
    `# Source: ${sourcePath}`,
    '# Review the migration report before using in production.',
    '# ============================================================',
    '',
  ].join('\n');
  return `${header}${yaml.dump(config, {
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  })}${formatYamlReportComment(report)}`;
}

function dumpTargetConfig(
  output: unknown,
  report: MigrationReport,
  sourcePath: string,
  targetType: MigrationConfigType,
): string {
  const header = [
    '# ============================================================',
    `# ${formatSourceName(targetType)} configuration scaffold generated from SiftGate`,
    `# Source: ${sourcePath}`,
    '# Review the migration report before importing into another gateway.',
    '# ============================================================',
    '',
  ].join('\n');
  return `${header}${yaml.dump(output, {
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  })}${formatYamlReportComment(report)}`;
}

function dumpGatewayConfig(
  config: GatewayConfig,
  report: MigrationReport,
  sourcePath: string,
): string {
  const header = [
    '# ============================================================',
    '# SiftGate configuration generated from LiteLLM',
    `# Source: ${sourcePath}`,
    '# Review the migration report before using in production.',
    '# ============================================================',
    '',
  ].join('\n');
  return `${header}${yaml.dump(config, {
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  })}${formatYamlReportComment(report)}`;
}

function formatYamlReportComment(report: MigrationReport): string {
  const lines = [
    '',
    '# ============================================================',
    '# Migration report summary',
    `# Compatible: ${report.compatible.length}`,
    `# Incompatible: ${report.incompatible.length}`,
    `# Manual review: ${report.manual.length}`,
    '# ============================================================',
    '',
  ];
  return lines.join('\n');
}

function formatReportGroup(
  label: string,
  items: MigrationReportItem[],
): string {
  if (items.length === 0) return `${label}: none`;
  return [
    `${label} (${items.length})`,
    ...items.map((item) => {
      const suffix = item.suggestion ? ` Suggestion: ${item.suggestion}` : '';
      return `  - ${item.path}: ${item.message}${suffix}`;
    }),
  ].join('\n');
}

function providerFromModel(model: string): string | null {
  const slash = model.indexOf('/');
  if (slash <= 0) return null;
  return model.slice(0, slash);
}

function stripProviderPrefix(model: string, provider: string): string {
  const slash = model.indexOf('/');
  if (slash <= 0) return model;
  const prefix = normalizeProvider(model.slice(0, slash));
  return prefix === provider ? model.slice(slash + 1) : model.slice(slash + 1);
}

function inferProviderFromModel(model: string): string {
  const normalized = model.toLowerCase();
  if (normalized.startsWith('claude')) return 'anthropic';
  if (normalized.startsWith('gpt') || normalized.startsWith('o')) return 'openai';
  if (normalized.startsWith('azure/')) return 'azure';
  return 'openai_compatible';
}

function formatSourceName(type: MigrationConfigType): string {
  switch (type) {
    case 'litellm':
      return 'LiteLLM';
    case 'newapi':
      return 'New API';
    case 'oneapi':
      return 'One API';
    case 'siftgate':
      return 'SiftGate';
    default:
      return type;
  }
}

function normalizeProvider(provider: string): string {
  return provider
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'openai_compatible';
}

function parseEnvReference(value: string): string | null {
  const trimmed = value.trim();
  const patterns = [
    /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}$/,
    /^\$([A-Za-z_][A-Za-z0-9_]*)$/,
    /^os\.environ\/([A-Za-z_][A-Za-z0-9_]*)$/,
    /^env\/([A-Za-z_][A-Za-z0-9_]*)$/,
    /^os\.environ\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]$/,
    /^os\.environ\.get\(['"]([A-Za-z_][A-Za-z0-9_]*)['"]\)$/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function uniqueSafeId(value: string, index: number): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `${safe || 'litellm-model'}-${index + 1}`;
}

function toEnvPrefix(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'LITELLM';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function secondsOrMsToMilliseconds(value: unknown): number | undefined {
  const numeric = numericValue(value);
  if (numeric === undefined || numeric <= 0) return undefined;
  return numeric < 1000 ? Math.round(numeric * 1000) : Math.round(numeric);
}

function positiveInteger(value: unknown, fallback: number): number {
  const numeric = numericValue(value);
  return numeric !== undefined && numeric >= 0 ? Math.floor(numeric) : fallback;
}

function perTokenToPerMillion(value: number): number {
  return Number((value * 1_000_000).toFixed(8));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function emptyReport(): MigrationReport {
  return { compatible: [], incompatible: [], manual: [] };
}
