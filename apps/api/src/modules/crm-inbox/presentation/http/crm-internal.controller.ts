/**
 * Worker-triggered CRM inbox jobs, protected by X-Worker-Token like the
 * item 06 internal notification endpoints.
 */
import { BadRequestException, Body, Controller, Headers, Post } from '@nestjs/common';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { ScanCrmSlaBreachesUseCase } from '../../application/use-cases/scan-crm-sla-breaches.use-case';
import { ScanCrmNewConversationsUseCase } from '../../application/use-cases/scan-crm-new-conversations.use-case';
import { RetryCrmInboxDeliveriesUseCase } from '../../application/use-cases/retry-crm-inbox-deliveries.use-case';
import { RetryCrmAutonomyJobsUseCase } from '../../application/use-cases/retry-crm-autonomy-jobs.use-case';
import { ScanCrmBookingRemindersUseCase } from '../../application/use-cases/scan-crm-booking-reminders.use-case';
import { SweepCrmBookingProposalsUseCase } from '../../application/use-cases/sweep-crm-booking-proposals.use-case';
import { ProcessCrmErasureRequestsUseCase, PurgeCrmPdpaUseCase } from '../../application/use-cases/crm-pdpa.use-case';
import { DeliverCrmCampaignUseCase } from '../../application/use-cases/deliver-crm-campaign.use-case';

@Public()
@Controller('internal/crm')
export class CrmInternalController {
  constructor(
    private readonly scanSlaBreaches: ScanCrmSlaBreachesUseCase,
    private readonly scanNewConversations: ScanCrmNewConversationsUseCase,
    private readonly retryDeliveries: RetryCrmInboxDeliveriesUseCase,
    private readonly retryAutonomyJobs: RetryCrmAutonomyJobsUseCase,
    private readonly scanBookingReminders: ScanCrmBookingRemindersUseCase,
    private readonly sweepBookingProposals: SweepCrmBookingProposalsUseCase,
    private readonly purgePdpa: PurgeCrmPdpaUseCase,
    private readonly processErasureRequests: ProcessCrmErasureRequestsUseCase,
    private readonly deliverCampaigns: DeliverCrmCampaignUseCase,
  ) {}

  @Post('campaign-delivery-scan')
  async campaignDelivery(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.deliverCampaigns.execute();
  }

  @Post('sla-breach-scan')
  async slaBreachScan(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.scanSlaBreaches.execute();
  }

  @Post('new-conversation-scan')
  async newConversationScan(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.scanNewConversations.execute();
  }

  @Post('inbox-retry-scan')
  async inboxRetryScan(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.retryDeliveries.execute();
  }

  @Post('autonomy-retry-scan')
  async autonomyRetryScan(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.retryAutonomyJobs.execute();
  }

  @Post('booking-reminder-scan')
  async bookingReminderScan(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.scanBookingReminders.execute();
  }

  @Post('booking-proposal-sweep')
  async bookingProposalSweep(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.sweepBookingProposals.execute();
  }

  @Post('pdpa-purge')
  async pdpaPurge(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.purgePdpa.execute();
  }

  @Post('pdpa-erasure-process')
  async pdpaErasureProcess(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.processErasureRequests.execute();
  }

  @Post('pdpa-post-restore-re-erasure')
  async pdpaPostRestoreReErasure(
    @Headers('x-worker-token') token: string | undefined,
    @Body() body: { restoredSnapshotAt?: unknown; confirm?: unknown },
  ) {
    assertWorkerToken(token);
    if (body?.confirm !== 'REPLAY_COMPLETED_ERASURES_AFTER_RESTORE' || typeof body.restoredSnapshotAt !== 'string') {
      throw new BadRequestException('Explicit post-restore confirmation and snapshot timestamp are required.');
    }
    return this.processErasureRequests.replayAfterRestore(new Date(body.restoredSnapshotAt));
  }
}
