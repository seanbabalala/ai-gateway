# Performance

This page captures repeatable benchmark workflows for the open-source SiftGate
Data Plane. Use them to separate local gateway overhead from upstream/provider
latency and to publish evidence with enough context for operators to rerun it.

## v2.0.0 Platform Benchmark

v2.0.0 ships a deterministic platform benchmark harness for the Platform Trust
GA. It starts a local mock upstream plus real SiftGate AppModule instances,
seeds a temporary Gateway API key, and measures the public HTTP path without
contacting external model providers:

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

The GA sample reports are committed at:

- [`docs/reports/v2.0.0-performance.json`](reports/v2.0.0-performance.json)
- [`docs/reports/v2.0.0-performance.md`](reports/v2.0.0-performance.md)

The rc.2 release-candidate reports remain available for comparison at:

- [`docs/reports/v2.0.0-rc.2-performance.json`](reports/v2.0.0-rc.2-performance.json)
- [`docs/reports/v2.0.0-rc.2-performance.md`](reports/v2.0.0-rc.2-performance.md)

## Committed Evidence Snapshot

The v2.0.0 GA report is the current committed baseline for local deterministic
mock-upstream overhead. It was generated on 2026-05-08 at commit
`2328dd76ba1a26e7de5b9d2b88610921aec69883` on macOS arm64, Node v24.12.0, and
Apple M4 hardware.

| Measurement | v2.0.0 GA result |
| --- | --- |
| Local mock upstream baseline | 19 ms p50 / 19 ms p95 / 19 ms p99 |
| Direct chat proxy through SiftGate + SQLite | 27 ms p50 / 27 ms p95 / 27 ms p99 |
| Non-streaming proxy overhead | +8 ms p50 / +8 ms p95 / +8 ms p99 |
| Smart routing through SiftGate + SQLite | 15 ms p50 / 15 ms p95 / 15 ms p99 |
| Streaming mock upstream baseline | 7 ms p50 / 7 ms p95 / 7 ms p99; 1 ms first-byte p50/p95/p99 |
| Streaming chat through SiftGate + SQLite | 17 ms p50 / 17 ms p95 / 17 ms p99; 4 ms first-byte p50/p95/p99 |
| Streaming overhead | +10 ms total p50/p95/p99; +3 ms first-byte p50/p95/p99 |
| Metadata-only Dashboard log write | 1 ms p50 / 1 ms p95 / 1 ms p99 |
| Dashboard benchmark read from sanitized logs | 5 ms p50 / 5 ms p95 / 5 ms p99 |

The v2.0.0-rc.2 report is useful as a release-candidate comparison because it
ran 5 requests at concurrency 2. In that run, non-streaming proxy overhead was
+13 ms p50 / +17 ms p95 / +17 ms p99, streaming total overhead was +7 ms p50 /
+15 ms p95 / +15 ms p99, and streaming first-byte overhead was +3 ms
p50/p95/p99.

The homepage chart at
[`docs/assets/performance/benchmark-evidence.svg`](assets/performance/benchmark-evidence.svg)
summarizes the same numbers and states the boundary explicitly: these results
measure local gateway overhead, not live-provider latency, model quality, or
competitor performance.

## Smart Routing Prompt Corpus

The smart-routing benchmark prompt corpus is summarized in
[`docs/reports/smart-routing-prompt-corpus.md`](reports/smart-routing-prompt-corpus.md)
so routing evidence can be discussed alongside latency evidence without
requiring raw prompt text in public documentation.

| Field | Value |
| --- | --- |
| Public summary | [`docs/reports/smart-routing-prompt-corpus.md`](reports/smart-routing-prompt-corpus.md) |
| Total prompts | 500 |
| Random seed | 42 |
| Tier distribution | 75 simple, 150 standard, 175 complex, 100 reasoning |
| Source counts | WildBench v2 157, IFEval 140, MT-Bench 95, GSM8K 53, HumanEval 55 |

The metadata cites source datasets and licenses: WildBench v2 from the Allen
Institute for AI under CC-BY-4.0; IFEval from Google Research under
Apache-2.0; GSM8K and HumanEval from OpenAI under MIT; and MT-Bench from
LMSYS / UC Berkeley under Apache-2.0. Arena-Hard-Auto v2 is listed as a
candidate cited dataset, but the source count for Arena-Hard is `0` in this
corpus summary.

These numbers are local deterministic mock-upstream measurements. They are
useful for tracking SiftGate overhead on the measured commit and machine; do
not publish comparative claims unless request body, concurrency, commit,
hardware, network placement, upstream latency profile, and config are
identical.

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

## Publishable Benchmark Checklist

When publishing a performance result in docs, release notes, or comparison
materials, include enough context for another operator to rerun the test:

- SiftGate commit SHA, version, and whether the tree had local changes.
- Benchmark command, environment variables, request body, model, endpoint, and
  stream/non-stream mode.
- Request count, concurrency, timeout, warmup behavior, and retry settings.
- Machine, CPU, memory, OS, Node.js version, database backend, Redis state, and
  whether SiftGate and the upstream were on the same host.
- Upstream type: local mock, private compatible endpoint, or live provider. Do
  not publish live-provider comparisons without documenting network placement
  and upstream latency profile.
- p50, p75, p95, p99, throughput, status counts, sanitized top errors,
  first-byte timing for streams, and fallback/cache rates when relevant.
- Config features that affect latency, including Dashboard log writes,
  semantic cache, provider prompt-cache routing, credential pools, retries,
  shadow traffic, OpenTelemetry, and log sinks.

For competitor or before/after claims, keep the same request body, concurrency,
hardware, database, network placement, upstream/mock, and runtime config. If
any of those differ, publish the result as an operator-local measurement rather
than a comparative benchmark.

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
