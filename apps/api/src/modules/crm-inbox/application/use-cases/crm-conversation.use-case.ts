import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  RequestContext,
  ListCrmConversationsFilter,
  ListCrmConversationsResult,
  CrmConversationDetail,
  CrmConversationPriority,
  CrmConversationStatus,
  CrmConversationSummary,
  SendCrmMessageInput,
  SendCrmMessageResult,
  SetCrmConversationStatusInput,
  UpdateCrmConversationAutoReplyRequest,
  SetCrmConversationPriorityInput,
  SetCrmConversationTagsInput,
  AssignCrmConversationInput,
} from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { LineMessagingAdapter } from '../../infrastructure/line-messaging.adapter';
import { MessagingChannelSecretsService } from './messaging-channel.use-case';
import type { CrmConversationRecord } from '../../domain/models/crm-inbox.model';
import { lineReplyRetryKeyForMessage, normalizeConversationTags, previewText, resolveReplySendOutcome, statusAfterStaffReply, validateOutboundText } from '../../domain/logic/crm-inbox.logic';
import { REPLY_SEND_MAX_ATTEMPTS } from '../../domain/crm-inbox.constants';
import {
  assertConversationInScope,
  assertConversationWriteInScope,
  assignedScopeForList,
  conversationWriteActorScope,
} from '../crm-inbox-access';
import { toConversationSummary, toMessageSummary } from '../dto/crm-inbox.mapper';

function requirePermission(ctx: RequestContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
}

async function runScopedConversationMutation<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (['conversation_assignment_changed', 'conversation_out_of_scope', 'conversation_assignment_not_authorized'].includes(code)) {
      throw new ForbiddenException('Conversation is out of scope');
    }
    throw error;
  }
}

const MAX_PAGE_SIZE = 100;

const CONVERSATION_STATUSES: ReadonlySet<string> = new Set<CrmConversationStatus>([
  'NEW', 'OPEN', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'FOLLOW_UP', 'RESOLVED', 'SPAM',
]);

const CONVERSATION_PRIORITIES: ReadonlySet<string> = new Set<CrmConversationPriority>([
  'LOW', 'NORMAL', 'HIGH', 'URGENT',
]);

/** Query strings arrive as Number()-coerced values; NaN must become 400, not a Prisma 500. */
function sanePositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new BadRequestException('page/pageSize must be positive integers');
  }
  return Math.min(max, value);
}

@Injectable()
export class ListCrmConversationsUseCase {
  constructor(private readonly repo: PrismaCrmInboxRepository) {}

  async execute(ctx: RequestContext, filter: ListCrmConversationsFilter): Promise<ListCrmConversationsResult> {
    requirePermission(ctx, 'crm.inbox.read');
    if (filter.status !== undefined && !CONVERSATION_STATUSES.has(filter.status)) {
      throw new BadRequestException('Unknown conversation status');
    }
    if (filter.assignee !== undefined && filter.assignee !== 'me' && filter.assignee !== 'none') {
      throw new BadRequestException('Unknown assignee filter');
    }
    const page = sanePositiveInt(filter.page, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = sanePositiveInt(filter.pageSize, 25, MAX_PAGE_SIZE);
    const search = filter.search?.trim() || undefined;
    // ABAC (spec §13/§19): non-manager roles see own/assigned + unassigned only.
    const scopeUserId = assignedScopeForList(ctx);

    const [{ items, total }, counts] = await Promise.all([
      this.repo.listConversations(ctx.companyId, {
        status: filter.status,
        search,
        overdue: filter.overdue,
        unanswered: filter.unanswered,
        tag: filter.tag?.trim() || undefined,
        assignedToUserId: filter.assignee === 'me' ? ctx.userId : filter.assignee === 'none' ? null : undefined,
        scopeUserId,
        customerId: filter.customerId?.trim() || undefined,
        page,
        pageSize,
      }),
      this.repo.conversationCounts(ctx.companyId, ctx.userId, scopeUserId),
    ]);
    const [names, assigneeNames] = await Promise.all([
      this.repo.customerDisplayNames(ctx.companyId, items.map((c) => c.customerId)),
      this.repo.userDisplayNames(items.map((c) => c.assignedToUserId).filter((id): id is string => Boolean(id))),
    ]);

    return {
      items: items.map((c) =>
        toConversationSummary(c, names.get(c.customerId), c.assignedToUserId ? assigneeNames.get(c.assignedToUserId) : undefined),
      ),
      total,
      page,
      pageSize,
      statusCounts: counts.statusCounts as ListCrmConversationsResult['statusCounts'],
      overdueCount: counts.overdueCount,
      unansweredCount: counts.unansweredCount,
      mineCount: counts.mineCount,
      unassignedCount: counts.unassignedCount,
    };
  }
}

@Injectable()
export class GetCrmConversationUseCase {
  constructor(private readonly repo: PrismaCrmInboxRepository) {}

  async execute(ctx: RequestContext, conversationId: string): Promise<CrmConversationDetail> {
    requirePermission(ctx, 'crm.inbox.read');
    const conversation = await this.repo.findConversationById(ctx.companyId, conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');

    assertConversationInScope(ctx, conversation);

    const [messages, names, assigneeNames] = await Promise.all([
      this.repo.listMessages(ctx.companyId, conversation.id),
      this.repo.customerDisplayNames(ctx.companyId, [conversation.customerId]),
      this.repo.userDisplayNames(conversation.assignedToUserId ? [conversation.assignedToUserId] : []),
    ]);

    return {
      ...toConversationSummary(
        conversation,
        names.get(conversation.customerId),
        conversation.assignedToUserId ? assigneeNames.get(conversation.assignedToUserId) : undefined,
      ),
      messages: messages.map(toMessageSummary),
    };
  }
}

// ---- Phase 2 triage mutations ----

/** Shared summary resolution after a mutation. */
async function resolveSummary(
  repo: PrismaCrmInboxRepository,
  record: CrmConversationRecord,
): Promise<CrmConversationSummary> {
  const [names, assigneeNames] = await Promise.all([
    repo.customerDisplayNames(record.companyId, [record.customerId]),
    repo.userDisplayNames(record.assignedToUserId ? [record.assignedToUserId] : []),
  ]);
  return toConversationSummary(
    record,
    names.get(record.customerId),
    record.assignedToUserId ? assigneeNames.get(record.assignedToUserId) : undefined,
  );
}

@Injectable()
export class SendCrmInboxMessageUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly secrets: MessagingChannelSecretsService,
    private readonly line: LineMessagingAdapter,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, conversationId: string, input: SendCrmMessageInput): Promise<SendCrmMessageResult> {
    const visibility = input.visibility ?? 'CUSTOMER';
    if (visibility !== 'CUSTOMER' && visibility !== 'INTERNAL_NOTE') {
      throw new BadRequestException('Unknown message visibility');
    }
    // Reply and internal note are separate permissions: a note can never reach
    // the customer, so it is grantable to roles that must not send externally.
    requirePermission(ctx, visibility === 'CUSTOMER' ? 'crm.inbox.reply' : 'crm.inbox.note');

    const validationError = validateOutboundText(input.text ?? '');
    if (validationError) throw new BadRequestException(validationError);
    const text = input.text.trim();
    const now = new Date();

    const conversation = await this.repo.findConversationById(ctx.companyId, conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');
    assertConversationWriteInScope(ctx, conversation);

    if (visibility === 'INTERNAL_NOTE') {
      // Structural send-rejection: this branch never touches the LINE adapter.
      const message = await runScopedConversationMutation(() => this.repo.appendOutboundMessage(
        {
          companyId: ctx.companyId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          visibility: 'INTERNAL_NOTE',
          authorType: 'STAFF',
          authorUserId: ctx.userId,
          messageType: 'TEXT',
          contentText: text,
          deliveryStatus: 'SENT',
          sentAt: now,
        },
        conversation.id,
        // Notes are annotations: no preview/status/timestamp changes.
        { unreadCount: 0 },
        conversationWriteActorScope(ctx, conversation),
      ));
      void this.audit.log({
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: 'crm.inbox.note',
        targetType: 'crm_conversation',
        targetId: conversation.id,
        requestId: ctx.requestId,
        result: 'SUCCESS',
        riskLevel: 'LOW',
        metadataJson: { messageId: message.id },
      });
      const fresh = await this.repo.findConversationById(ctx.companyId, conversation.id);
      return { message: toMessageSummary(message), conversation: await resolveSummary(this.repo, fresh ?? conversation) };
    }

    // Customer reply path.
    const channel = await this.repo.findChannelById(ctx.companyId, conversation.channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.status === 'DISABLED') throw new BadRequestException('channel_disabled');

    const identity = await this.repo.findIdentityById(ctx.companyId, conversation.channelIdentityId);
    if (!identity) throw new NotFoundException('Channel identity not found');
    if (identity.status === 'UNFOLLOWED') throw new BadRequestException('customer_unfollowed');

    // Persist first (PENDING) so a sent LINE message can never be untracked.
    const pending = await runScopedConversationMutation(() => this.repo.appendOutboundMessage(
      {
        companyId: ctx.companyId,
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        visibility: 'CUSTOMER',
        authorType: 'STAFF',
        authorUserId: ctx.userId,
        messageType: 'TEXT',
        contentText: text,
        deliveryStatus: 'PENDING',
      },
      conversation.id,
      { unreadCount: 0 },
      conversationWriteActorScope(ctx, conversation),
    ));

    let push;
    try {
      push = await this.repo.withLiveCustomerLock(
        {
          companyId: ctx.companyId,
          customerId: conversation.customerId,
          conversationId: conversation.id,
          channelIdentityId: conversation.channelIdentityId,
          actorScope: conversationWriteActorScope(ctx, conversation),
          suppressPendingMessageIdOnScopeFailure: pending.id,
        },
        async (liveIdentity) => this.line.pushTextMessage(
          this.secrets.decrypt(channel).accessToken,
          liveIdentity.providerUserId,
          text,
          lineReplyRetryKeyForMessage(pending.id),
        ),
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code === 'conversation_assignment_changed' || code === 'conversation_out_of_scope') {
        await this.repo.updateMessageDelivery(pending.id, {
          deliveryStatus: 'FAILED',
          deliveryError: 'conversation_out_of_scope',
          deliveryNextAttemptAt: null,
        });
        throw new ForbiddenException('Conversation is out of scope');
      }
      throw error;
    }
    if (!push) throw new BadRequestException('customer_unavailable');

    let message;
    if (push.ok) {
      message = await this.repo.updateMessageDelivery(pending.id, { deliveryStatus: 'SENT', sentAt: now });
      if (!message) throw new BadRequestException('customer_unavailable');
      await runScopedConversationMutation(() => this.repo.updateConversation(ctx.companyId, conversation.id, {
        status: statusAfterStaffReply(conversation.status),
        lastMessageAt: now,
        lastOutboundAt: now,
        lastMessagePreview: previewText(text),
        ...(conversation.firstRespondedAt ? {} : { firstRespondedAt: now }),
      }, conversationWriteActorScope(ctx, conversation)));
      void this.outbox.append('crm.conversation.message_sent', 'crm_conversation', conversation.id, {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        requestId: ctx.requestId,
        aggregateType: 'crm_conversation',
        aggregateId: conversation.id,
        occurredAt: now.toISOString(),
        data: { messageId: message.id, customerId: conversation.customerId, channelId: channel.id },
      });
    } else {
      // A5: a transient failure (429/5xx/network) is left PENDING with a backoff so the
      // reply-retry scanner re-pushes it; a terminal failure (401/4xx) stays FAILED. No
      // status advance / firstRespondedAt either way — the customer received nothing yet.
      const outcome = resolveReplySendOutcome({ ok: false, error: push.error, retryAfterSeconds: push.retryAfterSeconds, attemptCountAfter: 1, maxAttempts: REPLY_SEND_MAX_ATTEMPTS, now });
      message = await this.repo.updateMessageDelivery(pending.id, {
        deliveryStatus: outcome.status,
        deliveryError: push.error,
        deliveryAttemptCount: 1,
        deliveryNextAttemptAt: outcome.nextAttemptAt ?? null,
      });
      if (!message) throw new BadRequestException('customer_unavailable');
    }

    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'crm.inbox.reply',
      targetType: 'crm_conversation',
      targetId: conversation.id,
      requestId: ctx.requestId,
      result: push.ok ? 'SUCCESS' : 'FAILED',
      riskLevel: 'MEDIUM',
      metadataJson: { messageId: message.id, deliveryStatus: message.deliveryStatus, ...(push.ok ? {} : { error: push.error }) },
    });

    const fresh = await this.repo.findConversationById(ctx.companyId, conversation.id);
    return { message: toMessageSummary(message), conversation: await resolveSummary(this.repo, fresh ?? conversation) };
  }
}

@Injectable()
export class SetCrmConversationStatusUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(
    ctx: RequestContext,
    conversationId: string,
    input: SetCrmConversationStatusInput,
  ): Promise<CrmConversationSummary> {
    requirePermission(ctx, 'crm.inbox.resolve');
    if (!input?.status || !CONVERSATION_STATUSES.has(input.status)) {
      throw new BadRequestException('Unknown conversation status');
    }
    const conversation = await this.repo.findConversationById(ctx.companyId, conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');
    assertConversationWriteInScope(ctx, conversation);
    if (conversation.status === input.status) return resolveSummary(this.repo, conversation);

    const now = new Date();
    const data: Record<string, unknown> = { status: input.status };
    if (input.status === 'RESOLVED') {
      data['resolvedAt'] = now;
      data['resolvedByUserId'] = ctx.userId;
    } else if (conversation.status === 'RESOLVED') {
      // Manual un-resolve; auto-reopen (customer writeback) owns reopenedCount.
      data['resolvedAt'] = null;
      data['resolvedByUserId'] = null;
    }
    // Spam is muted: no unread badge nagging from the spam tab (spec §19).
    if (input.status === 'SPAM') data['unreadCount'] = 0;

    const updated = await runScopedConversationMutation(() => this.repo.updateConversation(
      ctx.companyId,
      conversation.id,
      data,
      conversationWriteActorScope(ctx, conversation),
    ));
    if (!updated) throw new NotFoundException('Conversation not found');

    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'crm.inbox.status_change',
      targetType: 'crm_conversation',
      targetId: conversation.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: { from: conversation.status, to: input.status },
    });
    void this.outbox.append('crm.conversation.status_changed', 'crm_conversation', conversation.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'crm_conversation',
      aggregateId: conversation.id,
      occurredAt: now.toISOString(),
      data: { from: conversation.status, to: input.status },
    });

    return resolveSummary(this.repo, updated);
  }
}

@Injectable()
export class UpdateCrmConversationAutoReplyUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(
    ctx: RequestContext,
    conversationId: string,
    input: UpdateCrmConversationAutoReplyRequest,
  ): Promise<CrmConversationSummary> {
    requirePermission(ctx, 'crm.inbox.reply');
    if (typeof input?.enabled !== 'boolean') throw new BadRequestException('enabled must be a boolean');

    const conversation = await this.repo.findConversationById(ctx.companyId, conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');
    assertConversationWriteInScope(ctx, conversation);
    if (conversation.autoReplyEnabled === input.enabled) return resolveSummary(this.repo, conversation);

    const updated = await runScopedConversationMutation(() => this.repo.updateConversation(
      ctx.companyId,
      conversation.id,
      { autoReplyEnabled: input.enabled },
      conversationWriteActorScope(ctx, conversation),
    ));
    if (!updated) throw new NotFoundException('Conversation not found');

    const metadata = { enabled: input.enabled, previous: conversation.autoReplyEnabled };
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'crm.inbox.auto_reply_override',
      targetType: 'crm_conversation',
      targetId: conversation.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: metadata,
    });
    await this.outbox.append('crm.conversation.auto_reply_override_changed', 'crm_conversation', conversation.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'crm_conversation',
      aggregateId: conversation.id,
      occurredAt: new Date().toISOString(),
      data: metadata,
    });

    return resolveSummary(this.repo, updated);
  }
}

@Injectable()
export class AssignCrmConversationUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(
    ctx: RequestContext,
    conversationId: string,
    input: AssignCrmConversationInput,
  ): Promise<CrmConversationSummary> {
    if (input?.assignedToUserId !== null && typeof input?.assignedToUserId !== 'string') {
      throw new BadRequestException('assignedToUserId must be a user id or null');
    }
    if (typeof input.assignedToUserId === 'string' && input.assignedToUserId.trim() === '') {
      throw new BadRequestException('assignedToUserId must be a user id or null');
    }
    const conversation = await this.repo.findConversationById(ctx.companyId, conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');

    // crm.inbox.assign holders rebalance freely. Everyone else gets the spec's
    // pickup model only: claim an unassigned conversation for yourself, or
    // release one you hold — both need reply capability (auditors stay read-only).
    if (!ctx.permissions.includes('crm.inbox.assign')) {
      const pickup = conversation.assignedToUserId === null && input.assignedToUserId === ctx.userId;
      const releaseOwn = conversation.assignedToUserId === ctx.userId && input.assignedToUserId === null;
      if (!ctx.permissions.includes('crm.inbox.reply') || (!pickup && !releaseOwn)) {
        throw new ForbiddenException('Missing permission: crm.inbox.assign');
      }
    }

    if (
      input.assignedToUserId !== null
      && !(await this.repo.hasActiveCompanyMember(ctx.companyId, input.assignedToUserId))
    ) {
      throw new BadRequestException('assignedToUserId must be an active company member');
    }

    let updated: CrmConversationRecord | null;
    try {
      updated = await this.repo.assignConversation(
        ctx.companyId,
        conversation.id,
        input.assignedToUserId,
        {
          ...conversationWriteActorScope(ctx, conversation),
          canAccessAll: ctx.permissions.includes('crm.inbox.assign'),
          canAssignAll: ctx.permissions.includes('crm.inbox.assign'),
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'assignee_not_active_company_member') {
        throw new BadRequestException('assignedToUserId must be an active company member');
      }
      if (error instanceof Error && ['conversation_assignment_changed', 'conversation_out_of_scope', 'conversation_assignment_not_authorized'].includes(error.message)) {
        throw new ForbiddenException('Conversation is out of scope');
      }
      throw error;
    }
    if (!updated) throw new NotFoundException('Conversation not found');

    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'crm.inbox.assign',
      targetType: 'crm_conversation',
      targetId: conversation.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: { assignedToUserId: input.assignedToUserId },
    });
    void this.outbox.append('crm.conversation.assigned', 'crm_conversation', conversation.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'crm_conversation',
      aggregateId: conversation.id,
      occurredAt: new Date().toISOString(),
      data: { assignedToUserId: input.assignedToUserId },
    });

    return resolveSummary(this.repo, updated);
  }
}

// Priority/tags reuse `crm.inbox.resolve` — the shipped triage-metadata
// permission (status changes already live under it; same ADMIN/MANAGER/SALES
// holders the spec's table intends).

@Injectable()
export class SetCrmConversationPriorityUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(
    ctx: RequestContext,
    conversationId: string,
    input: SetCrmConversationPriorityInput,
  ): Promise<CrmConversationSummary> {
    requirePermission(ctx, 'crm.inbox.resolve');
    if (!input?.priority || !CONVERSATION_PRIORITIES.has(input.priority)) {
      throw new BadRequestException('Unknown conversation priority');
    }
    const conversation = await this.repo.findConversationById(ctx.companyId, conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');
    assertConversationWriteInScope(ctx, conversation);
    if (conversation.priority === input.priority) return resolveSummary(this.repo, conversation);

    const updated = await runScopedConversationMutation(() => this.repo.updateConversation(
      ctx.companyId,
      conversation.id,
      { priority: input.priority },
      conversationWriteActorScope(ctx, conversation),
    ));
    if (!updated) throw new NotFoundException('Conversation not found');

    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'crm.inbox.priority_change',
      targetType: 'crm_conversation',
      targetId: conversation.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: { from: conversation.priority, to: input.priority },
    });
    void this.outbox.append('crm.conversation.priority_changed', 'crm_conversation', conversation.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'crm_conversation',
      aggregateId: conversation.id,
      occurredAt: new Date().toISOString(),
      data: { from: conversation.priority, to: input.priority },
    });

    return resolveSummary(this.repo, updated);
  }
}

@Injectable()
export class SetCrmConversationTagsUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(
    ctx: RequestContext,
    conversationId: string,
    input: SetCrmConversationTagsInput,
  ): Promise<CrmConversationSummary> {
    requirePermission(ctx, 'crm.inbox.resolve');
    const normalized = normalizeConversationTags(input?.tags);
    if ('error' in normalized) throw new BadRequestException(normalized.error);

    const conversation = await this.repo.findConversationById(ctx.companyId, conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');
    assertConversationWriteInScope(ctx, conversation);
    if (JSON.stringify(conversation.tags) === JSON.stringify(normalized.tags)) {
      return resolveSummary(this.repo, conversation);
    }

    const updated = await runScopedConversationMutation(() => this.repo.updateConversation(
      ctx.companyId,
      conversation.id,
      { tagsJson: normalized.tags },
      conversationWriteActorScope(ctx, conversation),
    ));
    if (!updated) throw new NotFoundException('Conversation not found');

    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'crm.inbox.tags_change',
      targetType: 'crm_conversation',
      targetId: conversation.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: { changed: true, fromCount: conversation.tags.length, toCount: normalized.tags.length },
    });
    void this.outbox.append('crm.conversation.tags_changed', 'crm_conversation', conversation.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'crm_conversation',
      aggregateId: conversation.id,
      occurredAt: new Date().toISOString(),
      data: { tagCount: normalized.tags.length },
    });

    return resolveSummary(this.repo, updated);
  }
}

@Injectable()
export class GetCrmMessageContentUseCase {
  constructor(private readonly repo: PrismaCrmInboxRepository) {}

  /** Streams stored inbound media. Same permission + scope as reading the thread. */
  async execute(
    ctx: RequestContext,
    conversationId: string,
    messageId: string,
  ): Promise<{ data: Buffer; mimeType: string; fileName: string }> {
    requirePermission(ctx, 'crm.inbox.read');
    const conversation = await this.repo.findConversationById(ctx.companyId, conversationId);
    if (!conversation) throw new NotFoundException('Message content not found');
    assertConversationInScope(ctx, conversation);
    const message = await this.repo.findMessageInConversation(ctx.companyId, conversationId, messageId);
    if (!message?.attachmentId) throw new NotFoundException('Message content not found');
    const stored = await this.repo.findAttachmentBlob(ctx.companyId, message.attachmentId);
    if (!stored) throw new NotFoundException('Message content not found');
    return stored;
  }
}

@Injectable()
export class MarkCrmConversationReadUseCase {
  constructor(private readonly repo: PrismaCrmInboxRepository) {}

  async execute(ctx: RequestContext, conversationId: string): Promise<{ ok: true }> {
    requirePermission(ctx, 'crm.inbox.read');
    const conversation = await this.repo.findConversationById(ctx.companyId, conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');
    assertConversationWriteInScope(ctx, conversation);
    await runScopedConversationMutation(() => this.repo.markConversationRead(
      ctx.companyId,
      conversation.id,
      conversationWriteActorScope(ctx, conversation),
    ));
    return { ok: true };
  }
}
