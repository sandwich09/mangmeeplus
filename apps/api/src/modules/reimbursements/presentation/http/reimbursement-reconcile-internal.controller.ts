import { Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { ReimbursementProjectionReconcilerService } from '../../application/services/reimbursement-projection-reconciler.service';

/**
 * The scheduled run of the reconciler (audit B4): the workers' reimbursement-reconcile scan posts
 * here every few minutes, so a claim whose decision was recorded and not carried out, or whose
 * cancellation was started and not finished, is repaired without anyone asking. Until this existed
 * the reconciler ran only when someone ran its script by hand.
 */
@Public()
@Controller('internal/reimbursements')
export class ReimbursementReconcileInternalController {
  constructor(
    private readonly reconciler: ReimbursementProjectionReconcilerService,
    private readonly config: AppConfigService,
  ) {}

  // ponytail: no request body. The worker posts `{}`; how many claims one run takes belongs to the
  // reconciler, not to an unvalidated caller-supplied number.
  @Post('reconcile')
  @HttpCode(200)
  async execute(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    // The maintenance bridge holds every reimbursement write (ReimbursementWriteQuiesceGuard), and
    // this run writes. Skipped, not refused: the next run takes up whatever waits.
    if (this.config.reimbursementWriteQuiesce) return { skipped: 'reimbursement_write_quiesce' };
    const result = await this.reconciler.execute();
    // Counts only: each claim is named on the run's own log lines.
    return { completed: result.completed.length, failed: result.failed.length, blocked: result.blocked.length };
  }
}
