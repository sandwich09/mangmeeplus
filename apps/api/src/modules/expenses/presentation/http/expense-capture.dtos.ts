/**
 * HTTP-boundary validation for the capture group (appendix §9).
 *
 * Every mutation carries `expectedRevision`: without it a second tab silently overwrites a
 * decision it never saw. Server-owned fields are absent on purpose — `payerUserId`, `status`,
 * `handoffState` and the lineage columns are set by the server from evidence (§5), so a client
 * that sends one gets a 400 from `forbidNonWhitelisted` rather than a quiet write.
 */
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import {
  EXPENSE_CAPTURE_CLOSE_REASONS,
  type CaptureFactsPatch,
  type ExpenseCaptureBusinessUse,
  type ExpenseCaptureCloseReason,
  type ExpenseCaptureFundingRoute,
} from '@watchdog-bms/contracts';

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

/**
 * W04a §9. The three payload maps (`patch`, `selection`, `taxReview`, `expenseDateChoice`) are
 * keyed by ids the server assigned, so `class-validator` can only say "an object" here; the shape
 * inside is checked field by field in the domain logic and the use case, which is where the
 * allowed fields and enums live and where an unknown one has to be REFUSED rather than stripped.
 */
export class ExpenseCaptureFactsDto extends ExpenseCaptureRevisionDto {
  @IsString() @IsNotEmpty() @MaxLength(128) fileId!: string;
  @IsObject() patch!: CaptureFactsPatch;
}

export class ExpenseCaptureReviewDto extends ExpenseCaptureRevisionDto {
  @IsIn(['UNKNOWN', 'ALL_COMPANY', 'MIXED']) businessUse!: ExpenseCaptureBusinessUse;
  @IsIn(['UNKNOWN', 'COMPANY', 'EMPLOYEE']) fundingRoute!: ExpenseCaptureFundingRoute;
  @IsOptional() @IsObject() selection?: Record<string, { companyQuantity: string }>;
  // Sent only to CHANGE the payer; omitting it keeps whoever the group already records. `null`
  // clears it. The server still checks membership and the permission to name somebody else (§5).
  @ValidateIf((_o, value) => value !== undefined && value !== null) @IsString() @MaxLength(64) payerUserId?: string | null;
  @IsOptional() @IsObject() taxReview?: Record<string, unknown>;
  @IsOptional() @IsObject() expenseDateChoice?: Record<string, unknown>;
}
