# Changelog

## Unreleased

### Added

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
