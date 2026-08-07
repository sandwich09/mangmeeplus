# Thai Tax MVP Plan

## Status

Confirmed v5.1 product/UX baseline as of 2026-07-31. Implementation still starts only after Feature Entitlement Decoupling Plan F0 approves the exhaustive route matrices; every Thai-specialist SYSTEM/automation/internal-transfer route seeds CLOSED. Manual/external fallbacks remain the default usable journey, so no customer migration or repeated data entry is required. Canonical order remains [[plans/master-implementation-checklist|Master Implementation Checklist]] item 11.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Specs

- Spec: [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
- Normative decoupling amendment: [[specs/feature-entitlement-decoupling-spec|Feature Entitlement Decoupling Spec v5.1]] CC4–CC5; its Plan FIN-3–5 owns the additive filing-scope/VAT-credit/payment-owned-50ทวิ work.
- Full transaction-tax follow-up: [[specs/sap-compatible-transaction-tax-account-determination-spec|SAP-Compatible Transaction Tax and Account Determination Spec]] and [[plans/sap-compatible-transaction-tax-account-determination-plan|implementation plan]] (master item 11B)
- Verified tax baseline: [[specs/tax-2026-verified-rules|Thai Tax Verified Baseline]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 11. Thai Tax MVP
- Required dependency specs:
  - [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]]
  - [[specs/accounting-documents-spec|Accounting Documents Spec]]
  - [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
  - [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
  - [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## Purpose

Implement the first Thai tax readiness slice for WatchDog-BMS:

- VAT ภ.พ.30 preparation from source tax events.
- VAT ภ.พ.36 preparation for applicable foreign service/self-assessment cases.
- Withholding tax ภ.ง.ด.3 and ภ.ง.ด.53 preparation from payment/expense events.
- Payment-owned 50 ทวิ certificate generation, evidence, immutable correction workflow, and PDF delivery without re-entry.
- Corporate income tax ภ.ง.ด.50/51 calendar and ledger-backed supporting summaries.
- Configurable tax calendar, rates, and verification checklist.
- Web-first review/export workflow for finance/accountant.
- LINE reminders and AI Tax read-only summaries with source references.

This plan gives Sonnet 4.6 enough detail to implement without reopening product, ledger, tax, security, or web ownership decisions.

## Owner Decisions

Decisions confirmed on 2026-06-23:

- Tax reviewer: ACCOUNTANT.
- First demo export formats: review JSON, CSV, XLSX, and PDF.
- ภ.พ.36: in MVP.
- 50 ทวิ: store certificate data/export metadata and generate PDF in item 11.
- 2026-07-31 amendment: qualifying positive-WHT SETTLED source payment + payee owns initial multi-line issuance; TaxPeriod/TaxEvent are nullable provenance and `thai_tax` is not a prerequisite. Hidden `cap.wht50bis` routes independently gate SYSTEM initial issue, content correction and replacement copy. A closed/missing route uses its own EXTERNAL fallback, never blocks payment or a sibling and never auto-runs old work. Selected-event/manual issue/direct void are superseded.
- 2026-07-31 amendment: filed/external WHT correction is manual-first with immutable diff, exact route classifier, prefilled packet/checklist, one stable-revision approval and external evidence as `RECORDED_EXTERNAL`. The current portal announces that from 24 July 2569 the human-operated negative-additional route covers PND1/2/3/53 and requires the new RD Prep version; this does not make the generic API an automation contract, prove acceptance or establish refund/ค.10 rights.
- 2026-07-31 amendment: delayed input VAT stores `ordinaryDelayedClaimLastTaxMonth` separately from the three-year outer-review `outerReviewDate`. `CURRENT_PERIOD_DELAYED` requires the necessary cause/annotation and ends at the ordinary window; afterward the system prefills `ORIGINAL_PERIOD_AMENDMENT_REVIEW`, never claims in the current month or auto-writes off. The outer date is a review boundary, not automatic claim permission or write-off. `NONRECOVERABLE_CONFIRMED` is explicit only. An employee-name document first requests a corrected tax invoice in the company name and keeps all stored facts.
- 2026-07-31 amendment: ป.ป.01/ป.ป.02 use pinned form eligibility plus a versioned responsible-office/channel checklist and packet manifest. Correction submission/receipt does not close a case; an append-only authority outcome must reach the exact revision policy's successful terminal status. The `ใบแทน` SYSTEM route also requires a golden fixture for label position, counterpart, unchanged statutory content/hash and certification/signature.
- 2026-07-31 amendment: user-facing payment/freshness states are plain language—principal, surcharge estimate-as-of, evidenced penalty, final RD amount, and last-updated/changed-after-review copy. Raw checksums stay in auditor detail. Accountant handoff reuses invited ACTIVE company membership plus the F0-surveyed WorkflowTask/WorkCard seam and controlled audited packet download; no tax-owned handoff table, anonymous link or filing-state side effect.
- 2026-07-31 amendment: zero-credit scope transition is automatic and nonzero is external-first. Any internal transfer opens only per exact validated transition kind. A reviewed VAT offset may auto-mutate only an `EXTERNAL_UNMODELED` liability with exact RD evidence and no matching current in-product payable. Applying credit to an in-product payable is `[LATER] cap.thai_tax.vat_credit_in_product_offset`: v5.1 stores one prefilled no-mutation task; the smallest future v6 slice is PP30 principal-only with atomic credit+payable CAS.
- WHT categories/rates: seed full configurable catalog as DRAFT/NEEDS_REVIEW, with accountant verification required before activation.
- Output Tax Code boundary confirmed 2026-07-13: item-11A `O7`/`OX`/`O0` are the initial SAP ERP-style compatibility values; plain receipts carry no Tax Code and never duplicate VAT; combined receipt/tax invoices and credit/debit notes preserve legal document role and source link. Item 11B owns full profile-backed meaning.
- Owner expansion 2026-07-14: item 11B supersedes the narrow code-meaning assumption with company/effective-dated SAP ERP/S/4/custom profiles, line-level mixed tax, domestic input/output, import goods, imported services/PP36, exports, non-deductible/deferred/reverse-charge cases, tax account determination, and source-to-G/L-to-report reconciliation. Keep item 11A completed as the compatibility/receipt slice.

## Current Repository Context

Current docs direction rechecked on 2026-07-31:

- Item 08 owns sales/accounting source documents and tax-ready fields.
- Item 09 owns expense/receipt capture and expense-side tax-ready fields.
- Item 10 owns double-entry ledger, financial reports, and period close.
- Item 11 consumes source tax events plus ledger-backed accounting summaries.

Before implementation, inspect current code because items 01 through 10 may add Prisma, auth, request context, audit, outbox, document sequences, attachments, accounting documents, expenses, ledger reports, workers, AI Gateway read tools, and web workspace primitives.

Do not duplicate tenant, branch, document sequence, attachment, audit, outbox, request context, permission registry, accounting document, expense, ledger, notification, LINE binding, web-shell, config, or contract code. Extend existing primitives additively.

## Implementation Readiness Status

Status: confirmed v5.1 product baseline; implementation-ready only through Phase 0/F0 discovery. Specialist route rows remain CLOSED until exact validation evidence passes.

Active implementer target: Sonnet 4.6 or later.

Start point:

1. Read this plan first.
2. Read `docs/specs/tax-thailand-2026-spec.md`.
3. Read `docs/specs/tax-2026-verified-rules.md`.
4. Read `docs/specs/double-entry-ledger-closing-spec.md`.
5. Read `docs/specs/accounting-documents-spec.md`.
6. Read `docs/specs/expense-receipt-upload-spec.md`.
7. Read `docs/specs/data-model-core-spec.md`.
8. Read `docs/specs/permission-matrix.md`.
9. Read `docs/specs/auth-authorization-rbac-spec.md`.
10. Read `docs/specs/web-core-workspace-spec.md`.
11. Read `docs/specs/line-ai-read-only-assistant-spec.md`.
12. Read `docs/specs/ai-gateway-agents-spec.md`.
13. Read backend/frontend/security guidelines.
14. Inspect `apps/api`, `apps/web`, `apps/workers`, `apps/ai-gateway`, `packages/contracts`, `packages/config`, and current Prisma state.
15. Start at Phase 0: Reconcile Source, Ledger, and Tax Baseline.

Do not mark Master Implementation Checklist item 11 complete until Phase 0 through Phase 8 exit criteria pass and verification commands are recorded.

## Implementation Rules

- Re-check Revenue Department rules and accountant assumptions before implementation, activation, export, or release.
- Store VAT rates, WHT rates, CIT rules, calendar rules, online extension rules, and filing/export formats as configurable data.
- Do not hard-code due dates, tax rates, threshold rules, or form assumptions in business logic.
- Use source tax events for VAT/WHT detail and double-entry ledger outputs for accounting-period summaries where applicable.
- Do not implement Thai Tax MVP before item 10 ledger posting/report baseline is ready unless owner explicitly accepts document-only tax summaries.
- Web Tax owns return preparation/review/export/filing status/config and return/refund correction. Source payment/global hub owns initial 50 ทวิ, prefilled fact review and certificate-only correction under narrow WHT permissions, including with Tax off.
- LINE shows reminders, summaries, and source-linked explanations only.
- AI Tax is read-only, permission-checked, and must state when accountant/RD confirmation is needed.
- No AI or LINE may file returns, mark filings accepted, change tax config, or mutate final tax records. A background worker may perform only the qualifying, idempotent, document-scoped initial 50 ทวิ outbox under source authorization + tenant/branch scope when exact `cap.wht50bis/SYSTEM_INITIAL_ISSUE` is OPEN. Otherwise it writes only the external-certificate handoff. SYSTEM content correction and SYSTEM `ใบแทน` use their own independent route rows; filing/correction still requires the explicit Web flow.
- Tax report lines must be reproducible from source tax events, report snapshots, and ledger summaries.
- Filed or closed tax periods must reject silent source mutation. Corrections use source correction/reversal, tax adjustment, or amended filing workflow.
- Use decimal-safe money handling. Never use JavaScript floats for tax base, VAT, WHT, CIT estimate, or totals.
- Every tax-owned record must be company-scoped. Branch facts are normalized into an immutable canonical filing-scope partition; report, filing, correction and settlement lifecycle are scope-owned rather than one global TaxPeriod state.
- Controllers stay thin and call use cases. Prisma stays in infrastructure repositories/mappers.
- Contracts use strings for money/date fields across API boundaries.
- Audit all tax config, recompute, review, export, filing status, certificate issue, and adjustment actions.
- Keep export payloads bounded. Never write raw attachments, OCR text, secrets, tokens, or full report dumps into audit/outbox.

## Scope

### In Scope

- Shared tax contracts in `packages/contracts`.
- Tax permission keys and default role grants.
- Company tax profile for VAT registration, tax id, branch policy, accounting period, and tax reviewer settings.
- Config-driven tax year, rates, WHT categories, calendar rules, source links, and verification checklist.
- Tax periods for VAT PP30, VAT PP36, WHT PND3, WHT PND53, CIT50, and CIT51.
- Idempotent tax event sync from finalized accounting documents, tax invoices, payments, expenses, and ledger/source adapters.
- VAT report preparation for ภ.พ.30 from output/input VAT events.
- VAT ภ.พ.36 preparation for configured foreign service/self-assessment cases.
- WHT report preparation for ภ.ง.ด.3 and ภ.ง.ด.53 from payment/expense WHT events.
- Payment-owned 50 ทวิ records, multi-line snapshots, numbering through document sequence, immutable PDF/hash/delivery and correction cases.
- CIT calendar and ledger-backed supporting summary using item 10 P&L/accounting-period data.
- Review issue queue for missing tax id, missing branch, unknown VAT mode, unclaimable input VAT, WHT mismatch, missing tax invoice, duplicate source, and closed-period conflict.
- Tax filing package/export baseline with review JSON, CSV, XLSX, PDF, checksum, and manual filing/payment status.
- Web tax workspace screens.
- LINE/AI read-only tools for upcoming obligations, VAT summary, WHT summary, CIT calendar, and missing tax documents.
- Worker reminders for upcoming/overdue tax obligations when notification/outbox primitives exist.
- Tests for contracts, domain calculations, source sync idempotency, report totals, permissions, period lock, export/audit, AI tool policy, and web logic.

### Out of Scope

- Auto-submit/e-filing to Revenue Department.
- Legal/tax advice as final authority.
- Payroll ภ.ง.ด.1 and payroll withholding implementation. Item 20 owns payroll/HR compliance.
- Full e-Tax Invoice & e-Receipt API integration unless business has RD onboarding/certificate and owner creates separate scope.
- Full CIT calculation engine with SME tier automation. MVP provides calendar/reminder and supporting summaries.
- Tax office/accounting-office custom export templates beyond standard review JSON/CSV/XLSX/PDF exports.
- Multi-country tax.
- LINE tax mutation, export, filing status update, or config change.
- Creating ledger journal entries. Item 10 owns ledger posting.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: follow repo convention; if absent use `String @id @default(cuid())`.
- Currency: `THB`.
- Period keys:
  - VAT/WHT monthly: `YYYY-MM`.
  - CIT annual: accounting period id or `YYYY`.
  - CIT half-year: accounting period id plus `H1`.
- Company tax profile projects the shared Company Settings/finance effective-dated tri-state registration fact from Feature Entitlement Decoupling Spec v5.1 CC4; it does not own a Tax-only write. The legacy required tuple remains wire-compatible only; exact echo is a no-op, changed boolean/date uses the shared adapter + expected-version CAS or upgrade error, and default false is UNKNOWN.
- Tax rule status: `DRAFT`, `ACTIVE`, `RETIRED`.
- Tax filing-scope status: `OPEN`, `NEEDS_REVIEW`, `READY_FOR_REVIEW`, `REVIEWED`, `EXPORTED`, `FILED`, `PAID`, `CLOSED`, `AMENDED`. Any TaxPeriod status is a derived/compatibility aggregate only.
- Tax event status: `ACTIVE`, `SUPERSEDED`, `REVERSED`, `EXCLUDED`.
- Input-VAT recovery route: `CURRENT_PERIOD_DELAYED`, `ORIGINAL_PERIOD_AMENDMENT_REVIEW`, `NONRECOVERABLE_CONFIRMED`; a single ambiguous `claimDeadline` is forbidden.
- Filing package/export status: `GENERATED`, `DOWNLOADED`, `VOIDED`.
- Filing submission record status: `RECORDED_EXTERNAL`, `RD_ACCEPTED_VERIFIED`, `EXTERNAL_REJECTION_RECORDED`. Manual evidence requires no export and never implies system submission/RD acceptance.
- WHT correction authority outcomes are append-only; submission/receipt/approval-only are nonterminal, and only a status in the exact immutable route policy may complete the return branch.
- VAT event types: `VAT_OUTPUT`, `VAT_INPUT`, `VAT_EXEMPT`, `VAT_REVIEW`.
- WHT form types: `PND3`, `PND53`.
- VAT form types: `PP30`, `PP36`.
- CIT form types: `PND50`, `PND51`.
- Tax reviewer default: ACCOUNTANT role.
- First demo export formats: `REVIEW_JSON`, `CSV`, `XLSX`, `PDF`.
- WHT categories/rates: seed full configurable catalog as `DRAFT` or `NEEDS_REVIEW`; accountant verification activates rows.
- Source types should reuse item 08/09/10 stable strings, such as `accounting.document`, `accounting.tax_invoice`, `accounting.payment`, `expense.record`, `expense.payment`, and `ledger.summary`.
- 50 ทวิ certificate sequence key: `tax.wht_certificate`.
- Export sequence key: `tax.filing_export`.
- LINE default reminder window: show due within 7 days and overdue obligations if notification preferences allow.

## Phase 0: Reconcile Source, Ledger, and Tax Baseline

### Goal

Confirm source modules, ledger reports, and tax baseline are ready before adding tax code.

### Tasks

- [ ] Inspect current Prisma schema and migrations.
- [ ] Inspect Accounting Documents implementation and tax-ready source fields.
- [ ] Inspect Expense/Receipt Upload implementation and expense tax-ready fields.
- [ ] Inspect Double-Entry Ledger implementation, period model, P&L/report APIs, and close policy.
- [ ] Inspect Data Model Core document sequence, branch, audit, attachment, and outbox services.
- [ ] Inspect Auth/RBAC permission registry, role seed, request context, and ABAC helpers.
- [ ] Inspect Web Core navigation, route, list/detail/form, forbidden/readonly, and export patterns.
- [ ] Inspect Workers notification/outbox conventions.
- [ ] Inspect LINE/AI read-tool conventions from item 07.
- [ ] Confirm source event/status names for issued tax invoice, payment recorded, expense confirmed, expense paid, void, credit note, debit note, posting reversed, and period closed.
- [ ] Confirm ledger report/read adapter available for CIT supporting summaries.
- [ ] Confirm current decimal/money convention.
- [ ] Re-check RD/accountant baseline before coding. Record checked URLs, date, reviewer, and unresolved rule assumptions.
- [ ] Verify and snapshot the official delayed-input-VAT sources (Revenue Code section 82/3, Director-General VAT Announcement No. 4 and RD seminar guidance linked by the spec). Confirm the calculator for `ordinaryDelayedClaimLastTaxMonth`, the separate outer original-period review date, necessary-cause codes and invoice annotation requirement; never convert either date to automatic nonrecoverability.
- [ ] Verify the official ป.ป.01/ป.ป.02 form versions and allowlisted eligibility from the RD form index/direct PDFs linked by the spec. For each supported responsible office, record a separately versioned local channel/checklist source, evidence hash, reviewer, checked/valid date and required packet contents. Another office's guidance is not nationwide proof.
- [ ] Verify the 50 ทวิ/`ใบแทน` form/copy/certification sources and approve one golden fixture covering visible label position, retained counterpart/copy identity, unchanged statutory content/hash and certification actor/time/signature placement. Keep `SYSTEM_REPLACEMENT_COPY` CLOSED until it passes.
- [ ] Survey the existing `CompanyMembership`, company invite, `WorkflowTask` and `WorkCardUserState` implementation named by Feature Entitlement Decoupling F0. Record the deterministic business-issue key, assignment command, membership/branch/permission recheck and audit/download seam. Do not add a tax-owned accountant-handoff table unless this survey proves an invariant cannot be enforced.
- [ ] Record the 2026-07-31 channel distinction: the portal announcement is effective 24 July 2569, covers human-operated negative additional PND1/2/3/53 and requires the new RD Prep version, while the generic API catalog does not prove automated support for an exact PND3/53 correction route. Freeze `(formType,correctionRoute,channelVersion,channelValidationDecisionRef,validationDecision=VERIFIED,sourceStatus=ACTIVE,validationEvidenceHash,checkedByUserId,checkedAt,validUntil)` evidence per route; `ADDITIONAL_NEGATIVE` is unavailable unless that exact decision remains current.
- [x] Reconcile current `AccountingDocumentType`, `vatMode`, `taxInvoiceType`, payment/receipt links, and tax source adapter against the output Tax Code/document-role matrix. Closed 2026-07-13 by restricting output VAT sync to issued `TAX_INVOICE`/`CREDIT_NOTE`/`DEBIT_NOTE` records with explicit Tax Code.
- [ ] Record gaps before coding. Do not invent missing source facts.

### Tests

- No code tests required unless setup changed.

### Exit Criteria

- Exact source adapters and ledger adapters are known.
- Exact module folders, migration path, contract path, and web feature path are known.
- Tax assumptions needing owner/accountant confirmation are listed.
- Every correction-channel decision snapshots the exact `(channelValidationDecisionRef, validationDecision=VERIFIED, sourceStatus=ACTIVE, validationEvidenceHash, checkedByUserId, checkedAt, validUntil)` tuple; a missing, retired, expired or otherwise unverified tuple remains on the same manual packet flow.
- Delayed-input-VAT rule sources and separate ordinary/outer dates are confirmed; ป.ป.01/ป.ป.02 form eligibility, selected-office channel checklist and `ใบแทน` fixture evidence are versioned.
- Existing membership/work-card/task seams for accountant assignment and controlled packet download are identified, or the exact unmet invariant is documented before any new persistence is proposed.
- No duplicate source document, ledger, audit, outbox, or permission implementation is planned.

## Phase 1: Contracts, Permissions, and Domain Rules

### Goal

Define stable tax contracts and pure domain rules before persistence/API/UI.

### Tasks

- [ ] Add tax contract types in `packages/contracts/src/tax.ts` or current contract pattern.
- [ ] Export tax contracts from `packages/contracts/src/index.ts`.
- [ ] Add enums/types for tax type, form type, filing-scope kind/status, event type/status, filing package status, review issue severity, certificate/correction status, and config status.
- [x] Add the smallest explicit output Tax Code/document-role contract needed to distinguish plain receipt from receipt/tax invoice and prevent VAT duplication. `outputTaxCode` is persisted on accounting/tax records; combined receipt/tax invoice is a `TAX_INVOICE` linked to an issued `RECEIPT`; application-code meaning remains separate from RD legal rules.
- [ ] Add money/date DTOs using strings.
- [ ] Add DTOs for:
  - company tax profile
  - tax rule source
  - tax year config
  - tax rate config
  - tax calendar rule
  - tax period
  - canonical filing-scope snapshot/partition
  - tax event
  - shared VAT claim resolution plus separate ordinary delayed-claim/outer-review dates, necessary-cause/annotation state, exact recovery route, Tax/Ledger projection and retained-root review command/result
  - VAT report
  - WHT report
  - filing-submission head including optional exact correction-case/revision/packet binding, PP36/PND payment-root/status head and shared tax cash-evidence link/allocation command/result
  - PP30 opening/credit/allocation, refund/offset, stable scope-transition work item + immutable preparation revision + mutually exclusive finalize result, payable/payment/reversal command/result
  - payment-owned WHT certificate/revision/line/handoff/command/copy/correction-case/replacement-copy, SYSTEM route availability decision, immutable correction eligibility/local-channel checklist/packet manifest, append-only authority outcome and certification-actor snapshot
  - CIT calendar/supporting summary
  - tax filing package/export
  - tax review issue
  - AI tax tool responses
- [ ] Add tax permission keys from the spec and permission matrix.
- [ ] Seed/map default role grants and capability packs using existing RBAC conventions: entitlement-free `pack.wht.certificate.manage`, source/Ledger-scoped `pack.finance.vat.review`, and baseline Company Settings VAT-registration read/manage. Keep these keys outside the `thai_tax` prefix filter and enforce current source visibility or exact retained authority at runtime.
- [ ] Every mutation DTO uses string money/date fields and carries caller-stable command id/fingerprint plus the applicable expected active head, source revision, allocation version or position version; SYSTEM WHT commands additionally pin `availabilityDecisionRef + systemRouteKey + routeGeneration`, correction evidence pins exact case/revision/packet/policy/evidence hashes and expected authority predecessor, and VAT transition finalization pins the active preparation/work-item/origin/successor versions. Result DTOs return the immutable artifact/head and reconciliation/projection state. Accountant assignment DTOs adapt the surveyed shared WorkflowTask/WorkCard command and do not introduce a tax handoff aggregate.
- [ ] Implement pure domain logic for period/due dates, delayed-input-VAT ordinary/outer routing and explicit nonrecoverable confirmation, legacy policy normalization, disjoint partition/independent scope lifecycle, PP30 credit position/allocation/outcome conservation, internal transfer and conserved external transition, PP30 payable/payment, WHT grouping/qualifying-certificate source-snapshot validation, correction form eligibility/local packet manifest/authority terminal policy, tax event/submission idempotency and filed-scope mutation. Internal nonzero transfer remains gated; external evidence fallback remains available.
- [ ] Add domain tests for decimal-safe totals/grouping, delayed-input-VAT boundary/cause/annotation/employee-document cases, legacy VAT tuple/FILED/PAID compatibility, partitions/branchless/overlaps, PP30-vs-PP36 semantic isolation, zero/internal/external nonzero transitions with immutable Finance preparation and one mutually exclusive terminal result, exact opening/settlement/transition reservation receipt/offset/return/disallow/expire, bank-allocation non-reuse, corrected-lower payment reversal, qualifying/no/invalid-WHT/source-or-legacy-artifact correction, `ใบแทน` golden fixture, exact WHT route-generation decisions, correction eligibility/packet/submission/authority binding, submission/payment-head CAS and scope locks.
- [x] Add focused rules/tests proving plain receipt means no Tax Code/no VAT event, receipt/tax invoice creates at most one VAT event, and credit/debit notes adjust the referenced event. Full API and authenticated browser smoke passed 2026-07-13.

### Exit Criteria

- Contracts compile and are exported.
- Permission keys are ready for RBAC seed/migration.
- Domain rules pass tests without database dependency.
- No rate/deadline value is hard-coded in domain logic.

## Phase 2: Persistence Models, Migrations, and Seed

### Goal

Persist configurable tax setup, source-derived events, periods, reports, filing packages, certificates, and review issues.

### Tasks

- [ ] Add or extend Prisma models from the spec:
  - `CompanyVatRegistrationState`
  - `CompanyVatRegistrationCommand`
  - `CompanyVatRegistrationFact`
  - `VatRegistrationPrompt`
  - `CompanyTaxProfile`
  - `TaxRuleSource`
  - `TaxYearConfig`
  - `TaxRateConfig`
  - `TaxCalendarRule`
  - `TaxPeriod`
  - `TaxFilingPartitionSnapshot`
  - `TaxFilingScopeSnapshot`
  - `TaxCutoverScopePolicy`
  - `VatScopeOpeningCreditPosition`
  - `VatOpeningCreditLedgerProjection`
  - `VatScopeCreditPosition`
  - `VatScopeCreditPositionAllocation`
  - `VatClaimResolution`
  - `VatClaimTaxProjection`
  - `VatClaimLedgerProjection`
  - `TaxEvent`
  - `TaxEventScopeAssignment`
  - `TaxReviewIssue`
  - `TaxReportSnapshot`
  - `TaxFilingPackage`
  - `TaxFilingSubmissionRecord`
  - `TaxFilingPaymentRoot`
  - `TaxFilingPaymentRecord`
  - `TaxCashEvidenceLink`
  - `TaxCashEvidenceAllocation`
  - `TaxLedgerProjection`
  - `WhtCertificate`
  - `WhtCertificateLine`
  - `WhtCertificateCopyArtifact`
  - `WhtCertificateHandoff`
  - `WhtReplacementCopyHandoff`
  - `WhtCommandRegistry`
  - `WhtCertificateCommand`
  - `WhtCorrectionCase`
  - `WhtCorrectionRevision`
  - `WhtCorrectionAuthorityOutcome`
  - `VatPeriodSettlement`
  - `VatRefundOutcome`
  - `VatCreditOutcomeCorrectionCommand`
  - `VatCreditScopeTransfer`
  - `VatCreditScopeTransferOriginConsumption`
  - `VatCreditScopeTransferDestinationLeg`
  - `VatScopeTransitionWorkItem`
  - `VatScopeTransitionPreparationRevision`
  - `VatScopeTransitionExternalOutcome`
  - `VatScopeTransitionExternalDisposition`
  - `VatFilingPayablePosition`
  - `VatFilingPaymentOutcome`
  - `TaxAdjustment`
  - `TaxVerificationChecklist`
- [ ] Add company/date/status/source indexes.
- [ ] Add `renderManifestJson` + `renderManifestHash` to every new SYSTEM `WhtCertificateCopyArtifact`. The canonical manifest pins template/rule source and versions, renderer/font bundle, statutory-content hash and signer/signature snapshot where applicable; EXTERNAL artifacts preserve their uploaded document/evidence hash instead. Deploy-owned pre-manifest legacy SYSTEM evidence keeps null manifest fields plus its legacy marker and is never customer-migrated/back-stamped. Store an immutable certification-actor snapshot/hash for every new artifact when certification applies; legacy evidence preserves only durable facts, and `certifiedByUserId` is only an optional recorder/link that must not require an external legal signer to become a WatchDog user.
- [ ] Persist `availabilityDecisionRef + systemRouteKey + routeGeneration` together on every new `ISSUE_SYSTEM|CORRECT_SYSTEM|ISSUE_REPLACEMENT_COPY` command, artifact, render manifest and outbox result. Revalidate that exact decision immediately before number/PDF final mutation; a queued command from an older generation mutates nothing and explicit Issue/Reissue obtains a fresh decision. Deploy-owned pre-gate legacy SYSTEM evidence keeps null route-decision fields with its legacy marker and is never assigned a current generation.
- [ ] Persist the manual correction packet attachment/hash on its immutable stable revision. Bind every correction filing `TaxFilingSubmissionRecord` to the exact company/case/revision/packet hash, while normal filings leave those refs null; wrong-case, stale-revision and packet-hash mismatch append nothing. The case's external acknowledgement derives only from that linked immutable submission record.
- [ ] Extend `VatClaimResolution` additively with invoice tax month, `ordinaryDelayedClaimLastTaxMonth`, `outerReviewDate`, necessary-cause/evidence, annotation status, exact `recoveryRoute` and rule source/version/check date. Deploy-owned derivation may fill exact values from retained source/rule evidence; ambiguous history remains `EXTERNAL_OR_UNRESOLVED` with one lazy prefilled review. Never backfill `NONRECOVERABLE_CONFIRMED`, create a current-period TaxEvent after the ordinary window or ask customers to migrate/re-key invoices.
- [ ] Extend each FILED/EXTERNAL `WhtCorrectionRevision` with immutable eligibility, selected responsible office, versioned local-channel checklist/evidence, packet manifest/hash and exact authority-route terminal policy/hash. Add append-only `WhtCorrectionAuthorityOutcome` with case/revision/packet/policy/evidence hashes, status-effective time, command/fingerprint and predecessor outcome; the case keeps only the active outcome pointer. Submission/receipt statuses are nonterminal and cannot close the case.
- [ ] Reuse existing ACTIVE `CompanyMembership` plus the surveyed `WorkflowTask`/`WorkCardUserState` store for accountant assignment by deterministic business-issue key. Add no tax-owned handoff model or history backfill; successor packet lineage updates the same task only through existing workflow semantics and permission recheck.
- [ ] Add unique constraints for VAT-registration state/command/prompt/non-overlapping facts, company period/form, one active whole filing partition, canonical scope generation/lineage, one active event/contribution→scope assignment per revision, one active form-default/scope cutover/opening position, PP30 regime+scope+currency current credit/payable heads and allocation/mutation lineage, one stable scope-transition work item per from/to/kind with append-only preparation revisions and one terminal ORIGINAL result pointer, cross-transfer origin-position/allocation consumption, one company-global VAT-outcome correction command/result, scope/revision report/submission/generic-payment/settlement, one CURRENT Tax Ledger projection per stable projection root, tax-event idempotency, one active certificate across linked SYSTEM/EXTERNAL/LEGACY_RECONCILED origin per non-null company/payment/payee identity, one nonterminal correction case per active certificate, one company-global WHT command registry across action/case/revision families, one authority-outcome command and sequence per correction case with exact predecessor CAS, certificate identity+revision/source-or-artifact snapshot, at most one ORIGINAL/certificate (required only when durable issued/linked artifact evidence exists), copy sequence, certificate number, and export number.
- [ ] Add migration.
- [ ] Additively normalize legacy `HEAD_OFFICE_ONLY|MAIN_ONLY`, `ALL_BRANCHES`, `PER_BRANCH`, and durable `SELECTED_BRANCHES|CONFIGURED` values into a DRAFT whole-partition parent + child scopes, validate its disjoint checksum, then atomically activate it. Retain TaxPeriod status/timestamps as a compatibility aggregate; never silently map missing/contradictory selected sets.
- [ ] Deploy-owned backfill existing `TaxPeriod.status/filedAt/paidAt/reviewNote` and `TaxFilingPackage.ACCEPTED_MANUAL/filedManuallyAt/note` into deterministic `LEGACY_FILED_RECORDED` submission and `LEGACY_PAID_RECORDED` payment markers. Preserve known timestamp/note/package/reference/actor, leave unknown amount/reference/evidence null, and bind scope/revision only when durable history is unambiguous. Ambiguous multi-scope periods keep one aggregate compatibility marker + one prefilled next-action review; never create PP30 credit/payable, bank match, 2137 clearing, or customer migration/re-entry.
- [ ] Infer per-form default + necessary per-scope cutover overrides from durable filing evidence, not source date alone. Output/WHT handled periods stay EXTERNAL/HISTORICAL; older input VAT classifies EXTERNAL_CLAIMED/CARRY_IN_CANDIDATE/REVIEW. Materialize evidence-backed or explicit-zero VAT opening available/refund-reserved buckets; no G/L inference or silent zero. For nonzero openings, persist one nullable-account Ledger projection that links only proven matching provenance or prepares a current-open reviewed Dr 1156 opening-balance adjustment, ordered before settlement use.
- [ ] Deploy-owned initialize `CompanyVatRegistrationState(version=0)` for every company, then scan source VAT/evidence/registration/TaxEvent/posted-journal provenance into effective-dated facts and active `VatClaimResolution` plus Tax/Ledger projections only when exact and non-conflicting. Every fact write increments the state row; UNKNOWN resolution compares its version so a concurrent first fact loses CAS. Keep ambiguity as one lazy prefilled retained-root review; never convert entitlement-off defaults into legal nonrecoverability or ask per-row migration. Tax-off recoverable projections remain PENDING and enable-later creates/links one TaxEvent after source/cutover/scope revalidation.
- [ ] Link existing certificates to durable payments before the active-certificate constraint; deploy-owned backfill reserves one shared `WhtCommandRegistry` result with `LEGACY_MIGRATION` authority and one `LEGACY_RECONCILED` command (source identity nullable only for an unlinked legacy certificate and `resultCertificateId` required). Seed exactly one ORIGINAL copy row only from durable audit/PDF hash evidence; otherwise keep the certificate metadata plus one discoverable `LEGACY_UNRESOLVED` task and no fabricated copy. Preserve unknown source revision/hash as nullable, reconstruct only from durable evidence, and keep reviewed exact-artifact repair available without fabricating a source link or requiring customer re-upload/re-entry.
- [ ] Seed safe draft tax year config/rules from verified baseline with `DRAFT` or `NEEDS_REVIEW` where accountant confirmation is required.
- [ ] Seed tax permissions plus shared `company.vat_registration.read|manage`, `finance.vat.review`, `wht.certificate.read|prepare|correct`, `wht.external_certificate.link` and high-risk `vat.credit_outcome.correct` without mapping them to `thai_tax`. Seed the concrete Company Settings/VAT-review/WHT packs and Finance/Accounting preset mappings; grant VAT-outcome correction only to OWNER/ACCOUNTANT, not broad Finance, and test prefix filtering plus source/retained-artifact/exact-outcome-root ABAC. Add `tax.adjustment.approve` explicitly for OWNER/ACCOUNTANT only before enabling Tax-on approval routes; final VAT scope-transition CAS requires it together with `tax.review_issue.resolve`, while Finance may append the immutable preparation but cannot finalize it.
- [ ] Seed document sequence keys for `tax.wht_certificate` and `tax.filing_export` if sequence service exists.
- [ ] Add repository ports and Prisma repositories, including contracts-owned immutable `TaxCashTargetReader` for Bank and Bank-owned `BankConfirmedMatchEvidenceReader` for Tax plus the Ledger posted-cash-line evidence reader. Wire adapters at the composition/read-model boundary; no module imports another module's repository/mutation service and no `forwardRef` shortcut. Tax creates truth first and the evidence link targets only an existing immutable artifact.
- [ ] Add persistence tests for VAT-registration state version-0/first-fact/lost-response command replay; whole-partition DRAFT→ACTIVE/disjoint assignments/independent scope state; VAT resolution active uniqueness, separate ordinary/outer timing fields, no automatic nonrecoverable backfill, current Ledger-head supersession, UNKNOWN-registration stale CAS and OFF→resolve→Tax/Ledger ON projections; legacy filing/payment backfill with unambiguous/ambiguous scope; mixed cutover/opening; PP30 allocation sums/current-version CAS and PP30-vs-PP36 semantic isolation; exact reservation origins, `EXTERNAL_UNMODELED`-only offset, in-product-offset no-mutation, return/disallow/expire, shared outcome-correction registry/current-leaf/full-reversal replay, immutable scope-transition preparation carry-forward and work-item CAS proving internal/external ORIGINAL mutual exclusion, atomic split-leg internal transfer with global origin non-reuse and origin+successor-CAS external transition; versioned settlement/external-transition/refund/payment Ledger projection roots with nullable unresolved periods and close-reader dependencies; stable PP30 payable root/late superseded-settlement rejection, partial/charge/corrected-lower reversal, stable PP36/PND payment-root/status transitions, target-hash mismatch, legacy evidence without cash link, normalized cash-evidence current/source uniqueness; command-idempotent concurrent WHT case open/one nonterminal case, one active linked SYSTEM/EXTERNAL/LEGACY_RECONCILED certificate, ORIGINAL only with durable artifact evidence, company-global registry/cross-family reuse, identity+revision/copy uniqueness and source-or-exact-artifact CAS; SYSTEM route-decision generation replay/stale rejection; EXTERNAL signer snapshot without a user account; versioned eligibility/local-checklist/packet manifest plus exact correction packet→submission→authority predecessor binding with wrong-case/stale/hash rejection; and Finance-denied versus OWNER/ACCOUNTANT-approved VAT transition finalization. Prove accountant assignment reuses shared workflow persistence and creates no tax handoff row. Test Tax and Bank modules independently with fake boundary ports.

### Exit Criteria

- Schema supports MVP tax workflows without waiting for payroll, procurement/AP, bank reconciliation, or e-filing integration.
- Tax setup can be seeded without treating unverified rules as final.
- Source event sync can be rerun idempotently.
- Schema evidence proves each SYSTEM WHT artifact's exact route generation, each correction submission/authority outcome's exact packet and policy revision, separate input-VAT timing routes and each certified EXTERNAL artifact's legal actor snapshot without forcing a user-account mapping or customer data migration. Accountant assignment uses existing workflow storage only.

## Phase 3: Source Tax Event Sync and Period Engine

### Goal

Create reproducible tax events and periods from finalized source records.

### Tasks

- [ ] Add source reader ports for accounting documents, tax invoices, payments, expenses, expense payments, and ledger summaries.
- [ ] Implement source adapters using existing item 08/09/10 APIs/use cases where available.
- [ ] Generate VAT output events from issued sales tax invoice/document sources according to config.
- [ ] Generate VAT input events from confirmed expenses/purchase sources only when input VAT claim status allows it.
- [ ] Resolve delayed input VAT from the active `VatClaimResolution`: calculate ordinary last claim month and outer review date from the pinned rule; include `CURRENT_PERIOD_DELAYED` only when still in-window with cause/annotation complete; after that create one prefilled original-period amendment review and no current TaxEvent/write-off. Employee-name documents remain `DOCUMENT_PENDING`, with a prefilled company-name correction request and explicit reviewed nonrecoverable as the only write-off route.
- [ ] Generate WHT events from payment/expense payment events, not only invoice creation.
- [ ] Keep unknown or unsupported tax treatment as review issues, not guessed tax events.
- [ ] Assign every event to a TaxPeriod calendar container, then persist exactly one active `TaxEventScopeAssignment` per eligible contribution/revision using one ACTIVE whole-partition snapshot. For branchless legacy events, infer an authoritative branch from source/sole-main evidence and assign it to the exactly-one active scope containing that branch (HEAD_OFFICE only when that is active); otherwise create one scope-level prefilled review and exclude unresolved contributions.
- [ ] Apply the active per-form default/scope cutover and persist `cutoverScopePolicyId + disposition/reason` on every event/contribution. Output/WHT in externally handled periods is sticky; older input VAT classifies external-claimed/carry-in/review from prior return evidence. Credit/debit notes, voids and corrections inherit the referenced original's scope/cutover lineage, so a current-dated correction of external history routes to external/amended review.
- [ ] Pre-review policy change atomically replaces the whole draft assignment partition. Reviewed/filed scope changes use linked successor/correction; overlaps, branch moves or consolidated+branch double inclusion fail closed.
- [ ] Track source event revision/hash/checksum so resync can supersede changed draft/unfiled events.
- [ ] Reject source mutation or resync changes for the affected filed/closed scope unless adjustment/amended flow is used; another scope in the same TaxPeriod remains independently operable.
- [ ] Emit audit/outbox events for sync errors and review issue creation where conventions exist.

### Tests

- Source sync is idempotent.
- Issued tax invoice creates output VAT event.
- Confirmed expense with eligible input VAT creates input VAT event.
- Ordinary-window boundary, first period after the window and outer-review cases preserve one source/resolution lineage. No after-window current event or automatic nonrecoverable classification is created, and employee-name correction reuses stored issuer/invoice/company facts.
- Expense marked input VAT not claimable creates review/excluded behavior according to config.
- WHT event uses payment date for period assignment.
- Missing vendor/customer tax id creates review issue.
- Filed scope blocks its event mutation while an OPEN sibling scope remains mutable.
- Every eligible event/contribution is assigned exactly once per revision; overlapping selected groups, branch moves and consolidated→per-branch changes never duplicate it.
- Mixed branch cutovers, delayed input-VAT claim across cutover, branchless legacy inference/review and a current-dated correction to an externally handled original preserve sticky lineage without duplicate/omitted totals.

### Exit Criteria

- VAT/WHT report data can be rebuilt from source events.
- Review issues expose missing/ambiguous facts instead of fabricating tax treatment; delayed input VAT always shows one correct next action without re-entry.

## Phase 4: VAT, WHT, Certificate, and Export Preparation

### Goal

Build accountant-reviewable VAT/WHT reports and export package baseline.

### Tasks

- [ ] Implement VAT report generator for ภ.พ.30 preparation:
  - output VAT total
  - input VAT total
  - payable/refund summary
  - source lines and source refs
  - excluded/review-needed lines
  - delayed-input-VAT ordinary last month, outer review state, cause/annotation status and one friendly next action; no after-window current claim
  - canonical filing scope/revision, independent scope status and checksum
  - scope-locked opening/used/created/refund-reserved/closing credit position
- [ ] Implement VAT ภ.พ.36 preparation for configured foreign service/self-assessment cases:
  - source event refs
  - taxable base
  - VAT amount
  - payment/status metadata
  - review issues when config or source facts are incomplete
- [ ] Implement WHT report generator for ภ.ง.ด.3 and ภ.ง.ด.53:
  - group by payee, tax id, income category, rate, payment date
  - gross amount, withheld amount, net paid
  - certificate refs
  - source refs and review issues
- [ ] Implement payment-owned 50 ทวิ initial issuance:
  - only qualifying `SETTLED && withheldAmount>0` payment/payee identity with valid exact-sum WHT lines and a complete/unambiguous effective-template statutory snapshot creates the idempotent outbox. Infer stored facts; zero/no-WHT is NOT_APPLICABLE and missing/ambiguous facts open one source/global-hub `wht.certificate.prepare` review, available with Tax off, before any number/artifact and without re-entry;
  - immutable payer/payee plus multi-line category/rate/gross/withheld snapshots, source payment identity/revision/WHT hash, nullable TaxPeriod/TaxEvent provenance, sequence number, ORIGINAL Thai PDF/hash and delivery evidence;
  - normal SYSTEM path runs under source authorization + tenant/branch scope + exact OPEN `cap.wht50bis/SYSTEM_INITIAL_ISSUE`, including with `thai_tax` off; legacy POST only links/returns/retries the eligible identity and never groups selected TaxEvents;
  - source settlement/WHT fact capture never waits for a SYSTEM route. When `SYSTEM_INITIAL_ISSUE` is CLOSED/missing, create/return one durable handoff and expose upload/link from source/global hub under `wht.external_certificate.link`. A number-only/nonvalid DRAFT at route close is immutably cancelled with number consumed before handoff; a complete issued artifact is linked. Reopen never auto-issues history;
  - EXTERNAL, SYSTEM and linked LEGACY_RECONCILED artifacts share one active source-identity predicate and one company `tax.wht_certificate` number namespace; only genuinely unlinked LEGACY_UNRESOLVED history remains outside the predicate. Register external numbers atomically; same identity is idempotent, different-identity collision reviews once, future sequence reservation skips them, and concurrent upload vs Issue produces one artifact without asking for renumber/re-entry;
  - every handoff/issue/link first reserves or replays one company-global `WhtCommandRegistry` row and appends its `WhtCertificateCommand` in the same transaction, pinning the expected source-payment revision/WHT hash. A SYSTEM action additionally pins its exact route key/generation/availability-decision ref and revalidates it immediately before number/PDF final mutation. Same-command lookup/fingerprint check precedes source/active CAS, one active linked certificate and at most one ORIGINAL copy win, and a stale source or route generation allocates nothing. A newly issued/linked durable artifact requires its ORIGINAL row; ambiguous legacy evidence creates neither issuance nor a fabricated copy.
- [ ] Implement immutable 50 ทวิ correction case/revisions:
  - open a case with company-global caller command/fingerprint and required expected active certificate/revision under the certificate lock; same-command lookup comes first, the first revision commits atomically and a partial unique fence allows only one nonterminal case per active certificate. Revision command IDs are company-global. Supersession advances the case's active certificate/revision in the same transaction;
  - certificate-only correction/cancellation/`ใบแทน` uses current source visibility or exact retained legal-artifact authority + `wht.certificate.correct`, including Tax off and after source feature OFF. SOURCE_LINKED commands require expected active cert/revision + source-payment revision/WHT/statutory/artifact hashes. Reviewed LEGACY_ARTIFACT repair instead requires exact active cert/revision + statutory/artifact hashes and authority evidence, with no invented payment/payee link. Only OPEN `cap.wht50bis/SYSTEM_REPLACEMENT_COPY` replays one SYSTEM copy generated from the retained counterpart, marks `ใบแทน` and stores immutable issuer-certification actor/time/signature snapshots. Otherwise render no system PDF: create/replay one prefilled `WhtReplacementCopyHandoff(REQUIRED)`, then link the externally prepared certified replacement under the unchanged statutory hash and the same registry command fence. Reuse a valid company signer snapshot and prompt once only if missing; an external legal signer is stored as an actor snapshot and need not be a WatchDog user, while any `certifiedByUserId` is an optional recorder/link. Financial/payee/form changes on linked records reference an audited source correction, lock old/new identities and activate applicable return/funding/refund/Ledger branches;
  - only OPEN `cap.wht50bis/SYSTEM_CONTENT_CORRECTION` creates a new corrected SYSTEM number/PDF; otherwise accept a corrected EXTERNAL number/PDF/evidence. Both atomically VOID/SUPERSEDE old artifact under one identity/number lock and deliver notice; every action is recorded through the shared registry plus append-only `WhtCertificateCommand`; `ใบแทน` keeps identity/number/statutory-content hash in a separate immutable copy artifact or externally linked replacement-copy handoff;
  - store/reproduce the SYSTEM render manifest and exact route-generation decision for initial, correction and replacement artifacts and seed all three routes CLOSED. Validate/open in rollout order: initial issue → content correction → replacement copy. Each route has independent golden fixtures/close races and EXTERNAL fallback; the order is not a runtime dependency. The replacement fixture pairs retained counterpart + rendered `ใบแทน` and asserts visible Thai label in the approved position, counterpart/copy identity, identical statutory fields/hash and complete certification actor/time/signature placement;
  - return-only error never reissues. Return route/type/status are nullable exactly for certificate-only cases. Implement manual-first: DRAFT rebuilds in-product; SUBMITTED_UNPAID cancels/terminalizes the old slip before replacement; FILED/EXTERNAL builds immutable before/after, classifies exact `(formType,correctionRoute,channelVersion)`, and for `ADDITIONAL_NEGATIVE` requires the exact `channelValidationDecisionRef`, `validationDecision=VERIFIED`, `sourceStatus=ACTIVE`, evidence hash, reviewer, checked date and unexpired validity. For ป.ป.01/ป.ป.02 it also allowlists eligibility from the pinned form and snapshots the responsible office's versioned channel checklist/evidence. It generates one immutable manifest-backed packet attachment/hash, obtains one stable-revision approval, then records external evidence as `RECORDED_EXTERNAL` bound to that case/revision/packet. Route data-only errors to ป.ป.01 only when totals and prohibited identity fields are unchanged, wrong form/class to ป.ป.02 only within its form scope, short amount to positive additional, and over-remittance to `ADDITIONAL_NEGATIVE` only while that current PND3/53 decision remains valid; otherwise use overstated-refund/tax review. Refund/ค.10 is always a separate branch;
  - append authority outcomes under same-command-first + expected-predecessor CAS with exact case/revision/packet/policy/evidence hashes. `mark-filed` creates only `SUBMISSION_RECORDED`; receipt, pending review, more-information and approval-only remain nonterminal. Only an evidence-backed status in the immutable route's terminal set may complete the return branch; rejection/withdrawal reopens review. E-Filing acceptance never proves payment/refund/ค.10;
  - seed all automated filing-correction rows CLOSED. Unknown/closed routes preserve the same packet, never ask for re-entry, never claim RD acceptance and never resubmit/reclassify after reopen;
  - authorize certificate and return branches independently; a source-only user can finish certificate work while an evidence-backed external-return acknowledgement remains. A correction `RECORDED_EXTERNAL` record must name the exact current case/revision/packet hash; wrong-case, stale packet or late slip changes nothing. Late slip/material route changes supersede approval; combined case closes only after every applicable branch is terminal. Direct status mutation is forbidden.
- [ ] Implement scope/revision report snapshot/checksum (including `VAT_PP36`), artifact-only `TaxFilingPackage`, append-only command-idempotent `TaxFilingSubmissionRecord` and typed export response. Store actual submitted/status-effective/recorded times, enforce allowed head transitions and derive scope state; verified acceptance cannot be manually downgraded and rejection needs an explicit successor. Manual external filing requires no generated package. Consume deploy-owned legacy FILED markers without re-entry or false RD verification. Expose last-updated/changed-after-review semantics in the ordinary read model and place raw checksum details in an auditor-only detail object.
- [ ] Implement PP30-only `VatScopeCreditPosition` + complete allocation snapshots keyed company/regime/scope/currency. Settlement/refund/internal transfer/external transition/correction share same-command-first and canonical multi-position CAS. Settlement automatically applies available carry maximally before payment (`N=O-I`, used=min(available,max(N,0)), payable=max(N-available,0), created=max(-N,0)), then permits a new reservation only from resulting available credit; no user choice creates an avoidable payment. A terminal `VatRefundOutcome` alone receives, applies an eligible `EXTERNAL_UNMODELED` non-cash offset, returns, disallows or expires an exact reservation whose origin may be opening/settlement/transfer/external-transition/correction. `OFFSET_APPLIED` may mutate only a proven `EXTERNAL_UNMODELED` liability with exact RD evidence/reviewed counterpart after asserting no current PP30/PP36/PND target; an in-product candidate retains one prefilled no-mutation task. `[LATER] cap.thai_tax.vat_credit_in_product_offset` remains CLOSED and has no OPEN implementation/test in v5.1. The smallest future v6 route is PP30 current-payable principal-only: same-command-first, atomic credit+payable CAS/next heads, non-cash Dr 2137/Cr 1156, no Bank evidence and full REVERSAL/optional REPLACEMENT; PP36/PND are excluded. A raw rejection/withdrawal creates review without position movement. Same-scope PP36/PND never shares credit.
- [ ] Add company-global `VatCreditOutcomeCorrectionCommand` as the replay owner for refund and external-transition outcomes. Target only the current effective ORIGINAL-or-REPLACEMENT leaf, pin its complete artifact hashes/lineage plus every affected current position/allocation version, and atomically emit one full-provable REVERSAL plus optional REPLACEMENT, next positions/projections and both result pointers. A partial residual, stale/nonleaf target or unprovable effect mutates nothing and leaves one prefilled review. Cash that remains true transfers to a DEPOSIT replacement; a proven economic return creates a new WITHDRAWAL target/evidence; only explicit evidence unlink frees a wrong allocation.
- [ ] A zero-credit scope-policy transition is automatic. Nonzero is external-first and owns one versioned `VatScopeTransitionWorkItem`; Finance appends immutable preparation revisions containing matrix/evidence hashes and expected work-item/origin/successor versions, while OWNER/ACCOUNTANT finalizes the exact active revision under `tax.review_issue.resolve + tax.adjustment.approve`. Finalization command/fingerprint lookup on the work item precedes route/position CAS. The evidence-backed external result atomically stores the terminal command/result pointer and canonical normalized immutable terminal-disposition children with exact origin lineage/artifact hash/`cashEffect`; child serialization must equal the retained request snapshot and reviewed matrix hash. `OFFSET_APPLIED` follows the same `EXTERNAL_UNMODELED`-only/no-current-target rule. A REFUNDED ORIGINAL/REPLACEMENT child records tax truth as DEPOSIT first, then uses `TaxCashEvidenceLink`; only a durable-evidence-backed economic REVERSAL is WITHDRAWAL, while classification corrections and every non-cash child are NONE and cannot consume cash evidence. Apply the shared full-provable correction registry/current-leaf rule. After specialist validation, only exact OPEN `cap.thai_tax.vat_scope_credit_transfer/<transitionKind>` may make finalization atomically create one internal `VatCreditScopeTransfer` **instead of** external, consuming globally unique origin-position/allocation snapshots into equal-sum destination legs; that ORIGINAL transfer pins its availability decision, exact route key and generation and is eligible only before external handling starts. The work item accepts one terminal ORIGINAL result kind, so internal/external cannot run sequentially and corrections never switch kind. The UI never asks the user to choose a route or re-enter prepared facts. A missing/closed/sibling route retains the external flow and no old external record converts/replays. The work item/preparation is orchestration evidence, not a mutable transfer draft; neither result claims system RD acceptance.
- [ ] Enforce `externalHandlingStatus` and work-item `externalHandlingHighWaterMark` as one monotonic `NOT_STARTED → IN_PROGRESS → COMPLETED` state machine: every preparation successor carries the maximum and no command may lower it. Finalize deterministically with no route prompt: both values `NOT_STARTED` + exact OPEN route + passing invariants/CAS creates INTERNAL; both `COMPLETED` + valid evidence creates EXTERNAL; every other state mutates nothing and returns the same card with only the unfinished action.
- [ ] Require stored included-source projection IDs/statuses/checksum and opening projection POSTED/SATISFIED before a PP30 settlement Ledger journal clears controls; Tax filing may complete while projection waits. Apply filing-scope branch dimensions: sole HEAD_OFFICE/BRANCH branch; CONSOLIDATED/GROUP uses `branchId=null` + scope unless reviewed equal-sum allocations.
- [ ] Implement PP30 `VatFilingPayablePosition/PaymentOutcome` on one stable `payableRootId` with one CURRENT versioned head across settlement corrections. `mark-paid` resolves/locks the current scope/revision/settlement and rejects a late command naming a superseded settlement. Partial/full tax truth commits before cash evidence; partial remains FILED with derived PARTIALLY_PAID, while zero remaining plus immutable external/RD remittance evidence derives Tax PAID even when cash reconciliation is PENDING and Bank/Ledger is off. Store principal and separately identified surcharge/penalty/interest in one immutable outcome; cash status derives only from the current evidence head so one combined withdrawal can reconcile without re-entry. Ledger debits 2137 only for principal and reviewed expense roles for charges. On corrected payable, carry actual payment to replacement; higher leaves 2137 due, lower routes an exact reviewed 1156 receivable allocation. Each `PAYMENT_REVERSAL` links one prior PAYMENT, bounds each component by its independently unreversed amount and, after corrected-lower, credits exact descendant 2137 + remaining correction-created 1156 principal plus the same charge-expense roles for evidenced returned charges. Add immutable full-payment `TaxFilingPaymentRoot` + append-only status head for PP36/PND; manual→verified successors retain one root/cash link, and full reversal creates one unique opposite root. No PP30 aggregate/semantic role is reused; a separately validated form role may map to the same physical G/L code.
- [ ] Add a payment-preparation read model that never stores an estimate as paid truth: principal; surcharge estimate with `estimateAsOf` and rule source/version; penalty/fine only when evidenced (otherwise unknown, not zero); and final RD amount/reference. Keep these four concepts separate in DTO/export/UI.
- [ ] Implement normalized append-only `TaxCashEvidenceLink/Allocation`: existing immutable refund/payment target first, then a complete confirmed Bank match or exact full posted cash-journal-line set under the persisted canonical target `artifactHash`, expected evidence head and source snapshot/version CAS. `evidenceRef`/legacy `bankEvidenceRef` never makes cash READY. Enforce canonical target cash amount (PP30/PP36/PND includes principal+surcharge+penalty+interest), one source type/account/currency/direction and global CURRENT source-ref uniqueness. Cash projection becomes READY once; Banking/Ledger-off remains friendly. Mark-first→match-later and UI-selected match-at-command are resumable without re-entry. An economic reversal uses a new opposite-direction target/evidence and leaves the original outgoing/receipt match consumed; a supersession with still-true cash transfers the CURRENT link/allocations atomically to the successor; only an explicit corrected-evidence unlink may reverse/free the old allocation after any posted Ledger effect is reversed or current-open-corrected.
- [ ] Make `VatClaimLedgerProjection` a stable-root/versioned-current contract. A resolution correction supersedes an unposted CURRENT head; a posted head receives an exact linked reversal plus current-open replacement. Backfill and close read only the CURRENT head for the active resolution root, including when Tax is off.
- [ ] Implement versioned `TaxLedgerProjection` roots/current heads for settlement, external-scope-transition, refund, PP30 payment and PP36/PND payment, with target hash, legal effective date, accounting-policy snapshot, nullable effective accounting period/posting date until Ledger resolution, exact dependency IDs/checksum, immutable semantic intended lines, status/journal and correction/supersession lineage. Ledger enable appends a resolved OPEN/current-open head; close/backfill reads only the CURRENT head per stable root. No raw nullable journal reference substitutes for this contract.
- [ ] Extend Ledger close checks: when Ledger is enabled, block an accounting period with any CURRENT Ledger-owned effective-period VAT source/opening/settlement/external-scope-transition/refund/payment projection head in PENDING/READY/NEEDS_REVIEW. Ignore `VatClaimTaxProjection=PENDING` solely because Tax is off. Tax-only is unaffected; history encountered after close uses current-open correction/backfill rather than reopen/re-entry.
- [ ] Run Ledger backfill: opening-credit → source final/pending reclass → chronological settlement/internal-or-external scope transition/refund/payment outcomes → linked corrections. Enforce 1156/2137 dependencies; retries/concurrent posting link/no-op, and only OPEN/unreviewed downstream positions auto-recompute.
- [ ] Implement first-demo export files for review JSON, CSV, XLSX, and PDF.
- [ ] If shared export infrastructure is missing, add a minimal tax export writer behind the tax export port. Do not return `export_not_implemented` for item 11 first demo.
- [ ] Add audit events for report review, export/submission record, payment-owned certificate issue/supersession/correction, internal/external scope transition, refund/payment outcome and filing state.

### Tests

- VAT report totals, deterministic maximal carry use (B<net, B=net, B>net, I>O), credit position and filing lifecycle are independently correct per canonical scope/revision.
- Delayed-input-VAT fixture tests cover the ordinary last month and first period after it, required cause/annotation, rule expiry, outer review and employee-name document. After-window facts produce one amendment-review card and no current contribution/write-off; explicit confirmed nonrecoverable is the only write-off route.
- Active filing scopes are disjoint; every eligible contribution appears once, and branch A may be FILED while branch B remains OPEN.
- Scope-policy change with zero credit needs no prompt. Nonzero defaults to evidence-backed external conserved reconciliation even if a different transition kind is OPEN; only the exact validated transition route may apply an equal-sum internal transfer instead of external, before external handling begins, and the winner persists its route decision/generation. Finance's immutable preparation survives handoff and route changes, but final work-item/position CAS is denied without OWNER/ACCOUNTANT `tax.adjustment.approve`. Concurrent internal/external finalization yields one terminal result; the loser returns it, and stale/sibling generations, deltas, re-entry, conversion and replay are rejected.
- Three-period refund chain passes: reserve from settlement/opening/transition in M1, M2 settlement does not reapply outcomes, then exact-reservation cash receipt/`EXTERNAL_UNMODELED` non-cash offset/return-to-available/disallow/expire in M3. An in-product payable offset under `[LATER] cap.thai_tax.vat_credit_in_product_offset` retains facts in one prefilled task and mutates neither credit nor payable; no OPEN path exists in v5.1. A raw rejection/withdrawal changes no position. Same-day terminal outcome vs filing serializes by position version/allocation; PP30 and PP36 same scope stay isolated.
- Refund and external-transition correction tests cover registry lost-response replay, current ORIGINAL and replacement-leaf targets, atomic full REVERSAL + optional REPLACEMENT, concurrent filing, stale/nonleaf and partial/unprovable no-mutation, DEPOSIT evidence transfer, economic WITHDRAWAL and explicit wrong-evidence unlink. Tax-OFF retained-root correction succeeds only under `vat.credit_outcome.correct` with exact outcome/root hash + cutoff and creates no new Tax root/report/filing/contribution; Tax-on final application still requires `tax.adjustment.create|approve`.
- Settlement posting waits for source/opening projections in both normal and backfill flows; HEAD_OFFICE/BRANCH/CONSOLIDATED/GROUP journal dimensions remain isolated.
- PP30 partial/duplicate payment, Tax ON + Bank/Ledger OFF full-payment→PAID with cash pending, stable-payable-root correction and late superseded-settlement rejection, combined principal+charge bank withdrawal, mark-first→match-later, match-at-command retry, target-hash mismatch, legacy evidence without ACTIVE link, concurrent cash links, cross-form evidence reuse, economic reversal with new opposite evidence/original match retained, still-true evidence transfer, explicit wrong-evidence unlink, posted-cash-line exact/reused/partial checks, Banking/Ledger-off→on, component-bounded partial/excess reversal, paid-then-corrected higher/lower and exact corrected-lower 2137/1156/charge reversal pass. PP36/PND manual→verified keeps the same payment root/link; full reversal has one new opposite root, and no PP30 aggregate/role is reused. A validated distinct form role may share physical code only with separate provenance.
- Charge read-model tests separate principal, surcharge estimate-as-of, evidenced penalty and final RD amount; refreshing the estimate mutates no payment root, and unknown penalty is never serialized as zero.
- Ledger close blocks each CURRENT unresolved Ledger-owned VAT source/opening/settlement/external-scope-transition/refund/payment projection head only with Ledger on; POSTED/SATISFIED succeeds, Ledger ON + Tax OFF passes when `VatClaimLedgerProjection` is POSTED even though its Tax projection is PENDING, Tax-only remains usable, and enable-after-closed routes current-open correction.
- Correcting month M may recompute only OPEN/unreviewed successors; if M+1 is already reviewed/filed, it remains immutable and receives a linked correction task.
- VAT report excludes review-needed lines from final totals unless policy includes them explicitly.
- PP36 report uses configured source events and creates blocking issues when source/config facts are missing.
- WHT report groups correctly by PND3/PND53, payee, category, and rate.
- Qualifying payment certificate totals match immutable exact-sum WHT lines and complete/unambiguous effective-template identity/form facts inferred from stored snapshots; TaxEvent/TaxPeriod provenance may be absent and arbitrary selected events cannot issue.
- Zero/no-WHT and invalid positive WHT reserve no number/artifact; source-visible prefilled fact review works with Tax off. Same-command/key reuse, stale active/source snapshot, old/new payee race and partial/multi-line payment pass.
- Each WHT route is tested in isolation: with only `SYSTEM_INITIAL_ISSUE` OPEN settlement may render one SYSTEM original while content correction/copy remain EXTERNAL; with only either later route OPEN it cannot authorize initial issuance or its sibling. Route close follows valid-issued vs number-only-cancel, each fallback remains possible, reopen does not auto-run old work and SYSTEM/EXTERNAL cannot duplicate. Every winner pins the exact route generation; an old queued command after close/reopen fails final availability CAS, while explicit Issue/Reissue receives a fresh generation.
- Standalone source/global-work-hub external link passes source permission + tenant/branch checks with `thai_tax` off; retry creates one task/artifact. Concurrent external-number registration vs next system reservation/Issue preserves one company number and one active payment identity.
- A newly issued/linked certificate PDF creates exactly one immutable ORIGINAL/hash/delivery evidence row and shared-registry-backed append-only command history; every SYSTEM artifact reproduces its stored render-manifest hash and legacy metadata without durable PDF/hash creates no fabricated ORIGINAL. Source-only/retained-after-OFF correction supersedes with a new SYSTEM or EXTERNAL number, source-linked financial correction matches audited payment revision/WHT hash, legacy-unlinked repair uses exact artifact CAS without fabricated identity, and return-only correction does not activate certificate work. OPEN `SYSTEM_REPLACEMENT_COPY` preserves identity/number/statutory-content hash in one replay-safe SYSTEM copy generated from retained counterpart with visible label and issuer certification/signature snapshot; golden fixtures fail separately on label position/overlap, counterpart identity, statutory hash and certification/signature placement. Its CLOSED/missing state creates/replays a replacement-copy handoff and links the certified EXTERNAL copy without system PDF or statutory re-key. EXTERNAL signer evidence succeeds with an immutable legal-actor snapshot even when no matching WatchDog user exists; an optional recorder user remains auditable.
- Submission/payment-head tests distinguish submitted/paid/status-effective/recorded time and actor, accept only allowed origin/status transitions, derive scope status, reject stale heads/manual acceptance downgrade and require an explicit successor after rejection. Legacy filed/paid backfill covers with/without package/timestamp and ambiguous scopes without inventing amount/evidence/Ledger clearing.
- Concurrent/retried correction-case open converges on one nonterminal case/first revision. Draft/submitted-unpaid/filed/external tests cover immutable diff, ป.ป.01 amount/identity allowlist, ป.ป.02 pinned form scope, selected-office checklist/packet manifest, positive additional, PND3/PND53 `ADDITIONAL_NEGATIVE` with `validationDecision=VERIFIED`, `sourceStatus=ACTIVE`, decision/evidence hash/reviewer/checked date/unexpired validity, stable-revision approval, late-slip/channel invalidation and manual `RECORDED_EXTERNAL` bound to the exact case/revision/packet. Submission/receipt/approval-only remain pending; append-only authority outcomes require same-command-first + exact predecessor/packet/policy/evidence hashes, only a policy-listed successful terminal completes, and rejection/withdrawal reopens review. Wrong-case, stale-revision, packet/policy hash mismatch and unverified/retired/expired channel mutate nothing. A CLOSED/unknown tuple retains the packet, requests no re-entry, makes no automated claim and combined-case closure still waits for every branch.
- Review JSON, CSV, XLSX, and PDF exports are generated for supported report types.
- Export snapshot checksum changes when source report changes before filing.
- Export action requires permission and is audited.

### Exit Criteria

- Finance/accountant can prepare VAT/WHT from reproducible source events.
- Review JSON, CSV, XLSX, PDF, and 50 ทวิ PDF outputs exist for first demo.
- Verification evidence proves stale WHT route generations cannot finalize, correction evidence/authority outcomes cannot cross case/revision/packet/policy, `ใบแทน` fixtures are exact, input-VAT timing never auto-writes off, charge estimates never become payment truth, external signer snapshots need no user-account mapping and only OWNER/ACCOUNTANT can finalize a nonzero external VAT transition.

## Phase 5: CIT Calendar and Ledger-Backed Supporting Summaries

### Goal

Use item 10 ledger/accounting period outputs for CIT reminders and supporting data.

### Tasks

- [ ] Implement CIT50 annual due schedule from configurable calendar rule.
- [ ] Implement CIT51 half-year due schedule from configurable calendar rule.
- [ ] Read ledger-backed P&L/accounting summary for selected accounting period.
- [ ] Store `LedgerTaxSummary` or equivalent snapshot with source journal/report refs and checksum.
- [ ] Show revenue, expense, tax expense, profit/loss, and adjustment placeholders as supporting data, not final legal calculation.
- [ ] Add review issues when ledger period is missing, unbalanced, unclosed when policy requires closed period, or report permission/source refs are unavailable.
- [ ] Keep SME tier/rate calculation config-driven and accountant-confirmed before any calculation feature is enabled.

### Tests

- CIT calendar uses company accounting period.
- CIT supporting summary ties to ledger P&L/report source refs.
- Missing ledger data creates review issue instead of zero totals.
- User without ledger/tax permission cannot access CIT summary.

### Exit Criteria

- Owner/accountant sees CIT50/CIT51 reminders and ledger-backed supporting summaries without false filing automation.

## Phase 6: APIs, Workers, Audit, and Outbox

### Goal

Expose permission-protected tax APIs and background reminder flow.

### Tasks

- [ ] Add API controllers/use cases under tax module following repo route conventions.
- [ ] Add endpoints from the spec for profile/config, periods/scopes, sync, VAT/WHT/CIT, source/global-hub certificate discovery/review/correction/replacement-copy handoff, review issues, exports, immutable correction packet/revisions, append-only authority outcomes, submission records, filing/payment status, cash-evidence links, VAT refund/external-transition outcome correction and adjustments. Add an exact correction-packet GET keyed by case/revision; correction `mark-filed` carries expected case/revision/packet/policy hashes into `RECORDED_EXTERNAL` plus nonterminal `SUBMISSION_RECORDED`. Add authority-history GET and outcome POST with expected predecessor. Reuse the surveyed workflow assignment command for `assign-accountant`; controlled packet GET rechecks session, ACTIVE membership, company/branch/case/revision/hash/task permission and audits download. No tax handoff table or anonymous link. Add VAT scope-transition GET, immutable preparation POST and generic finalize POST; the user-facing action never selects internal/external. The MVP correction API prepares/downloads the packet and records external evidence; it does not auto-submit. Period-only aliases require one active scope. Add shared Company Settings VAT-registration GET/PUT plus finance VAT-review GET/resolution POST with expected versions; Tax profile only projects registration.
- [ ] Enforce company/branch/scope membership. Initial SYSTEM 50 ทวิ uses source authorization + exact `SYSTEM_INITIAL_ISSUE`; source settlement never does. SYSTEM content correction and replacement copy check only their exact rows and final route generation. `wht.certificate.read|prepare|correct` and external link follow source visibility or exact retained artifact, not Tax. Certificate/return branches authorize independently. Shared VAT review uses current source visibility or exact retained pre-disable root authority + `finance.vat.review`, masks unrelated facts, works with `thai_tax` off and cannot create a Tax contribution until Tax is on. VAT outcome correction while Tax is ON requires `tax.adjustment.create|approve`; after Tax is OFF it requires `vat.credit_outcome.correct` plus exact retained pre-disable outcome/root hash and cutoff, is correction-only and cannot create a new Tax root/report/filing/contribution. VAT transition preparation uses `tax.review_issue.resolve`; generic finalization additionally requires OWNER/ACCOUNTANT `tax.adjustment.approve`, locks the active preparation/work-item/origin/successor versions and may choose internal only under the exact final route-generation guard before external handling starts.
- [ ] Add same-command-first idempotency/CAS for sync, VAT-registration commands, VAT resolution/Tax/Ledger projection roots, scope/revision export/submission/payment-root/status heads, shared WHT command registry + exact route-generation decision + certificate issue/link/source-or-artifact correction/copy handoff, correction packet/submission/authority-predecessor binding, shared VAT-outcome correction registry/current-leaf full reversal, credit/refund/scope-transition preparation and mutually exclusive internal-or-external finalization, tax cash-evidence head/allocations, stable PP30 payable-root payment/reversal and mark-filed/paid.
- [ ] Add audit logs for every sensitive tax action, authority-status evidence and controlled accountant packet download. Workflow assignment uses existing membership/task audit and changes no tax filing state.
- [ ] Add outbox events for report ready, export generated, filing marked filed/paid, payment-owned certificate issued/superseded/correction state, review issue created/resolved, and due-soon reminder.
- [ ] Add worker job for upcoming/overdue tax obligation reminders if worker/notification primitives exist.
- [ ] If notification primitives are absent, expose reminder query API and document worker backlog.

### Tests

- Missing auth returns `401`.
- Missing permission returns `403`.
- Cross-company source id cannot leak.
- Tax config update requires `tax.config.manage`.
- Shared VAT fact update requires `company.vat_registration.manage`, expectedVersion and audit; works with `thai_tax` off. Source/Ledger VAT review requires `finance.vat.review` and never creates a TaxEvent without Tax.
- Retained-root VAT review after source feature OFF is company/branch/cutoff/hash scoped, masked, can repair only that exact resolution/projection and leaves no Ledger-close dead end; ordinary new source work remains denied.
- Tax-on refund/external-transition outcome correction requires `tax.adjustment.create|approve`. Tax-OFF correction denies those broad Tax keys alone, succeeds only with `vat.credit_outcome.correct` + exact retained pre-disable outcome/root hash/cutoff, and rejects new roots/reports/filings/contributions, stale/nonleaf targets and partial/unprovable reversals without mutation.
- Export requires `tax.report.export`.
- Mark filed/paid requires `tax.filing.mark_filed` or `tax.filing.mark_paid` plus exact scope/revision, caller-stable command/fingerprint, truthful origin, applicable expected head/position/evidence version, actual known external time/amount/reference/evidence and actor/note.
- Manual-first correction packet/evidence works with every automated tuple CLOSED, without generating an export or re-keying stored facts, and displays “ระบบไม่ได้ยื่นหรือยืนยันการรับแบบ”. Packet GET returns the immutable attachment/hash for the exact case/revision; `mark-filed` binds the resulting `RECORDED_EXTERNAL` submission to that packet, and wrong-case/stale/hash-mismatch input changes nothing. `ADDITIONAL_NEGATIVE` also requires `validationDecision=VERIFIED`, `sourceStatus=ACTIVE`, the exact persisted decision/evidence hash/reviewer/checked date and unexpired validity. Only the exact independently OPEN tuple plus a verified RD/provider response may later claim RD acceptance; opening it never resubmits/reclassifies an existing `RECORDED_EXTERNAL` record.
- ป.ป.01/ป.ป.02 endpoint tests reject out-of-form eligibility and stale selected-office checklist/manifest. Authority POST rejects stale predecessor or wrong case/revision/packet/policy/evidence hash; submission/receipt never closes, only the server-derived policy terminal effect completes, and rejection/withdrawal reopens review. Negative e-Filing acceptance never completes payment/refund/ค.10.
- Accountant assignment accepts only an invited ACTIVE company member/ACCOUNTANT with current branch/domain permission through the existing workflow seam. Anonymous, cross-company, expired-session, revoked-member, wrong-revision/hash and unassigned controlled downloads fail without leaking metadata; a valid download is audited and none of assign/accept/download/return changes submission or authority state.
- Scope A mark-filed/paid never changes scope B; a period-only call with multiple scopes returns `409`.
- Handoff/certificate discovery under `wht.certificate.read`, missing-fact review and certificate-only correction work from source/global hub with Tax off; compatibility POST cannot create from selected TaxEvents, and void classifies under `wht.certificate.correct` without direct mutation. Only exact OPEN `SYSTEM_REPLACEMENT_COPY` renders one SYSTEM `ใบแทน`; its CLOSED/missing row renders no system PDF and replays one external-copy handoff/link regardless of sibling state.
- SYSTEM WHT finalization rejects a stale route-generation decision after close/reopen and asserts the identical complete `availabilityDecisionRef + systemRouteKey + routeGeneration` tuple on the command, artifact, render manifest and outbox result. EXTERNAL certification accepts a legal-actor snapshot without requiring that signer to be a WatchDog user.
- VAT transition GET returns Finance's immutable active preparation unchanged to OWNER/ACCOUNTANT. Prepare without `tax.adjustment.approve` succeeds, but finalize returns `403`; authorized finalization applies exactly once under work-item/origin/successor versions. Tests assert the monotonic work-item high-water mark cannot be lowered: exact OPEN + both `NOT_STARTED` converges on INTERNAL, both `COMPLETED` + valid evidence converges on EXTERNAL, while `IN_PROGRESS`, mismatch, stale route/evidence or failed CAS mutates nothing. Concurrent finalizers still converge on one result and a later route OPEN never converts it.
- Worker reminder is idempotent and does not send duplicate alerts for same period/window.

### Exit Criteria

- Web and AI can consume tax functions only through permission-checked APIs/tools.
- Sensitive actions are audited and export/status events are traceable.
- API evidence links every SYSTEM WHT mutation to one identical `availabilityDecisionRef + systemRouteKey + routeGeneration` tuple across command, artifact, render manifest and outbox result; every manual correction submission/authority outcome to one exact packet/policy revision; every controlled accountant download to a current invited membership/task and audit event without a new tax aggregate; and every VAT transition preparation/final result to one OWNER/ACCOUNTANT-approved immutable revision with monotonic external-handling state and a mutually exclusive result kind.

## Phase 7: Web Tax Workspace

### Goal

Add finance/accountant tax preparation screens.

### Tasks

- [ ] Add Tax navigation under finance/accounting area using Web Core conventions.
- [ ] Add the permission-filtered global **งานที่ต้องทำให้จบ** surface with Finance section **งานบัญชีและภาษีที่ต้องดำเนินการ**. Deduplicate one source/global card per deterministic business issue; show what happened, all prepared facts, one primary action, consequence of waiting, evidence/history and status. Keep the same card when SYSTEM falls back to EXTERNAL, ask only for missing input and hide route/gate/generation/CAS/projection terms. Reuse existing work-card/task assignment for an ACTIVE invited accountant; never add a public share link or tax-owned handoff state. A nonzero VAT scope transition always shows the same immutable preparation revision, conserved matrix/evidence and one approval action; Finance's work survives handoff and the server applies the deterministic terminal rule, so the user never chooses a route or re-enters evidence.
- [ ] Add Tax dashboard with upcoming obligations, overdue items, review issues, VAT payable/refund summary, WHT pending summary, and CIT calendar.
- [ ] Add VAT report screen with friendly period + filing-scope selector, output/input tabs, scope credit summary, source refs, review issues, recompute, review, and export actions. Hide technical scope IDs; preselect the only scope. A delayed-input card shows ordinary last month/cause/annotation while current claim is valid, then switches to one original-period accountant-review action. Employee-name documents show “ขอใบกำกับภาษีฉบับแก้ไขเป็นชื่อบริษัท” as primary and explicit nonrecoverable confirmation as secondary/high-risk.
- [ ] Add WHT report screen with PND3/PND53 tabs, payee grouping, certificate refs, source refs, review issues, and export actions.
- [ ] Add payment-linked 50 ทวิ list/detail/delivery plus prefilled exception and immutable correction/supersession flow. Do not expose arbitrary TaxEvent selection or direct issue/void actions.
- [ ] Add CIT calendar/supporting summary screen with ledger source refs and disclaimer/confirmation status.
- [ ] Add Tax config screen for company tax profile, tax year config, calendar rules, rates/categories, and verification checklist.
- [ ] Add Filing status screen/panel for immutable manual/system/legacy filed/paid/accepted/rejected evidence. Resolve exact scope/revision automatically, prefill known timestamps/amount/reference/evidence, show external/status-effective time separately from recorded time, submit expected head/position/evidence version, forbid manual RD-accepted claims/downgrades and guide rejection to a successor correction. Separate principal, surcharge “ประมาณการถึงวันที่ …”, evidenced penalty and final RD amount/reference; unknown penalty is “ยังไม่ทราบ”, not zero. A user supplies only genuinely missing evidence; never expose a status-only migration form.
- [ ] Add the filed/external WHT correction journey: immutable before/after, plain-language classified route, versioned eligibility/local-office checklist and immutable packet manifest/download, one stable-revision approval and external receipt/evidence capture bound to that packet. After submission show “ส่งแล้ว—รอผลจากสรรพากร”; map append-only authority history to a simple timeline and close only on the exact policy terminal status. Show negative-additional channel checked date, reviewer and verification status when applicable and keep payment/refund/ค.10 as separate branches. “ส่งให้นักบัญชี” assigns the same card through existing ACTIVE membership/workflow and controlled download; it never says filed.
- [ ] Replace raw checksum copy in ordinary screens with “ข้อมูลล่าสุดเมื่อ …”, “ไม่มีรายการเปลี่ยนหลังตรวจ” or “ข้อมูลเปลี่ยนหลังตรวจ—กรุณาตรวจอีกครั้ง”. Put checksum/algorithm/component ids under permission-filtered auditor detail.
- [ ] Add forbidden, readonly, loading, empty, stale-snapshot, review-needed, export-not-implemented, and closed-period states.
- [ ] Deep link source refs to accounting documents, expenses, payments, ledger reports, and period close screens when routes exist.

### Tests

- Web typecheck passes.
- Permission-filtered nav hides mutation/export/config actions.
- VAT/WHT screens show source-linked totals.
- Review issue state blocks export when policy says blocking.
- Mark filed/paid action confirms the prefilled exact scope/revision, truthful origin, actual known external time/amount/reference/evidence, actor/note and expected head/position; stale CAS or missing required evidence is actionable, and no status-only note form exists.
- One business issue appears as one card across source/global entry points. A CLOSED SYSTEM route changes its primary action to the matching EXTERNAL fallback without losing data; opening later does not auto-run the old card and explicit Issue/Reissue gets a fresh route generation.
- A nonzero VAT transition never exposes internal/external controls: the same immutable preparation revision, matrix and uploaded evidence survive handoff/route changes; Finance can prepare, OWNER/ACCOUNTANT sees one final approval, and exactly one result kind is shown without re-entry.
- Correction packet download and evidence capture stay on one card and one case/revision/hash; stale evidence returns to the same prefilled card without losing stored facts.
- Delayed-input/employee-document cards keep all stored facts, show one primary next action and never expose current claim after the ordinary window or choose nonrecoverable implicitly.
- Correction submission/receipt remains visibly pending until the policy terminal outcome. Accountant assignment/download has no anonymous URL and creates no filed state. Principal, estimate-as-of surcharge, evidenced penalty and final RD amount are distinct at 40+ readable sizes, and ordinary freshness copy contains no checksum jargon.
- Mobile/desktop screens do not overlap or truncate finance-critical numbers.

### Exit Criteria

- Finance/accountant can prepare and review Thai tax reports in web without database access.
- Users complete each delayed-VAT review, WHT correction or nonzero VAT transition from one prefilled card, without route selection, signer-user mapping, checksum jargon or repeated data entry; accountant handoff reuses secure existing membership/workflow and never implies filing.

## Phase 8: AI Tax and LINE Read-Only Integration

### Goal

Let LINE AI answer tax questions safely from implemented tax APIs.

### Tasks

- [ ] Add ERP read tools:
  - `tax.get_upcoming_tax_obligations`
  - `tax.get_vat_summary`
  - `tax.get_wht_summary`
  - `tax.get_cit_calendar`
  - `tax.list_missing_tax_documents`
- [ ] Register tools in AI Gateway allowlist only for users with matching tax read permissions.
- [ ] Return source refs, derived period aggregate plus authoritative filing-scope status, verification status, and web deep links.
- [ ] Include `permissionChecked: true` in source refs where current AI contract uses it.
- [ ] Add LINE answer formatting for short reminders/summaries.
- [ ] Refuse export, filing, config change, certificate issue, adjustment, or mark-filed/paid requests from LINE.
- [ ] AI Tax must state when data is incomplete or RD/accountant confirmation is needed.
- [ ] Audit sensitive tax AI tool invocations according to permission matrix.

### Tests

- Unauthorized LINE user receives safe refusal without hidden-record counts.
- AI Tax VAT summary includes source refs and the authoritative filing-scope status (not only the period aggregate).
- AI Tax WHT summary does not reveal restricted payee detail without permission.
- AI Tax refuses filing/export/config mutation requests.
- Unsupported or unverified rule question returns uncertainty with web/accountant path.

### Exit Criteria

- LINE can show reminders and summaries only.
- AI Tax cannot mutate tax, ledger, accounting, filing, export, permission, or payment state.

## Verification Commands

Run actual commands matching repo scripts after implementation. Minimum expected checks:

```text
pnpm --filter @watchdog-bms/contracts typecheck
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/web typecheck
pnpm --filter @watchdog-bms/ai-gateway typecheck
pnpm --filter @watchdog-bms/workers typecheck
pnpm test
```

If current package scripts differ, record exact commands used and exact skipped-test reasons.

## Risks

- Tax law/form/export formats change. Mitigation: config-driven rules, verification checklist, source URL/date/reviewer metadata, and release gate.
- Source modules may not expose enough tax fields. Mitigation: Phase 0 gap list and review issues rather than guessed values.
- Ledger reports may not be ready or closed. Mitigation: document-only VAT/WHT can proceed, but CIT supporting summaries must show missing ledger status.
- Branch/VAT reporting details may vary by filing policy. Mitigation: canonical immutable scope snapshot, disjoint event partition and specialist-reviewed external rules; never derive identity from raw legacy labels.
- A filing-scope change with accumulated VAT credit may need case-specific external handling, and an internal route opening mid-work could otherwise double-consume it. Mitigation: zero-credit changes are automatic; nonzero is external-first with one stable work item and immutable preparation revisions. Final CAS writes one mutually exclusive INTERNAL or EXTERNAL ORIGINAL result; only an exact specialist-validated transition row may select internal before external handling starts, no sibling opens it and no delta disappears, converts or is inferred.
- Applying a VAT refund/credit to an existing in-product payable without one atomic contract could consume credit and payable inconsistently or twice. Mitigation: `[LATER] cap.thai_tax.vat_credit_in_product_offset` remains CLOSED throughout v5.1, retains all facts in one prefilled no-mutation task, and requires a separately confirmed v6 PP30 principal-only atomic contract before any OPEN implementation.
- Treating the RD Prep portal or generic API catalog as proof that every amendment is automatable could create false filing/acceptance claims. Mitigation: manual-first packet/evidence is the baseline; automation opens only per exact form/route/channel evidence and `ADDITIONAL_NEGATIVE` never implies refund entitlement.
- Treating six months as an absolute input-VAT expiry could cause a wrong current-period claim or premature write-off. Mitigation: persist separate ordinary last month and outer review date; after the ordinary window only a prefilled original-period review is available, and nonrecoverable is explicit.
- Treating ป.ป.01/ป.ป.02 receipt as successful correction could close a case before RD updates its records. Mitigation: versioned form eligibility/local-office manifest plus append-only authority outcomes; only the exact route-policy successful terminal status completes the return branch.
- A public accountant link or tax-owned parallel assignment model could leak packets and duplicate membership/workflow truth. Mitigation: reuse invited ACTIVE company membership and the surveyed work-card/task seam; every controlled download reauthorizes exact company/branch/revision/hash and is audited, with no anonymous URL or filing side effect.
- A surcharge estimate or checksum-heavy UI could mislead nontechnical users. Mitigation: separate principal/estimate-as-of/evidenced penalty/final RD amount and show plain freshness copy; raw checksums remain auditor detail.
- Reopening a WHT SYSTEM route could let a queued old command issue under a new launch state. Mitigation: persist and final-CAS the exact route generation; explicit Issue/Reissue obtains a fresh decision.
- A correction receipt could be attached to the wrong case or stale packet. Mitigation: immutable packet attachment/hash plus exact case/revision binding on the submission record.
- Export infrastructure may not exist. Mitigation: implement minimal tax-owned export writer for review JSON, CSV, XLSX, and PDF behind an export port.

## Resolved Owner Decisions

- Tax reviewer is ACCOUNTANT.
- First demo must generate review JSON, CSV, XLSX, and PDF.
- ภ.พ.36 is MVP scope.
- 50 ทวิ must store data/export metadata and generate PDF in item 11.
- 50 ทวิ initial issuance is source-payment-owned, multi-line and idempotent. Three hidden WHT SYSTEM routes open independently for initial issue, content correction and replacement copy; each CLOSED/missing route keeps its own EXTERNAL fallback. Payment/fact review and certificate-only work remain source-visible with Tax off. Every SYSTEM PDF has a reproducible render manifest and exact route-generation decision; certification stores the legal actor snapshot without requiring that signer to be a WatchDog user.
- Filed/external WHT correction is manual-first and classifies stored facts into one immutable prefilled packet/checklist with stable-revision approval and exact submission binding. PND3/53 negative additional requires a VERIFIED channel decision with reviewer/evidence; refund/ค.10 is separate and automation is not assumed.
- Delayed input VAT uses three explicit routes: current-period delayed only within the ordinary window with cause/annotation, original-period amendment review afterward while potentially available, and explicit confirmed nonrecoverable only. Employee-name documents first request a corrected company tax invoice without re-entry.
- ป.ป.01/ป.ป.02 eligibility and selected-office channel/packet requirements are versioned. Submission/receipt never closes correction; exact policy terminal authority evidence does. `ใบแทน` must pass label-position/counterpart/statutory-content/signature golden fixtures.
- Accountant handoff reuses ACTIVE invited company membership and the existing workflow/work-card seam with controlled audited download; no tax handoff model or anonymous URL. User UI separates charge concepts and uses plain freshness/change language, with checksums under auditor detail.
- Zero VAT credit moves automatically across scope policy. Nonzero is external-first; Finance prepares one immutable matrix/evidence revision, OWNER/ACCOUNTANT performs one final approval, and the user never chooses the implementation route or re-enters evidence. One work item records exactly one INTERNAL or EXTERNAL ORIGINAL result; internal is optional only per exact specialist-validated transition kind and only before external handling starts.
- In-product VAT credit-to-payable offset is independently owned by `[LATER] cap.thai_tax.vat_credit_in_product_offset`; it is CLOSED throughout v5.1 and means one prefilled no-mutation task, not a customer migration or re-entry form. The smallest future v6 scope is PP30 current principal only.
- Seed all WHT categories/rates as configurable rows; keep them inactive or review-gated until accountant verification.
