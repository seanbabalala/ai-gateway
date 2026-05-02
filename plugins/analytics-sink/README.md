# analytics-sink

Official SiftGate runtime plugin that exports sanitized call-log analytics to an HTTP endpoint.

## Example

```yaml
plugins:
  - path: plugins/analytics-sink
    required: false
    config:
      enabled: true
      endpoint: https://analytics.example.com/siftgate/events
      batch_size: 50
      flush_interval_ms: 5000
```

## Safety

- Disabled by default.
- Delivery is queued and asynchronous; log events are not blocked on webhook latency.
- The default payload uses a safe allow-list of call-log metadata only.
- Prompts, responses, provider keys, raw headers, auth headers, passwords, secrets, and tokens are removed unless `include_prompt_response: true` is explicitly configured.
