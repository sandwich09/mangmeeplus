import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { encryptCredential } from '../../domain/logic/credential-cipher.logic';
import type { SharedLineCredentialMetadataDto } from '@watchdog-bms/contracts';

export type SetSharedLineCredentialCommand = {
  credentialKind: 'LINE_MESSAGING_API' | 'LINE_LOGIN' | 'LINE_LIFF';
  channelId: string;
  channelSecret: string;
  accessToken?: string;
  requestingAdminUserId: string;
  requestId: string;
};

@Injectable()
export class SetSharedLineCredentialUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: SetSharedLineCredentialCommand): Promise<SharedLineCredentialMetadataDto> {
    const key = this.config.credentialEncryptionKey;

    const secretPayload: Record<string, string> = { channelId: cmd.channelId, channelSecret: cmd.channelSecret };
    if (cmd.accessToken) secretPayload['accessToken'] = cmd.accessToken;
    const encryptedSecretJson = encryptCredential(JSON.stringify(secretPayload), key);

    const existing = await this.prisma.client.platformLineCredential.findUnique({
      where: { credentialKind: cmd.credentialKind },
      select: { id: true },
    });

    const auditAction = existing ? 'replaced' : 'created';

    const saved = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.platformLineCredential.upsert({
        where: { credentialKind: cmd.credentialKind },
        create: {
          credentialKind: cmd.credentialKind,
          encryptedSecretJson,
          health: 'UNKNOWN',
          rotatedAt: new Date(),
          updatedByAdminUserId: cmd.requestingAdminUserId,
        },
        update: {
          encryptedSecretJson,
          secretVersion: { increment: 1 },
          health: 'UNKNOWN',
          rotatedAt: new Date(),
          updatedByAdminUserId: cmd.requestingAdminUserId,
        },
        select: {
          credentialKind: true,
          health: true,
          lastValidatedAt: true,
          rotatedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Audit MUST NOT include any secret field
      await tx.auditLog.create({
        data: {
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.shared_line_credential.upsert',
          targetType: 'platform_line_credential',
          targetId: cmd.credentialKind,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: { credentialKind: cmd.credentialKind, action: auditAction },
        },
      });

      return result;
    });

    return {
      kind: saved.credentialKind as SharedLineCredentialMetadataDto['kind'],
      health: saved.health as SharedLineCredentialMetadataDto['health'],
      lastValidatedAt: saved.lastValidatedAt?.toISOString(),
      rotatedAt: saved.rotatedAt?.toISOString(),
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
    };
  }
}
