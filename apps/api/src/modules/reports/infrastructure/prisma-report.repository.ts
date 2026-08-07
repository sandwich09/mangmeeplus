import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import type {
  CreateReportExportInput,
  CreateReportViewInput,
  ReportExportRequestDto,
  ReportQueryInput,
  ReportQueryStatus,
  ReportViewDto,
  UpdateReportViewInput,
} from '@watchdog-bms/contracts';

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function jsonObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function iso(date?: Date | null): string | undefined {
  return date ? date.toISOString() : undefined;
}

type ReportDb = Prisma.TransactionClient | PrismaService['client'];
type StoredReportView = ReportViewDto & {
  sourcePermissionSnapshot?: string[];
  sourceScopeSnapshot: Record<string, unknown>;
};

export type CreateReportRunData = {
  id?: string;
  companyId: string;
  requestedByUserId: string;
  datasetCode: string;
  datasetVersion: number;
  viewId?: string;
  status: ReportQueryStatus;
  filters: Record<string, unknown>;
  permissionSnapshot: Record<string, unknown>;
  sourceScopeSnapshot: Record<string, unknown>;
  rowCount: number;
  computedAt: Date;
  sourceFreshness: Record<string, unknown>;
  sourceRefsPreview: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
};

function sourcePermissionSnapshot(value: unknown): string[] | undefined {
  const snapshot = jsonObject(value).sourcePermissions;
  if (!Array.isArray(snapshot)) return undefined;
  const permissions = [...new Set(snapshot.filter((item): item is string => typeof item === 'string' && item.length > 0))];
  return permissions.length > 0 ? permissions : undefined;
}

@Injectable()
export class PrismaReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createRun(data: CreateReportRunData, db: ReportDb = this.prisma.client): Promise<{ id: string }> {
    const row = await db.reportRun.create({
      data: {
        id: data.id,
        companyId: data.companyId,
        requestedByUserId: data.requestedByUserId,
        datasetCode: data.datasetCode,
        datasetVersion: data.datasetVersion,
        viewId: data.viewId,
        status: data.status as any,
        filtersJson: data.filters as any,
        permissionSnapshotJson: data.permissionSnapshot as any,
        sourceScopeSnapshotJson: data.sourceScopeSnapshot as any,
        rowCount: data.rowCount,
        computedAt: data.computedAt,
        sourceFreshnessJson: data.sourceFreshness as any,
        sourceRefsPreviewJson: data.sourceRefsPreview as any,
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
      },
      select: { id: true },
    });
    return row;
  }

  async getRun(companyId: string, id: string) {
    return this.prisma.client.reportRun.findFirst({ where: { companyId, id } });
  }

  async listRunCandidates(companyId: string, userId: string, canAudit: boolean, cursor?: string, take = 50) {
    return this.prisma.client.reportRun.findMany({
      where: { companyId, ...(canAudit ? {} : { requestedByUserId: userId }) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: Math.min(Math.max(take, 1), 100),
    });
  }

  async listViews(companyId: string, userId: string): Promise<StoredReportView[]> {
    const rows = await this.prisma.client.reportView.findMany({
      where: {
        companyId,
        archivedAt: null,
        OR: [{ ownerUserId: userId }, { visibility: 'COMPANY' }],
      },
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    });
    return rows.map((row) => this.toStoredView(row));
  }

  async listAuthorizedLocationIds(companyId: string, locationIds: string[], branchIds: string[]): Promise<string[]> {
    const rows = await this.prisma.client.inventoryLocation.findMany({
      where: {
        companyId,
        id: { in: locationIds },
        OR: [{ branchId: null }, { branchId: { in: branchIds } }],
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findView(companyId: string, id: string): Promise<StoredReportView | null> {
    const row = await this.prisma.client.reportView.findFirst({ where: { companyId, id, archivedAt: null } });
    return row ? this.toStoredView(row) : null;
  }

  async createView(
    companyId: string,
    ownerUserId: string,
    input: CreateReportViewInput & {
      datasetVersion: number;
      sourcePermissionSnapshot: string[];
      sourceScopeSnapshot: Record<string, unknown>;
    },
    db: ReportDb = this.prisma.client,
  ): Promise<ReportViewDto> {
    const row = await db.reportView.create({
      data: {
        companyId,
        ownerUserId,
        datasetCode: input.datasetCode,
        datasetVersion: input.datasetVersion,
        name: input.name,
        description: input.description,
        visibility: (input.visibility ?? 'PRIVATE') as any,
        sharedRoleIdsJson: input.sharedRoleIds ?? [],
        sharedTeamIdsJson: input.sharedTeamIds ?? [],
        filtersJson: input.filters ?? {},
        dimensionsJson: input.dimensions ?? [],
        measuresJson: input.measures ?? [],
        sortJson: input.sort ?? [],
        chartConfigJson: input.chartConfig ?? {},
        permissionSnapshotJson: { sourcePermissions: input.sourcePermissionSnapshot },
        sourceScopeSnapshotJson: input.sourceScopeSnapshot as any,
        pinned: input.pinned ?? false,
      },
    });
    return this.toView(row);
  }

  async updateView(
    companyId: string,
    id: string,
    input: UpdateReportViewInput & {
      sourcePermissionSnapshot: string[];
      sourceScopeSnapshot: Record<string, unknown>;
    },
    db: ReportDb = this.prisma.client,
  ): Promise<ReportViewDto> {
    const row = await db.reportView.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.visibility !== undefined && { visibility: input.visibility as any }),
        ...(input.sharedRoleIds !== undefined && { sharedRoleIdsJson: input.sharedRoleIds }),
        ...(input.sharedTeamIds !== undefined && { sharedTeamIdsJson: input.sharedTeamIds }),
        ...(input.filters !== undefined && { filtersJson: input.filters as any }),
        ...(input.dimensions !== undefined && { dimensionsJson: input.dimensions }),
        ...(input.measures !== undefined && { measuresJson: input.measures }),
        ...(input.sort !== undefined && { sortJson: input.sort as any }),
        ...(input.chartConfig !== undefined && { chartConfigJson: input.chartConfig as any }),
        permissionSnapshotJson: { sourcePermissions: input.sourcePermissionSnapshot },
        sourceScopeSnapshotJson: input.sourceScopeSnapshot as any,
        ...(input.pinned !== undefined && { pinned: input.pinned }),
      },
    });
    if (row.companyId !== companyId) throw new Error('report_view_company_mismatch');
    return this.toView(row);
  }

  async archiveView(companyId: string, id: string, db: ReportDb = this.prisma.client): Promise<void> {
    await db.reportView.update({ where: { id }, data: { archivedAt: new Date() } });
    void companyId;
  }

  async createExport(data: {
    companyId: string;
    requestedByUserId: string;
    datasetCode: string;
    datasetVersion: number;
    viewId?: string;
    runId?: string;
    input: CreateReportExportInput;
    status: 'READY' | 'FAILED';
    rowCount: number;
    fileName?: string;
    fileMimeType?: string;
    fileSizeBytes?: number;
    storageKey?: string;
    sourceScopeSnapshot?: Record<string, unknown>;
    sourcePermissionSnapshot: string[];
    coverageWarnings?: string[];
    sha256?: string;
    expiresAt?: Date;
    errorCode?: string;
    errorMessage?: string;
  }, db: ReportDb = this.prisma.client): Promise<ReportExportRequestDto> {
    const row = await db.reportExportRequest.create({
      data: {
        companyId: data.companyId,
        requestedByUserId: data.requestedByUserId,
        datasetCode: data.datasetCode,
        datasetVersion: data.datasetVersion,
        viewId: data.viewId,
        runId: data.runId,
        format: data.input.format as any,
        status: data.status as any,
        filtersJson: data.input.filters ?? {},
        columnConfigJson: {},
        permissionSnapshotJson: { sourcePermissions: data.sourcePermissionSnapshot },
        sourceScopeSnapshotJson: (data.sourceScopeSnapshot ?? {}) as any,
        coverageWarningsJson: data.coverageWarnings ?? [],
        rowCount: data.rowCount,
        fileName: data.fileName,
        fileMimeType: data.fileMimeType,
        fileSizeBytes: data.fileSizeBytes,
        storageKey: data.storageKey,
        sha256: data.sha256,
        expiresAt: data.expiresAt,
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
      },
    });
    return this.toExport(row);
  }

  async findExport(companyId: string, id: string): Promise<(ReportExportRequestDto & {
    filters: ReportQueryInput['filters'];
    storageKey?: string;
    sourceScopeSnapshot: Record<string, unknown>;
    sourcePermissionSnapshot?: string[];
  }) | null> {
    const row = await this.prisma.client.reportExportRequest.findFirst({ where: { companyId, id } });
    return row ? {
      ...this.toExport(row),
      filters: jsonObject(row.filtersJson),
      storageKey: row.storageKey ?? undefined,
      sourceScopeSnapshot: jsonObject(row.sourceScopeSnapshotJson),
      sourcePermissionSnapshot: sourcePermissionSnapshot(row.permissionSnapshotJson),
    } : null;
  }

  async listExports(
    companyId: string,
    userId: string,
    canManage: boolean,
    limit = 50,
  ): Promise<Array<ReportExportRequestDto & {
    storageKey?: string;
    sourceScopeSnapshot: Record<string, unknown>;
    sourcePermissionSnapshot?: string[];
  }>> {
    const rows = await this.prisma.client.reportExportRequest.findMany({
      where: { companyId, ...(canManage ? {} : { requestedByUserId: userId }) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((row) => ({
      ...this.toExport(row),
      storageKey: row.storageKey ?? undefined,
      sourceScopeSnapshot: jsonObject(row.sourceScopeSnapshotJson),
      sourcePermissionSnapshot: sourcePermissionSnapshot(row.permissionSnapshotJson),
    }));
  }

  async createDrilldownLog(data: {
    companyId: string;
    userId: string;
    datasetCode: string;
    sourceModule: string;
    sourceType: string;
    sourceId?: string;
    result: 'ALLOWED' | 'DENIED';
    reason?: string;
    requestId: string;
  }, db: ReportDb = this.prisma.client) {
    await db.reportDrilldownAccessLog.create({
      data: {
        companyId: data.companyId,
        userId: data.userId,
        datasetCode: data.datasetCode,
        sourceModule: data.sourceModule,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        result: data.result,
        reason: data.reason,
        requestId: data.requestId,
      },
    });
  }

  private toView(row: any): ReportViewDto {
    return {
      id: row.id,
      companyId: row.companyId,
      ownerUserId: row.ownerUserId,
      datasetCode: row.datasetCode,
      datasetVersion: row.datasetVersion,
      name: row.name,
      description: row.description ?? undefined,
      visibility: row.visibility,
      sharedRoleIds: arr(row.sharedRoleIdsJson),
      sharedTeamIds: arr(row.sharedTeamIdsJson),
      filters: jsonObject(row.filtersJson),
      dimensions: arr(row.dimensionsJson),
      measures: arr(row.measuresJson),
      sort: Array.isArray(row.sortJson) ? row.sortJson : [],
      chartConfig: jsonObject(row.chartConfigJson),
      pinned: row.pinned,
      invalidReason: row.invalidReason ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toStoredView(row: any): StoredReportView {
    return {
      ...this.toView(row),
      sourcePermissionSnapshot: sourcePermissionSnapshot(row.permissionSnapshotJson),
      sourceScopeSnapshot: jsonObject(row.sourceScopeSnapshotJson),
    };
  }

  private toExport(row: any): ReportExportRequestDto {
    return {
      id: row.id,
      companyId: row.companyId,
      requestedByUserId: row.requestedByUserId,
      datasetCode: row.datasetCode,
      datasetVersion: row.datasetVersion,
      viewId: row.viewId ?? undefined,
      runId: row.runId ?? undefined,
      format: row.format,
      status: row.status,
      rowCount: row.rowCount,
      fileName: row.fileName ?? undefined,
      fileMimeType: row.fileMimeType ?? undefined,
      fileSizeBytes: row.fileSizeBytes ?? undefined,
      sha256: row.sha256 ?? undefined,
      expiresAt: iso(row.expiresAt),
      errorCode: row.errorCode ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      warnings: arr(row.coverageWarningsJson),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
