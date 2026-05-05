import {
  CallLogSchemaPatchService,
  applyCallLogCostWithoutCacheSchemaPatch,
  hasCallLogCostWithoutCacheColumn,
  revertCallLogCostWithoutCacheSchemaPatch,
} from '../../src/database/call-log-schema-patch.service';

describe('CallLog schema patch', () => {
  it('applies the PostgreSQL column patch when cost_without_cache_usd is missing', async () => {
    const dataSource = {
      options: { type: 'postgres' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ table_name: 'call_logs' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined),
    } as any;

    const applied = await applyCallLogCostWithoutCacheSchemaPatch(dataSource);

    expect(applied).toBe(true);
    expect(dataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM information_schema.tables'),
      ['call_logs'],
    );
    expect(dataSource.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SELECT column_name'),
      ['call_logs', 'cost_without_cache_usd'],
    );
    expect(dataSource.query).toHaveBeenNthCalledWith(
      3,
      'ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS cost_without_cache_usd double precision NULL',
    );
  });

  it('skips applying the schema patch when call_logs does not exist yet', async () => {
    const dataSource = {
      options: { type: 'better-sqlite3' },
      query: jest.fn().mockResolvedValueOnce([]),
    } as any;

    const applied = await applyCallLogCostWithoutCacheSchemaPatch(dataSource);

    expect(applied).toBe(false);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM sqlite_master'),
    );
  });

  it('skips applying the SQLite patch when the column already exists', async () => {
    const dataSource = {
      options: { type: 'better-sqlite3' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ name: 'call_logs' }])
        .mockResolvedValueOnce([{ name: 'cost_without_cache_usd' }]),
    } as any;

    const applied = await applyCallLogCostWithoutCacheSchemaPatch(dataSource);

    expect(applied).toBe(false);
    expect(dataSource.query).toHaveBeenCalledTimes(2);
    expect(dataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM sqlite_master'),
    );
    expect(dataSource.query).toHaveBeenNthCalledWith(
      2,
      "PRAGMA table_info('call_logs')",
    );
  });

  it('reverts the schema patch for both PostgreSQL and SQLite drivers', async () => {
    const postgres = {
      options: { type: 'postgres' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ table_name: 'call_logs' }])
        .mockResolvedValueOnce([{ column_name: 'cost_without_cache_usd' }])
        .mockResolvedValueOnce(undefined),
    } as any;
    const sqlite = {
      options: { type: 'better-sqlite3' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ name: 'call_logs' }])
        .mockResolvedValueOnce([{ name: 'cost_without_cache_usd' }])
        .mockResolvedValueOnce(undefined),
    } as any;

    await expect(
      revertCallLogCostWithoutCacheSchemaPatch(postgres),
    ).resolves.toBe(true);
    await expect(
      revertCallLogCostWithoutCacheSchemaPatch(sqlite),
    ).resolves.toBe(true);

    expect(postgres.query).toHaveBeenLastCalledWith(
      'ALTER TABLE call_logs DROP COLUMN IF EXISTS cost_without_cache_usd',
    );
    expect(sqlite.query).toHaveBeenLastCalledWith(
      'ALTER TABLE call_logs DROP COLUMN cost_without_cache_usd',
    );
  });

  it('detects the new column via the driver-specific metadata query', async () => {
    const postgres = {
      options: { type: 'postgres' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ table_name: 'call_logs' }])
        .mockResolvedValueOnce([{ column_name: 'cost_without_cache_usd' }]),
    } as any;
    const sqlite = {
      options: { type: 'better-sqlite3' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ name: 'call_logs' }])
        .mockResolvedValueOnce([{ name: 'cost_without_cache_usd' }]),
    } as any;

    await expect(hasCallLogCostWithoutCacheColumn(postgres)).resolves.toBe(true);
    await expect(hasCallLogCostWithoutCacheColumn(sqlite)).resolves.toBe(true);
  });

  it('runs the startup patch through the service on module init', async () => {
    const dataSource = {
      options: { type: 'better-sqlite3' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ name: 'call_logs' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined),
    } as any;
    const service = new CallLogSchemaPatchService(dataSource);

    await service.onModuleInit();

    expect(dataSource.query).toHaveBeenCalledTimes(3);
    expect(dataSource.query).toHaveBeenNthCalledWith(
      3,
      'ALTER TABLE call_logs ADD COLUMN cost_without_cache_usd real',
    );
  });
});
