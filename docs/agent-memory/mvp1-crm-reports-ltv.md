# Agent Memory: MVP1 — CRM Reports Summary + real LTV (revenue→LTV flow)

Status: DONE 2026-07-09 — all 4 phases (A contracts+builder, B endpoint+LTV aggregation, C web wire-up, D counterparty auto-link) implemented, reviewed, tested (api 1215 pass/0, web 233/0), browser-verified, and committed to `develop`. Continues the wire-up track: [[agent-memory/mvp1-a1-web-wireup]] closed inbox/customers/AI-panel; `/crm-reports` was banner-only there (no backend). This build gave it a real backend + closed the LTV gap + wove the revenue→LTV flow.
Owner: Dev A lane (crm-inbox reports API + `features/crm/*` web) — single harness run under owner instruction "เต็มละเอียด, รวม LTV, ปิด gap, ร้อยเรียง flow, harness เหมือนเดิม".
Executor: Codex CLI under harness (Codex codes per phase brief; Claude reviews/tests/directs; owner/harness commits — Codex never commits).

Scope: [[plans/mvp1-crm-reports-ltv-plan]] — Phase A contracts+pure builder, Phase B endpoint+LTV aggregation, Phase C web wire-up, Phase D counterparty back-link. Realizes Flow-A screen #6 / plan Phase 6 item 3 + spec §12 (new).

## The gap this closes (ground truth, 2026-07-09 discovery)

- `CrmCustomer.lifetimeValueAmount Decimal? @db.Decimal(18,4)` (`schema.prisma:3961`) is **dormant** — nothing in `apps/`/`packages/` reads or writes it; only the DDL that created it exists.
- Revenue lives in item-08 `AccountingDocument` (`paidAmount`, `documentType` INVOICE/RECEIPT/TAX_INVOICE, `status`/`paymentStatus`) + `AccountingPayment` (direction RECEIVED). Write paths are **real and wired** (`prisma-accounting.repository.ts` create/allocate/recompute).
- These link to `AccountingCounterparty`, **not** directly to `CrmCustomer`. The only bridge is `CrmCustomer.accountingCounterpartyId` (`:3926`, nullable scalar, no Prisma relation, indexed `:3982`) — set **only** when a caller passes it (`crm-customer.use-case.ts:79/:128`); nothing auto-links it, so it is usually null and every join yields 0.
- Two specs conflicted: item-15 (`crm-line-oa-customer-os-spec.md:244,408`) calls LTV a "derived read model"; Flow-A §8 D10 proposed a stored `lifetimeValueAmount @default(0)` fed by a new `CrmCustomerPurchase` table. Neither gave a formula. **Resolved** (spec §12): reuse accounting via the counterparty bridge; do not build `CrmCustomerPurchase`.
- Bill-capture/slip = the **expense** loop (money out, `ExpenseRecord`, vendor counterparty) — irrelevant to customer LTV.

## Key decisions (see plan D1-D10 + spec §12)

- LTV = Σ `AccountingPayment.amount` (direction=RECEIVED, status=RECORDED) for the customer's counterparty — **payments, not document `paidAmount`**, to avoid double-counting a sale that spans INVOICE+RECEIPT (discovery: void does NOT zero `paidAmount` and can leave `paymentStatus=PAID`); null counterparty ⇒ 0; on-demand (no cache job); decimal-safe string. Refund/credit-note netting = future.
- Reuse accounting through its use-case (mirror `crm-customer-360` financeBlock injecting `ListDocumentsUseCase`) — CRM never touches the accounting repo directly.
- Branch scope via conversation → `CrmCustomer.branchId` join (`CrmConversation` has no branchId); `branchId` intersected server-side.
- Overdue reuses `overdueWhere(now)`; avgResponseMin = conversation-level `firstRespondedAt − createdAt`; SPAM excluded everywhere.
- Tier derived from real LTV (`≥50k vip · >0 active · 0 lead`) — placeholder until D10 `tier` field; owner-adjustable threshold.
- Endpoint mirrors `crm-customer-360` layering; new specs MUST be appended to `apps/api/package.json` test list ([[memory: api-test-explicit-spec-list]]).
- No `schema.prisma`/migration change in any phase.

## Pattern to mirror (from discovery)

- Controller/use-case/repo/logic layering + cross-module accounting read: `crm-customer-360.{controller,use-case}.ts` (use-case `financeBlock` at :132-137 injects `ListDocumentsUseCase`).
- Reusable repo aggregates: `conversationCounts()` groupBy (`prisma-crm-inbox.repository.ts:209-232`); `overdueWhere(now)` (`:143-150`).
- Contracts: add beside `CrmCustomer360Summary` in `packages/contracts/src/crm-inbox.ts`, reuse `CrmConversationStatus`.
- Prototype page (4 blocks + mock aggregators to delete): `apps/web/src/features/crm/CrmReportsPrototypePage.tsx` + `crm-reports-prototype.model.ts` (`getReportKpis`/`getStatusBreakdown`/`getTopCustomers`/`getStaffPerformance`, hardcoded `'8 นาที'`).

## Verification / acceptance

- "report numbers reproduce a hand-computed fixture" → Phase A pure `crm-reports.logic.spec.ts` + Phase B use-case spec.
- "KPIs change when branchId changes" → Phase B test + Phase C browser toggle.
- top-5 LTV real → seed a counterparty-linked customer with a paid AccountingDocument (+partial+VOIDED) for the browser pass; Phase D proves auto-accumulation.

Open questions: none blocking. (Owner may adjust the VIP LTV threshold; may opt for `paymentStatus=PAID`-only instead of realized paidAmount — default is realized.)

Artifacts:
- Spec: [[specs/mangmee-flow-a-be-integration-spec]] §12; consumers [[specs/crm-line-oa-customer-os-spec]] §401-410.
- Plan: [[plans/mvp1-crm-reports-ltv-plan]]; parent [[plans/mangmee-flow-a-be-integration-plan]] Phase 6 item 3.
- Prior track: [[agent-memory/mvp1-a1-web-wireup]].

## Evidence — Phases A/B/C DONE + committed on develop (2026-07-09)

Commits: `55748281` docs, `72536b58` Phase A, `4e0a081c` docs LTV-source correction, `c1017733` Phase B, Phase C (this pass). Harness: Codex coded per brief; Claude reviewed diffs + tested + owner-harness committed; Codex never committed.

- **Phase A** (`72536b58`): additive `CrmReportsSummary*` contracts (reuse `CrmConversationStatus`); pure `buildCrmReportsSummary` + decimal-safe `deriveTier` in `crm-reports.logic.ts` (no Prisma/Nest); hand-computed unit fixture. Registered in `apps/api/package.json` list. 3/3 pass.
- **LTV-source correction** (`4e0a081c`): discovery showed voiding a doc does NOT zero `paidAmount` (and can leave `paymentStatus=PAID`), and a sale spans INVOICE+RECEIPT → document sums double-count. Switched to Σ `AccountingPayment.amount` (direction=RECEIVED, status=RECORDED) per counterparty — recorded once. Confirmed enums: `AccountingPaymentDirection` RECEIVED|PAID; `AccountingPaymentRecordStatus` DRAFT|RECORDED|VOIDED.
- **Phase B** (`c1017733`): new accounting `SumReceivedPaymentsByCounterpartyUseCase` (company-scoped groupBy `_sum amount`; provider+export). crm-inbox repo aggregates reuse `overdueWhere`, exclude SPAM, response-time = `firstRespondedAt-createdAt`, staff two-groupBy merge + `userDisplayNames`. `GetCrmReportsSummaryUseCase` orchestrates + branch-ABAC via the established `ctx.scopes.branchIds` (rejects out-of-scope; restricts callers to their branches' customers). `GET companies/:companyId/crm/reports/summary` gated `crm.report.read`, mirrors crm-customer-360. **Full api suite 1211 pass / 0 fail** (2 accounting + 6 reports specs). Global prefix is `v1` (raw API), `/api/v1` is only the web BFF proxy prefix.
- **Phase C**: `getCrmReportsSummary` client; `CrmReportsPrototypePage` renders 4 real blocks with loading/error/ForbiddenState/empty states + real branch-filter refetch (`useBranchFilter`) + decimal-safe `formatLifetimeValueAmount` (regex, no float). Route page gets `fetchServerSession`. Dropped banner + mock aggregators; kept Mangmee shell. web typecheck + 233 tests pass; grep clean. (`next-env.d.ts` typegen artifact intentionally not committed.)

**Browser pass (api-verify-3011 + web-verify-3002, seeded docker DB, scratchpad `crm-ltv-seed.ts` linked 3 customers→counterparties w/ payments):** KPIs 12 / 17% (2 of 12) / 24 นาที / 5 overdue. Status breakdown sums to 12 with correct UPPERCASE→Thai mapping. **Top-LTV: ร้านกาแฟ Slow Bar ฿55,000 VIP / คุณเมย์ ฿24,600 / คุณเบล ฿8,000** — คุณเบล is **8,000 not 98,000**, proving the 50k VOIDED + 40k DRAFT are excluded. Tier derives from real LTV. Staff: unassigned ดูแล8·ปิด2 (25%) + Local Owner ดูแล4·ปิด0 (0%), real names. Switching branch to Head Office refetched to total 0 + empty states (server-side scope + "KPIs change when branchId changes" acceptance). No mock, no banner.

- **Phase D** (`a202f410`, owner-approved "audited auto-link, no extra permission gate"): new accounting `EnsureCustomerCounterpartyUseCase` — creates a CUSTOMER `AccountingCounterparty` as an **audited** system side-effect (`action: accounting.counterparty.create`, `metadataJson.source: crm_auto_link`), intentionally NOT gated on `accounting.counterparty.manage` (the caller already authorized the sales document). Wired into `CreateCrmQuotationDraftUseCase` (crm module): on the first quotation for a customer with `accountingCounterpartyId = null`, create + write back via `PrismaCrmRepository.setCustomerAccountingCounterparty`, then pass the id to `createDocument`; repeat quotations reuse. So future RECEIVED/RECORDED payments accrue into the Phase B LTV read model automatically. Idempotency: `!counterpartyId` guard + write-back; concurrent first-quotations can still race (acceptable MVP1, noted in code). 4 quotation-seam specs; **full api suite 1215 pass / 0 fail**.

Done. Remaining follow-ups (separate items, not this task): a `lifetimeValueAmount` cache/recompute job (D3 — future); message-level avgResponse (D7); a real `CrmCustomer.tier` field to replace the LTV-derived placeholder (D4); dashboard KPI providers (Flow-A Phase 6 item 4). Deploy to prod is owner-gated (separate canary step).
