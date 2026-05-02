# Changelog

## Unreleased

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
