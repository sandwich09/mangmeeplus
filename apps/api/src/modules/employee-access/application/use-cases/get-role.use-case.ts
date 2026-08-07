import { Injectable, NotFoundException } from '@nestjs/common';
import type { RoleDetail } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { ROLE_INCLUDE, toRoleSummary } from '../dto/employee-access.mapper';

@Injectable()
export class GetRoleUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(companyId: string, roleId: string): Promise<RoleDetail> {
    const row = await this.prisma.client.role.findFirst({
      where: { id: roleId, OR: [{ scopeKey: 'system' }, { scopeKey: companyId }] },
      include: ROLE_INCLUDE,
    });
    if (!row) throw new NotFoundException('Role not found');

    return toRoleSummary(row);
  }
}
