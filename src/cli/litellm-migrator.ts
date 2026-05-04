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
  /** Fields that can be represented only as a scaffold or require behavior review. */
  partially_supported: MigrationReportItem[];
  /** Fields or entries that cannot be migrated safely. Alias of incompatible for older callers. */
  unsupported: MigrationReportItem[];
  incompatible: MigrationReportItem[];
  /** Operator follow-up items. Alias of manual for older callers. */
  manual_actions: MigrationReportItem[];
  manual: MigrationReportItem[];
  /** Provider/model mapping details preserved for review. */
  mapping_notes: MigrationReportItem[];
  pricing_confidence: 'high' | 'medium' | 'low';
  capability_confidence: 'high' | 'medium' | 'low';
}

export interface LiteLlmMigrationResult {
  sourcePath: string;
  outputPath?: string;
  config: GatewayConfig;
  yaml: string;
  report: MigrationReport;
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

  finalizeReport(report);
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
    formatReportGroup('Partially supported', result.report.partially_supported),
    '',
    formatReportGroup('Unsupported', result.report.unsupported),
    '',
    formatReportGroup('Incompatible', result.report.incompatible),
    '',
    formatReportGroup('Manual actions', result.report.manual_actions),
    '',
    formatReportGroup('Manual review', result.report.manual),
    '',
    formatReportGroup('Provider/model mapping notes', result.report.mapping_notes),
    '',
    `Pricing confidence: ${result.report.pricing_confidence}`,
    `Capability confidence: ${result.report.capability_confidence}`,
  );
  return lines.join('\n');
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
  report.mapping_notes.push({
    path: `model_list[${index}]`,
    message: `provider=${provider}; source_model=${modelName}; upstream_model=${upstreamModel}`,
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
    `# Partially supported: ${report.partially_supported.length}`,
    `# Unsupported: ${report.unsupported.length}`,
    `# Incompatible: ${report.incompatible.length}`,
    `# Manual actions: ${report.manual_actions.length}`,
    `# Manual review: ${report.manual.length}`,
    `# Pricing confidence: ${report.pricing_confidence}`,
    `# Capability confidence: ${report.capability_confidence}`,
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

function finalizeReport(report: MigrationReport): MigrationReport {
  if (report.unsupported.length === 0 && report.incompatible.length > 0) {
    report.unsupported.push(...report.incompatible);
  }
  if (report.manual_actions.length === 0 && report.manual.length > 0) {
    report.manual_actions.push(...report.manual);
  }
  if (report.pricing_confidence === 'low') {
    report.pricing_confidence = report.manual.some((item) => item.path.startsWith('models_pricing'))
      ? 'low'
      : 'medium';
  }
  if (report.capability_confidence === 'low' && report.mapping_notes.length > 0) {
    report.capability_confidence = 'medium';
  }
  return report;
}
