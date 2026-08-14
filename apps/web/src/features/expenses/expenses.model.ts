import type {
  ExpenseStatus, ExpenseVatMode, ExpensePaymentStatus, ExpensePostingStatus, ExpensePostingSourceType,
  AiVerificationStatus, DuplicateStatus, ExpenseCaptureSource, ExpensePaymentMethod,
  InputVatClaimStatus, ExpenseCategorySummary,
  SourceDocumentType, TaxEvidenceStatus, TaxEvidenceReasonCode, ExpenseLineReviewStatus,
  SignatureAssetSummary, SignatureAssetStatus, SharedEvidenceView, SharedEvidenceRow,
  AccountantPackageResult, EvidenceManifestEntry, CreateExpenseDraftInput, UpdateExpenseDraftInput,
  SubstituteReceiptEvidenceSummary, TransactionTaxComponentPreview, TransactionTaxSnapshot,
  BuyerEntityKind,
  ExpensePaymentSummary,
} from '@watchdog-bms/contracts';
import {
  EXPENSE_STATUS_LABELS, EXPENSE_PAYMENT_STATUS_LABELS, EXPENSE_VAT_MODE_LABELS,
  SOURCE_DOCUMENT_TYPE_LABELS, TAX_EVIDENCE_STATUS_LABELS, SIGNATURE_ASSET_STATUS_LABELS,
  isExpenseCancelled, isExpenseDeletableState, isExpensePending, isNonExpenseClassificationBlocking,
  effectiveVatRateLabel, vatModeRequiresRate,
} from '@watchdog-bms/contracts';
export { isExpensePending } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { ACCOUNTING_UI_HIDDEN } from '@/features/web-core-workspace/web-core-workspace.constants';

export type {
  ExpenseStatus, ExpenseVatMode, ExpensePaymentStatus, ExpensePostingStatus, ExpensePostingSourceType, AiVerificationStatus, DuplicateStatus,
  ExpenseCaptureSource, ExpensePaymentMethod, InputVatClaimStatus, ExpenseCategorySummary,
  SourceDocumentType, TaxEvidenceStatus, TaxEvidenceReasonCode, ExpenseLineReviewStatus,
  SignatureAssetSummary, SignatureAssetStatus, SharedEvidenceView, SharedEvidenceRow,
  AccountantPackageResult, EvidenceManifestEntry,
  SubstituteReceiptEvidenceSummary,
  ExpensePaymentSummary,
};

export {
  EXPENSE_STATUS_LABELS, EXPENSE_PAYMENT_STATUS_LABELS, EXPENSE_VAT_MODE_LABELS,
  SOURCE_DOCUMENT_TYPE_LABELS, TAX_EVIDENCE_STATUS_LABELS, SIGNATURE_ASSET_STATUS_LABELS,
  effectiveVatRateLabel, vatModeRequiresRate,
};

/** Deterministic light-background removal for signature previews:
 * near-white pixels become transparent, dark ink stays.
 * ponytail: brightness threshold only; upgrade to server-side image processing if real samples fail. */
export function removeLightBackground(imageData: ImageData, threshold = 235): ImageData {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!; const g = data[i + 1]!; const b = data[i + 2]!;
    if (r >= threshold && g >= threshold && b >= threshold) {
      data[i + 3] = 0;
    }
  }
  return imageData;
}

export function findOpaqueBounds(
  imageData: ImageData,
  alphaThreshold = 8,
): { x: number; y: number; width: number; height: number } | null {
  let minX = imageData.width;
  let minY = imageData.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      if (imageData.data[(y * imageData.width + x) * 4 + 3]! < alphaThreshold) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function hasUnresolvedDuplicateWarning(duplicateStatus: DuplicateStatus): boolean {
  return duplicateStatus === 'POSSIBLE_DUPLICATE' || duplicateStatus === 'CONFIRMED_DUPLICATE';
}

export function aiGrandTotalValue(aiVerifiedFieldsJson: Record<string, unknown> | null): string | null {
  const rawAiTotal = aiVerifiedFieldsJson?.['grandTotalAmount'];
  return (typeof rawAiTotal === 'string' || typeof rawAiTotal === 'number') && String(rawAiTotal).trim() !== ''
    ? String(rawAiTotal)
    : null;
}

export function hasAiGrandTotalMismatch(aiVerifiedFieldsJson: Record<string, unknown> | null, grandTotalAmount: string): boolean {
  const rawAiTotal = aiGrandTotalValue(aiVerifiedFieldsJson);
  if (rawAiTotal === null) return false;
  const aiTotal = Number(rawAiTotal.replace(/,/g, ''));
  const serverTotal = Number(grandTotalAmount);
  if (!Number.isFinite(aiTotal) || !Number.isFinite(serverTotal)) return false;
  return Math.abs(Math.round(aiTotal * 10_000) - Math.round(serverTotal * 10_000)) > 500;
}

/** Mirrors the server `hasAcknowledgedAiTotalMismatch`: Finance's acceptance counts only for the
 *  exact figure they accepted, so editing the total afterwards puts the warning back. */
export function hasAcknowledgedAiTotalMismatch(
  aiVerificationSummaryJson: Record<string, unknown> | null,
  grandTotalAmount: string,
): boolean {
  const resolution = aiVerificationSummaryJson?.['totalMismatchResolution'];
  if (!resolution || typeof resolution !== 'object') return false;
  const record = resolution as Record<string, unknown>;
  if (record['acknowledged'] !== true) return false;
  const acknowledged = Number(String(record['acknowledgedTotalAmount'] ?? '').replace(/,/g, ''));
  const current = Number(String(grandTotalAmount).replace(/,/g, ''));
  return Number.isFinite(acknowledged) && Number.isFinite(current)
    && Math.round(acknowledged * 10_000) === Math.round(current * 10_000);
}

/** The confirm blocker: OCR disagrees with the stored total and nobody has accepted that yet. */
export function needsAiTotalAcknowledgement(
  detail: Pick<ExpenseDetail, 'aiVerifiedFieldsJson' | 'aiVerificationSummaryJson' | 'grandTotalAmount'>,
): boolean {
  return hasAiGrandTotalMismatch(detail.aiVerifiedFieldsJson, detail.grandTotalAmount)
    && !hasAcknowledgedAiTotalMismatch(detail.aiVerificationSummaryJson, detail.grandTotalAmount);
}

function moneyNumber(value: string | number | null | undefined): number {
  const parsed = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
const roundMoney = (value: number) => Math.round(value * 100) / 100;

/**
 * Spec §19g decision 4: documents print a VAT amount in baht far more often than a rate, and the
 * rate is not always 7%. Back-solve the stored decimal fraction from what the document prints.
 * Returns '' when the pair cannot describe a rate, so the caller leaves the rate unknown rather
 * than storing a nonsense one.
 */
export function vatRateFromPrintedAmount(input: {
  afterDiscountAmount: string | number;
  printedVatAmount: string | number;
  vatMode: ExpenseVatMode;
}): string {
  const gross = moneyNumber(input.afterDiscountAmount);
  const vat = moneyNumber(input.printedVatAmount);
  if (!(gross > 0) || vat < 0) return '';
  // VAT_INCLUDED prints the gross, so the base is what remains after the VAT is taken out of it.
  const base = input.vatMode === 'VAT_INCLUDED' ? gross - vat : gross;
  if (!(base > 0)) return '';
  const rate = vat / base;
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) return '';
  return rate.toFixed(4);
}

export function calculateManualExpenseTotals(input: {
  quantity: string | number;
  unitPrice: string | number;
  vatRate?: string | number | null;
  vatMode: ExpenseVatMode;
}): { subtotal: number; vat: number; grandTotal: number } {
  const subtotal = Math.max(0, moneyNumber(input.quantity) * moneyNumber(input.unitPrice));
  const rate = Math.max(0, moneyNumber(input.vatRate));
  if (!rate || input.vatMode === 'NO_VAT') return { subtotal: roundMoney(subtotal), vat: 0, grandTotal: roundMoney(subtotal) };
  if (input.vatMode === 'VAT_INCLUDED') {
    // entered amount is the gross: before-tax = gross minus the VAT baked into it
    const vat = subtotal - (subtotal / (1 + rate));
    return { subtotal: roundMoney(subtotal - vat), vat: roundMoney(vat), grandTotal: roundMoney(subtotal) };
  }
  const vat = subtotal * rate;
  return { subtotal: roundMoney(subtotal), vat: roundMoney(vat), grandTotal: roundMoney(subtotal + vat) };
}

/** Manual entry keeps the shape the OCR path already produces for a printed service charge
 *  (receipt-additional-charges spec §7.3): its own quantity-1 line at the document VAT rate and Tax
 *  Code, never folded into the item price. A hand-keyed bill and an AI-read bill then reconcile,
 *  post, and review identically.
 *  ponytail: service charge only — add delivery/packaging/tip inputs when a real bill needs them,
 *  the second line is already generic. */
export type ManualExpenseItem = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
};

export function buildManualExpenseLines(input: {
  items: ManualExpenseItem[];
  serviceChargeAmount?: string;
  serviceChargeDescription: string;
  vatRate?: string;
  taxCodeDefinitionId?: string;
  externalTaxCode?: string;
}): CreateExpenseDraftInput['lines'] {
  const documentTax = {
    vatRate: input.vatRate || undefined,
    ...(input.taxCodeDefinitionId && { taxCodeDefinitionId: input.taxCodeDefinitionId }),
    ...(input.externalTaxCode && { externalTaxCode: input.externalTaxCode }),
    transactionContext: 'DOMESTIC_PURCHASE' as const,
  };
  // Every item carries the document VAT rate and Tax Code — manual entry captures one bill,
  // and a bill prints one tax treatment (the same assumption the OCR path makes).
  const lines: CreateExpenseDraftInput['lines'] = input.items.map((item, index) => ({
    lineNumber: index + 1,
    description: item.description.trim(),
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discountAmount: item.discountAmount || '0',
    ...documentTax,
  }));
  // Spec §7.1: a charge is additive only. A printed discount reduces the item, never the charge, so
  // the charge line carries no discount of its own.
  if (moneyNumber(input.serviceChargeAmount) > 0) {
    lines.push({
      lineNumber: lines.length + 1,
      description: input.serviceChargeDescription,
      quantity: '1',
      unitPrice: input.serviceChargeAmount!,
      discountAmount: '0',
      ...documentTax,
    });
  }
  return lines;
}

export function deriveExpenseClassificationReviewState(
  summary: Record<string, unknown> | null | undefined,
  canReview: boolean,
): { blocked: boolean; showFinanceOverride: boolean; showWaitingForFinance: boolean } {
  const blocked = isNonExpenseClassificationBlocking(summary);
  return {
    blocked,
    showFinanceOverride: blocked && canReview,
    showWaitingForFinance: blocked && !canReview,
  };
}

export type ExpenseSummary = {
  id: string;
  branchId: string | null;
  expenseNumber: string | null;
  status: ExpenseStatus;
  /** Claim projection marker — settled by the reimbursement payout, no manual payment. */
  sourceReimbursementRequestId?: string | null;
  captureSource: ExpenseCaptureSource;
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
  /** Suggested input Tax Code from this expense's category. A hint for the line picker only. */
  categoryDefaultInputTaxCode?: string | null;
  vendorTaxIdSnapshot: string | null;
  vendorBranchCodeSnapshot: string | null;
  vendorEntityKindSnapshot: BuyerEntityKind | null;
  receivedAt: string | null;
  inputVatClaimStatus: InputVatClaimStatus;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  whtAmount: string;
  paymentMethod: ExpensePaymentMethod | null;
  paidAt: string | null;
  accountHintKey: string | null;
  taxCategory: string | null;
  missingReceiptReason: string | null;
  sourceDocumentLanguage: string | null;
  taxEvidenceReasonCode: TaxEvidenceReasonCode | null;
  substituteReceiptGeneratedAt: string | null;
  substituteReceiptEvidence: SubstituteReceiptEvidenceSummary | null;
  aiVerifiedFieldsJson: Record<string, unknown> | null;
  aiVerificationSummaryJson: Record<string, unknown> | null;
  aiVerificationConfidence: number | null;
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
  duplicateOfExpenseId: string | null;
  duplicateOverrideReason: string | null;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  pendingPostingSourceType: ExpensePostingSourceType | null;
  pendingPostingSourceId: string | null;
  postingError: string | null;
  payments: ExpensePaymentSummary[];
  lines: Array<{
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
    reviewStatus: ExpenseLineReviewStatus;
    taxSnapshot?: TransactionTaxSnapshot;
    taxComponents?: TransactionTaxComponentPreview[];
  }>;
  attachments: Array<{
    id: string;
    purpose: string;
    originalFileName: string;
    mimeType: string;
    byteSize: number;
    checksumSha256: string | null;
    status: string;
    createdAt: string;
  }>;
  duplicateCandidates: Array<{
    id: string;
    candidateExpenseId: string;
    candidateExpenseNumber: string | null;
    candidateVendorName: string | null;
    candidateExpenseDate: string | null;
    candidateGrandTotalAmount: string | null;
    reasonCodesJson: string[];
    score: number;
    status: string;
    resolvedAt: string | null;
    resolutionReason: string | null;
  }>;
};

export type ExpenseDraftReviewValues = {
  vendorNameSnapshot: string;
  vendorTaxIdSnapshot: string;
  /** '' = ยังไม่ระบุ. Only asked for when the document withholds tax (ภ.ง.ด.3 vs ภ.ง.ด.53). */
  vendorEntityKindSnapshot?: BuyerEntityKind | '';
  vendorDocumentNumber: string;
  expenseDate: string;
  vatMode: ExpenseVatMode;
  lines: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    discountAmount: string;
    vatRate: string;
    whtRate: string | null;
    expenseCategoryId: string | null;
    accountHintKey: string | null;
    taxCategory: string | null;
    taxCodeDefinitionId?: string | null;
    externalTaxCode?: string | null;
    transactionContext?: import('@watchdog-bms/contracts').TransactionTaxContext;
  }>;
};

export function allowsDomesticInputTaxCode(
  sourceDocumentType: SourceDocumentType,
  taxEvidenceStatus: TaxEvidenceStatus,
): boolean {
  return sourceDocumentType === 'TAX_INVOICE' && taxEvidenceStatus !== 'SUPPORTING_ONLY';
}

// Spec §19c: only the Tax Code selection is claimability-driven — the printed VAT rate stays.
export function clearExpenseTaxSelections(
  lines: ExpenseDraftReviewValues['lines'],
): ExpenseDraftReviewValues['lines'] {
  return lines.map((line) => ({
    ...line,
    taxCodeDefinitionId: null,
    externalTaxCode: null,
  }));
}

/** Stored form of a Thai taxpayer ID: digits only, 13 max. Pasted/OCR values may carry
 *  separators, so every write normalises through here — duplicate matching and export
 *  compare the raw column. */
export function taxIdDigits(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, 13);
}

/** Display form X-XXXX-XXXXX-XX-X. Empty groups are dropped so a half-typed number never
 *  shows a trailing separator (and backspace never gets stuck on one). */
export function formatTaxId(value: string): string {
  const digits = taxIdDigits(value);
  return [digits.slice(0, 1), digits.slice(1, 5), digits.slice(5, 10), digits.slice(10, 12), digits.slice(12)]
    .filter(Boolean)
    .join('-');
}

export function buildExpenseDraftReviewPayload(values: ExpenseDraftReviewValues): UpdateExpenseDraftInput {
  return {
    vendorNameSnapshot: values.vendorNameSnapshot.trim(),
    vendorTaxIdSnapshot: taxIdDigits(values.vendorTaxIdSnapshot),
    ...(values.vendorEntityKindSnapshot && { vendorEntityKindSnapshot: values.vendorEntityKindSnapshot }),
    vendorDocumentNumber: values.vendorDocumentNumber.trim(),
    expenseDate: values.expenseDate,
    vatMode: values.vatMode,
    lines: values.lines.map((line, index) => ({
      lineNumber: index + 1,
      description: line.description.trim(),
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      // Spec §19g decision 1: send the rate even when blank. Dropping it let the server fall back to
      // its own default, so the totals previewed here were not the totals stored.
      vatRate: line.vatRate,
      ...(line.whtRate && { whtRate: line.whtRate }),
      ...(line.expenseCategoryId && { expenseCategoryId: line.expenseCategoryId }),
      ...(line.accountHintKey && { accountHintKey: line.accountHintKey }),
      ...(line.taxCategory && { taxCategory: line.taxCategory }),
      ...(line.taxCodeDefinitionId && { taxCodeDefinitionId: line.taxCodeDefinitionId }),
      ...(line.externalTaxCode && { externalTaxCode: line.externalTaxCode }),
      ...(line.transactionContext && { transactionContext: line.transactionContext }),
    })),
  };
}

// The RD form follows the payee's taxpayer class, so the label carries the form it decides.
export const PAYEE_ENTITY_KIND_LABELS: Record<BuyerEntityKind, string> = {
  INDIVIDUAL: 'บุคคลธรรมดา (ภ.ง.ด.3)',
  JURISTIC: 'นิติบุคคล (ภ.ง.ด.53)',
};

export const CAPTURE_SOURCE_LABELS: Record<ExpenseCaptureSource, string> = {
  WEB_UPLOAD: 'อัปโหลดเว็บ',
  WEB_MANUAL: 'บันทึกด้วยมือ',
  LINE_UPLOAD: 'LINE',
  API_INTERNAL: 'ระบบ',
};

export const PAYMENT_METHOD_LABELS: Record<ExpensePaymentMethod, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  CARD: 'บัตรเครดิต',
  CHEQUE: 'เช็ค',
  OTHER: 'อื่นๆ',
};

export const POSTING_STATUS_LABELS: Record<ExpensePostingStatus, string> = {
  not_required: '-',
  pending: 'รอบันทึกบัญชี',
  posted: 'บันทึกแล้ว',
  posting_error: 'บันทึกผิดพลาด',
  reversed: 'ยกเลิกแล้ว',
};

/**
 * `postingError` holds a machine code on purpose — the ledger stores it that way and
 * template-company-posting.use-case.spec asserts it — so the wording belongs here, not in the API.
 * Codes ending in `:<accountId>` name the account that is missing or unusable.
 */
const POSTING_ERROR_LABELS: Record<string, string> = {
  posting_rule_missing: 'ยังไม่ได้กำหนดกฎการลงบัญชีสำหรับเอกสารประเภทนี้ กรุณาตั้งค่ากฎการลงบัญชีก่อน',
  posting_unbalanced: 'รายการบัญชีไม่สมดุล เดบิตและเครดิตไม่เท่ากัน กรุณาตรวจกฎการลงบัญชี',
  account_not_found: 'ไม่พบรหัสบัญชีที่กฎการลงบัญชีอ้างถึง กรุณาตรวจผังบัญชี',
  account_not_available: 'บัญชีที่กฎการลงบัญชีอ้างถึงถูกปิดใช้งานหรืออยู่นอกบริษัท',
  tax_snapshot_missing: 'ไม่พบข้อมูลภาษีของเอกสาร กรุณาตรวจรหัสภาษีของรายการ',
  tax_snapshot_needs_review: 'ข้อมูลภาษีของเอกสารยังรอตรวจสอบ กรุณายืนยันรหัสภาษีก่อนลงบัญชี',
  tax_source_currency_mismatch: 'สกุลเงินของภาษีไม่ตรงกับสกุลเงินของเอกสาร',
  mixed_currency_tax_snapshot: 'เอกสารมีหลายสกุลเงินหรือหลายอัตราแลกเปลี่ยน จึงลงบัญชีภาษีไม่ได้',
  functional_currency_fx_required: 'ต้องระบุอัตราแลกเปลี่ยนก่อนลงบัญชีเอกสารสกุลเงินต่างประเทศ',
  legacy_o0_tax_review_required: 'รหัสภาษี O0 ต้องระบุบริบทอัตราศูนย์และผ่านการตรวจสอบก่อนลงบัญชี',
  legacy_tax_snapshot_review_required: 'ข้อมูลภาษีรูปแบบเดิมต้องผ่านการตรวจสอบก่อนลงบัญชี',
};

/** Thai wording for a stored posting error. Values that are not codes (the auto-post worker
 *  writes a Thai sentence) pass through unchanged. */
export function postingErrorText(postingError: string | null | undefined): string | null {
  if (!postingError) return null;
  const [code, detail] = postingError.split(':');
  const label = POSTING_ERROR_LABELS[code];
  if (!label) return postingError;
  return detail ? `${label} (${detail})` : label;
}

export const TAX_EVIDENCE_REASON_LABELS: Record<TaxEvidenceReasonCode, string> = {
  VALID_TAX_INVOICE_FIELDS: 'ข้อมูลใบกำกับภาษีครบถ้วน',
  VALID_RECEIPT_FIELDS: 'ข้อมูลใบเสร็จรับเงินครบถ้วน',
  PAYMENT_EVIDENCE_ONLY: 'เป็นหลักฐานการจ่ายเงินเท่านั้น',
  MARKETPLACE_SCREENSHOT_ONLY: 'เป็นภาพคำสั่งซื้อจากมาร์เก็ตเพลสเท่านั้น',
  HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE: 'บิลเขียนมือหรือข้อความ ต้องจัดทำใบรับรองแทนใบเสร็จรับเงิน',
  MISSING_VENDOR_TAX_ID: 'ขาดเลขประจำตัวผู้เสียภาษีของผู้ขาย',
  MISSING_DOCUMENT_NUMBER: 'ขาดเลขที่เอกสาร',
  MISSING_MONETARY_AMOUNT: 'ขาดยอดเงิน',
  UNREADABLE_OR_LOW_CONFIDENCE: 'เอกสารอ่านไม่ชัดหรือข้อมูลยังไม่น่าเชื่อถือ',
  NOT_BUSINESS_EVIDENCE: 'ไม่ใช่หลักฐานทางธุรกิจ',
  ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE: 'ใบกำกับภาษีอย่างย่อ ใช้เป็นค่าใช้จ่ายได้ แต่ขอคืนภาษีซื้อไม่ได้ — ถ้าต้องการเครดิตภาษีซื้อ ขอใบกำกับภาษีเต็มรูปจากผู้ขาย',
  MANUAL_OVERRIDE: 'ผู้ตรวจแก้ไขผลด้วยตนเอง',
};

export const AI_SUMMARY_STATUS_LABELS: Record<string, string> = {
  OCR_EXTRACTED_NEEDS_REVIEW: 'อ่านข้อมูลจากเอกสารแล้ว รอตรวจสอบ',
  TEXT_NOTE_SEMANTIC_CAPTURE: 'อ่านข้อมูลจากโน้ตข้อความแล้ว รอตรวจสอบ',
  NOT_EXPENSE_DOCUMENT: 'เอกสารนี้อาจไม่ใช่หลักฐานค่าใช้จ่าย',
  HUMAN_OVERRIDDEN: 'ผู้ตรวจแก้ไขผลการจำแนกแล้ว',
  READY_FOR_CONFIRMATION: 'ข้อมูลพร้อมยืนยัน',
  NEEDS_REVIEW: 'รอตรวจสอบ',
};

export const AI_MISSING_FIELD_LABELS: Record<string, string> = {
  receipt_evidence: 'หลักฐานใบเสร็จหรือหลักฐานประกอบ',
  vendor: 'ชื่อผู้ขาย',
  vendorName: 'ชื่อผู้ขาย',
  vendorTaxId: 'เลขประจำตัวผู้เสียภาษีของผู้ขาย',
  expenseDate: 'วันที่รายจ่าย',
  documentNumber: 'เลขที่เอกสาร',
  grandTotalAmount: 'ยอดรวม',
  amount: 'ยอดเงิน',
  vatAmount: 'ภาษีมูลค่าเพิ่ม',
  category: 'หมวดหมู่ค่าใช้จ่าย',
};

export const AI_REVIEW_FIELD_KEYS = {
  vendorNameSnapshot: ['vendor', 'vendorName'],
  vendorTaxIdSnapshot: ['vendorTaxId'],
  expenseDate: ['expenseDate'],
  vendorDocumentNumber: ['documentNumber'],
  total: ['grandTotalAmount', 'amount'],
  vatAmount: ['vatAmount'],
  category: ['category'],
} as const;

export type AiReviewField = keyof typeof AI_REVIEW_FIELD_KEYS;

export function expenseAiFieldProvenance(
  summary: Record<string, unknown> | null,
  field: AiReviewField,
): { recognized: boolean; missing: boolean } | null {
  if (!summary) return null;
  const aliases: readonly string[] = AI_REVIEW_FIELD_KEYS[field];
  const recognizedFields = Array.isArray(summary['recognizedFields']) ? summary['recognizedFields'] : [];
  const missingFields = Array.isArray(summary['missingFields']) ? summary['missingFields'] : [];
  return {
    recognized: recognizedFields.some((value) => typeof value === 'string' && aliases.includes(value)),
    missing: missingFields.some((value) => typeof value === 'string' && aliases.includes(value)),
  };
}

/** Fields the AI read on a document its own gate refused to auto-apply. The server stores them
 *  under `suggestedFields` precisely because nothing was written, so the reviewer sees what the
 *  document said and stays the one who accepts it. */
export type ExpenseAiSuggestion = {
  vendorName?: string;
  vendorTaxId?: string;
  documentNumber?: string;
  expenseDate?: string;
  description?: string;
  grandTotalAmount?: string;
};

const AI_SUGGESTION_KEYS = ['vendorName', 'vendorTaxId', 'documentNumber', 'expenseDate', 'description', 'grandTotalAmount'] as const;

export function expenseAiSuggestion(summary: Record<string, unknown> | null): ExpenseAiSuggestion | null {
  const raw = summary?.['suggestedFields'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const out: ExpenseAiSuggestion = {};
  for (const key of AI_SUGGESTION_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) out[key] = value.trim().slice(0, 200);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export const AI_SUGGESTION_FIELD_LABELS: Record<keyof ExpenseAiSuggestion, string> = {
  vendorName: 'ชื่อผู้ขาย',
  vendorTaxId: 'เลขประจำตัวผู้เสียภาษีผู้ขาย',
  documentNumber: 'เลขที่เอกสาร',
  expenseDate: 'วันที่ค่าใช้จ่าย',
  description: 'รายละเอียด',
  grandTotalAmount: 'ยอดรวม',
};

/** Fills only blank header fields, and only adds a line when the draft has none — a reviewer's
 *  own typing always wins over a suggestion they clicked afterwards. */
export function applyExpenseAiSuggestion(
  values: ExpenseDraftReviewValues,
  suggestion: ExpenseAiSuggestion,
): ExpenseDraftReviewValues {
  const fill = (current: string, next: string | undefined) => current.trim() ? current : (next ?? current);
  const total = suggestion.grandTotalAmount?.replace(/,/g, '');
  const needsLine = values.lines.length === 0 && !!total && Number(total) > 0;
  return {
    ...values,
    vendorNameSnapshot: fill(values.vendorNameSnapshot, suggestion.vendorName),
    vendorTaxIdSnapshot: fill(values.vendorTaxIdSnapshot, suggestion.vendorTaxId),
    vendorDocumentNumber: fill(values.vendorDocumentNumber, suggestion.documentNumber),
    expenseDate: fill(values.expenseDate, suggestion.expenseDate),
    lines: needsLine
      ? [{
          description: suggestion.description ?? suggestion.vendorName ?? 'ค่าใช้จ่าย',
          quantity: '1', unitPrice: total, discountAmount: '0', vatRate: '', whtRate: null,
          expenseCategoryId: null, accountHintKey: null, taxCategory: null,
          taxCodeDefinitionId: null, externalTaxCode: null, transactionContext: 'DOMESTIC_PURCHASE',
        }]
      : values.lines,
  };
}

export function expenseRatePercent(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? String(Number((parsed * 100).toFixed(2))) : null;
}

/** Spec §19g decision 4 — the three ways a reviewer can express the same stored fraction. */
export type ExpenseVatRatePreset = 'unset' | 'standard' | 'zero' | 'custom';

export function vatRatePreset(vatRate: string): ExpenseVatRatePreset {
  if (vatRate.trim() === '') return 'unset';
  const rate = Number(vatRate);
  if (!Number.isFinite(rate)) return 'custom';
  if (Math.abs(rate - 0.07) <= 0.0002) return 'standard';
  if (rate === 0) return 'zero';
  return 'custom';
}

/** Switching to `custom` keeps whatever rate is already there so the reviewer edits it rather than
 *  losing it; the standard/zero presets are literal. */
export function vatRatePresetValue(preset: string, currentRate: string): string {
  if (preset === 'standard') return '0.07';
  if (preset === 'zero') return '0';
  if (preset === 'custom') return vatRatePreset(currentRate) === 'unset' ? '' : currentRate;
  return '';
}

export function expensePercentToRate(percent: string): string {
  if (percent.trim() === '') return '';
  const parsed = Number(percent);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 100) return '';
  return String(Number((parsed / 100).toFixed(6)));
}

/** Inverse of `expensePercentToRate` for the editable percent input. Unlike the display-only
 *  `expenseRatePercent`, a rate of 0 renders as "0" — the reviewer must be able to type it. */
export function expenseRateToPercent(vatRate: string): string {
  if (vatRate.trim() === '') return '';
  const parsed = Number(vatRate);
  if (!Number.isFinite(parsed)) return '';
  return String(Number((parsed * 100).toFixed(4)));
}

export const ATTACHMENT_PURPOSE_LABELS: Record<string, string> = {
  'expense.receipt.primary': 'เอกสารหลัก',
  'expense.receipt.supporting': 'หลักฐานประกอบ',
  'expense.payment.evidence': 'หลักฐานการจ่ายเงิน',
  'expense.review.evidence': 'เอกสารที่ผ่านการตรวจ',
  'expense.signature.asset': 'รูปลายเซ็น',
};

export const MIME_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'เอกสาร PDF',
  'image/jpeg': 'รูปภาพ JPEG',
  'image/jpg': 'รูปภาพ JPEG',
  'image/png': 'รูปภาพ PNG',
  'image/svg+xml': 'เอกสาร SVG',
};

export const SUBSTITUTE_RECEIPT_STATUS_LABELS: Record<string, string> = {
  PREPARED: 'เตรียมแล้ว รอผู้จ่ายลงนาม',
  PAYER_CERTIFIED: 'ผู้จ่ายลงนามแล้ว รออนุมัติ',
  ISSUED: 'ออกเอกสารสมบูรณ์แล้ว',
  SUPERSEDED: 'ยกเลิก version นี้แล้ว',
};

export function expenseValueLabel(labels: Record<string, string>, value: string | null | undefined, fallback = 'ข้อมูลจากระบบ'): string {
  if (!value) return '-';
  return labels[value] ?? fallback;
}

// ── accountant-first review checklist (Thai-only labels, same idiom as label maps above) ──
export type ExpenseAuditCheck = { key: string; status: 'pass' | 'warn' | 'info'; label: string; detail?: string };

export function deriveExpenseAuditChecks(detail: Pick<ExpenseDetail,
  'sourceDocumentType' | 'vendorTaxIdSnapshot' | 'vendorNameSnapshot' | 'vendorDocumentNumber' | 'expenseDate'
  | 'vatMode' | 'taxableAmount' | 'vatAmount' | 'taxEvidenceStatus' | 'taxEvidenceReasonCode' | 'duplicateStatus'>
  & { lines: Array<Pick<ExpenseDetail['lines'][number], 'vatRate' | 'taxableAmount'>> }): ExpenseAuditCheck[] {
  const checks: ExpenseAuditCheck[] = [];

  // OCR/manual entry can keep the dashes as printed on Thai invoices (0-1055-58096-34-8) — compare digits only.
  const taxIdRaw = (detail.vendorTaxIdSnapshot ?? '').trim();
  const taxIdDigits = taxIdRaw.replace(/\D/g, '');
  if (taxIdDigits.length === 13) {
    checks.push({ key: 'vendor_tax_id', status: 'pass', label: 'เลขผู้เสียภาษีผู้ขายครบ 13 หลัก' });
  } else {
    checks.push({
      key: 'vendor_tax_id',
      status: detail.sourceDocumentType === 'TAX_INVOICE' ? 'warn' : 'info',
      label: taxIdRaw ? 'เลขผู้เสียภาษีผู้ขายไม่ครบ 13 หลัก — ตรวจทานจากเอกสาร' : 'ยังไม่มีเลขผู้เสียภาษีผู้ขาย',
      detail: 'ใบกำกับภาษีเต็มรูปต้องมีเลข 13 หลัก จึงจะใช้เครดิตภาษีซื้อได้',
    });
  }

  checks.push((detail.vendorNameSnapshot ?? '').trim()
    ? { key: 'vendor_name', status: 'pass', label: 'ระบุชื่อผู้ขาย/ผู้รับเงินแล้ว' }
    : { key: 'vendor_name', status: 'warn', label: 'ยังไม่ระบุชื่อผู้ขาย/ผู้รับเงิน' });

  checks.push((detail.vendorDocumentNumber ?? '').trim()
    ? { key: 'document_number', status: 'pass', label: 'มีเลขที่เอกสารอ้างอิง' }
    : { key: 'document_number', status: 'warn', label: 'ยังไม่มีเลขที่เอกสารอ้างอิง' });

  checks.push(detail.expenseDate
    ? { key: 'document_date', status: 'pass', label: 'มีวันที่เอกสาร' }
    : { key: 'document_date', status: 'warn', label: 'ยังไม่ระบุวันที่เอกสาร' });

  if (vatModeRequiresRate(detail.vatMode) && Number(detail.taxableAmount) > 0) {
    // Spec §19g decision 5: compare against the document's OWN rate. Measuring every document
    // against a hardcoded 7% reported a draft whose VAT went missing as a legitimate non-standard
    // rate, which is exactly the state a reviewer must not be reassured about.
    const rates = detail.lines.map((line) => line.vatRate).filter((rate): rate is string => rate !== null && `${rate}`.trim() !== '');
    const expected = rates.length === detail.lines.length
      ? detail.lines.reduce((sum, line) => sum + Number(line.taxableAmount) * Number(line.vatRate ?? 0), 0)
      : null;
    if (expected === null) {
      checks.push({
        key: 'vat_check',
        status: 'warn',
        label: 'โหมดเอกสารระบุว่ามี VAT แต่ยังไม่ได้ระบุอัตรา VAT',
        detail: 'กรอกอัตราตามใบเสร็จ หรือกรอกยอด VAT ที่พิมพ์บนเอกสาร แล้วระบบจะคำนวณฐานภาษีให้',
      });
    } else if (Math.abs(expected - Number(detail.vatAmount)) > 0.05) {
      checks.push({ key: 'vat_check', status: 'warn', label: 'ยอด VAT ไม่ตรงกับอัตราที่ระบุไว้ — ตรวจทานอีกครั้ง' });
    } else if (rates.every((rate) => Math.abs(Number(rate) - 0.07) <= 0.0002)) {
      checks.push({ key: 'vat_check', status: 'pass', label: 'VAT ตรงกับฐานภาษี 7%' });
    } else {
      checks.push({
        key: 'vat_check',
        status: 'info',
        label: `VAT คำนวณตามอัตราที่ระบุ (${effectiveVatRateLabel(detail.lines)}) ไม่ใช่ 7% มาตรฐาน`,
      });
    }
  }

  if (detail.taxEvidenceStatus === 'USABLE_FOR_TAX') {
    checks.push({ key: 'tax_evidence', status: 'pass', label: 'ใช้เป็นหลักฐานภาษีซื้อได้' });
  } else if (detail.taxEvidenceStatus === 'SUPPORTING_ONLY') {
    // Spec §19h: an abbreviated invoice is complete, not deficient — say why it cannot be credited
    // and what to do about it, rather than the generic supporting-only line.
    checks.push(detail.taxEvidenceReasonCode === 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE'
      ? {
        key: 'tax_evidence',
        status: 'info',
        label: 'ใบกำกับภาษีอย่างย่อ — ลงเป็นค่าใช้จ่ายได้ แต่ขอคืนภาษีซื้อไม่ได้',
        detail: TAX_EVIDENCE_REASON_LABELS.ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE,
      }
      : { key: 'tax_evidence', status: 'info', label: 'เป็นหลักฐานประกอบ ใช้เครดิตภาษีซื้อไม่ได้' });
  } else {
    const reason = detail.taxEvidenceReasonCode ? TAX_EVIDENCE_REASON_LABELS[detail.taxEvidenceReasonCode] : undefined;
    checks.push({ key: 'tax_evidence', status: 'warn', label: 'หลักฐานภาษีรอตรวจสอบ', ...(reason ? { detail: reason } : {}) });
  }

  if (hasUnresolvedDuplicateWarning(detail.duplicateStatus)) {
    checks.push({ key: 'duplicate', status: 'warn', label: 'อาจเป็นรายการซ้ำ ต้องตรวจสอบก่อนยืนยัน' });
  }

  return checks;
}

// ── guided review stepper for the detail popup — step state derived from server truth only ──
export type ExpenseReviewStepKey = 'data' | 'evidence' | 'review';
export type ExpenseReviewStepState = 'done' | 'attention' | 'pending';
export type ExpenseReviewStep = { key: ExpenseReviewStepKey; state: ExpenseReviewStepState };

/** Single source of truth for "substitute receipt ready" — shared by ExpenseReviewPage and the stepper. */
export function expenseSubstituteReceiptReady(detail: Pick<ExpenseDetail, 'missingReceiptReason' | 'substituteReceiptGeneratedAt' | 'sourceDocumentType'> & {
  substituteReceiptEvidence: Pick<SubstituteReceiptEvidenceSummary, 'status' | 'artifactAttachmentId'> | null;
}): boolean {
  const reliesOnSubstitute = Boolean(detail.missingReceiptReason || detail.substituteReceiptGeneratedAt || detail.sourceDocumentType === 'SUBSTITUTE_RECEIPT');
  return !reliesOnSubstitute || (detail.substituteReceiptEvidence?.status === 'ISSUED' && Boolean(detail.substituteReceiptEvidence.artifactAttachmentId));
}

/** ACTIVE primary-slot receipt — the attachment that satisfies the server confirm rule (repo falls back to this purpose when `primaryAttachmentId` is unset). */
export function expenseHasPrimaryReceipt(attachments: ReadonlyArray<{ purpose?: string; status?: string }>): boolean {
  return attachments.some((attachment) => attachment.purpose === 'expense.receipt.primary' && attachment.status === 'ACTIVE');
}

/** The no-invoice state: neither branch of the server receipt-or-reason confirm rule can pass yet — route the user to attach a receipt or into the substitute-receipt flow. */
export function expenseNeedsReceiptOrSubstitute(detail: Pick<ExpenseDetail, 'missingReceiptReason' | 'substituteReceiptGeneratedAt' | 'sourceDocumentType'> & {
  attachments: ReadonlyArray<{ purpose?: string; status?: string }>;
  substituteReceiptEvidence: Pick<SubstituteReceiptEvidenceSummary, 'status'> | null;
}): boolean {
  const substitutePathStarted = Boolean(detail.missingReceiptReason || detail.substituteReceiptGeneratedAt
    || detail.sourceDocumentType === 'SUBSTITUTE_RECEIPT' || detail.substituteReceiptEvidence);
  return !substitutePathStarted && !expenseHasPrimaryReceipt(detail.attachments);
}

/** Which step owns the input that clears each AI "missing" flag — a flag must be raised on the step
 *  that can actually clear it, or the user sees ⚠ with no field to fill. The model emits arbitrary
 *  keys (`buyerName`, `description`, `categorySuggestion`, …); only keys the review form can supply
 *  — the ones the server's review-save clear map recognises — may gate the stepper, so unknown keys
 *  are ignored instead of dead-ending ส่งตรวจสอบ behind a field that does not exist. */
const AI_DATA_STEP_FIELDS = ['vendor', 'vendorName', 'vendorTaxId', 'documentNumber', 'expenseDate', 'vatAmount', 'grandTotalAmount', 'amount'];
const AI_EVIDENCE_STEP_FIELDS = ['category'];

/** Outstanding AI "missing" flags for one step. The server clears a flag when a review save supplies
 *  the value, so a remaining flag means "no human has confirmed this yet" — upload defaults
 *  `expenseDate` to today, which passes a plain non-empty check while still being unverified. */
export function expenseAiMissingFields(summary: Record<string, unknown> | null, step: 'data' | 'evidence'): string[] {
  const missing = Array.isArray(summary?.['missingFields']) ? summary['missingFields'] : [];
  const tracked = step === 'evidence' ? AI_EVIDENCE_STEP_FIELDS : AI_DATA_STEP_FIELDS;
  return missing.filter((field): field is string => typeof field === 'string' && tracked.includes(field));
}

export function deriveExpenseReviewSteps(
  detail: Pick<ExpenseDetail, 'aiVerificationSummaryJson' | 'vendorNameSnapshot' | 'expenseDate' | 'taxEvidenceStatus'
    | 'missingReceiptReason' | 'substituteReceiptGeneratedAt' | 'sourceDocumentType' | 'duplicateStatus'> & {
    attachments: ReadonlyArray<{ purpose?: string; status?: string }>;
    lines: ReadonlyArray<unknown>;
    substituteReceiptEvidence: Pick<SubstituteReceiptEvidenceSummary, 'status' | 'artifactAttachmentId'> | null;
  },
  canReview: boolean,
): ExpenseReviewStep[] {
  const classificationBlocked = deriveExpenseClassificationReviewState(detail.aiVerificationSummaryJson, canReview).blocked;
  const substituteReady = expenseSubstituteReceiptReady(detail);
  const needsReceiptOrSubstitute = expenseNeedsReceiptOrSubstitute(detail);
  const aiMissingEvidence = expenseAiMissingFields(detail.aiVerificationSummaryJson, 'evidence');
  // Real field values decide this step, not the AI flags: a value the user (or upload) supplied is
  // present whether or not OCR read it, and the blue "AI อ่านได้ไม่ครบ" banner already names the
  // fields worth a second look. Gating the tick on the flags left a filled-in step showing ⚠.
  const dataDone = (detail.vendorNameSnapshot ?? '').trim() !== '' && Boolean(detail.expenseDate) && detail.lines.length > 0;
  const evidenceState: ExpenseReviewStepState = detail.taxEvidenceStatus !== 'NEEDS_REVIEW' && !classificationBlocked && substituteReady && !needsReceiptOrSubstitute && aiMissingEvidence.length === 0
    ? 'done'
    : classificationBlocked || !substituteReady || needsReceiptOrSubstitute ? 'attention' : 'pending';
  return [
    { key: 'data', state: dataDone ? 'done' : 'pending' },
    { key: 'evidence', state: evidenceState },
    {
      key: 'review',
      // the final check cannot read as complete while an earlier section is not
      state: hasUnresolvedDuplicateWarning(detail.duplicateStatus)
        ? 'attention'
        : (detail.duplicateStatus === 'NO_MATCH' || detail.duplicateStatus === 'OVERRIDDEN') && dataDone && evidenceState === 'done' ? 'done' : 'pending',
    },
  ];
}

/** Guided review always opens on step 1; the stepper chips remain freely clickable so users can still jump manually. */
export function initialExpenseReviewStep(steps: ExpenseReviewStep[], status?: ExpenseStatus): ExpenseReviewStepKey {
  return 'data';
}

// ── permission capabilities — mirrors the effective backend gates (decorator ∩ use-case) ──
// A button the user cannot execute must not render; ownership-dependent gates
// (expense.update / receipt-upload OCR on own record) are resolved where `detail` is available.
export type ExpenseCapabilities = {
  canViewList: boolean;
  canReview: boolean;
  canConfirm: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canUploadReceipts: boolean;
  canRequestOcr: boolean;
  canReject: boolean;
  canVoid: boolean;
  canRecordPayment: boolean;
  canResolveDuplicates: boolean;
  canManageCategories: boolean;
  canManageSignatures: boolean;
  canApproveSignatures: boolean;
  canViewSharedEvidence: boolean;
  canExportPackage: boolean;
  canReadLedger: boolean;
  canPostLedger: boolean;
};

export function expenseCapabilities(permissions: string[]): ExpenseCapabilities {
  const has = (key: string) => permissions.includes(key);
  return {
    canViewList: has('expense.read') || has('expense.read_related') || has('expense.read_own'),
    canReview: has('expense.review'),
    canConfirm: has('expense.confirm'),
    canCreate: has('expense.create'),
    canUpdate: has('expense.update'),
    canDelete: has('expense.delete'),
    canUploadReceipts: has('expense.receipt.upload'),
    canRequestOcr: has('expense.ocr.request') || has('expense.review'),
    canReject: has('expense.reject'),
    canVoid: has('expense.void'),
    canRecordPayment: has('expense.payment.record'),
    canResolveDuplicates: has('expense.duplicate.resolve'),
    canManageCategories: has('expense.category.manage'),
    canManageSignatures: has('expense.signature.manage'),
    canApproveSignatures: has('expense.signature.approve'),
    canViewSharedEvidence: has('expense.evidence.read'),
    // POST /accountant-package requires both expense.export AND expense.read.
    canExportPackage: has('expense.export') && has('expense.read'),
    // Both stay false while the accounting screens are closed (owner decision 2026-08-09): the
    // "ลงบัญชี"/backfill buttons and the "ดู JV" link are the only ledger affordances outside the
    // ledger workspace itself. The permissions and the API are untouched — posting keeps happening
    // server-side, the user just has no button for it. See ACCOUNTING_UI_HIDDEN.
    canReadLedger: !ACCOUNTING_UI_HIDDEN && has('ledger.journal.read'),
    // POST /posting/generate is guarded by both controller permissions.
    canPostLedger: !ACCOUNTING_UI_HIDDEN && has('journal.entry.create') && has('journal.entry.post'),
  };
}

export function canDeleteExpense(
  expense: Pick<ExpenseSummary, 'status' | 'grandTotalAmount' | 'paymentStatus' | 'createdByUserId'>,
  userId: string,
  caps: Pick<ExpenseCapabilities, 'canDelete' | 'canUpdate'>,
): boolean {
  return isExpenseDeletableState(expense)
    && (caps.canDelete || (caps.canUpdate && expense.createdByUserId === userId));
}

export type ExpenseKpis = {
  counted: number; total: number; outstanding: number; overdue: number;
  overdueCount: number; vat: number; pending: number;
};

/** `today` is passed in rather than read here so the overdue boundary stays testable. */
export function summarizeExpenseKpis(
  rows: ReadonlyArray<Pick<ExpenseSummary, 'status' | 'grandTotalAmount' | 'vatAmount' | 'outstandingAmount' | 'paymentStatus' | 'dueDate'>>,
  today: string,
): ExpenseKpis {
  const kpi: ExpenseKpis = { counted: 0, total: 0, outstanding: 0, overdue: 0, overdueCount: 0, vat: 0, pending: 0 };
  for (const row of rows) {
    // Cancelled documents are skipped wholesale. Outstanding already did this; the headline total
    // and the VAT card did not, so a rejected receipt inflated both — and the VAT card claims to
    // show creditable input tax, which a rejected document can never be.
    if (isExpenseCancelled(row.status)) continue;
    kpi.counted += 1;
    kpi.total += Number(row.grandTotalAmount || 0);
    kpi.vat += Number(row.vatAmount || 0);
    if (isExpensePending(row.status)) kpi.pending += 1;
    if (row.paymentStatus === 'PAID') continue;
    kpi.outstanding += Number(row.outstandingAmount || 0);
    if (row.dueDate && row.dueDate.slice(0, 10) < today) {
      kpi.overdue += Number(row.outstandingAmount || 0);
      kpi.overdueCount += 1;
    }
  }
  return kpi;
}

/**
 * The contract types these fields as `string | null`, but blanks still arrive — the detail form
 * coerces null to '' before saving — so `??` alone lets an empty string through to the screen.
 */
export function firstFilled(...values: Array<string | null | undefined>): string | undefined {
  return values.find((value): value is string => Boolean(value?.trim()));
}

/**
 * Names the record in the delete confirmation. Deliberately no id fallback: a cuid tells the user
 * nothing, so an unnamed record gets a sentence without quotes instead of empty ones.
 */
export function expenseDeleteTargetLabel(
  expense: Pick<ExpenseSummary, 'expenseNumber' | 'vendorDocumentNumber' | 'vendorNameSnapshot'>,
): string | undefined {
  return firstFilled(expense.expenseNumber, expense.vendorDocumentNumber, expense.vendorNameSnapshot);
}

const EXPENSE_DELETE_BLOCKER_LABELS: Record<string, Record<SupportedLocale, string>> = {
  PAYMENT: { th: 'ข้อมูลการชำระเงิน', en: 'recorded payment' },
  TAX_EVENT: { th: 'เหตุการณ์ภาษี', en: 'tax event' },
  TAX_REVIEW_ISSUE: { th: 'ประเด็นตรวจสอบภาษี', en: 'tax review issue' },
  TAX_RECONCILIATION_LINE: { th: 'รายการกระทบยอดภาษี', en: 'tax reconciliation line' },
  TRADE_TAX_EVIDENCE: { th: 'หลักฐานภาษีการค้า', en: 'trade tax evidence' },
  JOURNAL_ENTRY: { th: 'สมุดรายวัน', en: 'journal entry' },
  JOURNAL_LINE: { th: 'รายการบัญชีในสมุดรายวัน', en: 'journal line' },
  BANK_RECONCILIATION_MATCH: { th: 'การจับคู่กระทบยอดธนาคาร', en: 'bank reconciliation match' },
  WORKFLOW_RUN: { th: 'การทำงานของเวิร์กโฟลว์', en: 'workflow run' },
  WORKFLOW_TASK: { th: 'งานในเวิร์กโฟลว์', en: 'workflow task' },
  WORKFLOW_EVENT_INBOX: { th: 'เหตุการณ์ที่รอประมวลผลในเวิร์กโฟลว์', en: 'workflow event' },
  NOTIFICATION_EVENT: { th: 'เหตุการณ์แจ้งเตือน', en: 'notification event' },
};

export function expenseDeleteErrorMessage(error: unknown, locale: SupportedLocale): string {
  const candidate = error as {
    code?: unknown;
    details?: { code?: unknown; blocker?: unknown };
  } | null | undefined;
  const code = candidate?.code ?? candidate?.details?.code;
  const blocker = candidate?.details?.blocker;
  if (code === 'EXPENSE_HAS_LINKED_DATA' && typeof blocker === 'string') {
    const label = EXPENSE_DELETE_BLOCKER_LABELS[blocker]?.[locale];
    if (!label) {
      return locale === 'th'
        ? 'ลบรายการนี้ไม่ได้ เนื่องจากมีข้อมูลอื่นเชื่อมโยงอยู่ กรุณาตรวจสอบรายการที่เกี่ยวข้อง'
        : 'This expense cannot be deleted because it has linked data. Review the related records.';
    }
    return locale === 'th'
      ? `ลบรายการนี้ไม่ได้ เนื่องจากมีข้อมูลเชื่อมโยง: ${label}`
      : `This expense cannot be deleted because it has linked data: ${label}.`;
  }
  if (code === 'EXPENSE_CHANGED_DURING_DELETE') {
    return locale === 'th'
      ? 'รายการถูกแก้ไขระหว่างการลบ กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง'
      : 'The expense changed during deletion. Reload and try again.';
  }
  if (error instanceof Error) return apiErrorMessage(error);
  return locale === 'th' ? 'เกิดข้อผิดพลาด' : 'An error occurred.';
}

export type ExpensesTab = 'list' | 'upload' | 'manual' | 'categories' | 'signatures' | 'evidence';

export function canAccessExpenseTab(tab: ExpensesTab, caps: ExpenseCapabilities): boolean {
  const allowed: Record<ExpensesTab, boolean> = {
    list: caps.canViewList,
    upload: caps.canUploadReceipts,
    manual: caps.canCreate,
    categories: caps.canManageCategories,
    signatures: false, // feature-disabled: no consumer for approved signatures yet (owner decision 2026-08-05)
    evidence: caps.canViewSharedEvidence,
  };
  return allowed[tab];
}
