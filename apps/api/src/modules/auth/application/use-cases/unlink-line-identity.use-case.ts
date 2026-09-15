import { accountEmailState, emailError, lockAccountEmail } from '../account-email-state';
import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { revokePendingLineHandoffTokens } from '../../domain/logic/line-handoff.logic';

@Injectable()
export class UnlinkLineIdentityUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: { userId: string; requestId: string }): Promise<{ unlinked: true }> {
    const { userId, requestId } = input;

    const identity = await this.prisma.client.externalIdentity.findFirst({
      where: { userId, provider: 'LINE', status: 'ACTIVE' },
    });

    if (!identity) {
      throw new NotFoundException('No active LINE identity linked.');
    }

    // One transaction, because a severed link that still opens a session is worse than a link that
    // failed to sever: if any of the three writes cannot land, none of them do and the caller
    // retries. Owner decision 2026-09-06.
    const handoffLinksRevoked = await this.prisma.client.$transaction(async (tx) => {
      await lockAccountEmail(tx, userId);
      const { user, now } = await accountEmailState(tx, userId);
      const credential = user.credential;
      if (!credential || credential.status === 'DISABLED' || (credential.expiresAt && credential.expiresAt <= now) ||
          !(user.username || (user.email && user.emailVerifiedAt))) {
        throw emailError('LAST_LOGIN_REQUIRED', 'กรุณาตั้งชื่อผู้ใช้และรหัสผ่านที่ใช้งานได้ก่อนยกเลิกการผูก LINE');
      }
      await tx.emailVerificationToken.updateMany({ where: { userId, status: 'PENDING' }, data: { status: 'REVOKED' } });
      await tx.user.update({ where: { id: userId }, data: { emailRevision: { increment: 1 } } });
      const changed = await tx.externalIdentity.updateMany({
        where: { id: identity.id, userId: userId, status: 'ACTIVE', updatedAt: identity.updatedAt },
        data: { status: 'UNLINKED', updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException({ code: 'line_identity_changed', message: 'LINE binding changed. Reload and try again.' });
      await tx.passwordResetToken.updateMany({ where: { userId: userId, status: 'PENDING' }, data: { status: 'REVOKED' } });

      // line-support-request-spec-th §2.5. The selected-company row survived the unlink, so it went
      // on naming a shop this LINE account is no longer in — which is what made "ติดต่อเจ้าหน้าที่"
      // page an operator about the wrong shop (UAT E2), and what left a 24h assistant pause hanging
      // on a severed account. Deleted rather than cleared: with no identity there is no context.
      await tx.lineCompanyContext.deleteMany({
        where: { lineUserId: identity.providerUserId },
      });

      // The deep links already sent to this chat outlive the identity by up to 15 minutes and are
      // bearer credentials for the account being severed — see the helper for the full reasoning.
      return revokePendingLineHandoffTokens(tx.lineWebHandoffToken, {
        lineUserId: identity.providerUserId,
        userId,
      });
    });

    void this.audit?.log({
      actorUserId: userId,
      action: AuditAction.AUTH_IDENTITY_UNLINK,
      targetType: 'ExternalIdentity',
      targetId: identity.id,
      requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: { handoffLinksRevoked },
    });

    return { unlinked: true };
  }
}
