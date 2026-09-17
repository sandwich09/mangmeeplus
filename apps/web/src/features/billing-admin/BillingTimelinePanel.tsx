'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { billingControl, billingLabel, billingTimelineLabel } from '../billing/billing-display';
import type { BillingHistoryExport, BillingTimeline } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
const time=(value:string|null)=>formatThaiDateTime(value,'ไม่มีเวลาที่บันทึกไว้');
export default function BillingTimelinePanel({companyId}:{companyId:string}) {
  const [timeline,setTimeline]=useState<BillingTimeline|null>(null),[cursor,setCursor]=useState(''),[reload,setReload]=useState(0),[error,setError]=useState('');
  const generation=useRef(0),[exportBusy,setExportBusy]=useState(false),[exportError,setExportError]=useState(''),[exportNotice,setExportNotice]=useState('');
  useEffect(()=>{let active=true;generation.current++;setTimeline(null);setError('');setExportBusy(false);setExportError('');setExportNotice('');
    authedApiFetch<BillingTimeline>(`/system/billing/companies/${encodeURIComponent(companyId)}/timeline${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{cache:'no-store',suppressErrorToast:true})
      .then(result=>{if(active)setTimeline(result);}).catch(()=>{if(active)setError('โหลดประวัติไม่ได้ สิทธิ์หรือรายการอาจเปลี่ยน กรุณาโหลดใหม่หรือกลับหน้าแรก');});
    return()=>{active=false;generation.current++;};
  },[companyId,cursor,reload]);
  function loadPage(nextCursor=cursor) {
    generation.current++;setTimeline(null);setError('');setExportBusy(false);setExportError('');setExportNotice('');
    setCursor(nextCursor);setReload(value=>value+1);
  }
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
  return <section className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-6" aria-label="ประวัติแพ็กเกจและการชำระเงิน">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900">ประวัติแพ็กเกจและการชำระเงิน</h2><p className="mt-2 text-gray-600">เรียงรายการที่บันทึกใหม่ไว้บนสุด เลือกดูรายละเอียดเฉพาะรายการที่ต้องการตรวจ</p></div><button type="button" className="min-h-11 px-2 text-sm text-gray-600 underline" onClick={()=>loadPage()}>โหลดประวัติล่าสุด</button></div>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}{!timeline&&!error&&<p role="status">กำลังโหลดประวัติ…</p>}
    <div className="divide-y divide-gray-100">{timeline?.items.map(entry=>{const label=billingTimelineLabel(entry);return <article className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto]" key={entry.reference}>
      <div className="min-w-0"><p className="font-semibold text-gray-900">{label.title}</p><p className="mt-1 text-sm text-gray-600">{label.state}{entry.amountSatang!==null&&` · ${new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(entry.amountSatang/100)}`}</p><p className="mt-1 text-sm text-gray-500">บันทึกเมื่อ {time(entry.recordedAt)}{entry.origin?` · ${billingLabel('channel',entry.origin)}`:''}</p>
        <details className="mt-2 text-sm text-gray-600"><summary className="min-h-11 cursor-pointer py-2">เวลาและข้อมูลอ้างอิง</summary><div className="space-y-2 pb-2">{entry.occurredAt&&<p>เกิดรายการเมื่อ {time(entry.occurredAt)}</p>}{entry.observedAt&&<p>มีผลตรวจเมื่อ {time(entry.observedAt)}</p>}{entry.updatedAt&&<p>อัปเดตเมื่อ {time(entry.updatedAt)}</p>}<p className="break-all">เลขอ้างอิง: {entry.reference}</p><p className="break-all">{entry.type} · {entry.state}</p></div></details>
      </div>
      {entry.href&&<Link href={entry.href} className="inline-flex min-h-11 items-center self-start px-2 text-brand-800 underline">ดูรายละเอียดรายการ</Link>}
    </article>;})}</div>
    {timeline?.items.length===0&&<p className="rounded-lg bg-gray-50 p-5 text-gray-600">ยังไม่มีประวัติการชำระเงินในโหมดนี้</p>}
    {timeline&&!timeline.auditIncluded&&<p className="text-sm text-gray-600">บัญชีนี้ไม่มีสิทธิ์ดูประวัติการดำเนินการของผู้ดูแล</p>}
    <div className="flex flex-wrap justify-between gap-3 border-t border-gray-100 pt-4"><p className="self-center text-sm text-gray-600">แสดงครั้งละไม่เกิน 25 รายการ</p><div className="flex flex-wrap gap-3"><button type="button" className={billingControl} disabled={!cursor} onClick={()=>loadPage('')}>ประวัติหน้าแรก</button><button type="button" className={billingControl} disabled={!timeline?.nextCursor} onClick={()=>loadPage(timeline!.nextCursor!)}>ประวัติหน้าถัดไป</button></div></div>
    {timeline?.canExport&&<details className="border-t border-gray-100 pt-2"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-gray-600">ดาวน์โหลดประวัติ</summary><div className="space-y-3 pt-2"><p className="text-sm text-gray-600">ไฟล์ Excel (CSV) เฉพาะหน้านี้ ตามสิทธิ์ของคุณ ใช้ตรวจประวัติ ไม่ใช่ใบเสร็จหรือใบกำกับภาษี</p><p className="text-sm text-gray-600">ยอดเงิน: {timeline.financialIncluded?'รวมในไฟล์':'ไม่มีสิทธิ์ดู'} · ประวัติผู้ดูแล: {timeline.auditIncluded?'รวมในไฟล์':'ไม่มีสิทธิ์ดู'}</p><button className={billingControl} disabled={exportBusy} aria-busy={exportBusy} onClick={()=>void downloadPage()}>ดาวน์โหลดประวัติหน้านี้ (CSV)</button>{exportBusy&&<p role="status">กำลังเตรียมไฟล์…</p>}</div></details>}
    {exportError&&<p role="alert">{exportError}</p>}{exportNotice&&<p role="status">{exportNotice}</p>}
  </section>;
}
