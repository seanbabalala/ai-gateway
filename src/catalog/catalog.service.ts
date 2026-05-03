import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ConfigService } from '../config/config.service';
import {
  VALID_CAPABILITY_ENDPOINTS,
  VALID_MODALITIES,
} from '../config/modality';
import { BUILTIN_PROVIDER_CATALOG } from './built-in-catalog';
import type {
  CatalogIssue,
  CatalogLoadOptions,
  CatalogLoadResult,
  CatalogModel,
  CatalogOverrideFile,
  CatalogOverrideModel,
  CatalogOverrideProvider,
  CatalogProvider,
  ProviderCatalog,
} from './catalog.types';

export const DEFAULT_CATALOG_OVERRIDE_FILE = 'catalog.override.yaml';

const VALID_AUTH_TYPES = new Set(['bearer', 'x-api-key', 'none']);
const VALID_MODALITY_SET = new Set<string>(VALID_MODALITIES);
const VALID_ENDPOINT_SET = new Set<string>([
  ...VALID_CAPABILITY_ENDPOINTS,
  'images_generations',
  'images_edits',
  'images_variations',
  'audio_transcriptions',
  'audio_translations',
  'audio_speech',
  'video_status',
  'video_content',
  'video_cancel',
]);
const SECRET_KEY_PATTERN = /(api[_-]?key|provider[_-]?key|secret|token|authorization|bearer|password)/i;
const SECRET_VALUE_PATTERN = /\b(sk-[A-Za-z0-9._~+/-]{12,}|sk_[A-Za-z0-9._~+/-]{12,}|xox[A-Za-z0-9._~+/-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,})\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function cloneProvider(provider: CatalogProvider): CatalogProvider {
  return {
    ...provider,
    endpoints: { ...provider.endpoints },
    model_prefixes: provider.model_prefixes ? [...provider.model_prefixes] : undefined,
    capabilities: provider.capabilities ? [...provider.capabilities] : undefined,
    pricing: provider.pricing ? { ...provider.pricing } : undefined,
    models: provider.models.map((model) => ({
      ...model,
      modalities: [...model.modalities],
      endpoints: { ...model.endpoints },
      capabilities: [...model.capabilities],
      limits: model.limits
        ? {
            ...model.limits,
            dimensions: Array.isArray(model.limits.dimensions)
              ? [...model.limits.dimensions]
              : model.limits.dimensions,
          }
        : undefined,
      pricing: model.pricing ? { ...model.pricing } : undefined,
    })),
  };
}

function issue(
  severity: CatalogIssue['severity'],
  code: string,
  message: string,
  issuePath?: string,
): CatalogIssue {
  return { severity, code, message, path: issuePath };
}

export function resolveCatalogOverridePath(
  options: CatalogLoadOptions = {},
): string {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const configOverride = readConfigOverridePath(options.config);
  const requested =
    options.overridePath ||
    env.SIFTGATE_CATALOG_OVERRIDE ||
    configOverride ||
    DEFAULT_CATALOG_OVERRIDE_FILE;
  return path.isAbsolute(requested) ? requested : path.resolve(cwd, requested);
}

function readConfigOverridePath(config: unknown): string | undefined {
  if (!isRecord(config)) return undefined;
  const catalog = config.catalog;
  if (!isRecord(catalog)) return undefined;
  return isNonEmptyString(catalog.override_file) ? catalog.override_file : undefined;
}

export function loadMergedCatalog(
  options: CatalogLoadOptions = {},
): CatalogLoadResult {
  const overridePath = resolveCatalogOverridePath(options);
  const issues: CatalogIssue[] = [];
  let override: CatalogOverrideFile | null = null;
  let overrideFound = false;

  if (fs.existsSync(overridePath)) {
    overrideFound = true;
    try {
      const raw = fs.readFileSync(overridePath, 'utf8');
      const parsed = yaml.load(raw);
      const validation = validateCatalogOverrideObject(parsed, overridePath);
      issues.push(...validation.issues);
      if (validation.override && !hasCatalogErrors(validation.issues)) {
        override = validation.override;
      }
    } catch (error) {
      issues.push(
        issue(
          'error',
          'catalog_override_read_failed',
          error instanceof Error
            ? `Could not read catalog override: ${error.message}`
            : 'Could not read catalog override.',
          overridePath,
        ),
      );
    }
  }

  const catalog = mergeCatalog(override, overridePath);
  return {
    catalog,
    overridePath,
    overrideFound,
    issues,
  };
}

function hasCatalogErrors(issues: CatalogIssue[]): boolean {
  return issues.some((entry) => entry.severity === 'error');
}

export function validateCatalogOverrideFile(
  filePath: string,
): { override: CatalogOverrideFile | null; issues: CatalogIssue[] } {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return {
      override: null,
      issues: [
        issue(
          'error',
          'catalog_override_not_found',
          `Catalog override file not found: ${resolved}`,
          resolved,
        ),
      ],
    };
  }

  try {
    const parsed = yaml.load(fs.readFileSync(resolved, 'utf8'));
    return validateCatalogOverrideObject(parsed, resolved);
  } catch (error) {
    return {
      override: null,
      issues: [
        issue(
          'error',
          'catalog_override_parse_failed',
          error instanceof Error
            ? error.message
            : 'Catalog override YAML could not be parsed.',
          resolved,
        ),
      ],
    };
  }
}

export function validateCatalogOverrideObject(
  value: unknown,
  sourcePath = DEFAULT_CATALOG_OVERRIDE_FILE,
): { override: CatalogOverrideFile | null; issues: CatalogIssue[] } {
  const issues: CatalogIssue[] = [];
  scanForSecrets(value, issues, '');

  if (!isRecord(value)) {
    issues.push(
      issue(
        'error',
        'catalog_override_root_invalid',
        'Catalog override root must be a YAML object.',
        sourcePath,
      ),
    );
    return { override: null, issues };
  }

  if (value.version !== undefined && value.version !== 1) {
    issues.push(
      issue(
        'error',
        'catalog_override_version_invalid',
        'catalog.override.yaml version must be 1 when set.',
        'version',
      ),
    );
  }

  if (value.providers === undefined) {
    issues.push(
      issue(
        'error',
        'catalog_override_missing_providers',
        'catalog.override.yaml must include providers as an object or array.',
        'providers',
      ),
    );
    return { override: null, issues };
  }

  const providers = normalizeOverrideProviders(value.providers, issues);
  providers.forEach((provider, index) =>
    validateOverrideProvider(provider, `providers[${index}]`, issues),
  );

  return {
    override: {
      version: 1,
      providers,
    },
    issues,
  };
}

function normalizeOverrideProviders(
  value: unknown,
  issues: CatalogIssue[],
): CatalogOverrideProvider[] {
  if (Array.isArray(value)) {
    return value.filter((entry, index): entry is CatalogOverrideProvider => {
      if (!isRecord(entry)) {
        issues.push(
          issue(
            'error',
            'catalog_provider_invalid',
            'Provider override entries must be objects.',
            `providers[${index}]`,
          ),
        );
        return false;
      }
      return true;
    });
  }

  if (!isRecord(value)) {
    issues.push(
      issue(
        'error',
        'catalog_providers_invalid',
        'providers must be an object keyed by provider id or an array.',
        'providers',
      ),
    );
    return [];
  }

  return Object.entries(value).flatMap(([providerId, providerValue]) => {
    if (!isRecord(providerValue)) {
      issues.push(
        issue(
          'error',
          'catalog_provider_invalid',
          'Provider override entries must be objects.',
          `providers.${providerId}`,
        ),
      );
      return [];
    }
    return [{ id: providerId, ...providerValue } as CatalogOverrideProvider];
  });
}

function validateOverrideProvider(
  provider: CatalogOverrideProvider,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (!isNonEmptyString(provider.id)) {
    issues.push(
      issue(
        'error',
        'catalog_provider_id_invalid',
        'Provider override id must be a non-empty string.',
        `${basePath}.id`,
      ),
    );
  }

  if (provider.base_url !== undefined) {
    if (!isNonEmptyString(provider.base_url)) {
      issues.push(
        issue(
          'error',
          'catalog_provider_base_url_invalid',
          'Provider base_url must be a non-empty string.',
          `${basePath}.base_url`,
        ),
      );
    } else {
      validateCatalogUrl(provider.base_url, `${basePath}.base_url`, issues);
    }
  }

  if (
    provider.auth_type !== undefined &&
    !VALID_AUTH_TYPES.has(provider.auth_type)
  ) {
    issues.push(
      issue(
        'error',
        'catalog_provider_auth_type_invalid',
        'Provider auth_type must be bearer, x-api-key, or none.',
        `${basePath}.auth_type`,
      ),
    );
  }

  validateEndpointMap(provider.endpoints, `${basePath}.endpoints`, issues);
  validateStringArray(provider.model_prefixes, `${basePath}.model_prefixes`, issues);
  validateStringArray(provider.capabilities, `${basePath}.capabilities`, issues);
  validatePricing(provider.pricing, `${basePath}.pricing`, issues);

  if (provider.models !== undefined) {
    if (!Array.isArray(provider.models)) {
      issues.push(
        issue(
          'error',
          'catalog_provider_models_invalid',
          'Provider models must be an array.',
          `${basePath}.models`,
        ),
      );
    } else {
      provider.models.forEach((model, index) =>
        validateOverrideModel(model, `${basePath}.models[${index}]`, issues),
      );
    }
  }
}

function validateOverrideModel(
  model: CatalogOverrideModel,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (!isRecord(model)) {
    issues.push(
      issue(
        'error',
        'catalog_model_invalid',
        'Model override entries must be objects.',
        basePath,
      ),
    );
    return;
  }
  if (!isNonEmptyString(model.id)) {
    issues.push(
      issue(
        'error',
        'catalog_model_id_invalid',
        'Model override id must be a non-empty string.',
        `${basePath}.id`,
      ),
    );
  }
  validateModalities(model.modalities, `${basePath}.modalities`, issues);
  validateEndpointMap(model.endpoints, `${basePath}.endpoints`, issues);
  validateStringArray(model.capabilities, `${basePath}.capabilities`, issues);
  validatePricing(model.pricing, `${basePath}.pricing`, issues);
  if (model.limits !== undefined && !isRecord(model.limits)) {
    issues.push(
      issue(
        'error',
        'catalog_model_limits_invalid',
        'Model limits must be an object.',
        `${basePath}.limits`,
      ),
    );
  }
}

function validateCatalogUrl(
  value: string,
  issuePath: string,
  issues: CatalogIssue[],
): void {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('invalid protocol');
    }
  } catch {
    issues.push(
      issue(
        'error',
        'catalog_url_invalid',
        'Catalog provider base_url must be an http(s) URL.',
        issuePath,
      ),
    );
  }
}

function validateEndpointMap(
  endpoints: unknown,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (endpoints === undefined) return;
  if (!isRecord(endpoints)) {
    issues.push(
      issue(
        'error',
        'catalog_endpoints_invalid',
        'endpoints must be an object.',
        basePath,
      ),
    );
    return;
  }
  for (const [key, value] of Object.entries(endpoints)) {
    if (!VALID_ENDPOINT_SET.has(key)) {
      issues.push(
        issue(
          'warning',
          'catalog_endpoint_unknown',
          `Endpoint key "${key}" is not a known SiftGate capability endpoint.`,
          `${basePath}.${key}`,
        ),
      );
    }
    if (!isNonEmptyString(value)) {
      issues.push(
        issue(
          'error',
          'catalog_endpoint_invalid',
          'Endpoint values must be non-empty strings.',
          `${basePath}.${key}`,
        ),
      );
    } else if (
      !value.startsWith('/') &&
      !/^https?:\/\//i.test(value) &&
      !/^wss?:\/\//i.test(value)
    ) {
      issues.push(
        issue(
          'error',
          'catalog_endpoint_invalid',
          'Endpoint values must be paths or http(s)/ws(s) URLs.',
          `${basePath}.${key}`,
        ),
      );
    }
  }
}

function validateModalities(
  modalities: unknown,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (modalities === undefined) return;
  if (!Array.isArray(modalities)) {
    issues.push(
      issue(
        'error',
        'catalog_modalities_invalid',
        'modalities must be an array.',
        basePath,
      ),
    );
    return;
  }
  modalities.forEach((modality, index) => {
    if (!isNonEmptyString(modality) || !VALID_MODALITY_SET.has(modality)) {
      issues.push(
        issue(
          'error',
          'catalog_modality_invalid',
          `Unsupported modality "${String(modality)}".`,
          `${basePath}[${index}]`,
        ),
      );
    }
  });
}

function validateStringArray(
  value: unknown,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push(
      issue(
        'error',
        'catalog_string_array_invalid',
        'Value must be an array of strings.',
        basePath,
      ),
    );
    return;
  }
  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      issues.push(
        issue(
          'error',
          'catalog_string_array_invalid',
          'Array entries must be non-empty strings.',
          `${basePath}[${index}]`,
        ),
      );
    }
  });
}

function validatePricing(
  pricing: unknown,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (pricing === undefined) return;
  if (!isRecord(pricing)) {
    issues.push(
      issue('error', 'catalog_pricing_invalid', 'pricing must be an object.', basePath),
    );
    return;
  }
  for (const key of ['input', 'output']) {
    if (
      pricing[key] !== undefined &&
      (typeof pricing[key] !== 'number' || !Number.isFinite(pricing[key]) || pricing[key] < 0)
    ) {
      issues.push(
        issue(
          'error',
          'catalog_pricing_invalid',
          `pricing.${key} must be a non-negative number when set.`,
          `${basePath}.${key}`,
        ),
      );
    }
  }
  if (!isNonEmptyString(pricing.source)) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_source_missing',
        'pricing.source should describe where this value came from.',
        `${basePath}.source`,
      ),
    );
  }
  if (!isNonEmptyString(pricing.last_updated)) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_last_updated_missing',
        'pricing.last_updated should be an ISO date.',
        `${basePath}.last_updated`,
      ),
    );
  }
  if (pricing.manual_review_required !== undefined && typeof pricing.manual_review_required !== 'boolean') {
    issues.push(
      issue(
        'error',
        'catalog_pricing_invalid',
        'pricing.manual_review_required must be a boolean when set.',
        `${basePath}.manual_review_required`,
      ),
    );
  }
}

function scanForSecrets(
  value: unknown,
  issues: CatalogIssue[],
  currentPath: string,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      scanForSecrets(item, issues, `${currentPath}[${index}]`),
    );
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = currentPath ? `${currentPath}.${key}` : key;
      if (SECRET_KEY_PATTERN.test(key)) {
        issues.push(
          issue(
            'error',
            'catalog_override_secret_field',
            `Catalog override field "${childPath}" looks like a secret. Provider API keys must stay in gateway.config.yaml env refs, not catalog.override.yaml.`,
            childPath,
          ),
        );
      }
      scanForSecrets(child, issues, childPath);
    }
    return;
  }
  if (typeof value === 'string' && SECRET_VALUE_PATTERN.test(value)) {
    issues.push(
      issue(
        'warning',
        'catalog_override_secret_value',
        'Catalog override contains a value that looks like a secret. Remove provider keys from catalog.override.yaml.',
        currentPath,
      ),
    );
  }
}

export function mergeCatalog(
  override: CatalogOverrideFile | null = null,
  overrideFile?: string,
): ProviderCatalog {
  const providers = BUILTIN_PROVIDER_CATALOG.map(cloneProvider);
  const byId = new Map(providers.map((provider) => [provider.id, provider]));

  for (const overrideProvider of normalizeOverrideProvidersForMerge(override)) {
    if (!overrideProvider.id) continue;
    const existing = byId.get(overrideProvider.id);
    if (existing) {
      mergeProvider(existing, overrideProvider);
    } else {
      const provider = providerFromOverride(overrideProvider);
      providers.push(provider);
      byId.set(provider.id, provider);
    }
  }

  providers.sort((a, b) => a.id.localeCompare(b.id));
  for (const provider of providers) {
    provider.models.sort((a, b) => a.id.localeCompare(b.id));
  }

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    providers,
    override_file: overrideFile || null,
  };
}

function normalizeOverrideProvidersForMerge(
  override: CatalogOverrideFile | null,
): CatalogOverrideProvider[] {
  if (!override?.providers) return [];
  if (Array.isArray(override.providers)) return override.providers;
  return Object.entries(override.providers).map(([id, provider]) => ({
    id,
    ...provider,
  }));
}

function mergeProvider(
  target: CatalogProvider,
  override: CatalogOverrideProvider,
): void {
  target.overridden = true;
  if (override.name !== undefined) target.name = override.name;
  if (override.base_url !== undefined) target.base_url = override.base_url;
  if (override.auth_type !== undefined) target.auth_type = override.auth_type;
  if (override.endpoints) target.endpoints = { ...target.endpoints, ...override.endpoints };
  if (override.model_prefixes) target.model_prefixes = [...override.model_prefixes];
  if (override.capabilities) target.capabilities = [...override.capabilities];
  if (override.pricing) target.pricing = { ...override.pricing };

  const modelsById = new Map(target.models.map((model) => [model.id, model]));
  for (const overrideModel of override.models || []) {
    const existing = modelsById.get(overrideModel.id);
    if (existing) {
      mergeModel(existing, target.id, overrideModel);
    } else {
      const model = modelFromOverride(target.id, overrideModel);
      target.models.push(model);
      modelsById.set(model.id, model);
    }
  }
}

function providerFromOverride(override: CatalogOverrideProvider): CatalogProvider {
  const id = override.id || 'custom';
  return {
    id,
    name: override.name || id,
    base_url: override.base_url || 'https://provider.example',
    auth_type: override.auth_type || 'bearer',
    endpoints: { ...(override.endpoints || {}) },
    model_prefixes: override.model_prefixes ? [...override.model_prefixes] : [],
    capabilities: override.capabilities ? [...override.capabilities] : [],
    pricing: override.pricing ? { ...override.pricing } : undefined,
    models: (override.models || []).map((model) => modelFromOverride(id, model)),
    source: 'override',
    overridden: true,
  };
}

function mergeModel(
  target: CatalogModel,
  providerId: string,
  override: CatalogOverrideModel,
): void {
  target.provider = providerId;
  target.overridden = true;
  if (override.display_name !== undefined) target.display_name = override.display_name;
  if (override.modalities) target.modalities = [...override.modalities];
  if (override.endpoints) target.endpoints = { ...target.endpoints, ...override.endpoints };
  if (override.capabilities) target.capabilities = [...override.capabilities];
  if (override.limits) target.limits = { ...override.limits };
  if (override.pricing) target.pricing = { ...override.pricing };
}

function modelFromOverride(
  providerId: string,
  override: CatalogOverrideModel,
): CatalogModel {
  return {
    id: override.id,
    provider: providerId,
    display_name: override.display_name,
    modalities: override.modalities ? [...override.modalities] : ['text'],
    endpoints: { ...(override.endpoints || {}) },
    capabilities: override.capabilities ? [...override.capabilities] : [],
    limits: override.limits ? { ...override.limits } : undefined,
    pricing: override.pricing ? { ...override.pricing } : undefined,
    source: 'override',
    overridden: true,
  };
}

export function flattenCatalogModels(catalog: ProviderCatalog): CatalogModel[] {
  return catalog.providers.flatMap((provider) => provider.models);
}

export function findCatalogModel(
  catalog: ProviderCatalog,
  modelId: string,
): CatalogModel | undefined {
  return flattenCatalogModels(catalog).find((model) => model.id === modelId);
}

export function formatCatalogAsYaml(catalog: ProviderCatalog): string {
  return yaml.dump(catalog, {
    noRefs: true,
    lineWidth: 100,
    sortKeys: false,
  });
}

@Injectable()
export class CatalogService {
  constructor(private readonly config: ConfigService) {}

  load(): CatalogLoadResult {
    return loadMergedCatalog({
      cwd: process.cwd(),
      env: process.env,
      config: this.config.getFullConfig(),
    });
  }

  providers(): CatalogProvider[] {
    return this.load().catalog.providers;
  }

  models(filters: { provider?: string; modality?: string } = {}): CatalogModel[] {
    let models = flattenCatalogModels(this.load().catalog);
    if (filters.provider) {
      models = models.filter((model) => model.provider === filters.provider);
    }
    if (filters.modality) {
      models = models.filter((model) =>
        (model.modalities as string[]).includes(filters.modality as string),
      );
    }
    return models;
  }
}
