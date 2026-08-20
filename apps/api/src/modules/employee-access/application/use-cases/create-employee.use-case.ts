import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EmployeeCredentialHandoff } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import {
  ALL_BRANCH_ROLE_KEYS,
  buildLineLinkPackage,
  generateLineLinkToken,
  employeePasswordFromDateOfBirth,
  hashIdentityNumber,
  hashTemporaryPassword,
  identityLast4,
  normalizeIdentityNumber,
  roleGrantViolation,
} from '../../domain/logic/employee-access.logic';
import { encryptCredential } from '../../../system-partner-management/domain/logic/credential-cipher.logic';

export type CreateEmployeeCommand = {
  companyId: string;
  username: string;
  /** The name WITHOUT คำนำหน้า; the title travels in `titlePrefix`. */
  displayName: string;
  titlePrefix?: string;
  legalName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
  dateOfBirth: string;
  addressLine?: string;
  postalCode?: string;
  province?: string;
  district?: string;
  subdistrict?: string;
  identityType: 'THAI_NATIONAL_ID' | 'PASSPORT';
  identityNumber: string;
  phoneNumber: string;
  roleIds: string[];
  linkExistingUser?: boolean;
  requestingUserId: string;
  requesterPermissions: string[];
  requesterEntitlementDeniedPermissions?: Record<string, string>;
  requesterRoles?: string[];
  requestId: string;
  apiBaseUrl: string;
};

export type CreateEmployeeResult = { employeeId: string } & EmployeeCredentialHandoff;
export type CompleteEmployeeDraftResult = { employeeId: string; status: 'ACTIVE' };

const USERNAME_MAX_ATTEMPTS = 5;

// Stable conflict codes so the web client can show a field-specific message instead of a generic 409.
// Keep the code strings in sync with EMPLOYEE_CONFLICT_KEYS in the web AddEmployee wizard.
const IDENTITY_CONFLICT = { code: 'employee_identity_conflict', message: 'An employee with this ID/passport already exists.' };
const PHONE_CONFLICT = { code: 'employee_phone_conflict', message: 'An employee with this phone number already exists.' };
const EMAIL_CONFLICT = { code: 'employee_email_conflict', message: 'A user with this email already exists.' };
const USERNAME_CONFLICT = { code: 'employee_username_conflict', message: 'This username already exists.' };
// Not a hard failure: the username matches an existing account (e.g. an owner of another company).
// The client re-submits with linkExistingUser=true to attach a second membership to that account.
const EXISTING_USER_CONFLICT = { code: 'employee_existing_user', message: 'This username belongs to an existing account. Confirm to add them to this company with their existing login.' };
// A person attached from another account must be given a company email here that is not the login
// email of the account they already own — the two company contexts stay separately addressable.
const EMAIL_MUST_DIFFER = { code: 'employee_email_must_differ', message: 'Provide a company email for this employee that differs from their existing account email.' };

@Injectable()
export class CreateEmployeeUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: CreateEmployeeCommand): Promise<CreateEmployeeResult> {
    if (!cmd.roleIds.length) throw new ForbiddenException('At least one role is required.');

    const roles = await this.prisma.client.role.findMany({
      where: {
        id: { in: cmd.roleIds },
        status: 'ACTIVE',
        OR: [{ scopeKey: 'system' }, { scopeKey: cmd.companyId }],
      },
      select: { id: true, key: true, permissions: { select: { permission: { select: { key: true } } } } },
    });
    if (roles.length !== cmd.roleIds.length) throw new ForbiddenException('One or more roles are invalid.');
    const violation = roleGrantViolation(
      roles.map((role) => ({ key: role.key, permissionKeys: role.permissions.map((rp) => rp.permission.key) })),
      cmd.requesterPermissions,
      cmd.requesterEntitlementDeniedPermissions,
      cmd.requesterRoles?.includes('OWNER'),
    );
    if (violation) {
      await this.prisma.client.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingUserId,
          action: AuditAction.ACCESS_EMPLOYEE_ROLE_ASSIGN,
          targetType: 'CompanyMembership',
          requestId: cmd.requestId,
          result: 'DENIED',
          riskLevel: 'HIGH',
          metadataJson: { granterUserId: cmd.requestingUserId, attemptedRoleIds: cmd.roleIds, reason: violation },
        },
      });
      throw new ForbiddenException(violation);
    }

    const key = this.config.credentialEncryptionKey;
    const identityHash = hashIdentityNumber(cmd.identityNumber, key);
    const username = cmd.username.trim().toLowerCase();
    const last4 = identityLast4(cmd.identityNumber);
    const identityEncryptedRef = encryptCredential(normalizeIdentityNumber(cmd.identityNumber), key);

    const [duplicateIdentity, duplicatePhone] = await Promise.all([
      this.prisma.client.employeeAccessProfile.findFirst({
        where: { companyId: cmd.companyId, identityHash },
        include: { user: { select: { username: true } } },
      }),
      this.prisma.client.employeeAccessProfile.findFirst({ where: { companyId: cmd.companyId, phoneNumber: cmd.phoneNumber } }),
    ]);
    if (duplicateIdentity && duplicateIdentity.status !== 'DRAFT') throw new ConflictException(IDENTITY_CONFLICT);
    if (duplicatePhone && duplicatePhone.id !== duplicateIdentity?.id) throw new ConflictException(PHONE_CONFLICT);

    const employeePassword = employeePasswordFromDateOfBirth(cmd.dateOfBirth);
    const passwordHash = hashTemporaryPassword(employeePassword);
    const lineLinkToken = generateLineLinkToken();

    if (duplicateIdentity) {
      // An oversight role must hold every branch; resuming a draft is a role write onto a membership
      // whose scope a previous pass through the wizard may already have narrowed.
      const widenBranchScope = roles.some((role) => ALL_BRANCH_ROLE_KEYS.includes(role.key));
      const previousRoleIds = (await this.prisma.client.membershipRole.findMany({
        where: { membershipId: duplicateIdentity.membershipId },
        select: { roleId: true },
      })).map((row) => row.roleId);
      // A user attached from another company (see attachExistingUser) keeps their own login. When
      // their draft here is resumed, never overwrite the shared user row or reset its credential —
      // only re-sync this company's membership, roles, and profile.
      const reusedExistingUser =
        (await this.prisma.client.companyMembership.count({
          where: { userId: duplicateIdentity.userId, companyId: { not: cmd.companyId } },
        })) > 0;
      try {
        await this.prisma.client.$transaction(async (tx) => {
          if (!reusedExistingUser) {
            await tx.user.update({
              where: { id: duplicateIdentity.userId },
              data: { displayName: cmd.displayName, username, email: cmd.email, status: 'ACTIVE' },
            });
            await tx.userCredential.update({
              where: { userId: duplicateIdentity.userId },
              data: {
                passwordHash,
                status: 'ACTIVE',
                mustChangePassword: true,
                expiresAt: null,
                tempPasswordEncrypted: null,
              },
            });
          }
          await tx.companyMembership.update({
            where: { id: duplicateIdentity.membershipId },
            data: { status: 'DRAFT', ...(widenBranchScope && { branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null }) },
          });
          if (widenBranchScope) {
            // R8: the only create path that writes roles onto a membership an earlier pass may have
            // narrowed. Widen with the role write, not after it (spec branch-scope-visibility R8).
            await tx.membershipBranchScope.deleteMany({ where: { membershipId: duplicateIdentity.membershipId } });
          }
          await tx.membershipRole.deleteMany({ where: { membershipId: duplicateIdentity.membershipId } });
          await tx.membershipRole.createMany({
            data: roles.map((role) => ({ membershipId: duplicateIdentity.membershipId, roleId: role.id })),
          });
          await tx.employeeLineLinkToken.updateMany({
            where: { membershipId: duplicateIdentity.membershipId, status: 'PENDING' },
            data: { status: 'REVOKED' },
          });
          await tx.employeeLineLinkToken.create({
            data: {
              companyId: cmd.companyId,
              membershipId: duplicateIdentity.membershipId,
              userId: duplicateIdentity.userId,
              issuedByUserId: cmd.requestingUserId,
              tokenHash: lineLinkToken.tokenHash,
              expiresAt: lineLinkToken.expiresAt,
            },
          });
          await tx.employeeAccessProfile.update({
            where: { id: duplicateIdentity.id },
            data: {
              displayName: cmd.displayName,
              titlePrefix: cmd.titlePrefix,
              legalName: cmd.legalName,
              firstName: cmd.firstName,
              lastName: cmd.lastName,
              nickname: cmd.nickname,
              dateOfBirth: cmd.dateOfBirth ? new Date(cmd.dateOfBirth) : null,
              addressLine: cmd.addressLine,
              postalCode: cmd.postalCode,
              province: cmd.province,
              district: cmd.district,
              subdistrict: cmd.subdistrict,
              identityType: cmd.identityType,
              identityLast4: last4,
              identityEncryptedRef,
              phoneNumber: cmd.phoneNumber,
              status: 'DRAFT',
              updatedByUserId: cmd.requestingUserId,
            },
          });
          await tx.auditLog.create({
            data: {
              companyId: cmd.companyId,
              actorUserId: cmd.requestingUserId,
              action: AuditAction.ACCESS_EMPLOYEE_ROLE_ASSIGN,
              targetType: 'EmployeeAccessProfile',
              targetId: duplicateIdentity.id,
              requestId: cmd.requestId,
              result: 'SUCCESS',
              riskLevel: 'HIGH',
              metadataJson: {
                membershipId: duplicateIdentity.membershipId,
                granterUserId: cmd.requestingUserId,
                granteeUserId: duplicateIdentity.userId,
                roleDiff: {
                  addedRoleIds: roles.map((r) => r.id).filter((id) => !previousRoleIds.includes(id)),
                  removedRoleIds: previousRoleIds.filter((id) => !roles.some((role) => role.id === id)),
                },
                resumedDraft: true,
                reusedExistingUser,
                ...(widenBranchScope && { branchScopeMode: 'ALL_BRANCHES', branchScopeWidenedForRole: roles.find((role) => ALL_BRANCH_ROLE_KEYS.includes(role.key))!.key }),
              },
            },
          });
        });
      } catch (err) {
        if (uniqueConstraintTarget(err)?.some((f) => f === 'phoneNumber')) throw new ConflictException(PHONE_CONFLICT);
        if (uniqueConstraintTarget(err)?.some((f) => f === 'email')) throw new ConflictException(EMAIL_CONFLICT);
        if (uniqueConstraintTarget(err)?.some((f) => f === 'username')) throw new ConflictException(USERNAME_CONFLICT);
        throw err;
      }

      return {
        employeeId: duplicateIdentity.id,
        userId: duplicateIdentity.userId,
        username: duplicateIdentity.user.username ?? '',
        temporaryPassword: reusedExistingUser ? '' : employeePassword,
        mustChangePassword: !reusedExistingUser,
        ...(reusedExistingUser && { reusedExistingAccount: true }),
        lineLink: buildLineLinkPackage(cmd.apiBaseUrl, lineLinkToken.rawToken, lineLinkToken.expiresAt, this.config.lineLiffId),
      };
    }

    // Cross-company reuse: when the chosen username already belongs to an active account
    // (e.g. the owner of another company), attach a new membership to THAT user instead of
    // creating a duplicate login. Gated behind linkExistingUser so the owner confirms the link
    // first — the existing credential, username, and email are never touched.
    const existingUser = await this.prisma.client.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true, username: true, status: true, email: true },
    });
    if (existingUser && existingUser.status === 'ACTIVE') {
      if (!cmd.linkExistingUser) throw new ConflictException(EXISTING_USER_CONFLICT);
      // The employee must be addressable in this company by an email of its own, never the login
      // email of the account they already hold elsewhere.
      const companyEmail = cmd.email?.trim();
      if (!companyEmail || companyEmail.toLowerCase() === (existingUser.email ?? '').toLowerCase()) {
        throw new ConflictException(EMAIL_MUST_DIFFER);
      }
      return this.attachExistingUser(cmd, {
        userId: existingUser.id,
        username: existingUser.username ?? username,
        companyEmail,
        roles,
        identityHash,
        identityLast4: last4,
        identityEncryptedRef,
        lineLinkToken,
      });
    }

    for (let attempt = 0; attempt < USERNAME_MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.prisma.client.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: { displayName: cmd.displayName, username, email: cmd.email, status: 'ACTIVE' },
          });

          await tx.userCredential.create({
            data: {
              userId: user.id,
              passwordHash,
              status: 'ACTIVE',
              mustChangePassword: true,
              expiresAt: null,
              tempPasswordEncrypted: null,
            },
          });

          const membership = await tx.companyMembership.create({
            data: { companyId: cmd.companyId, userId: user.id, status: 'DRAFT' },
          });

          await tx.membershipRole.createMany({
            data: roles.map((role) => ({ membershipId: membership.id, roleId: role.id })),
          });

          await tx.employeeLineLinkToken.create({
            data: {
              companyId: cmd.companyId,
              membershipId: membership.id,
              userId: user.id,
              issuedByUserId: cmd.requestingUserId,
              tokenHash: lineLinkToken.tokenHash,
              expiresAt: lineLinkToken.expiresAt,
            },
          });

          const profile = await tx.employeeAccessProfile.create({
            data: {
              companyId: cmd.companyId,
              userId: user.id,
              membershipId: membership.id,
              displayName: cmd.displayName,
              titlePrefix: cmd.titlePrefix,
              legalName: cmd.legalName,
              firstName: cmd.firstName,
              lastName: cmd.lastName,
              nickname: cmd.nickname,
              dateOfBirth: cmd.dateOfBirth ? new Date(cmd.dateOfBirth) : undefined,
              addressLine: cmd.addressLine,
              postalCode: cmd.postalCode,
              province: cmd.province,
              district: cmd.district,
              subdistrict: cmd.subdistrict,
              identityType: cmd.identityType,
              identityLast4: last4,
              identityHash,
              identityEncryptedRef,
              phoneNumber: cmd.phoneNumber,
              status: 'DRAFT',
              createdByUserId: cmd.requestingUserId,
            },
          });

          await tx.auditLog.create({
            data: {
              companyId: cmd.companyId,
              actorUserId: cmd.requestingUserId,
              action: AuditAction.ACCESS_EMPLOYEE_CREATE,
              targetType: 'EmployeeAccessProfile',
              targetId: profile.id,
              requestId: cmd.requestId,
              result: 'SUCCESS',
              riskLevel: 'HIGH',
              metadataJson: {
                userId: user.id,
                membershipId: membership.id,
                granterUserId: cmd.requestingUserId,
                granteeUserId: user.id,
                roleDiff: { addedRoleIds: roles.map((r) => r.id), removedRoleIds: [] },
                status: 'DRAFT',
              },
            },
          });

          return { profileId: profile.id, userId: user.id, username };
        });

        return {
          employeeId: result.profileId,
          userId: result.userId,
          username: result.username,
          temporaryPassword: employeePassword,
          mustChangePassword: true,
          lineLink: buildLineLinkPackage(cmd.apiBaseUrl, lineLinkToken.rawToken, lineLinkToken.expiresAt, this.config.lineLiffId),
        };
      } catch (err) {
        if (uniqueConstraintTarget(err)?.includes('username')) throw new ConflictException(USERNAME_CONFLICT);
        if (uniqueConstraintTarget(err)?.some((f) => f === 'identityHash')) {
          throw new ConflictException(IDENTITY_CONFLICT);
        }
        if (uniqueConstraintTarget(err)?.some((f) => f === 'phoneNumber')) {
          throw new ConflictException(PHONE_CONFLICT);
        }
        if (uniqueConstraintTarget(err)?.some((f) => f === 'email')) {
          throw new ConflictException(EMAIL_CONFLICT);
        }
        throw err;
      }
    }

    throw new ConflictException('Could not allocate a unique username. Please retry.');
  }

  /**
   * Attach an existing active user to this company as a draft employee. Reuses the user and its
   * credential as-is (no password reset, no username/email overwrite) so being an employee here
   * cannot compromise the login the person already uses elsewhere. Only a new membership, its
   * roles, this company's access profile, and a LINE-link token are created.
   */
  private async attachExistingUser(
    cmd: CreateEmployeeCommand,
    ctx: {
      userId: string;
      username: string;
      companyEmail: string;
      roles: Array<{ id: string; key: string }>;
      identityHash: string;
      identityLast4: string;
      identityEncryptedRef: string;
      lineLinkToken: { rawToken: string; tokenHash: string; expiresAt: Date };
    },
  ): Promise<CreateEmployeeResult> {
    try {
      const profileId = await this.prisma.client.$transaction(async (tx) => {
        const membership = await tx.companyMembership.create({
          data: { companyId: cmd.companyId, userId: ctx.userId, status: 'DRAFT' },
        });

        await tx.membershipRole.createMany({
          data: ctx.roles.map((role) => ({ membershipId: membership.id, roleId: role.id })),
        });

        await tx.employeeLineLinkToken.create({
          data: {
            companyId: cmd.companyId,
            membershipId: membership.id,
            userId: ctx.userId,
            issuedByUserId: cmd.requestingUserId,
            tokenHash: ctx.lineLinkToken.tokenHash,
            expiresAt: ctx.lineLinkToken.expiresAt,
          },
        });

        const profile = await tx.employeeAccessProfile.create({
          data: {
            companyId: cmd.companyId,
            userId: ctx.userId,
            membershipId: membership.id,
            displayName: cmd.displayName,
            titlePrefix: cmd.titlePrefix,
            legalName: cmd.legalName,
            firstName: cmd.firstName,
            lastName: cmd.lastName,
            dateOfBirth: cmd.dateOfBirth ? new Date(cmd.dateOfBirth) : undefined,
            addressLine: cmd.addressLine,
            postalCode: cmd.postalCode,
            province: cmd.province,
            district: cmd.district,
            subdistrict: cmd.subdistrict,
            identityType: cmd.identityType,
            identityLast4: ctx.identityLast4,
            identityHash: ctx.identityHash,
            identityEncryptedRef: ctx.identityEncryptedRef,
            phoneNumber: cmd.phoneNumber,
            email: ctx.companyEmail,
            status: 'DRAFT',
            createdByUserId: cmd.requestingUserId,
          },
        });

        await tx.auditLog.create({
          data: {
            companyId: cmd.companyId,
            actorUserId: cmd.requestingUserId,
            action: AuditAction.ACCESS_EMPLOYEE_CREATE,
            targetType: 'EmployeeAccessProfile',
            targetId: profile.id,
            requestId: cmd.requestId,
            result: 'SUCCESS',
            riskLevel: 'HIGH',
            metadataJson: {
              userId: ctx.userId,
              membershipId: membership.id,
              roleIds: ctx.roles.map((r) => r.id),
              status: 'DRAFT',
              reusedExistingUser: true,
            },
          },
        });

        return profile.id;
      });

      return {
        employeeId: profileId,
        userId: ctx.userId,
        username: ctx.username,
        temporaryPassword: '',
        mustChangePassword: false,
        reusedExistingAccount: true,
        lineLink: buildLineLinkPackage(cmd.apiBaseUrl, ctx.lineLinkToken.rawToken, ctx.lineLinkToken.expiresAt, this.config.lineLiffId),
      };
    } catch (err) {
      if (uniqueConstraintTarget(err)?.some((f) => f === 'phoneNumber')) throw new ConflictException(PHONE_CONFLICT);
      if (uniqueConstraintTarget(err)?.some((f) => f === 'identityHash')) throw new ConflictException(IDENTITY_CONFLICT);
      throw err;
    }
  }

  async completeDraft(cmd: {
    companyId: string;
    employeeId: string;
    requestingUserId: string;
    requestId: string;
  }): Promise<CompleteEmployeeDraftResult> {
    const draft = await this.prisma.client.employeeAccessProfile.findFirst({
      where: { id: cmd.employeeId, companyId: cmd.companyId },
    });
    if (!draft) throw new NotFoundException('Employee draft not found.');
    if (draft.status === 'ACTIVE') return { employeeId: draft.id, status: 'ACTIVE' };
    if (draft.status !== 'DRAFT') throw new ConflictException('Only an employee draft can be completed.');

    await this.prisma.client.$transaction(async (tx) => {
      await tx.employeeAccessProfile.update({
        where: { id: draft.id },
        data: { status: 'ACTIVE', updatedByUserId: cmd.requestingUserId },
      });
      await tx.companyMembership.update({
        where: { id: draft.membershipId },
        data: { status: 'ACTIVE' },
      });
      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingUserId,
          action: AuditAction.ACCESS_EMPLOYEE_UPDATE,
          targetType: 'EmployeeAccessProfile',
          targetId: draft.id,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { membershipId: draft.membershipId, transition: 'DRAFT_TO_ACTIVE' },
        },
      });
    });

    return { employeeId: draft.id, status: 'ACTIVE' };
  }
}

function uniqueConstraintTarget(err: unknown): string[] | undefined {
  if (typeof err !== 'object' || err === null || (err as { code?: string }).code !== 'P2002') return undefined;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) ? (target as string[]) : typeof target === 'string' ? [target] : undefined;
}
