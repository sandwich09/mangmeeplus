import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { CreateMovementUseCase } from '../../application/use-cases/create-movement.use-case';
import { TransferStockUseCase } from '../../application/use-cases/transfer-stock.use-case';
import { StockCountUseCase } from '../../application/use-cases/stock-count.use-case';
import { ListMovementsUseCase, GetStockBalanceUseCase, GetStockReportUseCase } from '../../application/use-cases/movement-query.use-cases';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { CreateMovementDto, StockCountDto, TransferStockDto } from './inventory.dtos';

@Controller('companies/:companyId/inventory')
export class InventoryMovementController {
  constructor(
    private readonly createMovement: CreateMovementUseCase,
    private readonly transferStock: TransferStockUseCase,
    private readonly stockCount: StockCountUseCase,
    private readonly listMovements: ListMovementsUseCase,
    private readonly getBalance: GetStockBalanceUseCase,
    private readonly getStockReport: GetStockReportUseCase,
  ) {}

  @Get('movements')
  @RequirePermissions('inventory.movement.read')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.listMovements.execute(ctx, {
      productId: q['productId'],
      locationId: q['locationId'],
      movementType: q['movementType'],
      actorUserId: q['actorUserId'],
      fromDate: q['fromDate'],
      toDate: q['toDate'],
      page: q['page'] ? Number(q['page']) : undefined,
      pageSize: q['pageSize'] ? Number(q['pageSize']) : undefined,
    });
  }

  @Post('movements/receive')
  @RequirePermissions('inventory.movement.create')
  async receive(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateMovementDto) {
    assertRouteCompany(ctx, companyId);
    return this.createMovement.execute(ctx, { ...body, movementType: 'STOCK_IN' });
  }

  @Post('movements/issue')
  @RequirePermissions('inventory.movement.create')
  async issue(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateMovementDto) {
    assertRouteCompany(ctx, companyId);
    return this.createMovement.execute(ctx, { ...body, movementType: 'STOCK_OUT' });
  }

  @Post('movements/transfer')
  @RequirePermissions('inventory.movement.create')
  async transfer(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: TransferStockDto) {
    assertRouteCompany(ctx, companyId);
    return this.transferStock.execute(ctx, body);
  }

  @Post('movements/count')
  @RequirePermissions('inventory.stock_count.create')
  async count(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: StockCountDto) {
    assertRouteCompany(ctx, companyId);
    return this.stockCount.execute(ctx, body);
  }

  @Post('movements/adjust')
  @RequirePermissions('inventory.movement.adjust')
  async adjust(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateMovementDto) {
    assertRouteCompany(ctx, companyId);
    const movementType = body.movementType === 'ADJUSTMENT_OUT' || body.direction === 'OUT' ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN';
    return this.createMovement.execute(ctx, { ...body, movementType });
  }

  @Get('balances')
  @RequirePermissions('inventory.report.read')
  async balance(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.getBalance.execute(ctx, { productId: q['productId'], locationId: q['locationId'] });
  }

  @Get('reports/stock')
  @RequirePermissions('inventory.report.read')
  async stockReport(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.getStockReport.execute(ctx, {
      productId: q['productId'],
      locationId: q['locationId'],
      lowStockOnly: q['lowStockOnly'] === 'true',
    });
  }
}
