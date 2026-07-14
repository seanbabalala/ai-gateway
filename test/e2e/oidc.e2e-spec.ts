import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { json, raw, urlencoded } from 'express';
import helmet from 'helmet';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  WorkspaceInvitation,
  WorkspaceMembership,
} from '../../src/database/entities';
import { DASHBOARD_SESSION_COOKIE } from '../../src/auth/dashboard-session-cookie';
import { hashInviteToken } from '../../src/auth/workspace-invitation.service';
import type { Repository } from 'typeorm';

describe('OIDC login and invites (e2e)', () => {
  let app: INestApplication;
  let agent: request.Agent;
  let originalFetch: typeof globalThis.fetch;
  let tempDir: string;
  let membershipRepo: Repository<WorkspaceMembership>;
  let invitationRepo: Repository<WorkspaceInvitation>;

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-oidc-e2e-'));
    const configPath = path.join(tempDir, 'gateway.config.yaml');
    fs.writeFileSync(configPath, oidcFixtureYaml());
    process.env.GATEWAY_CONFIG_PATH = configPath;
    process.env.OIDC_CLIENT_SECRET = 'oidc-secret';

    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/.well-known/openid-configuration')) {
        return new Response(JSON.stringify({
          issuer: 'https://idp.example.test',
          authorization_endpoint: 'https://idp.example.test/oauth/authorize',
          token_endpoint: 'https://idp.example.test/oauth/token',
          userinfo_endpoint: 'https://idp.example.test/userinfo',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/oauth/token')) {
        expect(init?.body?.toString()).toContain('client_secret=oidc-secret');
        return new Response(JSON.stringify({
          access_token: 'access-token',
          token_type: 'Bearer',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/userinfo')) {
        return new Response(JSON.stringify({
          sub: 'user-oidc-1',
          email: 'dev@example.com',
          email_verified: true,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    }) as any;

    const { AppModule } = await import('../../src/app.module');
    const { PluginLoaderService } = await import('../../src/plugins/plugin-loader.service');
    const { setupOpenApi } = await import('../../src/openapi/setup-openapi');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PluginLoaderService)
      .useValue({ onModuleInit: () => {} })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    setupOpenApi(app);
    app.use(helmet());
    app.enableCors({ origin: true, credentials: true });
    const mediaBodyTypes = [
      'multipart/form-data',
      'application/octet-stream',
      'audio/*',
      'image/*',
    ];
    for (const route of [
      '/v1/images/generations',
      '/v1/images/edits',
      '/v1/images/variations',
      '/v1/audio/transcriptions',
      '/v1/audio/translations',
      '/v1/audio/speech',
    ]) {
      app.use(route, raw({ type: mediaBodyTypes, limit: '1mb' }));
    }
    app.use(json({ limit: '1mb' }));
    app.use(urlencoded({ extended: true, limit: '1mb' }));

    await app.init();
    membershipRepo = app.get(getRepositoryToken(WorkspaceMembership));
    invitationRepo = app.get(getRepositoryToken(WorkspaceInvitation));
    await app.listen(0);
    agent = request.agent(app.getHttpServer());
  }, 30_000);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.OIDC_CLIENT_SECRET;
    await app?.close();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('advertises OIDC status and starts login', async () => {
    const status = await agent.get('/api/auth/status');
    expect(status.status).toBe(200);
    expect(status.body.authRequired).toBe(true);
    expect(status.body.authenticated).toBe(false);
    expect(status.body.localLoginEnabled).toBe(false);
    expect(status.body.oidc.enabled).toBe(true);

    const start = await agent.get('/api/auth/oidc/start').redirects(0);
    expect(start.status).toBe(302);
    const location = new URL(start.headers.location);
    expect(location.origin + location.pathname).toBe('https://idp.example.test/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('siftgate-e2e');
  });

  it('accepts an invitation during mocked OIDC callback and creates membership', async () => {
    const inviteToken = 'sg_inv_e2e_oidc';
    await invitationRepo.save(invitationRepo.create({
      organization_id: 'default-org',
      workspace_id: 'default-workspace',
      role: 'operator',
      email: 'dev@example.com',
      token_hash: hashInviteToken(inviteToken),
      status: 'pending',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      accepted_at: null,
      accepted_by_user_id: null,
      created_by_user_id: 'dashboard',
    }));

    const start = await agent
      .get(`/api/auth/oidc/start?invite=${encodeURIComponent(inviteToken)}`)
      .redirects(0);
    const authUrl = new URL(start.headers.location);
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await agent
      .get(`/api/auth/oidc/callback?code=mock-code&state=${encodeURIComponent(state!)}`)
      .redirects(0);

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe('/login');
    expect(callback.headers.location).not.toContain('token=');
    const setCookie = callback.headers['set-cookie'] as string | string[] | undefined;
    const setCookieHeader = Array.isArray(setCookie) ? setCookie.join('\n') : (setCookie ?? '');
    expect(setCookieHeader).toContain(`${DASHBOARD_SESSION_COOKIE}=`);
    const membership = await membershipRepo.findOne({
      where: {
        user_id: 'oidc:dev@example.com',
        workspace_id: 'default-workspace',
      },
    });
    expect(membership?.role).toBe('operator');
    const invitation = await invitationRepo.findOne({
      where: { token_hash: hashInviteToken(inviteToken) },
    });
    expect(invitation?.status).toBe('accepted');
  });
});

function oidcFixtureYaml(): string {
  return `
server:
  port: 0
  host: 127.0.0.1
  helmet: true
  body_limit: 1mb
database:
  type: sqlite
  path: ':memory:'
dashboard:
  session_secret: e2e-session-secret
  oidc:
    enabled: true
    issuer: https://idp.example.test
    client_id: siftgate-e2e
    client_secret: \${env:OIDC_CLIENT_SECRET}
    redirect_uri: http://127.0.0.1:2099/api/auth/oidc/callback
    allowed_domains:
      - example.com
    default_role: viewer
    default_workspace_id: default-workspace
auth:
  api_keys: []
  rate_limit:
    requests_per_minute: 1000
    requests_per_minute_ip: 1000
    login_requests_per_minute: 5
nodes:
  - id: mock-openai
    name: Mock OpenAI
    protocol: chat_completions
    base_url: http://mock-upstream.test
    endpoint: /v1/chat/completions
    api_key: mock-openai-key
    models:
      - gpt-4o
routing:
  tiers:
    simple:
      primary:
        node: mock-openai
        model: gpt-4o
  scoring:
    simple_max: 1
    standard_max: 1
    complex_max: 1
budget:
  daily_token_limit: 5000000
  daily_cost_limit: 50
  alert_threshold: 0.8
models_pricing:
  gpt-4o:
    input: 2.5
    output: 10
`;
}
