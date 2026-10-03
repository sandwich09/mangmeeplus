import { BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreateReportExportInput,
  CreateReportViewInput,
  ReportCatalogDto,
  ReportDatasetDefinitionDto,
  ReportDrilldownDto,
  ReportDrilldownInput,
  ReportExportDownloadDto,
  ReportExportRequestDto,
  ReportQueryInput,
  ReportRunHistoryPageDto,
  ReportResultDto,
  ReportViewDto,
  RequestContext,
  UpdateReportViewInput,
} from '@watchdog-bms/contracts';
import { REPORT_PERMISSION_KEYS, todayCivilDate } from '@watchdog-bms/contracts';
import { AuditService } from '../../audit/application/audit.service';
import { CreateOrUpdateNotificationEventUseCase } from '../../dashboard-notifications/application/use-cases/notification.use-cases';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort, type PutObjectResult } from '../../data-model-core/domain/ports/attachment-storage.port';
import { ObjectVersionCleanupService } from '../../data-model-core/application/services/object-version-cleanup.service';
import { REPORT_CATALOG, findReportDefinition } from '../domain/report-catalog';
import { canRunReport, hasSourcePermission, visibleDatasetStatus } from '../domain/report-permission.logic';
import { REPORT_MAX_PAGE_SIZE, REPORT_SYNC_EXPORT_MAX_ROWS, validateReportQuery } from '../domain/report-query-validator.logic';
import { buildReportCsv, sha256 } from '../domain/report-csv.logic';
import { reportResultForPeople } from '../domain/report-row-text.logic';
import { PrismaReportRepository, type CreateReportRunData } from '../infrastructure/prisma-report.repository';
import { ReportSourceAdapters } from './report-source-adapters';
import { ReportEntitlementService, type ReportEntitlementStamp } from './report-entitlement.service';

function ensureCompany(ctx: RequestContext, companyId: string) {
  if (ctx.companyId !== companyId) throw new ForbiddenException('Company mismatch');
}

function ensureRetainedRead(ctx: RequestContext) {
  if (!ctx.permissions.includes(REPORT_PERMISSION_KEYS.SNAPSHOT_READ)) {
    throw new ForbiddenException('Missing permission: report.snapshot.read');
  }
}

function ensureCurrentSourceAccess(ctx: RequestContext, datasetCode: string) {
  const definition = findReportDefinition(datasetCode);
  if (!definition) throw new NotFoundException('Report dataset not found');
  if (!hasSourcePermission(ctx, definition.requiredSourcePermissions, definition.sourcePermissionMode)) {
    throw new ForbiddenException('Missing report source permission');
  }
  return definition;
}

function effectiveSourcePermissions(
  ctx: RequestContext,
  definition: NonNullable<ReturnType<typeof findReportDefinition>>,
  filters?: Record<string, unknown>,
): string[] {
  if (!hasSourcePermission(ctx, definition.requiredSourcePermissions, definition.sourcePermissionMode)) {
    throw new ForbiddenException('Missing report source permission');
  }
  const held = definition.requiredSourcePermissions.filter((permission) => ctx.permissions.includes(permission));
  if (definition.sourcePermissionMode !== 'any') return held;
  if (filters?.scope === 'own') {
    const own = held.find((permission) => permission.endsWith('.read_own'));
    if (own) return [own];
  }
  // For ANY catalogs, ordering is the product policy: broad authority precedes own-only authority.
  // A saved view is configuration, not data, so retain the one path it would use instead of every
  // redundant permission the member happened to hold when saving it.
  return held.slice(0, 1);
}

function sourcePermissionSnapshotStillAuthorized(ctx: RequestContext, snapshot: unknown): boolean {
  return Array.isArray(snapshot)
    && snapshot.length > 0
    && snapshot.every((permission) => typeof permission === 'string' && ctx.permissions.includes(permission));
}

function ensureOriginalSourceAuthority(ctx: RequestContext, snapshot: unknown) {
  if (!sourcePermissionSnapshotStillAuthorized(ctx, snapshot)) {
    throw new ForbiddenException({
      code: 'report_artifact_authority_changed',
      message: 'Your current source permissions no longer cover the permissions used to create this report artifact',
    });
  }
}

const SCOPE_KEYS = ['branchIds', 'locationIds', 'teamIds'] as const;

function scopeSnapshotStillAuthorized(ctx: RequestContext, snapshot: unknown): boolean {
  const stored = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown>
    : {};
  return SCOPE_KEYS.every((key) => {
    const original = Array.isArray(stored[key]) ? stored[key].filter((value): value is string => typeof value === 'string') : undefined;
    const current = ctx.scopes?.[key];
    if (!current) return true; // current authority is unscoped
    if (!original) return false; // artifact was generated with broader/unscoped authority
    const currentSet = new Set(current);
    return original.every((value) => currentSet.has(value));
  });
}

function ensureCurrentScopeAccess(ctx: RequestContext, snapshot: unknown) {
  if (!scopeSnapshotStillAuthorized(ctx, snapshot)) {
    throw new ForbiddenException('Report artifact is outside your current scope');
  }
}

const VIEW_SCOPE_FILTERS = [
  ['branchId', 'branchIds'],
  ['branchIds', 'branchIds'],
  ['locationId', 'locationIds'],
  ['locationIds', 'locationIds'],
  ['teamId', 'teamIds'],
  ['teamIds', 'teamIds'],
] as const;

const DRILLDOWN_TARGETS: Record<string, { module: string; entityType: string; path: string }> = {
  'financial.general_ledger': { module: 'ledger', entityType: 'general_ledger', path: 'reports' },
  'financial.trial_balance': { module: 'ledger', entityType: 'trial_balance', path: 'reports' },
  'financial.profit_and_loss': { module: 'ledger', entityType: 'profit_and_loss', path: 'reports' },
  'financial.balance_sheet': { module: 'ledger', entityType: 'balance_sheet', path: 'reports' },
  'ar.aging': { module: 'accounting-documents', entityType: 'ar_aging', path: 'accounting' },
  'ap.aging': { module: 'procurement', entityType: 'ap_aging', path: 'accounts-payable' },
  'sales.summary': { module: 'reports', entityType: 'sales_summary', path: 'reports' },
  'sales.pipeline': { module: 'crm', entityType: 'pipeline_summary', path: 'crm' },
  'inventory.stock_balance': { module: 'inventory', entityType: 'stock_balance', path: 'inventory' },
  'inventory.stock_movement': { module: 'inventory', entityType: 'stock_movement', path: 'inventory/reports/stock' },
  'inventory.reorder': { module: 'inventory', entityType: 'reorder_report', path: 'inventory' },
  'expense.summary': { module: 'expenses', entityType: 'expense_summary', path: 'expenses' },
  'expense.accountant_evidence': { module: 'expenses', entityType: 'accountant_evidence', path: 'expenses' },
  'tax.summary': { module: 'tax', entityType: 'tax_summary', path: 'tax' },
  'bank.cash_position': { module: 'banking', entityType: 'cash_position', path: 'banking' },
  'ops.workflow_sla': { module: 'workflow', entityType: 'workflow_sla', path: 'workflow' },
  'ops.dashboard_health': { module: 'dashboard-notifications', entityType: 'dashboard_snapshot', path: 'dashboard' },
  'ai.suggestion_summary': { module: 'ai-draft', entityType: 'ai_suggestion_summary', path: 'ai-suggestions' },
};

function filterIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string' && value ? [value] : [];
}

function viewFiltersStillAuthorized(
  ctx: RequestContext,
  filters: ReportViewDto['filters'],
  branchAuthorizedLocationIds?: ReadonlySet<string>,
): boolean {
  return VIEW_SCOPE_FILTERS.every(([filterKey, scopeKey]) => {
    const current = ctx.scopes?.[scopeKey]
      ?? (scopeKey === 'locationIds' && branchAuthorizedLocationIds ? [...branchAuthorizedLocationIds] : undefined);
    if (!current) return true;
    const selected = filterIds(filters[filterKey]);
    return selected.every((value) => current.includes(value));
  });
}

type StoredReportArtifact = Pick<PutObjectResult, 'bucket' | 'objectKey' | 'objectVersionId'>;

function encodeStorageKey(stored: StoredReportArtifact): string {
  return JSON.stringify(stored);
}

function decodeStorageKey(value?: string): StoredReportArtifact {
  if (!value) throw new GoneException({ code: 'report_export_unavailable', message: 'Report export artifact is unavailable' });
  try {
    const parsed = JSON.parse(value) as Partial<StoredReportArtifact>;
    if (typeof parsed.bucket !== 'string' || typeof parsed.objectKey !== 'string' || typeof parsed.objectVersionId !== 'string') throw new Error();
    return { bucket: parsed.bucket, objectKey: parsed.objectKey, objectVersionId: parsed.objectVersionId };
  } catch {
    throw new GoneException({ code: 'report_export_unavailable', message: 'Report export artifact is unavailable' });
  }
}

function materializeDefinition(definition: ReturnType<typeof findReportDefinition>, adapters: ReportSourceAdapters, ctx: RequestContext): ReportDatasetDefinitionDto | null {
  if (!definition) return null;
  const status = visibleDatasetStatus(ctx, {
    requiredReportPermissions: definition.requiredReportPermissions,
    requiredSourcePermissions: definition.requiredSourcePermissions,
    sourcePermissionMode: definition.sourcePermissionMode,
  });
  if (status !== 'ENABLED') return { ...definition, status };
  if (!adapters.isAvailable(definition.code)) {
    return { ...definition, status: 'UNAVAILABLE', unavailableReason: 'source_query_port_not_ready' };
  }
  return { ...definition, status: definition.status ?? 'ENABLED' };
}

type ReportExecutionResult = ReportResultDto & {
  sourcePermissionsUsed: string[];
  pendingRun: CreateReportRunData;
};

@Injectable()
export class ListReportCatalogUseCase {
  constructor(private readonly adapters: ReportSourceAdapters) {}

  execute(ctx: RequestContext, companyId: string): ReportCatalogDto {
    ensureCompany(ctx, companyId);
    if (!ctx.permissions.includes(REPORT_PERMISSION_KEYS.CATALOG_READ)) throw new ForbiddenException('Missing permission: report.catalog.read');
    return {
      generatedAt: new Date().toISOString(),
      datasets: REPORT_CATALOG
        .map((definition) => materializeDefinition(definition, this.adapters, ctx))
        .filter((definition): definition is ReportDatasetDefinitionDto => Boolean(definition)),
    };
  }
}

@Injectable()
export class RunReportQueryUseCase {
  constructor(
    private readonly repo: PrismaReportRepository,
    private readonly adapters: ReportSourceAdapters,
    private readonly audit: AuditService,
    private readonly entitlement: ReportEntitlementService,
  ) {}

  async execute(ctx: RequestContext, companyId: string, input: ReportQueryInput & { viewId?: string }): Promise<ReportResultDto> {
    const { sourcePermissionsUsed: _sourcePermissionsUsed, pendingRun: _pendingRun, ...result } = await this.executeInternal(ctx, companyId, input, false);
    return result;
  }

  async executeForExport(
    ctx: RequestContext,
    companyId: string,
    input: ReportQueryInput & { viewId?: string },
    expectedEntitlement?: ReportEntitlementStamp,
  ): Promise<ReportExecutionResult> {
    return this.executeInternal(ctx, companyId, input, true, expectedEntitlement);
  }

  private async executeInternal(
    ctx: RequestContext,
    companyId: string,
    input: ReportQueryInput & { viewId?: string },
    forExport: boolean,
    expectedEntitlement?: ReportEntitlementStamp,
  ): Promise<ReportExecutionResult> {
    ensureCompany(ctx, companyId);
    const entitlementStamp = expectedEntitlement ?? await this.entitlement.assertEnabled(companyId);
    const definition = materializeDefinition(findReportDefinition(input.datasetCode), this.adapters, ctx);
    if (!definition) throw new NotFoundException('Report dataset not found');
    if (!canRunReport(ctx, definition)) throw new ForbiddenException('Missing report or source permission');
    const validatedQuery = validateReportQuery(definition, input);
    const query = forExport
      ? { ...validatedQuery, page: 1, pageSize: REPORT_SYNC_EXPORT_MAX_ROWS }
      : validatedQuery;
    const declaredSourcePermissions = effectiveSourcePermissions(ctx, definition, query.filters);
    if (definition.status === 'UNAVAILABLE') {
      const pendingRun: CreateReportRunData = {
        id: forExport ? randomUUID() : undefined,
        companyId,
        requestedByUserId: ctx.userId,
        datasetCode: definition.code,
        datasetVersion: definition.version,
        viewId: input.viewId,
        status: 'UNAVAILABLE',
        filters: query.filters,
        permissionSnapshot: { sourcePermissions: declaredSourcePermissions },
        sourceScopeSnapshot: ctx.scopes ?? {},
        rowCount: 0,
        computedAt: new Date(),
        sourceFreshness: { unavailableReason: definition.unavailableReason },
        sourceRefsPreview: {},
        errorCode: 'source_query_port_not_ready',
      };
      const row = forExport
        ? { id: pendingRun.id! }
        : await this.entitlement.withEnabledFence(companyId, entitlementStamp, (tx) => this.repo.createRun(pendingRun, tx));
      return {
        runId: row.id,
        dataset: definition,
        status: 'UNAVAILABLE',
        computedAt: new Date().toISOString(),
        freshness: { computedAt: new Date().toISOString(), sourceModules: [definition.sourceModule], freshnessStatus: 'unknown', staleReason: definition.unavailableReason },
        warnings: [definition.unavailableReason ?? 'source_query_port_not_ready'],
        columns: [],
        rows: [],
        sourceRefs: [],
        filters: query.filters,
        page: query.page,
        pageSize: query.pageSize,
        total: 0,
        sourcePermissionsUsed: declaredSourcePermissions,
        pendingRun,
      };
    }

    const result = forExport
      ? await this.adapters.executeForExport(ctx, definition, query)
      : await this.adapters.execute(ctx, definition, query);
    if (forExport && result.total > REPORT_SYNC_EXPORT_MAX_ROWS) {
      throw new PayloadTooLargeException({
        code: 'export_too_large',
        message: `รายงานมีมากกว่า ${REPORT_SYNC_EXPORT_MAX_ROWS.toLocaleString('en-US')} แถว กรุณาลดช่วงข้อมูลแล้วลองใหม่`,
        maxRows: REPORT_SYNC_EXPORT_MAX_ROWS,
        actualRows: result.total,
      });
    }
    if (forExport && result.rows.length !== result.total) {
      throw new ConflictException({
        code: 'export_result_incomplete',
        message: 'สร้างไฟล์ได้ไม่ครบทุกแถว กรุณาลองใหม่',
      });
    }
    const sourcePermissionsUsed = [...new Set([
      ...declaredSourcePermissions,
      ...(result.sourcePermissionsUsed ?? []),
    ])];
    if (sourcePermissionsUsed.some((permission) => !ctx.permissions.includes(permission))) {
      throw new ForbiddenException('Report adapter used an authority not present in the request context');
    }
    const pendingRun: CreateReportRunData = {
      id: forExport ? randomUUID() : undefined,
      companyId,
      requestedByUserId: ctx.userId,
      datasetCode: definition.code,
      datasetVersion: definition.version,
      viewId: input.viewId,
      status: result.status,
      filters: query.filters,
      permissionSnapshot: { sourcePermissions: sourcePermissionsUsed },
      sourceScopeSnapshot: ctx.scopes ?? {},
      rowCount: result.total,
      computedAt: new Date(result.computedAt),
      sourceFreshness: result.freshness,
      sourceRefsPreview: { refs: result.sourceRefs.slice(0, 10) },
      errorCode: result.status === 'FAILED' ? 'report_query_failed' : undefined,
    };
    const run = forExport
      ? { id: pendingRun.id! }
      : await this.entitlement.withEnabledFence(companyId, entitlementStamp, (tx) => this.repo.createRun(pendingRun, tx));
    if (!forExport) {
      void this.audit.log({
        companyId,
        actorUserId: ctx.userId,
        action: 'report.query.run',
        targetType: 'report_dataset',
        targetId: definition.code,
        requestId: ctx.requestId,
        result: 'SUCCESS',
        riskLevel: 'LOW',
        metadataJson: { datasetCode: definition.code, runId: run.id, rowCount: result.total },
      });
    }
    return { ...result, runId: run.id, dataset: definition, sourcePermissionsUsed, pendingRun };
  }
}

@Injectable()
export class GetReportRunUseCase {
  constructor(
    private readonly repo: PrismaReportRepository,
    private readonly entitlement: ReportEntitlementService,
  ) {}

  async execute(ctx: RequestContext, companyId: string, runId: string) {
    ensureCompany(ctx, companyId);
    if (!ctx.permissions.includes(REPORT_PERMISSION_KEYS.SNAPSHOT_READ)) throw new ForbiddenException('Missing permission: report.snapshot.read');
    const run = await this.repo.getRun(companyId, runId);
    if (!run) throw new NotFoundException('Report run not found');
    if (run.requestedByUserId !== ctx.userId && !ctx.permissions.includes(REPORT_PERMISSION_KEYS.AUDIT_READ)) {
      throw new ForbiddenException('Cannot read this report run');
    }
    const definition = ensureCurrentSourceAccess(ctx, run.datasetCode);
    const permissionSnapshot = run.permissionSnapshotJson && typeof run.permissionSnapshotJson === 'object' && !Array.isArray(run.permissionSnapshotJson)
      ? run.permissionSnapshotJson as Record<string, unknown>
      : {};
    const originalSourcePermissions = Array.isArray(permissionSnapshot.sourcePermissions)
      ? permissionSnapshot.sourcePermissions
      : undefined;
    const legacyPermissions = Array.isArray(permissionSnapshot.permissions)
      ? permissionSnapshot.permissions
      : undefined;
    const originalEffectivePermissions = Array.isArray(originalSourcePermissions)
      ? originalSourcePermissions
      : Array.isArray(legacyPermissions)
        ? definition.requiredSourcePermissions.filter((permission) => legacyPermissions.includes(permission))
      : undefined;
    ensureOriginalSourceAuthority(ctx, originalEffectivePermissions);
    ensureCurrentScopeAccess(ctx, run.sourceScopeSnapshotJson);
    if (!(await this.entitlement.isEnabled(companyId))) ensureRetainedRead(ctx);
    const {
      permissionSnapshotJson: _permissionSnapshotJson,
      sourceScopeSnapshotJson: _sourceScopeSnapshotJson,
      sourceRefsPreviewJson: _sourceRefsPreviewJson,
      ...publicRun
    } = run;
    return publicRun;
  }
}

@Injectable()
export class ListReportRunsUseCase {
  constructor(
    private readonly repo: PrismaReportRepository,
    private readonly entitlement: ReportEntitlementService,
  ) {}

  async execute(
    ctx: RequestContext,
    companyId: string,
    input: { cursor?: string; pageSize?: number } = {},
  ): Promise<ReportRunHistoryPageDto> {
    ensureCompany(ctx, companyId);
    if (!ctx.permissions.includes(REPORT_PERMISSION_KEYS.SNAPSHOT_READ)) {
      throw new ForbiddenException('Missing permission: report.snapshot.read');
    }
    if (!(await this.entitlement.isEnabled(companyId))) ensureRetainedRead(ctx);
    const requestedPageSize = Number.isFinite(input.pageSize) ? input.pageSize! : 10;
    const pageSize = Math.min(Math.max(Math.trunc(requestedPageSize), 1), 50);
    const canAudit = ctx.permissions.includes(REPORT_PERMISSION_KEYS.AUDIT_READ);
    const visible: ReportRunHistoryPageDto['items'] = [];
    let scanCursor = input.cursor;

    while (visible.length < pageSize + 1) {
      const rows = await this.repo.listRunCandidates(companyId, ctx.userId, canAudit, scanCursor, 100);
      if (rows.length === 0) break;
      for (const run of rows) {
        scanCursor = run.id;
        const definition = findReportDefinition(run.datasetCode);
        if (!definition || !hasSourcePermission(ctx, definition.requiredSourcePermissions, definition.sourcePermissionMode)) continue;
        const snapshot = run.permissionSnapshotJson && typeof run.permissionSnapshotJson === 'object' && !Array.isArray(run.permissionSnapshotJson)
          ? run.permissionSnapshotJson as Record<string, unknown>
          : {};
        const exact = Array.isArray(snapshot.sourcePermissions)
          ? snapshot.sourcePermissions
          : Array.isArray(snapshot.permissions)
            ? definition.requiredSourcePermissions.filter((permission) => (snapshot.permissions as unknown[]).includes(permission))
            : undefined;
        if (!sourcePermissionSnapshotStillAuthorized(ctx, exact) || !scopeSnapshotStillAuthorized(ctx, run.sourceScopeSnapshotJson)) continue;
        visible.push({
          id: run.id,
          datasetCode: run.datasetCode,
          datasetTitle: definition.title,
          datasetVersion: run.datasetVersion,
          status: run.status,
          rowCount: run.rowCount,
          computedAt: run.computedAt?.toISOString(),
          createdAt: run.createdAt.toISOString(),
          errorCode: run.errorCode ?? undefined,
          own: run.requestedByUserId === ctx.userId,
        });
        if (visible.length === pageSize + 1) break;
      }
      if (rows.length < 100) break;
    }

    const items = visible.slice(0, pageSize);
    return {
      items,
      pageSize,
      nextCursor: visible.length > pageSize ? items.at(-1)?.id : undefined,
    };
  }
}

@Injectable()
export class ListReportViewsUseCase {
  constructor(
    private readonly repo: PrismaReportRepository,
    private readonly entitlement: ReportEntitlementService,
  ) {}

  async execute(ctx: RequestContext, companyId: string): Promise<ReportViewDto[]> {
    ensureCompany(ctx, companyId);
    if (!ctx.permissions.includes(REPORT_PERMISSION_KEYS.VIEW_READ)) throw new ForbiddenException('Missing permission: report.view.read');
    const reportsEnabled = await this.entitlement.isEnabled(companyId);
    if (!reportsEnabled) ensureRetainedRead(ctx);
    const views = await this.repo.listViews(companyId, ctx.userId);
    const filteredLocationIds = [...new Set(views.flatMap((view) => [
      ...filterIds(view.filters.locationId),
      ...filterIds(view.filters.locationIds),
    ]))];
    const branchAuthorizedLocationIds = ctx.scopes.locationIds || !ctx.scopes.branchIds || filteredLocationIds.length === 0
      ? undefined
      : new Set(await this.repo.listAuthorizedLocationIds(companyId, filteredLocationIds, ctx.scopes.branchIds));
    return views
      .filter((view) => {
        const definition = findReportDefinition(view.datasetCode);
        return !!definition
          && hasSourcePermission(ctx, definition.requiredSourcePermissions, definition.sourcePermissionMode)
          && ((reportsEnabled && !view.sourcePermissionSnapshot)
            || (sourcePermissionSnapshotStillAuthorized(ctx, view.sourcePermissionSnapshot)
              && scopeSnapshotStillAuthorized(ctx, view.sourceScopeSnapshot)))
          && viewFiltersStillAuthorized(ctx, view.filters, branchAuthorizedLocationIds);
      })
      .map(({ sourcePermissionSnapshot: _sourcePermissionSnapshot, sourceScopeSnapshot: _sourceScopeSnapshot, ...view }) => view);
  }
}

@Injectable()
export class CreateReportViewUseCase {
  constructor(
    private readonly repo: PrismaReportRepository,
    private readonly adapters: ReportSourceAdapters,
    private readonly audit: AuditService,
    private readonly entitlement: ReportEntitlementService,
  ) {}

  async execute(ctx: RequestContext, companyId: string, input: CreateReportViewInput): Promise<ReportViewDto> {
    ensureCompany(ctx, companyId);
    const entitlementStamp = await this.entitlement.assertEnabled(companyId);
    if (!ctx.permissions.includes(REPORT_PERMISSION_KEYS.VIEW_CREATE)) throw new ForbiddenException('Missing permission: report.view.create');
    if (input.visibility && input.visibility !== 'PRIVATE' && !ctx.permissions.includes(REPORT_PERMISSION_KEYS.VIEW_SHARE)) {
      throw new ForbiddenException('Missing permission: report.view.share');
    }
    const definition = materializeDefinition(findReportDefinition(input.datasetCode), this.adapters, ctx);
    if (!definition) throw new NotFoundException('Report dataset not found');
    if (definition.status === 'FORBIDDEN') throw new ForbiddenException('Missing report or source permission');
    const sourcePermissionSnapshot = effectiveSourcePermissions(ctx, definition, input.filters);
    validateReportQuery(definition, { datasetCode: input.datasetCode, filters: input.filters, dimensions: input.dimensions, measures: input.measures, sort: input.sort, chartKind: input.chartConfig?.chartKind });
    const view = await this.entitlement.withEnabledFence(companyId, entitlementStamp, (tx) => this.repo.createView(
      companyId,
      ctx.userId,
      {
        ...input,
        datasetVersion: definition.version,
        sourcePermissionSnapshot,
        sourceScopeSnapshot: ctx.scopes ?? {},
      },
      tx,
    ));
    void this.audit.log({ companyId, actorUserId: ctx.userId, action: 'report.view.create', targetType: 'report_view', targetId: view.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: input.visibility === 'PRIVATE' || !input.visibility ? 'LOW' : 'MEDIUM', metadataJson: { datasetCode: input.datasetCode, visibility: view.visibility } });
    return view;
  }
}

@Injectable()
export class UpdateReportViewUseCase {
  constructor(
    private readonly repo: PrismaReportRepository,
    private readonly adapters: ReportSourceAdapters,
    private readonly audit: AuditService,
    private readonly entitlement: ReportEntitlementService,
  ) {}

  async execute(ctx: RequestContext, companyId: string, viewId: string, input: UpdateReportViewInput): Promise<ReportViewDto> {
    ensureCompany(ctx, companyId);
    const entitlementStamp = await this.entitlement.assertEnabled(companyId);
    if (!ctx.permissions.includes(REPORT_PERMISSION_KEYS.VIEW_UPDATE_OWN)) throw new ForbiddenException('Missing permission: report.view.update_own');
    const current = await this.repo.findView(companyId, viewId);
    if (!current) throw new NotFoundException('Report view not found');
    const canManageAny = ctx.permissions.includes(REPORT_PERMISSION_KEYS.VIEW_MANAGE) && (ctx.roles.includes('OWNER') || ctx.roles.includes('ADMIN'));
    if (current.ownerUserId !== ctx.userId && !canManageAny) throw new ForbiddenException('Cannot update this report view');
    const definition = materializeDefinition(findReportDefinition(current.datasetCode), this.adapters, ctx);
    if (!definition) throw new NotFoundException('Report dataset not found');
    if (definition.status === 'FORBIDDEN') throw new ForbiddenException('Missing report or source permission');
    const merged = {
      filters: input.filters ?? current.filters,
      dimensions: input.dimensions ?? current.dimensions,
      measures: input.measures ?? current.measures,
      sort: input.sort ?? current.sort,
      chartKind: input.chartConfig?.chartKind ?? current.chartConfig.chartKind,
    };
    validateReportQuery(definition, { datasetCode: current.datasetCode, ...merged });
    const sourcePermissionSnapshot = effectiveSourcePermissions(ctx, definition, merged.filters);
    if (input.visibility && input.visibility !== 'PRIVATE' && !ctx.permissions.includes(REPORT_PERMISSION_KEYS.VIEW_SHARE)) {
      throw new ForbiddenException('Missing permission: report.view.share');
    }
    const view = await this.entitlement.withEnabledFence(
      companyId,
      entitlementStamp,
      (tx) => this.repo.updateView(companyId, viewId, {
        ...input,
        sourcePermissionSnapshot,
        sourceScopeSnapshot: ctx.scopes ?? {},
      }, tx),
    );
    void this.audit.log({ companyId, actorUserId: ctx.userId, action: 'report.view.update', targetType: 'report_view', targetId: view.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: view.visibility === 'PRIVATE' ? 'LOW' : 'MEDIUM' });
    return view;
  }
}

@Injectable()
export class ArchiveReportViewUseCase {
  constructor(
    private readonly repo: PrismaReportRepository,
    private readonly audit: AuditService,
    private readonly entitlement: ReportEntitlementService,
  ) {}

  async execute(ctx: RequestContext, companyId: string, viewId: string): Promise<{ archived: true }> {
    ensureCompany(ctx, companyId);
    const entitlementStamp = await this.entitlement.assertEnabled(companyId);
    if (!ctx.permissions.includes(REPORT_PERMISSION_KEYS.VIEW_UPDATE_OWN)) throw new ForbiddenException('Missing permission: report.view.update_own');
    const current = await this.repo.findView(companyId, viewId);
    if (!current) throw new NotFoundException('Report view not found');
    const canManageAny = ctx.permissions.includes(REPORT_PERMISSION_KEYS.VIEW_MANAGE) && (ctx.roles.includes('OWNER') || ctx.roles.includes('ADMIN'));
    if (current.ownerUserId !== ctx.userId && !canManageAny) throw new ForbiddenException('Cannot archive this report view');
    await this.entitlement.withEnabledFence(companyId, entitlementStamp, (tx) => this.repo.archiveView(companyId, viewId, tx));
    void this.audit.log({ companyId, actorUserId: ctx.userId, action: 'report.view.archive', targetType: 'report_view', targetId: viewId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW' });
    return { archived: true };
  }
}

@Injectable()
export class CreateReportExportUseCase {
  constructor(
    private readonly repo: PrismaReportRepository,
    private readonly runQuery: RunReportQueryUseCase,
    private readonly audit: AuditService,
    private readonly notify: CreateOrUpdateNotificationEventUseCase,
    private readonly entitlement: ReportEntitlementService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly objectVersionCleanup: ObjectVersionCleanupService,
  ) {}

  async execute(ctx: RequestContext, companyId: string, input: CreateReportExportInput): Promise<ReportExportRequestDto> {
    ensureCompany(ctx, companyId);
    const entitlementStamp = await this.entitlement.assertEnabled(companyId);
    if (!ctx.permissions.includes(REPORT_PERMISSION_KEYS.EXPORT)) throw new ForbiddenException('Missing permission: report.export');

    if (!input || input.format !== 'CSV') {
      throw new BadRequestException({
        code: 'export_format_unavailable',
        message: 'ยังไม่รองรับรูปแบบนี้ กรุณาเลือก CSV',
      });
    }
    const definition = findReportDefinition(input.datasetCode);
    if (!definition) throw new NotFoundException('Report dataset not found');
    const sourcePermissionSnapshot = effectiveSourcePermissions(ctx, definition, input.filters);

    const result = await this.runQuery.executeForExport(
      ctx,
      companyId,
      {
        datasetCode: input.datasetCode,
        filters: input.filters,
        page: 1,
        pageSize: REPORT_MAX_PAGE_SIZE,
        viewId: input.viewId,
      },
      entitlementStamp,
    );
    if (result.total > REPORT_SYNC_EXPORT_MAX_ROWS) {
      throw new PayloadTooLargeException({
        code: 'export_too_large',
        message: `รายงานมีมากกว่า ${REPORT_SYNC_EXPORT_MAX_ROWS.toLocaleString('en-US')} แถว กรุณาลดช่วงข้อมูลแล้วลองใหม่`,
        maxRows: REPORT_SYNC_EXPORT_MAX_ROWS,
        actualRows: result.total,
      });
    }
    if (result.rows.length !== result.total) {
      throw new ConflictException({
        code: 'export_result_incomplete',
        message: 'สร้างไฟล์ได้ไม่ครบทุกแถว กรุณาลองใหม่',
      });
    }
    // Avoid uploading bytes when OFF/ABA already happened during report computation. The final
    // transaction repeats the same exact-generation check to cover a transition during upload.
    await this.entitlement.withEnabledFence(companyId, entitlementStamp, async () => undefined);

    const csv = buildReportCsv(reportResultForPeople(result));
    const hash = sha256(csv);
    const csvBytes = Buffer.from(csv, 'utf8');
    const csvByteSize = csvBytes.byteLength;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const mimeType = 'text/csv; charset=utf-8';
    const stored = await this.storage.putObject({
      objectKey: `report-export/${companyId}/${result.runId}/${hash}.csv`,
      mimeType,
      bytes: csvBytes,
    });
    if (stored.checksumSha256 !== hash || stored.byteSize !== csvByteSize) {
      await this.objectVersionCleanup.enqueue({
        companyId,
        bucket: stored.bucket,
        objectPath: stored.objectKey,
        expectedVersion: stored.objectVersionId,
        source: 'REPORT_EXPORT',
      });
      throw new ConflictException({
        code: 'report_export_integrity_failed',
        message: 'ตรวจสอบไฟล์ที่จัดเก็บไม่ผ่าน ระบบยังไม่ได้บันทึกไฟล์ส่งออก',
      });
    }
    let request: ReportExportRequestDto;
    try {
      request = await this.entitlement.withEnabledFence(companyId, entitlementStamp, async (tx) => {
        const run = await this.repo.createRun(result.pendingRun, tx);
        return this.repo.createExport({
          companyId,
          requestedByUserId: ctx.userId,
          datasetCode: input.datasetCode,
          datasetVersion: result.dataset.version,
          viewId: input.viewId,
          runId: run.id,
          input,
          status: 'READY',
          rowCount: result.rows.length,
          fileName: `${input.datasetCode.replace(/[^a-z0-9_.-]/gi, '_')}-${todayCivilDate()}${result.status === 'PARTIAL' ? '-ข้อมูลบางส่วน' : ''}.csv`,
          fileMimeType: mimeType,
          fileSizeBytes: stored.byteSize,
          storageKey: encodeStorageKey(stored),
          sourceScopeSnapshot: ctx.scopes ?? {},
          sourcePermissionSnapshot: result.sourcePermissionsUsed,
          coverageWarnings: result.warnings,
          sha256: hash,
          expiresAt,
        }, tx);
      });
    } catch (error) {
      await this.objectVersionCleanup.enqueue({
        companyId,
        bucket: stored.bucket,
        objectPath: stored.objectKey,
        expectedVersion: stored.objectVersionId,
        source: 'REPORT_EXPORT',
      });
      throw error;
    }
    await this.audit.log({ companyId, actorUserId: ctx.userId, action: 'report.export.request', targetType: 'report_export_request', targetId: request.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { datasetCode: input.datasetCode, rowCount: result.rows.length, sha256: hash } });
    await this.notify.execute({
      companyId,
      triggerKey: 'report_ready',
      sourceModule: 'reports',
      sourceType: 'report_export',
      sourceId: request.id,
      severity: 'info',
      // Thai like every other notification title: this one is pushed to LINE, where it is the whole
      // message rather than a row in a list the workspace already frames.
      title: 'ไฟล์รายงานพร้อมดาวน์โหลดแล้ว',
      body: `ไฟล์ CSV ของรายงาน "${result.dataset.title}" พร้อมให้ดาวน์โหลดแล้ว`,
      deepLinkHref: `/companies/${companyId}/reports?exportId=${encodeURIComponent(request.id)}`,
      sourceRefs: result.sourceRefs,
      recipientUserIds: [ctx.userId],
      periodKey: todayCivilDate(),
    }).catch(() => undefined);
    return { ...request, datasetTitle: definition.title };
  }
}

@Injectable()
export class ListReportExportsUseCase {
  constructor(
    private readonly repo: PrismaReportRepository,
    private readonly entitlement: ReportEntitlementService,
  ) {}

  async execute(ctx: RequestContext, companyId: string): Promise<ReportExportRequestDto[]> {
    ensureCompany(ctx, companyId);
    const canManage = ctx.permissions.includes(REPORT_PERMISSION_KEYS.EXPORT_MANAGE);
    if (!canManage && !ctx.permissions.includes(REPORT_PERMISSION_KEYS.EXPORT_READ_OWN)) throw new ForbiddenException('Missing permission: report.export.read_own');
    const reportsEnabled = await this.entitlement.isEnabled(companyId);
    if (!reportsEnabled) ensureRetainedRead(ctx);
    const now = Date.now();
    return (await this.repo.listExports(companyId, ctx.userId, canManage))
      .filter((request) => {
        const definition = findReportDefinition(request.datasetCode);
        return !!definition
          && hasSourcePermission(ctx, definition.requiredSourcePermissions, definition.sourcePermissionMode)
          && ((reportsEnabled && !request.sourcePermissionSnapshot)
            || (sourcePermissionSnapshotStillAuthorized(ctx, request.sourcePermissionSnapshot)
              && scopeSnapshotStillAuthorized(ctx, request.sourceScopeSnapshot)));
      })
      .map(({ storageKey, sourceScopeSnapshot: _sourceScopeSnapshot, sourcePermissionSnapshot: _sourcePermissionSnapshot, ...request }) => {
        const publicRequest = { ...request, datasetTitle: findReportDefinition(request.datasetCode)?.title };
        if (request.status === 'READY' && request.expiresAt && new Date(request.expiresAt).getTime() < now) {
          return {
            ...publicRequest,
            status: 'EXPIRED' as const,
            errorCode: 'report_export_expired',
            errorMessage: reportsEnabled
              ? 'ไฟล์หมดอายุแล้ว กรุณาสร้างไฟล์ CSV ใหม่'
              : 'ไฟล์หมดอายุแล้ว กรุณาติดต่อผู้ดูแลให้เปิดฟีเจอร์รายงานเพื่อสร้างไฟล์ใหม่',
          };
        }
        // Pre-U3 READY rows never persisted bytes. Project them honestly instead of offering a
        // download that would have to rerun live data or asking the customer to migrate anything.
        if (request.status === 'READY' && !storageKey) {
          return {
            ...publicRequest,
            status: 'FAILED' as const,
            rowCount: 0,
            errorCode: 'legacy_export_not_materialized',
            // Same reportsEnabled split as the expired branch: a disabled-family company
            // cannot create a new export, so never instruct it to.
            errorMessage: reportsEnabled
              ? 'ไฟล์เดิมไม่ได้เก็บเนื้อหาไว้ กรุณาสร้างไฟล์ CSV ใหม่'
              : 'ไฟล์เดิมไม่ได้เก็บเนื้อหาไว้ กรุณาติดต่อผู้ดูแลให้เปิดฟีเจอร์รายงานเพื่อสร้างไฟล์ใหม่',
          };
        }
        return publicRequest;
      });
  }
}

@Injectable()
export class DownloadReportExportUseCase {
  constructor(
    private readonly repo: PrismaReportRepository,
    private readonly audit: AuditService,
    private readonly entitlement: ReportEntitlementService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
  ) {}

  async execute(ctx: RequestContext, companyId: string, exportId: string): Promise<ReportExportDownloadDto> {
    ensureCompany(ctx, companyId);
    const request = await this.repo.findExport(companyId, exportId);
    if (!request) throw new NotFoundException('Report export not found');
    const canDownloadAny = ctx.permissions.includes(REPORT_PERMISSION_KEYS.EXPORT_MANAGE);
    const canDownloadOwn = request.requestedByUserId === ctx.userId && ctx.permissions.includes(REPORT_PERMISSION_KEYS.EXPORT_READ_OWN);
    if (!canDownloadAny && !canDownloadOwn) throw new ForbiddenException('Missing permission: report.export.read_own');
    const reportsEnabled = await this.entitlement.isEnabled(companyId);
    ensureCurrentSourceAccess(ctx, request.datasetCode);
    if (!reportsEnabled) ensureRetainedRead(ctx);
    if (!request.sourcePermissionSnapshot) {
      if (!reportsEnabled) ensureOriginalSourceAuthority(ctx, request.sourcePermissionSnapshot);
      // Reachable only while reports is ON: the disabled path already threw
      // report_artifact_authority_changed above, so "create a new CSV" is always actionable here.
      throw new GoneException({
        code: 'legacy_export_not_materialized',
        message: 'ไฟล์เดิมไม่ได้เก็บเนื้อหาไว้ กรุณาสร้างไฟล์ CSV ใหม่',
      });
    }
    ensureOriginalSourceAuthority(ctx, request.sourcePermissionSnapshot);
    ensureCurrentScopeAccess(ctx, request.sourceScopeSnapshot);
    if (request.expiresAt && new Date(request.expiresAt).getTime() < Date.now()) {
      throw new GoneException({
        code: 'report_export_expired',
        message: reportsEnabled
          ? 'ไฟล์หมดอายุแล้ว กรุณาสร้างไฟล์ CSV ใหม่'
          : 'ไฟล์หมดอายุแล้ว กรุณาติดต่อผู้ดูแลให้เปิดฟีเจอร์รายงานเพื่อสร้างไฟล์ใหม่',
      });
    }
    if (request.status !== 'READY') {
      throw new NotFoundException({ code: 'report_export_not_ready', message: 'Report export is not ready' });
    }
    const locator = decodeStorageKey(request.storageKey);
    if (!locator.objectKey.startsWith(`report-export/${companyId}/`)) {
      throw new GoneException({ code: 'report_export_integrity_failed', message: 'Report export storage ownership check failed' });
    }
    const content = (await this.storage.getObject(locator).catch(() => {
      throw new GoneException({ code: 'report_export_unavailable', message: 'Report export artifact is unavailable' });
    })).bytes.toString('utf8');
    const hash = sha256(content);
    if (!/^[a-f0-9]{64}$/.test(request.sha256 ?? '') || hash !== request.sha256) {
      throw new GoneException({ code: 'report_export_integrity_failed', message: 'Report export integrity check failed' });
    }
    await this.audit.log({ companyId, actorUserId: ctx.userId, action: 'report.export.download', targetType: 'report_export_request', targetId: request.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { datasetCode: request.datasetCode, sha256: hash } });
    const {
      storageKey: _storageKey,
      sourceScopeSnapshot: _sourceScopeSnapshot,
      sourcePermissionSnapshot: _sourcePermissionSnapshot,
      filters: _filters,
      ...publicRequest
    } = request;
    return {
      request: { ...publicRequest, datasetTitle: findReportDefinition(request.datasetCode)?.title },
      content,
    };
  }
}

@Injectable()
export class ReportDrilldownUseCase {
  constructor(
    private readonly repo: PrismaReportRepository,
    private readonly entitlement: ReportEntitlementService,
  ) {}

  async execute(ctx: RequestContext, companyId: string, input: ReportDrilldownInput): Promise<ReportDrilldownDto> {
    ensureCompany(ctx, companyId);
    const entitlementStamp = await this.entitlement.assertEnabled(companyId);
    const definition = findReportDefinition(input.datasetCode);
    if (!definition) throw new NotFoundException('Report dataset not found');
    const sourceAllowed = hasSourcePermission(ctx, definition.requiredSourcePermissions, definition.sourcePermissionMode);
    const target = DRILLDOWN_TARGETS[input.datasetCode];
    const expectedPath = target ? `/companies/${companyId}/${target.path}` : undefined;
    const trustedTarget = !!target
      && input.sourceRef.module === target.module
      && input.sourceRef.entityType === target.entityType
      && input.sourceRef.webPath === expectedPath;
    await this.entitlement.withEnabledFence(companyId, entitlementStamp, (tx) => this.repo.createDrilldownLog({
      companyId,
      userId: ctx.userId,
      datasetCode: input.datasetCode,
      sourceModule: input.sourceRef.module,
      sourceType: input.sourceRef.entityType,
      sourceId: input.sourceRef.entityId,
      result: sourceAllowed && trustedTarget ? 'ALLOWED' : 'DENIED',
      reason: !sourceAllowed ? 'missing_source_permission' : trustedTarget ? undefined : 'untrusted_source_ref',
      requestId: ctx.requestId,
    }, tx));
    if (!sourceAllowed || !trustedTarget) return { allowed: false, reason: sourceAllowed ? 'untrusted_source_ref' : 'missing_source_permission' };
    return { allowed: true, webPath: expectedPath };
  }
}
