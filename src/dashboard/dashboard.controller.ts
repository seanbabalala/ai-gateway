// ===================================================================
// DashboardController — Dashboard REST API + SSE
// ===================================================================
// Endpoints:
//   GET  /api/dashboard/stats     — Aggregated statistics
//   GET  /api/dashboard/logs      — Recent call logs (paginated)
//   GET  /api/dashboard/logs/sse  — Real-time SSE log stream
//   GET  /api/dashboard/budget    — Budget status + management
//   POST /api/dashboard/budget/:id/reset — Reset a budget rule
//   GET  /api/dashboard/config    — Gateway configuration (sanitized)
//   POST /api/dashboard/config/reload — Hot-reload config
//   GET  /api/dashboard/nodes     — Node health + circuit status
//   POST /api/dashboard/nodes/test — Test node connectivity
//   POST /api/dashboard/nodes     — Create a new node
//   PUT  /api/dashboard/nodes/:id — Update an existing node
//   DELETE /api/dashboard/nodes/:id — Delete a node
//   POST /api/dashboard/nodes/:id/reset — Reset node circuit breaker
// ===================================================================

import {
  Controller, Get, Post, Put, Delete, Param, Query, Body, Sse, Logger, Res,
  MessageEvent, ParseIntPipe, DefaultValuePipe, HttpException, HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { Observable, interval, map, merge } from 'rxjs';
import { ConfigService } from '../config/config.service';
import { CapabilityService } from '../config/capability.service';
import { CircuitBreakerService, CircuitState } from '../routing/circuit-breaker.service';
import { ActiveHealthProbeService } from '../routing/active-health-probe.service';
import { BudgetService } from '../budget/budget.service';
import { CallLog } from '../database/entities/call-log.entity';
import { LogEventBus } from './log-event-bus';
import { CreateNodeDto, UpdateNodeDto, TestNodeDto } from './dto/node.dto';
import { DashboardGuard } from '../auth/dashboard.guard';
import { PromptCacheService } from '../cache/prompt-cache.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import type { Modality } from '../config/modality';
import {
  CreateGatewayApiKeyDto,
  GatewayApiKeyService,
  UpdateGatewayApiKeyDto,
} from '../auth/gateway-api-key.service';

@Controller('api/dashboard')
@UseGuards(DashboardGuard)
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly capabilityService: CapabilityService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly activeHealth: ActiveHealthProbeService,
    private readonly budgetService: BudgetService,
    private readonly cacheService: PromptCacheService,
    private readonly logEventBus: LogEventBus,
    private readonly telemetry: TelemetryService,
    private readonly gatewayApiKeys: GatewayApiKeyService,
    private readonly dataSource: DataSource,
    @InjectRepository(CallLog)
    private readonly callLogRepo: Repository<CallLog>,
  ) {
    // Run log cleanup on startup
    this.cleanupOldLogs().catch(() => {});
  }

  /** Delete logs older than log_retention_days (default: 30) */
  private async cleanupOldLogs(): Promise<void> {
    const retentionDays = this.config.database.log_retention_days ?? 30;
    if (retentionDays <= 0) return;

    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const result = await this.callLogRepo
      .createQueryBuilder()
      .delete()
      .where('timestamp < :cutoff', { cutoff })
      .execute();

    if (result.affected && result.affected > 0) {
      this.logger.log(`Log cleanup: deleted ${result.affected} logs older than ${retentionDays} days`);
    }
  }

  /** Return a SQL expression that truncates a timestamp column to YYYY-MM-DD string */
  private dateTruncDay(column: string): string {
    if (this.dataSource.options.type === 'postgres') {
      return `TO_CHAR(${column}, 'YYYY-MM-DD')`;
    }
    return `strftime('%Y-%m-%d', ${column})`;
  }

  private apiKeyWhere(apiKey?: string, apiKeyId?: string): FindOptionsWhere<CallLog> | undefined {
    if (apiKeyId) return { api_key_id: apiKeyId };
    if (apiKey) return { api_key_name: apiKey };
    return undefined;
  }

  private applyApiKeyLogFilter<T extends { where: Function; andWhere: Function }>(
    qb: T,
    apiKey?: string,
    apiKeyId?: string,
    method: 'where' | 'andWhere' = 'andWhere',
  ): T {
    if (apiKeyId) {
      qb[method]('log.api_key_id = :apiKeyId', { apiKeyId });
    } else if (apiKey) {
      qb[method]('log.api_key_name = :apiKey', { apiKey });
    }
    return qb;
  }

  // ══════════════════════════════════════════════════════
  // Cost Analytics
  // ══════════════════════════════════════════════════════

  @Get('analytics/cost')
  async getCostAnalytics(
    @Query('period') period: string = '7d',
    @Query('groupBy') groupBy: string = 'model',
    @Query('api_key') apiKey?: string,
    @Query('api_key_id') apiKeyId?: string,
  ) {
    // Parse period
    const periodDays = period === '90d' ? 90 : period === '30d' ? 30 : 7;
    const since = new Date(Date.now() - periodDays * 86_400_000);

    // Daily cost trend
    const dailyTrendQb = this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since })
      .select(this.dateTruncDay('log.timestamp'), 'date')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('SUM(log.cost_usd)', 'cost')
      .addSelect('SUM(log.input_tokens)', 'inputTokens')
      .addSelect('SUM(log.output_tokens)', 'outputTokens')
      .groupBy('date')
      .orderBy('date', 'ASC');
    this.applyApiKeyLogFilter(dailyTrendQb, apiKey, apiKeyId);
    const dailyTrend = await dailyTrendQb.getRawMany();

    // Group by model
    const byModelQb = this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since })
      .select('log.model', 'model')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('SUM(log.cost_usd)', 'cost')
      .addSelect('SUM(log.input_tokens)', 'inputTokens')
      .addSelect('SUM(log.output_tokens)', 'outputTokens')
      .addSelect('AVG(log.latency_ms)', 'avgLatency')
      .groupBy('log.model')
      .orderBy('cost', 'DESC');
    this.applyApiKeyLogFilter(byModelQb, apiKey, apiKeyId);
    const byModel = await byModelQb.getRawMany();

    // Group by node
    const byNodeQb = this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since })
      .select('log.node_id', 'nodeId')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('SUM(log.cost_usd)', 'cost')
      .addSelect('SUM(log.input_tokens)', 'inputTokens')
      .addSelect('SUM(log.output_tokens)', 'outputTokens')
      .addSelect('AVG(log.latency_ms)', 'avgLatency')
      .groupBy('log.node_id')
      .orderBy('cost', 'DESC');
    this.applyApiKeyLogFilter(byNodeQb, apiKey, apiKeyId);
    const byNode = await byNodeQb.getRawMany();

    // Group by tier
    const byTierQb = this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since })
      .select('log.tier', 'tier')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('SUM(log.cost_usd)', 'cost')
      .addSelect('SUM(log.input_tokens)', 'inputTokens')
      .addSelect('SUM(log.output_tokens)', 'outputTokens')
      .groupBy('log.tier')
      .orderBy('cost', 'DESC');
    this.applyApiKeyLogFilter(byTierQb, apiKey, apiKeyId);
    const byTier = await byTierQb.getRawMany();

    // Total for the period
    const totalQb = this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since })
      .select('COUNT(*)', 'calls')
      .addSelect('SUM(log.cost_usd)', 'cost')
      .addSelect('SUM(log.input_tokens)', 'inputTokens')
      .addSelect('SUM(log.output_tokens)', 'outputTokens')
      .addSelect('AVG(log.cost_usd)', 'avgCostPerCall')
      .addSelect('SUM(log.cache_creation_input_tokens)', 'cacheCreationTokens')
      .addSelect('SUM(log.cache_read_input_tokens)', 'cacheReadTokens');
    this.applyApiKeyLogFilter(totalQb, apiKey, apiKeyId);
    const totalAgg = await totalQb.getRawOne();

    return {
      period: periodDays,
      total: {
        calls: Number(totalAgg?.calls || 0),
        cost: Number(Number(totalAgg?.cost || 0).toFixed(6)),
        inputTokens: Number(totalAgg?.inputTokens || 0),
        outputTokens: Number(totalAgg?.outputTokens || 0),
        avgCostPerCall: Number(Number(totalAgg?.avgCostPerCall || 0).toFixed(6)),
        cacheCreationTokens: Number(totalAgg?.cacheCreationTokens || 0),
        cacheReadTokens: Number(totalAgg?.cacheReadTokens || 0),
      },
      dailyTrend: dailyTrend.map((d) => ({
        date: d.date,
        calls: Number(d.calls),
        cost: Number(Number(d.cost || 0).toFixed(6)),
        inputTokens: Number(d.inputTokens || 0),
        outputTokens: Number(d.outputTokens || 0),
      })),
      byModel: byModel.map((m) => ({
        model: m.model,
        calls: Number(m.calls),
        cost: Number(Number(m.cost || 0).toFixed(6)),
        inputTokens: Number(m.inputTokens || 0),
        outputTokens: Number(m.outputTokens || 0),
        avgLatency: Number(Number(m.avgLatency || 0).toFixed(0)),
        avgCostPerCall: Number(m.calls) > 0
          ? Number((Number(m.cost || 0) / Number(m.calls)).toFixed(6))
          : 0,
      })),
      byNode: byNode.map((n) => ({
        nodeId: n.nodeId,
        calls: Number(n.calls),
        cost: Number(Number(n.cost || 0).toFixed(6)),
        inputTokens: Number(n.inputTokens || 0),
        outputTokens: Number(n.outputTokens || 0),
        avgLatency: Number(Number(n.avgLatency || 0).toFixed(0)),
        avgCostPerCall: Number(n.calls) > 0
          ? Number((Number(n.cost || 0) / Number(n.calls)).toFixed(6))
          : 0,
      })),
      byTier: byTier.map((t) => ({
        tier: t.tier,
        calls: Number(t.calls),
        cost: Number(Number(t.cost || 0).toFixed(6)),
        inputTokens: Number(t.inputTokens || 0),
        outputTokens: Number(t.outputTokens || 0),
      })),
    };
  }

  // ══════════════════════════════════════════════════════
  // Experiment Analytics (A/B Split)
  // ══════════════════════════════════════════════════════

  @Get('analytics/experiment')
  async getExperimentAnalytics(
    @Query('period') period: string = '7d',
    @Query('tier') tier?: string,
    @Query('api_key') apiKey?: string,
    @Query('api_key_id') apiKeyId?: string,
  ) {
    const periodDays = period === '90d' ? 90 : period === '30d' ? 30 : 7;
    const since = new Date(Date.now() - periodDays * 86_400_000);

    // 1. Aggregate by experiment_group
    let qb = this.callLogRepo.createQueryBuilder('log')
      .where('log.timestamp >= :since', { since })
      .andWhere('log.experiment_group IS NOT NULL');
    if (tier) {
      qb = qb.andWhere('log.tier = :tier', { tier });
    }
    qb = this.applyApiKeyLogFilter(qb, apiKey, apiKeyId);

    const byGroup = await qb
      .select('log.experiment_group', 'experimentGroup')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('SUM(log.cost_usd)', 'totalCost')
      .addSelect('AVG(log.cost_usd)', 'avgCost')
      .addSelect('AVG(log.latency_ms)', 'avgLatency')
      .addSelect('SUM(log.input_tokens + log.output_tokens)', 'totalTokens')
      .addSelect(`SUM(CASE WHEN log.status_code < 400 THEN 1 ELSE 0 END)`, 'successCount')
      .groupBy('log.experiment_group')
      .getRawMany();

    // 2. Daily trend by experiment_group × date
    let trendQb = this.callLogRepo.createQueryBuilder('log')
      .where('log.timestamp >= :since', { since })
      .andWhere('log.experiment_group IS NOT NULL');
    if (tier) {
      trendQb = trendQb.andWhere('log.tier = :tier', { tier });
    }
    trendQb = this.applyApiKeyLogFilter(trendQb, apiKey, apiKeyId);

    const dailyTrend = await trendQb
      .select(this.dateTruncDay('log.timestamp'), 'date')
      .addSelect('log.experiment_group', 'experimentGroup')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('AVG(log.latency_ms)', 'avgLatency')
      .addSelect('AVG(log.cost_usd)', 'avgCost')
      .groupBy('date')
      .addGroupBy('log.experiment_group')
      .orderBy('date', 'ASC')
      .getRawMany();

    // 3. Active split configurations
    const activeSplits: Record<string, unknown> = {};
    for (const [t, tc] of Object.entries(this.config.routing.tiers)) {
      if ((tc as any).split) {
        activeSplits[t] = (tc as any).split;
      }
    }

    return {
      byGroup: byGroup.map((g) => ({
        experimentGroup: g.experimentGroup,
        calls: Number(g.calls),
        totalCost: Number(Number(g.totalCost || 0).toFixed(6)),
        avgCost: Number(Number(g.avgCost || 0).toFixed(6)),
        avgLatency: Number(Number(g.avgLatency || 0).toFixed(0)),
        totalTokens: Number(g.totalTokens || 0),
        successCount: Number(g.successCount || 0),
        successRate: Number(g.calls) > 0
          ? Number(((Number(g.successCount || 0) / Number(g.calls)) * 100).toFixed(1))
          : 0,
      })),
      dailyTrend: dailyTrend.map((d) => ({
        date: d.date,
        experimentGroup: d.experimentGroup,
        calls: Number(d.calls),
        avgLatency: Number(Number(d.avgLatency || 0).toFixed(0)),
        avgCost: Number(Number(d.avgCost || 0).toFixed(6)),
      })),
      activeSplits,
      period: periodDays,
    };
  }

  // ══════════════════════════════════════════════════════
  // Stats
  // ══════════════════════════════════════════════════════

  @Get('stats')
  async getStats(
    @Query('api_key') apiKey?: string,
    @Query('api_key_id') apiKeyId?: string,
  ) {
    const keyWhere = this.apiKeyWhere(apiKey, apiKeyId);
    const totalCalls = keyWhere
      ? await this.callLogRepo.count({ where: keyWhere })
      : await this.callLogRepo.count();
    const successCalls = keyWhere
      ? await this.callLogRepo.count({ where: { status_code: 200, ...keyWhere } })
      : await this.callLogRepo.count({ where: { status_code: 200 } });
    const failedCalls = totalCalls - successCalls;

    // Aggregations via raw query (works for both SQLite and Postgres)
    const aggQb = this.callLogRepo
      .createQueryBuilder('log')
      .select('SUM(log.input_tokens)', 'totalInputTokens')
      .addSelect('SUM(log.output_tokens)', 'totalOutputTokens')
      .addSelect('SUM(log.cost_usd)', 'totalCost')
      .addSelect('AVG(log.latency_ms)', 'avgLatency')
      .addSelect('COUNT(DISTINCT log.session_key)', 'uniqueSessions')
      .addSelect('SUM(log.cache_creation_input_tokens)', 'cacheCreationTokens')
      .addSelect('SUM(log.cache_read_input_tokens)', 'cacheReadTokens');
    this.applyApiKeyLogFilter(aggQb, apiKey, apiKeyId, 'where');
    const agg = await aggQb.getRawOne();

    // Tier distribution
    const tierQb = this.callLogRepo
      .createQueryBuilder('log')
      .select('log.tier', 'tier')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.tier');
    this.applyApiKeyLogFilter(tierQb, apiKey, apiKeyId, 'where');
    const tierDist = await tierQb.getRawMany();

    // Node distribution
    const nodeQb = this.callLogRepo
      .createQueryBuilder('log')
      .select('log.node_id', 'nodeId')
      .addSelect('COUNT(*)', 'count')
      .addSelect('AVG(log.latency_ms)', 'avgLatency')
      .groupBy('log.node_id');
    this.applyApiKeyLogFilter(nodeQb, apiKey, apiKeyId, 'where');
    const nodeDist = await nodeQb.getRawMany();

    // Last 24h stats
    const oneDayAgo = new Date(Date.now() - 86_400_000);
    const recentQb = this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since: oneDayAgo })
      .select('COUNT(*)', 'calls')
      .addSelect('SUM(log.cost_usd)', 'cost')
      .addSelect('SUM(log.input_tokens + log.output_tokens)', 'tokens');
    this.applyApiKeyLogFilter(recentQb, apiKey, apiKeyId);
    const recentAgg = await recentQb.getRawOne();

    return {
      total: {
        calls: totalCalls,
        success: successCalls,
        failed: failedCalls,
        successRate: totalCalls > 0 ? Number(((successCalls / totalCalls) * 100).toFixed(1)) : 0,
        inputTokens: Number(agg?.totalInputTokens || 0),
        outputTokens: Number(agg?.totalOutputTokens || 0),
        totalTokens: Number(agg?.totalInputTokens || 0) + Number(agg?.totalOutputTokens || 0),
        costUsd: Number(Number(agg?.totalCost || 0).toFixed(6)),
        avgLatencyMs: Number(Number(agg?.avgLatency || 0).toFixed(0)),
        uniqueSessions: Number(agg?.uniqueSessions || 0),
        cacheCreationTokens: Number(agg?.cacheCreationTokens || 0),
        cacheReadTokens: Number(agg?.cacheReadTokens || 0),
      },
      last24h: {
        calls: Number(recentAgg?.calls || 0),
        costUsd: Number(Number(recentAgg?.cost || 0).toFixed(6)),
        tokens: Number(recentAgg?.tokens || 0),
      },
      tierDistribution: tierDist.map((t) => ({
        tier: t.tier,
        count: Number(t.count),
      })),
      nodeDistribution: nodeDist.map((n) => ({
        nodeId: n.nodeId,
        count: Number(n.count),
        avgLatencyMs: Number(Number(n.avgLatency || 0).toFixed(0)),
      })),
    };
  }

  // ══════════════════════════════════════════════════════
  // Call Logs (paginated)
  // ══════════════════════════════════════════════════════

  @Get('logs')
  async getLogs(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('tier') tier?: string,
    @Query('node') node?: string,
    @Query('status') status?: string,
    @Query('api_key') apiKey?: string,
    @Query('api_key_id') apiKeyId?: string,
  ) {
    const qb = this.callLogRepo
      .createQueryBuilder('log')
      .orderBy('log.timestamp', 'DESC');

    if (tier) qb.andWhere('log.tier = :tier', { tier });
    if (node) qb.andWhere('log.node_id = :node', { node });
    if (status) qb.andWhere('log.status_code = :status', { status: Number(status) });
    this.applyApiKeyLogFilter(qb, apiKey, apiKeyId);

    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const safePage = Math.max(page, 1);

    const [logs, total] = await qb
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getManyAndCount();

    return {
      data: logs,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  // ── Log Export ──────────────────────────────────────────

  @Get('logs/export')
  async exportLogs(
    @Query('format') format: string = 'csv',
    @Query('days', new DefaultValuePipe(7), ParseIntPipe) days: number,
    @Query('api_key') apiKey: string | undefined,
    @Query('api_key_id') apiKeyId: string | undefined,
    @Res() res: Response,
  ) {
    const safeDays = Math.min(Math.max(days, 1), 365);
    const since = new Date(Date.now() - safeDays * 86_400_000);

    const qb = this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since })
      .orderBy('log.timestamp', 'DESC');
    this.applyApiKeyLogFilter(qb, apiKey, apiKeyId);
    const logs = await qb.getMany();

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="logs-${safeDays}d.json"`);
      res.send(JSON.stringify(logs, null, 2));
      return;
    }

    // CSV
    const headers = [
      'timestamp', 'request_id', 'tier', 'score', 'node_id', 'model',
      'source_format', 'input_tokens', 'output_tokens', 'cost_usd',
      'latency_ms', 'status_code', 'is_fallback', 'session_key',
      'api_key_id', 'api_key_name', 'retry_count', 'error',
    ];
    const csvRows = [headers.join(',')];

    for (const log of logs) {
      const row = headers.map((h) => {
        const val = (log as unknown as Record<string, unknown>)[h];
        if (val === null || val === undefined) return '';
        const str = String(val);
        // Escape CSV fields containing commas/quotes/newlines
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      });
      csvRows.push(row.join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="logs-${safeDays}d.csv"`);
    res.send(csvRows.join('\n'));
  }

  // ══════════════════════════════════════════════════════
  // SSE — Real-time Log Stream
  // ══════════════════════════════════════════════════════

  @Sse('logs/sse')
  streamLogs(): Observable<MessageEvent> {
    // Heartbeat every 30s to keep connection alive
    const heartbeat$ = interval(30_000).pipe(
      map(() => ({ data: { type: 'heartbeat', timestamp: new Date().toISOString() } }) as MessageEvent),
    );

    // New log events from the shared event bus
    const logs$ = this.logEventBus.events$.pipe(
      map((log) => ({ data: { type: 'log', log } }) as MessageEvent),
    );

    // Send an initial connected event
    const connected$ = new Observable<MessageEvent>((subscriber) => {
      subscriber.next({
        data: { type: 'connected', timestamp: new Date().toISOString() },
      } as MessageEvent);
    });

    return merge(connected$, logs$, heartbeat$);
  }

  // ══════════════════════════════════════════════════════
  // Budget
  // ══════════════════════════════════════════════════════

  @Get('budget')
  async getBudget(
    @Query('api_key') apiKey?: string,
    @Query('api_key_id') apiKeyId?: string,
  ) {
    if (apiKey || apiKeyId) {
      const globalStatus = await this.budgetService.getStatus();
      const keyStatus = await this.budgetService.getStatus(apiKey || null, apiKeyId || null);
      return {
        rules: globalStatus.map((s) => this.serializeBudgetStatus(s)),
        perKeyRules: keyStatus.map((s) => this.serializeBudgetStatus(s)),
        apiKeyName: keyStatus[0]?.apiKeyName || apiKey || null,
        apiKeyId: keyStatus[0]?.apiKeyId || apiKeyId || null,
      };
    }
    // Backward-compatible: no api_key → global rules only
    const status = await this.budgetService.getStatus();
    return {
      rules: status.map((s) => this.serializeBudgetStatus(s)),
    };
  }

  private serializeBudgetStatus(s: {
    id: number;
    type: string;
    scope: 'global' | 'api_key';
    apiKeyName: string | null;
    apiKeyId: string | null;
    limit: number;
    current: number;
    percentage: number;
    isExceeded: boolean;
    isAlert: boolean;
    periodStart: Date;
    resetAt: Date | null;
  }) {
    return {
      id: s.id,
      type: s.type,
      scope: s.scope,
      apiKeyName: s.apiKeyName,
      apiKeyId: s.apiKeyId,
      limit: s.limit,
      current: this.serializeBudgetCurrent(s.type, s.current),
      percentage: Number((s.percentage * 100).toFixed(1)),
      exceeded: s.isExceeded,
      alert: s.isAlert,
      periodStart: s.periodStart,
      resetAt: s.resetAt,
    };
  }

  private serializeBudgetCurrent(type: string, current: number): number {
    return Number(current.toFixed(type.includes('cost') ? 6 : 4));
  }

  @Get('budget/keys')
  async getBudgetKeys() {
    const budgetKeys = await this.budgetService.getKeysWithBudgets();
    const generatedKeys = await this.gatewayApiKeys.list();
    return {
      keys: [...new Set([
        ...budgetKeys,
        ...generatedKeys.map((key) => key.name),
      ])],
      items: generatedKeys.map((key) => ({
        id: key.id,
        name: key.name,
        key_prefix: key.key_prefix,
        daily_token_limit: key.daily_token_limit,
        daily_cost_limit: key.daily_cost_limit,
        rate_limit_per_minute: key.rate_limit_per_minute,
      })),
    };
  }

  @Get('api-keys')
  async getApiKeyNames() {
    const items = await this.gatewayApiKeys.list();
    return {
      keys: items.map((key) => key.name),
      items,
    };
  }

  @Post('api-keys')
  async createApiKey(@Body() body: CreateGatewayApiKeyDto) {
    const created = await this.gatewayApiKeys.create(body);
    return {
      success: true,
      message: 'Gateway API key created',
      key: created.key,
      item: created.item,
    };
  }

  @Put('api-keys/:id')
  async updateApiKey(
    @Param('id') id: string,
    @Body() body: UpdateGatewayApiKeyDto,
  ) {
    return {
      success: true,
      message: 'Gateway API key updated',
      item: await this.gatewayApiKeys.update(id, body),
    };
  }

  @Post('api-keys/:id/rotate')
  async rotateApiKey(@Param('id') id: string) {
    const rotated = await this.gatewayApiKeys.rotate(id);
    return {
      success: true,
      message: 'Gateway API key rotated',
      key: rotated.key,
      item: rotated.item,
    };
  }

  @Delete('api-keys/:id')
  async deleteApiKey(@Param('id') id: string) {
    await this.gatewayApiKeys.remove(id);
    return { success: true, message: 'Gateway API key deleted' };
  }

  @Post('budget/:id/reset')
  async resetBudget(@Param('id', ParseIntPipe) id: number) {
    await this.budgetService.resetRule(id);
    return { success: true, message: `Budget rule ${id} reset` };
  }

  // ══════════════════════════════════════════════════════
  // Cache
  // ══════════════════════════════════════════════════════

  @Get('cache')
  getCacheStats() {
    return this.cacheService.getStats();
  }

  @Post('cache/clear')
  clearCache() {
    this.cacheService.clear();
    return { success: true, message: 'Cache cleared' };
  }

  // ══════════════════════════════════════════════════════
  // Telemetry Status
  // ══════════════════════════════════════════════════════

  @Get('telemetry-status')
  getTelemetryStatus() {
    const fullConfig = this.config.getFullConfig();
    const telemetryCfg = fullConfig.telemetry;
    const enabled = telemetryCfg?.enabled === true;

    return {
      enabled,
      active: enabled, // active = SDK was initialized (enabled at boot time)
      config: enabled
        ? {
            service_name: telemetryCfg?.service_name || 'siftgate',
            traces_endpoint: telemetryCfg?.traces?.endpoint || 'http://localhost:4318/v1/traces',
            sample_rate: telemetryCfg?.traces?.sample_rate ?? 1.0,
            prometheus_port: telemetryCfg?.metrics?.prometheus_port || 9464,
            otlp_metrics_endpoint: telemetryCfg?.metrics?.otlp_endpoint || null,
          }
        : null,
    };
  }

  // ══════════════════════════════════════════════════════
  // Configuration
  // ══════════════════════════════════════════════════════

  @Get('config')
  getConfig() {
    const full = this.config.getFullConfig();

    // Sanitize: mask API keys
    const sanitizedNodes = full.nodes.map((node) => ({
      ...node,
      api_key: node.api_key ? `${node.api_key.substring(0, 8)}...` : '[not set]',
    }));

    const sanitizedAuth = {
      api_keys: [],
      managed_in_dashboard: true,
    };

    return {
      server: full.server,
      database: { type: full.database.type },
      auth: sanitizedAuth,
      nodes: sanitizedNodes,
      routing: full.routing,
      budget: full.budget,
      models_pricing: full.models_pricing,
      diagnostics: this.config.getNodeModelDiagnostics(),
    };
  }

  @Post('config/reload')
  reloadConfig() {
    try {
      this.config.reload();
      this.activeHealth.refreshSchedules();
      return { success: true, message: 'Configuration reloaded' };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }

  // ══════════════════════════════════════════════════════
  // Capabilities
  // ══════════════════════════════════════════════════════

  /** Get all capability definitions */
  @Get('capabilities')
  getCapabilities() {
    return { capabilities: this.capabilityService.getRegistry() };
  }

  /** Recommend tier suitability given a set of capabilities */
  @Post('capabilities/recommend-tiers')
  recommendTiers(@Body() body: { capabilities: string[] }) {
    const capabilities = body.capabilities || [];
    return { recommendations: this.capabilityService.recommendTiers(capabilities) };
  }

  /** Recommend full routing config based on all nodes' capabilities */
  @Post('routing/recommend')
  recommendRouting() {
    return { recommendations: this.capabilityService.recommendRouting() };
  }

  /** Update routing configuration (tiers, scoring, domain preferences) */
  @Put('routing')
  updateRouting(@Body() body: {
    tiers?: Record<string, { primary: { node: string; model: string }; fallbacks: { node: string; model: string }[] }>;
    scoring?: { simple_max: number; standard_max: number; complex_max: number };
    domain_preferences?: Record<string, string[]>;
  }) {
    try {
      this.config.updateRouting(body);
      return { success: true, message: 'Routing configuration updated' };
    } catch (err) {
      throw new HttpException(
        { success: false, message: (err as Error).message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ══════════════════════════════════════════════════════
  // Nodes
  // ══════════════════════════════════════════════════════

  @Get('nodes')
  getNodes() {
    const nodes = this.config.nodes.map((node) => {
      const cbStatus = this.circuitBreaker.getNodeStatus(node.id);
      const modelStatuses = this.circuitBreaker.getModelStatuses(node.id);
      const activeProbe = this.activeHealth.getNodeStatus(node.id);

      // Build per-model circuit info
      const modelCircuits: Record<string, {
        state: string;
        consecutiveFailures: number;
        lastFailureAt: string | null;
      }> = {};
      for (const [model, ms] of Object.entries(modelStatuses)) {
        modelCircuits[model] = {
          state: ms.state,
          consecutiveFailures: ms.consecutiveFailures,
          lastFailureAt: ms.lastFailureAt
            ? new Date(ms.lastFailureAt).toISOString()
            : null,
        };
      }

      return {
        id: node.id,
        name: node.name,
        protocol: node.protocol,
        base_url: node.base_url,
        endpoint: node.endpoint,
        models: node.models,
        capabilities: this.capabilityService.getNodeCapabilities(node.id),
        modalities: this.capabilityService.resolveNodeModalities(node.id),
        tags: node.tags || [],
        aliases: node.model_aliases || {},
        model_prefixes: node.model_prefixes || [],
        circuit: {
          state: cbStatus.state,
          consecutiveFailures: cbStatus.consecutiveFailures,
          lastFailureAt: cbStatus.lastFailureAt
            ? new Date(cbStatus.lastFailureAt).toISOString()
            : null,
        },
        modelCircuits,
        active_probe: activeProbe,
        healthy: cbStatus.state !== CircuitState.OPEN && activeProbe.status !== 'unhealthy',
      };
    });

    return {
      nodes,
      diagnostics: this.config.getNodeModelDiagnostics(),
    };
  }

  // ── Node Connectivity Test ─────────────────────────────

  /** Test a new node before saving (provide all params) */
  @Post('nodes/test')
  async testNodeConnectivity(@Body() dto: TestNodeDto) {
    return this.runConnectivityTest({
      protocol: dto.protocol,
      base_url: dto.base_url,
      endpoint: dto.endpoint,
      api_key: dto.api_key,
      model: dto.model,
      auth_type: dto.auth_type,
      headers: dto.headers,
    });
  }

  /** Test an existing node using its saved config (no need to re-enter API key) */
  @Post('nodes/:id/test')
  async testExistingNode(@Param('id') nodeId: string) {
    const node = this.config.getNode(nodeId);
    if (!node) {
      throw new HttpException(
        { success: false, message: `Node "${nodeId}" not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    return this.runConnectivityTest({
      protocol: node.protocol,
      base_url: node.base_url,
      endpoint: node.endpoint,
      api_key: node.api_key,
      model: node.models[0],
      auth_type: node.auth_type,
      headers: node.headers,
    });
  }

  @Post('nodes/:id/reset')
  resetNodeCircuit(@Param('id') nodeId: string, @Query('model') model?: string) {
    if (model) {
      this.circuitBreaker.reset(nodeId, model);
      return { success: true, message: `Circuit breaker reset for "${nodeId}:${model}"` };
    }
    this.circuitBreaker.reset(nodeId);
    return { success: true, message: `Circuit breaker reset for node "${nodeId}"` };
  }

  // ── Private: shared connectivity test logic ────────────

  private async runConnectivityTest(params: {
    protocol: string;
    base_url: string;
    endpoint: string;
    api_key: string;
    model: string;
    auth_type?: string;
    headers?: Record<string, string>;
  }) {
    const { protocol, base_url, endpoint, api_key, model, auth_type, headers: extraHeaders } = params;
    const url = `${base_url.replace(/\/+$/, '')}${endpoint}`;

    // Build auth headers
    const resolvedAuthType = auth_type || (protocol === 'messages' ? 'x-api-key' : 'bearer');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (resolvedAuthType === 'x-api-key') {
      headers['x-api-key'] = api_key;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${api_key}`;
    }

    if (extraHeaders) {
      Object.assign(headers, extraHeaders);
    }

    // Build minimal request body per protocol (small max_tokens to minimize cost)
    let body: Record<string, unknown>;
    if (protocol === 'messages') {
      body = {
        model,
        stream: false,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
      };
    } else if (protocol === 'responses') {
      body = {
        model,
        stream: false,
        max_output_tokens: 16,
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
        ],
      };
    } else {
      // chat_completions
      body = {
        model,
        stream: false,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
      };
    }

    const startTime = Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 15_000);
      timeout.unref?.();

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      timeout = undefined;

      const latencyMs = Date.now() - startTime;
      const responseText = await response.text().catch(() => '');

      if (response.ok) {
        return {
          success: true,
          status: response.status,
          latency_ms: latencyMs,
          message: `Connected successfully (${latencyMs}ms)`,
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          status: response.status,
          latency_ms: latencyMs,
          message: `Authentication failed (${response.status}). Check your API key.`,
        };
      }

      if (response.status === 404) {
        return {
          success: false,
          status: response.status,
          latency_ms: latencyMs,
          message: `Endpoint not found (404). Check base URL and endpoint path.`,
        };
      }

      if (response.status === 400 || response.status === 422) {
        const lower = responseText.toLowerCase();
        if (lower.includes('model') && (lower.includes('not found') || lower.includes('not exist') || lower.includes('invalid'))) {
          return {
            success: false,
            status: response.status,
            latency_ms: latencyMs,
            message: `Connected, but model "${model}" was not recognized by the provider.`,
          };
        }
        return {
          success: true,
          status: response.status,
          latency_ms: latencyMs,
          message: `Connected (${latencyMs}ms). Provider returned ${response.status} — may need config tuning.`,
        };
      }

      if (response.status === 429) {
        return {
          success: true,
          status: response.status,
          latency_ms: latencyMs,
          message: `Connected (${latencyMs}ms). Rate limited — API key is valid but quota exceeded.`,
        };
      }

      return {
        success: false,
        status: response.status,
        latency_ms: latencyMs,
        message: `Provider returned HTTP ${response.status}: ${responseText.substring(0, 200)}`,
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const errMsg = (err as Error).message || 'Unknown error';
      const cause = (err as Record<string, unknown>)?.cause as Record<string, unknown> | undefined;
      const causeMsg = (cause?.message as string) || '';
      const causeCode = (cause?.code as string) || '';
      const fullMsg = `${errMsg} ${causeMsg} ${causeCode}`.toLowerCase();

      if (fullMsg.includes('abort') || fullMsg.includes('timeout')) {
        return { success: false, status: 0, latency_ms: latencyMs, message: `Connection timed out after 15s. Check the URL is reachable.` };
      }
      if (fullMsg.includes('enotfound') || fullMsg.includes('getaddrinfo')) {
        return { success: false, status: 0, latency_ms: latencyMs, message: `DNS resolution failed. The hostname could not be found.` };
      }
      if (fullMsg.includes('econnrefused')) {
        return { success: false, status: 0, latency_ms: latencyMs, message: `Connection refused. The server is not accepting connections.` };
      }
      if (fullMsg.includes('ssl') || fullMsg.includes('cert') || fullMsg.includes('tls')) {
        return { success: false, status: 0, latency_ms: latencyMs, message: `SSL/TLS error. Check if the URL requires HTTPS or has a valid certificate.` };
      }

      return { success: false, status: 0, latency_ms: latencyMs, message: `Connection error: ${causeMsg || causeCode || errMsg}` };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  // ── Node CRUD ──────────────────────────────────────────

  @Post('nodes')
  createNode(@Body() dto: CreateNodeDto) {
    try {
      this.config.addNode({
        id: dto.id,
        name: dto.name,
        protocol: dto.protocol,
        base_url: dto.base_url,
        endpoint: dto.endpoint,
        api_key: dto.api_key,
        models: dto.models,
        timeout_ms: dto.timeout_ms,
        capabilities: dto.capabilities,
        modalities: dto.modalities as Modality[] | undefined,
        tags: dto.tags,
        model_aliases: dto.model_aliases,
        model_prefixes: dto.model_prefixes,
        headers: dto.headers,
        auth_type: dto.auth_type,
        health_check: dto.health_check,
      });
      this.activeHealth.refreshSchedules();
      return { success: true, message: `Node "${dto.id}" created` };
    } catch (err) {
      throw new HttpException(
        { success: false, message: (err as Error).message },
        HttpStatus.CONFLICT,
      );
    }
  }

  @Put('nodes/:id')
  updateNode(@Param('id') nodeId: string, @Body() dto: UpdateNodeDto) {
    try {
      // Keep omitted fields intact. class-transformer may materialize optional
      // DTO properties as undefined, so strip them before merging into config.
      const updates: Partial<typeof dto> = {};
      for (const [key, value] of Object.entries(dto) as [keyof UpdateNodeDto, unknown][]) {
        if (value === undefined || value === '') continue;
        (updates as Record<string, unknown>)[key] = value;
      }
      this.config.updateNode(nodeId, updates as Parameters<typeof this.config.updateNode>[1]);
      this.activeHealth.refreshSchedules();
      return { success: true, message: `Node "${nodeId}" updated` };
    } catch (err) {
      throw new HttpException(
        { success: false, message: (err as Error).message },
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Delete('nodes/:id')
  deleteNode(@Param('id') nodeId: string) {
    try {
      // Reset circuit breaker for the node before deleting
      this.circuitBreaker.reset(nodeId);
      this.config.deleteNode(nodeId);
      this.activeHealth.refreshSchedules();
      return { success: true, message: `Node "${nodeId}" deleted` };
    } catch (err) {
      const status = (err as Error).message.includes('last remaining')
        ? HttpStatus.CONFLICT
        : HttpStatus.NOT_FOUND;
      throw new HttpException(
        { success: false, message: (err as Error).message },
        status,
      );
    }
  }
}
