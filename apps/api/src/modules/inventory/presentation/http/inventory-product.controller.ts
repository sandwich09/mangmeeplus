import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { CreateProductUseCase } from '../../application/use-cases/create-product.use-case';
import { ListProductsUseCase, GetProductUseCase } from '../../application/use-cases/list-products.use-case';
import { UpdateProductUseCase, ArchiveProductUseCase } from '../../application/use-cases/update-product.use-case';
import { AddProductBarcodeUseCase } from '../../application/use-cases/barcode.use-cases';
import { GenerateQrLabelUseCase } from '../../application/use-cases/qr-label.use-cases';
import { ListMovementsUseCase, GetStockBalanceUseCase } from '../../application/use-cases/movement-query.use-cases';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { AddProductBarcodeDto, CreateProductDto, GenerateEntityQrDto, UpdateProductDto } from './inventory.dtos';

@Controller('companies/:companyId/inventory/products')
export class InventoryProductController {
  constructor(
    private readonly createProduct: CreateProductUseCase,
    private readonly listProducts: ListProductsUseCase,
    private readonly getProduct: GetProductUseCase,
    private readonly updateProduct: UpdateProductUseCase,
    private readonly archiveProduct: ArchiveProductUseCase,
    private readonly addBarcode: AddProductBarcodeUseCase,
    private readonly generateLabel: GenerateQrLabelUseCase,
    private readonly listMovements: ListMovementsUseCase,
    private readonly getBalance: GetStockBalanceUseCase,
  ) {}

  @Get()
  @RequirePermissions('inventory.product.read')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.listProducts.execute(ctx, {
      status: q['status'],
      kind: q['kind'],
      customerVisible: q['customerVisible'] === undefined ? undefined : q['customerVisible'] === 'true',
      search: q['search'],
      page: q['page'] ? Number(q['page']) : undefined,
      pageSize: q['pageSize'] ? Number(q['pageSize']) : undefined,
    });
  }

  @Post()
  @RequirePermissions('inventory.product.manage')
  async create(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateProductDto) {
    assertRouteCompany(ctx, companyId);
    return this.createProduct.execute(ctx, body);
  }

  @Get(':productId/movements')
  @RequirePermissions('inventory.movement.read')
  async movements(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('productId') productId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.listMovements.execute(ctx, {
      productId,
      locationId: q['locationId'],
      movementType: q['movementType'],
      page: q['page'] ? Number(q['page']) : undefined,
      pageSize: q['pageSize'] ? Number(q['pageSize']) : undefined,
    });
  }

  @Get(':productId/balances')
  @RequirePermissions('inventory.report.read')
  async balances(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('productId') productId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.getBalance.execute(ctx, { productId, locationId: q['locationId'] });
  }

  @Post(':productId/barcodes')
  @RequirePermissions('inventory.label.manage')
  async barcode(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('productId') productId: string, @Body() body: AddProductBarcodeDto) {
    assertRouteCompany(ctx, companyId);
    return this.addBarcode.execute(ctx, { productId, ...body });
  }

  @Post(':productId/internal-qr')
  @RequirePermissions('inventory.label.manage')
  async productQr(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('productId') productId: string, @Body() body: GenerateEntityQrDto) {
    assertRouteCompany(ctx, companyId);
    return this.generateLabel.execute(ctx, { entityType: 'PRODUCT', entityId: productId, labelText: body.labelText });
  }

  @Post(':productId/archive')
  @RequirePermissions('inventory.product.manage')
  async archive(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('productId') productId: string) {
    assertRouteCompany(ctx, companyId);
    return this.archiveProduct.execute(ctx, { productId });
  }

  @Get(':productId')
  @RequirePermissions('inventory.product.read')
  async getOne(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('productId') productId: string) {
    assertRouteCompany(ctx, companyId);
    return this.getProduct.execute(ctx, productId);
  }

  @Patch(':productId')
  @RequirePermissions('inventory.product.manage')
  async update(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('productId') productId: string, @Body() body: UpdateProductDto) {
    assertRouteCompany(ctx, companyId);
    return this.updateProduct.execute(ctx, { productId, ...body });
  }

}
