/**
 * `/v1/system/sales-agents*` — the Owner's half of the sales team (spec §11, §12 Admin console).
 *
 * Everything that touches the tax/bank record sits behind `sales.agent_profile.manage`, which only
 * SYSTEM_ADMIN holds: a team lead can create and reset agents but must never read or export a
 * national id or a bank account (S10/R11).
 */
import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested,
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
  type SalesReferralUpdateBody,
} from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { SalesAgentsService } from '../../application/sales-agents.service';
import { SalesReferralService } from '../../application/sales-referral.service';
import { assertPlatformTenant } from '../../application/sales-context';

export class SalesAgentProfileDtoIn {
  @IsString() @IsNotEmpty() @MaxLength(200) legalName!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) nationalId!: string;
  @IsString() @IsOptional() @MaxLength(40) taxId?: string | null;
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
  constructor(private readonly agents: SalesAgentsService) {}

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

/** D6: the Owner's referral repair, kept beside the partner console it belongs to in the UI. */
@Controller('system/partners')
export class SystemSalesReferralController {
  constructor(private readonly referral: SalesReferralService) {}

  @Patch(':companyId/referral')
  @RequirePermissions('sales.agent_profile.manage')
  @ApiOperation({ summary: 'Set or clear a shop referring agent, within 30 days, with a reason' })
  @ApiResponse({ status: 409, description: 'SALES_REFERRAL_WINDOW_CLOSED' })
  setReferral(
    @Param('companyId') companyId: string,
    @Body() dto: SalesReferralUpdateDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<{ companyId: string; referralSalesUserId: string | null }> {
    assertPlatformTenant(req.context);
    const body: SalesReferralUpdateBody = { salesCode: dto.salesCode ?? null, reason: dto.reason };
    return this.referral.setCompanyReferral(req.context, companyId, body.salesCode, body.reason);
  }
}
