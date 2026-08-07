import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import {
  ListLocationsUseCase,
  GetLocationUseCase,
  CreateLocationUseCase,
  UpdateLocationUseCase,
  ArchiveLocationUseCase,
} from '../../application/use-cases/location.use-cases';
import { GenerateQrLabelUseCase } from '../../application/use-cases/qr-label.use-cases';
import { GetStockBalanceUseCase } from '../../application/use-cases/movement-query.use-cases';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { CreateLocationDto, GenerateEntityQrDto, UpdateLocationDto } from './inventory.dtos';

@Controller('companies/:companyId/inventory/locations')
export class InventoryLocationController {
  constructor(
    private readonly listLocations: ListLocationsUseCase,
    private readonly getLocation: GetLocationUseCase,
    private readonly createLocation: CreateLocationUseCase,
    private readonly updateLocation: UpdateLocationUseCase,
    private readonly archiveLocation: ArchiveLocationUseCase,
    private readonly generateLabel: GenerateQrLabelUseCase,
    private readonly getBalance: GetStockBalanceUseCase,
  ) {}

  @Get()
  @RequirePermissions('inventory.location.read')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.listLocations.execute(ctx, {
      status: q['status'],
      type: q['type'],
      search: q['search'],
      branchId: q['branchId'],
      page: q['page'] ? Number(q['page']) : undefined,
      pageSize: q['pageSize'] ? Number(q['pageSize']) : undefined,
    });
  }

  @Post()
  @RequirePermissions('inventory.location.manage')
  async create(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateLocationDto) {
    assertRouteCompany(ctx, companyId);
    return this.createLocation.execute(ctx, body);
  }

  @Get(':locationId/balances')
  @RequirePermissions('inventory.report.read')
  async balances(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('locationId') locationId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.getBalance.execute(ctx, { productId: q['productId'], locationId });
  }

  @Post(':locationId/internal-qr')
  @RequirePermissions('inventory.label.manage')
  async locationQr(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('locationId') locationId: string, @Body() body: GenerateEntityQrDto) {
    assertRouteCompany(ctx, companyId);
    return this.generateLabel.execute(ctx, { entityType: 'LOCATION', entityId: locationId, labelText: body.labelText });
  }

  @Post(':locationId/archive')
  @RequirePermissions('inventory.location.manage')
  async archive(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('locationId') locationId: string) {
    assertRouteCompany(ctx, companyId);
    return this.archiveLocation.execute(ctx, locationId);
  }

  @Get(':locationId')
  @RequirePermissions('inventory.location.read')
  async getOne(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('locationId') locationId: string) {
    assertRouteCompany(ctx, companyId);
    return this.getLocation.execute(ctx, locationId);
  }

  @Patch(':locationId')
  @RequirePermissions('inventory.location.manage')
  async update(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('locationId') locationId: string, @Body() body: UpdateLocationDto) {
    assertRouteCompany(ctx, companyId);
    return this.updateLocation.execute(ctx, locationId, body);
  }

}
