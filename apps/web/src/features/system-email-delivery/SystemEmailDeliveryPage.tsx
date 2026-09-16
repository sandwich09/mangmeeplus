'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import EmailHistoryPolicyPanel from './EmailHistoryPolicyPanel';
import { Button } from '@/common/components/button';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { EMAIL_DELIVERY_PURPOSES, type EmailDeliveryPurpose, type SystemEmailConnectionDto, type SystemEmailDeliveryDto } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { statusOf } from '@/common/i18n/error-message.logic';

const card = 'space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-6';
const link = 'inline-flex min-h-11 items-center text-brand-800 underline underline-offset-4';
const time = (value: string | null) => value ? formatThaiDateTime(value) : 'ยังไม่มีบันทึก';
const purposes: Record<EmailDeliveryPurpose | 'other', string> = {
  account_claim: 'รับบัญชีใหม่', email_verification: 'ยืนยันอีเมล', password_reset: 'กู้รหัสผ่าน', billing_status: 'แจ้งสถานะแพ็กเกจ', other: 'รายการอื่น',
};
const states: Record<string, string> = { READY: 'รอส่ง', SENDING: 'กำลังส่งหรือตรวจผล', UNKNOWN: 'ยังยืนยันผลส่งไม่ได้', ACCEPTED: 'Postmark รับคำขอส่งแล้ว',
  RETRY: 'รอตรวจและลองใหม่', CONFIG: 'ต้องตรวจการตั้งค่า', PERMANENT: 'ส่งไม่สำเร็จ ต้องตรวจรายการ', SUPPRESSED: 'ระงับการส่งไปผู้รับนี้', UNRECOGNIZED: 'ต้องตรวจสถานะรายการ' };
const errorText = (error: unknown) => statusOf(error) === 403 ? 'บัญชีนี้ไม่มีสิทธิ์ดูประวัติอีเมล'
  : statusOf(error) === 429 ? 'ตรวจบ่อยเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง' : 'โหลดข้อมูลไม่ได้ กรุณาลองอีกครั้ง';

export default function SystemEmailDeliveryPage() {
  const [data, setData] = useState<SystemEmailDeliveryDto | null>(null), [connection, setConnection] = useState<SystemEmailConnectionDto | null>(null);
  const [purpose, setPurpose] = useState<EmailDeliveryPurpose | ''>(''), [review, setReview] = useState(false), [cursor, setCursor] = useState<string | null>(null);
  const [reload, setReload] = useState(0), [loading, setLoading] = useState(true), [checking, setChecking] = useState(false);
  const [error, setError] = useState(''), [connectionError, setConnectionError] = useState('');
  const generation = useRef(0), connectionDetails = useRef<HTMLDetailsElement>(null);
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
  const clearFilters = () => { setPurpose(''); setReview(false); setCursor(null); };
  return <main className="mx-auto max-w-6xl space-y-6 break-words p-4 text-base sm:p-6 lg:p-8">
    <header><p className="mb-1 text-sm text-gray-500">คำขอและการติดต่อ</p><h1 className="text-2xl font-semibold text-gray-900">สถานะอีเมล</h1>
      <p className="mt-2 text-gray-600">ตรวจผลการส่งอีเมลสมัครใช้งาน ยืนยันอีเมล กู้รหัสผ่าน และแจ้งแพ็กเกจ</p></header>
    {data && <section className={card} aria-label="ภาพรวมอีเมล">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">ภาพรวม 7 วันที่ผ่านมา</h2><p className="text-sm text-gray-500">อัปเดต {time(data.observedAt)}</p></div>
      {!data.configured ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900"><p className="font-semibold">ยังดูประวัติการส่งอีเมลไม่ได้</p><p className="mt-1">ยังระบุบัญชี Postmark ในระบบไม่ครบ จึงยังสรุปจำนวนอีเมลไม่ได้</p><a className={link} href="#email-connection" onClick={()=>{if(connectionDetails.current)connectionDetails.current.open=true;}}>ดูรายละเอียดการเชื่อมต่อ</a></div>
        : !data.outboundSelected && <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">ขณะนี้ระบบไม่ได้ส่งผ่าน Postmark แต่ยังดูประวัติที่เคยส่งได้</p>}
      {data.totals && <><dl className="grid gap-3 sm:grid-cols-3">{([['อีเมลที่สร้าง',data.totals.intents],['Postmark รับคำขอส่งแล้ว',data.totals.accepted],['เซิร์ฟเวอร์ผู้รับรับแล้ว',data.totals.delivered]] as const).map(([label,value])=><div className="rounded-lg bg-gray-50 p-4" key={label}><dt className="text-sm text-gray-600">{label}</dt><dd className="mt-2 text-2xl font-semibold text-gray-900">{value.toLocaleString('th-TH')}</dd></div>)}</dl>
        <p className="text-sm text-gray-600">เซิร์ฟเวอร์ผู้รับรับอีเมลแล้ว ยังไม่ยืนยันว่าลูกค้าอ่านแล้ว</p>
        <details className="border-t border-gray-100 pt-2"><summary className="min-h-11 cursor-pointer py-2 text-sm text-gray-600">รายละเอียดการนับและผลตอบกลับ</summary><div className="space-y-2 pt-2 text-sm text-gray-600">
          <p>ตั้งแต่ {time(data.windowStartedAt)} ถึง {time(data.observedAt)}</p><p>พยายามส่ง {data.totals.attempts} ครั้ง · มีบันทึกระงับส่ง {data.totals.suppressed} ครั้ง · อาจส่งซ้ำ {data.totals.possibleDuplicates} ครั้ง</p><p>นับรายการที่สร้างในช่วงนี้ การลองส่งใหม่อาจทำให้จำนวนครั้งมากกว่าจำนวนอีเมล</p>
          {data.callbacks && <><p>ผลตอบกลับจาก Postmark: รับ {data.callbacks.received} รายการ · รอประมวลผล {data.callbacks.pending} · ประมวลผลไม่สำเร็จ {data.callbacks.failed}</p><p>รับล่าสุด {time(data.callbacks.latestReceivedAt)} การไม่มีผลตอบกลับยังสรุปไม่ได้ว่าการเชื่อมต่อขัดข้อง</p></>}
        </div></details></>}
    </section>}
    <section id="email-history" className={`${card} scroll-mt-24`} aria-label="ประวัติการส่งอีเมล" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">ประวัติการส่ง</h2><p className="mt-1 text-sm text-gray-600">แสดงประวัติทุกช่วงเวลาที่ยังเก็บไว้ ครั้งละไม่เกิน 25 รายการ</p></div><Button variant="ghost" className="!min-h-11 !text-base" loading={loading} onClick={() => { setCursor(null); setReload(value => value + 1); }}>อัปเดตประวัติ</Button></div>
      {data?.pending && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 p-4"><div><p className="font-medium">มีรายการที่ต้องตรวจ {data.pending.needsReview} ครั้ง</p><p className="mt-1 text-sm text-gray-600">รอส่งหรือตรวจผล {data.pending.attempts} ครั้ง · ถึงเวลาตรวจซ้ำ {data.pending.overdueRecovery} ครั้ง</p></div>{data.pending.needsReview>0&&!review&&<Button variant="secondary" className="!min-h-11 !text-base" onClick={()=>{setReview(true);setCursor(null);}}>ดูรายการที่ต้องตรวจ</Button>}<p className="w-full text-sm text-gray-500">รวมทุกช่วงเวลา รายการเก่าอาจยังต้องตรวจแม้การส่งครั้งใหม่สำเร็จแล้ว</p></div>}
      <div className="flex flex-wrap items-end gap-3"><div className="w-full sm:w-64"><label className="mb-2 block text-sm font-medium text-gray-700">ประเภทอีเมล</label><ThemedSelect aria-label="ประเภทอีเมล" className="min-h-11 !text-base" value={purpose} disabled={loading} onChange={event=>{setPurpose(event.target.value as EmailDeliveryPurpose|'');setCursor(null);}}><option value="">ทั้งหมด</option>{EMAIL_DELIVERY_PURPOSES.map(value=><option key={value} value={value}>{purposes[value]}</option>)}</ThemedSelect></div>
        <label className="flex min-h-11 items-center gap-3 text-gray-700"><input type="checkbox" className="h-4 w-4 accent-green-700" checked={review} disabled={loading} onChange={event=>{setReview(event.target.checked);setCursor(null);}}/>เฉพาะรายการที่ต้องตรวจ</label>
        <Button variant="secondary" className="!min-h-11 !text-base" disabled={loading} loading={Boolean(loading)} onClick={clearFilters}>ล้างตัวกรอง</Button></div>
      {loading && <p role="status" className="py-6 text-gray-600">กำลังอ่านประวัติ…</p>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800"><p>{error}</p><Button variant="secondary" className="mt-3 !min-h-11 !text-base" disabled={loading} onClick={()=>setReload(value=>value+1)}>ลองอีกครั้ง</Button></div>}
      {data && !data.configured && <div className="border-t border-gray-100 py-8 text-center"><p className="font-medium text-gray-800">ยังเปิดประวัติไม่ได้</p><p className="mt-2 text-gray-600">ต้องระบุบัญชีส่งอีเมลในระบบให้ครบก่อน</p></div>}
      {data?.configured && !data.items.length && <div className="border-t border-gray-100 py-8 text-center"><p className="font-medium text-gray-800">{purpose||review?'ไม่พบประวัติตามตัวกรองนี้':'ยังไม่มีประวัติการส่ง'}</p><p className="mt-2 text-gray-600">{purpose||review?'ลองเปลี่ยนประเภทอีเมลหรือล้างตัวกรอง':'รายการจะแสดงที่นี่เมื่อระบบมีบันทึกการส่งอีเมล'}</p></div>}
      {data?.items.map(item=><article key={item.id} className="space-y-3 rounded-xl border border-gray-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-gray-900">{purposes[item.purpose]} · ครั้งที่ {item.generation}</h3><span className={`rounded-lg px-3 py-1 text-sm ${item.needsReview?'bg-amber-50 text-amber-900':item.deliveredAt?'bg-brand-50 text-brand-800':'bg-gray-100 text-gray-700'}`}>{item.deliveredAt&&!item.needsReview?'เซิร์ฟเวอร์ผู้รับรับแล้ว':states[item.state]}</span></div>
        <p className="text-sm text-gray-600">สร้างรายการ {time(item.createdAt)}</p>
        {item.possibleDuplicate&&<p className="text-amber-900">ผู้รับอาจได้อีเมลซ้ำ เพราะครั้งก่อนยังยืนยันผลไม่ได้</p>}
        {item.signupHistoryPath?<Link className={link} href={item.signupHistoryPath}>ดูคำขอสมัครที่เกี่ยวข้อง</Link>:item.billingHistoryPath?<Link className={link} href={item.billingHistoryPath}>ดูการแจ้งแพ็กเกจที่เกี่ยวข้อง</Link>:item.needsReview&&<p className="text-gray-600">{item.purpose==='password_reset'?'หากลูกค้ายังเข้าไม่ได้ ให้ลูกค้าขอกู้รหัสผ่านจากหน้าเข้าสู่ระบบอีกครั้ง':item.purpose==='email_verification'?'ให้ลูกค้าตรวจอีเมลปัจจุบันและขอลิงก์ยืนยันใหม่จากหน้าบัญชีของตน':item.purpose==='billing_status'?'ดูบริษัทต้นทางในเมนูการชำระเงิน เลขอ้างอิงอยู่ในรายละเอียดด้านล่าง':item.purpose==='account_claim'?'ตรวจคำขอสมัครต้นทางในเมนูคำขอสมัครใช้งาน':'ดูสถานะและเลขอ้างอิงในรายละเอียดเพื่อตรวจสาเหตุ'}</p>}
        <details className="border-t border-gray-100 pt-1"><summary className="min-h-11 cursor-pointer py-2 text-sm text-gray-600">รายละเอียดและเลขอ้างอิง</summary><dl className="grid gap-3 py-2 text-sm sm:grid-cols-2"><div><dt className="text-gray-500">Postmark รับคำขอส่ง</dt><dd>{time(item.submittedAt)}</dd></div><div><dt className="text-gray-500">เซิร์ฟเวอร์ผู้รับรับอีเมล</dt><dd>{time(item.deliveredAt)}</dd></div>{item.suppressedAt&&<div><dt>ระงับการส่ง</dt><dd>{time(item.suppressedAt)}</dd></div>}{item.deadlineAt&&<div><dt>รายการหมดอายุ</dt><dd>{time(item.deadlineAt)}</dd></div>}{item.nextRecoveryAt&&<div><dt>กำหนดตรวจซ้ำ</dt><dd>{time(item.nextRecoveryAt)}</dd></div>}<div className="sm:col-span-2"><dt className="text-gray-500">เลขอ้างอิง ใช้ค้นประวัติในระบบ</dt><dd className="break-all">{item.id}</dd></div></dl></details>
      </article>)}
      {(data?.nextCursor||cursor)&&<nav aria-label="หน้าประวัติอีเมล" className="flex flex-wrap gap-3 border-t border-gray-100 pt-4">{cursor&&<Button variant="secondary" className="!min-h-11 !text-base" disabled={loading} onClick={()=>setCursor(null)}>กลับหน้าแรก</Button>}{data?.nextCursor&&<Button variant="secondary" className="!min-h-11 !text-base" disabled={loading} onClick={()=>setCursor(data.nextCursor)}>หน้าถัดไป</Button>}</nav>}
    </section>
    <section id="email-connection" className={`${card} scroll-mt-24`} aria-label="ตรวจบัญชี Postmark"><details ref={connectionDetails}><summary className="min-h-11 cursor-pointer py-2 font-semibold text-gray-700">การเชื่อมต่อ Postmark</summary><div className="space-y-4 pt-3 text-gray-600">
      <p>ตรวจว่าบัญชีและช่องทางส่งตรงกับที่ตั้งไว้ การตรวจนี้ไม่ส่งอีเมล</p>
      {data&&!data.configured&&<p className="rounded-lg bg-gray-50 p-4">ต้องตั้งค่าบัญชีส่งอีเมลของระบบก่อน จึงจะตรวจการเชื่อมต่อได้</p>}
      <Button variant="secondary" className="!min-h-11 !text-base" loading={checking} disabled={loading||!data?.configured} onClick={()=>void inspect()}>ตรวจการเชื่อมต่อ Postmark</Button>
      {connectionError&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{connectionError}</p>}
      {connection&&<div role="status" className="space-y-2 rounded-lg bg-gray-50 p-4"><p className="font-medium text-gray-900">{connection.status==='MATCHED'?'บัญชีและช่องทางส่งตรงกับที่ตั้งไว้':connection.status==='UNAVAILABLE'?'ยังติดต่อ Postmark ไม่ได้ ลองตรวจอีกครั้งภายหลัง':connection.status==='NOT_CONFIGURED'?'ยังตั้งค่าบัญชีส่งอีเมลไม่ครบ':'บัญชีหรือช่องทางส่งไม่ตรงกับที่ตั้งไว้ ต้องตรวจการตั้งค่า'}</p>{connection.facts&&<p>รูปแบบบัญชี: {connection.facts.mode==='LIVE'?'ส่งจริง':connection.facts.mode==='SANDBOX'?'ทดสอบ (Sandbox)':'ยังยืนยันไม่ได้'}</p>}<p className="text-sm">ตรวจเมื่อ {time(connection.observedAt)} ผลนี้ยังไม่ยืนยันว่าอีเมลถึงกล่องจดหมายลูกค้า</p></div>}
      <p className="text-sm">โควตาส่งและระยะเวลาเก็บเนื้อหาอีเมล ตรวจได้จากบัญชี Postmark</p>
    </div></details></section>
    <EmailHistoryPolicyPanel/>
  </main>;
}
