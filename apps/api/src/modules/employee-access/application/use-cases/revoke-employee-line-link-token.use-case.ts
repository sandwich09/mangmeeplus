import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';

export type RevokeEmployeeLineLinkTokenCommand = {
  companyId: string;
  employeeId: string;
  requestingUserId: string;
  requestId: string;
};

@Injectable()
export class RevokeEmployeeLineLinkTokenUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: RevokeEmployeeLineLinkTokenCommand): Promise<{ revoked: number }> {
    const profile = await this.prisma.client.employeeAccessProfile.findFirst({
      where: { id: cmd.employeeId, companyId: cmd.companyId },
    });
    if (!profile) throw new NotFoundException('Employee not found');

    return this.prisma.client.$transaction(async (tx) => {
      const result = await tx.employeeLineLinkToken.updateMany({
        where: { membershipId: profile.membershipId, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingUserId,
          action: AuditAction.ACCESS_EMPLOYEE_LINE_LINK_REVOKE,
          targetType: 'EmployeeAccessProfile',
          targetId: cmd.employeeId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'MEDIUM',
          metadataJson: { membershipId: profile.membershipId, revoked: result.count },
        },
      });

      return { revoked: result.count };
    });
  }
}
