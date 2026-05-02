# Product Roadmap

SiftGate is moving from an open-source gateway into an AI traffic control plane.

The core rule is simple: the open-source gateway remains a complete self-hosted data plane. The future cloud product manages fleet policy, governance, analytics, and router recommendations without proxying customer AI traffic by default.

## Positioning

SiftGate is the control plane for enterprise AI traffic:

- self-hosted data planes for real AI requests
- cloud control plane for fleet governance and policy feedback
- multi-protocol routing across Chat Completions, Responses, Messages, and OpenAI-compatible models
- privacy-preserving metadata analytics for cost, health, and reliability
- Vercel-level setup experience with a Cloudflare-style control-plane model for AI gateways

## Version Strategy

### v0.1 Open Source Gateway

Goal: publish now and win developer trust.

Included:

- `/v1/chat/completions`
- `/v1/responses`
- `/v1/messages`
- `/v1/models`
- Dashboard
- Gateway API keys
- per-key budgets and rate limits
- smart routing
- fallback, retry, circuit breaker, momentum, and A/B split
- prompt cache
- plugins
- OpenTelemetry
- Docker quickstart and smoke test

Release work:

- README first-run path
- Docker quickstart
- comparison docs
- contributing guide
- security policy
- changelog
- open-core boundary

### v0.2 Connected Gateway

Goal: let self-hosted gateways connect to a cloud control plane while keeping AI traffic local.

Included in the data plane:

- `control_plane` config block, disabled by default
- gateway registration using a registration token
- short-lived access token handling
- heartbeat
- privacy-preserving telemetry upload from call logs
- latest policy bundle pull
- in-memory policy bundle storage

The cloud service is expected to expose:

- `POST /api/control/register`
- `POST /api/control/heartbeat`
- `POST /api/control/telemetry/batch`
- `GET /api/control/policy/latest`
- `GET /api/control/events/stream`

### v0.3 Cloud Control Plane

Goal: deliver a real hosted control plane, not a thin MVP.

Core product areas:

- Workspace creation, members, invites, and roles
- Gateway fleet inventory, online/offline state, version drift, config drift, and last heartbeat
- Telemetry analytics for throughput, latency, error rate, tokens, cost, fallback, retry, and cache hit
- Policy bundles for routing tiers, fallback chains, rate limits, budgets, allowed nodes/models, and emergency disables
- Audit log for workspace, gateway, policy, API key, budget, and emergency override events
- Router recommendations based on fleet metadata
- One-click recommendation publish with rollback

### v1.0 Enterprise AI Traffic Control Plane

Goal: enterprise-ready paid deployment.

Enterprise capabilities:

- SSO and SCIM
- RBAC and approval workflows
- policy history, rollout, and rollback
- audit export
- compliance controls
- advanced smart router recommendations
- Autopilot with explicit guardrails
- per-environment policies
- SLA

## Architecture

```text
User App
  -> Customer SiftGate Data Plane
  -> OpenAI / Anthropic / Custom Provider

Customer SiftGate Data Plane
  -> heartbeat / telemetry / audit metadata
  -> Cloud Control Plane

Cloud Control Plane
  -> policy bundle / router recommendations / emergency controls
  -> Customer SiftGate Data Plane
```

Default guarantees:

- Cloud does not proxy AI requests.
- Cloud does not store prompts.
- Cloud does not store responses.
- Cloud does not need provider API keys.
- Customers do not need to expose inbound gateway ports.

## Metadata Boundary

The connected data plane can upload:

- workspace id
- gateway id
- request id
- Gateway API key id
- node id
- model
- tier
- score
- domain hint
- modality
- latency
- status code
- input tokens
- output tokens
- estimated cost
- fallback used
- retry count
- cache hit
- policy hits
- timestamp

The connected data plane must not upload by default:

- prompt text
- response text
- tool input payloads
- provider API keys
- raw headers containing secrets

## Smart Router Roadmap

Open source:

- existing scoring, tiers, domain preferences, fallbacks, momentum, and A/B split
- user-managed router parameters

Connected:

- anonymized route outcomes
- cost, latency, and failure insights
- recommended route changes

Paid:

- adaptive recommendations by tier, domain, model, key, and environment
- savings reports
- reliability reports
- provider degradation detection
- one-click recommendation publish

Enterprise:

- Autopilot with guardrails
- eval-aware router tuning
- approval workflow
- fleet-wide rollout and rollback
- per-environment routing policy

## Business Model

SiftGate should not depend on AI API resale.

- Open source remains free and complete for self-hosted data-plane operation.
- Cloud beta can start free to learn from real teams and real metadata.
- Team: workspace, gateway fleet, metadata analytics, and policy sync.
- Business: RBAC, audit, recommendations, and policy history.
- Enterprise: SSO, SCIM, approvals, audit export, Autopilot, and SLA.

Optional fully hosted gateways can be offered later for small teams, but should be priced and limited separately because hosted data planes carry real request, streaming, and provider-call cost.

## Test Plan

Open-source release:

```bash
npm test -- --runInBand
npm run test:e2e
cd frontend && npm run build
npm run smoke:docker
```

Connected gateway:

- registration token success and failure
- heartbeat online, offline, and recovery
- telemetry retry and queue behavior
- policy pull success, expiry, and rollback handling
- cloud unavailable while local gateway continues on the last valid local behavior

Privacy:

- telemetry defaults exclude prompts and responses
- provider keys never appear in telemetry, logs, or policy bundles
- displayed secrets use masked prefixes only

Router feedback:

- metadata aggregation produces recommendations
- recommendations stay inside allowed models and nodes
- Autopilot requires explicit enablement

Regression:

- `control_plane.enabled=false` preserves current self-hosted behavior
- all existing `/v1/*` request paths stay compatible
