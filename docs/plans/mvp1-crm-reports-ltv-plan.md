# MVP1: CRM Reports Summary + real LTV (Mangmee `/crm-reports` → real API, revenue→LTV flow closed) — Implementation Plan

Status: ✅ SHIPPED 2026-07-09 (all 4 phases committed to `develop`; api 1215 tests / web 233 / browser-verified — evidence in [[agent-memory/mvp1-crm-reports-ltv]]). Built `GET .../crm/reports/summary` (Mangmee Flow-A screen #6 / plan Phase 6 item 3) and closes the LTV gap so the "top customers by LTV" card shows **real** revenue, not mock. Continues the wire-up track after [[plans/mvp1-a1-web-wireup-plan]] (inbox/customers/AI panel done); `/crm-reports` was deliberately banner-only there because no backend existed.
Executor: **Codex CLI under harness** — Codex writes code against each phase brief; Claude reviews the diff, runs tests + browser verification, sends fixes back; owner/harness controls all commits. **Codex never commits, never `git add`, never starts servers.**
Scope: Mangmee Flow-A **screen #6 "CRM reports"** ([[specs/mangmee-flow-a-be-integration-spec]] §7 line 174, §9 line 206, §11 addendum below) + **plan Phase 6 item 3** ([[plans/mangmee-flow-a-be-integration-plan]] line 104) + the **LTV derivation** that both the item-15 spec ([[specs/crm-line-oa-customer-os-spec]] §401-410 "lifetime value derived read model") and Flow-A D10 left unspecified.
Authority to build now: permission `crm.report.read` is **already registered + granted** (`permission-registry.ts:266`; `ROLE_GRANTS` + CRM capability pack) — route-gating only, no registry work. Needs **no new Prisma model and no migration** — pure aggregation over existing `CrmConversation`/`CrmMessage`/`CrmCustomer`/`AccountingDocument`.

## The woven flow (what "close the gap + ร้อยเรียง flow" means here)

End-to-end customer-revenue → LTV → report, with the two broken links this plan closes marked **[CLOSE]**:

1. Customer chats on LINE → `CrmConversation` + `CrmMessage` — **built, real**.
2. Staff turns the conversation/customer into a sales document (quotation → invoice/receipt) → `AccountingDocument` via the existing `crm-quotation.use-case` → item-08 — **built, real** (but the customer↔counterparty link is often null).
3. Customer pays → `AccountingDocument.paidAmount` rises, allocations recompute it — **built, real** (`prisma-accounting.repository.ts` create/allocate/recompute).
4. **[CLOSE — Phase A/B]** LTV(customer) = Σ realized `paidAmount` on that customer's customer-facing sales documents, read through the counterparty bridge. Today **no code computes this** and `CrmCustomer.lifetimeValueAmount` is a dormant, never-written column.
5. **[CLOSE — Phase D]** The bridge `CrmCustomer.accountingCounterpartyId` is optional and usually null — nothing links a customer to a counterparty when they first transact, so even paying customers sum to 0. Phase D back-links at the sale seam so LTV accumulates automatically going forward.
6. **[CLOSE — Phase B]** `GET .../crm/reports/summary` surfaces top-5-by-LTV + chat/response/staff KPIs.
7. **[CLOSE — Phase C]** The Mangmee `/crm-reports` page shows all of it, real; the prototype banner comes off.

**Why not build `CrmCustomerPurchase`** (the Flow-A §8 D10 proposal): `AccountingDocument` already holds real, paid, customer-facing sales documents and item-08 owns revenue. A parallel purchase table would duplicate the revenue source and split the source of truth. LTV reuses accounting via the counterparty bridge. This decision is recorded in the spec addendum (§11) and **supersedes the `CrmCustomerPurchase`-for-LTV idea**.

## Architecture decisions (record; these bind the implementation)

- **D1 — LTV source = accounting counterparty bridge, not a new table.** `CrmCustomer.accountingCounterpartyId` (nullable scalar, `schema.prisma:3926`, indexed :3982) → `AccountingCounterparty.id` → `AccountingDocument.counterpartyId`. No new Prisma model; no migration.
- **D2 — LTV formula (realized cash received).** `LTV(c) = Σ AccountingPayment.amount WHERE companyId = c.companyId AND counterpartyId = c.accountingCounterpartyId AND direction = 'RECEIVED' AND status = 'RECORDED'`. Summing **payments** (not document `paidAmount`) is deliberate and corrects a double-count: a single sale can span an INVOICE **and** a RECEIPT/TAX_INVOICE, and `paidAmount` is duplicated across those documents, whereas a payment is recorded once. Also, voiding a document does **not** zero its `paidAmount` and can leave `paymentStatus = PAID` (discovery-confirmed), so document sums are unsafe; a VOIDED/DRAFT payment is excluded by the `status = RECORDED` filter. Null counterparty ⇒ LTV 0. Decimal-safe — carried as a **string** in the contract (never a JS float). Refund netting (a customer-direction `PAID` payment) + credit notes are a future refinement — MVP1 sums gross received. Codex confirms exact enum spellings against `schema.prisma` (`AccountingPaymentDirection` RECEIVED/PAID; payment `status` DRAFT/RECORDED/VOIDED).
- **D3 — Derived read model is computed on-demand in the report query, not a cached job.** The `lifetimeValueAmount` column stays reserved for a future cache; this build computes live so numbers are always correct with zero staleness and no job to run. A recompute worker + `lifetimeValueUpdatedAt` write is explicitly **out of scope / future**.
- **D4 — Tier badge derived from real LTV (documented business rule, replaceable).** No `tier` field/enum exists yet (Flow-A §8 D10 is unbuilt). To keep the Mangmee card whole while staying honest, tier is derived from the customer's **real** LTV via one named constant `LTV_TIER_THRESHOLDS`: `LTV ≥ 50,000 → 'vip'` (VIP) · `LTV > 0 → 'active'` (ลูกค้าประจำ) · `LTV = 0 → 'lead'` (ลูกค้าใหม่). Flagged `MVP1: derived tier — replace with CrmCustomer.tier when D10 lands`. This is *derived from real revenue*, not fabricated. **Owner may adjust the 50,000 threshold** — it is a product choice, isolated to one constant.
- **D5 — Branch scope via customer join.** `CrmConversation` has **no** `branchId`; branch scope for every conversation aggregate is derived by joining conversation → `CrmCustomer.branchId`. The `branchId` query param is **validated/intersected server-side** against the caller's allowed scope (never trusted raw); company tenancy always applies. Mirror the existing branch-scope posture used by the customers/360 reads; if none exists, filter `CrmCustomer.branchId` under `companyId`. Acceptance requires KPIs to change when `branchId` changes.
- **D6 — Overdue reuses the canonical predicate.** Use the existing `overdueWhere(now)` (`prisma-crm-inbox.repository.ts:143-150`: `status notIn [RESOLVED, SPAM]` ∧ `firstRespondedAt = null` ∧ `firstResponseDueAt < now`) — **not** the prototype's `waitMin > 30`.
- **D7 — avgResponseMin = conversation-level.** Average of `(firstRespondedAt − createdAt)` in **minutes** over conversations with `firstRespondedAt` not null (branch-scoped, SPAM excluded). Reuses the maintained `firstRespondedAt`; `createdAt` ≈ first inbound for LINE-inbound conversations, so this equals "first-staff-reply − inbound" per the plan wording. `null` when no responded conversations (UI shows "—", not "0"). *(Message-level delta from `CrmMessage` is a future refinement, noted not built.)*
- **D8 — Exclude `SPAM` from every count** (matches "SPAM excluded from all views"): total, statusBreakdown, resolvedRate, staffPerformance.
- **D9 — statusBreakdown over the 6 non-SPAM statuses**, each `{ status (UPPERCASE enum), count, pct = round(count/total*100) }`; total 0 ⇒ pct 0. FE maps UPPERCASE→Mangmee lowercase keys + Thai labels.
- **D10 — staffPerformance** grouped by `assignedToUserId` (null → one **unassigned** bucket, FE label "ยังไม่ assign"): `{ userId: string|null, displayName?, assigned, resolved (status=RESOLVED in that bucket), rate = round(resolved/assigned*100) }`, sorted by `assigned` desc. Resolve `displayName` via the existing member/user directory the inbox already uses for assignee names; if a batch lookup isn't readily available, return `userId` + let FE fall back — never invent names.

## Hard rules (violating any = wrong implementation; carried from the wire-up plan)

1. **Mangmee design stays.** `CrmReportsPrototypePage.tsx` remains the visual shell — same layout, `MangmeeCard`/`MangmeeBranchChip`, Thai copy, the 4 blocks (KPI cards / status breakdown / top customers / staff performance). No redesign.
2. **Kill mock on the wired surface.** After Phase C, `CrmReportsPrototypePage.tsx` imports **nothing** from `mangmee-crm-data.ts` and nothing from `crm-reports-prototype.model.ts`'s mock aggregators (`getReportKpis`/`getStatusBreakdown`/`getTopCustomers`/`getStaffPerformance`). Never render mock rows as a fallback on error — render the error state.
3. **Contracts + existing clients only.** All web data via `apps/web/src/features/crm/crm.api.ts` typed with `@watchdog-bms/contracts`; new client fn goes INTO that file using `authedApiFetch`. No direct `fetch`, no react-query/SWR (plain `useState`/`useEffect`).
4. **Backend boundaries.** New backend code lives in `apps/api/src/modules/crm-inbox` (reports controller/use-case/repo/logic, mirroring `crm-customer-360`) and a **read-only** aggregation use-case in the accounting module. CRM reads accounting **through the accounting use-case** (mirror `crm-customer-360` financeBlock injecting `ListDocumentsUseCase`) — **never a direct accounting repository from CRM**. Deny-by-default `@RequirePermissions('crm.report.read')`; company tenancy on every query; branch intersected server-side.
5. **Derive, never invent.** Every displayed number traces to real rows (conversations, messages, paid accounting docs). Tier is derived from real LTV (D4). No fabricated scores/tiers/LTV. Customers with LTV 0 are **excluded** from top-5 (card shows fewer, or an empty state "ยังไม่มีข้อมูลยอดสะสม" when none) rather than padded.
6. **Decimal-safe money.** LTV crosses the wire as a string; server sums with Prisma Decimal, not JS number. FE formats for display only.
7. **XSS-inert.** Customer/staff text renders as text nodes only; no `dangerouslySetInnerHTML`.
8. **Smallest correct diff.** Reuse `conversationCounts` (`:209-232`) and `overdueWhere` (`:143-150`) verbatim; do not re-derive them. No new dependency. No `schema.prisma`/migration change in any phase (the column and bridge already exist).
9. **No commits, no `git add`, no servers, no edits outside each phase's file list.** Verification commands only.

## Environment quirks (read before running anything)

- Node: shell defaults to v14. Prefix EVERY command session: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.
- After editing `packages/contracts`: `pnpm --filter @watchdog-bms/contracts build` before dependent typechecks.
- API tests use an **explicit tsx `--test` file list** in `apps/api/package.json` — a new `*.spec.ts` that isn't added to that list **silently never runs** ([[memory: api-test-explicit-spec-list]]). Every new API spec MUST be appended to that list.
- Sandbox `tsx` IPC can throw `listen EPERM` before tests start; allowed fallback is `node --import tsx --test <files>`. Prisma CLI needs explicit `DATABASE_URL` from repo-root `.env` (docker `:15432/watchdog_bms`) — `apps/api/.env` is stale.
- Web typecheck runs `next typegen` first: `pnpm --filter @watchdog-bms/web typecheck`. Web unit tests are a **glob** (`src/**/*.spec.ts`) — a new web spec is picked up automatically.
- Harness browser rig: `api-verify-3011` + `web-verify-3002` (`.claude/launch.json`, local/gitignored; already patched so API CORS allows origin `:3002`).

## Phase A — contracts + pure summary builder (domain logic) + unit test  [DB-free]

Files: `packages/contracts/src/crm-inbox.ts`; new `apps/api/src/modules/crm-inbox/domain/logic/crm-reports.logic.ts` + `crm-reports.logic.spec.ts`.

- **A1 contracts (additive, in `crm-inbox.ts` beside `CrmCustomer360Summary`, reusing `CrmConversationStatus`):**
  ```ts
  export type CrmReportsStatusBreakdownItem = { status: CrmConversationStatus; count: number; pct: number };
  export type CrmReportsStaffPerformanceItem = { userId: string | null; displayName?: string; assigned: number; resolved: number; rate: number };
  export type CrmReportsTopCustomer = { customerId: string; displayName: string; lifetimeValueAmount: string; tier: 'vip' | 'active' | 'lead' };
  export type CrmReportsSummary = {
    total: number; resolved: number; resolvedRate: number;
    avgResponseMin: number | null; overdue: number;
    statusBreakdown: CrmReportsStatusBreakdownItem[];
    staffPerformance: CrmReportsStaffPerformanceItem[];
    topCustomers: CrmReportsTopCustomer[];
    branchId: string | null; // echoes the applied scope
  };
  ```
- **A2 pure builder** `buildCrmReportsSummary(input): CrmReportsSummary` — input is plain aggregates (no Prisma types), so it is unit-testable with a hand-computed fixture:
  ```ts
  type CrmReportsInput = {
    statusCounts: { status: CrmConversationStatus; count: number }[]; // SPAM already excluded by caller
    overdue: number;
    respondedDurationsMin: number[];   // (firstRespondedAt - createdAt) in minutes, responded convs only
    staff: { userId: string | null; displayName?: string; assigned: number; resolved: number }[];
    customers: { customerId: string; displayName: string; lifetimeValueAmount: string }[]; // LTV strings, any order
    branchId: string | null;
  };
  ```
  Logic: `total = Σ statusCounts.count`; `resolved = RESOLVED count`; `resolvedRate = total ? round(resolved/total*100) : 0`; `avgResponseMin = respondedDurationsMin.length ? round(avg) : null`; statusBreakdown emitted in the 6-status order NEW/OPEN/WAITING_CUSTOMER/WAITING_INTERNAL/FOLLOW_UP/RESOLVED with pct; staffPerformance maps `rate = assigned ? round(resolved/assigned*100) : 0`, sort by assigned desc; topCustomers = customers with LTV>0 → parse decimal-safe (BigInt/整数-cents compare, not `parseFloat` on a formatted string; input LTV is a raw decimal string like `"12345.6700"`) → sort desc → take 5 → `tier` via `LTV_TIER_THRESHOLDS`. Export `LTV_TIER_THRESHOLDS` and a `deriveTier(ltvString)` helper.
- **A3 unit test** `crm-reports.logic.spec.ts` — one hand-computed fixture exercising: total/resolvedRate rounding; avg with a known set (and the empty→null case); status ordering + pct; unassigned staff bucket (`userId: null`); LTV sort + the 50,000 VIP boundary + the >0 ACTIVE + the 0-excluded rule + fewer-than-5. Assert exact expected `CrmReportsSummary`. This IS the acceptance "report numbers reproduce a hand-computed fixture."

Verify (Codex): `pnpm --filter @watchdog-bms/contracts build`; `pnpm --filter @watchdog-bms/api typecheck`; run the new spec via the api list (append it) or `node --import tsx --test .../crm-reports.logic.spec.ts`.

## Phase B — repos + accounting LTV aggregation + reports use-case + controller

Files (backend): accounting module (discover exact dir — `apps/api/src/modules/accounting-documents/**`): new read use-case `SumRealizedRevenueByCounterpartyUseCase` + a repo method; `apps/api/src/modules/crm-inbox/infrastructure/prisma-crm-inbox.repository.ts`; new `apps/api/src/modules/crm-inbox/application/use-cases/crm-reports-summary.use-case.ts` (+ `.spec.ts`); new `apps/api/src/modules/crm-inbox/presentation/http/crm-reports.controller.ts`; `apps/api/src/modules/crm-inbox/crm-inbox.module.ts` (wire controller + provider + cross-module import). Append every new api spec to `apps/api/package.json` test list.

- **B1 accounting aggregation (read-only, in the accounting module so ownership stays put):** `SumRealizedRevenueByCounterpartyUseCase.execute(ctx, counterpartyIds: string[]): { counterpartyId: string; amount: string }[]`. One Prisma `groupBy({ by: ['counterpartyId'], where: { companyId, counterpartyId: { in }, documentType: { in: [INVOICE, RECEIPT, TAX_INVOICE] }, status: { not: VOIDED } }, _sum: { paidAmount } })`. Empty `counterpartyIds` ⇒ `[]` (no query). Amount emitted as a decimal string. (Confirm the exact enum member names for documentType/status against `schema.prisma`.)
- **B2 crm-inbox repo fetch methods** (branch-scoped; branch = join through `CrmCustomer.branchId`):
  - `reportsStatusCounts(companyId, branchCustomerIds?)` — reuse the `conversationCounts` groupBy shape, exclude SPAM, scoped by `customerId in branchCustomerIds` when a branch filter is active.
  - `reportsOverdue(...)` — reuse `overdueWhere(now)` + same branch scope.
  - `reportsRespondedDurations(...)` — select `createdAt, firstRespondedAt` where `firstRespondedAt not null` (+scope); compute minutes in the use-case/logic (keep Prisma out of the pure builder).
  - `reportsStaff(...)` — groupBy `assignedToUserId` with a resolved-count (two groupBys or one with a status split), null bucket preserved.
  - branch resolution: `reportsBranchCustomerIds(companyId, branchId)` — customer ids for the branch (empty branch filter ⇒ undefined = all-company). Reuse the customers repo's branch filter.
- **B3 use-case** `CrmReportsSummaryUseCase.execute(ctx, { branchId? })`: `requirePermission('crm.report.read')`; **intersect `branchId` with caller scope server-side** (reject/emptyset a branch the caller can't see — never trust raw); resolve branch customer ids (D5); `Promise.all` the repo fetches; fetch branch-scoped customers that have `accountingCounterpartyId != null` (`{ id, displayName, accountingCounterpartyId }`, exclude ARCHIVED/MERGED); call `SumRealizedRevenueByCounterparty` with those counterpartyIds; map counterparty sums back to customers as `lifetimeValueAmount`; hand everything to `buildCrmReportsSummary`. Mirror `crm-customer-360.use-case` for cross-module injection + ctx posture.
- **B4 controller** `@Controller('companies/:companyId/crm/reports')`, `@Get('summary')`, `@RequirePermissions('crm.report.read')`, `@ReqCtx() ctx`, `@Query('branchId')` optional → delegate. Thin, mirroring `crm-customer-360.controller.ts`.
- **B5 module wiring** append controller to `controllers[]`, use-case to `providers[]`, import the accounting use-case's provider/module the same way 360 does.
- **B6 use-case spec** (append to api list): permission-denied; company tenancy (cross-company customer/counterparty excluded); branchId changes the numbers (acceptance); a customer with a paid INVOICE + a partial + a VOIDED sums to the expected realized LTV and lands in top-5 with the right tier; a customer with no counterparty is LTV 0 / excluded. Use the module's existing test harness (in-memory or seeded docker per sibling specs).

Verify (Codex): contracts build; `pnpm --filter @watchdog-bms/api typecheck`; api test list green (new specs included).

## Phase C — wire the Mangmee `/crm-reports` page to the real endpoint + browser verify

Files: `apps/web/src/features/crm/crm.api.ts` (add client); `apps/web/src/features/crm/CrmReportsPrototypePage.tsx`; `apps/web/src/features/crm/crm-reports-prototype.model.ts` (retype presentational helpers over the contract; delete mock aggregators) + its `.spec.ts` if present; `apps/web/app/(workspace)/companies/[companyId]/crm-reports/page.tsx` (confirm `fetchServerSession` + `permissions` prop like the inbox/customers routes — add if missing).

- **C1 client** `getCrmReportsSummary(companyId, { branchId? }): Promise<CrmReportsSummary>` via `authedApiFetch` (GET `.../crm/reports/summary?branchId=`), typed with contracts.
- **C2 page** gate `crm.report.read` (`ForbiddenState` on absence/403); `useState/useEffect` load with a stale-response guard; loading skeleton, error state (retry), and per-card empty states — never mock fallback. Feed the 4 blocks from the real summary:
  - KPI cards: total, `${resolvedRate}%` (+ `${resolved} จาก ${total} เคส`), `avgResponseMin` → "N นาที" or "—" when null (**delete the hardcoded `'8 นาที'`**), overdue.
  - Status breakdown: map UPPERCASE `status` → the lowercase `CONV_STATUS_META`/`CONV_STATUS_ORDER` keys + Thai labels + colors; bar width = `pct`.
  - Top customers: real `displayName` + `฿{formatted lifetimeValueAmount}` + tier badge from the contract `tier` (`TIER_META`); empty state when none.
  - Staff performance: `displayName ?? userId`, `ดูแล {assigned} · ปิด {resolved}`, `{rate}%`; unassigned bucket label "ยังไม่ assign".
  - Branch chip drives the `branchId` param and refetches (acceptance: numbers change).
- **C3** remove `<PrototypeDataNotice />` from this page; delete mock aggregators + any `mangmee-crm-data` import; keep only presentational consts operating on real data; update the model spec.

Verify: Codex runs `pnpm --filter @watchdog-bms/web typecheck` + `test`; `grep -n "mangmee-crm-data\|getReportKpis\|getTopCustomers" CrmReportsPrototypePage.tsx` → nothing. **Harness (Claude)** browser pass on `api-verify-3011`/`web-verify-3002`: seed a counterparty-linked customer with a paid `AccountingDocument` (+ a partial + a VOIDED) so top-LTV shows a real, hand-checkable number; verify KPI/status/staff numbers against the DB; toggle branch → numbers change; forbidden/empty/error states; screenshot.

## Phase D — weave the flow: back-link counterparty at the sale seam

Files (discover exact paths first): the CRM→document creation use-case (`crm-quotation.use-case.ts` around the `customer?.accountingCounterpartyId` pass, ~line 79) + the accounting counterparty find-or-create use-case (add a thin one in the accounting module if only a repo exists) + `crm-customer.use-case`/repo for the write-back. Append new specs to the api list.

- **D1** when a sales document is created for a CRM customer whose `accountingCounterpartyId` is null: find-or-create an `AccountingCounterparty` (`type: CUSTOMER`, seeded from the customer's displayName/contact) via the accounting use-case, then persist `accountingCounterpartyId` back on `CrmCustomer` (single update; idempotent — a second document reuses the same counterparty). Respect tenancy + the existing item-08 boundary (CRM calls the accounting use-case, not its repo).
- **D2** do **not** fuzzy-backfill historical customers (name matching is unsafe). Historical LTV requires the link; going forward it is automatic. Note this in memory.
- **D3 spec** (append to api list): first document links + writes back the id; second document reuses it (no duplicate counterparty); after a paid document exists, the Phase B LTV read model returns the expected amount for that customer.

Verify: contracts build (if touched); api typecheck; api test list green.

## Verification matrix / acceptance

| Acceptance (Flow-A plan line 106) | Where satisfied |
|---|---|
| "report numbers reproduce a hand-computed fixture" | Phase A `crm-reports.logic.spec.ts` (pure) + Phase B use-case spec (with DB) |
| "dashboard KPIs change when `branchId` changes" | Phase B branch-scope test + Phase C browser toggle |
| top-5 LTV is **real** | D2 formula in B1/B3 + Phase C browser pass on a seeded paid document; Phase D makes it accumulate automatically |
| deny-by-default + tenancy + branch intersect | Phase B controller gate + use-case spec (permission-denied, cross-company) |

## Done criteria

- `GET .../crm/reports/summary?branchId` returns real totals/resolvedRate/avgResponseMin/overdue/statusBreakdown/staffPerformance/top-5-LTV; gated `crm.report.read`; branch-scoped server-side.
- `/crm-reports` shows real data in the Mangmee shell, banner gone, zero mock reads; top-customers LTV is real revenue (Phase C seed proves it; Phase D makes it self-populate).
- `lifetimeValueAmount` derivation is specified (§11) and reuses accounting — the two-spec conflict is resolved in favour of the counterparty bridge.
- All phase verifications green; evidence + file lists in [[agent-memory/mvp1-crm-reports-ltv]]; Flow-A plan Phase 6 item 3 marked done; project memory updated.

## Out of scope (do not build)

`lifetimeValueAmount` cache/recompute worker + `lifetimeValueUpdatedAt` writes (D3 — future); message-level avgResponse (D7 — future); a `CrmCustomer.tier` field/enum (D4 uses a derived placeholder); `CrmCustomerPurchase`/`CrmCustomerCourse` tables (not needed for LTV); dashboard KPI providers (Flow-A Phase 6 item 4 — separate); PO/discount settings (Phase 6 items 1-2); bookings/broadcast; any `schema.prisma`/migration change; historical LTV fuzzy backfill (D2).
