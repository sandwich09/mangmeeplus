import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CrmConversationStatus,
  CrmFollowUpStatus,
  DashboardPeriodKind,
  RequestContext,
  SourceRef,
  ToolResult,
} from '@watchdog-bms/contracts';
import { GetCrmPipelineBoardUseCase } from '../../../crm/application/use-cases/crm-opportunity.use-case';
import { ListCrmFollowUpsUseCase } from '../../../crm/application/use-cases/crm-follow-up.use-case';
import { ListCrmBookingsUseCase } from '../../../crm/application/use-cases/crm-booking.use-case';
import { sumAmounts } from '../../../crm/domain/logic/crm.logic';
import { GetCrmReportsSummaryUseCase } from '../../../crm-inbox/application/use-cases/crm-reports-summary.use-case';
import { GetCrmConversationUseCase, ListCrmConversationsUseCase } from '../../../crm-inbox/application/use-cases/crm-conversation.use-case';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';

function now(): string { return new Date().toISOString(); }

function toCtx(ctx: ErpToolContext): RequestContext {
  return {
    requestId: ctx.requestId ?? '', authSubject: ctx.userId, userId: ctx.userId,
    companyId: ctx.companyId, membershipId: ctx.membershipId ?? '', roles: ctx.roles ?? [],
    permissions: ctx.permissions, scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds },
    authProvider: 'watchdog',
  };
}

function ref(ctx: ErpToolContext, asOf: string, module: 'crm' | 'crm-inbox', entityType: string, label: string, path: string, entityId?: string): SourceRef {
  return {
    label, module, entityType, ...(entityId && { entityId }), asOf,
    permissionChecked: true, webPath: `/companies/${ctx.companyId}${path}`,
  };
}

function forbidden(toolName: string, asOf: string): ToolResult {
  return { toolName, status: 'forbidden', sourceRefs: [], asOf };
}

const REPORT_PERIODS = new Set<DashboardPeriodKind>(['today', 'week', 'month', 'quarter', 'last_month']);

@Injectable()
export class CrmGetReportSummaryTool implements ErpReadToolPort {
  toolName = 'crm.get_report_summary';
  constructor(private readonly getReport: GetCrmReportsSummaryUseCase) {}

  async execute(ctx: ErpToolContext, input?: { branchId?: string; period?: DashboardPeriodKind }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('crm.report.read')) return forbidden(this.toolName, asOf);
    const period = input?.period && REPORT_PERIODS.has(input.period) ? input.period : 'today';
    const summary = await this.getReport.execute(toCtx(ctx), {
      ...(typeof input?.branchId === 'string' && input.branchId.trim() && { branchId: input.branchId.trim().slice(0, 200) }),
      period,
    });
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        period,
        total: summary.total,
        resolved: summary.resolved,
        resolvedRate: summary.resolvedRate,
        avgResponseMin: summary.avgResponseMin,
        overdue: summary.overdue,
        statusBreakdown: summary.statusBreakdown,
        staffPerformance: summary.staffPerformance.slice(0, 10),
        topCustomers: summary.topCustomers.slice(0, 5),
        retention: summary.retention,
        branchId: summary.branchId,
      },
      sourceRefs: [ref(ctx, asOf, 'crm-inbox', 'crm_report_summary', 'รายงาน CRM', '/crm-reports')],
      asOf,
    };
  }
}

@Injectable()
export class CrmGetPipelineSummaryTool implements ErpReadToolPort {
  toolName = 'crm.get_pipeline_summary';
  constructor(private readonly getBoard: GetCrmPipelineBoardUseCase) {}

  async execute(ctx: ErpToolContext, input?: { assignedToMe?: boolean }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('crm.opportunity.read')) return forbidden(this.toolName, asOf);
    const board = await this.getBoard.execute(toCtx(ctx), input?.assignedToMe ? 'own' : undefined);
    const byStage = board.columns.map((column) => ({
      stageId: column.stage.id,
      stageName: column.stage.name,
      canonicalGroup: column.stage.canonicalGroup,
      count: column.count,
      totalAmount: column.totalAmount,
    }));
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        openCount: byStage.reduce((count, stage) => count + stage.count, 0),
        totalPipelineAmount: sumAmounts(byStage.map((stage) => stage.totalAmount)),
        byStage,
      },
      sourceRefs: [ref(ctx, asOf, 'crm', 'pipeline_summary', 'สรุป Pipeline', '/crm')],
      asOf,
    };
  }
}

type FollowUpInput = {
  view?: 'due_today' | 'overdue' | 'upcoming';
  customerId?: string;
  opportunityId?: string;
  assignedToMe?: boolean;
  limit?: number;
};

@Injectable()
export class CrmListOpenFollowupsTool implements ErpReadToolPort<FollowUpInput> {
  toolName = 'crm.list_open_followups';
  constructor(private readonly listFollowUps: ListCrmFollowUpsUseCase) {}

  async execute(ctx: ErpToolContext, input: FollowUpInput = {}): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('crm.follow_up.read')) return forbidden(this.toolName, asOf);
    const limit = Number.isSafeInteger(input.limit) ? Math.min(Math.max(Number(input.limit), 1), 10) : 10;
    const result = await this.listFollowUps.execute(toCtx(ctx), {
      status: 'OPEN' as CrmFollowUpStatus,
      ...(input.view && { view: input.view }),
      ...(typeof input.customerId === 'string' && input.customerId.trim() && { customerId: input.customerId.trim().slice(0, 200) }),
      ...(typeof input.opportunityId === 'string' && input.opportunityId.trim() && { opportunityId: input.opportunityId.trim().slice(0, 200) }),
      ...(input.assignedToMe && { scope: 'own' as const }),
      page: 1,
      pageSize: limit,
    });
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        total: result.total,
        items: result.items.map((item) => ({
          id: item.id, customerId: item.customerId ?? null, opportunityId: item.opportunityId ?? null,
          title: item.title, dueAt: item.dueAt, priority: item.priority, channel: item.channel, status: item.status,
        })),
      },
      sourceRefs: [ref(ctx, asOf, 'crm', 'follow_up_list', 'งานติดตามลูกค้า', '/crm')],
      asOf,
    };
  }
}

type BookingInput = { weekStart?: string; branchId?: string; limit?: number };

async function bookings(ctx: ErpToolContext, input: BookingInput, list: ListCrmBookingsUseCase) {
  return list.execute(toCtx(ctx), {
    ...(typeof input.weekStart === 'string' && input.weekStart.trim() && { weekStart: input.weekStart.trim() }),
    ...(typeof input.branchId === 'string' && input.branchId.trim() && { branchId: input.branchId.trim().slice(0, 200) }),
  });
}

@Injectable()
export class CrmGetBookingSummaryTool implements ErpReadToolPort<BookingInput> {
  toolName = 'crm.get_booking_summary';
  constructor(private readonly listBookings: ListCrmBookingsUseCase) {}

  async execute(ctx: ErpToolContext, input: BookingInput = {}): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('crm.booking.read')) return forbidden(this.toolName, asOf);
    const result = await bookings(ctx, input, this.listBookings);
    const byStatus: Record<string, number> = {};
    for (const item of result.items) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    return {
      toolName: this.toolName,
      status: 'ok',
      data: { total: result.items.length, byStatus, weekStart: result.weekStart, weekEnd: result.weekEnd },
      sourceRefs: [ref(ctx, asOf, 'crm', 'booking_summary', 'สรุปนัดหมาย', '/bookings')],
      asOf,
    };
  }
}

@Injectable()
export class CrmListBookingsTool implements ErpReadToolPort<BookingInput> {
  toolName = 'crm.list_bookings';
  constructor(private readonly listBookings: ListCrmBookingsUseCase) {}

  async execute(ctx: ErpToolContext, input: BookingInput = {}): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('crm.booking.read')) return forbidden(this.toolName, asOf);
    const result = await bookings(ctx, input, this.listBookings);
    const limit = Number.isSafeInteger(input.limit) ? Math.min(Math.max(Number(input.limit), 1), 10) : 10;
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        total: result.items.length,
        weekStart: result.weekStart,
        weekEnd: result.weekEnd,
        items: result.items.slice(0, limit).map((item) => ({
          id: item.id, branchId: item.branchId, customerId: item.customerId,
          customerName: item.customerName ?? null, serviceName: item.serviceName,
          staffUserId: item.staffUserId ?? null, startAt: item.startAt, endAt: item.endAt, status: item.status,
        })),
      },
      sourceRefs: [ref(ctx, asOf, 'crm', 'booking_list', 'รายการนัดหมาย', '/bookings')],
      asOf,
    };
  }
}

type ConversationListInput = {
  status?: CrmConversationStatus;
  search?: string;
  overdue?: boolean;
  assignee?: 'me' | 'none';
  customerId?: string;
  limit?: number;
};

function conversationItem(item: any) {
  return {
    id: item.id,
    customerId: item.customerId,
    customerDisplayName: item.customerDisplayName ?? null,
    status: item.status,
    priority: item.priority,
    tags: item.tags.slice(0, 10),
    assignedToDisplayName: item.assignedToDisplayName ?? null,
    unreadCount: item.unreadCount,
    lastMessageAt: item.lastMessageAt ?? null,
    lastMessagePreview: item.lastMessagePreview?.slice(0, 200) ?? null,
    firstResponseDueAt: item.firstResponseDueAt ?? null,
    slaBreachedAt: item.slaBreachedAt ?? null,
  };
}

@Injectable()
export class CrmGetInboxSummaryTool implements ErpReadToolPort {
  toolName = 'crm.get_inbox_summary';
  constructor(private readonly listConversations: ListCrmConversationsUseCase) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('crm.inbox.read')) return forbidden(this.toolName, asOf);
    const result = await this.listConversations.execute(toCtx(ctx), { page: 1, pageSize: 1 });
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        total: result.total, statusCounts: result.statusCounts ?? {}, overdueCount: result.overdueCount ?? 0,
        mineCount: result.mineCount ?? 0, unassignedCount: result.unassignedCount ?? 0,
      },
      sourceRefs: [ref(ctx, asOf, 'crm-inbox', 'inbox_summary', 'สรุปกล่องข้อความ CRM', '/inbox')],
      asOf,
    };
  }
}

@Injectable()
export class CrmListConversationsTool implements ErpReadToolPort<ConversationListInput> {
  toolName = 'crm.list_conversations';
  constructor(private readonly listConversations: ListCrmConversationsUseCase) {}

  async execute(ctx: ErpToolContext, input: ConversationListInput = {}): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('crm.inbox.read')) return forbidden(this.toolName, asOf);
    const limit = Number.isSafeInteger(input.limit) ? Math.min(Math.max(Number(input.limit), 1), 10) : 10;
    const result = await this.listConversations.execute(toCtx(ctx), {
      ...(input.status && { status: input.status }),
      ...(typeof input.search === 'string' && input.search.trim() && { search: input.search.trim().slice(0, 160) }),
      ...(input.overdue === true && { overdue: true }),
      ...(input.assignee && { assignee: input.assignee }),
      ...(typeof input.customerId === 'string' && input.customerId.trim() && { customerId: input.customerId.trim().slice(0, 200) }),
      page: 1,
      pageSize: limit,
    });
    return {
      toolName: this.toolName,
      status: 'ok',
      data: { total: result.total, items: result.items.map(conversationItem) },
      sourceRefs: [ref(ctx, asOf, 'crm-inbox', 'conversation_list', 'รายการสนทนา CRM', '/inbox')],
      asOf,
    };
  }
}

@Injectable()
export class CrmGetConversationSummaryTool implements ErpReadToolPort<{ conversationId?: string }> {
  toolName = 'crm.get_conversation_summary';
  constructor(private readonly getConversation: GetCrmConversationUseCase) {}

  async execute(ctx: ErpToolContext, input: { conversationId?: string } = {}): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('crm.inbox.read')) return forbidden(this.toolName, asOf);
    const conversationId = typeof input.conversationId === 'string' ? input.conversationId.trim().slice(0, 200) : '';
    if (!conversationId) {
      return { toolName: this.toolName, status: 'ok', data: { needsConversationId: true }, sourceRefs: [ref(ctx, asOf, 'crm-inbox', 'conversation_summary', 'ข้อมูลการสนทนา CRM', '/inbox')], asOf };
    }
    let detail;
    try {
      detail = await this.getConversation.execute(toCtx(ctx), conversationId);
    } catch (error) {
      if (error instanceof ForbiddenException) return { ...forbidden(this.toolName, asOf), errorCode: 'CONVERSATION_SCOPE_DENIED' };
      if (error instanceof NotFoundException) return {
        toolName: this.toolName, status: 'ok', data: { found: false },
        sourceRefs: [ref(ctx, asOf, 'crm-inbox', 'conversation_query', 'ข้อมูลการสนทนา CRM', '/inbox')],
        asOf, errorCode: 'CONVERSATION_NOT_FOUND',
      };
      throw error;
    }
    const recentCustomerVisibleMessages = detail.messages
      .filter((message) => message.visibility === 'CUSTOMER')
      .slice(-5)
      .map((message) => ({
        direction: message.direction,
        messageType: message.messageType,
        contentPreview: message.contentText?.slice(0, 200) ?? null,
        sentAt: message.sentAt ?? null,
        createdAt: message.createdAt,
      }));
    return {
      toolName: this.toolName,
      status: 'ok',
      data: { conversation: conversationItem(detail), recentCustomerVisibleMessages },
      sourceRefs: [ref(ctx, asOf, 'crm-inbox', 'conversation_summary', 'ข้อมูลการสนทนา CRM', `/inbox?conversation=${encodeURIComponent(conversationId)}`, conversationId)],
      asOf,
    };
  }
}
