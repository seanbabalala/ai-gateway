import {
  buildTypeOrmDatabaseOptions,
  databaseConnectionSummary,
  redactDatabaseUrl,
} from '../../src/database/database-options';

describe('database options', () => {
  const shared = { entities: [], logging: false };

  it('keeps SQLite as the local default with synchronize enabled', () => {
    const options = buildTypeOrmDatabaseOptions(
      { type: 'sqlite', path: ':memory:' },
      shared,
    );

    expect(options).toMatchObject({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: true,
    });
  });

  it('builds PostgreSQL production pool and SSL options', () => {
    const options = buildTypeOrmDatabaseOptions(
      {
        type: 'postgres',
        url: 'postgresql://siftgate:secret@db:5432/siftgate',
        synchronize: false,
        pool: {
          min: 1,
          max: 20,
          idle_timeout_ms: 45_000,
          connection_timeout_ms: 3000,
          statement_timeout_ms: 60_000,
          query_timeout_ms: 60_000,
          max_uses: 5000,
          application_name: 'siftgate-prod',
        },
        ssl: { reject_unauthorized: false, servername: 'db.example.com' },
      },
      shared,
    );

    expect(options.type).toBe('postgres');
    expect(options.synchronize).toBe(false);
    expect(options.poolSize).toBe(20);
    expect(options.extra).toMatchObject({
      min: 1,
      max: 20,
      idleTimeoutMillis: 45_000,
      connectionTimeoutMillis: 3000,
      statement_timeout: 60_000,
      query_timeout: 60_000,
      maxUses: 5000,
      application_name: 'siftgate-prod',
    });
    expect((options as { ssl?: unknown }).ssl).toMatchObject({
      rejectUnauthorized: false,
      servername: 'db.example.com',
    });
  });

  it('redacts database passwords in summaries', () => {
    expect(
      databaseConnectionSummary({
        type: 'postgres',
        url: 'postgresql://siftgate:secret@db:5432/siftgate',
        synchronize: false,
      }),
    ).toMatchObject({
      type: 'postgres',
      target: 'postgresql://siftgate:***@db:5432/siftgate',
      synchronize: false,
      ssl: 'disabled',
    });
    expect(
      redactDatabaseUrl('postgresql://siftgate:secret@db:5432/siftgate'),
    ).not.toContain('secret');
  });

  it('fails fast for invalid PostgreSQL pool settings', () => {
    expect(() =>
      buildTypeOrmDatabaseOptions(
        {
          type: 'postgres',
          url: 'postgresql://siftgate:secret@db:5432/siftgate',
          pool: { min: 5, max: 2 },
        },
        shared,
      ),
    ).toThrow('database.pool.min cannot exceed database.pool.max');
  });
});
