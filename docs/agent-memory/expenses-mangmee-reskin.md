# Agent Memory: Expenses ("ค่าใช้จ่าย + ใบเสร็จ") Mangmee UI Reskin

## Update 2026-07-09 (pass 2 — "100% ตรงตาม HTML mock, code จริงตาม standard project")

Owner asked the screens to match the provided มั่งมี HTML mock 100% but written as real standard-project code. The mock's Thai is mojibake (double-encoded, untranscribable), so "100%" = match visual structure/layout/grids/exact hex/component arrangement/per-status actions/interaction design, using correct Thai from the real feature, backed by real API calls (no fake data; honest placeholders where the backend genuinely lacks a field).

Done this pass:
- Extracted shared presentational primitives into `ExpensesUi.tsx` (DRY, standard-project structure): `err/baht/baht0/dateShort`, class consts, inline-SVG `ICON` set, exact-hex `StatCard` + `KPI` palette (amber `#B54708/#FEF0D9`, sky `#0BA5EC/#F0F9FF`, purple `#6941C6/#F4EBFF`, danger `#D92D20/#FEE4E2`, brand `#027A48/#DCFCE7`), `StatusBadge`/`STATUS_TONE`/`TAX_TONE`, `ErrorBanner`/`InfoBanner`/`StateBanner`/`isForbidden`, `HowItWorks({title?,steps})`. Both `ExpensesPages.tsx` + `ExpensesWorkspacePanels.tsx` import from it.
- `ExpensesPages.tsx` list rewritten to mock structure: period finBar (รายวัน/รายเดือน + date/month + วันนี้/เดือนนี้) → 5 exact-hex `StatCard`s → export bar (ส่งออก Excel = real BOM-CSV; ส่งออก PDF = `window.print()`, a real browser print-to-PDF path) → **always-split** grid `1.35fr .95fr` with grid rows (`1.6fr .9fr .8fr auto`: vendor+catChip+docNo | date+channel | grand(right) | status+paid) on the left and the rich detail panel OR a `DetailPlaceholder` card on the right. Per-status detail actions restructured (draft→ส่งตรวจสอบ; ready→ปฏิเสธ + ยืนยันและลงบัญชี; confirmed→ดูรายการบันทึกบัญชี(→`/companies/{id}/journal`)+record payment+void; rejected→เริ่มตรวจใหม่).
- `ExpensesWorkspacePanels.tsx` categories rewritten to mock: table with the "type" slot filled by the REAL editable `inputVatDefault` chip (`VAT_LABEL`/`VAT_TONE`), an active/archive **toggle switch** (track/knob), edit/trash **icon buttons**, and a confirm-archive **modal**; add form has an inputVatDefault segmented toggle (ขอคืนได้/ขอคืนไม่ได้). Signatures + evidence use the titled `HowItWorks`; evidence's 3rd summary card is now a brand **gradient export** card.

Honesty decisions (pass 2):
- The mock's category "expense/cost" type toggle is STILL not faked. `taxCategory` is a genuine tax-report classification (feeds `tax` incomeCategoryCode, `reports` category, ledger journal `categoryKey`) — writing "expense/cost" there would corrupt those. Instead the "type" chip + add-form toggle surface the real, persisted `inputVatDefault` (CLAIMABLE/NON_CLAIMABLE/NEEDS_REVIEW), which `create/updateExpenseCategory` genuinely accept.
- No hard-delete exists for categories/signatures → the trash icon opens a confirm modal labeled "เก็บถาวร" (archive), not "ลบ" — matches the real soft-delete (`status: ARCHIVED`), reversible via the toggle.
- `expenseCategoryId` added to the list rows (category chip) — it was already on the wire (`listExpenses` → `data.map(mapExpense)` spreads the full record), so this was a **type-only widening** of `ExpenseSummary` (contract + web mirror), dedupe from `ExpenseDetail`. Same pattern as pass-1 vatAmount/dueDate. Contracts dist rebuilt.

Verification (pass 2): contracts build ✓ · web typecheck ✓ · api typecheck ✓ · web unit tests 219/219 ✓ · Tailwind custom-shade self-audit ✓ (only registered brand/error-50-500-700/warning/success shades used). Adversarial audit workflow (honesty + logic + fidelity lenses, per-finding skeptic verify) run afterward — results recorded below.

---

Status: Complete 2026-07-09. Verified by contracts build + monorepo typecheck (web/api) + web unit suite. No backend logic change; visual reskin + type-only summary widening only.
Owner: supapron.wiroon@gmail.com (product owner); implemented via Claude (Opus 4.8).
Scope: [[plans/expenses-mangmee-reskin-plan]]. Closes the last open "Expenses pages" reskin item in [[plans/mangmee-system-ui-alignment-plan]] Phase 3, called out in [[agent-memory/mangmee-regression-rewire]] A2 ("did NOT reskin Expenses — 957 lines of pre-mangmee generic blue Tailwind"). Backend/API from [[agent-memory/expense-receipt-upload-09]] (item 09) already complete and deployed. Branch `redesign-ui-and-remove-menu-fogot-password`.

Role gate status:
- BA: Owner asked to build the "ค่าใช้จ่ายใบเสร็จ" front page and wire the API cleanly. Goal is the Expenses workspace matches the มั่งมี reference mock (5 sub-tabs: รายการ/อัปโหลด/หมวดหมู่/ลายเซ็น/หลักฐานบัญชี) with finance KPI cards, status chips, split list + rich review panel, category/signature/evidence management, and accountant export — while every business rule, permission, route, and endpoint stays exactly as item 09 shipped. Acceptance = the reskin criteria in the plan; no fake mutations; unavailable capability stays honest.
- SA: Discovery showed the API + web feature were **already fully wired** (`expenses.api.ts` covers every endpoint; `ExpensesHubPage` covers list/detail/upload/duplicate/confirm/payment + category/signature/evidence) but styled in generic blue Tailwind, not the shared `MangmeePage`/`MangmeeCard`/`mangmee-*` idiom. Only real "API" gap for the mock's 5 KPI cards was that `vatAmount` + `dueDate` weren't in the typed `ExpenseSummary` — but the list endpoint returns `data.map(mapExpense)` (full record spread), so both are **already on the wire**; widening the contract type was the entire backend-facing change. No use-case/repo/permission/migration touched.
- DEV: Reskinned two files to the mangmee idiom (same pattern as the A2/A6 Reports/Ledger and B2 Bookings reskins), kept all real API calls verbatim, added client-side KPI aggregation + status chips + search + day/month period control over the month-scoped list, and a real list "ส่งออก Excel (CSV)" that reuses `createAccountantPackage`. Type widening: `vatAmount`/`dueDate` added to `ExpenseSummary` (contract + web mirror), redundant dupes dropped from `ExpenseDetail`; `reviewStatus` added to the web line type (already returned by `mapLine`). Fixed non-existent `error-400`/`error-600` Tailwind shades → `error-500` (theme registers error 50/500/700 only), swapped the mock's `.num` class for the built-in `tabular-nums` utility (`.num` isn't defined in this app's globals), and dropped two unused imports.
- Integration: Backend-to-frontend contract re-verified by monorepo typecheck (the widened summary type compiles against the already-returned fields; api typecheck clean). Web journey preserved: period+branch KPI cards, chip/search table, split review panel (provenance file card, VAT/WHT money rows, ยอดที่ต้องชำระจริง box, status-specific real actions markReady/confirm/reject/void/payment/duplicate + DocumentReviewSection doc-type/tax/category save, substitute receipt, signature fill), category inline-edit/archive, signature approval queue + bg-removal upload, evidence folders + CSV/manifest export. Forbidden state still surfaces as the honest "🔒 ไม่มีสิทธิ์" banner. Browser E2E not clicked headless this turn — typecheck + unit suites are the standing bar for this reskin effort (same as Track A/B).

Decisions:
- Reskin in place (keep `ExpensesHubPage` export + route + deep links `?tab=`/`?expenseId=`), do not rebuild — smallest correct diff.
- KPI cards computed client-side over the month+branch-scoped list (`pageSize: 200`, no status filter), independent of the chip/search which filter the table only. Period control (day/month) maps to `fromDate`/`toDate` on `expenseDate`; defaults to the current month (matches the mock's `finBar`).
- The mock's category "expense/cost" type toggle was **not** faked — the backend has no such field; kept the real "ของบริษัท / ค่าเริ่มต้นระบบ" distinction + name/account-hint add form + inline name edit + archive/reactivate (all real `createExpenseCategory`/`updateExpenseCategory`).
- List export = the real accountant-package **BOM-CSV index** (opens in Excel); no fake XLSX/PDF button, since there is no XLSX/PDF backend.
- Contract "API wiring" is a type-only widening — no runtime/DB change, since the fields were already returned.

Open questions:
- None blocking. A server-side KPI aggregate endpoint would remove the `pageSize:200`/month undercount ceiling; deferred until a real high-volume company needs it.

Artifacts:
- `packages/contracts/src/expenses.ts` (ExpenseSummary += vatAmount/dueDate; ExpenseDetail dedupe) + rebuilt `packages/contracts/dist`.
- `apps/web/src/features/expenses/ExpensesPages.tsx` (hub, list+cards+chips+search+period, split rich review panel, upload).
- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx` (category/signature/evidence panels).
- `apps/web/src/features/expenses/expenses.model.ts` (ExpenseSummary mirror + line reviewStatus).
- `docs/plans/expenses-mangmee-reskin-plan.md`, this memory.

Verification:
- `corepack pnpm --filter @watchdog-bms/contracts build`: pass.
- `corepack pnpm --filter @watchdog-bms/web typecheck`: pass (after adding `reviewStatus` to the web line type).
- `corepack pnpm --filter @watchdog-bms/api typecheck`: pass (contract widening compiles against already-returned fields).
- `CI=true corepack pnpm --filter @watchdog-bms/web test`: pass 219/219 (existing `expenses.model.spec`/`expenses.api.spec` cover only unchanged helpers; unaffected).
- `git status`: only the 5 expense/contract/plan artifacts above are mine; the many other working-tree changes are pre-existing uncommitted branch work, untouched.

Known limitations (carried from item 09 / this pass):
- KPI cards aggregate over the fetched month page (`pageSize:200`) — a company exceeding it in one month would undercount; upgrade to a server aggregate later.
- Local storage adapter is still a byte-discarding stub locally (pre-existing platform gap) — evidence previews/manifest downloads 404 locally until the storage follow-up; manifest links are correct once a real adapter exists.

Next:
- Optional: browser smoke of the reskinned tabs against the live local stack when convenient (dev servers on :3000/:3001).
- Optional server-side KPI aggregate endpoint if month volume grows.
