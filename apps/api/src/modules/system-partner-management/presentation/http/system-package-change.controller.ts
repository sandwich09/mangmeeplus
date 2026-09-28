import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import type {
  AdminPackageChangeDecisionDto,
  AdminPackageChangeQueueDto,
} from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PackageChangeDecisionUseCase } from '../../application/use-cases/package-change-decision.use-case';

const PACKAGE_CHANGE_STATUSES = ['OPEN', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

export class PackageChangeDecisionBodyDto {
  @IsIn(['APPROVE', 'REJECT']) action!: 'APPROVE' | 'REJECT';
  // Free text an operator types, pushed into the shop's LINE chat with the outcome. Bounded like
  // every other paragraph crossing a trust boundary; nothing renders it as markup.
  @IsString() @IsOptional() @MaxLength(200) note?: string;
}

/**
 * P10-L §8, the "คำขอเปลี่ยนแพ็กเกจ" tab.
 *
 * It lives beside the plan-term writer on purpose: APPROVE ends in `SetCompanyPlanTermUseCase`, so
 * a customer's limits still move in exactly one place, under the very permission that already
 * guards `PUT /system/partners/:id/plan-term`. No new permission key.
 */
@Controller('system/package-change-requests')
export class SystemPackageChangeController {
  constructor(private readonly packageChange: PackageChangeDecisionUseCase) {}

  @Get()
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Package-change requests waiting on an admin (default OPEN)' })
  @ApiResponse({ status: 200 })
  list(@Query('status') status?: string): Promise<AdminPackageChangeQueueDto> {
    const known = PACKAGE_CHANGE_STATUSES.find((candidate) => candidate === status);
    return this.packageChange.list(known ?? 'OPEN');
  }

  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Approve (moves the tier) or reject one package-change request' })
  @ApiResponse({ status: 200, description: 'Current status — repeating a decision is a no-op' })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 422, description: 'The requested tier is not in the catalog' })
  decide(
    @Param('id') id: string,
    @Body() dto: PackageChangeDecisionBodyDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<AdminPackageChangeDecisionDto> {
    return this.packageChange.decide(id, dto, req.context.userId, req.context.requestId);
  }
}
