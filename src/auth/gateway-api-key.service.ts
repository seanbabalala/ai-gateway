import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import {
  GatewayApiKey,
  GatewayApiKeyStatus,
} from '../database/entities/gateway-api-key.entity';
import { BudgetRule } from '../database/entities/budget-rule.entity';
import { CallLog } from '../database/entities/call-log.entity';
import { ConfigService } from '../config/config.service';
import {
  CreateGatewayApiKeyDto,
  UpdateGatewayApiKeyDto,
} from './dto/gateway-api-key.dto';

export interface GatewayApiKeyContext {
  id: string;
  name: string;
  status: GatewayApiKeyStatus;
  allow_auto: boolean;
  allow_direct: boolean;
  allowed_nodes: string[];
  allowed_models: string[];
  allowed_endpoints: string[];
  allowed_modalities: string[];
  namespace_id: string | null;
  namespace_name: string | null;
  rate_limit_per_minute: number | null;
}

export interface GatewayApiKeySummary {
  id: string;
  name: string;
  description: string | null;
  key_prefix: string;
  status: GatewayApiKeyStatus;
  allow_auto: boolean;
  allow_direct: boolean;
  allowed_nodes: string[];
  allowed_models: string[];
  allowed_endpoints: string[];
  allowed_modalities: string[];
  namespace_id: string | null;
  namespace_name: string | null;
  daily_token_limit: number | null;
  daily_cost_limit: number | null;
  rate_limit_per_minute: number | null;
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
  last_used_ip: string | null;
  today: {
    calls: number;
    errors: number;
    error_rate: number;
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
  };
}

export interface CreatedGatewayApiKey {
  key: string;
  item: GatewayApiKeySummary;
}

@Injectable()
export class GatewayApiKeyService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(GatewayApiKey)
    private readonly apiKeyRepo: Repository<GatewayApiKey>,
    @InjectRepository(BudgetRule)
    private readonly budgetRepo: Repository<BudgetRule>,
    @InjectRepository(CallLog)
    private readonly callLogRepo: Repository<CallLog>,
  ) {}

  async create(dto: CreateGatewayApiKeyDto): Promise<CreatedGatewayApiKey> {
    const normalized = this.normalizeCreateDto(dto);
    await this.assertUniqueName(normalized.name!);

    const key = this.generatePlainKey();
    const entity = this.apiKeyRepo.create({
      ...normalized,
      key_hash: this.hashKey(key),
      key_prefix: this.buildPrefix(key),
      status: 'active',
    });

    const saved = await this.apiKeyRepo.save(entity);
    await this.syncBudgetRules(saved);

    return {
      key,
      item: await this.toSummary(saved),
    };
  }

  async list(): Promise<GatewayApiKeySummary[]> {
    const keys = await this.apiKeyRepo.find({ order: { created_at: 'DESC' } });
    return Promise.all(keys.map((key) => this.toSummary(key)));
  }

  async getSummary(id: string): Promise<GatewayApiKeySummary> {
    return this.toSummary(await this.getById(id));
  }

  async findContextByPlainKey(
    plainKey: string,
    ip?: string,
  ): Promise<GatewayApiKeyContext | null> {
    const keyHash = this.hashKey(plainKey);
    const entity = await this.apiKeyRepo.findOne({ where: { key_hash: keyHash } });
    if (!entity || entity.status !== 'active') {
      return null;
    }
    if (entity.namespace_id && !this.config.getNamespace(entity.namespace_id)) {
      return null;
    }

    entity.last_used_at = new Date();
    entity.last_used_ip = ip || null;
    await this.apiKeyRepo.save(entity);

    return this.toContext(entity);
  }

  async update(
    id: string,
    dto: UpdateGatewayApiKeyDto,
  ): Promise<GatewayApiKeySummary> {
    const entity = await this.getById(id);
    const normalized = this.normalizeUpdateDto(dto);

    if (normalized.name && normalized.name !== entity.name) {
      await this.assertUniqueName(normalized.name, id);
      await this.renameBudgetRules(id, normalized.name);
    }

    Object.assign(entity, normalized);
    const saved = await this.apiKeyRepo.save(entity);
    await this.syncBudgetRules(saved);
    return this.toSummary(saved);
  }

  async remove(id: string): Promise<void> {
    const entity = await this.getById(id);
    await this.budgetRepo.update(
      { api_key_id: id },
      { is_active: false },
    );
    await this.apiKeyRepo.remove(entity);
  }

  async rotate(id: string): Promise<CreatedGatewayApiKey> {
    const entity = await this.getById(id);
    const key = this.generatePlainKey();
    entity.key_hash = this.hashKey(key);
    entity.key_prefix = this.buildPrefix(key);
    entity.status = 'active';
    const saved = await this.apiKeyRepo.save(entity);
    return {
      key,
      item: await this.toSummary(saved),
    };
  }

  private generatePlainKey(): string {
    return `gw_sk_live_${randomBytes(32).toString('base64url')}`;
  }

  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  private buildPrefix(key: string): string {
    return `${key.slice(0, 18)}...${key.slice(-4)}`;
  }

  private toContext(entity: GatewayApiKey): GatewayApiKeyContext {
    const namespace = this.config.getNamespace(entity.namespace_id);
    return {
      id: entity.id,
      name: entity.name,
      status: entity.status,
      allow_auto: entity.allow_auto,
      allow_direct: entity.allow_direct,
      allowed_nodes: this.combineRestrictions(
        entity.allowed_nodes || [],
        namespace?.allowed_nodes || [],
      ),
      allowed_models: this.combineRestrictions(
        entity.allowed_models || [],
        namespace?.allowed_models || [],
      ),
      allowed_endpoints: entity.allowed_endpoints || [],
      allowed_modalities: entity.allowed_modalities || [],
      namespace_id: entity.namespace_id || null,
      namespace_name: namespace?.name || null,
      rate_limit_per_minute: this.combineRateLimit(
        entity.rate_limit_per_minute,
        namespace?.rate_limit?.requests_per_minute,
      ),
    };
  }

  private async toSummary(entity: GatewayApiKey): Promise<GatewayApiKeySummary> {
    const since = this.startOfDay(new Date());
    const aggregate = await this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since })
      .andWhere('(log.api_key_id = :id OR (log.api_key_id IS NULL AND log.api_key_name = :name))', {
        id: entity.id,
        name: entity.name,
      })
      .select('COUNT(*)', 'calls')
      .addSelect('SUM(CASE WHEN log.status_code >= 400 THEN 1 ELSE 0 END)', 'errors')
      .addSelect('SUM(log.cost_usd)', 'cost')
      .addSelect('SUM(log.input_tokens)', 'inputTokens')
      .addSelect('SUM(log.output_tokens)', 'outputTokens')
      .getRawOne();
    const calls = Number(aggregate?.calls || 0);
    const errors = Number(aggregate?.errors || 0);

    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      key_prefix: entity.key_prefix,
      status: entity.status,
      allow_auto: entity.allow_auto,
      allow_direct: entity.allow_direct,
      allowed_nodes: entity.allowed_nodes || [],
      allowed_models: entity.allowed_models || [],
      allowed_endpoints: entity.allowed_endpoints || [],
      allowed_modalities: entity.allowed_modalities || [],
      namespace_id: entity.namespace_id || null,
      namespace_name: this.config.getNamespace(entity.namespace_id)?.name || null,
      daily_token_limit: entity.daily_token_limit,
      daily_cost_limit: entity.daily_cost_limit,
      rate_limit_per_minute: entity.rate_limit_per_minute,
      created_at: entity.created_at,
      updated_at: entity.updated_at,
      last_used_at: entity.last_used_at ?? null,
      last_used_ip: entity.last_used_ip,
      today: {
        calls,
        errors,
        error_rate: calls > 0 ? Number((errors / calls).toFixed(4)) : 0,
        cost_usd: Number(Number(aggregate?.cost || 0).toFixed(6)),
        input_tokens: Number(aggregate?.inputTokens || 0),
        output_tokens: Number(aggregate?.outputTokens || 0),
      },
    };
  }

  private normalizeCreateDto(dto: CreateGatewayApiKeyDto): Partial<GatewayApiKey> {
    const name = this.normalizeName(dto.name);
    return {
      name,
      description: this.normalizeNullableString(dto.description),
      allow_auto: dto.allow_auto ?? true,
      allow_direct: dto.allow_direct ?? false,
      allowed_nodes: this.normalizeStringArray(dto.allowed_nodes),
      allowed_models: this.normalizeStringArray(dto.allowed_models),
      allowed_endpoints: this.normalizeStringArray(dto.allowed_endpoints),
      allowed_modalities: this.normalizeStringArray(dto.allowed_modalities),
      namespace_id: this.normalizeNamespaceId(dto.namespace_id),
      daily_token_limit: this.normalizeOptionalLimit(dto.daily_token_limit),
      daily_cost_limit: this.normalizeOptionalLimit(dto.daily_cost_limit),
      rate_limit_per_minute: this.normalizeOptionalInteger(dto.rate_limit_per_minute),
    };
  }

  private normalizeUpdateDto(dto: UpdateGatewayApiKeyDto): Partial<GatewayApiKey> {
    const normalized: Partial<GatewayApiKey> = {};
    if (dto.name !== undefined) normalized.name = this.normalizeName(dto.name);
    if (dto.description !== undefined) normalized.description = this.normalizeNullableString(dto.description);
    if (dto.status !== undefined) {
      if (dto.status !== 'active' && dto.status !== 'disabled') {
        throw new BadRequestException('status must be "active" or "disabled"');
      }
      normalized.status = dto.status;
    }
    if (dto.allow_auto !== undefined) normalized.allow_auto = Boolean(dto.allow_auto);
    if (dto.allow_direct !== undefined) normalized.allow_direct = Boolean(dto.allow_direct);
    if (dto.allowed_nodes !== undefined) normalized.allowed_nodes = this.normalizeStringArray(dto.allowed_nodes);
    if (dto.allowed_models !== undefined) normalized.allowed_models = this.normalizeStringArray(dto.allowed_models);
    if (dto.allowed_endpoints !== undefined) normalized.allowed_endpoints = this.normalizeStringArray(dto.allowed_endpoints);
    if (dto.allowed_modalities !== undefined) normalized.allowed_modalities = this.normalizeStringArray(dto.allowed_modalities);
    if (dto.namespace_id !== undefined) normalized.namespace_id = this.normalizeNamespaceId(dto.namespace_id);
    if (dto.daily_token_limit !== undefined) normalized.daily_token_limit = this.normalizeOptionalLimit(dto.daily_token_limit);
    if (dto.daily_cost_limit !== undefined) normalized.daily_cost_limit = this.normalizeOptionalLimit(dto.daily_cost_limit);
    if (dto.rate_limit_per_minute !== undefined) normalized.rate_limit_per_minute = this.normalizeOptionalInteger(dto.rate_limit_per_minute);
    return normalized;
  }

  private normalizeName(name: string | undefined): string {
    const normalized = (name || '').trim();
    if (!normalized) {
      throw new BadRequestException('name is required');
    }
    if (normalized.length > 80) {
      throw new BadRequestException('name must be 80 characters or fewer');
    }
    return normalized;
  }

  private normalizeNullableString(value: string | null | undefined): string | null {
    const normalized = (value || '').trim();
    return normalized ? normalized : null;
  }

  private normalizeStringArray(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))];
  }

  private normalizeNamespaceId(value: string | null | undefined): string | null {
    const normalized = (value || '').trim();
    if (!normalized) return null;
    if (!this.config.getNamespace(normalized)) {
      throw new BadRequestException(`Unknown namespace_id: ${normalized}`);
    }
    return normalized;
  }

  private combineRestrictions(keyValues: string[], namespaceValues: string[]): string[] {
    if (keyValues.length === 0) return [...namespaceValues];
    if (namespaceValues.length === 0) return [...keyValues];
    const namespaceSet = new Set(namespaceValues);
    return keyValues.filter((value) => namespaceSet.has(value));
  }

  private combineRateLimit(
    keyLimit: number | null | undefined,
    namespaceLimit: number | null | undefined,
  ): number | null {
    const limits = [keyLimit, namespaceLimit]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    return limits.length > 0 ? Math.min(...limits) : null;
  }

  private normalizeOptionalLimit(value: number | null | undefined): number | null {
    if (value === null || value === undefined || value === 0) return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new BadRequestException('limits must be positive numbers');
    }
    return numeric;
  }

  private normalizeOptionalInteger(value: number | null | undefined): number | null {
    if (value === null || value === undefined || value === 0) return null;
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 1) {
      throw new BadRequestException('rate limit must be a positive integer');
    }
    return numeric;
  }

  private async assertUniqueName(name: string, exceptId?: string): Promise<void> {
    const existing = await this.apiKeyRepo.findOne({ where: { name } });
    if (existing && existing.id !== exceptId) {
      throw new BadRequestException(`API key name already exists: ${name}`);
    }
  }

  private async getById(id: string): Promise<GatewayApiKey> {
    const entity = await this.apiKeyRepo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`API key not found: ${id}`);
    }
    return entity;
  }

  private async syncBudgetRules(entity: GatewayApiKey): Promise<void> {
    await this.upsertBudgetRule(entity, 'daily_tokens', entity.daily_token_limit);
    await this.upsertBudgetRule(entity, 'daily_cost', entity.daily_cost_limit);
  }

  private async upsertBudgetRule(
    entity: GatewayApiKey,
    type: string,
    limit: number | null,
  ): Promise<void> {
    const existing = await this.budgetRepo.findOne({
      where: { api_key_id: entity.id, type },
    });

    if (limit === null) {
      if (existing) {
        existing.is_active = false;
        await this.budgetRepo.save(existing);
      }
      return;
    }

    if (existing) {
      existing.limit_value = limit;
      existing.alert_threshold = this.config.budget.alert_threshold;
      existing.api_key_name = entity.name;
      existing.is_active = true;
      await this.budgetRepo.save(existing);
      return;
    }

    await this.budgetRepo.save(this.budgetRepo.create({
      type,
      limit_value: limit,
      alert_threshold: this.config.budget.alert_threshold,
      current_value: 0,
      period_start: this.startOfDay(new Date()),
      is_active: true,
      api_key_name: entity.name,
      api_key_id: entity.id,
    }));
  }

  private async renameBudgetRules(id: string, name: string): Promise<void> {
    await this.budgetRepo.update({ api_key_id: id }, { api_key_name: name });
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
