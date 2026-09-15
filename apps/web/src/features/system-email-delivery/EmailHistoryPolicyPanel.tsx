'use client';
import { useEffect, useRef, useState } from 'react';
import type { EmailHistoryPolicyDto, EmailHistoryPolicyInput } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { statusOf } from '@/common/i18n/error-message.logic';

const button = 'rounded-xl border bg-white px-4 py-3 font-semibold disabled:opacity-50';
const when = (at: string | null) => at ? new Date(at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ยังไม่มี';

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
  return <section className="space-y-3 rounded-2xl border bg-white p-4 sm:p-6" aria-label="การเก็บประวัติเมล">
    <h2 className="text-xl font-bold">การเก็บประวัติเมล</h2>
    <p>ล้างเฉพาะรายละเอียดของรายการส่งสำเร็จที่ครบกำหนดออกจากประวัติทั่วไป ระบบยังเก็บหลักฐานการส่ง งานค้าง และประวัติการแก้ไขไว้</p>
    <p>การตั้งค่านี้ใช้กับระบบมั่งมี ไม่เปลี่ยนระยะเวลาเก็บอีเมลของ Postmark</p>
    {loading && <p role="status">กำลังโหลดการตั้งค่า…</p>}{error && <p role="alert" className="rounded-xl bg-red-50 p-3">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <button className={button} disabled={loading || busy || uncertain} onClick={() => { setPreview(null); setNotice(''); setReload(value => value + 1); }}>โหลดการตั้งค่าล่าสุด</button>
    {data && <>
      <p>ล้างอัตโนมัติ: <strong>{data.enabled ? 'เปิด' : 'ปิด'}</strong> · เก็บประวัติทั่วไป {data.retentionDays} วัน</p>
      <p>ครบเงื่อนไขปัจจุบัน {data.eligibleCount} รายการ · ล้างล่าสุด {when(data.lastCleanupAt)} ({data.lastArchivedCount} รายการ)</p>
      {!data.configured ? <p>ให้ผู้ดูแลระบุบัญชีส่งเมลให้ครบก่อนตั้งค่า</p> : !data.canManage ? <p>ดูได้อย่างเดียว หากต้องการแก้ไขให้ติดต่อผู้ดูแลสิทธิ์</p> : <fieldset className="space-y-3" disabled={busy || !!preview}>
        <div><label htmlFor="mail-history-days" className="block">เก็บประวัติทั่วไปกี่วัน</label>
          <input id="mail-history-days" type="text" inputMode="numeric" className="mt-2 w-full rounded-xl border p-3" value={days} onChange={event => setDays(event.target.value)}/></div>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/>เปิดการล้างอัตโนมัติ</label>
        <div><label htmlFor="mail-history-reason" className="block">เหตุผลที่แก้ไข</label>
          <textarea id="mail-history-reason" className="mt-2 w-full rounded-xl border p-3" maxLength={500} value={reason} onChange={event => setReason(event.target.value)}/></div>
        <button className={button} onClick={review}>ตรวจรายการก่อนบันทึก</button>
      </fieldset>}
      {preview && <div className="space-y-3 rounded-xl bg-amber-50 p-4" aria-label="ยืนยันการเก็บประวัติเมล">
        <p>เปลี่ยนจาก {data.retentionDays} เป็น {preview.retentionDays} วัน · ล้างอัตโนมัติจาก {data.enabled ? 'เปิด' : 'ปิด'} เป็น {preview.enabled ? 'เปิด' : 'ปิด'}</p>
        <p className="whitespace-pre-wrap break-words">เหตุผล: {preview.reason}</p>
        <p>เมื่อเปิด ระบบทยอยล้างไม่เกิน 100 รายการต่อชั่วโมง จำนวนที่ครบเงื่อนไขจะตรวจตามระยะเวลาใหม่ การปิดจะหยุดรอบถัดไป และไม่คืนรายละเอียดที่ล้างแล้ว</p>
        <div className="flex flex-wrap gap-3"><button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void save()}>{busy ? 'กำลังบันทึก…' : uncertain ? 'ลองรายการเดิมอีกครั้ง' : 'ยืนยันบันทึก'}</button>
          {!uncertain && <button className={button} disabled={busy} onClick={() => setPreview(null)}>กลับไปแก้ไข</button>}</div>
      </div>}
      <details><summary className="cursor-pointer py-3 font-semibold">ประวัติแก้ไขล่าสุด 25 รายการ</summary>
        {!data.history.length && <p>ยังไม่มีการแก้ไข</p>}{data.history.map(row => <article className="space-y-2 border-t py-3" key={row.id}>
          <p>{when(row.createdAt)} · {row.actorName ?? 'ผู้ดูแลเดิม'}</p>
          <p>{row.before.retentionDays} → {row.after.retentionDays} วัน · {row.before.enabled ? 'เปิด' : 'ปิด'} → {row.after.enabled ? 'เปิด' : 'ปิด'}</p>
          <p className="whitespace-pre-wrap break-words">{row.reason}</p>
        </article>)}
      </details>
    </>}
  </section>;
}
