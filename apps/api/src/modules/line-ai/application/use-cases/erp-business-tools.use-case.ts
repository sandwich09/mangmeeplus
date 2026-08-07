/**
 * Business read tools for LINE AI: accounting documents, AP outstanding, employee summary,
 * and expense breakdown. Read-only; each adapter re-checks permissions server-side and
 * returns bounded ToolResult data (no PII, no raw rows).
 * Period-scoped tools default to the current month (owner decision 2026-07-03).
 */
import { Injectable } from '@nestjs/common';
import type { ToolResult, SourceRef } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { PrismaService } from '../../../../common/database/prisma.service';
import { ListDocumentsUseCase } from '../../../accounting-documents/application/use-cases/document.use-case';
import { GetApAgingUseCase } from '../../../procurement/application/use-cases/ap-reporting.use-case';
import { branchScopeWhere } from '../../../data-model-core/domain/logic/branch.logic';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { resolvePeriodInput } from './erp-tools.use-case';
import { civilDayRangeToUtc } from '@watchdog-bms/contracts';

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

function money(value: unknown): number {
  const amount = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

// ---- accounting.get_summary ----

@Injectable()
export class AccountingGetSummaryTool implements ErpReadToolPort {
  toolName = 'accounting.get_summary';
  constructor(private readonly listDocuments: ListDocumentsUseCase) {}

  async execute(ctx: ErpToolContext, input?: { fromDate?: string; toDate?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('accounting.document.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const period = resolvePeriodInput(input);
    const page = await this.listDocuments.execute(toCtx(ctx), {
      fromDate: period.fromDate, toDate: period.toDate, page: 1, pageSize: 200,
    });
    const byType: Record<string, { count: number; totalAmount: number }> = {};
    for (const doc of page.data) {
      const key = String(doc.documentType);
      byType[key] = byType[key] ?? { count: 0, totalAmount: 0 };
      byType[key].count += 1;
      byType[key].totalAmount += money(doc.grandTotalAmount);
    }
    const sourceRefs: SourceRef[] = [{
      label: 'สรุปเอกสารบัญชี', module: 'accounting-documents', entityType: 'accounting_document_summary',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/accounting`,
    }];
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        period: { fromDate: period.fromDate, toDate: period.toDate, defaultedToCurrentMonth: period.defaulted },
        total: page.total,
        byType,
      },
      sourceRefs,
      asOf,
    };
  }
}

// ---- accounting.list_recent_documents ----

@Injectable()
export class AccountingListRecentDocumentsTool implements ErpReadToolPort {
  toolName = 'accounting.list_recent_documents';
  constructor(private readonly listDocuments: ListDocumentsUseCase) {}

  async execute(ctx: ErpToolContext, input?: { fromDate?: string; toDate?: string; documentType?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('accounting.document.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const period = resolvePeriodInput(input);
    const documentType = typeof input?.documentType === 'string' && input.documentType ? input.documentType : undefined;
    const page = await this.listDocuments.execute(toCtx(ctx), {
      fromDate: period.fromDate, toDate: period.toDate,
      ...(documentType && { documentType: documentType as never }),
      page: 1, pageSize: 10,
    });
    const sourceRefs: SourceRef[] = [{
      label: 'เอกสารบัญชีล่าสุด', module: 'accounting-documents', entityType: 'accounting_document_list',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/accounting`,
    }];
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        period: { fromDate: period.fromDate, toDate: period.toDate, defaultedToCurrentMonth: period.defaulted },
        total: page.total,
        items: page.data.slice(0, 10).map((doc) => ({
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
      .sort((a, b) => money(b.totalOutstanding) - money(a.totalOutstanding))
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
  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: ErpToolContext, input?: { fromDate?: string; toDate?: string }): Promise<ToolResult> {
    const asOf = now();
    const canReadAll = ctx.permissions.includes('expense.read') || ctx.permissions.includes('expense.review');
    if (!canReadAll && !ctx.permissions.includes('expense.read_own')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const period = resolvePeriodInput(input);
    const where = {
      companyId: ctx.companyId,
      status: { notIn: ['REJECTED', 'VOIDED'] as never[] },
      expenseDate: civilDayRangeToUtc(period.fromDate, period.toDate),
      // Branch ABAC (10D): restricted scopes see their branches plus company-central rows.
      ...branchScopeWhere({ branchIds: ctx.branchIds }),
      // read_own limitation mirrors ListExpensesUseCase
      ...(!canReadAll && { createdByUserId: ctx.userId }),
    };

    const [byCategory, byBranch] = await Promise.all([
      this.prisma.client.expenseRecord.groupBy({ by: ['expenseCategoryId'], where, _sum: { grandTotalAmount: true }, _count: true }),
      this.prisma.client.expenseRecord.groupBy({ by: ['branchId'], where, _sum: { grandTotalAmount: true }, _count: true }),
    ]);

    const categoryIds = byCategory.map((g) => g.expenseCategoryId).filter((id): id is string => !!id);
    const branchIds = byBranch.map((g) => g.branchId).filter((id): id is string => !!id);
    const [categories, branches] = await Promise.all([
      categoryIds.length ? this.prisma.client.expenseCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }) : [],
      branchIds.length ? this.prisma.client.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }) : [],
    ]);
    const categoryName = new Map(categories.map((c) => [c.id, c.name]));
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    const totalCount = byCategory.reduce((total, group) => total + group._count, 0);
    const totalAmount = byCategory.reduce((total, group) => total + money(group._sum.grandTotalAmount), 0);

    const sourceRefs: SourceRef[] = [{
      label: 'สรุปค่าใช้จ่ายแยกกลุ่ม', module: 'expenses', entityType: 'expense_breakdown',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/expenses`,
    }];
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        period: { fromDate: period.fromDate, toDate: period.toDate, defaultedToCurrentMonth: period.defaulted },
        totalCount,
        totalAmount: totalAmount.toFixed(4),
        byCategory: byCategory
          .map((g) => ({
            category: g.expenseCategoryId ? (categoryName.get(g.expenseCategoryId) ?? g.expenseCategoryId) : 'ไม่ระบุหมวด',
            count: g._count,
            totalAmount: String(g._sum.grandTotalAmount ?? '0'),
          }))
          .sort((a, b) => money(b.totalAmount) - money(a.totalAmount))
          .slice(0, 15),
        byBranch: byBranch
          .map((g) => ({
            branch: g.branchId ? (branchName.get(g.branchId) ?? g.branchId) : 'ส่วนกลาง (ไม่ระบุสาขา)',
            count: g._count,
            totalAmount: String(g._sum.grandTotalAmount ?? '0'),
          }))
          .sort((a, b) => money(b.totalAmount) - money(a.totalAmount))
          .slice(0, 15),
      },
      sourceRefs,
      asOf,
    };
  }
}
