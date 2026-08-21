import { Injectable } from '@nestjs/common';
import type { RolePreviewInput, RolePreviewResult } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { compileRole, summarizeCapabilities, toEffectivePermissions } from '../../domain/logic/capability.logic';
import { loadEntitledFeatureKeys } from '../entitlement.helper';

export type PreviewRoleCommand = RolePreviewInput & {
  companyId: string;
  granterPermissionKeys: string[];
  isOwner: boolean;
};

@Injectable()
export class PreviewRoleUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: PreviewRoleCommand): Promise<RolePreviewResult> {
    const entitled = await loadEntitledFeatureKeys(this.prisma, cmd.companyId);
    const role = cmd.roleId ? await this.prisma.client.role.findFirst({
      where: { id: cmd.roleId, OR: [{ scopeKey: 'system' }, { scopeKey: cmd.companyId }] },
      include: { permissions: { select: { permission: { select: { key: true } } } } },
    }) : null;
    const granterScope = cmd.isOwner ? null : new Set(cmd.granterPermissionKeys);
    // Match update-role: an existing company-role grant may be retained even when the editor could
    // not grant it anew. Otherwise preview would claim a revoke that save does not perform.
    if (granterScope && role && !role.isSystem) {
      for (const row of role.permissions) granterScope.add(row.permission.key);
    }
    const { permissionKeys, dropped } = compileRole({
      capabilityPackKeys: cmd.capabilityPackKeys,
      permissionKeys: cmd.permissionKeys,
      roleTemplateKey: cmd.roleTemplateKey,
      entitledFeatureKeys: entitled,
      granterPermissionKeys: granterScope,
    });

    let addedVsCurrent: string[] | undefined;
    let removedVsCurrent: string[] | undefined;
    if (cmd.roleId) {
      const current = new Set((role?.permissions ?? []).map((p) => p.permission.key));
      const next = new Set(permissionKeys);
      addedVsCurrent = permissionKeys.filter((k) => !current.has(k));
      removedVsCurrent = [...current].filter((k) => !next.has(k));
    }

    return {
      roleKeys: [],
      capabilities: summarizeCapabilities(permissionKeys),
      permissions: toEffectivePermissions(permissionKeys),
      permissionCount: permissionKeys.length,
      droppedKeys: dropped,
      addedVsCurrent,
      removedVsCurrent,
    };
  }
}
