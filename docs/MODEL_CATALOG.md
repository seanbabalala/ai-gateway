# Model Catalog

SiftGate v0.7 adds a local model catalog for pricing, context windows, modality
support, endpoint support, and routing diagnostics. It is part of the MIT
open-source Data Plane and does not require SiftGate Cloud.

## What It Does

- Provides built-in fallback metadata for common public models.
- Lets cost/context routing use known metadata when user config is silent.
- Warns about unknown private models, stale catalog pricing, missing context
  windows, and capability conflicts.
- Powers the read-only Dashboard Model Catalog page and
  `GET /api/dashboard/model-catalog`.
- Optionally refreshes a trusted remote catalog document in the background.

The catalog never rewrites `gateway.config.yaml` and never applies routing
changes. Explicit user configuration always wins.

## Configuration

```yaml
model_catalog:
  enabled: true
  pricing_max_age_days: 90
  remote:
    enabled: false
    url: "https://catalog.example.com/siftgate-models.json"
    timeout_ms: 5000
    refresh_interval_hours: 24
```

`remote.enabled` is disabled by default. Use a trusted HTTPS URL outside local
development. If refresh fails, SiftGate keeps the built-in catalog and exposes a
diagnostic instead of blocking requests.

## Metadata Precedence

SiftGate resolves metadata in this order:

1. `nodes[].model_capabilities[model]`
2. Node-level capability defaults such as `max_context_tokens`
3. Top-level `models_pricing`
4. Remote catalog entry, when enabled and refreshed
5. Built-in catalog entry

Private proxy models are fully supported. Add `model_capabilities` metadata when
a private model is not present in the built-in or remote catalog.

## Remote Catalog Shape

```json
{
  "version": "2026-05-03",
  "updated_at": "2026-05-03T00:00:00.000Z",
  "models": [
    {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "aliases": ["fast"],
      "modalities": ["text", "vision"],
      "endpoints": ["chat_completions", "responses"],
      "input_types": ["text", "image"],
      "output_types": ["text", "json"],
      "max_context_tokens": 128000,
      "structured_output": true,
      "supports_streaming": true,
      "pricing": { "input": 0.15, "output": 0.6 },
      "quality_hint": 0.68,
      "last_updated_at": "2026-05-03"
    }
  ]
}
```

Pricing is USD per 1M tokens, matching `models_pricing`.

## Safety

- Catalog refresh is asynchronous and never runs on the request path.
- Catalog data contains model metadata only; it must not contain prompts,
  responses, provider API keys, Gateway API keys, or raw headers.
- Dashboard catalog views are read-only.
- Remote data is in-memory metadata. It is not written back into local config.
