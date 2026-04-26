// ===================================================================
// BudgetService — Daily token & cost budget enforcement
// ===================================================================
// Checks budget before each request and records usage after.
// Auto-resets daily counters at period boundary.
// ===================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '../config/config.service';
import { BudgetRule } from '../database/entities/budget-rule.entity';

export interface BudgetStatus {
  type: string;
  limit: number;
  current: number;
  percentage: number;
  isExceeded: boolean;
  isAlert: boolean;
  periodStart: Date;
}

export class BudgetExceededError extends Error {
  constructor(public readonly budgetType: string, public readonly current: number, public readonly limit: number) {
    super(`Budget exceeded: ${budgetType} (${current.toFixed(2)} / ${limit.toFixed(2)})`);
    this.name = 'BudgetExceededError';
  }
}

@Injectable()
export class BudgetService implements OnModuleInit {
  private readonly logger = new Logger(BudgetService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(BudgetRule)
    private readonly budgetRepo: Repository<BudgetRule>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureDefaultRules();
  }

  /**
   * Create default budget rules from config if they don't exist yet.
   */
  private async ensureDefaultRules(): Promise<void> {
    const existing = await this.budgetRepo.find();
    if (existing.length > 0) {
      // Check if any need daily reset
      await this.resetExpiredPeriods(existing);
      return;
    }

    const budget = this.config.budget;
    const now = this.startOfDay(new Date());

    const rules: Partial<BudgetRule>[] = [
      {
        type: 'daily_tokens',
        limit_value: budget.daily_token_limit,
        alert_threshold: budget.alert_threshold,
        current_value: 0,
        period_start: now,
        is_active: true,
      },
      {
        type: 'daily_cost',
        limit_value: budget.daily_cost_limit,
        alert_threshold: budget.alert_threshold,
        current_value: 0,
        period_start: now,
        is_active: true,
      },
    ];

    for (const rule of rules) {
      await this.budgetRepo.save(this.budgetRepo.create(rule));
    }

    this.logger.log(
      `Budget rules initialized: tokens=${budget.daily_token_limit}, cost=$${budget.daily_cost_limit}`,
    );
  }

  /**
   * Check if the request can proceed within budget limits.
   * Throws BudgetExceededError if any active budget is exceeded.
   */
  async check(): Promise<void> {
    const rules = await this.budgetRepo.find({ where: { is_active: true } });
    await this.resetExpiredPeriods(rules);

    for (const rule of rules) {
      if (rule.current_value >= rule.limit_value) {
        throw new BudgetExceededError(rule.type, rule.current_value, rule.limit_value);
      }
    }
  }

  /**
   * Record token and cost usage after a successful call.
   */
  async record(tokens: number, costUsd: number): Promise<void> {
    const rules = await this.budgetRepo.find({ where: { is_active: true } });
    await this.resetExpiredPeriods(rules);

    for (const rule of rules) {
      if (rule.type === 'daily_tokens') {
        rule.current_value += tokens;
      } else if (rule.type === 'daily_cost') {
        rule.current_value += costUsd;
      }

      // Check alert threshold
      const pct = rule.current_value / rule.limit_value;
      if (pct >= rule.alert_threshold && pct - (tokens / rule.limit_value) < rule.alert_threshold) {
        this.logger.warn(
          `Budget alert: ${rule.type} at ${(pct * 100).toFixed(1)}% (${rule.current_value.toFixed(2)} / ${rule.limit_value})`,
        );
      }

      await this.budgetRepo.save(rule);
    }
  }

  /**
   * Get current budget status for all rules.
   */
  async getStatus(): Promise<BudgetStatus[]> {
    const rules = await this.budgetRepo.find();
    await this.resetExpiredPeriods(rules);

    return rules.map((r) => ({
      type: r.type,
      limit: r.limit_value,
      current: r.current_value,
      percentage: r.limit_value > 0 ? r.current_value / r.limit_value : 0,
      isExceeded: r.current_value >= r.limit_value,
      isAlert: r.current_value / r.limit_value >= r.alert_threshold,
      periodStart: r.period_start,
    }));
  }

  /**
   * Reset a budget rule's counter (manual reset).
   */
  async resetRule(ruleId: number): Promise<void> {
    const rule = await this.budgetRepo.findOneBy({ id: ruleId });
    if (rule) {
      rule.current_value = 0;
      rule.period_start = this.startOfDay(new Date());
      await this.budgetRepo.save(rule);
      this.logger.log(`Budget rule ${rule.type} manually reset`);
    }
  }

  /**
   * Reset counters for rules whose period has expired (new day).
   */
  private async resetExpiredPeriods(rules: BudgetRule[]): Promise<void> {
    const todayStart = this.startOfDay(new Date());

    for (const rule of rules) {
      if (rule.type.startsWith('daily_')) {
        const ruleStart = this.startOfDay(new Date(rule.period_start));
        if (ruleStart.getTime() < todayStart.getTime()) {
          this.logger.log(`Daily budget reset: ${rule.type} (was ${rule.current_value.toFixed(2)})`);
          rule.current_value = 0;
          rule.period_start = todayStart;
          await this.budgetRepo.save(rule);
        }
      }
    }
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
