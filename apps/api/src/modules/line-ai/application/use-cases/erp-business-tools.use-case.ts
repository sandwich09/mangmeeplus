/**
 * Business read tools for LINE AI: accounting documents, AP outstanding, employee summary,
 * and expense breakdown. Read-only; each adapter re-checks permissions server-side and
 * returns bounded ToolResult data (no PII, no raw rows).
 * Period-scoped tools default to the current month (owner decision 2026-07-03).
 */
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ACCOUNTING_DOCUMENT_VIEW_PERMISSIONS, EXPENSE_PAYMENT_STATUSES, EXPENSE_STATUSES, type ExpensePaymentStatus, type ExpenseStatus, type ToolResult, type SourceRef } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { PrismaService } from '../../../../common/database/prisma.service';
import { ListDocumentsUseCase } from '../../../accounting-documents/application/use-cases/document.use-case';
import { GetApAgingUseCase } from '../../../procurement/application/use-cases/ap-reporting.use-case';
import { branchScopeWhere } from '../../../data-model-core/domain/logic/branch.logic';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { ListExpensesUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import {
  BUSINESS_READ_BASIS_VERSION,
  CATEGORY_NAME_STRIP_PREFIXES,
  VENDOR_NAME_STRIP_PREFIXES,
  appliedQuery,
  applyNameFilter,
  completeResult,
  fact,
  periodError,
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

// ---- accounting.get_summary ----

@Injectable()
export class AccountingGetSummaryTool implements ErpReadToolPort {
  toolName = 'accounting.get_summary';
  constructor(private readonly listDocuments: ListDocumentsUseCase) {}

  async execute(ctx: ErpToolContext, input: { periodKey?: string; fromDate?: string; toDate?: string; branchId?: string } = {}): Promise<ToolResult> {
    const asOf = now();
    if (!ACCOUNTING_DOCUMENT_VIEW_PERMISSIONS.some((permission) => ctx.permissions.includes(permission))) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const resolved = resolveBusinessReadPeriod(input);
    if (!resolved.ok) return periodError(this.toolName, asOf, resolved);
    const period = resolved.period;
    // PR #238 review T2: ONE permission-scoped groupBy replaces the 50-page OFFSET walk. A single
    // database operation sees one consistent snapshot, so a concurrent insert/move can no longer
    // duplicate one document and omit another while the cardinality still matched — the failure
    // class the old aggregated-vs-total self-check could not actually catch. The database sums the
    // Decimal column; float never touches the money. With the walk gone, the period-size bound and
    // the count-mismatch refusal are structurally unnecessary and are gone with it.
    // R2: the sum crosses this boundary as the repository's exact 2dp STRING — a Number() here
    // would silently lose satang above 2^53/100, and the prepared formatter already renders
    // string | number.
    const aggregate = await this.listDocuments.aggregateByType(toCtx(ctx), {
      fromDate: period.fromDate, toDate: period.toDate, ...(input.branchId ? { branchId: input.branchId } : {}),
    });
    const byType = { ...aggregate.byType };
    const sourceRefs: SourceRef[] = [{
      label: 'สรุปเอกสารบัญชี', module: 'accounting-documents', entityType: 'accounting_document_summary',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/accounting`,
    }];
    const queryApplied = appliedQuery(period, {
      branch: { mode: input.branchId ? 'selected' : 'all_authorized', branchId: input.branchId ?? null },
      dateBasis: 'accounting_document_date', statusBasis: 'all_document_statuses',
      dataset: 'operational_accounting_documents',
    });
    const completeness = completeResult(0, false, Object.keys(byType).length, false);
    const moneyFacts = Object.entries(byType).flatMap(([documentType, entry]) => (entry.totalsByCurrency ?? []).map((total) => fact({
      id: `accounting.documents.${documentType}.${total.currency}`,
      metric: 'accounting_document_total', value: total.totalAmount, unit: 'money', currency: total.currency,
      period: queryApplied.period ?? null, dateBasis: queryApplied.dateBasis, statusBasis: queryApplied.statusBasis,
      sourceRefIds: sourceRefs.map(sourceRefId), asOf, state: total.count === 0 ? 'empty' : 'known',
    })));
    const facts = aggregate.total === 0 ? [fact({
      id: 'accounting.documents.count', metric: 'accounting_document_count', value: '0', unit: 'count', currency: null,
      period: queryApplied.period ?? null, dateBasis: queryApplied.dateBasis, statusBasis: queryApplied.statusBasis,
      sourceRefIds: sourceRefs.map(sourceRefId), asOf, state: 'empty',
    })] : moneyFacts;
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        period: { fromDate: period.fromDate, toDate: period.toDate, defaultedToCurrentMonth: period.defaulted },
        total: aggregate.total,
        byType,
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

// ---- accounting.list_recent_documents ----

@Injectable()
export class AccountingListRecentDocumentsTool implements ErpReadToolPort {
  toolName = 'accounting.list_recent_documents';
  constructor(private readonly listDocuments: ListDocumentsUseCase) {}

  async execute(ctx: ErpToolContext, input: { periodKey?: string; fromDate?: string; toDate?: string; branchId?: string; documentType?: string; limit?: number } = {}): Promise<ToolResult> {
    const asOf = now();
    if (!ACCOUNTING_DOCUMENT_VIEW_PERMISSIONS.some((permission) => ctx.permissions.includes(permission))) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const resolved = resolveBusinessReadPeriod(input);
    if (!resolved.ok) return periodError(this.toolName, asOf, resolved);
    const period = resolved.period;
    if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50)) {
      return { toolName: this.toolName, status: 'error', sourceRefs: [], asOf, errorCode: 'UNSUPPORTED_FILTER', errorMessage: 'limit must be 1-50' };
    }
    const documentType = typeof input?.documentType === 'string' && input.documentType ? input.documentType : undefined;
    const page = await this.listDocuments.execute(toCtx(ctx), {
      fromDate: period.fromDate, toDate: period.toDate,
      ...(documentType && { documentType: documentType as never }),
      ...(input.branchId ? { branchId: input.branchId } : {}),
      page: 1, pageSize: input.limit ?? 20,
    });
    const sourceRefs: SourceRef[] = [{
      label: 'เอกสารบัญชีล่าสุด', module: 'accounting-documents', entityType: 'accounting_document_list',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/accounting`,
    }];
    const queryApplied = appliedQuery(period, {
      branch: { mode: input.branchId ? 'selected' : 'all_authorized', branchId: input.branchId ?? null },
      dateBasis: 'accounting_document_date', statusBasis: 'all_document_statuses',
      dataset: 'operational_accounting_documents',
      filters: { ...(documentType ? { documentType } : {}) },
    });
    const completeness = completeResult(page.data.length, page.page * page.pageSize < page.total);
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        period: { fromDate: period.fromDate, toDate: period.toDate, defaultedToCurrentMonth: period.defaulted },
        total: page.total,
        queryApplied,
        completeness,
        items: page.data.map((doc) => ({
          documentNumber: doc.documentNumber,
          documentType: doc.documentType,
          documentDate: doc.documentDate,
          status: doc.status,
          counterpartyName: (doc.counterpartySnapshotJson as { name?: string } | undefined)?.name ?? null,
          grandTotalAmount: doc.grandTotalAmount,
        })),
      },
      sourceRefs,
      asOf,
      queryApplied,
      basisVersion: BUSINESS_READ_BASIS_VERSION,
      facts: [fact({
        id: 'accounting.documents.count', metric: 'accounting_document_count', value: String(page.total), unit: 'count', currency: null,
        period: queryApplied.period ?? null, dateBasis: queryApplied.dateBasis, statusBasis: queryApplied.statusBasis,
        sourceRefIds: sourceRefs.map(sourceRefId), asOf, state: page.total === 0 ? 'empty' : 'known',
      })],
      completeness,
    };
  }
}

// ---- procurement.get_ap_outstanding ----

@Injectable()
export class ProcurementApOutstandingTool implements ErpReadToolPort {
  toolName = 'procurement.get_ap_outstanding';
  constructor(private readonly apAging: GetApAgingUseCase) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('procurement.ap.report')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const aging = await this.apAging.execute(toCtx(ctx));
    const topSuppliers = [...aging.suppliers]
      .sort((a, b) => new Decimal(b.totalOutstanding).cmp(new Decimal(a.totalOutstanding)) || a.supplierDisplayName.localeCompare(b.supplierDisplayName))
      .slice(0, 5)
      .map((s) => ({ supplier: s.supplierDisplayName, totalOutstanding: s.totalOutstanding }));
    const sourceRefs: SourceRef[] = [{
      label: 'เจ้าหนี้ค้างจ่าย', module: 'procurement', entityType: 'ap_aging',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/procurement`,
    }];
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        asOfDate: aging.asOfDate,
        totalOutstanding: aging.totalOutstanding,
        supplierCount: aging.suppliers.length,
        topSuppliers,
      },
      sourceRefs,
      asOf,
    };
  }
}

// ---- company.get_employee_summary ----

@Injectable()
export class CompanyEmployeeSummaryTool implements ErpReadToolPort {
  toolName = 'company.get_employee_summary';
  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('access.employee.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    // People = company memberships (owner included), not just employee-access
    // profiles — a company with no onboarded employees still has its owner.
    const memberships = await this.prisma.client.companyMembership.findMany({
      where: { companyId: ctx.companyId },
      select: { status: true, roles: { select: { role: { select: { name: true } } } } },
    });
    const byRole: Record<string, number> = {};
    for (const membership of memberships) {
      for (const mr of membership.roles) {
        byRole[mr.role.name] = (byRole[mr.role.name] ?? 0) + 1;
      }
    }
    const sourceRefs: SourceRef[] = [{
      label: 'พนักงาน', module: 'employee-access', entityType: 'employee_summary',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/settings/employees`,
    }];
    // Counts only — no names, phone numbers, or identity fields leave this tool.
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        total: memberships.length,
        active: memberships.filter((m) => m.status === 'ACTIVE').length,
        byRole,
      },
      sourceRefs,
      asOf,
    };
  }
}

// ---- company.get_employee_detail ----

@Injectable()
export class CompanyEmployeeDetailTool implements ErpReadToolPort {
  toolName = 'company.get_employee_detail';
  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: ErpToolContext, input?: { nameQuery?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('access.employee.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const sourceRefs: SourceRef[] = [{
      label: 'ข้อมูลพนักงาน', module: 'employee-access', entityType: 'employee_detail',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/settings/employees`,
    }];
    const nameQuery = typeof input?.nameQuery === 'string' ? input.nameQuery.trim().slice(0, 120) : '';
    if (!nameQuery) {
      return { toolName: this.toolName, status: 'ok', data: { matches: 0, needsName: true }, sourceRefs, asOf };
    }

    const memberships = await this.prisma.client.companyMembership.findMany({
      where: {
        companyId: ctx.companyId,
        OR: [
          { user: { displayName: { contains: nameQuery, mode: 'insensitive' } } },
          { employeeAccessProfile: { displayName: { contains: nameQuery, mode: 'insensitive' } } },
          { employeeAccessProfile: { legalName: { contains: nameQuery, mode: 'insensitive' } } },
        ],
      },
      select: {
        status: true,
        createdAt: true,
        user: { select: { displayName: true, email: true } },
        roles: { select: { role: { select: { name: true } } } },
        // Owner decision 2026-07-05: contact fields for named lookups.
        // Identity fields (identityLast4/hash/encryptedRef) must never leave this tool.
        employeeAccessProfile: { select: { displayName: true, legalName: true, phoneNumber: true } },
      },
      take: 6,
    });

    if (memberships.length === 0) {
      return { toolName: this.toolName, status: 'ok', data: { matches: 0, query: nameQuery }, sourceRefs, asOf };
    }
    if (memberships.length > 1) {
      return {
        toolName: this.toolName,
        status: 'ok',
        data: {
          matches: memberships.length,
          query: nameQuery,
          candidates: memberships.slice(0, 5).map((m) => ({
            name: m.employeeAccessProfile?.displayName ?? m.user.displayName,
            roles: m.roles.map((r) => r.role.name),
            status: m.status,
          })),
        },
        sourceRefs,
        asOf,
      };
    }

    const m = memberships[0];
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        matches: 1,
        employee: {
          name: m.employeeAccessProfile?.displayName ?? m.user.displayName,
          legalName: m.employeeAccessProfile?.legalName ?? null,
          status: m.status,
          roles: m.roles.map((r) => r.role.name),
          phoneNumber: m.employeeAccessProfile?.phoneNumber ?? null,
          email: m.user.email ?? null,
          memberSince: m.createdAt.toISOString().slice(0, 10),
        },
      },
      sourceRefs,
      asOf,
    };
  }
}

// ---- expense.get_breakdown ----

@Injectable()
export class ExpenseGetBreakdownTool implements ErpReadToolPort {
  toolName = 'expense.get_breakdown';
  constructor(private readonly listExpenses: ListExpensesUseCase) {}

  async execute(ctx: ErpToolContext, input: {
    periodKey?: string; fromDate?: string; toDate?: string; branchId?: string;
    categoryId?: string; vendorId?: string; categoryName?: string; vendorName?: string;
    documentStatus?: ExpenseStatus; paymentStatus?: ExpensePaymentStatus;
  } = {}): Promise<ToolResult> {
    let asOf = now();
    const canReadAll = ctx.permissions.includes('expense.read') || ctx.permissions.includes('expense.review');
    const canReadRelated = ctx.permissions.includes('expense.read_related');
    if (!canReadAll && !canReadRelated && !ctx.permissions.includes('expense.read_own')) {
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
    // categoryName/vendorName resolution (spec §3 row 6): same exact-then-contains match as
    // list_recent, applied before the repository read so an ambiguous/unresolved name never
    // silently aggregates over the wrong (or every) category/vendor.
    const requestedCategoryName = typeof input?.categoryName === 'string' && input.categoryName.trim() ? input.categoryName.trim() : undefined;
    const requestedVendorName = typeof input?.vendorName === 'string' && input.vendorName.trim() ? input.vendorName.trim() : undefined;
    const categoryCandidates = requestedCategoryName ? await this.listExpenses.listCategoryCandidates(ctx.companyId) : [];
    const categoryFilter = applyNameFilter(input.categoryId, requestedCategoryName, categoryCandidates, CATEGORY_NAME_STRIP_PREFIXES);
    if (categoryFilter.status === 'conflict') {
      return { toolName: this.toolName, status: 'error', errorCode: 'UNSUPPORTED_FILTER', errorMessage: 'categoryId and categoryName resolve to different categories', sourceRefs: [], asOf };
    }
    if (categoryFilter.status === 'ambiguous') {
      return { toolName: this.toolName, status: 'ok', data: { categoryAmbiguous: requestedCategoryName, availableCategories: categoryFilter.matches }, sourceRefs: [], asOf };
    }
    if (categoryFilter.status === 'not_found') {
      return { toolName: this.toolName, status: 'ok', data: { categoryUnresolved: requestedCategoryName, availableCategories: categoryFilter.available }, sourceRefs: [], asOf };
    }
    const vendorCandidates = requestedVendorName ? await this.listExpenses.readAiVendorCandidates(toCtx(ctx), input.branchId) : [];
    const vendorFilter = applyNameFilter(input.vendorId, requestedVendorName, vendorCandidates, VENDOR_NAME_STRIP_PREFIXES);
    if (vendorFilter.status === 'conflict') {
      return { toolName: this.toolName, status: 'error', errorCode: 'UNSUPPORTED_FILTER', errorMessage: 'vendorId and vendorName resolve to different vendors', sourceRefs: [], asOf };
    }
    if (vendorFilter.status === 'ambiguous') {
      return { toolName: this.toolName, status: 'ok', data: { vendorAmbiguous: requestedVendorName, availableVendors: vendorFilter.matches }, sourceRefs: [], asOf };
    }
    if (vendorFilter.status === 'not_found') {
      return { toolName: this.toolName, status: 'ok', data: { vendorUnresolved: requestedVendorName, availableVendors: vendorFilter.available }, sourceRefs: [], asOf };
    }
    const categoryId = categoryFilter.id;
    const vendorId = vendorFilter.id;
    const snapshot = await this.listExpenses.readAiBreakdown(toCtx(ctx), {
      fromDate: period.fromDate, toDate: period.toDate,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(categoryId ? { expenseCategoryId: categoryId } : {}),
      ...(vendorId ? { vendorCounterpartyId: vendorId } : {}),
      ...(input.documentStatus ? { status: input.documentStatus } : {}),
      ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
    });
    asOf = snapshot.asOf.toISOString();
    // Item 1 (spec R-A1 row 18): `readAiBreakdown` now echoes the scope it already applied; an
    // older test double or caller that predates this field simply reads as company-wide, unchanged.
    const accessScope = (snapshot as { accessScope?: 'own' | 'related' | 'company' }).accessScope ?? 'company';
    const totalCount = snapshot.byCurrency.reduce((sum, row) => sum + row.count, 0);
    const soleCurrency = snapshot.byCurrency.length === 1 ? snapshot.byCurrency[0] : undefined;

    const sourceRefs: SourceRef[] = [{
      label: 'สรุปค่าใช้จ่ายแยกกลุ่ม', module: 'expenses', entityType: 'expense_breakdown',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/expenses`,
    }];
    const queryApplied = appliedQuery(period, {
      branch: { mode: input.branchId ? 'selected' : 'all_authorized', branchId: input.branchId ?? null },
      dateBasis: 'expense_incurred_date', statusBasis: input.documentStatus ?? 'exclude_rejected_voided',
      dataset: 'operational_expense_records',
      accessScope,
      filters: {
        ...(categoryId ? { categoryId } : {}),
        ...(categoryFilter.name ? { categoryName: categoryFilter.name } : {}),
        ...(vendorId ? { vendorId } : {}),
        ...(vendorFilter.name ? { vendorName: vendorFilter.name } : {}),
        ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
      },
    });
    const completeness = completeResult(
      0, false,
      snapshot.byCategory.length + snapshot.byBranch.length + snapshot.byVendor.length,
      snapshot.categoryHasMore || snapshot.branchHasMore || snapshot.vendorHasMore,
    );
    const facts = snapshot.byCurrency.map((row) => fact({
      id: `expense.breakdown.total.${row.currency}`, metric: 'expense_total', value: row.totalAmount,
      unit: 'money', currency: row.currency, period: queryApplied.period ?? null,
      dateBasis: queryApplied.dateBasis, statusBasis: queryApplied.statusBasis,
      sourceRefIds: sourceRefs.map(sourceRefId), asOf, state: row.count === 0 ? 'empty' : 'known',
    }));
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        period: { fromDate: period.fromDate, toDate: period.toDate, defaultedToCurrentMonth: period.defaulted },
        totalCount,
        totalAmount: soleCurrency?.totalAmount ?? null,
        currency: soleCurrency?.currency ?? null,
        totalsByCurrency: snapshot.byCurrency,
        mixedCurrency: snapshot.byCurrency.length > 1,
        byCategory: snapshot.byCategory.map((group) => ({
          categoryId: group.expenseCategoryId,
          category: group.label ?? (group.expenseCategoryId ?? 'ไม่ระบุหมวด'),
          currency: group.currency, count: group.count, totalAmount: group.totalAmount,
        })),
        byBranch: snapshot.byBranch.map((group) => ({
          branchId: group.branchId,
          branch: group.label ?? (group.branchId ?? 'ส่วนกลาง (ไม่ระบุสาขา)'),
          currency: group.currency, count: group.count, totalAmount: group.totalAmount,
        })),
        byVendor: snapshot.byVendor.map((group) => ({
          vendorId: group.vendorCounterpartyId,
          vendor: group.label ?? (group.vendorCounterpartyId ?? 'ไม่ระบุร้าน'),
          linked: group.linked,
          currency: group.currency, count: group.count, totalAmount: group.totalAmount,
        })),
        vendorHasMore: snapshot.vendorHasMore,
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
