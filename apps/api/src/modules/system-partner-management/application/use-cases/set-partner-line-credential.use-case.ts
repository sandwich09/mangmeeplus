import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { encryptCredential } from '../../domain/logic/credential-cipher.logic';
import type { LineCredentialMetadataDto } from '@watchdog-bms/contracts';

export type SetPartnerLineCredentialCommand = {
  companyId: string;
  credentialKind: 'LINE_MESSAGING_API' | 'LINE_LOGIN' | 'LINE_LIFF';
  channelId: string;
  channelSecret: string;
  accessToken?: string;
  requestingAdminUserId: string;
  requestId: string;
};

@Injectable()
export class SetPartnerLineCredentialUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: SetPartnerLineCredentialCommand): Promise<LineCredentialMetadataDto> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: cmd.companyId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);

    const key = this.config.credentialEncryptionKey;

    // Encrypt secret material — never log or return these values
    const secretPayload: Record<string, string> = { channelId: cmd.channelId, channelSecret: cmd.channelSecret };
    if (cmd.accessToken) secretPayload['accessToken'] = cmd.accessToken;
    const encryptedSecretJson = encryptCredential(JSON.stringify(secretPayload), key);

    const existing = await this.prisma.client.companyIntegrationCredential.findUnique({
      where: { companyId_provider_credentialKind: { companyId: cmd.companyId, provider: 'LINE', credentialKind: cmd.credentialKind } },
      select: { id: true },
    });

    const auditAction = existing ? 'replaced' : 'created';

    const saved = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.companyIntegrationCredential.upsert({
        where: { companyId_provider_credentialKind: { companyId: cmd.companyId, provider: 'LINE', credentialKind: cmd.credentialKind } },
        create: {
          companyId: cmd.companyId,
          provider: 'LINE',
          credentialKind: cmd.credentialKind,
          encryptedSecretJson,
          health: 'UNKNOWN',
          rotatedAt: new Date(),
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        update: {
          encryptedSecretJson,
          secretVersion: { increment: 1 },
          health: 'UNKNOWN',
          rotatedAt: new Date(),
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        // Never select encryptedSecretJson in response
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
          action: 'system.partner_line_credential.upsert',
          targetType: 'company_integration_credential',
          targetId: cmd.companyId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: { credentialKind: cmd.credentialKind, action: auditAction },
        },
      });

      return result;
    });

    return {
      kind: saved.credentialKind as LineCredentialMetadataDto['kind'],
      health: saved.health as LineCredentialMetadataDto['health'],
      lastValidatedAt: saved.lastValidatedAt?.toISOString(),
      rotatedAt: saved.rotatedAt?.toISOString(),
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
    };
  }
}
