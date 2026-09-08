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
  IsArray,
  IsObject,
  ArrayMinSize,
  ArrayMaxSize,
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
import { BUYER_ENTITY_KINDS, EXPENSE_LINE_CHARGE_KINDS, TRANSACTION_TAX_CONTEXTS,
  type BuyerEntityKind, type CreateExpenseDraftInput, type ExpenseVatMode, type ExpenseVatSourceInput, type ExpenseWhtInput, type InputVatClaimStatus } from '@watchdog-bms/contracts';

/** Preview accepts the existing review form's fields only. Domain money/source validators still
 * own semantics; these DTOs reject type confusion and server-owned fields before calculation. */
export class ExpenseTotalsPreviewLineDto {
  @IsInt() @Min(1) lineNumber!: number;
  @IsString() description!: string;
  @IsString() quantity!: string;
  @IsString() unitPrice!: string;
  @IsOptional() @IsIn(EXPENSE_LINE_CHARGE_KINDS) chargeKind?: CreateExpenseDraftInput['lines'][number]['chargeKind'];
  @IsOptional() @IsIn(['ZERO_RATED', 'EXEMPT', 'NON_VAT']) vatTreatment?: CreateExpenseDraftInput['lines'][number]['vatTreatment'];
  @ValidateIf((_o, v) => v !== undefined) @IsString() id?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() sourceItemRef?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() discountAmount?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() vatRate?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() whtRate?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() expenseCategoryId?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() accountHintKey?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() taxCategory?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() taxCodeDefinitionId?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() externalTaxCode?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(TRANSACTION_TAX_CONTEXTS) transactionContext?: CreateExpenseDraftInput['lines'][number]['transactionContext'];
}

export class ExpenseTotalsPreviewDto {
  @IsString() @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ExpenseTotalsPreviewLineDto)
  lines!: ExpenseTotalsPreviewLineDto[];
  @ValidateIf((_o, v) => v !== undefined) @IsString() vendorNameSnapshot?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() vendorTaxIdSnapshot?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(BUYER_ENTITY_KINDS) vendorEntityKindSnapshot?: BuyerEntityKind;
  @ValidateIf((_o, v) => v !== undefined) @IsString() vendorDocumentNumber?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() @IsISO8601({ strict: true }) expenseDate?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() note?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['NO_VAT', 'VAT_INCLUDED', 'VAT_EXCLUDED', 'EXEMPT', 'NEEDS_REVIEW']) vatMode?: ExpenseVatMode;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['CLAIMABLE', 'NON_CLAIMABLE', 'NEEDS_REVIEW']) inputVatClaimStatus?: InputVatClaimStatus;
  @ValidateIf((_o, v) => v !== undefined) @IsObject() vatSource?: ExpenseVatSourceInput;
  @ValidateIf((_o, v) => v !== undefined) @IsObject() whtInput?: ExpenseWhtInput;
  @ValidateIf((_o, v) => v !== undefined) @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) removedSourceItemRefs?: string[];
}

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
