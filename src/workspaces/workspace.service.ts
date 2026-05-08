import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { Organization, Workspace } from '../database/entities';
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_ORGANIZATION_NAME,
  DEFAULT_ORGANIZATION_SLUG,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_WORKSPACE_SLUG,
} from './workspace.constants';

export interface WorkspaceSummary {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  status: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface WorkspaceState {
  organization: OrganizationSummary;
  active_workspace: WorkspaceSummary;
  default_workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  fallback: {
    legacy_resources_map_to_default_workspace: true;
    default_organization_id: string;
    default_workspace_id: string;
  };
}

@Injectable()
export class WorkspaceService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
  ) {}

  async getState(activeWorkspaceId?: string | null): Promise<WorkspaceState> {
    const organization = await this.getDefaultOrganization();
    const allWorkspaces = await this.listWorkspaces();
    const defaultWorkspace =
      allWorkspaces.find((workspace) => workspace.is_default) ||
      this.defaultWorkspaceSummary();
    const activeId = await this.resolveWorkspaceId(activeWorkspaceId);
    const activeWorkspace =
      allWorkspaces.find((workspace) => workspace.id === activeId) ||
      defaultWorkspace;
    return {
      organization,
      active_workspace: activeWorkspace,
      default_workspace: defaultWorkspace,
      workspaces: allWorkspaces.length > 0 ? allWorkspaces : [defaultWorkspace],
      fallback: {
        legacy_resources_map_to_default_workspace: true,
        default_organization_id: DEFAULT_ORGANIZATION_ID,
        default_workspace_id: DEFAULT_WORKSPACE_ID,
      },
    };
  }

  async resolveWorkspaceId(
    requested?: string | null,
    fallback?: string | null,
  ): Promise<string> {
    const candidate = normalizeId(requested) || normalizeId(fallback);
    if (!candidate) return DEFAULT_WORKSPACE_ID;
    const found = await this.findActiveWorkspace(candidate);
    return found?.id || DEFAULT_WORKSPACE_ID;
  }

  async requireWorkspace(id: string | null | undefined): Promise<WorkspaceSummary> {
    const workspaceId = normalizeId(id);
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }
    const found = await this.findActiveWorkspace(workspaceId);
    if (!found) {
      throw new NotFoundException(`Workspace not found: ${workspaceId}`);
    }
    return this.toWorkspaceSummary(found);
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const rows = await this.workspaces.find({
      where: [
        { status: 'active' },
        { status: IsNull() },
      ] as FindOptionsWhere<Workspace>[],
      order: { is_default: 'DESC', created_at: 'ASC' },
    });
    if (rows.length === 0) return [this.defaultWorkspaceSummary()];
    return rows.map((row) => this.toWorkspaceSummary(row));
  }

  private async getDefaultOrganization(): Promise<OrganizationSummary> {
    const row =
      (await this.organizations.findOne({
        where: { id: DEFAULT_ORGANIZATION_ID },
      })) ||
      (await this.organizations.findOne({
        where: { slug: DEFAULT_ORGANIZATION_SLUG },
      }));
    return row ? this.toOrganizationSummary(row) : this.defaultOrganizationSummary();
  }

  private async findActiveWorkspace(id: string): Promise<Workspace | null> {
    return this.workspaces.findOne({
      where: [
        { id, status: 'active' },
        { id, status: IsNull() },
      ] as FindOptionsWhere<Workspace>[],
    });
  }

  private toOrganizationSummary(row: Organization): OrganizationSummary {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status || 'active',
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private toWorkspaceSummary(row: Workspace): WorkspaceSummary {
    return {
      id: row.id,
      organization_id: row.organization_id,
      name: row.name,
      slug: row.slug,
      status: row.status || 'active',
      is_default: Boolean(row.is_default),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private defaultOrganizationSummary(): OrganizationSummary {
    const now = new Date(0);
    return {
      id: DEFAULT_ORGANIZATION_ID,
      name: DEFAULT_ORGANIZATION_NAME,
      slug: DEFAULT_ORGANIZATION_SLUG,
      status: 'active',
      created_at: now,
      updated_at: now,
    };
  }

  private defaultWorkspaceSummary(): WorkspaceSummary {
    const now = new Date(0);
    return {
      id: DEFAULT_WORKSPACE_ID,
      organization_id: DEFAULT_ORGANIZATION_ID,
      name: DEFAULT_WORKSPACE_NAME,
      slug: DEFAULT_WORKSPACE_SLUG,
      status: 'active',
      is_default: true,
      created_at: now,
      updated_at: now,
    };
  }
}

function normalizeId(value: string | null | undefined): string | null {
  const normalized = (value || '').trim();
  return normalized || null;
}
