import { Injectable } from '@nestjs/common';
import { MENU_REGISTRY, type ActionId, type PermissionMatrix, type PermissionMatrixCell, type PermissionMatrixRow } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { loadEntitledFeatureKeys } from '../entitlement.helper';
import { filterPermissionsByEntitlement } from '../../domain/logic/feature-gate.logic';
import { ListRolesUseCase } from './list-roles.use-case';

@Injectable()
export class GetAccessMatrixUseCase {
  constructor(
    private readonly listRoles: ListRolesUseCase,
    private readonly prisma: PrismaService,
  ) {}

  async execute(companyId: string): Promise<PermissionMatrix> {
    const [roles, entitled] = await Promise.all([
      this.listRoles.execute(companyId),
      loadEntitledFeatureKeys(this.prisma, companyId),
    ]);

    const rows: PermissionMatrixRow[] = roles.map((role) => {
      // AC-FE-2: strip permissions of disabled features, same as the session resolver —
      // otherwise the "เมนูที่จะเห็นจริง" preview shows menus the sidebar actually hides.
      const granted = new Set(filterPermissionsByEntitlement(role.permissionKeys, entitled));
      const menus: PermissionMatrixRow['menus'] = {};
      for (const menu of MENU_REGISTRY) {
        const cell: PermissionMatrixCell = {};
        for (const [action, keys] of Object.entries(menu.actions) as [ActionId, string[]][]) {
          cell[action] = (keys ?? []).some((key) => granted.has(key));
        }
        menus[menu.id] = cell;
      }
      return { roleId: role.id, roleKey: role.key, roleLabel: role.name, locked: role.isSystem, menus };
    });

    return { generatedAt: new Date().toISOString(), menus: MENU_REGISTRY, rows };
  }
}
