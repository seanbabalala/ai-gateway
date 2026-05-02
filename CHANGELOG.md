# Changelog

## Unreleased

### Added

- Added v0.3 adaptive routing recommendation mode for the open-source Data Plane.
- Added local sliding-window node:model stats for success rate, p50/p95 latency, cost, and fallback rate.
- Added read-only Dashboard routing recommendations with reasons, confidence, potential savings, and risk notes.
- Added `GET /api/dashboard/routing/recommendations` for local recommendation evidence without mutating routing config.

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
