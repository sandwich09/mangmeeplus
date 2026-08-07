# Receipt Additional Charges and Total Reconciliation Implementation Plan

## Linked Spec

- Spec: [[specs/receipt-additional-charges-reconciliation-spec|Receipt Additional Charges and Total Reconciliation Spec]]
- Related specs: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]], [[specs/typhoon-receipt-ocr-spec|Typhoon Receipt OCR Spec]]
- Related guidelines: [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style]], [[guidelines/web-frontend-code-style|Web Frontend Code Style]]

## Purpose

Implement evidence-backed receipt charges and WHT without adding fee-specific database columns, while keeping OCR, review-save, confirmation, ledger, and tax totals consistent.

## Current Repository Context

- `packages/contracts/src/line-ai.ts` owns the receipt OCR wire contract.
- `apps/ai-gateway/.../line-ai-internal.controller.ts` owns the stage-two prompt, parser, and OCR value cross-check.
- `apps/api/.../receipt-ocr-apply.service.ts` owns insertion of OCR fields and derived lines.
- `apps/api/.../expense-totals.logic.ts` owns server arithmetic.
- `apps/api/.../expense-draft.use-case.ts` owns review save and confirmation.
- `apps/web/src/features/expenses` already edits generic lines and warns on AI total mismatch.
- Ledger/tax adapters already consume final expense totals/lines.

## Implementation Rules

- Reuse `ExpenseLine`; no fee-specific columns or migration.
- Keep AI output advisory and bounded.
- Preserve raw OCR provenance.
- Reconcile before generating multiple lines.
- Keep final arithmetic and confirmation gates in ERP Core.
- Add no dependency.

## Scope

### In Scope

- OCR `additionalCharges`, `whtRate`, and `whtAmount`.
- Exact-evidence parser and nested numeric cross-check.
- Explicit zero VAT/WHT rate preservation.
- Reconciled charge lines with summary fallback.
- Server confirmation mismatch guard.
- Non-claimable printed-VAT confirmation compatibility.
- Web WHT-rate review input and zero-rate payload preservation.

### Out of Scope

- Deposit/credit allocation, credit/debit notes, refunds, FX conversion, new tax-code inference, and historical migration.

## Phase 0: Discovery and Alignment

### Tasks

- [x] Read receipt/tax specs, contracts, OCR flow, totals, review UI, confirmation, ledger, and tax adapters.
- [x] Confirm `ExpenseLine` can represent positive charges without migration.
- [x] Identify explicit zero VAT-rate bug and confirmation snapshot impact.
- [x] Record settlement/credit/FX boundaries.

### Exit Criteria

- Spec defines contracts, math, trust boundaries, impact, acceptance, and exclusions.

## Phase 1: Contracts and AI Gateway

### Tasks

- [x] Add bounded charge kinds/type and optional WHT fields.
- [x] Update OCR prompt with additive-only charge rules.
- [x] Parse at most 10 evidence-backed charges.
- [x] Cross-check nested charge/WHT amounts and rates.

### Tests

- Focused AI Gateway controller/cross-check tests.
- Contracts and AI Gateway typecheck.

### Exit Criteria

- Invalid nested model output cannot reach ERP Core.

## Phase 2: ERP Totals and OCR Apply

### Tasks

- [x] Preserve explicit rate zero in `calcLineTotals`.
- [x] Build candidate base/charge lines using existing arithmetic.
- [x] Accept split lines only within ฿0.05 VAT/grand-total tolerance.
- [x] Fall back to one stable summary line otherwise.
- [x] Apply printed WHT to line/header/net payable.
- [x] Return bounded reconciliation metadata.

### Tests

- Focused totals and OCR apply tests for VAT/no-VAT/zero-rate/WHT/fallback.

### Exit Criteria

- Every accepted/fallback draft round-trips through review-save without changing the printed gross.

## Phase 3: Review and Confirmation

### Tasks

- [x] Preserve explicit zero rates in web review payload.
- [x] Add WHT-rate review input.
- [x] Block unresolved OCR-total mismatch at confirmation.
- [x] Allow an intentional finance-reviewed correction.
- [x] Require Tax Code snapshots only for claimable VAT.

### Tests

- Web model tests.
- Expense confirmation/domain tests.

### Exit Criteria

- UI and server share the same reviewed-total boundary.

## Phase 4: Integration Verification

### Tasks

- [x] Run focused API, AI Gateway, contracts, and web tests.
- [x] Run relevant typechecks.
- [x] Run existing ledger/tax focused checks.
- [x] Update linked expense/Typhoon specs and task memory with evidence.

## Integration Verification

- Backend/API contract: OCR fields compile and apply atomically.
- Web journey: charge lines visible/editable; zero rates survive payload.
- Loading/error/permission states: unchanged existing paths; confirm error shown by existing banner.
- E2E/browser check: not required for layout-neutral line reuse unless UI input rendering changes unexpectedly.
- Commands: recorded in task memory on completion.

## Risks

- Model duplicates a printed discount as an additive charge: exact reconciliation forces fallback.
- Mixed tax treatment cannot be proven: fallback preserves gross and requires review.
- Historical drafts remain unchanged until OCR rerun/manual edit.
- Existing claimable tax invoices still require tax-code selection per line.

## Open Questions

- None blocking this slice.
