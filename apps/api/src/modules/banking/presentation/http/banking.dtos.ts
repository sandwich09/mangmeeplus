// HTTP-boundary validation for the two banking bodies that still took
// `@Body() body: any` (G1). Statement money is signed — a withdrawal arrives as a
// negative signedAmount — so these use the signed decimal pattern.
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { BankStatementLineDirection } from '@watchdog-bms/contracts';
import {
  DECIMAL_STRING_PATTERN, SIGNED_DECIMAL_STRING_PATTERN,
} from '../../../../common/pipes/decimal-string.patterns';

const LINE_DIRECTIONS = ['DEPOSIT', 'WITHDRAWAL', 'ZERO'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const CURRENCY = /^[A-Z]{3}$/;

/**
 * POST /banking/bank-accounts/:bankAccountId/statement-lines. Mirrors
 * Omit<CreateStatementLineInput, 'companyId' | 'bankAccountId' | 'sourceType' | 'importId' | 'createdByUserId'>
 * — the use case fills those five itself, so a caller cannot forge a line as
 * IMPORT-sourced or attach it to another tenant's account.
 */
export class CreateManualStatementLineDto {
  @IsInt() @Min(1) @Max(1_000_000) @IsOptional() rowNumber?: number;
  @IsString() @IsNotEmpty() @MaxLength(200) lineHash!: string;
  @Matches(ISO_DATE) postedDate!: string;
  @Matches(ISO_DATE) @IsOptional() valueDate?: string;
  @IsString() @IsNotEmpty() @MaxLength(1_000) description!: string;
  @IsString() @IsOptional() @MaxLength(1_000) normalizedDescription?: string;
  @IsString() @IsOptional() @MaxLength(300) counterpartyName?: string;
  @IsString() @IsOptional() @MaxLength(160) bankReference?: string;
  @IsString() @IsOptional() @MaxLength(40) chequeNumber?: string;
  @IsIn(LINE_DIRECTIONS) direction!: BankStatementLineDirection;
  @Matches(SIGNED_DECIMAL_STRING_PATTERN) signedAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() debitAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() creditAmount?: string;
  @Matches(SIGNED_DECIMAL_STRING_PATTERN) @IsOptional() runningBalanceAmount?: string;
  @Matches(CURRENCY) currency!: string;
  @IsString() @IsOptional() @MaxLength(64) duplicateOfLineId?: string;
}

/** POST /banking/reconciliations — the session number and balances are derived, not taken. */
export class CreateReconciliationSessionDto {
  @IsString() @IsNotEmpty() @MaxLength(64) bankAccountId!: string;
  @IsString() @IsOptional() @MaxLength(64) sessionNumber?: string;
  @Matches(ISO_DATE) periodStartDate!: string;
  @Matches(ISO_DATE) periodEndDate!: string;
  @Matches(SIGNED_DECIMAL_STRING_PATTERN) openingStatementBalanceAmount!: string;
  @Matches(SIGNED_DECIMAL_STRING_PATTERN) closingStatementBalanceAmount!: string;
  @Matches(CURRENCY) currency!: string;
}
