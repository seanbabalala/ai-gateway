import {
  CallLogSchemaPatchService,
  applyCallLogSchemaPatches,
  applyCallLogCostWithoutCacheSchemaPatch,
  applyCallLogStreamSchemaPatch,
  applyAgentMetadataSchemaPatches,
  hasCallLogCostWithoutCacheColumn,
  hasCallLogAgentMetadataColumn,
  hasRouteDecisionAgentMetadataColumn,
  hasCallLogStreamColumn,
  revertCallLogCostWithoutCacheSchemaPatch,
} from '../../src/database/call-log-schema-patch.service';

describe('CallLog schema patch', () => {
  function mockMissingMetadataColumns(
    query: jest.Mock,
    tableRow: unknown,
    count = 9,
  ): void {
    query.mockResolvedValueOnce([tableRow]);
    for (let index = 0; index < count; index += 1) {
      query.mockResolvedValueOnce([]);
      query.mockResolvedValueOnce(undefined);
    }
  }

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

  it('applies the PostgreSQL stream column patch when stream is missing', async () => {
    const dataSource = {
      options: { type: 'postgres' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ table_name: 'call_logs' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined),
    } as any;

    const applied = await applyCallLogStreamSchemaPatch(dataSource);

    expect(applied).toBe(true);
    expect(dataSource.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SELECT column_name'),
      ['call_logs', 'stream'],
    );
    expect(dataSource.query).toHaveBeenNthCalledWith(
      3,
      'ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS stream boolean NOT NULL DEFAULT false',
    );
  });

  it('applies all missing call log schema patches in order', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ name: 'call_logs' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ name: 'call_logs' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);
    mockMissingMetadataColumns(query, { name: 'call_logs' });
    mockMissingMetadataColumns(query, { name: 'route_decisions' });
    const dataSource = {
      options: { type: 'better-sqlite3' },
      query,
    } as any;

    const applied = await applyCallLogSchemaPatches(dataSource);

    expect(applied).toEqual(expect.arrayContaining([
      'cost_without_cache_usd',
      'stream',
      'agent_connector',
      'route_decisions.agent_connector',
    ]));
    expect(dataSource.query).toHaveBeenNthCalledWith(
      3,
      'ALTER TABLE call_logs ADD COLUMN cost_without_cache_usd real',
    );
    expect(dataSource.query).toHaveBeenNthCalledWith(
      6,
      'ALTER TABLE call_logs ADD COLUMN stream boolean NOT NULL DEFAULT 0',
    );
  });

  it('applies coding-agent metadata columns to call logs and route decisions', async () => {
    const query = jest.fn();
    mockMissingMetadataColumns(query, { table_name: 'call_logs' });
    mockMissingMetadataColumns(query, { table_name: 'route_decisions' });
    const dataSource = {
      options: { type: 'postgres' },
      query,
    } as any;

    const applied = await applyAgentMetadataSchemaPatches(dataSource);

    expect(applied).toEqual(expect.arrayContaining([
      'call_logs.agent_connector',
      'call_logs.agent_project',
      'route_decisions.agent_connector',
      'route_decisions.agent_project',
    ]));
    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS agent_connector varchar NULL',
    );
    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE route_decisions ADD COLUMN IF NOT EXISTS agent_connector varchar NULL',
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

  it('detects the stream column via the driver-specific metadata query', async () => {
    const postgres = {
      options: { type: 'postgres' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ table_name: 'call_logs' }])
        .mockResolvedValueOnce([{ column_name: 'stream' }]),
    } as any;
    const sqlite = {
      options: { type: 'better-sqlite3' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ name: 'call_logs' }])
        .mockResolvedValueOnce([{ name: 'stream' }]),
    } as any;

    await expect(hasCallLogStreamColumn(postgres)).resolves.toBe(true);
    await expect(hasCallLogStreamColumn(sqlite)).resolves.toBe(true);
  });

  it('detects agent metadata columns via the driver-specific metadata query', async () => {
    const postgres = {
      options: { type: 'postgres' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ table_name: 'call_logs' }])
        .mockResolvedValueOnce([{ column_name: 'agent_connector' }])
        .mockResolvedValueOnce([{ table_name: 'route_decisions' }])
        .mockResolvedValueOnce([{ column_name: 'agent_connector' }]),
    } as any;

    await expect(hasCallLogAgentMetadataColumn(postgres)).resolves.toBe(true);
    await expect(hasRouteDecisionAgentMetadataColumn(postgres)).resolves.toBe(true);
  });

  it('runs the startup patch through the service on module init', async () => {
    const dataSource = {
      options: { type: 'better-sqlite3' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ name: 'call_logs' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ name: 'call_logs' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    } as any;
    const service = new CallLogSchemaPatchService(dataSource);

    await service.onModuleInit();

    expect(dataSource.query).toHaveBeenCalledTimes(8);
    expect(dataSource.query).toHaveBeenNthCalledWith(
      3,
      'ALTER TABLE call_logs ADD COLUMN cost_without_cache_usd real',
    );
    expect(dataSource.query).toHaveBeenNthCalledWith(
      6,
      'ALTER TABLE call_logs ADD COLUMN stream boolean NOT NULL DEFAULT 0',
    );
  });
});
