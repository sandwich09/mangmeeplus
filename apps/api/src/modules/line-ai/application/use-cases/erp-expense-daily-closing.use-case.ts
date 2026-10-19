import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  expenseEvidenceImageMissing,
  type ExpenseEvidenceSource,
  EXPENSE_CANCELLED_STATUSES,
  EXPENSE_PENDING_STATUSES,
  civilDate,
  civilDayRangeToUtc,
  civilInstantDayRangeToUtc,
  isCivilDate,
  type SourceRef,
  type ToolResult,
} from '@watchdog-bms/contracts';
import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { branchScopeWhere } from '../../../data-model-core/domain/logic/branch.logic';
import { expenseRelatedToUserWhere } from '../../../expenses/infrastructure/prisma-expense.repository';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { bangkokToday, resolveExpenseBranchFilter } from './erp-tools.use-case';

import { lineExpenseEvidenceNotes, type LineReplyLanguage } from '../../domain/logic/line-language.logic';

const TIME_ZONE = 'Asia/Bangkok';
const THAI_MONTH_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** C6 (batch 5c): the customer-facing source label used a raw ISO date ("สรุปปิดร้าน 2026-09-28") —
 *  day + abbreviated Thai month + Buddhist year, matching how the gateway formatter states every
 *  other date in this tool's own answer. `date` is already `isCivilDate`-checked by the caller. */
function thaiAbbrDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${Number(day)} ${THAI_MONTH_ABBR[Number(month) - 1]} ${Number(year) + 543}`;
}
const DEFAULT_DETAIL_LIMIT = 5;
const MAX_DETAIL_LIMIT = 10;
const QUERY_COUNT = 16;

type MoneyGroup = { currency: string; count: number; total: string };
type AggregateRow = { currency: string; _count: { _all: number }; _sum: Record<string, unknown> };

type DetailRow = Pick<ExpenseEvidenceSource, 'aiVerificationSummaryJson' | 'attachments'> & {
  id: string;
  expenseNumber: string | null;
  vendorNameSnapshot: string | null;
  expenseDate: Date;
  dueDate: Date | null;
  currency: string;
  grandTotalAmount: { toString(): string };
  paidAmount: { toString(): string };
  outstandingAmount: { toString(): string };
  status: string;
  paymentStatus: string;
  primaryAttachmentId: string | null;
  missingReceiptReason: string | null;
  taxEvidenceStatus: string;
  duplicateStatus: string;
  expenseCategory: { name: string } | null;
};

const DETAIL_SELECT = {
  id: true,
  expenseNumber: true,
  vendorNameSnapshot: true,
  expenseDate: true,
  dueDate: true,
  currency: true,
  grandTotalAmount: true,
  paidAmount: true,
  outstandingAmount: true,
  status: true,
  paymentStatus: true,
  aiVerificationSummaryJson: true,
  primaryAttachmentId: true,
  missingReceiptReason: true,
  taxEvidenceStatus: true,
  duplicateStatus: true,
  expenseCategory: { select: { name: true } },
} satisfies Prisma.ExpenseRecordSelect;

function timestampRangeForBangkokDay(date: string): { gte: Date; lt: Date } {
  return civilInstantDayRangeToUtc(date, date) as { gte: Date; lt: Date };
}

function decimal(value: unknown): string {
  return String(value ?? '0');
}

function sumDecimal(values: unknown[]): string {
  return values.reduce<Decimal>((sum, value) => sum.plus(decimal(value)), new Decimal(0)).toFixed(4);
}

function collapseMoneyRows(
  rows: AggregateRow[],
  field: string,
): MoneyGroup[] {
  const grouped = new Map<string, { count: number; values: unknown[] }>();
  for (const row of rows) {
    const current = grouped.get(row.currency) ?? { count: 0, values: [] };
    current.count += row._count._all;
    current.values.push(row._sum[field]);
    grouped.set(row.currency, current);
  }
  return [...grouped.entries()]
    .map(([currency, value]) => ({ currency, count: value.count, total: sumDecimal(value.values) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function asAggregateRows(value: unknown): AggregateRow[] {
  return value as AggregateRow[];
}

function aggregateCount(rows: AggregateRow[]): number {
  return rows.reduce((total, row) => total + row._count._all, 0);
}

function hasPositiveSum(row: AggregateRow, field: string): boolean {
  return new Decimal(decimal(row._sum[field])).greaterThan(0);
}

function boundedItems(total: number, rows: DetailRow[], companyId: string, language: LineReplyLanguage) {
  const items = rows.map((row) => ({
    id: row.id,
    expenseNumber: row.expenseNumber,
    vendor: row.vendorNameSnapshot,
    category: row.expenseCategory?.name ?? null,
    expenseDate: civilDate(row.expenseDate, TIME_ZONE),
    dueDate: row.dueDate ? civilDate(row.dueDate, TIME_ZONE) : null,
    currency: row.currency,
    grandTotalAmount: decimal(row.grandTotalAmount),
    paidAmount: decimal(row.paidAmount),
    outstandingAmount: decimal(row.outstandingAmount),
    status: row.status,
    paymentStatus: row.paymentStatus,
    evidenceNotes: lineExpenseEvidenceNotes(row, language),
    evidenceAttention: !expenseEvidenceImageMissing(row) && row.primaryAttachmentId === null && row.missingReceiptReason === null
      || row.taxEvidenceStatus === 'NEEDS_REVIEW',
    duplicateRisk: row.duplicateStatus === 'POSSIBLE_DUPLICATE'
      || row.duplicateStatus === 'CONFIRMED_DUPLICATE',
    webUrl: `/companies/${companyId}/expenses/${row.id}`,
  }));
  return { total, shown: items.length, remaining: Math.max(0, total - items.length), items };
}

function asDetailRows(value: unknown): DetailRow[] {
  return value as DetailRow[];
}

@Injectable()
export class ExpenseGetDailyClosingTool implements ErpReadToolPort {
  readonly toolName = 'expense.get_daily_closing';

  constructor(private readonly prisma: PrismaService) {}

  async execute(
    ctx: ErpToolContext,
    input?: { date?: unknown; branchId?: unknown; detailLimit?: unknown },
  ): Promise<ToolResult> {
    const asOf = new Date().toISOString();
    const canReadAll = ctx.permissions.includes('expense.read') || ctx.permissions.includes('expense.review');
    const canReadRelated = ctx.permissions.includes('expense.read_related');
    if (!canReadAll && !canReadRelated && !ctx.permissions.includes('expense.read_own')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    // Item 1 (spec R-A1 row 18): the SAME own/related/company classification `accessClauses` below
    // already applies to this read, exposed so the answer can state it (this tool has no
    // `queryApplied` wrapper, so it rides `data.accessScope` directly).
    const accessScope: 'own' | 'related' | 'company' = canReadAll ? 'company' : canReadRelated ? 'related' : 'own';

    const date = input?.date === undefined ? bangkokToday() : input.date;
    if (!isCivilDate(date)) {
      return { toolName: this.toolName, status: 'error', errorCode: 'INVALID_DATE', sourceRefs: [], asOf };
    }
    // F3 (tuning-6b, T-105-b/run4): the model copies whatever the user said — a branch name, code, or
    // number, typos included (e.g. "สาขา 2") — never a raw id. An exact-id-only check here used to
    // return a bare 'forbidden' for a restricted caller (T-105-b: "2" → forbidden → a dead-end reply)
    // or silently query a nonexistent id and report zero for an unrestricted one. Same lookup as
    // expense.list_recent/get_breakdown (resolveExpenseBranchFilter): exact id/code, exact name, then
    // fuzzy contains/trailing-number, with an honest out-of-scope outcome before giving up.
    const sourceRefs: SourceRef[] = [{
      label: `สรุปปิดร้าน ${thaiAbbrDateLabel(date)}`,
      module: 'expenses',
      entityType: 'expense_daily_closing',
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/expenses`,
    }];
    const requestedBranch = typeof input?.branchId === 'string' && input.branchId.trim() ? input.branchId.trim() : undefined;
    const branchFilter = await resolveExpenseBranchFilter(this.prisma, this.toolName, ctx, requestedBranch, sourceRefs, asOf);
    if (!branchFilter.ok) return branchFilter.result;
    const branchId = branchFilter.branchId;
    const detailLimit = typeof input?.detailLimit === 'number' && Number.isFinite(input.detailLimit)
      ? Math.max(1, Math.min(MAX_DETAIL_LIMIT, Math.trunc(input.detailLimit)))
      : DEFAULT_DETAIL_LIMIT;

    const accessClauses: Prisma.ExpenseRecordWhereInput[] = [
      branchId
        ? { branchId }
        : branchScopeWhere({ branchIds: ctx.branchIds }) as Prisma.ExpenseRecordWhereInput,
      ...(!canReadAll
        ? [canReadRelated ? expenseRelatedToUserWhere(ctx.userId) : { createdByUserId: ctx.userId }]
        : []),
    ];
    const scopeWhere: Prisma.ExpenseRecordWhereInput = { companyId: ctx.companyId, AND: accessClauses };
    const activeWhere: Prisma.ExpenseRecordWhereInput = {
      AND: [scopeWhere, { status: { notIn: EXPENSE_CANCELLED_STATUSES } }],
    };
    const dayRange = civilDayRangeToUtc(date, date);
    const uploadedRange = timestampRangeForBangkokDay(date);
    const outstandingWhere: Prisma.ExpenseRecordWhereInput = {
      AND: [activeWhere, { paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] }, outstandingAmount: { gt: 0 } }],
    };
    const dueTodayWhere: Prisma.ExpenseRecordWhereInput = { AND: [outstandingWhere, { dueDate: dayRange }] };
    const overdueWhere: Prisma.ExpenseRecordWhereInput = { AND: [outstandingWhere, { dueDate: { lt: dayRange.gte } }] };
    const unscheduledWhere: Prisma.ExpenseRecordWhereInput = { AND: [outstandingWhere, { dueDate: null }] };
    const pendingWhere: Prisma.ExpenseRecordWhereInput = { AND: [activeWhere, { status: { in: EXPENSE_PENDING_STATUSES } }] };
    const evidenceWhere: Prisma.ExpenseRecordWhereInput = {
      AND: [activeWhere, { OR: [
        { primaryAttachmentId: null, missingReceiptReason: null },
        { taxEvidenceStatus: 'NEEDS_REVIEW' },
        { aiVerificationSummaryJson: { path: ['documentEvidenceDraft', 'originalDocumentAvailable'], equals: true } },
        { aiVerificationSummaryJson: { path: ['documentReview', 'assessment', 'originalDocumentAvailable'], equals: true } },
      ] }],
    };
    const duplicateWhere: Prisma.ExpenseRecordWhereInput = {
      AND: [activeWhere, { duplicateStatus: { in: ['POSSIBLE_DUPLICATE', 'CONFIRMED_DUPLICATE'] } }],
    };

    const startedAt = Date.now();
    const snapshot = await this.prisma.client.$transaction(async (db) => {
      const [
        occurredRows,
        dueRows,
        overdueRows,
        unscheduledRows,
        submittedCount,
        pendingCount,
        duplicateCount,
        excludedRows,
        occurredDetails,
        dueDetails,
        overdueDetails,
        unscheduledDetails,
        pendingDetails,
        evidenceDetails,
        duplicateDetails,
      ] = await Promise.all([
        db.expenseRecord.groupBy({
          by: ['currency', 'paymentStatus'], where: { AND: [activeWhere, { expenseDate: dayRange }] },
          _sum: { grandTotalAmount: true, paidAmount: true, outstandingAmount: true }, _count: { _all: true },
        }),
        db.expenseRecord.groupBy({ by: ['currency'], where: dueTodayWhere, _sum: { outstandingAmount: true }, _count: { _all: true } }),
        db.expenseRecord.groupBy({ by: ['currency'], where: overdueWhere, _sum: { outstandingAmount: true }, _count: { _all: true } }),
        db.expenseRecord.groupBy({ by: ['currency'], where: unscheduledWhere, _sum: { outstandingAmount: true }, _count: { _all: true } }),
        db.expenseRecord.count({ where: { AND: [scopeWhere, { uploadedAt: uploadedRange }] } }),
        db.expenseRecord.count({ where: pendingWhere }),
        db.expenseRecord.count({ where: duplicateWhere }),
        db.expenseRecord.groupBy({
          by: ['status'], where: { AND: [scopeWhere, { expenseDate: dayRange }, { status: { in: EXPENSE_CANCELLED_STATUSES } }] },
          _count: { _all: true },
        }),
        db.expenseRecord.findMany({ where: { AND: [activeWhere, { expenseDate: dayRange }] }, select: DETAIL_SELECT, orderBy: [{ expenseDate: 'desc' }, { uploadedAt: 'desc' }], take: detailLimit }),
        db.expenseRecord.findMany({ where: dueTodayWhere, select: DETAIL_SELECT, orderBy: [{ dueDate: 'asc' }, { uploadedAt: 'desc' }], take: detailLimit }),
        db.expenseRecord.findMany({ where: overdueWhere, select: DETAIL_SELECT, orderBy: [{ dueDate: 'asc' }, { uploadedAt: 'desc' }], take: detailLimit }),
        db.expenseRecord.findMany({ where: unscheduledWhere, select: DETAIL_SELECT, orderBy: { uploadedAt: 'desc' }, take: detailLimit }),
        db.expenseRecord.findMany({ where: pendingWhere, select: DETAIL_SELECT, orderBy: { uploadedAt: 'asc' }, take: detailLimit }),
        db.expenseRecord.findMany({ where: evidenceWhere, select: DETAIL_SELECT, orderBy: { uploadedAt: 'asc' } }),
        db.expenseRecord.findMany({ where: duplicateWhere, select: DETAIL_SELECT, orderBy: { uploadedAt: 'asc' }, take: detailLimit }),
      ]);
      const details = [occurredDetails, dueDetails, overdueDetails, unscheduledDetails, pendingDetails, evidenceDetails, duplicateDetails].map(asDetailRows);
      const ids = [...new Set(details.flat().map(row => row.id))];
      const links = await db.attachmentLink.findMany({ where: { companyId: ctx.companyId, targetType: 'expense.record', targetId: { in: ids } },
        select: { targetId: true, attachmentId: true, purpose: true, attachment: { select: { status: true } } } });
      for (const row of details.flat()) row.attachments = links.filter(link => link.targetId === row.id)
        .map(link => ({ id: link.attachmentId, status: link.attachment.status, purpose: link.purpose }));
      // The shared validator distinguishes an original in hand from missing evidence before counting or limiting.
      const candidates = asDetailRows(evidenceDetails);
      const imagesToAdd = candidates.filter(expenseEvidenceImageMissing);
      const blockers = candidates.filter(row => row.taxEvidenceStatus === 'NEEDS_REVIEW'
        || row.primaryAttachmentId === null && row.missingReceiptReason === null && !expenseEvidenceImageMissing(row));
      return {
        occurredRows, dueRows, overdueRows, unscheduledRows,
        imagesToAdd, submittedCount, pendingCount, evidenceCount: blockers.length, duplicateCount, excludedRows,
        occurredDetails, dueDetails, overdueDetails, unscheduledDetails, pendingDetails, evidenceDetails: blockers.slice(0, detailLimit), duplicateDetails,
      };
    }, { isolationLevel: 'RepeatableRead' });
    const queryDurationMs = Date.now() - startedAt;

    const occurred = snapshot.occurredRows as Array<{
      currency: string;
      paymentStatus: string;
      _count: { _all: number };
      _sum: Record<string, unknown>;
    }>;
    const totalOccurred = occurred.reduce((total, row) => total + row._count._all, 0);
    const paidOccurred = occurred.filter((row) =>
      (row.paymentStatus === 'PAID' || row.paymentStatus === 'PARTIALLY_PAID')
      && hasPositiveSum(row, 'paidAmount'));
    const outstandingOccurred = occurred.filter((row) =>
      (row.paymentStatus === 'UNPAID' || row.paymentStatus === 'PARTIALLY_PAID')
      && hasPositiveSum(row, 'outstandingAmount'));
    const excluded = Object.fromEntries((snapshot.excludedRows as Array<{ status: string; _count: { _all: number } }>)
      .map((row) => [row.status, row._count._all]));
    // `sourceRefs` (branch-resolution citation) was already built above, before the branch lookup.

    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        date,
        timezone: TIME_ZONE,
        accessScope,
        scope: {
          kind: branchId ? 'selected_branch' : ctx.branchIds ? 'restricted_branches' : 'all_branches',
          ...(branchId && { branchId }),
        },
        occurredToday: {
          totals: collapseMoneyRows(occurred, 'grandTotalAmount'),
          paid: collapseMoneyRows(paidOccurred, 'paidAmount'),
          outstanding: collapseMoneyRows(outstandingOccurred, 'outstandingAmount'),
          items: boundedItems(totalOccurred, asDetailRows(snapshot.occurredDetails), ctx.companyId, ctx.locale.startsWith('en') ? 'en' : 'th'),
        },
        submittedToday: { count: snapshot.submittedCount },
        dueEndOfDay: {
          totals: collapseMoneyRows(asAggregateRows(snapshot.dueRows), 'outstandingAmount'),
          items: boundedItems(aggregateCount(asAggregateRows(snapshot.dueRows)), asDetailRows(snapshot.dueDetails), ctx.companyId, ctx.locale.startsWith('en') ? 'en' : 'th'),
        },
        overdue: {
          totals: collapseMoneyRows(asAggregateRows(snapshot.overdueRows), 'outstandingAmount'),
          items: boundedItems(aggregateCount(asAggregateRows(snapshot.overdueRows)), asDetailRows(snapshot.overdueDetails), ctx.companyId, ctx.locale.startsWith('en') ? 'en' : 'th'),
        },
        unscheduledOutstanding: {
          totals: collapseMoneyRows(asAggregateRows(snapshot.unscheduledRows), 'outstandingAmount'),
          items: boundedItems(aggregateCount(asAggregateRows(snapshot.unscheduledRows)), asDetailRows(snapshot.unscheduledDetails), ctx.companyId, ctx.locale.startsWith('en') ? 'en' : 'th'),
        },
        pendingReview: { count: snapshot.pendingCount, items: boundedItems(snapshot.pendingCount, asDetailRows(snapshot.pendingDetails), ctx.companyId, ctx.locale.startsWith('en') ? 'en' : 'th') },
        documentImagesToAdd: { count: snapshot.imagesToAdd.length, items: boundedItems(snapshot.imagesToAdd.length, snapshot.imagesToAdd.slice(0, detailLimit), ctx.companyId, ctx.locale.startsWith('en') ? 'en' : 'th') },
        evidenceBlockers: { count: snapshot.evidenceCount, items: boundedItems(snapshot.evidenceCount, asDetailRows(snapshot.evidenceDetails), ctx.companyId, ctx.locale.startsWith('en') ? 'en' : 'th') },
        duplicateRisks: { count: snapshot.duplicateCount, items: boundedItems(snapshot.duplicateCount, asDetailRows(snapshot.duplicateDetails), ctx.companyId, ctx.locale.startsWith('en') ? 'en' : 'th') },
        excluded: { rejected: excluded['REJECTED'] ?? 0, voided: excluded['VOIDED'] ?? 0 },
        observability: {
          queryDurationMs,
          queryCount: QUERY_COUNT,
          truncated: [
            totalOccurred - asDetailRows(snapshot.occurredDetails).length,
            ...[snapshot.dueRows, snapshot.overdueRows, snapshot.unscheduledRows]
              .map((rows, index) => aggregateCount(asAggregateRows(rows))
                - asDetailRows([snapshot.dueDetails, snapshot.overdueDetails, snapshot.unscheduledDetails][index]).length),
            snapshot.pendingCount - asDetailRows(snapshot.pendingDetails).length,
            snapshot.evidenceCount - asDetailRows(snapshot.evidenceDetails).length,
            snapshot.duplicateCount - asDetailRows(snapshot.duplicateDetails).length,
          ].some((remaining) => remaining > 0),
        },
        limitations: { neverSubmittedDocumentsObservable: false },
        webUrl: `/companies/${ctx.companyId}/expenses`,
      },
      sourceRefs,
      asOf,
    };
  }
}
