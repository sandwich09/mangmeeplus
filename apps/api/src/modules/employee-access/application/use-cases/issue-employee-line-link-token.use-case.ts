import { Injectable } from '@nestjs/common';
import type { EmployeeLineLinkPackage } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { buildLineLinkPackage, generateLineLinkToken } from '../../domain/logic/employee-access.logic';
import { lockEmployeeProfile } from '../lock-employee-profile';

export type IssueEmployeeLineLinkTokenCommand = {
  companyId: string;
  employeeId: string;
  requestingUserId: string;
  requestId: string;
  apiBaseUrl: string;
};

@Injectable()
export class IssueEmployeeLineLinkTokenUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: IssueEmployeeLineLinkTokenCommand): Promise<EmployeeLineLinkPackage> {
    const { rawToken, tokenHash, expiresAt } = generateLineLinkToken();

    await this.prisma.client.$transaction(async (tx) => {
      const profile = await lockEmployeeProfile(tx, cmd.companyId, cmd.employeeId);
      await tx.employeeLineLinkToken.updateMany({
        where: { membershipId: profile.membershipId, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });

      await tx.employeeLineLinkToken.create({
        data: {
          companyId: cmd.companyId,
          membershipId: profile.membershipId,
          userId: profile.userId,
          issuedByUserId: cmd.requestingUserId,
          tokenHash,
          expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingUserId,
          action: AuditAction.ACCESS_EMPLOYEE_LINE_LINK_ISSUE,
          targetType: 'EmployeeAccessProfile',
          targetId: cmd.employeeId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'MEDIUM',
          metadataJson: { membershipId: profile.membershipId },
        },
      });
    });

    return buildLineLinkPackage(cmd.apiBaseUrl, rawToken, expiresAt, this.config.lineLiffId);
  }
}
