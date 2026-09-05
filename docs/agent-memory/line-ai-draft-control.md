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
develop-with-B; slice C rebases onto B rather than merging C's older copy of B's history.

B vs A (`8bef1a4c`) is **12 conflict hunks across 9 files**, and it is NOT all mechanical:

- `receipt-ocr-apply.service.ts` (2 hunks) — the import list is trivial, but the `chargeLines()`
  body needs a real resolution. A rewrote it around a `reading: 'document' | 'unproven'` parameter
  with `needsReview`, `whtRate: null` and `isAdditionalCharge: true`; B changed the same rows to
  carry `chargeKind`, a Thai description, and the richer `sourceLineText`. Keep A's signature and
  tax rules, keep B's three field changes, and collapse `isAdditionalCharge` into
  `chargeKind != null` at both read sites (the WHT allocation set and the per-line `whtRate`).
- `packages/contracts/src/expenses.ts` (2) and `.github/workflows/ci.yml` (2) — both branches append
  (an accountant-index column plus label; a pg-spec invocation). Keep both; A's own comment already
  says to order `document_date_status` after B's `additional_charges_amount`.
- `expense-export.logic.ts`, `prisma-expense.repository.ts`, `expenses.model.ts`,
  `receipt-ocr-apply.service.spec.ts`, `ExpensesPages.qa.spec.ts`, this file (1 each) — import lists
  and both-appended blocks. Keep both.

Follow-up (not this slice): make `chargeKind` REQUIRED on `updateExpenseDraft` lines once no caller
omits it. Every first-party caller already states it on every row, so the only thing the optional
field still buys is the legacy/third-party fallback — and that fallback carries one documented
collision: omitting the field while renaming a product to a stored charge row's exact description
inherits that kind, because the wire format has no row identity. Making the field required deletes
the fallback and the collision together.

Known gap (§10, deliberate): additional charges still post to the record's expense category — no
separate "ค่าบริการ" account and no report by charge kind.

## Slice C — `codex/line-ai-explain-record` (S-3, อธิบายรายการของฉัน)

Status: implemented on top of B (`99f99335`), gates green, pushed; not reviewed, no PR.

What it does — evidence E4 ("ทำไม service charge คิดแยกเป็นอีกรายการนึง") now gets a real answer:

- **API tool `expense.explain_record`** (`erp-core-detail-tools.use-case.ts`), wired into
  `internal-tools.controller.ts` beside `expense.get_detail` and sharing its exact read permissions,
  `sensitiveAudit`, tenant scoping and typed `forbidden` / `unsupported_module` statuses. Output per
  spec §5.5: header (vendor, date, document number, Thai status label), line groups (products /
  `charges` from slice B / discount), the §5.1 identity as real numbers, the assumed-or-unverified
  list read from the OCR provenance the apply service stores (`aiVerifiedFieldsJson` +
  `aiVerificationSummaryJson`), slice B's `totalsIdentity` verdict passed through when present, and
  what LINE can change today.
- **ONE shared provenance rule.** `apps/api/src/modules/expenses/application/services/line-recent-capture.ts`
  now owns the 24 h window + chat/user/branch/status query that the correction lane's candidate
  loader used to hold inline (`process-line-webhook.use-case.ts`, was `CORRECTION_CANDIDATE_WINDOW_MS`).
  Both lanes call it; only the *ambiguity policy* differs (the write lane refuses, this read takes the
  newest and names the bill). `listRecentLineCaptures` also returns `vendorDocumentNumber`, so a
  `documentNumber` reference resolves inside the same bounded set with no second query.
- **Chat provenance now reaches the tool**: `LineUserContext.chatKeyHash` → gateway `ErpToolContext`
  → `InternalToolContextDto`. DATA only; company/permissions/branch are still re-resolved from the
  verified actor delegation, so a wrong value can at most pick another of the SAME user's own chats.
- **`intakeIntent` is bound on every turn** (it used to ride only when a prepared plan was
  forwarded), which is what lets the orchestrator tell a business read from an out-of-scope question.
  It activates no lane by itself — the prepared simple-read lane still requires `preparedPlan`.
  *Overlaps slice A*, which also plans to consume `req.intakeIntent` for `unsupported_yet`; A should
  keep this binding rather than re-add its own.
- **Gateway**: registry entry (`read_detail`, `questionKinds: ['detail','explain']`, subjects
  `['expense']`, agents `accounting`/`cfo`/`general`), `ROUTER_ENABLED_TOOLS`, accounting specialist
  allowlist, feature-coverage claim, a router prompt hint, and a deterministic
  `preferExplainRecordPlan` rescue keyed on trusted `BUSINESS_READ_QUESTION` + `asksAboutOwnRecord`.
- **Deterministic Thai answer** (`expense-explain-formatter.ts`): one bubble, one card, no model
  call, every money figure copied from the tool result. It refuses (falls back to the honest path)
  when the totals identity is incomplete rather than half-answering.

Deliberately NOT done: `line-ai-classifier.logic.ts` got no hint — `classifyIntent`/`chooseAgent` are
referenced only by their own spec, so a hint there would be dead code; the live deterministic seam is
the orchestrator rescue above. Amount edits over LINE stay `false` (S-4 owns them); the answer says
so instead of promising them.
