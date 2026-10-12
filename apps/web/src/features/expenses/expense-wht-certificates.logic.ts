import type { WhtCertificateListState, WhtCertificatePrimaryAction, WhtCertificateRow } from './expense-wht-certificates.model';
import { WHT_CERTIFICATE_TABS } from './expense-wht-certificates.model';
import { canIssueExpenseWhtCertificate } from './expenses.model';
export function certificatePrimaryAction(row: WhtCertificateRow, permissions: string[]): WhtCertificatePrimaryAction {
  if (row.status === 'SYSTEM_ISSUED') return 'download';
  if (row.status === 'REQUIRED' && row.missing.length) return 'edit';
  // C1 excludes unconfirmed expense sources from the pending read.
  if (canIssueExpenseWhtCertificate({ status: 'CONFIRMED', whtAmount: row.withheldAmount }, row, permissions)) return 'issue';
  return 'open';
}
export function certificateListState(params: Pick<URLSearchParams, 'get'>): WhtCertificateListState {
  const tab = params.get('tab');
  const page = Number(params.get('page'));
  return { tab: tab && Object.hasOwn(WHT_CERTIFICATE_TABS, tab) ? tab as WhtCertificateListState['tab'] : 'pending',
    search: params.get('search') ?? '', page: Number.isSafeInteger(page) && page > 0 ? page : 1 };
}
export function certificateListQuery(params: URLSearchParams, state: WhtCertificateListState): string {
  const next = new URLSearchParams(params);
  next.set('tab', state.tab);
  if (state.search.trim()) next.set('search', state.search.trim()); else next.delete('search');
  if (state.page > 1) next.set('page', String(state.page)); else next.delete('page');
  return next.toString();
}

export function certificateTab(row: Pick<WhtCertificateRow, 'status'>) {
  return (Object.keys(WHT_CERTIFICATE_TABS) as WhtCertificateListState['tab'][]).find(tab => WHT_CERTIFICATE_TABS[tab] === row.status)!;
}
