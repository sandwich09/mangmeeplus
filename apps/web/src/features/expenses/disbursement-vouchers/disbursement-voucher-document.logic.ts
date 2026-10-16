import type { DisbursementVoucherHeader } from './disbursement-vouchers.model';
export function disbursementDocumentKind(header: DisbursementVoucherHeader): 'prepare' | 'paid' | null {
  if (header.status === 'PAID' || header.status === 'CANCELLED' && header.cancelledAfterPaid) return 'paid';
  return header.documentNumber && header.revision > 0 ? 'prepare' : null;
}

export function disbursementVoucherPageTitle(header: DisbursementVoucherHeader): string {
  if (!header.documentNumber) return 'ใบเตรียมจ่าย (ร่าง)';
  const kind = disbursementDocumentKind(header) === 'paid' ? 'ใบสำคัญจ่าย' : 'ใบเตรียมจ่าย';
  return `${kind} เลขที่ ${header.documentNumber}`;
}
