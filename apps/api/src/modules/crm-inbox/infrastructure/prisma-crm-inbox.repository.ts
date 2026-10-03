import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import type {
  CompanyMessagingChannelRecord,
  CrmAutonomyJobRecord,
  CrmChannelIdentityRecord,
  CrmConversationRecord,
  CrmInboxPolicyRecord,
  CrmMessageRecord,
  CrmMessageTemplateRecord,
} from '../domain/models/crm-inbox.model';
import type { ConsentUnsubscribePolicy, CrmConsentStatus, CrmConversationStatus } from '@watchdog-bms/contracts';
import {
  MANDATORY_MARKETING_UNSUBSCRIBE_KEYWORDS,
  withMandatoryMarketingUnsubscribeKeywords,
} from '@watchdog-bms/contracts';
import { pdpaLineIdentifierLookupCandidates, pseudonymizePdpaLineIdentifier } from '../domain/logic/crm-inbox.logic';
import { redactPersonalData } from '../domain/logic/pdpa-audit-redaction.logic';
import { findAttachmentLinkConflict } from '../../data-model-core/domain/logic/attachment.logic';
import { AuditAction } from '../../audit/domain/models/audit-action';
import { AUTONOMY_JOB_MAX_ATTEMPTS } from '../domain/crm-inbox.constants';

const CONSENT_DEFAULTS: ConsentUnsubscribePolicy = {
  marketingRequiresExplicitConsent: true,
  transactionalMessagesRemainEnabledAfterMarketingOptOut: true,
  unsubscribeKeywords: [...MANDATORY_MARKETING_UNSUBSCRIBE_KEYWORDS],
  unsubscribeConfirmationText: 'ยกเลิกข่าวสารและโปรโมชันเรียบร้อยแล้ว การยกเลิกนี้ไม่กระทบข้อความเกี่ยวกับการจองหรือบริการที่คุณใช้',
};

// Item 15A persistence. All reads scope by companyId except the webhook-key
// lookup, which is the public webhook's channel resolver.

/** Half-open [start, end) window used to scope report queries by conversation creation time. */
export type ReportDateRange = { start: Date; end: Date };

type CrmCustomerAggregateScope = {
  ownerUserId?: string;
  branchIds?: string[];
};

/** Customer-row scope shared by daily-brief conversation aggregates. */
function customerRowWhere(scope: CrmCustomerAggregateScope = {}): Record<string, unknown> {
  return {
    ...(scope.ownerUserId ? { ownerUserId: scope.ownerUserId } : {}),
    ...(scope.branchIds ? { OR: [{ branchId: { in: scope.branchIds } }, { branchId: null }] } : {}),
  };
}

function conversationCustomerWhere(scope: CrmCustomerAggregateScope = {}): Record<string, unknown> {
  const customer = customerRowWhere(scope);
  return Object.keys(customer).length > 0 ? { customer } : {};
}

export type ConversationActorScope = {
  actorUserId: string;
  canAccessAll: boolean;
  expectedAssignedToUserId: string | null;
};

// A customer erasure intentionally performs keyed, per-row identifier rewrites.
// Keep it bounded, but above Prisma's 5s default so a large history can finish
// atomically instead of predictably timing out after the destructive work begins.
const PDPA_ERASURE_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 } as const;

// L-11 redacts audit/outbox rows one row at a time (field-level, not blanket
// overwrite); page them so the erasure never loads an unbounded history at once.
const PDPA_REDACTION_BATCH_SIZE = 500;

/** Prisma `createdAt` filter for a report period; empty when no range is given. */
function createdWithin(range?: ReportDateRange): Record<string, unknown> {
  return range ? { createdAt: { gte: range.start, lt: range.end } } : {};
}

@Injectable()
export class PrismaCrmInboxRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config?: AppConfigService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private pdpaLineIdentifier(
    kind: 'provider-user' | 'provider-message' | 'webhook-event',
    scope: string,
    raw: string,
  ): string {
    if (!this.config) throw new Error('line_identifier_key_not_configured');
    return pseudonymizePdpaLineIdentifier(kind, scope, raw, this.config.pdpaPseudonymizationKeyRing.current);
  }

  private pdpaLineIdentifierCandidates(
    kind: 'provider-user' | 'provider-message' | 'webhook-event',
    scope: string,
    raw: string,
  ): string[] {
    if (!this.config) throw new Error('line_identifier_key_not_configured');
    return pdpaLineIdentifierLookupCandidates(kind, scope, raw, this.config.pdpaPseudonymizationKeyRing);
  }

  async getConsentPolicy(companyId: string): Promise<ConsentUnsubscribePolicy> {
    const row = await this.db.companyBusinessPolicy.findUnique({ where: { companyId }, select: { consentPolicyJson: true } });
    const policy = { ...CONSENT_DEFAULTS, ...(row?.consentPolicyJson as Partial<ConsentUnsubscribePolicy> | undefined) };
    return {
      ...policy,
      unsubscribeKeywords: withMandatoryMarketingUnsubscribeKeywords(policy.unsubscribeKeywords),
    };
  }

  /** Atomic transition makes webhook races/redeliveries emit at most one confirmation. */
  async revokeMarketingConsent(companyId: string, customerId: string, now: Date): Promise<boolean> {
    const result = await this.db.crmCustomer.updateMany({
      where: { id: customerId, companyId, consentStatus: { not: 'REVOKED' } },
      data: { consentStatus: 'REVOKED', consentUpdatedAt: now, consentNote: 'LINE unsubscribe keyword' },
    });
    return result.count === 1;
  }

  // ---- Channels ----

  async createChannel(data: Record<string, unknown>): Promise<CompanyMessagingChannelRecord> {
    const row = await this.db.companyMessagingChannel.create({ data: data as any });
    return this.toChannel(row);
  }

  async updateChannel(id: string, data: Record<string, unknown>): Promise<CompanyMessagingChannelRecord> {
    const row = await this.db.companyMessagingChannel.update({ where: { id }, data: data as any });
    return this.toChannel(row);
  }

  async findChannelById(companyId: string, id: string): Promise<CompanyMessagingChannelRecord | null> {
    const row = await this.db.companyMessagingChannel.findFirst({ where: { id, companyId } });
    return row ? this.toChannel(row) : null;
  }

  /**
   * CUST-02: transaction-coupled kill-switch fence for an autonomous booking
   * commit. FOR SHARE row locks on the channel + conversation serialize against
   * an operator's autonomy-toggle UPDATE, so a disable that commits after this
   * read cannot slip a booking through. Throws when autonomy is off; the throw
   * rolls the booking transaction back (fail-closed, no booking).
   */
  async assertAutonomyEnabledWithinTx(tx: any, companyId: string, channelId: string, conversationId: string): Promise<void> {
    const channelRows = await tx.$queryRaw`
      SELECT "status", "autoReplyEnabled" FROM "CompanyMessagingChannel"
      WHERE "id" = ${channelId} AND "companyId" = ${companyId} FOR SHARE`;
    const channel = channelRows?.[0];
    if (!channel || channel.status !== 'ACTIVE' || channel.autoReplyEnabled !== true) throw new Error('autonomy_disabled_at_commit');
    const conversationRows = await tx.$queryRaw`
      SELECT "autoReplyEnabled" FROM "CrmConversation"
      WHERE "id" = ${conversationId} AND "companyId" = ${companyId} FOR SHARE`;
    const conversation = conversationRows?.[0];
    if (!conversation || conversation.autoReplyEnabled !== true) throw new Error('autonomy_disabled_at_commit');
  }

  async findChannelByWebhookKey(webhookKey: string): Promise<CompanyMessagingChannelRecord | null> {
    const row = await this.db.companyMessagingChannel.findUnique({ where: { webhookKey } });
    return row ? this.toChannel(row) : null;
  }

  /** Global lookup used to block the same LINE channel connecting twice (any company). */
  async findActiveChannelByLineChannelId(lineChannelId: string): Promise<CompanyMessagingChannelRecord | null> {
    const row = await this.db.companyMessagingChannel.findFirst({
      where: { lineChannelId, status: { not: 'DISABLED' } },
    });
    return row ? this.toChannel(row) : null;
  }

  /** Company-scoped lookup INCLUDING disabled rows — reconnect revives these. */
  async findCompanyChannelByLineChannelId(companyId: string, lineChannelId: string): Promise<CompanyMessagingChannelRecord | null> {
    const row = await this.db.companyMessagingChannel.findFirst({
      where: { companyId, provider: 'LINE_OA', lineChannelId },
    });
    return row ? this.toChannel(row) : null;
  }

  async listChannels(companyId: string): Promise<CompanyMessagingChannelRecord[]> {
    const rows = await this.db.companyMessagingChannel.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r: any) => this.toChannel(r));
  }

  async hasActiveCompanyMember(companyId: string, userId: string): Promise<boolean> {
    const row = await this.db.companyMembership.findFirst({
      where: { companyId, userId, status: 'ACTIVE' },
      select: { id: true },
    });
    return Boolean(row);
  }

  async hasCompanyBranch(companyId: string, branchId: string): Promise<boolean> {
    const row = await this.db.branch.findFirst({
      where: { companyId, id: branchId, status: 'ACTIVE' },
      select: { id: true },
    });
    return Boolean(row);
  }

  async hasActiveBookingStaffBranch(companyId: string, userId: string, branchId: string): Promise<boolean> {
    const membership = await this.db.companyMembership.findFirst({
      where: { companyId, userId, status: 'ACTIVE' },
      select: {
        defaultBranchId: true,
        branchScopeMode: true,
        branchScopes: { select: { branchId: true } },
      },
    });
    if (!membership || !await this.hasCompanyBranch(companyId, branchId)) return false;
    if (membership.branchScopeMode === 'ALL_BRANCHES') return true;
    if (membership.branchScopeMode === 'DEFAULT_BRANCH_ONLY') return membership.defaultBranchId === branchId;
    return membership.branchScopes.some((scope) => scope.branchId === branchId);
  }

  /**
   * Webhook heartbeat. CONNECTED flips to ACTIVE only when a real customer
   * message arrived — LINE's console Verify ping (empty events) must not
   * claim "receiving customer messages" (spec 9.1(5)).
   */
  async touchChannelWebhook(id: string, at: Date, hasCustomerMessage: boolean): Promise<void> {
    await this.db.companyMessagingChannel.updateMany({
      where: { id },
      data: { lastWebhookAt: at },
    });
    if (hasCustomerMessage) {
      await this.db.companyMessagingChannel.updateMany({
        where: { id, status: 'CONNECTED' },
        data: { status: 'ACTIVE' },
      });
    }
  }

  // ---- Channel identities ----

  async findIdentity(channelId: string, providerUserId: string): Promise<CrmChannelIdentityRecord | null> {
    let row = await this.db.crmChannelIdentity.findUnique({
      where: { channelId_providerUserId: { channelId, providerUserId } },
    });
    if (!row) {
      for (const candidate of this.pdpaLineIdentifierCandidates('provider-user', channelId, providerUserId)) {
        row = await this.db.crmChannelIdentity.findUnique({
          where: {
            channelId_providerUserId: {
              channelId,
              providerUserId: candidate,
            },
          },
        });
        if (row) break;
      }
    }
    return row ? this.toIdentity(row) : null;
  }

  async createIdentity(data: Record<string, unknown>): Promise<CrmChannelIdentityRecord> {
    const row = await this.db.crmChannelIdentity.create({ data: data as any });
    return this.toIdentity(row);
  }

  async updateIdentity(id: string, data: Record<string, unknown>): Promise<CrmChannelIdentityRecord> {
    const row = await this.db.crmChannelIdentity.update({ where: { id }, data: data as any });
    return this.toIdentity(row);
  }

  /** Follow/unfollow lifecycle writes must never revive or mutate an erased identity. */
  async updateIdentityLifecycleUnlessErased(input: {
    companyId: string;
    identityId: string;
    expectedCustomerId: string;
    status: 'ACTIVE' | 'UNFOLLOWED';
    followedAt?: Date | null;
    unfollowedAt?: Date | null;
  }): Promise<CrmChannelIdentityRecord | null> {
    return this.db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer-identity-graph:' || ${input.companyId}))::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-line-identity:' || ${input.companyId} || ':' || ${input.identityId}))::text`;
      const identity = await tx.crmChannelIdentity.findFirst({
        where: { id: input.identityId, companyId: input.companyId, customerId: input.expectedCustomerId },
        select: { id: true, customerId: true },
      });
      if (!identity) return null;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer:' || ${input.companyId} || ':' || ${identity.customerId}))::text`;
      const customer = await tx.crmCustomer.findFirst({
        where: { id: identity.customerId, companyId: input.companyId, status: 'ACTIVE', personalDataErasedAt: null },
        select: { id: true },
      });
      if (!customer) return null;
      const updated = await tx.crmChannelIdentity.updateMany({
        where: { id: identity.id, companyId: input.companyId, customerId: customer.id },
        data: {
          status: input.status,
          ...(input.followedAt === undefined ? {} : { followedAt: input.followedAt }),
          ...(input.unfollowedAt === undefined ? {} : { unfollowedAt: input.unfollowedAt }),
        },
      });
      if (updated.count !== 1) return null;
      const row = await tx.crmChannelIdentity.findFirst({ where: { id: identity.id, companyId: input.companyId } });
      return row ? this.toIdentity(row) : null;
    });
  }

  /** Final profile-enrichment write. The customer tombstone wins over any in-flight LINE fetch. */
  async updateIdentityProfileUnlessErased(input: {
    companyId: string;
    identityId: string;
    expectedCustomerId: string;
    displayName: string | null;
    pictureUrl: string | null;
    placeholderName: string;
    updatedByUserId: string;
  }): Promise<boolean> {
    return this.db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer-identity-graph:' || ${input.companyId}))::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-line-identity:' || ${input.companyId} || ':' || ${input.identityId}))::text`;
      const discovered = await tx.crmChannelIdentity.findFirst({
        where: { id: input.identityId, companyId: input.companyId },
        select: { customerId: true },
      });
      if (!discovered || discovered.customerId !== input.expectedCustomerId) return false;

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer:' || ${input.companyId} || ':' || ${discovered.customerId}))::text`;
      const identity = await tx.crmChannelIdentity.findFirst({
        where: { id: input.identityId, companyId: input.companyId },
        select: { id: true, customerId: true },
      });
      if (!identity || identity.customerId !== discovered.customerId) return false;
      const customer = await tx.crmCustomer.findFirst({
        where: { id: identity.customerId, companyId: input.companyId, personalDataErasedAt: null },
        select: { id: true, displayName: true },
      });
      if (!customer) return false;

      await tx.crmChannelIdentity.update({
        where: { id: identity.id },
        data: { displayName: input.displayName, pictureUrl: input.pictureUrl },
      });
      if (input.displayName && customer.displayName === input.placeholderName) {
        await tx.crmCustomer.updateMany({
          where: { id: customer.id, companyId: input.companyId, personalDataErasedAt: null, displayName: input.placeholderName },
          data: {
            displayName: input.displayName,
            displayNameNormalized: input.displayName.trim().toLowerCase().replace(/\s+/g, ' '),
            updatedByUserId: input.updatedByUserId,
          },
        });
      }
      return true;
    });
  }

  async registerExistingIdentityConsent(input: {
    companyId: string;
    channelId: string;
    identityId: string;
    now: Date;
    consentNote: string;
    updatedByUserId: string;
  }): Promise<{ customerId: string }> {
    return this.db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer-identity-graph:' || ${input.companyId}))::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-line-identity:' || ${input.companyId} || ':' || ${input.identityId}))::text`;
      const discoveredIdentity = await tx.crmChannelIdentity.findFirst({
        where: { id: input.identityId, companyId: input.companyId, channelId: input.channelId },
      });
      if (!discoveredIdentity) throw new Error('line_identity_not_found');

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer:' || ${input.companyId} || ':' || ${discoveredIdentity.customerId}))::text`;
      const identity = await tx.crmChannelIdentity.findFirst({
        where: { id: input.identityId, companyId: input.companyId, channelId: input.channelId },
      });
      if (!identity || identity.customerId !== discoveredIdentity.customerId) throw new Error('line_identity_changed');
      const customer = await tx.crmCustomer.findFirst({
        where: { id: identity.customerId, companyId: input.companyId, status: 'ACTIVE', personalDataErasedAt: null },
        select: { id: true },
      });
      if (!customer) throw new Error('customer_not_active');

      const updated = await tx.crmCustomer.updateMany({
        where: { id: customer.id, companyId: input.companyId, status: 'ACTIVE', personalDataErasedAt: null },
        data: {
          consentStatus: 'GRANTED',
          consentUpdatedAt: input.now,
          consentNote: input.consentNote,
          updatedByUserId: input.updatedByUserId,
        },
      });
      if (updated.count !== 1) throw new Error('customer_not_active');
      if (!identity.verifiedLinkAt || identity.verifiedLinkVia !== 'LIFF') {
        await tx.crmChannelIdentity.update({
          where: { id: identity.id },
          data: { verifiedLinkAt: input.now, verifiedLinkVia: 'LIFF' },
        });
      }
      return { customerId: customer.id };
    });
  }

  // ---- Conversations ----

  async findLatestConversationForIdentity(companyId: string, channelIdentityId: string): Promise<CrmConversationRecord | null> {
    const row = await this.db.crmConversation.findFirst({
      where: { companyId, channelIdentityId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toConversation(row) : null;
  }

  async createConversation(data: Record<string, unknown>): Promise<{ conversation: CrmConversationRecord; created: boolean }> {
    const companyId = data['companyId'];
    const channelId = data['channelId'];
    const channelIdentityId = data['channelIdentityId'];
    if (typeof companyId !== 'string' || typeof channelId !== 'string' || typeof channelIdentityId !== 'string') {
      throw new Error('invalid_conversation_identity_scope');
    }

    return this.db.$transaction(async (tx: any) => {
      // Topology mutations (merge/relink) take this first. New conversations
      // are infrequent, so a company-scoped lock is the smallest safe way to
      // keep the identity graph stable while resolving the canonical customer.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer-identity-graph:' || ${companyId}))::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-line-identity:' || ${companyId} || ':' || ${channelIdentityId}))::text`;

      const discoveredIdentity = await tx.crmChannelIdentity.findFirst({
        where: { id: channelIdentityId, companyId, channelId },
        select: { customerId: true },
      });
      if (!discoveredIdentity) throw new Error('line_identity_not_found');

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer:' || ${companyId} || ':' || ${discoveredIdentity.customerId}))::text`;
      const identity = await tx.crmChannelIdentity.findFirst({
        where: { id: channelIdentityId, companyId, channelId },
        select: { customerId: true },
      });
      if (!identity || identity.customerId !== discoveredIdentity.customerId) {
        throw new Error('line_identity_changed');
      }
      const customer = await tx.crmCustomer.findFirst({
        where: { id: identity.customerId, companyId, status: 'ACTIVE', personalDataErasedAt: null },
        select: { id: true },
      });
      if (!customer) throw new Error('customer_not_active');

      // The optimistic lookup in the use-case keeps the common path cheap;
      // this locked lookup is the race backstop for concurrent first messages.
      const latest = await tx.crmConversation.findFirst({
        where: { companyId, channelIdentityId },
        orderBy: { createdAt: 'desc' },
      });
      if (latest && latest.status !== 'RESOLVED') {
        const canonical = latest.customerId === customer.id
          ? latest
          : await tx.crmConversation.update({ where: { id: latest.id }, data: { customerId: customer.id } });
        return { conversation: this.toConversation(canonical), created: false };
      }

      const row = await tx.crmConversation.create({
        data: { ...data, customerId: customer.id } as any,
      });
      return { conversation: this.toConversation(row), created: true };
    });
  }

  /** Reopens a resolved conversation when the customer writes back inside the window. */
  async reopenConversation(companyId: string, id: string, firstResponseDueAt: Date): Promise<CrmConversationRecord | null> {
    return this.db.$transaction(async (tx: any) => {
      const live = await this.lockLiveConversationCustomer(tx, companyId, id);
      if (!live) return null;
      const row = await tx.crmConversation.update({
        where: { id },
        data: {
          status: 'OPEN',
          resolvedAt: null,
          resolvedByUserId: null,
          reopenedCount: { increment: 1 },
          firstResponseDueAt,
          firstRespondedAt: null,
          slaBreachedAt: null,
        },
      });
      return this.toConversation(row);
    });
  }

  async findConversationById(companyId: string, id: string): Promise<CrmConversationRecord | null> {
    const row = await this.db.crmConversation.findFirst({ where: { id, companyId } });
    return row ? this.toConversation(row) : null;
  }

  /** Unanswered: no first staff reply yet and not resolved or spam, due or not. */
  private unansweredWhere(): Record<string, unknown> {
    return { status: { notIn: ['RESOLVED', 'SPAM'] }, firstRespondedAt: null };
  }

  /** First-response SLA overdue: customer still waiting for the first reply past due. */
  private overdueWhere(now: Date): Record<string, unknown> {
    return { ...this.unansweredWhere(), firstResponseDueAt: { lt: now } };
  }

  async listConversations(
    companyId: string,
    filter: {
      status?: string;
      search?: string;
      overdue?: boolean;
      /** Still waiting for the first staff reply (the dashboard card "ยังไม่ได้ตอบ" opens this list). */
      unanswered?: boolean;
      tag?: string;
      /** Exact assignee filter: user id, or null for the unassigned queue. */
      assignedToUserId?: string | null;
      /** ABAC visibility: limit to this user's own/assigned + unassigned rows. */
      scopeUserId?: string;
      /** Only this customer's conversations (Customer 360). */
      customerId?: string;
      /** Daily-brief customer ownership boundary, intersected with inbox assignment scope. */
      customerOwnerUserId?: string;
      /** Daily-brief customer branch boundary; null company-central customers remain visible. */
      customerBranchIds?: string[];
      page: number;
      pageSize: number;
    },
    now = new Date(),
  ): Promise<{ items: CrmConversationRecord[]; total: number }> {
    const customerScope = {
      ...(filter.customerOwnerUserId ? { ownerUserId: filter.customerOwnerUserId } : {}),
      ...(filter.customerBranchIds ? { branchIds: filter.customerBranchIds } : {}),
    };
    const where: Record<string, unknown> = { companyId, ...conversationCustomerWhere(customerScope) };
    // Spam is muted out of every view except an explicit SPAM filter.
    where['status'] = filter.status ?? { not: 'SPAM' };
    if (filter.overdue) Object.assign(where, this.overdueWhere(now));
    if (filter.unanswered) Object.assign(where, this.unansweredWhere());
    // jsonb containment (@>) on the tags array — exact tag match.
    if (filter.tag) where['tagsJson'] = { array_contains: [filter.tag] };
    if (filter.assignedToUserId !== undefined) where['assignedToUserId'] = filter.assignedToUserId;
    if (filter.customerId) where['customerId'] = filter.customerId;
    const and: Record<string, unknown>[] = [];
    if (filter.scopeUserId) {
      and.push({ OR: [{ assignedToUserId: filter.scopeUserId }, { assignedToUserId: null }] });
    }
    if (filter.search) {
      // No Prisma relation from conversation to customer — resolve name matches first.
      const matching = await this.db.crmCustomer.findMany({
        where: { companyId, ...customerRowWhere(customerScope), displayName: { contains: filter.search, mode: 'insensitive' } },
        select: { id: true },
        take: 200,
      });
      and.push({
        OR: [
          { lastMessagePreview: { contains: filter.search, mode: 'insensitive' } },
          { customerId: { in: matching.map((m: any) => m.id) } },
        ],
      });
    }
    if (and.length > 0) where['AND'] = and;
    const [rows, total] = await Promise.all([
      this.db.crmConversation.findMany({
        where: where as any,
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      this.db.crmConversation.count({ where: where as any }),
    ]);
    return { items: rows.map((r: any) => this.toConversation(r)), total };
  }

  /** Chip counts within the caller's visibility scope: per-status + overdue + unanswered + mine/unassigned. */
  async conversationCounts(
    companyId: string,
    meUserId: string,
    scopeUserId?: string,
    now = new Date(),
  ): Promise<{ statusCounts: Record<string, number>; overdueCount: number; unansweredCount: number; mineCount: number; unassignedCount: number }> {
    const scoped: Record<string, unknown> = { companyId };
    if (scopeUserId) scoped['OR'] = [{ assignedToUserId: scopeUserId }, { assignedToUserId: null }];
    const notSpam = { status: { not: 'SPAM' } };
    const [grouped, overdueCount, mineCount, unassignedCount, unansweredCount] = await Promise.all([
      this.db.crmConversation.groupBy({
        by: ['status'],
        where: scoped as any,
        _count: { _all: true },
      }),
      this.db.crmConversation.count({ where: { ...scoped, ...this.overdueWhere(now) } as any }),
      this.db.crmConversation.count({ where: { companyId, assignedToUserId: meUserId, ...notSpam } as any }),
      this.db.crmConversation.count({ where: { companyId, assignedToUserId: null, ...notSpam } as any }),
      this.db.crmConversation.count({ where: { ...scoped, ...this.unansweredWhere() } as any }),
    ]);
    const statusCounts: Record<string, number> = {};
    for (const g of grouped as any[]) statusCounts[g.status] = g._count._all;
    return { statusCounts, overdueCount, unansweredCount, mineCount, unassignedCount };
  }

  async reportsBranchCustomerIds(companyId: string, branchId?: string, ownerUserId?: string): Promise<string[]> {
    const rows = await this.db.crmCustomer.findMany({
      where: {
        companyId,
        personalDataErasedAt: null,
        ...(branchId ? { branchId } : {}),
        ...(ownerUserId ? { ownerUserId } : {}),
      },
      select: { id: true },
    });
    return rows.map((r: any) => r.id);
  }

  async reportsStatusCounts(companyId: string, customerIds?: string[], range?: ReportDateRange): Promise<{ status: CrmConversationStatus; count: number }[]> {
    const grouped = await this.db.crmConversation.groupBy({
      by: ['status'],
      where: {
        companyId,
        status: { not: 'SPAM' },
        ...(customerIds ? { customerId: { in: customerIds } } : {}),
        ...createdWithin(range),
      } as any,
      _count: { _all: true },
    });
    return grouped.map((g: any) => ({ status: g.status, count: g._count._all }));
  }

  async reportsOverdueCount(companyId: string, customerIds: string[] | undefined, now: Date, range?: ReportDateRange): Promise<number> {
    return this.db.crmConversation.count({
      where: {
        companyId,
        ...this.overdueWhere(now),
        ...(customerIds ? { customerId: { in: customerIds } } : {}),
        ...createdWithin(range),
      } as any,
    });
  }

  async reportsRespondedDurationsMin(companyId: string, customerIds?: string[], range?: ReportDateRange): Promise<number[]> {
    const rows = await this.db.crmConversation.findMany({
      where: {
        companyId,
        status: { not: 'SPAM' },
        firstRespondedAt: { not: null },
        ...(customerIds ? { customerId: { in: customerIds } } : {}),
        ...createdWithin(range),
      } as any,
      select: { createdAt: true, firstRespondedAt: true },
    });
    return rows
      .filter((r: any) => r.firstRespondedAt)
      .map((r: any) => Math.max(0, Math.round((r.firstRespondedAt.getTime() - r.createdAt.getTime()) / 60000)));
  }

  async reportsStaff(companyId: string, customerIds?: string[], range?: ReportDateRange): Promise<{ userId: string | null; assigned: number; resolved: number }[]> {
    const scope = { ...(customerIds ? { customerId: { in: customerIds } } : {}), ...createdWithin(range) };
    const [assignedRows, resolvedRows] = await Promise.all([
      this.db.crmConversation.groupBy({
        by: ['assignedToUserId'],
        where: { companyId, status: { not: 'SPAM' }, ...scope } as any,
        _count: { _all: true },
      }),
      this.db.crmConversation.groupBy({
        by: ['assignedToUserId'],
        where: { companyId, status: 'RESOLVED', ...scope } as any,
        _count: { _all: true },
      }),
    ]);
    const byUser = new Map<string | null, { userId: string | null; assigned: number; resolved: number }>();
    for (const g of assignedRows as any[]) {
      const userId = g.assignedToUserId ?? null;
      byUser.set(userId, { userId, assigned: g._count._all, resolved: 0 });
    }
    for (const g of resolvedRows as any[]) {
      const userId = g.assignedToUserId ?? null;
      const existing = byUser.get(userId) ?? { userId, assigned: 0, resolved: 0 };
      existing.resolved = g._count._all;
      byUser.set(userId, existing);
    }
    return [...byUser.values()];
  }

  async reportsCustomersWithCounterparty(
    companyId: string,
    branchId?: string,
    ownerUserId?: string,
    branchIds?: string[],
  ): Promise<{ id: string; displayName: string; accountingCounterpartyId: string }[]> {
    const rows = await this.db.crmCustomer.findMany({
      where: {
        companyId,
        accountingCounterpartyId: { not: null },
        personalDataErasedAt: null,
        status: { notIn: ['ARCHIVED', 'MERGED'] },
        ...(branchId ? { branchId } : {}),
        ...(!branchId && branchIds ? { OR: [{ branchId: { in: branchIds } }, { branchId: null }] } : {}),
        ...(ownerUserId ? { ownerUserId } : {}),
      } as any,
      select: { id: true, displayName: true, accountingCounterpartyId: true },
    });
    return rows
      .filter((r: any) => r.accountingCounterpartyId)
      .map((r: any) => ({ id: r.id, displayName: r.displayName, accountingCounterpartyId: r.accountingCounterpartyId }));
  }

  /** Early redelivery check — company-scoped, matching the unique constraint. */
  async findMessageByProviderId(companyId: string, providerMessageId: string): Promise<CrmMessageRecord | null> {
    let row = await this.db.crmMessage.findUnique({
      where: { companyId_providerMessageId: { companyId, providerMessageId } },
    });
    if (!row) {
      for (const candidate of this.pdpaLineIdentifierCandidates('provider-message', companyId, providerMessageId)) {
        row = await this.db.crmMessage.findUnique({
          where: {
            companyId_providerMessageId: {
              companyId,
              providerMessageId: candidate,
            },
          },
        });
        if (row) break;
      }
    }
    return row ? this.toMessage(row) : null;
  }

  async listMessages(companyId: string, conversationId: string, take = 200): Promise<CrmMessageRecord[]> {
    const rows = await this.db.crmMessage.findMany({
      where: { companyId, conversationId },
      orderBy: { createdAt: 'asc' },
      // Negative take = the LAST n rows of the ascending set: threads longer
      // than n keep their newest tail (still oldest→newest for the UI), not a
      // frozen oldest-n window that never shows new messages.
      take: -take,
    });
    return rows.map((r: any) => this.toMessage(r));
  }

  async findLatestCustomerOutboundMessage(
    companyId: string,
    conversationId: string,
    createdAfter?: Date,
  ): Promise<CrmMessageRecord | null> {
    const row = await this.db.crmMessage.findFirst({
      where: {
        companyId,
        conversationId,
        direction: 'OUTBOUND',
        visibility: 'CUSTOMER',
        deliveryStatus: 'SENT',
        ...(createdAfter ? { createdAt: { gt: createdAfter } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toMessage(row) : null;
  }

  async findLatestBookingPromptMessage(
    companyId: string,
    conversationId: string,
    proposalId: string,
  ): Promise<CrmMessageRecord | null> {
    const row = await this.db.crmMessage.findFirst({
      where: {
        companyId,
        conversationId,
        direction: 'OUTBOUND',
        visibility: 'CUSTOMER',
        deliveryStatus: 'SENT',
        contentJson: { path: ['proposalId'], equals: proposalId },
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toMessage(row) : null;
  }

  /** Customer display names for a set of conversations (list rendering). */
  async customerDisplayNames(companyId: string, customerIds: string[]): Promise<Map<string, string>> {
    if (customerIds.length === 0) return new Map();
    const rows = await this.db.crmCustomer.findMany({
      where: { companyId, id: { in: customerIds } },
      select: { id: true, displayName: true },
    });
    return new Map(rows.map((r: any) => [r.id, r.displayName]));
  }

  /** Assignee display names ("ดูแลโดย" in the inbox list). */
  async userDisplayNames(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, displayName: true },
    });
    return new Map(rows.map((r: any) => [r.id, r.displayName]));
  }

  async updateConversation(
    companyId: string,
    id: string,
    data: Record<string, unknown>,
    actorScope?: ConversationActorScope,
  ): Promise<CrmConversationRecord | null> {
    return this.db.$transaction(async (tx: any) => {
      const live = await this.lockLiveConversationCustomer(tx, companyId, id);
      if (!live) return null;
      if (actorScope) this.assertConversationActorScope(live, actorScope);
      const { count } = await tx.crmConversation.updateMany({
        where: {
          id,
          companyId,
          customerId: live.customerId,
          ...(actorScope ? { assignedToUserId: actorScope.expectedAssignedToUserId } : {}),
        },
        data: data as any,
      });
      if (count === 0) return null;
      const row = await tx.crmConversation.findFirst({ where: { id, companyId, customerId: live.customerId } });
      return row ? this.toConversation(row) : null;
    });
  }

  /**
   * Assignment is a security boundary: the selected assignee must still be an
   * active member when the locked conversation write commits. The use-case
   * performs the same check early for a useful 400; this closes the revocation
   * race and prevents later SLA notifications leaking customer data outside
   * the company.
   */
  async assignConversation(
    companyId: string,
    id: string,
    assignedToUserId: string | null,
    actorScope: ConversationActorScope & { canAssignAll: boolean },
  ): Promise<CrmConversationRecord | null> {
    return this.db.$transaction(async (tx: any) => {
      const live = await this.lockLiveConversationCustomer(tx, companyId, id);
      if (!live) return null;
      this.assertConversationActorScope(live, actorScope);
      if (!actorScope.canAssignAll) {
        const pickup = live.assignedToUserId === null && assignedToUserId === actorScope.actorUserId;
        const releaseOwn = live.assignedToUserId === actorScope.actorUserId && assignedToUserId === null;
        if (!pickup && !releaseOwn) throw new Error('conversation_assignment_not_authorized');
      }
      if (assignedToUserId) {
        const membership = await tx.companyMembership.findFirst({
          where: { companyId, userId: assignedToUserId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!membership) throw new Error('assignee_not_active_company_member');
      }
      const { count } = await tx.crmConversation.updateMany({
        where: {
          id,
          companyId,
          customerId: live.customerId,
          assignedToUserId: actorScope.expectedAssignedToUserId,
        },
        data: { assignedToUserId },
      });
      if (count === 0) return null;
      const row = await tx.crmConversation.findFirst({
        where: { id, companyId, customerId: live.customerId },
      });
      return row ? this.toConversation(row) : null;
    });
  }

  async countChannelAiOutboundMessagesSince(companyId: string, channelId: string, since: Date): Promise<number> {
    // ponytail: relation scan is enough for P3 volume; add a channel/day message index if this cap check gets hot.
    return this.db.crmMessage.count({
      where: {
        companyId,
        direction: 'OUTBOUND',
        authorType: 'AI',
        createdAt: { gte: since },
        conversation: { channelId },
      } as any,
    });
  }

  /** Staff opened the thread — inbound messages are considered read. */
  async markConversationRead(companyId: string, id: string, actorScope: ConversationActorScope): Promise<void> {
    await this.db.$transaction(async (tx: any) => {
      const live = await this.lockLiveConversationCustomer(tx, companyId, id);
      if (!live) return;
      this.assertConversationActorScope(live, actorScope);
      await tx.crmConversation.updateMany({
        where: {
          id,
          companyId,
          customerId: live.customerId,
          assignedToUserId: actorScope.expectedAssignedToUserId,
          unreadCount: { gt: 0 },
        },
        data: { unreadCount: 0 },
      });
    });
  }

  /**
   * Appends a staff outbound message (reply or internal note) and applies the
   * conversation update in one transaction. Delivery status is finalized
   * afterwards via updateMessageDelivery once the provider call returns.
   */
  async appendOutboundMessage(
    messageData: Record<string, unknown>,
    conversationId: string,
    conversationUpdate: Record<string, unknown>,
    actorScope?: ConversationActorScope,
  ): Promise<CrmMessageRecord> {
    const companyId = typeof messageData['companyId'] === 'string' ? messageData['companyId'] : '';
    if (!companyId || messageData['conversationId'] !== conversationId) throw new Error('invalid_message_conversation_scope');
    return this.db.$transaction(async (tx: any) => {
      const live = await this.lockLiveConversationCustomer(tx, companyId, conversationId);
      if (!live) throw new Error('customer_personal_data_erased');
      if (actorScope) this.assertConversationActorScope(live, actorScope);
      if (messageData['authorType'] === 'STAFF' && !actorScope) throw new Error('conversation_actor_scope_required');
      const row = await tx.crmMessage.create({ data: messageData as any });
      const updated = await tx.crmConversation.updateMany({
        where: {
          id: conversationId,
          companyId,
          customerId: live.customerId,
          ...(actorScope ? { assignedToUserId: actorScope.expectedAssignedToUserId } : {}),
        },
        data: conversationUpdate as any,
      });
      if (updated.count !== 1) throw new Error('conversation_assignment_changed');
      return this.toMessage(row);
    });
  }

  async updateMessageDelivery(id: string, data: Record<string, unknown>): Promise<CrmMessageRecord | null> {
    const discovered = await this.db.crmMessage.findFirst({
      where: { id },
      select: { companyId: true, conversationId: true },
    });
    if (!discovered) return null;
    return this.db.$transaction(async (tx: any) => {
      const live = await this.lockLiveConversationCustomer(tx, discovered.companyId, discovered.conversationId);
      if (!live) return null;
      const updated = await tx.crmMessage.updateMany({
        where: { id, companyId: discovered.companyId, conversationId: discovered.conversationId },
        data: data as any,
      });
      if (updated.count !== 1) return null;
      const row = await tx.crmMessage.findFirst({
        where: { id, companyId: discovered.companyId, conversationId: discovered.conversationId },
      });
      return row ? this.toMessage(row) : null;
    });
  }

  /** Marks why inbound media could not be stored (rendered as an honest placeholder). */
  async updateMessageContentJson(id: string, contentJson: Record<string, unknown>): Promise<boolean> {
    const discovered = await this.db.crmMessage.findFirst({
      where: { id },
      select: { companyId: true, conversationId: true },
    });
    if (!discovered) return false;
    return this.db.$transaction(async (tx: any) => {
      const live = await this.lockLiveConversationCustomer(tx, discovered.companyId, discovered.conversationId);
      if (!live) return false;
      const updated = await tx.crmMessage.updateMany({
        where: { id, companyId: discovered.companyId, conversationId: discovered.conversationId, attachmentId: null },
        data: { contentJson: contentJson as any },
      });
      return updated.count === 1;
    });
  }

  /**
   * Persists downloaded LINE media atomically: attachment metadata + bytes +
   * message link in one transaction. Bytes live in Postgres (AttachmentBlob)
   * because it is the only store surviving redeploys today — see schema note.
   */
  async storeInboundMediaAttachment(input: {
    attachmentId: string;
    companyId: string;
    messageId: string;
    originalFileName: string;
    mimeType: string;
    data: Buffer;
    checksumSha256: string;
  }): Promise<boolean> {
    const now = new Date();
    const discovered = await this.db.crmMessage.findFirst({
      where: { id: input.messageId, companyId: input.companyId },
      select: { conversationId: true },
    });
    if (!discovered) return false;
    return this.db.$transaction(async (tx: any) => {
      const live = await this.lockLiveConversationCustomer(tx, input.companyId, discovered.conversationId);
      if (!live) return false;
      const message = await tx.crmMessage.findFirst({
        where: { id: input.messageId, companyId: input.companyId, conversationId: discovered.conversationId, attachmentId: null },
        select: { id: true },
      });
      if (!message) return false;
      await tx.attachmentObject.create({
        data: {
          id: input.attachmentId,
          companyId: input.companyId,
          storageProvider: 'db',
          bucket: 'attachment-blob',
          objectKey: `crm-media/${input.companyId}/${input.messageId}`,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          byteSize: input.data.length,
          checksumSha256: input.checksumSha256,
          visibility: 'INTERNAL',
          status: 'ACTIVE',
          uploadedByUserId: 'system',
          uploadedAt: now,
        },
      });
      await tx.attachmentBlob.create({
        // new Uint8Array(...) copies into a plain ArrayBuffer — Prisma's Bytes type.
        data: { attachmentId: input.attachmentId, companyId: input.companyId, data: new Uint8Array(input.data) },
      });
      const updated = await tx.crmMessage.updateMany({
        where: { id: input.messageId, companyId: input.companyId, conversationId: discovered.conversationId, attachmentId: null },
        data: { attachmentId: input.attachmentId },
      });
      if (updated.count !== 1) throw new Error('inbound_media_message_changed');
      return true;
    });
  }

  /** Live-customer message scoped to its conversation — the inbox content boundary. */
  async findMessageInConversation(companyId: string, conversationId: string, messageId: string): Promise<CrmMessageRecord | null> {
    const row = await this.db.crmMessage.findFirst({
      where: { id: messageId, companyId, conversationId, conversation: { customer: { personalDataErasedAt: null } } },
    });
    return row ? this.toMessage(row) : null;
  }

  /** Stored media bytes + serving metadata; null when missing or not DB-stored. */
  async findAttachmentBlob(
    companyId: string,
    attachmentId: string,
  ): Promise<{ data: Buffer; mimeType: string; fileName: string } | null> {
    const row = await this.db.attachmentBlob.findFirst({
      where: { attachmentId, companyId, attachment: { status: 'ACTIVE' } },
      include: { attachment: { select: { mimeType: true, originalFileName: true } } },
    });
    if (!row) return null;
    return {
      data: Buffer.from(row.data),
      mimeType: row.attachment.mimeType,
      fileName: row.attachment.originalFileName,
    };
  }

  /** Finance-only retained media: exact message + exact payment-proof purpose. */
  async findPaymentProofAttachmentBlob(
    companyId: string,
    conversationId: string,
    messageId: string,
    targetType: string,
    purpose: string,
  ): Promise<{ data: Buffer; mimeType: string; fileName: string } | null> {
    const message = await this.db.crmMessage.findFirst({
      where: {
        id: messageId,
        companyId,
        conversationId,
        direction: 'INBOUND',
        messageType: { in: ['IMAGE', 'FILE'] },
        attachmentId: { not: null },
      },
      select: { attachmentId: true },
    });
    if (!message?.attachmentId) return null;
    const link = await this.db.attachmentLink.findFirst({
      where: {
        companyId,
        attachmentId: message.attachmentId,
        targetType,
        targetId: conversationId,
        purpose,
        attachment: { companyId, status: 'ACTIVE' },
      },
      include: { attachment: { include: { blob: true } } },
    });
    if (!link?.attachment.blob) return null;
    return {
      data: Buffer.from(link.attachment.blob.data),
      mimeType: link.attachment.mimeType,
      fileName: link.attachment.originalFileName,
    };
  }

  /** Identity behind a conversation — the LINE push target. */
  async findIdentityById(companyId: string, id: string): Promise<CrmChannelIdentityRecord | null> {
    const row = await this.db.crmChannelIdentity.findFirst({ where: { id, companyId } });
    return row ? this.toIdentity(row) : null;
  }

  /**
   * Appends an inbound message and updates conversation counters atomically.
   * Returns null when the providerMessageId already exists (webhook redelivery).
   */
  async appendInboundMessage(
    messageData: Record<string, unknown>,
    conversationId: string,
    conversationUpdate: Record<string, unknown>,
  ): Promise<CrmMessageRecord | null> {
    try {
      const companyId = typeof messageData['companyId'] === 'string' ? messageData['companyId'] : '';
      if (!companyId || messageData['conversationId'] !== conversationId) throw new Error('invalid_message_conversation_scope');
      return await this.db.$transaction(async (tx: any) => {
        const live = await this.lockLiveConversationCustomer(tx, companyId, conversationId);
        // A webhook after erasure is acknowledged by the caller as a no-op. A
        // future re-onboarding flow must explicitly create/rebind a new record.
        if (!live) return null;
        await tx.crmConversation.update({
          where: { id: conversationId },
          data: { ...(conversationUpdate as any), unreadCount: { increment: 1 } },
        });
        return this.toMessage(await tx.crmMessage.create({ data: messageData as any }));
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return null; // duplicate providerMessageId
      throw error;
    }
  }

  async createAutonomyJob(data: {
    companyId: string;
    conversationId: string;
    messageId: string;
    replyToken?: string;
    replyTokenAt?: Date;
  }): Promise<CrmAutonomyJobRecord | null> {
    return this.db.$transaction(async (tx: any) => {
      const live = await this.lockLiveConversationCustomer(tx, data.companyId, data.conversationId);
      if (!live) return null;
      return this.toAutonomyJob(await tx.crmAutonomyJob.create({ data }));
    });
  }

  async updateAutonomyJob(id: string, data: Record<string, unknown>): Promise<CrmAutonomyJobRecord | null> {
    const discovered = await this.db.crmAutonomyJob.findUnique({
      where: { id },
      select: { companyId: true, conversationId: true },
    });
    if (!discovered) return null;
    return this.db.$transaction(async (tx: any) => {
      const live = await this.lockLiveConversationCustomer(tx, discovered.companyId, discovered.conversationId);
      if (!live) return null;
      return this.toAutonomyJob(await tx.crmAutonomyJob.update({ where: { id }, data: data as any }));
    });
  }

  // ---- Row mappers ----

  private toChannel(row: any): CompanyMessagingChannelRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      provider: row.provider,
      displayName: row.displayName,
      lineChannelId: row.lineChannelId,
      encryptedSecretJson: row.encryptedSecretJson,
      credentialLast4: row.credentialLast4,
      secretVersion: row.secretVersion,
      webhookKey: row.webhookKey,
      status: row.status,
      lastWebhookAt: row.lastWebhookAt,
      lastValidatedAt: row.lastValidatedAt,
      lastErrorAt: row.lastErrorAt,
      lastErrorCode: row.lastErrorCode,
      connectedByUserId: row.connectedByUserId,
      disabledAt: row.disabledAt,
      disabledByUserId: row.disabledByUserId,
      disableReason: row.disableReason,
      autoReplyEnabled: row.autoReplyEnabled,
      autoReplyDailyCap: row.autoReplyDailyCap,
      defaultBookingStaffUserId: row.defaultBookingStaffUserId,
      defaultBookingBranchId: row.defaultBookingBranchId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toIdentity(row: any): CrmChannelIdentityRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      channelId: row.channelId,
      customerId: row.customerId,
      provider: row.provider,
      providerUserId: row.providerUserId,
      displayName: row.displayName,
      pictureUrl: row.pictureUrl,
      followedAt: row.followedAt,
      unfollowedAt: row.unfollowedAt,
      verifiedLinkAt: row.verifiedLinkAt,
      verifiedLinkVia: row.verifiedLinkVia,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toAutonomyJob(row: any): CrmAutonomyJobRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      conversationId: row.conversationId,
      messageId: row.messageId,
      replyToken: row.replyToken,
      replyTokenAt: row.replyTokenAt,
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ---- Message templates (quick replies) ----

  async listTemplates(companyId: string, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE'): Promise<CrmMessageTemplateRecord[]> {
    const rows = await this.db.crmMessageTemplate.findMany({
      where: { companyId, status },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    });
    return rows.map((r) => this.toTemplate(r));
  }

  async findTemplateById(companyId: string, id: string): Promise<CrmMessageTemplateRecord | null> {
    const row = await this.db.crmMessageTemplate.findFirst({ where: { id, companyId } });
    return row ? this.toTemplate(row) : null;
  }

  async findActiveTemplateByTitle(companyId: string, title: string): Promise<CrmMessageTemplateRecord | null> {
    const row = await this.db.crmMessageTemplate.findFirst({ where: { companyId, title, status: 'ACTIVE' } });
    return row ? this.toTemplate(row) : null;
  }

  async createTemplate(input: {
    companyId: string;
    title: string;
    bodyText: string;
    category?: string;
    createdByUserId: string;
  }): Promise<CrmMessageTemplateRecord> {
    const row = await this.db.crmMessageTemplate.create({
      data: {
        companyId: input.companyId,
        title: input.title,
        bodyText: input.bodyText,
        category: input.category,
        createdByUserId: input.createdByUserId,
      },
    });
    return this.toTemplate(row);
  }

  async updateTemplate(
    companyId: string,
    id: string,
    data: {
      title?: string;
      bodyText?: string;
      category?: string | null;
      status?: 'ACTIVE' | 'ARCHIVED';
      version?: number;
      aiApprovedVersion?: number | null;
      aiApprovedAt?: Date | null;
      aiApprovedByUserId?: string | null;
      updatedByUserId: string;
    },
  ): Promise<CrmMessageTemplateRecord | null> {
    const existing = await this.db.crmMessageTemplate.findFirst({ where: { id, companyId } });
    if (!existing) return null;
    const row = await this.db.crmMessageTemplate.update({ where: { id }, data });
    return this.toTemplate(row);
  }

  async approveTemplateVersionForAi(
    companyId: string,
    id: string,
    version: number,
    userId: string,
  ): Promise<CrmMessageTemplateRecord | null> {
    const updated = await this.db.crmMessageTemplate.updateMany({
      where: { id, companyId, status: 'ACTIVE', version },
      data: {
        aiApprovedVersion: version,
        aiApprovedAt: new Date(),
        aiApprovedByUserId: userId,
        updatedByUserId: userId,
      },
    });
    if (updated.count !== 1) return null;
    const record = await this.findTemplateById(companyId, id);
    return record?.version === version && record.aiApprovedVersion === version ? record : null;
  }

  private toTemplate(row: any): CrmMessageTemplateRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      title: row.title,
      bodyText: row.bodyText,
      category: row.category,
      status: row.status,
      version: row.version,
      aiApprovedVersion: row.aiApprovedVersion,
      aiApprovedAt: row.aiApprovedAt,
      aiApprovedByUserId: row.aiApprovedByUserId,
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ---- Inbox policy (first-response SLA settings) ----

  async getInboxPolicy(companyId: string): Promise<CrmInboxPolicyRecord | null> {
    const row = await this.db.crmInboxPolicy.findUnique({ where: { companyId } });
    return row ? this.toInboxPolicy(row) : null;
  }

  async upsertInboxPolicy(
    companyId: string,
    data: { firstResponseMinutes: number; businessHoursJson: unknown; updatedByUserId: string },
  ): Promise<CrmInboxPolicyRecord> {
    const values = {
      firstResponseMinutes: data.firstResponseMinutes,
      businessHoursJson: (data.businessHoursJson ?? undefined) as any,
      updatedByUserId: data.updatedByUserId,
    };
    const row = await this.db.crmInboxPolicy.upsert({
      where: { companyId },
      create: { companyId, ...values },
      // Prisma skips undefined — null business hours must clear the column explicitly.
      update: { ...values, businessHoursJson: (data.businessHoursJson ?? null) as any },
    });
    return this.toInboxPolicy(row);
  }

  private toInboxPolicy(row: any): CrmInboxPolicyRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      firstResponseMinutes: row.firstResponseMinutes,
      businessHoursJson: row.businessHoursJson ?? null,
      updatedByUserId: row.updatedByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ---- SLA breach scan (global — the worker sweeps all companies in one pass) ----

  async findSlaBreachCandidates(now: Date, limit: number): Promise<CrmConversationRecord[]> {
    const rows = await this.db.crmConversation.findMany({
      where: {
        ...this.overdueWhere(now),
        slaBreachedAt: null,
        customer: { status: 'ACTIVE', personalDataErasedAt: null },
      },
      orderBy: { firstResponseDueAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => this.toConversation(r));
  }

  /** Recently-created, still-unanswered, unassigned conversations for the new-chat notify scan (A4). */
  async findNewUnassignedConversations(now: Date, windowMs: number, limit: number): Promise<CrmConversationRecord[]> {
    const rows = await this.db.crmConversation.findMany({
      where: {
        status: 'NEW',
        assignedToUserId: null,
        firstRespondedAt: null,
        createdAt: { gte: new Date(now.getTime() - windowMs) },
        customer: { status: 'ACTIVE', personalDataErasedAt: null },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => this.toConversation(r));
  }

  // ---- A8 daily brief counts ----

  /** Flagged payment proofs awaiting finance verification. */
  async countPaymentProofs(
    companyId: string,
    targetType: string,
    purpose: string,
    scope: CrmCustomerAggregateScope = {},
  ): Promise<number> {
    if (!scope.ownerUserId && scope.branchIds === undefined) {
      return this.db.attachmentLink.count({ where: { companyId, targetType, purpose } });
    }
    const ownerFilter = scope.ownerUserId
      ? Prisma.sql`AND customer."ownerUserId" = ${scope.ownerUserId}`
      : Prisma.empty;
    const branchFilter = scope.branchIds === undefined
      ? Prisma.empty
      : scope.branchIds.length === 0
        ? Prisma.sql`AND customer."branchId" IS NULL`
        : Prisma.sql`AND (customer."branchId" IN (${Prisma.join(scope.branchIds)}) OR customer."branchId" IS NULL)`;
    const rows = await this.db.$queryRaw<Array<{ count: bigint | number | string }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "count"
      FROM "AttachmentLink" AS link
      INNER JOIN "CrmConversation" AS conversation
        ON conversation."companyId" = link."companyId"
        AND conversation."id" = link."targetId"
      INNER JOIN "CrmCustomer" AS customer
        ON customer."companyId" = conversation."companyId"
        AND customer."id" = conversation."customerId"
      WHERE link."companyId" = ${companyId}
        AND link."targetType" = ${targetType}
        AND link."purpose" = ${purpose}
        ${ownerFilter}
        ${branchFilter}
    `);
    return Number(rows[0]?.count ?? 0);
  }

  /** Most-recent active LINE identity for a customer — the push target for A7 reminders. */
  async findActiveIdentityForCustomer(companyId: string, customerId: string): Promise<CrmChannelIdentityRecord | null> {
    const row = await this.db.crmChannelIdentity.findFirst({
      where: { companyId, customerId, status: 'ACTIVE', customer: { status: 'ACTIVE', personalDataErasedAt: null } },
      orderBy: { updatedAt: 'desc' },
    });
    return row ? this.toIdentity(row) : null;
  }

  /**
   * Serializes a final LINE side effect with merge/relink and PDPA erasure.
   * The callback is only a timeout-bounded adapter call (up to 30s for media),
   * so the lock cannot turn an unbounded worker into a DB transaction. If
   * erasure wins first, no provider call starts.
   */
  async withLiveCustomerLock<T>(
    input: {
      companyId: string;
      customerId: string;
      conversationId?: string;
      channelIdentityId?: string;
      actorScope?: ConversationActorScope;
      suppressPendingMessageIdOnScopeFailure?: string;
    },
    callback: (identity: CrmChannelIdentityRecord, consentStatus: CrmConsentStatus) => Promise<T>,
  ): Promise<T | null> {
    if (input.conversationId && !input.channelIdentityId) {
      throw new Error('invalid_live_customer_scope');
    }
    const outcome = await this.db.$transaction(async (tx: any): Promise<
      { kind: 'none' } | { kind: 'scope'; code: string } | { kind: 'value'; value: T }
    > => {
      const customer = await this.lockLiveCustomer(tx, input.companyId, input.customerId);
      if (!customer) return { kind: 'none' };
      if (input.conversationId) {
        const conversation = await tx.crmConversation.findFirst({
          where: {
            id: input.conversationId,
            companyId: input.companyId,
            customerId: customer.id,
            channelIdentityId: input.channelIdentityId,
          },
          select: { id: true, assignedToUserId: true },
        });
        if (!conversation) return { kind: 'none' };
        if (input.actorScope) {
          try {
            this.assertConversationActorScope(conversation, input.actorScope);
          } catch (error) {
            const code = error instanceof Error ? error.message : String(error);
            if (input.suppressPendingMessageIdOnScopeFailure) {
              await tx.crmMessage.updateMany({
                where: {
                  id: input.suppressPendingMessageIdOnScopeFailure,
                  companyId: input.companyId,
                  conversationId: input.conversationId,
                  direction: 'OUTBOUND',
                  visibility: 'CUSTOMER',
                  authorType: 'STAFF',
                  authorUserId: input.actorScope.actorUserId,
                  deliveryStatus: 'PENDING',
                },
                data: {
                  deliveryStatus: 'FAILED',
                  deliveryError: 'conversation_out_of_scope',
                  deliveryNextAttemptAt: null,
                },
              });
            }
            return { kind: 'scope', code };
          }
        }
      }
      const identity = await tx.crmChannelIdentity.findFirst({
        where: {
          companyId: input.companyId,
          customerId: customer.id,
          status: 'ACTIVE',
          ...(input.channelIdentityId ? { id: input.channelIdentityId } : {}),
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (!identity) return { kind: 'none' };
      return { kind: 'value', value: await callback(this.toIdentity(identity), customer.consentStatus) };
    }, { maxWait: 5_000, timeout: 35_000 });
    if (outcome.kind === 'scope') throw new Error(outcome.code);
    return outcome.kind === 'value' ? outcome.value : null;
  }

  /** Serializes a non-LINE side effect that contains live customer data with erasure. */
  async withLiveCustomerDataLock<T>(
    input: {
      companyId: string;
      customerId: string;
      conversationId?: string;
      rejectRevokedConsent?: boolean;
      actorScope?: ConversationActorScope;
    },
    callback: (consentStatus: CrmConsentStatus) => Promise<T>,
  ): Promise<T | null> {
    return this.db.$transaction(async (tx: any) => {
      const customer = await this.lockLiveCustomer(tx, input.companyId, input.customerId);
      if (!customer) return null;
      if (input.rejectRevokedConsent && customer.consentStatus === 'REVOKED') return null;
      if (input.conversationId) {
        const conversation = await tx.crmConversation.findFirst({
          where: { id: input.conversationId, companyId: input.companyId, customerId: customer.id },
          select: { id: true, assignedToUserId: true },
        });
        if (!conversation) return null;
        if (input.actorScope) this.assertConversationActorScope(conversation, input.actorScope);
      }
      return callback(customer.consentStatus);
    }, { maxWait: 5_000, timeout: 35_000 });
  }

  /**
   * Claims, sends, and settles one retry attempt while holding the customer
   * lifecycle lock. A stale scanner snapshot can neither call the provider nor
   * overwrite a newer delivery/erasure outcome.
   */
  async processPendingReplyAttempt<T>(
    input: {
      companyId: string;
      customerId: string;
      conversationId: string;
      messageId: string;
      expectedAttemptCount: number;
    },
    callback: (
      scope: {
        channel: CompanyMessagingChannelRecord | null;
        identity: CrmChannelIdentityRecord | null;
        conversation: CrmConversationRecord;
        message: CrmMessageRecord;
        consentStatus: CrmConsentStatus;
      },
      attemptCountAfter: number,
    ) => Promise<{ result: T; messageUpdate: Record<string, unknown> }>,
  ): Promise<{ result: T; message: CrmMessageRecord; attemptCountAfter: number } | null> {
    return this.db.$transaction(async (tx: any) => {
      const customer = await this.lockLiveCustomer(tx, input.companyId, input.customerId);
      if (!customer) return null;
      const conversationRow = await tx.crmConversation.findFirst({
        where: { id: input.conversationId, companyId: input.companyId, customerId: customer.id },
      });
      if (!conversationRow) return null;
      const messageRow = await tx.crmMessage.findFirst({
        where: {
          id: input.messageId,
          companyId: input.companyId,
          conversationId: input.conversationId,
          direction: 'OUTBOUND',
          visibility: 'CUSTOMER',
          deliveryStatus: 'PENDING',
          deliveryAttemptCount: input.expectedAttemptCount,
        },
      });
      if (!messageRow) return null;

      const [channelRow, identityRow] = await Promise.all([
        tx.companyMessagingChannel.findFirst({
          where: { id: conversationRow.channelId, companyId: input.companyId },
        }),
        tx.crmChannelIdentity.findFirst({
          where: { id: conversationRow.channelIdentityId, companyId: input.companyId, customerId: customer.id },
        }),
      ]);
      const attemptCountAfter = input.expectedAttemptCount + 1;
      const attempt = await callback({
        channel: channelRow ? this.toChannel(channelRow) : null,
        identity: identityRow ? this.toIdentity(identityRow) : null,
        conversation: this.toConversation(conversationRow),
        message: this.toMessage(messageRow),
        consentStatus: customer.consentStatus,
      }, attemptCountAfter);
      const updated = await tx.crmMessage.updateMany({
        where: {
          id: input.messageId,
          companyId: input.companyId,
          conversationId: input.conversationId,
          deliveryStatus: 'PENDING',
          deliveryAttemptCount: input.expectedAttemptCount,
        },
        data: { ...attempt.messageUpdate, deliveryAttemptCount: attemptCountAfter },
      });
      if (updated.count !== 1) return null;
      const settled = await tx.crmMessage.findFirst({
        where: { id: input.messageId, companyId: input.companyId, conversationId: input.conversationId },
      });
      return settled ? { result: attempt.result, message: this.toMessage(settled), attemptCountAfter } : null;
    }, { maxWait: 5_000, timeout: 35_000 });
  }

  // ---- A3 payment-proof queue ----

  /** Idempotently link an attachment as a payment proof (finance queue + PDPA exemption). */
  async linkPaymentProof(input: {
    companyId: string;
    attachmentId: string;
    conversationId: string;
    purpose: string;
    targetType: string;
    userId: string;
    actorScope: ConversationActorScope;
  }): Promise<{ created: boolean }> {
    return this.db.$transaction(async (tx: any) => {
      const live = await this.lockLiveConversationCustomer(tx, input.companyId, input.conversationId);
      if (!live) throw new Error('customer_not_active');
      this.assertConversationActorScope(live, input.actorScope);
      const candidate = await tx.crmMessage.findFirst({
        where: {
          companyId: input.companyId,
          conversationId: input.conversationId,
          attachmentId: input.attachmentId,
          direction: 'INBOUND',
          messageType: { in: ['IMAGE', 'FILE'] },
        },
        select: { id: true },
      });
      const attachment = candidate
        ? await tx.attachmentObject.findFirst({
            where: { id: input.attachmentId, companyId: input.companyId, status: 'ACTIVE' },
            select: { id: true },
          })
        : null;
      if (!candidate || !attachment) throw new Error('payment_proof_candidate_changed');
      const conflict = await findAttachmentLinkConflict(tx, {
        companyId: input.companyId, attachmentId: input.attachmentId, targetType: input.targetType,
      });
      // The guard returns the sentence the caller is meant to read. A bare Error carries no status,
      // and this use case's catch only maps its own sentinel codes, so the block used to surface as
      // a 500 — the explanation written here never reached anyone. Every other call site of this
      // guard throws an HttpException; this one now does too.
      if (conflict) throw new BadRequestException(conflict);
      const existing = await tx.attachmentLink.findFirst({
        where: { companyId: input.companyId, attachmentId: input.attachmentId, targetType: input.targetType, targetId: input.conversationId, purpose: input.purpose },
        select: { id: true },
      });
      if (existing) return { created: false };
      await tx.attachmentLink.create({
        data: { companyId: input.companyId, attachmentId: input.attachmentId, targetType: input.targetType, targetId: input.conversationId, purpose: input.purpose, linkedByUserId: input.userId },
      });
      return { created: true };
    });
  }

  /** Finance-facing queue of flagged payment proofs, newest first, with customer + message context. */
  async listPaymentProofs(companyId: string, purpose: string, limit: number): Promise<Array<{
    attachmentId: string; conversationId: string; messageId: string | null; fileName: string; mimeType: string; byteSize: number; status: string;
    flaggedByUserId: string; flaggedAt: Date; customerId: string | null; customerName: string | null;
  }>> {
    const links = await this.db.attachmentLink.findMany({
      where: { companyId, purpose },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { attachmentId: true, targetId: true, linkedByUserId: true, createdAt: true, attachment: { select: { originalFileName: true, mimeType: true, byteSize: true, status: true } } },
    });
    if (links.length === 0) return [];
    const conversationIds = [...new Set(links.map((l) => l.targetId))];
    const attachmentIds = links.map((l) => l.attachmentId);
    const [conversations, messages] = await Promise.all([
      this.db.crmConversation.findMany({ where: { companyId, id: { in: conversationIds } }, select: { id: true, customerId: true } }),
      // The message that carries each proof attachment — lets the review page preview inline.
      this.db.crmMessage.findMany({ where: { companyId, attachmentId: { in: attachmentIds } }, select: { id: true, attachmentId: true } }),
    ]);
    const customerIdByConv = new Map(conversations.map((c) => [c.id, c.customerId]));
    const messageIdByAttachment = new Map(messages.map((m) => [m.attachmentId!, m.id]));
    const names = await this.findCustomerDisplayNames(companyId, [...new Set([...customerIdByConv.values()])]);
    return links.map((l) => {
      const customerId = customerIdByConv.get(l.targetId) ?? null;
      return {
        attachmentId: l.attachmentId, conversationId: l.targetId, messageId: messageIdByAttachment.get(l.attachmentId) ?? null,
        fileName: l.attachment.originalFileName, mimeType: l.attachment.mimeType, byteSize: l.attachment.byteSize, status: l.attachment.status,
        flaggedByUserId: l.linkedByUserId, flaggedAt: l.createdAt,
        customerId, customerName: customerId ? names.get(customerId) ?? null : null,
      };
    });
  }

  // ---- A5 durability scans ----

  async findRetryableAutonomyJobs(
    now: Date,
    staleMs: number,
    maxAttempts: number,
    limit: number,
  ): Promise<CrmAutonomyJobRecord[]> {
    const rows = await this.db.crmAutonomyJob.findMany({
      where: {
        conversation: { customer: { status: 'ACTIVE', personalDataErasedAt: null } },
        OR: [
          { status: 'PENDING', attempts: { lt: maxAttempts }, nextAttemptAt: { lte: now } },
          { status: 'PENDING', attempts: { lt: maxAttempts }, updatedAt: { lt: new Date(now.getTime() - staleMs) } },
          {
            status: 'FAILED',
            attempts: { lt: maxAttempts },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.toAutonomyJob(row));
  }

  async findOldestRunnableAutonomyJob(
    companyId: string,
    conversationId: string,
    now: Date,
    maxAttempts = AUTONOMY_JOB_MAX_ATTEMPTS,
  ): Promise<CrmAutonomyJobRecord | null> {
    const row = await this.db.crmAutonomyJob.findFirst({
      where: {
        companyId,
        conversationId,
        status: { in: ['PENDING', 'FAILED'] },
        attempts: { lt: maxAttempts },
        conversation: { customer: { status: 'ACTIVE', personalDataErasedAt: null } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!row) return null;
    // PENDING with attempts > 0 is already leased by a live/stale worker.
    if (row.status === 'PENDING' && row.attempts > 0) return null;
    if (row.status === 'FAILED' && row.nextAttemptAt && row.nextAttemptAt > now) return null;
    return this.toAutonomyJob(row);
  }

  /** Atomic oldest-first claim so workers cannot overtake a turn in one conversation. */
  async claimAutonomyJob(job: CrmAutonomyJobRecord, now: Date): Promise<boolean> {
    return this.db.$transaction(async (tx: any) => {
      const live = await this.lockLiveConversationCustomer(tx, job.companyId, job.conversationId);
      if (!live) return false;
      const oldest = await tx.crmAutonomyJob.findFirst({
        where: {
          companyId: job.companyId,
          conversationId: job.conversationId,
          status: { in: ['PENDING', 'FAILED'] },
          attempts: { lt: AUTONOMY_JOB_MAX_ATTEMPTS },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (oldest?.id !== job.id) return false;
      const result = await tx.crmAutonomyJob.updateMany({
        where: {
          id: job.id,
          companyId: job.companyId,
          conversationId: job.conversationId,
          status: job.status,
          attempts: job.attempts,
          updatedAt: job.updatedAt,
        },
        data: {
          status: 'PENDING',
          attempts: { increment: 1 },
          nextAttemptAt: null,
          updatedAt: now,
        },
      });
      return result.count > 0;
    });
  }

  /** PENDING outbound customer replies due for re-push (backoff elapsed or API-crash orphans). */
  async findRetryableReplies(now: Date, graceMs: number, maxAgeMs: number, limit: number): Promise<Array<{
    id: string; companyId: string; conversationId: string; customerId: string; channelId: string; channelIdentityId: string;
    status: string; firstRespondedAt: Date | null; authorType: string; contentText: string | null; deliveryAttemptCount: number;
  }>> {
    const rows = await this.db.crmMessage.findMany({
      where: {
        direction: 'OUTBOUND',
        visibility: 'CUSTOMER',
        deliveryStatus: 'PENDING',
        conversation: { customer: { status: 'ACTIVE', personalDataErasedAt: null } },
        createdAt: { gte: new Date(now.getTime() - maxAgeMs) },
        OR: [
          { deliveryNextAttemptAt: { lte: now } },
          { deliveryNextAttemptAt: null, createdAt: { lt: new Date(now.getTime() - graceMs) } },
        ],
      },
      select: {
        id: true, companyId: true, conversationId: true, authorType: true, contentText: true, deliveryAttemptCount: true,
        conversation: { select: { customerId: true, channelId: true, channelIdentityId: true, status: true, firstRespondedAt: true } },
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id, companyId: r.companyId, conversationId: r.conversationId,
      customerId: r.conversation.customerId,
      channelId: r.conversation.channelId, channelIdentityId: r.conversation.channelIdentityId,
      status: r.conversation.status, firstRespondedAt: r.conversation.firstRespondedAt,
      authorType: r.authorType, contentText: r.contentText, deliveryAttemptCount: r.deliveryAttemptCount,
    }));
  }

  /** Inbound image/file messages whose media never landed (crash orphan or transient failure). */
  async findMediaFetchCandidates(now: Date, graceMs: number, maxAgeMs: number, limit: number): Promise<Array<{
    id: string; companyId: string; conversationId: string; customerId: string; channelId: string; channelIdentityId: string;
    providerMessageId: string | null; contentJson: unknown;
  }>> {
    const rows = await this.db.crmMessage.findMany({
      where: {
        direction: 'INBOUND',
        messageType: { in: ['IMAGE', 'FILE'] },
        attachmentId: null,
        conversation: { customer: { status: 'ACTIVE', personalDataErasedAt: null } },
        createdAt: { gte: new Date(now.getTime() - maxAgeMs), lt: new Date(now.getTime() - graceMs) },
      },
      select: {
        id: true, companyId: true, conversationId: true, providerMessageId: true, contentJson: true,
        conversation: { select: { customerId: true, channelId: true, channelIdentityId: true } },
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      conversationId: r.conversationId,
      customerId: r.conversation.customerId,
      channelId: r.conversation.channelId,
      channelIdentityId: r.conversation.channelIdentityId,
      providerMessageId: r.providerMessageId,
      contentJson: r.contentJson,
    }));
  }

  /** Active LINE identities still showing the placeholder name (profile enrichment missed). */
  async findProfileEnrichCandidates(now: Date, maxAgeMs: number, placeholder: string, limit: number): Promise<Array<{
    id: string; companyId: string; channelId: string; providerUserId: string; customerId: string;
  }>> {
    const rows = await this.db.crmChannelIdentity.findMany({
      where: {
        status: 'ACTIVE',
        customer: { status: 'ACTIVE', personalDataErasedAt: null },
        createdAt: { gte: new Date(now.getTime() - maxAgeMs) },
        OR: [{ displayName: null }, { displayName: placeholder }],
      },
      select: { id: true, companyId: true, channelId: true, providerUserId: true, customerId: true },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });
    return rows;
  }

  /** Race-safe breach mark; false when another scanner pass won. */
  async markSlaBreached(id: string, now: Date): Promise<boolean> {
    const result = await this.db.crmConversation.updateMany({
      where: {
        id,
        slaBreachedAt: null,
        firstRespondedAt: null,
        customer: { status: 'ACTIVE', personalDataErasedAt: null },
      },
      data: { slaBreachedAt: now },
    });
    return result.count > 0;
  }

  /** Breach notification audience: active members holding a triage-manager role. */
  async findInboxManagerUserIds(companyId: string): Promise<string[]> {
    const rows = await this.db.companyMembership.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        roles: { some: { role: { key: { in: ['OWNER', 'ADMIN', 'MANAGER'] } } } },
      },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  async findCustomerDisplayNames(companyId: string, customerIds: string[]): Promise<Map<string, string>> {
    if (customerIds.length === 0) return new Map();
    const rows = await this.db.crmCustomer.findMany({
      where: { companyId, id: { in: customerIds }, status: 'ACTIVE', personalDataErasedAt: null },
      select: { id: true, displayName: true },
    });
    return new Map(rows.map((r) => [r.id, r.displayName]));
  }

  // ---- PDPA purge / erasure (A6) ----
  // Finance exemption is structural: a message with a non-null accountingDocumentRef
  // (a sent/linked finance doc) and an attachment with any AttachmentLink (payment
  // proof / accounting evidence) are legally retained and never touched.

  /**
   * Redact expired inbound/outbound text past the retention cut-off, one bounded
   * batch. Nulls contentText + overwrites contentJson with a purge marker, keeping
   * the row (counts/threading/audit intact). Selecting `contentText: { not: null }`
   * makes the sweep advance — a redacted row is never re-selected.
   */
  async purgeExpiredMessageText(before: Date, limit: number, marker: Record<string, unknown>): Promise<number> {
    const rows = await this.db.crmMessage.findMany({
      where: { createdAt: { lt: before }, accountingDocumentRef: null, contentText: { not: null } },
      select: { id: true },
      take: limit,
    });
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    await this.db.crmMessage.updateMany({
      where: { id: { in: ids } },
      data: { contentText: null, contentJson: marker as any },
    });
    return ids.length;
  }

  /** Clear stale conversation previews (a copy of the latest, now-purged message text). */
  async clearExpiredConversationPreviews(before: Date): Promise<number> {
    const result = await this.db.crmConversation.updateMany({
      where: { lastMessageAt: { lt: before }, lastMessagePreview: { not: null } },
      data: { lastMessagePreview: null },
    });
    return result.count;
  }

  async purgeExpiredAiData(before: Date, limit: number): Promise<{ turns: number; conversations: number }> {
    const turns = await this.db.aiTurn.findMany({
      where: { createdAt: { lt: before } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    if (turns.length > 0) {
      await this.db.aiTurn.deleteMany({ where: { id: { in: turns.map((turn) => turn.id) } } });
    }
    const conversations = await this.db.aiConversation.deleteMany({
      where: { updatedAt: { lt: before }, turns: { none: {} }, channelKind: null },
    });
    return { turns: turns.length, conversations: conversations.count };
  }

  /**
   * Purge expired media past the retention cut-off, one bounded batch. The relation
   * filter returns ONLY purgeable blobs (ACTIVE attachment, zero links → non-finance),
   * so the sweep both stays efficient and advances (deleted blobs never re-appear).
   * Mirrors isAttachmentPurgeable(). Deletes bytes, soft-deletes the object (keeps the
   * metadata row for audit), and drops the referencing message's media meta.
   */
  async purgeExpiredMedia(before: Date, limit: number, now: Date, marker: Record<string, unknown>): Promise<number> {
    const blobs = await this.db.attachmentBlob.findMany({
      where: { createdAt: { lt: before }, attachment: { status: 'ACTIVE', links: { none: {} } } },
      select: { attachmentId: true },
      take: limit,
    });
    if (blobs.length === 0) return 0;
    const ids = blobs.map((b) => b.attachmentId);
    await this.db.$transaction([
      this.db.attachmentBlob.deleteMany({ where: { attachmentId: { in: ids } } }),
      this.db.attachmentObject.updateMany({ where: { id: { in: ids } }, data: { status: 'DELETED', deletedAt: now } }),
      this.db.crmMessage.updateMany({ where: { attachmentId: { in: ids } }, data: { contentJson: marker as any } }),
    ]);
    return ids.length;
  }

  /** All attachments referenced by a customer's messages, with finance-link signal. */
  async findCustomerMediaAttachments(
    companyId: string,
    conversationIds: string[],
  ): Promise<Array<{ attachmentId: string; status: string; linkCount: number }>> {
    if (conversationIds.length === 0) return [];
    const msgs = await this.db.crmMessage.findMany({
      where: { companyId, conversationId: { in: conversationIds }, attachmentId: { not: null } },
      select: { attachmentId: true },
    });
    const attachmentIds = [...new Set(msgs.map((m) => m.attachmentId!).filter(Boolean))];
    if (attachmentIds.length === 0) return [];
    const attachments = await this.db.attachmentObject.findMany({
      where: { id: { in: attachmentIds } },
      select: { id: true, status: true, links: { select: { id: true }, take: 1 } },
    });
    return attachments.map((a) => ({ attachmentId: a.id, status: a.status, linkCount: a.links.length }));
  }

  /**
   * Erase all of a customer's personal data (PDPA right-to-be-forgotten). Redacts
   * non-finance message content, purges non-finance media (ids decided by the caller
   * via isAttachmentPurgeable), scrubs customer + LINE-identity PII, and clears
   * conversation previews — all in one transaction. Finance-linked rows are retained.
   */
  async eraseCustomerData(input: {
    companyId: string;
    customerId: string;
    now: Date;
    marker: Record<string, unknown>;
    erasedDisplayName: string;
    actorUserId?: string;
    actorType?: 'USER' | 'CRM_CUSTOMER';
    actorRefId?: string;
    requestId: string;
    reason?: string;
  }): Promise<{
    customerId: string;
    messagesRedacted: number;
    mediaPurged: number;
    conversations: number;
    retainedFinanceAttachments: number;
    auditLogId: string;
    evidenceEventKey: string;
  }> {
    const { companyId, customerId, now, marker, erasedDisplayName } = input;
    const erasedDisplayNameNormalized = erasedDisplayName.trim().toLowerCase().replace(/\s+/g, ' ');
    return this.db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer-identity-graph:' || ${companyId}))::text`;

      // Follow a soft-merged alias to its canonical row while the identity
      // graph is stable. Lock every row in the chain in deterministic order.
      const chain: string[] = [];
      const seen = new Set<string>();
      let cursor = customerId;
      while (true) {
        if (seen.has(cursor)) throw new Error('customer_merge_cycle');
        seen.add(cursor);
        const row = await tx.crmCustomer.findFirst({
          where: { id: cursor, companyId },
          select: { id: true, status: true, mergedIntoCustomerId: true },
        });
        if (!row) throw new Error('customer_not_found');
        chain.push(row.id);
        if (row.status !== 'MERGED' || !row.mergedIntoCustomerId) break;
        cursor = row.mergedIntoCustomerId;
      }
      // Include reverse aliases too. A request against the canonical row must
      // erase every soft-merged customer record that still points into it.
      const eraseCustomerIds = [...chain];
      let aliasFrontier = [...chain];
      while (aliasFrontier.length > 0) {
        const aliases = await tx.crmCustomer.findMany({
          where: { companyId, status: 'MERGED', mergedIntoCustomerId: { in: aliasFrontier } },
          select: { id: true },
        });
        const unseen = aliases
          .map((row: { id: string }) => row.id)
          .filter((id: string) => !seen.has(id));
        if (unseen.length === 0) break;
        for (const id of unseen) {
          seen.add(id);
          eraseCustomerIds.push(id);
        }
        aliasFrontier = unseen;
      }
      for (const id of [...eraseCustomerIds].sort()) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer:' || ${companyId} || ':' || ${id}))::text`;
      }
      const canonical = await tx.crmCustomer.findFirst({
        where: { id: cursor, companyId },
        select: { id: true, status: true },
      });
      if (!canonical || canonical.status === 'MERGED') throw new Error('customer_identity_graph_changed');
      const canonicalCustomerId = canonical.id;
      const evidenceEventKey = `crm.customer.personal_data_erased:crm_customer:${canonicalCustomerId}:${input.requestId}`;
      const priorEvidence = await tx.outboxEvent.findUnique({ where: { eventKey: evidenceEventKey } });
      if (priorEvidence) {
        const data = ((priorEvidence.payloadJson as any)?.data ?? {}) as Record<string, unknown>;
        return {
          customerId: canonicalCustomerId,
          messagesRedacted: Number(data['messagesRedacted'] ?? 0),
          mediaPurged: Number(data['mediaPurged'] ?? 0),
          conversations: Number(data['conversations'] ?? 0),
          retainedFinanceAttachments: Number(data['retainedFinanceAttachments'] ?? 0),
          auditLogId: String(data['auditLogId'] ?? ''),
          evidenceEventKey,
        };
      }

      const conversationRows = await tx.crmConversation.findMany({
        where: { companyId, customerId: { in: eraseCustomerIds } },
        select: { id: true },
      });
      const conversationIds = conversationRows.map((row: { id: string }) => row.id);
      const opportunityRows = await tx.crmOpportunity.findMany({
        where: { companyId, customerId: { in: eraseCustomerIds } },
        select: { id: true },
      });
      const opportunityIds = opportunityRows.map((row: { id: string }) => row.id);
      const leadRows = await tx.crmLead.findMany({
        where: { companyId, convertedCustomerId: { in: eraseCustomerIds } },
        select: { id: true },
      });
      const leadIds = leadRows.map((row: { id: string }) => row.id);
      const bookingRows = await tx.crmBooking.findMany({
        where: { companyId, customerId: { in: eraseCustomerIds } },
        select: { id: true },
      });
      const bookingIds = bookingRows.map((row: { id: string }) => row.id);
      const contactRows = await tx.crmContactPerson.findMany({
        where: { companyId, customerId: { in: eraseCustomerIds } },
        select: { id: true },
      });
      const contactIds = contactRows.map((row: { id: string }) => row.id);
      const childLineageWhere = {
        OR: [
          { customerId: { in: eraseCustomerIds } },
          ...(opportunityIds.length > 0 ? [{ opportunityId: { in: opportunityIds } }] : []),
          ...(leadIds.length > 0 ? [{ leadId: { in: leadIds } }] : []),
        ],
      };
      const activityRows = await tx.crmActivity.findMany({
        where: { companyId, ...childLineageWhere },
        select: { id: true },
      });
      const activityIds = activityRows.map((row: { id: string }) => row.id);
      const followUpRows = await tx.crmFollowUpTask.findMany({
        where: { companyId, ...childLineageWhere },
        select: { id: true },
      });
      const followUpIds = followUpRows.map((row: { id: string }) => row.id);
      const conversationMessages = conversationIds.length > 0
        ? await tx.crmMessage.findMany({
            where: { companyId, conversationId: { in: conversationIds } },
            select: { id: true, messageType: true, attachmentId: true, providerMessageId: true, webhookEventId: true },
          })
        : [];
      const attachmentIds = [...new Set(conversationMessages.map((row: { attachmentId: string | null }) => row.attachmentId).filter((id: string | null): id is string => !!id))];
      const attachments = attachmentIds.length > 0
        ? await tx.attachmentObject.findMany({
            where: { id: { in: attachmentIds } },
            select: { id: true, status: true, links: { select: { id: true }, take: 1 } },
          })
        : [];
      const purgeAttachmentIds = attachments
        .filter((attachment: any) => attachment.status === 'ACTIVE' && attachment.links.length === 0)
        .map((attachment: any) => attachment.id as string);
      const retainedAttachmentIds = new Set(
        attachments
          .filter((attachment: any) => attachment.links.length > 0)
          .map((attachment: any) => attachment.id as string),
      );

      // Lock conversations before redacting messages. appendInboundMessage
      // locks the same rows before inserting, which gives the erase a clear
      // before/after boundary for concurrent inbound traffic.
      let messagesRedacted = 0;
      if (conversationIds.length > 0) {
        await tx.crmAutonomyJob.updateMany({
          where: { companyId, conversationId: { in: conversationIds } },
          data: {
            status: 'DONE',
            replyToken: null,
            replyTokenAt: null,
            nextAttemptAt: null,
            lastError: null,
          },
        });
        await tx.crmConversation.updateMany({
          where: { companyId, id: { in: conversationIds } },
          data: { lastMessagePreview: null, aiSummaryText: null, aiSummaryAt: null, tagsJson: Prisma.DbNull },
        });
        const redacted = await tx.crmMessage.updateMany({
          where: { companyId, conversationId: { in: conversationIds }, accountingDocumentRef: null },
          data: { contentText: null, contentJson: marker as any },
        });
        messagesRedacted = redacted.count;
        for (const message of conversationMessages) {
          if (!message.providerMessageId && !message.webhookEventId) continue;
          await tx.crmMessage.update({
            where: { id: message.id },
            data: {
              providerMessageId: message.providerMessageId
                ? this.pdpaLineIdentifier('provider-message', companyId, message.providerMessageId)
                : null,
              webhookEventId: message.webhookEventId
                ? this.pdpaLineIdentifier('webhook-event', companyId, message.webhookEventId)
                : null,
            },
          });
        }
        await tx.crmAiAssistFeedback.updateMany({
          where: { companyId, conversationId: { in: conversationIds } },
          data: { comment: null },
        });
      }
      if (purgeAttachmentIds.length > 0) {
        await tx.attachmentBlob.deleteMany({ where: { attachmentId: { in: purgeAttachmentIds } } });
        await tx.attachmentObject.updateMany({
          where: { id: { in: purgeAttachmentIds } },
          data: {
            status: 'DELETED',
            deletedAt: now,
            originalFileName: 'erased',
            objectKey: 'erased',
            byteSize: 0,
            checksumSha256: null,
            metadataJson: Prisma.DbNull,
          },
        });
      }
      for (const message of conversationMessages) {
        if (!message.attachmentId || !message.providerMessageId || !retainedAttachmentIds.has(message.attachmentId)) continue;
        await tx.attachmentObject.updateMany({
          where: {
            id: message.attachmentId,
            originalFileName: {
              in: [
                `${String(message.messageType).toLowerCase()}-${message.providerMessageId}`,
                `media-${message.providerMessageId}`,
              ],
            },
          },
          data: { originalFileName: 'retained-document' },
        });
      }

      // Scrub direct PII copies outside the customer row. Accounting-document
      // snapshots and linked attachments remain intact for legal retention.
      const identities = await tx.crmChannelIdentity.findMany({
        where: { companyId, customerId: { in: eraseCustomerIds } },
        select: { id: true, channelId: true, providerUserId: true },
      });
      for (const identity of identities) {
        await tx.crmChannelIdentity.update({
          where: { id: identity.id },
          data: {
            providerUserId: this.pdpaLineIdentifier('provider-user', identity.channelId, identity.providerUserId),
            displayName: null,
            pictureUrl: null,
          },
        });
      }
      await tx.crmContactPerson.updateMany({
        where: { companyId, customerId: { in: eraseCustomerIds } },
        data: {
          name: erasedDisplayName,
          role: null,
          phone: null,
          phoneNormalized: null,
          email: null,
          emailNormalized: null,
          lineUserId: null,
          preferredChannel: null,
          consentStatus: 'REVOKED',
          note: null,
        },
      });
      if (bookingIds.length > 0) {
        await tx.crmBooking.updateMany({
          where: { companyId, id: { in: bookingIds } },
          data: { customerName: null },
        });
      }
      if (leadIds.length > 0) {
        await tx.crmLead.updateMany({
          where: { companyId, id: { in: leadIds } },
          data: {
            rawName: null,
            rawPhone: null,
            rawPhoneNormalized: null,
            rawEmail: null,
            rawEmailNormalized: null,
            rawPayloadJson: Prisma.DbNull,
            sourceRefType: null,
            sourceRefId: null,
            note: null,
            disqualifiedReason: null,
          },
        });
      }
      if (activityIds.length > 0) {
        await tx.crmActivity.updateMany({
          where: { companyId, id: { in: activityIds } },
          data: { note: erasedDisplayName, metadataJson: Prisma.DbNull },
        });
      }
      if (followUpIds.length > 0) {
        await tx.crmFollowUpTask.updateMany({
          where: { companyId, id: { in: followUpIds } },
          data: { title: erasedDisplayName, cancelReason: null },
        });
      }
      if (opportunityIds.length > 0) {
        await tx.crmOpportunity.updateMany({
          where: { companyId, id: { in: opportunityIds } },
          data: {
            title: erasedDisplayName,
            closeReason: null,
            lostReason: null,
            quotationSummaryJson: Prisma.DbNull,
          },
        });
      }

      const relatedEvidenceScopes = [
        { targetType: 'crm_customer', ids: eraseCustomerIds },
        { targetType: 'crm_contact', ids: contactIds },
        { targetType: 'crm_conversation', ids: conversationIds },
        { targetType: 'crm_booking', ids: bookingIds },
        { targetType: 'crm_lead', ids: leadIds },
        { targetType: 'crm_opportunity', ids: opportunityIds },
        { targetType: 'crm_activity', ids: activityIds },
        { targetType: 'crm_follow_up', ids: followUpIds },
      ].filter((scope) => scope.ids.length > 0);
      // L-11: field-level redaction. A blanket `updateMany` overwrite would destroy
      // the amounts, checksums, counts, reasons and state transitions that make these
      // rows an audit trail, so each row is rewritten with only its personal-data
      // fields replaced. Bounded batches keep the erasure transaction predictable.
      let auditRowsScanned = 0;
      let auditRowsRedacted = 0;
      let outboxRowsRedacted = 0;
      if (relatedEvidenceScopes.length > 0) {
        const auditWhere = {
          companyId,
          OR: relatedEvidenceScopes.map((scope) => ({
            targetType: scope.targetType,
            targetId: { in: scope.ids },
          })),
        };
        for (let cursor: string | undefined; ;) {
          const rows = await tx.auditLog.findMany({
            where: auditWhere,
            select: { id: true, metadataJson: true },
            orderBy: { id: 'asc' },
            take: PDPA_REDACTION_BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (rows.length === 0) break;
          auditRowsScanned += rows.length;
          for (const row of rows as Array<{ id: string; metadataJson: unknown }>) {
            const redaction = redactPersonalData(row.metadataJson, now);
            if (redaction.redactedKeys.length === 0) continue;
            await tx.auditLog.update({
              where: { id: row.id },
              data: { metadataJson: redaction.value as Prisma.InputJsonValue },
            });
            auditRowsRedacted += 1;
          }
          if (rows.length < PDPA_REDACTION_BATCH_SIZE) break;
          cursor = rows[rows.length - 1]!.id;
        }

        const outboxWhere = {
          companyId,
          eventType: { not: 'crm.customer.personal_data_erased' },
          OR: relatedEvidenceScopes.map((scope) => ({
            aggregateType: scope.targetType,
            aggregateId: { in: scope.ids },
          })),
        };
        for (let cursor: string | undefined; ;) {
          const rows = await tx.outboxEvent.findMany({
            where: outboxWhere,
            select: { id: true, payloadJson: true },
            orderBy: { id: 'asc' },
            take: PDPA_REDACTION_BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (rows.length === 0) break;
          for (const row of rows as Array<{ id: string; payloadJson: unknown }>) {
            // The envelope (companyId, occurredAt, eventType, aggregate refs) is not
            // personal data, so it survives with every non-personal field in `data`.
            const redaction = redactPersonalData(row.payloadJson, now);
            if (redaction.redactedKeys.length === 0) continue;
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: { payloadJson: redaction.value as Prisma.InputJsonValue },
            });
            outboxRowsRedacted += 1;
          }
          if (rows.length < PDPA_REDACTION_BATCH_SIZE) break;
          cursor = rows[rows.length - 1]!.id;
        }
      }

      const notificationScopes = [
        ...(conversationIds.length > 0 ? [{ sourceType: 'crm_conversation', sourceId: { in: conversationIds } }] : []),
        ...(bookingIds.length > 0 ? [{ sourceType: 'crm_booking', sourceId: { in: bookingIds } }] : []),
        ...(eraseCustomerIds.length > 0 ? [{ sourceType: 'crm_customer', sourceId: { in: eraseCustomerIds } }] : []),
      ];
      if (notificationScopes.length > 0) {
        const notificationRows = await tx.notificationEvent.findMany({
          where: { companyId, OR: notificationScopes },
          select: { id: true },
        });
        const notificationEventIds = notificationRows.map((row: { id: string }) => row.id);
        if (notificationEventIds.length > 0) {
          const recipientRows = await tx.notificationRecipient.findMany({
            where: { companyId, eventId: { in: notificationEventIds } },
            select: { id: true },
          });
          const recipientIds = recipientRows.map((row: { id: string }) => row.id);
          if (recipientIds.length > 0) {
            await tx.notificationDelivery.updateMany({
              where: {
                companyId,
                recipientId: { in: recipientIds },
                status: { in: ['QUEUED', 'FAILED'] },
              },
              data: {
                status: 'SUPPRESSED',
                nextAttemptAt: null,
                errorCode: 'CUSTOMER_PERSONAL_DATA_ERASED',
                errorMessage: 'Customer-linked notification suppressed after personal data erasure',
                metadataJson: { personalDataErased: true },
              },
            });
          }
        }
        await tx.notificationEvent.updateMany({
          where: { companyId, OR: notificationScopes },
          data: {
            title: 'ข้อมูลลูกค้าถูกลบแล้ว',
            body: 'รายการนี้ถูกปิดตามคำขอลบข้อมูลส่วนบุคคล',
            payloadJson: { personalDataErased: true },
            sourceRefsJson: [],
            deepLinkHref: null,
            status: 'RESOLVED',
            resolvedAt: now,
          },
        });
      }

      // Keep the canonical row and legal accounting link, but rotate every
      // marketing linkage and reset behavioral/AI profiling to neutral values.
      for (const erasedCustomerId of eraseCustomerIds) {
        await tx.crmCustomer.updateMany({
          where: { id: erasedCustomerId, companyId },
          data: {
          marketingRef: randomUUID(),
          code: null,
          displayName: erasedDisplayName,
          displayNameNormalized: erasedDisplayNameNormalized,
          legalName: null,
          customerType: 'UNKNOWN',
          primaryPhone: null,
          primaryPhoneNormalized: null,
          primaryEmail: null,
          primaryEmailNormalized: null,
          taxId: null,
          taxIdNormalized: null,
          lineUserId: null,
          facebookId: null,
          billingAddressJson: Prisma.DbNull,
          shippingAddressJson: Prisma.DbNull,
          notes: null,
          source: null,
          originSource: 'OTHER',
          archiveReason: null,
          lastActivityAt: null,
          lastContactedAt: null,
          nextFollowUpAt: null,
          leadScore: null,
          leadScoreUpdatedAt: null,
          sentiment: null,
          riskLevel: null,
          lifetimeValueAmount: null,
          lifetimeValueUpdatedAt: null,
          tier: 'LEAD',
          engagementScore: 0,
          trustScore: null,
          trustScoreFactorsJson: Prisma.DbNull,
          trustScoreComputedAt: null,
          consentStatus: 'REVOKED',
          consentNote: 'PDPA erasure request',
          consentUpdatedAt: now,
          personalDataErasedAt: now,
          },
        });
      }

      const audit = await tx.auditLog.create({
        data: {
          companyId,
          actorType: input.actorType ?? 'USER',
          actorUserId: input.actorUserId,
          actorRefId: input.actorRefId,
          action: 'crm.customer.erase',
          targetType: 'crm_customer',
          targetId: canonicalCustomerId,
          requestId: input.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: {
            messagesRedacted,
            mediaPurged: purgeAttachmentIds.length,
            conversations: conversationIds.length,
            retainedFinanceAttachments: attachments.length - purgeAttachmentIds.length,
            requestedCustomerId: customerId === canonicalCustomerId ? null : customerId,
            reasonProvided: Boolean(input.reason?.trim()),
          },
        },
        select: { id: true },
      });
      // L-11: append-only correction event. The redaction rewrites earlier audit
      // rows, so the trail records that it happened, over what scope, and how many
      // rows moved. The CRITICAL erasure row above is never modified.
      await tx.auditLog.create({
        data: {
          companyId,
          actorType: input.actorType ?? 'USER',
          actorUserId: input.actorUserId,
          actorRefId: input.actorRefId,
          action: AuditAction.PDPA_AUDIT_REDACTED,
          targetType: 'crm_customer',
          targetId: canonicalCustomerId,
          requestId: input.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            erasureAuditLogId: audit.id,
            scopes: relatedEvidenceScopes.map((scope) => ({ targetType: scope.targetType, ids: scope.ids.length })),
            auditRowsScanned,
            auditRowsRedacted,
            outboxRowsRedacted,
          },
        },
        select: { id: true },
      });
      await tx.outboxEvent.create({
        data: {
          companyId,
          eventType: 'crm.customer.personal_data_erased',
          aggregateType: 'crm_customer',
          aggregateId: canonicalCustomerId,
          eventKey: evidenceEventKey,
          priority: 'HIGH',
          payloadJson: {
            companyId,
            actorUserId: input.actorUserId,
            actorType: input.actorType ?? 'USER',
            actorRefId: input.actorRefId,
            requestId: input.requestId,
            aggregateType: 'crm_customer',
            aggregateId: canonicalCustomerId,
            occurredAt: now.toISOString(),
            data: {
              personalDataErased: true,
              messagesRedacted,
              mediaPurged: purgeAttachmentIds.length,
              conversations: conversationIds.length,
              retainedFinanceAttachments: attachments.length - purgeAttachmentIds.length,
              requestedCustomerId: customerId === canonicalCustomerId ? null : customerId,
              reasonProvided: Boolean(input.reason?.trim()),
              auditLogId: audit.id,
            },
          },
        },
      });

      return {
        customerId: canonicalCustomerId,
        messagesRedacted,
        mediaPurged: purgeAttachmentIds.length,
        conversations: conversationIds.length,
        retainedFinanceAttachments: attachments.length - purgeAttachmentIds.length,
        auditLogId: audit.id,
        evidenceEventKey,
      };
    }, PDPA_ERASURE_TRANSACTION_OPTIONS);
  }

  /**
   * External-call fence. Erase/merge/relink take graph -> customer; this takes
   * only customer and never requests graph, then revalidates live state. That
   * preserves ordering without serializing unrelated customers in one company.
   */
  private async lockLiveCustomer(
    tx: any,
    companyId: string,
    customerId: string,
  ): Promise<{ id: string; consentStatus: CrmConsentStatus } | null> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer:' || ${companyId} || ':' || ${customerId}))::text`;
    return tx.crmCustomer.findFirst({
      where: { id: customerId, companyId, status: 'ACTIVE', personalDataErasedAt: null },
      select: { id: true, consentStatus: true },
    });
  }

  /** Shared irreversible-erasure boundary for all writes that can add conversation PII. */
  private async lockLiveConversationCustomer(
    tx: any,
    companyId: string,
    conversationId: string,
  ): Promise<{ customerId: string; assignedToUserId: string | null } | null> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer-identity-graph:' || ${companyId}))::text`;
    const discovered = await tx.crmConversation.findFirst({
      where: { id: conversationId, companyId },
      select: { customerId: true },
    });
    if (!discovered) return null;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer:' || ${companyId} || ':' || ${discovered.customerId}))::text`;
    await tx.$queryRaw`SELECT "id" FROM "CrmConversation" WHERE "id" = ${conversationId} AND "companyId" = ${companyId} FOR UPDATE`;
    const conversation = await tx.crmConversation.findFirst({
      where: { id: conversationId, companyId },
      select: { customerId: true, assignedToUserId: true },
    });
    if (!conversation || conversation.customerId !== discovered.customerId) return null;
    const customer = await tx.crmCustomer.findFirst({
      where: { id: conversation.customerId, companyId, status: 'ACTIVE', personalDataErasedAt: null },
      select: { id: true },
    });
    return customer ? { customerId: customer.id, assignedToUserId: conversation.assignedToUserId } : null;
  }

  private assertConversationActorScope(
    conversation: { assignedToUserId: string | null },
    scope: ConversationActorScope,
  ): void {
    if (conversation.assignedToUserId !== scope.expectedAssignedToUserId) {
      throw new Error('conversation_assignment_changed');
    }
    if (!scope.canAccessAll && conversation.assignedToUserId !== null && conversation.assignedToUserId !== scope.actorUserId) {
      throw new Error('conversation_out_of_scope');
    }
  }

  /** Conversation ids + existence check for a customer (erasure scope). */
  async findConversationIdsForCustomer(companyId: string, customerId: string): Promise<string[]> {
    const rows = await this.db.crmConversation.findMany({
      where: { companyId, customerId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Minimal customer existence + name lookup for the erasure use-case. */
  async findCustomerForErasure(companyId: string, customerId: string): Promise<{ id: string; displayName: string } | null> {
    return this.db.crmCustomer.findFirst({ where: { id: customerId, companyId }, select: { id: true, displayName: true } });
  }

  private toConversation(row: any): CrmConversationRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      channelId: row.channelId,
      customerId: row.customerId,
      channelIdentityId: row.channelIdentityId,
      status: row.status,
      priority: row.priority,
      tags: Array.isArray(row.tagsJson) ? row.tagsJson.filter((t: unknown): t is string => typeof t === 'string') : [],
      assignedToUserId: row.assignedToUserId,
      unreadCount: row.unreadCount,
      lastMessageAt: row.lastMessageAt,
      lastInboundAt: row.lastInboundAt,
      lastOutboundAt: row.lastOutboundAt,
      lastMessagePreview: row.lastMessagePreview,
      firstResponseDueAt: row.firstResponseDueAt,
      firstRespondedAt: row.firstRespondedAt,
      slaBreachedAt: row.slaBreachedAt,
      resolvedAt: row.resolvedAt,
      resolvedByUserId: row.resolvedByUserId,
      reopenedCount: row.reopenedCount,
      autoReplyEnabled: row.autoReplyEnabled,
      autoReplyCount: row.autoReplyCount,
      autoReplyCheckedAt: row.autoReplyCheckedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toMessage(row: any): CrmMessageRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      conversationId: row.conversationId,
      direction: row.direction,
      visibility: row.visibility,
      authorType: row.authorType,
      authorUserId: row.authorUserId,
      messageType: row.messageType,
      contentText: row.contentText,
      contentJson: (row.contentJson as Record<string, unknown> | null) ?? null,
      attachmentId: row.attachmentId,
      providerMessageId: row.providerMessageId,
      webhookEventId: row.webhookEventId,
      deliveryStatus: row.deliveryStatus,
      deliveryError: row.deliveryError,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
    };
  }
}
