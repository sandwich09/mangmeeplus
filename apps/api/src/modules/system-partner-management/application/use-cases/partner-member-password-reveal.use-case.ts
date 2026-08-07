import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { decryptCredential } from '../../domain/logic/credential-cipher.logic';
import type { PartnerMemberTempPasswordDto } from '@watchdog-bms/contracts';

export type PartnerMemberPasswordRevealCommand = {
  companyId: string;
  memberUserId: string;
  requestingAdminUserId: string;
  requestId: string;
};

@Injectable()
export class PartnerMemberPasswordRevealUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: PartnerMemberPasswordRevealCommand): Promise<PartnerMemberTempPasswordDto> {
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { companyId: cmd.companyId, userId: cmd.memberUserId },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Member not found in this partner company.');

    const credential = await this.prisma.client.userCredential.findUnique({
      where: { userId: cmd.memberUserId },
      select: { tempPasswordEncrypted: true },
    });
    if (!credential?.tempPasswordEncrypted) {
      throw new NotFoundException('No system-generated temporary password on record — reset the password to issue one.');
    }

    let temporaryPassword: string;
    try {
      temporaryPassword = decryptCredential(credential.tempPasswordEncrypted, this.config.credentialEncryptionKey);
    } catch {
      throw new NotFoundException('Stored temporary password cannot be decrypted — reset the password to issue a new one.');
    }

    // Every reveal of a live credential is audited; the password itself never is.
    await this.prisma.client.auditLog.create({
      data: {
        actorUserId: cmd.requestingAdminUserId,
        action: 'system.partner_member.password.reveal',
        targetType: 'UserCredential',
        targetId: cmd.memberUserId,
        requestId: cmd.requestId,
        result: 'SUCCESS',
        riskLevel: 'CRITICAL',
        metadataJson: { companyId: cmd.companyId, memberUserId: cmd.memberUserId },
      },
    });

    return { temporaryPassword };
  }
}
