import { BadRequestException } from '@nestjs/common';
import { WorkspaceMembership } from '../../src/database/entities';
import { WorkspaceMembershipService } from '../../src/auth/workspace-membership.service';

function makeRepo(rows: WorkspaceMembership[]) {
  return {
    findOne: jest.fn(async ({ where }: any) => {
      return rows.find((row) =>
        Object.entries(where).every(([key, value]) => (row as any)[key] === value),
      ) || null;
    }),
    find: jest.fn(async ({ where }: any) => {
      return rows.filter((row) =>
        Object.entries(where).every(([key, value]) => (row as any)[key] === value),
      );
    }),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => {
      const index = rows.findIndex((row) => row.id === value.id);
      if (index >= 0) rows[index] = { ...rows[index], ...value } as WorkspaceMembership;
      else rows.push(value as WorkspaceMembership);
      return value;
    }),
  };
}

describe('WorkspaceMembershipService', () => {
  it('finds active workspace role and ignores disabled memberships', async () => {
    const service = new WorkspaceMembershipService(
      makeRepo([
        {
          id: 'm1',
          user_id: 'dashboard',
          organization_id: 'default-org',
          workspace_id: 'default-workspace',
          role: 'operator',
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        } as WorkspaceMembership,
        {
          id: 'm2',
          user_id: 'viewer',
          organization_id: 'default-org',
          workspace_id: 'default-workspace',
          role: 'viewer',
          status: 'disabled',
          created_at: new Date(),
          updated_at: new Date(),
        } as WorkspaceMembership,
      ]) as any,
    );

    await expect(service.findActiveRole('dashboard', 'default-workspace')).resolves.toBe('operator');
    await expect(service.findActiveRole('viewer', 'default-workspace')).resolves.toBeNull();
  });

  it('rejects invalid role updates', async () => {
    const service = new WorkspaceMembershipService(
      makeRepo([
        {
          id: 'm1',
          user_id: 'dashboard',
          organization_id: 'default-org',
          workspace_id: 'default-workspace',
          role: 'admin',
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        } as WorkspaceMembership,
      ]) as any,
    );

    await expect(service.update('m1', { role: 'owner' as any })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('prevents disabling or demoting the last active admin', async () => {
    const service = new WorkspaceMembershipService(
      makeRepo([
        {
          id: 'm1',
          user_id: 'dashboard',
          organization_id: 'default-org',
          workspace_id: 'default-workspace',
          role: 'admin',
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        } as WorkspaceMembership,
      ]) as any,
    );

    await expect(service.update('m1', { role: 'viewer' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.update('m1', { status: 'disabled' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
