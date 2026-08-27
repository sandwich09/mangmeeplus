/**
 * HTTP-boundary validation for expense bodies (audit H-23).
 *
 * These twelve were inline object literals on `@Body()`, which reach the global ValidationPipe as
 * metatype `Object` and are skipped — the field list was written down and enforced by nothing.
 * `reason` is the sharpest case: several handlers call `reason.trim()`, so a JSON object in that
 * field was a 500, which is the same type-confusion the audit found in reimbursement.
 *
 * Only the inline-literal bodies are here. The rest of this controller's bodies are imported
 * contract types whose field sets have to be read from the contract before they can be declared;
 * guessing them would trade a skipped validation for a `forbidNonWhitelisted` 400 on a legitimate
 * request, which is worse.
 *
 * Optionality mirrors the literal being replaced exactly. Promoting a field to required on a live
 * endpoint is a contract change, not a hardening — a caller that has always omitted it would start
 * getting 400s the moment this deploys.
 */
import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { CIVIL_DATE_PATTERN, EXPENSE_PAYMENT_METHODS, type RecordExpensePaymentInput, type ExpensePaymentMethod } from '@watchdog-bms/contracts';
import { PAYMENT_IDEMPOTENCY_KEY_PATTERN, POSITIVE_ACCOUNTING_MONEY_PATTERN } from '../../../accounting-documents/domain/logic/accounting-money-validation.logic';

/** Shared upload-intent shape: the client names a file, the server reserves storage for it. */
export class UploadIntentDto {
  @IsString() @IsNotEmpty() @MaxLength(255) originalFileName!: string;
  @IsString() @IsNotEmpty() @MaxLength(255) mimeType!: string;
  // The value decides the pre-signed upload the client gets back. A negative or fractional size is
  // meaningless, and the string "999" used to sail through into that calculation.
  @Type(() => Number) @IsInt() @Min(0) byteSize!: number;
}

export class ReceiptUploadIntentDto extends UploadIntentDto {
  @Matches(CIVIL_DATE_PATTERN) @IsOptional() expenseDate?: string;
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
  @IsString() @IsOptional() @MaxLength(500) note?: string;
}

/** Shared completion shape: the client reports what it actually uploaded. */
export class UploadCompletionDto {
  @IsString() @IsOptional() @MaxLength(128) checksumSha256?: string;
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() byteSize?: number;
}

export class ReceiptUploadCompletionDto extends UploadCompletionDto {
  @IsString() @IsOptional() @MaxLength(64) purpose?: string;
}

/** Reject / void / signature-reject: the handlers trim this, so it has to be a string. */
export class ReasonRequiredDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

/** Duplicate dismiss / confirm: the note is genuinely optional here. */
export class ReasonOptionalDto {
  @IsString() @IsOptional() @MaxLength(500) reason?: string;
}

/**
 * Plan 13.11.B "ใช้ยอดตามเอกสาร": the only way past an over-tolerance VAT block, and only for an
 * `expense.review` holder. Presence of the object is the override itself — the reason and the VAT
 * line that carries the difference are what the audit row has to be able to explain later.
 */
export class ExpenseVatSourceOverrideDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @Type(() => Number) @IsInt() @Min(1) vatLineNumber!: number;
  @IsString() @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
}

/** Confirm body. An empty object is the ordinary confirm; every existing caller sends exactly that. */
export class ConfirmExpenseDto {
  @IsOptional() @ValidateNested() @Type(() => ExpenseVatSourceOverrideDto)
  vatSourceOverride?: ExpenseVatSourceOverrideDto;
}

export class RecordExpensePaymentDto implements RecordExpensePaymentInput {
  @ValidateIf((_object, value) => value !== undefined)
  @Matches(PAYMENT_IDEMPOTENCY_KEY_PATTERN) idempotencyKey?: string;
  // Same money pattern the accounting documents use — one definition of what a payable amount
  // looks like, so the two boundaries cannot disagree about "1e5" or "-0.001".
  @Matches(POSITIVE_ACCOUNTING_MONEY_PATTERN) paidAmount!: string;
  @IsIn(EXPENSE_PAYMENT_METHODS) @IsOptional() paymentMethod?: ExpensePaymentMethod;
  @Matches(CIVIL_DATE_PATTERN) @IsOptional() paidAt?: string;
  @IsString() @IsOptional() @MaxLength(128) bankAccountRef?: string;
}

export class SetSignatureDerivedAssetDto {
  @IsString() @IsNotEmpty() @MaxLength(64) attachmentId!: string;
  @IsString() @IsOptional() @MaxLength(128) checksumSha256?: string;
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() byteSize?: number;
}

/**
 * Web signature-create body. The use case ALSO honours internal-only fields (`attachmentAlreadyActive`,
 * `lineMessageId`, `submittedFromChannel`) that only the LINE path may set: `attachmentAlreadyActive`
 * skips the PENDING_UPLOAD/ownership gate, so a caller-supplied one turns any ACTIVE attachment into a
 * signature asset pointing at it. This whitelist is what makes `forbidNonWhitelisted` reject those keys
 * at the edge; the controller also constructs the command from these fields alone.
 */
export class CreateSignatureAssetDto {
  @IsString() @IsNotEmpty() @MaxLength(64) attachmentId!: string;
  @IsString() @IsOptional() @MaxLength(255) label?: string;
  @IsString() @IsOptional() @MaxLength(128) checksumSha256?: string;
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() byteSize?: number;
}
