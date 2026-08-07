import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { CreateSupplierUseCase, UpdateSupplierUseCase, GetSupplierUseCase, ListSuppliersUseCase, ListSupplierBankAccountsUseCase, CreateSupplierBankAccountUseCase } from '../../application/use-cases/supplier.use-case';
import { CreateSupplierBankAccountDto, CreateSupplierDto, UpdateSupplierDto } from './procurement.dtos';

@Controller('companies/:companyId/procurement/suppliers')
export class SupplierController {
  constructor(
    private readonly createSupplier: CreateSupplierUseCase,
    private readonly updateSupplier: UpdateSupplierUseCase,
    private readonly getSupplier: GetSupplierUseCase,
    private readonly listSuppliers: ListSuppliersUseCase,
    private readonly listBankAccounts: ListSupplierBankAccountsUseCase,
    private readonly addBankAccount: CreateSupplierBankAccountUseCase,
  ) {}

  @Get()
  @RequirePermissions('procurement.supplier.read')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.listSuppliers.execute(ctx, { status: q['status'], supplierType: q['supplierType'], taxId: q['taxId'], search: q['search'], page: q['page'] ? Number(q['page']) : undefined, pageSize: q['pageSize'] ? Number(q['pageSize']) : undefined });
  }

  @Post()
  @RequirePermissions('procurement.supplier.manage')
  async create(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateSupplierDto) {
    assertRouteCompany(ctx, companyId);
    return this.createSupplier.execute(ctx, body);
  }

  @Get(':supplierId')
  @RequirePermissions('procurement.supplier.read')
  async get(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('supplierId') supplierId: string) {
    assertRouteCompany(ctx, companyId);
    return this.getSupplier.execute(ctx, supplierId);
  }

  @Patch(':supplierId')
  @RequirePermissions('procurement.supplier.manage')
  async update(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('supplierId') supplierId: string, @Body() body: UpdateSupplierDto) {
    assertRouteCompany(ctx, companyId);
    return this.updateSupplier.execute(ctx, supplierId, body);
  }

  @Get(':supplierId/bank-accounts')
  @RequirePermissions('procurement.supplier.bank.read')
  async getBankAccounts(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('supplierId') supplierId: string) {
    assertRouteCompany(ctx, companyId);
    return this.listBankAccounts.execute(ctx, supplierId);
  }

  @Post(':supplierId/bank-accounts')
  @RequirePermissions('procurement.supplier.bank.manage')
  async createBankAccount(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('supplierId') supplierId: string, @Body() body: CreateSupplierBankAccountDto) {
    assertRouteCompany(ctx, companyId);
    return this.addBankAccount.execute(ctx, supplierId, body);
  }
}
