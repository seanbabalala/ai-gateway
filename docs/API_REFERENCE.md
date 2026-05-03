# SiftGate API Reference

SiftGate exposes provider-compatible AI ingress endpoints, a local Dashboard API, and machine-readable OpenAPI documentation for the MIT open-source Data Plane.

v0.8 hardens the OpenAI-compatible images/audio ingress added in v0.6 with image variations, audio translations, richer media metadata, production log visibility, and an experimental async video generation preview. Media files and video bytes remain pass-through only and are not persisted by SiftGate.

## Live Documentation

When the gateway is running, the API documentation is available from the same HTTP server:

| Endpoint | Purpose |
| --- | --- |
| `GET /docs` | Swagger UI for interactive exploration |
| `GET /openapi.json` | OpenAPI 3.x document for client generation and CI checks |

The generated spec covers the OSS Data Plane only. It does not require SiftGate Cloud, and Cloud remains an optional control plane.

## Authentication

SiftGate uses two bearer-token contexts:

| Context | Used by | Header |
| --- | --- | --- |
| Gateway API key | AI proxy endpoints under `/v1/*` | `Authorization: Bearer gw_sk_live_...` |
| Dashboard session JWT | Dashboard API under `/api/dashboard/*` when dashboard auth is enabled | `Authorization: Bearer <dashboard_jwt>` |

Provider API keys are never client credentials. They stay in `gateway.config.yaml`, `.env`, or another local secret source and are used only by the gateway when it calls upstream providers.

## AI Proxy Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions-compatible ingress |
| `POST` | `/v1/responses` | OpenAI Responses-compatible ingress |
| `POST` | `/v1/messages` | Anthropic Messages-compatible ingress |
| `POST` | `/v1/embeddings` | OpenAI Embeddings-compatible ingress |
| `POST` | `/v1/rerank` | OpenAI/common-compatible rerank ingress |
| `POST` | `/v1/images/generations` | OpenAI Images generation-compatible ingress |
| `POST` | `/v1/images/edits` | OpenAI Images edits-compatible ingress |
| `POST` | `/v1/images/variations` | OpenAI Images variations-compatible ingress |
| `POST` | `/v1/audio/transcriptions` | OpenAI Audio transcription-compatible ingress |
| `POST` | `/v1/audio/translations` | OpenAI Audio translation-compatible ingress |
| `POST` | `/v1/audio/speech` | OpenAI Audio speech-compatible ingress |
| `POST` | `/v1/videos/generations` | Experimental async video generation preview |
| `GET` | `/v1/videos/:id` | Experimental video job status |
| `GET` | `/v1/videos/:id/content` | Experimental video content proxy |
| `POST` | `/v1/videos/:id/cancel` | Experimental video cancel proxy |
| `WS` | `/v1/realtime` | Experimental OpenAI Realtime-style WebSocket pass-through, disabled by default |
| `GET` | `/v1/models` | OpenAI-compatible model list, including gateway aliases |

All proxy endpoints require a Dashboard-generated Gateway API key. Use `model: "auto"` for smart routing, a real model id for direct routing, a configured alias, a node id, or a `node/model` prefix route when that key allows direct access.

The gateway preserves the caller-facing protocol while routing across configured provider protocols. Requests and responses may be normalized internally, but provider credentials and raw authorization headers are not exposed in OpenAPI examples or Dashboard DTOs.

### Structured Output

Structured-output intent is preserved in the canonical request and forwarded to the selected provider when SiftGate has a safe protocol mapping.

| Ingress | Supported Field | Behavior |
| --- | --- | --- |
| `/v1/chat/completions` | `response_format.type=json_object` or `json_schema` | Passed through to Chat targets or mapped to Responses `text.format` / Messages `output_config.format` when possible |
| `/v1/responses` | `text.format.type=json_object` or `json_schema` | Passed through to Responses targets or mapped to Chat `response_format` / Messages `output_config.format` when possible |
| `/v1/messages` | `output_config.format.type=json_schema` | Passed through for native Messages targets; mapped to OpenAI-compatible structured-output fields only when safe |

Example Chat request:

```json
{
  "model": "auto",
  "messages": [{ "role": "user", "content": "Return a JSON status." }],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "status",
      "schema": {
        "type": "object",
        "required": ["ok"],
        "properties": { "ok": { "type": "boolean" } }
      },
      "strict": true
    }
  }
}
```

Example Responses request:

```json
{
  "model": "auto",
  "input": "Return a JSON status.",
  "text": {
    "format": {
      "type": "json_schema",
      "name": "status",
      "schema": {
        "type": "object",
        "required": ["ok"],
        "properties": { "ok": { "type": "boolean" } }
      },
      "strict": true
    }
  }
}
```

Example Messages request:

```json
{
  "model": "auto",
  "max_tokens": 512,
  "messages": [{ "role": "user", "content": "Return a JSON status." }],
  "output_config": {
    "format": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "required": ["ok"],
        "properties": { "ok": { "type": "boolean" } }
      }
    }
  }
}
```

Call logs, CSV/JSON exports, external log sinks, and optional control-plane telemetry include structured-output metadata: requested status, type, strategy (`passthrough`, `native`, or `downgraded`), support flag, and schema name. If `routing.fallback_policy.structured_output.enabled` is true, non-streaming requests can fallback on JSON parse or schema validation failure. Streaming requests do not fallback after SSE output has started.

### Embeddings

`POST /v1/embeddings` accepts OpenAI-compatible embedding requests:

```json
{
  "model": "auto",
  "input": ["hello", "world"],
  "dimensions": 1536,
  "encoding_format": "float"
}
```

Embedding routing uses `nodes[].embedding_models`. `model: "auto"` filters by API key permissions, active circuits, and requested dimensions, then prefers the lowest configured input price. Direct model requests must resolve to an embedding model; chat models listed only in `nodes[].models` are not selected for this endpoint. Responses preserve the OpenAI shape with `object: "list"`, embedding data, and `usage.prompt_tokens` / `usage.total_tokens`.

### Rerank

`POST /v1/rerank` accepts OpenAI/common-compatible rerank requests:
```json
{
  "model": "auto",
  "query": "what is SiftGate?",
  "documents": [
    "SiftGate is a self-hosted AI traffic gateway.",
    "SQLite is the default local database."
  ],
  "top_n": 1,
  "return_documents": true
}
```

Rerank routing uses `nodes[].rerank_models`. `model: "auto"` filters by Gateway API key permissions, local namespace restrictions, circuit/health state, and configured model availability, then prefers the lowest configured input price. Direct model requests must resolve to a rerank model; chat models listed only in `nodes[].models` and embeddings listed only in `nodes[].embedding_models` are not selected for this endpoint. Responses preserve a common rerank shape with `object: "rerank"`, sorted `results`, `relevance_score`, optional `document`, and `usage.prompt_tokens` / `usage.total_tokens`.

### Images

`POST /v1/images/generations` accepts OpenAI-compatible JSON bodies and selects from `nodes[].image_models`:

```json
{
  "model": "auto",
  "prompt": "A clean product render of SiftGate",
  "size": "1024x1024"
}
```

`POST /v1/images/edits` accepts JSON or `multipart/form-data`. For multipart requests, SiftGate does not parse, resize, transcode, or inspect image file contents. It preserves the raw multipart bytes, rewrites or appends the selected `model` form field, and records only safe canonical metadata such as media type, operation, multipart status, file count, byte size, requested/response format, and upstream response content type.

`POST /v1/images/variations` uses the same image-capable route pool and multipart pass-through behavior. If an upstream does not implement image variations, keep `images_variations_endpoint` pointed at a compatible proxy that does, or let the provider return its native unsupported-operation error; SiftGate will surface it as a normal provider failure/fallback without storing image bytes.

Image responses are returned in the upstream provider's OpenAI-compatible JSON shape.

### Audio

`POST /v1/audio/transcriptions` accepts JSON or `multipart/form-data` and selects from `nodes[].audio_models`. Multipart audio is pass-through: SiftGate rewrites/appends `model`, forwards the original file bytes, and does not decode or transcode media locally.

```bash
curl http://localhost:2099/v1/audio/transcriptions \
  -H "Authorization: Bearer gw_sk_live_..." \
  -F model=auto \
  -F file=@sample.wav
```

`POST /v1/audio/translations` follows the same route, budget, fallback, and multipart pass-through path as transcriptions:

```bash
curl http://localhost:2099/v1/audio/translations \
  -H "Authorization: Bearer gw_sk_live_..." \
  -F model=auto \
  -F response_format=json \
  -F file=@sample.wav
```

`POST /v1/audio/speech` accepts OpenAI-compatible JSON and can return binary provider audio directly:

```json
{
  "model": "tts-1",
  "input": "Hello from SiftGate",
  "voice": "alloy"
}
```

When an upstream returns non-JSON audio such as `audio/mpeg`, SiftGate forwards the provider body and content type unchanged and records only the provider response content type. Increase `server.body_limit` when image edit/variation or audio transcription/translation files are larger than the default `1mb`.

### Experimental Video

`POST /v1/videos/generations` is an experimental async preview. It accepts JSON bodies, selects from `nodes[].video_models`, rewrites `model` to the chosen upstream model, and forwards provider-specific fields such as `prompt`, `input_reference`, `duration`, `size`, `aspect_ratio`, `quality`, and `metadata`.

```json
{
  "model": "auto",
  "prompt": "A five second product demo clip",
  "duration": 5,
  "aspect_ratio": "16:9"
}
```

SiftGate stores only `video_jobs` metadata: local request id, provider job id, node, model, Gateway API key/namespace attribution, status, timestamps, expiry, and sanitized error. It does not persist prompts, source images, generated video bytes, raw headers, or provider keys.

`GET /v1/videos/:id` returns local job metadata and refreshes from `video_status_endpoint` when configured. `GET /v1/videos/:id/content` and `POST /v1/videos/:id/cancel` proxy to `video_content_endpoint` and `video_cancel_endpoint` only when the selected node declares those endpoints.

### Experimental Realtime

`WS /v1/realtime` is an experimental preview and is disabled unless `realtime.enabled: true` is set. It is intentionally a pass-through proxy for OpenAI Realtime-style providers:

- Clients connect to `/v1/realtime?model=<realtime-model>` with `Authorization: Bearer <gateway-api-key>`.
- Upstream targets come from `nodes[].realtime_models` and `nodes[].realtime_endpoint`.
- The gateway enforces Gateway API key auth, API key/namespace node-model permissions, global and per-node connection limits, idle timeout, session timeout, and close cleanup.
- The gateway forwards `OpenAI-Beta: realtime=v1` and the provider API key upstream.
- It does not parse, transcode, inspect, persist, or validate audio frames.
- Gateway API keys are not accepted in query strings; browser clients that cannot set headers should connect through a trusted backend.

Connection state summaries are exposed through `/health` and `/api/dashboard/nodes` under each node's `realtime` field. Errors are sanitized and do not include provider keys, Gateway API keys, prompts, responses, raw headers, or audio payloads.

## Health

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/health` | Gateway health, uptime, node circuit state, realtime connection summary, model circuit state, and budget status |
| `GET` | `/cluster/status` | Redis-backed cluster inventory, heartbeat status, and reload broadcast metadata when `state.backend=redis` or `cluster.enabled=true` |

`/health` is intended for local health checks, Docker checks, and monitoring systems. `/cluster/status` returns `404` in the default single-instance memory mode.

## Dashboard API

Dashboard routes are guarded by the dashboard auth layer when dashboard auth is configured.

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Exchange the dashboard password for a session JWT |
| `GET` | `/api/auth/status` | Check whether dashboard auth is required |
| `GET` | `/api/dashboard/stats` | Aggregate calls, tokens, cost, latency, success rate, and distributions |
| `GET` | `/api/dashboard/logs` | Paginated call logs |
| `GET` | `/api/dashboard/logs/export` | Export logs as CSV or JSON |
| `GET` | `/api/dashboard/logs/sse` | Server-Sent Events stream for live call logs |
| `GET` | `/api/dashboard/route-decisions` | Paginated explainable routing summaries |
| `GET` | `/api/dashboard/route-decisions/:requestId` | Full route decision trace for one request |
| `GET` | `/api/dashboard/analytics/cost` | Cost analytics by day, model, node, and tier |
| `GET` | `/api/dashboard/analytics/experiment` | A/B split analytics |
| `GET` | `/api/dashboard/budget` | Global and per-key budget status |
| `GET` | `/api/dashboard/budget/keys` | API keys with budget metadata |
| `POST` | `/api/dashboard/budget/:id/reset` | Reset a budget rule by id |
| `GET` | `/api/dashboard/namespaces` | Local namespace policies and budget summaries |
| `GET` | `/api/dashboard/shadow` | Read-only shadow traffic status and sanitized recent results |
| `GET` | `/api/dashboard/alerts` | Local webhook alert channels and recent delivery status |
| `GET` | `/api/dashboard/config` | Sanitized local configuration |
| `POST` | `/api/dashboard/config/reload` | Reload `gateway.config.yaml` from disk |
| `GET` | `/api/dashboard/capabilities` | Capability metadata used by routing and Dashboard views |
| `POST` | `/api/dashboard/capabilities/recommend-tiers` | Recommend tier placement for models |
| `POST` | `/api/dashboard/routing/recommend` | Recommend routing changes for a request sample |
| `GET` | `/api/dashboard/routing/recommendations` | Read-only adaptive routing recommendations from local sliding-window metrics |
| `PUT` | `/api/dashboard/routing` | Update local routing configuration |
| `GET` | `/api/dashboard/nodes` | Node health, configured models, tags, circuit state, realtime summary, and provider compatibility matrix |
| `POST` | `/api/dashboard/nodes/test` | Test an arbitrary node payload before saving |
| `POST` | `/api/dashboard/nodes` | Create a node in local config |
| `PUT` | `/api/dashboard/nodes/:id` | Update a node in local config |
| `DELETE` | `/api/dashboard/nodes/:id` | Delete a node from local config |
| `POST` | `/api/dashboard/nodes/:id/test` | Run safe provider compatibility checks for a configured node |
| `POST` | `/api/dashboard/nodes/:id/reset` | Reset a node circuit breaker |
| `GET` | `/api/dashboard/cache/stats` | Prompt-cache statistics |
| `POST` | `/api/dashboard/cache/clear` | Clear prompt-cache entries |
| `GET` | `/api/dashboard/telemetry-status` | Optional connected-gateway telemetry status |

### Explainable Routing Traces

`GET /api/dashboard/route-decisions` returns paginated summaries and supports `page`, `limit`, `tier`, `node`, `source_format`, `api_key_id`, legacy `api_key`, and `namespace` filters. `GET /api/dashboard/route-decisions/:requestId` returns the full trace for one request.

Each trace includes request id, source format, tier, score, domain and modality hints, candidate targets, filter reasons, cost/latency/context scores, circuit state, fallback chain, cost-downgrade state, final selection, and outcome status.

For multimodal and capability-specific requests, traces may include:

- `modality_evidence.requested_modality`
- `modality_evidence.input_types` / `output_types`
- `modality_evidence.file_count` / `byte_size`
- `modality_evidence.required_capabilities`
- `modality_evidence.endpoint_strategy`
- `modality_evidence.filtered_by_capability`
- `modality_evidence.filtered_by_file_size`
- `candidate_targets[].capability_evidence.supported_modalities`
- `candidate_targets[].capability_evidence.endpoint_status`
- `candidate_targets[].capability_evidence.pricing_source`
- `candidate_targets[].capability_evidence.catalog_source`

These fields are counts, sizes, capability labels, and route metadata only. The trace does not store prompt text, response text, uploaded file bytes, raw headers, or provider API keys.

### Provider Compatibility Matrix

`GET /api/dashboard/nodes` includes `compatibility_matrix` for every node. Each row contains `capability`, `configured`, `tested`, `last_status`, `last_checked_at`, `failure_reason`, `latency_ms`, `status_code`, `test_mode`, and `requires_confirmation`.

`POST /api/dashboard/nodes/:id/test` accepts an optional body:

```json
{
  "capabilities": ["chat", "embeddings", "images", "video", "realtime"],
  "confirm_expensive": false
}
```

Supported capabilities are `chat`, `responses`, `messages`, `embeddings`, `rerank`, `images`, `audio`, `video`, and `realtime`. Text, embedding, and rerank checks send tiny synthetic requests. Media, video, and realtime checks default to endpoint/auth probes; video/realtime generation or long-lived sessions are not started unless a future explicit confirmation flow enables it. Results are local metadata only and never include prompt text, response bodies, raw headers, or provider API keys.

## Gateway API Key Management

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/dashboard/api-keys` | List Dashboard-managed Gateway API keys |
| `POST` | `/api/dashboard/api-keys` | Create a Gateway API key and return the plain key once |
| `PUT` | `/api/dashboard/api-keys/:id` | Update key name, status, permissions, budgets, or rate limits |
| `POST` | `/api/dashboard/api-keys/:id/rotate` | Rotate the Gateway API key secret and return the new plain key once |
| `DELETE` | `/api/dashboard/api-keys/:id` | Delete a Gateway API key |

OpenAPI examples redact plain Gateway API key values. Runtime create and rotate responses still return the plain key once so the operator can copy it into their client configuration.

## Secret Handling In The Spec

The OpenAPI schema is intentionally secret-safe:

- Provider API key inputs are marked `writeOnly` and use placeholder examples such as `${OPENAI_API_KEY}`.
- Sanitized config responses mark node `api_key` as `readOnly` and describe it as masked.
- Dashboard password input is marked `writeOnly`.
- Dashboard password hashes and raw provider keys are not part of documented response DTOs.
- Connected-gateway configuration remains optional and must not require private Cloud packages.
