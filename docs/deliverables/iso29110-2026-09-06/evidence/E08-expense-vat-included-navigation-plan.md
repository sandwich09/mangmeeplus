# Expense VAT-included navigation plan

Spec: [expense-vat-included-navigation-spec](../specs/expense-vat-included-navigation-spec.md).
Base: origin/develop a53bb992; branch codex/vat-included-navigation.

- [x] Read audit, existing source-VAT/unknown-rate specs, callers and ponytail full.
- [x] Confirm amount source is saved without a rate but blocked before server derivation.
- [x] Implement source-aware missing-rate validation using existing amount helper.
- [x] Show an actionable footer validation message and focus the invalid control.
- [x] Add focused client/server regressions and synthetic local browser verification.
- [x] Run source-local contract/config builds, API/web typechecks and relevant tests.
- [x] Coordinate WHT overlap; integrate latest develop and rerun affected checks.
- [x] Commit/push scoped feature; integrate non-force into develop; verify remote containment.

No live database, cloud operation or release/deployment is authorized.
