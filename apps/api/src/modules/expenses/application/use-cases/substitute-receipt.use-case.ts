import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS } from '@watchdog-bms/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../../../audit/application/audit.service';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { ObjectVersionCleanupService } from '../../../data-model-core/application/services/object-version-cleanup.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { normalizeTaxId } from '../../../data-model-core/domain/logic/company-legal-identity.logic';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import {
  expenseDecimalToString,
  PrismaExpenseRepository,
  SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON,
  toSubstituteEvidenceSummary,
} from '../../infrastructure/prisma-expense.repository';
import {
  buildSubstituteCertificationText,
  canonicalSnapshotHash,
  renderSubstituteReceiptAttestationSvg,
  renderSubstituteReceiptSvg,
  type SubstituteReceiptSnapshot,
} from '../../domain/logic/substitute-receipt.logic';
import { hasBlockingNonExpenseClassification } from '../../domain/logic/expense-status.logic';
import { renderSubstituteReceiptPaperArtifactPdf, renderSubstituteReceiptPdf } from '../../domain/logic/substitute-receipt-pdf.logic';
import { renderPaymentVoucherSvg } from '../../domain/logic/payment-voucher.logic';
import type { ExpenseRecordWithRelations, SubstituteReceiptEvidenceRecord } from '../../domain/models/expense.model';
import { GetExpenseUseCase } from './expense-draft.use-case';
import { SELF_APPROVAL_EXEMPT_ROLES } from '../../../procurement/domain/logic/procurement.logic';

// Owner decision 2026-08-10: the OWNER/ADMIN/MANAGER self-approval exemption applies to every
// approval workflow, substitute receipts included. Under the OWNER_SELF policy those roles may
// approve a certificate they paid themselves (audited); DESIGNATED_APPROVERS keeps the
// configured separation of duties untouched.
function selfApprovalPermitted(approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS', roles: readonly string[]): boolean {
  return approvalMode === 'OWNER_SELF' && roles.some((role) => SELF_APPROVAL_EXEMPT_ROLES.includes(role));
}

import type {
  ApproveSubstituteReceiptInput,
  CertifySubstituteReceiptInput,
  GenerateSubstituteReceiptInput,
  RequestContext,
  SubstituteReceiptEvidenceSummary,
  SubstituteReceiptEvidenceStatus,
  SubstituteReceiptListFilter,
  SubstituteReceiptListResult,
  SupersedeSubstituteReceiptInput,
} from '@watchdog-bms/contracts';

const REASON_CODES = new Set(['PAYEE_CANNOT_ISSUE', 'RECEIPT_UNAVAILABLE', 'RECEIPT_MATERIALLY_INCOMPLETE', 'OTHER']);
const ALWAYS_INELIGIBLE_SOURCE_TYPES = new Set(['SUBSTITUTE_RECEIPT', 'NEEDS_REVIEW']);
const INELIGIBLE_CLASSIFICATION_KINDS = new Set([
  'ORDER_OR_CHECK_BILL', 'QUOTATION', 'PURCHASE_ORDER', 'DELIVERY_NOTE', 'APPOINTMENT_CARD',
  'BOOKING_CONFIRMATION', 'RESERVATION_CONFIRMATION', 'SIGNATURE_IMAGE', 'OTHER_BUSINESS_DOCUMENT',
  'NON_FINANCIAL_IMAGE', 'NEEDS_REVIEW',
]);
const PREVIEW_CERTIFIED_AT = '0000-01-01T00:00:00.000Z';
/** The payer picks their position when they certify, so the printed form leaves a rule for it. */
const UNSIGNED_FORM_POSITION_BLANK = '__________';
const SUBSTITUTE_RECEIPT_STATUSES = new Set<SubstituteReceiptEvidenceStatus>([
  'PREPARED', 'PAYER_CERTIFIED', 'ISSUED', 'SUPERSEDED',
]);

function assertWeb(ctx: RequestContext): void {
  if (ctx.authProvider === 'line') throw new ForbiddenException('Substitute receipt certification is available on the authenticated web only.');
}

function assertBranch(ctx: RequestContext, branchId: string | null): void {
  if (!isBranchInScope(ctx.scopes ?? {}, branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${field} is required.`);
  const text = value.trim();
  if (text.length > max) throw new BadRequestException(`${field} must be at most ${max} characters.`);
  return text;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException(`${field} must be text.`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new BadRequestException(`${field} must be at most ${max} characters.`);
  return text;
}

function optionalPayeeTaxId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException('payeeTaxId must be text.');
  if (!value.trim()) return null;
  const digits = normalizeTaxId(value);
  if (digits.length !== 13) throw new BadRequestException('payeeTaxId must contain exactly 13 digits.');
  return digits;
}

function parseExpectedDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} must be a valid ISO date.`);
  return parsed;
}

function renderabilityError(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

function assertSubstituteReceiptLinesRenderable(lines: ReadonlyArray<{ description: string }>): void {
  if (lines.length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxExpenseLines) {
    throw renderabilityError(
      'substitute_receipt_too_many_lines',
      `A substitute receipt supports at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxExpenseLines} expense lines.`,
    );
  }
  if (lines.some((line) => line.description.trim().length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength)) {
    throw renderabilityError(
      'substitute_receipt_line_description_too_long',
      `Each substitute-receipt expense description must be at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength} characters.`,
    );
  }
}

function assertSubstituteReceiptEvidenceRenderable(
  evidence: ReadonlyArray<{ originalFileName: string }>,
): void {
  if (evidence.length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments) {
    throw renderabilityError(
      'substitute_receipt_too_many_evidence',
      `A substitute receipt supports at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments} linked evidence files.`,
    );
  }
  if (evidence.some((item) => item.originalFileName.trim().length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceFileNameLength)) {
    throw renderabilityError(
      'substitute_receipt_evidence_filename_too_long',
      `Each linked evidence file name must be at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceFileNameLength} characters.`,
    );
  }
}

function assertSubstituteReceiptSnapshotRenderable(snapshot: SubstituteReceiptSnapshot): void {
  assertSubstituteReceiptLinesRenderable(snapshot.expense.lines);
  assertSubstituteReceiptEvidenceRenderable(snapshot.evidence);
}

export type SubstituteReceiptEligibilityIssue = { code: string; message: string };

/** All target-level eligibility failures knowable from one current expense snapshot. */
export function collectSubstituteReceiptEligibilityIssues(
  expense: ExpenseRecordWithRelations,
  reasonCode?: string,
): SubstituteReceiptEligibilityIssue[] {
  const issues: SubstituteReceiptEligibilityIssue[] = [];
  if (!['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status)) {
    issues.push({ code: 'expense_status_ineligible', message: `Cannot prepare substitute evidence in status ${expense.status}.` });
  }
  if (ALWAYS_INELIGIBLE_SOURCE_TYPES.has(expense.sourceDocumentType)) {
    issues.push({ code: 'source_type_ineligible', message: 'Legacy substitute markers and unreviewed source types are not eligible.' });
  }
  if (['RECEIPT', 'TAX_INVOICE'].includes(expense.sourceDocumentType)
    && !['RECEIPT_UNAVAILABLE', 'RECEIPT_MATERIALLY_INCOMPLETE'].includes(reasonCode ?? '')) {
    issues.push({ code: 'valid_receipt_normal_path', message: 'A receipt or tax invoice is eligible only when it is unavailable or materially incomplete; a valid document must use the normal path.' });
  }
  if (hasBlockingNonExpenseClassification(expense.aiVerificationSummaryJson)) {
    issues.push({ code: 'classification_ineligible', message: 'Quotation, order-only, appointment, booking, reservation, non-business, unreadable, or ambiguous images are not eligible.' });
  }
  const classification = expense.aiVerificationSummaryJson?.['classification'];
  const rawDocumentKind = classification && typeof classification === 'object'
    ? (classification as Record<string, unknown>)['documentKind']
    : null;
  if (typeof rawDocumentKind === 'string' && INELIGIBLE_CLASSIFICATION_KINDS.has(rawDocumentKind)) {
    issues.push({ code: 'document_kind_ineligible', message: 'A finance override does not make a quotation, order, appointment, booking, reservation, or non-expense image eligible for substitute evidence.' });
  }
  if (expense.currency !== 'THB') issues.push({ code: 'currency_not_supported', message: 'ใบรับรองแทนใบเสร็จรับเงิน currently supports THB expenses only.' });
  if (!(Number(expense.grandTotalAmount) > 0)) issues.push({ code: 'reviewed_total_required', message: 'A positive reviewed total is required.' });
  if (!expense.lines.length || expense.lines.some((line) => !line.description.trim())) {
    issues.push({ code: 'reviewed_items_required', message: 'Reviewed expense item details are required.' });
  }
  if (expense.lines.length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxExpenseLines) {
    issues.push({ code: 'substitute_receipt_too_many_lines', message: `A substitute receipt supports at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxExpenseLines} expense lines.` });
  }
  if (expense.lines.some((line) => line.description.trim().length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength)) {
    issues.push({ code: 'substitute_receipt_line_description_too_long', message: `Each substitute-receipt expense description must be at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength} characters.` });
  }
  if (!expense.expenseCategoryId && !expense.accountHintKey && expense.lines.some((line) => !line.expenseCategoryId && !line.accountHintKey)) {
    issues.push({ code: 'reviewed_category_required', message: 'A reviewed expense category or account hint is required.' });
  }
  if (expense.taxEvidenceStatus === 'NEEDS_REVIEW') {
    issues.push({ code: 'tax_evidence_review_required', message: 'Tax evidence status must be reviewed first.' });
  }
  if (expense.taxEvidenceStatus === 'USABLE_FOR_TAX') {
    issues.push({ code: 'tax_evidence_nonclaimable', message: 'Internal substitute evidence cannot preserve input VAT. Set it to supporting/non-claimable or request an issuer-created replacement tax invoice.' });
  }
  return issues;
}

function validateEligibility(expense: ExpenseRecordWithRelations, reasonCode?: string): void {
  const issue = collectSubstituteReceiptEligibilityIssues(expense, reasonCode)[0];
  if (!issue) return;
  if (issue.code === 'substitute_receipt_too_many_lines' || issue.code === 'substitute_receipt_line_description_too_long') {
    throw renderabilityError(issue.code, issue.message);
  }
  throw new BadRequestException(issue.message);
}

async function buildSnapshot(
  repo: PrismaExpenseRepository,
  companyId: string,
  expense: ExpenseRecordWithRelations,
  evidence: SubstituteReceiptEvidenceRecord,
  payerPosition: string,
  certifiedAt: string,
): Promise<SubstituteReceiptSnapshot> {
  const linkedIds = [...new Set([...evidence.paymentEvidenceAttachmentIds, ...evidence.supportingAttachmentIds])];
  const refs = await repo.findSubstituteEvidenceAttachments(companyId, expense.id, linkedIds);
  if (refs.length !== linkedIds.length) throw new ConflictException('Linked source/payment evidence changed. Finance must prepare a new version.');
  assertSubstituteReceiptEvidenceRenderable(refs);
  const company = await repo.getSubstituteCompanyContext(companyId, expense.branchId);
  return {
    documentNumber: evidence.documentNumber,
    version: evidence.version,
    company,
    expense: {
      id: expense.id,
      expenseNumber: expense.expenseNumber,
      expenseDate: expense.expenseDate.toISOString(),
      paymentDate: (evidence.paymentDate ?? expense.paidAt)?.toISOString() ?? null,
      currency: expense.currency,
      grandTotalAmount: expense.grandTotalAmount,
      paymentMethod: evidence.paymentMethod ?? expense.paymentMethod,
      paymentReference: expense.bankAccountRef,
      category: expense.expenseCategoryId ?? expense.accountHintKey,
      businessPurpose: evidence.businessPurpose,
      lines: expense.lines.map((line) => ({ description: line.description, quantity: line.quantity, amount: line.lineTotalAmount })),
    },
    originalSourceDocumentType: evidence.originalSourceDocumentType,
    reasonCode: evidence.reasonCode,
    missingReceiptReason: evidence.missingReceiptReason,
    payee: {
      name: evidence.payeeName ?? expense.vendorNameSnapshot ?? '',
      address: evidence.payeeAddress,
      taxId: evidence.payeeTaxId,
    },
    payer: { userId: evidence.payerUserId, name: evidence.payerName, position: payerPosition, certifiedAt },
    certificationText: buildSubstituteCertificationText(evidence.payerName, payerPosition),
    evidence: refs,
    note: evidence.note,
  };
}

/**
 * R11: `PAPER` means the signatures exist only on the linked scan, so certification and approval
 * resolve no signature image and embed none. Returns the scan's checksum — the value the attestation
 * page prints and the only thing that makes a paper-route evidence signable at all — or `undefined`
 * for the unchanged digital route. A `PAPER` row without its scan is a broken state, not a route.
 */
function paperRouteScanChecksum(evidence: SubstituteReceiptEvidenceRecord): string | undefined {
  if (evidence.signatureMode !== 'PAPER') return undefined;
  if (!evidence.wetSignedScanAttachmentId || !evidence.wetSignedScanChecksumSha256) {
    throw new ConflictException('The hand-signed scan is missing from this paper-route substitute receipt.');
  }
  return evidence.wetSignedScanChecksumSha256;
}

function assertPreparedExpenseUnchanged(expense: ExpenseRecordWithRelations, evidence: SubstituteReceiptEvidenceRecord): void {
  if (expense.updatedAt.getTime() !== evidence.expenseUpdatedAtAtPreparation.getTime()) {
    throw new ConflictException('Expense details changed after preparation. Finance must prepare a new version.');
  }
}

function isEligibleSubstituteReceiptApprover(
  userId: string,
  approvalMode: 'OWNER_SELF' | 'DESIGNATED_APPROVERS',
  configuredApproverUserIds: string[] | undefined,
  eligibleApproverIds: ReadonlySet<string>,
): boolean {
  return eligibleApproverIds.has(userId)
    && (approvalMode === 'OWNER_SELF' || Boolean(configuredApproverUserIds?.includes(userId)));
}

// One triggerKey per stage, and that is load-bearing: buildDedupKey is
// (companyId, triggerKey, sourceModule, sourceType, sourceId, periodKey), and every other part is
// identical for both stages of the same certificate. Sharing one key made prepare and certify
// collide on a single alert state, so prepare's 60-minute cooldown swallowed the approver
// notification whenever the payer signed within the hour — the normal case. The approver never got
// a recipient or delivery row at all.
const SIGNATURE_STAGES = {
  PAYER: {
    triggerKey: 'expense.substitute_receipt_signature_pending',
    title: (documentNumber: string) => `ใบรับรองแทนใบเสร็จรอการลงลายมือชื่อ เลขที่ ${documentNumber}`,
    body: 'เปิดระบบเพื่อตรวจสอบเอกสารและลงลายมือชื่อ',
  },
  APPROVER: {
    triggerKey: 'expense.substitute_receipt_approval_pending',
    title: (documentNumber: string) => `ใบรับรองแทนใบเสร็จรออนุมัติ เลขที่ ${documentNumber}`,
    body: 'ผู้จ่ายเงินลงลายมือชื่อแล้ว เปิดระบบเพื่อตรวจสอบและอนุมัติ',
  },
} as const;

async function notifySignaturePending(
  notify: CreateOrUpdateNotificationEventUseCase,
  ctx: RequestContext,
  evidence: Pick<SubstituteReceiptEvidenceRecord, 'id' | 'documentNumber'>,
  candidateUserIds: string[],
  stage: keyof typeof SIGNATURE_STAGES,
): Promise<void> {
  const recipientUserIds = candidateUserIds.filter((userId) => userId !== ctx.userId);
  if (recipientUserIds.length === 0) return;
  const copy = SIGNATURE_STAGES[stage];
  await notify.execute({
    companyId: ctx.companyId,
    triggerKey: copy.triggerKey,
    sourceModule: 'expenses',
    sourceType: 'substitute_receipt_evidence',
    sourceId: evidence.id,
    severity: 'action',
    title: copy.title(evidence.documentNumber),
    body: copy.body,
    deepLinkHref: `/companies/${ctx.companyId}/expenses/substitute-receipts/${evidence.id}`,
    recipientUserIds,
  });
}

@Injectable()
export class ListCompanySubstituteReceiptsUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, filter: SubstituteReceiptListFilter): Promise<SubstituteReceiptListResult> {
    assertWeb(ctx);
    const canSeeAll = ctx.permissions.includes('expense.review') || ctx.permissions.includes('expense.confirm');
    const canSeeRelated = ctx.permissions.includes('expense.read_related');
    if (!canSeeAll && !canSeeRelated && !ctx.permissions.includes('expense.read_own')) {
      throw new ForbiddenException('Missing permission to read substitute receipts');
    }
    if (filter.status && !SUBSTITUTE_RECEIPT_STATUSES.has(filter.status)) {
      throw new BadRequestException('Invalid substitute receipt status.');
    }
    if (filter.yearMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(filter.yearMonth)) {
      throw new BadRequestException('yearMonth must use YYYY-MM.');
    }
    const page = Number.isFinite(filter.page) ? Math.max(1, Math.floor(filter.page!)) : 1;
    const pageSize = Number.isFinite(filter.pageSize)
      ? Math.min(200, Math.max(1, Math.floor(filter.pageSize!)))
      : 50;
    const onlyPayerUserId = canSeeAll || canSeeRelated ? null : ctx.userId;
    const { rows, total } = await this.repo.listCompanySubstituteReceipts(
      ctx.companyId,
      { ...filter, page, pageSize },
      { branchIds: ctx.scopes?.branchIds, onlyPayerUserId, relatedUserId: !canSeeAll && canSeeRelated ? ctx.userId : null },
    );
    return {
      items: rows.map((row) => ({
        evidenceId: row.id,
        expenseId: row.expenseId,
        documentNumber: row.documentNumber,
        version: row.version,
        status: row.status as SubstituteReceiptEvidenceStatus,
        expenseNumber: row.expense.expenseNumber,
        expenseDate: row.expense.expenseDate.toISOString(),
        paymentDate: row.paymentDate?.toISOString() ?? null,
        payeeName: row.payeeName ?? row.expense.vendorNameSnapshot,
        payeeAddress: row.payeeAddress,
        payeeTaxId: row.payeeTaxId,
        currency: row.expense.currency,
        grandTotalAmount: expenseDecimalToString(row.expense.grandTotalAmount),
        payerUserId: row.payerUserId,
        payerName: row.payerName,
        approverUserId: row.approverUserId,
        approverName: row.approverName,
        artifactAttachmentId: row.artifactAttachmentId,
        certifiedArtifactAttachmentId: row.certifiedArtifactAttachmentId,
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }
}

@Injectable()
export class PrepareSubstituteReceiptUseCase {
  private readonly logger = new Logger(PrepareSubstituteReceiptUseCase.name);

  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly audit: AuditService,
    private readonly notify: CreateOrUpdateNotificationEventUseCase,
  ) {}

  async execute(ctx: RequestContext, expenseId: string, input: GenerateSubstituteReceiptInput): Promise<SubstituteReceiptEvidenceSummary> {
    // R7: preparing is the one substitute-receipt step LINE may take. It writes staged facts and
    // reserves a document number; it embeds no signature and grants no approval. The three gates
    // the spec names — `expense.review` below, `assertBranch`, and the payer resolving to an active
    // in-scope member — already run for every channel, so the channel decides only what the audit
    // trail records. Preview/certify/approve/download keep `assertWeb` (§16 last bullet).
    const preparedFromChannel = ctx.authProvider === 'line' ? 'LINE' : 'WEB';
    if (!ctx.permissions.includes('expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    if (!REASON_CODES.has(input.reasonCode)) throw new BadRequestException('Invalid substitute receipt reasonCode.');
    const reason = requiredText(input.missingReceiptReason, 'missingReceiptReason', 500);
    const purpose = requiredText(input.businessPurpose, 'businessPurpose', 500);
    const payerUserId = requiredText(input.payerUserId, 'payerUserId', 100);
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey', 128);
    const continuationId = input.continuationId === undefined
      ? undefined
      : requiredText(input.continuationId, 'continuationId', 100);
    const note = input.note === undefined ? null : requiredText(input.note, 'note', 500);
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    validateEligibility(expense, input.reasonCode);
    const payeeName = optionalText(input.payeeName, 'payeeName', 200)
      ?? optionalText(expense.vendorNameSnapshot, 'payeeName', 200);
    if (!payeeName) throw new BadRequestException('payeeName is required when the expense has no vendor name.');
    const payeeAddress = optionalText(input.payeeAddress, 'payeeAddress', 300);
    const payeeTaxId = optionalPayeeTaxId(input.payeeTaxId);
    const expectedExpenseUpdatedAt = parseExpectedDate(input.expectedExpenseUpdatedAt, 'expectedExpenseUpdatedAt');
    if (expense.updatedAt.getTime() !== expectedExpenseUpdatedAt.getTime()) throw new ConflictException('Expense changed after review. Reload before preparing substitute evidence.');

    const payer = await this.repo.findActiveMemberIdentity(ctx.companyId, payerUserId, expense.branchId);
    if (!payer) throw new BadRequestException('The selected payer is not an active company member in this branch.');
    const policy = await this.repo.getSubstituteReceiptPolicy(ctx.companyId);
    const approvalMode = policy?.approvalMode ?? 'OWNER_SELF';
    const eligibleApprovers = await this.repo.listEligibleSubstituteReceiptApprovers(ctx.companyId, expense.branchId);
    const eligibleApproverIds = new Set(eligibleApprovers.map((approver) => approver.userId));
    if (approvalMode === 'DESIGNATED_APPROVERS'
      && !eligibleApprovers.some((approver) => approver.userId !== payer.userId
        && isEligibleSubstituteReceiptApprover(approver.userId, approvalMode, policy?.approverUserIds, eligibleApproverIds))) {
      throw new BadRequestException('No configured approver with expense.confirm is eligible for this branch and distinct from the selected payer.');
    }
    if (approvalMode === 'OWNER_SELF' && eligibleApproverIds.size === 0) {
      throw new BadRequestException('No active member with expense.confirm is eligible to approve for this branch.');
    }
    const paymentIds = uniqueIds(input.paymentEvidenceAttachmentIds);
    const supportingIds = uniqueIds(input.supportingAttachmentIds);
    if (paymentIds.some((id) => supportingIds.includes(id))) {
      throw new BadRequestException('The same file cannot serve as both source/supporting evidence and payment evidence.');
    }
    const allIds = [...new Set([...paymentIds, ...supportingIds])];
    if (allIds.length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments) {
      throw renderabilityError(
        'substitute_receipt_too_many_evidence',
        `A substitute receipt supports at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments} linked evidence files.`,
      );
    }
    const attachments = await this.repo.findSubstituteEvidenceAttachments(ctx.companyId, expenseId, allIds);
    if (attachments.length !== allIds.length) throw new BadRequestException('Every evidence attachment must be ACTIVE and linked to this expense.');
    assertSubstituteReceiptEvidenceRenderable(attachments);
    const paymentEvidence = attachments.filter((attachment) => paymentIds.includes(attachment.id));
    if (paymentEvidence.some((attachment) => attachment.purpose !== 'expense.payment.evidence'
      || (!attachment.mimeType.startsWith('image/') && attachment.mimeType !== 'application/pdf'))) {
      throw new BadRequestException('Payment evidence must be an image/PDF linked with purpose expense.payment.evidence.');
    }
    const paymentMethod = input.paymentMethod ?? expense.paymentMethod;
    if (!paymentMethod) throw new BadRequestException('Payment method is required.');
    if (paymentIds.length === 0 && (paymentMethod !== 'CASH'
      || (policy?.cashEvidencePolicy ?? 'ALLOW_SUPPORTING_EVIDENCE_ONLY') === 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE')) {
      throw new BadRequestException(paymentMethod === 'CASH'
        ? 'Company policy requires separate payment evidence for cash expenses.'
        : 'Non-cash expenses require linked payment evidence.');
    }
    const paymentDate = input.paymentDate ? parseExpectedDate(input.paymentDate, 'paymentDate') : expense.paidAt;
    if (!paymentDate) throw new BadRequestException('Payment date is required because the payer certifies an amount already paid for company business.');

    try {
      const evidence = await this.repo.createPreparedSubstituteEvidence({
        companyId: ctx.companyId,
        expenseId,
        branchId: expense.branchId,
        expectedExpenseUpdatedAt,
        originalSourceDocumentType: expense.sourceDocumentType,
        reasonCode: input.reasonCode,
        missingReceiptReason: reason,
        businessPurpose: purpose,
        paymentEvidenceAttachmentIds: paymentIds,
        supportingAttachmentIds: supportingIds,
        paymentDate,
        paymentMethod,
        note,
        payerUserId: payer.userId,
        payerName: payer.displayName,
        payeeName,
        payeeAddress,
        payeeTaxId,
        preparedByUserId: ctx.userId,
        preparedFromChannel,
        idempotencyKey,
        ...(continuationId
          ? { lineContinuation: { workflowId: continuationId, userId: ctx.userId, formRequested: input.formRequested === true } }
          : {}),
      });
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.substitute_receipt.prepare',
        targetType: 'expense_substitute_receipt', targetId: evidence.id, requestId: ctx.requestId,
        // R5: evidenceCount makes every self-certified no-evidence document listable in one query.
        result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: {
          expenseId, version: evidence.version, payerUserId, evidenceCount: allIds.length, preparedFromChannel,
          // Spec §14 names `source: LINE` on the LINE-sourced row; on the web there is no source to state.
          ...(preparedFromChannel === 'LINE' ? { source: 'LINE' } : {}),
        },
      });
      try {
        await notifySignaturePending(this.notify, ctx, evidence, [payer.userId], 'PAYER');
      } catch (error) {
        this.logger.warn({
          msg: 'Substitute receipt payer notification failed',
          evidenceId: evidence.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return toSubstituteEvidenceSummary(evidence);
    } catch (error) {
      throw new ConflictException((error as Error).message);
    }
  }
}

@Injectable()
export class PreviewSubstituteReceiptUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, expenseId: string, evidenceId: string, input: { payerPosition: string }) {
    assertWeb(ctx);
    const payerPosition = requiredText(input.payerPosition, 'payerPosition', 120);
    const evidence = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
    if (!evidence) throw new NotFoundException('Substitute evidence not found.');
    if (evidence.status !== 'PREPARED') throw new ConflictException(`Expected PREPARED evidence, found ${evidence.status}.`);
    if (evidence.payerUserId !== ctx.userId) throw new ForbiddenException('Only the selected actual payer may preview this evidence.');
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    assertPreparedExpenseUnchanged(expense, evidence);
    validateEligibility(expense, evidence.reasonCode);
    const snapshot = await buildSnapshot(this.repo, ctx.companyId, expense, evidence, payerPosition, PREVIEW_CERTIFIED_AT);
    const previewChecksumSha256 = canonicalSnapshotHash(snapshot);
    const svg = renderSubstituteReceiptSvg(snapshot);
    return { svgDataUrl: `data:image/svg+xml;base64,${svg.toString('base64')}`, previewChecksumSha256 };
  }
}

/**
 * The bytes of the issued certificate, with no caller identity in sight. Extracted from the web
 * download so the §12 delivery link can copy exactly the same document without either duplicating
 * the R11 paper-route composition or borrowing a web `RequestContext` it does not have — the
 * `assertWeb` boundary (§16) stays on the endpoints, where it belongs.
 */
export async function composeIssuedSubstituteReceiptPdf(
  repo: PrismaExpenseRepository,
  storage: AttachmentStoragePort,
  companyId: string,
  expenseId: string,
  evidence: SubstituteReceiptEvidenceRecord,
): Promise<{ data: Buffer; fileName: string; stateStamp?: 'VOID' | 'SUPERSEDED'; scanLinked: boolean }> {
  if (!['ISSUED', 'SUPERSEDED'].includes(evidence.status) || !evidence.artifactAttachmentId) {
    throw new ConflictException('The substitute-receipt certificate has not been issued yet.');
  }
  const attachment = await repo.findSubstituteArtifactAttachment(
    companyId,
    expenseId,
    evidence.artifactAttachmentId,
  );
  if (!attachment) throw new NotFoundException('Issued substitute-receipt artifact not found.');
  const svg = await storage.getObject({
    bucket: attachment.bucket,
    objectKey: attachment.objectKey,
    ...(attachment.objectVersionId ? { objectVersionId: attachment.objectVersionId } : {}),
  });
  // The immutable, checksummed SVG remains authoritative; this PDF is a derived printout generated on demand.
  const stateStamp = evidence.status === 'SUPERSEDED'
    ? evidence.supersedeReason === SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON ? 'VOID' : 'SUPERSEDED'
    : undefined;
  // R11: on the paper route the stored artifact is the attestation page, and the signatures live
  // on the scan — so the document handed over is the scan first, then that page.
  const scan = evidence.signatureMode === 'PAPER' && evidence.wetSignedScanAttachmentId
    ? await repo.findSubstituteArtifactAttachment(
      companyId, expenseId, evidence.wetSignedScanAttachmentId, ['image/jpeg', 'image/png', 'application/pdf'],
    )
    : null;
  if (evidence.signatureMode === 'PAPER' && !scan) {
    throw new ConflictException('The hand-signed scan of this substitute receipt is no longer available.');
  }
  let data: Buffer;
  if (scan) {
    const scanObject = await storage.getObject({
      bucket: scan.bucket, objectKey: scan.objectKey, ...(scan.objectVersionId ? { objectVersionId: scan.objectVersionId } : {}),
    });
    // R11: the scan's checksum is recorded on the evidence precisely so the bytes handed over can
    // be proven to be the ones that were certified. Silently printing different bytes would be a
    // forged document, so a mismatch refuses with a code the web can explain.
    if (sha256(scanObject.bytes) !== evidence.wetSignedScanChecksumSha256) {
      throw new ConflictException({
        code: 'substitute_wet_signed_scan_checksum_mismatch',
        message: 'The stored hand-signed scan no longer matches the checksum recorded at certification.',
      });
    }
    try {
      data = await renderSubstituteReceiptPaperArtifactPdf(
        { bytes: scanObject.bytes, mimeType: scan.mimeType },
        svg.bytes,
        evidence.documentNumber,
        { ...(stateStamp ? { stateStamp } : {}) },
      );
    } catch (error) {
      // Linking validates composability, so reaching here means the stored object changed under
      // us. It is still a state the reader can act on, never an unexplained 500.
      throw new ConflictException({
        code: 'substitute_wet_signed_scan_not_renderable',
        message: `The hand-signed scan can no longer be composed into the certificate (${(error as Error).message.slice(0, 120)}).`,
      });
    }
  } else {
    data = await renderSubstituteReceiptPdf(svg.bytes, evidence.documentNumber, { stateStamp });
  }
  const stateSuffix = stateStamp ? `-${stateStamp}` : '';
  return {
    data,
    fileName: `${evidence.documentNumber.replace(/["\r\n]/g, '_')}${stateSuffix}.pdf`,
    ...(stateStamp ? { stateStamp } : {}),
    scanLinked: !!scan,
  };
}

@Injectable()
export class DownloadSubstituteReceiptPdfUseCase {
  constructor(
    private readonly getExpense: GetExpenseUseCase,
    private readonly repo: PrismaExpenseRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, expenseId: string, evidenceId: string): Promise<{ data: Buffer; fileName: string }> {
    assertWeb(ctx);
    await this.getExpense.execute(ctx, expenseId);
    const evidence = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
    if (!evidence) throw new NotFoundException('Substitute evidence not found.');
    const composed = await composeIssuedSubstituteReceiptPdf(this.repo, this.storage, ctx.companyId, expenseId, evidence);
    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'expense.substitute_receipt.artifact.download',
      targetType: 'expense_substitute_receipt',
      targetId: evidenceId,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: {
        expenseId,
        artifactAttachmentId: evidence.artifactAttachmentId,
        evidenceStatus: evidence.status,
        supersedeReason: evidence.supersedeReason,
        derivedStamp: composed.stateStamp ?? null,
        signatureMode: evidence.signatureMode,
        ...(composed.scanLinked ? { wetSignedScanAttachmentId: evidence.wetSignedScanAttachmentId } : {}),
      },
    });
    return { data: composed.data, fileName: composed.fileName };
  }
}

/**
 * R8 — `แบบฟอร์มรอลงนาม`. The same snapshot the payer is about to certify, rendered with both
 * signature boxes blank, an `UNSIGNED` watermark, the document number printed large, and the line
 * that says the sheet is not yet a document. It is DERIVED on demand and never stored: no
 * attachment, no artifact id, nothing that could later be mistaken for the issued certificate.
 *
 * Extracted alongside `composeIssuedSubstituteReceiptPdf` so the §12 delivery link renders exactly
 * this sheet — Journey B must reach it without a web session.
 */
export async function composeUnsignedSubstituteReceiptFormPdf(
  repo: PrismaExpenseRepository,
  companyId: string,
  expense: ExpenseRecordWithRelations,
  evidence: SubstituteReceiptEvidenceRecord,
): Promise<{ data: Buffer; fileName: string }> {
  if (evidence.status !== 'PREPARED') throw new ConflictException(`The unsigned form exists only while the evidence is PREPARED, found ${evidence.status}.`);
  // Someone is about to sign this sheet by hand: it must carry the values the certification will,
  // not a stale copy of them.
  assertPreparedExpenseUnchanged(expense, evidence);
  const snapshot = await buildSnapshot(repo, companyId, expense, evidence, UNSIGNED_FORM_POSITION_BLANK, PREVIEW_CERTIFIED_AT);
  const svg = renderSubstituteReceiptSvg(snapshot, undefined, undefined, undefined, { unsignedForm: true });
  return {
    data: await renderSubstituteReceiptPdf(svg, evidence.documentNumber, { stateStamp: 'UNSIGNED' }),
    fileName: `${evidence.documentNumber.replace(/["\r\n]/g, '_')}-UNSIGNED.pdf`,
  };
}

@Injectable()
export class DownloadSubstituteReceiptFormPdfUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, expenseId: string, evidenceId: string): Promise<{ data: Buffer; fileName: string }> {
    assertWeb(ctx);
    if (!ctx.permissions.includes('expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    const evidence = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
    if (!evidence) throw new NotFoundException('Substitute evidence not found.');
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    const composed = await composeUnsignedSubstituteReceiptFormPdf(this.repo, ctx.companyId, expense, evidence);
    // The sheet carries payee name and amount, so its egress is audited exactly like the issued
    // artifact's — the only difference is that this one has no stored attachment to name.
    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'expense.substitute_receipt.form.download',
      targetType: 'expense_substitute_receipt',
      targetId: evidenceId,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: { expenseId, evidenceStatus: evidence.status, version: evidence.version, derivedStamp: 'UNSIGNED' },
    });
    return composed;
  }
}

@Injectable()
export class DownloadPaymentVoucherPdfUseCase {
  constructor(
    private readonly getExpense: GetExpenseUseCase,
    private readonly repo: PrismaExpenseRepository,
  ) {}

  async execute(
    ctx: RequestContext,
    expenseId: string,
    input: { paymentDate?: string; payeeName?: string; payeeAddress?: string; payeeTaxId?: string },
  ): Promise<{ data: Buffer; fileName: string }> {
    const expense = await this.getExpense.execute(ctx, expenseId);
    const company = await this.repo.getSubstituteCompanyContext(ctx.companyId, expense.branchId);
    const payeeName = optionalText(input.payeeName, 'payeeName', 200)
      ?? optionalText(expense.vendorNameSnapshot, 'payeeName', 200);
    const svg = renderPaymentVoucherSvg({
      companyName: company.name,
      paymentDate: input.paymentDate
        ? parseExpectedDate(input.paymentDate, 'paymentDate').toISOString()
        : expense.paidAt?.toISOString() ?? null,
      payeeName,
      payeeAddress: optionalText(input.payeeAddress, 'payeeAddress', 300),
      payeeTaxId: optionalPayeeTaxId(input.payeeTaxId),
      expenseDescription: expense.lines.map((line) => line.description.trim()).filter(Boolean).join(', '),
      amount: expense.grandTotalAmount,
    });
    const data = await renderSubstituteReceiptPdf(svg);
    return { data, fileName: `ใบสำคัญรับเงิน-${expense.expenseNumber ?? expense.id}.pdf` };
  }
}

@Injectable()
export class CertifySubstituteReceiptUseCase {
  private readonly logger = new Logger(CertifySubstituteReceiptUseCase.name);

  constructor(
    private readonly repo: PrismaExpenseRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
    private readonly notify: CreateOrUpdateNotificationEventUseCase,
    private readonly objectVersionCleanup: ObjectVersionCleanupService,
  ) {}

  async execute(ctx: RequestContext, expenseId: string, evidenceId: string, input: CertifySubstituteReceiptInput): Promise<SubstituteReceiptEvidenceSummary> {
    assertWeb(ctx);
    if (input.certificationAcknowledged !== true) throw new BadRequestException('The payer must acknowledge the certification statement.');
    const payerPosition = requiredText(input.payerPosition, 'payerPosition', 120);
    const evidence = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
    if (!evidence) throw new NotFoundException('Substitute evidence not found.');
    if (evidence.status !== 'PREPARED') throw new ConflictException(`Expected PREPARED evidence, found ${evidence.status}.`);
    if (evidence.payerUserId !== ctx.userId) throw new ForbiddenException('Only the selected actual payer may certify this evidence.');
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    assertPreparedExpenseUnchanged(expense, evidence);
    validateEligibility(expense, evidence.reasonCode);
    const expectedEvidenceUpdatedAt = parseExpectedDate(input.expectedEvidenceUpdatedAt, 'expectedEvidenceUpdatedAt');
    const previewSnapshot = await buildSnapshot(this.repo, ctx.companyId, expense, evidence, payerPosition, PREVIEW_CERTIFIED_AT);
    if (canonicalSnapshotHash(previewSnapshot) !== input.previewChecksumSha256) {
      throw new ConflictException('The reviewed preview no longer matches. Generate and review a new preview before signing.');
    }
    // R10/R11: on the paper route the ink is on the scan, so no signature image is resolved and none
    // is drawn. The acknowledgement below is still the payer's own, and still its own audit row.
    const scanChecksum = paperRouteScanChecksum(evidence);
    const signature = scanChecksum
      ? undefined
      : await loadOwnedSignature(this.repo, this.storage, ctx.companyId, input.signatureAttachmentId, ctx.userId, evidence.id, 'payer');
    const certifiedAt = new Date();
    const snapshot = await buildSnapshot(this.repo, ctx.companyId, expense, evidence, payerPosition, certifiedAt.toISOString());
    const snapshotChecksumSha256 = canonicalSnapshotHash(snapshot);
    const bytes = scanChecksum
      ? renderSubstituteReceiptAttestationSvg(snapshot, { snapshotChecksumSha256, wetSignedScanChecksumSha256: scanChecksum })
      : renderSubstituteReceiptSvg(snapshot, signature!.dataUrl);
    const checksumSha256 = sha256(bytes);
    const objectKey = `${ctx.companyId}/generated/expense-substitute/${expenseId}/v${evidence.version}-certified-${checksumSha256}-${randomUUID()}.svg`;
    const stored = await this.storage.putObject({ objectKey, mimeType: 'image/svg+xml', bytes });
    try {
      const updated = await this.repo.markSubstituteEvidenceCertified({
        companyId: ctx.companyId,
        expenseId,
        evidenceId,
        payerUserId: ctx.userId,
        payerPosition,
        ...(signature ? { payerSignatureAttachmentId: signature.id, payerSignatureChecksumSha256: signature.checksumSha256 } : {}),
        referencedAttachmentIds: [
          ...(signature ? [signature.id] : [evidence.wetSignedScanAttachmentId!]),
          ...evidence.paymentEvidenceAttachmentIds,
          ...evidence.supportingAttachmentIds,
        ],
        snapshotJson: snapshot as unknown as Record<string, unknown>,
        snapshotChecksumSha256,
        certifiedAt,
        expectedVersion: input.expectedVersion,
        expectedEvidenceUpdatedAt,
        artifact: { ...stored, checksumSha256, originalFileName: `${evidence.documentNumber}-certified.svg` },
      });
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.substitute_receipt.certify',
        targetType: 'expense_substitute_receipt', targetId: evidenceId, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: {
          expenseId, version: evidence.version, snapshotChecksumSha256,
          signatureSource: signature?.source ?? 'wet_signed_scan',
          signatureMode: evidence.signatureMode,
        },
      });
      try {
        const policy = await this.repo.getSubstituteReceiptPolicy(ctx.companyId);
        const approvalMode = policy?.approvalMode ?? 'OWNER_SELF';
        const eligibleApprovers = await this.repo.listEligibleSubstituteReceiptApprovers(ctx.companyId, expense.branchId);
        const eligibleApproverIds = new Set(eligibleApprovers.map((approver) => approver.userId));
        const candidateUserIds = eligibleApprovers
          .filter((approver) => isEligibleSubstituteReceiptApprover(
            approver.userId,
            approvalMode,
            policy?.approverUserIds,
            eligibleApproverIds,
          ))
          .map((approver) => approver.userId);
        await notifySignaturePending(this.notify, ctx, evidence, candidateUserIds, 'APPROVER');
      } catch (error) {
        this.logger.warn({
          msg: 'Substitute receipt approver notification failed',
          evidenceId: evidence.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return toSubstituteEvidenceSummary(updated);
    } catch (error) {
      await this.objectVersionCleanup.enqueue({
        companyId: ctx.companyId,
        bucket: stored.bucket,
        objectPath: stored.objectKey,
        expectedVersion: stored.objectVersionId,
        source: 'SUBSTITUTE_RECEIPT_CERTIFIED',
      });
      throw new ConflictException((error as Error).message);
    }
  }

}

@Injectable()
export class ApproveSubstituteReceiptUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
    private readonly objectVersionCleanup: ObjectVersionCleanupService,
  ) {}

  async execute(ctx: RequestContext, expenseId: string, evidenceId: string, input: ApproveSubstituteReceiptInput): Promise<SubstituteReceiptEvidenceSummary> {
    assertWeb(ctx);
    if (!ctx.permissions.includes('expense.confirm')) throw new ForbiddenException('Missing permission: expense.confirm');
    if (input.approvalAcknowledged !== true) throw new BadRequestException('The approver must acknowledge approval.');
    const approverPosition = requiredText(input.approverPosition, 'approverPosition', 120);
    const evidence = await this.repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
    if (!evidence) throw new NotFoundException('Substitute evidence not found.');
    const scanChecksum = paperRouteScanChecksum(evidence);
    if (evidence.status !== 'PAYER_CERTIFIED' || !evidence.snapshotJson
      || (!scanChecksum && !evidence.payerSignatureAttachmentId)) {
      throw new ConflictException('The payer must certify an immutable snapshot before approval.');
    }
    if (!scanChecksum && !evidence.payerSignatureChecksumSha256) throw new ConflictException('The certified payer signature checksum is missing.');
    if (input.certifiedArtifactChecksumSha256 !== evidence.certifiedArtifactChecksumSha256) {
      throw new ConflictException('Approval must acknowledge the current payer-certified artifact checksum.');
    }
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    assertPreparedExpenseUnchanged(expense, evidence);
    const policy = await this.repo.getSubstituteReceiptPolicy(ctx.companyId);
    const approvalMode = policy?.approvalMode ?? 'OWNER_SELF';
    const selfApproved = evidence.payerUserId === ctx.userId;
    if (selfApproved && !selfApprovalPermitted(approvalMode, ctx.roles)) {
      throw new ForbiddenException('Self-approval of a substitute receipt requires the owner-self policy and an owner, admin, or manager role.');
    }
    const eligibleApproverIds = new Set((await this.repo.listEligibleSubstituteReceiptApprovers(ctx.companyId, expense.branchId))
      .map((candidate) => candidate.userId));
    const eligibleApprover = isEligibleSubstituteReceiptApprover(
      ctx.userId,
      approvalMode,
      policy?.approverUserIds,
      eligibleApproverIds,
    );
    if (approvalMode === 'DESIGNATED_APPROVERS'
      && !eligibleApprover) {
      throw new ForbiddenException('You are not a currently configured substitute-receipt approver for this branch.');
    }
    if (approvalMode === 'OWNER_SELF' && !eligibleApprover) {
      throw new ForbiddenException('You do not have expense.confirm for this branch.');
    }
    if (evidence.paymentMethod === 'CASH'
      && (policy?.cashEvidencePolicy ?? 'ALLOW_SUPPORTING_EVIDENCE_ONLY') === 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE'
      && evidence.paymentEvidenceAttachmentIds.length === 0) {
      throw new ConflictException('Current company policy requires separate payment evidence for cash expenses. Supersede and prepare a new version.');
    }
    const approver = await this.repo.findActiveMemberIdentity(ctx.companyId, ctx.userId, expense.branchId);
    if (!approver) throw new ForbiddenException('Approver is not an active company member in this branch.');
    const expectedEvidenceUpdatedAt = parseExpectedDate(input.expectedEvidenceUpdatedAt, 'expectedEvidenceUpdatedAt');
    const snapshot = evidence.snapshotJson as unknown as SubstituteReceiptSnapshot;
    if (canonicalSnapshotHash(snapshot) !== evidence.snapshotChecksumSha256) throw new ConflictException('Certified snapshot checksum is invalid.');
    assertSubstituteReceiptSnapshotRenderable(snapshot);
    const approverSignature = scanChecksum
      ? undefined
      : await loadOwnedSignature(this.repo, this.storage, ctx.companyId, input.signatureAttachmentId, ctx.userId, evidence.id, 'approver');
    // The approver is not the person who can fix a payer signature that no longer resolves, so the
    // failure is reported as a state conflict with a recovery path, not as their bad request.
    const payerSignature = scanChecksum
      ? undefined
      : await loadOwnedSignature(this.repo, this.storage, ctx.companyId, evidence.payerSignatureAttachmentId!, evidence.payerUserId, evidence.id, 'payer')
        .catch((error) => {
          if (error instanceof BadRequestException) {
            throw new ConflictException('Payer signature recorded at certification can no longer be resolved. Supersede this evidence and re-certify.');
          }
          throw error;
        });
    if (payerSignature && payerSignature.checksumSha256 !== evidence.payerSignatureChecksumSha256) {
      throw new ConflictException('The payer signature changed after certification.');
    }
    const approvedAt = new Date();
    const approverDetails = { userId: ctx.userId, name: approver.displayName, position: approverPosition, approvedAt: approvedAt.toISOString() };
    const bytes = scanChecksum
      ? renderSubstituteReceiptAttestationSvg(snapshot, {
        snapshotChecksumSha256: evidence.snapshotChecksumSha256!,
        wetSignedScanChecksumSha256: scanChecksum,
        approver: approverDetails,
      })
      : renderSubstituteReceiptSvg(snapshot, payerSignature!.dataUrl, approverDetails, approverSignature!.dataUrl);
    const checksumSha256 = sha256(bytes);
    const objectKey = `${ctx.companyId}/generated/expense-substitute/${expenseId}/v${evidence.version}-issued-${checksumSha256}-${randomUUID()}.svg`;
    const stored = await this.storage.putObject({ objectKey, mimeType: 'image/svg+xml', bytes });
    try {
      const updated = await this.repo.issueSubstituteEvidence({
        companyId: ctx.companyId,
        expenseId,
        evidenceId,
        approverUserId: ctx.userId,
        approverName: approver.displayName,
        approverPosition,
        // State the policy, not the outcome: a later refactor of the guard above must not silently
        // widen what the in-transaction re-check permits.
        allowSelfApproval: selfApprovalPermitted(approvalMode, ctx.roles),
        ...(approverSignature ? { approverSignatureAttachmentId: approverSignature.id } : {}),
        approvedAt,
        expectedExpenseUpdatedAt: evidence.expenseUpdatedAtAtPreparation,
        referencedAttachmentIds: [
          ...(approverSignature ? [approverSignature.id, evidence.payerSignatureAttachmentId!] : [evidence.wetSignedScanAttachmentId!]),
          ...(evidence.certifiedArtifactAttachmentId ? [evidence.certifiedArtifactAttachmentId] : []),
          ...evidence.paymentEvidenceAttachmentIds,
          ...evidence.supportingAttachmentIds,
        ],
        expectedVersion: input.expectedVersion,
        expectedEvidenceUpdatedAt,
        artifact: { ...stored, checksumSha256, originalFileName: `${evidence.documentNumber}.svg` },
      });
      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.substitute_receipt.approve',
        targetType: 'expense_substitute_receipt', targetId: evidenceId, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'CRITICAL',
        metadataJson: {
          expenseId, version: evidence.version, checksumSha256, selfApproved,
          signatureSource: approverSignature?.source ?? 'wet_signed_scan',
          signatureMode: evidence.signatureMode,
        },
      });
      return toSubstituteEvidenceSummary(updated);
    } catch (error) {
      await this.objectVersionCleanup.enqueue({
        companyId: ctx.companyId,
        bucket: stored.bucket,
        objectPath: stored.objectKey,
        expectedVersion: stored.objectVersionId,
        source: 'SUBSTITUTE_RECEIPT_ISSUED',
      });
      throw new ConflictException((error as Error).message);
    }
  }
}

@Injectable()
export class ListSubstituteReceiptHistoryUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, expenseId: string): Promise<SubstituteReceiptEvidenceSummary[]> {
    assertWeb(ctx);
    const expense = await this.repo.findById(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    // Loaded before the decision because the payer is part of what authorizes the read. Nothing is
    // returned unless one of the three clauses below passes, and the allowed path costs the same
    // two queries it always did.
    const history = await this.repo.listSubstituteEvidenceHistory(ctx.companyId, expenseId);
    const canReview = ctx.permissions.includes('expense.review');
    // `read_own` means "created it OR paid it" here, the same as in GetExpenseUseCase and in the
    // hub list. Reading it as "created it" alone locks out the one person the certificate is
    // waiting on: the payer is deliberately not the reviewer, and is usually not the creator
    // either — that separation is the control this feature exists to produce. Any version counts,
    // matching expenseRelatedToUserWhere, so the read_own and read_related paths agree.
    const canReadOwn = ctx.permissions.includes('expense.read_own')
      && (expense.createdByUserId === ctx.userId || history.some((item) => item.payerUserId === ctx.userId));
    const canReadRelated = ctx.permissions.includes('expense.read_related')
      && await this.repo.isUserRelatedToExpense(ctx.companyId, expenseId, ctx.userId, ctx.scopes ?? {});
    if (!canReview && !canReadOwn && !canReadRelated) throw new ForbiddenException('Cannot read this substitute-receipt history.');
    return history;
  }
}

@Injectable()
export class SupersedeSubstituteReceiptUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, expenseId: string, evidenceId: string, input: SupersedeSubstituteReceiptInput) {
    assertWeb(ctx);
    if (!ctx.permissions.includes('expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    const reason = requiredText(input.reason, 'reason', 500);
    const expectedEvidenceUpdatedAt = parseExpectedDate(input.expectedEvidenceUpdatedAt, 'expectedEvidenceUpdatedAt');
    const expense = await this.repo.findById(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    try {
      const evidence = await this.repo.supersedeSubstituteEvidence({
        companyId: ctx.companyId, expenseId, evidenceId, actorUserId: ctx.userId, reason, expectedEvidenceUpdatedAt,
      });
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.substitute_receipt.supersede',
        targetType: 'expense_substitute_receipt', targetId: evidenceId, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { expenseId, version: evidence.version, reason },
      });
      return evidence;
    } catch (error) {
      throw new ConflictException((error as Error).message);
    }
  }
}

@Injectable()
export class ListSubstituteReceiptPayersUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, expenseId: string): Promise<Array<{ userId: string; displayName: string }>> {
    assertWeb(ctx);
    if (!ctx.permissions.includes('expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    const expense = await this.repo.findById(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
    assertBranch(ctx, expense.branchId);
    return this.repo.listActiveMemberIdentities(ctx.companyId, expense.branchId);
  }
}

@Injectable()
export class InitSubstituteSignatureUploadUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly createUpload: CreateUploadIntentUseCase) {}

  async execute(
    ctx: RequestContext,
    expenseId: string,
    evidenceId: string,
    input: { originalFileName: string; mimeType: string; byteSize: number },
  ) {
    const { evidence, role } = await assertSignatureActor(this.repo, ctx, expenseId, evidenceId);
    if (!['image/png', 'image/jpeg'].includes(input.mimeType) || !Number.isInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > 2_000_000) {
      throw new BadRequestException('Per-certificate signature must be a PNG/JPEG file up to 2 MB.');
    }
    return this.createUpload.execute(withAttachmentCreate(ctx), {
      originalFileName: requiredText(input.originalFileName, 'originalFileName', 255),
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      visibility: 'INTERNAL',
      ...(evidence.branchId ? { branchId: evidence.branchId } : {}),
      metadataJson: { generatedFor: 'substitute_receipt_signature', evidenceId: evidence.id, role },
    });
  }
}

@Injectable()
export class CompleteSubstituteSignatureUploadUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly completeUpload: CompleteAttachmentUploadUseCase) {}

  async execute(
    ctx: RequestContext,
    expenseId: string,
    evidenceId: string,
    attachmentId: string,
    input: { checksumSha256?: string; byteSize?: number },
  ) {
    const { role } = await assertSignatureActor(this.repo, ctx, expenseId, evidenceId);
    const attachment = await this.repo.findPersonalSignatureUploadAttachment(ctx.companyId, attachmentId, ctx.userId, evidenceId, role);
    if (!attachment || attachment.status !== 'PENDING_UPLOAD') throw new BadRequestException('Pending signature upload not found for this signer.');
    return this.completeUpload.execute(withAttachmentCreate(ctx), { attachmentId, ...input });
  }
}

function uniqueIds(values: string[] | undefined): string[] {
  if (!values) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new BadRequestException('Evidence attachment ids must be non-empty strings.');
  }
  return [...new Set(values.map((value) => value.trim()))];
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertImageBytes(bytes: Buffer, mimeType: string): void {
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((mimeType === 'image/png' && !png) || (mimeType === 'image/jpeg' && !jpeg)) {
    throw new BadRequestException('Signature bytes do not match the declared PNG/JPEG MIME type.');
  }
}

/**
 * R9: the per-evidence upload still wins wherever one exists, and the signer's personal signature
 * library is the fallback, so a second substitute receipt needs no upload. Both routes record the
 * resolved attachment id and its checksum on the evidence row, so the artifact chain is unchanged.
 */
async function loadOwnedSignature(
  repo: PrismaExpenseRepository,
  storage: AttachmentStoragePort,
  companyId: string,
  attachmentId: string | undefined,
  userId: string,
  evidenceId: string,
  role: 'payer' | 'approver',
): Promise<{ id: string; dataUrl: string; checksumSha256: string; source: 'evidence_upload' | 'signature_library' }> {
  // Only an omitted id means "use my saved signature": a supplied-but-blank id is a caller bug and
  // must fail exactly as it did before the library fallback existed.
  if (attachmentId !== undefined && !attachmentId.trim()) {
    throw new BadRequestException(`Signature must be an ACTIVE PNG/JPEG uploaded by the ${role}.`);
  }
  const uploaded = attachmentId
    ? await repo.findPersonalSignatureAttachment(companyId, attachmentId, userId, evidenceId, role)
    : null;
  // With an attachmentId the fallback stays pinned to that exact attachment: an already-certified
  // signature must still resolve after the signer adds a newer one.
  const attachment = uploaded ?? await repo.findReusableSignatureAsset(companyId, userId, attachmentId);
  if (!attachment) throw new BadRequestException(`Signature must be an ACTIVE PNG/JPEG uploaded by the ${role}.`);
  if (attachment.byteSize > 2_000_000) throw new BadRequestException('Signature image must be at most 2 MB.');
  const object = await storage.getObject({
    bucket: attachment.bucket,
    objectKey: attachment.objectKey,
    ...(attachment.objectVersionId ? { objectVersionId: attachment.objectVersionId } : {}),
  });
  assertImageBytes(object.bytes, attachment.mimeType);
  const checksum = sha256(object.bytes);
  if (attachment.checksumSha256 && attachment.checksumSha256 !== checksum) throw new ConflictException('Signature checksum does not match storage.');
  return {
    id: attachment.id,
    dataUrl: `data:${attachment.mimeType};base64,${object.bytes.toString('base64')}`,
    checksumSha256: checksum,
    source: uploaded ? 'evidence_upload' : 'signature_library',
  };
}

async function assertSignatureActor(
  repo: PrismaExpenseRepository,
  ctx: RequestContext,
  expenseId: string,
  evidenceId: string,
): Promise<{ evidence: SubstituteReceiptEvidenceRecord; role: 'payer' | 'approver' }> {
  assertWeb(ctx);
  const evidence = await repo.findSubstituteEvidence(ctx.companyId, expenseId, evidenceId);
  if (!evidence) throw new NotFoundException('Substitute evidence not found.');
  const expense = await repo.findById(ctx.companyId, expenseId);
  if (!expense) throw new NotFoundException(`Expense ${expenseId} not found.`);
  assertBranch(ctx, expense.branchId);
  const isPayer = evidence.status === 'PREPARED' && evidence.payerUserId === ctx.userId;
  const isApprover = evidence.status === 'PAYER_CERTIFIED'
    && ctx.permissions.includes('expense.confirm');
  if (!isPayer && !isApprover) throw new ForbiddenException('Only the current payer or authorized approver may upload this per-certificate signature.');
  if (isApprover) {
    const policy = await repo.getSubstituteReceiptPolicy(ctx.companyId);
    const approvalMode = policy?.approvalMode ?? 'OWNER_SELF';
    const selfApproved = evidence.payerUserId === ctx.userId;
    if (selfApproved && !selfApprovalPermitted(approvalMode, ctx.roles)) {
      throw new ForbiddenException('Self-approval of a substitute receipt requires the owner-self policy and an owner, admin, or manager role.');
    }
    const eligibleApproverIds = new Set((await repo.listEligibleSubstituteReceiptApprovers(ctx.companyId, expense.branchId))
      .map((candidate) => candidate.userId));
    const eligibleApprover = isEligibleSubstituteReceiptApprover(
      ctx.userId,
      approvalMode,
      policy?.approverUserIds,
      eligibleApproverIds,
    );
    if (approvalMode === 'DESIGNATED_APPROVERS'
      && !eligibleApprover) {
      throw new ForbiddenException('You are not a currently configured substitute-receipt approver for this branch.');
    }
    if (approvalMode === 'OWNER_SELF' && !eligibleApprover) {
      throw new ForbiddenException('You do not have expense.confirm for this branch.');
    }
  }
  return { evidence, role: isPayer ? 'payer' : 'approver' };
}

function withAttachmentCreate(ctx: RequestContext): RequestContext {
  return ctx.permissions.includes('attachment.create') ? ctx : { ...ctx, permissions: [...ctx.permissions, 'attachment.create'] };
}
