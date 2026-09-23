# Thai Tax 2026 Spec

## Paper print-format check (2026-09-23)

The ภ.ง.ด.53 PDF is printed on the Revenue Department main form and attachment linked at https://rd.go.th/7064.html. Filled Thai values must stay inside their published boxes and must not hide or overlap adjacent labels, tax IDs, or amounts. The form and attachment are static print pages with the original official labels; the payer signs and dates the paper before submission. Inputs that cannot fit or cannot be classified in the supported section 3 ter categories are refused before a filing PDF is accepted. The corresponding 50 ทวิ print correction is specified in `wht-certificate-system-issuance-spec.md`.

## 1. Status

Confirmed v5.1 product/UX baseline for Thai-tax work as of 2026-07-31. CC4/CC5 owner decisions are adopted; implementation still follows Plan F0 and every Thai-specialist operational route remains CLOSED until its own evidence passes. Canonical order remains [[plans/master-implementation-checklist|Master Implementation Checklist]] item 11. VAT-registration truth/compatibility and canonical filing-scope behavior follow Feature Entitlement Decoupling Spec v5.1 CC4. The legacy VAT tuple and period-level filing lifecycle below are compatibility projections, not correctness sources.

For 50 ทวิ issuance/correction, Feature Entitlement Decoupling Spec v5.1 CC5 is the normative amendment and supersedes this document's older selected-event/manual-issue/direct-void assumptions. Initial issuance is payment-owned and may run with `thai_tax` off. `cap.wht50bis` owns three hidden operator routes—`SYSTEM_INITIAL_ISSUE`, `SYSTEM_CONTENT_CORRECTION`, `SYSTEM_REPLACEMENT_COPY`—which open/close independently and are never customer settings. A missing/unknown route is CLOSED. Its fallback is respectively an external certificate handoff, a corrected EXTERNAL artifact, or an external replacement-copy handoff; sibling route state never blocks payment/WHT facts, and reopen never processes old work automatically. Missing-fact review and certificate-only correction/cancellation/`ใบแทน` stay source-visible under narrow WHT permissions without `thai_tax`; Tax permissions govern in-product return/refund work only.

The v5.1 filed/external correction journey is manual-first: the system builds an immutable diff, classifies the route, prepares one prefilled packet/checklist and records the accountant's returned evidence as `RECORDED_EXTERNAL` with “ระบบไม่ได้ยื่นหรือยืนยันการรับแบบ”. Automated dispatch is outside the MVP default and may open later only for an exact validated `(formType, correctionRoute, channelVersion)` row.

Amendment confirmed on 2026-07-31 preserves that v5.1 baseline and closes the remaining Thai-accounting/UX gaps. Delayed input VAT now has two explicit windows and three recovery routes; passing the ordinary six-month window never auto-writes off the invoice or silently claims it in the current month. ป.ป.01/ป.ป.02 and negative-additional e-Filing corrections remain open until an append-only authority outcome reaches the exact route policy's successful terminal status; a submission record or receipt alone is not completion. `ใบแทน` must pass one statutory golden fixture. Charge presentation separates principal, estimate-as-of surcharge, verified penalty and final RD amount. Employee-name receipts stay unresolved while the primary action requests a corrected tax invoice in the company name. Accountant handoff uses an invited scoped assignment and controlled download only, never an anonymous share link and never a filed/accepted claim. Ordinary users see plain freshness/change messages; technical checksums remain available in auditor detail.

Active implementer target: Sonnet 4.6 or later.

This spec is a product and engineering baseline, not legal advice. Before implementation, activation, export, or release, verify current rates, forms, deadlines, online extensions, and export formats against the Revenue Department and accountant review.

Official source snapshot checked for this handoff on 2026-07-31:

- Revenue Department VAT knowledge page: https://www.rd.go.th/307.html
- Revenue Department withholding tax knowledge page: https://www.rd.go.th/14929.html
- Revenue Department e-filing guidance for PND 1/3/53 and PP 30: https://www.rd.go.th/39808.html
- Revenue Department corporate tax knowledge page: https://www.rd.go.th/9292.html
- Revenue Department current e-Filing/RD Prep portal and API catalog: https://efiling.rd.go.th/rd-cms/ and https://efiling.rd.go.th/rd-cms/api
- Revenue Department WHT correction/form references: https://www.rd.go.th/62367.html and https://www.rd.go.th/29519.html
- Revenue Department form index and official ป.ป.01/ป.ป.02 request forms: https://www.rd.go.th/7054-1.html, https://www.rd.go.th/fileadmin/tax_pdf/request/pp0153_130753.pdf and https://www.rd.go.th/fileadmin/tax_pdf/request/pp0253_130753.pdf
- Revenue Department local-office correction guidance example (channel details must still be verified for the selected responsible office): https://www.rd.go.th/region/07/phichit/368.html
- Revenue Code section 82/3, Director-General VAT Announcement No. 4 and Revenue Department delayed-input-VAT seminar guidance: https://www.rd.go.th/5206.html, https://www.rd.go.th/3417.html and https://www.rd.go.th/publish/seminar/seminar_31052560.pdf
- Revenue Department 50 ทวิ form/copy sources: https://www.rd.go.th/3171.html and https://www.rd.go.th/28601.html
- Revenue Code section 27 surcharge source: https://www.rd.go.th/5943.html
- Revenue Department tax-invoice particulars and correction sources used for employee-name receipt review: https://www.rd.go.th/5208.html and https://www.rd.go.th/3568.html

The portal snapshot announces that from 24 July 2569 the human-operated RD Prep/e-Filing route supports negative additional PND1/2/3/53 and requires the new RD Prep version. The generic API catalog is **not** evidence that every correction tuple is automatable, that the user has refund/ค.10 rights or that a filing was accepted. Therefore v5.1 remains manual-first and any future automation stays CLOSED until that exact form, correction route and channel version is contract-tested.

Detailed working baseline lives in [[specs/tax-2026-verified-rules|Thai Tax 2026 Verified Baseline]]. Treat stored rules as configurable business data, not final legal truth.

Owner decisions confirmed on 2026-06-23:

- Tax reviewer is ACCOUNTANT.
- First demo export formats are review JSON, CSV, XLSX, and PDF.
- ภ.พ.36 is MVP scope.
- 50 ทวิ must store data/export metadata and generate PDF in item 11.
- WHT categories/rates should be seeded as a full configurable catalog and remain review-gated until accountant verification.
- Output Tax Code owner policy confirmed on 2026-07-13: the narrow `O7`/`OX`/`O0` item-11A compatibility slice protects the receipt boundary. Owner expansion on 2026-07-14 is canonical in [[specs/sap-compatible-transaction-tax-account-determination-spec|SAP-Compatible Transaction Tax and Account Determination Spec]]: SAP code is an external company/profile alias, Tax Code is line-level, and the full model covers domestic purchase/sale, import, imported service, export, and corrections.

## 2. Goal

Support Thai SME tax readiness for 2026 by preparing accurate records, ledger-backed accounting summaries, reports, reminders, export packages, certificate data, and AI explanations for VAT, withholding tax, and corporate income tax workflows.

MVP must make tax evidence reproducible from implemented source modules:

1. Sales/accounting documents and tax invoices from item 08.
2. Expenses and receipt uploads from item 09.
3. Double-entry ledger, P&L, accounting periods, and close policy from item 10.

## 3. Non-goals

- Auto-filing tax returns or submitting directly to Revenue Department.
- Legal/tax advice as final authority.
- Hard-coded tax rates, due dates, online extension rules, or export layouts.
- Multi-country tax support.
- Payroll tax implementation in MVP. Payroll and ภ.ง.ด.1 are later item 20 scope.
- Full e-Tax Invoice & e-Receipt API integration unless separate RD onboarding scope exists.
- Final CIT calculation engine with SME tier automation. MVP provides calendar/reminder and supporting summaries.
- LINE or AI mutation for filing, export, config, certificate issue, adjustment, or filing status.

## 4. User Roles

- Owner: sees tax reminders, risk summary, payable/refund summary, filing status, and high-risk actions.
- Finance: prepares VAT/WHT reports, resolves 50 ทวิ exceptions/corrections, generates export packages, and updates manual filed/paid status. A qualifying settled source payment needs no re-entry or separate Tax-workspace command: exact OPEN `SYSTEM_INITIAL_ISSUE` creates the SYSTEM certificate, while CLOSED/missing creates `EXTERNAL_CERTIFICATE_REQUIRED` with no system number/PDF.
- Accountant: reviews configuration, VAT/WHT/CIT supporting data, adjustments, filing packages, and certificates.
- Manager: sees limited tax summary where policy allows.
- Auditor readonly: reads reports, exports, source refs, filing status, and audit trail without mutation.
- AI assistant user: asks AI Tax for reminders, explanations, missing document checks, and web links through permission-checked read tools.

## 5. Business Workflow

1. Sales, purchase, expense, and payment records are captured in ERP.
2. Finalized accounting-relevant records post to the double-entry ledger where item 10 posting rules apply.
3. Tax module syncs source tax events from finalized source documents/payments/expenses.
4. System classifies tax relevance as VAT output, VAT input, WHT, exempt, excluded, or review-needed.
5. System groups events into configurable tax periods.
6. Web user reviews detailed VAT/WHT/CIT preparation screens.
7. Web user reviews one prefilled correction packet, files through the applicable external channel, then links receipt/reference evidence; the system records `RECORDED_EXTERNAL` without claiming submission or RD acceptance.
8. LINE user sees deadline reminders and summaries only.
9. AI Tax explains numbers, cites source refs, and highlights missing/suspicious records.
10. Corrections after filing/close use adjustment/amended workflow, source correction, or ledger reversal. Silent mutation is forbidden.

## 6. Thai Tax Scope

### VAT

- Company can be configured as VAT-registered with effective date and branch policy.
- Support ภ.พ.30 preparation from output VAT and eligible input VAT events.
- Support ภ.พ.36 preparation for configured foreign service/self-assessment cases.
- Track full tax invoice, abbreviated tax invoice, receipt/tax invoice flow from item 08.
- Track input VAT claimability from expense/receipt review in item 09.
- Keep VAT rate/effective date config-driven.
- Separate legal document role from display title and payment state. A plain `RECEIPT` has no VAT Tax Code and cannot create a VAT event; a combined receipt/tax invoice uses reviewed line Tax Codes only when required tax-invoice particulars are present.
- Treat the item-11A `O7`/`OX`/`O0` mapping as a legacy SAP ERP compatibility profile, not a global enum contract. Current S/4/company/custom profiles and input/import/export codes resolve through stable regime/direction/treatment semantics.
- Support line-level mixed tax, input claimability, import VAT/customs evidence, imported-service ภ.พ.36, export zero-rate evidence, and account/report mapping per the item-11B spec.
- Credit/debit notes adjust the issued original tax invoice and cannot use another correction document as their source. Receipt issuance or payment recording must not duplicate VAT already recognized by the originating tax document.

### Withholding Tax

- Support ภ.ง.ด.3 for individuals and ภ.ง.ด.53 for juristic persons in MVP.
- WHT event is created from payment/expense payment facts, not only invoice creation.
- Store payee snapshot, tax id, income category, rate, gross amount, withheld amount, net paid, payment date, and source refs.
- Support 50 ทวิ certificate preparation records, export metadata, and PDF generation.
- Initial 50 ทวิ identity comes from a qualifying positive-WHT SETTLED supplier/expense payment + payee, with immutable multi-line WHT snapshots. `taxPeriodId` and TaxEvent links are nullable provenance and never prerequisites.
- Certificate-content correction and return correction are separate immutable workflows. A corrected certificate supersedes the old artifact with a new number; `ใบแทน` is only a same-number unchanged-content copy for loss/damage. A direct status overwrite/void is forbidden.
- Seed all WHT categories/rates as configurable catalog rows and keep accountant verification required before activation.
- Payroll ภ.ง.ด.1 is later item 20 scope.

### Corporate Income Tax

- Support ภ.ง.ด.50 annual reminder and supporting summary.
- Support ภ.ง.ด.51 half-year reminder and supporting summary.
- Supporting summaries use ledger-backed P&L/accounting-period data from item 10.
- MVP must not present final legal CIT payable unless accountant-confirmed calculation config exists.

## 7. Core Rules

- Tax-sensitive records must be auditable.
- VAT/WHT report lines must be reproducible from source tax events.
- CIT/accounting summaries must use ledger-backed financial data when available.
- The affected canonical filing scope/revision's close/file status blocks silent source tax event mutation; TaxPeriod aggregate status never authorizes or blocks another scope.
- Accounting period close from item 10 must be respected by tax adjustments and source corrections.
- When Ledger is enabled, its close check inspects only Ledger-owned VAT source/opening/settlement/external-scope-transition/refund/payment projection classes (including `VatClaimLedgerProjection`) and blocks `PENDING|READY|NEEDS_REVIEW`; only `POSTED|SATISFIED` is close-safe. A `VatClaimTaxProjection=PENDING` solely because `thai_tax` is off never blocks Ledger close. Tax-only companies have no Ledger close blocker. Enabling Ledger after history was already closed routes those Ledger projections to the existing current-open correction/backfill policy and never asks users to reopen or re-key history.
- Tax calendar rules, online extension rules, rates, WHT categories, CIT tiers, and export formats are configurable data with source URL, checked date, reviewer, and status.
- AI Tax must state when data is missing, based on stored config, or needs accountant/RD confirmation.
- LINE can show summaries/alerts and web deep links only.
- Web Tax owns detailed return preparation, review, export, filing status, tax config, return/refund correction and adjustments. The source payment/global work hub owns initial 50 ทวิ, missing-fact review and certificate-only correction/cancellation/`ใบแทน`; these are document-scoped actions and not Tax-only mutations.
- Export package generation does not mean filing was submitted or accepted.
- Manual filing/payment status must store actor, timestamp, note, evidence ref when available, and audit log.
- Use decimal-safe money calculation. Contracts use strings for money.
- Company and branch scope are enforced server-side.
- Tax Code validation is server-side and fail-closed. External SAP/WatchDog/custom code text never determines legal/accounting treatment without an active company profile, effective date, evidence rule, account rule, and report mapping.

## 8. Dependencies and Ownership

Tax module/shared hidden route catalog owns:

- Company tax profile.
- Tax year/rate/calendar/source configuration.
- Tax periods and filing package status.
- Tax events derived from source modules.
- VAT/WHT reports, immutable WHT certificate artifacts/revisions/correction cases, CIT calendar/supporting summary.
- Tax review issues, adjustments, verification checklist, and tax AI read-tool payloads.

Source modules own:

- Accounting documents, tax invoices, payments, credit/debit notes, expense records, attachments, source corrections, and ledger posting state.
- Source-specific validation and immutable evidence.
- The durable SETTLED payment event, payee identity and exact positive WHT lines that qualify an initial 50 ทวิ. Source authorization initiates an idempotent system outbox only under OPEN `cap.wht50bis/SYSTEM_INITIAL_ISSUE`; otherwise it initiates the prefilled EXTERNAL handoff. Neither path requires `thai_tax` or a separate `tax.certificate.issue` grant.
- Source/global work-hub discovery/presentation of handoffs, certificates and retained actions under current source visibility or exact retained authority + `wht.certificate.read`; mutation additionally requires `wht.certificate.prepare|correct` or `wht.external_certificate.link` as applicable. A return-impact acknowledgement may be recorded when Tax is off but never claims RD acceptance.

Company Settings/shared finance owns the effective-dated `CompanyVatRegistrationFact` service and narrow `company.vat_registration.read|manage` permissions. Tax profile projects the same facts but does not own a Tax-only copy. Source/Ledger exception queues may resolve claimability/accounting carry-forward under source visibility + `finance.vat.review`; only `thai_tax` may create an in-product TaxEvent/ภ.พ.30 contribution.

Ledger owns:

- Journal entries, journal lines, chart of accounts, P&L, accounting periods, and period close/unclose.

Auth/RBAC owns identity, membership, role grants, permissions, request context, and ABAC. Data Model Core owns branch, document sequence, attachment, audit, and outbox primitives. Tax must extend these instead of duplicating them.

## 9. Data Model Draft

Use repo conventions and current Prisma naming when implementation starts. Shape below is required business contract, not exact ORM syntax.

### Shared VAT-registration state

```text
CompanyVatRegistrationState
- companyId primary/unique
- version
- updatedAt

CompanyVatRegistrationCommand
- id
- companyId
- commandId
- payloadFingerprint
- expectedStateVersion
- resultStateVersion
- resultFactId nullable
- resultKind: FACT_APPENDED, NOOP
- createdAt
- unique companyId,commandId

CompanyVatRegistrationFact
- id
- companyId
- status: REGISTERED, NOT_REGISTERED
- effectiveFrom
- effectiveTo nullable
- source
- evidenceRef nullable
- answeredAt nullable
- actorId nullable
- createdAt
- non-overlapping companyId,effectiveFrom,effectiveTo

VatRegistrationPrompt
- id
- companyId
- context
- promptVersion
- promptedAt
- resolvedAt nullable
- unique companyId,context,promptVersion
```

Expansion creates `CompanyVatRegistrationState(version=0)` deploy-owned even when there is no fact. Every PUT first looks up `CompanyVatRegistrationCommand` by company + caller command id: the same fingerprint returns its stored fact/no-op result, while key reuse rejects before CAS. A new command locks and compares the state version, appends any fact, increments the state and stores the resulting version atomically. This provides a real UNKNOWN expected-absence CAS token, makes a concurrent first fact stale and makes a lost-response retry friendly without asking the user twice.

### CompanyTaxProfile

```text
CompanyTaxProfile
- id
- companyId unique
- legalNameSnapshot
- taxId nullable
- vatRegistered (required legacy compatibility bit only; last-known/default, not a correctness/display source)
- vatRegistrationStatus: REGISTERED, NOT_REGISTERED, UNKNOWN (additive API projection from effective fact)
- vatRegistrationEffectiveFrom nullable
- vatRegistrationEffectiveTo nullable
- vatRegistrationVersion
- vatEffectiveDate nullable (deprecated legacy compatibility/evidence field; never overrides an applicable fact)
- mainBranchCode nullable
- branchFilingPolicy: HEAD_OFFICE_ONLY, ALL_BRANCHES, PER_BRANCH, SELECTED_BRANCHES (preferred); MAIN_ONLY, CONFIGURED (deprecated compatibility aliases)
- accountingPeriodStartMonth
- defaultCurrency
- taxReviewerUserId nullable
- status: DRAFT, ACTIVE, SUSPENDED
- createdAt
- updatedAt
```

VAT registration is effective-dated in the shared `CompanyVatRegistrationFact` service and resolved by company + source date. Absence is UNKNOWN; default/legacy false is not proof of NOT_REGISTERED. During the versioned compatibility window, the legacy write shape is `(vatRegistered, vatEffectiveDate)`: an unchanged tuple echoed by GET→PUT is a command-recorded no-op, while a changed boolean or date must use the prefilled effective-date adapter with expected-version CAS or return `vat_registration_contract_upgrade_required`. The legacy date is evidence/compatibility only and never overrides an applicable fact. New writes use tri-state + effective date + caller-stable command/fingerprint + expected version. Tax `/profile` projects these fields but shared Company Settings/finance owns their mutation, so Ledger/source flows do not require `thai_tax`. See Feature Entitlement Decoupling Spec v5.1 CC4 for the normative migration/read/write matrix.

### TaxRuleSource

```text
TaxRuleSource
- id
- companyId nullable
- sourceUrl
- sourceTitle
- sourceType: RD_PAGE, ACCOUNTANT_CONFIRMATION, OWNER_POLICY, SYSTEM_NOTE
- validationScopeJson nullable; exact form/correction route/channel version or other rule scope when this row records a validation decision
- validationDecision nullable: VERIFIED, REJECTED, NOT_APPLICABLE
- validationEvidenceHash nullable; required when validationDecision is present
- checkedAt
- checkedByUserId nullable
- validUntil nullable
- note nullable
- status: DRAFT, ACTIVE, RETIRED
- createdAt
```

An `ADDITIONAL_NEGATIVE` classifier decision requires one current ACTIVE `TaxRuleSource` with `validationDecision=VERIFIED`, an exact `(formType, correctionRoute, channelVersion)` scope, evidence hash and reviewer. “Current” means the exact channel version is still applicable, the source has not been retired and `validUntil`, when present, has not passed; a URL or generic API listing alone is never verification. The immutable correction revision snapshots that decision before approval and revalidates it before recording the filing outcome.

### TaxYearConfig

```text
TaxYearConfig
- id
- companyId
- taxYear
- status: DRAFT, ACTIVE, RETIRED
- effectiveFrom
- effectiveTo nullable
- verifiedByUserId nullable
- verifiedAt nullable
- sourceId nullable
- createdAt
- updatedAt
- unique companyId,taxYear
```

### TaxRateConfig

```text
TaxRateConfig
- id
- companyId
- taxYearConfigId
- taxType: VAT, WHT, CIT, PIT
- code
- label
- rate nullable
- cap nullable
- conditionJson nullable
- effectiveFrom
- effectiveTo nullable
- status
- sourceId nullable
- createdAt
- updatedAt
- unique companyId,taxYearConfigId,taxType,code,effectiveFrom
```

Rates and caps are config rows. Business logic must not embed rate constants.

### TaxCalendarRule

```text
TaxCalendarRule
- id
- companyId
- taxYearConfigId
- taxType: VAT, WHT, CIT
- formType: PP30, PP36, PND3, PND53, PND50, PND51
- periodType: MONTHLY, HALF_YEAR, ANNUAL
- dueRuleJson
- onlineExtensionJson nullable
- holidayPolicyJson nullable
- sourceId nullable
- status
- createdAt
- updatedAt
- unique companyId,taxYearConfigId,formType,periodType
```

### TaxPeriod

```text
TaxPeriod
- id
- companyId
- taxType
- formType
- periodKey
- periodStart
- periodEnd
- dueDate
- onlineDueDate nullable
- aggregateStatus: OPEN, NEEDS_REVIEW, READY_FOR_REVIEW, REVIEWED, EXPORTED, FILED, PAID, CLOSED, AMENDED (derived/legacy compatibility only)
- lastSyncedAt nullable
- createdAt
- updatedAt
- unique companyId,formType,periodKey
- index companyId,dueDate,aggregateStatus
```

`TaxPeriod` is only the company/form/calendar container. Existing period-level status/reviewer/filed/paid fields may remain during additive migration as a read-compatible aggregate, but no new mutation or legal decision may use them as authoritative scope state.

### TaxFilingPartitionSnapshot

```text
TaxFilingPartitionSnapshot
- id
- companyId
- taxPeriodId
- formType
- partitionGeneration
- policyVersion
- sourcePolicyValue
- partitionChecksum
- state: DRAFT, ACTIVE, SUPERSEDED
- supersedesPartitionSnapshotId nullable
- supersededByPartitionSnapshotId nullable
- createdAt
- activatedAt nullable
- unique companyId,taxPeriodId,partitionGeneration
- unique active companyId,taxPeriodId where state=ACTIVE
```

This parent is the durable whole-partition boundary. Build every child scope and event assignment under one next-generation DRAFT parent, validate complete disjoint membership/checksum, then atomically supersede the prior draft/active parent and activate the new one. Report/filing/settlement/cutover/credit-transition provenance references the exact parent/scope generation; there is never a mixture of children from two active partitions.

### TaxFilingScopeSnapshot

```text
TaxFilingScopeSnapshot
- id
- companyId
- taxPeriodId
- taxFilingPartitionSnapshotId
- filingScopeId
- scopeGeneration
- scopeKind: HEAD_OFFICE, CONSOLIDATED, BRANCH, CONFIGURED_GROUP
- branchCodesJson (normalized, unique, sorted)
- branchSetHash
- sourcePolicyValue
- policyVersion
- snapshotChecksum
- supersedesScopeSnapshotId nullable
- supersededByScopeSnapshotId nullable
- recordState: DRAFT, ACTIVE, SUPERSEDED
- status: OPEN, NEEDS_REVIEW, READY_FOR_REVIEW, REVIEWED, EXPORTED, FILED, PAID, CLOSED, AMENDED
- activeFilingRevision
- reviewedByUserId nullable
- reviewedAt nullable
- filedByUserId nullable
- filedAt nullable
- paidByUserId nullable
- paidAt nullable
- filingReference nullable
- filingNote nullable
- identityFrozenAt nullable
- createdAt
- updatedAt
- unique companyId,taxPeriodId,filingScopeId,scopeGeneration
- unique companyId,taxPeriodId,scopeKind,branchSetHash,scopeGeneration
- unique active companyId,taxPeriodId,filingScopeId where recordState=ACTIVE
- unique taxFilingPartitionSnapshotId,scopeKind,branchSetHash
- index companyId,taxPeriodId,status
```

The snapshot is the canonical filing identity and owns review/file/pay/close state. `filingScopeId` derives from canonical `scopeKind + normalized branch membership`, not a raw policy label; `scopeGeneration` and bidirectional lineage allow a later policy snapshot with the same semantic scope without colliding. Identity/policy/membership fields become immutable before the first reviewed report or filing artifact. For each company/form/period/revision, active scope memberships must form a disjoint partition. Persist exactly one frozen scope assignment for every eligible TaxEvent/report contribution; a branch cannot appear in overlapping groups or both consolidated and branch scopes. A policy change may replace the whole draft partition before review; after review/file it creates a linked successor/correction generation and atomically supersedes the prior active snapshot without mutating or double-including filed history. Every report snapshot, filing package/revision, VAT settlement, correction and scope-specific review issue references the exact snapshot row, so one branch can remain OPEN while another is FILED.

Compatibility normalization is automatic where facts are complete:

- `HEAD_OFFICE_ONLY` or `MAIN_ONLY` → one HEAD_OFFICE scope;
- `ALL_BRANCHES` → one CONSOLIDATED scope over the effective tax-branch set;
- `PER_BRANCH` → one BRANCH scope per effective branch code;
- `SELECTED_BRANCHES` or `CONFIGURED` → CONFIGURED_GROUP only when the durable selected branch set exists.

Before freezing, the system compares normalized membership against existing report/filing artifacts. A conflicting historical shape, missing selected set, overlapping group or branch move creates one deduplicated, prefilled review at first report review/filing; tax-event capture and sync continue, and feature enable never shows a migration form. Tests must cover head office, all/consolidated, selected group, per-branch, overlapping groups, consolidated→per-branch, branch moves, branch-set changes and policy changes after filing.

### TaxCutoverScopePolicy

```text
TaxCutoverScopePolicy
- id
- companyId
- formType
- filingScopeId nullable (null only for FORM_DEFAULT)
- version
- inProductStartPeriodKey
- externallyHandledThroughPeriodKey nullable
- calendarRuleVersion
- predecessorCutoverPolicyIdsJson nullable
- defaultOrOverride: FORM_DEFAULT, SCOPE_OVERRIDE
- evidenceRef nullable
- status: INFERRED, REVIEWED, NEEDS_REVIEW
- recordState: ACTIVE, SUPERSEDED
- supersedesCutoverPolicyId nullable
- supersededByCutoverPolicyId nullable
- createdByUserId nullable
- createdAt
- unique companyId,formType,defaultOrOverride,filingScopeId,version
- unique active companyId,formType where defaultOrOverride=FORM_DEFAULT and recordState=ACTIVE
- unique active companyId,formType,filingScopeId where defaultOrOverride=SCOPE_OVERRIDE and recordState=ACTIVE
```

Cutover is authoritative per company + form + canonical scope and written with expected-version CAS/lineage. The nullable scope is not a sentinel: only FORM_DEFAULT may omit it, while every SCOPE_OVERRIDE references a real canonical `filingScopeId`. By default `inProductStartPeriodKey` is derived as the next configured form period after `externallyHandledThroughPeriodKey` under the stored calendar-rule version; overlap rejects, and any intentional gap requires evidence in the one scope review. The setup stores one active prefilled form-wide default and only necessary active scope overrides; durable filing packages/references may infer it. A later scope split/merge inherits predecessor/default cutover lineage and sticky dispositions automatically when all predecessors are already in-product; only conflicting external histories create a new review, and predecessor refs prevent a new scope ID from resetting history. Output/WHT events in externally handled periods remain sticky EXTERNAL/HISTORICAL across disable/re-enable. Pre-period input VAT instead resolves `EXTERNAL_CLAIMED | CARRY_IN_CANDIDATE | REVIEW` from filed-return/evidence while retaining source date for eligibility/deadline. If branches have different histories or evidence is insufficient, present one scope matrix at first report review/filing—never feature enable or per record—and require explicit review before the affected final report.

### VatScopeOpeningCreditPosition

```text
VatScopeOpeningCreditPosition
- id
- companyId
- vatCreditRegimeKey: PP30
- filingScopeId
- cutoverScopePolicyId
- positionVersion
- currency: THB
- availableCarryAmount
- refundReservedAmount
- explicitlyConfirmedZero
- sourceType: FILED_RETURN, RD_EVIDENCE, REVIEWED_CONFIRMATION
- evidenceRef nullable only for reviewed explicit zero
- recordState: ACTIVE, SUPERSEDED
- supersedesOpeningPositionId nullable
- supersededByOpeningPositionId nullable
- reviewedByUserId nullable
- reviewedAt nullable
- createdAt
- unique companyId,vatCreditRegimeKey,filingScopeId,currency,cutoverScopePolicyId,positionVersion
- unique active companyId,vatCreditRegimeKey,filingScopeId,currency where recordState=ACTIVE
```

Both buckets are independently nonnegative. `availableCarryAmount` excludes `refundReservedAmount`; only the available bucket becomes settlement `B`/may feed `C_used`, while the reserved bucket remains unavailable. Any nonzero amount requires `sourceType=FILED_RETURN|RD_EVIDENCE` plus durable `evidenceRef`. `REVIEWED_CONFIRMATION` without evidence is valid only when `explicitlyConfirmedZero=true` and both amounts are zero. The write command supplies (but the row does not store) `expectedActiveOpeningPositionId` + `expectedPositionVersion`, locks the company/regime/scope/currency authority and appends lineage. A cutover-policy change atomically supersedes the old ACTIVE opening under that CAS; including `cutoverScopePolicyId` in the active uniqueness key must never permit two current openings. The first in-product VAT settlement must use this immutable tax-side opening position. Infer only from durable filed-return/RD evidence. Source documents and G/L 1156 are not authority; no evidence never defaults silently to zero. Missing carry/refund disposition becomes one prefilled whole-scope `TAX_REVIEW_REQUIRED` task at first review/filing, with explicit zero confirmation available. Later Ledger enable consumes the stored tax projection and asks nothing again.

```text
VatOpeningCreditLedgerProjection
- id
- companyId
- projectionRootId
- projectionVersion
- vatScopeOpeningCreditPositionId
- projectionAmount
- currency: THB
- legalEffectiveDate
- accountingPolicySnapshotHash
- accountingPeriodId nullable until Ledger resolution
- resolvedPostingDate nullable until Ledger resolution
- refundReceivableAccountId nullable
- counterpartAccountId nullable
- postedClassification: NONE, MATCHING_OPENING_PROVENANCE, OPENING_BALANCE_ADJUSTMENT
- status: PENDING, SATISFIED, POSTED, NEEDS_REVIEW
- journalId nullable
- predecessorProjectionId nullable
- supersededByProjectionId nullable
- commandId, payloadFingerprint
- recordState: CURRENT, SUPERSEDED
- createdAt
- unique companyId,commandId
- unique companyId,projectionRootId,projectionVersion
- unique current companyId,projectionRootId where recordState=CURRENT
- index companyId,vatScopeOpeningCreditPositionId
```

For a nonzero opening position, projection amount is available + reserved. Tax-only creation writes version 1 PENDING with the legal effective date/policy snapshot and nullable Ledger period/posting date/accounts. Ledger enable appends a current version that resolves the applicable OPEN period (or current-open correction), posting date and accounts; it never mutates the old intent or asks for the amount again. Opening-position supersession atomically supersedes an unposted current projection; if it was posted, the same root appends an exact linked reversal plus current-open replacement. Close/backfill reads only the current head. Link/no-op only when immutable posted provenance proves the same 1156 opening position. Otherwise post, after one prefilled review when required, a current-open-period Dr 1156 with an existing-policy reviewed opening-balance counterpart; never infer the counterpart, use a raw balance, or backdate. This current projection must be SATISFIED/POSTED before any later settlement credits/uses that 1156 opening amount.

### VatScopeCreditPosition

```text
VatScopeCreditPosition
- id
- companyId
- vatCreditRegimeKey: PP30
- filingScopeId
- positionVersion
- taxFilingScopeSnapshotId nullable
- taxPeriodId nullable
- currency: THB
- availableCarryAmount
- refundReservedAmount
- predecessorPositionId nullable
- lastMutationType: OPENING, SETTLEMENT, REFUND_OUTCOME, SCOPE_TRANSFER, SCOPE_TRANSITION_EXTERNAL, CORRECTION
- lastMutationId
- recordState: CURRENT, SUPERSEDED
- supersededByPositionId nullable
- createdAt
- unique companyId,vatCreditRegimeKey,filingScopeId,currency,positionVersion
- unique companyId,lastMutationType,lastMutationId,vatCreditRegimeKey,filingScopeId,currency
- unique current companyId,vatCreditRegimeKey,filingScopeId,currency where recordState=CURRENT
```

```text
VatScopeCreditPositionAllocation
- id
- companyId
- vatScopeCreditPositionId
- allocationIdentity
- predecessorAllocationId nullable
- originType: OPENING, SETTLEMENT, SCOPE_TRANSFER, SCOPE_TRANSITION_EXTERNAL, REFUND_OUTCOME, CORRECTION
- originRefId
- availableAmount
- refundReservedAmount
- disposition: CARRY_FORWARD, CASH_REFUND
- reservationRef nullable
- lineSeq
- unique vatScopeCreditPositionId,lineSeq
- unique vatScopeCreditPositionId,allocationIdentity
- unique vatScopeCreditPositionId,reservationRef where reservationRef is not null
```

Each position is an immutable aggregate plus a complete allocation snapshot whose available/reserved sums equal the position balances. Stable allocation identity and predecessor lineage preserve opening/settlement/transfer origin; reservation refs identify the exact partial refund portion. Opening evidence creates version 1. Every FINAL settlement, refund outcome, approved transfer leg or correction performs same-command/fingerprint lookup first, then locks every affected current position in canonical regime/scope/currency order, compares the caller's expected version, validates provenance/nonnegative balances and atomically writes the domain artifact plus one next position/allocation snapshot for each touched scope. Transfer origin and destination positions are both locked/CASed; one transfer may have at most one allocation row per origin position, and each applied origin-allocation reference is globally unique on the transfer allocation table. This chain is restricted to PP30 in v5.1; PP36/PND scopes with identical branch membership remain isolated. A stale command changes no position or artifact. The append-only position—not an immutable settlement row or G/L balance—is the concurrency authority.

### VatPeriodSettlement

```text
VatPeriodSettlement
- id
- companyId
- taxPeriodId
- taxFilingPartitionSnapshotId
- taxFilingScopeSnapshotId
- filingRevision
- predecessorSettlementId nullable
- supersedesSettlementId nullable
- outputVatAmount
- inputVatAmount
- openingAvailableCreditAmount
- openingRefundReservedAmount
- expectedCreditPositionVersion
- creditUsedAmount
- creditCreatedAmount
- newRefundReservedAmount
- payableAmount
- closingAvailableCreditAmount
- closingRefundReservedAmount
- creditDispositionJson: CARRY_FORWARD | CASH_REFUND with origin/predecessor allocations
- artifactHash
- ledgerProjectionRootId nullable
- journalId nullable
- status: DRAFT, FINAL, SUPERSEDED, NEEDS_REVIEW
- idempotencyKey
- createdAt
- updatedAt
- unique companyId,taxPeriodId,taxFilingScopeSnapshotId,filingRevision
- unique companyId,idempotencyKey
```

The tax-side scope chain is authoritative even when Ledger is off. Under the canonical `VatScopeCreditPosition` lock/CAS, available carry is applied automatically and maximally: `net = outputVat - inputVat`, `creditUsed = min(openingAvailable, max(net, 0))`, `payable = max(net - openingAvailable, 0)`, and `creditCreated = max(-net, 0)`. There is no user option to preserve available credit while paying the same liability. Only after that calculation may `newlyReserved` move an amount bounded by the resulting available credit into refund-reserved. Settlement writes `closingAvailable = openingAvailable - used + created - newlyReserved` and `closingReserved = openingReserved + newlyReserved`, with every term nonnegative and allocation-bounded. A period report may display refund outcomes, but settlement never reapplies them: an APPLIED `VatRefundOutcome` alone consumes reserved credit or returns it to available and writes the next position before the next settlement reads its opening. The full filing revision still satisfies `outputVat + creditCreated = inputVat + creditUsed + payable`. Report/filing/settlement and the next position commit atomically for that scope; Ledger is a nullable idempotent projection. Its dependency snapshot stores every included source VAT projection ID/status/checksum and any opening-credit projection: settlement Ledger posting remains PENDING until all are POSTED/SATISFIED and required pending reclasses finish, while Tax filing may complete. Corrections supersede an unposted projection or post an exact linked reversal plus full replacement in an allowed open period—never an unqualified signed delta. Only downstream OPEN/unreviewed positions auto-recompute; reviewed/exported/filed/paid/closed successors receive linked correction tasks.

```text
VatCreditOutcomeCorrectionCommand
- id, companyId
- commandId, payloadFingerprint
- targetType: VAT_REFUND_OUTCOME, VAT_SCOPE_TRANSITION_EXTERNAL_OUTCOME
- targetId, targetArtifactHash: current effective ORIGINAL-or-REPLACEMENT leaf only
- expectedAffectedPositionVersionsHash
- resultReversalId
- resultReplacementId nullable
- createdAt
- unique companyId,commandId

VatRefundOutcome
- id
- companyId
- mutationKind: ORIGINAL, REVERSAL, REPLACEMENT
- reversesOutcomeId nullable; required only for REVERSAL
- replacesOutcomeId nullable; required only for REPLACEMENT
- reversedByOutcomeId nullable
- replacedByOutcomeId nullable
- taxFilingScopeSnapshotId
- reservationOriginType: OPENING, SETTLEMENT, SCOPE_TRANSFER, SCOPE_TRANSITION_EXTERNAL, CORRECTION
- reservationOriginRef
- originSettlementId nullable; required only when reservationOriginType=SETTLEMENT
- reservationRef
- expectedAllocationIdentity
- expectedCreditPositionVersion
- expectedAffectedPositionVersionsJson nullable; required for REVERSAL/REPLACEMENT
- outcome: REFUND_RECEIVED, OFFSET_APPLIED, RETURN_TO_AVAILABLE, DISALLOWED, EXPIRED
- cashEffect: NONE, DEPOSIT, WITHDRAWAL
- reversesCashEvidenceLinkId nullable; required only for an evidence-backed economic REVERSAL with cashEffect=WITHDRAWAL
- basis: RECEIPT, REJECTION, WITHDRAWAL, RD_DECISION, OTHER_REVIEWED
- amount
- currency: THB
- rdEvidenceRef nullable
- bankEvidenceRef nullable
- offsetReference nullable
- offsetTargetKind nullable: EXTERNAL_UNMODELED; required for OFFSET_APPLIED
- offsetCounterpartRole nullable
- offsetCounterpartAccountId nullable
- dispositionEvidenceRef
- commandId
- payloadFingerprint
- correctionCommandRegistryId nullable; required for REVERSAL/REPLACEMENT
- artifactHash
- ledgerProjectionRootId nullable
- journalId nullable
- appliedAt
- unique companyId,commandId
- unique companyId,reversesOutcomeId where mutationKind=REVERSAL
- unique companyId,replacesOutcomeId where mutationKind=REPLACEMENT
- unique companyId,correctionCommandRegistryId,mutationKind where correctionCommandRegistryId is not null
```

Outcome application shares the scope-position lock/CAS with filing. Same-command lookup precedes CAS; key reuse/stale position applies nothing. An ORIGINAL must name one current reserved allocation through `reservationRef` + expected allocation identity and cannot exceed its remaining reserved portion. The origin fields preserve opening, settlement, transfer, external-transition or correction lineage; opening/transition reservations therefore do not need a fabricated settlement ID. `artifactHash` canonically hashes the immutable target identity, mutation/action, lineage, amount, currency, `cashEffect` and position/allocation version. ORIGINAL/REPLACEMENT `REFUND_RECEIVED` has `cashEffect=DEPOSIT`, consumes that credit and records the tax/RD truth first; its Dr bank/cash → Cr 1156 projection remains PENDING until the separate evidence head below proves cash. A REVERSAL has `cashEffect=WITHDRAWAL` only when durable evidence proves an economic return of the earlier receipt and `reversesCashEvidenceLinkId` identifies its exact active evidence head; a classification or evidence correction with no opposite cash movement has `cashEffect=NONE`. `bankEvidenceRef`, when retained for compatibility, is only a remittance/RD note and never cash proof by itself. `OFFSET_APPLIED` is v5.1-safe only for `offsetTargetKind=EXTERNAL_UNMODELED` with reviewed RD reference and exact counterpart role/account, and only after asserting no current in-product PP30/PP36/PND payable target matches; it has `cashEffect=NONE`, posts reviewed Dr external liability/control counterpart → Cr 1156 and never pretends a non-cash offset is a bank receipt. A possible in-product target instead opens one prefilled review with all facts retained and mutates nothing. `[LATER] cap.thai_tax.vat_credit_in_product_offset` remains CLOSED and has no mutation route in v5.1; a separately confirmed future spec/plan must define the legal route and complete atomic/replay/correction contract before implementation. `RETURN_TO_AVAILABLE|DISALLOWED|EXPIRED` also have `cashEffect=NONE`: return is permitted only when reviewed evidence proves that the amount remains legally carryable, while disallow/expiry prepares a reviewed current-open-period 1156 write-off/reclass with explicit reason/provenance and no guessed counterpart. Merely recording that a request was rejected or withdrawn creates one prefilled review issue and **does not** mutate either bucket until its legal disposition is evidenced. Never infer an outcome from a bank or G/L balance.

The smallest permitted future slice is v6 PP30-only. It must target one exact CURRENT `VatFilingPayablePosition`; PP36 and PND roots are excluded. The command performs same-command replay before any lock, then atomically CASes and consumes the reserved credit allocation and current payable principal, creates the next credit/payable heads, and writes the non-cash Ledger projection Dr 2137 / Cr 1156. It never uses Bank evidence, never offsets surcharge/penalty/interest, and corrects only through a full linked REVERSAL plus optional REPLACEMENT. v5.1 defines no API, model mutation or OPEN test for this future route.

A wrong applied outcome is never edited. The caller's one command belongs to `VatCreditOutcomeCorrectionCommand`; same company + command lookup and fingerprint validation happens before any target/position CAS. Registry reservation, deterministic REVERSAL/optional REPLACEMENT child command IDs, both child results, next positions/projections and result pointers commit or roll back together, so a lost response replays both results without treating the second child as command-key reuse. The target must be the current effective ORIGINAL-or-REPLACEMENT leaf that has not already been reversed/replaced; the command pins that leaf's exact artifact hash and full lineage, locks every affected current successor position/allocation in canonical order and compares the complete expected-version set against concurrent filing/outcome work. The one permitted REVERSAL must fully reverse the still-current, exactly provable position/G/L effect of that leaf; partial or “best available residual” reversal is forbidden. When supplied, one REPLACEMENT atomically consumes the allocation recreated by that same reversal and becomes the next effective leaf, so a later correction can safely target it. An unposted projection is superseded, while a posted effect receives an exact linked reversal/current-open replacement. A proven cash-economic reversal is its own `cashEffect=WITHDRAWAL` immutable target with new evidence, so the original receipt link remains consumed history. If cash remains true during a classification correction, the current evidence is atomically transferred to the DEPOSIT replacement; if the evidence itself was wrong, the explicit evidence-unlink contract reverses/frees it. Stale/nonleaf position, wrong target/outcome, an RD successor mismatch or any effect that cannot be proved in full creates one prefilled review and changes nothing.

```text
TaxCashEvidenceLink
- id, companyId
- targetType: VAT_REFUND_OUTCOME, VAT_SCOPE_TRANSITION_DISPOSITION, VAT_FILING_PAYMENT_OUTCOME, TAX_FILING_PAYMENT_ROOT
- targetId, targetArtifactHash
- linkVersion
- allocationSetHash, totalAmount, currency, direction
- bankAccountId nullable, bankCashLedgerAccountId nullable under the conditional rule below
- status: ACTIVE, REVERSED
- expectedActiveLinkId nullable (command input/fingerprint)
- predecessorLinkId nullable, supersededByLinkId nullable
- commandId, payloadFingerprint
- ledgerProjectionRootId nullable
- linkedByUserId, linkedAt
- recordState: CURRENT, SUPERSEDED
- unique companyId,commandId
- unique companyId,targetType,targetId,linkVersion
- unique current companyId,targetType,targetId

TaxCashEvidenceAllocation
- id, companyId, taxCashEvidenceLinkId, allocationSeq
- sourceType: BANK_RECONCILIATION_MATCH, POSTED_CASH_JOURNAL_LINE
- sourceRef, sourceSnapshotHash
- amount, currency, direction
- bankAccountId nullable, bankCashLedgerAccountId nullable under the conditional rule below
- recordState: CURRENT, SUPERSEDED
- unique taxCashEvidenceLinkId,allocationSeq
- unique current companyId,sourceType,sourceRef
```

```text
TaxLedgerProjection
- id, companyId
- projectionRootId
- projectionType: VAT_SETTLEMENT, VAT_REFUND_OUTCOME, VAT_SCOPE_TRANSITION_EXTERNAL, PP30_PAYMENT, PP36_PND_PAYMENT
- targetType, targetId, targetArtifactHash
- projectionVersion
- legalEffectiveDate
- accountingPolicySnapshotHash
- effectiveAccountingPeriodId nullable until Ledger resolution
- resolvedPostingDate nullable until Ledger resolution
- dependencyRefsJson
- dependencyChecksum
- intendedLinesJson: immutable semantic roles, component amounts, currency and debit/credit sides
- status: PENDING, READY, POSTED, SATISFIED, NEEDS_REVIEW
- journalId nullable
- predecessorProjectionId nullable
- supersededByProjectionId nullable
- commandId, payloadFingerprint
- recordState: CURRENT, SUPERSEDED
- createdAt
- unique companyId,commandId
- unique companyId,projectionRootId,projectionVersion
- unique current companyId,projectionRootId
- index companyId,projectionType,targetType,targetId
```

The first projection row allocates a stable `projectionRootId`; settlement/refund/external-scope-transition/payment artifacts and the cash-evidence head reference that root. Tax-only creation persists legal date/policy truth with a null Ledger period/posting date and PENDING status. Each Ledger-resolution, status or correction change appends one command-idempotent next version after expected-current-root CAS and supersedes the prior row—never mutates intended lines or dependency history in place. A correction may point the same root's next head to a replacement target, so current uniqueness is by root rather than target. Ledger enable resolves the applicable OPEN accounting period or current-open correction from the stored date/policy without re-entry; unresolved mapping becomes NEEDS_REVIEW. Settlement dependencies include exact source/opening projection IDs/statuses/checksum. Refund, external-scope-transition and payment dependencies include the originating 1156/2137 projection plus the ACTIVE cash-evidence head where cash is involved. The current resolved accounting period is the downstream projection period inspected by Ledger close; with Ledger on, a null period whose legal date maps to the closing period is a NEEDS_REVIEW blocker. Tax-only companies have no such blocker. Correction/supersession points to a linked reversal or current-open replacement; it never rewrites a closed-period journal.

Tax truth is created first without claiming cash. A confirmed `BankReconciliationMatch` may then safely point to an eligible existing immutable target; a separate link command validates the target's persisted `artifactHash` plus a complete normalized allocation set and advances this append-only evidence head and its `TaxLedgerProjection`. Eligible VAT targets are only ORIGINAL/REPLACEMENT `VatRefundOutcome(outcome=REFUND_RECEIVED,cashEffect=DEPOSIT)`, an evidence-backed economic REVERSAL of that receipt with `cashEffect=WITHDRAWAL`, and the equivalent `REFUNDED` external-transition child. Classification/evidence corrections with `cashEffect=NONE` and every noncash outcome/disposition reject before allocation. PP30/PP36/PND payment targets follow their explicit payment action. This removes the circular create-order dependency and allows mark-first→match-later. With Banking off, `POSTED_CASH_JOURNAL_LINE` is the concrete alternative: the Ledger evidence port returns one immutable posted cash/bank journal line's company, account, direction, currency, absolute amount and content hash. v5.1 accepts it only as an exact full-line allocation; partial/reused/unposted/non-cash lines fail to one prefilled review, never a raw mutable journal ref.

Canonical `targetCashAmount` is: an eligible refund/refundable external-transition target's positive outcome amount; PP30 PAYMENT/PAYMENT_REVERSAL = principal + surcharge + penalty + interest; PP36/PND payment root = the same four-component sum. Direction comes from the immutable action/`cashEffect`, never merely from `mutationKind`: DEPOSIT for a received refund, WITHDRAWAL only for its proven economic reversal, and no cash target for NONE. A payment reversal uses its own positive component amounts, each bounded by the linked original component's unreversed amount. All child allocations in one head must use one source type, have the target action's direction/currency, sum exactly to the positive `targetCashAmount`, carry the Bank result version or posted-line content hash, and be CURRENT for only one target. This permits one real combined bank withdrawal or exact posted cash line without duplicate entry while keeping principal and charges separately posted. For a BANK_RECONCILIATION_MATCH set, `bankAccountId` is required/identical; `bankCashLedgerAccountId` is identical when already mapped but may remain null while Ledger is off or that bank account is not yet mapped. The evidence head still becomes ACTIVE from the immutable confirmed Bank allocation, while its `TaxLedgerProjection` remains PENDING; Ledger enable resolves the bank-account mapping or opens one prefilled review without asking the user to select cash again. A POSTED_CASH_JOURNAL_LINE set has no `bankAccountId` and always requires one identical `bankCashLedgerAccountId`. The Bank and Ledger evidence adapters compute the same target function. Same-command lookup precedes expected-head/source-snapshot CAS. A UI that starts from a bank line or posted journal runs these commands as one resumable orchestration with evidence already selected; a partial failure leaves one prefilled “รอผูกหลักฐานการจ่าย/รับเงิน” state and never asks for the data again.

After an ACTIVE head exists, the nullable Ledger projection becomes READY only when its cash Ledger account is resolved and may post once; Ledger-off/unmapped Bank evidence stays ACTIVE with the projection PENDING for backfill. Ordinary bank unmatch is blocked. A `PAYMENT_REVERSAL` is a new immutable deposit target with its own new cash evidence; the original outgoing link/match remains consumed history and is never freed by that economic reversal. If a tax artifact is superseded while the original cash remains true, atomically supersede/transfer the link and CURRENT allocations to the successor target under both heads/versions without freeing or reselecting the Bank match. Only an explicit evidence-unlink/corrected-bank-match command may append the REVERSED evidence/projection correction and free that allocation, after any posted Ledger effect is reversed or current-open-corrected. Two concurrent links, evidence transfer/replacement, unmatch/correction and Ledger-off→on cannot claim the same cash twice. Reviewed external proof without an allocation may record tax truth, but cannot infer or post bank cash.

Ordinary carry never crosses scopes. A policy transition with zero available/reserved predecessor credit is automatic. With nonzero credit, filing becomes `TAX_REVIEW_REQUIRED` in one prefilled task; never infer a consolidated↔branch/group split from revenue or branch balances. An immutable accountant-approved `VatCreditScopeTransfer` may apply under CAS only when Thai-specialist evidence for that exact `transitionKind` has passed and `cap.thai_tax.vat_scope_credit_transfer/<transitionKind>` is OPEN: origin allocations equal destination allocations, each origin portion is consumed/reserved once, every destination retains origin provenance, and no refund-reserved portion transfers. The external outcome requires no internal-transfer specialist gate and remains available whether that row is OPEN, CLOSED or missing.

The v5.1 product decision is **external-first** for nonzero transitions. Zero credit moves automatically without a prompt. Nonzero credit always starts from one stable work item and immutable prefilled conservation/evidence revision. Finance may prepare or add genuinely missing evidence; OWNER/ACCOUNTANT approves the exact current revision without re-entry. Final approval applies one deterministic rule with no user route choice: exact route OPEN + work-item high-water and active preparation both `NOT_STARTED` + final invariants/CAS passing creates the internal APPLIED transfer; otherwise only high-water and active preparation both `COMPLETED` with valid external evidence records the accountant/RD result externally. `IN_PROGRESS`, missing evidence, a stale/closed route or a failed CAS mutates nothing and returns the same prepared card with only the unfinished action. One work item has exactly one terminal ORIGINAL result kind (`INTERNAL_TRANSFER | EXTERNAL_OUTCOME`); the two paths are mutually exclusive, consume the predecessor only once and seed successors only once. Opening a route later never converts/replays an existing external result, and result-specific corrections never switch its kind.

```text
VatScopeTransitionWorkItem
- id
- companyId
- transitionKind
- fromTaxFilingPartitionSnapshotId
- toTaxFilingPartitionSnapshotId
- activePreparationRevisionId nullable
- externalHandlingHighWaterMark: NOT_STARTED, IN_PROGRESS, COMPLETED
- status: PREPARING, READY_FOR_APPROVAL, NEEDS_REVIEW, APPLIED_INTERNAL, RECORDED_EXTERNAL
- resultType nullable: INTERNAL_TRANSFER, EXTERNAL_OUTCOME
- resultId nullable
- finalizationCommandId nullable
- finalizationPayloadFingerprint nullable
- decisionVersion
- createdAt
- updatedAt
- unique companyId,transitionKind,fromTaxFilingPartitionSnapshotId,toTaxFilingPartitionSnapshotId
- unique companyId,finalizationCommandId where finalizationCommandId is not null

VatScopeTransitionPreparationRevision
- id
- companyId
- transitionWorkItemId
- revisionSeq
- commandId
- payloadFingerprint
- expectedWorkItemVersion
- expectedOriginPositionVersionsJson
- expectedSuccessorPositionVersionsJson
- conservationMatrixJson
- reviewedMatrixHash
- evidenceRefsJson
- evidenceHash
- externalHandlingStatus: NOT_STARTED, IN_PROGRESS, COMPLETED
- preparedByUserId
- preparedAt
- supersedesRevisionId nullable
- supersededByRevisionId nullable
- unique companyId,commandId
- unique companyId,transitionWorkItemId,revisionSeq
```

The work item is only a versioned orchestration/result owner, not a mutable transfer draft. Preparation revisions are append-only; a new source position, matrix or evidence change creates a successor revision and carries all still-valid prepared facts forward. `externalHandlingStatus` and the work-item high-water mark advance only `NOT_STARTED → IN_PROGRESS → COMPLETED`: appending a revision atomically raises the high-water mark, a successor carries the maximum forward and no command may lower either value. Finalization first compares the work item's terminal command/fingerprint, then locks the work item plus all origin/successor positions, requires the named revision to remain active and its hashes/expected versions to match, and atomically writes exactly one result plus the terminal result pointer. Internal finalization requires both values to remain `NOT_STARTED`; external finalization requires both to be `COMPLETED` with valid evidence. Same-command replay returns that result, key reuse rejects, and a competing path or stale preparation changes nothing. If an internal route closes before the final guard, the same card retains the preparation and asks only for missing external evidence rather than re-entering the matrix.

```text
VatCreditScopeTransfer
- id
- companyId
- transitionWorkItemId nullable; required for an ORIGINAL scope-policy transition
- preparationRevisionId nullable; required with transitionWorkItemId
- availabilityDecisionRef nullable; required for an ORIGINAL internal transition
- routeKey nullable; exact `transitionKind`, required with availabilityDecisionRef
- routeGeneration nullable; required with availabilityDecisionRef
- effectiveTaxPeriodId
- currency: THB
- fromTaxFilingPartitionSnapshotId
- toTaxFilingPartitionSnapshotId
- fromPolicySnapshotChecksum
- toPolicySnapshotChecksum
- totalAmount
- status: APPLIED
- commandId
- payloadFingerprint
- reversesTransferId nullable
- reversedByTransferId nullable
- approvedByUserId
- approvedAt
- appliedAt
- createdAt
- unique companyId,commandId
- unique companyId,transitionWorkItemId where transitionWorkItemId is not null and reversesTransferId is null
```

```text
VatCreditScopeTransferOriginConsumption
- id
- companyId
- transferId
- originCreditPositionId
- originAllocationIdentity
- expectedOriginPositionVersion
- consumedAmount
- consumptionSeq
- unique companyId,transferId,consumptionSeq
- unique companyId,transferId,originAllocationIdentity
- unique companyId,originCreditPositionId,originAllocationIdentity across all applied transfers

VatCreditScopeTransferDestinationLeg
- id
- companyId
- transferId
- originConsumptionId
- destinationTaxFilingScopeSnapshotId
- destinationTaxPeriodId
- expectedDestinationPositionVersion
- amount
- legSeq
- unique companyId,transferId,legSeq
- unique companyId,transferId,originConsumptionId,destinationTaxFilingScopeSnapshotId
```

`totalAmount` must be positive THB. Each origin-consumption row references one concrete current available-credit allocation and expected position version; its child destination legs may split that consumed portion across successors, but their sum must equal `consumedAmount`. Destination legs reference a concrete successor scope + effective period and expected current/empty position version. The cross-transfer uniqueness consumes an exact allocation snapshot only once; any legitimate later remainder must come from the next position/allocation snapshot and retain predecessor lineage. The transaction validates origin-consumption sum = destination-leg sum = total, locks/CASes every distinct origin and destination in canonical scope order, excludes refunded/reserved/already-consumed portions, writes unique destination provenance plus next position snapshots and marks APPLIED atomically. Under the transfer lock, same-command/same-fingerprint lookup returns the prior result before CAS; key reuse rejects and a stale expected position applies nothing. The prefilled review task is the draft: approval and APPLIED transfer creation are one atomic command, so the transfer record has no mutable DRAFT/APPROVED lifecycle. An applied transfer is immutable and corrected only by a linked approved reversal transfer plus replacement; it is never voided in place.

```text
VatScopeTransitionExternalOutcome
- id
- companyId
- transitionWorkItemId nullable; required for ORIGINAL
- preparationRevisionId nullable; required for ORIGINAL
- mutationKind: ORIGINAL, REVERSAL, REPLACEMENT
- reversesExternalOutcomeId nullable; required only for REVERSAL
- replacesExternalOutcomeId nullable; required only for REPLACEMENT
- reversedByExternalOutcomeId nullable
- replacedByExternalOutcomeId nullable
- fromTaxFilingPartitionSnapshotId
- toTaxFilingPartitionSnapshotId
- expectedOriginPositionVersionsJson
- expectedSuccessorPositionVersionsJson
- predecessorDispositionJson
- successorOpeningPositionsJson
- terminalDispositionsJson: reviewed request snapshot only; never authoritative over child rows
- reviewedMatrixHash
- evidenceRef
- status: RECORDED_EXTERNAL
- commandId
- payloadFingerprint
- correctionCommandRegistryId nullable; required for REVERSAL/REPLACEMENT
- approvedByUserId
- approvedAt
- recordedByUserId
- recordedAt
- unique companyId,commandId
- unique companyId,transitionWorkItemId where mutationKind=ORIGINAL
- unique companyId,reversesExternalOutcomeId where mutationKind=REVERSAL
- unique companyId,replacesExternalOutcomeId where mutationKind=REPLACEMENT
- unique companyId,correctionCommandRegistryId,mutationKind where correctionCommandRegistryId is not null

VatScopeTransitionExternalDisposition
- id
- companyId
- externalOutcomeId
- dispositionSeq
- originCreditPositionId
- originAllocationIdentity
- dispositionType: USED, REFUNDED, OFFSET_APPLIED, DISALLOWED, EXPIRED, OTHER_REVIEWED
- cashEffect: NONE, DEPOSIT, WITHDRAWAL
- reversesCashEvidenceLinkId nullable; required only for an evidence-backed economic REVERSAL with cashEffect=WITHDRAWAL
- amount
- currency: THB
- evidenceRef
- offsetTargetKind nullable: EXTERNAL_UNMODELED; required for OFFSET_APPLIED
- offsetCounterpartRole nullable
- offsetCounterpartAccountId nullable
- artifactHash
- ledgerProjectionRootId nullable
- unique companyId,externalOutcomeId,dispositionSeq
- unique companyId,externalOutcomeId,originCreditPositionId,originAllocationIdentity,dispositionType
```

The evidence-backed external result is the v5.1 default and remains available whether the exact `cap.thai_tax.vat_scope_credit_transfer/<transitionKind>` row is OPEN, CLOSED or missing. The user sees one prefilled matrix, one preparation history, one approval and one result; the UI never asks them to choose internal versus external or re-enter evidence. When the terminal result is external, the task finishes after the accountant/RD handles the transition. The system extracts amounts from uploaded durable evidence and shows one whole-transition reconciliation: predecessor available/reserved = successor openings + normalized immutable terminal-disposition children (`USED | REFUNDED | OFFSET_APPLIED | DISALLOWED | EXPIRED | OTHER_REVIEWED`). Those child rows are the canonical disposition truth; if `terminalDispositionsJson` is retained as the reviewed request snapshot, canonical serialization of the complete child set must equal it and the `reviewedMatrixHash`, or the transaction rejects. Each child retains exact origin allocation lineage and a canonical artifact hash including `cashEffect`. Equal successor totals are the prefilled default, but every delta must be classified/referenced and any Ledger effect gets a `VAT_SCOPE_TRANSITION_EXTERNAL` projection. A non-cash offset is restricted to `EXTERNAL_UNMODELED`, requires the exact RD reference/reviewed counterpart and must prove there is no matching current in-product payable; otherwise one prefilled review retains the candidate without mutation under `[LATER] cap.thai_tax.vat_credit_in_product_offset`, which remains CLOSED throughout v5.1. ORIGINAL/REPLACEMENT `REFUNDED` has `cashEffect=DEPOSIT`, records tax/RD truth first and becomes a cash target through `TaxCashEvidenceLink`; it cannot post Dr bank/cash → Cr 1156 from the uploaded reference alone. A REVERSAL has `cashEffect=WITHDRAWAL` only for a durable-evidence-backed economic return naming the exact active receipt evidence; classification/evidence correction uses NONE. Every other disposition has NONE and is ineligible for cash linking. Approval hashes the exact reviewed matrix, performs same-command lookup, locks the transition work item and every origin/successor in canonical order and compares the work-item and position versions before atomically recording `RECORDED_EXTERNAL`, its complete disposition children, the terminal external result pointer, closing predecessor disposition and seeding immutable successor position/allocation snapshots. Child identity/amount reuse is rejected. This is not an internal `VatCreditScopeTransfer`, does not claim system filing/RD acceptance and never requires source-document re-entry.

An external outcome correction uses the same `VatCreditOutcomeCorrectionCommand` replay owner and one-shot immutable REVERSAL + optional REPLACEMENT protocol. It targets the current effective ORIGINAL-or-REPLACEMENT leaf not already reversed/replaced and pins that leaf's complete child set/artifact hashes/origin lineage, then locks every affected current origin/successor position in canonical order and compares all expected versions. Registry, deterministically identified child outcomes/dispositions, next positions/projections and both result pointers commit atomically. The sole REVERSAL must fully reverse the still-current, exactly provable position/G/L effect; partial-residual reversal is forbidden. An optional REPLACEMENT atomically consumes the allocations recreated by that reversal and becomes the next effective leaf. Unposted projections supersede; posted effects use linked current-open Ledger reversal/replacement. A proven economic return of a REFUNDED receipt creates a new `cashEffect=WITHDRAWAL` target/evidence and leaves the original receipt allocation consumed; when cash remains true, transfer evidence to the DEPOSIT replacement, and when evidence was wrong use explicit unlink. Concurrent filing, wrong outcome/RD successor, a stale/nonleaf target or any effect not provable in full changes nothing and returns one prefilled review.

### PP30 VAT filing payable position and payment outcome

```text
VatFilingPayablePosition
- id
- companyId
- payableRootId
- taxFilingScopeSnapshotId
- filingRevision
- vatPeriodSettlementId
- positionVersion
- principalAmount
- paidPrincipalAmount
- remainingPrincipalAmount
- predecessorPositionId nullable
- supersedesPayablePositionId nullable
- supersededByPayablePositionId nullable
- paymentCarryFromPositionId nullable
- lastPaymentOutcomeId nullable
- recordState: CURRENT, SUPERSEDED
- createdAt
- unique companyId,payableRootId,positionVersion
- unique companyId,vatPeriodSettlementId
- unique current companyId,payableRootId where recordState=CURRENT

VatFilingPaymentOutcome
- id
- companyId
- taxPeriodId
- taxFilingScopeSnapshotId
- filingRevision
- payableRootId
- vatPeriodSettlementId
- expectedPayablePositionVersion
- outcomeType: PAYMENT, PAYMENT_REVERSAL
- reversesPaymentOutcomeId nullable
- principalAmount
- surchargeAmount
- penaltyAmount
- interestAmount
- currency: THB
- paymentDate
- externalReference
- evidenceRef
- note nullable
- recordedByUserId
- commandId
- payloadFingerprint
- artifactHash
- cashReconciliationStatus: PENDING, LINKED, REVERSED (derived from the current `TaxCashEvidenceLink`; not mutable outcome truth)
- ledgerProjectionRootId nullable
- appliedAt
- unique companyId,commandId
```

A PP30 payable settlement allocates a stable `payableRootId` and creates version 1 with remaining principal equal to `payableAmount`; zero payable creates no position. A corrected settlement in the same scope lineage atomically supersedes the old CURRENT head and creates the next position on that root, carrying actual paid principal as specified below; there is never one current row per old and new settlement. VAT `mark-paid` is not a status-only write: same-command lookup resolves/locks the root's current head, requires the exact current scope/revision/settlement and expected position version, then bounds positive partial principal and commits the next position plus outcome/status atomically. A late command naming the superseded settlement changes nothing. `artifactHash` canonically hashes the immutable target identity, action, four component amounts, currency and payable-position version; `evidenceRef` is required external/RD/remittance evidence but never makes the cash projection READY by itself. Partial principal leaves the authoritative scope state FILED and UI derives `PARTIALLY_PAID`; when remaining principal reaches zero, Tax scope derives PAID from the immutable payment/remittance fact even if derived `cashReconciliationStatus=PENDING` because Bank or Ledger is off. Cash reconciliation and accounting projection are separately visible, never prerequisites for Tax PAID. The immutable payment outcome records tax truth first; its cash status is read from the current append-only evidence head and is never updated on the outcome row. After an ACTIVE `TaxCashEvidenceLink`, its projection debits `VAT_SETTLEMENT_PAYABLE` (standard 2137) for principal plus the separately reviewed surcharge/penalty/interest expense roles for nonzero components, then credits bank/cash for their exact sum. Until then Tax mark-paid succeeds while one prefilled reconciliation state waits. Ledger-off keeps the nullable projection pending and backfills it without re-entry; charges never inflate principal clearing.

A settlement correction preserves actual immutable payment evidence and links/reallocates paid principal to the replacement payable instead of reversing cash: a higher replacement leaves the difference outstanding in 2137; a lower replacement routes the excess through an exact reviewed Revenue Department receivable allocation (normally Dr 1156 → Cr 2137) with provenance. Each `PAYMENT_REVERSAL` must link one exact earlier PAYMENT; under one transaction it locks the current descendant payable position, each linked component's unreversed amount, any correction-created excess-receivable allocation and the cash-evidence allocation. Its positive principal/surcharge/penalty/interest components cannot exceed the corresponding unreversed components. The balanced reversal debits bank/cash for their evidenced total, credits 2137 only for principal still applied to the descendant payable, credits 1156 for the exact remaining excess-receivable principal, and credits the same posted expense roles for any evidenced returned charge components. The two principal credits equal reversal principal; all credits equal the cash reversal. If lineage/evidence cannot prove that split, fail to one prefilled reviewed correction instead of guessing. Never infer payment or account from a bank/G/L balance; concurrent bank-link/manual mark-paid commands, corrections, partial reversals and retries cannot clear/reinstate principal/charges or consume cash evidence twice. PP36 and PND3/53 use the generic filing payment record below and never this PP30 aggregate or semantic role.

### PP36/PND filing payment evidence

```text
TaxFilingPaymentRoot
- id
- companyId
- taxPeriodId
- taxFilingScopeSnapshotId
- filingRevision
- formType: PP36, PND3, PND53
- action: PAYMENT, PAYMENT_REVERSAL
- reversesPaymentRootId nullable
- principalAmount
- surchargeAmount
- penaltyAmount
- interestAmount
- currency: THB
- paidAt
- reference
- evidenceRef nullable
- artifactHash
- ledgerProjectionRootId nullable
- createdByUserId
- createdAt
- unique companyId,reversesPaymentRootId where action=PAYMENT_REVERSAL

TaxFilingPaymentRecord
- id
- companyId
- taxPeriodId
- taxFilingScopeSnapshotId nullable only for ambiguous LEGACY_RECONCILED compatibility
- filingRevision nullable only for ambiguous LEGACY_RECONCILED compatibility
- formType: PP30, PP36, PND3, PND53
- paymentRootId nullable only for LEGACY_RECONCILED
- origin: MANUAL_EXTERNAL, SYSTEM, LEGACY_RECONCILED
- status: RECORDED_EXTERNAL, RD_ACCEPTED_VERIFIED, REJECTION_RECORDED, REVERSED, LEGACY_PAID_RECORDED
- principalAmount nullable only for LEGACY_PAID_RECORDED
- surchargeAmount nullable only for LEGACY_PAID_RECORDED
- penaltyAmount nullable only for LEGACY_PAID_RECORDED
- interestAmount nullable only for LEGACY_PAID_RECORDED
- paidAt nullable only for LEGACY_PAID_RECORDED
- reference nullable only for LEGACY_PAID_RECORDED
- evidenceRef nullable
- legacySourceRef nullable; required only for LEGACY_RECONCILED
- note nullable
- recordedByUserId nullable only for LEGACY_RECONCILED
- paymentVersion
- expectedActivePaymentRecordId nullable (command input/fingerprint)
- predecessorPaymentRecordId nullable
- supersededByPaymentRecordId nullable
- commandId
- payloadFingerprint
- recordState: CURRENT, SUPERSEDED
- recordedAt
- unique companyId,commandId
- unique companyId,taxFilingScopeSnapshotId,filingRevision,formType,paymentVersion
- unique current companyId,taxFilingScopeSnapshotId,filingRevision,formType where recordState=CURRENT
```

New PP36/PND payment truth uses one immutable economic `TaxFilingPaymentRoot` plus an append-only status head, with same-command lookup before expected-head CAS. v5.1 records one full payment root per filing revision; partial payment is rejected until that form has a separately validated policy. Initial `MANUAL_EXTERNAL` may create only `RECORDED_EXTERNAL`; only a verified SYSTEM/RD response may create `RD_ACCEPTED_VERIFIED` directly or supersede `RECORDED_EXTERNAL`. Those status successors keep the same `paymentRootId`, so an existing cash link remains visible and is never consumed again. `REJECTION_RECORDED` requires RD evidence and the exact current predecessor. A full reversal creates one new `PAYMENT_REVERSAL` root linked uniquely to the original root, then appends the `REVERSED` status; duplicate/stale-target commands change nothing. Root principal and surcharge/penalty/interest remain separate. The root `artifactHash` canonically hashes immutable identity/action/amounts/currency; `evidenceRef` on root/status is only external/RD/remittance evidence. Cash proof targets the stable payment/reversal root through an ACTIVE `TaxCashEvidenceLink`, so one allocation cannot fund two roots and a legacy evidence reference alone cannot make its cash projection READY.

Before payment, the read model/UI must keep four concepts visibly separate: `principalAmount`; `surchargeEstimateAmount` with `estimateAsOf`, rule source/version and “ประมาณการถึงวันที่ …”; `verifiedPenaltyAmount` only when an RD assessment/receipt or other permitted evidence exists (otherwise display “ยังไม่ทราบ”, never zero or a guessed percentage); and `finalRdAmount` with final RD reference/evidence/status. The estimate may refresh without mutating filing or payment truth. Amounts written to `VatFilingPaymentOutcome`/`TaxFilingPaymentRoot` are the evidence-backed paid components, not the earlier estimate, and the final total is shown as principal + evidenced charge components. The UI must not collapse these into “เบี้ยปรับประมาณ” or imply that an estimate is the amount accepted by RD.

These records never enter the PP30 credit/payable chain and never resolve through the PP30 `VAT_SETTLEMENT_PAYABLE` semantic role. A separately validated `PP36_OUTPUT_VAT_PAYABLE` mapping and aggregate may later project PP36—even if an accountant deliberately maps that distinct role to the same physical G/L code 2137—without sharing PP30 position/provenance. PND uses its own validated payable roles and likewise never reuses a PP30 aggregate or role.

`formType=PP30` is permitted only for `origin=LEGACY_RECONCILED`, `status=LEGACY_PAID_RECORDED`: it is a compatibility marker for an old aggregate `TaxPeriod.paidAt/status`, may keep amount/reference/evidence unknown, and never creates a PP30 payable/credit position, bank allocation or Ledger clearing. Deploy-owned backfill maps it to a scope only when durable history makes that unambiguous; an ambiguous multi-scope period remains an aggregate compatibility marker plus one prefilled review at the next relevant action. The same rule preserves legacy PP36/PND payment facts without customer re-entry and never upgrades them to RD-verified status.

### TaxEvent

```text
TaxEvent
- id
- companyId
- taxPeriodId
- cutoverScopePolicyId nullable
- cutoverDisposition: EXTERNAL_HANDLED, EXTERNAL_CLAIMED, CARRY_IN_CANDIDATE, IN_PRODUCT, REVIEW
- cutoverReason nullable
- eventType: VAT_OUTPUT, VAT_INPUT, VAT_EXEMPT, WHT_WITHHELD, WHT_INCOME, CIT_SUPPORT, TAX_REVIEW
- sourceType
- sourceId
- sourceLineId nullable
- sourceEventType nullable
- sourceRevisionHash nullable
- eventDate
- documentNumber nullable
- counterpartyId nullable
- counterpartySnapshotJson nullable
- branchCode nullable
- taxCode nullable
- taxRateConfigId nullable
- taxRate nullable
- taxableAmount
- taxAmount
- grossAmount nullable
- netPaidAmount nullable
- currency
- formType nullable
- reviewStatus: OK, NEEDS_REVIEW, EXCLUDED
- status: ACTIVE, SUPERSEDED, REVERSED, EXCLUDED
- idempotencyKey
- createdAt
- updatedAt
- unique companyId,idempotencyKey
- index companyId,taxPeriodId,eventType,status
- index companyId,sourceType,sourceId
```

Cutover disposition is sticky and audit-visible across resync/disable/re-enable. A credit/debit note, void or correction follows the referenced original event's scope/cutover lineage; a current-dated correction to an EXTERNAL_HANDLED original creates the external/amended correction path and never enters an ordinary current-period report solely because of its new event date.

### Input VAT Recovery Extension (`VatClaimResolution`)

The shared `VatClaimResolution` contract in Feature Entitlement Decoupling Spec v5.1 is extended by this Thai-tax amendment. One generic `claimDeadline` is forbidden because it collapses an ordinary delayed claim into a separate outer legal review. Persist/return these fields with the existing source, classification, allocation, projection, command-idempotency and append-only supersession fields:

```text
VatClaimResolution timing extension
- invoiceTaxMonth
- ordinaryDelayedClaimLastTaxMonth nullable
- outerReviewDate nullable
- necessaryCauseCode nullable
- necessaryCauseEvidenceRef nullable
- requiredInvoiceAnnotationStatus: NOT_REQUIRED, REQUIRED_MISSING, PRESENT_VERIFIED, NEEDS_REVIEW
- recoveryRoute: CURRENT_PERIOD_DELAYED, ORIGINAL_PERIOD_AMENDMENT_REVIEW, NONRECOVERABLE_CONFIRMED
- claimRuleSourceRef nullable
- claimRuleVersion nullable
- claimRuleCheckedAt nullable
```

`ordinaryDelayedClaimLastTaxMonth` is calculated from the invoice tax month under the pinned active rule source; it is the last ordinary delayed-claim month, not a write-off date. `outerReviewDate` is the separately derived three-year outer legal-review boundary under the pinned source, not permission to claim automatically. `CURRENT_PERIOD_DELAYED` is available only through the ordinary month and only when the necessary-cause evidence and required annotation on the tax invoice are present or verified under the rule. After that month the system must not put the invoice into the current return and must not mark it nonrecoverable. While the outer period remains potentially available, it opens one prefilled `ORIGINAL_PERIOD_AMENDMENT_REVIEW` carrying forward the invoice, source, allocation, cause, annotation and evidence for accountant review of an original-period amendment/refund route. `NONRECOVERABLE_CONFIRMED` is selected only by an explicit reviewed conclusion with reason/evidence; expiry of six months, reaching the outer review date, a missing annotation, missing evidence or an unverified rule never selects it automatically. A source/rule change supersedes the active resolution rather than overwriting it, and no user re-keys stored invoice data.

When a receipt/tax invoice names an employee instead of the company, classification remains `EXTERNAL_OR_UNRESOLVED` with reason `DOCUMENT_PENDING`. The one primary action is “ขอใบกำกับภาษีฉบับแก้ไขเป็นชื่อบริษัท”, prefilled with issuer, invoice and company particulars already stored. A corrected invoice resumes the same review. Only an explicit Finance/accountant action “ยืนยันว่าแก้เอกสารไม่ได้และไม่นำภาษีซื้อมาหัก” may create `NONRECOVERABLE_CONFIRMED`; merely having an employment contract, employee reimbursement, an unanswered request or reaching either date is insufficient. The UI asks only for genuinely missing correction evidence and never asks the employee to re-enter invoice fields.

### TaxEventScopeAssignment

```text
TaxEventScopeAssignment
- id
- companyId
- taxPeriodId
- taxFilingPartitionSnapshotId
- taxEventId
- taxFilingScopeSnapshotId
- filingRevision
- partitionGeneration
- contributionKey
- status: DRAFT, ACTIVE, SUPERSEDED
- assignedAt
- supersededAt nullable
- unique companyId,taxPeriodId,taxEventId,filingRevision,partitionGeneration
- unique companyId,taxPeriodId,contributionKey,filingRevision,partitionGeneration
- unique active companyId,taxPeriodId,taxEventId,filingRevision where status=ACTIVE
- unique active companyId,taxPeriodId,contributionKey,filingRevision where status=ACTIVE
- index taxFilingScopeSnapshotId,filingRevision,status
```

This frozen assignment is the enforceable disjoint-partition key. Recompute writes and validates one complete next-generation DRAFT partition, then atomically supersedes the prior draft/active partition and activates the new one. Reviewed/filed assignments are superseded only by a linked correction revision.

For a legacy TaxEvent with no branch code, first infer the authoritative branch code from an immutable source-document/payment branch snapshot or, only when unambiguous, the company's sole/main effective tax branch evidence. Then assign it to exactly one active canonical scope whose frozen membership contains that branch; use HEAD_OFFICE only when HEAD_OFFICE is the active canonical scope. Otherwise create one deduplicated period/scope-level prefilled review, exclude all unresolved branchless contributions from final totals, and never ask the customer to classify rows one by one.

### TaxReviewIssue

```text
TaxReviewIssue
- id
- companyId
- taxPeriodId nullable
- taxFilingScopeSnapshotId nullable
- taxEventId nullable
- sourceType nullable
- sourceId nullable
- issueCode
- severity: INFO, WARNING, BLOCKING
- message
- status: OPEN, RESOLVED, DISMISSED
- assignedToUserId nullable
- resolvedByUserId nullable
- resolvedAt nullable
- resolutionNote nullable
- createdAt
- updatedAt
```

### TaxReportSnapshot

```text
TaxReportSnapshot
- id
- companyId
- taxPeriodId
- taxFilingPartitionSnapshotId
- taxFilingScopeSnapshotId
- filingRevision
- partitionGeneration
- reportType: VAT_PP30, VAT_PP36, WHT_PND3, WHT_PND53, CIT_PND50_SUPPORT, CIT_PND51_SUPPORT
- totalsJson
- lineRefsJson
- reviewIssueRefsJson
- sourceChecksum
- generatedByUserId
- generatedAt
- status: DRAFT, REVIEWED, EXPORTED, VOIDED
- unique companyId,taxPeriodId,taxFilingScopeSnapshotId,filingRevision,reportType,sourceChecksum
```

### TaxFilingPackage

```text
TaxFilingPackage
- id
- companyId
- taxPeriodId
- taxFilingScopeSnapshotId
- filingRevision
- reportSnapshotId
- exportNumber
- exportType: REVIEW_JSON, CSV, XLSX, PDF, PORTAL_ATTACHMENT
- exportStatus: GENERATED, DOWNLOADED, VOIDED
- fileAttachmentId nullable
- checksum
- generatedByUserId
- generatedAt
- downloadedAt nullable
- unique companyId,exportNumber
```

An export package is only an artifact and never filing truth. One scope/revision may have many formats or no generated package when an accountant files externally.

```text
TaxFilingSubmissionRecord
- id
- companyId
- taxPeriodId
- taxFilingScopeSnapshotId nullable only for ambiguous LEGACY_RECONCILED compatibility
- filingRevision nullable only for ambiguous LEGACY_RECONCILED compatibility
- correctionCaseId nullable
- correctionRevisionId nullable
- correctionPacketHash nullable
- origin: MANUAL_EXTERNAL, SYSTEM, LEGACY_RECONCILED
- status: RECORDED_EXTERNAL, RD_ACCEPTED_VERIFIED, EXTERNAL_REJECTION_RECORDED, LEGACY_FILED_RECORDED
- reference nullable only for LEGACY_FILED_RECORDED
- evidenceRef nullable
- legacySourceRef nullable; required only for LEGACY_RECONCILED
- note nullable
- submittedAt nullable
- statusEffectiveAt nullable
- timeSource: EVIDENCE, USER_RECORDED, LEGACY_FALLBACK
- submissionVersion
- expectedActiveSubmissionRecordId nullable (command input/fingerprint)
- commandId
- payloadFingerprint
- predecessorSubmissionRecordId nullable
- supersededBySubmissionRecordId nullable
- recordState: CURRENT, SUPERSEDED
- recordedByUserId nullable only for LEGACY_RECONCILED
- recordedAt
- unique companyId,commandId
- unique companyId,taxFilingScopeSnapshotId,filingRevision,submissionVersion
- unique current companyId,taxFilingScopeSnapshotId,filingRevision where recordState=CURRENT
```

Submission/status records are append-only and command-idempotent. `submittedAt` is the real filing time when known, `statusEffectiveAt` is when the external status took effect, and `recordedAt` is only when WatchDog captured it. `correctionCaseId`, `correctionRevisionId` and `correctionPacketHash` are either all null for an ordinary filing or all present for a correction filing; the correction tuple must name the approved current revision and its immutable packet. Under the canonical scope/revision submission-head lock, same command/fingerprint returns before comparing `expectedActiveSubmissionRecordId`; a stale distinct command appends nothing. Allowed new-work transitions are: no head → `RECORDED_EXTERNAL`, or → `RD_ACCEPTED_VERIFIED` only from a verified SYSTEM/RD response; `RECORDED_EXTERNAL` → `RD_ACCEPTED_VERIFIED | EXTERNAL_REJECTION_RECORDED`. A rejection requires an explicit successor correction/new filing record and never silently downgrades or deletes the prior evidence. Verified acceptance cannot be manually downgraded; a later correction uses a linked successor filing revision/submission chain. The current `RECORDED_EXTERNAL|RD_ACCEPTED_VERIFIED` head derives scope FILED; a current rejection derives `NEEDS_REVIEW` until the linked correction is active. TaxFilingScopeSnapshot `filedAt/reference/note` fields, if retained for compatibility, are read-only mirrors of this chain. `TaxFilingPackage` is never filing truth, and manual `RECORDED_EXTERNAL` requires no prior export or claim of system submission/RD acceptance.

Manual-first is the v5.1 product route, not merely a gate failure. The classifier keys any future automated row by exact `(formType, correctionRoute, channelVersion)`; every row seeds CLOSED and an unknown/unsupported tuple always returns the same prepared packet to the manual flow. Only an independently verified provider/RD response may append `RD_ACCEPTED_VERIFIED`. A route opening later never resubmits or reclassifies an existing manual record.

Expansion backfills existing `TaxPeriod.status/filedAt/reviewNote` and `TaxFilingPackage` `ACCEPTED_MANUAL/filedManuallyAt/note` deploy-owned as `origin=LEGACY_RECONCILED`, `status=LEGACY_FILED_RECORDED`, with a deterministic `legacySourceRef`; it preserves every durable timestamp, note, package/reference and actor and leaves unavailable external times/evidence null (`timeSource=LEGACY_FALLBACK` never claims RD time). Map the marker to a canonical scope/revision only when the old evidence is unambiguous. If a legacy aggregate filed period now has multiple possible scopes, retain the aggregate compatibility fact, attach no invented scope, and create one prefilled review only at the next scope-sensitive action. No customer migration form, re-upload or re-entry is allowed, and a legacy marker never upgrades itself to `RECORDED_EXTERNAL` or `RD_ACCEPTED_VERIFIED`.

### WhtCertificate

```text
WhtCertificate
- id
- companyId
- sourcePaymentType nullable only for legacy unresolved/reconciliation; required for every new non-legacy artifact
- sourcePaymentId nullable only for legacy unresolved/reconciliation; required for every new non-legacy artifact
- payeeId nullable only for legacy unresolved/reconciliation; required for every new non-legacy artifact
- sourcePaymentRevision nullable only for legacy unresolved/reconciliation; required for every new non-legacy artifact
- whtSnapshotHash nullable only for legacy unresolved/reconciliation; required for every new non-legacy artifact
- revisionSeq
- revisionCommandId nullable
- taxPeriodId nullable
- taxEventIds nullable
- certificateNumber
- artifactOrigin: SYSTEM, EXTERNAL, LEGACY_RECONCILED
- formType: PND3, PND53
- payeeSnapshotJson
- payerSnapshotJson
- grossAmount
- withheldAmount
- netPaidAmount
- currency
- status: DRAFT, ISSUED, VOIDED
- supersedesCertificateId nullable
- supersededByCertificateId nullable
- voidReasonCode nullable
- pdfAttachmentId nullable
- pdfHash nullable
- externalEvidenceRef nullable
- externalLinkedByUserId nullable
- externalLinkedAt nullable
- deliveredAt nullable
- recipientUsageStatus nullable
- issuedByUserId nullable
- issuedAt nullable
- voidedByUserId nullable
- voidedAt nullable
- voidReason nullable
- createdAt
- updatedAt
- unique companyId,certificateNumber
- unique companyId,sourcePaymentType,sourcePaymentId,payeeId,revisionSeq where source identity is non-null
- unique companyId,revisionCommandId where revisionCommandId is not null
- unique active companyId,sourcePaymentType,sourcePaymentId,payeeId across all artifact origins where source identity is non-null and status is DRAFT|ISSUED and supersededByCertificateId is null
```

```text
WhtCertificateLine
- id
- companyId
- certificateId
- lineSeq
- incomeCategorySnapshot
- taxRate
- grossAmount
- withheldAmount
- sourceWhtLineRef
- unique companyId,certificateId,lineSeq
```

```text
WhtCertificateCopyArtifact
- id
- companyId
- certificateId
- artifactType: ORIGINAL, REPLACEMENT_COPY
- artifactOrigin: SYSTEM, EXTERNAL, LEGACY_RECONCILED
- copySeq
- statutoryContentHash
- documentHash
- renderManifestJson nullable only for deploy-owned pre-manifest legacy SYSTEM evidence; required for every new SYSTEM artifact
- renderManifestHash nullable only with that legacy exception; required for every new SYSTEM artifact
- availabilityDecisionRef nullable only for deploy-owned pre-gate legacy SYSTEM evidence; required for every new SYSTEM artifact
- systemRouteKey nullable: SYSTEM_INITIAL_ISSUE, SYSTEM_CONTENT_CORRECTION, SYSTEM_REPLACEMENT_COPY; same legacy exception, otherwise required for SYSTEM
- routeGeneration nullable only with that legacy exception; otherwise required for SYSTEM
- pdfAttachmentId
- evidenceRef nullable; required for EXTERNAL
- certificationActorSnapshotJson nullable only for deploy-owned legacy evidence; required for every new artifact when the effective form/copy requires certification
- certificationActorSnapshotHash nullable only with that legacy exception; required for every new artifact when certification applies
- certifiedByUserId nullable; optional linked internal/recording actor and never the legal signer identity by itself
- certifiedAt nullable; required when certification applies, except deploy-owned legacy evidence that cannot prove the time
- signatureSnapshotHash nullable; required only when a stored signature asset/snapshot is actually used
- generatedAt nullable
- recordedAt
- deliveredAt nullable
- unique companyId,certificateId,artifactType,copySeq
- unique companyId,certificateId where artifactType=ORIGINAL
```

`WhtCertificate.pdfAttachmentId/pdfHash` may remain as compatibility pointers to the ORIGINAL copy. Every new SYSTEM ORIGINAL, corrected ORIGINAL and `REPLACEMENT_COPY` pins an immutable canonical render manifest containing artifact/form kind, template id/version/checksum, RD/rule source URL, checked date and reviewer, `statutoryContentHash`, renderer/font versions, locale/timezone, the exact availability-decision route/generation and the applicable certification actor/signature snapshot hashes. The command fingerprint/result pins both `documentHash` and `renderManifestHash`; a render change creates a new immutable artifact and never overwrites history. Deploy-owned pre-gate/pre-manifest legacy SYSTEM evidence may retain null route/manifest fields with its legacy marker, and is never back-stamped with a current generation or sent to the customer for migration. EXTERNAL/other legacy artifacts never fabricate SYSTEM render metadata. When certification applies, every new artifact stores an immutable legal-actor snapshot/hash and certification time; deploy-owned legacy evidence keeps only what durable history proves. `certifiedByUserId` is only an optional link to the internal person who also acted or recorded the evidence. Reuse a valid company actor/signature snapshot, including an external authorized signer, so the user never has to invent a system user or re-enter it for each copy.

A `REPLACEMENT_COPY` (`ใบแทน`) keeps the same certificate identity, number and `statutoryContentHash`, visibly marks `ใบแทน`, and stores the issuer's certification actor/time plus immutable signature snapshot hash. SYSTEM generation requires OPEN `cap.wht50bis/SYSTEM_REPLACEMENT_COPY` and renders from the retained counterpart/original snapshot. Otherwise the system renders nothing and the prefilled flow links an externally prepared, certified copy made from that same retained counterpart as `artifactOrigin=EXTERNAL`; no statutory fields are re-keyed. Its `documentHash` may differ only because of the marking/certification metadata. Reuse a valid existing company signer/signature snapshot; if none exists, ask once only for the genuinely missing certification evidence. Exact statutory rendering remains behind that route's Thai-specialist gate.

The route cannot open until a versioned `ใบแทน` golden fixture passes pixel/text extraction checks against the pinned RD/template source. The fixture pair contains the retained counterpart and rendered replacement and asserts: the Thai label `ใบแทน` is visible in the approved header position and cannot overlap statutory fields; counterpart/copy identity is visible where the pinned form requires it; certificate number, payer/payee, tax identity, payment date, income lines, rates and withheld totals reproduce the retained counterpart exactly and yield the same `statutoryContentHash`; and the certification statement, legal actor, certification time and signature snapshot render in their approved positions. A missing/moved label, wrong counterpart, changed statutory value, clipped signature or hash mismatch keeps `SYSTEM_REPLACEMENT_COPY` CLOSED and returns the prefilled EXTERNAL copy handoff.

```text
WhtReplacementCopyHandoff
- id
- companyId
- certificateId
- expectedRevisionSeq
- expectedStatutoryContentHash
- expectedArtifactHash
- status: REQUIRED, EXTERNAL_LINKED, CANCELLED, SUPERSEDED
- creationCommandRegistryId
- creationCommandId
- payloadFingerprint
- resultCopyArtifactId nullable
- supersededByHandoffId nullable
- createdAt
- updatedAt
- unique creationCommandRegistryId
- unique companyId,creationCommandId
- unique current companyId,certificateId,expectedRevisionSeq,expectedStatutoryContentHash where status=REQUIRED

WhtCertificateHandoff
- id
- companyId
- sourcePaymentType
- sourcePaymentId
- payeeId
- branchCode nullable
- sourceFeatureKey
- status: REQUIRED, EXTERNAL_LINKED, SYSTEM_ISSUED, CANCELLED
- creationCommandRegistryId
- creationCommandId
- payloadFingerprint
- availabilityVectorJson
- certificateId nullable
- externalEvidenceRef nullable
- createdAt
- updatedAt
- unique creationCommandRegistryId
- unique companyId,sourcePaymentType,sourcePaymentId,payeeId
- unique companyId,creationCommandId
```

```text
WhtCommandRegistry
- id
- companyId
- commandId
- commandFamily: CERTIFICATE_ACTION, REPLACEMENT_COPY_HANDOFF, CORRECTION_CASE_CREATE, CORRECTION_REVISION
- payloadFingerprint
- resultType
- resultId
- createdAt
- unique companyId,commandId

WhtCertificateCommand
- id
- companyId
- commandRegistryId
- commandId
- action: LEGACY_RECONCILED, PREPARE_HANDOFF, ISSUE_SYSTEM, LINK_EXTERNAL, CORRECT_SYSTEM, CORRECT_EXTERNAL, CANCEL, PREPARE_REPLACEMENT_COPY_HANDOFF, ISSUE_REPLACEMENT_COPY, LINK_REPLACEMENT_COPY_EXTERNAL
- authorityMode: SOURCE_LINKED, LEGACY_ARTIFACT, LEGACY_MIGRATION
- sourcePaymentType nullable only for LEGACY_RECONCILED or LEGACY_ARTIFACT correction/cancel/copy
- sourcePaymentId nullable only for LEGACY_RECONCILED or LEGACY_ARTIFACT correction/cancel/copy
- payeeId nullable only for LEGACY_RECONCILED or LEGACY_ARTIFACT correction/cancel/copy
- expectedActiveCertificateId nullable
- expectedRevisionSeq nullable
- expectedSourcePaymentRevision nullable only for LEGACY_RECONCILED or LEGACY_ARTIFACT
- expectedWhtSnapshotHash nullable only for LEGACY_RECONCILED or LEGACY_ARTIFACT
- expectedStatutoryContentHash nullable; required for CORRECT_SYSTEM, CORRECT_EXTERNAL, CANCEL, ISSUE_REPLACEMENT_COPY, LINK_REPLACEMENT_COPY_EXTERNAL
- expectedArtifactHash nullable; required for CORRECT_SYSTEM, CORRECT_EXTERNAL, CANCEL, ISSUE_REPLACEMENT_COPY, LINK_REPLACEMENT_COPY_EXTERNAL
- authorityEvidenceRef nullable
- availabilityDecisionRef nullable; required for ISSUE_SYSTEM, CORRECT_SYSTEM, ISSUE_REPLACEMENT_COPY
- systemRouteKey nullable: SYSTEM_INITIAL_ISSUE, SYSTEM_CONTENT_CORRECTION, SYSTEM_REPLACEMENT_COPY; required for the matching SYSTEM action
- routeGeneration nullable; required whenever systemRouteKey is present
- payloadFingerprint
- resultCertificateId nullable
- resultCopyArtifactId nullable
- resultingHandoffStatus nullable: REQUIRED, EXTERNAL_LINKED, SYSTEM_ISSUED, CANCELLED
- createdAt
- unique commandRegistryId
- unique companyId,commandId
```

Every WHT mutation first reserves or replays one `WhtCommandRegistry` row; its company-global unique key is the cross-action/case/revision concurrency fence, while the action tables remain immutable history. `WhtCertificateCommand.commandRegistryId`, `WhtReplacementCopyHandoff.creationCommandRegistryId`, `WhtCorrectionCase.creationCommandRegistryId` and `WhtCorrectionRevision.commandRegistryId` reference that same company + command key, and registry reservation, domain result and result pointer commit or roll back in one transaction. `LEGACY_RECONCILED` is deploy-owned, requires `authorityMode=LEGACY_MIGRATION` plus `resultCertificateId`, and may omit source identity/revision/hash only when that certificate remains unlinked/`LEGACY_UNRESOLVED`; no live action may use that mode. Seed an ORIGINAL copy row only from durable legacy PDF/hash evidence; otherwise retain `LEGACY_UNRESOLVED` certificate metadata plus one discoverable task without fabricating artifact origin/content or asking for re-upload. A reconstructed row uses `artifactOrigin=LEGACY_RECONCILED` unless durable evidence proves SYSTEM or EXTERNAL. Every initial handoff/issue/link and every SOURCE_LINKED action requires the complete source-payment/payee identity plus expected source revision/WHT hash. `CORRECT_*|CANCEL|ISSUE_REPLACEMENT_COPY|LINK_REPLACEMENT_COPY_EXTERNAL` also require expected active certificate/revision and the current statutory-content/artifact hashes; copy additionally proves the statutory hash is unchanged in its result. `ISSUE_SYSTEM`, `CORRECT_SYSTEM` and `ISSUE_REPLACEMENT_COPY` map respectively to the exact WHT route rows above. After replay lookup and immediately before number reservation/render/final mutation, Foundation resolves and CAS-validates that row; the command, artifact/render manifest and outbox all pin `availabilityDecisionRef + systemRouteKey + routeGeneration`. A close/reopen or sibling OPEN therefore makes delayed work stale and routes it to its action-specific EXTERNAL fallback without allocating another number or artifact. For a reviewed unlinked legacy artifact, only those corrective actions may use `authorityMode=LEGACY_ARTIFACT`; they require exact current hashes and retained-authority evidence instead of a fabricated payment identity. This lets deploy-owned history seeding preserve evidence without blocking a legally necessary repair, while every live action is fenced to either the current source snapshot or the exact retained artifact.

Only `settlementStatus=SETTLED AND withheldAmount>0` with valid WHT lines whose sum exactly equals the payment's withheld amount and a complete/unambiguous statutory snapshot may create the initial issue outbox. The effective template/rules define required payer/payee identity, tax IDs/address/branch where applicable, payee taxpayer class→PND3/PND53, payment/withholding date and form classification. Infer from stored master/payment snapshots. Zero/no-WHT is `NOT_APPLICABLE`; missing/invalid/ambiguous positive-WHT facts are one prefilled review reachable from the payment/global hub under current source visibility or exact retained pre-cutoff handoff/artifact authority + `wht.certificate.prepare`, including with Tax off. Neither reserves a number or creates a request/PDF, and already stored facts are never re-entered. After review, SYSTEM issuance requires OPEN `cap.wht50bis/SYSTEM_INITIAL_ISSUE`; otherwise create/continue the EXTERNAL handoff. Initial idempotency is company + source-payment type/id + payee. `WhtCertificateCommand` is the append-only command history for initial handoff/issue/link and later certificate actions; the handoff status is derived from its latest successful transition rather than overwritten without evidence. Expansion is deploy-owned: link existing certificates before constraints, seed one `LEGACY_RECONCILED` command and ORIGINAL copy row from durable audit/PDF metadata where available, and leave genuinely unprovable source revision/hash nullable/`LEGACY_UNRESOLVED` rather than asking customers to re-upload or re-key history. Ambiguous historical cumulative payments are never fabricated or auto-issued.

Source payment settlement and immutable WHT fact capture never depend on a SYSTEM route. While `cap.wht50bis/SYSTEM_INITIAL_ISSUE` is CLOSED, a qualifying payment creates/returns one durable `EXTERNAL_CERTIFICATE_REQUIRED` handoff with external certificate upload/link, but no system number/PDF/delivery. The action uses current source visibility or exact retained pre-cutoff handoff/artifact authority + `wht.external_certificate.link`, tenant/branch checks and audit, and remains reachable outside Tax workspace. External upload/link and system Issue share the source-identity lock, command idempotency and one-active predicate; upload-vs-Issue races produce one active artifact, and the loser links/returns it before any system number reservation. Register an EXTERNAL number atomically in the same company `tax.wht_certificate` namespace as SYSTEM issuance: same identity is idempotent, a different-identity collision creates one review, and future system reservation skips the registered number transactionally without asking for renumber/re-entry. Reopening does not auto-issue historical rows. An explicit reviewed system Issue/Reissue must find no active linked artifact of any origin, including `LEGACY_RECONCILED`, then uses the current availability vector; this preserves source-feature independence without risking a duplicate legal artifact.

An issue/correction transaction preserves immutable source revision/hash, statutory snapshots, sequence, copy artifacts, render manifest and delivery evidence. Same command + same fingerprint/expected tuple returns its prior result; key reuse rejects; a distinct stale command fails expected-active/revision/source-payment/WHT-hash CAS before number registration/reservation. Certificate-only correction/cancellation/`ใบแทน` uses current source visibility or exact retained pre-cutoff legal-artifact authority + `wht.certificate.correct`, not `thai_tax`. Content correction under OPEN `cap.wht50bis/SYSTEM_CONTENT_CORRECTION` creates a new SYSTEM number/PDF; otherwise the same prefilled flow accepts a corrected EXTERNAL number/PDF/evidence. Either path atomically marks the prior active record VOIDED/SUPERSEDED, registers one new-number revision with bidirectional links and records cancellation/corrected delivery. External and system commands share the active identity lock, append-only command history and company number namespace. A settled reversal opens review unless audited facts prove withholding never occurred.

### WhtCorrectionCase

```text
WhtCorrectionCase
- id
- companyId
- activeCertificateId
- creationCommandRegistryId
- creationCommandId
- creationPayloadFingerprint
- expectedActiveCertificateId
- expectedCertificateRevisionSeq
- provenanceMode: SOURCE_LINKED, LEGACY_ARTIFACT
- sourcePaymentType nullable only for LEGACY_ARTIFACT
- sourcePaymentId nullable only for LEGACY_ARTIFACT
- payeeId nullable only for LEGACY_ARTIFACT
- legacyAuthorityEvidenceRef nullable; required only for LEGACY_ARTIFACT
- activeRevisionSeq
- activeRevisionId
- certificateCorrectionRequired
- returnCorrectionRequired
- refundRequired
- returnRoute nullable: RETURN_DRAFT, SUBMITTED_UNPAID, FILED, EXTERNAL
- returnCorrectionType nullable: DATA_PP01, FORM_PP02_REVIEW, ADDITIONAL_POSITIVE, ADDITIONAL_NEGATIVE, OVERSTATED_REFUND_REVIEW, TAX_REVIEW_REQUIRED
- fundingSource: WITHHELD_FROM_PAYEE, PAYER_OWN_FUNDS, MIXED, UNKNOWN
- refundClaimantType nullable
- refundClaimantId nullable
- refundAuthorityEvidenceRef nullable
- paymentReconciliationStatus
- certificateBranchStatus
- returnBranchStatus nullable
- externalReturnAcknowledgementRef nullable
- activeAuthorityOutcomeId nullable
- refundBranchStatus nullable
- status: OPEN, NEEDS_REVIEW, IN_PROGRESS, COMPLETED
- createdAt
- updatedAt
- unique creationCommandRegistryId
- unique companyId,creationCommandId
- unique nonterminal companyId,activeCertificateId where status=OPEN|NEEDS_REVIEW|IN_PROGRESS
```

```text
WhtCorrectionRevision
- id
- companyId
- correctionCaseId
- revisionSeq
- commandRegistryId
- revisionCommandId
- payloadFingerprint
- expectedActiveCertificateId
- expectedCertificateRevisionSeq
- expectedSourcePaymentRevision nullable only for LEGACY_ARTIFACT
- expectedWhtSnapshotHash nullable only for LEGACY_ARTIFACT
- expectedStatutoryContentHash
- expectedArtifactHash
- proposedSourceIdentityHash nullable only for LEGACY_ARTIFACT
- sourceCorrectionRef nullable
- routeSnapshotJson
- correctionPacketAttachmentId nullable; required for an active FILED or EXTERNAL manual-correction route
- correctionPacketHash nullable; required with correctionPacketAttachmentId
- correctionEligibilitySnapshotJson nullable; required for DATA_PP01, FORM_PP02_REVIEW and ADDITIONAL_NEGATIVE
- correctionEligibilitySnapshotHash nullable; required with correctionEligibilitySnapshotJson
- responsibleAuthorityOfficeRef nullable; required for PP01/PP02 local handling
- localChannelPolicyRef nullable; required for PP01/PP02 local handling
- localChannelPolicyVersion nullable; required with localChannelPolicyRef
- localChannelPolicyEvidenceHash nullable; required with localChannelPolicyRef
- localChannelPolicyCheckedAt nullable; required with localChannelPolicyRef
- localChannelPolicyValidUntil nullable
- localChannelChecklistJson nullable; required for PP01/PP02 local handling
- localChannelChecklistHash nullable; required with localChannelChecklistJson
- correctionPacketManifestJson nullable; required when correctionPacketAttachmentId is present
- correctionPacketManifestHash nullable; required with correctionPacketManifestJson and included in correctionPacketHash
- authorityRoutePolicyRef nullable; required for a submitted FILED/EXTERNAL correction
- authorityRoutePolicyVersion nullable; required with authorityRoutePolicyRef
- authorityRoutePolicyHash nullable; required with authorityRoutePolicyRef
- authorityTerminalStatusesJson nullable; required with authorityRoutePolicyRef
- authorityTerminalStatusesHash nullable; required with authorityTerminalStatusesJson
- channelValidationDecisionRef nullable; required for ADDITIONAL_NEGATIVE
- channelValidationDecision nullable: VERIFIED; required for ADDITIONAL_NEGATIVE
- channelValidationSourceStatus nullable: ACTIVE; required for ADDITIONAL_NEGATIVE
- channelValidationEvidenceHash nullable; required for ADDITIONAL_NEGATIVE
- channelValidationCheckedByUserId nullable; required for ADDITIONAL_NEGATIVE
- channelValidationCheckedAt nullable; required for ADDITIONAL_NEGATIVE
- channelValidationValidUntil nullable
- approvalSnapshotJson nullable
- supersedesRevisionId nullable
- supersededByRevisionId nullable
- createdAt
- unique commandRegistryId
- unique companyId,correctionCaseId,revisionSeq
- unique companyId,revisionCommandId
```

```text
WhtCorrectionAuthorityOutcome
- id
- companyId
- correctionCaseId
- correctionRevisionId
- correctionPacketHash
- routeKind: PP01_AREA_REQUEST, PP02_AREA_REQUEST, EFILING_ADDITIONAL_NEGATIVE
- outcomeSeq
- status: SUBMISSION_RECORDED, RECEIPT_RECORDED, AUTHORITY_REVIEW_PENDING, MORE_INFORMATION_REQUESTED, APPROVED_EVIDENCED, DATABASE_UPDATE_VERIFIED, EFILING_ACCEPTED_VERIFIED, REJECTED_EVIDENCED, WITHDRAWN_EVIDENCED
- terminalEffect: NONE, COMPLETE_RETURN_BRANCH, REOPEN_REVIEW
- authorityReference nullable
- evidenceRef
- evidenceHash
- statusEffectiveAt
- authorityRoutePolicyRef
- authorityRoutePolicyVersion
- authorityRoutePolicyHash
- authorityTerminalStatusesHash
- predecessorAuthorityOutcomeId nullable
- commandId
- payloadFingerprint
- recordedByUserId
- recordedAt
- unique companyId,commandId
- unique companyId,correctionCaseId,outcomeSeq
```

`returnRoute`, `returnCorrectionType` and `returnBranchStatus` are null exactly when `returnCorrectionRequired=false`; when true, all three are required. Route classes map to the normative filing-link machine as follows: RETURN_DRAFT ↔ `IN_RETURN_DRAFT`; SUBMITTED_UNPAID ↔ `SUBMITTED_PENDING_PAYMENT|PAYMENT_RECONCILING`; FILED ↔ `FILED_PAID|CORRECTION_REQUIRED|CORRECTED`; EXTERNAL ↔ evidence-backed external filing state with no authoritative in-product return link. For `DATA_PP01`, `FORM_PP02_REVIEW` and `ADDITIONAL_NEGATIVE`, `CORRECTED` requires an append-only authority outcome whose status appears in the immutable revision's exact `authorityTerminalStatusesJson`, whose policy/evidence/packet hashes match, and whose `terminalEffect=COMPLETE_RETURN_BRANCH`. Submission, a courier slip, office receipt, e-Filing upload reference, payment or `APPROVED_EVIDENCED` without the route's required final verification remains pending. `REJECTED_EVIDENCED|WITHDRAWN_EVIDENCED` uses `REOPEN_REVIEW` and cannot complete the correction. Case `COMPLETED` is the storage/API name for conceptual CLOSED and is permitted only after every required certificate/return/refund branch is terminal.

Case creation and revision are command-idempotent under the active-certificate lock. The server first reserves or returns the shared company-global `WhtCommandRegistry` result for the same fingerprint; cross-family key reuse rejects. Otherwise it verifies the expected active certificate/revision and the partial unique predicate before creating one nonterminal case and its first immutable revision atomically. That first revision references the same creation command/registry result; later revisions reserve their own registry row before allocating `revisionSeq`. Concurrent operators therefore converge on one case. When a correction supersedes the certificate, the same transaction advances `activeCertificateId`/revision and preserves the nonterminal uniqueness fence.

Each immutable case revision stores old/new certificate and filing/receipt references, pay-in-slip reconciliation, reason/approval, RD/refund outcomes, delivery/recipient-use evidence and claimant/funds origin. Its active certificate/revision expectations are always required. SOURCE_LINKED revisions additionally require source-payment revision/WHT hash CAS. A LEGACY_ARTIFACT revision instead requires exact current statutory-content/artifact hash and the case's reviewed retained-authority evidence; it may repair/copy the artifact but must never invent or mutate a payment/payee link. A FILED/EXTERNAL manual revision owns one immutable packet attachment/hash; downloading it never regenerates or changes the approved revision. A late slip, office/channel rule change or material route change supersedes the old approval packet. Certificate and return branches authorize independently: a source-only user can complete the certificate branch; when Tax is off or filing was external, the source/global hub records an evidence-backed external-return acknowledgement/handoff without claiming RD acceptance. For a correction filing, `externalReturnAcknowledgementRef` is derived only from the exact current `TaxFilingSubmissionRecord` linked to that case/revision/packet hash, never from a free-text reference. That acknowledgement proves only the recorded external submission. Authority outcomes append under same-command-first lookup and exact current-outcome predecessor CAS; wrong case/revision/packet/policy/evidence hash or a reused key with another fingerprint appends nothing. The case closes only when every applicable certificate, return and refund branch reaches its route-specific successful terminal outcome. The exact correction routing and specialist gate are normative in Feature Entitlement Decoupling Spec v5.1 CC5.

The v5.1 classifier builds its immutable before/after and `routeSnapshotJson` from stored facts: DRAFT rebuilds in-product; SUBMITTED_UNPAID requests cancellation and terminalizes the old slip before replacement; FILED unchanged-amount data errors use ป.ป.01; wrong form/taxpayer class uses ป.ป.02 review; short remittance uses `ADDITIONAL_POSITIVE`; over-remittance for PND3/PND53 may use `ADDITIONAL_NEGATIVE` only under a current verified channel/rule snapshot, otherwise `OVERSTATED_REFUND_REVIEW|TAX_REVIEW_REQUIRED`. A negative filing never proves refund entitlement or claimant authority; ค.10/refund remains a separate branch. The route snapshot pins form, period, original/new return and receipt refs, slip state, deltas, selected route, rule/channel URL + version, `channelValidationDecisionRef`, `validationDecision=VERIFIED`, `sourceStatus=ACTIVE`, `validationEvidenceHash`, `checkedByUserId`, `checkedAt`, `validUntil` and packet checksum. `ADDITIONAL_NEGATIVE` requires that exact current decision at classification, approval and mark-filed; a source URL alone is insufficient. A late slip, source retirement/expiry or other material change supersedes both packet and approval and requires one approval for the new stable revision.

ป.ป.01/ป.ป.02 eligibility is allowlisted from the pinned official form version, not inferred from a friendly label. The baseline routes ป.ป.01 only when the requested data correction is permitted by that form and the before/after snapshot proves no income, withholding-tax or remittance total changes; identity substitution, amount changes and any field outside the form's allowlist go to review. ป.ป.02 is available only for the exact form/taxpayer-class change allowed by its pinned form version; it is never a generic wrong-form shortcut. The selected responsible area office and actual submission channel are versioned separately because local requirements may differ. Before approval the system produces one manifest-backed packet containing the completed request form, immutable before/after summary, original return/receipt references, taxpayer/payer/payee identity evidence, signatory/authorization evidence, attachments/copies required by that office, destination/channel/contact instructions, checked date, source URLs and validity. Known data is merged from source records; the checklist asks only for missing items. A generic RD page or another office's instructions may seed review but cannot mark the selected local channel verified.

The authority lifecycle is route-policy driven. For a ป.ป.01/ป.ป.02 office request, receipt normally advances to `AUTHORITY_REVIEW_PENDING`; only the selected policy's evidence-backed database-update/final status may complete the return branch. For negative-additional e-Filing, only a verified e-Filing acceptance/final status named by that exact form/route/channel policy may complete the filing branch; payment, refund entitlement and ค.10 remain independent branches. Each revision snapshots the terminal-status set so a later rule update cannot reinterpret history. A route-policy change creates a successor revision/packet instead of changing old outcomes.

### Accountant Handoff

Do not add a tax-owned handoff table or migration. Phase 0 must survey and reuse the existing invited `CompanyMembership`, ACCOUNTANT role/permissions and `WorkflowTask`/`WorkCardUserState` seam from Feature Entitlement Decoupling Spec F0. The correction card owns one deterministic `businessIssueKey` derived from company + case + active revision + packet hash. “ส่งให้นักบัญชี” may assign that issue only to an invited ACTIVE company member whose current company/branch membership and domain permissions can read the case; if no such member exists, use the existing company invite flow and resume the same prefilled card after acceptance.

Packet download remains a domain endpoint, not a stored/public share link. On every request it rechecks authenticated session, ACTIVE membership, company/branch/case permission, active-or-historical revision visibility, exact packet hash, task assignment where applicable and short-lived response expiry, then records principal, request id, time and packet hash in audit. There is no bearer/public/anonymous share URL. A successor packet advances the same business issue/task through existing lineage and keeps the assignee only when permission remains valid. Assigning, accepting, downloading or returning work never appends a filing submission or authority outcome and never displays “ยื่นแล้ว”; it means only “ส่งให้นักบัญชีตรวจ/ดำเนินการ”.

### TaxAdjustment

```text
TaxAdjustment
- id
- companyId
- taxPeriodId
- taxFilingScopeSnapshotId required for VAT_OUTPUT, VAT_INPUT and WHT; nullable only for genuinely non-scope CIT_SUPPORT
- adjustmentType: VAT_OUTPUT, VAT_INPUT, WHT, CIT_SUPPORT
- reasonCode
- note
- taxableAmountDelta
- taxAmountDelta
- currency
- sourceRefJson nullable
- status: DRAFT, APPROVED, VOIDED
- createdByUserId
- approvedByUserId nullable
- approvedAt nullable
- createdAt
- updatedAt
```

### TaxVerificationChecklist

```text
TaxVerificationChecklist
- id
- companyId
- taxYearConfigId
- itemCode
- label
- status: TODO, CONFIRMED, NOT_APPLICABLE, BLOCKED
- reviewerUserId nullable
- reviewedAt nullable
- sourceId nullable
- note nullable
- createdAt
- updatedAt
```

## 10. Shared Contract Draft

Add `packages/contracts/src/tax.ts` and export it from `packages/contracts/src/index.ts`.

Minimum contract types:

```ts
export type TaxType = 'VAT' | 'WHT' | 'CIT' | 'PIT';
export type TaxFormType = 'PP30' | 'PP36' | 'PND3' | 'PND53' | 'PND50' | 'PND51';
export type TaxPeriodStatus =
  | 'OPEN'
  | 'NEEDS_REVIEW'
  | 'READY_FOR_REVIEW'
  | 'REVIEWED'
  | 'EXPORTED'
  | 'FILED'
  | 'PAID'
  | 'CLOSED'
  | 'AMENDED';
export type TaxEventType =
  | 'VAT_OUTPUT'
  | 'VAT_INPUT'
  | 'VAT_EXEMPT'
  | 'WHT_WITHHELD'
  | 'WHT_INCOME'
  | 'CIT_SUPPORT'
  | 'TAX_REVIEW';
export type TaxMoney = {
  amount: string;
  currency: 'THB' | string;
};
export type TaxSourceRef = {
  sourceType: string;
  sourceId: string;
  sourceLineId?: string;
  documentNumber?: string;
  webUrl?: string;
  permissionChecked?: true;
};
export type TaxPeriodDto = {
  id: string;
  taxType: TaxType;
  formType: TaxFormType;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  onlineDueDate?: string;
  status: TaxPeriodStatus; // derived aggregate compatibility; not filing truth
  reviewIssueCount: number;
};
export type TaxFilingScopeDto = {
  id: string;
  filingScopeId: string;
  partitionGeneration: number;
  scopeGeneration: number;
  scopeKind: 'HEAD_OFFICE' | 'CONSOLIDATED' | 'BRANCH' | 'CONFIGURED_GROUP';
  branchCodes: string[];
  branchSetHash: string;
  policyVersion: string;
  status: TaxPeriodStatus;
  activeFilingRevision: number;
  reviewIssueCount: number;
};
export type VatReportLineDto = {
  id: string;
  eventType: 'VAT_OUTPUT' | 'VAT_INPUT' | 'VAT_EXEMPT' | 'TAX_REVIEW';
  sourceRef: TaxSourceRef;
  documentNumber?: string;
  eventDate: string;
  counterpartyName?: string;
  taxableAmount: TaxMoney;
  vatAmount: TaxMoney;
  reviewStatus: 'OK' | 'NEEDS_REVIEW' | 'EXCLUDED';
};
export type VatReportDto = {
  period: TaxPeriodDto;
  filingScope: TaxFilingScopeDto;
  filingRevision: number;
  outputVat: TaxMoney;
  inputVat: TaxMoney;
  payableOrRefund: TaxMoney;
  lines: VatReportLineDto[];
  sourceChecksum: string;
  generatedAt: string;
};
export type WhtReportLineDto = {
  id: string;
  formType: 'PND3' | 'PND53';
  sourceRef: TaxSourceRef;
  paymentDate: string;
  payeeName: string;
  payeeTaxId?: string;
  incomeCategory: string;
  rateCode?: string;
  grossAmount: TaxMoney;
  withheldAmount: TaxMoney;
  netPaidAmount: TaxMoney;
  certificateId?: string;
  reviewStatus: 'OK' | 'NEEDS_REVIEW' | 'EXCLUDED';
};
export type WhtReportDto = {
  period: TaxPeriodDto;
  formType: 'PND3' | 'PND53';
  grossTotal: TaxMoney;
  withheldTotal: TaxMoney;
  netPaidTotal: TaxMoney;
  lines: WhtReportLineDto[];
  sourceChecksum: string;
  generatedAt: string;
};
export type CitSupportingSummaryDto = {
  period: TaxPeriodDto;
  accountingPeriodId: string;
  ledgerReportRefs: TaxSourceRef[];
  revenueTotal: TaxMoney;
  expenseTotal: TaxMoney;
  profitOrLoss: TaxMoney;
  taxExpenseTotal?: TaxMoney;
  sourceChecksum: string;
  generatedAt: string;
  disclaimer: string;
};
```

Contracts must not expose Prisma row types. Money and dates cross API boundaries as strings.

## 11. Source Adapter Contracts

Tax module must consume source facts through application ports or permission-checked internal APIs. Do not read source tables directly from AI Gateway.

```text
TaxSourceEventReader
- listVatCandidateSources(companyId, periodStart, periodEnd, branchCode?)
- listWhtCandidateSources(companyId, periodStart, periodEnd, branchCode?)
- getSourceTaxDetail(companyId, sourceType, sourceId)
- getSourceWebLink(companyId, sourceType, sourceId)

TaxLedgerSummaryReader
- getProfitAndLossSummary(companyId, accountingPeriodId)
- getAccountingPeriod(companyId, periodKeyOrId)
- assertPeriodMutationAllowed(companyId, businessDate)

TaxSourceMutationPolicy
- assertTaxMutationAllowed(companyId, sourceType, sourceId, mutationDate)
```

Source detail must include:

- companyId
- branchId/branchCode when applicable
- source type/id/line id
- source event type and event date
- document number/date
- counterparty snapshot and tax id when available
- VAT mode and input VAT claim status when applicable
- taxable amount, VAT amount, WHT rate/category/amount, gross amount, net paid amount
- currency
- source revision hash or updated timestamp
- posting/void/reversal/correction status
- web link/deep-link target when available

## 12. API Behavior

Tax routes are under `/v1/companies/:companyId/tax` unless the repo has a different versioning convention. Route `companyId` is a tenant selection hint and must be verified against request context. The effective VAT-registration fact is deliberately shared, not Tax-owned:

```text
GET /v1/companies/:companyId/vat-registration
- Permission: company.vat_registration.read.
- Returns source-date fact/status/effective range/version plus the deprecated compatibility tuple.

PUT /v1/companies/:companyId/vat-registration
- Permission: company.vat_registration.manage.
- Requires caller-stable command id/fingerprint, status, effective date and expectedVersion. Same-command lookup returns the stored fact/no-op result before state CAS; a new command appends the audited non-overlapping fact and atomically updates the known-current mirror.
- The first-party legacy adapter may submit the changed prefilled `(vatRegistered, vatEffectiveDate)` tuple + command/fingerprint + expectedVersion. Exact GET→PUT echo records a replay-safe no-op; stale/unsupported input returns `vat_registration_contract_upgrade_required`.
```

```text
GET /profile
- Permission: tax.config.read or tax.report.read.
- Returns company tax profile and verification status.

PATCH /profile
- Permission: tax.config.manage.
- Updates branch policy, accounting period, tax reviewer, and legal/tax snapshots. It only projects VAT-registration facts: an unchanged legacy `(vatRegistered, vatEffectiveDate)` echo is ignored; a changed boolean/date returns the shared versioned endpoint/adapter in `vat_registration_contract_upgrade_required` and never mutates a Tax-owned copy. Audited.

GET /configs/tax-years
- Permission: tax.config.read.
- Lists tax year configs, status, source refs, and verification checklist summary.

POST /configs/tax-years
- Permission: tax.config.manage.
- Creates draft tax year config. Requires source note or source link.

PATCH /configs/tax-years/:taxYearConfigId
- Permission: tax.config.manage.
- Updates config status or metadata. Activating requires checklist policy.

GET /configs/rates
- Permission: tax.config.read.
- Lists VAT/WHT/CIT/PIT config rows.

POST /configs/rates
- Permission: tax.config.manage.
- Creates draft/active rate config row. Audited.

GET /configs/calendar-rules
- Permission: tax.config.read.
- Lists due-date and online-extension rules.

POST /configs/calendar-rules
- Permission: tax.config.manage.
- Creates calendar rule. Audited.

POST /configs/verification-checklist/:itemId/confirm
- Permission: tax.config.manage.
- Confirms checklist item with reviewer/source/note.

GET /periods
- Permission: tax.period.read.
- Lists calendar periods plus their filing scopes by form type, scope status, due date, branch membership, and date range.

POST /periods/sync
- Permission: tax.event.sync.
- Creates/updates periods and tax events for requested form/date range. Idempotent.

GET /vat/periods/:periodId/scopes/:filingScopeId/report
- Permission: tax.report.read.
- Returns one scope/revision VAT report for PP30 or PP36 with source refs and review issues.

POST /vat/periods/:periodId/scopes/:filingScopeId/recompute
- Permission: tax.event.sync + tax.report.recompute.
- Re-syncs that unfiled/unclosed scope and regenerates a complete disjoint assignment/report snapshot. Audited.

GET /wht/periods/:periodId/scopes/:filingScopeId/report
- Permission: tax.report.read.
- Returns one scope/revision WHT report for PND3 or PND53.

POST /wht/payment-handoffs/:handoffId/review-facts
- Permission: current source-payment visibility or exact retained handoff/artifact authority + `wht.certificate.prepare`; no `thai_tax`.
- Returns stored payer/payee/WHT facts prefilled, accepts only missing evidence with expected source-payment revision/hash, and then issues only under OPEN `cap.wht50bis/SYSTEM_INITIAL_ISSUE` or continues the same EXTERNAL handoff.

POST /wht/certificates
- Compatibility route only: source-document authorization + OPEN `cap.wht50bis/SYSTEM_INITIAL_ISSUE` for SYSTEM generation; it accepts a settled payment identity or links/returns an already eligible source identity.
- It never creates a certificate from arbitrary selected WHT event ids. The normal path is the qualifying SETTLED payment outbox, which allocates once through document sequence and does not require `thai_tax`.
- When exact `cap.wht50bis/SYSTEM_INITIAL_ISSUE` was CLOSED/missing at settlement, the route may perform only an explicit reviewed Issue/Reissue after the `EXTERNAL_CERTIFICATE_REQUIRED` task confirms no external artifact exists; otherwise it links the uploaded external certificate.

POST /wht/payment-handoffs/:handoffId/external-certificate
- Permission: current source-payment visibility or exact retained handoff/artifact authority + `wht.external_certificate.link`; no `thai_tax` entitlement or Tax-workspace permission.
- Request includes command id/fingerprint plus expected source-payment revision/WHT hash. After same-command lookup it checks tenant/branch, source snapshot and identity/number lock; stale source registers nothing and returns one prefilled review. Otherwise it command-idempotently registers/links external number/PDF/evidence, or returns the existing artifact/review without asking for re-entry.

GET /wht/certificate-action-items
- Permission: `wht.certificate.read`; no `thai_tax`.
- Returns permission-filtered pending handoffs, missing-fact reviews, correction cases and replacement-copy actions discoverable from current source visibility or server-derived exact retained pre-cutoff handoff/certificate authority. The read model is company/branch/cutoff/artifact scoped, masks unrelated source detail and returns live source/global-hub links only.

GET /wht/payment-handoffs/:handoffId
GET /wht/certificates/:certificateId
- Permission: `wht.certificate.read`; no `thai_tax`.
- Requires current source/case visibility or exact retained handoff/certificate authority and returns the immutable prefilled snapshot, active revision, allowed actions and evidence already stored. It never grants ordinary source access after OFF.

POST /wht/certificates/:certificateId/void
- Compatibility classifier: current source/case visibility or exact retained legal-artifact authority + `wht.certificate.correct`; no `thai_tax` for the certificate branch.
- It never directly changes an issued certificate status. Proven no-withholding reversal routes to reviewed cancellation; content error opens immutable supersession/new-number correction; return-only error leaves the certificate unchanged and opens the state-specific return/refund route. Audited.

POST /wht/certificates/:certificateId/replacement-copies
- Permission: current source/case visibility or exact retained legal-artifact authority + `wht.certificate.correct`; no `thai_tax`.
- Requires caller-stable command id/fingerprint, expected active certificate/revision and expected statutory-content/artifact hashes. SOURCE_LINKED also requires expected source-payment revision/WHT hash; reviewed LEGACY_ARTIFACT instead requires exact retained-authority evidence and never invents a source identity. It resolves an authorized issuer certification/signature snapshot, prefilling the existing valid company signer; missing certification evidence creates one focused review. Same-command replay returns the same copy artifact; stale/reused commands create nothing.
- With OPEN `cap.wht50bis/SYSTEM_REPLACEMENT_COPY`, `ISSUE_REPLACEMENT_COPY` emits a separately hashed SYSTEM `ใบแทน` PDF from the retained counterpart. When that exact route is CLOSED/missing, no system PDF is rendered: the same replay-safe request creates/returns one `WhtReplacementCopyHandoff(REQUIRED)` prefilled from the retained certificate, and `LINK_REPLACEMENT_COPY_EXTERNAL` later atomically links an externally prepared certified PDF/hash/evidence and marks it EXTERNAL_LINKED. The state of either sibling WHT route is irrelevant. Both preserve certificate identity/number/content, store certification actor/time/signature hash and create no certificate revision or repeated statutory-data form.

POST /wht/certificates/:certificateId/correction-cases
- Authorizes the proposed certificate/return/refund branches independently under the same rules as revision commands.
- Requires company-global command id/fingerprint, expected active certificate id/revision, expected statutory-content/artifact hashes, initial immutable diff/route snapshot and the applicable SOURCE_LINKED source revision/WHT hash or LEGACY_ARTIFACT authority evidence. Shared-registry replay occurs before the active-certificate lock/CAS; a new command atomically creates one nonterminal case plus its first revision, which references that same command. Existing nonterminal work returns as one prefilled case; stale/key-reused requests create nothing.

POST /wht/correction-cases/:caseId/revisions
- Authorize each branch independently: certificate-only branch uses source visibility or exact retained-artifact authority + `wht.certificate.correct`; in-product return/refund branch uses `tax.adjustment.create|approve`/filing permissions as applicable. `tax.adjustment.approve` is a new v5.1 expand-phase permission and the endpoint stays disabled until its registry/grants exist.
- Requires caller-stable command id/fingerprint, expected active certificate id/revision, expected statutory-content/artifact hashes and stable pay-in-slip reconciliation. SOURCE_LINKED also requires expected source-payment revision/WHT hash; financial/payee/form changes require the audited source correction and lock old+proposed identities. Reviewed LEGACY_ARTIFACT uses exact retained-authority evidence and artifact CAS only, never a fabricated payment/payee identity. Same-command replay is idempotent; stale/reused commands allocate/register nothing. Only OPEN `cap.wht50bis/SYSTEM_CONTENT_CORRECTION` may generate the corrected SYSTEM number/PDF; otherwise the same flow accepts one corrected EXTERNAL artifact.

GET /wht/correction-cases/:caseId/revisions/:revisionId/packet
- Permission: exact company/branch/case visibility plus `tax.report.read`; no certificate-only permission grants return-filing data.
- Returns the immutable prepared attachment and `correctionPacketHash` for that exact revision. It never regenerates the packet, changes approval or requires an export package; a superseded revision remains readable as history but is clearly non-actionable.

GET /wht/correction-cases/:caseId/authority-outcomes
POST /wht/correction-cases/:caseId/revisions/:revisionId/authority-outcomes
- Permission: exact company/branch/case visibility plus the applicable filing/correction permission. Read returns the ordered append-only lifecycle in plain business states.
- POST requires caller-stable command id/fingerprint, exact current revision/packet hash, expected predecessor outcome id, status-effective time, authority reference when issued, durable evidence ref/hash, and the revision's route-policy ref/version/hash/terminal-status hash. Same-command replay returns first; stale predecessor, wrong packet/policy/evidence or a status not allowed by that route appends nothing. The server derives `terminalEffect`; clients cannot choose it. A submission/receipt status never closes the case, and a successful terminal outcome never completes an independent refund/certificate branch.

POST /wht/correction-cases/:caseId/assign-accountant
GET /wht/correction-cases/:caseId/revisions/:revisionId/controlled-packet-download
- Assignment reuses the F0-surveyed `WorkflowTask`/`WorkCardUserState` command for the deterministic business issue; it creates no tax-owned handoff row. It requires exact case visibility, an invited ACTIVE company member/ACCOUNTANT assignee with current branch/domain permission, exact revision/packet hash and caller-stable command/fingerprint. Inviting a new member uses the existing `admin.user.invite` flow and resumes the same card after acceptance.
- Download requires an authenticated ACTIVE member currently permitted for the company/branch/case and exact revision/packet hash; when reached from assigned work, the existing task assignment must also match. It returns a short-lived controlled response and audits principal, request id, time and packet hash. There is no anonymous URL, and assignment/download changes no filing or authority status.

GET /cit/calendar
- Permission: tax.period.read.
- Returns CIT50/CIT51 obligations by accounting period.

GET /cit/periods/:periodId/supporting-summary
- Permission: tax.report.read and ledger.report.read when ledger refs are included.
- Returns ledger-backed supporting summary and review issues.

POST /reports/:periodId/scopes/:filingScopeId/review
- Permission: tax.review_issue.resolve.
- Marks the exact scope/revision snapshot reviewed if blocking review issues are resolved.

POST /reports/:periodId/scopes/:filingScopeId/export
- Permission: tax.report.export.
- Creates scope/revision-keyed filing package metadata and generated review JSON, CSV, XLSX, and PDF files for first-demo supported reports. Audited.

POST /filings/:periodId/scopes/:filingScopeId/mark-filed
- Permission: tax.filing.mark_filed.
- Under `thai_tax`, manually records immutable `RECORDED_EXTERNAL` filed evidence, reference, note and approver for the exact scope/revision, labeled “ระบบไม่ได้ยื่นหรือยืนยันการรับแบบ”. This manual-first route remains available regardless of automation state. For a correction filing, the request must also carry `correctionCaseId`, `correctionRevisionId`, `correctionPacketHash` and the expected current correction revision; the server revalidates the applicable approved route/channel decision and rejects a stale/superseded packet before appending the submission record. That exact record derives the case's `externalReturnAcknowledgementRef` and atomically appends/replays its initial `WhtCorrectionAuthorityOutcome(status=SUBMISSION_RECORDED,terminalEffect=NONE)` under the same packet/policy hashes. It may derive filing-scope FILED but leaves the correction return branch pending. Ordinary filings omit all correction fields. `RD_ACCEPTED_VERIFIED` requires a verified RD/provider response obtained under the exact OPEN `cap.thai_tax.external_filing_correction/<formType:correctionRoute:channelVersion>` row; an OPEN row or human-entered reference alone is never sufficient, and its correction case advances only through the matching authority outcome policy. Audited.

POST /filings/:periodId/scopes/:filingScopeId/mark-paid
- Permission: tax.filing.mark_paid.
- Form-dispatched compatibility route. For PP30 it resolves the stable payable root's current scope/revision/settlement head and records a command-idempotent full/partial `VatFilingPaymentOutcome` under expected-position CAS; a superseded settlement target rejects. For PP36/PND3/53 it creates/updates the stable payment root/status head. Tax truth may commit before cash matching, so missing cash evidence becomes one prefilled reconciliation state and an optional already-selected match can be linked by the separate resumable command without re-entry. PP30 status derives from remaining principal and a reversal must identify the prior PAYMENT plus its remaining reversible amount. PP36/PND generates no PP30-aggregate/semantic-role projection. Neither path claims system submission/RD verification or folds surcharge into principal. Audited.

POST /cash-evidence-links
- Links a complete BankReconciliationMatch/payment-journal allocation set to one already-created immutable refund/payment target; it never creates or edits tax truth.
- Bank-origin orchestration requires `bank.match.confirm` plus company/branch-safe target visibility; payment-journal/manual reconciliation uses the applicable filing/finance permission. Exact retained targets remain linkable after a feature is disabled, but no unrelated tax record becomes visible.
- Requires command id/fingerprint, target type/id/hash, expected active evidence head, allocation refs/versions and canonical target cash amount. Same-command replay returns the full evidence head; stale/reused/overallocated evidence changes nothing. On success it makes the existing projection READY or preserves it PENDING for Ledger-off. Audited.

GET /vat/scope-transitions/:transitionId
- Permission: `tax.report.read` plus exact company/branch/scope visibility.
- Returns the active immutable preparation revision, already stored matrix/evidence, friendly missing-evidence state and terminal result when present. It never exposes route/gate/generation controls.

POST /vat/scope-transitions/:transitionId/preparations
- Permission: `tax.review_issue.resolve`; Finance may prepare.
- Requires caller-stable command/fingerprint, expected work-item version, current origin/successor position versions and only genuinely new evidence. It appends one immutable preparation revision, carries forward every still-valid prepared fact, atomically advances `externalHandlingHighWaterMark` when applicable and returns its matrix/evidence hashes. `externalHandlingStatus` may stay equal or advance only `NOT_STARTED → IN_PROGRESS → COMPLETED`; a lower successor value or stale input changes nothing.

POST /vat/scope-transitions/:transitionId/finalize
- Permission: `tax.review_issue.resolve` plus `tax.adjustment.approve`; only OWNER/ACCOUNTANT may commit the final CAS.
- Requires the exact active preparation revision/hash and expected work-item/origin/successor versions. The server applies the deterministic rule above: both external-handling values `NOT_STARTED` plus the exact `cap.thai_tax.vat_scope_credit_transfer/<transitionKind>` row passing its final generation guard and all invariants/CAS creates the APPLIED internal transfer; both values `COMPLETED` plus valid external evidence creates `RECORDED_EXTERNAL`. `IN_PROGRESS`, mismatched values, missing evidence, a stale/closed route or failed CAS changes nothing and returns the same prepared card with only the unfinished action. The two result kinds are mutually exclusive and atomically seed successors once; an external result never claims system filing/RD acceptance.

POST /vat/refund-outcomes/:outcomeId/corrections
POST /vat/scope-transition-external-outcomes/:outcomeId/corrections
- Permission is state-dependent and mutually exclusive:
  - while `thai_tax` is ON, require `tax.adjustment.create` plus `tax.adjustment.approve` for final application;
  - after `thai_tax` is OFF, require `vat.credit_outcome.correct` plus the exact retained pre-disable outcome/root hash and cutoff authority. This branch is correction-only: it cannot create a new Tax root, report, filing, contribution or unrelated replacement lineage.
- Requires command/fingerprint, the current effective ORIGINAL-or-REPLACEMENT leaf and its exact complete-child artifact hashes/lineage, origin allocation identities, every affected current successor position/allocation version, RD successor/evidence and optional full replacement. It atomically appends the one full-provable REVERSAL plus optional REPLACEMENT, next position snapshots and linked Ledger correction; partial residual reversal is forbidden. Only a durable-evidence-backed economic cash reversal is a new opposite-direction target, while a classification-only reversal has `cashEffect=NONE`; wrong/stale/nonleaf/not-fully-provable input returns one prefilled review and mutates nothing.

GET /review-issues
- Permission: tax.report.read.
- Lists tax review issues by period, source, severity, and status.

POST /review-issues/:issueId/resolve
- Permission: tax.review_issue.resolve.
- Resolves issue with note. Audited.

POST /adjustments
- Permission: tax.adjustment.create.
- Creates a draft tax adjustment for an explicit filing scope/revision when the adjustment is scope-sensitive. Cannot bypass filed/closed policy.

POST /adjustments/:adjustmentId/approve
- Permission: tax.adjustment.approve.
- New v5.1 expand-phase key; route remains unavailable until permission-registry/default-grant migration is deployed. Approves adjustment and applies it to report snapshot/resync path. Audited.
```

Legacy period-only report/filing routes may remain as compatibility aliases only when the period has exactly one active scope; otherwise they return `409 filing_scope_required`. First-party UI resolves and sends the scope automatically, so the user does not choose technical IDs.

Error cases:

```text
400 invalid config, invalid totals, missing source facts, unsupported form, invalid date range
401 unauthenticated
403 missing permission, branch not allowed, ledger permission missing, source not visible
404 not found or hidden by tenant/ABAC policy
409 affected filing scope/revision filed/closed, duplicate idempotency key, stale source/position checksum, unresolved blocking review issue
422 unverified tax config, export format not configured, missing accountant/RD confirmation
```

## 13. Permission Keys

Use these keys and keep [[specs/permission-matrix|Permission Matrix]] aligned:

```text
tax.profile.read
tax.profile.manage
tax.config.read
tax.config.manage
tax.period.read
tax.period.manage
tax.event.read
tax.event.sync
tax.report.read
tax.report.recompute
tax.report.export
tax.filing.mark_filed
tax.filing.mark_paid
tax.adjustment.create
tax.adjustment.approve (new v5.1 expand-phase key; fail closed until seeded)
tax.certificate.read
tax.review_issue.read
tax.review_issue.resolve
wht.certificate.prepare (shared source-lifecycle missing-fact review)
wht.certificate.read (shared source/global-hub handoff, certificate and retained-action discovery)
wht.certificate.correct (shared certificate-only correction/cancellation/ใบแทน)
wht.external_certificate.link (shared source-lifecycle action; never mapped to `thai_tax`)
company.vat_registration.read
company.vat_registration.manage
finance.vat.review
vat.credit_outcome.correct (exact retained pre-disable outcome correction only; never mapped to `thai_tax`)
tax.certificate.issue (deprecated compatibility alias only; never initial issue or source-visible correction authority)
tax.certificate.void (deprecated compatibility alias only; never direct mutation)
```

Default grants apply to Tax workspace review/correction actions. They do not gate the source-owned qualifying SETTLED transition. Its document-scoped SYSTEM outbox additionally requires source authorization, tenant/branch scope, CC1's exact availability vector and OPEN `cap.wht50bis/SYSTEM_INITIAL_ISSUE`; otherwise the same transition creates the EXTERNAL handoff.

`wht.certificate.read|prepare|correct` and `wht.external_certificate.link` are granted through the applicable supplier/expense payment role policy to Finance/Accountant operators with source visibility or server-derived exact retained authority. Entitlement filtering follows the owning source feature or the exact retained pre-disable legal artifact, not `thai_tax`. `company.vat_registration.*` is baseline Company Settings/finance authority; `finance.vat.review` follows source/Ledger visibility and never grants Tax report contribution. `vat.credit_outcome.correct` is a separate entitlement-free HIGH-risk permission for OWNER/ACCOUNTANT only; ABAC requires the exact retained pre-disable outcome/root hash plus cutoff and rejects new Tax work.

Default grants after the v5.1 additive permission migration:

```text
OWNER: all tax permissions plus company.vat_registration.read/manage, finance.vat.review, wht.certificate.read/prepare/correct, wht.external_certificate.link, vat.credit_outcome.correct
ADMIN: no Tax-workspace permissions by default; company.vat_registration.read/manage follows Company Settings role policy
FINANCE: tax.profile.read, tax.config.read, tax.period.read, tax.event.read/sync, tax.report.read/recompute/export, tax.filing.mark_filed/mark_paid, tax.adjustment.create, tax.certificate.read, tax.review_issue.read/resolve, company.vat_registration.read, finance.vat.review, wht.certificate.read/prepare/correct, wht.external_certificate.link when source-visible or exact retained authority applies; no vat.credit_outcome.correct
ACCOUNTANT: all tax permissions plus company.vat_registration.read/manage, finance.vat.review, wht.certificate.read/prepare/correct, wht.external_certificate.link when current source visibility or exact retained authority applies, vat.credit_outcome.correct for exact retained roots
AUDITOR_READONLY: tax.profile.read, tax.config.read, tax.period.read, tax.event.read, tax.report.read/export, tax.certificate.read, tax.review_issue.read
MANAGER: tax.profile.read, tax.config.read, tax.period.read, summary tax.report.read, tax.certificate.read, tax.review_issue.read only where ABAC allows
SALES, INVENTORY, MARKETING, STAFF: no tax permissions by default
```

Tax obligation/reminder queries use `tax.period.read`; delivery through Dashboard/notifications separately requires `notification.read` and the `dashboard_notifications` entitlement plus the Tax trigger. There is no `tax.reminder.read` permission.

Sensitive permissions:

```text
tax.config.manage
tax.period.manage
tax.report.export
tax.filing.mark_filed
tax.filing.mark_paid
tax.adjustment.create
tax.adjustment.approve
company.vat_registration.manage
finance.vat.review
vat.credit_outcome.correct
wht.certificate.prepare
wht.certificate.read
wht.certificate.correct
wht.external_certificate.link
```

## 14. UI Behavior

### Web

Web Tax owns interactive return preparation, review, filing and return/refund correction. The source payment/global work hub owns initial 50 ทวิ, missing-fact review and certificate-only correction/cancellation/`ใบแทน`, including with Tax off.

The permission-filtered global surface is named **งานที่ต้องทำให้จบ**. Its Finance section is **งานบัญชีและภาษีที่ต้องดำเนินการ** and may also be reached from the affected payment, filing or VAT scope. One business issue renders as one deduplicated card, never separate cards for the source page and fallback. The card shows: what happened, facts/evidence already prepared, one primary next action, consequence of waiting, current status/history and only genuinely missing input. It never exposes route keys, gates, generations, CAS or projection terminology and never links to a feature the operator cannot open.

Required views:

- Tax dashboard: upcoming obligations, overdue periods, VAT payable/refund summary, WHT pending summary, CIT calendar, blocking review issues.
- VAT ภ.พ.30 report: period selector, output VAT tab, input VAT tab, excluded/review-needed tab, source refs, recompute, review, export.
- Input-VAT review card: show “ใช้ในเดือนปัจจุบันได้ถึง …” only while `CURRENT_PERIOD_DELAYED` remains valid and show the missing necessary-cause/annotation item. After that, replace the primary action with “ให้นักบัญชีตรวจการแก้ไขเดือนเดิม”; never offer current-month claim or automatic write-off. For an employee-name document, the single primary action is “ขอใบกำกับภาษีฉบับแก้ไขเป็นชื่อบริษัท”; explicit nonrecoverable confirmation is secondary, high-risk and accountant/Finance-only.
- WHT ภ.ง.ด.3/53 report: form tabs, payee grouping, income category/rate, source payments, certificate refs, review issues, export.
- 50 ทวิ certificate list/detail, delivery status, prefilled exception and immutable correction/supersession flow. Initial issue is shown from the settled payment and does not ask users to select TaxEvents or re-enter payment/payee/WHT data.
- CIT calendar/supporting summary: accounting period, due dates, ledger P&L refs, plain data freshness/change state, review issues and disclaimer; raw source checksum is available only in authorized auditor detail.
- Tax config: company tax profile, tax year config, rate/category rows, calendar rules, source links, verification checklist.
- Filing status: export packages, immutable submission/payment history, scope/revision, actual submitted/paid/status-effective time, external reference/evidence and truthful MANUAL/SYSTEM/LEGACY origin. Known facts are prefilled; a user supplies only genuinely missing evidence, never a status-only note. Payment cards separate principal, surcharge estimate with “ประมาณการถึงวันที่ …”, evidenced penalty and final RD amount/reference.
- Nonzero VAT scope transition: one card shows the immutable current preparation revision, conserved matrix, uploaded evidence and friendly missing items. Finance saves preparation once; OWNER/ACCOUNTANT sees the same snapshot and one final approval. The result is shown in business language only, never as an internal/external route choice, and no route change clears entered evidence.
- Filed/external WHT correction: show the immutable before/after comparison, plain-language route, generated packet/checklist and one approval action. The next action is “ดาวน์โหลดชุดแก้ไขและยื่นภายนอก” or “ส่งให้นักบัญชี” through an invited assignment; after filing, “บันทึกเลขรับ/หลักฐาน” appends `RECORDED_EXTERNAL` and shows “ส่งแล้ว—รอผลจากสรรพากร”, not “แก้ไขเสร็จแล้ว”. A simple timeline maps authority outcomes to “ส่งแล้ว”, “ได้รับเลขรับ”, “อยู่ระหว่างตรวจ”, “ต้องส่งเอกสารเพิ่ม”, “แก้ไขในระบบกรมแล้ว” or “ไม่อนุมัติ—ต้องตรวจต่อ”; technical status/policy/hash stays in auditor detail. For negative additional PND3/53, show that the current RD Prep route was verified on the rule snapshot date but that refund/ค.10 rights remain a separate review. Never claim that WatchDog filed or that RD accepted unless verified evidence exists.
- Review issue queue: missing tax id, missing branch, missing tax invoice, unknown VAT mode, WHT mismatch, unverified config, stale source checksum, closed-period conflict.

Design/UX rules:

- Keep screens dense, finance-friendly, and consistent with web workspace patterns.
- Do not use marketing/landing-page layout for tax workspace.
- Before export/filing, ordinary users see plain data state: “ข้อมูลล่าสุดเมื่อ …”, “ไม่มีรายการเปลี่ยนหลังตรวจ” or “ข้อมูลเปลี่ยนหลังตรวจ—กรุณาตรวจอีกครั้ง”. The raw source/report checksum, algorithm, component hashes and comparison ids live under permission-filtered “รายละเอียดสำหรับผู้ตรวจสอบ”; they are never the main freshness message.
- Confirm high-risk actions: export, mark filed, mark paid, approve adjustment, certificate correction/cancellation classification, and config activation. Do not add a second confirmation to the automatic qualifying initial issue.
- Display unverified config warnings clearly.
- Source refs deep-link to accounting documents, expenses, payments, ledger reports, and period close screens when routes exist.
- Forbidden/readonly states must not leak hidden record counts.

### LINE

LINE may show:

- Upcoming/overdue tax reminders.
- VAT payable/refund summary.
- WHT pending summary.
- CIT calendar reminders.
- Missing tax document count/summary when permission allows.
- Web deep links for full preparation.

LINE must not:

- Recompute reports.
- Export or download tax packages.
- Mark filed/paid.
- Change tax config.
- Issue/void certificates.
- Create/approve adjustments.
- Submit filings.

## 15. AI Tax Read Tools

Add read-only tools after tax APIs exist:

```text
tax.get_upcoming_tax_obligations
tax.get_vat_summary
tax.get_wht_summary
tax.get_cit_calendar
tax.list_missing_tax_documents
```

Tool behavior:

- ERP Core re-checks permission and ABAC on every call.
- AI Gateway allowlists tools by permission and agent policy.
- Tool results include source refs, report status, verification status, source checksum, and web links.
- Tool results include `permissionChecked: true` where current AI source-ref contract supports it.
- AI Tax states when config is unverified, data is incomplete, ledger summary is missing, or accountant/RD confirmation is required.
- AI Tax refuses mutation, export, filing, config, certificate, adjustment, payment, ledger posting, and permission requests.
- Sensitive tax AI tool invocations are audited.

## 16. Outbox Events and Audit Actions

Outbox event names should use stable lowercase dot keys:

```text
tax.period.created
tax.period.synced
tax.period.ready_for_review
tax.report.reviewed
tax.report.export_generated
tax.filing.marked_filed
tax.filing.marked_paid
tax.review_issue.created
tax.review_issue.resolved
tax.certificate.issued
tax.certificate.superseded
tax.certificate.cancellation_reviewed
tax.wht_correction.revision_created
tax.wht_correction.completed
tax.adjustment.created
tax.adjustment.approved
tax.config.updated
tax.reminder.due_soon
tax.reminder.overdue
```

Audit actions:

```text
tax.config.create
tax.config.update
tax.config.activate
tax.period.sync
tax.report.recompute
tax.report.review
tax.report.export
tax.filing.mark_filed
tax.filing.mark_paid
tax.review_issue.resolve
tax.certificate.issue_from_payment
tax.certificate.correct
tax.certificate.classify_cancellation
tax.wht_correction.approve
tax.adjustment.create
tax.adjustment.approve
tax.ai_tool.invoke
```

Audit metadata must include ids, period key, form type, source checksum, amount summary, actor, request id, reason/note where required, and result. Redact raw report payloads, attachments, OCR text, secrets, and unrestricted PII.

## 17. Edge Cases

- Tax config is unverified: allow draft sync/report preview, block final export/filing status if policy requires verification.
- VAT rate config missing: create blocking review issue, do not infer a rate.
- Source document tax id missing: create review issue and keep source line visible for review.
- WHT paid date missing: create blocking review issue because period assignment depends on payment date.
- Expense input VAT not claimable: exclude from input VAT totals and show reason.
- Issued tax invoice voided before filing: supersede/reverse tax event according to source correction status.
- Issued tax invoice voided after filing: require adjustment/amended workflow.
- Source updated after report review but before export: mark snapshot stale by checksum.
- Source updated after filing: block silent mutation and require correction/amended period flow.
- Ledger P&L missing for CIT: show missing ledger review issue, not zero profit.
- User has tax report permission but lacks ledger report permission: hide ledger detail and show permission-safe missing source ref.
- Branch filing policy changes mid-year: rebuild only an unreviewed draft partition. Reviewed/filed scope identity is immutable; zero-credit transition may proceed automatically. Nonzero credit remains one prefilled review and either records a matrix-hashed conserved external outcome under origin+successor CAS while internal transfer is gated or, after specialist validation, applies exact origin-consumption/equal-sum destination legs; no split/delta is inferred.
- VAT refund request rejected/withdrawn: record the evidence and open one prefilled disposition review; do not restore credit until continued carry right is proven, and do not silently retain a disallowed/expired 1156 balance.
- Export infrastructure missing: implement a minimal tax export writer behind the export port for review JSON, CSV, XLSX, and PDF; do not fake file generation.
- AI question asks "file tax now": refuse and link to web tax workspace if permission allows.

## 18. Acceptance Criteria

- [ ] VAT report is generated from source tax events with output/input separation.
- [ ] Input-VAT timing stores separate `ordinaryDelayedClaimLastTaxMonth` and `outerReviewDate`. Through the ordinary window a necessary-cause/annotation-complete item may use `CURRENT_PERIOD_DELAYED`; afterward it becomes one prefilled `ORIGINAL_PERIOD_AMENDMENT_REVIEW`, never a current claim or automatic write-off. `NONRECOVERABLE_CONFIRMED` requires explicit reviewed confirmation. Employee-name documents stay unresolved with corrected-company-invoice request as the primary action and no re-entry of known data.
- [ ] PP36 report is generated from configured source tax events where applicable.
- [ ] WHT report is generated from payment/expense WHT events and grouped by PND3/PND53.
- [ ] A qualifying positive-WHT SETTLED payment with exact-sum lines and complete/unambiguous effective-template statutory identity/form facts creates one payment/payee-owned path without a Tax-workspace command, including when `thai_tax` is off: exact OPEN `SYSTEM_INITIAL_ISSUE` issues the multi-line SYSTEM 50 ทวิ with immutable PDF/hash, while CLOSED/missing creates one `EXTERNAL_CERTIFICATE_REQUIRED` and no system number/PDF. Zero/no-WHT and missing/invalid/ambiguous WHT facts create neither path and reserve nothing.
- [ ] Certificate content correction, return correction, true no-withholding cancellation and `ใบแทน` take their distinct immutable routes; direct void/overwrite is impossible, every action has append-only command history, and `ใบแทน` retains identity/number/statutory content in a separate copy artifact.
- [ ] Calendar TaxPeriod and canonical filing scopes are separate: each active scope owns independent review/file/pay/close state, eligible events form one disjoint frozen partition per revision, and report/filing/settlement identities cannot cross scope.
- [ ] PP30 VAT credit use/refund is regime+scope+currency locked through versioned aggregate/allocation snapshots; opening/transition reservations remain addressable, a raw refund rejection/withdrawal moves nothing and only an evidenced cash receipt, non-cash offset, continued carry right, disallowance or expiry changes the exact position/1156 treatment. Same-scope PP36/PND records cannot collide. A nonzero consolidated↔branch/group transition uses either one-command exact origin-consumption/equal-sum destination legs with cross-transfer uniqueness or a matrix-hashed external outcome under origin+successor CAS, and cannot double-use or silently discard credit.
- [ ] VAT-registration PUT is company-command-idempotent: exact replay returns the stored fact/no-op before state CAS, key reuse rejects and concurrent first-fact/stale expected versions append nothing.
- [ ] CIT calendar and supporting summary use company accounting period and ledger-backed P&L where available.
- [ ] Tax calendar/rate/rule config is data-driven with source and verification metadata.
- [ ] Web shows detailed VAT/WHT/PP36/CIT preparation views, review issues, export packages, and filing status.
- [ ] Review JSON, CSV, XLSX, and PDF exports are generated for first-demo supported reports.
- [ ] LINE shows reminders and summaries only.
- [ ] AI Tax cannot file, export, configure, issue certificates, create adjustments, or alter tax records directly.
- [ ] The affected filed/closed canonical filing scope/revision rejects silent source tax event mutation without blocking another scope in the same TaxPeriod.
- [ ] Export generation and filing/payment status changes are audited with actor/note/evidence; append-only submission heads preserve submitted/status-effective/recorded times, legacy FILED/PAID facts backfill without re-entry or false verification, and PP36/PND payment evidence stays outside PP30 aggregates/semantic roles.
- [ ] Ledger period close blocks unresolved effective-period Ledger-owned VAT projections when Ledger is enabled; `VatClaimTaxProjection=PENDING` because Tax is off does not block, Tax-only filing remains independent, and enable-later closed history uses a current-open correction.
- [ ] The three WHT SYSTEM routes open, close and increment generation independently. Closing one route preserves its EXTERNAL fallback and cannot authorize/block either sibling; reopening never processes an old task without explicit Issue/Reissue.
- [ ] Every SYSTEM WHT PDF/copy stores a reproducible render manifest/hash that pins template/rule source, renderer/font bundle, statutory-content hash and signature snapshot as applicable; a route cannot open until golden fixtures reproduce that manifest.
- [ ] The `ใบแทน` golden fixture verifies the visible Thai label at its approved position, retained counterpart/copy identity, identical statutory content/hash and complete certification actor/time/signature rendering; any mismatch keeps SYSTEM replacement closed and uses the prefilled EXTERNAL handoff.
- [ ] Filed/external WHT correction is manual-first: immutable diff → classified exact route → versioned eligibility/local-channel checklist and packet manifest → one stable-revision approval → external filing → evidence/reference → `RECORDED_EXTERNAL`. Unsupported/closed automation never asks for re-entry or claims RD acceptance. ป.ป.01/ป.ป.02 eligibility is allowlisted from the pinned form; local office/channel requirements are separately versioned.
- [ ] WHT correction authority history is append-only and command-idempotent. Submission/receipt never closes the case; only an evidence-backed status in that revision's exact terminal policy with `COMPLETE_RETURN_BRANCH` may complete its return branch, while rejection/withdrawal reopens review and refund/certificate branches remain independent.
- [ ] Accountant handoff reuses an ACTIVE invited `CompanyMembership` and the existing case/revision-scoped WorkflowTask/WorkCard assignment; no tax-owned handoff record is added. Controlled packet download is audited, there is no anonymous share link, and invite/assign/download/return never changes filed/accepted status.
- [ ] Payment UI separates principal, surcharge estimate-as-of, evidenced penalty and final RD amount/reference; an unknown penalty is not shown as zero and estimates never become payment truth.
- [ ] Ordinary users receive plain freshness/change messages; checksum details remain available to authorized auditors without being required to understand the workflow.
- [ ] Zero-credit scope transition is automatic. Nonzero is external-first and conservation-checked through one stable work item with immutable preparation revisions; final approval produces exactly one INTERNAL or EXTERNAL ORIGINAL result. A future exact internal transition row may open independently only before external handling starts and never changes/replays a prior result.
- [ ] `[LATER] cap.thai_tax.vat_credit_in_product_offset` has no OPEN mutation in v5.1. A candidate preserves all facts in one card and mutates neither credit nor payable.
- [ ] Master Implementation Checklist item 11 remains unchecked until implementation and verification pass.

## 19. Test Cases

Domain/unit:

- VAT totals use decimal-safe calculation.
- Input-VAT boundary tests cover invoice month, ordinary last delayed-claim month and the next day/month: valid cause+annotation selects `CURRENT_PERIOD_DELAYED` only through the ordinary window; afterward the same stored invoice/evidence becomes `ORIGINAL_PERIOD_AMENDMENT_REVIEW` without current TaxEvent or nonrecoverable write-off. Missing rule/cause/annotation never auto-confirms nonrecoverability. Employee-name document tests retain `EXTERNAL_OR_UNRESOLVED` until corrected company invoice or explicit reviewed nonrecoverable confirmation.
- WHT grouping by form type, payee, income category, rate, and payment period is correct.
- Due-date rule evaluator uses config rows, not hard-coded dates.
- Tax event idempotency returns existing/superseded behavior correctly.
- Filed scope/revision blocks its event mutation while another scope in the same period remains independently mutable.
- Source checksum detects stale reviewed snapshot.

API/integration:

- Missing auth returns `401`.
- Missing tax permission returns `403`.
- Cross-company source id does not leak.
- Report export requires `tax.report.export`.
- Tax config activation requires `tax.config.manage`.
- Mark filed/paid requires dedicated filing permissions, exact scope/revision, caller-stable command, truthful origin, actual known times/reference/evidence, expected head/position and actor/note; the UI prefills stored facts and never offers a status-only form.
- VAT report total equals output VAT minus eligible input VAT.
- PP36 report uses configured source events and creates blocking issues for missing config/source facts.
- PP36/PND mark-paid appends one full scope/revision payment head with actual time/evidence/actor; MANUAL cannot claim RD acceptance, exact full reversal is unique, stale/reused targets do not overwrite it, and no PP30 aggregate/semantic role is used. A separately validated PP36 role may intentionally map to physical code 2137 without sharing PP30 provenance.
- Submission head stores submitted/status-effective/recorded times separately; allowed transitions derive scope state, a rejection needs a linked successor, and verified acceptance cannot be manually downgraded. Legacy FILED/PAID cases with/without package/timestamps and ambiguous scopes become deploy-owned compatibility markers plus at most one prefilled review, never fabricated normal filing/payment or Ledger clearing.
- Raw VAT refund rejection/withdrawal leaves available/reserved balances unchanged; evidenced receipt, proven `EXTERNAL_UNMODELED` non-cash offset, return-to-available, disallowance and expiry each apply one exact settlement/opening/transition reservation with the expected 1156 effect. A matching in-product payable creates one prefilled task and mutates neither side; `[LATER] cap.thai_tax.vat_credit_in_product_offset` remains CLOSED and has no OPEN acceptance path in v5.1. An external transition rejects any reviewed JSON/hash versus complete canonical child-set mismatch.
- PP30 payment reversal identifies one exact prior PAYMENT, rejects an excess/duplicate reversal, derives cash status from the append-only evidence head, and unresolved bank/cash Ledger mapping leaves Tax paid evidence intact while one Ledger review remains. Corrected-lower payable → reversal atomically credits the descendant 2137 portion plus exact correction-created 1156 excess portion; correction/reversal and cash-evidence races cannot consume either twice.
- The same confirmed bank statement allocation cannot support two PP30 payments, PP36/PND payments or VAT refund receipts; partial line allocations use expected remaining/version CAS and resolve one bank account/currency/direction. Tax+Bank with Ledger off may activate evidence with a null Ledger account and later resolve it without cash re-selection. PAYMENT_REVERSAL consumes separate deposit evidence; artifact supersession transfers still-true evidence without freeing the match, while only explicit corrected-evidence unlink may free it after projection correction.
- Ledger close fails on an effective-period `PENDING|READY|NEEDS_REVIEW` Ledger-owned VAT source/opening/settlement/external-scope-transition/refund/payment projection, succeeds only after `POSTED|SATISFIED`, ignores a Tax projection pending solely because Tax is off, does not affect Tax-only companies, and routes already-closed enable-later history to a current-open correction.
- A qualifying SETTLED payment with exact-sum positive WHT lines creates one SYSTEM certificate only under exact OPEN `SYSTEM_INITIAL_ISSUE`; CLOSED/missing creates one `EXTERNAL_CERTIFICATE_REQUIRED` with no system number/PDF. Same-command retry returns the same path, arbitrary selected TaxEvent IDs cannot create another, and zero/invalid WHT creates neither path or number.
- Multi-line/partial-payment certificate totals equal the immutable payment revision/WHT hash; original-copy PDF/hash/delivery evidence, append-only command history and nullable TaxPeriod/TaxEvent provenance remain linked.
- Shared company-global WHT command registration makes certificate actions, case creation and later revisions cross-family idempotent; case creation exposes an API, creates its first revision atomically and concurrent operators converge on one nonterminal case.
- Two correction commands race safely: same-key reuse rejects, stale expected active/revision/source snapshot or retained-artifact hash allocates nothing, and the winner atomically supersedes old PDF/hash with a new-number artifact plus notice. At most one ORIGINAL exists per certificate and it is required for a newly issued/linked or durably evidenced artifact; `LEGACY_UNRESOLVED` without durable PDF/hash evidence receives no fabricated ORIGINAL. Concurrent `ใบแทน` retries instead create/return one separate copy artifact with unchanged identity/number/statutory-content hash. Only the exact applicable OPEN WHT route renders SYSTEM; a CLOSED/missing route uses its own prefilled EXTERNAL flow. A stale route generation after close/reopen allocates nothing, while explicit current work pins a fresh decision on command, artifact, manifest and outbox. An unlinked legacy certificate can be discovered/read/corrected/copied through exact retained artifact authority without `thai_tax`, invented payment/payee identity or statutory-data re-entry.
- Every SYSTEM WHT test asserts the identical complete `availabilityDecisionRef + systemRouteKey + routeGeneration` tuple on the command, artifact, canonical render manifest and outbox result; no surface may contain only a generation or a different sibling route decision.
- WHT route-isolation tests open only one of `SYSTEM_INITIAL_ISSUE`, `SYSTEM_CONTENT_CORRECTION`, `SYSTEM_REPLACEMENT_COPY` at a time and prove the other two remain on their own EXTERNAL fallbacks. SYSTEM fixture tests reproduce the stored render-manifest hash and certification legal-actor snapshot/hash; an authorized external signer needs no fabricated system-user identity, while `certifiedByUserId` remains an optional recorder/link.
- `ใบแทน` golden-fixture tests fail independently for a missing/moved/overlapping Thai label, wrong counterpart/copy identity, changed statutory field/hash, omitted certification statement/actor/time and clipped/mismatched signature; a passing fixture reproduces the exact manifest/document hashes.
- PND3/PND53 filed-correction tests cover data-only, wrong-form, positive additional, verified-channel `ADDITIONAL_NEGATIVE`, refund-review fallback, late-slip invalidation and manual `RECORDED_EXTERNAL`. ป.ป.01 rejects any amount/tax/remittance delta or field outside its versioned allowlist; ป.ป.02 rejects a change outside its pinned form scope. Packet GET returns the immutable attachment/hash and versioned eligibility/local-office checklist/manifest for the exact case/revision; wrong-case, superseded-revision, packet-hash mismatch, stale local-channel policy or a decision whose `validationDecision!=VERIFIED`, `sourceStatus!=ACTIVE`, evidence/reviewer/date is missing or validity has expired changes nothing. An unknown `(formType,correctionRoute,channelVersion)` reuses the same prepared packet without a system acceptance claim.
- Authority-outcome tests append submission → receipt → pending review → more-information → verified route terminal under same-command-first/predecessor CAS. Submission/receipt/approval-only cannot close; a terminal status absent from the immutable policy rejects; rejection/withdrawal returns review; wrong case/revision/packet/policy/evidence hash and concurrent stale predecessors append nothing. E-Filing negative acceptance completes only its filing branch and never proves payment, refund or ค.10.
- Accountant-handoff tests prove no tax handoff row is created, deny anonymous/unaccepted/expired/revoked/cross-company downloads, audit a valid ACTIVE-member/shared-task scoped download and prove invite/assign/download/return changes neither submission nor authority outcome.
- Charge-presentation tests keep principal, estimate-as-of surcharge, evidenced penalty and final RD amount distinct; refreshing an estimate changes no payment root and unknown penalty serializes as unknown, not zero.
- Return-only errors do not reissue; draft/submitted-unpaid/filed/external routes and refund branch reach only their defined terminal outcomes before case completion.
- Scope normalization covers legacy head-office/all/selected and new per-branch values; active memberships are disjoint and every eligible contribution is assigned exactly once.
- Branch A can be FILED while branch B remains OPEN; period-only compatibility status cannot authorize either mutation.
- Overlapping selected groups, branch movement and consolidated→per-branch changes cannot double-include events; nonzero credit transition requires either matrix-hashed origin+successor-CAS external reconciliation or gated exact-origin/equal-sum-destination internal allocation, and zero-credit transition is automatic.
- Nonzero scope-transition tests default to external reconciliation even when another transition kind is OPEN; only the exact named transition row may apply internally instead of external and only before external handling starts. Finance's immutable preparation is readable unchanged by OWNER/ACCOUNTANT, while final work-item/position CAS requires `tax.adjustment.approve`. Concurrent internal/external finalizers produce one terminal result, and reopen never converts it. The UI never asks the user to choose internal/external or re-enter the matrix/evidence. The deferred PP30 in-product offset has no model/API mutation test in v5.1 and leaves both current heads unchanged.
- CIT supporting summary ties to ledger-backed P&L source refs.
- Review JSON, CSV, XLSX, and PDF export files are generated for supported reports.
- Unresolved blocking review issue prevents export when policy requires it.

Web:

- Permission-filtered nav hides config/export/filing/certificate actions.
- VAT/WHT/CIT screens show source refs and review issues.
- Stale snapshot warning appears after source checksum changes.
- Freshness UI shows plain last-updated/changed-after-review copy to ordinary users and keeps raw checksums in authorized auditor detail.
- Delayed-input-VAT and employee-name cards expose one primary next action, retain prefilled facts and never offer current-period claim after the ordinary window or silently select nonrecoverable.
- WHT correction timeline keeps submission/receipt visibly pending until the exact authority terminal outcome; accountant handoff has no copyable anonymous URL; charge cards label estimate date and verified/final amounts separately.
- Forbidden/readonly states do not leak hidden counts.

AI/LINE:

- Unauthorized LINE user receives safe refusal.
- AI Tax answer includes source refs and status.
- AI Tax refuses filing/export/config/certificate/adjustment mutation.
- AI Tax states uncertainty when tax config is unverified or data is missing.

## 20. Implementation Handoff Checklist

Before coding:

1. Read [[plans/thai-tax-mvp-plan|Thai Tax MVP Plan]].
2. Read this spec.
3. Read [[specs/tax-2026-verified-rules|Thai Tax Verified Baseline]].
4. Read [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]].
5. Read [[specs/accounting-documents-spec|Accounting Documents Spec]].
6. Read [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]].
7. Read [[specs/permission-matrix|Permission Matrix]].
8. Read [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]] and [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]].
9. Re-check current RD/accountant assumptions and record source URL/date/reviewer in config.
10. Start with Phase 0 and Phase 1 from the plan.

If Prisma, auth, audit, outbox, document sequences, ledger, notification, AI Gateway, or web workspace already exists, reuse and extend it. Report schema/route/permission conflicts before coding.

## 21. Resolved Owner Decisions

- Tax reviewer is ACCOUNTANT.
- First demo must generate review JSON, CSV, XLSX, and PDF.
- ภ.พ.36 is MVP scope.
- 50 ทวิ must store data/export metadata and generate PDF in item 11.
- 50 ทวิ SYSTEM initial issue, SYSTEM content correction and SYSTEM `ใบแทน` use three hidden independently staged routes; each has its own EXTERNAL fallback and SYSTEM render manifest.
- Filed/external WHT correction is manual-first. Current verified-channel PND3/53 negative additional is distinct from refund/ค.10, and future automation is per exact form/route/channel only.
- Delayed input VAT has a separate ordinary last claim month and outer original-period review date. After the ordinary window the system neither claims in the current month nor auto-writes off; nonrecoverable requires explicit reviewed confirmation, and an employee-name tax document first requests correction into the company name.
- ป.ป.01/ป.ป.02 use pinned form eligibility plus a versioned responsible-office/channel checklist and packet manifest. Submission/receipt is never correction completion; append-only authority evidence must reach the exact route-policy terminal status.
- Accountant packet handoff is invited, resource-scoped and audit-downloaded only. It cannot create filing truth. Ordinary UI uses friendly freshness/change copy and separates principal, surcharge estimate-as-of, verified penalty and final RD amount; checksums remain auditor detail.
- Zero-credit VAT scope transition is automatic; nonzero is external-first, with optional internal transfer only per exact specialist-validated transition kind.
- In-product VAT credit offset has no v5.1 mutation. A future v6 starts PP30 current principal only under atomic credit+payable CAS.
- Seed all WHT categories/rates as configurable rows; keep them inactive or review-gated until accountant verification.

## 22. Owner Update 2026-07-14 — Full SAP-Compatible Transaction Tax

- Item 11A remains complete for receipt/no-duplicate-VAT and initial `O7`/`OX`/`O0` compatibility.
- Item 11B owns the broader gap: SAP ERP/S/4/custom company profiles, line-level mixed Tax Codes, domestic input/output VAT, import goods, imported services/ภ.พ.36, exports, deferred/reverse-charge/non-deductible treatments, customs/excise components, G/L account determination, PP30/PP36 box mapping, and source-to-tax-to-ledger reconciliation.
- VAT Tax Code, WHT code, customs duty/tariff classification, excise classification, and CIT support are separate regimes even when one transaction contains several components.
- Use [[specs/sap-compatible-transaction-tax-account-determination-spec|SAP-Compatible Transaction Tax and Account Determination Spec]] and its linked plan as the implementation source of truth for item 11B.
