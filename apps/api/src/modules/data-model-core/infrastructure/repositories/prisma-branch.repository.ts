import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { canLeaveActiveBranch } from '../../domain/logic/branch.logic';
import { assertNoInFlightReimbursements } from '../../../reimbursements/application/branch-in-flight';
import { PrismaService } from '../../../../common/database/prisma.service';
import { assertBranchLimit } from '../../../system-partner-management/application/plan-term-limit';
import { lockPlanTermCompany } from '../../../system-partner-management/application/lock-plan-term-company';
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
    const row = await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, input.companyId);
      await assertBranchLimit({ client: tx }, input.companyId);
      await this.assertActiveIdentity(tx, input.companyId, input.type, input.taxBranchCode);
      return tx.branch.create({
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
    });
    return this.toRecord(row);
  }

  async update(input: UpdateBranchRecord): Promise<BranchRecord> {
    // Keep the two Step-0 fields coupled, but do not rewrite them for unrelated edits.
    const taxIdentityData = input.taxBranchCode === undefined
      ? {}
      : { taxBranchCode: input.taxBranchCode, isVatEstablishment: input.taxBranchCode !== null };
    const row = await this.prisma.client.$transaction(async tx => {
      await lockPlanTermCompany(tx, input.companyId);
      const current = await tx.branch.findFirstOrThrow({ where: { id: input.id, companyId: input.companyId } });
      if (input.status === 'ACTIVE' && current.status !== 'ACTIVE') await assertBranchLimit({ client: tx }, input.companyId);
      if ((input.status ?? current.status) === 'ACTIVE' && (input.status === 'ACTIVE' || input.taxBranchCode !== undefined))
        await this.assertActiveIdentity(tx, input.companyId, current.type, input.taxBranchCode === undefined ? current.taxBranchCode : input.taxBranchCode, input.id);
      if (current.status === 'ACTIVE' && input.status && input.status !== 'ACTIVE') {
        const headOffices = await tx.branch.count({ where: { companyId: input.companyId, status: 'ACTIVE', type: 'HEAD_OFFICE' } });
        const active = await tx.branch.count({ where: { companyId: input.companyId, status: 'ACTIVE' } });
        const refusal = canLeaveActiveBranch(this.toRecord(current), headOffices, active);
        if (refusal) throw new UnprocessableEntityException(refusal);
        await assertNoInFlightReimbursements({ client: tx }, input.companyId, input.id);
      }
      return tx.branch.update({
        where: { id: input.id, companyId: input.companyId },
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
    });
    return this.toRecord(row);
  }

  private async assertActiveIdentity(tx: Prisma.TransactionClient, companyId: string, type: string, taxBranchCode: string | null | undefined, excludeId?: string) {
    const where = { companyId, status: 'ACTIVE' as const, ...(excludeId ? { id: { not: excludeId } } : {}) };
    if (type === 'HEAD_OFFICE' && await tx.branch.count({ where: { ...where, type: 'HEAD_OFFICE' } }))
      throw new ConflictException({ code: 'branch_head_office_exists', message: 'This company already has an active head office branch.' });
    if (taxBranchCode && await tx.branch.count({ where: { ...where, taxBranchCode } }))
      throw new ConflictException(`Tax branch code "${taxBranchCode}" already exists in this company.`);
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

  async countActive(companyId: string): Promise<number> {
    return this.prisma.client.branch.count({ where: { companyId, status: 'ACTIVE' } });
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
