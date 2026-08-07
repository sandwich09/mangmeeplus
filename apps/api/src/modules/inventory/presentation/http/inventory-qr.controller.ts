import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { GenerateQrLabelUseCase, ResolveQrScanUseCase, MarkQrLabelPrintedUseCase, ListQrLabelsUseCase } from '../../application/use-cases/qr-label.use-cases';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { GenerateQrLabelDto } from './inventory.dtos';

@Controller('companies/:companyId/inventory/labels')
export class InventoryQrController {
  constructor(
    private readonly generateLabel: GenerateQrLabelUseCase,
    private readonly resolveQr: ResolveQrScanUseCase,
    private readonly markPrinted: MarkQrLabelPrintedUseCase,
    private readonly listLabels: ListQrLabelsUseCase,
  ) {}

  @Get()
  @RequirePermissions('inventory.label.manage')
  async list(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query('entityType') entityType: 'PRODUCT' | 'LOCATION',
    @Query('entityId') entityId: string,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.listLabels.execute(ctx, entityType, entityId);
  }

  @Post('generate')
  @RequirePermissions('inventory.label.manage')
  async generate(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: GenerateQrLabelDto) {
    assertRouteCompany(ctx, companyId);
    return this.generateLabel.execute(ctx, body);
  }

  @Get('resolve')
  @RequirePermissions('inventory.product.read')
  async resolve(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query('payload') payload: string) {
    assertRouteCompany(ctx, companyId);
    return this.resolveQr.execute(ctx, payload);
  }

  @Post('scan')
  @RequirePermissions('inventory.product.read')
  async scan(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body('payload') payload: string) {
    assertRouteCompany(ctx, companyId);
    return this.resolveQr.execute(ctx, payload);
  }

  @Post(':labelId/printed')
  @RequirePermissions('inventory.label.manage')
  async markAsPrinted(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('labelId') labelId: string) {
    assertRouteCompany(ctx, companyId);
    return this.markPrinted.execute(ctx, labelId);
  }
}
