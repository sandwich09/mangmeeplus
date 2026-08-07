import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { ProductRepositoryPort, CreateProductInput, UpdateProductInput, ListProductsFilter, ProductPage } from '../../domain/ports/inventory.repository.port';
import type { Product } from '../../domain/models/inventory.model';
import { toProduct } from '../db/inventory.prisma.mapper';

@Injectable()
export class PrismaProductRepository implements ProductRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findById(companyId: string, id: string): Promise<Product | null> {
    const row = await this.prisma.client.product.findFirst({ where: { id, companyId } });
    return row ? toProduct(row) : null;
  }

  async findBySku(companyId: string, sku: string): Promise<Product | null> {
    const row = await this.prisma.client.product.findFirst({ where: { companyId, sku } });
    return row ? toProduct(row) : null;
  }

  async list(companyId: string, filter: ListProductsFilter): Promise<ProductPage> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const where: any = { companyId };
    if (filter.status) where.status = filter.status;
    if (filter.kind) where.kind = filter.kind;
    if (filter.customerVisible !== undefined) where.customerVisible = filter.customerVisible;
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { sku: { contains: filter.search, mode: 'insensitive' } },
        { barcodes: { some: { value: { contains: filter.search, mode: 'insensitive' } } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.client.product.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { name: 'asc' } }),
      this.prisma.client.product.count({ where }),
    ]);
    return { items: items.map(toProduct), total, page, pageSize };
  }

  async create(input: CreateProductInput): Promise<Product> {
    const row = await this.prisma.client.product.create({
      data: {
        companyId: input.companyId,
        sku: input.sku,
        name: input.name,
        description: input.description,
        category: input.category,
        unit: input.unit,
        kind: (input.kind ?? 'STOCKABLE') as any,
        reorderPoint: input.reorderPoint != null ? input.reorderPoint : undefined,
        salePrice: input.salePrice != null ? input.salePrice : undefined,
        bookingDurationMinutes: input.bookingDurationMinutes,
        customerVisible: input.customerVisible ?? false,
        createdByUserId: input.createdByUserId,
      },
    });
    return toProduct(row);
  }

  async update(companyId: string, id: string, input: UpdateProductInput): Promise<Product> {
    const row = await this.prisma.client.product.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        category: input.category,
        unit: input.unit,
        reorderPoint: input.reorderPoint != null ? input.reorderPoint : undefined,
        salePrice: input.salePrice === null ? null : input.salePrice,
        bookingDurationMinutes: input.bookingDurationMinutes,
        customerVisible: input.customerVisible,
        status: input.status as any,
        updatedByUserId: input.updatedByUserId,
      },
    });
    return toProduct(row);
  }
}
