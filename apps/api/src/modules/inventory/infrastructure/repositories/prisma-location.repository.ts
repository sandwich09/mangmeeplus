import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { LocationRepositoryPort, CreateLocationInput, UpdateLocationInput, ListLocationsFilter, LocationPage } from '../../domain/ports/inventory.repository.port';
import type { InventoryLocation } from '../../domain/models/inventory.model';
import { toLocation } from '../db/inventory.prisma.mapper';

@Injectable()
export class PrismaLocationRepository implements LocationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findById(companyId: string, id: string): Promise<InventoryLocation | null> {
    const row = await this.prisma.client.inventoryLocation.findFirst({ where: { id, companyId } });
    return row ? toLocation(row) : null;
  }

  async findByCode(companyId: string, code: string): Promise<InventoryLocation | null> {
    const row = await this.prisma.client.inventoryLocation.findFirst({ where: { companyId, code } });
    return row ? toLocation(row) : null;
  }

  async list(companyId: string, filter: ListLocationsFilter): Promise<LocationPage> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const where: any = { companyId };
    if (filter.status) where.status = filter.status;
    if (filter.type) where.type = filter.type;
    if (filter.branchId) where.branchId = filter.branchId;
    if (filter.branchIds) where.OR = [{ branchId: null }, { branchId: { in: filter.branchIds } }];
    if (filter.search) {
      const searchOr = [
        { code: { contains: filter.search, mode: 'insensitive' } },
        { name: { contains: filter.search, mode: 'insensitive' } },
      ];
      where.AND = [...(where.AND ?? []), { OR: searchOr }];
    }

    const [items, total] = await Promise.all([
      this.prisma.client.inventoryLocation.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { name: 'asc' } }),
      this.prisma.client.inventoryLocation.count({ where }),
    ]);
    return { items: items.map(toLocation), total, page, pageSize };
  }

  async create(input: CreateLocationInput): Promise<InventoryLocation> {
    const row = await this.prisma.client.inventoryLocation.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId,
        code: input.code,
        name: input.name,
        type: (input.type ?? 'MAIN') as any,
        createdByUserId: input.createdByUserId,
      },
    });
    return toLocation(row);
  }

  async update(companyId: string, id: string, input: UpdateLocationInput): Promise<InventoryLocation> {
    const row = await this.prisma.client.inventoryLocation.update({
      where: { id },
      data: {
        name: input.name,
        type: input.type as any,
        status: input.status as any,
        updatedByUserId: input.updatedByUserId,
      },
    });
    return toLocation(row);
  }
}
