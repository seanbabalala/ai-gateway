# SiftGate Release Checklist

Use this checklist for every open-source data-plane release. It is intentionally
manual and non-destructive: scripts may verify release readiness, but they must
not push branches, merge PRs, move tags, or create GitHub releases without an
explicit maintainer action.

## Branch And Scope

- Start from the latest `main`.
- Create one branch per release, for example:
  - `codex/v1.9.1-v2-roadmap-baseline`
  - `codex/v2.0.0-alpha.1-workspace-core`
  - `codex/v2.1.0-coding-agent-gateway`
- Keep one version goal per branch.
- Do not mix unrelated local changes into the release branch.
- Do not edit the cloud or enterprise app for OSS data-plane releases.

## Version Sync Files

For a normal release, confirm the version is aligned in every applicable file:

- `package.json`
- `package-lock.json`
- `frontend/package.json`
- `frontend/package-lock.json`
- `packages/client/package.json`
- `packages/python/pyproject.toml`
- `deploy/helm/siftgate/Chart.yaml`
- `deploy/kubernetes/base/deployment.yaml`
- `src/openapi/setup-openapi.ts`
- `test/unit/release-version-sync.spec.ts`
- `README.md`
- `CHANGELOG.md`

Additional release docs may also mention the new version when the release
changes those surfaces.

Run:

```bash
npm run release:check
```

The check must be read-only. It should fail if version metadata is misaligned.

## Required CI Signals

Every pull request should get non-Docker CI signal from `.github/workflows/ci.yml`:

- backend docs, build, unit tests, e2e tests, config validation, Kubernetes
  validation, release metadata, provider registry, and production dependency
  audit
- frontend checks and build
- TypeScript SDK build, tests, typecheck, and Python SDK tests

Docker smoke remains a separate workflow because it depends on a working Docker
daemon and is useful as a container-path complement, not the only quality gate.

## Public Repository Boundary

Run the public release guard before opening the repository or cutting a
release:

```bash
npm run public:check
```

This check verifies required community files, package publication metadata,
critical ignore rules, tracked-file boundaries, and common literal secret
patterns across non-test tracked text files. It is intentionally read-only and
should fail if local runtime config, build output, dependency folders, private
workspace folders, `.DS_Store`, or other local-only artifacts are accidentally
tracked.

## Required Tests

Choose the full set that matches the release scope. For v2 platform releases,
prefer the broadest reasonable gate.

```bash
npm run public:check
npm run docs:check
npm run lint
npm run build
npm test -- --runInBand
npm run test:e2e
npm run validate:config
npm run validate:k8s
npm run test:sdk
npm run typecheck:sdk
npm run test:python-sdk
cd frontend && npm test && npm run build
```

Optional when Docker is available:

```bash
npm run smoke:docker
```

For docs-only releases, the minimum is:

```bash
npm run docs:check
npm run build
```

## Production Hardening Gates

For releases that touch auth, provider streaming, budgets, frontend loading, or
release tooling, confirm the relevant hardening gates before merge:

- Dashboard auth stays fail-closed:
  - `/api/auth/status` failures keep protected routes blocked.
  - `dashboard.auth_required=false` is ignored in production unless
    `SIFTGATE_ALLOW_UNAUTHENTICATED_DASHBOARD=true` is explicitly set.
  - Cookie-backed Dashboard sessions survive reload without requiring
    `localStorage`.
  - OIDC callbacks do not return Dashboard JWTs in URL hashes.
  - Browser SSE paths authenticate with the HttpOnly session cookie first; any
    legacy `?token=` fallback emits only a token-free deprecation warning.
  - `dashboard.allow_legacy_token_auth=false` rejects both legacy bearer tokens
    and legacy SSE query tokens when the deployment is ready for cookie-only
    Dashboard auth.
- Provider stream lifecycle remains bounded:
  - header/connect timeout behavior still falls back correctly,
  - idle stream body timeout emits a timeout error,
  - `connection.stream_max_duration_ms` caps total stream wall-clock duration,
  - downstream client cancellation aborts upstream provider fetches.
- Budget and cost controls remain conservative:
  - `BudgetService.reserve()` rejects concurrent reservations that would exceed
    a shared rule,
  - failed scoped reservations do not partially consume global budget,
  - reservation `commit()` and `release()` keep counters consistent.
- Frontend and tooling gates keep their ratchets:
  - `npm run lint` fails on any warning,
  - `cd frontend && npm run build` runs the bundle budget check,
  - Dashboard string changes still pass the seven-locale check.

Suggested targeted checks when these areas change:

```bash
npm test -- --runInBand test/unit/auth-controller.spec.ts test/unit/dashboard-guard.spec.ts test/unit/oidc-service.spec.ts
npm test -- --runInBand test/unit/provider-client.spec.ts
npm test -- --runInBand test/unit/budget*.spec.ts
cd frontend && npm test && npm run build
```

## Seven-Locale Check

When Dashboard user-facing copy changes, update all existing locale folders:

- `frontend/src/locales/en`
- `frontend/src/locales/zh`
- `frontend/src/locales/zh-TW`
- `frontend/src/locales/ja`
- `frontend/src/locales/ko`
- `frontend/src/locales/th`
- `frontend/src/locales/es`

Then run:

```bash
cd frontend && npm test && npm run build
```

If no Dashboard strings changed, state that no locale files were changed in the
release notes or final implementation summary.

## Documentation And Privacy Review

- Update `CHANGELOG.md` under the exact release version.
- Update `README.md` release/current-focus copy when the release changes
  public positioning.
- Update topic docs for changed behavior.
- Re-check privacy boundaries:
  - no prompts or responses by default
  - no raw provider headers
  - no provider API keys or resolved secrets
  - no tool payloads, media bytes, or hidden reasoning text by default

Run:

```bash
npm run docs:check
```

## PR, Merge, Tag, And Release

After tests pass:

```bash
git status --short
git push -u origin <branch>
```

Open a PR against `main`. The PR description should include:

- release version
- scope summary
- tests run
- localization status
- migration or rollback notes
- known limitations

After review:

```bash
git checkout main
git pull --ff-only origin main
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

Create a GitHub release for `vX.Y.Z` with:

- concise highlights
- upgrade notes
- test evidence
- known limitations
- prerelease flag for alpha, beta, and rc tags

Never force-push or rewrite a published tag. If a release regression blocks
existing v1.9 behavior, ship a forward hotfix before continuing the roadmap.
