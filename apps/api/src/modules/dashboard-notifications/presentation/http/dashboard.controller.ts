import { Controller, Get, Post, Query, Param, Body } from '@nestjs/common';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { GenerateSnapshotUseCase } from '../../application/use-cases/generate-snapshot.use-case';
import { ExpenseMonthsQueryDto, GenerateDashboardSnapshotDto } from './dashboard-notifications.dtos';

@Controller('companies/:companyId/dashboard')
export class DashboardController {
  constructor(private readonly generateSnapshot: GenerateSnapshotUseCase) {}

  @Get()
  @RequirePermissions('dashboard.read')
  async getDashboard(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query('periodKind') periodKind?: string,
    @Query('branchId') branchId?: string,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.generateSnapshot.execute(ctx, companyId, { periodKind: periodKind as any, branchId });
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
    @Query('periodKind') periodKind?: string,
    @Query('branchId') branchId?: string,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.generateSnapshot.execute(ctx, companyId, { periodKind: periodKind as any, branchId });
  }

  @Post('snapshots/generate')
  @RequirePermissions('dashboard.snapshot.generate')
  async generateSnapshotManual(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Body() body: GenerateDashboardSnapshotDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.generateSnapshot.execute(ctx, companyId, { periodKind: body.periodKind, branchId: body.branchId, forceGenerate: true });
  }
}
