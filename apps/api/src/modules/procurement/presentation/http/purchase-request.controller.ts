import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { CreatePurchaseRequestUseCase, GetPurchaseRequestUseCase, ListPurchaseRequestsUseCase, SubmitPurchaseRequestUseCase, ApprovePurchaseRequestUseCase, RejectPurchaseRequestUseCase, CancelPurchaseRequestUseCase } from '../../application/use-cases/purchase-request.use-case';
import { ApprovalNoteDto, CreatePurchaseRequestDto, ReasonDto, RequiredNoteDto } from './procurement.dtos';

@Controller('companies/:companyId/procurement/purchase-requests')
export class PurchaseRequestController {
  constructor(
    private readonly createPR: CreatePurchaseRequestUseCase,
    private readonly getPR: GetPurchaseRequestUseCase,
    private readonly listPRs: ListPurchaseRequestsUseCase,
    private readonly submitPR: SubmitPurchaseRequestUseCase,
    private readonly approvePR: ApprovePurchaseRequestUseCase,
    private readonly rejectPR: RejectPurchaseRequestUseCase,
    private readonly cancelPR: CancelPurchaseRequestUseCase,
  ) {}

  @Get()
  @RequireAnyPermission('procurement.purchase_request.read', 'procurement.purchase_request.read_related')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.listPRs.execute(ctx, { status: q['status'], requesterUserId: q['requesterUserId'], supplierId: q['supplierId'], branchId: q['branchId'], fromDate: q['fromDate'], toDate: q['toDate'], page: q['page'] ? Number(q['page']) : undefined, pageSize: q['pageSize'] ? Number(q['pageSize']) : undefined });
  }

  @Post()
  @RequirePermissions('procurement.purchase_request.create')
  async create(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreatePurchaseRequestDto) {
    assertRouteCompany(ctx, companyId);
    return this.createPR.execute(ctx, body);
  }

  @Get(':id')
  @RequireAnyPermission('procurement.purchase_request.read', 'procurement.purchase_request.read_related')
  async get(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.getPR.execute(ctx, id);
  }

  @Post(':id/submit')
  @RequirePermissions('procurement.purchase_request.create')
  async submit(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.submitPR.execute(ctx, id);
  }

  @Post(':id/approve')
  @RequirePermissions('procurement.purchase_request.approve')
  async approve(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: ApprovalNoteDto) {
    assertRouteCompany(ctx, companyId);
    return this.approvePR.execute(ctx, id, body.note);
  }

  @Post(':id/reject')
  @RequirePermissions('procurement.purchase_request.approve')
  async reject(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: RequiredNoteDto) {
    assertRouteCompany(ctx, companyId);
    return this.rejectPR.execute(ctx, id, body.note);
  }

  @Post(':id/cancel')
  @RequirePermissions('procurement.purchase_request.create')
  async cancel(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: ReasonDto) {
    assertRouteCompany(ctx, companyId);
    return this.cancelPR.execute(ctx, id, body.reason);
  }
}
