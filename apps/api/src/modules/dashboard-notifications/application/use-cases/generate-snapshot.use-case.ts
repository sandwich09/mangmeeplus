import { Injectable, ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaService } from '../../../../common/database/prisma.service';
import { PrismaDashboardSnapshotRepository } from '../../infrastructure/prisma-dashboard.repository';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { InventoryHealthProvider } from '../providers/inventory-health.provider';
import { ExpenseSummaryProvider } from '../providers/expense-summary.provider';
import { getPeriodBoundaries, computeFreshness } from '../../domain/logic/notification.logic';
import type { DashboardSnapshotDto, DashboardPeriodKind, DashboardWidget } from '@watchdog-bms/contracts';

@Injectable()
export class GenerateSnapshotUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: PrismaDashboardSnapshotRepository,
    private readonly inventoryProvider: InventoryHealthProvider,
    private readonly expenseProvider: ExpenseSummaryProvider,
  ) {}

  /** Every widget source. A provider missing from here has no read permission on record, so
   *  `visibleWidgets` drops its card — register new providers rather than relying on fail-open. */
  private get providers() {
    return [this.inventoryProvider, this.expenseProvider];
  }

  async execute(
    ctx: RequestContext,
    companyId: string,
    options: { periodKind?: DashboardPeriodKind; periodStart?: Date; periodEnd?: Date; forceGenerate?: boolean },
  ): Promise<DashboardSnapshotDto> {
    if (!ctx.permissions.includes('dashboard.read') && !ctx.permissions.includes('dashboard.snapshot.generate')) {
      throw new ForbiddenException('dashboard.read required');
    }
    if (ctx.companyId !== companyId) throw new ForbiddenException('Company mismatch');

    const kind: DashboardPeriodKind = options.periodKind ?? 'today';
    const now = new Date();
    const { periodStart, periodEnd } = getPeriodBoundaries(kind, now, 'Asia/Bangkok', options.periodStart, options.periodEnd);

    // A snapshot is company-level data cached per (company, period), so WHAT it contains follows
    // the company's feature entitlements — never the permissions of whoever happened to trigger
    // generation. Gating computation on the caller let the 15-minute worker sweep stamp its own
    // fixed least-privilege context onto every company's cached snapshot: inventory numbers for
    // companies with Inventory switched off, and no expense card for companies that bought
    // Expenses. WHO may read each widget is enforced per request, on the way out.
    const entitled = await loadEntitledFeatureKeys(this.prisma, companyId);
    const activeProviders = this.providers.filter((provider) => entitled === null || entitled.has(provider.featureKey));

    if (!options.forceGenerate) {
      const existing = await this.snapshots.findLatest(companyId, kind);
      const cached = (existing?.metricsJson as { widgets?: DashboardWidget[] } | undefined)?.widgets;
      // Reuse only while the cache still matches what the company is entitled to: a feature turned
      // off must not keep serving its card for the rest of the freshness window.
      if (
        existing && cached
        && computeFreshness(existing.generatedAt, now) === 'fresh'
        // `findLatest` returns the newest snapshot for this period KIND, not for this period, and
        // freshness is an age in minutes — so across a rollover both were satisfied by yesterday's
        // row. A "today" snapshot generated at 23:50 kept being served until 00:05, showing
        // yesterday's totals under today's heading. The period the caller asked for has to match
        // the period the cache holds.
        && existing.periodStart.getTime() === periodStart.getTime()
        && existing.periodEnd.getTime() === periodEnd.getTime()
        && sameModuleSet(cached, activeProviders.map((provider) => provider.moduleKey))
      ) {
        return this.toDto(existing, this.visibleWidgets(cached, ctx.permissions));
      }
    }

    const providerInput = { companyId, periodStart, periodEnd };

    // Collect widgets from the entitled providers (catch per-provider errors); a provider that
    // fails returns an unavailable widget, which the workspace renders as no data rather than
    // as a missing module.
    const collected = await Promise.all(
      activeProviders.map((provider) => provider.collectMetrics(providerInput).catch(() => [] as DashboardWidget[])),
    );
    const widgets = collected.flat();
    const hasUnavailable = widgets.some((w) => w.unavailableReason);
    const freshnessStatus = widgets.length === 0 ? 'unavailable' : hasUnavailable ? 'partial' : 'fresh';

    const snapshot = await this.snapshots.create({
      companyId,
      scope: 'company',
      scopeKey: undefined,
      periodKind: kind,
      periodStart,
      periodEnd,
      metricsJson: { widgets },
      sourceRefsJson: {},
      freshnessStatus,
      generatedBy: options.forceGenerate ? 'manual' : 'system',
      generatedAt: now,
    });

    return this.toDto(snapshot, this.visibleWidgets(widgets, ctx.permissions));
  }

  /** Deny by default: a stored widget is returned only to a caller holding one of its provider's
   *  read permissions, whoever generated the snapshot. */
  private visibleWidgets(widgets: DashboardWidget[], permissions: string[]): DashboardWidget[] {
    return widgets.filter((widget) => {
      const provider = this.providers.find((candidate) => candidate.moduleKey === widget.module);
      return provider?.readPermissions.some((key) => permissions.includes(key)) ?? false;
    });
  }

  private toDto(snapshot: any, widgets: DashboardWidget[]): DashboardSnapshotDto {
    return {
      id: snapshot.id,
      companyId: snapshot.companyId,
      periodKind: snapshot.periodKind,
      periodStart: (snapshot.periodStart instanceof Date ? snapshot.periodStart : new Date(snapshot.periodStart)).toISOString(),
      periodEnd: (snapshot.periodEnd instanceof Date ? snapshot.periodEnd : new Date(snapshot.periodEnd)).toISOString(),
      generatedAt: (snapshot.generatedAt instanceof Date ? snapshot.generatedAt : new Date(snapshot.generatedAt)).toISOString(),
      freshnessStatus: snapshot.freshnessStatus,
      widgets,
    };
  }
}

/** Cached widgets still describe the entitled modules, no more and no less. */
function sameModuleSet(widgets: DashboardWidget[], moduleKeys: string[]): boolean {
  const cached = new Set(widgets.map((widget) => widget.module));
  return cached.size === moduleKeys.length && moduleKeys.every((moduleKey) => cached.has(moduleKey));
}
