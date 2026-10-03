import { Controller, Get, Header, Param, Query, Req, UseFilters } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import {
  EXECUTIVE_RANKING_METRICS, EXECUTIVE_REPORT_LABELS, EXECUTIVE_SORT_OPTIONS,
  type ExecutiveAnalysisQuery, type ExecutiveCompaniesQuery, type ExecutiveHistoryQuery, type ExecutiveRankingMetric, type ExecutiveReportQuery, type ExecutiveSortBy,
} from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { assertPlatformTenant } from '../../../sales-console/application/sales-context';
import { ExecutiveReportReadService } from '../../application/executive-report-read.service';
import { ExecutiveAccountExceptionFilter } from './executive-users.controller';

const keysOf = (filter: keyof typeof EXECUTIVE_REPORT_LABELS) => Object.keys(EXECUTIVE_REPORT_LABELS[filter]);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** §12.4: the month and the report's own filters. A value outside the contract is 400, never widened to ALL. */
export class ExecutiveReportQueryDto implements ExecutiveReportQuery {
  @IsString() @Matches(MONTH) month!: string;
  @IsOptional() @IsString() @MaxLength(64) buildId?: string;
  @IsOptional() @IsIn(keysOf('industry')) industry?: string;
  @IsOptional() @IsIn(keysOf('discovery')) discovery?: string;
  /** ALL / NONE / UNKNOWN / UNRESOLVED or a sales code; the service checks the code against the sellers that exist. */
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,40}$/) referringSales?: string;
}

export class ExecutiveCompaniesQueryDto extends ExecutiveReportQueryDto implements ExecutiveCompaniesQuery {
  @IsOptional() @IsIn(keysOf('companyStatus')) companyStatus?: string;
  @IsOptional() @IsIn(keysOf('planState')) planState?: string;
  @IsOptional() @IsIn(keysOf('usageGroup')) usageGroup?: string;
  @IsOptional() @IsIn(['true', 'false']) usageAssessed?: 'true' | 'false';
  @IsOptional() @IsIn(['true']) activeInPeriod?: 'true';
  @IsOptional() @IsIn(['true']) paidInPeriod?: 'true';
  @IsOptional() @IsIn(['true']) positiveNetInPeriod?: 'true';
  @IsOptional() @IsIn(keysOf('paidEver')) paidEver?: string;
  @IsOptional() @IsIn(['true']) fullyRefunded?: 'true';
  @IsOptional() @IsIn(keysOf('receiptAdoption')) receiptAdoption?: string;
  @IsOptional() @IsIn(keysOf('spendCohort')) spendCohort?: string;
  @IsOptional() @IsIn(keysOf('signupRail')) signupRail?: string;
  /** Names and provinces only, never an id, a contact or a tax number; trimmed, at most 120 characters, never logged. */
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsIn(EXECUTIVE_SORT_OPTIONS.map((option) => option.sortBy)) sortBy?: ExecutiveSortBy;
  @IsOptional() @IsIn(['asc', 'desc']) sortDir?: 'asc' | 'desc';
  /** A page past the last answers the last page. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class ExecutiveAnalysisQueryDto extends ExecutiveReportQueryDto implements ExecutiveAnalysisQuery {
  @IsIn(['usage', 'revenue', 'customers', 'compare']) section!: ExecutiveAnalysisQuery['section'];
  @IsOptional() @IsIn(['adoption', 'ranking', 'summary', 'top', 'industry', 'discovery', 'sales']) view?: string;
  @IsOptional() @IsIn(EXECUTIVE_RANKING_METRICS) metric?: ExecutiveRankingMetric;
  @IsOptional() @IsIn(['industry', 'discovery', 'referringSales', 'company']) dimension?: string;
  @IsOptional() @IsString() @MaxLength(64) sideA?: string;
  @IsOptional() @IsString() @MaxLength(64) sideB?: string;
}

export class ExecutiveCompanyQueryDto implements ExecutiveReportQuery {
  @IsString() @Matches(MONTH) month!: string;
  @IsOptional() @IsString() @MaxLength(64) buildId?: string;
}

export class ExecutiveHistoryQueryDto implements ExecutiveHistoryQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

type ExecutiveRequest = Request & { context: RequestContext };

/**
 * The executive report's read routes (executive backend spec §16.1 API01–API06). Every route needs `system.executive.read`
 * AND the platform company as the caller's context; the target company is `:targetCompanyId` only, never `:companyId` or the
 * `X-Company-Id` header, which AuthGuard reads as the caller's own company (RB-01).
 */
@Controller('system/executive')
@UseFilters(new ExecutiveAccountExceptionFilter('คุณไม่มีสิทธิ์ดูรายงานนี้'))
export class ExecutiveReportController {
  constructor(private readonly report: ExecutiveReportReadService) {}

  @Get('context')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.executive.read')
  context(@Req() req: ExecutiveRequest) {
    assertPlatformTenant(req.context);
    return this.report.context(req.context);
  }

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.executive.read')
  overview(@Query() query: ExecutiveReportQueryDto, @Req() req: ExecutiveRequest) {
    assertPlatformTenant(req.context);
    return this.report.overview(req.context, query);
  }

  @Get('companies')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.executive.read')
  companies(@Query() query: ExecutiveCompaniesQueryDto, @Req() req: ExecutiveRequest) {
    assertPlatformTenant(req.context);
    return this.report.companies(req.context, query);
  }

  @Get('analysis')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.executive.read')
  analysis(@Query() query: ExecutiveAnalysisQueryDto, @Req() req: ExecutiveRequest) {
    assertPlatformTenant(req.context);
    return this.report.analysis(req.context, query);
  }

  @Get('companies/:targetCompanyId')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.executive.read')
  company(@Param('targetCompanyId') targetCompanyId: string, @Query() query: ExecutiveCompanyQueryDto, @Req() req: ExecutiveRequest) {
    assertPlatformTenant(req.context);
    return this.report.company(req.context, targetCompanyId, query);
  }

  @Get('companies/:targetCompanyId/history')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.executive.read')
  history(@Param('targetCompanyId') targetCompanyId: string, @Query() query: ExecutiveHistoryQueryDto, @Req() req: ExecutiveRequest) {
    assertPlatformTenant(req.context);
    return this.report.history(req.context, targetCompanyId, query);
  }
}
