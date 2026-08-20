// Item 09 – Expense and Receipt Upload contracts

import {
  BUSINESS_DOCUMENT_KINDS,
  type BusinessDocumentClassification,
  type BusinessDocumentKind,
  type ReceiptOcrFieldResult,
} from './line-ai.js';
import type { BuyerEntityKind } from './company-tax-identity.js';

export type ExpenseStatus = 'DRAFT' | 'EXTRACTING' | 'NEEDS_REVIEW' | 'READY_FOR_CONFIRMATION' | 'CONFIRMED' | 'REJECTED' | 'VOIDED';
export type ExtractionStatus = 'NOT_REQUESTED' | 'NOT_CONFIGURED' | 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
export type ExpenseExtractionResult = {
  status: 'ok' | 'not_expense_document' | 'not_configured' | 'unsupported' | 'no_attachment' | 'failed';
  fields?: ReceiptOcrFieldResult;
  missingFields?: string[];
  classification?: BusinessDocumentClassification;
};
export type AiVerificationStatus = 'NOT_VERIFIED' | 'VERIFYING' | 'AI_VERIFIED' | 'PARTIAL' | 'NEEDS_REVIEW' | 'FAILED' | 'HUMAN_VERIFIED';
export type DuplicateStatus = 'NOT_CHECKED' | 'NO_MATCH' | 'POSSIBLE_DUPLICATE' | 'CONFIRMED_DUPLICATE' | 'OVERRIDDEN';
export type ExpensePaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'VOIDED';
export type ExpensePaymentRecordStatus = 'RECORDED' | 'VOIDED';
export type ExpensePostingStatus = 'not_required' | 'pending' | 'posted' | 'posting_error' | 'reversed';
export type ExpensePostingSourceType = 'expense.record' | 'expense.payment';
export type ExpenseVatMode = 'NO_VAT' | 'VAT_INCLUDED' | 'VAT_EXCLUDED' | 'EXEMPT' | 'NEEDS_REVIEW';
export const INPUT_VAT_CLAIM_STATUSES = ['CLAIMABLE', 'NON_CLAIMABLE', 'NEEDS_REVIEW'] as const;
export type InputVatClaimStatus = (typeof INPUT_VAT_CLAIM_STATUSES)[number];
export type ExpensePaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'CHEQUE' | 'OTHER';
export type ExpenseCaptureSource = 'WEB_UPLOAD' | 'WEB_MANUAL' | 'LINE_UPLOAD' | 'API_INTERNAL';
export type ExpenseAttachmentPurpose = 'expense.receipt.primary' | 'expense.receipt.supporting' | 'expense.payment.evidence' | 'expense.review.evidence' | 'expense.signature.asset';
export type ExpenseCategoryStatus = 'ACTIVE' | 'ARCHIVED';

export type SourceDocumentType =
  | 'RECEIPT'
  | 'TAX_INVOICE'
  /** ใบกำกับภาษีอย่างย่อ (Revenue Code s.86/6) — its own type, not a TAX_INVOICE variant, because
   *  its input VAT is non-creditable under s.82/5. Spec §19h. */
  | 'ABBREVIATED_TAX_INVOICE'
  | 'TRANSFER_SLIP'
  | 'HANDWRITTEN_CASH_BILL'
  | 'SUPPLIER_BILL'
  | 'MARKETPLACE_ORDER_SCREENSHOT'
  | 'EXPENSE_NOTE_TEXT'
  | 'SUBSTITUTE_RECEIPT'
  | 'OTHER_EXPENSE_DOCUMENT'
  | 'NEEDS_REVIEW';

const FINANCE_OVERRIDE_SOURCE_DOCUMENT_TYPES: ReadonlySet<SourceDocumentType> = new Set([
  'RECEIPT',
  'TAX_INVOICE',
  'TRANSFER_SLIP',
  'HANDWRITTEN_CASH_BILL',
  'SUPPLIER_BILL',
  'MARKETPLACE_ORDER_SCREENSHOT',
  'EXPENSE_NOTE_TEXT',
  'SUBSTITUTE_RECEIPT',
  'OTHER_EXPENSE_DOCUMENT',
]);

export type NonExpenseClassificationOverrideInput = {
  acknowledged: true;
  reason: string;
};

/** Finance accepting a grand total that disagrees with the receipt OCR read. `acknowledgedTotalAmount`
 *  binds the decision to the exact figure that was accepted, so editing the amount afterwards re-arms
 *  the confirm gate — a plain "reviewed at" timestamp can never express that. */
export type OcrTotalAcknowledgementInput = {
  acknowledged: true;
  acknowledgedTotalAmount: string;
  reason: string;
};

export function isNonExpenseClassificationBlocking(
  summary: Record<string, unknown> | null | undefined,
): boolean {
  if (summary?.['status'] === 'HUMAN_OVERRIDDEN') return true;
  if (summary?.['status'] !== 'NOT_EXPENSE_DOCUMENT') return false;
  const rawClassification = summary['classification'];
  if (!rawClassification || typeof rawClassification !== 'object' || Array.isArray(rawClassification)) return true;
  const documentKind = (rawClassification as Record<string, unknown>)['documentKind'];
  if (typeof documentKind !== 'string' || !BUSINESS_DOCUMENT_KINDS.includes(documentKind as BusinessDocumentKind)) return true;
  const rawResolution = summary['classificationResolution'];
  if (!rawResolution || typeof rawResolution !== 'object' || Array.isArray(rawResolution)) return true;
  const resolution = rawResolution as Record<string, unknown>;
  const reason = resolution['reason'];
  const sourceDocumentType = resolution['sourceDocumentType'];
  const resolvedAt = resolution['resolvedAt'];
  const resolvedByUserId = resolution['resolvedByUserId'];
  return !(
    resolution['outcome'] === 'FINANCE_OVERRIDDEN_AS_EXPENSE'
    && resolution['acknowledged'] === true
    && typeof reason === 'string'
    && reason.trim().length > 0
    && reason.trim().length <= 500
    && typeof sourceDocumentType === 'string'
    && FINANCE_OVERRIDE_SOURCE_DOCUMENT_TYPES.has(sourceDocumentType as SourceDocumentType)
    && typeof resolvedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(resolvedAt)
    && Number.isFinite(Date.parse(resolvedAt))
    && typeof resolvedByUserId === 'string'
    && resolvedByUserId.trim().length > 0
  );
}

export type TaxEvidenceStatus = 'USABLE_FOR_TAX' | 'SUPPORTING_ONLY' | 'NOT_TAX_EVIDENCE' | 'NEEDS_REVIEW';

export type TaxEvidenceReasonCode =
  | 'VALID_TAX_INVOICE_FIELDS'
  | 'VALID_RECEIPT_FIELDS'
  | 'PAYMENT_EVIDENCE_ONLY'
  | 'MARKETPLACE_SCREENSHOT_ONLY'
  | 'HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE'
  | 'MISSING_VENDOR_TAX_ID'
  | 'MISSING_DOCUMENT_NUMBER'
  | 'MISSING_MONETARY_AMOUNT'
  | 'UNREADABLE_OR_LOW_CONFIDENCE'
  | 'NOT_BUSINESS_EVIDENCE'
  /** Spec §19h: ใบกำกับภาษีอย่างย่อ is valid expense evidence but cannot support an input-VAT
   *  credit (Revenue Code s.82/5). Distinct from a missing-field reason — nothing is missing. */
  | 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE'
  | 'MANUAL_OVERRIDE';

export type ExpenseLineReviewStatus = 'SUGGESTED' | 'REVIEWED' | 'NEEDS_REVIEW';

export type SignatureAssetStatus = 'PENDING_OWNER_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'ARCHIVED';
export type SignatureSubmitChannel = 'WEB' | 'LINE';
export type SubstituteReceiptEvidenceStatus = 'PREPARED' | 'PAYER_CERTIFIED' | 'ISSUED' | 'SUPERSEDED';
export type SubstituteReceiptCashEvidencePolicy =
  | 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE'
  | 'ALLOW_SUPPORTING_EVIDENCE_ONLY';
export type SubstituteReceiptApprovalMode = 'OWNER_SELF' | 'DESIGNATED_APPROVERS';
export type SubstituteReceiptReasonCode =
  | 'PAYEE_CANNOT_ISSUE'
  | 'RECEIPT_UNAVAILABLE'
  | 'RECEIPT_MATERIALLY_INCOMPLETE'
  | 'OTHER';

/**
 * Shared certificate-layout limits. Keeping these in contracts prevents the wizard from accepting
 * a draft that the API cannot safely turn into the authoritative SVG and its derived A4 PDF.
 */
export const SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS = Object.freeze({
  maxExpenseLines: 8,
  maxLineDescriptionLength: 200,
  maxEvidenceAttachments: 8,
  maxEvidenceFileNameLength: 255,
});

/**
 * Spec §12 delivery links. 32 random bytes as unpadded base64url — exactly 43 characters of the
 * base64url alphabet. One definition, because three places must agree on it: the API mints and
 * resolves it, `safeTenantLink` allows exactly this shape into a LINE card, and the web's public
 * `/d/[token]` page is the only route it ever names.
 */
export const DOCUMENT_DELIVERY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const EXPENSE_SEQUENCE_KEY = 'expense.record';

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  DRAFT: 'ร่าง',
  EXTRACTING: 'กำลังดึงข้อมูล',
  NEEDS_REVIEW: 'รอตรวจสอบ',
  READY_FOR_CONFIRMATION: 'พร้อมยืนยัน',
  CONFIRMED: 'ยืนยันแล้ว',
  REJECTED: 'ปฏิเสธ',
  VOIDED: 'ยกเลิก',
};

export const EXPENSE_PAYMENT_STATUS_LABELS: Record<ExpensePaymentStatus, string> = {
  UNPAID: 'ยังไม่ชำระ',
  PARTIALLY_PAID: 'ชำระบางส่วน',
  PAID: 'ชำระแล้ว',
  VOIDED: 'ยกเลิก',
};

/**
 * Owner decision 2026-08-05: รอตรวจสอบ counts from DRAFT onward — an unfinished document is
 * outstanding work whether or not its author has submitted it yet. Shared rather than per-surface
 * because the list card, the list chip, and the dashboard each carried their own copy and drifted:
 * the same word showed 3 and 2 an inch apart on one screen.
 */
export const EXPENSE_PENDING_STATUSES: ExpenseStatus[] = [
  'DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION',
];

export function isExpensePending(status: ExpenseStatus): boolean {
  return EXPENSE_PENDING_STATUSES.includes(status);
}

/** Not company spend: a rejected document never posted, a voided one was reversed. */
export const EXPENSE_CANCELLED_STATUSES: ExpenseStatus[] = ['REJECTED', 'VOIDED'];

export function isExpenseCancelled(status: ExpenseStatus): boolean {
  return EXPENSE_CANCELLED_STATUSES.includes(status);
}

export function isExpenseDeletableState(
  expense: Pick<ExpenseSummary, 'status' | 'grandTotalAmount' | 'paymentStatus'>,
): boolean {
  // Owner decision 2026-08-05: REJECTED is as removable as a draft, at any amount. Rejecting sets
  // postingStatus to not_required, so the record never reached the books, and its creator can
  // already reopen it for review — the delete grants no new reach, only a clean exit instead of a
  // row that sits in the list forever. The zero-total rule below guards documents nobody has ruled
  // on yet; a rejection is that ruling.
  if (expense.status === 'DRAFT' || expense.status === 'REJECTED') return true;
  return ['NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status)
    && expense.paymentStatus === 'UNPAID'
    && Number(expense.grandTotalAmount) === 0;
}

// Spec §19g decision 3: the mode states the document arithmetic, the lines state the rate.
// Naming a rate here was a lie on every zero-rated, exempt-mixed, or foreign-VAT document.
export const EXPENSE_VAT_MODE_LABELS: Record<ExpenseVatMode, string> = {
  NO_VAT: 'ไม่มี VAT',
  VAT_INCLUDED: 'VAT รวมในราคา',
  VAT_EXCLUDED: 'VAT แยกจากราคา',
  EXEMPT: 'ยกเว้น VAT',
  NEEDS_REVIEW: 'รอตรวจ VAT',
};

/** True when the mode asserts that VAT applies, so a line rate is required to record it. */
export function vatModeRequiresRate(vatMode: ExpenseVatMode): boolean {
  return vatMode === 'VAT_INCLUDED' || vatMode === 'VAT_EXCLUDED';
}

/**
 * Spec §19g decision 3: the rate shown beside the mode is derived from the lines, never assumed.
 * A blank/absent rate is unknown — distinct from an explicit `0` (§19f decision 3), which is a
 * zero-rated supply and prints as `0%`.
 */
export function effectiveVatRateLabel(lines: Array<{ vatRate?: string | null }>): string {
  const known = new Set<number>();
  for (const line of lines) {
    const raw = line.vatRate;
    if (raw === null || raw === undefined || `${raw}`.trim() === '') continue;
    const rate = Number(raw);
    if (Number.isFinite(rate)) known.add(Math.round(rate * 10_000));
  }
  if (known.size === 0) return 'ยังไม่ระบุ';
  if (known.size > 1) return 'หลายอัตรา';
  const percent = [...known][0]! / 100;
  return `${Number(percent.toFixed(2))}%`;
}

export const SOURCE_DOCUMENT_TYPE_LABELS: Record<SourceDocumentType, string> = {
  RECEIPT: 'ใบเสร็จรับเงิน',
  TAX_INVOICE: 'ใบกำกับภาษี (เต็มรูป)',
  ABBREVIATED_TAX_INVOICE: 'ใบกำกับภาษีอย่างย่อ',
  TRANSFER_SLIP: 'สลิปโอนเงิน',
  HANDWRITTEN_CASH_BILL: 'บิลเงินสดเขียนมือ',
  SUPPLIER_BILL: 'บิลผู้ขาย',
  MARKETPLACE_ORDER_SCREENSHOT: 'สกรีนช็อตคำสั่งซื้อ (Shopee/Lazada/TikTok)',
  EXPENSE_NOTE_TEXT: 'โน้ตค่าใช้จ่าย (ข้อความ)',
  SUBSTITUTE_RECEIPT: 'ใบรับรองแทนใบเสร็จรับเงิน',
  OTHER_EXPENSE_DOCUMENT: 'เอกสารค่าใช้จ่ายอื่น',
  NEEDS_REVIEW: 'รอตรวจประเภทเอกสาร',
};

export const TAX_EVIDENCE_STATUS_LABELS: Record<TaxEvidenceStatus, string> = {
  USABLE_FOR_TAX: 'ใช้เป็นหลักฐานภาษีได้',
  SUPPORTING_ONLY: 'หลักฐานประกอบเท่านั้น',
  NOT_TAX_EVIDENCE: 'ไม่ใช่หลักฐานภาษี',
  NEEDS_REVIEW: 'รอตรวจหลักฐานภาษี',
};

/** PENDING_OWNER_APPROVAL and REJECTED are history only since the personal-signature decision
 *  (2026-08-20): nothing creates them any more, and the 2026-08-20 data migration activated every
 *  row that was still pending. The labels stay so an old REJECTED row still reads as one. */
export const SIGNATURE_ASSET_STATUS_LABELS: Record<SignatureAssetStatus, string> = {
  PENDING_OWNER_APPROVAL: 'รอเจ้าของกิจการอนุมัติ',
  ACTIVE: 'ใช้งานได้',
  REJECTED: 'ปฏิเสธ',
  ARCHIVED: 'เก็บถาวร',
};

export type ExpenseCategorySummary = {
  id: string;
  companyId: string | null;
  name: string;
  accountHintKey: string;
  /** Suggested input Tax Code, as its stable external code. Never a definition id. */
  defaultInputTaxCode: string | null;
  status: ExpenseCategoryStatus;
  sortOrder: number;
};

export type ExpenseLineSummary = {
  id: string;
  lineNumber: number;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxableAmount: string;
  vatRate: string | null;
  vatAmount: string;
  whtRate: string | null;
  whtAmount: string;
  lineSubtotalAmount: string;
  lineTotalAmount: string;
  expenseCategoryId: string | null;
  accountHintKey: string | null;
  taxCategory: string | null;
  sourceLineText: string | null;
  aiLineConfidence: number | null;
  reviewStatus: ExpenseLineReviewStatus;
  taxSnapshot?: import('./transaction-tax.js').TransactionTaxSnapshot;
  taxComponents?: import('./transaction-tax.js').TransactionTaxComponentPreview[];
};

export type ExpenseAttachmentRef = {
  id: string;
  purpose: ExpenseAttachmentPurpose;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string | null;
  status: string;
  createdAt: string;
};

export type ExpensePaymentSummary = {
  id: string;
  amount: string;
  currency: string;
  paymentMethod: ExpensePaymentMethod | null;
  paidAt: string;
  bankAccountRef: string | null;
  status: ExpensePaymentRecordStatus;
  postingStatus: ExpensePostingStatus;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  postingError: string | null;
  createdByUserId: string;
  createdAt: string;
};

export type ExpenseSummary = {
  id: string;
  companyId: string;
  branchId: string | null;
  expenseNumber: string | null;
  status: ExpenseStatus;
  captureSource: ExpenseCaptureSource;
  vendorCounterpartyId: string | null;
  vendorNameSnapshot: string | null;
  vendorDocumentNumber: string | null;
  expenseDate: string;
  currency: string;
  vatMode: ExpenseVatMode;
  vatAmount: string;
  grandTotalAmount: string;
  netPayableAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  paymentStatus: ExpensePaymentStatus;
  dueDate: string | null;
  aiVerificationStatus: AiVerificationStatus;
  duplicateStatus: DuplicateStatus;
  postingStatus: ExpensePostingStatus;
  sourceDocumentType: SourceDocumentType;
  taxEvidenceStatus: TaxEvidenceStatus;
  expenseCategoryId: string | null;
  uploadedAt: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseDetail = ExpenseSummary & {
  /** Set when this expense is a reimbursement-claim projection — it is settled by the
   *  claim payout (RBPAY), never by a manual expense payment. */
  sourceReimbursementRequestId: string | null;
  vendorTaxIdSnapshot: string | null;
  vendorBranchCodeSnapshot: string | null;
  /** WHT payee taxpayer class: INDIVIDUAL files ภ.ง.ด.3, JURISTIC files ภ.ง.ด.53. */
  vendorEntityKindSnapshot: BuyerEntityKind | null;
  vendorSnapshotJson: Record<string, unknown> | null;
  receivedAt: string | null;
  sourceDocumentLanguage: string | null;
  taxEvidenceReasonCode: TaxEvidenceReasonCode | null;
  substituteReceiptGeneratedAt: string | null;
  substituteReceiptGeneratedByUserId: string | null;
  inputVatClaimStatus: InputVatClaimStatus;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  whtAmount: string;
  paymentMethod: ExpensePaymentMethod | null;
  paidAt: string | null;
  bankAccountRef: string | null;
  accountHintKey: string | null;
  taxCategory: string | null;
  missingReceiptReason: string | null;
  aiVerifiedFieldsJson: Record<string, unknown> | null;
  aiVerificationSummaryJson: Record<string, unknown> | null;
  aiVerificationConfidence: number | null;
  aiVerifiedAt: string | null;
  note: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  rejectedByUserId: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  voidedByUserId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  lines: ExpenseLineSummary[];
  attachments: ExpenseAttachmentRef[];
  duplicateStatus: DuplicateStatus;
  duplicateOfExpenseId: string | null;
  duplicateOverrideReason: string | null;
  postingStatus: ExpensePostingStatus;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  pendingPostingSourceType: ExpensePostingSourceType | null;
  pendingPostingSourceId: string | null;
  postingError: string | null;
  payments: ExpensePaymentSummary[];
  substituteReceiptEvidence: SubstituteReceiptEvidenceSummary | null;
};

export type CreateExpenseDraftInput = {
  captureSource: ExpenseCaptureSource;
  branchId?: string;
  vendorCounterpartyId?: string;
  expenseDate: string;
  currency?: string;
  vatMode: ExpenseVatMode;
  inputVatClaimStatus: InputVatClaimStatus;
  expenseCategoryId?: string;
  accountHintKey?: string;
  note?: string;
  missingReceiptReason?: string;
  lines: Array<{
    lineNumber: number;
    description: string;
    quantity: string;
    unitPrice: string;
    discountAmount?: string;
    vatRate?: string;
    whtRate?: string;
    expenseCategoryId?: string;
    accountHintKey?: string;
    taxCategory?: string;
    taxCodeDefinitionId?: string;
    externalTaxCode?: string;
    transactionContext?: import('./transaction-tax.js').TransactionTaxContext;
    taxComponents?: import('./transaction-tax.js').TransactionTaxComponentPreview[];
  }>;
};

export type UpdateExpenseDraftInput = Partial<Omit<CreateExpenseDraftInput, 'captureSource' | 'lines'>> & {
  /** Interactive callers send the version they loaded; API PATCH/override routes require it. */
  expectedUpdatedAt?: string;
  lines?: CreateExpenseDraftInput['lines'];
  vendorNameSnapshot?: string;
  vendorTaxIdSnapshot?: string;
  vendorBranchCodeSnapshot?: string;
  vendorEntityKindSnapshot?: BuyerEntityKind;
  vendorDocumentNumber?: string;
  receivedAt?: string;
  dueDate?: string;
  taxCategory?: string;
  internalMemo?: string;
  sourceDocumentType?: SourceDocumentType;
  sourceDocumentLanguage?: string;
  taxEvidenceStatus?: TaxEvidenceStatus;
  taxEvidenceReasonCode?: TaxEvidenceReasonCode;
  nonExpenseClassificationOverride?: NonExpenseClassificationOverrideInput;
  ocrTotalAcknowledgement?: OcrTotalAcknowledgementInput;
};

export type ListExpensesFilter = {
  companyId: string;
  branchId?: string;
  status?: ExpenseStatus;
  paymentStatus?: ExpensePaymentStatus;
  duplicateStatus?: DuplicateStatus;
  postingStatus?: ExpensePostingStatus;
  vendorCounterpartyId?: string;
  captureSource?: ExpenseCaptureSource;
  sourceDocumentType?: SourceDocumentType;
  taxEvidenceStatus?: TaxEvidenceStatus;
  expenseCategoryId?: string;
  fromDate?: string;
  toDate?: string;
  uploadedFromDate?: string;
  uploadedToDate?: string;
  createdByUserId?: string;
  page?: number;
  pageSize?: number;
};

export type ExpenseSourcePostingInput = {
  companyId: string;
  branchId: string | null;
  sourceType: 'expense.record';
  sourceId: string;
  sourceEventType: 'confirmed' | 'paid' | 'voided' | 'reversed';
  idempotencyKey: string;
  expenseNumber: string | null;
  expenseDate: string;
  uploadedAt: string;
  sourceDocumentType: SourceDocumentType;
  taxEvidenceStatus: TaxEvidenceStatus;
  taxEvidenceReasonCode: TaxEvidenceReasonCode | null;
  vendorCounterpartyId: string | null;
  vendorSnapshot: Record<string, unknown> | null;
  currency: string;
  vatMode: ExpenseVatMode;
  inputVatClaimStatus: InputVatClaimStatus;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  grandTotalAmount: string;
  netPayableAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  paymentStatus: ExpensePaymentStatus;
  paymentMethod: ExpensePaymentMethod | null;
  paidAt: string | null;
  bankAccountRef: string | null;
  expenseCategoryId: string | null;
  accountHintKey: string | null;
  taxCategory: string | null;
  lines: ExpenseLineSummary[];
  attachments: Array<{ id: string; purpose: string; mimeType: string; checksumSha256: string | null; createdAt: string }>;
  duplicateStatus: DuplicateStatus;
  duplicateOverrideReason: string | null;
  postingStatus: ExpensePostingStatus;
};

export type DuplicateCandidateSummary = {
  id: string;
  candidateExpenseId: string;
  /** Identity of the other expense, joined from the candidate row. The reviewer has to decide
   *  "same document or not" from this card alone, and an opaque id cannot answer that.
   *  Null only when the candidate row is gone or out of the caller's branch scope. */
  candidateExpenseNumber: string | null;
  candidateVendorName: string | null;
  candidateExpenseDate: string | null;
  candidateGrandTotalAmount: string | null;
  reasonCodesJson: string[];
  score: number;
  status: 'OPEN' | 'DISMISSED' | 'CONFIRMED_DUPLICATE';
  resolvedAt: string | null;
  resolutionReason: string | null;
};

// ---- Category management (expense.category.manage) ----

export type CreateExpenseCategoryInput = {
  name: string;
  accountHintKey: string;
  defaultInputTaxCode?: string;
  sortOrder?: number;
};

export type UpdateExpenseCategoryInput = {
  name?: string;
  accountHintKey?: string;
  defaultInputTaxCode?: string | null;
  sortOrder?: number;
  status?: ExpenseCategoryStatus;
};

// ---- Company signature assets ----

export type SignatureAssetSummary = {
  id: string;
  companyId: string;
  label: string | null;
  status: SignatureAssetStatus;
  /** Present only on the caller's OWN rows. A housekeeping row names no attachment, because an id is
   *  a route to the image through the generic download endpoint — and housekeeping authorises
   *  deleting someone's signature, never seeing it. */
  originalAttachmentId?: string;
  derivedAttachmentId?: string | null;
  submittedByUserId: string;
  submittedFromChannel: SignatureSubmitChannel;
  approvedByUserId: string | null;
  approvedAt: string | null;
  rejectedByUserId: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** A7: short-lived inline URL for the derived (or original) image. Minted ONLY for the caller's
   *  own signature — a personal asset is nobody else's to look at, housekeeping holders included. */
  previewUrl?: string | null;
  /** Housekeeping rows only (other people's signatures, for an `expense.signature.manage` holder):
   *  who it belongs to. Null on the caller's own rows, which need no attribution. */
  submittedByDisplayName?: string | null;
};

export type CreateSignatureAssetInput = {
  attachmentId: string;
  label?: string;
};

export type SignatureFillInput = {
  signatureAssetId: string;
  renderedAttachmentId?: string;
  placeholder?: string;
};

export type SignatureFillRecordSummary = {
  id: string;
  expenseId: string;
  signatureAssetId: string;
  appliedByUserId: string;
  appliedAt: string;
  renderedAttachmentId: string | null;
  placeholder: string | null;
};

// ---- Substitute receipt certificate (ใบรับรองแทนใบเสร็จรับเงิน) ----

export type SubstituteReceiptListItem = {
  evidenceId: string;
  expenseId: string;
  documentNumber: string;
  version: number;
  status: SubstituteReceiptEvidenceStatus;
  expenseNumber: string | null;
  expenseDate: string;
  paymentDate: string | null;
  payeeName: string | null;
  payeeAddress: string | null;
  payeeTaxId: string | null;
  currency: string;
  grandTotalAmount: string;
  payerUserId: string;
  payerName: string;
  approverUserId: string | null;
  approverName: string | null;
  artifactAttachmentId: string | null;
  certifiedArtifactAttachmentId: string | null;
  updatedAt: string;
};

export type SubstituteReceiptListFilter = {
  status?: SubstituteReceiptEvidenceStatus;
  yearMonth?: string;
  payerUserId?: string;
  page?: number;
  pageSize?: number;
};

export type SubstituteReceiptListResult = {
  items: SubstituteReceiptListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type SubstituteReceiptEvidenceSummary = {
  id: string;
  expenseId: string;
  version: number;
  status: SubstituteReceiptEvidenceStatus;
  documentNumber: string;
  originalSourceDocumentType: SourceDocumentType;
  reasonCode: SubstituteReceiptReasonCode;
  missingReceiptReason: string;
  payeeName: string | null;
  payeeAddress: string | null;
  payeeTaxId: string | null;
  payerUserId: string;
  payerName: string;
  businessPurpose: string;
  paymentEvidenceAttachmentIds: string[];
  supportingAttachmentIds: string[];
  paymentDate: string | null;
  paymentMethod: ExpensePaymentMethod | null;
  note: string | null;
  preparedByUserId: string;
  preparedAt: string;
  expenseUpdatedAtAtPreparation: string;
  payerPosition: string | null;
  certifiedArtifactAttachmentId: string | null;
  certifiedArtifactChecksumSha256: string | null;
  certifiedAt: string | null;
  approverUserId: string | null;
  approverName: string | null;
  approverPosition: string | null;
  approvedAt: string | null;
  artifactAttachmentId: string | null;
  checksumSha256: string | null;
  issuedAt: string | null;
  supersedeReason: string | null;
  /** R10/R11: `PAPER` means the ink lives on `wetSignedScanAttachmentId`, not in a rendered SVG,
   *  so certification and approval ask for an acknowledgement instead of a signature image. */
  signatureMode: SubstituteReceiptSignatureMode;
  wetSignedScanAttachmentId: string | null;
  updatedAt: string;
};

export type SubstituteReceiptSignatureMode = 'DIGITAL' | 'PAPER';

export type SupersedeSubstituteReceiptInput = {
  reason: string;
  expectedEvidenceUpdatedAt: string;
};

export type GenerateSubstituteReceiptInput = {
  reasonCode: SubstituteReceiptReasonCode;
  missingReceiptReason: string;
  businessPurpose: string;
  payerUserId: string;
  payeeName?: string;
  payeeAddress?: string;
  payeeTaxId?: string;
  paymentEvidenceAttachmentIds?: string[];
  supportingAttachmentIds?: string[];
  paymentDate?: string;
  paymentMethod?: ExpensePaymentMethod;
  idempotencyKey: string;
  expectedExpenseUpdatedAt: string;
  /** R10: this prepare answers `ขอฟอร์มไปเซ็นเอง`, so the chat is now waiting for a photo of the
   *  signed sheet. Recorded on the continuation state the prepare consumes; ignored without one. */
  formRequested?: boolean;
  /** Opaque LINE handoff id; accepted values are reloaded server-side after authentication. */
  continuationId?: string;
  note?: string;
};

export type LineSubstituteReceiptPrefill = {
  workflowId: string;
  expenseId: string;
  targetRevision: string;
  status: 'OPEN' | 'PAUSED';
  acceptedValues: {
    reasonCode?: SubstituteReceiptReasonCode;
    missingReceiptReason?: string;
    businessPurpose?: string;
    payerUserId?: string;
    payeeName?: string;
    paymentDate?: string;
    paymentMethod?: ExpensePaymentMethod;
    itemDescription?: string;
    amount?: string;
    expenseCategoryId?: string;
    /** The sender stated there is no file to attach; the wizard still offers upload. */
    evidenceNone?: boolean;
  };
};

export type PreviewSubstituteReceiptInput = {
  payerPosition: string;
};

export type SubstituteReceiptPreview = {
  svgDataUrl: string;
  previewChecksumSha256: string;
};

export type CertifySubstituteReceiptInput = {
  payerPosition: string;
  certificationAcknowledged: true;
  previewChecksumSha256: string;
  /** R9: omit to sign with the signer's ACTIVE personal signature asset; a per-evidence upload wins. */
  signatureAttachmentId?: string;
  checksumSha256?: string;
  byteSize?: number;
  expectedVersion: number;
  expectedEvidenceUpdatedAt: string;
};

export type ApproveSubstituteReceiptInput = {
  approverPosition: string;
  approvalAcknowledged: true;
  certifiedArtifactChecksumSha256: string;
  /** R9: omit to sign with the signer's ACTIVE personal signature asset; a per-evidence upload wins. */
  signatureAttachmentId?: string;
  checksumSha256?: string;
  byteSize?: number;
  expectedVersion: number;
  expectedEvidenceUpdatedAt: string;
};

export type SubstituteReceiptApproverCandidate = {
  userId: string;
  displayName: string;
};

export type SubstituteReceiptPolicySettings = {
  configured: boolean;
  ready: boolean;
  approvalMode: SubstituteReceiptApprovalMode;
  approverUserIds: string[];
  invalidApproverUserIds: string[];
  cashEvidencePolicy: SubstituteReceiptCashEvidencePolicy;
  cashEvidenceInstructions: string | null;
  approverCandidates: SubstituteReceiptApproverCandidate[];
  updatedByUserId: string | null;
  updatedAt: string | null;
};

export type SubstituteReceiptRuntimePolicy = Pick<
  SubstituteReceiptPolicySettings,
  'configured' | 'ready' | 'approvalMode' | 'cashEvidencePolicy' | 'cashEvidenceInstructions'
> & {
  /** R9: the caller already has an ACTIVE personal signature, so signing needs no upload. */
  hasReusableSignature: boolean;
  /** A8: the same image the certificate will carry, so nobody signs blind. Short-lived signed URL,
   *  minted only for the caller's OWN reusable signature. Absent when there is none. */
  reusableSignaturePreviewUrl?: string | null;
};

export type UpdateSubstituteReceiptPolicyInput = {
  approvalMode: SubstituteReceiptApprovalMode;
  approverUserIds: string[];
  cashEvidencePolicy: SubstituteReceiptCashEvidencePolicy;
  cashEvidenceInstructions?: string;
};

// ---- Accountant shared evidence view ----

export type SharedEvidenceFilter = {
  dateField?: 'uploadedAt' | 'expenseDate';
  fromDate?: string;
  toDate?: string;
  yearMonth?: string;
  /** Narrows within the caller's branch scope; an out-of-scope id yields zero rows (ANDed with ABAC). */
  branchId?: string;
  status?: ExpenseStatus;
  sourceDocumentType?: SourceDocumentType;
  taxEvidenceStatus?: TaxEvidenceStatus;
  expenseCategoryId?: string;
  paymentStatus?: ExpensePaymentStatus;
  postingStatus?: ExpensePostingStatus;
  createdByUserId?: string;
  page?: number;
  pageSize?: number;
};

export type SharedEvidenceRow = {
  expenseId: string;
  expenseNumber: string | null;
  status: ExpenseStatus;
  /** Claim projection marker: evidence for a receipt-less claim line is the signed ใบเบิก. */
  sourceReimbursementRequestId: string | null;
  missingReceiptReason: string | null;
  sourceDocumentType: SourceDocumentType;
  taxEvidenceStatus: TaxEvidenceStatus;
  taxEvidenceReasonCode: TaxEvidenceReasonCode | null;
  vendorNameSnapshot: string | null;
  expenseDate: string;
  uploadedAt: string;
  grandTotalAmount: string;
  paymentStatus: ExpensePaymentStatus;
  postingStatus: ExpensePostingStatus;
  postingError: string | null;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  pendingPostingSourceType: ExpensePostingSourceType | null;
  pendingPostingSourceId: string | null;
  expenseCategoryId: string | null;
  categoryName: string | null;
  createdByUserId: string;
  attachments: ExpenseAttachmentRef[];
};

export type SharedEvidenceFolder = {
  yearMonth: string;
  expenseCount: number;
  evidenceCount: number;
  totalAmount: string;
};

export type SharedEvidenceView = {
  dateField: 'uploadedAt' | 'expenseDate';
  folders: SharedEvidenceFolder[];
  rows: SharedEvidenceRow[];
  total: number;
  page: number;
  pageSize: number;
};

// ---- Accountant export package (generic Thai accounting-office index + manifest) ----

export const ACCOUNTANT_INDEX_COLUMNS = [
  'company_name',
  'company_tax_id',
  'branch_code',
  'accounting_period',
  'uploaded_at',
  'document_date',
  'expense_number',
  'expense_status',
  'source_channel',
  'source_document_type',
  'tax_evidence_status',
  'tax_evidence_reason',
  'posting_status',
  'posting_error',
  'journal_entry_number',
  'requester_name',
  'uploader_name',
  'reviewer_name',
  'vendor_name',
  'vendor_tax_id',
  'vendor_branch_code',
  'vendor_document_number',
  'category_name',
  'account_hint_key',
  'description',
  'quantity',
  'subtotal_amount',
  'discount_amount',
  'taxable_amount',
  'vat_amount',
  'wht_amount',
  'grand_total_amount',
  'net_payable_amount',
  'paid_amount',
  'outstanding_amount',
  'payment_method',
  'paid_at',
  'payment_reference',
  'substitute_receipt_ref',
  'primary_evidence_ref',
  'supporting_evidence_refs',
  'web_url',
  'notes',
] as const;

export type AccountantIndexColumn = (typeof ACCOUNTANT_INDEX_COLUMNS)[number];

/** Human header labels for the export file (spec: expense-receipt-upload-spec.md). */
export const ACCOUNTANT_INDEX_COLUMN_LABELS: Record<AccountantIndexColumn, string> = {
  company_name: 'บริษัท',
  company_tax_id: 'เลขผู้เสียภาษีบริษัท',
  branch_code: 'สาขา',
  accounting_period: 'งวดบัญชี',
  uploaded_at: 'วันที่ส่งเข้าระบบ',
  document_date: 'วันที่เอกสาร',
  expense_number: 'เลขที่ค่าใช้จ่าย',
  expense_status: 'สถานะรายการ',
  source_channel: 'ช่องทางส่งเข้า',
  source_document_type: 'ประเภทเอกสาร',
  tax_evidence_status: 'สถานะหลักฐานภาษี',
  tax_evidence_reason: 'เหตุผลสถานะภาษี',
  posting_status: 'สถานะลงบัญชี',
  posting_error: 'สาเหตุลงบัญชีไม่สำเร็จ',
  journal_entry_number: 'เลขที่ JV',
  requester_name: 'ผู้ขอเบิก/ผู้ใช้จ่าย',
  uploader_name: 'ผู้ส่งเอกสาร',
  reviewer_name: 'ผู้ตรวจ',
  vendor_name: 'ผู้ขาย/ผู้รับเงิน',
  vendor_tax_id: 'เลขผู้เสียภาษีผู้ขาย',
  vendor_branch_code: 'สาขาผู้ขาย',
  vendor_document_number: 'เลขที่เอกสารผู้ขาย',
  category_name: 'หมวดค่าใช้จ่าย',
  account_hint_key: 'ผังบัญชีแนะนำ',
  description: 'รายละเอียด',
  quantity: 'จำนวน',
  subtotal_amount: 'มูลค่าก่อนส่วนลด/ภาษี',
  discount_amount: 'ส่วนลด',
  taxable_amount: 'ฐานภาษี',
  vat_amount: 'ภาษีมูลค่าเพิ่ม (VAT)',
  wht_amount: 'หัก ณ ที่จ่าย',
  grand_total_amount: 'ยอดรวม',
  net_payable_amount: 'ยอดสุทธิที่ต้องจ่าย/คืน',
  paid_amount: 'ยอดที่จ่ายแล้ว',
  outstanding_amount: 'ยอดค้างจ่าย/ค้างคืน',
  payment_method: 'วิธีชำระเงิน',
  paid_at: 'วันที่จ่าย',
  payment_reference: 'เลขอ้างอิงการจ่าย',
  substitute_receipt_ref: 'อ้างอิงใบแทนใบเสร็จ',
  primary_evidence_ref: 'ไฟล์หลักฐานหลัก',
  supporting_evidence_refs: 'ไฟล์แนบเพิ่มเติม',
  web_url: 'ลิงก์เปิดในระบบ',
  notes: 'หมายเหตุ',
};

/** Everyday view: what a non-accountant needs to read the export at a glance. */
export const ACCOUNTANT_INDEX_SUMMARY_COLUMNS: readonly AccountantIndexColumn[] = [
  'document_date',
  'vendor_name',
  'description',
  'category_name',
  'grand_total_amount',
  'vat_amount',
  'expense_status',
];

export type AccountantIndexColumnSet = 'summary' | 'full';

export function accountantIndexColumns(columnSet: AccountantIndexColumnSet): readonly AccountantIndexColumn[] {
  return columnSet === 'summary' ? ACCOUNTANT_INDEX_SUMMARY_COLUMNS : ACCOUNTANT_INDEX_COLUMNS;
}

export type AccountantPackageIndexRow = Record<AccountantIndexColumn, string>;

export type EvidenceManifestEntry = {
  evidence_ref: string;
  expense_id: string;
  attachment_id: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  evidence_role: string;
  source_document_type: SourceDocumentType;
  tax_evidence_status: TaxEvidenceStatus;
  download_url: string;
  download_url_expires_at: string;
  web_url: string;
};

export type AccountantPackageRequest = SharedEvidenceFilter & {
  format?: 'csv';
  /** Column set of the downloadable index file. Default `summary`. */
  columnSet?: AccountantIndexColumnSet;
};

export type AccountantPackageResult = {
  generatedAt: string;
  filterSummary: Record<string, string>;
  rowCount: number;
  totalMatched: number;
  truncated: boolean;
  indexRows: AccountantPackageIndexRow[];
  /** Machine-key CSV in full spec column order, for system-to-system consumers. */
  indexCsv: string;
  /** Real .xlsx (base64) with Thai header labels — what the UI downloads. */
  indexXlsxBase64: string;
  columnSet: AccountantIndexColumnSet;
  evidenceManifest: EvidenceManifestEntry[];
};
