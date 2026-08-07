import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { CreateRoleInput, RoleDetail } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { COMPANY_PERMISSION_KEYS } from '../../../auth/permission-registry';
import { compileRole, hasNonCoreCapability } from '../../domain/logic/capability.logic';
import { ownerGatedGrantViolation } from '../../domain/logic/employee-access.logic';
import { ROLE_INCLUDE, toRoleSummary } from '../dto/employee-access.mapper';

export type CreateRoleCommand = CreateRoleInput & {
  companyId: string;
  requestingUserId: string;
  requestId: string;
  // Set from request context so a non-owner cannot grant beyond their own permissions.
  // Omit (or isOwner=true) to skip the granter-scope check (owner / internal callers).
  granterPermissionKeys?: string[];
  isOwner?: boolean;
};

function roleKeyFromName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return slug || 'ROLE';
}

@Injectable()
export class CreateRoleUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: CreateRoleCommand): Promise<RoleDetail> {
    const rawKeys = cmd.permissionKeys ?? [];
    const knownKeys = new Set(COMPANY_PERMISSION_KEYS);
    const unknown = rawKeys.filter((k) => !knownKeys.has(k));
    if (unknown.length) throw new ForbiddenException(`Unknown permission keys: ${unknown.join(', ')}`);

    // Fold capability packs / job preset into the raw keys, filtered by the granter's own scope.
    // ponytail: feature entitlement is enforced at the catalog/preview layer, not re-checked here.
    const granterScope = cmd.isOwner ? null : cmd.granterPermissionKeys ? new Set(cmd.granterPermissionKeys) : null;
    const { permissionKeys: finalKeys } = compileRole({
      capabilityPackKeys: cmd.capabilityPackKeys,
      permissionKeys: rawKeys,
      roleTemplateKey: cmd.roleTemplateKey,
      entitledFeatureKeys: null,
      granterPermissionKeys: granterScope,
    });
    if (!hasNonCoreCapability(finalKeys)) throw new ForbiddenException('At least one permission is required.');
    const ownerGated = ownerGatedGrantViolation(finalKeys, granterScope);
    if (ownerGated) throw new ForbiddenException(ownerGated);

    const permissions = await this.prisma.client.permission.findMany({
      where: { key: { in: finalKeys } },
      select: { id: true },
    });

    const baseKey = roleKeyFromName(cmd.name);
    const role = await this.prisma.client.$transaction(async (tx) => {
      let created;
      for (let attempt = 0; attempt < 5; attempt++) {
        const key = attempt === 0 ? baseKey : `${baseKey}_${attempt}`;
        const existing = await tx.role.findUnique({ where: { scopeKey_key: { scopeKey: cmd.companyId, key } } });
        if (!existing) {
          created = await tx.role.create({
            data: { companyId: cmd.companyId, scopeKey: cmd.companyId, key, name: cmd.name, description: cmd.description, isSystem: false },
          });
          break;
        }
      }
      if (!created) throw new ConflictException('Could not allocate a unique role key. Please retry.');

      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: created.id, permissionId: p.id })),
      });

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingUserId,
          action: AuditAction.ACCESS_ROLE_CREATE,
          targetType: 'Role',
          targetId: created.id,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            key: created.key,
            permissionKeys: finalKeys,
            ...(cmd.capabilityPackKeys?.length ? { capabilityPackKeys: cmd.capabilityPackKeys } : {}),
            ...(cmd.roleTemplateKey ? { roleTemplateKey: cmd.roleTemplateKey } : {}),
          },
        },
      });

      return created;
    });

    const row = await this.prisma.client.role.findUniqueOrThrow({ where: { id: role.id }, include: ROLE_INCLUDE });
    return toRoleSummary(row);
  }
}
