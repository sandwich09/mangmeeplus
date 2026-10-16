import { companyProfilePath, WHT_HANDOFF_MISSING_LABELS } from '@watchdog-bms/contracts';
import type { WhtCertificateListState, WhtCertificateRow } from './expense-wht-certificates.model';
import { WHT_CERTIFICATE_TABS } from './expense-wht-certificates.model';
export function certificateListState(params: Pick<URLSearchParams, 'get'>): WhtCertificateListState {
  const tab = params.get('tab');
  const page = Number(params.get('page'));
  return { tab: tab && Object.hasOwn(WHT_CERTIFICATE_TABS, tab) ? tab as WhtCertificateListState['tab'] : 'pending',
    order: params.get('order') === 'oldest' ? 'oldest' : 'newest', search: params.get('search') ?? '', page: Number.isSafeInteger(page) && page > 0 ? page : 1 };
}
export function certificateListQuery(params: URLSearchParams, state: WhtCertificateListState): string {
  const next = new URLSearchParams(params);
  next.set('tab', state.tab);
  if (state.order === 'oldest') next.set('order', state.order); else next.delete('order');
  if (state.search.trim()) next.set('search', state.search.trim()); else next.delete('search');
  if (state.page > 1) next.set('page', String(state.page)); else next.delete('page');
  return next.toString();
}

export function certificateTab(row: Pick<WhtCertificateRow, 'status'>) {
  return (Object.keys(WHT_CERTIFICATE_TABS) as WhtCertificateListState['tab'][]).find(tab => WHT_CERTIFICATE_TABS[tab] === row.status)!;
}

/** Owner 2026-10-15: every waiting row says what it still lacks, or that it is ready; other tabs say nothing beyond their own name. */
export function certificateRowStatus(row: WhtCertificateRow, shopBanner = false): string {
  if (row.status !== 'REQUIRED') return '';
  if (row.payments?.length === 0) return 'ยังไม่บันทึกจ่าย';
  if (row.payments && row.payments.length !== 1) return 'เลือกการจ่ายที่จะออกหนังสือรับรอง';
  if (row.payments && !row.payments[0]?.paidAtConfirmed) return 'ยังไม่ยืนยันวันที่จ่าย';
  if (row.missing.length) return row.missing.map(reason => WHT_HANDOFF_MISSING_LABELS[reason]).join(' · ');
  if (row.hasPayeeAddress === false) return 'ขาดที่อยู่ผู้รับเงิน';
  if (row.payerMissing?.length) return 'ขาดข้อมูลร้าน';
  void shopBanner;
  return 'พร้อมออก';
}

/** Follow the same priority as the badge; later missing facts never skip the first fix. */
export function certificateRowHref(companyId: string, row: WhtCertificateRow, permissions: string[], returnTo: string): string {
  let section = 'certificate';
  if (row.status === 'REQUIRED') {
    if (row.payments && (row.payments.length !== 1 || !row.payments[0]?.paidAtConfirmed)) section = 'payment';
    else if (row.missing.length) section = 'withholding';
    else if (row.hasPayeeAddress === false) section = 'certificate';
    else if (row.payerMissing?.length && permissions.includes('company.legal_identity.manage')) {
      return `${companyProfilePath(companyId)}?${new URLSearchParams({ returnTo })}`;
    }
  }
  return `/companies/${companyId}/expenses${row.expenseId ? `/${row.expenseId}?section=${section}` : ''}`;
}
