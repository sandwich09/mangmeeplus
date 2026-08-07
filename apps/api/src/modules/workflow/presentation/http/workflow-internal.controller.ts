/**
 * Internal endpoints for worker-triggered workflow processing (Item 16).
 * Protected by X-Worker-Token header instead of user JWT, following the
 * dashboard-notifications module's InternalNotificationController pattern.
 */
import { Controller, Post, Body, Headers } from '@nestjs/common';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { assertActiveCompany } from '../../../../common/security/active-company';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { WorkflowEventEnvelope } from '@watchdog-bms/contracts';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';
import { IngestWorkflowEventUseCase } from '../../application/use-cases/workflow-event-ingest.use-case';
import { DrainWorkflowOutboxUseCase } from '../../application/use-cases/workflow-outbox-drain.use-case';
import { RunWorkflowScanUseCase, type ScanTriggerType } from '../../application/use-cases/workflow-scan.use-case';
import { RetryDueWorkflowActionsUseCase } from '../../application/use-cases/workflow-retry.use-case';

@Public()
@Controller('internal/workflow')
export class WorkflowInternalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestEvent: IngestWorkflowEventUseCase,
    private readonly drainOutbox: DrainWorkflowOutboxUseCase,
    private readonly runScan: RunWorkflowScanUseCase,
    private readonly retryDue: RetryDueWorkflowActionsUseCase,
    private readonly shadow: LaunchShadowProbe,
  ) {}

  @Post('events/ingest')
  async ingest(@Headers('x-worker-token') token: string | undefined, @Body() body: WorkflowEventEnvelope) {
    assertWorkerToken(token);
    // H-14: event.companyId is caller-supplied. The legitimate flow is the DB
    // outbox -> outbox/drain (which calls the use case directly, bypassing this
    // guard); this HTTP endpoint is a direct-injection path, so refuse forged
    // events aimed at a nonexistent/inactive tenant before firing any rule.
    await assertActiveCompany(this.prisma, body.companyId);
    // SHADOW ONLY (plan §3 F1): one observation per direct-injection request, recorded AFTER the
    // active-company guard so a forged tenant id never reaches the counter. The outbox path is
    // measured at `outbox.drain` under the PRODUCING feature instead, so this is not a double count.
    const sweep = this.shadow.startSweep(SHADOW_SURFACES.workflowEventsIngest);
    try {
      await sweep.record(body.companyId, 'workflow_automation');
      // `return await`, so the flush below runs after the ingest rather than racing its promise.
      return await this.ingestEvent.execute(body);
    } finally {
      await sweep.flush();
    }
  }

  @Post('outbox/drain')
  async drain(@Headers('x-worker-token') token: string | undefined, @Body() body: { batchSize?: number }) {
    assertWorkerToken(token);
    return this.drainOutbox.execute(body?.batchSize);
  }

  @Post('scan')
  async scan(@Headers('x-worker-token') token: string | undefined, @Body() body: { triggerType: ScanTriggerType }) {
    assertWorkerToken(token);
    return this.runScan.execute(body.triggerType);
  }

  @Post('action-runs/retry')
  async retry(@Headers('x-worker-token') token: string | undefined, @Body() body: { limit?: number }) {
    assertWorkerToken(token);
    return this.retryDue.execute(body?.limit);
  }
}
