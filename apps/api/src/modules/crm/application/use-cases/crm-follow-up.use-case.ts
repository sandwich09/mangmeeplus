import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  RequestContext,
  CreateCrmFollowUpInput,
  UpdateCrmFollowUpInput,
  CompleteCrmFollowUpInput,
  SnoozeCrmFollowUpInput,
  CancelCrmFollowUpInput,
  ListCrmFollowUpsFilter,
  CrmFollowUpSummary,
} from '@watchdog-bms/contracts';
import { PrismaCrmRepository } from '../../infrastructure/prisma-crm.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { toFollowUpSummary } from '../dto/crm.mapper';
import { requirePermission, assertCanManageOwned, ownerScopeForList } from '../crm-access';
import { canTransitionFollowUp, effectiveFollowUpStatus, crmCanManageAll } from '../../domain/logic/crm.logic';
import { CRM_DEFAULT_TIMEZONE } from '../../domain/crm.constants';

function paginate<T>(rows: T[], page?: number, pageSize?: number) {
  const p = page && page > 0 ? page : 1;
  const size = pageSize && pageSize > 0 ? Math.min(pageSize, 100) : 20;
  const start = (p - 1) * size;
  return { items: rows.slice(start, start + size), total: rows.length, page: p, pageSize: size };
}

function buildCreateData(ctx: RequestContext, input: CreateCrmFollowUpInput) {
  if (!input.title || input.title.trim() === '') throw new BadRequestException('title_required');
  if (!input.dueAt) throw new BadRequestException('dueAt_required');
  if (!input.customerId && !input.opportunityId && !input.leadId) throw new BadRequestException('follow_up_target_required');
  return {
    companyId: ctx.companyId,
    customerId: input.customerId,
    leadId: input.leadId,
    opportunityId: input.opportunityId,
    ownerUserId: input.ownerUserId ?? ctx.userId,
    title: input.title.trim(),
    dueAt: new Date(input.dueAt),
    timezone: input.timezone ?? CRM_DEFAULT_TIMEZONE,
    priority: input.priority ?? 'NORMAL',
    channel: input.channel ?? 'PHONE',
    createdByUserId: ctx.userId,
  };
}

function fuOutbox(ctx: RequestContext, id: string, data: Record<string, unknown>) {
  return { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'crm_follow_up', aggregateId: id, occurredAt: new Date().toISOString(), data };
}

@Injectable()
export class ListCrmFollowUpsUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, filter: ListCrmFollowUpsFilter): Promise<{ items: CrmFollowUpSummary[]; total: number; page: number; pageSize: number }> {
    requirePermission(ctx, 'crm.follow_up.read');
    const enforcedOwnerUserId = ownerScopeForList(ctx, filter.scope);
    const ownerUserId = enforcedOwnerUserId ?? filter.ownerUserId;
    const now = new Date();
    const range: { dueBefore?: Date; dueAfter?: Date } = {};
    if (filter.view === 'due_today') {
      range.dueBefore = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    } else if (filter.view === 'overdue') {
      range.dueBefore = now;
    } else if (filter.view === 'upcoming') {
      range.dueAfter = now;
    }
    const statusFilter = filter.status ?? (filter.view === 'overdue' ? undefined : filter.view ? 'OPEN' : undefined);
    const rows = await this.repo.listFollowUps({
      companyId: ctx.companyId, ownerUserId, status: statusFilter, customerId: filter.customerId, opportunityId: filter.opportunityId, dueBefore: range.dueBefore, dueAfter: range.dueAfter,
    });
    // Derive effective OVERDUE status for OPEN tasks past due.
    const mapped = rows.map((f) => ({ ...f, status: effectiveFollowUpStatus(f.status, f.dueAt, now) }));
    const filtered = filter.view === 'overdue' ? mapped.filter((f) => f.status === 'OVERDUE') : mapped;
    const page = paginate(filtered, filter.page, filter.pageSize);
    return { ...page, items: page.items.map(toFollowUpSummary) };
  }
}

@Injectable()
export class CreateCrmFollowUpUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, input: CreateCrmFollowUpInput): Promise<CrmFollowUpSummary> {
    requirePermission(ctx, 'crm.follow_up.create');
    const data = buildCreateData(ctx, input);
    if (data.ownerUserId !== ctx.userId) {
      requirePermission(ctx, 'crm.customer.assign');
      if (!(await this.repo.hasActiveCompanyMember(ctx.companyId, data.ownerUserId))) throw new BadRequestException('owner_not_active_company_member');
    }
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
      created = await this.repo.createFollowUp(data, {
        actorUserId: ctx.userId,
        canManageAll: crmCanManageAll(ctx.roles),
        reassignedOwnerUserId: data.ownerUserId !== ctx.userId ? data.ownerUserId : undefined,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code.endsWith('_not_found')) throw new NotFoundException(code);
      if (code === 'target_out_of_scope' || code === 'customer_out_of_scope') throw new ForbiddenException('Record is out of scope');
      if (code === 'child_owner_reassignment_not_authorized') throw new ForbiddenException('Owner reassignment is not authorized');
      if (code === 'owner_not_active_company_member') throw new BadRequestException(code);
      if (code === 'customer_not_active') throw new UnprocessableEntityException('Customer is not active');
      if (code === 'child_target_changed' || code === 'child_target_mismatch') throw new ConflictException({ code });
      throw error;
    }
    if (input.opportunityId) {
      await this.repo.updateOpportunity(ctx.companyId, input.opportunityId, { nextFollowUpAt: created.dueAt }, {
        scope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) },
      }).catch(() => undefined);
    }
    if (created.customerId) await this.repo.updateCustomer(ctx.companyId, created.customerId, { nextFollowUpAt: created.dueAt }).catch(() => undefined);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.follow_up.create', targetType: 'crm_follow_up', targetId: created.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    void this.outbox.append('crm.follow_up.created', 'crm_follow_up', created.id, fuOutbox(ctx, created.id, { dueAt: created.dueAt.toISOString(), ownerUserId: created.ownerUserId }));
    return toFollowUpSummary(created);
  }
}

@Injectable()
export class UpdateCrmFollowUpUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, id: string, input: UpdateCrmFollowUpInput): Promise<CrmFollowUpSummary> {
    requirePermission(ctx, 'crm.follow_up.update');
    const f = await this.repo.findFollowUpById(ctx.companyId, id);
    if (!f) throw new NotFoundException('Follow-up not found');
    assertCanManageOwned(ctx, f.ownerUserId);
    if (f.status === 'DONE' || f.status === 'CANCELED') throw new UnprocessableEntityException('Follow-up is closed');
    const data: Record<string, unknown> = { updatedByUserId: ctx.userId };
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.dueAt !== undefined) data.dueAt = new Date(input.dueAt);
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.channel !== undefined) data.channel = input.channel;
    let updated;
    try {
      updated = await this.repo.updateFollowUp(ctx.companyId, id, data, {
        scope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) },
        expectedStatuses: [f.status],
      });
    } catch (error) {
      throwFollowUpUpdateError(error);
    }
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.follow_up.update', targetType: 'crm_follow_up', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    return toFollowUpSummary(updated);
  }
}

@Injectable()
export class CompleteCrmFollowUpUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, id: string, input: CompleteCrmFollowUpInput): Promise<CrmFollowUpSummary> {
    requirePermission(ctx, 'crm.follow_up.complete');
    const f = await this.repo.findFollowUpById(ctx.companyId, id);
    if (!f) throw new NotFoundException('Follow-up not found');
    assertCanManageOwned(ctx, f.ownerUserId);
    if (!canTransitionFollowUp(effectiveFollowUpStatus(f.status, f.dueAt, new Date()), 'DONE')) {
      throw new UnprocessableEntityException('Follow-up cannot be completed');
    }
    const now = new Date();
    const activity = input.note || input.outcome
      ? {
          companyId: ctx.companyId, customerId: f.customerId, opportunityId: f.opportunityId, leadId: f.leadId, followUpTaskId: f.id, actorUserId: ctx.userId,
          type: 'TASK_COMPLETED' as const, channel: f.channel, outcome: input.outcome, note: input.note ?? `Completed: ${f.title}`, occurredAt: now,
        }
      : undefined;
    const nextFollowUp = input.nextFollowUp ? buildCreateData(ctx, input.nextFollowUp) : undefined;
    let reassignedOwnerUserId: string | undefined;
    if (nextFollowUp && nextFollowUp.ownerUserId !== ctx.userId) {
      requirePermission(ctx, 'crm.customer.assign');
      if (!(await this.repo.hasActiveCompanyMember(ctx.companyId, nextFollowUp.ownerUserId))) {
        throw new BadRequestException('owner_not_active_company_member');
      }
      reassignedOwnerUserId = nextFollowUp.ownerUserId;
    }

    let result;
    try {
      result = await this.repo.completeFollowUp({
        companyId: ctx.companyId, id, userId: ctx.userId,
        scope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}), reassignedOwnerUserId },
        completeData: { status: 'DONE', completedAt: now, completedByUserId: ctx.userId, updatedByUserId: ctx.userId },
        activity,
        nextFollowUp,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code === 'follow_up_not_found') throw new NotFoundException('Follow-up not found');
      if (code === 'follow_up_out_of_scope' || code === 'target_out_of_scope' || code === 'child_owner_reassignment_not_authorized') {
        throw new ForbiddenException('Record is out of scope');
      }
      if (code.endsWith('_not_found')) throw new NotFoundException(code);
      if (code === 'owner_not_active_company_member') throw new BadRequestException(code);
      if (['follow_up_customer_changed', 'follow_up_closed', 'follow_up_changed', 'next_follow_up_customer_mismatch', 'activity_target_mismatch', 'child_target_mismatch', 'child_target_changed', 'customer_not_active'].includes(code)) {
        throw new UnprocessableEntityException({ code });
      }
      throw error;
    }
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.follow_up.complete', targetType: 'crm_follow_up', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { chainedNext: !!result.next } });
    void this.outbox.append('crm.follow_up.completed', 'crm_follow_up', id, fuOutbox(ctx, id, { nextFollowUpId: result.next?.id }));
    return toFollowUpSummary(result.followUp);
  }
}

@Injectable()
export class SnoozeCrmFollowUpUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, id: string, input: SnoozeCrmFollowUpInput): Promise<CrmFollowUpSummary> {
    requirePermission(ctx, 'crm.follow_up.update');
    if (!input?.snoozedUntil) throw new BadRequestException('snoozedUntil_required');
    const f = await this.repo.findFollowUpById(ctx.companyId, id);
    if (!f) throw new NotFoundException('Follow-up not found');
    assertCanManageOwned(ctx, f.ownerUserId);
    if (!canTransitionFollowUp(effectiveFollowUpStatus(f.status, f.dueAt, new Date()), 'SNOOZED')) throw new UnprocessableEntityException('Follow-up cannot be snoozed');
    const until = new Date(input.snoozedUntil);
    let updated;
    try {
      updated = await this.repo.updateFollowUp(ctx.companyId, id, { status: 'SNOOZED', snoozedUntil: until, dueAt: until, updatedByUserId: ctx.userId }, {
        scope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) },
        expectedStatuses: [f.status],
      });
    } catch (error) {
      throwFollowUpUpdateError(error);
    }
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.follow_up.snooze', targetType: 'crm_follow_up', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    return toFollowUpSummary(updated);
  }
}

@Injectable()
export class CancelCrmFollowUpUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, id: string, input: CancelCrmFollowUpInput): Promise<CrmFollowUpSummary> {
    requirePermission(ctx, 'crm.follow_up.update');
    if (!input?.reason || input.reason.trim() === '') throw new BadRequestException('reason_required');
    const f = await this.repo.findFollowUpById(ctx.companyId, id);
    if (!f) throw new NotFoundException('Follow-up not found');
    assertCanManageOwned(ctx, f.ownerUserId);
    if (!canTransitionFollowUp(effectiveFollowUpStatus(f.status, f.dueAt, new Date()), 'CANCELED')) throw new UnprocessableEntityException('Follow-up cannot be canceled');
    let updated;
    try {
      updated = await this.repo.updateFollowUp(ctx.companyId, id, { status: 'CANCELED', canceledAt: new Date(), canceledByUserId: ctx.userId, cancelReason: input.reason, updatedByUserId: ctx.userId }, {
        scope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) },
        expectedStatuses: [f.status],
      });
    } catch (error) {
      throwFollowUpUpdateError(error);
    }
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.follow_up.cancel', targetType: 'crm_follow_up', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { reasonProvided: true } });
    return toFollowUpSummary(updated);
  }
}

function throwFollowUpUpdateError(error: unknown): never {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'follow_up_not_found') throw new NotFoundException('Follow-up not found');
  if (code === 'opportunity_not_found') throw new NotFoundException('Opportunity not found');
  if (code === 'follow_up_out_of_scope') throw new ForbiddenException('Record is out of scope');
  if (code === 'customer_not_active') throw new UnprocessableEntityException({ code });
  if (code === 'follow_up_customer_changed' || code === 'follow_up_changed') throw new ConflictException({ code });
  throw error;
}
