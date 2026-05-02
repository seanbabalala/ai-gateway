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

The script prints JSON with success counts, status codes, RPS, and p50/p95/p99
latency. Keep benchmark notes with the gateway commit, node config, machine,
provider or mock upstream, and request body so future runs can be compared.
