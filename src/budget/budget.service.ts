// ===================================================================
// BudgetService — Daily token & cost budget enforcement
// ===================================================================
// Checks budget before each request and records usage after.
// Auto-resets daily counters at period boundary.
// Supports per-key budgets alongside global limits.
// ===================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
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
  constructor(
    public readonly budgetType: string,
    public readonly current: number,
    public readonly limit: number,
    public readonly apiKeyName?: string | null,
  ) {
    const scope = apiKeyName ? `key "${apiKeyName}"` : 'global';
    super(`Budget exceeded (${scope}): ${budgetType} (${current.toFixed(2)} / ${limit.toFixed(2)})`);
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
    await this.ensurePerKeyRules();
    await this.deactivateOrphanedRules();
  }

  /**
   * Create default global budget rules from config if they don't exist yet.
   */
  private async ensureDefaultRules(): Promise<void> {
    const existing = await this.loadActiveRules(null);
    if (existing.length > 0) {
      // Check if any need daily reset
      await this.resetExpiredPeriods(existing);
      return;
    }

    // Also check inactive global rules — if they exist, skip creation
    const allGlobal = await this.budgetRepo.find({
      where: { api_key_name: IsNull() },
    });
    if (allGlobal.length > 0) {
      await this.resetExpiredPeriods(allGlobal);
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
        api_key_name: null,
      },
      {
        type: 'daily_cost',
        limit_value: budget.daily_cost_limit,
        alert_threshold: budget.alert_threshold,
        current_value: 0,
        period_start: now,
        is_active: true,
        api_key_name: null,
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
   * Create per-key budget rules from config for API keys that have `budget` set.
   */
  private async ensurePerKeyRules(): Promise<void> {
    const apiKeys = this.config.auth?.api_keys || [];
    const globalAlertThreshold = this.config.budget.alert_threshold;
    const now = this.startOfDay(new Date());

    for (const keyEntry of apiKeys) {
      if (!keyEntry.budget) continue;
      const keyName = keyEntry.name;
      const keyBudget = keyEntry.budget;

      const existingRules = await this.budgetRepo.find({
        where: { api_key_name: keyName },
      });

      // Upsert daily_token rule for this key
      if (keyBudget.daily_token_limit !== undefined) {
        const existing = existingRules.find((r) => r.type === 'daily_tokens');
        if (existing) {
          existing.limit_value = keyBudget.daily_token_limit;
          existing.alert_threshold = keyBudget.alert_threshold ?? globalAlertThreshold;
          existing.is_active = true;
          await this.budgetRepo.save(existing);
        } else {
          await this.budgetRepo.save(this.budgetRepo.create({
            type: 'daily_tokens',
            limit_value: keyBudget.daily_token_limit,
            alert_threshold: keyBudget.alert_threshold ?? globalAlertThreshold,
            current_value: 0,
            period_start: now,
            is_active: true,
            api_key_name: keyName,
          }));
        }
      }

      // Upsert daily_cost rule for this key
      if (keyBudget.daily_cost_limit !== undefined) {
        const existing = existingRules.find((r) => r.type === 'daily_cost');
        if (existing) {
          existing.limit_value = keyBudget.daily_cost_limit;
          existing.alert_threshold = keyBudget.alert_threshold ?? globalAlertThreshold;
          existing.is_active = true;
          await this.budgetRepo.save(existing);
        } else {
          await this.budgetRepo.save(this.budgetRepo.create({
            type: 'daily_cost',
            limit_value: keyBudget.daily_cost_limit,
            alert_threshold: keyBudget.alert_threshold ?? globalAlertThreshold,
            current_value: 0,
            period_start: now,
            is_active: true,
            api_key_name: keyName,
          }));
        }
      }
    }
  }

  /**
   * Deactivate per-key rules whose key has been removed from config.
   */
  private async deactivateOrphanedRules(): Promise<void> {
    const apiKeys = this.config.auth?.api_keys || [];
    const configKeyNames = new Set(
      apiKeys.filter((k) => k.budget).map((k) => k.name),
    );

    // Find all per-key active rules
    const allPerKeyRules = await this.budgetRepo
      .createQueryBuilder('rule')
      .where('rule.api_key_name IS NOT NULL')
      .andWhere('rule.is_active = :active', { active: true })
      .getMany();

    for (const rule of allPerKeyRules) {
      if (!configKeyNames.has(rule.api_key_name!)) {
        rule.is_active = false;
        await this.budgetRepo.save(rule);
        this.logger.log(`Deactivated orphaned per-key budget rule: ${rule.type} for key "${rule.api_key_name}"`);
      }
    }
  }

  /**
   * Check if the request can proceed within budget limits.
   * When apiKeyName is provided, checks both global AND per-key limits.
   * Throws BudgetExceededError if any active budget is exceeded.
   */
  async check(apiKeyName?: string): Promise<void> {
    // Check global rules
    const globalRules = await this.loadActiveRules(null);
    await this.resetExpiredPeriods(globalRules);
    this.evaluateRules(globalRules, null);

    // Check per-key rules if applicable
    if (apiKeyName) {
      const keyRules = await this.loadActiveRules(apiKeyName);
      await this.resetExpiredPeriods(keyRules);
      this.evaluateRules(keyRules, apiKeyName);
    }
  }

  /**
   * Record token and cost usage after a successful call.
   * Updates both global rules and per-key rules if apiKeyName is provided.
   */
  async record(tokens: number, costUsd: number, apiKeyName?: string): Promise<void> {
    await this.recordAgainst(null, tokens, costUsd);
    if (apiKeyName) {
      await this.recordAgainst(apiKeyName, tokens, costUsd);
    }
  }

  /**
   * Get current budget status for rules.
   * No apiKeyName = global rules only; with apiKeyName = that key's rules.
   */
  async getStatus(apiKeyName?: string | null): Promise<BudgetStatus[]> {
    const targetKeyName = apiKeyName === undefined ? null : apiKeyName;
    const rules = targetKeyName === null
      ? await this.budgetRepo.find({ where: { api_key_name: IsNull() } })
      : await this.budgetRepo.find({ where: { api_key_name: targetKeyName } });

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
   * Get list of API key names that have active per-key budget rules.
   */
  async getKeysWithBudgets(): Promise<string[]> {
    const results = await this.budgetRepo
      .createQueryBuilder('rule')
      .select('DISTINCT rule.api_key_name', 'api_key_name')
      .where('rule.api_key_name IS NOT NULL')
      .andWhere('rule.is_active = :active', { active: true })
      .getRawMany();

    return results.map((r) => r.api_key_name);
  }

  // ── Private helpers ───────────────────────────────────────

  /**
   * Load active rules for a given scope (null = global, string = per-key).
   */
  private async loadActiveRules(apiKeyName: string | null): Promise<BudgetRule[]> {
    return this.budgetRepo.find({
      where: {
        api_key_name: apiKeyName === null ? IsNull() : apiKeyName,
        is_active: true,
      },
    });
  }

  /**
   * Evaluate a set of rules, throwing BudgetExceededError if any is exceeded.
   */
  private evaluateRules(rules: BudgetRule[], apiKeyName: string | null): void {
    for (const rule of rules) {
      if (rule.current_value >= rule.limit_value) {
        throw new BudgetExceededError(rule.type, rule.current_value, rule.limit_value, apiKeyName);
      }
    }
  }

  /**
   * Record usage against rules for a specific scope.
   */
  private async recordAgainst(apiKeyName: string | null, tokens: number, costUsd: number): Promise<void> {
    const rules = await this.loadActiveRules(apiKeyName);
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
        const scope = apiKeyName ? `key "${apiKeyName}"` : 'global';
        this.logger.warn(
          `Budget alert (${scope}): ${rule.type} at ${(pct * 100).toFixed(1)}% (${rule.current_value.toFixed(2)} / ${rule.limit_value})`,
        );
      }

      await this.budgetRepo.save(rule);
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
