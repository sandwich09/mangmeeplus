import Decimal from 'decimal.js';
import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type {
  IncomeExpenseLedgerEntries,
  IncomeExpenseLedgerEntry,
  IncomeExpenseLedgerEntryType,
  IncomeExpenseLedgerExport,
  IncomeExpenseLedgerSummary,
  RequestContext,
} from '@watchdog-bms/contracts';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { safeCsvCell } from '../../../../common/export/csv.logic';
import { buildXlsx } from '../../../../common/export/xlsx.logic';
import { branchScopeWhere } from '../../../data-model-core/domain/logic/branch.logic';
import { CompanyVatRegistrationUseCase } from '../../../data-model-core/application/use-cases/company-vat-registration.use-case';
import {
  calculateIncomeExpenseLedgerAmounts,
  calculateVatRegistrationAlert,
  categoryBreakdownMatches,
  INCOME_EXPENSE_LEDGER_TIMEZONE,
  ledgerBangkokInstantRange,
  ledgerCivilRange,
  mergeSignedCategoryAmounts,
  resolveIncomeExpenseLedgerPeriod,
  resolveVatRegistrationWatchPeriod,
} from '../../domain/logic/income-expense-ledger.logic';

const ISSUED_STATUSES = ['ISSUED', 'CREDITED', 'DEBITED', 'CLOSED'] as const;
const POSITIVE_SALE_TYPES = ['INVOICE', 'BILLING_NOTE', 'DEBIT_NOTE'] as const;
const DOCUMENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ISSUED', 'VOIDED', 'CREDITED', 'DEBITED', 'CLOSED'];
const EXPENSE_STATUSES = ['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'VOIDED'];
const EXPORT_MAX_ROWS = 10_000;

type EntryFilter = {
  type?: IncomeExpenseLedgerEntryType;
  categoryId?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

function sum(value: unknown): string {
  return String(value ?? '0');
}

function snapshotName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  for (const key of ['displayName', 'legalName', 'name']) {
    if (typeof row[key] === 'string' && row[key]!.trim()) return row[key] as string;
  }
  return undefined;
}

function boundedPositiveInt(value: number | undefined, fallback: number, max: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.min(max, Math.trunc(value!)) : fallback;
}

// A linked TAX_INVOICE is tax evidence for its source and must not recognize the sale twice.
// A source-less TAX_INVOICE is itself the revenue root and must not disappear from the ledger.
function revenueRootDocumentWhere() {
  return {
    OR: [
      { documentType: { in: [...POSITIVE_SALE_TYPES] } },
      { documentType: 'TAX_INVOICE', sourceDocumentId: null },
    ],
  };
}

function incomeEntryDocumentWhere() {
  return {
    OR: [
      { documentType: { in: [...POSITIVE_SALE_TYPES] } },
      { documentType: 'TAX_INVOICE', sourceDocumentId: null },
      { documentType: 'CREDIT_NOTE' },
    ],
  };
}

function scopedRevenueRootDocumentWhere(scope: Record<string, unknown>) {
  return { AND: [scope, revenueRootDocumentWhere()] };
}

function scopedIncomeEntryDocumentWhere(scope: Record<string, unknown>) {
  return { AND: [scope, incomeEntryDocumentWhere()] };
}

@Injectable()
export class IncomeExpenseLedgerUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vatRegistration: CompanyVatRegistrationUseCase,
  ) {}

  async summary(
    ctx: RequestContext,
    from?: string,
    to?: string,
    today = todayCivilDate(INCOME_EXPENSE_LEDGER_TIMEZONE),
  ): Promise<IncomeExpenseLedgerSummary> {
    const period = resolveIncomeExpenseLedgerPeriod(from, to);
    if (!period) throw new UnprocessableEntityException('ช่วงวันที่ต้องเป็น YYYY-MM-DD และวันเริ่มต้องไม่เกินวันสิ้นสุด');
    const canIncome = ctx.permissions.includes('accounting.document.read');
    const canExpense = ctx.permissions.includes('expense.read');
    if (!canIncome && !canExpense) throw new ForbiddenException('ต้องมีสิทธิ์ดูเอกสารขายหรือรายการรายจ่าย');
    const scope = branchScopeWhere(ctx.scopes);
    const civilRange = ledgerCivilRange(period.from, period.to);
    const instantRange = ledgerBangkokInstantRange(period.from, period.to);
    // The legal threshold is company-wide. A branch-restricted caller must never see a partial
    // total presented as the company's VAT-registration position.
    const canShowVatAlert = canIncome
      && ctx.permissions.includes('company.vat_registration.read')
      && ctx.permissions.includes('tax.profile.read')
      && ctx.scopes.branchIds === undefined;

    const [vatStatus, raw] = await Promise.all([
      // This is an advisory, not a posting control: a transient accessor failure must omit the
      // banner rather than take the core ledger down with it.
      canShowVatAlert ? this.vatRegistration.get(ctx.companyId, today).catch(() => null) : null,
      this.prisma.client.$transaction(async (tx: any) => {
        const income = canIncome ? await Promise.all([
          tx.accountingDocument.aggregate({
            where: { companyId: ctx.companyId, ...scopedRevenueRootDocumentWhere(scope), status: { in: [...ISSUED_STATUSES] }, documentDate: civilRange },
            _sum: { grandTotalAmount: true },
          }),
          tx.accountingDocument.aggregate({
            where: { companyId: ctx.companyId, ...scope, documentType: 'CREDIT_NOTE', status: { in: [...ISSUED_STATUSES] }, documentDate: civilRange },
            _sum: { grandTotalAmount: true },
          }),
          tx.accountingPayment.aggregate({
            where: { companyId: ctx.companyId, ...scope, direction: 'RECEIVED', status: 'RECORDED', paidAt: instantRange },
            _sum: { amount: true, whtAmount: true },
          }),
          tx.accountingDocument.aggregate({
            where: { companyId: ctx.companyId, ...scopedRevenueRootDocumentWhere(scope), status: { in: [...ISSUED_STATUSES] }, outstandingAmount: { gt: 0 } },
            _sum: { outstandingAmount: true },
          }),
          tx.accountingDocumentLine.groupBy({
            by: ['revenueCategoryId', 'revenueCategory'],
            where: { companyId: ctx.companyId, document: { is: { ...scopedRevenueRootDocumentWhere(scope), status: { in: [...ISSUED_STATUSES] }, documentDate: civilRange } } },
            _sum: { lineTotalAmount: true },
          }),
          tx.accountingDocumentLine.groupBy({
            by: ['revenueCategoryId', 'revenueCategory'],
            where: { companyId: ctx.companyId, document: { is: { ...scope, documentType: 'CREDIT_NOTE', status: { in: [...ISSUED_STATUSES] }, documentDate: civilRange } } },
            _sum: { lineTotalAmount: true },
          }),
        ]) : null;
        const expense = canExpense ? await Promise.all([
          tx.expenseRecord.aggregate({
            where: { companyId: ctx.companyId, ...scope, status: 'CONFIRMED', expenseDate: civilRange },
            _sum: { grandTotalAmount: true },
          }),
          tx.expensePayment.aggregate({
            where: { companyId: ctx.companyId, status: 'RECORDED', paidAt: instantRange, expense: { is: scope } },
            _sum: { amount: true },
          }),
          tx.expenseLine.groupBy({
            by: ['expenseCategoryId'],
            where: { companyId: ctx.companyId, expense: { is: { ...scope, status: 'CONFIRMED', expenseDate: civilRange } } },
            _sum: { lineTotalAmount: true },
          }),
        ]) : null;
        const categoryIds = (expense?.[2] ?? []).map((row: any) => row.expenseCategoryId).filter(Boolean);
        const categoryNames = categoryIds.length
          ? await tx.expenseCategory.findMany({ where: { id: { in: categoryIds }, OR: [{ companyId: ctx.companyId }, { companyId: null }] }, select: { id: true, name: true } })
          : [];
        const taxProfile = canShowVatAlert
          ? await tx.companyTaxProfile.findUnique({ where: { companyId: ctx.companyId }, select: { accountingPeriodMonth: true } })
          : null;
        const vatWatchPeriod = taxProfile ? resolveVatRegistrationWatchPeriod(today, taxProfile.accountingPeriodMonth) : null;
        const vatWatchRange = vatWatchPeriod ? ledgerCivilRange(vatWatchPeriod.periodStart, vatWatchPeriod.periodEnd) : null;
        const vatWatchIncome = vatWatchRange ? await Promise.all([
          tx.accountingDocument.aggregate({
            where: { companyId: ctx.companyId, ...revenueRootDocumentWhere(), status: { in: [...ISSUED_STATUSES] }, documentDate: vatWatchRange },
            _sum: { grandTotalAmount: true },
          }),
          tx.accountingDocument.aggregate({
            where: { companyId: ctx.companyId, documentType: 'CREDIT_NOTE', status: { in: [...ISSUED_STATUSES] }, documentDate: vatWatchRange },
            _sum: { grandTotalAmount: true },
          }),
        ]) : null;
        return { income, expense, categoryNames, vatWatchPeriod, vatWatchIncome };
      }, { isolationLevel: 'RepeatableRead' }),
    ]);

    const incomeRows = raw.income ? mergeSignedCategoryAmounts(
      raw.income[4].map((row: any) => ({ categoryId: row.revenueCategoryId, label: row.revenueCategory, amount: sum(row._sum.lineTotalAmount) })),
      raw.income[5].map((row: any) => ({ categoryId: row.revenueCategoryId, label: row.revenueCategory, amount: sum(row._sum.lineTotalAmount) })),
    ) : [];
    const expenseNameById = new Map(raw.categoryNames.map((row: any) => [row.id, row.name] as const));
    const expenseRows = raw.expense ? mergeSignedCategoryAmounts(raw.expense[2].map((row: any) => ({
      categoryId: row.expenseCategoryId,
      label: row.expenseCategoryId ? expenseNameById.get(row.expenseCategoryId) : undefined,
      amount: sum(row._sum.lineTotalAmount),
    }))) : [];
    const amounts = calculateIncomeExpenseLedgerAmounts({
      positiveSales: sum(raw.income?.[0]._sum.grandTotalAmount),
      creditSales: sum(raw.income?.[1]._sum.grandTotalAmount),
      receivedCash: sum(raw.income?.[2]._sum.amount),
      receivedWht: sum(raw.income?.[2]._sum.whtAmount),
      receivableOutstanding: sum(raw.income?.[3]._sum.outstandingAmount),
      recordedExpense: sum(raw.expense?.[0]._sum.grandTotalAmount),
      paidExpense: sum(raw.expense?.[1]._sum.amount),
    });
    const incomeMatches = !raw.income || categoryBreakdownMatches(amounts.salesDocumentTotal, incomeRows);
    const expenseMatches = !raw.expense || categoryBreakdownMatches(amounts.recordedExpenseTotal, expenseRows);
    const incomeAvailable = canIncome && incomeMatches;
    const expenseAvailable = canExpense && expenseMatches;
    const vatRegistrationAlert = incomeAvailable && vatStatus && raw.vatWatchPeriod && raw.vatWatchIncome
      ? calculateVatRegistrationAlert({
          status: vatStatus.status,
          positiveSales: sum(raw.vatWatchIncome[0]._sum.grandTotalAmount),
          creditSales: sum(raw.vatWatchIncome[1]._sum.grandTotalAmount),
          periodStart: raw.vatWatchPeriod.periodStart,
          periodEnd: raw.vatWatchPeriod.periodEnd,
        })
      : undefined;

    return {
      period,
      income: incomeAvailable ? {
        available: true, salesDocumentTotal: amounts.salesDocumentTotal, receivedTotal: amounts.receivedTotal,
        withheldTaxTotal: amounts.withheldTaxTotal, receivableOutstanding: amounts.receivableOutstanding, byCategory: incomeRows,
        ...(vatRegistrationAlert && { vatRegistrationAlert }),
      } : { available: false, unavailableReason: canIncome ? 'DATA_MISMATCH' : 'NO_PERMISSION', byCategory: [] },
      expense: expenseAvailable ? {
        available: true, recordedExpenseTotal: amounts.recordedExpenseTotal, paidExpenseTotal: amounts.paidExpenseTotal, byCategory: expenseRows,
      } : { available: false, unavailableReason: canExpense ? 'DATA_MISMATCH' : 'NO_PERMISSION', byCategory: [] },
      ...(incomeAvailable && expenseAvailable ? {
        cashDifference: amounts.cashDifference,
        documentDifference: amounts.documentDifference,
      } : {}),
    };
  }

  async entries(ctx: RequestContext, filter: EntryFilter = {}): Promise<IncomeExpenseLedgerEntries> {
    return this.listEntries(ctx, filter, 100);
  }

  private async listEntries(ctx: RequestContext, filter: EntryFilter, maxPageSize: number): Promise<IncomeExpenseLedgerEntries> {
    const period = resolveIncomeExpenseLedgerPeriod(filter.from, filter.to);
    if (!period) throw new UnprocessableEntityException('ช่วงวันที่ต้องเป็น YYYY-MM-DD และวันเริ่มต้องไม่เกินวันสิ้นสุด');
    const type = filter.type ?? 'ALL';
    if (!['ALL', 'INCOME', 'EXPENSE', 'RECEIVABLE'].includes(type)) throw new UnprocessableEntityException('ประเภทรายการไม่ถูกต้อง');
    const canIncome = ctx.permissions.includes('accounting.document.read');
    const canExpense = ctx.permissions.includes('expense.read');
    const includeIncome = type !== 'EXPENSE' && canIncome;
    const includeExpense = (type === 'ALL' || type === 'EXPENSE') && canExpense;
    if (!includeIncome && !includeExpense) throw new ForbiddenException('ไม่มีสิทธิ์ดูรายการที่เลือก');
    if (filter.status && type === 'ALL') throw new UnprocessableEntityException('กรุณาเลือกฝั่งรายรับหรือรายจ่ายก่อนกรองสถานะ');
    if (filter.status && includeIncome && !DOCUMENT_STATUSES.includes(filter.status)) throw new UnprocessableEntityException('สถานะเอกสารขายไม่ถูกต้อง');
    if (filter.status && includeExpense && !EXPENSE_STATUSES.includes(filter.status)) throw new UnprocessableEntityException('สถานะรายจ่ายไม่ถูกต้อง');
    const page = boundedPositiveInt(filter.page, 1, 100);
    const pageSize = boundedPositiveInt(filter.pageSize, 20, maxPageSize);
    const candidateLimit = page * pageSize;
    const scope = branchScopeWhere(ctx.scopes);
    const civilRange = ledgerCivilRange(period.from, period.to);

    const result = await this.prisma.client.$transaction(async (tx: any) => {
      const documentWhere = includeIncome ? {
        companyId: ctx.companyId,
        ...(type === 'RECEIVABLE' ? scopedRevenueRootDocumentWhere(scope) : scopedIncomeEntryDocumentWhere(scope)),
        status: type === 'RECEIVABLE' ? { in: [...ISSUED_STATUSES] } : filter.status ?? { in: [...ISSUED_STATUSES] },
        ...(type === 'RECEIVABLE' ? { outstandingAmount: { gt: 0 } } : { documentDate: civilRange }),
        ...(filter.categoryId ? { lines: { some: { revenueCategoryId: filter.categoryId } } } : {}),
      } : null;
      const expenseWhere = includeExpense ? {
        companyId: ctx.companyId, ...scope, status: filter.status ?? 'CONFIRMED', expenseDate: civilRange,
        ...(filter.categoryId ? { lines: { some: { expenseCategoryId: filter.categoryId } } } : {}),
      } : null;
      const [documents, documentCount, expenses, expenseCount] = await Promise.all([
        documentWhere ? tx.accountingDocument.findMany({
          where: documentWhere,
          orderBy: type === 'RECEIVABLE' ? [{ dueDate: 'asc' }, { documentDate: 'asc' }, { id: 'asc' }] : [{ documentDate: 'desc' }, { id: 'desc' }],
          take: candidateLimit,
          include: { lines: { select: { revenueCategoryId: true, revenueCategory: true } } },
        }) : [],
        documentWhere ? tx.accountingDocument.count({ where: documentWhere }) : 0,
        expenseWhere ? tx.expenseRecord.findMany({
          where: expenseWhere, orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }], take: candidateLimit,
          include: { lines: { select: { expenseCategoryId: true, expenseCategory: { select: { name: true } } } } },
        }) : [],
        expenseWhere ? tx.expenseRecord.count({ where: expenseWhere }) : 0,
      ]);
      return { documents, documentCount, expenses, expenseCount };
    }, { isolationLevel: 'RepeatableRead' });

    const documentEntries: IncomeExpenseLedgerEntry[] = result.documents.map((row: any) => {
      const negative = row.documentType === 'CREDIT_NOTE';
      const amount = new Decimal(row.grandTotalAmount.toString()).mul(negative ? -1 : 1).toFixed(2);
      return {
        id: row.id, ...(row.branchId && { branchId: row.branchId }), side: 'INCOME', sourceType: 'accounting_document', date: row.documentDate.toISOString().slice(0, 10),
        ...(row.dueDate && { dueDate: row.dueDate.toISOString().slice(0, 10) }),
        ...(row.documentNumber && { referenceNumber: row.documentNumber }),
        ...(row.counterpartyId && { counterpartyId: row.counterpartyId }),
        ...(snapshotName(row.counterpartySnapshotJson) && { partyName: snapshotName(row.counterpartySnapshotJson) }),
        categoryLabels: [...new Set(row.lines.map((line: any) => line.revenueCategory || 'ยังไม่จัดหมวด'))],
        status: row.status, amount,
        ...(!negative && { outstandingAmount: new Decimal(row.outstandingAmount).toFixed(2) }),
        evidenceHref: `/companies/${ctx.companyId}/sales-documents?documentId=${encodeURIComponent(row.id)}`,
      };
    });
    const expenseEntries: IncomeExpenseLedgerEntry[] = result.expenses.map((row: any) => ({
      id: row.id, side: 'EXPENSE', sourceType: 'expense_record', date: row.expenseDate.toISOString().slice(0, 10),
      ...(row.expenseNumber && { referenceNumber: row.expenseNumber }),
      ...(row.vendorNameSnapshot && { partyName: row.vendorNameSnapshot }),
      categoryLabels: [...new Set(row.lines.map((line: any) => line.expenseCategory?.name || 'ยังไม่จัดหมวด'))],
      status: row.status, amount: new Decimal(row.grandTotalAmount).toFixed(2),
      outstandingAmount: new Decimal(row.outstandingAmount).toFixed(2),
      evidenceHref: `/companies/${ctx.companyId}/expenses/${encodeURIComponent(row.id)}`,
    }));
    const offset = (page - 1) * pageSize;
    const data = [...documentEntries, ...expenseEntries]
      .sort((a, b) => type === 'RECEIVABLE'
        ? (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
        : b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .slice(offset, offset + pageSize);
    return {
      period, data, total: result.documentCount + result.expenseCount, page, pageSize,
      includedSides: [...(includeIncome ? ['INCOME' as const] : []), ...(includeExpense ? ['EXPENSE' as const] : [])],
    };
  }

  async export(ctx: RequestContext, filter: Omit<EntryFilter, 'page' | 'pageSize'> = {}): Promise<IncomeExpenseLedgerExport> {
    const type = filter.type ?? 'ALL';
    const needsIncome = type !== 'EXPENSE';
    const needsExpense = type === 'ALL' || type === 'EXPENSE';
    if (needsIncome && !ctx.permissions.includes('accounting.document.export')) {
      throw new ForbiddenException('ต้องมีสิทธิ์ดาวน์โหลดเอกสารขาย');
    }
    if (needsExpense && !ctx.permissions.includes('expense.export')) {
      throw new ForbiddenException('ต้องมีสิทธิ์ดาวน์โหลดรายการรายจ่าย');
    }
    const first = await this.listEntries(ctx, { ...filter, page: 1, pageSize: EXPORT_MAX_ROWS }, EXPORT_MAX_ROWS);
    if (first.total > EXPORT_MAX_ROWS) {
      throw new UnprocessableEntityException('มีมากกว่า 10,000 รายการ กรุณาเลือกช่วงวันที่ให้สั้นลงแล้วลองใหม่');
    }
    const rows = [...first.data];
    if (rows.length !== first.total) throw new UnprocessableEntityException('จำนวนรายการเปลี่ยนระหว่างเตรียมไฟล์ กรุณาลองใหม่');
    const header = ['ประเภท', 'วันที่', 'เลขที่เอกสาร', 'คู่ค้า', 'หมวด', 'สถานะ', 'จำนวนเงิน', 'ยอดค้าง', 'หลักฐานต้นทาง'];
    const values = rows.map((row) => [
      row.side === 'INCOME' ? 'รายรับ' : 'รายจ่าย', row.date, row.referenceNumber ?? '', row.partyName ?? '',
      row.categoryLabels.join(' / '), row.status, row.amount, row.outstandingAmount ?? '', row.evidenceHref,
    ]);
    const csv = `\uFEFF${[header, ...values].map((row) => row.map(safeCsvCell).join(',')).join('\n')}`;
    const stamp = `${first.period.from}_${first.period.to}`;
    return {
      period: first.period, includedSides: first.includedSides, rowCount: rows.length,
      csvFileName: `สมุดรายรับรายจ่าย_${stamp}.csv`, csv,
      xlsxFileName: `สมุดรายรับรายจ่าย_${stamp}.xlsx`,
      xlsxBase64: buildXlsx([header, ...values.map((row) => row.map((cell, index) => index === 6 || index === 7 ? Number(cell || 0) : cell))], 'สมุดรายรับรายจ่าย').toString('base64'),
    };
  }
}
