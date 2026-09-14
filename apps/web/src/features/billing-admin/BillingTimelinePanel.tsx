'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { billingControl, billingLabel, billingTimelineLabel } from '../billing/billing-display';
import type { BillingTimeline } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
const time=(value:string|null)=>value?new Date(value).toLocaleString('th-TH'):'ไม่มีเวลาที่บันทึกไว้';
export default function BillingTimelinePanel({companyId}:{companyId:string}) {
  const [timeline,setTimeline]=useState<BillingTimeline|null>(null),[cursor,setCursor]=useState(''),[reload,setReload]=useState(0),[error,setError]=useState('');
  useEffect(()=>{let active=true;setTimeline(null);setError('');
    authedApiFetch<BillingTimeline>(`/system/billing/companies/${encodeURIComponent(companyId)}/timeline${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{cache:'no-store',suppressErrorToast:true})
      .then(result=>{if(active)setTimeline(result);}).catch(()=>{if(active)setError('โหลดประวัติไม่ได้ สิทธิ์หรือรายการอาจเปลี่ยน กรุณาโหลดใหม่หรือกลับหน้าแรก');});
    return()=>{active=false;};
  },[companyId,cursor,reload]);
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
    <div className="flex flex-wrap gap-3">
      <button className={billingControl} onClick={()=>setReload(v=>v+1)}>โหลดประวัติล่าสุด</button>
      {timeline?.nextCursor&&<button className={billingControl} onClick={()=>setCursor(timeline.nextCursor!)}>ประวัติหน้าถัดไป</button>}
      {cursor&&<button className={billingControl} onClick={()=>setCursor('')}>ประวัติหน้าแรก</button>}
    </div>
  </section>;
}
