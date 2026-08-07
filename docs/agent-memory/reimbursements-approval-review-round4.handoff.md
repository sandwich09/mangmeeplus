# Handoff: reimbursements-approval-review-round4 (implementation spec)

Read `docs/agent-memory/reimbursements-approval-review-round4.md` (decision record) first, and
`docs/agent-memory/reimbursements-ui-redesign.handoff.md` — its **THE HARD CONSTRAINT** and its 11
invariants still bind. Also `AGENTS.md` + `.agents/skills/ponytail/SKILL.md`.

**Scope: `apps/web` only.** Only these files may change:

- `apps/web/src/features/reimbursements/ReimbursementsPages.tsx`
- `apps/web/src/features/reimbursements/reimbursements.logic.ts` (+ its `.spec.ts`)
- `apps/web/src/features/expenses/ExpensesUi.tsx` (one new icon only)
- `docs/agent-memory/reimbursements-approval-review-round4.results.md` (your report)

No API, no Prisma, no `packages/contracts`, no new dependency, no new component file.

## Carried-over constraints

- No API call, payload, permission gate, validation rule, or action-visibility conditional may change
  behaviour. Section A adds a **recovery** path after a 409; the success path must be untouched.
- `load` callbacks keep depending on `[companyId]` only. Search/paging stay pure `useMemo`.
- KPI cards keep summarising unfiltered `data`.
- Compact buttons keep the leading-`!` important modifier (`.mangmee-btn` is unlayered).

---

## A. Stale-approval review dialog

### A1. Detect the raw code, not the translated text

`err()` translates through `ERROR_CODE_LABELS`, so the code is gone by the time it reaches state. Add a
pure predicate in `reimbursements.logic.ts`:

```ts
export const STALE_APPROVAL_CODE = 'stale_approval_snapshot';

/** True when the API rejected an approval because the claim changed after submit (HTTP 409). */
export function isStaleApprovalError(e: unknown): boolean {
  return e instanceof Error && e.message.includes(STALE_APPROVAL_CODE);
}
```

The API sends the bare code (`ConflictException('stale_approval_snapshot')`), and `errorMessage()`
splits on commas, so `includes` is the right test — do not use strict equality.

### A2. Field diff helper (pure, tested)

```ts
export type ApprovalFieldDiff = { key: string; label: string; before: string; after: string; changed: boolean };

/** Values the approval-queue row and the fresh detail can both provide. */
export type ApprovalComparable = {
  reason?: unknown; amount?: unknown; currency?: unknown; categoryLabel?: unknown; lineCount?: unknown;
};

/**
 * Compares what the approver was looking at against the claim's current state.
 * Only covers the fields the queue row carries — see the decision record: a line-text or
 * date-only edit changes the server hash without changing any of these.
 */
export function diffApprovalFields(before: ApprovalComparable, after: ApprovalComparable): ApprovalFieldDiff[] {
  const rows: Array<{ key: keyof ApprovalComparable; label: string }> = [
    { key: 'reason', label: 'เหตุผล' },
    { key: 'amount', label: 'จำนวนเงิน' },
    { key: 'currency', label: 'สกุลเงิน' },
    { key: 'categoryLabel', label: 'หมวด' },
    { key: 'lineCount', label: 'จำนวนรายการ' },
  ];
  return rows.map(({ key, label }) => {
    const b = before[key] == null || before[key] === '' ? '—' : String(before[key]);
    const a = after[key] == null || after[key] === '' ? '—' : String(after[key]);
    return { key: String(key), label, before: b, after: a, changed: b !== a };
  });
}
```

### A3. The dialog

A local component in `ReimbursementsPages.tsx`, built on the shared `Modal` (`size="lg"`,
`closeLabel="ปิด"` — the ✕ is built in). Props: `{ requestNo, diff, lines, currency, busy, error, onClose, onConfirm }`.

Body, in order:

1. **Warning banner** — reuse the existing `ErrorBanner` styling family; text:
   `คำขอนี้ถูกแก้ไขหลังจากส่งอนุมัติ กรุณาตรวจสอบข้อมูลล่าสุดก่อนตัดสินใจ`
2. **Comparison table** — `mangmee-table`, columns `ข้อมูล | ก่อนหน้า | ปัจจุบัน`. For each
   `ApprovalFieldDiff`:
   - changed → row `className="bg-warning-50"`, the `after` cell `font-bold text-gray-900`, and a
     `<MangmeeBadge tone="amber">แก้ไขแล้ว</MangmeeBadge>` next to it; the `before` cell
     `text-gray-400 line-through`.
   - unchanged → plain row, `text-gray-500`.
3. **When `diff.every(d => !d.changed)`** — instead of a silently-identical table, render an
   `InfoBanner`-style note:
   `ระบบตรวจพบว่าคำขอถูกแก้ไข แต่ระบุจุดที่เปลี่ยนจากข้อมูลในคิวไม่ได้ (เช่น แก้ไขรายละเอียดรายการหรือวันที่) กรุณาตรวจรายการทั้งหมดด้านล่าง`
   This is required — an empty diff must never read as "nothing changed".
4. **Current line breakdown** — always rendered, `mangmee-table` with
   `#, วันที่, รายการ, หมวด, จำนวนเงิน`, mirroring the drawer's lines table (reuse `shortDate`,
   `formatMoney`, `categoryLabelSnapshot ?? categoryKey`), plus a total row.
5. `{error && <ErrorBanner message={error} />}`

`footer`:
- `ยกเลิก` → `ghostClass`, calls `onClose`
- `อนุมัติด้วยข้อมูลล่าสุด` → `successBtn` + `style={successBtnStyle}`, `disabled={busy}`, calls `onConfirm`

### A4. Wiring — approval queue row

In `ApprovalQueue`, the approve button currently runs through `action(...)`. It needs its own handler so
the 409 can be intercepted **without** changing the generic `action` helper:

```tsx
const [staleReview, setStaleReview] = useState<{ row: any; detail: any } | null>(null);

const approveRow = async (r: any) => {
  setBusy(r.id); setError(null);
  try {
    await approveReimbursement(companyId, r.id, undefined, r.approvalSnapshotHash);
    await load();
  } catch (e) {
    if (isStaleApprovalError(e)) {
      try {
        setStaleReview({ row: r, detail: await getReimbursement(companyId, r.id) });
      } catch (e2) { setError(err(e2)); }
    } else { setError(err(e)); }
  } finally { setBusy(null); }
};
```

`getReimbursement` is already imported. The success path (`approve` → `load()`) is byte-for-byte what
`action` did — only the catch branch is new.

Build the dialog's inputs from the two objects:

```ts
diffApprovalFields(
  { reason: row.reason, amount: formatMoney(row.amount), currency: row.currency,
    categoryLabel: row.categoryLabelSnapshot ?? row.categoryKey, lineCount: row.lineCount ?? 1 },
  { reason: detail.reason, amount: formatMoney(detail.amount), currency: detail.currency,
    categoryLabel: detail.categoryLabelSnapshot ?? detail.categoryKey, lineCount: (detail.lines ?? []).length },
)
```

Format the amounts through `formatMoney` **before** diffing so `"123"` and `"123.00"` do not read as a
change.

`onConfirm` re-approves with the **fresh** hash, then closes and reloads:

```tsx
onConfirm={async () => {
  setBusy(staleReview.row.id); setError(null);
  try {
    await approveReimbursement(companyId, staleReview.row.id, undefined, staleReview.detail.approvalSnapshotHash);
    setStaleReview(null);
    await load();
  } catch (e) { setError(err(e)); }
  finally { setBusy(null); }
}}
```

Render `<StaleApprovalDialog>` as a **sibling** of the table, next to the existing `RejectDialog`.

### A5. Wiring — detail popup

`DetailDrawer`'s `onApprove` goes through the hub's `drawerAction`. Apply the same interception at hub
level: on `isStaleApprovalError`, refetch the detail and open the same dialog, comparing the
**previous** `detail` in state against the fresh one (same `ApprovalComparable` shape, using
`(d.lines ?? []).length`). Confirm re-approves with the fresh hash, then `setDetail(fresh)` and bump
`refreshKey`. Keep `drawerAction` itself unchanged for every other action — add a dedicated
`approveFromDrawer` handler rather than adding branching inside `drawerAction`.

---

## B. Detail popup: centred, ✕ close

Convert `DetailDrawer`'s shell from the right-side drawer to the shared `Modal`.

**Delete** the bespoke shell: the `fixed inset-x-0 bottom-0 top-[68px] z-50 flex justify-end bg-black/30`
backdrop, the `onClick={onClose}` backdrop handler, the inner `w-full max-w-3xl overflow-y-auto`
container with its `e.stopPropagation()`, the sticky internal header, and the sticky action footer.

Replace with:

```tsx
<Modal
  open
  size="xl"
  closeLabel="ปิด"
  onClose={onClose}
  title={<div className="flex flex-wrap items-center gap-2">
    <span>รายละเอียดคำขอ {detail.requestNo ?? ''}</span>
    <StatusBadge status={detail.status} />
    <PaymentBadge status={detail.paymentStatus} />
  </div>}
  footer={footerButtons}
>
  …existing body sections, unchanged…
</Modal>
```

- `Modal` supplies centring, the ✕ button, focus trap, Escape, and a scrolling body — so **remove the
  old text `ปิด` button** from the header.
- `พิมพ์ใบเบิก` moves into the footer (it no longer has a header slot). Keep its
  `detail.requestNo &&` condition exactly.
- `footerButtons` is the **same** button set under the **same** conditions as the current sticky bar
  (`isDraft && context === 'mine'` → ส่งอนุมัติ + ยกเลิกคำขอ; `canApprove` → อนุมัติ + ปฏิเสธ;
  `canFinanceApprove` → อนุมัติจ่าย; `canPay` → บันทึกจ่าย), plus พิมพ์ใบเบิก. Pass `undefined` when
  nothing qualifies so no empty footer bar renders.
- **Remove the hub's document-level Escape effect** for the drawer (`useEffect` guarding on
  `detail && !claimForm && !payFor && !signFor && !rejecting`). `Modal` owns Escape now, and the
  sibling dialogs each own theirs. This retires round-1 invariant #3 by making it structural — say so
  explicitly in your report.
- `claimForm`, `signFor`, `payFor`, `rejecting`, and the new stale dialog **stay siblings** of the
  detail modal in the hub's JSX. Do not nest them.
- Round-1 invariant #5 (`top-[68px]`) is retired: `Modal` portals to `document.body` at `z-[99999]`,
  which already renders above the app header — the same mechanism `SignatureModal` and `PaymentModal`
  rely on today. Confirm this in your report.

Everything inside the body — the hero card, ข้อมูลคำขอ grid, lines table, signatures, signed copies,
approval steps, payments — keeps its current markup and conditions.

---

## C. Centred table headers

In all three queue tables, every `<th>` gets `className="text-center"`.

`.mangmee-table th` has `text-align: left` in `globals.css`, and there is a
`.mangmee-table th.text-right` override but **no** `.text-center` one — Tailwind's `text-center`
utility is layered and would lose to the unlayered element rule. Use the same important-modifier
convention already established in this file: **`className="!text-center"`**.

Where a `<th>` currently carries `text-right`, replace it with `!text-center` — the header centres while
the **cells keep their existing alignment** (money/counts right, text left). Do not change any `<td>`.

Columns affected (approval queue shown; apply the same to the other two tables):
`เลขที่ · ผู้ขอ · เหตุผล · จำนวนรายการ · จำนวน · อายุ · การกระทำ`

---

## D. Search field: icon right, +20% width

Currently `cx(inputClass, 'w-full sm:max-w-80')`. `max-w-80` is 20rem; +20% → 24rem = **`sm:max-w-96`**.

Add a magnifier to the `ICON` map in `ExpensesUi.tsx`, same `mk('…')` style:

```ts
search: mk('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z|M21 21l-4.3-4.3'),
```

Wrap each queue's search input so the icon sits inside the field on the right:

```tsx
<div className="relative w-full sm:max-w-96">
  <input className={cx(inputClass, 'w-full pr-10')} type="search"
    placeholder="ค้นหาทุกข้อมูลในตาราง เช่น เลขที่ ผู้ขอ จำนวนเงิน สถานะ"
    value={query} onChange={e => setQuery(e.target.value)} />
  <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
    {ICON.search}
  </span>
</div>
```

`pointer-events-none` keeps the icon from stealing clicks from the field; `pr-10` stops the text running
under it. Apply to all three queues so they stay consistent.

---

## Constraints

- Shortest correct diff. No new files, no new dependencies, no refactor of untouched code.
- Keep every Thai string hardcoded — no `t()` / `workspace-dictionary`.
- Do not weaken or delete existing tests.
- Do not change `MangmeeStatCard` or the `Modal` component itself.

## Verification (run these; record exact output in the report)

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/web lint
corepack pnpm --filter @watchdog-bms/web test
```

Add unit tests in `reimbursements.logic.spec.ts`:

1. `isStaleApprovalError` — `new Error('stale_approval_snapshot')` → true; a comma-joined message
   containing the code → true; an unrelated `Error` → false; a non-Error value (string, `null`,
   `undefined`) → false without throwing.
2. `diffApprovalFields` — identical inputs → every row `changed: false`; a changed amount → only that
   row `changed: true` with the right `before`/`after`; `null`/`undefined`/`''` render as `—` on both
   sides and count as **unchanged**; a value appearing only on the `after` side is `changed: true`
   with `before === '—'`.

## Report back

Write `docs/agent-memory/reimbursements-approval-review-round4.results.md` with:

- Files touched, one line each: what changed and why.
- Explicit confirmation that: the API call inventory is unchanged (the stale path reuses
  `approveReimbursement` + `getReimbursement`, both already imported); the approve **success** path is
  unchanged; every action button's render condition is unchanged; `load` deps are still `[companyId]`.
- A statement on round-1 invariants **#3 (Escape)** and **#5 (`top-[68px]`)**: both are now satisfied
  structurally by `Modal` rather than by hand-written code — explain how, and confirm the sibling
  layering of `claimForm` / `signFor` / `payFor` / `rejecting` / stale-review is intact.
- Confirmation that an all-unchanged diff renders the explicit "cannot pinpoint the change" note
  (A3 item 3) rather than an empty table.
- Verification commands with their **real** output. Do not claim a check you did not run.
- Anything you could not do, with the reason.
