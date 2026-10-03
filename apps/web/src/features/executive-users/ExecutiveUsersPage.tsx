'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ExecutiveAccountStatus, ExecutiveUserListDto, ExecutiveUserView } from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { Button } from '@/common/components/button';
import { TextField, SelectField } from '@/common/components/field';
import { MangmeePage, MangmeeCard, MangmeeBadge } from '@/common/components/mangmee';
import { CoverLoader, LoadingState, ErrorState, ForbiddenState } from '@/common/components/state';
import { Pagination } from '@/common/components/data-table/Pagination';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { listExecutiveUsers } from './executive-users.api';
import { executiveWords as words, EXECUTIVE_USERS_TITLE, executiveFilters, executiveListUrl, executiveRights, executiveStatus, executiveStatusOptions } from './executive-users.logic';

const userHref = (user: ExecutiveUserView) => `/system/executive-users/${encodeURIComponent(user.userId)}`;
const lastEntry = (user: ExecutiveUserView) => user.lastWebEntryAt ? formatThaiDateTime(user.lastWebEntryAt) : words.missing;

export default function ExecutiveUsersPage() {
  const params = useSearchParams();
  const filters = executiveFilters(params);
  const { q, status, page, pageSize } = filters;
  const [term, setTerm] = useState(q);
  const [data, setData] = useState<ExecutiveUserListDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => setTerm(q), [q]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setDenied(false);
    void listExecutiveUsers({ q, status, page, pageSize }, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setData(null); setDenied(apiErrorCode(cause) === 'EXECUTIVE_ACCESS_DENIED' || cause?.status === 403);
      setError(apiErrorMessage(cause));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [q, status, page, pageSize, retry]);
  function update(changes: Parameters<typeof executiveListUrl>[1]) {
    window.history.replaceState(null, '', executiveListUrl(filters, changes));
  }
  const clear = () => { setTerm(''); update({ q: '', status: undefined }); };
  return <MangmeePage title={EXECUTIVE_USERS_TITLE} eyebrow={words.admin}
    className="min-w-0 [overflow-wrap:anywhere] [&_button]:min-h-11 [&_button]:min-w-11"
    actions={!denied && <Link href="/system/executive-users/new" className="mangmee-btn mangmee-btn-primary">{words.add}</Link>}>
    {denied ? <ForbiddenState description={error ?? undefined} /> : <>
      <MangmeeCard className="p-4">
        <form className="grid gap-3 md:grid-cols-[1fr_14rem_auto_auto] md:items-end" onSubmit={event => { event.preventDefault(); update({ q: term }); setRetry(value => value + 1); }}>
          <TextField label={words.searchLabel} name="executive-search" type="search" maxLength={320} value={term} onChange={event => setTerm(event.target.value)} disabled={loading} />
          <SelectField label={words.statusLabel} name="executive-status" value={status ?? ''} disabled={loading}
            onChange={event => update({ status: event.target.value ? event.target.value as ExecutiveAccountStatus : undefined })}>
            <option value="">{words.allStatuses}</option>{executiveStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </SelectField>
          <Button type="submit" loading={loading}>{words.search}</Button>
          <Button type="button" variant="secondary" loading={loading} onClick={clear}>{words.clear}</Button>
        </form>
      </MangmeeCard>
      <div className="relative min-h-32" aria-busy={loading}>
        <CoverLoader active={loading && data !== null} label={words.loadingList} />
        {error ? <ErrorState description={error} onRetry={() => setRetry(value => value + 1)} />
          : !data ? <LoadingState label={words.loadingList} />
            : <>
              <p role="status" className="mb-3 text-sm text-gray-600">{words.found(data.pagination.total)}</p>
              {data.items.length === 0 ? <p className="py-8 text-center text-gray-600">{page > 1 ? words.emptyPage : words.empty}</p> : <>
                <div className="grid gap-3 md:hidden">{data.items.map(user => <MangmeeCard key={user.userId} className="min-w-0 p-4">
                  <Link href={userHref(user)} className="flex min-h-11 items-center font-semibold text-brand-800">{user.displayName}</Link>
                  <p className="text-sm text-gray-600">{words.username}: {user.username}</p>
                  <p className="mt-2 text-sm text-gray-600">{words.rights}: {executiveRights(user)}</p>
                  <p className="my-2"><MangmeeBadge>{executiveStatus(user.status)}</MangmeeBadge></p>
                  <p className="text-sm text-gray-600">{words.lastEntry}: {lastEntry(user)}</p>
                </MangmeeCard>)}</div>
                <table className="hidden w-full table-fixed text-left text-sm md:table">
                  <caption className="sr-only">{words.caption}</caption>
                  <thead><tr>{[words.account, words.rights, words.status, words.lastEntry].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
                  <tbody>{data.items.map(user => <tr key={user.userId} className="border-t border-gray-200">
                    <td className="break-words p-3"><Link href={userHref(user)} className="flex min-h-11 items-center font-semibold text-brand-800">{user.displayName}</Link><p>{user.username}</p></td>
                    <td className="break-words p-3">{executiveRights(user)}</td><td className="p-3">{executiveStatus(user.status)}</td><td className="p-3">{lastEntry(user)}</td>
                  </tr>)}</tbody>
                </table>
              </>}
              {page > 1 && data.items.length === 0 && <Button variant="secondary" loading={loading} onClick={() => update({ page: 1 })}>{words.firstPage}</Button>}
              {data.pagination.totalPages > 1 && <Pagination page={page} totalPages={data.pagination.totalPages} disabled={loading} onPageChange={page => update({ page })} />}
            </>}
      </div>
    </>}
  </MangmeePage>;
}
