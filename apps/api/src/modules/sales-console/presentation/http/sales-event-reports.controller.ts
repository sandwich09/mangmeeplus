/**
 * `GET /v1/sales/events/report` — the sales-event report (sales-event spec §7.1, §10).
 *
 * Its own controller so the batch console (`SalesEventsController`, `sales/events/*`) stays one
 * owner's file. Same guard shape as `reports/summary`: `sales.report.read` (a lead and SYSTEM_ADMIN;
 * never a plain เซลล์, spec §9) plus a platform-tenant membership.
 */
import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import type { SalesEventReport } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { SalesEventReportsService } from '../../application/sales-event-reports.service';
import { assertPlatformTenant } from '../../application/sales-context';

@Controller('sales/events/report')
export class SalesEventReportsController {
  constructor(private readonly reports: SalesEventReportsService) {}

  @Get()
  @RequirePermissions('sales.report.read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Event discounts per event, batch and agent — separate from sales credit (SD-Q3)' })
  @ApiResponse({ status: 400, description: 'SALES_REPORT_RANGE_INVALID' })
  report(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('teamLeadUserId') teamLeadUserId: string | undefined,
    @Query('salesUserId') salesUserId: string | undefined,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesEventReport> {
    assertPlatformTenant(req.context);
    return this.reports.report(req.context, { from, to, teamLeadUserId, salesUserId });
  }
}
