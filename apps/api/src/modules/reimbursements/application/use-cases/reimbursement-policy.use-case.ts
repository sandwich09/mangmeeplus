import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import type { RequestContext, UpdateReimbursementPolicyInput, ReimbursementPolicySummary } from '@watchdog-bms/contracts';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { toPolicySummary } from '../dto/reimbursement.mapper';
import { REIMBURSEMENT_POLICY_DEFAULTS } from '../../domain/reimbursement.constants';
import { d } from '../../domain/logic/reimbursement.logic';

const APPROVER_MODES = ['DIRECT_MANAGER', 'MANAGER_ROLE', 'OWNER_ROLE', 'CUSTOM_USER', 'CUSTOM_ROLE'];
const DUP_POLICIES = ['WARN', 'BLOCK_SUBMIT', 'BLOCK_PAYMENT'];

@Injectable()
export class GetReimbursementPolicyUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository) {}

  async execute(ctx: RequestContext): Promise<ReimbursementPolicySummary> {
    if (!ctx.permissions.includes('reimbursement.policy.read')) {
      throw new ForbiddenException('Missing permission: reimbursement.policy.read');
    }
    const existing = await this.repo.findPolicy(ctx.companyId, null);
    if (existing) return toPolicySummary(existing);
    // No stored policy yet — return company defaults as a virtual, unsaved summary.
    const now = new Date().toISOString();
    return {
      id: 'default',
      companyId: ctx.companyId,
      currency: REIMBURSEMENT_POLICY_DEFAULTS.currency,
      approvalThresholdAmount: REIMBURSEMENT_POLICY_DEFAULTS.approvalRequiredFromAmount,
      approvalRequiredFromAmount: REIMBURSEMENT_POLICY_DEFAULTS.approvalRequiredFromAmount,
      approverMode: REIMBURSEMENT_POLICY_DEFAULTS.approverMode,
      defaultApproverRole: REIMBURSEMENT_POLICY_DEFAULTS.defaultApproverRole,
      allowSelfApproval: REIMBURSEMENT_POLICY_DEFAULTS.allowSelfApproval,
      requireReceipt: REIMBURSEMENT_POLICY_DEFAULTS.requireReceipt,
      allowMissingReceiptWithReason: REIMBURSEMENT_POLICY_DEFAULTS.allowMissingReceiptWithReason,
      duplicatePolicy: REIMBURSEMENT_POLICY_DEFAULTS.duplicatePolicy,
      financeReviewRequired: REIMBURSEMENT_POLICY_DEFAULTS.financeReviewRequired,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
  }
}

@Injectable()
export class UpdateReimbursementPolicyUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, input: UpdateReimbursementPolicyInput): Promise<ReimbursementPolicySummary> {
    if (!ctx.permissions.includes('reimbursement.policy.manage')) {
      throw new ForbiddenException('Missing permission: reimbursement.policy.manage');
    }
    // Validation
    if (input.approverMode && !APPROVER_MODES.includes(input.approverMode)) {
      throw new BadRequestException('invalid_approver_mode');
    }
    if (input.duplicatePolicy && !DUP_POLICIES.includes(input.duplicatePolicy)) {
      throw new BadRequestException('invalid_duplicate_policy');
    }
    if (input.approvalRequiredFromAmount !== undefined && !d(input.approvalRequiredFromAmount).gte(0)) {
      throw new BadRequestException('invalid_threshold');
    }
    if (input.slaHours !== undefined && input.slaHours !== null && input.slaHours < 0) {
      throw new BadRequestException('invalid_sla_hours');
    }

    const data: Record<string, unknown> = {};
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.approvalThresholdAmount !== undefined) data.approvalThresholdAmount = input.approvalThresholdAmount;
    if (input.approvalRequiredFromAmount !== undefined) data.approvalRequiredFromAmount = input.approvalRequiredFromAmount;
    if (input.approverMode !== undefined) data.approverMode = input.approverMode;
    if (input.defaultApproverUserId !== undefined) data.defaultApproverUserId = input.defaultApproverUserId;
    if (input.defaultApproverRole !== undefined) data.defaultApproverRole = input.defaultApproverRole;
    if (input.allowSelfApproval !== undefined) data.allowSelfApproval = input.allowSelfApproval;
    if (input.requireReceipt !== undefined) data.requireReceipt = input.requireReceipt;
    if (input.allowMissingReceiptWithReason !== undefined) data.allowMissingReceiptWithReason = input.allowMissingReceiptWithReason;
    if (input.duplicatePolicy !== undefined) data.duplicatePolicy = input.duplicatePolicy;
    if (input.financeReviewRequired !== undefined) data.financeReviewRequired = input.financeReviewRequired;
    if (input.slaHours !== undefined) data.slaHours = input.slaHours;
    if (input.status !== undefined) data.status = input.status;

    const policy = await this.repo.upsertPolicy(ctx.companyId, null, data, ctx.userId);

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.policy.update',
      targetType: 'reimbursement_policy', targetId: policy.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { approverMode: policy.approverMode, approvalRequiredFromAmount: policy.approvalRequiredFromAmount, duplicatePolicy: policy.duplicatePolicy },
    });
    void this.outbox.append('reimbursement.policy_updated', 'reimbursement_policy', policy.id, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'reimbursement_policy', aggregateId: policy.id, occurredAt: new Date().toISOString(),
      data: { status: policy.status },
    });
    return toPolicySummary(policy);
  }
}
