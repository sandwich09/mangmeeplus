import { Injectable, NotFoundException } from '@nestjs/common';
import type { RoleDetail } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { PLATFORM_TENANT_ID } from '../../../sales-console/application/sales-context';
import { platformOnlyRoleRefused } from '../../domain/logic/employee-access.logic';
import { ROLE_INCLUDE, toRoleSummary } from '../dto/employee-access.mapper';

@Injectable()
export class GetRoleUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(companyId: string, roleId: string): Promise<RoleDetail> {
    const row = await this.prisma.client.role.findFirst({
      where: { id: roleId, OR: [{ scopeKey: 'system' }, { scopeKey: companyId }] },
      include: ROLE_INCLUDE,
    });
    // RB-34: the list hides a platform-only role from a shop, so its id must not read it either.
    if (!row || platformOnlyRoleRefused(row.key, companyId === PLATFORM_TENANT_ID)) throw new NotFoundException('Role not found');

    return toRoleSummary(row);
  }
}
