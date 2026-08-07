import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { BarcodeRepositoryPort, AddBarcodeInput } from '../../domain/ports/inventory.repository.port';
import type { ProductBarcode } from '../../domain/models/inventory.model';
import { toBarcode } from '../db/inventory.prisma.mapper';

@Injectable()
export class PrismaBarcodeRepository implements BarcodeRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByValue(companyId: string, value: string): Promise<ProductBarcode | null> {
    const row = await this.prisma.client.productBarcode.findFirst({ where: { companyId, value } });
    return row ? toBarcode(row) : null;
  }

  async listByProduct(companyId: string, productId: string): Promise<ProductBarcode[]> {
    const rows = await this.prisma.client.productBarcode.findMany({ where: { companyId, productId } });
    return rows.map(toBarcode);
  }

  async create(input: AddBarcodeInput): Promise<ProductBarcode> {
    const row = await this.prisma.client.productBarcode.create({
      data: {
        companyId: input.companyId,
        productId: input.productId,
        type: input.type as any,
        value: input.value,
        source: input.source,
      },
    });
    return toBarcode(row);
  }

  async archive(companyId: string, id: string): Promise<ProductBarcode> {
    const row = await this.prisma.client.productBarcode.update({
      where: { id },
      data: { status: 'ARCHIVED' as any },
    });
    return toBarcode(row);
  }
}
