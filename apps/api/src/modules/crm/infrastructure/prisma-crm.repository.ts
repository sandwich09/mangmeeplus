import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type {
  CrmCustomerRecord,
  CrmContactRecord,
  CrmLeadRecord,
  CrmPipelineStageRecord,
  CrmOpportunityRecord,
  CrmActivityRecord,
  CrmFollowUpRecord,
  CrmQuotationLinkRecord,
  CrmBookingRecord,
  CrmCustomerLineIdentityRecord,
} from '../domain/models/crm.model';
import { DEFAULT_PIPELINE_STAGES } from '../domain/crm.constants';
import type { CrmBookingSource, CrmCustomerMergeImpact } from '@watchdog-bms/contracts';
import Decimal from 'decimal.js';
import { normalizeName, normalizePhone } from '../domain/logic/crm.logic';

type BookingWindow = {
  companyId: string;
  branchId?: string;
  customerId?: string;
  staffUserId: string | null;
  startAt: Date;
  endAt: Date;
  excludeId?: string;
};

type BookingCreateData = {
  companyId: string;
  branchId: string;
  customerId: string;
  customerName?: string;
  serviceName: string;
  staffUserId?: string;
  startAt: Date;
  endAt: Date;
  source?: CrmBookingSource;
  sourceConversationId?: string;
  depositAmount?: string;
  totalAmount?: string;
  createdByUserId: string;
};

type BookingWriteGuard = {
  rejectRevokedConsent?: boolean;
  requireCustomerContact?: boolean;
  expectedCustomerContact?: { displayName: string; primaryPhone: string };
  // CUST-02: optional hooks run INSIDE the booking $transaction so an autonomous
  // commit couples the kill-switch re-check and proposal finalization to the
  // booking write — either all land or the booking rolls back. A throw from
  // either aborts the transaction. Manual flows pass neither → zero change.
  assertWithinTx?: (tx: any) => Promise<void>;
  finalizeWithinTx?: (tx: any, bookingRow: any) => Promise<void>;
};

function bookingOverlapWhere(params: BookingWindow, bufferMinutes = 0) {
  const bufferMs = bufferMinutes * 60_000;
  return {
    companyId: params.companyId,
    staffUserId: params.staffUserId,
    status: { not: 'CANCELLED' as const },
    id: params.excludeId ? { not: params.excludeId } : undefined,
    startAt: { lt: new Date(params.endAt.getTime() + bufferMs) },
    endAt: { gt: new Date(params.startAt.getTime() - bufferMs) },
  };
}

function opt<T>(v: T | null | undefined): T | undefined {
  return v == null ? undefined : v;
}
function dec(v: unknown): string {
  return v != null ? String(v) : '0';
}
function decOpt(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}

function zeroMergeImpact(): CrmCustomerMergeImpact {
  return {
    bookings: 0, contacts: 0, opportunities: 0, activities: 0, followUps: 0,
    quotationLinks: 0, convertedLeads: 0, lineIdentities: 0, conversations: 0,
  };
}

type CustomerDuplicateKeys = {
  taxIdNormalized?: string;
  primaryEmailNormalized?: string;
  primaryPhoneNormalized?: string;
  nameNormalized?: string;
};

type CustomerDuplicateWriteGuard = {
  keys: CustomerDuplicateKeys;
  actorUserId: string;
  canReadAll: boolean;
  duplicateOverride?: boolean;
  excludeCustomerId?: string;
};

type CustomerMutationEvidence = {
  requestId: string;
  reason: string;
};

type CustomerWriteEvidence = {
  actorUserId: string;
  requestId: string;
  action: string;
  eventType: string;
  operationKey: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  data: Record<string, unknown>;
  reason?: string;
};

type CustomerMutationScope = {
  actorUserId: string;
  canManageAll: boolean;
  branchIds?: string[];
  reassignedOwnerUserId?: string;
};

type OpportunityUpdateGuard = {
  scope: CustomerMutationScope;
  expectedStatuses?: string[];
  reassignedOwnerUserId?: string;
};

type FollowUpUpdateGuard = {
  scope: CustomerMutationScope;
  expectedStatuses?: string[];
};

type LeadUpdateGuard = {
  actorUserId: string;
  canManageAll: boolean;
  expectedStatus: string;
  reassignedAssigneeUserId?: string;
};

@Injectable()
export class PrismaCrmRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  // ---- Pipeline stages ----

  async listStages(companyId: string): Promise<CrmPipelineStageRecord[]> {
    const rows = await this.db.crmPipelineStage.findMany({ where: { companyId }, orderBy: { sortOrder: 'asc' } });
    return rows.map((r) => this.toStage(r));
  }

  /** Lazily seed default stages the first time a company touches CRM. */
  async ensureDefaultStages(companyId: string, userId: string): Promise<CrmPipelineStageRecord[]> {
    const existing = await this.listStages(companyId);
    if (existing.length > 0) return existing;
    await this.db.crmPipelineStage.createMany({
      data: DEFAULT_PIPELINE_STAGES.map((s) => ({ companyId, createdByUserId: userId, ...s })),
    });
    return this.listStages(companyId);
  }

  async findStageById(companyId: string, id: string): Promise<CrmPipelineStageRecord | null> {
    const row = await this.db.crmPipelineStage.findFirst({ where: { id, companyId } });
    return row ? this.toStage(row) : null;
  }

  async replaceStages(
    companyId: string,
    userId: string,
    stages: Array<{
      id?: string;
      name: string;
      canonicalGroup: string;
      sortOrder: number;
      probabilityDefault?: number;
      isActive?: boolean;
      isTerminalWon: boolean;
      isTerminalLost: boolean;
    }>,
  ): Promise<CrmPipelineStageRecord[]> {
    await this.db.$transaction(async (tx: any) => {
      const keepIds: string[] = [];
      for (const s of stages) {
        if (s.id) {
          // Scope the update by companyId so a stage id from another tenant cannot be mutated.
          const res = await tx.crmPipelineStage.updateMany({
            where: { id: s.id, companyId },
            data: {
              name: s.name,
              canonicalGroup: s.canonicalGroup as any,
              sortOrder: s.sortOrder,
              probabilityDefault: s.probabilityDefault,
              isActive: s.isActive ?? true,
              isTerminalWon: s.isTerminalWon,
              isTerminalLost: s.isTerminalLost,
              updatedByUserId: userId,
            },
          });
          if (res.count === 0) throw new Error('stage_not_found');
          keepIds.push(s.id);
        } else {
          const created = await tx.crmPipelineStage.create({
            data: {
              companyId,
              name: s.name,
              canonicalGroup: s.canonicalGroup as any,
              sortOrder: s.sortOrder,
              probabilityDefault: s.probabilityDefault,
              isActive: s.isActive ?? true,
              isTerminalWon: s.isTerminalWon,
              isTerminalLost: s.isTerminalLost,
              createdByUserId: userId,
            },
          });
          keepIds.push(created.id);
        }
      }
      // Deactivate stages that were removed from the config but keep them for history
      // (never hard-delete stages with existing opportunities).
      await tx.crmPipelineStage.updateMany({
        where: { companyId, id: { notIn: keepIds } },
        data: { isActive: false, updatedByUserId: userId },
      });
    });
    return this.listStages(companyId);
  }

  // ---- Customers ----

  async createCustomer(
    data: Record<string, unknown>,
    guard?: CustomerDuplicateWriteGuard,
    evidence?: CustomerWriteEvidence,
  ): Promise<CrmCustomerRecord> {
    const ownerUserId = typeof data['ownerUserId'] === 'string' ? data['ownerUserId'] : undefined;
    if (!guard && !evidence && !ownerUserId) {
      const row = await this.db.crmCustomer.create({ data: this.withNormalizedCustomerName(data) as any });
      return this.toCustomer(row);
    }
    return this.db.$transaction(async (tx: any) => {
      const companyId = String(data['companyId'] ?? '');
      const branchId = typeof data['branchId'] === 'string' ? data['branchId'] : undefined;
      if (branchId) {
        const activeBranch = await tx.branch.findFirst({ where: { id: branchId, companyId, status: 'ACTIVE' }, select: { id: true } });
        if (!activeBranch) throw new Error('branch_not_active_in_company');
      }
      if (ownerUserId) {
        const activeOwner = await tx.companyMembership.findFirst({
          where: { companyId, userId: ownerUserId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!activeOwner) throw new Error('owner_not_active_company_member');
      }
      if (guard) {
        await this.lockDuplicateKeys(tx, companyId, guard.keys);
        const candidates = await this.findDuplicateCustomersWith(tx, companyId, guard.keys, guard.excludeCustomerId);
        this.assertDuplicateWriteAllowed(candidates, guard);
      }
      const row = await tx.crmCustomer.create({ data: this.withNormalizedCustomerName(data) as any });
      if (evidence) await this.appendStandardCustomerEvidence(tx, companyId, row.id, evidence);
      return this.toCustomer(row);
    });
  }

  /** LINE customer + channel identity are one write: a P2002 rolls both back. */
  async createLineCustomerAndIdentity(input: {
    customer: Record<string, unknown>;
    identity: Record<string, unknown> & { channelId: string };
  }): Promise<{ customer: CrmCustomerRecord; identityId: string }> {
    return this.db.$transaction(async (tx: any) => {
      const { lineUserId: _ignoredLineUserId, ...customerData } = input.customer;
      const companyId = String(input.customer['companyId'] ?? '');
      const channel = await tx.companyMessagingChannel.findFirst({ where: { id: input.identity.channelId, companyId }, select: { id: true } });
      if (!channel) throw new Error('channel_not_found');
      const customer = await tx.crmCustomer.create({
        data: this.withNormalizedCustomerName({
          ...customerData,
          originSource: 'LINE',
          createdByType: 'SYSTEM',
        }) as any,
      });
      const identity = await tx.crmChannelIdentity.create({
        data: { ...input.identity, companyId, customerId: customer.id } as any,
      });
      return { customer: this.toCustomer(customer), identityId: identity.id };
    });
  }

  async findCustomerById(companyId: string, id: string, withDetails = false): Promise<CrmCustomerRecord | null> {
    const row = await this.db.crmCustomer.findFirst({
      where: { id, companyId },
      include: withDetails ? {
        contacts: { where: { status: { not: 'ARCHIVED' } }, orderBy: { createdAt: 'asc' } },
        channelIdentities: { orderBy: [{ verifiedLinkAt: 'desc' }, { createdAt: 'asc' }] },
      } : undefined,
    });
    return row ? this.toCustomer(row) : null;
  }

  async listCustomers(where: {
    companyId: string;
    ownerUserId?: string;
    branchIds?: string[];
    status?: string;
    tier?: string;
    search?: string;
    sortBy?: 'updatedAt' | 'ltv';
    page?: number;
    pageSize?: number;
  }): Promise<{ items: CrmCustomerRecord[]; total: number; page: number; pageSize: number }> {
    const page = where.page && where.page > 0 ? where.page : 1;
    const pageSize = where.pageSize && where.pageSize > 0 ? Math.min(where.pageSize, 100) : 20;
    const search = where.search?.trim();
    const phoneSearch = search ? normalizePhone(search) : undefined;
    const filters = {
      companyId: where.companyId,
      ownerUserId: where.ownerUserId,
      ...(where.branchIds ? { AND: [{ OR: [{ branchId: { in: where.branchIds } }, { branchId: null }] }] } : {}),
      status: (where.status as any) ?? undefined,
      tier: (where.tier as any) ?? undefined,
      ...(search ? {
        OR: [
          { displayName: { contains: search, mode: 'insensitive' } },
          { legalName: { contains: search, mode: 'insensitive' } },
          ...(phoneSearch ? [{ primaryPhoneNormalized: { contains: phoneSearch } }] : []),
          { primaryEmailNormalized: { contains: search.toLowerCase() } },
        ],
      } : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.crmCustomer.findMany({
        where: filters as any,
        include: { channelIdentities: { orderBy: [{ verifiedLinkAt: 'desc' }, { createdAt: 'asc' }] } },
        orderBy: where.sortBy === 'ltv'
          ? [{ lifetimeValueAmount: 'desc' }, { id: 'asc' }]
          : [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.crmCustomer.count({ where: filters as any }),
    ]);
    return { items: rows.map((r) => this.toCustomer(r)), total, page, pageSize };
  }

  async summarizeCustomers(where: {
    companyId: string;
    ownerUserId?: string;
    branchIds?: string[];
    newSince: Date;
    /** Inclusive end of the new-customer window; omitted, the window runs to now. */
    newUntil?: Date;
  }): Promise<{ total: number; active: number; inactive: number; archived: number; newCustomers: number }> {
    const scope = {
      companyId: where.companyId,
      ownerUserId: where.ownerUserId,
      ...(where.branchIds ? { AND: [{ OR: [{ branchId: { in: where.branchIds } }, { branchId: null }] }] } : {}),
    };
    const [total, active, inactive, archived, newCustomers] = await this.db.$transaction([
      this.db.crmCustomer.count({ where: { ...scope, status: { not: 'MERGED' } } as any }),
      this.db.crmCustomer.count({ where: { ...scope, status: 'ACTIVE' } as any }),
      this.db.crmCustomer.count({ where: { ...scope, status: 'INACTIVE' } as any }),
      this.db.crmCustomer.count({ where: { ...scope, status: 'ARCHIVED' } as any }),
      this.db.crmCustomer.count({
        where: {
          ...scope,
          status: { not: 'MERGED' },
          createdAt: { gte: where.newSince, ...(where.newUntil ? { lte: where.newUntil } : {}) },
        } as any,
      }),
    ]);
    return { total, active, inactive, archived, newCustomers };
  }

  /** Candidate customers for duplicate detection by normalized keys. */
  async findDuplicateCustomers(
    companyId: string,
    keys: CustomerDuplicateKeys,
    excludeId?: string,
  ): Promise<CrmCustomerRecord[]> {
    const rows = await this.findDuplicateCustomersWith(this.db, companyId, keys, excludeId);
    return rows.map((row) => this.toCustomer(row));
  }

  async updateCustomer(
    companyId: string,
    id: string,
    data: Record<string, unknown>,
    guard?: CustomerDuplicateWriteGuard,
    scope?: CustomerMutationScope,
    evidence?: CustomerWriteEvidence,
  ): Promise<CrmCustomerRecord> {
    return this.db.$transaction(async (tx: any) => {
      await this.lockCustomerIds(tx, companyId, [id]);
      const existing = await tx.crmCustomer.findFirst({ where: { id, companyId } });
      if (!existing) throw new Error('customer_not_found');
      if (existing.personalDataErasedAt) throw new Error('customer_not_active');
      if (existing.status === 'ARCHIVED' || existing.status === 'MERGED') throw new Error('customer_not_editable');
      this.assertCustomerMutationScope(existing, scope);
      const requestedBranchId = typeof data['branchId'] === 'string' ? data['branchId'] : undefined;
      if (requestedBranchId) {
        const activeBranch = await tx.branch.findFirst({ where: { id: requestedBranchId, companyId, status: 'ACTIVE' }, select: { id: true } });
        if (!activeBranch) throw new Error('branch_not_active_in_company');
      }
      const requestedOwnerUserId = typeof data['ownerUserId'] === 'string' ? data['ownerUserId'] : undefined;
      if (requestedOwnerUserId && requestedOwnerUserId !== existing.ownerUserId) {
        if (scope?.reassignedOwnerUserId !== requestedOwnerUserId) {
          throw new Error('customer_owner_reassignment_not_authorized');
        }
        const activeMember = await tx.companyMembership.findFirst({
          where: { companyId, userId: requestedOwnerUserId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!activeMember) throw new Error('owner_not_active_company_member');
      }
      if (guard) {
        await this.lockDuplicateKeys(tx, companyId, guard.keys);
        const candidates = await this.findDuplicateCustomersWith(tx, companyId, guard.keys, guard.excludeCustomerId ?? id);
        this.assertDuplicateWriteAllowed(candidates, guard);
      }
      const result = await tx.crmCustomer.updateMany({
        where: { id, companyId, status: { notIn: ['ARCHIVED', 'MERGED'] }, personalDataErasedAt: null },
        data: this.withNormalizedCustomerName(data) as any,
      });
      if (result.count !== 1) throw new Error('customer_not_editable');
      const row = await tx.crmCustomer.findFirst({ where: { id, companyId } });
      if (!row) throw new Error('customer_not_found');
      if (evidence) await this.appendStandardCustomerEvidence(tx, companyId, row.id, evidence);
      return this.toCustomer(row);
    });
  }

  /** Fill booking contact gaps without overwriting data a staff member changed meanwhile. */
  async fillMissingBookingContact(
    companyId: string,
    id: string,
    input: { displayName?: string; primaryPhone?: string; lineProfileDisplayName?: string },
  ): Promise<CrmCustomerRecord> {
    return this.db.$transaction(async (tx: any) => {
      await this.lockCustomerIds(tx, companyId, [id]);
      const existing = await tx.crmCustomer.findFirst({ where: { id, companyId } });
      if (!existing || existing.personalDataErasedAt) throw new Error('customer_not_active');
      if (existing.status === 'ARCHIVED' || existing.status === 'MERGED') throw new Error('customer_not_editable');
      const data: Record<string, unknown> = {};
      const canReplaceLineName =
        !existing.displayName?.trim() ||
        existing.displayName === 'ลูกค้า LINE' ||
        Boolean(input.lineProfileDisplayName && existing.displayName === input.lineProfileDisplayName);
      if (input.displayName && canReplaceLineName) data['displayName'] = input.displayName;
      if (input.primaryPhone && !normalizePhone(existing.primaryPhone)) {
        data['primaryPhone'] = input.primaryPhone;
        data['primaryPhoneNormalized'] = normalizePhone(input.primaryPhone);
      }
      if (Object.keys(data).length > 0) {
        // Preserve staff edit provenance when this turn only fills another gap.
        if (data['displayName'] || !existing.updatedByUserId || existing.updatedByUserId === 'system') {
          data['updatedByUserId'] = 'system';
        }
        await tx.crmCustomer.updateMany({
          where: { id, companyId, personalDataErasedAt: null, status: { notIn: ['ARCHIVED', 'MERGED'] } },
          data: this.withNormalizedCustomerName(data) as any,
        });
      }
      const row = await tx.crmCustomer.findFirst({ where: { id, companyId } });
      if (!row) throw new Error('customer_not_found');
      return this.toCustomer(row);
    });
  }

  async customerMergeImpact(companyId: string, customerId: string): Promise<CrmCustomerMergeImpact> {
    return this.customerMergeImpactWith(this.db, companyId, customerId);
  }

  async mergeCustomers(input: {
    companyId: string;
    primaryCustomerId: string;
    secondaryCustomerId: string;
    userId: string;
    branchIds?: string[];
    evidence: CustomerMutationEvidence;
  }): Promise<{ customer: CrmCustomerRecord; impact: CrmCustomerMergeImpact; alreadyMerged: boolean }> {
    return this.db.$transaction(async (tx: any) => {
      await this.lockCustomerIdentityGraph(tx, input.companyId);
      await this.lockCustomerIds(tx, input.companyId, [input.primaryCustomerId, input.secondaryCustomerId]);
      const [primary, secondary] = await Promise.all([
        tx.crmCustomer.findFirst({ where: { id: input.primaryCustomerId, companyId: input.companyId } }),
        tx.crmCustomer.findFirst({ where: { id: input.secondaryCustomerId, companyId: input.companyId } }),
      ]);
      if (!primary || !secondary) throw new Error('customer_not_found');
      if (input.branchIds && [primary, secondary].some((customer) => customer.branchId && !input.branchIds!.includes(customer.branchId))) {
        throw new Error('customer_out_of_scope');
      }
      if (primary.personalDataErasedAt || secondary.personalDataErasedAt) throw new Error('customer_not_active');
      if (secondary.status === 'MERGED') {
        if (secondary.mergedIntoCustomerId !== primary.id) throw new Error('customer_already_merged_elsewhere');
        const customer = await tx.crmCustomer.findFirst({
          where: { id: primary.id, companyId: input.companyId },
          include: { channelIdentities: { orderBy: [{ verifiedLinkAt: 'desc' }, { createdAt: 'asc' }] } },
        });
        return { customer: this.toCustomer(customer), impact: zeroMergeImpact(), alreadyMerged: true };
      }
      if (primary.status !== 'ACTIVE') throw new Error('primary_customer_not_active');
      if (primary.taxIdNormalized && secondary.taxIdNormalized && primary.taxIdNormalized !== secondary.taxIdNormalized) {
        throw new Error('tax_id_conflict');
      }
      if (primary.accountingCounterpartyId && secondary.accountingCounterpartyId && primary.accountingCounterpartyId !== secondary.accountingCounterpartyId) {
        throw new Error('accounting_counterparty_conflict');
      }

      const copiedKeys: CustomerDuplicateKeys = {
        taxIdNormalized: primary.taxIdNormalized ? undefined : (secondary.taxIdNormalized ?? undefined),
        primaryEmailNormalized: primary.primaryEmailNormalized ? undefined : (secondary.primaryEmailNormalized ?? undefined),
        primaryPhoneNormalized: primary.primaryPhoneNormalized ? undefined : (secondary.primaryPhoneNormalized ?? undefined),
      };
      // Merge reduces duplicate cardinality because secondary becomes MERGED.
      // Lock only keys copied to primary so concurrent create/update observes a
      // stable before/after state; historical third candidates do not block cleanup.
      await this.lockDuplicateKeys(tx, input.companyId, copiedKeys);

      const impact = await this.customerMergeImpactWith(tx, input.companyId, secondary.id);
      await tx.crmBooking.updateMany({ where: { companyId: input.companyId, customerId: secondary.id }, data: { customerId: primary.id, updatedByUserId: input.userId } });
      await tx.crmContactPerson.updateMany({ where: { companyId: input.companyId, customerId: secondary.id }, data: { customerId: primary.id, updatedByUserId: input.userId } });
      await tx.crmOpportunity.updateMany({ where: { companyId: input.companyId, customerId: secondary.id }, data: { customerId: primary.id, updatedByUserId: input.userId } });
      await tx.crmActivity.updateMany({ where: { companyId: input.companyId, customerId: secondary.id }, data: { customerId: primary.id } });
      await tx.crmFollowUpTask.updateMany({ where: { companyId: input.companyId, customerId: secondary.id }, data: { customerId: primary.id, updatedByUserId: input.userId } });
      await tx.crmQuotationLink.updateMany({ where: { companyId: input.companyId, customerId: secondary.id }, data: { customerId: primary.id } });
      await tx.crmLead.updateMany({ where: { companyId: input.companyId, convertedCustomerId: secondary.id }, data: { convertedCustomerId: primary.id, updatedByUserId: input.userId } });
      await tx.crmChannelIdentity.updateMany({
        where: { companyId: input.companyId, customerId: secondary.id, verifiedLinkAt: null },
        data: { customerId: primary.id, verifiedLinkAt: new Date(), verifiedLinkVia: 'STAFF' },
      });
      await tx.crmChannelIdentity.updateMany({ where: { companyId: input.companyId, customerId: secondary.id }, data: { customerId: primary.id } });
      await tx.crmConversation.updateMany({ where: { companyId: input.companyId, customerId: secondary.id }, data: { customerId: primary.id } });

      const consentStatus = primary.consentStatus === 'REVOKED' || secondary.consentStatus === 'REVOKED'
        ? 'REVOKED'
        : primary.consentStatus;
      const secondaryRevocationWins = primary.consentStatus !== 'REVOKED' && secondary.consentStatus === 'REVOKED';
      await tx.crmCustomer.update({
        where: { id: primary.id },
        data: {
          legalName: primary.legalName ?? secondary.legalName,
          primaryPhone: primary.primaryPhone ?? secondary.primaryPhone,
          primaryPhoneNormalized: primary.primaryPhoneNormalized ?? secondary.primaryPhoneNormalized,
          primaryEmail: primary.primaryEmail ?? secondary.primaryEmail,
          primaryEmailNormalized: primary.primaryEmailNormalized ?? secondary.primaryEmailNormalized,
          taxId: primary.taxId ?? secondary.taxId,
          taxIdNormalized: primary.taxIdNormalized ?? secondary.taxIdNormalized,
          facebookId: primary.facebookId ?? secondary.facebookId,
          accountingCounterpartyId: primary.accountingCounterpartyId ?? secondary.accountingCounterpartyId,
          consentStatus,
          consentUpdatedAt: secondaryRevocationWins ? (secondary.consentUpdatedAt ?? new Date()) : primary.consentUpdatedAt,
          consentNote: secondaryRevocationWins ? secondary.consentNote : primary.consentNote,
          updatedByUserId: input.userId,
        },
      });
      await tx.crmCustomer.update({
        where: { id: secondary.id },
        data: { status: 'MERGED', mergedIntoCustomerId: primary.id, updatedByUserId: input.userId },
      });
      const customer = await tx.crmCustomer.findFirst({
        where: { id: primary.id, companyId: input.companyId },
        include: { channelIdentities: { orderBy: [{ verifiedLinkAt: 'desc' }, { createdAt: 'asc' }] } },
      });
      await this.appendCustomerMutationEvidence(tx, {
        companyId: input.companyId,
        userId: input.userId,
        requestId: input.evidence.requestId,
        reason: input.evidence.reason,
        action: 'crm.customer.merge',
        eventType: 'crm.customer.merged',
        targetCustomerId: primary.id,
        operationKey: secondary.id,
        data: { secondaryCustomerId: secondary.id, impact },
      });
      return { customer: this.toCustomer(customer), impact, alreadyMerged: false };
    });
  }

  async findLineIdentityById(companyId: string, identityId: string): Promise<CrmCustomerLineIdentityRecord | null> {
    const row = await this.db.crmChannelIdentity.findFirst({ where: { id: identityId, companyId } });
    return row ? this.toCustomerLineIdentity(row) : null;
  }

  async linkLineIdentity(input: {
    companyId: string;
    customerId: string;
    identityId: string;
    expectedCurrentCustomerId: string;
    userId: string;
    branchIds?: string[];
    evidence: CustomerMutationEvidence;
  }): Promise<{ customer: CrmCustomerRecord; identity: CrmCustomerLineIdentityRecord; previousCustomerId: string }> {
    return this.db.$transaction(async (tx: any) => {
      await this.lockCustomerIdentityGraph(tx, input.companyId);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-line-identity:' || ${input.companyId} || ':' || ${input.identityId}))::text`;
      const discoveredIdentity = await tx.crmChannelIdentity.findFirst({ where: { id: input.identityId, companyId: input.companyId } });
      if (!discoveredIdentity) throw new Error('line_identity_not_found');
      await this.lockCustomerIds(tx, input.companyId, [discoveredIdentity.customerId, input.customerId]);
      const identity = await tx.crmChannelIdentity.findFirst({ where: { id: input.identityId, companyId: input.companyId } });
      if (!identity) throw new Error('line_identity_not_found');
      if (identity.customerId !== input.expectedCurrentCustomerId) throw new Error('line_identity_changed');
      const [source, target] = await Promise.all([
        tx.crmCustomer.findFirst({ where: { id: identity.customerId, companyId: input.companyId } }),
        tx.crmCustomer.findFirst({ where: { id: input.customerId, companyId: input.companyId } }),
      ]);
      if (!source || !target) throw new Error('customer_not_found');
      if (input.branchIds && [source, target].some((customer) => customer.branchId && !input.branchIds!.includes(customer.branchId))) {
        throw new Error('customer_out_of_scope');
      }
      if (source.personalDataErasedAt || target.personalDataErasedAt) throw new Error('customer_not_active');
      if (target.status !== 'ACTIVE') throw new Error('customer_not_active');
      if (identity.customerId === target.id) {
        const confirmedIdentity = identity.verifiedLinkAt && identity.verifiedLinkVia === 'STAFF'
          ? identity
          : await tx.crmChannelIdentity.update({
              where: { id: identity.id },
              data: { verifiedLinkAt: new Date(), verifiedLinkVia: 'STAFF' },
            });
        const customer = await tx.crmCustomer.findFirst({
          where: { id: target.id, companyId: input.companyId },
          include: { channelIdentities: { orderBy: [{ verifiedLinkAt: 'desc' }, { createdAt: 'asc' }] } },
        });
        await this.appendCustomerMutationEvidence(tx, {
          companyId: input.companyId,
          userId: input.userId,
          requestId: input.evidence.requestId,
          reason: input.evidence.reason,
          action: 'crm.customer.line_identity.link',
          eventType: 'crm.customer.line_identity.linked',
          targetCustomerId: target.id,
          operationKey: identity.id,
          data: { identityId: identity.id, previousCustomerId: identity.customerId },
        });
        return { customer: this.toCustomer(customer), identity: this.toCustomerLineIdentity(confirmedIdentity), previousCustomerId: identity.customerId };
      }
      const conflict = await tx.crmChannelIdentity.findFirst({
        where: { companyId: input.companyId, customerId: target.id, channelId: identity.channelId, id: { not: identity.id }, status: 'ACTIVE' },
        select: { id: true },
      });
      if (conflict) throw new Error('target_line_identity_conflict');

      const linkedAt = new Date();
      const updatedIdentity = await tx.crmChannelIdentity.update({
        where: { id: identity.id },
        data: { customerId: target.id, verifiedLinkAt: linkedAt, verifiedLinkVia: 'STAFF' },
      });
      await tx.crmConversation.updateMany({
        where: { companyId: input.companyId, channelIdentityId: identity.id },
        data: { customerId: target.id },
      });
      const customer = await tx.crmCustomer.findFirst({
        where: { id: target.id, companyId: input.companyId },
        include: { channelIdentities: { orderBy: [{ verifiedLinkAt: 'desc' }, { createdAt: 'asc' }] } },
      });
      await this.appendCustomerMutationEvidence(tx, {
        companyId: input.companyId,
        userId: input.userId,
        requestId: input.evidence.requestId,
        reason: input.evidence.reason,
        action: 'crm.customer.line_identity.link',
        eventType: 'crm.customer.line_identity.linked',
        targetCustomerId: target.id,
        operationKey: identity.id,
        data: { identityId: identity.id, previousCustomerId: identity.customerId },
      });
      return {
        customer: this.toCustomer(customer),
        identity: this.toCustomerLineIdentity(updatedIdentity),
        previousCustomerId: identity.customerId,
      };
    });
  }

  async setCustomerAccountingCounterparty(companyId: string, customerId: string, counterpartyId: string): Promise<void> {
    await this.db.$transaction(async (tx: any) => {
      await this.lockCustomerIds(tx, companyId, [customerId]);
      const current = await tx.crmCustomer.findFirst({ where: { id: customerId, companyId } });
      if (!current) throw new Error('customer_not_found');
      if (current.personalDataErasedAt) throw new Error('customer_not_active');
      if (current.status !== 'ACTIVE') throw new Error('customer_not_active');
      const result = await tx.crmCustomer.updateMany({
        where: { id: customerId, companyId, status: 'ACTIVE' },
        data: { accountingCounterpartyId: counterpartyId },
      });
      if (result.count !== 1) throw new Error('customer_not_active');
    });
  }

  async countOpenWorkForCustomer(companyId: string, customerId: string): Promise<{ openOpportunities: number; openFollowUps: number }> {
    const [openOpportunities, openFollowUps] = await Promise.all([
      this.db.crmOpportunity.count({ where: { companyId, customerId, status: 'OPEN' } }),
      this.db.crmFollowUpTask.count({ where: { companyId, customerId, status: { in: ['OPEN', 'SNOOZED', 'OVERDUE'] } } }),
    ]);
    return { openOpportunities, openFollowUps };
  }

  async archiveCustomer(input: {
    companyId: string;
    customerId: string;
    userId: string;
    reason: string;
    override: boolean;
    scope: CustomerMutationScope;
    evidence?: CustomerWriteEvidence;
  }): Promise<{ customer?: CrmCustomerRecord; openOpportunities: number; openFollowUps: number }> {
    return this.db.$transaction(async (tx: any) => {
      await this.lockCustomerIds(tx, input.companyId, [input.customerId]);
      const current = await tx.crmCustomer.findFirst({ where: { id: input.customerId, companyId: input.companyId } });
      if (!current) throw new Error('customer_not_found');
      if (current.personalDataErasedAt) throw new Error('customer_not_active');
      if (current.status === 'ARCHIVED' || current.status === 'MERGED') throw new Error('customer_not_editable');
      this.assertCustomerMutationScope(current, input.scope);
      const [openOpportunities, openFollowUps] = await Promise.all([
        tx.crmOpportunity.count({ where: { companyId: input.companyId, customerId: input.customerId, status: 'OPEN' } }),
        tx.crmFollowUpTask.count({ where: { companyId: input.companyId, customerId: input.customerId, status: { in: ['OPEN', 'SNOOZED', 'OVERDUE'] } } }),
      ]);
      if (input.override && !input.scope.canManageAll && (openOpportunities > 0 || openFollowUps > 0)) {
        throw new Error('archive_override_forbidden');
      }
      if (!input.override && (openOpportunities > 0 || openFollowUps > 0)) return { openOpportunities, openFollowUps };
      const result = await tx.crmCustomer.updateMany({
        where: { id: input.customerId, companyId: input.companyId, status: { notIn: ['ARCHIVED', 'MERGED'] } },
        data: {
          status: 'ARCHIVED',
          archivedAt: new Date(),
          archivedByUserId: input.userId,
          archiveReason: input.reason,
          updatedByUserId: input.userId,
        },
      });
      if (result.count !== 1) throw new Error('customer_not_editable');
      const row = await tx.crmCustomer.findFirst({ where: { id: input.customerId, companyId: input.companyId } });
      if (!row) throw new Error('customer_not_found');
      if (input.evidence) await this.appendStandardCustomerEvidence(tx, input.companyId, row.id, input.evidence);
      return { customer: this.toCustomer(row), openOpportunities, openFollowUps };
    });
  }

  // ---- Contacts ----

  async createContact(data: Record<string, unknown>, scope?: CustomerMutationScope): Promise<CrmContactRecord> {
    const companyId = String(data['companyId'] ?? '');
    const customerId = String(data['customerId'] ?? '');
    return this.db.$transaction(async (tx: any) => {
      const customer = await this.lockAndRequireActiveCustomer(tx, companyId, customerId);
      this.assertCustomerMutationScope(customer, scope);
      const row = await tx.crmContactPerson.create({ data: data as any });
      return this.toContact(row);
    });
  }
  async listContacts(companyId: string, customerId: string): Promise<CrmContactRecord[]> {
    const rows = await this.db.crmContactPerson.findMany({ where: { companyId, customerId, status: { not: 'ARCHIVED' } }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.toContact(r));
  }
  async findContactById(companyId: string, id: string): Promise<CrmContactRecord | null> {
    const row = await this.db.crmContactPerson.findFirst({ where: { id, companyId } });
    return row ? this.toContact(row) : null;
  }
  async updateContact(
    companyId: string,
    id: string,
    data: Record<string, unknown>,
    guard?: { expectedCustomerId: string; scope: CustomerMutationScope },
  ): Promise<CrmContactRecord> {
    if (!guard) {
      const row = await this.db.crmContactPerson.update({ where: { id }, data: data as any });
      return this.toContact(row);
    }
    return this.db.$transaction(async (tx: any) => {
      await this.lockCustomerIds(tx, companyId, [guard.expectedCustomerId]);
      const contact = await tx.crmContactPerson.findFirst({ where: { id, companyId } });
      if (!contact) throw new Error('contact_not_found');
      if (contact.customerId !== guard.expectedCustomerId) throw new Error('contact_customer_changed');
      const customer = await tx.crmCustomer.findFirst({ where: { id: contact.customerId, companyId } });
      if (!customer || customer.status !== 'ACTIVE' || customer.personalDataErasedAt) throw new Error('customer_not_active');
      this.assertCustomerMutationScope(customer, guard.scope);
      const row = await tx.crmContactPerson.update({ where: { id }, data: data as any });
      return this.toContact(row);
    });
  }

  // ---- Leads ----

  async createLead(data: Record<string, unknown>): Promise<CrmLeadRecord> {
    const companyId = String(data['companyId'] ?? '');
    return this.db.$transaction(async (tx: any) => {
      const branchId = typeof data['branchId'] === 'string' ? data['branchId'] : undefined;
      if (branchId) {
        const activeBranch = await tx.branch.findFirst({ where: { id: branchId, companyId, status: 'ACTIVE' }, select: { id: true } });
        if (!activeBranch) throw new Error('branch_not_active_in_company');
      }
      const assignedToUserId = typeof data['assignedToUserId'] === 'string' ? data['assignedToUserId'] : undefined;
      if (assignedToUserId) {
        const activeAssignee = await tx.companyMembership.findFirst({
          where: { companyId, userId: assignedToUserId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!activeAssignee) throw new Error('assignee_not_active_company_member');
      }
      return this.toLead(await tx.crmLead.create({ data: data as any }));
    });
  }
  async findLeadById(companyId: string, id: string): Promise<CrmLeadRecord | null> {
    const row = await this.db.crmLead.findFirst({ where: { id, companyId } });
    return row ? this.toLead(row) : null;
  }
  async findLeadByConvertKey(companyId: string, key: string): Promise<CrmLeadRecord | null> {
    const row = await this.db.crmLead.findFirst({ where: { companyId, convertIdempotencyKey: key } });
    return row ? this.toLead(row) : null;
  }
  async listLeads(where: { companyId: string; assignedToUserId?: string; status?: string; source?: string; search?: string }): Promise<CrmLeadRecord[]> {
    const rows = await this.db.crmLead.findMany({
      where: {
        companyId: where.companyId,
        assignedToUserId: where.assignedToUserId,
        status: (where.status as any) ?? undefined,
        source: (where.source as any) ?? undefined,
        ...(where.search ? { OR: [{ rawName: { contains: where.search, mode: 'insensitive' } }, { rawPhone: { contains: where.search } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => this.toLead(r));
  }
  async updateLead(
    companyId: string,
    id: string,
    data: Record<string, unknown>,
    guard: LeadUpdateGuard,
  ): Promise<CrmLeadRecord> {
    return this.db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "CrmLead" WHERE "id" = ${id} AND "companyId" = ${companyId} FOR UPDATE`;
      const current = await tx.crmLead.findFirst({ where: { id, companyId } });
      if (!current) throw new Error('lead_not_found');
      if (!guard.canManageAll && current.assignedToUserId !== guard.actorUserId) throw new Error('lead_out_of_scope');
      if (current.status !== guard.expectedStatus) throw new Error('lead_status_changed');
      const requestedAssignee = typeof data['assignedToUserId'] === 'string' ? data['assignedToUserId'] : undefined;
      if (requestedAssignee && requestedAssignee !== current.assignedToUserId) {
        if (guard.reassignedAssigneeUserId !== requestedAssignee) throw new Error('lead_reassignment_not_authorized');
        const activeMember = await tx.companyMembership.findFirst({
          where: { companyId, userId: requestedAssignee, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!activeMember) throw new Error('assignee_not_active_company_member');
      }
      const updated = await tx.crmLead.updateMany({
        where: { id, companyId, status: guard.expectedStatus },
        data: data as any,
      });
      if (updated.count !== 1) throw new Error('lead_status_changed');
      const row = await tx.crmLead.findFirst({ where: { id, companyId } });
      if (!row) throw new Error('lead_not_found');
      return this.toLead(row);
    });
  }
  async countUnassignedLeads(companyId: string): Promise<number> {
    return this.db.crmLead.count({ where: { companyId, assignedToUserId: null, status: { in: ['NEW', 'CONTACTED'] } } });
  }

  /** Convert a lead: create/link customer, optional opportunity, mark lead CONVERTED — atomically. */
  async convertLead(params: {
    companyId: string;
    leadId: string;
    userId: string;
    convertKey: string;
    customerData?: Record<string, unknown>;
    customerDuplicateGuard?: CustomerDuplicateWriteGuard;
    leadScope: Pick<CustomerMutationScope, 'actorUserId' | 'canManageAll'>;
    existingCustomerId?: string;
    existingCustomerScope?: CustomerMutationScope;
    opportunity?: { title: string; stageId: string; canonicalStageGroup: string; amountEstimate: string; currency: string };
  }): Promise<{ customer: CrmCustomerRecord; opportunity?: CrmOpportunityRecord; lead: CrmLeadRecord }> {
    const result = await this.db.$transaction(async (tx: any) => {
      // ponytail: one company graph lock keeps conversion/merge/child lock order acyclic;
      // split by lineage only if production profiling shows contention.
      await this.lockCustomerIdentityGraph(tx, params.companyId);
      await tx.$queryRaw`SELECT "id" FROM "CrmLead" WHERE "id" = ${params.leadId} AND "companyId" = ${params.companyId} FOR UPDATE`;
      const currentLead = await tx.crmLead.findFirst({
        where: { id: params.leadId, companyId: params.companyId },
        select: { status: true, assignedToUserId: true },
      });
      if (!currentLead) throw new Error('lead_not_found');
      if (currentLead.status === 'CONVERTED') throw new Error('lead_already_converted');
      if (!['NEW', 'CONTACTED', 'QUALIFIED'].includes(currentLead.status)) throw new Error('lead_not_convertible');
      if (!params.leadScope.canManageAll && currentLead.assignedToUserId !== params.leadScope.actorUserId) {
        throw new Error('lead_out_of_scope');
      }

      // The row lock plus this exact-state claim prevents a stale conversion
      // from racing a status/assignee mutation before any child is created.
      const claim = await tx.crmLead.updateMany({
        where: {
          id: params.leadId,
          companyId: params.companyId,
          status: currentLead.status,
          assignedToUserId: currentLead.assignedToUserId,
        },
        data: { convertIdempotencyKey: params.convertKey },
      });
      if (claim.count === 0) throw new Error('lead_status_changed');

      let customer;
      if (params.existingCustomerId) {
        await this.lockCustomerIds(tx, params.companyId, [params.existingCustomerId]);
        customer = await tx.crmCustomer.findFirst({ where: { id: params.existingCustomerId, companyId: params.companyId } });
        if (!customer) throw new Error('existing_customer_not_found');
        if (customer.status !== 'ACTIVE') throw new Error('existing_customer_not_active');
        if (!params.existingCustomerScope?.canManageAll && customer.ownerUserId !== params.existingCustomerScope?.actorUserId) {
          throw new Error('existing_customer_out_of_scope');
        }
      } else {
        if (!params.customerData || !params.customerDuplicateGuard) throw new Error('customer_data_required');
        const ownerUserId = typeof params.customerData['ownerUserId'] === 'string'
          ? params.customerData['ownerUserId']
          : undefined;
        if (!ownerUserId) throw new Error('owner_not_active_company_member');
        const activeOwner = await tx.companyMembership.findFirst({
          where: { companyId: params.companyId, userId: ownerUserId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!activeOwner) throw new Error('owner_not_active_company_member');
        await this.lockDuplicateKeys(tx, params.companyId, params.customerDuplicateGuard.keys);
        const candidates = await this.findDuplicateCustomersWith(tx, params.companyId, params.customerDuplicateGuard.keys);
        this.assertDuplicateWriteAllowed(candidates, params.customerDuplicateGuard);
        customer = await tx.crmCustomer.create({ data: this.withNormalizedCustomerName(params.customerData) as any });
      }
      // Legacy lead-only children become canonical customer children at the
      // same conversion boundary. The lead row is already write-locked by the
      // claim above, so concurrent child creation either lands before this
      // backfill or waits and resolves convertedCustomerId afterwards.
      await tx.crmActivity.updateMany({
        where: { companyId: params.companyId, leadId: params.leadId, customerId: null },
        data: { customerId: customer.id },
      });
      await tx.crmFollowUpTask.updateMany({
        where: { companyId: params.companyId, leadId: params.leadId, customerId: null },
        data: { customerId: customer.id },
      });
      let opportunity;
      if (params.opportunity) {
        opportunity = await tx.crmOpportunity.create({
          data: {
            companyId: params.companyId,
            customerId: customer.id,
            leadId: params.leadId,
            ownerUserId: params.userId,
            title: params.opportunity.title,
            stageId: params.opportunity.stageId,
            canonicalStageGroup: params.opportunity.canonicalStageGroup as any,
            amountEstimate: params.opportunity.amountEstimate,
            currency: params.opportunity.currency,
            createdByUserId: params.userId,
          },
        });
      }
      const lead = await tx.crmLead.update({
        where: { id: params.leadId },
        data: {
          status: 'CONVERTED',
          convertedCustomerId: customer.id,
          convertedOpportunityId: opportunity?.id,
          convertIdempotencyKey: params.convertKey,
          convertedAt: new Date(),
          updatedByUserId: params.userId,
        },
      });
      return { customer, opportunity, lead };
    });
    return {
      customer: this.toCustomer(result.customer),
      opportunity: result.opportunity ? this.toOpportunity(result.opportunity) : undefined,
      lead: this.toLead(result.lead),
    };
  }

  // ---- Opportunities ----

  async createOpportunity(data: Record<string, unknown>, scope?: CustomerMutationScope): Promise<CrmOpportunityRecord> {
    const companyId = String(data['companyId'] ?? '');
    const customerId = String(data['customerId'] ?? '');
    if (!scope) throw new Error('customer_mutation_scope_required');
    return this.db.$transaction(async (tx: any) => {
      const branchId = typeof data['branchId'] === 'string' ? data['branchId'] : undefined;
      if (branchId) {
        const activeBranch = await tx.branch.findFirst({ where: { id: branchId, companyId, status: 'ACTIVE' }, select: { id: true } });
        if (!activeBranch) throw new Error('branch_not_active_in_company');
      }
      const resolvedCustomerId = await this.resolveChildTarget(tx, companyId, {
        customerId,
        leadId: data['leadId'],
      }, scope);
      if (resolvedCustomerId !== customerId) throw new Error('child_target_mismatch');
      const leadId = typeof data['leadId'] === 'string' ? data['leadId'] : undefined;
      if (leadId) {
        const lead = await tx.crmLead.findFirst({ where: { id: leadId, companyId } });
        if (!lead) throw new Error('lead_not_found');
        if (!lead.convertedCustomerId) throw new Error('lead_not_converted');
        if (lead.convertedCustomerId !== customerId) throw new Error('child_target_mismatch');
      }
      await this.assertNewChildOwner(tx, companyId, data, scope);
      const row = await tx.crmOpportunity.create({ data: { ...data, customerId: resolvedCustomerId } as any });
      return this.toOpportunity(row);
    });
  }
  async findOpportunityById(companyId: string, id: string, withRelations = false): Promise<CrmOpportunityRecord | null> {
    const row = await this.db.crmOpportunity.findFirst({
      where: { id, companyId },
      include: withRelations ? { customer: { select: { displayName: true } }, quotationLinks: { orderBy: { createdAt: 'desc' } } } : { customer: { select: { displayName: true } } },
    });
    if (!row) return null;
    const rec = this.toOpportunity(row);
    if (withRelations) {
      const [followUps, activities] = await Promise.all([
        this.db.crmFollowUpTask.findMany({ where: { companyId, opportunityId: id }, orderBy: { dueAt: 'asc' }, take: 50 }),
        this.db.crmActivity.findMany({ where: { companyId, opportunityId: id }, orderBy: { occurredAt: 'desc' }, take: 50 }),
      ]);
      rec.followUps = followUps.map((f: any) => this.toFollowUp(f));
      rec.activities = activities.map((a: any) => this.toActivity(a));
    }
    return rec;
  }
  async listOpportunities(where: {
    companyId: string;
    ownerUserId?: string;
    branchIds?: string[];
    status?: string;
    stageId?: string;
    customerId?: string;
    search?: string;
  }): Promise<CrmOpportunityRecord[]> {
    const rows = await this.db.crmOpportunity.findMany({
      where: {
        companyId: where.companyId,
        ownerUserId: where.ownerUserId,
        ...(where.branchIds ? { OR: [{ branchId: { in: where.branchIds } }, { branchId: null }] } : {}),
        status: (where.status as any) ?? undefined,
        stageId: where.stageId,
        customerId: where.customerId,
        ...(where.search ? { title: { contains: where.search, mode: 'insensitive' } } : {}),
      },
      include: { customer: { select: { displayName: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => this.toOpportunity(r));
  }
  async updateOpportunity(
    companyId: string,
    id: string,
    data: Record<string, unknown>,
    guard: OpportunityUpdateGuard,
  ): Promise<CrmOpportunityRecord> {
    return this.db.$transaction(async (tx: any) => {
      const discovered = await tx.crmOpportunity.findFirst({ where: { id, companyId } });
      if (!discovered) throw new Error('opportunity_not_found');
      await this.lockCustomerIds(tx, companyId, [discovered.customerId]);
      const current = await tx.crmOpportunity.findFirst({ where: { id, companyId } });
      if (!current) throw new Error('opportunity_not_found');
      if (current.customerId !== discovered.customerId) throw new Error('opportunity_customer_changed');
      if (!guard.scope.canManageAll && current.ownerUserId !== guard.scope.actorUserId) throw new Error('opportunity_out_of_scope');
      const customer = await tx.crmCustomer.findFirst({ where: { id: current.customerId, companyId } });
      if (!customer || customer.status !== 'ACTIVE' || customer.personalDataErasedAt) throw new Error('customer_not_active');
      const requestedOwner = typeof data['ownerUserId'] === 'string' ? data['ownerUserId'] : undefined;
      if (requestedOwner && requestedOwner !== current.ownerUserId) {
        if (guard.reassignedOwnerUserId !== requestedOwner) throw new Error('opportunity_owner_reassignment_not_authorized');
        const activeMember = await tx.companyMembership.findFirst({
          where: { companyId, userId: requestedOwner, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!activeMember) throw new Error('owner_not_active_company_member');
      }
      const updated = await tx.crmOpportunity.updateMany({
        where: {
          id,
          companyId,
          customerId: current.customerId,
          ...(guard.expectedStatuses ? { status: { in: guard.expectedStatuses as any } } : {}),
        },
        data: data as any,
      });
      if (updated.count !== 1) throw new Error('opportunity_changed');
      const row = await tx.crmOpportunity.findFirst({
        where: { id, companyId },
        include: { customer: { select: { displayName: true } } },
      });
      if (!row) throw new Error('opportunity_not_found');
      return this.toOpportunity(row);
    });
  }

  async transitionOpportunity(input: {
    companyId: string;
    opportunityId: string;
    expectedCustomerId: string;
    expectedStatuses: string[];
    scope: CustomerMutationScope;
    data: Record<string, unknown>;
    activity: Record<string, unknown>;
  }): Promise<CrmOpportunityRecord> {
    return this.db.$transaction(async (tx: any) => {
      await this.lockCustomerIds(tx, input.companyId, [input.expectedCustomerId]);
      const current = await tx.crmOpportunity.findFirst({ where: { id: input.opportunityId, companyId: input.companyId } });
      if (!current) throw new Error('opportunity_not_found');
      if (current.customerId !== input.expectedCustomerId) throw new Error('opportunity_customer_changed');
      if (!input.scope.canManageAll && current.ownerUserId !== input.scope.actorUserId) throw new Error('opportunity_out_of_scope');
      if (!input.expectedStatuses.includes(current.status)) throw new Error('opportunity_status_changed');
      const customer = await tx.crmCustomer.findFirst({ where: { id: current.customerId, companyId: input.companyId } });
      if (!customer || customer.status !== 'ACTIVE') throw new Error('customer_not_active');
      const update = await tx.crmOpportunity.updateMany({
        where: { id: current.id, companyId: input.companyId, customerId: current.customerId, status: { in: input.expectedStatuses } },
        data: input.data as any,
      });
      if (update.count !== 1) throw new Error('opportunity_status_changed');
      await tx.crmActivity.create({ data: { ...input.activity, companyId: input.companyId, opportunityId: current.id, customerId: current.customerId } as any });
      const row = await tx.crmOpportunity.findFirst({
        where: { id: current.id, companyId: input.companyId },
        include: { customer: { select: { displayName: true } } },
      });
      if (!row) throw new Error('opportunity_not_found');
      return this.toOpportunity(row);
    });
  }

  // ---- Activities (append-only) ----

  async createActivity(data: Record<string, unknown>, scope?: CustomerMutationScope): Promise<CrmActivityRecord> {
    const hasTarget = typeof data['customerId'] === 'string' || typeof data['opportunityId'] === 'string' || typeof data['leadId'] === 'string';
    if (hasTarget && !scope) throw new Error('customer_mutation_scope_required');
    if (!hasTarget) {
      const row = await this.db.crmActivity.create({ data: data as any });
      return this.toActivity(row);
    }
    const mutationScope = scope!;
    const companyId = String(data['companyId'] ?? '');
    return this.db.$transaction(async (tx: any) => {
      const customerId = await this.resolveChildTarget(tx, companyId, data, mutationScope);
      const row = await tx.crmActivity.create({ data: { ...data, customerId } as any });
      return this.toActivity(row);
    });
  }
  async listActivities(where: { companyId: string; customerId?: string; opportunityId?: string; leadId?: string; actorUserId?: string }): Promise<CrmActivityRecord[]> {
    const rows = await this.db.crmActivity.findMany({
      where: { companyId: where.companyId, customerId: where.customerId, opportunityId: where.opportunityId, leadId: where.leadId, actorUserId: where.actorUserId },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toActivity(r));
  }

  // ---- Follow-ups ----

  async createFollowUp(data: Record<string, unknown>, scope?: CustomerMutationScope): Promise<CrmFollowUpRecord> {
    const hasTarget = typeof data['customerId'] === 'string' || typeof data['opportunityId'] === 'string' || typeof data['leadId'] === 'string';
    if (hasTarget && !scope) throw new Error('customer_mutation_scope_required');
    if (!hasTarget) {
      const row = await this.db.crmFollowUpTask.create({ data: data as any });
      return this.toFollowUp(row);
    }
    const companyId = String(data['companyId'] ?? '');
    return this.db.$transaction(async (tx: any) => {
      const customerId = await this.resolveChildTarget(tx, companyId, data, scope!);
      await this.assertNewChildOwner(tx, companyId, data, scope!);
      const row = await tx.crmFollowUpTask.create({ data: { ...data, customerId } as any });
      return this.toFollowUp(row);
    });
  }
  async findFollowUpById(companyId: string, id: string): Promise<CrmFollowUpRecord | null> {
    const row = await this.db.crmFollowUpTask.findFirst({ where: { id, companyId } });
    return row ? this.toFollowUp(row) : null;
  }
  async listFollowUps(where: {
    companyId: string;
    ownerUserId?: string;
    status?: string;
    customerId?: string;
    opportunityId?: string;
    dueBefore?: Date;
    dueAfter?: Date;
  }): Promise<CrmFollowUpRecord[]> {
    const rows = await this.db.crmFollowUpTask.findMany({
      where: {
        companyId: where.companyId,
        ownerUserId: where.ownerUserId,
        status: (where.status as any) ?? undefined,
        customerId: where.customerId,
        opportunityId: where.opportunityId,
        ...(where.dueBefore || where.dueAfter ? { dueAt: { lte: where.dueBefore, gte: where.dueAfter } } : {}),
      },
      orderBy: { dueAt: 'asc' },
      take: 500,
    });
    return rows.map((r) => this.toFollowUp(r));
  }
  async updateFollowUp(
    companyId: string,
    id: string,
    data: Record<string, unknown>,
    guard: FollowUpUpdateGuard,
  ): Promise<CrmFollowUpRecord> {
    return this.db.$transaction(async (tx: any) => {
      const discovered = await tx.crmFollowUpTask.findFirst({ where: { id, companyId } });
      if (!discovered) throw new Error('follow_up_not_found');
      const discoveredCustomerId = await this.resolveChildTarget(tx, companyId, discovered, guard.scope);
      const current = await tx.crmFollowUpTask.findFirst({ where: { id, companyId } });
      if (!current) throw new Error('follow_up_not_found');
      if (
        current.customerId !== discovered.customerId
        || current.opportunityId !== discovered.opportunityId
        || current.leadId !== discovered.leadId
      ) throw new Error('follow_up_customer_changed');
      if (!guard.scope.canManageAll && current.ownerUserId !== guard.scope.actorUserId) throw new Error('follow_up_out_of_scope');
      const updated = await tx.crmFollowUpTask.updateMany({
        where: {
          id,
          companyId,
          customerId: current.customerId,
          ...(guard.expectedStatuses ? { status: { in: guard.expectedStatuses as any } } : {}),
        },
        data: { ...data, ...(discoveredCustomerId && !current.customerId ? { customerId: discoveredCustomerId } : {}) } as any,
      });
      if (updated.count !== 1) throw new Error('follow_up_changed');
      const row = await tx.crmFollowUpTask.findFirst({ where: { id, companyId } });
      if (!row) throw new Error('follow_up_not_found');
      return this.toFollowUp(row);
    });
  }
  /** Complete a follow-up, optionally appending an activity and creating the next task, atomically. */
  async completeFollowUp(params: {
    companyId: string;
    id: string;
    userId: string;
    scope: CustomerMutationScope;
    completeData: Record<string, unknown>;
    activity?: Record<string, unknown>;
    nextFollowUp?: Record<string, unknown>;
  }): Promise<{ followUp: CrmFollowUpRecord; activity?: CrmActivityRecord; next?: CrmFollowUpRecord }> {
    const result = await this.db.$transaction(async (tx: any) => {
      const discovered = await tx.crmFollowUpTask.findFirst({ where: { id: params.id, companyId: params.companyId } });
      if (!discovered) throw new Error('follow_up_not_found');
      const discoveredCustomerId = await this.resolveChildTarget(tx, params.companyId, discovered, params.scope);
      const current = await tx.crmFollowUpTask.findFirst({ where: { id: params.id, companyId: params.companyId } });
      if (!current) throw new Error('follow_up_not_found');
      if (
        current.customerId !== discovered.customerId
        || current.opportunityId !== discovered.opportunityId
        || current.leadId !== discovered.leadId
      ) {
        throw new Error('follow_up_customer_changed');
      }
      if (!params.scope.canManageAll && current.ownerUserId !== params.scope.actorUserId) throw new Error('follow_up_out_of_scope');
      if (current.status === 'DONE' || current.status === 'CANCELED') throw new Error('follow_up_closed');
      if (params.activity) {
        for (const key of ['customerId', 'opportunityId', 'leadId'] as const) {
          if (params.activity[key] !== undefined && params.activity[key] !== current[key]) {
            throw new Error('activity_target_mismatch');
          }
        }
      }
      let nextCustomerId: string | undefined;
      if (params.nextFollowUp) {
        await this.assertNewChildOwner(tx, params.companyId, params.nextFollowUp, params.scope);
        nextCustomerId = await this.resolveChildTarget(tx, params.companyId, params.nextFollowUp, params.scope);
        if (nextCustomerId !== discoveredCustomerId) throw new Error('next_follow_up_customer_mismatch');
      }
      let activity;
      if (params.activity) activity = await tx.crmActivity.create({ data: { ...params.activity, customerId: discoveredCustomerId } as any });
      const update = await tx.crmFollowUpTask.updateMany({
        where: { id: params.id, companyId: params.companyId, customerId: current.customerId, status: { notIn: ['DONE', 'CANCELED'] } },
        data: {
          ...params.completeData,
          nextActivityId: activity?.id,
          ...(discoveredCustomerId && !current.customerId ? { customerId: discoveredCustomerId } : {}),
        },
      });
      if (update.count !== 1) throw new Error('follow_up_changed');
      const followUp = await tx.crmFollowUpTask.findFirst({ where: { id: params.id, companyId: params.companyId } });
      if (!followUp) throw new Error('follow_up_not_found');
      let next;
      if (params.nextFollowUp) next = await tx.crmFollowUpTask.create({ data: { ...params.nextFollowUp, customerId: nextCustomerId } as any });
      return { followUp, activity, next };
    });
    return {
      followUp: this.toFollowUp(result.followUp),
      activity: result.activity ? this.toActivity(result.activity) : undefined,
      next: result.next ? this.toFollowUp(result.next) : undefined,
    };
  }
  async countFollowUps(companyId: string, ownerUserId: string | undefined, range: { dueBefore?: Date; dueAfter?: Date }, statuses: string[]): Promise<number> {
    return this.db.crmFollowUpTask.count({
      where: {
        companyId,
        ownerUserId,
        status: { in: statuses as any },
        ...(range.dueBefore || range.dueAfter ? { dueAt: { lte: range.dueBefore, gte: range.dueAfter } } : {}),
      },
    });
  }

  // ---- Quotation links ----

  async listQuotationLinks(companyId: string, opportunityId: string): Promise<CrmQuotationLinkRecord[]> {
    const rows = await this.db.crmQuotationLink.findMany({ where: { companyId, opportunityId }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toQuotationLink(r));
  }
  async listQuotationLinksByCustomer(
    companyId: string,
    customerId: string,
    ownerUserId?: string,
  ): Promise<CrmQuotationLinkRecord[]> {
    const rows = await this.db.crmQuotationLink.findMany({
      where: { companyId, customerId, ...(ownerUserId ? { opportunity: { ownerUserId } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.toQuotationLink(r));
  }
  async findActiveQuotationLink(companyId: string, opportunityId: string): Promise<CrmQuotationLinkRecord | null> {
    const row = await this.db.crmQuotationLink.findFirst({
      where: { companyId, opportunityId, status: { notIn: ['VOIDED', 'REJECTED'] } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toQuotationLink(row) : null;
  }
  async createQuotationLink(data: Record<string, unknown>): Promise<CrmQuotationLinkRecord> {
    const companyId = String(data['companyId'] ?? '');
    const customerId = String(data['customerId'] ?? '');
    return this.db.$transaction(async (tx: any) => {
      await this.lockAndRequireActiveCustomer(tx, companyId, customerId);
      const row = await tx.crmQuotationLink.create({ data: data as any });
      return this.toQuotationLink(row);
    });
  }

  async createQuotationDraftBundle(input: {
    companyId: string;
    opportunityId: string;
    expectedCustomerId: string;
    scope: CustomerMutationScope;
    userId: string;
    requestId: string;
    requestKey: string;
    allowRevision: boolean;
  }, beforeMutation?: (db: any) => Promise<void>): Promise<CrmQuotationLinkRecord> {
    return this.db.$transaction(async (tx: any) => {
      await this.lockCustomerIds(tx, input.companyId, [input.expectedCustomerId]);
      const opportunity = await tx.crmOpportunity.findFirst({ where: { id: input.opportunityId, companyId: input.companyId } });
      if (!opportunity) throw new Error('opportunity_not_found');
      if (opportunity.customerId !== input.expectedCustomerId) throw new Error('opportunity_customer_changed');
      if (opportunity.status !== 'OPEN') throw new Error('opportunity_status_changed');
      if (!input.scope.canManageAll && opportunity.ownerUserId !== input.scope.actorUserId) throw new Error('opportunity_out_of_scope');
      if (input.scope.branchIds && opportunity.branchId && !input.scope.branchIds.includes(opportunity.branchId)) {
        throw new Error('opportunity_out_of_scope');
      }
      const customer = await tx.crmCustomer.findFirst({ where: { id: opportunity.customerId, companyId: input.companyId } });
      if (!customer || customer.status !== 'ACTIVE') throw new Error('customer_not_active');
      // Opportunity ownership is the direct-quotation authority. Recheck only the customer's
      // current branch here so a branch move cannot bypass the final transaction boundary.
      if (input.scope.branchIds && customer.branchId && !input.scope.branchIds.includes(customer.branchId)) {
        throw new Error('customer_out_of_scope');
      }
      const retry = await tx.crmQuotationLink.findFirst({
        where: { companyId: input.companyId, opportunityId: opportunity.id, requestKey: input.requestKey },
      });
      if (retry) return this.toQuotationLink(retry);
      const active = await tx.crmQuotationLink.findFirst({
        where: { companyId: input.companyId, opportunityId: opportunity.id, status: { notIn: ['VOIDED', 'REJECTED'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (active && !input.allowRevision) return this.toQuotationLink(active);

      await beforeMutation?.(tx);

      let counterpartyId = customer.accountingCounterpartyId as string | null | undefined;
      if (!counterpartyId) {
        const counterparty = await tx.accountingCounterparty.create({
          data: {
            companyId: input.companyId,
            type: 'CUSTOMER',
            displayName: customer.displayName,
            createdByUserId: input.userId,
          },
        });
        counterpartyId = counterparty.id;
        const linked = await tx.crmCustomer.updateMany({
          where: { id: customer.id, companyId: input.companyId, status: 'ACTIVE', accountingCounterpartyId: null },
          data: { accountingCounterpartyId: counterparty.id, updatedByUserId: input.userId },
        });
        if (linked.count !== 1) throw new Error('customer_counterparty_changed');
        await tx.auditLog.create({
          data: {
            companyId: input.companyId,
            actorUserId: input.userId,
            action: 'accounting.counterparty.create',
            targetType: 'accounting_counterparty',
            targetId: counterparty.id,
            requestId: input.requestId,
            result: 'SUCCESS',
            riskLevel: 'MEDIUM',
            metadataJson: { source: 'crm_auto_link', crmCustomerId: customer.id },
          },
        });
      }

      const document = await tx.accountingDocument.create({
        data: {
          companyId: input.companyId,
          branchId: opportunity.branchId,
          documentType: 'QUOTATION',
          documentDate: new Date(),
          counterpartyId,
          currency: opportunity.currency ?? 'THB',
          vatMode: 'VAT_EXCLUDED',
          paymentStatus: 'UNPAID',
          note: `From CRM opportunity: ${opportunity.title}`,
          createdByUserId: input.userId,
        },
      });
      const link = await tx.crmQuotationLink.create({
        data: {
          companyId: input.companyId,
          customerId: opportunity.customerId,
          opportunityId: opportunity.id,
          accountingDocumentId: document.id,
          requestKey: input.requestKey,
          accountingDocumentType: 'QUOTATION',
          accountingDocumentNumber: document.documentNumber,
          status: 'DRAFT',
          grandTotalAmount: document.grandTotalAmount,
          currency: document.currency,
          createdByUserId: input.userId,
        },
      });
      const occurredAt = new Date();
      await tx.crmActivity.create({
        data: {
          companyId: input.companyId,
          opportunityId: opportunity.id,
          customerId: opportunity.customerId,
          actorUserId: input.userId,
          type: 'QUOTE_DRAFT_CREATED',
          note: `Quotation draft created${document.documentNumber ? ` (${document.documentNumber})` : ''}`,
          occurredAt,
          metadataJson: { accountingDocumentId: document.id },
        },
      });
      await tx.crmOpportunity.updateMany({
        where: { id: opportunity.id, companyId: input.companyId, customerId: opportunity.customerId, status: 'OPEN' },
        data: { lastActivityAt: occurredAt, updatedByUserId: input.userId },
      });
      await tx.auditLog.create({
        data: {
          companyId: input.companyId,
          actorUserId: input.userId,
          action: 'accounting.document.create',
          targetType: 'accounting_document',
          targetId: document.id,
          requestId: input.requestId,
          result: 'SUCCESS',
          riskLevel: 'MEDIUM',
          metadataJson: { documentType: 'QUOTATION', source: 'CRM_OPPORTUNITY' },
        },
      });
      return this.toQuotationLink(link);
    });
  }

  /**
   * Inbox command boundary: create the opportunity and its accounting quotation
   * in one transaction. The caller supplies a deterministic opportunity id and
   * request key, so an exact retry resolves the committed bundle instead of
   * creating a second deal.
   */
  async createConversationQuotationDraftBundle(input: {
    companyId: string;
    opportunityId: string;
    customerId: string;
    title: string;
    amountEstimate: string;
    expectedCloseDate?: Date;
    scope: CustomerMutationScope;
    userId: string;
    requestId: string;
    requestKey: string;
  }, beforeMutation: (db: any) => Promise<void>): Promise<{
    opportunity: CrmOpportunityRecord;
    quotation: CrmQuotationLinkRecord;
    replayed: boolean;
  }> {
    return this.db.$transaction(async (tx: any) => {
      // Use the same graph -> customer lock order as normal child creation.
      await this.lockCustomerIdentityGraph(tx, input.companyId);
      const customer = await this.lockAndRequireActiveCustomer(tx, input.companyId, input.customerId);
      this.assertCustomerMutationScope(customer, input.scope);

      const retryOpportunity = await tx.crmOpportunity.findFirst({
        where: { id: input.opportunityId, companyId: input.companyId },
      });
      if (retryOpportunity) {
        const storedExpectedClose = retryOpportunity.expectedCloseDate
          ? new Date(retryOpportunity.expectedCloseDate).getTime()
          : null;
        const requestedExpectedClose = input.expectedCloseDate?.getTime() ?? null;
        if (retryOpportunity.customerId !== input.customerId
          || retryOpportunity.createdByUserId !== input.userId
          || retryOpportunity.title !== input.title
          || !new Decimal(retryOpportunity.amountEstimate ?? 0).eq(input.amountEstimate)
          || storedExpectedClose !== requestedExpectedClose) {
          throw new Error('quotation_command_conflict');
        }
        const retryQuotation = await tx.crmQuotationLink.findFirst({
          where: {
            companyId: input.companyId,
            opportunityId: input.opportunityId,
            requestKey: input.requestKey,
          },
        });
        if (!retryQuotation) throw new Error('quotation_command_incomplete');
        return {
          opportunity: this.toOpportunity(retryOpportunity),
          quotation: this.toQuotationLink(retryQuotation),
          replayed: true,
        };
      }

      const activeOwner = await tx.companyMembership.findFirst({
        where: { companyId: input.companyId, userId: input.userId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!activeOwner) throw new Error('owner_not_active_company_member');

      // No write may happen before this transactional shared launch lock.
      await beforeMutation(tx);

      let stage = await tx.crmPipelineStage.findFirst({
        where: { companyId: input.companyId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      if (!stage) {
        await tx.crmPipelineStage.createMany({
          data: DEFAULT_PIPELINE_STAGES.map((item) => ({
            companyId: input.companyId,
            createdByUserId: input.userId,
            ...item,
          })),
          skipDuplicates: true,
        });
        stage = await tx.crmPipelineStage.findFirst({
          where: { companyId: input.companyId, isActive: true },
          orderBy: { sortOrder: 'asc' },
        });
      }
      if (!stage) throw new Error('pipeline_stage_unavailable');

      const opportunity = await tx.crmOpportunity.create({
        data: {
          id: input.opportunityId,
          companyId: input.companyId,
          customerId: input.customerId,
          ownerUserId: input.userId,
          title: input.title,
          stageId: stage.id,
          canonicalStageGroup: stage.canonicalGroup,
          amountEstimate: input.amountEstimate,
          currency: 'THB',
          probability: stage.probabilityDefault,
          expectedCloseDate: input.expectedCloseDate,
          createdByUserId: input.userId,
        },
      });

      let counterpartyId = customer.accountingCounterpartyId as string | null | undefined;
      if (!counterpartyId) {
        const counterparty = await tx.accountingCounterparty.create({
          data: {
            companyId: input.companyId,
            type: 'CUSTOMER',
            displayName: customer.displayName,
            createdByUserId: input.userId,
          },
        });
        counterpartyId = counterparty.id;
        const linked = await tx.crmCustomer.updateMany({
          where: { id: customer.id, companyId: input.companyId, status: 'ACTIVE', accountingCounterpartyId: null },
          data: { accountingCounterpartyId: counterparty.id, updatedByUserId: input.userId },
        });
        if (linked.count !== 1) throw new Error('customer_counterparty_changed');
        await tx.auditLog.create({
          data: {
            companyId: input.companyId,
            actorUserId: input.userId,
            action: 'accounting.counterparty.create',
            targetType: 'accounting_counterparty',
            targetId: counterparty.id,
            requestId: input.requestId,
            result: 'SUCCESS',
            riskLevel: 'MEDIUM',
            metadataJson: { source: 'crm_inbox_auto_link', crmCustomerId: customer.id },
          },
        });
      }

      const document = await tx.accountingDocument.create({
        data: {
          companyId: input.companyId,
          documentType: 'QUOTATION',
          documentDate: new Date(),
          counterpartyId,
          currency: 'THB',
          vatMode: 'VAT_EXCLUDED',
          paymentStatus: 'UNPAID',
          note: `From CRM Inbox conversation: ${input.title}`,
          createdByUserId: input.userId,
        },
      });
      const quotation = await tx.crmQuotationLink.create({
        data: {
          companyId: input.companyId,
          customerId: input.customerId,
          opportunityId: opportunity.id,
          accountingDocumentId: document.id,
          requestKey: input.requestKey,
          accountingDocumentType: 'QUOTATION',
          accountingDocumentNumber: document.documentNumber,
          status: 'DRAFT',
          grandTotalAmount: document.grandTotalAmount,
          currency: document.currency,
          createdByUserId: input.userId,
        },
      });
      const occurredAt = new Date();
      await tx.crmActivity.create({
        data: {
          companyId: input.companyId,
          opportunityId: opportunity.id,
          customerId: input.customerId,
          actorUserId: input.userId,
          type: 'QUOTE_DRAFT_CREATED',
          note: 'Quotation draft created from CRM Inbox',
          occurredAt,
          metadataJson: { accountingDocumentId: document.id },
        },
      });
      await tx.crmOpportunity.update({
        where: { id: opportunity.id },
        data: { lastActivityAt: occurredAt, updatedByUserId: input.userId },
      });
      await tx.auditLog.createMany({
        data: [
          {
            companyId: input.companyId,
            actorUserId: input.userId,
            action: 'crm.opportunity.create',
            targetType: 'crm_opportunity',
            targetId: opportunity.id,
            requestId: input.requestId,
            result: 'SUCCESS',
            riskLevel: 'LOW',
            metadataJson: { source: 'CRM_INBOX' },
          },
          {
            companyId: input.companyId,
            actorUserId: input.userId,
            action: 'accounting.document.create',
            targetType: 'accounting_document',
            targetId: document.id,
            requestId: input.requestId,
            result: 'SUCCESS',
            riskLevel: 'MEDIUM',
            metadataJson: { documentType: 'QUOTATION', source: 'CRM_INBOX' },
          },
          {
            companyId: input.companyId,
            actorUserId: input.userId,
            action: 'crm.quotation.link',
            targetType: 'crm_quotation_link',
            targetId: quotation.id,
            requestId: input.requestId,
            result: 'SUCCESS',
            riskLevel: 'MEDIUM',
            metadataJson: { accountingDocumentId: document.id, source: 'CRM_INBOX' },
          },
        ],
      });
      const committedOpportunity = { ...opportunity, lastActivityAt: occurredAt, updatedByUserId: input.userId };
      return {
        opportunity: this.toOpportunity(committedOpportunity),
        quotation: this.toQuotationLink(quotation),
        replayed: false,
      };
    });
  }
  async updateQuotationLink(companyId: string, id: string, data: Record<string, unknown>): Promise<CrmQuotationLinkRecord> {
    const row = await this.db.crmQuotationLink.update({ where: { id }, data: data as any });
    return this.toQuotationLink(row);
  }

  // ---- Mappers (row -> record) ----

  private toStage(r: any): CrmPipelineStageRecord {
    return {
      id: r.id,
      companyId: r.companyId,
      name: r.name,
      canonicalGroup: r.canonicalGroup,
      sortOrder: r.sortOrder,
      probabilityDefault: opt(r.probabilityDefault),
      isTerminalWon: r.isTerminalWon,
      isTerminalLost: r.isTerminalLost,
      isActive: r.isActive,
      createdByUserId: r.createdByUserId,
      updatedByUserId: opt(r.updatedByUserId),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private toCustomer(r: any): CrmCustomerRecord {
    return {
      id: r.id,
      marketingRef: r.marketingRef,
      companyId: r.companyId,
      branchId: opt(r.branchId),
      accountingCounterpartyId: opt(r.accountingCounterpartyId),
      code: opt(r.code),
      displayName: r.displayName,
      displayNameNormalized: r.displayNameNormalized ?? normalizeName(r.displayName),
      legalName: opt(r.legalName),
      customerType: r.customerType,
      status: r.status,
      ownerUserId: opt(r.ownerUserId),
      ownerTeamId: opt(r.ownerTeamId),
      primaryPhone: opt(r.primaryPhone),
      primaryPhoneNormalized: opt(r.primaryPhoneNormalized),
      primaryEmail: opt(r.primaryEmail),
      primaryEmailNormalized: opt(r.primaryEmailNormalized),
      lineUserId: opt(r.lineUserId),
      facebookId: opt(r.facebookId),
      taxId: opt(r.taxId),
      taxIdNormalized: opt(r.taxIdNormalized),
      consentStatus: r.consentStatus,
      originSource: r.originSource ?? 'MANUAL',
      createdByType: r.createdByType ?? 'USER',
      consentUpdatedAt: opt(r.consentUpdatedAt),
      consentNote: opt(r.consentNote),
      personalDataErasedAt: opt(r.personalDataErasedAt),
      tier: r.tier,
      engagementScore: r.engagementScore,
      lifetimeValueAmount: r.lifetimeValueAmount ? r.lifetimeValueAmount.toString() : undefined,
      source: opt(r.source),
      notes: opt(r.notes),
      lastActivityAt: opt(r.lastActivityAt),
      lastContactedAt: opt(r.lastContactedAt),
      nextFollowUpAt: opt(r.nextFollowUpAt),
      mergedIntoCustomerId: opt(r.mergedIntoCustomerId),
      archivedAt: opt(r.archivedAt),
      archiveReason: opt(r.archiveReason),
      createdByUserId: r.createdByUserId,
      updatedByUserId: opt(r.updatedByUserId),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      contacts: r.contacts ? r.contacts.map((c: any) => this.toContact(c)) : undefined,
      lineIdentities: r.channelIdentities ? r.channelIdentities.map((identity: any) => this.toCustomerLineIdentity(identity)) : undefined,
    };
  }

  private toCustomerLineIdentity(r: any): CrmCustomerLineIdentityRecord {
    return {
      id: r.id,
      companyId: r.companyId,
      channelId: r.channelId,
      customerId: r.customerId,
      provider: r.provider,
      providerUserId: r.providerUserId,
      displayName: opt(r.displayName),
      status: r.status,
      verifiedLinkAt: opt(r.verifiedLinkAt),
      verifiedLinkVia: opt(r.verifiedLinkVia) as 'LIFF' | 'STAFF' | undefined,
    };
  }

  private withNormalizedCustomerName(data: Record<string, unknown>): Record<string, unknown> {
    if (typeof data['displayName'] !== 'string') return data;
    return { ...data, displayNameNormalized: normalizeName(data['displayName']) };
  }

  private async lockCustomerIds(db: any, companyId: string, customerIds: string[]): Promise<void> {
    const ids = [...new Set(customerIds)].sort();
    for (const customerId of ids) {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer:' || ${companyId} || ':' || ${customerId}))::text`;
    }
    if (ids.length > 0 && db.crmCustomer?.findFirst) {
      const erased = await db.crmCustomer.findFirst({
        where: { companyId, id: { in: ids }, personalDataErasedAt: { not: null } },
        select: { id: true, personalDataErasedAt: true },
      });
      if (erased?.personalDataErasedAt) throw new Error('customer_not_active');
    }
  }

  private async lockCustomerIdentityGraph(db: any, companyId: string): Promise<void> {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer-identity-graph:' || ${companyId}))::text`;
  }

  private async lockAndRequireActiveCustomer(db: any, companyId: string, customerId: string): Promise<any> {
    await this.lockCustomerIds(db, companyId, [customerId]);
    const customer = await db.crmCustomer.findFirst({ where: { id: customerId, companyId } });
    if (!customer || customer.status !== 'ACTIVE' || customer.personalDataErasedAt) throw new Error('customer_not_active');
    return customer;
  }

  private assertCustomerMutationScope(customer: any, scope?: CustomerMutationScope): void {
    if (scope?.branchIds && customer.branchId && !scope.branchIds.includes(customer.branchId)) {
      throw new Error('customer_out_of_scope');
    }
    if (scope && !scope.canManageAll && customer.ownerUserId !== scope.actorUserId) throw new Error('customer_out_of_scope');
  }

  private async resolveChildTarget(
    db: any,
    companyId: string,
    data: Record<string, unknown>,
    scope: CustomerMutationScope,
  ): Promise<string | undefined> {
    // Merge/erase take graph -> customer -> child. Taking the same first lock
    // avoids a lead-row -> customer inversion while lineage is resolved.
    await this.lockCustomerIdentityGraph(db, companyId);
    const suppliedCustomerId = typeof data['customerId'] === 'string' ? data['customerId'] : undefined;
    const opportunityId = typeof data['opportunityId'] === 'string' ? data['opportunityId'] : undefined;
    const leadId = typeof data['leadId'] === 'string' ? data['leadId'] : undefined;
    const discoveredOpportunity = opportunityId
      ? await db.crmOpportunity.findFirst({ where: { id: opportunityId, companyId } })
      : undefined;
    if (opportunityId && !discoveredOpportunity) throw new Error('opportunity_not_found');
    if (leadId) {
      await db.$queryRaw`SELECT "id" FROM "CrmLead" WHERE "id" = ${leadId} AND "companyId" = ${companyId} FOR UPDATE`;
    }
    const discoveredLead = leadId
      ? await db.crmLead.findFirst({ where: { id: leadId, companyId } })
      : undefined;
    if (leadId && !discoveredLead) throw new Error('lead_not_found');
    const discoveredOpportunityCustomerId = discoveredOpportunity?.customerId as string | undefined;
    const discoveredLeadCustomerId = discoveredLead?.convertedCustomerId as string | undefined;
    const discoveredCustomerIds = [suppliedCustomerId, discoveredOpportunityCustomerId, discoveredLeadCustomerId]
      .filter((id): id is string => !!id);
    if (new Set(discoveredCustomerIds).size > 1) throw new Error('child_target_mismatch');
    const discoveredCustomerId = discoveredCustomerIds[0];
    await this.lockCustomerIds(db, companyId, discoveredCustomerIds);
    const opportunity = opportunityId
      ? await db.crmOpportunity.findFirst({ where: { id: opportunityId, companyId } })
      : undefined;
    if (opportunityId && !opportunity) throw new Error('opportunity_not_found');
    const lead = leadId
      ? await db.crmLead.findFirst({ where: { id: leadId, companyId } })
      : undefined;
    if (leadId && !lead) throw new Error('lead_not_found');
    if (opportunity && opportunity.customerId !== discoveredOpportunityCustomerId) throw new Error('child_target_changed');
    if (lead && lead.convertedCustomerId !== discoveredLead?.convertedCustomerId) throw new Error('child_target_changed');
    if (opportunity && !scope.canManageAll && opportunity.ownerUserId !== scope.actorUserId) throw new Error('target_out_of_scope');
    if (lead && !scope.canManageAll && lead.assignedToUserId !== scope.actorUserId) throw new Error('target_out_of_scope');
    const resolvedCustomerIds = [suppliedCustomerId, opportunity?.customerId, lead?.convertedCustomerId]
      .filter((id): id is string => !!id);
    if (new Set(resolvedCustomerIds).size > 1) throw new Error('child_target_mismatch');
    const customerId = resolvedCustomerIds[0];
    if (customerId !== discoveredCustomerId) throw new Error('child_target_changed');
    if (customerId) {
      const customer = await db.crmCustomer.findFirst({ where: { id: customerId, companyId } });
      if (!customer || customer.status !== 'ACTIVE' || customer.personalDataErasedAt) throw new Error('customer_not_active');
      if (!opportunity && !lead) this.assertCustomerMutationScope(customer, scope);
    }
    return customerId;
  }

  private async assertNewChildOwner(
    db: any,
    companyId: string,
    data: Record<string, unknown>,
    scope: CustomerMutationScope,
  ): Promise<void> {
    const ownerUserId = typeof data['ownerUserId'] === 'string' ? data['ownerUserId'] : undefined;
    if (!ownerUserId) throw new Error('owner_not_active_company_member');
    if (ownerUserId !== scope.actorUserId && scope.reassignedOwnerUserId !== ownerUserId) {
      throw new Error('child_owner_reassignment_not_authorized');
    }
    const activeOwner = await db.companyMembership.findFirst({
      where: { companyId, userId: ownerUserId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!activeOwner) throw new Error('owner_not_active_company_member');
  }

  private async lockDuplicateKeys(db: any, companyId: string, keys: CustomerDuplicateKeys): Promise<void> {
    const lockKeys = [
      keys.taxIdNormalized ? `tax:${keys.taxIdNormalized}` : undefined,
      keys.primaryEmailNormalized ? `email:${keys.primaryEmailNormalized}` : undefined,
      keys.primaryPhoneNormalized ? `phone:${keys.primaryPhoneNormalized}` : undefined,
    ].filter((key): key is string => !!key).sort();
    for (const lockKey of lockKeys) {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer-duplicate:' || ${companyId} || ':' || ${lockKey}))::text`;
    }
  }

  private async findDuplicateCustomersWith(
    db: any,
    companyId: string,
    keys: CustomerDuplicateKeys,
    excludeId?: string,
  ): Promise<any[]> {
    const scope = { companyId, status: { in: ['ACTIVE', 'INACTIVE'] }, personalDataErasedAt: null, id: excludeId ? { not: excludeId } : undefined };
    const lookups: Promise<any[]>[] = [];
    if (keys.taxIdNormalized) lookups.push(db.crmCustomer.findMany({ where: { ...scope, taxIdNormalized: keys.taxIdNormalized } as any, orderBy: { id: 'asc' }, take: 20 }));
    if (keys.primaryEmailNormalized) lookups.push(db.crmCustomer.findMany({ where: { ...scope, primaryEmailNormalized: keys.primaryEmailNormalized } as any, orderBy: { id: 'asc' }, take: 20 }));
    if (keys.primaryPhoneNormalized) lookups.push(db.crmCustomer.findMany({ where: { ...scope, primaryPhoneNormalized: keys.primaryPhoneNormalized } as any, orderBy: { id: 'asc' }, take: 20 }));
    if (keys.nameNormalized) lookups.push(db.crmCustomer.findMany({ where: { ...scope, displayNameNormalized: keys.nameNormalized } as any, orderBy: { id: 'asc' }, take: 20 }));
    if (lookups.length === 0) return [];
    const rows = (await Promise.all(lookups)).flat();
    return [...new Map(rows.map((row) => [row.id, row])).values()];
  }

  private assertDuplicateWriteAllowed(candidates: any[], guard: CustomerDuplicateWriteGuard): void {
    const taxMatches = candidates.filter((candidate) => guard.keys.taxIdNormalized && candidate.taxIdNormalized === guard.keys.taxIdNormalized);
    if (taxMatches.length > 0) throw new Error('duplicate_tax_id');
    const exactMatches = candidates.filter((candidate) =>
      (guard.keys.primaryEmailNormalized && candidate.primaryEmailNormalized === guard.keys.primaryEmailNormalized)
      || (guard.keys.primaryPhoneNormalized && candidate.primaryPhoneNormalized === guard.keys.primaryPhoneNormalized));
    if (exactMatches.some((candidate) => !guard.canReadAll && candidate.ownerUserId !== guard.actorUserId)) {
      throw new Error('duplicate_candidate_requires_manager_review');
    }
    if (exactMatches.length > 0 && guard.duplicateOverride !== true) throw new Error('duplicate_customer_candidate');
  }

  private async appendCustomerMutationEvidence(db: any, input: {
    companyId: string;
    userId: string;
    requestId: string;
    reason?: string;
    action: string;
    eventType: string;
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
    targetCustomerId: string;
    operationKey: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    const eventKey = `${input.eventType}:crm_customer:${input.targetCustomerId}:${input.operationKey}:${input.requestId}`;
    const existing = await db.outboxEvent.findUnique({ where: { eventKey }, select: { id: true } });
    if (existing) return;
    await db.auditLog.create({
      data: {
        companyId: input.companyId,
        actorUserId: input.userId,
        action: input.action,
        targetType: 'crm_customer',
        targetId: input.targetCustomerId,
        requestId: input.requestId,
        result: 'SUCCESS',
        riskLevel: input.riskLevel ?? 'HIGH',
        metadataJson: { ...(input.reason ? { reasonProvided: true } : {}), ...input.data },
      },
    });
    await db.outboxEvent.create({
      data: {
        companyId: input.companyId,
        eventType: input.eventType,
        aggregateType: 'crm_customer',
        aggregateId: input.targetCustomerId,
        eventKey,
        payloadJson: {
          companyId: input.companyId,
          actorUserId: input.userId,
          requestId: input.requestId,
          aggregateType: 'crm_customer',
          aggregateId: input.targetCustomerId,
          occurredAt: new Date().toISOString(),
          data: input.data,
        },
        priority: input.riskLevel === 'LOW' ? 'NORMAL' : 'HIGH',
      },
    });
  }

  private async appendStandardCustomerEvidence(
    db: any,
    companyId: string,
    customerId: string,
    evidence: CustomerWriteEvidence,
  ): Promise<void> {
    await this.appendCustomerMutationEvidence(db, {
      companyId,
      userId: evidence.actorUserId,
      requestId: evidence.requestId,
      reason: evidence.reason,
      action: evidence.action,
      eventType: evidence.eventType,
      riskLevel: evidence.riskLevel,
      targetCustomerId: customerId,
      operationKey: evidence.operationKey,
      data: evidence.data,
    });
  }

  private async customerMergeImpactWith(db: any, companyId: string, customerId: string): Promise<CrmCustomerMergeImpact> {
    const [bookings, contacts, opportunities, activities, followUps, quotationLinks, convertedLeads, lineIdentities, conversations] = await Promise.all([
      db.crmBooking.count({ where: { companyId, customerId } }),
      db.crmContactPerson.count({ where: { companyId, customerId } }),
      db.crmOpportunity.count({ where: { companyId, customerId } }),
      db.crmActivity.count({ where: { companyId, customerId } }),
      db.crmFollowUpTask.count({ where: { companyId, customerId } }),
      db.crmQuotationLink.count({ where: { companyId, customerId } }),
      db.crmLead.count({ where: { companyId, convertedCustomerId: customerId } }),
      db.crmChannelIdentity.count({ where: { companyId, customerId } }),
      db.crmConversation.count({ where: { companyId, customerId } }),
    ]);
    return { bookings, contacts, opportunities, activities, followUps, quotationLinks, convertedLeads, lineIdentities, conversations };
  }

  private toContact(r: any): CrmContactRecord {
    return {
      id: r.id,
      companyId: r.companyId,
      customerId: r.customerId,
      name: r.name,
      role: opt(r.role),
      phone: opt(r.phone),
      email: opt(r.email),
      lineUserId: opt(r.lineUserId),
      preferredChannel: opt(r.preferredChannel),
      consentStatus: r.consentStatus,
      isPrimary: r.isPrimary,
      note: opt(r.note),
      status: r.status,
      createdByUserId: r.createdByUserId,
      updatedByUserId: opt(r.updatedByUserId),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private toLead(r: any): CrmLeadRecord {
    return {
      id: r.id,
      companyId: r.companyId,
      branchId: opt(r.branchId),
      source: r.source,
      rawName: opt(r.rawName),
      rawPhone: opt(r.rawPhone),
      rawEmail: opt(r.rawEmail),
      status: r.status,
      assignedToUserId: opt(r.assignedToUserId),
      note: opt(r.note),
      convertedCustomerId: opt(r.convertedCustomerId),
      convertedOpportunityId: opt(r.convertedOpportunityId),
      disqualifiedReason: opt(r.disqualifiedReason),
      disqualifiedAt: opt(r.disqualifiedAt),
      convertedAt: opt(r.convertedAt),
      createdByUserId: opt(r.createdByUserId),
      updatedByUserId: opt(r.updatedByUserId),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private toOpportunity(r: any): CrmOpportunityRecord {
    return {
      id: r.id,
      companyId: r.companyId,
      branchId: opt(r.branchId),
      customerId: r.customerId,
      customerDisplayName: r.customer?.displayName,
      leadId: opt(r.leadId),
      ownerUserId: r.ownerUserId,
      ownerTeamId: opt(r.ownerTeamId),
      title: r.title,
      stageId: r.stageId,
      canonicalStageGroup: r.canonicalStageGroup,
      status: r.status,
      amountEstimate: dec(r.amountEstimate),
      currency: r.currency,
      probability: opt(r.probability),
      expectedCloseDate: opt(r.expectedCloseDate),
      closedAt: opt(r.closedAt),
      closedByUserId: opt(r.closedByUserId),
      closeReason: opt(r.closeReason),
      lostReason: opt(r.lostReason),
      lastActivityAt: opt(r.lastActivityAt),
      nextFollowUpAt: opt(r.nextFollowUpAt),
      createdByUserId: r.createdByUserId,
      updatedByUserId: opt(r.updatedByUserId),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      quotationLinks: r.quotationLinks ? r.quotationLinks.map((q: any) => this.toQuotationLink(q)) : undefined,
    };
  }

  private toActivity(r: any): CrmActivityRecord {
    return {
      id: r.id,
      companyId: r.companyId,
      customerId: r.customerId,
      leadId: opt(r.leadId),
      opportunityId: opt(r.opportunityId),
      followUpTaskId: opt(r.followUpTaskId),
      actorUserId: r.actorUserId,
      type: r.type,
      channel: opt(r.channel),
      outcome: opt(r.outcome),
      note: r.note,
      occurredAt: r.occurredAt,
      createdAt: r.createdAt,
    };
  }

  private toFollowUp(r: any): CrmFollowUpRecord {
    return {
      id: r.id,
      companyId: r.companyId,
      customerId: opt(r.customerId),
      leadId: opt(r.leadId),
      opportunityId: opt(r.opportunityId),
      ownerUserId: r.ownerUserId,
      ownerTeamId: opt(r.ownerTeamId),
      title: r.title,
      dueAt: r.dueAt,
      timezone: r.timezone,
      priority: r.priority,
      channel: r.channel,
      status: r.status,
      completedAt: opt(r.completedAt),
      completedByUserId: opt(r.completedByUserId),
      snoozedUntil: opt(r.snoozedUntil),
      canceledAt: opt(r.canceledAt),
      canceledByUserId: opt(r.canceledByUserId),
      cancelReason: opt(r.cancelReason),
      createdByUserId: r.createdByUserId,
      updatedByUserId: opt(r.updatedByUserId),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private toQuotationLink(r: any): CrmQuotationLinkRecord {
    return {
      id: r.id,
      companyId: r.companyId,
      customerId: r.customerId,
      opportunityId: r.opportunityId,
      accountingDocumentId: r.accountingDocumentId,
      accountingDocumentType: r.accountingDocumentType,
      accountingDocumentNumber: opt(r.accountingDocumentNumber),
      status: r.status,
      grandTotalAmount: decOpt(r.grandTotalAmount),
      currency: r.currency,
      createdByUserId: r.createdByUserId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  // ---- มั่งมี Flow A bookings (spec D8) ----

  async getBookingBufferMinutes(companyId: string): Promise<number> {
    const company = await this.db.company.findUnique({ where: { id: companyId }, select: { bookingBufferMinutes: true } });
    return company?.bookingBufferMinutes ?? 60;
  }

  async updateBookingBufferMinutes(companyId: string, bufferMinutes: number): Promise<number> {
    const company = await this.db.company.update({ where: { id: companyId }, data: { bookingBufferMinutes: bufferMinutes }, select: { bookingBufferMinutes: true } });
    return company.bookingBufferMinutes;
  }

  /**
   * CUST-12: the committed appointment a "ขอเลื่อนนัด" would be about. Read from the BOOKING
   * table, never from the proposal state machine — a proposal can be CANCELLED or CONFLICTED
   * while a real booking stands, and can sit at BOOKED after staff cancelled the booking.
   */
  async findUpcomingBookedForConversation(
    companyId: string,
    conversationId: string,
    customerId: string,
    now: Date,
  ): Promise<{ id: string; startAt: Date; serviceName: string } | null> {
    const row = await this.db.crmBooking.findFirst({
      where: {
        companyId,
        status: 'BOOKED',
        startAt: { gt: now },
        OR: [{ sourceConversationId: conversationId }, { customerId }],
      },
      orderBy: { startAt: 'asc' },
      select: { id: true, startAt: true, serviceName: true },
    });
    return row ?? null;
  }

  async findBookingById(companyId: string, id: string): Promise<CrmBookingRecord | null> {
    const row = await this.db.crmBooking.findFirst({ where: { id, companyId } });
    return row ? this.toBooking(row) : null;
  }

  async listBookings(where: {
    companyId: string;
    branchId?: string;
    branchIds?: string[];
    customerOwnerUserId?: string;
    rangeStart: Date;
    rangeEnd: Date;
  }): Promise<CrmBookingRecord[]> {
    const rows = await this.db.crmBooking.findMany({
      where: {
        companyId: where.companyId,
        branchId: where.branchId,
        ...(!where.branchId && where.branchIds ? { branchId: { in: where.branchIds } } : {}),
        ...(where.customerOwnerUserId ? { customer: { ownerUserId: where.customerOwnerUserId } } : {}),
        status: { not: 'CANCELLED' },
        startAt: { gte: where.rangeStart, lt: where.rangeEnd },
      },
      orderBy: { startAt: 'asc' },
    });
    return rows.map((r) => this.toBooking(r));
  }

  async listBookingsForStaffOnDate(where: {
    companyId: string;
    branchId?: string;
    staffUserId: string;
    rangeStart: Date;
    rangeEnd: Date;
  }): Promise<CrmBookingRecord[]> {
    const rows = await this.db.crmBooking.findMany({
      where: {
        companyId: where.companyId,
        branchId: where.branchId,
        staffUserId: where.staffUserId,
        status: { not: 'CANCELLED' },
        startAt: { gte: where.rangeStart, lt: where.rangeEnd },
      },
      orderBy: { startAt: 'asc' },
    });
    return rows.map((r) => this.toBooking(r));
  }

  async findStaffDefaultBranch(companyId: string, userId: string): Promise<string | null> {
    const row = await this.db.companyMembership.findFirst({
      where: { companyId, userId, status: 'ACTIVE' },
      select: { defaultBranchId: true, branchScopeMode: true, branchScopes: { select: { branchId: true } } },
    });
    if (!row?.defaultBranchId) return null;
    if (row.branchScopeMode === 'SELECTED_BRANCHES' && !row.branchScopes.some((scope) => scope.branchId === row.defaultBranchId)) {
      return null;
    }
    const branch = await this.db.branch.findFirst({
      where: { id: row.defaultBranchId, companyId, status: 'ACTIVE' },
      select: { id: true },
    });
    return branch?.id ?? null;
  }

  async findActiveBranchName(companyId: string, branchId: string): Promise<string | null> {
    const branch = await this.db.branch.findFirst({
      where: { id: branchId, companyId, status: 'ACTIVE' },
      select: { name: true },
    });
    return branch?.name ?? null;
  }

  /** Booking staffUserId is canonically a User id — same check as the channel-settings seam. */
  async hasActiveCompanyMember(companyId: string, userId: string): Promise<boolean> {
    const row = await this.db.companyMembership.findFirst({
      where: { companyId, userId, status: 'ACTIVE' },
      select: { id: true },
    });
    return Boolean(row);
  }

  async hasActiveBranch(companyId: string, branchId: string): Promise<boolean> {
    const row = await this.db.branch.findFirst({ where: { id: branchId, companyId, status: 'ACTIVE' }, select: { id: true } });
    return Boolean(row);
  }

  async hasActiveAccountingCounterparty(companyId: string, counterpartyId: string): Promise<boolean> {
    const row = await this.db.accountingCounterparty.findFirst({
      where: { id: counterpartyId, companyId, status: 'ACTIVE' },
      select: { id: true },
    });
    return Boolean(row);
  }

  /** New customers created since an instant (A8 daily brief). */
  async countCustomersSince(companyId: string, since: Date): Promise<number> {
    return this.db.crmCustomer.count({ where: { companyId, createdAt: { gte: since } } });
  }

  /** New customers created within a period window (A8 daily brief, period-aware). */
  async countCustomersBetween(
    companyId: string,
    start: Date,
    end: Date,
    scope: { ownerUserId?: string; branchIds?: string[] } = {},
  ): Promise<number> {
    return this.db.crmCustomer.count({
      where: {
        companyId,
        ...(scope.ownerUserId ? { ownerUserId: scope.ownerUserId } : {}),
        ...(scope.branchIds ? { OR: [{ branchId: { in: scope.branchIds } }, { branchId: null }] } : {}),
        createdAt: { gte: start, lt: end },
      },
    });
  }

  /** BOOKED appointments starting within a window (A8 daily brief "appointments today"). */
  async countBookingsBetween(
    companyId: string,
    start: Date,
    end: Date,
    scope: { ownerUserId?: string; branchIds?: string[] } = {},
  ): Promise<number> {
    return this.db.crmBooking.count({
      where: {
        companyId,
        ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}),
        ...(scope.ownerUserId ? { customer: { ownerUserId: scope.ownerUserId } } : {}),
        status: 'BOOKED',
        startAt: { gte: start, lt: end },
      },
    });
  }

  /** Bookings for a customer's Customer-360 appointments tab (A7), newest start first. */
  async listBookingsForCustomer(companyId: string, customerId: string, limit = 50, branchIds?: string[]): Promise<CrmBookingRecord[]> {
    const rows = await this.db.crmBooking.findMany({
      where: {
        companyId,
        customerId,
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
      },
      orderBy: { startAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toBooking(r));
  }

  /** A7 reminder sweep: due unsent rows plus crash-orphaned claims after the lease. */
  async findDueBookingReminders(
    now: Date,
    leadMs: number,
    limit: number,
    claimStaleMs = 2 * 60_000,
    maxAttempts = 5,
  ): Promise<CrmBookingRecord[]> {
    const rows = await this.db.crmBooking.findMany({
      where: {
        status: 'BOOKED',
        reminderSentAt: null,
        reminderAttemptCount: { lt: maxAttempts },
        AND: [
          { OR: [{ reminderNextAttemptAt: null }, { reminderNextAttemptAt: { lte: now } }] },
          { OR: [{ reminderClaimedAt: null }, { reminderClaimedAt: { lt: new Date(now.getTime() - claimStaleMs) } }] },
        ],
        startAt: { gt: now, lte: new Date(now.getTime() + leadMs) },
        customer: { status: 'ACTIVE', personalDataErasedAt: null },
      },
      orderBy: { startAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => this.toBooking(r));
  }

  /** Lease one reminder attempt; stale scanners cannot double-send. */
  async claimBookingReminder(id: string, at: Date, claimStaleMs: number, maxAttempts: number): Promise<boolean> {
    const result = await this.db.crmBooking.updateMany({
      where: {
        id,
        status: 'BOOKED',
        reminderSentAt: null,
        reminderAttemptCount: { lt: maxAttempts },
        AND: [
          { OR: [{ reminderNextAttemptAt: null }, { reminderNextAttemptAt: { lte: at } }] },
          { OR: [{ reminderClaimedAt: null }, { reminderClaimedAt: { lt: new Date(at.getTime() - claimStaleMs) } }] },
        ],
        startAt: { gt: at },
        customer: { status: 'ACTIVE', personalDataErasedAt: null },
      },
      data: {
        reminderClaimedAt: at,
        reminderAttemptCount: { increment: 1 },
        reminderNextAttemptAt: null,
        reminderLastError: null,
      },
    });
    return result.count > 0;
  }

  async completeBookingReminder(id: string, claimedAt: Date, completedAt: Date, lastError?: string): Promise<boolean> {
    const result = await this.db.crmBooking.updateMany({
      where: { id, reminderSentAt: null, reminderClaimedAt: claimedAt },
      data: {
        reminderSentAt: completedAt,
        reminderClaimedAt: null,
        reminderNextAttemptAt: null,
        reminderLastError: lastError ?? null,
      },
    });
    return result.count > 0;
  }

  async releaseBookingReminderForRetry(
    id: string,
    claimedAt: Date,
    nextAttemptAt: Date,
    error: string,
  ): Promise<boolean> {
    const result = await this.db.crmBooking.updateMany({
      where: { id, reminderSentAt: null, reminderClaimedAt: claimedAt },
      data: {
        reminderClaimedAt: null,
        reminderNextAttemptAt: nextAttemptAt,
        reminderLastError: error,
      },
    });
    return result.count > 0;
  }

  /** Compatibility helper for direct callers that already completed delivery. */
  async markBookingReminderSent(id: string, at: Date): Promise<boolean> {
    const result = await this.db.crmBooking.updateMany({
      where: { id, reminderSentAt: null, customer: { status: 'ACTIVE', personalDataErasedAt: null } },
      data: { reminderSentAt: at, reminderClaimedAt: null, reminderNextAttemptAt: null },
    });
    return result.count > 0;
  }

  /** Any non-cancelled booking for the same staff member overlapping [startAt, endAt), excluding `excludeId`. */
  async findOverlappingBooking(params: BookingWindow): Promise<CrmBookingRecord | null> {
    const bufferMinutes = await this.getBookingBufferMinutes(params.companyId);
    const row = await this.db.crmBooking.findFirst({
      where: bookingOverlapWhere(params, bufferMinutes),
    });
    return row ? this.toBooking(row) : null;
  }

  async createBooking(data: BookingCreateData): Promise<CrmBookingRecord> {
    return this.db.$transaction(async (tx: any) => {
      await this.lockAndRequireActiveCustomer(tx, data.companyId, data.customerId);
      const row = await tx.crmBooking.create({ data });
      return this.toBooking(row);
    });
  }

  async createBookingIfSlotFree(data: BookingCreateData, guard?: BookingWriteGuard): Promise<CrmBookingRecord | null> {
    return this.writeBookingIfSlotFree(
      { ...data, staffUserId: data.staffUserId ?? null },
      (tx) => tx.crmBooking.create({ data }),
      guard,
    );
  }

  async updateBookingIfSlotFree(params: BookingWindow & {
    id: string;
    expectedCustomerId?: string;
    targetCustomerId?: string;
    data: Record<string, unknown>;
  }): Promise<CrmBookingRecord | null> {
    return this.db.$transaction(async (tx: any) => {
      const customerIds = [params.expectedCustomerId, params.targetCustomerId].filter((id): id is string => !!id);
      await this.lockCustomerIds(tx, params.companyId, customerIds);
      const booking = await tx.crmBooking.findFirst({ where: { id: params.id, companyId: params.companyId } });
      if (!booking) throw new Error('booking_not_found');
      if (booking.customerId !== (params.expectedCustomerId ?? null)) throw new Error('booking_customer_changed');
      if (params.targetCustomerId) await this.lockAndRequireActiveCustomer(tx, params.companyId, params.targetCustomerId);
      if (params.staffUserId) {
        const activeStaff = await tx.companyMembership.findFirst({
          where: { companyId: params.companyId, userId: params.staffUserId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!activeStaff) throw new Error('staff_not_company_member');
      }
      const staffLockKey = params.staffUserId ?? 'unassigned';
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${params.companyId} || ':' || ${staffLockKey}))::text`;
      const company = await tx.company.findUnique({ where: { id: params.companyId }, select: { bookingBufferMinutes: true } });
      const clash = await tx.crmBooking.findFirst({ where: bookingOverlapWhere({ ...params, excludeId: params.id }, company?.bookingBufferMinutes ?? 60) });
      if (clash) return null;
      const result = await tx.crmBooking.updateMany({
        where: { id: params.id, companyId: params.companyId, customerId: params.expectedCustomerId ?? null, status: 'BOOKED' },
        data: {
          ...params.data,
          customerId: params.targetCustomerId ?? booking.customerId,
          staffUserId: params.staffUserId,
          startAt: params.startAt,
          endAt: params.endAt,
        },
      });
      if (result.count !== 1) throw new Error('booking_changed');
      const row = await tx.crmBooking.findFirst({ where: { id: params.id, companyId: params.companyId } });
      if (!row) throw new Error('booking_not_found');
      return this.toBooking(row);
    });
  }

  async updateBooking(
    companyId: string,
    id: string,
    data: Record<string, unknown>,
    guard?: { expectedCustomerId?: string; targetCustomerId?: string },
  ): Promise<CrmBookingRecord> {
    if (!guard) {
      const row = await this.db.crmBooking.update({ where: { id }, data });
      return this.toBooking(row);
    }
    return this.db.$transaction(async (tx: any) => {
      const customerIds = [guard.expectedCustomerId, guard.targetCustomerId].filter((customerId): customerId is string => !!customerId);
      await this.lockCustomerIds(tx, companyId, customerIds);
      const booking = await tx.crmBooking.findFirst({ where: { id, companyId } });
      if (!booking) throw new Error('booking_not_found');
      if (booking.customerId !== (guard.expectedCustomerId ?? null)) throw new Error('booking_customer_changed');
      if (guard.targetCustomerId) await this.lockAndRequireActiveCustomer(tx, companyId, guard.targetCustomerId);
      const result = await tx.crmBooking.updateMany({
        where: { id, companyId, customerId: guard.expectedCustomerId ?? null, status: 'BOOKED' },
        data: { ...data, customerId: guard.targetCustomerId ?? booking.customerId },
      });
      if (result.count !== 1) throw new Error('booking_changed');
      const row = await tx.crmBooking.findFirst({ where: { id, companyId } });
      if (!row) throw new Error('booking_not_found');
      return this.toBooking(row);
    });
  }

  private async writeBookingIfSlotFree(
    window: BookingWindow,
    write: (tx: any) => Promise<any>,
    guard?: BookingWriteGuard,
  ): Promise<CrmBookingRecord | null> {
    return this.db.$transaction(async (tx: any) => {
      const branchId = window.branchId;
      if (branchId) {
        const activeBranch = await tx.branch.findFirst({ where: { id: branchId, companyId: window.companyId, status: 'ACTIVE' }, select: { id: true } });
        if (!activeBranch) throw new Error('branch_not_active_in_company');
      }
      if (window.staffUserId) {
        const activeStaff = await tx.companyMembership.findFirst({
          where: { companyId: window.companyId, userId: window.staffUserId, status: 'ACTIVE' },
          select: {
            id: true,
            defaultBranchId: true,
            branchScopeMode: true,
            branchScopes: { select: { branchId: true } },
          },
        });
        if (!activeStaff) throw new Error('staff_not_company_member');
        if (guard?.rejectRevokedConsent && branchId) {
          const canAccessBranch =
            activeStaff.branchScopeMode === 'ALL_BRANCHES' ||
            (activeStaff.branchScopeMode === 'DEFAULT_BRANCH_ONLY' && activeStaff.defaultBranchId === branchId) ||
            (activeStaff.branchScopeMode === 'SELECTED_BRANCHES' &&
              activeStaff.branchScopes.some((scope: { branchId: string }) => scope.branchId === branchId));
          if (!canAccessBranch) throw new Error('staff_branch_not_accessible');
        }
      }
      if (window.customerId) {
        const customer = await this.lockAndRequireActiveCustomer(tx, window.companyId, window.customerId);
        if (guard?.rejectRevokedConsent && customer.consentStatus === 'REVOKED') throw new Error('customer_consent_revoked');
        if (
          guard?.requireCustomerContact &&
          (
            !customer.displayName?.trim() ||
            customer.displayName === 'ลูกค้า LINE' ||
            !normalizePhone(customer.primaryPhone)
          )
        ) {
          throw new Error('booking_contact_required');
        }
        if (
          guard?.expectedCustomerContact &&
          (
            normalizeName(customer.displayName) !== normalizeName(guard.expectedCustomerContact.displayName) ||
            normalizePhone(customer.primaryPhone) !== normalizePhone(guard.expectedCustomerContact.primaryPhone)
          )
        ) {
          throw new Error('booking_review_changed');
        }
      }
      // CUST-02: final kill-switch fence, inside the txn — a throw rolls back before any write.
      if (guard?.assertWithinTx) await guard.assertWithinTx(tx);
      // ponytail: upgrade to a btree_gist exclusion constraint when schema changes are allowed.
      const staffLockKey = window.staffUserId ?? 'unassigned';
      // ::text cast: pg_advisory_xact_lock returns void, which the Prisma pg adapter cannot deserialize.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${window.companyId} || ':' || ${staffLockKey}))::text`;
      const company = await tx.company.findUnique({ where: { id: window.companyId }, select: { bookingBufferMinutes: true } });
      const clash = await tx.crmBooking.findFirst({ where: bookingOverlapWhere(window, company?.bookingBufferMinutes ?? 60) });
      if (clash) return null;
      const bookingRow = await write(tx);
      // CUST-02: finalize the proposal in the SAME txn — a throw (lost race) rolls the booking back.
      if (guard?.finalizeWithinTx) await guard.finalizeWithinTx(tx, bookingRow);
      return this.toBooking(bookingRow);
    });
  }

  private toBooking(r: any): CrmBookingRecord {
    return {
      id: r.id,
      companyId: r.companyId,
      branchId: r.branchId,
      customerId: opt(r.customerId),
      customerName: opt(r.customerName),
      serviceName: r.serviceName,
      staffUserId: opt(r.staffUserId),
      startAt: r.startAt,
      endAt: r.endAt,
      status: r.status,
      source: opt(r.source),
      sourceConversationId: opt(r.sourceConversationId),
      reminderSentAt: opt(r.reminderSentAt),
      reminderClaimedAt: opt(r.reminderClaimedAt),
      reminderAttemptCount: r.reminderAttemptCount ?? 0,
      reminderNextAttemptAt: opt(r.reminderNextAttemptAt),
      reminderLastError: opt(r.reminderLastError),
      createdByUserId: r.createdByUserId,
      updatedByUserId: opt(r.updatedByUserId),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
