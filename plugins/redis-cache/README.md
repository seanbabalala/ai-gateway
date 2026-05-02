# redis-cache

Official SiftGate runtime plugin that adds an optional Redis-backed response cache.

## Example

```yaml
plugins:
  - path: plugins/redis-cache
    required: false
    config:
      enabled: true
      url: ${REDIS_URL}
      store_responses: true
      ttl_seconds: 300
      key_prefix: siftgate:cache:
```

`store_responses` must be explicitly set to `true`; otherwise the plugin stays inactive.

## Safety

- Disabled by default.
- Cache keys are SHA-256 hashes of canonical request semantics; raw prompts are not sent as Redis keys.
- Response bodies are only sent to Redis when the operator explicitly enables `store_responses: true`.
- Provider keys, raw headers, and authorization headers are never written by this plugin.
