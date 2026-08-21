import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import type { RequestContext, UpdateReimbursementPolicyInput, ReimbursementPolicySummary, ReimbursementApproverRoleOption } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { filterPermissionsByEntitlement } from '../../../employee-access/domain/logic/feature-gate.logic';
import { toPolicySummary } from '../dto/reimbursement.mapper';
import { REIMBURSEMENT_POLICY_DEFAULTS } from '../../domain/reimbursement.constants';
import { d } from '../../domain/logic/reimbursement.logic';

const APPROVER_MODES = ['DIRECT_MANAGER', 'MANAGER_ROLE', 'OWNER_ROLE', 'CUSTOM_USER', 'CUSTOM_ROLE'];
const DUP_POLICIES = ['WARN', 'BLOCK_SUBMIT', 'BLOCK_PAYMENT'];
const REQUIRED_APPROVER_PERMISSIONS = ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'];

export type ApproverHolder = {
  branchScopeMode: 'ALL_BRANCHES' | 'SELECTED_BRANCHES' | 'DEFAULT_BRANCH_ONLY';
  defaultBranchId?: string | null;
  branchIds: string[];
};
export type ApproverRoleCandidate = {
  key: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  permissionKeys: string[];
  holders: ApproverHolder[];
};
export type ActiveBranch = { id: string; name: string };

function coveredBranchIds(holders: ApproverHolder[], branches: ActiveBranch[]): Set<string> {
  if (holders.some((holder) => holder.branchScopeMode === 'ALL_BRANCHES')) return new Set(branches.map((branch) => branch.id));
  const activeIds = new Set(branches.map((branch) => branch.id));
  const covered = new Set<string>();
  for (const holder of holders) {
    if (holder.branchScopeMode === 'DEFAULT_BRANCH_ONLY' && holder.defaultBranchId && activeIds.has(holder.defaultBranchId)) covered.add(holder.defaultBranchId);
    if (holder.branchScopeMode === 'SELECTED_BRANCHES') {
      for (const branchId of holder.branchIds) if (activeIds.has(branchId)) covered.add(branchId);
    }
  }
  return covered;
}

export function buildReimbursementApproverRoleOptions(
  roles: ApproverRoleCandidate[],
  branches: ActiveBranch[],
): ReimbursementApproverRoleOption[] {
  const owner = roles.find((role) => (
    role.key === 'OWNER'
    && role.status === 'ACTIVE'
    && REQUIRED_APPROVER_PERMISSIONS.every((permission) => role.permissionKeys.includes(permission))
  ));
  const ownerCoverage = coveredBranchIds(owner?.holders ?? [], branches);

  return roles
    .filter((role) => role.status === 'ACTIVE' && !['SYSTEM_ADMIN', 'COMPANY_VIEW'].includes(role.key))
    .map((role) => {
      const hasCapability = REQUIRED_APPROVER_PERMISSIONS.every((permission) => role.permissionKeys.includes(permission));
      const holderCount = hasCapability ? role.holders.length : 0;
      const covered = coveredBranchIds(role.holders, branches);
      const uncovered = branches.filter((branch) => !covered.has(branch.id));
      const coverage: ReimbursementApproverRoleOption['coverage'] = holderCount === 0 || (branches.length > 0 && covered.size === 0)
        ? 'NONE'
        : uncovered.length === 0 ? 'COMPLETE' : 'PARTIAL';
      const ownerRecoveryReady = uncovered.every((branch) => ownerCoverage.has(branch.id));
      const selectable = hasCapability && holderCount > 0 && (coverage === 'COMPLETE' || (coverage === 'PARTIAL' && ownerRecoveryReady));
      const unavailableReason = !hasCapability
        ? 'MISSING_CAPABILITY' as const
        : holderCount === 0 || coverage === 'NONE'
          ? 'NO_ACTIVE_HOLDERS' as const
          : !ownerRecoveryReady ? 'OWNER_RECOVERY_NOT_READY' as const : undefined;
      const optionLabel = coverage === 'COMPLETE'
        ? `${role.name} · ผู้รับผิดชอบ ${holderCount} คน`
        : coverage === 'PARTIAL' && selectable
          ? `${role.name} · ผู้รับผิดชอบ ${holderCount} คน · เจ้าของกิจการช่วยบางสาขา`
          : `${role.name} · ยังไม่พร้อมใช้งาน`;
      return {
        key: role.key,
        name: role.name,
        optionLabel,
        eligibleApproverCount: holderCount,
        coverage,
        uncoveredBranchNames: uncovered.map((branch) => branch.name),
        selectable,
        ...(unavailableReason && { unavailableReason }),
      };
    })
    .sort((a, b) => Number(b.selectable) - Number(a.selectable) || a.name.localeCompare(b.name));
}

export function approverModeForRole(roleKey: string): 'MANAGER_ROLE' | 'OWNER_ROLE' | 'CUSTOM_ROLE' {
  if (roleKey === 'MANAGER') return 'MANAGER_ROLE';
  if (roleKey === 'OWNER') return 'OWNER_ROLE';
  return 'CUSTOM_ROLE';
}

@Injectable()
export class ListReimbursementApproverOptionsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: RequestContext): Promise<ReimbursementApproverRoleOption[]> {
    if (!ctx.permissions.includes('reimbursement.policy.manage')) {
      throw new ForbiddenException('Missing permission: reimbursement.policy.manage');
    }
    return this.load(ctx.companyId);
  }

  async load(companyId: string): Promise<ReimbursementApproverRoleOption[]> {
    const [rows, branches, entitled] = await Promise.all([
      this.prisma.client.role.findMany({
        where: { OR: [{ scopeKey: 'system' }, { scopeKey: companyId }] },
        select: {
          key: true, name: true, scopeKey: true, status: true,
          permissions: { select: { permission: { select: { key: true } } } },
          memberships: {
            where: { membership: { companyId, status: 'ACTIVE', user: { status: 'ACTIVE' } } },
            select: { membership: { select: { branchScopeMode: true, defaultBranchId: true, branchScopes: { select: { branchId: true } } } } },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.client.branch.findMany({ where: { companyId, status: 'ACTIVE' }, select: { id: true, name: true } }),
      loadEntitledFeatureKeys(this.prisma, companyId),
    ]);
    const overriddenKeys = new Set(rows.filter((role) => role.scopeKey === companyId).map((role) => role.key));
    return buildReimbursementApproverRoleOptions(
      rows
        .filter((role) => !(role.scopeKey === 'system' && overriddenKeys.has(role.key)))
        .map((role) => ({
          key: role.key,
          name: role.name,
          status: role.status,
          permissionKeys: filterPermissionsByEntitlement(role.permissions.map((item) => item.permission.key), entitled),
          holders: role.memberships.map(({ membership }) => ({
            branchScopeMode: membership.branchScopeMode,
            defaultBranchId: membership.defaultBranchId,
            branchIds: membership.branchScopes.map((scope) => scope.branchId),
          })),
        })),
      branches,
    );
  }
}

@Injectable()
export class GetReimbursementPolicyUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository) {}

  async execute(ctx: RequestContext): Promise<ReimbursementPolicySummary> {
    if (!ctx.permissions.includes('reimbursement.policy.read') && !ctx.permissions.includes('reimbursement.policy.manage')) {
      throw new ForbiddenException('Missing permission: reimbursement.policy.read or reimbursement.policy.manage');
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
    private readonly approverOptions: ListReimbursementApproverOptionsUseCase,
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
    if (input.defaultApproverRole !== undefined) {
      const roleKey = input.defaultApproverRole?.trim();
      if (!roleKey) throw new BadRequestException('approver_role_required');
      const option = (await this.approverOptions.load(ctx.companyId)).find((item) => item.key === roleKey);
      if (!option?.selectable) throw new BadRequestException('approver_role_not_eligible');
      data.defaultApproverRole = roleKey;
      data.approverMode = approverModeForRole(roleKey);
      data.defaultApproverUserId = null;
    }
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
