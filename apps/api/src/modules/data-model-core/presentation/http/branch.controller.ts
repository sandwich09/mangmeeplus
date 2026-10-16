import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { ListBranchesUseCase } from '../../application/use-cases/list-branches.use-case';
import { CreateBranchUseCase } from '../../application/use-cases/create-branch.use-case';
import { UpdateBranchUseCase } from '../../application/use-cases/update-branch.use-case';
import { assertRouteCompany } from './assert-route-company';
import { CreateBranchDto, UpdateBranchDto } from './data-model-core.dtos';

@Controller('companies/:companyId/branches')
export class BranchController {
  constructor(
    private readonly listBranches: ListBranchesUseCase,
    private readonly createBranch: CreateBranchUseCase,
    private readonly updateBranch: UpdateBranchUseCase,
  ) {}

  @Get()
  @RequireAnyPermission('company.branch.read', 'company.branch.manage')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() query: any) {
    assertRouteCompany(ctx, companyId);
    return this.listBranches.execute(ctx, {
      status: query['status'],
      type: query['type'],
      page: query['page'] ? Number(query['page']) : undefined,
      pageSize: query['pageSize'] ? Number(query['pageSize']) : undefined,
    });
  }

  @Post()
  @RequirePermissions('company.branch.manage')
  async create(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateBranchDto) {
    assertRouteCompany(ctx, companyId);
    return this.createBranch.execute(ctx, body);
  }

  @Patch(':branchId')
  @RequirePermissions('company.branch.manage')
  async update(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Param('branchId') branchId: string,
    @Body() body: UpdateBranchDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.updateBranch.execute(ctx, { branchId, ...body });
  }
}
