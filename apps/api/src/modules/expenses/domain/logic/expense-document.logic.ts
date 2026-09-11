import type {
  BusinessDocumentClassification, LineAiValueCandidates, LineIntakeClarificationField, SourceDocumentType,
  TaxEvidenceStatus, TaxEvidenceReasonCode,
} from '@watchdog-bms/contracts';
import { extractValueCandidates } from '@watchdog-bms/contracts';

const SOURCE_DOCUMENT_TYPES: SourceDocumentType[] = [
  'RECEIPT', 'TAX_INVOICE', 'ABBREVIATED_TAX_INVOICE', 'TRANSFER_SLIP', 'HANDWRITTEN_CASH_BILL', 'SUPPLIER_BILL',
  'MARKETPLACE_ORDER_SCREENSHOT', 'EXPENSE_NOTE_TEXT', 'SUBSTITUTE_RECEIPT', 'OTHER_EXPENSE_DOCUMENT', 'NEEDS_REVIEW',
];

export function toSourceDocumentType(value: string | undefined | null): SourceDocumentType {
  return SOURCE_DOCUMENT_TYPES.includes(value as SourceDocumentType) ? (value as SourceDocumentType) : 'NEEDS_REVIEW';
}

/**
 * A LINE text note has no file, so the capture stamps `missingReceiptReason` to keep the
 * evidence-gap rules (ledger auto-post, daily closing, status logic) reading "no file, reason
 * recorded". It is a MARKER, never the payer's answer: `isAutoMissingReceiptReason` is what stops it
 * satisfying the substitute-receipt question and what keeps it off the certificate, which prints
 * this field verbatim. Thai, because anything reachable by a customer must be.
 */
export const LINE_TEXT_NOTE_MISSING_RECEIPT_MARKER = 'บันทึกค่าใช้จ่ายจากข้อความใน LINE ยังไม่ได้แนบไฟล์หลักฐาน';
/** Rows captured before the marker was Thai still carry this exact sentence. */
const LEGACY_LINE_TEXT_NOTE_MISSING_RECEIPT_MARKER = 'LINE text-only expense note; evidence file not attached';

export function isAutoMissingReceiptReason(value: string | null | undefined): boolean {
  const text = value?.trim();
  return text === LINE_TEXT_NOTE_MISSING_RECEIPT_MARKER || text === LEGACY_LINE_TEXT_NOTE_MISSING_RECEIPT_MARKER;
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
      if (!toPositiveNumber(input.grandTotalAmount ?? undefined) || !input.vendorName) {
        return { taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'UNREADABLE_OR_LOW_CONFIDENCE' };
      }
      return { taxEvidenceStatus: 'SUPPORTING_ONLY', taxEvidenceReasonCode: 'HANDWRITTEN_RECEIPT_REVIEW' };
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
  businessPurpose?: string;
  confidence?: number;
};

export type ValidatedCaptureHints = {
  sourceDocumentType: SourceDocumentType;
  sourceDocumentLanguage: string | null;
  vendorName: string | null;
  description: string | null;
  businessPurpose: string | null;
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
    businessPurpose: boundText(hints.businessPurpose),
    expenseDate,
    amount,
    vatMode,
    expenseCategoryId,
    warnings,
  };
}

function comparableText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('th-TH').replace(/\s+/g, ' ').trim();
}

function samePositiveAmount(left: string, right: string): boolean {
  const a = toPositiveNumber(left);
  const b = toPositiveNumber(right);
  return a !== null && b !== null && a === b;
}

/**
 * The PRE-SEMANTIC eligibility rule, kept verbatim. This is what default-off means: the selected amount
 * must occur anywhere in message + resolved clarifications, and an ACTIVE CATEGORY NAME may stand in for
 * the business purpose. Both are behaviours §8.1 deliberately removes — but only for the one route the
 * server verified as BUSINESS_EXPENSE + COMPANY_PAID. Every other caller keeps this gate unchanged.
 */
export function isLineTextExpenseCaptureEligible(
  messageText: string,
  hints: CaptureHintsInput,
  activeCategories: ReadonlyMap<string, string>,
  groundingTexts: string[] = [],
): boolean {
  const sourceText = [messageText, ...groundingTexts].filter(Boolean).join('\n');
  const validated = validateCaptureHints(hints, new Set(activeCategories.keys()));
  if (!validated.amount) return false;

  const candidates: LineAiValueCandidates = extractValueCandidates(sourceText);
  if (!candidates.amounts.some((candidate) => samePositiveAmount(candidate.value, validated.amount!))) return false;

  const description = validated.description && comparableText(validated.description);
  if (description && comparableText(sourceText).includes(description)) return true;
  const categoryName = validated.expenseCategoryId && activeCategories.get(validated.expenseCategoryId);
  return !!categoryName && comparableText(sourceText).includes(comparableText(categoryName));
}

/** The versioned EXACT correction grammar (spec §8.3 rule 4). Whitespace is stripped before the
 *  comparison, so `แก้ยอด เป็น 200 บาท` matches too; it is deliberately a short closed list of value
 *  corrections and must never grow into a synonym engine for business intent. */
const EXPLICIT_AMOUNT_CORRECTIONS = [
  'แก้ยอดเป็น', 'แก้ยอดเงินเป็น', 'แก้ราคาเป็น', 'เปลี่ยนยอดเป็น', 'เปลี่ยนยอดเงินเป็น', 'เปลี่ยนราคาเป็น',
];

/** The whole whitespace-stripped message must BE the command. Matching the phrase anywhere inside it
 *  reads the question `ถ้าแก้ยอดเป็น 200 บาทได้ไหม` and the refusal `ไม่แก้ยอดเป็น 200 บาท` as orders to
 *  replace the amount — the two shapes most likely to appear right after we offer the grammar. Only a
 *  bare number, an optional currency word, and an optional polite particle may follow the phrase. */
const EXPLICIT_AMOUNT_CORRECTION_COMMAND = new RegExp(
  `^(?:${EXPLICIT_AMOUNT_CORRECTIONS.join('|')})\\d[\\d,]*(?:\\.\\d+)?(?:บาท|฿)?(?:นะ)?(?:ครับผม|ครับ|คับ|ค่ะ|คะ|จ้า|จ้ะ|ฮะ)?$`,
  'u',
);

/** NFC (not NFKC): NFKC decomposes precomposed Thai vowels and would break these literals. */
function hasExplicitAmountCorrection(messageText: string): boolean {
  const compact = normalizeThaiDigits(messageText.normalize('NFC')).replace(/\s+/g, '');
  return EXPLICIT_AMOUNT_CORRECTION_COMMAND.test(compact);
}

/** Distinct positive amounts a deterministic parser can see across `segments` — this turn's message and
 *  each resolved clarification, kept apart on purpose. The currency filter runs PER SEGMENT: inside one
 *  segment a currency-marked candidate still beats an incidental quantity (`ค่ากาแฟ 2 แก้ว 65 บาท` is one
 *  amount), but a `บาท` typed this turn must never silence a bare `60` from an earlier one, or the
 *  two-amount conflict the user has to resolve would resolve itself silently. */
function distinctSourceAmounts(...segments: string[]): number[] {
  const values = segments.filter(Boolean).flatMap((segment) => {
    const { amounts }: LineAiValueCandidates = extractValueCandidates(segment);
    const monetary = amounts.filter((candidate) => candidate.currencyToken);
    return (monetary.length > 0 ? monetary : amounts)
      .map((candidate) => toPositiveNumber(candidate.value))
      .filter((value): value is number => value !== null);
  });
  return [...new Set(values)];
}

/** Bounded, enum-only completeness verdict — it carries field NAMES, never conversation text or values. */
export type LineTextExpenseCaptureAssessment = {
  eligible: boolean;
  acceptedFields: LineIntakeClarificationField[];
  missingFields: LineIntakeClarificationField[];
  conflictingFields: LineIntakeClarificationField[];
};

/**
 * Final deterministic authority for LINE text-only draft creation.
 *
 * DEFAULT-OFF IS THE LEGACY RULE, not a softened version of the new one. Without
 * `semanticBusinessExpenseConfirmed` — the server-verified BUSINESS_EXPENSE + COMPANY_PAID route — this
 * delegates to {@link isLineTextExpenseCaptureEligible} unchanged and reports NO typed fields, so the
 * dispatcher falls back to the exact previous clarification copy.
 *
 * Only that one verified route activates the §8.1–8.2 rules:
 * - the model-selected amount must equal the ONE distinct amount THIS message states. Resolved
 *   clarifications are VETO evidence only (a prior `60` beside a new `200` is a conflict the user must
 *   resolve) — they are never positive authority for a financial write, because Redis clarification text
 *   has no durable neutral state behind it yet;
 * - the purpose must be a bounded `description` or `businessPurpose` copied from THIS message (the buffer
 *   already joined a multi-bubble turn into it). An active category name is a classification, not a
 *   purpose, and can no longer stand in for one.
 */
export function assessLineTextExpenseCapture(
  messageText: string,
  hints: CaptureHintsInput,
  activeCategories: ReadonlyMap<string, string>,
  groundingTexts: string[] = [],
  options: { semanticBusinessExpenseConfirmed?: boolean } = {},
): LineTextExpenseCaptureAssessment {
  if (options.semanticBusinessExpenseConfirmed !== true) {
    return {
      eligible: isLineTextExpenseCaptureEligible(messageText, hints, activeCategories, groundingTexts),
      acceptedFields: [], missingFields: [], conflictingFields: [],
    };
  }

  const validated = validateCaptureHints(hints, new Set(activeCategories.keys()));
  const acceptedFields: LineIntakeClarificationField[] = [];
  const missingFields: LineIntakeClarificationField[] = [];
  const conflictingFields: LineIntakeClarificationField[] = [];

  // An explicit correction makes THIS message the only amount evidence, so the amount it replaces stops
  // competing. Anything less explicit keeps both and lands in `conflictingFields` below.
  const messageAmounts = distinctSourceAmounts(messageText);
  const vetoCandidates = hasExplicitAmountCorrection(messageText) && messageAmounts.length === 1
    ? messageAmounts
    : distinctSourceAmounts(messageText, ...groundingTexts);
  const selectedAmount = toPositiveNumber(validated.amount ?? undefined);
  if (selectedAmount === null) missingFields.push('amount');
  else if (vetoCandidates.length > 1) conflictingFields.push('amount');
  else if (messageAmounts.length === 1 && messageAmounts[0] === selectedAmount) acceptedFields.push('amount');
  else missingFields.push('amount');

  const comparableMessage = comparableText(messageText);
  const isGrounded = (value: string | null): boolean => !!value && comparableMessage.includes(comparableText(value));
  if (isGrounded(validated.description)) acceptedFields.push('description');
  else if (isGrounded(validated.businessPurpose)) acceptedFields.push('purpose');
  else missingFields.push('description', 'purpose');

  return {
    eligible: missingFields.length === 0 && conflictingFields.length === 0,
    acceptedFields,
    missingFields,
    conflictingFields,
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

/** A clear non-receipt classification is still useful AI work; an unreadable receipt is not. */
export function isSuccessfulNonReceiptClassification(classification: BusinessDocumentClassification | null | undefined): boolean {
  if (!classification || classification.requiresClarification
    || !['DOCUMENT', 'NON_DOCUMENT_IMAGE'].includes(classification.contentKind)
    || classification.documentKind === 'NEEDS_REVIEW') return false;
  return classification.businessDirection === 'SALES_RECEIVABLE'
    || classification.businessDirection === 'CUSTOMER_INBOUND'
    || (classification.documentFamily !== 'EXPENSE_EVIDENCE'
      && !EXPENSE_EXTRACTION_KINDS.has(classification.documentKind));
}
