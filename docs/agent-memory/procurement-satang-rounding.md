# Agent Memory: procurement-satang-rounding

Status: DONE — implemented, suites green, committed on develop
Owner: Claude session 2026-07-28 (main checkout, shared dirty tree — surgical pathspec commit)
Scope: Apply spec §19d satang rounding to procurement, mirroring the expense fix on `claude/frosty-austin-d5e23c` (692a8aa2, unmerged as of this task).
Decisions:
- The live vendor-bill money path is `authoritativeVendorBillLine` + the create-use-case document sums in `vendor-bill.use-case.ts` — NOT `calcLineTotals`/`calcDocumentTotals` (those have zero production callers). Both were fixed: the use-case because it is live, the logic helpers because they are the canonical, spec'd shapes.
- Settle mechanism: bill `outstandingAmount` re-rounds to satang on every payment apply and payment-void restore, and status keeps `outstanding.isZero()` — equivalent to the expense `net − paid < 0.005` rule. Allocation guards (use-case + repo txn) allow ≤ half a satang of overshoot; PP36 `finalPayment` uses `outstanding − amount < SETTLE_EPSILON`.
- `vendorBillTaxSourceChecksum` hashes stored line strings, so pre-policy bills keep their checksums untouched. PP36 proration keeps `formatTransactionTaxAmount` + snapshot rounding policy (default HALF_UP scale 2); `sourceTaxBaseAmount` stays deliberately 4dp (pinned by `vendor-bill-transaction-tax.use-case.spec.ts` 33.3333-bases).
- `updateVendorBillPaid` in the repository has zero callers — deliberately left untouched (dead code).
- Spec §19d block was copied verbatim from frosty-austin with only the procurement module-status sentence rewritten to "complies as of 2026-07-28". The eventual merge conflict resolves by taking this branch's block wholesale.
Open questions: none
Artifacts: procurement.logic.ts (+round2/SETTLE_EPSILON), vendor-bill.use-case.ts, supplier-payment.use-case.ts, prisma-procurement.repository.ts, three extended spec files, docs/specs/expense-receipt-upload-spec.md §19d
Verification: `pnpm -C apps/api run test:item11b-tax` → 247/247 pass; all procurement specs (`find src/modules/procurement -name '*.spec.ts'` via tsx --test, includes void-vendor-bill + vendor-bill-void-reversal + maker-checker) → 82/82 pass; `tsc --noEmit` clean. Node v22 PATH prefix required per environment.
Next: merges with frosty-austin's expense §19d branch; ships with the pending deploy backlog (migration-drift/template-sync ops unchanged by this task).
