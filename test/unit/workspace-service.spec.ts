import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Organization, Workspace } from '../../src/database/entities';
import { WorkspaceContextService } from '../../src/workspaces/workspace-context.service';
import { WorkspaceService } from '../../src/workspaces/workspace.service';

function makeRepo<T extends Record<string, any>>(rows: T[]) {
  const matches = (row: T, where: Record<string, any>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && Array.isArray((value as any)._value)) {
        return (value as any)._value.includes(row[key]);
      }
      if (value && typeof value === 'object') {
        return row[key] === null || row[key] === undefined;
      }
      return row[key] === value;
    });
  return {
    rows,
    find: jest.fn(async ({ where, order }: any = {}) => {
      const list = Array.isArray(where)
        ? rows.filter((row) => where.some((entry) => matches(row, entry)))
        : where
          ? rows.filter((row) => matches(row, where))
          : [...rows];
      if (order?.is_default === 'DESC') {
        list.sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)));
      }
      return list;
    }),
    findOne: jest.fn(async ({ where }: any) => {
      const list = Array.isArray(where) ? where : [where];
      return rows.find((row) => list.some((entry) => matches(row, entry))) || null;
    }),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => {
      const index = rows.findIndex((row) => row.id === value.id);
      const now = new Date();
      const saved = {
        created_at: value.created_at || now,
        updated_at: now,
        ...value,
      };
      if (index >= 0) rows[index] = { ...rows[index], ...saved };
      else rows.push(saved as T);
      return saved;
    }),
  };
}

describe('WorkspaceService', () => {
  it('returns default organization and workspace when storage is empty', async () => {
    const service = new WorkspaceService(
      makeRepo<Organization>([]) as any,
      makeRepo<Workspace>([]) as any,
    );

    await expect(service.getState()).resolves.toMatchObject({
      organization: { id: 'default-org', name: 'Default Organization' },
      active_workspace: { id: 'default-workspace', is_default: true },
      default_workspace: { id: 'default-workspace', is_default: true },
      workspaces: [{ id: 'default-workspace', is_default: true }],
      fallback: {
        legacy_resources_map_to_default_workspace: true,
      },
    });
  });

  it('validates active workspace selection and falls back safely', async () => {
    const service = new WorkspaceService(
      makeRepo<Organization>([
        {
          id: 'default-org',
          name: 'Default Organization',
          slug: 'default-org',
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        } as Organization,
      ]) as any,
      makeRepo<Workspace>([
        {
          id: 'default-workspace',
          organization_id: 'default-org',
          name: 'Default Workspace',
          slug: 'default-workspace',
          status: 'active',
          is_default: true,
          created_at: new Date(),
          updated_at: new Date(),
        } as Workspace,
        {
          id: 'agents',
          organization_id: 'default-org',
          name: 'Agents',
          slug: 'agents',
          status: 'active',
          is_default: false,
          created_at: new Date(),
          updated_at: new Date(),
        } as Workspace,
      ]) as any,
    );

    await expect(service.resolveWorkspaceId('agents')).resolves.toBe('agents');
    await expect(service.resolveWorkspaceId('missing')).resolves.toBe('default-workspace');
    await expect(service.requireWorkspace('missing')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getState('agents')).resolves.toMatchObject({
      active_workspace: { id: 'agents', name: 'Agents' },
      default_workspace: { id: 'default-workspace' },
    });
  });

  it('creates, renames, disables, and reactivates non-default workspaces safely', async () => {
    const organizations = makeRepo<Organization>([
      {
        id: 'default-org',
        name: 'Default Organization',
        slug: 'default-org',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      } as Organization,
    ]);
    const workspaceRows: Workspace[] = [
      {
        id: 'default-workspace',
        organization_id: 'default-org',
        name: 'Default Workspace',
        slug: 'default-workspace',
        status: 'active',
        is_default: true,
        created_at: new Date(),
        updated_at: new Date(),
      } as Workspace,
    ];
    const workspaces = makeRepo<Workspace>(workspaceRows);
    const service = new WorkspaceService(organizations as any, workspaces as any);

    const created = await service.createWorkspace({ name: 'Agent Ops' });
    expect(created).toMatchObject({
      organization_id: 'default-org',
      name: 'Agent Ops',
      slug: 'agent-ops',
      status: 'active',
      is_default: false,
    });
    expect(created.id).toMatch(/^ws_/);

    await expect(
      service.createWorkspace({ name: 'Agent Ops', slug: 'agent-ops' }),
    ).rejects.toBeInstanceOf(ConflictException);

    const renamed = await service.renameWorkspace(created.id, {
      name: 'Production Agents',
      slug: 'prod-agents',
    });
    expect(renamed).toMatchObject({
      name: 'Production Agents',
      slug: 'prod-agents',
    });

    const disabled = await service.setWorkspaceStatus(created.id, 'disabled');
    expect(disabled.status).toBe('disabled');
    await expect(service.resolveWorkspaceId(created.id)).resolves.toBe('default-workspace');
    await expect(service.requireWorkspace(created.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.listWorkspaces({ includeDisabled: true }),
    ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));

    const reactivated = await service.setWorkspaceStatus(created.id, 'active');
    expect(reactivated.status).toBe('active');
    await expect(service.resolveWorkspaceId(created.id)).resolves.toBe(created.id);
  });

  it('does not allow disabling the default workspace or empty names', async () => {
    const service = new WorkspaceService(
      makeRepo<Organization>([
        {
          id: 'default-org',
          name: 'Default Organization',
          slug: 'default-org',
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        } as Organization,
      ]) as any,
      makeRepo<Workspace>([
        {
          id: 'default-workspace',
          organization_id: 'default-org',
          name: 'Default Workspace',
          slug: 'default-workspace',
          status: 'active',
          is_default: true,
          created_at: new Date(),
          updated_at: new Date(),
        } as Workspace,
      ]) as any,
    );

    await expect(
      service.setWorkspaceStatus('default-workspace', 'disabled'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createWorkspace({ name: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('WorkspaceContextService', () => {
  it('provides default workspace outside a request context', () => {
    const service = new WorkspaceContextService();
    expect(service.currentWorkspaceId()).toBe('default-workspace');
  });

  it('keeps workspace id scoped to async execution', async () => {
    const service = new WorkspaceContextService();
    await service.run({ workspaceId: 'agents' }, async () => {
      expect(service.currentWorkspaceId()).toBe('agents');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.currentWorkspaceId()).toBe('agents');
    });
    expect(service.currentWorkspaceId()).toBe('default-workspace');
  });
});
