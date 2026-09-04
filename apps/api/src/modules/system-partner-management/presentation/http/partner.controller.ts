import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import {
  ALL_FEATURE_ENTITLEMENT_KEYS,
  PARTNER_LINE_MESSAGE_MAX_LENGTH,
  PLAN_TIER_PRESETS,
  VAT_FACT_STATUSES,
  type PlanTierKey,
  type VatFactStatus,
} from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { trustedPublicApiBase } from '../../../../common/http/public-api-base';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { ListPartnersUseCase } from '../../application/use-cases/list-partners.use-case';
import { GetPartnerDetailUseCase } from '../../application/use-cases/get-partner-detail.use-case';
import { CompanyVatRegistrationUseCase } from '../../../data-model-core/application/use-cases/company-vat-registration.use-case';
import { UpdatePartnerProfileUseCase } from '../../application/use-cases/update-partner-profile.use-case';
import { PartnerLifecycleTransitionUseCase } from '../../application/use-cases/partner-lifecycle-transition.use-case';
import { SetPartnerFeaturesUseCase } from '../../application/use-cases/set-partner-features.use-case';
import { SetPartnerAiModelUseCase } from '../../application/use-cases/set-partner-ai-model.use-case';
import { SetPartnerOcrConfigUseCase } from '../../application/use-cases/set-partner-ocr-config.use-case';
import { GetPartnerAiUsageUseCase } from '../../application/use-cases/get-partner-ai-usage.use-case';
import { ListPartnerMembersUseCase } from '../../application/use-cases/list-partner-members.use-case';
import { PartnerMemberLineUnlinkUseCase } from '../../application/use-cases/partner-member-line-unlink.use-case';
import { PartnerMemberPasswordResetUseCase } from '../../application/use-cases/partner-member-password-reset.use-case';
import { PartnerMemberPasswordRevealUseCase } from '../../application/use-cases/partner-member-password-reveal.use-case';
import { PartnerMemberLineLinkTokenUseCase } from '../../application/use-cases/partner-member-line-link-token.use-case';
import { SetPartnerMemberContactUseCase } from '../../application/use-cases/set-partner-member-contact.use-case';
import {
  EndPlanTermWarmupUseCase,
  GetCompanyPlanTermUseCase,
  RenewCompanyPlanTermUseCase,
  SetCompanyPlanTermUseCase,
} from '../../application/use-cases/company-plan-term.use-cases';
import { GetPartnerTimelineUseCase } from '../../application/use-cases/get-partner-timeline.use-case';
import { SendPartnerLineMessageUseCase } from '../../application/use-cases/send-partner-line-message.use-case';

/** Derived from the frozen catalog so the DTO can never drift from the presets it validates. */
const PLAN_TIER_KEYS = Object.keys(PLAN_TIER_PRESETS) as PlanTierKey[];

class UpdateProfileBodyDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() brandName?: string;
  @IsString() @IsOptional() timezone?: string;
  @IsString() @IsOptional() locale?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() email?: string;
}

class MemberContactBodyDto {
  @IsString() @IsOptional() @MaxLength(254) email?: string;
  @IsString() @IsOptional() @MaxLength(20) phoneNumber?: string;
}

class LifecycleBodyDto {
  @IsString() @IsNotEmpty() targetStatus!: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
  @IsString() @IsOptional() reason?: string;
}

class FeatureItemDto {
  @IsString() @IsNotEmpty() @MaxLength(200) featureKey!: string;
  @IsBoolean() enabled!: boolean;
}

export class SetFeaturesBodyDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ALL_FEATURE_ENTITLEMENT_KEYS.length)
  @ArrayUnique((feature: FeatureItemDto) => feature.featureKey)
  @ValidateNested({ each: true })
  @Type(() => FeatureItemDto)
  features!: FeatureItemDto[];

  /** CC1 whole-command idempotency key, stable across a lost-response retry. */
  @IsString() @IsNotEmpty() @MaxLength(200) commandId!: string;

  /** CC1 batch CAS fence read from the partner detail response. */
  @IsInt() @Min(0) expectedSetVersion!: number;

  /** Explicit confirm for the cascade preview returned by `feature_cascade_confirmation_required`. */
  @IsBoolean() @IsOptional() confirmCascade?: boolean;
}

// Nullable-by-design: @IsOptional would also skip validation for an explicit null, and null is
// the documented "clear the override, inherit the platform default" signal — while an absent
// field means "leave this one alone" (the reimbursement.dtos precedent).
const unlessNullish = ValidateIf((_object, value) => value !== undefined && value !== null);

// Exported for the DTO boundary spec: the null-vs-absent distinction below is the whole
// contract of a partial update, and it is worth pinning against the real global pipe.
export class SetAiModelBodyDto {
  @IsString() @IsOptional() @IsNotEmpty() modelId?: string;
  @unlessNullish @IsInt() monthlyBudgetSatang?: number | null;
}

export class SetOcrConfigBodyDto {
  @IsBoolean() enabled!: boolean;
  // Unlike the partial AI-model body, this is absolute desired state: undefined must fail,
  // while null deliberately means unlimited.
  @ValidateIf((_object, value) => value !== null) @IsInt() @Min(1) @Max(1_000_000) monthlyLimit!: number | null;
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
}

export class SetPartnerVatRegistrationBodyDto {
  @IsIn(VAT_FACT_STATUSES) status!: VatFactStatus;
  @IsString() @IsNotEmpty() effectiveFrom!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) commandId!: string;
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
}

// P29. `termStartAt`/`termDays` are honoured only when the row is created; the use-case is the
// authority on that, this DTO only fences the shapes. Upper bounds keep a typo from writing a
// 10-year term or a five-digit branch cap.
export class SetPlanTermBodyDto {
  @IsIn(PLAN_TIER_KEYS) tierKey!: PlanTierKey;
  @IsInt() @Min(1) @Max(10_000) branchLimit!: number;
  @IsInt() @Min(1) @Max(10_000) employeeLimit!: number;
  @IsInt() @Min(1) @Max(1_000_000) monthlySlipLimit!: number;
  @IsString() @IsOptional() @IsNotEmpty() termStartAt?: string;
  @IsInt() @IsOptional() @Min(1) @Max(3_650) termDays?: number;
  @IsInt() @IsOptional() @Min(1) @Max(365) warningDays?: number;
}

export class RenewPlanTermBodyDto {
  @IsInt() @IsOptional() @Min(1) @Max(3_650) days?: number;
}

// SEC-05. Bounded here AND in the use-case: this DTO fences the shape, the use-case owns the rule
// (trimmed length, our-domains-only links) so the HTTP boundary and the audit cannot disagree.
export class PartnerLineMessageBodyDto {
  @IsString() @IsNotEmpty() @MaxLength(PARTNER_LINE_MESSAGE_MAX_LENGTH) text!: string;
}

type AuthedRequest = Request & { context: RequestContext };

@Controller('system/partners')
export class PartnerController {
  constructor(
    private readonly listPartners: ListPartnersUseCase,
    private readonly getDetail: GetPartnerDetailUseCase,
    private readonly updateProfile: UpdatePartnerProfileUseCase,
    private readonly lifecycle: PartnerLifecycleTransitionUseCase,
    private readonly setFeatures: SetPartnerFeaturesUseCase,
    private readonly setAiModel: SetPartnerAiModelUseCase,
    private readonly setOcrConfig: SetPartnerOcrConfigUseCase,
    private readonly getAiUsage: GetPartnerAiUsageUseCase,
    private readonly listMembers: ListPartnerMembersUseCase,
    private readonly unlinkMemberLine: PartnerMemberLineUnlinkUseCase,
    private readonly issueMemberLineLinkToken: PartnerMemberLineLinkTokenUseCase,
    private readonly resetMemberPassword: PartnerMemberPasswordResetUseCase,
    private readonly revealMemberPassword: PartnerMemberPasswordRevealUseCase,
    private readonly setMemberContact: SetPartnerMemberContactUseCase,
    private readonly vatRegistration: CompanyVatRegistrationUseCase,
    private readonly getPlanTerm: GetCompanyPlanTermUseCase,
    private readonly setPlanTerm: SetCompanyPlanTermUseCase,
    private readonly renewPlanTerm: RenewCompanyPlanTermUseCase,
    private readonly endWarmup: EndPlanTermWarmupUseCase,
    private readonly timeline: GetPartnerTimelineUseCase,
    private readonly lineMessage: SendPartnerLineMessageUseCase,
  ) {}

  @Get()
  @RequirePermissions('system.partner_dashboard.read')
  @ApiOperation({ summary: 'List partner companies (metadata only)' })
  @ApiResponse({ status: 200 })
  list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.listPartners.execute({
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  // Route param is deliberately NOT ':companyId': the auth guard treats a 'companyId'
  // param as tenant scope and would demand membership in the CUSTOMER company, which
  // system admins must never have (item 10A). ':partnerCompanyId' keeps the URL shape
  // while permissions resolve against the admin's own system membership.
  @Get(':partnerCompanyId')
  @RequirePermissions('system.partner_dashboard.read')
  @ApiOperation({ summary: 'Get partner company detail (metadata only)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  detail(@Param('partnerCompanyId') companyId: string) {
    return this.getDetail.execute(companyId);
  }

  @Patch(':partnerCompanyId')
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Update partner company profile metadata' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 422, description: 'Company is DISABLED/ARCHIVED — metadata is read-only' })
  update(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: UpdateProfileBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.updateProfile.execute({
      companyId,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
      ...dto,
    });
  }

  @Post(':partnerCompanyId/lifecycle')
  @HttpCode(200)
  @RequirePermissions('system.partner_company.lifecycle.manage')
  @ApiOperation({ summary: 'Transition partner company lifecycle (activate/inactivate/archive)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 422, description: 'SUSPENDED is not a valid targetStatus' })
  transitionLifecycle(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: LifecycleBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.lifecycle.execute({
      companyId,
      targetStatus: dto.targetStatus,
      reason: dto.reason,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }

  @Get(':partnerCompanyId/members')
  @RequirePermissions('system.partner_member.read')
  @ApiOperation({ summary: 'List partner company members with roles, LINE link and credential state' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  members(@Param('partnerCompanyId') companyId: string) {
    return this.listMembers.execute(companyId);
  }

  @Post(':partnerCompanyId/members/:memberUserId/line-unlink')
  @HttpCode(200)
  @RequirePermissions('system.partner_member.manage')
  @ApiOperation({ summary: 'Unlink a member LINE identity (member relinks by scanning a fresh QR)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Member not in company or no active LINE identity' })
  unlinkLine(
    @Param('partnerCompanyId') companyId: string,
    @Param('memberUserId') memberUserId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.unlinkMemberLine.execute({
      companyId,
      memberUserId,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }

  // The members table already shows "Not linked"; this is the action that fixes it from the
  // same screen. Without it an expired owner QR is only reissuable through the onboarding run
  // id, which is unrecoverable outside the production database.
  @Post(':partnerCompanyId/members/:memberUserId/line-link-token')
  @HttpCode(200)
  @RequirePermissions('system.partner_member.manage')
  @ApiOperation({ summary: 'Issue a fresh LINE-link QR for a member (72h, single use, revokes prior pending QRs)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'No active membership for this member in this company' })
  issueLineLinkToken(
    @Param('partnerCompanyId') companyId: string,
    @Param('memberUserId') memberUserId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.issueMemberLineLinkToken.execute({
      companyId,
      memberUserId,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
      apiBaseUrl: trustedPublicApiBase(req),
    });
  }

  @Post(':partnerCompanyId/members/:memberUserId/password/reset')
  @HttpCode(200)
  @RequirePermissions('system.partner_member.manage')
  @ApiOperation({ summary: 'Issue a new temporary password for a member (returned once, stored encrypted for reveal)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  resetPassword(
    @Param('partnerCompanyId') companyId: string,
    @Param('memberUserId') memberUserId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.resetMemberPassword.execute({
      companyId,
      memberUserId,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }

  @Post(':partnerCompanyId/members/:memberUserId/password/reveal')
  @HttpCode(200)
  @RequirePermissions('system.partner_member.manage')
  @ApiOperation({ summary: 'Reveal the current system-generated temporary password (audited per reveal)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'No stored temporary password (user changed it or none issued)' })
  revealPassword(
    @Param('partnerCompanyId') companyId: string,
    @Param('memberUserId') memberUserId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.revealMemberPassword.execute({
      companyId,
      memberUserId,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }

  @Patch(':partnerCompanyId/members/:memberUserId/contact')
  @RequirePermissions('system.partner_member.manage')
  @ApiOperation({ summary: 'Set member contact email and mobile (admin backfill; email becomes a login identifier)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'Email already used by another user' })
  setContact(
    @Param('partnerCompanyId') companyId: string,
    @Param('memberUserId') memberUserId: string,
    @Body() dto: MemberContactBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.setMemberContact.execute({
      companyId,
      memberUserId,
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }

  @Put(':partnerCompanyId/features')
  @RequirePermissions('system.partner_feature.manage')
  @ApiOperation({ summary: 'Set partner feature entitlements' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 409, description: 'commandId reuse with a different payload, or stale expectedSetVersion' })
  @ApiResponse({ status: 422, description: 'Unknown feature key, unmet dependency, platform key, or cascade confirmation required' })
  setFeatureEntitlements(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: SetFeaturesBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.setFeatures.execute({
      companyId,
      features: dto.features,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
      commandId: dto.commandId,
      expectedSetVersion: dto.expectedSetVersion,
      confirmCascade: dto.confirmCascade,
    });
  }

  @Put(':partnerCompanyId/ai-model')
  @RequirePermissions('system.partner_ai_model.manage')
  @ApiOperation({ summary: 'Set approved AI model and/or monthly AI budget for partner company' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 422, description: 'Empty body, modelId not in approved list, or budget below 1 / above the platform ceiling' })
  setAiModelConfig(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: SetAiModelBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.setAiModel.execute({
      companyId,
      modelId: dto.modelId,
      monthlyBudgetSatang: dto.monthlyBudgetSatang,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }

  @Put(':partnerCompanyId/ocr-config')
  @RequirePermissions('system.partner_ai_model.manage')
  @ApiOperation({ summary: 'Enable/disable OCR and set the monthly OCR read limit for one partner company' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 409, description: 'OCR config changed after the operator loaded it; reload before saving' })
  @ApiResponse({ status: 422, description: 'Company metadata locked or monthlyLimit outside 1..1,000,000' })
  setOcrConfiguration(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: SetOcrConfigBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.setOcrConfig.execute({
      companyId,
      enabled: dto.enabled,
      monthlyLimit: dto.monthlyLimit,
      expectedVersion: dto.expectedVersion,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }

  // The admin console edits the same fact the company's own screen edits, through the same
  // command — CAS, audit and interval algebra are the VAT service's, not a second copy. The
  // expectedVersion the console sends comes from the detail read, so a concurrent answer from
  // the company side loses the race loudly instead of being overwritten.
  @Put(':partnerCompanyId/vat-registration')
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Answer or correct a partner company VAT registration' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 409, description: 'The stored version moved — reload before answering again' })
  setVatRegistration(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: SetPartnerVatRegistrationBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.vatRegistration.put(req.context, companyId, {
      commandId: dto.commandId,
      expectedVersion: dto.expectedVersion,
      command: { kind: 'UPSERT_FACT', status: dto.status, effectiveFrom: dto.effectiveFrom },
    } as any);
  }

  @Get(':partnerCompanyId/ai-usage')
  @RequirePermissions('system.partner_dashboard.read')
  @ApiOperation({ summary: 'Get partner AI spend meter: current/previous month, effective budget, top usage tags' })
  @ApiResponse({ status: 200 })
  aiUsage(@Param('partnerCompanyId') companyId: string) {
    return this.getAiUsage.execute(companyId);
  }

  // ---- P29 plan limits & term ----
  // Read rides the dashboard permission like every other partner read; the two writes reuse
  // `system.partner_company.update`, the same key the profile PATCH above is gated on. No new
  // permission key: an operator who may edit a partner's profile may set its package.

  @Get(':partnerCompanyId/plan-term')
  @RequirePermissions('system.partner_dashboard.read')
  @ApiOperation({ summary: 'Get plan limits and usage term ({ term: null } for grandfathered companies)' })
  @ApiResponse({ status: 200 })
  planTerm(@Param('partnerCompanyId') companyId: string) {
    return this.getPlanTerm.execute(companyId);
  }

  @Put(':partnerCompanyId/plan-term')
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Create or update plan limits and term (dates are set on create only)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 422, description: 'Unknown tierKey or a limit that is not a positive whole number' })
  setPlanTermConfig(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: SetPlanTermBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.setPlanTerm.execute({
      companyId,
      ...dto,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }

  @Post(':partnerCompanyId/plan-term/renew')
  @HttpCode(200)
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Extend the usage term; re-enables a company only if the term expiry disabled it' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Company has no term row to renew' })
  renewPlanTermConfig(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: RenewPlanTermBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.renewPlanTerm.execute({
      companyId,
      days: dto.days,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }

  // P10-L §9 "ตรวจแล้ว". Same permission as the other two term writes: an operator who may set a
  // package may lift the first-week ceiling they were the reason for.
  @Post(':partnerCompanyId/plan-term/end-warmup')
  @HttpCode(200)
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'End the LINE trial warm-up ceiling early (idempotent)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Company has no term row' })
  endPlanTermWarmup(
    @Param('partnerCompanyId') companyId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.endWarmup.execute({
      companyId,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }

  // ---- P10-L §8 support tools ----

  // Reading a shop's story is reading its onboarding, so it rides the onboarding read permission
  // rather than a new key — the same reasoning the signup queue is gated on.
  @Get(':partnerCompanyId/timeline')
  @RequirePermissions('system.company_onboarding.read')
  @ApiOperation({ summary: 'Key events for one shop, assembled from existing audit and meter rows' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  partnerTimeline(@Param('partnerCompanyId') companyId: string) {
    return this.timeline.execute(companyId);
  }

  @Post(':partnerCompanyId/line-message')
  @HttpCode(200)
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Push one operator-written LINE message to this shop OWNERs (SEC-05)' })
  @ApiResponse({ status: 200, description: 'How many linked owner identities it reached' })
  @ApiResponse({ status: 422, description: 'Empty, too long, links outside our own domains, or no LINE channel' })
  sendLineMessage(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: PartnerLineMessageBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.lineMessage.execute({
      companyId,
      text: dto.text,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }
}
