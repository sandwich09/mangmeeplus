import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import {
  CrmAiFeedbackUseCase,
  CrmCustomerProfileExtractUseCase,
  CrmAiInsightsUseCase,
  CrmAiReplyDraftUseCase,
  CrmAiSummaryUseCase,
  CrmAiTrustReadUseCase,
} from '../../application/use-cases/crm-ai-assist.use-case';

@ApiTags('crm-inbox')
@Controller('companies/:companyId/crm/conversations')
export class CrmAiAssistController {
  constructor(
    private readonly summary: CrmAiSummaryUseCase,
    private readonly replyDraft: CrmAiReplyDraftUseCase,
    private readonly insights: CrmAiInsightsUseCase,
    private readonly feedback: CrmAiFeedbackUseCase,
    private readonly trustRead: CrmAiTrustReadUseCase,
  ) {}

  @Get(':conversationId/ai/trust')
  @RequirePermissions('crm.ai.assist')
  @ApiOperation({ summary: 'Read stored CRM customer AI trust tier for staff assist' })
  trust(@ReqCtx() ctx: RequestContext, @Param('conversationId') conversationId: string) {
    return this.trustRead.execute(ctx, conversationId);
  }

  @Post(':conversationId/ai/summary')
  @HttpCode(200)
  @RequirePermissions('crm.ai.assist')
  @ApiOperation({ summary: 'Generate a CRM conversation AI summary for staff assist' })
  summarize(@ReqCtx() ctx: RequestContext, @Param('conversationId') conversationId: string) {
    return this.summary.execute(ctx, conversationId);
  }

  @Post(':conversationId/ai/reply-draft')
  @HttpCode(200)
  @RequirePermissions('crm.ai.assist')
  @ApiOperation({ summary: 'Generate a CRM AI reply draft for staff assist without sending' })
  draft(@ReqCtx() ctx: RequestContext, @Param('conversationId') conversationId: string, @Body() body: { tone?: string }) {
    return this.replyDraft.execute(ctx, conversationId, { tone: body?.tone });
  }

  @Post(':conversationId/ai/insights')
  @HttpCode(200)
  @RequirePermissions('crm.ai.assist')
  @ApiOperation({ summary: 'Generate CRM AI conversation insights for staff assist' })
  analyze(@ReqCtx() ctx: RequestContext, @Param('conversationId') conversationId: string) {
    return this.insights.execute(ctx, conversationId);
  }

  @Post(':conversationId/ai/feedback')
  @HttpCode(200)
  @RequirePermissions('crm.ai.assist')
  @ApiOperation({ summary: 'Record CRM AI staff assist feedback' })
  recordFeedback(@ReqCtx() ctx: RequestContext, @Param('conversationId') conversationId: string, @Body() body: unknown) {
    return this.feedback.execute(ctx, conversationId, body as { kind?: string; rating?: string; comment?: string; requestId?: string });
  }
}

@ApiTags('crm')
@Controller('companies/:companyId/crm/customers')
export class CrmCustomerProfileAssistController {
  constructor(private readonly profileExtract: CrmCustomerProfileExtractUseCase) {}

  @Post('ai-profile-extract')
  @HttpCode(200)
  @RequirePermissions('crm.customer.create', 'crm.ai.assist')
  @ApiOperation({ summary: 'Extract an editable customer-form preview; never persists data' })
  extract(@ReqCtx() ctx: RequestContext, @Body() body: unknown) {
    return this.profileExtract.execute(ctx, body as { text?: unknown; locale?: unknown });
  }
}
