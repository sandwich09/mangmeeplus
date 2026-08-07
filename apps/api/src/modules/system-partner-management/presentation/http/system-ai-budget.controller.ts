import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsInt } from 'class-validator';
import type { Request } from 'express';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { GetPlatformAiBudgetUseCase } from '../../application/use-cases/get-platform-ai-budget.use-case';
import { SetPlatformAiBudgetUseCase } from '../../application/use-cases/set-platform-ai-budget.use-case';

/** Money crosses the wire in satang integers like every other money field; the web converts. */
class SetPlatformAiBudgetBodyDto {
  @IsInt() monthlyBudgetSatang!: number;
  @IsInt() ceilingSatang!: number;
}

type AuthedRequest = Request & { context: RequestContext };

/** Platform-wide AI budget settings (metering spec §7.9) — the shared-LINE-settings surface,
 *  under the same permission as the per-company budget it sets the default and ceiling for. */
@Controller('system/ai-budget')
export class SystemAiBudgetController {
  constructor(
    private readonly getBudget: GetPlatformAiBudgetUseCase,
    private readonly setBudget: SetPlatformAiBudgetUseCase,
  ) {}

  @Get()
  @RequirePermissions('system.partner_ai_model.manage')
  @ApiOperation({ summary: 'Get platform AI monthly budget default and ceiling (with their source)' })
  @ApiResponse({ status: 200 })
  get() {
    return this.getBudget.execute();
  }

  @Put()
  @RequirePermissions('system.partner_ai_model.manage')
  @ApiOperation({ summary: 'Set platform AI monthly budget default and ceiling (platform-level)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 422, description: 'Either value below 1 satang, or ceiling below the default' })
  set(@Body() dto: SetPlatformAiBudgetBodyDto, @Req() req: AuthedRequest) {
    return this.setBudget.execute({
      monthlyBudgetSatang: dto.monthlyBudgetSatang,
      ceilingSatang: dto.ceilingSatang,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }
}
