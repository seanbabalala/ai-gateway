import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { ConfigService } from '../config/config.service';
import type { CatalogConfig } from '../config/gateway.config';
import {
  getCatalogRefreshSources,
  refreshCatalogProvider,
} from './catalog-refresh';
import {
  resolveCatalogOverridePath,
  resolveCatalogSyncCachePath,
  loadMergedCatalog,
  validateCatalogOverrideObject,
} from './catalog.service';
import type {
  CatalogIssue,
  CatalogOverrideFile,
  CatalogOverrideProvider,
  CatalogPricing,
  CatalogProvider,
  ProviderCatalog,
} from './catalog.types';

export type CatalogSyncWriteTarget = 'cache' | 'override';
export type CatalogSyncProviderStatus =
  | 'disabled'
  | 'fresh'
  | 'stale'
  | 'never_synced'
  | 'manual_only'
  | 'unsupported'
  | 'failed'
  | 'synced';

export interface CatalogSyncStatusProvider {
  provider: string;
  label: string;
  enabled: boolean;
  supported: boolean;
  automatic: boolean;
  status: CatalogSyncProviderStatus;
  last_sync: string | null;
  source_url: string;
  confidence: string | null;
  stale: boolean;
  stale_after_days: number | null;
  age_days: number | null;
  last_error: string | null;
}

export interface CatalogSyncStatus {
  enabled: boolean;
  scheduled: boolean;
  write_to: CatalogSyncWriteTarget;
  interval_minutes: number;
  run_on_startup: boolean;
  cache_file: string;
  cache_found: boolean;
  override_file: string;
  override_found: boolean;
  supported_adapters: string[];
  enabled_adapters: string[];
  providers: CatalogSyncStatusProvider[];
  issues: CatalogIssue[];
}

export interface CatalogSyncRunResult {
  provider: string;
  status: 'synced' | 'failed' | 'unsupported';
  generated_at: string;
  write_to: CatalogSyncWriteTarget;
  output: string;
  written: boolean;
  model_count: number;
  priced_model_count: number;
  source_url: string;
  confidence: string | null;
  issues: CatalogIssue[];
}

export interface CatalogSyncOptions {
  provider: string;
  now?: Date;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  config?: unknown;
  writeTo?: CatalogSyncWriteTarget;
  cachePath?: string;
  overridePath?: string;
  outputPath?: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
}

const SUPPORTED_SYNC_ADAPTERS = new Set(['openrouter']);
const DEFAULT_SYNC_INTERVAL_MINUTES = 1440;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasErrors(issues: CatalogIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

function issue(
  severity: CatalogIssue['severity'],
  code: string,
  message: string,
  issuePath?: string,
): CatalogIssue {
  return { severity, code, message, path: issuePath };
}

export function supportedCatalogSyncAdapters(): string[] {
  return [...SUPPORTED_SYNC_ADAPTERS].sort();
}

export function catalogSyncConfig(config: CatalogConfig | undefined): Required<Pick<
  NonNullable<CatalogConfig['sync']>,
  'enabled' | 'interval_minutes' | 'run_on_startup' | 'write_to'
>> & {
  cache_file?: string;
  override_file?: string;
  adapters: Record<string, { enabled?: boolean }>;
} {
  const sync = config?.sync || {};
  return {
    enabled: sync.enabled === true,
    interval_minutes:
      typeof sync.interval_minutes === 'number' && Number.isFinite(sync.interval_minutes) && sync.interval_minutes > 0
        ? sync.interval_minutes
        : DEFAULT_SYNC_INTERVAL_MINUTES,
    run_on_startup: sync.run_on_startup === true,
    write_to: sync.write_to === 'override' ? 'override' : 'cache',
    cache_file: sync.cache_file,
    override_file: sync.override_file,
    adapters: isRecord(sync.adapters) ? sync.adapters : {},
  };
}

export function enabledCatalogSyncAdapters(config: CatalogConfig | undefined): string[] {
  const sync = catalogSyncConfig(config);
  if (!sync.enabled) return [];
  return Object.entries(sync.adapters)
    .filter(([, adapter]) => isRecord(adapter) && adapter.enabled === true)
    .map(([provider]) => provider.trim().toLowerCase())
    .filter((provider) => SUPPORTED_SYNC_ADAPTERS.has(provider))
    .sort();
}

export async function syncCatalogProvider(
  options: CatalogSyncOptions,
): Promise<CatalogSyncRunResult> {
  const provider = options.provider.trim().toLowerCase();
  const now = options.now || new Date();
  const source = getCatalogRefreshSources().find((entry) => entry.provider === provider);
  const writeTo = options.writeTo || (options.outputPath ? 'override' : 'cache');
  const output =
    writeTo === 'cache'
      ? options.outputPath ||
        options.cachePath ||
        resolveCatalogSyncCachePath({
          cwd: options.cwd,
          env: options.env,
          config: options.config,
        })
      : options.outputPath ||
        options.overridePath ||
        resolveCatalogOverridePath({
          cwd: options.cwd,
          env: options.env,
          config: options.config,
        });

  if (!SUPPORTED_SYNC_ADAPTERS.has(provider)) {
    return {
      provider,
      status: 'unsupported',
      generated_at: now.toISOString(),
      write_to: writeTo,
      output,
      written: false,
      model_count: 0,
      priced_model_count: 0,
      source_url: source?.source_url || '',
      confidence: null,
      issues: [
        issue(
          'error',
          'catalog_sync_unsupported_provider',
          'Automatic model pricing sync currently supports OpenRouter only. Other providers remain docs_review/manual override.',
          provider,
        ),
      ],
    };
  }

  let refreshResult;
  try {
    refreshResult = await refreshCatalogProvider({
      provider,
      now,
      fetchImpl: options.fetchImpl || globalThis.fetch,
    });
  } catch (error) {
    return {
      provider,
      status: 'failed',
      generated_at: now.toISOString(),
      write_to: writeTo,
      output,
      written: false,
      model_count: 0,
      priced_model_count: 0,
      source_url: source?.source_url || '',
      confidence: null,
      issues: [
        issue(
          'error',
          'catalog_sync_failed',
          error instanceof Error ? error.message : 'Catalog sync failed.',
          provider,
        ),
      ],
    };
  }

  if (hasErrors(refreshResult.issues)) {
    const syncedProvider = normalizeProvidersRecord(refreshResult.override)[provider];
    return {
      provider,
      status: 'failed',
      generated_at: refreshResult.generated_at,
      write_to: writeTo,
      output,
      written: false,
      model_count: refreshResult.model_count,
      priced_model_count: refreshResult.priced_model_count,
      source_url: refreshResult.source.source_url,
      confidence: providerConfidence(syncedProvider),
      issues: refreshResult.issues,
    };
  }

  const syncedProvider = normalizeProvidersRecord(refreshResult.override)[provider];
  const nextOverride =
    writeTo === 'cache'
      ? mergeProviderIntoExistingOverride(output, provider, refreshResult.override)
      : refreshResult.override;

  if (writeTo === 'override' && fs.existsSync(output) && !options.force) {
    return {
      provider,
      status: 'failed',
      generated_at: refreshResult.generated_at,
      write_to: writeTo,
      output,
      written: false,
      model_count: refreshResult.model_count,
      priced_model_count: refreshResult.priced_model_count,
      source_url: refreshResult.source.source_url,
      confidence: providerConfidence(syncedProvider),
      issues: [
        issue(
          'error',
          'catalog_sync_override_exists',
          `Catalog override already exists: ${output}. Use --force to replace it, or sync to the local cache instead.`,
          output,
        ),
      ],
    };
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, formatCatalogOverride(nextOverride), 'utf8');

  return {
    provider,
    status: 'synced',
    generated_at: refreshResult.generated_at,
    write_to: writeTo,
    output,
    written: true,
    model_count: refreshResult.model_count,
    priced_model_count: refreshResult.priced_model_count,
    source_url: refreshResult.source.source_url,
    confidence: providerConfidence(syncedProvider),
    issues: refreshResult.issues,
  };
}

export function buildCatalogSyncStatus(input: {
  config?: CatalogConfig;
  catalog: ProviderCatalog;
  now?: Date;
  cachePath: string;
  cacheFound: boolean;
  overridePath: string;
  overrideFound: boolean;
  issues?: CatalogIssue[];
  lastRuns?: Map<string, CatalogSyncRunResult>;
}): CatalogSyncStatus {
  const now = input.now || new Date();
  const sync = catalogSyncConfig(input.config);
  const enabledAdapters = enabledCatalogSyncAdapters(input.config);
  const sources = getCatalogRefreshSources();
  const sourceByProvider = new Map(sources.map((source) => [source.provider, source]));
  const issues = [...(input.issues || [])];
  const configuredAdapters = Object.keys(sync.adapters).map((provider) => provider.toLowerCase());
  for (const provider of configuredAdapters) {
    if (!sourceByProvider.has(provider)) {
      issues.push(
        issue(
          'warning',
          'catalog_sync_unknown_adapter',
          `Catalog sync adapter "${provider}" is not a known provider source.`,
          `catalog.sync.adapters.${provider}`,
        ),
      );
    } else if (!SUPPORTED_SYNC_ADAPTERS.has(provider) && sync.adapters[provider]?.enabled === true) {
      issues.push(
        issue(
          'warning',
          'catalog_sync_adapter_manual_only',
          `Catalog sync adapter "${provider}" is not automatic yet; use docs review or local override.`,
          `catalog.sync.adapters.${provider}`,
        ),
      );
    }
  }
  if (sync.enabled && enabledAdapters.length === 0) {
    issues.push(
      issue(
        'warning',
        'catalog_sync_no_enabled_adapter',
        'catalog.sync.enabled is true but no supported provider adapter is explicitly enabled.',
        'catalog.sync.adapters',
      ),
    );
  }

  return {
    enabled: sync.enabled,
    scheduled: sync.enabled && enabledAdapters.length > 0,
    write_to: sync.write_to,
    interval_minutes: sync.interval_minutes,
    run_on_startup: sync.run_on_startup,
    cache_file: input.cachePath,
    cache_found: input.cacheFound,
    override_file: input.overridePath,
    override_found: input.overrideFound,
    supported_adapters: supportedCatalogSyncAdapters(),
    enabled_adapters: enabledAdapters,
    providers: sources.map((source) => {
      const provider = input.catalog.providers.find((entry) => entry.id === source.provider);
      const pricing = statusPricing(provider);
      const lastSync = pricingLastSync(pricing);
      const staleAfterDays = pricing?.stale_after_days ?? (source.automatic ? 7 : null);
      const ageDays = lastSync ? Math.max(0, Math.floor((now.getTime() - Date.parse(lastSync)) / 86_400_000)) : null;
      const stale = ageDays !== null && staleAfterDays !== null && ageDays > staleAfterDays;
      const enabled = enabledAdapters.includes(source.provider);
      const lastRun = input.lastRuns?.get(source.provider);
      const supported = SUPPORTED_SYNC_ADAPTERS.has(source.provider) && source.automatic;
      const status: CatalogSyncProviderStatus = lastRun?.status === 'failed'
        ? 'failed'
        : enabled
          ? lastSync
            ? stale
              ? 'stale'
              : 'fresh'
            : 'never_synced'
          : supported
            ? 'disabled'
            : source.automatic
              ? 'unsupported'
              : 'manual_only';
      return {
        provider: source.provider,
        label: source.label,
        enabled,
        supported,
        automatic: source.automatic,
        status,
        last_sync: lastSync,
        source_url: pricing?.source_url || source.source_url,
        confidence: pricing?.pricing_confidence || null,
        stale,
        stale_after_days: staleAfterDays,
        age_days: ageDays,
        last_error: lastRun?.status === 'failed'
          ? lastRun.issues.find((entry) => entry.severity === 'error')?.message || null
          : null,
      };
    }),
    issues,
  };
}

function mergeProviderIntoExistingOverride(
  outputPath: string,
  provider: string,
  incoming: CatalogOverrideFile,
): CatalogOverrideFile {
  const existing = readExistingOverride(outputPath);
  const providers = normalizeProvidersRecord(existing);
  const incomingProviders = normalizeProvidersRecord(incoming);
  const incomingProvider = incomingProviders[provider];
  if (incomingProvider) providers[provider] = incomingProvider;
  return { version: 1, providers };
}

function readExistingOverride(outputPath: string): CatalogOverrideFile {
  if (!fs.existsSync(outputPath)) return { version: 1, providers: {} };
  const parsed = yaml.load(fs.readFileSync(outputPath, 'utf8'));
  const validation = validateCatalogOverrideObject(parsed, outputPath);
  if (hasErrors(validation.issues) || !validation.override) {
    return { version: 1, providers: {} };
  }
  return validation.override;
}

function normalizeProvidersRecord(
  override: CatalogOverrideFile | null | undefined,
): Record<string, CatalogOverrideProvider> {
  if (!override?.providers) return {};
  if (Array.isArray(override.providers)) {
    return Object.fromEntries(
      override.providers
        .filter((provider) => provider.id)
        .map((provider) => [provider.id as string, provider]),
    );
  }
  return { ...override.providers };
}

function formatCatalogOverride(override: CatalogOverrideFile): string {
  return yaml.dump(override, {
    noRefs: true,
    lineWidth: 100,
    sortKeys: false,
  });
}

function providerConfidence(provider: CatalogOverrideProvider | undefined): string | null {
  return provider?.pricing?.pricing_confidence ||
    provider?.models?.find((model) => model.pricing?.pricing_confidence)?.pricing?.pricing_confidence ||
    null;
}

function statusPricing(provider: CatalogProvider | undefined): CatalogPricing | undefined {
  if (!provider) return undefined;
  if (pricingLastSync(provider.pricing)) return provider.pricing;
  return provider.models.find((model) => pricingLastSync(model.pricing))?.pricing ||
    provider.pricing ||
    provider.models.find((model) => model.pricing)?.pricing;
}

function pricingLastSync(pricing: CatalogPricing | undefined): string | null {
  return pricing?.last_sync || pricing?.retrieved_at || null;
}

@Injectable()
export class CatalogSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CatalogSyncService.name);
  private timer?: NodeJS.Timeout;
  private reloadSub?: Subscription;
  private readonly lastRuns = new Map<string, CatalogSyncRunResult>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.configureSchedule();
    this.reloadSub = this.config.onReload((result) => {
      if (result.success) this.configureSchedule();
    });
  }

  onModuleDestroy(): void {
    this.stopSchedule();
    this.reloadSub?.unsubscribe();
  }

  getStatus(): CatalogSyncStatus {
    const fullConfig = this.config.getFullConfig();
    const loaded = loadMergedCatalog({
      cwd: process.cwd(),
      env: process.env,
      config: fullConfig,
    });
    return buildCatalogSyncStatus({
      config: fullConfig.catalog,
      catalog: loaded.catalog,
      cachePath: loaded.syncCachePath,
      cacheFound: loaded.syncCacheFound,
      overridePath: loaded.overridePath,
      overrideFound: loaded.overrideFound,
      issues: loaded.issues,
      lastRuns: this.lastRuns,
    });
  }

  async syncEnabledProviders(): Promise<CatalogSyncRunResult[]> {
    const fullConfig = this.config.getFullConfig();
    const providers = enabledCatalogSyncAdapters(fullConfig.catalog);
    const sync = catalogSyncConfig(fullConfig.catalog);
    const results: CatalogSyncRunResult[] = [];
    for (const provider of providers) {
      const result = await syncCatalogProvider({
        provider,
        config: fullConfig,
        cwd: process.cwd(),
        env: process.env,
        writeTo: sync.write_to,
        cachePath: sync.cache_file,
        overridePath: sync.override_file || fullConfig.catalog?.override_file,
      });
      this.lastRuns.set(provider, result);
      results.push(result);
      if (result.status === 'synced') {
        this.logger.log(`Catalog pricing sync completed for ${provider}: ${result.model_count} model(s)`);
      } else {
        this.logger.warn(`Catalog pricing sync failed for ${provider}: ${result.issues.map((entry) => entry.message).join('; ')}`);
      }
    }
    return results;
  }

  private configureSchedule(): void {
    this.stopSchedule();
    const fullConfig = this.config.getFullConfig();
    const sync = catalogSyncConfig(fullConfig.catalog);
    const providers = enabledCatalogSyncAdapters(fullConfig.catalog);
    if (!sync.enabled || providers.length === 0) return;

    const intervalMs = Math.max(60_000, sync.interval_minutes * 60_000);
    this.timer = setInterval(() => {
      void this.syncEnabledProviders();
    }, intervalMs);
    this.timer.unref?.();
    if (sync.run_on_startup) {
      void this.syncEnabledProviders();
    }
  }

  private stopSchedule(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
