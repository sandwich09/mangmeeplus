/**
 * HTTP-boundary validation for the capture group (appendix §9).
 *
 * Every mutation carries `expectedRevision`: without it a second tab silently overwrites a
 * decision it never saw. Server-owned fields are absent on purpose — `payerUserId`, `status`,
 * `handoffState` and the lineage columns are set by the server from evidence (§5), so a client
 * that sends one gets a 400 from `forbidNonWhitelisted` rather than a quiet write.
 */
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { EXPENSE_CAPTURE_CLOSE_REASONS, type ExpenseCaptureCloseReason } from '@watchdog-bms/contracts';

export class CreateExpenseCaptureGroupDto {
  @IsOptional() @IsString() @MaxLength(64) branchId?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ExpenseCaptureRevisionDto {
  @Type(() => Number) @IsInt() @Min(1) expectedRevision!: number;
}

export class AddExpenseCaptureFileDto extends ExpenseCaptureRevisionDto {
  @IsString() @IsNotEmpty() @MaxLength(255) originalFileName!: string;
  @IsString() @IsNotEmpty() @MaxLength(255) mimeType!: string;
  // The declared size decides the signed upload; a fractional or negative one is meaningless.
  @Type(() => Number) @IsInt() @Min(1) byteSize!: number;
}

export class CompleteExpenseCaptureFileDto extends ExpenseCaptureRevisionDto {
  @ValidateIf((_o, value) => value !== undefined) @Type(() => Number) @IsInt() @Min(1) byteSize?: number;
  @ValidateIf((_o, value) => value !== undefined) @IsString() @MaxLength(64) checksumSha256?: string;
}

export class DetachExpenseCaptureFileDto extends ExpenseCaptureRevisionDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class CloseExpenseCaptureGroupDto extends ExpenseCaptureRevisionDto {
  @IsIn(EXPENSE_CAPTURE_CLOSE_REASONS) reason!: ExpenseCaptureCloseReason;
}

/** §3.1 conversion fences on the expense's own revision, like every other expense mutation. */
export class ConvertExpenseToCaptureGroupDto {
  @IsString() @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
}
