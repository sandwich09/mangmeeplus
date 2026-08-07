import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { VAT_FACT_STATUSES, type PutVatRegistrationRequest, type VatFactStatus } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { CompanyVatRegistrationUseCase } from '../../application/use-cases/company-vat-registration.use-case';
import { assertRouteCompany } from './assert-route-company';

/**
 * Discriminated by `command.kind`. The pipe is whitelist + forbidNonWhitelisted, so a
 * CANCEL_FUTURE carrying `status` or `effectiveFrom` is REJECTED rather than silently ignored —
 * the caller learns their intent was misread instead of watching a different one take effect.
 */
class VatCommandBaseDto {
  @IsIn(['UPSERT_FACT', 'CANCEL_FUTURE']) kind!: 'UPSERT_FACT' | 'CANCEL_FUTURE';
}

class UpsertFactCommandDto extends VatCommandBaseDto {
  declare kind: 'UPSERT_FACT';
  @IsIn(VAT_FACT_STATUSES) status!: VatFactStatus;
  @IsString() @IsNotEmpty() effectiveFrom!: string;
  @IsString() @IsOptional() replaceFactId?: string;
}

class CancelFutureCommandDto extends VatCommandBaseDto {
  declare kind: 'CANCEL_FUTURE';
  @IsString() @IsNotEmpty() replaceFactId!: string;
}

class PutVatRegistrationBodyDto {
  @IsString() @IsNotEmpty() @MaxLength(64) commandId!: string;
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @ValidateNested()
  @Type(() => VatCommandBaseDto, {
    discriminator: {
      property: 'kind',
      subTypes: [
        { value: UpsertFactCommandDto, name: 'UPSERT_FACT' },
        { value: CancelFutureCommandDto, name: 'CANCEL_FUTURE' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  command!: UpsertFactCommandDto | CancelFutureCommandDto;
}

@Controller('companies/:companyId/vat-registration')
export class CompanyVatRegistrationController {
  constructor(private readonly vatRegistration: CompanyVatRegistrationUseCase) {}

  @Get()
  @RequirePermissions('company.vat_registration.read')
  @ApiOperation({ summary: 'Read VAT registration status, optionally as of a date' })
  async get(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query('asOf') asOf?: string,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.vatRegistration.get(companyId, asOf);
  }

  @Put()
  @RequirePermissions('company.vat_registration.manage')
  @ApiOperation({ summary: 'Answer or correct the VAT registration status' })
  async put(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Body() body: PutVatRegistrationBodyDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.vatRegistration.put(ctx, companyId, body as unknown as PutVatRegistrationRequest);
  }
}
