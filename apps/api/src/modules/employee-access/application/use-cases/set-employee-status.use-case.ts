import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EmployeeDetail, SetEmployeeStatusInput } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { EMPLOYEE_PROFILE_INCLUDE, toEmployeeSummary } from '../dto/employee-access.mapper';
import { NON_ASSIGNABLE_ROLE_KEYS, hasPrivilegedGrant } from '../../domain/logic/employee-access.logic';

export type SetEmployeeStatusCommand = SetEmployeeStatusInput & {
  companyId: string;
  employeeId: string;
  requestingUserId: string;
  requesterPermissions: string[];
  requestId: string;
};

@Injectable()
export class SetEmployeeStatusUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: SetEmployeeStatusCommand): Promise<EmployeeDetail> {
    const existing = await this.prisma.client.employeeAccessProfile.findFirst({
      where: { id: cmd.employeeId, companyId: cmd.companyId },
    });
    if (!existing) throw new NotFoundException('Employee not found');
    if (existing.status === 'DRAFT') {
      throw new ConflictException('Draft employee status can only be changed by completing the employee wizard.');
    }

    const targetRoles = await this.prisma.client.membershipRole.findMany({
      where: { membershipId: existing.membershipId },
      select: { role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } } },
    });
    // Last-owner lockout protection: the owner account is never suspended/disabled from here.
    if (targetRoles.some((mr) => NON_ASSIGNABLE_ROLE_KEYS.includes(mr.role.key))) {
      throw new ForbiddenException('Owner and platform access cannot be suspended or disabled from employee management.');
    }
    // Escalation guard: without access.role.manage, holders of people-manager roles
    // (Admin, fellow Managers) cannot be suspended/disabled.
    if (!cmd.requesterPermissions.includes('access.role.manage')
      && targetRoles.some((mr) => hasPrivilegedGrant(mr.role.permissions.map((rp) => rp.permission.key)))) {
      throw new ForbiddenException('Changing status of people-managing roles requires access.role.manage.');
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.employeeAccessProfile.update({
        where: { id: cmd.employeeId },
        data: { status: cmd.status, updatedByUserId: cmd.requestingUserId },
      });
      await tx.companyMembership.update({
        where: { id: existing.membershipId },
        data: { status: cmd.status },
      });
      const aiConversationsPurged = cmd.status === 'DISABLED'
        ? (await tx.aiConversation.deleteMany({ where: { companyId: cmd.companyId, userId: existing.userId } })).count
        : 0;

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingUserId,
          action: AuditAction.ACCESS_EMPLOYEE_DISABLE,
          targetType: 'EmployeeAccessProfile',
          targetId: cmd.employeeId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { membershipId: existing.membershipId, status: cmd.status, reason: cmd.reason, aiConversationsPurged },
        },
      });
    });

    const row = await this.prisma.client.employeeAccessProfile.findFirstOrThrow({
      where: { id: cmd.employeeId },
      include: EMPLOYEE_PROFILE_INCLUDE,
    });
    return toEmployeeSummary(row);
  }
}
