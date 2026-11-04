import type {
  ExpenseStatus, ExtractionStatus, AiVerificationStatus, DuplicateStatus,
  ExpensePaymentStatus, ExpensePostingStatus, ExpenseVatMode, InputVatClaimStatus,
  ExpensePaymentMethod, ExpenseCaptureSource, ExpenseCategoryStatus,
  CreateExpenseDraftInput, UpdateExpenseDraftInput, ListExpensesFilter,
  ExpenseLineSummary, ExpenseChargeSummary, ExpenseTotalsIdentity, ExpenseAttachmentRef, DuplicateCandidateSummary, ExpenseCategorySummary,
  SourceDocumentType, TaxEvidenceStatus, TaxEvidenceReasonCode, ExpenseLineReviewStatus,
  SignatureAssetStatus, SignatureSubmitChannel,
  SubstituteReceiptEvidenceStatus, SubstituteReceiptEvidenceSummary, SubstituteReceiptReasonCode,
  SubstituteReceiptCashEvidencePolicy, BuyerEntityKind, ExpensePaymentRecordStatus,
} from '@watchdog-bms/contracts';

export type ExpenseRecord = {
  hasDeletionBlockingHistory?: boolean;
  hasRetainedSubstituteReceiptEvidence?: boolean;
  latestInputVatDecision?: import('@watchdog-bms/contracts').ExpenseSummary['latestInputVatDecision'];
  /** Whether the right is relevant for this document date and VAT amount; presentation only. */
  inputVatRightVisible?: boolean;
  inputVatRecordedBeforeReview?: boolean;
  cancelledCertificate?: import('@watchdog-bms/contracts').ExpenseSummary['cancelledCertificate'];
  /**
   * Spec §7/§8: not a column — the outcome of this save's counterparty auto-save, so the review
   * screen can show the toast (case a/b), the one-line notice (case c) or the "ยังไม่ได้บันทึกลง
   * ทะเบียนคู่ค้า ลองใหม่ได้จากหน้าคู่ค้า" bar. Present only on a write response.
   */
  vendorCounterpartyAutoSave?: import('@watchdog-bms/contracts').VendorCounterpartyAutoSaveResult;
  costSourceExpenseId?: string;
  reimbursementProgress?: import('@watchdog-bms/contracts').ExpenseReimbursementProgress;
  id: string;
  companyId: string;
  branchId: string | null;
  expenseNumber: string | null;
  sourceReimbursementRequestId: string | null;
  sourceReimbursementLineId: string | null;
  status: ExpenseStatus;
  captureSource: ExpenseCaptureSource;
  vendorCounterpartyId: string | null;
  reservedByDisbursementVoucherId?: string | null;
  requestedReviewerUserId?: string | null;
  submittedByUserId?: string | null;
  submittedAt?: Date | null;
  vendorSnapshotJson: Record<string, unknown> | null;
  vendorNameSnapshot: string | null;
  vendorTaxIdSnapshot: string | null;
  vendorBranchCodeSnapshot: string | null;
  vendorAddressSnapshot: string | null;
  /** Slice 2 raw column; read it through `readBuyerAsPrinted`. Optional so bare fixtures stay valid. */
  buyerAsPrintedJson?: unknown;
  vendorEntityKindSnapshot: BuyerEntityKind | null;
  vendorDocumentNumber: string | null;
  expenseDate: Date;
  receivedAt: Date | null;
  dueDate: Date | null;
  currency: string;
  vatMode: ExpenseVatMode;
  inputVatClaimStatus: InputVatClaimStatus;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  whtRemittance: import('@watchdog-bms/contracts').WhtRemittance | null;
  // RA-18-style classification, captured at review — mirrors SupplierPayment.whtCategoryCode/whtRate
  // (WHT certificate system issuance plan §1.2). Null means not yet classified.
  whtCategoryCode: string | null;
  whtRate: string | null;
  grandTotalAmount: string;
  netPayableAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  paymentStatus: ExpensePaymentStatus;
  paymentMethod: ExpensePaymentMethod | null;
  paidAt: Date | null;
  bankAccountRef: string | null;
  expenseCategoryId: string | null;
  accountHintKey: string | null;
  taxCategory: string | null;
  duplicateStatus: DuplicateStatus;
  duplicateOfExpenseId: string | null;
  duplicateOverrideReason: string | null;
  primaryAttachmentId: string | null;
  extractionId: string | null;
  aiVerificationStatus: AiVerificationStatus;
  aiVerifiedFieldsJson: Record<string, unknown> | null;
  aiVerificationSummaryJson: Record<string, unknown> | null;
  vatCaptureSnapshotJson: import('@watchdog-bms/contracts').ExpenseVatCaptureSnapshotV1 | null;
  whtInputJson?: import('@watchdog-bms/contracts').ExpenseWhtCapture | null;
  aiVerificationConfidence: number | null;
  aiVerifiedAt: Date | null;
  lineMessageId: string | null;
  lineEventId: string | null;
  missingReceiptReason: string | null;
  sourceDocumentType: SourceDocumentType;
  sourceDocumentLanguage: string | null;
  taxEvidenceStatus: TaxEvidenceStatus;
  taxEvidenceReasonCode: string | null;
  uploadedAt: Date;
  sourceChannelMetadataJson: Record<string, unknown> | null;
  substituteReceiptGeneratedAt: Date | null;
  substituteReceiptGeneratedByUserId: string | null;
  postingStatus: ExpensePostingStatus;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  pendingPostingSourceType: 'expense.record' | 'expense.payment' | null;
  pendingPostingSourceId: string | null;
  postingError: string | null;
  // Capture lineage (appendix §2.3). Null on every ordinary expense; never set from a client DTO.
  captureGroupId?: string | null;
  captureAllocationId?: string | null;
  captureScopeKey?: string | null;
  payerUserId?: string | null;
  note: string | null;
  internalMemo: string | null;
  createdByUserId: string;
  updatedByUserId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
  rejectedByUserId: string | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  voidedByUserId: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ExpensePaymentRecord = {
  slipAttachmentId?: string | null;
  id: string;
  companyId: string;
  expenseId: string;
  amount: string;
  currency: string;
  paymentMethod: ExpensePaymentMethod | null;
  paidAt: Date;
  bankAccountRef: string | null;
  status: ExpensePaymentRecordStatus;
  postingStatus: ExpensePostingStatus;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  postingError: string | null;
  createdByUserId: string;
  voidedByUserId: string | null;
  voidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  disbursementVoucher?: { id: string | null; documentNumber: string } | null;
  cancelledDisbursementVoucher?: { id: string | null; documentNumber: string } | null;
  canIssueDisbursementVoucher?: boolean;
};

export type ExpenseRecordWithRelations = ExpenseRecord & {
  /** Same resolved evidence facts as the accounting evidence list. */
  sourceEvidenceUnavailable?: boolean;
  categoryName?: string | null;
  lines: ExpenseLineSummary[];
  /** Spec §5.1: the `chargeKind != null` rows, derived by `expenseLineCharges` so the web, the LINE
   *  read tool and the API detail all describe an additional charge the same way. */
  charges: ExpenseChargeSummary[];
  /** Stored header vs stored lines — see `expenseTotalsIdentity`. */
  totalsIdentity: ExpenseTotalsIdentity;
  attachments: ExpenseAttachmentRef[];
  duplicateCandidates: DuplicateCandidateSummary[];
  substituteReceiptEvidence: SubstituteReceiptEvidenceSummary | null;
  payments: ExpensePaymentRecord[];
  /** Appendix §5: the capture group this is a derived source of; null on every other expense. */
  captureGroup?: import('@watchdog-bms/contracts').ExpenseCaptureLineage | null;
  /** Slice 2: the parsed `buyerAsPrintedJson`, the only form the detail DTO exposes. */
  buyerAsPrinted?: import('@watchdog-bms/contracts').ExpenseBuyerAsPrinted | null;
  /**
   * The suggested input Tax Code of the category this expense is filed under, as its external
   * code. A hint for the line picker, not a stored property of the expense.
   */
  categoryDefaultInputTaxCode?: string | null;
};

export type SubstituteReceiptEvidenceRecord = {
  correctionOfEvidenceId?: string | null;
  revisionOfEvidenceId?: string | null;
  correctionReason?: string | null;
  fundingSource?: 'COMPANY' | 'PERSONAL_ADVANCE' | null;
  id: string;
  companyId: string;
  expenseId: string;
  branchId: string | null;
  version: number;
  status: SubstituteReceiptEvidenceStatus;
  documentNumber: string;
  idempotencyKey: string;
  paperFormSnapshotJson?: Record<string, unknown> | null;
  paperSubmissionJson?: import('@watchdog-bms/contracts').SubstituteReceiptPaperSubmission | null;
  paperReviewedByUserId?: string | null;
  snapshotJson: Record<string, unknown> | null;
  snapshotChecksumSha256: string | null;
  originalSourceDocumentType: SourceDocumentType;
  reasonCode: SubstituteReceiptReasonCode;
  missingReceiptReason: string;
  businessPurpose: string;
  paymentEvidenceAttachmentIds: string[];
  supportingAttachmentIds: string[];
  paymentDate: Date | null;
  paymentMethod: ExpensePaymentMethod | null;
  note: string | null;
  preparedByUserId: string;
  preparedAt: Date;
  expenseUpdatedAtAtPreparation: Date;
  payerUserId: string | null;
  payerName: string;
  payeeName: string | null;
  payeeAddress: string | null;
  payeeTaxId: string | null;
  payerPosition: string | null;
  payerSignatureAttachmentId: string | null;
  payerSignatureChecksumSha256: string | null;
  certifiedArtifactAttachmentId: string | null;
  certifiedArtifactChecksumSha256: string | null;
  certifiedAt: Date | null;
  approverUserId: string | null;
  approverName: string | null;
  approverPosition: string | null;
  approverSignatureAttachmentId: string | null;
  approvedAt: Date | null;
  artifactAttachmentId: string | null;
  checksumSha256: string | null;
  issuedByUserId: string | null;
  issuedAt: Date | null;
  supersededAt: Date | null;
  supersedeReason: string | null;
  /** R10/R11 paper route: the ink is on the scan, so no signature image is rendered or demanded. */
  signatureMode: 'DIGITAL' | 'PAPER';
  wetSignedScanAttachmentId: string | null;
  wetSignedScanChecksumSha256: string | null;
  preparedFromChannel: 'WEB' | 'LINE';
  updatedAt: Date;
};

export type SubstituteReceiptPolicyRecord = {
  id: string;
  companyId: string;
  approverUserIds: string[];
  cashEvidencePolicy: SubstituteReceiptCashEvidencePolicy;
  cashEvidenceInstructions: string | null;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateExpenseRecordInput = {
  whtRemittance?: import('@watchdog-bms/contracts').WhtRemittance | null;
  /** Server-owned identity of a deliberate save; never supplied to upload/OCR repository writes. */
  draftIdempotencyKey?: string;
  draftPayloadHash?: string;
  draftReplayScopes?: import('../../../data-model-core/domain/logic/branch.logic').BranchScopes;
  assignExpenseNumber?: boolean;
  companyId: string;
  branchId?: string;
  captureSource: ExpenseCaptureSource;
  expenseDate: Date;
  currency?: string;
  vatMode: ExpenseVatMode;
  inputVatClaimStatus: InputVatClaimStatus;
  expenseCategoryId?: string;
  accountHintKey?: string;
  note?: string;
  missingReceiptReason?: string;
  createdByUserId: string;
  lineMessageId?: string;
  lineEventId?: string;
  vendorCounterpartyId?: string;
  sourceDocumentType?: SourceDocumentType;
  sourceDocumentLanguage?: string;
  taxEvidenceStatus?: TaxEvidenceStatus;
  taxEvidenceReasonCode?: TaxEvidenceReasonCode;
  sourceChannelMetadataJson?: Record<string, unknown>;
  aiVerificationSummaryJson?: Record<string, unknown>;
  vendorNameSnapshot?: string;
  vatCaptureSnapshotJson?: import('@watchdog-bms/contracts').ExpenseVatCaptureSnapshotV1;
  whtInputJson?: import('@watchdog-bms/contracts').ExpenseWhtCapture;
  // Capture handoff (appendix §5, W05). A derived source is written complete — issuer, status and
  // lineage in the same INSERT as its totals — because it is created under the group lock inside
  // the handoff transaction, where a second write to "finish" it has nothing to fence against.
  // Every field here is server-derived from a reviewed allocation; none is ever taken from a DTO.
  status?: ExpenseStatus;
  aiVerificationStatus?: AiVerificationStatus;
  vendorTaxIdSnapshot?: string;
  vendorBranchCodeSnapshot?: string;
  vendorAddressSnapshot?: string;
  vendorDocumentNumber?: string;
  captureGroupId?: string;
  captureAllocationId?: string | null;
  captureScopeKey?: string;
  payerUserId?: string | null;
  // computed totals
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  grandTotalAmount: string;
  netPayableAmount: string;
  outstandingAmount: string;
};

// The capture lineage and the payer are INSERT-only through this type: `updateExpense` does not
// carry them, so accepting them here would be a field that type-checks and silently does nothing.
// A handoff writes them in its own transaction, under the group lock (appendix §5).
export type UpdateExpenseRecordInput = Partial<Omit<CreateExpenseRecordInput, 'companyId' | 'captureSource' | 'createdByUserId' | 'missingReceiptReason' | 'expenseCategoryId' | 'draftIdempotencyKey' | 'draftPayloadHash' | 'draftReplayScopes' | 'captureGroupId' | 'captureAllocationId' | 'captureScopeKey' | 'payerUserId' | 'vendorBranchCodeSnapshot' | 'vendorAddressSnapshot' | 'vendorCounterpartyId'>> & {
  /** Explicitly detach an outdated vendor link when the seller identity changes. */
  vendorCounterpartyId?: string | null;
  id: string;
  companyId: string;
  updatedByUserId: string;
  expenseCategoryId?: string | null;
  /** Internal permission-checked reviewer save; never accepted from an HTTP body. */
  refreshSubstituteEvidence?: { requestId: string };
  expectedUpdatedAt?: Date;
  /** Internal CAS callers may pin the next revision so persisted continuation metadata can point
   * at the exact same revision. This is not exposed by the HTTP update contract. */
  updatedAt?: Date;
  vendorNameSnapshot?: string;
  vendorTaxIdSnapshot?: string;
  // Nullable on update only, per CON-8/§6: a cleared branch code or address is stored as NULL, never
  // as `''` or `'00000'`.
  vendorBranchCodeSnapshot?: string | null;
  vendorAddressSnapshot?: string | null;
  /** Server-derived only (Slice 2 re-check); never taken from a request body. */
  buyerAsPrintedJson?: import('@watchdog-bms/contracts').ExpenseBuyerAsPrinted;
  vendorEntityKindSnapshot?: BuyerEntityKind;
  whtCategoryCode?: string;
  whtRate?: string | null;
  vendorDocumentNumber?: string;
  receivedAt?: Date | null;
  dueDate?: Date | null;
  taxCategory?: string;
  internalMemo?: string;
  // Nullable on update only: clearing the reason takes the expense back off the substitute path.
  missingReceiptReason?: string | null;
  requestedReviewerUserId?: string;
  submittedByUserId?: string;
  submittedAt?: Date;
  reviewedByUserId?: string;
  reviewedAt?: Date;
  status?: ExpenseStatus;
  primaryAttachmentId?: string;
  extractionId?: string;
  aiVerificationStatus?: AiVerificationStatus;
  aiVerifiedFieldsJson?: Record<string, unknown>;
  aiVerificationSummaryJson?: Record<string, unknown>;
  vatCaptureSnapshotJson?: import('@watchdog-bms/contracts').ExpenseVatCaptureSnapshotV1;
  aiVerificationConfidence?: number;
  aiVerifiedAt?: Date;
  duplicateStatus?: DuplicateStatus;
  duplicateOfExpenseId?: string;
  duplicateOverrideReason?: string;
  paymentStatus?: ExpensePaymentStatus;
  paymentMethod?: ExpensePaymentMethod;
  paidAt?: Date;
  paidAmount?: string;
  outstandingAmount?: string;
  bankAccountRef?: string;
  confirmedByUserId?: string;
  confirmedAt?: Date;
  rejectedByUserId?: string;
  rejectedAt?: Date;
  rejectReason?: string;
  voidedByUserId?: string;
  voidedAt?: Date;
  voidReason?: string;
  postingStatus?: ExpensePostingStatus;
  postingError?: string;
  vendorSnapshotJson?: Record<string, unknown>;
  expenseNumber?: string;
  sourceDocumentType?: SourceDocumentType;
  sourceDocumentLanguage?: string;
  taxEvidenceStatus?: TaxEvidenceStatus;
  taxEvidenceReasonCode?: string;
  substituteReceiptGeneratedAt?: Date;
  substituteReceiptGeneratedByUserId?: string;
  sourceChannelMetadataJson?: Record<string, unknown>;
};

export type ExpenseLineInput = {
  expenseId: string;
  companyId: string;
  lineNumber: number;
  description: string;
  chargeKind?: import('@watchdog-bms/contracts').ExpenseLineChargeKind | null;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxableAmount: string;
  vatRate: string | null;
  vatTreatment?: import('@watchdog-bms/contracts').ExpenseLineVatTreatment | null;
  vatAmount: string;
  whtCategoryCode?: string | null;
  whtRate: string | null;
  whtAmount: string;
  lineSubtotalAmount: string;
  lineTotalAmount: string;
  expenseCategoryId: string | null;
  accountHintKey: string | null;
  taxCategory: string | null;
  sourceLineText?: string | null;
  aiLineConfidence?: number | null;
  reviewStatus?: ExpenseLineReviewStatus;
  taxCodeDefinitionId?: string;
  externalTaxCode?: string;
  taxSnapshot?: import('@watchdog-bms/contracts').TransactionTaxSnapshot;
  taxComponents?: import('@watchdog-bms/contracts').TransactionTaxComponentPreview[];
  sourceLineId?: string;
  /** Internal scoped identity retained by source-draft line materialization. */
  preserveLineId?: string;
};

export type PaginatedExpenses = {
  data: ExpenseRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type SignatureAssetRecord = {
  id: string;
  companyId: string;
  label: string | null;
  status: SignatureAssetStatus;
  originalAttachmentId: string;
  derivedAttachmentId: string | null;
  submittedByUserId: string;
  submittedFromChannel: SignatureSubmitChannel;
  lineMessageId: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  rejectedByUserId: string | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export { CreateExpenseDraftInput, UpdateExpenseDraftInput, ListExpensesFilter, ExpenseCategoryStatus };
