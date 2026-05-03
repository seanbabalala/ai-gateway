# guardrails

Official SiftGate guardrails plugin for the MIT Data Plane. It runs local
audit, redact, and block checks before upstream calls and after responses return.
No external moderation service is called.

## Features

- Local regex policy rules for input and output text.
- Built-in PII checks for email, phone, SSN, credit card, and API-key-like
  strings.
- Built-in prompt-injection checks for common jailbreak and hidden-prompt
  extraction language.
- Lightweight input and output JSON schema validation.
- Conservative streaming support: output deltas can be audited/redacted; a
  blocked stream sends the configured blocked message once and drops later text
  deltas.

## Example

```yaml
plugins:
  - path: plugins/guardrails
    required: false
    config:
      enabled: true
      mode: audit
      pii:
        enabled: true
        action: redact
        entities: [email, api_key, credit_card]
      prompt_injection:
        enabled: true
        action: block
      rules:
        - name: local-secret-project
          direction: input
          pattern: "(?i)secret project"
          action: block
      schema_validation:
        output:
          enabled: true
          action: audit
          schema:
            type: object
            required: [ok]
            properties:
              ok:
                type: boolean
            additionalProperties: false
      blocked_message: This content is blocked by local guardrails policy.
```

## Config

| Field | Default | Notes |
|-------|---------|-------|
| `enabled` | `false` | Master switch. Disabled means no-op. |
| `mode` | `audit` | Legacy default for `input_patterns` / `output_patterns`: `audit` or `block`. |
| `input_patterns` | `[]` | Legacy input regex list, kept for compatibility. |
| `output_patterns` | `[]` | Legacy output regex list, kept for compatibility. |
| `rules[]` | `[]` | Named policy rules with `direction`, `pattern`, `action`, `redaction`, and `severity`. |
| `pii.enabled` | `false` | Enables built-in PII detection. |
| `pii.action` | `audit` | `audit`, `redact`, or `block`. |
| `pii.entities` | all | `email`, `phone`, `ssn`, `credit_card`, `api_key`. |
| `prompt_injection.enabled` | `false` | Enables built-in prompt-injection patterns. |
| `prompt_injection.action` | `audit` | `audit`, `redact`, or `block`. |
| `schema_validation.input` | disabled | Validates a metadata-only request document. |
| `schema_validation.output` | disabled | Validates JSON parsed from response text by default. |
| `blocked_message` | built-in message | Message returned when a request/response is blocked. |
| `include_prompt_in_logs` | `false` | Logs finding metadata only; never logs raw prompt/response text. |

Schema validation intentionally supports a small portable subset of JSON Schema:
`type`, `enum`, `const`, `required`, `properties`, `additionalProperties:
false`, `items`, `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`,
`minItems`, and `maxItems`.

## Safety

- Disabled by default.
- Runs locally in the Data Plane and does not call external services.
- Stores only finding metadata in the per-request plugin store.
- Logs finding counts, rule names, categories, paths, and schema errors; it does
  not log matched prompt or response text.
- Does not export prompts, responses, provider keys, or raw headers.
