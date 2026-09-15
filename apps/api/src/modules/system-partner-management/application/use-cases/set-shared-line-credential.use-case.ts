import { resolveLineMessagingCredential } from '../../../../common/config/line-messaging-credentials.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { SharedLineMessagingSettings } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { decryptCredential, encryptCredential } from '../../domain/logic/credential-cipher.logic';
import { verifyPassword } from '../../../auth/domain/logic/password-credential.logic';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

export type SetSharedLineCredentialCommand = {
  channelId: string; channelSecret: string; accessToken: string;
  expectedVersion: number; rotationId: string; reason: string; password: string;
};
const PERMISSION = 'system.shared_line_credential.manage';
const unavailable = () => new ServiceUnavailableException({ code: 'LINE_TOKEN_CHECK_UNAVAILABLE', message: 'ยังตรวจ token กับ LINE ไม่ได้ โหลดสถานะล่าสุดแล้วลองอีกครั้ง' });

@Injectable()
export class SetSharedLineCredentialUseCase {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService) {}

  private async authorize(context: RequestContext, tx: Prisma.TransactionClient = this.prisma.client) {
    if (!context.permissions.includes(PERMISSION)) throw new ForbiddenException();
    const member = await tx.companyMembership.findFirst({ where: { id: context.membershipId, userId: context.userId, companyId: context.companyId,
      status: 'ACTIVE', user: { status: 'ACTIVE' }, company: { status: 'ACTIVE' }, roles: { some: { role: { key: 'SYSTEM_ADMIN', isSystem: true,
        scopeKey: 'system', companyId: null, status: 'ACTIVE', permissions: { some: { permission: { key: PERMISSION } } } } } } } });
    if (!member) throw new ForbiddenException();
  }
  private async proof(context: RequestContext, tx: Prisma.TransactionClient = this.prisma.client) {
    const [session, credential] = await Promise.all([
      context.sessionId ? tx.authSession.findFirst({ where: { id: context.sessionId, userId: context.userId, status: 'ACTIVE', revokedAt: null, expiresAt: { gt: new Date() } } }) : null,
      tx.userCredential.findUnique({ where: { userId: context.userId } }),
    ]);
    if (!session || credential?.status !== 'ACTIVE' || credential.mustChangePassword || credential.expiresAt && credential.expiresAt <= new Date()) throw new ForbiddenException();
    return credential;
  }
  private async row(tx: Prisma.TransactionClient = this.prisma.client) {
    return tx.platformLineCredential.findUnique({ where: { credentialKind: 'LINE_MESSAGING_API' } });
  }
  private metadata(row: Awaited<ReturnType<SetSharedLineCredentialUseCase['row']>>): SharedLineMessagingSettings {
    let runtimeStatus: SharedLineMessagingSettings['runtimeStatus'] = 'UNAVAILABLE';
    try { const value=resolveLineMessagingCredential(row,this.config); runtimeStatus=value.channelId&&value.channelSecret&&value.accessToken?'AVAILABLE':'INCOMPLETE'; } catch { /* Expose safe status, never the decrypt/provider error. */ }
    return { runtimeStatus, kind: 'LINE_MESSAGING_API', version: row?.secretVersion ?? 0, channelId: this.config.lineMessagingChannelId ?? null,
      source: row?.runtimePublishedAt ? 'DATABASE' : 'ENVIRONMENT', publishedAt: row?.runtimePublishedAt?.toISOString() ?? null,
      tokenValidatedAt: row?.runtimePublishedAt ? row.lastValidatedAt?.toISOString() ?? null : null,
      inboundVerifiedAt: row?.runtimePublishedAt ? row.inboundVerifiedAt?.toISOString() ?? null : null,
      canReplace: Boolean(this.config.lineMessagingChannelId), updatedAt: row?.updatedAt.toISOString() ?? null };
  }
  async read(context: RequestContext): Promise<SharedLineMessagingSettings> {
    await this.authorize(context); return this.metadata(await this.row());
  }
  async execute(context: RequestContext, cmd: SetSharedLineCredentialCommand): Promise<SharedLineMessagingSettings> {
    await this.authorize(context);
    if (!Number.isSafeInteger(cmd.expectedVersion) || cmd.expectedVersion < 0 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cmd.rotationId)
      || typeof cmd.reason !== 'string' || cmd.reason.trim().length < 5 || cmd.reason.length > 500
      || typeof cmd.password !== 'string' || !cmd.password || cmd.password.length > 1024
      || typeof cmd.channelSecret !== 'string' || cmd.channelSecret.length < 16 || cmd.channelSecret.length > 1024 || /\s/.test(cmd.channelSecret)
      || typeof cmd.accessToken !== 'string' || cmd.accessToken.length < 16 || cmd.accessToken.length > 4096 || /\s/.test(cmd.accessToken)) throw new BadRequestException();
    if (!this.config.lineMessagingChannelId || cmd.channelId !== this.config.lineMessagingChannelId) throw new ConflictException({ code: 'LINE_CHANNEL_MIGRATION_REQUIRED', message: 'การเปลี่ยน OA ต้องย้ายบัญชีที่ผูกไว้แยกต่างหาก ใช้ Channel ID ปัจจุบัน' });
    const credential = await this.proof(context);
    if (!verifyPassword(cmd.password, credential.passwordHash)) throw new ForbiddenException({ code: 'LINE_REAUTH_FAILED', message: 'ยืนยันรหัสผ่านปัจจุบันไม่สำเร็จ' });
    const hash = createHmac('sha256', this.config.credentialEncryptionKey).update(JSON.stringify([cmd.channelId, cmd.channelSecret, cmd.accessToken, cmd.reason.trim(), cmd.expectedVersion])).digest('hex');
    const isReplay = (row: Awaited<ReturnType<SetSharedLineCredentialUseCase['row']>>) => {
      if (!row?.runtimePublishedAt || row.secretVersion !== cmd.expectedVersion + 1) return false;
      try { const value = JSON.parse(decryptCredential(row.encryptedSecretJson, this.config.credentialEncryptionKey));
        return value.rotationId === cmd.rotationId && value.inputHash === hash && value.actorUserId === context.userId && value.sessionId === context.sessionId;
      } catch { return false; }
    };
    const before = await this.row();
    if (isReplay(before)) return this.metadata(before);
    if ((before?.secretVersion ?? 0) !== cmd.expectedVersion) throw new ConflictException({ code: 'LINE_CREDENTIAL_CHANGED', message: 'มีการแก้ไขการตั้งค่าแล้ว โหลดข้อมูลล่าสุดก่อนยืนยันใหม่' });
    let tokenExpiresAt: string;
    try {
      const response = await fetch('https://api.line.me/v2/oauth/verify', { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ access_token: cmd.accessToken }).toString(), signal: AbortSignal.timeout(5000) });
      if (!response.ok) { if ([400,401,403].includes(response.status)) throw new BadRequestException({ code: 'LINE_TOKEN_REJECTED', message: 'ตรวจ token ไม่ผ่าน ใช้ short-lived หรือ long-lived token ของ Channel ปัจจุบันจาก LINE Developers' }); throw unavailable(); }
      const data = await response.json() as { client_id?: unknown; expires_in?: unknown };
      if (data.client_id !== cmd.channelId || typeof data.expires_in !== 'number' || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 60 || data.expires_in > 3155760000) throw new BadRequestException({ code: 'LINE_TOKEN_CHANNEL_OR_EXPIRY', message: 'Token ไม่ตรง Channel หรือใกล้หมดอายุ กรุณาออก token ใหม่' });
      tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    } catch (error) { if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error; throw unavailable(); }
    const encryptedSecretJson = encryptCredential(JSON.stringify({ schemaVersion: 1, channelId: cmd.channelId, channelSecret: cmd.channelSecret, accessToken: cmd.accessToken,
      tokenExpiresAt, rotationId: cmd.rotationId, inputHash: hash, actorUserId: context.userId, sessionId: context.sessionId }), this.config.credentialEncryptionKey);
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform-line-messaging-publication'))`;
      await tx.$queryRaw`SELECT id FROM "UserCredential" WHERE "userId" = ${context.userId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id = ${context.sessionId ?? ''} FOR SHARE`;
      await this.authorize(context, tx);
      if ((await this.proof(context, tx)).updatedAt.getTime() !== credential.updatedAt.getTime()) throw new ForbiddenException();
      const current = await this.row(tx);
      if (isReplay(current)) return this.metadata(current);
      if ((current?.secretVersion ?? 0) !== cmd.expectedVersion) throw new ConflictException({ code: 'LINE_CREDENTIAL_CHANGED', message: 'มีการแก้ไขการตั้งค่าแล้ว โหลดข้อมูลล่าสุดก่อนยืนยันใหม่' });
      const now = new Date(), data = { encryptedSecretJson, health: 'UNKNOWN' as const, rotatedAt: now, runtimePublishedAt: now,
        lastValidatedAt: now, inboundVerifiedAt: null, updatedByAdminUserId: context.userId };
      const saved = current ? await tx.platformLineCredential.update({ where: { id: current.id }, data: { ...data, secretVersion: { increment: 1 } } })
        : await tx.platformLineCredential.create({ data: { ...data, credentialKind: 'LINE_MESSAGING_API' } });
      await tx.auditLog.create({ data: { actorUserId: context.userId, action: 'system.shared_line_credential.published', targetType: 'platform_line_credential',
        targetId: 'LINE_MESSAGING_API', requestId: context.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { rotationId: cmd.rotationId,
          version: saved.secretVersion, previousVersion: cmd.expectedVersion, reason: cmd.reason.trim(), tokenValidated: true, inboundVerified: false } } });
      return this.metadata(saved);
    });
  }
}
