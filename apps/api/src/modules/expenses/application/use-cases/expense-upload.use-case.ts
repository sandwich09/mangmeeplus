import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaService } from '../../../../common/database/prisma.service';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { reconcileExpenseDuplicateCandidates } from '../services/expense-duplicate-detection';
import { GetExpenseCapturePolicyUseCase } from './expense-capture-policy.use-case';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { assertExpenseRootOpen } from '../expense-launch-gate';
import type { RequestContext } from '@watchdog-bms/contracts';
import type { ExpenseRecord } from '../../domain/models/expense.model';
import { civilDateToUtcDate, coerceCivilDate } from '@watchdog-bms/contracts';
import { observeCustomerJourney } from '../../../../common/observability/customer-journey-audit';

export type InitReceiptUploadResult = {
  expenseId: string;
  attachmentId: string;
  uploadUrl: string;
  uploadMethod: string;
  uploadHeaders: Record<string, string>;
  expiresAt: Date;
};

@Injectable()
export class InitReceiptUploadUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly createIntent: CreateUploadIntentUseCase,
    private readonly audit: AuditService,
    private readonly capturePolicy: GetExpenseCapturePolicyUseCase,
    private readonly launchGate: LaunchGateGuardService,
  ) {}

  async execute(
    ctx: RequestContext,
    cmd: {
      originalFileName: string;
      mimeType: string;
      byteSize: number;
      expenseDate: string;
      branchId?: string;
      note?: string;
      captureSource?: 'WEB_UPLOAD' | 'LINE_UPLOAD';
    },
  ): Promise<InitReceiptUploadResult> {
    if (!ctx.permissions.includes('expense.receipt.upload') && !ctx.permissions.includes('expense.receipt.line_upload') && !ctx.permissions.includes('expense.create')) {
      throw new ForbiddenException('Missing permission: expense.receipt.upload');
    }
    // The other root of the expenses journey — the receipt upload. Guarded HERE, on the
    // expenses-specific entry, not in the shared `CreateUploadIntentUseCase`: that one also serves
    // every other module's attachments, which the `expenses` gate has no authority over.
    await assertExpenseRootOpen(this.launchGate, this.audit, ctx, 'expense.upload_intent.create');
    if (!isBranchInScope(ctx.scopes ?? {}, cmd.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    // Reject before reserving storage or creating an attachment, not only when saving the draft.
    const branchId = await this.repo.resolveCreateBranchId(ctx.companyId, ctx.scopes ?? {}, cmd.branchId);
    const expenseDate = civilDateToUtcDate(coerceCivilDate(cmd.expenseDate));

    // Create the attachment upload intent via shared data-model-core
    const intent = await this.createIntent.execute(ctx, {
      originalFileName: cmd.originalFileName,
      mimeType: cmd.mimeType,
      byteSize: cmd.byteSize,
      ...(branchId ? { branchId } : {}),
    });

    // A company that is not asked Thai VAT questions cannot answer a claimability review either,
    // so its uploads land NON_CLAIMABLE instead of filling the review queue with a decision
    // nobody can make. Confirmation never blocked on this, so the change is queue noise, not flow.
    const { mode } = await this.capturePolicy.execute(ctx, cmd.expenseDate);

    // Create the expense draft with NO_VAT default and empty totals until review
    const expense = await this.repo.createExpense({
      companyId: ctx.companyId,
      branchId: branchId ?? undefined,
      captureSource: cmd.captureSource ?? 'WEB_UPLOAD',
      // Date-only after shared validation/coercion. An instant from the LINE path must never put a
      // time into the column, or the list's day filter cannot see the row.
      expenseDate,
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

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.upload_intent.create', targetType: 'expense_record', targetId: expense.id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { attachmentId: intent.attachmentId, mimeType: cmd.mimeType },
    });

    return {
      expenseId: expense.id,
      attachmentId: intent.attachmentId,
      uploadUrl: intent.uploadUrl,
      uploadMethod: intent.uploadMethod,
      uploadHeaders: intent.uploadHeaders,
      expiresAt: intent.expiresAt,
    };
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
  ) {}

  async execute(
    ctx: RequestContext,
    cmd: { expenseId: string; attachmentId: string; checksumSha256?: string; byteSize?: number; purpose?: string },
  ): Promise<ExpenseRecord> {
    return observeCustomerJourney(
      this.audit,
      {
        key: 'receipt-intake', requestId: ctx.requestId, targetType: 'expense_record', targetId: cmd.expenseId,
        companyId: ctx.companyId, actorUserId: ctx.userId,
      },
      () => this.complete(ctx, cmd),
      () => ({ outcome: 'uploaded' }),
    );
  }

  private async complete(
    ctx: RequestContext,
    cmd: { expenseId: string; attachmentId: string; checksumSha256?: string; byteSize?: number; purpose?: string },
  ): Promise<ExpenseRecord> {
    const expense = await this.repo.findById(ctx.companyId, cmd.expenseId);
    if (!expense) throw new NotFoundException(`Expense ${cmd.expenseId} not found`);

    const canUpload = (ctx.permissions.includes('expense.receipt.upload') || ctx.permissions.includes('expense.receipt.line_upload')) && expense.createdByUserId === ctx.userId;
    const canReview = ctx.permissions.includes('expense.review');
    if (!canUpload && !canReview) throw new ForbiddenException('Missing permission: expense.receipt.upload');

    // Complete the shared attachment
    await this.completeUpload.execute(ctx, {
      attachmentId: cmd.attachmentId,
      checksumSha256: cmd.checksumSha256,
      byteSize: cmd.byteSize,
    });

    const purpose = cmd.purpose ?? 'expense.receipt.primary';
    if (!['expense.receipt.primary', 'expense.receipt.supporting', 'expense.payment.evidence'].includes(purpose)) {
      throw new BadRequestException('Unsupported expense attachment purpose.');
    }
    await this.repo.linkAttachment(cmd.expenseId, cmd.attachmentId, purpose, ctx.companyId, ctx.userId);

    // Set primary attachment if this is the primary receipt
    let updated = expense;
    let retiredAttachmentIds: string[] = [];
    if (purpose === 'expense.receipt.primary') {
      retiredAttachmentIds = await this.retireReplacedPrimaryReceipts(ctx, expense, cmd.attachmentId);
      updated = await this.repo.updateExpense({
        id: cmd.expenseId,
        companyId: ctx.companyId,
        updatedByUserId: ctx.userId,
        primaryAttachmentId: cmd.attachmentId,
        // Move to NEEDS_REVIEW now that we have an attachment
        status: expense.status === 'DRAFT' ? 'NEEDS_REVIEW' : expense.status,
      });
      await reconcileExpenseDuplicateCandidates(this.repo, ctx.companyId, cmd.expenseId, ctx.userId, ctx.scopes ?? {});
      updated = await this.repo.findById(ctx.companyId, cmd.expenseId) ?? updated;
    }

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.upload.complete', targetType: 'expense_record', targetId: cmd.expenseId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { attachmentId: cmd.attachmentId, purpose, ...(retiredAttachmentIds.length > 0 && { replacedAttachmentIds: retiredAttachmentIds }) },
    });
    void this.outbox.append('expense.receipt_uploaded', 'expense_record', cmd.expenseId, {
      companyId: ctx.companyId, aggregateType: 'expense_record', aggregateId: cmd.expenseId, requestId: ctx.requestId,
      occurredAt: new Date().toISOString(), data: { expenseId: cmd.expenseId, attachmentId: cmd.attachmentId, purpose },
    });

    return updated;
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
  ): Promise<string[]> {
    if (expense.status !== 'DRAFT' && expense.status !== 'NEEDS_REVIEW') return [];
    const link = { companyId: ctx.companyId, targetType: 'expense.record', targetId: expense.id };
    return this.prisma.client.$transaction(async (tx) => {
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
    });
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

  async execute(ctx: RequestContext, expenseId: string, candidateId: string, action: 'dismiss' | 'confirm', reason?: string): Promise<void> {
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

@Injectable()
export class ListExpenseCategoriesUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext) {
    if (!ctx.permissions.includes('expense.read') && !ctx.permissions.includes('expense.read_related')
      && !ctx.permissions.includes('expense.read_own') && !ctx.permissions.includes('expense.review')) {
      throw new ForbiddenException('Missing permission: expense.read');
    }
    return this.repo.listCategories(ctx.companyId);
  }
}
