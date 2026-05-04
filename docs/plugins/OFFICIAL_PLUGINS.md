# Official Runtime Plugins

SiftGate v0.4 introduced the first MIT-licensed official plugin batch for the open-source Data Plane, and v0.9 upgrades the official guardrails plugin from a skeleton into a usable local safety plugin. Plugins live under `plugins/`, are compiled by `npm run build` into `dist-runtime-plugins`, and are copied into the production Docker image.

All official plugins are disabled or no-op by default. External exports never include prompts, responses, provider keys, raw headers, authorization headers, passwords, secrets, or tokens unless an operator explicitly opts into that behavior.

## Plugins

| Plugin | Path | Purpose |
|--------|------|---------|
| redis-cache | `plugins/redis-cache` | Optional Redis-backed canonical response cache |
| analytics-sink | `plugins/analytics-sink` | Optional sanitized call-log analytics webhook |
| request-transform | `plugins/request-transform` | Local canonical request rewrite rules |
| guardrails | `plugins/guardrails` | Local PII, secret/token, prompt-injection, jailbreak, unsafe URL, schema, tool-call, policy, and optional webhook finding guardrails |

## Enabling

Declare plugins in `gateway.config.yaml`:

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
      prompt_injection:
        enabled: true
        action: block
      policies:
        - name: block-secret-project
          direction: input
          pattern: "(?i)secret project"
          action: block
```

`required: false` is recommended while testing. Required plugin load failures stop gateway startup.

## Build And Docker

```bash
npm run build
ls dist-runtime-plugins/plugins
```

The Dockerfile builds plugins during the backend build stage and copies `dist-runtime-plugins` into the production image. Source plugin READMEs and example configs are developer documentation; the runtime only needs the compiled plugin JavaScript.

## Safety Notes

- `redis-cache`: sends hashed cache keys to Redis. It stores response bodies only when `store_responses: true` is explicitly set.
- `analytics-sink`: uses a safe allow-list of call-log metadata. `include_prompt_response: true` is required before prompt/response-like fields are eligible for export.
- `request-transform`: performs local request mutations only and has no network path.
- `guardrails`: performs local PII, secret/token, prompt-injection, jailbreak, unsafe URL, schema, tool-call, and policy checks. It stores/logs finding metadata only: request id, rule, kind, action, count, path, and schema error summaries. Optional webhook delivery sends the same metadata asynchronously with debounce, retry, timeout, max queue, and drop policy controls. It does not log or export matched prompt/response text, raw headers, provider keys, media bytes, video bytes, webhook URLs, or webhook headers.

Each plugin has its own README and example config:

- [redis-cache](../../plugins/redis-cache/README.md)
- [analytics-sink](../../plugins/analytics-sink/README.md)
- [request-transform](../../plugins/request-transform/README.md)
- [guardrails](../../plugins/guardrails/README.md)
