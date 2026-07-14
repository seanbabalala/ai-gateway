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
- management audit events
- first-run onboarding evidence
- platform benchmark reports

Features that can store samples or replayable responses require explicit configuration and should be documented in local operating procedures.

## API Keys

Gateway API keys are shown in full only once at creation or rotation time. Lists and details return masked values. Local teams, namespaces, budgets, rate limits, endpoint permissions, modality permissions, node permissions, and model permissions are enforced before provider forwarding.

## Dashboard Login And OIDC

Dashboard authentication is required by default. When neither local password nor
OIDC is configured, SiftGate generates an initial local Dashboard password on
first startup, logs it once, hashes it with bcrypt, and persists only the hash
to `gateway.config.yaml`. Set `dashboard.auth_required=false` only for trusted
local development environments. In `NODE_ENV=production`, SiftGate ignores
`dashboard.auth_required=false` unless
`SIFTGATE_ALLOW_UNAUTHENTICATED_DASHBOARD=true` is explicitly set.

Local Dashboard password login remains available for self-hosted installs.
Generic OIDC login is optional and disabled unless `dashboard.oidc.enabled=true`.
When OIDC is enabled without a local password, set `dashboard.session_secret`
through an environment or external secret reference so Dashboard JWTs are stable
across restarts and instances.

Successful Dashboard login sets an HttpOnly, SameSite=Lax
`siftgate_dashboard_session` cookie. Dashboard APIs still accept bearer tokens
for compatibility, but browser Server-Sent Events use the cookie-first path so
session tokens do not need to be placed in SSE URLs during normal operation.

Store OIDC client secrets as secret references such as
`${env:OIDC_CLIENT_SECRET}`. Dashboard auth status only exposes whether OIDC is
enabled plus issuer/client metadata; it never returns client secrets.

Workspace invitations store only a SHA-256 hash of the invitation token. The
plain token is returned once when the Admin creates the invite. OIDC login state
stores only a nonce and invitation token hash, not the reusable invitation token.

## Reporting Vulnerabilities

See the root [SECURITY.md](../SECURITY.md) for reporting instructions.
