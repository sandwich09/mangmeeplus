# Agent Memory: Main current-password error review

Status: Main review confirmed the bug on 2026-08-27. User authorized implementation; `/root/reimbursement_self_service` completed and pushed to develop at `3a39d95d856df9883661194eaf9e8c363f1f9781`. Test-runner follow-up delivered at `2ef787b1cabf08f0958890d5b6f2ce68e327b2d6`; parent fetch confirmed both deliveries. No UAT/Production deployment.

Owner: Parent backlog review for coordination; `/root/reimbursement_self_service` for the new current-password-error-feedback implementation. Date Picker continues separately under `/root/reimbursement_no_future_dates`.

Scope:

- User reports entering an incorrect current password gives “เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่”; expected “รหัสผ่านปัจจุบันไม่ถูกต้อง”.
- Freshly fetched remote main: `007dcba70376acb94aa5b55275840304cabd6f68`, unchanged.
- Traced password-change use case, BFF route/forwarder, client retry, API error mapping, localized UI error, current tests, and adjacent current-password reauthentication for email changes. No real passwords, accounts, sessions, or databases were used.

Decisions:

1. `ChangePasswordUseCase` combines missing/disabled credentials and a wrong supplied current password into `UnauthorizedException('Current password is incorrect.')`: HTTP 401 without a stable code. An isolated real-use-case probe with fake credentials confirms wrong-password rejection occurs before any mutation.
2. `/api/auth/change-password` BFF preserves upstream status/message/code; its genuine missing-cookie case also returns 401 (“No active session.”). The BFF itself does not clear cookies when forwarding a wrong-password rejection.
3. `changePassword` retries every 401 after `refreshSessionSilently`, without distinguishing credential validation from an expired access session. An isolated actual-client probe reproduces change → refresh → same change with a healthy synthetic refresh response, followed by the same wrong-password rejection.
4. `ChangePasswordPage` maps only `password_reuse` specially. `localizedErrorMessage` intentionally ignores raw English messages and defaults 401 to `error.session_expired`. The new probe verifies the exact Thai message reported by the user. This is not fixed by the earlier first-login Bearer-cookie forwarding fix or by the unrelated reimbursement-notification fix.
5. Correct fix must distinguish wrong-current-password from real session expiry through an explicit stable error contract and localized message, preserving genuine 401 recovery and expiry guidance. Do not simply relabel all 401s on the page. Keep the user on the correction path and avoid session refresh solely for wrong-password validation. Preserve disabled/missing credential denial, forced-password-change rules, minimum/reuse checks, rate limits, and successful-change session revocation.
6. `RequestEmailChangeUseCase` has the same current-password rejection shape. This is a related caller to consider when implementing a consistent reauthentication error contract, not authorization to broadly rewrite authentication. Do not claim its exact screen behavior was reproduced; the reproduction targets password change.

Open questions:

- User explicitly authorized implementation/delegation after the report. No clarification is needed for the current-password error scope. Live UAT version and browser session remain uninspected.

Artifacts:

- [Main password-change rejection](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/auth/application/use-cases/change-password.use-case.ts#L16).
- [Main BFF forwarding](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/app/api/auth/change-password/route.ts).
- [Main client retry](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/features/auth/auth.api.ts#L81).
- [Main page error mapping](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/features/auth/ChangePasswordPage.tsx#L70) and [localized fallback](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/common/i18n/error-message.logic.ts#L26).
- Related docs inspected: first-login-change-password-session-fix memory and plan. That earlier fix authenticated the BFF properly; it did not distinguish wrong-password business validation from expired sessions.
- Temporary diagnostic files in `/tmp/mangmee-main-wht-vat.nbXuKs`: API `apps/api/src/modules/auth/application/use-cases/current-password-error-review.probe.spec.ts`; web `apps/web/src/features/auth/current-password-error-review.probe.spec.ts`. They deliberately assert observed current behavior, not desired fix expectations.

Verification:

- Used exact-main snapshot; BFF route source was read from git because `apps/web/app` was not included in the snapshot. No local application code or generated artifacts were changed.
- Web: `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/features/auth/current-password-error-review.probe.spec.ts apps/web/src/features/auth/auth.api.spec.ts apps/web/src/features/auth/ChangePasswordPage.spec.ts apps/web/src/common/auth/change-password-bff.server.spec.ts apps/web/src/common/api/api-error.spec.ts apps/web/src/common/i18n/error-message.logic.spec.ts` — PASS 40 tests, 10 suites (38 existing + 2 diagnostic observations).
- API: `./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec apps/api/src/modules/auth/application/use-cases/current-password-error-review.probe.spec.ts apps/api/src/modules/auth/domain/logic/password-credential.logic.spec.ts apps/api/src/modules/auth/application/use-cases/forgot-password-reset.use-case.spec.ts` — PASS 12 tests, 5 suites (11 existing + 1 observation).
- Total focused evidence: 49 existing tests + 3 diagnostic observations passed. Genuine no-session message remains correct; wrong-password diagnostic verifies zero backend transactions and unwanted client refresh/retry.
- Broader `auth-endpoints.spec.ts` could not load: it imports `line-recovery.pg.spec.ts`, which requires absent snapshot generated Prisma client `../../generated/prisma/client`. This is a test-fixture/setup limitation, not a proved product failure. Did not regenerate shared root artifacts or connect to a database to bypass it.
- No real browser, live BFF/API, account/session, or UAT/Production test was performed.

Next:

- Integration follow-up: draft-deletion agent caught `spec-suite-coverage.spec.ts` rejecting the newly added password spec as unwired. Reassigned the password owner to move all 6 regression cases into existing wired `auth-endpoints.spec.ts`, with no runtime or package.json changes. Fix `a0cc8377`, delivery `2ef787b1cabf08f0958890d5b6f2ce68e327b2d6`; gate 3 + API 58 + web 158 = 219 passed and API/web types passed. Parent fetch/ancestry check confirmed the delivered commit; other agents notified to merge it. No deploy/live DB changes.
- Delivery complete: implementation `ae6f369e`, integration `788ad0a9` preserves develop `e5477b60`, final delivery `3a39d95d856df9883661194eaf9e8c363f1f9781`. Feature and develop match per agent remote verification; clean worktree.
- Wrong current password now returns 400 + `current_password_incorrect`, mapped to Thai/English feedback on change-password and email reauthentication. Missing/disabled credentials remain 401; no auth refresh logic was rewritten, so genuine expiry recovery is preserved without retrying bad password input.
- Final regression: API 58 + Web 158 = 216 passed; API and Web typechecks passed; synthetic browser Thai/English wrong-password and genuine-401 recovery checks passed without real accounts. No dependencies/package.json, live database or deployment changes. Full evidence in isolated `docs/agent-memory/current-password-error-feedback.md`.
- Created branch `codex/current-password-error-feedback` in `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-current-password-error-feedback` from freshly fetched develop `11bc689365cb2b80fd658007bedbc3dbda7f8ce6`. A new spawn hit the thread limit, so completed agent `/root/reimbursement_self_service` was reassigned and acknowledged starting; its old worktree is out of scope.
- Agent owns scoped auth error contract/localization/retry fix, tests, docs memory, and normal non-force develop integration. Preserve genuine expiry recovery, missing/disabled credential denial, forced-change/min/reuse/rate-limit rules and successful revocation. No real account/session changes, live DB, deployment, or shared generated/dependency writes.
- Date agent is active on `codex/reimbursement-no-future-dates` and may add date error codes in shared `api-error-message.ts`; both agents have been notified to coordinate and incorporate current develop before pushing. Login-label copy is a newly authorized separate task and may touch the locale dictionary; coordinate that file too.
