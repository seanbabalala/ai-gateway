# Provider Catalog And Compatibility

SiftGate's open-source Data Plane keeps provider configuration local. Provider/model catalog data can help operators pick likely endpoints and models, but the compatibility matrix answers the production question: does this saved node actually support the capability with its current endpoint, auth, headers, and model list?

## Compatibility Matrix

Dashboard Nodes shows a read-only matrix per node:

- `capability`: `chat`, `responses`, `messages`, `embeddings`, `rerank`, `images`, `audio`, `video`, or `realtime`
- `configured`: whether the node has the required model bucket and endpoint metadata
- `tested`: whether the Dashboard has run a safe check
- `last_status`: `pass`, `warning`, `fail`, or `skipped`
- `last_checked_at`, `latency_ms`, `status_code`, and a sanitized `failure_reason`

The matrix is stored in local SQLite/PostgreSQL metadata. It does not store prompts, responses, raw headers, provider API keys, media files, audio frames, or video bytes.

## Safe Test Policy

`POST /api/dashboard/nodes/:id/test` can test one or more capabilities:

```json
{
  "capabilities": ["chat", "embeddings", "images", "video", "realtime"],
  "confirm_expensive": false
}
```

Text-like checks use tiny synthetic requests:

- Chat/Responses/Messages: one-token `ping` style request
- Embeddings: one small synthetic input
- Rerank: one query and one synthetic document

Media and long-lived checks are conservative:

- Images/audio default to endpoint/auth probes
- Video/realtime default to endpoint/auth/capability probes
- Real generation or long-lived realtime sessions are not started by default

This makes the matrix suitable for CI-style smoke checks and local operator validation without accidentally spending meaningful provider budget.

## Config Validation

Config validation still validates static YAML first: endpoints, model buckets, routing references, and pricing warnings. Dashboard diagnostics may add non-blocking warnings from recent compatibility results, such as an untested configured capability or a failed provider probe. These diagnostics are informational and do not prevent the gateway from starting.
