# Changelog

## Unreleased

### Added

- v0.8 local Provider / Model Catalog for the OSS Data Plane, covering provider metadata, models, modalities, endpoints, auth type, pricing source, capabilities, and limits.
- Built-in static catalog entries for OpenAI, Anthropic, Google Gemini/Vertex, Azure OpenAI, OpenRouter, Groq, Mistral, DeepSeek, xAI, Cohere, Voyage, Jina, Together, Fireworks, Ollama, vLLM, and OpenAI-compatible custom providers.
- Dashboard catalog APIs `GET /api/dashboard/catalog/providers` and `GET /api/dashboard/catalog/models` with provider/modality/endpoint filters.
- Config validation warnings for catalog unknown models, endpoint/modality mismatches, and placeholder pricing that still needs operator review.
- v0.8 Dashboard Add Node wizard backed by the local catalog, with provider/proxy/custom selection, capability selection, model bucket editing, endpoint/auth/header/pricing confirmation, and connection test/save flow.
- `nodes[].video_models`, `video_generations_endpoint`, and `video_status_endpoint` config surface for video-capable providers ahead of a public video gateway endpoint.
- v0.8 media endpoint hardening for the OSS Data Plane with OpenAI-compatible `POST /v1/images/variations` and `POST /v1/audio/translations`.
- Canonical media metadata for images/audio requests: media type, operation, multipart flag, file count, byte size, requested format, response format, and provider response content type.
- Dashboard call-log visibility, CSV/JSON export fields, external log sink fields, and optional connected-gateway telemetry metadata for media operations without storing file contents.
- Node config support for `images_variations_endpoint` and `audio_translations_endpoint`, plus validation and OpenAPI docs for the new media endpoints.

### Changed

- Dashboard Add Node provider presets now load from the catalog API instead of a hardcoded frontend list.
- Dashboard Add Node now supports `models`, `embedding_models`, `rerank_models`, `image_models`, `audio_models`, `video_models`, and `realtime_models` in one localized wizard while preserving advanced local Data Plane fields.
- Config validation now allows specialized-only nodes with `models: []` when embedding/rerank/media/realtime model buckets are configured.
- Images/audio ingress now documents production pass-through behavior for JSON and multipart requests across generations, edits, variations, transcriptions, translations, and speech.

## 0.6.1 - 2026-05-03

### Changed

- Tightened Dashboard localization coverage for v0.2-v0.6 OSS Data Plane surfaces, including Route Explanation, structured-output log details, namespace filters, shadow traffic, realtime status, multimodal capability badges, and adaptive routing recommendations.
- Updated route explanation validation to assert localized empty/no-trace states instead of English-only copy.

## 0.6.0 - 2026-05-03

### Added

- v0.6 canonical structured-output support that preserves OpenAI Chat Completions `response_format`, OpenAI Responses `text.format`, and Anthropic Messages `output_config.format` intent across protocol conversion.
- Provider forwarding strategies for structured output: native passthrough, cross-protocol native mapping, and explicit downgrade/unsupported metadata when a target cannot safely honor the request.
- Structured-output call-log metadata for Dashboard details, CSV/JSON exports, external log sinks, and optional connected-gateway telemetry.
- Unit coverage for Chat, Responses, Anthropic passthrough/downgrade behavior, provider forwarding, schema fallback, and streaming conservative behavior.
- v0.6 unified multimodal capability schema for node/model declarations, covering modalities, endpoint maps, input/output types, file-size limits, streaming, realtime, rerank, and pricing metadata.
- Smart-routing modality filtering that removes incompatible node:model targets for image/audio-style requests while preserving legacy `vision` compatibility.
- Read-only Dashboard Nodes and Routing capability summaries for per-model modalities, streaming/realtime/rerank flags, context windows, dimensions, file-size limits, and pricing hints.
- Config validation and docs for v0.6 capability fields, endpoint maps, and multimodal model metadata.
- v0.6 OpenAI/common-compatible `POST /v1/rerank` endpoint for the open-source Data Plane.
- Canonical rerank request/response types, normalizer, provider forwarding, routing, usage, cost, telemetry, and call-log support.
- `nodes[].rerank_models` and optional `nodes[].rerank_endpoint` configuration with validation and example pricing.
- Rerank routing that respects Gateway API key permissions, local namespace policy, circuit/health state, fallback, and cost-aware target ranking.
- Unit and e2e coverage for rerank controller, normalizer, provider client, routing, pipeline behavior, config validation, and OpenAPI exposure.
- v0.6 minimal OpenAI-compatible images and audio ingress for the OSS Data Plane.
- `POST /v1/images/generations`, `POST /v1/images/edits`, `POST /v1/audio/transcriptions`, and `POST /v1/audio/speech` with canonical media metadata and provider pass-through forwarding.
- `nodes[].image_models`, `nodes[].audio_models`, media endpoint path configuration, pricing validation, routing, budget, rate-limit, telemetry, and call-log coverage.
- Multipart pass-through for image edits and audio transcriptions that rewrites/appends only the selected `model` field and avoids local media parsing/transcoding.
- Unit and e2e coverage for media normalization, routing, provider forwarding, config validation, controllers, OpenAPI paths, multipart pass-through, and binary audio responses.
- v0.6 experimental OpenAI Realtime-style WebSocket preview for the OSS Data Plane.
- Disabled-by-default `realtime` config with `/v1/realtime` upgrade handling, Gateway API key auth, API key/namespace permission checks, global/per-node connection limits, idle/session timeouts, and close cleanup.
- `nodes[].realtime_models` and `nodes[].realtime_endpoint` for realtime-capable upstreams, plus config validation and pricing diagnostics.
- Dashboard nodes and `/health` realtime summaries with active connection counts, capability status, last close timestamps, and sanitized errors.
- E2E coverage for realtime auth rejection, safe WebSocket proxying, close release, upstream failure handling, and provider-key redaction.
- v0.6 explainable routing backend trace for the OSS Data Plane, recording why each request selected a `node:model` without storing prompts, responses, raw headers, or provider keys.
- `route_decisions` persistence for SQLite/PostgreSQL plus Dashboard APIs `GET /api/dashboard/route-decisions` and `GET /api/dashboard/route-decisions/:requestId`.
- Route decision trace details for candidate targets, filter reasons, cost/latency/context scores, circuit state, fallback chain, cost downgrade, final selection, and privacy flags.
- Dashboard Route Explanation page with read-only route decision list/detail views, candidate tradeoff tables, filter reasons, fallback context, empty/error states, and deep links from log details.

### Changed

- Structured-output fallback validation now reads canonical request fields first, with raw body fallback for older call paths.
- Dashboard call log details now show structured-output requested status, type, strategy, and unsupported markers.

## 0.5.0 - 2026-05-02

### Added

- v0.5 optional Redis shared state backend for circuit breakers, rate limits, prompt cache, and routing momentum while keeping memory as the default backend.
- `state.backend`, `state.unavailable_policy`, and `state.redis` configuration with validation, Docker Compose Redis profile, and shared state docs.
- Unit coverage for memory/Redis state behavior, Redis fail-open/fail-closed rate limiting, circuit hash writes, prompt-cache Redis entries, and momentum sorted-set writes.
- v0.5 PostgreSQL production migration path for the OSS Data Plane via `siftgate migrate-db --from sqlite --to postgres`.
- SQLite-to-PostgreSQL migrator with dry-run inspection, optional SQLite backup, non-empty target protection, row-count validation, sequence reset, and secret-redacted reports.
- Production deployment documentation covering PostgreSQL recommendation, TypeORM schema strategy, Docker Compose PostgreSQL profile, and SQLite migration workflow.
- v0.5 upstream connection pooling for the OSS Data Plane via optional `nodes[].connection` undici per-node dispatchers.
- Keep-alive, pool size, headers timeout, body timeout, and experimental HTTP/2 connection settings for upstream provider calls.
- Upstream benchmark script and performance notes for future forwarding regression checks.
- v0.5 stream cache controls via `cache.stream_cache.enabled`, disabled by default and only storing fully completed deterministic streams for later SSE replay.
- v0.5 local embedding batching via `embedding_batching`, disabled by default, with per-node/model safe grouping, queue limits, cancellation, timeout, and partial-response handling.
- Config validation, unit coverage, and documentation for stream cache and embedding batching safety defaults.
- v0.5 Redis-backed cluster mode for OSS Data Plane instance registration, heartbeats, and config reload broadcasts.
- `GET /cluster/status` for Redis-backed multi-instance inventory and reload broadcast status, enabled only when `state.backend=redis` or `cluster.enabled=true`.
- Config validation, docs, and example config for `state` and `cluster` settings without requiring SiftGate Cloud.
- v0.5 local OSS namespaces for Gateway API keys, with namespace-level node/model restrictions, budgets, rate limits, call-log attribution, and Dashboard filtering.
- v0.5 asynchronous shadow traffic mirroring for sampled successful chat, stream, and embedding requests, disabled by default and shown in a read-only Dashboard view.
- Privacy-safe shadow defaults that avoid storing prompts, responses, raw headers, or provider keys unless local comparison storage is explicitly enabled.
- Config validation, example config, docs, and unit coverage for namespace references, policy intersection, namespace budgets, shadow config, sanitized shadow results, and Dashboard APIs.

### Changed

- Added optional `database.synchronize` configuration so local SQLite development can keep schema sync while production PostgreSQL can run with synchronization disabled.
- Provider forwarding now shares the optional per-node dispatcher across streaming, non-streaming, and embeddings requests while leaving default `fetch` behavior unchanged when no connection pool is configured.

## 0.4.0 - 2026-05-02

### Added

- v0.4 OpenAI-compatible `POST /v1/embeddings` endpoint for the open-source Data Plane.
- Canonical embeddings request/response types, normalizer, provider forwarding, routing, usage, cost, telemetry, and call-log support.
- `nodes[].embedding_models`, optional `nodes[].embeddings_endpoint`, and embedding `model_capabilities[].dimensions` configuration with validation.
- Embedding routing that supports batch input, API key permissions, dimension filtering, circuit state, fallback, concurrency limits, and cost-aware target ranking.
- Unit and e2e coverage for embeddings controller, pipeline, provider client, routing, config validation, OpenAPI, and proxy behavior.
- v0.4 plugin manager CLI via `siftgate plugin install/list/remove`.
- Local path and npm package plugin installation with initial `@siftgate/plugin-*` registry scope support.
- `plugins.config.yaml` declaration management so plugin installs do not rewrite `gateway.config.yaml`.
- Plugin version and SiftGate gateway compatibility checks using package metadata.
- Runtime plugin loader support for `plugins.config.yaml` and npm package resolution through `node_modules`.
- v0.4 official runtime plugin batch: `redis-cache`, `analytics-sink`, `request-transform`, and `guardrails`.
- Plugin READMEs, example configs, safety notes, and official plugin documentation under `docs/plugins`.
- Unit coverage for official plugin behavior plus plugin loader and hook executor edge cases.
- v0.4 LiteLLM migration CLI via `siftgate migrate --from litellm --config ./litellm_config.yaml`.
- LiteLLM YAML migration for model names, provider/model mapping, API key environment references, fallbacks, router retry settings, known routing strategies, and optional pricing.
- Human and JSON migration reports covering compatible, incompatible, and manual-review items.
- LiteLLM migration fixtures and unit coverage.
- v0.4 lightweight TypeScript SDK scaffold in `packages/client` with typed helpers for models, chat completions, responses, messages, embeddings, routing hints, raw response access, and Gateway API key auth.
- TypeScript SDK package scripts and tests for build, typecheck, endpoint routing, errors, and request typing.
- Python SDK design document covering planned client shape, auth, routing hints, errors, and streaming approach without implementing a Python package.

### Changed

- Plugin loader now resolves `plugins/<name>` directory declarations to `index.ts` in development, matching production `dist-runtime-plugins` behavior and avoiding duplicate loads.

## 0.3.0 - 2026-05-02

### Added

- v0.3 automatic routing optimization with `routing.optimization` modes `cost`, `latency`, `balanced`, and `quality`.
- Node/model routing capability metadata for `max_context_tokens`, `structured_output`, `quality_score`, and optional per-node/model `pricing` overrides.
- Local request token estimation for automatic routing, including messages, tools, and output budget.
- Context-window aware routing that removes targets whose configured window is too small and demotes targets above 80% of their window behind longer-context alternatives.
- v0.3 fallback policy controls via `routing.fallback_policy` for 429 immediate fallback, timeout fallback, structured-output parse/schema fallback, and cost downgrade.
- `fallback_reason` in call logs, Dashboard log details/exports/SSE payloads, OpenTelemetry fallback metrics, and optional control-plane telemetry metadata.
- Structured-output validation for OpenAI `response_format` and Responses `text.format` requests, with conservative stream behavior that never falls back after SSE has started.
- v0.3 adaptive routing recommendation mode for the open-source Data Plane.
- Local sliding-window node:model stats for success rate, p50/p95 latency, cost, and fallback rate.
- Read-only Dashboard routing recommendations with reasons, confidence, potential savings, and risk notes.
- `GET /api/dashboard/routing/recommendations` for local recommendation evidence without mutating routing config.
- v0.3 local webhook alerts via `alerts.channels` for budget, node health, circuit breaker, error spike, and latency spike events.
- Asynchronous alert delivery with per-channel debounce, retry, timeout, sanitized payloads, and Dashboard delivery status.
- Config validation and documentation for webhook alert channels and spike detector rules.
- v0.3 external log sinks via `logging.sinks`, with JSONL file output, webhook batches, and a minimal Elasticsearch bulk exporter.
- Asynchronous per-sink batching, retry, max queue, overflow handling, and sanitized field allow/deny filtering for exported call logs.
- Config validation and documentation for external log sink settings, with S3 reserved as an interface placeholder.
- v0.3 business Prometheus metrics through the existing OpenTelemetry exporter for requests, latency, tokens, cost, fallback, cache hit/miss, budget usage, concurrency, and circuit breaker state.
- Low-cardinality metric labels that avoid API key names/IDs, prompts, responses, provider keys, and raw headers.
- Unit coverage for telemetry helpers, pipeline metric recording, budget gauge aggregation, concurrency gauges, and circuit breaker gauges.

### Changed

- Direct model routing now preserves caller intent by returning a clear 400 when the selected direct target has a configured context window that cannot fit the estimated request, instead of silently rerouting.
- Cost accounting can prefer node/model pricing overrides before falling back to `models_pricing`.
- Chat Completions and Responses normalization now preserves raw request bodies so fallback policies can inspect structured-output intent.
- Provider timeouts are surfaced as explicit timeout failures for routing and logging.

## 0.2.0 - 2026-05-02

### Added

- v0.2 config validation CLI via `siftgate validate` and `npm run validate:config`, with grouped errors, warnings, info, CI-safe exit codes, JSON output, and shared ConfigService diagnostics.
- Config validation docs and fixtures covering YAML parse failures, routing reference integrity, split weights, pricing warnings, environment reference format, and optional control-plane safety checks.
- Added per-node upstream concurrency limits with `max_concurrency`, `queue_timeout_ms`, and `queue_policy` (`wait`, `fallback`, `reject`).
- Added health, dashboard API, and OpenTelemetry visibility for active concurrency and queue depth.
- Added unit coverage for limiter queueing, fallback/reject overflow behavior, slot release on success/failure, streaming completion, streaming interruption, and fallback paths.
- Added atomic configuration reload snapshots with rollback on parse or validation failure.
- Added `SIGHUP` reload support, optional `hot_reload.watch` file watching with debounce, and EventBus topics `config.reload.success` / `config.reload.failed`.
- Added reload-aware budget and optional control-plane synchronization so runtime services use the latest committed config.
- Added optional per-node active health probing with `enabled`, `interval_seconds`, `timeout_ms`, `method`, `path`, and `lightweight_model` configuration.
- Added probe-to-circuit-breaker integration so failed probes immediately open node/model circuits and successful probes close recovered circuits.
- Added active probe status, `last_checked_at`, and `failure_reason` to `/health` and Dashboard node responses.
- v0.2 load balancing for OSS Data Plane routing tiers with `targets + strategy` schema supporting `weighted`, `round_robin`, `least_latency`, and `random`.
- Local sliding-window latency feedback for `least_latency` target selection and Dashboard routing status.
- Dashboard routing view for strategy, targets, weights, latency samples, p95, and recent target selection.
- Added v0.2 OpenAPI/Swagger documentation for the OSS Data Plane at `/docs` and `/openapi.json`.
- Documented AI proxy endpoints, health checks, Dashboard APIs, Gateway API key management, and config reload with secret-safe DTO examples.
- Added e2e coverage to verify the OpenAPI endpoints are reachable and do not expose provider keys or dashboard password hashes.

### Changed

- Preserved legacy `primary/fallbacks` routing as `primary_fallback` and documented that `split` overrides `targets` while experiment mode is enabled.
- Config diagnostics now validate `targets` references and warn when `split` and `targets` are both configured.

## 0.1.0 - Open Source Gateway

Initial open-source release target.

### Included

- Multi-protocol ingress for OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages.
- Canonical request/response conversion across supported protocols.
- Smart routing with scoring tiers, domain preferences, fallbacks, retry, circuit breaker, momentum, and A/B split support.
- Gateway API keys with per-key permissions, budgets, rate limits, rotation, and dashboard management.
- Cost, token, latency, log, cache, node health, and experiment analytics in the Dashboard.
- Prompt cache, plugin hooks, OpenTelemetry, Docker quickstart, and Docker smoke test.

### Added For Roadmap

- Optional Connected Gateway configuration for future hosted control-plane integration.
- Privacy-preserving control-plane metadata uploader scaffold, disabled by default.
- Open-core positioning and comparison documentation.
