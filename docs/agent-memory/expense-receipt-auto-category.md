# Agent Memory: expense-receipt-auto-category

Status: COMPLETE
Owner: Codex
Scope: Add evidence-bound automatic selection of one active expense reporting category to the shared web/LINE receipt OCR draft pipeline.
Decisions:
- Reuse the existing receipt OCR request and shared apply transaction; do not add an AI tool, endpoint, schema migration, or dependency.
- The API supplies the active company/global category catalogue and revalidates the selected ID at write time.
- Auto-fill requires confidence at least 0.85 plus exact OCR evidence, and never overwrites an existing header category.
- Keep header and the single OCR-derived line category aligned. Category never controls GL, tax, confirmation, payment, or posting.
Open questions: None for the first slice. Multi-line category splitting remains backlog.
Artifacts:
- `docs/specs/expense-receipt-upload-spec.md` §19e
- `docs/plans/expense-receipt-upload-plan.md` focused follow-up dated 2026-07-30
Verification:
- Contracts build and typecheck passed.
- AI Gateway receipt controller/parser/classification tests passed 27/27; AI Gateway typecheck passed.
- API shared apply, web extraction, and LINE webhook tests passed 77/77; API typecheck passed.
- Tests cover valid catalogue suggestions, unknown IDs, absent exact evidence, confidence threshold, active tenant/global query guard, existing-category preservation, header/line parity, web missing-field normalization, and LINE catalogue/reply wiring.
- `git diff --check` passed.
Next: Optional production calibration with representative receipts and the configured OCR/model providers. Multi-line category splitting remains backlog.
