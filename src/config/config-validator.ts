import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { GatewayConfig } from './gateway.config';
import { buildNodeModelDiagnostics } from './config-diagnostics';

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
}

interface EnvReference {
  raw: string;
  variable: string;
  hasDefault: boolean;
}

const DEFAULT_CONFIG_FILE = 'gateway.config.yaml';
const NODE_PROTOCOLS = new Set(['chat_completions', 'responses', 'messages']);
const ENV_REF_PATTERN = /\$\{[^}]*\}/g;
const HAS_ENV_REF_PATTERN = /\$\{[^}]*\}/;
const ENV_EXPR_PATTERN = /^([A-Z_][A-Z0-9_]*)(:-[\s\S]*)?$/;
const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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

  return validateConfigObject(parsed, {
    configPath,
    env: options.env,
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
  validateEnvReferences(config, env, issues);
  validateServer(config.server, issues);
  validateDatabase(config.database, issues);
  validateAuth(config.auth, issues);
  validateNodes(config.nodes, issues);
  validateRouting(config.routing, config.nodes, issues);
  validateBudget(config.budget, issues);
  validatePricing(config.models_pricing, issues);
  validateControlPlane(config.control_plane, issues);
  addSharedDiagnostics(config, issues);

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
}

function validateAuth(auth: unknown, issues: ConfigValidationIssue[]): void {
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
  });
}

function validateNodes(nodes: unknown, issues: ConfigValidationIssue[]): void {
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
    if (!Array.isArray(node.models) || node.models.length === 0) {
      issues.push(
        issue(
          'error',
          'missing_required_field',
          'nodes[].models must contain at least one model id.',
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
  });
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

  validateDomainPreferences(routing.domain_preferences, nodes, issues);
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

  validateRouteTargetShape(tierValue.primary, `${tierPath}.primary`, issues);

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
    if (!isRecord(entry)) {
      issues.push(
        issue(
          'error',
          'invalid_pricing_entry',
          'Pricing entry must be an object.',
          pricingPath,
        ),
      );
      continue;
    }
    for (const key of ['input', 'output']) {
      if (!isFiniteNumber(entry[key]) || entry[key] < 0) {
        issues.push(
          issue(
            'error',
            'invalid_pricing_entry',
            `models_pricing.${model}.${key} must be a non-negative number.`,
            `${pricingPath}.${key}`,
          ),
        );
      }
    }
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

function validateEnvReferences(
  value: unknown,
  env: NodeJS.ProcessEnv,
  issues: ConfigValidationIssue[],
  currentPath = '',
): void {
  if (typeof value === 'string') {
    for (const ref of extractEnvReferences(value, currentPath, issues)) {
      if (!ref.hasDefault && env[ref.variable] === undefined) {
        issues.push(
          issue(
            'warning',
            'env_reference_unset',
            `Environment variable ${ref.variable} is not set and has no default.`,
            currentPath,
          ),
        );
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateEnvReferences(item, env, issues, `${currentPath}[${index}]`),
    );
    return;
  }

  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = currentPath ? `${currentPath}.${key}` : key;
      validateEnvReferences(child, env, issues, childPath);
    }
  }
}

function extractEnvReferences(
  value: string,
  valuePath: string,
  issues: ConfigValidationIssue[],
): EnvReference[] {
  const refs: EnvReference[] = [];
  let searchIndex = 0;

  while (searchIndex < value.length) {
    const start = value.indexOf('${', searchIndex);
    if (start === -1) break;

    const end = value.indexOf('}', start + 2);
    if (end === -1) {
      issues.push(
        issue(
          'error',
          'malformed_env_reference',
          'Environment reference is missing a closing "}".',
          valuePath,
        ),
      );
      break;
    }

    const raw = value.slice(start, end + 1);
    const expression = value.slice(start + 2, end).trim();
    const match = ENV_EXPR_PATTERN.exec(expression);
    if (!match) {
      issues.push(
        issue(
          'error',
          'malformed_env_reference',
          `Environment reference ${raw} must use \${VAR} or \${VAR:-default} with an uppercase variable name.`,
          valuePath,
        ),
      );
    } else {
      refs.push({
        raw,
        variable: match[1],
        hasDefault: match[2] !== undefined,
      });
    }

    searchIndex = end + 1;
  }

  const withoutRefs = value.replace(ENV_REF_PATTERN, '');
  if (withoutRefs.includes('}')) {
    issues.push(
      issue(
        'error',
        'malformed_env_reference',
        'String contains a closing "}" without a matching environment reference.',
        valuePath,
      ),
    );
  }

  return refs;
}

function containsEnvReference(value: string): boolean {
  return HAS_ENV_REF_PATTERN.test(value);
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
