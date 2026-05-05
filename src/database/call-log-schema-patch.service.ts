import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

const CALL_LOGS_TABLE = 'call_logs';
const COST_WITHOUT_CACHE_COLUMN = 'cost_without_cache_usd';

type SupportedDatabaseDriver = 'postgres' | 'better-sqlite3';

@Injectable()
export class CallLogSchemaPatchService implements OnModuleInit {
  private readonly logger = new Logger(CallLogSchemaPatchService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (!supportsSchemaPatch(this.dataSource)) return;

    const applied = await applyCallLogCostWithoutCacheSchemaPatch(
      this.dataSource,
    );
    if (applied) {
      this.logger.log(
        `Applied schema patch: ${CALL_LOGS_TABLE}.${COST_WITHOUT_CACHE_COLUMN}`,
      );
    }
  }
}

export async function applyCallLogCostWithoutCacheSchemaPatch(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  if (!(await hasCallLogsTable(dataSource))) return false;
  if (await hasCallLogCostWithoutCacheColumnInternal(dataSource, true)) {
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

export async function revertCallLogCostWithoutCacheSchemaPatch(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  if (!(await hasCallLogsTable(dataSource))) return false;
  if (!(await hasCallLogCostWithoutCacheColumnInternal(dataSource, true))) {
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
  return hasCallLogCostWithoutCacheColumnInternal(dataSource);
}

async function hasCallLogCostWithoutCacheColumnInternal(
  dataSource: DataSource,
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
      [CALL_LOGS_TABLE, COST_WITHOUT_CACHE_COLUMN],
    )) as Array<{ column_name?: string }>;
    return rows.some((row) => row.column_name === COST_WITHOUT_CACHE_COLUMN);
  }

  const rows = (await dataSource.query(
    `PRAGMA table_info('${CALL_LOGS_TABLE}')`,
  )) as Array<{ name?: string }>;
  return rows.some((row) => row.name === COST_WITHOUT_CACHE_COLUMN);
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
