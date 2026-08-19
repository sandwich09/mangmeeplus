# Feature: Expense VAT Source Capture and Reconciliation

## 1. Status

- Owner: Product / Finance / Expense team
- Date: 2026-08-19
- Status: Implemented; awaiting product/accountant UAT
- Parent spec: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- Related specs: [[specs/receipt-additional-charges-reconciliation-spec|Receipt Additional Charges and Total Reconciliation]], [[specs/tax-thailand-2026-spec|Tax Thailand 2026]], [[specs/sap-compatible-transaction-tax-account-determination-spec|Transaction Tax and Account Determination]]
- Presentation-policy impact: [[specs/vat-registration-aware-expense-capture-spec|VAT-Registration-Aware Expense Capture]]

## 2. Problem

Receipts and tax invoices express VAT as a rate, a baht amount, both, or only a
VAT-inclusive total. They may also be VAT-exclusive, zero-rated, exempt, non-VAT,
or contain mixed treatments.

The current expense review UI can derive a rate from a typed amount, but the printed
amount is local UI state. Review save persists only the rate and recomputes VAT. This
loses source-document intent, prevents durable source-versus-system comparison, and can
create a one-satang difference after line rounding.

The UAT failure behind this change was a VAT-inclusive receipt with gross ฿414.00 and
printed VAT ฿27.08. VAT controls were hidden, so the reviewer entered 27.08 in the WHT
percentage field and received 2708%. The design must remove that ambiguity rather than
only relax percentage validation.

## 3. Goals

- Let a reviewer choose whether the source supplied percent, baht, both, or neither.
- Preserve source-document VAT separately from deterministic system calculation.
- Produce one accepted base, VAT, gross, WHT, and net-payable set for accounting.
- Explain source, calculation, difference, rounding, and accepted value after reload.
- Support inclusive, exclusive, 0%, exempt, non-VAT, and mixed documents.
- Keep calculation, permissions, confirmation, posting, and tax decisions in ERP Core.
- Roll out additively without rewriting historical expenses.

## 4. Non-goals

- OCR does not choose tax codes, VAT claimability, filing period, or final accounting state.
- Foreign VAT does not become claimable in PP30 through this feature.
- WHT, payment allocation, credit/debit notes, refunds, and FX are not redesigned.
- Historical source evidence is not inferred for confirmed records.
- No second editable set of base, VAT, or gross totals is introduced.
- Existing line-level accepted accounting fields are not replaced.

## 5. Canonical Vocabulary

- Source VAT: rate and/or amount printed on the document or entered as source evidence.
- Calculated VAT: result of the versioned server formula before a source residual is accepted.
- Accepted VAT: the single amount stored in current ExpenseRecord/ExpenseLine fields and
  consumed downstream.
- VAT treatment: 7%, 0%, exempt, non-VAT, custom, or needs review.
- Price mode: VAT included or excluded. It is independent of claimability.
- Claimability: whether accepted document VAT may be claimed as input VAT.
- Pre-VAT amount: all accepted lines before VAT. This is the current
  ExpenseRecord.taxableAmount and equals grand total minus VAT.
- VAT base: only the accepted base to which a specific VAT rate applies. It equals the
  pre-VAT amount on a uniform document but may differ on a mixed/exempt document.

Rate units are explicit:

- New source/UI fields named vatRatePercent use percent units; 7.0000 means 7%.
- Existing ExpenseLine.vatRate remains a decimal fraction; 0.07 means 7%.
- Adapters convert at one named boundary. A generic vatRate must not cross this boundary.

The old proposed vat_method values Exclusive, Inclusive, and Amount combine two independent
questions. The integrated model does not persist that ambiguous enum:

- ExpenseRecord.vatMode continues to represent included/excluded/non-VAT treatment.
- source.inputType represents whether the document printed RATE, AMOUNT, BOTH, or NONE.
- An amount-only source must still have an included/excluded price mode before arithmetic
  can be finalized.

## 6. Ownership and Precedence

The system preserves three layers:

1. Raw OCR/provider evidence stays in aiVerifiedFieldsJson and current evidence references.
2. A typed VAT capture snapshot stores normalized source, calculated, and reconciliation data.
3. Current ExpenseRecord and ExpenseLine money columns store accepted accounting values.

Precedence:

- Reviewer-confirmed source replaces OCR source for a mutable draft.
- OCR may populate blank source fields but cannot overwrite later reviewer input.
- Calculation is always regenerated from accepted lines, treatment, and price mode.
- A source amount becomes accepted only through the reconciliation rules below.
- Confirmed records remain immutable through the current correction/reversal workflow.

## 7. Persistence

Add one nullable field:

ExpenseRecord.vatCaptureSnapshotJson: ExpenseVatCaptureSnapshotV1 | null

Version 1 contains:

- version: 1
- source
  - inputType: RATE | AMOUNT | BOTH | NONE
  - origin: OCR | REVIEWER | IMPORT
  - vatRatePercent, vatAmount, taxableAmount, grossAmount: decimal string or null
  - lineSources: optional bounded entries containing lineNumber, inputType, vatRatePercent,
    vatAmount, origin, and evidenceRefs for mixed documents
  - evidenceRefs: bounded references, not the raw provider payload
  - capturedAt
- calculation
  - formula: INCLUDED | EXCLUDED | ZERO | NOT_APPLICABLE | MIXED
  - vatRatePercent: decimal string or null
  - preVatAmount, vatBaseAmount, vatAmount, grossAmount
  - lineResults: line number, rate, calculated/accepted taxable base, calculated/accepted
    VAT, and residual adjustment
  - roundingMode: HALF_UP
  - decimalPlaces: 2
  - calculationVersion: expense-vat-v1
- reconciliation
  - status: NOT_APPLICABLE | MATCHED | CALCULATED_ONLY | SOURCE_ONLY |
    MISMATCH | NEEDS_REVIEW | LEGACY_UNAVAILABLE
  - acceptedSource: SOURCE_AMOUNT | CALCULATED | null
  - differenceAmount: source VAT minus calculated VAT
  - toleranceAmount

Constraints:

- Money and rates are decimal strings, never binary floats.
- The snapshot is derived/audit data, not another editable accounting aggregate.
- Existing ExpenseRecord subtotalAmount, taxableAmount, vatAmount, grandTotalAmount, and
  netPayableAmount remain authoritative accepted totals.
- Existing ExpenseLine taxableAmount, vatRate, vatAmount, and lineTotalAmount remain
  authoritative accepted line values.
- Raw OCR text and provider payload are not duplicated into this snapshot.

## 8. Review Input Contract

The public draft update accepts only:

- vatSource.inputType: RATE | AMOUNT | BOTH | NONE
- vatSource.vatRatePercent: optional decimal string
- vatSource.vatAmount: optional decimal string
- vatSource.lines: optional bounded lineNumber plus inputType/vatRatePercent/vatAmount entries
  for mixed documents

Rules:

- RATE requires percent; AMOUNT requires amount; BOTH requires both; NONE accepts neither.
- Amount is non-negative with at most two decimals.
- Percent is non-negative and below 100 with at most four decimals.
- Zero is supplied, not missing.
- Exempt and non-VAT reject a positive source VAT rate or amount.
- Line numbers must exist in the submitted mutable expense lines and may appear once only.
- Clients cannot submit origin, calculation, status, accepted source, residual, or version.
- Current expectedUpdatedAt optimistic concurrency remains required.

## 9. Calculation and Reconciliation

### 9.1 Formulas

VAT excluded:

- taxable = accepted amount before VAT
- calculated VAT = round-half-up(taxable × rate, 2)
- gross = taxable + calculated VAT

VAT included:

- calculated taxable = round-half-up(gross ÷ (1 + rate), 2)
- calculated VAT = gross - calculated taxable

For 0%, exempt, and non-VAT, accepted VAT is zero and gross equals taxable for VAT
arithmetic, while treatment remains distinct for tax/report semantics.

ExpenseRecord.taxableAmount remains the accepted total before VAT for compatibility. On a
mixed document, calculation.vatBaseAmount is derived only from VAT-bearing lines and the
snapshot keeps a base per rate/treatment group; do not relabel the entire pre-VAT total as
the 7% VAT base.

### 9.2 Tolerance and Accepted Amount

- Expense capture tolerance is ฿0.05.
- Difference is source VAT minus calculated VAT.
- MATCHED includes exact equality and absolute difference within tolerance.
- MISMATCH exceeds tolerance and blocks confirmation.
- A stricter tax-code/profile tolerance controls claim/posting eligibility.
- Passing tolerance never permits different final VAT in expense, tax, report, and ledger.
- Without a source amount, calculated VAT is accepted.
- A valid source amount within tolerance is accepted exactly.
- A source amount outside tolerance is not silently normalized.
- A source rate without amount remains evidence; calculation is accepted.
- BOTH with an inconsistent rate/amount relationship becomes NEEDS_REVIEW.

### 9.3 Line Allocation and Rounding

The accepted document VAT must equal the accepted line VAT sum:

1. Calculate eligible lines with current server rules.
2. residual = accepted source VAT - sum(calculated line VAT).
3. Apply residual to the eligible line with largest taxable base; tie-break by stable
   line number/id.
4. Store calculated/accepted line VAT and residual in the snapshot.
5. Included VAT keeps gross fixed and adjusts accepted taxable.
6. Excluded VAT keeps taxable fixed and adjusts line total.

Automatic allocation is forbidden when multiple rates/treatments exist without evidence
that identifies the applicable line. The document stays NEEDS_REVIEW until line-level
allocation is provided through the current line editor.

When line source exists, reconcile each rate/treatment group independently and allocate its
residual only within that group. A document-level source amount may not be spread across
different groups by proportion.

### 9.4 Invariants

- ExpenseRecord totals equal accepted ExpenseLine sums.
- gross = taxable + VAT for each applicable VAT grouping.
- net payable = gross - WHT.
- Accepted source VAT equals ExpenseRecord.vatAmount exactly.
- Included residual changes taxable base, so WHT and net payable are recomputed atomically.
- Discounts and additional-charge lines participate before VAT reconciliation.

## 10. OCR and Re-extraction

- OCR extracts rate and amount independently; amount is never converted to percent.
- ERP Core snapshots normalized source before deterministic completion fills missing fields.
- Calculated completion appears only in calculation, never source.
- Existing evidence membership and confidence guards stay mandatory.
- Re-extraction refreshes OCR source only when origin is OCR and no later reviewer save exists.
- A reviewer may explicitly replace or clear OCR source; the action is audited.
- OCR cannot confirm, post, pay, claim VAT, select tax code, or change confirmed records.

## 11. Review UX

Show a document card named ภาษีมูลค่าเพิ่ม (VAT):

1. Treatment: VAT 7%, VAT 0%, ยกเว้น VAT, ไม่อยู่ในระบบ VAT, or custom/review.
2. Price mode: ราคารวม VAT แล้ว or ราคายังไม่รวม VAT.
3. Source format: เปอร์เซ็นต์, จำนวนเงิน, ทั้งสองอย่าง, or ไม่มีระบุ.
4. Source input with explicit suffix % or บาท.
5. Read-only comparison: VAT จากเอกสาร, VAT ที่ระบบคำนวณ, ส่วนต่าง,
   ยอดก่อน VAT, ฐาน VAT, ยอดรวม (รวม VAT), and value used.

UX rules:

- Never use one unitless field or teach 0.07 = 7%.
- Source-format selection changes label, suffix, keyboard, help, and validation.
- When document VAT is relevant, show arithmetic independently of registration and
  simplified tax-code capture; registration changes claimability, not document arithmetic.
- Keep WHT in a separate card with explicit rate/amount units.
- A validation error may not live in a hidden/collapsed section.
- Uniform documents reconcile at document level. Mixed documents expose per-line controls
  plus a document summary.
- Mixed per-line source values persist in source.lineSources; they are not transient UI state.
- When pre-VAT amount and VAT base are equal, show one row named
  ฐาน VAT (ยอดก่อน VAT) rather than duplicate numbers. For mixed documents, show total
  before VAT separately and group VAT base by rate/treatment.
- Base/gross in the VAT card are read-only; expense lines remain accounting inputs.
- Source, system, difference, and origin survive reload.
- Disable the primary action with a visible reason when reconciliation blocks confirmation.

### 11.1 SIMPLE capture compatibility

This spec supersedes only the VAT-arithmetic hiding rules in
VAT-Registration-Aware Expense Capture §7.3, §7.7, and the affected §11 rows:

- SIMPLE still hides Tax Code, claimability, tax configuration, and tax-evidence workflow.
- A new manual SIMPLE draft defaults to no VAT and stays visually simple.
- The document VAT card appears when OCR/source evidence contains VAT, the stored expense
  already contains VAT, WHT needs a pre-VAT base, or the reviewer explicitly opens
  ใบนี้ระบุ VAT.
- The VAT card explains VAT เป็นส่วนหนึ่งของต้นทุนและขอคืนไม่ได้ for a non-registered
  company. It records document arithmetic and never opens a claim path.
- Saving SIMPLE must not force vatMode back to NO_VAT when document VAT is present.

This is necessary because printed VAT now drives OCR audit and can change the WHT base even
when input VAT is non-claimable. Tax Code and claimability remain governed by the earlier spec.

## 12. API, Permission, Concurrency, and Audit

- Reuse existing expense-review and confirmation permissions.
- Validate vatSource in shared contracts and again at the application boundary.
- Recompute accepted values/snapshot in the same transaction as line/header persistence.
- Include snapshot version, source, accepted values, and status in
  expenseTaxSourceChecksum and confirmation compare-and-swap input.
- A concurrent line, VAT source, tax-code, or evidence change invalidates confirmation.
- Audit origin changes, reviewer changes, status changes, and accepted-source changes with
  bounded before/after metadata.
- Public clients cannot forge derived snapshot fields.

## 13. Downstream Integration

### 13.1 Transaction Tax

- Expense tax adapters consume accepted line/header VAT as enteredTaxAmount.
- Transaction Tax calculates expected VAT from configured tax code/profile.
- Capture calculated VAT remains diagnostic evidence, not a second posting amount.
- If Transaction Tax cannot preserve an accepted source amount within allowed tolerance,
  add a server-only authoritative accepted-tax input, never a public override.
- Tax-code treatment/rate conflict remains blocking even when receipt capture matches.

### 13.2 Ledger

- Ledger continues to use accepted current fields only.
- Claimable VAT follows the current input-VAT split.
- Non-claimable VAT remains in cost according to current policy.
- Header/line divergence blocks before posting.

### 13.3 Reports and Export

Existing vatAmount continues to mean accepted accounting VAT. The fixed legacy accountant
CSV/XLSX column contract stays unchanged. A future versioned evidence-export column set adds:

- source_vat_input_type
- source_vat_rate_percent
- source_vat_amount
- source_vat_base_amount
- calculated_vat_amount
- calculated_vat_base_amount
- vat_difference_amount
- vat_reconciliation_status
- vat_calculation_version

Duplicate detection continues to use accepted gross/document identity.

## 14. Legacy and Rollout

- Migration is additive/nullable; do not infer historical source or rewrite balances.
- Confirmed legacy rows without snapshot report LEGACY_UNAVAILABLE.
- Mutable legacy drafts receive a snapshot on next save or re-extraction.
- Old clients remain compatible as rate-only/calculated-only during transition.
- Deployment order: database/contracts and compatible API, server reconciler, OCR apply,
  web UI, then strict confirmation for snapshot-aware drafts.
- Gate UI so it cannot send vatSource to an API version unable to persist it.
- Rollback hides UI/stops new snapshots; accepted fields stay valid without data rollback.

## 15. Impact and Gap Matrix

| Area | Current gap / bug risk | Required control |
| --- | --- | --- |
| Units | Expense uses fraction while UI/tax may use percent | Named units and 7 ↔ 0.07 adapter tests |
| Web state | Printed VAT is local vatEditors state | Persist snapshot and hydrate on reload |
| Visibility | Simplified capture can hide VAT | Show arithmetic independent of claimability |
| Field meaning | taxableAmount conflates total before VAT with VAT-bearing base | Keep accepted compatibility field; snapshot base by VAT group |
| Validation | Error can belong to a hidden field | Visible reason beside active control |
| OCR | Completion can blur source and derived | Snapshot source before completion |
| Re-extraction | OCR can overwrite human correction | Reviewer origin wins until cleared |
| Header/lines | Printed VAT is document-level | Deterministic residual and sum invariant |
| Rounding | Line rounding differs by one satang | Store calculated/accepted/residual |
| Included | Adding VAT again overstates gross | Keep gross fixed; adjust base |
| Excluded | Missing VAT understates gross | Add accepted VAT to total |
| Treatment | blank/zero/exempt/non-VAT collapse | Separate states; zero is not missing |
| Mixed VAT | One amount cannot identify line | Block auto-allocation without evidence |
| Tax Code | Capture/config calculation disagree | Stricter tolerance; one final amount |
| WHT | Included residual changes taxable base | Recompute WHT/net atomically |
| Ledger | Header/line/tax snapshot drift | Confirmation invariant/checksum |
| Reports | vatAmount becomes ambiguous | Keep accepted meaning; add evidence fields |
| Security | Client submits derived status | Source-only allowlist; server recompute |
| Legacy | Backfill invents provenance | Nullable snapshot/LEGACY_UNAVAILABLE |
| Reimbursement | Valid personal receipt has no VAT | NONE/non-VAT remains non-blocking |
| Foreign VAT | Foreign tax is not Thai input VAT | Preserve evidence; no auto-PP30 |

## 16. Acceptance Criteria

- Included gross ฿414.00 with source VAT ฿27.08 and 7% shows base ฿386.92,
  calculated VAT ฿27.08, difference ฿0.00, and accepted VAT ฿27.08 after reload.
- A ฿0.01 difference within tolerance accepts the source exactly with deterministic residual.
- Outside-tolerance source shows source/calculated/difference and blocks confirmation.
- RATE 7 persists as source 7.0000% while ExpenseLine stores 0.07.
- AMOUNT 27.08 never becomes 2708% or appears in the WHT control.
- Included does not add VAT to gross; excluded does.
- Zero-rated, exempt, non-VAT, unknown, and blank remain distinct.
- A mixed-rate document with line source reconciles per group; the same document with only
  an unallocated document VAT amount cannot confirm.
- Reviewer source survives refresh and later OCR re-extraction.
- VAT arithmetic remains visible for a non-registered company; claimability stays disabled.
- SIMPLE without VAT evidence remains simple; opening document VAT does not expose Tax Code.
- Expense, Transaction Tax, ledger, and export accepted VAT agree exactly.
- Concurrent tax/source/line change invalidates confirmation.
- Confirmed historical records are unchanged.

## 17. Verification Matrix

- Contract: combinations, zero, precision, percent/fraction, and derived-field rejection.
- Domain: formulas, tolerance boundaries, residual tie-break, mixed rates, discounts,
  charges, WHT recomputation, and invariants.
- OCR: amount-only, rate-only, both, missing, reviewer precedence, and re-extraction.
- Repository: nullable legacy rows and snapshot round-trip.
- API: permissions, concurrency, checksum, confirmation blocks, and audit.
- Web: selector, unit labels, reload, visibility, hidden validation, and mobile layout.
- Integration: one accepted amount reaches tax snapshot, ledger, and export.
- UAT fixtures: Starbucks ฿414/฿27.08, exclusive 7%, amount-only OCR, 0%, exempt,
  non-VAT, mixed-rate, one-satang residual, non-registered company, and legacy record.

## 18. Deferred

- Normalize VAT evidence into tables only if query volume, per-line source editing, or
  regulatory retention requires it.
- Configurable capture tolerance is deferred; initial capture tolerance is fixed at ฿0.05.
- Automatic mixed-rate OCR allocation is deferred until line-level evidence is reliable.
