import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { SignupClaimEmailService } from '../../application/signup-claim-email.service';
import { LineSignupNotifyService } from '../../application/line-signup-notify.service';
import { SignupOpsAlertService } from '../../application/signup-ops-alert.service';

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
  constructor(
    private readonly claimEmail: SignupClaimEmailService,
    private readonly lineNotify: LineSignupNotifyService,
    private readonly opsAlerts: SignupOpsAlertService,
  ) {}

  @Post('drain')
  drain(
    @Headers('x-worker-token') token: string | undefined,
    @Body() body: SignupClaimEmailDrainDto,
  ) {
    assertWorkerToken(token);
    return this.claimEmail.drain(body?.batchSize);
  }

  /**
   * Every signup clock rides this one timer: the 24h-before-expiry reminder, the 30-day park (spec
   * §4D ① and ④) and P10-L's day-7 "กันหลุด" nudge (§3.6). They read the same table on the same
   * 15-minute schedule, and the scan worker ignores the response body — a second timer would only
   * be a second thing to deploy and forget. Each sweep claims its own rows, so one throwing does
   * not silently skip the others' work on the next pass.
   */
  @Post('reminder-sweep')
  async reminderSweep(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    const reminders = await this.claimEmail.sweepReminders();
    const expiry = await this.claimEmail.sweepExpiredApprovals();
    const profileGuard = await this.lineNotify.sweepProfileGuardNudges();
    // §15.6 (d) rides here too: "how many trial shops burned their AI budget today" is a question
    // about state, and this is the timer that already asks state questions on a 15-minute cadence.
    const trialBudgets = await this.opsAlerts.sweepTrialBudgets();
    // L-B follow-up (a): a throttled push never terminalizes, so `countDead()` never sees it and
    // nothing else would ever notice a shop's "พร้อมใช้แล้ว" stuck behind the OA quota.
    const stuckPushes = await this.opsAlerts.sweepStuckPushes();
    // line-support-request-spec-th §2.4: the 24h assistant pause expires by itself, so the request
    // behind it must too — otherwise the operator inbox fills with rows nobody is waiting on.
    const supportRequests = await this.lineNotify.sweepExpiredSupportRequests();
    return {
      ...reminders, ...expiry,
      profileGuardQueued: profileGuard.queued,
      trialBudgetsExhausted: trialBudgets.exhausted,
      stuckPushes: stuckPushes.stuck,
      supportRequestsExpired: supportRequests.expired,
    };
  }
}
