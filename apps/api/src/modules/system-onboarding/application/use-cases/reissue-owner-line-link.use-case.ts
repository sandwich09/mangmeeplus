import { Injectable, NotFoundException } from '@nestjs/common';
import type { EmployeeLineLinkPackage } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import {
  buildLineLinkPackage,
  generateLineLinkToken,
  OWNER_LINE_LINK_TOKEN_TTL_MS,
} from '../../../employee-access/domain/logic/employee-access.logic';

export type ReissueOwnerLineLinkResult = {
  ownerLineLink: EmployeeLineLinkPackage;
};

/** QR-only escape hatch for an expired 72h owner QR: regenerate-temporary-password
 *  always rotates the owner's password credential, which would lock out an owner who
 *  already set a permanent password and only needs a fresh LINE-link QR. */
@Injectable()
export class ReissueOwnerLineLinkUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(onboardingRunId: string, requestingAdminUserId: string, requestId: string, apiBaseUrl: string): Promise<ReissueOwnerLineLinkResult> {
    const run = await this.prisma.client.companyOnboardingRun.findUnique({
      where: { id: onboardingRunId },
    });
    if (!run) throw new NotFoundException(`Onboarding run "${onboardingRunId}" not found.`);

    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { companyId: run.companyId, userId: run.ownerUserId },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException(`Owner membership not found for onboarding run "${onboardingRunId}".`);

    const lineLinkToken = generateLineLinkToken(OWNER_LINE_LINK_TOKEN_TTL_MS);

    await this.prisma.client.$transaction([
      this.prisma.client.employeeLineLinkToken.updateMany({
        where: { membershipId: membership.id, status: 'PENDING' },
        data: { status: 'REVOKED' },
      }),
      this.prisma.client.employeeLineLinkToken.create({
        data: {
          companyId: run.companyId,
          membershipId: membership.id,
          userId: run.ownerUserId,
          issuedByUserId: requestingAdminUserId,
          tokenHash: lineLinkToken.tokenHash,
          expiresAt: lineLinkToken.expiresAt,
        },
      }),
      this.prisma.client.auditLog.create({
        data: {
          actorUserId: requestingAdminUserId,
          action: 'system.company_onboarding.reissue_owner_line_link',
          targetType: 'company_onboarding_run',
          targetId: onboardingRunId,
          requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: { ownerUserId: run.ownerUserId, companyId: run.companyId },
        },
      }),
    ]);

    return { ownerLineLink: buildLineLinkPackage(apiBaseUrl, lineLinkToken.rawToken, lineLinkToken.expiresAt, this.config.lineLiffId) };
  }
}
