# Agent Memory: Stripe / Postmark implementation

Status: IN PROGRESS; owner resumed with “ทำต่อ”. No merge or deployment.
Owner: Codex / repository owner.
Scope: Implement approved package/payment/Postmark/Admin C01–C08/web/LINE specs, prove simulated E2E, then merge develop and main in BOTH repositories after green CI. Keep live deployment separate.

## Decisions and constraints

- Start and charge immediately on confirmed purchase, with no trial-day carryover.
- Same full package adds its quota now and its duration after max(paidThrough, paidAt). Annual quotas: Starter360, Basic600, Pro1200 upfront; no monthly paid reset. Pro annual with8months left plus another annual purchase gives1200 more receipts and20months remaining.
- Upgrade charges the prorated difference across prepaid segments, starts immediately and keeps expiry. Downgrade takes effect at the purchased boundary, with retained branch/member selection and no deletion.
- Receipt-only offers HIDDEN and SALES CLOSED everywhere. Enterprise1999 and SYSTEM ภ.ง.ด.53/50ทวิ Coming soon; no checkout. Existing manually entered external tax documents remain supported.
- Signup:7menus (6parents/17keys), FREE_TRIAL_15,1branch,2members including OWNER,15receipts per Bangkok month,30days from provisioning. Retain manual approval/eligibility/account-link rules.
- VAT OFF by default;7% inclusive/exclusive, issuer, versioned preview and independent approval through Admin. Stripe customer Invoice/Receipt; Postmark auth/claim/notification mail with no duplicate fiscal PDF.
- Previously paid renewal failure:7day grace with old rights/remaining receipts, then suspend and stop future Stripe collection. Cancellation at paid boundary. Refund/dispute/old debt require manual review.
- Owner permits admin merge when CI passes and Developer Chrome provider access. NO DEPLOY. No real recipient sends/live charges in local tests.
- No subagents. Ponytail full read from current .agents/skills/ponytail/SKILL.md (old user path is stale). No package.json edits. Untracked apps/web/CLAUDE.md and original dirty mangmee_web checkout stay untouched.

## Current repositories / CI

- Root: /Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus, branch codex/stripe-postmark-implementation-20260912, draft PR558 to develop.
- Root HEADd3ac0c83 (original invoice recovery) pushed; CI34805765742 IN PROGRESS. Previous CI34803284452 at6da65148 FAILED in signup browser fixture: click raced the actual account-security legal redirect. The corrected fixture now lets the gate finish, accepts legal, then skips LINE; local signup8 PASS. Do not rerun the known old revision as a fix.
- Previous root7ca2d7a8 C07 missing-event discovery: CI34801493799 PASS.
- Isolated marketing: /Users/thawatchai/Project/MangmeeYungYuen/mangmee_web-stripe-postmark-20260912, same branch, draft PR2 to develop. HEADfc5ff19; CI34805765619 PASS.
- Both drafts remain open; authorized develop/main merges are still owed after full implementation/review/green CI. Read-only no-deploy GitHub surface preflight is recorded; refresh before eventual merges.

## C03 verified checkpoint d3ac0c83

Exact original-invoice apply retry is implemented in contracts/DTOs/Admin safe25+1 list/detail, source-bound preview/submit/worker, original operation retry/cancel and UI result→invoice→company return. It reuses the existing account lease, strict paid evidence and entitlement writer. Another applied invoice or COMPLETED attempt cannot certify a HELD target. Already-applied targets require no provider I/O. Legacy targetless commands can be read/cancelled and lead to original invoice selection.

Operation result/review-case/audit commit with the live operation lease. Independent paid application may succeed under the account lease after an operator worker loses its operation lease; the stale operator cannot certify success or resolve its case. Only its replacement observes the original grant. Current operator membership is separate from the target expired customer; scoped non-member operators are tested. Observation timestamps do not invalidate a reviewed invoice; material source changes do. Shared financial observation/case/audit is used for subscription and repeat evidence; missing refund/dispute fields are rejected.

Found and fixed: Next dynamic-slug conflict, new Admin route accidentally selecting the target company as actor membership, stale list capability buttons, malformed financial defaulting, and signup browser fixture navigation race. No security gate or timeout was relaxed.

Verification: focused8 new HTTP/PG/390px browser groups PASS (15 with existing purchase prefix); billing/DTO29 and actual PostgreSQL35 PASS; API typecheck PASS; pins/check regression PASS. Full current combined158 HTTP/PG/Next/Chromium/isolated-marketing PASS, including the final list-capability guard. Signup8 local rerun PASS after the CI fixture fix. Final web/API typechecks PASS; evidence recorded. Committed/pushed asd3ac0c83; new CI34805765742 pending.

## C03 repeat recovery increment (locally verified)

Spec+plan updated first. Added billing-repeat-apply-smoke.ts and wired the original one-time paid repeat journal after lost schedule update into real Admin invoice preview/submit/UNKNOWN/retry. The helper tests mismatched Checkout invoice refusal, lost resume response, exact original grant/time, preserved purchase/invoice counts and mobile permanent-operation→invoice→company return. Main flag BILLING_REPEAT_APPLY_ONLY exits after repeat and existing generic Admin command checks; CI browser line added. Generic RECONCILE case detection/resolution/result/audit now share the final operation lease/CAS transaction. Repeat smoke64 overlapping groups (3additional repeat recovery groups), API typecheck and billing/DTO20 PASS; mobile capture inspected. Inspect /tmp/mangmee-billing-http-smoke.log and /tmp/mangmee-repeat-apply-api-typecheck.log. Primary158/source atd3ac remains historical for this WIP. Evidence in repeat-apply-result.json; ready for scoped diff review/commit/new CI. Frontend source unchanged fromd3ac; generated next-env restored. No merge/deploy.

## Earlier verified coverage

- Primary158 combined result/source now identifies this increment;150 at7ca2d7a8 is archived. Discovery7 includes durable fixed-window pagination, webhook race, stale lease, current platform authorization, retry/backoff/resume/cancel, bounded caps and no financial mutation. Daily/historical/config drift is not included.
- Signup8: real form/manual approval/Postmark UNKNOWN lookup/single original claim/BFF session/default entitlement, fragment/legacy proof, expired resend, skip LINE/legal, real local receipt bytes with OCR503/manual recovery, logout/login return. No native mail or OCR success claimed.
- Email verification6: explicit click/fragment+legacy, lost response→profile, stale/single-use/expiry/ACTIVE/unique email transaction fences and stale resend. Auth93/web1703 at6da checkpoint, API/web typechecks PASS. Separate source receipt; not added to primary150.
- Paid initial/repeat/upgrade/downgrade/restart/cancel/resume, mapped financial history, quotas, scoped support/cases/notifications, policy/VAT approval and retained draft/impact lists are included in the combined evidence.
- LINE current actor/source/read proof and durable exact queued payload/UNKNOWN retry: module1287 at its recorded checkpoint. Full intake/draft/live-capture/AP matrix and native delivery not yet complete. Historical test counts overlap and must not be summed.

## Open questions

Owner has not answered the earlier question whether to add verified-email Postmark password recovery alongside LINE. Approved legacy spec intentionally parks email RequestPasswordReset/ConfirmPasswordReset endpoints; /forgot-password uses LINE. Keep email reset closed until an answer. Explicit verification is separate and already implemented. Continue other authorized work.

## Remaining implementation

- C03 aged UNKNOWN/compensation and recorded support outcomes. Generic RECONCILE case transaction correction is locally verified in the increment above.
- C05/C06 detailed capacity rollouts/cohorts/scheduling, global SLA/escalation publication and complete runtime provider readiness/configuration.
- C07 daily automatic scans, durable historical invoice coverage, configuration/settlement drift and bounded bulk recovery.
- C08 exceptions/debt/refund/temporary override/revoke/expiry/compensation/export/privileged documents under approved policies.
- Full Postmark monitoring/retention/mail operations/EM09 identity variants; email reset only after decision.
- LINE source-derived intake/draft/live-capture and full AP21–24; shared credential DB-vs-environment consumers, rich-menu/runtime webhook configuration. Existing credential write UI is deliberately closed until every verifier/reply/push/LIFF consumer uses a consistent effective revision; do not just expose its save button.
- Final exact-source verification, CI, review and authorized develop+main merges in both repositories. No deployment.

## Artifacts / reproduction

- [Evidence and source hashes](../evidence/billing-integration-2026-09-13/README.md), [controls spec](../specs/mangmee-billing-controls-spec-th.md), [controls plan](../plans/mangmee-billing-controls-plan-th.md), [package amendment](../specs/mangmee-billing-pack-amendment-2026-09-12.md).
- [Historical checkpoints](stripe-postmark-implementation-history-through-2026-09-14.md) preserve earlier decisions, commands and failures; their status paragraphs are superseded here.
- Local database only localhost15432/mangmee_billing_20260912 and Redis6379. Load .env +0600 /tmp/mangmee-billing-local.env via Node parseEnv without printing credentials.
- /tmp/mangmee-run-billing-smoke.mjs asserts that DB, runs compiled /tmp/mangmee-postmark-api-build/scripts/billing-http-smoke.js and writes private /tmp/mangmee-billing-http-smoke.log. Compile SWC only after the prior smoke ends. Full browser: BILLING_BROWSER_E2E=1 and MANGMEE_MARKETING_DIR=isolated path. Focus: BILLING_APPLY_RETRY_ONLY=1. Separate signup/verification/discovery flags remain available.
- /tmp/mangmee-apply-retry-focused.log, /tmp/mangmee-signup-ci-race-fixed.log, /tmp/mangmee-apply-billing-regression.tap, /tmp/mangmee-apply-pg.tap; screenshots in /tmp/mangmee-billing-browser-evidence. Do not copy whole Next log: legacy proof URLs can be present.
- /tmp/mangmee-invoice-retry-api-typecheck.log; final web typecheck pending. Once Next stops, restore only generated apps/web/next-env.d.ts. No smoke/typecheck process remains active.

Next: review/commit/push the locally verified repeat recovery increment, then follow its CI and CI34805765742 for the prior slice. Continue remaining independent implementation while CI runs; do not ready/merge the draft solely because a checkpoint passes.
