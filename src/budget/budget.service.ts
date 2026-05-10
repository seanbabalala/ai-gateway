// ===================================================================
// BudgetService — Daily token & cost budget enforcement
// ===================================================================
// Checks budget before each request and records usage after.
// Auto-resets daily counters at period boundary.
// Supports global, namespace, local team, and per-key budgets.
// ===================================================================

import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Subscription } from 'rxjs';
import { ConfigService } from '../config/config.service';
import { BudgetRule } from '../database/entities/budget-rule.entity';
import { AlertService } from '../alerts/alert.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { WorkspaceContextService } from '../workspaces/workspace-context.service';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/workspace.constants';
import {
  applyWorkspaceQueryScope,
  normalizeWorkspaceId,
  workspaceFindWhere,
} from '../workspaces/workspace-scope';

export interface BudgetStatus {
  id: number;
  type: string;
  scope: 'global' | 'api_key' | 'namespace' | 'team';
  apiKeyName: string | null;
  apiKeyId: string | null;
  namespaceId: string | null;
  teamId: string | null;
  limit: number;
  current: number;
  percentage: number;
  alertThreshold: number;
  isExceeded: boolean;
  isAlert: boolean;
  periodStart: Date;
  resetAt: Date | null;
}

export class BudgetExceededError extends Error {
  public readonly scope: 'global' | 'api_key' | 'namespace' | 'team';
  public readonly resetAt: Date | null;

  constructor(
    public readonly budgetType: string,
    public readonly current: number,
    public readonly limit: number,
    public readonly apiKeyName?: string | null,
    public readonly apiKeyId?: string | null,
    public readonly namespaceId?: string | null,
    public readonly teamId?: string | null,
    periodStart?: Date | null,
  ) {
    const scope = namespaceId
      ? `namespace "${namespaceId}"`
      : teamId
      ? `team "${teamId}"`
      : apiKeyName
      ? `key "${apiKeyName}"`
      : apiKeyId
      ? `key id "${apiKeyId}"`
      : 'global';
    super(`Budget exceeded (${scope}): ${budgetType} (${current.toFixed(2)} / ${limit.toFixed(2)})`);
    this.name = 'BudgetExceededError';
    this.scope = namespaceId ? 'namespace' : teamId ? 'team' : apiKeyName || apiKeyId ? 'api_key' : 'global';
    this.resetAt = periodStart ? BudgetExceededError.nextDailyReset(periodStart) : null;
  }

  toDetails() {
    return {
      scope: this.scope,
      api_key_id: this.apiKeyId || null,
      api_key_name: this.apiKeyName || null,
      namespace_id: this.namespaceId || null,
      team_id: this.teamId || null,
      budget_type: this.budgetType,
      current: Number(this.current.toFixed(6)),
      limit: Number(this.limit.toFixed(6)),
      reset_at: this.resetAt?.toISOString() || null,
    };
  }

  private static nextDailyReset(periodStart: Date): Date | null {
    const reset = new Date(periodStart);
    reset.setHours(0, 0, 0, 0);
    reset.setDate(reset.getDate() + 1);
    return reset;
  }
}

@Injectable()
export class BudgetService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BudgetService.name);
  private configReloadSub?: Subscription;
  private budgetMetricSnapshot: Array<{
    ratio: number;
    attrs: { scope: 'global' | 'api_key' | 'namespace' | 'team'; budget_type: string };
  }> = [];

  constructor(
    private readonly config: ConfigService,
    private readonly workspaceContext: WorkspaceContextService,
    @InjectRepository(BudgetRule)
    private readonly budgetRepo: Repository<BudgetRule>,
    @Optional() private readonly alerts?: AlertService,
    @Optional() private readonly telemetry?: TelemetryService,
  ) {
    this.registerMetrics();
  }

  async onModuleInit(): Promise<void> {
    await this.syncRulesFromConfig();
    this.configReloadSub = this.config.onReloadSuccess(() => this.syncRulesFromConfig());
  }

  onModuleDestroy(): void {
    this.configReloadSub?.unsubscribe();
  }

  /**
   * Create default global budget rules from config if they don't exist yet.
   */
  private async ensureDefaultRules(): Promise<void> {
    const workspaceId = this.workspaceId();
    const allGlobal = await this.budgetRepo.find({
      where: workspaceFindWhere(workspaceId, {
        api_key_name: IsNull(),
        api_key_id: IsNull(),
        namespace_id: IsNull(),
        team_id: IsNull(),
      }),
    });
    const budget = this.config.budget;
    const now = this.startOfDay(new Date());
    const desired = [
      { type: 'daily_tokens', limit: budget.daily_token_limit },
      { type: 'daily_cost', limit: budget.daily_cost_limit },
    ];

    for (const item of desired) {
      const existing = allGlobal.find((rule) => rule.type === item.type);
      if (existing) {
        existing.limit_value = item.limit;
        existing.alert_threshold = budget.alert_threshold;
        existing.is_active = true;
        await this.budgetRepo.save(existing);
      } else {
        await this.budgetRepo.save(this.budgetRepo.create({
          type: item.type,
          limit_value: item.limit,
          alert_threshold: budget.alert_threshold,
          current_value: 0,
          period_start: now,
          is_active: true,
          api_key_name: null,
          api_key_id: null,
          namespace_id: null,
          team_id: null,
          workspace_id: workspaceId,
        }));
      }
    }

    await this.resetExpiredPeriods(allGlobal);

    this.logger.log(
      `Budget rules initialized: tokens=${budget.daily_token_limit}, cost=$${budget.daily_cost_limit}`,
    );
  }

  /**
   * Create per-key budget rules from config for API keys that have `budget` set.
   */
  private async ensurePerKeyRules(): Promise<void> {
    const workspaceId = this.workspaceId();
    const apiKeys = this.config.auth?.api_keys || [];
    const globalAlertThreshold = this.config.budget.alert_threshold;
    const now = this.startOfDay(new Date());

    for (const keyEntry of apiKeys) {
      if (!keyEntry.budget) continue;
      const keyName = keyEntry.name;
      const keyBudget = keyEntry.budget;

      const existingRules = await this.budgetRepo.find({
        where: workspaceFindWhere(workspaceId, {
          api_key_name: keyName,
          api_key_id: IsNull(),
          namespace_id: IsNull(),
          team_id: IsNull(),
        }),
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
            api_key_id: null,
            namespace_id: null,
            team_id: null,
            workspace_id: workspaceId,
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
            api_key_id: null,
            namespace_id: null,
            team_id: null,
            workspace_id: workspaceId,
          }));
        }
      }
    }
  }

  /**
   * Create local namespace budget rules from config. This is OSS-local only:
   * namespaces are a lightweight policy scope, not enterprise workspaces.
   */
  private async ensureNamespaceRules(): Promise<void> {
    const workspaceId = this.workspaceId();
    const namespaces = this.config.namespaces || [];
    const globalAlertThreshold = this.config.budget.alert_threshold;
    const now = this.startOfDay(new Date());

    for (const namespace of namespaces) {
      const budget = namespace.budget;
      const existingRules = await this.budgetRepo.find({
        where: workspaceFindWhere(workspaceId, {
          namespace_id: namespace.id,
          is_active: true,
        }),
      });

      await this.upsertNamespaceRule(
        namespace.id,
        'daily_tokens',
        budget?.daily_token_limit,
        budget?.alert_threshold ?? globalAlertThreshold,
        existingRules,
        now,
        workspaceId,
      );
      await this.upsertNamespaceRule(
        namespace.id,
        'daily_cost',
        budget?.daily_cost_limit,
        budget?.alert_threshold ?? globalAlertThreshold,
        existingRules,
        now,
        workspaceId,
      );
    }
  }

  private async upsertNamespaceRule(
    namespaceId: string,
    type: string,
    limit: number | undefined,
    alertThreshold: number,
    existingRules: BudgetRule[],
    periodStart: Date,
    workspaceId = this.workspaceId(),
  ): Promise<void> {
    const existing = existingRules.find((rule) => rule.type === type);
    if (limit === undefined) {
      if (existing) {
        existing.is_active = false;
        await this.budgetRepo.save(existing);
      }
      return;
    }

    if (existing) {
      existing.limit_value = limit;
      existing.alert_threshold = alertThreshold;
      existing.is_active = true;
      await this.budgetRepo.save(existing);
      return;
    }

    await this.budgetRepo.save(this.budgetRepo.create({
      type,
      limit_value: limit,
      alert_threshold: alertThreshold,
      current_value: 0,
      period_start: periodStart,
      is_active: true,
      api_key_name: null,
      api_key_id: null,
      namespace_id: namespaceId,
      team_id: null,
      workspace_id: workspaceId,
    }));
  }

  /**
   * Deactivate per-key rules whose key has been removed from config.
   */
  private async deactivateOrphanedRules(): Promise<void> {
    const apiKeys = this.config.auth?.api_keys || [];
    const configKeyNames = new Set(
      apiKeys.filter((k) => k.budget).map((k) => k.name),
    );

    // Find legacy per-key active rules. DB-managed Gateway API key rules have
    // api_key_id set and are owned by GatewayApiKeyService, so they must not be
    // deactivated just because they are not listed in YAML auth.api_keys.
    const allPerKeyRules = await this.budgetRepo
      .createQueryBuilder('rule')
      .where('rule.api_key_name IS NOT NULL');
    applyWorkspaceQueryScope(allPerKeyRules, 'rule', this.workspaceId());
    const rows = await allPerKeyRules
      .andWhere('rule.api_key_id IS NULL')
      .andWhere('rule.namespace_id IS NULL')
      .andWhere('rule.team_id IS NULL')
      .andWhere('rule.is_active = :active', { active: true })
      .getMany();

    for (const rule of rows) {
      if (!configKeyNames.has(rule.api_key_name!)) {
        rule.is_active = false;
        await this.budgetRepo.save(rule);
        this.logger.log(`Deactivated orphaned per-key budget rule: ${rule.type} for key "${rule.api_key_name}"`);
      }
    }
  }

  private async deactivateOrphanedNamespaceRules(): Promise<void> {
    const configNamespaces = new Set((this.config.namespaces || []).map((namespace) => namespace.id));
    const namespaceRules = await this.budgetRepo
      .createQueryBuilder('rule')
      .where('rule.namespace_id IS NOT NULL');
    applyWorkspaceQueryScope(namespaceRules, 'rule', this.workspaceId());
    const rows = await namespaceRules
      .andWhere('rule.is_active = :active', { active: true })
      .getMany();

    for (const rule of rows) {
      if (!rule.namespace_id || configNamespaces.has(rule.namespace_id)) {
        continue;
      }
      rule.is_active = false;
      await this.budgetRepo.save(rule);
      this.logger.log(`Deactivated orphaned namespace budget rule: ${rule.type} for namespace "${rule.namespace_id}"`);
    }
  }

  private async syncRulesFromConfig(): Promise<void> {
    await this.ensureDefaultRules();
    await this.ensurePerKeyRules();
    await this.ensureNamespaceRules();
    await this.deactivateOrphanedRules();
    await this.deactivateOrphanedNamespaceRules();
    await this.refreshBudgetMetricSnapshot();
  }

  /**
   * Check if the request can proceed within budget limits.
   * When apiKeyName is provided, checks both global AND per-key limits.
   * Throws BudgetExceededError if any active budget is exceeded.
   */
  async check(apiKeyName?: string, apiKeyId?: string, namespaceId?: string | null, teamId?: string | null): Promise<void> {
    // Check global rules
    const globalRules = await this.loadActiveRules(null);
    await this.resetExpiredPeriods(globalRules);
    this.evaluateRules(globalRules, null, null, null, null);

    if (namespaceId) {
      const namespaceRules = await this.loadActiveRules(null, null, namespaceId, null);
      await this.resetExpiredPeriods(namespaceRules);
      this.evaluateRules(namespaceRules, null, null, namespaceId, null);
    }

    if (teamId) {
      const teamRules = await this.loadActiveRules(null, null, null, teamId);
      await this.resetExpiredPeriods(teamRules);
      this.evaluateRules(teamRules, null, null, null, teamId);
    }

    // Check per-key rules if applicable
    if (apiKeyName || apiKeyId) {
      const keyRules = await this.loadActiveRules(apiKeyName || null, apiKeyId);
      await this.resetExpiredPeriods(keyRules);
      this.evaluateRules(keyRules, apiKeyName || null, apiKeyId || null, null, null);
    }
  }

  /**
   * Record token and cost usage after a successful call.
   * Updates both global rules and per-key rules if apiKeyName is provided.
   */
  async record(tokens: number, costUsd: number, apiKeyName?: string, apiKeyId?: string, namespaceId?: string | null, teamId?: string | null): Promise<void> {
    const safeTokens = this.sanitizeCounterValue(tokens);
    const safeCostUsd = this.sanitizeCounterValue(costUsd);
    await this.recordAgainst(null, safeTokens, safeCostUsd);
    if (namespaceId) {
      await this.recordAgainst(null, safeTokens, safeCostUsd, null, namespaceId, null);
    }
    if (teamId) {
      await this.recordAgainst(null, safeTokens, safeCostUsd, null, null, teamId);
    }
    if (apiKeyName || apiKeyId) {
      await this.recordAgainst(apiKeyName || null, safeTokens, safeCostUsd, apiKeyId);
    }
    await this.refreshBudgetMetricSnapshot();
  }

  /**
   * Get current budget status for rules.
   * No apiKeyName = global rules only; with apiKeyName = that key's rules.
   */
  async getStatus(apiKeyName?: string | null, apiKeyId?: string | null, namespaceId?: string | null, teamId?: string | null): Promise<BudgetStatus[]> {
    const targetKeyName = apiKeyName === undefined ? null : apiKeyName;
    const rules = namespaceId
      ? await this.loadActiveRules(null, null, namespaceId, null)
      : teamId
      ? await this.loadActiveRules(null, null, null, teamId)
      : apiKeyId
      ? await this.loadActiveRules(null, apiKeyId)
      : targetKeyName === null
      ? await this.loadActiveRules(null)
      : await this.loadActiveRules(targetKeyName);

    await this.resetExpiredPeriods(rules);

    const statuses: BudgetStatus[] = rules.map((r) => ({
      id: r.id,
      type: r.type,
      scope: r.namespace_id ? 'namespace' : r.team_id ? 'team' : r.api_key_id || r.api_key_name ? 'api_key' : 'global',
      apiKeyName: r.api_key_name,
      apiKeyId: r.api_key_id,
      namespaceId: r.namespace_id,
      teamId: r.team_id,
      limit: r.limit_value,
      current: r.current_value,
      percentage: r.limit_value > 0 ? r.current_value / r.limit_value : 0,
      alertThreshold: r.alert_threshold,
      isExceeded: r.current_value >= r.limit_value,
      isAlert: r.limit_value > 0 ? r.current_value / r.limit_value >= r.alert_threshold : false,
      periodStart: r.period_start,
      resetAt: this.nextResetAt(r),
    }));

    await this.refreshBudgetMetricSnapshot();
    return statuses;
  }

  /**
   * Reset a budget rule's counter (manual reset).
   */
  async resetRule(ruleId: number): Promise<void> {
    const rule = await this.budgetRepo.findOne({
      where: workspaceFindWhere(this.workspaceId(), { id: ruleId }),
    });
    if (rule) {
      rule.current_value = 0;
      rule.period_start = this.startOfDay(new Date());
      await this.budgetRepo.save(rule);
      await this.refreshBudgetMetricSnapshot();
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
      .andWhere(
        this.workspaceId() === DEFAULT_WORKSPACE_ID
          ? '(rule.workspace_id = :workspaceId OR rule.workspace_id IS NULL)'
          : 'rule.workspace_id = :workspaceId',
        { workspaceId: this.workspaceId() },
      )
      .andWhere('rule.namespace_id IS NULL')
      .andWhere('rule.team_id IS NULL')
      .andWhere('rule.is_active = :active', { active: true })
      .getRawMany();

    return results.map((r) => r.api_key_name);
  }

  // ── Private helpers ───────────────────────────────────────

  /**
   * Load active rules for a given scope (null = global, string = per-key).
   */
  private async loadActiveRules(apiKeyName: string | null, apiKeyId?: string | null, namespaceId?: string | null, teamId?: string | null): Promise<BudgetRule[]> {
    if (namespaceId) {
      return this.budgetRepo.find({
        where: workspaceFindWhere(this.workspaceId(), {
          namespace_id: namespaceId,
          team_id: IsNull(),
          is_active: true,
        }),
      });
    }
    if (teamId) {
      return this.budgetRepo.find({
        where: workspaceFindWhere(this.workspaceId(), {
          team_id: teamId,
          api_key_name: IsNull(),
          api_key_id: IsNull(),
          namespace_id: IsNull(),
          is_active: true,
        }),
      });
    }
    if (apiKeyId) {
      return this.budgetRepo.find({
        where: workspaceFindWhere(this.workspaceId(), {
          api_key_id: apiKeyId,
          team_id: IsNull(),
          is_active: true,
        }),
      });
    }
    return this.budgetRepo.find({
      where: workspaceFindWhere(this.workspaceId(), {
        api_key_name: apiKeyName === null ? IsNull() : apiKeyName,
        api_key_id: IsNull(),
        namespace_id: IsNull(),
        team_id: IsNull(),
        is_active: true,
      }),
    });
  }

  /**
   * Evaluate a set of rules, throwing BudgetExceededError if any is exceeded.
   */
  private evaluateRules(
    rules: BudgetRule[],
    apiKeyName: string | null,
    apiKeyId: string | null,
    namespaceId: string | null,
    teamId: string | null,
  ): void {
    for (const rule of rules) {
      if (rule.current_value >= rule.limit_value) {
        this.alertBudgetExceeded(rule, apiKeyName, apiKeyId || undefined, namespaceId, teamId);
        throw new BudgetExceededError(
          rule.type,
          rule.current_value,
          rule.limit_value,
          apiKeyName || rule.api_key_name,
          apiKeyId || rule.api_key_id,
          namespaceId || rule.namespace_id,
          teamId || rule.team_id,
          rule.period_start,
        );
      }
    }
  }

  /**
   * Record usage against rules for a specific scope.
   */
  private async recordAgainst(
    apiKeyName: string | null,
    tokens: number,
    costUsd: number,
    apiKeyId?: string | null,
    namespaceId?: string | null,
    teamId?: string | null,
  ): Promise<void> {
    const rules = await this.loadActiveRules(apiKeyName, apiKeyId, namespaceId, teamId);
    await this.resetExpiredPeriods(rules);

    for (const rule of rules) {
      const previousValue = rule.current_value;
      let increment = 0;

      if (rule.type === 'daily_tokens') {
        increment = tokens;
      } else if (rule.type === 'daily_cost') {
        increment = costUsd;
      }

      rule.current_value += increment;

      // Check alert threshold
      const pct = rule.limit_value > 0 ? rule.current_value / rule.limit_value : 0;
      const previousPct = rule.limit_value > 0 ? previousValue / rule.limit_value : 0;
      if (previousPct < rule.alert_threshold && pct >= rule.alert_threshold) {
        const scope = namespaceId
          ? `namespace "${namespaceId}"`
          : teamId
          ? `team "${teamId}"`
          : apiKeyName || apiKeyId
          ? `key "${apiKeyName || apiKeyId}"`
          : 'global';
        this.logger.warn(
          `Budget alert (${scope}): ${rule.type} at ${(pct * 100).toFixed(1)}% (${rule.current_value.toFixed(2)} / ${rule.limit_value})`,
        );
        this.alertBudgetThreshold(rule, pct, apiKeyName, apiKeyId || undefined, namespaceId || undefined, teamId || undefined);
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

  private nextResetAt(rule: BudgetRule): Date | null {
    if (!rule.type.startsWith('daily_')) return null;
    const reset = this.startOfDay(new Date(rule.period_start));
    reset.setDate(reset.getDate() + 1);
    return reset;
  }

  private sanitizeCounterValue(value: number): number {
    if (!Number.isFinite(value) || value < 0) return 0;
    return value;
  }

  private registerMetrics(): void {
    this.telemetry?.budgetUsageRatio.addCallback((observable) => {
      for (const item of this.budgetMetricSnapshot) {
        observable.observe(item.ratio, item.attrs);
      }
    });
  }

  private async refreshBudgetMetricSnapshot(): Promise<void> {
    try {
      const rules = await this.budgetRepo.find({
        where: workspaceFindWhere(this.workspaceId(), { is_active: true }),
      });
      const statuses: BudgetStatus[] = rules.map((r) => ({
        id: r.id,
        type: r.type,
        scope: r.namespace_id ? 'namespace' as const : r.team_id ? 'team' as const : r.api_key_id || r.api_key_name ? 'api_key' as const : 'global' as const,
        apiKeyName: r.api_key_name,
        apiKeyId: r.api_key_id,
        namespaceId: r.namespace_id,
        teamId: r.team_id,
        limit: r.limit_value,
        current: r.current_value,
        percentage: r.limit_value > 0 ? r.current_value / r.limit_value : 0,
        alertThreshold: r.alert_threshold,
        isExceeded: r.current_value >= r.limit_value,
        isAlert: r.limit_value > 0 ? r.current_value / r.limit_value >= r.alert_threshold : false,
        periodStart: r.period_start,
        resetAt: this.nextResetAt(r),
      }));
      this.updateBudgetMetricSnapshot(statuses);
    } catch (err) {
      this.logger.warn(`Failed to refresh budget metrics: ${(err as Error).message}`);
    }
  }

  private updateBudgetMetricSnapshot(statuses: BudgetStatus[]): void {
    const aggregates = new Map<string, {
      ratio: number;
      attrs: { scope: 'global' | 'api_key' | 'namespace' | 'team'; budget_type: string };
    }>();
    for (const status of statuses) {
      const key = `${status.scope}:${status.type}`;
      const current = aggregates.get(key);
      if (!current || status.percentage > current.ratio) {
        aggregates.set(key, {
          ratio: Math.max(0, status.percentage || 0),
          attrs: {
            scope: status.scope,
            budget_type: status.type,
          },
        });
      }
    }
    this.budgetMetricSnapshot = [...aggregates.values()];
  }

  private alertBudgetThreshold(
    rule: BudgetRule,
    percentage: number,
    apiKeyName?: string | null,
    apiKeyId?: string,
    namespaceId?: string,
    teamId?: string,
  ): void {
    this.alerts?.emit({
      type: 'budget_threshold',
      severity: 'warning',
      message: `Budget threshold reached for ${rule.type}: ${(percentage * 100).toFixed(1)}%.`,
      dedupeKey: this.budgetDedupeKey(rule, 'threshold'),
      details: this.budgetAlertDetails(rule, apiKeyName, apiKeyId, namespaceId, teamId, percentage),
    });
  }

  private alertBudgetExceeded(
    rule: BudgetRule,
    apiKeyName: string | null,
    apiKeyId?: string,
    namespaceId?: string | null,
    teamId?: string | null,
  ): void {
    const percentage = rule.limit_value > 0
      ? rule.current_value / rule.limit_value
      : 0;
    this.alerts?.emit({
      type: 'budget_exceeded',
      severity: 'critical',
      message: `Budget exceeded for ${rule.type}: ${rule.current_value.toFixed(2)} / ${rule.limit_value.toFixed(2)}.`,
      dedupeKey: this.budgetDedupeKey(rule, 'exceeded'),
      details: this.budgetAlertDetails(
        rule,
        apiKeyName || rule.api_key_name,
        apiKeyId || rule.api_key_id || undefined,
        namespaceId || rule.namespace_id || undefined,
        teamId || rule.team_id || undefined,
        percentage,
      ),
    });
  }

  private budgetAlertDetails(
    rule: BudgetRule,
    apiKeyName?: string | null,
    apiKeyId?: string,
    namespaceId?: string,
    teamId?: string,
    percentage?: number,
  ): Record<string, unknown> {
    return {
      scope: namespaceId || rule.namespace_id ? 'namespace' : teamId || rule.team_id ? 'team' : apiKeyName || apiKeyId ? 'api_key' : 'global',
      api_key_name: apiKeyName || null,
      api_key_id: apiKeyId || null,
      namespace_id: namespaceId || rule.namespace_id || null,
      team_id: teamId || rule.team_id || null,
      budget_type: rule.type,
      current: Number(rule.current_value.toFixed(6)),
      limit: Number(rule.limit_value.toFixed(6)),
      percentage: Number(((percentage ?? 0) * 100).toFixed(2)),
      alert_threshold: rule.alert_threshold,
      reset_at: this.nextResetAt(rule)?.toISOString() || null,
    };
  }

  private budgetDedupeKey(rule: BudgetRule, suffix: string): string {
    return [
      rule.namespace_id || rule.team_id || rule.api_key_id || rule.api_key_name || 'global',
      rule.type,
      suffix,
      this.startOfDay(new Date(rule.period_start)).toISOString(),
    ].join(':');
  }

  private workspaceId(): string {
    return normalizeWorkspaceId(this.workspaceContext.currentWorkspaceId());
  }
}
