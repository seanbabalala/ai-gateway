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

## Semantic Cache Preview

`semantic_cache` is disabled by default. The v1.3 preview uses a local memory hashed-vector embedding to find similar requests.

```yaml
semantic_cache:
  enabled: false
  backend: memory
  similarity_threshold: 0.92
  ttl_seconds: 3600
  max_entries: 500
  store_responses: false
```

Privacy defaults:

- Stores embedding/hash/metadata only.
- Does not store prompts.
- Does not store responses unless `store_responses: true`.
- Isolates matches by source format, requested model, API key, namespace, and team metadata.

When `store_responses: false`, a semantic match is evidence only and the gateway still calls upstream. When `store_responses: true`, a high-confidence semantic hit can return a replayable cached response.

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
