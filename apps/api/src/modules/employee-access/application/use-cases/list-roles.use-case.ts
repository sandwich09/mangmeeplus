import { Injectable } from '@nestjs/common';
import type { RoleSummary } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { filterPermissionsByEntitlement } from '../../domain/logic/feature-gate.logic';
import { ROLE_INCLUDE, toRoleSummary } from '../dto/employee-access.mapper';
import { loadEntitledFeatureKeys } from '../entitlement.helper';

@Injectable()
export class ListRolesUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(companyId: string): Promise<RoleSummary[]> {
    const [rows, entitled] = await Promise.all([
      this.prisma.client.role.findMany({
        where: { OR: [{ scopeKey: 'system' }, { scopeKey: companyId }] },
        include: ROLE_INCLUDE,
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      }),
      loadEntitledFeatureKeys(this.prisma, companyId),
    ]);

    const overriddenKeys = new Set(rows.filter((row) => row.scopeKey === companyId).map((row) => row.key));
    const visible = rows.filter((row) => !(row.scopeKey === 'system' && overriddenKeys.has(row.key)));

    return visible.map((row) => {
      const summary = toRoleSummary(row);
      // The card's "N สิทธิ์" must agree with the access matrix, which is entitlement-filtered too.
      return {
        ...summary,
        effectivePermissionCount: filterPermissionsByEntitlement(summary.permissionKeys, entitled).length,
      };
    });
  }
}
