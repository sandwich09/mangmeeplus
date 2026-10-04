'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ExecutiveAccountStatus, ExecutiveUserListDto, ExecutiveUserView } from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { EXECUTIVE_PAGE_CLASS, ExecutiveSectionCard, ExecutiveTable } from '../executive-reports/ExecutiveReportDesign';
import { Button } from '@/common/components/button';
import { TextField, SelectField } from '@/common/components/field';
import { MangmeePage, MangmeeBadge } from '@/common/components/mangmee';
import { CoverLoader, LoadingState, ErrorState, ForbiddenState } from '@/common/components/state';
import { Pagination } from '@/common/components/data-table/Pagination';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { listExecutiveUsers } from './executive-users.api';
import { executiveWords as words, EXECUTIVE_USERS_TITLE, executiveFilters, executiveListUrl, executiveRights, executiveStatus, executiveStatusTone, executiveStatusOptions } from './executive-users.logic';

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
    className={EXECUTIVE_PAGE_CLASS}
    actions={!denied && <Link href="/system/executive-users/new" className="mangmee-btn mangmee-btn-primary hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700">{words.add}</Link>}>
    {denied ? <ForbiddenState description={error ?? undefined} /> : <>
      <ExecutiveSectionCard title={words.caption}>
        <form className="grid gap-3 md:grid-cols-[1fr_14rem_auto_auto] md:items-end" onSubmit={event => { event.preventDefault(); update({ q: term }); setRetry(value => value + 1); }}>
          <TextField label={words.searchLabel} name="executive-search" type="search" maxLength={320} value={term} onChange={event => setTerm(event.target.value)} disabled={loading} />
          <SelectField label={words.statusLabel} name="executive-status" value={status ?? ''} disabled={loading}
            onChange={event => update({ status: event.target.value ? event.target.value as ExecutiveAccountStatus : undefined })}>
            <option value="">{words.allStatuses}</option>{executiveStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </SelectField>
          <Button type="submit" variant="secondary" loading={loading}>{words.search}</Button>
          <Button type="button" variant="secondary" loading={loading} onClick={clear}>{words.clear}</Button>
        </form>
      <div className="relative mt-4 min-h-32" aria-busy={loading}>
        <CoverLoader active={loading && data !== null} label={words.loadingList} />
        {error ? <ErrorState description={error} onRetry={() => setRetry(value => value + 1)} />
          : !data ? <LoadingState label={words.loadingList} />
            : <>
              <p role="status" className="mb-3 text-sm text-gray-600">{words.found(data.pagination.total)}</p>
              {data.items.length === 0 ? <p className="py-8 text-center text-gray-600">{page > 1 ? words.emptyPage : words.empty}</p> : <>
                <ExecutiveTable title={words.caption} columns={[{ label: words.account, width: 260 }, { label: words.rights, width: 260, align: 'left' }, { label: words.status, width: 120, align: 'left' }, { label: words.lastEntry, width: 180, align: 'left' }]} rows={data.items.map(user => ({ key: user.userId, href: userHref(user), cells: [<div key="account"><span className="block truncate" title={user.displayName}>{user.displayName}</span><span className="block truncate text-xs font-normal text-gray-500" title={user.username}>{user.username}</span></div>, <span key="rights" className="block truncate" title={executiveRights(user)}>{executiveRights(user)}</span>, <MangmeeBadge key="status" tone={executiveStatusTone(user.status)}>{executiveStatus(user.status)}</MangmeeBadge>, lastEntry(user)] }))} />
              </>}
              {page > 1 && data.items.length === 0 && <Button variant="secondary" loading={loading} onClick={() => update({ page: 1 })}>{words.firstPage}</Button>}
              {data.pagination.totalPages > 1 && <Pagination page={page} totalPages={data.pagination.totalPages} disabled={loading} onPageChange={page => update({ page })} />}
            </>}
      </div>
      </ExecutiveSectionCard>
    </>}
  </MangmeePage>;
}
