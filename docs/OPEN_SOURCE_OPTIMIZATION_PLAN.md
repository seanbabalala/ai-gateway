# Open Source Optimization Plan

This checklist tracks the product work needed before opening SiftGate to outside users. The goal is not just to make the project runnable, but to make the first setup understandable, diagnosable, and hard to misconfigure.

## Priority 1: Naming Model Clarity

**Goal:** A new user should immediately understand that an upstream node is not a model.

Definitions:

- **Node:** An upstream provider account, deployment, proxy route, or API endpoint.
- **Model:** A model ID exposed by a node.
- **Alias:** A client-facing shortcut resolved by the gateway before upstream calls.
- **Route target:** Always a `node + model` pair.

Acceptance criteria:

- README has a clear Node vs Model vs Alias section.
- Example configs use provider/channel names such as `openai`, `anthropic`, `azure-prod`, and `local-vllm`.
- Dashboard warns when direct routing names are ambiguous.
- Existing local configs are not silently renamed; provide a migration path instead.

## Priority 2: First Request Path

**Goal:** A new user can create a Gateway API key and send a successful request without guessing the header, model field, or routing mode.

Acceptance criteria:

- API Keys page explains Gateway API keys vs provider API keys.
- Created-key dialog shows an auto-routing curl command.
- If direct routing is enabled, the dialog also shows a direct model curl command.
- README explains that provider secrets stay in `.env`, while client Gateway API keys are generated in the dashboard.

## Priority 3: Configuration Health

**Goal:** Misconfiguration should be visible in the product, not hidden in logs.

Checks to expose:

- Duplicate model IDs across nodes.
- Alias conflicts with real model IDs.
- Alias names that equal node IDs.
- Model IDs that equal node IDs.
- Duplicate aliases across nodes.
- Missing or incomplete model pricing.
- Routing references to unknown nodes/models.
- Dashboard password not configured for public deployments.

Acceptance criteria:

- `/api/dashboard/config` and `/api/dashboard/nodes` return structured diagnostics.
- Nodes page shows node/model naming diagnostics.
- Dashboard overview shows a compact configuration health summary.

## Priority 4: Docker Quickstart

**Goal:** `docker compose up -d` should be the recommended open-source path.

Status: documented and covered by `npm run smoke:docker`.

Acceptance criteria:

- README has a 5-minute Docker quickstart.
- `.env.example` separates provider secrets from dashboard-generated Gateway API keys.
- `gateway.config.example.yaml` works as a template without leaking real secrets.
- SQLite data is persisted via a mounted `data/` directory.
- Healthcheck is documented.
- Docker smoke creates a Gateway API key, verifies `auto` and direct routing, checks billing by `api_key_id`, restarts the gateway, and confirms SQLite persistence.

## Priority 5: Billing Loop

**Goal:** Requests authenticated with a Gateway API key should be attributable, billable, and enforceable.

Status: implemented. See [Billing Loop](./BILLING_LOOP.md) for the accounting invariants.

Acceptance criteria:

- Call logs store API key id, API key name, node, model, tokens, status, latency, and cost.
- Budget pages can filter generated Gateway keys by immutable id and legacy YAML keys by name.
- API key budgets and rate limits are visible and editable.
- Pricing gaps are surfaced as configuration warnings.
- Over-budget responses are clear enough for client developers to debug.

## Priority 6: Open Source Polish

**Goal:** The repository feels ready for contributors and self-hosters.

Acceptance criteria:

- README has architecture, setup, API, configuration, and troubleshooting sections.
- Example commands copy cleanly.
- Tests cover API key routing permissions and config diagnostics.
- Docker, local dev, and production start paths are all documented.
- Known warnings are documented or fixed.
- GitHub Actions runs the Docker smoke test on pull requests and main/master pushes.
