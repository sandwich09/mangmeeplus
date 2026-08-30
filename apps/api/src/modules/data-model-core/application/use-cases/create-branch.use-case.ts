import { Injectable, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaBranchRepository } from '../../infrastructure/repositories/prisma-branch.repository';
import type { BranchRecord } from '../../domain/models/branch.model';
import { validateBranchCode, validateTaxBranchCode } from '../../domain/logic/branch.logic';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaService } from '../../../../common/database/prisma.service';
import { assertBranchLimit } from '../../../system-partner-management/application/plan-term-limit';

export type CreateBranchCommand = {
  code: string;
  name: string;
  type: 'HEAD_OFFICE' | 'BRANCH' | 'ONLINE' | 'WAREHOUSE';
  taxBranchCode?: string | null;
  phone?: string;
  email?: string;
  addressJson?: Record<string, unknown>;
};

@Injectable()
export class CreateBranchUseCase {
  constructor(
    private readonly branches: PrismaBranchRepository,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(ctx: RequestContext, cmd: CreateBranchCommand): Promise<BranchRecord> {
    if (!ctx.permissions.includes('company.branch.manage')) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'company.branch.create', targetType: 'branch', targetId: undefined,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'MEDIUM',
      });
      throw new ForbiddenException();
    }

    // P29 §4D: caps the count of NEW branches only. Existing branches are never touched, and a
    // company with no plan-term row is unlimited.
    await assertBranchLimit(this.prisma, ctx.companyId);

    const codeErr = validateBranchCode(cmd.code);
    if (codeErr) throw new BadRequestException(codeErr);

    if (cmd.taxBranchCode != null) {
      const taxErr = validateTaxBranchCode(cmd.taxBranchCode);
      if (taxErr) throw new BadRequestException(taxErr);
      const duplicateTaxBranch = await this.branches.findActiveByTaxBranchCode(ctx.companyId, cmd.taxBranchCode);
      if (duplicateTaxBranch) {
        throw new ConflictException(`Tax branch code "${cmd.taxBranchCode}" already exists in this company.`);
      }
    }

    try {
      const branch = await this.branches.create({
        companyId: ctx.companyId,
        code: cmd.code,
        name: cmd.name,
        type: cmd.type,
        taxBranchCode: cmd.taxBranchCode,
        phone: cmd.phone,
        email: cmd.email,
        addressJson: cmd.addressJson,
        createdByUserId: ctx.userId,
      });

      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'company.branch.create', targetType: 'branch', targetId: branch.id,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { branchCode: branch.code, branchType: branch.type },
      });

      return branch;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(`Branch code "${cmd.code}" already exists in this company.`);
      }
      throw err;
    }
  }
}
