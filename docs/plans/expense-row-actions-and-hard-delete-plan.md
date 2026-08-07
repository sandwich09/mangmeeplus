# Plan: Expense Row Actions (View / Delete) + Hard Delete with Audit + Modal Scroll Fix

Status: IMPLEMENTED — 2026-07-29
Owner: Claude (harness engineer) → Codex (implementation)
Scope: `apps/api` (new endpoint, use case, one permission key) + `packages/contracts` + `apps/web` (list row actions, Modal scroll)
Surface: `/companies/{companyId}/expenses` (รายการค่าใช้จ่าย) and the expense detail modal

## Product rules

> Follow-up 2026-07-29: rows in `NEEDS_REVIEW` or `READY_FOR_CONFIRMATION` are also
> deletable when `grandTotalAmount = 0` and `paymentStatus = UNPAID`. All permission,
> retention, linked-data, and audit rules below remain unchanged.
>
> Follow-up 2026-08-05: `REJECTED` rows are deletable at any amount — see the owner
> decision at the end of this plan. Permission, retention, linked-data, and audit rules
> are unchanged and still apply.

1. Every row gets an explicit **ดูรายละเอียด (eye)** action, enabled for **every status**. Row-click already opens the detail modal; the icon makes that affordance discoverable and keyboard-reachable.
2. Every **DRAFT (ฉบับร่าง)** row gets a **ลบ (trash)** action. A `REJECTED (ปฏิเสธ)` row gets it too, and a zero-total, unpaid row gets it while awaiting review or confirmation. Other rows do not render it.
3. Delete is a **hard delete** — the `ExpenseRecord` row leaves the database.
4. **The deletion is recorded permanently**: who deleted it, when, and enough of a snapshot to identify what was destroyed. The audit row is written **in the same transaction** as the delete, so a deleted expense without a log entry is impossible.
5. Delete is confirmed before it runs, and the dialog says plainly that it cannot be undone.
6. The expense detail modal must have **one** vertical scrollbar, not two.

## Delete blast radius — verified against `schema.prisma`

This is the part that makes hard delete non-trivial. Every relation pointing at `ExpenseRecord`:

| Relation | On delete | Consequence |
|---|---|---|
| `ExpenseLine` | `Cascade` | removed automatically ✓ |
| `ReceiptExtraction` | `Cascade` | removed automatically ✓ |
| `ReceiptAiVerification` | `Cascade` | removed automatically ✓ |
| `ExpenseDuplicateCandidate` (both `expenseId` and `candidateExpenseId`) | `Cascade` | removed automatically ✓ |
| `ExpenseSubstituteReceiptEvidence` | **`Restrict`** | **the delete will throw** if any row exists |
| `AttachmentLink` | **no FK** — polymorphic `targetType: 'expense.record'` + `targetId` | **will silently orphan**; nothing cascades |

Two hazards follow, and both must be handled explicitly:

- A draft that already has substitute-receipt evidence **cannot** be deleted. That is correct — the repo already treats substitute evidence as retention-locked (`delete-attachment.use-case.ts:29-44` refuses with `SUBSTITUTE_EVIDENCE_RETENTION_LOCKED`). Reuse that error code and shape.
- Attachment links are joined by string, not foreign key. Deleting the expense without deleting them leaves rows pointing at a nonexistent target, and the underlying `AttachmentObject` (plus its stored bytes) unreferenced and invisible.

### Owner decision (2026-07-29): delete only genuinely unlinked drafts

Substitute-receipt evidence is **not** the only thing that can bind a draft, and none of the others are
protected by a foreign key — 16 models in `schema.prisma` reference documents polymorphically via
`sourceType`/`sourceId`, so the database will not stop any of them from being orphaned:

`BankReconciliationMatch BankStatementImport BankStatementLine JournalEntry JournalLine
NotificationEvent PurchaseApprovalEvent ReportDrilldownAccessLog StockMovement TaxEvent
TaxReconciliationLine TaxReviewIssue TradeTaxEvidence WorkflowEventInbox WorkflowRun WorkflowTask`

**Rule: a draft is deletable only when nothing else references it.** The use case runs an explicit
precheck and refuses with `EXPENSE_HAS_LINKED_DATA`, naming what blocked it, if any row exists in:

| Blocks deletion | Why |
|---|---|
| `ExpenseSubstituteReceiptEvidence` | FK `Restrict`; statutory evidence |
| `TaxEvent`, `TaxReviewIssue`, `TaxReconciliationLine`, `TradeTaxEvidence` (`sourceType='expense.record'`) | tax filing trail |
| `JournalEntry`, `JournalLine` | posted accounting |
| `BankReconciliationMatch`, `BankStatementLine` | payment/reconciliation trail |
| `WorkflowRun`, `WorkflowTask`, `WorkflowEventInbox` (status ≠ `SKIPPED`) | automation already acted on it, or is still about to |
| `NotificationEvent` | a notification points at it |
| `paymentStatus !== 'UNPAID'` or `paidAmount > 0` | money recorded against it |

`ExpenseDuplicateCandidate` blocked here until the 2026-08-05 owner decision below; it no longer
does. The delete re-verdicts every referencing expense instead.

**Does not block** (own sub-data — cascade or explicit cleanup is correct): `ExpenseLine`,
`ReceiptExtraction`, `ReceiptAiVerification`, this expense's own `AttachmentLink` rows,
`ReportDrilldownAccessLog` (a read log, not a link), and a `SKIPPED` `WorkflowEventInbox` row
(no rule matched — the event was logged, never acted on).

Attachments deliberately do not block — **owner-confirmed 2026-07-29: "ไฟล์แนบต้องไม่บล็อกการลบ
กรณีที่เป็นแค่แบบร่าง"**. The drafts this feature exists to clean up came from อัปโหลดเว็บ and all carry a
receipt file; if attachments blocked deletion the feature would be inert. The permissiveness is bounded
by the DRAFT-only guard in step 2 — a receipt attached to any non-draft document is never reachable by
this path at all.

The refusal message must name the blocking kind so the user knows why, rather than a generic failure.

## Implementation

### A. Permission — one new key

`expense.delete`, riskLevel `CRITICAL`, description "Hard-delete draft expenses". Grant it in every role bundle that already holds `expense.void` (the closest destructive analog), and in `pack.expense.finance`.

Authorization rule in the use case:
- holder of `expense.delete` → may delete any DRAFT in the company;
- otherwise, the draft's own creator (`createdByUserId === ctx.userId`) holding `expense.update` may delete it — this matches the existing "own draft" convention (`expense.update` is literally described as "Update own expense drafts").

**This needs a permission sync**, and one is already pending for `expense.evidence.read` — the two ship together.

### B. Endpoint

`DELETE /v1/companies/:companyId/expenses/:expenseId` on `expense.controller.ts`, guarded `@RequirePermissions('expense.update')` (the broader in-use-case check above enforces the real rule; the guard is the coarse floor). Returns `204`.

Place it **below** the static routes, per the existing `// NOTE: static routes must stay above the :expenseId param routes.` comment.

### C. Use case — `delete-expense.use-case.ts`

One `$transaction`, in this order:

1. Load the expense tenant-scoped (`{ id, companyId }`) → `NotFoundException` if absent.
2. Status must be `DRAFT` → else `ConflictException` `{ code: 'EXPENSE_NOT_DELETABLE' }`.
3. Authorization per §A → `ForbiddenException` + **DENIED audit row**.
4. Any `ExpenseSubstituteReceiptEvidence` for this expense → `ConflictException` `{ code: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED' }` + DENIED audit row.
5. Collect the `AttachmentLink` rows (`companyId`, `targetType: 'expense.record'`, `targetId: expenseId`) and capture their `attachmentId`s for the snapshot; delete the links.
6. Mark those `AttachmentObject`s deleted through the existing soft-delete path, honouring the retention hold — **do not** hard-delete attachment bytes; attachment retention is governed separately and is not what this feature was asked to change.
7. `audit.log(entry, tx)` — the in-transaction form, which **throws on failure and rolls the delete back** (`audit.service.ts:61-63`). This is what guarantees rule 4.
8. `expenseRecord.delete(...)` — the cascades fire.

Audit entry: `action: 'expense.delete'`, `targetType: 'expense_record'`, `targetId: expenseId`, `riskLevel: 'CRITICAL'`, `result: 'SUCCESS'`, and `metadataJson` carrying a snapshot — `expenseNumber`, `vendorNameSnapshot`, `expenseDate`, `grandTotalAmount`, `captureSource`, `createdByUserId`, `attachmentIds`, `lineCount`. **The row is gone afterwards; the metadata is the only remaining description of what was destroyed, so it must stand alone.**

Spec (`delete-expense.use-case.spec.ts`, fake Prisma, node:test): DRAFT deletes and writes the audit row in-transaction; every non-DRAFT status is refused; cross-company id 404s; substitute-evidence present refuses with the retention code; attachment links are deleted; non-owner without `expense.delete` gets 403 + DENIED row; owner with `expense.update` succeeds.

**Append the new spec to `apps/api/package.json`'s `test` script** — that list is explicit and a new file otherwise never runs.

### D. Contracts + web API

`deleteExpense(companyId, expenseId)` in `expenses.api.ts`. Extend `ExpenseCapabilities` with `canDelete: has('expense.delete')`; the row decides with `canDelete || (isDraft && row.createdByUserId === userId && caps.canUpdate)`. Put that predicate in `expenses.model.ts` as a pure function with a spec — not inline in JSX.

### E. Row actions UI

`ExpensesPages.tsx:1519` — `GRID` gains a fifth track for actions, e.g. `minmax(84px,auto)`, and the header row gains a matching (visually hidden) heading.

Per row: an eye button always, a trash button only for deletable drafts. Both `type="button"` with `onClick` calling `event.stopPropagation()` so they do not also trigger the row's `onSelect`. Reuse the existing `IconBtn` from `ExpensesWorkspacePanels.tsx` (already has a `tone="danger"` variant) and the existing `ICON.trash`; add an eye glyph next to the other `ICON` entries rather than inlining SVG.

Delete confirm: reuse the existing modal pattern in this feature (there is already a `confirmId` + dialog in `CategoryManagePanel`). Copy must name the document and state that deletion is permanent. On success, close and refresh the list.

### F. Modal double-scrollbar fix

Cause, confirmed:
- `Modal.tsx:107` — the modal body is `min-h-0 flex-1 overflow-y-auto`
- `ExpensesPages.tsx:1365` — the detail modal's right pane is **also** `overflow-y-auto`
- `ExpensesPages.tsx:1317` — the content is pinned to `h-[min(78vh,860px)]` inside a shell already capped at `max-h-[calc(100dvh-2rem)]`, so the inner column overflows the outer one and both render a bar.

Fix: give `Modal` a `bodyScroll?: boolean` (default `true`, so no other caller changes). The expense detail modal passes `bodyScroll={false}` because it owns a two-pane internal scroll layout, leaving exactly one scroll owner per pane. Reconcile the height so the modal shell drives it instead of the hard-coded `78vh`.

Do not "fix" this by adding `overflow-hidden` to `bodyClassName` — it would collide with the component's own `overflow-y-auto` and the winner would depend on CSS emission order.

## Constraints

- No Prisma migration. No schema change. The only new permission key is `expense.delete`.
- Do not change attachment retention behavior or the substitute-receipt rules.
- Do not touch the entitlement/sub-menu work already on this branch.
- Pure logic in `*.model.ts` / `*.logic.ts` with `*.spec.ts` siblings; JSX stays presentational.

## Verification

1. `corepack pnpm --filter @watchdog-bms/contracts build`
2. `corepack pnpm --filter @watchdog-bms/api test` — **run alone**, not concurrently with the web suite (`line-message-buffer.service.spec.ts` is timing-sensitive and flakes under CPU contention). 0 fail; the new spec must appear in the output.
3. `corepack pnpm --filter @watchdog-bms/web test` / `typecheck` / `build`
4. Diff review: the audit write uses the **in-transaction** `log(entry, tx)` form; `AttachmentLink` rows are deleted; substitute-evidence refusal present; the trash action never renders for non-DRAFT.
5. Expense detail modal shows exactly one scrollbar per pane at a short viewport (~700px tall).

Known-good baseline before this work: API 0 fail, web 479 pass / 0 fail.

## Out of scope

Bulk delete, restoring deleted expenses, hard-deleting attachment bytes, and any change to void/reject flows for non-draft documents.

## Implementation evidence — 2026-07-29

- Added the DRAFT-only hard-delete endpoint, the full linked-data precheck above, tenant-scoped
  `AttachmentLink` cleanup, attachment soft-delete through the existing retention path, and the
  fail-closed in-transaction SUCCESS audit snapshot.
- Tightened the precheck after the owner decision: tax, journal, bank-match, workflow,
  notification, cross-expense duplicate, and payment references now return named
  `EXPENSE_HAS_LINKED_DATA` refusals with committed DENIED audits. `JournalLine` and
  `WorkflowTask` include their parent-reference paths.
- `BankStatementLine` has no document `sourceId`; an expense-linked statement line necessarily
  has a `BankReconciliationMatch` with `sourceType='EXPENSE_PAYMENT'`. That match is queried and
  blocks deletion, so no redundant statement-line delegate query was added.
- The web confirmation now reads the structured `blocker` metadata and renders a localized,
  human-facing reason instead of exposing only the generic conflict path.
- Added committed DENIED audit rows for permission, wrong-status, linked-data, and retention
  refusals. The focused case `does not delete when the in-transaction audit write fails` proves
  the expense delete is not reached when the audit insert throws.
- Added the eye/trash row actions and confirmation flow. The eye renders for every row; trash
  renders only for a DRAFT that the current actor may delete.
- Added `Modal.bodyScroll` with a default of `true`; the expense detail modal opts out and keeps
  its own pane scroll owners without a competing hard-coded height.
- `corepack pnpm --filter @watchdog-bms/contracts build`: passed.
- `corepack pnpm --filter @watchdog-bms/api test`: sandbox-blocked before discovery by
  `tsx` IPC `listen EPERM`. The exact configured file list passed through the IPC-free
  `node --import tsx` loader: 2,752 tests, 641 suites, 0 failures. A broader full-spec glob
  also passed 2,780 tests, 649 suites, 0 failures. The focused delete spec passed 24/24
  with individually named blocker output.
- `corepack pnpm --filter @watchdog-bms/web test`: sandbox-blocked by the same `tsx` IPC denial.
  `node --import tsx --test "src/**/*.spec.ts"` passed 482 tests, 129 suites, 0 failures.
- `corepack pnpm --filter @watchdog-bms/web typecheck`: passed.
- `corepack pnpm --filter @watchdog-bms/web build`: Turbopack stopped emitting at
  `Creating an optimized production build ...` and was terminated after a bounded wait. The
  explicit webpack fallback compiled in 3.2 seconds, generated 11/11 static pages, and exited 0.
- API `tsc --noEmit` and `git diff --check`: passed.
- Live ~700px viewport validation was not run because the connected browser runtime reported no
  available browser. Static ownership checks, web tests, typecheck, and the webpack production
  build passed.
- Permission sync was not run against an environment; `expense.delete` must ship with the already
  pending `expense.evidence.read` sync.

## Fix evidence — 2026-08-04: a SKIPPED workflow event must not block deletion

`IngestWorkflowEventUseCase` writes a `WorkflowEventInbox` row for every drained outbox event and
marks it `SKIPPED` when no enabled EVENT rule matches. Every `WEB_UPLOAD` draft emits
`expense.receipt_uploaded`, so every such draft accrued a permanent `SKIPPED` row and refused
deletion with `EXPENSE_HAS_LINKED_DATA` / `WORKFLOW_EVENT_INBOX` — the exact drafts this feature
exists to clean up.

- Reproduced on the local stack: expense `cmseoxyan…vw69` (`NEEDS_REVIEW`, `UNPAID`, total 0,
  `WEB_UPLOAD`) had one inbox row — `expense.receipt_uploaded`, `SKIPPED`, processed — and zero
  `WorkflowRun` / `NotificationEvent` rows. Both expense inbox rows in that database were `SKIPPED`.
- The precheck now scopes that one query to `status: { not: 'SKIPPED' }`. `RECEIVED` (still in
  flight) and `FAILED` (never evaluated) still block; `MATCHED` is already covered by the
  `WorkflowRun` blocker that precedes it in the same check. No other blocker changed.
- Focused delete spec: 25 tests / 0 failures, including the `WORKFLOW_EVENT_INBOX` case now
  asserting the status-scoped `where`.
- API `tsc --noEmit`: passed.

## Owner decision — 2026-08-05: a duplicate-candidate reference no longer blocks

Owner: "ใดๆที่ยังไม่ส่งตรวจ หรือสถานะเป็น open draft ก็ควรลบได้นะ เพราะต่อให้ลบแล้ว
อีกใบก็ควรจะขึ้นเป็นไม่ซ้ำแล้ว". The `EXPENSE_DUPLICATE_CANDIDATE` blocker was a dead end with no
user exit: the referencing document had already been REJECTED, `assertDuplicateWriteAllowed`
refuses duplicate writes in that status, and a REJECTED expense is not deletable either — so
neither record could ever be removed. Observed pair: draft `cmseoxyan…vw69` (฿0, `NEEDS_REVIEW`)
referenced by `cmsev2i3z…6jb9` (฿180, `REJECTED`, `POSSIBLE_DUPLICATE`) through one `OPEN` row
scored 75 on `same_checksum` + `same_visual_fingerprint`.

- The blocker is removed. `ExpenseDuplicateCandidate` rows cascade with the deleted expense.
- Before the delete, every expense that referenced it as a `candidateExpenseId` is re-verdicted
  from its remaining candidates using the same rule as `runDuplicateCheck`
  (`CONFIRMED_DUPLICATE` → `POSSIBLE_DUPLICATE` → `OVERRIDDEN` → `NO_MATCH`), with
  `duplicateOfExpenseId` (no FK, so nothing else clears it) and a stale `duplicateOverrideReason`
  cleared. A referencing document whose only candidate was the deleted draft therefore reads as
  not-duplicate, which is what the owner asked for.
- The re-verdicted ids are recorded on the SUCCESS delete audit as
  `duplicateRecheckedExpenseIds`.
- The deletable-state guard is unchanged and still bounds this: DRAFT, or `NEEDS_REVIEW` /
  `READY_FOR_CONFIRMATION` at zero total and `UNPAID`.
- Web dropped the now-unreachable `EXPENSE_DUPLICATE_CANDIDATE` label; unknown blockers still fall
  back to the raw code.
- Focused delete spec: 27 tests / 0 failures, including the re-verdict cases for `NO_MATCH`,
  a surviving `CONFIRMED_DUPLICATE`, and `OVERRIDDEN`. Focused web model spec: 33 tests /
  0 failures. API and web `tsc --noEmit`: passed.

## Owner decision — 2026-08-05: REJECTED is deletable, and its creator may delete it

Owner: "discovery เป็น พนักงานที่อัปโหลด เป็นคนลบได้ก็ต่อเมื่องานถูก reject แล้ว". A rejected record
had no exit: `REJECTED` transitions only back to `NEEDS_REVIEW`
(`expense-status.logic.ts` `ALLOWED_TRANSITIONS`), it has no tab of its own in the list, and it was
not deletable — so it sat in ทั้งหมด forever.

Why this is safe rather than a new grant of power:

- **It never reached the books.** `RejectExpenseUseCase` sets `postingStatus: 'not_required'`, and
  it emits no workflow run, workflow task, or notification event — only an audit row. So the
  linked-data precheck does not block rejected records wholesale, and there is nothing posted to
  preserve. This is the opposite of `VOIDED`, which reverses a `CONFIRMED` posting and stays
  undeletable.
- **The creator could already resubmit it.** `canRestartReview` in `ExpenseReviewPage.tsx` lets the
  creator holding `expense.update` reopen their own rejection to `NEEDS_REVIEW`. Delete adds a clean
  exit, not a new path back into review.
- **Delete-then-reupload does not launder a duplicate.** Detection matches against surviving
  `ExpenseRecord` rows (`findNearDuplicates` + `findExpenseIdsByAttachmentChecksum`). If the receipt
  was legitimately recorded elsewhere, that record is still the anchor and the re-upload still
  flags. The anchor only disappears when the deleted record was the sole copy, in which case the
  re-upload is an ordinary first submission.

Implementation — no permission code changed:

- `isExpenseDeletableState` now returns true for `REJECTED` alongside `DRAFT`, at any amount. The
  zero-total rule guards documents nobody has ruled on yet; a rejection is that ruling.
- The existing gate `expense.delete || (createdByUserId === userId && expense.update)` — in
  `DeleteExpenseUseCase` and in `canDeleteExpense` — already expresses "the uploader may delete it".
  Employees hold `expense.update` via the expense capture capability pack.
- `EXPENSE_NOT_DELETABLE` message updated to name rejected records.
- Delete confirm dialog dropped the word ฉบับร่าง; it names the record and now covers every
  deletable state.

Verification:
- `delete-expense.use-case.spec.ts`: 30 tests / 0 failures — adds delete of a `REJECTED` record at
  its full amount, creator-with-`expense.update` delete, and non-owner denial; `REJECTED` removed
  from the refuse-list case.
- `expenses.model.spec.ts` (web): 35 tests / 0 failures — `canDeleteExpense` owner/permission matrix
  for `REJECTED`.
- API and web `tsc --noEmit`: passed. `packages/contracts` rebuilt (the API resolves the built
  `dist`, so the spec fails against a stale build until `pnpm --filter @watchdog-bms/contracts build`
  runs).

## Owner decisions — 2026-08-05 (round 2): KPI consistency, ปฏิเสธ chip, delete in the detail popup

Four items, found by reading the list surface around the delete work.

1. **รอตรวจสอบ counted two ways on one screen** — the KPI card counted `PENDING_STATUSES`
   (including `DRAFT`), the chip below it excluded `DRAFT`, so the same word read 3 and 2 an inch
   apart. Owner: "ควร consistency ให้ปรับเป็นตั้งแต่ draft เลย" — both now count from `DRAFT`
   onward through `isExpensePending`, the single definition. The ฉบับร่าง chip stays as a narrower
   view of the same rows, not a disjoint bucket. The card's subtitle changed from
   รอการยืนยันจากฝ่ายบัญชี to ยังไม่ยืนยัน รวมฉบับร่าง, which is what it now counts.
2. **Cancelled documents inflated the money cards** — ค่าใช้จ่ายรวม and ภาษีซื้อ (VAT) summed every
   row including `REJECTED` and `VOIDED`; ค้างจ่าย in the same loop already skipped them. The VAT
   card is labelled เครดิตภาษีที่ขอคืนได้, so it was presenting a rejected document's input tax as
   claimable. All three now skip cancelled rows, and the "N รายการในช่วงนี้" subtitle counts the
   same basis. The arithmetic moved to `summarizeExpenseKpis` so it has a spec — it was inline in a
   `useMemo`, which is how the two counts drifted apart unnoticed.
3. **No way to find rejected records** — added a ปฏิเสธ chip. With `REJECTED` now deletable, the
   rows had no filter of their own and appeared only under ทั้งหมด.
4. **Delete existed only on the list row** — `ExpenseReviewPage` had no delete at all, so a user who
   opened a rejected record had to go back to the list to remove it. It now renders the same
   `canDeleteExpense` gate next to ปฏิเสธ/ยกเลิกเอกสาร, with a footer confirmation matching the
   reject/void pattern. Delete does not go through `doAction` — the record is gone on success, so
   reloading it would 404; it navigates back to the list instead.

Verification:
- `expenses.model.spec.ts`: KPI cases built from the four rows the owner had on screen — total 450
  not 630, VAT 11.78 not 23.56, counted 3 not 4, pending 3 matching the chip, and an overdue
  boundary case. Full web suite 693 tests / 0 failures; `tsc --noEmit` passed.
- e2e chip assertions match on `รอตรวจสอบ`/`ยืนยันแล้ว` by name and are unaffected; `TEST-CASES.md`
  EXP-01 updated to list the new chip.

## Consistency sweep — 2026-08-05: every surface that aggregates expenses

Owner asked whether the cancelled-status fix on the list had siblings elsewhere. Every surface that
sums or counts expense records was read.

| Surface | Rejected / voided | Verdict |
|---|---|---|
| Web list KPI cards | were included in total / VAT / item count | fixed this round |
| LINE `expense.list_recent` | included in `totalAmount` and `unpaidAmount` | **bug — fixed** |
| LINE `expense.get_breakdown` | `status: { notIn: ['REJECTED','VOIDED'] }` | already correct |
| Dashboard `ExpenseSummaryProvider` | money metrics scoped to `status: 'CONFIRMED'` | already correct |
| Excel export / accountant package | `request.status ?? 'CONFIRMED'` | already correct |
| Tax `expense-source.adapter` | `CONFIRMED` for events, `VOIDED` only for reversals | already correct |
| Banking `prisma-match-source.query` | `status: 'CONFIRMED'` | already correct |
| Reports `expense.summary` | grouped by status, no cross-status total | already correct |
| หลักฐานทางบัญชี evidence panel | filtered view, defaults to `CONFIRMED`, total labelled with the selected status | already correct |

`expense.list_recent` was the one real sibling: it answers "ค่าใช้จ่ายเดือนนี้เท่าไหร่" over LINE
with no UI to sanity-check it, and it summed every row. Rejecting never clears
`outstandingAmount`, so its `unpaidAmount` reported money the company had already refused to owe —
while `expense.get_breakdown`, one file over, excluded the same rows. The summary now skips
cancelled documents and reports `countedItems` and `cancelledCount` so an answer can state the
basis instead of silently disagreeing with `total`. New spec:
`erp-expense-list-recent.use-case.spec.ts`, registered in the API test list.

### Open decision — the dashboard's ใบเสร็จรอตรวจ count

`ExpenseSummaryProvider` counts `NEEDS_REVIEW` + `READY_FOR_CONFIRMATION` and excludes `DRAFT`,
which no longer matches the list's รอตรวจสอบ now that it counts from `DRAFT`. This was left alone
deliberately: the provider aggregates the whole company, its own spec documents the two worklist
metrics as current-state rather than period-scoped, and a draft is on its author's desk, not the
accounting team's. Two consequences of aligning it, if the owner wants that:

- The dashboard number would grow by every unsubmitted draft in the company.
- It would still not equal the list card, because the dashboard count is all-time by design while
  the list card is scoped to the selected period. Period-scoping it instead would hide stale
  unreviewed receipts, which is the opposite of what the metric is for.

### Related gap, not fixed

ส่งออก Excel exports confirmed expenses only (the API default). On a period with no confirmed
rows — the owner's current data has ยืนยันแล้ว 0 — it produces an empty workbook with no
explanation. Worth a "ไม่มีรายการที่ยืนยันแล้วในช่วงนี้" guard before the download.

Verification: API `tsc --noEmit` passed; line-ai specs 421/421; dashboard + reports + expenses
specs 470/470; web suite 693/693.

## Owner decisions — 2026-08-05 (round 3): both open items closed

**Dashboard ใบเสร็จรอตรวจ now counts from DRAFT**, matching the list. Rather than copying the
status list into a third place, `EXPENSE_PENDING_STATUSES` / `isExpensePending` moved to
`packages/contracts` alongside `isExpenseDeletableState`, and both the web list and
`ExpenseSummaryProvider` import it — the copies are what let the two surfaces drift in the first
place. `EXPENSE_CANCELLED_STATUSES` / `isExpenseCancelled` moved with them for the same reason.
The metric stays current-state rather than period-scoped: period-scoping would hide stale
unreviewed receipts, which is what the number exists to surface, so it still will not equal the
period-scoped list card.

Consequence worth watching: the card's severity is `pendingReview > 0 ? 'warning' : 'normal'`, so a
single unsubmitted draft anywhere in the company now paints the dashboard card warning. Left as-is
— changing the threshold is a separate product call.

**ส่งออก Excel no longer downloads an empty workbook.** The package covers confirmed expenses only;
when `rowCount` is 0 the button now reports ไม่มีรายการที่ยืนยันแล้วในช่วงนี้ จึงยังส่งออกไม่ได้
instead of handing over a file that reads as a broken export. The notice clears when the period,
branch, chip, or search changes.

Verification: contracts rebuilt; API `tsc --noEmit` and web `tsc --noEmit` passed; dashboard +
line-ai + expenses API specs 829/829 (including a new provider case asserting the query uses the
shared constant); web suite 693/693.
