/**
 * ERP read tool adapters for LINE AI.
 * Each adapter repeats server-side permission + ABAC checks.
 * Returns ToolResult with source refs; never raw rows.
 */
import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { createHash } from 'node:crypto';
import type { ExpensePaymentStatus, ExpenseStatus, ToolResult, SourceRef } from '@watchdog-bms/contracts';
import { EXPENSE_PAYMENT_STATUSES, EXPENSE_STATUSES, civilInstantDayRangeToUtc, civilPeriodKey, todayCivilDate } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { ListProductsUseCase } from '../../../inventory/application/use-cases/list-products.use-case';
import { GetStockBalanceUseCase, GetStockReportUseCase, ListMovementsUseCase } from '../../../inventory/application/use-cases/movement-query.use-cases';
import { GetTrialBalanceUseCase, GetPnlReportUseCase, GetBalanceSheetUseCase } from '../../../ledger/application/use-cases/report.use-case';
import { ListExpensesUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import {
  BUSINESS_READ_BASIS_VERSION,
  CATEGORY_NAME_STRIP_PREFIXES,
  VENDOR_NAME_STRIP_PREFIXES,
  appliedQuery,
  applyNameFilter,
  completeResult,
  fact,
  periodError,
  resolveBranchCandidate,
  resolveBusinessReadPeriod,
  sourceRefId,
} from '../../domain/logic/business-read-source.logic';

function now(): string { return new Date().toISOString(); }

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

/** The web list showing what the answer counted (owner 2026-11-06: the button opened the whole list):
 *  its month, its ยังไม่ยืนยัน/ยืนยันแล้ว tab, unpaid only, its branch. The web ignores what it does not know. */
export function expenseListWebPath(companyId: string, filter: {
  branchId?: string | null; period: { fromDate: string; toDate: string }; documentStatus?: string; paymentStatus?: string;
}): string {
  const query = new URLSearchParams();
  if (filter.period.fromDate.slice(0, 7) === filter.period.toDate.slice(0, 7)) query.set('month', filter.period.fromDate.slice(0, 7));
  if (filter.documentStatus === 'NEEDS_REVIEW') query.set('chip', 'pending');
  else if (filter.documentStatus === 'CONFIRMED') query.set('chip', 'confirmed');
  if (filter.paymentStatus === 'UNPAID') query.set('view', 'unpaid');
  if (filter.branchId) query.set('branchId', filter.branchId);
  const text = query.toString();
  return `/companies/${companyId}/expenses${text ? `?${text}` : ''}`;
}

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
    // The low-stock REPORT is this answer's source, so it leads the refs whether or not the list is
    // empty: a caller that cites `sourceRefs[0]` must cite the report and link to it, not one arbitrary
    // product id (the per-product refs, kept after it, carry an id as their whole label).
    const sourceRefs: SourceRef[] = [
      {
        label: 'สินค้าใกล้หมด', module: 'inventory', entityType: 'low_stock_report', asOf,
        permissionChecked: true, webPath: `/companies/${ctx.companyId}/inventory`,
      },
      ...items.map((b): SourceRef => ({
        label: `สินค้า ${b.productId}`,
        module: 'inventory',
        entityType: 'stock_balance',
        entityId: b.productId,
        asOf,
        permissionChecked: true,
        webPath: `/companies/${ctx.companyId}/inventory/products/${b.productId}`,
      })),
    ];
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

export function resolvePeriodInput(input: { periodKey?: unknown; fromDate?: unknown; toDate?: unknown } | undefined): { fromDate: string; toDate: string; defaulted: boolean; periodKey?: string } {
  const resolved = resolveBusinessReadPeriod(input);
  if (!resolved.ok) throw new TypeError(resolved.errorCode);
  return resolved.period;
}

function expenseCursorFingerprint(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url').slice(0, 20);
}

function decodeExpenseCursor(cursor: string, fingerprint: string): { expenseDate: Date; id: string } | undefined {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (value['v'] !== 1 || value['f'] !== fingerprint || typeof value['d'] !== 'string' || typeof value['id'] !== 'string') return undefined;
    const expenseDate = new Date(value['d']);
    if (!Number.isFinite(expenseDate.getTime()) || value['id'].length > 200) return undefined;
    return { expenseDate, id: value['id'] };
  } catch { return undefined; }
}

function encodeExpenseCursor(source: { expenseDate: Date; id: string }, fingerprint: string): string {
  return Buffer.from(JSON.stringify({ v: 1, f: fingerprint, d: source.expenseDate.toISOString(), id: source.id })).toString('base64url');
}

export type BranchFilterOutcome =
  | { ok: true; branchId?: string; branchName?: string }
  | { ok: false; result: ToolResult };

/**
 * Resolves a branchId/code/name/number the model copied from the user (typos included) against the
 * caller's own SCOPED branches: exact id/code, then exact name — the catalog respects branch ABAC, a
 * branch-restricted user never sees names outside their scope. C3 (batch 5c, T-148-b): the model
 * sent branchId "2" for "สาขา 2" and both exact lookups missed it, so a normalized contains/trailing-
 * number match runs next (`resolveBranchCandidate`) before giving up. Still unresolved in scope:
 * checks whether the branch exists elsewhere in the COMPANY, with the SAME normalization, to return
 * an honest permission boundary (`branchOutOfScope`) instead of a bare "unresolved" that reads like a
 * typo for the model to retry. Shared by expense.list_recent and expense.get_breakdown — same branch
 * catalog, same lookup rules.
 */
export async function resolveExpenseBranchFilter(
  prisma: PrismaService,
  toolName: string,
  ctx: ErpToolContext,
  requestedBranch: string | undefined,
  nameLookupSourceRefs: SourceRef[],
  asOf: string,
): Promise<BranchFilterOutcome> {
  if (!requestedBranch) return { ok: true };
  const scopeWhere = {
    companyId: ctx.companyId,
    status: 'ACTIVE' as const,
    ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}),
  };
  // Exact identifiers are unique within a company; names are not. Resolve identifiers first, then
  // require a unique name match. This avoids both arbitrary duplicate-name selection and the old
  // first-100 scan hiding a valid exact id/code match.
  const identifiers = await prisma.client.branch.findMany({
    where: { ...scopeWhere, OR: [{ id: requestedBranch }, { code: requestedBranch }] },
    select: { id: true, name: true, code: true },
    take: 2,
  });
  if (identifiers.length > 1) {
    return { ok: false, result: { toolName, status: 'ok', data: {
      branchAmbiguous: requestedBranch,
      availableBranches: identifiers.map((b) => ({ id: b.id, name: b.name, code: b.code })),
    }, sourceRefs: nameLookupSourceRefs, asOf } };
  }
  let hit = identifiers[0];
  if (!hit) {
    const names = await prisma.client.branch.findMany({
      where: { ...scopeWhere, name: requestedBranch },
      select: { id: true, name: true, code: true },
      take: 2,
    });
    if (names.length > 1) {
      return { ok: false, result: { toolName, status: 'ok', data: {
        branchAmbiguous: requestedBranch,
        availableBranches: names.map((b) => ({ id: b.id, name: b.name, code: b.code })),
      }, sourceRefs: nameLookupSourceRefs, asOf } };
    }
    hit = names[0];
  }
  if (!hit) {
    const branches = await prisma.client.branch.findMany({
      where: scopeWhere,
      select: { id: true, name: true, code: true },
      take: 101,
    });
    const lookupLimited = branches.length > 100;
    const availableBranches = branches.slice(0, 100).map((b) => ({ id: b.id, name: b.name, code: b.code }));
    const fuzzy = resolveBranchCandidate(requestedBranch, availableBranches);
    if (fuzzy.kind === 'resolved') {
      // Look up the already-fetched row rather than rebuilding one from `fuzzy` — `code` there is
      // typed `string | null` for callers whose catalog allows it, but this one (Prisma's Branch.code)
      // never is, and the row is already right here. Guaranteed present: `fuzzy` was resolved FROM
      // `availableBranches` by the same id.
      hit = availableBranches.find((b) => b.id === fuzzy.id)!;
    } else if (fuzzy.kind === 'ambiguous') {
      return { ok: false, result: { toolName, status: 'ok', data: {
        branchAmbiguous: requestedBranch, availableBranches: fuzzy.matches,
      }, sourceRefs: nameLookupSourceRefs, asOf } };
    }
    if (!hit) {
      // Item 2 (T-148): a STAFF user asking for a branch that exists in this COMPANY but outside
      // their OWN branch scope got a raw TOOL_RESULT_NO_SOURCE code — this tool must say so
      // honestly instead (never the generic "unresolved", which reads like a typo the model should
      // retry). Company-wide, never scoped to `ctx`'s branches, and returns no business data, only
      // whether SOME active branch matches — the permission boundary stays exact because
      // `availableBranches` above is still the caller's own scoped catalog, never anything about the
      // forbidden branch itself.
      const outOfScope = Boolean(ctx.branchIds) && await (async () => {
        const companyWide = await prisma.client.branch.findMany({
          where: { companyId: ctx.companyId, status: 'ACTIVE' },
          select: { id: true, name: true, code: true },
          take: 101,
        });
        return resolveBranchCandidate(requestedBranch, companyWide).kind !== 'not_found';
      })();
      if (outOfScope) {
        return { ok: false, result: { toolName, status: 'ok', data: { branchOutOfScope: requestedBranch, availableBranches }, sourceRefs: nameLookupSourceRefs, asOf } };
      }
      return { ok: false, result: { toolName, status: 'ok', data: {
        branchUnresolved: requestedBranch, availableBranches,
        ...(lookupLimited ? { branchLookupLimited: true } : {}),
      }, sourceRefs: nameLookupSourceRefs, asOf } };
    }
  }
  return { ok: true, branchId: hit.id, branchName: hit.name };
}

@Injectable()
export class ExpenseListRecentTool implements ErpReadToolPort {
  toolName = 'expense.list_recent';
  constructor(private readonly listExpenses: ListExpensesUseCase, private readonly prisma: PrismaService) {}

  async execute(ctx: ErpToolContext, input: {
    periodKey?: string; fromDate?: string; toDate?: string; branchId?: string;
    categoryId?: string; vendorId?: string; categoryName?: string; vendorName?: string;
    documentStatus?: ExpenseStatus; paymentStatus?: ExpensePaymentStatus;
    limit?: number; cursor?: string;
  } = {}): Promise<ToolResult> {
    let asOf = now();
    if (!ctx.permissions.includes('expense.read') && !ctx.permissions.includes('expense.review')
      && !ctx.permissions.includes('expense.read_related') && !ctx.permissions.includes('expense.read_own')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const resolved = resolveBusinessReadPeriod(input);
    if (!resolved.ok) return periodError(this.toolName, asOf, resolved);
    const period = resolved.period;
    if (input.documentStatus !== undefined && !(EXPENSE_STATUSES as readonly string[]).includes(input.documentStatus)) {
      return { toolName: this.toolName, status: 'error', errorCode: 'UNSUPPORTED_FILTER', errorMessage: 'Unsupported filter: documentStatus', sourceRefs: [], asOf };
    }
    if (input.paymentStatus !== undefined && !(EXPENSE_PAYMENT_STATUSES as readonly string[]).includes(input.paymentStatus)) {
      return { toolName: this.toolName, status: 'error', errorCode: 'UNSUPPORTED_FILTER', errorMessage: 'Unsupported filter: paymentStatus', sourceRefs: [], asOf };
    }
    if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50)) {
      return { toolName: this.toolName, status: 'error', errorCode: 'UNSUPPORTED_FILTER', errorMessage: 'limit must be 1-50', sourceRefs: [], asOf };
    }
    // Item 2 (223-turn eval batch 2, T-148): every branch/category/vendor resolution outcome below
    // is still a real, permission-checked answer drawn from this company's own catalog — it needs a
    // source citation like any other 'ok' result, or the gateway's enforceSourceHonesty boundary
    // check (which requires at least one sourceRef on any 'ok' result) discards it as an opaque
    // TOOL_RESULT_NO_SOURCE error before any caller ever sees availableBranches/Categories/Vendors.
    const nameLookupSourceRefs: SourceRef[] = [{ label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/expenses` }];
    // The model copies whatever the user said — a branch name, code, or id, typos included — see
    // `resolveExpenseBranchFilter` for the exact/fuzzy/out-of-scope lookup order (C3, batch 5c).
    const requestedBranch = typeof input?.branchId === 'string' && input.branchId.trim() ? input.branchId.trim() : undefined;
    const branchFilter = await resolveExpenseBranchFilter(this.prisma, this.toolName, ctx, requestedBranch, nameLookupSourceRefs, asOf);
    if (!branchFilter.ok) return branchFilter.result;
    const branchId = branchFilter.branchId;
    // Spec §4 R-M1: the resolved display name, not the raw id/code/name the model sent — this is
    // what read memory (line-read-evidence.service.ts) shows back for a branch-scoped follow-up.
    const branchName = branchFilter.branchName;
    // categoryName/vendorName resolution (spec §3 row 6): same exact-then-contains match as the
    // branch lookup above. Vendor candidates use the branch already resolved here, not the raw
    // input, so a branch name plus a vendor name narrow together.
    const requestedCategoryName = typeof input?.categoryName === 'string' && input.categoryName.trim() ? input.categoryName.trim() : undefined;
    const requestedVendorName = typeof input?.vendorName === 'string' && input.vendorName.trim() ? input.vendorName.trim() : undefined;
    const categoryCandidates = requestedCategoryName ? await this.listExpenses.listCategoryCandidates(ctx.companyId) : [];
    const categoryFilter = applyNameFilter(input.categoryId, requestedCategoryName, categoryCandidates, CATEGORY_NAME_STRIP_PREFIXES);
    if (categoryFilter.status === 'conflict') {
      return { toolName: this.toolName, status: 'error', errorCode: 'UNSUPPORTED_FILTER', errorMessage: 'categoryId and categoryName resolve to different categories', sourceRefs: [], asOf };
    }
    if (categoryFilter.status === 'ambiguous') {
      return { toolName: this.toolName, status: 'ok', data: { categoryAmbiguous: requestedCategoryName, availableCategories: categoryFilter.matches }, sourceRefs: nameLookupSourceRefs, asOf };
    }
    if (categoryFilter.status === 'not_found') {
      return { toolName: this.toolName, status: 'ok', data: { categoryUnresolved: requestedCategoryName, availableCategories: categoryFilter.available }, sourceRefs: nameLookupSourceRefs, asOf };
    }
    const vendorCandidates = requestedVendorName ? await this.listExpenses.readAiVendorCandidates(toCtx(ctx), branchId) : [];
    const vendorFilter = applyNameFilter(input.vendorId, requestedVendorName, vendorCandidates, VENDOR_NAME_STRIP_PREFIXES);
    if (vendorFilter.status === 'conflict') {
      return { toolName: this.toolName, status: 'error', errorCode: 'UNSUPPORTED_FILTER', errorMessage: 'vendorId and vendorName resolve to different vendors', sourceRefs: [], asOf };
    }
    if (vendorFilter.status === 'ambiguous') {
      return { toolName: this.toolName, status: 'ok', data: { vendorAmbiguous: requestedVendorName, availableVendors: vendorFilter.matches }, sourceRefs: nameLookupSourceRefs, asOf };
    }
    if (vendorFilter.status === 'not_found') {
      return { toolName: this.toolName, status: 'ok', data: { vendorUnresolved: requestedVendorName, availableVendors: vendorFilter.available }, sourceRefs: nameLookupSourceRefs, asOf };
    }
    const categoryId = categoryFilter.id;
    const vendorId = vendorFilter.id;
    const cursorFingerprint = expenseCursorFingerprint({
      companyId: ctx.companyId, userId: ctx.userId, branchIds: ctx.branchIds ?? null,
      period: [period.fromDate, period.toDate], branchId: branchId ?? null,
      categoryId: categoryId ?? null, vendorId: vendorId ?? null,
      documentStatus: input.documentStatus ?? null, paymentStatus: input.paymentStatus ?? null,
    });
    const cursor = input.cursor === undefined ? undefined
      : typeof input.cursor === 'string' ? decodeExpenseCursor(input.cursor, cursorFingerprint) : undefined;
    if (input.cursor !== undefined && !cursor) {
      return { toolName: this.toolName, status: 'error', errorCode: 'INVALID_CURSOR', errorMessage: 'The cursor does not match this query.', sourceRefs: [], asOf };
    }
    const snapshot = await this.listExpenses.readAiSummary(toCtx(ctx), {
      fromDate: period.fromDate, toDate: period.toDate, ...(branchId && { branchId }),
      ...(categoryId ? { expenseCategoryId: categoryId } : {}),
      ...(vendorId ? { vendorCounterpartyId: vendorId } : {}),
      ...(input.documentStatus ? { status: input.documentStatus } : {}),
      ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
    }, input.limit ?? 20, cursor);
    asOf = snapshot.asOf.toISOString();
    // Item 1 (spec R-A1 row 18): `readAiSummary` now echoes the scope it already applied; an older
    // test double or caller that predates this field simply reads as company-wide, unchanged.
    const accessScope = (snapshot as { accessScope?: 'own' | 'related' | 'company' }).accessScope ?? 'company';
    const sourceRefs: SourceRef[] = [{
      label: 'รายการค่าใช้จ่าย',
      module: 'expenses',
      entityType: 'expense_summary',
      asOf,
      permissionChecked: true,
      // A branch-scoped answer must not deep-link to the all-branches list, or the web view
      // contradicts the figures the user just read. `branchId` is a resolved id by here — the
      // unresolved case returned the branch catalog above and never reaches this link.
      webPath: expenseListWebPath(ctx.companyId, { branchId, period, documentStatus: input.documentStatus, paymentStatus: input.paymentStatus }),
    }];
    const soleCurrency = snapshot.byCurrency.length === 1 ? snapshot.byCurrency[0] : undefined;
    const sumStatuses = (statuses: readonly string[]) => snapshot.byStatus
      .filter((row) => statuses.includes(row.status) && (!soleCurrency || row.currency === soleCurrency.currency))
      .reduce((sum, row) => sum.add(row.totalAmount), new Decimal(0)).toString();
    const summary = {
      countedItems: snapshot.total,
      cancelledCount: 0,
      totalAmount: soleCurrency?.totalAmount ?? null,
      pendingAmount: soleCurrency ? sumStatuses(['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION']) : null,
      draftAmount: soleCurrency ? sumStatuses(['DRAFT']) : null,
      confirmedAmount: soleCurrency ? sumStatuses(['CONFIRMED']) : null,
      paidAmount: soleCurrency?.paidAmount ?? null,
      unpaidAmount: soleCurrency?.outstandingAmount ?? null,
    };
    const queryApplied = appliedQuery(period, {
      branch: { mode: branchId ? 'selected' : 'all_authorized', branchId: branchId ?? null },
      dateBasis: 'expense_incurred_date',
      statusBasis: input.documentStatus ?? 'exclude_rejected_voided',
      dataset: 'operational_expense_records',
      accessScope,
      filters: {
        ...(categoryId ? { categoryId } : {}),
        ...(categoryFilter.name ? { categoryName: categoryFilter.name } : {}),
        ...(vendorId ? { vendorId } : {}),
        ...(vendorFilter.name ? { vendorName: vendorFilter.name } : {}),
        ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
        ...(branchName ? { branchName } : {}),
      },
    });
    const completeness = completeResult(snapshot.items.length, snapshot.hasMore);
    completeness.rows.nextCursor = snapshot.nextCursorSource ? encodeExpenseCursor(snapshot.nextCursorSource, cursorFingerprint) : null;
    const facts = snapshot.byCurrency.map((row) => fact({
      id: `expense.total.${row.currency}`,
      metric: 'expense_total', value: row.totalAmount, unit: 'money', currency: row.currency,
      period: queryApplied.period ?? null, dateBasis: queryApplied.dateBasis, statusBasis: queryApplied.statusBasis,
      sourceRefIds: sourceRefs.map(sourceRefId), asOf, state: row.count === 0 ? 'empty' : 'known',
    }));
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        // The counted basis, not the raw record count: `summary` excludes rejected and voided
        // documents, so reporting the unfiltered repository total here made the headline number
        // disagree with every money figure under it. `summary.cancelledCount` carries the rest.
        total: summary.countedItems,
        // Effective period echoed so answers can state the window (defaults to current month).
        period: { fromDate: period.fromDate, toDate: period.toDate, defaultedToCurrentMonth: period.defaulted },
        ...(branchId && { branchId }),
        summary,
        totalsByCurrency: snapshot.byCurrency,
        ...(snapshot.byCurrency.length > 1 ? { mixedCurrency: true } : {}),
        queryApplied, completeness,
        items: snapshot.items.map((expense) => ({
          id: expense.id,
          expenseNumber: expense.expenseNumber,
          expenseDate: expense.expenseDate.toISOString(),
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
      queryApplied,
      basisVersion: BUSINESS_READ_BASIS_VERSION,
      facts,
      completeness,
    };
  }
}

// ---- sales.get_sales_summary ----

@Injectable()
export class SalesGetSalesSummaryTool implements ErpReadToolPort {
  toolName = 'sales.get_sales_summary';
  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: ErpToolContext, input: { periodKey?: string; fromDate?: string; toDate?: string; branchId?: string } = {}): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('crm.report.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }

    const resolved = resolveBusinessReadPeriod(input);
    if (!resolved.ok) return periodError(this.toolName, asOf, resolved);
    const period = resolved.period;
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
      paidAt: civilInstantDayRangeToUtc(period.fromDate, period.toDate),
      ...(branchId ? { branchId } : branchIds ? { OR: [{ branchId: { in: branchIds } }, { branchId: null }] } : {}),
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
    const baseCurrency = company?.baseCurrency ?? 'THB';
    const totalsByCurrency = rows.length > 0 ? rows.map((row) => ({
      currency: row.currency,
      amount: String(row._sum.amount ?? '0'),
      transactionCount: row._count._all,
    })) : [{ currency: baseCurrency, amount: '0', transactionCount: 0 }];
    const baseTotal = totalsByCurrency.find((row) => row.currency === baseCurrency);
    const sourceRefs: SourceRef[] = [{
      label: 'ยอดรับเงินจริงจากลูกค้า',
      module: 'accounting-documents',
      entityType: 'received_payment_summary',
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/crm-reports`,
    }];
    const queryApplied = appliedQuery(period, {
      branch: { mode: branchId ? 'selected' : 'all_authorized', branchId: branchId ?? null },
      dateBasis: 'payment_paid_at', statusBasis: 'recorded_received_customer_payments',
      dataset: 'operational_sales_cash_receipts',
    });
    const completeness = completeResult(0, false, totalsByCurrency.length, false);
    const facts = totalsByCurrency.map((row) => fact({
      id: `sales.cash_received.${row.currency}`,
      metric: 'cash_received', value: row.amount, unit: 'money', currency: row.currency,
      period: queryApplied.period ?? null, dateBasis: queryApplied.dateBasis, statusBasis: queryApplied.statusBasis,
      sourceRefIds: sourceRefs.map(sourceRefId), asOf, state: row.transactionCount === 0 ? 'empty' : 'known',
    }));
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
        queryApplied,
        completeness,
      },
      sourceRefs,
      asOf,
      queryApplied,
      basisVersion: BUSINESS_READ_BASIS_VERSION,
      facts,
      completeness,
    };
  }
}
