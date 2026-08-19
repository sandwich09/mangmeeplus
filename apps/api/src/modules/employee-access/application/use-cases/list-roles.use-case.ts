import { Injectable } from '@nestjs/common';
import type { RoleSummary } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { roleGrantViolation } from '../../domain/logic/employee-access.logic';
import { filterPermissionsByEntitlement } from '../../domain/logic/feature-gate.logic';
import { ROLE_INCLUDE, toRoleSummary } from '../dto/employee-access.mapper';
import { loadEntitledFeatureKeys } from '../entitlement.helper';

/** Requester context for the per-role grant decision; omitted by request-less readers (access matrix). */
export type RoleListRequester = { permissions: readonly string[]; isOwner: boolean };

@Injectable()
export class ListRolesUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(companyId: string, requester?: RoleListRequester): Promise<RoleSummary[]> {
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
        // Same rule the write path enforces, so a picker filtered on this flag cannot dead-end in a 403.
        ...(requester && {
          assignableByCurrentUser: summary.status === 'ACTIVE'
            && roleGrantViolation([summary], requester.permissions, requester.isOwner) === undefined,
        }),
      };
    });
  }
}
