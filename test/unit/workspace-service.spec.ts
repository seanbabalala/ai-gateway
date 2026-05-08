import { NotFoundException } from '@nestjs/common';
import { Organization, Workspace } from '../../src/database/entities';
import { WorkspaceContextService } from '../../src/workspaces/workspace-context.service';
import { WorkspaceService } from '../../src/workspaces/workspace.service';

function makeRepo<T extends Record<string, any>>(rows: T[]) {
  const matches = (row: T, where: Record<string, any>): boolean =>
    Object.entries(where).every(([key, value]) => {
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
