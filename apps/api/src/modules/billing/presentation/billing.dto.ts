import { Allow, IsBoolean, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

// Concrete runtime DTOs for the global whitelist. Existing command parsers still own
// conditional fields, policy/capacity semantics, versions, consent and provider invariants.
export class BillingVersionDto {
  @IsInt() @Min(0) expectedVersion!: number;
}
export class BillingProviderScanDto {
  @IsISO8601({strict:true,strictSeparator:true}) @MaxLength(40) windowStart!: string;
  @IsISO8601({strict:true,strictSeparator:true}) @MaxLength(40) windowEnd!: string;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}
export class BillingEventPreviewDto {
  @IsString() @MinLength(1) @MaxLength(64) sourceHash!: string;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}
export class BillingScopePreviewDto {
  @IsString() @MaxLength(120) type!: string;
  @IsString() @MaxLength(128) userId!: string;
  @IsString() @MaxLength(128) companyId!: string;
  @ValidateIf((_object, value) => value !== null) @IsString() @MaxLength(40) expiresAt!: string | null;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}
export class BillingCommandDto extends BillingVersionDto {
  @IsOptional() @IsString() @MaxLength(120) previewHash?: string;
  @IsOptional() @IsBoolean() accepted?: boolean;
}
export class BillingReauthenticateDto {
  @IsString() @MinLength(1) @MaxLength(1024) password!: string;
}
export class BillingConfigurationDto extends BillingVersionDto {
  @IsString() @MaxLength(120) type!: string;
  @IsObject() policy!: object;
  @IsObject() gates!: object;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
  @IsOptional() @IsUUID() draftId?: string;
  @IsOptional() @IsInt() @Min(0) draftVersion?: number;
}
export class BillingCloseDto extends BillingVersionDto {
  @IsObject() gates!: object;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}
export class BillingRepairPreviewDto extends BillingVersionDto {
  @IsString() @MaxLength(120) type!: string;
  @IsString() @MaxLength(128) companyId!: string;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(128) referenceId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) invoiceSourceHash?: string;
}
export class BillingSubmitDto extends BillingVersionDto {
  @IsUUID() previewId!: string;
  @IsString() @MinLength(1) @MaxLength(120) previewHash!: string;
}
export class BillingIssueDto extends BillingVersionDto {
  @IsString() @MaxLength(40) state!: string;
  @IsString() @MinLength(1) @MaxLength(1000) note!: string;
  @ValidateIf((_object, value) => value !== null) @IsString() @MaxLength(128) assigneeUserId!: string | null;
  @IsOptional() @IsString() @MaxLength(128) backupUserId?: string | null;
  @IsOptional() @IsString() @MaxLength(20) priority?: string;
  @IsOptional() @IsString() @MaxLength(40) followUpAt?: string | null;
}
export class BillingCollectionPreviewDto {
  @IsString() @MaxLength(120) action!: string;
  @IsOptional() @IsString() @MaxLength(120) offerKey?: string;
  @IsOptional() @IsString() @MaxLength(120) interval?: string;
  @Allow() capacity?: unknown;
}
export class BillingCapacityRepairDto extends BillingVersionDto {
  @IsBoolean() accepted!: boolean;
  @Allow() selection!: unknown;
}
export class BillingQuoteDto {
  @IsString() @MinLength(1) @MaxLength(40) offerKey!: string;
  @IsString() @MinLength(1) @MaxLength(10) interval!: string;
  @IsString() @MinLength(1) @MaxLength(320) billingEmail!: string;
  @Allow() capacity?: unknown;
}
export class BillingCheckoutDto {
  @IsUUID() quoteId!: string;
  @IsString() @MinLength(1) @MaxLength(120) consentRevision!: string;
  @IsBoolean() accepted!: boolean;
  @IsString() @MaxLength(20) channel!: string;
}
export class BillingPortalDto {
  @IsString() @MaxLength(120) action!: string;
}
export class BillingDocumentDto {
  @IsString() @MaxLength(40) kind!: string;
}
