# Agent Memory: Substitute receipt signing integration

Status: PR504 (develop) and PR505 (main) opened; final CI integration fixes verified locally before retry.
Owner: /root
Scope: user authorized commit, push and merge of the completed substitute receipt company/personal funding and digital/paper signing work, including local review fixes. No deployment requested.
Decisions:
- Commit only task files; preserve unrelated dirty work and old local receipt-tax documentation commits.
- Integrate onto current origin/develop in an isolated worktree; preserve the existing local review services.
- Retain required CI and branch review rules; no force push, policy edits or release dispatch.
- Historical Readiness run 31611733340 is the exact documented provider metadata anomaly (created 2026-08-12, unchanged, zero jobs); no active UAT/Production run was found.
Open questions: none for implementation. Main requires one approving review.
Artifacts: existing company-payer and paper-signing specs/plans/memory.
Verification: prior local funding/PG/API/web/browser/PDF evidence recorded in those task memories. Latest footer suites 82/82 passed. Integration checks and PR/run IDs will be recorded below.
Next: transplant scoped commit onto latest develop, resolve conflicts and verify, push PR, merge develop and main when eligible.

Integration evidence:
- Original scoped commit 0a089170 contains 59 task files. Transplanted cleanly onto origin/develop b4280f0f1d306958f67d4ac24d4d5875c466e4d7 in /tmp/mangmee-substitute-signing-20260910; no conflicts. Unrelated dirty files and old receipt-tax documentation commits stay in the original checkout.
- Frozen lockfile install succeeded using current upstream dependencies; no package.json/lockfile diff. Contracts/config builds, Prisma generate, API build/typecheck and web typecheck passed.
- All migrations applied to isolated local database substitute_receipt_signing_merge at 127.0.0.1:15432, including the four new migrations. The user's review database was not used for integration tests.
- Integration API suites: 370/370 passed, zero skips, including seven PostgreSQL funding/concurrency/correction/paper cases. /tmp/substitute-integration-api-tests.log.
- Web signing/preview/API/signature/guide suites: 55/55 passed, zero skips. /tmp/substitute-integration-web-tests.log.
- Source diff check passed. Local review services remain on the original checkout. No deployment performed.

PR/CI follow-up:
- PR504 https://github.com/MangmeeDev/mangmeeplus/pull/504 and PR505 https://github.com/MangmeeDev/mangmeeplus/pull/505 initially used head 698f7db4a77c8a911281f00629f1ce6c1dc08391.
- CI34385156442 and CI34385177385 both stopped before application tests at Install production PDF fonts: the runner Chrome feed dl.google.com returned an APT Hash Sum mismatch. Security, secret scan, config and migration checks passed. Did not rerun unchanged jobs.
- Scope addition: font setup restricts APT sources to the Ubuntu distro source file for the two required Ubuntu packages. It still validates signed package metadata and requires fc-match to resolve Noto Sans Thai; no ignore-error or checksum bypass.
- Verified the exact workflow shell in a disposable Ubuntu24.04 container with an intentionally broken unrelated APT feed: font installation succeeds and fc-match prints Noto Sans Thai. /tmp/substitute-ci-font-check.log. bash syntax and scoped diff checks pass.

Application CI follow-up:
- CI34385660234 and CI34385660469 on 87f5b36b passed runner setup, typechecks and initial PostgreSQL suites, then failed web tests: 13 new substitute API error codes lacked Thai translations; an existing cancelled-version source assertion still expected the old success-panel guard.
- Added actionable translations in the shared API error registry. Updated the existing QA assertions to require ISSUED for both COMPANY and PERSONAL_ADVANCE panels; the production cancellation behavior was already guarded.
- Full web suite passes 1681/1681, zero skips (/tmp/substitute-integration-web-full-tests.log). The local run must unset APP_ENV/DEPLOY_ENVIRONMENT so a test switching NODE_ENV to production does not inherit the review runner's forced development CSP. No CSP product/test changes.
- Seeded the isolated integration DB for full API pretests after their prerequisite seed-user check correctly failed on the initially empty test database. The actual review database remains untouched.

- Full API follow-up identified three new unvalidated HTTP bodies (paper submit/accept and document correction) and older repository mocks missing the new attachment-lock query. Added class DTOs and nested/global ValidationPipe checks; did not raise the validation backlog or disable funding locks. Updated only the empty-store mocks. Focused DTO/coverage/repository suites pass 61/61.
- Full API `pnpm --filter @watchdog-bms/api test` passes with the same unit-suite boundary as CI (no DATABASE_URL), /tmp/substitute-integration-api-full-tests-ci-env.log. An earlier run with DATABASE_URL enabled unrelated concurrently destructive PG fixture suites; those collision failures were not application regressions. The dedicated 370/370 integration run above includes the actual seven funding/concurrency PG cases with no skips.
- API and web typechecks pass after the HTTP boundary fixes.

Checkbox follow-up requested during integration:
- Align all substitute receipt consent/payment/evidence/digital certification/approval and paper submit/review checkboxes to the first text line (16px control, fixed width, 4px top spacing, 24px line height). Wrap paper/payment label text in spans so long Thai text wraps as one text column. Prevent approver-setting checkboxes shrinking as well.
- Applied the three UI-file-only changes back to the original local review checkout via a checked patch; preserved user form state and unrelated changes.
- Full web suite passes again 1681/1681 with no skips, /tmp/substitute-integration-web-final-tests.log.
- Browser verification passes at 1440px and 390px for paper submit and digital certification: every visible checkbox is 16x16, starts 4px below its 24px first text line and cannot shrink. /tmp/substitute-checkbox-browser-results.json and /tmp/substitute-checkbox-{paper,digital}-{1440,390}.png. Paper uses the existing unsigned local fixture; the digital page replays its stored PREPARED history response in the isolated browser because that fixture has since been signed by the user. No document mutations were made.
