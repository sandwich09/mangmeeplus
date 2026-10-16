import { isCivilDate } from '@watchdog-bms/contracts';

type Query = Pick<URLSearchParams, 'get'>;
const LIST_KEYS = ['view', 'fromDate', 'toDate', 'day', 'date', 'branchId', 'highlight', 'month', 'chip', 'query', 'dateOrder', 'page', 'yearMonth', 'dateField', 'documentStatus', 'sourceDocumentType', 'taxEvidenceStatus', 'postingStatus', 'flagFilter', 'order'] as const;
export function readExpenseListState(params: Query, defaultMonth: string) {
  const requestedMonth = params.get('month');
  const day = params.get('day') ?? params.get('date') ?? (params.get('fromDate') === params.get('toDate') ? params.get('fromDate') : null);
  const chip = params.get('chip');
  const page = Number(params.get('page'));
  return {
    month: requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : isCivilDate(day) ? day.slice(0, 7) : defaultMonth,
    chip: chip === 'pending' || chip === 'draft' ? 'pending' as const : chip === 'confirmed' ? 'confirmed' as const : chip === 'closed' || chip === 'rejected' ? 'closed' as const : 'all' as const,
    query: params.get('query') ?? '',
    dateOrder: params.get('dateOrder') === 'oldest' ? 'oldest' as const : 'newest' as const,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}
function listQuery(params: Query) {
  const query = new URLSearchParams();
  for (const key of LIST_KEYS) { const value = params.get(key); if (value !== null) query.set(key, value); }
  return query;
}
export function expenseListUrl(path: string, params: Query, state: ReturnType<typeof readExpenseListState>) {
  const query = listQuery(params);
  for (const [key, value] of Object.entries(state)) query.set(key, String(value));
  return `${path}?${query}`;
}
function safeListQuery(path: string, back: string | null): URLSearchParams | null {
  if (!back || !(back === path || back.startsWith(`${path}?`)) || /[#\\]/.test(back)) return null;
  return listQuery(new URLSearchParams(back.slice(path.length)));
}
function isCounterpartyBack(path: string, back: string | null): boolean {
  const prefix = `${path.slice(0, -'/expenses'.length)}/counterparties/`;
  return path.endsWith('/expenses') && !!back?.startsWith(prefix) && /^[A-Za-z0-9_-]+$/.test(back.slice(prefix.length));
}
export function expenseDetailUrl(path: string, expenseId: string, back: string) {
  const listPath = back === `${path}/evidence` || back.startsWith(`${path}/evidence?`) ? `${path}/evidence` : path;
  const query = safeListQuery(listPath, back);
  const target = isCounterpartyBack(path, back) ? back : query?.size ? `${listPath}?${query}` : listPath;
  return `${path}/${encodeURIComponent(expenseId)}?${new URLSearchParams({ back: target })}`;
}
export function expenseListBackTarget(path: string, back: string | null, expenseId: string) {
  if (back && isCounterpartyBack(path, back)) return back;
  const listPath = back === `${path}/evidence` || back?.startsWith(`${path}/evidence?`) ? `${path}/evidence` : path;
  const query = safeListQuery(listPath, back);
  if (!query) return path;
  query.set('highlight', expenseId);
  return `${listPath}?${query}`;
}

export function scrollExpenseListRow(node: Pick<HTMLElement, 'getBoundingClientRect' | 'scrollIntoView'>, viewportHeight: number) {
  const bounds = node.getBoundingClientRect();
  if (bounds.top < 0 || bounds.bottom > viewportHeight) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
