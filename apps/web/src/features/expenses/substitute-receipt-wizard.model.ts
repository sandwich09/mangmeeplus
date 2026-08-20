import {
  isNonExpenseClassificationBlocking,
  SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS,
  type ExpensePaymentMethod,
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

/**
 * A LINE text-note capture stamps `missingReceiptReason` with a MARKER so the evidence-gap rules read
 * "no file, reason recorded". It is never the payer's answer, and this certificate prints that field
 * verbatim — so a marker seeded into the form is a statutory document whose stated reason is a system
 * note. The field must come up EMPTY and be typed by the payer.
 *
 * SOURCE OF TRUTH: `apps/api/src/modules/expenses/domain/logic/expense-document.logic.ts`
 * (`LINE_TEXT_NOTE_MISSING_RECEIPT_MARKER`, `isAutoMissingReceiptReason`). Replicated rather than
 * imported because nothing in `apps/web` imports API-side domain logic, and these two sentences are
 * stored values that existing rows already carry — they can be added to, never rewritten.
 */
const AUTO_MISSING_RECEIPT_REASONS: readonly string[] = [
  'บันทึกค่าใช้จ่ายจากข้อความใน LINE ยังไม่ได้แนบไฟล์หลักฐาน',
  /* Rows captured before the marker was Thai still carry this exact sentence. */
  'LINE text-only expense note; evidence file not attached',
];

export function isAutoMissingReceiptReason(value: string | null | undefined): boolean {
  return AUTO_MISSING_RECEIPT_REASONS.includes(value?.trim() ?? '');
}

/** The stored reason as a FORM VALUE: a marker is not an answer, so it seeds an empty field. */
export function payerWrittenMissingReason(value: string | null | undefined): string {
  return isAutoMissingReceiptReason(value) ? '' : value ?? '';
}

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

export type EvidenceReadinessIssue = 'policy' | 'paymentEvidence' | 'renderability';
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

/** R5: a substitute receipt is valid with no attachment at all, so supporting files are asked for
 *  but never gate prepare. Payment evidence still follows the payment method and company policy. */
export function evaluateEvidenceReadiness(input: {
  policyReady: boolean;
  paymentCount: number;
  requiresPaymentEvidence: boolean;
  renderabilityIssue?: SubstituteReceiptEvidenceRenderabilityIssue | null;
}): WizardReadiness<EvidenceReadinessIssue> {
  const missing: EvidenceReadinessIssue[] = [];
  if (!input.policyReady) missing.push('policy');
  if (input.requiresPaymentEvidence && input.paymentCount <= 0) missing.push('paymentEvidence');
  if (input.renderabilityIssue) missing.push('renderability');
  return readiness(missing);
}

/** R9: a saved ACTIVE personal signature signs any certificate, and a freshly drawn or uploaded
 *  one still wins for the certificate being signed. */
export function resolveWizardSignatureSource(input: {
  hasReusableSignature: boolean;
  /** A file is chosen or drawn but its transparent version has not been produced yet. */
  chosenFile: boolean;
  /** The reviewed transparent file that would be uploaded for this certificate. */
  preparedFile: boolean;
}): 'evidence_upload' | 'signature_library' | 'none' {
  if (input.preparedFile) return 'evidence_upload';
  // Blocks exactly as it did before the library existed: someone who picked a file meant to sign
  // with THAT file, and must never have the saved image substituted behind their back.
  if (input.chosenFile) return 'none';
  return input.hasReusableSignature ? 'signature_library' : 'none';
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

/**
 * Whose turn it is once evidence exists. The payer and the approver are usually different people,
 * so "not ready yet" and "not your turn" are separate answers and the screen must not collapse
 * them into one dead button.
 */
export type SubstituteTurn = {
  stage: 'certify' | 'approve' | 'done';
  /** The signed-in user is the one the stage is waiting for. */
  mine: boolean;
  waitingFor: 'payer' | 'approver' | null;
};

export function resolveSubstituteTurn(input: {
  status: SubstituteReceiptEvidenceStatus;
  payerUserId: string;
  userId: string;
  mayApprove: boolean;
}): SubstituteTurn {
  if (input.status === 'PREPARED') {
    const mine = input.payerUserId === input.userId;
    return { stage: 'certify', mine, waitingFor: mine ? null : 'payer' };
  }
  if (input.status === 'PAYER_CERTIFIED') {
    return { stage: 'approve', mine: input.mayApprove, waitingFor: input.mayApprove ? null : 'approver' };
  }
  return { stage: 'done', mine: true, waitingFor: null };
}

/**
 * W2: prepare blockers that live on the EXPENSE, not on any wizard field. The server refuses one
 * at a time at the final click and the wizard has no control for either, so they are surfaced as
 * their own readiness items — with a link to the expense — before anything is typed.
 */
export type ExpensePrerequisiteIssue = 'reviewedAmount' | 'reviewedCategory' | 'renderability';

export function evaluateExpensePrerequisites(expense: {
  grandTotalAmount: string;
  expenseCategoryId: string | null;
  accountHintKey: string | null;
  lines: Array<{ description: string; expenseCategoryId: string | null; accountHintKey: string | null }>;
}): WizardReadiness<ExpensePrerequisiteIssue> {
  const missing: ExpensePrerequisiteIssue[] = [];
  if (!(Number(expense.grandTotalAmount) > 0)) missing.push('reviewedAmount');
  const hasReviewedCategory = Boolean(expense.expenseCategoryId || expense.accountHintKey)
    || (expense.lines.length > 0 && expense.lines.every((line) => Boolean(line.expenseCategoryId || line.accountHintKey)));
  if (!hasReviewedCategory) missing.push('reviewedCategory');
  if (substituteReceiptRenderabilityIssue(expense)) missing.push('renderability');
  return readiness(missing);
}

// ── W1: pre-prepare draft persistence ────────────────────────────────────────
// Everything typed before prepare lived in component state only, so F5 or Back emptied the form
// with no warning. After prepare the server status already resumes the wizard, so only these three
// steps need saving — and the saved copy is dropped the moment the evidence exists.

export const SUBSTITUTE_WIZARD_DRAFT_VERSION = 1;

export type SubstituteWizardDraftStep = Extract<WizardStep, 'expense' | 'details' | 'evidence'>;

export type SubstituteWizardDraft = {
  step: SubstituteWizardDraftStep;
  consent: boolean;
  reasonCode: SubstituteReceiptReasonCode;
  missingReason: string;
  businessPurpose: string;
  payeeName: string;
  payeeAddress: string;
  payeeTaxId: string;
  payerId: string;
  paymentMethod: ExpensePaymentMethod;
  paymentDate: string;
  supportingIds: string[];
  paymentIds: string[];
};

type DraftStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const DRAFT_STEPS: readonly SubstituteWizardDraftStep[] = ['expense', 'details', 'evidence'];
const DRAFT_REASON_CODES: readonly SubstituteReceiptReasonCode[] = [
  'PAYEE_CANNOT_ISSUE', 'RECEIPT_UNAVAILABLE', 'RECEIPT_MATERIALLY_INCOMPLETE', 'OTHER',
];
const DRAFT_PAYMENT_METHODS: readonly ExpensePaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'];

/** Scoped by company, expense AND signed-in user. Sign-out is a same-tab navigation, so without the
  * user in the key the next person to sign in on this tab opens the same wizard onto the previous
  * one's unsent reason, business purpose and payee identity — and can certify a statutory document
  * carrying someone else's words. `\0` cannot occur in an id, so the three parts can never blur. */
export function substituteWizardDraftKey(companyId: string, expenseId: string, userId: string): string {
  return `watchdog.substitute-wizard.draft.${companyId}\0${expenseId}\0${userId}`;
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function idListField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * The stored payload repeats its own scope, so a key collision (or a hand-edited store) still
 * cannot hand one expense the other's answers — or one person the other's — because the scope is
 * checked, not assumed. The author is part of that scope: an envelope written by someone else is
 * refused even when it is sitting under the expected key.
 */
export function parseSubstituteWizardDraft(
  raw: string | null | undefined,
  scope: { companyId: string; expenseId: string; userId: string },
): SubstituteWizardDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const envelope = parsed as Record<string, unknown>;
  if (envelope['v'] !== SUBSTITUTE_WIZARD_DRAFT_VERSION) return null;
  if (envelope['companyId'] !== scope.companyId || envelope['expenseId'] !== scope.expenseId) return null;
  if (envelope['userId'] !== scope.userId) return null;
  const draft = envelope['draft'];
  if (!draft || typeof draft !== 'object') return null;
  const values = draft as Record<string, unknown>;
  const step = DRAFT_STEPS.find((candidate) => candidate === values['step']);
  if (!step) return null;
  return {
    step,
    consent: values['consent'] === true,
    reasonCode: DRAFT_REASON_CODES.find((code) => code === values['reasonCode']) ?? 'PAYEE_CANNOT_ISSUE',
    missingReason: textField(values['missingReason']),
    businessPurpose: textField(values['businessPurpose']),
    payeeName: textField(values['payeeName']),
    payeeAddress: textField(values['payeeAddress']),
    payeeTaxId: textField(values['payeeTaxId']),
    payerId: textField(values['payerId']),
    paymentMethod: DRAFT_PAYMENT_METHODS.find((method) => method === values['paymentMethod']) ?? 'CASH',
    paymentDate: textField(values['paymentDate']),
    supportingIds: idListField(values['supportingIds']),
    paymentIds: idListField(values['paymentIds']),
  };
}

export function readSubstituteWizardDraft(
  storage: DraftStorage | null | undefined,
  companyId: string,
  expenseId: string,
  userId: string,
): SubstituteWizardDraft | null {
  try {
    return parseSubstituteWizardDraft(
      storage?.getItem(substituteWizardDraftKey(companyId, expenseId, userId)),
      { companyId, expenseId, userId },
    );
  } catch { return null; }
}

export function writeSubstituteWizardDraft(
  storage: DraftStorage | null | undefined,
  companyId: string,
  expenseId: string,
  userId: string,
  draft: SubstituteWizardDraft,
): void {
  try {
    storage?.setItem(
      substituteWizardDraftKey(companyId, expenseId, userId),
      JSON.stringify({ v: SUBSTITUTE_WIZARD_DRAFT_VERSION, companyId, expenseId, userId, draft }),
    );
  } catch { /* private mode or a full quota must never break the wizard */ }
}

export function clearSubstituteWizardDraft(
  storage: DraftStorage | null | undefined,
  companyId: string,
  expenseId: string,
  userId: string,
): void {
  try { storage?.removeItem(substituteWizardDraftKey(companyId, expenseId, userId)); }
  catch { /* see writeSubstituteWizardDraft */ }
}
