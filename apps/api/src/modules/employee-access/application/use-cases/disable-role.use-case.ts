import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { RoleDetail } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { ROLE_INCLUDE, toRoleSummary } from '../dto/employee-access.mapper';

export type DisableRoleCommand = {
  companyId: string;
  roleId: string;
  requestingUserId: string;
  requestId: string;
};

@Injectable()
export class DisableRoleUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: DisableRoleCommand): Promise<RoleDetail> {
    const existing = await this.prisma.client.role.findFirst({
      where: { id: cmd.roleId, OR: [{ scopeKey: 'system' }, { scopeKey: cmd.companyId }] },
    });
    if (!existing) throw new NotFoundException('Role not found');
    if (existing.isSystem) throw new ForbiddenException('Protected system roles cannot be disabled.');

    const activeAssignments = await this.prisma.client.membershipRole.count({
      where: { roleId: cmd.roleId, membership: { status: { in: ['ACTIVE', 'INVITED'] } } },
    });
    if (activeAssignments > 0) {
      throw new ConflictException('Role is still assigned to active employees. Reassign before disabling.');
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.role.update({ where: { id: cmd.roleId }, data: { status: 'DISABLED' } });

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingUserId,
          action: AuditAction.ACCESS_ROLE_DISABLE,
          targetType: 'Role',
          targetId: cmd.roleId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {},
        },
      });
    });

    const row = await this.prisma.client.role.findUniqueOrThrow({ where: { id: cmd.roleId }, include: ROLE_INCLUDE });
    return toRoleSummary(row);
  }
}
