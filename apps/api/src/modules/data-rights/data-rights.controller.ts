import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  DATA_RIGHTS_AUTHORITY_METHODS,
  DATA_RIGHTS_CASE_STATUSES,
  DATA_RIGHTS_CASE_TYPES,
  DATA_RIGHTS_DECISION_CATEGORIES,
  DATA_RIGHTS_DISPOSITIONS,
  DATA_RIGHTS_EVIDENCE_TYPES,
  DATA_RIGHTS_IDENTITY_METHODS,
  DATA_RIGHTS_REQUEST_SOURCES,
  DATA_RIGHTS_SINGLE_ADMIN_REASON_MAX_LENGTH,
  type DataRightsAuthorityMethod,
  type DataRightsCaseStatus,
  type DataRightsCaseType,
  type DataRightsDecisionCategory,
  type DataRightsDisposition,
  type DataRightsEvidenceType,
  type DataRightsIdentityMethod,
  type DataRightsRequestSource,
} from '@watchdog-bms/contracts';
import type { Request } from 'express';
import { RequirePermissions } from '../../common/security/permissions.decorator';
import type { RequestContext } from '../auth/domain/models/request-context.model';
import {
  DATA_RIGHTS_EVIDENCE_REFERENCE_PATTERN,
  DATA_RIGHTS_DUE_FILTERS,
  DATA_RIGHTS_MANAGE_PERMISSION,
  DataRightsService,
  type DataRightsDueFilter,
} from './data-rights.service';

const OPAQUE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PRIOR_CASE_REFERENCE = /^case:\/\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

class CommandDto {
  @IsString() @Matches(OPAQUE_KEY) commandId!: string;
}

/**
 * A step refused to the person who took the step before. The one active System Admin sends
 * `singleAdminReason` to take it as an explicit self-step (P31 §8); the service decides whether
 * that is allowed and whether the reason says enough.
 */
export class SameActorStepDto extends CommandDto {
  @IsString() @IsOptional() @MaxLength(DATA_RIGHTS_SINGLE_ADMIN_REASON_MAX_LENGTH) singleAdminReason?: string;
}

export class CreateCaseDto extends CommandDto {
  @IsString() @Matches(OPAQUE_KEY) requestKey!: string;
  @IsIn(DATA_RIGHTS_CASE_TYPES) caseType!: DataRightsCaseType;
  @IsIn(DATA_RIGHTS_REQUEST_SOURCES) requestSource!: DataRightsRequestSource;
  @IsString() @IsOptional() @MaxLength(320) requesterContact?: string;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(128) targetUserId?: string;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(128) companyId?: string;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(128) membershipId?: string;
  @IsDateString() @IsOptional() receivedAt?: string;
  @IsDateString() dueAt!: string;
  @IsString() @IsOptional() @Matches(PRIOR_CASE_REFERENCE) priorCaseReference?: string;
}

export class VerificationEvidenceDto extends CommandDto {
  @IsString() @IsNotEmpty() @MaxLength(500) @Matches(DATA_RIGHTS_EVIDENCE_REFERENCE_PATTERN) reference!: string;
  @IsString() @IsOptional() @Matches(/^[0-9a-fA-F]{64}$/) sha256?: string;
  @IsString() @IsOptional() @MaxLength(2_000) note?: string;
}

export class VerifyIdentityDto extends VerificationEvidenceDto {
  @IsIn(DATA_RIGHTS_IDENTITY_METHODS) method!: DataRightsIdentityMethod;
}

class VerifyAuthorityDto extends VerificationEvidenceDto {
  @IsIn(DATA_RIGHTS_AUTHORITY_METHODS) method!: DataRightsAuthorityMethod;
}

class RecordDecisionDto extends CommandDto {
  @IsIn(DATA_RIGHTS_DECISION_CATEGORIES) category!: DataRightsDecisionCategory;
  @IsIn(DATA_RIGHTS_DISPOSITIONS) disposition!: DataRightsDisposition;
  @IsString() @IsNotEmpty() @MaxLength(120) legalBasisCode!: string;
  @IsString() @IsNotEmpty() @MaxLength(4_000) rationale!: string;
  @IsDateString() @IsOptional() retentionUntil?: string;
  @IsString() @IsOptional() @MaxLength(2_000) accessRestriction?: string;
}

export class RecordEvidenceDto extends CommandDto {
  @IsIn(DATA_RIGHTS_EVIDENCE_TYPES) evidenceType!: DataRightsEvidenceType;
  @ValidateIf((value: RecordEvidenceDto) => value.evidenceType !== 'INDEPENDENT_VERIFICATION')
  @IsDefined()
  @IsIn(DATA_RIGHTS_DECISION_CATEGORIES)
  category?: DataRightsDecisionCategory;
  @IsString() @IsNotEmpty() @MaxLength(500) @Matches(DATA_RIGHTS_EVIDENCE_REFERENCE_PATTERN) reference!: string;
  @IsDefined() @IsString() @Matches(/^[0-9a-fA-F]{64}$/) sha256!: string;
  @IsString() @IsOptional() @MaxLength(2_000) note?: string;
  @IsString() @IsOptional() @MaxLength(DATA_RIGHTS_SINGLE_ADMIN_REASON_MAX_LENGTH) singleAdminReason?: string;
}

export class CompleteCaseDto extends CommandDto {
  @IsIn(['COMPLETED', 'COMPLETED_WITH_EXCEPTION']) outcome!: 'COMPLETED' | 'COMPLETED_WITH_EXCEPTION';
  @IsString() @IsNotEmpty() @MaxLength(4_000) outcomeSummary!: string;
  @IsString() @IsOptional() @MaxLength(DATA_RIGHTS_SINGLE_ADMIN_REASON_MAX_LENGTH) singleAdminReason?: string;
}

export class CloseCaseDto extends CommandDto {
  @IsIn(['REJECTED', 'CANCELLED', 'BLOCKED']) outcome!: 'REJECTED' | 'CANCELLED' | 'BLOCKED';
  @IsString() @IsNotEmpty() @MaxLength(4_000) reason!: string;
}

export class ListCasesQueryDto {
  @IsIn(DATA_RIGHTS_CASE_STATUSES) @IsOptional() status?: DataRightsCaseStatus;
  @IsIn(DATA_RIGHTS_CASE_TYPES) @IsOptional() caseType?: DataRightsCaseType;
  @IsString() @IsOptional() @IsNotEmpty() companyId?: string;
  @IsString() @IsOptional() @IsNotEmpty() targetUserId?: string;
  @IsString() @IsOptional() @IsNotEmpty() cursor?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional() pageSize?: number;
  @IsIn(DATA_RIGHTS_DUE_FILTERS) @IsOptional() dueFilter?: DataRightsDueFilter;
}

type AuthedRequest = Request & { context: RequestContext };

/**
 * Internal-only case control plane. No endpoint performs deletion or calls object storage: every
 * step, including "start execution" and "complete", only moves the case's status, stamps the
 * operator and appends a journal row.
 */
@Controller('system/data-rights')
@RequirePermissions(DATA_RIGHTS_MANAGE_PERMISSION)
export class DataRightsController {
  constructor(private readonly service: DataRightsService) {}

  @Post('cases')
  @ApiOperation({ summary: 'Open a restricted user/company data-rights case' })
  create(@Body() body: CreateCaseDto, @Req() req: AuthedRequest) {
    return this.service.createCase(req.context, body);
  }

  @Get('cases')
  @ApiOperation({ summary: 'List data-rights cases with explicit safe fields and cursor paging' })
  list(@Query() query: ListCasesQueryDto, @Req() req: AuthedRequest) {
    return this.service.listCases(req.context, query);
  }

  @Get('cases/:caseId')
  @ApiOperation({ summary: 'Read one data-rights case and its append-only evidence trail' })
  get(@Param('caseId') caseId: string, @Req() req: AuthedRequest) {
    return this.service.getCase(req.context, caseId);
  }

  @Post('cases/:caseId/verify-identity')
  @HttpCode(200)
  verifyIdentity(@Param('caseId') caseId: string, @Body() body: VerifyIdentityDto, @Req() req: AuthedRequest) {
    return this.service.verifyIdentity(req.context, caseId, body);
  }

  @Post('cases/:caseId/verify-authority')
  @HttpCode(200)
  verifyAuthority(@Param('caseId') caseId: string, @Body() body: VerifyAuthorityDto, @Req() req: AuthedRequest) {
    return this.service.verifyAuthority(req.context, caseId, body);
  }

  @Post('cases/:caseId/begin-retention-review')
  @HttpCode(200)
  beginRetentionReview(@Param('caseId') caseId: string, @Body() body: CommandDto, @Req() req: AuthedRequest) {
    return this.service.beginRetentionReview(req.context, caseId, body.commandId);
  }

  @Post('cases/:caseId/decisions')
  @HttpCode(200)
  recordDecision(@Param('caseId') caseId: string, @Body() body: RecordDecisionDto, @Req() req: AuthedRequest) {
    return this.service.recordDecision(req.context, caseId, body);
  }

  @Post('cases/:caseId/evidence')
  @HttpCode(200)
  recordEvidence(@Param('caseId') caseId: string, @Body() body: RecordEvidenceDto, @Req() req: AuthedRequest) {
    return this.service.recordEvidence(req.context, caseId, body);
  }

  @Post('cases/:caseId/approve')
  @HttpCode(200)
  approve(@Param('caseId') caseId: string, @Body() body: SameActorStepDto, @Req() req: AuthedRequest) {
    return this.service.approve(req.context, caseId, body.commandId, body.singleAdminReason);
  }

  @Post('cases/:caseId/start-execution')
  @HttpCode(200)
  startExecution(@Param('caseId') caseId: string, @Body() body: SameActorStepDto, @Req() req: AuthedRequest) {
    return this.service.startExecution(req.context, caseId, body.commandId, body.singleAdminReason);
  }

  @Post('cases/:caseId/start-verification')
  @HttpCode(200)
  startVerification(@Param('caseId') caseId: string, @Body() body: SameActorStepDto, @Req() req: AuthedRequest) {
    return this.service.startVerification(req.context, caseId, body.commandId, body.singleAdminReason);
  }

  @Post('cases/:caseId/complete')
  @HttpCode(200)
  complete(@Param('caseId') caseId: string, @Body() body: CompleteCaseDto, @Req() req: AuthedRequest) {
    return this.service.complete(req.context, caseId, body);
  }

  @Post('cases/:caseId/close')
  @HttpCode(200)
  close(@Param('caseId') caseId: string, @Body() body: CloseCaseDto, @Req() req: AuthedRequest) {
    return this.service.close(req.context, caseId, body);
  }
}
