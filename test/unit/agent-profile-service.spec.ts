import { BadRequestException } from '@nestjs/common';
import { AgentProfileService } from '../../src/agent-profiles/agent-profile.service';
import { mockConfigService } from '../helpers';

function makeRepo<T extends { id?: string }>(initial: T[] = []) {
  const store = [...initial];
  let nextId = 1;

  const matchesValue = (itemValue: unknown, whereValue: any) => {
    if (whereValue && typeof whereValue === 'object' && whereValue._type === 'not') {
      return itemValue !== whereValue._value;
    }
    if (whereValue && typeof whereValue === 'object' && whereValue._type === 'isNull') {
      return itemValue === null || itemValue === undefined;
    }
    return itemValue === whereValue;
  };

  const matchesWhere = (
    item: any,
    where: Record<string, unknown> | Record<string, unknown>[],
  ): boolean =>
    Array.isArray(where)
      ? where.some((candidate) => matchesWhere(item, candidate))
      : Object.entries(where).every(([key, value]) => matchesValue(item[key], value));

  return {
    _store: store,
    find: jest.fn(async (opts?: any) => {
      let rows = [...store];
      if (opts?.where) {
        rows = rows.filter((item) => matchesWhere(item, opts.where));
      }
      if (opts?.order?.created_at === 'DESC') {
        rows.sort((a: any, b: any) => Number(b.created_at) - Number(a.created_at));
      }
      return rows;
    }),
    findOne: jest.fn(async (opts: any) => {
      if (!opts?.where) return null;
      return store.find((item) => matchesWhere(item, opts.where)) || null;
    }),
    create: jest.fn((partial: Partial<T>) => ({ ...partial })),
    save: jest.fn(async (entity: any) => {
      if (!entity.id) entity.id = `profile-${nextId++}`;
      if (!entity.created_at) entity.created_at = new Date('2026-05-08T00:00:00.000Z');
      entity.updated_at = new Date('2026-05-08T00:00:00.000Z');
      const existing = store.findIndex((item: any) => item.id === entity.id);
      if (existing >= 0) store[existing] = entity;
      else store.push(entity);
      return entity;
    }),
    remove: jest.fn(async (entity: any) => {
      const idx = store.findIndex((item: any) => item.id === entity.id);
      if (idx >= 0) store.splice(idx, 1);
      return entity;
    }),
  };
}

function makeGatewayApiKeys(overrides: Record<string, any> = {}) {
  return {
    getSummary: jest.fn(async (id: string) => {
      if (id !== 'key-1') {
        throw new Error('not found');
      }
      return {
        id,
        name: 'agent-key',
        key_prefix: 'gw_sk_live_redacted...1234',
        status: 'active',
        allow_auto: true,
        allow_direct: false,
        allowed_models: [],
        namespace_id: null,
        namespace_name: null,
      };
    }),
    ...overrides,
  };
}

function makeService(seed: any[] = [], configOverrides: Record<string, unknown> = {}) {
  const config = mockConfigService({
    server: { port: 2099 },
    namespaces: [{ id: 'team-alpha', name: 'Team Alpha' }],
    ...configOverrides,
  });
  const repo = makeRepo(seed);
  const gatewayApiKeys = makeGatewayApiKeys();
  const workspaceContext = { currentWorkspaceId: jest.fn(() => 'default-workspace') };
  const service = new AgentProfileService(
    config,
    gatewayApiKeys as any,
    workspaceContext as any,
    repo as any,
  );
  return { service, repo, gatewayApiKeys, config, workspaceContext };
}

describe('AgentProfileService', () => {
  it('creates, lists, updates, renders, and deletes a profile with redacted Gateway key metadata', async () => {
    const { service, repo } = makeService();

    const created = await service.create({
      name: ' Claude Code ',
      description: '  local agents  ',
      connector: 'claude_code',
      api_key_id: 'key-1',
      namespace_id: 'team-alpha',
      routing_hint: { tier: 'reasoning' },
      mcp_server_ids: ['filesystem', 'filesystem', ' git '],
      metadata: { owner: 'local' },
    });

    expect(created).toMatchObject({
      name: 'Claude Code',
      description: 'local agents',
      connector: 'claude_code',
      status: 'active',
      default_model: 'auto',
      smart_model_id: 'claude-siftgate-auto',
      base_url_mode: 'anthropic_v1',
      namespace_name: 'Team Alpha',
      mcp_server_ids: ['filesystem', 'git'],
    });
    expect(created.api_key).toMatchObject({
      id: 'key-1',
      key_prefix: 'gw_sk_live_redacted...1234',
    });

    const listed = await service.list();
    expect(listed).toHaveLength(1);

    const rendered = await service.render(created.id, {
      gateway_base_url: 'http://127.0.0.1:2099/',
    });
    expect(rendered.base_url).toBe('http://127.0.0.1:2099');
    expect(rendered.gateway_api_key).toEqual({
      placeholder: '<SIFTGATE_GATEWAY_API_KEY>',
      key_prefix: 'gw_sk_live_redacted...1234',
      name: 'agent-key',
      status: 'active',
    });
    expect(JSON.stringify(rendered)).not.toContain('hash');
    expect(JSON.stringify(rendered)).not.toContain('gw_sk_live_secret');
    expect(repo._store[0].last_generated_at).toBeInstanceOf(Date);

    const updated = await service.update(created.id, {
      connector: 'codex',
      description: null,
      smart_model_id: 'siftgate-auto',
      base_url_mode: 'openai_v1',
    });
    expect(updated).toMatchObject({
      connector: 'codex',
      description: null,
      smart_model_id: 'siftgate-auto',
      base_url_mode: 'openai_v1',
    });

    const openAiRendered = await service.render(created.id, {
      gateway_base_url: 'http://127.0.0.1:2099/',
    });
    expect(openAiRendered.base_url).toBe('http://127.0.0.1:2099/v1');

    await service.remove(created.id);
    expect(repo._store).toHaveLength(0);
  });

  it('validates connector, status, object fields, arrays, api key id, and namespace id', async () => {
    const { service } = makeService();

    await expect(service.create({
      name: 'Bad connector',
      connector: 'bad' as any,
    })).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.create({
      name: 'Bad status',
      connector: 'codex',
      status: 'paused' as any,
    })).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.create({
      name: 'Bad routing hint',
      connector: 'codex',
      routing_hint: [] as any,
    })).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.create({
      name: 'Bad mcp',
      connector: 'codex',
      mcp_server_ids: 'filesystem' as any,
    })).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.create({
      name: 'Bad key',
      connector: 'codex',
      api_key_id: 'missing-key',
    })).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.create({
      name: 'Bad namespace',
      connector: 'codex',
      namespace_id: 'missing-namespace',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('matches virtual models only for active profiles scoped to the Gateway API key', async () => {
    const { service } = makeService([
      {
        id: 'profile-1',
        name: 'Claude Code',
        description: null,
        connector: 'claude_code',
        status: 'active',
        api_key_id: 'key-1',
        namespace_id: null,
        default_model: 'auto',
        smart_model_id: 'claude-siftgate-auto',
        base_url_mode: 'anthropic_v1',
        routing_hint: null,
        mcp_server_ids: null,
        metadata: null,
        last_generated_at: null,
        created_at: new Date('2026-05-08T00:00:00.000Z'),
        updated_at: new Date('2026-05-08T00:00:00.000Z'),
      },
      {
        id: 'profile-2',
        name: 'Disabled',
        description: null,
        connector: 'generic_anthropic',
        status: 'disabled',
        api_key_id: 'key-1',
        namespace_id: null,
        default_model: 'auto',
        smart_model_id: 'disabled-auto',
        base_url_mode: 'anthropic_v1',
        routing_hint: null,
        mcp_server_ids: null,
        metadata: null,
        last_generated_at: null,
        created_at: new Date('2026-05-08T00:00:00.000Z'),
        updated_at: new Date('2026-05-08T00:00:00.000Z'),
      },
    ]);

    await expect(
      service.matchVirtualModel('key-1', 'claude-siftgate-auto'),
    ).resolves.toMatchObject({
      virtual_model: 'claude-siftgate-auto',
      internal_model: 'auto',
      profile: expect.objectContaining({ id: 'profile-1' }),
    });
    await expect(
      service.matchVirtualModel('other-key', 'claude-siftgate-auto'),
    ).resolves.toBeNull();
    await expect(
      service.matchVirtualModel('key-1', 'disabled-auto'),
    ).resolves.toBeNull();

    await expect(service.listVirtualModelsForApiKey('key-1', {
      allow_auto: true,
      allowed_models: [],
    })).resolves.toEqual([
      expect.objectContaining({
        id: 'claude-siftgate-auto',
        agent_profile_id: 'profile-1',
        is_agent_profile_model: true,
      }),
    ]);
    await expect(service.listVirtualModelsForApiKey('key-1', {
      allow_auto: false,
      allowed_models: [],
    })).resolves.toEqual([]);
  });
});
