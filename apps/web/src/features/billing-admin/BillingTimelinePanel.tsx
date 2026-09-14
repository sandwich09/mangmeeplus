'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
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
    <p className="text-sm text-gray-600">เรียงตามเวลาบันทึกในระบบ สถานะเป็นผลล่าสุดของแต่ละรายการ เวลาเกิดเหตุจากผู้ให้บริการจะแสดงเมื่อมีหลักฐานเท่านั้น</p>
    {error&&<p role="alert">{error}</p>}{!timeline&&!error&&<p role="status">กำลังโหลดประวัติ…</p>}
    {timeline?.items.map(entry=><article className="space-y-1 rounded-lg bg-gray-50 p-3" key={entry.reference}>
      <p className="font-semibold">{entry.type==='RECORD_SUPPORT_OUTCOME'?'บันทึกผลติดต่อ':entry.type==='SCAN_PROVIDER_INVOICES'?'ตรวจประวัติใบแจ้งหนี้ Stripe':entry.type} · {entry.type==='RECORD_SUPPORT_OUTCOME'?({PREVIEW:'รอยืนยัน',SUCCEEDED:'บันทึกแล้ว',CANCELLED:'ยกเลิกฉบับตรวจสอบ'}[entry.state]??entry.state):entry.type==='SCAN_PROVIDER_INVOICES'?({QUEUED:'รอตรวจต่อ',RUNNING:'กำลังตรวจ',SUCCEEDED:'ตรวจครบช่วงที่เลือก',UNKNOWN:'ต้องตรวจสอบก่อนทำต่อ',BLOCKED:'ติดเงื่อนไข',CANCELLED:'ยกเลิกแล้ว'}[entry.state]??entry.state):entry.state}</p><p>บันทึก {time(entry.recordedAt)}{entry.origin?` · ${entry.origin}`:''}</p>
      {entry.occurredAt&&<p>เกิดเหตุ {time(entry.occurredAt)}</p>}{entry.observedAt&&<p>ตรวจผล/รับผล {time(entry.observedAt)}</p>}
      {entry.updatedAt&&<p>อัปเดตรายการ {time(entry.updatedAt)}</p>}
      {entry.amountSatang!==null&&<p>{new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(entry.amountSatang/100)}</p>}
      <p className="break-all text-sm">อ้างอิง {entry.reference}</p>{entry.href&&<Link href={entry.href} className="inline-block underline">เปิดรายการที่เกี่ยวข้อง</Link>}
    </article>)}
    {timeline?.items.length===0&&<p>ยังไม่มีประวัติการชำระเงินในโหมดนี้</p>}
    {timeline&&!timeline.auditIncluded&&<p className="text-sm">ขอบเขตนี้ไม่รวมบันทึก audit</p>}
    <div className="flex flex-wrap gap-3">
      <button className="rounded-lg border px-4 py-2" onClick={()=>setReload(v=>v+1)}>โหลดประวัติล่าสุด</button>
      {timeline?.nextCursor&&<button className="rounded-lg border px-4 py-2" onClick={()=>setCursor(timeline.nextCursor!)}>ประวัติหน้าถัดไป</button>}
      {cursor&&<button className="rounded-lg border px-4 py-2" onClick={()=>setCursor('')}>ประวัติหน้าแรก</button>}
    </div>
  </section>;
}
