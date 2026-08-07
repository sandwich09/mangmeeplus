import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { DashboardSnapshotRepositoryPort, DashboardWidgetConfigRepositoryPort } from '../domain/ports/dashboard-notification.ports';
import type { DashboardSnapshot, DashboardWidgetConfig } from '../domain/models/dashboard.model';

function toSnapshot(row: any): DashboardSnapshot {
  return {
    id: row.id,
    companyId: row.companyId,
    scope: row.scope.toLowerCase() as DashboardSnapshot['scope'],
    scopeKey: row.scopeKey ?? undefined,
    periodKind: row.periodKind as DashboardSnapshot['periodKind'],
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    metricsJson: row.metricsJson as Record<string, unknown>,
    sourceRefsJson: row.sourceRefsJson as Record<string, unknown>,
    freshnessStatus: row.freshnessStatus.toLowerCase() as DashboardSnapshot['freshnessStatus'],
    generatedBy: row.generatedBy.toLowerCase() as DashboardSnapshot['generatedBy'],
    generatedAt: row.generatedAt,
    createdAt: row.createdAt,
  };
}

function toWidgetConfig(row: any): DashboardWidgetConfig {
  return {
    id: row.id,
    companyId: row.companyId,
    widgetKey: row.widgetKey,
    moduleKey: row.moduleKey,
    status: row.status.toLowerCase() as DashboardWidgetConfig['status'],
    position: row.position ?? undefined,
    configJson: row.configJson as Record<string, unknown>,
    createdByUserId: row.createdByUserId ?? undefined,
    updatedByUserId: row.updatedByUserId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaDashboardSnapshotRepository implements DashboardSnapshotRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findLatest(companyId: string, periodKind: string): Promise<DashboardSnapshot | null> {
    const row = await this.prisma.client.dashboardSnapshot.findFirst({
      where: { companyId, periodKind },
      orderBy: { generatedAt: 'desc' },
    });
    return row ? toSnapshot(row) : null;
  }

  async findById(companyId: string, id: string): Promise<DashboardSnapshot | null> {
    const row = await this.prisma.client.dashboardSnapshot.findFirst({ where: { id, companyId } });
    return row ? toSnapshot(row) : null;
  }

  async create(data: Omit<DashboardSnapshot, 'id' | 'createdAt'>): Promise<DashboardSnapshot> {
    const row = await this.prisma.client.dashboardSnapshot.create({
      data: {
        companyId: data.companyId,
        scope: data.scope.toUpperCase() as any,
        scopeKey: data.scopeKey,
        periodKind: data.periodKind,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        metricsJson: data.metricsJson as any,
        sourceRefsJson: data.sourceRefsJson as any,
        freshnessStatus: data.freshnessStatus.toUpperCase() as any,
        generatedBy: data.generatedBy.toUpperCase() as any,
        generatedAt: data.generatedAt,
      },
    });
    return toSnapshot(row);
  }
}

@Injectable()
export class PrismaDashboardWidgetConfigRepository implements DashboardWidgetConfigRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string): Promise<DashboardWidgetConfig[]> {
    const rows = await this.prisma.client.dashboardWidgetConfig.findMany({
      where: { companyId },
      orderBy: { position: 'asc' },
    });
    return rows.map(toWidgetConfig);
  }

  async upsert(companyId: string, widgetKey: string, data: Partial<DashboardWidgetConfig>): Promise<DashboardWidgetConfig> {
    const row = await this.prisma.client.dashboardWidgetConfig.upsert({
      where: { companyId_widgetKey: { companyId, widgetKey } },
      update: {
        status: data.status?.toUpperCase() as any,
        position: data.position,
        configJson: data.configJson as any,
        updatedByUserId: data.updatedByUserId,
      },
      create: {
        companyId,
        widgetKey,
        moduleKey: data.moduleKey ?? 'unknown',
        status: (data.status?.toUpperCase() ?? 'ENABLED') as any,
        configJson: (data.configJson ?? {}) as any,
        createdByUserId: data.createdByUserId,
      },
    });
    return toWidgetConfig(row);
  }
}
