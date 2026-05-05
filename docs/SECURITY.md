# Security

SiftGate is designed for local operation with privacy-safe defaults.

## Secret Handling

- Do not commit `gateway.config.yaml` with real credentials.
- Prefer environment or secret references for provider keys.
- Dashboard responses mask provider keys, Gateway API keys, webhook secrets, secret manager resolved values, and authorization headers.
- `catalog.override.yaml` is not a secret store.

## Metadata-Only Defaults

The following surfaces avoid prompt/response persistence by default:

- call logs
- route decision traces
- shadow comparison reports
- provider compatibility tests
- guardrails findings
- MCP audit entries
- batch and video job metadata
- semantic cache
- evaluation reports

Features that can store samples or replayable responses require explicit configuration and should be documented in local operating procedures.

## API Keys

Gateway API keys are shown in full only once at creation or rotation time. Lists and details return masked values. Local teams, namespaces, budgets, rate limits, endpoint permissions, modality permissions, node permissions, and model permissions are enforced before provider forwarding.

## Reporting Vulnerabilities

See the root [SECURITY.md](../SECURITY.md) for reporting instructions.
