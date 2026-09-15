# Agent Memory: Stripe/Postmark implementation status

Status: IN PROGRESS — implementation and focused checks have advanced; full plan acceptance and both develop/main merges are not complete.
Owner: Codex / repository owner.
Scope: approved Stripe packages, Postmark, Admin C01–C08, web and LINE access, local simulated E2E, bug/gap/UX review, final green-CI merges. NO DEPLOY.

## Current checkpoint — 2026-09-15

- Core checkpoint parent79872f74; marketing checkpoint parentf3219d3. Marketing runtime remains969e4c0.
- Checkout source fix verified: null/missing/unknown Session status preserves UNKNOWN attempt/case until the original Session recovers. Focused restart74 and settlement83 HTTP/PG/Next/Chromium/marketing groups PASS (counts overlap; providers simulated). Full combined failed earlier at settlement browser create429; bounded real retry now verifies retained reason/window. No rate-limit change. Source/log details: checkout-observation-result.json.
- LINE media source increment locally verified: atomic OCR/duplicate producing revision, web/LINE summary CAS, current saved photo/PDF facts, duplicate/actor/fallback checks and no repeated completed check-bill OCR. Focused735/module1320/PG75 PASS/0skip; API typecheck/SWC PASS. Exact sources and remaining limits: line-media-source-result.json.
- Continuation input/result source increment locally verified:607 focused/1343 module/93 PG PASS/0skip, API typecheck/SWC PASS. Missing/changed source retains completed work. Full combined billing run in progress from /tmp/mangmee-continuation-source-freeze.json; log /tmp/mangmee-billing-http-smoke.log. See line-continuation-source-result.json for limits.
- Earlier financial source freeze: /tmp/mangmee-current-billing-source-freeze.json (core tracked runtime and marketing files; includes concurrent tracked environment/mail changes, which are not owned by this task). It is working-tree evidence, not clean-commit or CI proof.

## Latest verified work

| Increment | Local evidence | Limits |
|---|---|---|
| Paired branch/member capacity policy | capacity-policy-result.json; offer13 and plan-change29 browser/HTTP groups,17 unit/37 PG | Original paid/repeat/downgrade terms preserved; no temporary-gift carryover |
| Original LINE paid request closure | paid-request-result.json;11 HTTP/browser groups,104 unit/13 PG | Exact original paid request only; no claim that an Admin gift is a sale |
| Restart charge evidence | restart-source-result.json;69 HTTP/browser groups including17 browser,12 unit/4 catalog | Explicit disputed=false; same original evidence recovers; simulated providers |
| LINE draft/receipt sources | line-draft-delivery-result.json and line-receipt-source-result.json | Current identity/access/revision/category at final send/fallback; no replayed mutation |
| LINE candidate inputs/replies | line-candidate-source-result.json;553 focused/69 PG/8 reader | Exact scoped facts/order, stable same-time order, before intake dispatch and final advisory delivery |
| LINE media source | line-media-source-result.json;735 focused/1320 module/75 PG | Atomic producing revision/current saved facts; pending repair/continuation/native boundaries remain separate |
| LINE text-capture source | line-text-source-result.json;594 focused/74 PG | Scoped duplicate recovery and current header;5 PG source cases use a simulated committed-capture producer |

All source-suite counts overlap. API typechecks PASS; no overall completion percentage is derived from test counts. Evidence files live in [billing integration evidence](../evidence/billing-integration-2026-09-13/README.md). The earlier full combined276 predates these increments; the current full combined run failed at settlement browser rate-limit handling; focused recovery suites passed, but a new combined pass is still owed.

## Implemented scope

Initial/repeat/upgrade/downgrade/restart/cancel/resume packages; strict paid invoice evidence and atomic grants; annual upfront receipt quota; runtime prices/receipt terms/branch-member capacities/VAT/sales cohorts; paid capacity repair; owner web/LINE review and recovery; Admin company/scope/history/cases/outcomes and original-invoice apply/import; original Checkout expiry; provider events/manual/daily/scheduled/bounded discovery; settlement observation and bounded reconciliation batches; reviewed refunds with same-command/aged-UNKNOWN recovery; manual/trial plans and additive receipts; paid temporary package/capacity/receipt/AI adjustments with provenance and audit; current AI support explanation; Postmark signup/claim/status/verification and owner-approved email password reset; mail monitoring, canonical LINE credentials and Admin QR/unlink recovery. Detailed checkpoint limits are in the linked evidence and historical notes.

## Remaining work

1. LINE source boundaries: pending-media partial attachment repair, substitute/correction result sources, later storage permission races, and stored clarification/original-choice lineage. Active questionnaire input and returned continuation source increments are now locally verified; this does not close historical clarification lineage. Candidate and text-capture increments above must not be listed as missing again. Use existing ERP domain/scoped readers and committed revisions; no mutation/model/OCR replay for validation.
2. Current AP01–AP24 browser/API/PG cross-layer acceptance and remaining native device/LINE/LIFF/provider matrix. Historical sandbox proofs exist; they do not prove the final current tree. Fix actual failures without inventing a broader product policy.
3. Review current financial reconciliation evidence and reconcile the exact implemented controls against C01–C08. Checkout-state regression and settlement browser retry are locally verified; a new full combined result remains pending. Existing old-debt/refund policy is manual review; no new debt forgiveness or arbitrary paid-state override is approved.
4. Paid Admin free-day/next-collection behavior and local mail-history retention need the earlier Owner answers below before dependent implementation.
5. Final clean-source verification, one readiness-driven CI cycle, review and authorized develop/main merges in BOTH repositories. No intermediate push/CI and no deployment.

## Pending Owner decisions — do not repeat the questions

- Do Admin free days for an already-paid customer move the next Stripe collection date, or keep it? Manual/trial renewal and paid temporary capacities/receipts/AI controls are already implemented; this financial timing decision remains unanswered.
- How long should local email-delivery history be retained, and should automatic cleanup start disabled? The asynchronous question remains unanswered. Never delete unresolved work, dedupe/send-attempt proof, suppression or audit evidence merely to clean history. Local retention does not set Postmark's retention.

## Approved business decisions

- Confirmed purchase starts and charges immediately; unused trial days do not carry.
- Same full package adds quota now and duration after max(paidThrough, paidAt). Annual Starter360/Basic600/Pro1200 upfront; no monthly reset of paid grants. Pro annual with8months left plus another year adds1200 receipts and ends20months later.
- Upgrade charges prorated difference over prepaid segments, starts immediately, keeps expiry. Downgrade takes effect at the paid boundary with retained resource selection; no deletion.
- Receipt-only offers hidden/closed. Enterprise1999 and SYSTEM ภ.ง.ด.53/50ทวิ Coming soon, no Checkout. Manually entered external tax documents remain separate.
- Signup FREE_TRIAL_15:7menus (6parents/17keys),1branch,2members including OWNER,15receipts per Bangkok month,30days from provisioning. Keep approved signup/eligibility/account-link policy.
- VAT OFF; future7% inclusive/exclusive and issuer changes use Admin review/independent approval. Stripe provides customer Invoice/Receipt; Postmark handles auth/claim/status mail without duplicate fiscal PDFs.
- Previously paid renewal failure gives7day grace with old rights/remaining receipts, then suspend and stop collection. Cancel at paid boundary. Refund/dispute/old debt require manual review.

## Repository and workflow boundaries

Core /Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus, branch codex/stripe-postmark-implementation-20260912, draft PR558→develop. Last known remote def8470215f587632136d67288c2b38d199ac9f8 (not freshly fetched).
Marketing isolated /Users/thawatchai/Project/MangmeeYungYuen/mangmee_web-stripe-postmark-20260912, same branch, draft PR2→develop. Last known remote4169ea219b2b4c0163bdd747e05b6d1ffea44343 (not freshly fetched). Original dirty mangmee_web is untouched.

Preserve concurrent Postmark/config/environment/CI/cloud/signup edits, research/memory files and untracked apps/web/CLAUDE.md. Never add-A, broadly restore, or commit their catalog hunk. No package.json edits, new dependencies, subagents, goals, automations, native messages or live payments. Owner permits final admin merge only after green CI; CI costs money, so intermediate commits remain local. Before any remote event, verify current workflows cannot deploy from it; mandatory cloud/deploy runbooks still apply to actual cloud actions.

## Local verification

Guarded DB only: localhost/127.0.0.1:15432/mangmee_billing_20260912. /tmp/mangmee-run-billing-smoke.mjs loads local fixture env without printing secrets. Full run uses BILLING_BROWSER_E2E=1 and MANGMEE_MARKETING_DIR pointing to the isolated repo. SWC output /tmp/mangmee-postmark-api-build. No overlapping SWC/browser runs. API tsc8GB/web6GB. /tmp/mangmee-run-line-source-pg.mjs runs four source/draft/delivery PG suites; all latest included cases ran with zero skips. Copy each final log before another runner overwrites it. Restore only known generated next-env/screenshot files after browser exit; inspect git diff first.

[Historical checkpoints and prior provisional85% estimate](stripe-postmark-implementation-history-through-source-2026-09-15.md) are retained for provenance, not current missing-work claims. The old8–16hour estimate was preliminary effort excluding tests/CI/merge, not a deadline.
