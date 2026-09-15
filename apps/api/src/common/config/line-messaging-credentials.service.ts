import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { PlatformLineCredential, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AppConfigService } from './app-config.service';
import { decryptCredential } from '../../modules/system-partner-management/domain/logic/credential-cipher.logic';

export type LineMessagingCredentials = {
  source: 'ENVIRONMENT' | 'DATABASE'; version: number; channelId?: string; channelSecret?: string; accessToken?: string;
};

/** Read at the I/O boundary; never cache a decrypted secret across requests/workers. */
@Injectable()
export class LineMessagingCredentialsService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService) {}

  async get(tx: Prisma.TransactionClient = this.prisma.client, purpose: 'INBOUND' | 'OUTBOUND' = 'OUTBOUND'): Promise<LineMessagingCredentials> {
    try {
      const row = await tx.platformLineCredential.findUnique({ where: { credentialKind: 'LINE_MESSAGING_API' } });
      return resolveLineMessagingCredential(row, this.config, purpose);
    } catch {
      throw new ServiceUnavailableException({ code: 'LINE_CREDENTIAL_UNAVAILABLE', message: 'ตรวจสอบการตั้งค่า LINE ในหน้าผู้ดูแล แล้วลองรายการเดิมอีกครั้ง' });
    }
  }

  async observeSignature(credentials: LineMessagingCredentials) {
    if (credentials.source !== 'DATABASE') return;
    await this.prisma.client.platformLineCredential.updateMany({ where: { credentialKind: 'LINE_MESSAGING_API',
      secretVersion: credentials.version, runtimePublishedAt: { not: null }, inboundVerifiedAt: null }, data: { inboundVerifiedAt: new Date() } });
  }
}

/** Shared with the safe Admin read model, so a corrupt/expired publication is visible there. */
export function resolveLineMessagingCredential(row: PlatformLineCredential | null, config: AppConfigService, purpose: 'INBOUND' | 'OUTBOUND' = 'OUTBOUND'): LineMessagingCredentials {
  if (!row?.runtimePublishedAt) return { source: 'ENVIRONMENT', version: row?.secretVersion ?? 0,
    channelId: config.lineMessagingChannelId, channelSecret: config.lineMessagingChannelSecret,
    accessToken: config.lineMessagingChannelAccessToken };
  const value = JSON.parse(decryptCredential(row.encryptedSecretJson, config.credentialEncryptionKey));
  if (value.schemaVersion !== 1 || !config.lineMessagingChannelId || value.channelId !== config.lineMessagingChannelId
    || typeof value.channelSecret !== 'string' || !value.channelSecret || typeof value.accessToken !== 'string' || !value.accessToken
    || typeof value.tokenExpiresAt !== 'string' || !Number.isFinite(Date.parse(value.tokenExpiresAt)) || purpose === 'OUTBOUND' && Date.parse(value.tokenExpiresAt) <= Date.now()) {
    throw new Error('invalid published credential');
  }
  return { source: 'DATABASE', version: row.secretVersion, channelId: value.channelId, channelSecret: value.channelSecret, accessToken: Date.parse(value.tokenExpiresAt) > Date.now() ? value.accessToken : undefined };
}
