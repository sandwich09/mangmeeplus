# Agent Memory: Receipt Additional Charges and Total Reconciliation

Status: Complete
Owner: Codex
Scope: Docs, OCR contract/parser, expense totals/apply, web review, confirmation, and focused ledger/tax verification.
Decisions: Reuse `ExpenseLine`; additive charges only; discounts remain existing field; WHT uses existing columns; no migration/dependency; split only when totals reconcile within ฿0.05; otherwise preserve gross in summary line.
Open questions: None blocking. Deposit/credit allocation, credit/debit notes, refunds, and FX are explicitly deferred.
Artifacts: `docs/specs/receipt-additional-charges-reconciliation-spec.md`; `docs/plans/receipt-additional-charges-reconciliation-plan.md`.
Verification: API expense focused tests 84/84; AI Gateway controller/cross-check tests 28/28; web expense model tests 20/20; ledger/tax focused tests 17/17; contracts/API/AI Gateway/web TypeScript checks passed; `git diff --check` passed. UI browser smoke not run because the change reuses the existing responsive line grid and no app server/session was in scope.
Next: Re-run OCR on affected historical drafts or correct them manually. Deposit/credit allocation remains a separate future spec.
