/**
 * `/v1/sales/*` — the sales console (spec §11).
 *
 * Every route requires a platform-tenant membership (§10) on top of its permission: the
 * permission answers "may this role do it", `assertPlatformTenant` answers "is this caller
 * actually มั่งมี staff and not a company-scoped role that happens to be named the same".
 */
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, MaxLength, ValidateIf } from 'class-validator';
import type { Request } from 'express';
import {
  SALES_DEAL_BASE_TIERS,
  SALES_DEAL_CYCLES_MAX,
  SALES_DEAL_DESCRIPTION_MAX,
  SALES_DEAL_REASON_MAX,
  SALES_ROLE_KEYS,
  type SalesDealBaseTier,
  type SalesDealCadence,
  type SalesAgentCreateResult,
  type SalesAgentListDto,
  type SalesAgentCredentialHandoff,
  type SalesCompanySearchDto,
  type SalesDealListDto,
  type SalesDealView,
  type SalesMyWorkDto,
  type SalesReportSummary,
} from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { SalesAgentsService } from '../../application/sales-agents.service';
import { SalesCompanySearchService } from '../../application/sales-company-search.service';
import { SalesDealsService } from '../../application/sales-deals.service';
import { SalesReportsService } from '../../application/sales-reports.service';
import { assertPlatformTenant } from '../../application/sales-context';

export class SalesDealSaveDto {
  @IsString() @IsNotEmpty() @MaxLength(40) companyId!: string;
  // The runtime rule lives in buildDealSnapshot (it also rejects the free trial); this keeps the
  // DTO assignable to SalesDealSaveBody so the contract is checked at compile time too.
  @IsIn([...SALES_DEAL_BASE_TIERS]) base!: SalesDealBaseTier;
  @IsInt() @Min(1) priceSatang!: number;
  @IsInt() @Min(1) months!: number;
  @IsInt() @Min(1) branchLimit!: number;
  @IsInt() @Min(1) employeeLimit!: number;
  @IsInt() @Min(1) monthlySlipLimit!: number;
  @IsArray() @IsString({ each: true }) featureKeys!: string[];
  // D-P5-1: the auto-renew switch. `buildDealSnapshot` owns the cross-field rules (a cadence is
  // required when the switch is on and refused when it is off); these only bound the shapes.
  @IsBoolean() @IsOptional() autoRenew?: boolean;
  @ValidateIf((dto) => dto.cadence !== null && dto.cadence !== undefined) @IsIn(['month', 'year']) cadence?: SalesDealCadence | null;
  @ValidateIf((dto) => dto.cycles !== null && dto.cycles !== undefined) @IsInt() @Min(1) @Max(SALES_DEAL_CYCLES_MAX) cycles?: number | null;
  // null is a real value (inherit the platform default), so it is validated conditionally.
  // D-P3-2: zero is not a choice — closing AI removes the `ai_line_assistant` menu instead.
  @ValidateIf((dto) => dto.aiMonthlyBudgetSatang !== null) @IsInt() @Min(1) aiMonthlyBudgetSatang!: number | null;
  @IsString() @IsNotEmpty() @MaxLength(SALES_DEAL_DESCRIPTION_MAX) description!: string;
  @IsString() @IsNotEmpty() @MaxLength(SALES_DEAL_REASON_MAX) internalReason!: string;
  @IsInt() @IsOptional() version?: number;
}

/** reject / cancel: the reason is what the agent reads back, so it is required (R5). */
export class SalesDealDecisionDto {
  @IsInt() version!: number;
  @IsString() @IsNotEmpty() @MaxLength(SALES_DEAL_REASON_MAX) reason!: string;
}

/** approve: optional note — the audit row already records the approver and selfApproved. */
export class SalesDealApproveDto {
  @IsInt() version!: number;
  @IsString() @IsOptional() @MaxLength(SALES_DEAL_REASON_MAX) reason?: string;
}

export class SalesDealSubmitDto {
  @IsInt() version!: number;
}

export class SalesTeamCreateDto {
  @IsString() @IsNotEmpty() @MaxLength(40) username!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) displayName!: string;
  @IsString() @IsOptional() @MaxLength(20) phoneNumber?: string;
  @IsString() @IsOptional() @MaxLength(254) email?: string;
  @IsIn([...SALES_ROLE_KEYS]) role!: 'MANGMEE_SALES_LEAD' | 'MANGMEE_SALES';
  @IsString() @IsOptional() @MaxLength(6) salesCode?: string;
}

@Controller('sales')
export class SalesController {
  constructor(
    private readonly deals: SalesDealsService,
    private readonly companies: SalesCompanySearchService,
    private readonly agents: SalesAgentsService,
    private readonly reports: SalesReportsService,
  ) {}

  @Get('companies')
  @RequirePermissions('sales.company.search')
  @ApiOperation({ summary: 'Search shops by name — name, package state, province only (R11/Q4)' })
  @ApiResponse({ status: 200, description: 'Up to 20 shops; the search itself is audited LOW' })
  searchCompanies(
    @Query('q') q: string,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesCompanySearchDto> {
    assertPlatformTenant(req.context);
    return this.companies.search(q, { userId: req.context.userId, requestId: req.context.requestId });
  }

  @Get('deals')
  @RequirePermissions('sales.console.read')
  @ApiOperation({ summary: 'Deals — own only for an agent, every team for a lead; ?status= and ?salesUserId= narrow' })
  @ApiResponse({ status: 400, description: 'SALES_DEAL_STATE_CONFLICT — unknown status filter' })
  listDeals(
    @Query('status') status: string | undefined,
    @Query('salesUserId') salesUserId: string | undefined,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesDealListDto> {
    assertPlatformTenant(req.context);
    return this.deals.list(req.context, { status, salesUserId });
  }

  @Get('my-work')
  @RequirePermissions('sales.console.read')
  @ApiOperation({ summary: 'Derived work list and badge count (Q6/S30)' })
  myWork(@Req() req: Request & { context: RequestContext }): Promise<SalesMyWorkDto> {
    assertPlatformTenant(req.context);
    return this.deals.myWork(req.context);
  }

  /**
   * R13/§17.2 — how many shops this agent opened, per Bangkok month, net of refunds. An agent is
   * forced onto their own rows inside the service; the query parameters only narrow a lead's view.
   */
  @Get('reports/summary')
  @RequirePermissions('sales.report.read')
  @ApiOperation({ summary: 'Per-agent per-month activations and amount (no financial documents, S21)' })
  @ApiResponse({ status: 400, description: 'SALES_REPORT_RANGE_INVALID' })
  reportSummary(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('teamLeadUserId') teamLeadUserId: string | undefined,
    @Query('salesUserId') salesUserId: string | undefined,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesReportSummary> {
    assertPlatformTenant(req.context);
    return this.reports.summary(req.context, { from, to, teamLeadUserId, salesUserId });
  }

  @Get('deals/:dealId')
  @RequirePermissions('sales.console.read')
  @ApiOperation({ summary: 'One deal with its company preview and over-limit counts (S31)' })
  getDeal(
    @Param('dealId') dealId: string,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesDealView> {
    assertPlatformTenant(req.context);
    return this.deals.get(req.context, dealId);
  }

  @Post('deals')
  @HttpCode(201)
  @RequirePermissions('sales.deal.create')
  @ApiOperation({ summary: 'Create a DRAFT deal' })
  @ApiResponse({ status: 409, description: 'SALES_DEAL_ALREADY_OPEN — one non-final deal per shop' })
  createDeal(
    @Body() dto: SalesDealSaveDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesDealView> {
    assertPlatformTenant(req.context);
    return this.deals.save(req.context, dto);
  }

  @Put('deals/:dealId')
  @RequirePermissions('sales.deal.create')
  @ApiOperation({ summary: 'Edit a DRAFT or REJECTED deal; an APPROVED one is immutable (R4)' })
  updateDeal(
    @Param('dealId') dealId: string,
    @Body() dto: SalesDealSaveDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesDealView> {
    assertPlatformTenant(req.context);
    return this.deals.save(req.context, dto, dealId);
  }

  @Post('deals/:dealId/submit')
  @HttpCode(200)
  @RequirePermissions('sales.deal.create')
  @ApiOperation({ summary: 'Send a deal for approval' })
  submitDeal(
    @Param('dealId') dealId: string,
    @Body() dto: SalesDealSubmitDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesDealView> {
    assertPlatformTenant(req.context);
    return this.deals.submit(req.context, dealId, dto.version);
  }

  @Post('deals/:dealId/approve')
  @HttpCode(200)
  @RequirePermissions('sales.deal.approve')
  @ApiOperation({ summary: 'Approve: sets offerExpiresAt and pushes the shop owners a numberless notice' })
  @ApiResponse({ status: 409, description: 'SALES_DEAL_STATE_CONFLICT / SALES_COMPANY_HAS_OPEN_REQUEST' })
  approveDeal(
    @Param('dealId') dealId: string,
    @Body() dto: SalesDealApproveDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesDealView> {
    assertPlatformTenant(req.context);
    return this.deals.approve(req.context, dealId, dto.version, dto.reason);
  }

  @Post('deals/:dealId/reject')
  @HttpCode(200)
  @RequirePermissions('sales.deal.approve')
  @ApiOperation({ summary: 'Reject with a reason the agent reads; nothing reaches the customer' })
  rejectDeal(
    @Param('dealId') dealId: string,
    @Body() dto: SalesDealDecisionDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesDealView> {
    assertPlatformTenant(req.context);
    return this.deals.reject(req.context, dealId, dto.version, dto.reason);
  }

  @Post('deals/:dealId/end')
  @HttpCode(200)
  @RequirePermissions('sales.deal.approve')
  @ApiOperation({ summary: 'D-P5-6 "จบดีล": record the cycle end an auto-renewing deal stops at' })
  @ApiResponse({ status: 409, description: 'SALES_DEAL_END_INVALID / SALES_DEAL_STATE_CONFLICT' })
  endDeal(
    @Param('dealId') dealId: string,
    @Body() dto: SalesDealDecisionDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesDealView> {
    assertPlatformTenant(req.context);
    return this.deals.end(req.context, dealId, dto.version, dto.reason);
  }

  @Post('deals/:dealId/cancel')
  @HttpCode(200)
  @RequirePermissions('sales.deal.create')
  @ApiOperation({ summary: 'Cancel before payment (agent or lead)' })
  cancelDeal(
    @Param('dealId') dealId: string,
    @Body() dto: SalesDealDecisionDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesDealView> {
    assertPlatformTenant(req.context);
    return this.deals.cancel(req.context, dealId, dto.version, dto.reason);
  }

  // ── team (lead) ──────────────────────────────────────────────────────────────────────
  // The lead's half of agent management: create and reset inside their own team, and never a
  // single tax/bank field — that surface is `/v1/system/sales-agents` under its own key (S10).

  @Get('team')
  @RequirePermissions('sales.team.manage')
  @ApiOperation({ summary: 'Agents in the caller own team' })
  listTeam(@Req() req: Request & { context: RequestContext }): Promise<SalesAgentListDto> {
    assertPlatformTenant(req.context);
    return this.agents.list(req.context);
  }

  @Post('team')
  @HttpCode(201)
  @RequirePermissions('sales.team.manage')
  @ApiOperation({ summary: 'Create an agent in own team; the temporary password is returned once' })
  createTeamMember(
    @Body() dto: SalesTeamCreateDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesAgentCreateResult> {
    assertPlatformTenant(req.context);
    return this.agents.create(req.context, dto);
  }

  @Post('team/:userId/credential')
  @HttpCode(200)
  @RequirePermissions('sales.team.manage')
  @ApiOperation({ summary: 'Reset an own-team agent password; shown once, pushed if LINE-linked' })
  resetTeamCredential(
    @Param('userId') userId: string,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SalesAgentCredentialHandoff> {
    assertPlatformTenant(req.context);
    return this.agents.resetCredential(req.context, userId);
  }
}
