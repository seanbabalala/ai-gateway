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

Baseline commands run during this review and overnight loop:

| Command | Result |
| --- | --- |
| `npm test -- --runInBand` | Passed: 102 suites, 1455 tests |
| `npm run build` | Passed for backend and runtime plugin types |
| `npm run lint` | Passed with `--max-warnings=0` enforced after PR #56 |
| `npm run public:check` | Passed |
| `npm run docs:check` | Passed |
| `npm test` in `frontend/` | Passed |
| `npm run build` in `frontend/` | Passed with bundle budget gate enforced after PR #57 |

Latest implemented optimization baseline before this document-only refresh:

| Field | Value |
| --- | --- |
| Branch | `main` |
| Local HEAD | `1cebfb67b377faf29ed6de61be4ba5c48903e330` |
| `origin/main` | `1cebfb67b377faf29ed6de61be4ba5c48903e330` |
| Worktree | Clean |

Frontend build size baseline:

| Asset | Minified | Gzip |
| --- | ---: | ---: |
| `dist/assets/index-DlWQpEAA.js` | 47.49 kB | 13.94 kB |
| `dist/assets/react-vendor-DpaXkVd2.js` | 193.97 kB | 60.56 kB |
| `dist/assets/vendor-8JS6qKYL.js` | 349.24 kB | 107.76 kB |
| `dist/assets/charts-vendor-uXGeMExF.js` | 343.02 kB | 84.88 kB |
| `dist/assets/NodesPage-D58r9-Kp.js` | 102.81 kB | 22.44 kB |

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

Completed PRs in this overnight hardening run:

| PR | Commit merged to `main` | Slice | Result |
| --- | --- | --- | --- |
| #33 | `2b716352` | Establish first optimization plan | Added the first overnight optimization plan document |
| #34 | `f4a247ec` | Fail closed on auth status failure | Protected dashboard routes no longer fail open when auth status is unavailable |
| #35 | `21059115` | Add OIDC fetch timeouts | Discovery, token, userinfo, and JWKS fetches have explicit timeout behavior |
| #36 | `060c6507` | Restrict MCP stdio env | MCP stdio servers no longer inherit the full gateway process environment by default |
| #37 | `31eae25d` | Harden public error messages | Unexpected public 5xx responses avoid leaking internal exception text |
| #38 | `2162efe1` | Throttle API key last-used writes | API key and team last-used metadata updates are debounced |
| #39 | `51c2808d` | Redact provider error bodies | Provider error text is sanitized before public or diagnostic exposure |
| #40 | `eed786f8` | Write config atomically | Gateway config saves use atomic file write semantics |
| #41 | `16ec2542` | Split frontend vendor chunks | Dashboard vendor and chart-heavy dependencies are separated into manual chunks |
| #42 | `d452dcbf` | Lazy-load locales | Dashboard locale payloads load lazily instead of inflating the initial bundle |
| #43 | `cbb5aa98` | Redact streaming provider errors | Shared provider redaction helper and redacted stream interruption/error surfaces |
| #44 | `645d546a` | Guard unauthenticated dashboard in production | `dashboard.auth_required=false` fails closed in production unless explicitly overridden |
| #45 | `dc99d6f4` | Timeout stalled provider streams | Stream body idle timeout emits timeout errors after stream start |
| #46 | `32867f63` | Fallback before stream chunks | Reader failures before any forwarded stream data now throw `ProviderError` so pipeline fallback can run |
| #47 | `476baa3b` | Establish overnight optimization plan | Created this Goal-driven PR execution document |
| #48 | `aac01e5b` | Clear lint warning baseline | Removed the existing lint warnings so quality gates can ratchet from zero |
| #49 | `05e2231c` | Cap provider stream duration | Added optional stream max-duration enforcement in addition to idle chunk timeout |
| #50 | `fa273157` | Prefer cookie dashboard sessions | Added HttpOnly dashboard session cookies and cookie-first SSE behavior with legacy token fallback |
| #51 | `a67dd677` | Refresh overnight plan | Rebased the execution plan on the cookie-session baseline |
| #52 | `e0513eaa` | Trust cookie sessions on reload | Protected routes accept verified cookie-backed session status without `localStorage` |
| #53 | `bc1036a2` | Stop OIDC URL tokens | OIDC callback redirects without `#token=` after setting the HttpOnly session cookie |
| #54 | `6ad34e81` | Warn on legacy SSE query tokens | Legacy `?token=` dashboard auth emits a one-time warning without logging token values |
| #55 | `bd1eccb1` | Abort upstream fetch after stream cancel | Downstream stream cancellation aborts the upstream provider fetch signal |
| #56 | `6030fe9e` | Enforce zero lint warnings | Root lint script now fails on any warning |
| #57 | `2962f60f` | Add frontend bundle budget gate | Frontend build now runs a gzip bundle budget check for key chunks |
| #58 | `55da1ab2` | Refresh current optimization baseline | Updated this plan with the real PR #57 baseline and remaining queue |
| #59 | `0dddcadc` | Add budget reservation proof | Added process-local budget reservations with commit/release semantics and concurrency coverage |
| #60 | `6a544652` | Harden release checklist | Added release/security/production checks for auth, stream, budget, lint, and bundle controls |
| #61 | `1cebfb67` | Fence legacy dashboard token auth | Added `dashboard.allow_legacy_token_auth=false` to reject legacy bearer/query Dashboard tokens |

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
| 1 | `codex/budget-reservation-pipeline-hook` | Connect the reservation contract to request dispatch with conservative estimates and release-on-failure behavior | `src/pipeline/pipeline.service.ts`, `src/budget/budget.service.ts`, pipeline/budget tests | `npm test -- --runInBand test/unit/pipeline-service.spec.ts test/unit/budget*.spec.ts`; `npm run build` |
| 2 | `codex/budget-reservation-metrics` | Emit operator-visible metrics or audit events for budget reservation denials/releases | `src/budget/*`, telemetry/audit tests | `npm test -- --runInBand test/unit/budget*.spec.ts`; `npm run build` |
| 3 | `codex/stream-abort-reason-metrics` | Add metrics for provider stream idle timeout, max-duration, and downstream client abort reasons | `src/providers/provider-client.service.ts`, telemetry/provider tests | `npm test -- --runInBand test/unit/provider-client.spec.ts`; `npm run build` |
| 4 | `codex/db-migration-production-policy` | Document migrations-first production database policy and compatibility windows for schema patching | `docs/PRODUCTION.md`, `docs/MIGRATION_V1_TO_V2.md`, scripts or config docs as needed | `npm run docs:check && npm run public:check` |
| 5 | `codex/dashboard-route-loading-states` | Add route-level loading states that preserve first paint while lazy pages and locales load | `frontend/src/App.tsx`, route/page components | `cd frontend && npm test && npm run build` |

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
- Frontend status failure now defaults to fail-closed behavior on current `main`.
- Cookie session issuance and cookie-first SSE landed in PR #50.
- Protected dashboard routes now accept verified cookie-backed session status
  after reload without requiring legacy `localStorage` tokens as of PR #52.

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
- Prefer cookie-authenticated EventSource before any legacy query-token fallback.
- Remove OIDC URL-hash token delivery after the cookie-backed reload flow is
  complete.
- Keep bearer/query-token support only behind a compatibility window, with
  warnings or telemetry and tests.

Status:

- HttpOnly dashboard session cookie support and cookie-first SSE behavior landed
  in PR #50.
- Cookie-backed route authentication landed in PR #52.
- OIDC callback token delivery through the URL hash was removed in PR #53.
- Legacy bearer, query-token SSE fallback, and `localStorage` token compatibility
  remain for migration safety; PR #54 added a one-time warning for legacy SSE
  query-token use without logging token values.
- `dashboard.allow_legacy_token_auth=false` can now reject legacy Dashboard
  bearer tokens and SSE query tokens after clients move to cookie-only sessions
  as of PR #61.

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

Status:

- Current `main` already includes OIDC fetch timeout handling; keep this as a
  regression area rather than the next implementation slice.

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
- Configurable max stream duration landed in PR #49.
- Downstream stream cancellation now aborts the upstream provider fetch signal as
  of PR #55.
- Remaining follow-up: add observability around stream abort reasons and keep
  lifecycle tests broad when provider stream handling changes.

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
- Current `main` already has generic public 5xx handling for unexpected errors;
  keep this as a regression-test area when touching API error surfaces.

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

Status:

- Current `main` already implements generic public messages for unexpected 5xx
  responses; future work should focus on preserving that contract when adding
  new controllers or provider error categories.

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

Status:

- PR #59 added a process-local reservation contract with all-or-nothing scope
  checks, concurrent reservation coverage, and idempotent commit/release
  settlement.
- Remaining follow-up: wire reservations into request dispatch with conservative
  estimates, release-on-failure behavior, and multi-instance SQL/Redis atomicity.

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

Status:

- Current `main` already includes API key/team `last_used_at` debounce behavior.
  Keep high-throughput write amplification as a benchmark and regression area.

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

Status:

- Current `main` already avoids full MCP stdio process environment inheritance by
  default. Keep compatibility flags and docs under review when adding MCP server
  configuration.

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

Status:

- Current `main` already includes atomic config write handling. Future work
  should focus on release docs and failure-injection coverage when expanding
  dashboard config mutation paths.

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

Status:

- Current `main` has route lazy loading, manual chunks, lazy locale loading, and
  a frontend bundle budget gate from PRs #41, #42, and #57.
- Remaining follow-up: route-level loading states should keep first paint useful
  as future lazy pages grow.

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

Status:

- The warning baseline was cleared in PR #48 and `npm run lint` now enforces
  `--max-warnings=0` as of PR #56.

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

- Keep cookie-backed route authentication green so dashboard reloads do not
  depend on legacy `localStorage` tokens. Completed in PR #52.
- Keep OIDC login cookie-only from the browser URL perspective. Completed in PR
  #53.
- Keep focused tests around cookie session status, logout, and disabled-auth mode
  as regression coverage when auth code changes.

Exit criteria:

- Dashboard protected routes remain blocked when `/api/auth/status` fails.
- Verified cookie sessions survive reload without exposing a JWT in the URL.
- The PR is merged and local `main` is synchronized with `origin/main`.

### Block 2: Session Compatibility Burn-Down

Deliverables:

- Keep PR #54's one-time warning for legacy SSE query-token compatibility and
  PR #61's `dashboard.allow_legacy_token_auth=false` fence when operators are
  ready to make compatibility explicit.
- Keep compatibility only where required for older clients and SSE fallback.
- Document the deprecation path.

Exit criteria:

- Operators can tell when legacy SSE query-token paths are still being used.
- The PR is merged and local `main` is synchronized with `origin/main`.

### Block 3: Provider Client-Abort Propagation

Deliverables:

- Keep PR #55's downstream disconnect propagation covered by regression tests.
- Add observability for abort reasons before expanding stream lifecycle behavior.

Exit criteria:

- Upstream provider work stops promptly after the client disconnects.
- The PR is merged and local `main` is synchronized with `origin/main`.

### Block 4: Budget Enforcement Proof

Deliverables:

- Add a focused concurrent budget test that currently expresses the target
  behavior.
- Implement the first atomic reservation/commit/release path that can be
  extended across storage backends.

Exit criteria:

- Concurrent expensive requests cannot all pass through a small shared budget.
- Failed or aborted requests release any reservation.

### Block 5: Frontend And Release Gates

Deliverables:

- Keep PR #57's bundle budget gate green now that route lazy loading and manual
  chunks exist.
- Keep PR #56's zero-warning lint enforcement green.
- Update release checklist entries for the new session and stream controls.

Exit criteria:

- Frontend bundle regressions fail a local/CI check.
- Release candidates validate cookie sessions, stream timeouts, and zero lint
  warnings.

### Block 6: Config, MCP, And Data Safety Regression Pass

Deliverables:

- Keep atomic config writes and MCP env isolation covered as future changes land.
- Review TypeORM synchronize, schema patch services, and migrations to produce a
  single production migration policy.

Exit criteria:

- Production PostgreSQL runs with migrations-first expectations.
- Config and MCP hardening stay green in targeted regression tests.

### Block 7: Observability

Deliverables:

- Add metrics for auth failures, legacy token use, stream idle/max-duration
  aborts, provider error categories, budget reservations, and MCP denials.
- Update production, security, and troubleshooting docs as implementation PRs
  land.

Exit criteria:

- Operators can see when security or reliability controls are firing.
- Docs match the implemented production defaults.

## Workstream Details

### A. Auth And Session Hardening

Implementation steps:

1. Change `AuthContext` status failure handling from `authRequired=false` to
   an explicit fail-closed state. Completed on current `main`.
2. Update `ProtectedRoute` to block on `unknown/error` unless the backend has
   positively declared auth disabled. Completed on current `main`.
3. Add server-side environment guard, for example
   `SIFTGATE_ALLOW_UNAUTHENTICATED_DASHBOARD=true`, before accepting
   `dashboard.auth_required=false` outside development. Completed in PR #44.
4. Introduce HttpOnly cookie session issuance for local password and OIDC login.
   Completed in PR #50.
5. Replace SSE query tokens with cookie-first auth and retain only a legacy
   fallback. Completed in PR #50.
6. Let protected routes trust verified cookie-backed session status after reload.
   Completed in PR #52.
7. Remove OIDC URL-hash token delivery after cookie-only reload is covered.
   Completed in PR #53.
8. Warn on remaining legacy SSE query-token usage without logging token values.
   Completed in PR #54.
9. Add an explicit compatibility fence for remaining legacy token paths.
   Completed in PR #61.

Tests:

- Auth status fetch fails and dashboard remains protected.
- Explicit dev override opens dashboard only when configured.
- Cookie login, logout, and token rotation work across reload.
- SSE connection succeeds without URL token.

### B. Provider Request Lifecycle

Implementation steps:

1. Track connect/header timeout, idle read timeout, max duration, and abort
   reason. Idle and max-duration controls are complete in PRs #45 and #49.
2. Wrap provider streaming body readers with idle timers. Completed in PR #45.
3. Ensure client disconnect cancels upstream requests and stream readers.
   Completed in PR #55.
4. Add provider error sanitizer with max length, secret patterns, and structured
   failure types. Provider and streaming redaction landed across PRs #39 and #43.
5. Preserve public error mapping so unexpected provider/internal errors return
   stable client messages.
6. Emit stream abort reason metrics for connect, idle, max-duration, and client
   disconnect paths.

Tests:

- Slow provider headers abort with timeout.
- Provider sends headers then stalls body and is aborted.
- Client disconnect aborts upstream request.
- Provider error bodies containing secrets or echoed prompts are scrubbed.

### C. Budget, Rate Limit, And Cost Controls

Implementation steps:

1. Estimate request cost before dispatch using model pricing and requested
   limits.
2. Reserve budget before provider call. Process-local reservation proof completed
   in PR #59; request dispatch integration remains.
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

1. Keep current least-privilege MCP stdio environment behavior covered by tests.
2. Allow explicit configured env and secret references per server.
3. Add or tighten compatibility flag documentation if legacy inheritance is used.
4. Emit audit events when an MCP server is denied by access control or env
   policy.

Tests:

- Child process cannot read unlisted parent secrets.
- Explicit per-server env still works.
- Legacy compatibility flag logs a warning and is covered by tests.

### F. Frontend Performance

Implementation steps:

1. Keep route lazy loading and manual chunks intact.
2. Keep the lightweight bundle budget script for initial entry and chart chunks
   green. Completed in PR #57.
3. Add route-level loading states that keep first paint useful when future pages
   grow.

Targets:

- Initial JS gzip budget: below 250 kB as the first milestone.
- Chart vendor chunk isolated from non-chart first load.
- No route loses existing functionality or i18n coverage.

### G. Quality Gates

Implementation steps:

1. Keep the warning baseline cleared by PR #48.
2. Move lint to zero-warning CI mode. Completed in PR #56.
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
| AGW-SEC-01 | Make dashboard auth status fail closed | P0 | Frontend/Auth | Done on current `main` |
| AGW-SEC-02 | Add production guard for unauthenticated dashboard | P0 | Backend/Auth | Done in PR #44 |
| AGW-SEC-03 | Move dashboard session to HttpOnly cookie | P0 | Backend/Auth | Done in PR #50 |
| AGW-SEC-04 | Prefer cookie-authenticated SSE over query token auth | P0 | Frontend/Auth | Done in PR #50; legacy warning done in PR #54 |
| AGW-SEC-05 | Add OIDC fetch timeout helper | P1 | Backend/Auth | Done on current `main` |
| AGW-SEC-07 | Let protected routes accept verified cookie sessions after reload | P0 | Frontend/Auth | Done in PR #52 |
| AGW-SEC-08 | Remove OIDC URL-hash token delivery | P0 | Backend/Auth | Done in PR #53 |
| AGW-SEC-09 | Add explicit compatibility fence for legacy dashboard token paths | P1 | Backend/Auth | Done in PR #61 |
| AGW-REL-01 | Add provider stream idle timeout | P1 | Provider | Done in PR #45 |
| AGW-REL-02 | Propagate client disconnect to upstream provider | P1 | Provider | Done in PR #55 |
| AGW-REL-03 | Treat pre-first-event stream reader failures as fallbackable | P1 | Provider/Pipeline | Done in PR #46 |
| AGW-REL-04 | Add provider stream max-duration cap | P1 | Provider | Done in PR #49 |
| AGW-REL-05 | Add stream lifecycle abort reason metrics | P1 | Provider/Observability | Planned |
| AGW-SEC-06 | Centralize provider error redaction | P1 | Provider/Security | Done in PR #43; keep regression coverage |
| AGW-API-01 | Harden public error response mapping | P1 | HTTP API | Done on current `main` |
| AGW-COST-01 | Add atomic budget reservation model | P1 | Budget | Process-local reservation proof done in PR #59; pipeline and multi-instance atomicity planned |
| AGW-COST-03 | Add budget reservation metrics and audit visibility | P1 | Budget/Observability | Planned after AGW-COST-01 |
| AGW-COST-02 | Debounce API key last-used writes | P1 | Auth/Data | Done on current `main` |
| AGW-MCP-01 | Restrict MCP stdio environment inheritance | P1 | MCP | Done on current `main` |
| AGW-CONF-01 | Add atomic config write helper | P1 | Config | Done on current `main` |
| AGW-DATA-01 | Document migrations-first production DB policy | P1 | Data | Planned |
| AGW-FE-01 | Add manual chunks and bundle budget | P2 | Frontend | Manual chunks done in PR #41; budget gate done in PR #57 |
| AGW-FE-02 | Add route-level lazy loading states | P2 | Frontend | Planned |
| AGW-QA-01 | Fix lint warnings and enforce zero-warning CI | P2 | Tooling | Warnings done in PR #48; enforcement done in PR #56 |
| AGW-DOC-01 | Add release hardening gates for auth, streams, budgets, lint, and bundle budgets | P2 | Docs/Release | Done in PR #60 |

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

- Wire budget reservations into request dispatch with conservative estimates and
  release-on-failure behavior.
- Add budget reservation metrics and audit visibility.
- Add provider stream abort reason metrics.
- Add route-level dashboard loading states for lazy pages and locales.
- Document the production database migration policy and schema patch
  compatibility windows.

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
