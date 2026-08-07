import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { CreateGoodsReceiptUseCase, GetGoodsReceiptUseCase, ListGoodsReceiptsUseCase, PostGoodsReceiptUseCase, VoidGoodsReceiptUseCase } from '../../application/use-cases/goods-receipt.use-case';
import { CreateGoodsReceiptDto, RequiredReasonDto } from './procurement.dtos';

@Controller('companies/:companyId/procurement/goods-receipts')
export class GoodsReceiptController {
  constructor(
    private readonly createGR: CreateGoodsReceiptUseCase,
    private readonly getGR: GetGoodsReceiptUseCase,
    private readonly listGRs: ListGoodsReceiptsUseCase,
    private readonly postGR: PostGoodsReceiptUseCase,
    private readonly voidGR: VoidGoodsReceiptUseCase,
  ) {}

  @Get()
  @RequirePermissions('procurement.goods_receipt.read')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.listGRs.execute(ctx, { status: q['status'], purchaseOrderId: q['purchaseOrderId'], supplierId: q['supplierId'], branchId: q['branchId'], page: q['page'] ? Number(q['page']) : undefined, pageSize: q['pageSize'] ? Number(q['pageSize']) : undefined });
  }

  @Post()
  @RequirePermissions('procurement.goods_receipt.create')
  async create(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateGoodsReceiptDto) {
    assertRouteCompany(ctx, companyId);
    return this.createGR.execute(ctx, body);
  }

  @Get(':id')
  @RequirePermissions('procurement.goods_receipt.read')
  async get(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.getGR.execute(ctx, id);
  }

  @Post(':id/post')
  @RequirePermissions('procurement.goods_receipt.post')
  async post(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.postGR.execute(ctx, id);
  }

  @Post(':id/void')
  @RequirePermissions('procurement.goods_receipt.void')
  async void(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: RequiredReasonDto) {
    assertRouteCompany(ctx, companyId);
    return this.voidGR.execute(ctx, id, body.reason);
  }
}
