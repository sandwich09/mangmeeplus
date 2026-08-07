# Thai Tax 2026 Verified Baseline

## 1. Status

This document records the current implementation baseline for Thai SME tax features as of 2026-06-22. It is not legal advice. Before implementation, activation, or release, verify against the Revenue Department, current laws/regulations, and an accountant.

## 2. Official References Checked

- Revenue Department personal income tax knowledge page: https://www.rd.go.th/62337.html
- Revenue Department corporate income tax knowledge page: https://www.rd.go.th/9292.html
- Revenue Department VAT page: https://www.rd.go.th/307.html
- Revenue Department withholding tax page: https://www.rd.go.th/14929.html
- Revenue Department e-filing page for PND 1/3/53 and PP 30: https://www.rd.go.th/39808.html
- Revenue Department tax-invoice types and documents treated as tax invoices: https://www.rd.go.th/7047.html
- Revenue Department notification allowing a tax invoice to be combined with commercial documents such as a receipt or invoice: https://www.rd.go.th/3400.html
- Revenue Department ruling on valid tax-invoice evidence and input-VAT credit: https://www.rd.go.th/35955.html
- Revenue Department Order P.80/2542 on debit/credit notes under sections 86/9 and 86/10: https://www.rd.go.th/3574.html
- Revenue Department ruling rejecting a duplicate credit note or a debit note created only to cancel an erroneous credit note without a new statutory event: https://www.rd.go.th/23714.html
- Revenue Department PIT rate PDF linked from RD page: https://www.rd.go.th/fileadmin/user_upload/borkor/tax121260.pdf
- Revenue Department allowance PDF linked from RD page: https://www.rd.go.th/fileadmin/download/tax_deductions_update280168.pdf

## 3. Scope for WatchDog-BMS

MVP tax support:

- VAT summary and report preparation for ภ.พ.30.
- WHT report preparation for ภ.ง.ด.3 and ภ.ง.ด.53.
- Ledger-backed accounting summaries for CIT support after Double-Entry Ledger item 10.
- Payroll-related ภ.ง.ด.1 later; payroll is not MVP.
- 50 ทวิ certificate data model and export/preparation flow.
- Corporate tax calendar for ภ.ง.ด.50 and ภ.ง.ด.51 reminders.
- Tax invoice, abbreviated tax invoice, receipt/tax invoice flow.
- AI Tax explanation and missing document check.

Not MVP:

- Auto-filing without accountant/user confirmation.
- Legal tax advice as final authority.
- Full e-Tax Invoice & e-Receipt API unless business has RD onboarding/certificate.
- Multi-country tax.

## 4. Verified Working Rules

### 4.1 Withholding Tax

RD describes withholding tax as tax collected in advance where the payer withholds tax from each payment and remits it to the Revenue Department. The system should therefore model WHT from payment events, not only from invoice creation.

System rule:

- WHT event is created from payment/expense/payroll source.
- WHT event stores payee snapshot, tax id, income category, rate, gross amount, withheld amount, and certificate number.
- WHT event joins monthly period reports by payment date.
- WHT event is locked after certificate issue or filing export.

### 4.2 VAT

RD describes VAT as tax collected from sale of goods/services at each production and distribution stage, including domestic production and imports.

System rule:

- VAT event is created from issued tax invoice, purchase expense, import, or manual finance entry.
- VAT output and input must be separated.
- VAT report is generated from source VAT events by tax period.
- VAT rate is config-driven by tax year/effective date.
- Default VAT rate must be confirmed before activation for 2026. Do not hard-code rate in business logic.
- Company setup defaults to VAT-registered from day one for this project.

#### Output Tax Code and receipt boundary (owner decisions 2026-07-13 and 2026-07-14)

`O7`, `OX`, and `O0` are SAP ERP Thailand-style compatibility codes, not statutory Revenue Department code names or universal WatchDog meanings. The accepted item-11A mapping is `O7` for output VAT 7%, `OX` for VAT-exempt output, and `O0` for output VAT 0%.

| Source document role | Allowed Tax Code | VAT event rule |
|---|---|---|
| Invoice/tax invoice | `O7`, `OX`, `O0` | Create the applicable output VAT/exempt event once from the tax document. |
| Invoice only | Company/accounting policy; supplied baseline uses `O0` | Do not infer legal tax-invoice status from the document title alone. |
| Credit note | `O7`, `OX`, `O0` | Adjust the issued original tax invoice; do not create a correction against another credit/debit note or an unrelated duplicate sale event. |
| Debit note | `O7`, `OX`, `O0` | Adjust the issued original tax invoice; do not create a correction against another credit/debit note or an unrelated duplicate sale event. |
| Receipt/tax invoice | `O7`, `OX`, `O0` | Create the applicable output VAT/exempt event once when tax-invoice requirements are satisfied. |
| Receipt only | none | Payment evidence only; never create VAT again for the settled invoice/tax invoice. |

A plain receipt does not become a tax invoice merely because it contains an amount or VAT-looking text. Only the limited receipts recognized by law or a combined receipt/tax invoice with the required tax-invoice particulars can support VAT treatment. Fail closed to review when the legal document role or required particulars are unclear.

Item 11B expands this baseline through [[specs/sap-compatible-transaction-tax-account-determination-spec|SAP-Compatible Transaction Tax and Account Determination Spec]]. Do not reuse the table above as a global enum matrix. SAP ERP legacy and current S/4HANA may assign different meanings to the same external code; company profile, direction, effective date, line context, evidence, G/L account rule, and Thai report mapping are required. The expanded model covers domestic purchases/sales, import goods, imported services/ภ.พ.36, exports, input claimability/non-deductible VAT, customs/excise components, and corrections.

### 4.3 PIT Brackets

RD PIT rate PDF linked from RD page lists progressive brackets that started in tax year 2560. Use as seed candidate only until accountant confirms no 2026 change for target filer.

Seed candidate:

| net taxable income | rate |
|---:|---:|
| 0 - 150,000 | 0% |
| 150,001 - 300,000 | 5% |
| 300,001 - 500,000 | 10% |
| 500,001 - 750,000 | 15% |
| 750,001 - 1,000,000 | 20% |
| 1,000,001 - 2,000,000 | 25% |
| 2,000,001 - 5,000,000 | 30% |
| 5,000,001+ | 35% |

### 4.4 PIT Allowances

RD allowance PDF linked from RD page includes common allowances such as self, spouse, children, parents, disabled dependent, life/health insurance, RMF/SSF, provident fund, home loan interest, social security, Thai ESG, and donations.

System rule:

- Allowances are tax-year config rows with caps and effective dates.
- System must not freeze allowances in code.
- AI Tax can explain allowance data but must state accountant/RD confirmation is needed.

### 4.5 Corporate Income Tax

RD corporate income tax page lists corporate income tax topics including net profit basis, gross revenue basis, withholding on income paid from Thailand, place of filing, and rate table.

System rule:

- CIT calendar stores accounting period, ภ.ง.ด.51 due rule, and ภ.ง.ด.50 due rule.
- CIT calculation engine is later phase; MVP can show calendar/reminder and supporting summaries.
- CIT supporting summaries should tie to ledger-backed P&L/accounting-period data where available.
- SME tier rules must be config-driven and accountant-confirmed before calculation release.

### 4.6 E-Filing

RD has an e-filing guidance page for ภ.ง.ด.1/3/53 and ภ.พ.30.

System rule:

- MVP exports filing-ready review data, not final auto-submit.
- Export format must be confirmed per current RD portal specification.
- Filing status is manually updated by finance/accountant after submission/acceptance.

## 5. Tax Calendar Rules

Store calendar rules as data:

- taxType.
- formType.
- periodType.
- dueRule.
- onlineExtensionRule.
- effectiveFrom/effectiveTo.
- sourceUrl.
- verifiedBy.
- verifiedAt.
- status: DRAFT, ACTIVE, RETIRED.

Never hard-code:

- due dates.
- online extension days.
- VAT rate.
- WHT rates.
- PIT/CIT tiers.
- allowance caps.

## 6. Data Model Additions

- TaxRuleSource: sourceUrl, sourceTitle, checkedAt, checkedBy, note.
- TaxYearConfig: year, status, effectiveFrom, effectiveTo.
- TaxRateConfig: taxYearId, taxType, code, rate, cap, conditionJson.
- TaxCalendarRule: taxYearId, formType, dueRuleJson, onlineExtensionJson.
- TaxVerificationChecklist: taxYearId, item, status, reviewer, reviewedAt.

## 7. Release Checklist

Before tax module production:

- [ ] Accountant confirms VAT rate and applicable exemptions.
- [ ] Accountant confirms WHT rates used by business categories.
- [ ] Accountant confirms CIT SME eligibility and rates.
- [ ] Accountant confirms ภ.ง.ด.50/51 due calculation for company accounting period.
- [ ] Accountant confirms online filing extension rules.
- [ ] RD forms/export formats are tested against current portal/sample files.
- [ ] Period lock and correction/reversal flow tested.
- [ ] AI Tax disclaimers and source citations tested.

## 8. AI Tax Rules

AI Tax must say:

- When data is missing.
- When rule is based on stored config.
- When accountant/RD confirmation is required.
- Which source records support the answer.
- Which ledger report or journal-derived summary supports the accounting-period number when applicable.

AI Tax must not:

- Submit tax return.
- Change tax config.
- Mark filing accepted.
- Create final journal entries without finance/accountant workflow.

## 9. Open Questions

- Confirm company VAT registration details: VAT effective date, branch code, and tax invoice address.
- Which WHT categories are actually used by the business?
- Is e-Tax Invoice & e-Receipt API required, or only document preparation/export?
- Who is tax reviewer: owner, accountant, or external office?
