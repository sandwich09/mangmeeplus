import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import type { RequestContext, UpdateReimbursementPolicyInput, ReimbursementPolicySummary, ReimbursementApproverRoleOption } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { filterPermissionsByEntitlement } from '../../../employee-access/domain/logic/feature-gate.logic';
import { toPolicySummary } from '../dto/reimbursement.mapper';
import { REIMBURSEMENT_POLICY_DEFAULTS } from '../../domain/reimbursement.constants';
import { d, isSelfApproval } from '../../domain/logic/reimbursement.logic';

const DUP_POLICIES = ['WARN', 'BLOCK_SUBMIT', 'BLOCK_PAYMENT'];
const REQUIRED_APPROVER_PERMISSIONS = ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'];

export type ApproverHolder = {
  userId?: string;
  roleKeys?: string[];
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

export type ReimbursementSubmissionRoute = {
  responsibilityRole: string;
  effectiveTaskRole: string;
  recipientUserIds: string[];
  ownerRecipientUserIds: string[];
  ownerFallbackUsed: boolean;
};

export type ReimbursementSubmissionRouteInput = {
  roleKey: string;
  branchId?: string;
  requesterUserId: string;
  allowSelfApproval: boolean;
};

function holderCoversRequest(holder: ApproverHolder, branchId?: string): boolean {
  if (!branchId || holder.branchScopeMode === 'ALL_BRANCHES') return true;
  if (holder.branchScopeMode === 'DEFAULT_BRANCH_ONLY') return holder.defaultBranchId === branchId;
  return holder.branchIds.includes(branchId);
}

function hasApproverCapability(role?: ApproverRoleCandidate): role is ApproverRoleCandidate {
  return Boolean(role
    && role.status === 'ACTIVE'
    && REQUIRED_APPROVER_PERMISSIONS.every((permission) => role.permissionKeys.includes(permission)));
}

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
      // The picker answers one question: which responsibility should receive the claim.
      // Counts and coverage mechanics made low-tech users interpret it as choosing a person.
      const optionLabel = selectable ? role.name : `${role.name} · ยังไม่พร้อมใช้งาน`;
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
    const { roles, branches } = await this.loadCandidates(companyId);
    return buildReimbursementApproverRoleOptions(roles, branches);
  }

  async resolveSubmissionRoute(input: {
    companyId: string;
  } & ReimbursementSubmissionRouteInput): Promise<ReimbursementSubmissionRoute> {
    const { roles } = await this.loadCandidates(input.companyId);
    return this.resolveFromCandidates(roles, input);
  }

  async resolveSubmissionRoutes(
    companyId: string,
    inputs: ReimbursementSubmissionRouteInput[],
  ): Promise<ReimbursementSubmissionRoute[]> {
    const { roles } = await this.loadCandidates(companyId);
    return inputs.map((input) => this.resolveFromCandidates(roles, input));
  }

  /**
   * Read-only background scans must not lose every healthy candidate because one
   * legacy pending step no longer has a live route. Empty results remain visible
   * to the workflow action as retryable recipient failures.
   */
  async resolveSubmissionRoutesBestEffort(
    companyId: string,
    inputs: ReimbursementSubmissionRouteInput[],
  ): Promise<Array<ReimbursementSubmissionRoute | null>> {
    const { roles } = await this.loadCandidates(companyId);
    return inputs.map((input) => {
      try {
        return this.resolveFromCandidates(roles, input);
      } catch (error) {
        if (error instanceof BadRequestException) return null;
        throw error;
      }
    });
  }

  async resolveOwnerRecipientUserIds(
    companyId: string,
    inputs: Omit<ReimbursementSubmissionRouteInput, 'roleKey'>[],
  ): Promise<string[][]> {
    const { roles } = await this.loadCandidates(companyId);
    const owner = roles.find((role) => role.key === 'OWNER');
    if (!hasApproverCapability(owner)) return inputs.map(() => []);
    return inputs.map((input) => [...new Set(owner.holders.filter((holder) => (
      !!holder.userId
      && holderCoversRequest(holder, input.branchId)
      && !isSelfApproval(input.requesterUserId, holder.userId, input.allowSelfApproval, holder.roleKeys ?? ['OWNER'])
    )).map((holder) => holder.userId!))].sort());
  }

  private resolveFromCandidates(
    roles: ApproverRoleCandidate[],
    input: ReimbursementSubmissionRouteInput,
  ): ReimbursementSubmissionRoute {
    const selected = roles.find((role) => role.key === input.roleKey);
    if (!hasApproverCapability(selected) || ['SYSTEM_ADMIN', 'COMPANY_VIEW'].includes(input.roleKey)) {
      throw new BadRequestException('approver_role_not_eligible');
    }
    const actionable = (role: ApproverRoleCandidate) => role.holders.filter((holder) => (
      !!holder.userId
      && holderCoversRequest(holder, input.branchId)
      && !isSelfApproval(
        input.requesterUserId,
        holder.userId,
        input.allowSelfApproval,
        holder.roleKeys ?? [role.key],
      )
    ));
    const owner = roles.find((role) => role.key === 'OWNER');
    const ownerHolders = hasApproverCapability(owner) ? actionable(owner) : [];
    let holders = actionable(selected!);
    let effectiveTaskRole = selected!.key;
    let ownerFallbackUsed = false;
    if (holders.length === 0 && selected!.key !== 'OWNER') {
      if (ownerHolders.length > 0) {
        holders = ownerHolders;
        effectiveTaskRole = 'OWNER';
        ownerFallbackUsed = true;
      }
    }
    // Stable ordering keeps the exact helper-task assignee deterministic across retries even if
    // the database returns membership joins in a different physical order.
    const recipientUserIds = [...new Set(holders.map((holder) => holder.userId!).filter(Boolean))].sort();
    if (recipientUserIds.length === 0) throw new BadRequestException('reimbursement_approver_not_ready');
    return {
      responsibilityRole: selected!.key,
      effectiveTaskRole,
      recipientUserIds,
      ownerRecipientUserIds: [...new Set(ownerHolders.map((holder) => holder.userId!).filter(Boolean))].sort(),
      ownerFallbackUsed,
    };
  }

  async resolveNamedSubmissionRoute(input: {
    companyId: string;
    userId: string;
    branchId?: string;
    requesterUserId: string;
    allowSelfApproval: boolean;
    fallbackRole: string;
  }): Promise<ReimbursementSubmissionRoute | null> {
    const [membership, entitled] = await Promise.all([
      this.prisma.client.companyMembership.findFirst({
        where: { companyId: input.companyId, userId: input.userId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
        select: {
          userId: true, branchScopeMode: true, defaultBranchId: true,
          branchScopes: { select: { branchId: true } },
          roles: { where: { role: { status: 'ACTIVE' } }, select: {
            role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } },
          } },
        },
      }),
      loadEntitledFeatureKeys(this.prisma, input.companyId),
    ]);
    if (!membership) return null;
    const permissions = filterPermissionsByEntitlement(
      [...new Set(membership.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)))],
      entitled,
    );
    const holder: ApproverHolder = {
      userId: membership.userId,
      roleKeys: membership.roles.map(({ role }) => role.key),
      branchScopeMode: membership.branchScopeMode,
      defaultBranchId: membership.defaultBranchId,
      branchIds: membership.branchScopes.map((scope) => scope.branchId),
    };
    if (!REQUIRED_APPROVER_PERMISSIONS.every((permission) => permissions.includes(permission))
      || !holderCoversRequest(holder, input.branchId)
      || isSelfApproval(input.requesterUserId, input.userId, input.allowSelfApproval, holder.roleKeys)) {
      return null;
    }
    return {
      responsibilityRole: input.fallbackRole,
      effectiveTaskRole: input.fallbackRole,
      recipientUserIds: [input.userId],
      ownerRecipientUserIds: [],
      ownerFallbackUsed: false,
    };
  }

  private async loadCandidates(companyId: string): Promise<{ roles: ApproverRoleCandidate[]; branches: ActiveBranch[] }> {
    const [rows, branches, entitled] = await Promise.all([
      this.prisma.client.role.findMany({
        where: { OR: [{ scopeKey: 'system' }, { scopeKey: companyId }] },
        select: {
          key: true, name: true, scopeKey: true, status: true,
          permissions: { select: { permission: { select: { key: true } } } },
          memberships: {
            where: { membership: { companyId, status: 'ACTIVE', user: { status: 'ACTIVE' } } },
            select: { membership: { select: {
              userId: true,
              branchScopeMode: true,
              defaultBranchId: true,
              branchScopes: { select: { branchId: true } },
              roles: { select: { role: { select: { key: true, status: true } } } },
            } } },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.client.branch.findMany({ where: { companyId, status: 'ACTIVE' }, select: { id: true, name: true } }),
      loadEntitledFeatureKeys(this.prisma, companyId),
    ]);
    const overriddenKeys = new Set(rows.filter((role) => role.scopeKey === companyId).map((role) => role.key));
    return {
      roles: rows
        .filter((role) => !(role.scopeKey === 'system' && overriddenKeys.has(role.key)))
        .map((role) => ({
          key: role.key,
          name: role.name,
          status: role.status,
          permissionKeys: filterPermissionsByEntitlement(role.permissions.map((item) => item.permission.key), entitled),
          holders: role.memberships.map(({ membership }) => ({
            userId: membership.userId,
            roleKeys: membership.roles.filter(({ role }) => role.status === 'ACTIVE').map(({ role }) => role.key),
            branchScopeMode: membership.branchScopeMode,
            defaultBranchId: membership.defaultBranchId,
            branchIds: membership.branchScopes.map((scope) => scope.branchId),
          })),
        })),
      branches,
    };
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
    private readonly approverOptions: ListReimbursementApproverOptionsUseCase,
  ) {}

  async execute(ctx: RequestContext, input: UpdateReimbursementPolicyInput): Promise<ReimbursementPolicySummary> {
    if (!ctx.permissions.includes('reimbursement.policy.manage')) {
      throw new ForbiddenException('Missing permission: reimbursement.policy.manage');
    }
    // Validation
    if (input.duplicatePolicy && !DUP_POLICIES.includes(input.duplicatePolicy)) {
      throw new BadRequestException('invalid_duplicate_policy');
    }
    if (input.approvalRequiredFromAmount !== undefined && !d(input.approvalRequiredFromAmount).gte(0)) {
      throw new BadRequestException('invalid_threshold');
    }
    if (input.slaHours !== undefined && input.slaHours !== null && input.slaHours < 0) {
      throw new BadRequestException('invalid_sla_hours');
    }

    const existing = await this.repo.findPolicy(ctx.companyId, null);
    const nextStatus = input.status ?? existing?.status ?? 'ACTIVE';
    const data: Record<string, unknown> = {};
    if (input.approvalRequiredFromAmount !== undefined) {
      data.approvalRequiredFromAmount = input.approvalRequiredFromAmount;
      data.approvalThresholdAmount = input.approvalRequiredFromAmount;
    }
    if (input.defaultApproverRole !== undefined) {
      const roleKey = input.defaultApproverRole?.trim();
      if (!roleKey) throw new BadRequestException('approver_role_required');
      const option = (await this.approverOptions.load(ctx.companyId)).find((item) => item.key === roleKey);
      if (!option?.selectable) throw new BadRequestException('approver_role_not_eligible');
      data.defaultApproverRole = roleKey;
      data.approverMode = approverModeForRole(roleKey);
      data.defaultApproverUserId = null;
    } else if (nextStatus === 'ACTIVE') {
      const currentMode = existing?.approverMode ?? REIMBURSEMENT_POLICY_DEFAULTS.approverMode;
      const currentRole = existing?.defaultApproverRole ?? REIMBURSEMENT_POLICY_DEFAULTS.defaultApproverRole;
      const roleBased = ['MANAGER_ROLE', 'OWNER_ROLE', 'CUSTOM_ROLE'].includes(currentMode);
      if (roleBased) {
        const option = (await this.approverOptions.load(ctx.companyId)).find((item) => item.key === currentRole);
        if (!option?.selectable) throw new BadRequestException('reimbursement_approver_not_ready');
      } else if (currentMode === 'CUSTOM_USER') {
        const userId = existing?.defaultApproverUserId;
        const active = await this.repo.findActiveApproverUserIds(ctx.companyId, userId ? [userId] : []);
        if (!userId || !active.has(userId)) {
          throw new BadRequestException('reimbursement_approver_not_ready');
        }
      }
    }
    if (input.allowSelfApproval !== undefined) data.allowSelfApproval = input.allowSelfApproval;
    if (input.requireReceipt !== undefined) data.requireReceipt = input.requireReceipt;
    if (input.allowMissingReceiptWithReason !== undefined) data.allowMissingReceiptWithReason = input.allowMissingReceiptWithReason;
    if (input.duplicatePolicy !== undefined) data.duplicatePolicy = input.duplicatePolicy;
    if (input.financeReviewRequired !== undefined) data.financeReviewRequired = input.financeReviewRequired;
    if (input.slaHours !== undefined) data.slaHours = input.slaHours;
    if (input.status !== undefined) data.status = input.status;

    const expectedUpdatedAt = input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : undefined;
    const policy = await this.repo.upsertPolicy(ctx.companyId, null, data, ctx.userId, expectedUpdatedAt, async (tx, before, after) => {
      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.policy.update',
        targetType: 'reimbursement_policy', targetId: after.id, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: {
          before: before ? {
            approverMode: before.approverMode, defaultApproverRole: before.defaultApproverRole,
            approvalRequiredFromAmount: before.approvalRequiredFromAmount, status: before.status,
            financeReviewRequired: before.financeReviewRequired, allowSelfApproval: before.allowSelfApproval,
            duplicatePolicy: before.duplicatePolicy, slaHours: before.slaHours,
          } : null,
          after: {
            approverMode: after.approverMode, defaultApproverRole: after.defaultApproverRole,
            approvalRequiredFromAmount: after.approvalRequiredFromAmount, status: after.status,
            financeReviewRequired: after.financeReviewRequired, allowSelfApproval: after.allowSelfApproval,
            duplicatePolicy: after.duplicatePolicy, slaHours: after.slaHours,
          },
        },
      }, tx);
      const occurredAt = new Date().toISOString();
      await tx.outboxEvent.createMany({
        data: [{
          companyId: ctx.companyId,
          eventType: 'reimbursement.policy_updated',
          aggregateType: 'reimbursement_policy',
          aggregateId: after.id,
          eventKey: `reimbursement.policy_updated:reimbursement_policy:${after.id}:${ctx.requestId ?? after.updatedAt.toISOString()}`,
          payloadJson: {
            companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
            aggregateType: 'reimbursement_policy', aggregateId: after.id, occurredAt,
            data: { status: after.status },
          },
          priority: 'NORMAL',
          status: 'PENDING',
        }],
        skipDuplicates: true,
      });
    });
    return toPolicySummary(policy);
  }
}
