import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { BUILTIN_PROVIDER_CATALOG } from '../catalog/built-in-catalog';
import type { CatalogModel, CatalogProvider } from '../catalog/catalog.types';
import type {
  AuthType,
  GatewayConfig,
  LoadBalancingStrategy,
  ModelCapabilityConfig,
  NodeConfig,
  RouteTarget,
} from '../config/gateway.config';
import {
  LiteLlmMigrationResult,
  MigrationReport,
  MigrationReportItem,
  migrateLiteLlmConfig,
} from './litellm-migrator';

export type MigrationConfigType = 'siftgate' | 'litellm' | 'newapi' | 'oneapi';
export type ModelBucket =
  | 'chat'
  | 'embedding'
  | 'rerank'
  | 'image'
  | 'audio'
  | 'video'
  | 'realtime';

export interface ConfigMigrationResult {
  sourceType: MigrationConfigType;
  targetType: MigrationConfigType;
  sourcePath: string;
  outputPath?: string;
  output: unknown;
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
  force?: boolean;
  write?: boolean;
}

interface ProviderDefaults {
  protocol: NodeConfig['protocol'];
  baseUrl?: string;
  endpoint: string;
  authType?: AuthType;
  apiKeyEnv: string;
  endpoints?: Partial<Record<string, string>>;
  headers?: Record<string, string>;
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

interface CatalogEvidence {
  provider?: CatalogProvider;
  model?: CatalogModel;
  pricingConfidence: MigrationReport['pricing_confidence'];
  capabilityConfidence: MigrationReport['capability_confidence'];
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
    endpoint: '/openai/deployments/{model}/chat/completions?api-version=2024-02-01',
    authType: 'x-api-key',
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
  },
  azure_openai: {
    protocol: 'chat_completions',
    baseUrl: 'https://{resource}.openai.azure.com',
    endpoint: '/openai/deployments/{model}/chat/completions?api-version=2024-02-01',
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
  custom: DEFAULT_PROVIDER,
  custom_openai: DEFAULT_PROVIDER,
  google: {
    protocol: 'chat_completions',
    baseUrl: 'https://generativelanguage.googleapis.com',
    endpoint: '/v1beta/openai/chat/completions',
    apiKeyEnv: 'GOOGLE_API_KEY',
  },
  vertex: {
    protocol: 'chat_completions',
    endpoint: '/v1beta/openai/chat/completions',
    apiKeyEnv: 'GOOGLE_APPLICATION_CREDENTIALS',
  },
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
  deepseek: {
    protocol: 'chat_completions',
    baseUrl: 'https://api.deepseek.com',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
  xai: {
    protocol: 'chat_completions',
    baseUrl: 'https://api.x.ai',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'XAI_API_KEY',
  },
  cohere: {
    protocol: 'chat_completions',
    baseUrl: 'https://api.cohere.com',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'COHERE_API_KEY',
  },
  voyage: {
    protocol: 'chat_completions',
    baseUrl: 'https://api.voyageai.com',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'VOYAGE_API_KEY',
  },
  jina: {
    protocol: 'chat_completions',
    baseUrl: 'https://api.jina.ai',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'JINA_API_KEY',
  },
  together_ai: {
    protocol: 'chat_completions',
    baseUrl: 'https://api.together.xyz',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'TOGETHER_API_KEY',
  },
  fireworks: {
    protocol: 'chat_completions',
    baseUrl: 'https://api.fireworks.ai/inference',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'FIREWORKS_API_KEY',
  },
  ollama: {
    protocol: 'chat_completions',
    baseUrl: 'http://127.0.0.1:11434',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'OLLAMA_API_KEY',
  },
  vllm: {
    protocol: 'chat_completions',
    baseUrl: 'http://127.0.0.1:8000',
    endpoint: '/v1/chat/completions',
    apiKeyEnv: 'VLLM_API_KEY',
  },
};

const CHANNEL_TYPE_PROVIDERS: Record<number, string> = {
  1: 'openai',
  2: 'azure_openai',
  3: 'azure_openai',
  8: 'openai_compatible',
  14: 'anthropic',
  15: 'google',
  24: 'mistral',
  27: 'groq',
  35: 'cohere',
  36: 'ollama',
};

const KNOWN_CHANNEL_FIELDS = new Set([
  'id',
  'name',
  'display_name',
  'channel_name',
  'type',
  'channel_type',
  'provider',
  'provider_type',
  'base_url',
  'baseUrl',
  'api_base',
  'apiBase',
  'url',
  'endpoint',
  'chat_endpoint',
  'key',
  'api_key',
  'apiKey',
  'token',
  'models',
  'model_list',
  'modelList',
  'model_name',
  'model',
  'model_mapping',
  'model_map',
  'modelMap',
  'weight',
  'priority',
  'disabled',
  'status',
  'timeout',
  'response_time_out',
]);

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
    : path.resolve(cwd, defaultOutputName(result.targetType));

  if (options.write !== false) {
    if (fs.existsSync(outputPath) && options.overwrite !== true && options.force !== true) {
      throw new Error(
        `Refusing to overwrite existing ${outputPath}. Use --out with a new path or pass --force.`,
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
      normalizeReport(result.report);
      return liteLlmToConfigMigrationResult(result, sourcePath);
    }
    if (options.from === 'newapi' || options.from === 'oneapi') {
      return migrateChannelConfigToSiftGate(value, options.from, sourcePath);
    }
  }

  if (options.from === 'siftgate') {
    const config = normalizeSiftGateConfig(value);
    if (targetType === 'litellm' || targetType === 'newapi' || targetType === 'oneapi') {
      return exportSiftGateConfig(config, targetType, sourcePath);
    }
  }

  throw new Error(`Unsupported migration path: --from ${options.from} --to ${targetType}.`);
}

export function formatConfigMigrationReport(result: ConfigMigrationResult): string {
  const title =
    result.sourceType === 'litellm' && result.targetType === 'siftgate'
      ? 'SiftGate LiteLLM migration'
      : 'SiftGate config migration';
  const lines = [
    title,
    `Source: ${formatSourceName(result.sourceType)} (${path.resolve(result.sourcePath)})`,
    `Target: ${formatSourceName(result.targetType)}`,
  ];
  if (result.outputPath) {
    lines.push(`Output: ${path.resolve(result.outputPath)}`);
  }
  lines.push(
    '',
    formatReportGroup('Compatible', result.report.compatible),
    '',
    formatReportGroup('Partially supported', result.report.partially_supported),
    '',
    formatReportGroup('Unsupported', result.report.unsupported),
    '',
    formatReportGroup('Manual actions', result.report.manual_actions),
    '',
    formatReportGroup('Provider/model mapping notes', result.report.mapping_notes),
    '',
    `Pricing confidence: ${result.report.pricing_confidence}`,
    `Capability confidence: ${result.report.capability_confidence}`,
  );
  return lines.join('\n');
}

export function supportedMigrationType(value: string | undefined): value is MigrationConfigType {
  return value === 'siftgate' || value === 'litellm' || value === 'newapi' || value === 'oneapi';
}

function liteLlmToConfigMigrationResult(
  result: LiteLlmMigrationResult,
  sourcePath: string,
): ConfigMigrationResult {
  return {
    sourceType: 'litellm',
    targetType: 'siftgate',
    sourcePath,
    output: result.config,
    config: result.config,
    yaml: result.yaml,
    report: result.report,
  };
}

function migrateChannelConfigToSiftGate(
  value: unknown,
  sourceType: 'newapi' | 'oneapi',
  sourcePath: string,
): ConfigMigrationResult {
  if (!isRecord(value) && !Array.isArray(value)) {
    throw new Error(`${formatSourceName(sourceType)} config must be a YAML object or array.`);
  }

  const report = emptyReport();
  const channels = normalizeChannelEntries(value, sourceType, report);
  if (channels.length === 0) {
    throw new Error(`${formatSourceName(sourceType)} config did not contain migratable channels.`);
  }

  const nodes = channels.map((channel) => buildNodeFromChannel(channel, sourceType, report));
  const primary = firstRouteTarget(nodes);
  const fallbacks = nodes
    .map((node) => firstRouteTarget([node]))
    .filter((target) => target.node !== primary.node || target.model !== primary.model);
  const targets = nodes.map((node, index) => ({
    ...firstRouteTarget([node]),
    weight: Math.max(1, channels[index].weight),
  }));

  report.compatible.push({
    path: 'routing.tiers',
    message: `Generated SiftGate weighted routing tiers from ${formatSourceName(sourceType)} channels.`,
  });

  const config: GatewayConfig = {
    server: { port: 2099, host: '0.0.0.0' },
    database: { type: 'sqlite', path: './data/gateway.db' },
    auth: { api_keys: [] },
    nodes,
    routing: {
      optimization: 'balanced',
      tiers: {
        simple: { primary, fallbacks, strategy: 'weighted', targets },
        standard: { primary, fallbacks, strategy: 'weighted', targets },
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
    models_pricing: buildPricingFromNodes(nodes, sourceType, report),
    cache: {
      enabled: false,
      ttl_seconds: 300,
      max_entries: 1000,
      exclude_tool_use: true,
    },
    telemetry: { enabled: false },
  };

  normalizeReport(report);
  const outputYaml = dumpGatewayConfigFromSource(config, report, sourcePath, sourceType);
  return {
    sourceType,
    targetType: 'siftgate',
    sourcePath,
    output: config,
    config,
    yaml: outputYaml,
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
  normalizeReport(report);
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
    pushUnsupported(report, {
      path: 'channels',
      message: `No ${formatSourceName(sourceType)} channels array found.`,
      suggestion: 'Export channels as a top-level array, channels, data, items, or records collection.',
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
    pushUnsupported(report, {
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
  const defaults = providerDefaults(provider);
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
  report.mapping_notes.push({
    path: `channels[${index}]`,
    message: `provider=${provider}; models=${models.join(', ')}; base_url=${baseUrl}`,
  });

  if (disabled) {
    pushPartial(report, {
      path: `channels[${index}].status`,
      message: 'Source channel appears disabled; generated the node for review but kept it in routing targets.',
      suggestion: 'Remove the node or routing target if this channel should remain inactive.',
    });
  }

  const unmapped = Object.keys(value).filter((key) => !KNOWN_CHANNEL_FIELDS.has(key));
  if (unmapped.length > 0) {
    pushManual(report, {
      path: `channels[${index}]`,
      message: `Source-only fields need review: ${unmapped.sort().join(', ')}.`,
      suggestion: 'The fields are preserved in this report, not silently mapped into gateway.config.yaml.',
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
  const defaults = providerDefaults(channel.provider);
  const buckets = bucketModels(channel.models, channel.provider, report, `channels[${channel.index}].models`);
  const chatModels = buckets.chat || [];
  const firstChat = chatModels[0] || firstModelFromBuckets(buckets);
  const endpoint =
    stringValue(channel.raw.endpoint) ||
    stringValue(channel.raw.chat_endpoint) ||
    endpointForBucket(defaults, 'chat', firstChat);
  const timeoutMs =
    secondsOrMsToMilliseconds(channel.raw.timeout) ||
    secondsOrMsToMilliseconds(channel.raw.response_time_out) ||
    60_000;
  const node: NodeConfig = {
    id: uniqueSafeId(`${sourceType}-${channel.name}`, channel.index),
    name: `${formatSourceName(sourceType)} ${channel.name}`,
    protocol: defaults.protocol,
    base_url: channel.baseUrl,
    endpoint,
    api_key: channel.apiKey,
    models: chatModels,
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

  applyBucketsToNode(node, buckets, defaults);
  applyCatalogCapabilities(node, channel.provider, allBucketModels(buckets), report);

  if (channel.provider === 'azure' || channel.provider === 'azure_openai') {
    pushManual(report, {
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
    for (const { model, bucket } of nodeModelEntries(node)) {
      const provider = providerFromSiftGateNode(node);
      const modelName = aliasForModel(node, model) || model;
      const params: Record<string, unknown> = {
        model: `${provider}/${model}`,
        api_key: safeExportedApiKey(exportedNodeApiKey(node), node.id, report, `nodes.${node.id}.api_key`),
        api_base: node.base_url,
        timeout: Math.round(node.timeout_ms / 1000),
      };
      if (provider === 'openai_compatible') {
        params.custom_llm_provider = 'openai';
      }
      const modelInfo = liteLlmModelInfo(node, model, bucket);
      modelList.push({
        model_name: modelName,
        litellm_params: params,
        ...(Object.keys(modelInfo).length > 0 ? { model_info: modelInfo } : {}),
      });
      if (bucket !== 'chat' && bucket !== 'embedding') {
        pushPartial(report, {
          path: `nodes.${node.id}.${bucket}_models`,
          message: `Exported ${bucket} model "${model}" as a LiteLLM scaffold entry.`,
          suggestion: 'Confirm provider-specific LiteLLM params before production use.',
        });
      }
    }
  }

  const standardTier = config.routing.tiers.standard || Object.values(config.routing.tiers)[0];
  const fallbacks = standardTier?.primary
    ? [
        {
          [targetModelName(config, standardTier.primary)]: (standardTier.fallbacks || []).map(
            (target) => targetModelName(config, target),
          ),
        },
      ]
    : [];

  report.compatible.push({
    path: 'nodes',
    message: `Exported ${modelList.length} SiftGate model route(s) to LiteLLM model_list.`,
  });
  pushManual(report, {
    path: 'router_settings',
    message: 'Generated one LiteLLM fallback map from the standard SiftGate tier.',
    suggestion: 'Review per-tier routing if simple/complex/reasoning differ from standard.',
  });

  return {
    model_list: modelList,
    router_settings: {
      routing_strategy: mapSiftGateStrategyToLiteLlm(standardTier?.strategy),
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
    const buckets = nodeBuckets(node);
    return {
      id: index + 1,
      name: node.name || node.id,
      type: providerToChannelType(provider),
      base_url: node.base_url,
      key: safeExportedApiKey(exportedNodeApiKey(node), node.id, report, `nodes.${node.id}.api_key`),
      models: allBucketModels(buckets).join(','),
      status: 1,
      weight: 1,
      ...(node.model_aliases ? { model_mapping: node.model_aliases } : {}),
      siftgate_model_buckets: buckets,
      siftgate_source_node: node.id,
    };
  });
  report.compatible.push({
    path: 'nodes',
    message: `Exported ${channels.length} SiftGate node(s) as ${formatSourceName(targetType)} channel scaffold.`,
  });
  pushPartial(report, {
    path: 'channels',
    message: `${formatSourceName(targetType)} export is a YAML scaffold, not a direct database dump.`,
    suggestion: 'Import through the admin UI or adapt fields to your deployed schema.',
  });
  return { channels };
}

function applyBucketsToNode(
  node: NodeConfig,
  buckets: Partial<Record<ModelBucket, string[]>>,
  defaults: ProviderDefaults,
): void {
  if (buckets.embedding?.length) {
    node.embedding_models = buckets.embedding;
    node.embeddings_endpoint = endpointForBucket(defaults, 'embedding', buckets.embedding[0]);
  }
  if (buckets.rerank?.length) {
    node.rerank_models = buckets.rerank;
    node.rerank_endpoint = endpointForBucket(defaults, 'rerank', buckets.rerank[0]);
  }
  if (buckets.image?.length) {
    node.image_models = buckets.image;
    node.images_generations_endpoint = endpointForBucket(defaults, 'image', buckets.image[0]);
    node.images_edits_endpoint = defaults.endpoints?.images_edits || '/v1/images/edits';
    node.images_variations_endpoint = defaults.endpoints?.images_variations || '/v1/images/variations';
  }
  if (buckets.audio?.length) {
    node.audio_models = buckets.audio;
    node.audio_transcriptions_endpoint = endpointForBucket(defaults, 'audio', buckets.audio[0]);
    node.audio_translations_endpoint = defaults.endpoints?.audio_translations || '/v1/audio/translations';
    node.audio_speech_endpoint = defaults.endpoints?.audio_speech || '/v1/audio/speech';
  }
  if (buckets.video?.length) {
    node.video_models = buckets.video;
    node.video_endpoint = endpointForBucket(defaults, 'video', buckets.video[0]);
    node.video_generations_endpoint = node.video_endpoint;
    node.video_status_endpoint = defaults.endpoints?.video_status || '/v1/videos/{id}';
    node.video_content_endpoint = defaults.endpoints?.video_content || '/v1/videos/{id}/content';
    node.video_cancel_endpoint = defaults.endpoints?.video_cancel || '/v1/videos/{id}/cancel';
  }
  if (buckets.realtime?.length) {
    node.realtime_models = buckets.realtime;
    node.realtime_endpoint = endpointForBucket(defaults, 'realtime', buckets.realtime[0]);
  }
}

function applyCatalogCapabilities(
  node: NodeConfig,
  provider: string,
  models: string[],
  report: MigrationReport,
): void {
  const capabilities: Record<string, ModelCapabilityConfig> = {};
  for (const model of models) {
    const evidence = catalogEvidence(provider, model);
    if (!evidence.model) continue;
    capabilities[model] = {
      modalities: evidence.model.modalities,
      endpoints: evidence.model.endpoints,
      ...(evidence.model.limits?.max_context_tokens
        ? { max_context_tokens: evidence.model.limits.max_context_tokens }
        : {}),
      ...(evidence.model.limits?.max_file_size
        ? { max_file_size: evidence.model.limits.max_file_size }
        : {}),
      ...(evidence.model.limits?.dimensions
        ? { dimensions: evidence.model.limits.dimensions }
        : {}),
      ...(evidence.model.pricing?.input !== undefined && evidence.model.pricing?.output !== undefined
        ? { pricing: { input: evidence.model.pricing.input, output: evidence.model.pricing.output } }
        : {}),
      structured_output: evidence.model.capabilities.includes('structured_output') || undefined,
      supports_streaming: evidence.model.capabilities.includes('streaming') || undefined,
      supports_realtime: evidence.model.modalities.includes('realtime') || undefined,
      supports_rerank: evidence.model.modalities.includes('rerank') || undefined,
    };
    report.mapping_notes.push({
      path: `nodes.${node.id}.model_capabilities.${model}`,
      message: `Catalog evidence from ${evidence.model.source}: provider=${evidence.model.provider}; modalities=${evidence.model.modalities.join(',')}.`,
    });
    report.pricing_confidence = maxConfidence(report.pricing_confidence, evidence.pricingConfidence);
    report.capability_confidence = maxConfidence(report.capability_confidence, evidence.capabilityConfidence);
  }
  if (Object.keys(capabilities).length > 0) {
    node.model_capabilities = {
      ...(node.model_capabilities || {}),
      ...capabilities,
    };
  }
}

function buildPricingFromNodes(
  nodes: NodeConfig[],
  sourceType: 'newapi' | 'oneapi',
  report: MigrationReport,
): GatewayConfig['models_pricing'] {
  const pricing: GatewayConfig['models_pricing'] = {};
  for (const node of nodes) {
    for (const model of allNodeModels(node)) {
      const capabilityPricing = node.model_capabilities?.[model]?.pricing;
      if (capabilityPricing) {
        pricing[model] = capabilityPricing;
        report.compatible.push({
          path: `models_pricing.${model}`,
          message: 'Mapped pricing hint from the Provider Catalog.',
        });
      } else {
        pricing[model] = { input: 0, output: 0 };
        pushManual(report, {
          path: `models_pricing.${model}`,
          message: `${formatSourceName(sourceType)} channel exports do not include authoritative pricing; generated 0.00 placeholder pricing.`,
          suggestion: 'Set per-1M-token pricing before enforcing budgets or cost routing.',
        });
      }
    }
  }
  return pricing;
}

function bucketModels(
  models: string[],
  provider: string,
  report: MigrationReport,
  reportPath: string,
): Partial<Record<ModelBucket, string[]>> {
  const buckets: Partial<Record<ModelBucket, string[]>> = {};
  for (const model of models) {
    const bucket = classifyModel(model, provider);
    buckets[bucket] = [...(buckets[bucket] || []), model];
  }
  report.compatible.push({
    path: reportPath,
    message: `Detected model buckets: ${Object.entries(buckets)
      .map(([bucket, values]) => `${bucket}=${values.length}`)
      .join(', ')}.`,
  });
  return buckets;
}

function classifyModel(model: string, provider: string): ModelBucket {
  const evidence = catalogEvidence(provider, model);
  const modalities = evidence.model?.modalities || [];
  if (modalities.includes('realtime')) return 'realtime';
  if (modalities.includes('video')) return 'video';
  if (modalities.includes('rerank')) return 'rerank';
  if (modalities.includes('embedding')) return 'embedding';
  if (modalities.includes('image') && !modalities.includes('text')) return 'image';
  if (modalities.includes('audio') && !modalities.includes('text') && !modalities.includes('vision')) return 'audio';

  const normalized = model.toLowerCase();
  if (normalized.includes('realtime')) return 'realtime';
  if (normalized.includes('video') || normalized.includes('veo') || normalized.includes('sora')) return 'video';
  if (normalized.includes('rerank') || normalized.includes('bge-reranker')) return 'rerank';
  if (normalized.includes('embedding') || normalized.includes('embed')) return 'embedding';
  if (normalized.includes('dall-e') || normalized.includes('image')) return 'image';
  if (
    normalized.includes('whisper') ||
    normalized.includes('tts') ||
    normalized.includes('audio') ||
    normalized.includes('speech')
  ) {
    return 'audio';
  }
  return 'chat';
}

function providerDefaults(provider: string): ProviderDefaults {
  const normalized = normalizeProvider(provider);
  const explicit = PROVIDERS[normalized];
  const catalogProvider = catalogProviderById(normalized);
  if (!catalogProvider) {
    return explicit || {
      ...DEFAULT_PROVIDER,
      apiKeyEnv: `${toEnvPrefix(normalized)}_API_KEY`,
    };
  }
  return {
    ...(explicit || DEFAULT_PROVIDER),
    baseUrl: explicit?.baseUrl || catalogProvider.base_url,
    authType: explicit?.authType || (catalogProvider.auth_type === 'none' ? undefined : catalogProvider.auth_type),
    endpoint:
      explicit?.endpoint ||
      catalogProvider.endpoints.chat_completions ||
      catalogProvider.endpoints.responses ||
      catalogProvider.endpoints.messages ||
      DEFAULT_PROVIDER.endpoint,
    endpoints: catalogProvider.endpoints,
    apiKeyEnv: explicit?.apiKeyEnv || `${toEnvPrefix(normalized)}_API_KEY`,
  };
}

function endpointForBucket(defaults: ProviderDefaults, bucket: ModelBucket, model: string): string {
  const endpoints = defaults.endpoints || {};
  const value =
    bucket === 'chat'
      ? defaults.endpoint
      : bucket === 'embedding'
        ? endpoints.embeddings
        : bucket === 'rerank'
          ? endpoints.rerank
          : bucket === 'image'
            ? endpoints.image || endpoints.images_generations
            : bucket === 'audio'
              ? endpoints.audio || endpoints.audio_transcriptions
              : bucket === 'video'
                ? endpoints.video || endpoints.video_generations
                : endpoints.realtime;
  return replaceModelPlaceholder(value || defaultEndpointForBucket(bucket), model);
}

function defaultEndpointForBucket(bucket: ModelBucket): string {
  if (bucket === 'embedding') return '/v1/embeddings';
  if (bucket === 'rerank') return '/v1/rerank';
  if (bucket === 'image') return '/v1/images/generations';
  if (bucket === 'audio') return '/v1/audio/transcriptions';
  if (bucket === 'video') return '/v1/videos/generations';
  if (bucket === 'realtime') return '/v1/realtime';
  return '/v1/chat/completions';
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
  if ('type' in value || 'base_url' in value || 'models' in value) return [value];
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
    if (normalized === 'azure') return 'azure_openai';
    if (normalized === 'openai_compatible' || normalized === 'custom') return 'openai_compatible';
    return normalized;
  }
  return inferProviderFromChannelValue(value);
}

function inferProviderFromChannelValue(value: Record<string, unknown>): string {
  const baseUrl = (
    stringValue(value.base_url) ||
    stringValue(value.baseUrl) ||
    stringValue(value.api_base) ||
    stringValue(value.url)
  ).toLowerCase();
  if (baseUrl.includes('anthropic')) return 'anthropic';
  if (baseUrl.includes('azure')) return 'azure_openai';
  if (baseUrl.includes('groq')) return 'groq';
  if (baseUrl.includes('mistral')) return 'mistral';
  if (baseUrl.includes('openrouter')) return 'openrouter';
  if (baseUrl.includes('deepseek')) return 'deepseek';
  if (baseUrl.includes('x.ai')) return 'xai';
  if (baseUrl.includes('cohere')) return 'cohere';
  if (baseUrl.includes('voyage')) return 'voyage';
  if (baseUrl.includes('jina')) return 'jina';
  if (baseUrl.includes('together')) return 'together_ai';
  if (baseUrl.includes('fireworks')) return 'fireworks';
  if (baseUrl.includes('openai')) return 'openai';
  const models = splitModelList(value.models ?? value.model_list ?? value.model_name);
  return inferProviderFromModel(models[0] || '');
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
  pushUnsupported(report, {
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
    pushManual(report, {
      path: `channels[${index}].key`,
      message: 'Literal channel key values are not copied into generated SiftGate config.',
      suggestion: `Move the secret to ${fallbackEnv} and set nodes[].api_key to \${${fallbackEnv}}.`,
    });
    return `\${${fallbackEnv}}`;
  }
  const fallbackEnv = `${toEnvPrefix(provider)}_API_KEY`;
  pushManual(report, {
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
    value.models ?? value.model_list ?? value.modelList ?? value.model_name ?? value.model,
  );
  for (const mapped of Object.values(aliases)) {
    if (!models.includes(mapped)) models.push(mapped);
  }
  if (models.length > 0) return Array.from(new Set(models));
  pushUnsupported(report, {
    path: `channels[${index}].models`,
    message: 'No model list found for channel.',
    suggestion: 'Add source channel models or edit nodes[].models after migration.',
  });
  return [`review-model-${index + 1}`];
}

function splitModelList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitModelList(item)).filter(Boolean);
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

function normalizeSiftGateConfig(value: unknown): GatewayConfig {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !isRecord(value.routing)) {
    throw new Error('SiftGate config must contain nodes[] and routing.');
  }
  return value as unknown as GatewayConfig;
}

function nodeModelEntries(node: NodeConfig): Array<{ model: string; bucket: ModelBucket }> {
  return [
    ...node.models.map((model) => ({ model, bucket: 'chat' as const })),
    ...(node.embedding_models || []).map((model) => ({ model, bucket: 'embedding' as const })),
    ...(node.rerank_models || []).map((model) => ({ model, bucket: 'rerank' as const })),
    ...(node.image_models || []).map((model) => ({ model, bucket: 'image' as const })),
    ...(node.audio_models || []).map((model) => ({ model, bucket: 'audio' as const })),
    ...(node.video_models || []).map((model) => ({ model, bucket: 'video' as const })),
    ...(node.realtime_models || []).map((model) => ({ model, bucket: 'realtime' as const })),
  ];
}

function allNodeModels(node: NodeConfig): string[] {
  return Array.from(new Set(nodeModelEntries(node).map((entry) => entry.model)));
}

function nodeBuckets(node: NodeConfig): Partial<Record<ModelBucket, string[]>> {
  return {
    ...(node.models.length ? { chat: node.models } : {}),
    ...(node.embedding_models?.length ? { embedding: node.embedding_models } : {}),
    ...(node.rerank_models?.length ? { rerank: node.rerank_models } : {}),
    ...(node.image_models?.length ? { image: node.image_models } : {}),
    ...(node.audio_models?.length ? { audio: node.audio_models } : {}),
    ...(node.video_models?.length ? { video: node.video_models } : {}),
    ...(node.realtime_models?.length ? { realtime: node.realtime_models } : {}),
  };
}

function allBucketModels(buckets: Partial<Record<ModelBucket, string[]>>): string[] {
  return Array.from(new Set(Object.values(buckets).flatMap((models) => models || [])));
}

function firstModelFromBuckets(buckets: Partial<Record<ModelBucket, string[]>>): string {
  return (
    buckets.chat?.[0] ||
    buckets.embedding?.[0] ||
    buckets.rerank?.[0] ||
    buckets.image?.[0] ||
    buckets.audio?.[0] ||
    buckets.video?.[0] ||
    buckets.realtime?.[0] ||
    'review-model'
  );
}

function firstRouteTarget(nodes: NodeConfig[]): RouteTarget {
  const node = nodes[0];
  return { node: node.id, model: firstModelFromBuckets(nodeBuckets(node)) };
}

function liteLlmModelInfo(
  node: NodeConfig,
  model: string,
  bucket: ModelBucket,
): Record<string, unknown> {
  const capability = node.model_capabilities?.[model];
  const pricing = capability?.pricing;
  return {
    mode: bucket,
    ...(capability?.max_context_tokens ? { max_input_tokens: capability.max_context_tokens } : {}),
    ...(pricing?.input !== undefined ? { input_cost_per_token: pricing.input / 1_000_000 } : {}),
    ...(pricing?.output !== undefined ? { output_cost_per_token: pricing.output / 1_000_000 } : {}),
  };
}

function providerFromSiftGateNode(node: NodeConfig): string {
  const base = node.base_url.toLowerCase();
  if (node.protocol === 'messages' || base.includes('anthropic')) return 'anthropic';
  if (base.includes('azure')) return 'azure_openai';
  if (base.includes('groq')) return 'groq';
  if (base.includes('mistral')) return 'mistral';
  if (base.includes('openrouter')) return 'openrouter';
  if (base.includes('deepseek')) return 'deepseek';
  if (base.includes('x.ai')) return 'xai';
  if (base.includes('cohere')) return 'cohere';
  if (base.includes('voyage')) return 'voyage';
  if (base.includes('jina')) return 'jina';
  if (base.includes('together')) return 'together_ai';
  if (base.includes('fireworks')) return 'fireworks';
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

function exportedNodeApiKey(node: GatewayConfig['nodes'][number]): string {
  return node.api_key || node.credentials?.find((entry) => entry.enabled !== false)?.api_key || '';
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
  pushManual(report, {
    path: reportPath,
    message: 'Literal provider API keys are not copied into exported config.',
    suggestion: `Move the secret to ${fallbackEnv} and set the exported key to \${${fallbackEnv}}.`,
  });
  return `\${${fallbackEnv}}`;
}

function providerToChannelType(provider: string): number | string {
  const entry = Object.entries(CHANNEL_TYPE_PROVIDERS).find(([, value]) => value === provider);
  return entry ? Number(entry[0]) : provider;
}

function catalogEvidence(provider: string, model: string): CatalogEvidence {
  const normalizedProvider = normalizeProvider(provider);
  const providers = [catalogProviderById(normalizedProvider), ...BUILTIN_PROVIDER_CATALOG].filter(
    (entry): entry is CatalogProvider => Boolean(entry),
  );
  for (const catalogProvider of providers) {
    const modelEntry =
      catalogProvider.models.find((item) => item.id === model) ||
      catalogProvider.models.find((item) => model.startsWith(`${item.id}:`));
    if (modelEntry) {
      return {
        provider: catalogProvider,
        model: modelEntry,
        pricingConfidence: modelEntry.pricing?.manual_review_required ? 'medium' : 'high',
        capabilityConfidence: modelEntry.source === 'builtin' ? 'medium' : 'high',
      };
    }
  }
  return {
    provider: catalogProviderById(normalizedProvider),
    pricingConfidence: 'low',
    capabilityConfidence: 'low',
  };
}

function catalogProviderById(provider: string): CatalogProvider | undefined {
  const normalized = normalizeProvider(provider);
  return BUILTIN_PROVIDER_CATALOG.find((entry) => normalizeProvider(entry.id) === normalized);
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

function formatYamlReportComment(report: MigrationReport): string {
  return [
    '',
    '# ============================================================',
    '# Migration report summary',
    `# Compatible: ${report.compatible.length}`,
    `# Partially supported: ${report.partially_supported.length}`,
    `# Unsupported: ${report.unsupported.length}`,
    `# Manual actions: ${report.manual_actions.length}`,
    `# Provider/model mapping notes: ${report.mapping_notes.length}`,
    `# Pricing confidence: ${report.pricing_confidence}`,
    `# Capability confidence: ${report.capability_confidence}`,
    '# ============================================================',
    '',
  ].join('\n');
}

function formatReportGroup(label: string, items: MigrationReportItem[]): string {
  if (items.length === 0) return `${label}: none`;
  return [
    `${label} (${items.length})`,
    ...items.map((item) => {
      const suffix = item.suggestion ? ` Suggestion: ${item.suggestion}` : '';
      return `  - ${item.path}: ${item.message}${suffix}`;
    }),
  ].join('\n');
}

function normalizeReport(report: MigrationReport): MigrationReport {
  if (report.unsupported.length === 0 && report.incompatible.length > 0) {
    report.unsupported.push(...report.incompatible);
  }
  if (report.manual_actions.length === 0 && report.manual.length > 0) {
    report.manual_actions.push(...report.manual);
  }
  if (report.manual.length === 0 && report.manual_actions.length > 0) {
    report.manual.push(...report.manual_actions);
  }
  if (report.incompatible.length === 0 && report.unsupported.length > 0) {
    report.incompatible.push(...report.unsupported);
  }
  if (report.pricing_confidence === 'low' && report.manual_actions.length === 0) {
    report.pricing_confidence = 'medium';
  }
  if (report.capability_confidence === 'low' && report.mapping_notes.length > 0) {
    report.capability_confidence = 'medium';
  }
  return report;
}

function emptyReport(): MigrationReport {
  return {
    compatible: [],
    partially_supported: [],
    unsupported: [],
    incompatible: [],
    manual_actions: [],
    manual: [],
    mapping_notes: [],
    pricing_confidence: 'low',
    capability_confidence: 'low',
  };
}

function pushUnsupported(report: MigrationReport, item: MigrationReportItem): void {
  report.unsupported.push(item);
  report.incompatible.push(item);
}

function pushPartial(report: MigrationReport, item: MigrationReportItem): void {
  report.partially_supported.push(item);
}

function pushManual(report: MigrationReport, item: MigrationReportItem): void {
  report.manual_actions.push(item);
  report.manual.push(item);
}

function providerFromModel(model: string): string | null {
  const slash = model.indexOf('/');
  if (slash <= 0) return null;
  return model.slice(0, slash);
}

function inferProviderFromModel(model: string): string {
  const normalized = model.toLowerCase();
  const providerPrefix = providerFromModel(model);
  if (providerPrefix) return normalizeProvider(providerPrefix);
  if (normalized.startsWith('claude')) return 'anthropic';
  if (normalized.startsWith('gpt') || normalized.startsWith('o') || normalized.startsWith('dall-e')) return 'openai';
  if (normalized.startsWith('gemini')) return 'google';
  if (normalized.startsWith('mistral')) return 'mistral';
  if (normalized.startsWith('deepseek')) return 'deepseek';
  if (normalized.startsWith('command') || normalized.includes('rerank')) return 'cohere';
  return 'openai_compatible';
}

function formatSourceName(type: MigrationConfigType): string {
  if (type === 'litellm') return 'LiteLLM';
  if (type === 'newapi') return 'New API';
  if (type === 'oneapi') return 'One API';
  return 'SiftGate';
}

function normalizeProvider(provider: string): string {
  return (
    provider
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'openai_compatible'
  );
}

function parseEnvReference(value: string): string | null {
  const trimmed = value.trim();
  const patterns = [
    /^\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/,
    /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}$/,
    /^\$([A-Za-z_][A-Za-z0-9_]*)$/,
    /^\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}$/,
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

function replaceModelPlaceholder(value: string, model: string): string {
  return value.replace('{model}', encodeURIComponent(model)).replace('{deployment}', encodeURIComponent(model));
}

function maxConfidence(
  current: MigrationReport['pricing_confidence'],
  next: MigrationReport['pricing_confidence'],
): MigrationReport['pricing_confidence'] {
  const order = { low: 0, medium: 1, high: 2 };
  return order[next] > order[current] ? next : current;
}

function defaultOutputName(targetType: MigrationConfigType): string {
  if (targetType === 'siftgate') return 'gateway.config.yaml';
  if (targetType === 'litellm') return 'litellm.generated.yaml';
  if (targetType === 'newapi') return 'newapi.generated.yaml';
  return 'oneapi.generated.yaml';
}

function toEnvPrefix(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SIFTGATE';
}

function uniqueSafeId(value: string, index: number): string {
  const safe = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return `${safe || 'channel'}-${index + 1}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
