# Architecture

SiftGate has two layers:

- Customer Data Plane: the open-source gateway that handles real AI requests in the customer's infrastructure.
- Cloud Control Plane: the future hosted product for fleet policy, telemetry analytics, audit, and router recommendations.

The data plane is complete on its own. The cloud layer is optional and disabled by default.

## System Model

```text
User App
  -> Customer SiftGate Data Plane
  -> OpenAI / Anthropic / Google / Local / Custom Provider

Customer SiftGate Data Plane
  -> heartbeat / telemetry metadata / audit summary
  -> Cloud Control Plane

Cloud Control Plane
  -> policy bundle / router recommendation / emergency control
  -> Customer SiftGate Data Plane
```

Default guarantees:

- AI requests do not pass through the cloud control plane.
- Prompts and responses stay in the customer data plane.
- Provider API keys stay in the customer data plane.
- The gateway initiates outbound cloud connections when connected mode is enabled.
- Customers do not need to expose inbound ports for control-plane access.

## Data Plane Request Flow

```text
Client Request
  -> Controller
  -> Normalizer
  -> API Key Guard
  -> Local Namespace Policy
  -> Budget Check
  -> Prompt Cache Lookup
  -> Scoring
  -> Router
  -> Provider Client
  -> Denormalizer
  -> Call Log
  -> Optional Shadow Traffic Mirror
  -> Optional External Log Sinks
  -> Optional Control-Plane Metadata Upload
```

### Controllers

The gateway accepts the major AI API shapes supported by the open-source Data Plane:

- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`
- `POST /v1/embeddings`
- `POST /v1/rerank`
- `POST /v1/images/generations`
- `POST /v1/images/edits`
- `POST /v1/images/variations`
- `POST /v1/audio/transcriptions`
- `POST /v1/audio/translations`
- `POST /v1/audio/speech`
- `POST /v1/videos/generations`
- `GET /v1/videos/:id`
- `GET /v1/videos/:id/content`
- `POST /v1/videos/:id/cancel`
- `WS /v1/realtime` when the experimental realtime preview is enabled

Each controller normalizes inbound requests into the canonical internal format before routing.

### Canonical Format

The canonical format lets the gateway translate between provider protocols without making the rest of the pipeline care about the original wire shape.

Normalizers convert client input into canonical requests. Denormalizers convert canonical responses or stream events back into the caller's requested protocol.

v0.6 adds canonical structured-output fields so the pipeline preserves OpenAI Chat `response_format`, OpenAI Responses `text.format`, and Anthropic Messages `output_config.format` intent across routing. Provider forwarding records whether the target received a native passthrough, a safe native mapping, or an explicit downgrade/unsupported strategy.

### Authentication And Governance

Gateway API keys are generated in the Dashboard and used by client applications. Provider API keys are configured on upstream nodes and used only by the gateway.

Gateway API keys can carry:

- automatic routing permission
- direct model routing permission
- allowed nodes
- allowed models
- per-key budgets
- per-key rate limits
- optional local namespace binding

Local namespaces are open-source data-plane policy labels. They can restrict allowed nodes/models and add namespace budgets/rate limits, but they are not Cloud workspaces and do not include enterprise SSO, SCIM, organization billing, or workspace RBAC. Namespace restrictions are intersected with API-key restrictions before routing.

### Routing

Routing targets a `node + model` pair.

For direct model requests, the gateway resolves model names in this order:

1. Exact model id
2. Alias
3. Node id shortcut
4. Node prefix
5. Model-family prefix
6. Unknown model fallback to automatic routing, unless key permissions require rejection

For automatic routing, the scoring engine evaluates request complexity across 14 dimensions and maps the request into:

- simple
- standard
- complex
- reasoning

The router then applies tier config, domain preferences, modality compatibility, circuit breaker state, momentum, load-balancing strategy, fallbacks, and A/B split rules. Tiers can use legacy `primary/fallbacks` or the v0.2 `targets + strategy` schema; `split` keeps experiment precedence when configured.

### Reliability

The data plane protects request flow with:

- retry with backoff
- provider fallback chains and optional v0.3 fallback policies for 429, timeout, structured-output validation, and cost downgrade
- model-level circuit breakers
- prompt cache
- optional Redis shared state backend for circuit breakers, rate limits, prompt cache, and routing momentum
- graceful shutdown
- body size limits
- dashboard health and node status

### Observability

The gateway records call logs with:

- request id
- Gateway API key id and name
- namespace id
- source protocol
- selected tier
- upstream node and model
- token usage
- estimated cost
- latency
- status code
- fallback status and fallback reason
- structured-output requested status, type, strategy, support flag, and schema name
- retry count
- cache token fields
- experiment group

These logs power Dashboard pages, SSE updates, analytics, budgets, local webhook alert spike detection, namespace filters, and optional connected-gateway metadata upload.

For explainable routing, the pipeline also writes a separate `route_decisions` row keyed by `request_id`. This trace records the routing evidence that led to the final `node:model`: source format, tier, score, domain and modality hints, candidate targets, filter reasons, cost/latency/context scores, circuit state, fallback chain, cost downgrade, final selection, and outcome.

Multimodal requests add a privacy-safe evidence layer to the same trace. The top-level `modality_evidence` block records the requested modality, input/output type shape, file count, byte size, required capabilities, endpoint strategy, and which targets were filtered by capability or file-size limits. Each candidate target adds `capability_evidence` with supported modalities, matched/missing capabilities, endpoint status, max file size, pricing source, and catalog source. This gives Dashboard Route Explanation enough context to explain image/audio/video/rerank/embedding decisions without storing prompt text, response text, uploaded file bytes, raw headers, or provider keys.

The experimental v0.8 video preview uses an async job model. `POST /v1/videos/generations` is routed through the normal media pipeline, then writes a `video_jobs` row containing only request id, provider job id, node, model, Gateway API key/namespace attribution, status, timestamps, expiry, and sanitized error text. Status/content/cancel routes look up that local metadata, enforce the creating key/namespace boundary, and proxy to provider endpoints only when the node explicitly declares them. Prompts, source media, generated video bytes, raw headers, and provider keys are not persisted.

## Config Audit And Rollback

The v0.9 OSS Data Plane adds a local configuration history layer:

- `config_versions` stores sanitized rollback snapshots and summaries.
- `config_audit_events` stores actor/action/target/result metadata for config changes.
- Dashboard config reload, node create/update/delete, routing edits, Dashboard-managed API key mutations, and rollback attempts write audit events.

The audit layer sits beside `ConfigService`; it does not change the request forwarding path. Mutating Dashboard operations are wrapped so SiftGate captures a before snapshot, runs the mutation, captures an after snapshot, and records success or failure.

Rollback uses the same atomic validation semantics as config reload: SiftGate parses and validates the target YAML before writing `gateway.config.yaml` and committing the in-memory snapshot. If parsing, validation, or secret rehydration fails, the current file and active runtime config are retained.

Snapshots are secret-safe storage. Literal provider keys, dashboard password hashes, raw auth headers, and secret/token/password-like values are redacted before persistence. Environment references such as `${OPENAI_API_KEY}` remain visible. When rollback needs a redacted value, SiftGate rehydrates it only from a matching field in the current local config; array entries with an `id` must match by `id`, preventing a deleted node from borrowing another node's secret.

## Shadow Traffic

The open-source data plane includes optional shadow traffic for sampled test-node mirroring. When enabled, successful primary requests can enqueue an asynchronous copy to a configured shadow node/model. The primary response has already been produced, so shadow latency and failures do not affect the caller.

Shadow results are stored separately from `call_logs` and are read-only in the Dashboard. By default they store metadata only and do not store prompts, responses, raw headers, or provider keys. Operators must explicitly enable local comparison sample storage with `shadow.compare.store_prompts` or `shadow.compare.store_responses`; config validation warns when either is enabled.

The v0.9 comparison report layer does not introduce a new decision-making path. It pairs shadow result rows with primary `call_logs` by `request_id` and computes success rate, p50/p95 latency, estimated shadow cost, potential savings, token delta, fallback delta, quality sample coverage, confidence, and risk notes. Shadow cost uses the local pricing configuration and is flagged when pricing is missing. Dashboard and API reports stay read-only: they can support a gray-release decision, but they never mutate routing config, promote a target, or replay media/video bytes.

## Local Webhook Alerts

The open-source data plane includes an optional `alerts` subsystem. It listens to budget threshold/exceeded events, active health probe state, circuit breaker transitions, and the local call-log stream for error/latency spikes. Delivery runs from an in-memory asynchronous queue so webhook latency does not block AI proxy requests.

Alert payloads are sanitized before dispatch. Prompts, responses, provider API keys, raw headers, configured webhook headers, passwords, secrets, and tokens are not included. Dashboard alert status is read from local memory through `GET /api/dashboard/alerts`; webhook URLs and headers are not exposed there.

## Shared Runtime State

The data plane defaults to in-process memory for runtime state. The optional
v0.5 Redis backend lets multiple gateway instances share state without requiring
the Cloud Control Plane:

- circuit breakers are mirrored through a Redis hash
- API key/IP rate limits use Redis `INCR` and expiry
- prompt-cache entries use Redis String+TTL values
- routing momentum uses Redis sorted sets

When Redis is unavailable, `state.unavailable_policy` controls behavior:
`fail_open` keeps traffic flowing with degraded state, while `fail_closed`
rejects rate-limited paths and treats circuits as unavailable.

External log sinks can mirror sanitized `CallLog` metadata to JSONL files, webhook receivers, or a minimal Elasticsearch bulk endpoint. Sink delivery is asynchronous and starts only after the local database write succeeds. Export payloads do not include prompts, responses, provider keys, raw auth headers, or secret-bearing fields by default.

OpenTelemetry is the data plane's metrics and tracing layer. When `telemetry.enabled` is set in `gateway.config.yaml`, the existing Prometheus exporter exposes scrapeable metrics on `telemetry.metrics.prometheus_port` at `/metrics`.

Business metrics are emitted from the request pipeline and runtime services:

- `siftgate_requests_total{tier,node,model,status}`
- `siftgate_request_duration_seconds{tier,node,model,status}`
- `siftgate_tokens_total{node,model,direction}`
- `siftgate_cost_total{node,model}`
- `siftgate_fallback_total{tier,node,model}`
- `siftgate_cache_hits_total`
- `siftgate_cache_misses_total`
- `siftgate_budget_usage_ratio{scope,budget_type}`
- `siftgate_concurrent_requests{node}`
- `siftgate_circuit_breaker_state{node,model}`

Labels are kept low-cardinality. Request status is a class such as `2xx`; budget usage is aggregated by `scope` and `budget_type`; API key names/IDs, prompt text, response text, provider keys, and raw headers are excluded from metric labels.

## Connected Gateway

Connected Gateway is a data-plane client for a future hosted control plane. It is configured under:

```yaml
control_plane:
  enabled: true
  url: "http://localhost:3100"
  gateway_id: "gw_local_dev"
  registration_token: "${GATEWAY_REGISTRATION_TOKEN}"
  telemetry:
    upload_interval_seconds: 30
    include_prompt: false
    include_response: false
```

When enabled, the data plane:

- registers with the cloud service using a registration token
- receives a workspace id, gateway id, and access token
- sends heartbeat every 30 seconds
- uploads privacy-preserving call metadata
- pulls the latest policy bundle every 60 seconds

When disabled, the gateway never contacts a control plane.

## Privacy Boundary

Connected telemetry can include:

- workspace id
- gateway id
- request id
- Gateway API key id
- node id
- model
- tier
- score
- domain hint
- modality
- latency
- status code
- input and output tokens
- estimated cost
- fallback used
- retry count
- cache hit
- policy hits
- timestamp

Connected telemetry does not include by default:

- prompt text
- response text
- tool input payloads
- provider API keys
- raw authorization headers
- raw secret-bearing headers

## Cloud Control Plane

The cloud control plane is the future paid product. It should manage:

- workspaces
- users and roles
- gateway fleet registration and health
- version drift
- config drift
- metadata analytics
- audit events
- policy bundles
- router recommendations
- optional Autopilot with guardrails

See [Control Plane](./CONTROL_PLANE.md), [Product Roadmap](./PRODUCT_ROADMAP.md), and [Open Core](./OPEN_CORE.md) for the product boundary.

## Packaging

This repository is currently distributed as GitHub source plus Docker image. The root `package.json` keeps `private: true` so accidental npm publication is blocked until an npm package is intentionally designed.
