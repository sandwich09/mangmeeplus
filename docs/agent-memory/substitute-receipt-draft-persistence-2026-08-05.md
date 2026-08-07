# Agent Memory: substitute-receipt draft persistence

Status: Done (option A implemented and verified; follow-ups below not started)
Owner: expenses / substitute receipt (ใบรับรองแทนใบเสร็จรับเงิน)
Scope: `DocumentReviewSection` substitute panel + `UpdateExpenseDraftUseCase` field pass-through

## Problem

Filling the substitute-receipt form and leaving the review page discarded everything. All panel
fields were local `useState` in `DocumentReviewSection`; nothing reached the server until
`generateSubstituteReceipt` (the "จัดทำ" button) created the `PREPARED` evidence row.

Lost on re-entry: the panel itself (`showSub`), `missingReceiptReason`, `reasonCode`, and
`businessPurpose` whenever `expense.note` was null. Payment method/date and the supporting/payment
checkbox sets already rebuilt themselves from `detail`.

## Decisions

- **No new `DRAFT` evidence status.** `PREPARED` already is the revisable draft ("จัดทำ version แก้ไข"
  → supersede). The only real gap was the window *before* prepare.
- **Persist into the columns the flow already uses**: `ExpenseRecord.missingReceiptReason` and
  `note`. Issue-time (`prisma-expense.repository.ts:958`) and supersede (`:535`) already write and
  clear `missingReceiptReason` on the expense row, so the draft save writes to the same field the
  rest of the flow treats as authoritative.
- **Blur save, not an explicit "บันทึกร่าง" button.** The reported failure was exiting without
  saving; a button the user must remember to press does not fix that.
- `reasonCode` is still not persisted — it has no expense-row column. One dropdown to re-pick.

## Impact review before implementing

- Setting `missingReceiptReason` starts the substitute path: `expenseSubstituteReceiptReady` /
  `expenseNeedsReceiptOrSubstitute` (`expenses.model.ts:708`, `:721`) flip, the evidence step goes
  `attention`, and confirm is blocked until an `ISSUED` certificate exists. Server-enforced too, in
  `atomicConfirm` (`prisma-expense.repository.ts:1232-1234`) — so this **cannot** be used to confirm
  a receiptless expense. Reversible: blanking the textarea clears the column back to null.
- `missingReceiptReason` and `note` are both in `materialFields` (`prisma-expense.repository.ts:455`),
  which throws `substitute_evidence_locks_expense` once evidence is `PAYER_CERTIFIED`/`ISSUED`. The
  panel only renders when evidence is absent or `PREPARED`, so the lock is never hit from here.
- `generateSubstituteReceipt` requires an exact `expectedExpenseUpdatedAt`
  (`substitute-receipt.use-case.ts:156`). Every draft save bumps `updatedAt`, so the save must
  refresh `detail` — it goes through the existing `run()` helper, which reloads.
- `DocumentReviewSection` is mounted **twice** (`ExpenseReviewPage.tsx:789` evidence step and `:806`
  review step, both always mounted, toggled with `hidden`). The two instances hold independent
  state, so the rehydrate is a `detail`-keyed `useEffect` — the same pattern the card already uses
  for `docType`/`taxStatus`/`categoryId` — not a mount-time initializer alone.

## Artifacts

- `apps/api/src/modules/expenses/domain/models/expense.model.ts` — `missingReceiptReason?: string | null`
  on update (omitted from the `CreateExpenseRecordInput` pick so the intersection actually widens).
- `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts` — pass-through,
  blank → null.
- `apps/web/src/features/expenses/ExpensesPages.tsx` — rehydrate `subReason`/`subPurpose`, open the
  panel when a reason is stored, `saveSubstituteDraft` on blur of the two textareas.
- `apps/api/src/modules/expenses/application/use-cases/expense-draft-vat-decouple.use-case.spec.ts`
  — forwards / clears on blank / untouched when not sent.

## Verification

- `apps/api`: `tsc --noEmit` clean; expenses module specs 334/334.
- `apps/web`: `tsc --noEmit` clean; suite 693/693.
- Pre-existing failure, unrelated and confirmed identical with the change stashed:
  `src/common/export/thai-date.logic.spec.ts` "keeps the accountant CSV byte-identical" (CSV hash
  mismatch). Not in the curated `apps/api` `test` script list.
- Not run: live browser walk of the review page.

## Open questions / follow-ups

1. ~~`PATCH /expenses/:id` and `/review-fields` still accept `receivedAt`, `dueDate`, and
   `internalMemo` in `UpdateExpenseDraftInput` and silently discard them.~~ Fixed 2026-08-05 in the
   same use-case: passed through rather than dropped from the contract, because all three have live
   readers (`dueDate` → the rendered overdue KPI card `ExpensesPages.tsx:1288`, `internalMemo` →
   `notes` in the evidence pack `expense-evidence.use-case.ts:172`). No caller sends them yet, so
   the overdue KPI stays ฿0 until an entry field exists — a product gap, not an API one.
2. Every reviewer PATCH stamps `reviewedAt = now`, which satisfies the OCR-total-mismatch confirm
   guard (`expense-status.logic.ts` `reviewedAfterOcr`). Blur saves trip it more often than before,
   though `startGuidedSubstitute` already did this without an explicit press.

   Investigated 2026-08-05. `reviewedAt` is overloaded: a generic "finance last touched this record"
   timestamp used as a specific "accepted the amount discrepancy" signal. Findings:
   - Callers of `UpdateExpenseDraftUseCase`: `PATCH /expenses/:id`, `PATCH /review-fields`,
     `POST /non-expense-classification-override`, and `line-correction.use-case.ts:110`. Only the
     first two carry `lines`; the other two stamp `reviewedAt` while carrying no amount at all.
   - The normal edit journey never depends on the leniency — the review save sends `lines` and
     stamps `reviewedAt` in the same call, so the gate clears on the very edit that caused the
     mismatch.
   - **Do not narrow the stamp to amount-carrying patches.** A mismatch can exist with no human
     edit: `verifyDiscountAmount` adds the discount back into the completed total while
     `aiVerifiedFieldsJson` keeps the raw OCR output (`receipt-ocr-apply.service.ts:385-389`), and
     a non-reviewer LINE amount correction stamps nothing. In those states the reviewer may
     legitimately accept the stored total unchanged, and would be blocked forever without a fake edit.
   - The only correct clearing signal is an explicit acknowledgement bound to the acknowledged
     total, mirroring `nonExpenseClassificationOverride` (stored in `aiVerificationSummaryJson`, no
     migration). Web already renders the mismatch warning at `ExpenseReviewPage.tsx:522` with the
     same 0.05 tolerance as the server, so it is the natural home for the action.

   Implemented 2026-08-05. `validateConfirm` no longer reads `reviewedAt`/`aiVerifiedAt` at all; it
   calls `hasAiGrandTotalMismatch` + `hasAcknowledgedAiTotalMismatch` (both new, exported from
   `expense-status.logic.ts`). Acceptance lives at `aiVerificationSummaryJson.totalMismatchResolution`
   = `{ acknowledged, acknowledgedTotalAmount, resolvedByUserId, resolvedAt, reason }`, written by
   `POST /v1/companies/:companyId/expenses/:expenseId/ocr-total-acknowledgement`
   (`expense.review`, routed through `UpdateExpenseDraftUseCase` like the classification override).
   Both resolutions now merge into one summary write — two spreads of the same JSON key would have
   dropped the first. Web: `needsAiTotalAcknowledgement` gates `canConfirmExpense` and turns the
   existing mismatch banner into an accept form. `reviewedAt` is still stamped as the audit trail;
   it just no longer decides anything.

   Behaviour change to watch: in-flight expenses with a real mismatch that were confirmable via a
   stray reviewer save are now blocked until someone accepts the figure — the point of the control.
3. Same "ephemeral until submit" shape elsewhere, all lower value (single-sitting forms on one
   page): reimbursement create form (`ReimbursementsPages.tsx:445`), workflow webhook form
   (`WorkflowPages.tsx:576`). Inside this same panel, `signerPosition` and the signature
   preview are still lost on exit — the payer redoes them, and the file picker cannot be restored.
