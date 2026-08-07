# Agent Memory: expense-satang-rounding

Status: DONE — code + tests + spec addendum committed on `claude/frosty-austin-d5e23c` (based on develop 1048b883)
Owner: Claude session frosty-austin (2026-07-28)
Scope: `apps/api/src/modules/expenses/domain/logic/expense-totals.logic.ts` (+spec), `docs/specs/expense-receipt-upload-spec.md` §19d
Decisions:
- One satang policy for recorded document money (spec §19d): round every money component to 2dp at compute time, per line; document totals re-round sums. `accounting-totals.logic` was already the reference implementation; `expense-totals.logic` now matches it. Storage/format unchanged (`Decimal(18,4)`, 4dp strings) — the value carries the policy.
- Root cause fixed in `calcLineTotals` (not tolerance-only): §19c acceptance requires stored `37.94` / `580.00`, and 4dp totals also leak into ledger/report sums, so display-rounding alone was not correct.
- ALSO added the tolerance: `derivePaymentStatus` treats `net − paid < ฿0.005` as PAID and `calcPaymentAmounts` rounds outstanding to satang — needed because pre-§19d rows keep 4dp totals (no migration per §19c decision 5) and only heal totals on next review save. Half satang forgives only sub-satang residue; a real ฿0.01 shortfall stays PARTIALLY_PAID.
- Procurement (`procurement.logic.ts` `decStr` = toFixed(4), no rounding) has the SAME pattern: vendor-bill VAT at 4dp, `supplier-payment.use-case` final-payment Decimal equality + allocation>outstanding guard → paying the supplier's printed 2dp amount can never final-pay. DEFERRED to its own pass: vendor-bill money is coupled to `vendorBillTaxSourceChecksum` and tax proration (`formatTransactionTaxAmount` roundingPolicy), live-verified in H-04/CUST-02 — do not change as a rider.
Open questions: none blocking. Procurement follow-up needs its own spec note + verification (integrity/transaction-tax/void suites).
Artifacts: spec §19d addendum in `docs/specs/expense-receipt-upload-spec.md`; tests `expense-totals.logic.spec.ts` (7 new §19d cases).
Verification: `tsx --test` over expense-totals + expense-draft-vat-decouple + receipt-ocr-apply + expense-document/upload/extraction + expense-transaction-tax + accounting-totals + procurement.logic specs → 87/87 pass; `pnpm -C apps/api typecheck` clean. No package.json change needed (`expense-totals.logic.spec.ts` already registered).
Next: procurement satang compliance as separate task; existing expense rows heal on payment (status/outstanding) or on next review save (totals).
