import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

const CALL_LOGS_TABLE = 'call_logs';
const COST_WITHOUT_CACHE_COLUMN = 'cost_without_cache_usd';
const STREAM_COLUMN = 'stream';

type SupportedDatabaseDriver = 'postgres' | 'better-sqlite3';

@Injectable()
export class CallLogSchemaPatchService implements OnModuleInit {
  private readonly logger = new Logger(CallLogSchemaPatchService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (!supportsSchemaPatch(this.dataSource)) return;

    const applied = await applyCallLogSchemaPatches(this.dataSource);
    for (const column of applied) {
      this.logger.log(`Applied schema patch: ${CALL_LOGS_TABLE}.${column}`);
    }
  }
}

export async function applyCallLogSchemaPatches(
  dataSource: DataSource,
): Promise<string[]> {
  const applied: string[] = [];
  if (await applyCallLogCostWithoutCacheSchemaPatch(dataSource)) {
    applied.push(COST_WITHOUT_CACHE_COLUMN);
  }
  if (await applyCallLogStreamSchemaPatch(dataSource)) {
    applied.push(STREAM_COLUMN);
  }
  return applied;
}

export async function applyCallLogCostWithoutCacheSchemaPatch(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  if (!(await hasCallLogsTable(dataSource))) return false;
  if (await hasCallLogColumnInternal(dataSource, COST_WITHOUT_CACHE_COLUMN, true)) {
    return false;
  }

  if (dataSource.options.type === 'postgres') {
    await dataSource.query(
      `ALTER TABLE ${CALL_LOGS_TABLE} ADD COLUMN IF NOT EXISTS ${COST_WITHOUT_CACHE_COLUMN} double precision NULL`,
    );
    return true;
  }

  await dataSource.query(
    `ALTER TABLE ${CALL_LOGS_TABLE} ADD COLUMN ${COST_WITHOUT_CACHE_COLUMN} real`,
  );
  return true;
}

export async function applyCallLogStreamSchemaPatch(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  if (!(await hasCallLogsTable(dataSource))) return false;
  if (await hasCallLogColumnInternal(dataSource, STREAM_COLUMN, true)) {
    return false;
  }

  if (dataSource.options.type === 'postgres') {
    await dataSource.query(
      `ALTER TABLE ${CALL_LOGS_TABLE} ADD COLUMN IF NOT EXISTS ${STREAM_COLUMN} boolean NOT NULL DEFAULT false`,
    );
    return true;
  }

  await dataSource.query(
    `ALTER TABLE ${CALL_LOGS_TABLE} ADD COLUMN ${STREAM_COLUMN} boolean NOT NULL DEFAULT 0`,
  );
  return true;
}

export async function revertCallLogCostWithoutCacheSchemaPatch(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  if (!(await hasCallLogsTable(dataSource))) return false;
  if (!(await hasCallLogColumnInternal(dataSource, COST_WITHOUT_CACHE_COLUMN, true))) {
    return false;
  }

  if (dataSource.options.type === 'postgres') {
    await dataSource.query(
      `ALTER TABLE ${CALL_LOGS_TABLE} DROP COLUMN IF EXISTS ${COST_WITHOUT_CACHE_COLUMN}`,
    );
    return true;
  }

  await dataSource.query(
    `ALTER TABLE ${CALL_LOGS_TABLE} DROP COLUMN ${COST_WITHOUT_CACHE_COLUMN}`,
  );
  return true;
}

export async function hasCallLogCostWithoutCacheColumn(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  return hasCallLogColumnInternal(dataSource, COST_WITHOUT_CACHE_COLUMN);
}

export async function hasCallLogStreamColumn(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  return hasCallLogColumnInternal(dataSource, STREAM_COLUMN);
}

async function hasCallLogColumnInternal(
  dataSource: DataSource,
  column: string,
  assumeTableExists = false,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  if (!assumeTableExists && !(await hasCallLogsTable(dataSource))) return false;

  if (dataSource.options.type === 'postgres') {
    const rows = (await dataSource.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = $2`,
      [CALL_LOGS_TABLE, column],
    )) as Array<{ column_name?: string }>;
    return rows.some((row) => row.column_name === column);
  }

  const rows = (await dataSource.query(
    `PRAGMA table_info('${CALL_LOGS_TABLE}')`,
  )) as Array<{ name?: string }>;
  return rows.some((row) => row.name === column);
}

async function hasCallLogsTable(dataSource: DataSource): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;

  if (dataSource.options.type === 'postgres') {
    const rows = (await dataSource.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = $1`,
      [CALL_LOGS_TABLE],
    )) as Array<{ table_name?: string }>;
    return rows.some((row) => row.table_name === CALL_LOGS_TABLE);
  }

  const rows = (await dataSource.query(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'
        AND name = '${CALL_LOGS_TABLE}'`,
  )) as Array<{ name?: string }>;
  return rows.some((row) => row.name === CALL_LOGS_TABLE);
}

function supportsSchemaPatch(
  dataSource: DataSource,
): dataSource is DataSource & { options: { type: SupportedDatabaseDriver } } {
  return (
    dataSource.options.type === 'postgres' ||
    dataSource.options.type === 'better-sqlite3'
  );
}
