# Webhook Alerts

SiftGate v0.3 adds local webhook alerting to the MIT data plane. It does not require SiftGate Cloud and does not send prompts, responses, provider API keys, or raw headers.

## Events

Supported events:

- `budget_threshold`
- `budget_exceeded`
- `node_down`
- `node_recovered`
- `circuit_open`
- `circuit_close`
- `error_spike`
- `latency_spike`

Budget events come from `BudgetService`. Node events come from active health probes. Circuit events come from the local circuit breaker state machine. Spike events are detected from the in-memory call-log stream using local sliding windows.

## Configuration

```yaml
alerts:
  enabled: true
  history_size: 50
  channels:
    - type: webhook
      name: ops
      url: "${ALERT_WEBHOOK_URL}"
      headers:
        Authorization: "Bearer ${ALERT_WEBHOOK_TOKEN}"
      events: [budget_threshold, budget_exceeded, node_down, node_recovered, circuit_open, circuit_close, error_spike, latency_spike]
      debounce_seconds: 300
      retry:
        attempts: 3
        backoff_ms: 1000
        timeout_ms: 5000
  error_spike:
    enabled: true
    window_seconds: 300
    min_requests: 20
    error_rate: 0.1
  latency_spike:
    enabled: true
    window_seconds: 300
    min_requests: 20
    p95_ms: 10000
```

`channels[].events` is optional. If omitted, the webhook receives every supported alert event. `debounce_seconds` suppresses duplicate sends for the same channel, event, and resource key.

## Payload

Webhook payloads are JSON:

```json
{
  "version": "siftgate.alert.v1",
  "event": "circuit_open",
  "severity": "critical",
  "timestamp": "2026-05-02T00:00:00.000Z",
  "message": "Circuit opened for openai:gpt-4o: 3 consecutive failures.",
  "dedupe_key": "openai:gpt-4o",
  "details": {
    "node_id": "openai",
    "model": "gpt-4o",
    "state": "OPEN",
    "reason": "3 consecutive failures"
  }
}
```

The payload sanitizer removes sensitive fields such as `prompt`, `response`, `messages`, `content`, `raw_headers`, `headers`, `api_key`, `provider_api_key`, `authorization`, `password`, `secret`, and `token`.

## Delivery Semantics

Alert delivery is asynchronous. The request path records the event and returns immediately; webhook POSTs run from an in-memory queue. Each webhook has retry controls and per-attempt timeout. Failures are recorded for Dashboard visibility but do not fail the original AI request.

The Dashboard endpoint `GET /api/dashboard/alerts` returns configured webhook channel names, recent delivery status, attempts, timestamps, and failure reasons. It does not expose webhook URLs or configured headers.
