import { ConflictException, Logger } from '@nestjs/common';
import { WHT_CERTIFICATE_CORRECTION_WORDS } from '@watchdog-bms/contracts';
import { uniqueConstraintFields } from '../../../../common/database/prisma-error';

/** A number collision is not the idempotency-key race that can replay a winner. */
export function throwIfWhtCertificateNumberCollision(error: unknown, companyId: string): void {
  if (!uniqueConstraintFields(error)?.some(field => field.includes('documentNumber') || field.includes('certificateNumber'))) return;
  Logger.error({ msg: 'wht_certificate.number_duplicate', companyId, error }, 'WhtCertificate');
  throw new ConflictException({ code: 'wht_certificate_number_duplicate', message: WHT_CERTIFICATE_CORRECTION_WORDS.numberDuplicate });
}
