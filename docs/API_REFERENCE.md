# SiftGate API Reference

SiftGate exposes provider-compatible AI ingress endpoints, a local Dashboard API, and machine-readable OpenAPI documentation for the MIT open-source Data Plane.

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
| `GET` | `/v1/models` | OpenAI-compatible model list, including gateway aliases |

All proxy endpoints require a Dashboard-generated Gateway API key. Use `model: "auto"` for smart routing, a real model id for direct routing, a configured alias, a node id, or a `node/model` prefix route when that key allows direct access.

The gateway preserves the caller-facing protocol while routing across configured provider protocols. Requests and responses may be normalized internally, but provider credentials and raw authorization headers are not exposed in OpenAPI examples or Dashboard DTOs.

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

## Health

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/health` | Gateway health, uptime, node circuit state, model circuit state, and budget status |

`/health` is intended for local health checks, Docker checks, and monitoring systems.

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
| `GET` | `/api/dashboard/analytics/cost` | Cost analytics by day, model, node, and tier |
| `GET` | `/api/dashboard/analytics/experiment` | A/B split analytics |
| `GET` | `/api/dashboard/budget` | Global and per-key budget status |
| `GET` | `/api/dashboard/budget/keys` | API keys with budget metadata |
| `POST` | `/api/dashboard/budget/:id/reset` | Reset a budget rule by id |
| `GET` | `/api/dashboard/alerts` | Local webhook alert channels and recent delivery status |
| `GET` | `/api/dashboard/config` | Sanitized local configuration |
| `POST` | `/api/dashboard/config/reload` | Reload `gateway.config.yaml` from disk |
| `GET` | `/api/dashboard/capabilities` | Capability metadata used by routing and Dashboard views |
| `POST` | `/api/dashboard/capabilities/recommend-tiers` | Recommend tier placement for models |
| `POST` | `/api/dashboard/routing/recommend` | Recommend routing changes for a request sample |
| `GET` | `/api/dashboard/routing/recommendations` | Read-only adaptive routing recommendations from local sliding-window metrics |
| `PUT` | `/api/dashboard/routing` | Update local routing configuration |
| `GET` | `/api/dashboard/nodes` | Node health, configured models, tags, and circuit state |
| `POST` | `/api/dashboard/nodes/test` | Test an arbitrary node payload before saving |
| `POST` | `/api/dashboard/nodes` | Create a node in local config |
| `PUT` | `/api/dashboard/nodes/:id` | Update a node in local config |
| `DELETE` | `/api/dashboard/nodes/:id` | Delete a node from local config |
| `POST` | `/api/dashboard/nodes/:id/test` | Test a configured node |
| `POST` | `/api/dashboard/nodes/:id/reset` | Reset a node circuit breaker |
| `GET` | `/api/dashboard/cache/stats` | Prompt-cache statistics |
| `POST` | `/api/dashboard/cache/clear` | Clear prompt-cache entries |
| `GET` | `/api/dashboard/telemetry-status` | Optional connected-gateway telemetry status |

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
