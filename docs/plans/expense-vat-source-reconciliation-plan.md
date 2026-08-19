# Expense VAT Source Capture and Reconciliation Implementation Plan

## Status

- Date: 2026-08-20
- Status: Core implementation ready for review; rollout and UAT follow-ups remain open
- Owner: Expense / Tax / Ledger / Web teams
- Spec: [[specs/expense-vat-source-reconciliation-spec|Expense VAT Source Capture and Reconciliation]]
- Parent: [[specs/expense-receipt-upload-spec|Expense Receipt Upload]]

## Outcome

Persist source VAT from receipt/OCR/reviewer, compare it with versioned server calculation,
and keep exactly one accepted VAT amount through expense confirmation, Transaction Tax,
ledger posting, and exports.

This plan deliberately uses one nullable snapshot on ExpenseRecord and reuses current
accepted header/line fields. It introduces no fee-specific columns, no new dependency, and
no historical balance rewrite.

## Current Repository Evidence

- packages/contracts/src/expenses.ts owns public expense draft/detail contracts.
- packages/contracts/src/line-ai.ts owns receipt OCR vatRate, taxableAmount, vatAmount,
  grandTotalAmount, and vatMode fields.
- apps/api/prisma/schema.prisma owns ExpenseRecord and ExpenseLine accepted columns.
- apps/api/src/modules/expenses/domain/logic/expense-totals.logic.ts owns inclusive/exclusive
  line arithmetic and satang rounding.
- apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts completes
  OCR VAT fields and creates accepted lines.
- apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts recomputes
  totals on review save and confirms drafts.
- apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts owns confirmation
  validation and expenseTaxSourceChecksum.
- apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts maps persistence
  and performs the atomic confirmation checksum guard.
- apps/web/src/features/expenses/expenses.model.ts currently converts a typed printed VAT
  amount into a rate; ExpensesPages.tsx keeps that amount only in vatEditors local state.
- docs/specs/vat-registration-aware-expense-capture-spec.md currently hides VAT controls in
  SIMPLE mode; this plan preserves the simple no-VAT path but adds a conditional,
  non-claimable document-arithmetic card.
- apps/api/src/modules/expenses/application/services/expense-transaction-tax.service.ts
  sends accepted line vatAmount as enteredTaxAmount.
- apps/api/src/modules/tax/domain/logic/transaction-tax.logic.ts compares entered tax with
  tax-code calculation and policy tolerance.
- apps/api/src/modules/expenses/domain/logic/expense-auto-post.logic.ts and
  apps/api/src/modules/ledger/application/use-cases/expense-auto-post.use-case.ts consume
  accepted expense values for posting.

## Change Boundaries

### In Scope

- Shared typed VAT source/snapshot/reconciliation contracts.
- Additive nullable ExpenseRecord snapshot migration.
- One pure ERP Core reconciler for calculation, tolerance, residual allocation, and invariants.
- OCR source capture before deterministic completion and reviewer-precedence on re-extraction.
- Draft read/write, confirmation gate/checksum, audit, and expense detail evidence.
- Document-level VAT card with mixed-line fallback.
- Transaction Tax, ledger, WHT, and existing report invariant verification.
- Backward-compatible rollout and UAT fixtures.

The fixed accountant CSV/XLSX column contract is deliberately unchanged in this slice.
Source/calculated/status export fields require a separately versioned column set so existing
machine consumers do not receive a silent schema change.

### Out of Scope

- Tax-code inference from OCR, claimability-policy redesign, WHT redesign, FX, refunds,
  credit/debit notes, payment allocation, historical backfill, and automatic mixed-rate OCR
  allocation.

## Mandatory Implementation Rules

- ERP Core is the only authority for calculation and final mutation.
- Public clients submit source intent only.
- Existing accepted header/line fields remain the only posting totals.
- Explicit percent/fraction conversion occurs at named adapters and is tested.
- Source amount is never transformed into a percentage.
- Unknown, zero, exempt, and non-VAT remain distinct.
- No package.json changes and no new dependency.
- Each phase must land with its focused runnable check before the next consumer depends on it.

## Phase 0: Freeze Contracts and Golden Fixtures

### Tasks

- [ ] Record current fraction-based ExpenseLine.vatRate behavior and percent-based UI/source
  behavior in contract tests.
- [ ] Add golden inputs for inclusive ฿414/฿27.08, exclusive 7%, amount-only, rate-only,
  both, 0%, exempt, non-VAT, mixed-rate, and one-satang residual.
- [ ] Record current WHT and additional-charge arithmetic around each fixture.
- [ ] Freeze accepted header/line, Transaction Tax, ledger, and export outputs for unaffected
  cases.

### Exit Evidence

- Existing tests pass and golden fixtures demonstrate current gaps without changing behavior.

## Phase 1: Contracts and Additive Persistence

### Touchpoints

- packages/contracts/src/expenses.ts
- packages/contracts/src/line-ai.ts only if evidence metadata needs a bounded addition
- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/<timestamp>_expense_vat_capture_snapshot/migration.sql
- apps/api/src/modules/expenses/domain/models/expense.model.ts
- apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts
- Expense DTO tests and web API/model types

### Tasks

- [x] Add ExpenseVatSourceInput, bounded mixed-document line sources, and versioned
  ExpenseVatCaptureSnapshotV1.
- [x] Add nullable vatCaptureSnapshotJson to ExpenseRecord; do not backfill.
- [x] Map snapshot through repository, detail response, update internals, and audit-safe
  serialization.
- [x] Reject public calculation, origin, reconciliation, residual, and version fields.
- [x] Preserve compatibility when vatSource and snapshot are absent.

### Tests

- [x] Contract validation for RATE/AMOUNT/BOTH/NONE, zero, decimal precision, and units.
- [x] Boundary tests proving derived-field forgery is rejected.
- [ ] Repository round-trip and null legacy record tests.
- [ ] Migration apply/rollback check on a representative database.

### Exit Evidence

- API can read/write a nullable source snapshot without changing any accepted total.

## Phase 2: Central Server Reconciler

### Touchpoints

- apps/api/src/modules/expenses/domain/logic/expense-totals.logic.ts
- New focused expense-vat-reconciliation.logic.ts beside current totals logic
- apps/api/src/modules/expenses/domain/logic/expense-draft-amount-validation.logic.ts
- apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts

### Tasks

- [x] Implement pure inclusive/exclusive/zero/not-applicable calculation with HALF_UP/2.
- [x] Convert vatRatePercent to the existing fraction exactly once.
- [x] Produce calculated values, signed difference, tolerance status, accepted source, and
  version.
- [x] Accept source amount exactly when within ฿0.05; block outside tolerance.
- [x] Apply deterministic residual to largest eligible taxable line with stable tie-break.
- [x] Keep included gross fixed; keep excluded taxable fixed.
- [x] Reconcile line-source groups independently and refuse unsupported cross-group allocation.
- [x] Recompute WHT and net payable after an included-VAT base adjustment.
- [x] Assert header equals line sums and all accepted identities.

### Tests

- [x] Formula and tolerance boundaries: 0.00, 0.01, 0.05, and 0.06.
- [x] Positive/negative residual, tie-break stability, and multiple-line rounding.
- [x] Discount/additional-charge/WHT combinations.
- [x] Zero versus missing, exempt versus non-VAT, and mixed-rate blocking.
- [ ] Property-style table tests for gross = taxable + VAT and header = lines.

### Exit Evidence

- One pure function returns the accepted lines/totals and complete snapshot for all fixtures.

## Phase 3: OCR Apply and Re-extraction

### Touchpoints

- packages/contracts/src/line-ai.ts
- apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts
- apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts
- apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts
- Existing AI Gateway prompt/parser/value-membership tests when needed

### Tasks

- [x] Normalize raw OCR rate and amount independently from deterministic completion.
- [x] Keep deterministic completion in calculation only.
- [ ] Map OCR evidence references without copying raw payload.
- [x] Preserve reviewer-origin source across retry/re-extraction.
- [x] Allow explicit reviewer clear to return source ownership to NONE.
- [x] Preserve current stale-extraction and tenant/evidence guards.

### Tests

- [x] Amount-only remains source amount even when calculation derives a rate.
- [x] Rate-only calculates without inventing source amount.
- [x] BOTH reconciles or marks review.
- [x] OCR retry cannot overwrite reviewer source.
- [x] Stale OCR cannot overwrite a newer draft.
- [x] Web upload and LINE use identical ERP reconciliation.

### Exit Evidence

- Every new OCR draft has explainable source/calculation separation without new OCR authority.

## Phase 4: Draft Save, Confirmation, Audit, and CAS

### Touchpoints

- apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts
- apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts
- apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts
- apps/api/src/modules/expenses/presentation/http/expense.dtos.ts
- Expense use-case, DTO, repository, and atomic-confirm tests

### Tasks

- [x] Parse vatSource and call the reconciler during create/update.
- [ ] Persist lines, headers, WHT/net, and snapshot atomically.
- [x] Add visible confirmation errors for MISMATCH, NEEDS_REVIEW, and unsupported mixed VAT.
- [x] Add snapshot source/version/status/accepted values to expenseTaxSourceChecksum.
- [x] Re-read snapshot inside atomic confirm CAS.
- [x] Add bounded audit metadata for reviewer VAT source changes.
- [x] Keep confirmed records immutable.

### Tests

- [ ] Save/reload round-trip and legacy absent-source behavior.
- [ ] Permission/tenant tests.
- [ ] expectedUpdatedAt and source-checksum concurrency conflicts.
- [ ] Concurrent line, source, tax code, or evidence update blocks confirmation.
- [ ] Accepted headers/lines remain equal after reload.

### Exit Evidence

- A draft cannot confirm with unresolved reconciliation or a stale VAT source revision.

## Phase 5: Web Review UX

### Touchpoints

- apps/web/src/features/expenses/expenses.model.ts
- apps/web/src/features/expenses/expenses.api.ts
- apps/web/src/features/expenses/ExpensesPages.tsx
- apps/web/src/features/expenses/ExpenseReviewPage.tsx
- apps/web/src/features/expenses/expense-review-validation.ts
- apps/web/src/common/i18n/workspace-dictionary.ts
- Existing expense model, validation, component, and review-step tests

### Tasks

- [x] Replace transient vatEditors printed amount with hydrated vatSource state.
- [x] Add included/excluded mode and source-format controls with explicit units.
- [x] Show source/calculated/difference/accepted/base/gross read-only summary.
- [x] Distinguish total before VAT from VAT-bearing base; collapse to one labelled row when
  they are equal and group bases by rate/treatment for mixed documents.
- [x] Keep WHT in a visually separate card.
- [x] In SIMPLE, keep the no-VAT path minimal; reveal document arithmetic only for OCR/stored
  VAT, WHT base dependency, or explicit ใบนี้ระบุ VAT, without revealing Tax Code/claimability.
- [x] Show validation next to active controls and at the primary action.
- [x] Use document card for uniform VAT; keep per-line fallback for mixed documents.
- [ ] Keep mobile numeric keyboard, touch target, overflow, and sticky action behavior usable.
- [ ] Remove the rate-backsolving path once no supported screen depends on it.

### Tests

- [x] 7% and ฿27.08 payloads preserve their units.
- [x] Refresh/reopen restores source and comparison.
- [ ] Non-registered/SIMPLE with VAT evidence still shows document arithmetic.
- [ ] SIMPLE with no VAT evidence stays minimal and submits no claim path.
- [ ] Hidden fields never own the only blocking error.
- [ ] 27.08 cannot enter WHT rate via VAT interaction.
- [x] Mixed and uniform layouts have correct controls.
- [x] Mixed line sources survive reload and cannot reference a line outside the submitted expense.

### Exit Evidence

- A reviewer can understand and save either source unit without manual calculation.

## Phase 6: Transaction Tax, Ledger, WHT, and Reports

### Touchpoints

- apps/api/src/modules/expenses/application/services/expense-transaction-tax.service.ts
- apps/api/src/modules/tax/domain/logic/transaction-tax.logic.ts
- apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts
- apps/api/src/modules/expenses/domain/logic/expense-auto-post.logic.ts
- apps/api/src/modules/ledger/application/use-cases/expense-auto-post.use-case.ts
- apps/api/src/modules/tax/application/use-cases/generate-vat-report.use-case.ts
- apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts

### Tasks

- [x] Verify the existing Transaction Tax adapter sends accepted VAT as enteredTaxAmount and retains configured expected VAT for review.
- [x] Verify the existing tax-profile reconciliation remains the stricter downstream gate.
- [ ] Add a server-only accepted-tax override only if current Transaction Tax cannot preserve
  the accepted source amount; do not expose a client override.
- [x] Verify claimable/non-claimable consumers continue to use accepted expense values.
- [x] Verify WHT uses the final accepted taxable base.
- [ ] Add source/calculated/difference/status/version fields to a versioned accountant evidence export; do not append to the fixed legacy CSV contract.
- [x] Keep existing vatAmount semantics and duplicate-detection keys unchanged.

### Tests

- [ ] Expense header = lines = Tax snapshot/event = VAT report = journal VAT.
- [ ] Non-claimable VAT remains cost and foreign VAT does not auto-map to PP30.
- [ ] Tax-code conflict blocks tax/posting even when receipt capture matches.
- [ ] Journal remains balanced for included/excluded residual cases.
- [ ] Export labels accepted/source/calculated values unambiguously.

### Exit Evidence

- No downstream consumer observes a second final VAT amount.

## Phase 7: Compatibility and Rollout

### Tasks

- [ ] Deploy nullable migration and backward-compatible API first.
- [ ] Enable snapshot writes/reconciler before the new UI.
- [ ] Enable OCR source capture, then UI, then strict confirmation for snapshot-aware drafts.
- [ ] Treat confirmed null snapshots as LEGACY_UNAVAILABLE.
- [ ] Populate mutable legacy drafts only on next save/re-extraction.
- [ ] Add metrics for input type, mismatch status, residual, confirmation block, and legacy use.
- [ ] Add a kill switch that hides UI/stops new writes without altering accepted totals.
- [ ] Document that rollback needs no accounting data reversal.

### Exit Evidence

- Old/new clients coexist during rollout; historical confirmed balances and posts do not move.

## Phase 8: Verification and UAT

### Required Checks

- [ ] Focused contracts, API domain/use-case/repository, OCR, web, tax, ledger, and export tests.
- [x] Typecheck affected packages/apps.
- [x] Schema/migration validation.
- [ ] Browser UAT on desktop and mobile for all golden fixtures.
- [ ] Accountant review of displayed base/VAT/gross and evidence export.
- [ ] Security review of permissions, tenant scope, derived-field rejection, audit, and CAS.
- [ ] Regression for expense upload, review steps, additional charges, WHT, duplicate handling,
  reimbursement, confirmation, posting, VAT report, and void/reversal.

### UAT Acceptance

- [ ] Starbucks ฿414/฿27.08 succeeds without manual percent calculation.
- [ ] Amount-only, rate-only, both, included, and excluded save/reload identically.
- [ ] One-satang accepted residual reaches report and ledger exactly.
- [ ] Outside-tolerance and mixed-rate ambiguity cannot confirm.
- [ ] Non-registered company sees arithmetic but cannot incorrectly claim VAT.
- [ ] Confirmed legacy record is unchanged.

## Risk Register

| Risk | Prevention | Detection |
| --- | --- | --- |
| 7 interpreted as 700% or 0.07% | Named percent/fraction fields and one adapter | Boundary tests and telemetry |
| Two final VAT values | Existing fields stay authoritative | Cross-module equality tests |
| Included VAT double counted | Formula and invariant in one reconciler | Golden journal test |
| Header/line rounding drift | Deterministic residual | Sum assertion on save/confirm |
| OCR overwrites reviewer | Source origin/precedence | Re-extraction tests/audit |
| Tax code silently changes accepted VAT | Stricter tolerance and block | Tax reconciliation test |
| WHT stale after base adjustment | Atomic recomputation | Combined VAT/WHT fixture |
| New UI on old API loses source | Capability/feature gate | Compatibility test |
| Historical values change | No backfill; nullable snapshot | Pre/post migration comparison |
| Existing dirty UI work conflicts | Rebase narrowly; preserve unrelated edits | Scoped diff review |

## Completion Gate

Implementation is complete only when:

- all spec acceptance criteria have automated or recorded UAT evidence;
- accepted VAT agrees through Expense, Transaction Tax, reports, and ledger;
- permission, concurrency, audit, loading/error, and mobile states are verified;
- migration/rollback evidence is recorded;
- linked spec, this plan, and agent memory reflect final behavior.
