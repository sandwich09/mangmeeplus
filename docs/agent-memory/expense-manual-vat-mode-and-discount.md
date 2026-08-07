# Agent Memory: expense-manual-vat-mode-and-discount

Status: DONE 2026-08-05 — implemented, verified, committed on `develop`. NOT pushed (owner pushes; see [[watchdog-no-push-credentials]]).
Owner: thawtchai (report: typing the Starbucks ABB slip into บันทึกค่าใช้จ่ายด้วยมือ — entered Sub Total 195, summary showed ฿208.65; the slip says 180.00 paid, VAT 11.78, Net 168.22)

Scope: `apps/web` expenses only — `ExpensesPages.tsx` (`ManualExpensePanel`) + `expenses.model.spec.ts`. No contract, schema, API or tax-config change.

**Committed jointly with a concurrent session's manual service-charge feature** (`buildManualExpenseLines` in `expenses.model.ts`, `expenses.manual_service_charge*` dictionary keys, and that session's own spec case). That work landed on top of this one mid-task and rewrote the totals block added here to sum across lines rather than price a single one, so the two were no longer separable into compiling commits — owner chose one commit over waiting. Both are green together; see Verification.

## Triage

Two separate gaps in the manual capture form, both already solved one screen later on the draft
review form, neither reachable at capture time:

1. **No VAT-mode control.** `vatMode` was derived solely from the selected Tax Code's
   `calculationMethod`. The company's `ND` resolves `EXCLUSIVE`, so a VAT-included retail slip could
   only be entered by hand-computing `180 / 1.07 = 168.22`. Nothing flagged the wrong 208.65.
2. **No discount field.** The slip prints Sub Total 195 / Total Discount −15 / Total 180. The form
   could only express the folded net, losing the printed composition.

## Decisions

1. **`vatMode` is document arithmetic, not Tax Code configuration.** Recorded already at
   `contracts/src/expenses.ts:156` (spec §19g decision 3) and honoured by both the OCR path (which
   derives the mode from the document triple) and the review form (whose Tax Code selector
   deliberately does *not* touch `vatMode`). The manual form was the sole outlier. Fixed by exposing
   the same `EXPENSE_VAT_MODE_LABELS` select, not by changing tax config.
2. **Rejected: flipping `ND`/`V7` to `INCLUSIVE` in `tax-code-template.catalog.ts`.** This was the
   first recommendation to the owner and it is wrong on three counts, recorded so it is not retried:
   - `bootstrapCompanyTaxConfiguration` refuses to run twice (`tax_config_already_bootstrapped`,
     `tax-config-bootstrap.service.ts:64`), so a catalog edit reaches **new companies only** — the
     reporting company would have been unaffected.
   - It fixes the wrong layer. A single Tax Code legitimately covers both VAT-included retail slips
     and VAT-excluded full-form invoices; no per-code default is right for both.
   - `V7` in particular should stay `EXCLUSIVE` — a full-form tax invoice (s.86/4), which is what
     `V7` requires, prints the pre-VAT base.
   The shared `input()`/`output()` helpers must also not be touched: they feed the SAP reference
   templates, where `EXCLUSIVE` mirrors productive SAP and is authoritative.
3. **The Tax Code seeds the mode, it no longer overwrites it.** `vatModeTouched` gates the seeding.
   Without it, picking a Tax Code after stating the mode would silently move the recorded money.
4. **The discount reuses the review form's arithmetic verbatim.** `expense-review-validation`
   `computedGrandTotal` applies the discount then prices the remainder as `quantity: '1'`;
   `ManualExpensePanel` now does the same, so `calculateManualExpenseTotals` needed **no** new
   parameter and both paths run one arithmetic (owner's requirement: "logic เดียวกันทั้งหมด").
   `afterDiscount` also feeds `TransactionTaxLineSelector`'s `netAmount`/`grossAmount`, matching
   `ExpensesPages.tsx:1117-1118`.
5. **Empty discount normalises on send.** The field is optional and therefore clearable, unlike the
   `required` quantity/unit-price inputs; the payload sends `discountAmount || '0'` so a cleared
   field cannot reach the API as `''`. Over-entry needs no client guard — `calcLineTotals` clamps
   server-side (`Math.min(discount, lineSubtotal)`, `expense-totals.logic.ts:44`).

## Out of scope (flagged, not changed)

- The Tax Code selector still sits *below* the amount card, so the seeded mode appears after the
  prices are typed. Ordering left alone; the summary card shows the resulting total live.
- No back-fill of drafts already captured with the folded net — same precedent as §19c/§19g/§19h.
- Whether the company's `ND` should be `INCLUSIVE` remains an owner call in Tax Code Settings; it is
  now a preference rather than a workaround, since the mode is settable per document.

## Open questions

None blocking.

## Artifacts

- `apps/web/src/features/expenses/ExpensesPages.tsx` (`ManualExpensePanel`)
- `apps/web/src/features/expenses/expenses.model.spec.ts`
- Predecessors: [[expense-vat-rate-correctness]], [[expense-abbreviated-tax-invoice]],
  [[expense-receipt-vat-capture]]

## Verification

- `apps/web` 675/675 pass; `pnpm lint` (next typegen + `tsc --noEmit`) clean — measured on the combined
  tree, i.e. this work plus the concurrent service-charge feature it was committed with.
- New coverage in `expenses.model.spec.ts`: the reported slip in the shape the panel now feeds the
  helper — `1 × 195 − 15` at `0.07` `VAT_INCLUDED` → `168.22 / 11.78 / 180.00`. The pre-existing
  `107 → 100/7/107` case divides exactly and never exercised the satang rounding.
- **Not verified in-browser.** The preview browser has no session for the dev server and entering
  the owner's credentials is not permitted. The UI journey (three-column amount row, VAT-mode select
  under the Tax Code, seeded-then-sticky mode) is unconfirmed against a running page.

## Next

Owner: log in and confirm the manual page renders the new controls, then type the slip as
195 / discount 15 / `VAT รวมในราคา` and check the summary reads ฿180.00. `ExpensesWorkspacePanels.tsx`
stayed uncommitted — it carries a third in-flight change owned by another session.
