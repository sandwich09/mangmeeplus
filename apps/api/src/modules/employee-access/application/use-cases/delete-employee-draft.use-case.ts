import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { NON_ASSIGNABLE_ROLE_KEYS, hasPrivilegedGrant } from '../../domain/logic/employee-access.logic';
import { lockEmployeeProfile } from '../lock-employee-profile';

export type DeleteEmployeeDraftCommand = {
  companyId: string;
  employeeId: string;
  requestingUserId: string;
  requesterPermissions: string[];
  requestId: string;
};

const NOT_DRAFT = { code: 'employee_draft_not_deletable', message: 'Only an unfinished employee draft can be deleted. Refresh the employee list.' };

@Injectable()
export class DeleteEmployeeDraftUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: DeleteEmployeeDraftCommand): Promise<void> {
    if (!cmd.requesterPermissions.includes('access.employee.disable')) throw new ForbiddenException();

    await this.prisma.client.$transaction(async (tx) => {
      const draft = await lockEmployeeProfile(tx, cmd.companyId, cmd.employeeId);
      if (draft.status !== 'DRAFT') throw new ConflictException(NOT_DRAFT);

      const targetRoles = await tx.membershipRole.findMany({
        where: { membershipId: draft.membershipId },
        select: { role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } } },
      });
      if (targetRoles.some((mr) => NON_ASSIGNABLE_ROLE_KEYS.includes(mr.role.key))) {
        throw new ForbiddenException('Owner and platform access cannot be deleted from employee management.');
      }
      if (!cmd.requesterPermissions.includes('access.role.manage')
        && targetRoles.some((mr) => hasPrivilegedGrant(mr.role.permissions.map((rp) => rp.permission.key)))) {
        throw new ForbiddenException('Deleting drafts with people-managing roles requires access.role.manage.');
      }

      // Tokens have no membership FK. Keep revoked history, never a usable orphan.
      const revokedTokens = await tx.employeeLineLinkToken.updateMany({
        where: { companyId: cmd.companyId, membershipId: draft.membershipId, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      // Cascades only the company profile, roles and branch scopes; the shared user stays intact.
      const removed = await tx.companyMembership.deleteMany({
        where: { id: draft.membershipId, companyId: cmd.companyId, userId: draft.userId, status: 'DRAFT' },
      });
      if (removed.count !== 1) throw new ConflictException(NOT_DRAFT);

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingUserId,
          action: AuditAction.ACCESS_EMPLOYEE_DRAFT_DELETE,
          targetType: 'EmployeeAccessProfile',
          targetId: draft.id,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { membershipId: draft.membershipId, userId: draft.userId, revokedTokenCount: revokedTokens.count },
        },
      });
    });
  }
}
