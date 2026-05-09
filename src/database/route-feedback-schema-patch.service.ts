import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

const ROUTE_FEEDBACK_TABLE = 'route_feedback';

type SupportedDatabaseDriver = 'postgres' | 'better-sqlite3';

@Injectable()
export class RouteFeedbackSchemaPatchService implements OnModuleInit {
  private readonly logger = new Logger(RouteFeedbackSchemaPatchService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (!supportsSchemaPatch(this.dataSource)) return;
    const created = await applyRouteFeedbackSchemaPatch(this.dataSource);
    if (created) {
      this.logger.log('Route feedback schema ready: route_feedback');
    }
  }
}

export async function applyRouteFeedbackSchemaPatch(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  const existed = await hasRouteFeedbackTable(dataSource);

  if (dataSource.options.type === 'postgres') {
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS ${ROUTE_FEEDBACK_TABLE} (
        id varchar PRIMARY KEY,
        workspace_id varchar NULL,
        request_id varchar NOT NULL,
        route_decision_id varchar NULL,
        api_key_id varchar NULL,
        api_key_name varchar NULL,
        team_id varchar NULL,
        value varchar NOT NULL,
        reason_code varchar NULL,
        source varchar NOT NULL DEFAULT 'gateway_api',
        route_weight_evidence_json text NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else {
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS ${ROUTE_FEEDBACK_TABLE} (
        id varchar PRIMARY KEY,
        workspace_id varchar,
        request_id varchar NOT NULL,
        route_decision_id varchar,
        api_key_id varchar,
        api_key_name varchar,
        team_id varchar,
        value varchar NOT NULL,
        reason_code varchar,
        source varchar NOT NULL DEFAULT 'gateway_api',
        route_weight_evidence_json text,
        created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  await createIndex(dataSource, 'idx_route_feedback_workspace', 'workspace_id');
  await createIndex(dataSource, 'idx_route_feedback_request', 'request_id');
  await createIndex(dataSource, 'idx_route_feedback_api_key', 'api_key_id');
  await createIndex(dataSource, 'idx_route_feedback_team', 'team_id');
  await createIndex(dataSource, 'idx_route_feedback_value', 'value');
  await createIndex(dataSource, 'idx_route_feedback_created', 'created_at');

  return !existed;
}

export async function hasRouteFeedbackTable(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  if (dataSource.options.type === 'postgres') {
    const rows = (await dataSource.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = $1`,
      [ROUTE_FEEDBACK_TABLE],
    )) as Array<{ table_name?: string }>;
    return rows.some((row) => row.table_name === ROUTE_FEEDBACK_TABLE);
  }

  const rows = (await dataSource.query(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'
        AND name = '${ROUTE_FEEDBACK_TABLE}'`,
  )) as Array<{ name?: string }>;
  return rows.some((row) => row.name === ROUTE_FEEDBACK_TABLE);
}

async function createIndex(
  dataSource: DataSource & { options: { type: SupportedDatabaseDriver } },
  indexName: string,
  column: string,
): Promise<void> {
  await dataSource.query(
    `CREATE INDEX IF NOT EXISTS ${indexName} ON ${ROUTE_FEEDBACK_TABLE} (${column})`,
  );
}

function supportsSchemaPatch(
  dataSource: DataSource,
): dataSource is DataSource & { options: { type: SupportedDatabaseDriver } } {
  return (
    dataSource.options.type === 'postgres' ||
    dataSource.options.type === 'better-sqlite3'
  );
}
