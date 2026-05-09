# Caching

SiftGate has two local caching layers with different safety models.

v1.6 also deepens **provider-side cache accounting**. This is separate from the local prompt cache and semantic cache: when an upstream provider returns cache-read or cache-write token counters, SiftGate records them for routing, logs, Dashboard analytics, and cost attribution without treating the request as a local cache hit.

## Prompt Cache

`cache` stores deterministic prompt responses keyed by canonical request semantics. It is disabled by default.

```yaml
cache:
  enabled: true
  ttl_seconds: 300
  max_entries: 1000
  exclude_tool_use: true
```

Stream replay is separately opt-in:

```yaml
cache:
  stream_cache:
    enabled: false
```

## Semantic Cache v2

`semantic_cache` is disabled by default. v2.7 keeps the local memory
hashed-vector backend as the production-safe default and adds workspace-aware
isolation, TTL invalidation, preview Redis/vector backend validation, and an
explicit response-storage opt-in gate.

```yaml
semantic_cache:
  enabled: false
  backend: memory
  similarity_threshold: 0.92
  ttl_seconds: 3600
  max_entries: 500
  store_responses: false
  isolation: workspace_api_key_model
  response_storage_requires_header: true
```

Privacy defaults:

- Stores embedding/hash/metadata only.
- Does not store prompts.
- Does not store responses unless `store_responses: true`.
- Isolates matches by workspace, requested model, Gateway API key, namespace,
  and team metadata by default.
- Requires `x-siftgate-semantic-store-response: true` per request before a
  replayable response is stored when response storage is enabled.

When `store_responses: false`, a semantic match is evidence only and the gateway still calls upstream. When `store_responses: true`, a high-confidence semantic hit can return a replayable cached response.

Operators can clear active-workspace semantic entries from the Dashboard
Semantic Platform page or `POST /api/dashboard/semantic-platform/semantic-cache/invalidate`.
See [Semantic Platform](SEMANTIC_PLATFORM.md) for v2.7 Prompt Registry,
context, intent, and Guardrails v2 evidence.

## Route Explanation

Route Decision Trace can show:

- local prompt-cache hit or miss
- provider cache capability and read/write price evidence
- semantic cache match/hit, score, threshold, and metadata-only state

## Provider Cache Accounting

When an upstream provider returns cache token usage, SiftGate records:

- `cache_read_input_tokens`
- `cache_creation_input_tokens`
- `cost_usd`
- `cost_without_cache_usd`

This lets the OSS Dashboard show the real savings from provider cache discounts:

- Overview: one-window cache savings KPI
- Analytics: savings trend, hit-rate trend, provider/model rankings, and cost mix
- Logs: provider cache badge plus per-request saved-cost tooltip/detail
- Budget: actual spend vs no-cache baseline

Local prompt-cache and semantic-cache hits remain separate. Provider-cache savings intentionally exclude rows whose `node_id` is the local `cache` or `semantic_cache` path so the numbers reflect upstream-provider discounts only.

## Related Docs

- [Architecture](ARCHITECTURE.md)
- [Performance](PERFORMANCE.md)
- [Security](SECURITY.md)
