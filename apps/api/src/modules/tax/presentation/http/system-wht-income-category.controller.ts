import { Body, Controller, Get, Header, Param, Patch } from '@nestjs/common';
import { IsIn } from 'class-validator';
import type { RequestContext } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import { assertPlatformTenant } from '../../../sales-console/application/sales-context';
import { SetWhtIncomeCategoryStatusUseCase } from '../../application/use-cases/wht-income-category.use-case';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';

export class SetSystemWhtIncomeCategoryStatusDto {
  @IsIn(['ACTIVE', 'DRAFT']) status!: 'ACTIVE' | 'DRAFT';
}

@Controller('system/wht-income-categories')
export class SystemWhtIncomeCategoryController {
  constructor(private readonly taxRepo: PrismaTaxRepository, private readonly setStatusUseCase: SetWhtIncomeCategoryStatusUseCase) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.wht_income_category.manage')
  async list(@ReqCtx() ctx: RequestContext) {
    assertPlatformTenant(ctx);
    const rows = await this.taxRepo.prisma.client.whtIncomeCategory.findMany({
      select: { code: true, nameTh: true, formType: true, defaultRate: true, status: true },
      orderBy: { code: 'asc' },
    });
    return rows.map(row => ({ ...row, defaultRate: String(row.defaultRate) }));
  }

  @Patch(':code')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.wht_income_category.manage')
  setStatus(@ReqCtx() ctx: RequestContext, @Param('code') code: string, @Body() body: SetSystemWhtIncomeCategoryStatusDto) {
    return this.setStatusUseCase.execute(ctx, code, body.status);
  }
}
