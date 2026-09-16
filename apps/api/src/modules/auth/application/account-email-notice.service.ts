import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { LineMessagingCredentialsService } from '../../../common/config/line-messaging-credentials.service';
import { EmailDeliveryService } from './email-delivery.service';
import { ACCOUNT_SECURITY_CONTACT } from './account-security-notice';
import { pushLineMessages } from '../infrastructure/system-line-push';

const NOTICE = `มีการยืนยันหรือเปลี่ยนอีเมลของบัญชีนี้ หากไม่ใช่คุณ กรุณาติดต่อทีมงานทันทีที่ ${ACCOUNT_SECURITY_CONTACT}`;
@Injectable()
export class AccountEmailNoticeService {
  constructor(private readonly prisma: PrismaService, private readonly delivery: EmailDeliveryService,
    private readonly lineCredentials: LineMessagingCredentialsService) {}

  async deliver(payload: unknown) {
    const data = payload as { userId?: string; challengeId?: string; channel?: string; noticeAttemptId?: string; lineIdentityId?: string };
    if (!data?.userId || !data.challengeId) throw new Error('email_security_notice_invalid');
    const proof = await this.prisma.client.emailVerificationToken.findFirst({ where: {
      id: data.challengeId, userId: data.userId, proofKind: 'OTP', status: 'USED',
    } });
    if (!proof) throw new Error('email_security_notice_proof_missing');
    if (data.channel === 'email' && data.noticeAttemptId) {
      const attempt = await this.prisma.client.emailSendAttempt.findUnique({ where: { id: data.noticeAttemptId } });
      if (!attempt || attempt.intentKey !== `email-security:${proof.id}` || attempt.purpose !== 'account_security') throw new Error('email_security_notice_binding');
      if (attempt.status === 'ACCEPTED' || attempt.deliveredAt) return;
      // Ambiguous sends reconcile through the existing delivery journal; never send them again.
      if (['SENDING', 'UNKNOWN'].includes(attempt.status)) {
        await this.delivery.reconcileUnknown(attempt.id);
        throw new Error('email_security_notice_reconciling');
      }
      await this.delivery.send(attempt, { subject: 'แจ้งเตือนความปลอดภัยบัญชีมั่งมี', text: NOTICE, html: `<p>${NOTICE}</p>` });
    } else if (data.channel === 'line' && data.lineIdentityId) {
      const credentials = await this.lineCredentials.get();
      const identity = await this.prisma.client.externalIdentity.findFirst({ where: {
        id: data.lineIdentityId, userId: data.userId, status: 'ACTIVE', provider: 'LINE', providerChannelId: credentials.channelId,
      } });
      if (!identity) return; // Never follow an identity moved/unlinked after the security event.
      if (!credentials.accessToken) throw new Error('email_security_line_unavailable');
      const outcome = await pushLineMessages({ token: credentials.accessToken, lineUserId: identity.providerUserId,
        messages: [{ type: 'text', text: NOTICE }], retryKey: proof.id });
      if (!outcome.ok) throw new Error(`email_security_${outcome.error}`);
    } else throw new Error('email_security_notice_channel');
  }
}
