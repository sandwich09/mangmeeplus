import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import {
  RECONCILIATION_KINDS,
  RECONCILIATION_STATUSES,
  type ReconciliationKind,
  type ReconciliationStatus,
} from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { GenerateIdentityReconciliationUseCase } from '../../application/use-cases/generate-identity-reconciliation.use-case';
import { ReadIdentityReconciliationUseCase } from '../../application/use-cases/read-identity-reconciliation.use-case';
import { ResolveIdentityReconciliationUseCase } from '../../application/use-cases/resolve-identity-reconciliation.use-case';

class CommandBaseDto {
  @IsString() @IsNotEmpty() @MaxLength(64) commandId!: string;
  @IsString() @IsNotEmpty() expectedSourceFingerprint!: string;
}

class ResolveTaxIdDto extends CommandBaseDto {
  @IsIn(['COMPANY', 'PROFILE', 'MANUAL']) chosen!: 'COMPANY' | 'PROFILE' | 'MANUAL';
  @IsString() @IsOptional() manualValue?: string;
  @IsIn(['LEGAL_CHANGE', 'DATA_RECONCILIATION']) resolutionKind!: 'LEGAL_CHANGE' | 'DATA_RECONCILIATION';
  @IsString() @IsOptional() effectiveFrom?: string;
  @IsString() @IsNotEmpty() note!: string;
  @IsString() @IsOptional() evidenceRef?: string;
}

class ResolveBranchDuplicateDto extends CommandBaseDto {
  @IsIn(['ARCHIVE', 'EDIT_CODE']) action!: 'ARCHIVE' | 'EDIT_CODE';
  @IsString() @IsNotEmpty() targetBranchId!: string;
  @IsString() @IsOptional() newCode?: string;
}

class ResolveVatHintDto extends CommandBaseDto {
  @IsIn(['CONFIRM_FACT', 'DISMISS_UNKNOWN']) action!: 'CONFIRM_FACT' | 'DISMISS_UNKNOWN';
  @IsString() @IsOptional() effectiveFrom?: string;
  @IsString() @IsOptional() evidenceRef?: string;
}

class RepairTaxIdDto {
  @IsString() @IsNotEmpty() @MaxLength(64) commandId!: string;
  @IsString() @IsNotEmpty() manualValue!: string;
  @IsString() @IsNotEmpty() note!: string;
  @IsString() @IsOptional() evidenceRef?: string;
  @Type(() => Number) @IsInt() @Min(0) expectedLegalIdentityVersion!: number;
}

class ListItemsQueryDto {
  @IsIn(RECONCILIATION_STATUSES) @IsOptional() status?: ReconciliationStatus;
  @IsIn(RECONCILIATION_KINDS) @IsOptional() kind?: ReconciliationKind;
  @IsString() @IsOptional() companyId?: string;
  @IsString() @IsOptional() cursor?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(200) @IsOptional() pageSize?: number;
}

/**
 * Internal system-admin surface (spec §16). Every route carries the same CRITICAL permission:
 * the holder rewrites the legal tax identity, VAT facts and branch codes of ANY tenant company,
 * which is a wider authority than creating one.
 */
@Controller('system/identity-reconciliation')
@RequirePermissions('system.identity_reconciliation.resolve')
export class SystemIdentityReconciliationController {
  constructor(
    private readonly generate: GenerateIdentityReconciliationUseCase,
    private readonly read: ReadIdentityReconciliationUseCase,
    private readonly resolve: ResolveIdentityReconciliationUseCase,
  ) {}

  @Post('companies/:companyId/generate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Generate reconciliation items for one company (writes no domain data)' })
  async generateForCompany(@Param('companyId') companyId: string) {
    return this.generate.execute(companyId);
  }

  @Get('items')
  @ApiOperation({ summary: 'List reconciliation items (cursor paged)' })
  async listItems(@Query() query: ListItemsQueryDto) {
    return this.read.listItems(query);
  }

  @Post('items/:itemId/resolve-tax-id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve a Company/CompanyTaxProfile tax id disagreement' })
  async resolveTaxId(
    @Param('itemId') itemId: string,
    @Body() dto: ResolveTaxIdDto,
    @Req() req: Request & { context: RequestContext },
  ) {
    return this.resolve.resolveTaxId(req.context, itemId, dto);
  }

  @Post('items/:itemId/resolve-branch-duplicate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve duplicated branch tax identity' })
  async resolveBranchDuplicate(
    @Param('itemId') itemId: string,
    @Body() dto: ResolveBranchDuplicateDto,
    @Req() req: Request & { context: RequestContext },
  ) {
    return this.resolve.resolveBranchDuplicate(req.context, itemId, dto);
  }

  @Post('items/:itemId/resolve-vat-hint')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm or dismiss a dateless legacy VAT registration hint' })
  async resolveVatHint(
    @Param('itemId') itemId: string,
    @Body() dto: ResolveVatHintDto,
    @Req() req: Request & { context: RequestContext },
  ) {
    return this.resolve.resolveVatHint(req.context, itemId, dto);
  }

  @Post('companies/:companyId/repair-tax-id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Repair a tax id typo without creating a legal-date fence (post-B2 route)' })
  async repairTaxId(
    @Param('companyId') companyId: string,
    @Body() dto: RepairTaxIdDto,
    @Req() req: Request & { context: RequestContext },
  ) {
    return this.resolve.repairTaxId(req.context, companyId, dto);
  }

  @Get('reports/:reportKey')
  @ApiOperation({ summary: 'Reconciliation reports' })
  async report(@Param('reportKey') reportKey: string, @Query('companyId') companyId?: string) {
    return this.read.report(reportKey, companyId);
  }
}
