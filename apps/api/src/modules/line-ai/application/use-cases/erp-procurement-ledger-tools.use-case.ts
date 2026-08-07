import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext, SourceRef, SupplierStatus, SupplierType, ToolResult } from '@watchdog-bms/contracts';
import { ListSuppliersUseCase } from '../../../procurement/application/use-cases/supplier.use-case';
import { GetPurchaseOrderUseCase, ListPurchaseOrdersUseCase } from '../../../procurement/application/use-cases/purchase-order.use-case';
import { ListPeriodsUseCase } from '../../../ledger/application/use-cases/period.use-case';
import { GetBalanceSheetUseCase, GetPnlReportUseCase, GetTrialBalanceUseCase } from '../../../ledger/application/use-cases/report.use-case';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { resolvePeriodInput } from './erp-tools.use-case';

function now(): string { return new Date().toISOString(); }

function toCtx(ctx: ErpToolContext): RequestContext {
  return {
    requestId: ctx.requestId ?? '', authSubject: ctx.userId, userId: ctx.userId,
    companyId: ctx.companyId, membershipId: ctx.membershipId ?? '', roles: ctx.roles ?? [],
    permissions: ctx.permissions, scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds }, authProvider: 'watchdog',
  };
}

function ref(ctx: ErpToolContext, asOf: string, module: string, entityType: string, label: string, path: string, entityId?: string): SourceRef {
  return { label, module, entityType, ...(entityId && { entityId }), asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}${path}` };
}

function forbidden(toolName: string, asOf: string, errorCode?: string): ToolResult {
  return { toolName, status: 'forbidden', sourceRefs: [], asOf, ...(errorCode && { errorCode }) };
}

function scopedBranch(ctx: ErpToolContext, requested?: string): { branchId?: string; error?: 'forbidden' | 'unsupported' } {
  const branchId = requested?.trim().slice(0, 200) || undefined;
  if (!ctx.branchIds) return { branchId };
  if (branchId) return ctx.branchIds.includes(branchId) ? { branchId } : { error: 'forbidden' };
  if (ctx.branchIds.length === 1) return { branchId: ctx.branchIds[0] };
  return { error: 'unsupported' };
}

const PURCHASE_ORDER_STATUSES = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ISSUED', 'PARTIALLY_RECEIVED',
  'RECEIVED', 'PARTIALLY_BILLED', 'BILLED', 'CLOSED', 'CANCELLED',
] as const;

@Injectable()
export class ProcurementGetSummaryTool implements ErpReadToolPort {
  toolName = 'procurement.get_summary';
  constructor(private readonly listPurchaseOrders: ListPurchaseOrdersUseCase) {}

  async execute(ctx: ErpToolContext, input?: { fromDate?: string; toDate?: string; branchId?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('procurement.purchase_order.read')) return forbidden(this.toolName, asOf);
    const branch = scopedBranch(ctx, input?.branchId);
    if (branch.error === 'forbidden') return forbidden(this.toolName, asOf, 'BRANCH_SCOPE_DENIED');
    if (branch.error === 'unsupported') {
      return { toolName: this.toolName, status: 'unavailable', sourceRefs: [], asOf, errorCode: 'MULTI_BRANCH_SUMMARY_UNSUPPORTED' };
    }
    const period = resolvePeriodInput(input);
    const baseFilter = { fromDate: period.fromDate, toDate: period.toDate, ...(branch.branchId && { branchId: branch.branchId }), page: 1, pageSize: 1 };
    const [all, ...statusPages] = await Promise.all([
      this.listPurchaseOrders.execute(toCtx(ctx), baseFilter),
      ...PURCHASE_ORDER_STATUSES.map((status) => this.listPurchaseOrders.execute(toCtx(ctx), { ...baseFilter, status })),
    ]);
    const byStatus = Object.fromEntries(PURCHASE_ORDER_STATUSES.map((status, index) => [status, statusPages[index]?.total ?? 0]));
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        period: { fromDate: period.fromDate, toDate: period.toDate, defaultedToCurrentMonth: period.defaulted },
        branchId: branch.branchId ?? null,
        total: all.total,
        byStatus,
        basis: 'canonical_purchase_order_record_counts',
        monetarySummaryAvailable: false,
        monetarySummaryUnavailableReason: 'canonical_purchase_order_list_source_has_no_bounded_aggregate_by_currency',
      },
      sourceRefs: [ref(ctx, asOf, 'procurement', 'purchase_order_summary', 'สรุปการจัดซื้อ', '/procurement')],
      asOf,
    };
  }
}

@Injectable()
export class ProcurementSearchSuppliersTool implements ErpReadToolPort {
  toolName = 'procurement.search_suppliers';
  constructor(private readonly listSuppliers: ListSuppliersUseCase) {}

  async execute(ctx: ErpToolContext, input?: { search?: string; status?: SupplierStatus; supplierType?: SupplierType; page?: number; limit?: number }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('procurement.supplier.read')) return forbidden(this.toolName, asOf);
    const page = Number.isSafeInteger(input?.page) && Number(input?.page) > 0 ? Number(input?.page) : 1;
    const pageSize = Number.isSafeInteger(input?.limit) ? Math.min(Math.max(Number(input?.limit), 1), 10) : 10;
    const search = typeof input?.search === 'string' ? input.search.trim().slice(0, 160) : '';
    const result = await this.listSuppliers.execute(toCtx(ctx), {
      ...(search && { search }), ...(input?.status && { status: input.status }),
      ...(input?.supplierType && { supplierType: input.supplierType }), page, pageSize,
    });
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        query: search || null, total: result.total, page: result.page, pageSize: result.pageSize,
        items: result.data.map((supplier) => ({
          id: supplier.id, supplierCode: supplier.supplierCode ?? null,
          displayName: supplier.displayNameSnapshot, supplierType: supplier.supplierType,
          status: supplier.status, defaultCurrency: supplier.defaultCurrency,
        })),
      },
      sourceRefs: [ref(ctx, asOf, 'procurement', 'supplier_search', 'รายชื่อผู้ขาย', '/procurement')],
      asOf,
    };
  }
}

@Injectable()
export class ProcurementGetPurchaseOrderDetailTool implements ErpReadToolPort {
  toolName = 'procurement.get_purchase_order_detail';
  constructor(private readonly getPurchaseOrder: GetPurchaseOrderUseCase) {}

  async execute(ctx: ErpToolContext, input?: { purchaseOrderId?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('procurement.purchase_order.read')) return forbidden(this.toolName, asOf);
    const purchaseOrderId = typeof input?.purchaseOrderId === 'string' ? input.purchaseOrderId.trim().slice(0, 200) : '';
    if (!purchaseOrderId) {
      return { toolName: this.toolName, status: 'ok', data: { needsPurchaseOrderId: true }, sourceRefs: [ref(ctx, asOf, 'procurement', 'purchase_order_detail', 'ข้อมูลใบสั่งซื้อ', '/procurement')], asOf };
    }
    let po;
    try {
      po = await this.getPurchaseOrder.execute(toCtx(ctx), purchaseOrderId);
    } catch (error) {
      if (error instanceof ForbiddenException) return forbidden(this.toolName, asOf, 'PURCHASE_ORDER_PERMISSION_DENIED');
      if (error instanceof NotFoundException) return {
        toolName: this.toolName, status: 'ok', data: { found: false },
        sourceRefs: [ref(ctx, asOf, 'procurement', 'purchase_order_query', 'ข้อมูลใบสั่งซื้อ', '/procurement')],
        asOf, errorCode: 'PURCHASE_ORDER_NOT_FOUND',
      };
      throw error;
    }
    if (ctx.branchIds && po.branchId && !ctx.branchIds.includes(po.branchId)) return forbidden(this.toolName, asOf, 'BRANCH_SCOPE_DENIED');
    const lines = po.lines ?? [];
    const supplierDisplayName = typeof po.supplierSnapshotJson?.['displayName'] === 'string'
      ? po.supplierSnapshotJson['displayName']
      : typeof po.supplierSnapshotJson?.['displayNameSnapshot'] === 'string'
        ? po.supplierSnapshotJson['displayNameSnapshot']
        : null;
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        id: po.id, purchaseOrderNumber: po.purchaseOrderNumber ?? null, status: po.status,
        supplierId: po.supplierId, supplierDisplayName, branchId: po.branchId ?? null,
        orderDate: po.orderDate.toISOString(), expectedDeliveryDate: po.expectedDeliveryDate?.toISOString() ?? null,
        currency: po.currency, subtotalAmount: po.subtotalAmount, discountAmount: po.discountAmount,
        taxableAmount: po.taxableAmount, vatAmount: po.vatAmount, whtEstimateAmount: po.whtEstimateAmount ?? null,
        grandTotalAmount: po.grandTotalAmount, receivedAmount: po.receivedAmount, billedAmount: po.billedAmount,
        outstandingAmount: po.outstandingAmount, matchingMode: po.matchingMode, postingStatus: po.postingStatus,
        taxSyncStatus: po.taxSyncStatus, lineCount: lines.length,
        lines: lines.slice(0, 20).map((line) => ({
          lineNumber: line.lineNumber, lineType: line.lineType, description: line.description,
          orderedQuantity: line.orderedQuantity, receivedQuantity: line.receivedQuantity,
          billedQuantity: line.billedQuantity, unitName: line.unitName ?? null, unitPrice: line.unitPrice,
          lineTotalAmount: line.lineTotalAmount, vatAmount: line.vatAmount,
        })),
      },
      sourceRefs: [ref(ctx, asOf, 'procurement', 'purchase_order', 'ข้อมูลใบสั่งซื้อ', '/procurement', po.id)],
      asOf,
    };
  }
}

@Injectable()
export class LedgerGetPeriodStatusTool implements ErpReadToolPort {
  toolName = 'ledger.get_period_status';
  constructor(private readonly listPeriods: ListPeriodsUseCase) {}

  async execute(ctx: ErpToolContext, input?: { periodKey?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('ledger.period.read')) return forbidden(this.toolName, asOf);
    const periodKey = typeof input?.periodKey === 'string' ? input.periodKey.trim().slice(0, 20) : '';
    if (!periodKey) {
      return { toolName: this.toolName, status: 'ok', data: { needsPeriodKey: true }, sourceRefs: [ref(ctx, asOf, 'ledger', 'accounting_period', 'สถานะงวดบัญชี', '/reports')], asOf };
    }
    const period = (await this.listPeriods.execute(toCtx(ctx))).find((item) => item.periodKey === periodKey);
    if (!period) return {
      toolName: this.toolName, status: 'ok', data: { found: false },
      sourceRefs: [ref(ctx, asOf, 'ledger', 'accounting_period_query', `งวดบัญชี ${periodKey}`, '/reports')],
      asOf, errorCode: 'LEDGER_PERIOD_NOT_FOUND',
    };
    return {
      toolName: this.toolName, status: 'ok',
      data: { periodKey: period.periodKey, startDate: period.startDate, endDate: period.endDate, status: period.status, closedAt: period.closedAt, reopenedAt: period.reopenedAt },
      sourceRefs: [ref(ctx, asOf, 'ledger', 'accounting_period', `งวดบัญชี ${periodKey}`, '/reports', period.id)], asOf,
    };
  }
}

type LedgerReportType = 'trial_balance' | 'profit_and_loss' | 'balance_sheet' | 'financial_summary';

@Injectable()
export class LedgerGetReportSummaryTool implements ErpReadToolPort {
  toolName = 'ledger.get_report_summary';
  constructor(
    private readonly listPeriods: ListPeriodsUseCase,
    private readonly trialBalance: GetTrialBalanceUseCase,
    private readonly pnl: GetPnlReportUseCase,
    private readonly balanceSheet: GetBalanceSheetUseCase,
  ) {}

  async execute(ctx: ErpToolContext, input?: { periodKey?: string; reportType?: LedgerReportType }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('ledger.report.read') || !ctx.permissions.includes('ledger.period.read')) return forbidden(this.toolName, asOf);
    const periodKey = typeof input?.periodKey === 'string' ? input.periodKey.trim().slice(0, 20) : '';
    if (!periodKey) {
      return { toolName: this.toolName, status: 'ok', data: { needsPeriodKey: true }, sourceRefs: [ref(ctx, asOf, 'ledger', 'ledger_report', 'รายงานบัญชีแยกประเภท', '/reports')], asOf };
    }
    const period = (await this.listPeriods.execute(toCtx(ctx))).find((item) => item.periodKey === periodKey);
    if (!period) return {
      toolName: this.toolName, status: 'ok', data: { found: false },
      sourceRefs: [ref(ctx, asOf, 'ledger', 'ledger_report_query', `รายงานบัญชี ${periodKey}`, '/reports')],
      asOf, errorCode: 'LEDGER_PERIOD_NOT_FOUND',
    };
    const reportType: LedgerReportType = ['trial_balance', 'profit_and_loss', 'balance_sheet'].includes(input?.reportType ?? '')
      ? input!.reportType as LedgerReportType : 'financial_summary';
    const data: Record<string, unknown> = {
      reportType, periodKey, periodStatus: period.status,
      basis: 'canonical_ledger_account_balances',
      currency: null,
      currencyUnavailableReason: 'canonical_ledger_report_contract_does_not_expose_company_base_currency',
    };
    if (reportType === 'trial_balance' || reportType === 'financial_summary') {
      const report = await this.trialBalance.execute(toCtx(ctx), periodKey);
      data['trialBalance'] = { totalDebit: report.totalDebit, totalCredit: report.totalCredit, difference: report.difference };
    }
    if (reportType === 'profit_and_loss' || reportType === 'financial_summary') {
      const report = await this.pnl.execute(toCtx(ctx), periodKey);
      data['profitAndLoss'] = { revenue: report.revenue, totalCost: report.totalCost, grossProfit: report.grossProfit, totalExpense: report.totalExpense, taxExpense: report.taxExpense, netProfit: report.netProfit };
    }
    if (reportType === 'balance_sheet' || reportType === 'financial_summary') {
      const report = await this.balanceSheet.execute(toCtx(ctx), periodKey);
      data['balanceSheet'] = { totalAssets: report.totalAssets, totalLiabilities: report.totalLiabilities, totalEquity: report.totalEquity };
    }
    return {
      toolName: this.toolName, status: 'ok', data,
      sourceRefs: [ref(ctx, asOf, 'ledger', 'ledger_report', `รายงานบัญชี ${periodKey}`, '/reports', period.id)], asOf,
    };
  }
}
