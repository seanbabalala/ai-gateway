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
  UseGuards, Optional, Inject,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { Observable, interval, map, merge } from 'rxjs';
import { ConfigService } from '../config/config.service';
import { CapabilityService } from '../config/capability.service';
import { RoutingService } from '../routing/routing.service';
import { CircuitBreakerService, CircuitState } from '../routing/circuit-breaker.service';
import { ConcurrencyLimiterService } from '../routing/concurrency-limiter.service';
import { ActiveHealthProbeService } from '../routing/active-health-probe.service';
import { BudgetService } from '../budget/budget.service';
import { CallLog, RouteDecisionLog } from '../database/entities';
import type { RouteDecisionTrace } from '../routing/route-decision-trace';
import { LogEventBus } from './log-event-bus';
import { CreateNodeDto, UpdateNodeDto, TestNodeDto } from './dto/node.dto';
import { DashboardGuard } from '../auth/dashboard.guard';
import { PromptCacheService } from '../cache/prompt-cache.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { RoutingRecommendationService } from '../routing/routing-recommendation.service';
import { ShadowTrafficService } from '../shadow/shadow-traffic.service';
import { RealtimeProxyService } from '../realtime/realtime-proxy.service';
import type { Modality } from '../config/modality';
import { ProviderCatalogService } from '../catalog/provider-catalog.service';
import type { ProviderCompatibilityCapability } from '../database/entities';
import { ProviderCompatibilityService } from './provider-compatibility.service';
import {
  CreateGatewayApiKeyDto,
  UpdateGatewayApiKeyDto,
} from '../auth/dto/gateway-api-key.dto';
import { GatewayApiKeyService } from '../auth/gateway-api-key.service';
import {
  ActionResponseDto,
  ErrorEnvelopeDto,
  GatewayApiKeyCreatedResponseDto,
  GatewayApiKeyListResponseDto,
  GatewayApiKeyMutationResponseDto,
  SanitizedConfigResponseDto,
} from '../openapi/openapi.dto';

@Controller('api/dashboard')
@UseGuards(DashboardGuard)
@ApiTags('Dashboard')
@ApiBearerAuth('dashboardSession')
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly capabilityService: CapabilityService,
    private readonly providerCatalog: ProviderCatalogService,
    private readonly routingService: RoutingService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly concurrencyLimiter: ConcurrencyLimiterService,
    private readonly activeHealth: ActiveHealthProbeService,
    private readonly budgetService: BudgetService,
    private readonly cacheService: PromptCacheService,
    private readonly logEventBus: LogEventBus,
    private readonly telemetry: TelemetryService,
    private readonly routingRecommendations: RoutingRecommendationService,
    private readonly gatewayApiKeys: GatewayApiKeyService,
    private readonly shadowTraffic: ShadowTrafficService,
    private readonly providerCompatibility: ProviderCompatibilityService,
    @Optional()
    @Inject(RealtimeProxyService)
    private readonly realtime: RealtimeProxyService | undefined,
    private readonly dataSource: DataSource,
    @InjectRepository(CallLog)
    private readonly callLogRepo: Repository<CallLog>,
    @InjectRepository(RouteDecisionLog)
    private readonly routeDecisionRepo: Repository<RouteDecisionLog>,
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

    await this.routeDecisionRepo
      .createQueryBuilder()
      .delete()
      .where('timestamp < :cutoff', { cutoff })
      .execute();
  }

  /** Return a SQL expression that truncates a timestamp column to YYYY-MM-DD string */
  private dateTruncDay(column: string): string {
    if (this.dataSource.options.type === 'postgres') {
      return `TO_CHAR(${column}, 'YYYY-MM-DD')`;
    }
    return `strftime('%Y-%m-%d', ${column})`;
  }

  private logWhere(apiKey?: string, apiKeyId?: string, namespaceId?: string): FindOptionsWhere<CallLog> | undefined {
    const where: FindOptionsWhere<CallLog> = {};
    if (apiKeyId) where.api_key_id = apiKeyId;
    else if (apiKey) where.api_key_name = apiKey;
    if (namespaceId) where.namespace_id = namespaceId;
    return Object.keys(where).length > 0 ? where : undefined;
  }

  private applyLogScopeFilter<T extends { where: Function; andWhere: Function }>(
    qb: T,
    apiKey?: string,
    apiKeyId?: string,
    namespaceId?: string,
    method: 'where' | 'andWhere' = 'andWhere',
  ): T {
    let currentMethod = method;
    if (apiKeyId) {
      qb[currentMethod]('log.api_key_id = :apiKeyId', { apiKeyId });
      currentMethod = 'andWhere';
    } else if (apiKey) {
      qb[currentMethod]('log.api_key_name = :apiKey', { apiKey });
      currentMethod = 'andWhere';
    }
    if (namespaceId) {
      qb[currentMethod]('log.namespace_id = :namespaceId', { namespaceId });
    }
    return qb;
  }

  private applyRouteDecisionScopeFilter<T extends { where: Function; andWhere: Function }>(
    qb: T,
    apiKey?: string,
    apiKeyId?: string,
    namespaceId?: string,
    method: 'where' | 'andWhere' = 'andWhere',
  ): T {
    let currentMethod = method;
    if (apiKeyId) {
      qb[currentMethod]('decision.api_key_id = :apiKeyId', { apiKeyId });
      currentMethod = 'andWhere';
    } else if (apiKey) {
      qb[currentMethod]('decision.api_key_name = :apiKey', { apiKey });
      currentMethod = 'andWhere';
    }
    if (namespaceId) {
      qb[currentMethod]('decision.namespace_id = :namespaceId', { namespaceId });
    }
    return qb;
  }

  private serializeRouteDecision(
    decision: RouteDecisionLog,
    includeTrace: boolean,
  ) {
    const trace = this.parseRouteDecisionTrace(decision.trace_json);
    const finalSelection = trace?.final_selection || {
      node: decision.selected_node_id,
      model: decision.selected_model,
      reason: null,
      is_fallback: decision.is_fallback,
      fallback_reason: decision.fallback_reason,
    };

    return {
      id: decision.id,
      request_id: decision.request_id,
      timestamp: decision.timestamp,
      source_format: decision.source_format,
      tier: decision.tier,
      score: decision.score,
      route_mode: decision.route_mode,
      strategy: decision.strategy,
      selected: {
        node: decision.selected_node_id,
        model: decision.selected_model,
      },
      final_selection: finalSelection,
      domain_hint: decision.domain_hint,
      candidate_count: decision.candidate_count,
      filtered_count: decision.filtered_count,
      status_code: decision.status_code,
      is_fallback: decision.is_fallback,
      fallback_reason: decision.fallback_reason,
      api_key_name: decision.api_key_name,
      api_key_id: decision.api_key_id,
      namespace_id: decision.namespace_id,
      summary: {
        reason: finalSelection.reason,
        fallback_chain: trace?.fallback_chain || [],
        filters: trace?.filters || [],
        privacy: trace?.privacy || {
          prompt: false,
          response: false,
          raw_headers: false,
          provider_keys: false,
        },
      },
      ...(includeTrace ? { trace } : {}),
    };
  }

  private parseRouteDecisionTrace(value: string): RouteDecisionTrace | null {
    try {
      return JSON.parse(value) as RouteDecisionTrace;
    } catch {
      return null;
    }
  }

  // ══════════════════════════════════════════════════════
  // Cost Analytics
  // ══════════════════════════════════════════════════════

  @Get('analytics/cost')
  @ApiOperation({ summary: 'Get cost analytics for Dashboard charts' })
  @ApiQuery({ name: 'period', required: false, example: '7d' })
  @ApiQuery({ name: 'groupBy', required: false, example: 'model' })
  @ApiQuery({ name: 'api_key', required: false })
  @ApiQuery({ name: 'api_key_id', required: false })
  @ApiQuery({ name: 'namespace', required: false })
  @ApiOkResponse({ description: 'Cost totals, daily trend, and grouped usage analytics.' })
  async getCostAnalytics(
    @Query('period') period: string = '7d',
    @Query('groupBy') groupBy: string = 'model',
    @Query('api_key') apiKey?: string,
    @Query('api_key_id') apiKeyId?: string,
    @Query('namespace') namespaceId?: string,
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
    this.applyLogScopeFilter(dailyTrendQb, apiKey, apiKeyId, namespaceId);
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
    this.applyLogScopeFilter(byModelQb, apiKey, apiKeyId, namespaceId);
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
    this.applyLogScopeFilter(byNodeQb, apiKey, apiKeyId, namespaceId);
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
    this.applyLogScopeFilter(byTierQb, apiKey, apiKeyId, namespaceId);
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
    this.applyLogScopeFilter(totalQb, apiKey, apiKeyId, namespaceId);
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
  @ApiOperation({ summary: 'Get A/B split experiment analytics' })
  @ApiQuery({ name: 'period', required: false, example: '7d' })
  @ApiQuery({ name: 'tier', required: false, example: 'standard' })
  @ApiQuery({ name: 'api_key', required: false })
  @ApiQuery({ name: 'api_key_id', required: false })
  @ApiQuery({ name: 'namespace', required: false })
  @ApiOkResponse({ description: 'Experiment-group analytics and active split definitions.' })
  async getExperimentAnalytics(
    @Query('period') period: string = '7d',
    @Query('tier') tier?: string,
    @Query('api_key') apiKey?: string,
    @Query('api_key_id') apiKeyId?: string,
    @Query('namespace') namespaceId?: string,
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
    qb = this.applyLogScopeFilter(qb, apiKey, apiKeyId, namespaceId);

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
    trendQb = this.applyLogScopeFilter(trendQb, apiKey, apiKeyId, namespaceId);

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
  @ApiOperation({ summary: 'Get Dashboard aggregate stats' })
  @ApiQuery({ name: 'api_key', required: false })
  @ApiQuery({ name: 'api_key_id', required: false })
  @ApiQuery({ name: 'namespace', required: false })
  @ApiOkResponse({ description: 'Total calls, success rate, token usage, cost, latency, and distributions.' })
  async getStats(
    @Query('api_key') apiKey?: string,
    @Query('api_key_id') apiKeyId?: string,
    @Query('namespace') namespaceId?: string,
  ) {
    const keyWhere = this.logWhere(apiKey, apiKeyId, namespaceId);
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
    this.applyLogScopeFilter(aggQb, apiKey, apiKeyId, namespaceId, 'where');
    const agg = await aggQb.getRawOne();

    // Tier distribution
    const tierQb = this.callLogRepo
      .createQueryBuilder('log')
      .select('log.tier', 'tier')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.tier');
    this.applyLogScopeFilter(tierQb, apiKey, apiKeyId, namespaceId, 'where');
    const tierDist = await tierQb.getRawMany();

    // Node distribution
    const nodeQb = this.callLogRepo
      .createQueryBuilder('log')
      .select('log.node_id', 'nodeId')
      .addSelect('COUNT(*)', 'count')
      .addSelect('AVG(log.latency_ms)', 'avgLatency')
      .groupBy('log.node_id');
    this.applyLogScopeFilter(nodeQb, apiKey, apiKeyId, namespaceId, 'where');
    const nodeDist = await nodeQb.getRawMany();

    // Last 24h stats
    const oneDayAgo = new Date(Date.now() - 86_400_000);
    const recentQb = this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since: oneDayAgo })
      .select('COUNT(*)', 'calls')
      .addSelect('SUM(log.cost_usd)', 'cost')
      .addSelect('SUM(log.input_tokens + log.output_tokens)', 'tokens');
    this.applyLogScopeFilter(recentQb, apiKey, apiKeyId, namespaceId);
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
  @ApiOperation({ summary: 'List paginated call logs' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'tier', required: false })
  @ApiQuery({ name: 'node', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'api_key', required: false })
  @ApiQuery({ name: 'api_key_id', required: false })
  @ApiQuery({ name: 'namespace', required: false })
  @ApiOkResponse({ description: 'Paginated call logs and pagination metadata.' })
  async getLogs(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('tier') tier?: string,
    @Query('node') node?: string,
    @Query('status') status?: string,
    @Query('api_key') apiKey?: string,
    @Query('api_key_id') apiKeyId?: string,
    @Query('namespace') namespaceId?: string,
  ) {
    const qb = this.callLogRepo
      .createQueryBuilder('log')
      .orderBy('log.timestamp', 'DESC');

    if (tier) qb.andWhere('log.tier = :tier', { tier });
    if (node) qb.andWhere('log.node_id = :node', { node });
    if (status) qb.andWhere('log.status_code = :status', { status: Number(status) });
    this.applyLogScopeFilter(qb, apiKey, apiKeyId, namespaceId);

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

  @Get('route-decisions')
  @ApiOperation({ summary: 'List route decision traces for explainable routing' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'tier', required: false })
  @ApiQuery({ name: 'node', required: false })
  @ApiQuery({ name: 'source_format', required: false })
  @ApiQuery({ name: 'api_key', required: false })
  @ApiQuery({ name: 'api_key_id', required: false })
  @ApiQuery({ name: 'namespace', required: false })
  @ApiOkResponse({ description: 'Paginated route decision summaries.' })
  async getRouteDecisions(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('tier') tier?: string,
    @Query('node') node?: string,
    @Query('source_format') sourceFormat?: string,
    @Query('api_key') apiKey?: string,
    @Query('api_key_id') apiKeyId?: string,
    @Query('namespace') namespaceId?: string,
  ) {
    const qb = this.routeDecisionRepo
      .createQueryBuilder('decision')
      .orderBy('decision.timestamp', 'DESC');

    if (tier) qb.andWhere('decision.tier = :tier', { tier });
    if (node) qb.andWhere('decision.selected_node_id = :node', { node });
    if (sourceFormat) {
      qb.andWhere('decision.source_format = :sourceFormat', { sourceFormat });
    }
    this.applyRouteDecisionScopeFilter(qb, apiKey, apiKeyId, namespaceId);

    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const safePage = Math.max(page, 1);
    const [items, total] = await qb
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getManyAndCount();

    return {
      data: items.map((item) => this.serializeRouteDecision(item, false)),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  @Get('route-decisions/:requestId')
  @ApiOperation({ summary: 'Get one route decision trace by request id' })
  @ApiParam({ name: 'requestId' })
  @ApiOkResponse({ description: 'Full route decision trace for one request.' })
  async getRouteDecision(@Param('requestId') requestId: string) {
    const item = await this.routeDecisionRepo.findOne({
      where: { request_id: requestId },
    });
    if (!item) {
      throw new HttpException('Route decision not found', HttpStatus.NOT_FOUND);
    }
    return this.serializeRouteDecision(item, true);
  }

  // ── Log Export ──────────────────────────────────────────

  @Get('logs/export')
  @ApiOperation({ summary: 'Export call logs as CSV or JSON' })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'json'] })
  @ApiQuery({ name: 'days', required: false, example: 7 })
  @ApiQuery({ name: 'api_key', required: false })
  @ApiQuery({ name: 'api_key_id', required: false })
  @ApiQuery({ name: 'namespace', required: false })
  @ApiOkResponse({ description: 'A CSV or JSON file download.' })
  async exportLogs(
    @Query('format') format: string = 'csv',
    @Query('days', new DefaultValuePipe(7), ParseIntPipe) days: number,
    @Query('api_key') apiKey: string | undefined,
    @Query('api_key_id') apiKeyId: string | undefined,
    @Query('namespace') namespaceId: string | undefined,
    @Res() res: Response,
  ) {
    const safeDays = Math.min(Math.max(days, 1), 365);
    const since = new Date(Date.now() - safeDays * 86_400_000);

    const qb = this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since })
      .orderBy('log.timestamp', 'DESC');
    this.applyLogScopeFilter(qb, apiKey, apiKeyId, namespaceId);
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
      'fallback_reason', 'structured_output_requested',
      'structured_output_type', 'structured_output_strategy',
      'structured_output_supported', 'structured_output_schema_name',
      'media_type', 'media_operation', 'media_multipart',
      'media_file_count', 'media_byte_size', 'media_requested_format',
      'media_response_format', 'media_provider_response_type',
      'api_key_id', 'api_key_name', 'retry_count', 'error', 'namespace_id',
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
  @ApiOperation({ summary: 'Stream call log events for the Dashboard' })
  @ApiOkResponse({ description: 'Server-Sent Events with connected, log, and heartbeat events.' })
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
  @ApiOperation({ summary: 'Get global and per-key budget status' })
  @ApiQuery({ name: 'api_key', required: false })
  @ApiQuery({ name: 'api_key_id', required: false })
  @ApiQuery({ name: 'namespace', required: false })
  @ApiOkResponse({ description: 'Budget rules and current usage.' })
  async getBudget(
    @Query('api_key') apiKey?: string,
    @Query('api_key_id') apiKeyId?: string,
    @Query('namespace') namespaceId?: string,
  ) {
    if (namespaceId) {
      const globalStatus = await this.budgetService.getStatus();
      const namespaceStatus = await this.budgetService.getStatus(null, null, namespaceId);
      return {
        rules: globalStatus.map((s) => this.serializeBudgetStatus(s)),
        namespaceRules: namespaceStatus.map((s) => this.serializeBudgetStatus(s)),
        namespaceId,
      };
    }
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
    scope: 'global' | 'api_key' | 'namespace';
    apiKeyName: string | null;
    apiKeyId: string | null;
    namespaceId: string | null;
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
      namespaceId: s.namespaceId,
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
  @ApiOperation({ summary: 'List API keys that have budget information' })
  @ApiOkResponse({ description: 'Budget-aware Gateway API key names and summaries.' })
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

  @Get('namespaces')
  @ApiOperation({ summary: 'List local OSS namespaces and read-only policy summary' })
  @ApiOkResponse({ description: 'Local namespace policies with budget status summaries.' })
  async getNamespaces() {
    const namespaces = await Promise.all(
      this.config.namespaces.map(async (namespace) => {
        const budget = await this.budgetService.getStatus(null, null, namespace.id);
        return {
          id: namespace.id,
          name: namespace.name || namespace.id,
          allowed_nodes: namespace.allowed_nodes || [],
          allowed_models: namespace.allowed_models || [],
          rate_limit_per_minute: namespace.rate_limit?.requests_per_minute || null,
          budget: namespace.budget || null,
          budget_status: budget.map((item) => this.serializeBudgetStatus(item)),
        };
      }),
    );

    return {
      namespaces,
      mode: 'local_only',
      enterprise_features: {
        workspace: false,
        sso: false,
        scim: false,
        org_billing: false,
      },
    };
  }

  @Get('shadow')
  @ApiOperation({ summary: 'Read-only shadow traffic status and recent results' })
  @ApiQuery({ name: 'namespace', required: false })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiOkResponse({ description: 'Shadow traffic configuration status and sanitized recent result rows.' })
  async getShadowTraffic(
    @Query('namespace') namespaceId?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number = 50,
  ) {
    return {
      status: this.shadowTraffic.getStatus(),
      recent: await this.shadowTraffic.recent(namespaceId, limit),
    };
  }

  @Get('api-keys')
  @ApiTags('API Keys')
  @ApiOperation({ summary: 'List Dashboard-managed Gateway API keys' })
  @ApiOkResponse({ type: GatewayApiKeyListResponseDto })
  async getApiKeyNames() {
    const items = await this.gatewayApiKeys.list();
    return {
      keys: items.map((key) => key.name),
      items,
    };
  }

  @Post('api-keys')
  @ApiTags('API Keys')
  @ApiOperation({ summary: 'Create a Gateway API key' })
  @ApiBody({ type: CreateGatewayApiKeyDto })
  @ApiOkResponse({ type: GatewayApiKeyCreatedResponseDto })
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
  @ApiTags('API Keys')
  @ApiOperation({ summary: 'Update a Gateway API key policy' })
  @ApiParam({ name: 'id', example: 'key_01h...' })
  @ApiBody({ type: UpdateGatewayApiKeyDto })
  @ApiOkResponse({ type: GatewayApiKeyMutationResponseDto })
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
  @ApiTags('API Keys')
  @ApiOperation({ summary: 'Rotate a Gateway API key secret' })
  @ApiParam({ name: 'id', example: 'key_01h...' })
  @ApiOkResponse({ type: GatewayApiKeyCreatedResponseDto })
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
  @ApiTags('API Keys')
  @ApiOperation({ summary: 'Delete a Gateway API key' })
  @ApiParam({ name: 'id', example: 'key_01h...' })
  @ApiOkResponse({ type: ActionResponseDto })
  async deleteApiKey(@Param('id') id: string) {
    await this.gatewayApiKeys.remove(id);
    return { success: true, message: 'Gateway API key deleted' };
  }

  @Post('budget/:id/reset')
  @ApiOperation({ summary: 'Reset a budget rule counter' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiOkResponse({ type: ActionResponseDto })
  async resetBudget(@Param('id', ParseIntPipe) id: number) {
    await this.budgetService.resetRule(id);
    return { success: true, message: `Budget rule ${id} reset` };
  }

  // ══════════════════════════════════════════════════════
  // Cache
  // ══════════════════════════════════════════════════════

  @Get('cache')
  @ApiOperation({ summary: 'Get prompt cache stats' })
  @ApiOkResponse({ description: 'Prompt cache hit/miss and storage stats.' })
  getCacheStats() {
    return this.cacheService.getStats();
  }

  @Post('cache/clear')
  @ApiOperation({ summary: 'Clear prompt cache' })
  @ApiOkResponse({ type: ActionResponseDto })
  clearCache() {
    this.cacheService.clear();
    return { success: true, message: 'Cache cleared' };
  }

  // ══════════════════════════════════════════════════════
  // Telemetry Status
  // ══════════════════════════════════════════════════════

  @Get('telemetry-status')
  @ApiOperation({ summary: 'Get local telemetry configuration status' })
  @ApiOkResponse({ description: 'Telemetry enabled state and non-secret endpoint configuration.' })
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
  @ApiOperation({
    summary: 'Get sanitized gateway configuration',
    description: 'Provider API keys are masked, legacy YAML auth keys are omitted, and dashboard password hashes are never returned.',
  })
  @ApiOkResponse({ type: SanitizedConfigResponseDto })
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
      routing_status: this.routingService.getRoutingStatus(),
      budget: full.budget,
      namespaces: full.namespaces || [],
      shadow: this.shadowTraffic.getStatus(),
      realtime: this.realtime?.getStatus() || {
        enabled: false,
        experimental: true,
        path: '/v1/realtime',
        active_connections: 0,
        max_connections: 0,
        max_connections_per_node: 0,
        idle_timeout_ms: 0,
        upstream_connect_timeout_ms: 0,
        max_session_ms: 0,
        recent: [],
      },
      models_pricing: full.models_pricing,
      diagnostics: this.config.getNodeModelDiagnostics(),
    };
  }

  @Post('config/reload')
  @ApiOperation({ summary: 'Reload gateway.config.yaml from disk' })
  @ApiOkResponse({ type: ActionResponseDto })
  reloadConfig() {
    const result = this.config.reload({
      source: 'dashboard',
      throwOnError: false,
    });
    if (!result.success) {
      throw new HttpException(
        {
          success: false,
          message: result.message,
          error: result.error,
          snapshot: result.current,
          rolled_back: result.rolled_back,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    this.activeHealth.refreshSchedules();
    return result;
  }

  // ══════════════════════════════════════════════════════
  // Catalog & Capabilities
  // ══════════════════════════════════════════════════════

  /** Get built-in provider catalog entries */
  @Get('catalog/providers')
  @ApiOperation({ summary: 'List built-in provider catalog entries' })
  @ApiOkResponse({ description: 'Static provider catalog used by Dashboard Add Node and config validation.' })
  getCatalogProviders() {
    return {
      ...this.providerCatalog.getMetadata(),
      providers: this.providerCatalog.listProviders(),
    };
  }

  @Get('catalog/models')
  @ApiOperation({ summary: 'List built-in provider catalog models' })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'modality', required: false })
  @ApiQuery({ name: 'endpoint', required: false })
  @ApiOkResponse({ description: 'Flattened static model catalog with optional provider/modality/endpoint filters.' })
  getCatalogModels(
    @Query('provider') provider?: string,
    @Query('modality') modality?: string,
    @Query('endpoint') endpoint?: string,
  ) {
    return {
      ...this.providerCatalog.getMetadata(),
      models: this.providerCatalog.listModels({ provider, modality, endpoint }),
    };
  }

  /** Get all capability definitions */
  @Get('capabilities')
  @ApiOperation({ summary: 'List known capability definitions' })
  @ApiOkResponse({ description: 'Capability registry used by tier recommendation and routing suggestions.' })
  getCapabilities() {
    return { capabilities: this.capabilityService.getRegistry() };
  }

  /** Recommend tier suitability given a set of capabilities */
  @Post('capabilities/recommend-tiers')
  @ApiOperation({ summary: 'Recommend tiers for a capability set' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { capabilities: { type: 'array', items: { type: 'string' } } },
      example: { capabilities: ['coding', 'reasoning'] },
    },
  })
  @ApiOkResponse({ description: 'Tier recommendations by capability.' })
  recommendTiers(@Body() body: { capabilities: string[] }) {
    const capabilities = body.capabilities || [];
    return { recommendations: this.capabilityService.recommendTiers(capabilities) };
  }

  /** Recommend full routing config based on all nodes' capabilities */
  @Post('routing/recommend')
  @ApiOperation({ summary: 'Recommend routing config from node capabilities' })
  @ApiOkResponse({ description: 'Suggested routing configuration.' })
  recommendRouting() {
    return { recommendations: this.capabilityService.recommendRouting() };
  }

  /** Read-only adaptive routing recommendations from local sliding-window metrics */
  @Get('routing/recommendations')
  getAdaptiveRoutingRecommendations(
    @Query('window_hours', new DefaultValuePipe(24), ParseIntPipe)
    windowHours: number,
    @Query('sample_limit', new DefaultValuePipe(1000), ParseIntPipe)
    sampleLimit: number,
  ) {
    return this.routingRecommendations.getRecommendations({
      windowHours,
      sampleLimit,
    });
  }

  /** Update routing configuration (tiers, scoring, domain preferences) */
  @Put('routing')
  @ApiOperation({ summary: 'Update routing tiers, scoring thresholds, and domain preferences' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        tiers: { type: 'object' },
        scoring: { type: 'object' },
        domain_preferences: { type: 'object' },
      },
      example: {
        tiers: {
          standard: {
            primary: { node: 'openai', model: 'gpt-4o' },
            fallbacks: [{ node: 'anthropic', model: 'claude-sonnet-4-20250514' }],
          },
        },
      },
    },
  })
  @ApiOkResponse({ type: ActionResponseDto })
  updateRouting(@Body() body: {
    tiers?: Record<string, {
      primary?: { node: string; model: string };
      fallbacks?: { node: string; model: string }[];
      strategy?: 'weighted' | 'round_robin' | 'least_latency' | 'random';
      targets?: { node: string; model: string; weight?: number; name?: string }[];
      split?: { node: string; model: string; weight: number; name?: string }[];
    }>;
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
  @ApiOperation({ summary: 'List configured nodes, capabilities, and circuit status' })
  @ApiOkResponse({ description: 'Node status list with no provider API key values.' })
  async getNodes() {
    const compatibility = await this.providerCompatibility.matrixForNodes(
      this.config.nodes,
    );
    const nodes = this.config.nodes.map((node) => {
      const cbStatus = this.circuitBreaker.getNodeStatus(node.id);
      const modelStatuses = this.circuitBreaker.getModelStatuses(node.id);
      const concurrency = this.concurrencyLimiter.getNodeStats(node);
      const activeProbe = this.activeHealth.getNodeStatus(node.id);
      const modelIds = Array.from(new Set([
        ...node.models,
        ...(node.embedding_models || []),
        ...(node.rerank_models || []),
        ...(node.image_models || []),
        ...(node.audio_models || []),
        ...(node.video_models || []),
        ...(node.realtime_models || []),
      ]));
      const modelCapabilities = Object.fromEntries(
        modelIds.map((model) => [
          model,
          this.capabilityService.resolveModelRoutingCapabilities(
            node.id,
            model,
          ),
        ]),
      );
      const endpoints = {
        default: node.endpoint,
        ...(node.embeddings_endpoint ? { embeddings: node.embeddings_endpoint } : {}),
        ...(node.rerank_endpoint ? { rerank: node.rerank_endpoint } : {}),
        ...(node.images_generations_endpoint ? { image_generations: node.images_generations_endpoint } : {}),
        ...(node.images_edits_endpoint ? { image_edits: node.images_edits_endpoint } : {}),
        ...(node.images_variations_endpoint ? { image_variations: node.images_variations_endpoint } : {}),
        ...(node.audio_transcriptions_endpoint ? { audio_transcriptions: node.audio_transcriptions_endpoint } : {}),
        ...(node.audio_translations_endpoint ? { audio_translations: node.audio_translations_endpoint } : {}),
        ...(node.audio_speech_endpoint ? { audio_speech: node.audio_speech_endpoint } : {}),
        ...(node.video_generations_endpoint ? { video_generations: node.video_generations_endpoint } : {}),
        ...(node.video_status_endpoint ? { video_status: node.video_status_endpoint } : {}),
        ...(node.realtime_endpoint ? { realtime: node.realtime_endpoint } : {}),
        ...(node.images_generations_endpoint ? { image_generation: node.images_generations_endpoint } : {}),
        ...(node.images_edits_endpoint ? { image_edit: node.images_edits_endpoint } : {}),
        ...(node.images_variations_endpoint ? { image_variation: node.images_variations_endpoint } : {}),
        ...(node.audio_transcriptions_endpoint ? { audio_transcription: node.audio_transcriptions_endpoint } : {}),
        ...(node.audio_translations_endpoint ? { audio_translation: node.audio_translations_endpoint } : {}),
        ...(node.audio_speech_endpoint ? { audio_speech: node.audio_speech_endpoint } : {}),
        ...(node.images_generations_endpoint ? { images: node.images_generations_endpoint } : {}),
        ...(node.audio_transcriptions_endpoint ? { audio: node.audio_transcriptions_endpoint } : {}),
        ...(node.video_endpoint || node.video_generations_endpoint ? { video: node.video_endpoint || node.video_generations_endpoint } : {}),
        ...(node.video_endpoint ? { video_endpoint: node.video_endpoint } : {}),
        ...(node.video_content_endpoint ? { video_content: node.video_content_endpoint } : {}),
        ...(node.video_cancel_endpoint ? { video_cancel: node.video_cancel_endpoint } : {}),
        ...(node.realtime_endpoint ? { realtime: node.realtime_endpoint } : {}),
        ...(node.endpoints || {}),
      };

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
        endpoints,
        models: node.models,
        embedding_models: node.embedding_models || [],
        embeddings_endpoint: node.embeddings_endpoint || null,
        rerank_models: node.rerank_models || [],
        image_models: node.image_models || [],
        images_generations_endpoint: node.images_generations_endpoint || null,
        images_edits_endpoint: node.images_edits_endpoint || null,
        images_variations_endpoint: node.images_variations_endpoint || null,
        audio_models: node.audio_models || [],
        audio_transcriptions_endpoint: node.audio_transcriptions_endpoint || null,
        audio_translations_endpoint: node.audio_translations_endpoint || null,
        audio_speech_endpoint: node.audio_speech_endpoint || null,
        video_models: node.video_models || [],
        video_generations_endpoint: node.video_generations_endpoint || null,
        video_endpoint: node.video_endpoint || null,
        video_status_endpoint: node.video_status_endpoint || null,
        video_content_endpoint: node.video_content_endpoint || null,
        video_cancel_endpoint: node.video_cancel_endpoint || null,
        capabilities: this.capabilityService.getNodeCapabilities(node.id),
        modalities: this.capabilityService.resolveNodeModalities(node.id),
        model_capabilities: modelCapabilities,
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
        concurrency,
        active_probe: activeProbe,
        realtime: this.realtime?.getNodeStatus(node.id) || {
          enabled: false,
          experimental: true,
          supported: false,
          endpoint: null,
          models: [],
          active_connections: 0,
          max_connections_per_node: 0,
          last_connected_at: null,
          last_closed_at: null,
          last_error: null,
        },
        compatibility_matrix: compatibility[node.id] || [],
        healthy: cbStatus.state !== CircuitState.OPEN && activeProbe.status !== 'unhealthy',
      };
    });

    return {
      nodes,
      diagnostics: [
        ...this.config.getNodeModelDiagnostics(),
        ...this.providerCompatibility.compatibilityDiagnostics(compatibility),
      ],
    };
  }

  // ── Node Connectivity Test ─────────────────────────────

  /** Test a new node before saving (provide all params) */
  @Post('nodes/test')
  @ApiOperation({ summary: 'Test a node configuration before saving it' })
  @ApiBody({ type: TestNodeDto })
  @ApiOkResponse({ description: 'Connectivity result. Provider API key is accepted as write-only input and is not returned.' })
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
  @ApiOperation({ summary: 'Test an existing saved node' })
  @ApiParam({ name: 'id', example: 'openai' })
  @ApiOkResponse({ description: 'Connectivity result using the saved provider key.' })
  async testExistingNode(
    @Param('id') nodeId: string,
    @Body() dto?: Pick<TestNodeDto, 'capabilities' | 'confirm_expensive'>,
  ) {
    const node = this.config.getNode(nodeId);
    if (!node) {
      throw new HttpException(
        { success: false, message: `Node "${nodeId}" not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    return this.providerCompatibility.runNodeMatrix(node, {
      capabilities: dto?.capabilities as ProviderCompatibilityCapability[] | undefined,
      confirm_expensive: dto?.confirm_expensive,
    });
  }

  @Post('nodes/:id/reset')
  @ApiOperation({ summary: 'Reset node or node:model circuit breaker state' })
  @ApiParam({ name: 'id', example: 'openai' })
  @ApiQuery({ name: 'model', required: false, example: 'gpt-4o' })
  @ApiOkResponse({ type: ActionResponseDto })
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
  @ApiOperation({ summary: 'Create a provider node' })
  @ApiBody({ type: CreateNodeDto })
  @ApiOkResponse({ type: ActionResponseDto })
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
        embeddings_endpoint: dto.embeddings_endpoint,
        embedding_models: dto.embedding_models,
        rerank_endpoint: dto.rerank_endpoint,
        rerank_models: dto.rerank_models,
        images_generations_endpoint: dto.images_generations_endpoint,
        images_edits_endpoint: dto.images_edits_endpoint,
        images_variations_endpoint: dto.images_variations_endpoint,
        image_models: dto.image_models,
        audio_transcriptions_endpoint: dto.audio_transcriptions_endpoint,
        audio_translations_endpoint: dto.audio_translations_endpoint,
        audio_speech_endpoint: dto.audio_speech_endpoint,
        audio_models: dto.audio_models,
        video_generations_endpoint: dto.video_generations_endpoint,
        video_endpoint: dto.video_endpoint,
        video_status_endpoint: dto.video_status_endpoint,
        video_content_endpoint: dto.video_content_endpoint,
        video_cancel_endpoint: dto.video_cancel_endpoint,
        video_models: dto.video_models,
        realtime_models: dto.realtime_models,
        realtime_endpoint: dto.realtime_endpoint,
        timeout_ms: dto.timeout_ms,
        max_concurrency: dto.max_concurrency,
        queue_timeout_ms: dto.queue_timeout_ms,
        queue_policy: dto.queue_policy,
        capabilities: dto.capabilities,
        modalities: dto.modalities as Modality[] | undefined,
        tags: dto.tags,
        model_aliases: dto.model_aliases,
        model_prefixes: dto.model_prefixes,
        headers: dto.headers,
        auth_type: dto.auth_type,
        model_capabilities: dto.model_capabilities as any,
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
  @ApiOperation({ summary: 'Update a provider node' })
  @ApiParam({ name: 'id', example: 'openai' })
  @ApiBody({ type: UpdateNodeDto })
  @ApiOkResponse({ type: ActionResponseDto })
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
  @ApiOperation({ summary: 'Delete a provider node' })
  @ApiParam({ name: 'id', example: 'openai' })
  @ApiOkResponse({ type: ActionResponseDto })
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
