import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext, CrmFollowUpPriority } from '@watchdog-bms/contracts';
import { CreateCrmOpportunityUseCase } from '../../../crm/application/use-cases/crm-opportunity.use-case';
import { CreateCrmFollowUpUseCase } from '../../../crm/application/use-cases/crm-follow-up.use-case';
import { CreateCrmQuotationDraftUseCase } from '../../../crm/application/use-cases/crm-quotation.use-case';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { assertConversationWriteInScope, conversationWriteActorScope } from '../crm-inbox-access';
import type { CrmConversationRecord } from '../../domain/models/crm-inbox.model';

export interface CreateDealFromConversationInput {
  title: string;
  amountEstimate?: string;
  expectedCloseDate?: string;
}
export interface CreateTaskFromConversationInput {
  title: string;
  dueAt: string;
  priority?: CrmFollowUpPriority;
}
export interface CreateQuotationFromConversationInput {
  title: string;
  amountEstimate?: string;
  expectedCloseDate?: string;
  revisionReason?: string;
}

/**
 * A3 revenue loop: turn a LINE conversation into work items. Reuses the item-15
 * create flows (which enforce their own create permissions + audit) after resolving
 * the customer from the conversation, and drops a system note back into the thread so
 * the created record is visible where staff are working (the conversation "source ref").
 */
@Injectable()
export class CreateFromConversationUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly createOpportunity: CreateCrmOpportunityUseCase,
    private readonly createFollowUp: CreateCrmFollowUpUseCase,
    private readonly createQuotationDraft: CreateCrmQuotationDraftUseCase,
  ) {}

  async createDeal(ctx: RequestContext, conversationId: string, input: CreateDealFromConversationInput) {
    const conversation = await this.resolveConversation(ctx, conversationId);
    const opportunity = await this.createOpportunity.execute(ctx, {
      customerId: conversation.customerId,
      title: input.title,
      amountEstimate: input.amountEstimate,
      expectedCloseDate: input.expectedCloseDate,
    });
    await this.noteInThread(ctx, conversation, `📊 สร้างดีลจากแชท: ${opportunity.title}`);
    return opportunity;
  }

  async createTask(ctx: RequestContext, conversationId: string, input: CreateTaskFromConversationInput) {
    const conversation = await this.resolveConversation(ctx, conversationId);
    const task = await this.createFollowUp.execute(ctx, {
      customerId: conversation.customerId,
      title: input.title,
      dueAt: input.dueAt,
      priority: input.priority,
    });
    await this.noteInThread(ctx, conversation, `✅ สร้างงานติดตามจากแชท: ${task.title}`);
    return task;
  }

  async createQuotation(ctx: RequestContext, conversationId: string, input: CreateQuotationFromConversationInput) {
    const conversation = await this.resolveConversation(ctx, conversationId);
    // A quotation draft lives on an opportunity — create the deal first, then the draft.
    const opportunity = await this.createOpportunity.execute(ctx, {
      customerId: conversation.customerId,
      title: input.title,
      amountEstimate: input.amountEstimate,
      expectedCloseDate: input.expectedCloseDate,
    });
    const quotation = await this.createQuotationDraft.execute(ctx, opportunity.id, { revisionReason: input.revisionReason });
    await this.noteInThread(ctx, conversation, `📄 สร้างใบเสนอราคา (ร่าง) จากแชท: ${opportunity.title}`);
    return { opportunity, quotation };
  }

  private async resolveConversation(ctx: RequestContext, conversationId: string): Promise<CrmConversationRecord> {
    const conversation = await this.repo.findConversationById(ctx.companyId, conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');
    assertConversationWriteInScope(ctx, conversation);
    return conversation;
  }

  /** Structural note: a staff-only system message so the created record shows in the thread. */
  private async noteInThread(ctx: RequestContext, conversation: CrmConversationRecord, text: string): Promise<void> {
    try {
      await this.repo.appendOutboundMessage(
        {
          companyId: ctx.companyId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          visibility: 'INTERNAL_NOTE',
          authorType: 'SYSTEM',
          authorUserId: ctx.userId,
          messageType: 'SYSTEM',
          contentText: text,
          deliveryStatus: 'SENT',
          sentAt: new Date(),
        },
        conversation.id,
        { unreadCount: 0 },
        conversationWriteActorScope(ctx, conversation),
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code !== 'conversation_assignment_changed' && code !== 'conversation_out_of_scope') throw error;
    }
  }
}
