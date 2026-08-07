import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NON_EDITABLE_ROLE_KEYS, type RoleDetail, type UpdateRoleInput } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { COMPANY_PERMISSION_KEYS } from '../../../auth/permission-registry';
import { compileRole, hasNonCoreCapability } from '../../domain/logic/capability.logic';
import { ownerGatedGrantViolation } from '../../domain/logic/employee-access.logic';
import { ROLE_INCLUDE, toRoleSummary } from '../dto/employee-access.mapper';

export type UpdateRoleCommand = UpdateRoleInput & {
  companyId: string;
  roleId: string;
  requestingUserId: string;
  requestId: string;
  granterPermissionKeys?: string[];
  isOwner?: boolean;
};

@Injectable()
export class UpdateRoleUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: UpdateRoleCommand): Promise<RoleDetail> {
    const existing = await this.prisma.client.role.findFirst({
      where: { id: cmd.roleId, OR: [{ scopeKey: 'system' }, { scopeKey: cmd.companyId }] },
    });
    if (!existing) throw new NotFoundException('Role not found');
    if (existing.isSystem && NON_EDITABLE_ROLE_KEYS.some((key) => key === existing.key)) {
      throw new ForbiddenException('This role is managed by WatchDog and cannot be edited.');
    }

    let permissions: Array<{ id: string }> | undefined;
    let finalKeys: string[] | undefined;
    if (cmd.permissionKeys !== undefined || cmd.capabilityPackKeys !== undefined) {
      const rawKeys = cmd.permissionKeys ?? [];
      const knownKeys = new Set(COMPANY_PERMISSION_KEYS);
      const unknown = rawKeys.filter((k) => !knownKeys.has(k));
      if (unknown.length) throw new ForbiddenException(`Unknown permission keys: ${unknown.join(', ')}`);
      const granterScope = cmd.isOwner ? null : cmd.granterPermissionKeys ? new Set(cmd.granterPermissionKeys) : null;
      finalKeys = compileRole({
        capabilityPackKeys: cmd.capabilityPackKeys,
        permissionKeys: rawKeys,
        entitledFeatureKeys: null,
        granterPermissionKeys: granterScope,
      }).permissionKeys;
      if (!hasNonCoreCapability(finalKeys)) throw new ForbiddenException('At least one permission is required.');
      const ownerGated = ownerGatedGrantViolation(finalKeys, granterScope);
      if (ownerGated) throw new ForbiddenException(ownerGated);
      permissions = await this.prisma.client.permission.findMany({
        where: { key: { in: finalKeys } },
        select: { id: true },
      });
    }

    const targetRoleId = await this.prisma.client.$transaction(async (tx) => {
      let targetRoleId = cmd.roleId;

      if (existing.isSystem) {
        let fork = await tx.role.findUnique({
          where: { scopeKey_key: { scopeKey: cmd.companyId, key: existing.key } },
        });
        const forkCreated = !fork;

        if (!fork) {
          const createdFork = await tx.role.create({
            data: {
              companyId: cmd.companyId,
              scopeKey: cmd.companyId,
              key: existing.key,
              name: existing.name,
              description: existing.description,
              isSystem: false,
            },
          });
          fork = createdFork;
          const sourcePermissions = await tx.rolePermission.findMany({
            where: { roleId: existing.id },
            select: { permissionId: true },
          });
          await tx.rolePermission.createMany({
            data: sourcePermissions.map(({ permissionId }) => ({ roleId: createdFork.id, permissionId })),
          });
        }

        const memberships = await tx.membershipRole.findMany({
          where: { roleId: existing.id, membership: { companyId: cmd.companyId } },
          select: { membershipId: true },
        });
        if (memberships.length) {
          await tx.membershipRole.deleteMany({
            where: { roleId: existing.id, membershipId: { in: memberships.map((row) => row.membershipId) } },
          });
          await tx.membershipRole.createMany({
            data: memberships.map((row) => ({ membershipId: row.membershipId, roleId: fork.id })),
            skipDuplicates: true,
          });
        }

        if (forkCreated) {
          await tx.auditLog.create({
            data: {
              companyId: cmd.companyId,
              actorUserId: cmd.requestingUserId,
              action: AuditAction.ACCESS_ROLE_CREATE,
              targetType: 'Role',
              targetId: fork.id,
              requestId: cmd.requestId,
              result: 'SUCCESS',
              riskLevel: 'HIGH',
              metadataJson: {
                forkedFromRoleId: existing.id,
                key: existing.key,
                movedMemberships: memberships.length,
              },
            },
          });
        }

        targetRoleId = fork.id;
      }

      await tx.role.update({
        where: { id: targetRoleId },
        data: { name: cmd.name, description: cmd.description },
      });

      if (permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: targetRoleId } });
        await tx.rolePermission.createMany({ data: permissions.map((p) => ({ roleId: targetRoleId, permissionId: p.id })) });
      }

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingUserId,
          action: AuditAction.ACCESS_ROLE_UPDATE,
          targetType: 'Role',
          targetId: targetRoleId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            permissionKeys: finalKeys,
            ...(cmd.capabilityPackKeys?.length ? { capabilityPackKeys: cmd.capabilityPackKeys } : {}),
          },
        },
      });

      return targetRoleId;
    });

    const row = await this.prisma.client.role.findUniqueOrThrow({ where: { id: targetRoleId }, include: ROLE_INCLUDE });
    return toRoleSummary(row);
  }
}
