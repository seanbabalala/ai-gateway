import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ConfigService } from '../config/config.service';
import type { ModelPricing } from '../config/gateway.config';
import {
  VALID_CAPABILITY_ENDPOINTS,
  VALID_MODALITIES,
} from '../config/modality';
import { BUILTIN_PROVIDER_CATALOG } from './built-in-catalog';
import {
  LEGACY_PRICING_DIMENSIONS,
  PRICING_SOURCE_TYPES,
  UNIFIED_PRICING_DIMENSIONS,
  catalogModelToGovernedModelPricing,
  catalogPricingIsStale,
  getCatalogPricingValue,
  normalizeCatalogPricing,
} from './pricing-governance';
import type {
  CatalogIssue,
  CatalogLoadOptions,
  CatalogLoadResult,
  CatalogModel,
  CatalogOverrideFile,
  CatalogOverrideModel,
  CatalogOverrideProvider,
  CatalogPricing,
  CatalogPricingDimension,
  CatalogPricingHygiene,
  CatalogProvider,
  CatalogSource,
  ProviderCatalog,
} from './catalog.types';

export const DEFAULT_CATALOG_OVERRIDE_FILE = 'catalog.override.yaml';
export const DEFAULT_CATALOG_SYNC_CACHE_FILE = '.siftgate/catalog-sync-cache.yaml';

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
const SECRET_KEY_PATTERN = /(^|[_-])((api|provider)?[_-]?key|secret|password|authorization|bearer|access[_-]?token|refresh[_-]?token|auth[_-]?token|token)([_-]|$)/i;
const SECRET_VALUE_PATTERN = /\b(sk-[A-Za-z0-9._~+/-]{12,}|sk_[A-Za-z0-9._~+/-]{12,}|xox[A-Za-z0-9._~+/-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,})\b/i;
const PRICING_DIMENSIONS: CatalogPricingDimension[] = [
  ...LEGACY_PRICING_DIMENSIONS,
  ...UNIFIED_PRICING_DIMENSIONS,
];
const PRICING_CONFIDENCES = new Set(['high', 'medium', 'low', 'unknown']);
const PLACEHOLDER_SOURCE_PATTERN = /(placeholder|operator_required|manual[_-]?placeholder|unknown|replace)/i;
const DEFAULT_STALE_AFTER_DAYS = 90;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizeComparableUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
  } catch {
    return value.replace(/\/+$/, '');
  }
}

function cloneProvider(provider: CatalogProvider): CatalogProvider {
  return {
    ...provider,
    endpoints: { ...provider.endpoints },
    model_prefixes: provider.model_prefixes ? [...provider.model_prefixes] : undefined,
    capabilities: provider.capabilities ? [...provider.capabilities] : undefined,
    pricing: provider.pricing ? normalizeCatalogPricing({ ...provider.pricing }) : undefined,
    synced: provider.synced,
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
      pricing: model.pricing ? normalizeCatalogPricing({ ...model.pricing }) : undefined,
      synced: model.synced,
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

export function resolveCatalogSyncCachePath(
  options: CatalogLoadOptions = {},
): string {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const configPath = readConfigSyncCachePath(options.config);
  const requested =
    options.syncCachePath ||
    env.SIFTGATE_CATALOG_SYNC_CACHE ||
    configPath ||
    DEFAULT_CATALOG_SYNC_CACHE_FILE;
  return path.isAbsolute(requested) ? requested : path.resolve(cwd, requested);
}

function readConfigOverridePath(config: unknown): string | undefined {
  if (!isRecord(config)) return undefined;
  const catalog = config.catalog;
  if (!isRecord(catalog)) return undefined;
  return isNonEmptyString(catalog.override_file) ? catalog.override_file : undefined;
}

function readConfigSyncCachePath(config: unknown): string | undefined {
  if (!isRecord(config)) return undefined;
  const catalog = config.catalog;
  if (!isRecord(catalog)) return undefined;
  const sync = catalog.sync;
  if (!isRecord(sync)) return undefined;
  return isNonEmptyString(sync.cache_file) ? sync.cache_file : undefined;
}

export function loadMergedCatalog(
  options: CatalogLoadOptions = {},
): CatalogLoadResult {
  const overridePath = resolveCatalogOverridePath(options);
  const syncCachePath = resolveCatalogSyncCachePath(options);
  const issues: CatalogIssue[] = [];
  let override: CatalogOverrideFile | null = null;
  let overrideFound = false;
  let syncCache: CatalogOverrideFile | null = null;
  let syncCacheFound = false;

  if (fs.existsSync(syncCachePath)) {
    syncCacheFound = true;
    try {
      const raw = fs.readFileSync(syncCachePath, 'utf8');
      const parsed = yaml.load(raw);
      const validation = validateCatalogOverrideObject(parsed, syncCachePath);
      issues.push(...validation.issues);
      if (validation.override && !hasCatalogErrors(validation.issues)) {
        syncCache = validation.override;
      }
    } catch (error) {
      issues.push(
        issue(
          'warning',
          'catalog_sync_cache_read_failed',
          error instanceof Error
            ? `Could not read catalog sync cache: ${error.message}`
            : 'Could not read catalog sync cache.',
          syncCachePath,
        ),
      );
    }
  }

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

  const catalog = mergeCatalog(
    [
      { override: syncCache, source: 'sync_cache' },
      { override, source: 'override' },
    ],
    overridePath,
  );
  return {
    catalog,
    overridePath,
    overrideFound,
    syncCachePath,
    syncCacheFound,
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
      validateCatalogUrl(provider.base_url, `${basePath}.base_url`, issues, 'Catalog provider base_url');
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
  validateCacheFlags(provider, basePath, issues);
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
  validateCacheFlags(model, basePath, issues);
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

function validateCacheFlags(
  value: unknown,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (!isRecord(value)) return;
  for (const key of ['prompt_cache', 'read_cache', 'write_cache']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      issues.push(
        issue(
          'error',
          'catalog_cache_flag_invalid',
          `${key} must be a boolean when set.`,
          `${basePath}.${key}`,
        ),
      );
    }
  }
}

function validateCatalogUrl(
  value: string,
  issuePath: string,
  issues: CatalogIssue[],
  label = 'Catalog URL',
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
        `${label} must be an http(s) URL.`,
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
  for (const key of PRICING_DIMENSIONS) {
    if (
      pricing[key] !== undefined &&
      !isFiniteNonNegativeNumber(pricing[key])
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
  if (pricing.unit !== undefined && !isNonEmptyString(pricing.unit)) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_unit_missing',
        'pricing.unit should be a non-empty string when set.',
        `${basePath}.unit`,
      ),
    );
  }
  if (pricing.billing_unit !== undefined && !isNonEmptyString(pricing.billing_unit)) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_billing_unit_missing',
        'pricing.billing_unit should be a non-empty string when set.',
        `${basePath}.billing_unit`,
      ),
    );
  }
  if (pricing.units !== undefined) {
    if (!isRecord(pricing.units)) {
      issues.push(
        issue(
          'error',
          'catalog_pricing_units_invalid',
          'pricing.units must be an object keyed by supported pricing dimensions.',
          `${basePath}.units`,
        ),
      );
    } else {
      for (const [key, value] of Object.entries(pricing.units)) {
        if (!PRICING_DIMENSIONS.includes(key as CatalogPricingDimension)) {
          issues.push(
            issue(
              'warning',
              'catalog_pricing_unit_unknown',
              `pricing.units.${key} is not a known pricing dimension.`,
              `${basePath}.units.${key}`,
            ),
          );
        }
        if (!isNonEmptyString(value)) {
          issues.push(
            issue(
              'error',
              'catalog_pricing_units_invalid',
              'pricing.units values must be non-empty strings.',
              `${basePath}.units.${key}`,
            ),
          );
        }
      }
    }
  }
  if (pricing.currency !== undefined && !isNonEmptyString(pricing.currency)) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_currency_missing',
        'pricing.currency should be a non-empty currency code.',
        `${basePath}.currency`,
      ),
    );
  }
  if (
    pricing.source_type !== undefined &&
    (!isNonEmptyString(pricing.source_type) ||
      !PRICING_SOURCE_TYPES.includes(pricing.source_type as (typeof PRICING_SOURCE_TYPES)[number]))
  ) {
    issues.push(
      issue(
        'error',
        'catalog_pricing_source_type_invalid',
        'pricing.source_type must be official_docs, provider_api, aggregator_api, operator_override, docs_review, or unknown.',
        `${basePath}.source_type`,
      ),
    );
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
  if (pricing.source_url === undefined) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_source_url_missing',
        'pricing.source_url should point to the docs, API, or local review source for this price.',
        `${basePath}.source_url`,
      ),
    );
  } else {
    if (!isNonEmptyString(pricing.source_url)) {
      issues.push(
        issue(
          'warning',
          'catalog_pricing_source_url_missing',
          'pricing.source_url should be a non-empty URL when set.',
          `${basePath}.source_url`,
        ),
      );
    } else {
      validateCatalogUrl(pricing.source_url, `${basePath}.source_url`, issues, 'pricing.source_url');
    }
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
  } else if (Number.isNaN(Date.parse(pricing.last_updated))) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_last_updated_invalid',
        'pricing.last_updated should be an ISO date.',
        `${basePath}.last_updated`,
      ),
    );
  }
  if (
    pricing.retrieved_at !== undefined &&
    (!isNonEmptyString(pricing.retrieved_at) || Number.isNaN(Date.parse(pricing.retrieved_at)))
  ) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_retrieved_at_invalid',
        'pricing.retrieved_at should be an ISO date/time when set.',
        `${basePath}.retrieved_at`,
      ),
    );
  }
  if (
    pricing.last_verified_at !== undefined &&
    (!isNonEmptyString(pricing.last_verified_at) || Number.isNaN(Date.parse(pricing.last_verified_at)))
  ) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_last_verified_at_invalid',
        'pricing.last_verified_at should be an ISO date/time when set.',
        `${basePath}.last_verified_at`,
      ),
    );
  }
  if (
    pricing.last_sync !== undefined &&
    (!isNonEmptyString(pricing.last_sync) || Number.isNaN(Date.parse(pricing.last_sync)))
  ) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_last_sync_invalid',
        'pricing.last_sync should be an ISO date/time when set.',
        `${basePath}.last_sync`,
      ),
    );
  }
  if (pricing.manual_review_required === undefined) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_manual_review_missing',
        'pricing.manual_review_required should be set explicitly.',
        `${basePath}.manual_review_required`,
      ),
    );
  } else if (typeof pricing.manual_review_required !== 'boolean') {
    issues.push(
      issue(
        'error',
        'catalog_pricing_invalid',
        'pricing.manual_review_required must be a boolean when set.',
        `${basePath}.manual_review_required`,
      ),
    );
  }
  if (pricing.review_reason !== undefined && !isNonEmptyString(pricing.review_reason)) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_review_reason_missing',
        'pricing.review_reason should be a non-empty string when set.',
        `${basePath}.review_reason`,
      ),
    );
  }
  if (
    pricing.stale_after_days !== undefined &&
    (!isFiniteNonNegativeNumber(pricing.stale_after_days) || pricing.stale_after_days === 0)
  ) {
    issues.push(
      issue(
        'error',
        'catalog_pricing_stale_after_invalid',
        'pricing.stale_after_days must be a positive number when set.',
        `${basePath}.stale_after_days`,
      ),
    );
  }
  if (
    pricing.pricing_confidence !== undefined &&
    (!isNonEmptyString(pricing.pricing_confidence) ||
      !PRICING_CONFIDENCES.has(pricing.pricing_confidence))
  ) {
    issues.push(
      issue(
        'error',
        'catalog_pricing_confidence_invalid',
        'pricing.pricing_confidence must be high, medium, low, or unknown.',
        `${basePath}.pricing_confidence`,
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
  overrides:
    | CatalogOverrideFile
    | null
    | Array<{ override: CatalogOverrideFile | null; source: CatalogSource }> = null,
  overrideFile?: string,
): ProviderCatalog {
  const providers = BUILTIN_PROVIDER_CATALOG.map(cloneProvider);
  const byId = new Map(providers.map((provider) => [provider.id, provider]));

  const layers = Array.isArray(overrides)
    ? overrides
    : [{ override: overrides, source: 'override' as CatalogSource }];

  for (const layer of layers) {
    for (const overrideProvider of normalizeOverrideProvidersForMerge(layer.override)) {
      if (!overrideProvider.id) continue;
      const existing = byId.get(overrideProvider.id);
      if (existing) {
        mergeProvider(existing, overrideProvider, layer.source);
      } else {
        const provider = providerFromOverride(overrideProvider, layer.source);
        providers.push(provider);
        byId.set(provider.id, provider);
      }
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
  source: CatalogSource,
): void {
  if (source === 'override') {
    target.overridden = true;
  } else if (source === 'sync_cache') {
    target.synced = true;
  }
  if (override.name !== undefined) target.name = override.name;
  if (override.base_url !== undefined) target.base_url = override.base_url;
  if (override.auth_type !== undefined) target.auth_type = override.auth_type;
  if (override.endpoints) target.endpoints = { ...target.endpoints, ...override.endpoints };
  if (override.model_prefixes) target.model_prefixes = [...override.model_prefixes];
  if (override.capabilities) target.capabilities = [...override.capabilities];
  if (override.pricing) target.pricing = normalizeCatalogPricing({ ...override.pricing });
  if (override.prompt_cache !== undefined) target.prompt_cache = override.prompt_cache;
  if (override.read_cache !== undefined) target.read_cache = override.read_cache;
  if (override.write_cache !== undefined) target.write_cache = override.write_cache;

  const modelsById = new Map(target.models.map((model) => [model.id, model]));
  for (const overrideModel of override.models || []) {
    const existing = modelsById.get(overrideModel.id);
    if (existing) {
      mergeModel(existing, target.id, overrideModel, source);
    } else {
      const model = modelFromOverride(target.id, overrideModel, source);
      target.models.push(model);
      modelsById.set(model.id, model);
    }
  }
}

function providerFromOverride(
  override: CatalogOverrideProvider,
  source: CatalogSource,
): CatalogProvider {
  const id = override.id || 'custom';
  return {
    id,
    name: override.name || id,
    base_url: override.base_url || 'https://provider.example',
    auth_type: override.auth_type || 'bearer',
    endpoints: { ...(override.endpoints || {}) },
    model_prefixes: override.model_prefixes ? [...override.model_prefixes] : [],
    capabilities: override.capabilities ? [...override.capabilities] : [],
    pricing: override.pricing ? normalizeCatalogPricing({ ...override.pricing }) : undefined,
    prompt_cache: override.prompt_cache,
    read_cache: override.read_cache,
    write_cache: override.write_cache,
    models: (override.models || []).map((model) => modelFromOverride(id, model, source)),
    source,
    overridden: source === 'override',
    synced: source === 'sync_cache',
  };
}

function mergeModel(
  target: CatalogModel,
  providerId: string,
  override: CatalogOverrideModel,
  source: CatalogSource,
): void {
  target.provider = providerId;
  if (source === 'override') {
    target.overridden = true;
  } else if (source === 'sync_cache') {
    target.synced = true;
  }
  target.source = source;
  if (override.display_name !== undefined) target.display_name = override.display_name;
  if (override.modalities) target.modalities = [...override.modalities];
  if (override.endpoints) target.endpoints = { ...target.endpoints, ...override.endpoints };
  if (override.capabilities) target.capabilities = [...override.capabilities];
  if (override.limits) target.limits = { ...override.limits };
  if (override.pricing) target.pricing = normalizeCatalogPricing({ ...override.pricing });
  if (override.prompt_cache !== undefined) target.prompt_cache = override.prompt_cache;
  if (override.read_cache !== undefined) target.read_cache = override.read_cache;
  if (override.write_cache !== undefined) target.write_cache = override.write_cache;
}

function modelFromOverride(
  providerId: string,
  override: CatalogOverrideModel,
  source: CatalogSource,
): CatalogModel {
  return {
    id: override.id,
    provider: providerId,
    display_name: override.display_name,
    modalities: override.modalities ? [...override.modalities] : ['text'],
    endpoints: { ...(override.endpoints || {}) },
    capabilities: override.capabilities ? [...override.capabilities] : [],
    limits: override.limits ? { ...override.limits } : undefined,
    pricing: override.pricing ? normalizeCatalogPricing({ ...override.pricing }) : undefined,
    prompt_cache: override.prompt_cache,
    read_cache: override.read_cache,
    write_cache: override.write_cache,
    source,
    overridden: source === 'override',
    synced: source === 'sync_cache',
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

export function findCatalogModelForNode(
  catalog: ProviderCatalog,
  modelId: string,
  node?: { id?: string; base_url?: string },
): CatalogModel | undefined {
  const matches = flattenCatalogModels(catalog).filter((model) => model.id === modelId);
  if (matches.length === 0) return undefined;
  if (!node) return matches[0];

  const nodeId = typeof node.id === 'string' ? node.id : '';
  const baseUrl = typeof node.base_url === 'string'
    ? normalizeComparableUrl(node.base_url)
    : '';
  const providerById = nodeId
    ? catalog.providers.find((provider) => provider.id === nodeId)
    : undefined;
  const providerByUrl = baseUrl
    ? catalog.providers.find(
        (provider) => normalizeComparableUrl(provider.base_url) === baseUrl,
      )
    : undefined;
  const providerIds = new Set(
    [providerById?.id, providerByUrl?.id, nodeId].filter(isNonEmptyString),
  );
  return matches.find((model) => providerIds.has(model.provider)) || matches[0];
}

export function catalogModelToModelPricing(
  model: CatalogModel | undefined,
): (ModelPricing & {
  source?: string;
  currency?: string;
  catalog_source?: string;
  manual_review_required?: boolean;
  pricing_confidence?: string;
}) | undefined {
  return catalogModelToGovernedModelPricing(model);
}

export function assessCatalogPricing(
  pricing: CatalogPricing | undefined,
  modalities: readonly string[] = [],
  now: Date = new Date(),
): CatalogPricingHygiene {
  const normalizedPricing = normalizeCatalogPricing(pricing);
  if (!normalizedPricing) {
    return {
      status: 'missing',
      currency: null,
      source_type: null,
      source: null,
      source_url: null,
      manual_review_required: false,
      review_reason: null,
      pricing_confidence: null,
      last_updated: null,
      last_verified_at: null,
      retrieved_at: null,
      age_days: null,
      stale_after_days: null,
      stale: false,
      placeholder: false,
      review_required: false,
      source_missing: true,
      source_url_missing: true,
      missing_price_dimensions: requiredPricingDimensions(modalities),
      unit_mismatches: [],
      warnings: ['catalog_pricing_missing', 'catalog_pricing_source_missing', 'catalog_pricing_source_url_missing'],
    };
  }
  pricing = normalizedPricing;

  const required = requiredPricingDimensions(modalities);
  const missing = required.filter((dimension) => !hasPricingDimension(pricing, dimension));
  const unitMismatches = required.filter((dimension) => !hasCompatibleUnit(pricing, dimension));
  const lastUpdated = isNonEmptyString(pricing.last_updated) ? pricing.last_updated : null;
  const lastVerifiedAt = isNonEmptyString(pricing.last_verified_at) ? pricing.last_verified_at : null;
  const retrievedAt = isNonEmptyString(pricing.retrieved_at) ? pricing.retrieved_at : null;
  const freshnessBasis = lastVerifiedAt || retrievedAt || lastUpdated;
  const parsedFreshnessBasis = freshnessBasis ? Date.parse(freshnessBasis) : Number.NaN;
  const ageDays = Number.isNaN(parsedFreshnessBasis)
    ? null
    : Math.max(0, Math.floor((now.getTime() - parsedFreshnessBasis) / 86_400_000));
  const staleAfterDays = pricing.stale_after_days ?? DEFAULT_STALE_AFTER_DAYS;
  const stale = catalogPricingIsStale(pricing, now, DEFAULT_STALE_AFTER_DAYS);
  const sourceMissing = !isNonEmptyString(pricing.source);
  const sourceUrlMissing = !isNonEmptyString(pricing.source_url);
  const reviewRequired =
    pricing.manual_review_required === true ||
    pricing.pricing_confidence === 'low' ||
    pricing.pricing_confidence === 'unknown' ||
    PLACEHOLDER_SOURCE_PATTERN.test(pricing.source || '');
  const placeholder = reviewRequired;
  const warnings = [
    ...missing.map((dimension) => `catalog_pricing_missing:${dimension}`),
    ...unitMismatches.map((dimension) => `catalog_pricing_unit_mismatch:${dimension}`),
    ...(stale ? ['catalog_pricing_stale'] : []),
    ...(reviewRequired ? ['catalog_pricing_review_required'] : []),
    ...(sourceMissing ? ['catalog_pricing_source_missing'] : []),
    ...(sourceUrlMissing ? ['catalog_pricing_source_url_missing'] : []),
  ];

  return {
    status: missing.length > 0
      ? 'missing'
      : stale
        ? 'stale'
        : reviewRequired
          ? 'placeholder'
          : 'fresh',
    currency: pricing.currency || null,
    source_type: pricing.source_type || null,
    source: pricing.source || null,
    source_url: pricing.source_url || null,
    manual_review_required: pricing.manual_review_required === true,
    review_reason: pricing.review_reason || null,
    pricing_confidence: pricing.pricing_confidence || null,
    last_updated: lastUpdated,
    last_verified_at: lastVerifiedAt,
    retrieved_at: retrievedAt,
    age_days: ageDays,
    stale_after_days: staleAfterDays,
    stale,
    placeholder,
    review_required: reviewRequired,
    source_missing: sourceMissing,
    source_url_missing: sourceUrlMissing,
    missing_price_dimensions: missing,
    unit_mismatches: unitMismatches,
    warnings,
  };
}

export function collectCatalogPricingHygieneIssues(
  catalog: ProviderCatalog,
  now: Date = new Date(),
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  for (const provider of catalog.providers) {
    for (const model of provider.models) {
      const hygiene = assessCatalogPricing(model.pricing, model.modalities, now);
      const modelPath = `providers.${provider.id}.models.${model.id}.pricing`;
      for (const dimension of hygiene.missing_price_dimensions) {
        issues.push(
          issue(
            'warning',
            'catalog_pricing_missing',
            `Catalog model "${model.id}" is missing ${dimension} pricing metadata.`,
            modelPath,
          ),
        );
      }
      for (const dimension of hygiene.unit_mismatches) {
        issues.push(
          issue(
            'warning',
            'catalog_pricing_unit_mismatch',
            `Catalog model "${model.id}" has pricing units that do not describe ${dimension} workloads.`,
            modelPath,
          ),
        );
      }
      if (hygiene.stale) {
        issues.push(
          issue(
            'warning',
            'catalog_pricing_stale',
            `Catalog pricing for "${model.id}" is ${hygiene.age_days} day(s) old; review provider pricing before cost routing.`,
            modelPath,
          ),
        );
      }
      if (hygiene.review_required || hygiene.placeholder) {
        issues.push(
          issue(
            'info',
            'catalog_pricing_review_required',
            `Catalog pricing for "${model.id}" needs operator review before production cost routing.`,
            modelPath,
          ),
        );
      }
      if (hygiene.source_missing) {
        issues.push(
          issue(
            'warning',
            'catalog_pricing_source_missing',
            `Catalog pricing for "${model.id}" is missing a price source label.`,
            modelPath,
          ),
        );
      }
      if (hygiene.source_url_missing) {
        issues.push(
          issue(
            'warning',
            'catalog_pricing_source_url_missing',
            `Catalog pricing for "${model.id}" is missing a reviewable source URL.`,
            modelPath,
          ),
        );
      }
    }
  }
  return issues;
}

function requiredPricingDimensions(modalities: readonly string[]): CatalogPricingDimension[] {
  const normalized = new Set(modalities.map((modality) => modality.toLowerCase()));
  const required = new Set<CatalogPricingDimension>();
  if (
    normalized.size === 0 ||
    normalized.has('text') ||
    normalized.has('vision') ||
    normalized.has('realtime')
  ) {
    required.add('input');
    required.add('output');
  }
  if (normalized.has('image')) required.add('image');
  if (normalized.has('audio')) required.add('audio');
  if (normalized.has('video')) required.add('video');
  if (normalized.has('rerank')) required.add('rerank');
  if (normalized.has('embedding')) required.add('embedding');
  return [...required];
}

function hasPricingDimension(
  pricing: CatalogPricing,
  dimension: CatalogPricingDimension,
): boolean {
  if (isFiniteNonNegativeNumber(getCatalogPricingValue(pricing, dimension))) return true;
  if (dimension === 'embedding' && isFiniteNonNegativeNumber(pricing.input)) return true;
  if (dimension === 'rerank' && isFiniteNonNegativeNumber(pricing.input)) return true;
  if (dimension === 'audio' && isFiniteNonNegativeNumber(pricing.input)) return true;
  if (dimension === 'image' && isFiniteNonNegativeNumber(pricing.input)) return true;
  if (dimension === 'video' && isFiniteNonNegativeNumber(pricing.input)) return true;
  return false;
}

function hasCompatibleUnit(
  pricing: CatalogPricing,
  dimension: CatalogPricingDimension,
): boolean {
  const unit = (pricing.units?.[dimension] || pricing.billing_unit || pricing.unit || '').toLowerCase();
  if (!unit) return false;
  if (
    dimension === 'input' ||
    dimension === 'output' ||
    dimension === 'embedding' ||
    dimension === 'input_per_1m_tokens' ||
    dimension === 'output_per_1m_tokens' ||
    dimension === 'embedding_per_1m_tokens'
  ) {
    return unit.includes('token') || unit.includes('embedding');
  }
  if (dimension === 'image' || dimension === 'image_per_generation' || dimension === 'image_per_edit') return unit.includes('image');
  if (dimension === 'audio' || dimension === 'audio_per_minute' || dimension === 'audio_per_1m_chars') return unit.includes('audio') || unit.includes('minute') || unit.includes('char') || unit.includes('second');
  if (dimension === 'video' || dimension === 'video_per_second' || dimension === 'video_per_generation') return unit.includes('video') || unit.includes('minute') || unit.includes('second') || unit.includes('generation');
  if (dimension === 'rerank' || dimension === 'rerank_per_1k_requests' || dimension === 'rerank_per_1k_docs') return unit.includes('rerank') || unit.includes('request') || unit.includes('doc');
  if (
    dimension === 'cache_read_input' ||
    dimension === 'cache_creation_input' ||
    dimension === 'cache_read_per_1m_tokens' ||
    dimension === 'cache_write_per_1m_tokens'
  ) {
    return unit.includes('token') || unit.includes('cache');
  }
  if (dimension === 'realtime_per_minute') return unit.includes('realtime') || unit.includes('minute');
  if (dimension === 'batch_discount') return unit.includes('discount') || unit.includes('percent') || unit.includes('batch');
  return true;
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
