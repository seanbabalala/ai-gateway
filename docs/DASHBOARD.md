# Dashboard

The SiftGate Dashboard is part of the MIT open-source Data Plane. It runs from the same gateway process, stores local metadata in SQLite by default, and does not require SiftGate Cloud.

v1.9 adds an **Agents** page for Agent Gateway Profiles. It gives Codex, Claude Code, Cherry Studio, Hermes, OpenClaw, Generic OpenAI, and Generic Anthropic clients a clear local setup entry while keeping provider keys in Nodes, env vars, or secret references.

v2.0.0-alpha.1 adds the Workspace Core foundation. The Dashboard header shows the active workspace, reads `GET /api/dashboard/workspaces`, validates switches through `POST /api/dashboard/workspaces/switch`, stores the selected workspace in browser local storage, and sends `x-siftgate-workspace-id` on Dashboard API calls. Fresh and upgraded OSS installs start with `Default Organization` and `Default Workspace`; legacy v1.9 metadata maps to that default workspace.

## Pages

| Page | Purpose |
| --- | --- |
| Overview | Live calls, cost, cache savings, latency, budget, provider health, guardrails finding summary, and recent activity |
| Analytics | Daily cost trends, provider/model breakdowns, provider-cache savings trends, hit-rate rankings, and cost-mix visualization |
| Budget | Global/per-key budget gauges, reset actions, model pricing, and actual-vs-no-cache cost comparison details |
| Playground | Operator-triggered safe probes for chat, responses, messages, embeddings, rerank, images, audio, video, and realtime capability checks |
| Agents | Agent Profiles for Codex, Claude Code, Cherry Studio, Hermes, OpenClaw, Generic OpenAI, and Generic Anthropic setup with redacted render snippets |
| MCP Gateway | Local MCP servers, static tool metadata, recent metadata-only calls, and error summaries |
| Nodes | Upstream node health, configured-upstream vs catalog-onboarding views, resolved compatibility profiles, compatibility matrix, active probes, realtime status, and Add Node wizard |
| Provider Catalog | Merged provider projection with provider status, canonical/pricing coverage, compatibility profiles, enrichment metadata, recommended model defaults, price source status, scheduled sync status, refresh sources, modality coverage, and provider identity |
| Routing | Tiers, fallback chains, load-balancing targets, adaptive recommendations, and local routing config edits |
| Route Explanation | Privacy-safe route decision traces showing candidate targets, filters, cost/latency/context tradeoffs, multimodal evidence, compatibility evidence, and reasoning support |
| Sessions | Metadata-only request timelines grouped by `session_id` / legacy `session_key`, with model switches, fallback, errors, cost, latency, shadow, guardrails, and Route Explanation links |
| Logs | Request metadata, source format, route result, local/provider cache outcome, compatibility summary, structured-output intent, reasoning intent, fallback reason, per-request cache-savings evidence, and export-safe call details |
| API Keys | Local Gateway API key create/edit/disable/delete/rotate, one-time full-key copy, masked list values, namespace binding, endpoint/modality/node/model restrictions, budgets, rate limits, and usage summaries |
| Shadow | Read-only primary vs shadow reports with success, latency, cost, token, fallback, confidence, and risk evidence |
| Benchmarks | Local call-log performance evidence with latency percentiles, status/source breakdowns, cost/token summaries, and methodology notes |
| Batch Jobs | Read-only OpenAI-compatible Batch status, provider batch ids, file ids, request counts, API key/namespace scope, and sanitized errors without local file-content storage |
| Config Audit | Sanitized config versions, audit events, and validation-first rollback |

## Provider Catalog UX

The Provider Catalog page is a read-only operations explorer for large provider catalogs. It uses `GET /api/dashboard/catalog/providers` and does not keep a separate provider/model list in React components.

v1.4 adds summary cards, provider-family groups, collapsed provider lists, and filters for family, modality, provider type, price source status, compatibility profile, review-required state, stale pricing, and provider/model aliases. Provider rows show logo identity, modalities, primary endpoints, compatibility profile, price source status, last-updated metadata, manual-review state, model count, override state, and sync state when present.

In v1.8, Provider Catalog detail also surfaces the normalized catalog truth in a constrained way: provider status, default visibility, canonical/pricing coverage, fresh default model groups, release date, max context, throughput, and a few high-value benchmark snippets when available. It stays focused on setup and governance rather than becoming a benchmark leaderboard.

The detail panel shows homepage/docs/pricing links, auth type, base URL, endpoint map, model buckets, capability flags, limits, pricing units, override state, sync status, enrichment summaries, and catalog-truth copy that explains OpenRouter canonical pricing is a reference and ZeroEval is a secondary review-required reference. It remains metadata-only and never exposes provider API keys, raw headers, prompts, responses, media bytes, or generated video bytes.

The Add Node Wizard uses the same catalog response for provider presets. The provider step supports family filters and alias search such as Kimi/Moonshot, Qwen/Tongyi, and Doubao/Volcengine while keeping advanced endpoint, headers, model aliases, prefixes, pricing, compatibility profile, health check, and custom-provider fields available before save.

v1.8 changes the defaulting behavior behind that same flow:

- the wizard still has the full model list for search and manual edits
- the default buckets now come from backend `recommended_model_buckets` derived from canonical projection
- provider cards default to active providers only; transport-only, deprecated, and legacy rows stay behind an explicit legacy toggle
- provider cards and model steps can show "latest recommended" style guidance, status badges, coverage signals, and trust copy
- default pricing rows are seeded from recommended models first
- trust copy clarifies that catalog enrichment pricing is a review-required default reference and explicit operator pricing still wins

## Nodes UX

In v1.8, the Nodes page no longer treats catalog onboarding and configured runtime state as the same thing:

- `Catalog Onboarding` highlights active providers that are not configured yet and shows their canonical/pricing coverage plus recommended models
- `Configured Upstreams` focuses on actual runtime nodes, then adds catalog match, status, and trust signals only when a clean provider mapping exists
- operator-defined custom nodes remain editable without pretending they are canonical catalog rows
- deprecated / transport-only / legacy provider rows are not promoted into the default onboarding path

## Cache Savings Analytics

The Dashboard Overview now uses the provider-cache savings summary to show how much spend was avoided during the active window because the upstream provider returned cache-read tokens instead of billing everything as normal input. The KPI keeps local prompt-cache and semantic-cache short-circuit hits separate from provider-side cache savings.

The Analytics page reads `GET /api/dashboard/cache-savings` to render daily savings trends, provider-cache hit-rate trends, provider/model savings rankings, and a stacked cost mix for normal input, cache read, cache write, and output cost. These views are derived from privacy-safe call-log metadata only.

Logs rows add a Provider Cache badge when a provider-routed request reports `cache_read_input_tokens > 0`. The tooltip and detail panel compare `cost_usd` with `cost_without_cache_usd`, so operators can inspect per-request savings without exposing prompts, responses, raw headers, or provider keys. The Budget page reuses the same data to explain that actual spend already includes provider-cache discounts.

## API Key Safety

Gateway API keys are client credentials generated by the Dashboard. Provider API keys remain in `gateway.config.yaml`, `.env`, or an enabled secret reference backend and are used only by SiftGate when it calls upstream providers.

Dashboard API key create and rotate responses show the full key once. After that, the Dashboard and APIs only return masked prefixes and permission metadata. Mutating API key operations write config audit events with redacted summaries and never store the one-time secret.

## Agent Profiles Safety

The **Agents** page reads and writes `/api/dashboard/agent-profiles`. Profiles store local setup metadata for agent and chatbot clients, including connector type, optional Gateway API key binding, optional namespace binding, default model, smart model id, base URL mode, advisory routing hint JSON, and optional MCP server ids.

Rendered configs are intentionally redacted. The Dashboard shows a Gateway API key placeholder for agents and chatbots, plus masked key metadata when a profile is bound to an existing key. It does not expose stored Gateway API key plaintext, provider API keys, raw auth headers, prompts, responses, MCP tool payloads, media bytes, or video bytes.

Smart router uses `auto` or a connector-safe virtual model such as `claude-siftgate-auto`. That virtual model is profile-scoped and maps to internal `auto` only for a matching active profile and Gateway API key. Smart routing still requires `allow_auto`; direct model routing still requires `allow_direct`.

Routing hints are advisory. Gateway API key policies, namespaces, local teams, budgets, rate limits, allowed endpoints, allowed models, allowed nodes, allowed modalities, circuit state, and fallback rules remain authoritative.

## Playground Safety

The Playground calls `POST /api/dashboard/playground/run` through the Dashboard session. It can apply a selected local Gateway API key by id, namespace restriction, model, endpoint, stream toggle, and routing hint, but the browser never receives the plaintext Gateway API key or any provider key.

Default samples are intentionally tiny and synthetic. Realtime is a probe-only capability check; it does not open a WebSocket session. Playground request and response previews are returned to the current Dashboard view only. Normal call logs keep the same metadata as regular gateway traffic, including route decision ids when available, but Playground does not add a raw prompt/response/media store.

## MCP Gateway Safety

The MCP Gateway page reads `GET /api/dashboard/mcp`. It is read-only and only displays local config registry metadata plus recent in-memory audit metadata. It does not call tools from the browser and cannot modify MCP server config.

The MCP preview stores server id/name, method, tool name, API key id/name, namespace, HTTP status, latency, byte size, and sanitized error type. It does not store MCP tool arguments, tool results, raw headers, provider keys, resolved secret values, media bytes, or marketplace metadata.

## Batch Jobs

The Batch Jobs page reads `GET /api/dashboard/batches` and stays read-only. It shows provider batch id, selected node/model hint, endpoint, input/output/error file ids, completion window, request counts, status, API key/namespace attribution, and sanitized error text. It does not show or persist batch input JSONL, provider output JSONL, raw headers, provider keys, or file bytes; result download routes proxy content on demand through `/v1/batches/:id/output` or `/v1/batches/:id/errors`.

## Session Traceability

Applications can pass `x-session-id`, legacy `x-session-key`, `x-siftgate-session-id`, `x-trace-id`, `x-siftgate-trace-id`, or standard W3C `traceparent` headers. SiftGate records only the identifiers and operational metadata. The Session View does not persist prompt text, response text, raw authorization headers, provider keys, uploaded media, or generated video bytes.

The page is read-only. It helps operators understand when a session changed models, fell back, hit shadow traffic, produced guardrails findings, or has a route-decision trace available. It does not change routing policy or replay traffic.

## Provider Compatibility

v1.4 Provider Compatibility Profiles are shown consistently across Provider Catalog, Nodes, Route Explanation, and Logs. Profiles describe provider protocol behavior such as request style, response style, endpoint strategy, streaming, multipart, async jobs, supported source formats, supported modalities, passthrough fields, downgraded fields, unsupported fields, and known limitations.

The Add Node Wizard reads suggested profiles from the catalog API and lets operators set `compatibility_profile` for custom gateways or local model servers. Provider Catalog and Node detail pages show profiles as read-only metadata. They do not modify routing config from detail pages.

The Provider Compatibility Matrix uses profiles to choose safe probes for chat, responses, messages, embeddings, rerank, images, audio, video, realtime, and batch. Text-like probes use tiny synthetic inputs. Media, video, realtime, and batch probes default to endpoint/auth checks.

Route Explanation displays why a provider was selected or filtered by profile, including source-format support, modality support, endpoint strategy, protocol strategy, and fields that were passed through, downgraded, or unsupported. Logs detail shows a compact compatibility summary. Neither view stores or exposes prompts, responses, raw headers, provider keys, media bytes, or video bytes.

## Localization

Dashboard copy is maintained in seven languages: English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Thai, and Spanish. New Dashboard features should add product-aware localized labels rather than raw backend field translations.

## Open-Source Boundary

The Dashboard manages the local Data Plane only. Workspace Core in v2.0.0-alpha.1 is the OSS ownership boundary for local metadata. It does not include enterprise RBAC, SSO, SCIM, organization billing, the public website, or private Cloud dashboard code.
