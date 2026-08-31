import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { SignupClaimEmailService } from '../../application/signup-claim-email.service';

export class SignupClaimEmailDrainDto {
  // A class, not an inline type: only a DTO class reaches the global ValidationPipe, so this is
  // what makes whitelist/forbidNonWhitelisted apply (audit H-23). Capped at the outbox claim max.
  @Type(() => Number) @IsInt() @Min(1) @Max(25) @IsOptional() batchSize?: number;
}

/**
 * Worker-facing surface for the claim email. The send itself runs here rather than in the workers
 * process because the mailer port, its SES client and its config live in this container; the worker
 * is only the timer that pokes these two endpoints (the `expense-auto-post` drain pattern).
 */
@Public()
@Controller('internal/signup-claim-email')
export class SignupClaimEmailInternalController {
  constructor(private readonly claimEmail: SignupClaimEmailService) {}

  @Post('drain')
  drain(
    @Headers('x-worker-token') token: string | undefined,
    @Body() body: SignupClaimEmailDrainDto,
  ) {
    assertWorkerToken(token);
    return this.claimEmail.drain(body?.batchSize);
  }

  /**
   * Both claim-clock sweeps ride this one timer: the 24h-before-expiry reminder and the 30-day
   * park (spec §4D ① and ④). They read the same rows on the same schedule, and the scan worker
   * ignores the response body — a second timer would only be a second thing to deploy.
   */
  @Post('reminder-sweep')
  async reminderSweep(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    const reminders = await this.claimEmail.sweepReminders();
    const expiry = await this.claimEmail.sweepExpiredApprovals();
    return { ...reminders, ...expiry };
  }
}
