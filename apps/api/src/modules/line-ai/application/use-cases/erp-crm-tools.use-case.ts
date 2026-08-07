import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CrmCustomerStatus, RequestContext, SourceRef, ToolResult } from '@watchdog-bms/contracts';
import { GetCrmCustomerSummaryUseCase, ListCrmCustomersUseCase } from '../../../crm/application/use-cases/crm-customer.use-case';
import { GetCrmCustomer360SummaryUseCase } from '../../../crm-inbox/application/use-cases/crm-customer-360.use-case';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { currentMonthRange } from './erp-tools.use-case';

function now(): string { return new Date().toISOString(); }

function toCtx(ctx: ErpToolContext): RequestContext {
  return {
    requestId: ctx.requestId ?? '',
    authSubject: ctx.userId,
    userId: ctx.userId,
    companyId: ctx.companyId,
    membershipId: ctx.membershipId ?? '',
    roles: ctx.roles ?? [],
    permissions: ctx.permissions,
    scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds },
    authProvider: 'watchdog',
  };
}

function source(ctx: ErpToolContext, asOf: string, entityType: string, entityId?: string): SourceRef {
  return {
    label: entityId ? 'ข้อมูลลูกค้า' : 'ลูกค้า',
    module: 'crm',
    entityType,
    ...(entityId && { entityId }),
    asOf,
    permissionChecked: true,
    webPath: entityId
      ? `/companies/${ctx.companyId}/crm/customers/${entityId}`
      : `/companies/${ctx.companyId}/customers`,
  };
}

@Injectable()
export class CrmGetCustomerSummaryTool implements ErpReadToolPort {
  toolName = 'crm.get_customer_summary';
  constructor(private readonly getSummary: GetCrmCustomerSummaryUseCase) {}

  async execute(ctx: ErpToolContext, input?: { newSince?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('crm.customer.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const candidate = typeof input?.newSince === 'string' ? input.newSince : '';
    const newSince = /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : currentMonthRange().fromDate;
    const summary = await this.getSummary.execute(toCtx(ctx), new Date(`${newSince}T00:00:00+07:00`));
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        ...summary,
        newCustomersSince: newSince,
        totalIncludesArchived: true,
        totalExcludesMerged: true,
      },
      sourceRefs: [source(ctx, asOf, 'customer_summary')],
      asOf,
    };
  }
}

type CustomerSearchInput = {
  search?: string;
  status?: CrmCustomerStatus;
  assignedToMe?: boolean;
  page?: number;
  limit?: number;
};

@Injectable()
export class CrmSearchCustomersTool implements ErpReadToolPort<CustomerSearchInput> {
  toolName = 'crm.search_customers';
  constructor(private readonly listCustomers: ListCrmCustomersUseCase) {}

  async execute(ctx: ErpToolContext, input: CustomerSearchInput = {}): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('crm.customer.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const search = typeof input.search === 'string' ? input.search.trim().slice(0, 160) : undefined;
    const page = Number.isSafeInteger(input.page) && Number(input.page) > 0 ? Number(input.page) : 1;
    const pageSize = Number.isSafeInteger(input.limit) ? Math.min(Math.max(Number(input.limit), 1), 10) : 10;
    const result = await this.listCustomers.execute(toCtx(ctx), {
      ...(search && { search }),
      ...(input.status && { status: input.status }),
      ...(input.assignedToMe === true && { scope: 'own' as const }),
      page,
      pageSize,
    });
    const items = result.items.map((item) => item.projection === 'MARKETING'
      ? { projection: item.projection, customerRef: item.customer.customerRef, status: item.customer.status, tier: item.customer.tier }
      : {
          projection: item.projection,
          id: item.customer.id,
          displayName: item.customer.displayName,
          status: item.customer.status,
          branchId: item.customer.branchId ?? null,
          ...('tier' in item.customer && { tier: item.customer.tier }),
          ...('lastActivityAt' in item.customer && { lastActivityAt: item.customer.lastActivityAt ?? null }),
        });
    return {
      toolName: this.toolName,
      status: 'ok',
      data: { query: search ?? null, total: result.total, page: result.page, pageSize: result.pageSize, items },
      sourceRefs: [source(ctx, asOf, 'customer_search')],
      asOf,
    };
  }
}

@Injectable()
export class CrmGetCustomer360Tool implements ErpReadToolPort<{ customerId?: string }> {
  toolName = 'crm.get_customer_360';
  constructor(private readonly get360: GetCrmCustomer360SummaryUseCase) {}

  async execute(ctx: ErpToolContext, input: { customerId?: string } = {}): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('crm.customer.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const customerId = typeof input.customerId === 'string' ? input.customerId.trim().slice(0, 200) : '';
    if (!customerId) {
      return {
        toolName: this.toolName,
        status: 'ok',
        data: { needsCustomerId: true },
        sourceRefs: [source(ctx, asOf, 'customer_360')],
        asOf,
      };
    }
    let summary;
    try {
      summary = await this.get360.execute(toCtx(ctx), customerId);
    } catch (error) {
      if (error instanceof ForbiddenException) {
        return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf, errorCode: 'CUSTOMER_SCOPE_DENIED' };
      }
      if (error instanceof NotFoundException) {
        return { toolName: this.toolName, status: 'ok', data: { found: false }, sourceRefs: [source(ctx, asOf, 'customer_360')], asOf, errorCode: 'CUSTOMER_NOT_FOUND' };
      }
      throw error;
    }
    const customer = summary.customer;
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        customer: {
          id: customer.id,
          code: customer.code ?? null,
          displayName: customer.displayName,
          legalName: customer.legalName ?? null,
          customerType: customer.customerType,
          status: customer.status,
          tier: customer.tier,
          branchId: customer.branchId ?? null,
          ownerUserId: customer.ownerUserId ?? null,
          primaryPhone: customer.primaryPhone ?? null,
          primaryEmail: customer.primaryEmail ?? null,
          consentStatus: customer.consentStatus,
          lifetimeValueAmount: customer.lifetimeValueAmount ?? null,
          lastActivityAt: customer.lastActivityAt ?? null,
          nextFollowUpAt: customer.nextFollowUpAt ?? null,
          contacts: customer.contacts.slice(0, 5).map((contact) => ({
            name: contact.name,
            role: contact.role ?? null,
            phone: contact.phone ?? null,
            email: contact.email ?? null,
            preferredChannel: contact.preferredChannel ?? null,
          })),
        },
        conversations: summary.conversations,
        deals: summary.deals ? {
          openCount: summary.deals.openCount,
          openAmountTotal: summary.deals.openAmountTotal,
          latest: summary.deals.latest ? {
            id: summary.deals.latest.id,
            title: summary.deals.latest.title,
            status: summary.deals.latest.status,
            amountEstimate: summary.deals.latest.amountEstimate,
            currency: summary.deals.latest.currency,
            expectedCloseDate: summary.deals.latest.expectedCloseDate ?? null,
          } : null,
        } : null,
        tasks: summary.tasks ? {
          openCount: summary.tasks.openCount,
          next: summary.tasks.next ? {
            id: summary.tasks.next.id,
            title: summary.tasks.next.title,
            dueAt: summary.tasks.next.dueAt,
            priority: summary.tasks.next.priority,
            channel: summary.tasks.next.channel,
          } : null,
        } : null,
        quotations: summary.quotations?.slice(0, 5).map((quotation) => ({
          id: quotation.id,
          documentNumber: quotation.accountingDocumentNumber ?? null,
          status: quotation.status,
          grandTotalAmount: quotation.grandTotalAmount ?? null,
          currency: quotation.currency,
        })) ?? null,
        finance: summary.finance ? { documents: summary.finance.documents.slice(0, 5) } : null,
        redactedSources: summary.redactedSources,
      },
      sourceRefs: [source(ctx, asOf, 'customer_360', customerId)],
      asOf,
    };
  }
}
