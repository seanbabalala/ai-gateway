# Python SDK Design

This document captures the v0.4 Python SDK direction without implementing a package in this release. The open-source data plane remains fully usable through HTTP and OpenAI-compatible `base_url` replacement.

## Goals

- Provide a small `siftgate` Python package after the TypeScript scaffold proves the API shape.
- Keep zero or minimal runtime dependencies, with `httpx` as the likely HTTP transport if a dependency is accepted.
- Preserve OpenAI SDK compatibility for teams that prefer `OpenAI(base_url="http://localhost:2099/v1", api_key=...)`.
- Support SiftGate-specific helpers only where they add value, such as routing hints and typed gateway errors.

## Proposed Package Shape

```text
siftgate/
  __init__.py
  client.py
  types.py
  errors.py
```

The public API should mirror the TypeScript scaffold:

- `client.models.list()`
- `client.chat.completions.create(...)`
- `client.responses.create(...)`
- `client.messages.create(...)`
- `client.embeddings.create(...)`
- `client.request_raw(...)` for streaming or advanced callers

## Client Options

- `base_url`: defaults to `http://localhost:2099`
- `gateway_api_key`: dashboard-generated Gateway API key
- `headers`: optional default headers
- `timeout`: request timeout
- `transport`: injectable HTTP transport for tests and custom deployments

## Routing Hints

Python calls should accept an optional `routing_hint` argument and encode it as the `x-siftgate-routing-hint` header, matching the TypeScript SDK. Hints remain advisory and must not bypass Gateway API key permissions or direct model routing checks.

## Error Model

Non-2xx responses should raise `SiftGateError` with:

- `status_code`
- `body`
- `request_id`
- `message`

The implementation should parse JSON error bodies when possible and keep text responses intact.

## Streaming

Streaming should be exposed as a raw response iterator first. A higher-level SSE parser can be added after the gateway's `/v1/embeddings` and future multimodal endpoints settle.
