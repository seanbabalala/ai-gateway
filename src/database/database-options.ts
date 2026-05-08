import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DatabaseConfig } from '../config/gateway.config';

type SharedTypeOrmOptions = Omit<
  TypeOrmModuleOptions,
  'type' | 'url' | 'database' | 'synchronize' | 'ssl' | 'extra' | 'poolSize'
>;

export interface DatabaseConnectionSummary {
  type: 'sqlite' | 'postgres';
  target: string;
  synchronize: boolean;
  pool?: {
    min: number;
    max: number;
    idle_timeout_ms: number;
    connection_timeout_ms: number;
    statement_timeout_ms?: number;
    query_timeout_ms?: number;
    max_uses?: number;
    application_name: string;
  };
  ssl?: 'disabled' | 'enabled' | 'enabled-no-verify';
}

interface PostgresPoolOptions {
  max: number;
  min: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statement_timeout?: number;
  query_timeout?: number;
  maxUses?: number;
  application_name: string;
}

export function buildTypeOrmDatabaseOptions(
  database: DatabaseConfig,
  shared: SharedTypeOrmOptions,
): TypeOrmModuleOptions {
  assertDatabaseRuntimeConfig(database);

  if (database.type === 'postgres') {
    const extra = buildPostgresPoolOptions(database);
    return {
      type: 'postgres',
      url: database.url,
      ...shared,
      synchronize: database.synchronize ?? false,
      poolSize: extra.max,
      ssl: normalizePostgresSsl(database.ssl),
      extra,
    };
  }

  return {
    type: 'better-sqlite3',
    database: database.path || './data/gateway.db',
    ...shared,
    synchronize: database.synchronize ?? true,
  };
}

export function databaseConnectionSummary(
  database: DatabaseConfig,
): DatabaseConnectionSummary {
  if (database.type === 'postgres') {
    const pool = buildPostgresPoolOptions(database);
    return {
      type: 'postgres',
      target: redactDatabaseUrl(database.url || ''),
      synchronize: database.synchronize ?? false,
      pool: {
        min: pool.min,
        max: pool.max,
        idle_timeout_ms: pool.idleTimeoutMillis,
        connection_timeout_ms: pool.connectionTimeoutMillis,
        statement_timeout_ms: pool.statement_timeout,
        query_timeout_ms: pool.query_timeout,
        max_uses: pool.maxUses,
        application_name: pool.application_name,
      },
      ssl: summarizePostgresSsl(database.ssl),
    };
  }

  return {
    type: 'sqlite',
    target: database.path || './data/gateway.db',
    synchronize: database.synchronize ?? true,
  };
}

export function redactDatabaseUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return rawUrl.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:***@');
  }
}

function buildPostgresPoolOptions(
  database: DatabaseConfig,
): PostgresPoolOptions {
  const pool = database.pool || {};
  return {
    max: pool.max ?? 10,
    min: pool.min ?? 0,
    idleTimeoutMillis: pool.idle_timeout_ms ?? 30_000,
    connectionTimeoutMillis: pool.connection_timeout_ms ?? 5_000,
    statement_timeout: pool.statement_timeout_ms,
    query_timeout: pool.query_timeout_ms,
    maxUses: pool.max_uses,
    application_name: pool.application_name || 'siftgate',
  };
}

function normalizePostgresSsl(
  ssl: DatabaseConfig['ssl'],
): boolean | Record<string, unknown> | undefined {
  if (ssl === undefined) return undefined;
  if (typeof ssl === 'boolean') return ssl;
  return {
    rejectUnauthorized: ssl.reject_unauthorized ?? true,
    ca: ssl.ca,
    cert: ssl.cert,
    key: ssl.key,
    servername: ssl.servername,
  };
}

function summarizePostgresSsl(ssl: DatabaseConfig['ssl']) {
  if (!ssl) return 'disabled';
  if (ssl === true) return 'enabled';
  return ssl.reject_unauthorized === false ? 'enabled-no-verify' : 'enabled';
}

function assertDatabaseRuntimeConfig(database: DatabaseConfig): void {
  if (database.type === 'sqlite') {
    if (!database.path) {
      throw new Error('Invalid database config: database.path is required for sqlite.');
    }
    return;
  }

  if (!database.url) {
    throw new Error('Invalid database config: database.url is required for postgres.');
  }
  let parsed: URL;
  try {
    parsed = new URL(database.url);
  } catch {
    throw new Error(
      'Invalid database config: database.url must be a valid postgres:// or postgresql:// URL.',
    );
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(
      'Invalid database config: database.url must use postgres:// or postgresql://.',
    );
  }

  const pool = database.pool || {};
  assertIntegerRange(pool.max, 'database.pool.max', 1, 500);
  assertIntegerRange(pool.min, 'database.pool.min', 0, 500);
  if (
    typeof pool.min === 'number' &&
    typeof pool.max === 'number' &&
    pool.min > pool.max
  ) {
    throw new Error('Invalid database config: database.pool.min cannot exceed database.pool.max.');
  }
  assertIntegerRange(
    pool.idle_timeout_ms,
    'database.pool.idle_timeout_ms',
    1000,
    3_600_000,
  );
  assertIntegerRange(
    pool.connection_timeout_ms,
    'database.pool.connection_timeout_ms',
    100,
    300_000,
  );
  assertIntegerRange(
    pool.statement_timeout_ms,
    'database.pool.statement_timeout_ms',
    0,
    3_600_000,
  );
  assertIntegerRange(
    pool.query_timeout_ms,
    'database.pool.query_timeout_ms',
    0,
    3_600_000,
  );
  assertIntegerRange(pool.max_uses, 'database.pool.max_uses', 0, 1_000_000);
  if (
    pool.application_name !== undefined &&
    (typeof pool.application_name !== 'string' || !pool.application_name.trim())
  ) {
    throw new Error(
      'Invalid database config: database.pool.application_name must be a non-empty string when set.',
    );
  }

  const ssl = database.ssl;
  if (ssl !== undefined && typeof ssl !== 'boolean') {
    if (ssl === null || typeof ssl !== 'object' || Array.isArray(ssl)) {
      throw new Error('Invalid database config: database.ssl must be a boolean or object.');
    }
    if (
      ssl.reject_unauthorized !== undefined &&
      typeof ssl.reject_unauthorized !== 'boolean'
    ) {
      throw new Error(
        'Invalid database config: database.ssl.reject_unauthorized must be a boolean when set.',
      );
    }
    for (const key of ['ca', 'cert', 'key', 'servername'] as const) {
      if (
        ssl[key] !== undefined &&
        (typeof ssl[key] !== 'string' || !ssl[key]?.trim())
      ) {
        throw new Error(
          `Invalid database config: database.ssl.${key} must be a non-empty string when set.`,
        );
      }
    }
  }
}

function assertIntegerRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(
      `Invalid database config: ${path} must be an integer between ${min} and ${max}.`,
    );
  }
}
