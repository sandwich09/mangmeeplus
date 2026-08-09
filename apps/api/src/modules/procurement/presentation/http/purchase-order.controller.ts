import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { CreatePurchaseOrderUseCase, GetPurchaseOrderUseCase, ListPurchaseOrdersUseCase, ApprovePurchaseOrderUseCase, IssuePurchaseOrderUseCase, RejectPurchaseOrderUseCase, CancelPurchaseOrderUseCase, ClosePurchaseOrderUseCase } from '../../application/use-cases/purchase-order.use-case';
import { ApprovalNoteDto, CreatePurchaseOrderDto, ReasonDto, RequiredNoteDto } from './procurement.dtos';

@Controller('companies/:companyId/procurement/purchase-orders')
export class PurchaseOrderController {
  constructor(
    private readonly createPO: CreatePurchaseOrderUseCase,
    private readonly getPO: GetPurchaseOrderUseCase,
    private readonly listPOs: ListPurchaseOrdersUseCase,
    private readonly approvePO: ApprovePurchaseOrderUseCase,
    private readonly issuePO: IssuePurchaseOrderUseCase,
    private readonly rejectPO: RejectPurchaseOrderUseCase,
    private readonly cancelPO: CancelPurchaseOrderUseCase,
    private readonly closePO: ClosePurchaseOrderUseCase,
  ) {}

  @Get()
  @RequireAnyPermission('procurement.purchase_order.read', 'procurement.purchase_order.read_related')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.listPOs.execute(ctx, { status: q['status'], supplierId: q['supplierId'], branchId: q['branchId'], fromDate: q['fromDate'], toDate: q['toDate'], page: q['page'] ? Number(q['page']) : undefined, pageSize: q['pageSize'] ? Number(q['pageSize']) : undefined });
  }

  @Post()
  @RequirePermissions('procurement.purchase_order.create')
  async create(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreatePurchaseOrderDto) {
    assertRouteCompany(ctx, companyId);
    return this.createPO.execute(ctx, body);
  }

  @Get(':id')
  @RequireAnyPermission('procurement.purchase_order.read', 'procurement.purchase_order.read_related')
  async get(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.getPO.execute(ctx, id);
  }

  @Post(':id/approve')
  @RequirePermissions('procurement.purchase_order.approve')
  async approve(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: ApprovalNoteDto) {
    assertRouteCompany(ctx, companyId);
    return this.approvePO.execute(ctx, id, body.note);
  }

  @Post(':id/issue')
  @RequirePermissions('procurement.purchase_order.issue')
  async issue(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.issuePO.execute(ctx, id);
  }

  @Post(':id/reject')
  @RequirePermissions('procurement.purchase_order.approve')
  async reject(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: RequiredNoteDto) {
    assertRouteCompany(ctx, companyId);
    return this.rejectPO.execute(ctx, id, body.note);
  }

  @Post(':id/cancel')
  @RequirePermissions('procurement.purchase_order.manage')
  async cancel(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: ReasonDto) {
    assertRouteCompany(ctx, companyId);
    return this.cancelPO.execute(ctx, id, body.reason);
  }

  @Post(':id/close')
  @RequirePermissions('procurement.purchase_order.manage')
  async close(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: ReasonDto) {
    assertRouteCompany(ctx, companyId);
    return this.closePO.execute(ctx, id, body.reason);
  }
}
