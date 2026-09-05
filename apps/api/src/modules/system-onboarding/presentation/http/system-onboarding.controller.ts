import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { COMPANY_BUSINESS_CATEGORIES, VAT_FACT_STATUSES, type CompanyBusinessCategory, type VatFactStatus } from '@watchdog-bms/contracts';
import { requiredWebAppBase, trustedPublicApiBase } from '../../../../common/http/public-api-base';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { CreateCompanyOnboardingUseCase } from '../../application/use-cases/create-company-onboarding.use-case';
import { GetCompanyOnboardingUseCase } from '../../application/use-cases/get-company-onboarding.use-case';
import { RegenerateTemporaryPasswordUseCase } from '../../application/use-cases/regenerate-temporary-password.use-case';
import { ReissueOwnerLineLinkUseCase } from '../../application/use-cases/reissue-owner-line-link.use-case';

class VatRegistrationAnswerDto {
  @IsIn(VAT_FACT_STATUSES) status!: VatFactStatus;
  // Validated as a civil date by the use case; a bad string is rejected there with the same
  // message the VAT endpoint uses, so the two answer paths cannot disagree on the format.
  @IsString() @IsNotEmpty() effectiveFrom!: string;
}

// Exported for the DTO boundary spec: the ValidateIf below is what keeps a forgotten username a
// 400 from the global pipe, and only the real pipe can prove it.
export class CreateOnboardingDto {
  @IsString() @IsNotEmpty() companyName!: string;
  // Optional on purpose: an admin who does not know leaves it out and the company stays UNKNOWN.
  @ValidateNested() @Type(() => VatRegistrationAnswerDto) @IsOptional() vatRegistration?: VatRegistrationAnswerDto;
  // Required, closed set: the PDPA tenant tripwire (M-05 register §6) has no other input,
  // and an omitted category would be a silently uncategorised tenant.
  @IsIn(COMPANY_BUSINESS_CATEGORIES) businessCategory!: CompanyBusinessCategory;
  // Optional like vatRegistration: an admin without the number leaves it out and the owner captures
  // it later. Bounded here only — the use case owns the 13-digit rule, shared with the identity
  // screen, so the two can never disagree about what a valid tax id is.
  @IsString() @IsOptional() @MaxLength(32) taxId?: string;
  @IsString() @IsNotEmpty() ownerDisplayName!: string;
  // Required exactly as before UNLESS `ownerLineOnly` is set: `ValidateIf` keeps the missing-field
  // answer a 400 from the global pipe rather than turning it into the use-case's 422 for every
  // existing caller that forgets it (review A-04 follow-up).
  @ValidateIf((dto: CreateOnboardingDto) => dto.ownerLineOnly !== true)
  @IsString() @IsNotEmpty() ownerUsername?: string;
  /**
   * A-04: "ลูกค้าใช้ LINE เท่านั้น". No username, no temporary password — the owner LINE-link QR
   * this endpoint already returns is the whole handover, and the identity is created when they
   * scan it. A boolean rather than the full `ownerAuth` union, because the console has exactly one
   * of the three shapes to offer and the other two are not its to choose.
   */
  @IsBoolean() @IsOptional() ownerLineOnly?: boolean;
  @IsBoolean() @IsOptional() attachExistingOwner?: boolean;
  @IsString() @IsOptional() modulePackage?: string;
  @IsString() @IsOptional() lineOaAddUrl?: string;
  @IsString() @IsOptional() lineLinkUrl?: string;
}

@Controller('system/company-onboardings')
export class SystemOnboardingController {
  constructor(
    private readonly createOnboarding: CreateCompanyOnboardingUseCase,
    private readonly getOnboarding: GetCompanyOnboardingUseCase,
    private readonly regeneratePassword: RegenerateTemporaryPasswordUseCase,
    private readonly reissueOwnerLineLink: ReissueOwnerLineLinkUseCase,
    private readonly config: AppConfigService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('system.company_onboarding.create')
  @ApiOperation({ summary: 'Create customer company onboarding (system admin only)' })
  @ApiResponse({ status: 201, description: 'Onboarding created; temporary password shown once' })
  @ApiResponse({ status: 409, description: 'Username or company name already taken' })
  async create(
    @Body() dto: CreateOnboardingDto,
    @Req() req: Request & { context: RequestContext },
  ) {
    return this.createOnboarding.execute({
      companyName: dto.companyName,
      businessCategory: dto.businessCategory,
      ...(dto.taxId ? { taxId: dto.taxId } : {}),
      ...(dto.vatRegistration && { vatRegistration: dto.vatRegistration as any }),
      ownerDisplayName: dto.ownerDisplayName,
      ...(dto.ownerUsername ? { ownerUsername: dto.ownerUsername } : {}),
      // A-04. Absent for every existing caller, so the default `password` path is untouched.
      ...(dto.ownerLineOnly ? { ownerAuth: { kind: 'line-link-later' as const } } : {}),
      attachExistingOwner: dto.attachExistingOwner,
      modulePackage: dto.modulePackage,
      lineOaAddUrl: dto.lineOaAddUrl,
      lineLinkUrl: dto.lineLinkUrl,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
      // Persisted on the onboarding run as the owner's handoff, so it is the configured web origin
      // and never a header the caller controls (review MEDIUM-2).
      webBaseUrl: requiredWebAppBase(this.config.sesWebBaseUrl),
      apiBaseUrl: trustedPublicApiBase(req),
    });
  }

  @Get(':id')
  @RequirePermissions('system.company_onboarding.read')
  @ApiOperation({ summary: 'Get onboarding run metadata (no password)' })
  @ApiResponse({ status: 200, description: 'Onboarding run metadata' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getById(@Param('id') id: string) {
    return this.getOnboarding.execute(id);
  }

  @Post(':id/regenerate-temporary-password')
  @HttpCode(200)
  @RequirePermissions('system.company_onboarding.regenerate_temporary_password')
  @ApiOperation({ summary: 'Regenerate temporary password and owner LINE link QR; shown once only' })
  @ApiResponse({ status: 200, description: 'New temporary password and rotated owner LINE link package' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async regenerateTempPassword(
    @Param('id') id: string,
    @Req() req: Request & { context: RequestContext },
  ) {
    return this.regeneratePassword.execute(id, req.context.userId, req.context.requestId, trustedPublicApiBase(req));
  }

  // Gated by the same CRITICAL permission as password regeneration: reissuing the QR
  // is the password-safe subset of that action, so no new permission key to sync.
  @Post(':id/reissue-owner-line-link')
  @HttpCode(200)
  @RequirePermissions('system.company_onboarding.regenerate_temporary_password')
  @ApiOperation({ summary: 'Reissue owner LINE link QR without changing the password' })
  @ApiResponse({ status: 200, description: 'Fresh owner LINE link package; prior pending QRs revoked' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async reissueOwnerLineLinkQr(
    @Param('id') id: string,
    @Req() req: Request & { context: RequestContext },
  ) {
    return this.reissueOwnerLineLink.execute(id, req.context.userId, req.context.requestId, trustedPublicApiBase(req));
  }
}
