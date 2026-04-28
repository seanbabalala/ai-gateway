import { BudgetService, BudgetExceededError } from '../../src/budget/budget.service';
import { mockConfigService } from '../helpers';

/**
 * In-memory mock for TypeORM Repository<BudgetRule>.
 * Stores entities in an array and simulates basic CRUD.
 */
function mockBudgetRepo() {
  let store: any[] = [];
  let nextId = 1;

  return {
    _store: store,
    find: jest.fn(async (opts?: any) => {
      if (opts?.where?.is_active !== undefined) {
        return store.filter((r) => r.is_active === opts.where.is_active);
      }
      return [...store];
    }),
    findOneBy: jest.fn(async (where: any) => {
      return store.find((r) => r.id === where.id) || null;
    }),
    create: jest.fn((partial: any) => ({ ...partial })),
    save: jest.fn(async (entity: any) => {
      if (!entity.id) {
        entity.id = nextId++;
      }
      const idx = store.findIndex((r) => r.id === entity.id);
      if (idx >= 0) {
        store[idx] = entity;
      } else {
        store.push(entity);
      }
      return entity;
    }),
    clear: () => { store.length = 0; nextId = 1; },
  };
}

function makeService(overrides: Record<string, unknown> = {}) {
  const config = mockConfigService({
    budget: {
      daily_token_limit: 100_000,
      daily_cost_limit: 5.0,
      alert_threshold: 0.8,
      ...overrides,
    },
  });
  const repo = mockBudgetRepo();
  const svc = new BudgetService(config, repo as any);
  return { svc, repo, config };
}

describe('BudgetService', () => {
  // ── ensureDefaultRules (via onModuleInit) ────────────────

  describe('onModuleInit (ensureDefaultRules)', () => {
    it('should create default rules when none exist', async () => {
      const { svc, repo } = makeService();
      await svc.onModuleInit();

      expect(repo.save).toHaveBeenCalled();
      expect(repo._store.length).toBe(2);
      expect(repo._store.map((r: any) => r.type)).toContain('daily_tokens');
      expect(repo._store.map((r: any) => r.type)).toContain('daily_cost');
    });

    it('should not create rules if they already exist', async () => {
      const { svc, repo } = makeService();
      // Pre-populate store
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
      });
      repo._store.push({
        id: 2,
        type: 'daily_cost',
        limit_value: 5.0,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
      });

      const saveCountBefore = repo.save.mock.calls.length;
      await svc.onModuleInit();
      // Should only save if period reset is needed (same day → no reset)
      // No new entities should be created
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  // ── check ────────────────────────────────────────────────

  describe('check', () => {
    it('should not throw when under budget', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 50_000,
        period_start: new Date(),
        is_active: true,
      });

      await expect(svc.check()).resolves.not.toThrow();
    });

    it('should throw BudgetExceededError when over budget', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 100_000, // at limit
        period_start: new Date(),
        is_active: true,
      });

      await expect(svc.check()).rejects.toThrow(BudgetExceededError);
    });
  });

  // ── record ───────────────────────────────────────────────

  describe('record', () => {
    it('should increment token counter for daily_tokens rule', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
      });
      repo._store.push({
        id: 2,
        type: 'daily_cost',
        limit_value: 5.0,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
      });

      await svc.record(1000, 0.05);

      expect(repo._store[0].current_value).toBe(1000);
      expect(repo._store[1].current_value).toBeCloseTo(0.05);
    });
  });

  // ── Daily reset ──────────────────────────────────────────

  describe('daily reset', () => {
    it('should reset counters when period has expired (new day)', async () => {
      const { svc, repo } = makeService();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 90_000,
        period_start: yesterday,
        is_active: true,
      });

      // check() triggers resetExpiredPeriods internally
      await svc.check();

      expect(repo._store[0].current_value).toBe(0);
    });
  });

  // ── getStatus ────────────────────────────────────────────

  describe('getStatus', () => {
    it('should return budget status for all rules', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 50_000,
        period_start: new Date(),
        is_active: true,
      });

      const status = await svc.getStatus();
      expect(status).toHaveLength(1);
      expect(status[0].type).toBe('daily_tokens');
      expect(status[0].limit).toBe(100_000);
      expect(status[0].current).toBe(50_000);
      expect(status[0].percentage).toBeCloseTo(0.5);
      expect(status[0].isExceeded).toBe(false);
      expect(status[0].isAlert).toBe(false);
    });

    it('should mark isAlert when over alert threshold', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 85_000,
        period_start: new Date(),
        is_active: true,
      });

      const status = await svc.getStatus();
      expect(status[0].isAlert).toBe(true);
      expect(status[0].isExceeded).toBe(false);
    });

    it('should mark isExceeded when at or over limit', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_cost',
        limit_value: 5.0,
        alert_threshold: 0.8,
        current_value: 5.5,
        period_start: new Date(),
        is_active: true,
      });

      const status = await svc.getStatus();
      expect(status[0].isExceeded).toBe(true);
    });
  });

  // ── resetRule ────────────────────────────────────────────

  describe('resetRule', () => {
    it('should reset a rule counter to 0', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 99_000,
        period_start: new Date(),
        is_active: true,
      });

      await svc.resetRule(1);

      expect(repo._store[0].current_value).toBe(0);
    });

    it('should do nothing for non-existent rule', async () => {
      const { svc, repo } = makeService();
      await svc.resetRule(999);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
