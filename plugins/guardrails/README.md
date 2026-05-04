# guardrails

Official SiftGate guardrails plugin for the MIT Data Plane. It runs local
audit, redact, block, and optional webhook finding checks in the request
pipeline without calling an external moderation service by default.

The plugin is disabled by default. When enabled, it can inspect canonical chat,
responses, and messages traffic that passes through plugin hooks. Media/video
requests are not parsed by the plugin, but schema helper documents include safe
metadata such as source format, file count, byte size, and requested formats
when those fields are present in the canonical request.

## Features

- PII detection for email, phone, SSN, credit card numbers with Luhn checks,
  API-key-like strings, IP addresses, IBAN-like account ids, and passport-like
  identifiers.
- Secret/token pattern detection for AWS, GitHub, Slack, Stripe, Gemini,
  Anthropic-style keys, JWT-like tokens, and private key markers.
- PII and secret audit, redaction, block, or webhook actions.
- Lightweight prompt-injection checks for common hidden-prompt extraction,
  jailbreak, and instruction override language.
- Separate jailbreak and unsafe URL rules, including private network URL
  detection and allow/block domain lists.
- Tool-call policy checks for declared tools and output `tool_use` blocks.
- Named policy rules with `audit`, `redact`, `block`, `allow`, and `webhook`
  actions.
- Optional webhook sink with debounce, retry, timeout, max queue, and drop
  policy controls.
- Input hook, output hook, and streaming delta hook support.
- Lightweight JSON schema validation helpers for safe request/response
  documents or parsed JSON output.
- Conservative streaming behavior: deltas can be audited/redacted; a blocking
  output rule emits the configured blocked message once and drops later text
  deltas without throwing after SSE has started.

## Example

```yaml
plugins:
  - path: plugins/guardrails
    required: false
    config:
      enabled: true
      mode: audit # audit | redact | block
      max_findings_per_request: 50
      pii:
        enabled: true
        action: redact
        entities: [email, api_key, credit_card, ip_address, iban]
      secrets:
        enabled: true
        action: webhook
      prompt_injection:
        enabled: true
        action: block
      jailbreak:
        enabled: true
        action: block
      unsafe_url:
        enabled: true
        action: audit
        block_private_ips: true
      tool_call_policy:
        enabled: true
        action: block
        allowed_tools: [safe_lookup]
        require_known_tools: true
      policies:
        - name: allow-ticket-template
          direction: input
          pattern: "secret project TICKET-[0-9]+"
          action: allow
        - name: block-secret-project
          direction: input
          pattern: "(?i)secret project"
          action: block
        - name: redact-internal-output
          direction: output
          pattern: "(?i)internal only"
          action: redact
          redaction: "[internal]"
        - name: webhook-credential-dump
          direction: both
          pattern: "(?i)credential dump"
          action: webhook
      schema:
        enabled: true
        strict: true
        output:
          enabled: true
          action: audit
          trigger_fallback: false
          schema:
            type: object
            required: [ok]
            properties:
              ok:
                type: boolean
            additionalProperties: false
      webhook:
        enabled: false
        url: https://hooks.example.com/siftgate/guardrails
        include_actions: [webhook, block]
        debounce_seconds: 300
        timeout_ms: 5000
        max_queue: 100
        drop_policy: drop_newest
        retry:
          attempts: 3
          backoff_ms: 1000
      blocked_message: This content is blocked by local guardrails policy.
```

Legacy `input_patterns` and `output_patterns` are still supported. They use the
top-level `mode` as their default action.

## Config

| Field | Default | Notes |
|-------|---------|-------|
| `enabled` | `false` | Master switch. Disabled means no-op. |
| `mode` | `audit` | Default action for legacy patterns and enabled checks without an explicit action: `audit`, `redact`, or `block`. |
| `max_findings_per_request` | `50` | Caps privacy-safe findings stored in the per-request plugin store. Range: 1-500. |
| `input_patterns` | `[]` | Legacy input regex list. |
| `output_patterns` | `[]` | Legacy output regex list. |
| `policies[]` | `[]` | Named policy rules with `direction`, `pattern`, `action`, `redaction`, `severity`, and `category`. |
| `policies[].action` | inherited from `mode` | `audit`, `redact`, `block`, `allow`, or `webhook`. An allow match acts as a local policy exception for policy block/redact rules on the same text. |
| `pii.enabled` | `false` | Enables built-in PII detection. |
| `pii.action` | inherited from `mode` | `audit`, `redact`, `block`, or `webhook`. |
| `pii.entities` | all | `email`, `phone`, `ssn`, `credit_card`, `api_key`, `ip_address`, `iban`, `passport`. |
| `secrets.enabled` | `false` | Enables built-in secret/token pattern checks. |
| `secrets.action` | inherited from `mode` | `audit`, `redact`, `block`, or `webhook`. |
| `prompt_injection.enabled` | `false` | Enables built-in prompt-injection checks. |
| `prompt_injection.action` | inherited from `mode` | `audit`, `redact`, `block`, or `webhook`. |
| `jailbreak.enabled` | `false` | Enables jailbreak-specific patterns separately from broader prompt-injection checks. |
| `unsafe_url.enabled` | `false` | Detects unsafe URLs; private network hosts are unsafe unless `block_private_ips: false`. |
| `tool_call_policy.enabled` | `false` | Checks declared tools and output tool-use blocks against `allowed_tools`, `blocked_tools`, and `require_known_tools`. |
| `schema.enabled` | `false` | Enables schema helper rules. |
| `schema.strict` | `false` | Adds `additionalProperties: false` to object schema nodes that define `properties` but omit an explicit additional-properties policy. |
| `schema.input` | disabled | Validates a metadata-only canonical request document. |
| `schema.output` | disabled | Validates parsed JSON response text by default, or a safe response document when `parse_json: false`. |
| `schema.*.trigger_fallback` | `false` | Records fallback intent metadata for schema findings. Core structured-output fallback is still controlled by `routing.fallback_policy.structured_output`. |
| `webhook.enabled` | `false` | Enables asynchronous finding metadata delivery. Requires `webhook.url`. |
| `webhook.include_actions` | `[webhook]` | Which finding actions are exported. Include `block` if blocked findings should notify an external system. |
| `webhook.debounce_seconds` | `300` | Suppresses duplicate rule/action/direction deliveries inside the window. |
| `webhook.retry.attempts` | `3` | Per-delivery attempts. |
| `webhook.retry.backoff_ms` | `1000` | Delay between retry attempts. |
| `webhook.timeout_ms` | `5000` | Per-attempt timeout. |
| `webhook.max_queue` | `100` | In-memory queue cap. Request handling never waits for delivery. |
| `webhook.drop_policy` | `drop_newest` | `drop_newest` drops the new item when full; `drop_oldest` evicts one queued item. |
| `blocked_message` | built-in message | Returned when an input or output is blocked. |

Schema validation intentionally supports a small portable subset of JSON Schema:
`type`, `enum`, `const`, `required`, `properties`,
`additionalProperties: false`, `items`, `minLength`, `maxLength`, `pattern`,
`minimum`, `maximum`, `minItems`, and `maxItems`.

## Findings And Privacy

Findings are stored in the per-request plugin store under
`guardrails.findings`. A finding can include:

- `request_id`
- `direction`
- `kind`
- `rule`
- `action`
- `severity`
- `path`
- `category`
- `match_count`
- a schema error message that contains paths/types only

Findings do not include raw prompt text, response text, matched substrings,
provider keys, raw headers, media bytes, or video bytes. Logs include only
finding counts, rule names, actions, and request ids.

Webhook payloads use `version: siftgate.guardrails.findings.v1` and include
only the same privacy-safe finding metadata plus source format, original model
name, summary counts, and explicit privacy flags. Webhook URLs and configured
headers are never returned by Dashboard APIs.

The Dashboard `GET /api/dashboard/guardrails` endpoint exposes local plugin
status, finding counters, recent finding metadata, queue depth, dropped count,
and recent webhook delivery state. It does not expose prompt/response text,
raw headers, provider keys, webhook URL, or webhook headers.

## Structured Output

For non-streaming output, schema validation can audit or block invalid output.
For structured-output fallback, prefer the core
`routing.fallback_policy.structured_output` setting because it runs before a
successful upstream attempt is accepted. The guardrails `schema.trigger_fallback`
flag records local fallback intent metadata for operators, and block mode can
replace the final response with `blocked_message`.

For streaming output, the plugin never throws after the stream has started. It
can redact output deltas, or emit the blocked message once and drop later text
deltas. This keeps SSE framing intact.

## Safety

- Disabled by default.
- Runs locally in the Data Plane. The optional webhook sink sends metadata only
  and must be explicitly enabled by the operator.
- Does not export prompts, responses, provider keys, raw headers, media bytes, or
  video bytes.
- Stores only privacy-safe finding metadata.
- Compatible with production Docker because `npm run build` compiles official
  plugins into `dist-runtime-plugins`.
