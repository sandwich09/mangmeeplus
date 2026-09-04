import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { PLAN_TIER_PRESETS, type PackageChangeRequestDto } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PackageChangeRequestUseCase } from '../../application/package-change-request.use-case';

const PLAN_TIER_KEYS = Object.keys(PLAN_TIER_PRESETS);

export class CreatePackageChangeRequestDto {
  @IsIn(PLAN_TIER_KEYS) requestedTierKey!: string;
  // Free text the shop owner types, read by an admin. Bounded like every other paragraph that
  // crosses a trust boundary; nothing renders it as markup.
  @IsString() @IsOptional() @MaxLength(500) note?: string;
}

/**
 * P10-L §3.7/§8. "Ask to change package" from inside the shop. It opens a request in the admin
 * queue and never touches the tier — that still happens only through the partner plan-term route,
 * which is what keeps one place where a customer's limits can move (H-01).
 *
 * Guarded by `company.setup.manage`, the existing company-settings permission an OWNER holds. No
 * new permission key: asking about your own plan is a settings action, not a new authority.
 */
@Controller('companies/:companyId/package-change-requests')
export class CompanyPackageChangeController {
  constructor(private readonly packageChange: PackageChangeRequestUseCase) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('company.setup.manage')
  @ApiOperation({ summary: 'Ask an admin to move this company to another package' })
  @ApiResponse({ status: 201, description: 'The open request — the same one on a repeated ask' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreatePackageChangeRequestDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<PackageChangeRequestDto> {
    return this.packageChange.create({
      companyId,
      requestedByUserId: req.context.userId,
      requestedTierKey: dto.requestedTierKey,
      ...(dto.note ? { note: dto.note } : {}),
      requestId: req.context.requestId,
    });
  }

  @Get()
  @RequirePermissions('company.setup.manage')
  @ApiOperation({ summary: 'This company own package-change requests, newest first' })
  list(@Param('companyId') companyId: string): Promise<PackageChangeRequestDto[]> {
    return this.packageChange.listForCompany(companyId);
  }
}
