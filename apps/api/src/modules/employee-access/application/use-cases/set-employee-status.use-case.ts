import { invalidateLineConversationState } from '../../../line-ai/application/line-conversation-context.service';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EmployeeDetail, SetEmployeeStatusInput } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { EMPLOYEE_PROFILE_INCLUDE, toEmployeeSummary } from '../dto/employee-access.mapper';
import { NON_ASSIGNABLE_ROLE_KEYS, hasPrivilegedGrant } from '../../domain/logic/employee-access.logic';
import { assertEmployeeLimit } from '../../../system-partner-management/application/plan-term-limit';
import { lockPlanTermCompany } from '../../../system-partner-management/application/lock-plan-term-company';
import { lockEmployeeProfile } from '../lock-employee-profile';
import { assertEmployeeActivationScope } from '../employee-activation-scope';

export type SetEmployeeStatusCommand = SetEmployeeStatusInput & {
  companyId: string;
  employeeId: string;
  requestingUserId: string;
  requesterPermissions: string[];
  requesterBranchIds?: string[];
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

    await this.prisma.client.$transaction(async (tx) => {
      await lockPlanTermCompany(tx, cmd.companyId);
      const current = await lockEmployeeProfile(tx, cmd.companyId, cmd.employeeId);
      if (current.status === 'DRAFT') throw new ConflictException('Draft employee status can only be changed by completing the employee wizard.');

      const targetRoles = await tx.membershipRole.findMany({
        where: { membershipId: current.membershipId },
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

      // P29 §4D, the third and last transition that buys a seat. The seat count only counts ACTIVE
      // memberships, so a SUSPENDED or DISABLED one is outside it and re-enabling takes a seat back
      // exactly as completing a draft does — without this a company at its cap could disable one
      // employee, activate another, and re-enable the first to sit permanently over its limit.
      //
      // Same count rule and same 422 as the create and completeDraft paths, and the same
      // grandfathering (no plan-term row = unlimited). `active >= employeeLimit` is therefore exact:
      // the membership being re-enabled is not yet in the count when the gate reads it.
      //
      // Gated on the TRANSITION, not the target status: re-activating an already-ACTIVE employee
      // stays the no-op success it is today (that one is already inside the count, so checking it
      // would refuse a request that changes nothing), and SUSPEND/DISABLE are never blocked because
      // they free a seat rather than take one. `current.status` is reread under the company/profile locks and this use case
      // keeps in lockstep with the membership, written from the single `cmd.status` below.
      if (cmd.status === 'ACTIVE' && current.status !== 'ACTIVE') {
        await assertEmployeeLimit({ client: tx }, cmd.companyId);
        await assertEmployeeActivationScope(tx, cmd.companyId, current.membershipId, cmd.requesterBranchIds);
      }
      await tx.employeeAccessProfile.update({
        where: { id: cmd.employeeId },
        data: { status: cmd.status, updatedByUserId: cmd.requestingUserId },
      });
      await tx.companyMembership.update({
        where: { id: current.membershipId },
        data: { status: cmd.status },
      });
      const aiConversationsPurged = cmd.status !== 'ACTIVE'
        ? await invalidateLineConversationState(tx, { companyId: cmd.companyId, userId: current.userId }, cmd.status === 'DISABLED')
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
          metadataJson: { membershipId: current.membershipId, status: cmd.status, reason: cmd.reason, aiConversationsPurged },
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
