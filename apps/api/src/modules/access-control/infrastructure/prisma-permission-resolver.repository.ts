import { PERMISSIONS } from '../../auth/permission-registry';
import { freeExpenseDraftPermissions, isFreeExpenseDraftCompany } from '../../system-partner-management/application/free-expense-access';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { resolveBranchIds } from '../../data-model-core/domain/logic/branch.logic';
import { loadEntitledFeatureKeys } from '../../employee-access/application/entitlement.helper';
import { featureKeyDeniedByEntitlement, filterPermissionsByEntitlement } from '../../employee-access/domain/logic/feature-gate.logic';
import type { IPermissionResolverPort, ResolvedAccess, ResolvePermissionsInput } from '../domain/ports/permission-resolver.port';

@Injectable()
export class PrismaPermissionResolverRepository implements IPermissionResolverPort {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForUser(input: ResolvePermissionsInput): Promise<ResolvedAccess> {
    const { userId, companyId } = input;

    const membershipInclude = {
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
        branchScopes: { select: { branchId: true } },
        company: { select: { status: true, reportClassification: true, planTerm: { select: { termDisabledAt: true, termEndsAt: true } } } },
      },
    } as const;

    const membership = companyId
      ? await this.prisma.client.companyMembership.findFirst({
          where: { userId, companyId, status: 'ACTIVE' },
          ...membershipInclude,
        })
      // No companyId asked for: pick a membership the user can actually use. Inactive
      // companies are skipped here rather than picked and then rejected below, so one
      // suspended company cannot shadow the user's remaining active memberships.
      : await this.prisma.client.companyMembership.findFirst({
          where: {
            userId,
            status: 'ACTIVE',
            company: { status: 'ACTIVE' },
            roles: { some: { role: { key: 'SYSTEM_ADMIN', status: 'ACTIVE' } } },
          },
          ...membershipInclude,
        }) ?? await this.prisma.client.companyMembership.findFirst({
          where: { userId, status: 'ACTIVE', company: { status: 'ACTIVE' } },
          ...membershipInclude,
          orderBy: { createdAt: 'asc' },
        }) ?? await this.prisma.client.companyMembership.findFirst({
          where: { userId, status: 'ACTIVE', company: { status: 'DISABLED', planTerm: { termDisabledAt: { not: null } } } },
          ...membershipInclude, orderBy: { createdAt: 'asc' },
        });

    if (!membership) {
      const disabledMembership = companyId && await this.prisma.client.companyMembership.findFirst({ where: { userId, companyId, status: { in: ['DISABLED', 'SUSPENDED'] } }, select: { id: true } });
      if (disabledMembership) throw new ForbiddenException({ code: 'company_membership_disabled', message: 'Shop membership is disabled.' });
      throw new ForbiddenException('No active company membership.');
    }

    const systemAdmin = membership.roles.some(link => link.role.status === 'ACTIVE' && link.role.key === 'SYSTEM_ADMIN');
    const freeExpenseDrafts = !systemAdmin && await isFreeExpenseDraftCompany(this.prisma.client, membership.companyId);
    const isTermDisabled = membership.company.status === 'DISABLED' && Boolean(membership.company.planTerm?.termDisabledAt);
    const termRecovery = input.allowTermRecovery && isTermDisabled;
    if (membership.company.status !== 'ACTIVE' && !termRecovery && !freeExpenseDrafts) {
      // Sales/locked-signup spec §19: every non-recovery caller routes through this one gate, so
      // naming the reason here (rather than per-route) lets the web's authedApiFetch bounce a stale
      // tab or deep link to /renew instead of showing a dead-end 403. A DISABLED company that is NOT
      // term-disabled (a manual admin suspension) keeps the plain, non-actionable message.
      if (isTermDisabled) {
        throw new ForbiddenException({ code: 'company_term_expired', message: 'Company is not active.' });
      }
      throw new ForbiddenException('Company is not active.');
    }

    // A suspended/draft membership can retain a role that was disabled before reactivation.
    // Only current ACTIVE roles may authorize web, admin console or LINE tools.
    const activeRoles = membership.roles.filter((mr) => mr.role.status === 'ACTIVE');
    const roles = activeRoles.map((mr) => mr.role.key);
    const grantedPermissions = [
      ...new Set(
        activeRoles.flatMap((mr) =>
          mr.role.permissions.map((rp) => rp.permission.key),
        ),
      ),
    ];
    // Item 10A AC-FE-2: permissions of features the company has not enabled are stripped here,
    // so every downstream consumer (API guards, workspace nav, LINE AI tools) denies/hides
    // together. Companies with no entitlement rows at all remain legacy fail-open.
    const entitled = await loadEntitledFeatureKeys(this.prisma, membership.companyId);
    const permissions = filterPermissionsByEntitlement(grantedPermissions, entitled);
    const entitlementDeniedPermissions = Object.fromEntries(
      grantedPermissions.flatMap((permission) => {
        const featureKey = featureKeyDeniedByEntitlement(permission, entitled);
        return featureKey ? [[permission, featureKey]] : [];
      }),
    );

    const scopedBranchIds = membership.branchScopes.map((scope) => scope.branchId);
    const activeScopedBranches = scopedBranchIds.length === 0
      ? []
      : await this.prisma.client.branch.findMany({
          where: { companyId: membership.companyId, id: { in: scopedBranchIds }, status: 'ACTIVE' },
          select: { id: true },
        });
    const selectedBranchIds = activeScopedBranches.map((branch) => branch.id);

    if (membership.branchScopeMode === 'SELECTED_BRANCHES' && selectedBranchIds.length === 0) {
      throw new ForbiddenException('No active branch scope assigned.');
    }

    const branchIds = resolveBranchIds(
      membership.branchScopeMode,
      selectedBranchIds,
      membership.defaultBranchId ?? undefined,
    );

    // Default branch first, so scoped create paths can tag branchIds[0] deterministically.
    if (branchIds && membership.defaultBranchId && branchIds.includes(membership.defaultBranchId)) {
      branchIds.sort((a, b) => (a === membership.defaultBranchId ? -1 : b === membership.defaultBranchId ? 1 : 0));
    }

    return {
      membershipId: membership.id,
      companyId: membership.companyId,
      roles,
      permissions: freeExpenseDrafts && !roles.includes('SYSTEM_ADMIN') ? freeExpenseDraftPermissions(permissions) : permissions,
      ...(membership.company.reportClassification === 'DEMO' ? { isDemo: true, demoExpiresAt: membership.company.planTerm?.termEndsAt.toISOString() } : {}),
      ...(freeExpenseDrafts ? { freeExpenseDrafts: true } : {}),
      entitlementDeniedPermissions,
      availablePermissions: filterPermissionsByEntitlement(PERMISSIONS.map(permission => permission.key), entitled),
      entitledFeatureKeys: entitled === null ? null : [...entitled],
      scopes: branchIds === undefined ? {} : { branchIds },
    };
  }
}
