#!/usr/bin/env node
require('reflect-metadata');
require('ts-node/register/transpile-only');

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { ValidationPipe } = require('@nestjs/common');
const { Test } = require('@nestjs/testing');
const { getRepositoryToken } = require('@nestjs/typeorm');
const { json, raw, urlencoded } = require('express');
const helmet = require('helmet');
const yaml = require('js-yaml');

const packageJson = require('../package.json');

const BENCH_API_KEY = 'gw_sk_bench_local_rc2';
const BENCH_KEY_PREFIX = 'gw_sk_bench_local...rc2';
const DEFAULT_REQUESTS = 20;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 120000;

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanEnv(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sanitizeError(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/gw_sk_[A-Za-z0-9._~+/=-]+/gi, 'gw_sk_[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
    .replace(/(api[_-]?key=)[^&\s]+/gi, '$1[redacted]')
    .replace(/:\/\/([^:@/]+):([^@/]+)@/g, '://$1:***@')
    .slice(0, 220);
}

function topErrors(results) {
  const counts = {};
  for (const result of results) {
    if (result.ok) continue;
    const key = sanitizeError(result.error || `HTTP ${result.status}`);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([error, count]) => ({ error, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function statusCounts(results) {
  return results.reduce((acc, result) => {
    acc[result.status || 0] = (acc[result.status || 0] || 0) + 1;
    return acc;
  }, {});
}

function summarizeMeasuredScenario(input) {
  const latencies = input.results.map((result) => result.latency_ms);
  const firstByteLatencies = input.results
    .map((result) => result.first_byte_ms)
    .filter((value) => typeof value === 'number');
  const success = input.results.filter((result) => result.ok).length;
  const failed = input.results.length - success;
  const durationSeconds = input.duration_seconds || 0.001;
  const summary = {
    name: input.name,
    status: failed === 0 ? 'measured' : 'failed',
    category: input.category,
    description: input.description,
    storage: input.storage || null,
    state_backend: input.state_backend || null,
    requests: input.results.length,
    concurrency: input.concurrency,
    success,
    failed,
    success_rate: round((success / Math.max(1, input.results.length)) * 100, 1),
    throughput_rps: round(input.results.length / durationSeconds, 2),
    duration_seconds: round(durationSeconds, 3),
    latency_ms: {
      avg: Math.round(average(latencies)),
      p50: Math.round(percentile(latencies, 50)),
      p95: Math.round(percentile(latencies, 95)),
      p99: Math.round(percentile(latencies, 99)),
      max: Math.round(Math.max(0, ...latencies)),
    },
    status_counts: statusCounts(input.results),
    top_errors: topErrors(input.results),
  };

  if (firstByteLatencies.length > 0) {
    summary.first_byte_ms = {
      avg: Math.round(average(firstByteLatencies)),
      p50: Math.round(percentile(firstByteLatencies, 50)),
      p95: Math.round(percentile(firstByteLatencies, 95)),
      p99: Math.round(percentile(firstByteLatencies, 99)),
      max: Math.round(Math.max(0, ...firstByteLatencies)),
    };
  }

  if (input.extra) {
    summary.extra = input.extra;
  }

  return summary;
}

function skippedScenario(name, category, reason, extra = {}) {
  return {
    name,
    status: 'skipped',
    category,
    description: extra.description || null,
    reason,
    requests: 0,
    concurrency: 0,
    success: 0,
    failed: 0,
    latency_ms: null,
    throughput_rps: null,
    ...extra,
  };
}

async function runConcurrent({ name, category, description, requests, concurrency, operation, storage, state_backend, extra }) {
  const results = [];
  let next = 0;
  const started = performance.now();

  async function worker() {
    while (next < requests) {
      const index = next;
      next += 1;
      results.push(await operation(index));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
  const durationSeconds = (performance.now() - started) / 1000;
  return summarizeMeasuredScenario({
    name,
    category,
    description,
    results,
    concurrency,
    duration_seconds: durationSeconds,
    storage,
    state_backend,
    extra,
  });
}

function chatBody(model, stream = false) {
  return {
    model,
    stream,
    messages: [
      {
        role: 'user',
        content: 'Reply with OK.',
      },
    ],
    max_tokens: 8,
  };
}

async function postJsonScenario(url, body, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    await response.text();
    return {
      ok: response.ok,
      status: response.status,
      latency_ms: performance.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latency_ms: performance.now() - started,
      error: error instanceof Error ? error.message : 'unknown error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function streamingScenario(url, body, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  let firstByteMs;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal: controller.signal,
    });

    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (firstByteMs === undefined && value && value.length > 0) {
          firstByteMs = performance.now() - started;
        }
      }
    } else {
      await response.text();
    }

    return {
      ok: response.ok,
      status: response.status,
      first_byte_ms: firstByteMs,
      latency_ms: performance.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      first_byte_ms: firstByteMs,
      latency_ms: performance.now() - started,
      error: error instanceof Error ? error.message : 'unknown error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getScenario(url, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined,
      signal: controller.signal,
    });
    await response.text();
    return {
      ok: response.ok,
      status: response.status,
      latency_ms: performance.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latency_ms: performance.now() - started,
      error: error instanceof Error ? error.message : 'unknown error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function startMockUpstream(options = {}) {
  const responseDelayMs = positiveInt(options.responseDelayMs, 1);
  const streamChunkDelayMs = positiveInt(options.streamChunkDelayMs, 1);
  let requestCount = 0;

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requestCount += 1;
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        body = {};
      }

      if (body.stream) {
        writeMockStream(res, body, streamChunkDelayMs).catch((error) => {
          res.destroy(error);
        });
        return;
      }

      setTimeout(() => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(mockChatResponse(body)));
      }, responseDelayMs);
    });
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock upstream did not expose a TCP address.');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    get requestCount() {
      return requestCount;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function mockChatResponse(body) {
  const model = typeof body.model === 'string' && body.model !== 'auto'
    ? body.model
    : 'gpt-4o';
  return {
    id: 'chatcmpl-benchmark',
    object: 'chat.completion',
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'OK' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 2,
      total_tokens: 12,
    },
  };
}

async function writeMockStream(res, body, delayMs) {
  const model = typeof body.model === 'string' && body.model !== 'auto'
    ? body.model
    : 'gpt-4o';
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const events = [
    {
      id: 'chatcmpl-benchmark-stream',
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-benchmark-stream',
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta: { content: 'O' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-benchmark-stream',
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta: { content: 'K' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-benchmark-stream',
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
      },
    },
  ];

  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    await sleep(delayMs);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startGateway({ label, mockUpstreamUrl, database, redisUrl }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `siftgate-${label}-`));
  const configPath = path.join(tempDir, 'gateway.config.yaml');
  const config = buildGatewayConfig({ mockUpstreamUrl, database, redisUrl });
  fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: 120 }), 'utf8');

  const previousConfigPath = process.env.GATEWAY_CONFIG_PATH;
  const previousInstanceId = process.env.SIFTGATE_INSTANCE_ID;
  process.env.GATEWAY_CONFIG_PATH = configPath;
  process.env.SIFTGATE_INSTANCE_ID = `bench-${label}-${process.pid}`;

  const { AppModule } = require('../src/app.module');
  const { PluginLoaderService } = require('../src/plugins/plugin-loader.service');
  const { setupOpenApi } = require('../src/openapi/setup-openapi');
  const { GatewayApiKey, CallLog } = require('../src/database/entities');
  const { DEFAULT_WORKSPACE_ID } = require('../src/workspaces/workspace.constants');

  let app;
  try {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PluginLoaderService)
      .useValue({ onModuleInit: () => undefined })
      .compile();

    app = moduleFixture.createNestApplication({ logger: false });
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

    const apiKeyRepo = app.get(getRepositoryToken(GatewayApiKey));
    await apiKeyRepo.save(
      apiKeyRepo.create({
        name: 'benchmark-default',
        workspace_id: DEFAULT_WORKSPACE_ID,
        key_hash: createHash('sha256').update(BENCH_API_KEY).digest('hex'),
        key_prefix: BENCH_KEY_PREFIX,
        status: 'active',
        allow_auto: true,
        allow_direct: true,
        allowed_nodes: [],
        allowed_models: [],
        allowed_endpoints: [],
        allowed_modalities: [],
      }),
    );

    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer();
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Gateway did not expose a TCP address.');
    }

    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      callLogRepo: app.get(getRepositoryToken(CallLog)),
      close: async () => {
        await app.close();
        process.env.GATEWAY_CONFIG_PATH = previousConfigPath || '';
        process.env.SIFTGATE_INSTANCE_ID = previousInstanceId || '';
        if (!previousConfigPath) delete process.env.GATEWAY_CONFIG_PATH;
        if (!previousInstanceId) delete process.env.SIFTGATE_INSTANCE_ID;
        if (!booleanEnv(process.env.SIFTGATE_BENCH_KEEP_TEMP)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    if (app) await app.close().catch(() => undefined);
    process.env.GATEWAY_CONFIG_PATH = previousConfigPath || '';
    process.env.SIFTGATE_INSTANCE_ID = previousInstanceId || '';
    if (!previousConfigPath) delete process.env.GATEWAY_CONFIG_PATH;
    if (!previousInstanceId) delete process.env.SIFTGATE_INSTANCE_ID;
    if (!booleanEnv(process.env.SIFTGATE_BENCH_KEEP_TEMP)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw error;
  }
}

function buildGatewayConfig({ mockUpstreamUrl, database, redisUrl }) {
  const state = redisUrl
    ? {
        backend: 'redis',
        unavailable_policy: 'fail_closed',
        redis: {
          url: redisUrl,
          prefix: `siftgate:bench:${process.pid}:`,
          timeout_ms: 1000,
          sync_interval_ms: 1000,
        },
        categories: {
          rate_limit: { unavailable_policy: 'fail_closed', ttl_seconds: 60 },
          circuit_breaker: { unavailable_policy: 'fail_closed', ttl_seconds: 60 },
          cache_affinity: { unavailable_policy: 'fail_open', ttl_seconds: 60 },
          concurrency: { unavailable_policy: 'fail_open', ttl_seconds: 60 },
          health_probe: { unavailable_policy: 'fail_open', ttl_seconds: 60 },
          realtime_session: { unavailable_policy: 'fail_open', ttl_seconds: 60 },
        },
      }
    : undefined;

  return {
    server: {
      port: 0,
      host: '127.0.0.1',
      helmet: true,
      body_limit: '1mb',
    },
    database,
    auth: {
      api_keys: [],
      rate_limit: {
        requests_per_minute: 100000,
        requests_per_minute_ip: 100000,
        max_entries: 10000,
        login_requests_per_minute: 100000,
      },
    },
    nodes: [
      {
        id: 'bench-openai',
        name: 'Benchmark Mock OpenAI',
        protocol: 'chat_completions',
        base_url: mockUpstreamUrl,
        endpoint: '/v1/chat/completions',
        api_key: 'bench-upstream-key',
        models: ['gpt-4o', 'gpt-4o-mini'],
        timeout_ms: 10000,
        tags: ['fast', 'code'],
      },
    ],
    routing: {
      tiers: {
        simple: {
          primary: { node: 'bench-openai', model: 'gpt-4o-mini' },
          fallbacks: [],
        },
        standard: {
          primary: { node: 'bench-openai', model: 'gpt-4o' },
          fallbacks: [],
        },
        complex: {
          primary: { node: 'bench-openai', model: 'gpt-4o' },
          fallbacks: [],
        },
        reasoning: {
          primary: { node: 'bench-openai', model: 'gpt-4o' },
          fallbacks: [],
        },
      },
      scoring: {
        simple_max: -0.1,
        standard_max: 0.08,
        complex_max: 0.35,
      },
    },
    budget: {
      daily_token_limit: 100000000,
      daily_cost_limit: 1000000,
      alert_threshold: 0.9,
    },
    models_pricing: {
      'gpt-4o': { input: 2.5, output: 10 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
    },
    namespaces: [],
    ...(state ? { state, cluster: { enabled: true, redis: { url: redisUrl, prefix: state.redis.prefix } } } : {}),
  };
}

function sqliteDatabaseConfig(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `siftgate-db-${label}-`));
  return {
    config: {
      type: 'sqlite',
      path: path.join(dir, 'gateway.db'),
      log_retention_days: 1,
    },
    cleanup: () => {
      if (!booleanEnv(process.env.SIFTGATE_BENCH_KEEP_TEMP)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

function postgresDatabaseConfig(url) {
  return {
    type: 'postgres',
    url,
    synchronize: booleanEnv(process.env.SIFTGATE_BENCH_POSTGRES_SYNCHRONIZE, true),
    log_retention_days: 1,
    pool: {
      max: positiveInt(process.env.SIFTGATE_BENCH_POSTGRES_POOL_MAX, 10),
      min: 0,
      idle_timeout_ms: 30000,
      connection_timeout_ms: 5000,
      application_name: 'siftgate-benchmark',
    },
  };
}

async function measureLogWrites(callLogRepo, requests, concurrency) {
  const { DEFAULT_WORKSPACE_ID } = require('../src/workspaces/workspace.constants');
  return runConcurrent({
    name: 'dashboard_log_write_sqlite',
    category: 'dashboard_log_write',
    description: 'Metadata-only call_log insert overhead through the configured SQLite database.',
    requests,
    concurrency,
    storage: 'sqlite',
    operation: async (index) => {
      const started = performance.now();
      try {
        await callLogRepo.save(
          callLogRepo.create({
            request_id: `bench-log-write-${process.pid}-${Date.now()}-${index}`,
            source_format: 'chat_completions',
            tier: 'standard',
            score: 0.01,
            node_id: 'bench-openai',
            model: 'gpt-4o',
            input_tokens: 10,
            output_tokens: 2,
            cost_usd: 0.000045,
            latency_ms: 1,
            stream: false,
            status_code: 200,
            is_fallback: false,
            workspace_id: DEFAULT_WORKSPACE_ID,
            api_key_name: 'benchmark-default',
          }),
        );
        return { ok: true, status: 200, latency_ms: performance.now() - started };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          latency_ms: performance.now() - started,
          error: error instanceof Error ? error.message : 'unknown error',
        };
      }
    },
  });
}

async function runSqliteScenarios({ mockUpstreamUrl, requests, concurrency, timeoutMs }) {
  const sqlite = sqliteDatabaseConfig('sqlite');
  let gateway;
  try {
    gateway = await startGateway({
      label: 'sqlite',
      mockUpstreamUrl,
      database: sqlite.config,
    });
    const chatUrl = `${gateway.baseUrl}/v1/chat/completions`;
    const scenarios = [];

    scenarios.push(await runConcurrent({
      name: 'chat_proxy_direct_sqlite',
      category: 'non_streaming_chat_proxy',
      description: 'OpenAI-compatible non-streaming chat request through SiftGate with a direct model.',
      requests,
      concurrency,
      storage: 'sqlite',
      state_backend: 'memory',
      operation: () => postJsonScenario(chatUrl, chatBody('gpt-4o'), {
        apiKey: BENCH_API_KEY,
        timeoutMs,
      }),
    }));

    scenarios.push(await runConcurrent({
      name: 'chat_smart_routing_sqlite',
      category: 'smart_routing',
      description: 'OpenAI-compatible non-streaming chat request through SiftGate with model=auto.',
      requests,
      concurrency,
      storage: 'sqlite',
      state_backend: 'memory',
      operation: () => postJsonScenario(chatUrl, chatBody('auto'), {
        apiKey: BENCH_API_KEY,
        timeoutMs,
      }),
    }));

    scenarios.push(await runConcurrent({
      name: 'streaming_chat_sqlite',
      category: 'streaming_chat_proxy',
      description: 'OpenAI-compatible streaming chat request through SiftGate, including first-byte timing.',
      requests,
      concurrency,
      storage: 'sqlite',
      state_backend: 'memory',
      operation: () => streamingScenario(chatUrl, chatBody('gpt-4o', true), {
        apiKey: BENCH_API_KEY,
        timeoutMs,
      }),
    }));

    scenarios.push(await measureLogWrites(gateway.callLogRepo, requests, concurrency));

    scenarios.push(await runConcurrent({
      name: 'dashboard_log_read_sqlite',
      category: 'dashboard_log_read',
      description: 'Dashboard benchmark report read from sanitized call-log metadata.',
      requests: Math.max(1, Math.min(requests, 10)),
      concurrency: Math.max(1, Math.min(concurrency, 2)),
      storage: 'sqlite',
      state_backend: 'memory',
      operation: () => getScenario(
        `${gateway.baseUrl}/api/dashboard/benchmarks/report?period=24h&source_format=chat_completions&limit=5000`,
        { timeoutMs },
      ),
    }));

    return scenarios;
  } finally {
    if (gateway) await gateway.close();
    sqlite.cleanup();
  }
}

async function runPostgresScenario({ mockUpstreamUrl, requests, concurrency, timeoutMs, postgresUrl }) {
  if (!postgresUrl) {
    return skippedScenario(
      'postgres_production_chat_proxy',
      'postgres_production_mode',
      'Set SIFTGATE_BENCH_POSTGRES_URL to run this optional benchmark against a prepared PostgreSQL database.',
      { storage: 'postgres', state_backend: 'memory' },
    );
  }

  let gateway;
  try {
    gateway = await startGateway({
      label: 'postgres',
      mockUpstreamUrl,
      database: postgresDatabaseConfig(postgresUrl),
    });
    return await runConcurrent({
      name: 'postgres_production_chat_proxy',
      category: 'postgres_production_mode',
      description: 'Non-streaming chat proxy path using PostgreSQL as the durable metadata database.',
      requests,
      concurrency,
      storage: 'postgres',
      state_backend: 'memory',
      operation: () => postJsonScenario(
        `${gateway.baseUrl}/v1/chat/completions`,
        chatBody('gpt-4o'),
        { apiKey: BENCH_API_KEY, timeoutMs },
      ),
    });
  } catch (error) {
    return {
      ...skippedScenario(
        'postgres_production_chat_proxy',
        'postgres_production_mode',
        `PostgreSQL benchmark could not start: ${sanitizeError(error instanceof Error ? error.message : error)}`,
        { storage: 'postgres', state_backend: 'memory' },
      ),
      status: 'failed',
    };
  } finally {
    if (gateway) await gateway.close();
  }
}

async function runRedisScenario({ mockUpstreamUrl, requests, concurrency, timeoutMs, redisUrl }) {
  if (!redisUrl) {
    return skippedScenario(
      'redis_cluster_chat_proxy',
      'redis_cluster_mode',
      'Set SIFTGATE_BENCH_REDIS_URL to run this optional benchmark against Redis-backed shared state and cluster mode.',
      { storage: 'sqlite', state_backend: 'redis' },
    );
  }

  const sqlite = sqliteDatabaseConfig('redis');
  let gateway;
  try {
    gateway = await startGateway({
      label: 'redis',
      mockUpstreamUrl,
      database: sqlite.config,
      redisUrl,
    });
    const clusterStatus = await fetch(`${gateway.baseUrl}/api/dashboard/cluster`).then((res) => res.json());
    if (clusterStatus?.redis?.status !== 'ready' || clusterStatus?.state?.redis_available !== true) {
      throw new Error(`Redis cluster mode was not ready: ${JSON.stringify(clusterStatus?.redis || {})}`);
    }
    return await runConcurrent({
      name: 'redis_cluster_chat_proxy',
      category: 'redis_cluster_mode',
      description: 'Non-streaming chat proxy path with Redis shared state and cluster mode enabled.',
      requests,
      concurrency,
      storage: 'sqlite',
      state_backend: 'redis',
      operation: () => postJsonScenario(
        `${gateway.baseUrl}/v1/chat/completions`,
        chatBody('gpt-4o'),
        { apiKey: BENCH_API_KEY, timeoutMs },
      ),
    });
  } catch (error) {
    return {
      ...skippedScenario(
        'redis_cluster_chat_proxy',
        'redis_cluster_mode',
        `Redis benchmark could not start: ${sanitizeError(error instanceof Error ? error.message : error)}`,
        { storage: 'sqlite', state_backend: 'redis' },
      ),
      status: 'failed',
    };
  } finally {
    if (gateway) await gateway.close();
    sqlite.cleanup();
  }
}

async function runRealUpstreamOptional({ requests, concurrency, timeoutMs }) {
  const url = process.env.SIFTGATE_BENCH_REAL_UPSTREAM_URL;
  const apiKey = process.env.SIFTGATE_BENCH_REAL_UPSTREAM_API_KEY;
  if (!url) {
    return skippedScenario(
      'real_upstream_direct_optional',
      'real_upstream_optional',
      'Set SIFTGATE_BENCH_REAL_UPSTREAM_URL and SIFTGATE_BENCH_REAL_UPSTREAM_API_KEY to measure a live direct upstream baseline. Use npm run benchmark:upstream for live gateway runs.',
    );
  }
  if (!apiKey && !booleanEnv(process.env.SIFTGATE_BENCH_REAL_UPSTREAM_NO_AUTH)) {
    return skippedScenario(
      'real_upstream_direct_optional',
      'real_upstream_optional',
      'SIFTGATE_BENCH_REAL_UPSTREAM_URL was set, but no SIFTGATE_BENCH_REAL_UPSTREAM_API_KEY or SIFTGATE_BENCH_REAL_UPSTREAM_NO_AUTH=1 was provided.',
    );
  }

  return runConcurrent({
    name: 'real_upstream_direct_optional',
    category: 'real_upstream_optional',
    description: 'Optional live direct upstream baseline. Do not compare with local mock results.',
    requests,
    concurrency,
    operation: () => postJsonScenario(url, chatBody(process.env.SIFTGATE_BENCH_REAL_UPSTREAM_MODEL || 'gpt-4o'), {
      apiKey,
      timeoutMs,
    }),
  });
}

function buildComparisons(scenarios) {
  const byName = new Map(scenarios.map((scenario) => [scenario.name, scenario]));
  const comparisons = [];
  const addLatencyDelta = (name, baselineName, targetName, field = 'latency_ms') => {
    const baseline = byName.get(baselineName);
    const target = byName.get(targetName);
    if (baseline?.status !== 'measured' || target?.status !== 'measured') return;
    const baselineLatency = baseline[field];
    const targetLatency = target[field];
    if (!baselineLatency || !targetLatency) return;
    comparisons.push({
      name,
      baseline: baselineName,
      target: targetName,
      metric: field,
      p50_delta_ms: Math.round(targetLatency.p50 - baselineLatency.p50),
      p95_delta_ms: Math.round(targetLatency.p95 - baselineLatency.p95),
      p99_delta_ms: Math.round(targetLatency.p99 - baselineLatency.p99),
    });
  };

  addLatencyDelta('non_streaming_proxy_overhead', 'upstream_mock_baseline', 'chat_proxy_direct_sqlite');
  addLatencyDelta('smart_routing_delta', 'chat_proxy_direct_sqlite', 'chat_smart_routing_sqlite');
  addLatencyDelta('streaming_total_overhead', 'upstream_mock_streaming_baseline', 'streaming_chat_sqlite');
  addLatencyDelta('streaming_first_byte_overhead', 'upstream_mock_streaming_baseline', 'streaming_chat_sqlite', 'first_byte_ms');

  return comparisons;
}

function environmentSummary() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu_count: os.cpus().length,
    cpu_model: os.cpus()[0]?.model || 'unknown',
    total_memory_mib: Math.round(os.totalmem() / 1024 / 1024),
  };
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function buildMarkdown(report) {
  const measuredAt = report.generated_at;
  const rows = report.scenarios
    .map((scenario) => {
      const latency = scenario.latency_ms
        ? `${scenario.latency_ms.p50} / ${scenario.latency_ms.p95} / ${scenario.latency_ms.p99}`
        : 'n/a';
      const firstByte = scenario.first_byte_ms
        ? `${scenario.first_byte_ms.p50} / ${scenario.first_byte_ms.p95} / ${scenario.first_byte_ms.p99}`
        : 'n/a';
      const rps = scenario.throughput_rps === null || scenario.throughput_rps === undefined
        ? 'n/a'
        : String(scenario.throughput_rps);
      return `| ${scenario.name} | ${scenario.status} | ${scenario.requests} | ${scenario.concurrency} | ${latency} | ${firstByte} | ${rps} | ${scenario.failed} |`;
    })
    .join('\n');

  const comparisonRows = report.comparisons.length > 0
    ? report.comparisons
        .map((item) => `| ${item.name} | ${item.metric} | ${item.p50_delta_ms} | ${item.p95_delta_ms} | ${item.p99_delta_ms} |`)
        .join('\n')
    : '| n/a | n/a | n/a | n/a | n/a |';

  return [
    '# SiftGate v2.0.0-rc.2 Performance Report',
    '',
    `Generated at: ${measuredAt}`,
    `Commit: ${report.commit}`,
    `Version: ${report.version}`,
    '',
    '> These are release-candidate measurements from a local deterministic mock upstream. Re-measure before v2.0.0 GA if runtime behavior changes.',
    '',
    '## Environment',
    '',
    `- Node: ${report.environment.node}`,
    `- Platform: ${report.environment.platform}/${report.environment.arch}`,
    `- CPU: ${report.environment.cpu_count} x ${report.environment.cpu_model}`,
    `- Memory: ${report.environment.total_memory_mib} MiB`,
    '',
    '## Scenarios',
    '',
    '| Scenario | Status | Requests | Concurrency | Latency p50/p95/p99 ms | First byte p50/p95/p99 ms | RPS | Failed |',
    '| --- | --- | ---: | ---: | --- | --- | ---: | ---: |',
    rows,
    '',
    '## Comparisons',
    '',
    '| Comparison | Metric | p50 delta ms | p95 delta ms | p99 delta ms |',
    '| --- | --- | ---: | ---: | ---: |',
    comparisonRows,
    '',
    '## Limitations',
    '',
    '- Mock-upstream measurements isolate gateway overhead; they do not represent real model/provider latency.',
    '- PostgreSQL and Redis scenarios are skipped unless their benchmark environment variables are provided.',
    '- Comparative claims require identical request body, concurrency, commit, hardware, network placement, and upstream latency profile.',
    '- Prompt text, response text, raw provider headers, provider keys, media bytes, tool payloads, hidden reasoning, and resolved secrets are not stored in this report.',
    '',
  ].join('\n');
}

async function main() {
  const requests = positiveInt(process.env.SIFTGATE_BENCH_REQUESTS, DEFAULT_REQUESTS);
  const concurrency = positiveInt(process.env.SIFTGATE_BENCH_CONCURRENCY, DEFAULT_CONCURRENCY);
  const timeoutMs = positiveInt(process.env.SIFTGATE_BENCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const outputPath = process.env.SIFTGATE_BENCH_OUTPUT || '';
  const markdownOutputPath = process.env.SIFTGATE_BENCH_MARKDOWN_OUTPUT || '';
  const responseDelayMs = positiveInt(process.env.SIFTGATE_BENCH_UPSTREAM_DELAY_MS, 1);
  const streamChunkDelayMs = positiveInt(process.env.SIFTGATE_BENCH_STREAM_CHUNK_DELAY_MS, 1);

  const mockUpstream = await startMockUpstream({ responseDelayMs, streamChunkDelayMs });
  const scenarios = [];

  try {
    scenarios.push(await runConcurrent({
      name: 'upstream_mock_baseline',
      category: 'direct_mock_baseline',
      description: 'Direct non-streaming request to the local mock upstream without SiftGate.',
      requests,
      concurrency,
      operation: () => postJsonScenario(`${mockUpstream.url}/v1/chat/completions`, chatBody('gpt-4o'), {
        timeoutMs,
      }),
    }));

    scenarios.push(await runConcurrent({
      name: 'upstream_mock_streaming_baseline',
      category: 'direct_mock_streaming_baseline',
      description: 'Direct streaming request to the local mock upstream without SiftGate.',
      requests,
      concurrency,
      operation: () => streamingScenario(`${mockUpstream.url}/v1/chat/completions`, chatBody('gpt-4o', true), {
        timeoutMs,
      }),
    }));

    scenarios.push(...await runSqliteScenarios({
      mockUpstreamUrl: mockUpstream.url,
      requests,
      concurrency,
      timeoutMs,
    }));

    scenarios.push(await runPostgresScenario({
      mockUpstreamUrl: mockUpstream.url,
      requests,
      concurrency,
      timeoutMs,
      postgresUrl: process.env.SIFTGATE_BENCH_POSTGRES_URL,
    }));

    scenarios.push(await runRedisScenario({
      mockUpstreamUrl: mockUpstream.url,
      requests,
      concurrency,
      timeoutMs,
      redisUrl: process.env.SIFTGATE_BENCH_REDIS_URL,
    }));

    scenarios.push(await runRealUpstreamOptional({
      requests,
      concurrency,
      timeoutMs,
    }));
  } finally {
    await mockUpstream.close();
  }

  const report = {
    report_schema: 'siftgate.platform_benchmark.v1',
    release: 'v2.0.0-rc.2',
    rc_measurement: true,
    generated_at: new Date().toISOString(),
    version: packageJson.version,
    commit: gitCommit(),
    environment: environmentSummary(),
    target: {
      upstream: 'local_mock',
      requests,
      concurrency,
      timeout_ms: timeoutMs,
      mock_upstream_delay_ms: responseDelayMs,
      mock_stream_chunk_delay_ms: streamChunkDelayMs,
    },
    scenarios,
    comparisons: buildComparisons(scenarios),
    methodology: {
      script: 'npm run benchmark:platform',
      deterministic_mode: true,
      provider_dependency: 'none',
      notes: [
        'The harness starts a local mock upstream and real SiftGate AppModule instances.',
        'SQLite scenarios use a temporary on-disk database to match local/dev behavior.',
        'PostgreSQL and Redis scenarios are optional and are skipped unless their URLs are provided.',
        'Live provider or existing-gateway tests should use npm run benchmark:upstream with explicit environment variables.',
        'v2.0.0-rc.2 numbers are release-candidate measurements and must be re-measured before GA if runtime behavior changes.',
      ],
    },
    privacy: {
      prompt_response_stored: false,
      raw_headers_stored: false,
      provider_keys_exposed: false,
      media_bytes_stored: false,
      tool_payloads_stored: false,
      hidden_reasoning_stored: false,
      resolved_secrets_stored: false,
      metadata_only: true,
    },
  };

  const jsonText = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, jsonText, 'utf8');
  }
  if (markdownOutputPath) {
    fs.mkdirSync(path.dirname(markdownOutputPath), { recursive: true });
    fs.writeFileSync(markdownOutputPath, buildMarkdown(report), 'utf8');
  }

  console.log(jsonText.trimEnd());

  const failed = scenarios.some((scenario) => scenario.status === 'failed');
  process.exitCode = failed ? 2 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
