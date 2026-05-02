# Stream Cache and Embedding Batching

SiftGate v0.5 adds two local data-plane optimizations for high-throughput deployments. Both are disabled by default and do not require SiftGate Cloud.

## Stream Cache

Stream cache extends the existing prompt cache to streaming requests. Enable it explicitly:

```yaml
cache:
  enabled: true
  ttl_seconds: 300
  max_entries: 1000
  exclude_tool_use: true
  stream_cache:
    enabled: true
```

Behavior:

- The first cacheable stream is forwarded to the upstream provider as usual.
- SiftGate buffers text deltas while streaming them to the client.
- Only a successfully completed stream is stored.
- A cache hit is replayed as SSE in the caller's original protocol.
- Canceled, timed-out, interrupted, or partial streams are not cached.

Cache safety:

- Stream cache uses the same deterministic checks as prompt cache, including `temperature: 0` and `exclude_tool_use`.
- Keys include the canonical request, source protocol, routing-relevant headers, Gateway API key id/name, and session key when present.
- Cached responses stay local to the gateway process and count against the existing prompt cache TTL and LRU limits.

Risks and fit:

- Use stream cache for deterministic, repeatable requests such as generated docs, fixed prompts, or synthetic test traffic.
- Avoid it for personalized, time-sensitive, tool-heavy, or high-entropy requests.
- Replayed SSE is synthetic. It preserves the streaming interface but does not represent a live upstream connection.
- Stored responses may contain model output, so keep TTLs short and disable response caching where local memory retention is not acceptable.

## Embedding Batching

Embedding batching coalesces small `/v1/embeddings` requests that target the same upstream node and model:

```yaml
embedding_batching:
  enabled: true
  window_ms: 10
  max_batch_size: 64
  max_input_items: 8
  max_queue: 1000
  timeout_ms: 10000
```

Behavior:

- Requests wait locally for up to `window_ms`.
- Only small requests with at most `max_input_items` input items are batched.
- A merged upstream response is split back into per-request OpenAI-compatible embedding responses.
- Queue overflow bypasses batching and forwards the request directly.
- Per-request timeout or client cancellation removes that request from the queued batch.
- If the upstream returns a partial batch, only callers whose response slice is missing receive an error.

Batch isolation:

- Batches are grouped by node, model, dimensions, encoding format, `user`, input kind, and Gateway API key identity.
- Text inputs are not mixed with token-array inputs.
- Direct routing and API key permission checks run before batching, so batching cannot bypass routing policy.

Risks and fit:

- Batching is best for many tiny embedding requests, for example indexing pipelines that send one or two short strings at a time.
- It adds local queue latency up to `window_ms`, so keep the window small for interactive workloads.
- Provider batch-size limits still apply. Set `max_batch_size` below the smallest upstream limit in that route.
- Large requests bypass batching to avoid head-of-line blocking and oversized upstream payloads.

## Validation

`npm run validate:config -- --config gateway.config.yaml` checks the shape and positive numeric values for both `cache.stream_cache` and `embedding_batching`. Errors are CI-failing; warnings and info remain non-blocking.
