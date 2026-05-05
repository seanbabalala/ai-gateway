# Batch API Proxy

SiftGate supports an OpenAI-compatible Batch API proxy for async provider batch jobs.

## Endpoints

- `POST /v1/batches`
- `GET /v1/batches/:id`
- `POST /v1/batches/:id/cancel`
- `GET /v1/batches/:id/output`
- `GET /v1/batches/:id/errors`

## Storage Boundary

The local Data Plane stores batch metadata only:

- request id
- provider batch id
- node/model hint
- endpoint
- file ids
- request counts
- status
- API key and namespace attribution
- sanitized error summary

It does not store input JSONL, output JSONL, provider raw headers, provider keys, or file bytes.

## Configuration

Provider nodes can define batch endpoints such as `batch_endpoint`, `batch_status_endpoint`, `batch_cancel_endpoint`, and `batch_result_endpoint`. Config validation warns when batch-capable routes lack endpoints or pricing metadata.

## Dashboard

The Dashboard Batch Jobs view is read-only and shows status, request counts, file ids, namespace/API key scope, and sanitized failures.
