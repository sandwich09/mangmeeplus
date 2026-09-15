# Agent Memory: Stripe/Postmark implementation status

Status: LOCAL CHECKPOINT VERIFIED; overall task IN PROGRESS, not100% and not merged.
Owner: Codex / repository owner.
Scope: Stripe packages, Postmark, Admin C01–C08, web/LINE access, simulated E2E, practical Thai UX, final green-CI develop/main merges in both repos. NO DEPLOY.

## Current checkpoint

Current checkpoint 2026-09-15: local combined308 groups PASS, including74 browser groups and all12 STARTER/BASIC/PRO × month/year × web/LINE-origin purchases. The later Admin AI budget parser/Thai forms pass a separate12-group real browser/HTTP/PG follow-up and75 unit/error guards. Receipt source/current access:24 unit,341 receipt/webhook,10 new PG and7 existing PG PASS. Signature/current LINE source:598 focused PASS. Counts overlap; source/build and simulation boundaries are explicit in the evidence. API/web typechecks and SWC pass. Full task acceptance, the two pending Owner decisions, final clean-source CI and both develop/main merges remain open. No CI/push/merge/deploy.

Parent checkpoints before this increment: core bba55f6c; marketing c262cb6 (marketing runtime969e4c0). Use git log for the new scoped local commits. No running browser/API smoke remains; no queued patch needs applying.

## Verified changes

| Change | Evidence | Boundary |
|---|---|---|
|11 Admin textarea labels, actual429 reason/window/same-key recovery;12 initial offers | billing-label-offer-matrix-result.json | HTTP67/browser79/focused80 overlap; simulated providers |
|Original expense revision + atomic attachment/retirement/duplicates + current post-storage access | receipt-upload-source-result.json |24 unit/341 receipt+webhook/10 new PG/7 existing PG,0skip; real permission resolver and DB, simulated storage |
|Signature activation/current owner and original LINE event; supporting/payment-media pre-write check | signature-upload-access-result.json |598 focused,0skip; current compiled AppModule/53 HTTP groups and combined proof |
|Current combined billing/Admin/marketing runtime | combined-upload-access-result.json |308 groups/74 browser/12 matrix; /tmp/mangmee-upload-signature-combined-source-freeze.json; predates later budget UX only |
|Admin budget overflow/invalid-input safety, Thai platform page/reload, upload-error copy | admin-budget-input-result.json |12 actual browser/HTTP/PG groups,75 unit/error guards, no provider calls; screenshots inspected |
|Earlier original LINE questions/ordered choices and read/media/draft/text/correction/substitute sources | line-clarification-source-result.json and respective source receipts | Already locally verified; do not relist these as wholly missing |

All evidence is in docs/evidence/billing-integration-2026-09-13/. Test groups overlap; never add them into an overall percentage or business-flow count. Current working-tree imports include concurrent environment/config edits; final clean-source evidence is still owed.

## Defects fixed and test corrections

- React textarea defaultValue became nested-label text, changing the accessible name. The form/reason were retained; explicit sibling labels fix the cause without weakening limits or exact locators.
- Shared receipt completion could overwrite concurrent CONFIRMED state and partially replace a receipt. Original revision CAS and one transaction now preserve human work; fresh access/source checks stop business writes after storage when authority changed. Completed private bytes may remain without an expense/signature link.
- Shared budget parser accepted overflowing nonempty text as Infinity; JSON converted it to null (clear override). Safe-integer parsing and decimal text inputs now refuse invalid values before confirmation/HTTP while preserving intentional blank inheritance. Company/platform forms and new source errors use Thai guidance.
- Combined fixture corrections: manual/invoice alert locators exclude the empty Next announcer; restart revision allocation follows max historical version+1 after restored settings. The focused platform failure test now holds reads unavailable until the real error appears, then restores transport before reload. Production billing behavior was not changed for these fixture defects.

## Remaining work

1. Review current evidence against full CT01–CT32/AP01–AP24 acceptance and record any still-unproven combinations precisely. Native LINE/LIFF/provider/device acceptance is separate;308 simulated groups do not certify every row.
2. Complete paid Admin free-day collection behavior and local mail-history retention only after the earlier Owner decisions below. Do not guess financial timing or retention defaults, and do not repeat the questions.
3. Final clean-source verification/review, one readiness-driven CI cycle and authorized develop/main merges in BOTH repos. Preserve other ongoing work. No deployment or intermediate CI/push.

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
