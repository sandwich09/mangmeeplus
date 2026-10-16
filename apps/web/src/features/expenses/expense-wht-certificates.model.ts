import type { WhtCertificateHandoffListRowDto, WhtHandoffStatus } from '@watchdog-bms/contracts';
export type WhtCertificateRow = WhtCertificateHandoffListRowDto;
export type WhtCertificateTab = 'pending' | 'system' | 'external' | 'cancelled';
export type WhtCertificateListState = { tab: WhtCertificateTab; search: string; page: number; order: 'newest' | 'oldest' };
export const WHT_CERTIFICATE_TABS: Record<WhtCertificateTab, WhtHandoffStatus> = {
  pending: 'REQUIRED', system: 'SYSTEM_ISSUED', external: 'EXTERNAL_LINKED', cancelled: 'CANCELLED',
};
export const WHT_CERTIFICATE_PAGE_SIZE = 10;
