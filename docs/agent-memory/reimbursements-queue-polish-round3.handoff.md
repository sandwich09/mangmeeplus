# Handoff: reimbursements-queue-polish-round3 (implementation spec)

Read `docs/agent-memory/reimbursements-queue-polish-round3.md` (decision record) first, and
`docs/agent-memory/reimbursements-ui-redesign.handoff.md` — its **THE HARD CONSTRAINT** and its 11
invariants still bind in full. Also `AGENTS.md` + `.agents/skills/ponytail/SKILL.md`.

**Scope: `apps/web` only.** Only these files may change:

- `apps/web/src/features/expenses/ExpensesUi.tsx` (the shared `StatCard` + one new icon)
- `apps/web/src/features/reimbursements/ReimbursementsPages.tsx`
- `apps/web/src/features/reimbursements/reimbursements.logic.ts` (+ its `.spec.ts`)
- `docs/agent-memory/reimbursements-queue-polish-round3.results.md` (your report)

No API, no Prisma, no `packages/contracts`, no new dependency, no new component file.

## Carried-over constraints

- No API call, payload, permission gate, validation rule, or action-visibility conditional may change
  behaviour. Every button that renders today under condition X must still render under condition X.
- All four `load` callbacks keep depending on `[companyId]` **only**. Search and paging are pure
  `useMemo` projections over loaded rows — they must never trigger a refetch.
- KPI cards keep summarising the **unfiltered** `data`, not the filtered/paged view.
- Row click still opens the drawer; every action button still calls `e.stopPropagation()`.
- Compact buttons in `ReimbursementsPages.tsx` keep the leading-`!` important modifier
  (`!min-h-9 !px-3 !py-1.5 !text-xs`) — `.mangmee-btn` in `globals.css` is unlayered and beats plain
  utilities. Verified on Tailwind 4.3.1; keep the convention.

---

## A. `StatCard`: icon left, value + unit right — shared primitive

In `apps/web/src/features/expenses/ExpensesUi.tsx`, replace the stacked body of `StatCard`
(currently icon on top, then value, then label, all left-aligned) with a horizontal row.

**Keep the exact same props** (`icon, label, value, sub, color, bg, danger`), the same `h-full`
wrapper, the same border/danger colours, and the same type sizes — only the arrangement changes:

```tsx
export function StatCard({ icon, label, value, sub, color, bg, danger }: { … }) {
  return (
    <div className="h-full">
      <div className="flex h-full items-center gap-3 rounded-2xl border bg-white p-4"
        style={{ borderColor: danger ? '#FECDCA' : 'var(--color-gray-200)' }}>
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: bg, color }}>{icon}</span>
        <div className="ml-auto min-w-0 text-right">
          <div className="text-[26px] font-extrabold leading-none tracking-tight tabular-nums"
            style={{ color: danger ? '#D92D20' : 'var(--color-gray-900)' }}>{value}</div>
          <div className="mt-2 text-sm font-semibold text-gray-700">{label}</div>
          {sub != null && <div className="mt-0.5 text-[12.5px] text-gray-400">{sub}</div>}
        </div>
      </div>
    </div>
  );
}
```

`ml-auto` + `text-right` is what pins the number/label block to the right edge while the icon stays
left. `min-w-0` lets long labels wrap instead of pushing the icon.

**This is a shared primitive.** The expenses list (`ExpensesPages.tsx:1544`, 5 cards) inherits the new
look — that is intended and requested. Do **not** add a variant prop or a feature flag; both features
get the same card. Do **not** touch `MangmeeStatCard` in `MangmeePage.tsx` — different component,
out of scope.

### A2. New icon

Add one entry to the `ICON` map in the same file, in the existing `mk('…')` style (1.9 stroke,
`|`-separated paths):

```ts
eye: mk('M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z|M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'),
```

---

## B. KPI row balance

In `ReimbursementsPages.tsx`, the grid's column count must match the number of cards rendered:

| Queue | Cards | Current | Change to |
|---|---|---|---|
| `MyRequests` (L503) | 4 | `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4` | **unchanged** — already correct |
| `ApprovalQueue` (L845) | 3 | `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4` | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` |
| `FinanceQueue` (L934) | 3 | `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4` | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` |

The dead 4th column is the whole cause of the "ไม่สมดุล" complaint. Do not add filler cards.

---

## C. Table columns

Apply to **all three** queue tables so they stay consistent.

### C1. Units belong in the cell, not the header

- `จำนวนรายการ`: header stays `จำนวนรายการ` and `text-right`; cell becomes
  `<td className="text-right tabular-nums text-gray-500">{r.lineCount ?? 1} รายการ</td>`.
- `อายุ (ชม.)` → header becomes **`อายุ`** with `className="text-right"`; cell becomes right-aligned
  with the unit on the value and the SLA badge beside it:

```tsx
<td className="text-right">
  <div className="flex flex-wrap items-center justify-end gap-2">
    <span className="tabular-nums">{r.ageHours} ชม.</span>
    {r.slaRisk && <MangmeeBadge tone="danger">เกิน SLA</MangmeeBadge>}
  </div>
</td>
```

Keep the `r.slaRisk` / `r.hasDuplicateBlocker` render conditions exactly as they are.

### C2. `การกระทำ` column

- Header gets `className="text-right"`.
- Cell: `<td className="text-right"><div className="flex items-center justify-end gap-2 whitespace-nowrap">…</div></td>`
  — `whitespace-nowrap` and dropping `flex-wrap` is what stops the buttons wrapping/clipping.
- **`ดู` becomes an icon-only button** at all three call sites (L546, L878, L966). Same handler, same
  `e.stopPropagation()`, same `onOpenDetail(r.id)`:

```tsx
<button type="button" aria-label="ดูรายละเอียด" title="ดูรายละเอียด"
  className={cx(ghostClass, '!min-h-9 !w-9 !px-0 !py-0')}
  onClick={e => { e.stopPropagation(); onOpenDetail(r.id); }}>
  <span className="[&>svg]:h-4 [&>svg]:w-4">{ICON.eye}</span>
</button>
```

`aria-label` **and** `title` are both required — the icon must stay reachable for screen readers and
discoverable on hover now that the word is gone. Import `ICON` is already in scope.

Leave `อนุมัติ` / `ปฏิเสธ` / `อนุมัติจ่าย` / `บันทึกจ่าย` / `ส่งอนุมัติ` / `ยกเลิก` as text buttons —
destructive and state-changing actions must not become unlabelled icons.

### C3. Horizontal scroll track

Each table's `overflow-x-auto` wrapper gets an inner `min-w-[980px]` track (same technique as the
expenses list), so narrow viewports scroll instead of crushing columns:

```tsx
<div className="mt-3 overflow-x-auto">
  <div className="min-w-[980px]">
    <table className="mangmee-table">…</table>
  </div>
</div>
```

---

## D. Universal search

### D1. Pure helper in `reimbursements.logic.ts`

```ts
/**
 * Universal row search: every term must appear somewhere in the row's displayed values.
 * Callers pass what the user can actually see (including resolved Thai status labels) —
 * not the raw record, so ids and snapshot hashes never produce phantom matches.
 */
export function matchesSearch(parts: readonly unknown[], query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = parts
    .filter((p) => p !== null && p !== undefined && p !== '')
    .map((p) => String(p))
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
```

Multi-term AND matching is deliberate: `RB-202607 อนุมัติ` should narrow, not widen.

### D2. Wire each queue to its displayed values

Replace each queue's current `filteredData` predicate. Pass exactly what that table renders, with
enum values resolved through the existing label maps so users can search the Thai text they see:

- **`MyRequests`** — `[r.requestNo, r.reason, r.categoryLabelSnapshot ?? r.categoryKey, r.lineCount ?? 1, r.amount, r.currency, REQUEST_STATUS_LABELS[r.status] ?? r.status, PAYMENT_STATUS_LABELS[r.paymentStatus] ?? r.paymentStatus]`
  — combined with the existing status-chip filter, which must keep working unchanged (chip filters
  first, then search).
- **`ApprovalQueue`** — `[r.requestNo, r.requesterDisplayNameSnapshot, r.reason, r.lineCount ?? 1, r.amount, r.currency, r.ageHours, r.slaRisk ? 'เกิน SLA' : '']`
- **`FinanceQueue`** — `[r.requestNo, r.requesterDisplayNameSnapshot, r.lineCount ?? 1, r.outstandingAmount, r.amount, r.currency, REQUEST_STATUS_LABELS[r.status] ?? r.status, FINANCE_REVIEW_LABELS[r.financeReviewStatus] ?? r.financeReviewStatus, r.hasDuplicateBlocker ? 'อาจซ้ำ' : '']`

### D3. Search field presentation

Replace the bare right-floated `max-w-64` input with a labelled search row above each table:

```tsx
<div className="flex flex-wrap items-center justify-between gap-3">
  <div className="text-sm text-gray-500 tabular-nums">
    {query.trim() ? `พบ ${filteredData.length} จาก ${data.length} รายการ` : `ทั้งหมด ${data.length} รายการ`}
  </div>
  <input className={cx(inputClass, 'w-full sm:max-w-80')} type="search"
    placeholder="ค้นหาทุกข้อมูลในตาราง เช่น เลขที่ ผู้ขอ จำนวนเงิน สถานะ"
    value={query} onChange={e => setQuery(e.target.value)} />
</div>
```

On `MyRequests` the chips row already exists — keep the chips where they are and put this
count + search row alongside them, not duplicated.

---

## E. Pagination on all three queues

### E1. Pure helper + shared pager

In `reimbursements.logic.ts`:

```ts
export const QUEUE_PAGE_SIZE = 10;

/** Clamped slice bounds for a client-side paged table. `page` is 1-based. */
export function pageBounds(total: number, page: number, pageSize: number = QUEUE_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return { totalPages, page: current, start, end, from: total === 0 ? 0 : start + 1, to: end };
}
```

In `ReimbursementsPages.tsx`, one local component reused by all three queues (same style as the
existing local `StatusBadge` / `RejectDialog`):

```tsx
function TablePager({ from, to, total, page, totalPages, onPage }: {
  from: number; to: number; total: number; page: number; totalPages: number; onPage: (p: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-4 text-sm text-gray-500">
      <div className="tabular-nums">แสดง {from}-{to} จาก {total} รายการ</div>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" className={cx(ghostClass, '!min-h-9 !px-3 !py-1.5 !text-xs')}
            disabled={page <= 1} onClick={() => onPage(page - 1)}>ก่อนหน้า</button>
          <span className="tabular-nums rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">{page} / {totalPages}</span>
          <button type="button" className={cx(ghostClass, '!min-h-9 !px-3 !py-1.5 !text-xs')}
            disabled={page >= totalPages} onClick={() => onPage(page + 1)}>ถัดไป</button>
        </div>
      )}
    </div>
  );
}
```

### E2. Per-queue wiring

Each queue gains `const [page, setPage] = useState(1)` and:

```tsx
const bounds = useMemo(() => pageBounds(filteredData.length, page), [filteredData.length, page]);
const pagedData = useMemo(() => filteredData.slice(bounds.start, bounds.end), [filteredData, bounds]);
useEffect(() => { setPage(1); }, [query]);              // and the status chip on MyRequests
```

- The table body maps **`pagedData`**, not `filteredData`.
- `<TablePager … />` goes inside the same `MangmeeCard`, directly after the scroll wrapper.
- The empty state still keys off `filteredData.length === 0` / `data.length === 0` — unchanged logic.
- `pageBounds` already clamps, so a shrinking list (e.g. after approving the last row on page 3)
  cannot strand the user on an empty page. Do **not** add a separate clamping effect.
- Reset to page 1 whenever the search query changes, and on `MyRequests` also when the chip changes.

---

## Constraints

- Shortest correct diff. No new files, no new dependencies, no refactor of untouched code.
- Keep every Thai string hardcoded — **no `t()` / `workspace-dictionary`** (round-1 decision D5).
- Do not weaken or delete existing tests.
- Do not change `MangmeeStatCard`.

## Verification (run these; record exact output in the report)

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/web lint
corepack pnpm --filter @watchdog-bms/web test
```

Add unit tests in `reimbursements.logic.spec.ts`:

1. `matchesSearch` — empty/whitespace query matches everything; single term matches case-insensitively;
   **multi-term requires all terms**; `null`/`undefined`/`''` parts are skipped without producing
   `"null"`/`"undefined"` text (assert that searching `"null"` against `[null, 'abc']` does **not** match);
   numeric parts are searchable (`123` matches `"12"`).
2. `pageBounds` — empty list → `{ totalPages: 1, page: 1, from: 0, to: 0 }`; exact multiple of the page
   size; a partial last page; `page` above `totalPages` clamps down; `page` below 1 clamps to 1.

## Report back

Write `docs/agent-memory/reimbursements-queue-polish-round3.results.md` with:

- Files touched, one line each: what changed and why.
- Explicit confirmation that (a) the API call inventory is unchanged, (b) every `load` callback still
  depends on `[companyId]` only, (c) KPI cards still read unfiltered `data`, and (d) no action button's
  render condition changed.
- A note that the expenses list KPI row inherits the new `StatCard` layout (expected, per decision D1).
- Verification commands with their **real** output. Do not claim a check you did not run.
- Anything you could not do, with the reason.
