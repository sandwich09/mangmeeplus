# Agent Memory: line-ai-draft-control

Status: docs approved (Owner 2026-09-05, 5 decisions) → building slices A/B in parallel, then C, then D
Owner: Owner (product) · Fable (control) · Opus (implementation)
Scope: spec `docs/specs/line-ai-draft-control-spec-th.md`, plan `docs/plans/line-ai-draft-control-plan-th.md`
Decisions: service charge first-class (chargeKind), no silent today-date, receipt-mode BE dates with recorded assumptions, `unsupported_yet` refusal split from `unsupported_module`, LINE draft edits behind preview+confirm postback and `LINE_AI_DRAFT_EDIT_ENABLED` (default off), one UAT deploy after everything.
Open questions: Q1 (no-VAT-evidence charge → NEEDS_REVIEW), Q2 (edit allowed up to READY_FOR_CONFIRMATION) — spec defaults stand unless the Owner objects.
Artifacts: branches `codex/line-ai-truth-and-dates` (A), `codex/expense-charge-kind` (B), `codex/line-ai-explain-record` (C), `codex/line-ai-draft-edit` (D)
Verification: per slice — api fixed-list, typecheck, prisma validate, pins --check, web test/build when web touched, mutation table, security eval (D), local LINE-fake drive (J2–J4)
Next: A + B implementation → review → PR develop; C after B; D after C; single develop→main PR; UAT deploy on Owner order.

## Slice B — `codex/expense-charge-kind` (S-1, service charge first-class)

Status: implemented, gates green, pushed; not reviewed, no PR.

What it does: `ExpenseLineChargeKind` enum + nullable `ExpenseLine.chargeKind`, additive migration
`20260905160000_expense_line_charge_kind` (no backfill). `subtotalAmount` becomes goods-only, so the
§5.1 identity `taxable = subtotal - discount + charges` and `total = taxable + vat` hold and are
enforced at the write boundary (`expenseTotalsIdentityError`, called from
`validateExpenseDraftAmounts`, the same validator the web PATCH uses). Charge rows must be quantity
1, positive unless ROUNDING, and sorted after every product row. OCR apply names a charge in Thai
with the printed percent; `expense.get_detail` and `ExpenseDetail` gain a derived `charges` group;
the web review page renders "ค่าใช้จ่ายเพิ่ม" and a "ค่าบริการ/ค่าใช้จ่ายเพิ่ม" money row.

Boundaries kept for slice A (`codex/line-ai-truth-and-dates`): the VAT/WHT rules for charge lines
and the LINE summary card grouping. Slice B touched only the kind and the description inside
`receipt-ocr-apply.service.ts` so the two branches merge cleanly; B rebases onto A before PR.

Known gap (§10, deliberate): additional charges still post to the record's expense category — no
separate "ค่าบริการ" account and no report by charge kind. The accountant index CSV column
`subtotal_amount` now means goods-only for a bill with charges; `taxable_amount` and every total are
unchanged.
