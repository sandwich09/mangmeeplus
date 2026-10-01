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
  /** The requester is the only person who could approve, so the step is theirs (owner order 2026-09-21). */
  soloSelfApproval?: true;
};

export type ReimbursementSubmissionRouteInput = {
  roleKey: string;
  /** Policy roles, first = `roleKey`; absent on re-reads of a submitted claim, which keeps one role. */
  roleKeys?: string[];
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
        // After the same entitlement cut as the approve keys above: what a holder of this role can do at the payment step.
        canRecordPayment: role.permissionKeys.includes('reimbursement.payment.record'),
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

  /** Submit only: the solo exemption is decided here and frozen on the claim, never by a later re-read. */
  async resolveSubmissionRoute(input: {
    companyId: string;
  } & ReimbursementSubmissionRouteInput): Promise<ReimbursementSubmissionRoute> {
    const { roles } = await this.loadCandidates(input.companyId);
    return this.resolveFromCandidates(roles, input, true);
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

  /**
   * Who would approve this claim under the policy. A claim that needed no approval has no approver
   * of its own, so these are the people asked to record its payment (owner rule 2026-10-01).
   * Read-only and best effort like the scans above: nobody is an answer here, never an error.
   */
  async resolveWouldBeApproverUserIds(
    companyId: string,
    policy: { approverMode?: string; defaultApproverUserId?: string; defaultApproverRole?: string; defaultApproverRoles?: string[]; allowSelfApproval: boolean },
    claim: { branchId?: string | null; requesterUserId: string },
  ): Promise<string[]> {
    const input = { ...(claim.branchId && { branchId: claim.branchId }), requesterUserId: claim.requesterUserId, allowSelfApproval: policy.allowSelfApproval };
    const roleKey = policy.defaultApproverRole ?? 'MANAGER';
    try {
      const named = policy.approverMode === 'CUSTOM_USER' && policy.defaultApproverUserId
        ? await this.resolveNamedSubmissionRoute({ companyId, userId: policy.defaultApproverUserId, fallbackRole: roleKey, ...input })
        : null;
      const [route] = named ? [named] : await this.resolveSubmissionRoutesBestEffort(companyId, [{ roleKey, roleKeys: policy.defaultApproverRoles, ...input }]);
      return route?.recipientUserIds ?? [];
    } catch (error) {
      if (error instanceof BadRequestException) return [];
      throw error;
    }
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
    soloExemption = false,
  ): ReimbursementSubmissionRoute {
    // Holders of any policy role may decide. A role that can no longer approve adds nobody; the
    // route is refused only when none of them can.
    const selectedRoles = (input.roleKeys?.length ? input.roleKeys : [input.roleKey])
      .filter((key) => !['SYSTEM_ADMIN', 'COMPANY_VIEW'].includes(key))
      .map((key) => roles.find((role) => role.key === key))
      .filter(hasApproverCapability);
    const selected = selectedRoles[0];
    if (!selected) throw new BadRequestException('approver_role_not_eligible');
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
    let holders = selectedRoles.flatMap(actionable);
    let effectiveTaskRole = selected.key;
    let ownerFallbackUsed = false;
    if (holders.length === 0 && !selectedRoles.some((role) => role.key === 'OWNER')) {
      if (ownerHolders.length > 0) {
        holders = ownerHolders;
        effectiveTaskRole = 'OWNER';
        ownerFallbackUsed = true;
      }
    }
    // Stable ordering keeps the exact helper-task assignee deterministic across retries even if
    // the database returns membership joins in a different physical order.
    let recipientUserIds = [...new Set(holders.map((holder) => holder.userId!).filter(Boolean))].sort();
    // Owner order 2026-09-21 ("ผู้ใช้คนเดียวที่กำหนดบทบาทเอง ต้องทำได้นะ"): nobody is left only because
    // the requester was dropped above as a self-approver, so the step goes back to them instead of
    // dead-ending. Anyone else eligible — another holder or the OWNER fallback — still decides first.
    // An OWNER holder is exempt and never dropped, so the routed role is the only place to look.
    const soloSelfApproval = soloExemption && recipientUserIds.length === 0
      && selectedRoles.some((role) => role.holders.some((holder) => holder.userId === input.requesterUserId && holderCoversRequest(holder, input.branchId)));
    if (soloSelfApproval) recipientUserIds = [input.requesterUserId];
    if (recipientUserIds.length === 0) throw new BadRequestException('reimbursement_approver_not_ready');
    return {
      responsibilityRole: selected.key,
      effectiveTaskRole,
      recipientUserIds,
      ownerRecipientUserIds: [...new Set(ownerHolders.map((holder) => holder.userId!).filter(Boolean))].sort(),
      ownerFallbackUsed,
      ...(soloSelfApproval && { soloSelfApproval }),
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
      || !holderCoversRequest(holder, input.branchId)) {
      return null;
    }
    const soloSelfApproval = isSelfApproval(input.requesterUserId, input.userId, input.allowSelfApproval, holder.roleKeys);
    if (soloSelfApproval) {
      // Owner order 2026-09-21: the named approver filed this claim. Whoever the role route still
      // finds decides it (the caller falls through to that route); only when it finds nobody does
      // the named approver approve their own claim instead of the claim dead-ending.
      try {
        this.resolveFromCandidates((await this.loadCandidates(input.companyId)).roles, { ...input, roleKey: input.fallbackRole });
        return null;
      } catch (error) {
        if (!(error instanceof BadRequestException) || error.message !== 'reimbursement_approver_not_ready') throw error;
      }
    }
    return {
      responsibilityRole: input.fallbackRole,
      effectiveTaskRole: input.fallbackRole,
      recipientUserIds: [input.userId],
      ownerRecipientUserIds: [],
      ownerFallbackUsed: false,
      ...(soloSelfApproval && { soloSelfApproval }),
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
      defaultApproverRoles: REIMBURSEMENT_POLICY_DEFAULTS.defaultApproverRoles,
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
    const allSelectable = async (roleKeys: string[]) => {
      const options = await this.approverOptions.load(ctx.companyId);
      return roleKeys.length > 0 && roleKeys.every((key) => options.find((item) => item.key === key)?.selectable);
    };
    if (input.defaultApproverRoles !== undefined) {
      const roleKeys = [...new Set(input.defaultApproverRoles.map((key) => key.trim()).filter(Boolean))];
      if (roleKeys.length === 0) throw new BadRequestException('approver_role_required');
      if (!await allSelectable(roleKeys)) throw new BadRequestException('approver_role_not_eligible');
      data.defaultApproverRoles = roleKeys;
      data.defaultApproverRole = roleKeys[0];
      data.approverMode = approverModeForRole(roleKeys[0]!);
      data.defaultApproverUserId = null;
    } else if (nextStatus === 'ACTIVE') {
      const currentMode = existing?.approverMode ?? REIMBURSEMENT_POLICY_DEFAULTS.approverMode;
      const currentRoles = existing?.defaultApproverRoles ?? REIMBURSEMENT_POLICY_DEFAULTS.defaultApproverRoles ?? [];
      const roleBased = ['MANAGER_ROLE', 'OWNER_ROLE', 'CUSTOM_ROLE'].includes(currentMode);
      if (roleBased) {
        if (!await allSelectable(currentRoles)) throw new BadRequestException('reimbursement_approver_not_ready');
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
            defaultApproverRoles: before.defaultApproverRoles,
            approvalRequiredFromAmount: before.approvalRequiredFromAmount, status: before.status,
            financeReviewRequired: before.financeReviewRequired, allowSelfApproval: before.allowSelfApproval,
            duplicatePolicy: before.duplicatePolicy, slaHours: before.slaHours,
          } : null,
          after: {
            approverMode: after.approverMode, defaultApproverRole: after.defaultApproverRole,
            defaultApproverRoles: after.defaultApproverRoles,
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
