import type { AccountingOutputTaxCode } from './accounting-documents.js';

// ─── Enums ───────────────────────────────────────────────────────────────────

export type TaxType = 'VAT' | 'WHT' | 'CIT' | 'CUSTOMS';

export type VatFormType = 'PP30' | 'PP36';
export type WhtFormType = 'PND3' | 'PND53';
export type CitFormType = 'PND50' | 'PND51';
export type CustomsFormType = 'CUSTOMS_SUPPORT';
export type TaxFormType = VatFormType | WhtFormType | CitFormType | CustomsFormType;

export type TaxPeriodType = 'MONTHLY' | 'ANNUAL' | 'HALF_YEAR';

export type TaxRuleStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';

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
  | 'VAT_REVIEW'
  | 'CUSTOMS_ASSESSED'
  | 'WHT_PND3'
  | 'WHT_PND53';

export type TaxEventStatus = 'ACTIVE' | 'SUPERSEDED' | 'REVERSED' | 'EXCLUDED';

export type FilingPackageStatus =
  | 'GENERATED'
  | 'DOWNLOADED'
  | 'VOIDED'
  | 'ACCEPTED_MANUAL'
  | 'REJECTED_MANUAL';

export type ReviewIssueSeverity = 'INFO' | 'WARNING' | 'BLOCKING';

export type ReviewIssueStatus = 'OPEN' | 'RESOLVED' | 'IGNORED';

export type WhtCertificateStatus = 'DRAFT' | 'ISSUED' | 'VOIDED';

export type TaxExportFormat = 'REVIEW_JSON' | 'CSV' | 'XLSX' | 'PDF';

export type TaxAdjustmentType = 'CORRECTION' | 'REVERSAL' | 'AMENDED';

// ─── Source reference ─────────────────────────────────────────────────────────

export type TaxSourceRef = {
  sourceType: string;
  sourceId: string;
  sourceEventType?: string;
  permissionChecked: boolean;
};

// ─── Company Tax Profile ──────────────────────────────────────────────────────

export type CompanyTaxProfileDto = {
  id: string;
  companyId: string;
  taxId: string | null;
  vatRegistered: boolean;
  vatEffectiveDate: string | null;
  branchPolicy: 'HEAD_OFFICE_ONLY' | 'ALL_BRANCHES' | 'SELECTED_BRANCHES';
  accountingPeriodMonth: number;
  taxReviewerRole: string;
  notes: string | null;
  updatedAt: string;
};

export type UpdateCompanyTaxProfileDto = {
  taxId?: string;
  vatRegistered?: boolean;
  vatEffectiveDate?: string;
  branchPolicy?: CompanyTaxProfileDto['branchPolicy'];
  accountingPeriodMonth?: number;
  taxReviewerRole?: string;
  notes?: string;
};

// ─── Tax Rule Source ──────────────────────────────────────────────────────────

export type TaxRuleSourceDto = {
  id: string;
  companyId: string | null;
  sourceUrl: string;
  sourceTitle: string;
  checkedAt: string;
  checkedBy: string;
  note: string | null;
};

// ─── Tax Year Config ──────────────────────────────────────────────────────────

export type TaxYearConfigDto = {
  id: string;
  companyId: string | null;
  year: number;
  status: TaxRuleStatus;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string | null;
};

// ─── Tax Rate Config ──────────────────────────────────────────────────────────

export type TaxRateConfigDto = {
  id: string;
  taxYearConfigId: string;
  taxType: TaxType;
  code: string;
  description: string;
  rate: string;
  cap: string | null;
  conditionJson: Record<string, unknown> | null;
  status: TaxRuleStatus;
  sourceRuleId: string | null;
};

// ─── Tax Calendar Rule ────────────────────────────────────────────────────────

export type TaxCalendarRuleDto = {
  id: string;
  taxYearConfigId: string;
  formType: TaxFormType;
  periodType: TaxPeriodType;
  dueRuleJson: Record<string, unknown>;
  onlineExtensionJson: Record<string, unknown> | null;
  status: TaxRuleStatus;
  sourceRuleId: string | null;
};

// ─── Tax Period ───────────────────────────────────────────────────────────────

export type TaxPeriodDto = {
  id: string;
  companyId: string;
  taxType: TaxType;
  formType: TaxFormType;
  periodKey: string;
  status: TaxPeriodStatus;
  dueDate: string | null;
  filedAt: string | null;
  paidAt: string | null;
  reviewNote: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ─── Tax Event ────────────────────────────────────────────────────────────────

export type TaxEventDto = {
  id: string;
  companyId: string;
  branchId: string | null;
  taxPeriodId: string;
  eventType: TaxEventType;
  status: TaxEventStatus;
  sourceType: string;
  sourceId: string;
  sourceEventType: string | null;
  sourceHash: string | null;
  periodKey: string;
  eventDate: string;
  taxableBase: string;
  taxAmount: string;
  currency: string;
  vatMode: string | null;
  outputTaxCode: AccountingOutputTaxCode | null;
  sourceLineId: string | null;
  componentKey: import('./transaction-tax.js').TransactionTaxComponentPreview['componentKey'] | null;
  taxSnapshot: import('./transaction-tax.js').TransactionTaxSnapshot | null;
  reportContributions: import('./transaction-tax.js').TaxReportContribution[];
  whtFormType: WhtFormType | null;
  payeeSnapshot: PayeeSnapshot | null;
  incomeCategoryCode: string | null;
  whtRate: string | null;
  grossAmount: string | null;
  withheldAmount: string | null;
  netPaidAmount: string | null;
  taxInvoiceNumber: string | null;
  reviewNote: string | null;
  createdAt: string;
};

export type PayeeSnapshot = {
  name: string;
  taxId: string | null;
  address: string | null;
  branchCode: string | null;
};

// ─── WHT Income Category ──────────────────────────────────────────────────────

export type WhtIncomeCategoryDto = {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string | null;
  formType: WhtFormType;
  defaultRate: string;
  status: TaxRuleStatus;
  conditionNote: string | null;
  sourceRuleId: string | null;
};

// ─── VAT Report ───────────────────────────────────────────────────────────────

export type VatReportDto = {
  id: string;
  companyId: string;
  periodId: string;
  formType: VatFormType;
  periodKey: string;
  outputVatTotal: string;
  inputVatTotal: string;
  netVatPayable: string;
  reviewNeededTotal: string;
  lineCount: number;
  reviewIssueCount: number;
  checksum: string | null;
  snapshotAt: string | null;
  sourceRefs: TaxSourceRef[];
  pp30Boxes?: import('./transaction-tax.js').Pp30BoxesDto;
};

export type VatReportLineDto = {
  taxEventId: string;
  eventType: TaxEventType;
  eventDate: string;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  taxInvoiceNumber: string | null;
  taxableBase: string;
  taxAmount: string;
  outputTaxCode: AccountingOutputTaxCode | null;
  included: boolean;
  reviewNote: string | null;
  sourceRef: TaxSourceRef;
  sourceLineId?: string | null;
  componentKey?: import('./transaction-tax.js').TransactionTaxComponentPreview['componentKey'] | null;
  taxSnapshot?: import('./transaction-tax.js').TransactionTaxSnapshot | null;
  reportContributions?: import('./transaction-tax.js').TaxReportContribution[];
};

// ─── WHT Report ───────────────────────────────────────────────────────────────

export type WhtReportDto = {
  id: string;
  companyId: string;
  periodId: string;
  formType: WhtFormType;
  periodKey: string;
  totalGross: string;
  totalWithheld: string;
  payeeGroupCount: number;
  reviewIssueCount: number;
  checksum: string | null;
  snapshotAt: string | null;
  sourceRefs: TaxSourceRef[];
};

export type WhtPayeeGroupDto = {
  payeeName: string;
  payeeTaxId: string | null;
  incomeCategoryCode: string;
  /** Null when only an amount is known or the source carries mixed rates; never implies 0%. */
  whtRate: string | null;
  totalGross: string;
  totalWithheld: string;
  totalNetPaid: string;
  certificateNumbers: string[];
  taxEventIds: string[];
};

// ─── 50 ทวิ Certificate ───────────────────────────────────────────────────────

export type WhtCertificateDto = {
  id: string;
  companyId: string;
  certificateNumber: string;
  status: WhtCertificateStatus;
  taxPeriodId: string;
  periodKey: string;
  payeeSnapshot: PayeeSnapshot;
  payerSnapshot: PayerSnapshot;
  incomeCategoryCode: string;
  incomeCategoryName: string;
  whtRate: string;
  grossAmount: string;
  withheldAmount: string;
  paymentDate: string;
  taxEventIds: string[];
  pdfAttachmentId: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
};

export type PayerSnapshot = {
  companyName: string;
  taxId: string | null;
  branchCode: string | null;
  address: string | null;
};

export type CreateWhtCertificateDto = {
  taxPeriodId: string;
  incomeCategoryCode: string;
  whtRate: string;
  grossAmount: string;
  withheldAmount: string;
  paymentDate: string;
  payeeSnapshot: PayeeSnapshot;
  taxEventIds: string[];
};

// ─── 50 ทวิ Correction & Replacement ──────────────────────────────────────────
//
// Correction & replacement plan §2.2: fields a "แก้ไขหนังสือรับรอง" submission may override. Every
// field optional — a value the caller omits keeps the current certificate's own value (the use case
// merges before validating, never derives from SupplierPayment/ExpenseRecord).

export type WhtCertificateCorrectionInput = {
  formType?: WhtFormType;
  incomeCategoryCode?: string;
  incomeCategoryName?: string;
  whtRate?: string;
  grossAmount?: string;
  withheldAmount?: string;
  paymentDate?: string;
  payerSnapshot?: Partial<PayerSnapshot>;
  payeeSnapshot?: Partial<PayeeSnapshot>;
};

export type CorrectWhtCertificateDto = {
  corrected: WhtCertificateCorrectionInput;
  reason: string;
};

// ─── 50 ทวิ External Handoff (H4) ─────────────────────────────────────────────
//
// While `cap.wht50bis/SYSTEM_INITIAL_ISSUE` is CLOSED the system issues no certificate.
// Instead it persists a durable, prefilled handoff so the operator can have the 50 ทวิ
// issued externally (accountant/RD) and link it back — never a bare 409.
// Spec: feature-entitlement-decoupling-spec.md:205, tax-thailand-2026-spec.md:1324-1343.

/** tax-thailand-2026-spec.md:1332 — exactly these four values. */
export type WhtHandoffStatus = 'REQUIRED' | 'EXTERNAL_LINKED' | 'SYSTEM_ISSUED' | 'CANCELLED';

/**
 * The statutory field set the handoff must carry so nothing is re-keyed
 * (tax-thailand-2026-spec.md:1389). Fields the system cannot truly derive stay null —
 * a prefill is never fabricated (spec:208).
 */
export type WhtHandoffPrefillDto = {
  payerSnapshot: PayerSnapshot;
  payeeSnapshot: PayeeSnapshot;
  formType: WhtFormType | null;
  incomeCategoryCode: string | null;
  incomeCategoryName: string | null;
  whtRate: string | null;
  grossAmount: string;
  withheldAmount: string;
  paymentDate: string;
};

export type WhtCertificateHandoffDto = {
  id: string;
  companyId: string;
  status: WhtHandoffStatus;
  sourcePaymentType: string | null;
  sourcePaymentId: string | null;
  payeeId: string | null;
  /** The PAYEE's tax branch code (certificate prefill). */
  branchCode: string | null;
  /** The internal branch that made the payment. Attribution/filtering only, not authorization. */
  sourceBranchId: string | null;
  sourceFeatureKey: string;
  taxPeriodId: string | null;
  taxEventIds: string[];
  prefill: WhtHandoffPrefillDto;
  /**
   * §10: the payee address, typed on the handoff screen when the frozen prefill has none. A
   * sibling of `prefill`, never a field inside it — `prefillSnapshotHash` guards that snapshot so
   * the facts the operator copies cannot drift, and readers must prefer this over
   * `prefill.payeeSnapshot.address`.
   */
  payeeAddress: string | null;
  payeeAddressAt: string | null;
  payeeAddressByUserId: string | null;
  externalCertificateNumber: string | null;
  externalEvidenceRef: string | null;
  externalIssuedDate: string | null;
  linkNote: string | null;
  linkedAt: string | null;
  linkedByUserId: string | null;
  /** Set once SYSTEM-issued (status SYSTEM_ISSUED) — the WhtCertificate row this handoff minted. */
  certificateId: string | null;
  /**
   * WHT certificate system issuance plan §2.4: whether `cap.wht50bis/SYSTEM_INITIAL_ISSUE` is OPEN,
   * computed once per request so the AP/Expenses "ออกเอกสารในระบบ" button can decide to show/hide
   * without an extra fetch. On `list`/`get` only — additive, defaults to false elsewhere.
   */
  systemIssuanceOpen: boolean;
  /**
   * Correction & replacement plan §2.4: whether `cap.wht50bis/SYSTEM_CONTENT_CORRECTION` /
   * `SYSTEM_REPLACEMENT_COPY` are OPEN, computed once per request exactly like `systemIssuanceOpen`
   * above. On `list`/`get` only — additive, defaults to false elsewhere.
   */
  systemCorrectionOpen: boolean;
  systemReplacementOpen: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * §7/§8: what the counterparty-registry side effect of a payee-address write did. Present on
   * that write's response only, never on a read and never persisted — it drives one confirmation
   * line or the "ยังไม่ได้บันทึกลงทะเบียนคู่ค้า" bar.
   */
  counterpartyAutoSave?: import('./accounting-documents.js').VendorCounterpartyAutoSaveResult;
};

/** §10: the operator supplies the missing payee address on a handoff still awaiting its document. */
export type SetWhtHandoffPayeeAddressDto = { payeeAddress: string };

/** Same 500-character ceiling as `ExpenseRecord.vendorAddressSnapshot` (§6). */
export const WHT_HANDOFF_PAYEE_ADDRESS_MAX = 500;

export type LinkExternalWhtCertificateDto = {
  commandId: string;
  externalCertificateNumber: string;
  externalEvidenceRef: string;
  issuedDate: string;
  note?: string;
};

/**
 * WHT certificate system issuance plan §3.3 (Decision B): OWNER-only
 * (`company.tax_signature.manage`), separate from issuing a certificate. `signatureAttachmentId`
 * comes from the generic `companies/:companyId/attachments/{upload-intent,:id/complete}` flow —
 * no dedicated upload endpoint for this feature. v1 is signature-only; no seal field exists.
 */
export type UpdateCompanyTaxSignatureDto = {
  signatureMode: 'BLANK' | 'AUTO_STAMP';
  signatureAttachmentId?: string;
};

/** 409 body of POST tax/wht-certificates while the SYSTEM route is CLOSED. */
export type WhtSystemIssuanceUnavailableBody = {
  code: 'wht_system_issuance_unavailable';
  fallback: 'EXTERNAL_CERTIFICATE_REQUIRED';
  message: string;
  handoffId: string;
  handoffStatus: WhtHandoffStatus;
};

// ─── CIT Calendar / Supporting Summary ───────────────────────────────────────

export type CitCalendarEntryDto = {
  formType: CitFormType;
  periodKey: string;
  accountingPeriodId: string | null;
  dueDate: string | null;
  onlineExtensionDueDate: string | null;
  status: TaxPeriodStatus | null;
  hasLedgerSummary: boolean;
};

export type CitSupportingSummaryDto = {
  id: string;
  companyId: string;
  taxPeriodId: string;
  accountingPeriodId: string | null;
  revenueTotal: string;
  expenseTotal: string;
  profitLoss: string;
  taxExpenseTotal: string;
  ledgerReportRef: string | null;
  snapshotAt: string | null;
  disclaimer: string;
  missingLedger: boolean;
};

// ─── Tax Filing Package ───────────────────────────────────────────────────────

export type TaxFilingPackageDto = {
  id: string;
  companyId: string;
  taxPeriodId: string;
  formType: TaxFormType;
  periodKey: string;
  exportNumber: string;
  status: FilingPackageStatus;
  exportFormat: TaxExportFormat;
  attachmentId: string | null;
  checksum: string | null;
  generatedAt: string;
  downloadedAt: string | null;
  voidedAt: string | null;
  filedManuallyAt: string | null;
  filedManuallyNote: string | null;
  createdAt: string;
};

export type GenerateFilingPackageDto = {
  taxPeriodId: string;
  exportFormat: TaxExportFormat;
};

// ─── Tax Review Issue ─────────────────────────────────────────────────────────

export type TaxReviewIssueDto = {
  id: string;
  companyId: string;
  taxPeriodId: string;
  taxEventId: string | null;
  severity: ReviewIssueSeverity;
  status: ReviewIssueStatus;
  issueCode: string;
  description: string;
  sourceRef: TaxSourceRef | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
  createdAt: string;
};

// ─── Tax Adjustment ───────────────────────────────────────────────────────────

export type TaxAdjustmentDto = {
  id: string;
  companyId: string;
  taxPeriodId: string;
  adjustmentType: TaxAdjustmentType;
  reason: string;
  adjustedByUserId: string;
  adjustedAt: string;
  metadataJson: Record<string, unknown> | null;
};

// ─── Tax Verification Checklist ───────────────────────────────────────────────

export type TaxVerificationChecklistDto = {
  id: string;
  companyId: string | null;
  taxYearConfigId: string;
  item: string;
  status: 'PENDING' | 'VERIFIED' | 'FAILED' | 'SKIPPED';
  reviewer: string | null;
  reviewedAt: string | null;
  note: string | null;
};

// ─── AI Tax Tool responses ────────────────────────────────────────────────────

export type TaxUpcomingObligationsResult = {
  obligations: {
    formType: TaxFormType;
    periodKey: string;
    dueDate: string | null;
    status: TaxPeriodStatus | null;
    overdue: boolean;
    webLink: string | null;
  }[];
  windowDays: number;
  permissionChecked: true;
  disclaimer: string;
};

export type TaxVatSummaryResult = {
  periodKey: string;
  formType: VatFormType;
  status: TaxPeriodStatus | null;
  outputVatTotal: string;
  inputVatTotal: string;
  netVatPayable: string;
  reviewIssueCount: number;
  sourceRefs: TaxSourceRef[];
  permissionChecked: true;
  disclaimer: string;
  webLink: string | null;
};

export type TaxWhtSummaryResult = {
  periodKey: string;
  formType: WhtFormType;
  status: TaxPeriodStatus | null;
  totalGross: string;
  totalWithheld: string;
  payeeGroupCount: number;
  reviewIssueCount: number;
  sourceRefs: TaxSourceRef[];
  permissionChecked: true;
  disclaimer: string;
  webLink: string | null;
};

export type TaxCitCalendarResult = {
  entries: CitCalendarEntryDto[];
  permissionChecked: true;
  disclaimer: string;
};

export type TaxMissingDocumentsResult = {
  issues: {
    issueCode: string;
    description: string;
    severity: ReviewIssueSeverity;
    periodKey: string | null;
    sourceRef: TaxSourceRef | null;
  }[];
  permissionChecked: true;
  disclaimer: string;
};

// ─── Query/list types ─────────────────────────────────────────────────────────

export type ListTaxPeriodsQuery = {
  taxType?: TaxType;
  formType?: TaxFormType;
  status?: TaxPeriodStatus;
  periodKey?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedTaxPeriodsDto = {
  items: TaxPeriodDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type ListTaxEventsQuery = {
  taxPeriodId?: string;
  eventType?: TaxEventType;
  status?: TaxEventStatus;
  page?: number;
  pageSize?: number;
};

export type PaginatedTaxEventsDto = {
  items: TaxEventDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type ListReviewIssuesQuery = {
  taxPeriodId?: string;
  severity?: ReviewIssueSeverity;
  status?: ReviewIssueStatus;
  page?: number;
  pageSize?: number;
};

export type PaginatedReviewIssuesDto = {
  items: TaxReviewIssueDto[];
  total: number;
  page: number;
  pageSize: number;
};
