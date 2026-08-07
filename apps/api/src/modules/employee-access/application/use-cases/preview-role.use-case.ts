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
    const { permissionKeys, dropped } = compileRole({
      capabilityPackKeys: cmd.capabilityPackKeys,
      permissionKeys: cmd.permissionKeys,
      roleTemplateKey: cmd.roleTemplateKey,
      entitledFeatureKeys: entitled,
      granterPermissionKeys: cmd.isOwner ? null : new Set(cmd.granterPermissionKeys),
    });

    let addedVsCurrent: string[] | undefined;
    let removedVsCurrent: string[] | undefined;
    if (cmd.roleId) {
      const role = await this.prisma.client.role.findFirst({
        where: { id: cmd.roleId, OR: [{ scopeKey: 'system' }, { scopeKey: cmd.companyId }] },
        include: { permissions: { select: { permission: { select: { key: true } } } } },
      });
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
