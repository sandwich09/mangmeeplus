import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { CreateCrmCampaignInput, GenerateCrmBroadcastInput, RequestContext, SendCrmCampaignInput } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import { CrmCampaignUseCase } from '../../application/use-cases/crm-campaign.use-case';
import { CrmAiBroadcastUseCase } from '../../application/use-cases/crm-ai-broadcast.use-case';

@Controller('companies/:companyId/crm/campaigns')
export class CrmCampaignController {
  constructor(private readonly campaigns: CrmCampaignUseCase, private readonly broadcastAi: CrmAiBroadcastUseCase) {}
  @Get() @RequirePermissions('crm.campaign.read') list(@ReqCtx() ctx: RequestContext) { return this.campaigns.list(ctx); }
  @Post('drafts') @RequirePermissions('crm.campaign.manage') create(@ReqCtx() ctx: RequestContext, @Body() body: CreateCrmCampaignInput) { return this.campaigns.create(ctx, body); }
  @Post(':id/preview') @RequirePermissions('crm.campaign.manage') preview(@ReqCtx() ctx: RequestContext, @Param('id') id: string) { return this.campaigns.preview(ctx, id); }
  @Post(':id/send') @RequirePermissions('crm.campaign.send') send(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: SendCrmCampaignInput) { return this.campaigns.send(ctx, id, body); }
  @Post('generate') @RequirePermissions('crm.campaign.manage', 'crm.ai.assist') generate(@ReqCtx() ctx: RequestContext, @Body() body: GenerateCrmBroadcastInput) { return this.broadcastAi.execute(ctx, body); }
}
