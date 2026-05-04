# Provider / Model Catalog And Compatibility

SiftGate v0.8 adds a local Provider / Model Catalog for the open-source Data Plane. v0.9 extends that same catalog with pricing hygiene metadata and cost-routing fallback. The catalog is used by Dashboard Add Node, catalog APIs, config validation, cost-aware routing, and provider compatibility checks. It is intentionally local and reviewable: the gateway does not call provider websites, scrape docs, or auto-update prices in v0.9.

## Goals

- Keep provider/model knowledge out of Dashboard form components.
- Give config validation enough context to warn about likely model, pricing, endpoint, and modality mistakes.
- Provide one shared vocabulary for text, vision, image, audio, video, embedding, rerank, and realtime routing work.
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

Dashboard also includes a read-only Provider Catalog page. It shows pricing freshness, source, manual-review state, confidence, override state, and modality coverage without changing routing or node config.

## Dashboard Add Node Wizard

v0.8 uses the catalog as the source of truth for the Dashboard Add Node flow. The wizard no longer keeps a separate provider/model list inside the React form.

The OSS Data Plane wizard saves only local `gateway.config.yaml` node fields:

1. Choose a provider, OpenAI-compatible proxy, or custom upstream.
2. Select endpoint capabilities: Chat, Responses, Messages, Embeddings, Rerank, Images, Audio, Video, and Realtime.
3. Pick or edit model buckets: `models`, `embedding_models`, `rerank_models`, `image_models`, `audio_models`, `video_models`, and `realtime_models`.
4. Confirm `base_url`, native protocol endpoint, per-capability endpoints, auth type, custom headers, aliases, prefixes, model pricing overrides, routing capability tags, health probe, and concurrency/queue controls.
5. Run a safe connectivity or compatibility check, then save the node.

Provider selection fills `base_url`, `auth_type`, endpoint paths, suggested models, `model_prefixes`, capability tags, and placeholder pricing metadata from the merged catalog. Operators can still edit every generated field before saving.

## CLI

Run against source with npm:

```bash
npm run catalog -- list
npm run catalog -- show openai
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
node dist/cli/siftgate.js catalog validate
```

Useful options:

- `--json` prints machine-readable output.
- `--override <path>` points the command at a non-default override file.
- `--file <path>` is used by `catalog validate` and `catalog import`.
- `--force` allows `catalog import` to replace an existing override file.
- `--pricing` adds pricing freshness/unit checks to `catalog validate`.
- `--include-pricing` is accepted by `catalog export`; pricing is included by default and the flag makes CI intent explicit.

`catalog validate` exits non-zero on errors and is safe for CI. Warnings are printed without failing the command.

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
        pricing:
          input: 0.25
          output: 0.75
          currency: USD
          unit: usd_per_1m_tokens
          units:
            input: usd_per_1m_input_tokens
            output: usd_per_1m_output_tokens
          source: internal-rate-card
          last_updated: "2026-05-03"
          manual_review_required: false
          stale_after_days: 90
          pricing_confidence: high
```

Overrides merge with the built-in catalog. If a provider or model already exists, only supplied fields are replaced. New providers and models are added and marked with `overridden: true`.

## Validation

`siftgate validate` uses the merged catalog to add non-blocking warnings when:

- a configured model is not in the merged catalog
- a model is listed under a bucket that does not match its catalog modality
- a node endpoint differs from a known provider preset
- pricing is marked `manual_review_required`
- pricing is missing for the configured modality
- pricing is placeholder/manual-review metadata
- pricing is stale according to `last_updated` + `stale_after_days`
- pricing units do not match the model bucket, such as image models without image pricing units
- `routing.optimization=cost` is enabled but a candidate lacks usable input/output token prices

Catalog override parsing itself can fail validation when the file is malformed or contains suspicious secret fields.

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

- No automatic online updates in v0.9.
- No provider API keys or secrets are stored in the catalog.
- The catalog is advisory. Operators can still configure private deployments, proxy model IDs, and local model names.
- Video is cataloged as a modality and can be configured through `nodes[].video_models`, `video_generations_endpoint`, `video_endpoint`, and optional async video endpoint fields.

## Pricing Fallback Order

Cost routing, budget accounting, and route evidence resolve prices in this order:

1. `nodes[].model_capabilities[model].pricing`
2. top-level `models_pricing[model]`
3. merged Provider Catalog model pricing from the built-in catalog plus `catalog.override.yaml`

The catalog fallback is intentionally conservative. Built-in prices are marked `manual_review_required` and low confidence until an operator verifies them or overrides them locally. Use explicit config pricing for production billing decisions.
