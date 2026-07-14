# AI Gateway Overnight Optimization Plan

Review date: 2026-07-14
Execution mode: Goal-driven overnight merge loop

Scope: production hardening review for the SiftGate / AI Gateway repository,
focused on security boundaries, request lifecycle reliability, cost governance,
configuration safety, MCP isolation, frontend performance, and release gates.

This plan is intentionally action-oriented. It is not a full audit report; it is
an overnight execution plan for turning the current healthy codebase into a
stronger production platform through small, reviewable pull requests.

This is not a 90-day roadmap. Long-horizon themes are useful for prioritization,
but execution must happen as a trunk-based loop: pick one small improvement,
branch from a synchronized `main`, implement, validate, commit, push, open a PR,
wait for checks, merge, delete the branch, and return local `main` to the exact
`origin/main` baseline before taking the next item.

## Current Baseline

The project has a solid foundation: broad unit coverage, clear module
boundaries, metadata-only privacy defaults, explicit production docs, and
existing controls for API keys, budgets, rate limits, audit logs, state backend,
MCP, and provider compatibility.

Baseline commands run during this review:

| Command | Result |
| --- | --- |
| `npm test -- --runInBand` | Passed: 102 suites, 1442 tests |
| `npm run build` | Passed for backend and runtime plugin types |
| `npm run lint` | Passed with 34 existing warnings and 0 errors |
| `npm run public:check` | Passed |
| `npm run build` in `frontend/` | Passed; Vite warned about large chunks |

Latest synchronized baseline after the first overnight PR loop:

| Field | Value |
| --- | --- |
| Branch | `main` |
| Local HEAD | `32867f63e948a49199888803d06caca000334ce2` |
| `origin/main` | `32867f63e948a49199888803d06caca000334ce2` |
| Worktree | Clean |

Frontend build size baseline:

| Asset | Minified | Gzip |
| --- | ---: | ---: |
| `dist/assets/index-DWCjXgzY.js` | 1746.29 kB | 463.52 kB |
| `dist/assets/generateCategoricalChart-BQsoaK7q.js` | 384.31 kB | 106.12 kB |
| `dist/assets/NodesPage-Cot3am2S.js` | 107.21 kB | 23.75 kB |

## Optimization Principles

- Preserve the privacy contract: prompt bodies, responses, provider keys, raw
  headers, tool payloads, hidden reasoning, and resolved secrets should remain
  out of logs and persisted metadata unless explicitly enabled.
- Make management-plane authentication fail closed. Developer convenience can
  remain available, but production paths should not silently open.
- Treat streaming as a first-class request lifecycle, not only a fetch response.
  Timeouts must cover connect, headers, body progress, total duration, and
  client disconnect.
- Move cost controls from best-effort accounting toward concurrency-safe
  enforcement.
- Prefer small, reversible changes with measurable gates over broad rewrites.
- Convert every P0/P1 item into regression tests before or during the fix.

## Priority Model

| Priority | Meaning | Tonight handling |
| --- | --- | --- |
| P0 | Security or production safety issue that can expose management surfaces or secrets | Implement first, one PR per item when small enough |
| P1 | Reliability, cost, or data-integrity issue with material production impact | Implement next if the change can be tested and merged safely |
| P2 | Performance, maintainability, and quality-gate improvements | Pick low-risk quick wins after P0/P1 foundations |

## Overnight Execution Record

Completed PRs in the current Goal loop:

| PR | Commit merged to `main` | Slice | Result |
| --- | --- | --- | --- |
| #43 | `cbb5aa98` | Redact streaming provider errors | Shared provider redaction helper and redacted stream interruption/error surfaces |
| #44 | `645d546a` | Guard unauthenticated dashboard in production | `dashboard.auth_required=false` fails closed in production unless explicitly overridden |
| #45 | `dc99d6f4` | Timeout stalled provider streams | Stream body idle timeout emits timeout errors after stream start |
| #46 | `32867f63` | Fallback before stream chunks | Reader failures before any forwarded stream data now throw `ProviderError` so pipeline fallback can run |

Every merged PR followed this loop:

1. Start from clean `main` synchronized with `origin/main`.
2. Create a `codex/<topic>` branch.
3. Implement exactly one small optimization.
4. Run focused tests, then required broader checks.
5. Commit, push, open PR, wait for GitHub checks.
6. Merge after checks pass and delete the remote branch.
7. Return local `main` to the same SHA as `origin/main`.

## Immediate PR Queue

The next slices should stay intentionally narrow. Do not batch these unless a
testable code path forces two items to land together.

| Order | Branch | Slice | Main files | Required validation |
| ---: | --- | --- | --- | --- |
| 1 | `codex/auth-status-fail-closed` | Frontend auth status fetch failure blocks protected dashboard routes instead of assuming auth disabled | `frontend/src/contexts/AuthContext.tsx`, auth route tests | `cd frontend && npm test && npm run build`; auth unit tests if available |
| 2 | `codex/oidc-fetch-timeouts` | Add explicit timeouts and stable errors for OIDC discovery, token, userinfo, and JWKS fetches | `src/auth/oidc.service.ts`, auth tests | `npm test -- --runInBand test/unit/auth-service.spec.ts test/unit/auth-controller.spec.ts`; `npm run build` |
| 3 | `codex/mcp-env-allowlist` | Stop MCP stdio children from inheriting the full process environment by default | `src/mcp/mcp-gateway.service.ts`, MCP tests, config docs | `npm test -- --runInBand test/unit/mcp-gateway-service.spec.ts`; `npm run build`; `npm run public:check` |
| 4 | `codex/public-5xx-errors` | Return generic public messages for unexpected 5xx errors while keeping logs diagnostic | `src/http/public-error-handling.ts`, controller tests | `npm test -- --runInBand test/unit/public-error-handling.spec.ts test/unit/ingest-controllers.spec.ts` |
| 5 | `codex/atomic-config-writes` | Replace dashboard/config restore direct writes with atomic temp-file rename flow | `src/config/config.service.ts`, config tests | `npm test -- --runInBand test/unit/config-service.spec.ts test/unit/config-mutations.spec.ts`; `npm run build` |
| 6 | `codex/api-key-last-used-debounce` | Debounce non-critical API key/team `last_used_at` writes | `src/auth/gateway-api-key.service.ts`, auth tests | `npm test -- --runInBand test/unit/gateway-api-key-service.spec.ts test/unit/api-key-guard.spec.ts` |
| 7 | `codex/lint-warning-zero-baseline` | Clear current lint warnings and move toward zero-warning CI | files reported by `npm run lint` | `npm run lint`; `npm test -- --runInBand` if touched tests contain behavior |
| 8 | `codex/frontend-manual-chunks` | Isolate chart-heavy frontend chunks and add a bundle budget baseline | `frontend/vite.config.ts`, chart pages | `cd frontend && npm test && npm run build` |

## Key Findings

### P0: Dashboard Auth Should Fail Closed

Evidence:

- `src/auth/dashboard.guard.ts:13-20` allows dashboard access whenever
  `authService.isAuthRequired` is false.
- `src/auth/auth.service.ts:17-20` makes auth secure by default, but explicit
  `dashboard.auth_required=false` still opens the dashboard.
- `frontend/src/contexts/AuthContext.tsx:78-84` treats `/api/auth/status`
  failures as `authRequired=false`.

Risk:

The backend opt-out is documented for trusted local development, but the
frontend status fallback is dangerous: a temporary status failure can make the
UI believe auth is not required. The backend guard still protects API routes
when auth is required, but the UX state and route protection should not fail
open.

Target outcome:

- Frontend auth status failures enter an explicit `unknown/error` state and keep
  protected routes blocked.
- Production startup warns loudly or fails when `dashboard.auth_required=false`
  unless an explicit development override is present.
- Tests cover auth status network failure and disabled-auth development mode.

Status:

- Backend production guard completed in PR #44.
- Frontend auth status failure behavior remains an immediate follow-up PR.
- Cookie session and SSE query-token replacement remain separate session
  hardening PRs.

### P0: Dashboard Tokens Appear In URL And Browser Storage

Evidence:

- `src/auth/dashboard.guard.ts:44-58` accepts JWTs from the `token` query
  parameter for SSE / EventSource.
- `frontend/src/lib/sse.ts:9-17` appends the JWT to SSE URLs.
- `src/auth/oidc.service.ts:158-164` returns OIDC login tokens in the URL hash.
- `frontend/src/contexts/AuthContext.tsx:29-40` stores the dashboard token in
  `localStorage`.

Risk:

Query tokens can be captured by browser history, reverse proxies, access logs,
referer propagation, and support screenshots. `localStorage` increases token
exposure under XSS. URL hash is less visible to the server, but still lives in
browser history and client-side telemetry surfaces.

Target outcome:

- Move dashboard session handling to HttpOnly, Secure, SameSite cookies.
- Replace query-token SSE with cookie-authenticated EventSource or a very short
  lived, single-use SSE ticket.
- Keep bearer token support only behind a compatibility window, with warnings
  and tests.

### P1: OIDC Fetches Need Explicit Timeout And Error Classification

Evidence:

- `src/auth/oidc.service.ts:187` discovery fetch has no explicit timeout.
- `src/auth/oidc.service.ts:217-221` token exchange fetch has no explicit
  timeout.
- `src/auth/oidc.service.ts:239-241` userinfo fetch has no explicit timeout.
- `src/auth/oidc.service.ts:321-323` JWKS fetch has no explicit timeout.

Risk:

A slow or unreachable identity provider can hang dashboard login paths longer
than intended and create poor operator experience during incidents.

Target outcome:

- Introduce a shared `fetchWithTimeout` helper for auth/control-plane style
  calls.
- Use short, configurable OIDC timeouts with safe defaults.
- Return stable auth errors while logging diagnostic context without secrets.

### P1: Provider Timeout Does Not Cover Full Streaming Lifecycle

Evidence:

- `src/providers/provider-client.service.ts:585-607` creates an
  `AbortController` and sends provider fetch requests.
- `src/providers/provider-client.service.ts:646-649` clears the timeout when
  `fetch()` resolves, which protects connect/headers but not necessarily a slow
  streaming body.

Risk:

For long-lived streaming responses, a provider can stop sending body data after
headers and still hold resources. This can increase worker pressure, connection
pool exhaustion, and user-visible tail latency.

Target outcome:

- Split provider timeouts into connect/header timeout, idle read timeout, and
  max stream duration.
- Propagate client disconnect through all stream readers and provider body
  consumption.
- Add stream tests for slow headers, no body progress, partial body, and client
  abort.

Status:

- Stream body idle timeout completed in PR #45.
- Pre-first-forwarded-data reader failures now throw connection-phase
  `ProviderError` and can trigger fallback as of PR #46.
- Max stream duration and deeper client-abort propagation remain follow-up
  lifecycle PRs.

### P1: Provider Error Bodies Need Stronger Redaction

Evidence:

- `src/providers/provider-client.service.ts:657-668` reads upstream error bodies
  and embeds up to 500 characters in `ProviderError`.
- `src/providers/provider-client.service.ts:749-755` does the same for media
  requests.
- `src/providers/provider-client.service.ts:659-663` can log a request body
  preview when `GATEWAY_DEBUG_MESSAGES_BODY=1`.

Risk:

Upstream providers sometimes echo request fragments, validation payloads, or
headers in error responses. The gateway already has metadata-only defaults, but
provider error bodies should be treated as untrusted and potentially sensitive.

Target outcome:

- Centralize provider error sanitization.
- Store stable error code, provider status, failure type, and a scrubbed
  diagnostic preview.
- Keep raw provider error bodies out of normal logs and public API responses.

Status:

- Shared provider error text/body redaction and streaming error redaction landed
  in PR #43.
- Remaining work is to tighten public 5xx mapping and ensure every provider
  diagnostic preview goes through the same policy.

### P1: Public Error Responses Can Expose Internal Messages

Evidence:

- `src/http/public-error-handling.ts:191-193` returns `exception.message` for
  arbitrary `Error` instances after other branches.

Risk:

Internal exception messages can contain implementation details, provider
messages, paths, or accidental sensitive data. Public API clients should get
stable, protocol-compatible error envelopes.

Target outcome:

- Only `PublicGatewayError`, expected validation errors, budget errors, and
  known HTTP exceptions return specific public messages.
- Unknown 5xx errors return route-specific generic messages.
- Logs keep correlation IDs for diagnosis.

### P1: Budget Enforcement Is Not Concurrency-Safe

Evidence:

- `src/budget/budget.service.ts:396-420` checks active budget rules.
- `src/budget/budget.service.ts:426-439` records usage after the request.
- `src/budget/budget.service.ts:596-637` loads rules, increments in memory, and
  saves each rule.

Risk:

Concurrent requests can pass the same budget check and then record usage after
completion, allowing temporary or permanent overspend. This is especially
important for team/key budgets and expensive models.

Target outcome:

- Add atomic budget reservation for estimated tokens/cost before provider
  dispatch.
- Commit actual usage after completion and release unused reservation.
- Use database conditional updates or Redis atomic counters for multi-instance
  deployments.
- Add concurrent budget tests that prove only the allowed number of requests can
  pass.

### P1: API Key Last-Used Updates Can Cause Write Amplification

Evidence:

- `src/auth/gateway-api-key.service.ts:152-180` updates API key and team
  `last_used_at` on every successful key lookup.

Risk:

High-throughput gateway traffic can turn every request into one or two database
writes before provider forwarding. This adds latency, increases lock pressure,
and can dominate database load.

Target outcome:

- Throttle last-used updates, for example once every 5-15 minutes per key/team.
- Prefer async/batched flush for non-critical usage metadata.
- Keep immediate writes only for security-critical state changes.

### P1: MCP Stdio Servers Inherit The Full Process Environment

Evidence:

- `src/mcp/mcp-gateway.service.ts:533-540` spawns MCP stdio servers with
  `...process.env` plus configured env.

Risk:

External MCP tools can receive gateway-level environment variables, including
provider keys, database URLs, cloud credentials, and deployment secrets. MCP is
powerful enough that environment minimization should be the default.

Target outcome:

- Replace process-wide env inheritance with an allowlist.
- Add per-server env injection through config and secret references.
- Provide a compatibility flag for legacy deployments with clear warnings.
- Add tests proving unlisted env vars are not visible to child processes.

### P1: Config Restore And Save Should Use Atomic File Writes

Evidence:

- `src/config/config.service.ts:411-423` validates restore YAML before writing,
  but writes with direct `fs.writeFileSync`.
- `src/config/config.service.ts:1869` also writes config directly.
- `src/config/config.service.ts:356-407` already has good rollback-on-failure
  semantics for reload.

Risk:

A process crash or filesystem interruption during config write can leave a
truncated `gateway.config.yaml`. The reload path is careful, but write paths
should have the same durability standard.

Target outcome:

- Implement atomic write via temp file, fsync, rename, and backup metadata.
- Re-read and validate the written file before committing in memory.
- Add failure-injection tests for partial writes and rollback behavior.

### P2: Frontend Bundle Needs Manual Chunking And Chart Isolation

Evidence:

- `frontend/src/App.tsx:6-32` already lazy-loads routes.
- `frontend/src/pages/DashboardPage.tsx`, `AnalyticsPage.tsx`, and
  `ExperimentPage.tsx` import `recharts`.
- The frontend build still emits `index-DWCjXgzY.js` at 1746.29 kB minified and
  463.52 kB gzip, plus `generateCategoricalChart` at 384.31 kB.

Risk:

Operators pay a large initial load cost even when they do not need chart-heavy
pages. This affects cold dashboard load, constrained networks, and perceived
quality.

Target outcome:

- Add Rollup `manualChunks` for React, router, query/state, icons, charts, and
  dashboard-heavy dependencies.
- Lazy-load chart components inside pages when practical.
- Add a bundle size budget to CI.

### P2: Lint Warnings Should Become A Quality Gate

Evidence:

- `npm run lint` passes with 34 warnings, mostly unused variables/imports and
  unused eslint-disable directives.

Risk:

Warnings accumulate and make CI less useful. Some warnings also hide stale code
paths or incomplete refactors.

Target outcome:

- Fix current warnings or explicitly mark intentional ignored values with `_`.
- Move CI to `--max-warnings=0`.
- Keep generated or optional integration code under narrow exceptions.

## Overnight Merge Plan

The plan below assumes trunk-based discipline: create a branch from current
`main`, implement one small optimization, run focused tests, commit, push, open a
PR, merge it, return to `main`, pull the merged baseline, and start the next
branch.

### Block 0: Baseline And PR Queue

Deliverables:

- Keep `main` synchronized with `origin/main` before every slice.
- Keep the immediate PR queue in this document current as each PR lands.
- Capture benchmark artifacts only when the slice needs performance evidence.
- Add release checklist updates when a PR changes production defaults.

Exit criteria:

- CI baseline is documented: tests, lint warnings, backend build, frontend
  build, docs/public checks.
- Each new optimization starts with a regression test plan and a narrow branch.
- After every merge, local `main` and `origin/main` point to the same SHA.

### Block 1: Management-Plane Auth Safety

Deliverables:

- Make frontend auth status failure fail closed.
- Add focused tests around auth status failure and disabled-auth mode.

Exit criteria:

- Dashboard protected routes remain blocked when `/api/auth/status` fails.
- The PR is merged and local `main` is synchronized with `origin/main`.

### Block 2: OIDC Fetch Timeouts

Deliverables:

- Add timeout wrappers for discovery, token exchange, userinfo, and JWKS calls.
- Add tests for timeout behavior and stable error classification.

Exit criteria:

- OIDC external calls cannot hang indefinitely.
- The PR is merged and local `main` is synchronized with `origin/main`.

### Block 3: MCP Environment Isolation

Deliverables:

- Stop inheriting the full process environment for MCP stdio servers by default.
- Add explicit allowlist/configured env behavior with compatibility tests.

Exit criteria:

- MCP child processes receive only allowed/configured environment variables.
- The PR is merged and local `main` is synchronized with `origin/main`.

### Block 4: Provider Error And Stream Safety

Deliverables:

- Add provider connect/header timeout, stream idle timeout, and max duration.
- Propagate client abort to every stream reader and provider request.
- Centralize provider error classification and redaction.
- Make public error mapping generic for unexpected 5xx failures.

Exit criteria:

- Tests cover slow headers, stalled streams, partial streams, provider error
  redaction, and client disconnect.
- Public 5xx responses no longer expose arbitrary internal messages.
- Operators can tune timeout defaults per node or globally.

### Block 5: Cost Governance And Write Load

Deliverables:

- Implement budget reservation, commit, and release.
- Use atomic counters or conditional updates for budget state.
- Throttle or batch API key/team `last_used_at` updates.
- Review rate-limit behavior for multi-instance Redis and fail-closed
  production policies.

Exit criteria:

- Concurrent budget tests prove no overspend beyond an agreed small tolerance.
- API key lookup no longer writes to the database on every request.
- Production docs explain Redis requirements for shared enforcement.

### Block 6: Config And State Safety

Deliverables:

- Replace direct config writes with atomic write helper.
- Add backup and recovery metadata for config write paths.
- Align config validation entrypoints so startup, reload, restore, and dashboard
  mutation share the same validator where possible.
- Review TypeORM synchronize, schema patch services, and migrations to produce
  a single production migration policy.

Exit criteria:

- Failure-injection tests prove partial config writes do not corrupt the active
  config.
- Production PostgreSQL runs with migrations-first expectations.
- Config reload/restore dashboards show safe failure states.

### Block 7: Frontend Performance

Deliverables:

- Add frontend manual chunks and chart lazy loading.
- Add bundle budget checks.

Exit criteria:

- Frontend main entry is below the agreed gzip budget.
- Chart-heavy chunks are isolated from the initial dashboard shell.

### Block 8: Observability, Docs, And Release Gates

Deliverables:

- Add metrics for auth failures, OIDC timeout/error categories, stream idle
  aborts, provider error categories, budget reservations, and MCP denials.
- Convert lint warnings to CI failures.
- Update production, security, and troubleshooting docs.
- Add release checklist items for P0/P1 regression tests.

Exit criteria:

- Operators can see when security or reliability controls are firing.
- Release candidates run with zero lint warnings and defined bundle budgets.
- Docs match the implemented production defaults.

## Workstream Details

### A. Auth And Session Hardening

Implementation steps:

1. Change `AuthContext` status failure handling from `authRequired=false` to
   `status='unknown' | 'required' | 'disabled' | 'error'`.
2. Update `ProtectedRoute` to block on `unknown/error` unless the backend has
   positively declared auth disabled.
3. Add server-side environment guard, for example
   `SIFTGATE_ALLOW_UNAUTHENTICATED_DASHBOARD=true`, before accepting
   `dashboard.auth_required=false` outside development.
4. Introduce HttpOnly cookie session issuance for local password and OIDC login.
5. Replace SSE query tokens with cookie auth or a short-lived SSE ticket.
6. Keep compatibility metrics for remaining query-token usage.

Tests:

- Auth status fetch fails and dashboard remains protected.
- Explicit dev override opens dashboard only when configured.
- Cookie login, logout, and token rotation work across reload.
- SSE connection succeeds without URL token.

### B. Provider Request Lifecycle

Implementation steps:

1. Add a shared request lifecycle abstraction that tracks start time, connect
   timeout, idle read timeout, max duration, and abort reason.
2. Wrap provider streaming body readers with idle timers.
3. Ensure client disconnect cancels upstream requests and stream readers.
4. Add provider error sanitizer with max length, secret patterns, and structured
   failure types.
5. Update public error mapping so unexpected provider/internal errors return
   stable client messages.

Tests:

- Slow provider headers abort with timeout.
- Provider sends headers then stalls body and is aborted.
- Client disconnect aborts upstream request.
- Provider error bodies containing secrets or echoed prompts are scrubbed.

### C. Budget, Rate Limit, And Cost Controls

Implementation steps:

1. Estimate request cost before dispatch using model pricing and requested
   limits.
2. Reserve budget atomically before provider call.
3. Commit actual usage after provider completion.
4. Release unused reservation on failure or client abort.
5. Add Redis or SQL conditional update path for multi-instance deployments.
6. Throttle `last_used_at` writes with a per-key memory/Redis debounce.

Tests:

- N concurrent expensive requests against a small budget only allow the expected
  number through.
- Failed/aborted request releases reservation.
- Last-used update writes at most once per debounce interval.

### D. Config And Migration Safety

Implementation steps:

1. Add `atomicWriteFile(path, body)` helper using temp file, fsync, rename, and
   optional backup.
2. Replace config restore and dashboard mutation write paths with the helper.
3. Re-read written YAML and validate before in-memory commit.
4. Define a production database policy: migrations first, no production
   synchronize, schema patch services only for documented compatibility windows.
5. Add operational docs for failed config writes and rollback.

Tests:

- Simulated write failure leaves original config intact.
- Invalid restore candidate never writes.
- Valid restore writes, reloads, and audits exactly once.

### E. MCP Isolation

Implementation steps:

1. Add `mcp.servers[].env_allowlist` and global safe default env keys.
2. Stop passing `...process.env` to stdio children by default.
3. Allow explicit configured env and secret references per server.
4. Emit audit events when an MCP server is denied by access control or env
   policy.

Tests:

- Child process cannot read unlisted parent secrets.
- Explicit per-server env still works.
- Legacy compatibility flag logs a warning and is covered by tests.

### F. Frontend Performance

Implementation steps:

1. Add bundle analyzer or Rollup visualizer output for CI artifacts.
2. Configure `manualChunks` for large shared dependencies.
3. Split chart components from page shells.
4. Add route-level loading states that keep first paint useful.
5. Add bundle budgets for initial entry and chart chunks.

Targets:

- Initial JS gzip budget: below 250 kB as the first milestone.
- Chart vendor chunk isolated from non-chart first load.
- No route loses existing functionality or i18n coverage.

### G. Quality Gates

Implementation steps:

1. Fix the 34 current lint warnings.
2. Move lint to zero-warning CI mode.
3. Add focused regression tests for every P0/P1 fix.
4. Add a docs check step to the release checklist for changed production
   behavior.
5. Add security-focused test fixtures for redaction and token placement.

Targets:

- `npm run lint -- --max-warnings=0` or equivalent passes.
- `npm test -- --runInBand` remains green.
- `npm run build` and `frontend npm run build` remain green.

## Suggested Issue Breakdown

| ID | Title | Priority | Owner area | Status |
| --- | --- | --- | --- | --- |
| AGW-SEC-01 | Make dashboard auth status fail closed | P0 | Frontend/Auth | Next |
| AGW-SEC-02 | Add production guard for unauthenticated dashboard | P0 | Backend/Auth | Done in PR #44 |
| AGW-SEC-03 | Move dashboard session to HttpOnly cookie | P0 | Backend/Auth | Planned |
| AGW-SEC-04 | Replace SSE query token auth | P0 | Frontend/Auth | Planned |
| AGW-SEC-05 | Add OIDC fetch timeout helper | P1 | Backend/Auth | Next |
| AGW-REL-01 | Add provider stream idle timeout | P1 | Provider | Done in PR #45 |
| AGW-REL-02 | Propagate client disconnect to upstream provider | P1 | Provider | Planned |
| AGW-REL-03 | Treat pre-first-event stream reader failures as fallbackable | P1 | Provider/Pipeline | Done in PR #46 |
| AGW-SEC-06 | Centralize provider error redaction | P1 | Provider/Security | Partially done in PR #43 |
| AGW-API-01 | Harden public error response mapping | P1 | HTTP API | Next |
| AGW-COST-01 | Add atomic budget reservation model | P1 | Budget | Planned |
| AGW-COST-02 | Debounce API key last-used writes | P1 | Auth/Data | Next |
| AGW-MCP-01 | Restrict MCP stdio environment inheritance | P1 | MCP | Next |
| AGW-CONF-01 | Add atomic config write helper | P1 | Config | Next |
| AGW-DATA-01 | Document migrations-first production DB policy | P1 | Data | Planned |
| AGW-FE-01 | Add manual chunks and bundle budget | P2 | Frontend | Next |
| AGW-QA-01 | Fix lint warnings and enforce zero-warning CI | P2 | Tooling | Next |

## Pull Request Discipline

For each small optimization:

1. Start from a synchronized `main`.
2. Create `codex/<short-topic>`.
3. Implement only that topic.
4. Run focused tests plus any required build/lint check.
5. Commit with a narrow message.
6. Push and open a PR.
7. Merge the PR after checks pass.
8. Return to `main` and pull `origin/main` with `--ff-only`.
9. Confirm `git status --short --branch` is clean before the next branch.

## Metrics To Track

Security:

- Count of dashboard auth status errors.
- Count of disabled-auth startup events.
- Count of query-token SSE attempts.
- Count of redacted provider error fields.
- Count of MCP env-policy denials.

Reliability:

- Provider connect timeout rate.
- Provider stream idle timeout rate.
- Client abort propagation count.
- p95/p99 gateway latency by endpoint and provider.
- Open stream count and max stream duration.

Cost:

- Budget reservation failures by workspace/team/key.
- Reservation release count.
- Budget overspend delta.
- API key last-used write rate.

Frontend:

- Initial JS gzip size.
- Chart vendor gzip size.
- Dashboard first contentful paint in local benchmark.

Quality:

- Lint warnings.
- Test suite count and runtime.
- P0/P1 regression test coverage.

## Quick Wins

- Fix current lint warnings and unused eslint-disable directives.
- Change frontend auth status failure to an explicit blocked/error state.
- Add timeout wrappers for OIDC discovery, token exchange, userinfo, and JWKS.
- Complete public/provider error mapping so unexpected 5xx messages are generic
  and provider diagnostics stay scrubbed.
- Restrict MCP stdio environment inheritance.
- Debounce API key `last_used_at` writes.
- Add Rollup `manualChunks` for chart libraries and large vendor dependencies.
- Add tests for public 5xx generic error mapping.
- Add documentation warning for query-token SSE until the migration is complete.

## Non-Goals For This Plan

- Rewriting the gateway pipeline from scratch.
- Changing the public API contract without a compatibility window.
- Replacing the existing metadata-only logging model.
- Removing local-development convenience features; the goal is to fence them
  clearly from production defaults.

## Final Target State

At the end of this execution track, the gateway should have:

- Management auth that fails closed by default.
- Dashboard sessions that do not rely on URL tokens or `localStorage`.
- Streaming provider requests with complete lifecycle timeouts and abort
  handling.
- Public errors that are stable and do not leak internals.
- Budget enforcement that is concurrency-safe enough for production cost
  controls.
- MCP stdio execution with least-privilege environment exposure.
- Config writes that are atomic and recoverable.
- A smaller dashboard initial bundle with CI size budgets.
- Zero-warning lint and focused regression coverage for all P0/P1 fixes.
