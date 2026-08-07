# Handoff: expenses-table-polish-round5 (implementation spec)

Read `AGENTS.md` + `.agents/skills/ponytail/SKILL.md` for the working rules.

**Scope: the `ค่าใช้จ่าย + ใบเสร็จ` menu only.** Only these files may change:

- `apps/web/src/features/expenses/ExpensesPages.tsx`
- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx`
- `docs/agent-memory/expenses-table-polish-round5.results.md` (your report)

No API, no Prisma, no `packages/contracts`, no new dependency, no new component file.
**Do not touch `apps/web/app/globals.css`** — `.mangmee-table` is shared with other modules
(reimbursements, workflow) and must not change globally.

## The four tables under this menu

| # | Page | Component | Kind | Columns |
|---|---|---|---|---|
| 1 | รายการค่าใช้จ่าย | `ExpenseListPage` (`ExpensesPages.tsx`) | CSS-grid divs, `GRID` const | ผู้ขาย/หมวดหมู่ · วันที่/ช่องทาง · ยอดรวม · สถานะ |
| 2 | หมวดหมู่ | `CategoryManagePanel` (`ExpensesWorkspacePanels.tsx:115`) | `mangmee-table` | ชื่อหมวดหมู่ · ภาษีซื้อเริ่มต้น · ที่มา · เปิดใช้ · (actions) |
| 3 | ลายเซ็นบริษัท | `SignaturePanel` (`…:317`) | `mangmee-table` | ลายเซ็น · สถานะ · ช่องทาง · อนุมัติเมื่อ · (actions) |
| 4 | หลักฐานทางบัญชี | `EvidencePanel` (`…:488`) | `mangmee-table` | สถานะ · เลขที่ค่าใช้จ่าย · วันที่เอกสาร · ส่งเข้า · ประเภท · หลักฐานภาษี · ผู้ขาย · ยอดรวม · ไฟล์ · (actions) |

---

## A. Bigger column headers — all four tables

Target size: **13px**, up from 11px (table 1) and 12px (tables 2–4).

### A1. Table 1 (grid header, `ExpensesPages.tsx`)

The header row is a plain `div`, so a normal utility works. Change `text-[11px]` → `text-[13px]` in:

```tsx
<div className={cx(GRID, 'mt-3 border-b border-gray-100 px-2 pb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400')}>
```

Leave every other class alone.

### A2. Tables 2–4 (`mangmee-table`, `ExpensesWorkspacePanels.tsx`)

`globals.css` sets `.mangmee-table th { font-size: 0.75rem }` **outside any `@layer`**, so a plain
Tailwind `text-[13px]` loses the cascade. Use the leading-`!` important modifier — the same convention
already used elsewhere in this codebase and verified working on Tailwind 4.3.1:

**`!text-[13px]`**

All three headers are built by mapping over a string array with a computed `className`. Append the
class without disturbing the existing conditional, e.g. for table 2:

```tsx
<thead><tr>{['ชื่อหมวดหมู่', 'ภาษีซื้อเริ่มต้น', 'ที่มา', 'เปิดใช้', ''].map((h) => (
  <th key={h} className={cx('!text-[13px]', h === '' && 'text-right')}>{h}</th>
))}</tr></thead>
```

Apply the same shape to tables 3 and 4, preserving each one's own conditional (`h === ''` →
`text-right` for tables 2–3; `heading === 'ยอดรวม'` → `text-right` for table 4). `cx` is already
imported in this file.

---

## B. Search field — icon on the right, +20% width

Only **one** search box exists under this menu: `ExpensesPages.tsx`, in the chips row of
`ExpenseListPage`:

```tsx
<input className={cx(inputClass, 'max-w-64')} placeholder={t('expenses.search_placeholder', locale)} value={query} onChange={(e) => setQuery(e.target.value)} />
```

`max-w-64` = 16rem. **+20% = 19.2rem.** Replace with:

```tsx
<div className="relative w-full max-w-[19.2rem]">
  <input className={cx(inputClass, 'w-full pr-10')} type="search"
    placeholder={t('expenses.search_placeholder', locale)}
    value={query} onChange={(e) => setQuery(e.target.value)} />
  <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
    {ICON.search}
  </span>
</div>
```

- `ICON.search` **already exists** in `ExpensesUi.tsx` — do not add it again. `ICON` is already
  imported into `ExpensesPages.tsx`.
- `pointer-events-none` keeps the icon from stealing clicks; `pr-10` stops text running under it.
- The chips row uses `<div className="flex-1" />` as a spacer before the input — keep it, so the field
  still sits at the right end of the row.
- Do not change `query`, `setQuery`, or any filtering logic.

---

## C. Balanced data layout in tables 2–4

Table 1 was rebalanced already (its `GRID` now shares spare width across all four columns) — **do not
change `GRID`**.

Tables 2–4 are native `<table>`s with auto layout, so one long cell can starve the rest and the
trailing action column absorbs slack. Apply these rules to **both the `<th>` and the matching `<td>`**
so header and body stay aligned:

1. **Trailing action column** (the `''` heading in tables 2–3, and the `''` heading in table 4):
   add `w-px whitespace-nowrap` — `w-px` makes an auto-layout column shrink to its content instead of
   claiming leftover width. Keep the existing `text-right`.
2. **Date columns** — `อนุมัติเมื่อ` (table 3), `วันที่เอกสาร` (table 4): add `whitespace-nowrap`.
3. **Badge / short-enum columns** — `ที่มา`, `เปิดใช้` (table 2); `สถานะ`, `ช่องทาง` (table 3);
   `สถานะ`, `ส่งเข้า`, `ประเภท`, `หลักฐานภาษี` (table 4): add `whitespace-nowrap`.
4. **Money column** — `ยอดรวม` (table 4): ensure `text-right tabular-nums whitespace-nowrap`. It
   already has `text-right`; add the other two.
5. **Name / free-text columns** — `ชื่อหมวดหมู่`, `ลายเซ็น`, `ผู้ขาย`, `เลขที่ค่าใช้จ่าย`: leave
   unconstrained so they absorb the remaining width. That is the intended behaviour.
6. Ensure each of the three tables sits inside an `overflow-x-auto` wrapper. Table 4 has **10 columns**
   — if it lacks one, add it. Do not add a `min-w` track unless a wrapper is being added fresh; if you
   add one for table 4, use `min-w-[1100px]`.

Do not reorder, add, or remove any column. Do not change any cell's content or its data expression.

---

## Constraints

- Shortest correct diff. No new files, no new dependencies, no refactor of untouched code.
- Keep every Thai string exactly as it is.
- Do not change filtering, sorting, pagination, API calls, or any data logic.
- Do not weaken or delete existing tests.
- Do not edit `globals.css` or anything under `apps/web/src/features/reimbursements`.

## Verification (run these; record exact output in the report)

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/web lint
corepack pnpm --filter @watchdog-bms/web test
```

No new unit tests are required — this round is presentational only. Existing tests must stay green.

## Report back

Write `docs/agent-memory/expenses-table-polish-round5.results.md` with:

- Files touched, one line each: what changed and why.
- A table listing all four tables and the header size each now uses, confirming 13px everywhere.
- Confirmation that `globals.css` was **not** modified and that no reimbursements file was touched.
- Confirmation that no column was added, removed, or reordered, and no data expression changed.
- Verification commands with their **real** output. Do not claim a check you did not run.
- Anything you could not do, with the reason.
