import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RequestContext } from '@watchdog-bms/contracts';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import { CreateRevenueCategoryDto, UpdateRevenueCategoryDto } from './revenue-category.dtos';
import {
  CreateRevenueCategoryUseCase,
  ListAllRevenueCategoriesUseCase,
  ListRevenueCategoriesUseCase,
  UpdateRevenueCategoryUseCase,
} from '../../application/use-cases/revenue-category.use-case';

@ApiTags('accounting')
@Controller('companies/:companyId/revenue-categories')
export class RevenueCategoryController {
  constructor(
    private readonly listCats: ListRevenueCategoriesUseCase,
    private readonly listAllCats: ListAllRevenueCategoriesUseCase,
    private readonly createCat: CreateRevenueCategoryUseCase,
    private readonly updateCat: UpdateRevenueCategoryUseCase,
  ) {}

  /** ACTIVE categories for pickers — readable by anyone who can read sales documents. */
  @Get()
  @RequireAnyPermission('accounting.document.read', 'accounting.document.read_related')
  @ApiOperation({ summary: 'List active revenue categories' })
  listCategories(@ReqCtx() ctx: RequestContext) {
    return this.listCats.execute(ctx);
  }

  /** Management view including archived categories. */
  @Get('manage')
  @RequirePermissions('accounting.revenue_category.manage')
  @ApiOperation({ summary: 'List all revenue categories (management)' })
  listAllCategories(@ReqCtx() ctx: RequestContext) {
    return this.listAllCats.execute(ctx);
  }

  @Post()
  @RequirePermissions('accounting.revenue_category.manage')
  @ApiOperation({ summary: 'Create revenue category' })
  createCategory(@ReqCtx() ctx: RequestContext, @Body() body: CreateRevenueCategoryDto) {
    return this.createCat.execute(ctx, body);
  }

  @Patch(':categoryId')
  @RequirePermissions('accounting.revenue_category.manage')
  @ApiOperation({ summary: 'Update revenue category (rename / reorder / retax / archive)' })
  updateCategory(@ReqCtx() ctx: RequestContext, @Param('categoryId') categoryId: string, @Body() body: UpdateRevenueCategoryDto) {
    return this.updateCat.execute(ctx, categoryId, body);
  }
}
