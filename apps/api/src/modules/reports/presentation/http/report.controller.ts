import { Body, Controller, Get, Param, Patch, Post, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CreateReportExportInput, CreateReportViewInput, ReportDrilldownInput, ReportQueryInput, RequestContext, UpdateReportViewInput } from '@watchdog-bms/contracts';
import { REPORT_PERMISSION_KEYS } from '@watchdog-bms/contracts';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import {
  ArchiveReportViewUseCase,
  CreateReportExportUseCase,
  CreateReportViewUseCase,
  DownloadReportExportUseCase,
  GetReportRunUseCase,
  ListReportExportsUseCase,
  ListReportCatalogUseCase,
  ListReportRunsUseCase,
  ListReportViewsUseCase,
  ReportDrilldownUseCase,
  RunReportQueryUseCase,
  UpdateReportViewUseCase,
} from '../../application/report.use-cases';

@ApiTags('reports')
@Controller('companies/:companyId/reports')
export class ReportController {
  constructor(
    private readonly catalog: ListReportCatalogUseCase,
    private readonly queryReport: RunReportQueryUseCase,
    private readonly getRun: GetReportRunUseCase,
    private readonly listRuns: ListReportRunsUseCase,
    private readonly listViews: ListReportViewsUseCase,
    private readonly createView: CreateReportViewUseCase,
    private readonly updateView: UpdateReportViewUseCase,
    private readonly archiveView: ArchiveReportViewUseCase,
    private readonly listExports: ListReportExportsUseCase,
    private readonly createExport: CreateReportExportUseCase,
    private readonly downloadExport: DownloadReportExportUseCase,
    private readonly drilldown: ReportDrilldownUseCase,
  ) {}

  @Get('catalog')
  @RequirePermissions(REPORT_PERMISSION_KEYS.CATALOG_READ)
  @ApiOperation({ summary: 'List report catalog' })
  catalogHandler(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string) {
    return this.catalog.execute(ctx, companyId);
  }

  @Post('query')
  @RequirePermissions(REPORT_PERMISSION_KEYS.CATALOG_READ, REPORT_PERMISSION_KEYS.DATASET_READ, REPORT_PERMISSION_KEYS.QUERY_RUN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Run a report query' })
  queryHandler(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: ReportQueryInput) {
    return this.queryReport.execute(ctx, companyId, body);
  }

  @Get('runs/:runId')
  @RequirePermissions(REPORT_PERMISSION_KEYS.SNAPSHOT_READ)
  @ApiOperation({ summary: 'Get report run metadata' })
  runHandler(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('runId') runId: string) {
    return this.getRun.execute(ctx, companyId, runId);
  }

  @Get('runs')
  @RequirePermissions(REPORT_PERMISSION_KEYS.SNAPSHOT_READ)
  @ApiOperation({ summary: 'List permission-filtered report run history' })
  runsHandler(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const parsedPageSize = pageSize === undefined ? undefined : Number(pageSize);
    return this.listRuns.execute(ctx, companyId, {
      cursor,
      pageSize: Number.isFinite(parsedPageSize) ? parsedPageSize : undefined,
    });
  }

  @Post('drilldown')
  @RequirePermissions(REPORT_PERMISSION_KEYS.CATALOG_READ, REPORT_PERMISSION_KEYS.DATASET_READ, REPORT_PERMISSION_KEYS.QUERY_RUN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve a permission-checked source drilldown link' })
  drilldownHandler(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: ReportDrilldownInput) {
    return this.drilldown.execute(ctx, companyId, body);
  }

  @Get('views')
  @RequirePermissions(REPORT_PERMISSION_KEYS.VIEW_READ)
  @ApiOperation({ summary: 'List own/shared report saved views' })
  viewsHandler(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string) {
    return this.listViews.execute(ctx, companyId);
  }

  @Post('views')
  @RequirePermissions(REPORT_PERMISSION_KEYS.VIEW_CREATE)
  @ApiOperation({ summary: 'Create report saved view' })
  createViewHandler(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateReportViewInput) {
    return this.createView.execute(ctx, companyId, body);
  }

  @Patch('views/:viewId')
  @RequirePermissions(REPORT_PERMISSION_KEYS.VIEW_UPDATE_OWN)
  @ApiOperation({ summary: 'Update report saved view' })
  updateViewHandler(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('viewId') viewId: string, @Body() body: UpdateReportViewInput) {
    return this.updateView.execute(ctx, companyId, viewId, body);
  }

  @Post('views/:viewId/archive')
  @RequirePermissions(REPORT_PERMISSION_KEYS.VIEW_UPDATE_OWN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive report saved view' })
  archiveViewHandler(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('viewId') viewId: string) {
    return this.archiveView.execute(ctx, companyId, viewId);
  }

  @Get('exports')
  @RequireAnyPermission(REPORT_PERMISSION_KEYS.EXPORT_READ_OWN, REPORT_PERMISSION_KEYS.EXPORT_MANAGE)
  @ApiOperation({ summary: 'List recent report exports' })
  exportsHandler(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string) {
    return this.listExports.execute(ctx, companyId);
  }

  @Post('exports')
  @RequirePermissions(REPORT_PERMISSION_KEYS.EXPORT)
  @ApiOperation({ summary: 'Request report export' })
  exportHandler(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateReportExportInput) {
    return this.createExport.execute(ctx, companyId, body);
  }

  @Get('exports/:exportId/download')
  @RequireAnyPermission(REPORT_PERMISSION_KEYS.EXPORT_READ_OWN, REPORT_PERMISSION_KEYS.EXPORT_MANAGE)
  @ApiOperation({ summary: 'Download report export content' })
  downloadHandler(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('exportId') exportId: string, @Query('format') _format?: string) {
    return this.downloadExport.execute(ctx, companyId, exportId);
  }
}
