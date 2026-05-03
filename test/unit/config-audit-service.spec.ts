import { ConfigAuditService } from '../../src/dashboard/config-audit.service';

function makeRepo<T extends { id?: number; created_at?: Date; timestamp?: Date }>() {
  let nextId = 1;
  const rows: T[] = [];

  const repo = {
    rows,
    create: jest.fn((input: T) => ({ ...input })),
    save: jest.fn(async (input: T) => {
      const row = {
        ...input,
        id: input.id ?? nextId++,
        created_at: input.created_at ?? new Date('2026-05-03T00:00:00.000Z'),
        timestamp: input.timestamp ?? new Date('2026-05-03T00:00:00.000Z'),
      } as T;
      rows.push(row);
      return row;
    }),
    count: jest.fn(async () => rows.length),
    find: jest.fn(async (options?: { take?: number; order?: Record<string, string> }) => {
      const ordered = [...rows].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
      return ordered.slice(0, options?.take ?? ordered.length);
    }),
    findOne: jest.fn(async ({ where }: { where: { id: number } }) =>
      rows.find((row) => row.id === where.id) ?? null,
    ),
    delete: jest.fn(async (ids: number[]) => {
      for (const id of ids) {
        const idx = rows.findIndex((row) => row.id === id);
        if (idx >= 0) rows.splice(idx, 1);
      }
      return { affected: ids.length };
    }),
    createQueryBuilder: jest.fn(() => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => [...rows].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))),
      };
      return qb;
    }),
  };

  return repo;
}

function makeConfig(rawRef: { value: string }, overrides: Record<string, unknown> = {}) {
  return {
    configAudit: {
      enabled: true,
      max_versions: 50,
      max_events: 100,
      capture_startup_snapshot: false,
    },
    getConfigPath: jest.fn(() => '/tmp/gateway.config.yaml'),
    readRawConfigYaml: jest.fn(() => rawRef.value),
    getSnapshot: jest.fn(() => ({
      version: 7,
      loaded_at: '2026-05-03T00:00:00.000Z',
      path: '/tmp/gateway.config.yaml',
      node_count: 1,
      node_ids: ['openai'],
      route_tiers: ['standard'],
      control_plane_enabled: false,
      hot_reload_watch: false,
    })),
    restoreFromYaml: jest.fn((raw: string) => {
      rawRef.value = raw;
      return {
        success: true,
        source: 'rollback',
        message: 'Configuration restored from version snapshot',
        previous: { version: 7 },
        current: { version: 8 },
        changed: {},
        rolled_back: false,
      };
    }),
    ...overrides,
  };
}

const RAW_ONE = `
server:
  port: 2099
database:
  type: sqlite
nodes:
  - id: openai
    api_key: sk-test-secret-value
routing:
  tiers:
    standard: {}
`;

const RAW_TWO = `
server:
  port: 2099
database:
  type: sqlite
nodes:
  - id: openai
    api_key: sk-new-secret-value
  - id: anthropic
    api_key: "\${ANTHROPIC_API_KEY}"
routing:
  tiers:
    standard: {}
    complex: {}
`;

describe('ConfigAuditService', () => {
  it('captures before/after versions and exposes sanitized snapshots', async () => {
    const raw = { value: RAW_ONE };
    const versionRepo = makeRepo<any>();
    const eventRepo = makeRepo<any>();
    const service = new ConfigAuditService(
      makeConfig(raw) as any,
      versionRepo as any,
      eventRepo as any,
    );

    await service.trackChange(
      {
        action: 'config.node.update',
        target_type: 'node',
        target_id: 'openai',
        metadata: { fields: ['api_key'] },
      },
      () => {
        raw.value = RAW_TWO;
      },
    );

    expect(versionRepo.rows).toHaveLength(2);
    expect(eventRepo.rows).toHaveLength(1);
    expect(eventRepo.rows[0].success).toBe(true);

    const detail = await service.getVersion(versionRepo.rows[1].id);
    const sanitized = detail?.sanitized_config as any;
    expect(sanitized.nodes[0].api_key).not.toBe('sk-new-secret-value');
    expect(sanitized.nodes[1].api_key).toBe('${ANTHROPIC_API_KEY}');
  });

  it('rolls back by restoring the stored YAML snapshot and auditing the action', async () => {
    const raw = { value: RAW_ONE };
    const versionRepo = makeRepo<any>();
    const eventRepo = makeRepo<any>();
    const config = makeConfig(raw);
    const service = new ConfigAuditService(
      config as any,
      versionRepo as any,
      eventRepo as any,
    );

    await service.trackChange({ action: 'config.node.update' }, () => {
      raw.value = RAW_TWO;
    });
    const targetId = versionRepo.rows[0].id;

    const result = await service.rollbackToVersion(targetId, {
      reason: 'restore last known good',
    });

    expect(result.success).toBe(true);
    expect(config.restoreFromYaml).toHaveBeenCalledWith(
      versionRepo.rows[0].snapshot_yaml,
      { source: 'rollback', throwOnError: false },
    );
    expect(raw.value).toBe(RAW_ONE);
    expect(eventRepo.rows.some((row) => row.action === 'config.rollback')).toBe(true);
  });

  it('does not block config mutations when audit capture is disabled', async () => {
    const raw = { value: RAW_ONE };
    const versionRepo = makeRepo<any>();
    const eventRepo = makeRepo<any>();
    const service = new ConfigAuditService(
      makeConfig(raw, {
        configAudit: {
          enabled: false,
          max_versions: 50,
          max_events: 100,
          capture_startup_snapshot: false,
        },
      }) as any,
      versionRepo as any,
      eventRepo as any,
    );

    await service.trackChange({ action: 'config.node.update' }, () => {
      raw.value = RAW_TWO;
    });

    expect(raw.value).toBe(RAW_TWO);
    expect(versionRepo.rows).toHaveLength(0);
    expect(eventRepo.rows).toHaveLength(0);
  });
});
