# Expense WHT input units and mixed-VAT line meaning

Status: implemented and locally verified, 2026-08-27; develop integration pending. Scope: expense receipt draft/review only.

## Product and acceptance

Staff can enter the printed withholding amount in baht, or choose percent and enter `3`
for 3%. Saving/reloading, editing line amounts/discounts/VAT and applying OCR must not turn
an explicit baht amount into a rounded inferred rate. Gross stays before WHT; payable is
gross minus accepted WHT. Existing permissions, optimistic concurrency, and confirmation
boundaries remain in force.

A receipt may contain taxable, zero-rated, exempt and non-VAT lines. Persist the explicit
zero-treatment choice independently of Tax Code (ordinary receipts cannot retain a Tax
Code). Never infer a product's eligibility from its name. Unknown historical zero treatment
stays unknown; no backfill of tax intent or balances.

## Contract and arithmetic

- Add optional `whtInput: { inputType: 'RATE' | 'AMOUNT'; value: string }` to draft input.
  RATE is percent, 0..100 with at most two decimals (the existing line fraction column is
  four decimals); AMOUNT is non-negative baht with at most two decimals and cannot exceed
  the accepted pre-VAT base. Zero explicitly clears WHT. Omission preserves saved intent,
  or the existing line-rate path on legacy drafts.
- Persist nullable `ExpenseRecord.whtInputJson` with those fields plus server-owned origin
  `REVIEWER | OCR`. Existing header/line money columns remain authoritative accepted totals.
- The existing review UI applies WHT to the whole bill. RATE keeps per-line satang rounding
  on the accepted pre-VAT base. AMOUNT is allocated over that base proportionally, flooring
  to satang then distributing residual satang by largest remainder/stable line number.
  Header WHT equals exactly the entered amount; gross never changes. Amount-only lines
  have no invented rate; downstream tax events/report groups retain a nullable rate, not a
  guessed rate or 0%. Explicit RATE/AMOUNT tax source bases include the whole bill even when
  a small line's allocated WHT rounds to zero. Tax-document rate selection remains separate.
- Legacy mixed line rates remain unchanged until the reviewer explicitly chooses a whole-
  bill value. A normal save must not collapse them to the first rate or zero.
- Add nullable line `vatTreatment: 'ZERO_RATED' | 'EXEMPT' | 'NON_VAT'`. Explicit treatment
  requires a zero VAT rate and survives save/reload and finalization. Numeric non-zero rates
  continue to distinguish standard/custom; null means no explicit treatment was captured.
- Existing included/excluded VAT reconciliation, discounts, tolerance and ambiguity gates
  remain. Zero-VAT lines never absorb positive VAT residuals. WHT applies after accepted VAT
  so included VAT residuals adjust the percentage base but never the explicit baht amount.
  A residual within tolerance still cannot make its carrier's accepted pre-VAT base or VAT
  negative; that evidence remains a blocking mismatch and calculated money is retained.
- OCR amount capture retains its printed amount; a reviewer WHT decision wins over OCR.
  Existing stale extraction protection is unchanged. OCR does not choose zero treatment.
  If a reviewer has a WHT decision, explicit VAT treatment, or mixed historical WHT rates,
  re-extraction refreshes raw evidence without replacing reviewed monetary lines/price mode;
  line-number matching is not evidence that a newly extracted item owns the old tax choice.

## Boundaries and verification

No sales/AP input redesign, payment-policy change, tax-code inference, historical rewrite,
dependency change, cloud/database operation or deployment. New nullable schema columns use
an additive migration. Verify contract validation, input/payload/reload, create/update/OCR,
accepted line/header sums, tax adapter rate/base, posting invariants, legacy mixed rates,
and focused existing VAT tests. Use browser checks if a safe local path is available.

The existing money summary displays accepted saved totals and refreshes after save. No second
client-side reconciler is introduced. For VAT-included source evidence the client uses a safe
gross upper bound for WHT, and the server enforces the exact accepted pre-VAT cap on save.
