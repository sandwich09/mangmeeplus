import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { QrLabelRepositoryPort, CreateQrLabelInput } from '../../domain/ports/inventory.repository.port';
import type { InternalQrLabel } from '../../domain/models/inventory.model';
import { toQrLabel } from '../db/inventory.prisma.mapper';

@Injectable()
export class PrismaQrLabelRepository implements QrLabelRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByPayload(companyId: string, payload: string): Promise<InternalQrLabel | null> {
    const row = await this.prisma.client.internalQrLabel.findFirst({ where: { companyId, payload } });
    return row ? toQrLabel(row) : null;
  }

  async findByEntity(companyId: string, entityType: InternalQrLabel['entityType'], entityId: string): Promise<InternalQrLabel[]> {
    const rows = await this.prisma.client.internalQrLabel.findMany({
      where: { companyId, entityType: entityType as any, entityId },
    });
    return rows.map(toQrLabel);
  }

  async create(input: CreateQrLabelInput): Promise<InternalQrLabel> {
    const row = await this.prisma.client.internalQrLabel.create({
      data: {
        companyId: input.companyId,
        entityType: input.entityType as any,
        entityId: input.entityId,
        payload: input.payload,
        labelText: input.labelText,
      },
    });
    return toQrLabel(row);
  }

  async markPrinted(companyId: string, id: string, printedByUserId: string): Promise<InternalQrLabel | null> {
    const existing = await this.prisma.client.internalQrLabel.findFirst({ where: { id, companyId } });
    if (!existing) return null;
    const row = await this.prisma.client.internalQrLabel.update({
      where: { id },
      data: { printedAt: new Date(), printedByUserId },
    });
    return toQrLabel(row);
  }
}
