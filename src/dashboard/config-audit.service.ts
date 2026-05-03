import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import * as yaml from 'js-yaml';
import { Repository } from 'typeorm';
import { ConfigService } from '../config/config.service';
import {
  ConfigAuditEvent,
  ConfigVersion,
} from '../database/entities';

export interface ConfigAuditActor {
  type?: string;
  id?: string;
}

export interface TrackConfigChangeInput {
  action: string;
  target_type?: string;
  target_id?: string;
  source?: string;
  actor?: ConfigAuditActor;
  reason?: string;
  metadata?: Record<string, unknown>;
  message?: string;
}

export interface RollbackConfigResult {
  success: boolean;
  message: string;
  target_version: Record<string, unknown>;
  previous_version: Record<string, unknown> | null;
  restored_version: Record<string, unknown> | null;
  reload: unknown;
}

@Injectable()
export class ConfigAuditService implements OnModuleInit {
  private readonly logger = new Logger(ConfigAuditService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(ConfigVersion)
    private readonly versionRepo: Repository<ConfigVersion>,
    @InjectRepository(ConfigAuditEvent)
    private readonly eventRepo: Repository<ConfigAuditEvent>,
  ) {}

  async onModuleInit(): Promise<void> {
    const audit = this.config.configAudit;
    if (!audit.enabled || !audit.capture_startup_snapshot) return;

    try {
      const version = await this.recordVersion({
        action: 'config.startup',
        actor: { type: 'system', id: 'gateway' },
        reason: 'startup baseline',
      });
      await this.recordEvent({
        action: 'config.startup',
        target_type: 'config',
        target_id: this.config.getConfigPath(),
        success: true,
        actor_type: 'system',
        actor_id: 'gateway',
        source: 'startup',
        version_id: version?.id ?? null,
        message: 'Captured startup config snapshot',
      });
    } catch (error) {
      this.logger.warn(
        `Could not capture startup config snapshot: ${(error as Error).message}`,
      );
    }
  }

  async trackChange<T>(
    input: TrackConfigChangeInput,
    mutation: () => T | Promise<T>,
  ): Promise<T> {
    if (!this.config.configAudit.enabled) {
      return mutation();
    }

    let previous: ConfigVersion | null = null;
    try {
      previous = await this.recordVersion({
        action: `${input.action}.before`,
        actor: input.actor,
        reason: input.reason,
        metadata: input.metadata,
      });
    } catch (error) {
      this.logger.warn(
        `Could not capture pre-change config version: ${(error as Error).message}`,
      );
    }

    try {
      const result = await mutation();
      try {
        const current = await this.recordVersion({
          action: input.action,
          actor: input.actor,
          reason: input.reason,
          metadata: input.metadata,
        });
        await this.recordEvent({
          action: input.action,
          target_type: input.target_type ?? 'config',
          target_id: input.target_id ?? this.config.getConfigPath(),
          success: true,
          actor_type: input.actor?.type ?? 'dashboard',
          actor_id: input.actor?.id ?? 'dashboard',
          source: input.source ?? 'dashboard',
          version_id: current?.id ?? null,
          previous_version_id: previous?.id ?? null,
          message: input.message ?? 'Config change applied',
          metadata_json: this.safeStringify({
            ...(input.metadata ?? {}),
            previous_checksum: previous?.checksum,
            current_checksum: current?.checksum,
          }),
        });
      } catch (error) {
        this.logger.warn(
          `Config change applied but audit capture failed: ${(error as Error).message}`,
        );
      }
      return result;
    } catch (error) {
      try {
        await this.recordEvent({
          action: input.action,
          target_type: input.target_type ?? 'config',
          target_id: input.target_id ?? this.config.getConfigPath(),
          success: false,
          actor_type: input.actor?.type ?? 'dashboard',
          actor_id: input.actor?.id ?? 'dashboard',
          source: input.source ?? 'dashboard',
          previous_version_id: previous?.id ?? null,
          message: 'Config change failed',
          error: (error as Error).message,
          metadata_json: this.safeStringify(input.metadata ?? {}),
        });
      } catch (auditError) {
        this.logger.warn(
          `Config change failed and audit capture also failed: ${(auditError as Error).message}`,
        );
      }
      throw error;
    }
  }

  async recordReload(
    result: {
      success: boolean;
      source: string;
      message: string;
      error?: { message?: string };
    },
    actor: ConfigAuditActor = { type: 'dashboard', id: 'dashboard' },
  ): Promise<ConfigVersion | null> {
    if (!this.config.configAudit.enabled) return null;
    let version: ConfigVersion | null = null;
    if (result.success) {
      try {
        version = await this.recordVersion({
          action: `config.reload.${result.source}`,
          actor,
          reason: result.message,
        });
      } catch (error) {
        this.logger.warn(
          `Config reload completed but version capture failed: ${(error as Error).message}`,
        );
      }
    }

    try {
      await this.recordEvent({
        action: `config.reload.${result.source}`,
        target_type: 'config',
        target_id: this.config.getConfigPath(),
        success: result.success,
        actor_type: actor.type ?? 'dashboard',
        actor_id: actor.id ?? 'dashboard',
        source: result.source,
        version_id: version?.id ?? null,
        message: result.message,
        error: result.error?.message ?? null,
      });
    } catch (error) {
      this.logger.warn(
        `Config reload completed but audit event failed: ${(error as Error).message}`,
      );
    }
    return version;
  }

  async rollbackToVersion(
    id: number,
    input: {
      reason?: string;
      actor?: ConfigAuditActor;
      source?: string;
    } = {},
  ): Promise<RollbackConfigResult> {
    const target = await this.versionRepo.findOne({ where: { id } });
    if (!target) {
      throw new Error(`Config version ${id} not found`);
    }

    const previous = await this.recordVersion({
      action: 'config.rollback.before',
      actor: input.actor,
      reason: input.reason,
      metadata: { target_version_id: target.id },
    });

    const reload = this.config.restoreFromYaml(target.snapshot_yaml, {
      source: 'rollback',
      throwOnError: false,
    });

    if (!reload.success) {
      await this.recordEvent({
        action: 'config.rollback',
        target_type: 'config_version',
        target_id: String(target.id),
        success: false,
        actor_type: input.actor?.type ?? 'dashboard',
        actor_id: input.actor?.id ?? 'dashboard',
        source: input.source ?? 'dashboard',
        previous_version_id: previous?.id ?? null,
        message: reload.message,
        error: reload.error?.message ?? null,
        metadata_json: this.safeStringify({
          target_version_id: target.id,
          target_checksum: target.checksum,
        }),
      });
      return {
        success: false,
        message: reload.message,
        target_version: this.toVersionSummary(target),
        previous_version: previous ? this.toVersionSummary(previous) : null,
        restored_version: null,
        reload,
      };
    }

    const restored = await this.recordVersion({
      action: 'config.rollback',
      actor: input.actor,
      reason: input.reason,
      metadata: {
        target_version_id: target.id,
        target_checksum: target.checksum,
      },
    });

    await this.recordEvent({
      action: 'config.rollback',
      target_type: 'config_version',
      target_id: String(target.id),
      success: true,
      actor_type: input.actor?.type ?? 'dashboard',
      actor_id: input.actor?.id ?? 'dashboard',
      source: input.source ?? 'dashboard',
      version_id: restored?.id ?? null,
      previous_version_id: previous?.id ?? null,
      message: `Rolled back to config version ${target.id}`,
      metadata_json: this.safeStringify({
        target_version_id: target.id,
        target_checksum: target.checksum,
        restored_checksum: restored?.checksum,
      }),
    });

    return {
      success: true,
      message: `Rolled back to config version ${target.id}`,
      target_version: this.toVersionSummary(target),
      previous_version: previous ? this.toVersionSummary(previous) : null,
      restored_version: restored ? this.toVersionSummary(restored) : null,
      reload,
    };
  }

  async listVersions(limit?: number): Promise<Record<string, unknown>> {
    const safeLimit = this.limit(limit, this.config.configAudit.max_versions);
    const items = await this.versionRepo.find({
      order: { created_at: 'DESC', id: 'DESC' },
      take: safeLimit,
    });
    return {
      items: items.map((item) => this.toVersionSummary(item)),
      pagination: { limit: safeLimit, count: items.length },
      privacy: this.privacyNotice(),
    };
  }

  async getVersion(id: number): Promise<Record<string, unknown> | null> {
    const version = await this.versionRepo.findOne({ where: { id } });
    if (!version) return null;
    return {
      ...this.toVersionSummary(version),
      sanitized_config: this.sanitizeYaml(version.snapshot_yaml),
      privacy: this.privacyNotice(),
    };
  }

  async listEvents(input: {
    limit?: number;
    action?: string;
    target_type?: string;
    success?: boolean;
  }): Promise<Record<string, unknown>> {
    const safeLimit = this.limit(input.limit, this.config.configAudit.max_events);
    const qb = this.eventRepo
      .createQueryBuilder('event')
      .where('1 = 1')
      .orderBy('event.timestamp', 'DESC')
      .addOrderBy('event.id', 'DESC')
      .take(safeLimit);

    if (input.action) {
      qb.andWhere('event.action = :action', { action: input.action });
    }
    if (input.target_type) {
      qb.andWhere('event.target_type = :targetType', {
        targetType: input.target_type,
      });
    }
    if (input.success !== undefined) {
      qb.andWhere('event.success = :success', { success: input.success });
    }

    const items = await qb.getMany();
    return {
      items: items.map((item) => this.toEventSummary(item)),
      pagination: { limit: safeLimit, count: items.length },
      privacy: this.privacyNotice(),
    };
  }

  private async recordVersion(input: {
    action: string;
    actor?: ConfigAuditActor;
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ConfigVersion | null> {
    if (!this.config.configAudit.enabled) return null;

    const raw = this.config.readRawConfigYaml();
    const summary = this.summarizeYaml(raw);
    const snapshot = this.config.getSnapshot();
    const version = this.versionRepo.create({
      action: input.action,
      actor_type: input.actor?.type ?? null,
      actor_id: input.actor?.id ?? null,
      reason: input.reason ?? null,
      checksum: createHash('sha256').update(raw).digest('hex'),
      config_path: this.config.getConfigPath(),
      runtime_version: snapshot.version,
      node_count: summary.node_count,
      node_ids_json: this.safeStringify(summary.node_ids),
      route_tiers_json: this.safeStringify(summary.route_tiers),
      summary_json: this.safeStringify({
        ...summary,
        metadata: input.metadata ?? {},
      }),
      snapshot_yaml: raw,
    });
    const saved = await this.versionRepo.save(version);
    await this.pruneVersions();
    return saved;
  }

  private async recordEvent(input: Partial<ConfigAuditEvent> & {
    action: string;
    success: boolean;
  }): Promise<ConfigAuditEvent | null> {
    if (!this.config.configAudit.enabled) return null;
    const event = this.eventRepo.create({
      action: input.action,
      target_type: input.target_type ?? null,
      target_id: input.target_id ?? null,
      success: input.success,
      actor_type: input.actor_type ?? null,
      actor_id: input.actor_id ?? null,
      source: input.source ?? null,
      version_id: input.version_id ?? null,
      previous_version_id: input.previous_version_id ?? null,
      message: input.message ?? null,
      error: input.error ?? null,
      metadata_json: input.metadata_json ?? null,
    });
    return this.eventRepo.save(event);
  }

  private async pruneVersions(): Promise<void> {
    const maxVersions = this.config.configAudit.max_versions;
    const count = await this.versionRepo.count();
    if (count <= maxVersions) return;

    const extra = count - maxVersions;
    const oldVersions = await this.versionRepo.find({
      order: { created_at: 'ASC', id: 'ASC' },
      take: extra,
    });
    if (oldVersions.length === 0) return;
    await this.versionRepo.delete(oldVersions.map((item) => item.id));
  }

  private summarizeYaml(raw: string): {
    node_count: number;
    node_ids: string[];
    route_tiers: string[];
    database_type: string | null;
    control_plane_enabled: boolean;
    namespaces: number;
  } {
    try {
      const parsed = yaml.load(raw) as Record<string, unknown>;
      const nodes = Array.isArray(parsed?.nodes)
        ? parsed.nodes.filter((node): node is Record<string, unknown> =>
            typeof node === 'object' && node !== null,
          )
        : [];
      const routing = parsed?.routing as Record<string, unknown> | undefined;
      const database = parsed?.database as Record<string, unknown> | undefined;
      const controlPlane = parsed?.control_plane as Record<string, unknown> | undefined;
      return {
        node_count: nodes.length,
        node_ids: nodes
          .map((node) => node.id)
          .filter((value): value is string => typeof value === 'string'),
        route_tiers:
          routing?.tiers && typeof routing.tiers === 'object'
            ? Object.keys(routing.tiers)
            : [],
        database_type:
          typeof database?.type === 'string' ? database.type : null,
        control_plane_enabled: controlPlane?.enabled === true,
        namespaces: Array.isArray(parsed?.namespaces)
          ? parsed.namespaces.length
          : 0,
      };
    } catch {
      return {
        node_count: 0,
        node_ids: [],
        route_tiers: [],
        database_type: null,
        control_plane_enabled: false,
        namespaces: 0,
      };
    }
  }

  private sanitizeYaml(raw: string): unknown {
    try {
      return this.sanitizeValue(yaml.load(raw));
    } catch {
      return { error: 'snapshot_yaml_parse_failed' };
    }
  }

  private sanitizeValue(value: unknown, keyHint = ''): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item, keyHint));
    }
    if (!value || typeof value !== 'object') {
      return this.isSensitiveKey(keyHint) ? this.maskValue(value) : value;
    }

    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (this.isSensitiveKey(key)) {
        result[key] = this.maskValue(child);
      } else if (key.toLowerCase() === 'headers' && child && typeof child === 'object') {
        result[key] = Object.fromEntries(
          Object.entries(child).map(([headerKey, headerValue]) => [
            headerKey,
            this.isSensitiveKey(headerKey)
              ? this.maskValue(headerValue)
              : this.sanitizeValue(headerValue, headerKey),
          ]),
        );
      } else {
        result[key] = this.sanitizeValue(child, key);
      }
    }
    return result;
  }

  private isSensitiveKey(key: string): boolean {
    const normalized = key.toLowerCase();
    return (
      normalized === 'api_key' ||
      normalized === 'key' ||
      normalized === 'password' ||
      normalized === 'authorization' ||
      normalized === 'registration_token' ||
      normalized.includes('secret') ||
      normalized.includes('token') ||
      normalized.includes('credential')
    );
  }

  private maskValue(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) return '[redacted]';
    if (value.startsWith('${') && value.endsWith('}')) return value;
    if (value.length <= 8) return '[redacted]';
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }

  private toVersionSummary(version: ConfigVersion): Record<string, unknown> {
    return {
      id: version.id,
      created_at: version.created_at,
      action: version.action,
      actor_type: version.actor_type,
      actor_id: version.actor_id,
      reason: version.reason,
      checksum: version.checksum,
      config_path: version.config_path,
      runtime_version: version.runtime_version,
      node_count: version.node_count,
      node_ids: this.parseJsonArray(version.node_ids_json),
      route_tiers: this.parseJsonArray(version.route_tiers_json),
      summary: this.parseJsonObject(version.summary_json),
    };
  }

  private toEventSummary(event: ConfigAuditEvent): Record<string, unknown> {
    return {
      id: event.id,
      timestamp: event.timestamp,
      action: event.action,
      target_type: event.target_type,
      target_id: event.target_id,
      success: event.success,
      actor_type: event.actor_type,
      actor_id: event.actor_id,
      source: event.source,
      version_id: event.version_id,
      previous_version_id: event.previous_version_id,
      message: event.message,
      error: event.error,
      metadata: this.parseJsonObject(event.metadata_json),
    };
  }

  private privacyNotice(): Record<string, unknown> {
    return {
      local_only: true,
      prompt_response_stored: false,
      raw_headers_stored: false,
      provider_keys_exposed_by_api: false,
      snapshot_storage:
        'Full rollback YAML is stored locally in the configured SiftGate database; Dashboard APIs return only sanitized snapshots.',
    };
  }

  private limit(input: number | undefined, fallback: number): number {
    const raw = Number(input ?? fallback);
    if (!Number.isFinite(raw)) return fallback;
    return Math.min(Math.max(Math.floor(raw), 1), 500);
  }

  private safeStringify(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  private parseJsonArray(raw: string): unknown[] {
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  private parseJsonObject(raw: string | null): Record<string, unknown> {
    if (!raw) return {};
    try {
      const value = JSON.parse(raw);
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
