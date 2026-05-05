# Optional Control Plane Contract

SiftGate can optionally connect an open-source Data Plane to an external control plane. This feature is disabled by default and is not required for local gateway traffic.

The Data Plane remains fully usable with local configuration, local provider credentials, SQLite or PostgreSQL, and optional Redis shared state.

## Architecture

```text
User App -> SiftGate Data Plane -> Provider APIs
                     |
                     | optional heartbeat / telemetry / policy pull
                     v
              External Control Plane API
```

The Data Plane initiates outbound requests. Operators do not need to expose inbound gateway ports for control-plane access.

## Configuration

```yaml
control_plane:
  enabled: false
  url: "https://control-plane.example.com"
  gateway_id: "gw_prod_us"
  registration_token: "${env:GATEWAY_REGISTRATION_TOKEN}"
  telemetry:
    upload_interval_seconds: 30
    include_prompt: false
    include_response: false
```

Use a secret reference or environment variable for registration tokens. Do not commit resolved tokens.

## Data Plane Endpoints Expected Upstream

An external control plane can implement these Data Plane-facing endpoints:

- `POST /api/control/register`
- `POST /api/control/heartbeat`
- `POST /api/control/telemetry/batch`
- `GET /api/control/policy/latest`

Realtime control events are future work. If added later, they should use outbound SSE, WebSocket, or long-polling so the Data Plane does not need inbound exposure.

## Telemetry Payload

Telemetry is derived from local call-log metadata:

- request id
- Gateway API key id
- node, model, tier, score
- latency, status, tokens, estimated cost
- fallback, fallback reason, retry count
- cache hit and policy metadata
- timestamp

By default telemetry does not include prompt text, response text, tool input payloads, provider API keys, raw authorization headers, media bytes, video bytes, or secret manager resolved values.

## Policy Bundles

The Data Plane can pull a policy bundle shape such as:

```json
{
  "version": 42,
  "gateway_id": "gw_prod_us",
  "mode": "recommendation_or_enforced",
  "routing": {},
  "budgets": {},
  "rate_limits": {},
  "api_key_policies": {},
  "emergency_overrides": [],
  "created_at": "2026-04-30T00:00:00Z",
  "expires_at": "2026-05-01T00:00:00Z"
}
```

Applying remote policy to live local routing should remain behind explicit operator configuration and rollback semantics.

## Boundary

The open-source repository owns the Data Plane contract and runtime. It must not import private packages or require a hosted service to serve `/v1/*`, `/mcp/*`, Dashboard, batch, cache, eval, or routing traffic.
