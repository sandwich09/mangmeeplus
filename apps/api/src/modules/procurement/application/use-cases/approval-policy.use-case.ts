import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaProcurementRepository } from '../../infrastructure/prisma-procurement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { d, decStr, PROCUREMENT_APPROVAL_POLICY_DEFAULTS } from '../../domain/logic/procurement.logic';
// H-05 owns the money-string grammar; reuse it so threshold input follows the
// same accept/reject rules as every other Decimal(18,4) money field.
import { POSITIVE_ACCOUNTING_QUANTITY_PATTERN } from '../../../accounting-documents/domain/logic/accounting-money-validation.logic';
import type { ProcurementApprovalPolicyRecord } from '../../domain/models/procurement.model';

@Injectable()
export class GetProcurementApprovalPolicyUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext): Promise<ProcurementApprovalPolicyRecord> {
    if (!ctx.permissions.includes('procurement.approval_policy.read')) throw new ForbiddenException('Missing permission: procurement.approval_policy.read');
    const existing = await this.repo.getProcurementApprovalPolicy(ctx.companyId);
    if (existing) return existing;
    const now = new Date();
    return { id: 'default', companyId: ctx.companyId, ...PROCUREMENT_APPROVAL_POLICY_DEFAULTS, createdByUserId: 'system', createdAt: now, updatedAt: now };
  }
}

@Injectable()
export class UpdateProcurementApprovalPolicyUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, input: { allowSelfApproval?: boolean; dualApprovalThresholdAmount?: string | null }): Promise<ProcurementApprovalPolicyRecord> {
    if (!ctx.permissions.includes('procurement.approval_policy.manage')) throw new ForbiddenException('Missing permission: procurement.approval_policy.manage');
    if (input.allowSelfApproval !== undefined && typeof input.allowSelfApproval !== 'boolean') {
      throw new BadRequestException('allowSelfApproval must be a boolean');
    }
    let threshold = input.dualApprovalThresholdAmount;
    if (threshold !== undefined && threshold !== null) {
      if (typeof threshold !== 'string' || !POSITIVE_ACCOUNTING_QUANTITY_PATTERN.test(threshold.trim())) {
        throw new BadRequestException('dualApprovalThresholdAmount must be a positive decimal string with at most 4 decimal places, or null to disable');
      }
      threshold = decStr(d(threshold.trim()));
    }
    const previous = await this.repo.getProcurementApprovalPolicy(ctx.companyId);
    const updated = await this.repo.upsertProcurementApprovalPolicy(ctx.companyId, { allowSelfApproval: input.allowSelfApproval, dualApprovalThresholdAmount: threshold }, ctx.userId);
    // Weakening maker-checker controls is a CRITICAL, always-audited change.
    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.approval_policy.update',
      targetType: 'procurement_approval_policy', targetId: updated.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'CRITICAL',
      metadataJson: {
        previous: previous ? { allowSelfApproval: previous.allowSelfApproval, dualApprovalThresholdAmount: previous.dualApprovalThresholdAmount } : PROCUREMENT_APPROVAL_POLICY_DEFAULTS,
        next: { allowSelfApproval: updated.allowSelfApproval, dualApprovalThresholdAmount: updated.dualApprovalThresholdAmount },
      },
    });
    return updated;
  }
}
