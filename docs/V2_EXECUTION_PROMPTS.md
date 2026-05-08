# SiftGate v2.x Execution Prompts

This runbook decomposes the SiftGate v2.x platform roadmap into coherent,
release-sized prompts that can be handed to Codex, Claude Code, or another
coding agent. Each prompt assumes the current OSS baseline is v1.9.x and keeps
the work bounded, tested, localized, released, tagged, and merged.

## Shared Contract For Every Prompt

Use this shared contract at the top of every implementation prompt.

```text
You are working in the SiftGate OSS repository, not the cloud/enterprise app.
Current baseline is the v1.9.x open-source data plane. Preserve existing
OpenAI-compatible, Anthropic-compatible, Batch, MCP, Realtime, media, dashboard,
SDK, Helm, Docker, and local SQLite behavior unless the prompt explicitly says
otherwise.

Product direction:
- SiftGate v2.x moves from "smart gateway" to "AI infrastructure platform".
- v2.0.0 is Platform Trust: workspace isolation, RBAC, production runtime,
  migration safety, benchmarks, docs, and onboarding.
- After v2.0.0 GA, v2.0.x is reserved for hotfixes and safe polish. New
  non-breaking product capabilities ship as minor releases: v2.1.0, v2.2.0,
  and onward.

Non-goals:
- Do not build an API resale/recharge platform.
- Do not make SiftGate depend on the cloud product.
- Do not store prompts, responses, raw provider headers, provider keys, media
  bytes, tool payloads, hidden reasoning text, or resolved secrets by default.
- Do not break existing v1.9 gateway API keys, configs, dashboard login,
  /v1/* ingress compatibility, Docker quickstart, or SQLite dev startup.

Localization:
- Any new Dashboard user-facing string must be localized in all seven existing
  Dashboard locales: en, zh, zh-TW, ja, ko, th, es.
- Add or update locale namespaces consistently in frontend/src/i18n.ts when a
  new namespace is introduced.
- Prefer concise, professional product language. Avoid machine-translated
  awkward wording. Keep CJK strings compact enough for narrow layouts.

Testing minimum:
- Run focused unit/e2e tests for changed backend behavior.
- Run `npm run build` if backend or shared types changed.
- Run `npm test -- --runInBand` when backend core/routing/auth/storage changes.
- Run `npm run test:e2e` when public API, auth, dashboard API, migration, or
  storage behavior changes.
- Run `cd frontend && npm test && npm run build` when Dashboard UI, i18n, or
  frontend API types change.
- Run `npm run docs:check` when docs or links change.
- Run `npm run validate:config` when config schema/examples change.
- Run `npm run validate:k8s` when Kubernetes or Helm files change.
- Run SDK tests when SDK surfaces change:
  `npm run test:sdk`, `npm run typecheck:sdk`, `npm run test:python-sdk`.

Integration gate:
- After merging each prompt, the full E2E suite must pass against the combined
  state of all previous v2 prompts before the next planned prompt begins.
- If the combined state exposes a regression in a prior v2 feature or existing
  v1.9 behavior, file it, prioritize a hotfix/regression prompt, and do not
  continue the planned sequence until the risk is resolved or explicitly
  deferred with owner approval.

Release discipline:
- Use a branch named `codex/<short-version-topic>`.
- Keep commits focused and readable.
- Update CHANGELOG.md for the exact version.
- Keep version metadata aligned across root package, frontend package, TS client,
  Python package, Helm chart, Kubernetes manifests, OpenAPI metadata, README,
  docs, and tests where applicable.
- After tests pass, push the branch to origin, open a PR, merge into main,
  pull main locally, create an annotated tag `vX.Y.Z`, push the tag, and create
  a GitHub release with concise release notes and test evidence.
- If a release step cannot be completed because credentials or network access
  are unavailable, stop and report the exact command that failed and the last
  verified commit SHA. Do not fake a push, tag, merge, or release.

Rollback discipline:
- If a release introduces a regression that blocks existing v1.9 behavior, the
  next prompt must prioritize a hotfix release before continuing the sequence.
- Never force-push, rewrite published history, or move/delete published tags.
- Prefer a forward fix release. If a revert is required, revert only the
  offending commit(s) and preserve unrelated user or team changes.

Skip/defer policy:
- If a prompt's core assumption proves invalid during execution, such as spec
  instability, missing dependencies, or scope that is too large for the release,
  create the smallest useful stub/interface that preserves the intended API
  shape, document the deferral reason in CHANGELOG and docs, and label the
  affected feature clearly as preview/unstable.
- Do not silently replace a promised feature with unrelated work.

Git safety:
- Never revert unrelated user changes.
- Before edits, inspect `git status --short`.
- If unrelated dirty files exist, leave them alone unless the prompt requires
  touching them.
```

## Prompt 01 - v1.9.1 Roadmap And Release Automation Baseline

```text
Apply the shared contract.

Prerequisites:
- Current main is at v1.9.0 or the latest v1.9.x maintenance release.

Goal:
Create the v2.x execution baseline so future prompts are consistent and release
work is harder to forget. This is a planning/release-infrastructure patch only;
do not implement v2 platform features yet.

Version:
Release as v1.9.1.

Scope:
- Add or update docs that define:
  - v2.x positioning: "AI infrastructure platform for teams and agents".
  - v2.0.0 Platform Trust scope.
  - v2.0.x follow-up sequence.
  - non-goals: no resale/recharge platform, no mandatory cloud dependency,
    no full workflow engine in v2.0.
  - why-now narrative for 2025-2026 enterprise AI scale-up.
  - competitive framing against One API, New API, LiteLLM, Portkey, Dify, and
    LangGraph.
- Add a release checklist document that explicitly includes:
  - test commands,
  - version sync files,
  - seven-locale checks,
  - push branch,
  - open PR,
  - merge main,
  - tag,
  - GitHub release.
- If no release helper script exists, add a non-destructive `npm run release:check`
  or documented manual checklist that verifies version alignment only. Do not
  auto-push, auto-tag, or auto-release in scripts.
- Update README roadmap links if needed.

Boundaries:
- No behavior changes to gateway runtime.
- No dashboard feature changes beyond docs links if necessary.
- No cloud/enterprise code changes.

Process:
1. Inspect current docs and version files.
2. Add the roadmap/checklist with concrete file paths and commands.
3. Add static checks only if they are safe and deterministic.
4. Update CHANGELOG.md under v1.9.1.
5. Sync version metadata to v1.9.1 only after the patch is ready.

Tests:
- `npm run docs:check`
- `npm run build`
- `cd frontend && npm test && npm run build` if frontend docs links or UI changed

Localization:
- Only required if user-facing Dashboard strings change. If not, state that no
  locale files were changed.

Release:
- Branch: `codex/v1.9.1-v2-roadmap-baseline`
- Commit, push, PR, merge to main, pull main, tag `v1.9.1`, push tag, create
  GitHub release.
```

## Prompt 02 - v1.9.2 v1.9 To v2 Migration Design And Dry Run

```text
Apply the shared contract.

Prerequisites:
- v1.9.1 merged, tagged, and released.
- v2 roadmap and release checklist exist.

Goal:
Build the migration story before changing the data model. Operators must know
exactly how v1.9 single-tenant configs and data will map into v2 default
organization/workspace.

Version:
Release as v1.9.2.

Scope:
- Add a migration design doc: `docs/MIGRATION_V1_TO_V2.md`.
- Add a read-only CLI dry-run command such as:
  `siftgate migrate-v2 --dry-run`
  or an equivalent subcommand consistent with the existing CLI style.
- The dry run must inspect the current config/database shape and output a
  metadata-only migration report.

Boundaries:
- Do not mutate production data in this prompt.
- Do not add workspace_id columns yet unless a harmless metadata table is
  required for dry-run reporting.
- Do not break existing CLI commands.

Release:
- Branch: `codex/v1.9.2-v2-migration-dry-run`
- Commit, push, PR, merge main, tag `v1.9.2`, push tag, create GitHub release.
```

The remaining v2 prompts continue in
[`docs/V2_PLATFORM_ROADMAP.md`](V2_PLATFORM_ROADMAP.md). Expand this file with
the next prompt body as each release begins so the execution instructions stay
close to the current codebase.
