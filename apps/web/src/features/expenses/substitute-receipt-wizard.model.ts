import {
  isNonExpenseClassificationBlocking,
  SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS,
  type SourceDocumentType,
  type SubstituteReceiptApprovalMode,
  type SubstituteReceiptEvidenceStatus,
  type SubstituteReceiptReasonCode,
} from '@watchdog-bms/contracts';

export type WizardStep = 'expense' | 'details' | 'evidence' | 'certify' | 'approve' | 'done';
export type WizardEntryMode = 'existing' | 'new';
export type WizardJourneyStage = 'expense' | 'prepare' | 'sign' | 'done';

/** Alias retained for the form API; its value is the same shared limit enforced by prepare/issue. */
export const MAX_SUBSTITUTE_MANUAL_LINES = SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxExpenseLines;

export type SubstituteManualLineDraft = {
  description: string;
  expenseCategoryId: string;
  quantity: string;
  unitPrice: string;
};

export type ManualLinesReadiness = {
  ready: boolean;
  missingCount: number;
  invalidLineIndexes: number[];
};

const DECIMAL_18_4 = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;
const MAX_DECIMAL_18_4 = 99_999_999_999_999.9999;

export type WizardReadiness<T extends string> = {
  ready: boolean;
  missing: T[];
  missingCount: number;
};

export type DetailsReadinessIssue =
  | 'payeeName'
  | 'payeeAddress'
  | 'payeeTaxId'
  | 'missingReason'
  | 'businessPurpose'
  | 'payer'
  | 'paymentDate';

export type EvidenceReadinessIssue = 'policy' | 'supportingEvidence' | 'paymentEvidence' | 'renderability';
export type SubstituteReceiptRenderabilityIssue = 'too_many_lines' | 'line_description_too_long';
export type SubstituteReceiptEvidenceRenderabilityIssue = 'too_many_evidence' | 'evidence_filename_too_long';
export type SigningReadinessIssue = 'position' | 'preview' | 'signature' | 'acknowledgement';

export type PayeeIdentityIssue =
  | 'payee_name_required'
  | 'payee_name_too_long'
  | 'payee_address_too_long'
  | 'payee_tax_id_13';

export type PayeeIdentityIssues = Partial<Record<'payeeName' | 'payeeAddress' | 'payeeTaxId', PayeeIdentityIssue>>;

const JOURNEY_STAGE_BY_STEP: Record<WizardStep, WizardJourneyStage> = {
  expense: 'expense',
  details: 'prepare',
  evidence: 'prepare',
  certify: 'sign',
  approve: 'sign',
  done: 'done',
};

const INELIGIBLE_CLASSIFICATION_KINDS = new Set([
  'ORDER_OR_CHECK_BILL', 'QUOTATION', 'PURCHASE_ORDER', 'DELIVERY_NOTE', 'APPOINTMENT_CARD',
  'BOOKING_CONFIRMATION', 'RESERVATION_CONFIRMATION', 'SIGNATURE_IMAGE', 'OTHER_BUSINESS_DOCUMENT',
  'NON_FINANCIAL_IMAGE', 'NEEDS_REVIEW',
]);

function readiness<T extends string>(missing: T[]): WizardReadiness<T> {
  return { ready: missing.length === 0, missing, missingCount: missing.length };
}

export function resolveWizardEntryMode(input: {
  initialExpenseId?: string | null;
  candidateCount: number;
}): WizardEntryMode {
  return input.initialExpenseId?.trim() || input.candidateCount > 0 ? 'existing' : 'new';
}

export function wizardJourneyStage(step: WizardStep): WizardJourneyStage {
  return JOURNEY_STAGE_BY_STEP[step];
}

export function isManualLineDecimal(value: string): boolean {
  return DECIMAL_18_4.test(value.trim());
}

export function manualLineAmount(line: Pick<SubstituteManualLineDraft, 'quantity' | 'unitPrice'>): number {
  if (!isManualLineDecimal(line.quantity) || !isManualLineDecimal(line.unitPrice)) return 0;
  const quantity = Number(line.quantity);
  const unitPrice = Number(line.unitPrice);
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || quantity <= 0 || unitPrice <= 0) return 0;
  const amount = Math.round(quantity * unitPrice * 100) / 100;
  return Number.isFinite(amount) && amount >= 0.01 && amount <= MAX_DECIMAL_18_4 ? amount : 0;
}

export function manualLinesTotal(lines: SubstituteManualLineDraft[]): number {
  return Math.round(lines.reduce((total, line) => total + manualLineAmount(line), 0) * 100) / 100;
}

export function evaluateManualLinesReadiness(lines: SubstituteManualLineDraft[]): ManualLinesReadiness {
  let missingCount = 0;
  const invalidLineIndexes: number[] = [];
  if (lines.length === 0 || lines.length > MAX_SUBSTITUTE_MANUAL_LINES) {
    return { ready: false, missingCount: 1, invalidLineIndexes: [] };
  }
  lines.forEach((line, index) => {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    const missingOnLine = [
      Boolean(line.description.trim())
        && line.description.trim().length <= SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength,
      Boolean(line.expenseCategoryId.trim()),
      isManualLineDecimal(line.quantity) && Number.isFinite(quantity) && quantity > 0,
      isManualLineDecimal(line.unitPrice) && Number.isFinite(unitPrice) && unitPrice > 0 && manualLineAmount(line) > 0,
    ].filter((complete) => !complete).length;
    if (missingOnLine > 0) invalidLineIndexes.push(index);
    missingCount += missingOnLine;
  });
  return { ready: missingCount === 0, missingCount, invalidLineIndexes };
}

/** Mirrors the prepare endpoint blockers that the wizard itself cannot repair. Tax/source NEEDS_REVIEW
 * stays eligible because continueFromExpense intentionally reviews it into SUPPORTING_ONLY +
 * EXPENSE_NOTE_TEXT before prepare. */
type SubstituteReceiptCandidateInput = {
  currency: string;
  grandTotalAmount: string;
  sourceDocumentType: SourceDocumentType;
  taxEvidenceStatus: string;
  expenseCategoryId: string | null;
  accountHintKey: string | null;
  aiVerificationSummaryJson: Record<string, unknown> | null;
  lines: Array<{ description: string; expenseCategoryId: string | null; accountHintKey: string | null }>;
};

export function substituteReceiptRenderabilityIssue(
  input: Pick<SubstituteReceiptCandidateInput, 'lines'>,
): SubstituteReceiptRenderabilityIssue | null {
  if (input.lines.length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxExpenseLines) return 'too_many_lines';
  if (input.lines.some((line) => line.description.trim().length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength)) {
    return 'line_description_too_long';
  }
  return null;
}

/** Base business eligibility is exported so the picker can keep an otherwise-valid over-limit
 * expense visible with an actionable warning instead of making it disappear without explanation. */
export function isSubstituteReceiptCandidateOtherwiseEligible(input: SubstituteReceiptCandidateInput): boolean {
  if (input.sourceDocumentType === 'SUBSTITUTE_RECEIPT') return false;
  if (input.currency !== 'THB' || !(Number(input.grandTotalAmount) > 0)) return false;
  if (input.taxEvidenceStatus === 'USABLE_FOR_TAX') return false;
  if (!input.lines.length || input.lines.some((line) => !line.description.trim())) return false;
  const hasReviewedCategory = Boolean(input.expenseCategoryId || input.accountHintKey)
    || input.lines.every((line) => Boolean(line.expenseCategoryId || line.accountHintKey));
  if (!hasReviewedCategory || isNonExpenseClassificationBlocking(input.aiVerificationSummaryJson)) return false;
  const classification = input.aiVerificationSummaryJson?.['classification'];
  const rawKind = classification && typeof classification === 'object' && !Array.isArray(classification)
    ? (classification as Record<string, unknown>)['documentKind']
    : null;
  return typeof rawKind !== 'string' || !INELIGIBLE_CLASSIFICATION_KINDS.has(rawKind);
}

export function isSubstituteReceiptCandidateEligible(input: SubstituteReceiptCandidateInput): boolean {
  return isSubstituteReceiptCandidateOtherwiseEligible(input) && substituteReceiptRenderabilityIssue(input) === null;
}

export const CANDIDATE_PAGE_SIZE = 5;

export type CandidateSortKey = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

/** Client-side sort + page for the picker: the candidate set is already bounded by the
 * detail-lookup cap, so ordering and slicing here costs nothing and keeps one source of
 * truth for the page clamp (a search that shrinks the list pulls the page back in range). */
export function sortAndPageCandidates<T extends { expenseDate: string; grandTotalAmount: string }>(
  items: readonly T[],
  sort: CandidateSortKey,
  page: number,
  pageSize = CANDIDATE_PAGE_SIZE,
): { rows: T[]; totalPages: number; page: number } {
  const sorted = [...items].sort((a, b) => {
    switch (sort) {
      case 'date_asc': return a.expenseDate.localeCompare(b.expenseDate);
      case 'amount_desc': return Number(b.grandTotalAmount) - Number(a.grandTotalAmount);
      case 'amount_asc': return Number(a.grandTotalAmount) - Number(b.grandTotalAmount);
      default: return b.expenseDate.localeCompare(a.expenseDate);
    }
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clamped = Math.min(Math.max(1, page), totalPages);
  return { rows: sorted.slice((clamped - 1) * pageSize, clamped * pageSize), totalPages, page: clamped };
}

export function substituteReceiptEvidenceRenderabilityIssue(
  evidence: ReadonlyArray<{ id: string; originalFileName: string }>,
): SubstituteReceiptEvidenceRenderabilityIssue | null {
  const uniqueEvidence = [...new Map(evidence.map((item) => [item.id, item])).values()];
  if (uniqueEvidence.length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments) return 'too_many_evidence';
  if (uniqueEvidence.some((item) => item.originalFileName.trim().length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceFileNameLength)) {
    return 'evidence_filename_too_long';
  }
  return null;
}

export function defaultSubstituteReceiptReason(sourceDocumentType: SourceDocumentType): SubstituteReceiptReasonCode {
  return sourceDocumentType === 'RECEIPT' || sourceDocumentType === 'TAX_INVOICE'
    ? 'RECEIPT_UNAVAILABLE'
    : 'PAYEE_CANNOT_ISSUE';
}

export function payeeTaxIdDigits(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

export function validatePayeeIdentity(input: {
  payeeName: string;
  payeeAddress: string;
  payeeTaxId: string;
  vendorNameSnapshot: string | null | undefined;
}): PayeeIdentityIssues {
  const issues: PayeeIdentityIssues = {};
  const name = input.payeeName.trim();
  // The wizard renders payee name as an explicit required field. It is prefilled from
  // vendorNameSnapshot, but clearing that visible value must not silently fall back to
  // a hidden snapshot in the generated document.
  if (!name) issues.payeeName = 'payee_name_required';
  else if (name.length > 200) issues.payeeName = 'payee_name_too_long';
  if (input.payeeAddress.trim().length > 300) issues.payeeAddress = 'payee_address_too_long';
  if (input.payeeTaxId.trim() && payeeTaxIdDigits(input.payeeTaxId).length !== 13) {
    issues.payeeTaxId = 'payee_tax_id_13';
  }
  return issues;
}

export function evaluateDetailsReadiness(input: {
  payeeName: string;
  payeeAddress: string;
  payeeTaxId: string;
  vendorNameSnapshot: string | null | undefined;
  missingReason: string;
  businessPurpose: string;
  payerId: string;
  payerEligible: boolean;
  paymentDate: string;
}): WizardReadiness<DetailsReadinessIssue> {
  const identityIssues = validatePayeeIdentity(input);
  const missing: DetailsReadinessIssue[] = [];
  if (identityIssues.payeeName) missing.push('payeeName');
  if (identityIssues.payeeAddress) missing.push('payeeAddress');
  if (identityIssues.payeeTaxId) missing.push('payeeTaxId');
  if (!input.missingReason.trim()) missing.push('missingReason');
  if (!input.businessPurpose.trim()) missing.push('businessPurpose');
  if (!input.payerId.trim() || !input.payerEligible) missing.push('payer');
  if (!input.paymentDate.trim()) missing.push('paymentDate');
  return readiness(missing);
}

export function evaluateEvidenceReadiness(input: {
  policyReady: boolean;
  supportingCount: number;
  paymentCount: number;
  requiresPaymentEvidence: boolean;
  renderabilityIssue?: SubstituteReceiptEvidenceRenderabilityIssue | null;
}): WizardReadiness<EvidenceReadinessIssue> {
  const missing: EvidenceReadinessIssue[] = [];
  if (!input.policyReady) missing.push('policy');
  if (input.supportingCount <= 0) missing.push('supportingEvidence');
  if (input.requiresPaymentEvidence && input.paymentCount <= 0) missing.push('paymentEvidence');
  if (input.renderabilityIssue) missing.push('renderability');
  return readiness(missing);
}

export function evaluateSigningReadiness(input: {
  position: string;
  previewed: boolean;
  signatureReady: boolean;
  acknowledged: boolean;
}): WizardReadiness<SigningReadinessIssue> {
  const missing: SigningReadinessIssue[] = [];
  if (!input.position.trim()) missing.push('position');
  if (!input.previewed) missing.push('preview');
  if (!input.signatureReady) missing.push('signature');
  if (!input.acknowledged) missing.push('acknowledgement');
  return readiness(missing);
}

/**
 * Owner decision 2026-08-10: mirrors the server's SELF_APPROVAL_EXEMPT_ROLES
 * (procurement.logic) — under the OWNER_SELF policy these roles may approve a
 * certificate they paid themselves. DESIGNATED_APPROVERS stays strict.
 */
export const SELF_APPROVAL_EXEMPT_ROLES = ['OWNER', 'ADMIN', 'MANAGER'] as const;

export function hasSelfApprovalExemptRole(roles: readonly string[] | undefined): boolean {
  return (roles ?? []).some((role) => (SELF_APPROVAL_EXEMPT_ROLES as readonly string[]).includes(role));
}

export function mayApproveSubstituteReceipt(input: {
  userId: string;
  payerUserId: string;
  canConfirm: boolean;
  canSelfApprove: boolean;
  approvalMode: SubstituteReceiptApprovalMode | null | undefined;
}): boolean {
  return input.canConfirm
    && (input.payerUserId !== input.userId
      || (input.approvalMode === 'OWNER_SELF' && input.canSelfApprove));
}

export function resolveWizardStep(
  evidence: { status: SubstituteReceiptEvidenceStatus } | null,
): WizardStep {
  if (!evidence) return 'expense';
  if (evidence.status === 'PREPARED') return 'certify';
  if (evidence.status === 'PAYER_CERTIFIED') return 'approve';
  return 'done';
}
