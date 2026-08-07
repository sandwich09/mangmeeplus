# Plan: Expenses ("ค่าใช้จ่าย + ใบเสร็จ") Mangmee UI Reskin + Summary Wiring

Status: In progress 2026-07-09.
Owner: supapron.wiroon@gmail.com (product owner); implemented via Claude (Opus 4.8).
Branch: `redesign-ui-and-remove-menu-fogot-password`.
Related: [[specs/expense-receipt-upload-spec]] (item 09, backend complete), [[plans/mangmee-system-ui-alignment-plan]] Phase 3 open item "Expenses pages", [[agent-memory/mangmee-regression-rewire]] (A2 note: Expenses re-pointed to `ExpensesHubPage` but left "957 lines of pre-mangmee generic blue Tailwind"), [[agent-memory/expense-receipt-upload-09]].

## Product

- Goal: bring the Expenses workspace (`/companies/[companyId]/expenses`) to the มั่งมี visual system so it matches the reference mock's 5-sub-tab layout — summary KPI cards, status chips, split list + rich review panel, category management, company signatures, and accountant evidence — without changing any business rule, permission, route, or contract boundary.
- Users: finance / accountant / owner reviewing receipts, bills, tax invoices, transfer slips, and text notes captured from web + LINE.
- Journey (unchanged): review draft → check duplicate → mark ready → confirm → record payment; manage categories/signatures; export accountant evidence package.
- Acceptance:
  - Page renders in the shared `MangmeePage`/`MangmeeCard`/`mangmee-*` idiom (green brand tokens, rounded-2xl, theme shadows), not generic blue Tailwind.
  - List sub-tab shows 5 real finance KPI cards (ค่าใช้จ่ายรวม / รอตรวจสอบ / ค้างชำระ / เกินกำหนดชำระ / ภาษีซื้อ VAT) computed over the selected period+branch.
  - Status filter chips with live counts (ทั้งหมด/ฉบับร่าง/รอตรวจสอบ/ยืนยันแล้ว), a client-side search, and a day/month period control.
  - Split list + sticky review panel with provenance file card, money summary (incl. VAT/WHT), "ยอดที่ต้องชำระจริง" box, and status-specific real actions.
  - Category / Signature / Evidence sub-tabs reskinned; every existing real action preserved (create/archive category, upload/approve/reject/archive signature, folder view + CSV index + manifest export).
  - No fake mutations; unavailable capability stays honestly labelled.

## Architecture

- No backend logic change. The list endpoint (`GET /v1/companies/:companyId/expenses`) already returns `data.map(mapExpense)` — the full `ExpenseRecord` spread — so `vatAmount` and `dueDate` are **already on the wire**; they were simply absent from the typed `ExpenseSummary` contract. The only "API" change is a type-only widening so the frontend can consume them for the KPI cards.
  - `packages/contracts/src/expenses.ts`: add `vatAmount: string` + `dueDate: string | null` to `ExpenseSummary`; drop the now-redundant duplicates from the `ExpenseDetail` extension. Rebuild `packages/contracts/dist`.
  - `apps/web/src/features/expenses/expenses.model.ts`: mirror the two fields in the hand-kept web `ExpenseSummary`; drop dupes from web `ExpenseDetail`.
- FE reskin only, two files:
  - `apps/web/src/features/expenses/ExpensesPages.tsx` — hub tabs, list (cards+chips+search+period), split review panel, upload.
  - `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx` — category, signature, evidence panels.
- Reuse the existing `expenses.api.ts` client verbatim (all endpoints already present). Reuse `mangmee` primitives + `mangmee-*` CSS classes (same idiom as the A2/A6 Reports/Ledger reskins and the B2 Bookings reskin).
- Data plumbing for KPI cards: fetch the period+branch-scoped list once (large `pageSize`, no status filter, no search), compute the 5 KPIs + chip counts from that set, and apply the status chip + search client-side to the table. Period control (day/month) maps to `fromDate`/`toDate` on `expenseDate`.
- Permissions/ABAC/state/audit: untouched — server stays the authority; `403`/forbidden already surfaces as the honest "🔒 ไม่มีสิทธิ์" banner in the panels.

## Scope boundaries

- IN: visual reskin of the two web files; contract/web type widening for KPI cards; keep all existing real API wiring.
- OUT: backend/use-case/repo/permission/migration changes; XLSX/PDF export (real backend gives BOM-CSV index + JSON manifest — the list "ส่งออก" reuses that real CSV; no fake PDF); server-derived KPI aggregation endpoint (client aggregation over the month set is sufficient for MVP; note pagination cap as a known limit); list pagination controls (month scoping keeps sets small; deferred).

## Verification

- `pnpm --filter @watchdog-bms/contracts build` (dist refreshed with widened summary type).
- `pnpm --filter @watchdog-bms/web typecheck` clean.
- `pnpm --filter @watchdog-bms/web test` (existing `expenses.api.spec`/`expenses.model.spec` still green; add none unless logic added).
- `pnpm --filter @watchdog-bms/api typecheck` (unaffected sanity — contract type widening compiles against the already-returned fields).
- Manual/visual: not run headless here; typecheck + unit suites are the standing bar for this effort (same as Track A/B reskins). Record exact commands + results in the task memory.

## Known limitations (recorded)

- KPI cards aggregate over the fetched month page (large `pageSize`); a company exceeding it in one month would undercount — acceptable for MVP, upgrade to a server aggregate later if needed.
- List "ส่งออก Excel" downloads the real accountant-package **CSV index** (opens in Excel) + optional manifest; there is no XLSX/PDF backend yet, so no separate PDF button is faked.
- Local storage adapter is still a byte-discarding stub locally (pre-existing platform gap) — evidence file previews/downloads 404 locally until the storage follow-up lands; the manifest links are correct once a real adapter exists.
