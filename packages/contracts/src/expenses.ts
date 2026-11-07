import { EXPENSE_MAX_ITEM_LINES } from './expense-item-limits.js';
import { E_WHT_WORDS } from './tax.js';
import { REIMBURSEMENT_DUPLICATE_BLOCK_LABEL } from './reimbursements.js';
import { hasCurrentExpenseEvidenceReview } from './expense-evidence.js';
import { PAYMENT_DATE_IN_FUTURE } from './civil-date.js';
import { TAX_FORM_SHORT_NAMES, withholdingPeriodLockedMessage } from './tax.js';
import { THAI_SYSTEM_ROLE_NAMES } from './employee-access.js';
export * from './expense-evidence.js';
// Item 09 – Expense and Receipt Upload contracts

import {
  BUSINESS_DOCUMENT_KINDS,
  RECEIPT_ADDITIONAL_CHARGE_KINDS,
  type AiBudgetScope,
  type BusinessDocumentClassification,
  type BusinessDocumentKind,
  type ReceiptOcrFieldResult,
} from './line-ai.js';
import type { TaxFormType } from './tax.js';
import type { BuyerEntityKind } from './company-tax-identity.js';
import type { ExpenseCaptureReadStatus } from './expense-capture.js';
import type { ExpenseDocumentDateStatus } from './line-ai-value-normalizer.js';

export const EXPENSE_STATUSES = ['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'VOIDED'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
/** A document may categorise goods individually; charges do not need their own category. */
export function hasExpenseCategory(expense: { expenseCategoryId?: string | null; categoryName?: string | null; lines?: readonly { expenseCategoryId?: string | null; chargeKind?: string | null }[] }): boolean {
  if (expense.expenseCategoryId || expense.categoryName?.trim()) return true;
  const goods = expense.lines?.filter(line => !line.chargeKind) ?? [];
  return goods.length > 0 && goods.every(line => Boolean(line.expenseCategoryId));
}
export type ExtractionStatus = 'NOT_REQUESTED' | 'NOT_CONFIGURED' | 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
export type FreeExpenseAllowance = {
  source: 'FREE_MONTHLY_3';
  monthKey: string;
  limit: number;
  usedCount: number;
  inFlightCount: number;
  remainingCount: number;
  resetAt: string;
};
export type ExpenseExtractionResult = {
  status: 'ok' | 'not_expense_document' | 'not_configured' | 'unsupported' | 'no_attachment' | 'failed';
  fields?: ReceiptOcrFieldResult;
  missingFields?: string[];
  classification?: BusinessDocumentClassification;
  errorCode?: string;
  /** Server-confirmed monthly free read allowance, present on successful free reads only. */
  freeAllowance?: FreeExpenseAllowance;
  /** Set only when `errorCode` is one of `AI_BUDGET_REFUSAL_CODES` (spec §9.1). Never a money amount. */
  budgetScope?: AiBudgetScope;
  /**
   * Capture appendix §3: a read that could not finish inside the request answers with the durable
   * job instead of a result. Absent means the read was synchronous, exactly as before — the client
   * that does not know these fields keeps its current behaviour.
   */
  readJobId?: string;
  readStatus?: ExpenseCaptureReadStatus;
};
export type AiVerificationStatus = 'NOT_VERIFIED' | 'VERIFYING' | 'AI_VERIFIED' | 'PARTIAL' | 'NEEDS_REVIEW' | 'FAILED' | 'HUMAN_VERIFIED';
export type DuplicateStatus = 'NOT_CHECKED' | 'NO_MATCH' | 'POSSIBLE_DUPLICATE' | 'CONFIRMED_DUPLICATE' | 'OVERRIDDEN';
export const EXPENSE_PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOIDED'] as const;
export type ExpensePaymentStatus = (typeof EXPENSE_PAYMENT_STATUSES)[number];
export type ExpensePaymentRecordStatus = 'RECORDED' | 'VOIDED';
export type ExpensePostingStatus = 'not_required' | 'pending' | 'posted' | 'posting_error' | 'reversed';
export type ExpensePostingSourceType = 'expense.record' | 'expense.payment';
export type ExpenseVatMode = 'NO_VAT' | 'VAT_INCLUDED' | 'VAT_EXCLUDED' | 'EXEMPT' | 'NEEDS_REVIEW';
export const INPUT_VAT_CLAIM_STATUSES = ['CLAIMABLE', 'NON_CLAIMABLE', 'NEEDS_REVIEW'] as const;
export type InputVatClaimStatus = (typeof INPUT_VAT_CLAIM_STATUSES)[number];
export const EXPENSE_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];
export type ExpenseCaptureSource = 'WEB_UPLOAD' | 'WEB_MANUAL' | 'LINE_UPLOAD' | 'API_INTERNAL';
export type ExpenseAttachmentPurpose = 'expense.receipt.primary' | 'expense.receipt.supporting' | 'expense.payment.evidence' | 'expense.review.evidence' | 'expense.signature.asset';
export type ExpenseCategoryStatus = 'ACTIVE' | 'ARCHIVED';

export type SourceDocumentType =
  | 'RECEIPT'
  | 'TAX_INVOICE'
  | 'CUSTOMS_VAT_RECEIPT'
  | 'PP36_RECEIPT'
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
  'CUSTOMS_VAT_RECEIPT',
  'PP36_RECEIPT',
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

export function isCheckBillClassification(
  summary: Record<string, unknown> | null | undefined,
): boolean {
  const rawClassification = summary?.['classification'];
  return !!rawClassification
    && typeof rawClassification === 'object'
    && !Array.isArray(rawClassification)
    && (rawClassification as Record<string, unknown>)['documentKind'] === 'ORDER_OR_CHECK_BILL';
}

export function hasCheckBillSubstituteRoutingResolution(
  summary: Record<string, unknown> | null | undefined,
): boolean {
  if (!isCheckBillClassification(summary)) return false;
  const rawResolution = summary?.['classificationResolution'];
  if (!rawResolution || typeof rawResolution !== 'object' || Array.isArray(rawResolution)) return false;
  const resolution = rawResolution as Record<string, unknown>;
  const resolvedAt = resolution['resolvedAt'];
  const resolvedByUserId = resolution['resolvedByUserId'];
  return resolution['outcome'] === 'ROUTED_TO_SUBSTITUTE_RECEIPT'
    && resolution['acknowledgedPaidWithoutFinalReceipt'] === true
    && resolution['sourceDocumentKind'] === 'ORDER_OR_CHECK_BILL'
    && typeof resolvedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(resolvedAt)
    && Number.isFinite(Date.parse(resolvedAt))
    && typeof resolvedByUserId === 'string'
    && resolvedByUserId.trim().length > 0;
}

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
    hasCheckBillSubstituteRoutingResolution(summary)
    || (resolution['outcome'] === 'FINANCE_OVERRIDDEN_AS_EXPENSE'
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
    && resolvedByUserId.trim().length > 0)
  );
}

export type TaxEvidenceStatus = 'USABLE_FOR_TAX' | 'SUPPORTING_ONLY' | 'NOT_TAX_EVIDENCE' | 'NEEDS_REVIEW';

export type TaxEvidenceReasonCode =
  | 'VALID_TAX_INVOICE_FIELDS'
  | 'VALID_RECEIPT_FIELDS'
  | 'PAYMENT_EVIDENCE_ONLY'
  | 'MARKETPLACE_SCREENSHOT_ONLY'
  | 'HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE'
  | 'HANDWRITTEN_RECEIPT_REVIEW'
  | 'MISSING_VENDOR_TAX_ID'
  | 'MISSING_DOCUMENT_NUMBER'
  | 'MISSING_MONETARY_AMOUNT'
  | 'UNREADABLE_OR_LOW_CONFIDENCE'
  | 'NOT_BUSINESS_EVIDENCE'
  /** Spec §19h: ใบกำกับภาษีอย่างย่อ is valid expense evidence but cannot support an input-VAT
   *  credit (Revenue Code s.82/5). Distinct from a missing-field reason — nothing is missing. */
  | 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE'
  | 'MANUAL_OVERRIDE';

export const TAX_EVIDENCE_REASON_LABELS: Record<TaxEvidenceReasonCode, string> = {
  VALID_TAX_INVOICE_FIELDS: 'ข้อมูลใบกำกับภาษีครบถ้วน',
  VALID_RECEIPT_FIELDS: 'ข้อมูลใบเสร็จรับเงินครบถ้วน',
  PAYMENT_EVIDENCE_ONLY: 'เป็นหลักฐานการจ่ายเงินเท่านั้น',
  MARKETPLACE_SCREENSHOT_ONLY: 'เป็นภาพคำสั่งซื้อจากมาร์เก็ตเพลสเท่านั้น',
  HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE: 'หลักฐานประกอบการจ่าย ตรวจข้อมูลและเลือกหลักฐานให้ตรงกับรายการ',
  HANDWRITTEN_RECEIPT_REVIEW: 'บิลเงินสดเขียนมือ ตรวจข้อมูลและหลักฐานของรายการ',
  MISSING_VENDOR_TAX_ID: 'ขาดเลขประจำตัวผู้เสียภาษีของผู้ขาย',
  MISSING_DOCUMENT_NUMBER: 'ขาดเลขที่เอกสาร',
  MISSING_MONETARY_AMOUNT: 'ขาดยอดเงิน',
  UNREADABLE_OR_LOW_CONFIDENCE: 'เอกสารอ่านไม่ชัดหรือข้อมูลยังไม่น่าเชื่อถือ',
  NOT_BUSINESS_EVIDENCE: 'ไม่ใช่หลักฐานทางธุรกิจ',
  ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE: 'ใบกำกับภาษีอย่างย่อ ใช้เป็นค่าใช้จ่ายได้ แต่ขอคืนภาษีซื้อไม่ได้ — ถ้าต้องการเครดิตภาษีซื้อ ขอใบกำกับภาษีเต็มรูปจากผู้ขาย',
  MANUAL_OVERRIDE: 'ผู้ตรวจแก้ไขผลด้วยตนเอง',
};

export type ExpenseLineReviewStatus = 'SUGGESTED' | 'REVIEWED' | 'NEEDS_REVIEW';

export type SignatureAssetStatus = 'PENDING_OWNER_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'ARCHIVED';
export type SignatureSubmitChannel = 'WEB' | 'LINE';
export type SubstituteReceiptEvidenceStatus = 'PREPARED' | 'PAYER_CERTIFIED' | 'ISSUED' | 'SUPERSEDED';
export type SubstituteReceiptCashEvidencePolicy =
  | 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE'
  | 'ALLOW_SUPPORTING_EVIDENCE_ONLY';

/** Check bills never prove payment, including cash and finance-overridden classifications. */
export function substituteReceiptRequiresPaymentEvidence(
  summary: Record<string, unknown> | null | undefined,
  paymentMethod: ExpensePaymentMethod | null | undefined,
  cashEvidencePolicy?: SubstituteReceiptCashEvidencePolicy | null,
): boolean {
  return isCheckBillClassification(summary)
    || Boolean(paymentMethod && paymentMethod !== 'CASH')
    || cashEvidencePolicy === 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE';
}

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
  maxExpenseLines: EXPENSE_MAX_ITEM_LINES,
  maxLineDescriptionLength: 200,
  maxEvidenceAttachments: 8,
  maxEvidenceFileNameLength: 255,
});

export const SUBSTITUTE_RECEIPT_LINE_LIMIT_MESSAGE = `ใบรับรอง 1 ใบรองรับได้สูงสุด ${EXPENSE_MAX_ITEM_LINES} รายการ แยกบันทึกเป็นหลายรายการค่าใช้จ่ายและจัดทำคนละใบ`;

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

export const EXPENSE_VAT_SOURCE_INPUT_TYPES = ['RATE', 'AMOUNT', 'BOTH', 'NONE'] as const;
export type ExpenseVatSourceInputType = (typeof EXPENSE_VAT_SOURCE_INPUT_TYPES)[number];
export type ExpenseVatSourceOrigin = 'OCR' | 'REVIEWER' | 'IMPORT';
export type ExpenseVatReconciliationStatus =
  | 'NOT_APPLICABLE'
  | 'MATCHED'
  | 'REVIEWER_ACCEPTED'
  | 'CALCULATED_ONLY'
  | 'SOURCE_ONLY'
  | 'MISMATCH'
  | 'NEEDS_REVIEW'
  | 'LEGACY_UNAVAILABLE';

export type ExpenseVatSourceLineInput = {
  lineNumber: number;
  inputType: ExpenseVatSourceInputType;
  vatRatePercent?: string;
  vatAmount?: string;
};

/** Source intent only. Calculated/accepted values are server-owned. */
export type ExpenseVatSourceInput = {
  inputType: ExpenseVatSourceInputType;
  vatRatePercent?: string;
  vatAmount?: string;
  lines?: ExpenseVatSourceLineInput[];
};

export type ExpenseVatCaptureSnapshotV1 = {
  version: 1;
  source: {
    inputType: ExpenseVatSourceInputType;
    origin: ExpenseVatSourceOrigin;
    vatRatePercent: string | null;
    vatAmount: string | null;
    taxableAmount: string | null;
    grossAmount: string | null;
    capturedAt: string;
    evidenceRefs?: string[];
    lineSources?: Array<ExpenseVatSourceLineInput & {
      origin: ExpenseVatSourceOrigin;
      evidenceRefs?: string[];
    }>;
  };
  calculation: {
    formula: 'INCLUDED' | 'EXCLUDED' | 'ZERO' | 'NOT_APPLICABLE' | 'MIXED';
    vatRatePercent: string | null;
    preVatAmount: string;
    vatBaseAmount: string;
    vatAmount: string;
    grossAmount: string;
    lineResults: Array<{
      lineNumber: number;
      vatRatePercent: string | null;
      calculatedTaxableAmount: string;
      acceptedTaxableAmount: string;
      calculatedVatAmount: string;
      acceptedVatAmount: string;
      residualAdjustment: string;
    }>;
    roundingMode: 'HALF_UP';
    decimalPlaces: 2;
    calculationVersion: 'expense-vat-v1';
  };
  reconciliation: {
    status: ExpenseVatReconciliationStatus;
    acceptedSource: 'SOURCE_AMOUNT' | 'CALCULATED' | null;
    differenceAmount: string | null;
    toleranceAmount: '0.05';
    /**
     * Plan 13.11.B: a blocked reconciliation names the line the reviewer has to open, never just a
     * document total. Unknown treatments come first (the plan forbids guessing them), otherwise the
     * VAT line the printed total disagrees with. Absent while nothing needs attention.
     */
    attentionLineNumbers?: number[];
  };
};

/**
 * Plan 13.11.B: "ใช้ยอดตามเอกสาร". An over-tolerance document VAT total is accepted only as a named
 * reviewer decision — `expense.review`, a written reason, and the VAT line that carries the
 * difference. Presence of this object IS the override flag; there is no silent amount change, both
 * the printed and the calculated VAT stay in `ExpenseVatCaptureSnapshotV1`.
 */
export type ExpenseVatSourceOverrideInput = {
  reason: string;
  vatLineNumber: number;
  /** Bind the decision to the saved values the reviewer actually saw. */
  expectedUpdatedAt: string;
};

export type ConfirmExpenseRequest = {
  vatSourceOverride?: ExpenseVatSourceOverrideInput;
};

/** Blocking reconciliation outcomes — confirmation stops here until the lines or a reviewer decide. */
export const EXPENSE_VAT_BLOCKING_STATUSES: readonly ExpenseVatReconciliationStatus[] =
  ['MISMATCH', 'NEEDS_REVIEW', 'SOURCE_ONLY'];

export function isBlockingExpenseVatReconciliation(
  snapshot: ExpenseVatCaptureSnapshotV1 | null | undefined,
): boolean {
  return Boolean(snapshot && EXPENSE_VAT_BLOCKING_STATUSES.includes(snapshot.reconciliation.status));
}

/**
 * Plan 13.11.B: the one sentence a blocked mixed-VAT receipt is explained with — printed total,
 * calculated total, difference, and the line to open. Shared by the API block and the review card
 * so the two cannot drift into telling the reviewer different things.
 */
export function expenseVatReconciliationMessage(snapshot: ExpenseVatCaptureSnapshotV1): string {
  const satang = (value: string | null): string | null =>
    value !== null && Number.isFinite(Number(value)) ? Math.abs(Number(value)).toFixed(2) : null;
  const attention = snapshot.reconciliation.attentionLineNumbers ?? [];
  const check = attention.length
    ? `ตรวจรายการที่ ${attention.join(', ')} หรือเลือก “ใช้ยอดตามเอกสาร” พร้อมระบุเหตุผล`
    : 'ตรวจรายการในเอกสาร หรือเลือก “ใช้ยอดตามเอกสาร” พร้อมระบุเหตุผล';
  const documentVat = satang(snapshot.source.vatAmount);
  const difference = satang(snapshot.reconciliation.differenceAmount);
  const calculated = satang(snapshot.calculation.vatAmount) ?? '0.00';
  return documentVat !== null && difference !== null
    ? `VAT จากเอกสาร ${documentVat} บาท แต่จากรายการที่เลือก ระบบคำนวณได้ ${calculated} บาท ต่างกัน ${difference} บาท ${check}`
    : `VAT จากเอกสารยังไม่ตรงกับที่ระบบคำนวณ ${check}`;
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
  CUSTOMS_VAT_RECEIPT: 'ใบเสร็จรับเงินกรมศุลกากร (VAT นำเข้า)',
  PP36_RECEIPT: 'ใบเสร็จรับเงิน ภ.พ.36',
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
  USABLE_FOR_TAX: 'ใช้ได้',
  SUPPORTING_ONLY: 'ใช้ได้เมื่อมีหลักฐานอื่นประกอบ',
  NOT_TAX_EVIDENCE: 'ใช้ไม่ได้',
  NEEDS_REVIEW: 'รอตรวจ',
};

export const INPUT_VAT_RIGHT_LABEL = 'ใช้ VAT ตอนยื่นภาษี';
export const TAX_EVIDENCE_LABEL = 'หลักฐานรายจ่าย';
export const INPUT_VAT_RIGHT_LABELS: Record<InputVatClaimStatus, string> = {
  NEEDS_REVIEW: 'รอตรวจสอบ', CLAIMABLE: 'ใช้ได้ตามเงื่อนไข', NON_CLAIMABLE: 'ใช้ไม่ได้',
};
export const TAX_EVIDENCE_BADGE_LABELS: Record<TaxEvidenceStatus, string> = {
  USABLE_FOR_TAX: 'หลักฐานรายจ่ายใช้ได้', SUPPORTING_ONLY: 'หลักฐานรายจ่ายต้องมีเอกสารอื่นประกอบ',
  NOT_TAX_EVIDENCE: 'ไม่ใช่หลักฐานรายจ่าย', NEEDS_REVIEW: 'หลักฐานรายจ่ายรอตรวจ',
};

/** PENDING_OWNER_APPROVAL and REJECTED are history only since the personal-signature decision
 *  (2026-08-20): nothing creates them any more, and the 2026-08-20 data migration activated every
 *  row that was still pending. The labels stay so an old REJECTED row still reads as one. */
export const SIGNATURE_ASSET_STATUS_LABELS: Record<SignatureAssetStatus, string> = {
  PENDING_OWNER_APPROVAL: 'รอเจ้าของกิจการอนุมัติ',
  ACTIVE: 'ใช้งานได้',
  REJECTED: 'ปฏิเสธ',
  // The button that produces this state says ลบลายเซ็น, so the badge says the same thing back.
  // "เก็บถาวร" read as filing something away — next to a still-visible preview it looked like the
  // delete had not happened.
  ARCHIVED: 'เลิกใช้แล้ว',
};

export type ExpenseCategoryAccountantAccount = { accountCode: string; accountName: string };
export type SetExpenseCategoryAccountantAccountInput = ExpenseCategoryAccountantAccount;

export type ExpenseCategorySummary = {
  accountantAccount?: ExpenseCategoryAccountantAccount | null;
  referencedOnly?: true;
  id: string;
  companyId: string | null;
  name: string;
  accountHintKey: string;
  /** Suggested input Tax Code, as its stable external code. Never a definition id. */
  defaultInputTaxCode: string | null;
  status: ExpenseCategoryStatus;
  sortOrder: number;
};

/** Source intent only: RATE uses percent (3 = 3%); AMOUNT uses baht. */
export type ExpenseWhtInput = {
  inputType: 'RATE' | 'AMOUNT';
  value: string;
  /** Explicit withholding base in baht; omission preserves the accepted pre-VAT-base behavior. */
  baseAmount?: string;
};
export type ExpenseWhtCapture = ExpenseWhtInput & { origin: 'REVIEWER' | 'OCR' };
/** HTTP bodies are contract types rather than DTO classes; validate source intent at runtime. */
/**
 * PostgreSQL Decimal(18,4) as a person may type it: fourteen integer digits, up to four decimals,
 * no sign, no exponent, no leading zero. It lives here because BOTH the API guard and the review
 * form need it — while it lived only in the API, the form accepted "0400" (JavaScript's Number()
 * reads it as 400), let the reviewer keep typing, and only failed on save with an English
 * Decimal(18,4) message. Owner report 2026-08-28.
 */
export const EXPENSE_DECIMAL_18_4_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;

export function validateExpenseWhtInput(input: unknown): string | null {
  if (input === undefined) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'whtInput must be an object.';
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['inputType', 'value', 'baseAmount'].includes(key))) {
    return 'whtInput contains server-owned or unsupported fields.';
  }
  if (value.inputType !== 'RATE' && value.inputType !== 'AMOUNT') return 'whtInput.inputType must be RATE or AMOUNT.';
  if (typeof value.value !== 'string' || !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(value.value)) {
    return 'WHT value must be non-negative with at most two decimal places and fit Decimal(18,4).';
  }
  if (value.inputType === 'RATE' && Number(value.value) > 100) return 'WHT percent must be between 0 and 100.';
  if (value.baseAmount !== undefined && (typeof value.baseAmount !== 'string'
    || !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(value.baseAmount))) {
    return 'WHT base must be non-negative baht with at most two decimal places and fit Decimal(18,4).';
  }
  return null;
}
/** An explicit zero treatment, independent of claimability and a selected Tax Code. */
export type ExpenseLineVatTreatment = 'ZERO_RATED' | 'EXEMPT' | 'NON_VAT';

/**
 * Spec `line-ai-draft-control-spec-th.md` §5.1: the additional charges a receipt prints under its
 * item block. ONE array, deliberately: the receipt OCR extractor already reported exactly these
 * seven kinds, and Prisma's `ExpenseLineChargeKind` mirrors it (asserted set-equal by
 * `prisma-enum-parity.spec.ts`), so a kind can never mean one thing on the way in and another in
 * the database.
 */
export const EXPENSE_LINE_CHARGE_KINDS = RECEIPT_ADDITIONAL_CHARGE_KINDS;
export type ExpenseLineChargeKind = (typeof EXPENSE_LINE_CHARGE_KINDS)[number];

export const EXPENSE_LINE_CHARGE_KIND_LABELS: Record<ExpenseLineChargeKind, string> = {
  SERVICE_CHARGE: 'ค่าบริการ',
  DELIVERY: 'ค่าส่ง',
  PACKAGING: 'ค่าบรรจุ',
  PLATFORM_FEE: 'ค่าธรรมเนียมแพลตฟอร์ม',
  TIP: 'ทิป',
  ROUNDING: 'ปัดเศษ',
  OTHER: 'อื่น ๆ',
};

/** ROUNDING is the one kind a document may print as a deduction ("ปัดเศษ -0.50"). */
export function expenseChargeKindAllowsNegative(kind: ExpenseLineChargeKind): boolean {
  return kind === 'ROUNDING';
}

/** Existing OCR provenance, never a client-editable description or an amount heuristic. */
export const EXPENSE_CALCULATED_ROUNDING_SOURCE = 'ระบบคำนวณส่วนต่างจากยอดสุทธิที่พิมพ์บนเอกสาร';
export function isCalculatedExpenseRounding(line: { chargeKind?: ExpenseLineChargeKind | null; sourceLineText?: string | null }): boolean {
  return line.chargeKind === 'ROUNDING' && line.sourceLineText === EXPENSE_CALCULATED_ROUNDING_SOURCE;
}

export type ExpenseDraftTotalsPreview = {
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  grandTotalAmount: string;
  netPayableAmount: string;
  outstandingAmount: string;
  chargesTotalAmount: string;
  calculatedAdjustmentAmount: string;
  printedRoundingAmount: string;
  vatCaptureSnapshotJson: ExpenseVatCaptureSnapshotV1 | null;
};

export type ExpenseLineSummary = {
  id: string;
  lineNumber: number;
  description: string;
  /** Non-null makes this an additional-charge row rather than a product row (§5.1). */
  chargeKind?: ExpenseLineChargeKind | null;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxableAmount: string;
  vatRate: string | null;
  vatTreatment?: ExpenseLineVatTreatment | null;
  vatAmount: string;
  whtCategoryCode?: string | null;
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
  /** Read-only provenance; superseded certificate files remain downloadable as history. */
  sourceExpenseId?: string;
  isHistorical?: boolean;
  substituteReceiptStatus?: string;
  id: string;
  purpose: ExpenseAttachmentPurpose;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string | null;
  status: string;
  createdAt: string;
};

export type RecordExpensePaymentInput = {
  slipAttachmentId?: string;
  /** Stable for one intent, including network retries; omitted only by legacy callers. */
  idempotencyKey?: string;
  paidAmount: string;
  paymentMethod?: ExpensePaymentMethod;
  /** Actual paid civil day, YYYY-MM-DD. Omission retains the legacy first-write instant. */
  paidAt?: string;
  bankAccountRef?: string;
};

export type ExpensePaymentSummary = {
  slipAttachmentId?: string | null;
  paidAtConfirmed?: boolean;
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
  cancellationReason?: string | null;
  disbursementVoucher?: { id: string | null; documentNumber: string } | null;
  cancelledDisbursementVoucher?: { id: string | null; documentNumber: string } | null;
  canIssueDisbursementVoucher?: boolean;
  createdByUserId: string;
  createdAt: string;
};

export type ExpenseCorrectionBlocker = 'disbursement_reserved' | 'not_confirmed' | 'ledger_posted' | 'journal_pending' | 'posting_unresolved'
  | 'certificate_issued' | 'certificate_permission_missing' | 'tax_period_filed' | 'live_claim' | 'permission_denied'
  | 'payment_voided' | 'no_balance' | 'missing_branch' | 'personal_advance' | 'accounting_period_locked' | 'recorded_payments' | 'legacy_paid_balance';

/** Read by the server from persisted financial/legal state, never inferred by the client. */
export type ExpenseCorrectionCapabilities = {
  disbursementReservation: { status?: 'DRAFT'; voucherId: string | null; documentNumber: string | null; preparerName: string | null; viewerMay: 'act' | 'open' | 'none'; viewerCanPay: boolean } | null;
  canReopen: boolean;
  reopenBlockers: ExpenseCorrectionBlocker[];
  certificateOnExpense?: { kind: 'SYSTEM' | 'EXTERNAL'; number: string | null; date: string | null; canCancel: boolean } | null;
  lockedAccountingPeriodKey?: string | null;
  lockedTaxPeriods?: Array<{ formType: TaxFormType; periodKey: string }>;
  canReject?: boolean;
  rejectBlocker?: ExpenseCorrectionBlocker | null;
  canRecordPayment: boolean;
  recordPaymentBlocker: ExpenseCorrectionBlocker | null;
  payments: Array<{ id: string; canCancel: boolean; cancelBlocker: ExpenseCorrectionBlocker | null }>;
};

export function expenseDisbursementReservationMessage(operation: 'recordPayment' | 'reopen' | 'void' | 'approveSubstitute', documentNumber: string | null, preparerName: string | null, viewerMay: 'act' | 'open' | 'none' = 'act', viewerCanPay = true): string {
  const document = documentNumber ? `รายการนี้อยู่ในใบเตรียมจ่ายเลขที่ ${documentNumber}` : 'รายการนี้ถูกจองไว้ในใบเตรียมจ่าย';
  const prefix = `${document}${preparerName ? ` จัดทำโดย ${preparerName}` : ''}`;
  if (viewerMay === 'open' && !(operation === 'recordPayment' && viewerCanPay)) return `${prefix} ให้ผู้จัดทำหรือผู้อนุมัติของใบนั้นกด "กลับไปแก้" หรือยกเลิกใบก่อน`;
  // The name is already in the prefix; say whom to ask and what to ask for.
  if (viewerMay === 'none') return `${prefix} ให้ติดต่อผู้จัดทำใบนั้นเพื่อนำรายการนี้ออกจากใบหรือยกเลิกใบก่อน`;
  const remedy = {
    recordPayment: viewerCanPay ? 'ให้บันทึกจ่ายจากใบนั้น หรือยกเลิกใบนั้นก่อนถ้าจะจ่ายแยก' : 'ให้ผู้มีสิทธิ์บันทึกจ่ายบันทึกจากใบนั้น หรือยกเลิกใบนั้นก่อนถ้าจะจ่ายแยก',
    reopen: 'ให้กด "กลับไปแก้" ที่ใบนั้นหรือยกเลิกใบนั้นก่อน แล้วจึงแก้ไขเอกสารนี้ได้',
    void: 'ให้นำรายการนี้ออกจากใบนั้นหรือยกเลิกใบนั้นก่อน แล้วจึงยกเลิกเอกสารนี้ได้',
    approveSubstitute: 'ให้ยกเลิกใบนั้นก่อน แล้วจึงอนุมัติใบรับรองแทนใบเสร็จได้',
  }[operation];
  return `${document}${preparerName ? ` จัดทำโดย ${preparerName}` : ''} ${remedy}`;
}

export const EXPENSE_VOID_CERTIFICATE_WORDS = {
  permissionMissing: `เอกสารนี้ออกหนังสือรับรอง 50 ทวิแล้ว การยกเลิกเอกสารจะยกเลิกหนังสือรับรองด้วย ซึ่งต้องใช้สิทธิ์จัดการหนังสือรับรอง 50 ทวิ ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้ที่มีสิทธิ์นั้นเป็นผู้ยกเลิก`,
  permissionMissingExternal: 'เอกสารนี้บันทึกไว้ว่าออกหนังสือรับรอง 50 ทวินอกระบบแล้ว การยกเลิกเอกสารจะยกเลิกการบันทึกนั้นด้วย ซึ่งต้องใช้สิทธิ์บันทึกหนังสือรับรองที่ทำนอกระบบ ให้ผู้ที่มีสิทธิ์นั้นเป็นผู้ยกเลิก',
  taxWorkspaceCertificate: 'รายจ่ายนี้มีหนังสือรับรอง 50 ทวิที่ออกจากหน้าภาษี จึงยกเลิกเอกสารจากหน้านี้ไม่ได้ แจ้งทีมงานมั่งมีเพื่อช่วยตรวจสอบ',
  attestationRequired: 'ยังไม่ได้ยืนยันเรื่องการยื่นภาษี ติ๊กยืนยันก่อนยกเลิกเอกสาร',
  periodLocked: (kind: 'SYSTEM' | 'EXTERNAL', periodKey: string, formType: string): string => withholdingPeriodLockedMessage(periodKey, 'ยกเลิกเอกสารนี้', formType, kind),
  changedRetry: 'มีคนทำรายการกับเอกสารนี้พร้อมกัน ระบบยังไม่ได้บันทึกการยกเลิก เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  statusChanged: 'เอกสารนี้ยกเลิกจากหน้าที่เปิดค้างไว้ไม่ได้ เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด',
  permissionDenied: `คุณไม่มีสิทธิ์ยกเลิกเอกสาร ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้ที่มีสิทธิ์เป็นผู้ยกเลิก`,
  reasonRequired: 'เหตุผลที่ยกเลิกเอกสารสั้นเกินไป กรอกอย่างน้อย 3 ตัวอักษร',
  numberUnavailable: `ระบบยังออกเลขสำหรับยกเลิกเอกสารไม่ได้ ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}ตรวจการตั้งค่าเลขเอกสารก่อนแล้วลองอีกครั้ง`,
  postingUnresolved: 'ยกเลิกเอกสารไม่ได้ ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ',
  accountingPeriodLocked: (periodKey: string): string => `เอกสารอยู่ในเดือน ${expenseCorrectionMonth(periodKey)} ที่ปิดบัญชีแล้ว จึงยกเลิกเอกสารไม่ได้ ให้ผู้ทำบัญชีตรวจสอบและเปิดเดือนนั้นก่อน`,
  taxPeriodLocked: (periodKey: string): string => `ภาษีของเดือน ${expenseCorrectionMonth(periodKey)} ถูกล็อกแล้ว จึงยกเลิกเอกสารไม่ได้ ให้ผู้ทำบัญชีตรวจสอบเรื่องการยื่นแบบเพิ่มเติม`,
} as const;

export function expenseVoidCertificatePermissionMessage(kind: 'SYSTEM' | 'EXTERNAL', number?: string | null): string {
  const message = kind === 'EXTERNAL' ? EXPENSE_VOID_CERTIFICATE_WORDS.permissionMissingExternal : EXPENSE_VOID_CERTIFICATE_WORDS.permissionMissing;
  return number ? message.replace('แล้ว การ', `แล้ว (เลขที่ ${number}) การ`) : message;
}

export const EXPENSE_CORRECTION_WORDS = {
  statusChanged: 'สถานะเอกสารนี้ยังแก้ไขไม่ได้ เปิดหน้านี้ใหม่เพื่อตรวจสถานะ',
  notFound: 'ไม่พบเอกสารนี้แล้ว เปิดหน้ารายจ่ายใหม่',
  permissionDenied: `คุณไม่มีสิทธิ์แก้ไขเอกสาร ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้ที่มีสิทธิ์เป็นผู้แก้ไข`,
  branchForbidden: 'คุณไม่มีสิทธิ์ทำรายการกับเอกสารของสาขานี้ ให้ผู้ที่มีสิทธิ์ดูแลสาขานี้ทำรายการให้',
  webRequired: 'แก้ไขเอกสารผ่านช่องทางนี้ไม่ได้ เปิดเอกสารในเว็บและเข้าสู่ระบบก่อนแก้ไขเอกสาร',
  certificateSourceChanged: 'รายจ่ายของหนังสือรับรองนี้ถูกแก้ไขหรือยกเลิกไปแล้ว เปิดหน้ารายจ่ายใหม่',
  certificateAttestationRequired: 'ยังไม่ได้ยืนยันเรื่องการยื่นภาษี ติ๊กยืนยันก่อนแก้ไขเอกสาร',
  certificateSpellingCorrection: 'ถ้าต้องแก้เฉพาะตัวสะกดชื่อหรือที่อยู่บนหนังสือรับรอง ใช้ปุ่ม "แก้ไขหนังสือรับรอง" ได้',
  saving: 'กำลังบันทึก…',
  reopen: 'แก้ไขเอกสาร',
  cancelPayment: 'ยกเลิกรายการจ่ายนี้',
  reason: 'เหตุผลที่แก้ไข',
  cancelReason: 'เหตุผลที่ยกเลิก',
  reject: 'ยกเลิกรายการ',
  reopenSubmit: 'เปิดเอกสารกลับไปตรวจสอบ',
  reopenDescription: 'เอกสารจะกลับไปตรวจสอบด้วยเลขเอกสารเดิม ตรวจข้อมูลก่อนยืนยันอีกครั้ง',
  retainedPayments: 'รายการจ่ายเดิมยังอยู่',
  correcting: 'กำลังแก้ไขเอกสารที่ยืนยันแล้ว',
  downloadAgain: 'ดาวน์โหลดเอกสารอีกครั้ง',
  certificateIssued: 'ออกเอกสารแล้ว',
  futurePaymentDate: PAYMENT_DATE_IN_FUTURE.message,
  sourceRefreshed: 'โหลดข้อมูลล่าสุดแล้ว ตรวจยอดและประวัติการจ่ายก่อนทำรายการอีกครั้ง',
  alreadyReopened: 'เอกสารเปิดแก้ไขอยู่แล้ว ตรวจข้อมูลล่าสุด',
  sourceRefreshFailed: 'โหลดข้อมูลล่าสุดไม่สำเร็จ เปิดหน้านี้ใหม่ก่อนทำรายการอีกครั้ง',
  paymentOnReopened: 'เอกสารถูกเปิดแก้ไขแล้ว จึงบันทึกจ่ายไม่ได้ ให้ผู้มีสิทธิ์ตรวจและยืนยันเอกสารก่อน',
  paymentOnUnconfirmed: 'เอกสารยังไม่ได้ยืนยัน จึงบันทึกจ่ายไม่ได้ ให้ผู้มีสิทธิ์ยืนยันเอกสารก่อน',
  paymentAlreadyCancelled: 'รายการจ่ายนี้ถูกยกเลิกไปแล้ว ดูได้ในประวัติการจ่าย',
  paymentReplayCancelled: 'การจ่ายรายการนี้ถูกยกเลิกไปแล้ว ระบบจึงไม่ได้บันทึกซ้ำ ถ้าต้องการจ่ายอีกครั้ง ให้เปิดหน้านี้ใหม่แล้วบันทึกการจ่ายใหม่',
  overpaid: 'จ่ายเกินยอดสุทธิ',
  // Direction-free: the payment card sits above this sentence on the last step and below it on the first.
  cancelBeforeConfirm: 'ยกเลิกรายการจ่ายที่เกินก่อนยืนยัน',
  /** Beside ส่งให้ตรวจ, which over-payment does not block: say what is true there. */
  sendableWhileOverpaid: 'ส่งให้ตรวจได้ แต่ยืนยันเอกสารไม่ได้จนกว่าจะยกเลิกรายการจ่ายที่เกิน',
  askCancelBeforeConfirm: 'ให้ผู้มีสิทธิ์ยกเลิกรายการจ่ายก่อนยืนยัน',
  legacyOverpaid: 'ไม่พบรายการจ่ายให้ยกเลิก ติดต่อผู้มีสิทธิ์ยกเลิกเอกสาร',
  reasonRequired: 'เหตุผลต้องมี 3–500 ตัวอักษร แก้เหตุผลแล้วลองอีกครั้ง',
  reopened: 'เปิดเอกสารให้แก้ไขแล้ว ตรวจยอดก่อนยืนยันอีกครั้ง',
  paymentCancelled: 'ยกเลิกรายการจ่ายแล้ว ตรวจยอดค้างจ่ายก่อนบันทึกรายการใหม่',
  unavailable: 'ยังตรวจสิทธิ์แก้ไขไม่ได้ เปิดหน้านี้ใหม่',
  sourceChanged: 'ข้อมูลเอกสารเปลี่ยนแล้ว เปิดหน้านี้ใหม่และตรวจข้อมูลก่อนทำรายการ',
  certificateUnavailable: 'ยังไม่มีหนังสือรับรองที่ระบบออกให้ดาวน์โหลด ตรวจสถานะเอกสาร',
  paidExceedsPayable: 'ยอดที่จ่ายแล้วเกินยอดสุทธิที่ต้องจ่าย ตรวจยอดและประวัติการจ่ายก่อนยืนยัน',
} as const;

export function expenseReopenedMessage(hasPayments: boolean): string {
  return `${EXPENSE_CORRECTION_WORDS.reopened}${hasPayments ? ` ${EXPENSE_CORRECTION_WORDS.retainedPayments}` : ''}`;
}
/** Stored money is Decimal(18,4). Match confirmation's half-satang tolerance without float loss. */
export function expenseOverpaidAmount(expense: { paidAmount?: string; netPayableAmount?: string }): string | null {
  const scaled = (value?: string) => {
    if (!value || !/^\d+(?:\.\d{1,4})?$/.test(value)) return 0n;
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, '0'));
  };
  const excess = scaled(expense.paidAmount) - scaled(expense.netPayableAmount);
  return excess > 50n ? `${excess / 10000n}.${String(excess % 10000n).padStart(4, '0')}` : null;
}
export function expenseOverpaymentRemedy(hasRecordedPayments: boolean, canCancel: boolean): string {
  return !hasRecordedPayments ? EXPENSE_CORRECTION_WORDS.legacyOverpaid : canCancel
    ? EXPENSE_CORRECTION_WORDS.cancelBeforeConfirm : EXPENSE_CORRECTION_WORDS.askCancelBeforeConfirm;
}
/** Review-form withholding guidance. Blank no longer means "no withholding": the decision is its own control. */
export const EXPENSE_WITHHOLDING_WORDS = {
  /** `noLabel` is the decision option as printed on screen, so the way out always names a real control. */
  wayOut: (noLabel: string) => `เลือก “${noLabel}” ถ้ารายการนี้ไม่ต้องหัก ณ ที่จ่าย`,
  percentHint: 'กรอกเปอร์เซ็นต์ตามเอกสาร เช่น 3 คือหัก 3% จากยอดที่ใช้คิดหัก ณ ที่จ่าย',
  amountHint: 'ยอดที่กรอกต้องไม่เกินยอดที่ใช้คิดหัก ณ ที่จ่ายและยอดรวมเมื่อบันทึก',
} as const;
/** Last review step: the sentence follows the button actually shown (ส่งให้ตรวจ keeps the dictionary's approver sentence). */
export const EXPENSE_REVIEW_STEP_WORDS = {
  thenConfirm: 'ดูสรุปอีกครั้ง แล้วยืนยัน',
  sentAwaitingConfirm: 'ดูสรุปทั้งหมดอีกครั้ง เอกสารนี้ส่งให้ตรวจแล้ว รอผู้มีสิทธิ์ยืนยัน',
} as const;
/** Keep the existing positive-money boundary; only remove insignificant leading zeroes. */
export function normalizeExpensePaymentAmount(value: string): string { return value.replace(/^0+(?=\d)/, ''); }

const EXPENSE_CORRECTION_ACTIONS = { reopen: 'เปิดแก้ไขเอกสาร', recordPayment: 'บันทึกจ่าย', cancelPayment: 'ยกเลิกรายการจ่าย', reject: EXPENSE_CORRECTION_WORDS.reject } as const;
export function expenseCorrectionMonth(periodKey?: string): string {
  if (!periodKey || !/^\d{4}-\d{2}$/.test(periodKey)) return '';
  return `${periodKey.slice(5)}/${Number(periodKey.slice(0, 4)) + 543}`;
}
export function expenseCorrectionBlockerMessage(blocker: ExpenseCorrectionBlocker, operation: keyof typeof EXPENSE_CORRECTION_ACTIONS = 'reopen', facts?: ExpenseCorrectionCapabilities, showsLedger = true): string {
  const action = EXPENSE_CORRECTION_ACTIONS[operation];
  if (!showsLedger && ['ledger_posted', 'journal_pending', 'posting_unresolved', 'accounting_period_locked'].includes(blocker)) {
    const month = blocker === 'accounting_period_locked' ? expenseCorrectionMonth(facts?.lockedAccountingPeriodKey ?? undefined) : '';
    return `${action}ไม่ได้${month ? ` (เดือน ${month})` : ''} ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ`;
  }
  switch (blocker) {
    case 'disbursement_reserved': return expenseDisbursementReservationMessage(operation === 'recordPayment' ? 'recordPayment' : 'reopen', facts?.disbursementReservation?.documentNumber ?? null, facts?.disbursementReservation?.preparerName ?? null, facts?.disbursementReservation?.viewerMay ?? 'act', facts?.disbursementReservation?.viewerCanPay ?? true);
    case 'not_confirmed': return `สถานะเอกสารนี้${action}ไม่ได้ กลับไปหน้ารายจ่าย`;
    case 'ledger_posted': return `มีรายการลงบัญชีแล้ว จึง${action}ไม่ได้ ติดต่อผู้ทำบัญชี`;
    case 'posting_unresolved': return `สถานะการลงบัญชียังไม่ชัดเจน จึง${action}ไม่ได้ ติดต่อผู้ทำบัญชี`;
    case 'journal_pending': return `มีรายการบัญชีรอผ่านรายการ จึง${action}ไม่ได้ ติดต่อผู้ทำบัญชี`;
    case 'certificate_issued': return `ออกเอกสาร 50 ทวิแล้ว จึง${action}ไม่ได้ ติดต่อผู้ทำบัญชี`;
    case 'certificate_permission_missing': return facts?.certificateOnExpense?.kind === 'EXTERNAL'
      ? `เอกสารนี้บันทึกไว้ว่าออกหนังสือรับรองหัก ณ ที่จ่ายนอกระบบแล้ว${facts?.certificateOnExpense?.number ? ` (เลขที่ ${facts.certificateOnExpense.number})` : ''} การแก้ไขจะยกเลิกการบันทึกนั้นด้วย ซึ่งต้องใช้สิทธิ์บันทึกหนังสือรับรองที่ทำนอกระบบ ให้ผู้ที่มีสิทธิ์นั้นเป็นผู้แก้ไข`
      : `เอกสารนี้ออกหนังสือรับรองหัก ณ ที่จ่ายแล้ว${facts?.certificateOnExpense?.number ? ` (เลขที่ ${facts.certificateOnExpense.number})` : ''} การแก้ไขจะยกเลิกหนังสือรับรองใบเดิมด้วย ซึ่งต้องใช้สิทธิ์จัดการหนังสือรับรองหัก ณ ที่จ่าย ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้ที่มีสิทธิ์นั้นเป็นผู้แก้ไข`;
    case 'accounting_period_locked': return `เดือนบัญชี ${expenseCorrectionMonth(facts?.lockedAccountingPeriodKey ?? undefined)} ไม่เปิดรับรายการ จึง${action}ไม่ได้ ติดต่อผู้ทำบัญชี`;
    case 'tax_period_filed': {
      const withholding = facts?.lockedTaxPeriods?.find(period => period.formType === 'PND3' || period.formType === 'PND53');
      if (withholding && operation === 'reopen') return withholdingPeriodLockedMessage(withholding.periodKey, 'แก้ไขเอกสารนี้', withholding.formType, facts?.certificateOnExpense?.kind);
      if (withholding) return `รายการนี้ยื่นภาษีแล้ว จึง${action}ไม่ได้ ให้ยกเลิกเอกสารแล้วบันทึกใหม่ ให้ผู้ทำบัญชีแจ้งกรมสรรพากรเรื่องแบบเดิม`;
      return `รอบภาษีของเอกสารถูกล็อกแล้ว จึง${action}ไม่ได้ ติดต่อผู้ทำบัญชี` + (operation === 'reopen' && facts?.certificateOnExpense?.kind === 'SYSTEM' ? ` ${EXPENSE_CORRECTION_WORDS.certificateSpellingCorrection}` : '');
    }
    case 'live_claim': return `เอกสารอยู่ในคำขอเบิกที่ยังไม่จบ จึง${action}จากหน้านี้ไม่ได้ ติดต่อผู้ดูแลคำขอเบิก`;
    case 'permission_denied': return `คุณไม่มีสิทธิ์${action} ติดต่อผู้มีสิทธิ์${action}`;
    case 'payment_voided': return 'รายการจ่ายนี้ยกเลิกแล้ว โหลดหน้าใหม่';
    case 'no_balance': return 'ไม่มียอดค้างจ่าย จึงบันทึกจ่ายเพิ่มไม่ได้';
    case 'missing_branch': return 'เอกสารยังไม่มีสาขา จึงบันทึกจ่ายไม่ได้ ติดต่อผู้ดูแลรายจ่าย';
    case 'personal_advance': return 'ใบรับรองระบุว่าพนักงานจ่ายร้านแล้ว จึงบันทึกจ่ายซ้ำไม่ได้ ติดต่อผู้ดูแลการเบิกคืน';
    case 'legacy_paid_balance': return `มียอดจ่ายเดิมที่ไม่มีรายการให้ยกเลิก จึง${EXPENSE_CORRECTION_WORDS.reject}ไม่ได้ ติดต่อผู้มีสิทธิ์ยกเลิกเอกสาร`;
    case 'recorded_payments': return `ยังมีรายการจ่ายอยู่ จึง${EXPENSE_CORRECTION_WORDS.reject}ไม่ได้ ${facts?.payments.some(p => p.canCancel) ? 'ยกเลิกรายการจ่ายด้านล่างก่อน' : 'ให้ผู้มีสิทธิ์ยกเลิกรายการจ่ายก่อน'}`;
    default: return EXPENSE_CORRECTION_WORDS.unavailable;
  }
}
export function expenseReopenBlockerMessages(capabilities?: ExpenseCorrectionCapabilities, showsLedger = true): string[] {
  if (!capabilities || capabilities.canReopen) return [];
  return capabilities.reopenBlockers.flatMap(blocker => blocker === 'tax_period_filed' && capabilities.lockedTaxPeriods?.length
    ? capabilities.lockedTaxPeriods.map(period => period.formType === 'PND3' || period.formType === 'PND53'
      ? withholdingPeriodLockedMessage(period.periodKey, 'แก้ไขเอกสารนี้', period.formType, capabilities.certificateOnExpense?.kind) : `รอบ ${TAX_FORM_SHORT_NAMES[period.formType] ?? 'ภาษี'} เดือน ${expenseCorrectionMonth(period.periodKey)} ถูกล็อกแล้ว จึงเปิดแก้ไขเอกสารไม่ได้ ติดต่อผู้ทำบัญชี` + (capabilities.certificateOnExpense?.kind === 'SYSTEM' ? ` ${EXPENSE_CORRECTION_WORDS.certificateSpellingCorrection}` : ''))
    : [expenseCorrectionBlockerMessage(blocker, 'reopen', capabilities, showsLedger)]);
}
export function expenseConfirmedLockMessage(capabilities?: ExpenseCorrectionCapabilities, hasPayments = false): string {
  return capabilities?.canReopen
    ? `เอกสารยืนยันแล้ว จึงล็อกข้อมูลไว้ กด “${EXPENSE_CORRECTION_WORDS.reopen}” เพื่อกลับไปตรวจ${hasPayments ? ` ${EXPENSE_CORRECTION_WORDS.retainedPayments}` : ''}`
    : capabilities?.reopenBlockers.length ? 'เอกสารยืนยันแล้ว จึงล็อกข้อมูลไว้ เปิดแก้ไขไม่ได้ด้วยเหตุผลต่อไปนี้'
    : `เอกสารยืนยันแล้ว จึงล็อกข้อมูลไว้ ${EXPENSE_CORRECTION_WORDS.unavailable}`;
}

export type ExpenseReimbursementProgress = { requestId?: string; requestNo?: string | null; status: string; hasConfirmedDuplicate?: boolean };
export function isExpensePendingReview(row: { status: ExpenseStatus; reimbursementProgress?: ExpenseReimbursementProgress }): boolean {
  return isExpensePending(row.status) && !row.reimbursementProgress;
}
export function expenseReimbursementProgressLabel(progress: ExpenseReimbursementProgress): string {
  if (progress.hasConfirmedDuplicate && progress.status !== 'PAID') return REIMBURSEMENT_DUPLICATE_BLOCK_LABEL;
  const labels: Record<string, string> = { WAITING_CLAIM: 'รอยื่นเบิกคืน', DRAFT: 'ใบเบิกยังเป็นร่าง', PENDING_APPROVAL: 'รออนุมัติเบิกคืน', APPROVED: 'อนุมัติเบิกคืนแล้ว', FINANCE_REVIEW: 'รอตรวจการเงิน', READY_FOR_PAYMENT: 'รอจ่ายคืน', PARTIALLY_PAID: 'จ่ายคืนบางส่วน', PAID: 'จ่ายคืนแล้ว' };
  return labels[progress.status] ?? 'ติดตามใบเบิกคืน';
}

export type ExpenseSummary = {
  /** Any payment (including voided) or voucher line prevents physical deletion. */
  hasDeletionBlockingHistory?: boolean;
  /** Any retained certificate version, including SUPERSEDED, prevents physical deletion. */
  hasRetainedSubstituteReceiptEvidence?: boolean;
  cancelledCertificate?: { kind: 'SYSTEM' | 'EXTERNAL'; number: string | null };
  costSourceExpenseId?: string;
  reimbursementProgress?: ExpenseReimbursementProgress;
  id: string;
  companyId: string;
  branchId: string | null;
  expenseNumber: string | null;
  status: ExpenseStatus;
  captureSource: ExpenseCaptureSource;
  vendorCounterpartyId: string | null;
  /** Plain reservation pointer; no foreign key on ExpenseRecord. */
  reservedByDisbursementVoucherId?: string | null;
  vendorNameSnapshot: string | null;
  /** Vendor address spec §6: the seller address as printed on the document, one free-text block.
   *  On the summary because the list filters and reports on its absence (GAP-11). */
  vendorAddressSnapshot: string | null;
  vendorDocumentNumber: string | null;
  expenseDate: string;
  currency: string;
  vatMode: ExpenseVatMode;
  vatAmount: string;
  latestInputVatDecision?: Pick<ExpenseInputVatDecisionView, 'reason' | 'decidedByName' | 'decidedAt'> | null;
  /** Whether the right is relevant for this document date and VAT amount; presentation only. */
  inputVatRightVisible?: boolean;
  inputVatRecordedBeforeReview?: boolean;
  inputVatClaimStatus?: InputVatClaimStatus;
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
  /**
   * Spec §5.2: what `expenseDate` actually IS. The column is NOT NULL, so a list row showing a date
   * says nothing about whether anyone read it off the document — a receipt whose date failed to
   * parse shows the upload day, indistinguishable from a date the page printed. Derived from
   * `aiVerificationSummaryJson`; absent on rows captured before §5.2, which read as `verified`.
   */
  dateStatus?: ExpenseDocumentDateStatus;
  /**
   * The capture group this expense is a derived source of (appendix §5), or null/absent on every
   * ordinary expense. Present on the LIST so a row can be badged "จากกลุ่มหลักฐาน" without a
   * second request — the group itself is never a row here, it holds no money (A39).
   */
  captureGroupId?: string | null;
  uploadedAt: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Where a derived source came from, for the expense detail page (appendix §5, A39/A46).
 * The amounts are the reviewed allocation's, copied into `aiVerificationSummaryJson` at handoff:
 * `paidTotal` is what actually left the buyer, `companyAmount` what this expense is.
 */
export type ExpenseCaptureLineage = {
  groupId: string;
  scopeKey: string | null;
  allocationId: string | null;
  webPath: string;
  paidTotal: string | null;
  companyAmount: string | null;
  personalAmount: string | null;
};

export type ExpenseTotalsIdentity = {
  ok: boolean;
  /** Signed: stored grand total minus what the lines make. Describes THAT equation only — a record
   *  whose subtotal drifted reports `ok: false` with a zero gap, so branch on `ok`. */
  gapAmount: string;
};

/** One additional-charge row as a reader sees it: `amount` is what the document printed for the
 *  charge (its line subtotal), which is also the figure that enters the tax base. */
export type ExpenseChargeSummary = {
  kind: ExpenseLineChargeKind;
  label: string;
  amount: string;
  vatAmount: string;
};

/** The single derivation of `ExpenseDetail.charges`, shared by the API mapper, the LINE read tool
 *  and the web summary so the three can never disagree about what a charge row is worth. */
export function expenseLineCharges(
  lines: readonly { chargeKind?: ExpenseLineChargeKind | null; lineSubtotalAmount: string; vatAmount: string }[],
): ExpenseChargeSummary[] {
  return lines
    .filter((line): line is typeof line & { chargeKind: ExpenseLineChargeKind } => line.chargeKind != null)
    .map((line) => ({
      kind: line.chargeKind,
      label: EXPENSE_LINE_CHARGE_KIND_LABELS[line.chargeKind],
      amount: line.lineSubtotalAmount,
      vatAmount: line.vatAmount,
    }));
}

/** Ordinary receipt facts; no chat identity, provenance, tax or final-mutation authority. */
export type ExpenseSourceDraftItemInput = {
  /** Omit only when adding a new staged item. Omitted existing items are retained. */
  itemRef?: string;
  description?: string | null;
  quantity?: string | null;
  unitPrice?: string | null;
  totalAmount?: string | null;
  expenseCategoryId?: string | null;
};
export type ExpenseSourceDraftInput = {
  expenseDate?: string | null;
  vendorName?: string | null;
  /** Optional context. An absent or blank purpose never blocks review or confirmation. */
  businessPurpose?: string | null;
  items?: ExpenseSourceDraftItemInput[];
};
export type ExpenseSourceDraft = {
  status: 'OPEN' | 'PAUSED' | 'PAUSED_INTERRUPTED' | 'INPUT_ENDED_COMPLETE' | 'INPUT_ENDED_INCOMPLETE' | 'CANCELLED';
  canEdit: boolean;
  header: { expenseDate: string | null; vendorName: string | null; businessPurpose: string | null };
  items: Array<{
    itemRef: string;
    lineId: string | null;
    /** Explicitly added by the user, rather than an unaccepted OCR breakdown. */
    newItem?: boolean;
    description: string | null;
    quantity: string | null;
    unitPrice: string | null;
    totalAmount: string | null;
    expenseCategoryId: string | null;
  }>;
  missingFields: Array<{ id: string; scope: 'DOCUMENT' | 'ITEM'; itemRef?: string; field: string; prompt: string }>;
};

/** Server-owned acknowledgement of the document/tax review, bound to the receipt being reviewed. */
export type ExpenseDocumentReviewSource = {
  sourceDocumentType: SourceDocumentType;
  taxEvidenceStatus: TaxEvidenceStatus;
  expenseCategoryId?: string | null;
  primaryAttachmentId?: string | null;
  extractionId?: string | null;
};

export function expenseDocumentReviewFieldsComplete(source: Pick<ExpenseDocumentReviewSource, 'sourceDocumentType' | 'taxEvidenceStatus'>): boolean {
  return source.sourceDocumentType !== 'NEEDS_REVIEW' && Object.prototype.hasOwnProperty.call(SOURCE_DOCUMENT_TYPE_LABELS, source.sourceDocumentType)
    && source.taxEvidenceStatus !== 'NEEDS_REVIEW' && Object.prototype.hasOwnProperty.call(TAX_EVIDENCE_STATUS_LABELS, source.taxEvidenceStatus);
}

export function hasCurrentExpenseDocumentReview(source: import('./expense-evidence.js').ExpenseEvidenceSource): boolean {
  const raw = source.aiVerificationSummaryJson?.documentReview;
  if (!raw || typeof raw !== 'object' || !expenseDocumentReviewFieldsComplete(source)) return false;
  const review = raw as Record<string, unknown>;
  return review.version === 2 && hasCurrentExpenseEvidenceReview(source);
}

/**
 * Vendor-address spec §5 row 2 / §6 (Slice 2): the buyer block a full tax invoice printed — our own
 * company, as the seller typed it — and how it compared with the company registry at `checkedAt`.
 * Warn-only: nothing reads it to decide claimability (§8, E11). `differences` holds, per MISMATCH
 * reason, the printed value and the registry value it was compared against, so the review page
 * shows exactly what was judged instead of re-deriving it from a registry that may have moved since.
 */
export type ExpenseBuyerMatchStatus = 'MATCH' | 'MISMATCH' | 'UNCHECKED' | 'NOT_PRINTED';
export type ExpenseBuyerMismatchReason = 'TAX_ID' | 'BRANCH' | 'NAME' | 'POSTAL_CODE';
export type ExpenseBuyerAsPrinted = {
  name?: string;
  taxId?: string;
  branchCode?: string;
  addressText?: string;
  matchStatus: ExpenseBuyerMatchStatus;
  reasons?: ExpenseBuyerMismatchReason[];
  differences?: Array<{ reason: ExpenseBuyerMismatchReason; printed: string; registered: string }>;
  checkedAt: string;
  /** "ยืนยันว่าใช้ได้ พร้อมเหตุผล" (§8): kept only while the same mismatch of the same printed values stands. */
  overrideReason?: string;
  overriddenByUserId?: string;
  overriddenAt?: string;
  /**
   * The header claim status the "ทำเครื่องหมายใบนี้ใช้ภาษีซื้อไม่ได้" mark replaced, stamped in the same
   * save, so the mark can be taken back on screen. Present only while the expense stays NON_CLAIMABLE.
   */
  claimStatusBeforeMark?: Exclude<InputVatClaimStatus, 'NON_CLAIMABLE'>;
};

export type ExpenseDetail = ExpenseSummary & {
  whtRemittance: import('./tax.js').WhtRemittance | null;
  /** Same resolved evidence facts as the accounting evidence list. */
  sourceEvidenceUnavailable?: boolean;
  categoryName?: string | null;
  inputVatRight?: ExpenseInputVatRightView;
  reviewRequest?: { requestedReviewerUserId: string; requestedReviewerName: string; submittedByUserId: string; submittedByName: string; submittedAt: string } | null;
  /** Reopen audit, present only while correcting; not inferred from a document number. */
  correctionOpenedAt?: string | null;
  correctionCapabilities?: ExpenseCorrectionCapabilities;
  /** Slice 2; absent until a document with a buyer block has been read or re-checked. */
  buyerAsPrinted?: ExpenseBuyerAsPrinted | null;
  primaryAttachmentId?: string | null;
  extractionId?: string | null;
  sourceDraft?: ExpenseSourceDraft | null;
  /** Set when this expense is a reimbursement-claim projection — it is settled by the
   *  claim payout (RBPAY), never by a manual expense payment. */
  sourceReimbursementRequestId: string | null;
  vendorTaxIdSnapshot: string | null;
  vendorBranchCodeSnapshot: string | null;
  /** WHT payee taxpayer class: INDIVIDUAL files ภ.ง.ด.3, JURISTIC files ภ.ง.ด.53. */
  vendorEntityKindSnapshot: BuyerEntityKind | null;
  /** WHT certificate system issuance plan §1.2: ประเภทเงินได้/อัตรา, mirrors SupplierPayment. */
  whtCategoryCode: string | null;
  whtRate: string | null;
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
  vatCaptureSnapshotJson: ExpenseVatCaptureSnapshotV1 | null;
  whtInputJson?: ExpenseWhtCapture | null;
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
  /** §5.1 derived view of the `chargeKind != null` rows, so a reader never has to know the rule. */
  charges: ExpenseChargeSummary[];
  /** Does this stored record still add up? Computed from the stored header against the stored
   *  lines, so a row written before §5.1 existed — or by anything that bypasses the draft
   *  use-cases — is visible instead of printing a total its own parts contradict. Available for the
   *  S-3 explain tool and read by the web review page, which warns when `ok` is false. */
  totalsIdentity: ExpenseTotalsIdentity;
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
  /** Appendix §5: set only on a derived source of a capture group; null on everything else. */
  captureGroup?: ExpenseCaptureLineage | null;
};

export type ExpenseEWhtSetting = { used: boolean };
export type UpdateExpenseEWhtSettingInput = { used: boolean };

export type CreateExpenseDraftInput = {
  whtRemittance?: import('./tax.js').WhtRemittance | null;
  /** One deliberate save attempt, retained when retrying after an uncertain response. */
  idempotencyKey?: string;
  captureSource: ExpenseCaptureSource;
  branchId?: string;
  vendorCounterpartyId?: string;
  vendorNameSnapshot?: string;
  expenseDate: string;
  currency?: string;
  vatMode: ExpenseVatMode;
  inputVatClaimStatus?: InputVatClaimStatus;
  expenseCategoryId?: string;
  accountHintKey?: string;
  note?: string;
  missingReceiptReason?: string;
  vatSource?: ExpenseVatSourceInput;
  whtInput?: ExpenseWhtInput;
  lines: Array<{
    lineNumber: number;
    description: string;
    /**
     * §5.1: makes the row an additional charge — quantity 1, unit price = the printed amount, and
     * it must sort after every product row.
     *
     * On `updateExpenseDraft` (where `lines` is a full replacement) this field is the one
     * exception to that: ABSENT keeps whatever kind the line with this `lineNumber` already has,
     * and only an explicit `null` clears one. A client that echoes a line back without the field
     * would otherwise turn a service charge into a product and get a 200 for it. On create there
     * is nothing to keep, so absent and null both mean "not a charge".
     */
    chargeKind?: ExpenseLineChargeKind | null;
    quantity: string;
    unitPrice: string;
    discountAmount?: string;
    vatRate?: string;
    vatTreatment?: ExpenseLineVatTreatment | null;
    whtCategoryCode?: string;
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

export type UpdateExpenseDraftInput = Partial<Omit<CreateExpenseDraftInput, 'captureSource' | 'lines' | 'idempotencyKey' | 'expenseCategoryId' | 'vendorCounterpartyId'>> & {
  /** Explicitly detach an outdated vendor link when the seller identity changes. */
  vendorCounterpartyId?: string | null;
  /** Null explicitly clears the document-level category; line categories remain independent. */
  expenseCategoryId?: string | null;
  /** Interactive callers send the version they loaded; API PATCH/override routes require it. */
  expectedUpdatedAt?: string;
  /** Existing row identity survives edits/reordering; omit id for a new row. */
  lines?: Array<CreateExpenseDraftInput['lines'][number] & { id?: string; /** Scoped staged row explicitly reviewed in the same form. */ sourceItemRef?: string }>;
  /** Explicitly removed staged rows, scoped to this expense and reviewer-only. */
  removedSourceItemRefs?: string[];
  /** Null/blank clears a staged fact; absent preserves it unless the same reviewer request supplies
   * that ordinary header field. Originating uploaders send this alone with expectedUpdatedAt.
   * Reviewers may send it with the financial form so both views save under one revision/transaction. */
  sourceDraft?: ExpenseSourceDraftInput;
  vendorNameSnapshot?: string;
  vendorTaxIdSnapshot?: string;
  /** CON-8: exactly five digits, or blank/null to clear. Blank is stored as null — `'00000'` is a
   *  real value ("head office") a person may type, never what an empty field means. */
  vendorBranchCodeSnapshot?: string | null;
  /** Vendor address spec §6: ≤ 500 characters as printed; blank/null clears it. */
  vendorAddressSnapshot?: string | null;
  vendorEntityKindSnapshot?: BuyerEntityKind;
  /** WHT certificate system issuance plan §1.2: mirrors SupplierPayment.whtCategoryCode/whtRate. */
  whtCategoryCode?: string;
  whtRate?: string;
  vendorDocumentNumber?: string;
  receivedAt?: string;
  dueDate?: string;
  taxCategory?: string;
  internalMemo?: string;
  sourceDocumentType?: SourceDocumentType;
  sourceDocumentLanguage?: string;
  taxEvidenceStatus?: TaxEvidenceStatus;
  taxEvidenceReasonCode?: TaxEvidenceReasonCode;
  /** Explicit step-2 review; generic draft saves and OCR must not set this. */
  documentReviewAcknowledged?: true;
  /** Reviewed evidence route, independent of VAT eligibility. Partial draft saves do not acknowledge it. */
  evidenceAssessment?: import('./expense-evidence.js').ExpenseEvidenceAssessment;
  nonExpenseClassificationOverride?: NonExpenseClassificationOverrideInput;
  ocrTotalAcknowledgement?: OcrTotalAcknowledgementInput;
};

export type ListExpensesFilter = {
  companyId: string;
  /** Search document numbers within the existing read scope. */
  search?: string;
  branchId?: string;
  status?: ExpenseStatus;
  paymentStatus?: ExpensePaymentStatus;
  duplicateStatus?: DuplicateStatus;
  postingStatus?: ExpensePostingStatus;
  vendorCounterpartyId?: string;
  captureSource?: ExpenseCaptureSource;
  sourceDocumentType?: SourceDocumentType;
  /** GAP-11: full tax invoices whose vendor address is still empty, so they can be filled in over
   *  time. It pins `sourceDocumentType` to TAX_INVOICE — only that document type must carry one. */
  vendorAddressMissing?: boolean;
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
  /** The API returns only the caller's own rows, so these ids never disclose another user's image. */
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
  /** A7: same-origin inline URL for the caller's derived (or original) personal signature image. */
  previewUrl?: string | null;
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

export type SubstituteReceiptFundingSource = 'COMPANY' | 'PERSONAL_ADVANCE';

export type SubstituteReceiptListItem = {
  /** State eligibility only; the mutation still checks current policy, claims and revision. */
  canCancel?: boolean;
  signatureMode?: SubstituteReceiptSignatureMode;
  fundingSource?: SubstituteReceiptFundingSource | null;
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
  paperFormPrepared?: boolean;
  paperSubmission?: SubstituteReceiptPaperSubmission | null;
  paperReviewedByUserId?: string | null;
  payerUserId: string | null;
  payerName: string;
  approverUserId: string | null;
  approverName: string | null;
  artifactAttachmentId: string | null;
  certifiedArtifactAttachmentId: string | null;
  updatedAt: string;
};

export type SubstituteReceiptListFilter = {
  order?: 'newest' | 'oldest';
  status?: SubstituteReceiptEvidenceStatus;
  yearMonth?: string;
  payerUserId?: string;
  page?: number;
  pageSize?: number;
};

export type SubstituteReceiptListResult = {
  counts: Record<SubstituteReceiptEvidenceStatus, number>;
  sums: { total: string };
  attention: {
    signature: { count: number; evidenceId: string | null };
    approval: { count: number; evidenceId: string | null };
  };
  items: SubstituteReceiptListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type SubstituteReceiptEvidenceSummary = {
  correctionOfEvidenceId?: string | null;
  revisionOfEvidenceId?: string | null;
  correctionReason?: string | null;
  fundingSource?: SubstituteReceiptFundingSource | null;
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
  paperFormPrepared?: boolean;
  paperSubmission?: SubstituteReceiptPaperSubmission | null;
  paperReviewedByUserId?: string | null;
  payerUserId: string | null;
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

export type SubstituteReceiptPaperSigner = { name: string; position: string; signedOn: string };
export type SubstituteReceiptPaperSignerInput = Omit<SubstituteReceiptPaperSigner, 'position'> & { position?: string };
export type SubstituteReceiptPaperSigners = {
  payer: SubstituteReceiptPaperSigner;
  approver: SubstituteReceiptPaperSigner;
  samePerson: boolean;
};
export type SubstituteReceiptPaperSubmission = SubstituteReceiptPaperSigners & {
  uploadedByUserId: string;
  uploadedByName?: string;
  uploadedAt: string;
};
export type SubmitSubstituteReceiptPaperInput = {
  payer: SubstituteReceiptPaperSignerInput;
  approver: SubstituteReceiptPaperSignerInput;
  samePerson: boolean;
  attachmentId: string;
  checksumSha256: string;
  byteSize: number;
  formMatchesAcknowledged: true;
  expectedEvidenceUpdatedAt: string;
};
export type AcceptSubstituteReceiptPaperInput = {
  previewChecksumSha256: string;
  expectedEvidenceUpdatedAt: string;
  factsAndSignaturesAcknowledged: true;
  approverAuthorityAcknowledged: true;
  originalRetainedAcknowledged: true;
};
export type SubstituteReceiptPaperPreview = {
  pdfDataUrl: string;
  pageImageDataUrls: string[];
  previewChecksumSha256: string;
};

export type SupersedeSubstituteReceiptInput = {
  reason: string;
  expectedEvidenceUpdatedAt: string;
};

export type SubstituteReceiptCandidateFilter = { includeBlocked?: boolean; branchId?: string; search?: string; page?: number; pageSize?: number };
export type SubstituteReceiptCandidate = { blockedReason?: 'USABLE_RECEIPT'; id: string; expenseNumber: string | null; vendorDocumentNumber?: string | null; expenseDate: string;
  vendorNameSnapshot: string | null; grandTotalAmount: string; currency: string; lines: Array<{ description: string }> };
export type SubstituteReceiptCandidatePage = { items: SubstituteReceiptCandidate[]; total: number; page: number; pageSize: number };

export type GenerateSubstituteReceiptInput = {
  fundingSource: SubstituteReceiptFundingSource;
  paidInFullAcknowledged: true;
  reasonCode: SubstituteReceiptReasonCode;
  missingReceiptReason: string;
  businessPurpose: string;
  /** PAPER permits people without login accounts; DIGITAL still requires an active member. */
  signatureMode?: SubstituteReceiptSignatureMode;
  payerUserId?: string;
  payeeName?: string;
  payeeAddress?: string;
  payeeTaxId?: string;
  paymentEvidenceAttachmentIds?: string[];
  supportingAttachmentIds?: string[];
  paymentDate?: string;
  paymentMethod?: ExpensePaymentMethod;
  idempotencyKey: string;
  expectedExpenseUpdatedAt: string;
  /** Explicit human choice for an already-paid check bill with no final receipt. The API accepts
   *  this only when the authoritative raw classification is ORDER_OR_CHECK_BILL. */
  routeCheckBill?: true;
  /** R10: this prepare answers `ขอฟอร์มไปเซ็นเอง`, so the chat is now waiting for a photo of the
   *  signed sheet. Recorded on the continuation state the prepare consumes; ignored without one. */
  formRequested?: boolean;
  /** Opaque LINE handoff id; accepted values are reloaded server-side after authentication. */
  continuationId?: string;
  note?: string;
};

/** Edit incomplete certificate facts; payment month selects its owned number, funding and signing identities stay fixed. */
export type AmendSubstituteReceiptInput = Pick<GenerateSubstituteReceiptInput,
  'reasonCode' | 'missingReceiptReason' | 'businessPurpose' | 'payeeName' | 'payeeAddress' | 'payeeTaxId'
  | 'paymentEvidenceAttachmentIds' | 'supportingAttachmentIds' | 'paymentDate' | 'paymentMethod'
  | 'expectedExpenseUpdatedAt'> & { expectedEvidenceUpdatedAt: string; paymentDate: string; paymentMethod: ExpensePaymentMethod; keepDocumentNumberConfirmed?: boolean };

export type LineSubstituteReceiptPrefill = {
  workflowId: string;
  expenseId: string;
  targetRevision: string;
  status: 'OPEN' | 'PAUSED';
  routeCheckBill?: true;
  acceptedValues: {
    fundingSource?: SubstituteReceiptFundingSource;
    paidInFullAcknowledged?: boolean;
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
  payerPosition?: string;
};

export type SubstituteReceiptPreview = {
  expectedEvidenceUpdatedAt?: string;
  svgDataUrl: string;
  previewChecksumSha256: string;
};

export type CertifySubstituteReceiptInput = {
  payerPosition?: string;
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
  approverPosition?: string;
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
  signerJobTitle?: string | null;
  canApproveForCompany?: boolean;
  companyName?: string;
  companyNameSource?: 'REGISTERED' | 'DISPLAY_NAME';
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
  /** Optional selection narrows within all server-side filters and permissions; [] matches nothing. */
  expenseIds?: string[];
  dateField?: 'uploadedAt' | 'expenseDate';
  fromDate?: string;
  toDate?: string;
  yearMonth?: string;
  /** Narrows within the caller's branch scope; an out-of-scope id is rejected before querying. */
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
  sourceDocumentTypeLabel?: string;
  /** Missing document dates use uploadedAt for the accounting period. */
  dateStatus?: import('./line-ai-value-normalizer.js').ExpenseDocumentDateStatus;
  sourceEvidenceUnavailable?: boolean;
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
  // Trailing, so every existing consumer's column offsets are untouched. Spec §5.1 moved the
  // additional charges out of `subtotal_amount`; without this column the row stopped adding up for
  // an accountant reading it (`subtotal − discount + charges + vat = grand_total`).
  'additional_charges_amount',
  // Spec §5.2, after the one above by name. An accountant reading this file cannot otherwise tell
  // a document date the receipt printed from the upload day a failed read left behind — both are
  // just a date in `document_date`.
  'document_date_status',
  'funding_source',
  'certifying_payer_name',
  'substitute_evidence_provenance',
  // GAP-7, trailing for the same reason as the three above: an accounting office reconciling a full
  // tax invoice needs the seller address that is printed on the paper, and it was nowhere in the
  // file that leaves the system. Appended so every position-based consumer keeps its offsets.
  'vendor_address',
  'input_vat_right',
  'input_vat_reason',
  'input_vat_decided_by',
  'input_vat_decided_at',
  'voucher_numbers',
  'wht_certificate_numbers',
  'bundle_file_names',
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
  tax_evidence_status: 'หลักฐานรายจ่าย',
  tax_evidence_reason: 'เหตุผลหลักฐานรายจ่าย',
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
  web_url: 'เปิดไฟล์',
  notes: 'หมายเหตุ',
  additional_charges_amount: 'ค่าใช้จ่ายเพิ่ม',
  document_date_status: 'สถานะวันที่เอกสาร',
  funding_source: 'แหล่งเงิน',
  certifying_payer_name: 'ผู้จ่ายและรับรอง',
  substitute_evidence_provenance: 'ต้นทางใบรับรองและประวัติแก้ไข',
  vendor_address: 'ที่อยู่ผู้ขายตามใบ',
  input_vat_right: 'สิทธิภาษีซื้อ',
  input_vat_reason: 'เหตุผลสิทธิภาษีซื้อ',
  input_vat_decided_by: 'ผู้ตรวจสิทธิภาษีซื้อ',
  input_vat_decided_at: 'วันเวลาที่ตรวจสิทธิภาษีซื้อ',
  voucher_numbers: 'เลขใบสำคัญจ่าย',
  wht_certificate_numbers: 'เลขหนังสือรับรอง 50 ทวิ',
  bundle_file_names: 'ชื่อไฟล์ในชุดเอกสาร',
};

export type AccountantIndexColumnSet = 'summary' | 'full';

export type AccountantPackageIndexRow = Record<AccountantIndexColumn, string>;

export type EvidenceManifestEntry = {
  source_expense_id?: string;
  is_historical?: boolean;
  substitute_receipt_status?: string;
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

/** A file the package could not include, so an incomplete package can never look complete. */
export type SkippedEvidenceEntry = {
  expense_id: string;
  expense_number: string;
  attachment_id: string;
  file_name: string;
  reason: string;
};

export type AccountantPackageRequest = SharedEvidenceFilter & {
  format?: 'csv';
  /** @deprecated Accepted for existing clients; the accountant workbook has one layout. */
  columnSet?: AccountantIndexColumnSet;
};

export type AccountantEvidenceBundlePlan = {
  fileCount: number; partCount: number;
  counts: { receipts: number; substituteReceipts: number; paymentSlips: number; vouchers: number; supportingFiles?: number; whtCertificates: number; claimForms?: number; recordPacks?: number };
  missingReceiptCount: number;
};

export type AccountantPackageResult = {
  /** Populated by the v2 projection; absent on legacy package responses. */
  indexFileName?: string;
  paymentRowCount?: number;
  withholdingRowCount?: number;
  generatedAt: string;
  filterSummary: Record<string, string>;
  rowCount: number;
  totalMatched: number;
  truncated: boolean;
  /** Frozen first-generation projection; file paths are legacy names, not current ZIP paths. */
  indexRows: AccountantPackageIndexRow[];
  /** Frozen first-generation CSV; file paths are legacy names, not current ZIP paths. */
  indexCsv: string;
  /** Real .xlsx (base64) with Thai header labels — what the UI downloads. */
  indexXlsxBase64: string;
  /** @deprecated The accountant workbook has one layout. */
  columnSet: AccountantIndexColumnSet;
  evidenceManifest: EvidenceManifestEntry[];
  /** Empty on a complete package; anything here means the accountant is missing those files. */
  skippedEvidence: SkippedEvidenceEntry[];
};

export type RemoveExpenseReceiptInput = { expectedUpdatedAt: string; purpose?: Exclude<ExpenseAttachmentPurpose, 'expense.signature.asset'> };

/**
 * Spec §16.4: which of the two file intents the user chose. "เปลี่ยนไฟล์ใบเสร็จนี้" is `replace`
 * and "แนบหลักฐานเพิ่ม" is `append`; a completion that names neither is the legacy call and keeps
 * its exact behaviour, so old clients and the LINE lane are untouched.
 */
export type ExpenseReceiptUploadIntent = 'replace' | 'append';

export type CompleteExpenseReceiptUploadInput = {
  checksumSha256?: string;
  byteSize?: number;
  purpose?: string;
  intent?: ExpenseReceiptUploadIntent;
  /** The expense revision the user was looking at when they picked the target (§16.4). */
  expectedUpdatedAt?: string;
  /** The primary this replace is meant to swap out; a different one now is a conflict, not a win. */
  expectedPrimaryAttachmentId?: string;
  /** Reused verbatim on retry: the same operation answers the same result instead of a second file. */
  operationId?: string;
};

/**
 * The shortest reason a void takes. Cancelling a reimbursement claim voids its expense records with
 * the claim's own reason, so the claim asks this of the reason before it starts: one rule, or a
 * reason the claim accepted is refused halfway through the cancellation.
 */
export const EXPENSE_VOID_REASON_MIN_LENGTH = 3;
export function isExpenseVoidReason(reason: string | null | undefined): boolean {
  return !!reason && reason.trim().length >= EXPENSE_VOID_REASON_MIN_LENGTH;
}

/**
 * Why an expense cannot be voided right now. The void refuses on these; a reimbursement claim reads
 * them before it commits to cancelling, and shows them on a cancellation that has not finished.
 */
export type ExpenseVoidBlocker =
  | { code: 'disbursement_reserved'; documentNumber: string | null; preparerName: string | null }
  | { code: 'wht_certificate_on_expense'; certificateNumber: string | null }
  | { code: 'accounting_period_locked'; periodKey: string }
  | { code: 'tax_period_locked'; periodKey: string; formType: string; certificateKind?: 'SYSTEM' | 'EXTERNAL' }
  | { code: 'certificate_issued' }
  /** The posted journal is not in a state a reversal can be written against. */
  | { code: 'posting_unresolved' }
  /** The record is in a status no void takes. */
  | { code: 'expense_not_voidable' };

/** A recorded payment can precede expense confirmation (e.g. issuing a substitute receipt). */
export function canVoidExpenseFinancialState(expense: {
  status: string; paidAmount?: { toString(): string }; journalEntryId?: string | null;
  postingStatus?: string; sourceReimbursementRequestId?: string | null;
}): boolean {
  return expense.status === 'CONFIRMED' || (!expense.sourceReimbursementRequestId
    && ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status)
    && (Number(expense.paidAmount ?? 0) > 0 || Boolean(expense.journalEntryId) || expense.postingStatus === 'posted'));
}

/** File-type names shared by upload pickers, validation, API errors and guides; owner 2026-11-04: in English. */
export const JPEG_LABEL = 'JPEG';
export const PNG_LABEL = 'PNG';
export const STORED_IMAGE_TYPES_LABEL = `${JPEG_LABEL}, ${PNG_LABEL}`;
export const IMAGE_SOURCE_TYPES_LABEL = `${STORED_IMAGE_TYPES_LABEL}, HEIC, HEIF, GIF`;
export const ATTACHMENT_SOURCE_TYPES_LABEL = `PDF หรือรูปภาพ (${IMAGE_SOURCE_TYPES_LABEL})`;
export const SIGNATURE_FILE_TYPES_LABEL = `รูปภาพ (${STORED_IMAGE_TYPES_LABEL})`;
export const SIGNATURE_FILE_REQUIRED_MESSAGE = `ไฟล์ลายเซ็นต้องเป็น${SIGNATURE_FILE_TYPES_LABEL} ขนาดไม่เกิน 2 เมกะไบต์`;
export const SIGNATURE_FILE_TOO_LARGE_MESSAGE = 'ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 เมกะไบต์';
export const UPLOAD_FILE_TYPE_MISMATCH_MESSAGE = `ไฟล์นี้มีชนิดไฟล์ไม่ตรงกับข้อมูลภายใน ระบบจึงแนบไม่ได้ เลือกไฟล์ใหม่ หรือบันทึกเป็น PDF หรือ${SIGNATURE_FILE_TYPES_LABEL} แล้วลองอีกครั้ง`;
export const UPLOAD_HEIC_CONVERSION_MESSAGE = `แปลงรูปไม่สำเร็จ บันทึกรูปเป็น${SIGNATURE_FILE_TYPES_LABEL} แล้วลองอีกครั้ง`;

/** The same binary-megabyte display on web and LINE; limits themselves are unchanged. */
export const expenseCaptureMegabytes = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} เมกะไบต์`;

export const EXPENSE_MANUAL_EDIT_HELP_TH = 'ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้';

export const EXPENSE_SAVED_MANUAL_HELP_TH = `เก็บไฟล์ไว้แล้ว ${EXPENSE_MANUAL_EDIT_HELP_TH}`;
export const EXPENSE_READ_FAILED_HELP_TH = `อ่านข้อมูลไม่สำเร็จค่ะ ${EXPENSE_SAVED_MANUAL_HELP_TH}`;
export const EXPENSE_READ_PARTIAL_HELP_TH = `อ่านข้อมูลได้บางส่วนค่ะ ${EXPENSE_SAVED_MANUAL_HELP_TH}`;

export const EXPENSE_REVIEW_REQUEST_WORDS = {
  title: 'มีรายจ่ายรอคุณตรวจ',
  body: '{sender} ส่งรายจ่าย {number} ให้คุณตรวจ',
} as const;

/** The reviewer answers; system conditions are read again by the decision transaction. */
export const INPUT_VAT_REVIEWER_CONDITIONS = [
  { code: 'BUSINESS_USE', label: 'ซื้อเพื่อใช้ในกิจการ' },
  { code: 'NOT_PROHIBITED', label: 'ไม่ใช่ภาษีซื้อต้องห้าม เช่น ค่ารับรอง' },
  { code: 'ISSUER_ENTITLED', label: 'ผู้ออกใบมีสิทธิออกใบกำกับภาษี' },
] as const;
export type DecideExpenseInputVatInput = {
  toStatus: 'CLAIMABLE' | 'NON_CLAIMABLE'; reason?: string;
  reviewerConditions?: string[]; buyerConfirmed?: boolean;
};
export type ExpenseInputVatDecisionView = {
  id: string; fromStatus: InputVatClaimStatus; toStatus: InputVatClaimStatus; reason: string | null;
  conditions: Array<{ code: string; answer: boolean; source: 'SYSTEM' | 'REVIEWER'; fact: unknown; answeredByUserId?: string }>;
  evidenceAttachmentIds: string[]; decidedByUserId: string; decidedByName: string; decidedAt: string;
};
export type ExpenseInputVatRightView = {
  vatStatus?: 'REGISTERED' | 'NOT_REGISTERED' | 'UNKNOWN';
  conditions?: ExpenseInputVatDecisionView['conditions'];
  buyerMatchStatus?: string;
  postsToLedger?: boolean;
  decisionBlocker?: 'tax_period_locked' | 'input_vat_posted_journal_immutable' | null;
  status: InputVatClaimStatus; fixed: boolean; reasonCode: string | null; latestDecision: ExpenseInputVatDecisionView | null;
};

/** Record-scoped activity; generic audit metadata and actor identifiers are never exposed. */
export type ExpenseHistoryChange = { field: string; before: string | null; after: string | null };
export type ExpenseHistoryEntry = {
  id: string;
  action: string;
  result: 'SUCCESS' | 'DENIED' | 'FAILED';
  actorType: 'USER' | 'SYSTEM' | 'SERVICE' | 'CRM_CUSTOMER';
  actorDisplayName: string | null;
  createdAt: string;
  changes: ExpenseHistoryChange[];
};
export type ExpenseHistoryResult = { data: ExpenseHistoryEntry[]; total: number; page: number; pageSize: number; creatorDisplayName: string | null };

export const ACCOUNTANT_WORKBOOK_SHEETS = {
  followUp: 'ต้องตามเอกสาร', summary: 'สรุปรายเดือน', purchaseTax: 'รายงานภาษีซื้อ',
  expenses: 'รายการค่าใช้จ่าย', payments: 'การจ่าย', withholding: 'หัก ณ ที่จ่าย', files: 'ไฟล์ทั้งหมด', about: 'เกี่ยวกับไฟล์นี้',
} as const;

export const ACCOUNTANT_WORKBOOK_COLUMNS = [
  'document_date',
  'uploaded_at',
  'expense_number',
  'vendor_document_number',
  'source_document_type',
  'vendor_name',
  'vendor_tax_id',
  'vendor_branch',
  'vendor_address',
  'category_name',
  'description',
  'currency',
  'taxable_amount',
  'vat_amount',
  'grand_total_amount',
  'input_vat_right',
  'tax_evidence_status',
  'wht_amount',
  'net_payable_amount',
  'paid_amount',
  'outstanding_amount',
  'last_paid_at',
  'advanced_by',
  'expense_status',
  'notes',
  'primary_file',
  'wht_remittance',
] as const;
export const ACCOUNTANT_WORKBOOK_COLUMN_LABELS: Record<typeof ACCOUNTANT_WORKBOOK_COLUMNS[number], string> = {
  document_date: 'วันที่เอกสาร',
  uploaded_at: 'วันที่ส่งเข้ามั่งมี',
  expense_number: 'เลขที่รายการ',
  source_document_type: 'ประเภทเอกสาร',
  vendor_document_number: 'เลขที่ตามเอกสาร',
  vendor_name: 'ผู้ขาย/ผู้รับเงิน',
  vendor_tax_id: 'เลขประจำตัวผู้เสียภาษีผู้ขาย',
  vendor_branch: 'สาขาผู้ขาย',
  vendor_address: 'ที่อยู่ผู้ขาย',
  category_name: 'หมวดค่าใช้จ่าย',
  description: 'รายละเอียด',
  currency: 'สกุลเงิน',
  taxable_amount: 'มูลค่าก่อน VAT',
  vat_amount: 'VAT',
  grand_total_amount: 'ยอดรวมตามเอกสาร',
  input_vat_right: 'สิทธิภาษีซื้อ',
  tax_evidence_status: 'หลักฐานรายจ่าย',
  wht_amount: 'หัก ณ ที่จ่าย (ทั้งเอกสาร)',
  net_payable_amount: 'ยอดจ่ายสุทธิ',
  paid_amount: 'จ่ายแล้ว',
  outstanding_amount: 'ค้างจ่าย',
  last_paid_at: 'วันที่จ่ายล่าสุด',
  advanced_by: 'สำรองจ่ายโดย',
  expense_status: 'สถานะ',
  notes: 'หมายเหตุ',
  primary_file: 'ไฟล์เอกสาร',
  wht_remittance: E_WHT_WORDS['W-X1'],
};

export const ACCOUNTANT_PAYMENT_SHEET_COLUMNS = [
  'paid_at',
  'expense_number',
  'payee_name',
  'amount',
  'currency',
  'payment_method',
  'paid_from',
  'voucher_numbers',
  'payment_file',
] as const;
export const ACCOUNTANT_PAYMENT_SHEET_COLUMN_LABELS: Record<typeof ACCOUNTANT_PAYMENT_SHEET_COLUMNS[number], string> = {
  paid_at: 'วันที่จ่าย',
  expense_number: 'เลขที่รายการ',
  payee_name: 'ผู้ขาย/ผู้รับเงิน',
  amount: 'ยอดจ่าย',
  currency: 'สกุลเงิน',
  payment_method: 'วิธีจ่าย',
  paid_from: 'จ่ายจาก',
  voucher_numbers: 'เลขที่ใบสำคัญจ่าย',
  payment_file: 'ไฟล์หลักฐานการจ่าย',
};

export const ACCOUNTANT_WITHHOLDING_SHEET_COLUMNS = [
  'paid_at',
  'expense_number',
  'payee_name',
  'payee_tax_id',
  'payee_branch',
  'payee_address',
  'form_type',
  'income_type',
  'rate',
  'gross_amount',
  'withheld_amount',
  'currency',
  'certificate_numbers',
  'status',
  'notes',
] as const;
export const ACCOUNTANT_WITHHOLDING_SHEET_COLUMN_LABELS: Record<typeof ACCOUNTANT_WITHHOLDING_SHEET_COLUMNS[number], string> = {
  paid_at: 'วันที่จ่าย',
  expense_number: 'เลขที่รายการ',
  payee_name: 'ผู้รับเงิน',
  payee_tax_id: 'เลขประจำตัวผู้เสียภาษี',
  payee_branch: 'สาขา',
  payee_address: 'ที่อยู่',
  form_type: 'แบบ ภ.ง.ด.',
  income_type: 'ประเภทเงินได้',
  rate: 'อัตรา (%)',
  gross_amount: 'จำนวนเงินที่จ่าย',
  withheld_amount: 'ภาษีที่หัก',
  currency: 'สกุลเงิน',
  certificate_numbers: 'เลขที่หนังสือรับรอง 50 ทวิ',
  status: 'สถานะ',
  notes: 'หมายเหตุ',
};

export const ACCOUNTANT_FILES_SHEET_COLUMNS = [
  'expense_number',
  'kind',
  'version',
  'replaced_by',
  'file',
  'part',
] as const;
export const ACCOUNTANT_FILES_SHEET_COLUMN_LABELS: Record<typeof ACCOUNTANT_FILES_SHEET_COLUMNS[number], string> = {
  expense_number: 'เลขที่รายการ',
  kind: 'ชนิดเอกสาร',
  version: 'ฉบับ',
  replaced_by: 'แทนด้วย',
  file: 'ไฟล์',
  part: 'ชุดที่',
};

export const ACCOUNTANT_WORKBOOK_OPTIONAL_COLUMNS = ['shop_branch'] as const;
export const ACCOUNTANT_WORKBOOK_OPTIONAL_COLUMN_LABELS = { shop_branch: 'สาขาของร้าน', record_files: 'ชุดเอกสารรายการ' } as const;

export const EXPENSE_PAYMENT_METHOD_LABELS: Record<ExpensePaymentMethod, string> = {
  CASH: 'เงินสด', BANK_TRANSFER: 'โอนเงิน', CARD: 'บัตรเครดิต', CHEQUE: 'เช็ค', OTHER: 'อื่นๆ',
};

export function expenseCurrencyLabel(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{3}$/.test(code)) return 'สกุลเงินอื่น';
  try {
    const label = new Intl.DisplayNames(['th'], { type: 'currency', fallback: 'none' }).of(code.toUpperCase());
    return label && label !== code.toUpperCase() ? label : 'สกุลเงินอื่น';
  } catch { return 'สกุลเงินอื่น'; }
}

// General accounting-office purchase journal. Vendor presets wait for a verified template.
export const ACCOUNTING_SOFTWARE_EXPORT_PRESETS = ['purchase_journal'] as const;
export type AccountingSoftwareExportPreset = (typeof ACCOUNTING_SOFTWARE_EXPORT_PRESETS)[number];
export type AccountingSoftwareExportRequest = SharedEvidenceFilter & { preset: AccountingSoftwareExportPreset };
export const ACCOUNTING_EXPORT_EXCLUSION_REASONS = ['foreign_currency', 'not_confirmed', 'vat_not_representable',
  'wht_not_representable', 'wht_without_vendor_tax_id', 'wht_form_not_supported', 'wht_payee_kind_unknown',
  'wht_mixed_income_types', 'wht_unpaid', 'wht_partly_paid', 'wht_paid_in_several_payments', 'wht_paid_date_unconfirmed',
  'wht_payment_method_not_supported', 'account_unmapped', 'too_many_rows'] as const;
export type AccountingExportExclusionReason = (typeof ACCOUNTING_EXPORT_EXCLUSION_REASONS)[number];
export const ACCOUNTING_EXPORT_EXCLUSION_LABELS: Record<AccountingExportExclusionReason, string> = {
  foreign_currency: 'ยอดเป็นสกุลเงินอื่น นำเข้าได้เฉพาะเงินบาท',
  not_confirmed: 'รายการยังไม่ยืนยัน กลับไปตรวจรายการ',
  vat_not_representable: 'ภาษีในรายการนี้ใส่ในไฟล์นี้ไม่ได้',
  wht_not_representable: 'ยอดภาษีที่หักไว้ใส่ในไฟล์นี้ไม่ได้',
  wht_without_vendor_tax_id: 'ยังไม่มีเลขผู้เสียภาษีของผู้ขาย',
  wht_form_not_supported: 'ภาษีของรายการนี้ใส่ในไฟล์นี้ไม่ได้',
  wht_payee_kind_unknown: 'ยังไม่ระบุว่าผู้รับเงินเป็นบุคคลหรือนิติบุคคล',
  wht_mixed_income_types: 'รายการนี้หักภาษีหลายประเภท',
  wht_unpaid: 'รายการนี้ต้องจ่ายก่อนส่งเข้าไฟล์นี้',
  wht_partly_paid: 'จ่ายยังไม่ครบ',
  wht_paid_in_several_payments: 'จ่ายหลายครั้ง',
  wht_paid_date_unconfirmed: 'วันที่จ่ายยังไม่ยืนยัน',
  wht_payment_method_not_supported: 'วิธีจ่ายนี้ใส่ในไฟล์นำเข้าไม่ได้',
  account_unmapped: 'ยังไม่ระบุรหัสบัญชีของหมวดนี้',
  too_many_rows: 'เอกสารมีบรรทัดมากเกินที่ไฟล์นี้รับ',
};
export type AccountingSoftwareExportResult = {
  preset: AccountingSoftwareExportPreset;
  files: { fileName: string; xlsxBase64: string; rowCount: number }[];
  documentCount: number;
  rowCount: number;
  excluded: { expenseNumber: string; reason: AccountingExportExclusionReason; detail: string }[];
  paymentNotExported: { expenseNumber: string; detail: string }[];
  unmappedCategories: { id: string; name: string }[];
};
export const PURCHASE_JOURNAL_COLUMNS = [
  'document_date', 'vendor_document_number', 'expense_number', 'source_document_type', 'vendor_name', 'vendor_tax_id',
  'vendor_branch', 'account_code', 'account_name', 'category_name', 'description', 'vat_treatment', 'taxable_amount',
  'vat_amount', 'grand_total_amount', 'input_vat_right', 'wht_form', 'wht_income_type', 'wht_base_amount', 'wht_rate',
  'wht_amount', 'net_payable_amount', 'payment_status', 'last_paid_at', 'advanced_by',
] as const;
export type PurchaseJournalColumn = (typeof PURCHASE_JOURNAL_COLUMNS)[number];
export type PurchaseJournalRow = Record<PurchaseJournalColumn, string | number>;
export const PURCHASE_JOURNAL_COLUMN_LABELS: Record<PurchaseJournalColumn, string> = {
  document_date: 'วันที่เอกสาร', vendor_document_number: 'เลขที่ตามเอกสาร', expense_number: 'เลขที่รายการ',
  source_document_type: 'ประเภทเอกสาร', vendor_name: 'ผู้ขาย/ผู้รับเงิน', vendor_tax_id: 'เลขประจำตัวผู้เสียภาษีผู้ขาย',
  vendor_branch: 'สาขาผู้ขาย (00000 = สำนักงานใหญ่)', account_code: 'รหัสบัญชี', account_name: 'ชื่อบัญชี',
  category_name: 'หมวดค่าใช้จ่าย', description: 'รายละเอียด', vat_treatment: 'การใช้ VAT', taxable_amount: 'มูลค่าก่อน VAT',
  vat_amount: 'VAT', grand_total_amount: 'ยอดรวม', input_vat_right: 'สิทธิภาษีซื้อ', wht_form: 'แบบ ภ.ง.ด.',
  wht_income_type: 'ประเภทเงินได้', wht_base_amount: 'ฐานหัก ณ ที่จ่าย', wht_rate: 'อัตราหัก (%)', wht_amount: 'หัก ณ ที่จ่าย',
  net_payable_amount: 'ยอดจ่ายสุทธิ', payment_status: 'สถานะการจ่าย', last_paid_at: 'วันที่จ่ายล่าสุด', advanced_by: 'สำรองจ่ายโดย',
};
