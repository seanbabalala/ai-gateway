import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AlertService } from '../alerts/alert.service';
import { ConfigService } from '../config/config.service';
import type { ModelPricing, NodeConfig } from '../config/gateway.config';
import { CallLog, RouteDecisionLog, RouteFeedback } from '../database/entities';
import { CatalogSyncService } from '../catalog/catalog-sync';
import { CatalogService, assessCatalogPricing } from '../catalog/catalog.service';
import type { CatalogModel, CatalogPricing } from '../catalog/catalog.types';
import { applyWorkspaceQueryScope, normalizeWorkspaceId } from '../workspaces/workspace-scope';
import { WorkspaceContextService } from '../workspaces/workspace-context.service';

export type ChargebackGroupBy = 'workspace' | 'team' | 'project' | 'api_key' | 'model' | 'node';
export type ExportFormat = 'json' | 'csv';
export type FeedbackValue = 'up' | 'down';

export interface ChargebackQuery {
  period?: string;
  group_by?: ChargebackGroupBy;
  team_id?: string;
  project?: string;
  api_key_id?: string;
}

export interface CostPlatformExport {
  contentType: string;
  filename: string;
  body: string;
}

interface PeriodWindow {
  label: string;
  days: number;
  since: Date;
  until: Date;
}

interface MutableUsageMetrics {
  requests: number;
  successful_requests: number;
  failed_requests: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  estimated_savings_usd: number;
  fallback_count: number;
  optimizer_applied: number;
  quality_gate_failed: number;
  latency_sum_ms: number;
}

interface UsageMetrics extends Omit<MutableUsageMetrics, 'latency_sum_ms'> {
  avg_latency_ms: number;
  success_rate: number;
}

@Injectable()
export class CostPlatformService {
  constructor(
    @InjectRepository(CallLog)
    private readonly callLogRepo: Repository<CallLog>,
    @InjectRepository(RouteDecisionLog)
    private readonly routeDecisionRepo: Repository<RouteDecisionLog>,
    @InjectRepository(RouteFeedback)
    private readonly feedbackRepo: Repository<RouteFeedback>,
    private readonly config: ConfigService,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly catalog: CatalogService,
    private readonly catalogSync: CatalogSyncService,
    private readonly alerts: AlertService,
  ) {}

  async getDashboardSummary(query: ChargebackQuery = {}) {
    const window = resolvePeriod(query.period || '30d');
    const rows = await this.loadRows(window, query);
    const groupBy = normalizeGroupBy(query.group_by);
    const groups = this.groupRows(rows, groupBy);
    const dailyTrend = this.dailyTrend(rows, window);
    const anomalies = this.detectAnomalies(rows, window);
    const priceSync = this.priceSyncSummary();
    const feedback = await this.feedbackSummary(window);

    for (const anomaly of anomalies.filter((entry) => entry.severity !== 'info')) {
      this.alerts.emit({
        type: 'cost_anomaly',
        severity: anomaly.severity === 'critical' ? 'critical' : 'warning',
        message: anomaly.message,
        dedupeKey: `${normalizeWorkspaceId(this.workspaceContext.currentWorkspaceId())}:${anomaly.scope}:${anomaly.key}`,
        details: {
          workspace_id: normalizeWorkspaceId(this.workspaceContext.currentWorkspaceId()),
          scope: anomaly.scope,
          key: anomaly.key,
          current_cost_usd: anomaly.current_cost_usd,
          baseline_cost_usd: anomaly.baseline_cost_usd,
          rate_of_change: anomaly.rate_of_change,
          recommended_policy: anomaly.recommended_policy,
        },
      });
    }

    return {
      version: 'v1',
      workspace_id: normalizeWorkspaceId(this.workspaceContext.currentWorkspaceId()),
      generated_at: new Date().toISOString(),
      period: {
        label: window.label,
        days: window.days,
        since: window.since.toISOString(),
        until: window.until.toISOString(),
      },
      filters: {
        group_by: groupBy,
        team_id: query.team_id || null,
        project: query.project || null,
        api_key_id: query.api_key_id || null,
      },
      chargeback: {
        summary: finalizeMetrics(rows.reduce((acc, row) => accumulateMetrics(acc, row), createMetrics())),
        groups,
        daily_trend: dailyTrend,
        budget_period_close: this.budgetPeriodClose(rows, window),
        invoice_summary: this.invoiceSummary(groups),
      },
      anomalies,
      price_sync: priceSync,
      feedback,
      privacy: costPlatformPrivacy(),
      boundaries: {
        payments: false,
        recharge_balances: false,
        reseller_marketplace: false,
        public_api_marketplace: false,
      },
    };
  }

  async exportChargeback(
    format: ExportFormat,
    query: ChargebackQuery = {},
  ): Promise<CostPlatformExport> {
    const summary = await this.getDashboardSummary(query);
    const filenameBase = `siftgate-chargeback-${summary.workspace_id}-${summary.period.label}`;
    if (format === 'json') {
      return {
        contentType: 'application/json; charset=utf-8',
        filename: `${filenameBase}.json`,
        body: JSON.stringify(summary, null, 2),
      };
    }

    const rows = [
      [
        'group',
        'label',
        'requests',
        'successful_requests',
        'failed_requests',
        'total_tokens',
        'cost_usd',
        'estimated_savings_usd',
        'avg_latency_ms',
        'success_rate',
      ],
      ...summary.chargeback.groups.map((group: any) => [
        group.group_value,
        group.group_label,
        group.requests,
        group.successful_requests,
        group.failed_requests,
        group.total_tokens,
        group.cost_usd,
        group.estimated_savings_usd,
        group.avg_latency_ms,
        group.success_rate,
      ]),
    ];
    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `${filenameBase}.csv`,
      body: rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n',
    };
  }

  async recordFeedback(input: {
    request_id?: string;
    value?: string;
    reason_code?: string;
    source?: string;
    api_key_id?: string | null;
    api_key_name?: string | null;
    workspace_id?: string | null;
  }) {
    const requestId = sanitizeIdentifier(input.request_id, 120);
    if (!requestId) {
      throw new BadRequestException('request_id is required.');
    }
    const value = normalizeFeedbackValue(input.value);
    if (!value) {
      throw new BadRequestException('value must be "up" or "down".');
    }
    const workspaceId = normalizeWorkspaceId(input.workspace_id);
    const decision = await this.findDecisionForFeedback(requestId, workspaceId);
    const log = await this.findLogForFeedback(requestId, workspaceId);
    const evidence = this.routeWeightEvidence(decision);
    const saved = await this.feedbackRepo.save(
      this.feedbackRepo.create({
        id: `fb_${uuidv4()}`,
        workspace_id: workspaceId,
        request_id: requestId,
        route_decision_id: decision?.request_id || requestId,
        api_key_id: sanitizeIdentifier(input.api_key_id || log?.api_key_id, 120),
        api_key_name: sanitizeIdentifier(input.api_key_name || log?.api_key_name, 120),
        team_id: sanitizeIdentifier(log?.team_id, 120),
        value,
        reason_code: sanitizeIdentifier(input.reason_code, 80),
        source: sanitizeIdentifier(input.source, 80) || 'gateway_api',
        route_weight_evidence_json: JSON.stringify(evidence),
      }),
    );
    return {
      success: true,
      feedback_id: saved.id,
      request_id: saved.request_id,
      value: saved.value,
      metadata_only: true,
      route_weight_evidence: evidence,
      privacy: costPlatformPrivacy(),
    };
  }

  private async loadRows(
    window: PeriodWindow,
    query: ChargebackQuery,
  ): Promise<CallLog[]> {
    const qb = this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since: window.since })
      .andWhere('log.timestamp <= :until', { until: window.until })
      .orderBy('log.timestamp', 'ASC')
      .take(10000);
    applyWorkspaceQueryScope(qb, 'log', this.workspaceContext.currentWorkspaceId());
    if (query.team_id) qb.andWhere('log.team_id = :teamId', { teamId: query.team_id });
    if (query.project) qb.andWhere('log.agent_project = :project', { project: query.project });
    if (query.api_key_id) qb.andWhere('log.api_key_id = :apiKeyId', { apiKeyId: query.api_key_id });
    return qb.getMany();
  }

  private groupRows(rows: CallLog[], groupBy: ChargebackGroupBy) {
    const groups = new Map<string, MutableUsageMetrics>();
    for (const row of rows) {
      const key = groupKey(row, groupBy);
      const metrics = groups.get(key) || createMetrics();
      accumulateMetrics(metrics, row);
      groups.set(key, metrics);
    }
    return [...groups.entries()]
      .map(([value, metrics]) => ({
        group_by: groupBy,
        group_value: value,
        group_label: groupLabel(value, groupBy),
        ...finalizeMetrics(metrics),
      }))
      .sort((a, b) => b.cost_usd - a.cost_usd || b.requests - a.requests || a.group_value.localeCompare(b.group_value))
      .slice(0, 50);
  }

  private dailyTrend(rows: CallLog[], window: PeriodWindow) {
    const days = new Map<string, MutableUsageMetrics>();
    for (const date of enumerateUtcDates(window.since, window.until)) {
      days.set(date, createMetrics());
    }
    for (const row of rows) {
      const key = toUtcDateKey(row.timestamp);
      const metrics = days.get(key) || createMetrics();
      accumulateMetrics(metrics, row);
      days.set(key, metrics);
    }
    return [...days.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, metrics]) => ({ date, ...finalizeMetrics(metrics) }));
  }

  private budgetPeriodClose(rows: CallLog[], window: PeriodWindow) {
    const summary = finalizeMetrics(rows.reduce((acc, row) => accumulateMetrics(acc, row), createMetrics()));
    const globalCostLimit = this.config.budget.daily_cost_limit
      ? this.config.budget.daily_cost_limit * window.days
      : null;
    const closeStatus =
      globalCostLimit && summary.cost_usd > globalCostLimit
        ? 'over_budget'
        : globalCostLimit && summary.cost_usd >= globalCostLimit * (this.config.budget.alert_threshold || 0.8)
          ? 'near_budget'
          : 'ready';
    return {
      period_label: window.label,
      close_status: closeStatus,
      requests: summary.requests,
      cost_usd: summary.cost_usd,
      global_budget_limit_usd: globalCostLimit ? round(globalCostLimit, 6) : null,
      variance_usd: globalCostLimit ? round(summary.cost_usd - globalCostLimit, 6) : null,
      invoice_ready: true,
      payment_collection: false,
      recharge_balance: false,
    };
  }

  private invoiceSummary(groups: Array<Record<string, unknown>>) {
    return {
      currency: 'USD',
      line_items: groups.slice(0, 20).map((group) => ({
        description: group.group_label,
        quantity_requests: group.requests,
        total_tokens: group.total_tokens,
        amount_usd: group.cost_usd,
      })),
      disclaimer:
        'Internal chargeback summary only. Provider invoices and operator overrides remain the billing authority.',
    };
  }

  private detectAnomalies(rows: CallLog[], window: PeriodWindow) {
    const midpoint = new Date(window.until.getTime() - ((window.until.getTime() - window.since.getTime()) / 2));
    const current = rows.filter((row) => new Date(row.timestamp).getTime() >= midpoint.getTime());
    const baseline = rows.filter((row) => new Date(row.timestamp).getTime() < midpoint.getTime());
    const scopes: Array<{ scope: ChargebackGroupBy; minCost: number }> = [
      { scope: 'workspace', minCost: 1 },
      { scope: 'team', minCost: 0.5 },
      { scope: 'project', minCost: 0.5 },
      { scope: 'api_key', minCost: 0.5 },
      { scope: 'model', minCost: 0.5 },
    ];
    const anomalies = [];
    for (const item of scopes) {
      const currentGroups = this.groupCost(current, item.scope);
      const baselineGroups = this.groupCost(baseline, item.scope);
      for (const [key, currentCost] of currentGroups.entries()) {
        const baselineCost = baselineGroups.get(key) || 0;
        const rateOfChange = baselineCost > 0 ? (currentCost - baselineCost) / baselineCost : currentCost > 0 ? 1 : 0;
        if (currentCost < item.minCost && rateOfChange < 1.5) continue;
        if (rateOfChange < 1 && currentCost < item.minCost * 4) continue;
        anomalies.push({
          id: `cost_anomaly_${item.scope}_${safeId(key)}`,
          scope: item.scope,
          key,
          severity: rateOfChange >= 3 || currentCost >= item.minCost * 10 ? 'critical' : 'warning',
          rule: 'rate_of_change',
          current_cost_usd: round(currentCost, 6),
          baseline_cost_usd: round(baselineCost, 6),
          rate_of_change: round(rateOfChange, 4),
          message: `${groupLabel(key, item.scope)} cost changed ${round(rateOfChange * 100, 1)}% versus the previous half of ${window.label}.`,
          recommended_policy:
            rateOfChange >= 3
              ? { action: 'optional_downgrade', automatic: false, reason: 'manual_approval_required' }
              : { action: 'alert', automatic: false, reason: 'observe_before_downgrade' },
        });
      }
    }
    return anomalies.sort((a, b) => b.current_cost_usd - a.current_cost_usd).slice(0, 20);
  }

  private groupCost(rows: CallLog[], groupBy: ChargebackGroupBy): Map<string, number> {
    const groups = new Map<string, number>();
    for (const row of rows) {
      const key = groupKey(row, groupBy);
      groups.set(key, (groups.get(key) || 0) + Number(row.cost_usd || 0));
    }
    return groups;
  }

  private priceSyncSummary() {
    const status = this.catalogSync.getStatus();
    const loaded = this.catalog.load();
    const configuredModels = this.config.nodes.flatMap((node) =>
      allNodeModels(node).map((model) => ({ node, model })),
    );
    const modelWarnings = configuredModels.map(({ node, model }) => {
      const pricing = this.config.getModelPricing(model, node.id) as
        | (ModelPricing & {
            source?: string;
            source_url?: string;
            pricing_confidence?: string;
            manual_review_required?: boolean;
            pricing_stale?: boolean;
            pricing_used_from?: string;
          })
        | undefined;
      const catalogModel = findCatalogModel(loaded.catalog.providers.flatMap((provider) => provider.models), model, node);
      const hygiene = assessCatalogPricing((pricing || catalogModel?.pricing) as CatalogPricing | undefined, catalogModel?.modalities || ['text']);
      return {
        node_id: node.id,
        model,
        source: pricing?.source || hygiene.source || 'missing',
        source_url: pricing?.source_url || hygiene.source_url || null,
        used_from: pricing?.pricing_used_from || 'missing',
        freshness: hygiene.stale || pricing?.pricing_stale ? 'stale' : pricing ? 'fresh_or_configured' : 'missing',
        review_required: Boolean(pricing?.manual_review_required || hygiene.manual_review_required),
        pricing_confidence: pricing?.pricing_confidence || hygiene.pricing_confidence || null,
        operator_override: pricing?.pricing_used_from === 'node_model_config' || pricing?.pricing_used_from === 'gateway_config',
        auto_trusted: false,
      };
    });
    return {
      enabled: status.enabled,
      scheduled: status.scheduled,
      write_to: status.write_to,
      supported_sources: status.supported_adapters,
      enabled_sources: status.enabled_adapters,
      providers: status.providers,
      configured_model_warnings: modelWarnings.filter((item) =>
        item.freshness === 'stale' ||
        item.freshness === 'missing' ||
        item.review_required ||
        item.pricing_confidence === 'low' ||
        item.pricing_confidence === 'unknown',
      ).slice(0, 50),
      guardrails: {
        explicit_sources_only: true,
        never_overwrite_operator_overrides_silently: true,
        automatic_price_trust: false,
      },
    };
  }

  private async feedbackSummary(window: PeriodWindow) {
    const workspaceId = this.workspaceContext.currentWorkspaceId();
    const qb = this.feedbackRepo
      .createQueryBuilder('feedback')
      .where('feedback.created_at >= :since', { since: window.since })
      .andWhere('feedback.created_at <= :until', { until: window.until })
      .orderBy('feedback.created_at', 'DESC')
      .take(5000);
    applyWorkspaceQueryScope(qb, 'feedback', workspaceId);
    const rows = await qb.getMany();
    const up = rows.filter((row) => row.value === 'up').length;
    const down = rows.filter((row) => row.value === 'down').length;
    return {
      total: rows.length,
      thumbs_up: up,
      thumbs_down: down,
      positive_rate: rows.length > 0 ? round(up / rows.length, 4) : 0,
      by_model: await this.feedbackByRoute(rows, 'model', workspaceId),
      by_node: await this.feedbackByRoute(rows, 'node', workspaceId),
      route_weight_evidence: {
        available: rows.some((row) => Boolean(row.route_weight_evidence_json)),
        applied_to_routing: false,
        privacy_safe_aggregation: true,
      },
    };
  }

  private async feedbackByRoute(rows: RouteFeedback[], dimension: 'model' | 'node', workspaceId: string | null | undefined) {
    const requestIds = [...new Set(rows.map((row) => row.request_id))];
    if (requestIds.length === 0) return [];
    const qb = this.routeDecisionRepo
      .createQueryBuilder('decision')
      .where('decision.request_id IN (:...requestIds)', { requestIds });
    applyWorkspaceQueryScope(qb, 'decision', workspaceId);
    const decisions = await qb.getMany();
    const decisionByRequest = new Map(decisions.map((decision) => [decision.request_id, decision]));
    const groups = new Map<string, { key: string; up: number; down: number; total: number }>();
    for (const feedback of rows) {
      const decision = decisionByRequest.get(feedback.request_id);
      const key =
        dimension === 'model'
          ? decision?.selected_model || 'unknown'
          : decision?.selected_node_id || 'unknown';
      const group = groups.get(key) || { key, up: 0, down: 0, total: 0 };
      group.total += 1;
      if (feedback.value === 'up') group.up += 1;
      else group.down += 1;
      groups.set(key, group);
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        positive_rate: group.total > 0 ? round(group.up / group.total, 4) : 0,
      }))
      .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
      .slice(0, 12);
  }

  private async findDecisionForFeedback(requestId: string, workspaceId: string): Promise<RouteDecisionLog | null> {
    const qb = this.routeDecisionRepo
      .createQueryBuilder('decision')
      .where('decision.request_id = :requestId', { requestId });
    applyWorkspaceQueryScope(qb, 'decision', workspaceId);
    return qb.getOne();
  }

  private async findLogForFeedback(requestId: string, workspaceId: string): Promise<CallLog | null> {
    const qb = this.callLogRepo
      .createQueryBuilder('log')
      .where('log.request_id = :requestId', { requestId });
    applyWorkspaceQueryScope(qb, 'log', workspaceId);
    return qb.getOne();
  }

  private routeWeightEvidence(decision: RouteDecisionLog | null) {
    const trace = parseTrace(decision?.trace_json);
    const selected = trace?.candidate_targets?.find((candidate: any) => candidate.selected);
    return {
      metadata_only: true,
      request_id: decision?.request_id || null,
      selected_node: decision?.selected_node_id || selected?.node || null,
      selected_model: decision?.selected_model || selected?.model || null,
      route_mode: decision?.route_mode || trace?.mode || null,
      strategy: decision?.strategy || null,
      candidate_count: decision?.candidate_count || trace?.candidate_targets?.length || 0,
      selected_weight: selected?.weight ?? null,
      selected_scores: selected?.scores || null,
      optimizer: trace?.intelligence?.optimizer
        ? {
            applied: trace.intelligence.optimizer.applied,
            objective: trace.intelligence.optimizer.objective,
            reason: trace.intelligence.optimizer.reason,
          }
        : null,
    };
  }
}

function createMetrics(): MutableUsageMetrics {
  return {
    requests: 0,
    successful_requests: 0,
    failed_requests: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    estimated_savings_usd: 0,
    fallback_count: 0,
    optimizer_applied: 0,
    quality_gate_failed: 0,
    latency_sum_ms: 0,
  };
}

function accumulateMetrics(metrics: MutableUsageMetrics, row: CallLog): MutableUsageMetrics {
  metrics.requests += 1;
  if (Number(row.status_code || 0) < 400) metrics.successful_requests += 1;
  else metrics.failed_requests += 1;
  metrics.input_tokens += Number(row.input_tokens || 0);
  metrics.output_tokens += Number(row.output_tokens || 0);
  metrics.total_tokens += Number(row.input_tokens || 0) + Number(row.output_tokens || 0);
  metrics.cost_usd += Number(row.cost_usd || 0);
  metrics.estimated_savings_usd += Number(row.intelligence_estimated_savings_usd || 0);
  if (row.is_fallback || row.fallback_reason) metrics.fallback_count += 1;
  if (row.intelligence_optimizer_applied) metrics.optimizer_applied += 1;
  if (row.quality_gate_status === 'failed') metrics.quality_gate_failed += 1;
  metrics.latency_sum_ms += Number(row.latency_ms || 0);
  return metrics;
}

function finalizeMetrics(metrics: MutableUsageMetrics): UsageMetrics {
  return {
    requests: metrics.requests,
    successful_requests: metrics.successful_requests,
    failed_requests: metrics.failed_requests,
    input_tokens: metrics.input_tokens,
    output_tokens: metrics.output_tokens,
    total_tokens: metrics.total_tokens,
    cost_usd: round(metrics.cost_usd, 6),
    estimated_savings_usd: round(metrics.estimated_savings_usd, 6),
    fallback_count: metrics.fallback_count,
    optimizer_applied: metrics.optimizer_applied,
    quality_gate_failed: metrics.quality_gate_failed,
    avg_latency_ms: metrics.requests > 0 ? Math.round(metrics.latency_sum_ms / metrics.requests) : 0,
    success_rate: metrics.requests > 0 ? round(metrics.successful_requests / metrics.requests, 4) : 0,
  };
}

function resolvePeriod(period: string): PeriodWindow {
  const normalized = (period || '30d').trim().toLowerCase();
  const days = normalized === '7d' ? 7 : normalized === '90d' ? 90 : 30;
  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);
  return { label: `${days}d`, days, since, until };
}

function normalizeGroupBy(value: unknown): ChargebackGroupBy {
  return value === 'workspace' ||
    value === 'team' ||
    value === 'project' ||
    value === 'api_key' ||
    value === 'model' ||
    value === 'node'
    ? value
    : 'team';
}

function groupKey(row: CallLog, groupBy: ChargebackGroupBy): string {
  switch (groupBy) {
    case 'workspace':
      return normalizeWorkspaceId(row.workspace_id);
    case 'team':
      return row.team_id || 'unassigned-team';
    case 'project':
      return row.agent_project || 'unassigned-project';
    case 'api_key':
      return row.api_key_id || row.api_key_name || 'unassigned-api-key';
    case 'model':
      return row.model || 'unknown-model';
    case 'node':
      return row.node_id || 'unknown-node';
  }
}

function groupLabel(value: string, groupBy: ChargebackGroupBy): string {
  if (value.startsWith('unassigned')) return value.replace(/-/g, ' ');
  if (groupBy === 'workspace') return `Workspace ${value}`;
  if (groupBy === 'team') return `Team ${value}`;
  if (groupBy === 'project') return `Project ${value}`;
  if (groupBy === 'api_key') return `API key ${value}`;
  if (groupBy === 'node') return `Node ${value}`;
  return value;
}

function enumerateUtcDates(since: Date, until: Date): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  const end = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate()));
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function toUtcDateKey(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function normalizeFeedbackValue(value: unknown): FeedbackValue | null {
  if (value === 'up' || value === 'thumbs_up' || value === true) return 'up';
  if (value === 'down' || value === 'thumbs_down' || value === false) return 'down';
  return null;
}

function sanitizeIdentifier(value: unknown, max = 120): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function parseTrace(value: string | null | undefined): any | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function allNodeModels(node: NodeConfig): string[] {
  return [
    ...(node.models || []),
    ...(node.embedding_models || []),
    ...(node.rerank_models || []),
    ...(node.image_models || []),
    ...(node.audio_models || []),
    ...(node.video_models || []),
    ...(node.realtime_models || []),
  ].filter((value, index, array) => value && array.indexOf(value) === index);
}

function findCatalogModel(
  models: CatalogModel[],
  modelId: string,
  node: NodeConfig,
): CatalogModel | undefined {
  return models.find((model) => model.id === modelId && model.provider === node.id) ||
    models.find((model) => model.id === modelId);
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 80) || 'unknown';
}

function costPlatformPrivacy() {
  return {
    metadata_only: true,
    stores_prompts: false,
    stores_responses: false,
    stores_source_code: false,
    stores_diffs: false,
    stores_tool_payloads: false,
    stores_raw_headers: false,
    stores_provider_keys: false,
    stores_media_bytes: false,
    stores_hidden_reasoning: false,
    exports_content: false,
  };
}
