import { BadRequestException } from '@nestjs/common';
import { WorkspaceInvitationService } from '../../src/auth/workspace-invitation.service';

function repo() {
  const rows: any[] = [];
  return {
    rows,
    create: jest.fn((input) => input),
    save: jest.fn(async (input) => {
      if (Array.isArray(input)) return input;
      if (!input.id) input.id = `invite-${rows.length + 1}`;
      input.created_at ??= new Date('2026-05-09T00:00:00.000Z');
      input.updated_at ??= new Date('2026-05-09T00:00:00.000Z');
      const existing = rows.findIndex((row) => row.id === input.id);
      if (existing >= 0) rows[existing] = input;
      else rows.push(input);
      return input;
    }),
    find: jest.fn(async ({ where }: any = {}) =>
      rows.filter((row) =>
        Object.entries(where || {}).every(([key, value]) => row[key] === value),
      ),
    ),
    findOne: jest.fn(async ({ where }: any = {}) =>
      rows.find((row) =>
        Object.entries(where || {}).every(([key, value]) => row[key] === value),
      ) || null,
    ),
  };
}

describe('WorkspaceInvitationService', () => {
  it('creates metadata and returns the plain token once', async () => {
    const repository = repo();
    const service = new WorkspaceInvitationService(repository as any);

    const created = await service.create({
      role: 'viewer',
      email: 'User@Example.com',
      createdByUserId: 'dashboard',
    });

    expect(created.token).toMatch(/^sg_inv_/);
    expect(created.accept_path).toContain(encodeURIComponent(created.token));
    expect(created.email).toBe('user@example.com');
    expect(repository.rows[0].token_hash).not.toBe(created.token);
  });

  it('accepts a pending invitation for matching OIDC identity', async () => {
    const repository = repo();
    const service = new WorkspaceInvitationService(repository as any);
    const created = await service.create({
      role: 'operator',
      email: 'user@example.com',
    });

    const accepted = await service.acceptForUser(
      created.token,
      'oidc:user@example.com',
      'user@example.com',
    );

    expect(accepted?.role).toBe('operator');
    expect(accepted?.workspaceId).toBe('default-workspace');
    expect(repository.rows[0].status).toBe('accepted');
    expect(repository.rows[0].accepted_by_user_id).toBe('oidc:user@example.com');
  });

  it('rejects an invitation for a different email', async () => {
    const repository = repo();
    const service = new WorkspaceInvitationService(repository as any);
    const created = await service.create({
      role: 'viewer',
      email: 'user@example.com',
    });

    await expect(
      service.acceptForUser(created.token, 'oidc:other@example.com', 'other@example.com'),
    ).rejects.toThrow(BadRequestException);
  });
});
