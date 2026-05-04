import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { GatewayConfig } from './gateway.config';
import { buildNodeModelDiagnostics } from './config-diagnostics';
import {
  findCatalogModel,
  flattenCatalogModels,
  loadMergedCatalog,
} from '../catalog/catalog.service';
import type { CatalogIssue, ProviderCatalog } from '../catalog/catalog.types';
import {
  VALID_CAPABILITY_ENDPOINTS,
  VALID_CAPABILITY_IO_TYPES,
  VALID_MODALITIES,
} from './modality';
import { diagnoseNodeAgainstCatalog } from '../catalog/provider-catalog.service';
import {
  SecretReferenceBackend,
  scanSecretReferences,
} from './secret-references';

export type ConfigValidationSeverity = 'error' | 'warning' | 'info';

export interface ConfigValidationIssue {
  severity: ConfigValidationSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface ConfigValidationResult {
  configPath: string;
  ok: boolean;
  issues: ConfigValidationIssue[];
  errors: ConfigValidationIssue[];
  warnings: ConfigValidationIssue[];
  info: ConfigValidationIssue[];
  config?: GatewayConfig;
}

export interface ValidateConfigFileOptions {
  configPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ValidateConfigObjectOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  catalog?: ProviderCatalog;
  catalogIssues?: CatalogIssue[];
}

const DEFAULT_CONFIG_FILE = 'gateway.config.yaml';
const NODE_PROTOCOLS = new Set(['chat_completions', 'responses', 'messages']);
const LOAD_BALANCING_STRATEGIES = new Set(['weighted', 'round_robin', 'least_latency', 'random']);
const ROUTING_OPTIMIZATIONS = new Set(['cost', 'latency', 'balanced', 'quality']);
const ALERT_EVENTS = new Set([
  'budget_threshold',
  'budget_exceeded',
  'node_down',
  'node_recovered',
  'circuit_open',
  'circuit_close',
  'error_spike',
  'latency_spike',
]);
const LOG_SINK_TYPES = new Set(['file', 'webhook', 's3', 'elasticsearch']);
const LOG_SINK_OVERFLOW_POLICIES = new Set(['drop_oldest', 'drop_newest']);
const STATE_BACKENDS = new Set(['memory', 'redis']);
const STATE_UNAVAILABLE_POLICIES = new Set(['fail_open', 'fail_closed']);
const HAS_CONFIG_REF_PATTERN = /\$\{[^}]*\}/;
const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CAPABILITY_ENDPOINTS = new Set<string>(VALID_CAPABILITY_ENDPOINTS);
const CAPABILITY_MODALITIES = new Set<string>(VALID_MODALITIES);
const CAPABILITY_IO_TYPES = new Set<string>(VALID_CAPABILITY_IO_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function isLocalhostUrl(url: URL): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
}

function issue(
  severity: ConfigValidationSeverity,
  code: string,
  message: string,
  issuePath?: string,
): ConfigValidationIssue {
  return { severity, code, message, path: issuePath };
}

function finalizeResult(
  configPath: string,
  issues: ConfigValidationIssue[],
  config?: GatewayConfig,
): ConfigValidationResult {
  const errors = issues.filter((item) => item.severity === 'error');
  const warnings = issues.filter((item) => item.severity === 'warning');
  const info = issues.filter((item) => item.severity === 'info');
  return {
    configPath,
    ok: errors.length === 0,
    issues,
    errors,
    warnings,
    info,
    config,
  };
}

function resolveConfigPath(options: ValidateConfigFileOptions): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const requested =
    options.configPath || env.GATEWAY_CONFIG_PATH || DEFAULT_CONFIG_FILE;
  return path.isAbsolute(requested) ? requested : path.resolve(cwd, requested);
}

export function validateConfigFile(
  options: ValidateConfigFileOptions = {},
): ConfigValidationResult {
  const configPath = resolveConfigPath(options);
  const issues: ConfigValidationIssue[] = [];

  if (!fs.existsSync(configPath)) {
    issues.push(
      issue(
        'error',
        'config_file_not_found',
        `Configuration file not found: ${configPath}`,
      ),
    );
    return finalizeResult(configPath, issues);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    issues.push(
      issue(
        'error',
        'config_file_read_failed',
        error instanceof Error
          ? `Could not read configuration file: ${error.message}`
          : 'Could not read configuration file.',
      ),
    );
    return finalizeResult(configPath, issues);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (error) {
    issues.push(
      issue(
        'error',
        'yaml_parse_error',
        error instanceof Error
          ? error.message
          : 'YAML parser rejected the file.',
      ),
    );
    return finalizeResult(configPath, issues);
  }

  const catalogLoad = loadMergedCatalog({
    cwd: options.cwd,
    env: options.env,
    config: parsed,
  });

  return validateConfigObject(parsed, {
    configPath,
    env: options.env,
    catalog: catalogLoad.catalog,
    catalogIssues: catalogLoad.issues,
  });
}

export function validateConfigObject(
  value: unknown,
  options: ValidateConfigObjectOptions = {},
): ConfigValidationResult {
  const configPath = options.configPath ?? DEFAULT_CONFIG_FILE;
  const env = options.env ?? process.env;
  const issues: ConfigValidationIssue[] = [];

  if (!isRecord(value)) {
    issues.push(
      issue(
        'error',
        'config_root_invalid',
        'Configuration root must be a YAML object.',
      ),
    );
    return finalizeResult(configPath, issues);
  }

  const config = value as Partial<GatewayConfig> & Record<string, unknown>;

  validateTopLevel(config, issues);
  validateSecretReferences(config, env, issues, '', secretBackendState(config.secret_manager));
  validateServer(config.server, issues);
  validateDatabase(config.database, issues);
  validateAuth(config.auth, config.namespaces, issues);
  validateNodes(config.nodes, issues, config.models_pricing, {
    skipLegacyCatalogDiagnostics: Boolean(options.catalog),
  });
  validateNamespaces(config.namespaces, config.nodes, issues);
  validateRouting(config.routing, config.nodes, issues);
  validateBudget(config.budget, issues);
  validateCache(config.cache, issues);
  validateEmbeddingBatching(config.embedding_batching, issues);
  validateRealtime(config.realtime, config.nodes, issues);
  validateShadow(config.shadow, config.nodes, issues);
  validateAlerts(config.alerts, issues);
  validateLogging(config.logging, issues);
  validateState(config.state, issues);
  validateCluster(config.cluster, config.state, issues);
  validateSecretManager(config.secret_manager, issues);
  validatePricing(config.models_pricing, issues);
  validateCatalogConfig(config.catalog, issues);
  validateControlPlane(config.control_plane, issues);
  addSharedDiagnostics(config, issues);
  addCatalogIssues(options.catalogIssues, issues);
  validateConfigAgainstCatalog(config, options.catalog, issues);

  const nodeCount = Array.isArray(config.nodes) ? config.nodes.length : 0;
  const tierCount =
    isRecord(config.routing) && isRecord(config.routing.tiers)
      ? Object.keys(config.routing.tiers).length
      : 0;
  issues.push(
    issue(
      'info',
      'config_summary',
      `Validated ${nodeCount} node(s) and ${tierCount} routing tier(s).`,
    ),
  );

  return finalizeResult(configPath, issues, config as GatewayConfig);
}

function validateTopLevel(
  config: Record<string, unknown>,
  issues: ConfigValidationIssue[],
): void {
  const requiredSections = [
    'server',
    'database',
    'auth',
    'nodes',
    'routing',
    'budget',
    'models_pricing',
  ];

  for (const section of requiredSections) {
    if (config[section] === undefined) {
      issues.push(
        issue(
          'error',
          'missing_required_section',
          `Missing required top-level section "${section}".`,
          section,
        ),
      );
    }
  }
}

function validateServer(
  server: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (server === undefined) return;
  if (!isRecord(server)) {
    issues.push(
      issue(
        'error',
        'invalid_section_type',
        'server must be an object.',
        'server',
      ),
    );
    return;
  }

  if (!isFiniteNumber(server.port)) {
    issues.push(
      issue(
        'error',
        'missing_required_field',
        'server.port must be a number.',
        'server.port',
      ),
    );
  }

  if (!isNonEmptyString(server.host)) {
    issues.push(
      issue(
        'error',
        'missing_required_field',
        'server.host must be a non-empty string.',
        'server.host',
      ),
    );
  }
}

function validateDatabase(
  database: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (database === undefined) return;
  if (!isRecord(database)) {
    issues.push(
      issue(
        'error',
        'invalid_section_type',
        'database must be an object.',
        'database',
      ),
    );
    return;
  }

  if (database.type !== 'sqlite' && database.type !== 'postgres') {
    issues.push(
      issue(
        'error',
        'invalid_database_type',
        'database.type must be "sqlite" or "postgres".',
        'database.type',
      ),
    );
    return;
  }

  if (database.type === 'sqlite' && !isNonEmptyString(database.path)) {
    issues.push(
      issue(
        'error',
        'missing_required_field',
        'database.path is required for sqlite.',
        'database.path',
      ),
    );
  }
  if (database.type === 'postgres' && !isNonEmptyString(database.url)) {
    issues.push(
      issue(
        'error',
        'missing_required_field',
        'database.url is required for postgres.',
        'database.url',
      ),
    );
  }
  if (
    database.synchronize !== undefined &&
    !isBoolean(database.synchronize)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_database_synchronize',
        'database.synchronize must be a boolean when set.',
        'database.synchronize',
      ),
    );
  }
  if (
    database.type === 'postgres' &&
    database.synchronize !== false
  ) {
    issues.push(
      issue(
        'warning',
        'postgres_synchronize_enabled',
        'For production PostgreSQL, initialize/migrate schema first and set database.synchronize: false.',
        'database.synchronize',
      ),
    );
  }
}

function validateAuth(
  auth: unknown,
  namespaces: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (auth === undefined) return;
  if (!isRecord(auth)) {
    issues.push(
      issue('error', 'invalid_section_type', 'auth must be an object.', 'auth'),
    );
    return;
  }

  if (!Array.isArray(auth.api_keys)) {
    issues.push(
      issue(
        'error',
        'missing_required_field',
        'auth.api_keys must be an array.',
        'auth.api_keys',
      ),
    );
    return;
  }

  const namespaceIds = new Set<string>(
    Array.isArray(namespaces)
      ? namespaces
          .filter(isRecord)
          .map((namespace) => namespace.id)
          .filter(isNonEmptyString)
      : [],
  );

  auth.api_keys.forEach((entry, index) => {
    const basePath = `auth.api_keys[${index}]`;
    if (!isRecord(entry)) {
      issues.push(
        issue(
          'error',
          'invalid_api_key_entry',
          'auth.api_keys entries must be objects.',
          basePath,
        ),
      );
      return;
    }
    if (!isNonEmptyString(entry.key)) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'Gateway API key entry requires key.',
          `${basePath}.key`,
        ),
      );
    }
    if (!isNonEmptyString(entry.name)) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'Gateway API key entry requires name.',
          `${basePath}.name`,
        ),
      );
    }
    if (entry.namespace_id !== undefined) {
      if (!isNonEmptyString(entry.namespace_id)) {
        issues.push(
          issue(
            'error',
            'invalid_namespace_reference',
            'auth.api_keys[].namespace_id must be a non-empty string when set.',
            `${basePath}.namespace_id`,
          ),
        );
      } else if (!namespaceIds.has(entry.namespace_id)) {
        issues.push(
          issue(
            'error',
            'unknown_namespace_reference',
            `API key "${entry.name || index}" references unknown namespace "${entry.namespace_id}".`,
            `${basePath}.namespace_id`,
          ),
        );
      }
    }
  });
}

function validateNamespaces(
  namespaces: unknown,
  nodes: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (namespaces === undefined) return;
  if (!Array.isArray(namespaces)) {
    issues.push(
      issue(
        'error',
        'invalid_section_type',
        'namespaces must be an array when set.',
        'namespaces',
      ),
    );
    return;
  }

  const nodeIds = new Set<string>(
    Array.isArray(nodes)
      ? nodes.filter(isRecord).map((node) => node.id).filter(isNonEmptyString)
      : [],
  );
  const modelIds = new Set<string>();
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (!isRecord(node)) continue;
      for (const model of Array.isArray(node.models) ? node.models : []) {
        if (isNonEmptyString(model)) modelIds.add(model);
      }
      for (const model of Array.isArray(node.embedding_models) ? node.embedding_models : []) {
        if (isNonEmptyString(model)) modelIds.add(model);
      }
      for (const model of Array.isArray(node.rerank_models) ? node.rerank_models : []) {
        if (isNonEmptyString(model)) modelIds.add(model);
      }
      for (const model of Array.isArray(node.image_models) ? node.image_models : []) {
        if (isNonEmptyString(model)) modelIds.add(model);
      }
      for (const model of Array.isArray(node.audio_models) ? node.audio_models : []) {
        if (isNonEmptyString(model)) modelIds.add(model);
      }
      for (const model of Array.isArray(node.video_models) ? node.video_models : []) {
        if (isNonEmptyString(model)) modelIds.add(model);
      }
      for (const model of Array.isArray(node.realtime_models) ? node.realtime_models : []) {
        if (isNonEmptyString(model)) modelIds.add(model);
      }
    }
  }

  const seen = new Set<string>();
  namespaces.forEach((namespace, index) => {
    const basePath = `namespaces[${index}]`;
    if (!isRecord(namespace)) {
      issues.push(
        issue(
          'error',
          'invalid_namespace_entry',
          'Namespace entries must be objects.',
          basePath,
        ),
      );
      return;
    }

    if (!isNonEmptyString(namespace.id)) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'namespaces[].id is required.',
          `${basePath}.id`,
        ),
      );
    } else {
      if (seen.has(namespace.id)) {
        issues.push(
          issue(
            'error',
            'duplicate_namespace_id',
            `Namespace id "${namespace.id}" is already used.`,
            `${basePath}.id`,
          ),
        );
      }
      seen.add(namespace.id);
    }

    validateReferenceArray(
      namespace.allowed_nodes,
      `${basePath}.allowed_nodes`,
      nodeIds,
      'unknown_namespace_node',
      'Namespace allowed_nodes references unknown node',
      issues,
    );
    validateReferenceArray(
      namespace.allowed_models,
      `${basePath}.allowed_models`,
      modelIds,
      'unknown_namespace_model',
      'Namespace allowed_models references unknown model',
      issues,
    );

    if (namespace.budget !== undefined) {
      if (!isRecord(namespace.budget)) {
        issues.push(issue('error', 'invalid_namespace_budget', 'namespace.budget must be an object.', `${basePath}.budget`));
      } else {
        validateOptionalPositiveNumber(namespace.budget.daily_token_limit, `${basePath}.budget.daily_token_limit`, 'invalid_namespace_budget', issues);
        validateOptionalPositiveNumber(namespace.budget.daily_cost_limit, `${basePath}.budget.daily_cost_limit`, 'invalid_namespace_budget', issues);
        if (
          namespace.budget.alert_threshold !== undefined &&
          (!isFiniteNumber(namespace.budget.alert_threshold) ||
            namespace.budget.alert_threshold <= 0 ||
            namespace.budget.alert_threshold > 1)
        ) {
          issues.push(issue('error', 'invalid_namespace_budget', 'namespace.budget.alert_threshold must be between 0 and 1.', `${basePath}.budget.alert_threshold`));
        }
      }
    }

    if (namespace.rate_limit !== undefined) {
      if (!isRecord(namespace.rate_limit)) {
        issues.push(issue('error', 'invalid_namespace_rate_limit', 'namespace.rate_limit must be an object.', `${basePath}.rate_limit`));
      } else {
        const rpm = namespace.rate_limit.requests_per_minute;
        if (rpm !== undefined && (!Number.isInteger(rpm) || typeof rpm !== 'number' || rpm < 1)) {
          issues.push(issue('error', 'invalid_namespace_rate_limit', 'namespace.rate_limit.requests_per_minute must be a positive integer.', `${basePath}.rate_limit.requests_per_minute`));
        }
      }
    }
  });
}

function validateReferenceArray(
  value: unknown,
  issuePath: string,
  knownValues: Set<string>,
  code: string,
  messagePrefix: string,
  issues: ConfigValidationIssue[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push(issue('error', code, `${issuePath} must be an array.`, issuePath));
    return;
  }
  value.forEach((item, index) => {
    const itemPath = `${issuePath}[${index}]`;
    if (!isNonEmptyString(item)) {
      issues.push(issue('error', code, `${issuePath} entries must be non-empty strings.`, itemPath));
      return;
    }
    if (!knownValues.has(item)) {
      issues.push(issue('error', code, `${messagePrefix} "${item}".`, itemPath));
    }
  });
}

function validateOptionalPositiveNumber(
  value: unknown,
  issuePath: string,
  code: string,
  issues: ConfigValidationIssue[],
): void {
  if (value === undefined) return;
  if (!isFiniteNumber(value) || value <= 0) {
    issues.push(issue('error', code, `${issuePath} must be a positive number.`, issuePath));
  }
}

function validateNodes(
  nodes: unknown,
  issues: ConfigValidationIssue[],
  modelsPricing?: unknown,
  options: { skipLegacyCatalogDiagnostics?: boolean } = {},
): void {
  if (nodes === undefined) return;
  if (!Array.isArray(nodes)) {
    issues.push(
      issue(
        'error',
        'invalid_section_type',
        'nodes must be an array.',
        'nodes',
      ),
    );
    return;
  }
  if (nodes.length === 0) {
    issues.push(
      issue(
        'error',
        'missing_required_field',
        'nodes must include at least one upstream node.',
        'nodes',
      ),
    );
  }

  const nodeIds = new Map<string, string>();

  nodes.forEach((node, index) => {
    const basePath = `nodes[${index}]`;
    if (!isRecord(node)) {
      issues.push(
        issue(
          'error',
          'invalid_node_entry',
          'Each node entry must be an object.',
          basePath,
        ),
      );
      return;
    }

    if (!isNonEmptyString(node.id)) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'nodes[].id is required.',
          `${basePath}.id`,
        ),
      );
    } else {
      if (!NODE_ID_PATTERN.test(node.id)) {
        issues.push(
          issue(
            'error',
            'invalid_node_id',
            'Node id must start with a letter or number and contain only letters, numbers, dots, underscores, or dashes.',
            `${basePath}.id`,
          ),
        );
      }
      const existingPath = nodeIds.get(node.id);
      if (existingPath) {
        issues.push(
          issue(
            'error',
            'duplicate_node_id',
            `Node id "${node.id}" is already used at ${existingPath}.`,
            `${basePath}.id`,
          ),
        );
      } else {
        nodeIds.set(node.id, `${basePath}.id`);
      }
    }

    if (!isNonEmptyString(node.name)) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'nodes[].name is required.',
          `${basePath}.name`,
        ),
      );
    }
    if (
      !isNonEmptyString(node.protocol) ||
      !NODE_PROTOCOLS.has(node.protocol)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_node_protocol',
          'nodes[].protocol must be one of chat_completions, responses, or messages.',
          `${basePath}.protocol`,
        ),
      );
    }
    if (!isNonEmptyString(node.base_url)) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'nodes[].base_url is required.',
          `${basePath}.base_url`,
        ),
      );
    } else {
      validateHttpUrl(
        node.base_url,
        `${basePath}.base_url`,
        'invalid_node_base_url',
        issues,
      );
    }
    if (!isNonEmptyString(node.endpoint)) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'nodes[].endpoint is required.',
          `${basePath}.endpoint`,
        ),
      );
    } else if (!node.endpoint.startsWith('/')) {
      issues.push(
        issue(
          'error',
          'invalid_node_endpoint',
          'nodes[].endpoint should start with "/".',
          `${basePath}.endpoint`,
        ),
      );
    }
    if (
      node.embeddings_endpoint !== undefined &&
      (!isNonEmptyString(node.embeddings_endpoint) || !node.embeddings_endpoint.startsWith('/'))
    ) {
      issues.push(
        issue(
          'error',
          'invalid_node_endpoint',
          'nodes[].embeddings_endpoint should be a non-empty path starting with "/".',
          `${basePath}.embeddings_endpoint`,
        ),
      );
    }
    if (
      node.rerank_endpoint !== undefined &&
      (!isNonEmptyString(node.rerank_endpoint) || !node.rerank_endpoint.startsWith('/'))
    ) {
      issues.push(
        issue(
          'error',
          'invalid_node_endpoint',
          'nodes[].rerank_endpoint should be a non-empty path starting with "/".',
          `${basePath}.rerank_endpoint`,
        ),
      );
    }
    if (
      node.realtime_endpoint !== undefined &&
      !isValidRealtimeEndpoint(node.realtime_endpoint)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_node_endpoint',
          'nodes[].realtime_endpoint should be a non-empty path starting with "/" or a ws/wss URL.',
          `${basePath}.realtime_endpoint`,
        ),
      );
    }
    validateOptionalEndpoint(node, basePath, 'images_generations_endpoint', issues);
    validateOptionalEndpoint(node, basePath, 'images_edits_endpoint', issues);
    validateOptionalEndpoint(node, basePath, 'images_variations_endpoint', issues);
    validateOptionalEndpoint(node, basePath, 'audio_transcriptions_endpoint', issues);
    validateOptionalEndpoint(node, basePath, 'audio_translations_endpoint', issues);
    validateOptionalEndpoint(node, basePath, 'audio_speech_endpoint', issues);
    validateOptionalEndpoint(node, basePath, 'video_generations_endpoint', issues);
    validateOptionalEndpoint(node, basePath, 'video_endpoint', issues);
    validateOptionalEndpoint(node, basePath, 'video_status_endpoint', issues);
    validateOptionalEndpoint(node, basePath, 'video_content_endpoint', issues);
    validateOptionalEndpoint(node, basePath, 'video_cancel_endpoint', issues);
    if (!isNonEmptyString(node.api_key)) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'nodes[].api_key is required.',
          `${basePath}.api_key`,
        ),
      );
    } else {
      validateProviderApiKey(node, node.api_key, basePath, issues);
    }
    const hasSpecializedModels = [
      'embedding_models',
      'rerank_models',
      'image_models',
      'audio_models',
      'video_models',
      'realtime_models',
    ].some((key) =>
      Array.isArray(node[key]) &&
      (node[key] as unknown[]).some(isNonEmptyString),
    );
    if (!Array.isArray(node.models)) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'nodes[].models must be an array. Use [] for specialized-only nodes.',
          `${basePath}.models`,
        ),
      );
    } else if (node.models.length === 0 && !hasSpecializedModels) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'nodes[].models must contain at least one model id unless a specialized model bucket is configured.',
          `${basePath}.models`,
        ),
      );
    } else {
      const modelIds = new Set<string>();
      node.models.forEach((model, modelIndex) => {
        const modelPath = `${basePath}.models[${modelIndex}]`;
        if (!isNonEmptyString(model)) {
          issues.push(
            issue(
              'error',
              'invalid_model_id',
              'Node model ids must be non-empty strings.',
              modelPath,
            ),
          );
          return;
        }
        if (modelIds.has(model)) {
          issues.push(
            issue(
              'error',
              'duplicate_model_id_in_node',
              `Model "${model}" is listed more than once in this node.`,
              modelPath,
            ),
          );
        }
        modelIds.add(model);
      });
    }
    validateNodeEmbeddingModels(node, basePath, issues);
    validateNodeRerankModels(node, basePath, issues);
    validateNodeMediaModels(node, basePath, 'image_models', 'Image', issues);
    validateNodeMediaModels(node, basePath, 'audio_models', 'Audio', issues);
    validateNodeMediaModels(node, basePath, 'video_models', 'Video', issues);
    validateNodeRealtimeModels(node, basePath, issues);
    if (!isFiniteNumber(node.timeout_ms) || node.timeout_ms <= 0) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'nodes[].timeout_ms must be a positive number.',
          `${basePath}.timeout_ms`,
        ),
      );
    }

    validateNodeAliases(node, basePath, issues);
    validateNodeConnection(node, basePath, issues);
    validateNodeRoutingCapabilities(node, basePath, issues);
    if (!options.skipLegacyCatalogDiagnostics) {
      addCatalogDiagnostics(
        node,
        basePath,
        isRecord(modelsPricing)
          ? (modelsPricing as Record<string, unknown>)
          : undefined,
        issues,
      );
    }
  });
}

function addCatalogDiagnostics(
  node: Record<string, unknown>,
  basePath: string,
  modelsPricing: Record<string, unknown> | undefined,
  issues: ConfigValidationIssue[],
): void {
  for (const diagnostic of diagnoseNodeAgainstCatalog(node, basePath, {
    modelsPricing,
  })) {
    issues.push(
      issue(
        diagnostic.severity,
        diagnostic.code,
        diagnostic.message,
        diagnostic.path,
      ),
    );
  }
}

function validateNodeConnection(
  node: Record<string, unknown>,
  basePath: string,
  issues: ConfigValidationIssue[],
): void {
  if (node.connection === undefined) return;
  if (!isRecord(node.connection)) {
    issues.push(
      issue(
        'error',
        'invalid_node_connection',
        'nodes[].connection must be an object when set.',
        `${basePath}.connection`,
      ),
    );
    return;
  }

  const connection = node.connection;
  for (const key of ['enabled', 'keep_alive', 'http2']) {
    if (connection[key] !== undefined && !isBoolean(connection[key])) {
      issues.push(
        issue(
          'error',
          'invalid_node_connection_flag',
          `nodes[].connection.${key} must be a boolean when set.`,
          `${basePath}.connection.${key}`,
        ),
      );
    }
  }

  for (const key of ['pool_size', 'keep_alive_ms']) {
    if (
      connection[key] !== undefined &&
      (!isFiniteNumber(connection[key]) || connection[key] <= 0)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_node_connection_value',
          `nodes[].connection.${key} must be a positive number when set.`,
          `${basePath}.connection.${key}`,
        ),
      );
    }
  }

  for (const key of ['headers_timeout_ms', 'body_timeout_ms']) {
    if (
      connection[key] !== undefined &&
      (!isFiniteNumber(connection[key]) || connection[key] < 0)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_node_connection_value',
          `nodes[].connection.${key} must be a non-negative number when set.`,
          `${basePath}.connection.${key}`,
        ),
      );
    }
  }

  if (connection.http2 === true) {
    issues.push(
      issue(
        'warning',
        'experimental_http2_connection_pool',
        'nodes[].connection.http2 is experimental; leave it disabled unless the upstream is known to work with undici HTTP/2.',
        `${basePath}.connection.http2`,
      ),
    );
  }
}

function validateOptionalEndpoint(
  node: Record<string, unknown>,
  basePath: string,
  key: string,
  issues: ConfigValidationIssue[],
): void {
  const value = node[key];
  if (value === undefined) return;
  if (!isNonEmptyString(value) || !value.startsWith('/')) {
    issues.push(
      issue(
        'error',
        'invalid_node_endpoint',
        `nodes[].${key} should be a non-empty path starting with "/".`,
        `${basePath}.${key}`,
      ),
    );
  }
}

function validateNodeEmbeddingModels(
  node: Record<string, unknown>,
  basePath: string,
  issues: ConfigValidationIssue[],
): void {
  if (node.embedding_models === undefined) return;
  if (!Array.isArray(node.embedding_models)) {
    issues.push(
      issue(
        'error',
        'invalid_embedding_models',
        'nodes[].embedding_models must be an array of model ids when set.',
        `${basePath}.embedding_models`,
      ),
    );
    return;
  }

  const modelIds = new Set<string>();
  node.embedding_models.forEach((model, modelIndex) => {
    const modelPath = `${basePath}.embedding_models[${modelIndex}]`;
    if (!isNonEmptyString(model)) {
      issues.push(
        issue(
          'error',
          'invalid_model_id',
          'Embedding model ids must be non-empty strings.',
          modelPath,
        ),
      );
      return;
    }
    if (modelIds.has(model)) {
      issues.push(
        issue(
          'error',
          'duplicate_model_id_in_node',
          `Embedding model "${model}" is listed more than once in this node.`,
          modelPath,
        ),
      );
    }
    modelIds.add(model);
  });
}

function validateNodeRerankModels(
  node: Record<string, unknown>,
  basePath: string,
  issues: ConfigValidationIssue[],
): void {
  if (node.rerank_models === undefined) return;
  if (!Array.isArray(node.rerank_models)) {
    issues.push(
      issue(
        'error',
        'invalid_rerank_models',
        'nodes[].rerank_models must be an array of model ids when set.',
        `${basePath}.rerank_models`,
      ),
    );
    return;
  }

  const modelIds = new Set<string>();
  node.rerank_models.forEach((model, modelIndex) => {
    const modelPath = `${basePath}.rerank_models[${modelIndex}]`;
    if (!isNonEmptyString(model)) {
      issues.push(
        issue(
          'error',
          'invalid_model_id',
          'Rerank model ids must be non-empty strings.',
          modelPath,
        ),
      );
      return;
    }
    if (modelIds.has(model)) {
      issues.push(
        issue(
          'error',
          'duplicate_model_id_in_node',
          `Rerank model "${model}" is listed more than once in this node.`,
          modelPath,
        ),
      );
    }
    modelIds.add(model);
  });
}

function validateNodeRealtimeModels(
  node: Record<string, unknown>,
  basePath: string,
  issues: ConfigValidationIssue[],
): void {
  if (node.realtime_models === undefined) return;
  if (!Array.isArray(node.realtime_models)) {
    issues.push(
      issue(
        'error',
        'invalid_realtime_models',
        'nodes[].realtime_models must be an array of model ids when set.',
        `${basePath}.realtime_models`,
      ),
    );
    return;
  }

  const modelIds = new Set<string>();
  node.realtime_models.forEach((model, modelIndex) => {
    const modelPath = `${basePath}.realtime_models[${modelIndex}]`;
    if (!isNonEmptyString(model)) {
      issues.push(
        issue(
          'error',
          'invalid_model_id',
          'Realtime model ids must be non-empty strings.',
          modelPath,
        ),
      );
      return;
    }
    if (modelIds.has(model)) {
      issues.push(
        issue(
          'error',
          'duplicate_model_id_in_node',
          `Realtime model "${model}" is listed more than once in this node.`,
          modelPath,
        ),
      );
    }
    modelIds.add(model);
  });
}

function validateNodeMediaModels(
  node: Record<string, unknown>,
  basePath: string,
  key: 'image_models' | 'audio_models' | 'video_models',
  label: string,
  issues: ConfigValidationIssue[],
): void {
  if (node[key] === undefined) return;
  if (!Array.isArray(node[key])) {
    issues.push(
      issue(
        'error',
        `invalid_${key}`,
        `nodes[].${key} must be an array of model ids when set.`,
        `${basePath}.${key}`,
      ),
    );
    return;
  }

  const modelIds = new Set<string>();
  (node[key] as unknown[]).forEach((model, modelIndex) => {
    const modelPath = `${basePath}.${key}[${modelIndex}]`;
    if (!isNonEmptyString(model)) {
      issues.push(
        issue(
          'error',
          'invalid_model_id',
          `${label} model ids must be non-empty strings.`,
          modelPath,
        ),
      );
      return;
    }
    if (modelIds.has(model)) {
      issues.push(
        issue(
          'error',
          'duplicate_model_id_in_node',
          `${label} model "${model}" is listed more than once in this node.`,
          modelPath,
        ),
      );
    }
    modelIds.add(model);
  });
}

function validateNodeRoutingCapabilities(
  node: Record<string, unknown>,
  basePath: string,
  issues: ConfigValidationIssue[],
): void {
  if (
    node.max_context_tokens !== undefined &&
    (!isFiniteNumber(node.max_context_tokens) || node.max_context_tokens <= 0)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_max_context_tokens',
        'nodes[].max_context_tokens must be a positive number when set.',
        `${basePath}.max_context_tokens`,
      ),
    );
  }

  if (
    node.structured_output !== undefined &&
    typeof node.structured_output !== 'boolean'
  ) {
    issues.push(
      issue(
        'error',
        'invalid_structured_output_flag',
        'nodes[].structured_output must be a boolean when set.',
        `${basePath}.structured_output`,
      ),
    );
  }

  validateCapabilitySchemaFields(node, basePath, 'nodes[]', issues);

  if (node.model_capabilities === undefined) return;
  if (!isRecord(node.model_capabilities)) {
    issues.push(
      issue(
        'error',
        'invalid_model_capabilities',
        'nodes[].model_capabilities must be an object keyed by model id.',
        `${basePath}.model_capabilities`,
      ),
    );
    return;
  }

  const listedModels = new Set(
    [
      ...(Array.isArray(node.models) ? node.models.filter(isNonEmptyString) : []),
      ...(Array.isArray(node.embedding_models) ? node.embedding_models.filter(isNonEmptyString) : []),
      ...(Array.isArray(node.rerank_models) ? node.rerank_models.filter(isNonEmptyString) : []),
      ...(Array.isArray(node.image_models) ? node.image_models.filter(isNonEmptyString) : []),
      ...(Array.isArray(node.audio_models) ? node.audio_models.filter(isNonEmptyString) : []),
      ...(Array.isArray(node.video_models) ? node.video_models.filter(isNonEmptyString) : []),
      ...(Array.isArray(node.realtime_models) ? node.realtime_models.filter(isNonEmptyString) : []),
    ],
  );

  for (const [model, capability] of Object.entries(node.model_capabilities)) {
    const capabilityPath = `${basePath}.model_capabilities.${model}`;
    if (!isRecord(capability)) {
      issues.push(
        issue(
          'error',
          'invalid_model_capability_entry',
          'Model capability entries must be objects.',
          capabilityPath,
        ),
      );
      continue;
    }

    if (listedModels.size > 0 && !listedModels.has(model)) {
      issues.push(
        issue(
          'warning',
          'model_capability_model_not_listed',
          `Model capability "${model}" is not listed under this node's models.`,
          capabilityPath,
        ),
      );
    }

    validateCapabilitySchemaFields(
      capability,
      capabilityPath,
      'model_capabilities[]',
      issues,
    );

    if (
      capability.max_context_tokens !== undefined &&
      (!isFiniteNumber(capability.max_context_tokens) || capability.max_context_tokens <= 0)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_max_context_tokens',
          'model_capabilities[].max_context_tokens must be a positive number when set.',
          `${capabilityPath}.max_context_tokens`,
        ),
      );
    }

    if (
      capability.structured_output !== undefined &&
      typeof capability.structured_output !== 'boolean'
    ) {
      issues.push(
        issue(
          'error',
          'invalid_structured_output_flag',
          'model_capabilities[].structured_output must be a boolean when set.',
          `${capabilityPath}.structured_output`,
        ),
      );
    }

    if (
      capability.quality_score !== undefined &&
      (!isFiniteNumber(capability.quality_score) || capability.quality_score < 0)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_quality_score',
          'model_capabilities[].quality_score must be a non-negative number when set.',
          `${capabilityPath}.quality_score`,
        ),
      );
    }

    if (capability.dimensions !== undefined) {
      validateEmbeddingDimensions(
        capability.dimensions,
        `${capabilityPath}.dimensions`,
        issues,
      );
    }

    if (capability.pricing !== undefined) {
      validatePricingEntry(
        capability.pricing,
        `${capabilityPath}.pricing`,
        issues,
      );
    }
  }
}

function validateCapabilitySchemaFields(
  capability: Record<string, unknown>,
  capabilityPath: string,
  label: string,
  issues: ConfigValidationIssue[],
): void {
  validateModalityArray(capability.modalities, `${capabilityPath}.modalities`, issues);
  validateEndpointMap(capability.endpoints, `${capabilityPath}.endpoints`, issues);
  validateCapabilityIOArray(
    capability.input_types,
    `${capabilityPath}.input_types`,
    `${label}.input_types`,
    issues,
  );
  validateCapabilityIOArray(
    capability.output_types,
    `${capabilityPath}.output_types`,
    `${label}.output_types`,
    issues,
  );

  if (
    capability.max_file_size !== undefined &&
    (!isFiniteNumber(capability.max_file_size) || capability.max_file_size <= 0)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_max_file_size',
        `${label}.max_file_size must be a positive number of bytes when set.`,
        `${capabilityPath}.max_file_size`,
      ),
    );
  }

  for (const key of ['supports_streaming', 'supports_realtime', 'supports_rerank']) {
    if (capability[key] !== undefined && !isBoolean(capability[key])) {
      issues.push(
        issue(
          'error',
          'invalid_capability_support_flag',
          `${label}.${key} must be a boolean when set.`,
          `${capabilityPath}.${key}`,
        ),
      );
    }
  }
}

function validateModalityArray(
  value: unknown,
  valuePath: string,
  issues: ConfigValidationIssue[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(
      issue(
        'error',
        'invalid_capability_modalities',
        'modalities must be a non-empty array when set.',
        valuePath,
      ),
    );
    return;
  }
  value.forEach((modality, index) => {
    const itemPath = `${valuePath}[${index}]`;
    if (!isNonEmptyString(modality)) {
      issues.push(
        issue(
          'error',
          'invalid_capability_modalities',
          'modalities entries must be non-empty strings.',
          itemPath,
        ),
      );
      return;
    }
    if (!CAPABILITY_MODALITIES.has(modality)) {
      issues.push(
        issue(
          'error',
          'invalid_capability_modalities',
          `Unsupported modality "${modality}". Supported values: ${VALID_MODALITIES.join(', ')}.`,
          itemPath,
        ),
      );
    }
  });
}

function validateEndpointMap(
  value: unknown,
  valuePath: string,
  issues: ConfigValidationIssue[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(
      issue(
        'error',
        'invalid_capability_endpoints',
        'endpoints must be an object keyed by capability endpoint when set.',
        valuePath,
      ),
    );
    return;
  }

  for (const [endpointName, endpointValue] of Object.entries(value)) {
    const endpointPath = `${valuePath}.${endpointName}`;
    if (!CAPABILITY_ENDPOINTS.has(endpointName)) {
      issues.push(
        issue(
          'error',
          'invalid_capability_endpoints',
          `Unsupported capability endpoint "${endpointName}". Supported values: ${VALID_CAPABILITY_ENDPOINTS.join(', ')}.`,
          endpointPath,
        ),
      );
      continue;
    }
    if (
      !isNonEmptyString(endpointValue) ||
      !isEndpointReference(endpointValue)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_capability_endpoints',
          'Capability endpoint values must be paths starting with "/" or absolute http(s)/ws(s) URLs.',
          endpointPath,
        ),
      );
    }
  }
}

function validateCapabilityIOArray(
  value: unknown,
  valuePath: string,
  label: string,
  issues: ConfigValidationIssue[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(
      issue(
        'error',
        'invalid_capability_io_types',
        `${label} must be a non-empty array when set.`,
        valuePath,
      ),
    );
    return;
  }
  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      issues.push(
        issue(
          'error',
          'invalid_capability_io_types',
          `${label} entries must be non-empty strings.`,
          `${valuePath}[${index}]`,
        ),
      );
      return;
    }
    if (!CAPABILITY_IO_TYPES.has(item)) {
      issues.push(
        issue(
          'error',
          'invalid_capability_io_types',
          `Unsupported capability I/O type "${item}". Supported values: ${VALID_CAPABILITY_IO_TYPES.join(', ')}.`,
          `${valuePath}[${index}]`,
        ),
      );
    }
  });
}

function isEndpointReference(value: string): boolean {
  if (HAS_CONFIG_REF_PATTERN.test(value)) return true;
  if (value.startsWith('/')) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function validateEmbeddingDimensions(
  value: unknown,
  valuePath: string,
  issues: ConfigValidationIssue[],
): void {
  if (isFiniteNumber(value) && Number.isInteger(value) && value > 0) {
    return;
  }
  if (Array.isArray(value) && value.length > 0) {
    const invalidIndex = value.findIndex(
      (item) => !isFiniteNumber(item) || !Number.isInteger(item) || item <= 0,
    );
    if (invalidIndex === -1) return;
    issues.push(
      issue(
        'error',
        'invalid_embedding_dimensions',
        'model_capabilities[].dimensions must contain only positive integers.',
        `${valuePath}[${invalidIndex}]`,
      ),
    );
    return;
  }
  issues.push(
    issue(
      'error',
      'invalid_embedding_dimensions',
      'model_capabilities[].dimensions must be a positive integer or a non-empty array of positive integers.',
      valuePath,
    ),
  );
}

function validateNodeAliases(
  node: Record<string, unknown>,
  basePath: string,
  issues: ConfigValidationIssue[],
): void {
  if (node.model_aliases !== undefined && !isRecord(node.model_aliases)) {
    issues.push(
      issue(
        'error',
        'invalid_model_aliases',
        'nodes[].model_aliases must be an object.',
        `${basePath}.model_aliases`,
      ),
    );
    return;
  }
  if (isRecord(node.model_aliases)) {
    const models = new Set(
      Array.isArray(node.models) ? node.models.filter(isNonEmptyString) : [],
    );
    for (const [alias, target] of Object.entries(node.model_aliases)) {
      const aliasPath = `${basePath}.model_aliases.${alias}`;
      if (!isNonEmptyString(alias)) {
        issues.push(
          issue(
            'error',
            'invalid_model_alias',
            'Model alias keys must be non-empty.',
            aliasPath,
          ),
        );
      }
      if (!isNonEmptyString(target)) {
        issues.push(
          issue(
            'error',
            'invalid_model_alias_target',
            'Model alias targets must be non-empty strings.',
            aliasPath,
          ),
        );
      } else if (models.size > 0 && !models.has(target)) {
        issues.push(
          issue(
            'warning',
            'model_alias_target_not_listed',
            `Model alias "${alias}" points to "${target}", which is not listed under this node's models.`,
            aliasPath,
          ),
        );
      }
    }
  }

  if (
    node.model_prefixes !== undefined &&
    !Array.isArray(node.model_prefixes)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_model_prefixes',
        'nodes[].model_prefixes must be an array.',
        `${basePath}.model_prefixes`,
      ),
    );
  } else if (Array.isArray(node.model_prefixes)) {
    node.model_prefixes.forEach((prefix, index) => {
      if (!isNonEmptyString(prefix)) {
        issues.push(
          issue(
            'error',
            'invalid_model_prefix',
            'Model prefixes must be non-empty strings.',
            `${basePath}.model_prefixes[${index}]`,
          ),
        );
      }
    });
  }
}

function validateRouting(
  routing: unknown,
  nodes: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (routing === undefined) return;
  if (!isRecord(routing)) {
    issues.push(
      issue(
        'error',
        'invalid_section_type',
        'routing must be an object.',
        'routing',
      ),
    );
    return;
  }

  if (!isRecord(routing.tiers)) {
    issues.push(
      issue(
        'error',
        'missing_required_field',
        'routing.tiers must be an object.',
        'routing.tiers',
      ),
    );
  } else if (Object.keys(routing.tiers).length === 0) {
    issues.push(
      issue(
        'error',
        'missing_required_field',
        'routing.tiers must include at least one tier.',
        'routing.tiers',
      ),
    );
  } else {
    for (const [tierName, tierValue] of Object.entries(routing.tiers)) {
      validateTier(tierName, tierValue, issues);
    }
  }

  if (!isRecord(routing.scoring)) {
    issues.push(
      issue(
        'error',
        'missing_required_field',
        'routing.scoring must be an object.',
        'routing.scoring',
      ),
    );
  } else {
    for (const key of ['simple_max', 'standard_max', 'complex_max']) {
      if (!isFiniteNumber(routing.scoring[key])) {
        issues.push(
          issue(
            'error',
            'missing_required_field',
            `routing.scoring.${key} must be a number.`,
            `routing.scoring.${key}`,
          ),
        );
      }
    }
  }

  if (
    routing.optimization !== undefined &&
    (!isNonEmptyString(routing.optimization) ||
      !ROUTING_OPTIMIZATIONS.has(routing.optimization))
  ) {
    issues.push(
      issue(
        'error',
        'invalid_routing_optimization',
        'routing.optimization must be one of cost, latency, balanced, or quality.',
        'routing.optimization',
      ),
    );
  }

  validateFallbackPolicy(routing.fallback_policy, issues);
  validateDomainPreferences(routing.domain_preferences, nodes, issues);
}

function validateFallbackPolicy(
  fallbackPolicy: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (fallbackPolicy === undefined) return;
  const basePath = 'routing.fallback_policy';
  if (!isRecord(fallbackPolicy)) {
    issues.push(
      issue(
        'error',
        'invalid_fallback_policy',
        'routing.fallback_policy must be an object when configured.',
        basePath,
      ),
    );
    return;
  }

  if (
    fallbackPolicy.immediate_429 !== undefined &&
    !isBoolean(fallbackPolicy.immediate_429)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_fallback_policy',
        'routing.fallback_policy.immediate_429 must be a boolean.',
        `${basePath}.immediate_429`,
      ),
    );
  }

  validateTimeoutFallbackPolicy(fallbackPolicy.timeout, issues);
  validateStructuredOutputFallbackPolicy(
    fallbackPolicy.structured_output,
    issues,
  );
  validateCostDowngradeFallbackPolicy(
    fallbackPolicy.cost_downgrade,
    issues,
  );
}

function validateTimeoutFallbackPolicy(
  timeoutPolicy: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (timeoutPolicy === undefined) return;
  const basePath = 'routing.fallback_policy.timeout';
  if (!isRecord(timeoutPolicy)) {
    issues.push(
      issue(
        'error',
        'invalid_fallback_timeout_policy',
        'routing.fallback_policy.timeout must be an object.',
        basePath,
      ),
    );
    return;
  }

  if (
    timeoutPolicy.enabled !== undefined &&
    !isBoolean(timeoutPolicy.enabled)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_fallback_timeout_policy',
        'routing.fallback_policy.timeout.enabled must be a boolean.',
        `${basePath}.enabled`,
      ),
    );
  }
  if (
    timeoutPolicy.race_fallback !== undefined &&
    !isBoolean(timeoutPolicy.race_fallback)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_fallback_timeout_policy',
        'routing.fallback_policy.timeout.race_fallback must be a boolean.',
        `${basePath}.race_fallback`,
      ),
    );
  }
  if (
    timeoutPolicy.threshold_ms !== undefined &&
    (!isFiniteNumber(timeoutPolicy.threshold_ms) ||
      timeoutPolicy.threshold_ms <= 0)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_fallback_timeout_policy',
        'routing.fallback_policy.timeout.threshold_ms must be a positive number.',
        `${basePath}.threshold_ms`,
      ),
    );
  }
  if (timeoutPolicy.race_fallback === true && timeoutPolicy.threshold_ms === undefined) {
    issues.push(
      issue(
        'error',
        'fallback_race_requires_threshold',
        'routing.fallback_policy.timeout.race_fallback requires an explicit threshold_ms because it can create extra upstream cost.',
        `${basePath}.threshold_ms`,
      ),
    );
  }
}

function validateStructuredOutputFallbackPolicy(
  structuredPolicy: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (structuredPolicy === undefined) return;
  const basePath = 'routing.fallback_policy.structured_output';
  if (!isRecord(structuredPolicy)) {
    issues.push(
      issue(
        'error',
        'invalid_structured_output_fallback_policy',
        'routing.fallback_policy.structured_output must be an object.',
        basePath,
      ),
    );
    return;
  }

  for (const key of [
    'enabled',
    'fallback_on_parse_error',
    'fallback_on_schema_error',
  ]) {
    if (
      structuredPolicy[key] !== undefined &&
      !isBoolean(structuredPolicy[key])
    ) {
      issues.push(
        issue(
          'error',
          'invalid_structured_output_fallback_policy',
          `routing.fallback_policy.structured_output.${key} must be a boolean.`,
          `${basePath}.${key}`,
        ),
      );
    }
  }
}

function validateCostDowngradeFallbackPolicy(
  costPolicy: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (costPolicy === undefined) return;
  const basePath = 'routing.fallback_policy.cost_downgrade';
  if (!isRecord(costPolicy)) {
    issues.push(
      issue(
        'error',
        'invalid_cost_downgrade_policy',
        'routing.fallback_policy.cost_downgrade must be an object.',
        basePath,
      ),
    );
    return;
  }

  if (costPolicy.enabled !== undefined && !isBoolean(costPolicy.enabled)) {
    issues.push(
      issue(
        'error',
        'invalid_cost_downgrade_policy',
        'routing.fallback_policy.cost_downgrade.enabled must be a boolean.',
        `${basePath}.enabled`,
      ),
    );
  }
  if (
    costPolicy.max_estimated_cost_usd !== undefined &&
    (!isFiniteNumber(costPolicy.max_estimated_cost_usd) ||
      costPolicy.max_estimated_cost_usd <= 0)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_cost_downgrade_policy',
        'routing.fallback_policy.cost_downgrade.max_estimated_cost_usd must be a positive number.',
        `${basePath}.max_estimated_cost_usd`,
      ),
    );
  }
  if (costPolicy.enabled === true && costPolicy.max_estimated_cost_usd === undefined) {
    issues.push(
      issue(
        'error',
        'cost_downgrade_requires_limit',
        'routing.fallback_policy.cost_downgrade.enabled requires max_estimated_cost_usd.',
        `${basePath}.max_estimated_cost_usd`,
      ),
    );
  }
}

function validateTier(
  tierName: string,
  tierValue: unknown,
  issues: ConfigValidationIssue[],
): void {
  const tierPath = `routing.tiers.${tierName}`;
  if (!isRecord(tierValue)) {
    issues.push(
      issue(
        'error',
        'invalid_routing_tier',
        'Routing tier must be an object.',
        tierPath,
      ),
    );
    return;
  }

  const hasTargets = Array.isArray(tierValue.targets) && tierValue.targets.length > 0;
  const hasSplit = Array.isArray(tierValue.split) && tierValue.split.length > 0;
  const hasPrimary = tierValue.primary !== undefined;
  if (!hasPrimary && !hasTargets && !hasSplit) {
    issues.push(
      issue(
        'error',
        'missing_route_primary_or_targets',
        'Routing tier must define primary, targets, or split.',
        tierPath,
      ),
    );
  }
  if (hasPrimary) {
    validateRouteTargetShape(tierValue.primary, `${tierPath}.primary`, issues);
  }

  if (
    tierValue.strategy !== undefined &&
    (!isNonEmptyString(tierValue.strategy) ||
      !LOAD_BALANCING_STRATEGIES.has(tierValue.strategy))
  ) {
    issues.push(
      issue(
        'error',
        'invalid_routing_strategy',
        'Routing tier strategy must be one of weighted, round_robin, least_latency, or random.',
        `${tierPath}.strategy`,
      ),
    );
  }

  if (!hasTargets && !hasSplit && !Array.isArray(tierValue.fallbacks)) {
    issues.push(
      issue(
        'error',
        'missing_required_field',
        'Routing tier fallbacks must be an array.',
        `${tierPath}.fallbacks`,
      ),
    );
  } else if (tierValue.fallbacks !== undefined) {
    if (!Array.isArray(tierValue.fallbacks)) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'Routing tier fallbacks must be an array.',
          `${tierPath}.fallbacks`,
        ),
      );
    } else {
      tierValue.fallbacks.forEach((fallback, index) =>
        validateRouteTargetShape(
          fallback,
          `${tierPath}.fallbacks[${index}]`,
          issues,
        ),
      );
    }
  }

  if (tierValue.split !== undefined) {
    if (!Array.isArray(tierValue.split) || tierValue.split.length === 0) {
      issues.push(
        issue(
          'error',
          'invalid_split',
          'Routing tier split must be a non-empty array when present.',
          `${tierPath}.split`,
        ),
      );
    } else {
      let totalWeight = 0;
      tierValue.split.forEach((variant, index) => {
        const variantPath = `${tierPath}.split[${index}]`;
        validateRouteTargetShape(variant, variantPath, issues);
        if (
          !isRecord(variant) ||
          !isFiniteNumber(variant.weight) ||
          variant.weight <= 0
        ) {
          issues.push(
            issue(
              'error',
              'invalid_split_weight',
              'Split variant weight must be a positive number.',
              `${variantPath}.weight`,
            ),
          );
        } else {
          totalWeight += variant.weight;
        }
      });
      if (totalWeight !== 100) {
        issues.push(
          issue(
            'error',
            'invalid_split_weight_total',
            `Routing tier "${tierName}" split weights must sum to 100, got ${totalWeight}.`,
            `${tierPath}.split`,
          ),
        );
      }
    }
  }

  if (tierValue.targets !== undefined) {
    if (!Array.isArray(tierValue.targets) || tierValue.targets.length === 0) {
      issues.push(
        issue(
          'error',
          'invalid_targets',
          'Routing tier targets must be a non-empty array when present.',
          `${tierPath}.targets`,
        ),
      );
    } else {
      tierValue.targets.forEach((target, index) => {
        const targetPath = `${tierPath}.targets[${index}]`;
        validateRouteTargetShape(target, targetPath, issues);
        if (
          isRecord(target) &&
          target.weight !== undefined &&
          (!isFiniteNumber(target.weight) || target.weight <= 0)
        ) {
          issues.push(
            issue(
              'error',
              'invalid_target_weight',
              'Routing target weight must be a positive number when set.',
              `${targetPath}.weight`,
            ),
          );
        }
      });
    }
  }
}

function validateRouteTargetShape(
  target: unknown,
  targetPath: string,
  issues: ConfigValidationIssue[],
): void {
  if (!isRecord(target)) {
    issues.push(
      issue(
        'error',
        'invalid_route_target',
        'Route target must be an object with node and model.',
        targetPath,
      ),
    );
    return;
  }
  if (!isNonEmptyString(target.node)) {
    issues.push(
      issue(
        'error',
        'missing_required_field',
        'Route target node is required.',
        `${targetPath}.node`,
      ),
    );
  }
  if (!isNonEmptyString(target.model)) {
    issues.push(
      issue(
        'error',
        'missing_required_field',
        'Route target model is required.',
        `${targetPath}.model`,
      ),
    );
  }
}

function validateDomainPreferences(
  domainPreferences: unknown,
  nodes: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (domainPreferences === undefined) return;
  if (!isRecord(domainPreferences)) {
    issues.push(
      issue(
        'error',
        'invalid_domain_preferences',
        'routing.domain_preferences must be an object.',
        'routing.domain_preferences',
      ),
    );
    return;
  }

  const nodeIds = new Set<string>();
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (isRecord(node) && isNonEmptyString(node.id)) {
        nodeIds.add(node.id);
      }
    }
  }

  for (const [domain, preferredNodes] of Object.entries(domainPreferences)) {
    const preferencePath = `routing.domain_preferences.${domain}`;
    if (!Array.isArray(preferredNodes)) {
      issues.push(
        issue(
          'error',
          'invalid_domain_preference',
          'Domain preference must be an array of node ids.',
          preferencePath,
        ),
      );
      continue;
    }
    preferredNodes.forEach((nodeId, index) => {
      const nodePath = `${preferencePath}[${index}]`;
      if (!isNonEmptyString(nodeId)) {
        issues.push(
          issue(
            'error',
            'invalid_domain_preference_node',
            'Domain preference node ids must be non-empty strings.',
            nodePath,
          ),
        );
      } else if (!nodeIds.has(nodeId)) {
        issues.push(
          issue(
            'error',
            'domain_preference_unknown_node',
            `Domain preference references unknown node "${nodeId}".`,
            nodePath,
          ),
        );
      }
    });
  }
}

function validateBudget(
  budget: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (budget === undefined) return;
  if (!isRecord(budget)) {
    issues.push(
      issue(
        'error',
        'invalid_section_type',
        'budget must be an object.',
        'budget',
      ),
    );
    return;
  }

  for (const key of [
    'daily_token_limit',
    'daily_cost_limit',
    'alert_threshold',
  ]) {
    if (!isFiniteNumber(budget[key])) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          `budget.${key} must be a number.`,
          `budget.${key}`,
        ),
      );
    }
  }
}

function validateCache(
  cache: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (cache === undefined) return;
  if (!isRecord(cache)) {
    issues.push(
      issue(
        'error',
        'invalid_section_type',
        'cache must be an object.',
        'cache',
      ),
    );
    return;
  }

  if (cache.enabled !== undefined && !isBoolean(cache.enabled)) {
    issues.push(
      issue(
        'error',
        'invalid_cache_config',
        'cache.enabled must be a boolean.',
        'cache.enabled',
      ),
    );
  }
  if (
    cache.ttl_seconds !== undefined &&
    (!isFiniteNumber(cache.ttl_seconds) || cache.ttl_seconds <= 0)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_cache_config',
        'cache.ttl_seconds must be a positive number.',
        'cache.ttl_seconds',
      ),
    );
  }
  if (
    cache.max_entries !== undefined &&
    (!isFiniteNumber(cache.max_entries) || cache.max_entries <= 0)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_cache_config',
        'cache.max_entries must be a positive number.',
        'cache.max_entries',
      ),
    );
  }
  if (
    cache.exclude_tool_use !== undefined &&
    !isBoolean(cache.exclude_tool_use)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_cache_config',
        'cache.exclude_tool_use must be a boolean.',
        'cache.exclude_tool_use',
      ),
    );
  }
  if (cache.stream_cache !== undefined) {
    if (!isRecord(cache.stream_cache)) {
      issues.push(
        issue(
          'error',
          'invalid_stream_cache_config',
          'cache.stream_cache must be an object when set.',
          'cache.stream_cache',
        ),
      );
      return;
    }
    if (
      cache.stream_cache.enabled !== undefined &&
      !isBoolean(cache.stream_cache.enabled)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_stream_cache_config',
          'cache.stream_cache.enabled must be a boolean.',
          'cache.stream_cache.enabled',
        ),
      );
    }
  }
}

function validateEmbeddingBatching(
  batching: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (batching === undefined) return;
  if (!isRecord(batching)) {
    issues.push(
      issue(
        'error',
        'invalid_embedding_batching_config',
        'embedding_batching must be an object.',
        'embedding_batching',
      ),
    );
    return;
  }

  if (batching.enabled !== undefined && !isBoolean(batching.enabled)) {
    issues.push(
      issue(
        'error',
        'invalid_embedding_batching_config',
        'embedding_batching.enabled must be a boolean.',
        'embedding_batching.enabled',
      ),
    );
  }

  for (const key of [
    'window_ms',
    'max_batch_size',
    'max_input_items',
    'max_queue',
    'timeout_ms',
  ]) {
    if (
      batching[key] !== undefined &&
      (!isFiniteNumber(batching[key]) || batching[key] <= 0)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_embedding_batching_config',
          `embedding_batching.${key} must be a positive number.`,
          `embedding_batching.${key}`,
        ),
      );
    }
  }
}

function validateRealtime(
  realtime: unknown,
  nodes: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (realtime === undefined) return;
  if (!isRecord(realtime)) {
    issues.push(
      issue(
        'error',
        'invalid_section_type',
        'realtime must be an object when set.',
        'realtime',
      ),
    );
    return;
  }

  if (realtime.enabled !== undefined && !isBoolean(realtime.enabled)) {
    issues.push(
      issue(
        'error',
        'invalid_realtime_config',
        'realtime.enabled must be a boolean.',
        'realtime.enabled',
      ),
    );
  }
  if (
    realtime.path !== undefined &&
    (!isNonEmptyString(realtime.path) || !realtime.path.startsWith('/'))
  ) {
    issues.push(
      issue(
        'error',
        'invalid_realtime_config',
        'realtime.path must be a non-empty path starting with "/".',
        'realtime.path',
      ),
    );
  }

  for (const key of [
    'max_connections',
    'max_connections_per_node',
    'idle_timeout_ms',
    'upstream_connect_timeout_ms',
    'max_session_ms',
  ]) {
    validateOptionalPositiveNumber(
      realtime[key],
      `realtime.${key}`,
      'invalid_realtime_config',
      issues,
    );
  }

  if (realtime.default_node !== undefined && !isNonEmptyString(realtime.default_node)) {
    issues.push(
      issue(
        'error',
        'invalid_realtime_config',
        'realtime.default_node must be a non-empty string when set.',
        'realtime.default_node',
      ),
    );
  }
  if (realtime.default_model !== undefined && !isNonEmptyString(realtime.default_model)) {
    issues.push(
      issue(
        'error',
        'invalid_realtime_config',
        'realtime.default_model must be a non-empty string when set.',
        'realtime.default_model',
      ),
    );
  }

  const realtimeTargets: Array<{ node: string; model: string }> = [];
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (!isRecord(node) || !isNonEmptyString(node.id)) continue;
      for (const model of Array.isArray(node.realtime_models) ? node.realtime_models : []) {
        if (isNonEmptyString(model)) {
          realtimeTargets.push({ node: node.id, model });
        }
      }
    }
  }

  if (realtime.enabled === true && realtimeTargets.length === 0) {
    issues.push(
      issue(
        'error',
        'realtime_no_models',
        'realtime.enabled requires at least one nodes[].realtime_models entry.',
        'realtime.enabled',
      ),
    );
  }

  if (isNonEmptyString(realtime.default_node)) {
    const nodeTargets = realtimeTargets.filter(
      (target) => target.node === realtime.default_node,
    );
    if (nodeTargets.length === 0) {
      issues.push(
        issue(
          'error',
          'realtime_default_target_invalid',
          `realtime.default_node "${realtime.default_node}" does not expose realtime_models.`,
          'realtime.default_node',
        ),
      );
    } else if (
      isNonEmptyString(realtime.default_model) &&
      realtime.default_model !== 'auto' &&
      !nodeTargets.some((target) => target.model === realtime.default_model)
    ) {
      issues.push(
        issue(
          'error',
          'realtime_default_target_invalid',
          `realtime.default_model "${realtime.default_model}" is not listed under node "${realtime.default_node}" realtime_models.`,
          'realtime.default_model',
        ),
      );
    }
  } else if (
    isNonEmptyString(realtime.default_model) &&
    realtime.default_model !== 'auto' &&
    !realtimeTargets.some((target) => target.model === realtime.default_model)
  ) {
    issues.push(
      issue(
        'error',
        'realtime_default_target_invalid',
        `realtime.default_model "${realtime.default_model}" is not listed in any nodes[].realtime_models.`,
        'realtime.default_model',
      ),
    );
  }

  if (realtime.enabled === true) {
    issues.push(
      issue(
        'info',
        'realtime_experimental',
        'realtime is experimental: it performs WebSocket pass-through only and does not process audio locally.',
        'realtime.enabled',
      ),
    );
  }
}

function validateShadow(
  shadow: unknown,
  nodes: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (shadow === undefined) return;
  if (!isRecord(shadow)) {
    issues.push(issue('error', 'invalid_section_type', 'shadow must be an object.', 'shadow'));
    return;
  }

  if (shadow.enabled !== undefined && !isBoolean(shadow.enabled)) {
    issues.push(issue('error', 'invalid_shadow_config', 'shadow.enabled must be a boolean.', 'shadow.enabled'));
  }
  if (
    shadow.sample_rate !== undefined &&
    (!isFiniteNumber(shadow.sample_rate) || shadow.sample_rate < 0 || shadow.sample_rate > 1)
  ) {
    issues.push(issue('error', 'invalid_shadow_config', 'shadow.sample_rate must be between 0 and 1.', 'shadow.sample_rate'));
  }
  if (
    shadow.timeout_ms !== undefined &&
    (!isFiniteNumber(shadow.timeout_ms) || shadow.timeout_ms <= 0)
  ) {
    issues.push(issue('error', 'invalid_shadow_config', 'shadow.timeout_ms must be a positive number.', 'shadow.timeout_ms'));
  }
  if (shadow.max_recent_results !== undefined) {
    const maxRecent = shadow.max_recent_results;
    if (!Number.isInteger(maxRecent) || typeof maxRecent !== 'number' || maxRecent < 1) {
      issues.push(issue('error', 'invalid_shadow_config', 'shadow.max_recent_results must be a positive integer.', 'shadow.max_recent_results'));
    }
  }

  const nodeList = Array.isArray(nodes) ? nodes.filter(isRecord) : [];
  const targetNode = isNonEmptyString(shadow.target_node)
    ? nodeList.find((node) => node.id === shadow.target_node)
    : undefined;

  if (shadow.enabled === true) {
    if (!isNonEmptyString(shadow.target_node)) {
      issues.push(issue('error', 'missing_shadow_target', 'shadow.target_node is required when shadow.enabled is true.', 'shadow.target_node'));
    } else if (!targetNode) {
      issues.push(issue('error', 'unknown_shadow_target_node', `shadow.target_node references unknown node "${shadow.target_node}".`, 'shadow.target_node'));
    }
  } else if (shadow.target_node !== undefined && !isNonEmptyString(shadow.target_node)) {
    issues.push(issue('error', 'invalid_shadow_config', 'shadow.target_node must be a non-empty string when set.', 'shadow.target_node'));
  } else if (shadow.target_node !== undefined && !targetNode) {
    issues.push(issue('error', 'unknown_shadow_target_node', `shadow.target_node references unknown node "${shadow.target_node}".`, 'shadow.target_node'));
  }

  if (shadow.target_model !== undefined) {
    if (!isNonEmptyString(shadow.target_model)) {
      issues.push(issue('error', 'invalid_shadow_config', 'shadow.target_model must be a non-empty string when set.', 'shadow.target_model'));
    } else if (targetNode) {
      const models = [
        ...(Array.isArray(targetNode.models) ? targetNode.models : []),
        ...(Array.isArray(targetNode.embedding_models) ? targetNode.embedding_models : []),
        ...(Array.isArray(targetNode.rerank_models) ? targetNode.rerank_models : []),
        ...(Array.isArray(targetNode.image_models) ? targetNode.image_models : []),
        ...(Array.isArray(targetNode.audio_models) ? targetNode.audio_models : []),
        ...(Array.isArray(targetNode.video_models) ? targetNode.video_models : []),
      ].filter(isNonEmptyString);
      if (models.length > 0 && !models.includes(shadow.target_model)) {
        issues.push(issue('warning', 'shadow_model_not_listed', `shadow.target_model "${shadow.target_model}" is not listed on node "${targetNode.id}". It will be passed through to the provider.`, 'shadow.target_model'));
      }
    }
  }

  if (shadow.compare !== undefined) {
    if (!isRecord(shadow.compare)) {
      issues.push(issue('error', 'invalid_shadow_config', 'shadow.compare must be an object.', 'shadow.compare'));
    } else {
      if (shadow.compare.store_prompts !== undefined && !isBoolean(shadow.compare.store_prompts)) {
        issues.push(issue('error', 'invalid_shadow_config', 'shadow.compare.store_prompts must be a boolean.', 'shadow.compare.store_prompts'));
      }
      if (shadow.compare.store_responses !== undefined && !isBoolean(shadow.compare.store_responses)) {
        issues.push(issue('error', 'invalid_shadow_config', 'shadow.compare.store_responses must be a boolean.', 'shadow.compare.store_responses'));
      }
      if (shadow.compare.store_prompts === true || shadow.compare.store_responses === true) {
        issues.push(issue('warning', 'shadow_compare_storage_enabled', 'Shadow comparison storage is enabled. Prompts/responses are stored only because this was explicitly configured.', 'shadow.compare'));
      }
    }
  }
}

function validateCluster(
  cluster: unknown,
  state: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (cluster === undefined) return;
  if (!isRecord(cluster)) {
    issues.push(
      issue(
        'error',
        'invalid_section_type',
        'cluster must be an object.',
        'cluster',
      ),
    );
    return;
  }

  if (cluster.enabled !== undefined && !isBoolean(cluster.enabled)) {
    issues.push(
      issue(
        'error',
        'invalid_cluster_config',
        'cluster.enabled must be a boolean.',
        'cluster.enabled',
      ),
    );
  }
  if (
    cluster.reload_broadcast !== undefined &&
    !isBoolean(cluster.reload_broadcast)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_cluster_config',
        'cluster.reload_broadcast must be a boolean.',
        'cluster.reload_broadcast',
      ),
    );
  }
  if (
    cluster.instance_id !== undefined &&
    !isNonEmptyString(cluster.instance_id)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_cluster_config',
        'cluster.instance_id must be a non-empty string when set.',
        'cluster.instance_id',
      ),
    );
  }

  validatePositiveNumber(
    cluster.heartbeat_interval_seconds,
    'cluster.heartbeat_interval_seconds',
    'invalid_cluster_config',
    issues,
  );
  validatePositiveNumber(
    cluster.heartbeat_ttl_seconds,
    'cluster.heartbeat_ttl_seconds',
    'invalid_cluster_config',
    issues,
  );

  if (
    isFiniteNumber(cluster.heartbeat_interval_seconds) &&
    isFiniteNumber(cluster.heartbeat_ttl_seconds) &&
    cluster.heartbeat_ttl_seconds <= cluster.heartbeat_interval_seconds
  ) {
    issues.push(
      issue(
        'warning',
        'cluster_heartbeat_ttl_short',
        'cluster.heartbeat_ttl_seconds should be greater than cluster.heartbeat_interval_seconds.',
        'cluster.heartbeat_ttl_seconds',
      ),
    );
  }

  if (cluster.redis !== undefined) {
    validateRedisConnection(cluster.redis, 'cluster.redis', issues);
  }

  const enabledByCluster = cluster.enabled === true;
  const enabledByState = isRecord(state) && state.backend === 'redis';
  if (enabledByCluster || enabledByState) {
    const redis = isRecord(cluster.redis)
      ? cluster.redis
      : isRecord(state) && isRecord(state.redis)
        ? state.redis
        : undefined;
    if (redis?.url !== undefined) {
      validateRedisUrl(
        redis.url,
        enabledByCluster ? 'cluster.redis.url' : 'state.redis.url',
        issues,
      );
    }
  }
}

function validateRedisConnection(
  redis: unknown,
  redisPath: string,
  issues: ConfigValidationIssue[],
): void {
  if (!isRecord(redis)) {
    issues.push(
      issue(
        'error',
        'invalid_redis_config',
        `${redisPath} must be an object.`,
        redisPath,
      ),
    );
    return;
  }
  if (redis.url !== undefined) {
    validateRedisUrl(redis.url, `${redisPath}.url`, issues);
  }
  if (redis.prefix !== undefined && !isNonEmptyString(redis.prefix)) {
    issues.push(
      issue(
        'error',
        'invalid_redis_config',
        `${redisPath}.prefix must be a non-empty string when set.`,
        `${redisPath}.prefix`,
      ),
    );
  }
}

function validateRedisUrl(
  value: unknown,
  valuePath: string,
  issues: ConfigValidationIssue[],
): void {
  if (!isNonEmptyString(value)) {
    issues.push(
      issue(
        'error',
        'invalid_redis_config',
        `${valuePath} must be a non-empty Redis URL when set.`,
        valuePath,
      ),
    );
    return;
  }
  if (containsEnvReference(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      issues.push(
        issue(
          'error',
          'invalid_redis_url',
          `${valuePath} must use redis:// or rediss://.`,
          valuePath,
        ),
      );
    }
  } catch {
    issues.push(
      issue(
        'error',
        'invalid_redis_url',
        `${valuePath} must be a valid Redis URL.`,
        valuePath,
      ),
    );
  }
}

function validateAlerts(
  alerts: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (alerts === undefined) return;
  if (!isRecord(alerts)) {
    issues.push(
      issue(
        'error',
        'invalid_section_type',
        'alerts must be an object.',
        'alerts',
      ),
    );
    return;
  }

  if (alerts.enabled !== undefined && typeof alerts.enabled !== 'boolean') {
    issues.push(
      issue(
        'error',
        'invalid_alerts_config',
        'alerts.enabled must be a boolean.',
        'alerts.enabled',
      ),
    );
  }

  if (
    alerts.history_size !== undefined &&
    (!isFiniteNumber(alerts.history_size) || alerts.history_size <= 0)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_alerts_config',
        'alerts.history_size must be a positive number.',
        'alerts.history_size',
      ),
    );
  }

  validateAlertSpikeRule(alerts.error_spike, 'alerts.error_spike', 'error_rate', issues);
  validateAlertSpikeRule(alerts.latency_spike, 'alerts.latency_spike', 'p95_ms', issues);
  validateAlertChannels(alerts.channels, issues);
}

function validateAlertSpikeRule(
  rule: unknown,
  rulePath: string,
  thresholdKey: 'error_rate' | 'p95_ms',
  issues: ConfigValidationIssue[],
): void {
  if (rule === undefined) return;
  if (!isRecord(rule)) {
    issues.push(
      issue(
        'error',
        'invalid_alert_spike_rule',
        `${rulePath} must be an object.`,
        rulePath,
      ),
    );
    return;
  }
  if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
    issues.push(
      issue(
        'error',
        'invalid_alert_spike_rule',
        `${rulePath}.enabled must be a boolean.`,
        `${rulePath}.enabled`,
      ),
    );
  }
  for (const key of ['window_seconds', 'min_requests']) {
    if (
      rule[key] !== undefined &&
      (!isFiniteNumber(rule[key]) || rule[key] <= 0)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_alert_spike_rule',
          `${rulePath}.${key} must be a positive number.`,
          `${rulePath}.${key}`,
        ),
      );
    }
  }
  if (
    rule[thresholdKey] !== undefined &&
    (!isFiniteNumber(rule[thresholdKey]) || rule[thresholdKey] <= 0)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_alert_spike_rule',
        `${rulePath}.${thresholdKey} must be a positive number.`,
        `${rulePath}.${thresholdKey}`,
      ),
    );
  }
  if (
    thresholdKey === 'error_rate' &&
    isFiniteNumber(rule.error_rate) &&
    rule.error_rate > 1
  ) {
    issues.push(
      issue(
        'error',
        'invalid_alert_spike_rule',
        'alerts.error_spike.error_rate must be between 0 and 1.',
        'alerts.error_spike.error_rate',
      ),
    );
  }
}

function validateAlertChannels(
  channels: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (channels === undefined) return;
  if (!Array.isArray(channels)) {
    issues.push(
      issue(
        'error',
        'invalid_alert_channel',
        'alerts.channels must be an array.',
        'alerts.channels',
      ),
    );
    return;
  }

  channels.forEach((channel, index) => {
    const channelPath = `alerts.channels[${index}]`;
    if (!isRecord(channel)) {
      issues.push(
        issue(
          'error',
          'invalid_alert_channel',
          'Alert channel entries must be objects.',
          channelPath,
        ),
      );
      return;
    }
    if (channel.type !== 'webhook') {
      issues.push(
        issue(
          'error',
          'invalid_alert_channel_type',
          'Open-source alert channels currently support only type "webhook".',
          `${channelPath}.type`,
        ),
      );
    }
    if (!isNonEmptyString(channel.url)) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'Webhook alert channels require url.',
          `${channelPath}.url`,
        ),
      );
    } else if (!containsEnvReference(channel.url)) {
      validateHttpUrl(
        channel.url,
        `${channelPath}.url`,
        'invalid_alert_webhook_url',
        issues,
      );
    }
    if (channel.name !== undefined && !isNonEmptyString(channel.name)) {
      issues.push(
        issue(
          'error',
          'invalid_alert_channel',
          'alerts.channels[].name must be a non-empty string when set.',
          `${channelPath}.name`,
        ),
      );
    }
    if (
      channel.debounce_seconds !== undefined &&
      (!isFiniteNumber(channel.debounce_seconds) || channel.debounce_seconds < 0)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_alert_channel',
          'alerts.channels[].debounce_seconds must be a non-negative number.',
          `${channelPath}.debounce_seconds`,
        ),
      );
    }
    validateAlertChannelHeaders(channel.headers, channelPath, issues);
    validateAlertChannelEvents(channel.events, channelPath, issues);
    validateAlertChannelRetry(channel.retry, channelPath, issues);
  });
}

function validateAlertChannelHeaders(
  headers: unknown,
  channelPath: string,
  issues: ConfigValidationIssue[],
): void {
  if (headers === undefined) return;
  if (!isRecord(headers)) {
    issues.push(
      issue(
        'error',
        'invalid_alert_channel_headers',
        'alerts.channels[].headers must be an object.',
        `${channelPath}.headers`,
      ),
    );
    return;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (!isNonEmptyString(key) || !isNonEmptyString(value)) {
      issues.push(
        issue(
          'error',
          'invalid_alert_channel_headers',
          'Webhook alert headers must be non-empty string key/value pairs.',
          `${channelPath}.headers.${key}`,
        ),
      );
    }
  }
}

function validateAlertChannelEvents(
  events: unknown,
  channelPath: string,
  issues: ConfigValidationIssue[],
): void {
  if (events === undefined) return;
  if (!Array.isArray(events)) {
    issues.push(
      issue(
        'error',
        'invalid_alert_channel_events',
        'alerts.channels[].events must be an array.',
        `${channelPath}.events`,
      ),
    );
    return;
  }
  events.forEach((event, eventIndex) => {
    if (!isNonEmptyString(event) || !ALERT_EVENTS.has(event)) {
      issues.push(
        issue(
          'error',
          'invalid_alert_channel_event',
          `Unsupported alert event "${String(event)}".`,
          `${channelPath}.events[${eventIndex}]`,
        ),
      );
    }
  });
}

function validateAlertChannelRetry(
  retry: unknown,
  channelPath: string,
  issues: ConfigValidationIssue[],
): void {
  if (retry === undefined) return;
  if (!isRecord(retry)) {
    issues.push(
      issue(
        'error',
        'invalid_alert_channel_retry',
        'alerts.channels[].retry must be an object.',
        `${channelPath}.retry`,
      ),
    );
    return;
  }
  for (const key of ['attempts', 'timeout_ms']) {
    if (
      retry[key] !== undefined &&
      (!isFiniteNumber(retry[key]) || retry[key] <= 0)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_alert_channel_retry',
          `alerts.channels[].retry.${key} must be a positive number.`,
          `${channelPath}.retry.${key}`,
        ),
      );
    }
  }
  if (
    retry.backoff_ms !== undefined &&
    (!isFiniteNumber(retry.backoff_ms) || retry.backoff_ms < 0)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_alert_channel_retry',
        'alerts.channels[].retry.backoff_ms must be a non-negative number.',
        `${channelPath}.retry.backoff_ms`,
      ),
    );
  }
}

function validateLogging(
  logging: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (logging === undefined) return;
  if (!isRecord(logging)) {
    issues.push(
      issue(
        'error',
        'invalid_section_type',
        'logging must be an object.',
        'logging',
      ),
    );
    return;
  }

  if (logging.enabled !== undefined && typeof logging.enabled !== 'boolean') {
    issues.push(
      issue(
        'error',
        'invalid_logging_config',
        'logging.enabled must be a boolean.',
        'logging.enabled',
      ),
    );
  }

  if (logging.sinks === undefined) return;
  if (!Array.isArray(logging.sinks)) {
    issues.push(
      issue(
        'error',
        'invalid_log_sinks',
        'logging.sinks must be an array.',
        'logging.sinks',
      ),
    );
    return;
  }

  logging.sinks.forEach((sink, index) =>
    validateLogSink(sink, `logging.sinks[${index}]`, issues),
  );
}

function validateState(
  state: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (state === undefined) return;
  if (!isRecord(state)) {
    issues.push(
      issue(
        'error',
        'invalid_section_type',
        'state must be an object.',
        'state',
      ),
    );
    return;
  }

  const backend = state.backend ?? 'memory';
  if (!isNonEmptyString(backend) || !STATE_BACKENDS.has(backend)) {
    issues.push(
      issue(
        'error',
        'invalid_state_backend',
        'state.backend must be "memory" or "redis".',
        'state.backend',
      ),
    );
  }

  if (
    state.unavailable_policy !== undefined &&
    (!isNonEmptyString(state.unavailable_policy) ||
      !STATE_UNAVAILABLE_POLICIES.has(state.unavailable_policy))
  ) {
    issues.push(
      issue(
        'error',
        'invalid_state_unavailable_policy',
        'state.unavailable_policy must be "fail_open" or "fail_closed".',
        'state.unavailable_policy',
      ),
    );
  }

  if (state.redis !== undefined && !isRecord(state.redis)) {
    issues.push(
      issue(
        'error',
        'invalid_state_redis',
        'state.redis must be an object.',
        'state.redis',
      ),
    );
    return;
  }

  const redis = isRecord(state.redis) ? state.redis : undefined;
  if (redis?.url !== undefined) {
    if (isNonEmptyString(redis.url)) {
      validateRedisStateUrl(redis.url, issues);
    } else {
      issues.push(
        issue(
          'error',
          'invalid_state_redis_url',
          'state.redis.url must be a non-empty redis:// or rediss:// URL.',
          'state.redis.url',
        ),
      );
    }
  } else if (backend === 'redis') {
    issues.push(
      issue(
        'error',
        'missing_required_field',
        'state.redis.url is required when state.backend is "redis".',
        'state.redis.url',
      ),
    );
  }

  if (
    redis?.prefix !== undefined &&
    (!isNonEmptyString(redis.prefix) || redis.prefix.includes(' '))
  ) {
    issues.push(
      issue(
        'error',
        'invalid_state_redis_prefix',
        'state.redis.prefix must be a non-empty string without spaces.',
        'state.redis.prefix',
      ),
    );
  }

  for (const field of ['timeout_ms', 'sync_interval_ms']) {
    if (
      redis?.[field] !== undefined &&
      (!isFiniteNumber(redis[field]) || redis[field] <= 0)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_state_redis_number',
          `state.redis.${field} must be a positive number.`,
          `state.redis.${field}`,
        ),
      );
    }
  }
}

function validateRedisStateUrl(
  value: string,
  issues: ConfigValidationIssue[],
): void {
  if (HAS_CONFIG_REF_PATTERN.test(value)) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push(
      issue(
        'error',
        'invalid_state_redis_url',
        'state.redis.url must be a valid redis:// or rediss:// URL.',
        'state.redis.url',
      ),
    );
    return;
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    issues.push(
      issue(
        'error',
        'invalid_state_redis_url',
        'state.redis.url must use redis:// or rediss://.',
        'state.redis.url',
      ),
    );
  }
  if (url.protocol === 'redis:' && !isLocalhostUrl(url)) {
    issues.push(
      issue(
        'warning',
        'insecure_state_redis_url',
        'state.redis.url uses plain redis:// outside localhost; use rediss:// or a private network for shared state.',
        'state.redis.url',
      ),
    );
  }
}

function validateLogSink(
  sink: unknown,
  sinkPath: string,
  issues: ConfigValidationIssue[],
): void {
  if (!isRecord(sink)) {
    issues.push(
      issue(
        'error',
        'invalid_log_sink',
        'Log sink entries must be objects.',
        sinkPath,
      ),
    );
    return;
  }

  if (!isNonEmptyString(sink.type) || !LOG_SINK_TYPES.has(sink.type)) {
    issues.push(
      issue(
        'error',
        'invalid_log_sink_type',
        'Log sink type must be one of file, webhook, s3, elasticsearch.',
        `${sinkPath}.type`,
      ),
    );
  }
  if (sink.enabled !== undefined && typeof sink.enabled !== 'boolean') {
    issues.push(
      issue(
        'error',
        'invalid_log_sink',
        'logging.sinks[].enabled must be a boolean.',
        `${sinkPath}.enabled`,
      ),
    );
  }
  if (sink.name !== undefined && !isNonEmptyString(sink.name)) {
    issues.push(
      issue(
        'error',
        'invalid_log_sink',
        'logging.sinks[].name must be a non-empty string when set.',
        `${sinkPath}.name`,
      ),
    );
  }
  validatePositiveNumber(sink.batch_size, `${sinkPath}.batch_size`, 'invalid_log_sink_batching', issues);
  validatePositiveNumber(sink.flush_interval_ms, `${sinkPath}.flush_interval_ms`, 'invalid_log_sink_batching', issues);
  validatePositiveNumber(sink.max_queue, `${sinkPath}.max_queue`, 'invalid_log_sink_queue', issues);
  if (
    sink.overflow !== undefined &&
    (!isNonEmptyString(sink.overflow) || !LOG_SINK_OVERFLOW_POLICIES.has(sink.overflow))
  ) {
    issues.push(
      issue(
        'error',
        'invalid_log_sink_queue',
        'logging.sinks[].overflow must be drop_oldest or drop_newest.',
        `${sinkPath}.overflow`,
      ),
    );
  }

  validateLogSinkFields(sink.fields, `${sinkPath}.fields`, issues);
  validateLogSinkFields(sink.exclude_fields, `${sinkPath}.exclude_fields`, issues);
  validateLogSinkRetry(sink.retry, sinkPath, issues);

  if (sink.type === 'file') {
    if (!isNonEmptyString(sink.path)) {
      issues.push(
        issue(
          'error',
          'missing_log_sink_field',
          'file log sinks require path.',
          `${sinkPath}.path`,
        ),
      );
    }
  } else if (sink.type === 'webhook') {
    validateLogSinkUrl(sink.url, `${sinkPath}.url`, 'invalid_log_sink_url', issues);
    validateLogSinkHeaders(sink.headers, `${sinkPath}.headers`, issues);
  } else if (sink.type === 'elasticsearch') {
    validateLogSinkUrl(sink.url, `${sinkPath}.url`, 'invalid_log_sink_url', issues);
    if (!isNonEmptyString(sink.index)) {
      issues.push(
        issue(
          'error',
          'missing_log_sink_field',
          'elasticsearch log sinks require index.',
          `${sinkPath}.index`,
        ),
      );
    }
    validateLogSinkHeaders(sink.headers, `${sinkPath}.headers`, issues);
  } else if (sink.type === 's3') {
    if (!isNonEmptyString(sink.bucket)) {
      issues.push(
        issue(
          'error',
          'missing_log_sink_field',
          's3 log sinks require bucket.',
          `${sinkPath}.bucket`,
        ),
      );
    }
    if (sink.enabled !== false) {
      issues.push(
        issue(
          'warning',
          'log_sink_interface_only',
          's3 log sink config is reserved as an interface placeholder in the OSS data plane.',
          sinkPath,
        ),
      );
    }
  }
}

function validatePositiveNumber(
  value: unknown,
  valuePath: string,
  code: string,
  issues: ConfigValidationIssue[],
): void {
  if (value === undefined) return;
  if (!isFiniteNumber(value) || value <= 0) {
    issues.push(
      issue(
        'error',
        code,
        `${valuePath} must be a positive number.`,
        valuePath,
      ),
    );
  }
}

function validateLogSinkUrl(
  value: unknown,
  valuePath: string,
  code: string,
  issues: ConfigValidationIssue[],
): void {
  if (!isNonEmptyString(value)) {
    issues.push(
      issue(
        'error',
        'missing_log_sink_field',
        `${valuePath} is required.`,
        valuePath,
      ),
    );
    return;
  }
  if (!containsEnvReference(value)) {
    validateHttpUrl(value, valuePath, code, issues);
  }
}

function validateLogSinkHeaders(
  headers: unknown,
  headerPath: string,
  issues: ConfigValidationIssue[],
): void {
  if (headers === undefined) return;
  if (!isRecord(headers)) {
    issues.push(
      issue(
        'error',
        'invalid_log_sink_headers',
        'log sink headers must be an object.',
        headerPath,
      ),
    );
    return;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (!isNonEmptyString(key) || !isNonEmptyString(value)) {
      issues.push(
        issue(
          'error',
          'invalid_log_sink_headers',
          'log sink headers must be non-empty string key/value pairs.',
          `${headerPath}.${key}`,
        ),
      );
    }
  }
}

function validateLogSinkFields(
  fields: unknown,
  fieldPath: string,
  issues: ConfigValidationIssue[],
): void {
  if (fields === undefined) return;
  if (!Array.isArray(fields)) {
    issues.push(
      issue(
        'error',
        'invalid_log_sink_fields',
        `${fieldPath} must be an array.`,
        fieldPath,
      ),
    );
    return;
  }
  fields.forEach((field, index) => {
    const itemPath = `${fieldPath}[${index}]`;
    if (!isNonEmptyString(field)) {
      issues.push(
        issue(
          'error',
          'invalid_log_sink_fields',
          'log sink field names must be non-empty strings.',
          itemPath,
        ),
      );
      return;
    }
    if (isSensitiveLogField(field)) {
      issues.push(
        issue(
          'warning',
          'log_sink_sensitive_field_ignored',
          `Sensitive log sink field "${field}" will be ignored by the sanitizer.`,
          itemPath,
        ),
      );
    }
  });
}

function validateLogSinkRetry(
  retry: unknown,
  sinkPath: string,
  issues: ConfigValidationIssue[],
): void {
  if (retry === undefined) return;
  if (!isRecord(retry)) {
    issues.push(
      issue(
        'error',
        'invalid_log_sink_retry',
        'logging.sinks[].retry must be an object.',
        `${sinkPath}.retry`,
      ),
    );
    return;
  }
  for (const key of ['attempts', 'timeout_ms']) {
    validatePositiveNumber(
      retry[key],
      `${sinkPath}.retry.${key}`,
      'invalid_log_sink_retry',
      issues,
    );
  }
  if (
    retry.backoff_ms !== undefined &&
    (!isFiniteNumber(retry.backoff_ms) || retry.backoff_ms < 0)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_log_sink_retry',
        'logging.sinks[].retry.backoff_ms must be a non-negative number.',
        `${sinkPath}.retry.backoff_ms`,
      ),
    );
  }
}

function isSensitiveLogField(field: string): boolean {
  const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, '');
  return new Set([
    'prompt',
    'response',
    'requestbody',
    'responsebody',
    'messages',
    'content',
    'rawheaders',
    'headers',
    'authorization',
    'providerkey',
    'providerapikey',
    'apikey',
    'password',
    'secret',
    'token',
    'bearer',
  ]).has(normalized);
}

function validatePricing(
  pricing: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (pricing === undefined) return;
  if (!isRecord(pricing)) {
    issues.push(
      issue(
        'error',
        'invalid_section_type',
        'models_pricing must be an object.',
        'models_pricing',
      ),
    );
    return;
  }

  for (const [model, entry] of Object.entries(pricing)) {
    const pricingPath = `models_pricing.${model}`;
    validatePricingEntry(entry, pricingPath, issues);
  }
}

function validatePricingEntry(
  entry: unknown,
  pricingPath: string,
  issues: ConfigValidationIssue[],
): void {
  if (!isRecord(entry)) {
    issues.push(
      issue(
        'error',
        'invalid_pricing_entry',
        'Pricing entry must be an object.',
        pricingPath,
      ),
    );
    return;
  }
  for (const key of ['input', 'output']) {
    if (!isFiniteNumber(entry[key]) || entry[key] < 0) {
      issues.push(
        issue(
          'error',
          'invalid_pricing_entry',
          `${pricingPath}.${key} must be a non-negative number.`,
          `${pricingPath}.${key}`,
        ),
      );
    }
  }
}

function validateSecretManager(
  secretManager: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (secretManager === undefined) return;
  if (!isRecord(secretManager)) {
    issues.push(
      issue(
        'error',
        'invalid_secret_manager',
        'secret_manager must be an object when configured.',
        'secret_manager',
      ),
    );
    return;
  }

  if (
    secretManager.cache_ttl_seconds !== undefined &&
    (!isFiniteNumber(secretManager.cache_ttl_seconds) ||
      secretManager.cache_ttl_seconds < 0)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_secret_manager_cache_ttl',
        'secret_manager.cache_ttl_seconds must be a non-negative number.',
        'secret_manager.cache_ttl_seconds',
      ),
    );
  }

  if (
    secretManager.failure_policy !== undefined &&
    secretManager.failure_policy !== 'fail_closed' &&
    secretManager.failure_policy !== 'fail_open_for_optional'
  ) {
    issues.push(
      issue(
        'error',
        'invalid_secret_manager_failure_policy',
        'secret_manager.failure_policy must be fail_closed or fail_open_for_optional.',
        'secret_manager.failure_policy',
      ),
    );
  }

  const backends = secretManager.backends;
  if (backends === undefined) return;
  if (!isRecord(backends)) {
    issues.push(
      issue(
        'error',
        'invalid_secret_manager_backends',
        'secret_manager.backends must be an object when configured.',
        'secret_manager.backends',
      ),
    );
    return;
  }

  validateSecretBackendEnabled(backends.env, 'secret_manager.backends.env', issues);
  validateSecretBackendEnabled(backends.vault, 'secret_manager.backends.vault', issues);
  validateSecretBackendEnabled(backends.aws_sm, 'secret_manager.backends.aws_sm', issues);
  validateSecretBackendEnabled(backends.gcp_sm, 'secret_manager.backends.gcp_sm', issues);

  if (isRecord(backends.vault)) {
    validateSecretManagerCredential(
      backends.vault.token,
      'secret_manager.backends.vault.token',
      issues,
    );
    if (
      backends.vault.kv_version !== undefined &&
      backends.vault.kv_version !== 1 &&
      backends.vault.kv_version !== 2
    ) {
      issues.push(
        issue(
          'error',
          'invalid_secret_manager_vault_kv_version',
          'secret_manager.backends.vault.kv_version must be 1 or 2.',
          'secret_manager.backends.vault.kv_version',
        ),
      );
    }
    validateOptionalPositiveNumber(
      backends.vault.timeout_ms,
      'secret_manager.backends.vault.timeout_ms',
      'invalid_secret_manager_timeout',
      issues,
    );
  }

  if (isRecord(backends.aws_sm)) {
    validateSecretManagerCredential(
      backends.aws_sm.secret_access_key,
      'secret_manager.backends.aws_sm.secret_access_key',
      issues,
    );
    validateSecretManagerCredential(
      backends.aws_sm.session_token,
      'secret_manager.backends.aws_sm.session_token',
      issues,
    );
    validateOptionalPositiveNumber(
      backends.aws_sm.timeout_ms,
      'secret_manager.backends.aws_sm.timeout_ms',
      'invalid_secret_manager_timeout',
      issues,
    );
  }

  if (isRecord(backends.gcp_sm)) {
    validateSecretManagerCredential(
      backends.gcp_sm.access_token,
      'secret_manager.backends.gcp_sm.access_token',
      issues,
    );
    validateOptionalPositiveNumber(
      backends.gcp_sm.timeout_ms,
      'secret_manager.backends.gcp_sm.timeout_ms',
      'invalid_secret_manager_timeout',
      issues,
    );
    if (
      backends.gcp_sm.use_metadata !== undefined &&
      !isBoolean(backends.gcp_sm.use_metadata)
    ) {
      issues.push(
        issue(
          'error',
          'invalid_secret_manager_gcp_metadata',
          'secret_manager.backends.gcp_sm.use_metadata must be a boolean.',
          'secret_manager.backends.gcp_sm.use_metadata',
        ),
      );
    }
  }
}

function validateSecretManagerCredential(
  value: unknown,
  issuePath: string,
  issues: ConfigValidationIssue[],
): void {
  if (!isNonEmptyString(value)) return;
  if (containsEnvReference(value)) return;
  if (!looksLikeSecret(value)) return;
  issues.push(
    issue(
      'warning',
      'literal_secret_manager_credential',
      `${issuePath} looks like a literal secret; use an env reference such as \${env:SECRET_MANAGER_TOKEN}.`,
      issuePath,
    ),
  );
}

function validateSecretBackendEnabled(
  backend: unknown,
  issuePath: string,
  issues: ConfigValidationIssue[],
): void {
  if (backend === undefined) return;
  if (!isRecord(backend)) {
    issues.push(
      issue(
        'error',
        'invalid_secret_manager_backend',
        `${issuePath} must be an object when configured.`,
        issuePath,
      ),
    );
    return;
  }
  if (backend.enabled !== undefined && !isBoolean(backend.enabled)) {
    issues.push(
      issue(
        'error',
        'invalid_secret_manager_backend_enabled',
        `${issuePath}.enabled must be a boolean when set.`,
        `${issuePath}.enabled`,
      ),
    );
  }
}

function secretBackendState(
  secretManager: unknown,
): Record<SecretReferenceBackend, boolean> {
  if (!isRecord(secretManager)) {
    return {
      env: true,
      vault: false,
      'aws-sm': false,
      'gcp-sm': false,
    };
  }
  const backends = isRecord(secretManager.backends)
    ? secretManager.backends
    : {};
  return {
    env: isRecord(backends.env) ? backends.env.enabled !== false : true,
    vault: isRecord(backends.vault) ? backends.vault.enabled === true : false,
    'aws-sm': isRecord(backends.aws_sm)
      ? backends.aws_sm.enabled === true
      : false,
    'gcp-sm': isRecord(backends.gcp_sm)
      ? backends.gcp_sm.enabled === true
      : false,
  };
}

function validateCatalogConfig(
  catalog: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (catalog === undefined) return;
  if (!isRecord(catalog)) {
    issues.push(
      issue(
        'error',
        'invalid_catalog_config',
        'catalog must be an object when set.',
        'catalog',
      ),
    );
    return;
  }
  if (
    catalog.override_file !== undefined &&
    !isNonEmptyString(catalog.override_file)
  ) {
    issues.push(
      issue(
        'error',
        'invalid_catalog_override_file',
        'catalog.override_file must be a non-empty path when set.',
        'catalog.override_file',
      ),
    );
  }
}

function addCatalogIssues(
  catalogIssues: CatalogIssue[] | undefined,
  issues: ConfigValidationIssue[],
): void {
  for (const catalogIssue of catalogIssues || []) {
    issues.push(
      issue(
        catalogIssue.severity,
        catalogIssue.code,
        catalogIssue.message,
        catalogIssue.path,
      ),
    );
  }
}

function validateConfigAgainstCatalog(
  config: Partial<GatewayConfig> & Record<string, unknown>,
  catalog: ProviderCatalog | undefined,
  issues: ConfigValidationIssue[],
): void {
  if (!catalog || !Array.isArray(config.nodes)) return;

  const catalogModelIds = new Set(
    flattenCatalogModels(catalog).map((model) => model.id),
  );

  config.nodes.forEach((nodeValue, nodeIndex) => {
    if (!isRecord(nodeValue)) return;
    const node = nodeValue as Record<string, unknown>;
    const basePath = `nodes[${nodeIndex}]`;
    const provider = catalogProviderForNode(catalog, node);

    validateCatalogEndpointMatch(
      node,
      provider,
      node.protocol,
      node.endpoint,
      `${basePath}.endpoint`,
      issues,
    );
    validateCatalogEndpointMatch(
      node,
      provider,
      'embeddings',
      node.embeddings_endpoint,
      `${basePath}.embeddings_endpoint`,
      issues,
    );
    validateCatalogEndpointMatch(
      node,
      provider,
      'rerank',
      node.rerank_endpoint,
      `${basePath}.rerank_endpoint`,
      issues,
    );
    validateCatalogEndpointMatch(
      node,
      provider,
      'image',
      node.images_generations_endpoint,
      `${basePath}.images_generations_endpoint`,
      issues,
    );
    validateCatalogEndpointMatch(
      node,
      provider,
      'audio',
      node.audio_transcriptions_endpoint,
      `${basePath}.audio_transcriptions_endpoint`,
      issues,
    );
    validateCatalogEndpointMatch(
      node,
      provider,
      'realtime',
      node.realtime_endpoint,
      `${basePath}.realtime_endpoint`,
      issues,
    );

    validateCatalogModelsForBucket(
      catalog,
      catalogModelIds,
      stringArray(node.models),
      `${basePath}.models`,
      ['text', 'vision'],
      issues,
    );
    validateCatalogModelsForBucket(
      catalog,
      catalogModelIds,
      stringArray(node.embedding_models),
      `${basePath}.embedding_models`,
      ['embedding'],
      issues,
    );
    validateCatalogModelsForBucket(
      catalog,
      catalogModelIds,
      stringArray(node.rerank_models),
      `${basePath}.rerank_models`,
      ['rerank'],
      issues,
    );
    validateCatalogModelsForBucket(
      catalog,
      catalogModelIds,
      stringArray(node.image_models),
      `${basePath}.image_models`,
      ['image', 'vision'],
      issues,
    );
    validateCatalogModelsForBucket(
      catalog,
      catalogModelIds,
      stringArray(node.audio_models),
      `${basePath}.audio_models`,
      ['audio'],
      issues,
    );
    validateCatalogModelsForBucket(
      catalog,
      catalogModelIds,
      stringArray(node.realtime_models),
      `${basePath}.realtime_models`,
      ['realtime'],
      issues,
    );
  });
}

function catalogProviderForNode(
  catalog: ProviderCatalog,
  node: Record<string, unknown>,
) {
  const nodeId = isNonEmptyString(node.id) ? node.id : '';
  const baseUrl = isNonEmptyString(node.base_url)
    ? normalizeComparableUrl(node.base_url)
    : '';
  return catalog.providers.find((provider) => {
    if (provider.id === nodeId) return true;
    return normalizeComparableUrl(provider.base_url) === baseUrl;
  });
}

function validateCatalogEndpointMatch(
  node: Record<string, unknown>,
  provider: ProviderCatalog['providers'][number] | undefined,
  endpointKey: unknown,
  configuredEndpoint: unknown,
  endpointPath: string,
  issues: ConfigValidationIssue[],
): void {
  if (!provider || !isNonEmptyString(endpointKey) || !isNonEmptyString(configuredEndpoint)) {
    return;
  }
  const catalogEndpoint = provider.endpoints[endpointKey];
  if (!isNonEmptyString(catalogEndpoint)) return;
  const configured = normalizeEndpointPath(configuredEndpoint);
  const expected = normalizeEndpointPath(catalogEndpoint);
  if (configured !== expected) {
    issues.push(
      issue(
        'warning',
        'catalog_endpoint_mismatch',
        `Node "${String(node.id || '')}" endpoint "${configuredEndpoint}" differs from catalog provider "${provider.id}" ${endpointKey} endpoint "${catalogEndpoint}".`,
        endpointPath,
      ),
    );
  }
}

function validateCatalogModelsForBucket(
  catalog: ProviderCatalog,
  catalogModelIds: Set<string>,
  models: string[],
  basePath: string,
  expectedModalities: string[],
  issues: ConfigValidationIssue[],
): void {
  models.forEach((modelId, index) => {
    const modelPath = `${basePath}[${index}]`;
    if (!catalogModelIds.has(modelId)) {
      issues.push(
        issue(
          'warning',
          'catalog_unknown_model',
          `Model "${modelId}" is not in the merged provider catalog. Add it to catalog.override.yaml if this is intentional.`,
          modelPath,
        ),
      );
      return;
    }

    const catalogModel = findCatalogModel(catalog, modelId);
    if (!catalogModel) return;
    if (
      !expectedModalities.some((modality) =>
        (catalogModel.modalities as string[]).includes(modality),
      )
    ) {
      issues.push(
        issue(
          'warning',
          'catalog_modality_mismatch',
          `Model "${modelId}" is listed in ${basePath} but catalog modalities are ${catalogModel.modalities.join(', ')}.`,
          modelPath,
        ),
      );
    }
    if (catalogModel.pricing?.manual_review_required) {
      issues.push(
        issue(
          'info',
          'catalog_pricing_manual_review',
          `Catalog pricing for "${modelId}" is marked manual_review_required; verify before relying on cost routing.`,
          modelPath,
        ),
      );
    }
  });
}

function normalizeEndpointPath(value: string): string {
  if (/^https?:\/\//i.test(value) || /^wss?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return url.pathname.replace(/\/+$/, '') || '/';
    } catch {
      return value.replace(/\/+$/, '');
    }
  }
  return value.replace(/\/+$/, '') || '/';
}

function normalizeComparableUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
  } catch {
    return value.replace(/\/+$/, '');
  }
}

function validateControlPlane(
  controlPlane: unknown,
  issues: ConfigValidationIssue[],
): void {
  if (controlPlane === undefined) {
    issues.push(
      issue(
        'info',
        'control_plane_disabled',
        'control_plane is not configured; the data plane will run standalone.',
        'control_plane',
      ),
    );
    return;
  }
  if (!isRecord(controlPlane)) {
    issues.push(
      issue(
        'error',
        'invalid_control_plane',
        'control_plane must be an object when configured.',
        'control_plane',
      ),
    );
    return;
  }

  if (controlPlane.enabled !== true) {
    issues.push(
      issue(
        'info',
        'control_plane_disabled',
        'control_plane.enabled is false; Cloud remains an optional control plane.',
        'control_plane.enabled',
      ),
    );
    return;
  }

  if (!isNonEmptyString(controlPlane.url)) {
    issues.push(
      issue(
        'error',
        'missing_control_plane_field',
        'control_plane.url is required when enabled.',
        'control_plane.url',
      ),
    );
  } else {
    validateControlPlaneUrl(controlPlane.url, issues);
  }
  if (!isNonEmptyString(controlPlane.gateway_id)) {
    issues.push(
      issue(
        'error',
        'missing_control_plane_field',
        'control_plane.gateway_id is required when enabled.',
        'control_plane.gateway_id',
      ),
    );
  }
  if (!isNonEmptyString(controlPlane.registration_token)) {
    issues.push(
      issue(
        'error',
        'missing_control_plane_field',
        'control_plane.registration_token is required when enabled.',
        'control_plane.registration_token',
      ),
    );
  } else if (!containsEnvReference(controlPlane.registration_token)) {
    issues.push(
      issue(
        'warning',
        'literal_control_plane_token',
        'control_plane.registration_token is literal; use an environment reference for production.',
        'control_plane.registration_token',
      ),
    );
  }

  const telemetry = controlPlane.telemetry;
  if (telemetry !== undefined && !isRecord(telemetry)) {
    issues.push(
      issue(
        'error',
        'invalid_control_plane_telemetry',
        'control_plane.telemetry must be an object.',
        'control_plane.telemetry',
      ),
    );
  } else if (isRecord(telemetry)) {
    if (telemetry.include_prompt === true) {
      issues.push(
        issue(
          'warning',
          'control_plane_prompt_upload_enabled',
          'control_plane.telemetry.include_prompt is enabled; prompts may leave the local data plane.',
          'control_plane.telemetry.include_prompt',
        ),
      );
    }
    if (telemetry.include_response === true) {
      issues.push(
        issue(
          'warning',
          'control_plane_response_upload_enabled',
          'control_plane.telemetry.include_response is enabled; responses may leave the local data plane.',
          'control_plane.telemetry.include_response',
        ),
      );
    }
  }
}

function validateHttpUrl(
  value: string,
  issuePath: string,
  code: string,
  issues: ConfigValidationIssue[],
): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      issues.push(
        issue('error', code, 'URL must use http or https.', issuePath),
      );
      return null;
    }
    return url;
  } catch {
    issues.push(issue('error', code, 'Value must be a valid URL.', issuePath));
    return null;
  }
}

function isValidRealtimeEndpoint(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  if (value.startsWith('/')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'ws:' || url.protocol === 'wss:';
  } catch {
    return false;
  }
}

function validateControlPlaneUrl(
  value: string,
  issues: ConfigValidationIssue[],
): void {
  const url = validateHttpUrl(
    value,
    'control_plane.url',
    'invalid_control_plane_url',
    issues,
  );
  if (!url) return;

  if (url.protocol === 'http:' && !isLocalhostUrl(url)) {
    issues.push(
      issue(
        'warning',
        'insecure_control_plane_url',
        'control_plane.url uses plain HTTP outside localhost; use HTTPS for hosted control planes.',
        'control_plane.url',
      ),
    );
  }
}

function validateSecretReferences(
  value: unknown,
  env: NodeJS.ProcessEnv,
  issues: ConfigValidationIssue[],
  currentPath = '',
  backends: Record<SecretReferenceBackend, boolean>,
): void {
  if (typeof value === 'string') {
    const scan = scanSecretReferences(value);
    for (const invalid of scan.invalid) {
      const envLike = invalid.reason.startsWith('Environment references');
      issues.push(
        issue(
          'error',
          envLike ? 'malformed_env_reference' : 'malformed_secret_reference',
          `${envLike ? 'Environment' : 'Secret'} reference ${invalid.raw} is invalid: ${invalid.reason}`,
          currentPath,
        ),
      );
    }
    for (const ref of scan.references) {
      if (!backends[ref.backend]) {
        issues.push(
          issue(
            'error',
            'secret_backend_disabled',
            `Secret reference ${ref.raw} uses backend "${ref.backend}", but that backend is not enabled.`,
            currentPath,
          ),
        );
        continue;
      }
      if (
        ref.backend === 'env' &&
        ref.defaultValue === undefined &&
        env[ref.target] === undefined
      ) {
        issues.push(
          issue(
            'warning',
            'env_reference_unset',
            `Environment variable ${ref.target} is not set and has no default.`,
            currentPath,
          ),
        );
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateSecretReferences(
        item,
        env,
        issues,
        `${currentPath}[${index}]`,
        backends,
      ),
    );
    return;
  }

  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = currentPath ? `${currentPath}.${key}` : key;
      validateSecretReferences(child, env, issues, childPath, backends);
    }
  }
}

function containsEnvReference(value: string): boolean {
  return HAS_CONFIG_REF_PATTERN.test(value);
}

function validateProviderApiKey(
  node: Record<string, unknown>,
  apiKey: string,
  nodePath: string,
  issues: ConfigValidationIssue[],
): void {
  if (containsEnvReference(apiKey) || isPlaceholderApiKey(apiKey)) {
    return;
  }

  if (looksLikeSecret(apiKey) || !isLocalNode(node)) {
    issues.push(
      issue(
        'warning',
        'literal_provider_api_key',
        'Provider api_key is literal; use an environment reference such as ${PROVIDER_API_KEY} for production.',
        `${nodePath}.api_key`,
      ),
    );
  }
}

function isPlaceholderApiKey(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === 'not-needed' ||
    normalized === 'none' ||
    normalized === 'dummy' ||
    normalized === 'test' ||
    normalized.includes('dummy') ||
    normalized.includes('local')
  );
}

function looksLikeSecret(value: string): boolean {
  return /^(sk-|sk_|xox|api_|key_)/i.test(value) || value.length >= 32;
}

function isLocalNode(node: Record<string, unknown>): boolean {
  if (!isNonEmptyString(node.base_url)) return false;
  try {
    const url = new URL(node.base_url);
    return isLocalhostUrl(url);
  } catch {
    return false;
  }
}

function addSharedDiagnostics(
  config: Partial<GatewayConfig>,
  issues: ConfigValidationIssue[],
): void {
  for (const diagnostic of buildNodeModelDiagnostics(config)) {
    const severity = diagnostic.code.startsWith('route_references_')
      ? 'error'
      : 'warning';
    issues.push(
      issue(
        severity,
        diagnostic.code,
        diagnostic.message,
        diagnosticPath(diagnostic.tier, diagnostic.target),
      ),
    );
  }
}

function diagnosticPath(tier?: string, target?: string): string | undefined {
  if (!tier) return undefined;
  let targetPath = '';
  if (target === 'primary') {
    targetPath = '.primary';
  } else if (target?.startsWith('fallback[')) {
    targetPath = `.fallbacks${target.slice('fallback'.length)}`;
  } else if (target?.startsWith('split[')) {
    targetPath = `.split${target.slice('split'.length)}`;
  } else if (target?.startsWith('targets[')) {
    targetPath = `.${target}`;
  } else if (target) {
    targetPath = `.${target}`;
  }
  return `routing.tiers.${tier}${targetPath}`;
}
