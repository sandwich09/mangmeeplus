import { loadEntitledFeatureKeys } from '../entitlement.helper';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { RoleDetail } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { PLATFORM_TENANT_ID } from '../../../sales-console/application/sales-context';
import { PLATFORM_ROLE_KEYS } from '../../../auth/permission-registry';
import { ROLE_INCLUDE, toRoleSummary } from '../dto/employee-access.mapper';
import { companyRoleReadWhere } from '../company-role-read-where';

@Injectable()
export class GetRoleUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(companyId: string, roleId: string): Promise<RoleDetail> {
    const row = await this.prisma.client.role.findFirst({
      where: { id: roleId, ...companyRoleReadWhere(companyId) },
      include: ROLE_INCLUDE,
    });
    // RB-34: the list hides a platform-only role from a shop, so its id must not read it either.
    if (!row || (companyId !== PLATFORM_TENANT_ID && PLATFORM_ROLE_KEYS.includes(row.key))) throw new NotFoundException('Role not found');

    return toRoleSummary(row, await loadEntitledFeatureKeys(this.prisma, companyId));
  }
}
