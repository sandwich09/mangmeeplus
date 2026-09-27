import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
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
import { bangkokToday } from './erp-tools.use-case';

const TIME_ZONE = 'Asia/Bangkok';
const DEFAULT_DETAIL_LIMIT = 5;
const MAX_DETAIL_LIMIT = 10;
const QUERY_COUNT = 16;

type MoneyGroup = { currency: string; count: number; total: string };
type AggregateRow = { currency: string; _count: { _all: number }; _sum: Record<string, unknown> };

type DetailRow = {
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

function boundedItems(total: number, rows: DetailRow[], companyId: string) {
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
    evidenceAttention: row.primaryAttachmentId === null && row.missingReceiptReason === null
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

    const date = input?.date === undefined ? bangkokToday() : input.date;
    if (!isCivilDate(date)) {
      return { toolName: this.toolName, status: 'error', errorCode: 'INVALID_DATE', sourceRefs: [], asOf };
    }
    const branchId = typeof input?.branchId === 'string' && input.branchId ? input.branchId : undefined;
    if (branchId && ctx.branchIds && !ctx.branchIds.includes(branchId)) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
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
        evidenceCount,
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
        db.expenseRecord.count({ where: evidenceWhere }),
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
        db.expenseRecord.findMany({ where: evidenceWhere, select: DETAIL_SELECT, orderBy: { uploadedAt: 'asc' }, take: detailLimit }),
        db.expenseRecord.findMany({ where: duplicateWhere, select: DETAIL_SELECT, orderBy: { uploadedAt: 'asc' }, take: detailLimit }),
      ]);
      return {
        occurredRows, dueRows, overdueRows, unscheduledRows,
        submittedCount, pendingCount, evidenceCount, duplicateCount, excludedRows,
        occurredDetails, dueDetails, overdueDetails, unscheduledDetails, pendingDetails, evidenceDetails, duplicateDetails,
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
    const sourceRefs: SourceRef[] = [{
      label: `สรุปปิดร้าน ${date}`,
      module: 'expenses',
      entityType: 'expense_daily_closing',
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/expenses`,
    }];

    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        date,
        timezone: TIME_ZONE,
        scope: {
          kind: branchId ? 'selected_branch' : ctx.branchIds ? 'restricted_branches' : 'all_branches',
          ...(branchId && { branchId }),
        },
        occurredToday: {
          totals: collapseMoneyRows(occurred, 'grandTotalAmount'),
          paid: collapseMoneyRows(paidOccurred, 'paidAmount'),
          outstanding: collapseMoneyRows(outstandingOccurred, 'outstandingAmount'),
          items: boundedItems(totalOccurred, asDetailRows(snapshot.occurredDetails), ctx.companyId),
        },
        submittedToday: { count: snapshot.submittedCount },
        dueEndOfDay: {
          totals: collapseMoneyRows(asAggregateRows(snapshot.dueRows), 'outstandingAmount'),
          items: boundedItems(aggregateCount(asAggregateRows(snapshot.dueRows)), asDetailRows(snapshot.dueDetails), ctx.companyId),
        },
        overdue: {
          totals: collapseMoneyRows(asAggregateRows(snapshot.overdueRows), 'outstandingAmount'),
          items: boundedItems(aggregateCount(asAggregateRows(snapshot.overdueRows)), asDetailRows(snapshot.overdueDetails), ctx.companyId),
        },
        unscheduledOutstanding: {
          totals: collapseMoneyRows(asAggregateRows(snapshot.unscheduledRows), 'outstandingAmount'),
          items: boundedItems(aggregateCount(asAggregateRows(snapshot.unscheduledRows)), asDetailRows(snapshot.unscheduledDetails), ctx.companyId),
        },
        pendingReview: { count: snapshot.pendingCount, items: boundedItems(snapshot.pendingCount, asDetailRows(snapshot.pendingDetails), ctx.companyId) },
        evidenceBlockers: { count: snapshot.evidenceCount, items: boundedItems(snapshot.evidenceCount, asDetailRows(snapshot.evidenceDetails), ctx.companyId) },
        duplicateRisks: { count: snapshot.duplicateCount, items: boundedItems(snapshot.duplicateCount, asDetailRows(snapshot.duplicateDetails), ctx.companyId) },
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
