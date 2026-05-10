# Adding Providers

This guide describes how to add or maintain providers in the MIT open-source SiftGate Data Plane.

The short rule: add provider knowledge to the shared Provider Catalog, keep pricing honest, keep secrets out of the repository, and make Dashboard/API/CLI views read from catalog data instead of hardcoded lists.

For v2.3 custom providers, start with
[Provider Extensibility And Health](PROVIDER_EXTENSIBILITY.md). The Dashboard
template preview and Provider SDK Generator beta are review aids only; generated
adapters and community manifests are not trusted until they pass tests and
manual review.

## Scope

- Work only in the open-source Data Plane.
- Do not modify private Cloud/enterprise workspace trees.
- Do not add enterprise-only dependencies or private packages.
- Do not commit provider API keys, bearer tokens, dashboard passwords, resolved secret values, raw auth headers, prompts, responses, media bytes, or generated video bytes.
- Keep single-node memory/SQLite behavior working by default. Redis, Postgres, Cloud, and external catalog sync are optional.

## Catalog Sources

v1.4 still has two catalog-facing files because of historical API compatibility:

- `src/catalog/built-in-catalog.ts`: the canonical built-in catalog used by the merged catalog service, pricing governance, compatibility profiles, Dashboard APIs, config validation, routing evidence, and CLI.
- `src/catalog/provider-catalog.data.ts`: legacy provider diagnostics/catalog projection used by older validation and compatibility surfaces.

When adding a provider today, update both where the provider is expected by existing tests. The long-term direction is to collapse this into one catalog source plus generated projections, but do not introduce a second new catalog.

## Required Provider Fields

Every new provider should include:

- `id` / provider id
- `name` / display name
- `aliases`
- `family` or `category`
- `provider_type`
- `homepage_url`
- `docs_url`
- `pricing_url`
- `logo_id`
- `auth_type`
- `base_url`
- `endpoints`
- `modalities`
- `input_types`
- `output_types`
- `model_buckets`
- `capabilities`
- `limits`
- `compatibility_profile` and `compatibility_profiles`
- `pricing` metadata

Use the existing v1.4 providers as templates. Prefer explicit, boring metadata over clever inference.

For a custom provider manifest, also include enough evidence for review:

- compatibility profile evidence and mocked request/response mapping coverage
- endpoint support and unsupported operations
- health probe behavior
- pricing source URL, confidence, stale window, and manual-review status
- whether auth uses `bearer`, `x-api-key`, `custom-header`, or `none`

`custom-header` providers must define `auth_header_name`; `auth_header_prefix`
is optional. Never commit provider key values or resolved secret material.

## Pricing Rules

Pricing is a reference snapshot, not a billing authority.

Use the v1.4 governance schema:

- `currency`
- `billing_unit`
- token/cache/media/rerank/realtime/batch units as applicable
- `source_type`
- `source`
- `source_url`
- `retrieved_at` when generated from a public adapter
- `last_verified_at`
- `last_updated`
- `stale_after_days`
- `pricing_confidence`
- `manual_review_required`
- `review_reason`

If the public price is unclear, regional, account-specific, or deployment-specific, set `manual_review_required: true` and `pricing_confidence: low`. Do not use “placeholder” as user-facing copy. Dashboard should show “Review required” / “需要复核”.

Explicit user configuration always wins over catalog data:

1. node/model pricing in `gateway.config.yaml`
2. `models_pricing`
3. `catalog.override.yaml`
4. local sync cache
5. built-in catalog

## Compatibility Profiles

Pick the closest profile from `src/catalog/compatibility-profiles.ts`.

Examples:

- OpenAI-compatible text APIs: `openai_compatible`
- OpenAI Responses-compatible APIs: `openai_responses_compatible`
- Anthropic Messages APIs: `anthropic_messages_compatible`
- Gemini APIs: `google_gemini_compatible`
- Vertex/Veo-style APIs: `google_vertex_compatible`
- Bedrock Converse: `aws_bedrock_converse`
- Hosted Hugging Face inference: `huggingface_inference`
- Local runtimes: `local_ollama`, `local_vllm`, `local_tgi`, `local_lmstudio`
- Async media generation: `media_generation_async`
- Speech APIs: `speech_transcription` or `speech_tts`

If a provider only partially supports a protocol, record limitations in the profile or provider metadata. Unsupported fields should be visible in Route Explanation; they should not disappear silently.

## Logo Identity

Add or reuse a `logo_id` that maps to a provider identity in the Dashboard shared node icon system. Compatible providers such as Hugging Face, Voyage, fal.ai, Stability AI, Deepgram, LM Studio, or OpenRouter must not render as OpenAI unless the provider is truly the generic custom OpenAI-compatible profile.

## Tests

Run focused checks before the full release gate:

```bash
npm run catalog -- validate --pricing
npm test -- --runInBand test/unit/catalog-service.spec.ts test/unit/catalog-cli.spec.ts test/unit/config-validator.spec.ts
cd frontend && npm test
```

For v2.3 community provider registry or generated-adapter PRs, also include:

- `npm run provider-registry:check` for the provider manifest
- generated or handwritten adapter request/response mapping tests
- a custom provider template preview fixture when the provider is not in the
  built-in catalog
- provider health/probe fixture evidence when health behavior differs from the
  default endpoint check
- pricing governance coverage for stale, low-confidence, or manual-review rows

For release branches, still run the full quality gate:

```bash
npm run build
npm test -- --runInBand
npm run test:e2e
npm run validate:k8s
npm run docs:check
cd frontend && npm test && npm run build
```

## Documentation Checklist

When a provider addition changes operator behavior, update:

- `docs/PROVIDER_CATALOG.md`
- `docs/PROVIDER_COMPATIBILITY.md`
- `docs/API_REFERENCE.md` if response fields change
- `docs/PROVIDER_EXTENSIBILITY.md` if custom template, generator, registry, or health behavior changes
- `CHANGELOG.md` and release notes if the addition changes release scope
- `gateway.config.example.yaml` only when a new config shape is introduced
