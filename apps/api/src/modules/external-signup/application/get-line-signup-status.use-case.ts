import { Injectable } from '@nestjs/common';
import type { LineSignupStatusDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { LineIdTokenService } from '../../auth/application/line-id-token.service';
import { AuthRateLimitService } from '../../auth/application/auth-rate-limit.service';
import { isBusinessHours } from '../domain/business-hours.logic';
import { SIGNUP_SOURCE_LINE_OA } from '../domain/company-signup.logic';

/**
 * P10-L §4 "สถานะของฉัน". Answers for the LINE account the ID token proves and no other — there is
 * no request id in the request, so there is nothing to enumerate.
 */
@Injectable()
export class GetLineSignupStatusUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly lineIdToken: LineIdTokenService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  async execute(idToken: string, now = new Date()): Promise<LineSignupStatusDto> {
    const verified = await this.lineIdToken.verify(idToken);
    // This route also verifies an ID token, and its own bucket is keyed on IP alone — so one
    // account behind changing addresses could drive unbounded verifications here. Its OWN quota,
    // not the submit one: reading a status must never cost a customer the ability to apply.
    await this.rateLimit.assertLineSignupReadUserAllowed(verified.providerUserId);
    const request = await this.prisma.client.companySignupRequest.findFirst({
      where: {
        source: SIGNUP_SOURCE_LINE_OA,
        lineProviderUserId: verified.providerUserId,
        lineChannelId: verified.channelId,
      },
      // Latest application: the LIFF page and the LINE status card both mean "where am I now".
      orderBy: { createdAt: 'desc' },
      select: { id: true, state: true, companyName: true, companyId: true },
    });
    if (!request) return null;

    return {
      requestId: request.id,
      state: request.state,
      companyName: request.companyName,
      businessHours: isBusinessHours(now, {
        days: this.config.lineSignupBusinessDays,
        hours: this.config.lineSignupBusinessHours,
      }),
      ...(request.companyId ? { companyId: request.companyId } : {}),
    };
  }
}
