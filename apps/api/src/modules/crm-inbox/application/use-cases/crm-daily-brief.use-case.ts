import { Injectable } from '@nestjs/common';
import type { CrmDailyBrief, DashboardPeriodKind, RequestContext } from '@watchdog-bms/contracts';
import { ListDocumentsUseCase } from '../../../accounting-documents/application/use-cases/document.use-case';
import type { DocumentRecord } from '../../../accounting-documents/domain/models/accounting.model';
import { ownerScopeForList } from '../../../crm/application/crm-access';
import { sumAmounts } from '../../../crm/domain/logic/crm.logic';
import type { CrmConversationRecord } from '../../domain/models/crm-inbox.model';
import { PrismaCrmRepository } from '../../../crm/infrastructure/prisma-crm.repository';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { assignedScopeForList } from '../crm-inbox-access';
import { bangkokPeriodBounds, buildDailyBriefWidgets } from '../../domain/logic/crm-daily-brief.logic';
import { PAYMENT_PROOF_LINK_PURPOSE, PAYMENT_PROOF_LINK_TARGET_TYPE } from '../../domain/crm-inbox.constants';

/** Thai suffix for the date-scoped daily-brief widgets, matching the dashboard period tabs. */
const PERIOD_LABEL: Record<DashboardPeriodKind, string> = {
  today: 'วันนี้',
  week: '7 วัน',
  month: 'เดือนนี้',
  quarter: 'ไตรมาสนี้',
  last_month: 'เดือนก่อน',
  custom: 'ช่วงที่เลือก',
};

/**
 * Owner/manager daily brief. Source-specific widgets retain their existing read
 * permission and ABAC scope; callers without sales/accounting access keep the inbox
 * widgets without receiving hidden aggregates.
 */
@Injectable()
export class CrmDailyBriefUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly crmRepo: PrismaCrmRepository,
    private readonly listDocuments: ListDocumentsUseCase,
  ) {}

  async execute(ctx: RequestContext, options: { periodKind?: DashboardPeriodKind } = {}, now = new Date()): Promise<CrmDailyBrief> {
    const periodKind = options.periodKind ?? 'today';
    const { dayStart, dayEnd } = bangkokPeriodBounds(periodKind, now);
    const canReadDeals = ctx.permissions.includes('crm.opportunity.read');
    const canReadAccounting = ctx.permissions.includes('accounting.document.read');
    const ownerUserId = ownerScopeForList(ctx);
    const customerScope = {
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}),
    };
    const hasCustomerScope = ownerUserId !== undefined || ctx.scopes.branchIds !== undefined;
    // Both inbox cards count the inbox list they open, for this viewer: the inbox's own counts, in its own
    // assignment scope (no customer-owner or customer-branch filter, which that list does not apply).
    const [inboxCounts, paymentProofs, newCustomersToday, appointmentsToday, openDeals, issuedDocuments, customersWithCounterparty, conversations] = await Promise.all([
      this.repo.conversationCounts(ctx.companyId, ctx.userId, assignedScopeForList(ctx), now),
      this.repo.countPaymentProofs(ctx.companyId, PAYMENT_PROOF_LINK_TARGET_TYPE, PAYMENT_PROOF_LINK_PURPOSE, customerScope),
      this.crmRepo.countCustomersBetween(ctx.companyId, dayStart, dayEnd, customerScope),
      this.crmRepo.countBookingsBetween(ctx.companyId, dayStart, dayEnd, customerScope),
      canReadDeals
        ? this.crmRepo.listOpportunities({
            companyId: ctx.companyId,
            ownerUserId,
            ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}),
            status: 'OPEN',
          })
        : Promise.resolve(undefined),
      canReadAccounting ? this.listAllIssuedDocuments(ctx) : Promise.resolve(undefined),
      canReadAccounting
        ? this.repo.reportsCustomersWithCounterparty(ctx.companyId, undefined, ownerUserId, ctx.scopes.branchIds)
        : Promise.resolve(undefined),
      this.listAllConversations(ctx, customerScope),
    ]);

    const customerCounterpartyIds = new Set(customersWithCounterparty?.map((customer) => customer.accountingCounterpartyId) ?? []);
    const quotations = issuedDocuments?.filter((document) =>
      document.documentType === 'QUOTATION'
      && (!hasCustomerScope || (!!document.counterpartyId && customerCounterpartyIds.has(document.counterpartyId))),
    );
    const overdueDocuments = issuedDocuments?.filter((document) =>
      ['INVOICE', 'BILLING_NOTE', 'DEBIT_NOTE'].includes(document.documentType)
      && !!document.counterpartyId
      && customerCounterpartyIds.has(document.counterpartyId)
      && !!document.dueDate
      && document.dueDate.getTime() < now.getTime()
      && Number(document.outstandingAmount) > 0,
    );
    const complaintTags = new Set(['complaint', 'escalation']);
    const unresolvedComplaints = conversations.filter((conversation) =>
      conversation.status !== 'RESOLVED'
      && conversation.status !== 'SPAM'
      && conversation.tags.some((tag) => complaintTags.has(tag.toLowerCase())),
    ).length;
    const respondedToday = conversations.filter((conversation) =>
      !!conversation.firstRespondedAt
      && conversation.createdAt.getTime() >= dayStart.getTime()
      && conversation.createdAt.getTime() < dayEnd.getTime(),
    );
    const averageFirstResponseMinutes = respondedToday.length > 0
      ? Math.round(respondedToday.reduce((total, conversation) =>
        total + Math.max(0, conversation.firstRespondedAt!.getTime() - conversation.createdAt.getTime()), 0,
      ) / respondedToday.length / 60_000)
      : null;

    return {
      generatedAt: now.toISOString(),
      widgets: buildDailyBriefWidgets(ctx.companyId, {
        unanswered: inboxCounts.unansweredCount,
        slaBreaches: inboxCounts.overdueCount,
        newCustomersToday,
        appointmentsToday,
        paymentProofs,
        ...(openDeals ? { openDeals: { count: openDeals.length, amount: sumAmounts(openDeals.map((deal) => deal.amountEstimate)) } } : {}),
        ...(quotations ? { quotationsAwaitingAcceptance: { count: quotations.length, amount: sumAmounts(quotations.map((document) => document.grandTotalAmount)) } } : {}),
        ...(overdueDocuments ? { overduePayments: { count: overdueDocuments.length, amount: sumAmounts(overdueDocuments.map((document) => document.outstandingAmount)) } } : {}),
        unresolvedComplaints,
        averageFirstResponse: { minutes: averageFirstResponseMinutes, count: respondedToday.length },
      }, PERIOD_LABEL[periodKind], periodKind),
    };
  }

  private async listAllIssuedDocuments(ctx: RequestContext): Promise<DocumentRecord[]> {
    const documents: DocumentRecord[] = [];
    let page = 1;
    let total = 0;
    do {
      const result = await this.listDocuments.execute(ctx, { status: 'ISSUED', page, pageSize: 100 });
      documents.push(...result.data);
      total = result.total;
      page += 1;
      if (result.data.length === 0) break;
    } while (documents.length < total);
    return documents;
  }

  private async listAllConversations(
    ctx: RequestContext,
    customerScope: { ownerUserId?: string; branchIds?: string[] },
  ): Promise<CrmConversationRecord[]> {
    const conversations: CrmConversationRecord[] = [];
    const scopeUserId = assignedScopeForList(ctx);
    let page = 1;
    let total = 0;
    do {
      const result = await this.repo.listConversations(ctx.companyId, {
        scopeUserId,
        ...(customerScope.ownerUserId ? { customerOwnerUserId: customerScope.ownerUserId } : {}),
        ...(customerScope.branchIds ? { customerBranchIds: customerScope.branchIds } : {}),
        page,
        pageSize: 100,
      });
      conversations.push(...result.items);
      total = result.total;
      page += 1;
      if (result.items.length === 0) break;
    } while (conversations.length < total);
    return conversations;
  }
}
