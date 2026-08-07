// HTTP-boundary validation for the procurement/AP bodies (G1). Every handler in
// this module used to take `@Body() body: any`, so the global ValidationPipe had
// no metatype to work with and forwarded whatever JSON arrived — which is how a
// supplier created with supplierType "COMPANY" reached Prisma and answered 500.
//
// The field list of each class is the UNION of
//   (a) the use-case `execute` input type, and
//   (b) what real callers send (apps/web feature api modules, e2e/*.spec.ts).
// It is never narrower than either: under `whitelist + forbidNonWhitelisted` an
// omitted field is a 400 for the caller, and a field the use case reads but the
// DTO omits would be silently stripped — a behaviour change that no test sees.
//
// Fields the use cases type as `Date` are converted here with @Type(() => Date)
// instead of being left as strings. That is not cosmetic: CreateVendorBillUseCase
// calls `dto.billDate.toISOString()` whenever a line carries a tax code, which
// threw TypeError (→ 500) on the JSON string the boundary actually delivered.
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDate, IsIn, IsInt, IsNotEmpty,
  IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import * as contracts from '@watchdog-bms/contracts';
import type {
  CreateSupplierBankAccountDto as CreateSupplierBankAccountContract,
  CreateSupplierDto as CreateSupplierContract,
  InputVatClaimStatus, PaymentMethod, ProcurementVatMode, PurchaseLineType, PurchaseMatchingMode,
  SupplierStatus, SupplierType, TransactionTaxContext,
  UpdateSupplierDto as UpdateSupplierContract,
} from '@watchdog-bms/contracts';
import {
  DECIMAL_RATE_PATTERN, DECIMAL_STRING_PATTERN,
} from '../../../../common/pipes/decimal-string.patterns';
import { enumValues } from '../../../../common/pipes/enum-values';

// Read through enumValues so a stale contracts build fails the boot loudly instead
// of turning every @IsIn into "must be one of the following values: undefined".
const INPUT_VAT_CLAIM_STATUSES = enumValues('INPUT_VAT_CLAIM_STATUSES', contracts.INPUT_VAT_CLAIM_STATUSES);
const PAYMENT_METHODS = enumValues('PAYMENT_METHODS', contracts.PAYMENT_METHODS);
const PROCUREMENT_VAT_MODES = enumValues('PROCUREMENT_VAT_MODES', contracts.PROCUREMENT_VAT_MODES);
const PURCHASE_LINE_TYPES = enumValues('PURCHASE_LINE_TYPES', contracts.PURCHASE_LINE_TYPES);
const PURCHASE_MATCHING_MODES = enumValues('PURCHASE_MATCHING_MODES', contracts.PURCHASE_MATCHING_MODES);
const SUPPLIER_STATUSES = enumValues('SUPPLIER_STATUSES', contracts.SUPPLIER_STATUSES);
const SUPPLIER_TYPES = enumValues('SUPPLIER_TYPES', contracts.SUPPLIER_TYPES);
const TRANSACTION_TAX_CONTEXTS = enumValues('TRANSACTION_TAX_CONTEXTS', contracts.TRANSACTION_TAX_CONTEXTS);

const CURRENCY = /^[A-Z]{3}$/;
const TAX_EVIDENCE_DECISIONS = ['VERIFIED', 'REJECTED'] as const;

// ---- Supplier ----

export class CreateSupplierDto implements CreateSupplierContract {
  @IsString() @IsOptional() @MaxLength(64) supplierCode?: string;
  @IsIn(SUPPLIER_TYPES) @IsOptional() supplierType?: SupplierType;
  @IsString() @IsNotEmpty() @MaxLength(300) displayName!: string;
  @IsString() @IsOptional() @MaxLength(300) legalName?: string;
  @IsString() @IsOptional() @MaxLength(20) taxId?: string;
  @IsString() @IsOptional() @MaxLength(10) branchCode?: string;
  @IsBoolean() @IsOptional() vatRegistered?: boolean;
  @IsIn(PROCUREMENT_VAT_MODES) @IsOptional() defaultVatMode?: ProcurementVatMode;
  @IsIn(INPUT_VAT_CLAIM_STATUSES) @IsOptional() defaultInputVatClaimStatus?: InputVatClaimStatus;
  @IsString() @IsOptional() @MaxLength(40) defaultWhtCategoryCode?: string;
  @IsInt() @Min(0) @Max(3_650) @IsOptional() defaultPaymentTermsDays?: number;
  @IsString() @IsOptional() @MaxLength(80) defaultExpenseCategoryKey?: string;
  @IsString() @IsOptional() @MaxLength(80) defaultAccountHint?: string;
  @Matches(CURRENCY) @IsOptional() defaultCurrency?: string;
  @IsString() @IsOptional() @MaxLength(160) contactName?: string;
  @IsString() @IsOptional() @MaxLength(320) email?: string;
  @IsString() @IsOptional() @MaxLength(40) phone?: string;
  @IsObject() @IsOptional() addressJson?: Record<string, unknown>;
}

export class UpdateSupplierDto implements UpdateSupplierContract {
  @IsString() @IsOptional() @MaxLength(64) supplierCode?: string;
  @IsIn(SUPPLIER_TYPES) @IsOptional() supplierType?: SupplierType;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(300) displayName?: string;
  @IsString() @IsOptional() @MaxLength(300) legalName?: string;
  @IsString() @IsOptional() @MaxLength(20) taxId?: string;
  @IsString() @IsOptional() @MaxLength(10) branchCode?: string;
  @IsBoolean() @IsOptional() vatRegistered?: boolean;
  @IsIn(PROCUREMENT_VAT_MODES) @IsOptional() defaultVatMode?: ProcurementVatMode;
  @IsIn(INPUT_VAT_CLAIM_STATUSES) @IsOptional() defaultInputVatClaimStatus?: InputVatClaimStatus;
  @IsString() @IsOptional() @MaxLength(40) defaultWhtCategoryCode?: string;
  @IsInt() @Min(0) @Max(3_650) @IsOptional() defaultPaymentTermsDays?: number;
  @IsString() @IsOptional() @MaxLength(80) defaultExpenseCategoryKey?: string;
  @IsString() @IsOptional() @MaxLength(80) defaultAccountHint?: string;
  @Matches(CURRENCY) @IsOptional() defaultCurrency?: string;
  @IsString() @IsOptional() @MaxLength(160) contactName?: string;
  @IsString() @IsOptional() @MaxLength(320) email?: string;
  @IsString() @IsOptional() @MaxLength(40) phone?: string;
  @IsObject() @IsOptional() addressJson?: Record<string, unknown>;
  @IsIn(SUPPLIER_STATUSES) @IsOptional() status?: SupplierStatus;
  @IsString() @IsOptional() @MaxLength(500) onHoldReason?: string;
}

export class CreateSupplierBankAccountDto implements CreateSupplierBankAccountContract {
  @IsString() @IsNotEmpty() @MaxLength(160) bankName!: string;
  @IsString() @IsOptional() @MaxLength(20) bankCode?: string;
  @IsString() @IsNotEmpty() @MaxLength(300) accountName!: string;
  // Storing only the last 4 is the whole point of the column — reject a full number.
  @Matches(/^\d{4}$/) accountNumberLast4!: string;
  @IsString() @IsOptional() @MaxLength(160) branchName?: string;
  @IsBoolean() @IsOptional() isDefault?: boolean;
}

// ---- Shared workflow bodies ----

/** approve/reject on purchase requests, purchase orders, and vendor bills. */
export class ApprovalNoteDto {
  @IsString() @IsOptional() @MaxLength(1_000) note?: string;
}

/** Rejecting a vendor bill: the use case types the note as required and apps/web only sends non-empty. */
export class RequiredNoteDto {
  @IsString() @IsNotEmpty() @MaxLength(1_000) note!: string;
}

/** cancel/close on purchase orders and purchase requests — no caller today, and the use cases accept absence. */
export class ReasonDto {
  @IsString() @IsOptional() @MaxLength(500) reason?: string;
}

/** Void bodies. Every void use case types the reason as required and apps/web guards on non-empty. */
export class RequiredReasonDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

// ---- Purchase request ----

export class CreatePurchaseRequestLineDto {
  @IsInt() @Min(1) @Max(10_000) lineNumber!: number;
  @IsIn(PURCHASE_LINE_TYPES) @IsOptional() lineType?: PurchaseLineType;
  @IsString() @IsOptional() @MaxLength(64) productId?: string;
  @IsString() @IsNotEmpty() @MaxLength(500) description!: string;
  @IsString() @IsOptional() @MaxLength(80) unitName?: string;
  @Matches(DECIMAL_STRING_PATTERN) requestedQuantity!: string;
  @Matches(DECIMAL_STRING_PATTERN) estimatedUnitPrice!: string;
  @Matches(DECIMAL_STRING_PATTERN) discountAmount!: string;
  @IsIn(PROCUREMENT_VAT_MODES) vatMode!: ProcurementVatMode;
  @Matches(DECIMAL_RATE_PATTERN) @IsOptional() vatRate?: string;
  @Matches(DECIMAL_STRING_PATTERN) vatAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) lineSubtotalAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) lineTotalAmount!: string;
  @IsString() @IsOptional() @MaxLength(80) accountHint?: string;
  @IsString() @IsOptional() @MaxLength(64) inventoryLocationId?: string;
}

export class CreatePurchaseRequestDto {
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
  @Type(() => Date) @IsDate() @IsOptional() neededByDate?: Date;
  @IsString() @IsOptional() @MaxLength(64) supplierId?: string;
  @IsString() @IsOptional() @MaxLength(500) reason?: string;
  @IsString() @IsOptional() @MaxLength(80) budgetCode?: string;
  @Matches(CURRENCY) @IsOptional() currency?: string;
  @Matches(DECIMAL_STRING_PATTERN) subtotalAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) discountAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) taxableAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) vatAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() whtEstimateAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) grandTotalAmount!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => CreatePurchaseRequestLineDto)
  lines!: CreatePurchaseRequestLineDto[];
}

// ---- Purchase order ----

export class CreatePurchaseOrderLineDto {
  @IsInt() @Min(1) @Max(10_000) lineNumber!: number;
  @IsIn(PURCHASE_LINE_TYPES) @IsOptional() lineType?: PurchaseLineType;
  @IsString() @IsOptional() @MaxLength(64) productId?: string;
  @IsString() @IsNotEmpty() @MaxLength(500) description!: string;
  @IsString() @IsOptional() @MaxLength(80) unitName?: string;
  @Matches(DECIMAL_STRING_PATTERN) orderedQuantity!: string;
  @Matches(DECIMAL_STRING_PATTERN) unitPrice!: string;
  @Matches(DECIMAL_STRING_PATTERN) discountAmount!: string;
  @IsIn(PROCUREMENT_VAT_MODES) vatMode!: ProcurementVatMode;
  @Matches(DECIMAL_RATE_PATTERN) @IsOptional() vatRate?: string;
  @Matches(DECIMAL_STRING_PATTERN) vatAmount!: string;
  @IsString() @IsOptional() @MaxLength(40) whtCategoryCode?: string;
  @Matches(DECIMAL_RATE_PATTERN) @IsOptional() whtRate?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() whtEstimateAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) lineSubtotalAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) lineTotalAmount!: string;
  @IsString() @IsOptional() @MaxLength(80) accountHint?: string;
  @IsString() @IsOptional() @MaxLength(64) inventoryLocationId?: string;
  @IsString() @IsOptional() @MaxLength(64) sourcePurchaseRequestLineId?: string;
}

export class CreatePurchaseOrderDto {
  @IsString() @IsNotEmpty() @MaxLength(64) supplierId!: string;
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
  @Type(() => Date) @IsDate() orderDate!: Date;
  @Type(() => Date) @IsDate() @IsOptional() expectedDeliveryDate?: Date;
  @IsInt() @Min(0) @Max(3_650) @IsOptional() paymentTermsDays?: number;
  @Matches(CURRENCY) @IsOptional() currency?: string;
  @IsIn(PURCHASE_MATCHING_MODES) @IsOptional() matchingMode?: PurchaseMatchingMode;
  @IsString() @IsOptional() @MaxLength(64) sourcePurchaseRequestId?: string;
  @Matches(DECIMAL_STRING_PATTERN) subtotalAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) discountAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) taxableAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) vatAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() whtEstimateAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) grandTotalAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) outstandingAmount!: string;
  @IsObject() @IsOptional() supplierSnapshotJson?: Record<string, unknown>;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => CreatePurchaseOrderLineDto)
  lines!: CreatePurchaseOrderLineDto[];
}

// ---- Goods receipt ----

export class CreateGoodsReceiptLineDto {
  @IsString() @IsNotEmpty() @MaxLength(64) purchaseOrderLineId!: string;
  @IsInt() @Min(1) @Max(10_000) lineNumber!: number;
  @IsIn(PURCHASE_LINE_TYPES) @IsOptional() lineType?: PurchaseLineType;
  @IsString() @IsOptional() @MaxLength(64) productId?: string;
  @IsString() @IsNotEmpty() @MaxLength(500) description!: string;
  @IsString() @IsOptional() @MaxLength(64) inventoryLocationId?: string;
  @Matches(DECIMAL_STRING_PATTERN) orderedQuantity!: string;
  @Matches(DECIMAL_STRING_PATTERN) previouslyReceivedQuantity!: string;
  @Matches(DECIMAL_STRING_PATTERN) receivedQuantity!: string;
  @Matches(DECIMAL_STRING_PATTERN) acceptedQuantity!: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() rejectedQuantity?: string;
  @IsString() @IsOptional() @MaxLength(80) unitName?: string;
  @IsString() @IsOptional() @MaxLength(500) varianceReason?: string;
}

export class CreateGoodsReceiptDto {
  @IsString() @IsNotEmpty() @MaxLength(64) purchaseOrderId!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) supplierId!: string;
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
  @Type(() => Date) @IsDate() receivedAt!: Date;
  @IsString() @IsOptional() @MaxLength(1_000) note?: string;
  @IsObject() @IsOptional() supplierSnapshotJson?: Record<string, unknown>;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => CreateGoodsReceiptLineDto)
  lines!: CreateGoodsReceiptLineDto[];
}

// ---- Vendor bill ----

export class CreateVendorBillLineDto {
  @IsInt() @Min(1) @Max(10_000) lineNumber!: number;
  @IsIn(PURCHASE_LINE_TYPES) @IsOptional() lineType?: PurchaseLineType;
  @IsString() @IsOptional() @MaxLength(64) productId?: string;
  @IsString() @IsNotEmpty() @MaxLength(500) description!: string;
  @IsString() @IsOptional() @MaxLength(80) unitName?: string;
  @Matches(DECIMAL_STRING_PATTERN) quantity!: string;
  @Matches(DECIMAL_STRING_PATTERN) unitPrice!: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() discountAmount?: string;
  @IsIn(PROCUREMENT_VAT_MODES) @IsOptional() vatMode?: ProcurementVatMode;
  @Matches(DECIMAL_RATE_PATTERN) @IsOptional() vatRate?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() vatAmount?: string;
  @IsIn(INPUT_VAT_CLAIM_STATUSES) @IsOptional() inputVatClaimStatus?: InputVatClaimStatus;
  @IsString() @IsOptional() @MaxLength(40) whtCategoryCode?: string;
  @Matches(DECIMAL_RATE_PATTERN) @IsOptional() whtRate?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() whtAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() lineSubtotalAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() lineTotalAmount?: string;
  @IsString() @IsOptional() @MaxLength(80) accountHint?: string;
  @IsBoolean() @IsOptional() assetCandidate?: boolean;
  @IsString() @IsOptional() @MaxLength(64) purchaseOrderLineId?: string;
  @IsString() @IsOptional() @MaxLength(64) taxCodeDefinitionId?: string;
  @IsString() @IsOptional() @MaxLength(80) externalTaxCode?: string;
  // apps/web sends this on every line it creates; dropping it would 400 the page.
  @IsIn(TRANSACTION_TAX_CONTEXTS) @IsOptional() transactionContext?: TransactionTaxContext;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @IsOptional() evidenceRefs?: string[];
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() authoritativeCustomsValue?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() authoritativeDutyAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() authoritativeExciseAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() authoritativeOtherTaxAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() authoritativeImportVatAmount?: string;
}

export class CreateVendorBillDto {
  @IsString() @IsNotEmpty() @MaxLength(64) supplierId!: string;
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
  @IsString() @IsOptional() @MaxLength(64) purchaseOrderId?: string;
  @IsString() @IsOptional() @MaxLength(64) goodsReceiptId?: string;
  @Type(() => Date) @IsDate() billDate!: Date;
  @Type(() => Date) @IsDate() dueDate!: Date;
  @Type(() => Date) @IsDate() @IsOptional() receivedDate?: Date;
  @IsInt() @Min(0) @Max(3_650) @IsOptional() paymentTermsDays?: number;
  @Matches(CURRENCY) @IsOptional() currency?: string;
  @IsIn(PROCUREMENT_VAT_MODES) @IsOptional() vatMode?: ProcurementVatMode;
  @IsString() @IsOptional() @MaxLength(80) supplierDocumentNumber?: string;
  @IsString() @IsOptional() @MaxLength(80) taxInvoiceNumber?: string;
  @Type(() => Date) @IsDate() @IsOptional() taxInvoiceDate?: Date;
  @IsString() @IsOptional() @MaxLength(40) whtCategoryCode?: string;
  @Matches(DECIMAL_RATE_PATTERN) @IsOptional() whtRate?: string;
  @IsBoolean() @IsOptional() pp36Candidate?: boolean;
  @IsString() @IsOptional() @MaxLength(64) attachmentId?: string;
  // Header totals are recomputed from the prepared lines before the insert; they
  // are accepted because every existing caller sends them.
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() subtotalAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() discountAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() taxableAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() vatAmount?: string;
  @IsIn(INPUT_VAT_CLAIM_STATUSES) @IsOptional() inputVatClaimStatus?: InputVatClaimStatus;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() whtAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() grandTotalAmount?: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() netPayableAmount?: string;
  @IsObject() @IsOptional() supplierSnapshotJson?: Record<string, unknown>;
  @IsIn(PURCHASE_MATCHING_MODES) @IsOptional() matchingMode?: PurchaseMatchingMode;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => CreateVendorBillLineDto)
  lines!: CreateVendorBillLineDto[];
}

export class UpdateVendorBillTaxEvidenceDto {
  @IsString() @IsNotEmpty() @MaxLength(80) taxInvoiceNumber!: string;
  @Type(() => Date) @IsDate() taxInvoiceDate!: Date;
  @IsString() @IsNotEmpty() @MaxLength(64) attachmentId!: string;
}

export class ReviewVendorBillTaxEvidenceDto {
  @IsIn(TAX_EVIDENCE_DECISIONS) status!: (typeof TAX_EVIDENCE_DECISIONS)[number];
}

export class MatchOverrideDto {
  @IsString() @IsNotEmpty() @MaxLength(500) overrideReason!: string;
}

export class UpdateApprovalPolicyDto {
  @IsBoolean() @IsOptional() allowSelfApproval?: boolean;
  // Explicit null disables the dual-approval threshold; apps/web sends it.
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() dualApprovalThresholdAmount?: string | null;
}

// ---- Supplier payment ----

export class SupplierPaymentAllocationDto {
  @IsString() @IsNotEmpty() @MaxLength(64) vendorBillId!: string;
  @Matches(DECIMAL_STRING_PATTERN) amount!: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() whtAmount?: string;
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @IsOptional() pp36PaymentEvidenceIds?: string[];
}

export class CreateSupplierPaymentDto {
  @IsString() @IsOptional() @MaxLength(128) idempotencyKey?: string;
  @IsString() @IsNotEmpty() @MaxLength(64) supplierId!: string;
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
  @Type(() => Date) @IsDate() paymentDate!: Date;
  @IsIn(PAYMENT_METHODS) method!: PaymentMethod;
  @Matches(CURRENCY) @IsOptional() currency?: string;
  @Matches(DECIMAL_STRING_PATTERN) grossAmount!: string;
  @Matches(DECIMAL_STRING_PATTERN) @IsOptional() whtAmount?: string;
  // Shape only. That these are REQUIRED once whtAmount > 0, and that the rate is 0–100, are
  // business rules the use-case owns — this edge may only ever get more permissive.
  @IsString() @IsOptional() @MaxLength(64) whtCategoryCode?: string;
  @Matches(DECIMAL_RATE_PATTERN) @IsOptional() whtRate?: string;
  @Matches(DECIMAL_STRING_PATTERN) netPaidAmount!: string;
  @IsString() @IsOptional() @MaxLength(160) bankAccountRef?: string;
  @IsString() @IsOptional() @MaxLength(64) supplierBankAccountId?: string;
  @IsString() @IsOptional() @MaxLength(160) externalReference?: string;
  @IsString() @IsOptional() @MaxLength(1_000) note?: string;
  @IsObject() @IsOptional() supplierSnapshotJson?: Record<string, unknown>;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => SupplierPaymentAllocationDto)
  allocations!: SupplierPaymentAllocationDto[];
}
