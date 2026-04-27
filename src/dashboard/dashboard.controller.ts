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
  Controller, Get, Post, Put, Delete, Param, Query, Body, Sse, Logger,
  MessageEvent, ParseIntPipe, DefaultValuePipe, HttpException, HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable, interval, map, merge } from 'rxjs';
import { ConfigService } from '../config/config.service';
import { CapabilityService } from '../config/capability.service';
import { CircuitBreakerService, CircuitState } from '../routing/circuit-breaker.service';
import { BudgetService } from '../budget/budget.service';
import { CallLog } from '../database/entities/call-log.entity';
import { LogEventBus } from './log-event-bus';
import { CreateNodeDto, UpdateNodeDto, TestNodeDto } from './dto/node.dto';
import { DashboardGuard } from '../auth/dashboard.guard';

@Controller('api/dashboard')
@UseGuards(DashboardGuard)
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly capabilityService: CapabilityService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly budgetService: BudgetService,
    private readonly logEventBus: LogEventBus,
    @InjectRepository(CallLog)
    private readonly callLogRepo: Repository<CallLog>,
  ) {}

  // ══════════════════════════════════════════════════════
  // Stats
  // ══════════════════════════════════════════════════════

  @Get('stats')
  async getStats() {
    const totalCalls = await this.callLogRepo.count();
    const successCalls = await this.callLogRepo.count({ where: { status_code: 200 } });
    const failedCalls = totalCalls - successCalls;

    // Aggregations via raw query (works for both SQLite and Postgres)
    const agg = await this.callLogRepo
      .createQueryBuilder('log')
      .select('SUM(log.input_tokens)', 'totalInputTokens')
      .addSelect('SUM(log.output_tokens)', 'totalOutputTokens')
      .addSelect('SUM(log.cost_usd)', 'totalCost')
      .addSelect('AVG(log.latency_ms)', 'avgLatency')
      .addSelect('COUNT(DISTINCT log.session_key)', 'uniqueSessions')
      .getRawOne();

    // Tier distribution
    const tierDist = await this.callLogRepo
      .createQueryBuilder('log')
      .select('log.tier', 'tier')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.tier')
      .getRawMany();

    // Node distribution
    const nodeDist = await this.callLogRepo
      .createQueryBuilder('log')
      .select('log.node_id', 'nodeId')
      .addSelect('COUNT(*)', 'count')
      .addSelect('AVG(log.latency_ms)', 'avgLatency')
      .groupBy('log.node_id')
      .getRawMany();

    // Last 24h stats
    const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const recentAgg = await this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since: oneDayAgo })
      .select('COUNT(*)', 'calls')
      .addSelect('SUM(log.cost_usd)', 'cost')
      .addSelect('SUM(log.input_tokens + log.output_tokens)', 'tokens')
      .getRawOne();

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
  ) {
    const qb = this.callLogRepo
      .createQueryBuilder('log')
      .orderBy('log.timestamp', 'DESC');

    if (tier) qb.andWhere('log.tier = :tier', { tier });
    if (node) qb.andWhere('log.node_id = :node', { node });
    if (status) qb.andWhere('log.status_code = :status', { status: Number(status) });

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
  async getBudget() {
    const status = await this.budgetService.getStatus();
    return {
      rules: status.map((s) => ({
        type: s.type,
        limit: s.limit,
        current: Number(s.current.toFixed(4)),
        percentage: Number((s.percentage * 100).toFixed(1)),
        exceeded: s.isExceeded,
        alert: s.isAlert,
        periodStart: s.periodStart,
      })),
    };
  }

  @Post('budget/:id/reset')
  async resetBudget(@Param('id', ParseIntPipe) id: number) {
    await this.budgetService.resetRule(id);
    return { success: true, message: `Budget rule ${id} reset` };
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
      api_keys: full.auth.api_keys.map((k) => ({
        name: k.name,
        key: `${k.key.substring(0, 8)}...`,
      })),
    };

    return {
      server: full.server,
      database: { type: full.database.type },
      auth: sanitizedAuth,
      nodes: sanitizedNodes,
      routing: full.routing,
      budget: full.budget,
      models_pricing: full.models_pricing,
    };
  }

  @Post('config/reload')
  reloadConfig() {
    try {
      this.config.reload();
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
      return {
        id: node.id,
        name: node.name,
        protocol: node.protocol,
        base_url: node.base_url,
        endpoint: node.endpoint,
        models: node.models,
        capabilities: this.capabilityService.getNodeCapabilities(node.id),
        tags: node.tags || [],
        aliases: node.model_aliases || {},
        circuit: {
          state: cbStatus.state,
          consecutiveFailures: cbStatus.consecutiveFailures,
          lastFailureAt: cbStatus.lastFailureAt
            ? new Date(cbStatus.lastFailureAt).toISOString()
            : null,
        },
        healthy: cbStatus.state !== CircuitState.OPEN,
      };
    });

    return { nodes };
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
  resetNodeCircuit(@Param('id') nodeId: string) {
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
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

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
        tags: dto.tags,
        model_aliases: dto.model_aliases,
        headers: dto.headers,
        auth_type: dto.auth_type,
      });
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
      // If api_key is not provided (or empty), keep the original value
      const updates: Partial<typeof dto> = { ...dto };
      if (!updates.api_key) {
        delete updates.api_key;
      }
      this.config.updateNode(nodeId, updates);
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
