import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CrmReportsSummary, DashboardPeriodKind, RequestContext } from '@watchdog-bms/contracts';
import { SumReceivedPaymentsByCounterpartyUseCase } from '../../../accounting-documents/application/use-cases/sum-received-payments-by-counterparty.use-case';
import { bangkokPeriodBounds } from '../../domain/logic/crm-daily-brief.logic';
import { buildCrmReportsSummary } from '../../domain/logic/crm-reports.logic';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { customerAccessProfile } from '../../../crm/application/use-cases/crm-customer.use-case';

function requirePermission(ctx: RequestContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
}

@Injectable()
export class GetCrmReportsSummaryUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly sumReceivedPayments: SumReceivedPaymentsByCounterpartyUseCase,
  ) {}

  async execute(ctx: RequestContext, input: { branchId?: string; period?: DashboardPeriodKind } = {}): Promise<CrmReportsSummary> {
    requirePermission(ctx, 'crm.report.read');
    const branchId = this.resolveBranchId(ctx, input.branchId);
    const access = customerAccessProfile(ctx);
    const ownerUserId = !access.operationalAll && access.operationalOwned ? ctx.userId : undefined;
    const detailedProjection = access.operationalAll || Boolean(ownerUserId);
    const customerIds = await this.resolveScopedCustomerIds(ctx.companyId, branchId, ctx.scopes.branchIds, ownerUserId);

    // Chat metrics (status/response/staff/overdue) are scoped to the selected period by
    // conversation creation time; LTV (top customers) and retention are lifetime-cumulative.
    const now = new Date();
    const { dayStart, dayEnd } = bangkokPeriodBounds(input.period ?? 'today', now);
    const range = { start: dayStart, end: dayEnd };

    const [statusCounts, overdue, respondedDurationsMin, staff, customers] = await Promise.all([
      this.repo.reportsStatusCounts(ctx.companyId, customerIds, range),
      this.repo.reportsOverdueCount(ctx.companyId, customerIds, now, range),
      this.repo.reportsRespondedDurationsMin(ctx.companyId, customerIds, range),
      this.repo.reportsStaff(ctx.companyId, customerIds, range),
      this.scopedCustomersWithCounterparty(ctx.companyId, branchId, ctx.scopes.branchIds, ownerUserId),
    ]);

    const displayNames = await this.repo.userDisplayNames(staff.map((row) => row.userId).filter((id): id is string => !!id));
    const counterpartyIds = [...new Set(customers.map((customer) => customer.accountingCounterpartyId))];
    const paymentAggregates = await this.sumReceivedPayments.execute(ctx, counterpartyIds);
    const paymentsByCounterparty = new Map(paymentAggregates.map((aggregate) => [aggregate.counterpartyId, aggregate]));

    const summary = buildCrmReportsSummary({
      statusCounts,
      overdue,
      respondedDurationsMin,
      staff: staff.map((row) => ({
        ...row,
        ...(row.userId && displayNames.get(row.userId) ? { displayName: displayNames.get(row.userId) } : {}),
      })),
      customers: customers.map((customer) => {
        // ponytail: counterparty links are not unique, so shared links duplicate attribution until the schema can enforce ownership.
        const payments = paymentsByCounterparty.get(customer.accountingCounterpartyId);
        return {
          customerId: customer.id,
          displayName: customer.displayName,
          lifetimeValueAmount: payments?.amount ?? '0',
          paymentCount: payments?.paymentCount ?? 0,
          latestPaidAt: payments?.latestPaidAt ?? null,
        };
      }),
      branchId: branchId ?? null,
    }, now);
    if (detailedProjection) return summary;
    return {
      ...summary,
      staffPerformance: [],
      topCustomers: [],
      ...(summary.retention ? { retention: { ...summary.retention, atRiskName: null } } : {}),
    };
  }

  private resolveBranchId(ctx: RequestContext, branchId?: string): string | undefined {
    const normalized = branchId?.trim();
    if (!normalized) return undefined;
    if (ctx.scopes.branchIds && !ctx.scopes.branchIds.includes(normalized)) throw new ForbiddenException('Branch is out of scope');
    return normalized;
  }

  private async resolveScopedCustomerIds(
    companyId: string,
    branchId: string | undefined,
    allowedBranchIds: string[] | undefined,
    ownerUserId?: string,
  ): Promise<string[] | undefined> {
    if (branchId) return this.repo.reportsBranchCustomerIds(companyId, branchId, ownerUserId);
    if (allowedBranchIds) {
      return this.uniqueIds((await Promise.all(allowedBranchIds.map((id) => this.repo.reportsBranchCustomerIds(companyId, id, ownerUserId)))).flat());
    }
    return ownerUserId ? this.repo.reportsBranchCustomerIds(companyId, undefined, ownerUserId) : undefined;
  }

  private async scopedCustomersWithCounterparty(
    companyId: string,
    branchId: string | undefined,
    allowedBranchIds: string[] | undefined,
    ownerUserId?: string,
  ) {
    if (branchId || !allowedBranchIds) return this.repo.reportsCustomersWithCounterparty(companyId, branchId, ownerUserId);
    const rows = (await Promise.all(allowedBranchIds.map((id) => this.repo.reportsCustomersWithCounterparty(companyId, id, ownerUserId)))).flat();
    const byId = new Map<string, (typeof rows)[number]>();
    for (const row of rows) byId.set(row.id, row);
    return [...byId.values()];
  }

  private uniqueIds(ids: string[]): string[] {
    return [...new Set(ids)];
  }
}
