import type { ExpenseAttachmentRef, ExpenseDocumentReviewSource, ExpenseLineSummary } from './expenses.js';

export type ExpenseEvidenceAssessment = {
  route: 'SOURCE_DOCUMENT' | 'ALTERNATIVE_EVIDENCE' | 'SUBSTITUTE_RECEIPT';
  receiptProblem: 'NONE' | 'NOT_AVAILABLE' | 'LOST' | 'MATERIAL_INCOMPLETE';
  attachmentIds: string[];
  reason: string;
};

export type ExpenseEvidenceSource = ExpenseDocumentReviewSource & {
  aiVerificationSummaryJson?: Record<string, unknown> | null;
  attachments?: readonly (Partial<Pick<ExpenseAttachmentRef, 'id' | 'status' | 'checksumSha256'>> & { purpose?: string })[];
  lines?: readonly Partial<ExpenseLineSummary>[];
  expenseDate?: string | Date | null;
  vendorNameSnapshot?: string | null;
  vendorTaxIdSnapshot?: string | null;
  vendorBranchCodeSnapshot?: string | null;
  vendorEntityKindSnapshot?: string | null;
  vendorDocumentNumber?: string | null;
  currency?: string;
  vatMode?: string;
  inputVatClaimStatus?: string;
  grandTotalAmount?: string;
  vatAmount?: string;
  whtAmount?: string;
  note?: string | null;
  paidAt?: string | Date | null;
  paymentMethod?: string | null;
};

export const EXPENSE_RECEIPT_SOURCE_TYPES = ['RECEIPT', 'TAX_INVOICE', 'ABBREVIATED_TAX_INVOICE', 'HANDWRITTEN_CASH_BILL'] as const;

function validAssessmentShape(value: unknown): value is ExpenseEvidenceAssessment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['route', 'receiptProblem', 'attachmentIds', 'reason'].includes(key))
    || !['SOURCE_DOCUMENT', 'ALTERNATIVE_EVIDENCE', 'SUBSTITUTE_RECEIPT'].includes(String(input.route))
    || !['NONE', 'NOT_AVAILABLE', 'LOST', 'MATERIAL_INCOMPLETE'].includes(String(input.receiptProblem))
    || typeof input.reason !== 'string' || input.reason.length > 2000
    || !Array.isArray(input.attachmentIds) || input.attachmentIds.length > 100
    || input.attachmentIds.some(id => typeof id !== 'string' || !id)
    || new Set(input.attachmentIds).size !== input.attachmentIds.length) return false;
  return true;
}

export function isExpenseEvidenceFile(file: { status?: string; purpose?: string; isHistorical?: boolean }): boolean {
  return !file.isHistorical && file.status === 'ACTIVE' && file.purpose !== 'expense.review.evidence';
}

/** Unresolved facts may be saved; malformed or foreign file references may not. */
export function expenseEvidenceInputError(value: unknown, source: ExpenseEvidenceSource, complete = false): string | null {
  if (!validAssessmentShape(value)) return 'ข้อมูลการเลือกหลักฐานไม่ถูกต้อง';
  const input = value;
  if (input.attachmentIds.some(id => !source.attachments?.some(file => file.id === id && isExpenseEvidenceFile(file)))) return 'หลักฐานที่เลือกใช้ไม่ได้ กรุณาเลือกไฟล์ของรายการนี้อีกครั้ง';
  if (!complete) return null;
  if (source.sourceDocumentType === 'NEEDS_REVIEW' || source.taxEvidenceStatus === 'NEEDS_REVIEW') return 'เลือกประเภทเอกสารและสถานะหลักฐานภาษีก่อนบันทึกการตรวจ';
  if (input.route === 'SOURCE_DOCUMENT') {
    if (input.receiptProblem !== 'NONE' || !input.attachmentIds.length) return 'เลือกเอกสารที่ใช้ประกอบรายการ หรือระบุปัญหาของเอกสาร';
    if (['TRANSFER_SLIP', 'EXPENSE_NOTE_TEXT', 'SUBSTITUTE_RECEIPT', 'MARKETPLACE_ORDER_SCREENSHOT'].includes(source.sourceDocumentType)) return 'เอกสารนี้เป็นหลักฐานอื่น กรุณาเลือกทางใช้หลักฐานให้ตรงกับเอกสาร';
  } else {
    if (input.receiptProblem === 'NONE') return 'ระบุปัญหาของใบเสร็จก่อนเลือกทางนี้';
    if (input.route === 'SUBSTITUTE_RECEIPT' && input.reason.length > 500) return 'เหตุผลสำหรับใบรับรองต้องไม่เกิน 500 ตัวอักษร';
    if (input.route === 'ALTERNATIVE_EVIDENCE' && (!input.attachmentIds.length || !input.reason.trim())) return 'เลือกหลักฐานและบอกเหตุผลที่ใช้ประกอบรายการนี้';
    if (source.taxEvidenceStatus !== 'SUPPORTING_ONLY' || source.inputVatClaimStatus === 'CLAIMABLE') return 'หลักฐานทางนี้ใช้ประกอบรายการ แต่ใช้เครดิต VAT ไม่ได้';
  }
  return null;
}

export function expenseEvidenceAssessment(source: ExpenseEvidenceSource): ExpenseEvidenceAssessment | null {
  const review = source.aiVerificationSummaryJson?.documentReview as Record<string, unknown> | undefined;
  const value = source.aiVerificationSummaryJson?.documentEvidenceDraft ?? review?.assessment;
  if (!validAssessmentShape(value)) return null;
  return value as ExpenseEvidenceAssessment;
}

function scalar(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}
function decimal(value: unknown): string | null {
  const text = scalar(value);
  return text?.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function canonicalAssessment(value: ExpenseEvidenceAssessment) {
  return { route: value.route, receiptProblem: value.receiptProblem, reason: value.reason.trim(), attachmentIds: [...value.attachmentIds].sort() };
}

/** Canonical semantic snapshot, identical for the API's Date/string and web's JSON projections.
 * Numbering, generated signatures, updatedAt, and unrelated attachments are deliberately excluded. */
export function expenseEvidenceFingerprint(source: ExpenseEvidenceSource, assessment: ExpenseEvidenceAssessment): string {
  const values = source as unknown as Record<string, unknown>;
  const fields = ['sourceDocumentType', 'taxEvidenceStatus', 'expenseCategoryId', 'extractionId', 'vendorNameSnapshot', 'vendorTaxIdSnapshot',
    'vendorBranchCodeSnapshot', 'vendorEntityKindSnapshot', 'vendorDocumentNumber', 'currency', 'vatMode', 'inputVatClaimStatus'];
  const lineFields = ['description', 'expenseCategoryId', 'chargeKind', 'vatTreatment', 'accountHintKey', 'taxCategory', 'taxCodeDefinitionId', 'externalTaxCode'];
  const lineAmounts = ['quantity', 'unitPrice', 'discountAmount', 'lineSubtotalAmount', 'vatRate', 'vatAmount', 'whtRate', 'whtAmount', 'lineTotalAmount'];
  return JSON.stringify({
    fields: fields.map(key => scalar(values[key])),
    extraction: [scalar(source.aiVerificationSummaryJson?.extractionRequestId), scalar(source.aiVerificationSummaryJson?.extractionAttachmentId)],
    date: scalar(source.expenseDate)?.slice(0, 10) ?? null,
    amounts: ['grandTotalAmount', 'vatAmount', 'whtAmount'].map(key => decimal(values[key])),
    // The certificate wizard owns its purpose and payment details and validates them on prepare/issue.
    purpose: assessment.route === 'SUBSTITUTE_RECEIPT' ? null : scalar(source.note),
    payment: assessment.route === 'ALTERNATIVE_EVIDENCE' ? [scalar(source.paidAt)?.slice(0, 10) ?? null, scalar(source.paymentMethod)] : null,
    lines: [...(source.lines ?? [])].sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0)).map(line => {
      const row = line as unknown as Record<string, unknown>;
      const tax = row.taxSnapshot as Record<string, unknown> | null | undefined;
      return [lineFields.map(key => scalar(row[key] ?? (['taxCodeDefinitionId', 'externalTaxCode'].includes(key) ? tax?.[key] : null))), lineAmounts.map(key => decimal(row[key]))];
    }),
    assessment: canonicalAssessment(assessment),
    attachments: [...assessment.attachmentIds].sort().map(id => {
      const file = source.attachments?.find(item => item.id === id && item.status === 'ACTIVE');
      return [id, file?.checksumSha256 ?? null, file?.status ?? null];
    }),
  });
}

export function hasCurrentExpenseEvidenceReview(source: ExpenseEvidenceSource): boolean {
  const raw = source.aiVerificationSummaryJson?.documentReview;
  if (!raw || typeof raw !== 'object') return false;
  const review = raw as Record<string, unknown>;
  const assessment = expenseEvidenceAssessment(source);
  return review.version === 2 && typeof review.reviewedAt === 'string' && typeof review.reviewedByUserId === 'string'
    && Boolean(assessment) && !expenseEvidenceInputError(assessment, source, true)
    && !expenseEvidenceInputError(review.assessment, source, true)
    && JSON.stringify(canonicalAssessment(assessment!)) === JSON.stringify(canonicalAssessment(review.assessment as ExpenseEvidenceAssessment))
    && review.fingerprint === expenseEvidenceFingerprint(source, assessment!);
}

/** Shared preflight and in-transaction evidence requirement; it never decides payment or VAT entitlement. */
export function expenseEvidenceConfirmationError(source: ExpenseEvidenceSource & {
  substituteReceiptEvidence?: { status: string; artifactAttachmentId?: string | null } | null;
}, coveredByClaimForm = false): string | null {
  if (coveredByClaimForm) return null;
  if (source.substituteReceiptEvidence?.status === 'ISSUED' && source.substituteReceiptEvidence.artifactAttachmentId) return null;
  if (!hasCurrentExpenseEvidenceReview(source)) return 'กรุณาบันทึกการตรวจเอกสารและหลักฐานล่าสุดก่อนยืนยัน';
  if (expenseEvidenceAssessment(source)?.route === 'SUBSTITUTE_RECEIPT') {
    if (!source.substituteReceiptEvidence || source.substituteReceiptEvidence.status === 'SUPERSEDED') {
      return 'กรุณากลับไปตรวจเอกสารและเลือกหลักฐานที่ใช้กับรายการนี้ หรือจัดทำใบรับรองฉบับใหม่ก่อนยืนยัน';
    }
    return 'เปิดใบรับรองฉบับเดิมและดำเนินการให้สมบูรณ์ก่อนยืนยัน';
  }
  return null;
}
