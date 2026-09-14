'use client';
import Link from 'next/link';
import {BillingInvoiceFindings} from './BillingInvoiceFindings';
import { BillingScanSchedulePanel } from './BillingScanSchedulePanel';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { BillingProviderScanView } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';

const eventBase='/system/billing/provider-scans',button='min-h-11 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50';
const time=(value:string|null)=>value?new Date(value).toLocaleString('th-TH'):'ยังไม่มี';
const localTime=(ms:number)=>{const date=new Date(ms);return new Date(ms-date.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const state=(value:string)=>({QUEUED:'รอตรวจต่อ',RUNNING:'กำลังตรวจ',SUCCEEDED:'ตรวจครบช่วงที่เลือก',UNKNOWN:'ต้องตรวจสอบก่อนทำต่อ',BLOCKED:'ติดเงื่อนไข',CANCELLED:'ยกเลิกแล้ว'}[value]??value);
export default function BillingProviderScansPage({scanId,companyId}:{scanId?:string;companyId?:string}) {
  const base=companyId?`/system/billing/companies/${encodeURIComponent(companyId)}/invoice-scans`:eventBase;
  const router=useRouter(),intent=useRef<{body:string;key:string}|null>(null);
  const [scan,setScan]=useState<BillingProviderScanView|null>(null),[list,setList]=useState<{items:BillingProviderScanView[];nextCursor:string|null;canCreate:boolean}|null>(null);
  const [cursor,setCursor]=useState<string|null>(null),[reload,setReload]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [start,setStart]=useState(()=>localTime(Date.now()-(companyId?365:1)*86400000)),[end,setEnd]=useState(()=>localTime(Date.now()-120000)),[reason,setReason]=useState('');
  const accept=(value:BillingProviderScanView)=>setScan(current=>current?.id===value.id&&current.version>value.version?current:value);
  useEffect(()=>{intent.current=null;setCursor(null);setReason('');},[base]);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setScan(null);setList(null);
    const request=scanId?authedApiFetch<BillingProviderScanView>(`${base}/${encodeURIComponent(scanId)}`,{cache:'no-store',suppressErrorToast:true}).then(value=>{if(active)accept(value);}):
      authedApiFetch<{items:BillingProviderScanView[];nextCursor:string|null;canCreate:boolean}>(`${base}?${new URLSearchParams(cursor?{cursor}:{})}`,{cache:'no-store',suppressErrorToast:true}).then(value=>{if(active)setList(value);});
    void request.catch(()=>{if(active)setError('โหลดงานตรวจไม่ได้ กรุณาตรวจสิทธิ์และลองโหลดใหม่');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[scanId,cursor,reload,base]);
  useEffect(()=>{
    if(!scanId)return;let active=true,count=0;
    const timer=setInterval(()=>{
      if(++count>20){clearInterval(timer);return;}
      void authedApiFetch<BillingProviderScanView>(`${base}/${encodeURIComponent(scanId)}`,{cache:'no-store',suppressErrorToast:true}).then(value=>{
        if(active)accept(value);if(!['QUEUED','RUNNING'].includes(value.state))clearInterval(timer);
      }).catch(()=>{clearInterval(timer);if(active)setError('ยังโหลดผลล่าสุดไม่ได้ กดโหลดงานล่าสุดหรือกลับมาเปิดลิงก์เดิมได้');});
    },3000);
    return()=>{active=false;clearInterval(timer);};
  },[scanId,reload,base]);
  const create=async(event:React.FormEvent)=>{
    event.preventDefault();setBusy(true);setError('');
    try{
      const body=JSON.stringify({windowStart:new Date(start).toISOString(),windowEnd:new Date(end).toISOString(),reason});
      if(intent.current?.body!==body)intent.current={body,key:crypto.randomUUID()};
      const result=await authedApiFetch<BillingProviderScanView>(base,{method:'POST',body,headers:{'idempotency-key':intent.current.key},suppressErrorToast:true});
      router.push(`${base}/${result.id}`);
    }catch{setError('ยังเริ่มงานไม่ได้ ตรวจช่วงเวลาและสิทธิ์ หรือโหลดรายการเพื่อค้นหาคำขอเดิมก่อนลองอีกครั้ง');}finally{setBusy(false);}
  };
  const act=async(action:'cancel'|'resume')=>{
    if(!scan)return;setBusy(true);setError('');
    try{accept(await authedApiFetch<BillingProviderScanView>(`${base}/${scan.id}/${action}`,{method:'POST',body:JSON.stringify({expectedVersion:scan.version}),suppressErrorToast:true}));setReload(v=>v+1);}
    catch{setError('งานหรือสิทธิ์เปลี่ยนแล้ว โหลดผลล่าสุดและตรวจเงื่อนไขก่อนทำต่อ');}finally{setBusy(false);}
  };
  return <main className="mx-auto max-w-4xl space-y-5 break-words p-4 sm:p-8">
    <h1 className="text-2xl font-bold">{companyId?'ตรวจประวัติใบแจ้งหนี้ Stripe':'ค้นหาเหตุการณ์ Stripe ที่ตกหล่น'}</h1>
    <p>{companyId?'ตรวจใบแจ้งหนี้ตามช่วงวันที่สร้างและบัญชี Stripe ของบริษัท เปรียบเทียบกับข้อมูลที่มีอยู่ การพบใบแจ้งหนี้ยังไม่ใช่การยืนยันสิทธิ์หรือยอดชำระ และไม่เปลี่ยนแพ็กเกจลูกค้า':'ตรวจเหตุการณ์ในช่วงที่เลือก แล้วให้ระบบตรวจการชำระเงินและสิทธิ์ของลูกค้าต่อ การค้นหาครบไม่ได้หมายความว่าลูกค้าทุกรายได้รับสิทธิ์แล้ว'}</p>
    <nav className="flex flex-wrap gap-3"><Link className={button} href="/system/billing/provider-events">เหตุการณ์ที่รับไว้</Link><Link className={button} href="/system/billing/issues">คิวตรวจสอบ</Link><Link className={button} href="/system/billing">บริษัท</Link><Link className={button} href="/system/billing/settings">ตั้งค่าการจ่ายเงิน</Link>
      {companyId&&<Link className={button} href={`/system/billing/companies/${encodeURIComponent(companyId)}`}>กลับไปบริษัทเดิม</Link>}
      {scanId&&<Link className={button} href={base}>กลับรายการงานตรวจ</Link>}</nav>
    <button className={button} disabled={loading||busy} onClick={()=>setReload(v=>v+1)}>โหลดงานล่าสุด</button>
    {loading&&<p role="status">กำลังโหลด…</p>}{error&&<p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {!scanId&&!companyId&&<BillingScanSchedulePanel/>}
    {!scanId&&list?.canCreate&&<form onSubmit={event=>void create(event)} className="space-y-4 rounded-xl border p-4">
      <h2 className="text-lg font-bold">เริ่มงานตรวจ</h2><p>{companyId?'เลือกช่วงวันที่สร้างใบแจ้งหนี้ตั้งแต่ปี1970 และสิ้นสุดก่อนปัจจุบันอย่างน้อย1นาที งานขนาดใหญ่แบ่งช่วงเวลาได้ เวลาตามเครื่องนี้':'เลือกย้อนหลังได้ไม่เกิน29วัน และสิ้นสุดก่อนปัจจุบันอย่างน้อย1นาที เวลาตามเครื่องนี้'}</p>
      <label className="block">เริ่มช่วงเวลา<input className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border p-2" type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label className="block">สิ้นสุดช่วงเวลา<input className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border p-2" type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></label>
      <label className="block">เหตุผล<textarea className="mt-1 block w-full rounded-lg border p-2" required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <button className={button} disabled={busy}>{companyId?'เริ่มตรวจใบแจ้งหนี้':'เริ่มค้นหาเหตุการณ์'}</button>
    </form>}
    {companyId&&!scanId&&list&&!list.canCreate&&<p>เริ่มงานใหม่ไม่ได้ในขณะนี้ ตรวจสิทธิ์ผู้ดูแลและบัญชี Stripe ของบริษัท หรือเปิดงานเดิมเพื่อดูผล</p>}
    {scan&&<section aria-label={companyId?'ผลการตรวจใบแจ้งหนี้':'ผลการค้นหาเหตุการณ์'} className="space-y-3 rounded-xl border p-4">
      <h2 className="text-lg font-bold">{state(scan.state)}</h2><p>{scan.mode} · {scan.reason}</p><p>อ้างอิง {scan.id}</p>
      <p>{time(scan.windowStart)} ถึง {time(scan.windowEnd)}</p><p>บันทึกความคืบหน้าล่าสุด {time(scan.checkpointAt)}</p>
      <p>ตรวจแล้ว {scan.pages} หน้า · พบ {scan.seen} {companyId?'ใบแจ้งหนี้':'เหตุการณ์'}</p>{scan.invoiceFindings?<p>ข้อมูลตรงกัน {scan.invoiceFindings.matched} · ยังไม่พบในระบบ {scan.invoiceFindings.missing} · ข้อมูลต่างกัน {scan.invoiceFindings.different}</p>:<p>รับเพิ่ม {scan.imported} · มีอยู่แล้ว {scan.known} · ไม่เกี่ยวข้อง {scan.ignored} · รุ่นข้อมูลที่ต้องตรวจเพิ่ม {scan.incompatible}</p>}
      {scan.retryAt&&<p>ตรวจต่อได้ตั้งแต่ {time(scan.retryAt)}</p>}
      {scan.errorCode&&<p role="alert">{scan.errorCode==='CONTROL_SOURCE_CHANGED'?'บัญชี Stripe ที่ผูกไว้เปลี่ยนแล้ว งานเดิมยังดูผลและยกเลิกได้ ให้เริ่มงานใหม่หลังตรวจบัญชีปัจจุบัน':scan.errorCode==='RETENTION_WINDOW_EXPIRED'?'ช่วงเวลาบางส่วนเกินอายุที่ค้นหาได้แล้ว งานนี้ยังไม่ครบ ให้เปิดงานใหม่สำหรับช่วงที่ยังค้นได้':scan.errorCode==='PAGE_LIMIT_REACHED'?'จำนวนรายการเกินขอบเขตของงานนี้ ให้เริ่มงานใหม่โดยแบ่งช่วงเวลาให้สั้นลง':scan.errorCode==='CONTROL_PERMISSION_CHANGED'?'ผู้เริ่มงานไม่มีสิทธิ์เดิมแล้ว ให้ผู้มีสิทธิ์ตรวจและเริ่มงานใหม่':'ยังตรวจไม่ครบ ความคืบหน้าที่บันทึกไว้ยังอยู่ ตรวจเงื่อนไขแล้วทำงานเดิมต่อได้'}</p>}
      <div className="flex flex-wrap gap-2">{scan.canResume&&<button className={button} disabled={busy} onClick={()=>void act('resume')}>ทำงานเดิมต่อ</button>}
        {scan.canCancel&&<button className={button} disabled={busy} onClick={()=>void act('cancel')}>ยกเลิกงานตรวจ</button>}
        <Link className="self-center underline" href={base}>เปิดรายการหรือเริ่มงานใหม่</Link></div>
      <p>กลับมาเปิดลิงก์นี้หรือกดโหลดเพื่อดูผลล่าสุดได้</p>
    </section>}
    {companyId&&scan&&<BillingInvoiceFindings companyId={companyId} scanId={scan.id} version={scan.version}/>}
    {list&&<section aria-label="รายการงานค้นหา" className="space-y-3">{!list.items.length&&<p>ยังไม่มีงานตรวจในรายการนี้</p>}
      {list.items.map(row=><article key={row.id} className="space-y-2 rounded-xl border p-4"><Link className="underline" href={`${base}/${row.id}`}>{state(row.state)} · {row.reason}</Link>
        <p>{row.mode} · {time(row.windowStart)} ถึง {time(row.windowEnd)}</p><p>ตรวจแล้ว {row.pages} หน้า · {companyId?'เก็บผลตรวจ':'รับเพิ่ม'} {row.imported} {companyId?'รายการ':'เหตุการณ์'}</p></article>)}
      {list.nextCursor&&<button className={button} onClick={()=>setCursor(list.nextCursor)}>งานหน้าถัดไป</button>}
      {cursor&&<button className={button} onClick={()=>setCursor(null)}>งานหน้าแรก</button>}
    </section>}
  </main>;
}
