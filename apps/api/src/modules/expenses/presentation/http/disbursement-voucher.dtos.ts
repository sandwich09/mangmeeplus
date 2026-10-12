import { Type } from 'class-transformer';
import { Allow, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, Matches, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { EXPENSE_PAYMENT_METHODS, type ExpensePaymentMethod } from '@watchdog-bms/contracts';

class DisbursementVoucherDraftLineDto {
  @IsString() @IsNotEmpty() expenseId!: string;
  // The use case validates money against the current expense and answers with its number.
  @Allow() amount!: string;
}

export class CreateDisbursementVoucherDraftDto {
  @IsString() @IsNotEmpty() @MaxLength(128) commandId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DisbursementVoucherDraftLineDto)
  lines!: DisbursementVoucherDraftLineDto[];
  @ValidateIf((_, v) => v !== undefined) @IsString() payeeName?: string;
  @ValidateIf((_, v) => v !== undefined) @IsString() payeeBankName?: string;
  @ValidateIf((_, v) => v !== undefined) @IsString() payeeAccountName?: string;
  @ValidateIf((_, v) => v !== undefined) @IsString() payeeAccountNumber?: string;
  @ValidateIf((_, v) => v !== undefined) @IsBoolean() payeeConfirmed?: boolean;
  @ValidateIf((_, v) => v !== undefined) @IsString() plannedPayDate?: string;
  @ValidateIf((_, v) => v !== undefined) @IsIn(EXPENSE_PAYMENT_METHODS) plannedMethod?: ExpensePaymentMethod;
  @ValidateIf((_, v) => v !== undefined) @IsString() note?: string;
}

export class UpdateDisbursementVoucherDraftDto extends CreateDisbursementVoucherDraftDto {
  @IsInt() @Min(0) expectedVersion!: number;
}

export class DisbursementVoucherCommandDto {
  @IsString() @IsNotEmpty() @MaxLength(128) commandId!: string;
  @IsInt() @Min(0) expectedVersion!: number;
}

export class SubmitDisbursementVoucherDto extends DisbursementVoucherCommandDto {
  @ValidateIf((_, v) => v !== undefined) @IsString() @IsNotEmpty() requestedApproverUserId?: string;
  @ValidateIf((_, v) => v !== undefined) @IsBoolean() approveNow?: boolean;
}

export class EndDisbursementVoucherDto extends DisbursementVoucherCommandDto {
  // Required/minimum length depends on the action; the use case supplies its Thai sentence.
  @ValidateIf((_, v) => v !== undefined) @IsString() reason?: string;
}

export class PayDisbursementVoucherDto extends DisbursementVoucherCommandDto {
  @ValidateIf((_, v) => v !== undefined) @IsString() @IsNotEmpty() @MaxLength(64) slipAttachmentId?: string;
  @ValidateIf((_, v) => v !== undefined) @IsString() paidDate?: string;
  @ValidateIf((_, v) => v !== undefined) @IsIn(EXPENSE_PAYMENT_METHODS) paymentMethod?: ExpensePaymentMethod;
  @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(128) paidFromRef?: string;
}

export class InitDisbursementVoucherSlipUploadDto {
  @IsString() @IsNotEmpty() @MaxLength(255) originalFileName!: string;
  @IsString() @IsNotEmpty() @MaxLength(255) mimeType!: string;
  @IsInt() @Min(1) byteSize!: number;
}

export class CompleteDisbursementVoucherSlipUploadDto {
  @ValidateIf((_, v) => v !== undefined) @Matches(/^[0-9a-f]{64}$/) checksumSha256?: string;
  @ValidateIf((_, v) => v !== undefined) @IsInt() @Min(1) byteSize?: number;
}

export class AttachDisbursementVoucherSlipDto {
  @IsString() @IsNotEmpty() @MaxLength(64) attachmentId!: string;
}

export class ReissueDisbursementVoucherDto {
  @IsString() @IsNotEmpty() @MaxLength(128) commandId!: string;
}
export class IssueDisbursementVoucherDto extends ReissueDisbursementVoucherDto {
  @IsString() @IsNotEmpty() expenseId!: string;
  @IsString() @IsNotEmpty() paymentId!: string;
}

export class RemindDisbursementVoucherDto extends DisbursementVoucherCommandDto {
  @IsString() @IsNotEmpty() approverUserId!: string;
}
