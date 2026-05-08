import { ManagementAuditService } from '../../src/audit/management-audit.service';

class MemoryAuditRepo {
  rows: any[] = [];
  nextId = 1;

  create(input: any) {
    return { ...input };
  }

  async save(input: any) {
    const row = {
      ...input,
      id: input.id ?? this.nextId++,
      timestamp: input.timestamp ?? new Date('2026-05-09T00:00:00.000Z'),
    };
    this.rows.push(row);
    return row;
  }

  async findOne(options: any) {
    const workspaceId = options.where?.workspace_id;
    const matches = this.rows.filter((row) => row.workspace_id === workspaceId);
    return matches[matches.length - 1] ?? null;
  }

  createQueryBuilder() {
    const state: {
      action?: string;
      resourceType?: string;
      result?: string;
      actorId?: string;
      take?: number;
    } = {};
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn((limit: number) => {
        state.take = limit;
        return qb;
      }),
      andWhere: jest.fn((clause: string, params: Record<string, string>) => {
        if (clause.includes('event.action')) state.action = params.action;
        if (clause.includes('event.resource_type')) state.resourceType = params.resourceType;
        if (clause.includes('event.result')) state.result = params.result;
        if (clause.includes('event.actor_id')) state.actorId = params.actorId;
        return qb;
      }),
      getManyAndCount: jest.fn(async () => {
        let items = [...this.rows];
        if (state.action) items = items.filter((row) => row.action === state.action);
        if (state.resourceType) items = items.filter((row) => row.resource_type === state.resourceType);
        if (state.result) items = items.filter((row) => row.result === state.result);
        if (state.actorId) items = items.filter((row) => row.actor_id === state.actorId);
        items.sort((a, b) => b.id - a.id);
        const limited = state.take ? items.slice(0, state.take) : items;
        return [limited, items.length];
      }),
    };
    return qb;
  }
}

function makeService() {
  const repo = new MemoryAuditRepo();
  const workspaceContext = { currentWorkspaceId: jest.fn(() => 'default-workspace') };
  const requestContext = {
    current: jest.fn(() => ({
      requestId: 'req-123',
      actorType: 'dashboard',
      actorId: 'dashboard',
      method: 'POST',
      path: '/api/dashboard/api-keys',
      source: 'dashboard',
    })),
  };
  const service = new ManagementAuditService(
    workspaceContext as any,
    requestContext as any,
    repo as any,
  );
  return { service, repo };
}

describe('ManagementAuditService', () => {
  it('redacts secrets and stores hash-chain fields', async () => {
    const { service, repo } = makeService();

    await service.record({
      action: 'api_key.create',
      resourceType: 'api_key',
      resourceId: 'key_123',
      afterSummary: {
        key: 'gw_sk_live_secret',
        key_hash: 'sha256-secret',
        name: 'prod',
        nested: { authorization: 'Bearer abc.def' },
      },
    });
    await service.record({
      action: 'api_key.rotate',
      resourceType: 'api_key',
      resourceId: 'key_123',
      afterSummary: { token_hash: 'abc', name: 'prod' },
    });

    expect(repo.rows).toHaveLength(2);
    expect(JSON.stringify(repo.rows)).not.toContain('gw_sk_live_secret');
    expect(JSON.stringify(repo.rows)).not.toContain('sha256-secret');
    expect(repo.rows[0].event_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(repo.rows[1].previous_hash).toBe(repo.rows[0].event_hash);
  });

  it('records denied events and filters list results', async () => {
    const { service } = makeService();

    await service.recordDenied({
      action: 'dashboard.post.denied',
      resourceType: 'dashboard_endpoint',
      resourceId: '/api/dashboard/api-keys',
      reason: 'Requires admin role for this workspace.',
    });
    await service.record({
      action: 'workspace_member.update',
      resourceType: 'workspace_member',
      resourceId: 'membership-1',
    });

    const listed = await service.list({ result: 'denied' });

    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).toMatchObject({
      action: 'dashboard.post.denied',
      result: 'denied',
      resource_type: 'dashboard_endpoint',
    });
    expect(listed.privacy).toMatchObject({
      prompt_response_stored: false,
      provider_keys_stored: false,
    });
  });
});
