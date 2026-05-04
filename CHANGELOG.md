# Changelog

## Unreleased

### Added

- Added v1.2 prompt-cache-aware routing evidence for the OSS Data Plane. Routing now records local prompt-cache lookup state, provider prompt-cache/read-cache/write-cache capability, observed provider cache-read hit rate, cache read/write token counters, cache-adjusted cost estimates, and cache savings in Route Decision Trace without storing prompts, responses, raw headers, provider keys, media bytes, or video bytes.
- Added cache-aware Dashboard Route Explanation evidence, Logs cache routing-effect copy, and Benchmark cache-impact summaries with 7-language localization.
- Added prompt-cache capability flags (`prompt_cache`, `read_cache`, `write_cache`) to node/model capability schema and cache read/write pricing metadata for model pricing/catalog fallback.

### Changed

- Cost and balanced optimization can prefer provider paths with lower cache-read prices or observed provider cache hits while preserving the existing local prompt cache short-circuit behavior.
- Benchmark cache rates now include local prompt-cache hits and provider cache-read hits, with separate provider/local breakdowns in `cache_summary`.

## 1.1.0 - 2026-05-05

### Added

- Added the v1.1 lightweight Python SDK scaffold under `packages/python`, with a stdlib-only synchronous `SiftGateClient`, typed package metadata, Gateway API key auth, routing hints, structured errors, raw response access, and helpers for models, chat completions, responses, messages, embeddings, rerank, images, audio, and async video jobs.
- Added Python SDK unit tests and the root `npm run test:python-sdk` quality-gate script for local package verification without publishing to PyPI.
- Added a v1.1 Dashboard Playground page for operator-triggered safe probes across chat, responses, messages, embeddings, rerank, images, audio, video, and realtime capability checks.
- Added `POST /api/dashboard/playground/run`, a dashboard-session protected probe endpoint that can apply a selected Gateway API key and namespace scope without exposing plaintext Gateway API keys to the browser.
- Added Playground result summaries for status, latency, usage, cost, response preview, and Route Decision deep links while keeping prompts, responses, raw headers, provider keys, media bytes, and realtime frames out of Playground persistence by default.
- Added 7-language Dashboard localization and frontend static checks for the Playground route, hook, endpoint coverage, privacy copy, and API types.
- Added v1.1 Session/Trace correlation for the OSS Dashboard, normalizing `session_id`, legacy `session_key`, W3C `traceparent`, and trace headers into call logs and route decision traces.
- Added read-only Dashboard APIs `GET /api/dashboard/sessions` and `GET /api/dashboard/sessions/:sessionId` for metadata-only session timelines across call logs, route decisions, shadow results, and recent guardrails findings.
- Added the Dashboard Session View with 7-language localization, namespace/API key/model/source filters, model-switch/fallback/cost/latency summaries, and deep links into Route Explanation without storing prompts, responses, raw headers, provider keys, or media/video bytes.
- Added runnable v1.1 agent framework examples under `examples/agents` for OpenAI SDK `base_url`, LangChain, CrewAI, and OpenAI Agents SDK.
- Added shared example headers for Gateway API keys, advisory routing hints, local namespace labels, session correlation, trace labels, and structured-output intent without committing real provider keys.
- Added `docs/AGENT_INTEGRATIONS.md` and static coverage to explain how operators inspect agent cost, fallback, route explanation, session correlation, and namespace policy through SiftGate.

## 1.0.0 - 2026-05-05

### Added

- Expanded the built-in Provider / Model Catalog toward v1.0 ecosystem coverage with 30+ providers, adding AWS Bedrock, Alibaba Qwen/Tongyi, Baidu Qianfan/Wenxin, Volcengine Ark/Doubao, Zhipu GLM, Moonshot/Kimi, MiniMax, Tencent Hunyuan, 01.AI/Yi, Replicate, Perplexity, NVIDIA NIM, Cerebras, and SambaNova Cloud.
- Added review-required pricing source metadata for the new providers, including source URLs, `last_updated`, `pricing_confidence`, and manual-review state without using placeholder wording in operator-facing catalog data.
- Added provider identity mappings and tests so new OpenAI-compatible or compatible-style providers do not fall back to the OpenAI logo in Dashboard node/catalog surfaces.
- Added v1.0 canonical reasoning/thinking intent for Chat `reasoning_effort`, Responses `reasoning`, Anthropic Messages `thinking`, and Gemini-style `thinking_config`.
- Added reasoning-aware provider forwarding strategies, routing preference for `supports_reasoning` targets, call-log metadata, external log sink fields, control-plane metadata, and Route Explanation evidence without storing prompts, responses, hidden reasoning text, raw headers, or provider keys.
- Added Dashboard Logs and Route Explanation localization for reasoning intent, effort, budget, strategy, support status, and downgrade notes across all 7 OSS Dashboard languages.
- Upgraded the official guardrails plugin to v1.0 with metadata-only webhook finding delivery, per-rule `webhook` actions, debounce/retry/timeout/max-queue/drop-policy controls, expanded PII, secret/token, jailbreak, unsafe URL, strict schema, and tool-call policy rules.
- Added `GET /api/dashboard/guardrails` and a Dashboard Guardrails summary card showing finding counters and recent webhook state without exposing prompts, responses, matched text, raw headers, provider keys, webhook URLs, webhook headers, media bytes, or video bytes.
- Hardened the OSS Dashboard API Key management surface for v1.0 with local create/edit/disable/delete/rotate flows, one-time full-key copy, masked list values, namespace binding, per-key budgets, per-key rate limits, and status/last-used/calls/cost/error-rate summaries.
- Added API key permission controls for `allowed_endpoints` and `allowed_modalities`, enforced before routing/provider forwarding and reflected in `/v1/models` filtering.
- Added redacted config audit coverage for API key create/update/rotate/delete operations, plus tests to ensure one-time Gateway API key secrets are not persisted in audit metadata.

### Changed

- Dashboard Add Node presets, catalog CLI output, config validation, and legacy catalog diagnostics now recognize the v1.0 provider set while preserving local `catalog.override.yaml` as the path for operator-reviewed model and price overrides.
- Dashboard API key forms and tables now include endpoint/modality permission pickers and 7-language localization for the new controls.
- SQLite-to-PostgreSQL migration now preserves Dashboard-managed API key endpoint and modality permission arrays when present.

## 0.9.3 - 2026-05-05

### Changed

- Improved the Dashboard Provider Catalog refresh-source section with collapsed-by-default source cards, pinned automatic/local override sources, summary badges, and 7-language copy so long provider lists no longer dominate the page.
- Rebalanced the Routing page layout so each tier shows the route lane first and expands load-balancing/split controls across the available width instead of crowding them into a narrow right column.
- Updated Dashboard Logs for the v0.9 surface: source format is visible in the table, route result is separated from upstream node, and prompt-cache hits now display as cache outcomes with no upstream call instead of fake `cached` tiers or `cache` nodes.
- Filtered prompt-cache synthetic rows out of Dashboard tier/node distribution charts while keeping them visible in cache metrics and recent-call activity.

## 0.9.2 - 2026-05-04

### Added

- Added Provider Catalog refresh-source metadata to Dashboard catalog APIs and the CLI, making it clear which providers can be refreshed automatically and which require docs review or local operator overrides.
- Added `siftgate catalog sources` and `siftgate catalog refresh openrouter --out catalog.override.yaml` for generating a local OpenRouter catalog override from the public model API, including prompt/completion pricing converted to USD per 1M tokens.
- Added catalog pricing `source_url` and `retrieved_at` metadata so Dashboard and validation can explain where pricing came from and when it was fetched.

### Changed

- Renamed Dashboard and operator-facing copy from "pricing hygiene" to "price source status" / "价格来源状态" while keeping the internal `pricing_hygiene` API field for compatibility.
- Updated built-in catalog pricing source labels from placeholder wording to review-required reference metadata, avoiding confusing "占位" UI language while still warning operators to verify production prices.
- Improved the Provider Catalog Dashboard layout with wrapped modality filters, stable table widths, horizontal scrolling, clearer source badges, confidence labels, source links, and a refresh-source section.

## 0.9.1 - 2026-05-04

### Fixed

- Dashboard provider icons now resolve from catalog/provider identity, base URL, node name, tags, and model buckets before protocol fallbacks, so Voyage AI, Jina AI, Together AI, Fireworks AI, vLLM, Azure OpenAI, and custom OpenAI-compatible nodes no longer incorrectly show the OpenAI logo.
- Added a provider-logo identity check to the frontend test suite to prevent `chat_completions` or `responses` protocol fallbacks from forcing the OpenAI mark for compatible providers.
- Provider compatibility probes for OpenAI Responses-style upstreams now use a safer minimal `max_output_tokens` value, aligning single-node test responses with the Dashboard compatibility matrix.

## 0.9.0 - 2026-05-04

### Added

- v0.9 local config audit and rollback for the OSS Data Plane with `config_versions` and `config_audit_events` persistence on SQLite/PostgreSQL.
- Dashboard APIs `GET /api/dashboard/config/versions`, `GET /api/dashboard/config/versions/:id`, `POST /api/dashboard/config/versions/:id/rollback`, and `GET /api/dashboard/config/audit-events`.
- Dashboard Config Audit page with sanitized version detail, audit event stream, and confirmation-based rollback.
- Config audit settings under `config_audit` with validation for `enabled`, `max_versions`, `max_events`, and `capture_startup_snapshot`.
- SQLite-to-PostgreSQL migrator coverage for config version and audit event tables.
- Unit coverage for config audit redaction, rollback success, rollback failure, Dashboard APIs, config validation, and migration.
- v0.9 optional Secret Manager reference support for the OSS Data Plane, with runtime `${env:...}`, `${vault:...}`, `${aws-sm:...}`, and `${gcp-sm:...}` references.
- `SecretReferenceResolverService` with local TTL cache, `fail_closed` / `fail_open_for_optional` behavior, SDK-less Vault/AWS/GCP HTTP adapters, and explicit backend enablement.
- Secret-reference support for provider `nodes[].api_key`, node headers, active health probes, realtime upstream auth, video provider proxy routes, provider compatibility tests, and optional control-plane registration tokens.
- Config validation diagnostics for malformed references, disabled backends, unset env values, secret-manager shape, and secret-like catalog override values.
- Secret management documentation and example configuration.
- v0.9 Shadow Traffic Comparison Report for the OSS Data Plane, adding read-only Dashboard/API comparisons for primary vs shadow success rate, p50/p95 latency, cost delta, potential savings, token delta, fallback delta, quality sample coverage, confidence, and risk notes.
- Dashboard Shadow filters for namespace, API key, node, model, period, and source format, plus localized overview cards and primary-to-shadow comparison tables without any automatic routing changes.
- Privacy-safe shadow report APIs `GET /api/dashboard/shadow/report` and `GET /api/dashboard/shadow/results/:id/comparison`, paired with call logs by `request_id` and never returning raw headers, provider keys, media bytes, or video bytes.
- v0.9 official guardrails plugin upgrade for the OSS Data Plane, replacing the skeleton with disabled-by-default local PII detection/redaction/blocking, lightweight prompt-injection checks, schema validation helpers, named allow/block/redact policies, input/output hooks, and conservative streaming delta handling.
- Privacy-safe guardrails findings in the per-request plugin store, capped by `max_findings_per_request` and limited to metadata such as request id, rule, kind, action, count, and path without prompt text, response text, raw headers, provider keys, media bytes, or video bytes.
- Unit coverage for guardrails privacy behavior, PII redaction/blocking, prompt-injection blocking, schema validation, allow/block policy exceptions, stream delta handling, and hook executor store propagation.
- v0.9 OSS-only Helm chart under `deploy/helm/siftgate` with default single-node SQLite + memory state behavior and opt-in Redis, PostgreSQL, Ingress, HPA, PodDisruptionBudget, ServiceMonitor, existing Secret/ConfigMap, resources, and persistence settings.
- v0.9 Kustomize/plain Kubernetes base under `deploy/kubernetes/base` with placeholder-only Secrets, SQLite PVC, config mount, health probes, and no SiftGate Cloud or enterprise image dependency.
- `npm run validate:k8s` plus manifest validation tests for YAML parsing, required deployment assets, default Cloud-disabled behavior, secret hygiene, image/port checks, and config/data mounts.
- v0.9 Benchmark Report API `GET /api/dashboard/benchmarks/report` for local call-log performance evidence, including success/error/fallback/cache rates, p50/p75/p95/p99 latency, throughput estimate, cost/token summaries, status-code distribution, node:model breakdowns, source-format/source-family breakdowns, and route-trace coverage.
- Read-only Dashboard Benchmarks page with period, namespace, API key, node, model, and source-format filters plus methodology notes that warn against treating local samples as strict cloud benchmarks.
- `npm run benchmark:upstream` JSON report output via `GATEWAY_BENCH_OUTPUT=report.json`, with p75 latency, top sanitized errors, labels, and methodology metadata.
- v0.9 compatibility migration expansion for the OSS Data Plane: `siftgate migrate` now imports LiteLLM, New API, and One API configs into SiftGate and exports SiftGate configs to LiteLLM/New API/One API scaffold YAML.
- Migration reports now include compatible, partially supported, unsupported, manual actions, provider/model mapping notes, and pricing/capability confidence.
- New migration fixtures and tests for LiteLLM, New API, One API, SiftGate v0.8 model buckets, reverse scaffold export, and overwrite protection.
- v0.9 Provider Catalog pricing hygiene for the OSS Data Plane, extending the v0.8 catalog instead of introducing a second model catalog.
- Catalog pricing metadata now includes currency, modality-specific price/unit fields, `stale_after_days`, and `pricing_confidence`.
- Dashboard Provider Catalog page showing pricing freshness, manual-review state, source, confidence, and override markers in the 7-language operator UI.
- `siftgate catalog validate --pricing` and `siftgate catalog export --include-pricing` for local pricing hygiene workflows without online updates.

### Changed

- Dashboard config reload, node create/update/delete, routing edits, and Dashboard-managed API key mutations now record local audit metadata when config audit is enabled.
- Rollback snapshots store redacted safe YAML and rehydrate secrets only from matching current local config fields; unresolved redactions fail safely without writing the config file.
- Runtime config loading now preserves typed secret references such as `${env:OPENAI_API_KEY}` for request-time resolution while keeping legacy `${OPENAI_API_KEY}` startup interpolation compatible.
- Dashboard sanitized config keeps secret references visible as references, masks literal provider keys and sensitive headers, and never resolves secrets for display.
- Explicit shadow prompt/response sample storage now applies built-in redaction and `shadow.compare.sample_max_chars` truncation, and config validation warnings now call out the storage risk more clearly.
- `siftgate migrate` now supports `--to` and `--force`; `--overwrite` remains a backward-compatible alias.
- Cost-aware routing and cost accounting can fall back to merged Provider Catalog pricing when explicit node/model pricing and `models_pricing` are absent; explicit user config always wins.
- Config validation now warns for placeholder, stale, missing, and modality-unit-mismatched catalog pricing, including `routing.optimization=cost` cases with insufficient prices.

## 0.8.0 - 2026-05-04

### Added

- v0.8 local Provider / Model Catalog for the OSS Data Plane, covering provider metadata, models, modalities, endpoints, auth type, pricing source, capabilities, and limits.
- Built-in static catalog entries for OpenAI, Anthropic, Google Gemini/Vertex, Azure OpenAI, OpenRouter, Groq, Mistral, DeepSeek, xAI, Cohere, Voyage, Jina, Together, Fireworks, Ollama, vLLM, and OpenAI-compatible custom providers.
- Dashboard catalog APIs `GET /api/dashboard/catalog/providers` and `GET /api/dashboard/catalog/models` with provider/modality/endpoint filters and built-in + local override merge metadata.
- Config validation warnings for catalog unknown models, endpoint/modality mismatches, and placeholder pricing that still needs operator review.
- v0.8 Dashboard Add Node wizard backed by the local catalog, with provider/proxy/custom selection, capability selection, model bucket editing, endpoint/auth/header/pricing confirmation, and connection test/save flow.
- `nodes[].video_models`, `video_generations_endpoint`, and `video_status_endpoint` config surface for video-capable providers and the experimental async video gateway preview.
- v0.8 media endpoint hardening for the OSS Data Plane with OpenAI-compatible `POST /v1/images/variations` and `POST /v1/audio/translations`.
- Canonical media metadata for images/audio requests: media type, operation, multipart flag, file count, byte size, requested format, response format, and provider response content type.
- Dashboard call-log visibility, CSV/JSON export fields, external log sink fields, and optional connected-gateway telemetry metadata for media operations without storing file contents.
- Node config support for `images_variations_endpoint` and `audio_translations_endpoint`, plus validation and OpenAPI docs for the new media endpoints.
- v0.8 provider compatibility test matrix for the OSS Data Plane Dashboard, covering chat, responses, messages, embeddings, rerank, images, audio, video, and realtime capabilities.
- Local `provider_compatibility_results` metadata storage for configured/tested state, last status, timestamp, latency, HTTP status, and sanitized failure reason without storing prompts, responses, raw headers, provider keys, media bytes, or realtime frames.
- Safe provider test policy: tiny synthetic requests for text/embedding/rerank and endpoint/auth probes for media, video, and realtime by default.
- Dashboard Nodes compatibility matrix, safe test action, and non-blocking compatibility diagnostics.
- Experimental video capability config fields (`video_models`, `video_endpoint`, `video_status_endpoint`, `video_content_endpoint`, `video_cancel_endpoint`) for provider compatibility checks and future async video routing.
- `siftgate catalog list/show/validate/export/import` plus `npm run catalog` for managing `catalog.override.yaml` without network updates.
- Config validation warnings for secret-like catalog override fields/values.
- v0.8 multimodal route decision evidence for image, audio, video, rerank, and embedding requests.
- Route Decision Trace `modality_evidence` and per-candidate `capability_evidence` covering requested modality, input/output types, file count, byte size, required capabilities, capability/file-size filters, endpoint strategy/status, pricing source, and catalog source.
- Dashboard Route Explanation capability badges, endpoint status, pricing/catalog source badges, and 7-language localization for the new read-only evidence.
- Unit coverage for routing trace evidence, pipeline trace persistence, and Dashboard route decision API shape.
- Experimental async video generation preview with `POST /v1/videos/generations`, status/content/cancel routes, video route evidence, and local `video_jobs` metadata storage that does not persist prompts, source media, or video bytes.

### Changed

- Dashboard Add Node provider presets now load from the catalog API instead of a hardcoded frontend list.
- Dashboard Add Node now supports `models`, `embedding_models`, `rerank_models`, `image_models`, `audio_models`, `video_models`, and `realtime_models` in one localized wizard while preserving advanced local Data Plane fields.
- Config validation now allows specialized-only nodes with `models: []` when embedding/rerank/media/realtime model buckets are configured.
- Images/audio ingress now documents production pass-through behavior for JSON and multipart requests across generations, edits, variations, transcriptions, translations, and speech.
- `gateway.config.yaml` now supports optional `catalog.override_file` while keeping the static built-in catalog as the default.

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
