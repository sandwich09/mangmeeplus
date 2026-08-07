# MVP1 P0 Fix — Codex Handoff Harness (2026-07-12)

Executor: Codex CLI `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s workspace-write`. Claude reviews each phase (diff-vs-intent + ponytail + boundary), runs real gates, commits explicit paths after PASS (never `git add -A`). Codex never commits. Source findings: `docs/agent-memory/mvp1-finish-line-review.md` (P0 section, all evidence file:line verified by both engines 2026-07-12).

Hard rules for every phase:
- NO new dependency, NO new migration, NO prisma/db command against any DB (shared docker :15432 must never be migrated). Tests run with invalid `DATABASE_URL=postgresql://x:x@127.0.0.1:1/x`.
- EXTEND existing registered spec files — do NOT create new spec files (apps/api test registry is hand-maintained in apps/api/package.json; keep it unchanged).
- Tests must drive the REAL production path (mock only I/O boundaries). Ponytail: shortest correct diff, reuse existing helpers/patterns.
- If codex sandbox hits tsx IPC EPERM: fallback `node --import tsx --test <files>` (documented, expected).

## F1 — Autonomous booking must book the catalog duration
Bug: `resolveRequestedBookingWindow` builds the booked window from `extract.durationMinutes ?? 60` (`crm-auto-reply.logic.ts:~108`) while the gateway prompt forbids the model deciding duration; catalog `service.bookingDurationMinutes` (`crm-ai-auto-reply.use-case.ts:~173`) is used only for slot proposals → every autonomous booking is a 60-min row; 90/120/180-min services double-book in the tail.
Fix: in `CrmAiAutoReplyUseCase.evaluateBooking`, resolve the published service BEFORE resolving the window; make the window duration = `service.bookingDurationMinutes ?? 60` (catalog authoritative; change `resolveRequestedBookingWindow` to take an explicit durationMinutes param; stop trusting `extract.durationMinutes` for the window). Keep all gates/order semantics otherwise identical; contract field may stay (additive, now unused).
Tests (extend existing P4b/auto-reply specs): 120-min service requested 18:00 → booking endAt 20:00; tail-overlap now detected by isSlotFree (book → propose); proposals still use catalog duration; 60-min service unchanged.
Verify: focused specs + api typecheck.
Files: apps/api/src/modules/crm-inbox/domain/logic/crm-auto-reply.logic.ts (+spec), apps/api/src/modules/crm-inbox/application/use-cases/crm-ai-auto-reply.use-case.ts (+spec).

## F2 — Remove fabricated data from /crm-reports
Bug: funnel multiplies chats by 62%/40% and values at fixed ฿2,650; hardcoded "71% campaign" AI insight; broadcast CTA links to a route that 404s (`CrmReportsPrototypePage.tsx:~50-59,~170`).
Fix: delete the fabricated funnel numbers, fake insight and dead CTA. Keep/replace ONLY with numbers already real on that page (summary KPIs, daily-brief cards: open deals value, quotations awaiting, overdue payments, complaints, avg first response, topCustomers LTV). No new endpoints. CSV export must no longer emit fabricated rows.
Verify: web typecheck; page renders with real-only cards (Claude verifies in browser).
Files: apps/web/src/features/crm/CrmReportsPrototypePage.tsx only.

## F3 — Retention metrics from real payment facts
Bug: retention widgets average stored `crmCustomer.lifetimeValueAmount` which NO production code writes (`prisma-crm-inbox.repository.ts:~349`) → ฿0 for real companies; tier/leadScore proxies for returning/at-risk have no factual basis.
Fix: compute retention from the SAME received-payments counterparty bridge used by topCustomers (`crm-reports-summary.use-case.ts:~41`): avgLtv = mean of per-customer received-payment sums (paying customers); returning = customers with ≥2 receipt payments; new = <2; atRisk = last payment older than 90d (name the top one as today). Pure logic in `crm-reports.logic.ts`, data via existing repo bridge (extend the existing bridge query minimally if needed — no schema change). Response shape stays `CrmReportsRetention` (field meanings honest; adjust labels in web if wording changes).
Tests: extend existing crm-reports logic/use-case specs with a payments fixture proving avgLtv/new/returning/atRisk derive from payments, not tier/leadScore/lifetimeValueAmount.
Verify: focused specs + api typecheck + full api suite.
Files: apps/api/src/modules/crm-inbox/domain/logic/crm-reports.logic.ts (+spec), application/use-cases/crm-reports-summary.use-case.ts (+spec), infrastructure/prisma-crm-inbox.repository.ts. packages/contracts only if strictly additive.

## F4 — Reimbursement receipt evidence: real validation + usable UI
Bug A (api): receipt gate is truthiness-only — any non-empty `primaryAttachmentId`/`linkedExpenseId` string passes at create AND submit (`reimbursement-request.use-case.ts:~45,~181`); no existence/tenant/ownership check (schema stores raw strings, no FK).
Bug B (web): requester UI asks for a raw attachmentId string; no upload, no expense picker; `updateReimbursementDraft` (`reimbursements.api.ts:25`) has zero call sites → the receipt-backed journey is uncompletable and simultaneously fakeable (`ReimbursementsPages.tsx:~69,~117`).
Fix A: on create, draft-update and submit: if `primaryAttachmentId` set → must resolve to an existing completed AttachmentObject in ctx.companyId (reuse the attachments module read path); if `linkedExpenseId` set → must be an existing expense in ctx.companyId (reuse expenses repo read). Reject otherwise (400/422 with existing error style). Keep policy semantics unchanged.
Fix B: replace the raw-id input with the SAME upload flow expenses uses (presigned PUT + complete → returns attachmentId) OR a picker over the requester's own expenses (`listExpenses` scoped) — prefer reuse, no new backend routes if the existing attachment endpoints suffice; wire `updateReimbursementDraft` so a draft can attach evidence before submit; show attached file name + change/remove.
Tests: extend existing reimbursement specs — spoofed/nonexistent/cross-company attachment & expense ids rejected at create+submit; happy path with real (mock-repo) attachment passes.
Verify: focused specs + api & web typecheck + full api suite; Claude drives the UI journey in browser.
Files: apps/api/src/modules/reimbursements/** (use-cases + repository read helpers), apps/web/src/features/reimbursements/** . Reuse apps/api attachments/expenses read paths — do not fork upload logic.

## F5 — e2e bookings helper: canonical customerId
Bug: helper posts `customerName` but `CreateCrmBookingInput` now requires `customerId` (`e2e/bookings.spec.ts:~57`) → BOOK-03..06 fail before exercising lifecycle.
Fix: helper creates (or fetches) a CRM customer via the existing customers API, passes `customerId`; update types/assertions; keep test intent identical.
Verify: Claude runs the live e2e bookings spec on the local rig (native :5432 DB) after the phase.
Files: e2e/bookings.spec.ts (+ any e2e helper file it imports).

## Sequencing
(ADJUDICATED after Codex pre-flight 2026-07-12): `{F1 ∥ F4 ∥ F5} → F2 → F3 → joint close-out review`. package.json untouched by all phases.
Claude gate per phase: diff read, focused tests, typecheck(s), full api suite (fast), business review vs this doc, then commit explicit paths. Joint close-out: Codex reviews the full combined diff (read-only) + Claude cross-checks before final push.

## Pre-flight adjudication (Codex proposals ACCEPTED 2026-07-12)
- F1: extend `process-inbound-line-message.use-case.spec.ts` (real orchestration tests live there; fixture at ~:316-340 hardcodes 60/60 — add catalog-120/extract-60 case) + `crm-auto-reply.logic.spec.ts`. Keep gateway/contract `durationMinutes` (ignored by ERP window).
- F2: delete MORE than minimum — whole funnel block (~:50-82,152,293-337) AND the whole "AI สรุปให้วันนี้" insight block (~:164-171; follow-up/closing-chance rows are also unsupported); factual salesOps cards already cover real values. CSV has no funnel coupling. F2 acceptance provisional until F3 fixes retention honesty.
- F3: extend `sum-received-payments-by-counterparty` bridge + `prisma-accounting.repository.ts` groupBy to return `_sum.amount, _count._all, _max.paidAt` in ONE query; DELETE `reportsRetentionCustomers` + its call. Definitions: universe = scoped active customers with ≥1 RECORDED RECEIVED payment; avgLtv = mean per-paying-customer sum (decimal.js); returning ≥2 payments; new = 1; repeatRatePct = returning/paying; atRisk = latest paidAt older than now-90d; churnRatePct = atRisk/paying; atRiskName = stalest latest-payment (tie: larger LTV, then name). Pass `now` into pure logic. `ponytail:` note re counterparty link not unique (dup attribution ceiling). Update web labels accordingly.
- F4: use GENERIC attachments endpoints (data-model-core `attachment.controller.ts`: upload-intent → PUT → complete), NOT the expense upload (creates phantom expense drafts — REFUSED). Export attachment read path from DataModelCoreModule (or additive read use-case); import ExpensesModule (repo already exported) for linked-expense validation. Additive `primaryAttachmentFileName` on reimbursement detail contract for display. Validation at create+update+submit: attachment ACTIVE + same company + uploadedByUserId===requester; expense same company + createdByUserId===requester; validate every supplied id. Tests → extend registered `reimbursement-approval.use-case.spec.ts`.
- F5: helper FETCHES an existing customer (`GET .../crm/customers?pageSize=1`) instead of creating; keep customerName in the Booking type (UI locates by display snapshot).
