# Agent Memory: Expense VAT Source Capture and Reconciliation

Status: Core implementation verified; PR #188 is open against develop.

Owner: Product / Finance / Expense team.

Scope:

- Preserve source VAT rate/amount independently from system calculation.
- Reconcile to one accepted expense/tax/ledger/report VAT amount.
- Cover OCR, review UX, persistence, confirmation, WHT, Transaction Tax, ledger, export,
  compatibility, and migration.
- Contracts, migration, ERP reconciliation, OCR/LINE shared apply, expense review UI,
  confirmation/checksum/audit boundaries, and focused tests.

Decisions:

- Add one nullable, versioned ExpenseRecord.vatCaptureSnapshotJson.
- Keep current ExpenseRecord and ExpenseLine money columns authoritative.
- Public input is source-only: RATE, AMOUNT, BOTH, or NONE.
- vatRatePercent uses 7.0000 for 7%; current ExpenseLine.vatRate remains 0.07.
- Preserve source, calculation, reconciliation, accepted source, residual, and calculation
  version separately.
- Use HALF_UP/2 and fixed capture tolerance ฿0.05; stricter tax profile wins downstream.
- Accept an in-tolerance source amount exactly and allocate residual deterministically.
- Do not auto-allocate ambiguous mixed-rate documents.
- Persist bounded line sources in the same snapshot and reconcile each mixed VAT group
  independently.
- Reviewer source wins over later OCR.
- A pre-OCR create with no explicit vatSource does not persist synthetic REVIEWER/NONE
  precedence; an explicit NONE remains a reviewer decision.
- Amount-only derivation never overwrites explicit line rates. Partial known/unknown or stale
  line allocation remains NEEDS_REVIEW without partially accepting source VAT.
- SIMPLE keeps Tax Code/claimability hidden but conditionally shows document VAT arithmetic
  when evidence, stored VAT, WHT, or explicit reviewer intent requires it.
- ExpenseRecord.taxableAmount remains the compatible total before VAT; the snapshot records
  VAT-bearing base separately for mixed documents.
- No historical backfill, no new dependency, and no package.json change.
- Keep the fixed accountant CSV/XLSX column contract unchanged; add source/calculation fields
  only through a future versioned export schema.

Open questions:

- None blocking the plan. Accountant/tax-owner UAT must validate display terminology and
  stricter tax-profile behavior before release.

Artifacts:

- [[specs/expense-vat-source-reconciliation-spec|Expense VAT Source Capture and Reconciliation Spec]]
- [[plans/expense-vat-source-reconciliation-plan|Expense VAT Source Capture and Reconciliation Plan]]
- [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]] section 19l.
- Pull request: https://github.com/MangmeeDev/mangmeeplus/pull/188

Verification:

- Current OCR, review, calculation, confirmation/CAS, Transaction Tax, ledger, export,
  persistence, and related specs were inspected on 2026-08-19.
- Prisma schema validation and client generation passed.
- Contracts, API, and web typechecks passed; API and web production builds passed.
- Full API suite and its pretest passed.
- Full web suite passed 969 tests; full contracts suite passed 137 tests.
- Focused VAT/update suite passed 57 tests, including ±฿0.05 tolerance boundaries,
  deterministic residual tie-breaks, mixed/zero/unknown handling, stale line evidence,
  WHT recomputation, and public-input guards.
- OCR regressions cover upload/LINE shared apply, amount/rate separation, mixed lines,
  additional charges, stale apply, reviewer precedence, and changed re-extraction layouts.
- Downstream Transaction Tax, tax adapter, journal, template posting, fixed export contract,
  and reimbursement coverage passed in the full API suite.
- Rebased onto origin/develop at 03e620d; full API and web suites passed again after rebase.
- git diff --check passed.

Next:

- Follow up with browser/accountant UAT, rollout metrics/kill switch, and a versioned
  evidence-export extension before release.
