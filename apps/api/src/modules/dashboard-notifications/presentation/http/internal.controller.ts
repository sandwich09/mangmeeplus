/**
 * Internal endpoints for worker-triggered actions (Item 06).
 * Protected by X-Worker-Token header instead of user JWT.
 */
import { Controller, Post, Param, Body, Headers } from '@nestjs/common';
import { Public } from '../../../../common/security/public.decorator';
import { assertWorkerToken } from '../../../../common/security/worker-token';
import { assertActiveCompany } from '../../../../common/security/active-company';
import { PrismaService } from '../../../../common/database/prisma.service';
import { systemWorkerContext } from '../../../auth/domain/logic/system-worker-context';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';
import { GenerateSnapshotUseCase } from '../../application/use-cases/generate-snapshot.use-case';
import { StockLowScanUseCase } from '../../application/use-cases/stock-low-scan.use-case';
import { CreateDailyOwnerSummaryUseCase, ProcessQueuedDeliveryUseCase, ProcessDueNotificationDeliveriesUseCase } from '../../application/use-cases/notification.use-cases';
import {
  CreateDailyOwnerSummariesSweepUseCase,
  GenerateDashboardSnapshotsSweepUseCase,
  ScanStockLowNotificationsSweepUseCase,
  WORKER_NOTIFICATION_PERMISSIONS,
} from '../../application/use-cases/notification-sweeps.use-cases';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { DailyOwnerSummaryDto, GenerateDashboardSnapshotDto } from './dashboard-notifications.dtos';
import { todayCivilDate } from '@watchdog-bms/contracts';

/** Cross-company worker sweep (A4) — not company-scoped, so it lives on its own path. */
@Public()
@Controller('internal/notifications')
export class InternalNotificationSweepController {
  constructor(
    private readonly processDue: ProcessDueNotificationDeliveriesUseCase,
    private readonly snapshotSweep: GenerateDashboardSnapshotsSweepUseCase,
    private readonly stockLowSweep: ScanStockLowNotificationsSweepUseCase,
    private readonly dailySummarySweep: CreateDailyOwnerSummariesSweepUseCase,
  ) {}

  @Post('delivery-sweep')
  async deliverySweep(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.processDue.execute();
  }

  @Post('snapshot-sweep')
  async generateSnapshots(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.snapshotSweep.execute();
  }

  @Post('stock-low-sweep')
  async scanStockLow(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.stockLowSweep.execute();
  }

  @Post('daily-owner-summary-sweep')
  async createDailySummaries(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    return this.dailySummarySweep.execute();
  }
}

function makeWorkerCtx(companyId: string): RequestContext {
  // H-14: least-privilege system context — no synthesized OWNER role.
  return systemWorkerContext({
    requestId: `worker-${Date.now()}`,
    companyId,
    permissions: WORKER_NOTIFICATION_PERMISSIONS,
  });
}

@Public()
@Controller('internal/companies/:companyId')
export class InternalNotificationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly generateSnapshot: GenerateSnapshotUseCase,
    private readonly stockLowScan: StockLowScanUseCase,
    private readonly dailyOwnerSummary: CreateDailyOwnerSummaryUseCase,
    private readonly processDelivery: ProcessQueuedDeliveryUseCase,
    private readonly shadow: LaunchShadowProbe,
  ) {}

  /**
   * SHADOW ONLY (plan §3 F1): the four on-demand worker jobs below each take a caller-supplied
   * companyId that `assertActiveCompany` has already validated. ONE helper with four callers rather
   * than four inline probes — instrumenting only the endpoint a ticket names would leave its
   * siblings permanently unmeasured, and every one of them is `dashboard_notifications` work.
   */
  private async recordShadow<T>(surface: string, companyId: string, work: () => Promise<T>): Promise<T> {
    const sweep = this.shadow.startSweep(surface);
    try {
      await sweep.record(companyId, 'dashboard_notifications');
      // `await`, so the flush below runs after the work rather than racing its promise.
      return await work();
    } finally {
      await sweep.flush();
    }
  }

  // H-14: the path companyId is caller-supplied. assertActiveCompany refuses any
  // job for a company that does not exist or is not ACTIVE, so the worker token
  // alone cannot probe or act on arbitrary tenant ids. Token check runs first so
  // this never becomes an existence oracle.

  @Post('dashboard/snapshots/generate')
  async handleGenerateSnapshot(
    @Param('companyId') companyId: string,
    @Headers('x-worker-token') token: string | undefined,
    @Body() body: GenerateDashboardSnapshotDto,
  ) {
    assertWorkerToken(token);
    await assertActiveCompany(this.prisma, companyId);
    return this.recordShadow(SHADOW_SURFACES.notificationsOndemandSnapshot, companyId, () =>
      this.generateSnapshot.execute(makeWorkerCtx(companyId), companyId, { periodKind: body.periodKind, forceGenerate: true }));
  }

  @Post('notifications/scan/stock-low')
  async stockLow(
    @Param('companyId') companyId: string,
    @Headers('x-worker-token') token: string | undefined,
  ) {
    assertWorkerToken(token);
    await assertActiveCompany(this.prisma, companyId);
    return this.recordShadow(SHADOW_SURFACES.notificationsOndemandStockLow, companyId, () =>
      this.stockLowScan.execute(companyId));
  }

  @Post('notifications/daily-owner-summary')
  async dailySummary(
    @Param('companyId') companyId: string,
    @Headers('x-worker-token') token: string | undefined,
    @Body() body: DailyOwnerSummaryDto,
  ) {
    assertWorkerToken(token);
    await assertActiveCompany(this.prisma, companyId);
    const periodKey = body.periodKey ?? todayCivilDate();
    return this.recordShadow(SHADOW_SURFACES.notificationsOndemandDailySummary, companyId, () =>
      this.dailyOwnerSummary.execute(makeWorkerCtx(companyId), companyId, periodKey));
  }

  @Post('notification-deliveries/:deliveryId/process')
  async delivery(
    @Param('companyId') companyId: string,
    @Param('deliveryId') deliveryId: string,
    @Headers('x-worker-token') token: string | undefined,
  ) {
    assertWorkerToken(token);
    await assertActiveCompany(this.prisma, companyId);
    return this.recordShadow(SHADOW_SURFACES.notificationsOndemandDelivery, companyId, () =>
      this.processDelivery.execute(companyId, deliveryId));
  }
}
