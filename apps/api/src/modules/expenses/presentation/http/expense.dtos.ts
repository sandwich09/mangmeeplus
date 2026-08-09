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
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { CIVIL_DATE_PATTERN } from '@watchdog-bms/contracts';
import { POSITIVE_ACCOUNTING_MONEY_PATTERN } from '../../../accounting-documents/domain/logic/accounting-money-validation.logic';

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

export class RecordExpensePaymentDto {
  // Same money pattern the accounting documents use — one definition of what a payable amount
  // looks like, so the two boundaries cannot disagree about "1e5" or "-0.001".
  @Matches(POSITIVE_ACCOUNTING_MONEY_PATTERN) paidAmount!: string;
  @IsString() @IsOptional() @MaxLength(64) paymentMethod?: string;
  @Matches(CIVIL_DATE_PATTERN) @IsOptional() paidAt?: string;
  @IsString() @IsOptional() @MaxLength(128) bankAccountRef?: string;
}

export class SetSignatureDerivedAssetDto {
  @IsString() @IsNotEmpty() @MaxLength(64) attachmentId!: string;
  @IsString() @IsOptional() @MaxLength(128) checksumSha256?: string;
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() byteSize?: number;
}
