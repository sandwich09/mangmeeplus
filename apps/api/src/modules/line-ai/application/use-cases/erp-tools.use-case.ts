/**
 * ERP read tool adapters for LINE AI.
 * Each adapter repeats server-side permission + ABAC checks.
 * Returns ToolResult with source refs; never raw rows.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { ToolResult, SourceRef } from '@watchdog-bms/contracts';
import { isExpensePending } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { ListProductsUseCase } from '../../../inventory/application/use-cases/list-products.use-case';
import { GetStockBalanceUseCase, GetStockReportUseCase, ListMovementsUseCase } from '../../../inventory/application/use-cases/movement-query.use-cases';
import { GetTrialBalanceUseCase, GetPnlReportUseCase, GetBalanceSheetUseCase } from '../../../ledger/application/use-cases/report.use-case';
import { ListExpensesUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { civilPeriodKey, todayCivilDate } from '@watchdog-bms/contracts';

function now(): string { return new Date().toISOString(); }

function money(value: string | null | undefined): number {
  const amount = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function toCtx(ctx: ErpToolContext): RequestContext {
  return {
    requestId: ctx.requestId ?? '',
    authSubject: ctx.userId,
    userId: ctx.userId,
    companyId: ctx.companyId,
    membershipId: ctx.membershipId ?? '',
    roles: [],
    permissions: ctx.permissions,
    scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds },
    authProvider: 'watchdog',
  };
}

// ---- inventory.search_products ----

@Injectable()
export class InventorySearchProductsTool implements ErpReadToolPort {
  toolName = 'inventory.search_products';
  constructor(private readonly listProducts: ListProductsUseCase) {}

  async execute(ctx: ErpToolContext, input: { search?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('inventory.product.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const page = await this.listProducts.execute(toCtx(ctx), { search: input.search, status: 'ACTIVE', page: 1, pageSize: 10 });
    const sourceRefs: SourceRef[] = page.items.map((p) => ({
      label: p.name,
      module: 'inventory',
      entityType: 'product',
      entityId: p.id,
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/inventory/products/${p.id}`,
    }));
    if (sourceRefs.length === 0) sourceRefs.push({
      label: 'รายการสินค้า', module: 'inventory', entityType: 'product_list', asOf,
      permissionChecked: true, webPath: `/companies/${ctx.companyId}/inventory/products`,
    });
    return { toolName: this.toolName, status: 'ok', data: { total: page.total, items: page.items.map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit })) }, sourceRefs, asOf };
  }
}

// ---- inventory.list_low_stock ----

@Injectable()
export class InventoryListLowStockTool implements ErpReadToolPort {
  toolName = 'inventory.list_low_stock';
  constructor(private readonly report: GetStockReportUseCase) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('inventory.product.read') || !ctx.permissions.includes('inventory.report.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const { items } = await this.report.execute(toCtx(ctx), { lowStockOnly: true, branchIds: ctx.branchIds });
    const sourceRefs: SourceRef[] = items.map((b) => ({
      label: `สินค้า ${b.productId}`,
      module: 'inventory',
      entityType: 'stock_balance',
      entityId: b.productId,
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/inventory/products/${b.productId}`,
    }));
    if (sourceRefs.length === 0) sourceRefs.push({
      label: 'สินค้าใกล้หมด', module: 'inventory', entityType: 'low_stock_report', asOf,
      permissionChecked: true, webPath: `/companies/${ctx.companyId}/inventory`,
    });
    return { toolName: this.toolName, status: 'ok', data: { count: items.length, items: items.slice(0, 10).map((b) => ({ productId: b.productId, quantity: b.quantity, locationId: b.locationId })) }, sourceRefs, asOf };
  }
}

// ---- inventory.get_stock_balance ----

@Injectable()
export class InventoryGetStockBalanceTool implements ErpReadToolPort {
  toolName = 'inventory.get_stock_balance';
  constructor(private readonly balance: GetStockBalanceUseCase) {}

  async execute(ctx: ErpToolContext, input: { productId?: string; locationId?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('inventory.product.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const balances = await this.balance.execute(toCtx(ctx), { productId: input.productId, locationId: input.locationId });
    const sourceRefs: SourceRef[] = balances.map((b) => ({
      label: `สต็อก ${b.productId}`,
      module: 'inventory',
      entityType: 'stock_balance',
      entityId: b.productId,
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/inventory/products/${b.productId}`,
    }));
    if (sourceRefs.length === 0) sourceRefs.push({
      label: 'ยอดคงเหลือสินค้า', module: 'inventory', entityType: 'stock_balance_summary', asOf,
      permissionChecked: true, webPath: `/companies/${ctx.companyId}/inventory`,
    });
    return { toolName: this.toolName, status: 'ok', data: balances.map((b) => ({ productId: b.productId, locationId: b.locationId, quantity: b.quantity })), sourceRefs, asOf };
  }
}

// ---- inventory.summarize_stock_movements ----

@Injectable()
export class InventorySummarizeMovementsTool implements ErpReadToolPort {
  toolName = 'inventory.summarize_stock_movements';
  private readonly logger = new Logger(InventorySummarizeMovementsTool.name);
  constructor(private readonly listMovements: ListMovementsUseCase) {}

  async execute(ctx: ErpToolContext, input: { fromDate?: string; toDate?: string; productId?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('inventory.movement.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const page = await this.listMovements.execute(toCtx(ctx), { ...input, page: 1, pageSize: 50 });
    const inQty = page.items.filter((m) => m.direction === 'IN').reduce((s, m) => s + parseFloat(m.quantity), 0);
    const outQty = page.items.filter((m) => m.direction === 'OUT').reduce((s, m) => s + parseFloat(m.quantity), 0);
    const sourceRefs: SourceRef[] = [{ label: 'รายงานการเคลื่อนไหวสต็อก', module: 'inventory', entityType: 'movement_report', permissionChecked: true, asOf, webPath: `/companies/${ctx.companyId}/inventory/movements` }];
    return { toolName: this.toolName, status: 'ok', data: { total: page.total, inQty, outQty, periodFrom: input.fromDate, periodTo: input.toDate }, sourceRefs, asOf };
  }
}

@Injectable()
export class LedgerFinancialSummaryTool implements ErpReadToolPort {
  toolName = 'ledger.get_financial_summary';
  constructor(
    private readonly trialBalance: GetTrialBalanceUseCase,
    private readonly pnl: GetPnlReportUseCase,
    private readonly balanceSheet: GetBalanceSheetUseCase,
  ) {}

  async execute(ctx: ErpToolContext, input: { periodKey?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('ledger.report.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const periodKey = input.periodKey ?? civilPeriodKey(todayCivilDate());
    const [tb, pnl, bs] = await Promise.all([
      this.trialBalance.execute(toCtx(ctx), periodKey),
      this.pnl.execute(toCtx(ctx), periodKey),
      this.balanceSheet.execute(toCtx(ctx), periodKey),
    ]);
    const sourceRefs: SourceRef[] = [{
      label: `Ledger ${periodKey}`,
      module: 'ledger',
      entityType: 'financial_summary',
      entityId: periodKey,
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/reports`,
    }];
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        periodKey,
        trialBalanceDifference: tb.difference,
        revenue: pnl.revenue,
        netProfit: pnl.netProfit,
        totalAssets: bs.totalAssets,
        totalLiabilities: bs.totalLiabilities,
        totalEquity: bs.totalEquity,
      },
      sourceRefs,
      asOf,
    };
  }
}

// Owner decision 2026-07-03: period-scoped tools default to "now" (current month, Asia/Bangkok)
// unless the model passes an explicit range from the user's time context.
export function bangkokToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

export function currentMonthRange(): { fromDate: string; toDate: string } {
  const today = bangkokToday();
  return { fromDate: `${today.slice(0, 8)}01`, toDate: today };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** ponytail: 10 × 100 rows is far past what a LINE answer can use; raise it only if a real
 *  period legitimately exceeds 1000 expenses and the summary must still be exact. */
const EXPENSE_PAGE_CAP = 10;

export function resolvePeriodInput(input: { fromDate?: unknown; toDate?: unknown } | undefined): { fromDate: string; toDate: string; defaulted: boolean } {
  const fromDate = typeof input?.fromDate === 'string' && DATE_PATTERN.test(input.fromDate) ? input.fromDate : undefined;
  const toDate = typeof input?.toDate === 'string' && DATE_PATTERN.test(input.toDate) ? input.toDate : undefined;
  if (fromDate || toDate) {
    return { fromDate: fromDate ?? '1970-01-01', toDate: toDate ?? bangkokToday(), defaulted: false };
  }
  return { ...currentMonthRange(), defaulted: true };
}

@Injectable()
export class ExpenseListRecentTool implements ErpReadToolPort {
  toolName = 'expense.list_recent';
  constructor(private readonly listExpenses: ListExpensesUseCase, private readonly prisma: PrismaService) {}

  async execute(ctx: ErpToolContext, input?: { fromDate?: string; toDate?: string; branchId?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('expense.read') && !ctx.permissions.includes('expense.review')
      && !ctx.permissions.includes('expense.read_related') && !ctx.permissions.includes('expense.read_own')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const period = resolvePeriodInput(input);
    // The model copies whatever the user said — a branch name, code, or id, typos included. Exact
    // id/name/code resolves here; anything else returns the ACTIVE branches in this user's scope
    // instead of records, so the MODEL does the semantic matching (retry with the right id, or ask)
    // rather than this tool answering a confident zero for a branch that exists under another
    // spelling. The catalog respects branch ABAC — a branch-restricted user never sees names
    // outside their scope, and a name outside that scope stays unresolvable on purpose.
    const requestedBranch = typeof input?.branchId === 'string' && input.branchId.trim() ? input.branchId.trim() : undefined;
    let branchId: string | undefined;
    if (requestedBranch) {
      const branches = await this.prisma.client.branch.findMany({
        where: {
          companyId: ctx.companyId,
          status: 'ACTIVE',
          ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}),
        },
        select: { id: true, name: true, code: true },
        take: 100,
      });
      const hit = branches.find((b) => b.id === requestedBranch || b.name === requestedBranch || b.code === requestedBranch);
      if (!hit) {
        return {
          toolName: this.toolName,
          status: 'ok',
          data: {
            branchUnresolved: requestedBranch,
            availableBranches: branches.map((b) => ({ id: b.id, name: b.name })),
          },
          sourceRefs: [],
          asOf,
        };
      }
      branchId = hit.id;
    }
    const filter = { fromDate: period.fromDate, toDate: period.toDate, ...(branchId && { branchId }) };
    const first = await this.listExpenses.execute(toCtx(ctx), { ...filter, page: 1, pageSize: 100 });
    const pages = [first];
    // A wide date range used to page until the repository ran out of rows, so one LINE question
    // could fan out to hundreds of queries. `truncated` says the summary covers only the first
    // EXPENSE_PAGE_CAP pages so an answer can admit the bound instead of understating the period.
    for (let page = 2; (page - 1) * first.pageSize < first.total && page <= EXPENSE_PAGE_CAP; page++) {
      pages.push(await this.listExpenses.execute(toCtx(ctx), { ...filter, page, pageSize: first.pageSize }));
    }
    const truncated = EXPENSE_PAGE_CAP * first.pageSize < first.total;
    const expenses = pages.flatMap((page) => page.data);
    const sourceRefs: SourceRef[] = [{
      label: 'รายการค่าใช้จ่าย',
      module: 'expenses',
      entityType: 'expense_summary',
      asOf,
      permissionChecked: true,
      // A branch-scoped answer must not deep-link to the all-branches list, or the web view
      // contradicts the figures the user just read. `branchId` is a resolved id by here — the
      // unresolved case returned the branch catalog above and never reaches this link.
      webPath: `/companies/${ctx.companyId}/expenses${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`,
    }];
    const summary = expenses.reduce((acc, expense) => {
      // Rejected and voided documents are not company expenses, and rejecting leaves
      // `outstandingAmount` untouched — counting them here reported money the company does not owe
      // and a total it never spent. `expense.get_breakdown` already excludes them; this tool did
      // not, so the two disagreed on the same period. `cancelledCount` is reported so an answer can
      // say what was left out rather than silently differ from `total`.
      if (expense.status === 'REJECTED' || expense.status === 'VOIDED') {
        acc.cancelledCount += 1;
        return acc;
      }
      const grandTotal = money(expense.grandTotalAmount);
      acc.countedItems += 1;
      acc.totalAmount += grandTotal;
      // `draftAmount` counted DRAFT only and `confirmedAmount` CONFIRMED only, so everything mid
      // review — EXTRACTING, NEEDS_REVIEW, READY_FOR_CONFIRMATION — fell out of both buckets and
      // the work in progress read as zero. `pendingAmount` uses the shared pending set, which
      // makes `pendingAmount + confirmedAmount` equal `totalAmount` for every status.
      // `draftAmount` stays as the narrower "not submitted yet" figure.
      if (isExpensePending(expense.status)) acc.pendingAmount += grandTotal;
      if (expense.status === 'DRAFT') acc.draftAmount += grandTotal;
      if (expense.status === 'CONFIRMED') acc.confirmedAmount += grandTotal;
      acc.paidAmount += money(expense.paidAmount);
      acc.unpaidAmount += money(expense.outstandingAmount);
      return acc;
    }, { countedItems: 0, cancelledCount: 0, totalAmount: 0, pendingAmount: 0, draftAmount: 0, confirmedAmount: 0, paidAmount: 0, unpaidAmount: 0 });
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        // The counted basis, not the raw record count: `summary` excludes rejected and voided
        // documents, so reporting the unfiltered repository total here made the headline number
        // disagree with every money figure under it. `summary.cancelledCount` carries the rest.
        total: summary.countedItems,
        ...(truncated && { truncated: true }),
        // Effective period echoed so answers can state the window (defaults to current month).
        period: { fromDate: period.fromDate, toDate: period.toDate, defaultedToCurrentMonth: period.defaulted },
        ...(branchId && { branchId }),
        summary,
        items: expenses.slice(0, 5).map((expense) => ({
          id: expense.id,
          expenseNumber: expense.expenseNumber,
          expenseDate: expense.expenseDate,
          vendorNameSnapshot: expense.vendorNameSnapshot,
          vendorDocumentNumber: expense.vendorDocumentNumber,
          status: expense.status,
          paymentStatus: expense.paymentStatus,
          grandTotalAmount: expense.grandTotalAmount,
          paidAmount: expense.paidAmount,
          outstandingAmount: expense.outstandingAmount,
        })),
      },
      sourceRefs,
      asOf,
    };
  }
}

// ---- sales.get_sales_summary ----

@Injectable()
export class SalesGetSalesSummaryTool implements ErpReadToolPort {
  toolName = 'sales.get_sales_summary';
  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: ErpToolContext, input?: { fromDate?: string; toDate?: string; branchId?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('crm.report.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }

    const period = resolvePeriodInput(input);
    const branchId = typeof input?.branchId === 'string' && input.branchId ? input.branchId : undefined;
    if (branchId && ctx.branchIds && !ctx.branchIds.includes(branchId)) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const branchIds = branchId ? [branchId] : ctx.branchIds;
    const where = {
      companyId: ctx.companyId,
      direction: 'RECEIVED' as any,
      status: 'RECORDED' as any,
      counterparty: { is: { type: { in: ['CUSTOMER', 'BOTH'] as any } } },
      paidAt: {
        gte: new Date(`${period.fromDate}T00:00:00+07:00`),
        lte: new Date(`${period.toDate}T23:59:59.999+07:00`),
      },
      ...(branchIds ? { OR: [{ branchId: { in: branchIds } }, { branchId: null }] } : {}),
    };
    const [rows, company] = await Promise.all([
      this.prisma.client.accountingPayment.groupBy({
        by: ['currency'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.client.company.findUnique({ where: { id: ctx.companyId }, select: { baseCurrency: true } }),
    ]);
    const totalsByCurrency = rows.map((row) => ({
      currency: row.currency,
      amount: String(row._sum.amount ?? '0'),
      transactionCount: row._count._all,
    }));
    const baseCurrency = company?.baseCurrency ?? 'THB';
    const baseTotal = totalsByCurrency.find((row) => row.currency === baseCurrency);
    const sourceRefs: SourceRef[] = [{
      label: 'ยอดรับเงินจริงจากลูกค้า',
      module: 'accounting-documents',
      entityType: 'received_payment_summary',
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/crm-reports`,
    }];
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        totalSales: baseTotal?.amount ?? '0',
        currency: baseCurrency,
        transactionCount: baseTotal?.transactionCount ?? 0,
        totalsByCurrency,
        basis: 'recorded_received_payments',
        period: { fromDate: period.fromDate, toDate: period.toDate, defaultedToCurrentMonth: period.defaulted },
        ...(branchId && { branchId }),
      },
      sourceRefs,
      asOf,
    };
  }
}
