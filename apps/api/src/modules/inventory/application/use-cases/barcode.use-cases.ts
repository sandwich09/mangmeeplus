import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaBarcodeRepository } from '../../infrastructure/repositories/prisma-barcode.repository';
import { PrismaProductRepository } from '../../infrastructure/repositories/prisma-product.repository';
import type { ProductBarcode, ProductBarcodeType } from '../../domain/models/inventory.model';

export type AddProductBarcodeCommand = {
  productId: string;
  type: ProductBarcodeType;
  value: string;
  source?: string;
};

@Injectable()
export class AddProductBarcodeUseCase {
  constructor(
    private readonly products: PrismaProductRepository,
    private readonly barcodes: PrismaBarcodeRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, cmd: AddProductBarcodeCommand): Promise<ProductBarcode> {
    if (!ctx.permissions.includes('inventory.label.manage')) throw new ForbiddenException();
    if (!cmd.value?.trim()) throw new BadRequestException('Barcode value is required');

    const product = await this.products.findById(ctx.companyId, cmd.productId);
    if (!product) throw new NotFoundException('Product not found');
    if (product.status !== 'ACTIVE') throw new ConflictException('Archived products cannot receive new barcodes');

    const existing = await this.barcodes.findByValue(ctx.companyId, cmd.value.trim());
    if (existing) throw new ConflictException('Barcode value already exists in this company');

    const barcode = await this.barcodes.create({
      companyId: ctx.companyId,
      productId: cmd.productId,
      type: cmd.type,
      value: cmd.value.trim(),
      source: cmd.source,
    });

    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'inventory.barcode.created',
      targetType: 'productBarcode',
      targetId: barcode.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
    });

    return barcode;
  }
}
