/**
 * HTTP-boundary validation for expense bodies (audit H-23).
 *
 * These twelve were inline object literals on `@Body()`, which reach the global ValidationPipe as
 * metatype `Object` and are skipped — the field list was written down and enforced by nothing.
 * `reason` is the sharpest case: several handlers call `reason.trim()`, so a JSON object in that
 * field was a 500, which is the same type-confusion the audit found in reimbursement.
 *
 * Inline-literal bodies and new paper-signing/correction endpoints are validated here.
 * The remaining legacy controller bodies are imported
 * contract types whose field sets have to be read from the contract before they can be declared;
 * guessing them would trade a skipped validation for a `forbidNonWhitelisted` 400 on a legitimate
 * request, which is worse.
 *
 * Optionality mirrors the literal being replaced exactly. Promoting a field to required on a live
 * endpoint is a contract change, not a hardening — a caller that has always omitted it would start
 * getting 400s the moment this deploys.
 */
import { Transform, Type } from 'class-transformer';
import { ACCOUNTING_SOFTWARE_EXPORT_PRESETS, INPUT_VAT_REVIEWER_CONDITIONS, EXPENSE_STATUSES, EXPENSE_PAYMENT_STATUSES, SOURCE_DOCUMENT_TYPE_LABELS, TAX_EVIDENCE_STATUS_LABELS, type SharedEvidenceFilter, normalizeExpensePaymentAmount } from '@watchdog-bms/contracts';
import {
  IsInt,
  IsBoolean,
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
  Max,
  MaxLength,
  Length,
  Min,
  IsUUID,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { CIVIL_DATE_PATTERN, EXPENSE_PAYMENT_METHODS, type RecordExpensePaymentInput, type ExpensePaymentMethod,
  type AmendSubstituteReceiptInput, type SubmitSubstituteReceiptPaperInput, type AcceptSubstituteReceiptPaperInput, type SubstituteReceiptPaperSignerInput } from '@watchdog-bms/contracts';
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
  @ValidateIf((_o, v) => v !== undefined) @IsString() whtCategoryCode?: string;
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

/** The two kinds of file a person preparing a ใบรับรองแทนใบเสร็จ may attach to their own expense. */
const SUBSTITUTE_PREPARATION_UPLOAD_PURPOSES = ['expense.receipt.supporting', 'expense.payment.evidence'] as const;

export class SubstitutePreparationUploadIntentDto extends UploadIntentDto {
  @IsIn(SUBSTITUTE_PREPARATION_UPLOAD_PURPOSES) purpose!: typeof SUBSTITUTE_PREPARATION_UPLOAD_PURPOSES[number];
}

export class SubstitutePreparationUploadCompletionDto extends UploadCompletionDto {
  @IsIn(SUBSTITUTE_PREPARATION_UPLOAD_PURPOSES) purpose!: typeof SUBSTITUTE_PREPARATION_UPLOAD_PURPOSES[number];
}

/** Sending an expense for checking may name the person asked; a caller that names nobody sends no body. */
export class MarkExpenseReadyDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64) requestedReviewerUserId?: string;
}

/**
 * Spec §16.4. All four fields are optional: a completion that names no `intent` is the legacy call
 * and keeps its exact behaviour, so the LINE lane and older web builds are untouched.
 */
export class ReceiptUploadCompletionDto extends UploadCompletionDto {
  @IsString() @IsOptional() @MaxLength(64) purpose?: string;
  @IsOptional() @IsIn(['replace', 'append']) intent?: 'replace' | 'append';
  @IsOptional() @IsISO8601({ strict: true }) expectedUpdatedAt?: string;
  @IsString() @IsOptional() @MaxLength(64) expectedPrimaryAttachmentId?: string;
  // A uuid, because the client generates it once per attempt and reuses it verbatim on retry.
  @IsOptional() @IsUUID() operationId?: string;
}

/** Reject / void / signature-reject: the handlers trim this, so it has to be a string. */
export class ReasonRequiredDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class VoidExpenseDto extends ReasonRequiredDto {
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean() taxFilingAttested?: boolean;
}

export class ReopenExpenseDto extends ReasonRequiredDto {
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean() taxFilingAttested?: boolean;
}

/** Mutable certificate facts only; identities, numbering and signing state stay server-owned. */
export class AmendSubstituteReceiptDto implements AmendSubstituteReceiptInput {
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean() keepDocumentNumberConfirmed?: boolean;
  @IsIn(['PAYEE_CANNOT_ISSUE', 'RECEIPT_UNAVAILABLE', 'RECEIPT_MATERIALLY_INCOMPLETE', 'OTHER']) reasonCode!: AmendSubstituteReceiptInput['reasonCode'];
  @IsString() @IsNotEmpty() @MaxLength(500) missingReceiptReason!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) businessPurpose!: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MaxLength(200) payeeName?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MaxLength(300) payeeAddress?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() payeeTaxId?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsArray() @IsString({ each: true }) paymentEvidenceAttachmentIds?: string[];
  @ValidateIf((_o, v) => v !== undefined) @IsArray() @IsString({ each: true }) supportingAttachmentIds?: string[];
  @Matches(CIVIL_DATE_PATTERN) @IsISO8601({ strict: true }) paymentDate!: string;
  @IsIn(EXPENSE_PAYMENT_METHODS) paymentMethod!: ExpensePaymentMethod;
  @IsString() @IsISO8601({ strict: true }) expectedExpenseUpdatedAt!: string;
  @IsString() @IsISO8601({ strict: true }) expectedEvidenceUpdatedAt!: string;
}

export class CorrectSubstituteDocumentDto extends ReasonRequiredDto {
  @IsString() @IsISO8601({ strict: true }) expectedEvidenceUpdatedAt!: string;
}

export class SubstituteReceiptPaperSignerDto implements SubstituteReceiptPaperSignerInput {
  @IsString() @IsNotEmpty() name!: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() position?: string;
  @Matches(CIVIL_DATE_PATTERN) @IsISO8601({ strict: true }) signedOn!: string;
}

export class SubmitSubstituteReceiptPaperDto implements SubmitSubstituteReceiptPaperInput {
  @IsObject() @ValidateNested() @Type(() => SubstituteReceiptPaperSignerDto) payer!: SubstituteReceiptPaperSignerDto;
  @IsObject() @ValidateNested() @Type(() => SubstituteReceiptPaperSignerDto) approver!: SubstituteReceiptPaperSignerDto;
  @IsBoolean() samePerson!: boolean;
  @IsString() @IsNotEmpty() attachmentId!: string;
  @Matches(/^[a-f0-9]{64}$/) checksumSha256!: string;
  @IsInt() @Min(1) byteSize!: number;
  @IsIn([true]) formMatchesAcknowledged!: true;
  @IsString() @IsISO8601({ strict: true }) expectedEvidenceUpdatedAt!: string;
}

export class AcceptSubstituteReceiptPaperDto implements AcceptSubstituteReceiptPaperInput {
  @Matches(/^[a-f0-9]{64}$/) previewChecksumSha256!: string;
  @IsString() @IsISO8601({ strict: true }) expectedEvidenceUpdatedAt!: string;
  @IsIn([true]) factsAndSignaturesAcknowledged!: true;
  @IsIn([true]) approverAuthorityAcknowledged!: true;
  @IsIn([true]) originalRetainedAcknowledged!: true;
}

/** Duplicate dismiss / confirm: the note is genuinely optional here. The buyer-match confirm reuses it
 *  and refuses a blank reason in its use case, with a code the web can put into words. */
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
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64) slipAttachmentId?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @Matches(PAYMENT_IDEMPOTENCY_KEY_PATTERN) idempotencyKey?: string;
  // Same money pattern the accounting documents use — one definition of what a payable amount
  // looks like, so the two boundaries cannot disagree about "1e5" or "-0.001".
  @Transform(({ value }) => typeof value === 'string' ? normalizeExpensePaymentAmount(value) : value)
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

export class RemoveExpenseReceiptDto {
  @IsOptional()
  @IsIn(['expense.receipt.primary', 'expense.receipt.supporting', 'expense.payment.evidence', 'expense.review.evidence'])
  purpose?: 'expense.receipt.primary' | 'expense.receipt.supporting' | 'expense.payment.evidence' | 'expense.review.evidence';
  @IsISO8601()
  expectedUpdatedAt!: string;
}

/** Same expense selection as the accounting sheet; bytes still pass the attachment read gate. */
export class AccountantEvidenceBundleDto {
  @IsOptional() @IsArray() @ArrayMaxSize(10000) @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(200, { each: true })
  expenseIds?: string[];
  @IsOptional() @IsIn(['uploadedAt', 'expenseDate'])
  dateField?: 'uploadedAt' | 'expenseDate';
  @IsOptional() @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  yearMonth?: string;
  @IsOptional() @IsISO8601() fromDate?: string;
  @IsOptional() @IsISO8601() toDate?: string;
  @IsOptional() @IsString() @MaxLength(255) branchId?: string;
  @IsOptional() @IsString() @MaxLength(255) expenseCategoryId?: string;
  @IsOptional() @IsString() @MaxLength(255) createdByUserId?: string;
  @IsOptional() @IsIn(EXPENSE_STATUSES) status?: SharedEvidenceFilter['status'];
  @IsOptional() @IsIn(Object.keys(SOURCE_DOCUMENT_TYPE_LABELS)) sourceDocumentType?: SharedEvidenceFilter['sourceDocumentType'];
  @IsOptional() @IsIn(Object.keys(TAX_EVIDENCE_STATUS_LABELS)) taxEvidenceStatus?: SharedEvidenceFilter['taxEvidenceStatus'];
  @IsOptional() @IsIn(EXPENSE_PAYMENT_STATUSES) paymentStatus?: SharedEvidenceFilter['paymentStatus'];
  @IsOptional() @IsIn(['not_required', 'pending', 'posted', 'posting_error', 'reversed']) postingStatus?: SharedEvidenceFilter['postingStatus'];
}


export class AccountantPackageDto extends AccountantEvidenceBundleDto {
  @IsOptional() @IsIn(['summary', 'full']) columnSet?: 'summary' | 'full';
  @IsOptional() @IsIn(['csv']) format?: 'csv';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pageSize?: number;
}


export class AccountingSoftwareExportDto extends AccountantPackageDto {
  @IsIn(ACCOUNTING_SOFTWARE_EXPORT_PRESETS) preset!: 'purchase_journal';
  @Transform(({ value }) => value === '' ? undefined : value)
  override status: SharedEvidenceFilter['status'] = undefined;
}


export class DecideExpenseInputVatDto {
  @IsIn(['CLAIMABLE', 'NON_CLAIMABLE']) toStatus!: 'CLAIMABLE' | 'NON_CLAIMABLE';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsIn(INPUT_VAT_REVIEWER_CONDITIONS.map(condition => condition.code), { each: true }) reviewerConditions?: string[];
  @IsOptional() @IsBoolean() buyerConfirmed?: boolean;
}

export class ConfirmExpensePaymentDateDto {
  @Matches(CIVIL_DATE_PATTERN) paidAt!: string;
}

/** List paging and filters; the use case still enforces scope and normalizes page size. */
export class SubstituteReceiptListQueryDto {
  @IsOptional() @IsIn(['PREPARED', 'PAYER_CERTIFIED', 'ISSUED', 'SUPERSEDED'])
  status?: import('@watchdog-bms/contracts').SubstituteReceiptEvidenceStatus;
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) yearMonth?: string;
  @IsOptional() @IsString() payerUserId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
  @IsOptional() @IsIn(['newest', 'oldest']) order?: 'newest' | 'oldest';
}

export class SetExpenseCategoryAccountantAccountDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 20)
  @Matches(/^[^=+\-@\u0000-\u001F\u007F][^\u0000-\u001F\u007F]*$/)
  accountCode!: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 120)
  @Matches(/^[^=+\-@\u0000-\u001F\u007F][^\u0000-\u001F\u007F]*$/)
  accountName!: string;
}
