import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import {
  WorkspaceInvitation,
  WORKSPACE_MEMBERSHIP_ROLES,
  type WorkspaceInvitationStatus,
  type WorkspaceMembershipRole,
} from '../database/entities';
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_WORKSPACE_ID,
} from '../workspaces/workspace.constants';

export interface WorkspaceInvitationSummary {
  id: string;
  organization_id: string;
  workspace_id: string;
  role: WorkspaceMembershipRole;
  email: string | null;
  status: WorkspaceInvitationStatus;
  expires_at: Date;
  accepted_at: Date | null;
  accepted_by_user_id: string | null;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface WorkspaceInvitationCreated extends WorkspaceInvitationSummary {
  token: string;
  accept_path: string;
}

export interface CreateWorkspaceInvitationInput {
  organizationId?: string | null;
  workspaceId?: string | null;
  role: WorkspaceMembershipRole;
  email?: string | null;
  expiresInHours?: number;
  createdByUserId?: string | null;
}

export interface AcceptedWorkspaceInvitation {
  invitation: WorkspaceInvitationSummary;
  role: WorkspaceMembershipRole;
  workspaceId: string;
  organizationId: string;
}

@Injectable()
export class WorkspaceInvitationService {
  constructor(
    @InjectRepository(WorkspaceInvitation)
    private readonly invitations: Repository<WorkspaceInvitation>,
  ) {}

  async list(workspaceId = DEFAULT_WORKSPACE_ID): Promise<WorkspaceInvitationSummary[]> {
    await this.expirePendingInvitations();
    const rows = await this.invitations.find({
      where: { workspace_id: workspaceId },
      order: { created_at: 'DESC' },
    });
    return rows.map((row) => this.toSummary(row));
  }

  async create(
    input: CreateWorkspaceInvitationInput,
  ): Promise<WorkspaceInvitationCreated> {
    const role = assertRole(input.role);
    const expiresInHours = input.expiresInHours ?? 168;
    if (!Number.isFinite(expiresInHours) || expiresInHours <= 0 || expiresInHours > 24 * 90) {
      throw new BadRequestException('Invitation expiry must be between 1 hour and 90 days.');
    }
    const token = `sg_inv_${randomBytes(24).toString('base64url')}`;
    const created = await this.invitations.save(
      this.invitations.create({
        organization_id: input.organizationId || DEFAULT_ORGANIZATION_ID,
        workspace_id: input.workspaceId || DEFAULT_WORKSPACE_ID,
        role,
        email: normalizeEmail(input.email),
        token_hash: hashInviteToken(token),
        status: 'pending',
        expires_at: new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString(),
        accepted_at: null,
        accepted_by_user_id: null,
        created_by_user_id: input.createdByUserId || null,
      }),
    );
    return {
      ...this.toSummary(created),
      token,
      accept_path: `/login?invite=${encodeURIComponent(token)}`,
    };
  }

  async revoke(id: string): Promise<WorkspaceInvitationSummary> {
    const invitation = await this.invitations.findOne({ where: { id } });
    if (!invitation) {
      throw new NotFoundException(`Workspace invitation not found: ${id}`);
    }
    if (invitation.status === 'pending') {
      invitation.status = 'revoked';
    }
    return this.toSummary(await this.invitations.save(invitation));
  }

  async acceptForUser(
    token: string | undefined | null,
    userId: string,
    email?: string | null,
  ): Promise<AcceptedWorkspaceInvitation | null> {
    const normalizedToken = (token || '').trim();
    if (!normalizedToken) return null;
    return this.acceptHashForUser(hashInviteToken(normalizedToken), userId, email);
  }

  async acceptHashForUser(
    tokenHash: string | undefined | null,
    userId: string,
    email?: string | null,
  ): Promise<AcceptedWorkspaceInvitation | null> {
    const normalizedHash = (tokenHash || '').trim();
    if (!normalizedHash) return null;
    const invitation = await this.invitations.findOne({
      where: { token_hash: normalizedHash },
    });
    if (!invitation) {
      throw new BadRequestException('Invitation token is invalid.');
    }
    if (invitation.status !== 'pending') {
      throw new BadRequestException(`Invitation is ${invitation.status}.`);
    }
    if (Date.parse(invitation.expires_at) <= Date.now()) {
      invitation.status = 'expired';
      await this.invitations.save(invitation);
      throw new BadRequestException('Invitation has expired.');
    }
    const normalizedInviteEmail = normalizeEmail(invitation.email);
    const normalizedIdentityEmail = normalizeEmail(email);
    if (
      normalizedInviteEmail &&
      normalizedIdentityEmail &&
      normalizedInviteEmail !== normalizedIdentityEmail
    ) {
      throw new BadRequestException('Invitation email does not match this identity.');
    }

    invitation.status = 'accepted';
    invitation.accepted_at = new Date().toISOString();
    invitation.accepted_by_user_id = userId;
    const saved = await this.invitations.save(invitation);
    return {
      invitation: this.toSummary(saved),
      role: saved.role,
      workspaceId: saved.workspace_id,
      organizationId: saved.organization_id,
    };
  }

  private async expirePendingInvitations(): Promise<void> {
    const pending = await this.invitations.find({ where: { status: 'pending' } });
    const expired = pending.filter((row) => Date.parse(row.expires_at) <= Date.now());
    if (expired.length === 0) return;
    for (const row of expired) {
      row.status = 'expired';
    }
    await this.invitations.save(expired);
  }

  private toSummary(row: WorkspaceInvitation): WorkspaceInvitationSummary {
    return {
      id: row.id,
      organization_id: row.organization_id,
      workspace_id: row.workspace_id,
      role: row.role,
      email: row.email,
      status: row.status,
      expires_at: new Date(row.expires_at),
      accepted_at: row.accepted_at ? new Date(row.accepted_at) : null,
      accepted_by_user_id: row.accepted_by_user_id,
      created_by_user_id: row.created_by_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function assertRole(role: string): WorkspaceMembershipRole {
  if (
    WORKSPACE_MEMBERSHIP_ROLES.includes(
      role as WorkspaceMembershipRole,
    )
  ) {
    return role as WorkspaceMembershipRole;
  }
  throw new BadRequestException(`Invalid workspace invitation role: ${role}`);
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = (value || '').trim().toLowerCase();
  return normalized || null;
}
