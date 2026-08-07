# SAP-Compatible Transaction Tax and Account Determination Spec

## 1. Status

Implemented and locally verified on 2026-07-14 across contracts, persistence, API, web, ledger, reconciliation, AP/PP36, manual expense/accounting flows, and permission-checked AI read tools. Canonical checklist item: [[plans/master-implementation-checklist|Master Implementation Checklist]] 11B.

Linked plan: [[plans/sap-compatible-transaction-tax-account-determination-plan|SAP-Compatible Transaction Tax and Account Determination Plan]].

This spec is an accounting-system design baseline, not legal advice. Production activation requires current Revenue Department, Customs Department, Excise Department where applicable, SAP tenant configuration, and company accountant review.

Owner scope confirmed 2026-07-14: cover transaction taxes for domestic purchases and sales, imports, imported services, exports, returns, and corrections. Do not limit the model to output VAT or the initial `O7`/`OX`/`O0` slice.

Local implementation evidence is recorded in [[agent-memory/sap-transaction-tax-account-determination-11b|Agent Memory 11B]]. Productive activation is not implied: the company accountant must still approve its real SAP codes, evidence policy, effective dates, chart-account mappings, and Thai report-box mappings. Master item 11B remains open until the accountant-owned full-period acceptance fixture passes.

Implementation boundary: `PARTIALLY_DEDUCTIBLE` remains a fail-closed treatment until a company defines the deductible percentage and the destination of the non-deductible portion. The system returns `partial_deductibility_split_policy_required`; it does not invent a split. Direct SAP mutation/connectors, tariff/legal classification, and government e-filing remain the non-goals in §4.2.

## 2. Goal

Create one auditable transaction-tax framework that:

1. accepts SAP ERP and SAP S/4HANA tax codes without treating external code text as permanent business meaning;
2. resolves tax treatment at document-line level;
3. posts tax components to the company's existing chart of accounts through explicit account-determination rules;
4. produces reproducible VAT events and Thai ภ.พ.30/ภ.พ.36 preparation data;
5. covers domestic sales and purchases, import goods, imported services, exports, exempt/non-taxable transactions, deferred or reverse-charge scenarios, customs duty, excise components, and corrections;
6. reconciles source-document tax, tax events, journal lines, and tax-return boxes before filing or period close.

## 3. Design Principles

- SAP code is an external configuration key, not the WatchDog business meaning.
- Internal tax treatment is stable across SAP product/version changes.
- Tax Code, tax account, report box, and legal evidence are separate concerns joined by effective-dated configuration.
- A single document may contain several tax codes; line-level tax assignment is authoritative.
- Issued records store immutable tax-code/rate/account/report snapshots.
- Zero-rated, exempt, and non-taxable are different treatments even when the calculated tax amount is zero.
- Input-tax claimability is evidence-driven and separate from the supplier's displayed VAT rate.
- Tax amount, tax base, and G/L tax line must reconcile; no layer may silently infer or repair another layer.
- Missing, expired, ambiguous, or unreviewed configuration fails closed to `NEEDS_REVIEW` and cannot auto-post or enter a final filing snapshot.
- Plain receipt/payment remains payment evidence only and never creates VAT a second time.
- Corrections inherit the original line treatment and use reversal/adjustment semantics rather than a new unrelated sale or purchase.
- Rates, mappings, effective dates, evidence rules, and SAP aliases are company-scoped configuration with source and reviewer metadata.

## 4. Scope

### 4.1 In Scope

- Output VAT: standard, zero-rated, exempt, non-taxable, deferred, credit/debit adjustments.
- Input VAT: claimable, zero-rated, exempt, non-taxable, pending evidence, partially deductible, non-deductible to expense, non-deductible capitalized to asset/inventory, deferred.
- Import goods: customs value snapshot, duty, excise/municipal or other assessed components, import VAT, customs declaration/payment evidence, landed-cost/accounting destination.
- Imported services and foreign-service self-assessment: ภ.พ.36 liability, payment/evidence date, output/input components, claimability and no-double-count rules.
- Exports: zero-rated sales with required export evidence and fail-closed review when evidence is incomplete.
- Domestic purchases and sales, mixed-tax invoices, returns, credit/debit notes, voids, and post-filing adjustments.
- SAP ERP Thailand legacy profile and current SAP S/4HANA Thailand profile templates.
- Company-specific/custom SAP tax-code import, preview, review, activation, retirement, and effective dating.
- Tax account determination against the existing company chart of accounts.
- ภ.พ.30 box mapping and ภ.พ.36 preparation source events.
- Source-to-tax-to-ledger reconciliation and period-close blockers.
- WHT, customs duty, and excise classification boundaries so they are not incorrectly encoded as VAT Tax Codes.

### 4.2 Non-goals

- Direct SAP configuration mutation, FTXP/OB40 automation, or a live SAP connector in the first implementation.
- Automatic tariff/HS-code legal determination, customs clearance, certificate-of-origin adjudication, BOI privilege approval, or excise legal classification.
- Direct e-filing or payment submission to Revenue Department, Customs, or Excise systems.
- Replacing existing WHT, CIT, payroll, procurement, fixed-asset, inventory, or banking modules.
- Multi-country tax calculation beyond a model that can be extended later.
- Treating SAP sample codes as proof that a company's productive SAP tenant uses the same meanings.

The system may import authoritative customs/excise amounts and evidence, post them, and report/reconcile them. It must not invent duties or privileges when authoritative data is missing.

### 4.3 User Roles

- Owner/Admin: selects company source profile and sees blocking configuration/period risk; does not bypass accountant review or ledger permissions.
- Finance: prepares tax-relevant documents, evidence, PP30/PP36 data, and reconciliation queues within granted permissions.
- Accountant: reviews and activates Tax Code/report policy, reviews account mapping with ledger authority, resolves tax issues, and signs off period reconciliation.
- Sales: selects only allowed sale/export line Tax Codes in its source workflow; cannot activate tax/account policy.
- Procurement/Expense user: selects only allowed purchase/import line Tax Codes and attaches supplier/customs/service evidence.
- Inventory/Fixed Assets: identifies inventory/asset/expense capitalization destination; does not decide VAT claimability alone.
- Auditor readonly: traces profile/version/source/Tax Event/journal/report/evidence without mutation.
- AI assistant user: receives permission-checked explanations and deep links only; AI never selects, activates, posts, resolves, files, or closes.

## 5. Official and Product Baseline

Primary references checked for this design on 2026-07-14:

- SAP ERP Thailand legacy Tax Code table (`O7` output 7%, `O0` output 0%, `OX` exempt): https://help.sap.com/docs/SAP_ERP/a70c5fce76eb44adb0c86a9d3059e4dd/ec83d0531d8b4208e10000000a174cb4.html
- SAP S/4HANA Thailand VAT Tax Codes (`O1` output 7%, `O0`, `OX`, `WS`, input/deferred/reverse-charge examples): https://help.sap.com/docs/SAP_S4HANA_CLOUD/88d44bce214447bcb7cbbdc03eb16aa1/a61fac05630a468294f029928d8d6bc2.html
- SAP Tax Code behavior and country-specific calculation/posting: https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/3cb1182b4a184bdd93f8d62e3f1f0741/3d7ec2531bb9b44ce10000000a174cb4.html
- SAP tax-account determination and per-code account rules: https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/8999cee59b7c44fdb53fbbb4d703f8e6/146bd0531d8b4208e10000000a174cb4.html
- SAP Thailand PP30 tax-box mapping examples: https://help.sap.com/docs/SAP_S4HANA_CLOUD/88d44bce214447bcb7cbbdc03eb16aa1/b9e242c7e94343ad9d5fbc04a371d4f2.html
- Revenue Department ภ.พ.30 form and instructions, current form page updated 2026-02-28: https://www.rd.go.th/fileadmin/tax_pdf/vat/2568/pp30_010968.pdf
- Revenue Department export zero-rate evidence ruling: https://www.rd.go.th/65437.html
- Revenue Department foreign-service/ภ.พ.36 timing ruling: https://www.rd.go.th/33475.html
- Customs Department import-tax calculation guidance, including import VAT base components: https://ccc.customs.go.th/data_files/a4f1133c50ec52382185acdbbdec911a.pdf

Where sources or company policy disagree, keep the code inactive and require accountant review. Store the exact source URL, checked date, reviewer, and effective period.

## 6. SAP Profile Semantics

### 6.1 Why an External Profile Is Required

SAP ERP legacy documentation uses `O7` for output VAT 7% and `O1` for 10%. Current SAP S/4HANA Thailand examples use `O1` for 7% and `O2` for 10%. Therefore `externalCode = O1` is ambiguous without product/profile, direction, country, company, and effective date.

The unique business lookup must be at least:

```text
companyId + sourceSystem + sourceProfile + countryCode + direction + externalCode + effectiveDate
```

Never make `externalCode` a global enum or a globally unique business key.

### 6.2 Seed Profiles

`SAP_ERP_TH_LEGACY` is a compatibility template for the supplied SAP ERP mapping:

| External code | Direction | Template meaning | Rate |
|---|---|---|---:|
| O7 | OUTPUT | Standard output VAT | 7% |
| O0 | OUTPUT | Zero-rated output VAT | 0% |
| OX | OUTPUT | VAT-exempt sale | 0% |
| O1 | OUTPUT | Legacy 10% output VAT | 10% |
| DS | OUTPUT | Legacy deferred output VAT | 7% |
| DT | OUTPUT | Legacy deferred output VAT | 10% |

`SAP_S4_TH_CURRENT` is a current SAP template, not a guarantee of productive-tenant configuration:

| External codes | Direction | Template meaning |
|---|---|---|
| O0, O1, O2 | OUTPUT | Zero, 7%, and 10% output VAT |
| OX | OUTPUT | VAT-exempt sale |
| WS | OUTPUT | Non-taxable sale |
| DL, DM, DN | OUTPUT | Deferred output VAT 0%, 7%, 10% |
| V0, V1, V2 | INPUT | Input VAT 0%, 7%, 10% |
| VX | INPUT | VAT-exempt purchase |
| WP | INPUT | Non-taxable purchase |
| V3, V4 | BOTH/SELF_ASSESSED | Imported-service/reverse-charge examples |
| D0, D1, D2 | INPUT | Deferred input VAT 0%, 7%, 10% |
| N1, N2, U1, U2 | INPUT | Unclaimed/non-deductible variants; posting treatment must come from reviewed company profile |

Company import and accountant review override templates. A template cannot be activated when its code/rate/direction conflicts with imported SAP evidence.

## 7. Internal Taxonomy

### 7.1 Tax Regime

```text
VAT
IMPORT_VAT
CUSTOMS_DUTY
EXCISE_TAX
MUNICIPAL_OR_OTHER_IMPORT_TAX
WITHHOLDING_TAX
CORPORATE_INCOME_TAX_SUPPORT
OTHER_TRANSACTION_TAX
```

VAT Tax Codes must not carry WHT, customs tariff, excise, or CIT meanings. Those regimes may coexist on the same source transaction through separate tax components.

### 7.2 Transaction Direction

```text
OUTPUT
INPUT
SELF_ASSESSED
WITHHELD_PAYABLE
WITHHELD_RECEIVABLE
```

### 7.3 Stable Treatment

```text
STANDARD
ZERO_RATED
EXEMPT
NON_TAXABLE
DEFERRED
REVERSE_CHARGE
CLAIMABLE
PENDING_EVIDENCE
PARTIALLY_DEDUCTIBLE
NONDEDUCTIBLE_EXPENSE
NONDEDUCTIBLE_CAPITALIZED
OUTSIDE_SCOPE
NEEDS_REVIEW
```

Direction, regime, treatment, and rate together define business meaning. The external SAP code is only an alias to that meaning.

### 7.4 Transaction Context

```text
DOMESTIC_SALE
DOMESTIC_PURCHASE
IMPORT_GOODS
IMPORT_SERVICE
EXPORT_GOODS
EXPORT_SERVICE
RETURN_OR_CREDIT
DEBIT_ADJUSTMENT
MANUAL_TAX_ADJUSTMENT
```

## 8. Business Rules by Scenario

### 8.1 Domestic Sale

- Standard-rated sale creates output VAT, an output-VAT G/L line, and ภ.พ.30 sales/output-tax amounts.
- Zero-rated sale creates a zero tax amount but retains its base and evidence for ภ.พ.30.
- Exempt sale retains its base separately from zero-rated sales.
- Non-taxable sale is outside normal VAT boxes unless an activated report rule explicitly maps it.
- A mixed invoice groups calculations and tax events by line tax code/rate.

### 8.2 Domestic Purchase

- Supplier VAT and input-tax claimability are separate decisions.
- Claimable input VAT posts to an input-VAT asset/receivable account and enters eligible ภ.พ.30 purchase/input-tax totals.
- Pending evidence posts to a configured pending account or blocks final posting according to company policy.
- Non-deductible VAT is added to expense, inventory, or asset cost according to source context and reviewed rule; it must not enter claimable input VAT.
- Exempt/non-taxable purchases retain tax classification but create no input-VAT amount.

### 8.3 Import Goods

- Store customs declaration number/date, import entry, customs value, currency/exchange snapshot, duty, excise/other assessed tax, import VAT, payment/evidence refs, and importer/branch.
- Authoritative assessed amounts come from customs evidence or reviewed manual entry; WatchDog does not invent tariffs.
- Customs duty and non-refundable taxes capitalize to inventory/asset or post to expense according to source and account rule.
- Claimable import VAT posts to input VAT and enters ภ.พ.30 only when evidence and claimability rules pass.
- Supplier invoice, freight/insurance, customs assessment, customs payment, and goods receipt remain linked but are not collapsed into one untraceable amount.

### 8.4 Imported Service / ภ.พ.36

- Store foreign supplier, service-use country, payment date, taxable base, exchange-rate source, ภ.พ.36 liability/evidence, and claimability state.
- Create separate self-assessed output/payable and input/pending-or-claimable components. Never net them before journal or audit evidence is created.
- The input component enters ภ.พ.30 only after the configured payment/evidence/claimability gate passes.
- The same foreign-service payment cannot create duplicate ภ.พ.36 or input-VAT events.

### 8.5 Export Goods and Services

- Use `ZERO_RATED` only when the company is VAT-registered and the activated evidence rule is satisfied.
- Export evidence may include invoice, customs export declaration, shipment/transport, customer, foreign-use, and payment evidence according to scenario.
- Missing evidence produces `NEEDS_REVIEW`; it must not silently become domestic 7%, exempt, or accepted zero-rated.
- Approved zero-rated export base maps to ภ.พ.30 total sales and zero-rated sales, with zero output tax.

### 8.6 Credit Note, Debit Note, Return, and Void

- Every correction references the issued original line/tax group.
- Credit note reverses base, tax, account, and report-box contribution using the original snapshots.
- Debit note increases the original treatment using the same tax-code definition unless an accountant-approved legal reason changes it.
- Correction against another correction is rejected; a correction chain is represented against the original plus adjustment history.
- Filed/closed periods use adjustment/amended workflow and never rewrite filed snapshots.

### 8.7 Receipt and Payment

- Plain receipt/payment has no VAT Tax Code and creates no VAT event.
- Receipt/tax invoice is a legal tax document and uses line-level tax codes only when required invoice evidence exists.
- Payment may trigger deferred or imported-service tax timing only through an activated rule; it does not duplicate tax already recognized on issue.

## 9. Account Determination

### 9.1 Separation of Responsibilities

- Source posting rules determine receivable/payable, revenue, expense, inventory, asset, cash, and counterparty lines.
- Tax-code rules determine tax component, tax account role, report treatment, and line tax-code metadata.
- Chart of accounts supplies actual company account ids.
- Ledger creates balanced journal lines and stores the immutable tax-code snapshot.

### 9.2 Semantic Account Roles

```text
OUTPUT_VAT_PAYABLE
OUTPUT_VAT_DEFERRED
INPUT_VAT_CLAIMABLE
INPUT_VAT_PENDING
INPUT_VAT_DEFERRED
IMPORT_VAT_CLAIMABLE
IMPORT_VAT_PENDING
PP36_OUTPUT_VAT_PAYABLE
PP36_INPUT_VAT_CLAIMABLE
NONDEDUCTIBLE_VAT_EXPENSE
NONDEDUCTIBLE_VAT_CAPITALIZED
CUSTOMS_DUTY_PAYABLE
CUSTOMS_DUTY_EXPENSE
CUSTOMS_DUTY_CAPITALIZED
EXCISE_TAX_PAYABLE
EXCISE_TAX_EXPENSE_OR_COST
IMPORT_TAX_SETTLEMENT_PAYABLE
WHT_PAYABLE
WHT_RECEIVABLE
```

The existing default `2210-01` Output VAT and `1280-00` Input VAT may remain baseline mappings for reviewed domestic VAT. Other roles require explicit company mapping or `posting_error`; do not guess account numbers.

### 9.3 Posting Examples

Domestic standard sale, base 100 and VAT 7:

```text
Dr Accounts receivable             107
  Cr Sales revenue                       100
  Cr Output VAT payable                   7   taxCode=O7 or O1 profile alias
```

Zero-rated or exempt sale, base 100:

```text
Dr Accounts receivable             100
  Cr Sales revenue                       100   taxCode=O0 or OX
```

The zero amount produces no tax-payable journal line, but line tax classification and report-box contribution remain.

Domestic claimable purchase, base 100 and VAT 7:

```text
Dr Expense/inventory/asset          100
Dr Input VAT claimable                7
  Cr Accounts payable                    107
```

Imported-service self-assessment, VAT 7:

```text
Dr PP36 input VAT claimable/pending   7
  Cr PP36 output VAT payable               7
```

The service expense/payable posting remains source-owned. Claimability may move pending input VAT to claimable input VAT after evidence confirmation.

Credit note reverses the original directions; it must not post as another positive invoice.

### 9.4 Rule Selection

Account determination must consider:

```text
companyId
taxCodeDefinitionId
taxRegime
direction
treatment
transactionContext
sourceModule
sourceDocumentType
accountHint/category
branchId when policy requires
effectiveDate
```

Rules are versioned and immutable after use. More specific active rules win; equal-specificity ambiguity is a blocking configuration error.

## 10. Data Model Draft

### 10.1 CompanyTaxCodeProfile

```text
id
companyId
name
sourceSystem: SAP_ERP | SAP_S4HANA | WATCHDOG | CUSTOM
sourceProfileKey
countryCode
sapClient
sapCompanyCode
roundingMode: HALF_UP | HALF_EVEN | DOWN | UP
roundingScale: 0..4
taxAmountTolerance
status: DRAFT | ACTIVE | RETIRED
effectiveFrom
effectiveTo
sourceUrl/sourceAttachmentId
createdByUserId
reviewedByUserId
reviewedAt
createdAt/updatedAt
```

Only one profile may be the default for the same company/source system/date, but multiple profiles may coexist for migration or multiple SAP company codes. Final source, Tax Event, and Journal snapshots preserve the selected rounding mode, scale, and tolerance so historical reports never depend on the profile currently active.

### 10.2 TaxCodeDefinition

```text
id
companyId
profileId
externalCode
displayName
taxRegime
direction
treatment
transactionContexts[]
rate
calculationMethod
sapAccountKey
targetTaxCodeDefinitionId
claimabilityDefault
evidenceRuleKey
status: DRAFT | REVIEW_REQUIRED | ACTIVE | RETIRED
effectiveFrom/effectiveTo
sourceMetadataJson
reviewedByUserId/reviewedAt
createdAt/updatedAt
```

Uniqueness is profile/direction/externalCode/effective window, not external code globally.

### 10.3 TaxAccountDeterminationRule

```text
id
companyId
taxCodeDefinitionId nullable
taxRegime
direction
treatment
transactionContext nullable
sourceModule nullable
accountRole
accountId
priority
conditionJson
status
effectiveFrom/effectiveTo
version
createdBy/reviewedBy timestamps
```

This is separate from generic `PostingRule`, but ledger resolves both into one journal preview.

### 10.4 TaxReportMappingRule

```text
id
companyId
taxCodeDefinitionId
formType: PP30 | PP36 | TAX_LEDGER | CUSTOMS_SUPPORT
boxKey
amountSource: TAX_BASE | TAX_AMOUNT | GROSS | DUTY | OTHER
signRule
includeWhenJson
effectiveFrom/effectiveTo
status/version/reviewer
```

One Tax Code may contribute to several boxes, for example `O0` to ภ.พ.30 boxes 1 and 2.

### 10.5 Document-Line Tax Snapshot

Extend tax-relevant sales, purchase, expense, import, and adjustment lines with:

```text
taxCodeDefinitionId
externalTaxCodeSnapshot
taxProfileSnapshot
taxRegimeSnapshot
taxDirectionSnapshot
taxTreatmentSnapshot
taxRateSnapshot
taxBaseAmount
taxAmount
claimabilitySnapshot
accountRuleVersionSnapshot
reportRuleVersionSnapshot
evidenceStatus
```

Header tax code is display-only: `NONE`, one code, or `MIXED`. It is never the calculation source.

### 10.6 TradeTaxEvidence

```text
id
companyId
branchId
transactionContext
sourceType/sourceId/sourceLineId
evidenceType
referenceNumber
evidenceDate
countryCode
currency/exchangeRate/exchangeRateSource
customsValue
dutyAmount
exciseAmount
otherTaxAmount
importVatAmount
attachmentIds[]
status: DRAFT | REVIEW_REQUIRED | VERIFIED | REJECTED
reviewedBy/reviewedAt
createdAt/updatedAt
```

### 10.7 Tax Reconciliation

```text
TaxReconciliationRun
- companyId, branch scope, formType, periodKey, status, checksum, created/reviewed metadata

TaxReconciliationLine
- source ref, tax code snapshot, source base/tax, tax-event base/tax,
  journal tax account/debit/credit, report boxes, difference, issueCode
```

## 11. Source and Calculation Contracts

Tax-relevant sources expose line-level facts and evidence refs. They do not choose final tax accounts.

```ts
type TransactionTaxLineInput = {
  sourceType: string;
  sourceId: string;
  sourceLineId: string;
  transactionContext: string;
  documentDate: string;
  paymentDate?: string;
  countryCode?: string;
  currency: string;
  taxCodeDefinitionId?: string;
  externalTaxCode?: string;
  netAmount: string;
  grossAmount: string;
  enteredTaxAmount?: string;
  evidenceRefs: string[];
  accountHint?: string;
};
```

Resolution returns an immutable preview containing:

```text
resolved code/profile/version
base/rate/tax components
claimability/evidence decision
account-role/account-id decisions
report-box contributions
blocking warnings/errors
source/config checksums
```

Final mutation rechecks permissions, source version, active configuration, period state, and preview checksum.

## 12. Calculation and Validation Rules

- Use decimal-safe string money; no binary floating-point tax calculation.
- SAP-profile external codes validate as two-character alphanumeric values; longer internal/custom identifiers remain separate from the SAP alias.
- Define rounding precision/mode per profile and preserve entered versus calculated tax.
- Mixed-code documents total by summing rounded line/group results according to activated profile policy.
- Entered tax outside configured tolerance is a blocking error or review issue according to check policy.
- Cumulative partial-payment recognition rounds the cumulative profile amount, then posts the delta; the final payment absorbs the profile-rounded base and tax remainder so installments equal the immutable full liability.
- External code without a unique active mapping is `NEEDS_REVIEW`.
- Code/rate/direction mismatch is rejected even if the final amount happens to match.
- Zero-rated and exempt require zero tax amount but different treatment/evidence/report boxes.
- Non-deductible input VAT cannot enter claimable input totals or an input-VAT account.
- Import VAT uses authoritative customs evidence; imported-service tax uses its payment/self-assessment evidence and timing rule.
- Credit/debit lines preserve original tax snapshots and sign.
- Closed accounting periods and filed tax periods reject silent recomputation.
- Expense/manual upload confirmation, accounting issue, vendor-bill approval, and PP36 payment/claim mutations resolve FINAL tax and commit source snapshots/status/outbox inside a serializable, version-checked boundary. Concurrent payment, claim, void, evidence, source, or period changes fail closed.

## 13. Thai Report Mapping

### 13.1 ภ.พ.30

At minimum expose these reproducible amounts:

```text
box_1_total_sales              standard + zero-rated + exempt sales included by active rules
box_2_zero_rated_sales         ZERO_RATED base
box_3_exempt_sales             EXEMPT base
box_4_taxable_sales            box_1 - box_2 - box_3
box_5_output_tax               output VAT amount
box_6_eligible_purchases       claimable purchase base
box_7_input_tax                claimable input VAT
box_8_tax_payable              max(box_5 - box_7, 0)
box_9_tax_overpaid             max(box_7 - box_5, 0)
```

`O0` contributes to boxes 1 and 2. `OX` contributes to boxes 1 and 3. Standard output contributes to box 1 and its tax to box 5. `NON_TAXABLE` does not enter these boxes unless an activated, sourced rule says otherwise.

Claimable domestic and import input VAT may contribute to boxes 6/7. Imported-service input VAT enters only after its evidence/claimability gate. ภ.พ.36 liability remains separately traceable and cannot be counted twice.

### 13.2 ภ.พ.36

Maintain foreign supplier/payment/source evidence, taxable base, exchange rate, tax due/paid, claimability/pending state, and links to the resulting input-VAT event. Filing/payment status is manual and audited; no auto-filing.

### 13.3 WHT, Customs, and Excise

- WHT continues through existing WHT types/codes/events and accounts; it may coexist with VAT on one payment.
- Customs duty/excise are separate tax components and journal roles. They are not reported as output/input VAT merely because they form part of an import VAT base.
- Customs/excise reporting in this item is evidence, posting, and reconciliation support; statutory filing integration requires separate scoped work.

## 14. API Behavior

Suggested company-scoped routes:

```text
GET/POST   /tax-code-profiles
GET/PATCH  /tax-code-profiles/:profileId
POST       /tax-code-profiles/import-preview
POST       /tax-code-profiles/:profileId/activate
POST       /tax-code-profiles/:profileId/retire

GET/POST   /tax-code-definitions
GET/PATCH  /tax-code-definitions/:taxCodeId
POST       /tax-code-definitions/resolve-preview

GET/PUT    /tax-account-determination
POST       /tax-account-determination/preview

GET/POST   /trade-tax-evidence
POST       /trade-tax-evidence/:evidenceId/verify

POST       /tax-reconciliations
GET        /tax-reconciliations/:runId
POST       /tax-reconciliations/:runId/review
```

Error behavior:

```text
400 invalid code/rate/effective window, unbalanced tax components, invalid evidence totals
401 unauthenticated
403 missing tax/ledger/source permission or branch scope
404 company-scoped hidden record
409 overlapping active code, ambiguous account rule, stale preview, closed/filed period
422 unreviewed profile, missing evidence, missing account mapping, unsupported transaction treatment
```

## 15. Web UX

### 15.1 Settings > Tax Codes

- Profile selector: SAP ERP legacy, SAP S/4HANA current, WatchDog, custom/imported.
- Import-preview table showing external code, direction, rate, treatment, conflicts, source, and effective dates.
- Code editor with legal/report/account meaning separated into sections.
- Draft/review-required/active/retired status and reviewer evidence.
- Explicit warning that SAP sample codes are templates and productive SAP settings remain authoritative.

### 15.2 Settings > Tax Account Determination

- Matrix by semantic account role, transaction context, Tax Code, and effective date.
- Existing chart-of-account picker; never free-text an unknown account for activation.
- Posting preview with debit/credit lines and report boxes.
- Missing/ambiguous mapping queue and source links.

### 15.3 Source Documents

- Tax Code selector per line, filtered by context, date, direction, company profile, and permission.
- Display calculated/entered tax difference and evidence requirement.
- Header summary shows none, one code, or mixed.
- Issued documents show immutable code/profile/rate snapshots.
- Receipt-only paths show no-code/no-VAT guidance.

### 15.4 Import/Export Tax Evidence

- Import goods: customs entry, values/duties/VAT, attachments, destination account treatment, and review state.
- Imported service: foreign supplier, payment, exchange rate, ภ.พ.36 and input-claim evidence.
- Export: invoice/shipment/customs/payment evidence and zero-rate eligibility review.

### 15.5 Tax Reconciliation

- Period/branch selector.
- Source vs Tax Event vs G/L vs ภ.พ.30/ภ.พ.36 columns.
- Filters for missing account, code mismatch, evidence pending, amount difference, unposted source, and locked period.
- Accountant review/resolve action with audit note; no silent auto-fix.

## 16. Permissions, Approval, and Audit

Reuse current permissions:

- `tax.profile.read/manage` for company tax profile access and mutation.
- `tax.config.read/manage` for Tax Code profiles/definitions, report rules, and evidence policy.
- `ledger.account.read/manage` for chart accounts.
- `ledger.posting-rule.read/manage` for account-determination mappings.
- `tax.event.read/sync`, `tax.report.read/recompute/export`, and `tax.review_issue.read/resolve` for operational flows.
- Source-module permissions remain required to read or mutate source documents.

Tax profile activation requires `tax.config.manage`, stores an accountant reviewer, and verifies every required account/report mapping. Optional four-eyes enforcement may be company policy; it is not mandatory for the first implementation.

Phase 0 must reconcile the implemented permission registry with older planning-only names in the permission matrix. Do not add synonymous keys such as `tax.period.prepare` or `tax.report.review` when an implemented canonical key already covers the action; update source-of-truth docs and role grants together.

Changing an account mapping requires `ledger.posting-rule.manage`. One endpoint must not bypass one permission domain by hiding tax and ledger mutation in a single unchecked operation.

Always audit:

```text
tax.code_profile.create/import/activate/retire
tax.code_definition.create/update/activate/retire
tax.account_rule.create/update/activate/retire
tax.report_rule.create/update/activate/retire
tax.trade_evidence.create/verify/reject
tax.reconciliation.generate/review
tax.document_tax.resolve/finalize
```

Audit metadata includes ids, versions, source/checksum, status, period, and reason; it excludes full attachments and sensitive raw payloads.

## 17. Ownership Boundaries

- Accounting documents own sales/tax-invoice line facts and legal document lifecycle.
- Procurement/expenses own purchase lines, vendor evidence, payment, and claimability source facts.
- Inventory/fixed assets own capitalization destination; tax rules only choose the tax component/account role.
- Tax owns profiles, definitions, evidence rules, tax events, report mappings, PP30/PP36 preparation, review issues, and reconciliation.
- Ledger owns chart accounts, generated journals, reversals, accounting periods, and actual G/L balances.
- Data Model Core owns attachments, audit, outbox, idempotency, and document numbering.
- AI Gateway may explain/read only through permission-checked APIs; it never selects or activates final Tax Codes/accounts.

## 18. Migration and Backward Compatibility

- Keep completed item 11A behavior as a compatibility slice while migrating.
- Create a reviewed `SAP_ERP_TH_LEGACY` profile for existing `O7`, `O0`, and `OX` rows.
- Backfill unambiguous document headers to line snapshots only when every line shares the same valid code/rate.
- Mixed, missing, contradictory, or historically ambiguous rows become `NEEDS_REVIEW`; do not guess.
- Preserve original external code and prior tax events for audit.
- Replace global enum dependence with profile-backed ids and stable treatment values.
- Run dual-read/compare mode before making line-level/profile resolution authoritative.
- Existing filed snapshots and posted journals are immutable; migration creates mappings/links, not historical rewrites.

## 19. Reconciliation and Close Gates

For each period and branch, reconcile:

```text
source line tax base/tax
= active Tax Event base/tax
= journal tax-account movement with correct sign
= report-box contribution
```

Differences require classified review issues. Blocking examples:

- issued tax document has no active line Tax Code;
- active code has no G/L account or PP30/PP36 mapping;
- source tax differs from Tax Event beyond tolerance;
- Tax Event differs from tax-account journal movement;
- credit note sign/reference mismatch;
- import/export/self-assessed evidence pending;
- unposted tax-relevant source in the accounting period;
- filed tax period changed without adjustment workflow.

Accounting close and tax filing must expose these blockers. Neither flow may silently mark them passed.

## 20. Acceptance Criteria

- Legacy ERP `O7` and current S/4HANA `O1` can resolve to the same internal standard-output-7 treatment in different profiles.
- The same external code can hold different meanings in different profiles without collision.
- One invoice can contain standard, zero-rated, and exempt lines and creates separate tax groups/events/postings/report contributions.
- `O0` and `OX` both calculate zero tax but map to different ภ.พ.30 boxes.
- Standard output VAT reconciles to the configured output-VAT account; existing `2210-01` is supported as a reviewed default, not a universal constant.
- Claimable input VAT reconciles to the configured input-VAT account; non-deductible VAT never enters claimable input totals.
- Import goods preserve customs duty/import VAT evidence and correct cost/input-VAT destinations.
- Imported services create separate ภ.พ.36 payable and input/pending components without duplication.
- Export zero-rate requires verified evidence; incomplete evidence is review-blocked.
- Credit/debit notes preserve the original Tax Code snapshots and correct sign/account/report effects.
- Plain receipts and payments do not create VAT again.
- Closed/filed periods require explicit reversal/adjustment/amended workflow.
- Tax, source, ledger, and report totals reconcile with source refs and reviewer evidence.

## 21. Required Test Scenarios

1. `SAP_ERP_TH_LEGACY/O7` and `SAP_S4_TH_CURRENT/O1` both post base 100/VAT 7 using the same semantic treatment.
2. `O1` legacy 10% and `O1` current 7% remain separate by profile.
3. Mixed sale: standard 100+7, zero-rated 50, exempt 25 produces correct grouped events, journal, and ภ.พ.30 boxes.
4. `O0` contributes base to boxes 1/2; `OX` contributes to boxes 1/3; neither posts output-VAT amount.
5. Domestic purchase claimable, pending, and non-deductible variants use different accounts/report eligibility.
6. Import goods with customs duty and import VAT reconciles customs evidence, inventory/expense cost, input VAT, and payable/cash.
7. Imported service creates ภ.พ.36 component at configured payment timing and later releases eligible input VAT once evidence is verified.
8. Export with complete evidence accepts zero-rate; missing declaration/payment evidence remains blocked.
9. Credit note reverses original standard, zero-rated, and exempt groups; debit note increases them.
10. Receipt following tax invoice creates payment posting only.
11. Ambiguous SAP import/code conflict cannot activate.
12. Missing/ambiguous account rule produces `posting_error`, not suspense or guessed account.
13. Filed tax period and closed accounting period reject silent resync.
14. Migration preserves historical snapshots and review-gates ambiguous rows.
15. Cross-company, branch, permission, and inactive-profile tests fail closed.

## 22. Resolved Owner Decisions

- Scope includes all transaction-tax directions and contexts: purchase, sale, import goods, imported services, export, returns, and corrections.
- SAP codes are external company/profile mappings; internal semantics remain stable.
- Tax Code is line-level; document header is summary only.
- Existing chart accounts are reused through semantic account roles; missing roles require setup rather than guessed codes.
- VAT, WHT, customs duty, and excise remain separate tax regimes even when present on one transaction.
- Web owns configuration, evidence review, reconciliation, and final mutation. LINE/AI remain read-only/explanatory.

## 23. Implementation Handoff Gate

Do not begin broad coding until Phase 0 of the linked plan confirms current schemas, document-line contracts, posting paths, tax-event/report behavior, procurement/import evidence ownership, and migration compatibility. Implementation must proceed phase by phase with focused tests and keep item 11B unchecked until all acceptance and integration gates pass.
