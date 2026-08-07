import { Injectable } from '@nestjs/common';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';
import { ExecuteWorkflowActionUseCase, buildActionRunContext } from './workflow-action-runner.use-case';

/** Retrying a failed action is `workflow_automation` work; the action run's company owns it. */
const RETRY_FEATURE_KEY = 'workflow_automation';

// Automatic backoff retry sweep for FAILED_RETRYABLE action runs whose nextAttemptAt is
// due. Manual replay (action-run replay, dead-letter replay) executes synchronously and
// does not go through this sweep — see ReplayWorkflowActionRunUseCase / ReplayWorkflowDeadLetterUseCase.
@Injectable()
export class RetryDueWorkflowActionsUseCase {
  constructor(
    private readonly repo: PrismaWorkflowRepository,
    private readonly executeAction: ExecuteWorkflowActionUseCase,
    private readonly shadow: LaunchShadowProbe,
  ) {}

  async execute(limit = 50): Promise<{ attempted: number }> {
    const due = await this.repo.listRetryableActionRuns(new Date(), limit);
    let attempted = 0;
    // SHADOW ONLY (plan §3 F1): a cross-tenant retry sweep with no entitlement check today.
    // Recorded, never enforced.
    const sweep = this.shadow.startSweep(SHADOW_SURFACES.workflowActionRetry);

    try {
      for (const actionRun of due) {
        await sweep.record(actionRun.companyId, RETRY_FEATURE_KEY);
        const run = await this.repo.findRunById(actionRun.companyId, actionRun.workflowRunId);
        if (!run) continue;
        await this.executeAction.execute(actionRun, buildActionRunContext(run));
        attempted++;
      }
    } finally {
      // `finally`, not a trailing await — see the note in `workflow-scan.use-case.ts`.
      await sweep.flush();
    }

    return { attempted };
  }
}
