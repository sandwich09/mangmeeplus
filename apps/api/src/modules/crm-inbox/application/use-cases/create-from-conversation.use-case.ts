import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { RequestContext, CrmFollowUpPriority } from '@watchdog-bms/contracts';
import { CreateCrmOpportunityUseCase } from '../../../crm/application/use-cases/crm-opportunity.use-case';
import { CreateCrmFollowUpUseCase } from '../../../crm/application/use-cases/crm-follow-up.use-case';
import { PrismaCrmRepository } from '../../../crm/infrastructure/prisma-crm.repository';
import { assertCanManageOwned, requirePermission } from '../../../crm/application/crm-access';
import { crmCanManageAll, d, decStr } from '../../../crm/domain/logic/crm.logic';
import { toOpportunitySummary, toQuotationLinkSummary } from '../../../crm/application/dto/crm.mapper';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import {
  isSalesDocumentLaunchClosedError,
  rethrowSalesDocumentRootError,
} from '../../../accounting-documents/application/sales-document-launch-gate';
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
  idempotencyKey: string;
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
    private readonly crmRepo: PrismaCrmRepository,
    private readonly launchGate: LaunchGateGuardService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
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
    requirePermission(ctx, 'crm.opportunity.create');
    requirePermission(ctx, 'crm.quotation.link');
    if (!ctx.permissions.includes('accounting.quotation.create') && !ctx.permissions.includes('accounting.document.create')) {
      throw new ForbiddenException('Missing permission: accounting.quotation.create');
    }
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('title_required');
    const requestKey = input.idempotencyKey?.trim();
    if (!requestKey || requestKey.length > 200) throw new BadRequestException('invalid_idempotencyKey');
    let amountEstimate: string;
    try {
      amountEstimate = decStr(d(input.amountEstimate ?? '0'));
    } catch {
      throw new BadRequestException('invalid_amountEstimate');
    }
    const expectedCloseDate = input.expectedCloseDate ? new Date(input.expectedCloseDate) : undefined;
    if (expectedCloseDate && Number.isNaN(expectedCloseDate.getTime())) {
      throw new BadRequestException('invalid_expectedCloseDate');
    }
    const conversation = await this.resolveConversation(ctx, conversationId);
    const customer = await this.crmRepo.findCustomerById(ctx.companyId, conversation.customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.status === 'ARCHIVED' || customer.status === 'MERGED') {
      throw new UnprocessableEntityException('Customer is not active');
    }
    assertCanManageOwned(ctx, customer.ownerUserId);

    const opportunityId = `convq_${createHash('sha256')
      .update(`${ctx.companyId}:${conversation.id}:${requestKey}`)
      .digest('hex')
      .slice(0, 32)}`;
    let bundle;
    try {
      bundle = await this.crmRepo.createConversationQuotationDraftBundle({
        companyId: ctx.companyId,
        opportunityId,
        customerId: conversation.customerId,
        title,
        amountEstimate,
        expectedCloseDate,
        scope: {
          actorUserId: ctx.userId,
          canManageAll: crmCanManageAll(ctx.roles),
          ...(ctx.scopes.branchIds ? { branchIds: ctx.scopes.branchIds } : {}),
        },
        userId: ctx.userId,
        requestId: ctx.requestId,
        requestKey,
      }, (db) => this.launchGate.assertLaunchRouteOpenInTransaction(db, 'sales_documents', 'DEFAULT'));
    } catch (error) {
      if (isSalesDocumentLaunchClosedError(error)) {
        await rethrowSalesDocumentRootError(error, this.audit, ctx, 'crm.inbox.quotation.create');
      }
      const code = error instanceof Error ? error.message : String(error);
      if (code === 'customer_not_active') throw new UnprocessableEntityException('Customer is not active');
      if (code === 'customer_out_of_scope') throw new ForbiddenException('Record is out of scope');
      if (code === 'owner_not_active_company_member') throw new BadRequestException(code);
      if (code === 'quotation_command_conflict') throw new ConflictException({ code });
      if (['quotation_command_incomplete', 'customer_counterparty_changed'].includes(code)) {
        throw new UnprocessableEntityException({ code });
      }
      throw error;
    }

    const opportunity = toOpportunitySummary(bundle.opportunity);
    const quotation = toQuotationLinkSummary(bundle.quotation);
    if (!bundle.replayed) {
      void this.outbox.append('crm.opportunity.created', 'crm_opportunity', bundle.opportunity.id, {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        requestId: ctx.requestId,
        aggregateType: 'crm_opportunity',
        aggregateId: bundle.opportunity.id,
        occurredAt: new Date().toISOString(),
        data: { customerId: bundle.opportunity.customerId, source: 'CRM_INBOX' },
      });
      void this.outbox.append('crm.opportunity.quotation_linked', 'crm_opportunity', bundle.opportunity.id, {
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        requestId: ctx.requestId,
        aggregateType: 'crm_opportunity',
        aggregateId: bundle.opportunity.id,
        occurredAt: new Date().toISOString(),
        data: { accountingDocumentId: bundle.quotation.accountingDocumentId, source: 'CRM_INBOX' },
      });
      await this.noteInThread(ctx, conversation, `📄 สร้างใบเสนอราคา (ร่าง) จากแชท: ${opportunity.title}`);
    }
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
