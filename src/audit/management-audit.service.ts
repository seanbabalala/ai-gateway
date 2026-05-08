import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import {
  ManagementAuditEvent,
  ManagementAuditResult,
} from '../database/entities';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/workspace.constants';
import { WorkspaceContextService } from '../workspaces/workspace-context.service';
import { AuditRequestContextService } from './audit-request-context.service';

const REDACTED = '[redacted]';
const MAX_SUMMARY_LENGTH = 16_000;

export interface ManagementAuditActor {
  type?: string;
  id?: string;
}

export interface RecordManagementAuditInput {
  actor?: ManagementAuditActor;
  organizationId?: string | null;
  workspaceId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  beforeSummary?: unknown;
  afterSummary?: unknown;
  requestId?: string | null;
  result?: ManagementAuditResult;
  failureReason?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListManagementAuditOptions {
  limit?: number;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  actorId?: string;
  result?: ManagementAuditResult;
}

@Injectable()
export class ManagementAuditService {
  private readonly logger = new Logger(ManagementAuditService.name);

  constructor(
    private readonly workspaceContext: WorkspaceContextService,
    private readonly requestContext: AuditRequestContextService,
    @InjectRepository(ManagementAuditEvent)
    private readonly eventRepo: Repository<ManagementAuditEvent>,
  ) {}

  async record(
    input: RecordManagementAuditInput,
  ): Promise<ManagementAuditEvent | null> {
    try {
      const context = this.requestContext.current();
      const actor = {
        type: input.actor?.type || context?.actorType || 'system',
        id: input.actor?.id || context?.actorId || 'system',
      };
      const workspaceId = input.workspaceId ?? this.workspaceContext.currentWorkspaceId();
      const previous = await this.latestEventHash(workspaceId);
      const eventId = `mgmt_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
      const beforeSummary = this.stringifySummary(input.beforeSummary);
      const afterSummary = this.stringifySummary(input.afterSummary);
      const metadata = this.stringifySummary({
        ...(input.metadata ?? {}),
        path: context?.path,
        method: context?.method,
      });
      const eventHash = this.hashEvent({
        eventId,
        previous,
        organizationId: input.organizationId ?? null,
        workspaceId,
        actor,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        beforeSummary,
        afterSummary,
        result: input.result ?? 'success',
        failureReason: input.failureReason ?? null,
        requestId: input.requestId ?? context?.requestId ?? null,
        source: input.source ?? context?.source ?? 'dashboard',
        metadata,
      });

      const event = this.eventRepo.create({
        event_id: eventId,
        organization_id: input.organizationId ?? null,
        workspace_id: workspaceId,
        actor_type: actor.type,
        actor_id: actor.id,
        action: input.action,
        resource_type: input.resourceType,
        resource_id: input.resourceId ?? null,
        before_summary_json: beforeSummary,
        after_summary_json: afterSummary,
        result: input.result ?? 'success',
        failure_reason: this.redactString(input.failureReason ?? null),
        request_id: input.requestId ?? context?.requestId ?? null,
        source: input.source ?? context?.source ?? 'dashboard',
        metadata_json: metadata,
        previous_hash: previous,
        event_hash: eventHash,
        schema_version: 1,
      });
      return await this.eventRepo.save(event);
    } catch (err) {
      this.logger.warn(
        `Management audit event was not persisted: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async recordDenied(input: {
    actor?: ManagementAuditActor;
    workspaceId?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<ManagementAuditEvent | null> {
    return this.record({
      ...input,
      result: 'denied',
      failureReason: input.reason,
      afterSummary: {
        denied: true,
        reason: input.reason,
      },
    });
  }

  async list(options: ListManagementAuditOptions = {}) {
    const limit = clampLimit(options.limit);
    const qb = this.eventRepo
      .createQueryBuilder('event')
      .where(
        this.workspaceContext.currentWorkspaceId() === DEFAULT_WORKSPACE_ID
          ? '(event.workspace_id = :workspaceId OR event.workspace_id IS NULL)'
          : 'event.workspace_id = :workspaceId',
        { workspaceId: this.workspaceContext.currentWorkspaceId() },
      )
      .orderBy('event.timestamp', 'DESC')
      .addOrderBy('event.id', 'DESC')
      .take(limit);

    if (options.action) {
      qb.andWhere('event.action = :action', { action: options.action });
    }
    if (options.resourceType) {
      qb.andWhere('event.resource_type = :resourceType', {
        resourceType: options.resourceType,
      });
    }
    if (options.resourceId) {
      qb.andWhere('event.resource_id = :resourceId', {
        resourceId: options.resourceId,
      });
    }
    if (options.actorId) {
      qb.andWhere('event.actor_id = :actorId', { actorId: options.actorId });
    }
    if (options.result) {
      qb.andWhere('event.result = :result', { result: options.result });
    }

    const [items, count] = await qb.getManyAndCount();
    return {
      data: items.map((item) => this.toSummary(item)),
      pagination: {
        limit,
        count,
      },
      privacy: {
        prompt_response_stored: false,
        raw_headers_stored: false,
        provider_keys_stored: false,
        tool_payloads_stored: false,
        hidden_reasoning_stored: false,
      },
    };
  }

  sanitize(value: unknown): unknown {
    return this.sanitizeValue(value);
  }

  private async latestEventHash(workspaceId: string | null): Promise<string | null> {
    const latest = await this.eventRepo.findOne({
      where: workspaceId
        ? { workspace_id: workspaceId }
        : { workspace_id: IsNull() },
      order: { id: 'DESC' },
    });
    return latest?.event_hash ?? null;
  }

  private stringifySummary(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const sanitized = this.sanitizeValue(value);
    const json = JSON.stringify(sanitized);
    if (json.length <= MAX_SUMMARY_LENGTH) return json;
    return JSON.stringify({
      truncated: true,
      size: json.length,
      preview: json.slice(0, MAX_SUMMARY_LENGTH),
    });
  }

  private sanitizeValue(value: unknown, key?: string): unknown {
    if (key && this.isSensitiveKey(key)) return this.maskValue(value);
    if (typeof value === 'string') return this.redactString(value);
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item, key));
    }
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = this.sanitizeValue(childValue, childKey);
    }
    return result;
  }

  private isSensitiveKey(key: string): boolean {
    const normalized = key.toLowerCase();
    return (
      normalized === 'api_key' ||
      normalized === 'key' ||
      normalized === 'key_hash' ||
      normalized === 'token' ||
      normalized === 'token_hash' ||
      normalized === 'password' ||
      normalized === 'password_hash' ||
      normalized === 'authorization' ||
      normalized === 'x-api-key' ||
      normalized.includes('secret') ||
      normalized.includes('credential') ||
      normalized.includes('reasoning') ||
      normalized.includes('prompt') ||
      normalized.includes('response') ||
      normalized.includes('payload') ||
      normalized.includes('headers')
    );
  }

  private maskValue(value: unknown): string {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      return value;
    }
    return REDACTED;
  }

  private redactString(value: string | null): string | null {
    if (!value) return value;
    if (/gw_sk_[A-Za-z0-9_-]+/.test(value)) return REDACTED;
    if (/Bearer\s+[A-Za-z0-9._~+/=-]+/i.test(value)) return REDACTED;
    return value;
  }

  private hashEvent(input: Record<string, unknown>): string {
    return createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
  }

  private toSummary(event: ManagementAuditEvent): Record<string, unknown> {
    return {
      id: event.id,
      event_id: event.event_id,
      organization_id: event.organization_id,
      workspace_id: event.workspace_id,
      timestamp: event.timestamp,
      actor_type: event.actor_type,
      actor_id: event.actor_id,
      action: event.action,
      resource_type: event.resource_type,
      resource_id: event.resource_id,
      before_summary: parseJsonObject(event.before_summary_json),
      after_summary: parseJsonObject(event.after_summary_json),
      result: event.result,
      failure_reason: event.failure_reason,
      request_id: event.request_id,
      source: event.source,
      metadata: parseJsonObject(event.metadata_json),
      previous_hash: event.previous_hash,
      event_hash: event.event_hash,
      schema_version: event.schema_version,
    };
  }
}

function clampLimit(value?: number): number {
  if (!Number.isFinite(value ?? 100)) return 100;
  return Math.max(1, Math.min(500, Math.trunc(value ?? 100)));
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}
