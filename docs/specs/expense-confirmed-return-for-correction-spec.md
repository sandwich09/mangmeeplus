# Expense Confirmed Return-For-Correction Spec

## 1. Status

v0.1, 2026-08-06. **Proposed — not implemented.** Awaiting owner sign-off on §13.

Owner: thawtchai. Owner decision recorded 2026-08-06, in the owner's words: a confirmed expense must not be editable; if it needs fixing it goes back to the person who opened it, they correct it, and it circulates back to accounting for another round.

Linked plan: [[plans/expense-confirmed-return-for-correction-plan|Expense Confirmed Return-For-Correction Plan]]

Related: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]] (owns the draft → confirm journey), [[specs/expense-ledger-auto-post-spec|Expense Ledger Auto-Post Spec]] (owns what happens to the JV after confirmation), [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]] (owns period close).

## 2. Goal

Give accounting a way to hand a wrong confirmed expense back to whoever opened it, with a reason, so it can be corrected and re-submitted — instead of the only two options available today, which are *void it and re-record from scratch* or *live with it*.

The document keeps its identity through the round trip. This is a correction loop, not a new document.

## 3. Trigger

Reported 2026-08-06 from หลักฐานทางบัญชี: a confirmed expense (`EXP-202608-00001`, ลงบัญชี = รอบันทึกบัญชี) flagged ยังไม่จัดหมวด, with no way to act on the flag. The tab's own step 2 told the user to click in and fix it; the record was locked. Two things came out of that:

- The locked-but-looks-editable UI was a separate, already-fixed defect — see the plan's "Already landed" section.
- There is no correction path at all from `CONFIRMED`. That is what this spec adds.

## 4. Source Facts (verified in code on 2026-08-06)

| Fact | Evidence | Consequence for this design |
| --- | --- | --- |
| `CONFIRMED` transitions only to `VOIDED` | `expense-status.logic.ts:73` | A new transition is required; nothing today walks a confirmation back |
| PATCH rejects any status outside `DRAFT / EXTRACTING / NEEDS_REVIEW / READY_FOR_CONFIRMATION` | `expense-draft.use-case.ts:185` | Editing is blocked server-side, not just in the UI. Returning the record to `NEEDS_REVIEW` is what re-opens editing — no PATCH change is needed |
| `REJECTED → NEEDS_REVIEW` already exists ("เริ่มตรวจใหม่"), and reject writes `postingStatus: 'not_required'` plus a `rejectedByUserId / rejectedAt / rejectReason` trio | `expense-status.logic.ts:76`, `expense-draft.use-case.ts:673` | The repo already models "send it back to be edited and re-submitted". Mirror that shape rather than inventing one |
| `derivePostingStatus` returns `not_required` for every non-`CONFIRMED` status | `expense-status.logic.ts` | A returned document must drop out of the posting queue, and the existing helper already produces that |
| Void reverses posted JV legs — accrual and, when paid, settlement — reserving a reversal number per leg outside the transaction | `expense-draft.use-case.ts:772-800` | Reversal machinery exists but is non-trivial. Coupling it into the return path is the expensive half of this feature |
| `expenseNumber` is reserved at confirm, keyed `confirm:${expenseId}:${eventRequestId}` where `eventRequestId` falls back to `ctx.requestId` | `expense-draft.use-case.ts:530` | Re-confirming after a return re-enters this code. Whether the same `EXP-` number comes back depends on whether `ctx.requestId` is stable — it is not. §7 R7 pins the rule explicitly rather than relying on the key |
| หลักฐานทางบัญชี lists `CONFIRMED` only, defaulted server-side | `expense-evidence.use-case.ts:47` | A returned document leaves the accountant's view until it is re-confirmed. That is correct, and it is also a visible disappearance an accountant must be told about |
| The creator can edit their own record in `NEEDS_REVIEW` (`expense.update` + owner) and submit it with `markExpenseReady` | `ExpenseReviewPage.tsx:257-260`, `expense-draft.use-case.ts:852` | The "correct it and send it back" half of the loop already works once the status is right. No new editing surface is needed |
| `expense.confirm` is `HIGH` risk; `expense.void` is `CRITICAL`; both sit in the finance/accounting capability packs | `permission-registry.ts:160-162, 537` | A return is strictly less destructive than a void and roughly as consequential as a confirm |

## 5. Non-goals

- Making a `CONFIRMED` expense editable in place. It stays locked; the record is edited only after it has moved back to `NEEDS_REVIEW`.
- Replacing void. Void stays the remedy for a document that should not exist at all.
- Any change to what `NEEDS_REVIEW → READY_FOR_CONFIRMATION → CONFIRMED` already does.
- Partial or field-level correction ("just fix the category"). The document re-enters review whole.
- Returning a **posted** document in v1 — see §6.

## 6. Key Design Decision — return only while nothing has reached the books

**A return is allowed only when `postingStatus` is `pending` or `posting_error`; a `posted` document is not returnable in v1.**

Once a JV exists, walking the document back to `NEEDS_REVIEW` would leave a posted journal entry pointing at a record that is being edited — the ledger would describe a document that no longer exists in that form. Making that safe means running the same reversal void already runs, inside the return, with the same period-close and numbering care. That is the expensive half of the feature and it is not what the reported case needs: the document that triggered this was `รอบันทึกบัญชี`, with nothing posted.

So v1 draws the line at the ledger boundary:

| `postingStatus` | Remedy |
| --- | --- |
| `pending`, `posting_error` | **ส่งกลับแก้ไข** — this spec |
| `posted` | Void (true reversal, existing path) and re-record |
| `not_required`, `reversed` | Not returnable; the record is already out of the posting path or already reversed |

This keeps the new transition free of any ledger interaction, which is what makes it a small, verifiable change. §13 Q1 asks whether posted-document return is wanted as v2.

**The landing status is `NEEDS_REVIEW`, not a new `RETURNED` status.** A new status would have to be taught to every list filter, badge map, capability check and report that already enumerates the seven existing ones, and it would buy nothing the reason fields do not already carry. `REJECTED → NEEDS_REVIEW` is the precedent: the repo already expresses "go back and re-submit" as a move into the review queue.

## 7. Business Rules

1. **R1 — transition.** `CONFIRMED → NEEDS_REVIEW` is allowed, and only through the return action. No other caller may produce it.
2. **R2 — ledger gate.** The return is refused unless `postingStatus ∈ {pending, posting_error}` (§6). The refusal names the remedy: void.
3. **R3 — reason is mandatory.** Non-empty, ≤ 500 chars, same sanitising as reject and void. The reason is what the creator reads; a return with no reason is a dead end for them.
4. **R4 — permission.** `expense.confirm`. The authority that could confirm the document is the authority that may pull it back. A return is strictly less destructive than a void, so requiring `expense.void` would be wrong, and `expense.review` alone is too broad — see §13 Q2.
5. **R5 — posting status.** The return writes `postingStatus: 'not_required'`, matching reject. The document leaves the posting queue.
6. **R6 — the return is recorded on the record**, in a `returnedByUserId / returnedAt / returnReason` trio mirroring the existing `rejected*` trio. Reusing `rejectReason` is not acceptable: a returned document is not a rejected one, and the two states have different meanings for the creator and for reporting.
7. **R7 — the document number survives.** `expenseNumber`, once issued, is never re-issued. Re-confirming a returned document keeps the number it already has; the confirm path reserves a number only when `expenseNumber` is null. The number is already in whatever accountant package was exported before the return, and changing it would break that reconciliation.
8. **R8 — the confirmation stamps are cleared** (`confirmedAt`, and `confirmedByUserId` if present), so a returned document does not read as confirmed while it sits in review. The return trio in R6 is what preserves the history.
9. **R9 — a returned document leaves หลักฐานทางบัญชี** until it is re-confirmed, because that view filters on `CONFIRMED`. This is intended. It is also why R3's reason and the audit entry matter: an accountant who already exported the document must be able to find out why it left.
10. **R10 — payment.** A document with a recorded payment (`paymentStatus ≠ UNPAID`) is not returnable. Money has moved; that is a void-and-re-record case, not a correction. (This is implied by R2 for the posted settlement leg, and stated separately because a payment can be recorded before its JV is generated.)

## 8. State Model

```
DRAFT ─┐
       ├─→ NEEDS_REVIEW ─→ READY_FOR_CONFIRMATION ─→ CONFIRMED ─→ VOIDED
       │        ↑                     │                  │
       │        └── reject ───────────┘                  │
       │        ↑                                        │
       │        └──────── ส่งกลับแก้ไข (new, R1/R2) ──────┘
       └─→ REJECTED ─→ NEEDS_REVIEW
```

The loop the owner described is the new edge plus the two that already exist: return → creator edits → `markExpenseReady` → accounting confirms again.

## 9. Contract and API

- `POST /companies/:companyId/expenses/:expenseId/return` — body `{ reason: string }`. Guarded by `expense.confirm`. Returns the updated `ExpenseDetail`.
- `ExpenseSummary` / `ExpenseDetail` gain `returnedAt: string | null`, `returnedByUserId: string | null`, `returnReason: string | null`.
- Schema: three additive nullable columns on `ExpenseRecord`. Forward and backward safe — an older build ignores columns it does not select.

## 10. UI

- **Confirmed detail page.** A `ส่งกลับแก้ไข` action beside `ยกเลิกเอกสาร`, shown when `expense.confirm` is held and R2/R10 pass, opening the same reason box the reject and void flows already use. When R2 or R10 blocks it, the button is absent and the posting card says why the only remedy is void.
- **Confirmed detail page, current copy.** The line added on 2026-08-06 — "เอกสารยืนยันแล้ว แก้ไขข้อมูลไม่ได้ · หากข้อมูลไม่ถูกต้อง ให้ยกเลิกเอกสารแล้วบันทึกใหม่" — is replaced by wording that names ส่งกลับแก้ไข as the first remedy when it is available.
- **Returned document, creator's view.** The return reason shows the way `rejectReason` already shows, so the creator opens the record and reads what to fix.
- **หลักฐานทางบัญชี.** No new control. Step 2 of its How-It-Works, corrected on 2026-08-06 to stop promising in-place editing, is revisited once return exists so the ⚠ rows point at the action that can actually clear them.

## 11. Audit and Events

- Audit entry on every return: actor, expense id, expense number, previous `postingStatus`, reason. Same shape as the void audit.
- No outbox event in v1. Confirmation emits `expense.confirmed` because downstream consumers care; nothing downstream consumes a return while posted documents are out of scope (§6). This is revisited with Q1.

## 12. Verification

- Domain: `canTransition('CONFIRMED', 'NEEDS_REVIEW')` true; return refused for each of `posted`, `not_required`, `reversed`, and for a paid document; reason required.
- Use case: return writes status, `postingStatus: 'not_required'`, the return trio, and clears the confirmation stamps; re-confirm afterwards keeps the original `expenseNumber` (R7).
- E2E: confirm → return with reason → creator edits the category → ส่งตรวจ → accounting confirms → the row reappears in หลักฐานทางบัญชี with the same `EXP-` number.

## 13. Open Questions

- **Q1 — posted documents.** v1 refuses to return anything already posted (§6) and points at void. Is a v2 that returns a posted document by reversing its JV first wanted, or is void the permanent answer once it is in the books?
- **Q2 — permission.** v1 reuses `expense.confirm` (R4). A dedicated `expense.return` key would let a company grant returning without granting confirming, at the cost of touching the registry and every capability pack. Worth it?
- **Q3 — notification.** v1 relies on the creator seeing the record in their list. Should a return also raise a dashboard notification or a LINE message, given the creator may not open the app for days?
- **Q4 — repeat returns.** Nothing here limits how many times a document may round-trip. Is a count or a "returned twice → escalate" rule wanted, or is the audit trail enough?

## Guide wording — 2026-10-03

The expense guide (overview, evidence and FAQ) must describe the existing guarded “ส่งกลับแก้ไข” path. It must not claim that every confirmed expense must be cancelled and recreated, or can never be edited again. Ask a permitted user to check whether return-for-correction is available; otherwise check the cancellation conditions. Linked reimbursement source records still follow their claim workflow. No state transition or permission changes.
