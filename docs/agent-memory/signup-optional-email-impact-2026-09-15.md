# Agent Memory: Optional signup email, OTP and billing verification

Status: Source implemented in isolated worktree; dependency integrated. PR #575 awaits green exact-head CI after the integration corrections recorded below. User authorized commit/push and admin merge into develop/main only after CI passes. Native release acceptance remains pending. The dated checkpoints below are history; the last checkpoint is current.
Owner: Codex / thawatchai
Scope: Optional LINE contact email, account email OTP link/change, current verified email before new financial authorization, UX/SA/dev impacts, legacy migration and acceptance.

Decisions:
- User explicitly requested spec + plan and OTP verification when changing email, plus notice/link verification before payment. User reports mail provider is connected; source contains Postmark transport and link-based verification, not the proposed OTP implementation.
- Keep web email claim/password-reset flows distinct. LINE optional intake must preserve review history/retry/idempotency and must not weaken required account-email validators.
- Engineering design default D01 uses current verified account email as the new purchase recipient. An asynchronous question offered separate verified accounting recipient as an alternative; no response was received before drafting. Default stated to the user; it remains a design assumption that can be revised, not an explicit owner choice.
- Preserve old email until new OTP succeeds; gate new payment while an active change is pending. Existing paid reconciliation/documents/cancel paths remain usable. Existing scheduled contracts and issued provider URLs are explicit legacy authorization cohorts, not falsely revoked by a UI gate.
- Include last-login unlink guard. Verified email alone does not create a usable password credential or passwordless recovery; UI/support must state this limit. Separate company-scoped future billing-recipient changes from global account email and immutable historical documents.
- Latest user explicitly requires UAT and Production ready at release completion without opening/closing feature flags. No new feature switches; config/secret/provider/OTP-key/callback integration and target acceptance are required implementation/release deliverables, not handoff chores.

Open questions:
- D01 may change if owner wants a separately verified accounting email recipient. Core signup/OTP design is independent; update recipient entity/permissions/consent/matrix before billing implementation if changed.
- Implementation and CI-gated admin merge to develop/main are authorized. Billing/Postmark dependency PR #558 and its main promotion #577 have merged and the complete base is integrated. Deployment/native application OTP inbox acceptance and actual older-user usability remain pending.

Artifacts:
- [Baseline impact assessment](../research/signup-optional-email-impact-2026-09-15-th.md)
- [Spec](../specs/signup-optional-email-otp-billing-spec-th.md)
- [Plan, P0–P7, A01–A70 and R01–R08](../plans/signup-optional-email-otp-billing-plan-th.md)
- Cross-links added to LINE signup/recovery, unified signup and LINE/web billing specs; historical requirements retained under the scoped amendment.

Verification:
- Source inspected at workspace HEAD e30bfd4efa82ebf3b2d79636761f6f3e8adc829f plus existing working changes. Existing auth/signup baseline:106 tests passed, zero failures/skips; /tmp/signup-optional-email-impact-20260915-tests.log. Not rerun or relabelled as new-feature proof.
- Postmark Email API/link tracking and Stripe Checkout expiry official docs checked2026-09-15. No cloud inspection, provider send, database change, CI or deployment.
- Documentation links, acceptance IDs, gap coverage and scoped whitespace checks are verified before handoff; all new implementation acceptance rows remain NOT RUN.

## Readiness follow-up — 2026-09-15

- Current source reviewed at `c0c925968e945d452a2b483b4ddd8b5fec99e847` plus dirty working changes. LINE required-email submit/resume/status and link-based account verification remain; planned OTP/revision/gate markers were not found in inspected auth/signup/billing/schema/contracts/web source. No new-feature test was run or claimed.
- Found an additional explicit writer: `account-merge.use-case.ts` transfers source email/verifiedAt to target and clears the source. Extended spec, P0/P2 inventory, G19, A16/A29 and migration fixtures so both accounts' applicable old proofs/revisions and merge-vs-OTP/checkout races must be covered.
- [Native Postmark evidence](../evidence/postmark-native-delivery-2026-09-15.md): correct UAT developer and Production contact test messages reached Gmail SMTP via provider UI. This does not satisfy application OTP A46. Those separate test sends were authorized and completed; this review sent no mail.
- Source provider/billing PR #558 was OPEN when checked. Canonical local Postmark config still has UAT ses, Production disabled, empty secret references. No deployed state was queried; choose a compatible implementation baseline and complete app secret/key/callback integration before release acceptance.
- Readiness is permission to begin the planned engineering sequence only when implementation is requested: P0 baseline/contract/lock inventory remains work, then P1–P2 core. D01 remains a disclosed design default; a separate accounting recipient would require an amendment before P4.
- This review changes only the optional-email spec, plan and memory; it does not merge, deploy, change runtime settings or implement feature code.
- Documentation verification passed: all relative links in the three edited docs resolve, no trailing whitespace, A01–A48 are unique and cover G01–G20, and explicit account-merge coverage is present. No feature test, CI or browser E2E was run in this readiness review.

## Always-on release amendment — 2026-09-15

- Scope this turn: revise only spec, plan and memory. No source/config mutation, cloud inspection, secret provisioning, mail send, CI, merge or deployment.
- Read local canonical config/renderers and mandatory UAT/Production protocol. Current source can render SES/disabled, apply environment overrides or deliberately disable signup/mail in maintenance mode; checking repo JSON alone cannot prove live readiness. Added required effective-config/secret-version checks and explicit deployed-not-launched status for CLOSED releases.
- Added spec §10.1–10.4 with same-build behavior, environment-specific Postmark/LINE/OTP contract, old-writer drain/cutover, cached-client recovery, migration isolation, compatible rollback, restart and key rotation. OTP key names/format and coordinated old-challenge invalidation are engineering defaults, not existing implemented config.
- Preserved existing security/legal/customer-access/commercial policies. Complete normal signed release/OPEN acceptance within the release instead of leaving feature activation to the user; no automatic legal/permission bypass. Kamal operation IDs cannot stand in for a V2 Passport without an accepted validator path.
- Closed a documentation conflict: runtime mail outage must not block current verified users from paying or crash core ERP; unverified/pending users retain the intended email gate and cancellation/recovery path. Release preflight still fails if required delivery setup is missing.
- Removed a release-order deadlock: input/native identity preflight precedes mutation, while new callback auth/OTP/customer behavior is proven against the running candidate before handoff. The old runtime is not required to implement new endpoints/keys to permit deploying them.
- Added G21–G28 and A49–A70 for cross-environment isolation, config overrides, rollout races, cloned queues, rollback after new financial/account facts, multi-instance/restart/rotation, same-email no-op, inconsistent legacy verification and actual target acceptance. Eight release checks R01–R08 define UAT_READY/PROD_READY; no test/deployed PASS is claimed.
- D01 remains the disclosed account-recipient default; implementation can use it without a new approval task. A separate accounting recipient is a future scope amendment if requested.
- Verification passed for this amendment: 18 relative document links resolve; G01–G28 each map to acceptance cases; A01–A70 are unique and all map to R01–R08; whitespace/conflict-marker checks pass. Checked removal of the contradictory runtime-outage rule. This is document/source consistency evidence only; no feature tests or environment readiness checks passed by implication.

Next: Implement P0–P7 when requested, preserving concurrent billing work. Keep A01–A70/R01–R08 NOT RUN until actual feature evidence exists; native provider delivery and the old 106-test baseline do not satisfy app OTP or environment release acceptance.

## Implementation — 2026-09-15

- Isolated worktree `mangmeeplus-email-otp`, branch `codex/optional-email-otp-billing-20260915`, base `c0c925968e945d452a2b483b4ddd8b5fec99e847`. Preserve concurrent root billing/mail changes. Provider dependency PR #558 was still open; resolve the integration base before delivery without merging unrelated unfinished work.
- Added additive OTP/session/revision schema, OTP HMAC binding and durable budgets, pending-email preservation, authenticated LINE reauthentication, and optional LINE intake policy. Work is incomplete; billing, UI, migration races and release configuration still require integration.
- Focused pure OTP tests: 4 passed, 0 failed/skipped. API typecheck passed after the initial backend changes. These are limited evidence, not A01–A70 or live readiness.
- User has authorized implementation and final CI-gated admin merges. This supersedes the earlier docs-only scope; no live deploy was requested in the latest instruction.


## Implementation checkpoint — 2026-09-15 (local verification)

- Implemented optional LINE intake policy, authenticated account email OTP/LINE reauthentication, retired legacy setters, shared profile/security/billing UI, current verified email proof for new financial authorizations, and explicit company recipient preview/submit/reconcile.
- Security amendment: first password now requires fresh same-account LINE reauthentication, preventing a stolen session from creating a password and using it as email-change proof. Normal password changes recheck the credential under lock. LINE reassign/unlink and account merge serialize with OTP; merge locks memberships before user accounts to match billing lock order.
- Fixed exact-email duplicate lookup to use lower equality (an underscore in an email must not act as a SQL LIKE wildcard). OTP dispatch revalidates proof after native provider preflight, immediately before the only POST; cancellation after dispatch still revokes the code. Confirmation locks the session against concurrent logout.
- PostgreSQL feature suite: 20 tests passed, 0 failed/skipped (`/tmp/email-otp-pg-expanded.log`). Covers OTP request/replay/confirm, wrong attempts, expiry, cancellation, password/session changes, target races, recipient/user budgets, key/environment isolation, LINE nonce/identity/freshness, first-password bootstrap, and company recipient concurrency/authority/readback/unknown outcome.
- Real HTTP + Next + Chromium smoke passed (`/tmp/email-otp-browser-latest.log`): OTP request/confirm/reload/lost response/leading zero, retired endpoints, missing-email payment gate, responsive 320/390/768/1280 panel, company-recipient preview/submit/reconcile. Providers simulated; no real mail/payment. Screenshot `/tmp/mangmee-billing-browser-evidence/email-otp-verified-mobile.png` inspected earlier. Human older-user testing/200% zoom remains pending.
- Fresh migration rehearsal used an isolated Docker PostgreSQL database `email_otp_migration_test`: all prior migrations, seeded old pending LINK/no-email user, then current migration. Old LINK became REVOKED; email and verification remained null, revision 0. Logs `/tmp/email-otp-migration-before.log`, `...-after.log`, `...-observed.log`. No copied customer data or external delivery.
- Source Postmark config selects UAT developer and Production contact without new activation flags. Logical secret references/HMAC version are prescribed, not evidence that live secrets exist. Native readiness and signed UAT/READY/Production/OPEN acceptance are NOT RUN.
- Broader unit run found inherited body-DTO backlog (13 billing routes) and runner wiring gaps, plus changed-flow fixture expectations. Owned fixture/logger/outbox fixes are in progress. Do not claim CI passed. API/web typecheck passed at earlier checkpoints; current API rerun uses 8 GiB heap after a default-heap abort.
- Integration base remains c0c92596; root branch has advanced to 1d74cf1d with concurrent billing work. PR #558 was OPEN with cancelled required CI when inspected. No commit/push/merge performed.

Next: Finish current regressions, native config preflight source checks, broader billing flows and test wiring; review complete diff and docs; resolve dependency base, then commit/push and wait for CI before admin merging develop/main. Do not mark A01–A70/R01–R08 wholesale passed from the limited evidence above.

## Implementation checkpoint — 2026-09-16 (current)

- Source implementation is complete. No package.json/dependency edits. Added source-enabled, environment-bound Postmark preflight, OTP HMAC key references, UAT recipient isolation and exact maintenance pins; no new feature toggle. Canonical senders: UAT developer@mangmeeplus.com, Production contact@mangmeeplus.com.
- Closed additional defects from actual browser/PG regression: LINE rejected-field corrections previously replayed the saved invalid body; expired billing recovery omitted new recipient APIs and account OTP routes after a term sweep; legacy verification page offered retired link mutations. Fixed all three and tested the corrected journeys. Password guesses have persistent per-user and per-IP budgets. First-password creation also locks the original session against logout.
- Company recipient UNKNOWN operations now open a durable support issue; only authoritative provider readback/definitive rejection closes it. New financial authorization waits, while cancel-renewal and scheduled downward changes remain usable. Historical invoices and recurring authorized contracts retain their original semantics.
- Evidence: [local implementation results](../evidence/signup-optional-email-local-2026-09-16.md). Complete API unit runner passed at the recorded checkpoint. Focused OTP/recipient/LIFF suite 87 passed; LINE signup PostgreSQL 30 passed; LIFF browser 7 passed; profile 26 passed; rate budgets 14 passed; guard/runner wiring 41 passed. No failed/skipped test is counted as passed.
- Actual Nest/PG/Next/Chromium OTP harness passed 10 scenario groups, including company DISABLED by term expiry → billing → same-session LINE reauth → new OTP → company recipient preview/submit/reconcile, plus retired-link recovery and responsive 320/390/768/1280 layouts. Postmark/LINE/Stripe transports are simulated. Restart HTTP and upgrade/plan-change browser regressions passed after aligning old provider fixtures with the server-derived email. Repeat browser verification is running at this checkpoint.
- Migration rehearsal, provider/config tests, Kamal tests and all 47 maintenance pin checks passed. Final API/web TypeScript checks are running; prior checkpoints passed. The first compiled runner-wiring invocation used the wrong output-directory-relative paths and failed setup; the correct source `tsx --test` run passed all 41 cases (`/tmp/email-otp-guards-wiring-correct.log`).
- After reading the cloud operations runbook, AWS read-only metadata found all nine canonical Postmark/OTP secret references NOT_FOUND. No secret values were read or provisioned; no native sends/deploys took place. App-native OTP delivery/callbacks, live rotation/rollback and UAT/READY/Production/customer OPEN acceptance remain NOT RUN. Source implementation is not evidence of target readiness.
- Integration checked again: origin/develop `647a3db4`, main `4edcc36f`; provider dependency PR #558 still OPEN at `def84702`, required Typecheck and Test CANCELLED. Base c0c92596 contains 36 later local predecessor commits beyond that remote branch, and develop does not contain Billing. Do not silently merge those unrelated unfinished predecessors. Own changes are still uncommitted at this checkpoint; prepare a reviewable PR and exact-head CI, then resolve that integration dependency before merge.

Final local check update: repeat purchase/paid repair/notification/admin browser regression passed (`/tmp/email-otp-repeat-final.log`); final API and web TypeScript both exited 0. Guard/runner wiring has 41 passed/0 failed/0 skipped. All 47 maintenance pins are current. These complete the scoped local checks; remote CI and dependency integration remain required.

Next: record exact commit/PR/CI state, then follow the user's CI-before-admin-merge instruction. Preserve the concurrent root checkout; do not deploy or claim native readiness.

## Commit and integration preparation — 2026-09-16

- Feature commit: `b89652ee` (113 scoped files). Integrated current origin/develop `647a3db4` in merge commit `494df47e`; kept the newer account OTP UI and predecessor shared LINE controls while retaining develop's loading/accessibility changes and native Postmark evidence. No new package.json change; the integration merge carries develop's existing pdfjs lockfile patch.
- After conflict resolution, web TypeScript passed (`/tmp/email-otp-web-typecheck-integrated.log`), Kamal tests passed 23/23 (`/tmp/email-otp-kamal-integrated.log`), and full 47-file maintenance validation passed (`/tmp/email-otp-maintenance-integrated-full.log`). Provider/mail/ERP source was not altered by those UI conflict resolutions.
- Prepare a draft PR to develop for review and exact-head CI. Its full diff necessarily contains unmerged Billing/Postmark predecessors; the feature commit above isolates this task's implementation. Do not admin merge the broad dependency diff until the prerequisite scope is resolved and required CI is green. PR creation, push and CI outcomes are pending at this commit.

## PR/CI follow-up — 2026-09-16

- Pushed source `5dad75da34e5c2a7b2394ede061d54059c428257`; draft [PR #575](https://github.com/MangmeeDev/mangmeeplus/pull/575), base develop, mergeable. [CI 35003554327](https://github.com/MangmeeDev/mangmeeplus/actions/runs/35003554327) passed Secret Scan/Security Audit/Migration Review/Production Config Validation, then failed six stale LINE identity fixtures that self-unlinked without a fallback login. No merge or deploy.
- Repaired the old unlink fixtures in stale identity/support/binding PG suites; added a real last-login rejection assertion. Final local suites passed 14/19/15 cases with no failures/skips. The application rule was preserved.
- Full web runner exposed old link/direct-email assumptions and develop's new accessible pending-control contract. Updated assertions to the shared OTP states and used the existing loading codemod for 22 affected new/predecessor pages. Added generation binding to the inherited AI usage handler fixture. Found and fixed missing profile-checklist cache invalidation after OTP. Complete web suite now passes 1,726 tests, no failures/skips; final OTP browser still passes 10 scenario groups.
- An asynchronous scope question is pending: wait for Billing/Postmark predecessors to merge, or explicitly include them in PR #575 after CI. Silence does not authorize merging the extra scope. Continue fixing CI for the concrete current PR while waiting.
- Exact passing local logs are in [evidence](../evidence/signup-optional-email-local-2026-09-16.md). Push this correction after final TypeScript and pin checks; wait for the resulting exact-head CI before any admin merge.

## CI and dependency update — 2026-09-16

- CI35004735415 on `3e31d545` passed typechecks, full unit/PG checks, the complete primary Postmark/Stripe HTTP runner, OTP/reset/signup/recovery browsers and historical invoice scans. It failed the original-invoice-import browser before the reason field rendered; no merge was made. Added bounded failure diagnostics. Two isolated local runs passed all nine invoice-import groups, including one using a fresh integrated API build; this does not turn the failed CI into a pass.
- Corrected the maintenance-validator test fixture to include canonical Postmark config files; the actual 47-file validator remains unchanged and passes. Corrected last-login Thai guidance to include verified email plus password as a valid fallback. Focused auth/web copy checks passed22/42; maintenance fixture passed.
- Dependency PR558 has now merged to develop `d419169b` and main via PR577 (`3baa10c2`) after green CI. The earlier optional scope question is superseded if the merged base contains all predecessors. Integrate that base and inspect the remaining feature diff; preserve new billing controls and history retention. No live release/provider mutation.

- Integrated d419169b: all predecessors are now in develop/main; only this feature's five commits were absent from develop. No further scope approval is required for this merge. Kept OTP/verified-email conditions and upstream billing gift/collection/retention controls. Conflict choices preserve current role permissions/DTO validation and accessible busy controls. API/web types and OTP browser10 groups pass; 47 pins and validator fixture/sync pass. Shared-build import/adjustment/cohort/SLA/config browser sequence is running. The pre-integration adjustment run crossed a source merge and is invalidated; rerun it on stable integrated source.

## Final integration regression corrections — 2026-09-16

- Pushed integrated7ef09d8e; CI35043320918 passed security/migration/config/typechecks and is still running full tests at this checkpoint. Local integrated web1726, PostgreSQL OTP/recipient/collection28, provider5/Kamal23 and47 maintenance pins pass. Shared-build browser OTP/import/adjustment/cohort/SLA/schedule passed.
- Readiness/portal browser exposed a real regression: after Stripe responded, the portal path checked only owner membership and could return a URL after the bound customer changed. Reproduced status200 in the POST-phase race (`/tmp/email-otp-readiness-diagnostic.log`). Restore the complete final assertCurrent transaction and add email-revision race plus direct-email-editing portal-configuration rejection.
- Found compatibility gap: historical password creation/login accepts more than128 characters, but OTP DTO/input truncated/refused them. Removed only the new current-password cap, keeping existing body/rate controls; changed the real browser fixture to a password longer than128 characters.
- Corrected portal/browser and long-password verification are running; do not merge7ef09d8e even if its incomplete run goes green. Commit/push the correction and require the new exact-head CI.

Final correction verification: readiness/portal19 groups PASS (`/tmp/email-otp-portal-fixed.log`), long-password OTP10 groups PASS (`/tmp/email-otp-long-password.log`), API/web TypeScript PASS (`/tmp/email-otp-api-portal-fixed.log`, `/tmp/email-otp-web-long-password.log`). These are actual Nest/PG/Next/Chromium with simulated provider boundaries. The source correction is ready for new CI.

## Integrated gift-day fixture correction — 2026-09-16

- CI35044244378 on3e2f4157 failed the primary HTTP runner at gifted-day repeat quote after full unit/typecheck and earlier PG suites passed. The new verified-email comparison reads the existing Stripe customer; the inherited gift-day simulator omitted that response. Do not merge this failed head.
- Added the missing synthetic customer/owner email and a regression assertion: stale client billingEmail is ignored, server-derived verified email is returned, and the existing shifted-anniversary assertion remains. No production logic changed.
- Plan/collection/gift-day Nest/PG/Next/Chromium27 groups and API TypeScript pass (`/tmp/email-otp-gift-final.log`, `/tmp/email-otp-gift-types.log`). Full primary HTTP runner passed256 groups on stable integrated source (`/tmp/email-otp-full-http-finalbase.log`, exit0), covering the previous failure and the remaining billing regression. Commit/push and another exact-head CI follow. No native send/payment/deploy.
- Current remote develop includes docs-only PRs #578/#580 after the already integrated Billing base; preserve those documents when refreshing the merge base. Root checkout remains untouched.
