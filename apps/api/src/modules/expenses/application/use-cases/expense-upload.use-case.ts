import { assertDemoReadAvailable } from '../../../sales-demo/application/demo-read-limit';
import { REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES } from '@watchdog-bms/contracts';
import { REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES } from '../../../reimbursements/domain/reimbursement.constants';
import { looksLikeAccountNumber } from '@watchdog-bms/contracts';
import { expenseDraftAccess, assertExpenseFinancialAccess } from '../expense-commercial-access';
import { assertFreeExpenseUploadAvailable, verifyFreeExpenseUploadReservation, type FreeExpenseUploadReservation } from '../../../data-model-core/application/use-cases/free-expense-attachment';
import { lockPlanTermCompany } from '../../../system-partner-management/application/lock-plan-term-company';
import { Injectable, ForbiddenException, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { Prisma } from '../../../../generated/prisma/client';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { reconcileExpenseDuplicateCandidates } from '../services/expense-duplicate-detection';
import { GetExpenseCapturePolicyUseCase } from './expense-capture-policy.use-case';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { assertExpenseRootOpen } from '../expense-launch-gate';
import type { ExpenseReceiptUploadIntent, RequestContext } from '@watchdog-bms/contracts';
import type { ExpenseRecord } from '../../domain/models/expense.model';
import { civilDateToUtcDate, coerceCivilDate, todayCivilDate } from '@watchdog-bms/contracts';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { lockFundingEvidence } from '../../infrastructure/substitute-funding.guard';
import { observeCustomerJourney } from '../../../../common/observability/customer-journey-audit';

export type InitReceiptUploadResult = {
  expenseId: string;
  attachmentId: string;
  uploadUrl: string;
  uploadMethod: string;
  uploadHeaders: Record<string, string>;
  expiresAt: Date;
  /** False when durable bytes from the original attempt are already present. */
  uploadRequired?: boolean;
  reusedCapture?: boolean;
};

@Injectable()
export class InitReceiptUploadUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly createIntent: CreateUploadIntentUseCase,
    private readonly audit: AuditService,
    private readonly capturePolicy: GetExpenseCapturePolicyUseCase,
    private readonly launchGate: LaunchGateGuardService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async execute(
    ctx: RequestContext,
    cmd: {
      originalFileName: string;
      mimeType: string;
      byteSize: number;
      expenseDate?: string;
      branchId?: string;
      note?: string;
      captureSource?: 'WEB_UPLOAD' | 'LINE_UPLOAD';
      /** Internal LINE identity; never populated from the public upload DTO. */
      lineCapture?: {
        lineMessageId: string; lineEventId: string; chatKeyHash: string;
        /**
         * Appendix §25: the chat this file arrived in, so a finished read can be pushed back INTO
         * it. `chatKeyHash` is a hash and can only ever CONFIRM a destination, never produce one —
         * the group table used to carry this in `linePushTargetId` and the expense lane needs the
         * same guarantee for a group chat.
         */
        pushTargetId?: string;
        ownerBinding?: { conversationId: string; membershipId: string; channelId: string; ownerEpoch: number };
      };
    },
    options?: { freeIntakeLocked?: boolean; freeOcrReservation?: FreeExpenseUploadReservation },
  ): Promise<InitReceiptUploadResult> {
    if (!ctx.permissions.includes('expense.receipt.upload') && !ctx.permissions.includes('expense.receipt.line_upload') && !ctx.permissions.includes('expense.create')) {
      throw new ForbiddenException('Missing permission: expense.receipt.upload');
    }
    if (ctx.authProvider !== 'line' && this.prisma) await assertDemoReadAvailable(this.prisma.client, ctx);
    const freeExpenseDrafts = await expenseDraftAccess(ctx, this.repo.commercialAccessDb);
    const freeUpload = freeExpenseDrafts || Boolean(options?.freeOcrReservation);
    if (options?.freeOcrReservation && (ctx.authProvider !== 'line' || cmd.captureSource !== 'LINE_UPLOAD'
      || !cmd.lineCapture || options.freeOcrReservation.requestId !== cmd.lineCapture.lineMessageId)) {
      throw new ForbiddenException('Invalid admitted LINE receipt identity.');
    }
    if (freeUpload && !options?.freeIntakeLocked) {
      if (!this.prisma) throw new ForbiddenException('Receipt storage unavailable.');
      return this.prisma.client.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`free-expense-upload:${ctx.companyId}`}))`;
        return this.execute(ctx, cmd, { ...options, freeIntakeLocked: true });
      });
    }
    if (freeUpload) {
      const existing = cmd.lineCapture && await this.repo.findByLineMessageId(ctx.companyId, cmd.lineCapture.lineMessageId);
      if (!existing) {
        await assertFreeExpenseUploadAvailable({ client: this.repo.commercialAccessDb } as any, ctx.companyId,
          options?.freeOcrReservation, cmd.lineCapture?.lineMessageId);
      } else if (options?.freeOcrReservation) {
        await verifyFreeExpenseUploadReservation({ client: this.repo.commercialAccessDb } as any, ctx.companyId,
          options.freeOcrReservation, cmd.lineCapture?.lineMessageId);
      }
    }
    // The other root of the expenses journey — the receipt upload. Guarded HERE, on the
    // expenses-specific entry, not in the shared `CreateUploadIntentUseCase`: that one also serves
    // every other module's attachments, which the `expenses` gate has no authority over.
    await assertExpenseRootOpen(this.launchGate, this.audit, ctx, 'expense.upload_intent.create');
    if (!isBranchInScope(ctx.scopes ?? {}, cmd.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    // Reject before reserving storage or creating an attachment, not only when saving the draft.
    const branchId = await this.repo.resolveCreateBranchId(ctx.companyId, ctx.scopes ?? {}, cmd.branchId);
    const suppliedDate = cmd.expenseDate === undefined ? undefined : coerceCivilDate(cmd.expenseDate);
    // The required storage column keeps an internal placeholder; unknown is explicit from creation.
    const expenseDate = civilDateToUtcDate(suppliedDate ?? todayCivilDate());

    // LINE reserves the unique expense identity before storage. Web preserves its existing order.
    const createAttachment = (expenseId?: string) => this.createIntent.execute(ctx, {
      originalFileName: cmd.originalFileName, mimeType: cmd.mimeType, byteSize: cmd.byteSize,
      ...(branchId ? { branchId } : {}),
      ...(expenseId ? { metadataJson: { lineReceiptExpenseId: expenseId } } : {}),
    }, expenseId ? { expenseId, ...(options?.freeOcrReservation ? { freeOcrReservation: options.freeOcrReservation } : {}) } : undefined);
    if (cmd.lineCapture && (cmd.captureSource !== 'LINE_UPLOAD' || ctx.authProvider !== 'line')) throw new BadRequestException('Invalid LINE capture identity.');
    const webIntent = cmd.lineCapture || freeUpload ? undefined : await createAttachment();

    // A company that is not asked Thai VAT questions cannot answer a claimability review either,
    // so its uploads land NON_CLAIMABLE instead of filling the review queue with a decision
    // nobody can make. Confirmation never blocked on this, so the change is queue noise, not flow.
    const { mode } = await this.capturePolicy.execute(ctx, cmd.expenseDate);

    // Create the expense draft with NO_VAT default and empty totals until review
    const createExpense = () => this.repo.createExpense({
      companyId: ctx.companyId,
      branchId: branchId ?? undefined,
      captureSource: cmd.captureSource ?? 'WEB_UPLOAD',
      ...(cmd.lineCapture ? {
        lineMessageId: cmd.lineCapture.lineMessageId, lineEventId: cmd.lineCapture.lineEventId,
        sourceChannelMetadataJson: { channel: 'LINE', kind: 'media', chatKeyHash: cmd.lineCapture.chatKeyHash, receiptCapturePending: true,
          ...(cmd.lineCapture.pushTargetId ? { pushTargetId: cmd.lineCapture.pushTargetId } : {}),
          ...(cmd.lineCapture.ownerBinding && cmd.lineCapture.ownerBinding.membershipId === ctx.membershipId ? { ownerBinding: cmd.lineCapture.ownerBinding } : {}),
          receiptUpload: { originalFileName: cmd.originalFileName, mimeType: cmd.mimeType, byteSize: cmd.byteSize } },
      } : {}),
      // Date-only after shared validation/coercion. An instant from the LINE path must never put a
      // time into the column, or the list's day filter cannot see the row.
      expenseDate,
      aiVerificationSummaryJson: suppliedDate ? {
        dateStatus: 'verified',
        dateResolution: { expenseDate: suppliedDate, resolvedByUserId: ctx.userId, resolvedAt: new Date().toISOString() },
      } : { dateStatus: 'unverified', missingFields: ['expenseDate'] },
      currency: 'THB',
      vatMode: 'NO_VAT',
      inputVatClaimStatus: mode === 'SIMPLE' ? 'NON_CLAIMABLE' : 'NEEDS_REVIEW',
      note: cmd.note,
      createdByUserId: ctx.userId,
      subtotalAmount: '0',
      discountAmount: '0',
      taxableAmount: '0',
      vatAmount: '0',
      whtAmount: '0',
      grandTotalAmount: '0',
      netPayableAmount: '0',
      outstandingAmount: '0',
    });

    const existing = cmd.lineCapture ? await this.repo.findByLineMessageId(ctx.companyId, cmd.lineCapture.lineMessageId) : null;
    let reusedCapture = Boolean(existing);
    const expense = existing ?? await createExpense().catch(async (error) => {
      if (!cmd.lineCapture || (error as { code?: string }).code !== 'P2002') throw error;
      const winner = await this.repo.findByLineMessageId(ctx.companyId, cmd.lineCapture.lineMessageId);
      if (!winner) throw error;
      reusedCapture = true;
      return winner;
    });
    if (cmd.lineCapture && (expense.createdByUserId !== ctx.userId || !isBranchInScope(ctx.scopes ?? {}, expense.branchId))) throw new ForbiddenException();
    const intent: Omit<InitReceiptUploadResult, 'expenseId'> = webIntent ?? (cmd.lineCapture
      ? await this.reserveLineAttachment(ctx, expense.id, createAttachment) : await createAttachment(expense.id));

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.upload_intent.create', targetType: 'expense_record', targetId: expense.id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { attachmentId: intent.attachmentId, mimeType: cmd.mimeType },
    });

    return {
      expenseId: expense.id,
      ...(cmd.lineCapture ? { reusedCapture } : {}),
      attachmentId: intent.attachmentId,
      uploadUrl: intent.uploadUrl,
      uploadMethod: intent.uploadMethod,
      uploadHeaders: intent.uploadHeaders,
      expiresAt: intent.expiresAt,
      ...(intent.uploadRequired !== undefined ? { uploadRequired: intent.uploadRequired } : {}),
    };
  }
  private async reserveLineAttachment(
    ctx: RequestContext, expenseId: string,
    createAttachment: (expenseId: string) => Promise<Omit<InitReceiptUploadResult, 'expenseId'>>,
  ): Promise<Omit<InitReceiptUploadResult, 'expenseId'>> {
    if (!this.prisma) throw new Error('LINE_RECEIPT_STORAGE_UNAVAILABLE');
    // Serialize only this receipt's reservation. Existing storage helper creates short-lived URLs;
    // no upload or OCR runs while the lock is held.
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-receipt-attachment:${expenseId}`}))`;
      const attachment = await tx.attachmentObject.findFirst({
        where: { companyId: ctx.companyId, uploadedByUserId: ctx.userId,
          metadataJson: { path: ['lineReceiptExpenseId'], equals: expenseId },
          status: { in: ['PENDING_UPLOAD', 'ACTIVE'] } },
        select: { id: true }, orderBy: { createdAt: 'asc' },
      });
      return attachment ? this.createIntent.resume(ctx, attachment.id) : createAttachment(expenseId);
    });
  }

}

/** Spec §16.4: the three statuses either file intent may touch at all. */
const FILE_INTENT_OPEN_STATUSES = new Set(['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION']);
const EXPENSE_ATTACHMENT_PURPOSES = ['expense.receipt.primary', 'expense.receipt.supporting', 'expense.payment.evidence'];
/** A claim in one of these is over; anything else still owns the evidence it points at. */
const TERMINAL_CLAIM_STATUSES = ['REJECTED', 'CANCELLED', 'VOIDED'] as const;
/** Enough history to answer a retry, not an audit log — the audit trail is the audit log. */
const MAX_RECEIPT_FILE_OPERATIONS = 10;

export type CompleteReceiptUploadCommand = {
  expenseId: string;
  attachmentId: string;
  checksumSha256?: string;
  byteSize?: number;
  purpose?: string;
  /** §16.4. Absent = the legacy completion, behaviour unchanged. */
  intent?: ExpenseReceiptUploadIntent;
  expectedUpdatedAt?: string;
  expectedPrimaryAttachmentId?: string;
  operationId?: string;
};

/** What one completed `intent` call did, kept so its retry answers the same thing (§16.4). */
export type ExpenseReceiptFileOperation = {
  operationId: string;
  intent: ExpenseReceiptUploadIntent;
  attachmentId: string;
  checksumSha256: string | null;
  at: string;
};

export function readReceiptFileOperations(metadata: Record<string, unknown> | null): ExpenseReceiptFileOperation[] {
  const stored = metadata?.['replaceOperations'];
  return Array.isArray(stored)
    ? stored.filter((entry): entry is ExpenseReceiptFileOperation =>
      Boolean(entry) && typeof entry === 'object' && typeof (entry as ExpenseReceiptFileOperation).operationId === 'string')
    : [];
}

export function recordReceiptFileOperation(
  metadata: Record<string, unknown> | null,
  operation: ExpenseReceiptFileOperation,
): Record<string, unknown> {
  const kept = readReceiptFileOperations(metadata).filter((entry) => entry.operationId !== operation.operationId);
  return { ...(metadata ?? {}), replaceOperations: [...kept, operation].slice(-MAX_RECEIPT_FILE_OPERATIONS) };
}

/**
 * Whether a completion carrying `operationId` is the SAME operation (its answer was lost) or a
 * different one wearing the same id. `null` means this operation has not run yet.
 */
export function receiptFileOperationReplay(
  operations: ExpenseReceiptFileOperation[],
  cmd: { operationId?: string; attachmentId: string; checksumSha256?: string; intent: ExpenseReceiptUploadIntent },
): 'replay' | 'conflict' | null {
  const previous = cmd.operationId ? operations.find((entry) => entry.operationId === cmd.operationId) : undefined;
  if (!previous) return null;
  const sameBytes = !cmd.checksumSha256 || !previous.checksumSha256 || previous.checksumSha256 === cmd.checksumSha256;
  return previous.attachmentId === cmd.attachmentId && previous.intent === cmd.intent && sameBytes ? 'replay' : 'conflict';
}

/** Shared by web append/replace and LINE evidence association, on the caller's transaction. */
export async function assertExpenseReceiptFileStateAllowed(
  ctx: RequestContext,
  expense: { id: string; status: string; paymentStatus: string; paidAmount: unknown; postingStatus: string },
  intent: ExpenseReceiptUploadIntent,
  db: Prisma.TransactionClient,
): Promise<void> {
  const conflict = (code: string, message: string) => new ConflictException({ code, message });
  const locked = (message: string) => conflict('expense_receipt_replace_locked', message);
    if (!FILE_INTENT_OPEN_STATUSES.has(expense.status)) {
      throw locked(expense.status === 'CONFIRMED'
        ? 'รายจ่ายนี้ยืนยันแล้ว กดแก้ไขเอกสารก่อนแนบหลักฐานเพิ่ม'
        : 'รายจ่ายนี้ปิดแล้ว แนบหลักฐานให้รายจ่ายที่ยังเปิดตรวจอยู่หรือสร้างรายจ่ายใหม่');
    }
    if (intent === 'replace' && expense.status === 'READY_FOR_CONFIRMATION' && !ctx.permissions.includes('expense.review')) {
      throw locked('รายจ่ายนี้ส่งให้ตรวจแล้ว ให้คนที่มีสิทธิ์ตรวจรายจ่ายเปลี่ยนไฟล์ใบเสร็จให้');
    }
    if (expense.postingStatus !== 'not_required') {
      throw locked('รายจ่ายนี้บันทึกบัญชีแล้ว ให้คนที่ดูแลบัญชีแก้รายการบัญชีก่อนแนบหรือเปลี่ยนไฟล์');
    }
    if (intent === 'replace' && (expense.paymentStatus !== 'UNPAID' || Number(expense.paidAmount ?? 0) > 0)) {
      throw locked('รายจ่ายนี้บันทึกจ่ายแล้ว เปลี่ยนใบเสร็จหลักไม่ได้ ให้แนบเป็นหลักฐานเพิ่ม');
    }

    // A PREPARED certificate still accepts supporting evidence that changes no fact (§16.4 row 3);
    // a signed one accepts nothing here at all.
    const certificate = await db.expenseSubstituteReceiptEvidence.findFirst({
      where: {
        companyId: ctx.companyId, expenseId: expense.id,
        status: { in: intent === 'append' ? ['PAYER_CERTIFIED', 'ISSUED'] : ['PREPARED', 'PAYER_CERTIFIED', 'ISSUED'] },
      },
      select: { id: true },
    });
    if (certificate) {
      throw conflict(
        'substitute_evidence_locks_expense',
        'รายการนี้มีใบรับรองแทนใบเสร็จแล้ว การเปลี่ยนหลักฐานต้องทำผ่านการแก้ไขใบรับรองเดิม',
      );
    }
    const claim = await db.reimbursementLine.findFirst({
      where: {
        companyId: ctx.companyId, linkedExpenseId: expense.id,
        request: { status: { notIn: [...TERMINAL_CLAIM_STATUSES] } },
      },
      select: { id: true },
    });
    if (claim) {
      throw conflict(
        'substitute_source_has_live_claim',
        'หลักฐานนี้อยู่ในคำขอเบิกที่ยังดำเนินการอยู่ กรุณาดำเนินการผ่านคำขอเบิกเดิม',
      );
    }
}

@Injectable()
export class CompleteReceiptUploadUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly completeUpload: CompleteAttachmentUploadUseCase,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly attachments: PrismaAttachmentRepository,
    private readonly prisma: PrismaService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  async execute(
    ctx: RequestContext,
    cmd: CompleteReceiptUploadCommand,
    options?: { beforeCommit: () => Promise<void> },
  ): Promise<ExpenseRecord> {
    return observeCustomerJourney(
      this.audit,
      {
        key: 'receipt-intake', requestId: ctx.requestId, targetType: 'expense_record', targetId: cmd.expenseId,
        companyId: ctx.companyId, actorUserId: ctx.userId,
      },
      () => this.complete(ctx, cmd, options),
      () => ({ outcome: 'uploaded' }),
    );
  }

  private async complete(
    ctx: RequestContext,
    cmd: CompleteReceiptUploadCommand,
    options?: { beforeCommit: () => Promise<void> },
  ): Promise<ExpenseRecord> {
    if (ctx.authProvider !== 'line' && this.prisma) await assertDemoReadAvailable(this.prisma.client, ctx);
    const freeExpenseDrafts = await expenseDraftAccess(ctx, this.repo.commercialAccessDb);
    const expense = await this.repo.findById(ctx.companyId, cmd.expenseId);
    if (!expense) throw new NotFoundException(`Expense ${cmd.expenseId} not found`);
    if (!isBranchInScope(ctx.scopes ?? {}, expense.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    if (!expense.updatedAt) throw new ConflictException('Expense revision unavailable. Reload before uploading.');

    const canUpload = (ctx.permissions.includes('expense.receipt.upload') || ctx.permissions.includes('expense.receipt.line_upload')) && expense.createdByUserId === ctx.userId;
    const canReview = ctx.permissions.includes('expense.review');
    if (!canUpload && !canReview) throw new ForbiddenException('Missing permission: expense.receipt.upload');

    // §16.4 runs BEFORE the bytes are verified and re-keyed: a refused replace must leave the
    // current primary and the current facts exactly as they were, and the uploaded object stays a
    // pending orphan for the existing cleanup rather than becoming evidence of anything.
    const purpose = cmd.purpose ?? (cmd.intent === 'append' ? 'expense.receipt.supporting' : 'expense.receipt.primary');
    if (freeExpenseDrafts && (expense.createdByUserId !== ctx.userId || !['DRAFT', 'NEEDS_REVIEW'].includes(expense.status)
      || !['LINE_UPLOAD', 'WEB_UPLOAD'].includes(expense.captureSource) || purpose === 'expense.payment.evidence')) {
      throw new ForbiddenException({ code: 'FREE_EXPENSE_DRAFTS_ONLY', message: 'เพิ่มไฟล์ได้เฉพาะร่างรายจ่ายของตนเอง' });
    }
    if (freeExpenseDrafts) {
      const sourceFile = await this.attachments.findById({ id: cmd.attachmentId, companyId: ctx.companyId });
      const source = sourceFile?.metadataJson?.freeExpenseSource as { kind?: string; id?: string } | undefined;
      if (!sourceFile || sourceFile.uploadedByUserId !== ctx.userId || source?.kind !== 'EXPENSE' || source.id !== expense.id) {
        throw new ForbiddenException('Attachment is not bound to this source draft.');
      }
    }
    if (!EXPENSE_ATTACHMENT_PURPOSES.includes(purpose)) {
      throw new BadRequestException('Unsupported expense attachment purpose.');
    }
    if (cmd.intent === 'append' && purpose === 'expense.receipt.primary') {
      throw new BadRequestException('"append" adds supporting evidence; use "replace" to change the receipt.');
    }
    if (cmd.intent === 'replace' && purpose !== 'expense.receipt.primary') {
      throw new BadRequestException('"replace" targets the primary receipt.');
    }
    if (cmd.intent) {
      const replayed = await this.assertFileIntentAllowed(ctx, expense, cmd, cmd.intent);
      if (replayed) return replayed;
    }

    const reserved = expense.captureSource === 'LINE_UPLOAD' && expense.lineMessageId
      ? await this.attachments.findById({ id: cmd.attachmentId, companyId: ctx.companyId }) : null;
    const resumed = reserved?.status === 'ACTIVE' && reserved.uploadedByUserId === ctx.userId
      && reserved.metadataJson?.lineReceiptExpenseId === expense.id;
    if (resumed && cmd.checksumSha256 && reserved.checksumSha256 !== cmd.checksumSha256) throw new BadRequestException('Receipt checksum changed.');
    if (!resumed) await this.completeUpload.execute(ctx, {
      attachmentId: cmd.attachmentId, checksumSha256: cmd.checksumSha256, byteSize: cmd.byteSize,
    }, { inspectionPolicy: 'RECEIPT' });

    const current = await this.permissionResolver.resolveAccess(ctx.userId, ctx.companyId);
    const activeUser = await this.prisma.client.user.findFirst({ where: { id: ctx.userId, status: 'ACTIVE' }, select: { id: true } });
    const mayUpload = (current.permissions.includes('expense.receipt.upload') || current.permissions.includes('expense.receipt.line_upload')) && expense.createdByUserId === ctx.userId;
    if (!activeUser || current.companyId !== ctx.companyId || ctx.membershipId && current.membershipId !== ctx.membershipId
      || (!mayUpload && !current.permissions.includes('expense.review')) || !isBranchInScope(current.scopes ?? {}, expense.branchId)) {
      throw new ForbiddenException('Receipt access changed. Reload and check your permissions.');
    }
    await options?.beforeCommit();
    const replacedPrimaryId = purpose === 'expense.receipt.primary' && expense.primaryAttachmentId
      && expense.primaryAttachmentId !== cmd.attachmentId ? expense.primaryAttachmentId : null;
    // §16.4: a replace on a record already sent for confirmation returns it to review in the same
    // write. Nothing stays READY on the strength of a file it no longer holds.
    const nextStatus = expense.status === 'DRAFT'
      || (cmd.intent === 'replace' && expense.status === 'READY_FOR_CONFIRMATION')
      ? 'NEEDS_REVIEW' as const
      : expense.status;
    // §16.4 again: the values on screen were read from the file that just left. They are KEPT — a
    // person may have checked them — but they now carry the file they came from, and the AI status
    // drops to NOT_VERIFIED so nothing reads as verified against a file no reader has seen.
    const staleProvenance = replacedPrimaryId && cmd.intent === 'replace' ? {
      aiVerificationStatus: 'NOT_VERIFIED' as const,
      aiVerificationSummaryJson: {
        ...Object.fromEntries(Object.entries(expense.aiVerificationSummaryJson ?? {})
          .filter(([key]) => key !== 'extractionAttachmentId')),
        sourceAttachmentId: replacedPrimaryId,
        sourceStale: true,
      },
    } : {};
    const operationRecord = cmd.operationId && cmd.intent ? {
      sourceChannelMetadataJson: recordReceiptFileOperation(expense.sourceChannelMetadataJson, {
        operationId: cmd.operationId, intent: cmd.intent, attachmentId: cmd.attachmentId,
        checksumSha256: cmd.checksumSha256 ?? null, at: new Date().toISOString(),
      }),
    } : {};
    // Storage is complete. Bind every database effect to the revision the upload began with.
    // A late upload must not roll back human review or partially retire the previous receipt.
    let retiredAttachmentIds: string[] = [];
    const updated = await this.prisma.client.$transaction(async tx => {
      if (this.repo.commercialAccessDb) {
        await lockPlanTermCompany(tx, ctx.companyId);
        const currentFree = await expenseDraftAccess(ctx, tx);
        if (currentFree && (expense.createdByUserId !== ctx.userId || !['DRAFT', 'NEEDS_REVIEW'].includes(expense.status) || purpose === 'expense.payment.evidence')) {
          throw new ForbiddenException({ code: 'FREE_EXPENSE_DRAFTS_ONLY' });
        }
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:duplicate-reconciliation`}))`;
      await lockFundingEvidence(tx, ctx.companyId, { expenseIds: [cmd.expenseId], attachmentIds: [cmd.attachmentId] });
      await this.repo.updateExpense({
        id: cmd.expenseId, companyId: ctx.companyId, updatedByUserId: ctx.userId,
        expectedUpdatedAt: expense.updatedAt,
        ...(purpose === 'expense.receipt.primary' ? {
          primaryAttachmentId: cmd.attachmentId,
          status: nextStatus,
        } : {}),
        ...staleProvenance,
        ...operationRecord,
      }, async db => {
        await this.repo.linkAttachment(cmd.expenseId, cmd.attachmentId, purpose, ctx.companyId, ctx.userId, db);
        if (purpose === 'expense.receipt.primary') {
          retiredAttachmentIds = await this.retireReplacedPrimaryReceipts(ctx, expense, cmd.attachmentId, db);
          await reconcileExpenseDuplicateCandidates(this.repo, ctx.companyId, cmd.expenseId, ctx.userId, current.scopes ?? {}, db);
        }
      }, tx);
      const saved = await this.repo.findById(ctx.companyId, cmd.expenseId, tx);
      if (!saved) throw new ConflictException('Expense changed. Reload and review before uploading again.');
      return saved;
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.upload.complete', targetType: 'expense_record', targetId: cmd.expenseId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: {
        attachmentId: cmd.attachmentId, purpose,
        ...(cmd.intent && { intent: cmd.intent, statusFrom: expense.status, statusTo: nextStatus }),
        ...(cmd.operationId && { operationId: cmd.operationId }),
        ...(replacedPrimaryId && cmd.intent === 'replace' && { sourceAttachmentId: replacedPrimaryId, sourceStale: true }),
        ...(retiredAttachmentIds.length > 0 && { replacedAttachmentIds: retiredAttachmentIds }),
      },
    });
    void this.outbox.append('expense.receipt_uploaded', 'expense_record', cmd.expenseId, {
      companyId: ctx.companyId, aggregateType: 'expense_record', aggregateId: cmd.expenseId, requestId: ctx.requestId,
      occurredAt: new Date().toISOString(), data: { expenseId: cmd.expenseId, attachmentId: cmd.attachmentId, purpose },
    });

    return updated;
  }

  /**
   * The server half of the §16.4 matrix. Runs before any storage effect, answers one typed code per
   * reason, and never depends on the client having hidden a button.
   *
   * Returns the untouched expense when this exact operation already ran — the retry of a lost
   * response must not create a second winner — and `null` when the completion may proceed.
   */
  private async assertFileIntentAllowed(
    ctx: RequestContext,
    expense: ExpenseRecord,
    cmd: CompleteReceiptUploadCommand,
    intent: ExpenseReceiptUploadIntent,
  ): Promise<ExpenseRecord | null> {
    const conflict = (code: string, message: string) => new ConflictException({ code, message });

    // Identity first: a retry carries the revision the user saw BEFORE the first attempt landed, so
    // checking the revision before the operation would turn every recovered response into a conflict.
    const replay = receiptFileOperationReplay(readReceiptFileOperations(expense.sourceChannelMetadataJson), {
      ...(cmd.operationId ? { operationId: cmd.operationId } : {}),
      attachmentId: cmd.attachmentId,
      ...(cmd.checksumSha256 ? { checksumSha256: cmd.checksumSha256 } : {}),
      intent,
    });
    if (replay === 'conflict') {
      throw conflict(
        'expense_receipt_replace_operation_conflict',
        'รายการนี้มีการเปลี่ยนไฟล์ด้วยรหัสเดียวกันไปแล้วด้วยไฟล์อื่น กรุณาเปิดข้อมูลล่าสุดก่อนทำต่อ',
      );
    }
    if (replay === 'replay') return expense;

    if (cmd.expectedUpdatedAt === undefined
      || new Date(cmd.expectedUpdatedAt).getTime() !== expense.updatedAt!.getTime()) {
      throw conflict('expense_revision_conflict', 'รายการนี้มีการเปลี่ยนแปลง กรุณาเปิดข้อมูลล่าสุดก่อนทำต่อ');
    }
    if (intent === 'replace' && (cmd.expectedPrimaryAttachmentId ?? null) !== (expense.primaryAttachmentId ?? null)) {
      throw conflict(
        'expense_receipt_replace_conflict',
        'ไฟล์ใบเสร็จของรายการนี้ถูกเปลี่ยนไปแล้ว กรุณาเปิดข้อมูลล่าสุดก่อนเปลี่ยนไฟล์อีกครั้ง',
      );
    }

    await assertExpenseReceiptFileStateAllowed(ctx, expense, intent, this.prisma.client);
    return null;
  }

  /**
   * "เปลี่ยนไฟล์ใบเสร็จ" REPLACES the receipt while the record is still being drafted.
   *
   * Owner report 2026-08-29 (UAT): re-uploading appended — `linkAttachment` only ever creates a row,
   * so the wrong file stayed on the record (the new one showed as page 2 of 2) and both remained
   * ACTIVE primaries. Retiring means: drop this expense's link, then soft-delete the object the same
   * way `DeleteExpenseUseCase` detaches attachments (row and bytes retained, `deletedAt` stamped) —
   * nothing is hard-deleted.
   *
   * Deliberately narrow, because the fallback is exactly today's append:
   * - DRAFT/NEEDS_REVIEW only. Once the record is with an approver, a receipt they have already seen
   *   must not disappear under them.
   * - A file a certified substitute receipt retains, or one another record also links, is left alone.
   */
  private async retireReplacedPrimaryReceipts(
    ctx: RequestContext,
    expense: { id: string; status: string },
    keepAttachmentId: string,
    tx: any,
  ): Promise<string[]> {
    if (expense.status !== 'DRAFT' && expense.status !== 'NEEDS_REVIEW') return [];
    const link = { companyId: ctx.companyId, targetType: 'expense.record', targetId: expense.id };
    const stale = await tx.attachmentLink.findMany({
      where: {
        ...link,
        purpose: 'expense.receipt.primary',
        attachmentId: { not: keepAttachmentId },
        attachment: { companyId: ctx.companyId, status: 'ACTIVE' },
      },
      select: { attachmentId: true },
    });
    const retired: string[] = [];
    for (const { attachmentId } of stale) {
      const sharedLinks = await tx.attachmentLink.count({
        where: { companyId: ctx.companyId, attachmentId, NOT: { targetType: link.targetType, targetId: link.targetId } },
      });
      if (sharedLinks > 0) continue;
      const hold = await this.attachments.findSubstituteEvidenceRetentionHold({ id: attachmentId, companyId: ctx.companyId }, tx);
      if (hold) continue;
      await tx.attachmentLink.deleteMany({ where: { ...link, attachmentId } });
      await this.attachments.markDeleted({ id: attachmentId, companyId: ctx.companyId }, tx);
      retired.push(attachmentId);
    }
    return retired;
  }
}

@Injectable()
export class GetExpenseSourcePostingInputUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, expenseId: string) {
    // Only internal-service or ledger adapter has explicit expense.read permission
    if (!ctx.permissions.includes('expense.read') && !ctx.permissions.includes('expense.review')) {
      throw new ForbiddenException('Missing permission: expense.read');
    }
    const r = await this.repo.findByIdWithRelations(ctx.companyId, expenseId);
    if (!r) throw new NotFoundException(`Expense ${expenseId} not found`);
    if (!isBranchInScope(ctx.scopes ?? {}, r.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    if (r.status !== 'CONFIRMED' && r.status !== 'VOIDED') {
      throw new BadRequestException(`Source posting input only available for CONFIRMED or VOIDED expenses`);
    }

    const eventType = r.status === 'VOIDED' ? 'voided' : 'confirmed';
    return {
      companyId: r.companyId,
      branchId: r.branchId,
      sourceType: 'expense.record' as const,
      sourceId: r.id,
      sourceEventType: eventType,
      idempotencyKey: `expense:${eventType}:${r.id}`,
      expenseNumber: r.expenseNumber,
      expenseDate: r.expenseDate.toISOString(),
      uploadedAt: r.uploadedAt.toISOString(),
      sourceDocumentType: r.sourceDocumentType,
      taxEvidenceStatus: r.taxEvidenceStatus,
      taxEvidenceReasonCode: r.taxEvidenceReasonCode,
      vendorCounterpartyId: r.vendorCounterpartyId,
      vendorSnapshot: r.vendorSnapshotJson,
      currency: r.currency,
      vatMode: r.vatMode,
      inputVatClaimStatus: r.inputVatClaimStatus,
      subtotalAmount: r.subtotalAmount,
      discountAmount: r.discountAmount,
      taxableAmount: r.taxableAmount,
      vatAmount: r.vatAmount,
      whtAmount: r.whtAmount,
      grandTotalAmount: r.grandTotalAmount,
      netPayableAmount: r.netPayableAmount,
      paidAmount: r.paidAmount,
      outstandingAmount: r.outstandingAmount,
      paymentStatus: r.paymentStatus,
      paymentMethod: r.paymentMethod,
      paidAt: r.paidAt?.toISOString() ?? null,
      bankAccountRef: r.bankAccountRef,
      expenseCategoryId: r.expenseCategoryId,
      accountHintKey: r.accountHintKey,
      taxCategory: r.taxCategory,
      lines: r.lines,
      // Attachments: ids, purpose, MIME only — no object keys or URLs
      attachments: r.attachments.map((a) => ({ id: a.id, purpose: a.purpose, mimeType: a.mimeType, checksumSha256: a.checksumSha256, createdAt: a.createdAt })),
      duplicateStatus: r.duplicateStatus,
      duplicateOverrideReason: r.duplicateOverrideReason,
      postingStatus: r.postingStatus,
    };
  }
}

@Injectable()
export class DuplicateCheckUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, expenseId: string): Promise<{ candidatesCreated: number; openCandidates: number }> {
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    if (!ctx.permissions.includes('expense.review') && !ctx.permissions.includes('expense.duplicate.resolve')) {
      throw new ForbiddenException('Missing permission: expense.review');
    }
    const result = await reconcileExpenseDuplicateCandidates(this.repo, ctx.companyId, expenseId, ctx.userId, ctx.scopes ?? {});
    return { candidatesCreated: result.openCandidates, openCandidates: result.openCandidates };
  }
}

@Injectable()
export class ResolveDuplicateUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  /** Claim authority is limited to its own projections. Dismissal never exposes the other document. */
  async executeForReimbursement(ctx: RequestContext, requestId: string, branchId: string | undefined, reason: string, db: any): Promise<number> {
    if (!ctx.permissions.includes('reimbursement.payment.record') && !ctx.permissions.includes('reimbursement.duplicate.resolve')) throw new ForbiddenException('Missing permission: reimbursement.duplicate.resolve');
    if (!reason.trim() || reason.length > 500) throw new BadRequestException('duplicate_resolution_reason_required');
    if (looksLikeAccountNumber(reason)) throw new BadRequestException('note_contains_account_number');
    const rows = await this.repo.listClaimDuplicates(ctx.companyId, requestId, branchId, ctx.scopes ?? {}, db);
    for (const expense of rows) for (const candidate of expense.duplicateCandidates) {
      await this.repo.resolveDuplicateCandidate({ companyId: ctx.companyId, expenseId: expense.id, candidateId: candidate.id, actorUserId: ctx.userId, action: 'dismiss', reason,
        scopes: ctx.scopes ?? {}, reimbursementRequestId: requestId, reimbursementBranchId: branchId },
        tx => this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.duplicate.dismiss', targetType: 'expense_record', targetId: expense.id, requestId: ctx.requestId,
          result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { candidateId: candidate.id, reason, reimbursementRequestId: requestId } }, tx), db);
    }
    return rows.length;
  }

  async execute(ctx: RequestContext, expenseId: string, candidateId: string, action: 'dismiss' | 'confirm', reason?: string): Promise<void> {
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    if (!ctx.permissions.includes('expense.duplicate.resolve')) throw new ForbiddenException('Missing permission: expense.duplicate.resolve');
    const cleanReason = reason?.trim() ?? '';
    if (cleanReason.length < 3) throw new BadRequestException('Duplicate resolution reason must be at least 3 characters');
    if (cleanReason.length > 500) throw new BadRequestException('Duplicate resolution reason must be at most 500 characters');
    await this.repo.resolveDuplicateCandidate(
      { companyId: ctx.companyId, expenseId, candidateId, actorUserId: ctx.userId, action, reason: cleanReason, scopes: ctx.scopes ?? {} },
      (tx) => this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: `expense.duplicate.${action}`, targetType: 'expense_record', targetId: expenseId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { candidateId, reason: cleanReason } }, tx),
    );
  }
}

/**
 * Vendor-address §8 Slice 2: "ยืนยันว่าใช้ได้ พร้อมเหตุผล" on a tax invoice whose printed buyer does not
 * match the company registry. It records a person's judgement and changes nothing else — no
 * claimability, no tax evidence (E11). The audit names the mismatch, never the printed name or
 * address it was about.
 */
@Injectable()
export class ConfirmBuyerMatchUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, expenseId: string, reason?: string): Promise<void> {
    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    if (!ctx.permissions.includes('expense.confirm')) throw new ForbiddenException('Missing permission: expense.confirm');
    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (!cleanReason || cleanReason.length > 500) {
      throw new BadRequestException({ code: 'expense_buyer_match_reason_required', message: 'A reason of 1 to 500 characters is required.' });
    }
    await this.repo.confirmBuyerMatch(
      { companyId: ctx.companyId, expenseId, actorUserId: ctx.userId, reason: cleanReason, scopes: ctx.scopes ?? {} },
      (tx, confirmed) => this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.buyer_match.confirm', targetType: 'expense_record', targetId: expenseId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { matchStatus: confirmed.matchStatus, reasons: confirmed.reasons ?? [] } }, tx),
    );
  }
}

@Injectable()
export class ListExpenseCategoriesUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext) {
    if (!ctx.permissions.includes('expense.read') && !ctx.permissions.includes('expense.read_related')
      && !ctx.permissions.includes('expense.read_own') && !ctx.permissions.includes('expense.review')
      && !ctx.permissions.includes('expense.create') && !ctx.permissions.includes('expense.receipt.upload')
      && !ctx.permissions.includes('expense.receipt.line_upload')) {
      throw new ForbiddenException('Missing permission: expense.read');
    }
    return this.repo.listCategories(ctx.companyId);
  }
}

@Injectable()
export class ExpensePaymentSlipUploadUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly prisma: PrismaService,
    private readonly createUpload: CreateUploadIntentUseCase, private readonly completeUpload: CompleteAttachmentUploadUseCase) {}

  private async payer(ctx: RequestContext, expenseId: string) {
    if (!ctx.permissions.includes('expense.payment.record')) throw new ForbiddenException('Missing permission: expense.payment.record');
    const expense = await this.repo.findById(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException('Expense not found');
    if (!isBranchInScope(ctx.scopes ?? {}, expense.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    return expense;
  }

  async init(ctx: RequestContext, expenseId: string, input: { originalFileName: string; mimeType: string; byteSize: number }) {
    const expense = await this.payer(ctx, expenseId);
    if (!REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES.includes(input.mimeType) || !Number.isInteger(input.byteSize)
      || input.byteSize <= 0 || input.byteSize > REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES) throw new BadRequestException('payment_slip_invalid');
    return this.createUpload.execute({ ...ctx, permissions: [...ctx.permissions, 'attachment.create'] }, {
      ...input, visibility: 'INTERNAL', ...(expense.branchId ? { branchId: expense.branchId } : {}),
      metadataJson: { generatedFor: 'expense.payment.slip', expenseId },
    });
  }

  async complete(ctx: RequestContext, expenseId: string, attachmentId: string, input: { checksumSha256?: string; byteSize?: number }) {
    const expense = await this.payer(ctx, expenseId);
    const file = await this.prisma.client.attachmentObject.findFirst({ where: {
      id: attachmentId, companyId: ctx.companyId, branchId: expense.branchId, uploadedByUserId: ctx.userId, status: 'PENDING_UPLOAD',
      AND: [{ metadataJson: { path: ['generatedFor'], equals: 'expense.payment.slip' } }, { metadataJson: { path: ['expenseId'], equals: expenseId } }],
    } });
    if (!file) throw new BadRequestException('payment_slip_invalid');
    await this.completeUpload.execute({ ...ctx, permissions: [...ctx.permissions, 'attachment.create'] }, { ...input, attachmentId });
    return { attachmentId };
  }
}
