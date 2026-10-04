# Expense WHT input units and mixed-VAT line meaning

Status: implemented, locally verified and integrated into develop, 2026-08-27. Scope: expense receipt draft/review only.

## Product and acceptance

Staff can enter the printed withholding amount in baht, or choose percent and enter `3`
for 3%. Saving/reloading, editing line amounts/discounts/VAT and applying OCR must not turn
an explicit baht amount into a rounded inferred rate. Gross stays before WHT; payable is
gross minus accepted WHT. Existing permissions, optimistic concurrency, and confirmation
boundaries remain in force.

### Review interaction (2026-10-04)

- One withholding block follows the line list. Its first control is “หัก ณ ที่จ่ายไหม”
  (ไม่หัก / หัก), defaulting to ไม่หัก unless saved input, lines or totals carry withholding.
  Selecting หัก shows payee type, income category, unit, rate/amount, optional base and
  accepted withholding amount in that order. These fields appear nowhere else in the form.
  The block remains a single column at 390 and 1280 pixels.
- Selecting an income category fills both the editable percent input and certificate-rate
  metadata from its existing default rate. Percent and baht still use the existing money
  calculator and validation; no default rate is invented when enabling withholding.
- Clearing the rate/amount or choosing ไม่หัก clears category/rate/base and legacy line rates,
  removes withholding issues and stale save errors, and sends explicit zero to override saved
  withholding. The existing update contract also receives blank category and zero certificate
  rate, so these do not reappear on reload. Vendor taxpayer class remains a vendor snapshot.
  No server/client validator relaxation is required: an empty editor is normalized to zero
  before validation and saving. Non-empty invalid input still blocks.
- A typed zero remains editable so staff can enter a fractional value such as 0.5 without
  losing category/base or having the form disappear. Changing units starts the new amount at
  zero, preserves classification/base and does not create an invalid blank input.
- Loading, failed requests and successful empty income-category lists have separate Thai
  messages from the workspace dictionary. An empty list explains that no category is open
  for this shop, that an unclassified withholding document cannot be confirmed, and that a
  bookkeeper with tax-configuration permission must check and activate categories. The same
  notice appears read-only; it does not demand an edit that viewer cannot perform. Previously
  saved categories absent from the current list display a Thai recorded-category label, never
  a raw code. Existing classified documents retain the existing confirmation rules.
- Show the authoritative preview amount when ready, saved amount for a read-only document,
  and calculation/loading guidance otherwise. Do not label stale saved money as the current
  edited amount. Preview requests omit certificate category/rate metadata rejected by the
  existing money DTO; save requests retain it.

Catalog activation, certificate entitlement/permission gates, PND53, API and database schema
are outside this interaction change. Product wording stays Thai and comes from the workspace
dictionary; certificate print labels and stale-state notice use one “พิมพ์เอกสาร 50 ทวิ” source.

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
