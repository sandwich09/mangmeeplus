import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import type {
  RequestContext,
  CrmCustomer360Summary,
  CrmCustomer360Timeline,
  CrmCustomer360TimelineEvent,
  CrmCustomer360Source,
  CrmCustomer360FinanceDocument,
  CrmConversationStatus,
} from '@watchdog-bms/contracts';
import { GetCrmCustomerUseCase } from '../../../crm/application/use-cases/crm-customer.use-case';
import { ListCrmOpportunitiesUseCase, ListCrmActivitiesUseCase } from '../../../crm/application/use-cases/crm-opportunity.use-case';
import { ListCrmFollowUpsUseCase } from '../../../crm/application/use-cases/crm-follow-up.use-case';
import { ListCrmQuotationLinksUseCase } from '../../../crm/application/use-cases/crm-quotation.use-case';
import { sumAmounts } from '../../../crm/domain/logic/crm.logic';
import { ListDocumentsUseCase } from '../../../accounting-documents/application/use-cases/document.use-case';
import type { DocumentRecord } from '../../../accounting-documents/domain/models/accounting.model';
import { ListCrmConversationsUseCase } from './crm-conversation.use-case';

// Item 15A Phase 3 — Customer 360 aggregate + unified timeline (spec §10.3,
// "Customer 360 aggregate" route table). Read models composed exclusively from
// permission-checked use cases of the owning modules; a source the caller may
// not read is redacted (block = null / events omitted) and listed in
// `redactedSources`, never a 403 for the whole page.
const SOURCE_PERMISSIONS: Record<CrmCustomer360Source, string> = {
  conversations: 'crm.inbox.read',
  deals: 'crm.opportunity.read',
  tasks: 'crm.follow_up.read',
  quotations: 'crm.opportunity.read',
  finance: 'accounting.document.read',
  activities: 'crm.activity.read',
};

const OPEN_CONVERSATION_STATUSES = new Set<CrmConversationStatus>(['NEW', 'OPEN', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'FOLLOW_UP']);

// ponytail: every source contributes one newest-first page; per-source cursor
// pushdown arrives if an SME customer ever outgrows these windows.
const TIMELINE_SOURCE_WINDOW = 100;
const CONVERSATION_WINDOW = 50;
const DOCUMENT_WINDOW = 50;

function toFinanceDocument(doc: DocumentRecord): CrmCustomer360FinanceDocument {
  return {
    id: doc.id,
    documentType: doc.documentType,
    ...(doc.documentNumber ? { documentNumber: doc.documentNumber } : {}),
    status: doc.status,
    documentDate: doc.documentDate.toISOString(),
    ...(doc.dueDate ? { dueDate: doc.dueDate.toISOString() } : {}),
    currency: doc.currency,
    grandTotalAmount: doc.grandTotalAmount,
    outstandingAmount: doc.outstandingAmount,
    ...(doc.paymentStatus ? { paymentStatus: doc.paymentStatus } : {}),
  };
}

/** Tracks which sources the caller's permissions redact. */
function sourceGate(ctx: RequestContext): { can: (s: CrmCustomer360Source) => boolean; redacted: CrmCustomer360Source[] } {
  const redacted: CrmCustomer360Source[] = [];
  return {
    redacted,
    can: (source) => {
      if (ctx.permissions.includes(SOURCE_PERMISSIONS[source])) return true;
      redacted.push(source);
      return false;
    },
  };
}

@Injectable()
export class GetCrmCustomer360SummaryUseCase {
  constructor(
    private readonly getCustomer: GetCrmCustomerUseCase,
    private readonly listOpportunities: ListCrmOpportunitiesUseCase,
    private readonly listFollowUps: ListCrmFollowUpsUseCase,
    private readonly listConversations: ListCrmConversationsUseCase,
    private readonly listDocuments: ListDocumentsUseCase,
    private readonly listQuotationLinks: ListCrmQuotationLinksUseCase,
  ) {}

  async execute(ctx: RequestContext, customerId: string): Promise<CrmCustomer360Summary> {
    // Route gate is crm.customer.read; this fetch adds item-15 owned-record
    // scope (non-read-all callers 403 on customers they do not own) and 404s.
    const projected = await this.getCustomer.execute(ctx, customerId);
    if (projected.projection !== 'OPERATIONAL') throw new ForbiddenException('customer_360_not_permitted_for_projection');
    const customer = projected.customer;
    const { can, redacted } = sourceGate(ctx);

    const [conversations, deals, tasks, quotations, finance] = await Promise.all([
      can('conversations') ? this.conversationBlock(ctx, customerId) : null,
      can('deals') ? this.dealBlock(ctx, customerId) : null,
      can('tasks') ? this.taskBlock(ctx, customerId) : null,
      can('quotations') ? this.quotationBlock(ctx, customerId) : null,
      can('finance') ? this.financeBlock(ctx, customer.accountingCounterpartyId) : null,
    ]);

    return { customer, conversations, deals, tasks, quotations, finance, redactedSources: redacted };
  }

  private async conversationBlock(ctx: RequestContext, customerId: string) {
    // Inherits the caller's inbox visibility scope (Phase 2 ABAC); spam stays muted.
    const result = await this.listConversations.execute(ctx, { customerId, page: 1, pageSize: CONVERSATION_WINDOW });
    const open = result.items.filter((c) => OPEN_CONVERSATION_STATUSES.has(c.status)).length;
    const unread = result.items.reduce((n, c) => n + c.unreadCount, 0);
    const lastMessageAt = result.items[0]?.lastMessageAt;
    return { total: result.total, open, unread, ...(lastMessageAt ? { lastMessageAt } : {}) };
  }

  private async dealBlock(ctx: RequestContext, customerId: string) {
    // Inherits item-15 owner scope: SALES sees own deals only.
    const result = await this.listOpportunities.execute(ctx, { customerId, page: 1, pageSize: TIMELINE_SOURCE_WINDOW });
    const open = result.items.filter((o) => o.status === 'OPEN');
    const latest = open[0] ?? result.items[0];
    return {
      openCount: open.length,
      openAmountTotal: sumAmounts(open.map((o) => o.amountEstimate)),
      ...(latest ? { latest } : {}),
    };
  }

  private async taskBlock(ctx: RequestContext, customerId: string) {
    // Repo orders by dueAt asc — first item is the next due task.
    const result = await this.listFollowUps.execute(ctx, { customerId, status: 'OPEN', page: 1, pageSize: TIMELINE_SOURCE_WINDOW });
    const next = result.items[0];
    return { openCount: result.total, ...(next ? { next } : {}) };
  }

  private async quotationBlock(ctx: RequestContext, customerId: string) {
    return this.listQuotationLinks.executeForCustomer(ctx, customerId);
  }

  private async financeBlock(ctx: RequestContext, counterpartyId?: string) {
    // Visible-but-empty (no accounting link yet) is distinct from redacted.
    if (!counterpartyId) return { documents: [] };
    const result = await this.listDocuments.execute(ctx, { counterpartyId, page: 1, pageSize: DOCUMENT_WINDOW });
    return { documents: result.data.map(toFinanceDocument) };
  }
}

@Injectable()
export class GetCrmCustomer360TimelineUseCase {
  constructor(
    private readonly getCustomer: GetCrmCustomerUseCase,
    private readonly listActivities: ListCrmActivitiesUseCase,
    private readonly listOpportunities: ListCrmOpportunitiesUseCase,
    private readonly listFollowUps: ListCrmFollowUpsUseCase,
    private readonly listConversations: ListCrmConversationsUseCase,
    private readonly listDocuments: ListDocumentsUseCase,
  ) {}

  async execute(ctx: RequestContext, customerId: string, opts: { before?: string; limit?: number } = {}): Promise<CrmCustomer360Timeline> {
    const projected = await this.getCustomer.execute(ctx, customerId);
    if (projected.projection !== 'OPERATIONAL') throw new ForbiddenException('customer_360_not_permitted_for_projection');
    const customer = projected.customer;
    let before: string | undefined;
    if (opts.before !== undefined) {
      const t = new Date(opts.before);
      if (Number.isNaN(t.getTime())) throw new BadRequestException('Invalid before cursor');
      before = t.toISOString();
    }
    const rawLimit = opts.limit !== undefined && Number.isFinite(opts.limit) ? Math.trunc(opts.limit) : 30;
    const limit = Math.min(Math.max(rawLimit, 1), 100);
    const { can, redacted } = sourceGate(ctx);

    // Item 15 already appends CrmActivity rows for stage moves, closes, task
    // completions, and quotation drafts — the timeline only synthesizes events
    // no activity records: entity creation, conversation starts (15A recorded
    // deviation: inbox writes no activities), finance documents, and consent.
    const [activities, conversations, deals, tasks, documents] = await Promise.all([
      can('activities') ? this.listActivities.execute(ctx, { customerId, page: 1, pageSize: TIMELINE_SOURCE_WINDOW }) : [],
      can('conversations')
        ? this.listConversations.execute(ctx, { customerId, page: 1, pageSize: CONVERSATION_WINDOW }).then((r) => r.items)
        : [],
      can('deals') ? this.listOpportunities.execute(ctx, { customerId, page: 1, pageSize: TIMELINE_SOURCE_WINDOW }).then((r) => r.items) : [],
      can('tasks') ? this.listFollowUps.execute(ctx, { customerId, page: 1, pageSize: TIMELINE_SOURCE_WINDOW }).then((r) => r.items) : [],
      can('finance') && customer.accountingCounterpartyId
        ? this.listDocuments
            .execute(ctx, { counterpartyId: customer.accountingCounterpartyId, page: 1, pageSize: DOCUMENT_WINDOW })
            .then((r) => r.data)
        : [],
    ]);

    const events: CrmCustomer360TimelineEvent[] = [];
    for (const a of activities) {
      events.push({
        id: `ACTIVITY:${a.id}`,
        type: 'ACTIVITY',
        occurredAt: a.occurredAt,
        title: a.note,
        detail: a.type,
        actorUserId: a.actorUserId,
        refType: 'activity',
        refId: a.id,
      });
    }
    for (const c of conversations) {
      events.push({ id: `CONVERSATION_STARTED:${c.id}`, type: 'CONVERSATION_STARTED', occurredAt: c.createdAt, title: '', refType: 'conversation', refId: c.id });
    }
    for (const o of deals) {
      events.push({
        id: `DEAL_CREATED:${o.id}`,
        type: 'DEAL_CREATED',
        occurredAt: o.createdAt,
        title: o.title,
        refType: 'opportunity',
        refId: o.id,
        amount: o.amountEstimate,
        currency: o.currency,
      });
    }
    for (const t of tasks) {
      events.push({ id: `TASK_CREATED:${t.id}`, type: 'TASK_CREATED', occurredAt: t.createdAt, title: t.title, refType: 'followUp', refId: t.id });
    }
    for (const d of documents) {
      const mapped = toFinanceDocument(d);
      events.push({
        id: `FINANCE_DOCUMENT:${d.id}`,
        type: 'FINANCE_DOCUMENT',
        occurredAt: mapped.documentDate,
        title: mapped.documentNumber ?? mapped.documentType,
        detail: `${mapped.documentType} ${mapped.status}`,
        refType: 'document',
        refId: d.id,
        amount: mapped.grandTotalAmount,
        currency: mapped.currency,
      });
    }
    if (customer.consentUpdatedAt) {
      events.push({
        id: `CONSENT_CHANGED:${customer.id}`,
        type: 'CONSENT_CHANGED',
        occurredAt: customer.consentUpdatedAt,
        title: customer.consentStatus,
        ...(customer.consentNote ? { detail: customer.consentNote } : {}),
        refType: 'customer',
        refId: customer.id,
      });
    }

    // ISO-UTC strings sort lexicographically; id is the tie-break for a stable order.
    const visible = (before ? events.filter((e) => e.occurredAt < before) : events).sort((a, b) =>
      a.occurredAt === b.occurredAt ? (a.id < b.id ? 1 : -1) : a.occurredAt < b.occurredAt ? 1 : -1,
    );
    const pageEvents = visible.slice(0, limit);
    const last = pageEvents[pageEvents.length - 1];
    return {
      events: pageEvents,
      ...(visible.length > limit && last ? { nextBefore: last.occurredAt } : {}),
      redactedSources: redacted,
    };
  }
}
