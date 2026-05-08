# Performance

This page captures repeatable benchmark workflows for the open-source SiftGate
Data Plane. Use them to separate local gateway overhead from upstream/provider
latency and to publish evidence with enough context for operators to rerun it.

## v2.0.0-rc.2 Platform Benchmark

v2.0.0-rc.2 adds a deterministic platform benchmark harness for the Platform
Trust release candidate. It starts a local mock upstream plus real SiftGate
AppModule instances, seeds a temporary Gateway API key, and measures the public
HTTP path without contacting external model providers:

```bash
SIFTGATE_BENCH_REQUESTS=50 \
SIFTGATE_BENCH_CONCURRENCY=4 \
SIFTGATE_BENCH_OUTPUT=reports/platform.json \
SIFTGATE_BENCH_MARKDOWN_OUTPUT=reports/platform.md \
npm run benchmark:platform
```

The lightweight CI-safe mode is the same command with a very small request
count:

```bash
SIFTGATE_BENCH_REQUESTS=1 \
SIFTGATE_BENCH_CONCURRENCY=1 \
npm run benchmark:platform
```

The harness measures:

| Scenario | What It Measures |
| --- | --- |
| `upstream_mock_baseline` | Direct non-streaming call to the local mock upstream |
| `upstream_mock_streaming_baseline` | Direct streaming call to the local mock upstream, including first-byte timing |
| `chat_proxy_direct_sqlite` | `/v1/chat/completions` with a direct model through SiftGate and SQLite |
| `chat_smart_routing_sqlite` | `/v1/chat/completions` with `model=auto` smart routing through SiftGate and SQLite |
| `streaming_chat_sqlite` | Streaming chat through SiftGate, including first-byte and total stream timing |
| `dashboard_log_write_sqlite` | Metadata-only `call_logs` insert overhead |
| `dashboard_log_read_sqlite` | Dashboard benchmark report read from sanitized call-log metadata |
| `postgres_production_chat_proxy` | Optional PostgreSQL metadata path when `SIFTGATE_BENCH_POSTGRES_URL` is set |
| `redis_cluster_chat_proxy` | Optional Redis shared-state/cluster path when `SIFTGATE_BENCH_REDIS_URL` is set |
| `real_upstream_direct_optional` | Optional live direct-upstream baseline for private operator runs |

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SIFTGATE_BENCH_REQUESTS` | `20` | Total requests per deterministic scenario |
| `SIFTGATE_BENCH_CONCURRENCY` | `4` | Concurrent workers |
| `SIFTGATE_BENCH_TIMEOUT_MS` | `120000` | Per-request timeout |
| `SIFTGATE_BENCH_UPSTREAM_DELAY_MS` | `1` | Mock non-streaming upstream response delay |
| `SIFTGATE_BENCH_STREAM_CHUNK_DELAY_MS` | `1` | Mock streaming chunk delay |
| `SIFTGATE_BENCH_OUTPUT` | unset | Optional JSON report path |
| `SIFTGATE_BENCH_MARKDOWN_OUTPUT` | unset | Optional Markdown report path |
| `SIFTGATE_BENCH_POSTGRES_URL` | unset | Optional PostgreSQL benchmark database URL |
| `SIFTGATE_BENCH_POSTGRES_SYNCHRONIZE` | `true` | Whether the optional PostgreSQL benchmark may create/update its temporary schema |
| `SIFTGATE_BENCH_REDIS_URL` | unset | Optional Redis URL for shared-state and cluster-mode measurement |
| `SIFTGATE_BENCH_REAL_UPSTREAM_URL` | unset | Optional live direct upstream URL |
| `SIFTGATE_BENCH_REAL_UPSTREAM_API_KEY` | unset | Optional live direct upstream API key |
| `SIFTGATE_BENCH_REAL_UPSTREAM_NO_AUTH` | unset | Set to `1` for unauthenticated live mock endpoints |

The report includes p50/p95/p99 latency, throughput, status counts, sanitized
top errors, comparison deltas, environment metadata, commit SHA, methodology,
and explicit privacy flags. PostgreSQL, Redis, and live upstream scenarios are
reported as `skipped` unless the required environment is present; SiftGate does
not invent numbers for unavailable dependencies.

The rc.2 sample reports are committed at:

- [`docs/reports/v2.0.0-rc.2-performance.json`](reports/v2.0.0-rc.2-performance.json)
- [`docs/reports/v2.0.0-rc.2-performance.md`](reports/v2.0.0-rc.2-performance.md)

These numbers are release-candidate measurements from a local deterministic
mock upstream. If any runtime behavior changes after rc.2, rerun the harness
and update all public benchmark numbers before tagging v2.0.0 GA.

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

## Existing Gateway / Upstream Benchmark

Use `benchmark:upstream` when you already have a SiftGate instance running or
when you need an optional real-upstream run. Keep the upstream local or low-cost
unless you are intentionally measuring real provider/network latency:

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
mock upstream, and request body so future runs can be compared. Do not publish
comparative claims unless request body, concurrency, commit, hardware, network
placement, upstream latency profile, and config are identical.

## Dashboard Benchmark Report

v0.9 adds a read-only Dashboard report backed by call-log metadata:

```bash
curl 'http://localhost:2099/api/dashboard/benchmarks/report?period=24h&source_format=chat_completions'
```

The report includes request totals, success/error/fallback/cache rates,
p50/p75/p95/p99 latency, throughput estimates, cost and token summaries,
status-code distribution, node:model breakdowns, source-format breakdowns, and
route-trace coverage. v1.2 adds cache-aware impact fields under
`summary.cache_summary`, including local prompt-cache hits, provider cache-read
hits, provider cache-write events, cache-aware request rate, and cache-read
token ratio. Filters include `period`, `namespace`, `api_key_id` or legacy
`api_key`, `node`, `model`, and `source_format`.

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
- Prompt-cache-aware routing does not change the local cache lookup path. Local
  prompt-cache hits still bypass upstream; only cache misses continue into
  cost/balanced routing where provider cache capability, observed provider
  cache-read hit rate, and cache-read pricing can affect candidate ranking.
- Embedding batching is disabled by default and only groups requests with the
  same routing-relevant node, model, dimensions, encoding format, user, input
  kind, and tenant context.
- Redis-backed cluster inventory uses `KEYS` inside the configured cluster
  prefix. Keep the prefix narrow and the instance count modest until this is
  replaced with a cursor-based scan.
- Shadow traffic is asynchronous and does not participate in primary latency,
  budgets, or routing decisions. Treat shadow results as migration evidence,
  not as a live correctness gate.
