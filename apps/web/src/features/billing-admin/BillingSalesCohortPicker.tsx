'use client';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { billingControl } from '../billing/billing-display';
import { useEffect, useRef, useState } from 'react';
import type { BillingOperatorOverview, BillingSalesCompany } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';
const button = billingControl;
export default function BillingSalesCohortPicker({ ids, companies, onChange, disabled = false }: {
  ids: string[] | null | undefined; companies: BillingSalesCompany[]; disabled?: boolean; onChange: (ids: string[] | null) => void;
}) {
  const [search, setSearch] = useState(''), [page, setPage] = useState<BillingOperatorOverview | null>(null);
  const [known, setKnown] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  async function find(cursor?: string) {
    const request = ++generation.current; setBusy(true); setError('');
    try {
      const data = await authedApiFetch<BillingOperatorOverview>(`/system/billing/overview?search=${encodeURIComponent(search)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store', suppressErrorToast: true });
      if (request !== generation.current) return;
      setPage(data); setKnown(current => ({ ...current, ...Object.fromEntries(data.companies.map(c => [c.companyId, c.companyName])) }));
    } catch (cause) { if (request === generation.current) setError(apiErrorMessage(cause)); }
    finally { if (request === generation.current) setBusy(false); }
  }
  const names = { ...known, ...Object.fromEntries(companies.map(c => [c.id, c.name])) };
  return <section className="space-y-3 rounded-lg border border-gray-200 p-3" aria-label="บริษัทที่เปิดรับรายการซื้อใหม่">
    <label className="block">เปิดรับรายการซื้อใหม่สำหรับ<ThemedSelect disabled={disabled || busy} aria-label="เปิดรับรายการซื้อใหม่สำหรับ" className="mangmee-input !text-base mt-1 block min-h-11 w-full rounded-lg border border-gray-200 p-2" value={ids == null ? 'all' : 'selected'} onChange={e => onChange(e.target.value === 'all' ? null : [])}>
      <option value="all">ทุกบริษัท รวมบริษัทที่จะสมัครภายหลัง</option><option value="selected">เฉพาะบริษัทที่เลือก</option>
    </ThemedSelect></label>
    <p className="text-base">มีผลกับการซื้อใหม่ ซื้อซ้ำ และเปลี่ยนเป็นแพ็กเกจใหม่ สัญญาและสิทธิ์ที่จ่ายแล้วใช้ต่อได้ตามเดิม</p>
    {ids != null && <>
      <p>เลือกแล้ว {ids.length} / 100 บริษัท{ids.length === 0 && ' · ยังไม่เปิดรับรายการซื้อใหม่สำหรับบริษัทใด'}</p>
      <ul className="space-y-2">{ids.map(id => <li key={id} className="flex flex-wrap items-center gap-2 break-all"><span>{names[id] ?? id}</span><details><summary className="min-h-11 cursor-pointer py-2">เลขบริษัท</summary><span>{id}</span></details>
        <button className={button} aria-label={`นำ ${names[id] ?? id} ออกจากกลุ่ม`} onClick={() => onChange(ids.filter(value => value !== id))}>นำออก</button></li>)}</ul>
      {ids.length > 0 && <button className={button} onClick={() => onChange([])}>นำบริษัททั้งหมดออกจากกลุ่ม</button>}
      <label className="block">ค้นหาบริษัทสำหรับเปิดขาย<input className="mangmee-input !text-base mt-1 block min-h-11 w-full rounded-lg border border-gray-200 p-2" maxLength={100} value={search} onChange={e => { generation.current++; setBusy(false); setSearch(e.target.value); setPage(null); setError(''); }} /></label>
      <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void find()}>ค้นหาบริษัทสำหรับกลุ่ม</button>
      {busy && <p role="status">กำลังค้นหาบริษัท…</p>}{error && <p role="alert">{error} กดค้นหาเพื่อลองใหม่</p>}
      {page && <><ul className="space-y-2">{page.companies.map(c => <li key={c.companyId} className="flex flex-wrap items-center gap-2 break-all"><span>{c.companyName}</span><details><summary className="min-h-11 cursor-pointer py-2">เลขบริษัท</summary><span>{c.companyId}</span></details>
        <button className={button} disabled={ids.includes(c.companyId) || ids.length >= 100} aria-label={`เพิ่ม ${c.companyName} เข้ากลุ่ม`} onClick={() => onChange([...ids, c.companyId].sort())}>{ids.includes(c.companyId) ? 'เลือกแล้ว' : 'เพิ่มเข้ากลุ่ม'}</button></li>)}</ul>
        {!page.companies.length && <p>ไม่พบบริษัท ลองเปลี่ยนคำค้น</p>}{page.nextCursor && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void find(page.nextCursor!)}>บริษัทหน้าถัดไป</button>}</>}
    </>}
  </section>;
}
