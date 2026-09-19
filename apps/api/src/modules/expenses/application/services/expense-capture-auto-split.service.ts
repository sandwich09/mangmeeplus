/**
 * Auto-split: one PDF that turned out to hold several documents becomes several ORDINARY expense
 * drafts (appendix §25, owner decision 2026-09-19).
 *
 * The owner withdrew the group screens, so "พบหลายเอกสาร" can no longer be a question. The engine
 * answers it instead, and four properties hold it together:
 *
 *  1. ONE MECHANISM. Every document — the first and each further one — is mapped by
 *     `captureFieldsFromObservations` over a single-document view of the SAME assembled observation
 *     and written by `ReceiptOcrApplyService`, the path a single receipt has always taken. The
 *     first document lands on the expense that owns the file (it keeps its id and its deep link);
 *     the rest get their own drafts.
 *  2. SIBLINGS, NOT DUPLICATES. The drafts share one `ExpenseCaptureGroup` and the one file. The
 *     W01 sibling rules key on `captureGroupId`, so two receipts out of one PDF never flag each
 *     other — that group is the only reason the group table still exists.
 *  3. IDEMPOTENT. `checkpointJson.splitExpenseIds` maps document ref → expense id, so a retried
 *     drain, a re-claimed job or a duplicated outbox delivery finds the work already done. A
 *     document that already produced an expense never produces a second one.
 *  4. NO MONEY DECISION. Every draft is NEEDS_REVIEW with no allocation, no payer and no
 *     questions, exactly like a LINE receipt today. The observation stays stored either way.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { ExpenseCaptureAssembledObservations, ExpenseCaptureDocumentObservation } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { safeLineErrorDetails } from '../../../line-ai/infrastructure/line-reply.adapter';
import { captureFieldsFromObservations } from '../../domain/logic/expense-capture-fields.logic';
import { isExpenseExtractionEligible } from '../../domain/logic/expense-document.logic';
import { PrismaExpenseCaptureRepository } from '../../infrastructure/prisma-expense-capture.repository';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { isStaleOcrApply, ReceiptOcrApplyService } from './receipt-ocr-apply.service';

/** Statuses an owning expense may still be written to (the §16.4 open three). */
const OPEN_STATUSES = new Set(['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION']);

export type AutoSplitJob = {
  id: string;
  companyId: string;
  ownerType: string;
  expenseId: string | null;
  attachmentId: string;
  expectedSourceUpdatedAt?: Date | null;
};

export type AutoSplitOutcome = {
  /** The FIRST document was written onto the expense that owns the file. */
  applied: boolean;
  /** Document ref → expense id, for the second document on. Carried in the checkpoint. */
  splitByRef: Record<string, string>;
};

/** One document's own view of the assembled read: everything else already filters by `documentRef`. */
export const singleDocumentView = (
  assembled: ExpenseCaptureAssembledObservations,
  document: ExpenseCaptureDocumentObservation,
): ExpenseCaptureAssembledObservations => ({
  ...assembled,
  documents: [document],
  multiDocument: false,
  reconciliation: assembled.reconciliation.filter((row) => row.documentRef === document.ref),
});

@Injectable()
export class ExpenseCaptureAutoSplitService {
  private readonly logger = new Logger(ExpenseCaptureAutoSplitService.name);

  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly expenses: PrismaExpenseRepository,
    private readonly applyService: ReceiptOcrApplyService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Split `assembled` across the expense that owns `job` plus one new draft per further document.
   *
   * `alreadySplit` is what an earlier run of this job recorded; every ref in it is skipped. Never
   * throws into the runner: the file and the observation are stored either way, and a split that
   * could not be written leaves a draft the reviewer can still fill in by hand.
   */
  async split(input: {
    job: AutoSplitJob;
    assembled: ExpenseCaptureAssembledObservations;
    alreadySplit?: Record<string, string>;
  }): Promise<AutoSplitOutcome> {
    const { job, assembled } = input;
    const splitByRef: Record<string, string> = { ...(input.alreadySplit ?? {}) };
    if (job.ownerType !== 'EXPENSE' || !job.expenseId) return { applied: false, splitByRef };
    if (assembled.documents.length < 2) return { applied: false, splitByRef };

    const owner = await this.expenses.findById(job.companyId, job.expenseId);
    if (!owner || !OPEN_STATUSES.has(owner.status)) return { applied: false, splitByRef };

    // The group exists only to make these drafts siblings. It is created HANDED_OFF: nothing will
    // ever review it, and the retention sweep must not purge a group live expenses point at.
    const groupId = owner.captureGroupId ?? await this.ensureGroup(job, owner).catch((error) => {
      this.logger.warn({ msg: 'capture.auto_split.group_failed', jobId: job.id, ...safeLineErrorDetails(error) });
      return null;
    });
    if (!groupId) return { applied: false, splitByRef };

    const [first, ...rest] = assembled.documents;
    const applied = await this.applyDocument(job, job.expenseId, assembled, first!, {
      ...(job.expectedSourceUpdatedAt ? { expectedUpdatedAt: job.expectedSourceUpdatedAt } : {}),
    });

    const created: string[] = [];
    for (const [index, document] of rest.entries()) {
      if (splitByRef[document.ref]) continue;
      const mapped = this.eligibleFields(assembled, document);
      // A shipping label or a quotation riding inside the same PDF is not an expense (§18.4): the
      // facts stay stored on the observation and no draft is invented for it.
      if (!mapped) continue;
      try {
        const expenseId = await this.createSibling(job, owner, groupId, index + 1);
        await this.applyDocument(job, expenseId, assembled, document, {});
        splitByRef[document.ref] = expenseId;
        created.push(expenseId);
      } catch (error) {
        this.logger.warn({ msg: 'capture.auto_split.sibling_failed', jobId: job.id, ...safeLineErrorDetails(error) });
      }
    }

    if (created.length > 0) {
      await this.audit.log({
        companyId: job.companyId, actorType: 'SYSTEM', actorRefId: 'expense-capture-auto-split',
        actorUserId: owner.createdByUserId,
        action: AuditAction.EXPENSE_CAPTURE_HANDOFF_CREATE,
        targetType: 'expense_capture_group', targetId: groupId,
        requestId: job.id, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: {
          rule: 'auto_split_multi_document', jobId: job.id, ownerExpenseId: job.expenseId,
          documentCount: assembled.documents.length, expenseIds: created,
        },
      }).catch(() => undefined);
    }
    return { applied, splitByRef };
  }

  /** The eligibility gate the synchronous upload path uses, per document. */
  private eligibleFields(
    assembled: ExpenseCaptureAssembledObservations,
    document: ExpenseCaptureDocumentObservation,
  ): ReturnType<typeof captureFieldsFromObservations> {
    const mapped = captureFieldsFromObservations(singleDocumentView(assembled, document));
    if (!mapped) return null;
    return isExpenseExtractionEligible(mapped.classification, mapped.fields.grandTotalAmount, true) ? mapped : null;
  }

  private async applyDocument(
    job: AutoSplitJob,
    expenseId: string,
    assembled: ExpenseCaptureAssembledObservations,
    document: ExpenseCaptureDocumentObservation,
    options: { expectedUpdatedAt?: Date },
  ): Promise<boolean> {
    const mapped = this.eligibleFields(assembled, document);
    if (!mapped) return false;
    const outcome = await this.applyService.apply(
      { companyId: job.companyId, userId: 'system' },
      expenseId,
      mapped.fields,
      { ...options, sourceAttachmentId: job.attachmentId },
    ).catch((error) => {
      this.logger.warn({ msg: 'capture.auto_split.apply_failed', jobId: job.id, expenseId, ...safeLineErrorDetails(error) });
      return null;
    });
    return Boolean(outcome && !isStaleOcrApply(outcome) && outcome.committedUpdatedAt);
  }

  /**
   * The sibling group, and the owning expense's membership of it. `captureScopeKey` is the document
   * ref: the unique index is `(companyId, captureGroupId, captureScopeKey)`, and two documents in
   * one file always have distinct refs.
   */
  private async ensureGroup(job: AutoSplitJob, owner: { branchId?: string | null; createdByUserId: string; captureSource?: string | null }): Promise<string> {
    return this.capture.transaction(async (tx) => {
      const group = await this.capture.createGroup(tx, {
        companyId: job.companyId, branchId: owner.branchId ?? null,
        createdByUserId: owner.createdByUserId,
        intakeChannel: owner.captureSource === 'LINE_UPLOAD' ? 'LINE' : 'WEB',
        note: null,
      });
      // HANDED_OFF from the start: the drafts below are the handoff, and `handoffBatchKey` is the
      // job, so a re-claimed job cannot open a second batch for the same file.
      const revision = await this.capture.bumpRevision(tx, {
        companyId: job.companyId, groupId: group.id, expectedRevision: group.revision,
        data: { status: 'HANDED_OFF', handoffState: 'ACTIVE', handoffBatchKey: `auto-split:${job.id}` },
      });
      if (revision === null) throw new Error('CAPTURE_AUTO_SPLIT_GROUP_REVISION');
      await tx.expenseRecord.updateMany({
        where: { companyId: job.companyId, id: job.expenseId!, captureGroupId: null },
        data: { captureGroupId: group.id, captureScopeKey: 'doc-1' },
      });
      return group.id;
    });
  }

  /** An ordinary NEEDS_REVIEW draft that shares the file and the group with the original. */
  private async createSibling(
    job: AutoSplitJob,
    owner: { branchId?: string | null; createdByUserId: string; captureSource?: string | null; expenseDate: Date; note?: string | null },
    groupId: string,
    position: number,
  ): Promise<string> {
    const expense = await this.expenses.createExpense({
      companyId: job.companyId,
      branchId: owner.branchId ?? undefined,
      captureSource: (owner.captureSource as 'WEB_UPLOAD' | 'LINE_UPLOAD') ?? 'WEB_UPLOAD',
      expenseDate: owner.expenseDate,
      currency: 'THB',
      vatMode: 'NO_VAT',
      inputVatClaimStatus: 'NEEDS_REVIEW',
      status: 'NEEDS_REVIEW',
      // The person who sent the file owns every draft it produced (§18.1 `createdByUserId`).
      createdByUserId: owner.createdByUserId,
      captureGroupId: groupId,
      captureScopeKey: `doc-${position + 1}`,
      aiVerificationSummaryJson: { dateStatus: 'unverified', missingFields: ['expenseDate'] },
      subtotalAmount: '0', discountAmount: '0', taxableAmount: '0', vatAmount: '0',
      whtAmount: '0', grandTotalAmount: '0', netPayableAmount: '0', outstandingAmount: '0',
    } as never);
    // The SAME bytes, claimed as supporting evidence: the primary stays with the expense the file
    // was uploaded to, and the shared claim is what the resolver's sibling rule reads (§5).
    await this.expenses.linkAttachmentToTarget(
      job.attachmentId, 'expense.record', expense.id, 'expense.receipt.supporting',
      job.companyId, owner.createdByUserId,
    );
    return expense.id;
  }
}
