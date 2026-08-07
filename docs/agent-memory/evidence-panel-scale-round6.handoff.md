# Handoff: evidence-panel-scale-round6 (implementation spec)

Read `AGENTS.md` + `.agents/skills/ponytail/SKILL.md` for the working rules.

**Goal:** make `หลักฐานทางบัญชี` (`EvidencePanel`) behave correctly at scale — paginated table,
paginated folder list, and proper empty states.

**Scope: `apps/web` only.** Only these files may change:

- `apps/web/src/common/table/paging.logic.ts` (**new**) + `paging.logic.spec.ts` (**new**)
- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx`
- `apps/web/src/features/reimbursements/reimbursements.logic.ts` + its `.spec.ts` (helper move only — see A)
- `docs/agent-memory/evidence-panel-scale-round6.results.md` (your report)

No API, no Prisma, no `packages/contracts`, no new dependency.

## Context

`EvidencePanel` (`ExpensesWorkspacePanels.tsx`, around L477–L500) renders:
- a folder sidebar mapping **every** `view.folders` entry, with no height bound → grows without limit
- a 10-column table mapping **every** `visibleRows` entry, with no pagination
- empty states as a single grey line (`<td colSpan={10}>` / `<p>ไม่มีข้อมูล</p>`)

The queues in `การเบิกจ่าย` already solved paging; this page never got it.

---

## A. Share the paging helper — do not duplicate it

`pageBounds` and `QUEUE_PAGE_SIZE` already exist, tested, in
`apps/web/src/features/reimbursements/reimbursements.logic.ts`. Copying them into expenses would leave
two implementations of the same arithmetic.

**Move them to a shared module** `apps/web/src/common/table/paging.logic.ts`:

```ts
export const DEFAULT_PAGE_SIZE = 10;

/** Clamped slice bounds for a client-side paged list. `page` is 1-based. */
export function pageBounds(total: number, page: number, pageSize: number = DEFAULT_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return { totalPages, page: current, start, end, from: total === 0 ? 0 : start + 1, to: end };
}
```

Then in `reimbursements.logic.ts`: delete the local `pageBounds` and `QUEUE_PAGE_SIZE`, and re-export
or import from the shared module so **every existing call site keeps working unchanged**. Keep
`QUEUE_PAGE_SIZE` as a named export there if anything imports it, e.g.
`export { pageBounds } from '@/common/table/paging.logic'; export const QUEUE_PAGE_SIZE = DEFAULT_PAGE_SIZE;`
— whichever produces the smaller diff.

Move the existing `pageBounds` tests out of `reimbursements.logic.spec.ts` into
`paging.logic.spec.ts` (same assertions, unchanged). **The reimbursements suite must stay green** —
that is the proof the move was behaviour-preserving. Do not change any reimbursements component.

## B. Table pagination

In `EvidencePanel`:

```ts
const [page, setPage] = useState(1);
const bounds = useMemo(() => pageBounds(visibleRows.length, page), [visibleRows.length, page]);
const pagedRows = useMemo(() => visibleRows.slice(bounds.start, bounds.end), [visibleRows, bounds]);
useEffect(() => { setPage(1); }, [yearMonth, attentionOnly, view?.dateField]);
```

- The `<tbody>` maps **`pagedRows`**, not `visibleRows`.
- The empty-state row keeps keying off **`visibleRows.length === 0`** (the unfiltered-by-page count).
- Add a pager below the table, inside the same `MangmeeCard`, matching the wording already used in the
  reimbursement queues:

```tsx
{visibleRows.length > 0 && (
  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-gray-500">
    <div className="tabular-nums">แสดง {bounds.from}-{bounds.to} จาก {visibleRows.length} รายการ</div>
    {bounds.totalPages > 1 && (
      <div className="flex items-center gap-2">
        <button type="button" className={cx(ghostClass, '!min-h-9 !px-3 !py-1.5 !text-xs')}
          disabled={bounds.page <= 1} onClick={() => setPage(bounds.page - 1)}>ก่อนหน้า</button>
        <span className="tabular-nums rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">{bounds.page} / {bounds.totalPages}</span>
        <button type="button" className={cx(ghostClass, '!min-h-9 !px-3 !py-1.5 !text-xs')}
          disabled={bounds.page >= bounds.totalPages} onClick={() => setPage(bounds.page + 1)}>ถัดไป</button>
      </div>
    )}
  </div>
)}
```

**Pass `bounds.page`, never the raw `page` state**, to the buttons — `pageBounds` clamps, and using the
unclamped value would make "ถัดไป" jump from a stale page. Same reason the leading-`!` modifiers are
needed: `.mangmee-btn` in `globals.css` is unlayered and beats plain utilities.

`MangmeeCard` currently has `overflow-hidden`; keep it, and make sure the pager sits **outside** the
`overflow-x-auto` wrapper so it does not scroll horizontally with the table.

## C. Folder-list pagination

The folder sidebar must not grow without bound.

- Keep the `ทั้งหมด` button **always visible and never paginated** — it is the "clear filter" control.
- Paginate only `view.folders`, page size **12**, via the same `pageBounds` helper with its own state
  (`folderPage`).
- Render a compact pager under the list — the sidebar is only 220px wide, so use a minimal control:

```tsx
{folderBounds.totalPages > 1 && (
  <div className="flex items-center justify-between gap-2 px-1 pt-2 text-xs text-gray-500">
    <button type="button" className="rounded px-2 py-1 hover:bg-gray-100 disabled:opacity-40"
      disabled={folderBounds.page <= 1} onClick={() => setFolderPage(folderBounds.page - 1)}>‹</button>
    <span className="tabular-nums">{folderBounds.page} / {folderBounds.totalPages}</span>
    <button type="button" className="rounded px-2 py-1 hover:bg-gray-100 disabled:opacity-40"
      disabled={folderBounds.page >= folderBounds.totalPages} onClick={() => setFolderPage(folderBounds.page + 1)}>›</button>
  </div>
)}
```

Give each of those buttons an `aria-label` (`หน้าก่อนหน้า` / `หน้าถัดไป`) since the glyphs carry no text.

Reset `folderPage` to 1 when `view.dateField` changes (the folder set is rebuilt then). Do **not** reset
it when `yearMonth` changes — the user is selecting within the list they are looking at.

## D. Empty states

1. **Table** — replace the one-line grey `<td>` with the shared `EmptyState`
   (`@/common/components/state/EmptyState`, already used by the reimbursement queues). Keep
   `colSpan={10}` — the table has exactly 10 headers.

   ```tsx
   {visibleRows.length === 0 && (
     <tr><td colSpan={10}>
       <EmptyState
         title={attentionOnly ? 'ไม่มีรายการที่ต้องตรวจ' : 'ไม่มีรายการ'}
         description={attentionOnly ? 'ทุกรายการในช่วงนี้มีหลักฐานครบแล้ว' : 'ลองเลือกเดือนอื่น หรือปรับตัวกรองด้านบน'}
       />
     </td></tr>
   )}
   ```

2. **Folder list** — `EmptyState` is too tall (`py-16`) for a 220px sidebar. Keep it compact but make it
   read as a real state rather than stray text:

   ```tsx
   {view.folders.length === 0 && (
     <div className="px-2 py-6 text-center">
       <div className="text-gray-300">{ICON.folder}</div>
       <p className="mt-1 text-xs text-gray-400">ยังไม่มีเอกสารในช่วงนี้</p>
     </div>
   )}
   ```

   `ICON.folder` is already imported in this file.

## Constraints

- Shortest correct diff. No new dependency, no refactor of untouched code.
- **Do not change** any data fetching, `loadView`, the filters, `attentionOnly`, `deriveEvidenceRowFlags`,
  `evidenceRowState`, the export button, or any column/heading. Paging is a pure projection over
  `visibleRows` — it must not enter any fetch dependency array.
- Keep every Thai string hardcoded — no `t()` / `workspace-dictionary` in this feature.
- Do not weaken or delete existing tests.

## Verification (run these; record exact output in the report)

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/web lint
corepack pnpm --filter @watchdog-bms/web test
```

Tests:
1. `paging.logic.spec.ts` — the migrated `pageBounds` assertions, unchanged: empty list; exact multiple;
   partial last page; page above range clamps down; page below 1 clamps to 1.
2. The **reimbursements suite must still pass** — that proves the helper move changed no behaviour.

## Report back

Write `docs/agent-memory/evidence-panel-scale-round6.results.md` with:

- Files touched, one line each: what changed and why.
- Confirmation that `pageBounds` now has exactly **one** implementation, and that every previous
  reimbursements call site still resolves.
- Confirmation that the table body maps `pagedRows` while the empty state keys off `visibleRows.length`,
  and that `bounds.page` (not raw `page`) drives both pagers.
- Confirmation that no fetch/filter logic and no column changed.
- Verification commands with their **real** output. Do not claim a check you did not run.
- Anything you could not do, with the reason.
