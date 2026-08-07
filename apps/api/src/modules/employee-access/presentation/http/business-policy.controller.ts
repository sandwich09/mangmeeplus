import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ConsentUnsubscribePolicy, DataRetentionPolicy, DiscountPolicy, PoApprovalPolicy, RequestContext } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import { BusinessPolicyUseCase } from '../../application/use-cases/business-policy.use-case';

@ApiTags('settings-business-policy')
@Controller('companies/:companyId/settings')
export class BusinessPolicyController {
  constructor(private readonly policies: BusinessPolicyUseCase) {}

  @Get('discount-policy')
  @RequirePermissions('crm.customer.read')
  @ApiOperation({ summary: 'Get company discount policy' })
  getDiscount(@ReqCtx() ctx: RequestContext) { return this.policies.getDiscount(ctx.companyId); }

  @Put('discount-policy')
  @RequirePermissions('crm.customer.update')
  @ApiOperation({ summary: 'Replace company discount policy' })
  saveDiscount(@ReqCtx() ctx: RequestContext, @Body() body: DiscountPolicy) {
    return this.policies.saveDiscount(ctx.companyId, body);
  }

  @Get('po-approval')
  @RequirePermissions('procurement.purchase_order.read')
  @ApiOperation({ summary: 'Get company PO approval policy' })
  getPoApproval(@ReqCtx() ctx: RequestContext) { return this.policies.getPoApproval(ctx.companyId); }

  @Put('po-approval')
  @RequirePermissions('procurement.purchase_order.manage')
  @ApiOperation({ summary: 'Replace company PO approval policy' })
  savePoApproval(@ReqCtx() ctx: RequestContext, @Body() body: PoApprovalPolicy) {
    return this.policies.savePoApproval(ctx.companyId, body);
  }

  @Get('retention-policy')
  @RequirePermissions('crm.channel.read')
  getRetention(@ReqCtx() ctx: RequestContext) { return this.policies.getRetention(ctx.companyId); }

  @Put('retention-policy')
  @RequirePermissions('crm.channel.manage')
  saveRetention(@ReqCtx() ctx: RequestContext, @Body() body: DataRetentionPolicy) { return this.policies.saveRetention(ctx.companyId, body); }

  @Get('consent-policy')
  @RequirePermissions('crm.channel.read')
  getConsent(@ReqCtx() ctx: RequestContext) { return this.policies.getConsent(ctx.companyId); }

  @Put('consent-policy')
  @RequirePermissions('crm.channel.manage')
  saveConsent(@ReqCtx() ctx: RequestContext, @Body() body: ConsentUnsubscribePolicy) { return this.policies.saveConsent(ctx.companyId, body); }
}
