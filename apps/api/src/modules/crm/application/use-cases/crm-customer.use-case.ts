import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  RequestContext,
  CreateCrmCustomerInput,
  UpdateCrmCustomerInput,
  ArchiveCrmCustomerInput,
  AssignCrmCustomerInput,
  ListCrmCustomersFilter,
  CreateCrmCustomerResult,
  UpdateCrmCustomerResult,
  CrmCustomerSummary,
  CrmCustomerDetail,
  CrmProjectedCustomerSummary,
  CrmProjectedCustomerDetail,
  CrmAccountingCustomerSummary,
  CrmAccountingCustomerDetail,
  CrmAccountingContactSummary,
  CrmDuplicateWarning,
  CrmCustomerOriginSource,
  MergeCrmCustomersInput,
  PreviewCrmCustomerMergeResult,
  MergeCrmCustomersResult,
  LinkCrmCustomerLineIdentityInput,
  LinkCrmCustomerLineIdentityResult,
  CrmCustomerMergeImpact,
  CreateCrmContactInput,
  UpdateCrmContactInput,
  CrmContactSummary,
} from '@watchdog-bms/contracts';
import { PrismaCrmRepository } from '../../infrastructure/prisma-crm.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { toCustomerSummary, toCustomerDetail, toContactSummary, toCustomerLineIdentitySummary } from '../dto/crm.mapper';
import { requirePermission, assertCanManageOwned } from '../crm-access';
import {
  normalizePhone,
  normalizeEmail,
  normalizeTaxId,
  normalizeName,
  scoreCustomerDuplicate,
  crmCanManageAll,
} from '../../domain/logic/crm.logic';
import type { CrmCustomerRecord, CrmContactRecord } from '../../domain/models/crm.model';

const PUBLIC_ORIGIN_SOURCES = new Set<CrmCustomerOriginSource>(['MANUAL', 'WALK_IN', 'PHONE', 'WEB', 'OTHER']);
export type CustomerAccessProfile = {
  operationalAll: boolean;
  operationalOwned: boolean;
  accountingAll: boolean;
  marketingAll: boolean;
};

/** Keep each role's row entitlement coupled to its projection. Mixed roles may
 * see richer fields only on rows independently authorized for that richness. */
export function customerAccessProfile(ctx: RequestContext): CustomerAccessProfile {
  return {
    operationalAll: ctx.roles.some((role) => ['OWNER', 'ADMIN', 'AUDITOR_READONLY', 'SYSTEM_ADMIN'].includes(role)),
    operationalOwned: ctx.roles.some((role) => role === 'SALES' || role === 'MANAGER'),
    accountingAll: ctx.roles.some((role) => role === 'FINANCE' || role === 'ACCOUNTANT'),
    marketingAll: ctx.roles.includes('MARKETING'),
  };
}

export function customerProjectionForRow(
  ctx: RequestContext,
  ownerUserId?: string,
  branchId?: string,
): 'OPERATIONAL' | 'ACCOUNTING_CONTACT' | 'MARKETING' | null {
  if (!isBranchInScope(ctx.scopes, branchId)) return null;
  const access = customerAccessProfile(ctx);
  if (access.operationalAll || (access.operationalOwned && ownerUserId === ctx.userId)) return 'OPERATIONAL';
  if (access.accountingAll) return 'ACCOUNTING_CONTACT';
  if (access.marketingAll) return 'MARKETING';
  // Unknown/custom roles fail closed to a pseudonymous projection of owned rows.
  return ownerUserId === ctx.userId ? 'MARKETING' : null;
}

export function canReadCustomerIdentity(ctx: RequestContext): boolean {
  return customerAccessProfile(ctx).operationalAll;
}

function accountingCustomer(summary: CrmCustomerSummary): CrmAccountingCustomerSummary {
  return {
    id: summary.id,
    code: summary.code,
    displayName: summary.displayName,
    legalName: summary.legalName,
    customerType: summary.customerType,
    status: summary.status,
    branchId: summary.branchId,
    accountingCounterpartyId: summary.accountingCounterpartyId,
    primaryPhone: summary.primaryPhone,
    primaryEmail: summary.primaryEmail,
    taxId: summary.taxId,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

export function projectCustomerSummaryForContext(
  summary: CrmCustomerSummary,
  marketingRef: string,
  ctx: RequestContext,
): CrmProjectedCustomerSummary {
  const projection = customerProjectionForRow(ctx, summary.ownerUserId, summary.branchId);
  if (!projection) throw new ForbiddenException('Record is out of scope');
  if (projection === 'OPERATIONAL') return { projection, customer: summary };
  if (projection === 'ACCOUNTING_CONTACT') return { projection, customer: accountingCustomer(summary) };
  return {
    projection,
    customer: {
      customerRef: marketingRef,
      status: summary.status,
      consentStatus: summary.consentStatus,
      originSource: summary.originSource,
      tier: summary.tier,
      segmentIds: [],
    },
  };
}

export function projectContactForContext(
  contact: CrmContactSummary,
  ctx: RequestContext,
  ownerUserId?: string,
  branchId?: string,
): CrmContactSummary | CrmAccountingContactSummary | null {
  const projection = customerProjectionForRow(ctx, ownerUserId, branchId);
  if (projection === 'OPERATIONAL') return contact;
  if (projection === 'MARKETING') return null;
  return {
    id: contact.id,
    customerId: contact.customerId,
    name: contact.name,
    role: contact.role,
    phone: contact.phone,
    email: contact.email,
    preferredChannel: contact.preferredChannel,
    isPrimary: contact.isPrimary,
    status: contact.status,
  };
}

export function projectCustomerDetailForContext(
  detail: CrmCustomerDetail,
  ctx: RequestContext,
): CrmProjectedCustomerDetail {
  const projection = customerProjectionForRow(ctx, detail.ownerUserId, detail.branchId);
  if (!projection) throw new ForbiddenException('Record is out of scope');
  if (projection === 'MARKETING') throw new ForbiddenException('customer_detail_not_permitted');
  if (projection === 'OPERATIONAL') return { projection, customer: detail };
  const projected: CrmAccountingCustomerDetail = {
    ...accountingCustomer(detail),
    contacts: detail.contacts.map((contact) => projectContactForContext(contact, ctx, detail.ownerUserId, detail.branchId) as CrmAccountingContactSummary),
  };
  return { projection, customer: projected };
}

function requireOperationalCustomerMutation(ctx: RequestContext): void {
  if (!ctx.roles.some((role) => ['OWNER', 'ADMIN', 'SALES', 'MANAGER', 'SYSTEM_ADMIN'].includes(role))) {
    throw new ForbiddenException('customer_mutation_not_permitted_for_projection');
  }
}

function assertCustomerRowReadable(ctx: RequestContext, ownerUserId?: string, branchId?: string): void {
  if (!customerProjectionForRow(ctx, ownerUserId, branchId)) {
    throw new ForbiddenException('Record is out of scope');
  }
}

function assertCustomerBranchInScope(ctx: RequestContext, branchId?: string): void {
  if (!isBranchInScope(ctx.scopes, branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope');
}

export function normalizedKeys(c: { taxId?: string; primaryEmail?: string; primaryPhone?: string; displayName: string }) {
  return {
    taxIdNormalized: normalizeTaxId(c.taxId),
    primaryEmailNormalized: normalizeEmail(c.primaryEmail),
    primaryPhoneNormalized: normalizePhone(c.primaryPhone),
    nameNormalized: normalizeName(c.displayName),
  };
}

function legacyOrigin(source?: string): CrmCustomerOriginSource {
  if (!source || source === 'MANUAL' || source === 'BOOKING_STAFF' || source === 'LEAD_CONVERSION') return 'MANUAL';
  if (source === 'LINE') return 'LINE';
  if (source === 'CSV_IMPORT') return 'IMPORT';
  if (source === 'BOOKING_BACKFILL' || source === 'BOOKING_WALK_IN') return 'WALK_IN';
  if (source === 'BOOKING_PHONE') return 'PHONE';
  if (source === 'BOOKING_WEB') return 'WEB';
  if (source === 'BOOKING_FACEBOOK') return 'FACEBOOK';
  return 'OTHER';
}

export function validateCustomerValues(input: Record<string, unknown>, displayName: unknown): void {
  if (typeof displayName !== 'string') throw new BadRequestException('displayName_must_be_string');
  const name = displayName.trim();
  if (!name) throw new BadRequestException('displayName_required');
  if (name.length > 160) throw new BadRequestException('displayName_too_long');
  boundedString(input['legalName'], 200, 'legalName');
  boundedString(input['code'], 64, 'code');
  boundedString(input['primaryPhone'], 40, 'primaryPhone');
  boundedString(input['primaryEmail'], 320, 'primaryEmail');
  boundedString(input['taxId'], 64, 'taxId');
  boundedString(input['notes'], 5_000, 'notes');
  boundedString(input['source'], 64, 'source');
  boundedString(input['facebookId'], 200, 'facebookId');
  boundedString(input['consentNote'], 2_000, 'consentNote');
  const phone = textValue(input['primaryPhone']);
  const normalizedPhone = normalizePhone(phone);
  if (phone && (!normalizedPhone || normalizedPhone.length < 8 || normalizedPhone.length > 15)) throw new BadRequestException('invalid_primaryPhone');
  const email = textValue(input['primaryEmail']);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('invalid_primaryEmail');
  const taxId = textValue(input['taxId']);
  const normalizedTaxId = normalizeTaxId(taxId);
  if (taxId && (!normalizedTaxId || normalizedTaxId.length < 5 || normalizedTaxId.length > 32)) throw new BadRequestException('invalid_taxId');
}

export function validateCustomerEnums(input: Record<string, unknown>): void {
  enumValue(input['customerType'], ['PERSON', 'ORGANIZATION', 'UNKNOWN'], 'customerType');
  enumValue(input['status'], ['ACTIVE', 'INACTIVE', 'ARCHIVED', 'MERGED'], 'status');
  enumValue(input['consentStatus'], ['UNKNOWN', 'GRANTED', 'REVOKED', 'NOT_REQUIRED'], 'consentStatus');
  enumValue(input['tier'], ['VIP', 'ACTIVE', 'LEAD'], 'tier');
  if (input['duplicateOverride'] !== undefined && typeof input['duplicateOverride'] !== 'boolean') throw new BadRequestException('invalid_duplicateOverride');
}

function enumValue(value: unknown, allowed: string[], field: string): void {
  if (value !== undefined && (typeof value !== 'string' || !allowed.includes(value))) throw new BadRequestException(`invalid_${field}`);
}

function boundedString(value: unknown, max: number, field: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') throw new BadRequestException(`${field}_must_be_string`);
  if (value.length > max) throw new BadRequestException(`${field}_too_long`);
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text || undefined;
}

export function enforceDuplicatePolicy(warnings: CrmDuplicateWarning[], override?: boolean): void {
  if (warnings.some((warning) => warning.matchType === 'TAX_ID')) {
    throw new UnprocessableEntityException({ code: 'duplicate_tax_id', warnings });
  }
  const exactCandidates = warnings.filter((warning) => warning.matchType === 'PHONE' || warning.matchType === 'EMAIL');
  if (exactCandidates.some((warning) => warning.redacted)) {
    throw new ConflictException({ code: 'duplicate_candidate_requires_manager_review', warnings: exactCandidates });
  }
  if (exactCandidates.length > 0 && override !== true) {
    throw new ConflictException({ code: 'duplicate_customer_candidate', warnings: exactCandidates });
  }
}

export async function validateCustomerReferences(
  repo: PrismaCrmRepository,
  companyId: string,
  input: { branchId?: string; ownerUserId?: string; accountingCounterpartyId?: string },
  scopes?: RequestContext['scopes'],
): Promise<void> {
  const branchId = validatedId(input.branchId, 'branchId');
  const ownerUserId = validatedId(input.ownerUserId, 'ownerUserId');
  const counterpartyId = validatedId(input.accountingCounterpartyId, 'accountingCounterpartyId');
  if (branchId && scopes && !isBranchInScope(scopes, branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope');
  if (branchId && !(await repo.hasActiveBranch(companyId, branchId))) throw new BadRequestException('branch_not_active_in_company');
  if (ownerUserId && !(await repo.hasActiveCompanyMember(companyId, ownerUserId))) throw new BadRequestException('owner_not_active_company_member');
  if (counterpartyId && !(await repo.hasActiveAccountingCounterparty(companyId, counterpartyId))) {
    throw new BadRequestException('accounting_counterparty_not_active_in_company');
  }
}

function validatedId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new BadRequestException(`invalid_${field}`);
  return value.trim();
}

function validateContactInput(input: Record<string, unknown>, create: boolean): void {
  if (create && input['status'] !== undefined) throw new BadRequestException('status_not_allowed_on_create');
  if (input['name'] !== undefined) {
    if (typeof input['name'] !== 'string') throw new BadRequestException('name_must_be_string');
    if (!input['name'].trim()) throw new BadRequestException('name_required');
    if (input['name'].length > 160) throw new BadRequestException('name_too_long');
  } else if (create) {
    throw new BadRequestException('name_required');
  }
  boundedString(input['role'], 160, 'role');
  boundedString(input['phone'], 40, 'phone');
  boundedString(input['email'], 320, 'email');
  boundedString(input['note'], 2_000, 'note');
  const phone = textValue(input['phone']);
  const normalizedPhone = normalizePhone(phone);
  if (phone && (!normalizedPhone || normalizedPhone.length < 8 || normalizedPhone.length > 15)) throw new BadRequestException('invalid_phone');
  const email = textValue(input['email']);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('invalid_email');
  enumValue(input['preferredChannel'], ['PHONE', 'LINE', 'EMAIL', 'FACEBOOK', 'MARKETPLACE_CHAT', 'VISIT', 'OTHER'], 'preferredChannel');
  enumValue(input['consentStatus'], ['UNKNOWN', 'GRANTED', 'REVOKED', 'NOT_REQUIRED'], 'consentStatus');
  enumValue(input['status'], ['ACTIVE', 'ARCHIVED'], 'status');
  if (input['isPrimary'] !== undefined && typeof input['isPrimary'] !== 'boolean') throw new BadRequestException('invalid_isPrimary');
}

function requiredReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException('reason_required');
  const reason = value.trim();
  if (reason.length > 500) throw new BadRequestException('reason_too_long');
  return reason;
}

function validateCustomerListFilter(filter: ListCrmCustomersFilter): void {
  if (filter.scope !== undefined && filter.scope !== 'own' && filter.scope !== 'all') throw new BadRequestException('invalid_scope');
  if (filter.status !== undefined && !['ACTIVE', 'INACTIVE', 'ARCHIVED', 'MERGED'].includes(filter.status)) throw new BadRequestException('invalid_status');
  if (filter.tier !== undefined && !['VIP', 'ACTIVE', 'LEAD'].includes(filter.tier)) throw new BadRequestException('invalid_tier');
  if (filter.sortBy !== undefined && filter.sortBy !== 'updatedAt' && filter.sortBy !== 'ltv') throw new BadRequestException('invalid_sortBy');
  if (filter.search !== undefined && (typeof filter.search !== 'string' || filter.search.length > 160)) throw new BadRequestException('invalid_search');
  if (filter.ownerUserId !== undefined) validatedId(filter.ownerUserId, 'ownerUserId');
  for (const [key, value] of [['page', filter.page], ['pageSize', filter.pageSize]] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new BadRequestException(`invalid_${key}`);
  }
}

@Injectable()
export class CreateCrmCustomerUseCase {
  constructor(private readonly repo: PrismaCrmRepository, _audit: AuditService, _outbox: OutboxAppendService) {}

  async execute(ctx: RequestContext, input: CreateCrmCustomerInput): Promise<CreateCrmCustomerResult> {
    requirePermission(ctx, 'crm.customer.create');
    requireOperationalCustomerMutation(ctx);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('invalid_customer_input');
    const rawInput = input as unknown as Record<string, unknown>;
    if (rawInput['lineUserId'] !== undefined) throw new BadRequestException('line_identity_link_required');
    if (rawInput['status'] !== undefined) throw new BadRequestException('status_not_allowed_on_create');
    validateCustomerValues(rawInput, rawInput['displayName']);
    validateCustomerEnums(rawInput);
    if (input.originSource && input.source && legacyOrigin(input.source) !== input.originSource) {
      throw new BadRequestException('contradictory_customer_provenance');
    }
    const originSource = input.originSource ?? legacyOrigin(input.source);
    if (!PUBLIC_ORIGIN_SOURCES.has(originSource)) throw new BadRequestException('originSource_requires_trusted_ingestion');
    if (input.tier !== undefined && !['VIP', 'ACTIVE', 'LEAD'].includes(input.tier)) throw new BadRequestException('invalid_tier');
    const createdByType = input.createdByType ?? 'USER';
    if (createdByType !== 'USER' && createdByType !== 'AI_ASSISTED') throw new BadRequestException('invalid_createdByType');
    if (createdByType === 'AI_ASSISTED') requirePermission(ctx, 'crm.ai.assist');
    if (input.ownerUserId !== undefined && input.ownerUserId !== ctx.userId) requirePermission(ctx, 'crm.customer.assign');
    await validateCustomerReferences(this.repo, ctx.companyId, input, ctx.scopes);

    const keys = normalizedKeys(input);
    const candidates = await this.repo.findDuplicateCustomers(ctx.companyId, keys);
    const warnings = buildDuplicateWarnings(keys, candidates, ctx);
    enforceDuplicatePolicy(warnings, input.duplicateOverride);

    let created: CrmCustomerRecord;
    try {
      created = await this.repo.createCustomer({
        companyId: ctx.companyId,
        branchId: textValue(input.branchId),
        code: textValue(input.code),
        displayName: input.displayName.trim(),
        displayNameNormalized: keys.nameNormalized,
        legalName: textValue(input.legalName),
        customerType: input.customerType ?? 'UNKNOWN',
        ownerUserId: textValue(input.ownerUserId) ?? ctx.userId,
        primaryPhone: textValue(input.primaryPhone),
        primaryPhoneNormalized: keys.primaryPhoneNormalized,
        primaryEmail: textValue(input.primaryEmail),
        primaryEmailNormalized: keys.primaryEmailNormalized,
        facebookId: textValue(input.facebookId),
        taxId: textValue(input.taxId),
        taxIdNormalized: keys.taxIdNormalized,
        accountingCounterpartyId: textValue(input.accountingCounterpartyId),
        consentStatus: input.consentStatus ?? 'UNKNOWN',
        consentNote: textValue(input.consentNote),
        tier: input.tier ?? 'LEAD',
        source: originSource,
        originSource,
        createdByType,
        notes: textValue(input.notes),
        createdByUserId: ctx.userId,
      }, {
        keys,
        actorUserId: ctx.userId,
        canReadAll: canReadCustomerIdentity(ctx),
        duplicateOverride: input.duplicateOverride,
      }, {
        actorUserId: ctx.userId,
        requestId: ctx.requestId,
        action: 'crm.customer.create',
        eventType: 'crm.customer.created',
        operationKey: 'create',
        riskLevel: 'LOW',
        data: {
          originSource,
          createdByType,
          duplicateOverride: input.duplicateOverride === true,
          duplicateCandidates: warnings.slice(0, 20).map(({ customerId, matchType, confidence }) => ({ customerId, matchType, confidence })),
        },
      });
    } catch (error) {
      throwCustomerMutationError(error);
    }
    return { customer: toCustomerSummary(created), duplicateWarnings: warnings };
  }
}

@Injectable()
export class UpdateCrmCustomerUseCase {
  constructor(private readonly repo: PrismaCrmRepository, _audit: AuditService, _outbox: OutboxAppendService) {}

  async execute(ctx: RequestContext, id: string, input: UpdateCrmCustomerInput): Promise<UpdateCrmCustomerResult> {
    requirePermission(ctx, 'crm.customer.update');
    requireOperationalCustomerMutation(ctx);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('invalid_customer_input');
    const existing = await this.repo.findCustomerById(ctx.companyId, id);
    if (!existing) throw new NotFoundException('Customer not found');
    assertCanManageOwned(ctx, existing.ownerUserId);
    assertCustomerBranchInScope(ctx, existing.branchId);
    if (existing.status === 'MERGED' || existing.status === 'ARCHIVED') throw new UnprocessableEntityException('Customer is not editable');
    const rawInput = input as unknown as Record<string, unknown>;
    if (rawInput['lineUserId'] !== undefined) throw new BadRequestException('line_identity_link_required');
    if (rawInput['originSource'] !== undefined || rawInput['createdByType'] !== undefined || rawInput['source'] !== undefined) {
      throw new BadRequestException('customer_provenance_is_immutable');
    }
    validateCustomerEnums(rawInput);
    const proposed = {
      displayName: input.displayName ?? existing.displayName,
      primaryPhone: input.primaryPhone !== undefined ? input.primaryPhone : existing.primaryPhone,
      primaryEmail: input.primaryEmail !== undefined ? input.primaryEmail : existing.primaryEmail,
      taxId: input.taxId !== undefined ? input.taxId : existing.taxId,
    };
    validateCustomerValues({ ...rawInput, ...proposed }, proposed.displayName);
    if (input.status === 'ARCHIVED' || input.status === 'MERGED') throw new BadRequestException('use_customer_archive_or_merge_action');
    if (input.ownerUserId !== undefined && input.ownerUserId !== existing.ownerUserId) requirePermission(ctx, 'crm.customer.assign');
    await validateCustomerReferences(this.repo, ctx.companyId, input, ctx.scopes);
    const keys = normalizedKeys(proposed);
    const existingKeys = normalizedKeys(existing);
    const identityChanged = (Object.keys(keys) as Array<keyof typeof keys>).some((key) => keys[key] !== existingKeys[key]);
    const warnings = identityChanged
      ? buildDuplicateWarnings(keys, await this.repo.findDuplicateCustomers(ctx.companyId, keys, id), ctx)
      : [];
    if (identityChanged) enforceDuplicatePolicy(warnings, input.duplicateOverride);

    const data: Record<string, unknown> = { updatedByUserId: ctx.userId };
    if (input.displayName !== undefined) {
      data.displayName = input.displayName.trim();
      data.displayNameNormalized = keys.nameNormalized;
    }
    if (input.branchId !== undefined) data.branchId = textValue(input.branchId);
    if (input.legalName !== undefined) data.legalName = textValue(input.legalName) ?? null;
    if (input.customerType !== undefined) data.customerType = input.customerType;
    if (input.status !== undefined) data.status = input.status;
    if (input.ownerUserId !== undefined) data.ownerUserId = textValue(input.ownerUserId);
    if (input.primaryPhone !== undefined) {
      data.primaryPhone = textValue(input.primaryPhone) ?? null;
      data.primaryPhoneNormalized = normalizePhone(input.primaryPhone);
    }
    if (input.primaryEmail !== undefined) {
      data.primaryEmail = textValue(input.primaryEmail) ?? null;
      data.primaryEmailNormalized = normalizeEmail(input.primaryEmail);
    }
    if (input.taxId !== undefined) {
      data.taxId = textValue(input.taxId) ?? null;
      data.taxIdNormalized = normalizeTaxId(input.taxId);
    }
    if (input.facebookId !== undefined) data.facebookId = textValue(input.facebookId) ?? null;
    if (input.accountingCounterpartyId !== undefined) data.accountingCounterpartyId = textValue(input.accountingCounterpartyId);
    if (input.notes !== undefined) data.notes = textValue(input.notes) ?? null;
    if (input.consentStatus !== undefined) {
      data.consentStatus = input.consentStatus;
      data.consentUpdatedAt = new Date();
    }
    if (input.consentNote !== undefined) data.consentNote = textValue(input.consentNote) ?? null;
    if (input.tier !== undefined) data.tier = input.tier;

    let updated: CrmCustomerRecord;
    try {
      updated = await this.repo.updateCustomer(ctx.companyId, id, data, identityChanged ? {
        keys,
        actorUserId: ctx.userId,
        canReadAll: canReadCustomerIdentity(ctx),
        duplicateOverride: input.duplicateOverride,
        excludeCustomerId: id,
      } : undefined, {
        actorUserId: ctx.userId,
        canManageAll: crmCanManageAll(ctx.roles),
        ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}),
        ...(input.ownerUserId !== undefined && input.ownerUserId !== existing.ownerUserId
          ? { reassignedOwnerUserId: textValue(input.ownerUserId) }
          : {}),
      }, {
        actorUserId: ctx.userId,
        requestId: ctx.requestId,
        action: 'crm.customer.update',
        eventType: 'crm.customer.updated',
        operationKey: 'update',
        riskLevel: 'LOW',
        data: {
          consentChanged: input.consentStatus !== undefined,
          originSource: existing.originSource,
          createdByType: existing.createdByType,
          duplicateOverride: input.duplicateOverride === true,
          duplicateCandidates: warnings.slice(0, 20).map(({ customerId, matchType, confidence }) => ({ customerId, matchType, confidence })),
        },
      });
    } catch (error) {
      throwCustomerMutationError(error);
    }
    return { ...toCustomerSummary(updated), duplicateWarnings: warnings };
  }
}

@Injectable()
export class GetCrmCustomerUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, id: string): Promise<CrmProjectedCustomerDetail> {
    requirePermission(ctx, 'crm.customer.read');
    const c = await this.repo.findCustomerById(ctx.companyId, id, true);
    if (!c) throw new NotFoundException('Customer not found');
    assertCustomerRowReadable(ctx, c.ownerUserId, c.branchId);
    return projectCustomerDetailForContext(toCustomerDetail(c), ctx);
  }
}

@Injectable()
export class ListCrmCustomersUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, filter: ListCrmCustomersFilter) {
    requirePermission(ctx, 'crm.customer.read');
    validateCustomerListFilter(filter);
    const access = customerAccessProfile(ctx);
    const hasAllRows = access.operationalAll || access.accountingAll || access.marketingAll;
    const canFilterOwner = access.operationalAll || access.operationalOwned;
    if ((filter.ownerUserId !== undefined || filter.scope === 'own') && !canFilterOwner) {
      throw new ForbiddenException('customer_owner_filter_not_permitted_for_projection');
    }
    if (filter.ownerUserId !== undefined && !access.operationalAll && hasAllRows && filter.ownerUserId !== ctx.userId) {
      throw new ForbiddenException('customer_owner_filter_not_permitted_for_projection');
    }
    const onlyOperationalRows = access.operationalAll
      || (access.operationalOwned && (!hasAllRows || filter.scope === 'own' || filter.ownerUserId === ctx.userId));
    if (filter.sortBy === 'ltv' && !onlyOperationalRows) {
      throw new ForbiddenException('customer_ltv_sort_not_permitted_for_projection');
    }
    const ownedOperationalSearch = Boolean(filter.search && !access.operationalAll && !access.accountingAll && access.operationalOwned);
    if (filter.search && !access.operationalAll && !access.accountingAll && !access.operationalOwned) {
      throw new ForbiddenException('customer_search_not_permitted');
    }
    const ownerUserId = filter.scope === 'own' || !hasAllRows || ownedOperationalSearch
      ? ctx.userId
      : textValue(filter.ownerUserId);
    const result = await this.repo.listCustomers({
      companyId: ctx.companyId,
      ownerUserId,
      ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}),
      status: filter.status,
      tier: filter.tier,
      search: filter.search,
      sortBy: filter.sortBy,
      page: filter.page,
      pageSize: filter.pageSize,
    });
    return {
      ...result,
      items: result.items.map((customer) => projectCustomerSummaryForContext(toCustomerSummary(customer), customer.marketingRef, ctx)),
    };
  }
}

@Injectable()
export class GetCrmCustomerSummaryUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}

  /** `newUntil` (exclusive-of-nothing: the instant the window ENDS, inclusive) closes the
   *  new-customer window. Omitted, the window runs to now, exactly as it always did. */
  async execute(ctx: RequestContext, newSince: Date, newUntil?: Date) {
    requirePermission(ctx, 'crm.customer.read');
    const access = customerAccessProfile(ctx);
    const hasAllRows = access.operationalAll || access.accountingAll || access.marketingAll;
    return this.repo.summarizeCustomers({
      companyId: ctx.companyId,
      ...(!hasAllRows && { ownerUserId: ctx.userId }),
      ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}),
      newSince,
      ...(newUntil ? { newUntil } : {}),
    });
  }
}

@Injectable()
export class ArchiveCrmCustomerUseCase {
  constructor(private readonly repo: PrismaCrmRepository, _audit: AuditService, _outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, id: string, input: ArchiveCrmCustomerInput): Promise<CrmCustomerSummary> {
    requirePermission(ctx, 'crm.customer.archive');
    requireOperationalCustomerMutation(ctx);
    const reason = requiredReason(input?.reason);
    if (input.override !== undefined && typeof input.override !== 'boolean') throw new BadRequestException('invalid_override');
    const c = await this.repo.findCustomerById(ctx.companyId, id);
    if (!c) throw new NotFoundException('Customer not found');
    assertCanManageOwned(ctx, c.ownerUserId);
    assertCustomerBranchInScope(ctx, c.branchId);
    if (c.status === 'ARCHIVED' || c.status === 'MERGED') throw new UnprocessableEntityException('Customer cannot be archived');

    let archiveResult;
    try {
      archiveResult = await this.repo.archiveCustomer({
        companyId: ctx.companyId,
        customerId: id,
        userId: ctx.userId,
        reason,
        override: input.override === true,
        scope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) },
        evidence: {
          actorUserId: ctx.userId,
          requestId: ctx.requestId,
          action: 'crm.customer.archive',
          eventType: 'crm.customer.archived',
          operationKey: 'archive',
          riskLevel: 'MEDIUM',
          reason,
          data: { reasonProvided: true, override: input.override === true },
        },
      });
    } catch (error) {
      throwCustomerMutationError(error);
    }
    if (!archiveResult.customer) {
      throw new UnprocessableEntityException({
        code: 'active_work_blocks_archive',
        openOpportunities: archiveResult.openOpportunities,
        openFollowUps: archiveResult.openFollowUps,
      });
    }
    const updated = archiveResult.customer;
    return toCustomerSummary(updated);
  }
}

@Injectable()
export class AssignCrmCustomerUseCase {
  constructor(private readonly repo: PrismaCrmRepository, _audit: AuditService, _outbox: OutboxAppendService) {}
  async execute(ctx: RequestContext, id: string, input: AssignCrmCustomerInput): Promise<CrmCustomerSummary> {
    requirePermission(ctx, 'crm.customer.assign');
    requireOperationalCustomerMutation(ctx);
    const ownerUserId = validatedId(input?.ownerUserId, 'ownerUserId');
    if (!ownerUserId) throw new BadRequestException('ownerUserId_required');
    if (!(await this.repo.hasActiveCompanyMember(ctx.companyId, ownerUserId))) throw new BadRequestException('owner_not_active_company_member');
    const c = await this.repo.findCustomerById(ctx.companyId, id);
    if (!c) throw new NotFoundException('Customer not found');
    assertCanManageOwned(ctx, c.ownerUserId);
    assertCustomerBranchInScope(ctx, c.branchId);
    if (c.status === 'ARCHIVED' || c.status === 'MERGED') throw new UnprocessableEntityException('Customer cannot be assigned');
    let updated: CrmCustomerRecord;
    try {
      updated = await this.repo.updateCustomer(
        ctx.companyId,
        id,
        { ownerUserId, updatedByUserId: ctx.userId },
        undefined,
        { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}), reassignedOwnerUserId: ownerUserId },
        {
          actorUserId: ctx.userId,
          requestId: ctx.requestId,
          action: 'crm.customer.assign',
          eventType: 'crm.customer.assigned',
          operationKey: 'assign',
          riskLevel: 'MEDIUM',
          data: { ownerUserId },
        },
      );
    } catch (error) {
      throwCustomerMutationError(error);
    }
    return toCustomerSummary(updated);
  }
}

@Injectable()
export class PreviewCrmCustomerMergeUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}

  async execute(ctx: RequestContext, input: MergeCrmCustomersInput): Promise<PreviewCrmCustomerMergeResult> {
    requireCustomerMergeAuthority(ctx);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('invalid_merge_input');
    requiredReason(input.reason);
    assertDistinctCustomers(input);
    const [primary, secondary] = await Promise.all([
      this.repo.findCustomerById(ctx.companyId, input.primaryCustomerId),
      this.repo.findCustomerById(ctx.companyId, input.secondaryCustomerId),
    ]);
    if (!primary || !secondary) throw new NotFoundException('Customer not found');
    assertCustomerBranchInScope(ctx, primary.branchId);
    assertCustomerBranchInScope(ctx, secondary.branchId);
    const retry = secondary.status === 'MERGED' && secondary.mergedIntoCustomerId === primary.id;
    const conflicts = retry ? [] : mergeConflicts(primary, secondary);
    const impact = retry ? zeroImpact() : await this.repo.customerMergeImpact(ctx.companyId, secondary.id);
    return {
      primary: toCustomerSummary(primary),
      secondary: toCustomerSummary(secondary),
      impact,
      conflicts,
      canMerge: conflicts.length === 0,
    };
  }
}

@Injectable()
export class MergeCrmCustomersUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly _audit: AuditService, private readonly _outbox: OutboxAppendService) {}

  async execute(ctx: RequestContext, input: MergeCrmCustomersInput): Promise<MergeCrmCustomersResult> {
    requireCustomerMergeAuthority(ctx);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('invalid_merge_input');
    assertDistinctCustomers(input);
    const reason = requiredReason(input.reason);
    const [primary, secondary] = await Promise.all([
      this.repo.findCustomerById(ctx.companyId, input.primaryCustomerId),
      this.repo.findCustomerById(ctx.companyId, input.secondaryCustomerId),
    ]);
    if (!primary || !secondary) throw new NotFoundException('Customer not found');
    assertCustomerBranchInScope(ctx, primary.branchId);
    assertCustomerBranchInScope(ctx, secondary.branchId);
    const retry = secondary.status === 'MERGED' && secondary.mergedIntoCustomerId === primary.id;
    const conflicts = retry ? [] : mergeConflicts(primary, secondary);
    if (conflicts.length > 0) throw new ConflictException({ code: 'customer_merge_conflict', conflicts });

    let result;
    try {
      result = await this.repo.mergeCustomers({
        companyId: ctx.companyId,
        primaryCustomerId: primary.id,
        secondaryCustomerId: secondary.id,
        userId: ctx.userId,
        ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}),
        evidence: { requestId: ctx.requestId, reason },
      });
    } catch (error) {
      throwCustomerMutationError(error);
    }
    return { customer: toCustomerSummary(result.customer), mergedCustomerId: secondary.id, impact: result.impact };
  }
}

@Injectable()
export class LinkCrmCustomerLineIdentityUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly _audit: AuditService, private readonly _outbox: OutboxAppendService) {}

  async execute(
    ctx: RequestContext,
    customerId: string,
    identityId: string,
    input: LinkCrmCustomerLineIdentityInput,
  ): Promise<LinkCrmCustomerLineIdentityResult> {
    requireCustomerMergeAuthority(ctx);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('invalid_line_identity_link_input');
    const reason = requiredReason(input.reason);
    const validatedCustomerId = validatedId(customerId, 'customerId');
    const validatedIdentityId = validatedId(identityId, 'identityId');
    if (!validatedCustomerId || !validatedIdentityId) throw new BadRequestException('customer_and_identity_ids_required');
    const expectedCurrentCustomerId = validatedId(input.expectedCurrentCustomerId, 'expectedCurrentCustomerId');
    if (!expectedCurrentCustomerId) throw new BadRequestException('expectedCurrentCustomerId_required');
    const [targetCustomer, currentCustomer] = await Promise.all([
      this.repo.findCustomerById(ctx.companyId, validatedCustomerId),
      this.repo.findCustomerById(ctx.companyId, expectedCurrentCustomerId),
    ]);
    if (!targetCustomer || !currentCustomer) throw new NotFoundException('Customer not found');
    assertCustomerBranchInScope(ctx, targetCustomer.branchId);
    assertCustomerBranchInScope(ctx, currentCustomer.branchId);
    let result;
    try {
      result = await this.repo.linkLineIdentity({
        companyId: ctx.companyId,
        customerId: validatedCustomerId,
        identityId: validatedIdentityId,
        expectedCurrentCustomerId,
        userId: ctx.userId,
        ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}),
        evidence: { requestId: ctx.requestId, reason },
      });
    } catch (error) {
      throwCustomerMutationError(error);
    }
    return {
      customer: toCustomerSummary(result.customer),
      identity: toCustomerLineIdentitySummary(result.identity),
      previousCustomerId: result.previousCustomerId,
    };
  }
}

// ---- Contacts ----

@Injectable()
export class ListCrmContactsUseCase {
  constructor(private readonly repo: PrismaCrmRepository) {}
  async execute(ctx: RequestContext, customerId: string): Promise<Array<CrmContactSummary | CrmAccountingContactSummary>> {
    requirePermission(ctx, 'crm.contact.read');
    const c = await this.repo.findCustomerById(ctx.companyId, customerId);
    if (!c) throw new NotFoundException('Customer not found');
    assertCustomerRowReadable(ctx, c.ownerUserId, c.branchId);
    if (customerProjectionForRow(ctx, c.ownerUserId, c.branchId) === 'MARKETING') {
      throw new ForbiddenException('customer_contact_not_permitted');
    }
    const rows = await this.repo.listContacts(ctx.companyId, customerId);
    return rows.map(toContactSummary)
      .map((contact) => projectContactForContext(contact, ctx, c.ownerUserId, c.branchId))
      .filter((contact): contact is CrmContactSummary | CrmAccountingContactSummary => contact !== null);
  }
}

@Injectable()
export class CreateCrmContactUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, customerId: string, input: CreateCrmContactInput): Promise<CrmContactSummary> {
    requirePermission(ctx, 'crm.contact.manage');
    requireOperationalCustomerMutation(ctx);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('invalid_contact_input');
    const rawInput = input as unknown as Record<string, unknown>;
    if (rawInput['lineUserId'] !== undefined) throw new BadRequestException('line_identity_link_required');
    validateContactInput(rawInput, true);
    const c = await this.repo.findCustomerById(ctx.companyId, customerId);
    if (!c) throw new NotFoundException('Customer not found');
    assertCanManageOwned(ctx, c.ownerUserId);
    assertCustomerBranchInScope(ctx, c.branchId);
    let created: CrmContactRecord;
    try {
      created = await this.repo.createContact({
        companyId: ctx.companyId,
        customerId,
        name: input.name.trim(),
        role: textValue(input.role),
        phone: textValue(input.phone),
        phoneNormalized: normalizePhone(input.phone),
        email: textValue(input.email),
        emailNormalized: normalizeEmail(input.email),
        preferredChannel: input.preferredChannel,
        consentStatus: input.consentStatus ?? 'UNKNOWN',
        isPrimary: input.isPrimary ?? false,
        note: textValue(input.note),
        createdByUserId: ctx.userId,
      }, { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) });
    } catch (error) {
      throwCustomerMutationError(error);
    }
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.contact.create',
      targetType: 'crm_contact', targetId: created.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });
    return toContactSummary(created);
  }
}

@Injectable()
export class UpdateCrmContactUseCase {
  constructor(private readonly repo: PrismaCrmRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, id: string, input: UpdateCrmContactInput): Promise<CrmContactSummary> {
    requirePermission(ctx, 'crm.contact.manage');
    requireOperationalCustomerMutation(ctx);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('invalid_contact_input');
    const rawInput = input as unknown as Record<string, unknown>;
    if (rawInput['lineUserId'] !== undefined) throw new BadRequestException('line_identity_link_required');
    validateContactInput(rawInput, false);
    const contact = await this.repo.findContactById(ctx.companyId, id);
    if (!contact) throw new NotFoundException('Contact not found');
    const customer = await this.repo.findCustomerById(ctx.companyId, contact.customerId);
    assertCanManageOwned(ctx, customer?.ownerUserId);
    assertCustomerBranchInScope(ctx, customer?.branchId);

    const data: Record<string, unknown> = { updatedByUserId: ctx.userId };
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.role !== undefined) data.role = textValue(input.role) ?? null;
    if (input.phone !== undefined) {
      data.phone = textValue(input.phone) ?? null;
      data.phoneNormalized = normalizePhone(input.phone) ?? null;
    }
    if (input.email !== undefined) {
      data.email = textValue(input.email) ?? null;
      data.emailNormalized = normalizeEmail(input.email) ?? null;
    }
    if (input.preferredChannel !== undefined) data.preferredChannel = input.preferredChannel;
    if (input.consentStatus !== undefined) data.consentStatus = input.consentStatus;
    if (input.isPrimary !== undefined) data.isPrimary = input.isPrimary;
    if (input.note !== undefined) data.note = textValue(input.note) ?? null;
    if (input.status !== undefined) data.status = input.status;

    let updated: CrmContactRecord;
    try {
      updated = await this.repo.updateContact(ctx.companyId, id, data, {
        expectedCustomerId: contact.customerId,
        scope: { actorUserId: ctx.userId, canManageAll: crmCanManageAll(ctx.roles), ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}) },
      });
    } catch (error) {
      throwCustomerMutationError(error);
    }
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.contact.update',
      targetType: 'crm_contact', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { consentChanged: input.consentStatus !== undefined },
    });
    return toContactSummary(updated);
  }
}

// ---- Shared helpers ----

function assertDistinctCustomers(input: MergeCrmCustomersInput): void {
  if (typeof input.primaryCustomerId !== 'string' || !input.primaryCustomerId.trim() || typeof input.secondaryCustomerId !== 'string' || !input.secondaryCustomerId.trim()) {
    throw new BadRequestException('customer_ids_required');
  }
  if (input.primaryCustomerId === input.secondaryCustomerId) throw new BadRequestException('cannot_merge_customer_into_itself');
}

function requireCustomerMergeAuthority(ctx: RequestContext): void {
  requirePermission(ctx, 'crm.customer.merge');
  if (!ctx.roles.some((role) => role === 'OWNER' || role === 'ADMIN')) throw new ForbiddenException('Customer merge requires Owner or Admin role');
}

function mergeConflicts(primary: CrmCustomerRecord, secondary: CrmCustomerRecord): string[] {
  const conflicts: string[] = [];
  if (primary.status !== 'ACTIVE') conflicts.push('primary_customer_not_active');
  if (secondary.status === 'MERGED') conflicts.push('secondary_already_merged');
  if (primary.taxIdNormalized && secondary.taxIdNormalized && primary.taxIdNormalized !== secondary.taxIdNormalized) conflicts.push('tax_id_conflict');
  if (primary.accountingCounterpartyId && secondary.accountingCounterpartyId && primary.accountingCounterpartyId !== secondary.accountingCounterpartyId) {
    conflicts.push('accounting_counterparty_conflict');
  }
  return conflicts;
}

function zeroImpact(): CrmCustomerMergeImpact {
  return {
    bookings: 0, contacts: 0, opportunities: 0, activities: 0, followUps: 0,
    quotationLinks: 0, convertedLeads: 0, lineIdentities: 0, conversations: 0,
  };
}

export function throwCustomerMutationError(error: unknown): never {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'customer_not_found' || code === 'line_identity_not_found' || code === 'existing_customer_not_found' || code === 'contact_not_found') throw new NotFoundException(code);
  if (code === 'existing_customer_out_of_scope' || code === 'customer_out_of_scope') throw new ForbiddenException('Record is out of scope');
  if (code === 'customer_owner_reassignment_not_authorized') throw new ForbiddenException('Customer owner reassignment is not authorized');
  if (code === 'owner_not_active_company_member' || code === 'branch_not_active_in_company') throw new BadRequestException(code);
  if (code === 'archive_override_forbidden') throw new ForbiddenException('Archive override requires Owner or Admin role');
  if (code === 'duplicate_tax_id') throw new UnprocessableEntityException({ code });
  if ([
    'customer_already_merged_elsewhere', 'primary_customer_not_active', 'tax_id_conflict',
    'accounting_counterparty_conflict', 'line_identity_changed', 'customer_not_active',
    'target_line_identity_conflict', 'duplicate_candidate_requires_manager_review',
    'duplicate_customer_candidate', 'existing_customer_not_active', 'contact_customer_changed',
  ].includes(code)) throw new ConflictException({ code });
  if (code === 'customer_not_editable') throw new UnprocessableEntityException({ code });
  throw error;
}

export function buildDuplicateWarnings(
  keys: { taxIdNormalized?: string; primaryEmailNormalized?: string; primaryPhoneNormalized?: string; nameNormalized?: string },
  candidates: CrmCustomerRecord[],
  ctx: RequestContext,
): CrmDuplicateWarning[] {
  const warnings: CrmDuplicateWarning[] = [];
  for (const cand of candidates) {
    const match = scoreCustomerDuplicate(keys, {
      taxIdNormalized: cand.taxIdNormalized,
      primaryEmailNormalized: cand.primaryEmailNormalized,
      primaryPhoneNormalized: cand.primaryPhoneNormalized,
      nameNormalized: normalizeName(cand.displayName),
    });
    if (match && (cand.status === 'ACTIVE' || cand.status === 'INACTIVE')) {
      const candidateProjection = customerProjectionForRow(ctx, cand.ownerUserId, cand.branchId);
      const visible = candidateProjection !== null && candidateProjection !== 'MARKETING';
      if (!visible) {
        if (match.matchType !== 'NAME' && !warnings.some((warning) => warning.redacted && warning.matchType === match.matchType)) {
          warnings.push({ customerId: 'REDACTED', displayName: 'ลูกค้าที่มีอยู่', redacted: true, matchType: match.matchType, confidence: match.confidence });
        }
        continue;
      }
      warnings.push({ customerId: cand.id, displayName: cand.displayName, status: cand.status, matchType: match.matchType, confidence: match.confidence });
    }
  }
  return warnings;
}

function outboxPayload(ctx: RequestContext, aggregateId: string, data: Record<string, unknown>) {
  return {
    companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
    aggregateType: 'crm_customer', aggregateId, occurredAt: new Date().toISOString(), data,
  };
}
