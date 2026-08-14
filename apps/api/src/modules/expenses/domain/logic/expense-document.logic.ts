import type {
  BusinessDocumentClassification, SourceDocumentType, TaxEvidenceStatus, TaxEvidenceReasonCode,
} from '@watchdog-bms/contracts';

const SOURCE_DOCUMENT_TYPES: SourceDocumentType[] = [
  'RECEIPT', 'TAX_INVOICE', 'ABBREVIATED_TAX_INVOICE', 'TRANSFER_SLIP', 'HANDWRITTEN_CASH_BILL', 'SUPPLIER_BILL',
  'MARKETPLACE_ORDER_SCREENSHOT', 'EXPENSE_NOTE_TEXT', 'SUBSTITUTE_RECEIPT', 'OTHER_EXPENSE_DOCUMENT', 'NEEDS_REVIEW',
];

export function toSourceDocumentType(value: string | undefined | null): SourceDocumentType {
  return SOURCE_DOCUMENT_TYPES.includes(value as SourceDocumentType) ? (value as SourceDocumentType) : 'NEEDS_REVIEW';
}

export type TaxEvidenceInput = {
  sourceDocumentType: SourceDocumentType;
  grandTotalAmount?: string | null;
  vendorTaxId?: string | null;
  vendorName?: string | null;
  documentNumber?: string | null;
  lowConfidence?: boolean;
};

export type TaxEvidenceResult = {
  taxEvidenceStatus: TaxEvidenceStatus;
  taxEvidenceReasonCode: TaxEvidenceReasonCode;
};

/**
 * Deterministic tax-evidence guard. AI suggests the document type; this maps
 * the reviewed/suggested type + visible fields to a reviewable status/reason.
 * Finance/accountant can override with MANUAL_OVERRIDE during review.
 */
export function deriveTaxEvidence(input: TaxEvidenceInput): TaxEvidenceResult {
  if (input.lowConfidence) {
    return { taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'UNREADABLE_OR_LOW_CONFIDENCE' };
  }
  switch (input.sourceDocumentType) {
    case 'TAX_INVOICE':
      if (!toPositiveNumber(input.grandTotalAmount ?? undefined)) return { taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'MISSING_MONETARY_AMOUNT' };
      if (!input.vendorTaxId) return { taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'MISSING_VENDOR_TAX_ID' };
      if (!input.documentNumber) return { taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'MISSING_DOCUMENT_NUMBER' };
      return { taxEvidenceStatus: 'USABLE_FOR_TAX', taxEvidenceReasonCode: 'VALID_TAX_INVOICE_FIELDS' };
    // Spec §19h: ใบกำกับภาษีอย่างย่อ (s.86/6) is complete, valid expense evidence — nothing is
    // missing from it — but s.82/5 bars its input VAT from credit, so it can never be
    // USABLE_FOR_TAX no matter how many fields it carries. Upgrading requires the seller to issue
    // a full-form invoice, which is a different document and therefore a different type.
    case 'ABBREVIATED_TAX_INVOICE':
      if (!toPositiveNumber(input.grandTotalAmount ?? undefined)) return { taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'MISSING_MONETARY_AMOUNT' };
      return { taxEvidenceStatus: 'SUPPORTING_ONLY', taxEvidenceReasonCode: 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE' };
    case 'RECEIPT':
    case 'SUPPLIER_BILL':
      if (!toPositiveNumber(input.grandTotalAmount ?? undefined)) return { taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'MISSING_MONETARY_AMOUNT' };
      if (!input.vendorName) return { taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'UNREADABLE_OR_LOW_CONFIDENCE' };
      if (!input.documentNumber) return { taxEvidenceStatus: 'SUPPORTING_ONLY', taxEvidenceReasonCode: 'MISSING_DOCUMENT_NUMBER' };
      return { taxEvidenceStatus: 'USABLE_FOR_TAX', taxEvidenceReasonCode: 'VALID_RECEIPT_FIELDS' };
    case 'TRANSFER_SLIP':
      return { taxEvidenceStatus: 'SUPPORTING_ONLY', taxEvidenceReasonCode: 'PAYMENT_EVIDENCE_ONLY' };
    case 'MARKETPLACE_ORDER_SCREENSHOT':
      // Valid tax-invoice fields inside a screenshot upgrade it during review, not at intake.
      return { taxEvidenceStatus: 'SUPPORTING_ONLY', taxEvidenceReasonCode: 'MARKETPLACE_SCREENSHOT_ONLY' };
    case 'HANDWRITTEN_CASH_BILL':
    case 'EXPENSE_NOTE_TEXT':
      return { taxEvidenceStatus: 'SUPPORTING_ONLY', taxEvidenceReasonCode: 'HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE' };
    case 'SUBSTITUTE_RECEIPT':
      return { taxEvidenceStatus: 'SUPPORTING_ONLY', taxEvidenceReasonCode: 'HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE' };
    case 'OTHER_EXPENSE_DOCUMENT':
      return { taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'UNREADABLE_OR_LOW_CONFIDENCE' };
    case 'NEEDS_REVIEW':
    default:
      return { taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'UNREADABLE_OR_LOW_CONFIDENCE' };
  }
}

export type CaptureHintsInput = {
  sourceDocumentType?: string;
  sourceDocumentLanguage?: string;
  vendorName?: string;
  description?: string;
  expenseDate?: string;
  amount?: string;
  vatMode?: string;
  expenseCategoryId?: string;
  confidence?: number;
};

export type ValidatedCaptureHints = {
  sourceDocumentType: SourceDocumentType;
  sourceDocumentLanguage: string | null;
  vendorName: string | null;
  description: string | null;
  expenseDate: string | null;
  amount: string | null;
  vatMode: 'NO_VAT' | 'VAT_INCLUDED' | 'VAT_EXCLUDED' | 'EXEMPT' | 'NEEDS_REVIEW';
  expenseCategoryId: string | null;
  warnings: string[];
};

const VAT_MODES = ['NO_VAT', 'VAT_INCLUDED', 'VAT_EXCLUDED', 'EXEMPT', 'NEEDS_REVIEW'];
const MAX_TEXT_HINT_LENGTH = 300;

function boundText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_TEXT_HINT_LENGTH ? trimmed.slice(0, MAX_TEXT_HINT_LENGTH) : trimmed;
}

/**
 * Deterministic insertion gate for AI semantic capture hints (LINE text notes
 * and route handoffs). Only values that pass these guards may be auto-keyed:
 * - amount must parse as a positive decimal
 * - expenseDate must be a real ISO date not in the far future
 * - expenseCategoryId must be one of the ACTIVE configured category ids
 * - sourceDocumentType/vatMode must be known enum members
 * Everything else stays null and is reported in warnings for NEEDS_REVIEW.
 */
export function validateCaptureHints(hints: CaptureHintsInput, activeCategoryIds: Set<string>): ValidatedCaptureHints {
  const warnings: string[] = [];

  let amount: string | null = null;
  if (hints.amount !== undefined && hints.amount !== null && `${hints.amount}`.trim() !== '') {
    const parsed = parseFloat(`${hints.amount}`.replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 1_000_000_000) {
      amount = parsed.toFixed(4);
    } else {
      warnings.push('invalid_amount');
    }
  }

  let expenseDate: string | null = null;
  if (hints.expenseDate) {
    const match = /^\d{4}-\d{2}-\d{2}$/.test(hints.expenseDate);
    const time = Date.parse(hints.expenseDate);
    // Reject unparseable dates and dates more than 1 day ahead (receipts are not future documents).
    if (match && Number.isFinite(time) && time < Date.now() + 24 * 60 * 60 * 1000) {
      expenseDate = hints.expenseDate;
    } else {
      warnings.push('invalid_expense_date');
    }
  }

  let expenseCategoryId: string | null = null;
  if (hints.expenseCategoryId) {
    if (activeCategoryIds.has(hints.expenseCategoryId)) {
      expenseCategoryId = hints.expenseCategoryId;
    } else {
      warnings.push('category_not_active');
    }
  }

  const vatMode = VAT_MODES.includes(hints.vatMode ?? '') ? (hints.vatMode as ValidatedCaptureHints['vatMode']) : 'NEEDS_REVIEW';
  const sourceDocumentType = toSourceDocumentType(hints.sourceDocumentType);
  if (hints.sourceDocumentType && sourceDocumentType === 'NEEDS_REVIEW' && hints.sourceDocumentType !== 'NEEDS_REVIEW') {
    warnings.push('unknown_source_document_type');
  }

  const language = hints.sourceDocumentLanguage?.trim();

  return {
    sourceDocumentType,
    sourceDocumentLanguage: language && language.length <= 20 ? language : null,
    vendorName: boundText(hints.vendorName),
    description: boundText(hints.description),
    expenseDate,
    amount,
    vatMode,
    expenseCategoryId,
    warnings,
  };
}

function toPositiveNumber(value: string | undefined): number | null {
  if (value === undefined || value === null || `${value}`.trim() === '') return null;
  const parsed = Number(`${value}`.replace(/,/g, '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeThaiDigits(value: string): string {
  return value.replace(/[๐-๙]/g, (digit) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)));
}

function amountSignalSupports(value: string | undefined, signals: string[] | undefined): boolean {
  const expected = toPositiveNumber(value);
  if (expected === null || !signals?.length) return false;
  return signals.some((signal) => [...normalizeThaiDigits(signal).matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .some((match) => Number(match[0].replace(/,/g, '')) === expected));
}

const EXPENSE_EXTRACTION_KINDS = new Set<BusinessDocumentClassification['documentKind']>([
  'RECEIPT',
  'TAX_INVOICE',
  // Non-creditable for input VAT, but still a real paid expense that must reach a draft (§19h).
  'ABBREVIATED_TAX_INVOICE',
  'SUPPLIER_INVOICE_OR_BILL',
  'TRANSFER_SLIP',
  'MARKETPLACE_ORDER',
  'HANDWRITTEN_CASH_BILL',
]);

/** AI classification kinds map onto review document types; unknown kinds fall back to NEEDS_REVIEW via toSourceDocumentType. */
export function sourceDocumentTypeFromClassification(classification: BusinessDocumentClassification | null): string | undefined {
  if (!classification) return undefined;
  if (classification.documentKind === 'SUPPLIER_INVOICE_OR_BILL') return 'SUPPLIER_BILL';
  if (classification.documentKind === 'MARKETPLACE_ORDER') return 'MARKETPLACE_ORDER_SCREENSHOT';
  return classification.documentKind;
}

/** Shared API-side final gate before OCR fields may mutate an expense draft. */
export function isExpenseExtractionEligible(
  classification: BusinessDocumentClassification | undefined,
  grandTotalAmount: string | undefined,
  explicitExpenseContext = false,
): boolean {
  const familyEligible = classification?.documentFamily === 'EXPENSE_EVIDENCE'
    || (classification?.documentKind === 'TRANSFER_SLIP' && classification.documentFamily === 'PAYMENT_EVIDENCE');
  const directionEligible = classification?.businessDirection === 'PURCHASE_EXPENSE'
    || (explicitExpenseContext && classification?.businessDirection === 'UNKNOWN');
  const receiptSettlementEligible = classification?.documentKind !== 'RECEIPT'
    || (classification.transactionState === 'PAID'
      && classification.settlementSignals.length > 0
      && !classification.missingRequiredSignals.includes('MISSING_PAYMENT_EVIDENCE'));
  return classification?.contentKind === 'DOCUMENT'
    && directionEligible
    && familyEligible
    && receiptSettlementEligible
    && !classification.requiresClarification
    && EXPENSE_EXTRACTION_KINDS.has(classification.documentKind)
    && amountSignalSupports(grandTotalAmount, classification.amountSignals);
}
