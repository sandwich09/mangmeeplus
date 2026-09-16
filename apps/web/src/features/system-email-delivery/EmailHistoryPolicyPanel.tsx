'use client';
import { useEffect, useRef, useState } from 'react';
import type { EmailHistoryPolicyDto, EmailHistoryPolicyInput } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { statusOf } from '@/common/i18n/error-message.logic';
import { Button } from '@/common/components/button';
import { formatThaiDateTime } from '@/common/i18n/thai-date';

const when = (at: string | null) => at ? formatThaiDateTime(at) : 'ยังไม่มี';

export default function EmailHistoryPolicyPanel() {
  const [data, setData] = useState<EmailHistoryPolicyDto | null>(null), [loading, setLoading] = useState(true);
  const [days, setDays] = useState('180'), [enabled, setEnabled] = useState(false), [reason, setReason] = useState('');
  const [preview, setPreview] = useState<EmailHistoryPolicyInput | null>(null), [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [reload, setReload] = useState(0);
  const generation = useRef(0), inFlight = useRef(false);
  const apply = (value: EmailHistoryPolicyDto) => { setData(value); setDays(String(value.retentionDays)); setEnabled(value.enabled); };
  useEffect(() => {
    const current = ++generation.current, abort = new AbortController();
    setLoading(true); setError(''); setData(null);
    void authedApiFetch<EmailHistoryPolicyDto>('/system/email-delivery/retention', { signal: abort.signal, cache: 'no-store', suppressErrorToast: true })
      .then(value => { if (current === generation.current) apply(value); })
      .catch(failure => { if (current === generation.current) setError(statusOf(failure) === 403 ? 'ไม่มีสิทธิ์ดูการตั้งค่าประวัติเมล' : 'โหลดการตั้งค่าไม่ได้ กรุณาลองอีกครั้ง'); })
      .finally(() => { if (current === generation.current) setLoading(false); });
    return () => { generation.current++; abort.abort(); };
  }, [reload]);
  const review = () => {
    setError(''); setNotice('');
    if (!data?.canManage || !data.scopeKey) return;
    if (!/^\d{1,4}$/.test(days) || Number(days) < 1 || Number(days) > 3650) { setError('กรอกจำนวนวันตั้งแต่ 1 ถึง 3,650'); return; }
    if (!reason.trim() || reason.length > 500) { setError('กรอกเหตุผลไม่เกิน 500 ตัวอักษร'); return; }
    setPreview({ scopeKey: data.scopeKey, version: data.version, retentionDays: Number(days), enabled, reason: reason.trim(), commandId: crypto.randomUUID() });
  };
  const save = async () => {
    if (!preview || inFlight.current) return;
    inFlight.current = true; const current = generation.current; setBusy(true); setError('');
    try {
      const value = await authedApiFetch<EmailHistoryPolicyDto>('/system/email-delivery/retention', { method: 'PUT', body: JSON.stringify(preview), suppressErrorToast: true });
      if (current !== generation.current) return;
      apply(value); setPreview(null); setUncertain(false); setReason(''); setNotice('บันทึกแล้ว ประวัติการแก้ไขอยู่ด้านล่าง');
    } catch (failure) {
      if (current !== generation.current) return;
      const status = statusOf(failure);
      if (status === 409 || status === 403 || status === 400) {
        setPreview(null); setUncertain(false); setData(null);
        setError(status === 403 ? 'สิทธิ์แก้ไขเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่' : 'ข้อมูลเปลี่ยนหรือไม่ถูกต้อง กรุณาโหลดข้อมูลล่าสุดและตรวจใหม่');
      } else {
        setUncertain(true); setError('ยังยืนยันผลบันทึกไม่ได้ กดลองรายการเดิมอีกครั้ง ระบบจะไม่บันทึกซ้ำ');
      }
    } finally { inFlight.current = false; if (current === generation.current) setBusy(false); }
  };
  const dirty = Boolean(data && (days !== String(data.retentionDays) || enabled !== data.enabled || reason));
  return <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6" aria-label="การเก็บประวัติเมล"><details>
    <summary className="min-h-11 cursor-pointer py-2 font-semibold text-gray-700">การเก็บประวัติอีเมล</summary>
    <div className="space-y-4 pt-3 text-gray-600"><p>กำหนดระยะเวลาเก็บรายละเอียดของรายการที่ส่งสำเร็จ ระบบยังเก็บหลักฐานการส่ง งานค้าง และประวัติการแก้ไขไว้</p><p className="text-sm">การตั้งค่านี้ใช้กับมั่งมี ไม่เปลี่ยนระยะเวลาเก็บอีเมลของ Postmark</p>
    {loading&&<p role="status">กำลังอ่านการตั้งค่า…</p>}{error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}{notice&&<p role="status" className="rounded-lg bg-brand-50 p-4 text-brand-800">{notice}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-gray-900">การตั้งค่าปัจจุบัน</h2><Button variant="ghost" className="!min-h-11 !text-base" disabled={loading||busy||uncertain||dirty||!!preview} onClick={()=>{setPreview(null);setNotice('');setReload(value=>value+1);}}>อัปเดตการตั้งค่า</Button></div>
    {data&&<><dl className="grid gap-3 rounded-lg bg-gray-50 p-4 sm:grid-cols-2"><div><dt className="text-sm">ล้างรายละเอียดอัตโนมัติ</dt><dd className="mt-1 font-medium text-gray-900">{data.enabled?'เปิด':'ปิด'}</dd></div><div><dt className="text-sm">เก็บประวัติทั่วไป</dt><dd className="mt-1 font-medium text-gray-900">{data.retentionDays} วัน</dd></div></dl>
      {!data.configured?<p>ยังตั้งค่าบัญชีส่งอีเมลไม่ครบ จึงยังแก้ไขการเก็บประวัติไม่ได้</p>:!data.canManage?<p>บัญชีนี้ดูการตั้งค่าได้ แต่ไม่มีสิทธิ์แก้ไข</p>:!preview&&<fieldset className="space-y-4 border-t border-gray-100 pt-4" disabled={busy}><legend className="sr-only">แก้ไขการเก็บประวัติ</legend>
        <div className="max-w-sm"><label htmlFor="mail-history-days" className="mb-2 block text-sm font-medium text-gray-700">เก็บประวัติทั่วไปกี่วัน</label><input id="mail-history-days" type="text" inputMode="numeric" className="mangmee-input min-h-11 w-full !text-base" value={days} onChange={event=>setDays(event.target.value)}/></div>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-4 w-4 accent-green-700" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/>เปิดการล้างอัตโนมัติ</label>
        <div><label htmlFor="mail-history-reason" className="mb-2 block text-sm font-medium text-gray-700">เหตุผลที่แก้ไข</label><textarea id="mail-history-reason" className="mangmee-input min-h-24 w-full !text-base" maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></div>
        <Button className="!min-h-11 !text-base" onClick={review}>ตรวจรายการก่อนบันทึก</Button>
      </fieldset>}
      {preview&&<div className="space-y-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900" aria-label="ยืนยันการเก็บประวัติเมล"><h2 className="font-semibold">ตรวจการเปลี่ยนแปลงก่อนยืนยัน</h2><p>เก็บประวัติ: {data.retentionDays} → {preview.retentionDays} วัน</p><p>ล้างอัตโนมัติ: {data.enabled?'เปิด':'ปิด'} → {preview.enabled?'เปิด':'ปิด'}</p><p className="whitespace-pre-wrap break-words">เหตุผล: {preview.reason}</p><p className="text-sm">เมื่อเปิด ระบบทยอยล้างไม่เกิน 100 รายการต่อชั่วโมงตามระยะเวลาใหม่ การปิดจะหยุดรอบถัดไป แต่ไม่คืนรายละเอียดที่ล้างแล้ว</p><div className="flex flex-wrap gap-3"><Button className="!min-h-11 !text-base" loading={busy} onClick={()=>void save()}>{uncertain?'ลองรายการเดิมอีกครั้ง':'ยืนยันบันทึก'}</Button>{!uncertain&&<Button variant="secondary" className="!min-h-11 !text-base" disabled={busy} onClick={()=>setPreview(null)}>กลับไปแก้ไข</Button>}</div></div>}
      <details className="border-t border-gray-100 pt-2"><summary className="min-h-11 cursor-pointer py-2 text-sm">ประวัติการล้างและการแก้ไข</summary><div className="space-y-3 pt-2 text-sm"><p>ครบเงื่อนไขปัจจุบัน {data.eligibleCount} รายการ · ล้างล่าสุด {when(data.lastCleanupAt)} ({data.lastArchivedCount} รายการ)</p><h3 className="font-medium text-gray-800">การแก้ไขล่าสุด 25 รายการ</h3>{!data.history.length&&<p>ยังไม่มีการแก้ไข</p>}{data.history.map(row=><article className="space-y-2 border-t border-gray-100 py-3" key={row.id}><p>{when(row.createdAt)} · {row.actorName??'ผู้ดูแลเดิม'}</p><p>{row.before.retentionDays} → {row.after.retentionDays} วัน · {row.before.enabled?'เปิด':'ปิด'} → {row.after.enabled?'เปิด':'ปิด'}</p><p className="whitespace-pre-wrap break-words">{row.reason}</p></article>)}</div></details>
    </>}
    </div></details>
  </section>;
}
