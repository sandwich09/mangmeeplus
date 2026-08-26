# Agent Memory: flowaccount-accounting-product-audit

Status: Documentation and structural verification complete; pending owner/product/accounting review

Owner: Product owner + Lead developer

Scope:

- Read-only inspection of the user-provided FlowAccount test account
- Public FlowAccount workflow documentation and Thai Revenue Department sources
- Product research, Mangmee Accounting OS spec, implementation plan, and knowledge spec
- No FlowAccount mutations and no application code changes

Decisions:

- Treat FlowAccount as workflow/UX evidence, not legal truth or a UI clone target.
- Use one source document/payment/tax/ledger/inventory lineage; do not create separate Auto Revenue accounting truth.
- Make task-first beginner UX and accountant detail two views of the same data.
- Keep model-proposes/code-verifies; AI Gateway uses permission-checked ERP tools only.
- The urgent 2.5-day slice is P1–P5 stabilization/evidence, not delivery of a complete accounting suite.
- Mixed VAT and post-submit navigation are stop-ship issues for the existing expense journey.
- High-risk accounting/tax knowledge requires official sources, effective dates, named expert approval, fixtures, and expiration.

Open questions:

- First post-beta vertical slice: Sell-to-Cash or Procure-to-Pay/Expense.
- Named accountant/tax reviewers and pilot business profile.
- First bank/payment/marketplace connector and inventory costing policy.
- First filing scope: prepare/report/export versus direct filing.

Artifacts:

- docs/research/flowaccount-accounting-product-audit-2026-08-26-th.md
- docs/specs/mangmee-accounting-operating-system-spec-th.md
- docs/plans/mangmee-accounting-os-implementation-plan-th.md
- docs/specs/mangmee-accounting-tax-knowledge-spec-th.md

Verification:

- Browser exploration was read-only: no save, approve, payment, filing, upload, import, or download action.
- Sensitive account/customer/bank/project identifiers were intentionally excluded from artifacts.
- Relative Markdown links resolve; whitespace/diff checks passed for all five new files.
- Sensitive-value scan found no copied test-account identifiers in the artifacts.

Next:

- Owner reviews the P1–P5 urgent scope and chooses the first post-beta vertical slice.
- Accountant/tax expert reviews posting/tax baselines before implementation.
- Revalidate old readiness findings on the exact current SHA before assigning implementation status.
