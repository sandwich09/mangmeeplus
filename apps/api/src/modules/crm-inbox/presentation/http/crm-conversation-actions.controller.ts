import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { DashboardPeriodKind, RequestContext } from '@watchdog-bms/contracts';

const DAILY_BRIEF_PERIODS: DashboardPeriodKind[] = ['today', 'week', 'month', 'quarter', 'last_month'];
import {
  CreateFromConversationUseCase,
  type CreateDealFromConversationInput,
  type CreateTaskFromConversationInput,
  type CreateQuotationFromConversationInput,
} from '../../application/use-cases/create-from-conversation.use-case';
import { CrmPaymentProofUseCase } from '../../application/use-cases/crm-payment-proof.use-case';
import { CrmDailyBriefUseCase } from '../../application/use-cases/crm-daily-brief.use-case';

/**
 * A3 revenue-loop actions on a conversation: create a deal / follow-up task / quotation
 * draft prefilled from the customer. Each endpoint fails fast on the item-15 create
 * permission; the delegated use-case re-checks it and audits.
 */
@ApiTags('crm-inbox')
@Controller('companies/:companyId/crm/conversations/:conversationId')
export class CrmConversationActionsController {
  constructor(
    private readonly createFrom: CreateFromConversationUseCase,
    private readonly paymentProof: CrmPaymentProofUseCase,
  ) {}

  @Post('create-deal')
  @RequirePermissions('crm.opportunity.create')
  @ApiOperation({ summary: 'Create a deal (opportunity) from a conversation' })
  createDeal(@ReqCtx() ctx: RequestContext, @Param('conversationId') conversationId: string, @Body() body: CreateDealFromConversationInput) {
    return this.createFrom.createDeal(ctx, conversationId, body);
  }

  @Post('create-task')
  @RequirePermissions('crm.follow_up.create')
  @ApiOperation({ summary: 'Create a follow-up task from a conversation' })
  createTask(@ReqCtx() ctx: RequestContext, @Param('conversationId') conversationId: string, @Body() body: CreateTaskFromConversationInput) {
    return this.createFrom.createTask(ctx, conversationId, body);
  }

  @Post('create-quotation')
  @RequirePermissions('crm.opportunity.create', 'crm.quotation.link')
  @ApiOperation({ summary: 'Create a deal + quotation draft from a conversation' })
  createQuotation(@ReqCtx() ctx: RequestContext, @Param('conversationId') conversationId: string, @Body() body: CreateQuotationFromConversationInput) {
    return this.createFrom.createQuotation(ctx, conversationId, body);
  }

  @Post('messages/:messageId/flag-payment-proof')
  @RequirePermissions('crm.inbox.reply')
  @ApiOperation({ summary: 'Flag an inbound image/file as a payment proof (finance queue capture)' })
  flagPaymentProof(@ReqCtx() ctx: RequestContext, @Param('conversationId') conversationId: string, @Param('messageId') messageId: string) {
    return this.paymentProof.flag(ctx, conversationId, messageId);
  }
}

/** Company-level finance queue of flagged payment proofs (separate base path). */
@ApiTags('crm-inbox')
@Controller('companies/:companyId/crm/payment-proofs')
export class CrmPaymentProofQueueController {
  constructor(private readonly paymentProof: CrmPaymentProofUseCase) {}

  @Get()
  @RequirePermissions('accounting.document.read')
  @ApiOperation({ summary: 'List flagged payment proofs awaiting finance verification' })
  list(@ReqCtx() ctx: RequestContext) {
    return this.paymentProof.list(ctx);
  }

  @Get(':conversationId/messages/:messageId/content')
  @RequirePermissions('accounting.document.read')
  @ApiOperation({ summary: 'Stream a purpose-linked payment proof for finance review' })
  async content(
    @ReqCtx() ctx: RequestContext,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { data, mimeType, fileName } = await this.paymentProof.content(ctx, conversationId, messageId);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const disposition = mimeType.startsWith('image/') ? 'inline' : 'attachment';
    return new StreamableFile(data, {
      type: mimeType,
      disposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }
}

/** A8 owner/manager daily brief (inbox-operations widgets + deep links). */
@ApiTags('crm-inbox')
@Controller('companies/:companyId/crm/daily-brief')
export class CrmDailyBriefController {
  constructor(private readonly dailyBrief: CrmDailyBriefUseCase) {}

  @Get()
  @RequirePermissions('crm.inbox.read')
  @ApiOperation({ summary: 'CRM daily brief widgets with deep links (unanswered/SLA/new customers/appointments/payment proofs)' })
  @ApiQuery({ name: 'period', required: false, enum: DAILY_BRIEF_PERIODS, description: 'Date-scope for dated widgets (default today)' })
  get(@ReqCtx() ctx: RequestContext, @Query('period') period?: string) {
    const periodKind = DAILY_BRIEF_PERIODS.includes(period as DashboardPeriodKind) ? (period as DashboardPeriodKind) : 'today';
    return this.dailyBrief.execute(ctx, { periodKind });
  }
}
