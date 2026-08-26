import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { generateRawToken, hashToken } from '../../domain/logic/secure-token.logic';
import { pushSystemLineMessage } from '../../infrastructure/system-line-push';

const RECOVERY_TTL_MS = 30 * 60 * 1000;
// Identical reply for every outcome: the caller must not learn whether the username,
// credential or linked LINE identity exists.
const GENERIC_MESSAGE = 'If the account is eligible, a temporary password has been sent to its linked LINE.';

@Injectable()
export class NotifyPasswordResetRequestUseCase {
  private readonly logger = new Logger(NotifyPasswordResetRequestUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: { username: string; requestId?: string }): Promise<{ message: string }> {
    const startedAt = Date.now();
    try {
      return await this.request(input);
    } finally {
      const remainingMs = this.config.passwordResetResponseMinMs - (Date.now() - startedAt);
      if (remainingMs > 0) await delay(remainingMs);
    }
  }

  private async request(input: { username: string; requestId?: string }): Promise<{ message: string }> {
    const username = input.username.trim().toLowerCase();
    const requestId = input.requestId ?? 'system';

    const deny = async (reason: string, userId?: string, companyId?: string): Promise<{ message: string }> => {
      emitSecurityEvent(this.logger, SECURITY_EVENT.authPasswordResetDenied, 'HIGH', { reason, requestId });
      await this.audit?.log({
        action: AuditAction.AUTH_PASSWORD_RESET_REQUEST,
        actorUserId: userId,
        companyId,
        targetType: 'User',
        targetId: userId,
        requestId,
        result: 'DENIED',
        riskLevel: 'MEDIUM',
        metadataJson: { reason },
      });
      return { message: GENERIC_MESSAGE };
    };

    const user = await this.prisma.client.user.findFirst({
      where: { username },
      include: { credential: true },
    });
    if (!user) return deny('unknown_username');
    if (user.status !== 'ACTIVE' || !user.credential || user.credential.status === 'DISABLED') {
      return deny('ineligible_account', user.id);
    }

    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { userId: user.id, status: 'ACTIVE', company: { status: 'ACTIVE' } },
      select: { companyId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) return deny('no_active_company', user.id);

    const lineToken = this.config.lineMessagingChannelAccessToken;
    if (!lineToken) return deny('line_channel_unavailable', user.id, membership.companyId);

    // The destination comes only from the identity already bound to this exact account.
    const identity = await this.prisma.client.externalIdentity.findFirst({
      where: { userId: user.id, provider: 'LINE', status: 'ACTIVE' },
      select: { providerUserId: true },
    });
    if (!identity) return deny('line_identity_unavailable', user.id, membership.companyId);

    const temporaryPassword = generateRawToken(9);
    const expiresAt = new Date(Date.now() + RECOVERY_TTL_MS);
    const resetToken = await this.prisma.client.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      return tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(temporaryPassword), expiresAt },
        select: { id: true },
      });
    });

    // LINE latency and delivery state must not reveal account existence through this response.
    void this.deliverAndAudit({
      lineToken,
      lineUserId: identity.providerUserId,
      temporaryPassword,
      expiresAt,
      resetTokenId: resetToken.id,
      userId: user.id,
      companyId: membership.companyId,
      requestId,
    }).catch(() => undefined);

    return { message: GENERIC_MESSAGE };
  }

  private async deliverAndAudit(params: {
    lineToken: string;
    lineUserId: string;
    temporaryPassword: string;
    expiresAt: Date;
    resetTokenId: string;
    userId: string;
    companyId: string;
    requestId: string;
  }): Promise<void> {
    const expiry = params.expiresAt.toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const delivered = await pushSystemLineMessage(
      params.lineToken,
      params.lineUserId,
      `🔐 รหัสผ่านชั่วคราว: ${params.temporaryPassword}\nใช้เข้าสู่ระบบภายใน ${expiry} แล้วตั้งรหัสผ่านใหม่ทันที\nรหัสเดิมยังใช้ได้จนกว่าจะใช้รหัสนี้`,
    );

    if (!delivered) {
      await this.prisma.client.passwordResetToken.updateMany({
        where: { id: params.resetTokenId, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
    }

    await this.audit?.log({
      action: AuditAction.AUTH_PASSWORD_RESET_REQUEST,
      actorUserId: params.userId,
      companyId: params.companyId,
      targetType: 'PasswordResetToken',
      targetId: params.resetTokenId,
      requestId: params.requestId,
      result: delivered ? 'SUCCESS' : 'FAILED',
      riskLevel: 'MEDIUM',
      metadataJson: { channel: 'line', recipientCount: delivered ? 1 : 0 },
    });
  }
}
