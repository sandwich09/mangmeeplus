import { TAX_EVIDENCE_REASON_LABELS, EXPENSE_CORRECTION_WORDS, normalizeExpensePaymentAmount, thaiTaxIdChecksumValid, todayCivilDate, canVoidExpenseFinancialState } from '@watchdog-bms/contracts';
import { INCOME_POSITIVE_MONEY_PATTERN } from '../accounting-documents/income-record.logic';
import { JPEG_LABEL } from '@watchdog-bms/contracts';
import { expenseEvidenceImageMissing, EXPENSE_DOCUMENT_IMAGE_MISSING_LABEL, expenseEvidenceAssessment, expenseEvidenceConfirmationError, hasCurrentExpenseEvidenceReview } from '@watchdog-bms/contracts';
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
  ExpenseVatCaptureSnapshotV1,
  ExpenseVatSourceInput,
  ExpenseWhtInput,
  ExpenseWhtCapture,
  ExpenseLineVatTreatment,
  ExpenseLineChargeKind,
  ExpenseChargeSummary,
  ExpenseTotalsIdentity,
  RecordExpensePaymentInput,
  ExpenseDocumentDateStatus,
  ExpenseSourceDraft,
  ExpenseSourceDraftInput,
} from '@watchdog-bms/contracts';
import {
  EXPENSE_STATUS_LABELS as CONTRACT_EXPENSE_STATUS_LABELS, EXPENSE_VAT_MODE_LABELS,
  SOURCE_DOCUMENT_TYPE_LABELS as CONTRACT_SOURCE_DOCUMENT_TYPE_LABELS, TAX_EVIDENCE_STATUS_LABELS, SIGNATURE_ASSET_STATUS_LABELS,
  expenseOverpaidAmount, expenseReimbursementProgressLabel, isExpenseCancelled, isExpenseDeletableState, isExpensePending, isExpensePendingReview, isNonExpenseClassificationBlocking, isCheckBillClassification,
  effectiveVatRateLabel, vatModeRequiresRate, civilDate, civilDateToUtcDate, civilPeriodKey, isCivilDate,
  EXPENSE_LINE_CHARGE_KINDS, EXPENSE_LINE_CHARGE_KIND_LABELS, expenseChargeKindAllowsNegative,
  expenseDocumentDateStatus, expenseDateIsReadable, isCalculatedExpenseRounding, hasCurrentExpenseDocumentReview,
} from '@watchdog-bms/contracts';
export { isExpensePending, isExpensePendingReview, expenseReimbursementProgressLabel, expenseDocumentReviewFieldsComplete, hasCurrentExpenseDocumentReview } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { ACCOUNTING_UI_HIDDEN } from '@/features/web-core-workspace/web-core-workspace.constants';

export type ExpensePaymentAttempt = {
  companyId: string;
  expenseId: string;
  payload: RecordExpensePaymentInput;
};

export type ExpensePaymentFailure = 'definitive' | 'uncertain' | 'conflict';

/** A later refusal cannot disprove a commit hidden by an earlier lost response. */
export function classifyExpensePaymentFailure(error: unknown, hadUncertainOutcome: boolean): ExpensePaymentFailure {
  const failure = error as { status?: unknown; statusCode?: unknown; code?: unknown; details?: unknown } | null | undefined;
  const details = failure?.details && typeof failure.details === 'object' ? failure.details as typeof failure : undefined;
  if ((failure?.code ?? details?.code) === 'expense_payment_idempotency_conflict') return 'conflict';
  if (hadUncertainOutcome) return 'uncertain';
  const status = [failure?.status, failure?.statusCode, details?.status, details?.statusCode].find((value) => typeof value === 'number');
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 ? 'definitive' : 'uncertain';
}

/** Retain the exact wire payload on uncertain errors; an edit/confirmed success clears previous. */
export function expensePaymentAttempt(
  previous: ExpensePaymentAttempt | null,
  companyId: string,
  expenseId: string,
  input: Omit<RecordExpensePaymentInput, 'idempotencyKey'>,
  createKey: () => string = () => crypto.randomUUID(),
): ExpensePaymentAttempt {
  if (previous && previous.companyId === companyId && previous.expenseId === expenseId
    && previous.payload.paidAmount === input.paidAmount && previous.payload.paymentMethod === input.paymentMethod
    && previous.payload.paidAt === input.paidAt && previous.payload.bankAccountRef === input.bankAccountRef
    && previous.payload.slipAttachmentId === input.slipAttachmentId) return previous;
  return { companyId, expenseId, payload: { ...input, idempotencyKey: createKey() } };
}

export type {
  ExpenseStatus, ExpenseVatMode, ExpensePaymentStatus, ExpensePostingStatus, ExpensePostingSourceType, AiVerificationStatus, DuplicateStatus,
  ExpenseCaptureSource, ExpensePaymentMethod, InputVatClaimStatus, ExpenseCategorySummary,
  SourceDocumentType, TaxEvidenceStatus, TaxEvidenceReasonCode, ExpenseLineReviewStatus,
  SignatureAssetSummary, SignatureAssetStatus, SharedEvidenceView, SharedEvidenceRow,
  AccountantPackageResult, EvidenceManifestEntry,
  SubstituteReceiptEvidenceSummary,
  ExpensePaymentSummary,
  ExpenseLineChargeKind,
  ExpenseChargeSummary,
  ExpenseTotalsIdentity,
};

export {
  EXPENSE_VAT_MODE_LABELS,
  TAX_EVIDENCE_STATUS_LABELS, SIGNATURE_ASSET_STATUS_LABELS,
  effectiveVatRateLabel, vatModeRequiresRate,
  EXPENSE_LINE_CHARGE_KINDS, EXPENSE_LINE_CHARGE_KIND_LABELS, expenseChargeKindAllowsNegative,
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

export function canRunExpenseDuplicateCheck(status: ExpenseStatus): boolean {
  return ['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(status);
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
// Keep decimal input exact through the server's half-up steps; binary floats lose half a satang.
function decimalFraction(value: string | number | null | undefined): [bigint, bigint] {
  const text = String(value ?? '0').replace(/,/g, '').trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || !Number.isFinite(Number(text)) || Number(text) === 0) return [0n, 1n];
  const places = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
  const units = BigInt(`${match[1] === '-' ? '-' : ''}${match[2] || '0'}${match[3] ?? ''}`);
  return places < 0 ? [units * 10n ** BigInt(-places), 1n] : [units, 10n ** BigInt(places)];
}
function halfUp(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  const positive = numerator * sign;
  return sign * (positive / denominator + (positive % denominator * 2n >= denominator ? 1n : 0n));
}

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
  discountAmount?: string | number;
}): { subtotal: number; vat: number; grandTotal: number } {
  // Mirror the API's calcLineTotals: round the product, discount, tax base and VAT in that order.
  const [quantity, quantityScale] = decimalFraction(input.quantity);
  const [price, priceScale] = decimalFraction(input.unitPrice);
  const product = halfUp(quantity * price * 100n, quantityScale * priceScale);
  const [discountUnits, discountScale] = decimalFraction(input.discountAmount);
  const discount = halfUp(discountUnits * 100n, discountScale);
  const maxDiscount = product > 0n ? product : 0n;
  const afterDiscount = product - (discount < maxDiscount ? discount : maxDiscount);
  const [rate, rateScale] = decimalFraction(input.vatRate);
  let taxable = afterDiscount, vat = 0n;
  if (input.vatMode === 'VAT_INCLUDED' && rate > 0n) {
    taxable = halfUp(afterDiscount * rateScale, rateScale + rate);
    vat = afterDiscount - taxable;
  } else if (input.vatMode === 'VAT_EXCLUDED') {
    vat = halfUp(taxable * rate, rateScale);
  }
  return { subtotal: Number(taxable) / 100, vat: Number(vat) / 100, grandTotal: Number(taxable + vat) / 100 };
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
      chargeKind: 'SERVICE_CHARGE',
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

/** Check bills need a plain-language recovery card, not the generic finance blocker. */
export function isBlockedCheckBillClassification(
  summary: Record<string, unknown> | null | undefined,
): boolean {
  if (!isNonExpenseClassificationBlocking(summary)) return false;
  const classification = summary?.['classification'];
  return Boolean(classification && typeof classification === 'object' && !Array.isArray(classification)
    && (classification as Record<string, unknown>)['documentKind'] === 'ORDER_OR_CHECK_BILL');
}

/** Keep every expense entry on the same document; navigation never prepares a second one. */
export function expenseSubstituteReceiptAction(
  companyId: string,
  expenseId: string,
  summary: Record<string, unknown> | null,
  evidence: Pick<SubstituteReceiptEvidenceSummary, 'id' | 'status'> | null | undefined,
) {
  if (evidence && evidence.status !== 'SUPERSEDED') {
    return {
      href: `/companies/${encodeURIComponent(companyId)}/expenses/substitute-receipts/${encodeURIComponent(evidence.id)}`,
      labelKey: evidence.status === 'ISSUED' ? 'expenses.substitute_hub.open_document' as const : 'expenses.substitute_hub.continue' as const,
    };
  }
  return { href: substituteReceiptPreparationHref(companyId, expenseId, summary), labelKey: 'expenses.no_receipt_start_substitute' as const };
}

export function substituteReceiptPreparationHref(companyId: string, expenseId: string, summary: Record<string, unknown> | null): string {
  return `/companies/${encodeURIComponent(companyId)}/expenses/substitute-receipts/new?expenseId=${encodeURIComponent(expenseId)}`
    + (isCheckBillClassification(summary) ? '&route=check-bill' : '');
}

export type ExpenseSummary = {
  hasDeletionBlockingHistory?: import('@watchdog-bms/contracts').ExpenseSummary['hasDeletionBlockingHistory'];
  hasRetainedSubstituteReceiptEvidence?: import('@watchdog-bms/contracts').ExpenseSummary['hasRetainedSubstituteReceiptEvidence'];
  cancelledCertificate?: import('@watchdog-bms/contracts').ExpenseSummary['cancelledCertificate'];
  /**
   * Vendor-address spec §7: not a column — the outcome of THIS write's counterparty auto-save, so
   * the review page can show the create/fill toast, the one-line "address differs" notice or the
   * "ยังไม่ได้บันทึกลงทะเบียนคู่ค้า" bar. Present on a write response only, never on a read.
   */
  vendorCounterpartyAutoSave?: import('@watchdog-bms/contracts').VendorCounterpartyAutoSaveResult;
  costSourceExpenseId?: string;
  reimbursementProgress?: import('@watchdog-bms/contracts').ExpenseReimbursementProgress;
  id: string;
  branchId: string | null;
  expenseNumber: string | null;
  status: ExpenseStatus;
  /** Claim projection marker — settled by the reimbursement payout, no manual payment. */
  sourceReimbursementRequestId?: string | null;
  captureSource: ExpenseCaptureSource;
  /** Set once this expense belongs to a capture group (appendix §2.3); null on every other record. */
  captureGroupId?: string | null;
  vendorNameSnapshot: string | null;
  vendorDocumentNumber: string | null;
  expenseDate: string;
  currency: string;
  vatMode: ExpenseVatMode;
  vatAmount: string;
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
  /** Spec §5.2: whether `expenseDate` was read off the document or is the upload-day placeholder. */
  dateStatus?: ExpenseDocumentDateStatus;
  uploadedAt: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

/** Days between the printed document date and the Bangkok intake date for the cross-month badge. */
export function lateDocumentDays(expense: Pick<ExpenseSummary, 'expenseDate' | 'uploadedAt'>): number | null {
  const documentDate = expense.expenseDate.slice(0, 10);
  const uploadedAt = new Date(expense.uploadedAt);
  if (!isCivilDate(documentDate) || Number.isNaN(uploadedAt.getTime())) return null;
  const intakeDate = civilDate(uploadedAt);
  if (intakeDate <= documentDate || civilPeriodKey(intakeDate) === civilPeriodKey(documentDate)) return null;
  return (civilDateToUtcDate(intakeDate).getTime() - civilDateToUtcDate(documentDate).getTime()) / 86_400_000;
}

export type ExpenseDetail = ExpenseSummary & {
  /** Same resolved evidence facts as the accounting evidence list. */
  sourceEvidenceUnavailable?: boolean;
  categoryName?: string | null;
  inputVatRight?: import('@watchdog-bms/contracts').ExpenseInputVatRightView;
  reviewRequest?: import('@watchdog-bms/contracts').ExpenseDetail['reviewRequest'];
  correctionOpenedAt?: string | null;
  correctionCapabilities?: import('@watchdog-bms/contracts').ExpenseCorrectionCapabilities;
  /** Vendor-address Slice 2: the printed buyer block and its registry comparison (warn-only). */
  buyerAsPrinted?: import('@watchdog-bms/contracts').ExpenseBuyerAsPrinted | null;
  primaryAttachmentId?: string | null;
  extractionId?: string | null;
  sourceDraft?: ExpenseSourceDraft | null;
  /** Suggested input Tax Code from this expense's category. A hint for the line picker only. */
  categoryDefaultInputTaxCode?: string | null;
  vendorTaxIdSnapshot: string | null;
  vendorBranchCodeSnapshot: string | null;
  /** Vendor address spec §6: the seller address as printed on this document, one free-text block. */
  vendorAddressSnapshot: string | null;
  vendorEntityKindSnapshot: BuyerEntityKind | null;
  receivedAt: string | null;
  inputVatClaimStatus: InputVatClaimStatus;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  whtAmount: string;
  /** WHT certificate system issuance plan §1.2: ประเภทเงินได้/อัตรา, mirrors SupplierPayment. */
  whtCategoryCode: string | null;
  whtRate: string | null;
  whtInputJson?: ExpenseWhtCapture | null;
  paymentMethod: ExpensePaymentMethod | null;
  paidAt: string | null;
  accountHintKey: string | null;
  taxCategory: string | null;
  missingReceiptReason: string | null;
  sourceDocumentLanguage: string | null;
  taxEvidenceReasonCode: TaxEvidenceReasonCode | null;
  substituteReceiptGeneratedAt: string | null;
  substituteReceiptEvidence: SubstituteReceiptEvidenceSummary | null;
  /** Appendix §5: set only on a derived source of a capture group; absent on everything else. */
  captureGroup?: import('@watchdog-bms/contracts').ExpenseCaptureLineage | null;
  aiVerifiedFieldsJson: Record<string, unknown> | null;
  aiVerificationSummaryJson: Record<string, unknown> | null;
  vatCaptureSnapshotJson: ExpenseVatCaptureSnapshotV1 | null;
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
    sourceLineText?: string | null;
    /** Non-null makes this an additional-charge row rather than a product row (spec §5.1). */
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
    reviewStatus: ExpenseLineReviewStatus;
    taxSnapshot?: TransactionTaxSnapshot;
    taxComponents?: TransactionTaxComponentPreview[];
  }>;
  /** The charge rows, already grouped and labelled by the API — the money card reads this rather
   *  than re-deriving the rule on the client. */
  charges: ExpenseChargeSummary[];
  /** Stored header vs stored lines. False on a record written before §5.1, or by anything that
   *  bypasses the draft use-cases — the money card says so rather than printing a total whose own
   *  parts contradict it. Branch on `ok`; see `ExpenseTotalsIdentity.gapAmount`. */
  totalsIdentity: ExpenseTotalsIdentity;
  attachments: Array<{
    sourceExpenseId?: string;
    isHistorical?: boolean;
    substituteReceiptStatus?: string;
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
  /** Vendor address spec §6/§11.2: as printed, ≤ 500 characters. '' means the document had none. */
  vendorAddressSnapshot: string;
  /** CON-8: five digits, or '' for สำนักงานใหญ่. '' is stored as null — never the string '00000'. */
  vendorBranchCodeSnapshot: string;
  /** Shared by source drafts and linked certificates; preserve capture provenance. */
  businessPurpose?: string;
  originalBusinessPurpose?: string;
  removedSourceItemRefs?: string[];
  originalNote?: string | null;
  /** '' = ยังไม่ระบุ. Only asked for when the document withholds tax (ภ.ง.ด.3 vs ภ.ง.ด.53). */
  vendorEntityKindSnapshot?: BuyerEntityKind | '';
  /** '' = ยังไม่ระบุ. Same "only asked for when withholding tax" gate as vendorEntityKindSnapshot;
   *  whtRate rides along, filled from the picked category's defaultRate. */
  whtCategoryCode?: string | '';
  whtRate?: string;
  vendorDocumentNumber: string;
  expenseDate: string;
  vatMode: ExpenseVatMode;
  vatSource?: ExpenseVatSourceInput;
  whtInput?: ExpenseWhtInput;
  lines: Array<{
    /** Existing rows keep their server identity; newly inserted review rows omit it. */
    id?: string;
    sourceItemRef?: string;
    /** Server-held evidence; never sent as editable provenance. */
    sourceLineText?: string | null;
    description: string;
    /** §5.1: charge rows live in the same array as products and always sort after them, so the
     *  line numbers the payload sends already satisfy the server's ordering rule. */
    chargeKind?: ExpenseLineChargeKind | null;
    quantity: string;
    unitPrice: string;
    discountAmount: string;
    vatRate: string;
    vatTreatment?: ExpenseLineVatTreatment | null;
    whtRate: string | null;
    expenseCategoryId: string | null;
    accountHintKey: string | null;
    taxCategory: string | null;
    taxCodeDefinitionId?: string | null;
    externalTaxCode?: string | null;
    transactionContext?: import('@watchdog-bms/contracts').TransactionTaxContext;
  }>;
};

/** A re-read updates clean fields; an attachment change must not overwrite unsaved input. */
export function mergeExpenseUnsavedFields<T extends object>(previous: T, incoming: T, current: T): T {
  return Object.fromEntries(Object.keys({ ...incoming, ...current }).map(key => {
    const field = key as keyof T;
    return [key, JSON.stringify(current[field]) === JSON.stringify(previous[field]) ? incoming[field] : current[field]];
  })) as T;
}

export function reviewValues(detail: ExpenseDetail, prefillCertificatePayee = false): ExpenseDraftReviewValues {
  const receiptProblem = expenseEvidenceAssessment(detail)?.receiptProblem;
  const payee = prefillCertificatePayee && !detail.vendorNameSnapshot?.trim()
    && (receiptProblem === 'NOT_AVAILABLE' || receiptProblem === 'LOST') && detail.substituteReceiptEvidence?.status !== 'SUPERSEDED'
    ? detail.substituteReceiptEvidence?.payeeName?.trim() : undefined;
  const source = ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status) ? detail.sourceDraft : null;
  const storedPurpose = detail.note?.split(' · ').find((part) => part.trim().startsWith('วัตถุประสงค์:'))?.trim().slice('วัตถุประสงค์:'.length).trim();
  const issuedReceipt = detail.substituteReceiptEvidence?.status === 'ISSUED' ? detail.substituteReceiptEvidence : null;
  const vendorName = source ? source.header.vendorName || (issuedReceipt ? detail.vendorNameSnapshot || issuedReceipt.payeeName : '') : detail.vendorNameSnapshot;
  const businessPurpose = source ? source.header.businessPurpose || (issuedReceipt ? storedPurpose || issuedReceipt.businessPurpose : '')
    : storedPurpose ?? detail.substituteReceiptEvidence?.businessPurpose;
  let vatSource = expenseVatSourceFromSnapshot(detail.vatCaptureSnapshotJson);
  const lines: ExpenseDraftReviewValues['lines'] = detail.lines.map((line) => ({
      id: line.id, description: line.description, chargeKind: line.chargeKind ?? null, sourceLineText: line.sourceLineText,
      quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: line.discountAmount,
      vatRate: line.vatRate ?? '', vatTreatment: line.vatTreatment ?? null, whtRate: line.whtRate,
      expenseCategoryId: line.expenseCategoryId, accountHintKey: line.accountHintKey, taxCategory: line.taxCategory,
      taxCodeDefinitionId: line.taxSnapshot?.taxCodeDefinitionId ?? null,
      externalTaxCode: line.taxSnapshot?.externalTaxCode ?? null,
      transactionContext: line.taxSnapshot?.taxContext ?? 'DOMESTIC_PURCHASE',
  }));
  // A rejected OCR breakdown is evidence, not additional purchases beside an accepted summary.
  // Explicit user additions and drafts with no financial rows still need their editable rows.
  const hasFinancialProducts = detail.lines.some((line) => !line.chargeKind);
  const assigned = new Set<string>();
  for (const item of source?.items ?? []) {
    const storedMatches = lines.filter((line) => line.id && !assigned.has(line.id)
      && (item.lineId ? line.id === item.lineId : !line.chargeKind && line.description === item.description));
    const matched = storedMatches.length === 1 ? storedMatches[0] : storedMatches.find((line) =>
      Number(item.quantity) === Number(line.quantity) && item.unitPrice !== null && Number(item.unitPrice) === Number(line.unitPrice));
    const unitPrice = item.unitPrice ?? (item.totalAmount != null && Number(item.quantity) > 0
      ? (Number(item.totalAmount) / Number(item.quantity)).toFixed(4) : '');
    if (matched?.id) {
      if (item.lineId) matched.sourceItemRef = item.itemRef;
      assigned.add(matched.id);
      continue;
    }
    if (hasFinancialProducts && !item.newItem) continue;
    const chargeIndex = lines.findIndex((line) => line.chargeKind);
    const at = chargeIndex < 0 ? lines.length : chargeIndex;
    lines.splice(at, 0, {
      sourceItemRef: item.itemRef,
      description: item.description ?? '', quantity: item.quantity ?? '', unitPrice,
      discountAmount: '0', vatRate: '', whtRate: null, expenseCategoryId: item.expenseCategoryId,
      accountHintKey: null, taxCategory: null,
    });
    if (vatSource.lines?.length) {
      vatSource = {
        ...vatSource,
        lines: [
          ...vatSource.lines.map((line) => ({
            ...line, lineNumber: line.lineNumber > at ? line.lineNumber + 1 : line.lineNumber,
          })),
          { lineNumber: at + 1, inputType: 'NONE' as const },
        ].sort((left, right) => left.lineNumber - right.lineNumber),
      };
    }
  }
  return {
    vendorNameSnapshot: vendorName?.trim() ? vendorName : payee ?? '',
    vendorTaxIdSnapshot: detail.vendorTaxIdSnapshot ?? '',
    vendorAddressSnapshot: detail.vendorAddressSnapshot ?? '',
    vendorBranchCodeSnapshot: detail.vendorBranchCodeSnapshot ?? '',
    vendorEntityKindSnapshot: detail.vendorEntityKindSnapshot ?? '',
    whtCategoryCode: detail.whtCategoryCode ?? '',
    whtRate: detail.whtRate ?? '',
    vendorDocumentNumber: detail.vendorDocumentNumber ?? '',
    expenseDate: source ? source.header.expenseDate ?? ''
      : expenseDateIsReadable(detail.aiVerificationSummaryJson) ? detail.expenseDate.slice(0, 10) : '',
    vatMode: detail.vatMode,
    vatSource,
    ...(detail.whtInputJson && { whtInput: { inputType: detail.whtInputJson.inputType, value: detail.whtInputJson.value,
      ...(detail.whtInputJson.baseAmount !== undefined && { baseAmount: detail.whtInputJson.baseAmount }) } }),
    ...(businessPurpose !== undefined && { businessPurpose, originalBusinessPurpose: source ? source.header.businessPurpose ?? '' : businessPurpose, originalNote: detail.note }),
    lines,
  };
}

/**
 * Spec §5.1: an additional charge always sorts after every product, so adding a PRODUCT inserts it
 * BEFORE the charges rather than at the end — appending would build the one payload shape the API
 * refuses, and the reviewer would only meet the refusal on save. `vatSource.lines` is keyed by line
 * number, so it shifts with the insert.
 *
 * Pure, and in the model rather than inline in the page, so the rule is tested by exercising it
 * instead of by matching the component's source.
 */
export function insertExpenseReviewLine(
  values: ExpenseDraftReviewValues,
  chargeKind: ExpenseLineChargeKind | null,
): ExpenseDraftReviewValues {
  const firstCharge = values.lines.findIndex((line) => line.chargeKind != null);
  const at = chargeKind !== null || firstCharge < 0 ? values.lines.length : firstCharge;
  const fresh: ExpenseDraftReviewValues['lines'][number] = {
    description: chargeKind === null ? '' : EXPENSE_LINE_CHARGE_KIND_LABELS[chargeKind],
    chargeKind, quantity: '1', unitPrice: '0', discountAmount: '0', vatRate: '', vatTreatment: null,
    whtRate: values.whtInput ? null : expenseDocumentWhtRate(values.lines) || null,
    expenseCategoryId: null, accountHintKey: null, taxCategory: null,
    taxCodeDefinitionId: null, externalTaxCode: null, transactionContext: 'DOMESTIC_PURCHASE',
  };
  return {
    ...values,
    lines: [...values.lines.slice(0, at), fresh, ...values.lines.slice(at)],
    ...(values.vatSource?.lines?.length && {
      vatSource: {
        ...values.vatSource,
        lines: [
          ...values.vatSource.lines.map((sourceLine) => ({
            ...sourceLine, lineNumber: sourceLine.lineNumber > at ? sourceLine.lineNumber + 1 : sourceLine.lineNumber,
          })),
          { lineNumber: at + 1, inputType: 'NONE' as const },
        ].sort((left, right) => left.lineNumber - right.lineNumber),
      },
    }),
  };
}

/** Removes one line and closes the gap `vatSource.lines` leaves behind. */
export function removeExpenseReviewLine(
  values: ExpenseDraftReviewValues,
  index: number,
): ExpenseDraftReviewValues {
  return {
    ...values,
    ...(values.lines[index]?.sourceItemRef && { removedSourceItemRefs: [
      ...(values.removedSourceItemRefs ?? []), values.lines[index]!.sourceItemRef!,
    ] }),
    lines: values.lines.filter((_, lineIndex) => lineIndex !== index),
    ...(values.vatSource?.lines?.length && {
      vatSource: {
        ...values.vatSource,
        lines: values.vatSource.lines
          .filter((sourceLine) => sourceLine.lineNumber !== index + 1)
          .map((sourceLine) => ({ ...sourceLine, lineNumber: sourceLine.lineNumber > index + 1 ? sourceLine.lineNumber - 1 : sourceLine.lineNumber })),
      },
    }),
  };
}

/** A charge description the reviewer never customised — kept in step with the kind. "ค่าบริการ 10%"
 *  read off a bill is not one of these and survives a kind change. */
export function isPlainChargeLabel(description: string): boolean {
  return description.trim() === ''
    || (Object.values(EXPENSE_LINE_CHARGE_KIND_LABELS) as string[]).includes(description.trim());
}

/** The kind a charge row carries after the reviewer picks a new one, description following only
 *  while it was still the untouched default. */
export function applyChargeKindChange(
  line: ExpenseDraftReviewValues['lines'][number],
  chargeKind: ExpenseLineChargeKind,
): ExpenseDraftReviewValues['lines'][number] {
  return {
    ...line,
    chargeKind,
    description: isPlainChargeLabel(line.description) ? EXPENSE_LINE_CHARGE_KIND_LABELS[chargeKind] : line.description,
  };
}

export function allowsDomesticInputTaxCode(
  sourceDocumentType: SourceDocumentType,
  taxEvidenceStatus: TaxEvidenceStatus,
): boolean {
  return ['TAX_INVOICE', 'CUSTOMS_VAT_RECEIPT', 'PP36_RECEIPT'].includes(sourceDocumentType) && taxEvidenceStatus !== 'SUPPORTING_ONLY';
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

type ExpenseDraftReviewPayloadOptions = {
  sourceDraft?: ExpenseSourceDraft | null;
  originalLines?: ExpenseDetail['lines'];
  partial?: boolean;
};

/** An incomplete source row remains staged until it has enough facts to become money. */
export function incompleteSourceReviewLine(
  line: ExpenseDraftReviewValues['lines'][number],
  vatMode: ExpenseVatMode,
): boolean {
  return Boolean(line.sourceItemRef
    && (!line.description.trim() || !line.quantity.trim() || !line.unitPrice.trim()
      || (vatModeRequiresRate(vatMode) && !line.vatRate.trim())));
}

function reviewValuesForPartialSave(
  values: ExpenseDraftReviewValues,
  originalLines: ExpenseDetail['lines'] = [],
): ExpenseDraftReviewValues {
  const originalById = new Map(originalLines.map((line) => [line.id, line]));
  const kept = values.lines.map((line, index) => ({ line, index }))
    .filter(({ line }) => line.id || !incompleteSourceReviewLine(line, values.vatMode));
  const lineNumbers = new Map(kept.map(({ index }, savedIndex) => [index + 1, savedIndex + 1]));
  return {
    ...values,
    lines: kept.map(({ line }) => {
      const original = line.id ? originalById.get(line.id) : undefined;
      if (!line.sourceItemRef || !original) return line;
      return {
        ...line,
        quantity: line.quantity.trim() ? line.quantity : original.quantity,
        unitPrice: line.unitPrice.trim() ? line.unitPrice : original.unitPrice,
      };
    }),
    ...(values.vatSource?.lines?.length && {
      vatSource: {
        ...values.vatSource,
        lines: values.vatSource.lines.flatMap((line) => {
          const lineNumber = lineNumbers.get(line.lineNumber);
          return lineNumber ? [{ ...line, lineNumber }] : [];
        }),
      },
    }),
  };
}

function sourceReviewInput(
  values: ExpenseDraftReviewValues,
  sourceDraft: ExpenseSourceDraft,
): ExpenseSourceDraftInput {
  const sourceValue = (value: string | null | undefined) => value?.trim() || null;
  return {
    expenseDate: sourceDraft.header.expenseDate === null && values.expenseDate === ''
      ? null : sourceValue(values.expenseDate),
    vendorName: sourceValue(values.vendorNameSnapshot),
    ...(values.businessPurpose !== values.originalBusinessPurpose && { businessPurpose: sourceValue(values.businessPurpose) }),
    items: values.lines.flatMap((line) => {
      if (!line.sourceItemRef) return [];
      return [{
        itemRef: line.sourceItemRef,
        description: sourceValue(line.description),
        quantity: sourceValue(line.quantity),
        unitPrice: sourceValue(line.unitPrice),
        expenseCategoryId: sourceValue(line.expenseCategoryId),
      }];
    }),
  };
}

export function buildExpenseDraftReviewPayload(
  values: ExpenseDraftReviewValues,
  options: ExpenseDraftReviewPayloadOptions = {},
): UpdateExpenseDraftInput {
  const payloadValues = options.partial ? reviewValuesForPartialSave(values, options.originalLines) : values;
  const includeLines = !options.partial || payloadValues.lines.length > 0 || Boolean(values.removedSourceItemRefs?.length);
  const includeTaxFacts = !options.partial || payloadValues.lines.length > 0;
  return {
    ...(values.removedSourceItemRefs?.length && { removedSourceItemRefs: values.removedSourceItemRefs }),
    ...(values.businessPurpose !== undefined && values.businessPurpose !== values.originalBusinessPurpose && { note: [
      ...(values.originalNote?.trim() === values.originalBusinessPurpose?.trim() ? '' : values.originalNote ?? '').split(' · ').filter((part) => part && !part.trim().startsWith('วัตถุประสงค์:')),
      ...(values.businessPurpose.trim() ? [`วัตถุประสงค์: ${values.businessPurpose.trim()}`] : []),
    ].join(' · ') }),
    ...((!options.sourceDraft || values.vendorNameSnapshot.trim()) && { vendorNameSnapshot: values.vendorNameSnapshot.trim() }),
    vendorTaxIdSnapshot: taxIdDigits(values.vendorTaxIdSnapshot),
    // Blank clears the column. `|| null` on purpose (CON-8/§6): the API stores what it is sent, and
    // `''` or `'00000'` for "the reviewer left it empty" would make an empty field look like a
    // typed head-office code to the vendor matcher.
    vendorAddressSnapshot: values.vendorAddressSnapshot.trim() || null,
    vendorBranchCodeSnapshot: values.vendorBranchCodeSnapshot.trim() || null,
    ...(values.vendorEntityKindSnapshot && { vendorEntityKindSnapshot: values.vendorEntityKindSnapshot }),
    ...(values.whtInput?.value === '0' && values.whtCategoryCode === ''
      ? { whtCategoryCode: '', whtRate: '0' }
      : values.whtCategoryCode && { whtCategoryCode: values.whtCategoryCode, ...(values.whtRate && { whtRate: values.whtRate }) }),
    vendorDocumentNumber: values.vendorDocumentNumber.trim(),
    ...((!options.sourceDraft || values.expenseDate) && { expenseDate: values.expenseDate }),
    vatMode: values.vatMode,
    ...(includeTaxFacts && payloadValues.vatSource && { vatSource: payloadValues.vatSource }),
    // A half-typed value ("03", "") never reaches the API malformed; a blank one is refused before any save
    // while หัก is chosen (ExpenseReviewEditSection.save), so "0" here only feeds the totals preview.
    ...(includeTaxFacts && values.whtInput && { whtInput: { ...values.whtInput, value: normalizeExpenseWhtValue(values.whtInput.value) || '0' } }),
    ...(options.partial && options.sourceDraft && { sourceDraft: sourceReviewInput(values, options.sourceDraft) }),
    ...(includeLines && { lines: payloadValues.lines.map((line, index) => ({
      ...(line.id && { id: line.id }),
      ...(line.sourceItemRef && { sourceItemRef: line.sourceItemRef }),
      lineNumber: index + 1,
      description: line.description.trim(),
      // ALWAYS sent, unlike the other optional line fields here. `lines` is a replacement and the
      // server reads an ABSENT kind as "keep what this row already had", matching the row by its
      // description. Omitting it on product rows let a newly typed ของหวาน pick up a kind it never
      // had — and the server cannot tell that apart from a caller that genuinely means "keep".
      // Stating it on every row makes this form's intent explicit and the server's guess unnecessary.
      chargeKind: line.chargeKind ?? null,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      // Spec §19g decision 1: send the rate even when blank. Dropping it let the server fall back to
      // its own default, so the totals previewed here were not the totals stored.
      vatRate: line.vatRate,
      ...(line.vatTreatment !== undefined && { vatTreatment: line.vatTreatment }),
      ...(!values.whtInput && line.whtRate && { whtRate: line.whtRate }),
      ...(line.expenseCategoryId && { expenseCategoryId: line.expenseCategoryId }),
      ...(line.accountHintKey && { accountHintKey: line.accountHintKey }),
      ...(line.taxCategory && { taxCategory: line.taxCategory }),
      ...(line.taxCodeDefinitionId && { taxCodeDefinitionId: line.taxCodeDefinitionId }),
      ...(line.externalTaxCode && { externalTaxCode: line.externalTaxCode }),
      ...(line.transactionContext && { transactionContext: line.transactionContext }),
    })) }),
  };
}

/** A newly selected document unit must not resurrect evidence from the previous unit. */
export function changeExpenseVatSourceType(
  values: ExpenseDraftReviewValues,
  inputType: ExpenseVatSourceInput['inputType'] | 'LINES',
  lineIndex?: number,
): ExpenseDraftReviewValues {
  const currentType = lineIndex === undefined
    ? values.vatSource?.lines?.length ? 'LINES' : values.vatSource?.inputType ?? 'NONE'
    : values.vatSource?.lines?.find((line) => line.lineNumber === lineIndex + 1)?.inputType ?? 'NONE';
  if (inputType === currentType) return values;
  const perLine = inputType === 'LINES' || lineIndex !== undefined;
  return {
    ...values,
    vatSource: perLine ? {
      inputType: 'NONE',
      lines: values.lines.flatMap((line, index) => {
        if (isCalculatedExpenseRounding(line)) return [];
        const previous = values.vatSource?.lines?.find((source) => source.lineNumber === index + 1);
        return [lineIndex !== undefined && index !== lineIndex
          ? previous ?? { lineNumber: index + 1, inputType: 'NONE' }
          : { lineNumber: index + 1, inputType: inputType === 'LINES' ? 'NONE' : inputType }];
      }),
    } : { inputType },
  };
}

export function expenseVatSourceFromSnapshot(
  snapshot: ExpenseVatCaptureSnapshotV1 | null | undefined,
): ExpenseVatSourceInput {
  if (!snapshot || snapshot.version !== 1) return { inputType: 'NONE' };
  return {
    inputType: snapshot.source.inputType,
    ...(snapshot.source.vatRatePercent !== null && { vatRatePercent: String(Number(snapshot.source.vatRatePercent)) }),
    ...(snapshot.source.vatAmount !== null && { vatAmount: Number(snapshot.source.vatAmount).toFixed(2) }),
    ...(snapshot.source.lineSources?.length && {
      lines: snapshot.source.lineSources.map((line) => ({
        lineNumber: line.lineNumber,
        inputType: line.inputType,
        ...(line.vatRatePercent !== undefined && { vatRatePercent: String(Number(line.vatRatePercent)) }),
        ...(line.vatAmount !== undefined && { vatAmount: Number(line.vatAmount).toFixed(2) }),
      })),
    }),
  };
}

export function expenseVatSourceValidationMessage(source: ExpenseVatSourceInput, vatMode?: ExpenseVatMode): string | null {
  const needsRate = source.inputType === 'RATE' || source.inputType === 'BOTH';
  const needsAmount = source.inputType === 'AMOUNT' || source.inputType === 'BOTH';
  const rate = Number(source.vatRatePercent);
  const amount = Number(source.vatAmount);
  const percentText = source.vatRatePercent?.trim() ?? '';
  const amountText = source.vatAmount?.trim() ?? '';
  if (needsRate && (!/^(?:0|[1-9]\d?)(?:\.\d{1,4})?$/.test(percentText) || !Number.isFinite(rate) || rate < 0 || rate >= 100)) {
    return 'กรอกอัตรา VAT เป็นเปอร์เซ็นต์ 0–99.9999 ไม่เกิน 4 ตำแหน่ง';
  }
  if (needsAmount && (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(amountText) || !Number.isFinite(amount) || amount < 0)) {
    return 'กรอกจำนวน VAT จากเอกสารเป็นบาท ไม่เกิน 2 ตำแหน่ง';
  }
  for (const line of source.lines ?? []) {
    const lineError = expenseVatSourceValidationMessage({
      inputType: line.inputType,
      ...(line.vatRatePercent !== undefined && { vatRatePercent: line.vatRatePercent }),
      ...(line.vatAmount !== undefined && { vatAmount: line.vatAmount }),
    });
    if (lineError) return `รายการ ${line.lineNumber}: ${lineError}`;
  }
  const sourceAmounts = [source.vatAmount, ...(source.lines ?? []).map((line) => line.vatAmount)]
    .filter((value): value is string => value !== undefined);
  const sourceRates = [source.vatRatePercent, ...(source.lines ?? []).map((line) => line.vatRatePercent)]
    .filter((value): value is string => value !== undefined);
  if ((vatMode === 'NO_VAT' || vatMode === 'EXEMPT')
    && (sourceAmounts.some((value) => Number(value) > 0) || sourceRates.some((value) => Number(value) > 0))) {
    return 'เอกสารไม่มี VAT หรือได้รับยกเว้น จึงระบุอัตราหรือจำนวน VAT มากกว่า 0 ไม่ได้';
  }
  return null;
}

export const EXPENSE_PAYMENT_STATUS_LABELS: Record<ExpensePaymentStatus, string> = {
  UNPAID: 'ยังไม่จ่าย', PARTIALLY_PAID: 'จ่ายบางส่วน', PAID: 'จ่ายแล้ว', VOIDED: 'ยกเลิก',
};
export const EXPENSE_STATUS_LABELS = { ...CONTRACT_EXPENSE_STATUS_LABELS, VOIDED: workspaceDictionary.th['expenses.cancelled_label'] };
export const SOURCE_DOCUMENT_TYPE_LABELS = { ...CONTRACT_SOURCE_DOCUMENT_TYPE_LABELS, NEEDS_REVIEW: workspaceDictionary.th['expenses.document_type_choose'] };

// Tax form names belong to the field hint.
export const PAYEE_ENTITY_KIND_LABELS: Record<BuyerEntityKind, string> = {
  INDIVIDUAL: workspaceDictionary.th['expenses.payee_person'],
  JURISTIC: workspaceDictionary.th['expenses.payee_company'],
};

export const CAPTURE_SOURCE_LABELS: Record<ExpenseCaptureSource, string> = {
  WEB_UPLOAD: 'อัปโหลดเว็บ',
  WEB_MANUAL: 'บันทึกด้วยมือ',
  LINE_UPLOAD: 'LINE',
  API_INTERNAL: 'ระบบ',
};

export { EXPENSE_PAYMENT_METHOD_LABELS as PAYMENT_METHOD_LABELS } from '@watchdog-bms/contracts';

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
  posting_rule_missing: 'ยังไม่ได้กำหนดกฎการลงบัญชีสำหรับเอกสารประเภทนี้ ตั้งค่ากฎการลงบัญชีก่อน',
  posting_unbalanced: 'รายการบัญชีไม่สมดุล เดบิตและเครดิตไม่เท่ากัน ตรวจกฎการลงบัญชี',
  account_not_found: 'ไม่พบรหัสบัญชีที่กฎการลงบัญชีอ้างถึง ตรวจผังบัญชี',
  account_not_available: 'บัญชีที่กฎการลงบัญชีอ้างถึงถูกปิดใช้งานหรืออยู่นอกบริษัท',
  tax_snapshot_missing: 'ไม่พบข้อมูลภาษีของเอกสาร ตรวจรหัสภาษีของรายการ',
  tax_snapshot_needs_review: 'ข้อมูลภาษีของเอกสารยังรอตรวจสอบ ยืนยันรหัสภาษีก่อนลงบัญชี',
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

export { TAX_EVIDENCE_REASON_LABELS } from '@watchdog-bms/contracts';

export function expenseTaxEvidenceReasonMessage(code?: TaxEvidenceReasonCode | null): string | null {
  return code && ['HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE', 'HANDWRITTEN_RECEIPT_REVIEW', 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE'].includes(code)
    ? TAX_EVIDENCE_REASON_LABELS[code] : null;
}

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
  // Vendor address spec §7 (D3 step two): the OCR does not emit `vendorAddress` yet. Registered now
  // so the field wears the same "AI อ่านจากใบ" badge as every other read field the day it does.
  vendorAddressSnapshot: ['vendorAddress'],
  expenseDate: ['expenseDate'],
  vendorDocumentNumber: ['documentNumber'],
  total: ['grandTotalAmount', 'amount'],
  vatAmount: ['vatAmount'],
  category: ['category'],
} as const;

export type AiReviewField = keyof typeof AI_REVIEW_FIELD_KEYS;

// Spec §5.2: one implementation in contracts, shared with the API list mapper, so the web and the
// server can never disagree about what a stored date is.
export { expenseDocumentDateStatus, expenseDateIsReadable } from '@watchdog-bms/contracts';

export const EXPENSE_DATE_STATUS_LABELS: Record<ExpenseDocumentDateStatus, string | null> = {
  verified: null,
  assumed: 'อ่านจากบิล',
  unverified: 'ยังไม่ยืนยันวันที่',
  implausible: 'วันที่ผิดปกติ',
};

export function expenseAiFieldProvenance(
  summary: Record<string, unknown> | null,
  field: AiReviewField,
): { recognized: boolean; missing: boolean } | null {
  if (!summary) return null;
  const aliases: readonly string[] = AI_REVIEW_FIELD_KEYS[field];
  // Every producer writes `recognizedFields` as the `ReceiptOcrFieldResult` OBJECT — the field
  // names are its KEYS. Reading it as a `string[]` made `recognized` permanently false, so the AI
  // badge this function exists to drive has never rendered. A key present but empty is not a
  // reading, so the value has to be there too.
  const raw = summary['recognizedFields'];
  const recognizedFields = Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === 'string')
    : raw && typeof raw === 'object'
      ? Object.entries(raw as Record<string, unknown>)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key]) => key)
      : [];
  const missingFields = Array.isArray(summary['missingFields']) ? summary['missingFields'] : [];
  return {
    recognized: recognizedFields.some((value) => aliases.includes(value)),
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

/** Spec S1-R4: the AI's expense category for the document, already resolved by the API against the
 *  company's active catalogue. It is present whatever the confidence — below the auto-fill bar the
 *  server wrote nothing, so the form must offer it as a recommendation the reviewer taps, never as
 *  a pre-selected value. `detail.expenseCategoryId` remains the only applied category. */
export type ExpenseAiCategorySuggestion = {
  expenseCategoryId: string;
  confidence: number;
  categoryName: string;
};

export function expenseAiCategorySuggestion(summary: Record<string, unknown> | null): ExpenseAiCategorySuggestion | null {
  const raw = summary?.['categorySuggestion'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const id = source['expenseCategoryId'];
  const confidence = source['confidence'];
  const name = source['categoryName'];
  return typeof id === 'string' && id.trim()
    && typeof confidence === 'number' && Number.isFinite(confidence)
    && typeof name === 'string' && name.trim()
    ? { expenseCategoryId: id, confidence, categoryName: name.slice(0, 200) }
    : null;
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

/** One value drives the bill-level WHT control. `null` means existing lines disagree, so the UI
 *  leaves them untouched until the reviewer deliberately enters a replacement rate. */
export function expenseDocumentWhtRate(lines: Array<{ whtRate: string | null }>): string | null {
  const rates = lines.map((line) => line.whtRate?.trim() ?? '');
  return rates.every((rate) => rate === rates[0]) ? rates[0] ?? '' : null;
}

/** Explicit input (including zero) wins over the previous saved total and line rates. */
export function expenseReviewWithholdsTax(values: ExpenseDraftReviewValues, savedWhtAmount?: string | null): boolean {
  return values.whtInput
    ? Number(values.whtInput.value) > 0
    : Number(savedWhtAmount) > 0 || values.lines.some((line) => Number(line.whtRate) > 0);
}

/** Blank is a reviewer decision to clear WHT, using the API's existing explicit-zero idiom. */
export function changeExpenseReviewWhtInput(values: ExpenseDraftReviewValues, input: ExpenseWhtInput): ExpenseDraftReviewValues {
  if (input.value.trim() !== '') return { ...values, whtInput: input };
  return {
    ...values,
    whtInput: { inputType: input.inputType, value: '0' },
    whtCategoryCode: '', whtRate: '',
    lines: values.lines.map((line) => ({ ...line, whtRate: null })),
  };
}

/** R2: only digits and one decimal point enter the withholding field; "-" and letters never do. */
export function sanitizeExpenseWhtTyping(value: string): string {
  const [whole = '', ...rest] = value.replace(/[^\d.]/g, '').split('.');
  return rest.length ? `${whole}.${rest.join('')}` : whole;
}

/** R2: what was typed, tidied the way leaving the field does — "03" → "3", ".5" → "0.5", "3." → "3". Blank stays blank. */
export function normalizeExpenseWhtValue(value: string): string {
  const [whole = '', fraction = ''] = value.trim().split('.');
  if (!whole && !fraction) return '';
  return `${whole.replace(/^0+(?=\d)/, '') || '0'}${fraction ? `.${fraction}` : ''}`;
}

export type ExpenseVatRatePreset = 'unset' | 'standard' | 'exempt' | 'zero' | 'nonVat' | 'unknownZero' | 'custom';

export function vatRatePreset(vatRate: string, vatTreatment?: ExpenseLineVatTreatment | null): ExpenseVatRatePreset {
  if (vatRate.trim() === '') return 'unset';
  const rate = Number(vatRate);
  if (!Number.isFinite(rate)) return 'custom';
  if (Math.abs(rate - 0.07) <= 0.0002) return 'standard';
  // A legacy zero tells us the amount, not why VAT does not apply. Never invent its tax meaning.
  if (rate === 0) return vatTreatment === 'EXEMPT' ? 'exempt' : vatTreatment === 'ZERO_RATED' ? 'zero'
    : vatTreatment === 'NON_VAT' ? 'nonVat' : 'unknownZero';
  return 'custom';
}

export function vatTreatmentForPreset(preset: string): ExpenseLineVatTreatment | null {
  return preset === 'exempt' ? 'EXEMPT' : preset === 'zero' ? 'ZERO_RATED' : preset === 'nonVat' ? 'NON_VAT' : null;
}

/** Switching to `custom` keeps whatever rate is already there so the reviewer edits it rather than
 *  losing it; the standard/exempt/zero presets are literal. */
export function vatRatePresetValue(preset: string, currentRate: string): string {
  if (preset === 'standard') return '0.07';
  if (preset === 'exempt' || preset === 'zero' || preset === 'nonVat' || preset === 'unknownZero') return '0';
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

/** Both signing stages stay stored; the expense viewer presents the issued document once. */
export function expenseDisplayAttachments(detail: Pick<ExpenseDetail, 'attachments' | 'substituteReceiptEvidence'>) {
  const certificate = detail.substituteReceiptEvidence;
  if (certificate?.status !== 'ISSUED' || !certificate.artifactAttachmentId) return detail.attachments;
  return detail.attachments.filter(file => file.id !== certificate.certifiedArtifactAttachmentId || file.id === certificate.artifactAttachmentId)
    .map(file => file.id === certificate.artifactAttachmentId ? { ...file, originalFileName: `ใบรับรองแทนใบเสร็จ ${certificate.documentNumber}` } : file);
}

export function expenseAttachmentTypeLabel(file: ExpenseDetail['attachments'][number], certificate: ExpenseDetail['substituteReceiptEvidence']) {
  return file.id === certificate?.artifactAttachmentId ? 'ไฟล์เอกสาร' : MIME_TYPE_LABELS[file.mimeType] ?? 'ไฟล์เอกสาร';
}

/** R11: the hand-signed scan is linked with the certification-chain purpose that system-rendered
 *  artifacts use, so the purpose alone would call a photograph of real ink “เอกสารที่ผ่านการตรวจ”.
 *  It stays visible — that photo is the only place the signatures exist — under its own name. */
export function isWetSignedScanAttachment(
  attachmentId: string,
  evidence: { wetSignedScanAttachmentId?: string | null } | null | undefined,
): boolean {
  return Boolean(evidence?.wetSignedScanAttachmentId) && evidence!.wetSignedScanAttachmentId === attachmentId;
}

export const MIME_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'เอกสาร PDF',
  'image/jpeg': `รูปภาพ ${JPEG_LABEL}`,
  'image/jpg': `รูปภาพ ${JPEG_LABEL}`,
  'image/png': 'รูปภาพ',
  'image/svg+xml': 'ภาพเวกเตอร์',
};

export const SUBSTITUTE_RECEIPT_STATUS_LABELS: Record<string, string> = {
  PREPARED: workspaceDictionary.th['expenses.substitute_hub.status_prepared'],
  PAYER_CERTIFIED: workspaceDictionary.th['expenses.substitute_hub.status_payer_certified'],
  ISSUED: workspaceDictionary.th['expenses.substitute_hub.status_issued'],
  SUPERSEDED: workspaceDictionary.th['expenses.substitute_hub.status_superseded'],
};

export function expenseSubstituteReceiptStatus(evidence: Pick<SubstituteReceiptEvidenceSummary, 'status'> & Partial<Pick<SubstituteReceiptEvidenceSummary, 'signatureMode' | 'payerUserId' | 'paperSubmission'>>): string {
  if (evidence.status === 'PREPARED' && evidence.signatureMode === 'PAPER' && !evidence.payerUserId) {
    return evidence.paperSubmission ? 'รอตรวจรับฉบับกระดาษ' : 'รอฉบับที่เซ็นบนกระดาษ';
  }
  return SUBSTITUTE_RECEIPT_STATUS_LABELS[evidence.status];
}

export function expenseValueLabel(labels: Record<string, string>, value: string | null | undefined, fallback = 'ข้อมูลจากระบบ'): string {
  if (!value) return '-';
  return labels[value] ?? fallback;
}

export function expenseSourceDocumentLabel(detail: Pick<ExpenseDetail, 'sourceDocumentType' | 'taxEvidenceStatus' | 'aiVerificationSummaryJson'>): string {
  const problem = expenseEvidenceAssessment(detail)?.receiptProblem;
  return detail.sourceDocumentType === 'EXPENSE_NOTE_TEXT' && (problem === 'NOT_AVAILABLE' || problem === 'LOST')
    ? 'ไม่มีใบเสร็จ' : expenseValueLabel(SOURCE_DOCUMENT_TYPE_LABELS, detail.sourceDocumentType, 'เอกสารค่าใช้จ่าย');
}

// ── accountant-first review checklist (Thai-only labels, same idiom as label maps above) ──
export type ExpenseAuditCheck = { key: string; status: 'pass' | 'warn' | 'info'; label: string; detail?: string };

export function deriveExpenseAuditChecks(detail: Pick<ExpenseDetail,
  'sourceDocumentType' | 'vendorTaxIdSnapshot' | 'vendorNameSnapshot' | 'vendorDocumentNumber' | 'expenseDate'
  | 'vatMode' | 'taxableAmount' | 'vatAmount' | 'taxEvidenceStatus' | 'taxEvidenceReasonCode' | 'duplicateStatus'
  | 'aiVerificationSummaryJson'>
  & { attachments?: ExpenseDetail['attachments']; inputVatRight?: ExpenseDetail['inputVatRight']; lines: Array<Pick<ExpenseDetail['lines'][number], 'vatRate' | 'taxableAmount'>>;
    substituteReceiptEvidence?: (Pick<SubstituteReceiptEvidenceSummary, 'status' | 'documentNumber'> & Partial<Pick<SubstituteReceiptEvidenceSummary, 'signatureMode' | 'payerUserId' | 'paperSubmission'>>) | null }): ExpenseAuditCheck[] {
  const checks: ExpenseAuditCheck[] = [];
  const assessment = expenseEvidenceAssessment(detail);
  if (expenseEvidenceImageMissing(detail)) checks.push({ key: 'receipt', status: 'warn', label: EXPENSE_DOCUMENT_IMAGE_MISSING_LABEL });
  const noReceipt = assessment?.receiptProblem === 'NOT_AVAILABLE' || assessment?.receiptProblem === 'LOST';
  if (noReceipt) {
    const certificate = detail.substituteReceiptEvidence;
    const activeCertificate = certificate && certificate.status !== 'SUPERSEDED';
    checks.push({ key: 'receipt', status: certificate?.status === 'ISSUED' ? 'pass' : assessment.route === 'SUBSTITUTE_RECEIPT' ? 'warn' : 'info',
      label: assessment.receiptProblem === 'LOST' ? 'ใบเสร็จหาย' : 'ไม่มีใบเสร็จ',
      ...(activeCertificate ? { detail: `ใบรับรองแทนใบเสร็จ ${certificate.documentNumber} · ${expenseSubstituteReceiptStatus(certificate)}` }
        : assessment.route === 'SUBSTITUTE_RECEIPT' ? { detail: 'ยังไม่ได้ทำใบรับรองแทนใบเสร็จ' } : {}) });
  }

  const invalidSellerTaxId = (detail.vendorTaxIdSnapshot ?? '').replace(/\D/g, '').length === 13 && !thaiTaxIdChecksumValid(detail.vendorTaxIdSnapshot!.replace(/\D/g, ''));
  if (invalidSellerTaxId || !noReceipt && ['TAX_INVOICE', 'CUSTOMS_VAT_RECEIPT', 'PP36_RECEIPT'].includes(detail.sourceDocumentType) && detail.inputVatRight?.vatStatus !== 'NOT_REGISTERED') {
    // OCR/manual entry can keep the dashes as printed on Thai invoices (0-1055-58096-34-8) — compare digits only.
    const taxIdRaw = (detail.vendorTaxIdSnapshot ?? '').trim();
    const taxIdDigits = taxIdRaw.replace(/\D/g, '');
    if (taxIdDigits.length === 13) {
      const valid = thaiTaxIdChecksumValid(taxIdDigits);
      checks.push({ key: 'vendor_tax_id', status: valid ? 'pass' : 'warn', label: valid
        ? 'เลขผู้เสียภาษีผู้ขายครบ 13 หลัก' : 'เลขผู้เสียภาษีผู้ขายครบ 13 หลัก แต่ดูไม่ถูกต้อง' });
    } else {
      checks.push({
        key: 'vendor_tax_id',
        status: detail.sourceDocumentType === 'TAX_INVOICE' ? 'warn' : 'info',
        label: taxIdRaw ? 'เลขผู้เสียภาษีผู้ขายไม่ครบ 13 หลัก — ตรวจทานจากเอกสาร' : 'ยังไม่มีเลขผู้เสียภาษีผู้ขาย',
        detail: 'กรอกเลขผู้เสียภาษีผู้ขายให้ครบ 13 หลักก่อนตรวจ VAT สำหรับยื่นภาษี',
      });
    }
  }

  checks.push((detail.vendorNameSnapshot ?? '').trim()
    ? { key: 'vendor_name', status: 'pass', label: 'ระบุชื่อผู้ขาย/ผู้รับเงินแล้ว' }
    : { key: 'vendor_name', status: 'warn', label: 'ยังไม่ระบุชื่อผู้ขาย/ผู้รับเงิน' });

  if (!noReceipt) checks.push((detail.vendorDocumentNumber ?? '').trim()
    ? { key: 'document_number', status: 'pass', label: 'มีเลขที่เอกสารอ้างอิง' }
    : { key: 'document_number', status: 'warn', label: 'ยังไม่มีเลขที่เอกสารอ้างอิง' });

  // Spec §5.2: `expenseDate` is NOT NULL, so "there is a value" was never the question — an unread
  // receipt stores the upload day and this check happily called that "มีวันที่เอกสาร".
  const documentDateStatus = expenseDocumentDateStatus(detail.aiVerificationSummaryJson);
  checks.push(detail.expenseDate && documentDateStatus !== 'unverified' && documentDateStatus !== 'implausible'
    ? { key: 'document_date', status: 'pass', label: documentDateStatus === 'assumed' ? 'มีวันที่เอกสาร (อ่านจากบิล)' : 'มีวันที่เอกสาร' }
    : { key: 'document_date', status: 'warn', label: documentDateStatus === 'implausible' ? 'วันที่เอกสารผิดปกติ' : 'ยังไม่ระบุวันที่เอกสาร' });

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
        detail: 'กรอกอัตราหรือยอด VAT ตามใบเสร็จ',
      });
    } else if (Math.abs(expected - Number(detail.vatAmount)) > 0.05) {
      checks.push({ key: 'vat_check', status: 'warn', label: 'ยอด VAT ไม่ตรงกับอัตราที่ระบุไว้ — ตรวจทานอีกครั้ง' });
    } else if (rates.every((rate) => Math.abs(Number(rate) - 0.07) <= 0.0002)) {
      checks.push({ key: 'vat_check', status: 'pass', label: 'ยอด VAT ตรงกับยอดที่ใช้คำนวณและอัตรา 7%' });
    } else {
      checks.push({
        key: 'vat_check',
        status: 'info',
        label: `VAT คำนวณตามอัตราที่ระบุ (${effectiveVatRateLabel(detail.lines)}) ไม่ใช่ 7% มาตรฐาน`,
      });
    }
  }

  const taxAnswer = TAX_EVIDENCE_STATUS_LABELS[detail.taxEvidenceStatus];
  const taxReason = detail.taxEvidenceReasonCode ? TAX_EVIDENCE_REASON_LABELS[detail.taxEvidenceReasonCode] : undefined;
  if (!noReceipt) checks.push({
    key: 'tax_evidence',
    status: detail.taxEvidenceStatus === 'USABLE_FOR_TAX' ? 'pass' : taxAnswer && detail.taxEvidenceStatus !== 'NEEDS_REVIEW' ? 'info' : 'warn',
    label: `หลักฐานรายจ่าย: ${taxAnswer ?? 'รอตรวจ'}`,
    ...(taxReason ? { detail: taxReason } : {}),
  });

  if (hasUnresolvedDuplicateWarning(detail.duplicateStatus)) {
    checks.push({ key: 'duplicate', status: 'warn', label: detail.duplicateStatus === 'CONFIRMED_DUPLICATE'
      ? 'ยืนยันแล้วว่าเป็นรายการซ้ำ ไม่สามารถยืนยันค่าใช้จ่ายซ้ำได้'
      : 'อาจเป็นรายการซ้ำ ต้องตรวจสอบก่อนยืนยัน' });
  }

  return checks;
}

// ── guided review stepper for the detail popup — step state derived from server truth only ──
export type ExpenseReviewStepKey = 'data' | 'evidence' | 'review';
export type ExpenseReviewStepState = 'done' | 'attention' | 'pending';
export type ExpenseReviewStep = { key: ExpenseReviewStepKey; state: ExpenseReviewStepState };

/** ACTIVE primary-slot receipt — the attachment that satisfies the server confirm rule (repo falls back to this purpose when `primaryAttachmentId` is unset). */
export function expenseHasPrimaryReceipt(attachments: ReadonlyArray<{ purpose?: string; status?: string }>): boolean {
  return attachments.some((attachment) => attachment.purpose === 'expense.receipt.primary' && attachment.status === 'ACTIVE');
}

/** The no-invoice state: neither branch of the server receipt-or-reason confirm rule can pass yet — route the user to attach a receipt or into the substitute-receipt flow. */
export function expenseNeedsReceiptOrSubstitute(detail: Pick<ExpenseDetail, 'missingReceiptReason' | 'substituteReceiptGeneratedAt' | 'sourceDocumentType'> & {
  attachments: ReadonlyArray<{ purpose?: string; status?: string }>;
  substituteReceiptEvidence: Pick<SubstituteReceiptEvidenceSummary, 'status'> | null;
}): boolean {
  if (hasCurrentExpenseEvidenceReview(detail as ExpenseDetail)) return false;
  const substitutePathStarted = Boolean(detail.missingReceiptReason || detail.substituteReceiptGeneratedAt
    || detail.sourceDocumentType === 'SUBSTITUTE_RECEIPT' || detail.substituteReceiptEvidence);
  return !substitutePathStarted && !expenseHasPrimaryReceipt(detail.attachments);
}

/** Which step owns the input that clears each AI "missing" flag — a flag must be raised on the step
 *  that can actually clear it, or the user sees ⚠ with no field to fill. The model emits arbitrary
 *  keys (`buyerName`, `description`, `categorySuggestion`, …); only keys the review form can supply
 *  — the ones the server's review-save clear map recognises — may gate the stepper, so unknown keys
 *  are ignored instead of dead-ending ส่งให้ตรวจ behind a field that does not exist. */
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

export function expenseSourceDraftViewState(
  detail: Pick<ExpenseDetail, 'status' | 'sourceDraft'> & { lines: ReadonlyArray<unknown> },
  canMutateDraft: boolean,
): {
  sourceDraft: ExpenseSourceDraft | null;
  incomplete: boolean;
  sourceOnly: boolean;
  financialTotalUnknown: boolean;
} {
  const draft = detail.sourceDraft ?? null;
  const sourceDraft = detail.status === 'DRAFT' || detail.status === 'NEEDS_REVIEW'
    || (detail.status === 'READY_FOR_CONFIRMATION' && Boolean(draft?.missingFields.length))
    ? draft
    : null;
  const incomplete = Boolean(sourceDraft?.missingFields.length);
  return {
    sourceDraft,
    incomplete,
    sourceOnly: Boolean(sourceDraft && !canMutateDraft && (sourceDraft.canEdit || detail.status === 'READY_FOR_CONFIRMATION')),
    financialTotalUnknown: incomplete && detail.lines.length === 0,
  };
}

export function deriveExpenseReviewSteps(
  detail: Pick<ExpenseDetail, 'aiVerificationSummaryJson' | 'vendorNameSnapshot' | 'expenseDate' | 'taxEvidenceStatus'
    | 'missingReceiptReason' | 'substituteReceiptGeneratedAt' | 'sourceDocumentType' | 'duplicateStatus' | 'sourceDraft'> & Partial<Pick<ExpenseDetail, 'status' | 'expenseCategoryId' | 'primaryAttachmentId' | 'extractionId'>> & {
    attachments: ReadonlyArray<{ purpose?: string; status?: string }>;
    lines: ReadonlyArray<unknown>;
    substituteReceiptEvidence: Pick<SubstituteReceiptEvidenceSummary, 'status' | 'artifactAttachmentId'> | null;
  },
  canReview: boolean,
): ExpenseReviewStep[] {
  const classificationBlocked = deriveExpenseClassificationReviewState(detail.aiVerificationSummaryJson, canReview).blocked;
  const evidenceError = hasCurrentExpenseEvidenceReview(detail as ExpenseDetail) || detail.substituteReceiptEvidence
    ? expenseEvidenceConfirmationError(detail as ExpenseDetail) : null;
  const needsReceiptOrSubstitute = expenseNeedsReceiptOrSubstitute(detail);
  const aiMissingEvidence = expenseAiMissingFields(detail.aiVerificationSummaryJson, 'evidence');
  // Real field values decide this step, not the AI flags: a value the user (or upload) supplied is
  // present whether or not OCR read it, and the blue "AI อ่านได้ไม่ครบ" banner already names the
  // fields worth a second look. Gating the tick on the flags left a filled-in step showing ⚠.
  // §5.2 again: an upload-day placeholder passes `Boolean(expenseDate)` and ticked step 1 as done.
  const dateReadable = expenseDateIsReadable(detail.aiVerificationSummaryJson);
  const sourceDraftComplete = !detail.sourceDraft || detail.sourceDraft.missingFields.length === 0;
  const dataDone = (detail.vendorNameSnapshot ?? '').trim() !== '' && Boolean(detail.expenseDate) && dateReadable && detail.lines.length > 0 && sourceDraftComplete;
  const reviewPending = ['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status ?? 'NEEDS_REVIEW')
    && detail.substituteReceiptEvidence?.status !== 'ISSUED' && !hasCurrentExpenseDocumentReview(detail as ExpenseDetail);
  const evidenceState: ExpenseReviewStepState = !reviewPending && detail.taxEvidenceStatus !== 'NEEDS_REVIEW' && !classificationBlocked && !evidenceError && !needsReceiptOrSubstitute && aiMissingEvidence.length === 0
    ? 'done'
    : classificationBlocked || (!reviewPending && Boolean(evidenceError)) || needsReceiptOrSubstitute ? 'attention' : 'pending';
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

/** A waiting record opens at its first incomplete earlier step before a confirmer sees the summary. */
export function initialExpenseReviewStep(steps: ExpenseReviewStep[], status?: ExpenseStatus, canConfirm = false): ExpenseReviewStepKey {
  if (status !== 'READY_FOR_CONFIRMATION' || !canConfirm) return 'data';
  return steps.find(step => step.key !== 'review' && step.state !== 'done')?.key ?? 'review';
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
  canUsePersonalSignatures: boolean;
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
    canRequestOcr: has('expense.ocr.request') || has('expense.review') || has('expense.receipt.upload'),
    canReject: has('expense.reject'),
    canVoid: has('expense.void'),
    canRecordPayment: has('expense.payment.record'),
    canResolveDuplicates: has('expense.duplicate.resolve'),
    canManageCategories: has('expense.category.manage'),
    canUsePersonalSignatures: has('expense.signature.self_manage') || has('expense.review') || has('expense.confirm') || has('expense.signature.manage'),
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

const FREE_EXPENSE_DRAFT_UI_PERMISSIONS = new Set([
  'expense.read', 'expense.read_own', 'expense.read_related', 'expense.update',
  'expense.receipt.upload', 'expense.receipt.line_upload', 'expense.ocr.request',
  'attachment.read', 'attachment.create',
]);

/** Client-side defense in depth; the server remains the authority for free-mode permissions. */
export function expenseUiPermissions(permissions: readonly string[], freeExpenseDrafts = false): string[] {
  return freeExpenseDrafts ? permissions.filter((permission) => FREE_EXPENSE_DRAFT_UI_PERMISSIONS.has(permission)) : [...permissions];
}

export function canExportExpenseList(freeExpenseDrafts: boolean, caps: ExpenseCapabilities): boolean {
  return !freeExpenseDrafts && caps.canExportPackage;
}

export function isFreeExpenseListDraft(status: ExpenseStatus): boolean {
  return status === 'DRAFT' || status === 'NEEDS_REVIEW';
}

/**
 * A record the system built for a line of a reimbursement claim. It ends with its claim: cancelling the
 * claim voids it. The API refuses to void, reject or delete it from the expense screen
 * (`expense_belongs_to_reimbursement`), so the screen offers none of the three and says where to go.
 */
export function isClaimExpenseRecord(expense: { sourceReimbursementRequestId?: string | null }): boolean {
  return Boolean(expense.sourceReimbursementRequestId);
}
export const CLAIM_EXPENSE_RECORD_NOTE = 'รายการนี้เป็นรายการค่าใช้จ่ายของใบเบิก จึงยกเลิก ปฏิเสธ หรือลบจากหน้านี้ไม่ได้ ถ้าต้องการยกเลิก ให้ยกเลิกที่ใบเบิกในเมนูการเบิกจ่าย ระบบจะยกเลิกรายการนี้ให้เอง';
/** That note, until the record is voided: its claim's cancellation leaves it so, and nothing is left to cancel. */
export function claimExpenseRecordNote(expense: { status?: string; sourceReimbursementRequestId?: string | null }): string | null {
  return isClaimExpenseRecord(expense) && expense.status !== 'VOIDED' ? CLAIM_EXPENSE_RECORD_NOTE : null;
}

export type ReceiptDraftMissingFields = { vendor: boolean; date: boolean; amount: boolean };

export function receiptDraftMissingFields(detail: ExpenseDetail, userId: string, caps: Pick<ExpenseCapabilities, 'canUpdate'>): ReceiptDraftMissingFields | null {
  if (!caps.canUpdate || detail.createdByUserId !== userId || !['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status)) return null;
  const fields = {
    vendor: !(detail.vendorNameSnapshot ?? '').trim(),
    date: !detail.expenseDate || !expenseDateIsReadable(detail.aiVerificationSummaryJson),
    amount: detail.lines.length === 0,
  };
  return Object.values(fields).some(Boolean) ? fields : null;
}

export function receiptDraftFillPayload(detail: ExpenseDetail, missing: ReceiptDraftMissingFields, values: { vendor: string; date: string; amount: string }): UpdateExpenseDraftInput {
  return {
    ...(missing.vendor && values.vendor.trim() && { vendorNameSnapshot: values.vendor.trim() }),
    ...(missing.date && values.date && { expenseDate: values.date }),
    ...(missing.amount && values.amount.trim() && { lines: [{
      lineNumber: 1, description: 'ค่าใช้จ่ายตามใบเสร็จ', chargeKind: null, quantity: '1',
      unitPrice: values.amount.trim(), discountAmount: '0',
    }] }),
  };
}

export function canDeleteExpense(
  expense: Pick<ExpenseSummary, 'status' | 'grandTotalAmount' | 'paymentStatus' | 'createdByUserId' | 'hasRetainedSubstituteReceiptEvidence' | 'hasDeletionBlockingHistory'> & { sourceReimbursementRequestId?: string | null; payments?: readonly unknown[] },
  userId: string,
  caps: Pick<ExpenseCapabilities, 'canDelete' | 'canUpdate'>,
): boolean {
  return !expense.hasDeletionBlockingHistory && !expense.payments?.length && !expense.hasRetainedSubstituteReceiptEvidence && !isClaimExpenseRecord(expense) && isExpenseDeletableState(expense)
    && (caps.canDelete || (caps.canUpdate && expense.createdByUserId === userId));
}

export function canCancelExpenseInsteadOfDelete(expense: ExpenseSummary, caps: Pick<ExpenseCapabilities, 'canReject' | 'canVoid'>): boolean {
  return Boolean(expense.hasDeletionBlockingHistory) && !isClaimExpenseRecord(expense)
    && ((caps.canVoid && canVoidExpenseFinancialState(expense))
      || (caps.canReject && ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status)));
}

/** One list badge names the next action; payment details stay on the expense. */
export function expenseListStatus(row: Pick<ExpenseSummary, 'status' | 'paymentStatus'> & Partial<Pick<ExpenseSummary, 'paidAmount' | 'netPayableAmount' | 'reimbursementProgress'>>): { label: string; tone: 'slate' | 'amber' | 'brand' | 'rose' } {
  if (row.status === 'VOIDED') return { label: 'ยกเลิก', tone: 'slate' };
  if (row.status === 'REJECTED') return { label: 'ปฏิเสธ', tone: 'rose' };
  if (row.reimbursementProgress) return { label: expenseReimbursementProgressLabel(row.reimbursementProgress), tone: 'brand' };
  if (expenseOverpaidAmount(row)) return { label: 'จ่ายเกินยอดสุทธิ', tone: 'rose' };
  if (row.status !== 'CONFIRMED') return { label: 'รอตรวจ', tone: 'amber' };
  if (row.paymentStatus === 'PAID') return { label: 'จ่ายแล้ว', tone: 'brand' };
  return { label: row.paymentStatus === 'PARTIALLY_PAID' ? 'จ่ายบางส่วน' : 'รอจ่าย', tone: 'amber' };
}

export function expenseListMonth(day: string | null, fallback: string): string {
  return isCivilDate(day) ? day.slice(0, 7) : fallback;
}

export type ExpenseKpis = {
  counted: number; total: number; outstanding: number; overdue: number;
  overdueCount: number; vat: number; pending: number;
};

/** `today` is passed in rather than read here so the overdue boundary stays testable. */
export function summarizeExpenseKpis(
  rows: ReadonlyArray<Pick<ExpenseSummary, 'status' | 'grandTotalAmount' | 'vatAmount' | 'outstandingAmount' | 'paymentStatus' | 'dueDate'> & Partial<Pick<ExpenseSummary, 'id' | 'costSourceExpenseId' | 'reimbursementProgress'>>>,
  today: string,
): ExpenseKpis {
  const kpi: ExpenseKpis = { counted: 0, total: 0, outstanding: 0, overdue: 0, overdueCount: 0, vat: 0, pending: 0 };
  const countedSources = new Set<string>();
  // Prefer the final accounting projection when both documents are in the current filter.
  for (const row of [...rows].sort((a, b) => Number(b.status === 'CONFIRMED') - Number(a.status === 'CONFIRMED'))) {
    // Captured totals include unconfirmed documents. VAT is observed, not a claimable tax total.
    if (isExpenseCancelled(row.status)) continue;
    const costId = row.costSourceExpenseId ?? row.id;
    if (!costId || !countedSources.has(costId)) {
      kpi.counted += 1;
      kpi.total += Number(row.grandTotalAmount || 0);
      kpi.vat += Number(row.vatAmount || 0);
      if (costId) countedSources.add(costId);
    }
    if (isExpensePendingReview(row)) kpi.pending += 1;
    if (row.status !== 'CONFIRMED' || row.paymentStatus === 'PAID') continue;
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
  PAYMENT: { th: 'ข้อมูลการจ่ายเงิน', en: 'recorded payment' },
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

export function expenseDeleteErrorMessage(error: unknown, locale: SupportedLocale, status?: ExpenseDetail['status']): string {
  const candidate = error as {
    code?: unknown;
    details?: { code?: unknown; blocker?: unknown };
  } | null | undefined;
  const code = candidate?.code ?? candidate?.details?.code;
  const blocker = candidate?.details?.blocker;
  if (code === 'EXPENSE_HAS_LINKED_DATA' && blocker === 'PAYMENT') return locale === 'th'
    ? status === 'REJECTED' || status === 'VOIDED'
      ? 'รายจ่ายนี้ยกเลิกแล้ว ต้องเก็บประวัติการจ่ายไว้ เลือกรายการอื่นได้'
      : 'ลบรายจ่ายนี้ไม่ได้ เพราะเคยบันทึกการจ่ายไว้ ใช้ยกเลิกรายการแทน'
    : 'This expense has payment history. Cancel the expense instead, or choose another expense if already cancelled.';
  if (code === 'EXPENSE_HAS_LINKED_DATA' && blocker === 'DISBURSEMENT_VOUCHER') return locale === 'th'
    ? 'ลบรายจ่ายนี้ไม่ได้ เพราะเคยอยู่ในใบเตรียมจ่าย เปิดรายจ่ายเพื่อตรวจใบที่เกี่ยวข้อง'
    : 'This expense has voucher history. Open the expense to review its linked documents.';
  if (code === 'EXPENSE_HAS_LINKED_DATA' && blocker === 'HISTORY') return locale === 'th'
    ? status === 'REJECTED' || status === 'VOIDED'
      ? 'รายจ่ายนี้ยกเลิกแล้ว ต้องเก็บประวัติไว้ เลือกรายการอื่นได้'
      : 'ลบรายจ่ายนี้ไม่ได้ เพราะมีประวัติที่ต้องเก็บไว้ ใช้ยกเลิกรายการแทน'
    : 'This expense has retained history. Cancel the expense instead, or choose another expense if already cancelled.';
  if (code === 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED' && (status === 'REJECTED' || status === 'VOIDED')) return locale === 'th'
    ? 'รายจ่ายนี้ยกเลิกแล้ว ต้องเก็บหลักฐานใบรับรองแทนใบเสร็จไว้ เลือกรายการอื่นได้'
    : 'This expense is already cancelled and its substitute-receipt evidence must be kept. Choose another expense.';
  if (code === 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED') return locale === 'th'
    ? 'ลบรายจ่ายนี้ไม่ได้ เพราะเคยออกใบรับรองแทนใบเสร็จไว้ ใช้ยกเลิกรายการแทน'
    : 'This expense has retained substitute-receipt evidence. Cancel the expense instead.';
  if (code === 'EXPENSE_HAS_LINKED_DATA' && typeof blocker === 'string') {
    const label = EXPENSE_DELETE_BLOCKER_LABELS[blocker]?.[locale];
    if (!label) {
      return locale === 'th'
        ? 'ลบรายการนี้ไม่ได้ เนื่องจากมีข้อมูลอื่นเชื่อมโยงอยู่ ตรวจสอบรายการที่เกี่ยวข้อง'
        : 'This expense cannot be deleted because it has linked data. Review the related records.';
    }
    return locale === 'th'
      ? `ลบรายการนี้ไม่ได้ เนื่องจากมีข้อมูลเชื่อมโยง: ${label}`
      : `This expense cannot be deleted because it has linked data: ${label}.`;
  }
  if (code === 'EXPENSE_CHANGED_DURING_DELETE') {
    return locale === 'th'
      ? apiErrorMessage({ code: 'EXPENSE_CHANGED_DURING_DELETE' })
      : 'The expense changed during deletion. Reload and try again.';
  }
  if (error instanceof Error) return apiErrorMessage(error);
  return locale === 'th' ? apiErrorMessage(error) : 'An error occurred.';
}

export type ExpensesTab = 'list' | 'upload' | 'manual' | 'categories' | 'signatures' | 'evidence';

export function canAccessExpenseTab(tab: ExpensesTab, caps: ExpenseCapabilities): boolean {
  const allowed: Record<ExpensesTab, boolean> = {
    list: caps.canViewList,
    upload: caps.canUploadReceipts,
    manual: caps.canCreate,
    categories: caps.canManageCategories,
    // "ลายเซ็นของฉัน" (owner decision 2026-08-20): a signature is personal, so the screen belongs
    // to whoever performs either signing act. Every accepted grant remains owner-only in the API.
    signatures: caps.canUsePersonalSignatures,
    evidence: caps.canViewSharedEvidence,
  };
  return allowed[tab];
}

/**
 * What a reviewer is offered when the VAT reconciliation blocks the save.
 *
 * Owner requirement 2026-08-28, from a real dead end: a blocked receipt must always tell the person
 * in front of it what to do next. The difference may only be carried by a line that bears VAT — it
 * must never land on ยกเว้น rows such as ผัก/ผลไม้/ค่าขนส่ง/แสตมป์ — and when the document has no such
 * line the override form correctly cannot be shown. That used to render nothing at all: a refusal on
 * screen, no control, no explanation. This returns the way out for every case, so "nothing" is not
 * one of the answers the UI can reach.
 */
export type ExpenseVatBlockedWayOut = 'OVERRIDE_FORM' | 'SET_VAT_RATE_FIRST' | 'NEEDS_CONFIRMER';

export function expenseVatBlockedWayOut(
  input: { canConfirm: boolean; vatCarrierLineCount: number },
): ExpenseVatBlockedWayOut {
  if (!input.canConfirm) return 'NEEDS_CONFIRMER';
  return input.vatCarrierLineCount > 0 ? 'OVERRIDE_FORM' : 'SET_VAT_RATE_FIRST';
}

/**
 * Why "ยืนยันเอกสาร" is refused, as a dictionary key — or null when it is not.
 *
 * Owner requirement 2026-08-28: the reason already existed, but only as the disabled button's
 * `title`, which is a hover tooltip. Expenses are reviewed on a phone, where nothing hovers, so in
 * practice the button was simply dead with no explanation anywhere near it. The same chain now
 * lives in one place, is rendered as text, and is ordered so the reader is told the thing they must
 * fix FIRST rather than whichever check happened to run first.
 */
export type ExpenseConfirmBlocker =
  | 'expenses.confirm_needs_receipt'
  | 'expenses.duplicate_action_required'
  | 'expenses.duplicate_confirmed_block'
  | 'expenses.price_mismatch_blocks_confirm'
  | 'expenses.zero_amount_warning'
  | 'expenses.confirm_needs_ready_status'
  | 'expenses.confirm_needs_document_review';

export function expenseConfirmBlocker(input: {
  status: string;
  classificationBlocked: boolean;
  hasDuplicates: boolean;
  isConfirmedDuplicate?: boolean;
  needsReceiptOrSubstitute: boolean;
  evidenceError: string | null;
  ocrTotalUnacknowledged: boolean;
  isZeroAmount: boolean;
  classificationBlockMessage?: string | null;
}): { key: ExpenseConfirmBlocker; literal?: undefined } | { key?: undefined; literal: string } | null {
  if (input.classificationBlocked) {
    return input.classificationBlockMessage ? { literal: input.classificationBlockMessage } : { key: 'expenses.confirm_needs_receipt' };
  }
  if (input.hasDuplicates && input.isConfirmedDuplicate) return { key: 'expenses.duplicate_confirmed_block' };
  // Attaching the receipt is the one a person can act on immediately, so it is named before the
  // states that need someone else (a signature, a second reviewer).
  if (input.needsReceiptOrSubstitute) return { key: 'expenses.confirm_needs_receipt' };
  if (input.evidenceError) return { key: 'expenses.confirm_needs_document_review' };
  if (input.hasDuplicates) return { key: 'expenses.duplicate_action_required' };
  if (input.ocrTotalUnacknowledged) return { key: 'expenses.price_mismatch_blocks_confirm' };
  if (input.isZeroAmount) return { key: 'expenses.zero_amount_warning' };
  if (input.status !== 'READY_FOR_CONFIRMATION') return { key: 'expenses.confirm_needs_ready_status' };
  return null;
}

/**
 * Why "ถัดไป" on step 1 (ข้อมูลรายการ) is refused, as the sentence printed under it — or null when
 * the user may go on. Same contract as `expenseEvidenceStepBlocker` below: one value drives the
 * button's `disabled`, the text under it and its title, so a disabled ถัดไป always says why.
 *
 * Owner report 2026-09-20: the button read the error COUNT while the text read the MESSAGE, and the
 * count is reported up from the data section's effect, one commit behind the edit. `null` — "the
 * section has not reported yet" — counted as an error, so the primary action greyed out with
 * nothing to read; and between an edit and its report the printed reason still named a line the
 * reviewer had just filled. Unknown is not a blocker, and the count alone never disables.
 */
export function expenseDataStepBlocker(input: {
  errorCount: number | null;
  firstErrorMessage: string | null;
  countMessage: string;
}): string | null {
  if (input.errorCount === null || input.errorCount <= 0) return null;
  return input.firstErrorMessage ?? input.countMessage;
}

/**
 * Why "ถัดไป" on step 2 (ภาษีและเอกสาร) is refused, as a dictionary key — or null when the user may go on.
 *
 * Owner report 2026-08-29 (UAT, company "test sand"): the button's `disabled` read one flag
 * (`checkBillBlocked`) while `goToStep` refused the move on another the button never saw
 * (`evidenceDirtyRef`), and the AI classification block — the thing the yellow banner and
 * ส่งให้ตรวจ both name — gated neither. So ถัดไป could be pressed and simply not move.
 * The button's enabled state, the reason printed under it, and the navigation guard all read
 * this one function now, so an enabled ถัดไป always moves and a disabled one always says why.
 *
 * Order is the order the user must act in: resolve what the AI flagged, then save what was typed.
 */
export type ExpenseEvidenceStepBlocker =
  | 'expenses.check_bill_workflow_blocked'
  | 'expenses.evidence_next_needs_classification'
  | 'expenses.evidence_next_waiting_finance';

export function expenseEvidenceStepBlocker(input: {
  checkBillBlocked: boolean;
  classificationBlocked: boolean;
  canReview: boolean;
  unsavedReview: boolean;
  reviewRequired?: boolean;
}): ExpenseEvidenceStepBlocker | null {
  if (input.checkBillBlocked) return 'expenses.check_bill_workflow_blocked';
  if (input.classificationBlocked) {
    return input.canReview ? 'expenses.evidence_next_needs_classification' : 'expenses.evidence_next_waiting_finance';
  }
  return null;
}

/**
 * Whether replacing the primary receipt re-runs the AI read that first upload runs.
 *
 * Owner report 2026-08-29 (UAT): เปลี่ยนไฟล์ใบเสร็จ swapped the file and left the draft holding the
 * OLD file's numbers, because only the upload page ever called the extraction endpoint. Re-reading
 * overwrites vendor name/tax id/document number/date from the new file, which is the point on a
 * draft and unacceptable once the record is with an approver — so it stops at the draft statuses.
 */
export function shouldRereadReplacedReceipt(input: { status: string; canExtract: boolean }): boolean {
  return input.canExtract && (input.status === 'DRAFT' || input.status === 'NEEDS_REVIEW');
}

/**
 * Why "ยืนยันว่าเป็นหลักฐานค่าใช้จ่าย" is refused — the same chain that used to live inline as a
 * boolean, so the disabled button can print the missing piece instead of sitting dead. The reason
 * box is far above the button on a phone, which is exactly how the Owner reached a button that
 * looked pressable and did nothing.
 */
export type ExpenseClassificationConfirmBlocker =
  | 'expenses.non_expense_confirm_needs_doc_type'
  | 'expenses.non_expense_confirm_needs_reason';

export function expenseClassificationConfirmBlocker(input: {
  sourceDocumentType: string;
  reason: string;
}): ExpenseClassificationConfirmBlocker | null {
  if (input.sourceDocumentType === 'NEEDS_REVIEW') return 'expenses.non_expense_confirm_needs_doc_type';
  const reason = input.reason.trim();
  // The 500 ceiling matches the textarea's maxLength and the server's limit; a paste past it lands
  // on the same line as an empty box — write a reason that fits.
  if (reason.length === 0 || reason.length > 500) return 'expenses.non_expense_confirm_needs_reason';
  return null;
}

/**
 * Correction & replacement plan §5.2/§5.3: same two predicates `accounts-payable.model.ts` defines
 * for the AP side (`canCorrectWhtCertificate`/`canIssueWhtReplacementCopy`) — a thin per-module copy
 * rather than a shared cross-feature import, matching this repo's established convention for the
 * WHT handoff API client functions (see the comment in expenses.api.ts).
 */
export function canCorrectWhtCertificate(
  handoff: { status: string; certificateId?: string | null; systemCorrectionOpen?: boolean },
  permissions: readonly string[],
): boolean {
  return handoff.status === 'SYSTEM_ISSUED' && Boolean(handoff.certificateId) && Boolean(handoff.systemCorrectionOpen)
    && permissions.includes('wht.certificate.correct');
}

export function canIssueWhtReplacementCopy(
  handoff: { status: string; certificateId?: string | null; systemReplacementOpen?: boolean },
  permissions: readonly string[],
): boolean {
  return handoff.status === 'SYSTEM_ISSUED' && Boolean(handoff.certificateId) && Boolean(handoff.systemReplacementOpen)
    && permissions.includes('wht.certificate.correct');
}


export { expenseConfirmedLockMessage } from '@watchdog-bms/contracts';

export function expensePaymentFormState(outstanding: string, amount: string, paidAt: string, retrying = false, today = todayCivilDate('Asia/Bangkok'), hasRecordedPayments = false) {
  const balance = Number(outstanding);
  const prefill = Number.isFinite(balance) && balance > 0 ? balance.toFixed(2) : '';
  const value = Number(amount);
  const disabledReason = paidAt > today && isCivilDate(paidAt) ? EXPENSE_CORRECTION_WORDS.futurePaymentDate : retrying ? null : !INCOME_POSITIVE_MONEY_PATTERN.test(normalizeExpensePaymentAmount(amount.trim()))
    ? 'กรอกยอดจ่ายมากกว่า 0 และทศนิยมไม่เกิน 2 ตำแหน่ง'
    : value > Number(prefill) ? 'ยอดจ่ายเกินยอดค้างจ่าย ตรวจยอดอีกครั้ง'
    : !isCivilDate(paidAt) ? 'เลือกวันที่จ่ายเงินจริงให้ถูกต้อง' : null;
  const formatted = `${(Number.isFinite(value) ? value : 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
  return { prefill, disabledReason, maxPaidAt: today, label: hasRecordedPayments && value > 0 && value === Number(prefill) ? `บันทึกจ่ายส่วนที่เหลือ ${formatted}` : `บันทึกจ่าย ${formatted}` };
}

export function canIssueExpenseWhtCertificate(expense: Pick<ExpenseDetail, 'status' | 'whtAmount'>,
  handoff: import('@watchdog-bms/contracts').WhtCertificateHandoffDto | null, permissions: string[]): boolean {
  return expense.status === 'CONFIRMED' && Number(expense.whtAmount) > 0 && handoff?.status === 'REQUIRED'
    && handoff.systemIssuanceOpen && permissions.includes('wht.certificate.issue');
}

export function expenseWhtCategoriesForPayee<T extends { formType: string }>(categories: T[], payeeType: BuyerEntityKind | '' | undefined): T[] {
  const formType = payeeType === 'INDIVIDUAL' ? 'PND3' : payeeType === 'JURISTIC' ? 'PND53' : null;
  return categories.filter((category) => category.formType === formType || payeeType === 'INDIVIDUAL' && category.formType === 'PND2');
}

export function changeExpensePayeeType(values: ExpenseDraftReviewValues, payeeType: BuyerEntityKind | '', categories: Array<{ code: string; formType: string }>): ExpenseDraftReviewValues {
  return { ...values, vendorEntityKindSnapshot: payeeType,
    whtCategoryCode: expenseWhtCategoriesForPayee(categories, payeeType).some((category) => category.code === values.whtCategoryCode) ? values.whtCategoryCode : '' };
}

export function expenseWhtCategoryOptions<T extends { nameTh: string; defaultRate: string }>(categories: readonly T[]): Array<T & { label: string }> {
  const common = ['บริการ', 'เช่า', 'ขนส่ง', 'โฆษณา'];
  const order = (name: string) => {
    const index = common.findIndex(word => name.includes(word));
    return index >= 0 ? index : name.includes('อื่น') ? common.length + 1 : common.length;
  };
  return [...categories].sort((a, b) => order(a.nameTh) - order(b.nameTh))
    .map(item => ({ ...item, label: `${item.nameTh} · หัก ${Number(item.defaultRate)}%` }));
}
