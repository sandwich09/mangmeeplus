import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaBranchRepository } from '../../infrastructure/repositories/prisma-branch.repository';
import type { BranchRecord } from '../../domain/models/branch.model';
import { canArchiveBranch, validateTaxBranchCode } from '../../domain/logic/branch.logic';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { AuditService } from '../../../audit/application/audit.service';

export type UpdateBranchCommand = {
  branchId: string;
  name?: string;
  taxBranchCode?: string | null;
  phone?: string;
  email?: string;
  addressJson?: Record<string, unknown>;
  status?: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
};

@Injectable()
export class UpdateBranchUseCase {
  constructor(
    private readonly branches: PrismaBranchRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, cmd: UpdateBranchCommand): Promise<BranchRecord> {
    if (!ctx.permissions.includes('company.branch.manage')) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'company.branch.update', targetType: 'branch', targetId: cmd.branchId,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'MEDIUM',
      });
      throw new ForbiddenException();
    }

    const existing = await this.branches.findById({ id: cmd.branchId, companyId: ctx.companyId });
    if (!existing) throw new NotFoundException('Branch not found.');

    if (cmd.status === 'ARCHIVED') {
      const count = await this.branches.countActiveHeadOffice(ctx.companyId);
      const err = canArchiveBranch(existing, count);
      if (err) throw new UnprocessableEntityException(err);
    }

    if (cmd.taxBranchCode != null) {
      const taxErr = validateTaxBranchCode(cmd.taxBranchCode);
      if (taxErr) throw new BadRequestException(taxErr);

      const duplicateTaxBranch = await this.branches.findActiveByTaxBranchCode(
        ctx.companyId,
        cmd.taxBranchCode,
        cmd.branchId,
      );
      if (duplicateTaxBranch && (cmd.status ?? existing.status) === 'ACTIVE') {
        throw new ConflictException(`Tax branch code "${cmd.taxBranchCode}" already exists in this company.`);
      }
    }

    const branch = await this.branches.update({
      id: cmd.branchId,
      companyId: ctx.companyId,
      name: cmd.name,
      taxBranchCode: cmd.taxBranchCode,
      phone: cmd.phone,
      email: cmd.email,
      addressJson: cmd.addressJson,
      status: cmd.status,
      updatedByUserId: ctx.userId,
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'company.branch.update', targetType: 'branch', targetId: branch.id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { status: branch.status },
    });

    return branch;
  }
}
