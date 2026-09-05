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

Status: implemented, gates green, pushed. Reviewed once adversarially (2026-09-05) and reworked;
no PR yet.

What it does: `ExpenseLineChargeKind` enum + nullable `ExpenseLine.chargeKind`, additive migration
`20260905160000_expense_line_charge_kind` (no backfill). `subtotalAmount` becomes goods-only, so
`taxable = subtotal - discount + charges` and `total = taxable + vat` hold. Charge rows must be
quantity 1, non-zero, positive unless ROUNDING, and sorted after every product row. OCR apply names
a charge in Thai with the printed percent and keeps the extractor's own wording in `sourceLineText`;
`ExpenseDetail` gains a derived `charges` group and a `totalsIdentity` flag; the web review page
renders "ค่าใช้จ่ายเพิ่ม" and a "ค่าบริการ/ค่าใช้จ่ายเพิ่ม" money row.

Where the §5.1 identity is actually enforced (the first cut got this wrong and said "enforced at the
write boundary" while only calling it somewhere it could not fail):

- `CreateExpenseDraftUseCase` / `UpdateExpenseDraftUseCase` — header totals from
  `reconcileExpenseVat` against the lines `TransactionTaxService.resolveLines` returned. Two
  sources, one write; a mismatch is a 400 and nothing is persisted. This is the enforcement.
- `materializeClaimExpenses` — the reimbursement projection writes header totals from the claim's
  own figure, so the builder proves they agree before the projection exists.
- `findByIdWithRelations` — read side, `ExpenseDetail.totalsIdentity { ok, gapAmount }`, so a record
  written before this rule existed is visible rather than silently wrong.
- `validateExpenseDraftAmounts` also calls it, but both sides there derive from the same line array:
  that call is a regression tripwire on `calcDocumentTotals`, NOT input validation. Deleting it
  alone passes every suite; the mutation that proves the rule is making `calcDocumentTotals` count
  charge rows in `subtotalAmount` again.

PATCH semantics: `lines` is a full replacement, so an ABSENT `chargeKind` keeps the stored kind and
only an explicit `null` clears it. Without that, a client echoing a line back turned a service charge
into a product and got a 200.

The first version of that keep resolved by `lineNumber` and was itself a blocker: a line number is a
POSITION, and adding a goods row renumbers everything under it, so the row arriving as line 2 is not
the row that was line 2. A reviewer typing "ของหวาน" got it stored as SERVICE_CHARGE, with a 200 and
`totalsIdentity.ok = true` — the identity is derived from the same wrong kinds, so it cannot catch
this class of bug. Fixed on three layers, because any one of them alone still leaves a hole:

- the web payload emits `chargeKind` on EVERY row (`null` for products), not only on charge rows;
- the LINE draft-collection lane states `chargeKind: null` on the items it materializes;
- the server resolves an absent kind by DESCRIPTION, not line number: a description matching exactly
  one stored row is that row, and a new row, a renamed row or a duplicate description resolves to
  null rather than a guess.

Read side: `ExpenseDetail.totalsIdentity { ok, gapAmount }` is declared in the web model and the
review page warns when `ok` is false. Consumers must branch on `ok` — `gapAmount` describes the
grand-total equation only, so a subtotal-only drift reports `ok: false` with a zero gap.

Owner-visible export change: the accountant index gained a trailing column
`additional_charges_amount` ("ค่าใช้จ่ายเพิ่ม") so the row is additive again now that
`subtotal_amount` is goods-only (`subtotal - discount + charges + vat = grand_total`). Trailing, so
position-based consumers keep their offsets. The golden CSV sha256 in
`common/export/thai-date.logic.spec.ts` is now stale for a second reason — it was ALREADY stale and
quarantined in `spec-suite-coverage.spec.ts` before this change, and un-quarantining it needs a
`package.json` script edit plus an Owner call on the format, so it was left alone.

Merge order (agreed with the coordinator): **B merges into develop FIRST.** Slice A then rebases onto
develop-with-B and collapses its `isAdditionalCharge` into `chargeKind != null`; slice C rebases onto
B rather than merging C's older copy of B's history. The B/A conflicts are one import line each in
`receipt-ocr-apply.service.ts` and its spec, plus this memory file — the service bodies auto-merge.

Known gap (§10, deliberate): additional charges still post to the record's expense category — no
separate "ค่าบริการ" account and no report by charge kind.
