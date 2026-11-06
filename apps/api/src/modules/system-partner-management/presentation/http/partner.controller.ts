import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
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
  IsObject,
  IsOptional,
  IsString,
  Matches,
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
  COMPANY_TEAM_NOTE_WORDS as NOTE_WORDS,
  type PutCompanyTeamNoteBody,
  LEGAL_IDENTITY_CORRECTION_REASONS,
  PARTNER_ADJUSTMENT_REASON_MAX_LENGTH,
  PARTNER_LINE_MESSAGE_MAX_LENGTH,
  PLAN_TIER_PRESETS,
  REPORT_INDUSTRY_GROUPS,
  USER_LEGAL_IDENTITY_CHANGE_KINDS,
  VAT_FACT_STATUSES,
  type CompanyLegalAddress,
  type LegalIdentityCorrectionReason,
  type PlanTierKey,
  type ReportClassification,
  type ReportIndustryGroup,
  type UserLegalIdentityChangeKind,
  type VatFactStatus,
} from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { trustedPublicApiBase } from '../../../../common/http/public-api-base';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { assertPlatformTenant } from '../../../sales-console/application/sales-context';
import { ListThaiAddressesUseCase } from '../../../employee-access/application/use-cases/list-thai-addresses.use-case';
import { CompanyTeamNoteService } from '../../application/company-team-note.service';
import { ListPartnersUseCase } from '../../application/use-cases/list-partners.use-case';
import { GetPartnerDetailUseCase } from '../../application/use-cases/get-partner-detail.use-case';
import { CompanyVatRegistrationUseCase } from '../../../data-model-core/application/use-cases/company-vat-registration.use-case';
import { UpdatePartnerProfileUseCase } from '../../application/use-cases/update-partner-profile.use-case';
import { UpdatePartnerIdentityUseCase } from '../../application/use-cases/update-partner-identity.use-case';
import { PartnerLifecycleTransitionUseCase } from '../../application/use-cases/partner-lifecycle-transition.use-case';
import { SetPartnerFeaturesUseCase } from '../../application/use-cases/set-partner-features.use-case';
import { SetPartnerAiModelUseCase } from '../../application/use-cases/set-partner-ai-model.use-case';
import { SetPartnerOcrConfigUseCase } from '../../application/use-cases/set-partner-ocr-config.use-case';
import { SetPartnerManualExpenseWebEntryUseCase } from '../../application/use-cases/set-partner-manual-expense-web-entry.use-case';
import { SetPartnerDisbursementVoucherWebEntryUseCase } from '../../application/use-cases/set-partner-disbursement-voucher-web-entry.use-case';
import { GetPartnerAiUsageUseCase } from '../../application/use-cases/get-partner-ai-usage.use-case';
import { ListPartnerMembersUseCase } from '../../application/use-cases/list-partner-members.use-case';
import { PartnerMemberLineUnlinkUseCase } from '../../application/use-cases/partner-member-line-unlink.use-case';
import { PartnerMemberPasswordResetUseCase } from '../../application/use-cases/partner-member-password-reset.use-case';
import { PartnerMemberPasswordRevealUseCase } from '../../application/use-cases/partner-member-password-reveal.use-case';
import { PartnerMemberLineLinkTokenUseCase } from '../../application/use-cases/partner-member-line-link-token.use-case';
import { SetPartnerMemberContactUseCase } from '../../application/use-cases/set-partner-member-contact.use-case';
import { SetPartnerOwnerNameUseCase } from '../../application/use-cases/set-partner-owner-name.use-case';
import {
  EndPlanTermWarmupUseCase,
  GetCompanyPlanTermUseCase,
  GetPartnerPlanAdjustmentHistoryUseCase,
  RenewCompanyPlanTermUseCase,
  SetCompanyPlanTermUseCase,
} from '../../application/use-cases/company-plan-term.use-cases';
import { GetPartnerTimelineUseCase } from '../../application/use-cases/get-partner-timeline.use-case';
import { SendPartnerLineMessageUseCase } from '../../application/use-cases/send-partner-line-message.use-case';
import { PartnerAiCreditHoldsUseCase } from '../../application/use-cases/partner-ai-credit-holds.use-case';

/** Derived from the frozen catalog so the DTO can never drift from the presets it validates. */
const PLAN_TIER_KEYS = Object.keys(PLAN_TIER_PRESETS) as PlanTierKey[];

export class PutCompanyTeamNoteDto implements PutCompanyTeamNoteBody {
  @IsString() text!: string;
  @IsInt() @Min(0) expectedVersion!: number;
}

export class UpdateProfileBodyDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() brandName?: string;
  @IsString() @IsOptional() timezone?: string;
  @IsString() @IsOptional() locale?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() email?: string;
  // Executive spec §12.2, §15: null clears the label (IsOptional lets null through to the use case).
  @IsIn(['CUSTOMER', 'TEST', 'INTERNAL']) @IsOptional() reportClassification?: ReportClassification | null;
  @IsIn(REPORT_INDUSTRY_GROUPS.map((group) => group.key)) @IsOptional() reportIndustryGroup?: ReportIndustryGroup | null;
}

// Purchase without setup PR E (R-E3, DQ9): same fields as CompanyIdentityController's own
// PatchCompanyIdentityBodyDto (company-identity.controller.ts), plus the two the admin console adds.
class PartnerIdentityBodyDto {
  @Type(() => Number) @IsInt() @Min(0) expectedLegalIdentityVersion!: number;
  @IsIn(USER_LEGAL_IDENTITY_CHANGE_KINDS) changeKind!: UserLegalIdentityChangeKind;
  @IsString() @IsOptional() @MaxLength(32) taxId?: string;
  @IsString() @IsOptional() @MaxLength(255) registeredName?: string;
  @IsObject() @IsOptional() addressJson?: CompanyLegalAddress;
  @IsString() @IsOptional() effectiveFrom?: string;
  @IsIn(LEGAL_IDENTITY_CORRECTION_REASONS) @IsOptional() correctionReason?: LegalIdentityCorrectionReason;
  @IsString() @IsOptional() @MaxLength(500) note?: string;
  @IsString() @IsOptional() @MaxLength(200) evidenceRef?: string;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(64) supportRequestId?: string;
}

class MemberContactBodyDto {
  @IsString() @IsOptional() @MaxLength(254) email?: string;
  @IsString() @IsOptional() @MaxLength(20) phoneNumber?: string;
}

export class OwnerNameBodyDto {
  @IsString() @IsNotEmpty() displayName!: string;
  @IsString() expectedDisplayName!: string;
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
/**
 * Split CHAT/OCR allocation (spec §12.4). Nested so class-validator actually walks it —
 * `whitelist` would otherwise strip an unvalidated object wholesale. Caps are nullable by design:
 * `null` = not set, `0` = a closed bucket, and the use case (not this DTO) decides which
 * combinations are legal, because those rules depend on live spend and the effective total.
 */
export class AiBudgetPolicyBodyDto {
  @IsIn(['SHARED', 'SPLIT']) mode!: 'SHARED' | 'SPLIT';
  @ValidateIf((_object, value) => value !== null) @IsInt() @Min(0) chatMonthlyBudgetSatang!: number | null;
  @ValidateIf((_object, value) => value !== null) @IsInt() @Min(0) ocrMonthlyBudgetSatang!: number | null;
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) effectiveMonthKey!: string;
}

export class SetAiModelBodyDto {
  @IsString() @IsNotEmpty() @MaxLength(PARTNER_ADJUSTMENT_REASON_MAX_LENGTH) reason!: string;
  @IsString() @IsOptional() @IsNotEmpty() modelId?: string;
  @unlessNullish @IsInt() monthlyBudgetSatang?: number | null;
  @unlessNullish @IsString() expectedModelId?: string | null;
  @unlessNullish @IsInt() expectedMonthlyBudgetSatang?: number | null;
  // Absent = preserve; explicit null = cancel a FUTURE pending policy. Same null-vs-absent
  // contract as the budget above, which is why this is `unlessNullish` and not `@IsOptional`.
  @unlessNullish @ValidateNested() @Type(() => AiBudgetPolicyBodyDto) budgetPolicy?: AiBudgetPolicyBodyDto | null;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64) expectedBudgetRevision?: string;
}

export class SetOcrConfigBodyDto {
  @IsString() @IsNotEmpty() @MaxLength(PARTNER_ADJUSTMENT_REASON_MAX_LENGTH) reason!: string;
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsBoolean() receiptQuotaEnforced?: boolean | null;
  // Unlike the partial AI-model body, this is absolute desired state: undefined must fail,
  // while null deliberately means unlimited.
  @ValidateIf((_object, value) => value !== null) @IsInt() @Min(1) @Max(1_000_000) monthlyLimit!: number | null;
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
}

// Absolute desired state with the setting's own CAS version. No reason field: this is a screen
// setting, not a quota or an entitlement, and the console confirms before hiding.
export class SetManualExpenseWebEntryBodyDto {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(0) expectedVersion!: number;
}

export class SetDisbursementVoucherWebEntryBodyDto {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(0) expectedVersion!: number;
}

export class PartnerAiAdjustmentHistoryQueryDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) cursor?: string;
}

/**
 * Every hold-reconciliation action takes exactly one field (hold spec §4.2). The use case owns the
 * rule (`partnerAdjustmentReason`: trimmed, 1..500); this fences the shape so a 600-character body
 * never reaches a money transaction.
 */
export class PartnerAiCreditHoldActionBodyDto {
  @IsString() @IsNotEmpty() @MaxLength(PARTNER_ADJUSTMENT_REASON_MAX_LENGTH) reason!: string;
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
class PlanTermAdjustmentBodyDto {
  @IsString() @IsNotEmpty() @MaxLength(120) commandId!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) expectedVersion!: string;
  @IsString() @IsNotEmpty() @MaxLength(PARTNER_ADJUSTMENT_REASON_MAX_LENGTH) reason!: string;
}

export class SetPlanTermBodyDto extends PlanTermAdjustmentBodyDto {
  @IsIn(PLAN_TIER_KEYS) tierKey!: PlanTierKey;
  @IsInt() @Min(1) @Max(10_000) branchLimit!: number;
  @IsInt() @Min(1) @Max(10_000) employeeLimit!: number;
  @IsInt() @Min(1) @Max(1_000_000) monthlySlipLimit!: number;
  @IsString() @IsOptional() @IsNotEmpty() termStartAt?: string;
  @IsInt() @IsOptional() @Min(1) @Max(3_650) termDays?: number;
  @IsInt() @IsOptional() @Min(1) @Max(365) warningDays?: number;
}

export class RenewPlanTermBodyDto extends PlanTermAdjustmentBodyDto {
  @IsInt() @IsOptional() @Min(1) @Max(3_650) days?: number;
}

// SEC-05. Bounded here AND in the use-case: this DTO fences the shape, the use-case owns the rule
// (trimmed length, our-domains-only links) so the HTTP boundary and the audit cannot disagree.
export class PartnerLineMessageBodyDto {
  @IsString() @IsNotEmpty() @MaxLength(PARTNER_LINE_MESSAGE_MAX_LENGTH) text!: string;
  /** Which support request this reply answers, when the operator came from the inbox link. The
   *  use-case owns the rule (this shop, still live); this only fences the shape. */
  @IsString() @IsOptional() @IsNotEmpty() supportRequestId?: string;
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
    private readonly planAdjustmentHistory: GetPartnerPlanAdjustmentHistoryUseCase,
    private readonly setPlanTerm: SetCompanyPlanTermUseCase,
    private readonly renewPlanTerm: RenewCompanyPlanTermUseCase,
    private readonly endWarmup: EndPlanTermWarmupUseCase,
    private readonly timeline: GetPartnerTimelineUseCase,
    private readonly lineMessage: SendPartnerLineMessageUseCase,
    private readonly aiCreditHoldsUseCase: PartnerAiCreditHoldsUseCase,
    private readonly setOwnerName: SetPartnerOwnerNameUseCase,
    private readonly updateIdentity: UpdatePartnerIdentityUseCase,
    private readonly listThaiAddresses: ListThaiAddressesUseCase,
    private readonly setManualExpenseWebEntryUseCase: SetPartnerManualExpenseWebEntryUseCase,
    private readonly setDisbursementVoucherWebEntryUseCase: SetPartnerDisbursementVoucherWebEntryUseCase,
    private readonly companyTeamNote: CompanyTeamNoteService,
  ) {}

  @Get()
  @RequirePermissions('system.partner_dashboard.read')
  @ApiOperation({ summary: 'List partner companies (metadata only)' })
  @ApiResponse({ status: 200 })
  list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('reportClassification') reportClassification?: string,
    @Query('reportIndustryGroup') reportIndustryGroup?: string,
  ) {
    return this.listPartners.execute({
      q,
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      reportClassification,
      reportIndustryGroup,
    });
  }

  // Purchase without setup PR E (R-E3): registered errors BEFORE ':partnerCompanyId' below —
  // 'address-master' would otherwise be caught as an id (system-support-request.controller.ts has
  // the same pattern). Thai address options for the identity form's address fields.
  @Get('address-master')
  @RequirePermissions('system.identity_reconciliation.resolve')
  @ApiOperation({ summary: 'Thai address options for the partner identity form' })
  addresses(@Query('postalCode') postalCode = '', @Req() req: AuthedRequest) {
    assertPlatformTenant(req.context);
    return this.listThaiAddresses.execute(postalCode);
  }

  // R-E3/DQ9: legal identity (registered name, tax id, address) — one writer, gated on the
  // identity-reconciliation key (CRITICAL) rather than system.partner_company.update (MEDIUM).
  @Get(':partnerCompanyId/identity')
  @RequirePermissions('system.identity_reconciliation.resolve')
  @ApiOperation({ summary: "Read the partner company's legal-identity CAS token and allowed change kinds" })
  identityControl(@Param('partnerCompanyId') companyId: string) {
    return this.updateIdentity.getControl(companyId);
  }

  @Patch(':partnerCompanyId/identity')
  @RequirePermissions('system.identity_reconciliation.resolve')
  @ApiOperation({ summary: 'Change the registered name, tax id and/or address of a partner company' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 409, description: 'legalIdentityVersion is stale — reload and retry' })
  @ApiResponse({ status: 422, description: 'Company is an admin hold/ARCHIVED, or the change kind is not allowed' })
  updateIdentityFields(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: PartnerIdentityBodyDto,
    @Req() req: AuthedRequest,
  ) {
    const { reason, supportRequestId, ...body } = dto;
    return this.updateIdentity.execute({
      companyId,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
      reason,
      ...(supportRequestId ? { supportRequestId } : {}),
      body,
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

  @Get(':partnerCompanyId/team-note')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.partner_dashboard.read')
  getTeamNote(@Param('partnerCompanyId') companyId: string, @Req() req: AuthedRequest) {
    return this.companyTeamNote.get(req.context, companyId);
  }

  @Put(':partnerCompanyId/team-note')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system.partner_company.update')
  putTeamNote(@Param('partnerCompanyId') companyId: string, @Body() body: PutCompanyTeamNoteDto, @Req() req: AuthedRequest) {
    if (!req.context.roles.includes('SYSTEM_ADMIN')) {
      throw new ForbiddenException({ code: 'company_team_note_edit_denied', message: NOTE_WORDS.editDenied });
    }
    return this.companyTeamNote.put(req.context, companyId, body);
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

  @Patch(':partnerCompanyId/members/:memberUserId/display-name')
  @RequirePermissions('system.partner_member.manage')
  @ApiOperation({ summary: 'Update a customer owner account display name' })
  setDisplayName(
    @Param('partnerCompanyId') companyId: string,
    @Param('memberUserId') memberUserId: string,
    @Body() dto: OwnerNameBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.setOwnerName.execute({
      ...dto, companyId, memberUserId,
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
  @ApiOperation({ summary: 'Set approved AI model, monthly AI budget and/or CHAT/OCR budget policy for partner company' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 409, description: 'Budget policy changed (or the Bangkok month turned) after the operator loaded it; reload before saving' })
  @ApiResponse({ status: 422, description: 'Empty body, modelId not in approved list, budget below 1 / above the platform ceiling, or a budget policy the split rules refuse' })
  setAiModelConfig(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: SetAiModelBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.setAiModel.execute({
      companyId,
      reason: dto.reason,
      modelId: dto.modelId,
      monthlyBudgetSatang: dto.monthlyBudgetSatang,
      expectedModelId: dto.expectedModelId,
      expectedMonthlyBudgetSatang: dto.expectedMonthlyBudgetSatang,
      budgetPolicy: dto.budgetPolicy,
      expectedBudgetRevision: dto.expectedBudgetRevision,
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
      reason: dto.reason,
      enabled: dto.enabled,
      ...(dto.receiptQuotaEnforced !== undefined ? { receiptQuotaEnforced: dto.receiptQuotaEnforced } : {}),
      monthlyLimit: dto.monthlyLimit,
      expectedVersion: dto.expectedVersion,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }

  // A screen setting shown under the manual-expense feature row, so it rides the feature-management
  // key — but it is NOT part of the feature command: its own version, no entitlement row, no setVersion.
  @Put(':partnerCompanyId/manual-expense-web-entry')
  @RequirePermissions('system.partner_feature.manage')
  @ApiOperation({ summary: 'Show or hide the web entrances to the manual expense page for one partner company' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 409, description: 'The setting changed after the operator loaded it; reload before saving' })
  @ApiResponse({ status: 422, description: 'Company is DISABLED/ARCHIVED — metadata is read-only' })
  setManualExpenseWebEntry(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: SetManualExpenseWebEntryBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.setManualExpenseWebEntryUseCase.execute({
      companyId,
      enabled: dto.enabled,
      expectedVersion: dto.expectedVersion,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }

  @Put(':partnerCompanyId/disbursement-voucher-web-entry')
  @RequirePermissions('system.partner_feature.manage')
  @ApiOperation({ summary: 'Show or hide the web entrances to the disbursement voucher document for one partner company' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 409, description: 'The setting changed after the operator loaded it; reload before saving' })
  @ApiResponse({ status: 422, description: 'Company is DISABLED/ARCHIVED — metadata is read-only' })
  setDisbursementVoucherWebEntry(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: SetDisbursementVoucherWebEntryBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.setDisbursementVoucherWebEntryUseCase.execute({
      companyId,
      enabled: dto.enabled,
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
  async aiUsage(@Param('partnerCompanyId') companyId: string, @Req() req: AuthedRequest) {
    const usage = await this.getAiUsage.execute(companyId);
    // Reading this card is `system.partner_dashboard.read`; every control on it is
    // `system.partner_ai_model.manage`. Telling the page which one the caller holds is what lets a
    // read-only operator see all the numbers and no form (spec §11.3) instead of a 403 on save.
    return { ...usage, canManage: req.context.permissions.includes('system.partner_ai_model.manage') };
  }

  // ---- Held-credit reconciliation (hold spec §4) ----

  // Reading rides the dashboard permission like every other partner read; the three actions below
  // are `system.partner_ai_model.manage`, the same key the caps are written with. `canManage` tells
  // the page which one the caller holds, so a read-only operator sees the table and no buttons.
  @Get(':partnerCompanyId/ai-credit-holds')
  @RequirePermissions('system.partner_dashboard.read')
  @ApiOperation({
    summary: 'List UNRESOLVED AI credit holds and unacknowledged breaches of every month, one page at a '
      + 'time, after running the same lazy sweep admission runs',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  aiCreditHolds(@Param('partnerCompanyId') companyId: string, @Req() req: AuthedRequest, @Query('cursor') cursor?: string) {
    return this.aiCreditHoldsUseCase.read({
      companyId,
      canManage: req.context.permissions.includes('system.partner_ai_model.manage'),
      ...(typeof cursor === 'string' && cursor ? { cursor } : {}),
    });
  }

  @Post(':partnerCompanyId/ai-credit-holds/:reservationId/release')
  @HttpCode(200)
  @RequirePermissions('system.partner_ai_model.manage')
  @ApiOperation({ summary: 'Release one UNRESOLVED hold: the credit is free immediately and no usage is recorded' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'No such hold in this company' })
  @ApiResponse({ status: 409, description: 'Evidence or another operator already closed this hold' })
  releaseAiCreditHold(
    @Param('partnerCompanyId') companyId: string,
    @Param('reservationId') reservationId: string,
    @Body() dto: PartnerAiCreditHoldActionBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.aiCreditHoldsUseCase.release(this.holdCommand(companyId, reservationId, dto, req));
  }

  @Post(':partnerCompanyId/ai-credit-holds/:reservationId/charge-at-bound')
  @HttpCode(200)
  @RequirePermissions('system.partner_ai_model.manage')
  @ApiOperation({ summary: 'Settle one UNRESOLVED hold at its own declared upper bound (no tokens, not a model call)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'Evidence or another operator already closed this hold' })
  chargeAiCreditHoldAtBound(
    @Param('partnerCompanyId') companyId: string,
    @Param('reservationId') reservationId: string,
    @Body() dto: PartnerAiCreditHoldActionBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.aiCreditHoldsUseCase.chargeAtBound(this.holdCommand(companyId, reservationId, dto, req));
  }

  @Post(':partnerCompanyId/ai-credit-holds/:reservationId/acknowledge-breach')
  @HttpCode(200)
  @RequirePermissions('system.partner_ai_model.manage')
  @ApiOperation({ summary: 'Acknowledge one breach row: money untouched, admission for that scope reopens' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'No such hold in this company, or it carries no breach' })
  @ApiResponse({ status: 409, description: 'Already acknowledged' })
  acknowledgeAiCreditBreach(
    @Param('partnerCompanyId') companyId: string,
    @Param('reservationId') reservationId: string,
    @Body() dto: PartnerAiCreditHoldActionBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.aiCreditHoldsUseCase.acknowledgeBreach(this.holdCommand(companyId, reservationId, dto, req));
  }

  /** One shape for the three actions, so a route cannot forget the actor or the request id. */
  private holdCommand(
    companyId: string,
    reservationId: string,
    dto: PartnerAiCreditHoldActionBodyDto,
    req: AuthedRequest,
  ) {
    return {
      companyId,
      reservationId,
      reason: dto.reason,
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    };
  }

  // ---- P29 plan limits & term ----
  @Get(':partnerCompanyId/ai-adjustments')
  @RequirePermissions('system.partner_ai_model.manage')
  @ApiOperation({ summary: 'Read bounded AI adjustment history for the original company' })
  aiAdjustments(@Param('partnerCompanyId') companyId: string, @Query() query: PartnerAiAdjustmentHistoryQueryDto) {
    return this.getAiUsage.history(companyId, query.cursor);
  }

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

  @Get(':partnerCompanyId/plan-term/history')
  @RequirePermissions('system.partner_dashboard.read')
  planTermHistory(@Param('partnerCompanyId') companyId: string, @Query('cursor') cursor?: string) {
    return this.planAdjustmentHistory.execute(companyId, cursor);
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
      ...dto,
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
  @ApiOperation({
    summary: 'Push one operator-written LINE message to this shop OWNERs, plus the requester named '
      + 'by an optional supportRequestId — which is marked answered with it (SEC-05)',
  })
  @ApiResponse({ status: 200, description: 'How many LINE chats it reached' })
  @ApiResponse({ status: 404, description: 'No such shop, or a support request that is not this shop\'s or is already CLOSED' })
  @ApiResponse({ status: 422, description: 'Empty, too long, links outside our own domains, or no LINE channel' })
  sendLineMessage(
    @Param('partnerCompanyId') companyId: string,
    @Body() dto: PartnerLineMessageBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.lineMessage.execute({
      companyId,
      text: dto.text,
      ...(dto.supportRequestId ? { supportRequestId: dto.supportRequestId } : {}),
      requestingAdminUserId: req.context.userId,
      requestId: req.context.requestId,
    });
  }
}
