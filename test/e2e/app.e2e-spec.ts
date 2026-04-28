/**
 * E2E test — Health endpoint + basic app bootstrap.
 *
 * Boots a slimmed-down NestJS app using the real AppModule
 * with the project's default gateway.config.yaml.
 * Uses native HTTP to test endpoints (no supertest dependency).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as http from 'http';
import * as path from 'path';

// Must set config path BEFORE importing AppModule
process.env.GATEWAY_CONFIG_PATH = path.resolve(__dirname, '../../gateway.config.yaml');

import { AppModule } from '../../src/app.module';

function httpGet(url: string, headers?: Record<string, string>): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    http.get(
      { hostname: opts.hostname, port: opts.port, path: opts.pathname, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode!, body: data }));
      },
    ).on('error', reject);
  });
}

describe('App (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Replicate main.ts pipes
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    await app.init();
    await app.listen(0); // random port
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' ? address!.port : address;
    baseUrl = `http://127.0.0.1:${port}`;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('should have booted successfully', () => {
    expect(app).toBeDefined();
  });

  it('GET /health — should return healthy status', async () => {
    const res = await httpGet(`${baseUrl}/health`);
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.status).toBeDefined();
    expect(['healthy', 'degraded']).toContain(body.status);
    expect(body.uptime_ms).toBeDefined();
    expect(typeof body.uptime_ms).toBe('number');
    expect(body.nodes).toBeDefined();
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(body.uptime_human).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });

  it('GET /health — nodes should have expected shape', async () => {
    const res = await httpGet(`${baseUrl}/health`);
    const body = JSON.parse(res.body);

    if (body.nodes.length > 0) {
      const node = body.nodes[0];
      expect(node.id).toBeDefined();
      expect(node.name).toBeDefined();
      expect(node.protocol).toBeDefined();
      expect(typeof node.healthy).toBe('boolean');
      expect(node.circuit).toBeDefined();
    }
  });

  it('GET /v1/models — should return models list', async () => {
    const res = await httpGet(`${baseUrl}/v1/models`, {
      Authorization: 'Bearer gw_sk_dev_default',
    });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.object).toBe('list');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].id).toBeDefined();
    expect(body.data[0].object).toBe('model');
  });
});
