# Provider / Model Catalog And Compatibility

SiftGate v0.8 adds a local Provider / Model Catalog for the open-source Data Plane. v0.9 extends that same catalog with price source metadata and cost-routing fallback. v0.9.2 adds a safe refresh workflow for providers with stable public catalog APIs. v1.0 expands the built-in catalog to 30+ providers. v1.4 expands that same catalog to 50+ providers, adds governance metadata for provider family/category, provider type, logo identity, input/output types, model buckets, batch capability metadata, and compatibility profiles, and unifies pricing source governance so Dashboard, routing, benchmark reports, config validation, CLI export, sync cache, local overrides, route explanation, and provider compatibility checks all read the same catalog/pricing/compatibility evidence.

The important product rule is honesty: built-in provider/model/pricing data is a reference snapshot, not a billing authority. SiftGate can refresh OpenRouter model and pricing metadata from its public API, but many providers publish prices only in docs or vary prices by region, deployment, account, or private model name. Those entries remain marked for review until you import a local override.

## Goals

- Keep provider/model knowledge out of Dashboard form components.
- Give config validation enough context to warn about likely model, pricing, endpoint, and modality mistakes.
- Provide one shared vocabulary for text, vision, image, audio, video, embedding, rerank, realtime, and batch routing work.
- Provide one shared prompt-cache vocabulary for provider `prompt_cache`, `read_cache`, `write_cache`, and cache read/write token prices.
- Provide one shared compatibility vocabulary for source formats, modalities, protocol strategy, passthrough fields, downgraded fields, and unsupported fields.
- Preserve single-node memory/SQLite defaults. Redis, Postgres, and Cloud are not required.

## Dashboard APIs

```http
GET /api/dashboard/catalog/providers
GET /api/dashboard/catalog/models
GET /api/dashboard/catalog/models?provider=openai
GET /api/dashboard/catalog/models?modality=embedding
GET /api/dashboard/catalog/models?endpoint=rerank
```

Responses include merged built-in + override metadata:

```json
{
  "override_file": "/path/to/catalog.override.yaml",
  "override_found": false,
  "issues": []
}
```

Provider and model rows include `overridden` markers when local override data replaced or added fields.

Dashboard provider rows also include operator-facing fields derived from the merged catalog:

| Field | Purpose |
| --- | --- |
| `family` / `category` | Groups providers into Foundation Models, Aggregators, Cloud Platforms, China Providers, Self-hosted / Local, Image / Video, Speech / Audio, and Embedding / Rerank. |
| `provider_type` | Distinguishes direct, aggregator, cloud, self-hosted, media, speech, local, compatible, and custom providers. |
| `compatibility_profile` | Shows whether the provider is native, OpenAI-compatible, Anthropic-compatible, Google-compatible, local, or custom. |
| `aliases` | Search hints such as `kimi`, `moonshot`, `qwen`, `tongyi`, `doubao`, or `volcengine`; these are for Dashboard search, not routing aliases. |
| `logo_id` | Provider identity hint used by Dashboard rows, Nodes, Logs, and Route Explanation. |
| `homepage_url`, `docs_url`, `pricing_url` | Safe public links for operator review. |
| `model_buckets` | Catalog-derived `models`, `embedding_models`, `rerank_models`, `image_models`, `audio_models`, `video_models`, `realtime_models`, and `batch_models`. |
| `limits` / `pricing_units` | Summaries for detail panels and validation UI. |

Dashboard also includes a read-only Provider Catalog page. It shows price source status, source URL, manual-review state, confidence, override state, refresh-source availability, modality coverage, provider family/type filters, compatibility filters, stale/review quick filters, and provider detail panels without changing routing or node config.

## v1.4 Provider Families And Types

v1.4 adds catalog governance fields so provider data stays useful across Dashboard forms, CLI validation, routing evidence, and documentation:

- `family` / `category`: human-readable grouping such as `foundation_model`, `china_provider`, `cloud_platform`, `aggregator`, `media`, `speech_audio`, `self_hosted`, or `custom`.
- `provider_type`: machine-readable type: `direct`, `aggregator`, `cloud`, `self_hosted`, `media`, `speech`, or `local`.
- `aliases`: search hints for Dashboard Add Node and CLI lookup, including common brand names, product names, and localized provider names.
- `logo_id`: Dashboard identity key. Compatible providers use their own identity or a branded local badge, not the OpenAI logo.
- `homepage_url`, `docs_url`, `pricing_url`: operator review links. They are references, not live billing data.
- `input_types` / `output_types`: normalized routing evidence such as `text`, `image`, `audio`, `video`, `file`, `events`, `embedding`, and `ranked_documents`.
- `model_buckets`: suggested model lists for `models`, `embedding_models`, `rerank_models`, `image_models`, `audio_models`, `video_models`, `realtime_models`, and `batch_models`.
- `compatibility_profile`: a compact hint such as `openai_compatible`, `anthropic_messages_compatible`, `aws_bedrock_converse`, `media_generation_async`, `speech_compatible`, or `openai_compatible_local`.

The built-in catalog now covers 50+ providers across these groups:

| Family | Examples |
| --- | --- |
| Direct foundation model APIs | OpenAI, Anthropic, Google Gemini / Vertex, Mistral, DeepSeek, xAI, Cohere, AI21 Labs |
| China providers | Alibaba Qwen / DashScope, Baidu Qianfan / Wenxin, Volcengine Ark / Doubao, Zhipu GLM, Moonshot / Kimi, MiniMax, Tencent Hunyuan, 01.AI / Yi |
| Aggregators and marketplaces | OpenRouter, Hugging Face Inference Providers, Replicate, Together AI, Fireworks AI, NVIDIA NIM |
| Cloud and managed platforms | AWS Bedrock, Azure OpenAI, Cloudflare Workers AI, IBM watsonx.ai |
| Media generation providers | fal.ai, Stability AI, Black Forest Labs, Ideogram, Luma AI, Runway, Pika |
| Speech/audio providers | ElevenLabs, Deepgram, AssemblyAI, Cartesia, Speechmatics, Voyage AI, Jina AI |
| Local and self-hosted runtimes | Ollama, vLLM, LM Studio, llama.cpp server, Text Generation Inference / TGI, SGLang, Xinference, Baseten, Lepton AI, Modal, RunPod, Predibase, Lamini |

v1.4 provider rows also include `compatibility_profiles`, and the providers response includes a `compatibility_profiles` registry. Dashboard uses these values for Provider Catalog detail, Add Node Wizard defaults, Node identity, and Route Explanation labels. The registry is local metadata and does not trigger provider network checks by itself.

## Dashboard Add Node Wizard

v0.8 uses the catalog as the source of truth for the Dashboard Add Node flow. The wizard no longer keeps a separate provider/model list inside the React form.

The OSS Data Plane wizard saves only local `gateway.config.yaml` node fields:

1. Choose a provider, OpenAI-compatible proxy, or custom upstream.
2. Select endpoint capabilities: Chat, Responses, Messages, Embeddings, Rerank, Images, Audio, Video, and Realtime.
3. Pick or edit model buckets: `models`, `embedding_models`, `rerank_models`, `image_models`, `audio_models`, `video_models`, `realtime_models`, and catalog `batch_models` metadata.
4. Confirm `base_url`, native protocol endpoint, per-capability endpoints, auth type, custom headers, aliases, prefixes, model pricing overrides, routing capability tags, health probe, and concurrency/queue controls.
5. Run a safe connectivity or compatibility check, then save the node.

Provider selection fills `base_url`, `auth_type`, endpoint paths, suggested models, `model_prefixes`, capability tags, compatibility profile, logo identity, and review-required pricing source metadata from the merged catalog. Operators can still edit every generated field before saving.

For large catalogs, the provider step uses family filters and alias search instead of a hardcoded provider grid. This keeps 50+ providers usable while preserving custom provider setup and advanced local configuration fields.

v1.4 also fills suggested `compatibility_profile` values. Leave the field blank for catalog-known providers unless you need to narrow a custom gateway or local server. Explicit node values always win over catalog inference, and validation will warn when the selected profile does not match the provider, source format, endpoint family, or model bucket.

## CLI

Run against source with npm:

```bash
npm run catalog -- list
npm run catalog -- show openai --pricing
npm run catalog -- sources
npm run catalog -- refresh openrouter --out ./catalog.override.yaml
npm run catalog -- sync openrouter
npm run catalog -- validate
npm run catalog -- validate --pricing
npm run catalog -- export --out ./catalog.merged.yaml
npm run catalog -- export --include-pricing --out ./catalog.merged.yaml
npm run catalog -- import --file ./catalog.override.yaml
```

After a production build, the same commands are available through the executable entrypoint:

```bash
node dist/cli/siftgate.js catalog list
node dist/cli/siftgate.js catalog show anthropic
node dist/cli/siftgate.js catalog sources
node dist/cli/siftgate.js catalog refresh openrouter --out ./catalog.override.yaml
node dist/cli/siftgate.js catalog sync openrouter
node dist/cli/siftgate.js catalog validate
```

Useful options:

- `--json` prints machine-readable output.
- `--override <path>` points the command at a non-default override file.
- `--file <path>` is used by `catalog validate` and `catalog import`.
- `--force` allows `catalog import` to replace an existing override file.
- `--write-to cache|override` selects where `catalog sync` writes. The default is `cache`, which writes SiftGate-managed metadata to `.siftgate/catalog-sync-cache.yaml`.
- `--pricing` adds pricing freshness/unit checks to `catalog validate`.
- `catalog show <provider> --pricing` includes pricing source type, source priority, and key price units for each model.
- `--include-pricing` is accepted by `catalog export`; pricing is included by default and the flag makes CI intent explicit.
- `catalog list` and `catalog show <provider>` include provider compatibility profiles so CI or operators can confirm which protocol profile the Dashboard will use.
- `catalog sources` lists refresh modes. `public_api` means SiftGate can refresh without a provider key; `docs_review` means an operator should review provider docs; `operator_local` means pricing depends on local deployment/account choices.
- `catalog refresh openrouter` calls OpenRouter's public model catalog, converts prompt/completion USD-per-token pricing to USD per 1M tokens, and writes a local override file. It refuses to replace an existing file unless `--force` is supplied.
- `catalog sync openrouter` uses the same OpenRouter adapter but writes to the managed local sync cache by default. The merged catalog loads built-ins first, then sync cache, then operator `catalog.override.yaml`, so explicit local overrides remain authoritative.

`catalog validate` exits non-zero on errors and is safe for CI. Warnings are printed without failing the command.

## Refresh Sources

SiftGate v0.9.2 exposes refresh-source metadata through the Dashboard catalog APIs and CLI. Current behavior:

| Provider | Mode | Automatic | Why |
| --- | --- | --- | --- |
| OpenRouter | `public_api` | Yes | OpenRouter exposes a public `/api/v1/models` catalog with model metadata and prompt/completion pricing. |
| OpenAI, Anthropic, Google Gemini / Vertex | `docs_review` | No | Public pricing is documented, but model availability and product surfaces change often; SiftGate keeps built-in entries as review-required references. |
| Groq, Mistral, DeepSeek, xAI, Cohere, Voyage, Jina, Together, Fireworks, Alibaba Qwen/Tongyi, Baidu Qianfan/Wenxin, Volcengine Ark/Doubao, Zhipu GLM, Moonshot/Kimi, MiniMax, Tencent Hunyuan, Perplexity, NVIDIA NIM, Cerebras, SambaNova, Hugging Face, Cloudflare Workers AI, IBM watsonx.ai, Baseten, Lepton AI, Modal, RunPod, Predibase, Lamini, AI21 Labs, fal.ai, Stability AI, Black Forest Labs, Ideogram, Luma AI, Runway, Pika, ElevenLabs, Deepgram, AssemblyAI, Cartesia, Speechmatics | `docs_review` | No | Pricing is public enough to review or documented by plan/model, but SiftGate does not scrape provider sites; use reviewed overrides for production cost routing. |
| Azure OpenAI, AWS Bedrock | `operator_local` | No | Pricing depends on region, deployment, SKU, AWS inference profile, or account-specific rate card. |
| Ollama, vLLM, LM Studio, llama.cpp server, TGI, SGLang, Xinference, 01.AI/Yi, Replicate, custom OpenAI-compatible | `operator_local` | No | Model list and cost depend on the local host, cluster, marketplace model, account, or proxy. |

For production cost routing, prefer explicit node pricing or a reviewed `catalog.override.yaml`. Built-in prices intentionally remain `manual_review_required: true` even when the number is a reasonable reference. v1.4 entries include `source_type`, `source_url`, `retrieved_at`, `last_verified_at`, `last_updated`, `stale_after_days`, `pricing_confidence`, and `review_reason` so operators can see where the reference came from without mistaking it for live billing data.

## Pricing Source Governance

SiftGate resolves prices in this order:

1. Explicit `nodes[].model_capabilities.<model>.pricing`
2. Explicit top-level `models_pricing`
3. `catalog.override.yaml`
4. Local catalog sync cache such as `.siftgate/catalog-sync-cache.yaml`
5. Built-in Provider Catalog

User configuration always wins. Built-in catalog data and sync cache never overwrite explicit node/model or `models_pricing` values.

The unified pricing schema supports token, cache, media, rerank, realtime, and batch fields:

```yaml
pricing:
  currency: USD
  billing_unit: usd_per_1m_tokens
  input_per_1m_tokens: 2.50
  output_per_1m_tokens: 10.00
  cache_read_per_1m_tokens: 0.25
  cache_write_per_1m_tokens: 2.50
  embedding_per_1m_tokens: 0.02
  rerank_per_1k_requests: 0.80
  image_per_generation: 0.04
  image_per_edit: 0.06
  audio_per_minute: 0.006
  audio_per_1m_chars: 15.00
  video_per_second: 0.12
  video_per_generation: 1.20
  realtime_per_minute: 0.30
  batch_discount: 0.50
  source_type: operator_override
  source: internal-rate-card
  source_url: https://example.com/internal-rate-card
  retrieved_at: "2026-05-05T00:00:00.000Z"
  last_verified_at: "2026-05-05"
  last_updated: "2026-05-05"
  stale_after_days: 30
  pricing_confidence: high
  manual_review_required: false
```

Legacy fields such as `input`, `output`, `cache_read_input`, and `cache_creation_input` remain supported. SiftGate normalizes them into the v1.4 fields before routing, Dashboard display, benchmark cost fallback, and validation.

## Scheduled Pricing Sync

v1.2 adds a disabled-by-default pricing sync framework on top of the refresh-source system. It does not scrape provider docs, does not require SiftGate Cloud, and does not introduce private dependencies. The first adapter is OpenRouter because it exposes a stable public model catalog API. Other providers remain `docs_review` or `operator_local` until a safe public adapter exists.

```yaml
catalog:
  override_file: ./catalog.override.yaml
  sync:
    enabled: false
    interval_minutes: 1440
    run_on_startup: false
    write_to: cache
    cache_file: ./.siftgate/catalog-sync-cache.yaml
    adapters:
      openrouter:
        enabled: false
```

Important behavior:

- `enabled` defaults to `false`; no background network request runs unless you turn it on.
- A provider must be explicitly enabled under `catalog.sync.adapters`. In v1.2 only `openrouter.enabled: true` is supported.
- `write_to: cache` is the recommended mode. It writes to a SiftGate-managed cache and never overwrites `catalog.override.yaml`.
- `write_to: override` is available for operators who intentionally want scheduled output in an override path, but user config and explicit `models_pricing` still have priority at runtime.
- Dashboard Provider Catalog shows sync status, last sync time, source URL, confidence, stale state, cache path, and enabled adapter count.

## Override File

By default SiftGate reads `catalog.override.yaml` from the working directory. You can also set an explicit path:

```yaml
catalog:
  override_file: ./ops/catalog.override.yaml
```

Example override:

```yaml
version: 1
providers:
  openai:
    base_url: https://proxy.example/openai
    endpoints:
      chat_completions: /v1/chat/completions
      embeddings: /v1/embeddings
    models:
      - id: custom-chat-latest
        modalities: [text]
        endpoints:
          chat_completions: /v1/chat/completions
        capabilities: [streaming]
        prompt_cache: true
        read_cache: true
        pricing:
          input: 0.25
          output: 0.75
          cache_read_input: 0.05
          cache_creation_input: 0.25
          currency: USD
          unit: usd_per_1m_tokens
          units:
            input: usd_per_1m_input_tokens
            output: usd_per_1m_output_tokens
            cache_read_input: usd_per_1m_cache_read_input_tokens
            cache_creation_input: usd_per_1m_cache_write_input_tokens
          source: internal-rate-card
          last_updated: "2026-05-03"
          manual_review_required: false
          stale_after_days: 90
          pricing_confidence: high
```

Overrides merge with the built-in catalog. If a provider or model already exists, only supplied fields are replaced. New providers and models are added and marked with `overridden: true`.

Provider overrides can also set `compatibility_profiles`:

```yaml
version: 1
providers:
  local-vllm:
    name: Local vLLM
    base_url: http://localhost:8000
    auth_type: none
    endpoints:
      chat_completions: /v1/chat/completions
      embeddings: /v1/embeddings
    compatibility_profiles: [local_vllm, embedding_compatible]
    models:
      - id: local-model
        modalities: [text]
        endpoints:
          chat_completions: /v1/chat/completions
        capabilities: [streaming]
```

Unknown profile ids are validation errors. A provider with no explicit profiles gets catalog inference based on provider id, endpoints, capabilities, model buckets, and base URL.

## Price Source Status

Older internal code and API fields still use `pricing_hygiene` for backward compatibility. In product copy and docs, SiftGate now calls this **price source status** because that is what operators actually need to know:

- Is a price present?
- Where did it come from?
- How old is it?
- Is it a review-required reference, a live public API value, or a local override?
- Is it safe enough for `routing.optimization=cost`?

Dashboard statuses map to these meanings:

- `Fresh`: price is present, recent, and not marked for manual review.
- `Review required`: built-in/reference price or incomplete live metadata; use a local override for production billing decisions.
- `Stale`: `last_updated + stale_after_days` has expired.
- `Missing`: SiftGate has no usable price for the requested model/modality.
- `Invalid`: metadata is malformed or unit fields do not match the modality.

## Validation

`siftgate validate` uses the merged catalog to add non-blocking warnings when:

- a configured model is not in the merged catalog
- a model is listed under a bucket that does not match its catalog modality
- a node endpoint differs from a known provider preset
- a node `auth_type` differs from a known provider preset
- a node does not match any built-in provider, which is reported as a custom catalog entry without blocking startup
- pricing is marked `manual_review_required`
- pricing is missing for the configured modality
- pricing needs review or is marked `manual_review_required`
- pricing source/source URL is missing
- pricing is stale according to `last_verified_at` / `retrieved_at` / `last_updated` plus `stale_after_days`
- pricing units do not match the model bucket, such as image models without image pricing units
- `routing.optimization=cost` or `balanced` is enabled but a candidate lacks usable input/output token prices
- cache-aware routing is enabled for a model but cache read/write price units are missing

Catalog override parsing itself can fail validation when the file is malformed or contains suspicious secret fields.

## Compatibility Profiles

Provider Compatibility Profiles model the protocol surface behind a catalog provider. Each profile includes:

- `profile_id` and `display_name`
- `protocol_family`, `request_style`, and `response_style`
- `auth_strategy`, `endpoint_strategy`, `streaming_strategy`, `multipart_strategy`, and `async_job_strategy`
- `supported_source_formats` and `supported_modalities`
- `passthrough_fields`, `downgraded_fields`, `unsupported_fields`, and `known_limitations`

The built-in registry covers OpenAI-compatible, Responses-compatible, Anthropic Messages, Gemini, Vertex, Bedrock Converse, Azure OpenAI, Hugging Face Inference, OpenRouter, Cohere, Mistral, Ollama, vLLM, TGI, LM Studio, media generation, speech, rerank, and embedding profiles.

Routing uses profile support to filter candidates when a source format, modality, streaming request, multipart media request, video async job, or batch path is unsafe for a node. Route Decision Trace records `compatibility_evidence` with provider id, profile id, endpoint/protocol strategy, passthrough/downgraded/unsupported field lists, selected reason, and filter reason. See [Provider Compatibility](./PROVIDER_COMPATIBILITY.md) for the full profile registry and routing behavior.

## Secret Safety

Do not put provider keys, dashboard passwords, bearer tokens, or raw auth headers in `catalog.override.yaml`.

The catalog validator flags keys such as `api_key`, `secret`, `token`, `authorization`, `bearer`, and `password`. Values that look like common provider tokens are also reported. Provider credentials should stay in environment variables and `nodes[].api_key` references:

```yaml
nodes:
  - id: openai
    api_key: ${OPENAI_API_KEY}
```

## Compatibility Matrix

Dashboard Nodes shows a read-only matrix per node:

- `capability`: `chat`, `responses`, `messages`, `embeddings`, `rerank`, `images`, `audio`, `video`, or `realtime`
- `compatibility_profiles`: profile ids used to decide whether the capability is safe for this node
- `profile_supported`: whether at least one profile supports the capability
- `configured`: whether the node has the required model bucket and endpoint metadata
- `tested`: whether the Dashboard has run a safe check
- `last_status`: `pass`, `warning`, `fail`, or `skipped`
- `last_checked_at`, `latency_ms`, `status_code`, and a sanitized `failure_reason`

The matrix is stored in local SQLite/PostgreSQL metadata. It does not store prompts, responses, raw headers, provider API keys, media files, audio frames, or video bytes.

## Safe Test Policy

`POST /api/dashboard/nodes/:id/test` can test one or more capabilities:

```json
{
  "capabilities": ["chat", "embeddings", "images", "video", "realtime"],
  "confirm_expensive": false
}
```

Text-like checks use tiny synthetic requests:

- Chat/Responses/Messages: one-token `ping` style request
- Embeddings: one small synthetic input
- Rerank: one query and one synthetic document

Media and long-lived checks are conservative:

- Images/audio default to endpoint/auth probes
- Video/realtime default to endpoint/auth/capability probes
- Real generation or long-lived realtime sessions are not started by default

This makes the matrix suitable for CI-style smoke checks and local operator validation without accidentally spending meaningful provider budget.

## Boundaries

- No broad automatic online scraping. v0.9.2 only refreshes providers with an explicit stable adapter, currently OpenRouter.
- No provider API keys or secrets are stored in the catalog.
- The catalog is advisory. Operators can still configure private deployments, proxy model IDs, and local model names.
- Video is cataloged as a modality and can be configured through `nodes[].video_models`, `video_generations_endpoint`, `video_endpoint`, and optional async video endpoint fields.

## Pricing Fallback Order

Cost routing, budget accounting, and route evidence resolve prices in this order:

1. `nodes[].model_capabilities[model].pricing`
2. top-level `models_pricing[model]`
3. merged Provider Catalog model pricing from the built-in catalog plus `catalog.override.yaml`

The catalog fallback is intentionally conservative. Built-in prices are marked `manual_review_required` and low confidence until an operator verifies them or overrides them locally. Use explicit config pricing for production billing decisions.

## Prompt Cache Metadata

v1.2 uses the same catalog and node/model capability schema for prompt-cache-aware routing:

- `prompt_cache: true` means the provider/model has prompt-cache semantics.
- `read_cache: true` means the provider/model can reuse previously cached prompt/context tokens and may report cache-read token usage.
- `write_cache: true` means the provider/model can create provider-side cache entries.
- `pricing.cache_read_input` and `pricing.cache_creation_input` are USD per 1M cache-read or cache-write input tokens.

Explicit `nodes[].model_capabilities[model]` always wins over top-level `models_pricing`, and both win over catalog fallback metadata. If cache prices are missing, routing still works and falls back to normal input pricing for cost accounting.
