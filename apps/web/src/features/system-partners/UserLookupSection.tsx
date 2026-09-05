'use client';

import { useState, type FormEvent } from 'react';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { Button } from '@/common/components/button';
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
        <div className="overflow-x-auto">
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
                  <td className="px-4 py-2 font-medium text-gray-900">{membership.companyName}</td>
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
      )}
    </article>
  );
}

export default function UserLookupSection() {
  const [term, setTerm] = useState('');
  const [users, setUsers] = useState<SystemUserLookupItemDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = term.trim();
    // The API answers 422 below 2 characters; refusing here keeps the round trip out of it.
    if (q.length < 2) {
      setError('กรุณาพิมพ์คำค้นอย่างน้อย 2 ตัวอักษร');
      setUsers(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setUsers((await lookupUsers(q)).items);
    } catch (err) {
      const e = err as Error & { status?: number };
      setError(e.status === 403 ? 'คุณไม่มีสิทธิ์ค้นหาผู้ใช้' : apiErrorMessage(err));
      setUsers(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">ค้นหาผู้ใช้</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          ดูผู้ใช้รายคน พร้อมบริษัททั้งหมดที่ผูกอยู่ บทบาท การเชื่อม LINE และประวัติการรวมบัญชี
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="user-lookup-q" className="sr-only">คำค้นหาผู้ใช้</label>
        <input
          id="user-lookup-q"
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          maxLength={120}
          placeholder="อีเมล ชื่อผู้ใช้ หรือชื่อ"
          className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900 focus:border-brand-400 focus:outline-none sm:h-10"
        />
        <Button type="submit" loading={loading} className="sm:w-auto">
          ค้นหา
        </Button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-2" aria-hidden>
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-gray-200 bg-white" />
          ))}
        </div>
      )}

      {!loading && !error && users !== null && (
        users.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-gray-400">
            ไม่พบผู้ใช้ที่ตรงกับคำค้น
          </p>
        ) : (
          <div className="space-y-3">
            {users.map((user) => <UserCard key={user.userId} user={user} />)}
          </div>
        )
      )}
    </section>
  );
}
