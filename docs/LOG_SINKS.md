# External Log Sinks

SiftGate can export sanitized `call_logs` metadata to local files or external systems from the open-source Data Plane. This is disabled by default and does not require SiftGate Cloud.

The local SQLite/Postgres `call_logs` table remains authoritative. External sinks run asynchronously after the database write succeeds, so a slow or failing sink does not block the AI request path.

## Configuration

```yaml
logging:
  enabled: true
  sinks:
    - type: file
      name: local-jsonl
      path: ./data/calls.jsonl
      batch_size: 100
      flush_interval_ms: 5000
      max_queue: 10000
      overflow: drop_oldest # drop_oldest | drop_newest

    - type: webhook
      name: ops-pipeline
      url: "${LOG_SINK_WEBHOOK_URL}"
      headers:
        Authorization: "Bearer ${LOG_SINK_WEBHOOK_TOKEN}"
      fields:
        - request_id
        - timestamp
        - node_id
        - model
        - status_code
        - latency_ms
        - cost_usd
      retry:
        attempts: 3
        backoff_ms: 1000
        timeout_ms: 5000
```

## Sink Types

| Type | Status | Behavior |
| ---- | ------ | -------- |
| `file` | supported | Appends one JSON object per line to `path`; parent directories are created automatically. |
| `webhook` | supported | Sends `POST` batches with `{ version: "siftgate.call_log_batch.v1", events: [...] }`. |
| `elasticsearch` | minimal | Sends newline-delimited `_bulk` index requests to `<url>/_bulk`. |
| `s3` | interface | Config shape is reserved for a future exporter; keep disabled for now. |

## Batching And Backpressure

Each sink has its own in-memory queue.

- `batch_size`: records per delivery attempt. Default: `100`.
- `flush_interval_ms`: maximum wait before flushing a partial batch. Default: `5000`.
- `max_queue`: maximum queued records per sink. Default: `10000`.
- `overflow`: `drop_oldest` or `drop_newest`. Default: `drop_oldest`.
- `retry.attempts`: total attempts including the first attempt. Default: `3`.
- `retry.backoff_ms`: delay between attempts. Default: `1000`.
- `retry.timeout_ms`: webhook/Elasticsearch HTTP timeout. Default: `5000`.

When all retry attempts fail, the batch is dropped for that external sink only. Local `call_logs` rows are already stored.

## Privacy

Exports are built from `CallLog` metadata, not from raw request/response bodies. The sanitizer ignores secret-bearing fields including:

- prompt, response, messages, content
- provider API keys and generic API key fields
- raw headers, authorization headers, bearer tokens
- password, secret, token

Use `fields` to allow only specific output fields, or `exclude_fields` to remove additional fields from the default safe record.

Supported safe fields include `request_id`, `timestamp`, `source_format`, `tier`, `score`, `node_id`, `model`, token counts, `cost_usd`, `latency_ms`, `status_code`, fallback status, Gateway API key id/name, retry count, cache token fields, and experiment group.
