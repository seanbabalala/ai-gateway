import { createE2EHarness, E2EHarness } from './setup';

describe('OpenAPI documentation endpoints', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createE2EHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('GET /openapi.json exposes documented OSS Data Plane paths without real secrets', async () => {
    const res = await harness.agent.get('/openapi.json').expect(200);

    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toBe('SiftGate Data Plane API');

    expect(res.body.components.securitySchemes.gatewayApiKey).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(res.body.components.securitySchemes.dashboardSession).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });

    const paths = Object.keys(res.body.paths);
    expect(paths).toEqual(expect.arrayContaining([
      '/v1/chat/completions',
      '/v1/embeddings',
      '/v1/rerank',
      '/v1/images/generations',
      '/v1/images/edits',
      '/v1/audio/transcriptions',
      '/v1/audio/speech',
      '/v1/responses',
      '/v1/messages',
      '/v1/models',
      '/health',
      '/cluster/status',
      '/api/auth/login',
      '/api/auth/status',
      '/api/dashboard/stats',
      '/api/dashboard/logs',
      '/api/dashboard/config',
      '/api/dashboard/config/reload',
      '/api/dashboard/api-keys',
      '/api/dashboard/api-keys/{id}',
      '/api/dashboard/api-keys/{id}/rotate',
      '/api/dashboard/nodes',
      '/api/dashboard/nodes/test',
    ]));

    expect(res.body.components.schemas.CreateNodeDto.properties.api_key).toMatchObject({
      writeOnly: true,
      format: 'password',
    });
    expect(res.body.components.schemas.SanitizedNodeConfigDto.properties.api_key).toMatchObject({
      readOnly: true,
    });

    const spec = JSON.stringify(res.body);
    expect(spec).not.toContain('mock-openai-key');
    expect(spec).not.toContain('mock-claude-key');
    expect(spec).not.toContain('dashboardPasswordHash');
    expect(spec).not.toContain('password_hash');
  });

  it('GET /docs serves the Swagger UI', async () => {
    const res = await harness.agent.get('/docs/').expect(200);

    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('SiftGate API Docs');
    expect(res.text).toContain('swagger-ui');
  });
});
