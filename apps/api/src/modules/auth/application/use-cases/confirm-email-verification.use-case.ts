import { ConflictException, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { hashToken } from '../../domain/logic/secure-token.logic';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { EMAIL_VERIFIED_NOTICE, notifyAccountSecurityChange } from '../account-security-notice';

@Injectable()
export class ConfirmEmailVerificationUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
    @Optional() @Inject(AppConfigService) private readonly config: AppConfigService | null = null,
  ) {}

  async execute(input: { token: string; requestId?: string }): Promise<{ email: string; verifiedAt: string }> {
    const tokenHash = hashToken(input.token);
    const now = new Date();
    const token = await this.prisma.client.emailVerificationToken.findUnique({ where: { tokenHash } });

    const fail = async (reason: string) => {
      await this.audit?.log({
        action: AuditAction.AUTH_EMAIL_VERIFIED,
        actorUserId: token?.userId,
        targetType: 'EmailVerificationToken',
        targetId: token?.id,
        requestId: input.requestId ?? 'system',
        result: 'FAILED',
        riskLevel: 'MEDIUM',
        metadataJson: { reason },
      });
      throw new ForbiddenException('Email verification link is invalid, expired, or already used.');
    };

    if (!token) return fail('token_not_found');
    if (token.status !== 'PENDING') return fail('token_not_pending');
    if (token.expiresAt <= now) {
      await this.prisma.client.emailVerificationToken.updateMany({
        where: { id: token.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      return fail('token_expired');
    }

    const user = await this.prisma.client.user.findUnique({
      where: { id: token.userId },
      select: { id: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') return fail('user_ineligible');

    const duplicate = await this.prisma.client.user.findFirst({
      where: { email: token.newEmail, id: { not: token.userId } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('This email is already being used by another account.');
    }

    let verifiedAt = now;
    const claimed = await this.prisma.client.$transaction(async (tx) => {
      const claim = await tx.emailVerificationToken.updateMany({
        where: { id: token.id, status: 'PENDING' },
        data: { status: 'USED', usedAt: verifiedAt },
      });
      if (claim.count !== 1) return false;

      await tx.user.update({
        where: { id: token.userId },
        data: {
          email: token.newEmail,
          emailVerifiedAt: verifiedAt,
        },
      });
      await tx.emailVerificationToken.updateMany({
        where: { userId: token.userId, status: 'PENDING', id: { not: token.id } },
        data: { status: 'REVOKED' },
      });
      return true;
    });

    if (!claimed) return fail('token_already_claimed');

    await this.audit?.log({
      action: AuditAction.AUTH_EMAIL_VERIFIED,
      actorUserId: token.userId,
      targetType: 'User',
      targetId: token.userId,
      requestId: input.requestId ?? 'system',
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: { email: token.newEmail },
    });

    // This route is public — anyone holding the emailed link can spend it — and for a LINE-first
    // owner the new address is a second way to reach the account. LINE is the only channel that
    // can tell them it happened, since the notice cannot go to the mailbox that just changed.
    await notifyAccountSecurityChange(this.prisma, this.config?.lineMessagingChannelAccessToken, token.userId, EMAIL_VERIFIED_NOTICE);

    return { email: token.newEmail, verifiedAt: verifiedAt.toISOString() };
  }
}
