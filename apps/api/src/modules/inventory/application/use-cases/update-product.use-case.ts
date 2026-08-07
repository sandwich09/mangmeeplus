import { Injectable, ForbiddenException, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaProductRepository } from '../../infrastructure/repositories/prisma-product.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import type { Product } from '../../domain/models/inventory.model';

export type UpdateProductCommand = {
  productId: string;
  name?: string;
  // Nullable — apps/web clears the description by sending null (see UpdateProductDto).
  description?: string | null;
  category?: string;
  unit?: string;
  reorderPoint?: string;
  salePrice?: string | null;
  bookingDurationMinutes?: number | null;
  customerVisible?: boolean;
};

export type ArchiveProductCommand = {
  productId: string;
};

@Injectable()
export class UpdateProductUseCase {
  constructor(
    private readonly products: PrismaProductRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, cmd: UpdateProductCommand): Promise<Product> {
    if (!ctx.permissions.includes('inventory.product.manage')) throw new ForbiddenException();
    const product = await this.products.findById(ctx.companyId, cmd.productId);
    if (!product) throw new NotFoundException('Product not found');
    if (cmd.salePrice !== undefined && cmd.salePrice !== null && (typeof cmd.salePrice !== 'string' || !/^\d+(\.\d{1,2})?$/.test(cmd.salePrice.trim()))) {
      throw new BadRequestException('sale_price_invalid');
    }
    if (cmd.customerVisible !== undefined && typeof cmd.customerVisible !== 'boolean') throw new BadRequestException('customer_visible_invalid');
    if (
      cmd.bookingDurationMinutes !== undefined &&
      cmd.bookingDurationMinutes !== null &&
      (!Number.isInteger(cmd.bookingDurationMinutes) || product.kind !== 'SERVICE' || cmd.bookingDurationMinutes < 60 || cmd.bookingDurationMinutes > 180 || cmd.bookingDurationMinutes % 30 !== 0)
    ) {
      throw new BadRequestException('booking_duration_invalid');
    }

    const updated = await this.products.update(ctx.companyId, cmd.productId, {
      name: cmd.name,
      description: cmd.description,
      category: cmd.category,
      unit: cmd.unit,
      reorderPoint: cmd.reorderPoint,
      salePrice: cmd.salePrice === null ? null : cmd.salePrice?.trim(),
      bookingDurationMinutes: cmd.bookingDurationMinutes,
      customerVisible: cmd.customerVisible,
      updatedByUserId: ctx.userId,
    });

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'inventory.product.updated', targetType: 'product', targetId: cmd.productId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    void this.outbox.append('inventory.product.updated', 'product', updated.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'product',
      aggregateId: updated.id,
      occurredAt: updated.updatedAt.toISOString(),
      data: { sku: updated.sku, name: updated.name, kind: updated.kind, status: updated.status },
    });
    return updated;
  }
}

@Injectable()
export class ArchiveProductUseCase {
  constructor(
    private readonly products: PrismaProductRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, cmd: ArchiveProductCommand): Promise<Product> {
    if (!ctx.permissions.includes('inventory.product.manage')) throw new ForbiddenException();
    const product = await this.products.findById(ctx.companyId, cmd.productId);
    if (!product) throw new NotFoundException('Product not found');
    if (product.status === 'ARCHIVED') throw new ConflictException('Product is already archived');

    const updated = await this.products.update(ctx.companyId, cmd.productId, {
      status: 'ARCHIVED',
      updatedByUserId: ctx.userId,
    });

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'inventory.product.archived', targetType: 'product', targetId: cmd.productId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });
    void this.outbox.append('inventory.product.archived', 'product', updated.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'product',
      aggregateId: updated.id,
      occurredAt: updated.updatedAt.toISOString(),
      data: { sku: updated.sku, status: updated.status },
    });
    return updated;
  }
}
