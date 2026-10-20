import { BadRequestException, Controller, Get, Post, Query, Param, Body } from '@nestjs/common';
import { civilInstantDayRangeToUtc, todayCivilDate } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { GenerateSnapshotUseCase } from '../../application/use-cases/generate-snapshot.use-case';
import { ExpenseMonthsQueryDto, GenerateDashboardSnapshotDto } from './dashboard-notifications.dtos';

@Controller('companies/:companyId/dashboard')
export class DashboardController {
  constructor(private readonly generateSnapshot: GenerateSnapshotUseCase) {}

  private periodOptions(query: GenerateDashboardSnapshotDto) {
    const { periodKind, branchId, customStart, customEnd } = query;
    if (periodKind !== 'custom') return { periodKind, branchId };
    if (!customStart || !customEnd) throw new BadRequestException('เลือกวันที่ตั้งแต่และถึง');
    if (customEnd > todayCivilDate()) throw new BadRequestException('ถึงต้องไม่เกินวันนี้');
    const bounds = civilInstantDayRangeToUtc(customStart, customEnd);
    return { periodKind, branchId, periodStart: bounds.gte!, periodEnd: new Date(bounds.lt!.getTime() - 1) };
  }

  @Get()
  @RequirePermissions('dashboard.read')
  async getDashboard(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query() query: GenerateDashboardSnapshotDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.generateSnapshot.execute(ctx, companyId, this.periodOptions(query));
  }

  @Get('expense-months')
  @RequirePermissions('dashboard.read')
  async getExpenseMonths(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query() query: ExpenseMonthsQueryDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.generateSnapshot.getExpenseMonths(ctx, companyId, query);
  }

  @Get('snapshots/latest')
  @RequirePermissions('dashboard.read')
  async getLatestSnapshot(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query() query: GenerateDashboardSnapshotDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.generateSnapshot.execute(ctx, companyId, this.periodOptions(query));
  }

  @Post('snapshots/generate')
  @RequirePermissions('dashboard.snapshot.generate')
  async generateSnapshotManual(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Body() body: GenerateDashboardSnapshotDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.generateSnapshot.execute(ctx, companyId, { ...this.periodOptions(body), forceGenerate: true });
  }
}
