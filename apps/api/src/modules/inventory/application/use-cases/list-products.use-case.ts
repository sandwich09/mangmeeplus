import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaProductRepository } from '../../infrastructure/repositories/prisma-product.repository';
import { PrismaBarcodeRepository } from '../../infrastructure/repositories/prisma-barcode.repository';
import type { Product, ProductBarcode, InventoryRecordStatus } from '../../domain/models/inventory.model';
import type { ProductPage } from '../../domain/ports/inventory.repository.port';

export type ListProductsQuery = {
  status?: InventoryRecordStatus;
  kind?: Product['kind'];
  customerVisible?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
};

@Injectable()
export class ListProductsUseCase {
  constructor(private readonly products: PrismaProductRepository) {}

  async execute(ctx: RequestContext, query: ListProductsQuery): Promise<ProductPage> {
    if (!ctx.permissions.includes('inventory.product.read')) throw new ForbiddenException();
    return this.products.list(ctx.companyId, query);
  }
}

@Injectable()
export class GetProductUseCase {
  constructor(
    private readonly products: PrismaProductRepository,
    private readonly barcodes: PrismaBarcodeRepository,
  ) {}

  async execute(ctx: RequestContext, productId: string): Promise<Product & { barcodes: ProductBarcode[] }> {
    if (!ctx.permissions.includes('inventory.product.read')) throw new ForbiddenException();
    const product = await this.products.findById(ctx.companyId, productId);
    if (!product) throw new NotFoundException('Product not found');
    return { ...product, barcodes: await this.barcodes.listByProduct(ctx.companyId, productId) };
  }
}
