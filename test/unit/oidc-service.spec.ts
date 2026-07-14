import { OidcService } from '../../src/auth/oidc.service';
import { mockConfigService } from '../helpers';

function makeService(overrides: Record<string, unknown> = {}) {
  const config = mockConfigService({
    dashboard: {
      session_secret: 'test-session-secret',
      oidc: {
        enabled: true,
        issuer: 'https://idp.example.com',
        client_id: 'siftgate',
        redirect_uri: 'http://localhost:2099/api/auth/oidc/callback',
        allowed_domains: ['example.com'],
        default_role: 'viewer',
        default_workspace_id: 'default-workspace',
        scopes: ['openid', 'email', 'profile'],
        timeout_ms: 10000,
      },
    },
    dashboardOidc: {
      enabled: true,
      issuer: 'https://idp.example.com',
      client_id: 'siftgate',
      client_secret: '${env:OIDC_CLIENT_SECRET:-test}',
      redirect_uri: 'http://localhost:2099/api/auth/oidc/callback',
      allowed_domains: ['example.com'],
      default_role: 'viewer',
      default_workspace_id: 'default-workspace',
      scopes: ['openid', 'email', 'profile'],
      timeout_ms: 10000,
    },
    ...overrides,
  });
  const auth = {
    generateToken: jest.fn(() => 'dashboard-jwt'),
  };
  const secrets = {
    resolveOptionalString: jest.fn(async () => 'oidc-secret'),
  };
  const memberships = {
    ensureMembership: jest.fn(async (input) => input),
  };
  const invitations = {
    acceptForUser: jest.fn(async () => null),
    acceptHashForUser: jest.fn(async () => null),
  };
  const state: any = {
    setJson: jest.fn(async () => {}),
    getJson: jest.fn(async () => null),
    delete: jest.fn(async () => {}),
  };
  const service = new OidcService(
    config,
    auth as any,
    secrets as any,
    memberships as any,
    invitations as any,
    state as any,
  );
  return { service, auth, secrets, memberships, invitations, state };
}

describe('OidcService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('times out OIDC discovery requests', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }) as any;
    const { service } = makeService();
    (service as any).config.dashboardOidc.timeout_ms = 5;

    const redirect = service.createAuthorizationRedirect();
    const expectation = expect(redirect).rejects.toThrow('OIDC discovery timed out after 5ms.');
    await jest.advanceTimersByTimeAsync(5);

    await expectation;
    expect(global.fetch).toHaveBeenCalledWith(
      'https://idp.example.com/.well-known/openid-configuration',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('creates an authorization redirect and stores state without exposing invite payloads', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({
        issuer: 'https://idp.example.com',
        authorization_endpoint: 'https://idp.example.com/oauth/authorize',
        token_endpoint: 'https://idp.example.com/oauth/token',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ) as any;
    const { service, state } = makeService();

    const redirect = await service.createAuthorizationRedirect({
      inviteToken: 'sg_inv_test',
    });

    const url = new URL(redirect);
    expect(url.origin + url.pathname).toBe('https://idp.example.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('siftgate');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(state.setJson).toHaveBeenCalledWith(
      'realtime_session',
      expect.stringMatching(/^oidc:state:/),
      expect.objectContaining({
        inviteTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      600,
      { workspaceId: 'default-workspace' },
    );
    expect(JSON.stringify(state.setJson.mock.calls[0][2])).not.toContain('sg_inv_test');
  });

  it('maps a mocked OIDC identity to workspace membership', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/.well-known/openid-configuration')) {
        return new Response(JSON.stringify({
          issuer: 'https://idp.example.com',
          authorization_endpoint: 'https://idp.example.com/oauth/authorize',
          token_endpoint: 'https://idp.example.com/oauth/token',
          userinfo_endpoint: 'https://idp.example.com/userinfo',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/oauth/token')) {
        expect(init?.body?.toString()).toContain('client_secret=oidc-secret');
        return new Response(JSON.stringify({
          access_token: 'access-token',
          token_type: 'Bearer',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        sub: 'user-1',
        email: 'user@example.com',
        email_verified: true,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    const { service, auth, memberships, state } = makeService();
    state.getJson.mockResolvedValueOnce({
      nonce: 'nonce',
      createdAt: Date.now(),
    });

    const result = await service.completeCallback({
      code: 'auth-code',
      state: 'state-token',
    });

    expect(result.user_id).toBe('oidc:user@example.com');
    expect(memberships.ensureMembership).toHaveBeenCalledWith({
      userId: 'oidc:user@example.com',
      organizationId: 'default-org',
      workspaceId: 'default-workspace',
      role: 'viewer',
    });
    expect(auth.generateToken).toHaveBeenCalledWith(
      'oidc:user@example.com',
      expect.objectContaining({ auth_provider: 'oidc', email: 'user@example.com' }),
    );
  });
});
