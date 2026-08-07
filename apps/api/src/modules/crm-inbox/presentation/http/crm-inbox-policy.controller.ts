import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext, UpdateCrmInboxPolicyInput } from '@watchdog-bms/contracts';
import { GetCrmInboxPolicyUseCase, UpdateCrmInboxPolicyUseCase } from '../../application/use-cases/crm-inbox-policy.use-case';

@ApiTags('crm-inbox')
@Controller('companies/:companyId/crm/inbox-policy')
export class CrmInboxPolicyController {
  constructor(
    private readonly getPolicy: GetCrmInboxPolicyUseCase,
    private readonly updatePolicy: UpdateCrmInboxPolicyUseCase,
  ) {}

  @Get()
  @RequirePermissions('crm.inbox.policy_manage')
  @ApiOperation({ summary: 'Get the inbox first-response SLA policy' })
  async get(@ReqCtx() ctx: RequestContext) {
    return this.getPolicy.execute(ctx);
  }

  @Put()
  @RequirePermissions('crm.inbox.policy_manage')
  @ApiOperation({ summary: 'Update the inbox first-response SLA policy' })
  async update(@ReqCtx() ctx: RequestContext, @Body() body: UpdateCrmInboxPolicyInput) {
    return this.updatePolicy.execute(ctx, body);
  }
}
