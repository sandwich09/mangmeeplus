# Expense WHT input units and mixed-VAT implementation plan

Spec: [expense-wht-input-units-mixed-vat-spec](../specs/expense-wht-input-units-mixed-vat-spec.md)
Base: `origin/develop@a53bb992`, isolated branch `codex/wht-input-units-mixed-vat`.

- [x] Inspect current develop, expense/VAT specs, call sites and legacy review evidence; use ponytail full.
- [x] Freeze bounded input, persistence, whole-bill versus legacy-line, and unknown-tax boundaries.
- [x] Add shared contracts and additive schema migration; preserve repository mappings/checksum.
- [x] Implement authoritative WHT arithmetic/create/update/OCR and downstream amount-only facts.
- [x] Preserve explicit zero-VAT treatment across line capture/persistence/finalization.
- [x] Add clear unit/value UI, validation and save/reload with legacy mixed-rate preservation.
- [x] Run focused regression suites, contracts build, API/web typechecks and safe browser checks.
- [x] Review scoped diff; fetch concurrent develop updates and rerun affected checks (base unchanged).
- [x] Commit/push feature branch, integrate non-force into develop (respect protection), verify remote containment.

Evidence and exact commands/results belong in the task memory. No UAT/Production deployment.
