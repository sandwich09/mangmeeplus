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

  @Post('reminder-sweep')
  reminderSweep(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.claimEmail.sweepReminders();
  }
}
