# Password Reset via LINE — Build Plan

Spec: docs/specs/password-reset-line-flow-spec.md. Memory: docs/agent-memory/password-reset-line-flow.md.
Branch: `feat/password-reset-line-flow` (from develop). Controller: Fable 5 session (review + integration + commit). Builders: Opus 5 lanes, parallel, disjoint file ownership. Nobody commits except the controller; worktree is shared and dirty with unrelated in-flight work from another session.

## Lanes (parallel)

### Lane A — UC1 backend: permission fix + provider-scoped forced change
Files owned:
- `apps/api/src/modules/auth/permission-registry.ts` (+ `apps/api/src/modules/auth/permission-registry.spec.ts`)
- `apps/api/src/modules/auth/application/use-cases/issue-token.use-case.ts`
- `apps/api/src/modules/auth/infrastructure/watchdog-jwt-verifier.adapter.ts`
- `apps/api/src/modules/auth/application/use-cases/refresh-session.use-case.ts`
- `apps/api/src/modules/auth/application/use-cases/exchange-line-token.use-case.ts`, `complete-employee-line-link.use-case.ts` (only the `issueToken.execute` provider argument)
- `apps/api/src/modules/auth/presentation/auth.guard.ts` (+ `apps/api/src/modules/auth/auth.guard.spec.ts`)
- `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.ts` (+ its spec)

Tasks: add `account.password.change` to the 9 employee ROLE_GRANTS; JWT `provider` claim end-to-end (issue → verify → refresh-preserve); guard exempts `provider === 'line'` from the mustChangePassword block; flip all `mustChangePassword: false` creation sites to `true` in create-employee. Tests: registry spec asserts all company roles include the key; guard spec covers line-exempt vs watchdog-block; create-employee spec expectations updated.

### Lane B — UC2 backend: reset-request endpoint + LINE pushes + close email endpoints
Files owned:
- `apps/api/src/modules/auth/presentation/auth.controller.ts` (+ `apps/api/src/modules/auth/presentation/auth.controller.spec.ts`)
- NEW `apps/api/src/modules/auth/application/use-cases/notify-password-reset-request.use-case.ts` (+ spec)
- NEW `apps/api/src/modules/auth/infrastructure/system-line-push.ts` (shared push helper, system OA token, 5s timeout)
- `apps/api/src/modules/auth/auth.module.ts` (wire new use case; leave parked email use cases wired)
- `apps/api/src/modules/employee-access/application/use-cases/regenerate-employee-credential.use-case.ts` (+ NEW spec)
- `packages/contracts` file defining `EmployeeCredentialHandoff` (add `lineNotified: boolean`)
- `apps/api/package.json` (append new spec files to the hand-maintained test list — re-read immediately before editing; another session also edits this file)

Tasks: per spec contract — remove forgot/reset handlers + DTOs, add reset-request handler with existing rate-limit asserts, recipient resolution (owner→none, admin→owner, else→admin w/ owner fallback), deliverable = ACTIVE externalIdentity, audit, generic response; regenerate pushes temp password after commit and returns `lineNotified`.

### Lane C — Web: forgot page repurpose + employee reset button + email UI removal
Files owned: everything under `apps/web` per spec Web contract section + `apps/web/src/common/i18n/workspace-dictionary.ts`. Includes deletions (`app/reset-password/`, `ResetPasswordPage.tsx`, `app/api/auth/reset-password/route.ts`), `auth.api.ts`, `auth.logic.ts` (+ spec), `LoginPage.tsx` link, `ForgotPasswordPage.tsx` rewrite, and the reset button/confirm/handoff hint on the LIVE employee list `IndividualPermissionsPrototypePage.tsx` (+ `AddEmployeePrototypePage.tsx` copy check, `employee-access.api.ts`). Build finding: `EmployeeAccessWorkspacePage`/`EmployeeAccessPages.tsx` is unrouted dead code — carries zero diff; first attempt there was reverted and ported to the live page.

## Integration & verification (controller, after all lanes)

1. Diff review scoped against the pre-lane baseline (scratchpad `git-baseline-before-lanes.txt`); confirm only owned files changed.
2. Sequential (never concurrent): `pnpm --filter api typecheck`, `pnpm --filter web typecheck` (script names per package.json), then `pnpm --filter api test`, `pnpm --filter web test`.
3. Opus 5 adversarial review pass over the combined diff (spec AC as checklist); fix round if findings.
4. Surgical staging of owned files only (never `git add -A` — tree carries another session's work), single commit.

## Ops notes (deploy-time)

- `sync-permissions.ts` runs automatically on prod release (`infra/prod-ecs-express/run-release-task.sh` after migrate deploy), so the 9 system-role grants land with the deploy. The script now ALSO additively backfills `account.password.change` onto all company-scoped custom roles — required because roles compiled before this change by a non-OWNER granter are missing the key and would brick the forced change (review finding P1-2). Local DBs still need a manual run.
- No Prisma migration in this change (JWT claim approach). No template sync needed.
- Local docker DB was down during build; e2e + live UAT deferred to the existing suite runs on a running stack.

## Review round (2026-07-25)

Opus adversarial review: no P0; security lenses clean (provider-claim minting/laundering, enumeration body/status, secret hygiene, recipient scoping). Fixed before commit: P1 timing leak (LINE pushes detached from the public reset-request response), P1 custom-role backfill (sync-permissions), P2 re-entrancy guard on confirmResetPassword, P2 en `auth.reset.hint_min` said 10 (API enforces 8), P2 spec wording for kebab placement. Deferred with rationale: audit anonymity for enumeration sweeps (rate limiter caps it), lineNotified=false conflating causes (helper now warns on push failure), orphaned auth.reset.* keys (parked with the email flow), and the DOB-password-never-forced-for-LINE-first-employees gap — resolved 2026-07-25 by owner decision: DOB password stays non-expiring until the first username/password login; accepted as-is (details in agent memory). Note LINE login does not actually exist yet (line/exchange has no callers; the login-page LINE modal is a decorative prototype), so the gap is currently unreachable.
