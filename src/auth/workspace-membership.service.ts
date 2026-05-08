import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  WorkspaceMembership,
  WORKSPACE_MEMBERSHIP_ROLES,
  type WorkspaceMembershipRole,
  type WorkspaceMembershipStatus,
} from '../database/entities';
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_WORKSPACE_ID,
} from '../workspaces/workspace.constants';

export interface WorkspaceMembershipSummary {
  id: string;
  user_id: string;
  organization_id: string;
  workspace_id: string;
  role: WorkspaceMembershipRole;
  status: WorkspaceMembershipStatus;
  created_at: Date;
  updated_at: Date;
}

export interface UpdateWorkspaceMembershipInput {
  role?: WorkspaceMembershipRole;
  status?: WorkspaceMembershipStatus;
}

export interface EnsureWorkspaceMembershipInput {
  userId: string;
  organizationId: string;
  workspaceId: string;
  role: WorkspaceMembershipRole;
}

@Injectable()
export class WorkspaceMembershipService {
  constructor(
    @InjectRepository(WorkspaceMembership)
    private readonly memberships: Repository<WorkspaceMembership>,
  ) {}

  async findActiveRole(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceMembershipRole | null> {
    const membership = await this.memberships.findOne({
      where: {
        user_id: userId,
        workspace_id: workspaceId || DEFAULT_WORKSPACE_ID,
        status: 'active',
      },
    });
    return membership?.role || null;
  }

  async list(workspaceId = DEFAULT_WORKSPACE_ID): Promise<WorkspaceMembershipSummary[]> {
    const rows = await this.memberships.find({
      where: { workspace_id: workspaceId },
      order: { role: 'ASC', created_at: 'ASC' },
    });
    return rows.map((row) => this.toSummary(row));
  }

  async update(
    id: string,
    input: UpdateWorkspaceMembershipInput,
  ): Promise<WorkspaceMembershipSummary> {
    const membership = await this.memberships.findOne({ where: { id } });
    if (!membership) {
      throw new NotFoundException(`Workspace member not found: ${id}`);
    }
    await this.assertNotRemovingLastAdmin(membership, input);
    if (input.role) membership.role = assertRole(input.role);
    if (input.status) membership.status = assertStatus(input.status);
    return this.toSummary(await this.memberships.save(membership));
  }

  async ensureMembership(
    input: EnsureWorkspaceMembershipInput,
  ): Promise<WorkspaceMembershipSummary> {
    const userId = normalizeUserId(input.userId);
    const workspaceId = input.workspaceId || DEFAULT_WORKSPACE_ID;
    const organizationId = input.organizationId || DEFAULT_ORGANIZATION_ID;
    const role = assertRole(input.role);
    const existing = await this.memberships.findOne({
      where: { user_id: userId, workspace_id: workspaceId },
    });
    if (existing) {
      existing.organization_id = organizationId;
      existing.role = role;
      existing.status = 'active';
      return this.toSummary(await this.memberships.save(existing));
    }
    const created = await this.memberships.save(
      this.memberships.create({
        user_id: userId,
        organization_id: organizationId,
        workspace_id: workspaceId,
        role,
        status: 'active',
      }),
    );
    return this.toSummary(created);
  }

  async ensureDefaultAdmin(): Promise<WorkspaceMembershipSummary> {
    const existing = await this.memberships.findOne({
      where: {
        workspace_id: DEFAULT_WORKSPACE_ID,
        user_id: 'dashboard',
      },
    });
    if (existing) {
      existing.organization_id = DEFAULT_ORGANIZATION_ID;
      existing.role = 'admin';
      existing.status = 'active';
      return this.toSummary(await this.memberships.save(existing));
    }
    const created = await this.memberships.save(
      this.memberships.create({
        id: 'membership-default-dashboard-admin',
        user_id: 'dashboard',
        organization_id: DEFAULT_ORGANIZATION_ID,
        workspace_id: DEFAULT_WORKSPACE_ID,
        role: 'admin',
        status: 'active',
      }),
    );
    return this.toSummary(created);
  }

  private toSummary(row: WorkspaceMembership): WorkspaceMembershipSummary {
    return {
      id: row.id,
      user_id: row.user_id,
      organization_id: row.organization_id,
      workspace_id: row.workspace_id,
      role: row.role,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private async assertNotRemovingLastAdmin(
    membership: WorkspaceMembership,
    input: UpdateWorkspaceMembershipInput,
  ): Promise<void> {
    if (membership.role !== 'admin' || membership.status !== 'active') return;
    const nextRole = input.role ? assertRole(input.role) : membership.role;
    const nextStatus = input.status ? assertStatus(input.status) : membership.status;
    if (nextRole === 'admin' && nextStatus === 'active') return;

    const activeAdmins = await this.memberships.find({
      where: {
        workspace_id: membership.workspace_id,
        role: 'admin',
        status: 'active',
      },
    });
    if (activeAdmins.length <= 1) {
      throw new BadRequestException(
        'Cannot remove the last active workspace Admin.',
      );
    }
  }
}

function assertRole(role: string): WorkspaceMembershipRole {
  if (
    WORKSPACE_MEMBERSHIP_ROLES.includes(
      role as WorkspaceMembershipRole,
    )
  ) {
    return role as WorkspaceMembershipRole;
  }
  throw new BadRequestException(`Invalid workspace member role: ${role}`);
}

function normalizeUserId(value: string): string {
  const normalized = (value || '').trim();
  if (!normalized) {
    throw new BadRequestException('Workspace member user id is required.');
  }
  return normalized;
}

function assertStatus(status: string): WorkspaceMembershipStatus {
  if (status === 'active' || status === 'disabled') {
    return status;
  }
  throw new BadRequestException(`Invalid workspace member status: ${status}`);
}
