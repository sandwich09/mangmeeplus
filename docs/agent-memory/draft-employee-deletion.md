# Agent Memory: draft-employee-deletion

Status: Final integrated checks passed on `codex/draft-employee-deletion`; ready for normal push to develop. Isolated worktree originally based on e5477b60943e30cff91a2193f4f5675560aeef91.
Owner: delegated agent `/root/reimbursement_no_future_dates` (new task after date delivery).
Scope: Make the existing employee-delete menu actually remove unfinished company employee drafts. No live data/deployment or global account removal.

## Decisions

- The bug is the menu calling the disable API, which correctly rejects every DRAFT status transition. Keep that guard and non-draft disable behavior.
- Add a dedicated DELETE draft endpoint, permission `access.employee.disable`; repeat server-side permission, tenant, OWNER/platform and privileged-role protections at the final mutation.
- Lock the company-scoped employee profile row inside the transaction and re-read it. Finish, draft resume, token issue and credential issue use the same row lock before mutations; removal rejects non-DRAFT profiles or memberships.
- Delete only the draft CompanyMembership; existing schema cascades its EmployeeAccessProfile, MembershipRole and MembershipBranchScope. Explicitly revoke PENDING EmployeeLineLinkToken rows (membershipId has no FK), retaining token/audit history. Do not delete or update global User, UserCredential, ExternalIdentity, AuthSession or other-company records.
- Deleted/unknown/cross-company IDs return the same not-found response, including retries; the UI refreshes a stale draft list and shows actionable feedback. A completed draft returns a specific conflict. No silent draft-to-disabled workaround.
- Re-creation frees company identity/phone but preserves the login: existing `employee_existing_user` confirmation and distinct company-email rule still apply; no auto-link or email-policy change.
- No new dependency, migration, role permission or package.json change.
- Local mobile verification found the same menu's `fixed top-auto` at y=1245 outside a 390×844 viewport after scrolling. Anchor only this menu to the mobile viewport bottom; preserve desktop absolute positioning. This is necessary to exercise the removal journey on a phone.

Open questions: none; account ownership and recreation follow existing create/link policy.

## Artifacts

- Spec: `docs/specs/employee-access-role-management-spec.md` §14 draft removal.
- Plan: `docs/plans/employee-access-role-management-plan.md` follow-up 2026-08-27.
- Root read-only diagnosis: `docs/agent-memory/main-draft-employee-delete-review.md` in the root checkout (not copied/committed).
- `DeleteEmployeeDraftUseCase` and `DELETE /companies/:companyId/settings/employees/:employeeId/draft` (204); controller passes trusted request context and existing disable permission.
- `lockEmployeeProfile` uses parameterized company-scoped `SELECT ... FOR UPDATE`, followed by a fresh read in the same transaction. Used by delete, Finish, resumed draft, LINE token issue and credential issue.
- Existing employee page/API client, audit taxonomy and scoped Thai/English error mappings. No Prisma schema/migration change.

## Verification

- Worktree-local Prisma client generation and contracts/config TypeScript builds passed; generated output was checked not to be a symlink. Installed dependency links were used read-only.
- Focused API checks: create/resume/Finish/delete, existing disable behavior, token/credential issue and controller metadata — 50 passed.
- Broader API command (cwd `apps/api`): `./node_modules/.bin/tsx --test src/modules/employee-access/domain/logic/*.spec.ts src/modules/employee-access/application/use-cases/*.spec.ts src/modules/auth/application/use-cases/complete-employee-line-link.use-case.spec.ts` — 235 passed, 6 existing entitlement-exception real-DB tests skipped (no configured test DB). Controller metadata test is kept in the already-wired lifecycle suite so no package.json edit or unreferenced test file is needed.
- Deletion regression covers removal/list/get/retry, identity/phone reuse, existing-login confirmation/company-email rules, shared-company account preservation, permission/OWNER/platform/privileged-role negatives, all non-draft states, mismatched active membership, audit rollback, Finish/delete and stale resume/token/credential issue interleavings. Transaction mocks model committed order and rollback; these are **not** proof of real Postgres lock contention or cascades.
- Web focused employee/access/client/toast/i18n/authed-fetch command passed 113 tests before the additional bilingual draft-error test; final integrated rerun pending below.
- Web `tsc --noEmit -p tsconfig.json` passed, including after removal of the browser fixture. API typecheck has only the existing two TS2307 errors for uninstalled `@aws-sdk/client-ses` in `auth.module.ts` and `ses-auth-mailer.adapter.ts`; no touched-source type errors remain. No dependency/manifest changes made to mask this environment limitation.
- Actual local employee page tested through Browser with only synthetic in-memory responses, at desktop 1280×900 and mobile 390×844: draft confirmation explicitly retains login/other-company data; successful removal and reload show zero drafts; cancel preserves data and retry works; stale 404 refreshes list and shows specific error; simulated Finish winner yields specific 409 and retains active employee; 403 preserves draft; read-only/OWNER hide menu; non-draft still disables and remains listed.
- Mobile menu bug reproduced (fixed `top-auto` at y=1245 outside viewport), then verified inside viewport y=746–828 and a fully visible confirmation. Desktop remains absolute-positioned.
- Both local fixture processes stopped, temporary routes/fixture removed, browser tab closed and viewport restored. Only generated Next cache was moved to `/tmp/mangmee-draft-delete-cache.TWet6N/next` (recoverable); no customer files/data removed.
- No live DB, real customer mutation, cloud, deployment, UAT or customer-gate action occurred. Live Postgres concurrency/cascade and deployed UAT verification remain unperformed.

## Integration

- Implementation: `62ed1ada63d8dfcb71d84d2d2de8a1e0ff2cdc24`; merged develop `e9c4794b772971adb95154ed0ba70b999c9fd5a0` in `4adb4a010ae871d2d97246be8747feda66de3881`.
- Only merge conflict was the first test in `api-error-message.spec.ts`; retained both the password-session test and draft-removal test. Password/date/login/LINE branch work remains intact; no package.json diff relative to develop.
- Integrated API functional checks including auth guard/current-password regression: 270 passed, 6 existing real-DB skips. Web employee, fetch/toast/i18n plus current-password page/API/BFF regressions: 132 passed. Web typecheck passed; API still reports only the two missing-SES dependency errors noted above.
- `spec-suite-coverage.spec.ts` finds exactly one upstream orphan: `modules/auth/application/use-cases/change-password.use-case.spec.ts`. Confirmed the file exists but is not referenced by scripts/catalog at fetched develop itself. Parent assigned the password agent to fix that wiring without package.json edits; this task's controller assertions were moved into the already-wired employee lifecycle suite.
- Synced the password runner fix at `2ef787b1cabf08f0958890d5b6f2ce68e327b2d6` in merge `c2632ab4b934a7b2ebfdcf9c035beaf759368eee`; the three test-registration checks now pass.
- The wider auth-endpoints suite exposed the same missing installed SES dependency at runtime. Restored **only the version already pinned by pnpm-lock.yaml, `@aws-sdk/client-ses@3.1118.0`**, using `npm install --prefix /tmp/mangmee-draft-delete-ses.XMhjOC --no-save --no-package-lock --ignore-scripts --no-audit --no-fund @aws-sdk/client-ses@3.1118.0` (24 installed packages). Replaced only this task's `apps/api/node_modules/@aws-sdk` symlink with a local directory retaining read-only links to the existing SDK packages plus the isolated SES package. No tracked manifest/lock or shared-root dependency was changed. Rerunning combined API tests and nonincremental typecheck against that restored runtime.

### Final verification on merged develop 2ef787b1

- API (cwd `apps/api`): `env -u DATABASE_URL -u AUTH_RECOVERY_TEST_DATABASE_URL ./node_modules/.bin/tsx --test src/modules/employee-access/domain/logic/*.spec.ts src/modules/employee-access/application/use-cases/*.spec.ts src/modules/auth/application/use-cases/complete-employee-line-link.use-case.spec.ts src/modules/auth/auth-endpoints.spec.ts src/modules/auth/auth.guard.spec.ts src/spec-suite-coverage.spec.ts` — **313 passed, 6 existing real-DB skips, 0 failures**.
- Web (worktree root): `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test apps/web/src/features/employee-access/*.spec.ts apps/web/src/common/api/api-error-message.spec.ts apps/web/src/common/i18n/error-message.logic.spec.ts apps/web/src/common/api/authed-fetch.spec.ts apps/web/src/features/auth/ChangePasswordPage.spec.ts apps/web/src/features/auth/auth.api.spec.ts apps/web/src/common/auth/change-password-bff.server.spec.ts` — **132 passed**. Additional `api-error-coverage.spec.ts` and `no-raw-api-error-display.spec.ts` — **13 passed** (145 total).
- Full API and web: `./node_modules/.bin/tsc --noEmit --incremental false -p tsconfig.json` from each app directory — **both passed** after restoring the missing installed SES dependency.
- `git diff --check` passed; no manifest, lockfile or schema change relative to latest develop. Synthetic browser evidence above remains valid; no real Postgres/UAT claim is made.

Next: normal non-force push and record remote ancestry.
