import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { BranchRepositoryPort } from '../../domain/ports/branch-repository.port';
import type {
  BranchRecord,
  CreateBranchRecord,
  UpdateBranchRecord,
  FindBranchByIdInput,
  ListBranchesInput,
  PaginatedBranches,
} from '../../domain/models/branch.model';

@Injectable()
export class PrismaBranchRepository implements BranchRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateBranchRecord): Promise<BranchRecord> {
    const row = await this.prisma.client.branch.create({
      data: {
        companyId: input.companyId,
        code: input.code,
        name: input.name,
        type: input.type as any,
        taxBranchCode: input.taxBranchCode,
        isVatEstablishment: input.taxBranchCode != null,
        addressJson: (input.addressJson ?? undefined) as any,
        phone: input.phone,
        email: input.email,
        createdByUserId: input.createdByUserId,
      },
    });
    return this.toRecord(row);
  }

  async update(input: UpdateBranchRecord): Promise<BranchRecord> {
    // Keep the two Step-0 fields coupled, but do not rewrite them for unrelated edits.
    const taxIdentityData = input.taxBranchCode === undefined
      ? {}
      : { taxBranchCode: input.taxBranchCode, isVatEstablishment: input.taxBranchCode !== null };
    const row = await this.prisma.client.branch.update({
      where: { id: input.id },
      data: {
        name: input.name,
        ...taxIdentityData,
        addressJson: (input.addressJson ?? undefined) as any,
        phone: input.phone,
        email: input.email,
        status: input.status as any,
        updatedByUserId: input.updatedByUserId,
      },
    });
    return this.toRecord(row);
  }

  async findById(input: FindBranchByIdInput): Promise<BranchRecord | null> {
    const row = await this.prisma.client.branch.findFirst({
      where: { id: input.id, companyId: input.companyId },
    });
    return row ? this.toRecord(row) : null;
  }

  async list(input: ListBranchesInput): Promise<PaginatedBranches> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const where = {
      companyId: input.companyId,
      ...(input.status ? { status: input.status as any } : {}),
      ...(input.type ? { type: input.type as any } : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.branch.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.client.branch.count({ where }),
    ]);
    return { items: rows.map((r) => this.toRecord(r)), total, page, pageSize };
  }

  async countActiveHeadOffice(companyId: string): Promise<number> {
    return this.prisma.client.branch.count({
      where: { companyId, type: 'HEAD_OFFICE', status: 'ACTIVE' },
    });
  }

  async findActiveByTaxBranchCode(
    companyId: string,
    taxBranchCode: string,
    excludeBranchId?: string,
  ): Promise<BranchRecord | null> {
    const row = await this.prisma.client.branch.findFirst({
      where: {
        companyId,
        taxBranchCode,
        status: 'ACTIVE',
        ...(excludeBranchId ? { id: { not: excludeBranchId } } : {}),
      },
    });
    return row ? this.toRecord(row) : null;
  }

  private toRecord(row: any): BranchRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      name: row.name,
      type: row.type,
      isVatEstablishment: row.isVatEstablishment === true,
      taxBranchCode: row.taxBranchCode ?? undefined,
      addressJson: row.addressJson as Record<string, unknown> | undefined,
      phone: row.phone ?? undefined,
      email: row.email ?? undefined,
      status: row.status,
      createdByUserId: row.createdByUserId ?? undefined,
      updatedByUserId: row.updatedByUserId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
