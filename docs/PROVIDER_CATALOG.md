# Provider / Model Catalog And Compatibility

SiftGate v0.8 adds a local Provider / Model Catalog for the open-source Data Plane. The catalog is a built-in static data source used by Dashboard Add Node, catalog APIs, and config validation. It is intentionally local and reviewable: the gateway does not call provider websites or auto-update the list in this first version.

## Goals

- Keep provider/model knowledge out of Dashboard form components.
- Give config validation enough context to warn about likely model, pricing, and modality mistakes.
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

Responses include catalog metadata:

```json
{
  "version": "2026-05-03.static.v1",
  "source": "builtin_static",
  "last_updated": "2026-05-03",
  "auto_update": false
}
```

## Dashboard Add Node Wizard

v0.8 uses the catalog as the source of truth for the Dashboard Add Node flow. The wizard no longer keeps a separate provider/model list inside the React form.

The OSS Data Plane wizard saves only local `gateway.config.yaml` node fields:

1. Choose a provider, OpenAI-compatible proxy, or custom upstream.
2. Select endpoint capabilities: Chat, Responses, Messages, Embeddings, Rerank, Images, Audio, Video, and Realtime.
3. Pick or edit model buckets: `models`, `embedding_models`, `rerank_models`, `image_models`, `audio_models`, `video_models`, and `realtime_models`.
4. Confirm `base_url`, native protocol endpoint, per-capability endpoints, auth type, custom headers, aliases, prefixes, model pricing overrides, routing capability tags, health probe, and concurrency/queue controls.
5. Run a chat/text connectivity test when a text model is present, then save the node.

Provider selection fills `base_url`, `auth_type`, endpoint paths, suggested models, `model_prefixes`, capability tags, and placeholder pricing metadata from the static catalog. Operators can still edit every generated field before saving.

## Initial Providers

The first static catalog includes:

| Provider | Typical Role | Modalities |
| --- | --- | --- |
| OpenAI | Official OpenAI API | text, vision, image, audio, embedding, realtime |
| Anthropic | Claude Messages API | text, vision |
| Google Gemini | Gemini OpenAI-compatible and native-adjacent entries | text, vision, image, video, embedding |
| Google Vertex AI | Cloud deployment variant | text, vision, image, video, embedding |
| Azure OpenAI | Deployment-based OpenAI-compatible routing | text, vision, image, audio, embedding |
| OpenRouter | Multi-provider OpenAI-compatible marketplace | text, vision, image, audio, embedding |
| Groq | Fast OpenAI-compatible inference | text |
| Mistral AI | OpenAI-compatible chat and embeddings | text, vision, embedding |
| DeepSeek | OpenAI-compatible coding/reasoning | text |
| xAI | OpenAI-compatible Grok models | text, vision |
| Cohere | Chat, embeddings, rerank | text, embedding, rerank |
| Voyage AI | Embeddings and rerank | embedding, rerank |
| Jina AI | Embeddings and rerank | embedding, rerank |
| Together AI | Open model hosting | text, vision, image, embedding |
| Fireworks AI | Open model hosting | text, vision, image, embedding |
| Ollama | Local OpenAI-compatible runtime | text, vision, embedding |
| vLLM | Local/OpenAI-compatible runtime | text, vision, embedding |
| OpenAI-Compatible Custom | Operator-defined provider/proxy | text, vision, image, audio, video, embedding, rerank, realtime |

## Schema

Provider entries include:

- `id`, `name`, `base_url`, `base_url_matchers`
- `protocols` and `default_protocol`
- `endpoints` for chat, responses, messages, embeddings, images, audio, video, rerank, and realtime
- `auth_type`
- provider-level `modalities`, `capabilities`, `model_prefixes`, `tags`
- `pricing.source`, `pricing.last_updated`, `pricing.manual_review_required`
- `allows_unknown_models` for dynamic catalogs such as OpenRouter, Ollama, vLLM, Azure deployments, and custom OpenAI-compatible providers

Model entries include:

- `id`, `provider_id`
- `modalities`
- supported `endpoints`
- `input_types`, `output_types`
- `capabilities`
- optional `limits`, including context window, file size, and embedding dimensions
- `pricing` with `source`, `last_updated`, and `manual_review_required`
- support flags such as `structured_output`, `supports_streaming`, `supports_realtime`, and `supports_rerank`

## Config Validation

`npm run validate:config` now uses the catalog for warnings only. The catalog does not block custom providers or private models unless another structural validation rule already fails.

Examples:

- `catalog_unknown_model`: a recognized provider uses a model ID that is not in the built-in static catalog.
- `catalog_model_modality_mismatch`: a model is listed under the wrong model bucket, such as a chat model under `embedding_models`.
- `catalog_endpoint_modality_mismatch`: the provider/model is not cataloged for the configured endpoint or modality.
- `catalog_pricing_manual_review`: catalog pricing is a placeholder and no local `models_pricing` or `model_capabilities[].pricing` override exists.
- `catalog_provider_unrecognized`: info-level note for custom provider URLs; SiftGate treats them as custom/OpenAI-compatible and skips known-model warnings.

Production cost routing should rely on local pricing config, not catalog placeholders:

```yaml
models_pricing:
  gpt-4o: { input: 2.5, output: 10.0 }
  text-embedding-3-small: { input: 0.02, output: 0.0 }
```

Or per-node/model overrides:

```yaml
nodes:
  - id: openai
    model_capabilities:
      gpt-4o-mini:
        pricing: { input: 0.15, output: 0.60 }
```

## Boundaries

- No automatic online updates in v0.8.
- No provider API keys or secrets are stored in the catalog.
- The catalog is advisory. Operators can still configure private deployments, proxy model IDs, and local model names.
- Video is cataloged as a modality and can be configured through `nodes[].video_models`, `video_generations_endpoint`, and optional `video_status_endpoint`; v0.8 does not yet add a public `/v1/video` gateway endpoint.

SiftGate's open-source Data Plane keeps provider configuration local. Provider/model catalog data can help operators pick likely endpoints and models, but the compatibility matrix answers the production question: does this saved node actually support the capability with its current endpoint, auth, headers, and model list?

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

## Config Validation

Config validation still validates static YAML first: endpoints, model buckets, routing references, and pricing warnings. Dashboard diagnostics may add non-blocking warnings from recent compatibility results, such as an untested configured capability or a failed provider probe. These diagnostics are informational and do not prevent the gateway from starting.
