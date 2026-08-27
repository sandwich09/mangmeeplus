import {
  BUSINESS_DOCUMENT_CONTENT_KINDS,
  BUSINESS_DOCUMENT_DIRECTIONS,
  BUSINESS_DOCUMENT_EVIDENCE_ROLES,
  BUSINESS_DOCUMENT_FAMILIES,
  BUSINESS_DOCUMENT_KINDS,
  BUSINESS_DOCUMENT_REASON_CODES,
  BUSINESS_DOCUMENT_TRANSACTION_STATES,
  extractValueCandidates,
  mapThaiDigits,
  type BusinessDocumentClassification,
  type BusinessDocumentReasonCode,
  type ReceiptOcrFieldResult,
} from '@watchdog-bms/contracts';

const MAX_SIGNAL_COUNT = 12;
const MAX_SIGNAL_LENGTH = 120;
const MIN_CLASSIFICATION_CONFIDENCE = 0.6;

function isKnown<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

/** Like parseKnownArray, but unknown entries are FILTERED instead of voiding the array — for
 *  descriptive fields only, never for reason codes that feed clarification gates. */
function parseFilteredKnownArray<T extends string>(value: unknown, values: readonly T[]): T[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((item): item is T => isKnown(item, values)))].slice(0, MAX_SIGNAL_COUNT);
}

/**
 * Reason codes, kept honest without throwing the turn away (UAT 2026-08-27). A code the vocabulary
 * does not contain used to void the whole classification, which voided the whole plan: a PTT fuel
 * card slip the model had read perfectly was answered with "what is this picture?" because ONE
 * field held the sentence "itemised fuel quantity/litres not shown on this slip".
 *
 * Discarding everything is not the safe reading of that. The model was telling us something is
 * missing; we simply do not know its code. So the unknown entry is dropped and `sawUnknown` is
 * reported, and the caller turns that into HUMAN_REVIEW_REQUIRED + clarification — a record a
 * person checks, instead of no record and a confused employee. A non-array is still invalid shape
 * (not a vocabulary miss) and still voids the classification.
 */
function parseReasonCodes(value: unknown): { codes: BusinessDocumentReasonCode[]; sawUnknown: boolean } | null {
  if (value === undefined) return { codes: [], sawUnknown: false };
  if (!Array.isArray(value)) return null;
  const codes = parseFilteredKnownArray(value, BUSINESS_DOCUMENT_REASON_CODES);
  if (!codes) return null;
  return { codes, sawUnknown: value.some((item) => !isKnown(item, BUSINESS_DOCUMENT_REASON_CODES)) };
}

function parseExactSpans(value: unknown, documentText: string): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const span = item.trim().slice(0, MAX_SIGNAL_LENGTH);
    if (span && documentText.includes(span) && !out.includes(span)) out.push(span);
    if (out.length === MAX_SIGNAL_COUNT) break;
  }
  return out;
}

function addReasons(
  reasons: BusinessDocumentReasonCode[],
  ...added: BusinessDocumentReasonCode[]
): BusinessDocumentReasonCode[] {
  return [...new Set([...reasons, ...added])].slice(0, MAX_SIGNAL_COUNT);
}

/** Strictly validates model classification and retains only short spans present in stage-1 OCR text. */
export function parseBusinessDocumentClassification(
  value: unknown,
  documentText: string,
): BusinessDocumentClassification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    !isKnown(raw['contentKind'], BUSINESS_DOCUMENT_CONTENT_KINDS)
    || !isKnown(raw['documentFamily'], BUSINESS_DOCUMENT_FAMILIES)
    || !isKnown(raw['documentKind'], BUSINESS_DOCUMENT_KINDS)
    || !isKnown(raw['businessDirection'], BUSINESS_DOCUMENT_DIRECTIONS)
    || !isKnown(raw['transactionState'], BUSINESS_DOCUMENT_TRANSACTION_STATES)
    || typeof raw['confidence'] !== 'number'
    || !Number.isFinite(raw['confidence'])
    || typeof raw['requiresClarification'] !== 'boolean'
  ) return null;

  // evidenceRoles is descriptive metadata, not a gate: an out-of-vocabulary label from a newer
  // model (e.g. "RECEIPT" for a receipt) is dropped, never allowed to void the classification —
  // rejecting the whole turn over a synonym stranded real receipts (UAT 2026-08-27).
  const evidenceRoles = parseFilteredKnownArray(raw['evidenceRoles'], BUSINESS_DOCUMENT_EVIDENCE_ROLES);
  const missing = parseReasonCodes(raw['missingRequiredSignals']);
  const contradiction = parseReasonCodes(raw['contradictionSignals']);
  const evidenceSignals = parseExactSpans(raw['evidenceSignals'], documentText);
  const amountSignals = parseExactSpans(raw['amountSignals'], documentText);
  const settlementSignals = parseExactSpans(raw['settlementSignals'], documentText);
  if (
    !evidenceRoles || !missing || !contradiction
    || !evidenceSignals || !amountSignals || !settlementSignals
  ) return null;

  const missingRequiredSignals = missing.codes;
  const contradictionSignals = contradiction.codes;
  // A reason we could not decode is still a reason: route it to a person rather than acting on a
  // classification whose caveat we dropped.
  const droppedUnknownReason = missing.sawUnknown || contradiction.sawUnknown;
  const confidence = Math.max(0, Math.min(1, raw['confidence']));
  const needsConfidenceReview = confidence < MIN_CLASSIFICATION_CONFIDENCE;
  const hasContradiction = contradictionSignals.length > 0;
  return {
    contentKind: raw['contentKind'],
    documentFamily: raw['documentFamily'],
    documentKind: raw['documentKind'],
    businessDirection: raw['businessDirection'],
    transactionState: raw['transactionState'],
    evidenceRoles,
    confidence,
    evidenceSignals,
    amountSignals,
    settlementSignals,
    missingRequiredSignals: addReasons(
      missingRequiredSignals,
      ...(needsConfidenceReview ? ['LOW_CLASSIFICATION_CONFIDENCE' as const] : []),
      ...(droppedUnknownReason ? ['HUMAN_REVIEW_REQUIRED' as const] : []),
    ),
    contradictionSignals: addReasons(
      contradictionSignals,
      ...(hasContradiction ? ['CONTRADICTORY_SIGNALS' as const] : []),
    ),
    requiresClarification: raw['requiresClarification']
      || needsConfidenceReview
      || hasContradiction
      || droppedUnknownReason
      || raw['contentKind'] !== 'DOCUMENT',
  };
}

function positiveNumber(value: string | undefined): boolean {
  if (!value) return false;
  const amount = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(amount) && amount > 0;
}

function exactField(field: string | undefined, documentText: string): boolean {
  return !!field?.trim() && documentText.includes(field.trim());
}

function amountSignalSupports(value: string | undefined, signals: string[]): boolean {
  if (!positiveNumber(value)) return false;
  const expected = Number(value!.replace(/,/g, '').trim());
  return signals.some((signal) => {
    if (extractValueCandidates(signal).amounts.some((candidate) => Number.parseFloat(candidate.value) === expected)) return true;
    return [...mapThaiDigits(signal).matchAll(/\d[\d,]*(?:\.\d+)?/g)]
      .some((match) => Number.parseFloat(match[0].replace(/,/g, '')) === expected);
  });
}

/** Receipt-only deterministic downgrade: models can never promote weaker/non-expense evidence. */
export function gateBusinessDocumentClassification(
  classification: BusinessDocumentClassification,
  fields: ReceiptOcrFieldResult | undefined,
  documentText: string,
): BusinessDocumentClassification {
  if (classification.documentKind !== 'RECEIPT') return classification;

  if (classification.documentFamily !== 'EXPENSE_EVIDENCE') {
    return {
      ...classification,
      documentKind: 'NEEDS_REVIEW',
      requiresClarification: true,
      missingRequiredSignals: addReasons(classification.missingRequiredSignals, 'HUMAN_REVIEW_REQUIRED'),
    };
  }

  const hasTotal = amountSignalSupports(fields?.grandTotalAmount, classification.amountSignals);
  const hasOrderEvidence = positiveNumber(fields?.quantity)
    || classification.missingRequiredSignals.includes('QUANTITY_ONLY')
    || classification.missingRequiredSignals.includes('ORDER_ONLY');
  if (!hasTotal) {
    if (hasOrderEvidence) {
      return {
        ...classification,
        documentFamily: 'COMMERCIAL_DOCUMENT',
        documentKind: 'ORDER_OR_CHECK_BILL',
        transactionState: 'ORDERED',
        evidenceRoles: ['CONVERSATION_ATTACHMENT'],
        missingRequiredSignals: addReasons(
          classification.missingRequiredSignals,
          ...(positiveNumber(fields?.quantity) ? ['QUANTITY_ONLY' as const] : []),
          'MISSING_MONETARY_AMOUNT',
          'MISSING_TRANSACTION_TOTAL',
          'ORDER_ONLY',
        ),
        requiresClarification: true,
      };
    }
    return {
      ...classification,
      documentKind: 'NEEDS_REVIEW',
      missingRequiredSignals: addReasons(
        classification.missingRequiredSignals,
        'MISSING_MONETARY_AMOUNT',
        'MISSING_TRANSACTION_TOTAL',
        'HUMAN_REVIEW_REQUIRED',
      ),
      requiresClarification: true,
    };
  }

  if (classification.settlementSignals.length === 0 || classification.transactionState !== 'PAID') {
    const hasVendor = exactField(fields?.vendorName, documentText);
    return {
      ...classification,
      documentFamily: hasVendor ? 'EXPENSE_EVIDENCE' : 'COMMERCIAL_DOCUMENT',
      documentKind: hasVendor ? 'SUPPLIER_INVOICE_OR_BILL' : 'ORDER_OR_CHECK_BILL',
      transactionState: hasVendor ? 'DUE' : 'ORDERED',
      missingRequiredSignals: addReasons(classification.missingRequiredSignals, 'MISSING_PAYMENT_EVIDENCE'),
      requiresClarification: classification.requiresClarification || !hasVendor,
    };
  }

  const hasAnchor = exactField(fields?.vendorName, documentText)
    || exactField(fields?.documentNumber, documentText)
    || !!fields?.expenseDate;
  if (!hasAnchor) {
    return {
      ...classification,
      documentKind: 'NEEDS_REVIEW',
      missingRequiredSignals: addReasons(
        classification.missingRequiredSignals,
        'MISSING_VENDOR',
        'MISSING_DOCUMENT_NUMBER',
        'HUMAN_REVIEW_REQUIRED',
      ),
      requiresClarification: true,
    };
  }

  if (classification.businessDirection !== 'PURCHASE_EXPENSE') {
    return {
      ...classification,
      requiresClarification: true,
      missingRequiredSignals: addReasons(classification.missingRequiredSignals, 'AMBIGUOUS_BUSINESS_DIRECTION'),
    };
  }

  return classification;
}
