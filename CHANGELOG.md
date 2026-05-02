# Changelog

## Unreleased

### Added

- v0.4 lightweight TypeScript SDK scaffold in `packages/client` with typed helpers for models, chat completions, responses, messages, embeddings, routing hints, raw response access, and Gateway API key auth.
- TypeScript SDK package scripts and tests for build, typecheck, endpoint routing, errors, and request typing.
- Python SDK design document covering planned client shape, auth, routing hints, errors, and streaming approach without implementing a Python package.

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
