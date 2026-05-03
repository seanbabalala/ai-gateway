# Provider / Model Catalog

SiftGate includes a local provider/model catalog used by the open-source Data Plane for Dashboard presets, configuration validation, and modality metadata. The catalog is static in v0.8: it does not call provider websites, scrape docs, or update prices over the network.

## What It Stores

Each provider entry can describe:

- `base_url`
- auth style: `bearer`, `x-api-key`, or `none`
- endpoint paths for chat, responses, messages, embeddings, rerank, image, audio, video, and realtime capabilities
- model IDs and model prefixes
- modalities such as `text`, `vision`, `image`, `audio`, `video`, `embedding`, `rerank`, and `realtime`
- model limits such as context window, dimensions, and max file size
- pricing metadata with `source`, `last_updated`, and `manual_review_required`

Pricing in the built-in catalog is a starter hint, not a billing source of truth. Many providers change prices, regions, and product names frequently. If you rely on cost routing, keep local overrides reviewed.

## CLI

Run against source with npm:

```bash
npm run catalog -- list
npm run catalog -- show openai
npm run catalog -- validate
npm run catalog -- export --out ./catalog.merged.yaml
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
          unit: usd_per_1m_tokens
          source: internal-rate-card
          last_updated: "2026-05-03"
          manual_review_required: false
```

Overrides merge with the built-in catalog. If a provider or model already exists, only the supplied fields are replaced. New providers and models are added and marked with `overridden: true` in Dashboard catalog APIs.

## Dashboard API

The Dashboard reads the merged catalog through:

```text
GET /api/dashboard/catalog/providers
GET /api/dashboard/catalog/models?provider=openai&modality=text
```

Responses include:

- merged providers or models
- `override_file`
- `override_found`
- validation `issues`
- per-provider and per-model `overridden` markers

These endpoints are read-only. They do not contact SiftGate Cloud and do not modify `gateway.config.yaml`.

## Validation

`siftgate validate` uses the merged catalog to add non-blocking warnings when:

- a configured model is not in the merged catalog
- a model is listed under a bucket that does not match its catalog modality
- a node endpoint differs from a known provider preset
- pricing is marked `manual_review_required`

Catalog override parsing itself can fail the validation when the file is malformed or contains suspicious secret fields.

## Secret Safety

Do not put provider keys, dashboard passwords, bearer tokens, or raw auth headers in `catalog.override.yaml`.

The catalog validator flags keys such as `api_key`, `secret`, `token`, `authorization`, `bearer`, and `password`. Values that look like common provider tokens are also reported. Provider credentials should stay in environment variables and `nodes[].api_key` references:

```yaml
nodes:
  - id: openai
    api_key: ${OPENAI_API_KEY}
```

## Current Limitations

- No automatic network update is performed in v0.8.
- Built-in pricing values are placeholders with manual review markers.
- Provider support metadata is intentionally conservative; use overrides for private deployments, compatible proxies, region-specific endpoints, or newly released models.
