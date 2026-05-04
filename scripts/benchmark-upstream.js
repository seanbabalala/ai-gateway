#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname } = require('node:path');
const { performance } = require('node:perf_hooks');

const url = process.env.GATEWAY_BENCH_URL || 'http://127.0.0.1:2099/v1/chat/completions';
const apiKey = process.env.GATEWAY_BENCH_API_KEY || '';
const totalRequests = positiveInt(process.env.GATEWAY_BENCH_REQUESTS, 100);
const concurrency = positiveInt(process.env.GATEWAY_BENCH_CONCURRENCY, 10);
const model = process.env.GATEWAY_BENCH_MODEL || 'auto';
const timeoutMs = positiveInt(process.env.GATEWAY_BENCH_TIMEOUT_MS, 120000);
const outputPath = process.env.GATEWAY_BENCH_OUTPUT || '';
const label = process.env.GATEWAY_BENCH_LABEL || '';
const body = process.env.GATEWAY_BENCH_BODY
  ? JSON.parse(process.env.GATEWAY_BENCH_BODY)
  : {
      model,
      stream: process.env.GATEWAY_BENCH_STREAM === '1',
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      max_tokens: 8,
    };

if (!apiKey && !process.env.GATEWAY_BENCH_NO_AUTH) {
  console.error('Set GATEWAY_BENCH_API_KEY or GATEWAY_BENCH_NO_AUTH=1.');
  process.exit(1);
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

function sanitizeError(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/gw_sk_[A-Za-z0-9._~+/=-]+/gi, 'gw_sk_[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
    .replace(/(api[_-]?key=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 180);
}

async function oneRequest(index) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (body.stream && response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } else {
      await response.text();
    }
    return {
      index,
      ok: response.ok,
      status: response.status,
      latencyMs: performance.now() - start,
    };
  } catch (error) {
    return {
      index,
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'unknown error',
      latencyMs: performance.now() - start,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const startedAt = new Date();
  const started = performance.now();
  const results = [];
  let next = 0;

  async function worker() {
    while (next < totalRequests) {
      const current = next;
      next += 1;
      results.push(await oneRequest(current));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, totalRequests) }, worker));

  const durationSeconds = (performance.now() - started) / 1000;
  const latencies = results.map((result) => result.latencyMs);
  const statusCounts = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});
  const success = results.filter((result) => result.ok).length;
  const summary = {
    label: label || undefined,
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    duration_seconds: Number(durationSeconds.toFixed(3)),
    target: {
      url,
      model,
      stream: Boolean(body.stream),
      requests: totalRequests,
      concurrency,
      timeout_ms: timeoutMs,
    },
    success,
    failed: totalRequests - success,
    success_rate: Number(((success / totalRequests) * 100).toFixed(1)),
    rps: Number((totalRequests / durationSeconds).toFixed(2)),
    latency_ms: {
      avg: Math.round(average(latencies)),
      p50: Math.round(percentile(latencies, 50)),
      p75: Math.round(percentile(latencies, 75)),
      p95: Math.round(percentile(latencies, 95)),
      p99: Math.round(percentile(latencies, 99)),
      max: Math.round(Math.max(...latencies)),
    },
    status: statusCounts,
    top_errors: topErrors(results),
    methodology: {
      script: 'npm run benchmark:upstream',
      notes: [
        'Run the same request count, concurrency, request body, machine, and upstream latency profile for fair comparisons.',
        'Use a mock or low-cost upstream before publishing benchmark claims.',
      ],
    },
  };

  const json = JSON.stringify(summary, null, 2);
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${json}\n`, 'utf8');
  }
  console.log(json);
  process.exitCode = success === totalRequests ? 0 : 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
