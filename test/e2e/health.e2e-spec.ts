/**
 * E2E tests — GET /health endpoint
 */

import { createE2EHarness, E2EHarness } from './setup';

describe('Health (e2e)', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createE2EHarness();
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  it('GET /health → 200 with expected shape', async () => {
    const res = await harness.agent.get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(['healthy', 'degraded']).toContain(res.body.status);
    expect(typeof res.body.uptime_ms).toBe('number');
    expect(res.body.uptime_human).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
    expect(Array.isArray(res.body.nodes)).toBe(true);
    expect(res.body.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /health — nodes have expected shape', async () => {
    const res = await harness.agent.get('/health');
    const node = res.body.nodes[0];

    expect(node.id).toBeDefined();
    expect(node.name).toBeDefined();
    expect(node.protocol).toBeDefined();
    expect(typeof node.healthy).toBe('boolean');
    expect(node.circuit).toBeDefined();
  });

  it('GET /health — response includes helmet security headers', async () => {
    const res = await harness.agent.get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});
