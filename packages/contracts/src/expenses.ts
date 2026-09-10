// Item 09 – Expense and Receipt Upload contracts

import {
  BUSINESS_DOCUMENT_KINDS,
  RECEIPT_ADDITIONAL_CHARGE_KINDS,
  type BusinessDocumentClassification,
  type BusinessDocumentKind,
  type ReceiptOcrFieldResult,
} from './line-ai.js';
import type { BuyerEntityKind } from './company-tax-identity.js';
import type { ExpenseDocumentDateStatus } from './line-ai-value-normalizer.js';

export type ExpenseStatus = 'DRAFT' | 'EXTRACTING' | 'NEEDS_REVIEW' | 'READY_FOR_CONFIRMATION' | 'CONFIRMED' | 'REJECTED' | 'VOIDED';
export type ExtractionStatus = 'NOT_REQUESTED' | 'NOT_CONFIGURED' | 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
export type ExpenseExtractionResult = {
  status: 'ok' | 'not_expense_document' | 'not_configured' | 'unsupported' | 'no_attachment' | 'failed';
  fields?: ReceiptOcrFieldResult;
  missingFields?: string[];
  classification?: BusinessDocumentClassification;
  errorCode?: string;
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
export const EXPENSE_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];
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
  maxExpenseLines: 8,
  maxLineDescriptionLength: 200,
  maxEvidenceAttachments: 8,
  maxEvidenceFileNameLength: 255,
});

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
    ? `กรุณาตรวจรายการที่ ${attention.join(', ')} หรือเลือก “ใช้ยอดตามเอกสาร” พร้อมระบุเหตุผล`
    : 'กรุณาตรวจรายการในเอกสาร หรือเลือก “ใช้ยอดตามเอกสาร” พร้อมระบุเหตุผล';
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
  // The button that produces this state says ลบลายเซ็น, so the badge says the same thing back.
  // "เก็บถาวร" read as filing something away — next to a still-visible preview it looked like the
  // delete had not happened.
  ARCHIVED: 'เลิกใช้แล้ว',
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

export type RecordExpensePaymentInput = {
  /** Stable for one intent, including network retries; omitted only by legacy callers. */
  idempotencyKey?: string;
  paidAmount: string;
  paymentMethod?: ExpensePaymentMethod;
  /** Actual paid civil day, YYYY-MM-DD. Omission retains the legacy first-write instant. */
  paidAt?: string;
  bankAccountRef?: string;
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
  /**
   * Spec §5.2: what `expenseDate` actually IS. The column is NOT NULL, so a list row showing a date
   * says nothing about whether anyone read it off the document — a receipt whose date failed to
   * parse shows the upload day, indistinguishable from a date the page printed. Derived from
   * `aiVerificationSummaryJson`; absent on rows captured before §5.2, which read as `verified`.
   */
  dateStatus?: ExpenseDocumentDateStatus;
  uploadedAt: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
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

export type ExpenseDetail = ExpenseSummary & {
  sourceDraft?: ExpenseSourceDraft | null;
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
  additional_charges_amount: 'ค่าใช้จ่ายเพิ่ม',
  document_date_status: 'สถานะวันที่เอกสาร',
  funding_source: 'แหล่งเงิน',
  certifying_payer_name: 'ผู้จ่ายและรับรอง',
  substitute_evidence_provenance: 'ต้นทางใบรับรองและประวัติแก้ไข',
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
  /** Empty on a complete package; anything here means the accountant is missing those files. */
  skippedEvidence: SkippedEvidenceEntry[];
};

export type RemoveExpenseReceiptInput = { expectedUpdatedAt: string; purpose?: Exclude<ExpenseAttachmentPurpose, 'expense.signature.asset'> };

/** A recorded payment can precede expense confirmation (e.g. issuing a substitute receipt). */
export function canVoidExpenseFinancialState(expense: {
  status: string; paidAmount?: { toString(): string }; journalEntryId?: string | null;
  postingStatus?: string; sourceReimbursementRequestId?: string | null;
}): boolean {
  return expense.status === 'CONFIRMED' || (!expense.sourceReimbursementRequestId
    && ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status)
    && (Number(expense.paidAmount ?? 0) > 0 || Boolean(expense.journalEntryId) || expense.postingStatus === 'posted'));
}
