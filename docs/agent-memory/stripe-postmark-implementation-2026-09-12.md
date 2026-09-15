# Agent Memory: Stripe + Postmark implementation
Paid Admin receipt increment2026-09-15: existing operations now support reason/expiry/current-source preview, current password and independent approval, atomic additional ADMIN_ADJUSTMENT grant/revoke/audit, source/actor/history and permanent Thai mobile pages. Admin units keep their own expiry across repeat/grace/renewal; consumed and purchased records, package dates/collection and fiscal documents are preserved. Read/review warns about current AI-off/read-limit/budget restrictions. Real local HTTP/PG/Next/Chromium9 groups and paid receipt/grace/upgrade22 tests PASS; counts overlap earlier coverage. API/web typechecks and contracts/SWC PASS. Source-bound `admin-receipt-adjustments-result.json` covers20 files and two inspected mobile captures. The additive kind-check migration was applied only to the dedicated local fixture database. This closes the active paid receipt slice only: manual/trial additive units, package/day overrides and remaining full acceptance remain open. No CI/push/merge/deploy or native message/payment.

Next: preserve other Postmark/config/signup/cloud changes; implement remaining package/day/manual adjustments against current P29/C08. Paid direct plan-term edits still lack reviewed source coordination and may cause paid invoice HELD via termProjectionHash; do not lock all paid controls as the fix. Pending Owner question: Admin free days shift collection or keep date. Paid temporary package overrides must derive current baseline at expiry and keep early repurchase/renewal/revoke paths open; do not silently change customer recurring-price consent. Full combined regression and final green-CI merges remain open.


Admin AI/OCR follow-up2026-09-15: required reason, current-value conflict/replay handling, company-scoped safe25-row AuditLog history and Thai confirm/reload/mobile UI implemented. Admission and Admin settings bypass stale budget caches; settings invalidation preserves active leases, platform ceiling validation/audit serialize with current writes. Actual local HTTP/Next/PostgreSQL/Chromium10 groups PASS including response loss/replay, concurrent edits, page navigation and current raised/lowered shared AI admission; focused133PASS/0skip including real PG, API/web typechecks PASS. Counts overlap earlier runs. Source-bound `admin-ai-adjustments-result.json` covers21 source/test files and a visually inspected390px capture. Paid term/receipt grants remain unchanged; this closes the AI/OCR slice only. Paid/manual package/extra-day/receipt adjustments and remaining C08/full acceptance are open. No intermediate CI/push/merge/deploy.

Next: paid/manual Admin receipt and package/term adjustments via reviewed operations. Collection-date effect for Admin free days still awaits the previously asked Owner reply. Preserve concurrent Postmark/config/signup/cloud/deployment edits. Current local-only branches; no remote CI.

Current checkpoint 2026-09-15: C05 committed locally as `63b8910c` (core) and `a711bb5` (isolated marketing); source-bound offer evidence records247 combined groups and12 offer groups, overlapping counts. No push/CI/merge/deploy. Owner clarified Admin must change packages/renew/add receipts/raise or lower AI quota for paid customers with source/actor/reason/before/after history. The draft blanket paid-term guard was withdrawn before testing/commit; no UI restriction implemented. P29/controls spec+plan now require audited adjustments, not closing paid controls. Asked whether Admin-added free days shift Stripe collection date; pending, other audit work can continue. Implementation/verification for this follow-up remain open. Preserve Postmark monitoring preparation and other tasks. Historical text below is not the current completion estimate.

Admin AI/OCR audit foundation: writes now retain target company and server-derived ADMIN_ADJUSTMENT/SYSTEM_PARTNER_ADMIN source with the existing actor/request/time/before/after audit. AI and OCR share configuration→Company lock order; AI rereads the current company/configuration inside the transaction so concurrent edits cannot record an obsolete predecessor or save across a company hold. Focused26 PASS/0skip including real local PostgreSQL concurrent AI/OCR checks; API typecheck and both diff checks PASS. Source-bound [receipt](../evidence/billing-integration-2026-09-13/admin-adjustment-audit-result.json). This is backend audit groundwork only: mandatory reason entry, complete history UI, paid adjustment operations and effective web/LINE/AI E2E remain to implement. No provider/CI/deploy action. Next: incorporate Owner's collection-date reply, implement reviewed adjustment contracts and original-company Admin/history flows; preserve Postmark WIP and unrelated concurrent signup/cloud edits.

Status: IN PROGRESS — Postmark local transport/PG/HTTP checks pass; Owner approved prorated upgrades/end-of-term downgrades/annual allowance upfront and full-package repeat purchases. Receipt-only add-on is HIDDEN / sales closed by latest Owner instruction. Full implementation, browser/Stripe E2E and merges incomplete. No deployment authorized.
Owner: Root.
Scope: Implement the existing Stripe, package, web/LINE billing, admin control and Postmark specs/plans; verify local simulated end-to-end flows and available provider sandbox contracts; merge develop and main after CI passes. Never deploy or transact live charges.

Decisions:
- User authorized Chrome Developer profile access for existing Stripe and Postmark accounts, code implementation, and merge to develop/main. Prior authorization permits admin merge only after CI passes.
- Start from origin/develop `2a789aa6`; origin/main `00cbaa8b` contains the same product baseline. Original workspace was clean.
- Branch: `codex/stripe-postmark-implementation-20260912`.
- Follow ponytail full, existing Nest/Prisma/outbox/auth/BFF patterns. No package.json edits except dependencies; no new service or broker.
- Preserve FREE_TRIAL_15 and seven default menus, catalog prices and Enterprise/tax Coming soon locks. Monthly reset is existing behavior only; paid quota must follow the approved 2026-09-13 amendment.
- Unapproved business policies remain draft and cannot enable live collection. Synthetic fixtures are explicitly test-only.
- Owner subsequently approved immediate conversion/no carry-over trial days; VAT currently OFF, admin toggle required without deployment. Owner approved 7-day renewal grace with prior package rights, suspend and cancel Stripe at grace expiry, period-end cancellation and manual refund/dispute/debt review.
- Owner approved: immediate prorated upgrade retaining period end; downgrade at paid monthly/annual end; annual Starter360/Basic600/Pro1200 upfront. Current approved repurchase is a full package; Owner subsequently considered receipt-only, then explicitly selected HIDDEN / sales closed. Owner approved adding full quota now and appending one purchased interval to old paid expiry, e.g.8months+year=20months. Preserve remaining quota; next charge must move accordingly.

- Existing Postmark domain/account approved; server 20896570/outbound. Stripe browser currently shows sandbox mode. No credentials copied into documentation/logs.

Open questions:
- No open question on same-package repurchase: Owner confirmed quota now and8months+12months=20months. Technical Stripe scheduling/extended-time upgrade and E2E proof remain to implement. Receipt-only is HIDDEN / sales closed; no live SKU/price/activation approved.
- Mid-period month/year interval switch remains disabled until anchor/credit policy is defined; initial sales and ordinary renewal do not depend on it.
- VAT current OFF is approved. Inclusive/exclusive choice when later enabled must be explicit in Admin preview; do not invent company VAT registration evidence.

Artifacts:
- [Owner pack amendment](../specs/mangmee-billing-pack-amendment-2026-09-12.md) referenced by 5 billing specs and 4 plans; governs latest approved upgrade/downgrade/upfront allowance choices and configuration publication prerequisites.
- [Postmark local evidence](../evidence/postmark-email-2026-09-12/README.md), sanitized receipts and 30 source hashes.
- [Stripe plan](../plans/mangmee-stripe-billing-implementation-and-test-plan-th.md)
- [Owned integration spec](../specs/mangmee-owned-billing-integration-spec-th.md)
- [Admin controls](../specs/mangmee-billing-controls-spec-th.md)
- [Package spec](../specs/mangmee-package-entitlements-spec-th.md)
- [Postmark spec](../specs/mangmee-transactional-email-provider-spec-th.md)

Verification:
- Baseline git status clean, fetched both branches; prior access repairs now present in current baseline.
- Final focused tests: **146 PASS / 0 fail / 0 skip** (`/tmp/stripe-postmark-mail-focused-latest.tap`), including legacy auth/SES/claim/workflow regressions. Actual PG: **10 node tests PASS** (9 scenarios + wrapper, `/tmp/mangmee-postmark-pg-final.log`). These supersede earlier 76/7 and 130/10 counts; do not add the runs together.
- Full AppModule compiled with SWC and selected Postmark: **7 HTTP groups PASS** (`/tmp/mangmee-postmark-http-smoke-final.log`); real local PostgreSQL, provider fetch denied. Verified authentication, malformed/oversize/variant-path handling, sanitized durable callback, dedupe and 503 persistence failure. This is not browser/inbox/paid E2E.
- Actual provider `POSTMARK_API_TEST` request: HTTP 200, ErrorCode 0, valid MessageID/SubmittedAt; **no external email delivery**. Receipt copied to evidence; not server-token/domain/inbox proof.
- Contracts/config builds, API typecheck and SWC build PASS. API suite wiring 3 PASS; owned acceptance catalog 4 PASS. CI YAML parsed using Ruby standard YAML (Node had no installed YAML parser). New provider contract registered in owned runner; CI step provisions dedicated watchdog_postmark_ci then runs PG and compiled HTTP smoke. GitHub CI itself has not run.
- Initial focused invocation lacked API tsconfig decorators and failed to load 4 files; corrected runner uses apps/api cwd and `--tsconfig tsconfig.json`. Next run caught two dedicated-outbox inventory expectations; inventories updated to include the new handler, no assertion weakened.
- Additive migrations through `20260912150200_email_dispatch_fence` applied to **dedicated localhost database mangmee_billing_20260912** on port 15432. Existing watchdog_bms database unchanged. Credential-bearing env stored mode 0600 at /tmp/mangmee-billing-local.env, not in repo/evidence. Fixtures remove their own rows; no running server is left by the HTTP smoke.
- Fixes: per-attempt dispatch CAS; durable expired/suppressed preflight; intent binding; jitter/backoff/possible-duplicate generations; strict bounded metadata lookup; serialized callback binding; parser error redaction and 256 KiB case/slash coverage; legacy SES current-attempt guard + atomic audit; provider rollback cannot auto-failover a Postmark-owned claim.
- M2 remains partial: operator recovery/metrics/retention/legacy migration and full browser signup/recovery coverage are not accepted. Current provider-pinned claims require explicit recovery design during rollback; do not silently reset a pointer or send through SES.
- Full new billing/worker/UI/E2E remains incomplete; Stripe client/services/reconciler/schema are unbound WIP drafted for the old subscription model. Revise for 2026-09-13 decisions, including old monthly usage assumptions; do not wire or merge as final merely because typecheck passes.
- Marketing work is isolated at `/Users/thawatchai/Project/MangmeeYungYuen/mangmee_web-stripe-postmark-20260912`, same branch name, based on origin/develop `93bf03c`. Only spec/plan/memory amended there. Original mangmee_web dirty README/index/docs preserved. No new marketing runtime/E2E pass claimed.
- No live email, charge, provider setting change, application deployment, commit, push or merge in this implementation yet.

Next:
1. Complete current contracts/schema/entry-point discovery and provider documentation check.
2. Add durable Postmark send/callback integration and tests preserving SES/disabled behavior.
3. Add billing contracts/schema/provider/reconciliation/atomic entitlement apply with strict account/mode/tenant bindings.
4. Wire customer/admin UI, web/LINE entry/recovery and shared catalog; close access/permission gaps.
5. Run real local database/API/browser and fault-injection coverage, plus available provider sandbox checks; record case-level limitations honestly.
6. Review scoped diff/security/workflow triggers, run CI, merge develop/main without deployment, report exact receipts.

Progress 2026-09-13: canonical amendment, package spec/plan Q01–Q10, P26 and isolated marketing alignment updated to annual upfront allowance. This is documentation progress, not an E2E PASS. Paid receipt grant implementation and checks are next.

Correction 2026-09-13: assistant initially misread “ซื้อเพิ่ม” as receipt-only top-up; Owner explicitly rejected it. Removed that proposed SKU/config from both specs/plans before runtime implementation. Annual whole-cycle units and approved upgrade/downgrade decisions remain.

Owner reply received: same full-package repurchase adds quota immediately and extends from prior paid expiry. Specs/plan mirrors updated; test annual expiry/multiple prepurchases and no early renewal double charge. Stripe docs show trial/schedule constraints; old single subscription-line parser is not acceptance for this flow.

Latest steering: Owner is now considering receipt-only purchase as an additional option. Recorded a clearly DRAFT proposal (no membership extension; suggested expiry at existing paid end), no commercial approval/price/activation assumed. Full-package repurchase approval remains unchanged.

Implementation slice 2026-09-13:
- Shared catalog now exposes paid-period allowance (annual×12), approved policy defaults and explicit quota cadence. Added full-package purchase impact/anniversary/prorated-unit helpers, including future prepaid segments; no receipt-only runtime sale.
- Additive migration `20260913100000_billing_receipt_grants`: paid account provenance on term, source-deduped grants, OCR event→grant compound company FK. Applied only to dedicated local database. Diff generation exposed unrelated baseline drift (DocumentDeliveryLink/remoterelease defaults/FK/index); explicitly removed it before applying. No unrelated drops or cloud migrations.
- Central OCR admission shares paid units across web/LINE, earliest-expiring grant, mandatory paid enforcement, exact compensation/retry binding, inactive/held guard. Legacy/trial monthly shadow/enforcement unchanged; bank statements remain operational-only. Billing status and quota refusal text distinguish paid grants from monthly quota.
- Existing unbound base-invoice apply now grants annual units atomically. Replay/hash/tenant constraints and OCR-vs-apply lock ordering fixed; full-package repeat internal apply carries active remaining units and records immediate availability separately from future service. This internal seam does not validate provider payment by itself and is not a public API.
- Remaining critical work: provider-backed early full-package purchase/collection rescheduling, all-prepaid-time monetary upgrade calculation, scheduled downgrade/caps, grace access and unused quota eligibility at paid-through, refund/dispute/holds, controllers/workers/BFF/Admin/customer UI/LINE recovery, real browser and Stripe sandbox/native acceptance. BillingModule still unbound; no enablement or merges.

Verification 2026-09-13 final for this slice:
- [Paid package evidence](../evidence/billing-package-2026-09-13/README.md): new PostgreSQL8PASS; legacy OCR65PASS/0skip; focused combined340PASS/2optionalPGskips subsequently exercised by legacy run; package+suite inventory8PASS; runner catalog4PASS. Counts overlap; do not sum.
- Contracts/API typecheck/SWC/CI YAML and both-worktree diff whitespace checks PASS. CI registration includes new PG suite; actual GitHubCI, browser/Stripe E2E and merges NOT RUN.
- Typecheck initially preceded grant lock/projection refinements, then rerun passed; final PG8 run includes apply-vs-OCR/rollback regression. Initial YAML parser call used an unsupported Ruby keyword and initial catalog path had a typo; corrected invocations both passed. No dependencies/package.json changes.

Latest Owner instruction: receipt-only purchase must remain HIDDEN and not shown. Updated shared spec/plan and marketing mirror; no customer/LINE/AI/Admin purchase offer, no provider call on forged direct purchase. This deferred option does not block full-package implementation. Owner asked whether all code is complete: answer NO; billing API/module/worker/UI/Stripe full-package rescheduling and full E2E remain incomplete, with no CI/merge/deploy.

Status audit requested by Owner: [current implementation coverage](stripe-postmark-implementation-status-2026-09-13.md). HIDDEN catalog/direct-request regression6PASS/0skip; prior16runtime hashes unchanged, only test expanded. Actual billing module/controllers and billingUI still absent; full implementation/CI/merges not complete.

Hidden-offer status audit verification complete: API typecheck and both worktree diff checks PASS. No application runtime/provider/CI/deployment action was performed in this status audit.


## 2026-09-13 implementation continuation — initial payment browser loop

Status: IN PROGRESS. Owner authorized implementation, CI-qualified develop/main merges and no deploy. No deployment/provider account changes/real charges/messages/commits/push/CI/merges performed in this continuation.

Implemented:
- BillingModule in AppModule, public catalog, protected owner quote/checkout/status/attempt/resume/refresh/history/portal/documents; exact signed callback and worker-token drain/scan; Redis command throttling, strict request field allowlists. Reused PartnerLifecycleTransitionUseCase export and existing BullMQ scan workers.
- Callback remains receivable when customer platform is closed; exact billing recovery routes preserve session/legal/tenant/owner barriers. Lease row locks/CAS, fair due scanning, final pre-payment term/company/owner barrier, ambiguous outcome retention, failed-renewal status precedence and strict provider document binding.
- Actual Next billing/return UI, consent/prices/VAT/annual allowance, mobile status/history/documents and recovery/support paths. Billing bypasses business-shell background queries AFTER the existing server auth/password/legal/company gates. This fixes an actual browser expiry redirect loop. No receipt-only sales offer; Enterprise remains disabled Coming soon.
- Existing LINE package/rich-menu message command now opens selected active OWNER billing review when billing configured; existing handoff seam binds the link. Expiry-only target resolution preserves billing/return, still refuses admin holds and arbitrary business paths. No LINE message was actually sent.

Evidence: docs/evidence/billing-integration-2026-09-13/README.md, source-receipt.json, actual browser desktop/mobile images. Actual compiled AppModule + PostgreSQL + Next + Chromium10 groups PASS (only Stripe simulated); API/worker/provider routes were not mocked. 64 focused PASS, LINE entry/handoff40PASS, existingLINE/Postmark/signup331PASS; Postmark fullHTTP7PASS. Contracts/API/web/workers compile/typecheck PASS. GitHub CI now names the compiled non-browser billing HTTP script, not run on GitHub yet. Hidden-only baseline and quota PG evidence remain separate and valid; never sum overlapping counts into unique flows.

Local harness: /tmp/mangmee-run-billing-smoke.mjs reads existing mode0600 /tmp/mangmee-billing-local.env + root .env without printing secrets; validates local15432 dedicatedDB. Runs /tmp/mangmee-postmark-api-build/scripts/billing-http-smoke.js with NODE_PATH root/api deps. BILLING_BROWSER_E2E=1 starts disposable local Next/Chromium and closes both. Synthetic immutable legal acceptance rows remain in disposableDB; other rows cleaned. First browser fixture missed cookieParser (fixed to match main); then exposed real shell redirect (fixed). Next dev autogenerated AGENTS.md/CLAUDE.md and next-env imports were removed/restored to pre-run state after final run. No unrelated files restored.

Remaining: full-package repeat charge and collection rescheduling, all stacked time upgrade amounts, downgrade/overcap/grace/cancel/debt/refund/dispute/override commands and scheduler; Admin C01–C08 permissions/preview/approval/config/policy/gates/audit; billing notification consumer (billing.invoice.applied is deliberately excluded from generic workflow drain); complete Postmark M2; marketing runtime/catalog consumer in siblingworktree; all acceptance/browser/native/provider sandbox; full CI and both branch/repo merges. Do not state implementation complete or merge this incomplete feature based on these focused checks.

Provider design investigation (not implemented/approved proof): schedule a consolidated prepaid phase followed by normal paid renewal might avoid trial_end's two-year limit and per-purchase phase explosion. Must prove on Stripe sandbox including original paid invoice binding, no prorations/zero invoice grants, all remaining paid segments, mixed intervals and renewal race BEFORE selecting that collection design. Current repeat quote still rejects existing subscription; internal grant helper alone is not a real repurchase flow.
