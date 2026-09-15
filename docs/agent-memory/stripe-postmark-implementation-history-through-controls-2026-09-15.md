# Agent Memory: Stripe/Postmark implementation status

Status: LOCAL CHECKPOINT VERIFIED; overall task IN PROGRESS, not100% and not merged.
Owner: Codex / repository owner.
Scope: Stripe packages, Postmark, Admin C01–C08, web/LINE access, simulated E2E, practical Thai UX, final green-CI develop/main merges in both repos. NO DEPLOY.

## Current checkpoint

Newest local checkpoint: CT22 Admin pause/resume is now implemented through the existing independent approval path, dedicated collection permission, bounded original invoice impact, native source/lease checks and safe pause projection. PAUSE date can be edited without briefly resuming; original draft invoices are never collected by RESUME. Real PostgreSQL audit rollback, lost provider reply, current requester permission loss, provider drift and late observation after automatic resume pass. The case links to the original Admin operation; customer status shows the observed pause. Gift-day delayed observation preserves original remaining receipts after automatic term expiry; repeat uses the shifted calendar anniversary. **22 focused HTTP/PG/Next/390px browser groups PASS**, including6 collection control groups and7 gift groups, at /tmp/mangmee-admin-collection-browser-pass.log. API/web typechecks PASS before the last small case-link/copy/fixture edits; final clean checks remain required. The screenshots were inspected; corrected one misleading generic “collection date unchanged” paragraph afterward, to be captured again in final verification.

Email retention:11 monitoring/retention groups PASS, including actual audit rollback and100/101-row continuation, at /tmp/mangmee-email-retention-bounded-browser-pass.log. Screenshot framing changed afterward and needs the final run. Both new migrations applied only to guarded local fixture DB. No push/CI/deploy. Next: scoped local commit, clean integration worktree, merge latest develop hotfixes, finish CT/AP evidence audit (including Admin feature-preset browser proof), final combined/clean checks and readiness CI followed by authorized Admin develop/main merges in BOTH repositories.


Latest continuation: Owner explicitly reiterates green-CI Admin merge develop+main for both repos after completion; no deploy. Gift-day final focused HTTP/PG run including delayed observation after expiry PASS at /tmp/mangmee-free-days-delayed-pass.log. Latest email retention HTTP/PG/browser11 groups PASS including actual audit rollback and100/101-row cap. Source review discovered CT22 scoped Admin pause/resume collection is still contract-only; implementing it before final CI under the existing approved controls spec. Both remote branches fetched read-only; core PR558 conflicts with newer develop hotfixes, to resolve in a clean worktree preserving concurrent edits before final verification. No push/CI/deploy.


Owner continuation2026-09-15: both pending decisions APPROVED; implementation underway without further questions. Email history runtime policy/API/Admin UI, scoped bounded cleanup and retained transport/dedupe/suppression evidence are implemented. Focused monitoring+retention10 HTTP/PG/390px browser groups PASS (4 new retention groups), see email-retention-result.json and /tmp/mangmee-email-retention-browser-pass.log. A real JSONB key-order replay comparison bug was fixed. Migration20260915180000 applied only to guarded local fixture DB. Retention screenshot needs recapture because a sticky header overlapped the region-only artifact.

Paid gift-day implementation is IN PROGRESS and UNCOMMITTED: new BillingFreeDays uses zero-price schedule, existing reviewed Admin approval, exact provider observation before term extension, no units/AI grant, immutable paid invoice segments, current cancellation and successor retiming of a pending downgrade. Initial real HTTP/PG ordinary+lost-provider-response checks PASS; later cancellation/browser fixture was corrected to include existing accepted:true consent. Browser/cancellation/pending-downgrade regression is running;14 focused gift/collection/schedule/upgrade tests passed before the newest stricter observation predicate. Do not claim this increment complete or rerun while the current runner is active. Latest source includes a remaining gift-only upgrade recovery message (buy same package then upgrade); assess UX and final acceptance explicitly. Check processes/log before compiling again; no overlapping SWC/browser runs.

All current increment edits are in the working tree. No push/CI/merge/deploy. Preserve earlier unowned config/environment/cloud/Postmark/signup changes listed below. Final source verification, full CT/AP audit and both develop/main merges still pending.

Current checkpoint 2026-09-15: local combined308 groups PASS, including74 browser groups and all12 STARTER/BASIC/PRO × month/year × web/LINE-origin purchases. The later Admin AI budget parser/Thai forms pass a separate12-group real browser/HTTP/PG follow-up and75 unit/error guards. Receipt source/current access:24 unit,341 receipt/webhook,10 new PG and7 existing PG PASS. Signature/current LINE source:598 focused PASS. Counts overlap; source/build and simulation boundaries are explicit in the evidence. API/web typechecks and SWC pass. Full task acceptance, implementation of the two approved Owner decisions, final clean-source CI and both develop/main merges remain open. No CI/push/merge/deploy.

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
2. Complete paid Admin free-day collection behavior and local mail-history retention under the approved Owner decisions below.
3. Final clean-source verification/review, one readiness-driven CI cycle and authorized develop/main merges in BOTH repos. Preserve other ongoing work. No deployment or intermediate CI/push.

## Owner decisions approved 2026-09-15 — implement, no further approval needed

- Admin gift days for an already-paid customer extend service and move the next Stripe collection date by the same number of days. A gift of days alone adds no receipt units or AI quota. Preserve cancellation intent, pending downgrade, purchased evidence and append-only actor/reason/before/after history.
- General local email-delivery history retention is180days; automatic cleanup defaultsOFF. Admin can change duration and enable/disable without redeploy. Preserve unresolved work, original intent/generation/provider mapping, deduplication, suppression and audit. This does not change Postmark provider retention.
- Current task: implement both amendments, audit full CT/AP acceptance, fix verified gaps, final clean-source checks and one final green CI/merge cycle for both repos; no deploy. Existing unowned environment/signup/cloud diffs remain untouched.

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
