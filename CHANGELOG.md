# Changelog

## Unreleased

### Added

- Added optional per-node active health probing with `enabled`, `interval_seconds`, `timeout_ms`, `method`, `path`, and `lightweight_model` configuration.
- Added probe-to-circuit-breaker integration so failed probes immediately open node/model circuits and successful probes close recovered circuits.
- Added active probe status, `last_checked_at`, and `failure_reason` to `/health` and Dashboard node responses.

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
