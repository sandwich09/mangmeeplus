import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { lockExpenseFunding } from '../../infrastructure/substitute-funding.guard';
import { reconcileExpenseDuplicateCandidates } from '../services/expense-duplicate-detection';

@Injectable()
export class RemoveExpenseReceiptUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: PrismaAttachmentRepository,
    private readonly repo: PrismaExpenseRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, expenseId: string, attachmentId: string, expectedUpdatedAt: string, purpose = 'expense.receipt.primary'): Promise<void> {
    if (!['expense.receipt.primary', 'expense.receipt.supporting', 'expense.payment.evidence', 'expense.review.evidence'].includes(purpose)) throw new BadRequestException('Invalid expense attachment purpose');
    const primary = purpose === 'expense.receipt.primary';
    await this.prisma.client.$transaction(async (tx) => {
      await lockExpenseFunding(tx, ctx.companyId, expenseId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:${expenseId}:substitute-receipt`}))`;
      const expense = await tx.expenseRecord.findFirst({ where: { companyId: ctx.companyId, id: expenseId } });
      if (!expense) throw new NotFoundException('Expense not found');
      if (!isBranchInScope(ctx.scopes ?? {}, expense.branchId)
        || !(ctx.permissions.includes('expense.review') || (ctx.permissions.includes('expense.update') && expense.createdByUserId === ctx.userId))) {
        throw new ForbiddenException('Missing permission to remove this receipt');
      }
      if (!['DRAFT', 'NEEDS_REVIEW'].includes(expense.status) || expense.paymentStatus !== 'UNPAID'
        || expense.paidAmount.gt(0) || expense.postingStatus !== 'not_required') {
        throw new ConflictException({ code: 'expense_receipt_removal_locked', message: 'Receipt removal requires an unpaid draft expense.' });
      }
      if (expense.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
        throw new ConflictException({ code: 'EXPENSE_UPDATE_CONFLICT', message: 'Reload the expense before removing the receipt.' });
      }
      const linkWhere = { companyId: ctx.companyId, targetType: 'expense.record', targetId: expenseId, attachmentId, purpose };
      const link = await tx.attachmentLink.findFirst({ where: { ...linkWhere, attachment: { companyId: ctx.companyId, status: 'ACTIVE' } }, include: { attachment: true } });
      if (!link) throw new NotFoundException('Expense attachment not found');
      const evidence = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId: ctx.companyId, expenseId, status: { not: 'SUPERSEDED' } }, select: { id: true } });
      const hold = await this.attachments.findSubstituteEvidenceRetentionHold({ companyId: ctx.companyId, id: attachmentId }, tx);
      if (evidence || hold) throw new ConflictException({ code: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED', message: 'Receipt is retained as substitute evidence.' });
      const claim = await tx.reimbursementLine.findFirst({ where: { companyId: ctx.companyId, request: { status: { notIn: ['REJECTED', 'CANCELLED', 'VOIDED'] } }, OR: [{ linkedExpenseId: expenseId }, { attachmentId }] }, select: { id: true } });
      if (claim) throw new ConflictException({ code: 'substitute_source_has_live_claim', message: 'Receipt is linked to a reimbursement request.' });
      const next = primary ? await tx.attachmentLink.findFirst({ where: { ...linkWhere, attachmentId: { not: attachmentId }, attachment: { companyId: ctx.companyId, status: 'ACTIVE' } }, orderBy: { createdAt: 'desc' }, select: { attachmentId: true } }) : null;
      const changed = await tx.expenseRecord.updateMany({
        where: { companyId: ctx.companyId, id: expenseId, updatedAt: expense.updatedAt },
        data: {
          ...(primary ? { primaryAttachmentId: expense.primaryAttachmentId === attachmentId ? next?.attachmentId ?? null : expense.primaryAttachmentId,
          extractionId: null, aiVerificationStatus: 'NEEDS_REVIEW', aiVerifiedAt: null,
          aiVerifiedFieldsJson: Prisma.DbNull, aiVerificationSummaryJson: Prisma.DbNull, aiVerificationConfidence: null,
          sourceDocumentType: 'NEEDS_REVIEW', taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: null,
          inputVatClaimStatus: 'NON_CLAIMABLE', status: 'NEEDS_REVIEW', } : {}), updatedByUserId: ctx.userId,
        },
      });
      if (changed.count !== 1) throw new ConflictException({ code: 'EXPENSE_UPDATE_CONFLICT', message: 'Expense changed while removing receipt.' });
      await tx.attachmentLink.deleteMany({ where: linkWhere });
      const remainingLinks = await tx.attachmentLink.count({ where: { companyId: ctx.companyId, attachmentId } });
      if (remainingLinks === 0) await this.attachments.markDeleted({ companyId: ctx.companyId, id: attachmentId }, tx);
      if (primary) await reconcileExpenseDuplicateCandidates(this.repo, ctx.companyId, expenseId, ctx.userId, ctx.scopes ?? {}, tx);
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.receipt.remove', targetType: 'expense_record', targetId: expenseId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { attachmentId, purpose, originalFileName: link.attachment.originalFileName, sharedFileRetained: remainingLinks > 0 } }, tx);
    });
  }
}
