import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

const CALL_LOGS_TABLE = 'call_logs';
const ROUTE_DECISIONS_TABLE = 'route_decisions';
const COST_WITHOUT_CACHE_COLUMN = 'cost_without_cache_usd';
const STREAM_COLUMN = 'stream';
const CLIENT_SOURCE_COLUMNS = ['client_source'] as const;
const AGENT_METADATA_COLUMNS = [
  'agent_connector',
  'agent_profile_id',
  'agent_profile_name',
  'agent_virtual_model',
  'agent_requested_model',
  'agent_session_id',
  'agent_turn_id',
  'agent_repo',
  'agent_project',
] as const;
const INTELLIGENCE_BOOLEAN_COLUMNS = [
  'intelligence_optimizer_applied',
  'async_eval_queued',
] as const;
const INTELLIGENCE_REAL_COLUMNS = [
  'intelligence_estimated_cost_usd',
  'intelligence_estimated_savings_usd',
] as const;
const INTELLIGENCE_TEXT_COLUMNS = [
  'token_prediction_risk',
  'quality_gate_status',
] as const;
const ROUTE_DECISION_INTELLIGENCE_BOOLEAN_COLUMNS = [
  'intelligence_optimizer_applied',
  'async_eval_queued',
] as const;
const ROUTE_DECISION_INTELLIGENCE_TEXT_COLUMNS = [
  'token_prediction_risk',
  'quality_gate_status',
] as const;

type SupportedDatabaseDriver = 'postgres' | 'better-sqlite3';

@Injectable()
export class CallLogSchemaPatchService implements OnModuleInit {
  private readonly logger = new Logger(CallLogSchemaPatchService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (!supportsSchemaPatch(this.dataSource)) return;

    const applied = await applyCallLogSchemaPatches(this.dataSource);
    for (const column of applied) {
      this.logger.log(
        `Applied schema patch: ${column.includes('.') ? column : `${CALL_LOGS_TABLE}.${column}`}`,
      );
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
  applied.push(
    ...(await applyMetadataTextColumnPatches(
      dataSource,
      CALL_LOGS_TABLE,
      CLIENT_SOURCE_COLUMNS,
    )),
  );
  applied.push(
    ...(await applyMetadataTextColumnPatches(
      dataSource,
      CALL_LOGS_TABLE,
      AGENT_METADATA_COLUMNS,
    )),
  );
  applied.push(
    ...(await applyMetadataTextColumnPatches(
      dataSource,
      ROUTE_DECISIONS_TABLE,
      AGENT_METADATA_COLUMNS,
    )).map((column) => `${ROUTE_DECISIONS_TABLE}.${column}`),
  );
  applied.push(
    ...(await applyMetadataBooleanColumnPatches(
      dataSource,
      CALL_LOGS_TABLE,
      INTELLIGENCE_BOOLEAN_COLUMNS,
    )),
  );
  applied.push(
    ...(await applyMetadataRealColumnPatches(
      dataSource,
      CALL_LOGS_TABLE,
      INTELLIGENCE_REAL_COLUMNS,
    )),
  );
  applied.push(
    ...(await applyMetadataTextColumnPatches(
      dataSource,
      CALL_LOGS_TABLE,
      INTELLIGENCE_TEXT_COLUMNS,
    )),
  );
  applied.push(
    ...(await applyMetadataBooleanColumnPatches(
      dataSource,
      ROUTE_DECISIONS_TABLE,
      ROUTE_DECISION_INTELLIGENCE_BOOLEAN_COLUMNS,
    )).map((column) => `${ROUTE_DECISIONS_TABLE}.${column}`),
  );
  applied.push(
    ...(await applyMetadataTextColumnPatches(
      dataSource,
      ROUTE_DECISIONS_TABLE,
      ROUTE_DECISION_INTELLIGENCE_TEXT_COLUMNS,
    )).map((column) => `${ROUTE_DECISIONS_TABLE}.${column}`),
  );
  return applied;
}

export async function applyAgentMetadataSchemaPatches(
  dataSource: DataSource,
): Promise<string[]> {
  if (!supportsSchemaPatch(dataSource)) return [];
  const callLogColumns = await applyMetadataTextColumnPatches(
    dataSource,
    CALL_LOGS_TABLE,
    AGENT_METADATA_COLUMNS,
  );
  const routeDecisionColumns = await applyMetadataTextColumnPatches(
    dataSource,
    ROUTE_DECISIONS_TABLE,
    AGENT_METADATA_COLUMNS,
  );
  return [
    ...callLogColumns.map((column) => `${CALL_LOGS_TABLE}.${column}`),
    ...routeDecisionColumns.map((column) => `${ROUTE_DECISIONS_TABLE}.${column}`),
  ];
}

export async function applyCallLogCostWithoutCacheSchemaPatch(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  if (!(await hasCallLogsTable(dataSource))) return false;
  if (
    await hasTableColumnInternal(
      dataSource,
      CALL_LOGS_TABLE,
      COST_WITHOUT_CACHE_COLUMN,
      true,
    )
  ) {
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
  if (
    await hasTableColumnInternal(dataSource, CALL_LOGS_TABLE, STREAM_COLUMN, true)
  ) {
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
  if (
    !(await hasTableColumnInternal(
      dataSource,
      CALL_LOGS_TABLE,
      COST_WITHOUT_CACHE_COLUMN,
      true,
    ))
  ) {
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
  return hasTableColumnInternal(
    dataSource,
    CALL_LOGS_TABLE,
    COST_WITHOUT_CACHE_COLUMN,
  );
}

export async function hasCallLogStreamColumn(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  return hasTableColumnInternal(dataSource, CALL_LOGS_TABLE, STREAM_COLUMN);
}

export async function hasCallLogClientSourceColumn(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  return hasTableColumnInternal(dataSource, CALL_LOGS_TABLE, 'client_source');
}

export async function hasCallLogAgentMetadataColumn(
  dataSource: DataSource,
  column = 'agent_connector',
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  return hasTableColumnInternal(dataSource, CALL_LOGS_TABLE, column);
}

export async function hasRouteDecisionAgentMetadataColumn(
  dataSource: DataSource,
  column = 'agent_connector',
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  return hasTableColumnInternal(dataSource, ROUTE_DECISIONS_TABLE, column);
}

async function applyMetadataTextColumnPatches(
  dataSource: DataSource,
  table: string,
  columns: readonly string[],
): Promise<string[]> {
  const applied: string[] = [];
  if (!supportsSchemaPatch(dataSource)) return applied;
  if (!(await hasTable(dataSource, table))) return applied;

  for (const column of columns) {
    if (await hasTableColumnInternal(dataSource, table, column, true)) continue;
    if (dataSource.options.type === 'postgres') {
      await dataSource.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} varchar NULL`,
      );
    } else {
      await dataSource.query(`ALTER TABLE ${table} ADD COLUMN ${column} varchar`);
    }
    applied.push(column);
  }

  return applied;
}

async function applyMetadataBooleanColumnPatches(
  dataSource: DataSource,
  table: string,
  columns: readonly string[],
): Promise<string[]> {
  const applied: string[] = [];
  if (!supportsSchemaPatch(dataSource)) return applied;
  if (!(await hasTable(dataSource, table))) return applied;

  for (const column of columns) {
    if (await hasTableColumnInternal(dataSource, table, column, true)) continue;
    if (dataSource.options.type === 'postgres') {
      await dataSource.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} boolean NOT NULL DEFAULT false`,
      );
    } else {
      await dataSource.query(`ALTER TABLE ${table} ADD COLUMN ${column} boolean NOT NULL DEFAULT 0`);
    }
    applied.push(column);
  }

  return applied;
}

async function applyMetadataRealColumnPatches(
  dataSource: DataSource,
  table: string,
  columns: readonly string[],
): Promise<string[]> {
  const applied: string[] = [];
  if (!supportsSchemaPatch(dataSource)) return applied;
  if (!(await hasTable(dataSource, table))) return applied;

  for (const column of columns) {
    if (await hasTableColumnInternal(dataSource, table, column, true)) continue;
    if (dataSource.options.type === 'postgres') {
      await dataSource.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} double precision NULL`,
      );
    } else {
      await dataSource.query(`ALTER TABLE ${table} ADD COLUMN ${column} real`);
    }
    applied.push(column);
  }

  return applied;
}

async function hasTableColumnInternal(
  dataSource: DataSource,
  table: string,
  column: string,
  assumeTableExists = false,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  if (!assumeTableExists && !(await hasTable(dataSource, table))) return false;

  if (dataSource.options.type === 'postgres') {
    const rows = (await dataSource.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = $2`,
      [table, column],
    )) as Array<{ column_name?: string }>;
    return rows.some((row) => row.column_name === column);
  }

  const rows = (await dataSource.query(
    `PRAGMA table_info('${table}')`,
  )) as Array<{ name?: string }>;
  return rows.some((row) => row.name === column);
}

async function hasCallLogsTable(dataSource: DataSource): Promise<boolean> {
  return hasTable(dataSource, CALL_LOGS_TABLE);
}

async function hasTable(dataSource: DataSource, table: string): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;

  if (dataSource.options.type === 'postgres') {
    const rows = (await dataSource.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = $1`,
      [table],
    )) as Array<{ table_name?: string }>;
    return rows.some((row) => row.table_name === table);
  }

  const rows = (await dataSource.query(
    `SELECT name
      FROM sqlite_master
     WHERE type = 'table'
        AND name = '${table}'`,
  )) as Array<{ name?: string }>;
  return rows.some((row) => row.name === table);
}

function supportsSchemaPatch(
  dataSource: DataSource,
): dataSource is DataSource & { options: { type: SupportedDatabaseDriver } } {
  return (
    dataSource.options.type === 'postgres' ||
    dataSource.options.type === 'better-sqlite3'
  );
}
