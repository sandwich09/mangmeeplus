import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  RequestContext,
  CreateCrmOpportunityInput,
  UpdateCrmOpportunityInput,
  MoveCrmOpportunityStageInput,
  CloseCrmOpportunityInput,
  ReopenCrmOpportunityInput,
  ListCrmOpportunitiesFilter,
  UpdateCrmPipelineStagesInput,
  CreateCrmActivityInput,
  ListCrmActivitiesFilter,
  CrmOpportunitySummary,
  CrmOpportunityDetail,
  CrmPipelineBoard,
  CrmPipelineStageSummary,
  CrmActivitySummary,
} from '@watchdog-bms/contracts';
import { PrismaCrmRepository } from '../../infrastructure/prisma-crm.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { toOpportunitySummary, toOpportunityDetail, toStageSummary, toActivitySummary } from '../dto/crm.mapper';
import { requirePermission, assertCanReadOwned, assertCanManageOwned, ownerScopeForList } from '../crm-access';
import {
  d, decStr, sumAmounts,
  canMoveStage, validateClose, canReopen,
  validatePipelineStages, isTerminalGroup, crmCanReadAll, crmCanManageAll,
} from '../../domain/logic/crm.logic';
import { CRM_DEFAULT_CURRENCY } from '../../domain/crm.constants';
import { validateCustomerReferences } from './crm-customer.use-case';

function paginate<T>(rows: T[], page?: number, pageSize?: number) {
  const p = page && page > 0 ? page : 1;
  const size = pageSize && pageSize > 0 ? Math.min(pageSize, 100) : 20;
  const start = (p - 1) * size;
  return { items: rows.slice(start, start + size), total: rows.length, page: p, pageSize: size };
}

function oppOutbox(ctx: RequestContext, id: string, data: Record<string, unknown>) {
  return { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'crm_opportunity', aggregateId: id, occurredAt: new Date().toISOString(), data };
}

// ---- Pipeline stages ----

@Injectable()
export class ListCrmPipelineStagesUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext): Promise<CrmPipelineStageSummary[]> {
    requirePermission(ctx, 'crm.opportunity.read');
    const stages = await this.repo.ensureDefaultStages(ctx.companyId, ctx.userId);
    return stages.map(toStageSummary);
  }
}

@Injectable()
export class UpdateCrmPipelineStagesUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, input: UpdateCrmPipelineStagesInput): Promise<CrmPipelineStageSummary[]> {
    requirePermission(ctx, 'crm.pipeline.configure');
    const errors = validatePipelineStages(input.stages);
    if (errors.length > 0) throw new UnprocessableEntityException({ code: 'invalid_pipeline', errors });
    const stages = await this.repo.replaceStages(
      ctx.companyId,
      ctx.userId,
      input.stages.map((s) => ({
        id: s.id,
        name: s.name,
        canonicalGroup: s.canonicalGroup,
        sortOrder: s.sortOrder,
        probabilityDefault: s.probabilityDefault,
        isActive: s.isActive,
        isTerminalWon: s.canonicalGroup === 'WON',
        isTerminalLost: s.canonicalGroup === 'LOST',
      })),
    );
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.pipeline.configure', targetType: 'crm_pipeline', targetId: ctx.companyId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { stageCount: stages.length } });
    void this.outbox.append('crm.pipeline.stage_configured', 'crm_pipeline', ctx.companyId, oppOutbox(ctx, ctx.companyId, { stageCount: stages.length }));
    return stages.map(toStageSummary);
  }
}

// ---- Opportunities ----

@Injectable()
export class CreateCrmOpportunityUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, input: CreateCrmOpportunityInput): Promise<CrmOpportunitySummary> {
    requirePermission(ctx, 'crm.opportunity.create');
    if (!input.title || input.title.trim() === '') throw new BadRequestException('title_required');
    const customer = await this.repo.findCustomerById(ctx.companyId, input.customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.status === 'ARCHIVED' || customer.status === 'MERGED') throw new UnprocessableEntityException('Customer is not active');
    assertCanManageOwned(ctx, customer.ownerUserId);
    await validateCustomerReferences(this.repo, ctx.companyId, { branchId: input.branchId }, ctx.scopes);
    if (input.leadId) {
      const lead = await this.repo.findLeadById(ctx.companyId, input.leadId);
      if (!lead) throw new NotFoundException('Lead not found');
      assertCanManageOwned(ctx, lead.assignedToUserId);
      if (!lead.convertedCustomerId) throw new UnprocessableEntityException('lead_not_converted');
      if (lead.convertedCustomerId !== input.customerId) throw new ConflictException({ code: 'child_target_mismatch' });
    }
    const ownerUserId = input.ownerUserId ?? ctx.userId;
    let reassignedOwnerUserId: string | undefined;
    if (ownerUserId !== ctx.userId) {
      requirePermission(ctx, 'crm.customer.assign');
      if (!(await this.repo.hasActiveCompanyMember(ctx.companyId, ownerUserId))) throw new BadRequestException('owner_not_active_company_member');
      reassignedOwnerUserId = ownerUserId;
    }

    const stages = await this.repo.ensureDefaultStages(ctx.companyId, ctx.userId);
    const stage = input.stageId ? stages.find((s) => s.id === input.stageId) : stages.find((s) => s.isActive) ?? stages[0];
    if (!stage) throw new UnprocessableEntityException('No pipeline stage available');

    let created;
    try {
      created = await this.repo.createOpportunity({
        companyId: ctx.companyId,
        branchId: input.branchId,
        customerId: input.customerId,
        leadId: input.leadId,
        ownerUserId,
        title: input.title.trim(),
        stageId: stage.id,
        canonicalStageGroup: stage.canonicalGroup,
        amountEstimate: input.amountEstimate ? decStr(d(input.amountEstimate)) : '0',
        currency: input.currency ?? CRM_DEFAULT_CURRENCY,
        probability: input.probability ?? stage.probabilityDefault,
        expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : undefined,
        createdByUserId: ctx.userId,
      }, { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}), reassignedOwnerUserId });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code === 'customer_not_active' || code === 'lead_not_converted') throw new UnprocessableEntityException(code);
      if (code === 'customer_out_of_scope' || code === 'target_out_of_scope' || code === 'child_owner_reassignment_not_authorized') {
        throw new ForbiddenException('Record is out of scope');
      }
      if (code === 'lead_not_found') throw new NotFoundException('Lead not found');
      if (code === 'owner_not_active_company_member') throw new BadRequestException(code);
      if (code === 'branch_not_active_in_company') throw new BadRequestException(code);
      if (code === 'child_target_mismatch' || code === 'child_target_changed') throw new ConflictException({ code });
      throw error;
    }
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.opportunity.create', targetType: 'crm_opportunity', targetId: created.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    void this.outbox.append('crm.opportunity.created', 'crm_opportunity', created.id, oppOutbox(ctx, created.id, { customerId: created.customerId }));
    return toOpportunitySummary(created);
  }
}

@Injectable()
export class ListCrmOpportunitiesUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, filter: ListCrmOpportunitiesFilter) {
    requirePermission(ctx, 'crm.opportunity.read');
    const enforcedOwnerUserId = ownerScopeForList(ctx, filter.scope);
    const ownerUserId = enforcedOwnerUserId ?? filter.ownerUserId;
    const rows = await this.repo.listOpportunities({ companyId: ctx.companyId, ownerUserId, status: filter.status, stageId: filter.stageId, customerId: filter.customerId, search: filter.search });
    const page = paginate(rows, filter.page, filter.pageSize);
    return { ...page, items: page.items.map(toOpportunitySummary) };
  }
}

@Injectable()
export class GetCrmOpportunityUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, id: string): Promise<CrmOpportunityDetail> {
    requirePermission(ctx, 'crm.opportunity.read');
    const o = await this.repo.findOpportunityById(ctx.companyId, id, true);
    if (!o) throw new NotFoundException('Opportunity not found');
    assertCanReadOwned(ctx, o.ownerUserId);
    return toOpportunityDetail(o);
  }
}

@Injectable()
export class GetCrmPipelineBoardUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, scope?: 'own' | 'all'): Promise<CrmPipelineBoard> {
    requirePermission(ctx, 'crm.opportunity.read');
    const ownerUserId = ownerScopeForList(ctx, scope);
    const stages = await this.repo.ensureDefaultStages(ctx.companyId, ctx.userId);
    const opps = await this.repo.listOpportunities({ companyId: ctx.companyId, ownerUserId, status: 'OPEN' });
    const columns = stages
      .filter((s) => s.isActive)
      .map((stage) => {
        const inStage = opps.filter((o) => o.stageId === stage.id);
        return {
          stage: toStageSummary(stage),
          opportunities: inStage.map(toOpportunitySummary),
          count: inStage.length,
          totalAmount: sumAmounts(inStage.map((o) => o.amountEstimate)),
        };
      });
    return { columns };
  }
}

@Injectable()
export class UpdateCrmOpportunityUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, id: string, input: UpdateCrmOpportunityInput): Promise<CrmOpportunitySummary> {
    requirePermission(ctx, 'crm.opportunity.update');
    const o = await this.repo.findOpportunityById(ctx.companyId, id);
    if (!o) throw new NotFoundException('Opportunity not found');
    assertCanManageOwned(ctx, o.ownerUserId);
    if (o.status !== 'OPEN') throw new UnprocessableEntityException('Only open opportunities can be edited');

    let reassignedOwnerUserId: string | undefined;
    if (input.ownerUserId !== undefined && input.ownerUserId !== o.ownerUserId) {
      if (typeof input.ownerUserId !== 'string' || !input.ownerUserId.trim()) throw new BadRequestException('invalid_ownerUserId');
      reassignedOwnerUserId = input.ownerUserId.trim();
      requirePermission(ctx, 'crm.customer.assign');
      if (!(await this.repo.hasActiveCompanyMember(ctx.companyId, reassignedOwnerUserId))) {
        throw new BadRequestException('owner_not_active_company_member');
      }
    }

    const data: Record<string, unknown> = { updatedByUserId: ctx.userId };
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.ownerUserId !== undefined) data.ownerUserId = reassignedOwnerUserId ?? input.ownerUserId;
    if (input.amountEstimate !== undefined) data.amountEstimate = decStr(d(input.amountEstimate));
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.probability !== undefined) data.probability = input.probability;
    if (input.expectedCloseDate !== undefined) data.expectedCloseDate = input.expectedCloseDate ? new Date(input.expectedCloseDate) : null;

    let updated;
    try {
      updated = await this.repo.updateOpportunity(ctx.companyId, id, data, {
        scope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) },
        expectedStatuses: ['OPEN'],
        reassignedOwnerUserId,
      });
    } catch (error) {
      throwOpportunityUpdateError(error);
    }
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.opportunity.update', targetType: 'crm_opportunity', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    return toOpportunitySummary(updated);
  }
}

function throwOpportunityUpdateError(error: unknown): never {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'opportunity_not_found') throw new NotFoundException('Opportunity not found');
  if (code === 'opportunity_out_of_scope' || code === 'opportunity_owner_reassignment_not_authorized') {
    throw new ForbiddenException('Record is out of scope');
  }
  if (code === 'owner_not_active_company_member') throw new BadRequestException(code);
  if (code === 'customer_not_active') throw new UnprocessableEntityException({ code });
  if (code === 'opportunity_customer_changed' || code === 'opportunity_changed') throw new ConflictException({ code });
  throw error;
}

@Injectable()
export class MoveCrmOpportunityStageUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, id: string, input: MoveCrmOpportunityStageInput): Promise<CrmOpportunitySummary> {
    requirePermission(ctx, 'crm.opportunity.stage_move');
    const o = await this.repo.findOpportunityById(ctx.companyId, id);
    if (!o) throw new NotFoundException('Opportunity not found');
    assertCanManageOwned(ctx, o.ownerUserId);
    if (!canMoveStage(o.status)) throw new UnprocessableEntityException('Only open opportunities can move stage');

    const stage = await this.repo.findStageById(ctx.companyId, input.stageId);
    if (!stage || !stage.isActive) throw new UnprocessableEntityException('Target stage not found');
    // Terminal stages are reached only via the close action, not a plain stage move.
    if (isTerminalGroup(stage.canonicalGroup)) throw new UnprocessableEntityException('Use close action for terminal stages');

    const now = new Date();
    let updated;
    try {
      updated = await this.repo.transitionOpportunity({
        companyId: ctx.companyId,
        opportunityId: id,
        expectedCustomerId: o.customerId,
        expectedStatuses: ['OPEN'],
        scope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) },
        data: { stageId: stage.id, canonicalStageGroup: stage.canonicalGroup, probability: stage.probabilityDefault ?? o.probability, lastActivityAt: now, updatedByUserId: ctx.userId },
        activity: { actorUserId: ctx.userId, type: 'STAGE_CHANGED', note: input.note ?? `Moved to ${stage.name}`, occurredAt: now, metadataJson: { fromStageId: o.stageId, toStageId: stage.id } },
      });
    } catch (error) {
      throwOpportunityTransitionError(error);
    }
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.opportunity.stage_move', targetType: 'crm_opportunity', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { toStageId: stage.id } });
    void this.outbox.append('crm.opportunity.stage_changed', 'crm_opportunity', id, oppOutbox(ctx, id, { toStage: stage.canonicalGroup }));
    return toOpportunitySummary(updated);
  }
}

@Injectable()
export class CloseCrmOpportunityUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, id: string, input: CloseCrmOpportunityInput): Promise<CrmOpportunitySummary> {
    requirePermission(ctx, 'crm.opportunity.close');
    const o = await this.repo.findOpportunityById(ctx.companyId, id, true);
    if (!o) throw new NotFoundException('Opportunity not found');
    assertCanManageOwned(ctx, o.ownerUserId);
    if (o.status !== 'OPEN') throw new UnprocessableEntityException('Opportunity is already closed');
    if (input.result !== 'WON' && input.result !== 'LOST') throw new BadRequestException('invalid_result');

    // Only an active (non-void/reject) quotation link satisfies the WON-requires-quote rule.
    const hasQuotationLink = (o.quotationLinks ?? []).some((q) => q.status !== 'VOIDED' && q.status !== 'REJECTED');
    const err = validateClose(input.result, { reason: input.reason, winReason: input.winReason, hasQuotationLink });
    if (err) throw new UnprocessableEntityException(err);

    // Pick the terminal stage matching the close result.
    const stages = await this.repo.listStages(ctx.companyId);
    const terminal = stages.find((s) => (input.result === 'WON' ? s.isTerminalWon : s.isTerminalLost) && s.isActive);
    const now = new Date();
    let updated;
    try {
      updated = await this.repo.transitionOpportunity({
        companyId: ctx.companyId,
        opportunityId: id,
        expectedCustomerId: o.customerId,
        expectedStatuses: ['OPEN'],
        scope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) },
        data: {
          status: input.result,
          stageId: terminal?.id ?? o.stageId,
          canonicalStageGroup: input.result,
          closedAt: now,
          closedByUserId: ctx.userId,
          closeReason: input.winReason ?? input.reason,
          lostReason: input.result === 'LOST' ? input.reason : undefined,
          probability: input.result === 'WON' ? 100 : 0,
          lastActivityAt: now,
          updatedByUserId: ctx.userId,
        },
        activity: {
          actorUserId: ctx.userId,
          type: 'STAGE_CHANGED',
          outcome: input.result === 'WON' ? 'COMPLETED' : 'NEGATIVE',
          note: `Closed ${input.result}${input.reason ? `: ${input.reason}` : ''}`,
          occurredAt: now,
        },
      });
    } catch (error) {
      throwOpportunityTransitionError(error);
    }
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.opportunity.close', targetType: 'crm_opportunity', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { result: input.result } });
    void this.outbox.append(input.result === 'WON' ? 'crm.opportunity.won' : 'crm.opportunity.lost', 'crm_opportunity', id, oppOutbox(ctx, id, { amount: o.amountEstimate }));
    return toOpportunitySummary(updated);
  }
}

@Injectable()
export class ReopenCrmOpportunityUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, id: string, input: ReopenCrmOpportunityInput): Promise<CrmOpportunitySummary> {
    requirePermission(ctx, 'crm.opportunity.reopen');
    if (!input?.reason || input.reason.trim() === '') throw new BadRequestException('reason_required');
    const o = await this.repo.findOpportunityById(ctx.companyId, id);
    if (!o) throw new NotFoundException('Opportunity not found');
    assertCanManageOwned(ctx, o.ownerUserId);
    if (!canReopen(o.status)) throw new UnprocessableEntityException('Only won/lost opportunities can be reopened');

    const stages = await this.repo.listStages(ctx.companyId);
    const target = (input.stageId ? stages.find((s) => s.id === input.stageId) : undefined) ?? stages.find((s) => s.isActive && !isTerminalGroup(s.canonicalGroup)) ?? stages[0];
    const now = new Date();
    let updated;
    try {
      updated = await this.repo.transitionOpportunity({
        companyId: ctx.companyId,
        opportunityId: id,
        expectedCustomerId: o.customerId,
        expectedStatuses: ['WON', 'LOST'],
        scope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) },
        data: { status: 'OPEN', stageId: target.id, canonicalStageGroup: target.canonicalGroup, closedAt: null, closedByUserId: null, closeReason: null, lostReason: null, lastActivityAt: now, updatedByUserId: ctx.userId },
        activity: { actorUserId: ctx.userId, type: 'STAGE_CHANGED', note: `Reopened: ${input.reason}`, occurredAt: now },
      });
    } catch (error) {
      throwOpportunityTransitionError(error);
    }
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.opportunity.reopen', targetType: 'crm_opportunity', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { reasonProvided: true } });
    void this.outbox.append('crm.opportunity.reopened', 'crm_opportunity', id, oppOutbox(ctx, id, { reasonProvided: true }));
    return toOpportunitySummary(updated);
  }
}

function throwOpportunityTransitionError(error: unknown): never {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'opportunity_not_found') throw new NotFoundException('Opportunity not found');
  if (code === 'opportunity_out_of_scope') throw new ForbiddenException('Record is out of scope');
  if (code === 'customer_not_active') throw new UnprocessableEntityException({ code });
  if (code === 'opportunity_customer_changed' || code === 'opportunity_status_changed') throw new ConflictException({ code });
  throw error;
}

// ---- Activities ----

@Injectable()
export class ListCrmActivitiesUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, filter: ListCrmActivitiesFilter): Promise<CrmActivitySummary[]> {
    requirePermission(ctx, 'crm.activity.read');
    // Callers without company-wide read may only see activities for records they own.
    let actorUserId = filter.actorUserId;
    if (!crmCanReadAll(ctx.roles)) {
      if (filter.customerId) {
        const c = await this.repo.findCustomerById(ctx.companyId, filter.customerId);
        if (!c) throw new NotFoundException('Customer not found');
        assertCanReadOwned(ctx, c.ownerUserId);
      } else if (filter.opportunityId) {
        const o = await this.repo.findOpportunityById(ctx.companyId, filter.opportunityId);
        if (!o) throw new NotFoundException('Opportunity not found');
        assertCanReadOwned(ctx, o.ownerUserId);
      } else if (filter.leadId) {
        const lead = await this.repo.findLeadById(ctx.companyId, filter.leadId);
        if (!lead) throw new NotFoundException('Lead not found');
        assertCanReadOwned(ctx, lead.assignedToUserId);
      } else {
        // No owned target scope given — restrict to the caller's own activity.
        actorUserId = ctx.userId;
      }
    }
    const rows = await this.repo.listActivities({ companyId: ctx.companyId, customerId: filter.customerId, opportunityId: filter.opportunityId, leadId: filter.leadId, actorUserId });
    const page = paginate(rows, filter.page, filter.pageSize);
    return page.items.map(toActivitySummary);
  }
}

@Injectable()
export class CreateCrmActivityUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, input: CreateCrmActivityInput): Promise<CrmActivitySummary> {
    requirePermission(ctx, 'crm.activity.create');
    if (!input.note || input.note.trim() === '') throw new BadRequestException('note_required');
    if (!input.customerId && !input.opportunityId && !input.leadId) throw new BadRequestException('activity_target_required');
    const now = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (input.customerId) {
      const customer = await this.repo.findCustomerById(ctx.companyId, input.customerId);
      if (!customer) throw new NotFoundException('Customer not found');
      assertCanManageOwned(ctx, customer.ownerUserId);
    }
    if (input.opportunityId) {
      const opportunity = await this.repo.findOpportunityById(ctx.companyId, input.opportunityId);
      if (!opportunity) throw new NotFoundException('Opportunity not found');
      assertCanManageOwned(ctx, opportunity.ownerUserId);
    }
    if (input.leadId) {
      const lead = await this.repo.findLeadById(ctx.companyId, input.leadId);
      if (!lead) throw new NotFoundException('Lead not found');
      assertCanManageOwned(ctx, lead.assignedToUserId);
    }
    let created;
    try {
      created = await this.repo.createActivity({
        companyId: ctx.companyId, customerId: input.customerId, opportunityId: input.opportunityId, leadId: input.leadId, actorUserId: ctx.userId,
        type: input.type, channel: input.channel, outcome: input.outcome, note: input.note.trim(), occurredAt: now,
      }, { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code.endsWith('_not_found')) throw new NotFoundException(code);
      if (code === 'target_out_of_scope' || code === 'customer_out_of_scope') throw new ForbiddenException('Record is out of scope');
      if (['customer_not_active', 'child_target_changed', 'child_target_mismatch'].includes(code)) throw new ConflictException({ code });
      throw error;
    }
    // Roll up last-activity timestamps.
    if (input.opportunityId) {
      await this.repo.updateOpportunity(ctx.companyId, input.opportunityId, { lastActivityAt: now }, {
        scope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) },
      }).catch(() => undefined);
    }
    if (input.customerId) await this.repo.updateCustomer(ctx.companyId, input.customerId, { lastActivityAt: now }).catch(() => undefined);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.activity.create', targetType: 'crm_activity', targetId: created.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    void this.outbox.append('crm.activity.created', 'crm_activity', created.id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'crm_activity', aggregateId: created.id, occurredAt: now.toISOString(), data: { type: input.type } });
    return toActivitySummary(created);
  }
}
