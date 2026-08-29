# Agent Memory: Main draft employee delete review

Status: Implementation and develop delivery complete on 2026-08-27 by `/root/reimbursement_no_future_dates`. Final remote develop/feature `aa003846af101976c2554b6cad71840abcf4ef0d`, implementation `62ed1ada`; parent fetch and ancestry check confirmed. No real employee deletion or deployment performed.
Owner: Root coordinates; `/root/reimbursement_no_future_dates` implements this new draft deletion task.
Scope: Fix why deleting a DRAFT employee produces the “ข้อมูลถูกเปลี่ยนแปลงระหว่างทำรายการ กรุณาเปิดใหม่แล้วลองอีกครั้ง” toast instead of removing the draft. No live data operation or deployment.

Decisions:
- Initial turn was a read-only main backlog review. Subsequent user instruction explicitly authorizes an agent to branch from develop, implement, test, and push to develop; it does not authorize a live employee deletion or deploy.
- Main baseline fetched 2026-08-27: `007dcba70376acb94aa5b55275840304cabd6f68`.
- Develop comparison at inspection: `7fdbfaf45c598d5694b83851fd0d961888d8f63d`. The relevant employee status use case, page, and API client have no diff from main.
- The menu label “ลบพนักงาน” calls `setEmployeeStatus(..., 'DISABLED')`, not a delete endpoint. Its confirmation/success copy actually describes disabling the account.
- `SetEmployeeStatusUseCase.execute` rejects every DRAFT source status before any transaction with `ConflictException('Draft employee status can only be changed by completing the employee wizard.')` (HTTP 409).
- The existing lifecycle test explicitly requires rejection of DRAFT -> ACTIVE, SUSPENDED, and DISABLED. Thus a perfectly fresh draft reproduces the refusal; a concurrent edit is not required.
- The browser mutation client emits an error toast. The draft refusal has no dedicated stable code/message mapping, so `apiErrorMessage` uses generic 409 copy matching the user's report. The page's `localizedErrorMessage` separately uses generic `error.conflict`.
- Draft provisioning spec §14 intentionally blocks status transitions outside wizard completion. The user's expected draft deletion needs a distinct, safe cancellation/deletion path without weakening activation safeguards.
- Merely allowing DRAFT -> DISABLED is not automatically equivalent to deletion: the list API returns disabled profiles, duplicate identity checks still block non-DRAFT profiles, and the current status API can reactivate disabled profiles. Do not introduce a bypass of Finish by changing only the guard.

Open questions:
- Agent to verify draft-only removal against FK/identity/create-link semantics and races before choosing the smallest implementation. Required boundaries: removed draft disappears on reload and cannot activate; preserve non-DRAFT behavior, permissions/owner guards, audit and shared user/credentials/other-company data. Escalate any unresolved product or data-ownership ambiguity; do not hard-delete a global user.

Artifacts:
- New implementation branch: `codex/draft-employee-deletion`, created from freshly fetched `origin/develop` `e5477b60943e30cff91a2193f4f5675560aeef91` on 2026-08-27.
- New isolated worktree: `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-draft-employee-deletion`. Agent confirmed starting there; completed date worktree is out of scope.
- Implementation memory to be recorded in that worktree's `docs/agent-memory/draft-employee-deletion.md`.
- Main source snapshot: `/tmp/mangmee-main-wht-vat.nbXuKs`.
- `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`: delete action at line 382; menu action at line 648.
- `apps/web/src/features/employee-access/employee-access.api.ts`: status request at line 39, POST employee disable endpoint.
- `apps/api/src/modules/employee-access/application/use-cases/set-employee-status.use-case.ts`: DRAFT guard at line 25.
- `apps/api/src/modules/employee-access/application/use-cases/employee-lifecycle.use-case.spec.ts`: existing draft-transition rejection test.
- `apps/api/src/modules/employee-access/application/use-cases/list-employees.use-case.ts`: all employee statuses remain listable.
- `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.ts`: non-DRAFT identity duplicate rejection, draft completion, and cross-company shared-user handling.
- `apps/web/src/common/api/authed-fetch.ts`, `apps/web/src/common/api/api-error-message.ts`, `apps/web/src/common/i18n/error-message.logic.ts`: toast and page error paths.
- Docs checked from main: employee-access-role-management spec/plan and employee-access-draft-provisioning memory.

Verification:
- In the main snapshot, `./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/employee-access/application/use-cases/employee-lifecycle.use-case.spec.ts`: 8/8 passed, including the current DRAFT -> DISABLED rejection. Passing means observed existing behavior, not acceptance of the user's expected deletion.
- In the same snapshot, `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test apps/web/src/features/employee-access/employee-access.api.spec.ts apps/web/src/common/i18n/error-message.logic.spec.ts apps/web/src/common/api/api-error-message.spec.ts`: 40/40 passed, including generic 409 message fallbacks.
- No real employee, account, session, database, or deployed runtime was changed. Implementation and its verification are now complete as recorded below; initial main-review observations remain historical.
- Follow-up source check on the new develop worktree: preserving a global account means username recreation follows existing linkExistingUser confirmation and company-email rules. Agent notified not to change those silently. Finish currently reads DRAFT before its transaction then updates by ID; delete/Finish concurrency needs explicit protection. Pending link tokens have a scalar membershipId without an FK cascade, so cleanup must not assume membership deletion handles tokens.

Next:
- Delivery complete: implementation `62ed1ada`, test-wiring/negative-scope follow-up `da3249c8`, merges preserve latest develop and password-runner fix; initial delivery `7f20e740`, final documented remote develop/feature `aa003846af101976c2554b6cad71840abcf4ef0d`. Worktree clean. Parent fetched and verified implementation ancestry.
- Implemented draft-only DELETE with existing disable permission, company-scoped row lock/re-read, profile/membership removal with scoped cascades and pending token revocation, retaining global account/credentials/sessions and other-company data. Shared lock protects Finish/resume/token/credential races. Non-DRAFT disabling remains separate. Fixed mobile action-menu positioning in the same journey.
- Final verification: API 313 passed / 6 existing real-DB tests skipped; web 145 passed; full API/web nonincremental typechecks passed. Missing already-declared SES 3.1118.0 was restored into an isolated temporary runtime (no manifest/lock/shared-root dependency changes). Browser synthetic desktop 1280x900 and mobile 390x844 covered delete/reload/cancel/retry/stale404/Finish409/403/read-only/OWNER/non-DRAFT.
- Full evidence and limitations in `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-draft-employee-deletion/docs/agent-memory/draft-employee-deletion.md`. No live UAT/Production/DB/account tests or deployment; no package.json/lock/schema changes.
- Initial delegation instructions retained below for historical scope; no further implementation is pending on this task.
- Agent owns scoped docs/spec acceptance, implementation and tests; parent continues backlog intake. Verify actual draft removal, retry/list/copy, no activation shortcut, permission/tenant/owner denials, token/audit/shared-account preservation, and Finish/delete races.
- Fetch/merge latest develop and rerun focused checks before normal non-force feature/develop integration; preserve login-label/date deliveries and concurrent current-password error work. No root edits, shared generated artifact writes, package.json changes, or deployments.
