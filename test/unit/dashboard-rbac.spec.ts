import {
  dashboardRoleAllows,
  defaultDashboardRoleForMethod,
} from '../../src/auth/dashboard-rbac';

describe('Dashboard RBAC permission matrix', () => {
  it('allows higher roles to satisfy lower requirements', () => {
    expect(dashboardRoleAllows('viewer', 'viewer')).toBe(true);
    expect(dashboardRoleAllows('viewer', 'operator')).toBe(false);
    expect(dashboardRoleAllows('operator', 'viewer')).toBe(true);
    expect(dashboardRoleAllows('operator', 'operator')).toBe(true);
    expect(dashboardRoleAllows('operator', 'admin')).toBe(false);
    expect(dashboardRoleAllows('admin', 'viewer')).toBe(true);
    expect(dashboardRoleAllows('admin', 'operator')).toBe(true);
    expect(dashboardRoleAllows('admin', 'admin')).toBe(true);
  });

  it('defaults reads to viewer and writes to admin', () => {
    expect(defaultDashboardRoleForMethod('GET')).toBe('viewer');
    expect(defaultDashboardRoleForMethod('HEAD')).toBe('viewer');
    expect(defaultDashboardRoleForMethod('POST')).toBe('admin');
    expect(defaultDashboardRoleForMethod('PUT')).toBe('admin');
    expect(defaultDashboardRoleForMethod('DELETE')).toBe('admin');
  });
});
