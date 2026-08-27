# Agent Memory: PR backlog impact review 2026-08-27

Status: LOCAL VERIFIED — final exact-head CI/merge delivery record is PR #265
Owner: Codex, at the product owner's request
Scope: Review eight open PRs, repair verified regressions, merge safe changes into develop; retain current feature switches and local data. No main promotion, deployment, cloud calls, provider enablement, or subscription work.

## Decisions and evidence

- Use an isolated review worktree; preserve dirty source worktrees and the running 3000/3003 local application.
- #306 head `0d97c66350a820056fb2e78ef22160083a6977f2`: CI `33069530136` succeeded (all six required checks; deploy/image jobs intentionally skipped). Prior local proof includes 5,339 API tests, 1,144 web tests, 44 real-PostgreSQL tests and 21 desktop/mobile E2E checks. Normal exact-head merge completed at `2ed114f29a016fa13f0dae559d596ee88b5144dd`; no admin bypass.
- #268 original implementation `ff024262` is already an ancestor of develop through #269/#270. Its branch-only merge/retrigger commits carry stale conflict context, not a new customer dashboard.
- #273 source `03648ce0` matches landed `a0b616e3` (#276) byte-for-byte at application/package/infra patch level (`git range-diff`).
- #274 source `8ee52df3` matches landed `3cb16603` (#277) at the same patch level.
- #275 source `cef527f7` matches landed `2076f0c2` (#277) at the same patch level; category regression test file also matches current develop.
- #272 was superseded by #290 `6f85339d`, which retains SES disabled-safe selection and adds the explicit frontend-URL guard missing in the old branch. Verify the remaining docs/dependencies before closing the obsolete PR.
- #264 was superseded by #288 (`70033af2`, `86c72e7f`) and #301: current composition preserves source totals/counts and multi-topic titles. Verify every original acceptance case before closing.
- #265 is NOT already present: self-service LINE recovery remains a unique change. Found and reproduced that a pending token could overwrite a later chosen password. Fixed by domain-separated credential-bound hashing plus credential-row lock/recheck at claim; repeated requests serialize on that same row. Admin/self password changes invalidate older recovery without changing other credential writers. Added missing admin/support fallback in the UI.
- Closed #264/#268/#272/#273/#274/#275 as superseded with exact replacement references, comparison commands and test evidence in each PR comment. Branches were not deleted and no old code was reintroduced.

## Why the queue looked broken

- #272 CI `32979173978` and #273 `32983544242` failed at Resolve Source with `Production maintenance enforcement pins are stale`; their application suites never started.
- #274 CI `32984427207` is completed with `startup_failure`, despite a stale queued check display.
- #275 CI `32985289793` failed with its sole started job cancelled; no application test result exists.
- #268 has no head check; #264/#265 old-head green checks cannot certify integration with newer develop. Seven old branches currently conflict with develop.

## Verification / next

- Red/green: registered lifecycle test failed before fix (`Missing expected rejection`), passed after fix.
- Focused auth/reset/SES: 55 passed. Real PostgreSQL lifecycle/concurrency: 1 scenario passed, 0 skipped, against dedicated `watchdog_recovery_review_20260827` cloned read-only from original. Four concurrent requests leave one PENDING token; two concurrent claims yield exactly one success; old password and sessions remain valid until claim; self/admin changes, stale snapshot, closed platform and disabled credential fail safely; failed intercepted LINE delivery revokes its token. Synthetic rows are removed by exact IDs.
- Current API card/category/accounting focused: 113 passed. AI composer/orchestrator: 118 passed. Runtime monitoring shell spec passed (no AWS calls).
- Full API suite passed; full web suite 1,144 passed/0 skipped. API/web typechecks and builds passed. Final focused auth coverage 56 passed. Combined real-browser suite 25/25 passed, 0 skipped/flaky (last run 23.1 seconds); Chrome request/back-to-login manually verified. Nine screenshots and scope limits are in [the evidence report](../evidence/pr-backlog-impact-review-2026-08-27/README.md).
- UI harness corrections: open the mobile menu before logout; do not delete append-only legal evidence; wait for real branch/metric content before taking the final dashboard screenshots. No application guard was bypassed.

- All six superseded PRs are closed with replacement evidence; #306 is merged. #265 source is updated and locally verified; require successful exact-head CI before normal merge. Final run ID/merge SHA are recorded in the PR delivery comment (the immutable source report cannot contain its own future CI result).
- Historical 157 branchless expenses remain unmapped; no invented provenance. Real OCR/provider accuracy is outside this backlog proof.
