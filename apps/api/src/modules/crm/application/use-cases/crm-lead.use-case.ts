import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  RequestContext,
  CreateCrmLeadInput,
  UpdateCrmLeadInput,
  AssignCrmLeadInput,
  DisqualifyCrmLeadInput,
  ConvertCrmLeadInput,
  ConvertCrmLeadResult,
  ListCrmLeadsFilter,
  CrmLeadSummary,
} from '@watchdog-bms/contracts';
import { PrismaCrmRepository } from '../../infrastructure/prisma-crm.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { toLeadSummary, toCustomerSummary, toOpportunitySummary } from '../dto/crm.mapper';
import { requirePermission, assertCanReadOwned, assertCanManageOwned, ownerScopeForList } from '../crm-access';
import { normalizePhone, normalizeEmail, normalizeName, normalizeTaxId, crmCanManageAll, d, decStr } from '../../domain/logic/crm.logic';
import { CRM_DEFAULT_CURRENCY } from '../../domain/crm.constants';
import {
  buildDuplicateWarnings,
  canReadCustomerIdentity,
  enforceDuplicatePolicy,
  normalizedKeys,
  throwCustomerMutationError,
  validateCustomerEnums,
  validateCustomerReferences,
  validateCustomerValues,
} from './crm-customer.use-case';

function paginate<T>(rows: T[], page?: number, pageSize?: number) {
  const p = page && page > 0 ? page : 1;
  const size = pageSize && pageSize > 0 ? Math.min(pageSize, 100) : 20;
  const start = (p - 1) * size;
  return { items: rows.slice(start, start + size), total: rows.length, page: p, pageSize: size };
}

function outbox(ctx: RequestContext, id: string, data: Record<string, unknown>) {
  return { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'crm_lead', aggregateId: id, occurredAt: new Date().toISOString(), data };
}

function customerOriginFromLead(source: string) {
  switch (source) {
    case 'CSV_IMPORT': return 'IMPORT';
    case 'LINE': return 'LINE';
    case 'FACEBOOK': return 'FACEBOOK';
    case 'MARKETPLACE': return 'MARKETPLACE';
    case 'WEB_FORM': return 'WEB';
    case 'REFERRAL': return 'REFERRAL';
    default: return 'MANUAL';
  }
}

@Injectable()
export class CreateCrmLeadUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, input: CreateCrmLeadInput): Promise<CrmLeadSummary> {
    requirePermission(ctx, 'crm.lead.create');
    if (!input.rawName && !input.rawPhone && !input.rawEmail) throw new BadRequestException('lead_identity_required');
    if (input.assignedToUserId && input.assignedToUserId !== ctx.userId) {
      requirePermission(ctx, 'crm.lead.assign');
      if (!(await this.repo.hasActiveCompanyMember(ctx.companyId, input.assignedToUserId))) throw new BadRequestException('assignee_not_active_company_member');
    }
    await validateCustomerReferences(this.repo, ctx.companyId, { branchId: input.branchId }, ctx.scopes);
    let created;
    try {
      created = await this.repo.createLead({
        companyId: ctx.companyId,
        branchId: input.branchId,
        source: input.source ?? 'MANUAL',
        rawName: input.rawName,
        rawPhone: input.rawPhone,
        rawPhoneNormalized: normalizePhone(input.rawPhone),
        rawEmail: input.rawEmail,
        rawEmailNormalized: normalizeEmail(input.rawEmail),
        assignedToUserId: input.assignedToUserId,
        note: input.note,
        createdByUserId: ctx.userId,
      });
    } catch (error) {
      throwLeadMutationError(error);
    }
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.lead.create', targetType: 'crm_lead', targetId: created.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    void this.outbox.append('crm.lead.created', 'crm_lead', created.id, outbox(ctx, created.id, { source: created.source, assigned: !!created.assignedToUserId }));
    return toLeadSummary(created);
  }
}

@Injectable()
export class ListCrmLeadsUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, filter: ListCrmLeadsFilter) {
    requirePermission(ctx, 'crm.lead.read');
    const enforcedAssignedToUserId = ownerScopeForList(ctx, filter.scope);
    const assignedToUserId = enforcedAssignedToUserId ?? filter.assignedToUserId;
    const rows = await this.repo.listLeads({ companyId: ctx.companyId, assignedToUserId, status: filter.status, source: filter.source, search: filter.search });
    const page = paginate(rows, filter.page, filter.pageSize);
    return { ...page, items: page.items.map(toLeadSummary) };
  }
}

@Injectable()
export class GetCrmLeadUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, id: string): Promise<CrmLeadSummary> {
    requirePermission(ctx, 'crm.lead.read');
    const lead = await this.repo.findLeadById(ctx.companyId, id);
    if (!lead) throw new NotFoundException('Lead not found');
    assertCanReadOwned(ctx, lead.assignedToUserId);
    return toLeadSummary(lead);
  }
}

@Injectable()
export class UpdateCrmLeadUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, id: string, input: UpdateCrmLeadInput): Promise<CrmLeadSummary> {
    requirePermission(ctx, 'crm.lead.update');
    const lead = await this.repo.findLeadById(ctx.companyId, id);
    if (!lead) throw new NotFoundException('Lead not found');
    assertCanManageOwned(ctx, lead.assignedToUserId);
    if (lead.status === 'CONVERTED') throw new UnprocessableEntityException('Cannot edit a converted lead');
    if (input.status === 'CONVERTED') throw new BadRequestException('use_lead_conversion_action');

    let reassignedAssigneeUserId: string | undefined;
    if (input.assignedToUserId !== undefined && input.assignedToUserId !== lead.assignedToUserId) {
      requirePermission(ctx, 'crm.lead.assign');
      reassignedAssigneeUserId = input.assignedToUserId;
      if (!(await this.repo.hasActiveCompanyMember(ctx.companyId, reassignedAssigneeUserId))) {
        throw new BadRequestException('assignee_not_active_company_member');
      }
    }

    const data: Record<string, unknown> = { updatedByUserId: ctx.userId };
    if (input.rawName !== undefined) data.rawName = input.rawName;
    if (input.rawPhone !== undefined) { data.rawPhone = input.rawPhone; data.rawPhoneNormalized = normalizePhone(input.rawPhone); }
    if (input.rawEmail !== undefined) { data.rawEmail = input.rawEmail; data.rawEmailNormalized = normalizeEmail(input.rawEmail); }
    if (input.source !== undefined) data.source = input.source;
    if (input.assignedToUserId !== undefined) data.assignedToUserId = input.assignedToUserId;
    if (input.note !== undefined) data.note = input.note;
    if (input.status !== undefined) data.status = input.status;

    let updated;
    try {
      updated = await this.repo.updateLead(ctx.companyId, id, data, {
        actorUserId: ctx.userId,
        canManageAll: crmCanManageAll(ctx.roles),
        expectedStatus: lead.status,
        reassignedAssigneeUserId,
      });
    } catch (error) {
      throwLeadMutationError(error);
    }
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.lead.update', targetType: 'crm_lead', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    return toLeadSummary(updated);
  }
}

@Injectable()
export class AssignCrmLeadUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, id: string, input: AssignCrmLeadInput): Promise<CrmLeadSummary> {
    requirePermission(ctx, 'crm.lead.assign');
    if (!input?.assignedToUserId) throw new BadRequestException('assignedToUserId_required');
    if (!(await this.repo.hasActiveCompanyMember(ctx.companyId, input.assignedToUserId))) throw new BadRequestException('assignee_not_active_company_member');
    const lead = await this.repo.findLeadById(ctx.companyId, id);
    if (!lead) throw new NotFoundException('Lead not found');
    assertCanManageOwned(ctx, lead.assignedToUserId);
    if (lead.status === 'CONVERTED') throw new UnprocessableEntityException('Cannot assign a converted lead');
    let updated;
    try {
      updated = await this.repo.updateLead(ctx.companyId, id, { assignedToUserId: input.assignedToUserId, updatedByUserId: ctx.userId }, {
        actorUserId: ctx.userId,
        canManageAll: crmCanManageAll(ctx.roles),
        expectedStatus: lead.status,
        reassignedAssigneeUserId: input.assignedToUserId,
      });
    } catch (error) {
      throwLeadMutationError(error);
    }
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.lead.assign', targetType: 'crm_lead', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { assignedToUserId: input.assignedToUserId } });
    void this.outbox.append('crm.lead.assigned', 'crm_lead', id, outbox(ctx, id, { assignedToUserId: input.assignedToUserId }));
    return toLeadSummary(updated);
  }
}

@Injectable()
export class DisqualifyCrmLeadUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, id: string, input: DisqualifyCrmLeadInput): Promise<CrmLeadSummary> {
    requirePermission(ctx, 'crm.lead.disqualify');
    if (!input?.reason || input.reason.trim() === '') throw new BadRequestException('reason_required');
    const lead = await this.repo.findLeadById(ctx.companyId, id);
    if (!lead) throw new NotFoundException('Lead not found');
    assertCanManageOwned(ctx, lead.assignedToUserId);
    if (lead.status === 'CONVERTED') throw new UnprocessableEntityException('Cannot disqualify a converted lead');
    let updated;
    try {
      updated = await this.repo.updateLead(ctx.companyId, id, { status: 'DISQUALIFIED', disqualifiedReason: input.reason, disqualifiedAt: new Date(), updatedByUserId: ctx.userId }, {
        actorUserId: ctx.userId,
        canManageAll: crmCanManageAll(ctx.roles),
        expectedStatus: lead.status,
      });
    } catch (error) {
      throwLeadMutationError(error);
    }
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.lead.disqualify', targetType: 'crm_lead', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { reasonProvided: true } });
    void this.outbox.append('crm.lead.disqualified', 'crm_lead', id, outbox(ctx, id, { reasonProvided: true }));
    return toLeadSummary(updated);
  }
}

function throwLeadMutationError(error: unknown): never {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'lead_not_found') throw new NotFoundException('Lead not found');
  if (code === 'lead_out_of_scope' || code === 'lead_reassignment_not_authorized') throw new ForbiddenException('Record is out of scope');
  if (code === 'assignee_not_active_company_member') throw new BadRequestException(code);
  if (code === 'branch_not_active_in_company') throw new BadRequestException(code);
  if (code === 'lead_status_changed') throw new ConflictException({ code });
  throw error;
}

@Injectable()
export class ConvertCrmLeadUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, id: string, input: ConvertCrmLeadInput): Promise<ConvertCrmLeadResult> {
    requirePermission(ctx, 'crm.lead.convert');
    if (!ctx.roles.some((role) => ['OWNER', 'ADMIN', 'SALES', 'MANAGER', 'SYSTEM_ADMIN', 'SYSTEM'].includes(role))) {
      throw new ForbiddenException('Lead conversion requires an operational CRM role');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('invalid_lead_conversion_input');
    if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 200)) {
      throw new BadRequestException('invalid_idempotencyKey');
    }
    if (input.customer !== undefined && (!input.customer || typeof input.customer !== 'object' || Array.isArray(input.customer))) {
      throw new BadRequestException('invalid_customer_input');
    }
    const lead = await this.repo.findLeadById(ctx.companyId, id);
    if (!lead) throw new NotFoundException('Lead not found');
    assertCanManageOwned(ctx, lead.assignedToUserId);

    const convertKey = input.idempotencyKey ?? `lead-convert:${id}`;

    // Idempotency: a prior successful conversion (same lead) returns the existing result.
    if (lead.status === 'CONVERTED' && lead.convertedCustomerId) {
      return this.buildResult(ctx, lead.id);
    }
    const priorByKey = await this.repo.findLeadByConvertKey(ctx.companyId, convertKey);
    if (priorByKey && priorByKey.id !== id) throw new UnprocessableEntityException('idempotency_key_reused');

    if (lead.status === 'DISQUALIFIED') throw new UnprocessableEntityException('Cannot convert a disqualified lead');
    if (input.existingCustomerId && input.customer) throw new BadRequestException('choose_existing_or_new_customer');
    if (!input.existingCustomerId && !input.customer && !lead.rawName) throw new BadRequestException('customer_details_required');
    if (input.existingCustomerId) {
      const existingCustomer = await this.repo.findCustomerById(ctx.companyId, input.existingCustomerId);
      if (!existingCustomer) throw new NotFoundException('Customer not found');
      assertCanManageOwned(ctx, existingCustomer.ownerUserId);
      if (existingCustomer.status !== 'ACTIVE') throw new UnprocessableEntityException('existing_customer_not_active');
    }
    const requestedOwnerUserId = input.customer?.ownerUserId;
    const defaultOwnerUserId = lead.assignedToUserId ?? ctx.userId;
    if (requestedOwnerUserId && requestedOwnerUserId !== defaultOwnerUserId) {
      requirePermission(ctx, 'crm.customer.assign');
      if (!(await this.repo.hasActiveCompanyMember(ctx.companyId, requestedOwnerUserId))) throw new BadRequestException('owner_not_active_company_member');
    }

    // Ensure default pipeline stages exist, then open the opportunity at the first stage.
    let opportunity: { title: string; stageId: string; canonicalStageGroup: string; amountEstimate: string; currency: string } | undefined;
    if (input.opportunityTitle) {
      const stages = await this.repo.ensureDefaultStages(ctx.companyId, ctx.userId);
      const firstStage = stages.find((s) => s.isActive) ?? stages[0];
      opportunity = {
        title: input.opportunityTitle,
        stageId: firstStage.id,
        canonicalStageGroup: firstStage.canonicalGroup,
        amountEstimate: input.amountEstimate ? decStr(d(input.amountEstimate)) : '0',
        currency: CRM_DEFAULT_CURRENCY,
      };
    }

    let customerData: Record<string, unknown> | undefined;
    let customerDuplicateGuard: Parameters<PrismaCrmRepository['convertLead']>[0]['customerDuplicateGuard'];
    if (!input.existingCustomerId) {
      const customerInput = input.customer ?? { displayName: lead.rawName ?? 'Lead' };
      const rawCustomerInput = customerInput as unknown as Record<string, unknown>;
      if (rawCustomerInput['lineUserId'] !== undefined) throw new BadRequestException('line_identity_link_required');
      if (rawCustomerInput['status'] !== undefined) throw new BadRequestException('status_not_allowed_on_create');
      if (rawCustomerInput['originSource'] !== undefined || rawCustomerInput['createdByType'] !== undefined || rawCustomerInput['source'] !== undefined) {
        throw new BadRequestException('customer_provenance_managed_by_lead_conversion');
      }
      const proposedDisplayName = customerInput.displayName ?? lead.rawName ?? 'Lead';
      validateCustomerValues({ ...rawCustomerInput, displayName: proposedDisplayName }, proposedDisplayName);
      const effectiveCustomer = {
        displayName: proposedDisplayName.trim(),
        primaryPhone: customerInput.primaryPhone ?? lead.rawPhone,
        primaryEmail: customerInput.primaryEmail ?? lead.rawEmail,
        taxId: customerInput.taxId,
      };
      validateCustomerValues({ ...rawCustomerInput, ...effectiveCustomer }, effectiveCustomer.displayName);
      validateCustomerEnums(rawCustomerInput);
      await validateCustomerReferences(this.repo, ctx.companyId, {
        branchId: customerInput.branchId ?? lead.branchId,
        ownerUserId: customerInput.ownerUserId ?? lead.assignedToUserId ?? ctx.userId,
        accountingCounterpartyId: customerInput.accountingCounterpartyId,
      }, ctx.scopes);
      const keys = normalizedKeys(effectiveCustomer);
      const warnings = buildDuplicateWarnings(keys, await this.repo.findDuplicateCustomers(ctx.companyId, keys), ctx);
      enforceDuplicatePolicy(warnings, customerInput.duplicateOverride);
      customerData = {
          companyId: ctx.companyId,
          branchId: customerInput.branchId ?? lead.branchId,
          displayName: effectiveCustomer.displayName,
          displayNameNormalized: normalizeName(effectiveCustomer.displayName),
          legalName: customerInput.legalName,
          customerType: customerInput.customerType ?? 'UNKNOWN',
          ownerUserId: customerInput.ownerUserId ?? lead.assignedToUserId ?? ctx.userId,
          primaryPhone: effectiveCustomer.primaryPhone,
          primaryPhoneNormalized: keys.primaryPhoneNormalized,
          primaryEmail: effectiveCustomer.primaryEmail,
          primaryEmailNormalized: keys.primaryEmailNormalized,
          facebookId: customerInput.facebookId,
          taxId: effectiveCustomer.taxId,
          taxIdNormalized: normalizeTaxId(effectiveCustomer.taxId),
          accountingCounterpartyId: customerInput.accountingCounterpartyId,
          consentStatus: customerInput.consentStatus ?? 'UNKNOWN',
          consentNote: customerInput.consentNote,
          tier: customerInput.tier ?? 'LEAD',
          source: 'LEAD_CONVERSION',
          originSource: customerOriginFromLead(lead.source),
          createdByType: 'USER',
          notes: customerInput.notes,
          createdByUserId: ctx.userId,
        };
      customerDuplicateGuard = {
        keys,
        actorUserId: ctx.userId,
        canReadAll: canReadCustomerIdentity(ctx),
        duplicateOverride: customerInput.duplicateOverride,
      };
    }

    let result;
    try {
      result = await this.repo.convertLead({
        companyId: ctx.companyId,
        leadId: id,
        userId: ctx.userId,
        convertKey,
        customerData,
        customerDuplicateGuard,
        leadScope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles) },
        existingCustomerId: input.existingCustomerId,
        existingCustomerScope: input.existingCustomerId
          ? { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) }
          : undefined,
        opportunity,
      });
    } catch (e) {
      // Lost a concurrent conversion race — return the winner's existing result.
      if (e instanceof Error && e.message === 'lead_already_converted') return this.buildResult(ctx, id);
      if (e instanceof Error && ['lead_not_found', 'lead_out_of_scope', 'lead_status_changed'].includes(e.message)) {
        throwLeadMutationError(e);
      }
      if (e instanceof Error && e.message === 'lead_not_convertible') {
        throw new UnprocessableEntityException('Lead is not convertible');
      }
      throwCustomerMutationError(e);
    }

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.lead.convert', targetType: 'crm_lead', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { customerId: result.customer.id, opportunityId: result.opportunity?.id } });
    void this.outbox.append('crm.lead.converted', 'crm_lead', id, outbox(ctx, id, { customerId: result.customer.id, opportunityId: result.opportunity?.id }));
    if (result.opportunity) {
      void this.outbox.append('crm.opportunity.created', 'crm_opportunity', result.opportunity.id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'crm_opportunity', aggregateId: result.opportunity.id, occurredAt: new Date().toISOString(), data: { fromLeadId: id } });
    }

    return {
      lead: toLeadSummary(result.lead),
      customer: toCustomerSummary(result.customer),
      opportunity: result.opportunity ? toOpportunitySummary(result.opportunity) : undefined,
    };
  }

  private async buildResult(ctx: RequestContext, leadId: string): Promise<ConvertCrmLeadResult> {
    const lead = (await this.repo.findLeadById(ctx.companyId, leadId))!;
    const customer = lead.convertedCustomerId ? await this.repo.findCustomerById(ctx.companyId, lead.convertedCustomerId) : null;
    if (customer) assertCanManageOwned(ctx, customer.ownerUserId);
    const opportunity = lead.convertedOpportunityId ? await this.repo.findOpportunityById(ctx.companyId, lead.convertedOpportunityId) : null;
    return {
      lead: toLeadSummary(lead),
      customer: customer ? toCustomerSummary(customer) : (undefined as any),
      opportunity: opportunity ? toOpportunitySummary(opportunity) : undefined,
    };
  }
}
