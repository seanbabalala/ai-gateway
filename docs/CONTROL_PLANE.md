# Connected Gateway Control Plane

Connected Gateway is the bridge between the open-source SiftGate Data Plane and SiftGate Cloud. It is disabled by default, and the data plane continues to run fully self-hosted unless `control_plane.enabled` is set to `true`.

## Architecture

```text
User App -> Customer SiftGate Data Plane -> Provider APIs
                     |
                     | heartbeat / telemetry / policy sync
                     v
              SiftGate Cloud Control Plane
```

The data plane initiates outbound connections. Customers do not need to expose inbound ports for control-plane access.

## Data Plane Configuration

For local Cloud development, create a registration token in the Cloud Dashboard or use the dev seed token printed by `npm run dev:local` in the private `siftgate-cloud` workspace:

```text
grt_demo_local_registration_token_do_not_use_prod_20260501
```

```yaml
control_plane:
  enabled: true
  url: "http://localhost:3100"
  gateway_id: "gw_local_dev"
  registration_token: "${GATEWAY_REGISTRATION_TOKEN}"
  telemetry:
    upload_interval_seconds: 30
    include_prompt: false
    include_response: false
```

Use `https://api.siftgate.dev` as the production API placeholder until the hosted domain is finalized.

## Automatic Lifecycle

When enabled, the data plane starts the Cloud connection lifecycle during NestJS module initialization:

- **Register:** `POST /api/control/register` runs automatically on boot with the configured `gateway_id`, package version, supported protocols, and privacy defaults.
- **Access token:** Cloud returns `workspace_id`, `gateway_id`, and a gateway access JWT. The registration token is only used for registration or token rotation.
- **Heartbeat:** the data plane sends `POST /api/control/heartbeat` every 30 seconds with `workspace_id`, `gateway_id`, `status: online`, and a timestamp.
- **Telemetry:** call metadata is queued from local `call_logs` and uploaded to `POST /api/control/telemetry/batch` every `control_plane.telemetry.upload_interval_seconds` seconds.
- **Policy sync:** the data plane polls `GET /api/control/policy/latest?gateway_id=<gateway_id>` every 60 seconds and keeps the latest bundle in memory.

## Control Plane Endpoints

The current Data Plane client expects SiftGate Cloud to expose exactly these Data Plane-facing endpoints:

- `POST /api/control/register`
- `POST /api/control/heartbeat`
- `POST /api/control/telemetry/batch`
- `GET /api/control/policy/latest`

Realtime control events are intentionally future work. If added later, they should use outbound SSE, WebSocket, or long-polling so customers do not need to expose inbound gateway ports. When a control event arrives, the gateway should pull the latest policy bundle instead of trusting large policy payloads pushed over the event stream.

Dashboard/workspace APIs are separate from this Data Plane contract:

- `POST /api/workspaces`
- `GET /api/workspaces/:id/gateways`
- `POST /api/workspaces/:id/gateway-tokens`
- `GET /api/workspaces/:id/telemetry/summary`
- `GET /api/workspaces/:id/recommendations`
- `POST /api/workspaces/:id/policies`
- `POST /api/workspaces/:id/policies/:version/publish`
- `POST /api/workspaces/:id/policies/:version/rollback`

## Local Compatibility Smoke

From the private `siftgate-cloud` workspace, run:

```bash
npm run data-plane:smoke
```

The smoke test reads the public Data Plane contract sources, starts the local Cloud API against test PostgreSQL/Redis, registers a gateway with the same payload shape emitted by `src/control-plane/control-plane-client.service.ts`, sends heartbeat and telemetry, pulls the latest policy, verifies `ETag`/`304`, and confirms the Cloud Fleet API shows the gateway online with one telemetry event.

## Telemetry Payload

Telemetry events are derived from `call_logs` and contain metadata only:

- workspace id and gateway id
- request id and Gateway API key id
- node, model, tier, score
- latency, status, input/output tokens, estimated cost
- fallback, retry count, cache hit, policy hits
- timestamp

By default telemetry does not include:

- prompt text
- response text
- tool input payloads
- provider API keys
- raw headers containing secrets

## Policy Bundles

The hosted control plane can return a policy bundle:

```json
{
  "version": 42,
  "workspace_id": "ws_123",
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

The first connected-gateway implementation stores the latest bundle in memory. Applying cloud policies to live local routing should be introduced behind an explicit mode and rollback path.

## Feedback Loop

```text
metadata upload
  -> cloud analytics
  -> router recommendation
  -> admin approval or explicit Autopilot
  -> policy bundle publish
  -> gateway pulls policy
  -> local gateway executes
```

Recommendations must stay inside customer-defined allowed nodes, allowed models, budgets, rate limits, and emergency disables. Autopilot should be unavailable unless the workspace explicitly enables it and should always preserve rollback.

## Cloud Product Surface

Workspace roles:

- owner
- admin
- developer
- viewer

Gateway fleet:

- gateway registration
- online and offline state
- version drift
- config drift
- last heartbeat
- throughput, latency, and error rate

Policy bundles:

- routing tiers
- fallback chains
- rate limits
- budgets
- allowed nodes and models
- emergency disables
- policy version and expiry

Audit events:

- user login
- invite accepted
- gateway registered
- policy published
- routing changed
- API key changed
- budget exceeded
- emergency override

Smart router tiers:

- open source: user-managed router parameters
- paid cloud: recommendations from metadata analytics
- enterprise: Autopilot with guardrails and approval workflow
