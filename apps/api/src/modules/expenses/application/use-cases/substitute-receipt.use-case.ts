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
  renderSubstituteReceiptSvg,
  type SubstituteReceiptSnapshot,
} from '../../domain/logic/substitute-receipt.logic';
import { hasBlockingNonExpenseClassification } from '../../domain/logic/expense-status.logic';
import { renderSubstituteReceiptPdf } from '../../domain/logic/substitute-receipt-pdf.logic';
import { renderPaymentVoucherSvg } from '../../domain/logic/payment-voucher.logic';
import type { ExpenseRecordWithRelations, SubstituteReceiptEvidenceRecord } from '../../domain/models/expense.model';
import { GetExpenseUseCase } from './expense-draft.use-case';
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

function validateEligibility(expense: ExpenseRecordWithRelations, reasonCode?: string): void {
  if (!['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status)) {
    throw new BadRequestException(`Cannot prepare substitute evidence in status ${expense.status}.`);
  }
  if (ALWAYS_INELIGIBLE_SOURCE_TYPES.has(expense.sourceDocumentType)) {
    throw new BadRequestException('Legacy substitute markers and unreviewed source types are not eligible.');
  }
  if (['RECEIPT', 'TAX_INVOICE'].includes(expense.sourceDocumentType)
    && !['RECEIPT_UNAVAILABLE', 'RECEIPT_MATERIALLY_INCOMPLETE'].includes(reasonCode ?? '')) {
    throw new BadRequestException('A receipt or tax invoice is eligible only when it is unavailable or materially incomplete; a valid document must use the normal path.');
  }
  if (hasBlockingNonExpenseClassification(expense.aiVerificationSummaryJson)) {
    throw new BadRequestException('Quotation, order-only, appointment, booking, reservation, non-business, unreadable, or ambiguous images are not eligible.');
  }
  const classification = expense.aiVerificationSummaryJson?.['classification'];
  const rawDocumentKind = classification && typeof classification === 'object'
    ? (classification as Record<string, unknown>)['documentKind']
    : null;
  if (typeof rawDocumentKind === 'string' && INELIGIBLE_CLASSIFICATION_KINDS.has(rawDocumentKind)) {
    throw new BadRequestException('A finance override does not make a quotation, order, appointment, booking, reservation, or non-expense image eligible for substitute evidence.');
  }
  if (expense.currency !== 'THB') throw new BadRequestException('ใบรับรองแทนใบเสร็จรับเงิน currently supports THB expenses only.');
  if (!(Number(expense.grandTotalAmount) > 0)) throw new BadRequestException('A positive reviewed total is required.');
  if (!expense.lines.length || expense.lines.some((line) => !line.description.trim())) {
    throw new BadRequestException('Reviewed expense item details are required.');
  }
  assertSubstituteReceiptLinesRenderable(expense.lines);
  if (!expense.expenseCategoryId && !expense.accountHintKey && expense.lines.some((line) => !line.expenseCategoryId && !line.accountHintKey)) {
    throw new BadRequestException('A reviewed expense category or account hint is required.');
  }
  if (expense.taxEvidenceStatus === 'NEEDS_REVIEW') {
    throw new BadRequestException('Tax evidence status must be reviewed first.');
  }
  if (expense.taxEvidenceStatus === 'USABLE_FOR_TAX') {
    throw new BadRequestException('Internal substitute evidence cannot preserve input VAT. Set it to supporting/non-claimable or request an issuer-created replacement tax invoice.');
  }
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

async function notifySignaturePending(
  notify: CreateOrUpdateNotificationEventUseCase,
  ctx: RequestContext,
  evidence: Pick<SubstituteReceiptEvidenceRecord, 'id' | 'documentNumber'>,
  candidateUserIds: string[],
): Promise<void> {
  const recipientUserIds = candidateUserIds.filter((userId) => userId !== ctx.userId);
  if (recipientUserIds.length === 0) return;
  await notify.execute({
    companyId: ctx.companyId,
    triggerKey: 'expense.substitute_receipt_signature_pending',
    sourceModule: 'expenses',
    sourceType: 'substitute_receipt_evidence',
    sourceId: evidence.id,
    severity: 'action',
    title: `ใบรับรองแทนใบเสร็จรอการลงลายมือชื่อ เลขที่ ${evidence.documentNumber}`,
    body: 'เปิดระบบเพื่อตรวจสอบเอกสารและลงลายมือชื่อ',
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
    assertWeb(ctx);
    if (!ctx.permissions.includes('expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    if (!REASON_CODES.has(input.reasonCode)) throw new BadRequestException('Invalid substitute receipt reasonCode.');
    const reason = requiredText(input.missingReceiptReason, 'missingReceiptReason', 500);
    const purpose = requiredText(input.businessPurpose, 'businessPurpose', 500);
    const payerUserId = requiredText(input.payerUserId, 'payerUserId', 100);
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey', 128);
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
    if (!supportingIds.length) throw new BadRequestException('At least one original or supporting evidence attachment is required.');
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
      || (policy?.cashEvidencePolicy ?? 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE') === 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE')) {
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
        idempotencyKey,
      });
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.substitute_receipt.prepare',
        targetType: 'expense_substitute_receipt', targetId: evidence.id, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { expenseId, version: evidence.version, payerUserId },
      });
      try {
        await notifySignaturePending(this.notify, ctx, evidence, [payer.userId]);
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
    if (!['ISSUED', 'SUPERSEDED'].includes(evidence.status) || !evidence.artifactAttachmentId) {
      throw new ConflictException('The substitute-receipt certificate has not been issued yet.');
    }
    const attachment = await this.repo.findSubstituteArtifactAttachment(
      ctx.companyId,
      expenseId,
      evidence.artifactAttachmentId,
    );
    if (!attachment) throw new NotFoundException('Issued substitute-receipt artifact not found.');
    const svg = await this.storage.getObject({
      bucket: attachment.bucket,
      objectKey: attachment.objectKey,
      ...(attachment.objectVersionId ? { objectVersionId: attachment.objectVersionId } : {}),
    });
    // The immutable, checksummed SVG remains authoritative; this PDF is a derived printout generated on demand.
    const stateStamp = evidence.status === 'SUPERSEDED'
      ? evidence.supersedeReason === SUBSTITUTE_RECEIPT_EXPENSE_VOIDED_REASON ? 'VOID' : 'SUPERSEDED'
      : undefined;
    const data = await renderSubstituteReceiptPdf(svg.bytes, evidence.documentNumber, { stateStamp });
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
        derivedStamp: stateStamp ?? null,
      },
    });
    const stateSuffix = stateStamp ? `-${stateStamp}` : '';
    return { data, fileName: `${evidence.documentNumber.replace(/["\r\n]/g, '_')}${stateSuffix}.pdf` };
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
    const signature = await loadOwnedSignature(this.repo, this.storage, ctx.companyId, input.signatureAttachmentId, ctx.userId, evidence.id, 'payer');
    const certifiedAt = new Date();
    const snapshot = await buildSnapshot(this.repo, ctx.companyId, expense, evidence, payerPosition, certifiedAt.toISOString());
    const snapshotChecksumSha256 = canonicalSnapshotHash(snapshot);
    const bytes = renderSubstituteReceiptSvg(snapshot, signature.dataUrl);
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
        payerSignatureAttachmentId: signature.id,
        payerSignatureChecksumSha256: signature.checksumSha256,
        referencedAttachmentIds: [signature.id, ...evidence.paymentEvidenceAttachmentIds, ...evidence.supportingAttachmentIds],
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
        result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { expenseId, version: evidence.version, snapshotChecksumSha256 },
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
        await notifySignaturePending(this.notify, ctx, evidence, candidateUserIds);
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
    if (evidence.status !== 'PAYER_CERTIFIED' || !evidence.snapshotJson || !evidence.payerSignatureAttachmentId) {
      throw new ConflictException('The payer must certify an immutable snapshot before approval.');
    }
    if (!evidence.payerSignatureChecksumSha256) throw new ConflictException('The certified payer signature checksum is missing.');
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
    if (selfApproved && !(approvalMode === 'OWNER_SELF' && ctx.roles.includes('OWNER'))) {
      throw new ForbiddenException('Only the company owner may approve a substitute receipt they paid themselves.');
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
      && (policy?.cashEvidencePolicy ?? 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE') === 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE'
      && evidence.paymentEvidenceAttachmentIds.length === 0) {
      throw new ConflictException('Current company policy requires separate payment evidence for cash expenses. Supersede and prepare a new version.');
    }
    const approver = await this.repo.findActiveMemberIdentity(ctx.companyId, ctx.userId, expense.branchId);
    if (!approver) throw new ForbiddenException('Approver is not an active company member in this branch.');
    const expectedEvidenceUpdatedAt = parseExpectedDate(input.expectedEvidenceUpdatedAt, 'expectedEvidenceUpdatedAt');
    const snapshot = evidence.snapshotJson as unknown as SubstituteReceiptSnapshot;
    if (canonicalSnapshotHash(snapshot) !== evidence.snapshotChecksumSha256) throw new ConflictException('Certified snapshot checksum is invalid.');
    assertSubstituteReceiptSnapshotRenderable(snapshot);
    const approverSignature = await loadOwnedSignature(this.repo, this.storage, ctx.companyId, input.signatureAttachmentId, ctx.userId, evidence.id, 'approver');
    const payerSignature = await loadOwnedSignature(this.repo, this.storage, ctx.companyId, evidence.payerSignatureAttachmentId, evidence.payerUserId, evidence.id, 'payer');
    if (payerSignature.checksumSha256 !== evidence.payerSignatureChecksumSha256) {
      throw new ConflictException('The payer signature changed after certification.');
    }
    const approvedAt = new Date();
    const approverDetails = { userId: ctx.userId, name: approver.displayName, position: approverPosition, approvedAt: approvedAt.toISOString() };
    const bytes = renderSubstituteReceiptSvg(snapshot, payerSignature.dataUrl, approverDetails, approverSignature.dataUrl);
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
        allowSelfApproval: approvalMode === 'OWNER_SELF' && ctx.roles.includes('OWNER'),
        approverSignatureAttachmentId: approverSignature.id,
        approvedAt,
        expectedExpenseUpdatedAt: evidence.expenseUpdatedAtAtPreparation,
        referencedAttachmentIds: [
          approverSignature.id,
          evidence.payerSignatureAttachmentId,
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
        result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { expenseId, version: evidence.version, checksumSha256, selfApproved },
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

async function loadOwnedSignature(
  repo: PrismaExpenseRepository,
  storage: AttachmentStoragePort,
  companyId: string,
  attachmentId: string,
  userId: string,
  evidenceId: string,
  role: 'payer' | 'approver',
): Promise<{ id: string; dataUrl: string; checksumSha256: string }> {
  const attachment = await repo.findPersonalSignatureAttachment(companyId, attachmentId, userId, evidenceId, role);
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
  return { id: attachment.id, dataUrl: `data:${attachment.mimeType};base64,${object.bytes.toString('base64')}`, checksumSha256: checksum };
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
    if (selfApproved && !(approvalMode === 'OWNER_SELF' && ctx.roles.includes('OWNER'))) {
      throw new ForbiddenException('Only the company owner may approve a substitute receipt they paid themselves.');
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
