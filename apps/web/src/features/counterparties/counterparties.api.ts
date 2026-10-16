import type { AccountingCounterpartyListCounts } from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import type { CounterpartyDetail, CounterpartyListFilter, CounterpartySummary } from './counterparties.model';
import { COUNTERPARTY_PAGE_SIZE } from './counterparties.model';

const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/accounting/counterparties`;

function qs(params: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export function listCounterparties(
  companyId: string,
  params: { page: number; search?: string; filter?: CounterpartyListFilter },
): Promise<{ data: CounterpartySummary[]; total: number; counts?: AccountingCounterpartyListCounts }> {
  return apiFetch(`${base(companyId)}${qs({
    page: params.page,
    pageSize: COUNTERPARTY_PAGE_SIZE,
    search: params.search,
    // A5: `usage` is bought/sold only; "ยังไม่มีที่อยู่" is its own flag, and "ทั้งหมด" sends neither.
    usage: params.filter === 'bought' || params.filter === 'sold' ? params.filter : undefined,
    addressMissing: params.filter === 'addressMissing' ? 'true' : undefined,
  })}`);
}

export function getCounterparty(companyId: string, counterpartyId: string): Promise<CounterpartyDetail> {
  return apiFetch(`${base(companyId)}/${encodeURIComponent(counterpartyId)}`);
}

/**
 * A5/§12: `type` is server-owned and the API refuses an unknown body key with a 400, so it is not
 * sent — not even as `undefined`, which `JSON.stringify` would drop anyway but a reader would
 * misread as "we tried".
 */
export function createCounterparty(companyId: string, body: Record<string, unknown>): Promise<CounterpartySummary> {
  return apiFetch(base(companyId), { method: 'POST', body: JSON.stringify(body) });
}

export function updateCounterparty(
  companyId: string,
  counterpartyId: string,
  body: Record<string, unknown> & { expectedUpdatedAt: string },
): Promise<CounterpartySummary> {
  return apiFetch(`${base(companyId)}/${encodeURIComponent(counterpartyId)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

/** §7: the only place a person picks a primary address by hand; needs `accounting.counterparty.manage`. */
export function promoteSeenAddress(
  companyId: string,
  counterpartyId: string,
  addressText: string,
  expectedUpdatedAt?: string,
): Promise<CounterpartySummary> {
  return apiFetch(`${base(companyId)}/${encodeURIComponent(counterpartyId)}/promote-seen-address`, {
    method: 'POST',
    // §11.1/§15: the version this screen loaded, so a lost race answers `counterparty_conflict`
    // instead of overwriting someone else's edit.
    body: JSON.stringify({ addressText, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }),
  });
}
