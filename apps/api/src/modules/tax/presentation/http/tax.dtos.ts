import { CreateUploadIntentDto, CompleteAttachmentUploadDto } from '../../../data-model-core/presentation/http/data-model-core.dtos';
// HTTP-boundary validation for the tax module bodies that carry legal evidence.
//
// The rest of this controller still takes loose inline body types, which the global ValidationPipe
// cannot check (no metatype to reflect on). That is tolerable for a recompute trigger; it is not
// tolerable for the 50 ทวิ link, whose body becomes the durable record of an externally issued RD
// document. Without a DTO class, `{ externalCertificateNumber: '' }` flipped a handoff to
// EXTERNAL_LINKED with empty evidence and no way to tell it from a real one.
//
// Field list is the UNION of the contract type and what apps/web actually sends — under
// `whitelist + forbidNonWhitelisted` an extra field is a 400 and a missing one is silently stripped.
import { Equals, IsInt, Min, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type {
  AnswerWhtPayerModeRequest, WhtPayerMode,
  CorrectWhtCertificateDto as CorrectWhtCertificateContract,
  LinkExternalWhtCertificateDto as LinkExternalWhtCertificateContract,
  RemoveExternalWhtCertificateDto as RemoveExternalWhtCertificateContract,
  PayeeSnapshot,
  PayerSnapshot,
  SetWhtHandoffPayeeAddressDto as SetWhtHandoffPayeeAddressContract,
  UpdateCompanyTaxSignatureDto as UpdateCompanyTaxSignatureContract,
  WhtCertificateCorrectionInput as WhtCertificateCorrectionInputContract,
  WhtFormType, WhtHandoffFormType,
} from '@watchdog-bms/contracts';
import { WHT_HANDOFF_PAYEE_ADDRESS_MAX } from '@watchdog-bms/contracts';
import { WHT_LINK_ISSUED_DATE, WHT_LINK_LIMITS } from '../../domain/logic/wht-link-evidence.logic';

export class WhtCertificateHandoffListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() sourcePaymentId?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() periodKey?: string;
  @IsOptional() @IsString() formType?: WhtHandoffFormType;
  @IsOptional() @IsIn(['newest', 'oldest']) order?: 'newest' | 'oldest';
}

export class ExportPnd53Dto {
  @IsOptional() @Matches(/^\d{5}$/) establishmentCode?: string;
  @IsOptional() @IsInt() @Min(0) sequence?: number;
  @IsIn(['PDF', 'XLSX']) exportFormat!: 'PDF' | 'XLSX';
}

export class ResolvePnd53IssueDto {
  @IsString() @IsNotEmpty() @MaxLength(500) note!: string;
}

export class MarkPnd53FiledDto {
  @IsOptional() @Matches(/^\d{5}$/) establishmentCode?: string;
  @IsOptional() @IsInt() @Min(0) sequence?: number;
  @IsString() @IsOptional() @MaxLength(500) note?: string;
}

// Bounds come from the shared validator the use case also runs, so the two layers cannot drift.
export class LinkExternalWhtCertificateDto implements LinkExternalWhtCertificateContract {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) externalAttachmentId?: string | null;
  @IsOptional()
  @IsString()
  @Matches(WHT_LINK_ISSUED_DATE)
  paymentDate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  paymentId?: string;

  /** Caller-stable: the same command id replays instead of linking twice. */
  @IsString() @IsNotEmpty() @MaxLength(WHT_LINK_LIMITS.commandId) commandId!: string;

  /** The RD certificate number as issued externally. */
  @IsString() @IsNotEmpty() @MaxLength(WHT_LINK_LIMITS.externalCertificateNumber) externalCertificateNumber!: string;

  /** Optional reference to where the self-issued document is kept; blank means none. */
  @IsString() @MaxLength(WHT_LINK_LIMITS.externalEvidenceRef) externalEvidenceRef!: string;

  /**
   * Date the external certificate was issued: a calendar day, `YYYY-MM-DD`, no time component.
   * Uses the shared pattern rather than `@IsDateString`, which accepts full date-times — including
   * hour 24, which ISO-8601 defines as midnight of the NEXT day and would persist the wrong date.
   */
  @Matches(WHT_LINK_ISSUED_DATE, { message: 'issuedDate must be a calendar date (YYYY-MM-DD).' })
  issuedDate!: string;

  @IsString() @IsOptional() @MaxLength(WHT_LINK_LIMITS.note) note?: string;
}

export class RemoveExternalWhtCertificateDto implements RemoveExternalWhtCertificateContract {
  @IsString() @IsNotEmpty() @MaxLength(200) commandId!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) expectedUpdatedAt!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

/**
 * §10: the payee address typed on the handoff screen. A DTO class for the same reason as the link
 * body — `forbidNonWhitelisted` would otherwise let a caller post anything, and the use case
 * re-checks the bounds so an internal caller that skips the pipe gets the identical rules.
 */
export class SetWhtHandoffPayeeAddressDto implements SetWhtHandoffPayeeAddressContract {
  @IsString() @IsNotEmpty() @MaxLength(WHT_HANDOFF_PAYEE_ADDRESS_MAX) payeeAddress!: string;
}

/** §3.3 (Decision B): company signature setting for the 50 ทวิ PDF — signature-only, no seal. */
export class UpdateCompanyTaxSignatureDto implements UpdateCompanyTaxSignatureContract {
  @IsIn(['BLANK', 'AUTO_STAMP']) signatureMode!: 'BLANK' | 'AUTO_STAMP';
  @IsString() @IsOptional() signatureAttachmentId?: string;
}

/**
 * Correction & replacement plan §2.2/§2.3: every field optional — the use case merges each one over
 * the current certificate's own value, so an omitted field means "keep what is there today", not
 * "clear it". Mirrors `WhtCertificateFields`/`PayerSnapshot`/`PayeeSnapshot`'s own field set.
 */
export class WhtCertificatePayerSnapshotOverrideDto implements Partial<PayerSnapshot> {
  @IsString() @IsOptional() @MaxLength(200) companyName?: string;
  @IsString() @IsOptional() @MaxLength(20) taxId?: string;
  @IsString() @IsOptional() @MaxLength(20) branchCode?: string;
  @IsString() @IsOptional() @MaxLength(500) address?: string;
}

export class WhtCertificatePayeeSnapshotOverrideDto implements Partial<PayeeSnapshot> {
  @IsString() @IsOptional() @MaxLength(200) name?: string;
  @IsString() @IsOptional() @MaxLength(20) taxId?: string;
  @IsString() @IsOptional() @MaxLength(500) address?: string;
  @IsString() @IsOptional() @MaxLength(20) branchCode?: string;
}

export class WhtCertificateCorrectionInputDto implements WhtCertificateCorrectionInputContract {
  @IsIn(['PND3', 'PND53']) @IsOptional() formType?: WhtFormType;
  @IsString() @IsOptional() @MaxLength(64) incomeCategoryCode?: string;
  @IsString() @IsOptional() @MaxLength(200) incomeCategoryName?: string;
  @IsString() @IsOptional() @MaxLength(20) whtRate?: string;
  @IsString() @IsOptional() @MaxLength(20) grossAmount?: string;
  @IsString() @IsOptional() @MaxLength(20) withheldAmount?: string;
  @IsString() @IsOptional() paymentDate?: string;
  @IsOptional() @ValidateNested() @Type(() => WhtCertificatePayerSnapshotOverrideDto) payerSnapshot?: WhtCertificatePayerSnapshotOverrideDto;
  @IsOptional() @ValidateNested() @Type(() => WhtCertificatePayeeSnapshotOverrideDto) payeeSnapshot?: WhtCertificatePayeeSnapshotOverrideDto;
}

/** Body of `POST wht/payment-handoffs/:handoffId/system-certificate/correction` (plan §2.3). */
export class CorrectWhtCertificateDto implements CorrectWhtCertificateContract {
  @IsObject() @ValidateNested() @Type(() => WhtCertificateCorrectionInputDto) corrected!: WhtCertificateCorrectionInputDto;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class AnswerWhtPayerModeDto implements AnswerWhtPayerModeRequest {
  @IsIn(['HEAD_OFFICE_PAYS_ALL', 'EACH_BRANCH_PAYS'], { message: 'วิธีจ่ายไม่ถูกต้อง เลือกผู้ที่จ่ายเงินและหักภาษีอีกครั้ง' }) mode!: WhtPayerMode;
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'เดือนที่เริ่มใช้ไม่ถูกต้อง เลือกเดือนอีกครั้ง' }) effectiveFromPeriodKey?: string;
}

export class ExportTaxPackageDto {
  @IsIn(['REVIEW_JSON', 'CSV', 'XLSX', 'PDF']) exportFormat!: 'REVIEW_JSON' | 'CSV' | 'XLSX' | 'PDF';
  @IsOptional() @Matches(/^\d{5}$/) establishmentCode?: string;
  @IsOptional() @IsInt() @Min(0) sequence?: number;
}

export class ConfirmWhtFilingRowsDto {
  @Equals(true) confirmed!: true;
}

export class IssueWhtCertificateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  paymentId?: string;
}

export class ExternalWhtFileUploadDto extends CreateUploadIntentDto {}
export class CompleteExternalWhtFileDto extends CompleteAttachmentUploadDto {}
