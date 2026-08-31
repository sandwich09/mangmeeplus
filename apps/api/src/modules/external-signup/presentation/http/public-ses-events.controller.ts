import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../../common/security/public.decorator';
import { trustedClientIp } from '../../../../common/security/trusted-client-ip';
import { AuthRateLimitService } from '../../../auth/application/auth-rate-limit.service';
import { SesEventsUseCase, type SesEventResult } from '../../application/ses-event.use-case';

/**
 * SNS HTTPS subscription for the SES `mangmee-transactional` configuration set (spec §4D).
 *
 * Unauthenticated by necessity — SNS carries no bearer token — so the trust comes from the message
 * signature plus the expected topic ARN, checked in the use case. The body arrives as `text/plain`
 * (SNS sends every notification that way), which is why main.ts gives this one path its own JSON
 * parser; that parser's 256 KB ceiling — SNS's own maximum message size — is the body-size guard,
 * enforced before any parsing rather than after.
 *
 * Always answers 200 for anything it accepted, including events it deliberately ignores: a non-2xx
 * makes SNS retry, and there is nothing to retry for a delivery notice.
 */
@Public()
@Controller('public')
export class PublicSesEventsController {
  constructor(
    private readonly rateLimit: AuthRateLimitService,
    private readonly sesEvents: SesEventsUseCase,
  ) {}

  @Post('ses-events')
  @HttpCode(200)
  @ApiOperation({ summary: 'Amazon SNS endpoint for SES bounce/complaint events' })
  @ApiResponse({ status: 200, description: 'Event handled, confirmed, or deliberately ignored' })
  @ApiResponse({ status: 403, description: 'Unknown topic, unconfigured endpoint, or bad signature' })
  async receive(@Req() req: Request): Promise<SesEventResult> {
    await this.rateLimit.assertSesEventsAllowed(trustedClientIp(req));
    // Read from the request rather than `@Body()`: the payload is an SNS envelope, not a DTO class,
    // so there is nothing for the global ValidationPipe to whitelist (the LINE webhook precedent).
    return this.sesEvents.handle(req.body, (req.headers['x-request-id'] as string | undefined) ?? `ses-events-${Date.now()}`);
  }
}
