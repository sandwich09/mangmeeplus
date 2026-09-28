'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { planTermStateLabel } from '@watchdog-bms/contracts';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { listPartners, type PartnerCompanySummaryDto } from './system-partners.api';
import UserLookupSection from './UserLookupSection';

const STATUS_LABEL = { ACTIVE: 'ใช้งานอยู่', DISABLED: 'ปิดใช้งาน', ARCHIVED: 'เก็บถาวร', SUSPENDED: 'ระงับชั่วคราว' };
const STATUS_CLASS = {
  ACTIVE: 'border-green-200 bg-green-50 text-green-800',
  DISABLED: 'border-amber-200 bg-amber-50 text-amber-800',
  ARCHIVED: 'border-gray-200 bg-gray-100 text-gray-600',
  SUSPENDED: 'border-red-200 bg-red-50 text-red-700',
};
const LINE_LABEL = { LINKED: 'เชื่อมแล้ว', UNLINKED: 'ยังไม่เชื่อม', NEEDS_COMPANY_SELECTION: 'รอเลือกบริษัท', UNKNOWN: 'ไม่ทราบสถานะ' };
// R-C6/R-C7: a term-locked shop reads by WHY it is locked, never the admin "ปิดใช้งาน" label — that
// stays reserved for a shop an admin actually disabled by hand.
const rowLabel = (c: PartnerCompanySummaryDto) => c.planState === 'NO_PACKAGE' || c.planState === 'EXPIRED' ? planTermStateLabel(c.planState) : STATUS_LABEL[c.status];

export default function PartnerListPage() {
  const searchParams = useSearchParams();
  const isUsers = searchParams.get('view') === 'users';
  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const rawPage = Number(searchParams.get('page') ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const [term, setTerm] = useState(q);
  const [items, setItems] = useState<PartnerCompanySummaryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const pageSize = 20;

  function url(changes: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) value ? params.set(key, value) : params.delete(key);
    return `/system/partners${params.size ? `?${params}` : ''}`;
  }
  function update(changes: Record<string, string>) {
    // Same-page filters are client reads; update the URL immediately so a pending route
    // transition cannot overwrite text typed just after clearing a previous search.
    window.history.replaceState(null, '', url(changes));
  }
  useEffect(() => setTerm(q), [q]);
  useEffect(() => {
    if (isUsers) return;
    let active = true;
    setLoading(true);
    setError(null);
    listPartners({ q, status: status || undefined, page, pageSize }).then(result => {
      if (!active) return;
      setItems(result.items);
      setTotal(result.total);
    }).catch(err => {
      if (active) setError((err as { status?: number }).status === 403 ? 'คุณไม่มีสิทธิ์ดูรายชื่อบริษัท' : apiErrorMessage(err));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [q, status, page, isUsers, retry]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clear = () => { setTerm(''); update({ q: '', status: '', page: '' }); setRetry(value => value + 1); };

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-sm text-gray-500">ดูแลลูกค้า</p>
          <h1 className="text-2xl font-semibold text-gray-900">บริษัทและผู้ใช้งาน</h1>
          <p className="mt-2 text-base text-gray-600">เลือกบริษัทหรือผู้ใช้งานที่ต้องการดูแล</p>
        </div>
        {!isUsers && <Link href="/system/company-onboardings/new" className="mangmee-btn mangmee-btn-primary min-h-11">เพิ่มบริษัท</Link>}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <nav aria-label="มุมมองข้อมูลลูกค้า" className="flex gap-6 border-b border-gray-200 px-4 sm:px-6">
          {[{ label: 'บริษัท', value: '' }, { label: 'ผู้ใช้งาน', value: 'users' }].map(view => (
            <Link key={view.label} href={url({ view: view.value })} scroll={false} aria-current={isUsers === Boolean(view.value) ? 'page' : undefined}
              className={`inline-flex min-h-14 items-center border-b-2 px-1 text-base font-semibold ${isUsers === Boolean(view.value) ? 'border-brand-700 text-brand-800' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
              {view.label}
            </Link>
          ))}
        </nav>
        {isUsers ? <UserLookupSection /> : (
          <section aria-label="รายชื่อบริษัท" aria-busy={loading}>
            <div className="space-y-4 p-4 sm:p-6">
              <form onSubmit={event => { event.preventDefault(); update({ q: term.trim(), page: '' }); setRetry(value => value + 1); }} className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor="company-search" className="mb-2 block text-sm font-medium text-gray-700">ค้นหาบริษัท</label>
                  <div className="flex gap-2">
                    <input id="company-search" type="search" maxLength={120} value={term} onChange={e => setTerm(e.target.value)} placeholder="ชื่อบริษัท ชื่อจดทะเบียน หรือรหัสบริษัท" className="mangmee-input min-h-11 min-w-0 flex-1 !text-base" />
                    <button type="submit" className="min-h-11 rounded-lg border border-gray-300 px-4 font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-brand-700">ค้นหา</button>
                  </div>
                </div>
                <div className="w-full lg:w-52">
                  <label id="company-status-label" className="mb-2 block text-sm font-medium text-gray-700">สถานะบริษัท</label>
                  <ThemedSelect aria-label="สถานะบริษัท" className="min-h-11 !text-base" value={status} onChange={e => update({ status: e.target.value, page: '' })}>
                    <option value="">ทุกสถานะ</option>
                    {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </ThemedSelect>
                </div>
                <button type="button" onClick={clear} title="ล้างคำค้นและสถานะที่เลือก" className="min-h-11 shrink-0 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-4 font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-brand-700">ล้างตัวกรอง</button>
              </form>
              <p role="status" className="text-sm text-gray-600">{loading ? 'กำลังค้นหาบริษัท…' : error ? 'ยังโหลดรายชื่อไม่ได้' : `พบ ${total.toLocaleString('th-TH')} บริษัท${q ? ` สำหรับ “${q}”` : ''}`}</p>
            </div>

            {error ? <div role="alert" className="mx-4 mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
              <p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 min-h-11 underline">ลองอีกครั้ง</button>
            </div> : loading ? <div className="space-y-4 border-t border-gray-100 p-6" aria-hidden="true">{[1, 2, 3].map(row => <div key={row} className="h-14 animate-pulse rounded bg-gray-100" />)}</div> : items.length === 0 ? (
              <div className="border-t border-gray-100 px-4 py-12 text-center">
                <p className="font-medium text-gray-800">{total > 0 ? 'ไม่มีรายการในหน้านี้' : q || status ? 'ไม่พบบริษัทที่ตรงกับการค้นหา' : 'ยังไม่มีบริษัทในระบบ'}</p>
                <p className="mt-2 text-sm text-gray-600">{q || status ? 'ลองเปลี่ยนคำค้นหรือเลือกสถานะอื่น' : total > 0 ? 'กลับไปหน้าแรกเพื่อดูรายการล่าสุด' : 'เมื่อเพิ่มบริษัทแล้ว รายชื่อจะแสดงที่นี่'}</p>
                {total > 0 ? <button onClick={() => update({ page: '' })} className="mt-3 min-h-11 px-3 text-brand-800 underline">กลับหน้าแรก</button> : (q || status) && <button onClick={clear} className="mt-3 min-h-11 px-3 text-brand-800 underline">แสดงบริษัททั้งหมด</button>}
              </div>
            ) : (
              <>
                <table className="w-full table-fixed border-t border-gray-200 text-left text-sm sm:text-base">
                  <caption className="sr-only">รายชื่อบริษัทที่ตรงกับคำค้นและสถานะที่เลือก</caption>
                  <thead className="bg-gray-50 text-sm text-gray-600"><tr>
                    <th scope="col" className="w-[44%] px-4 py-3 sm:w-[36%] sm:px-6">บริษัท</th>
                    <th scope="col" className="w-[27%] px-2 py-3 sm:w-[18%]">สถานะ</th>
                    <th scope="col" className="hidden w-[16%] px-2 py-3 md:table-cell">การเชื่อม LINE</th>
                    <th scope="col" className="hidden w-[16%] px-2 py-3 lg:table-cell">วันที่เพิ่ม</th>
                    <th scope="col" className="px-2 py-3"><span className="sr-only">รายละเอียด</span></th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {items.map(company => <tr key={company.id} className="hover:bg-gray-50">
                      <td className="break-words px-4 py-4 sm:px-6"><p className="font-medium text-gray-900">{company.name}</p>{company.registeredName && company.registeredName !== company.name && <p className="mt-1 text-sm text-gray-500">{company.registeredName}</p>}</td>
                      <td className="px-2 py-4"><span className={`inline-flex rounded-lg border px-2 py-1 text-sm ${STATUS_CLASS[company.status]}`}>{rowLabel(company)}</span></td>
                      <td className="hidden px-2 py-4 text-sm text-gray-600 md:table-cell">{LINE_LABEL[company.lineContextHealth]}</td>
                      <td className="hidden px-2 py-4 text-sm text-gray-600 lg:table-cell">{formatThaiDate(company.createdAt)}</td>
                      <td className="px-2 py-4"><Link href={`/system/partners/${company.id}`} className="inline-flex min-h-11 items-center rounded px-1 text-sm font-medium text-brand-800 underline-offset-4 hover:underline focus-visible:outline-brand-700" aria-label={`ดูรายละเอียด ${company.name}`}>ดูรายละเอียด</Link></td>
                    </tr>)}
                  </tbody>
                </table>
                {totalPages > 1 && <nav aria-label="หน้ารายชื่อบริษัท" className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 p-4 sm:px-6">
                  <p className="text-sm text-gray-600">หน้า {page} จาก {totalPages}</p>
                  <div className="flex gap-2">
                    <button disabled={page <= 1} onClick={() => update({ page: String(page - 1) })} className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm disabled:opacity-40">ก่อนหน้า</button>
                    <button disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })} className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm disabled:opacity-40">ถัดไป</button>
                  </div>
                </nav>}
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
