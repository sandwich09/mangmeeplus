import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { encryptCredential } from '../../domain/logic/credential-cipher.logic';
import { revokeActiveSessions } from '../../../auth/domain/logic/session-revocation.logic';
import {
  generateTemporaryPassword,
  hashTemporaryPassword,
  temporaryPasswordExpiry,
} from '../../../employee-access/domain/logic/employee-access.logic';
import type { PartnerMemberPasswordResetDto } from '@watchdog-bms/contracts';

export type PartnerMemberPasswordResetCommand = {
  companyId: string;
  memberUserId: string;
  requestingAdminUserId: string;
  requestId: string;
};

@Injectable()
export class PartnerMemberPasswordResetUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: PartnerMemberPasswordResetCommand): Promise<PartnerMemberPasswordResetDto> {
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { companyId: cmd.companyId, userId: cmd.memberUserId },
      select: { id: true, user: { select: { username: true } } },
    });
    if (!membership) throw new NotFoundException('Member not found in this partner company.');

    const credential = await this.prisma.client.userCredential.findUnique({
      where: { userId: cmd.memberUserId },
      select: { id: true },
    });
    if (!credential) throw new NotFoundException('Member has no password credential.');

    const temporaryPassword = generateTemporaryPassword();
    const expiresAt = temporaryPasswordExpiry(new Date());
    const tempPasswordEncrypted = encryptCredential(temporaryPassword, this.config.credentialEncryptionKey);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.userCredential.update({
        where: { userId: cmd.memberUserId },
        data: {
          passwordHash: hashTemporaryPassword(temporaryPassword),
          status: 'TEMPORARY',
          mustChangePassword: true,
          expiresAt,
          tempPasswordEncrypted,
        },
      });
      const revokedSessionCount = await revokeActiveSessions(tx.authSession, { userId: cmd.memberUserId });
      await tx.auditLog.create({
        data: {
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.partner_member.password.reset',
          targetType: 'UserCredential',
          targetId: cmd.memberUserId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: { companyId: cmd.companyId, memberUserId: cmd.memberUserId, revokedSessionCount },
        },
      });
    });

    return {
      userId: cmd.memberUserId,
      username: membership.user.username ?? undefined,
      temporaryPassword,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
