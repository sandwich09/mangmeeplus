import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { CreateRevenueCategoryInput, RevenueCategoryStatus, UpdateRevenueCategoryInput } from '@watchdog-bms/contracts';

// Audit H-23: a @Body typed with a bare contract type reaches the ValidationPipe as `Object` and
// is silently skipped — only a *Dto class carries whitelist/forbidNonWhitelisted metadata
// (body-validation-coverage.spec.ts). `implements` keeps these from drifting off the contract.

const REVENUE_CATEGORY_STATUSES: readonly RevenueCategoryStatus[] = ['ACTIVE', 'ARCHIVED'];

export class CreateRevenueCategoryDto implements CreateRevenueCategoryInput {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) accountHintKey!: string;
  /** Stable external output Tax Code (e.g. "O7"), never a definition id. */
  @IsString() @IsOptional() @MaxLength(16) defaultOutputTaxCode?: string;
  @IsInt() @Min(0) @IsOptional() sortOrder?: number;
}

export class UpdateRevenueCategoryDto implements UpdateRevenueCategoryInput {
  @IsString() @IsNotEmpty() @MaxLength(120) @IsOptional() name?: string;
  @IsString() @IsNotEmpty() @MaxLength(80) @IsOptional() accountHintKey?: string;
  /** @IsOptional also passes an explicit null — "clear the suggestion" stays expressible. */
  @IsString() @MaxLength(16) @IsOptional() defaultOutputTaxCode?: string | null;
  @IsInt() @Min(0) @IsOptional() sortOrder?: number;
  @IsIn(REVENUE_CATEGORY_STATUSES) @IsOptional() status?: RevenueCategoryStatus;
}
