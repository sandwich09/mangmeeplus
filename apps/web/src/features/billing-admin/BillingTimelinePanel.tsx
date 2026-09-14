'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { billingControl, billingLabel, billingTimelineLabel } from '../billing/billing-display';
import type { BillingHistoryExport, BillingTimeline } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
const time=(value:string|null)=>value?new Date(value).toLocaleString('th-TH'):'ไม่มีเวลาที่บันทึกไว้';
export default function BillingTimelinePanel({companyId}:{companyId:string}) {
  const [timeline,setTimeline]=useState<BillingTimeline|null>(null),[cursor,setCursor]=useState(''),[reload,setReload]=useState(0),[error,setError]=useState('');
  const generation=useRef(0),[exportBusy,setExportBusy]=useState(false),[exportError,setExportError]=useState(''),[exportNotice,setExportNotice]=useState('');
  useEffect(()=>{let active=true;generation.current++;setTimeline(null);setError('');setExportBusy(false);setExportError('');setExportNotice('');
    authedApiFetch<BillingTimeline>(`/system/billing/companies/${encodeURIComponent(companyId)}/timeline${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{cache:'no-store',suppressErrorToast:true})
      .then(result=>{if(active)setTimeline(result);}).catch(()=>{if(active)setError('โหลดประวัติไม่ได้ สิทธิ์หรือรายการอาจเปลี่ยน กรุณาโหลดใหม่หรือกลับหน้าแรก');});
    return()=>{active=false;generation.current++;};
  },[companyId,cursor,reload]);
  async function downloadPage() {
    if(exportBusy||!timeline?.canExport)return;
    const current=generation.current;setExportBusy(true);setExportError('');setExportNotice('');
    try {
      const result=await authedApiFetch<BillingHistoryExport>(`/system/billing/companies/${encodeURIComponent(companyId)}/timeline/export`,{
        method:'POST',body:JSON.stringify(cursor?{cursor}:{}),suppressErrorToast:true,cache:'no-store'});
      if(current!==generation.current)return;
      const url=URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
      try{link.href=url;link.download=result.fileName;document.body.appendChild(link);link.click();}
      finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      setExportNotice(`ดาวน์โหลดประวัติ ${result.rowCount} รายการ · ${time(result.exportedAt)}${result.nextCursor?' · ยังมีประวัติหน้าถัดไป':''}`);
    }catch{if(current===generation.current)setExportError('ดาวน์โหลดไม่ได้ ข้อมูลหรือสิทธิ์อาจเปลี่ยน โหลดประวัติล่าสุดแล้วลองอีกครั้ง');}
    finally{if(current===generation.current)setExportBusy(false);}
  }
  return <section className="space-y-3 rounded-xl border bg-white p-5" aria-label="ประวัติแพ็กเกจและการชำระเงิน">
    <h2 className="text-xl font-bold">ประวัติแพ็กเกจและการชำระเงิน</h2>
    <p className="text-base text-gray-600">เรียงตามเวลาบันทึกในระบบ สถานะเป็นผลล่าสุดของแต่ละรายการ เวลาเกิดเหตุจากผู้ให้บริการจะแสดงเมื่อมีหลักฐานเท่านั้น</p>
    {error&&<p role="alert">{error}</p>}{!timeline&&!error&&<p role="status">กำลังโหลดประวัติ…</p>}
    {timeline?.items.map(entry=>{const label=billingTimelineLabel(entry);return <article className="space-y-1 rounded-lg bg-gray-50 p-3" key={entry.reference}>
      <p className="font-semibold">{label.title} · {label.state}</p><p>บันทึก {time(entry.recordedAt)}{entry.origin?` · ${billingLabel('channel',entry.origin)}`:''}</p>
      {entry.occurredAt&&<p>เกิดเหตุ {time(entry.occurredAt)}</p>}{entry.observedAt&&<p>ตรวจผล/รับผล {time(entry.observedAt)}</p>}
      {entry.updatedAt&&<p>อัปเดตรายการ {time(entry.updatedAt)}</p>}
      {entry.amountSatang!==null&&<p>{new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(entry.amountSatang/100)}</p>}
      <details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิง</summary><p className="break-all">อ้างอิง {entry.reference}</p><p className="break-all">{entry.type} · {entry.state}</p></details>
      {entry.href&&<Link href={entry.href} className={billingControl}>เปิดรายการที่เกี่ยวข้อง</Link>}
    </article>;})}
    {timeline?.items.length===0&&<p>ยังไม่มีประวัติการชำระเงินในโหมดนี้</p>}
    {timeline&&!timeline.auditIncluded&&<p className="text-base">ขอบเขตนี้ไม่รวมประวัติการดำเนินการ</p>}
    {timeline?.canExport&&<div className="space-y-2"><button className={billingControl} disabled={exportBusy} aria-busy={exportBusy} onClick={()=>void downloadPage()}>ดาวน์โหลดประวัติหน้านี้ (CSV)</button>
      {exportBusy&&<p role="status">กำลังเตรียมไฟล์…</p>}
      <p>ครั้งละไม่เกิน 25 รายการ ใช้ข้อมูลล่าสุดตามสิทธิ์ของคุณ</p>
      <p>ยอดเงิน: {timeline.financialIncluded?'รวมในไฟล์':'ไม่มีสิทธิ์ดู'} · ประวัติการดำเนินการ: {timeline.auditIncluded?'รวมในไฟล์':'ไม่มีสิทธิ์ดู'}</p>
      <p>ไฟล์นี้ใช้ตรวจสอบประวัติ ไม่ใช่ใบเสร็จหรือใบกำกับภาษี</p></div>}
    {exportError&&<p role="alert">{exportError}</p>}{exportNotice&&<p role="status">{exportNotice}</p>}
    <div className="flex flex-wrap gap-3">
      <button className={billingControl} onClick={()=>setReload(v=>v+1)}>โหลดประวัติล่าสุด</button>
      {timeline?.nextCursor&&<button className={billingControl} onClick={()=>setCursor(timeline.nextCursor!)}>ประวัติหน้าถัดไป</button>}
      {cursor&&<button className={billingControl} onClick={()=>setCursor('')}>ประวัติหน้าแรก</button>}
    </div>
  </section>;
}
