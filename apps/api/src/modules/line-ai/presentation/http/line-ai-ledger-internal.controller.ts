/**
 * Internal endpoint for the LINE AI ledger reclaim worker (item 10F).
 * X-Worker-Token protected, mirroring the ai-draft drain pattern. Fail-open: with the ledger
 * disabled or Redis unavailable the drain reports skipped/zero counts instead of failing.
 */
import { Controller, Post, Body, Headers } from '@nestjs/common';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { DrainLineLedgerUseCase } from '../../application/use-cases/drain-line-ledger.use-case';
import { RecoverOrphanLineEventsUseCase } from '../../application/use-cases/recover-orphan-line-events.use-case';

@Public()
@Controller('internal/ai/line-ledger')
export class LineAiLedgerInternalController {
  constructor(
    private readonly drain: DrainLineLedgerUseCase,
    private readonly recoverOrphans: RecoverOrphanLineEventsUseCase,
  ) {}

  @Post('drain')
  drainLedger(@Headers('x-worker-token') token: string | undefined, @Body() body: { batchSize?: number }) {
    assertWorkerToken(token);
    return this.drain.execute(body?.batchSize);
  }

  /** Webhook-row recovery, not a ledger drain — it shares this controller because it shares the
   *  worker, token, and minute tick, and it must run even when the ledger is disabled. */
  @Post('sweep-orphan-events')
  sweepOrphanEvents(@Headers('x-worker-token') token: string | undefined, @Body() body: { batchSize?: number }) {
    assertWorkerToken(token);
    return this.recoverOrphans.execute(body?.batchSize);
  }
}
