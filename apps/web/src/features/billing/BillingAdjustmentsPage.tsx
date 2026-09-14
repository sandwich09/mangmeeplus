'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { BillingAdjustmentKind, BillingAdjustments } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { PLAN_TERM_CONTACT_EMAIL } from '@/features/plan-term/plan-term.logic';

const button='inline-flex min-h-11 items-center rounded-xl border px-4 py-2 font-semibold disabled:opacity-50';
const money=(n:number)=>new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(n/100);
const time=(s:string)=>new Date(s).toLocaleString('th-TH');
const labels={pending:'รอดำเนินการคืนเงิน',requires_action:'ต้องทำขั้นตอนเพิ่มเติม',succeeded:'Stripe ดำเนินการคืนเงินสำเร็จ',failed:'คืนเงินไม่สำเร็จ',canceled:'ยกเลิกการคืนเงิน',unknown:'ยังยืนยันสถานะคืนเงินไม่ได้',issued:'ออกเอกสารแล้ว',void:'เอกสารถูกยกเลิก'};
export default function BillingAdjustmentsPage({companyId,invoiceId,admin=false}:{companyId:string;invoiceId:string;admin?:boolean}) {
  const base=admin?`/system/billing/companies/${encodeURIComponent(companyId)}`:`/companies/${encodeURIComponent(companyId)}/billing`;
  const back=admin?base:`/companies/${encodeURIComponent(companyId)}/billing`;
  const [kind,setKind]=useState<BillingAdjustmentKind>('refunds'),[cursor,setCursor]=useState<string|null>(null),[reload,setReload]=useState(0);
  const [data,setData]=useState<BillingAdjustments|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[opening,setOpening]=useState(false);
  const generation=useRef(0);
  useEffect(()=>{
    let active=true;setData(null);setLoading(true);setError('');
    void authedApiFetch<BillingAdjustments>(`${base}/invoices/${encodeURIComponent(invoiceId)}/adjustments/${kind}${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{
      cache:'no-store',suppressErrorToast:true,...!admin?{headers:{'X-Company-Id':companyId}}:{}
    }).then(value=>{if(active)setData(value);}).catch(()=>{if(active)setError('โหลดรายการไม่ได้ กรุณาตรวจสิทธิ์ ลองใหม่ หรือกลับไปประวัติการชำระเงิน');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;generation.current+=1;};
  },[base,invoiceId,kind,cursor,reload,admin,companyId]);
  async function open(kind:'invoice'|'receipt'|'pdf'|'credit-note',creditNoteId?:string) {
    if(opening)return;const started=generation.current;setOpening(true);setError('');
    try {
      const result=await authedApiFetch<{url:string}>(`${base}/documents/${encodeURIComponent(invoiceId)}/open`,{method:'POST',suppressErrorToast:true,
        headers:{'Content-Type':'application/json',...!admin?{'X-Company-Id':companyId}:{}},body:JSON.stringify({kind,...creditNoteId?{creditNoteId}:{}})});
      if(started!==generation.current)return;
      const url=new URL(result.url);
      if(url.protocol!=='https:'||url.username||url.password||url.port||!['invoice.stripe.com','pay.stripe.com','payments.stripe.com'].includes(url.hostname))throw new Error('Unsafe document');
      window.location.assign(url.href);
    } catch {setData(null);setError('ยังเปิดเอกสารไม่ได้ กรุณาโหลดข้อมูลล่าสุดเพื่อตรวจสิทธิ์และสถานะเอกสาร หรือติดต่อทีมงาน');}
    finally{setOpening(false);}
  }
  return <main className="mx-auto max-w-4xl space-y-5 break-words p-4 sm:p-8">
    <h1 className="text-2xl font-bold">การคืนเงินและเอกสารปรับยอด</h1>
    <nav className="flex flex-wrap gap-3"><Link className={button} href={back}>กลับไปประวัติการชำระเงิน</Link><a className={button} href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>ติดต่อทีมงาน</a></nav>
    <p className="break-all">อ้างอิงใบแจ้งหนี้ {invoiceId}</p>
    <p>สถานะคืนเงินเป็นผลจาก Stripe ธนาคารอาจใช้เวลาบันทึกยอด เอกสารปรับยอดและสิทธิ์แพ็กเกจต้องตรวจแยกจากการคืนเงิน</p>
    <div className="flex flex-wrap gap-3"><label>รายการที่ต้องการดู <select aria-label="รายการที่ต้องการดู" className="rounded-lg border p-2" value={kind} disabled={opening} onChange={e=>{setKind(e.target.value as BillingAdjustmentKind);setCursor(null);}}>
      <option value="refunds">รายการคืนเงิน</option><option value="credit-notes">เอกสารปรับยอด</option></select></label>
      <button className={button} disabled={loading||opening} onClick={()=>setReload(n=>n+1)}>โหลดรายการล่าสุด</button></div>
    {loading&&<p role="status">กำลังตรวจข้อมูลกับ Stripe…</p>}{error&&<p role="alert" className="rounded-xl bg-red-50 p-3">{error}</p>}
    {data&&<section aria-label="รายละเอียดการปรับยอด" className="space-y-3">
      <p>{data.mode} · {data.invoiceNumber??data.invoiceId} · ตรวจเมื่อ {time(data.observedAt)}</p>
      {data.canOpenDocuments?<div className="flex flex-wrap gap-3">{([['invoice','เปิดใบแจ้งหนี้'],['receipt','เปิดใบเสร็จ'],['pdf','เปิด PDF ใบแจ้งหนี้']] as const).map(([kind,label])=><button key={kind} className={button} disabled={opening} onClick={()=>void open(kind)}>{label}</button>)}</div>:<p>ขอบเขตนี้ไม่มีสิทธิ์เปิดเอกสาร ติดต่อผู้ดูแลสิทธิ์</p>}
      {!data.items.length&&<p>ไม่พบรายการในหน้านี้</p>}
      {data.items.map(item=><article key={item.id} className="space-y-2 rounded-xl border p-4">
        <h2 className="break-all font-bold">{item.number??item.id}</h2><p>{money(item.amountSatang)} · {labels[item.status]}</p><p>{time(item.createdAt)}</p>
        {item.status==='requires_action'&&<p>ตรวจอีเมลคำแนะนำจาก Stripe หรือติดต่อทีมงานพร้อมเลขอ้างอิง</p>}
        {(item.status==='failed'||item.status==='unknown')&&<p>ติดต่อทีมงานเพื่อตรวจรายการเดิมก่อนดำเนินการต่อ</p>}
        {data.kind==='credit-notes'&&data.canOpenDocuments&&<button className={button} disabled={opening} onClick={()=>void open('credit-note',item.id)}>เปิด PDF เอกสารปรับยอด</button>}
      </article>)}
      {data.nextCursor&&<button className={button} disabled={opening} onClick={()=>setCursor(data.nextCursor)}>รายการหน้าถัดไป</button>}
    </section>}
    {cursor&&<button className={button} disabled={loading||opening} onClick={()=>setCursor(null)}>กลับไปหน้าแรก</button>}
  </main>;
}
