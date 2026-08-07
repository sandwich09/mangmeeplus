import { Controller, Get, Post, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext, UpsertWorkflowWebhookEndpointInput } from '@watchdog-bms/contracts';
import { ListWorkflowWebhookEndpointsUseCase, CreateWorkflowWebhookEndpointUseCase, SetWorkflowWebhookEndpointStatusUseCase } from '../../application/use-cases/workflow-webhook.use-case';

@ApiTags('workflow')
@Controller('companies/:companyId/workflow/webhooks')
export class WorkflowWebhookController {
  constructor(
    private readonly list: ListWorkflowWebhookEndpointsUseCase,
    private readonly create: CreateWorkflowWebhookEndpointUseCase,
    private readonly setStatus: SetWorkflowWebhookEndpointStatusUseCase,
  ) {}

  @Get()
  @RequirePermissions('workflow.webhook.manage')
  @ApiOperation({ summary: 'List workflow webhook endpoints (secrets never returned)' })
  listEndpoints(@ReqCtx() ctx: RequestContext) {
    return this.list.execute(ctx);
  }

  @Post()
  @RequirePermissions('workflow.webhook.manage')
  @ApiOperation({ summary: 'Create a webhook endpoint (created disabled by default)' })
  createEndpoint(@ReqCtx() ctx: RequestContext, @Body() body: UpsertWorkflowWebhookEndpointInput) {
    return this.create.execute(ctx, body);
  }

  @Post(':endpointId/enable')
  @RequirePermissions('workflow.webhook.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enable a webhook endpoint' })
  enable(@ReqCtx() ctx: RequestContext, @Param('endpointId') endpointId: string) {
    return this.setStatus.execute(ctx, endpointId, true);
  }

  @Post(':endpointId/disable')
  @RequirePermissions('workflow.webhook.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disable a webhook endpoint' })
  disable(@ReqCtx() ctx: RequestContext, @Param('endpointId') endpointId: string) {
    return this.setStatus.execute(ctx, endpointId, false);
  }
}
