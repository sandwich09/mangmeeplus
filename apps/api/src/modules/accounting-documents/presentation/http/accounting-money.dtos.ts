import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty,
  IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { TRANSACTION_TAX_CONTEXTS } from '@watchdog-bms/contracts';
import type {
  AccountingDocumentType, AccountingOutputTaxCode, AccountingPaymentDirection,
  AccountingPaymentMethod, AccountingVatMode, TransactionTaxContext,
} from '@watchdog-bms/contracts';
import type { CreateDocumentInput, CreatePaymentInput } from '../../domain/models/accounting.model';
import {
  ACCOUNTING_MONEY_PATTERN,
  ACCOUNTING_RATE_PATTERN,
  PAYMENT_IDEMPOTENCY_KEY_PATTERN,
  POSITIVE_ACCOUNTING_MONEY_PATTERN,
  POSITIVE_ACCOUNTING_QUANTITY_PATTERN,
} from '../../domain/logic/accounting-money-validation.logic';
import {
  ACCOUNTING_CREDIT_NOTE_REASON_CODES,
  ACCOUNTING_DEBIT_NOTE_REASON_CODES,
  type AccountingAdjustmentReasonCode,
} from '@watchdog-bms/contracts';

const DOCUMENT_TYPES: AccountingDocumentType[] = ['QUOTATION', 'INVOICE', 'BILLING_NOTE', 'RECEIPT', 'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'];
const VAT_MODES: AccountingVatMode[] = ['NO_VAT', 'VAT_INCLUDED', 'VAT_EXCLUDED', 'EXEMPT'];
const OUTPUT_TAX_CODES: AccountingOutputTaxCode[] = ['O7', 'OX', 'O0'];
const PAYMENT_DIRECTIONS: AccountingPaymentDirection[] = ['RECEIVED', 'PAID'];
const PAYMENT_METHODS: AccountingPaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'];
const ADJUSTMENT_REASON_CODES: AccountingAdjustmentReasonCode[] = [
  ...ACCOUNTING_CREDIT_NOTE_REASON_CODES,
  ...ACCOUNTING_DEBIT_NOTE_REASON_CODES,
];

export class AccountingDocumentLineDto {
  @IsInt() @Min(1) @Max(10_000) lineNumber!: number;
  @IsString() @IsOptional() @MaxLength(64) productId?: string;
  @IsString() @IsOptional() @MaxLength(160) skuSnapshot?: string;
  @IsString() @IsNotEmpty() @MaxLength(500) description!: string;
  @IsString() @IsOptional() @MaxLength(80) unitName?: string;
  @Matches(POSITIVE_ACCOUNTING_QUANTITY_PATTERN) quantity!: string;
  @Matches(POSITIVE_ACCOUNTING_MONEY_PATTERN) unitPrice!: string;
  @Matches(ACCOUNTING_MONEY_PATTERN) @IsOptional() discountAmount?: string;
  @Matches(ACCOUNTING_RATE_PATTERN) @IsOptional() vatRate?: string;
  @Matches(ACCOUNTING_RATE_PATTERN) @IsOptional() whtRate?: string;
  @IsString() @IsOptional() @MaxLength(80) taxCategory?: string;
  @IsString() @IsOptional() @MaxLength(80) revenueCategory?: string;
  @IsString() @IsOptional() @MaxLength(64) revenueCategoryId?: string;
  @IsString() @IsOptional() @MaxLength(64) taxCodeDefinitionId?: string;
  @IsString() @IsOptional() @MaxLength(80) externalTaxCode?: string;
  @IsIn(TRANSACTION_TAX_CONTEXTS) @IsOptional() transactionContext?: TransactionTaxContext;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @IsOptional() evidenceRefs?: string[];
}

export class CreateAccountingDocumentDto implements Omit<CreateDocumentInput, 'companyId' | 'createdByUserId' | 'payloadFingerprint'> {
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
  @IsIn(DOCUMENT_TYPES) documentType!: AccountingDocumentType;
  @IsDateString({ strict: true }) documentDate!: string;
  @IsDateString({ strict: true }) @IsOptional() dueDate?: string;
  @IsString() @IsOptional() @MaxLength(64) counterpartyId?: string;
  @IsString() @IsOptional() @MaxLength(64) sourceDocumentId?: string;
  @IsString() @IsOptional() @MaxLength(80) sourceDocumentType?: string;
  @IsString() @IsOptional() @MaxLength(64) convertedFromDocumentId?: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/) @IsOptional() idempotencyKey?: string;
  @IsIn(['THB']) @IsOptional() currency?: string;
  @IsIn(VAT_MODES) vatMode!: AccountingVatMode;
  @IsIn(OUTPUT_TAX_CODES) @IsOptional() outputTaxCode?: AccountingOutputTaxCode;
  @IsString() @IsOptional() @MaxLength(1_000) note?: string;
  @IsString() @IsOptional() @MaxLength(1_000) internalMemo?: string;
  @IsIn(ADJUSTMENT_REASON_CODES) @IsOptional() adjustmentReasonCode?: AccountingAdjustmentReasonCode;
  @IsString() @IsOptional() @MaxLength(500) adjustmentReasonText?: string;
  @IsArray() @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => AccountingDocumentLineDto)
  lines!: AccountingDocumentLineDto[];
}

export class UpdateAccountingDocumentDto {
  @IsDateString({ strict: true }) @Matches(/T/) expectedUpdatedAt!: string;
  @IsString() @IsOptional() @MaxLength(64) branchId?: string | null;
  @IsDateString({ strict: true }) @IsOptional() documentDate?: string;
  @IsDateString({ strict: true }) @IsOptional() dueDate?: string | null;
  @IsString() @IsOptional() @MaxLength(64) counterpartyId?: string | null;
  @IsIn(['THB']) @IsOptional() currency?: string;
  @IsIn(VAT_MODES) @IsOptional() vatMode?: AccountingVatMode;
  @IsIn(OUTPUT_TAX_CODES) @IsOptional() outputTaxCode?: AccountingOutputTaxCode | null;
  @IsString() @IsOptional() @MaxLength(1_000) note?: string | null;
  @IsString() @IsOptional() @MaxLength(1_000) internalMemo?: string | null;
  @IsIn(ADJUSTMENT_REASON_CODES) @IsOptional() adjustmentReasonCode?: AccountingAdjustmentReasonCode | null;
  @IsString() @IsOptional() @MaxLength(500) adjustmentReasonText?: string | null;
  @IsArray() @ArrayMaxSize(200) @IsOptional()
  @ValidateNested({ each: true }) @Type(() => AccountingDocumentLineDto)
  lines?: AccountingDocumentLineDto[];
}

export class CreateAccountingPaymentDto implements Omit<CreatePaymentInput, 'companyId' | 'createdByUserId' | 'payloadFingerprint'> {
  @IsString() @IsOptional() @Matches(PAYMENT_IDEMPOTENCY_KEY_PATTERN) idempotencyKey?: string;
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
  @IsIn(PAYMENT_DIRECTIONS) direction!: AccountingPaymentDirection;
  @IsString() @IsOptional() @MaxLength(64) counterpartyId?: string;
  @IsIn(PAYMENT_METHODS) method!: AccountingPaymentMethod;
  @Matches(POSITIVE_ACCOUNTING_MONEY_PATTERN) amount!: string;
  // Shape only; that it requires RECEIVED plus an allocation target is a business rule the money
  // validation owns, alongside the cash + withheld <= outstanding invariant.
  @Matches(ACCOUNTING_MONEY_PATTERN) @IsOptional() whtAmount?: string;
  @IsIn(['THB']) @IsOptional() currency?: string;
  @IsDateString({ strict: true }) paidAt!: string;
  @IsString() @IsOptional() @MaxLength(160) bankAccountRef?: string;
  @IsString() @IsOptional() @MaxLength(160) externalReference?: string;
  @IsString() @IsOptional() @MaxLength(1_000) note?: string;
  @IsString() @IsOptional() @MaxLength(64) allocateToDocumentId?: string;
}

export class RecordSimpleIncomeDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/) idempotencyKey!: string;
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
  @IsDateString({ strict: true }) documentDate!: string;
  @IsString() @IsOptional() @MaxLength(64) counterpartyId?: string;
  @IsIn(VAT_MODES) vatMode!: AccountingVatMode;
  @IsIn(PAYMENT_METHODS) paymentMethod!: AccountingPaymentMethod;
  @IsString() @IsOptional() @MaxLength(1_000) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => AccountingDocumentLineDto)
  lines!: AccountingDocumentLineDto[];
}
