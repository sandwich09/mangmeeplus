# Expense Confirmed Return-For-Correction Plan

## Status

v0.1, 2026-08-06. **Blocked on spec sign-off.** Steps 1–7 are not started; they must not start until §13 of the spec is answered, because Q1 and Q2 change the shape of steps 2 and 4.

The UI half described under "Already landed" is done and verified.

## Linked Specs

- [[specs/expense-confirmed-return-for-correction-spec|Expense Confirmed Return-For-Correction Spec]] — authority for this plan.
- [[specs/expense-ledger-auto-post-spec|Expense Ledger Auto-Post Spec]] — owns the posting states the §6 gate reads.

## Purpose

Add one transition — `CONFIRMED → NEEDS_REVIEW`, with a reason, while nothing has reached the ledger — so accounting can hand a wrong confirmed expense back to whoever opened it instead of voiding it.

## Non-Goals

Everything in spec §5. In particular: no in-place editing of a confirmed record, no change to void, no new status.

## Already landed (2026-08-06, separate from the transition)

The report that started this was "confirmed documents still look editable". They were not editable — API and UI both blocked it — but nothing on screen said so. Three fixes, no behaviour change:

1. `apps/web/app/globals.css` — `.mangmee-input` sets `background` and `color` outright, which beats the browser's disabled rendering, and the file had no `:disabled` rule at all. A locked text field was pixel-identical to an editable one, while `ThemedSelect` and `ThemedDate` dimmed themselves — so one page showed two different answers. Added `input/textarea/select.mangmee-input:disabled`, scoped to real form controls so the two components that already dim do not double-dim. Fixes every read-only surface in the app, not just this one.
2. `ExpensesWorkspacePanels.tsx` — หลักฐานทางบัญชี step 2 promised "คลิกเปิดแก้ได้ทันที". The tab lists `CONFIRMED` only, and `CONFIRMED` is locked, so the promise was false for every row it appeared on. Now reads "คลิกแถวที่ขึ้น ⚠ เพื่อเปิดดูรายละเอียด (เอกสารที่ยืนยันแล้วแก้ไขไม่ได้)".
3. `ExpenseReviewPage.tsx` — the confirmed detail page now states the rule and the way out once, in the posting card. This copy is replaced by step 6 below when ส่งกลับแก้ไข exists.

Verification: `apps/web` typecheck clean (`next typegen && tsc --noEmit`).

## Steps

### 1. Domain — the transition and its gate

`expense-status.logic.ts`: add `NEEDS_REVIEW` to `ALLOWED_TRANSITIONS.CONFIRMED`, and a pure guard beside `validateConfirm`:

```ts
export function validateReturnForCorrection(input: {
  status: ExpenseStatus;
  postingStatus: ExpensePostingStatus;
  paymentStatus: ExpensePaymentStatus;
  reason: string;
}): string | null
```

Refuses on: wrong status, `postingStatus` outside `{pending, posting_error}` (R2), any `paymentStatus` other than `UNPAID` (R10), empty reason (R3). Every refusal message names void as the remedy, because that is the only other thing the user can do.

Widening `ALLOWED_TRANSITIONS.CONFIRMED` is the one risky line in this plan: `canTransition` is shared, so anything else that moves an expense to `NEEDS_REVIEW` would newly accept a confirmed one. Grep every `validateStatusTransition` / `canTransition` call before landing it, and if any caller is reachable with a confirmed record, gate at the call site rather than widening the table.

### 2. Schema + contract

Three additive nullable columns on `ExpenseRecord`: `returnedByUserId`, `returnedAt`, `returnReason` — the same trio shape as `rejected*` (R6). Surface them on `ExpenseSummary` and `ExpenseDetail`.

Additive only, forward and backward safe.

### 3. Use case

`returnExpenseForCorrection` in `expense-draft.use-case.ts`, modelled on `rejectExpense` (line 671) rather than on void — no number reservation, no reversal, no outbox. It:

- loads the record, asserts branch scope,
- runs the step 1 guard,
- writes `status: 'NEEDS_REVIEW'`, `postingStatus: 'not_required'`, the return trio, and clears `confirmedAt` (R8),
- writes the audit entry (spec §11).

Optimistic concurrency: use the same `expectedUpdatedAt` discipline the neighbouring mutations use, so a return cannot race a JV generation that is posting the document out from under it. This is the failure mode the R2 gate cannot catch on its own.

### 4. Confirm path — keep the number (R7)

In `confirmExpense`, reserve a document number **only when `expenseNumber` is null**. Today the reservation key is `confirm:${expenseId}:${eventRequestId}` with `eventRequestId` falling back to `ctx.requestId`, which is per-request — so a re-confirm after a return would otherwise reserve a second number and the accountant's already-exported index would stop matching.

One regression test: confirm → return → re-confirm, assert the `EXP-` number is unchanged.

### 5. HTTP + web API client

`POST /companies/:companyId/expenses/:expenseId/return`, guarded by `expense.confirm` (R4, pending Q2). Add `returnExpenseForCorrection` to `expenses.api.ts` beside `rejectExpense`.

### 6. UI

- `ExpenseReviewPage`: a `ส่งกลับแก้ไข` button in the confirmed footer beside `ยกเลิกเอกสาร`, reusing the existing reason box (`showReject` / `showVoid` already share it — add a third mode rather than a third box).
- Replace the "ให้ยกเลิกเอกสารแล้วบันทึกใหม่" line added on 2026-08-06 with wording that names ส่งกลับแก้ไข first when it is available, and keeps void as the answer when R2/R10 block it.
- Show `returnReason` to the creator the way `rejectReason` is already shown.
- Revisit หลักฐานทางบัญชี step 2 so the ⚠ rows point at the action that can now clear them.

### 7. Verification

Everything in spec §12. The E2E is the one that proves the owner's sentence end to end: confirm → return → creator fixes the category → ส่งตรวจ → confirm → the row is back in หลักฐานทางบัญชี with the same number.

## Risks

- **Widening `ALLOWED_TRANSITIONS.CONFIRMED`** — see step 1. Handled by auditing callers, not by trusting the table.
- **Return racing auto-post** — a document can be `pending` at the guard and `posted` a moment later. Handled by the optimistic-concurrency write in step 3; without it the R2 gate is advisory only.
- **Silent disappearance from หลักฐานทางบัญชี** (R9) — an accountant mid-export sees a row vanish. Audit covers the forensics; Q3 covers whether anyone is actively told.
