/**
 * HTTP-boundary validation for transaction-tax bodies (audit H-23).
 *
 * These five were inline object literals on `@Body()`, which reach the global ValidationPipe as
 * metatype `Object` and are skipped. `generateReconciliation` passes its body straight into the use
 * case, so an unlisted key travelled all the way in.
 *
 * Only the inline literals are covered. The other eleven bodies on this controller are imported
 * contract types whose field sets have to be read from the contract before they can be declared —
 * guessing one trades a skipped validation for a `forbidNonWhitelisted` 400 on a request that was
 * always legitimate.
 *
 * Optionality mirrors each literal exactly; nothing is promoted to required, because on a live
 * endpoint that is a contract change rather than hardening.
 */
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  CIVIL_DATE_PATTERN,
  TRANSACTION_TAX_DIRECTIONS,
  type TaxReportForm,
  type TransactionTaxDirection,
  type TransactionTaxLineInput,
} from '@watchdog-bms/contracts';

const TAX_REPORT_FORMS: TaxReportForm[] = ['PP30', 'PP36', 'TAX_LEDGER', 'CUSTOMS_SUPPORT'];

/** `YYYY-MM`, the shape every reader of a tax period key already tests for before parsing it. */
const PERIOD_KEY_PATTERN = /^\d{4}-\d{2}$/;

export class CreateTaxProfileFromTemplateDto {
  @Matches(CIVIL_DATE_PATTERN) @IsOptional() effectiveFrom?: string;
}

export class VerifyTradeTaxEvidenceDto {
  // The handler defaults an absent value to VERIFIED, so the only job here is to stop a third word
  // arriving and being treated as a rejection by whatever compares it downstream.
  @IsIn(['VERIFIED', 'REJECTED']) @IsOptional() status?: 'VERIFIED' | 'REJECTED';
}

export class GenerateTaxReconciliationDto {
  @IsIn(TAX_REPORT_FORMS) formType!: TaxReportForm;
  // A bad period key used to reach the repository, which tests this same shape and quietly
  // substitutes null when it fails — a reconciliation over "no period" rather than an error.
  @Matches(PERIOD_KEY_PATTERN) periodKey!: string;
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
}

export class ReviewTaxReconciliationDto {
  @IsString() @IsOptional() @MaxLength(1000) note?: string;
}

export class ResolveTransactionTaxPreviewDto {
  /**
   * The tax line being priced. Left as a bounded object rather than a nested DTO: its shape is
   * `TransactionTaxLineInput`, which the tax resolver already validates field by field, and
   * restating it here would mean two definitions of a line that must agree forever.
   */
  // Typed for the handler that forwards it; `@IsObject()` is what the pipe enforces at runtime,
  // which is the part that was missing — a string or an array used to reach the resolver.
  @IsObject() input!: TransactionTaxLineInput;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(64) profileId?: string;
  @IsIn(TRANSACTION_TAX_DIRECTIONS) @IsOptional() direction?: TransactionTaxDirection;
  @IsString() @IsOptional() @MaxLength(64) sourceModule?: string;
}
