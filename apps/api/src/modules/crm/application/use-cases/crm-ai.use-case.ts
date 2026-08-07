import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import type {
  RequestContext,
  CrmAiFollowUpPriorities,
  CrmAiCustomerSummary,
  CrmAiOpportunitySummary,
  CrmAiPipelineSummary,
  CrmDashboardSummary,
  CrmSourceRef,
} from '@watchdog-bms/contracts';
import { PrismaCrmRepository } from '../../infrastructure/prisma-crm.repository';
import { toFollowUpSummary, toCustomerSummary, toActivitySummary, toOpportunitySummary, toStageSummary } from '../dto/crm.mapper';
import { requirePermission, assertCanReadOwned, ownerScopeForList } from '../crm-access';
import { scoreFollowUpPriority, effectiveFollowUpStatus, sumAmounts } from '../../domain/logic/crm.logic';
import { CRM_STUCK_OPPORTUNITY_DAYS } from '../../domain/crm.constants';
import { customerProjectionForRow } from './crm-customer.use-case';

function deepLink(companyId: string, type: string, id: string): CrmSourceRef {
  const path =
    type === 'customer' ? `/companies/${companyId}/crm/customers/${id}`
    : type === 'opportunity' ? `/companies/${companyId}/crm/opportunities/${id}`
    : type === 'follow_up' ? `/companies/${companyId}/crm/follow-ups`
    : `/companies/${companyId}/crm`;
  return { type, id, deepLink: path };
}

function daysBetween(from: Date | undefined, now: Date): number | undefined {
  if (!from) return undefined;
  return Math.floor((now.getTime() - from.getTime()) / 86_400_000);
}

@Injectable()
export class GetCrmFollowUpPrioritiesUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, scope?: 'own' | 'all'): Promise<CrmAiFollowUpPriorities> {
    requirePermission(ctx, 'crm.ai.read');
    const ownerUserId = ownerScopeForList(ctx, scope);
    const now = new Date();
    const rows = await this.repo.listFollowUps({ companyId: ctx.companyId, ownerUserId, status: 'OPEN' });
    // Also include snoozed that are now due.
    const items = rows
      .map((f) => {
        const eff = effectiveFollowUpStatus(f.status, f.dueAt, now);
        const score = scoreFollowUpPriority({ priority: f.priority, dueAt: f.dueAt, now });
        return {
          followUp: toFollowUpSummary({ ...f, status: eff }),
          score,
          reason: eff === 'OVERDUE' ? 'Overdue task' : `${f.priority} priority, due ${f.dueAt.toISOString().slice(0, 10)}`,
          source: deepLink(ctx.companyId, 'follow_up', f.id),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);
    return { items, generatedAt: now.toISOString() };
  }
}

@Injectable()
export class GetCrmCustomerAiSummaryUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, customerId: string): Promise<CrmAiCustomerSummary> {
    requirePermission(ctx, 'crm.ai.read');
    const c = await this.repo.findCustomerById(ctx.companyId, customerId);
    if (!c) throw new NotFoundException('Customer not found');
    if (customerProjectionForRow(ctx, c.ownerUserId, c.branchId) !== 'OPERATIONAL') {
      throw new ForbiddenException('customer_ai_summary_not_permitted_for_projection');
    }
    const [work, activities] = await Promise.all([
      this.repo.countOpenWorkForCustomer(ctx.companyId, customerId),
      this.repo.listActivities({ companyId: ctx.companyId, customerId }),
    ]);
    return {
      customer: toCustomerSummary(c),
      openOpportunities: work.openOpportunities,
      openFollowUps: work.openFollowUps,
      recentActivities: activities.slice(0, 5).map(toActivitySummary),
      source: deepLink(ctx.companyId, 'customer', customerId),
    };
  }
}

@Injectable()
export class GetCrmOpportunityAiSummaryUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, opportunityId: string): Promise<CrmAiOpportunitySummary> {
    requirePermission(ctx, 'crm.ai.read');
    const o = await this.repo.findOpportunityById(ctx.companyId, opportunityId, true);
    if (!o) throw new NotFoundException('Opportunity not found');
    assertCanReadOwned(ctx, o.ownerUserId);
    const now = new Date();
    // Accounting-derived quote status is only exposed to callers with accounting read permission.
    const canReadAccounting = ctx.permissions.includes('accounting.document.read') || ctx.permissions.includes('accounting.quotation.read');
    return {
      opportunity: toOpportunitySummary(o),
      quotationStatus: canReadAccounting ? (o.quotationLinks ?? [])[0]?.status : undefined,
      daysSinceLastActivity: daysBetween(o.lastActivityAt, now),
      source: deepLink(ctx.companyId, 'opportunity', opportunityId),
    };
  }
}

@Injectable()
export class GetCrmPipelineAiSummaryUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, scope?: 'own' | 'all'): Promise<CrmAiPipelineSummary> {
    requirePermission(ctx, 'crm.ai.read');
    const ownerUserId = ownerScopeForList(ctx, scope);
    const now = new Date();
    const stuckBefore = new Date(now.getTime() - CRM_STUCK_OPPORTUNITY_DAYS * 86_400_000);
    const [stages, opps] = await Promise.all([
      this.repo.ensureDefaultStages(ctx.companyId, ctx.userId),
      this.repo.listOpportunities({ companyId: ctx.companyId, ownerUserId, status: 'OPEN' }),
    ]);
    const stageStats = stages
      .filter((s) => s.isActive)
      .map((stage) => {
        const inStage = opps.filter((o) => o.stageId === stage.id);
        return { stage: toStageSummary(stage), count: inStage.length, totalAmount: sumAmounts(inStage.map((o) => o.amountEstimate)) };
      });
    const stuck = opps.filter((o) => !o.lastActivityAt || o.lastActivityAt.getTime() < stuckBefore.getTime()).length;
    return {
      stages: stageStats,
      openCount: opps.length,
      totalPipelineAmount: sumAmounts(opps.map((o) => o.amountEstimate)),
      stuckOpportunities: stuck,
      generatedAt: now.toISOString(),
    };
  }
}

@Injectable()
export class GetCrmDashboardSummaryUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, scope?: 'own' | 'all'): Promise<CrmDashboardSummary> {
    requirePermission(ctx, 'crm.report.read');
    const ownerUserId = ownerScopeForList(ctx, scope);
    const now = new Date();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const stuckBefore = new Date(now.getTime() - CRM_STUCK_OPPORTUNITY_DAYS * 86_400_000);
    const [opps, dueToday, overdue, unassigned] = await Promise.all([
      this.repo.listOpportunities({ companyId: ctx.companyId, ownerUserId, status: 'OPEN' }),
      this.repo.countFollowUps(ctx.companyId, ownerUserId, { dueBefore: endOfDay, dueAfter: new Date(now.getFullYear(), now.getMonth(), now.getDate()) }, ['OPEN', 'SNOOZED']),
      this.repo.countFollowUps(ctx.companyId, ownerUserId, { dueBefore: now }, ['OPEN', 'OVERDUE', 'SNOOZED']),
      this.repo.countUnassignedLeads(ctx.companyId),
    ]);
    const stuck = opps.filter((o) => !o.lastActivityAt || o.lastActivityAt.getTime() < stuckBefore.getTime()).length;
    return {
      pipelineOpenCount: opps.length,
      pipelineTotalAmount: sumAmounts(opps.map((o) => o.amountEstimate)),
      followUpsDueToday: dueToday,
      followUpsOverdue: overdue,
      unassignedLeads: unassigned,
      stuckOpportunities: stuck,
    };
  }
}
