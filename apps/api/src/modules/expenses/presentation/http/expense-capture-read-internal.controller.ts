import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { MAX_CAPTURE_CLAIM_BATCH } from '../../infrastructure/prisma-expense-capture.repository';
import { ExpenseCaptureReadRunnerService } from '../../application/services/expense-capture-read-runner.service';

export class ExpenseCaptureReadDrainDto {
  // A class, not an inline type: only a DTO class reaches the global ValidationPipe, so this is
  // what makes whitelist/forbidNonWhitelisted apply (audit H-23).
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_CAPTURE_CLAIM_BATCH) @IsOptional() batchSize?: number;
}

/**
 * Worker-facing surface for the capture reader (appendix §4.5), on the `expense-auto-post` drain
 * pattern: the timer lives in `apps/workers` and the work runs here, where the attachment storage,
 * the AI gateway client and the money governance already are.
 *
 * It answers as soon as the jobs are CLAIMED, without awaiting the reads: one file can take
 * minutes of provider time, and a worker HTTP call that waited for it would time out and retry a
 * job that is running perfectly well.
 */
@Public()
@Controller('internal/expenses/capture-read')
export class ExpenseCaptureReadInternalController {
  constructor(private readonly runner: ExpenseCaptureReadRunnerService) {}

  @Post('drain')
  drain(
    @Headers('x-worker-token') token: string | undefined,
    @Body() body: ExpenseCaptureReadDrainDto,
  ): Promise<{ claimed: number }> {
    assertWorkerToken(token);
    return this.runner.drain(body?.batchSize ?? 3);
  }
}
