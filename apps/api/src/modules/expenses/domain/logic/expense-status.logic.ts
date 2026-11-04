import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { WHT_REMITTANCES, type WhtRemittance } from '@watchdog-bms/contracts';
import { CLAIMABLE_INPUT_VAT_DOCUMENT_TYPES } from './expense-document.logic';
import {
  isNonExpenseClassificationBlocking, expenseEvidenceAssessment,
  type ExpenseStatus,
  type DuplicateStatus,
  type ExpensePostingStatus,
  type VatRegistrationStatus,
} from '@watchdog-bms/contracts';
import { createHash } from 'node:crypto';
import type { ExpenseRecordWithRelations } from '../models/expense.model';

export function eWhtRemittanceAllowed(input: { requested?: string | null; stored?: string | null; shopUsesEWht: boolean }): boolean {
  return input.requested !== 'E_WHT' || input.stored === 'E_WHT' || input.shopUsesEWht;
}

export function normalizeWhtRemittance(value: unknown, whtAmount: string): WhtRemittance | null {
  if (value != null && !(WHT_REMITTANCES as readonly unknown[]).includes(value)) {
    throw new BadRequestException({ code: 'expense_wht_remittance_invalid', message: 'วิธีนำส่งภาษีไม่ถูกต้อง เลือกวิธีนำส่งภาษีอีกครั้ง' });
  }
  return new Decimal(whtAmount).isZero() ? null : (value as WhtRemittance | null | undefined) ?? null;
}

export const NON_EXPENSE_CLASSIFICATION_REVIEW_REQUIRED =
  'This document is classified as non-expense. Finance must explicitly override the source document type before advancing.';

export function hasBlockingNonExpenseClassification(
  summary: Record<string, unknown> | null | undefined,
): boolean {
  return isNonExpenseClassificationBlocking(summary);
}

/** Optimistic token for every expense fact used by final transaction-tax resolution. */
export function expenseTaxSourceChecksum(expense: ExpenseRecordWithRelations): string {
  const date = (value: Date | null | undefined) => value?.toISOString() ?? null;
  const facts = {
    id: expense.id,
    companyId: expense.companyId,
    branchId: expense.branchId ?? null,
    status: expense.status,
    duplicateStatus: expense.duplicateStatus,
    expenseDate: date(expense.expenseDate),
    currency: expense.currency,
    sourceDocumentType: expense.sourceDocumentType,
    taxEvidenceStatus: expense.taxEvidenceStatus,
    inputVatClaimStatus: expense.inputVatClaimStatus,
    vatCaptureSnapshot: expense.vatCaptureSnapshotJson ?? null,
    whtInput: expense.whtInputJson ?? null,
    whtRemittance: expense.whtRemittance ?? null,
    primaryAttachmentId: expense.primaryAttachmentId ?? null,
    attachments: [...(expense.attachments ?? [])]
      .sort((left, right) => left.id.localeCompare(right.id) || left.purpose.localeCompare(right.purpose))
      .map((attachment) => ({
        id: attachment.id,
        purpose: attachment.purpose,
        checksumSha256: attachment.checksumSha256,
      })),
    missingReceiptReason: expense.missingReceiptReason ?? null,
    vendorTaxIdSnapshot: expense.vendorTaxIdSnapshot ?? null,
    vendorDocumentNumber: expense.vendorDocumentNumber ?? null,
    substituteEvidence: expense.substituteReceiptEvidence ? {
      id: expense.substituteReceiptEvidence.id,
      version: expense.substituteReceiptEvidence.version,
      status: expense.substituteReceiptEvidence.status,
      artifactAttachmentId: expense.substituteReceiptEvidence.artifactAttachmentId,
    } : null,
    lines: [...(expense.lines ?? [])]
      .sort((left, right) => left.lineNumber - right.lineNumber || left.id.localeCompare(right.id))
      .map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        taxableAmount: line.taxableAmount,
        vatRate: line.vatRate ?? null,
        vatTreatment: line.vatTreatment ?? null,
        vatAmount: line.vatAmount,
        whtCategoryCode: line.whtCategoryCode ?? null,
        whtRate: line.whtRate,
        whtAmount: line.whtAmount,
        lineSubtotalAmount: line.lineSubtotalAmount,
        lineTotalAmount: line.lineTotalAmount,
        taxCodeDefinitionId: line.taxSnapshot?.taxCodeDefinitionId ?? null,
        externalTaxCode: line.taxSnapshot?.externalTaxCode ?? null,
        taxContext: line.taxSnapshot?.taxContext ?? null,
      })),
  };
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

const ALLOWED_TRANSITIONS: Record<ExpenseStatus, ExpenseStatus[]> = {
  DRAFT: ['EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION', 'REJECTED'],
  EXTRACTING: ['NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'],
  NEEDS_REVIEW: ['READY_FOR_CONFIRMATION', 'REJECTED'],
  READY_FOR_CONFIRMATION: ['CONFIRMED', 'NEEDS_REVIEW', 'REJECTED'],
  // Only the permission-checked reopen command may take the correction edge.
  CONFIRMED: ['VOIDED', 'NEEDS_REVIEW'],
  // "เริ่มตรวจใหม่" reopens a rejected record. Only back to NEEDS_REVIEW: the record must be edited
  // and re-submitted, so a rejection can never be undone into a confirmable state in one step.
  REJECTED: ['NEEDS_REVIEW'],
  VOIDED: [],
};

export function canTransition(from: ExpenseStatus, to: ExpenseStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateStatusTransition(from: ExpenseStatus, to: ExpenseStatus): string | null {
  if (!canTransition(from, to)) {
    return `Cannot transition from ${from} to ${to}.`;
  }
  return null;
}

export type ConfirmValidationInput = {
  status: ExpenseStatus;
  duplicateStatus: DuplicateStatus;
  primaryAttachmentId: string | null;
  missingReceiptReason: string | null;
  vendorNameSnapshot: string | null;
  vendorDocumentNumber: string | null;
  expenseDate: string | null;
  grandTotalAmount: string;
  whtAmount: string;
  vendorEntityKindSnapshot: string | null;
  whtCategoryCode: string | null;
  vatMode: string;
  inputVatClaimStatus: string;
  hasMissingReceiptPermission?: boolean;
  /** Server-computed current evidence assessment, never a client permission flag. */
  hasReviewedEvidence?: boolean;
  hasLinkedClaimEvidence?: boolean;
  aiVerifiedFieldsJson?: Record<string, unknown> | null;
  aiVerificationSummaryJson?: Record<string, unknown> | null;
};

type ExpenseTaxLineFacts = {
  taxCodeDefinitionId?: string | null;
  externalTaxCode?: string | null;
  transactionContext?: string | null;
  taxSnapshot?: {
    taxCodeDefinitionId?: string | null;
    externalTaxCode?: string | null;
    taxContext?: string | null;
  } | null;
};

export type DomesticInputVatEvidenceFacts = {
  aiVerificationSummaryJson?: Record<string, unknown> | null;
  sourceDocumentType: string;
  taxEvidenceStatus: string;
  inputVatClaimStatus: string;
  primaryAttachmentId: string | null;
  vendorTaxIdSnapshot: string | null;
  vendorDocumentNumber: string | null;
  lines: ExpenseTaxLineFacts[];
  /** The company's VAT registration on the EXPENSE's date, not today. */
  vatStatus?: VatRegistrationStatus;
};

type VatTaxSnapshotLine = ExpenseTaxLineFacts & {
  vatAmount: string;
  taxComponents?: unknown[] | null;
};

export function hasMissingClaimableVatTaxSnapshot(
  inputVatClaimStatus: string,
  lines: VatTaxSnapshotLine[],
): boolean {
  return inputVatClaimStatus === 'CLAIMABLE'
    && lines.some((line) => Number(line.vatAmount) !== 0 && (!line.taxSnapshot || !line.taxComponents?.length));
}

/**
 * Spec §19g decision 1: a `VAT_INCLUDED`/`VAT_EXCLUDED` document asserts that VAT applies, so every
 * line needs a rate to record the tax base with. Blank is unknown — distinct from an explicit `0`,
 * which is a zero-rated supply (§19f decision 3) and confirms normally. Without this gate an unread
 * rate is silently recorded as no VAT and the whole gross lands in `taxableAmount`.
 */
export function hasUnknownVatRateLine(
  vatMode: string,
  lines: Array<{ vatRate?: string | null }>,
): boolean {
  if (vatMode !== 'VAT_INCLUDED' && vatMode !== 'VAT_EXCLUDED') return false;
  return lines.some((line) => line.vatRate === null || line.vatRate === undefined || `${line.vatRate}`.trim() === '');
}

/**
 * Plan 13.11.B: "ยังไม่แน่ใจ" is a legitimate draft state, so the confirm block has to name the line
 * to open rather than restate the rule. Same predicate as `hasUnknownVatRateLine` — this only says
 * which line tripped it first.
 */
export function firstUnknownVatRateLineNumber(
  vatMode: string,
  lines: Array<{ lineNumber?: number; vatRate?: string | null }>,
): number | null {
  if (!hasUnknownVatRateLine(vatMode, lines)) return null;
  const index = lines.findIndex((line) => line.vatRate === null || line.vatRate === undefined || `${line.vatRate}`.trim() === '');
  return index < 0 ? null : lines[index]!.lineNumber ?? index + 1;
}

export function hasSelectedTaxCode(line: ExpenseTaxLineFacts): boolean {
  return Boolean(
    line.taxCodeDefinitionId
    || line.externalTaxCode
    || line.taxSnapshot?.taxCodeDefinitionId
    || line.taxSnapshot?.externalTaxCode,
  );
}

export function isDomesticInputTaxLine(line: ExpenseTaxLineFacts): boolean {
  if (!hasSelectedTaxCode(line)) return false;
  const context = line.transactionContext ?? line.taxSnapshot?.taxContext;
  return !context || context === 'DOMESTIC_PURCHASE';
}

export function validateDomesticInputVatEvidence(input: DomesticInputVatEvidenceFacts): string | null {
  const taxLines = input.lines.filter(hasSelectedTaxCode);
  const domesticTaxSelected = input.lines.some(isDomesticInputTaxLine);

  if (input.vatStatus === 'NOT_REGISTERED' && input.inputVatClaimStatus === 'CLAIMABLE') {
    return 'input_vat_not_available_company_not_vat_registered';
  }
  if (input.vatStatus === 'UNKNOWN' && input.inputVatClaimStatus === 'CLAIMABLE') {
    return 'input_vat_company_registration_unanswered';
  }
  // Spec §19h: ABBREVIATED_TAX_INVOICE joins the never-claimable list by document type rather than
  // by evidence status, so a reviewer moving taxEvidenceStatus cannot open the input-VAT path on a
  // document the Revenue Code (s.82/5) bars. Getting the credit means obtaining the full-form
  // invoice — which is a different document, recorded as TAX_INVOICE.
  const receiptOnly = ['RECEIPT', 'SUBSTITUTE_RECEIPT', 'ABBREVIATED_TAX_INVOICE'].includes(input.sourceDocumentType)
    || input.taxEvidenceStatus === 'SUPPORTING_ONLY';

  if (receiptOnly && taxLines.length > 0) {
    return 'A receipt, substitute receipt, or supporting-only document cannot retain a Tax Code.';
  }

  if (!domesticTaxSelected && (taxLines.length > 0 || input.inputVatClaimStatus !== 'CLAIMABLE')) return null;
  if (!CLAIMABLE_INPUT_VAT_DOCUMENT_TYPES.includes(input.sourceDocumentType) || input.taxEvidenceStatus !== 'USABLE_FOR_TAX') {
    return 'Domestic input VAT requires a reviewed TAX_INVOICE with usable tax evidence.';
  }
  if ((!input.primaryAttachmentId && !expenseEvidenceAssessment(input)?.originalDocumentAvailable) || !input.vendorTaxIdSnapshot?.trim() || !input.vendorDocumentNumber?.trim()) {
    return 'Domestic input VAT requires an attached tax invoice, supplier tax ID, and tax invoice number.';
  }
  return null;
}

/** Money comparison at the stored 4dp precision — mirrors the web `hasAiGrandTotalMismatch`. */
function sameMoney(left: string | number, right: string | number): boolean {
  const a = Number(String(left).replace(/,/g, ''));
  const b = Number(String(right).replace(/,/g, ''));
  return Number.isFinite(a) && Number.isFinite(b) && Math.round(a * 10_000) === Math.round(b * 10_000);
}

/** The stored total disagrees with what OCR read off the receipt, beyond satang tolerance. */
export function hasAiGrandTotalMismatch(
  aiVerifiedFieldsJson: Record<string, unknown> | null | undefined,
  grandTotalAmount: string,
): boolean {
  const aiTotal = Number.parseFloat(String(aiVerifiedFieldsJson?.['grandTotalAmount'] ?? '').replace(/,/g, ''));
  const total = Number.parseFloat(String(grandTotalAmount).replace(/,/g, ''));
  return Number.isFinite(aiTotal) && Number.isFinite(total) && Math.abs(total - aiTotal) > 0.05;
}

/** Finance's explicit acceptance of that difference, and only for the figure they accepted. This
 *  deliberately does NOT key off `reviewedAt`: that is a generic "finance last touched this record"
 *  stamp written by every reviewer PATCH — including saves that never looked at an amount, such as
 *  the substitute-receipt draft and the non-expense classification override — so it cannot mean
 *  "accepted the discrepancy". Re-editing the total drops the match and re-arms the gate. */
export function hasAcknowledgedAiTotalMismatch(
  summary: Record<string, unknown> | null | undefined,
  grandTotalAmount: string,
): boolean {
  const resolution = summary?.['totalMismatchResolution'];
  if (!resolution || typeof resolution !== 'object') return false;
  const record = resolution as Record<string, unknown>;
  return record['acknowledged'] === true && sameMoney(String(record['acknowledgedTotalAmount'] ?? ''), grandTotalAmount);
}

/** Spec S1-R4: the AI category suggestion the capture paths persist on the summary. Already
 *  resolved against the company's ACTIVE catalogue when written, so reading it needs no lookup —
 *  bounded here only because the column is JSON that older rows may not carry. */
export function readAiCategorySuggestion(
  summary: Record<string, unknown> | null | undefined,
): { expenseCategoryId: string; confidence: number; categoryName: string } | null {
  const raw = summary?.['categorySuggestion'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const id = value['expenseCategoryId'];
  const confidence = value['confidence'];
  const name = value['categoryName'];
  return typeof id === 'string' && id.length > 0
    && typeof confidence === 'number' && Number.isFinite(confidence)
    && typeof name === 'string'
    ? { expenseCategoryId: id, confidence, categoryName: name }
    : null;
}

export function validateConfirm(input: ConfirmValidationInput): string | null {
  if (!canTransition(input.status, 'CONFIRMED')) {
    return `Cannot confirm expense in status ${input.status}.`;
  }
  // A guess warns; only a person blocks. `POSSIBLE_DUPLICATE` is this system's suspicion, and it
  // fires on the ordinary retail pattern of buying the same thing twice from the same shop on the
  // same day — refusing the confirm there taught people to click past the warning, which is worse
  // than showing it. The candidate rows stay OPEN and visible, so the suspicion is on the record
  // either way. `CONFIRMED_DUPLICATE` is a human having said this IS a duplicate, and confirming
  // what you just called a duplicate is the one combination that stays refused.
  if (input.duplicateStatus === 'CONFIRMED_DUPLICATE') {
    return 'Expense is marked as a duplicate. Clear the duplicate mark before confirming.';
  }
  if (!input.primaryAttachmentId && !input.missingReceiptReason && !input.hasLinkedClaimEvidence && !input.hasReviewedEvidence) {
    return 'Expense requires a receipt attachment or a missing receipt reason.';
  }
  if (!input.hasMissingReceiptPermission && !input.primaryAttachmentId && !input.hasLinkedClaimEvidence && !input.hasReviewedEvidence) {
    return 'Finance permission required to confirm expense without receipt attachment.';
  }
  if (!input.expenseDate) {
    return 'Expense date is required for confirmation.';
  }
  const total = parseFloat(input.grandTotalAmount);
  if (isNaN(total) || total < 0) {
    return 'Grand total amount is invalid.';
  }
  // Audit H-11: zero was allowed through, and the way it arrives is a receipt the AI could not read
  // — the total is left at 0 and the OCR cross-check below has nothing to compare, so it stays
  // silent. That confirmed a ฿0 expense and auto-posted a journal of nothing. CONFIRMED only moves
  // to VOIDED, so there is no later moment to notice. An expense that cost nothing is not a
  // business event; a receipt whose total nobody could establish is the real case, and it should
  // stop here rather than become a zero.
  if (total === 0) {
    return 'Grand total amount must be greater than zero. Enter the amount from the receipt before confirming.';
  }
  // RA-18: confirmation is the last moment the payee's taxpayer class can be captured — CONFIRMED
  // only transitions to VOIDED — and it decides ภ.ง.ด.3 vs ภ.ง.ด.53, so a withholding expense may
  // not be confirmed unclassified. Without this the PND53 fallback would be a permanent misfiling.
  if (parseFloat(input.whtAmount) > 0 && !input.vendorEntityKindSnapshot) {
    return 'Withholding tax requires the payee taxpayer class (บุคคลธรรมดา / นิติบุคคล) before confirmation.';
  }
  // WHT certificate system issuance plan §1.2 (S2): the same last-moment RA-18 rule, for the income
  // category a 50 ทวิ certificate needs. Without it a system-issued certificate would have no
  // ประเภทเงินได้ to print.
  if (parseFloat(input.whtAmount) > 0 && !input.whtCategoryCode) {
    return 'Withholding tax requires the income category (ประเภทเงินได้) before confirmation.';
  }
  if (hasAiGrandTotalMismatch(input.aiVerifiedFieldsJson, input.grandTotalAmount)
    && !hasAcknowledgedAiTotalMismatch(input.aiVerificationSummaryJson, input.grandTotalAmount)) {
    return 'Grand total differs from the receipt OCR total. Finance must acknowledge the difference before confirmation.';
  }
  return null;
}

export function derivePostingStatus(status: ExpenseStatus, duplicateStatus: DuplicateStatus): ExpensePostingStatus {
  if (status === 'CONFIRMED') {
    return duplicateStatus === 'CONFIRMED_DUPLICATE' ? 'not_required' : 'pending';
  }
  return 'not_required';
}

export function buildIdempotencyKey(expenseId: string, eventType: 'confirmed' | 'paid' | 'voided' | 'reversed'): string {
  return `expense:${eventType}:${expenseId}`;
}
