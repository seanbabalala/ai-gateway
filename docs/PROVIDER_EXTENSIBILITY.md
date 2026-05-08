# Provider Extensibility And Health

SiftGate v2.3 expands provider coverage through mechanisms instead of a one-time
race to 100+ hand-maintained providers. Operators can define custom provider
templates, preview the exact local node/catalog shape, generate a reviewed
adapter skeleton, and monitor provider health from existing metadata.

## Custom Provider Template

The Dashboard Add Node flow already supports custom upstreams. v2.3 makes the
custom-provider contract explicit:

- provider id and display name
- base URL
- protocol and compatibility profile
- auth type, including `custom-header`
- model list and endpoint support
- optional model pricing rows
- optional health probe settings
- secret references for provider keys

Preview API:

```http
POST /api/dashboard/provider-extensibility/templates/custom/preview
```

The preview response returns a sanitized `node_preview`, a
`catalog_manifest_preview`, validation `issues`, and privacy flags. It is
read-only and never returns provider key values, raw request headers, prompts,
responses, media bytes, source code, diffs, tool payloads, hidden reasoning text,
or resolved secrets.

## Custom Header Auth

Some OpenAI-compatible or private providers expect the key in a non-standard
header. Configure:

```yaml
nodes:
  - id: acme
    name: Acme AI
    protocol: chat_completions
    base_url: https://api.acme.example
    endpoint: /v1/chat/completions
    api_key: ${env:ACME_API_KEY}
    auth_type: custom-header
    auth_header_name: api-key
    auth_header_prefix: Token
    models: [acme-chat]
```

At request time SiftGate sends `api-key: Token <resolved key>`. Dashboard APIs
may show the header name and prefix as configuration metadata, but not the key.

## Provider SDK Generator Beta

Preview API:

```http
POST /api/dashboard/provider-extensibility/sdk/generate
```

The generator returns a small TypeScript adapter skeleton, a basic unit test,
a manifest file, and a README. It is intentionally beta and always marked
`manual_review_required: true`.

Manual review must verify:

- request and response mapping
- streaming behavior
- usage/token fields
- endpoint support
- compatibility profile evidence
- pricing source governance
- secret redaction

Generated adapters are not auto-trusted and are not merged without tests.

## Provider Health Dashboard

Dashboard API:

```http
GET /api/dashboard/provider-health?period=24h
```

The health view aggregates existing metadata:

- active health probe status
- circuit breaker state
- call-log count, error rate, average latency, and p95 latency
- compatibility profile labels
- stale, missing, low-confidence, or manual-review pricing warnings

The response is workspace-scoped and metadata-only.

## Community Provider Registry Design

Community provider PRs should include a provider manifest plus evidence:

```yaml
version: 1
providers:
  acme:
    name: Acme AI
    status: custom
    provider_type: direct
    family: custom
    base_url: https://api.acme.example
    auth_type: custom-header
    endpoints:
      chat_completions: /v1/chat/completions
    compatibility_profiles:
      - openai_compatible
    pricing:
      source: provider_docs
      source_url: https://acme.example/pricing
      last_updated: 2026-05-09
      manual_review_required: true
      pricing_confidence: low
    models:
      - id: acme-chat
        modalities: [text]
        endpoints:
          chat_completions: /v1/chat/completions
```

CI expectations:

- catalog validation passes
- generated or handwritten adapter tests pass
- mocked request/response mapping tests pass
- compatibility profile evidence is included
- pricing source URL, date, confidence, and manual-review status are explicit
- no provider keys, raw headers, prompts, responses, media bytes, source code,
  diffs, tool payloads, hidden reasoning text, or resolved secrets are committed

Pricing governance:

- built-in/community prices are references, not billing authority
- operator node pricing and local `catalog.override.yaml` remain higher priority
- community pricing with uncertain coverage must keep `manual_review_required`
  or low/unknown confidence

## Boundaries

v2.3 does not promise 100+ providers. It creates the template, generator,
registry, health, and review mechanics that make provider expansion sustainable.
