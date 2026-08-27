# Agent Memory: current-password-error-feedback

Status: Runtime delivered; test-runner wiring follow-up verified and ready for delivery, no live deployment.
Owner: current-password agent (reassigned from reimbursement self-service).
Scope: Correct wrong-current-password feedback and prevent unnecessary session refresh; test and push into develop.
Decisions:
- Isolated worktree `mangmeeplus-current-password-error-feedback`, branch `codex/current-password-error-feedback`, based on develop `11bc689365cb2b80fd658007bedbc3dbda7f8ce6`.
- Wrong current password on a present, enabled credential becomes 400 `current_password_incorrect`; missing/disabled credentials remain 401. Existing session refresh/retry stays unchanged.
- Reuse the existing exported-error-constant and locale override patterns; apply the same contract to email reauthentication.
- No live account/session/DB/cloud changes, dependency/package.json edits or writes to shared generated clients.
Open questions: None.
Artifacts:
- `docs/specs/current-password-error-feedback-spec.md`
- `docs/plans/current-password-error-feedback-plan.md`
Verification:
- Reviewed root/main audit evidence and existing first-login/session/error contracts. Ponytail FULL kept the runtime diff to existing error constants, two verification branches and locale mappings; BFF/client recovery code needs no change.
- Own Prisma 7.8.0 client generated only after checking resolved target paths; own contracts built with `./apps/api/node_modules/.bin/tsc -p packages/contracts/tsconfig.json`. Dependency links are read-only; no shared generated/dist outputs were written.
- Initial API focused (historical, before the six cases moved into `auth-endpoints.spec.ts`): `./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/auth/application/use-cases/change-password.use-case.spec.ts apps/api/src/modules/auth/application/use-cases/forgot-password-reset.use-case.spec.ts apps/api/src/modules/auth/domain/logic/password-credential.logic.spec.ts` — 18 passed.
- API existing boundaries: `env -u AUTH_RECOVERY_TEST_DATABASE_URL ./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/auth/auth-endpoints.spec.ts apps/api/src/modules/auth/presentation/auth.guard.spec.ts apps/api/src/modules/auth/domain/logic/session-revocation.logic.spec.ts` — 40 passed. PostgreSQL recovery suite intentionally not enabled; no test database/live account used.
- Web focused: `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test apps/web/src/features/auth/auth.api.spec.ts apps/web/src/features/auth/ChangePasswordPage.spec.ts apps/web/src/common/auth/change-password-bff.server.spec.ts apps/web/src/common/i18n/error-message.logic.spec.ts apps/web/src/common/api/api-error-message.spec.ts` — 55 passed.
- Web recovery/regressions: same runner with `apps/web/src/common/auth/session.spec.ts apps/web/src/common/auth/session-gate.logic.spec.ts apps/web/src/common/api/authed-fetch.spec.ts apps/web/src/common/api/api-error.spec.ts apps/web/src/common/api/http-client.spec.ts apps/web/src/common/i18n/workspace-i18n.spec.ts` — 88 passed.
- `./apps/api/node_modules/.bin/tsc --noEmit --incremental false -p apps/api/tsconfig.json` and corresponding `apps/web/tsconfig.json` — both passed.
- Browser skill: local Next page imports the actual `ChangePasswordPage` and actual client; temporary fixture redirects only auth test calls to a loopback fake API executing the actual `ChangePasswordUseCase` with an in-memory repository. No credentials, cookies or real account used; BFF cookie/code boundary separately tested with actual route and synthetic requests.
- Browser confirmed Thai exact message and English equivalent, each with only `change`; min-length/reuse validation adds zero requests; dead session yields `change, refresh` plus session-expired guidance; expired access then wrong password yields `change, refresh, change` plus the correct password error. Fake API recorded zero credential/session writes. Successful mutation/revocation/logout are covered by existing API/client unit tests, not a real browser account action.
- Temporary page removed, browser tab closed and ports 4360/4361 stopped. Harness source remains only in `/tmp/mangmee-password-feedback.qLek3e`; no fixture enters the commit.
- Implementation commit `ae6f369e`; integration commit `788ad0a9` includes develop `e5477b60943e30cff91a2193f4f5675560aeef91` (date validation, username login copy, temporary-password copy and PR311 assets). The only conflict was auth test imports; both test families are retained. No package.json diff against develop.
- Post-merge verification: combined API files above **58 passed**; combined web files above plus `api-error-coverage.spec.ts` and `no-raw-api-error-display.spec.ts` **158 passed**. Both complete API/web typechecks passed again after rebuilding own contracts. Total **216 passing tests**; database recovery integration remains intentionally unexecuted.
- Normal atomic push of feature branch and develop succeeded; `git ls-remote` confirmed both refs at `f7e15e25a2863d47b6dcf1ce3391841cdb5159c9` before this delivery-status-only follow-up. All runtime code is the tested `788ad0a9` integration.
Integration follow-up:
- On develop `e9c4794b`, the official `spec-suite-coverage.spec.ts` identified the newly added `change-password.use-case.spec.ts` as unreferenced by a maintained runner. Earlier focused checks explicitly ran it but did not cover runner registration.
- Move all six cases unchanged into the existing wired `auth-endpoints.spec.ts`, alongside password-change success/reuse tests. Do not edit package.json, suppress the gate or alter runtime behavior.
- Reproduced the gate failure with exactly that single orphan. After relocation, `env -u AUTH_RECOVERY_TEST_DATABASE_URL ./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/spec-suite-coverage.spec.ts apps/api/src/modules/auth/auth-endpoints.spec.ts apps/api/src/modules/auth/application/use-cases/forgot-password-reset.use-case.spec.ts apps/api/src/modules/auth/domain/logic/password-credential.logic.spec.ts apps/api/src/modules/auth/presentation/auth.guard.spec.ts apps/api/src/modules/auth/domain/logic/session-revocation.logic.spec.ts` passed **61/61** (58 existing auth cases plus the three registration checks).
- Same 13-file web regression selection from post-merge verification passed **158/158**; API and web `tsc --noEmit --incremental false` both passed. Total **219 passing tests**. Verified the default package test script already names `auth-endpoints.spec.ts` and the gate. No package.json or runtime diff.
- No browser rerun for this test-location-only follow-up; prior browser evidence remains applicable. No DB tests or live actions enabled.
Next: Deliver the verified test-only follow-up. UAT/Production remains outside scope.
