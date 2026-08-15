import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EmployeeDetail, UpdateEmployeeInput } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { EMPLOYEE_PROFILE_INCLUDE, toEmployeeSummary } from '../dto/employee-access.mapper';
import {
  ALL_BRANCH_ROLE_KEYS,
  NON_ASSIGNABLE_ROLE_KEYS,
  hashIdentityNumber,
  identityLast4,
  normalizeIdentityNumber,
  roleGrantViolation,
} from '../../domain/logic/employee-access.logic';
import { encryptCredential } from '../../../system-partner-management/domain/logic/credential-cipher.logic';

export type UpdateEmployeeCommand = UpdateEmployeeInput & {
  companyId: string;
  employeeId: string;
  requestingUserId: string;
  requesterPermissions: string[];
  requesterRoles?: string[];
  requestId: string;
};

@Injectable()
export class UpdateEmployeeUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: UpdateEmployeeCommand): Promise<EmployeeDetail> {
    const existing = await this.prisma.client.employeeAccessProfile.findFirst({
      where: { id: cmd.employeeId, companyId: cmd.companyId },
    });
    if (!existing) throw new NotFoundException('Employee not found');

    let roles: Array<{ id: string; key: string }> | undefined;
    let previousRoleIds: string[] = [];
    if (cmd.roleIds) {
      if (!cmd.roleIds.length) throw new ForbiddenException('At least one role is required.');
      const targetRoles = await this.prisma.client.membershipRole.findMany({
        where: { membershipId: existing.membershipId },
        select: { roleId: true, role: { select: { key: true } } },
      });
      if (targetRoles.some((mr) => NON_ASSIGNABLE_ROLE_KEYS.includes(mr.role.key))) {
        throw new ForbiddenException('OWNER and SYSTEM_ADMIN role assignments cannot be changed here.');
      }
      previousRoleIds = targetRoles.map((mr) => mr.roleId);
      const roleChanged = cmd.roleIds.some((id) => !previousRoleIds.includes(id))
        || previousRoleIds.some((id) => !cmd.roleIds!.includes(id));
      if (roleChanged) {
        if (existing.userId === cmd.requestingUserId) {
          await this.auditDeniedRoleGrant(cmd, existing.userId, 'Users cannot change their own role assignment.');
          throw new ForbiddenException('Users cannot change their own role assignment.');
        }
        const candidates = await this.prisma.client.role.findMany({
          where: { id: { in: cmd.roleIds }, status: 'ACTIVE', OR: [{ scopeKey: 'system' }, { scopeKey: cmd.companyId }] },
          select: { id: true, key: true, permissions: { select: { permission: { select: { key: true } } } } },
        });
        if (candidates.length !== cmd.roleIds.length) throw new ForbiddenException('One or more roles are invalid.');
        const violation = roleGrantViolation(
          candidates.map((role) => ({ key: role.key, permissionKeys: role.permissions.map((rp) => rp.permission.key) })),
          cmd.requesterPermissions,
          cmd.requesterRoles?.includes('OWNER'),
        );
        if (violation) {
          await this.auditDeniedRoleGrant(cmd, existing.userId, violation);
          throw new ForbiddenException(violation);
        }
        roles = candidates.map((r) => ({ id: r.id, key: r.key }));
      }
    }

    if (cmd.phoneNumber && cmd.phoneNumber !== existing.phoneNumber) {
      const duplicatePhone = await this.prisma.client.employeeAccessProfile.findFirst({
        where: { companyId: cmd.companyId, phoneNumber: cmd.phoneNumber, id: { not: cmd.employeeId } },
      });
      if (duplicatePhone) throw new ConflictException('An employee with this phone number already exists.');
    }

    // A user shared with another company (an attached cross-company employee) keeps their own login
    // email on User; this company's email lives on the profile instead, must differ from that login
    // email, and is not globally unique. A company-local user keeps the original email-on-User rules.
    let sharedUser = false;
    if (cmd.email || cmd.displayName) {
      sharedUser =
        (await this.prisma.client.companyMembership.count({
          where: { userId: existing.userId, companyId: { not: cmd.companyId } },
        })) > 0;
    }
    if (cmd.email) {
      if (sharedUser) {
        const account = await this.prisma.client.user.findUnique({
          where: { id: existing.userId },
          select: { email: true },
        });
        if (cmd.email.trim().toLowerCase() === (account?.email ?? '').toLowerCase()) {
          throw new ConflictException({ code: 'employee_email_must_differ', message: 'Provide a company email for this employee that differs from their existing account email.' });
        }
      } else {
        const duplicateEmail = await this.prisma.client.user.findFirst({
          where: { email: cmd.email, id: { not: existing.userId } },
        });
        if (duplicateEmail) throw new ConflictException('A user with this email already exists.');
      }
    }

    let identityData: {
      identityType: 'THAI_NATIONAL_ID' | 'PASSPORT';
      identityLast4: string;
      identityHash: string;
      identityEncryptedRef: string;
    } | undefined;
    if (cmd.identityNumber) {
      const key = this.config.credentialEncryptionKey;
      const identityHash = hashIdentityNumber(cmd.identityNumber, key);
      const duplicateIdentity = await this.prisma.client.employeeAccessProfile.findFirst({
        where: { companyId: cmd.companyId, identityHash, id: { not: cmd.employeeId } },
      });
      if (duplicateIdentity) throw new ConflictException('An employee with this ID/passport already exists.');
      identityData = {
        identityType: cmd.identityType ?? existing.identityType,
        identityLast4: identityLast4(cmd.identityNumber),
        identityHash,
        identityEncryptedRef: encryptCredential(normalizeIdentityNumber(cmd.identityNumber), key),
      };
    }

    // 10D branch scope assignment: validate referenced branches belong to this company and are ACTIVE.
    const scopeTouched = cmd.branchScopeMode !== undefined || cmd.branchIds !== undefined || cmd.defaultBranchId !== undefined;
    // R8: this write hands the membership an oversight role, which must hold every branch.
    const assignsAllBranchRole = roles?.some((role) => ALL_BRANCH_ROLE_KEYS.includes(role.key)) ?? false;
    let widenToAllBranches = false;
    if (scopeTouched || assignsAllBranchRole) {
      const membership = await this.prisma.client.companyMembership.findUniqueOrThrow({
        where: { id: existing.membershipId },
        select: { branchScopeMode: true, defaultBranchId: true },
      });
      const mode = cmd.branchScopeMode ?? membership.branchScopeMode;
      const defaultBranchId = cmd.defaultBranchId === undefined ? membership.defaultBranchId : cmd.defaultBranchId;
      const referenced = [...new Set([...(cmd.branchIds ?? []), ...(defaultBranchId ? [defaultBranchId] : [])])];
      if (scopeTouched) {
        if (referenced.length > 0) {
          const valid = await this.prisma.client.branch.count({
            where: { companyId: cmd.companyId, id: { in: referenced }, status: 'ACTIVE' },
          });
          if (valid !== referenced.length) throw new ForbiddenException('One or more branches are invalid for this company.');
        }
        if (mode === 'SELECTED_BRANCHES') {
          // Final scope-row set must stay non-empty, or the resolver locks this employee out entirely.
          const finalCount = cmd.branchIds !== undefined
            ? cmd.branchIds.length
            : await this.prisma.client.membershipBranchScope.count({ where: { membershipId: existing.membershipId } });
          if (finalCount === 0) throw new ForbiddenException('SELECTED_BRANCHES requires at least one branch.');
        }
        if (mode === 'DEFAULT_BRANCH_ONLY' && !defaultBranchId) {
          throw new ForbiddenException('DEFAULT_BRANCH_ONLY requires a default branch.');
        }
      }
      // R8 guardrail: an oversight role may not end this write on a narrowed scope. A caller that
      // states a narrowing is rejected; a plain role assignment widens instead, in the transaction
      // below. Enforced here rather than in the resolver so MembershipBranchScope stays truthful.
      if (mode !== 'ALL_BRANCHES') {
        // `roles` is undefined when roleIds arrived unchanged, so fall back to what the membership holds.
        const finalRoleKeys = roles?.map((role) => role.key) ?? (await this.prisma.client.membershipRole.findMany({
          where: { membershipId: existing.membershipId },
          select: { role: { select: { key: true } } },
        })).map((mr) => mr.role.key);
        const allBranchRole = finalRoleKeys.find((key) => ALL_BRANCH_ROLE_KEYS.includes(key));
        if (allBranchRole) {
          if (scopeTouched) throw new ForbiddenException(`Role ${allBranchRole} requires access to all branches.`);
          widenToAllBranches = true;
        }
      }
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.employeeAccessProfile.update({
        where: { id: cmd.employeeId },
        data: {
          displayName: cmd.displayName,
          titlePrefix: cmd.titlePrefix,
          legalName: cmd.legalName,
          firstName: cmd.firstName,
          lastName: cmd.lastName,
          nickname: cmd.nickname,
          dateOfBirth: cmd.dateOfBirth === undefined ? undefined : cmd.dateOfBirth ? new Date(cmd.dateOfBirth) : null,
          addressLine: cmd.addressLine,
          postalCode: cmd.postalCode,
          province: cmd.province,
          district: cmd.district,
          subdistrict: cmd.subdistrict,
          ...identityData,
          phoneNumber: cmd.phoneNumber,
          updatedByUserId: cmd.requestingUserId,
        },
      });

      if (cmd.email) {
        // Shared account → store on the profile (company-scoped); local user → keep email on User.
        if (sharedUser) {
          await tx.employeeAccessProfile.update({ where: { id: cmd.employeeId }, data: { email: cmd.email } });
        } else {
          await tx.user.update({ where: { id: existing.userId }, data: { email: cmd.email } });
        }
      }

      // The sidebar/header name comes from User via /auth/me, so a profile-only rename (e.g. a changed
      // title prefix) would stay stale everywhere outside this page. A shared login keeps its own
      // account name, same rule as email above.
      if (cmd.displayName && !sharedUser) {
        await tx.user.update({ where: { id: existing.userId }, data: { displayName: cmd.displayName } });
      }

      if (roles) {
        await tx.membershipRole.deleteMany({ where: { membershipId: existing.membershipId } });
        await tx.membershipRole.createMany({
          data: roles.map((role) => ({ membershipId: existing.membershipId, roleId: role.id })),
        });
      }

      if (widenToAllBranches) {
        // R8: same transaction as the role write above — split in two, a failure between them leaves
        // the oversight role pinned to one branch, the exact state this guardrail exists to prevent.
        await tx.companyMembership.update({
          where: { id: existing.membershipId },
          data: { branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null },
        });
        await tx.membershipBranchScope.deleteMany({ where: { membershipId: existing.membershipId } });
      } else if (scopeTouched) {
        await tx.companyMembership.update({
          where: { id: existing.membershipId },
          data: {
            ...(cmd.branchScopeMode !== undefined && { branchScopeMode: cmd.branchScopeMode }),
            ...(cmd.defaultBranchId !== undefined && { defaultBranchId: cmd.defaultBranchId }),
          },
        });
        if (cmd.branchIds !== undefined) {
          await tx.membershipBranchScope.deleteMany({ where: { membershipId: existing.membershipId } });
          if (cmd.branchIds.length > 0) {
            await tx.membershipBranchScope.createMany({
              data: cmd.branchIds.map((branchId) => ({ membershipId: existing.membershipId, branchId })),
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingUserId,
          action: roles ? AuditAction.ACCESS_EMPLOYEE_ROLE_ASSIGN : AuditAction.ACCESS_EMPLOYEE_UPDATE,
          targetType: 'EmployeeAccessProfile',
          targetId: cmd.employeeId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: scopeTouched || widenToAllBranches ? 'HIGH' : 'MEDIUM',
          metadataJson: {
            membershipId: existing.membershipId,
            ...(roles && {
              granterUserId: cmd.requestingUserId,
              granteeUserId: existing.userId,
              roleDiff: {
                addedRoleIds: roles.map((r) => r.id).filter((id) => !previousRoleIds.includes(id)),
                removedRoleIds: previousRoleIds.filter((id) => !roles.some((r) => r.id === id)),
              },
            }),
            ...(scopeTouched && {
              branchScopeMode: cmd.branchScopeMode,
              defaultBranchId: cmd.defaultBranchId,
              branchIds: cmd.branchIds,
            }),
            ...(widenToAllBranches && {
              branchScopeMode: 'ALL_BRANCHES',
              branchScopeWidenedForRole: roles!.find((role) => ALL_BRANCH_ROLE_KEYS.includes(role.key))!.key,
            }),
          },
        },
      });
    });

    const row = await this.prisma.client.employeeAccessProfile.findFirstOrThrow({
      where: { id: cmd.employeeId },
      include: EMPLOYEE_PROFILE_INCLUDE,
    });
    return toEmployeeSummary(row);
  }

  private auditDeniedRoleGrant(cmd: UpdateEmployeeCommand, granteeUserId: string, reason: string) {
    return this.prisma.client.auditLog.create({
      data: {
        companyId: cmd.companyId,
        actorUserId: cmd.requestingUserId,
        action: AuditAction.ACCESS_EMPLOYEE_ROLE_ASSIGN,
        targetType: 'EmployeeAccessProfile',
        targetId: cmd.employeeId,
        requestId: cmd.requestId,
        result: 'DENIED',
        riskLevel: 'HIGH',
        metadataJson: { granterUserId: cmd.requestingUserId, granteeUserId, attemptedRoleIds: cmd.roleIds, reason },
      },
    });
  }
}
