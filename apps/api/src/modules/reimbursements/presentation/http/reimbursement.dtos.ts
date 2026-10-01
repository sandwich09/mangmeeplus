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
  ApproveReimbursementInput,
  AttachReimbursementPaymentSlipInput,
  CreateReimbursementRequestInput,
  LinkReimbursementSignedCopyInput,
  RecordReimbursementPaymentInput,
  ReimbursementClaimSignatureRole,
  ReimbursementLineInput,
  ReimbursementPaymentMethod,
  RejectReimbursementInput,
  ReimbursementPayoutCorrectionReason,
  ReimbursementPayoutInput,
  ReimbursementPayoutKind,
  ReimbursementPayoutMethod,
  SignReimbursementClaimFormInput,
  SubmitReimbursementRequestInput,
  UpdateReimbursementDraftInput,
  UpdateReimbursementPolicyInput,
  VoidReimbursementPaymentInput,
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

// ---- Payout account ----
//
// Types and transport bounds only. Whether an account is complete and well formed is decided by the
// one shared rule in contracts (`invalidPayoutDestinationField`), so the API and the web cannot drift.

const PAYOUT_KINDS: ReimbursementPayoutKind[] = ['BANK_ACCOUNT', 'PROMPTPAY_PHONE'];
const PAYOUT_METHODS: ReimbursementPayoutMethod[] = ['BANK_TRANSFER', 'CASH'];

class PayoutDestinationFieldsDto {
  @IsIn(PAYOUT_KINDS) @IsOptional() payoutKind?: ReimbursementPayoutKind;
  @IsString() @IsOptional() @MaxLength(120) bankName?: string;
  @IsString() @IsOptional() @MaxLength(200) accountName?: string;
  // A string on purpose: leading zeros survive, and no client can send a number.
  @IsString() @IsOptional() @MaxLength(40) accountNumber?: string;
}

export class ReimbursementPayoutDto extends PayoutDestinationFieldsDto {
  @IsIn(['DEFAULT', 'CASH', 'SPECIFIED']) mode!: ReimbursementPayoutInput['mode'];
  @IsBoolean() @IsOptional() saveAsDefault?: boolean;
}

export class SetMemberPayoutAccountDto extends PayoutDestinationFieldsDto {
  @IsIn(PAYOUT_METHODS) payoutMethod!: ReimbursementPayoutMethod;
}

// ---- Payout account correction round (payout spec §14) ----

/**
 * Send an approved claim back to have its payout account corrected: a reason from the fixed list, and
 * a note at most. Only the shape is held here. Which reasons exist, how long the note may be and what
 * it may not carry are the use case's own refusals, each with a code the screen has words for
 * (`payout_correction_reason_required`, `payout_correction_note_too_long`, `note_contains_account_number`).
 */
export class RequestPayoutCorrectionDto {
  @IsString() @IsOptional() @MaxLength(40) reasonCode?: string;
  @IsString() @IsOptional() @MaxLength(2000) note?: string;
}

/** The account a claim in a round is given: a draft's three choices, and for "use the default account" the token of the default the form showed. */
export class SubmitPayoutCorrectionDto extends ReimbursementPayoutDto {
  @Matches(/^[0-9a-f]{32}$/) @IsOptional() defaultToken?: string;
}

export class CreateReimbursementRequestDto implements CreateReimbursementRequestInput {
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(64) requesterUserId?: string;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(64) branchId?: string;
  @IsString() @IsOptional() @MaxLength(200) title?: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
  @IsString() @IsOptional() @MaxLength(3) currency?: string;
  @IsString() @IsOptional() @MaxLength(500) missingReceiptReason?: string;
  @ValidateNested() @Type(() => ReimbursementPayoutDto) @IsOptional() payout?: ReimbursementPayoutInput;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(REIMBURSEMENT_MAX_LINES)
  @ValidateNested({ each: true }) @Type(() => ReimbursementLineDto)
  lines!: ReimbursementLineDto[];
}

export class UpdateReimbursementDraftDto implements UpdateReimbursementDraftInput {
  @IsString() @IsOptional() @MaxLength(200) title?: string;
  @IsString() @unlessNullish @IsNotEmpty() @MaxLength(1000) reason?: string;
  @IsString() @unlessNullish @IsNotEmpty() @MaxLength(3) currency?: string;
  @IsString() @unlessNullish @MaxLength(500) missingReceiptReason?: string | null;
  @ValidateNested() @Type(() => ReimbursementPayoutDto) @IsOptional() payout?: ReimbursementPayoutInput;
  @IsArray() @IsOptional() @ArrayMinSize(1) @ArrayMaxSize(REIMBURSEMENT_MAX_LINES)
  @ValidateNested({ each: true }) @Type(() => ReimbursementLineDto)
  lines?: ReimbursementLineDto[];
}

export class SubmitReimbursementDto implements SubmitReimbursementRequestInput {
  @IsString() @IsOptional() @MaxLength(200) idempotencyKey?: string;
  // What the draft's page showed as the account to be frozen (payout.submitToken).
  @Matches(/^[0-9a-f]{32}$/) @IsOptional() payoutSubmitToken?: string;
}

export class CancelReimbursementDto {
  // The transport bound only. Whether the reason is long enough is the expense void's own rule
  // (`isExpenseVoidReason`), asked in the use case before anything is written.
  @IsString() @IsOptional() @MaxLength(500) reason?: string;
}

export class ApproveReimbursementDto implements ApproveReimbursementInput {
  @IsString() @IsOptional() @MaxLength(2000) comment?: string;
  @IsString() @IsOptional() @MaxLength(128) approvalSnapshotHash?: string;
  @IsString() @IsOptional() @MaxLength(200) idempotencyKey?: string;
  // "ตรวจบัญชีแล้ว": a whole version number, never a string that happens to look like one.
  @IsInt() @Min(1) @IsOptional() payoutVerifiedVersion?: number;
}

/**
 * Refusing a claim. Transport bounds only: that a reason is given is the use case's own refusal
 * (`rejection_reason_required`), and which correction reasons exist is too
 * (`payout_correction_reason_required`); each has words on the screen. 500 is what the form allows.
 */
export class RejectReimbursementDto implements RejectReimbursementInput {
  @IsString() @IsOptional() @MaxLength(500) reason!: string;
  @IsString() @IsOptional() @MaxLength(128) approvalSnapshotHash?: string;
  @IsString() @IsOptional() @MaxLength(200) idempotencyKey?: string;
  @IsString() @IsOptional() @MaxLength(40) payoutCorrectionReasonCode?: ReimbursementPayoutCorrectionReason;
}

/** Voiding a payment: the reason, bounded like the form that asks for it. That one is given is the use case's refusal (`void_reason_required`). */
export class VoidReimbursementPaymentDto implements VoidReimbursementPaymentInput {
  @IsString() @IsOptional() @MaxLength(500) reason!: string;
}

export class ReimbursementDraftActionControlDto {
  @IsInt() @Min(1) previewRevision!: number;
  @Matches(/^[0-9a-f]{64}$/) confirmationDigest!: string;
}

export class ReimbursementInternalNoteDto {
  @IsString() @MaxLength(2000) body!: string;
}

export class UpdateReimbursementPolicyDto implements UpdateReimbursementPolicyInput {
  @IsDateString({ strict: true }) @Matches(/T/) @IsOptional() expectedUpdatedAt?: string;
  @Matches(MONEY) @IsOptional() approvalRequiredFromAmount?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(120, { each: true })
  @IsOptional() defaultApproverRoles?: string[];
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
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(64) slipAttachmentId?: string;
  // The payer's statement about the payout account (payout spec §12.3). Shapes only: whether it is
  // enough for this claim is decided under the payment lock by `planPaymentPayout`.
  @IsInt() @Min(1) @IsOptional() payoutDestinationVersion?: number;
  @IsBoolean() @IsOptional() payoutConfirmed?: boolean;
  @Matches(/^[0-9a-f]{32}$/) @IsOptional() payoutDefaultToken?: string;
  @IsString() @IsOptional() @MaxLength(500) methodMismatchReason?: string;
}

// ---- Payment slips ----
//
// Type and size are judged by the use case, which answers with the stable `payment_slip_invalid`
// the payment form translates; here only the shape is fixed.

export class InitPaymentSlipUploadDto {
  @IsString() @IsNotEmpty() @MaxLength(255) originalFileName!: string;
  @IsString() @IsNotEmpty() @MaxLength(255) mimeType!: string;
  @IsInt() @Min(1) byteSize!: number;
}

export class CompletePaymentSlipUploadDto {
  @Matches(/^[0-9a-f]{64}$/) @IsOptional() checksumSha256?: string;
  @IsInt() @IsOptional() @Min(1) byteSize?: number;
}

export class AttachPaymentSlipDto implements AttachReimbursementPaymentSlipInput {
  @IsString() @IsNotEmpty() @MaxLength(64) attachmentId!: string;
}
