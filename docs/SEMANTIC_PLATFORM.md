# Semantic Controls

SiftGate v2.7.0 makes Semantic Controls production-grade without changing the
privacy default of the open-source data plane. Semantic Cache v2, Prompt
Registry, Context Window Optimizer evidence, Intent Classification, and
Guardrails v2 are opt-in control-plane features around the existing gateway
pipeline.

The Dashboard now uses the label **Semantic Controls** for this surface. The API
route remains `/api/dashboard/semantic-platform` for compatibility.

By default, SiftGate does not store prompts, responses, raw provider headers,
provider keys, media bytes, tool payloads, hidden reasoning text, or resolved
secrets. The semantic platform records hashes, counters, route evidence, and
finding metadata unless an operator explicitly enables a content-storage option
and documents retention.

## Configuration

```yaml
semantic_cache:
  enabled: false
  backend: memory
  similarity_threshold: 0.92
  ttl_seconds: 3600
  max_entries: 500
  vector_dimensions: 256
  store_responses: false
  max_response_bytes: 65536
  isolation: workspace_api_key_model
  response_storage_requires_header: true

semantic_platform:
  enabled: false
  prompt_registry:
    enabled: false
    store_template_content: false
    max_versions_per_key: 20
  context_optimizer:
    enabled: false
    strategy: metadata_only
    max_context_ratio: 0.8
    allow_content_mutation: false
  intent_classification:
    enabled: false
    categories: [coding, task, security, reasoning, creative, multimodal, analysis, general]
    min_confidence: 0.5
  guardrails_v2:
    enabled: false
    metadata_only: true
    input:
      enabled: false
      pii: true
      toxicity: true
      jailbreak: true
      action: observe
    output:
      enabled: false
      pii: true
      toxicity: true
      jailbreak: true
      action: observe
```

Run:

```bash
GATEWAY_CONFIG_PATH=gateway.config.example.yaml npm run validate:config
```

## Semantic Cache v2

Semantic Cache v2 is disabled by default. In the default `memory` backend,
SiftGate computes a local hashed-vector representation of canonical request
text, then stores only the vector, hash, TTL metadata, workspace, Gateway API
key, model, namespace, and team labels needed for safe matching.

Isolation options:

| Value | Match Boundary |
| --- | --- |
| `workspace_api_key_model` | Workspace, Gateway API key, requested model, namespace, and team labels |
| `workspace_model` | Workspace, requested model, namespace, and team labels |
| `workspace` | Workspace plus namespace/team labels |

Response replay is intentionally gated twice. Operators must enable
`semantic_cache.store_responses=true`, and the default
`response_storage_requires_header=true` requires callers to send
`x-siftgate-semantic-store-response: true` on requests that may be replayed.
Without both opt-ins, semantic matches are evidence only and the request still
goes upstream.

Operators can invalidate the active workspace cache from the Dashboard or by
calling:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/dashboard/semantic-platform/semantic-cache/invalidate` | Clear Semantic Cache v2 entries for the active workspace, or all workspaces when explicitly requested |

## Prompt Registry

Prompt Registry stores workspace-scoped template metadata and versions. The
default stores only template hashes, variables, route policy binding, A/B
metadata, status, and timestamps. Template body storage requires
`semantic_platform.prompt_registry.store_template_content=true`.

Dashboard and API operations:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/dashboard/semantic-platform/prompt-templates` | List active workspace prompt template metadata |
| `POST` | `/api/dashboard/semantic-platform/prompt-templates` | Create a new version for a prompt key |
| `DELETE` | `/api/dashboard/semantic-platform/prompt-templates/:id` | Archive one template version |

Requests can bind route evidence to a registered template with safe headers:

```text
x-siftgate-prompt-key: support-summary
x-siftgate-prompt-version: 3
```

The route trace records the prompt key, selected version, template hash,
variables, route policy id, and A/B metadata. It does not include the rendered
prompt or template body by default.

## Context Window Optimizer

The v2.7 Context Window Optimizer is a metadata-first evidence layer. It
estimates context tokens for the canonical request, compares that estimate with
the selected model context window when known, and records whether a trim or
summarize strategy would have been appropriate.

`strategy: metadata_only` never mutates request content. `trim` and `summarize`
are preview strategy labels in v2.7; even when `allow_content_mutation=true`,
the route evidence records `content_mutation_requested_but_not_applied_in_v2_7`
instead of silently changing prompt content. Future content mutation must remain
explicit and traceable.

## Intent Classification

Intent Classification adds a task category beyond the existing complexity
score. Supported categories are:

- `coding`
- `task`
- `security`
- `reasoning`
- `creative`
- `multimodal`
- `analysis`
- `general`

Intent evidence can add advisory route hints such as coding, security,
reasoning, multimodal, and analysis capabilities. Gateway API key policy,
workspace policy, budgets, endpoint/model/node restrictions, circuit breakers,
fallback rules, and provider compatibility remain authoritative.

## Guardrails v2

Guardrails v2 records metadata-only findings for input and output policy
surfaces. The built-in v2.7 detectors cover PII-like patterns, toxicity terms,
and jailbreak/prompt-injection phrases. Findings include surface, kind, action,
severity, match count, and metadata-only status. They do not include matched
text by default.

The v2.7 Dashboard labels Guardrails v2 as metadata-only. `action: block` is
validated as a future policy shape, but the current v2.7 route evidence reports
findings and does not block requests by default.

## Dashboard And Route Evidence

The Dashboard **Semantic Controls** page reads:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/dashboard/semantic-platform` | Semantic cache, prompt registry, context optimizer, intent, Guardrails v2, and privacy summary |

The page also shows workspace cache invalidation, prompt template creation,
intent counts, context actions, Guardrails v2 finding counts, and the explicit
privacy contract.

Route Decision Trace can include top-level `semantic_platform` evidence:

- `intent`: category, confidence, signals, quality/security route hints
- `context_optimizer`: strategy, token estimate, context ratio, action, mutation state
- `prompt_registry`: prompt key, version, hash, variables, route policy, A/B metadata
- `guardrails_v2`: policy shape and metadata-only findings

Route traces, logs, exports, and Dashboard panels do not include prompt text,
response text, raw headers, provider keys, source code, diffs, tool payloads,
media bytes, hidden reasoning text, or resolved secrets by default.

## Operational Guidance

- Start with `semantic_platform.enabled=true` and all subfeatures disabled to
  verify Dashboard visibility.
- Enable `semantic_cache.enabled=true` with `store_responses=false` first, then
  review match evidence before allowing replayable response storage.
- Keep `semantic_cache.isolation=workspace_api_key_model` for sensitive
  workspaces.
- Keep `semantic_platform.prompt_registry.store_template_content=false` unless
  template retention and redaction are documented.
- Keep Context Window Optimizer in `metadata_only` mode until content mutation
  has explicit operator approval and route evidence.
- Treat Guardrails v2 as finding metadata in v2.7; use the official guardrails
  plugin for deeper local policy enforcement.

## Related Docs

- [Caching](CACHING.md)
- [Dashboard](DASHBOARD.md)
- [API Reference](API_REFERENCE.md)
- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
