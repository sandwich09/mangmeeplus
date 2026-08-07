import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  LEGAL_IDENTITY_CORRECTION_REASONS,
  USER_LEGAL_IDENTITY_CHANGE_KINDS,
  type CompanyLegalAddress,
  type LegalIdentityCorrectionReason,
  type UserLegalIdentityChangeKind,
} from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { CompanyIdentityUseCase } from '../../application/use-cases/company-identity.use-case';
import { assertRouteCompany } from './assert-route-company';

class PatchCompanyIdentityBodyDto {
  @Type(() => Number) @IsInt() @Min(0) expectedLegalIdentityVersion!: number;
  @IsIn(USER_LEGAL_IDENTITY_CHANGE_KINDS) changeKind!: UserLegalIdentityChangeKind;
  @IsString() @IsOptional() @MaxLength(32) taxId?: string;
  @IsString() @IsOptional() @MaxLength(255) registeredName?: string;
  // Shape is checked in the use case against the closed key set: the pipe would only tell us it
  // is an object, and an unknown address key has to be an error rather than a dropped field.
  @IsObject() @IsOptional() addressJson?: CompanyLegalAddress;
  @IsString() @IsOptional() effectiveFrom?: string;
  @IsIn(LEGAL_IDENTITY_CORRECTION_REASONS) @IsOptional() correctionReason?: LegalIdentityCorrectionReason;
  @IsString() @IsOptional() @MaxLength(500) note?: string;
  @IsString() @IsOptional() @MaxLength(200) evidenceRef?: string;
}

class CompleteCaptureBodyDto {
  @Type(() => Number) @IsInt() @Min(0) expectedLegalIdentityVersion!: number;
}

@Controller('companies/:companyId/identity')
export class CompanyIdentityController {
  constructor(private readonly identity: CompanyIdentityUseCase) {}

  // Gated on the LOW, widely-held setup key on purpose: everyone who can open company settings
  // sees the control block and a masked identity. The full value needs company.legal_identity.read,
  // which the use case checks per section.
  @Get()
  @RequirePermissions('company.setup.read')
  @ApiOperation({ summary: 'Read company tax identity, filtered per permission' })
  async get(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string) {
    assertRouteCompany(ctx, companyId);
    return this.identity.get(ctx, companyId);
  }

  @Patch()
  @RequirePermissions('company.legal_identity.manage')
  @ApiOperation({ summary: 'Change the company legal tax identity' })
  async patch(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Body() body: PatchCompanyIdentityBodyDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.identity.patch(ctx, companyId, body);
  }

  @Post('complete-capture')
  @HttpCode(200)
  @RequirePermissions('company.legal_identity.manage')
  @ApiOperation({ summary: 'Confirm the captured identity and close the capture window' })
  async completeCapture(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Body() body: CompleteCaptureBodyDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.identity.completeCapture(ctx, companyId, body.expectedLegalIdentityVersion);
  }
}
