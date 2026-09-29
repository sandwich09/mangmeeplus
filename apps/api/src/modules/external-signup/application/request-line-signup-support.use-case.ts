import { ConflictException, HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuthRateLimitService } from '../../auth/application/auth-rate-limit.service';
import { LineIdTokenService } from '../../auth/application/line-id-token.service';
import { SIGNUP_SOURCE_LINE_OA } from '../domain/company-signup.logic';
import { LineSignupNotifyService } from './line-signup-notify.service';

/** The browser form carries no free text, so the ask is filed under this fixed sentence. */
const LIFF_SUPPORT_REQUEST_TEXT = 'ขอความช่วยเหลือเรื่องสมัครเปิดร้าน';

/** LIFF launch context must not determine whether an applicant can reach the existing inbox. */
@Injectable()
export class RequestLineSignupSupportUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lineIdToken: LineIdTokenService,
    private readonly rateLimit: AuthRateLimitService,
    private readonly notify: LineSignupNotifyService,
  ) {}

  async execute(idToken: string, correlationRequestId: string): Promise<{ received: true }> {
    const verified = await this.lineIdToken.verify(idToken);
    const lineUserId = verified.providerUserId;
    const lineUserIdHash = createHash('sha256').update(lineUserId).digest('hex').slice(0, 16);
    const request = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`line-support:${lineUserIdHash}`}, 0))`;
      const live = await tx.lineSupportRequest.findFirst({
        where: { lineUserId, status: { in: ['OPEN', 'ANSWERED'] } }, orderBy: { requestedAt: 'desc' },
      });
      if (live) {
        const updated = await tx.lineSupportRequest.updateMany({
          where: { id: live.id, status: live.status },
          data: { lastMessageAt: new Date(), ...(live.status === 'ANSWERED'
            ? { status: 'OPEN', reopenedCount: { increment: 1 } } : {}) },
        });
        if (updated.count === 0) throw new ConflictException('line_support_state_changed');
        return live;
      }
      if (!await this.rateLimit.consumeLineSupportRequestSlot(lineUserId)) {
        throw new HttpException('line_support_daily_limit', 429);
      }
      // The browser supplies no request, tenant or LINE identity to associate with this case.
      const signup = await tx.companySignupRequest.findFirst({
        where: { source: SIGNUP_SOURCE_LINE_OA, lineProviderUserId: lineUserId, lineChannelId: verified.channelId },
        orderBy: { createdAt: 'desc' }, select: { id: true, state: true, companyId: true },
      });
      // A COMPLETED application IS a shop (locked until it buys): the operator must see which one,
      // not "ผู้ที่ยังไม่ได้เปิดร้าน" (review 2026-09-29).
      const companyId = signup?.state === 'COMPLETED' ? signup.companyId ?? undefined : undefined;
      const created = await tx.lineSupportRequest.create({
        data: {
          lineUserId, lineUserIdHash, signupRequestId: signup?.id, companyId,
          requestText: LIFF_SUPPORT_REQUEST_TEXT,
          lastMessageText: LIFF_SUPPORT_REQUEST_TEXT,
          // สัญญา v3 ข้อ 9: the chat starts where the ask does.
          messages: { create: { direction: 'CUSTOMER', kind: 'TEXT', text: LIFF_SUPPORT_REQUEST_TEXT } },
        },
      });
      await tx.auditLog.create({ data: {
        ...(companyId ? { companyId } : {}),
        action: 'signup.line.support_requested', targetType: 'line_support_request', targetId: created.id,
        requestId: correlationRequestId, result: 'SUCCESS', riskLevel: 'LOW',
        metadataJson: { surface: 'liff_signup', linkedToSignup: Boolean(signup) },
      } });
      return created;
    });
    // Idempotent outbox enqueue is also retried after a lost HTTP response / enqueue failure.
    await this.notify.enqueueSupportRequest(request.id);
    return { received: true };
  }
}
