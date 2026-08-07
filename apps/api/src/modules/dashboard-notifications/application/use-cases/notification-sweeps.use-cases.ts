import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { systemWorkerContext } from '../../../auth/domain/logic/system-worker-context';
import { PrismaService } from '../../../../common/database/prisma.service';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { notificationSweepSurface } from '../../../feature-launch/domain/shadow-surface.catalog';
import { GenerateSnapshotUseCase } from './generate-snapshot.use-case';
import { StockLowScanUseCase } from './stock-low-scan.use-case';
import { CreateDailyOwnerSummaryUseCase } from './notification.use-cases';

type SweepResult = { processed: number; failures: number };

/** All three cross-tenant sweeps below are `dashboard_notifications` work. */
const NOTIFICATION_FEATURE_KEY = 'dashboard_notifications';

// Shared with makeWorkerCtx in internal.controller.ts. Least-privilege (H-14):
// only what the worker-reachable jobs actually gate on — GenerateSnapshotUseCase
// requires a dashboard permission. What that snapshot contains is decided by the
// company's feature entitlements, not by this list, so no module read permission
// belongs here: granting one only widened the widgets the worker gets back in a
// response it discards. The worker never reaches the rule-manage/notification-read
// gated paths, so those are not granted either.
export const WORKER_NOTIFICATION_PERMISSIONS: readonly string[] = [
  'dashboard.read',
  'dashboard.snapshot.generate',
];

function workerContext(companyId: string): RequestContext {
  // H-14: least-privilege system context — no synthesized OWNER role.
  return systemWorkerContext({
    requestId: `notification-sweep-${companyId}`,
    companyId,
    permissions: WORKER_NOTIFICATION_PERMISSIONS,
  });
}

/**
 * SHADOW ONLY (plan §3 F1): the one place all three cross-tenant notification sweeps iterate
 * companies, so one probe here instruments three F0 async-surface rows and each keeps its own
 * surface name — a sweep that silently stops firing is still individually visible in the health
 * view's `bySurface`. Nothing here branches on the decision.
 */
async function runSweep(
  shadow: LaunchShadowProbe,
  sweep: string,
  companyIds: string[],
  action: (companyId: string) => Promise<unknown>,
): Promise<SweepResult> {
  let failures = 0;
  const probe = shadow.startSweep(notificationSweepSurface(sweep));
  try {
    for (const companyId of companyIds) {
      // Recorded before the action, and OUTSIDE its try/catch: an observation is evidence about
      // what the guard would have decided, not about whether the work then succeeded.
      await probe.record(companyId, NOTIFICATION_FEATURE_KEY);
      try {
        await action(companyId);
      } catch (error) {
        failures += 1;
        console.error(JSON.stringify({
          event: 'notification_sweep_company_failed',
          sweep,
          companyId,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  } finally {
    // `finally`, not a trailing await (piece 3 / codex r15 fix 11). The per-company catch above
    // covers the action only; a throw from `probe.record` escapes it, and the daily-summary sweep
    // deliberately re-throws after the loop.
    await probe.flush();
  }
  return { processed: companyIds.length, failures };
}

@Injectable()
export class GenerateDashboardSnapshotsSweepUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly generateSnapshot: GenerateSnapshotUseCase,
    private readonly shadow: LaunchShadowProbe,
  ) {}

  async execute(): Promise<SweepResult> {
    const companies = await this.prisma.client.company.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    return runSweep(this.shadow, 'snapshot', companies.map((company) => company.id), (companyId) =>
      this.generateSnapshot.execute(workerContext(companyId), companyId, { periodKind: 'today', forceGenerate: true }));
  }
}

@Injectable()
export class ScanStockLowNotificationsSweepUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockLowScan: StockLowScanUseCase,
    private readonly shadow: LaunchShadowProbe,
  ) {}

  async execute(): Promise<SweepResult> {
    const companies = await this.prisma.client.company.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    return runSweep(this.shadow, 'stock_low', companies.map((company) => company.id), (companyId) => this.stockLowScan.execute(companyId));
  }
}

@Injectable()
export class CreateDailyOwnerSummariesSweepUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyOwnerSummary: CreateDailyOwnerSummaryUseCase,
    private readonly shadow: LaunchShadowProbe,
  ) {}

  async execute(now = new Date()): Promise<SweepResult> {
    const rules = await this.prisma.client.notificationRule.findMany({
      where: { triggerKey: 'daily_owner_summary', status: 'ENABLED', company: { status: 'ACTIVE' } },
      select: { companyId: true },
    });
    const periodKey = bangkokDateKey(now);
    const result = await runSweep(this.shadow, 'daily_owner_summary', rules.map((rule) => rule.companyId), (companyId) =>
      this.dailyOwnerSummary.execute(workerContext(companyId), companyId, periodKey));
    if (result.failures > 0) {
      // The cron fires once a day — surface partial failure as a non-2xx so the
      // worker job retries. Succeeded companies are deduped by periodKey.
      throw new Error(`daily_owner_summary sweep failed for ${result.failures}/${result.processed} companies`);
    }
    return result;
  }
}

function bangkokDateKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
