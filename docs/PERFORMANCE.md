# Performance

This page captures the first upstream-forwarding benchmark workflow for the
open-source SiftGate Data Plane. It is intended as a repeatable baseline for
future connection-pool and routing changes.

## Upstream Connection Pools

SiftGate uses the default Node.js `fetch` path unless a node has an explicit
`connection` block. When configured, the provider client attaches an undici
per-node dispatcher so streaming, non-streaming, and embedding requests reuse
the same upstream pool:

```yaml
nodes:
  - id: openai-prod
    connection:
      enabled: true
      keep_alive: true
      pool_size: 20
      keep_alive_ms: 60000
      headers_timeout_ms: 30000
      body_timeout_ms: 300000
      http2: false
```

`http2: true` is experimental and should be tested against each upstream before
production use. Leave it disabled for default HTTP/1.1 pooling.

## Benchmark Script

Run the benchmark against a local SiftGate instance and a mock or low-cost
upstream:

```bash
GATEWAY_BENCH_API_KEY=gw_sk_live_... \
GATEWAY_BENCH_REQUESTS=200 \
GATEWAY_BENCH_CONCURRENCY=25 \
GATEWAY_BENCH_MODEL=auto \
npm run benchmark:upstream
```

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GATEWAY_BENCH_URL` | `http://127.0.0.1:2099/v1/chat/completions` | Gateway endpoint to hit |
| `GATEWAY_BENCH_API_KEY` | unset | Gateway API key for authenticated endpoints |
| `GATEWAY_BENCH_NO_AUTH` | unset | Set to `1` for unauthenticated mock endpoints |
| `GATEWAY_BENCH_REQUESTS` | `100` | Total requests |
| `GATEWAY_BENCH_CONCURRENCY` | `10` | Concurrent workers |
| `GATEWAY_BENCH_STREAM` | unset | Set to `1` to read the full SSE stream |
| `GATEWAY_BENCH_TIMEOUT_MS` | `120000` | Per-request benchmark timeout |
| `GATEWAY_BENCH_BODY` | small chat request | Full JSON request body override |
| `GATEWAY_BENCH_OUTPUT` | unset | Optional path such as `report.json` for writing the JSON summary |
| `GATEWAY_BENCH_LABEL` | unset | Optional label included in the JSON summary |

The script prints JSON with success counts, status codes, RPS, p50/p75/p95/p99
latency, top sanitized errors, and methodology notes. If `GATEWAY_BENCH_OUTPUT`
is set, the same JSON is written to that path:

```bash
GATEWAY_BENCH_API_KEY=gw_sk_live_... \
GATEWAY_BENCH_OUTPUT=reports/local-run.json \
npm run benchmark:upstream
```

Keep benchmark notes with the gateway commit, node config, machine, provider or
mock upstream, and request body so future runs can be compared.

## Dashboard Benchmark Report

v0.9 adds a read-only Dashboard report backed by call-log metadata:

```bash
curl 'http://localhost:2099/api/dashboard/benchmarks/report?period=24h&source_format=chat_completions'
```

The report includes request totals, success/error/fallback/cache rates,
p50/p75/p95/p99 latency, throughput estimates, cost and token summaries,
status-code distribution, node:model breakdowns, source-format breakdowns, and
route-trace coverage. Filters include `period`, `namespace`, `api_key_id`
or legacy `api_key`, `node`, `model`, and `source_format`.

This report is local operational evidence, not a strict cloud benchmark.
Compare systems only when request body, concurrency, commit, machine, network
placement, upstream latency profile, and config are identical. It never stores
or returns prompts, responses, raw headers, provider keys, media bytes, or video
bytes.

## v0.5 Known Limits

- `connection.http2` is experimental and should stay disabled until each
  upstream has been tested with streaming and non-streaming traffic.
- Stream cache is disabled by default and only stores completed deterministic
  streams; interrupted or partial streams are intentionally not cached.
- Embedding batching is disabled by default and only groups requests with the
  same routing-relevant node, model, dimensions, encoding format, user, input
  kind, and tenant context.
- Redis-backed cluster inventory uses `KEYS` inside the configured cluster
  prefix. Keep the prefix narrow and the instance count modest until this is
  replaced with a cursor-based scan.
- Shadow traffic is asynchronous and does not participate in primary latency,
  budgets, or routing decisions. Treat shadow results as migration evidence,
  not as a live correctness gate.
