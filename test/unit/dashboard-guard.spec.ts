import { Logger, UnauthorizedException } from '@nestjs/common';
import { DashboardGuard } from '../../src/auth/dashboard.guard';
import { DASHBOARD_SESSION_COOKIE } from '../../src/auth/dashboard-session-cookie';

function makeAuthService(overrides: Record<string, unknown> = {}): any {
  return {
    isAuthRequired: false,
    allowsLegacyDashboardTokenAuth: true,
    verifyToken: jest.fn().mockReturnValue(null),
    ...overrides,
  };
}

function makeContext(
  headers: Record<string, string> = {},
  query: Record<string, string> = {},
  cookies: Record<string, string> = {},
): any {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, query, cookies }),
    }),
  };
}

describe('DashboardGuard', () => {
  it('should allow all requests when dashboard auth is explicitly disabled', () => {
    const auth = makeAuthService({ isAuthRequired: false });
    const guard = new DashboardGuard(auth);
    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('should throw UnauthorizedException when auth required and no token', () => {
    const auth = makeAuthService({ isAuthRequired: true });
    const guard = new DashboardGuard(auth);
    expect(() => guard.canActivate(makeContext())).toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException for invalid Bearer token', () => {
    const auth = makeAuthService({
      isAuthRequired: true,
      verifyToken: jest.fn().mockReturnValue(null),
    });
    const guard = new DashboardGuard(auth);
    expect(() =>
      guard.canActivate(
        makeContext({ authorization: 'Bearer invalid-token' }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('should allow valid Bearer token', () => {
    const auth = makeAuthService({
      isAuthRequired: true,
      verifyToken: jest.fn().mockReturnValue({ sub: 'dashboard' }),
    });
    const guard = new DashboardGuard(auth);
    const result = guard.canActivate(
      makeContext({ authorization: 'Bearer valid-jwt-token' }),
    );
    expect(result).toBe(true);
    expect(auth.verifyToken).toHaveBeenCalledWith('valid-jwt-token');
  });

  it('should accept token from query param (for SSE)', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const auth = makeAuthService({
      isAuthRequired: true,
      verifyToken: jest.fn().mockReturnValue({ sub: 'dashboard' }),
    });
    const guard = new DashboardGuard(auth);
    const result = guard.canActivate(makeContext({}, { token: 'query-jwt' }));
    expect(result).toBe(true);
    expect(auth.verifyToken).toHaveBeenCalledWith('query-jwt');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('query-token authentication is deprecated'),
    );
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('query-jwt');
    warnSpy.mockRestore();
  });

  it('should accept token from dashboard session cookie', () => {
    const auth = makeAuthService({
      isAuthRequired: true,
      verifyToken: jest.fn().mockReturnValue({ sub: 'dashboard' }),
    });
    const guard = new DashboardGuard(auth);
    const result = guard.canActivate(
      makeContext(
        { cookie: `other=value; ${DASHBOARD_SESSION_COOKIE}=cookie-jwt` },
      ),
    );
    expect(result).toBe(true);
    expect(auth.verifyToken).toHaveBeenCalledWith('cookie-jwt');
  });

  it('should prefer Bearer header over query param', () => {
    const auth = makeAuthService({
      isAuthRequired: true,
      verifyToken: jest.fn().mockReturnValue({ sub: 'dashboard' }),
    });
    const guard = new DashboardGuard(auth);
    guard.canActivate(
      makeContext(
        { authorization: 'Bearer header-token' },
        { token: 'query-token' },
      ),
    );
    expect(auth.verifyToken).toHaveBeenCalledWith('header-token');
  });

  it('should prefer dashboard session cookie over legacy Bearer header', () => {
    const auth = makeAuthService({
      isAuthRequired: true,
      verifyToken: jest.fn().mockReturnValue({ sub: 'dashboard' }),
    });
    const guard = new DashboardGuard(auth);
    guard.canActivate(
      makeContext(
        {
          authorization: 'Bearer header-token',
          cookie: `other=value; ${DASHBOARD_SESSION_COOKIE}=cookie-token`,
        },
      ),
    );
    expect(auth.verifyToken).toHaveBeenCalledWith('cookie-token');
  });

  it('should prefer dashboard session cookie over legacy query param', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const auth = makeAuthService({
      isAuthRequired: true,
      verifyToken: jest.fn().mockReturnValue({ sub: 'dashboard' }),
    });
    const guard = new DashboardGuard(auth);
    guard.canActivate(
      makeContext(
        {},
        { token: 'query-token' },
        { [DASHBOARD_SESSION_COOKIE]: 'cookie-token' },
      ),
    );
    expect(auth.verifyToken).toHaveBeenCalledWith('cookie-token');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('should warn about legacy query-token fallback only once per guard', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const auth = makeAuthService({
      isAuthRequired: true,
      verifyToken: jest.fn().mockReturnValue({ sub: 'dashboard' }),
    });
    const guard = new DashboardGuard(auth);

    guard.canActivate(makeContext({}, { token: 'first-query-token' }));
    guard.canActivate(makeContext({}, { token: 'second-query-token' }));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('first-query-token');
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('second-query-token');
    warnSpy.mockRestore();
  });

  it('should reject legacy Bearer tokens when compatibility is disabled', () => {
    const auth = makeAuthService({
      isAuthRequired: true,
      allowsLegacyDashboardTokenAuth: false,
      verifyToken: jest.fn().mockReturnValue({ sub: 'dashboard' }),
    });
    const guard = new DashboardGuard(auth);

    expect(() =>
      guard.canActivate(
        makeContext({ authorization: 'Bearer header-token' }),
      ),
    ).toThrow(UnauthorizedException);
    expect(auth.verifyToken).not.toHaveBeenCalled();
  });

  it('should reject legacy query tokens when compatibility is disabled', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const auth = makeAuthService({
      isAuthRequired: true,
      allowsLegacyDashboardTokenAuth: false,
      verifyToken: jest.fn().mockReturnValue({ sub: 'dashboard' }),
    });
    const guard = new DashboardGuard(auth);

    expect(() =>
      guard.canActivate(makeContext({}, { token: 'query-token' })),
    ).toThrow(UnauthorizedException);
    expect(auth.verifyToken).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
