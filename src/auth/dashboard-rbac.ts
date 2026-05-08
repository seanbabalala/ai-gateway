import { SetMetadata } from '@nestjs/common';
import type { WorkspaceMembershipRole } from '../database/entities';

export const DASHBOARD_REQUIRED_ROLE_KEY = 'dashboard:required-role';
export const DASHBOARD_DEFAULT_USER_ID = 'dashboard';

const ROLE_RANK: Record<WorkspaceMembershipRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

export const RequireDashboardRole = (role: WorkspaceMembershipRole) =>
  SetMetadata(DASHBOARD_REQUIRED_ROLE_KEY, role);

export function dashboardRoleAllows(
  actual: WorkspaceMembershipRole | null | undefined,
  required: WorkspaceMembershipRole,
): boolean {
  if (!actual) return false;
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function defaultDashboardRoleForMethod(
  method: string | undefined,
): WorkspaceMembershipRole {
  const normalized = (method || 'GET').toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD'
    ? 'viewer'
    : 'admin';
}
