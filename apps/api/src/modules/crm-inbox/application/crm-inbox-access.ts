import { ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import {
  conversationInScope,
  conversationWriteInScope,
  inboxSeesAllConversations,
  inboxWritesAllConversations,
} from '../domain/logic/crm-inbox.logic';

export type ConversationActorScope = {
  actorUserId: string;
  canAccessAll: boolean;
  expectedAssignedToUserId: string | null;
};

/**
 * Read ABAC scope for a single conversation (mirrors item 15's crm-access):
 * read-all roles see everything; everyone else only own/assigned
 * conversations plus the unassigned pickup queue.
 */
export function assertConversationInScope(
  ctx: RequestContext,
  conversation: { assignedToUserId: string | null },
): void {
  if (!conversationInScope(ctx.roles, ctx.userId, conversation.assignedToUserId)) {
    throw new ForbiddenException('Conversation is out of scope');
  }
}

/** Write ABAC scope: only owner/admin/manager may mutate across assignments. */
export function assertConversationWriteInScope(
  ctx: RequestContext,
  conversation: { assignedToUserId: string | null },
): void {
  if (!conversationWriteInScope(ctx.roles, ctx.userId, conversation.assignedToUserId)) {
    throw new ForbiddenException('Conversation is out of scope');
  }
}

/** When the caller cannot see all, restrict list queries to own/assigned + unassigned. */
export function assignedScopeForList(ctx: RequestContext): string | undefined {
  return inboxSeesAllConversations(ctx.roles) ? undefined : ctx.userId;
}

export function conversationReadActorScope(
  ctx: RequestContext,
  conversation: { assignedToUserId: string | null },
): ConversationActorScope {
  return {
    actorUserId: ctx.userId,
    canAccessAll: inboxSeesAllConversations(ctx.roles),
    expectedAssignedToUserId: conversation.assignedToUserId,
  };
}

export function conversationWriteActorScope(
  ctx: RequestContext,
  conversation: { assignedToUserId: string | null },
): ConversationActorScope {
  return {
    actorUserId: ctx.userId,
    canAccessAll: inboxWritesAllConversations(ctx.roles),
    expectedAssignedToUserId: conversation.assignedToUserId,
  };
}
