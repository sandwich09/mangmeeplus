/**
 * Pure domain logic for accounting document status transitions.
 */

import type {
  AccountingAdjustmentReasonCode,
  AccountingDocumentStatus,
  AccountingDocumentType,
  AccountingOutputTaxCode,
  AccountingVatMode,
} from '@watchdog-bms/contracts';
import {
  ACCOUNTING_CREDIT_NOTE_REASON_CODES,
  ACCOUNTING_DEBIT_NOTE_REASON_CODES,
} from '@watchdog-bms/contracts';
import Decimal from 'decimal.js';

type OutputTaxDocumentFacts = {
  documentType: AccountingDocumentType;
  outputTaxCode?: AccountingOutputTaxCode;
  vatMode: AccountingVatMode;
  vatAmount?: string;
  sourceDocumentId?: string;
  sourceDocumentType?: string;
  adjustmentReasonCode?: AccountingAdjustmentReasonCode;
  adjustmentReasonText?: string;
  lines?: Array<{
    taxCodeDefinitionId?: string;
    externalTaxCode?: string;
    taxSnapshot?: { taxCodeDefinitionId: string | null; externalTaxCode: string | null };
    taxComponents?: unknown[];
  }>;
};

type OutputTaxSourceFacts = {
  documentType: AccountingDocumentType;
  status: AccountingDocumentStatus;
  outputTaxCode?: AccountingOutputTaxCode;
  vatMode?: AccountingVatMode;
  vatAmount?: string;
};

export function validateAdjustmentReason(document: {
  documentType: AccountingDocumentType;
  adjustmentReasonCode?: AccountingAdjustmentReasonCode;
  adjustmentReasonText?: string;
}): string | null {
  const isCorrection = document.documentType === 'CREDIT_NOTE' || document.documentType === 'DEBIT_NOTE';
  if (!isCorrection) {
    return document.adjustmentReasonCode || document.adjustmentReasonText
      ? 'Adjustment reasons are only allowed on credit or debit notes'
      : null;
  }
  if (!document.adjustmentReasonCode) return `${document.documentType} requires an adjustment reason`;
  const allowed = document.documentType === 'CREDIT_NOTE'
    ? ACCOUNTING_CREDIT_NOTE_REASON_CODES
    : ACCOUNTING_DEBIT_NOTE_REASON_CODES;
  if (!(allowed as readonly string[]).includes(document.adjustmentReasonCode)) {
    return `Adjustment reason is not allowed for ${document.documentType}`;
  }
  if (document.adjustmentReasonCode === 'OTHER_PRESCRIBED' && (document.adjustmentReasonText?.trim().length ?? 0) < 3) {
    return 'OTHER_PRESCRIBED requires a specific reason';
  }
  return null;
}

function authoritativeExternalTaxCode(line: NonNullable<OutputTaxDocumentFacts['lines']>[number]): string | undefined {
  return line.taxSnapshot?.externalTaxCode ?? line.externalTaxCode;
}

export function deriveCompatibleOutputTaxCode(
  lines?: OutputTaxDocumentFacts['lines'],
): AccountingOutputTaxCode | undefined {
  if (!lines?.length) return undefined;
  const codes = lines.map(authoritativeExternalTaxCode);
  if (codes.some((code) => !code)) return undefined;
  const unique = new Set(codes);
  const code = unique.size === 1 ? [...unique][0] : undefined;
  return code && ['O7', 'OX', 'O0'].includes(code) ? code as AccountingOutputTaxCode : undefined;
}

export function validateOutputTaxDocument(
  document: OutputTaxDocumentFacts,
  source?: OutputTaxSourceFacts,
): string | null {
  const { documentType, outputTaxCode, vatMode } = document;

  const reasonError = validateAdjustmentReason(document);
  if (reasonError) return reasonError;

  if (outputTaxCode && !['O7', 'OX', 'O0'].includes(outputTaxCode)) {
    return `Unsupported output Tax Code: ${outputTaxCode}`;
  }

  if (['QUOTATION', 'BILLING_NOTE', 'RECEIPT'].includes(documentType)) {
    const hasLineTax = document.lines?.some((line) => line.taxCodeDefinitionId || line.externalTaxCode || line.taxSnapshot || line.taxComponents?.length);
    return outputTaxCode || hasLineTax ? `${documentType} cannot carry an output Tax Code` : null;
  }
  if (documentType === 'INVOICE' && outputTaxCode) {
    return 'A plain invoice cannot carry a Tax Code; issue a TAX_INVOICE for VAT or zero-rated sales';
  }
  if (documentType === 'INVOICE' && document.lines?.some((line) => line.taxCodeDefinitionId || line.externalTaxCode || line.taxSnapshot || line.taxComponents?.length)) {
    return 'A plain invoice cannot carry Tax Code lines; issue a TAX_INVOICE';
  }
  const hasAuthoritativeLineTax = document.lines?.some((line) => line.taxCodeDefinitionId || line.externalTaxCode || line.taxSnapshot);
  const invoiceCorrection = ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(documentType)
    && source?.documentType === 'INVOICE';
  if (['TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(documentType)
    && !invoiceCorrection && !outputTaxCode && !hasAuthoritativeLineTax) {
    return `${documentType} requires an output Tax Code`;
  }
  if (outputTaxCode && document.lines?.some((line) => {
    const lineCode = authoritativeExternalTaxCode(line);
    return lineCode !== undefined && lineCode !== outputTaxCode;
  })) {
    return 'output_tax_code_line_mismatch';
  }
  if (outputTaxCode) {
    if (outputTaxCode === 'O7' && !['VAT_INCLUDED', 'VAT_EXCLUDED'].includes(vatMode)) {
      return 'O7 requires VAT_INCLUDED or VAT_EXCLUDED';
    }
    if (outputTaxCode === 'OX' && vatMode !== 'EXEMPT') return 'OX requires EXEMPT';
    if (outputTaxCode === 'O0' && vatMode !== 'NO_VAT') return 'O0 requires NO_VAT';

    if (document.vatAmount !== undefined) {
      const vatAmount = Number(document.vatAmount);
      if (outputTaxCode === 'O7' && !(vatAmount > 0)) return 'O7 requires a positive VAT amount';
      if (outputTaxCode !== 'O7' && vatAmount !== 0) return `${outputTaxCode} requires a zero VAT amount`;
    }
  }

  if (document.sourceDocumentId && !source) return 'Referenced source document was not found';
  if (source && document.sourceDocumentType && document.sourceDocumentType !== source.documentType) {
    return 'Source document type does not match the referenced document';
  }
  if (documentType === 'TAX_INVOICE' && source) {
    if (!['INVOICE', 'RECEIPT'].includes(source.documentType) || source.status !== 'ISSUED') {
      return 'A linked TAX_INVOICE requires an issued INVOICE or RECEIPT source';
    }
  }
  if (['CREDIT_NOTE', 'DEBIT_NOTE'].includes(documentType)) {
    if (!document.sourceDocumentId || !source) return `${documentType} requires a referenced source document`;
    if (!['TAX_INVOICE', 'INVOICE'].includes(source.documentType) || !isIssued(source.status)) {
      return `${documentType} must reference an issued original TAX_INVOICE or non-VAT INVOICE`;
    }
    if (source.documentType === 'INVOICE') {
      const sourceHasVat = new Decimal(source.vatAmount ?? 0).abs().gt(0)
        || source.outputTaxCode !== undefined
        || (source.vatMode !== undefined && !['NO_VAT', 'EXEMPT'].includes(source.vatMode));
      if (sourceHasVat || outputTaxCode || hasAuthoritativeLineTax || new Decimal(document.vatAmount ?? 0).abs().gt(0)) {
        return `${documentType} can reference an INVOICE only when both documents are non-VAT`;
      }
    }
    if (source.outputTaxCode && outputTaxCode && source.outputTaxCode !== outputTaxCode) return `${documentType} Tax Code must match its source document`;
  }

  return null;
}

/** Returns true if the status allows edits to draft fields (lines, amounts, dates). */
export function isDraftEditable(status: AccountingDocumentStatus): boolean {
  return status === 'DRAFT';
}

/** Returns true if status is terminal (no further transitions). */
export function isTerminalStatus(status: AccountingDocumentStatus): boolean {
  return status === 'VOIDED' || status === 'CLOSED';
}

/** Returns true if the document is issued (locked money/tax/counterparty). */
export function isIssued(status: AccountingDocumentStatus): boolean {
  return ['ISSUED', 'CREDITED', 'DEBITED', 'CLOSED'].includes(status);
}

/** Validates whether a transition is allowed. Returns error reason or null if allowed. */
export function validateStatusTransition(
  from: AccountingDocumentStatus,
  to: AccountingDocumentStatus,
  documentType: AccountingDocumentType,
): string | null {
  // Terminal states block further transitions
  if (isTerminalStatus(from)) {
    return `Document is ${from.toLowerCase()} and cannot transition to ${to}`;
  }

  const allowed: Partial<Record<AccountingDocumentStatus, AccountingDocumentStatus[]>> = {
    DRAFT: ['PENDING_APPROVAL', 'ISSUED'],
    PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
    APPROVED: ['ISSUED', 'REJECTED'],
    REJECTED: ['DRAFT'], // can revise and resubmit
    ISSUED: ['VOIDED', 'CREDITED', 'DEBITED', 'CLOSED'],
    CREDITED: ['VOIDED'],
    DEBITED: ['VOIDED'],
  };

  const allowedTargets = allowed[from] ?? [];
  if (!allowedTargets.includes(to)) {
    return `Cannot transition from ${from} to ${to}`;
  }

  // Quotation approval flow: DRAFT -> PENDING_APPROVAL -> APPROVED -> ISSUED
  // For quotations, direct DRAFT -> ISSUED is not allowed (must go through approval)
  if (documentType === 'QUOTATION' && from === 'DRAFT' && to === 'ISSUED') {
    return 'Quotation must be submitted for approval before issue';
  }

  // Non-quotations cannot use approval statuses
  if (documentType !== 'QUOTATION' && ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(to)) {
    return `Document type ${documentType} does not support approval workflow`;
  }

  return null;
}

/** Validates that a document carries at least one line before it can be issued. */
export function validateIssuableLines(lineCount: number): string | null {
  if (lineCount < 1) {
    return 'Cannot issue a document with no line items';
  }
  return null;
}

/** Validates quotation self-approval: submittingUserId must differ from approvingUserId. */
export function validateQuotationApproval(
  submittedByUserId: string,
  approvingUserId: string,
): string | null {
  if (submittedByUserId === approvingUserId) {
    return 'Sales cannot approve their own quotation issue request';
  }
  return null;
}

/** Determines initial posting status for a newly issued document. */
export function initialPostingStatus(
  documentType: AccountingDocumentType,
  status: AccountingDocumentStatus,
): 'not_required' | 'pending' {
  // Quotations and drafts are not accounting-relevant for posting
  if (documentType === 'QUOTATION') return 'not_required';
  if (!isIssued(status)) return 'not_required';
  // Invoices, billing notes, receipts, tax invoices, payments, credit/debit notes are posting-relevant
  return 'pending';
}

/** Returns true if source document is eligible for credit/debit note correction. */
export function isEligibleForCorrection(status: AccountingDocumentStatus): boolean {
  return status === 'ISSUED' || status === 'CREDITED' || status === 'DEBITED';
}

type CorrectionLineAmount = { lineNumber: number; discountAmount?: string | null; taxBaseAmount?: string | null; taxableAmount?: string | null; lineSubtotalAmount?: string | null; transactionTaxAmount?: string | null; vatAmount?: string | null };
type IssuedCorrectionAmounts = { documentType: 'CREDIT_NOTE' | 'DEBIT_NOTE'; lines: CorrectionLineAmount[] };

/** Credit cannot exceed original plus issued debit increases, net of earlier issued credits. */
export function validateCumulativeCreditNote(
  originalLines: CorrectionLineAmount[],
  creditLines: CorrectionLineAmount[],
  issuedCorrections: IssuedCorrectionAmounts[],
): string | null {
  const value = (line: CorrectionLineAmount, tax: boolean) => {
    if (tax) return new Decimal(line.transactionTaxAmount ?? line.vatAmount ?? 0).abs();
    if (line.taxBaseAmount !== undefined && line.taxBaseAmount !== null) return new Decimal(line.taxBaseAmount).abs();
    if (line.taxableAmount !== undefined && line.taxableAmount !== null) return new Decimal(line.taxableAmount).abs();
    return new Decimal(line.lineSubtotalAmount ?? 0).sub(line.discountAmount ?? 0).abs();
  };
  for (const credit of creditLines) {
    const original = originalLines.find((line) => line.lineNumber === credit.lineNumber);
    if (!original) return `Credit note line ${credit.lineNumber} has no matching original line`;
    for (const tax of [false, true]) {
      let remaining = value(original, tax);
      for (const correction of issuedCorrections) {
        const line = correction.lines.find((item) => item.lineNumber === credit.lineNumber);
        if (!line) continue;
        remaining = correction.documentType === 'DEBIT_NOTE' ? remaining.add(value(line, tax)) : remaining.minus(value(line, tax));
      }
      if (value(credit, tax).gt(remaining)) return `Credit note line ${credit.lineNumber} exceeds the remaining ${tax ? 'tax' : 'tax base'} amount`;
    }
  }
  return null;
}

/** Validates that a void operation can proceed. */
export function validateVoid(
  status: AccountingDocumentStatus,
  reason: string,
): string | null {
  if (!reason || reason.trim().length < 3) {
    return 'Void reason must be at least 3 characters';
  }
  if (!isIssued(status) && status !== 'DRAFT' && status !== 'PENDING_APPROVAL' && status !== 'APPROVED' && status !== 'REJECTED') {
    return `Document in ${status} status cannot be voided`;
  }
  if (isTerminalStatus(status)) {
    return `Document is already ${status}`;
  }
  return null;
}

/** Maps document type to document sequence key. */
export function documentSequenceKey(documentType: AccountingDocumentType): string {
  const map: Record<AccountingDocumentType, string> = {
    QUOTATION: 'accounting.quotation',
    INVOICE: 'accounting.invoice',
    BILLING_NOTE: 'accounting.billing_note',
    RECEIPT: 'accounting.receipt',
    TAX_INVOICE: 'tax.invoice',
    CREDIT_NOTE: 'accounting.credit_note',
    DEBIT_NOTE: 'accounting.debit_note',
  };
  return map[documentType];
}
