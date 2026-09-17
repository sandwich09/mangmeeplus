'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { roleKeyDisplayName } from '@/features/employee-access/role-picker.logic';
import {
  lookupUsers,
  type SystemUserLookupItemDto,
  type SystemUserMembershipDto,
  type SystemUserMergeTrailDto,
} from './system-partners.api';

const badgeClass = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium';
const neutralBadge = `${badgeClass} border-gray-200 bg-gray-100 text-gray-600`;
const greenBadge = `${badgeClass} border-green-200 bg-green-50 text-green-700`;

const USER_STATUS_LABEL: Record<SystemUserLookupItemDto['status'], string> = {
  ACTIVE: 'ใช้งานอยู่',
  SUSPENDED: 'ระงับชั่วคราว',
  DISABLED: 'ปิดใช้งาน',
};

const COMPANY_STATUS_LABEL: Record<SystemUserMembershipDto['companyStatus'], string> = {
  ACTIVE: 'ใช้งานอยู่',
  SUSPENDED: 'ระงับชั่วคราว',
  DISABLED: 'ปิดใช้งาน',
  ARCHIVED: 'เก็บถาวร',
};

/** A DISABLED membership is usually the leftover of a merge, but only the trail proves it — so the
 *  reason is only spelled out when this account actually has one. */
function membershipStatusLabel(
  membership: SystemUserMembershipDto,
  hasMergeTrail: boolean,
): string {
  switch (membership.membershipStatus) {
    case 'ACTIVE':
      return 'ใช้งานอยู่';
    case 'INVITED':
      return 'รอตอบรับ';
    case 'SUSPENDED':
      return 'ระงับชั่วคราว';
    case 'DISABLED':
      return hasMergeTrail ? 'ปิดใช้ (จากการรวมบัญชี)' : 'ปิดใช้';
    default:
      return membership.membershipStatus;
  }
}

/**
 * Review A-05. A LINE-first account is defined by what it does NOT have: no username, no address,
 * only a linked LINE identity. Anything else — including an account that simply has not linked yet
 * — is an ordinary account and keeps the two columns it is used to.
 */
export function lineOnlyUser(user: Pick<SystemUserLookupItemDto, 'username' | 'email' | 'lineLinked'>): boolean {
  return !user.username && !user.email && user.lineLinked;
}

function mergeTrailLine(entry: SystemUserMergeTrailDto): string {
  const when = formatThaiDate(entry.at);
  return entry.direction === 'merged_into'
    ? `รวมเข้าบัญชีอื่นเมื่อ ${when}`
    : `รับการรวมบัญชีเมื่อ ${when}`;
}

function UserCard({ user }: { user: SystemUserLookupItemDto }) {
  const hasMergeTrail = user.mergeTrail.length > 0;

  return (
    <article className="rounded-lg border border-gray-200 bg-white">
      <header className="space-y-1.5 border-b border-gray-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-gray-900">{user.displayName}</h2>
          {/* P10-L §8 / review A-05: a LINE-first owner has no username and no address by design,
              so two "—" placeholders read as a broken account. The badge says what they DO have. */}
          {lineOnlyUser(user) && <span className={greenBadge}>LINE</span>}
          <span className={user.status === 'ACTIVE' ? greenBadge : neutralBadge}>
            {USER_STATUS_LABEL[user.status]}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
          {lineOnlyUser(user) ? (
            <span>เข้าใช้งานด้วย LINE เท่านั้น ไม่มีชื่อผู้ใช้และอีเมล</span>
          ) : (
            <>
              <span>{user.username ?? '—'}</span>
              <span aria-hidden>·</span>
              <span className="break-all">{user.email ?? '—'}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span className={user.lineLinked ? greenBadge : neutralBadge}>
            {user.lineLinked ? 'เชื่อม LINE แล้ว' : 'ยังไม่เชื่อม LINE'}
          </span>
        </div>
        {hasMergeTrail && (
          <ul className="space-y-0.5 text-xs text-gray-400">
            {user.mergeTrail.map((entry) => (
              <li key={`${entry.direction}-${entry.otherUserId}-${entry.at}`}>{mergeTrailLine(entry)}</li>
            ))}
          </ul>
        )}
      </header>

      {user.memberships.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-400">ยังไม่มีบริษัทที่ผูกกับบัญชีนี้</p>
      ) : (
        <>
        <ul className="divide-y divide-gray-100 sm:hidden">
          {user.memberships.map(membership => <li key={membership.companyId} className="space-y-2 px-4 py-3">
            <Link href={`/system/partners/${membership.companyId}`} className="inline-flex min-h-11 items-center text-base font-medium text-brand-800 underline underline-offset-4">{membership.companyName}</Link>
            <p className="text-sm text-gray-700">บทบาท: {membership.roleKeys.length ? membership.roleKeys.map(roleKeyDisplayName).join(' · ') : 'ยังไม่มีบทบาท'}</p>
            <dl className="grid grid-cols-2 gap-2 text-sm text-gray-600">
              <div><dt>สถานะบริษัท</dt><dd className="mt-1 text-gray-900">{COMPANY_STATUS_LABEL[membership.companyStatus]}</dd></div>
              <div><dt>สถานะสมาชิก</dt><dd className="mt-1 text-gray-900">{membershipStatusLabel(membership, hasMergeTrail)}</dd></div>
            </dl>
          </li>)}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50 text-xs font-medium text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-2">ชื่อบริษัท</th>
                <th scope="col" className="px-4 py-2">บทบาท</th>
                <th scope="col" className="px-4 py-2">สถานะบริษัท</th>
                <th scope="col" className="px-4 py-2">สถานะสมาชิก</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-700">
              {user.memberships.map((membership) => (
                <tr key={membership.companyId} className="align-top">
                  <td className="px-4 py-2 font-medium text-gray-900"><Link href={`/system/partners/${membership.companyId}`} className="inline-flex min-h-11 items-center text-brand-800 underline underline-offset-4">{membership.companyName}</Link></td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {membership.roleKeys.length > 0
                      ? membership.roleKeys.map(roleKeyDisplayName).join(' · ')
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {COMPANY_STATUS_LABEL[membership.companyStatus] ?? membership.companyStatus}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {membershipStatusLabel(membership, hasMergeTrail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </article>
  );
}

export default function UserLookupSection() {
  const params = useSearchParams();
  const q = params.get('userQ') ?? '';
  const status = params.get('userStatus') ?? '';
  const [term, setTerm] = useState(q);
  const [users, setUsers] = useState<SystemUserLookupItemDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) value ? next.set(key, value) : next.delete(key);
    window.history.replaceState(null, '', `/system/partners?${next}`);
  }
  useEffect(() => setTerm(q), [q]);
  useEffect(() => {
    let active = true;
    setError(null);
    setUsers(null);
    if (!q) { setLoading(false); return; }
    if (q.length < 2) { setLoading(false); setError('กรุณาพิมพ์คำค้นอย่างน้อย 2 ตัวอักษร'); return; }
    setLoading(true);
    lookupUsers(q, status || undefined).then(result => {
      if (active) setUsers(result.items);
    }).catch(err => {
      if (active) setError((err as { status?: number }).status === 403 ? 'คุณไม่มีสิทธิ์ค้นหาผู้ใช้' : apiErrorMessage(err));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [q, status, retry]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (term.trim().length < 2) { setError('กรุณาพิมพ์คำค้นอย่างน้อย 2 ตัวอักษร'); setUsers(null); return; }
    update({ userQ: term.trim() });
    setRetry(value => value + 1);
  }
  function clear() {
    setTerm(''); setError(null); setUsers(null);
    update({ userQ: '', userStatus: '' });
    setRetry(value => value + 1);
  }

  return (
    <section aria-label="ค้นหาผู้ใช้งาน" aria-busy={loading} className="space-y-4 p-4 sm:p-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="user-lookup-q" className="mb-2 block text-sm font-medium text-gray-700">ค้นหาผู้ใช้งาน</label>
          <div className="flex gap-2">
            <input id="user-lookup-q" type="search" value={term} onChange={e => setTerm(e.target.value)} maxLength={120} placeholder="ชื่อ อีเมล หรือชื่อผู้ใช้" aria-describedby="user-search-help" className="mangmee-input min-h-11 min-w-0 flex-1 !text-base" />
            <button type="submit" className="min-h-11 rounded-lg border border-gray-300 px-4 font-medium text-gray-700 hover:bg-gray-50">ค้นหา</button>
          </div>
        </div>
        <div className="w-full lg:w-52">
          <label className="mb-2 block text-sm font-medium text-gray-700">สถานะผู้ใช้งาน</label>
          <ThemedSelect aria-label="สถานะผู้ใช้งาน" value={status} className="min-h-11 !text-base" onChange={e => update({ userStatus: e.target.value })}>
            <option value="">ทุกสถานะ</option>
            {Object.entries(USER_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </ThemedSelect>
        </div>
        <button type="button" onClick={clear} title="ล้างคำค้นและสถานะที่เลือก" className="min-h-11 shrink-0 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-4 font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-brand-700">ล้างตัวกรอง</button>
      </form>
      <p id="user-search-help" className="text-sm text-gray-600">ค้นหาจากชื่ออย่างน้อย 2 ตัวอักษร หรือกรอกอีเมล / ชื่อผู้ใช้ให้ครบ</p>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700"><p>{error}</p>{q.length >= 2 && <button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-11 underline">ลองอีกครั้ง</button>}</div>}
      <p role="status" className="text-sm text-gray-600">{loading ? 'กำลังค้นหาผู้ใช้งาน…' : users ? `แสดง ${users.length} คน สำหรับ “${q}”${users.length === 20 ? ' · แสดงสูงสุด 20 คน กรุณาระบุคำค้นให้ชัดขึ้น' : ''}` : ''}</p>
      {loading && <div aria-hidden="true" className="h-24 animate-pulse rounded-lg bg-gray-100" />}
      {!loading && !error && (users === null ? (
        <div className="rounded-lg bg-gray-50 px-4 py-10 text-center"><p className="font-medium text-gray-800">ค้นหาผู้ใช้งานที่ต้องการดูแล</p><p className="mt-2 text-sm text-gray-600">ดูบริษัทที่สังกัด บทบาท และการเชื่อม LINE ของแต่ละคน</p></div>
      ) : users.length === 0 ? (
        <div className="rounded-lg bg-gray-50 px-4 py-10 text-center"><p className="font-medium text-gray-800">ไม่พบผู้ใช้งานที่ตรงกับการค้นหา</p><p className="mt-2 text-sm text-gray-600">ลองเปลี่ยนคำค้นหรือเลือกสถานะอื่น</p><button onClick={clear} className="mt-2 min-h-11 px-3 text-brand-800 underline">ล้างการค้นหาและตัวกรอง</button></div>
      ) : <div className="space-y-4">{users.map(user => <UserCard key={user.userId} user={user} />)}</div>)}
    </section>
  );
}
