import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { Prisma } from '../../../../generated/prisma/client';
import { isExpenseDeletableState } from '@watchdog-bms/contracts';
import { branchScopeWhere, isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { claimOwnsExpenseError, findLiveClaimOf, type ExpenseClaimOwner } from '../../infrastructure/expense-void-blocker';

type DeleteExpenseOutcome =
  | { kind: 'DELETED' }
  | { kind: 'NOT_FOUND' }
  | { kind: 'WRONG_STATUS' }
  | { kind: 'FORBIDDEN' }
  | { kind: 'RETENTION_LOCKED' }
  | { kind: 'CLAIM_OWNED'; claim: ExpenseClaimOwner }
  | { kind: 'LINKED_DATA'; blocker: ExpenseLinkedDataBlocker };

type ExpenseLinkedDataBlocker =
  | 'PAYMENT'
  | 'TAX_EVENT'
  | 'TAX_REVIEW_ISSUE'
  | 'TAX_RECONCILIATION_LINE'
  | 'TRADE_TAX_EVIDENCE'
  | 'JOURNAL_ENTRY'
  | 'JOURNAL_LINE'
  | 'BANK_RECONCILIATION_MATCH'
  | 'WORKFLOW_RUN'
  | 'WORKFLOW_TASK'
  | 'WORKFLOW_EVENT_INBOX'
  | 'NOTIFICATION_EVENT';

const RETENTION_LOCKED_RESPONSE = {
  code: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED',
  message: 'Expense is retained as substitute-receipt evidence.',
};

export async function findLinkedDataBlocker(
  tx: Prisma.TransactionClient,
  companyId: string,
  expenseId: string,
): Promise<ExpenseLinkedDataBlocker | null> {
  const expenseReference = { sourceType: 'expense.record', sourceId: expenseId };
  const expenseSource = { companyId, ...expenseReference };
  const workflowReference = { sourceType: 'expense_record', sourceId: expenseId };
  const workflowSource = { companyId, ...workflowReference };
  const select = { id: true };
  const rows = await Promise.all([
    tx.taxEvent.findFirst({ where: expenseSource, select }),
    tx.taxReviewIssue.findFirst({ where: expenseSource, select }),
    tx.taxReconciliationLine.findFirst({ where: expenseSource, select }),
    tx.tradeTaxEvidence.findFirst({ where: expenseSource, select }),
    tx.journalEntry.findFirst({ where: expenseSource, select }),
    tx.journalLine.findFirst({
      where: {
        companyId,
        OR: [
          expenseReference,
          { journalEntry: { is: expenseSource } },
        ],
      },
      select,
    }),
    tx.bankReconciliationMatch.findFirst({
      where: { companyId, sourceType: 'EXPENSE_PAYMENT', sourceId: expenseId },
      select,
    }),
    tx.workflowRun.findFirst({ where: workflowSource, select }),
    tx.workflowTask.findFirst({
      where: {
        companyId,
        OR: [
          workflowReference,
          { workflowRun: { is: workflowSource } },
        ],
      },
      select,
    }),
    // A SKIPPED inbox row means no rule matched: the event was logged, never acted on, so it must
    // not block. Every WEB_UPLOAD draft emits expense.receipt_uploaded and would otherwise be
    // undeletable forever. RECEIVED (still in flight) and FAILED (never evaluated) still block;
    // MATCHED is already covered by its WorkflowRun.
    tx.workflowEventInbox.findFirst({
      where: { ...workflowSource, status: { not: 'SKIPPED' } },
      select,
    }),
    tx.notificationEvent.findFirst({ where: workflowSource, select }),
  ]);
  const blockers: ExpenseLinkedDataBlocker[] = [
    'TAX_EVENT',
    'TAX_REVIEW_ISSUE',
    'TAX_RECONCILIATION_LINE',
    'TRADE_TAX_EVIDENCE',
    'JOURNAL_ENTRY',
    'JOURNAL_LINE',
    'BANK_RECONCILIATION_MATCH',
    'WORKFLOW_RUN',
    'WORKFLOW_TASK',
    'WORKFLOW_EVENT_INBOX',
    'NOTIFICATION_EVENT',
  ];
  const index = rows.findIndex(Boolean);
  return index === -1 ? null : blockers[index]!;
}

/**
 * Owner decision 2026-08-05: a deletable draft stays deletable even when another expense flagged
 * it as its duplicate candidate — the flag is a review trail, not a document that owes it money.
 * Those candidate rows cascade away with the expense, so the referencing documents must be
 * re-verdicted here or they keep a duplicate flag (and a `duplicateOfExpenseId`, which has no FK)
 * pointing at a row that no longer exists. Same rule as `runDuplicateCheck`. Returns the
 * re-verdicted expense ids for the delete audit.
 */
export async function recheckExpensesReferencing(
  tx: Prisma.TransactionClient,
  companyId: string,
  expenseId: string,
  actorUserId: string,
): Promise<string[]> {
  const referencing = await tx.expenseDuplicateCandidate.findMany({
    where: { companyId, candidateExpenseId: expenseId, expenseId: { not: expenseId } },
    select: { expenseId: true },
  });
  const referencingIds = [...new Set(referencing.map((row) => row.expenseId))];
  for (const referencingId of referencingIds) {
    const remaining = await tx.expenseDuplicateCandidate.findMany({
      where: { companyId, expenseId: referencingId, candidateExpenseId: { not: expenseId } },
      select: { candidateExpenseId: true, status: true, resolvedByUserId: true },
    });
    const confirmed = remaining.find((row) => row.status === 'CONFIRMED_DUPLICATE');
    const duplicateStatus = confirmed
      ? 'CONFIRMED_DUPLICATE'
      : remaining.some((row) => row.status === 'OPEN')
        ? 'POSSIBLE_DUPLICATE'
        : remaining.some((row) => row.status === 'DISMISSED' && row.resolvedByUserId)
          ? 'OVERRIDDEN'
          : 'NO_MATCH';
    await tx.expenseRecord.updateMany({
      where: { id: referencingId, companyId },
      data: {
        duplicateStatus,
        duplicateOfExpenseId: confirmed?.candidateExpenseId ?? null,
        ...(duplicateStatus !== 'OVERRIDDEN' && { duplicateOverrideReason: null }),
        updatedByUserId: actorUserId,
      },
    });
  }
  return referencingIds;
}

@Injectable()
export class DeleteExpenseUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: PrismaAttachmentRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, expenseId: string, expectedUpdatedAt?: Date): Promise<void> {
    return this.run(ctx, expenseId, { expectedUpdatedAt });
  }

  async previewLineAction(ctx: RequestContext, expenseId: string): Promise<void> {
    return this.run(ctx, expenseId, { previewOnly: true });
  }

  private async run(ctx: RequestContext, expenseId: string, options: { previewOnly?: boolean; expectedUpdatedAt?: Date }): Promise<void> {
    const deniedEntry = (reason: string, metadataJson: Record<string, unknown> = {}) => ({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'expense.delete',
      targetType: 'expense_record',
      targetId: expenseId,
      requestId: ctx.requestId,
      result: 'DENIED' as const,
      riskLevel: 'CRITICAL' as const,
      metadataJson: { reason, ...metadataJson },
    });

    let outcome: DeleteExpenseOutcome;
    try {
      outcome = await this.prisma.client.$transaction(async (tx): Promise<DeleteExpenseOutcome> => {
        const expense = await tx.expenseRecord.findFirst({
          where: { id: expenseId, companyId: ctx.companyId },
          select: {
            id: true,
            branchId: true,
            status: true,
            expenseNumber: true,
            vendorNameSnapshot: true,
            expenseDate: true,
            grandTotalAmount: true,
            paidAmount: true,
            paymentStatus: true,
            captureSource: true,
            createdByUserId: true,
            sourceReimbursementRequestId: true,
            updatedAt: true,
            _count: { select: { lines: true } },
          },
        });
        if (!expense) return { kind: 'NOT_FOUND' };

        const deny = (reason: string, metadataJson: Record<string, unknown> = {}) => options.previewOnly ? Promise.resolve() : this.audit.log(
          deniedEntry(reason, metadataJson),
          tx,
        );

        if (!isBranchInScope(ctx.scopes ?? {}, expense.branchId)) {
          await deny('BRANCH_OUT_OF_SCOPE', { branchId: expense.branchId });
          return { kind: 'FORBIDDEN' };
        }

        if (options.expectedUpdatedAt && expense.updatedAt.getTime() !== options.expectedUpdatedAt.getTime()) throw new ConflictException('expense_source_version_changed');
        const canDelete = ctx.permissions.includes('expense.delete')
          || (expense.createdByUserId === ctx.userId && ctx.permissions.includes('expense.update'));
        if (!canDelete) {
          await deny('MISSING_PERMISSION');
          return { kind: 'FORBIDDEN' };
        }

        // A claim's expense record ends with its claim, never on its own (a rejected one would otherwise
        // be deletable here): the claim would be left with a line it can neither pay nor build again.
        const claim = await findLiveClaimOf(tx, ctx.companyId, expense);
        if (claim) {
          await deny('EXPENSE_BELONGS_TO_REIMBURSEMENT', { reimbursementRequestId: claim.requestId });
          return { kind: 'CLAIM_OWNED', claim };
        }

        if (!isExpenseDeletableState({
          status: expense.status,
          grandTotalAmount: expense.grandTotalAmount.toString(),
          paymentStatus: expense.paymentStatus,
        })) {
          await deny('EXPENSE_NOT_DELETABLE', {
            status: expense.status,
            grandTotalAmount: expense.grandTotalAmount.toString(),
            paymentStatus: expense.paymentStatus,
          });
          return { kind: 'WRONG_STATUS' };
        }

        const retained = await tx.expenseSubstituteReceiptEvidence.findFirst({
          where: { companyId: ctx.companyId, expenseId },
          select: { id: true },
        });
        if (retained) {
          await deny('SUBSTITUTE_EVIDENCE_RETENTION_LOCKED');
          return { kind: 'RETENTION_LOCKED' };
        }

        const linkedDataBlocker = expense.paymentStatus !== 'UNPAID' || expense.paidAmount.gt(0)
          ? 'PAYMENT'
          : await findLinkedDataBlocker(tx, ctx.companyId, expenseId);
        if (linkedDataBlocker) {
          await deny('EXPENSE_HAS_LINKED_DATA', { blocker: linkedDataBlocker });
          return { kind: 'LINKED_DATA', blocker: linkedDataBlocker };
        }

        const linkWhere = {
          companyId: ctx.companyId,
          targetType: 'expense.record',
          targetId: expenseId,
        };
        const links = await tx.attachmentLink.findMany({
          where: linkWhere,
          select: { attachmentId: true },
        });
        const attachmentIds = [...new Set(links.map((link) => link.attachmentId))];
        for (const attachmentId of attachmentIds) {
          const hold = await this.attachments.findSubstituteEvidenceRetentionHold(
            { id: attachmentId, companyId: ctx.companyId },
            tx,
          );
          if (hold) {
            await deny('SUBSTITUTE_EVIDENCE_RETENTION_LOCKED', { attachmentId, retentionHold: hold });
            return { kind: 'RETENTION_LOCKED' };
          }
        }
        if (options.previewOnly) return { kind: 'DELETED' };
        await tx.attachmentLink.deleteMany({ where: linkWhere });
        // Appendix §25: an auto-split sibling shares its bytes with the draft the file was uploaded
        // to. A file another record still links is theirs — only an unshared file is retired, the
        // rule `RemoveExpenseReceiptUseCase` and the replace path already apply.
        const sharedAttachmentIds: string[] = [];
        for (const attachmentId of attachmentIds) {
          const remaining = await tx.attachmentLink.count({ where: { companyId: ctx.companyId, attachmentId } });
          if (remaining > 0) { sharedAttachmentIds.push(attachmentId); continue; }
          await this.attachments.markDeleted({ id: attachmentId, companyId: ctx.companyId }, tx);
        }
        const recheckedExpenseIds = await recheckExpensesReferencing(
          tx,
          ctx.companyId,
          expenseId,
          ctx.userId,
        );

        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'expense.delete',
          targetType: 'expense_record',
          targetId: expenseId,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: {
            expenseNumber: expense.expenseNumber,
            vendorNameSnapshot: expense.vendorNameSnapshot,
            expenseDate: expense.expenseDate.toISOString(),
            grandTotalAmount: expense.grandTotalAmount.toString(),
            captureSource: expense.captureSource,
            createdByUserId: expense.createdByUserId,
            attachmentIds,
            ...(sharedAttachmentIds.length > 0 ? { sharedAttachmentIds } : {}),
            lineCount: expense._count.lines,
            duplicateRecheckedExpenseIds: recheckedExpenseIds,
          },
        }, tx);
        const deleted = await tx.expenseRecord.deleteMany({
          where: {
            id: expenseId,
            companyId: ctx.companyId,
            updatedAt: expense.updatedAt,
            ...branchScopeWhere(ctx.scopes ?? {}),
          },
        });
        if (deleted.count !== 1) {
          throw new ConflictException({
            code: 'EXPENSE_CHANGED_DURING_DELETE',
            message: 'Expense changed while it was being deleted. Reload and try again.',
          });
        }
        return { kind: 'DELETED' };
      });
    } catch (error) {
      if (!isRetentionLocked(error)) throw error;
      await this.prisma.client.$transaction((auditTx) => this.audit.log(
        deniedEntry('SUBSTITUTE_EVIDENCE_RETENTION_LOCKED', { source: 'attachment' }),
        auditTx,
      ));
      throw new ConflictException(RETENTION_LOCKED_RESPONSE);
    }

    if (outcome.kind === 'DELETED') return;
    if (outcome.kind === 'NOT_FOUND') throw new NotFoundException(`Expense ${expenseId} not found`);
    if (outcome.kind === 'WRONG_STATUS') {
      throw new ConflictException({
        code: 'EXPENSE_NOT_DELETABLE',
        message: 'Only drafts, rejected records, or unpaid zero-total expenses awaiting confirmation can be deleted.',
      });
    }
    if (outcome.kind === 'RETENTION_LOCKED') {
      throw new ConflictException(RETENTION_LOCKED_RESPONSE);
    }
    if (outcome.kind === 'CLAIM_OWNED') throw claimOwnsExpenseError(outcome.claim);
    if (outcome.kind === 'LINKED_DATA') {
      throw new ConflictException({
        code: 'EXPENSE_HAS_LINKED_DATA',
        blocker: outcome.blocker,
        message: `Expense cannot be deleted because it has linked data: ${outcome.blocker}.`,
      });
    }
    throw new ForbiddenException('Missing permission: expense.delete');
  }
}

function isRetentionLocked(error: unknown): boolean {
  if (!(error instanceof ConflictException)) return false;
  const response = error.getResponse();
  return typeof response === 'object'
    && response !== null
    && (response as { code?: unknown }).code === 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED';
}
