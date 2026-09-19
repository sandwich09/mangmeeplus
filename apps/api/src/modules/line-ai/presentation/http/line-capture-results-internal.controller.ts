/**
 * Internal endpoint for the LINE capture-result push (capture appendix §3, §17.6).
 *
 * Its own route rather than a third action on the ledger controller: the ledger drain answers a
 * chat that is WAITING, this one delivers a result nobody is holding a reply token for, and a
 * shared batch size would make one starve the other. Same `X-Worker-Token` boundary, same
 * repeatable-job worker tick.
 */
import { Body, Controller, Headers, Post } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { LineCaptureResultNotifierUseCase } from '../../application/use-cases/line-capture-result-notifier.use-case';

/** A real DTO class, so `whitelist`/`forbidNonWhitelisted` actually apply (audit H-23). */
class DrainCaptureResultsBodyDto {
  @IsInt() @Min(1) @Max(25) @IsOptional() batchSize?: number;
}

@Public()
@Controller('internal/ai/line-capture-results')
export class LineCaptureResultsInternalController {
  constructor(private readonly notifier: LineCaptureResultNotifierUseCase) {}

  @Post('drain')
  drain(@Headers('x-worker-token') token: string | undefined, @Body() body: DrainCaptureResultsBodyDto) {
    assertWorkerToken(token);
    return this.notifier.execute(body?.batchSize);
  }
}
