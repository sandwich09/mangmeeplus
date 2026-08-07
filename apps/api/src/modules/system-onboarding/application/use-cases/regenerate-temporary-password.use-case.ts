import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { EmployeeLineLinkPackage } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { hashPassword } from '../../../auth/domain/logic/password-credential.logic';
import { encryptCredential } from '../../../system-partner-management/domain/logic/credential-cipher.logic';
import {
  buildLineLinkPackage,
  generateLineLinkToken,
  OWNER_LINE_LINK_TOKEN_TTL_MS,
} from '../../../employee-access/domain/logic/employee-access.logic';

export type RegenerateTempPasswordResult = {
  temporaryPassword: string; // shown once; never logged
  ownerLineLink?: EmployeeLineLinkPackage; // rotated with the password so the handoff package stays complete
};

// ponytail: same generator as create use case
function generateTempPassword(): string {
  return randomBytes(9).toString('base64').replace(/[+/=]/g, 'x');
}

const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

@Injectable()
export class RegenerateTemporaryPasswordUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(onboardingRunId: string, requestingAdminUserId: string, requestId: string, apiBaseUrl: string): Promise<RegenerateTempPasswordResult> {
    const run = await this.prisma.client.companyOnboardingRun.findUnique({
      where: { id: onboardingRunId },
    });
    if (!run) throw new NotFoundException(`Onboarding run "${onboardingRunId}" not found.`);

    const credential = await this.prisma.client.userCredential.findUnique({
      where: { userId: run.ownerUserId },
    });
    if (!credential) throw new NotFoundException(`Owner credential not found for onboarding run "${onboardingRunId}".`);

    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { companyId: run.companyId, userId: run.ownerUserId },
      select: { id: true },
    });

    const tempPassword = generateTempPassword();
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);
    const lineLinkToken = membership ? generateLineLinkToken(OWNER_LINE_LINK_TOKEN_TTL_MS) : null;

    await this.prisma.client.$transaction([
      this.prisma.client.userCredential.update({
        where: { userId: run.ownerUserId },
        data: {
          passwordHash: hashPassword(tempPassword),
          status: 'TEMPORARY',
          mustChangePassword: true,
          expiresAt,
          tempPasswordEncrypted: encryptCredential(tempPassword, this.config.credentialEncryptionKey),
        },
      }),
      ...(membership && lineLinkToken
        ? [
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
          ]
        : []),
      this.prisma.client.auditLog.create({
        data: {
          actorUserId: requestingAdminUserId,
          action: 'system.company_onboarding.regenerate_temporary_password',
          targetType: 'company_onboarding_run',
          targetId: onboardingRunId,
          requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: { ownerUserId: run.ownerUserId, companyId: run.companyId },
        },
      }),
    ]);

    return {
      temporaryPassword: tempPassword,
      ...(lineLinkToken ? { ownerLineLink: buildLineLinkPackage(apiBaseUrl, lineLinkToken.rawToken, lineLinkToken.expiresAt, this.config.lineLiffId) } : {}),
    };
  }
}
