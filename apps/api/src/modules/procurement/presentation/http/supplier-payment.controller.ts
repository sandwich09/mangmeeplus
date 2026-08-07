import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { CreateSupplierPaymentUseCase, GetSupplierPaymentPp36PostingSourceUseCase, GetSupplierPaymentPostingSourceUseCase, GetSupplierPaymentUseCase, ListSupplierPaymentsUseCase, VoidSupplierPaymentUseCase } from '../../application/use-cases/supplier-payment.use-case';
import { GetApAgingUseCase, GetSupplierStatementUseCase } from '../../application/use-cases/ap-reporting.use-case';
import { ListWhtIncomeCategoriesUseCase } from '../../application/use-cases/wht-income-category.use-case';
import { CreateSupplierPaymentDto, RequiredReasonDto } from './procurement.dtos';

@Controller('companies/:companyId/accounts-payable')
export class SupplierPaymentController {
  constructor(
    private readonly createPayment: CreateSupplierPaymentUseCase,
    private readonly getPayment: GetSupplierPaymentUseCase,
    private readonly getPaymentPostingSource: GetSupplierPaymentPostingSourceUseCase,
    private readonly getPaymentPp36PostingSource: GetSupplierPaymentPp36PostingSourceUseCase,
    private readonly listPayments: ListSupplierPaymentsUseCase,
    private readonly voidPayment: VoidSupplierPaymentUseCase,
    private readonly getApAging: GetApAgingUseCase,
    private readonly getStatement: GetSupplierStatementUseCase,
    private readonly listWhtCategories: ListWhtIncomeCategoriesUseCase,
  ) {}

  @Get('payments')
  @RequirePermissions('procurement.supplier_payment.read')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.listPayments.execute(ctx, { status: q['status'], supplierId: q['supplierId'], method: q['method'], postingStatus: q['postingStatus'], fromDate: q['fromDate'], toDate: q['toDate'], page: q['page'] ? Number(q['page']) : undefined, pageSize: q['pageSize'] ? Number(q['pageSize']) : undefined });
  }

  @Post('payments')
  @RequirePermissions('procurement.supplier_payment.create', 'procurement.supplier_payment.release')
  async create(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateSupplierPaymentDto) {
    assertRouteCompany(ctx, companyId);
    return this.createPayment.execute(ctx, body);
  }

  // Registered before `payments/:id` would ever be consulted for a different prefix, but kept
  // adjacent to the payment routes because it exists only to fill the withholding form below.
  @Get('wht-income-categories')
  @RequirePermissions('procurement.supplier_payment.read')
  async whtIncomeCategories(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string) {
    assertRouteCompany(ctx, companyId);
    return this.listWhtCategories.execute(ctx);
  }

  @Get('payments/:id')
  @RequirePermissions('procurement.supplier_payment.read')
  async get(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.getPayment.execute(ctx, id);
  }

  @Get('payments/:id/posting-source')
  @RequirePermissions('procurement.supplier_payment.read')
  async postingSource(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.getPaymentPostingSource.execute(ctx, id);
  }

  @Get('payments/:id/pp36-posting-source')
  @RequirePermissions('procurement.supplier_payment.read')
  async pp36PostingSource(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.getPaymentPp36PostingSource.execute(ctx, id);
  }

  @Post('payments/:id/void')
  @RequirePermissions('procurement.supplier_payment.void')
  async void(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: RequiredReasonDto) {
    assertRouteCompany(ctx, companyId);
    return this.voidPayment.execute(ctx, id, body.reason);
  }

  @Get('aging')
  @RequirePermissions('procurement.ap.report')
  async aging(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.getApAging.execute(ctx, q['asOfDate'], q['supplierId']);
  }

  @Get('suppliers/:supplierId/statement')
  @RequirePermissions('procurement.ap.report')
  async statement(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('supplierId') supplierId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.getStatement.execute(ctx, supplierId, q['fromDate'], q['toDate']);
  }
}
