import { Allow, ArrayMinSize, ArrayMaxSize, IsArray, IsIn, IsBoolean, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { BILLING_PAID_TIERS } from '@watchdog-bms/contracts';

// Concrete runtime DTOs for the global whitelist. Existing command parsers still own
// conditional fields, policy/capacity semantics, versions, consent and provider invariants.
export class BillingEmptyDto {}

export class BillingVersionDto {
  @IsInt() @Min(0) expectedVersion!: number;
}
export class BillingConfigurationCheckDto extends BillingVersionDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!:string;
}
export class BillingScanScheduleDto extends BillingVersionDto {
  @IsBoolean() enabled!:boolean;
  @IsInt() @Min(1) intervalHours!:number;
  @IsInt() @Min(1) initialLookbackHours!:number;
  @IsString() @MinLength(1) @MaxLength(500) reason!:string;
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
  @IsOptional() @IsString() @MaxLength(40) effectiveAt?: string | null;
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
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) findingSourceHash?: string;
}
export class BillingSubmitDto extends BillingVersionDto {
  @IsUUID() previewId!: string;
  @IsString() @MinLength(1) @MaxLength(120) previewHash!: string;
}
export class BillingSupportOutcomeDto extends BillingVersionDto {
  @IsString() @MinLength(1) @MaxLength(40) kind!: string;
  @IsString() @MinLength(1) @MaxLength(1000) note!: string;
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
  /** Omitted on a sales-deal quote: `dealId` names the offer, and its base tier is the snapshot's. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) offerKey?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(10) interval?: string;
  /** R-A1: optional and ignored — the quote derives its recipient. Kept so cached clients (which may send '') still pass. */
  @IsOptional() @IsString() @MaxLength(320) billingEmail?: string;
  @Allow() capacity?: unknown;
  @IsOptional() @IsIn(['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW']) purchaseMode?: string;
  @IsOptional() @IsIn(['FULL_PACKAGE']) purchaseIntent?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) dealId?: string;
}
export class BillingCheckoutDto {
  @IsUUID() quoteId!: string;
  @IsString() @MinLength(1) @MaxLength(120) consentRevision!: string;
  @IsBoolean() accepted!: boolean;
  @IsString() @MaxLength(20) channel!: string;
}
/** Absent `recipientProofId` = the original "use my verified account email" review. */
export class BillingRecipientPreviewDto {
  @IsOptional() @IsUUID() recipientProofId?: string;
}
export class BillingRecipientOtpRequestDto {
  @IsString() @MaxLength(320) email!: string;
  @IsUUID('4') requestKey!: string;
}
export class BillingRecipientOtpConfirmDto {
  @IsUUID() challengeId!: string;
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
export class BillingPortalDto {
  @IsString() @MaxLength(120) action!: string;
}
export class BillingDocumentDto {
  @IsString() @MaxLength(40) kind!: string;
  @IsOptional() @IsString() @MaxLength(124) creditNoteId?: string;
}

// Purchase without setup PR E (admin tools, DQ7/DQ10).
export class BillingRecipientAdminDto extends BillingEventPreviewDto {
  @IsString() @MaxLength(254) newEmail!: string;
  @IsOptional() @IsString() @MaxLength(64) supportRequestId?: string;
}
export class BillingDocumentResendAdminDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(64) supportRequestId?: string;
}

export class BillingPlanAdjustmentDto extends BillingEventPreviewDto {
  @IsIn(['GRANT_OVERRIDE','REVOKE_OVERRIDE','GRANT_FREE_DAYS','CHANGE_COLLECTION']) type!: string;
  @IsOptional() @IsIn(['PAUSE','RESUME']) collectionAction?: string;
  @IsOptional() @IsISO8601({strict:true,strictSeparator:true}) resumesAt?: string;
  @IsOptional() @IsInt() @Min(1) days?: number;
  @IsOptional() @IsIn([...BILLING_PAID_TIERS]) tierKey?: string;
  @IsOptional() @IsInt() @Min(1) branchLimit?: number;
  @IsOptional() @IsInt() @Min(1) employeeLimit?: number;
  @IsOptional() @IsISO8601({strict:true,strictSeparator:true}) expiresAt?: string;
  @IsOptional() @IsUUID() overrideId?: string;
}
export class BillingReceiptAdjustmentDto extends BillingEventPreviewDto {
  @IsIn(['GRANT_RECEIPTS','REVOKE_RECEIPTS']) type!: string;
  @IsOptional() @IsInt() @Min(1) units?: number;
  @IsOptional() @IsISO8601({strict:true,strictSeparator:true}) expiresAt?: string;
  @IsOptional() @IsUUID() grantId?: string;
}
export class BillingRefundDto extends BillingEventPreviewDto {
  @IsInt() @Min(1) amountSatang!: number;
  @IsString() @MaxLength(500) memo!: string;
  @IsBoolean() notifyCustomer!: boolean;
  @IsOptional() @IsBoolean() endPackage?: boolean;
}
export class BillingEndPackageDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}
export class BillingBatchDto {
  // Existing reconcileBatchInput validates every nested field and rejects unknown keys.
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(25) companies!: unknown[];
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class BillingTimelineExportDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(180) cursor?: string;
}
