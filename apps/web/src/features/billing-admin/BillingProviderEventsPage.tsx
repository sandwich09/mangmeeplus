'use client';
import { billingLink, billingControl, billingLabel, billingEventLabel } from '../billing/billing-display';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { BillingProviderEventView } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import BillingOperationPanel from './BillingOperationPanel';
const button=billingControl;
const time=(value:string|null)=>value?formatThaiDateTime(value):'ยังไม่มี';
export default function BillingProviderEventsPage({eventId}:{eventId?:string}) {
  const [event,setEvent]=useState<BillingProviderEventView|null>(null),[rows,setRows]=useState<{items:BillingProviderEventView[];nextCursor:string|null}|null>(null);
  const [cursor,setCursor]=useState<string|null>(null),[all,setAll]=useState(false),[reload,setReload]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setEvent(null);setRows(null);
    const base='/system/billing/provider-events';
    const request=eventId?authedApiFetch<BillingProviderEventView>(`${base}/${encodeURIComponent(eventId)}`,{cache:'no-store',suppressErrorToast:true}).then(value=>{if(active)setEvent(value);}):
      authedApiFetch<{items:BillingProviderEventView[];nextCursor:string|null}>(`${base}?${new URLSearchParams({...cursor?{cursor}:{},...all?{all:'true'}:{}})}`,{cache:'no-store',suppressErrorToast:true}).then(value=>{if(active)setRows(value);});
    void request.catch(()=>{if(active)setError('โหลดรายการไม่ได้ กรุณาตรวจสิทธิ์ระดับระบบ โหมดชำระเงิน และลองโหลดใหม่');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[eventId,cursor,all,reload]);
  return <main className="mx-auto max-w-5xl space-y-5 break-words p-4 sm:p-8">
    <h1 className="text-2xl font-bold">เหตุการณ์จาก Stripe</h1>
    <p>รายการที่ระบบรับไว้แล้ว ผลตรวจเหตุการณ์ แยกจากผลชำระเงิน การเปิดสิทธิ์ และเคสอื่นของลูกค้า</p>
    <nav className="flex flex-wrap gap-3"><Link className={billingLink} href="/system/billing">บริษัท</Link><Link className={billingLink} href="/system/billing/issues">ปัญหาการชำระเงิน</Link><Link className={billingLink} href="/system/billing/provider-scans">ค้นหาเหตุการณ์ที่ตกหล่น</Link>
      {eventId&&<Link className={billingLink} href="/system/billing/provider-events">กลับรายการเหตุการณ์</Link>}</nav>
    <button className={button} disabled={loading} onClick={()=>setReload(v=>v+1)}>โหลดเหตุการณ์ล่าสุด</button>
    {!eventId&&<label className="block"><input type="checkbox" checked={all} onChange={e=>{setAll(e.target.checked);setCursor(null);}}/> รวมรายการที่ประมวลผลแล้ว</label>}
    {loading&&<p role="status">กำลังโหลด…</p>}{error&&<p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {rows&&<section className="space-y-3" aria-label="รายการเหตุการณ์">{!rows.items.length&&<p>ไม่มีรายการในตัวกรองนี้</p>}
      {rows.items.map(row=><article className="space-y-2 rounded-xl border border-gray-200 p-4 bg-white" key={row.id}><Link className="break-all underline" href={`/system/billing/provider-events/${row.id}`}>{billingEventLabel(row.eventType)} · {time(row.receivedAt)}</Link>
        <p>{billingLabel('mode',row.mode)} · {billingLabel('event',row.state)} · ตรวจแล้ว {row.attempts} ครั้ง</p><p>รับเมื่อ {time(row.receivedAt)}</p></article>)}</section>}
    {event&&<><section className="space-y-3 rounded-xl border border-gray-200 p-5 bg-white" aria-label="รายละเอียดเหตุการณ์">
      <h2 className="text-lg font-bold">{billingEventLabel(event.eventType)}</h2><details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงเหตุการณ์</summary><p className="break-all">อ้างอิง {event.id} · {event.eventType} · {event.state}</p></details><p>{billingLabel('mode',event.mode)} · {billingLabel('event',event.state)} · ตรวจแล้ว {event.attempts} ครั้ง</p>
      <p>รับเมื่อ {time(event.receivedAt)} · ประมวลผลสำเร็จเมื่อ {time(event.processedAt)}</p>
      {event.state!=='PROCESSED'&&<p>กำหนดตรวจซ้ำ {time(event.retryAt)}{event.state==='DEAD'?' · ระบบหยุดลองอัตโนมัติ รอเจ้าหน้าที่ตรวจรายการเดิม':''}</p>}
      {event.leaseUntil&&<p>สิทธิ์ประมวลผลปัจจุบันถึง {time(event.leaseUntil)}</p>}
      {event.errorCode&&<p>ยังยืนยันหลักฐานหรือการเชื่อมโยงไม่ได้ ตรวจเคสและข้อมูลต้นทางก่อนลองรายการเดิมอีกครั้ง</p>}
      {event.issueId&&<Link className="inline-block underline" href={`/system/billing/issues/${event.issueId}`}>เปิดเคสของเหตุการณ์นี้</Link>}
    </section><BillingOperationPanel key={`${event.id}:${event.sourceHash}`} eventId={event.id} eventSourceHash={event.sourceHash} canReconcile={event.canRetry} initialReason="ตรวจและประมวลผลข้อมูลเดิมจาก Stripe"/></>}
    {rows?.nextCursor&&<button className={button} disabled={loading} onClick={()=>setCursor(rows.nextCursor)}>เหตุการณ์หน้าถัดไป</button>}
    {cursor&&<button className={button} disabled={loading} onClick={()=>setCursor(null)}>เหตุการณ์หน้าแรก</button>}
  </main>;
}
