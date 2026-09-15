'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { EMAIL_DELIVERY_PURPOSES, type EmailDeliveryPurpose, type SystemEmailConnectionDto, type SystemEmailDeliveryDto } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { statusOf } from '@/common/i18n/error-message.logic';

const button = 'rounded-xl border bg-white px-4 py-3 font-semibold disabled:opacity-50';
const card = 'space-y-3 rounded-2xl border bg-white p-4 sm:p-6';
const time = (value: string | null) => value ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ยังไม่มีบันทึก';
const purposes: Record<EmailDeliveryPurpose | 'other', string> = {
  account_claim: 'รับบัญชีใหม่', email_verification: 'ยืนยันอีเมล', password_reset: 'กู้รหัสผ่าน', billing_status: 'แจ้งสถานะแพ็กเกจ', other: 'รายการอื่น',
};
const states: Record<string, string> = { READY: 'รอส่ง', SENDING: 'กำลังส่งหรือตรวจผล', UNKNOWN: 'ยังยืนยันผลส่งไม่ได้', ACCEPTED: 'Postmark รับคำขอส่งแล้ว',
  RETRY: 'รอตรวจและลองใหม่', CONFIG: 'ต้องตรวจการตั้งค่า', PERMANENT: 'ส่งไม่สำเร็จ ต้องตรวจรายการ', SUPPRESSED: 'ระงับการส่งไปผู้รับนี้', UNRECOGNIZED: 'ต้องตรวจสถานะรายการ' };
const errorText = (error: unknown) => statusOf(error) === 403 ? 'สิทธิ์ดูประวัติอีเมลไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลสิทธิ์'
  : statusOf(error) === 429 ? 'ตรวจบ่อยเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง' : 'โหลดข้อมูลไม่ได้ กรุณาลองอีกครั้ง';

export default function SystemEmailDeliveryPage() {
  const [data, setData] = useState<SystemEmailDeliveryDto | null>(null), [connection, setConnection] = useState<SystemEmailConnectionDto | null>(null);
  const [purpose, setPurpose] = useState<EmailDeliveryPurpose | ''>(''), [review, setReview] = useState(false), [cursor, setCursor] = useState<string | null>(null);
  const [reload, setReload] = useState(0), [loading, setLoading] = useState(true), [checking, setChecking] = useState(false);
  const [error, setError] = useState(''), [connectionError, setConnectionError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current, controller = new AbortController();
    setLoading(true); setData(null); setError(''); setConnection(null); setConnectionError(''); setChecking(false);
    const query = new URLSearchParams(); if (purpose) query.set('purpose', purpose); if (review) query.set('review', '1'); if (cursor) query.set('cursor', cursor);
    void authedApiFetch<SystemEmailDeliveryDto>(`/system/email-delivery?${query}`, { cache: 'no-store', signal: controller.signal, suppressErrorToast: true })
      .then(value => { if (generation.current === current) setData(value); })
      .catch(failure => { if (generation.current === current) setError(errorText(failure)); })
      .finally(() => { if (generation.current === current) setLoading(false); });
    return () => { generation.current++; controller.abort(); };
  }, [purpose, review, cursor, reload]);
  const inspect = async () => {
    if (checking || loading) return;
    const current = generation.current; setChecking(true); setConnection(null); setConnectionError('');
    try { const value = await authedApiFetch<SystemEmailConnectionDto>('/system/email-delivery/connection', { cache: 'no-store', suppressErrorToast: true });
      if (generation.current === current) setConnection(value);
    } catch (failure) { if (generation.current === current) { setConnectionError(errorText(failure)); if (statusOf(failure) === 403) setData(null); } }
    finally { if (generation.current === current) setChecking(false); }
  };
  return <main className="mx-auto max-w-4xl space-y-5 break-words p-4 text-base sm:p-8">
    <h1 className="text-2xl font-bold">สถานะอีเมล</h1>
    <p>ตรวจอีเมลรับบัญชี ยืนยันอีเมล กู้รหัสผ่าน และแจ้งสถานะแพ็กเกจ</p>
    <nav className="flex flex-wrap gap-3"><Link className={button} href="/system/partners">กลับหน้าลูกค้า</Link>
      <button className={button} disabled={loading} onClick={() => { setCursor(null); setReload(value => value + 1); }}>โหลดข้อมูลล่าสุด</button></nav>
    {loading && <p role="status">กำลังโหลดข้อมูล…</p>}{error && <p role="alert" className="rounded-xl bg-red-50 p-4">{error}</p>}
    {connectionError && <p role="alert" className="rounded-xl bg-red-50 p-4">{connectionError}</p>}
    {data && <>
      <section className={card} aria-label="ภาพรวมอีเมล">
        <h2 className="text-xl font-bold">บันทึกใน 7 วันที่ผ่านมา</h2><p>ตั้งแต่ {time(data.windowStartedAt)} ถึง {time(data.observedAt)}</p>
        {!data.outboundSelected && <p className="rounded-xl bg-amber-50 p-3">ขณะนี้ไม่ได้เลือกส่งผ่าน Postmark ประวัติเดิมยังตรวจได้</p>}
        {!data.configured && <p>ยังระบุบัญชี Postmark ไม่ครบ จึงยังสรุปประวัติไม่ได้ ให้ผู้ดูแลการตั้งค่าตรวจบัญชีส่งอีเมล</p>}
        {data.totals && <><dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {([['รายการต้นทาง', data.totals.intents], ['ครั้งที่พยายามส่ง', data.totals.attempts], ['Postmark รับคำขอส่ง', data.totals.accepted],
            ['เซิร์ฟเวอร์ผู้รับรับแล้ว', data.totals.delivered], ['มีบันทึกระงับส่ง', data.totals.suppressed], ['อาจส่งซ้ำ', data.totals.possibleDuplicates]] as const)
            .map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="text-2xl font-bold">{value.toLocaleString('th-TH')}</dd></div>)}
        </dl><p>นับตามรายการที่สร้างในช่วงนี้ การลองส่งใหม่อาจทำให้จำนวนครั้งมากกว่ารายการต้นทาง การรับอีเมลของเซิร์ฟเวอร์ยังไม่ยืนยันว่าลูกค้าอ่านแล้ว</p></>}
      </section>
      {data.pending && <section className={card} aria-label="รายการอีเมลที่ต้องตรวจ"><h2 className="text-xl font-bold">รายการที่ต้องตรวจ</h2>
        <p>รอส่งหรือตรวจผล {data.pending.attempts} ครั้ง · ถึงเวลาตรวจซ้ำ {data.pending.overdueRecovery} ครั้ง</p>
        <p>มีเหตุให้ตรวจ {data.pending.needsReview} ครั้ง · รายการรอที่เก่าที่สุด {time(data.pending.oldestCreatedAt)}</p>
        <p>รวมประวัติทุกช่วงเวลา รายการส่งเก่าอาจยังแสดงแม้มีการส่งครั้งใหม่สำเร็จแล้ว</p>
        <button className={button} onClick={() => { setReview(true); setCursor(null); }}>ดูรายการที่ต้องตรวจ</button>
        {data.callbacks && <details><summary className="cursor-pointer py-2 font-semibold">ผลตอบกลับที่ระบบบันทึกใน 7 วัน</summary>
          <p>รับแล้ว {data.callbacks.received} รายการ · รอประมวลผล {data.callbacks.pending} · ประมวลผลไม่สำเร็จ {data.callbacks.failed}</p>
          <p>รับล่าสุด {time(data.callbacks.latestReceivedAt)}</p><p>การไม่มีผลตอบกลับยังสรุปไม่ได้ว่าระบบรับผลหยุดทำงาน</p></details>}
      </section>}
      <section className={card} aria-label="ตรวจบัญชี Postmark"><h2 className="text-xl font-bold">ตรวจบัญชีส่งอีเมล</h2>
        <p>ตรวจว่าบัญชีและช่องทางส่งตรงกับที่ตั้งไว้ การตรวจนี้ไม่ส่งอีเมล</p>
        <button className={button} disabled={checking || !data.configured} onClick={() => void inspect()}>{checking ? 'กำลังตรวจ…' : 'ตรวจการเชื่อมต่อ Postmark'}</button>
        {connection && <div role="status" className="space-y-2">
          <p>{connection.status === 'MATCHED' ? 'บัญชีและช่องทางส่งตรงกับที่ตั้งไว้' : connection.status === 'UNAVAILABLE' ? 'ยังติดต่อ Postmark เพื่อตรวจไม่ได้ ลองอีกครั้งหรือติดต่อผู้ดูแลการตั้งค่า' : 'ต้องให้ผู้ดูแลตรวจการตั้งค่าบัญชีและช่องทางส่ง'}</p>
          {connection.facts && <p>รูปแบบบัญชี: {connection.facts.mode === 'LIVE' ? 'ส่งจริง' : connection.facts.mode === 'SANDBOX' ? 'ทดสอบ (Sandbox)' : 'ยังยืนยันไม่ได้'}</p>}
          <p>ตรวจเมื่อ {time(connection.observedAt)}</p><p>ผลนี้ยังไม่ยืนยันว่าอีเมลถึงกล่องจดหมายลูกค้า</p>
        </div>}
        <p>โควตาส่งและระยะเวลาเก็บเนื้อหาอีเมล ต้องตรวจจากบัญชี Postmark โดยตรง</p>
      </section>
    </>}
    <section className={card} aria-label="ประวัติการส่งอีเมล"><h2 className="text-xl font-bold">ประวัติการส่ง</h2>
      <div className="flex flex-wrap gap-4"><div className="space-y-2"><label htmlFor="email-purpose">ประเภทอีเมล</label><select id="email-purpose" className="block max-w-full rounded-xl border p-3" value={purpose} disabled={loading} onChange={event => { setPurpose(event.target.value as EmailDeliveryPurpose | ''); setCursor(null); }}>
        <option value="">ทั้งหมด</option>{EMAIL_DELIVERY_PURPOSES.map(value => <option key={value} value={value}>{purposes[value]}</option>)}</select></div>
        <label className="flex items-center gap-2 py-3"><input type="checkbox" checked={review} disabled={loading} onChange={event => { setReview(event.target.checked); setCursor(null); }}/>เฉพาะรายการที่ต้องตรวจ</label></div>
      {data?.configured && !data.items.length && <p>ไม่มีรายการตรงกับตัวเลือกนี้</p>}
      {data?.items.map(item => <article key={item.id} className="space-y-2 rounded-xl border p-4">
        <h3 className="font-bold">{purposes[item.purpose]} · ครั้งที่ {item.generation}</h3><p>{states[item.state]}</p>
        <p>สร้าง {time(item.createdAt)}</p><p>Postmark รับคำขอส่ง {time(item.submittedAt)}</p><p>เซิร์ฟเวอร์ผู้รับรับอีเมล {time(item.deliveredAt)}</p>
        {item.suppressedAt && <p>ระงับการส่ง {time(item.suppressedAt)}</p>}{item.deadlineAt && <p>กำหนดหมดอายุของรายการ {time(item.deadlineAt)}</p>}
        {item.nextRecoveryAt && <p>กำหนดตรวจซ้ำ {time(item.nextRecoveryAt)}</p>}{item.possibleDuplicate && <p>ผู้รับอาจได้อีเมลซ้ำ เพราะครั้งก่อนยังยืนยันผลไม่ได้</p>}
        {item.signupHistoryPath ? <Link className="inline-block py-2 font-semibold text-blue-700 underline" href={item.signupHistoryPath}>เปิดคำขอสมัครต้นทาง</Link>
          : item.billingHistoryPath ? <Link className="inline-block py-2 font-semibold text-blue-700 underline" href={item.billingHistoryPath}>เปิดรายการแจ้งแพ็กเกจต้นทาง</Link>
          : <p>{item.purpose === 'password_reset' ? 'หากลูกค้ายังเข้าไม่ได้ ให้ลูกค้าขอกู้รหัสผ่านจากหน้าเข้าสู่ระบบอีกครั้ง' : item.purpose === 'email_verification'
            ? 'ให้ลูกค้าตรวจอีเมลปัจจุบันและขอลิงก์ยืนยันใหม่จากหน้าบัญชีของตน' : item.purpose === 'billing_status' ? 'ให้เจ้าหน้าที่ที่มีสิทธิ์การชำระเงินตรวจบริษัทต้นทาง โดยใช้เลขอ้างอิงรายการนี้'
              : item.purpose === 'account_claim' ? 'ให้เจ้าหน้าที่ที่มีสิทธิ์ตรวจคำขอสมัครต้นทาง' : 'เก็บเลขอ้างอิงให้ผู้ดูแลระบบตรวจรายการนี้'}</p>}
        <details><summary className="cursor-pointer py-2">เลขอ้างอิงสำหรับเจ้าหน้าที่</summary><p className="break-all">{item.id}</p></details>
      </article>)}
      <div className="flex flex-wrap gap-3">{data?.nextCursor && <button className={button} disabled={loading} onClick={() => setCursor(data.nextCursor)}>ประวัติหน้าถัดไป</button>}
        {cursor && <button className={button} disabled={loading} onClick={() => setCursor(null)}>ประวัติหน้าแรก</button>}</div>
    </section>
  </main>;
}
