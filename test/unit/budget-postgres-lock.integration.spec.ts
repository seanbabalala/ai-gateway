import { DataSource, type Repository } from 'typeorm';
import {
  BudgetExceededError,
  BudgetService,
  type BudgetReservation,
} from '../../src/budget/budget.service';
import { BudgetRule } from '../../src/database/entities/budget-rule.entity';
import { mockConfigService } from '../helpers';

const POSTGRES_TEST_URL = resolvePostgresTestUrl();
const describePostgres = POSTGRES_TEST_URL ? describe : describe.skip;
const WORKSPACE_ID = 'postgres-budget-lock-smoke';

function resolvePostgresTestUrl(): string | null {
  const explicit =
    process.env.SIFTGATE_TEST_POSTGRES_URL ||
    process.env.SIFTGATE_POSTGRES_TEST_URL ||
    process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  if (process.env.SIFTGATE_RUN_DATABASE_URL_INTEGRATION_TESTS === 'true') {
    return databaseUrl;
  }

  return isLocalPostgresUrl(databaseUrl) ? databaseUrl : null;
}

function isLocalPostgresUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(host);
  } catch {
    return false;
  }
}

function schemaIdentifier(): string {
  return [
    'siftgate_budget_lock',
    process.pid,
    Date.now(),
    Math.random().toString(36).slice(2, 10),
  ].join('_');
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function withAdminDataSource<T>(
  url: string,
  run: (dataSource: DataSource) => Promise<T>,
): Promise<T> {
  const dataSource = new DataSource({
    type: 'postgres',
    url,
    synchronize: false,
    logging: false,
    extra: {
      application_name: 'siftgate-budget-lock-smoke-admin',
    },
  });

  await dataSource.initialize();
  try {
    return await run(dataSource);
  } finally {
    await dataSource.destroy();
  }
}

function makeBudgetService(repo: Repository<BudgetRule>): BudgetService {
  const config = mockConfigService({
    budget: {
      daily_token_limit: 100,
      daily_cost_limit: 5,
      alert_threshold: 0.8,
    },
  });
  const workspaceContext = {
    currentWorkspaceId: jest.fn(() => WORKSPACE_ID),
  };
  const telemetry = {
    budgetUsageRatio: {
      addCallback: jest.fn(),
    },
    recordBudgetReservation: jest.fn(),
  };

  return new BudgetService(
    config,
    workspaceContext as any,
    repo,
    undefined,
    telemetry as any,
  );
}

describePostgres('BudgetService PostgreSQL row-lock integration', () => {
  jest.setTimeout(30_000);

  let schemaName: string;
  let dataSource: DataSource;
  let repo: Repository<BudgetRule>;

  beforeAll(async () => {
    schemaName = schemaIdentifier();
    await withAdminDataSource(POSTGRES_TEST_URL!, async (admin) => {
      await admin.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    });

    dataSource = new DataSource({
      type: 'postgres',
      url: POSTGRES_TEST_URL!,
      schema: schemaName,
      entities: [BudgetRule],
      synchronize: true,
      logging: false,
      extra: {
        max: 4,
        application_name: 'siftgate-budget-lock-smoke',
      },
    });
    await dataSource.initialize();
    repo = dataSource.getRepository(BudgetRule);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    if (POSTGRES_TEST_URL && schemaName) {
      await withAdminDataSource(POSTGRES_TEST_URL, async (admin) => {
        await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      });
    }
  });

  beforeEach(async () => {
    await repo.clear();
  });

  it('serializes competing budget reservations through PostgreSQL row locks', async () => {
    const rule = await repo.save(repo.create({
      workspace_id: WORKSPACE_ID,
      type: 'daily_tokens',
      limit_value: 100,
      alert_threshold: 0.8,
      current_value: 0,
      period_start: new Date(),
      is_active: true,
      api_key_name: null,
      api_key_id: null,
      namespace_id: null,
      team_id: null,
    }));
    const firstService = makeBudgetService(repo);
    const secondService = makeBudgetService(repo);

    const results = await Promise.allSettled([
      firstService.reserve(60, 0),
      secondService.reserve(60, 0),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<BudgetReservation> =>
        result.status === 'fulfilled',
    );
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BudgetExceededError);

    const reserved = await repo.findOneByOrFail({ id: rule.id });
    expect(reserved.current_value).toBe(60);

    await fulfilled[0].value.release();

    const released = await repo.findOneByOrFail({ id: rule.id });
    expect(released.current_value).toBe(0);
  });
});
