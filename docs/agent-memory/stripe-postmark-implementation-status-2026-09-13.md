# Agent Memory: Stripe / Postmark implementation

Status: IN PROGRESS. Root HEAD `5c54f526` CI `34860688515` FAILED in the invoice-history browser link. C06 explicit sales cohort is prepared for commit: focused73 PASS (9 cohort-related, overlapping counts), combined web/LINE/marketing163 PASS and final invoice-history diagnostics8 PASS locally. Fresh CI remains required. Full implementation and authorized develop/main merges in BOTH repos remain owed. Do not stop at this checkpoint or call the old 70% estimate calculated coverage.
Owner: Codex / repository owner.
Scope: Approved Stripe packages/Postmark/Admin C01–C08/web/LINE implementation, simulated E2E, gap fixes and green-CI develop/main merges. NO DEPLOY.

## Decisions

- Start and charge immediately on confirmed purchase, with no trial-day carryover.
- Same full package adds its quota now and its duration after max(paidThrough, paidAt). Annual quotas: Starter360, Basic600, Pro1200 upfront; no monthly paid reset. Pro annual with8months left plus another annual purchase gives1200 more receipts and20months remaining.
- Upgrade charges the prorated difference across prepaid segments, starts immediately and keeps expiry. Downgrade takes effect at the purchased boundary, with retained branch/member selection and no deletion.
- Receipt-only offers HIDDEN and SALES CLOSED everywhere. Enterprise1999 and SYSTEM ภ.ง.ด.53/50ทวิ Coming soon; no checkout. Existing manually entered external tax documents remain supported.
- Signup:7menus (6parents/17keys), FREE_TRIAL_15,1branch,2members including OWNER,15receipts per Bangkok month,30days from provisioning. Retain manual approval/eligibility/account-link rules.
- VAT OFF by default;7% inclusive/exclusive, issuer, versioned preview and independent approval through Admin. Stripe customer Invoice/Receipt; Postmark auth/claim/notification mail with no duplicate fiscal PDF.
- Previously paid renewal failure:7day grace with old rights/remaining receipts, then suspend and stop future Stripe collection. Cancellation at paid boundary. Refund/dispute/old debt require manual review.
- Owner permits admin merge when CI passes and Developer Chrome provider access. NO DEPLOY. No real recipient sends/live charges in local tests.
- No subagents. Ponytail full read from current .agents/skills/ponytail/SKILL.md (old user path is stale). No package.json edits. Untracked apps/web/CLAUDE.md and original dirty mangmee_web checkout stay untouched. Another task changed docs/runbooks/cloud-environment-operations.md and created docs/agent-memory/uat-power-2026-09-14.md during this run; preserve and exclude both from this commit.

Preserve all unrelated tracked/untracked work, including cloud runbook/UAT, marketplace and SCB research/memory, and apps/web/CLAUDE.md. The original dirty mangmee_web checkout stays untouched. No goal/automation/subagent or package.json changes. Read mandatory runbooks before any cloud action; this increment performs no cloud/provider-native action.

## Current repositories

- Root `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus`: `codex/stripe-postmark-implementation-20260912`, HEAD `5c54f5262cb81cfd12c52ba3c60a386bb566cc04`, draft PR558 → develop. C06 source/docs/evidence and invoice-history diagnostics are WIP. Latest CI34860688515 failed history navigation; earlier cdd0c02a CI34852433176 passed. Do not merge on a historical green revision.
- Isolated marketing `/Users/thawatchai/Project/MangmeeYungYuen/mangmee_web-stripe-postmark-20260912`: same branch, HEAD `aff222b9fdbdb6c8413c9a124b651df32cc23377`, CI34860729005 PASS, draft PR2 → develop. Runtime remains969e4c0. Three cohort alignment docs are WIP; no source edits in this increment.
- Refresh read-only GitHub no-deploy workflow preflight before eventual merges. No merge/deployment performed here.

## Implemented checkpoints

Core initial/repeat/upgrade/downgrade/restart/cancel/resume packages, strict paid evidence and atomic access/quota, grace, shared web/LINE entry, runtime catalog, customer documents, Postmark signup/claim/verification and notification recovery are implemented at their recorded checkpoints. Admin supports scoped company/history/timeline, case ownership/follow-up/outcomes, policy/VAT drafts/impact/independent approval, action gates, operator scope management, exact invoice/event/delivery recovery. Messaging credential publication and Admin QR legacy binding repair are implemented. Scheduled bounded event discovery, historical invoice discovery and verified record-only original invoice import are implemented. Import stores HELD evidence and requires separate apply review; no direct grant/refund/charge.

C06 new cohort: optional bounded `salesCompanyIds` (absent/null all, [] closed, at most100 unique existing companies), material company impact, company-before-settings approval locks/current existence validation, current new-purchase/downgrade barriers, safe status/public redaction and Admin directory/draft/review UI. Original held paid apply is tested under a separate synthetic closed-cohort revision, preserving the old immutable consent revision. Admin browser proves lost draft response/same command, reload, independent approval, excluded-company web/LINE return, close/reopen and publication during a Customer response before Checkout admission. Shared existing financial/access writers are unchanged by this increment.

## Verification and limits

- `sales-cohort-result.json`:73 HTTP/PostgreSQL/Next/Chromium groups PASS, including9 cohort-related groups and overlapping purchase prefix.16 changed source hashes have no drift. `/tmp/mangmee-cohort-paid-final.log`; mobile `admin-sales-cohort-mobile.png` inspected at390px/no overflow. API/web typechecks,13 web error guards, maintenance pins/diff pass.
- `invoice-import-result.json`:9 import groups PASS and36 PostgreSQL/package checks PASS/0skips at5c54f526. Stripe GET only, original consent/customer/Checkout/contract/InvoicePayment/PaymentIntent/Charge evidence, live actor/source/account/operation fences, real audit rollback, one held record and exact recovery links.
- `invoice-import-regression-result.json`: frozen5c54f526 source, signup8 → events7 → email6 → apply15 → repeat64 → invoice history8 → combined web/LINE/isolated marketing162 PASS. Counts overlap; never add them together.
- Current C06 runtime invoice history8 PASS at `/tmp/mangmee-cohort-invoice-history-regression.log`; combined web/LINE/isolated marketing163 PASS at `/tmp/mangmee-cohort-combined-regression.log`. Both run on the C06 runtime before the later history-only diagnostics fixture edit.
- Latest CI34860688515: original-apply navigation (the prior404) and later Messaging/QR steps passed; invoice history timed out waiting for company-page link `ตรวจประวัติใบแจ้งหนี้ Stripe`. `/tmp/mangmee-invoice-import-ci-failed.log`. No retained UI/API trace proves cause. New invoice-history fixture observes successful document/BFF detail and logs safe paths/status/headings/links plus screenshot on failure; no route retry/timeout relaxation. These diagnostics were added after the current compiled regression started and must be compiled/tested separately before acceptance.
- Configuration fixture initially returned400 in a negative-permission test because the helper reread settings after revocation and built invalid input; fixed by testing valid saved input. Dropdown initially lacked an explicit accessible label; actual rendered labels proved the issue and aria-label fixed it. App guards were unchanged.
- Cohort tests initially appended to the entire configuration suite exhausted the next legacy event test's30/min budget. Cohort now uses explicit BILLING_SALES_COHORT_ONLY and its own7-minute CI step, preserving rate limits. Main full regression retains existing coverage; dedicated cohort run includes paid prefix.
- No native payment, mail/LINE delivery, provider configuration change or deploy. Full default local API suite is not claimed green: prior local databases lack unrelated canonical fixtures; CI owns the complete fixture check.

## Current processes / next steps

1. All local sessions ended: cohort73, combined163, invoice history8 and final diagnostics8 PASS. Source-bound receipts are in sales-cohort-result.json. Generated next-env and old downgrade screenshot restored. No local browser/compiler remains active.
2. API/web typechecks and13 web guards PASS. History diagnostic uses safe document/BFF assertions and preserves original failures if screenshot collection fails. Its success locally does not establish the old CI failure's cause.
3. Commit/push the reviewed scoped files and the three isolated marketing alignment docs. Read actual fresh CI results and investigate failures before any merge; prior CI is failed.
4. Record exact new regression/source receipts; finish docs/marketing alignment, inspect scoped diff, commit/push both branches and update draft PR descriptions with current evidence/limitations. Use body files for gh edits. Fresh CI still required. Do not merge unfinished controls.
5. Continue remaining authorized implementation below; do not end the task at this bounded checkpoint.

Local DB only: localhost:15432/mangmee_billing_20260912, Redis6379. `/tmp/mangmee-run-billing-smoke.mjs` loads root.env +0600`/tmp/mangmee-billing-local.env`, asserts exact local host/port/name and never prints secrets. Compile: `corepack pnpm --dir apps/api exec swc src -d /tmp/mangmee-postmark-api-build --strip-leading-paths --copy-files -q`. Contracts build with corepack pnpm filter. Cohort command: `BILLING_SALES_COHORT_ONLY=1 BILLING_BROWSER_E2E=1 node /tmp/mangmee-run-billing-smoke.mjs` (73PASS); optional BILLING_CONFIG_ONLY=1 runs cohort without paid prefix. Wrapper output goes to `/tmp/mangmee-billing-http-smoke.log`; copy after each run.

## Remaining implementation

- C03 aged UNKNOWN/provider-mutation recovery and compensation; historical financial exceptions beyond record-only import.
- C02 global SLA/escalation policy; C05/C06 scheduled policy publication, detailed capacity rollouts and remaining runtime configuration/readiness. Explicit company sales cohort is now implemented locally.
- C07 configuration/settlement drift, bounded bulk recovery and financial resolution. Daily event schedule and historical invoice discovery/import are already implemented; do not relist them as missing.
- C08 debt/refund/temporary override/revoke/expiry/compensation/export/privileged documents with approved boundaries and independent approval.
- Postmark monitoring/retention/EM09 and remaining mail recovery. Preserve owner decisions below.
- Complete LINE intake/draft/live capture/AP21–24 and rich-menu/webhook/Login/LIFF configuration matrix with actual permission-checked ERP tools; parked login/self-link flows remain closed.
- Full current CI/acceptance/review, then authorized develop/main merges in BOTH repos. NO DEPLOY.

## Open questions / parked paths

Owner has not answered the earlier verified-email Postmark password-recovery question. Existing spec parks RequestPasswordReset/ConfirmPasswordReset; forgot-password uses LINE. Keep email reset closed and continue independent work. `/companies/:id/settings/security` stays disabled/redirects to dashboard; already-linked sidebar self-relink stays disabled. Repair through Admin PartnerDetail IssueLINEQR/Unlink. Public POST/auth/line/exchange remains403 and OAuth callback stays on its existing feature flag.

Owner's Stripe screenshot was already answered: read-only Developer Chrome LIVE account showed no active tasks and Payments/Payouts/PromptPay ACTIVE, zero live balance; overdue verification/payout warning was on separate Sandbox with simulated balances. No document upload, native config change or payment. Future testing must explicitly select Sandbox/test credentials. This does not certify the integration/deployment.

## Artifacts

- Canonical controls spec/plan: `docs/specs/mangmee-billing-controls-spec-th.md`, `docs/plans/mangmee-billing-controls-plan-th.md`; package/payment/Postmark/LINE specs remain authoritative.
- Evidence directory `docs/evidence/billing-integration-2026-09-13/`, README + result JSON/source hashes/mobile screenshots.
- Detailed preceding notes preserved in [history](stripe-postmark-implementation-history-through-2026-09-14.md); current status above supersedes historical pending/next paragraphs.

Next C08 research gathered from official Stripe refund/create/list/object and credit-note docs: `docs/research/stripe-refund-recovery-api-notes-2026-09-14.md`. Refund banking status and credit-note invoice adjustment need distinct observations; issuing a native credit note can create or link refunds, so do not design duplicate independent retries. No C08 spec/plan/code decision made yet; thresholds/manual eligibility remain unchanged.
