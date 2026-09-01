import { Injectable, NotFoundException } from '@nestjs/common';
import type { EmployeeLineLinkPackage } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import {
  buildLineLinkPackage,
  generateLineLinkToken,
  OWNER_LINE_LINK_TOKEN_TTL_MS,
} from '../../../employee-access/domain/logic/employee-access.logic';

export type PartnerMemberLineLinkTokenCommand = {
  companyId: string;
  memberUserId: string;
  requestingAdminUserId: string;
  requestId: string;
  apiBaseUrl: string;
};

/** Issue a fresh LINE-link QR for any member of a partner company, keyed by the ids the
 *  members console already holds. The pre-existing escape hatch for an expired QR
 *  (`reissue-owner-line-link`) is keyed by onboarding run id, which appears once on the
 *  creation screen and is recoverable only by reading the production database — so an
 *  expired owner QR meant a support session on the bastion. Same token, same redemption
 *  path, reachable from the screen that already shows "Not linked". */
@Injectable()
export class PartnerMemberLineLinkTokenUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: PartnerMemberLineLinkTokenCommand): Promise<{ lineLink: EmployeeLineLinkPackage }> {
    // ACTIVE only: redemption re-checks membership and company status, so issuing against an
    // inactive membership would hand out a QR that can never be claimed.
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { companyId: cmd.companyId, userId: cmd.memberUserId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('No active membership for this member in this partner company.');

    // 72h, not the 15-minute employee default: that default assumes the employee is standing
    // next to the admin who just created them. This QR is handed to a customer over chat.
    const lineLinkToken = generateLineLinkToken(OWNER_LINE_LINK_TOKEN_TTL_MS);

    await this.prisma.client.$transaction([
      this.prisma.client.employeeLineLinkToken.updateMany({
        where: { membershipId: membership.id, status: 'PENDING' },
        data: { status: 'REVOKED' },
      }),
      this.prisma.client.employeeLineLinkToken.create({
        data: {
          companyId: cmd.companyId,
          membershipId: membership.id,
          userId: cmd.memberUserId,
          issuedByUserId: cmd.requestingAdminUserId,
          tokenHash: lineLinkToken.tokenHash,
          expiresAt: lineLinkToken.expiresAt,
        },
      }),
      this.prisma.client.auditLog.create({
        data: {
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.partner_member.line_link_token.issue',
          targetType: 'CompanyMembership',
          targetId: membership.id,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: { companyId: cmd.companyId, memberUserId: cmd.memberUserId },
        },
      }),
    ]);

    return {
      lineLink: buildLineLinkPackage(
        cmd.apiBaseUrl,
        lineLinkToken.rawToken,
        lineLinkToken.expiresAt,
        this.config.lineLiffId,
      ),
    };
  }
}
