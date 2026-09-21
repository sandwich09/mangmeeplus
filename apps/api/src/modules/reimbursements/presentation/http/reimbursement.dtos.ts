// HTTP-boundary validation for reimbursement bodies (lane C). The
// @watchdog-bms/contracts types are compile-time only; these classes give the
// global ValidationPipe runtime metadata so a claim cannot arrive without lines,
// with a client-supplied total, or with 10k rows (whitelist + forbidNonWhitelisted).
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional,
  IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import type {
  CreateReimbursementRequestInput,
  LinkReimbursementSignedCopyInput,
  RecordReimbursementPaymentInput,
  ReimbursementClaimSignatureRole,
  ReimbursementLineInput,
  ReimbursementPaymentMethod,
  SignReimbursementClaimFormInput,
  UpdateReimbursementDraftInput,
  UpdateReimbursementPolicyInput,
} from '@watchdog-bms/contracts';
import { REIMBURSEMENT_MAX_LINES } from '../../domain/logic/reimbursement.logic';

const PAYMENT_METHODS: ReimbursementPaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'];
const MONEY = /^\d{1,14}(?:\.\d{1,4})?$/;

// Nullable-by-design fields: @IsOptional would also skip validation for an
// explicit null, which is the documented way to clear line evidence.
const unlessNullish = ValidateIf((_object, value) => value !== undefined && value !== null);

export class ReimbursementLineDto implements ReimbursementLineInput {
  @IsInt() @Min(1) @Max(REIMBURSEMENT_MAX_LINES) lineNo!: number;
  @IsDateString({ strict: true }) incurredDate!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) description!: string;
  @IsString() @IsOptional() @MaxLength(500) purpose?: string;
  @IsString() @IsNotEmpty() @MaxLength(80) categoryKey!: string;
  @IsString() @IsOptional() @MaxLength(160) categoryLabel?: string;
  @Matches(MONEY) amount!: string;
  @IsString() @unlessNullish @IsNotEmpty() @MaxLength(64) attachmentId?: string | null;
  @IsString() @unlessNullish @IsNotEmpty() @MaxLength(64) linkedExpenseId?: string | null;
  @IsDateString({ strict: true }) @IsOptional() sourceExpenseUpdatedAt?: string;
}

export class CreateReimbursementRequestDto implements CreateReimbursementRequestInput {
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(64) requesterUserId?: string;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(64) branchId?: string;
  @IsString() @IsOptional() @MaxLength(200) title?: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
  @IsString() @IsOptional() @MaxLength(3) currency?: string;
  @IsString() @IsOptional() @MaxLength(500) missingReceiptReason?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(REIMBURSEMENT_MAX_LINES)
  @ValidateNested({ each: true }) @Type(() => ReimbursementLineDto)
  lines!: ReimbursementLineDto[];
}

export class UpdateReimbursementDraftDto implements UpdateReimbursementDraftInput {
  @IsString() @IsOptional() @MaxLength(200) title?: string;
  @IsString() @unlessNullish @IsNotEmpty() @MaxLength(1000) reason?: string;
  @IsString() @unlessNullish @IsNotEmpty() @MaxLength(3) currency?: string;
  @IsString() @unlessNullish @MaxLength(500) missingReceiptReason?: string | null;
  @IsArray() @IsOptional() @ArrayMinSize(1) @ArrayMaxSize(REIMBURSEMENT_MAX_LINES)
  @ValidateNested({ each: true }) @Type(() => ReimbursementLineDto)
  lines?: ReimbursementLineDto[];
}

export class UpdateReimbursementPolicyDto implements UpdateReimbursementPolicyInput {
  @IsDateString({ strict: true }) @Matches(/T/) @IsOptional() expectedUpdatedAt?: string;
  @Matches(MONEY) @IsOptional() approvalRequiredFromAmount?: string;
  @IsString() @IsNotEmpty() @MaxLength(120) @IsOptional() defaultApproverRole?: string;
  @IsBoolean() @IsOptional() allowSelfApproval?: boolean;
  @IsBoolean() @IsOptional() requireReceipt?: boolean;
  @IsBoolean() @IsOptional() allowMissingReceiptWithReason?: boolean;
  @IsIn(['WARN', 'BLOCK_SUBMIT', 'BLOCK_PAYMENT']) @IsOptional() duplicatePolicy?: UpdateReimbursementPolicyInput['duplicatePolicy'];
  @IsBoolean() @IsOptional() financeReviewRequired?: boolean;
  @IsInt() @Min(0) @Max(8760) @unlessNullish slaHours?: number | null;
  @IsIn(['ACTIVE', 'INACTIVE']) @IsOptional() status?: UpdateReimbursementPolicyInput['status'];
}

// ---- Claim-form signatures + signed copies (lane F) ----

const CLAIM_SIGNATURE_ROLES: ReimbursementClaimSignatureRole[] = ['REQUESTER', 'APPROVER', 'FINANCE_REVIEW', 'PAYER'];
const SIGNATURE_MIME_TYPES = ['image/png', 'image/jpeg'];
const SIGNATURE_MAX_BYTES = 2_000_000;

export class InitClaimSignatureUploadDto {
  @IsIn(CLAIM_SIGNATURE_ROLES) role!: ReimbursementClaimSignatureRole;
  @IsString() @IsNotEmpty() @MaxLength(255) originalFileName!: string;
  @IsIn(SIGNATURE_MIME_TYPES) mimeType!: string;
  @IsInt() @Min(1) @Max(SIGNATURE_MAX_BYTES) byteSize!: number;
}

export class CompleteClaimSignatureUploadDto {
  @IsIn(CLAIM_SIGNATURE_ROLES) role!: ReimbursementClaimSignatureRole;
  @Matches(/^[0-9a-f]{64}$/) @IsOptional() checksumSha256?: string;
  @IsInt() @IsOptional() @Min(1) @Max(SIGNATURE_MAX_BYTES) byteSize?: number;
}

export class SignReimbursementClaimFormDto implements SignReimbursementClaimFormInput {
  @IsIn(CLAIM_SIGNATURE_ROLES) role!: ReimbursementClaimSignatureRole;
  @IsString() @IsNotEmpty() @MaxLength(64) @IsOptional() signatureAttachmentId?: string;
  @IsString() @IsNotEmpty() @MaxLength(64) snapshotHash!: string;
}

export class LinkReimbursementSignedCopyDto implements LinkReimbursementSignedCopyInput {
  @IsString() @IsNotEmpty() @MaxLength(64) attachmentId!: string;
  @IsIn([true]) @IsOptional() acknowledgedComplete?: true;
  @ValidateIf((body: LinkReimbursementSignedCopyDto) => body.acknowledgedComplete === true)
  @IsString() @IsNotEmpty() @MaxLength(64) confirmedRequestNo?: string;
}

export class RecordReimbursementPaymentDto implements RecordReimbursementPaymentInput {
  @Matches(MONEY) paidAmount!: string;
  @IsString() @IsOptional() @MaxLength(3) currency?: string;
  @IsIn(PAYMENT_METHODS) paymentMethod!: ReimbursementPaymentMethod;
  @IsDateString({ strict: true }) paidAt!: string;
  @IsString() @IsOptional() @MaxLength(140) paymentReference?: string;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(64) bankAccountId?: string;
  @IsString() @IsOptional() @MaxLength(500) note?: string;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(128) idempotencyKey?: string;
}
