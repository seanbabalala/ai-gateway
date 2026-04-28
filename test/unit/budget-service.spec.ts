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
      if (!opts?.where) return [...store];
      const where = opts.where;
      let results = [...store];

      if ('is_active' in where) {
        results = results.filter((r) => r.is_active === where.is_active);
      }
      if ('api_key_name' in where) {
        const target = where.api_key_name;
        // Handle TypeORM IsNull() — it becomes FindOperator
        if (target === null || (target && typeof target === 'object' && target._type === 'isNull')) {
          results = results.filter((r) => r.api_key_name === null || r.api_key_name === undefined);
        } else {
          results = results.filter((r) => r.api_key_name === target);
        }
      }
      return results;
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
    createQueryBuilder: jest.fn(() => {
      const qb: any = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn(async () => {
          // Return per-key rules that are active
          const perKeyActive = store.filter((r) => r.api_key_name && r.is_active);
          const uniqueKeys = [...new Set(perKeyActive.map((r) => r.api_key_name))];
          return uniqueKeys.map((k) => ({ api_key_name: k }));
        }),
        getMany: jest.fn(async () => {
          return store.filter((r) => r.api_key_name && r.is_active);
        }),
      };
      return qb;
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
    auth: {
      api_keys: (overrides as any).api_keys || [],
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
      // All global rules should have null api_key_name
      expect(repo._store.every((r: any) => r.api_key_name === null)).toBe(true);
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
        api_key_name: null,
      });
      repo._store.push({
        id: 2,
        type: 'daily_cost',
        limit_value: 5.0,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
        api_key_name: null,
      });

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
        api_key_name: null,
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
        api_key_name: null,
      });

      await expect(svc.check()).rejects.toThrow(BudgetExceededError);
    });

    it('should check only global rules when no apiKeyName passed', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 50_000,
        period_start: new Date(),
        is_active: true,
        api_key_name: null,
      });
      // per-key rule is over limit but shouldn't be checked
      repo._store.push({
        id: 2,
        type: 'daily_tokens',
        limit_value: 10_000,
        alert_threshold: 0.8,
        current_value: 15_000,
        period_start: new Date(),
        is_active: true,
        api_key_name: 'intern',
      });

      await expect(svc.check()).resolves.not.toThrow();
    });

    it('should check both global and per-key when apiKeyName passed', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 50_000,
        period_start: new Date(),
        is_active: true,
        api_key_name: null,
      });
      // per-key rule is over limit
      repo._store.push({
        id: 2,
        type: 'daily_tokens',
        limit_value: 10_000,
        alert_threshold: 0.8,
        current_value: 15_000,
        period_start: new Date(),
        is_active: true,
        api_key_name: 'intern',
      });

      await expect(svc.check('intern')).rejects.toThrow(BudgetExceededError);
    });

    it('should throw when global is exceeded even if per-key is under', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 100_000, // at global limit
        period_start: new Date(),
        is_active: true,
        api_key_name: null,
      });
      repo._store.push({
        id: 2,
        type: 'daily_tokens',
        limit_value: 50_000,
        alert_threshold: 0.8,
        current_value: 1_000, // well under per-key limit
        period_start: new Date(),
        is_active: true,
        api_key_name: 'sean',
      });

      await expect(svc.check('sean')).rejects.toThrow(BudgetExceededError);
    });

    it('should include apiKeyName in error when per-key limit exceeded', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_cost',
        limit_value: 100,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
        api_key_name: null,
      });
      repo._store.push({
        id: 2,
        type: 'daily_cost',
        limit_value: 5,
        alert_threshold: 0.8,
        current_value: 6,
        period_start: new Date(),
        is_active: true,
        api_key_name: 'intern',
      });

      try {
        await svc.check('intern');
        fail('Expected BudgetExceededError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(BudgetExceededError);
        expect(err.apiKeyName).toBe('intern');
        expect(err.message).toContain('key "intern"');
      }
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
        api_key_name: null,
      });
      repo._store.push({
        id: 2,
        type: 'daily_cost',
        limit_value: 5.0,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
        api_key_name: null,
      });

      await svc.record(1000, 0.05);

      expect(repo._store[0].current_value).toBe(1000);
      expect(repo._store[1].current_value).toBeCloseTo(0.05);
    });

    it('should only update global rules when no apiKeyName', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
        api_key_name: null,
      });
      repo._store.push({
        id: 2,
        type: 'daily_tokens',
        limit_value: 10_000,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
        api_key_name: 'sean',
      });

      await svc.record(500, 0.01);

      expect(repo._store[0].current_value).toBe(500); // global updated
      expect(repo._store[1].current_value).toBe(0); // per-key NOT updated
    });

    it('should update both global and per-key when apiKeyName provided', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
        api_key_name: null,
      });
      repo._store.push({
        id: 2,
        type: 'daily_tokens',
        limit_value: 10_000,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
        api_key_name: 'sean',
      });

      await svc.record(500, 0.01, 'sean');

      expect(repo._store[0].current_value).toBe(500); // global updated
      expect(repo._store[1].current_value).toBe(500); // per-key updated
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
        api_key_name: null,
      });

      // check() triggers resetExpiredPeriods internally
      await svc.check();

      expect(repo._store[0].current_value).toBe(0);
    });
  });

  // ── getStatus ────────────────────────────────────────────

  describe('getStatus', () => {
    it('should return budget status for global rules (no arg)', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 50_000,
        period_start: new Date(),
        is_active: true,
        api_key_name: null,
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

    it('should return per-key rules when apiKeyName provided', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_cost',
        limit_value: 100,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
        api_key_name: null,
      });
      repo._store.push({
        id: 2,
        type: 'daily_cost',
        limit_value: 5,
        alert_threshold: 0.8,
        current_value: 3,
        period_start: new Date(),
        is_active: true,
        api_key_name: 'intern',
      });

      const status = await svc.getStatus('intern');
      expect(status).toHaveLength(1);
      expect(status[0].type).toBe('daily_cost');
      expect(status[0].limit).toBe(5);
      expect(status[0].current).toBe(3);
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
        api_key_name: null,
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
        api_key_name: null,
      });

      const status = await svc.getStatus();
      expect(status[0].isExceeded).toBe(true);
    });
  });

  // ── getKeysWithBudgets ─────────────────────────────────

  describe('getKeysWithBudgets', () => {
    it('should return list of keys with active per-key rules', async () => {
      const { svc, repo } = makeService();
      repo._store.push({
        id: 1,
        type: 'daily_tokens',
        limit_value: 100_000,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
        api_key_name: null,
      });
      repo._store.push({
        id: 2,
        type: 'daily_cost',
        limit_value: 5,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
        api_key_name: 'intern',
      });
      repo._store.push({
        id: 3,
        type: 'daily_cost',
        limit_value: 50,
        alert_threshold: 0.8,
        current_value: 0,
        period_start: new Date(),
        is_active: true,
        api_key_name: 'sean',
      });

      const keys = await svc.getKeysWithBudgets();
      expect(keys).toContain('intern');
      expect(keys).toContain('sean');
      expect(keys).not.toContain(null);
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
        api_key_name: null,
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

  // ── BudgetExceededError ─────────────────────────────────

  describe('BudgetExceededError', () => {
    it('should format global scope correctly', () => {
      const err = new BudgetExceededError('daily_tokens', 100000, 100000);
      expect(err.message).toContain('global');
      expect(err.apiKeyName).toBeUndefined();
    });

    it('should format per-key scope correctly', () => {
      const err = new BudgetExceededError('daily_cost', 6, 5, 'intern');
      expect(err.message).toContain('key "intern"');
      expect(err.apiKeyName).toBe('intern');
    });
  });
});
