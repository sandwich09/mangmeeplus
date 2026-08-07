# Handoff: reimbursements-ui-redesign (implementation spec)

Read `docs/agent-memory/reimbursements-ui-redesign.md` first for the decision record, and
`AGENTS.md` + `.agents/skills/ponytail/SKILL.md` for the working rules.

**Scope: `apps/web` only.** Only these files may change:

- `apps/web/src/features/reimbursements/ReimbursementsPages.tsx` (the whole page)
- `apps/web/src/features/reimbursements/reimbursements.model.ts` (label/tone maps)
- `apps/web/src/features/reimbursements/reimbursements.logic.ts` (one new pure helper)
- their co-located `*.spec.ts` files (add tests, delete none)
- `docs/agent-memory/reimbursements-ui-redesign.results.md` (your report)

No API, no Prisma, no `packages/contracts`, no new dependency, no new component file.

## THE HARD CONSTRAINT

**This is a visual/UX redesign of a flow the user has already tested end to end. The flow must behave
exactly as it does today.** Do not change any API call, payload, permission gate, state transition,
validation rule, or conditional that decides which action is offered. If a change you want to make
would alter behaviour, don't make it — note it in the report instead.

Specifically, these must survive byte-for-byte in behaviour:

1. `visibleHubTabs(permissions)`, `parseHubTab`, and the "initial tab only" comment/rule — later tab
   clicks must still not be fought by the URL.
2. `?focus=<requestId>` opening the drawer via `openDetail`.
3. The drawer's Escape handler firing **only** when `detail && !claimForm && !payFor && !signFor`.
4. `claimForm`, `signFor`, `payFor` staying **siblings** of `<DetailDrawer>` in the tree, never
   children — closing one must not close the claim behind it.
5. The drawer starting below the sticky app header (`top-[68px]`), not `inset-0`.
6. `drawerAction(fn)` → run, re-`getReimbursement`, bump `refreshKey`; and each queue's
   `useEffect(() => { load(); }, [load, refreshKey])`.
7. Every `approvalSnapshotHash` / `claimSignatureAckHash` argument still passed from the same source.
8. `isDraft`, `canApprove`, `canFinanceApprove`, `canPay`, `signableRoles`, `canAttachSignedCopy` —
   same expressions, same effect on which buttons render.
9. `handleCreate`'s partial-failure branch (draft created, attachment upload failed → close form,
   reload, show `บันทึกร่างแล้ว แต่แนบไฟล์ไม่สำเร็จ: …`).
10. `validateRequestForm` / `validatePaymentForm` called at the same points with the same inputs.
11. The zero-tabs guard (`tabs.length === 0`) still short-circuits before any queue renders.

---

## A. Shared primitives — reuse, do not re-create

Import the มั่งมี kit instead of the local hand-rolled classes:

```ts
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { LoadingState } from '@/common/components/state/LoadingState';
import { EmptyState } from '@/common/components/state/EmptyState';
import {
  baht0, ICON, KPI, StatCard, ErrorBanner, InfoBanner,
  inputClass, btnClass, ghostClass, dangerClass, successBtn, successBtnStyle,
} from '../expenses/ExpensesUi';
```

Cross-feature import from `../expenses/*` is already established in this feature
(`removeLightBackground`, `getAttachmentDownloadUrl`, `resolveUploadUrl`) — follow that precedent
rather than adding a `ReimbursementsUi.tsx`.

Then **delete** the local `inputClass` / `btnClass` / `ghostClass` / `greenClass` / `dangerClass`
constants (L27–31) and the local `ErrorBanner` (L49–51). `greenClass` → `successBtn` +
`style={successBtnStyle}` (that is how expenses renders its green confirm action).

Keep the local `err()` helper as-is — it routes through `errorMessage()` and is not the expenses one.

**Money:** table and drawer cells keep today's `formatMoney(x) {currency}` exactly. Only the new KPI
cards use `baht0()`. Do not restyle money anywhere else.

## B. Status tones — replace the bespoke colour map

In `reimbursements.model.ts`:

- **Delete** `STATUS_BADGE_COLORS` (L37–48). Its only consumer is this page's `StatusBadge`; nothing
  else imports it and no test covers it. (The identically-named export in `features/workflow/` is a
  different map — leave it alone.)
- Add, typed as `Record<string, MangmeeTone>` (import the type from `@/common/components/mangmee`):

```ts
export const REQUEST_STATUS_TONES = {
  DRAFT: 'slate', PENDING_APPROVAL: 'amber', APPROVED: 'sky', REJECTED: 'danger',
  CANCELLED: 'slate', FINANCE_REVIEW: 'purple', READY_FOR_PAYMENT: 'teal',
  PARTIALLY_PAID: 'amber', PAID: 'brand', VOIDED: 'danger',
} satisfies Record<string, MangmeeTone>;

export const PAYMENT_STATUS_TONES = {
  NOT_PAYABLE: 'slate', UNPAID: 'danger', PARTIALLY_PAID: 'amber', PAID: 'brand', VOIDED: 'danger',
} satisfies Record<string, MangmeeTone>;
```

- Add label maps so no raw enum ever reaches the user. Values are exactly the Prisma enums —
  do not invent extra keys:

```ts
export const RECEIPT_REQUIREMENT_LABELS: Record<string, string> = {
  REQUIRED: 'ต้องแนบใบเสร็จ',
  ATTACHED: 'แนบใบเสร็จแล้ว',
  MISSING_WITH_REASON: 'ไม่มีใบเสร็จ (ระบุเหตุผลแล้ว)',
  WAIVED_BY_POLICY: 'ยกเว้นตามนโยบาย',
};
export const DUPLICATE_STATUS_LABELS: Record<string, string> = {
  NOT_CHECKED: 'ยังไม่ตรวจรายการซ้ำ',
  NO_MATCH: 'ไม่พบรายการซ้ำ',
  POSSIBLE_DUPLICATE: 'อาจเป็นรายการซ้ำ ต้องตรวจสอบ',
  CONFIRMED_DUPLICATE: 'ยืนยันว่าเป็นรายการซ้ำ',
  OVERRIDDEN: 'ตรวจแล้วไม่ซ้ำ',
};
export const APPROVAL_STEP_STATUS_LABELS: Record<string, string> = {
  PENDING: 'รอตัดสิน', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ปฏิเสธ',
  CANCELLED: 'ยกเลิก', SKIPPED: 'ข้ามขั้น', EXPIRED: 'หมดเวลา',
};
```

In the page, `StatusBadge` becomes a `MangmeeBadge`:

```tsx
function StatusBadge({ status }: { status: string }) {
  return <MangmeeBadge tone={REQUEST_STATUS_TONES[status] ?? 'slate'}>{REQUEST_STATUS_LABELS[status] ?? status}</MangmeeBadge>;
}
function PaymentBadge({ status }: { status: string }) {
  return <MangmeeBadge tone={PAYMENT_STATUS_TONES[status] ?? 'slate'}>{PAYMENT_STATUS_LABELS[status] ?? status}</MangmeeBadge>;
}
```

Use `PaymentBadge` where `PAYMENT_STATUS_LABELS[...]` is currently rendered as bare grey text
(`MyRequests` การจ่าย column, drawer การจ่าย row).

## C. Page shell

Replace the `<div className="space-y-6 p-6">` + `<h1>` + underline tab bar with `MangmeePage`:

```tsx
<MangmeePage
  eyebrow="การเบิกจ่าย"
  title="การเบิกจ่ายและอนุมัติ"
  description={HUB_TAB_DESCRIPTIONS[tab]}
  actions={<div className="mangmee-segmented">…tabs…</div>}
>
```

- Drop the `p-6` wrapper — `MangmeePage` owns page padding and the 1.25rem gap.
- Delete the `Reimbursement Approval and Review` English subtitle; the Thai description replaces it.
- Tabs become `<button className={cx('mangmee-tab', tab === t && 'mangmee-tab-active')}>` inside one
  `<div className="mangmee-segmented">`. Keep `tabs.map` over `visibleHubTabs` and `HUB_TAB_LABELS`
  untouched.
- Add a description per tab (plain Thai, one line, tells the user what this queue is for):

```ts
const HUB_TAB_DESCRIPTIONS: Record<HubTab, string> = {
  mine: 'สร้างคำขอเบิกค่าใช้จ่ายของคุณ ติดตามสถานะ และส่งให้ผู้อนุมัติ',
  approvals: 'ตรวจคำขอที่รอคุณอนุมัติ ดูรายการและใบเสร็จก่อนตัดสินใจ',
  finance: 'ตรวจสอบคำขอที่อนุมัติแล้ว และบันทึกการจ่ายเงิน',
  policy: 'กำหนดเกณฑ์การอนุมัติ ใบเสร็จ และ SLA ของการเบิกจ่ายทั้งบริษัท',
};
```

- The zero-tabs guard keeps its own early return, but render it as
  `<MangmeePage …><MangmeeCard className="p-6"><EmptyState title="ไม่มีสิทธิ์เข้าถึง" description="บัญชีนี้ยังไม่มีสิทธิ์ใช้งานหน้าการเบิกจ่าย" /></MangmeeCard></MangmeePage>`
  so a permission-less user still gets the app's chrome. Keep the guard **before** `queueProps`.

## D. Queue summary cards (KPI)

Add one pure helper to `reimbursements.logic.ts` — this is the piece that gets a unit test:

```ts
export type QueueSummary = { count: number; totalAmount: number; outstandingAmount: number; flagged: number };

/**
 * Rollup of a loaded queue for the summary cards. Display only — the server owns the real numbers.
 * `flagged` counts rows the queue wants to draw attention to (SLA risk or a duplicate blocker).
 */
export function summariseQueue(rows: readonly any[]): QueueSummary {
  return (rows ?? []).reduce((acc, r) => ({
    count: acc.count + 1,
    totalAmount: acc.totalAmount + (Number(r?.amount) || 0),
    outstandingAmount: acc.outstandingAmount + (Number(r?.outstandingAmount) || 0),
    flagged: acc.flagged + (r?.slaRisk || r?.hasDuplicateBlocker ? 1 : 0),
  }), { count: 0, totalAmount: 0, outstandingAmount: 0, flagged: 0 });
}
```

Render a `grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4` of `StatCard`s above each queue's
table (`StatCard` takes `{ icon, label, value, sub, color, bg, danger? }`; spread `...KPI.amber` etc.):

- **`MyRequests`** — คำขอทั้งหมด (`ICON.doc`, `KPI.sky`, sub = จำนวนใบ) · ร่างรอส่ง (count of
  `status === 'DRAFT'`, `ICON.edit`, `KPI.amber`) · รออนุมัติ/ตรวจสอบ (count of status in
  `PENDING_APPROVAL, APPROVED, FINANCE_REVIEW, READY_FOR_PAYMENT`, `ICON.clock`, `KPI.purple`) ·
  ยอดรวมที่ขอเบิก (`baht0(totalAmount)`, `ICON.wallet`, `KPI.brand`).
- **`ApprovalQueue`** — รอคุณอนุมัติ (`count`, `ICON.clock`, `KPI.amber`) · ยอดรวมที่รออนุมัติ
  (`baht0(totalAmount)`, `ICON.wallet`, `KPI.purple`) · เกิน SLA (`flagged`, `ICON.alert`,
  `KPI.danger`, `danger: flagged > 0`).
- **`FinanceQueue`** — รอตรวจ/รอจ่าย (`count`, `ICON.clock`, `KPI.sky`) · ยอดคงค้างรวม
  (`baht0(outstandingAmount)`, `ICON.wallet`, `KPI.purple`) · พบรายการที่อาจซ้ำ (`flagged`,
  `ICON.alert`, `KPI.danger`, `danger: flagged > 0`).

Compute with `useMemo` over the already-loaded `data`. **No new API call.** Hide the KPI row while
`loading` is true (render the skeleton in its place, see F).

## E. Filters and search

Add above each queue's table, inside the same `MangmeeCard`, using the expenses chip pattern
(`ExpensesPages.tsx` L1563–1574 — copy the class strings so they match exactly):

- **`MyRequests`** — chips `ทั้งหมด / ร่าง / รออนุมัติ / อนุมัติแล้ว / จ่ายแล้ว` with counts, mapping to
  `all` · `DRAFT` · `PENDING_APPROVAL` · `APPROVED, FINANCE_REVIEW, READY_FOR_PAYMENT` · `PAID`,
  plus a search box.
- **`ApprovalQueue`** / **`FinanceQueue`** — search box only (no chips; these queues are already
  status-scoped by the server).

Search matches case-insensitively against `requestNo`, `reason`, and
`requesterDisplayNameSnapshot`, joined. Filtering is **client-side over already-loaded rows** — do not
add a query param, do not re-fetch. Keep the KPI cards reading the **unfiltered** `data` (they
describe the queue, not the filter).

Placeholder: `ค้นหาเลขที่ ผู้ขอ หรือเหตุผล`.

## F. Table treatment (all three queues)

1. Wrap each table in `<MangmeeCard className="p-4">`; drop the `rounded border border-gray-200`
   wrapper. Keep an inner `<div className="overflow-x-auto">`.
2. Swap the hand-rolled `<thead>`/`<td>` classes for `className="mangmee-table"` on the `<table>` and
   let the CSS own padding/borders/hover. Right-aligned money and count columns use `className="text-right"`
   on both `<th>` and `<td>` (`.mangmee-table` already handles that pair).
3. `loading` → `<LoadingState label="กำลังโหลด..." />` instead of the plain text line.
4. Empty → `<EmptyState title="…" description="…" />` in place of the `colSpan` grey row:
   - MyRequests: `ยังไม่มีคำขอเบิก` / `กด "สร้างคำขอเบิก" เพื่อเริ่มคำขอแรกของคุณ`
   - ApprovalQueue: `ไม่มีรายการรออนุมัติ` / `คำขอที่รอคุณอนุมัติจะแสดงที่นี่`
   - FinanceQueue: `ไม่มีรายการรอการเงิน` / `คำขอที่ผ่านการอนุมัติแล้วจะแสดงที่นี่`
   - When a filter/search hides everything but `data` is non-empty, show
     `ไม่พบรายการที่ตรงกับตัวกรอง` / `ลองล้างคำค้นหรือเลือกสถานะอื่น` instead.
5. Make the whole row open the drawer: `onClick={() => onOpenDetail(r.id)}` + `cursor-pointer` on
   `<tr>`, and `e.stopPropagation()` on the action-cell buttons so approve/reject/pay are not
   swallowed. **Keep the `ดู` button** — it is the keyboard-reachable path and part of the tested flow.
6. Action cell: `<div className="flex flex-wrap justify-end gap-2">`, and give the buttons a compact
   size with `cx(ghostClass, 'min-h-9 px-3 py-1.5 text-xs')` (same for `successBtn` / `dangerClass` /
   `btnClass`) so three actions fit without wrapping the row.
7. SLA / duplicate warnings: replace the bare `⚠` spans with
   `<MangmeeBadge tone="danger">เกิน SLA</MangmeeBadge>` and
   `<MangmeeBadge tone="amber">อาจซ้ำ</MangmeeBadge>`. Keep the same render conditions
   (`r.slaRisk`, `r.hasDuplicateBlocker`).
8. `เลขที่` cell keeps `font-mono text-xs`; add `tabular-nums` to money cells.

## G. Reject dialog — replace `window.prompt`

Add one small component in this file and use it at **both** call sites (`ApprovalQueue` row action and
`DetailDrawer` footer). Reuse the existing `Modal`:

```tsx
function RejectDialog({ requestNo, busy, onClose, onConfirm }: {
  requestNo?: string; busy?: boolean; onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  return (
    <Modal open title={`ปฏิเสธคำขอ ${requestNo ?? ''}`.trim()} size="sm" closeLabel="ยกเลิก" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-500">ระบุเหตุผลที่ปฏิเสธ ผู้ขอจะเห็นข้อความนี้</p>
        <textarea className={cx(inputClass, 'min-h-24 resize-y')} autoFocus value={reason}
          onChange={e => setReason(e.target.value)} placeholder="เช่น ยอดไม่ตรงกับใบเสร็จ" />
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostClass} onClick={onClose}>ยกเลิก</button>
          <button type="button" className={dangerClass} disabled={busy || !trimmed}
            onClick={() => onConfirm(trimmed)}>ปฏิเสธคำขอ</button>
        </div>
      </div>
    </Modal>
  );
}
```

- Behaviour parity: `rejectReimbursement` is called with the **trimmed non-empty** reason and nothing
  else changes. The disabled-until-non-empty button is the replacement for
  `if (reason && reason.trim())`.
- `ApprovalQueue` holds `const [rejectFor, setRejectFor] = useState<any | null>(null)`; the row's
  ปฏิเสธ button sets it; `onConfirm` runs the existing
  `action(r.id, () => rejectReimbursement(companyId, r.id, reason))` then clears it.
- `DetailDrawer` holds its own `const [rejecting, setRejecting] = useState(false)` and calls the
  existing `onReject(reason)` prop. **Do not change `DetailDrawer`'s props.**
- Render the drawer's dialog inside the drawer's own subtree is fine (it is a portal), but it must not
  interfere with the hub's Escape rule — the hub's Escape effect keys off `detail/claimForm/payFor/signFor`
  only, so while `rejecting` is true **both** the Modal's Escape and the drawer's Escape would fire.
  Fix by adding `rejecting` to nothing at hub level; instead stop the propagation at the Modal: the
  `Modal` already calls `onClose` on Escape via `trapFocus`, and the drawer's listener is on `document`.
  **Simplest correct fix: lift `rejecting` to the hub** alongside `signFor` — add it to the Escape
  effect's guard list and render `<RejectDialog>` as a **sibling** of `<DetailDrawer>`, exactly like
  `signFor`. Do it that way; do not invent an event-propagation workaround.
  `DetailDrawer` then gets no new state — its ปฏิเสธ button calls a new `onRequestReject()` prop that
  the hub wires to `setRejecting(true)`, and the hub's `RejectDialog.onConfirm` calls the existing
  `drawerAction(() => rejectReimbursement(...))`. This is the one prop addition that is allowed.

## H. Create-claim form (`MyRequests`)

Rebuild the layout. **Fields, state shape (`form`, `FormLine`, `emptyLine`, `emptyForm`), `setLine`,
`handleCreate`, and the payload stay exactly as they are.**

- Outer: `<form … className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">`, replacing the
  `rounded border … bg-gray-50` block.
- **Left column** (`space-y-4`):
  - `<MangmeeCard className="p-4">` "ข้อมูลคำขอ" — เหตุผล (full width), สกุลเงิน, เหตุผลที่ไม่มีใบเสร็จ,
    in `grid gap-3 sm:grid-cols-2` with เหตุผล spanning both. Same inputs, same `required`.
  - `<MangmeeCard className="p-4">` "รายการที่ขอเบิก" — **replace the 8-column table with one bordered
    block per line**, because the table is unreadable below ~1200px and unusable on mobile:

    ```tsx
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-gray-700">รายการที่ {i + 1}</span>
        {form.lines.length > 1 && (
          <button type="button" aria-label="ลบรายการ" className="text-error-600 hover:text-error-700"
            onClick={…same filter as today…}>{ICON.trash}</button>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        …labelled fields: วันที่* · หมวด* · รายการ* (sm:col-span-2) · วัตถุประสงค์ · จำนวนเงิน* · ใบเสร็จ…
      </div>
    </div>
    ```

    Each field keeps a `<label className="mb-1.5 block text-xs font-semibold text-gray-600">` above it
    and the **same** control, `aria-label`, `required`, `type`, `step`, `accept` and `onChange` as
    today — including the `key={l.file?.name ?? \`empty-${i}\`}` on the file input and the
    `✓ {l.file.name}` / `นำออก` affordance.
  - `+ เพิ่มรายการ` stays a `ghostClass` button under the list.
- **Right column**: `<MangmeeCard className="sticky top-4 p-4 h-fit">` summary —
  - "สรุปคำขอ" heading
  - จำนวนรายการ = `form.lines.length`
  - แนบใบเสร็จแล้ว = `form.lines.filter(l => l.file).length` / total
  - ยอดรวม — `formatMoney(total)} {form.currency}` in the big treatment:
    `text-[26px] font-extrabold leading-none tracking-tight tabular-nums text-gray-900`
  - `{error && <ErrorBanner message={error} />}`
  - the submit button (`btnClass w-full`, same `disabled={busy === 'create'}` and label swap) and the
    `ghostClass w-full` ยกเลิก button
  - note: `ระบบจะบันทึกเป็นฉบับร่าง คุณตรวจสอบและกดส่งอนุมัติได้ภายหลัง`
- **Delete** the old bottom `<div className="flex gap-2 justify-end">` action row and the `<tfoot>`
  total — the summary card replaces both.
- The `+ สร้างคำขอเบิก` / `ยกเลิก` toggle button above stays; keep `showForm` semantics identical.
- `{!showForm && error && <ErrorBanner …/>}` stays for the list-level error.

## I. Detail drawer

Keep the drawer shell (`fixed inset-x-0 bottom-0 top-[68px] z-50`, backdrop click closes,
`max-w-3xl`, `overflow-y-auto`, sticky internal header) and **all** conditionals. Restructure the body:

1. **Header** (sticky, existing): title `รายละเอียดคำขอ {requestNo}`, and under it a
   `flex flex-wrap gap-2` of `<StatusBadge>` + `<PaymentBadge>`. Buttons become `ghostClass`.
2. **Hero card** — first thing in the body, replacing the top of the flat `<dl>`:
   `<MangmeeCard className="p-4">` with ผู้ขอ + เหตุผล on the left and, right-aligned,
   ยอดรวม in `text-[28px] font-extrabold tabular-nums` plus `คงค้าง {formatMoney(outstandingAmount)}`
   in `text-sm text-gray-500`.
3. **`ข้อมูลคำขอ` card** — the remaining `Row`s as a `grid gap-x-6 gap-y-2 sm:grid-cols-2`
   definition list. Change `Row` to render label above value in a `<div>` rather than the current
   `justify-between` pair (which breaks with long Thai values). Resolve the raw enums:
   - `ใบเสร็จ` → `RECEIPT_REQUIREMENT_LABELS[detail.receiptRequirementStatus] ?? detail.receiptRequirementStatus`
   - `ตรวจรายการซ้ำ` (rename from `ซ้ำ`) → `DUPLICATE_STATUS_LABELS[…] ?? …`
   - keep `FINANCE_REVIEW_LABELS` / `PAYMENT_STATUS_LABELS` usage; render สถานะ and การจ่าย as badges.
   - Keep every field that is rendered today. Do not drop rows.
4. **`รายการเบิก` card** — `mangmee-table`, same columns, same per-line draft upload controls under the
   ใบเสร็จ cell, same `tfoot` total. Same `isDraft && context === 'mine'` gate.
5. **`ลายเซ็นในใบเบิก`** and **`ใบเบิกที่เซ็นแล้ว`** — each in a `MangmeeCard`, same
   `detail.requestNo &&` gate, same grid, same `signableRoles.includes(role)` button gate, same
   `canAttachSignedCopy` upload. Signed blocks get `<MangmeeBadge tone="brand">ลงนามแล้ว</MangmeeBadge>`,
   unsigned get `tone="slate"` `ยังไม่ลงนาม`.
6. **`ขั้นตอนอนุมัติ`** — same `detail.approvalSteps?.length > 0` gate, rendered as a simple vertical
   list of bordered rows instead of the raw `#1 APPROVED โดย …` string: step number, a
   `MangmeeBadge` using `APPROVAL_STEP_STATUS_LABELS`, the decider/approver name, and the
   comment / rejectionReason underneath. Same data, same order.
7. **`การจ่ายเงิน`** — same gate, rendered as bordered rows with `PAYMENT_METHOD_LABELS` and
   `formatMoney`.
8. **Action bar** — move the `mt-4 flex flex-wrap justify-end gap-2` block out of mid-scroll into a
   **sticky footer** at the bottom of the drawer:
   `<div className="sticky bottom-0 -mx-6 mt-4 flex flex-wrap justify-end gap-2 border-t border-gray-100 bg-white px-6 py-3">`.
   **Exactly the same buttons under exactly the same conditions** (`isDraft && context === 'mine'` →
   ส่งอนุมัติ + ยกเลิกคำขอ; `canApprove` → อนุมัติ + ปฏิเสธ; `canFinanceApprove` → อนุมัติจ่าย;
   `canPay` → บันทึกจ่าย). Render nothing (no bar) when no button qualifies.
9. `{error && <ErrorBanner …/>}` stays above the action bar.

## J. Payment modal + signature modal

- `PaymentModal` currently hand-rolls its own `fixed inset-0` overlay. Convert it to the shared
  `Modal` (`size="sm"`, `title={\`บันทึกการจ่ายเงิน — ${request.requestNo}\`}`, `closeLabel="ยกเลิก"`)
  so it matches `SignatureModal` and gets focus-trap + portal for free. Keep the form, fields,
  `validatePaymentForm` call, payload and `onDone` identical.
- `SignatureModal` already uses `Modal`; only restyle its inner blocks (`ErrorBanner` now comes from
  the shared import) and give each field a `text-xs font-semibold text-gray-600` label. No logic change.
- Both keep their sibling-of-drawer position in the hub.

## K. Policy settings

`<form>` becomes `MangmeeCard`s inside a `max-w-3xl space-y-4` form:

- Card `เกณฑ์การอนุมัติ` — ต้องอนุมัติเมื่อยอดตั้งแต่, โหมดผู้อนุมัติ, บทบาทผู้อนุมัติเริ่มต้น,
  อนุญาตให้อนุมัติคำขอตนเอง.
- Card `ใบเสร็จและรายการซ้ำ` — ต้องมีใบเสร็จ, อนุญาตไม่มีใบเสร็จได้หากระบุเหตุผล, นโยบายรายการซ้ำ.
- Card `การเงินและ SLA` — ต้องผ่านการตรวจสอบการเงินก่อนจ่าย, SLA (ชั่วโมง).

Each card gets a `text-sm font-bold text-gray-900` heading plus a one-line gray helper. Checkboxes
become full-width rows: `flex items-center justify-between gap-4 rounded-xl border border-gray-200 px-3 py-2.5`
with the label on the left and the checkbox on the right. **The `updateReimbursementPolicy` payload,
the field names, `load()`, `saved`, and the error/success banners stay exactly as they are** — regroup
the same controls, do not add or remove a setting. Success banner → `InfoBanner`.

Save button: `btnClass` in a `flex justify-end` at the end of the form (unchanged behaviour).

---

## Constraints

- Shortest correct diff. No speculative abstraction, no new dependency, no new file, no refactor of
  code you were not asked to touch.
- Do not change permission gates, API calls, payload shapes, validation, or business logic anywhere.
- Do not delete or weaken existing tests.
- No `any`-typing regressions beyond what the file already has (`detail: any` etc. stay as-is —
  do not embark on a typing project).
- Keep every Thai string hardcoded. **Do not introduce `t()` / `workspace-dictionary` here** — i18n is
  a separate task (see decision D5).

## Verification (run these; record exact output in the report)

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/web lint
corepack pnpm --filter @watchdog-bms/web test
```

Add unit tests (co-located, matching existing style in `reimbursements.logic.spec.ts` /
`reimbursements.model.spec.ts`):

1. `summariseQueue` — empty input → all zeros; mixed rows sum `amount` and `outstandingAmount` and
   count `slaRisk` / `hasDuplicateBlocker` rows once each; non-numeric/missing amounts do not produce `NaN`.
2. `REQUEST_STATUS_TONES` / `PAYMENT_STATUS_TONES` cover every key of `REQUEST_STATUS_LABELS` /
   `PAYMENT_STATUS_LABELS` (guards against a status rendering as an untoned grey pill).
3. `RECEIPT_REQUIREMENT_LABELS`, `DUPLICATE_STATUS_LABELS`, `APPROVAL_STEP_STATUS_LABELS` each cover
   the full Prisma enum listed in section B.

## Report back

Write `docs/agent-memory/reimbursements-ui-redesign.results.md` with:

- Files touched, one line each: what changed and why.
- A short **flow-parity statement**: for each of the 11 invariants at the top of this document, confirm
  it is unchanged and say where it now lives (line/function) if it moved.
- The verification commands with their **real** output. Do not claim a check passed that you did not run.
- Anything you could not do, with the reason.
