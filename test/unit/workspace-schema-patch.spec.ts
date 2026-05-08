import { DataSource } from 'typeorm';
import { CallLog, GatewayApiKey, Organization, Workspace } from '../../src/database/entities';
import {
  applyWorkspaceSchemaPatches,
} from '../../src/database/workspace-schema-patch.service';

function makeDataSource(name: string): DataSource {
  return new DataSource({
    type: 'better-sqlite3',
    database: `:memory:${name}`,
    entities: [Organization, Workspace, GatewayApiKey, CallLog],
    synchronize: true,
    logging: false,
  });
}

describe('Workspace schema patch', () => {
  it('bootstraps the default organization and workspace on a fresh SQLite install', async () => {
    const dataSource = makeDataSource('fresh');
    await dataSource.initialize();
    try {
      const result = await applyWorkspaceSchemaPatches(dataSource);

      const organizations = await dataSource.getRepository(Organization).find();
      const workspaces = await dataSource.getRepository(Workspace).find();

      expect(result.backfilledTables).toEqual([]);
      expect(organizations).toHaveLength(1);
      expect(organizations[0]).toMatchObject({
        id: 'default-org',
        name: 'Default Organization',
        slug: 'default-org',
        status: 'active',
      });
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0]).toMatchObject({
        id: 'default-workspace',
        organization_id: 'default-org',
        name: 'Default Workspace',
        slug: 'default-workspace',
        status: 'active',
        is_default: true,
      });
    } finally {
      await dataSource.destroy();
    }
  });

  it('backfills legacy null workspace ids into the default workspace', async () => {
    const dataSource = makeDataSource('backfill');
    await dataSource.initialize();
    try {
      await dataSource.getRepository(GatewayApiKey).save({
        id: 'key_legacy',
        name: 'legacy',
        key_hash: 'hash',
        key_prefix: 'gw_sk_legacy',
        status: 'active',
        workspace_id: null,
      });
      await dataSource.getRepository(CallLog).save({
        id: 1,
        request_id: 'req_legacy',
        timestamp: new Date('2026-05-08T00:00:00.000Z'),
        source_format: 'chat_completions',
        tier: 'standard',
        score: 1,
        node_id: 'openai',
        model: 'gpt-4o-mini',
        input_tokens: 1,
        output_tokens: 1,
        cost_usd: 0,
        latency_ms: 10,
        stream: false,
        status_code: 200,
        is_fallback: false,
        workspace_id: null,
      });

      const result = await applyWorkspaceSchemaPatches(dataSource);

      expect(result.backfilledTables).toEqual(
        expect.arrayContaining(['gateway_api_keys', 'call_logs']),
      );
      await expect(
        dataSource.getRepository(GatewayApiKey).findOneByOrFail({ id: 'key_legacy' }),
      ).resolves.toMatchObject({ workspace_id: 'default-workspace' });
      await expect(
        dataSource.getRepository(CallLog).findOneByOrFail({ request_id: 'req_legacy' }),
      ).resolves.toMatchObject({ workspace_id: 'default-workspace' });
    } finally {
      await dataSource.destroy();
    }
  });
});
