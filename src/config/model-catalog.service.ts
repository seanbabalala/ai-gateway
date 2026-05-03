import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Subscription } from 'rxjs';
import { ConfigService } from './config.service';
import type { GatewayConfig, NodeConfig } from './gateway.config';
import {
  BUILT_IN_MODEL_CATALOG,
  ModelCatalogDocument,
  ModelCatalogEntry,
  ModelCatalogSource,
  catalogEntrySupportsPurpose,
  catalogKey,
  configuredModelIds,
  configuredModelPurposes,
  hasUserModelCapability,
  inferProviderFromNode,
  isPricingStale,
  lookupBuiltInCatalogEntry,
  normalizeCatalogEntry,
  userModelCapability,
} from './model-catalog';

export interface ModelCatalogDiagnostic {
  severity: 'warning' | 'info';
  code:
    | 'catalog_unknown_model'
    | 'catalog_pricing_stale'
    | 'catalog_missing_context'
    | 'catalog_capability_conflict'
    | 'catalog_remote_disabled'
    | 'catalog_remote_failed';
  message: string;
  node?: string;
  model?: string;
  provider?: string | null;
  path?: string;
}

export interface ModelCatalogStatus {
  enabled: boolean;
  source: {
    builtin_models: number;
    remote_models: number;
    remote_enabled: boolean;
    remote_url: string | null;
    last_refresh_at: string | null;
    last_refresh_error: string | null;
  };
  models: ModelCatalogEntry[];
  diagnostics: ModelCatalogDiagnostic[];
}

@Injectable()
export class ModelCatalogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModelCatalogService.name);
  private readonly builtinEntries = BUILT_IN_MODEL_CATALOG.map((entry) =>
    normalizeCatalogEntry(entry, 'builtin'),
  );
  private remoteEntries: ModelCatalogEntry[] = [];
  private lastRefreshAt: string | null = null;
  private lastRefreshError: string | null = null;
  private refreshTimer?: NodeJS.Timeout;
  private reloadSubscription?: Subscription;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.startRemoteRefresh();
    this.reloadSubscription = this.config.onReloadSuccess(() => this.startRemoteRefresh());
  }

  onModuleDestroy(): void {
    this.stopRemoteRefresh();
    this.reloadSubscription?.unsubscribe();
  }

  get enabled(): boolean {
    return this.config.modelCatalog.enabled !== false;
  }

  getEntries(): ModelCatalogEntry[] {
    if (!this.enabled) return [];
    const byKey = new Map<string, ModelCatalogEntry>();
    for (const entry of this.builtinEntries) {
      byKey.set(catalogKey(entry.provider, entry.model), entry);
    }
    for (const entry of this.remoteEntries) {
      byKey.set(catalogKey(entry.provider, entry.model), entry);
    }
    return Array.from(byKey.values()).sort((a, b) =>
      `${a.provider}:${a.model}`.localeCompare(`${b.provider}:${b.model}`),
    );
  }

  lookup(
    model: string,
    node?: Partial<NodeConfig> | null,
  ): ModelCatalogEntry | undefined {
    if (!this.enabled) return undefined;
    const provider = inferProviderFromNode(node);
    const candidates = this.getEntries().filter((entry) =>
      entry.model === model || entry.aliases?.includes(model),
    );
    if (provider) {
      return candidates.find((entry) => entry.provider === provider) || candidates[0];
    }
    return candidates[0];
  }

  getStatus(): ModelCatalogStatus {
    const remote = this.config.modelCatalog.remote;
    return {
      enabled: this.enabled,
      source: {
        builtin_models: this.builtinEntries.length,
        remote_models: this.remoteEntries.length,
        remote_enabled: Boolean(remote.enabled),
        remote_url: remote.url || null,
        last_refresh_at: this.lastRefreshAt,
        last_refresh_error: this.lastRefreshError,
      },
      models: this.getEntries(),
      diagnostics: this.getDiagnostics(this.config.getFullConfig()),
    };
  }

  getDiagnostics(config: GatewayConfig): ModelCatalogDiagnostic[] {
    if (!this.enabled) {
      return [{
        severity: 'info',
        code: 'catalog_remote_disabled',
        message: 'Model catalog fallback metadata is disabled.',
      }];
    }

    const diagnostics: ModelCatalogDiagnostic[] = [];
    const maxAgeDays = this.config.modelCatalog.pricing_max_age_days;
    for (const [nodeIndex, node] of config.nodes.entries()) {
      const provider = inferProviderFromNode(node);
      for (const model of configuredModelIds(node)) {
        const entry = this.lookup(model, node) || lookupBuiltInCatalogEntry(model, { provider });
        const modelPath = `nodes[${nodeIndex}].${this.modelListPath(node, model)}`;
        if (!entry) {
          if (!hasUserModelCapability(node, model)) {
            diagnostics.push({
              severity: 'warning',
              code: 'catalog_unknown_model',
              message: `Model "${model}" is not present in the local catalog. Add model_capabilities metadata if this is a private or proxy-only model.`,
              node: node.id,
              model,
              provider,
              path: modelPath,
            });
          }
          continue;
        }

        const userCapability = userModelCapability(node, model);
        for (const purpose of configuredModelPurposes(node, model)) {
          if (!catalogEntrySupportsPurpose(entry, purpose)) {
            diagnostics.push({
              severity: 'warning',
              code: 'catalog_capability_conflict',
              message: `Model "${model}" is listed for ${purpose} traffic, but the catalog entry does not advertise that endpoint/modality.`,
              node: node.id,
              model,
              provider: entry.provider,
              path: modelPath,
            });
          }
        }

        if (
          userCapability?.structured_output !== undefined &&
          entry.structured_output !== undefined &&
          userCapability.structured_output !== entry.structured_output
        ) {
          diagnostics.push({
            severity: 'warning',
            code: 'catalog_capability_conflict',
            message: `Model "${model}" structured_output=${userCapability.structured_output} conflicts with catalog structured_output=${entry.structured_output}. User config wins.`,
            node: node.id,
            model,
            provider: entry.provider,
            path: `${modelPath}.structured_output`,
          });
        }

        if (
          userCapability?.modalities &&
          entry.modalities.length > 0 &&
          !userCapability.modalities.some((modality) =>
            entry.modalities.includes(modality),
          )
        ) {
          diagnostics.push({
            severity: 'warning',
            code: 'catalog_capability_conflict',
            message: `Model "${model}" modalities do not overlap with the catalog entry. User config wins, but routing recommendations may be less reliable.`,
            node: node.id,
            model,
            provider: entry.provider,
            path: `${modelPath}.modalities`,
          });
        }

        const hasExplicitContext =
          userCapability?.max_context_tokens !== undefined ||
          node.max_context_tokens !== undefined;
        if (
          configuredModelPurposes(node, model).includes('chat') &&
          !hasExplicitContext &&
          entry.max_context_tokens === undefined
        ) {
          diagnostics.push({
            severity: 'warning',
            code: 'catalog_missing_context',
            message: `Model "${model}" has no configured or catalog context window. Context-aware routing will treat it as unknown.`,
            node: node.id,
            model,
            provider: entry.provider,
            path: modelPath,
          });
        }

        const hasExplicitPricing =
          Boolean(userCapability?.pricing) ||
          Object.prototype.hasOwnProperty.call(config.models_pricing || {}, model);
        if (!hasExplicitPricing && entry.pricing && isPricingStale(entry.last_updated_at, maxAgeDays)) {
          diagnostics.push({
            severity: 'warning',
            code: 'catalog_pricing_stale',
            message: `Catalog pricing for "${model}" is older than ${maxAgeDays} days. Pin pricing in gateway.config.yaml or refresh the catalog before relying on cost routing.`,
            node: node.id,
            model,
            provider: entry.provider,
            path: modelPath,
          });
        }
      }
    }

    if (this.lastRefreshError) {
      diagnostics.push({
        severity: 'warning',
        code: 'catalog_remote_failed',
        message: `Remote model catalog refresh failed: ${this.lastRefreshError}`,
      });
    }

    return diagnostics;
  }

  private modelListPath(node: NodeConfig, model: string): string {
    for (const key of [
      'models',
      'embedding_models',
      'rerank_models',
      'image_models',
      'audio_models',
      'realtime_models',
    ] as const) {
      const models = node[key];
      if (Array.isArray(models)) {
        const index = models.indexOf(model);
        if (index >= 0) return `${key}[${index}]`;
      }
    }
    return `model_capabilities.${model}`;
  }

  private startRemoteRefresh(): void {
    this.stopRemoteRefresh();
    const remote = this.config.modelCatalog.remote;
    if (!this.enabled || !remote.enabled) {
      this.remoteEntries = [];
      this.lastRefreshError = null;
      return;
    }
    if (!remote.url) {
      this.lastRefreshError = 'model_catalog.remote.url is required when remote.enabled is true.';
      this.logger.warn(this.lastRefreshError);
      return;
    }

    void this.refreshRemote();
    if (remote.refresh_interval_hours && remote.refresh_interval_hours > 0) {
      this.refreshTimer = setInterval(
        () => void this.refreshRemote(),
        remote.refresh_interval_hours * 3_600_000,
      );
      this.refreshTimer.unref?.();
    }
  }

  private stopRemoteRefresh(): void {
    if (!this.refreshTimer) return;
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  private async refreshRemote(): Promise<void> {
    const remote = this.config.modelCatalog.remote;
    if (!remote.enabled || !remote.url) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remote.timeout_ms);
    try {
      const response = await fetch(remote.url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const document = await response.json() as ModelCatalogDocument;
      this.remoteEntries = this.parseRemoteDocument(document);
      this.lastRefreshAt = new Date().toISOString();
      this.lastRefreshError = null;
      this.logger.log(`Remote model catalog refreshed (${this.remoteEntries.length} model(s))`);
    } catch (err) {
      this.lastRefreshError = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Remote model catalog refresh failed: ${this.lastRefreshError}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseRemoteDocument(document: ModelCatalogDocument): ModelCatalogEntry[] {
    if (!document || !Array.isArray(document.models)) {
      throw new Error('catalog document must contain a models array');
    }
    return document.models
      .filter((entry): entry is ModelCatalogEntry =>
        Boolean(entry?.provider && entry.model && Array.isArray(entry.modalities)),
      )
      .map((entry) => normalizeCatalogEntry(entry, 'remote' as ModelCatalogSource));
  }
}
