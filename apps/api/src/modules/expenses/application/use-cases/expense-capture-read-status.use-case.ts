import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  expenseCapturePagesRead,
  type ExpenseCapturePausedReason,
  type FreeExpenseAllowance,
  type ExpenseCaptureReadManifest,
  type ExpenseCaptureReadStatus,
  type RequestContext,
} from '@watchdog-bms/contracts';
import { bangkokMonthKey } from '../../../line-ai/application/company-ai-usage-meter';
import { freeExpenseAllowanceSnapshot } from '../../../line-ai/application/free-expense-quota';
import { PrismaService } from '../../../../common/database/prisma.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { ExpenseCaptureAccessService } from './expense-capture-group.use-case';

/**
 * Appendix §9 `GET …/read-status`, for both owners: the capture group page polls the group route
 * while any file is still being read, and the expense page polls its own while a single PDF's job
 * is running (§3). Reading only — it never starts, resumes or re-prices a read.
 *
 * The shape stays local to this wave on purpose: `packages/contracts/src/expense-capture.ts` is
 * W03's file, and a second export of the same name there would collide at the barrel.
 */
export type ExpenseReadStatusFile = {
  /** Null for an expense-owned job: that lane has no capture file row. */
  fileId: string | null;
  attachmentId: string;
  status: ExpenseCaptureReadStatus;
  pagesRead: number;
  pageCount: number | null;
  pausedReason: ExpenseCapturePausedReason | null;
  lastErrorCode: string | null;
  updatedAt: string;
  /**
   * Expense lane only (W03 runner): the assembly found more than one document or issuer in the file.
   * Appendix §25: it no longer means "go and review a group" — the engine already split it, and
   * `splitExpenseIds` is what it created.
   */
  multiDocument?: boolean;
  /** How many documents the assembly found, so the page can say "พบเอกสาร N ใบ". */
  documentCount?: number;
  /**
   * Appendix §25: the drafts the auto-split created, in document order from the SECOND document on.
   * The split runs inside the job before its terminal write, so a DONE `multiDocument` job always
   * carries the ids — there is no "split pending" state to show.
   */
  splitExpenseIds?: string[];
  /** Expense lane only: `receipt-ocr-apply` committed the read onto the draft (§4.5). */
  applied?: boolean;
};

export type ExpenseReadStatusResult = { files: ExpenseReadStatusFile[]; freeAllowance?: FreeExpenseAllowance };

type ReadJobRow = {
  fileId: string | null;
  attachmentId: string;
  status: string;
  pausedReason: string | null;
  lastErrorCode: string | null;
  manifestJson: unknown;
  updatedAt: Date;
};

const statusFile = (job: ReadJobRow): ExpenseReadStatusFile => {
  const manifest = (job.manifestJson ?? null) as ExpenseCaptureReadManifest | null;
  return {
    fileId: job.fileId,
    attachmentId: job.attachmentId,
    status: job.status as ExpenseCaptureReadStatus,
    pagesRead: expenseCapturePagesRead(manifest),
    pageCount: manifest?.pageCount ?? null,
    pausedReason: job.pausedReason as ExpenseCapturePausedReason | null,
    lastErrorCode: job.lastErrorCode,
    updatedAt: job.updatedAt.toISOString(),
  };
};

@Injectable()
export class GetExpenseReadStatusUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ExpenseCaptureAccessService,
    private readonly expenses: PrismaExpenseRepository,
  ) {}

  /** Every file of one capture group, newest job per file (the group aggregate owns the authority). */
  async group(ctx: RequestContext, groupId: string): Promise<ExpenseReadStatusResult> {
    await this.access.loadReadable(ctx, groupId);
    const jobs = await this.prisma.client.expenseCaptureReadJob.findMany({
      where: { companyId: ctx.companyId, groupId },
      orderBy: { createdAt: 'asc' },
      select: {
        fileId: true, attachmentId: true, status: true, pausedReason: true,
        lastErrorCode: true, manifestJson: true, updatedAt: true,
      },
    });
    return { files: jobs.map((job) => statusFile(job as ReadJobRow)) };
  }

  /** The single-expense lane of §3: one async job on the receipt the review page is showing. */
  async expense(ctx: RequestContext, expenseId: string): Promise<ExpenseReadStatusResult> {
    const expense = await this.expenses.findById(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found`);
    if (!isBranchInScope(ctx.scopes ?? {}, expense.branchId)) {
      throw new ForbiddenException('Branch is outside your assigned branch scope.');
    }
    const has = (key: string) => ctx.permissions.includes(key);
    const readsAll = has('expense.read') || has('expense.review') || has('expense.confirm');
    const readsOwn = (has('expense.read_own') || has('expense.create') || has('expense.receipt.upload')
      || has('expense.receipt.line_upload')) && expense.createdByUserId === ctx.userId;
    // `expense.read_related` costs a query, so it is asked last and only when nothing cheaper says yes.
    const readsRelated = !readsAll && !readsOwn && has('expense.read_related')
      && await this.expenses.isUserRelatedToExpense(ctx.companyId, expenseId, ctx.userId, ctx.scopes ?? {});
    if (!readsAll && !readsOwn && !readsRelated) throw new ForbiddenException('Missing permission to read expenses');

    const jobs = await this.prisma.client.expenseCaptureReadJob.findMany({
      where: { companyId: ctx.companyId, expenseId },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: {
        id: true, fileId: true, attachmentId: true, status: true, pausedReason: true,
        lastErrorCode: true, manifestJson: true, checkpointJson: true, updatedAt: true,
      },
    });
    const files = await Promise.all(jobs.map(async (job) => {
      const file = statusFile(job as ReadJobRow);
      // The assembled observation carries the verdict and the document count; the split ids are on
      // the JOB, because the split is what the job did, not what the reader saw.
      const observation = await this.prisma.client.expenseCaptureObservation.findFirst({
        where: { companyId: ctx.companyId, jobId: job.id },
        orderBy: { version: 'desc' },
        select: { payloadJson: true },
      });
      const payload = (observation?.payloadJson ?? null) as { multiDocument?: boolean; documents?: unknown[] } | null;
      const documentCount = Array.isArray(payload?.documents) ? payload!.documents!.length : 0;
      const multiDocument = payload?.multiDocument === true || documentCount > 1;
      const splitExpenseIds = Object.values(
        ((job.checkpointJson ?? null) as { splitExpenseIds?: Record<string, string> } | null)?.splitExpenseIds ?? {},
      ).filter((id): id is string => typeof id === 'string');
      return {
        ...file,
        multiDocument,
        documentCount,
        splitExpenseIds,
        // The FIRST document is applied even when a file held several (appendix §25), so "applied"
        // now means what it says: the draft on screen carries a read.
        applied: file.status === 'DONE' && !!expense.aiVerifiedAt,
      };
    }));
    // The exact persisted operation, including its original Bangkok month, owns this projection.
    const monthKey = bangkokMonthKey();
    const checkpoint = jobs[0]?.checkpointJson as { ocrQuotaSource?: string; ocrEventId?: string; ocrMonthKey?: string } | undefined;
    if (checkpoint?.ocrQuotaSource === 'FREE_MONTHLY_3' && checkpoint.ocrMonthKey === monthKey && checkpoint.ocrEventId) {
      const succeeded = await this.prisma.client.companyOcrUsageEvent.findFirst({ where: {
        id: checkpoint.ocrEventId, companyId: ctx.companyId, monthKey, quotaSource: 'FREE_MONTHLY_3', succeededAt: { not: null },
      }, select: { id: true } });
      if (succeeded) return { files, freeAllowance: await freeExpenseAllowanceSnapshot(this.prisma, ctx.companyId, monthKey) };
    }
    return { files };
  }
}
