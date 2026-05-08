import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import type { WorkspaceMembershipRole } from '../database/entities';
import {
  DASHBOARD_DEFAULT_USER_ID,
  DASHBOARD_REQUIRED_ROLE_KEY,
  dashboardRoleAllows,
  defaultDashboardRoleForMethod,
} from './dashboard-rbac';
import { WORKSPACE_HEADER } from '../workspaces/workspace.constants';
import { WorkspaceService } from '../workspaces/workspace.service';
import { WorkspaceMembershipService } from './workspace-membership.service';

@Injectable()
export class DashboardRbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly workspaces: WorkspaceService,
    private readonly memberships: WorkspaceMembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      Request & {
        dashboardUser?: JwtPayload | null;
        dashboardUserId?: string;
        workspaceId?: string;
        dashboardRole?: WorkspaceMembershipRole;
      }
    >();
    const required =
      this.reflector.getAllAndOverride<WorkspaceMembershipRole>(
        DASHBOARD_REQUIRED_ROLE_KEY,
        [context.getHandler(), context.getClass()],
      ) || defaultDashboardRoleForMethod(request.method);

    const userId = this.resolveUserId(request);
    const requestedWorkspace =
      request.workspaceId ||
      firstStringHeader(request.headers[WORKSPACE_HEADER]) ||
      firstStringHeader(request.headers[WORKSPACE_HEADER.toLowerCase()]) ||
      stringQueryValue(request.query?.workspace_id);
    const workspaceId = await this.workspaces.resolveWorkspaceId(requestedWorkspace);
    const role = await this.memberships.findActiveRole(userId, workspaceId);

    if (!dashboardRoleAllows(role, required)) {
      throw new ForbiddenException({
        error: {
          message: `Requires ${required} role for this workspace.`,
          type: 'dashboard_permission_denied',
          code: 'workspace_role_required',
        },
        required_role: required,
        current_role: role,
        workspace_id: workspaceId,
      });
    }

    request.dashboardUserId = userId;
    request.workspaceId = workspaceId;
    request.dashboardRole = role || undefined;
    return true;
  }

  private resolveUserId(request: {
    dashboardUser?: JwtPayload | null;
  }): string {
    const sub = request.dashboardUser?.sub;
    return typeof sub === 'string' && sub.trim()
      ? sub.trim()
      : DASHBOARD_DEFAULT_USER_ID;
  }
}

function firstStringHeader(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === 'string') || null;
  }
  return null;
}

function stringQueryValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === 'string') || null;
  }
  return null;
}
