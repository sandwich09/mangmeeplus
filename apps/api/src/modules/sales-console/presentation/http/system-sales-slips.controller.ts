/**
 * Q9 — the Owner's slip queue (`/system`). SYSTEM_ADMIN only.
 *
 * `verify` is a reviewed operation: `SalesSlipService` requires a password proof (the same
 * five-minute `POST /v1/system/billing/reauthenticate` window billing uses) AND the dual
 * SYSTEM_ADMIN + `system.partner_company.update` actor check, inside the applying transaction.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import type { SalesDealSlipListDto } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { SalesSlipService } from '../../application/sales-slip.service';
import { assertPlatformTenant } from '../../application/sales-context';

export class SalesSlipDecisionDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

@Controller('system/sales-deals')
export class SystemSalesSlipsController {
  constructor(private readonly slips: SalesSlipService) {}

  @Get('slips')
  @RequirePermissions('sales.agent_profile.manage')
  @ApiOperation({ summary: 'Deals whose customer says they transferred, oldest first' })
  pending(@Req() req: Request & { context: RequestContext }): Promise<SalesDealSlipListDto> {
    assertPlatformTenant(req.context);
    return this.slips.pending();
  }

  @Get(':dealId/slip-url')
  @RequirePermissions('sales.agent_profile.manage')
  @ApiOperation({ summary: 'Inline preview URL for one slip; every read audited MEDIUM' })
  slipUrl(
    @Param('dealId') dealId: string,
    @Req() req: Request & { context: RequestContext },
  ) {
    assertPlatformTenant(req.context);
    return this.slips.adminSlipUrl(req.context, dealId);
  }

  @Post(':dealId/verify')
  @HttpCode(200)
  @RequirePermissions('sales.agent_profile.manage')
  @ApiOperation({ summary: 'Confirm the transfer and apply the deal (password proof required)' })
  @ApiResponse({ status: 409, description: 'CONTROL_REAUTH_REQUIRED / SALES_SLIP_STATE_CONFLICT' })
  verify(
    @Param('dealId') dealId: string,
    @Body() dto: SalesSlipDecisionDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesDealSlipListDto> {
    assertPlatformTenant(req.context);
    return this.slips.verify(req.context, dealId, dto.reason);
  }

  @Post(':dealId/reject')
  @HttpCode(200)
  @RequirePermissions('sales.agent_profile.manage')
  @ApiOperation({ summary: 'Turn the slip down; the offer window is extended by the review time' })
  reject(
    @Param('dealId') dealId: string,
    @Body() dto: SalesSlipDecisionDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesDealSlipListDto> {
    assertPlatformTenant(req.context);
    return this.slips.reject(req.context, dealId, dto.reason);
  }
}
