import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

const PROMPT_TEMPLATES_TABLE = 'prompt_templates';

type SupportedDatabaseDriver = 'postgres' | 'better-sqlite3';

@Injectable()
export class PromptTemplateSchemaPatchService implements OnModuleInit {
  private readonly logger = new Logger(PromptTemplateSchemaPatchService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (!supportsSchemaPatch(this.dataSource)) return;
    const created = await applyPromptTemplateSchemaPatch(this.dataSource);
    if (created) {
      this.logger.log('Prompt template schema ready: prompt_templates');
    }
  }
}

export async function applyPromptTemplateSchemaPatch(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  const existed = await hasPromptTemplatesTable(dataSource);

  if (dataSource.options.type === 'postgres') {
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS ${PROMPT_TEMPLATES_TABLE} (
        id varchar PRIMARY KEY,
        workspace_id varchar NULL,
        prompt_key varchar NOT NULL,
        version integer NOT NULL,
        name varchar NULL,
        status varchar NOT NULL DEFAULT 'active',
        template_content text NULL,
        template_hash varchar NOT NULL,
        variables_json text NULL,
        route_policy_id varchar NULL,
        ab_metadata_json text NULL,
        metadata_json text NULL,
        content_storage_enabled boolean NOT NULL DEFAULT false,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else {
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS ${PROMPT_TEMPLATES_TABLE} (
        id varchar PRIMARY KEY,
        workspace_id varchar,
        prompt_key varchar NOT NULL,
        version integer NOT NULL,
        name varchar,
        status varchar NOT NULL DEFAULT 'active',
        template_content text,
        template_hash varchar NOT NULL,
        variables_json text,
        route_policy_id varchar,
        ab_metadata_json text,
        metadata_json text,
        content_storage_enabled boolean NOT NULL DEFAULT 0,
        created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  await createIndex(dataSource, 'idx_prompt_templates_workspace', 'workspace_id');
  await createIndex(dataSource, 'idx_prompt_templates_key', 'prompt_key');
  await createIndex(dataSource, 'idx_prompt_templates_status', 'status');
  await createIndex(dataSource, 'idx_prompt_templates_route_policy', 'route_policy_id');
  await dataSource.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_templates_workspace_key_version ON ${PROMPT_TEMPLATES_TABLE} (workspace_id, prompt_key, version)`,
  );

  return !existed;
}

export async function hasPromptTemplatesTable(
  dataSource: DataSource,
): Promise<boolean> {
  if (!supportsSchemaPatch(dataSource)) return false;
  if (dataSource.options.type === 'postgres') {
    const rows = (await dataSource.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = $1`,
      [PROMPT_TEMPLATES_TABLE],
    )) as Array<{ table_name?: string }>;
    return rows.some((row) => row.table_name === PROMPT_TEMPLATES_TABLE);
  }

  const rows = (await dataSource.query(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'
        AND name = '${PROMPT_TEMPLATES_TABLE}'`,
  )) as Array<{ name?: string }>;
  return rows.some((row) => row.name === PROMPT_TEMPLATES_TABLE);
}

async function createIndex(
  dataSource: DataSource & { options: { type: SupportedDatabaseDriver } },
  indexName: string,
  column: string,
): Promise<void> {
  await dataSource.query(
    `CREATE INDEX IF NOT EXISTS ${indexName} ON ${PROMPT_TEMPLATES_TABLE} (${column})`,
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
