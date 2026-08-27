import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EmployeeCredentialHandoff } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import {
  generateTemporaryPassword,
  hashTemporaryPassword,
  temporaryPasswordExpiry,
} from '../../domain/logic/employee-access.logic';
import { encryptCredential } from '../../../system-partner-management/domain/logic/credential-cipher.logic';
import { buildTemporaryPasswordFlexMessage, pushSystemLineMessages } from '../../../auth/infrastructure/system-line-push';
import { revokeActiveSessions } from '../../../auth/domain/logic/session-revocation.logic';

export type RegenerateEmployeeCredentialCommand = {
  companyId: string;
  employeeId: string;
  requestingUserId: string;
  requestId: string;
};

@Injectable()
export class RegenerateEmployeeCredentialUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: RegenerateEmployeeCredentialCommand): Promise<EmployeeCredentialHandoff> {
    const profile = await this.prisma.client.employeeAccessProfile.findFirst({
      where: { id: cmd.employeeId, companyId: cmd.companyId },
      include: { user: { select: { id: true, username: true } } },
    });
    if (!profile) throw new NotFoundException('Employee not found');

    // An employee attached from another company signs in with their own shared credential; resetting
    // it here would hijack the login they use elsewhere. Their password is managed by that account.
    const reusedExistingUser =
      (await this.prisma.client.companyMembership.count({
        where: { userId: profile.userId, companyId: { not: cmd.companyId } },
      })) > 0;
    if (reusedExistingUser) {
      throw new ForbiddenException('This employee signs in with an existing account from another company; its password cannot be regenerated here.');
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = hashTemporaryPassword(temporaryPassword);
    const expiresAt = temporaryPasswordExpiry(new Date());

    await this.prisma.client.$transaction(async (tx) => {
      await tx.userCredential.update({
        where: { userId: profile.userId },
        data: {
          passwordHash,
          status: 'TEMPORARY',
          mustChangePassword: true,
          expiresAt,
          tempPasswordEncrypted: encryptCredential(temporaryPassword, this.config.credentialEncryptionKey),
        },
      });

      const revokedSessionCount = await revokeActiveSessions(tx.authSession, { userId: profile.userId });

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingUserId,
          action: AuditAction.ACCESS_EMPLOYEE_CREDENTIAL_ISSUE,
          targetType: 'EmployeeAccessProfile',
          targetId: cmd.employeeId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: { userId: profile.userId, revokedSessionCount },
        },
      });
    });

    // After the commit on purpose: an external call must never sit inside the
    // transaction, and a failed push must not fail the regenerate.
    const lineNotified = await this.pushTemporaryPassword(profile.userId, temporaryPassword, expiresAt);

    return {
      userId: profile.userId,
      username: profile.user.username ?? '',
      temporaryPassword,
      mustChangePassword: true,
      expiresAt: expiresAt.toISOString(),
      lineNotified,
    };
  }

  /** Best-effort delivery to the LINE identity already linked to this exact user. */
  private async pushTemporaryPassword(userId: string, temporaryPassword: string, expiresAt: Date): Promise<boolean> {
    const token = this.config.lineMessagingChannelAccessToken;
    if (!token) return false;

    const identity = await this.prisma.client.externalIdentity.findFirst({
      where: { userId, provider: 'LINE', status: 'ACTIVE' },
      select: { providerUserId: true },
    });
    if (!identity) return false;

    const expiry = expiresAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
    // Same one-tap copy card as the forgot-password flow (Owner 2026-08-27).
    return pushSystemLineMessages(token, identity.providerUserId, [
      buildTemporaryPasswordFlexMessage(temporaryPassword, [
        `ใช้ได้ถึง ${expiry}`,
        'เข้าสู่ระบบแล้วระบบจะให้ตั้งรหัสผ่านใหม่ทันที',
      ]),
    ]);
  }
}
