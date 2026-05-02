// ===================================================================
// HealthController — GET /health
// ===================================================================
// Returns overall gateway health including:
//   - Database connectivity
//   - Per-node circuit breaker status
//   - Budget status
//   - Uptime
// ===================================================================

import { Controller, Get, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { CircuitBreakerService, CircuitState } from '../routing/circuit-breaker.service';
import { BudgetService, BudgetStatus } from '../budget/budget.service';

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly startedAt = Date.now();

  constructor(
    private readonly config: ConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly budgetService: BudgetService,
  ) {}

  @Get('health')
  async check() {
    const nodes = this.config.nodes.map((node) => {
      const cbStatus = this.circuitBreaker.getNodeStatus(node.id);
      const modelStatuses = this.circuitBreaker.getModelStatuses(node.id);

      // Build per-model circuit info
      const models: Record<string, {
        state: string;
        consecutiveFailures: number;
        lastFailureAt: string | null;
      }> = {};
      for (const [model, ms] of Object.entries(modelStatuses)) {
        models[model] = {
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
        circuit: cbStatus.state,
        consecutiveFailures: cbStatus.consecutiveFailures,
        lastFailureAt: cbStatus.lastFailureAt
          ? new Date(cbStatus.lastFailureAt).toISOString()
          : null,
        healthy: cbStatus.state !== CircuitState.OPEN,
        models,
      };
    });

    const allHealthy = nodes.every((n) => n.healthy);

    let budget: BudgetStatus[];
    try {
      budget = await this.budgetService.getStatus();
    } catch {
      budget = [];
    }

    const uptimeMs = Date.now() - this.startedAt;

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      uptime_ms: uptimeMs,
      uptime_human: this.formatUptime(uptimeMs),
      timestamp: new Date().toISOString(),
      nodes,
      budget: budget.map((b) => ({
        type: b.type,
        current: this.formatBudgetCurrent(b.type, b.current),
        limit: b.limit,
        percentage: Number((b.percentage * 100).toFixed(1)),
        exceeded: b.isExceeded,
        alert: b.isAlert,
      })),
    };
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  private formatBudgetCurrent(type: string, current: number): number {
    return Number(current.toFixed(type.includes('cost') ? 6 : 4));
  }
}
