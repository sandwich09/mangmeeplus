import { Injectable, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaProductRepository } from '../../infrastructure/repositories/prisma-product.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import type { Product } from '../../domain/models/inventory.model';

export type CreateProductCommand = {
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unit: string;
  kind?: Product['kind'];
  reorderPoint?: string;
  salePrice?: string;
  bookingDurationMinutes?: number;
  customerVisible?: boolean;
};

function assertCatalogFields(kind: Product['kind'], salePrice?: string, duration?: number): void {
  if (salePrice !== undefined && (typeof salePrice !== 'string' || !/^\d+(\.\d{1,2})?$/.test(salePrice.trim()))) {
    throw new BadRequestException('sale_price_invalid');
  }
  if (duration !== undefined && (!Number.isInteger(duration) || kind !== 'SERVICE' || duration < 60 || duration > 180 || duration % 30 !== 0)) {
    throw new BadRequestException('booking_duration_invalid');
  }
}

@Injectable()
export class CreateProductUseCase {
  constructor(
    private readonly products: PrismaProductRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, cmd: CreateProductCommand): Promise<Product> {
    if (!ctx.permissions.includes('inventory.product.manage')) {
      void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'inventory.product.created', targetType: 'product', requestId: ctx.requestId, result: 'DENIED', riskLevel: 'MEDIUM' });
      throw new ForbiddenException();
    }

    if (!cmd.sku?.trim()) throw new BadRequestException('SKU is required');
    if (!cmd.name?.trim()) throw new BadRequestException('Name is required');
    if (!cmd.unit?.trim()) throw new BadRequestException('Unit is required');
    if (cmd.customerVisible !== undefined && typeof cmd.customerVisible !== 'boolean') throw new BadRequestException('customer_visible_invalid');
    const kind = cmd.kind ?? 'STOCKABLE';
    assertCatalogFields(kind, cmd.salePrice, cmd.bookingDurationMinutes);

    const sku = cmd.sku.trim().toUpperCase();
    const existing = await this.products.findBySku(ctx.companyId, sku);
    if (existing) throw new ConflictException(`SKU "${cmd.sku}" already exists in this company`);

    const product = await this.products.create({
      companyId: ctx.companyId,
      sku,
      name: cmd.name.trim(),
      description: cmd.description,
      category: cmd.category,
      unit: cmd.unit.trim(),
      kind,
      reorderPoint: cmd.reorderPoint,
      salePrice: cmd.salePrice?.trim(),
      bookingDurationMinutes: cmd.bookingDurationMinutes,
      customerVisible: cmd.customerVisible,
      createdByUserId: ctx.userId,
    });

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'inventory.product.created', targetType: 'product', targetId: product.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });
    void this.outbox.append('inventory.product.created', 'product', product.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'product',
      aggregateId: product.id,
      occurredAt: product.createdAt.toISOString(),
      data: { sku: product.sku, name: product.name, kind: product.kind, status: product.status },
    });
    return product;
  }
}
