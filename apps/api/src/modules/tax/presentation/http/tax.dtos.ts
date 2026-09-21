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
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type {
  LinkExternalWhtCertificateDto as LinkExternalWhtCertificateContract,
  SetWhtHandoffPayeeAddressDto as SetWhtHandoffPayeeAddressContract,
} from '@watchdog-bms/contracts';
import { WHT_HANDOFF_PAYEE_ADDRESS_MAX } from '@watchdog-bms/contracts';
import { WHT_LINK_ISSUED_DATE, WHT_LINK_LIMITS } from '../../domain/logic/wht-link-evidence.logic';

// Bounds come from the shared validator the use case also runs, so the two layers cannot drift.
export class LinkExternalWhtCertificateDto implements LinkExternalWhtCertificateContract {
  /** Caller-stable: the same command id replays instead of linking twice. */
  @IsString() @IsNotEmpty() @MaxLength(WHT_LINK_LIMITS.commandId) commandId!: string;

  /** The RD certificate number as issued externally. */
  @IsString() @IsNotEmpty() @MaxLength(WHT_LINK_LIMITS.externalCertificateNumber) externalCertificateNumber!: string;

  /** Pointer to the stored artifact/evidence for that document. */
  @IsString() @IsNotEmpty() @MaxLength(WHT_LINK_LIMITS.externalEvidenceRef) externalEvidenceRef!: string;

  /**
   * Date the external certificate was issued: a calendar day, `YYYY-MM-DD`, no time component.
   * Uses the shared pattern rather than `@IsDateString`, which accepts full date-times — including
   * hour 24, which ISO-8601 defines as midnight of the NEXT day and would persist the wrong date.
   */
  @Matches(WHT_LINK_ISSUED_DATE, { message: 'issuedDate must be a calendar date (YYYY-MM-DD).' })
  issuedDate!: string;

  @IsString() @IsOptional() @MaxLength(WHT_LINK_LIMITS.note) note?: string;
}

/**
 * §10: the payee address typed on the handoff screen. A DTO class for the same reason as the link
 * body — `forbidNonWhitelisted` would otherwise let a caller post anything, and the use case
 * re-checks the bounds so an internal caller that skips the pipe gets the identical rules.
 */
export class SetWhtHandoffPayeeAddressDto implements SetWhtHandoffPayeeAddressContract {
  @IsString() @IsNotEmpty() @MaxLength(WHT_HANDOFF_PAYEE_ADDRESS_MAX) payeeAddress!: string;
}
