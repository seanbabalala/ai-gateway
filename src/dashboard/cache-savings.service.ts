import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { ConfigService } from '../config/config.service';
import { ModelPricing } from '../config/gateway.config';
import { CallLog } from '../database/entities';
import { WorkspaceContextService } from '../workspaces/workspace-context.service';
import { workspaceFindWhereStrict } from '../workspaces/workspace-scope';

export type CacheSavingsGroupBy =
  | 'node'
  | 'model'
  | 'namespace'
  | 'team'
  | 'api_key';

export interface CacheSavingsScope {
  api_key?: string;
  api_key_id?: string;
  namespace?: string;
  team_id?: string;
}

export interface CacheSavingsMetrics {
  total_requests: number;
  provider_routed_requests: number;
  requests_with_provider_cache_hit: number;
  cache_hit_rate: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  total_normal_input_tokens: number;
  actual_cost_usd: number;
  hypothetical_no_cache_cost_usd: number;
  savings_usd: number;
  savings_percentage: number;
  normal_input_cost_usd: number;
  cache_read_cost_usd: number;
  cache_creation_cost_usd: number;
  output_cost_usd: number;
}

export interface CacheSavingsGroupRow extends CacheSavingsMetrics {
  group_value: string;
  group_label: string;
}

export interface CacheSavingsTrendRow extends CacheSavingsMetrics {
  date: string;
}

export interface CacheSavingsSummaryResponse {
  period: string;
  period_days: number;
  group_by: CacheSavingsGroupBy;
  filters: {
    api_key_id: string | null;
    api_key_name: string | null;
    namespace_id: string | null;
    team_id: string | null;
  };
  summary: CacheSavingsMetrics;
  groups: CacheSavingsGroupRow[];
  daily_trend: CacheSavingsTrendRow[];
}

interface MutableCacheSavingsMetrics extends CacheSavingsMetrics {}

interface RowCostComponents {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  normalInputTokens: number;
  actualCostUsd: number;
  hypotheticalNoCacheCostUsd: number;
  normalInputCostUsd: number;
  cacheReadCostUsd: number;
  cacheCreationCostUsd: number;
  outputCostUsd: number;
}

const NON_PROVIDER_NODE_IDS = new Set(['cache', 'semantic_cache', 'hook']);

@Injectable()
export class CacheSavingsService {
  constructor(
    @InjectRepository(CallLog)
    private readonly callLogRepo: Repository<CallLog>,
    private readonly config: ConfigService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async getSummary(
    period: string = '7d',
    groupBy: CacheSavingsGroupBy = 'node',
    scope: CacheSavingsScope = {},
  ): Promise<CacheSavingsSummaryResponse> {
    const window = resolvePeriod(period);
    const rows = await this.callLogRepo.find({
      where: this.buildWhere(window.since, scope),
      order: { timestamp: 'ASC' },
    });

    const summary = createMetrics();
    const groups = new Map<string, MutableCacheSavingsMetrics>();
    const dailyTrend = new Map<string, MutableCacheSavingsMetrics>();

    for (const date of enumerateUtcDates(window.since, new Date())) {
      dailyTrend.set(date, createMetrics());
    }

    for (const row of rows) {
      this.accumulate(summary, row);

      const group = groupDescriptor(groupBy, row);
      const groupMetrics = groups.get(group.value) || createMetrics();
      this.accumulate(groupMetrics, row);
      groups.set(group.value, groupMetrics);

      const date = toUtcDateKey(row.timestamp);
      const dayMetrics = dailyTrend.get(date) || createMetrics();
      this.accumulate(dayMetrics, row);
      dailyTrend.set(date, dayMetrics);
    }

    return {
      period: window.label,
      period_days: window.days,
      group_by: groupBy,
      filters: {
        api_key_id: scope.api_key_id || null,
        api_key_name: scope.api_key || null,
        namespace_id: scope.namespace || null,
        team_id: scope.team_id || null,
      },
      summary: finalizeMetrics(summary),
      groups: [...groups.entries()]
        .map(([value, metrics]) => ({
          group_value: value,
          group_label: groupLabel(groupBy, value, rows),
          ...finalizeMetrics(metrics),
        }))
        .filter((group) => group.provider_routed_requests > 0)
        .sort(
          (a, b) =>
            b.savings_usd - a.savings_usd ||
            b.actual_cost_usd - a.actual_cost_usd ||
            b.total_requests - a.total_requests,
        ),
      daily_trend: [...dailyTrend.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, metrics]) => ({
          date,
          ...finalizeMetrics(metrics),
        })),
    };
  }

  private buildWhere(since: Date, scope: CacheSavingsScope) {
    return workspaceFindWhereStrict(this.workspaceContext.currentWorkspaceId(), {
      timestamp: MoreThanOrEqual(since),
      ...(scope.api_key_id ? { api_key_id: scope.api_key_id } : {}),
      ...(!scope.api_key_id && scope.api_key ? { api_key_name: scope.api_key } : {}),
      ...(scope.namespace ? { namespace_id: scope.namespace } : {}),
      ...(scope.team_id ? { team_id: scope.team_id } : {}),
    });
  }

  private accumulate(metrics: MutableCacheSavingsMetrics, row: CallLog): void {
    metrics.total_requests += 1;
    if (!isProviderRoutedLog(row)) return;

    const components = this.rowCostComponents(row);
    metrics.provider_routed_requests += 1;
    if (components.cacheReadTokens > 0) {
      metrics.requests_with_provider_cache_hit += 1;
    }
    metrics.total_input_tokens += components.inputTokens;
    metrics.total_output_tokens += components.outputTokens;
    metrics.total_cache_read_tokens += components.cacheReadTokens;
    metrics.total_cache_creation_tokens += components.cacheCreationTokens;
    metrics.total_normal_input_tokens += components.normalInputTokens;
    metrics.actual_cost_usd += components.actualCostUsd;
    metrics.hypothetical_no_cache_cost_usd +=
      components.hypotheticalNoCacheCostUsd;
    metrics.normal_input_cost_usd += components.normalInputCostUsd;
    metrics.cache_read_cost_usd += components.cacheReadCostUsd;
    metrics.cache_creation_cost_usd += components.cacheCreationCostUsd;
    metrics.output_cost_usd += components.outputCostUsd;
  }

  private rowCostComponents(row: CallLog): RowCostComponents {
    const inputTokens = toNumber(row.input_tokens);
    const outputTokens = toNumber(row.output_tokens);
    const cacheReadTokens = toNumber(row.cache_read_input_tokens);
    const cacheCreationTokens = toNumber(row.cache_creation_input_tokens);
    const normalInputTokens = Math.max(
      0,
      inputTokens - cacheReadTokens - cacheCreationTokens,
    );

    const pricing = this.config.getModelPricing(row.model, row.node_id);
    const actualCostFromPricing = pricing
      ? calculateCacheAwareCost(
          {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_read_input_tokens: cacheReadTokens,
            cache_creation_input_tokens: cacheCreationTokens,
          },
          pricing,
        )
      : 0;
    const storedCostUsd = toNumber(row.cost_usd);
    const shouldUseComputedCacheCost =
      pricing !== undefined &&
      (cacheReadTokens > 0 || cacheCreationTokens > 0) &&
      actualCostFromPricing > 0 &&
      (storedCostUsd <= 0 || actualCostFromPricing < storedCostUsd);
    const actualCostUsd = toCurrency(
      shouldUseComputedCacheCost
        ? actualCostFromPricing
        : hasPositiveNumber(row.cost_usd)
          ? row.cost_usd
          : actualCostFromPricing,
    );

    const hypotheticalFromPricing = pricing
      ? calculateNoCacheCost(
          {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          },
          pricing,
        )
      : 0;
    const hypotheticalNoCacheCostUsd = toCurrency(
      row.cost_without_cache_usd !== null &&
        row.cost_without_cache_usd !== undefined
        ? row.cost_without_cache_usd
        : hypotheticalFromPricing,
    );

    if (!pricing) {
      return {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        normalInputTokens,
        actualCostUsd,
        hypotheticalNoCacheCostUsd,
        normalInputCostUsd: actualCostUsd,
        cacheReadCostUsd: 0,
        cacheCreationCostUsd: 0,
        outputCostUsd: 0,
      };
    }

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      normalInputTokens,
      actualCostUsd,
      hypotheticalNoCacheCostUsd,
      normalInputCostUsd: toCurrency(
        (normalInputTokens / 1_000_000) * pricing.input,
      ),
      cacheReadCostUsd: toCurrency(
        (cacheReadTokens / 1_000_000) *
          (pricing.cache_read_input ??
            pricing.cache_read_per_1m_tokens ??
            pricing.input),
      ),
      cacheCreationCostUsd: toCurrency(
        (cacheCreationTokens / 1_000_000) *
          (pricing.cache_creation_input ??
            pricing.cache_write_per_1m_tokens ??
            pricing.input),
      ),
      outputCostUsd: toCurrency(
        (outputTokens / 1_000_000) * pricing.output,
      ),
    };
  }
}

function createMetrics(): MutableCacheSavingsMetrics {
  return {
    total_requests: 0,
    provider_routed_requests: 0,
    requests_with_provider_cache_hit: 0,
    cache_hit_rate: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cache_read_tokens: 0,
    total_cache_creation_tokens: 0,
    total_normal_input_tokens: 0,
    actual_cost_usd: 0,
    hypothetical_no_cache_cost_usd: 0,
    savings_usd: 0,
    savings_percentage: 0,
    normal_input_cost_usd: 0,
    cache_read_cost_usd: 0,
    cache_creation_cost_usd: 0,
    output_cost_usd: 0,
  };
}

function finalizeMetrics(
  metrics: MutableCacheSavingsMetrics,
): CacheSavingsMetrics {
  const savings = metrics.hypothetical_no_cache_cost_usd - metrics.actual_cost_usd;
  const hitRate =
    metrics.provider_routed_requests > 0
      ? (metrics.requests_with_provider_cache_hit /
          metrics.provider_routed_requests) *
        100
      : 0;
  const savingsPercentage =
    metrics.hypothetical_no_cache_cost_usd > 0
      ? (savings / metrics.hypothetical_no_cache_cost_usd) * 100
      : 0;

  return {
    total_requests: metrics.total_requests,
    provider_routed_requests: metrics.provider_routed_requests,
    requests_with_provider_cache_hit: metrics.requests_with_provider_cache_hit,
    cache_hit_rate: round(hitRate, 2),
    total_input_tokens: metrics.total_input_tokens,
    total_output_tokens: metrics.total_output_tokens,
    total_cache_read_tokens: metrics.total_cache_read_tokens,
    total_cache_creation_tokens: metrics.total_cache_creation_tokens,
    total_normal_input_tokens: metrics.total_normal_input_tokens,
    actual_cost_usd: round(metrics.actual_cost_usd, 6),
    hypothetical_no_cache_cost_usd: round(
      metrics.hypothetical_no_cache_cost_usd,
      6,
    ),
    savings_usd: round(savings, 6),
    savings_percentage: round(savingsPercentage, 2),
    normal_input_cost_usd: round(metrics.normal_input_cost_usd, 6),
    cache_read_cost_usd: round(metrics.cache_read_cost_usd, 6),
    cache_creation_cost_usd: round(metrics.cache_creation_cost_usd, 6),
    output_cost_usd: round(metrics.output_cost_usd, 6),
  };
}

function resolvePeriod(period: string) {
  const normalized = `${period || '7d'}`.trim().toLowerCase();
  if (normalized === '1d') return { label: '1d', days: 1, since: daysAgo(1) };
  if (normalized === '30d') return { label: '30d', days: 30, since: daysAgo(30) };
  if (normalized === '90d') return { label: '90d', days: 90, since: daysAgo(90) };
  return { label: '7d', days: 7, since: daysAgo(7) };
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - Math.max(0, days - 1));
  return date;
}

function enumerateUtcDates(start: Date, end: Date): string[] {
  const values: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const limit = new Date(end);
  limit.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() <= limit.getTime()) {
    values.push(toUtcDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return values;
}

function toUtcDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function isProviderRoutedLog(row: CallLog): boolean {
  return !NON_PROVIDER_NODE_IDS.has(`${row.node_id || ''}`);
}

function groupDescriptor(groupBy: CacheSavingsGroupBy, row: CallLog) {
  switch (groupBy) {
    case 'model':
      return { value: row.model || 'unknown' };
    case 'namespace':
      return { value: row.namespace_id || 'unscoped' };
    case 'team':
      return { value: row.team_id || 'unassigned' };
    case 'api_key':
      return { value: row.api_key_id || row.api_key_name || 'anonymous' };
    case 'node':
    default:
      return { value: row.node_id || 'unknown' };
  }
}

function groupLabel(
  groupBy: CacheSavingsGroupBy,
  value: string,
  rows: CallLog[],
): string {
  if (groupBy !== 'api_key') return value;
  const match = rows.find(
    (row) => (row.api_key_id || row.api_key_name || 'anonymous') === value,
  );
  return match?.api_key_name || match?.api_key_id || value;
}

function calculateCacheAwareCost(
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  },
  pricing: ModelPricing,
): number {
  const regularInput = Math.max(
    0,
    usage.input_tokens -
      usage.cache_read_input_tokens -
      usage.cache_creation_input_tokens,
  );
  const cacheReadPrice =
    pricing.cache_read_input ??
    pricing.cache_read_per_1m_tokens ??
    pricing.input;
  const cacheCreationPrice =
    pricing.cache_creation_input ??
    pricing.cache_write_per_1m_tokens ??
    pricing.input;
  return (
    (regularInput / 1_000_000) * pricing.input +
    (usage.cache_read_input_tokens / 1_000_000) * cacheReadPrice +
    (usage.cache_creation_input_tokens / 1_000_000) * cacheCreationPrice +
    (usage.output_tokens / 1_000_000) * pricing.output
  );
}

function calculateNoCacheCost(
  usage: { input_tokens: number; output_tokens: number },
  pricing: ModelPricing,
): number {
  return (
    (usage.input_tokens / 1_000_000) * pricing.input +
    (usage.output_tokens / 1_000_000) * pricing.output
  );
}

function toCurrency(value: unknown): number {
  return round(toNumber(value), 6);
}

function hasPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
