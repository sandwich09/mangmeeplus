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
import { canLeaveActiveBranch, validateTaxBranchCode } from '../../domain/logic/branch.logic';
import { assertNoInFlightReimbursements } from '../../../reimbursements/application/branch-in-flight';
import { PrismaService } from '../../../../common/database/prisma.service';
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
    private readonly prisma: PrismaService,
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

    // Any exit from ACTIVE, not just ARCHIVED: `DISABLED` reaches the identical end state and is a
    // plain dropdown choice on the branch settings page, so guarding one and not the other left the
    // rule reachable in two clicks. Re-activating (`status: 'ACTIVE'`) and edits that leave status
    // untouched are unaffected.
    if (cmd.status && cmd.status !== 'ACTIVE' && existing.status === 'ACTIVE') {
      const [headOffices, active] = await Promise.all([
        this.branches.countActiveHeadOffice(ctx.companyId),
        this.branches.countActive(ctx.companyId),
      ]);
      // Carry a stable code so the web can render this business rule in Thai.
      const refusal = canLeaveActiveBranch(existing, headOffices, active);
      if (refusal) throw new UnprocessableEntityException(refusal);
      // Checked last: it costs a query, and the two structural rules above are cheaper to fail on.
      await assertNoInFlightReimbursements(this.prisma, ctx.companyId, existing.id);
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
