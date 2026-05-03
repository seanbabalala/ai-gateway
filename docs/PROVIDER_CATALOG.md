# Provider / Model Catalog

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
- Video is cataloged as a modality for future routing work; v0.8 does not add a video endpoint.
