/**
 * `/v1/system/sales-agents*` — the Owner's half of the sales team (spec §11, §12 Admin console).
 *
 * Admin reads, updates and exports sit behind `sales.agent_profile.manage`.
 * Scoped lead and self access is exposed by `/v1/sales/*` (S10/R11).
 */
import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import {
  SALES_ROLE_KEYS,
  type SalesAgentCreateResult,
  type SalesAgentCredentialHandoff,
  type SalesAgentListDto,
  type SalesAgentProfileDto,
  type SalesAgentView,
  type SalesAttributionFlagListDto,
  type SalesAttributionFlagReviewBody,
  type SalesReferralUpdateBody,
} from '@watchdog-bms/contracts';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { SalesAgentsService } from '../../application/sales-agents.service';
import { SalesReferralService } from '../../application/sales-referral.service';
import { SalesReportsService } from '../../application/sales-reports.service';
import { ListThaiAddressesUseCase } from '../../../employee-access/application/use-cases/list-thai-addresses.use-case';
import { assertPlatformTenant } from '../../application/sales-context';

export class SalesAgentProfileDtoIn {
  @IsString() @IsNotEmpty() @MaxLength(200) legalName!: string;
  @IsString() @IsNotEmpty() @MaxLength(13) @Matches(/^\d{13}$/) nationalId!: string;
  @IsString() @IsOptional() @MaxLength(13) @Matches(/^\d{13}$/) taxId?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(500) address!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) bankName!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) bankAccount!: string;
  @IsInt() @Min(0) @Max(100) whtRatePercent!: number;
}

export class SystemSalesAgentCreateDto {
  @IsString() @IsNotEmpty() @MaxLength(40) username!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) displayName!: string;
  @IsString() @IsOptional() @MaxLength(20) phoneNumber?: string;
  @IsString() @IsOptional() @MaxLength(254) email?: string;
  @IsIn([...SALES_ROLE_KEYS]) role!: 'MANGMEE_SALES_LEAD' | 'MANGMEE_SALES';
  @IsString() @IsOptional() @MaxLength(40) teamLeadUserId?: string | null;
  @IsString() @IsOptional() @MaxLength(6) salesCode?: string;
  @IsObject() @IsOptional() @ValidateNested() @Type(() => SalesAgentProfileDtoIn) profile?: SalesAgentProfileDtoIn;
}

export class SystemSalesAgentUpdateDto {
  @IsString() @IsOptional() @MaxLength(120) displayName?: string;
  @IsString() @IsOptional() @MaxLength(20) phoneNumber?: string | null;
  @IsString() @IsOptional() @MaxLength(254) email?: string | null;
  @IsString() @IsOptional() @MaxLength(40) teamLeadUserId?: string | null;
  @IsString() @IsOptional() @MaxLength(6) salesCode?: string;
  @IsIn(['ACTIVE', 'SUSPENDED']) @IsOptional() status?: 'ACTIVE' | 'SUSPENDED';
  @IsObject() @IsOptional() @ValidateNested() @Type(() => SalesAgentProfileDtoIn) profile?: SalesAgentProfileDtoIn;
  @IsString() @IsOptional() @MaxLength(500) reason?: string;
}

export class SalesReferralUpdateDto {
  // null clears the referral; a code sets it. Both need a reason (§17.1).
  @IsString() @IsOptional() @MaxLength(6) salesCode!: string | null;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

@Controller('system/sales-agents')
export class SystemSalesAgentsController {
  constructor(private readonly agents: SalesAgentsService, private readonly listThaiAddresses: ListThaiAddressesUseCase) {}

  @Get('address-master')
  @RequireAnyPermission('sales.agent_profile.manage', 'sales.team.manage')
  @ApiOperation({ summary: 'Thai address options for the sales payroll profile' })
  addresses(@Query('postalCode') postalCode = '', @Req() req: Request & { context: RequestContext }) {
    assertPlatformTenant(req.context);
    return this.listThaiAddresses.execute(postalCode);
  }

  @Get()
  @RequirePermissions('sales.agent_profile.manage')
  @ApiOperation({ summary: 'Every sales agent and lead (no PII fields in the list)' })
  list(@Req() req: Request & { context: RequestContext }): Promise<SalesAgentListDto> {
    assertPlatformTenant(req.context);
    return this.agents.list(req.context);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('sales.agent_profile.manage')
  @ApiOperation({ summary: 'Create an agent or lead, optionally with the payroll record' })
  @ApiResponse({ status: 201, description: 'The agent plus a one-time temporary password' })
  create(
    @Body() dto: SystemSalesAgentCreateDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesAgentCreateResult> {
    assertPlatformTenant(req.context);
    return this.agents.create(req.context, dto);
  }

  /**
   * Ahead of `:userId` on purpose: Nest matches in declaration order, and `export.csv` would
   * otherwise be read as a userId.
   */
  @Get('export.csv')
  @RequirePermissions('sales.agent_profile.manage')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="sales-agents.csv"')
  @ApiOperation({ summary: 'Payroll export with decrypted PII — SYSTEM_ADMIN only, audited HIGH' })
  exportCsv(@Req() req: Request & { context: RequestContext }): Promise<string> {
    assertPlatformTenant(req.context);
    return this.agents.exportCsv(req.context);
  }

  @Patch(':userId')
  @RequirePermissions('sales.agent_profile.manage')
  @ApiOperation({ summary: 'Update an agent; a status change requires a reason' })
  update(
    @Param('userId') userId: string,
    @Body() dto: SystemSalesAgentUpdateDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesAgentView> {
    assertPlatformTenant(req.context);
    return this.agents.update(req.context, userId, dto);
  }

  @Get(':userId/profile')
  @RequirePermissions('sales.agent_profile.manage')
  @ApiOperation({ summary: 'Decrypted tax and bank record; every read audited MEDIUM (S10)' })
  profile(
    @Param('userId') userId: string,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesAgentProfileDto> {
    assertPlatformTenant(req.context);
    return this.agents.readProfile(req.context, userId);
  }

  @Post(':userId/credential')
  @HttpCode(200)
  @RequirePermissions('sales.agent_profile.manage')
  @ApiOperation({ summary: 'Issue a fresh temporary password; shown once, pushed if LINE-linked' })
  credential(
    @Param('userId') userId: string,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesAgentCredentialHandoff> {
    assertPlatformTenant(req.context);
    return this.agents.resetCredential(req.context, userId);
  }
}

/**
 * D6: the Owner's referral repair, kept beside the partner console it belongs to in the UI.
 *
 * The target shop is `:partnerCompanyId`, never `:companyId`: AuthGuard reads a parameter of that
 * name as the caller's own company, and the admin has no membership in the shop (RB-40).
 */
@Controller('system/partners')
export class SystemSalesReferralController {
  constructor(private readonly referral: SalesReferralService) {}

  @Patch(':partnerCompanyId/referral')
  @RequirePermissions('sales.agent_profile.manage')
  @ApiOperation({ summary: 'Set or clear a shop referring agent, within 30 days, with a reason' })
  @ApiResponse({ status: 409, description: 'SALES_REFERRAL_WINDOW_CLOSED' })
  setReferral(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: SalesReferralUpdateDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<{ companyId: string; referralSalesUserId: string | null }> {
    assertPlatformTenant(req.context);
    const body: SalesReferralUpdateBody = { salesCode: dto.salesCode ?? null, reason: dto.reason };
    return this.referral.setCompanyReferral(req.context, companyId, body.salesCode, body.reason);
  }
}

export class SalesAttributionFlagReviewDto {
  // true = "ตัดออก" (the flag stands); false = "ยืนยันว่าไม่ผิดปกติ" (clear it and start counting).
  @IsBoolean() keep!: boolean;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

/**
 * §17.1 anti-gaming — the Owner's review queue. SYSTEM_ADMIN only (`sales.agent_profile.manage`):
 * a lead must never be able to clear a flag raised against their own team.
 */
@Controller('system/sales-attribution')
export class SystemSalesAttributionController {
  constructor(private readonly reports: SalesReportsService) {}

  @Get('flags')
  @RequirePermissions('sales.agent_profile.manage')
  @ApiOperation({ summary: 'Attribution rows carrying an anti-gaming flag, unreviewed first' })
  flags(@Req() req: Request & { context: RequestContext }): Promise<SalesAttributionFlagListDto> {
    assertPlatformTenant(req.context);
    return this.reports.flagged();
  }

  @Post(':partnerCompanyId/review')
  @HttpCode(200)
  @RequirePermissions('sales.agent_profile.manage')
  @ApiOperation({ summary: 'Keep or clear a flag, with a reason; audited HIGH' })
  @ApiResponse({ status: 400, description: 'SALES_FLAG_REVIEW_INVALID' })
  review(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: SalesAttributionFlagReviewDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesAttributionFlagListDto> {
    assertPlatformTenant(req.context);
    const body: SalesAttributionFlagReviewBody = { keep: dto.keep, reason: dto.reason };
    return this.reports.reviewFlag(req.context, companyId, body.keep, body.reason);
  }
}
