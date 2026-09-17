'use client';
import {useEffect,useRef,useState} from 'react';
import type {PartnerAiAdjustmentField,PartnerAiAdjustmentHistory as History} from '@watchdog-bms/contracts';
import {apiErrorMessage} from '@/common/api/api-error-message';
import {formatThaiDateTime} from '@/common/i18n/thai-date';
import {getPartnerAiAdjustments} from './system-partners.api';

const labels:Record<PartnerAiAdjustmentField,string>={modelId:'รุ่น AI',monthlyBudgetSatang:'งบ AI ต่อเดือน',enabled:'การอ่านเอกสารด้วย AI',monthlyLimit:'จำนวนครั้งอ่านเอกสารต่อเดือน',receiptQuotaEnforced:'การจำกัดใบเสร็จตามแพ็กเกจ',
  budgetMode:'โหมดงบ AI',chatMonthlyBudgetSatang:'เพดานแชต AI ต่อเดือน',ocrMonthlyBudgetSatang:'เพดานอ่านเอกสารต่อเดือน',budgetConfigVersion:'เวอร์ชันการตั้งค่างบ',pendingBudgetPolicy:'งบที่ตั้งให้เริ่มเดือนถัดไป'};
const SATANG_FIELDS=new Set<PartnerAiAdjustmentField>(['monthlyBudgetSatang','chatMonthlyBudgetSatang','ocrMonthlyBudgetSatang']);
const baht=(v:number)=>`${(v/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท`;
/** The audit stores a scheduled policy as the scalar `<mode>:<chat>:<ocr>:<YYYY-MM>` (spec §12.4). */
function pendingText(v:string):string {
  const [mode,chat,ocr,month]=v.split(':');
  if(!month)return v;
  return mode==='SPLIT'?`แยกเพดาน แชต ${baht(Number(chat))} / อ่านเอกสาร ${baht(Number(ocr))} เริ่ม ${month}`:`งบรวมก้อนเดียว เริ่ม ${month}`;
}
function value(field:PartnerAiAdjustmentField,v:string|number|boolean|null):string {
  if(v===null)return field==='monthlyLimit'?'ไม่จำกัด'
    :field==='pendingBudgetPolicy'?'ไม่มี'
    // A split cap is never "inherit": null means the operator has not allocated it (spec §12.1).
    :field==='chatMonthlyBudgetSatang'||field==='ocrMonthlyBudgetSatang'?'ยังไม่ตั้ง'
    :'ใช้ค่าเริ่มต้นของระบบ';
  if(field==='budgetMode')return v==='SPLIT'?'แยกเพดานแชตกับอ่านเอกสาร':'งบรวมก้อนเดียว';
  if(field==='pendingBudgetPolicy'&&typeof v==='string')return pendingText(v);
  if(SATANG_FIELDS.has(field)&&typeof v==='number')return baht(v);
  if(typeof v==='boolean')return field==='receiptQuotaEnforced'?(v?'บังคับโควตา':'นับอย่างเดียว'):(v?'เปิด':'ปิด');
  return typeof v==='number'?v.toLocaleString('th-TH'):v;
}
export default function PartnerAiAdjustmentHistory({companyId}:{companyId:string}) {
  const [history,setHistory]=useState<History|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const [pages,setPages]=useState<Array<string|undefined>>([undefined]);const cursor=pages[pages.length-1];
  const generation=useRef(0);
  const invalidate=()=>{generation.current++;setHistory(null);setError('');};
  useEffect(()=>{const token=++generation.current;setHistory(null);setError('');
    getPartnerAiAdjustments(companyId,cursor).then(result=>{if(token===generation.current)setHistory(result);})
      .catch(e=>{if(token===generation.current)setError(e?.status===403?'คุณไม่มีสิทธิ์ดูประวัติการปรับ AI':apiErrorMessage(e));});
    return ()=>{generation.current++;};
  },[companyId,cursor,reload]);
  return <section aria-label="ประวัติการปรับ AI" className="scroll-mt-40 space-y-4 rounded-xl border border-gray-200 bg-white p-4 text-base">
    <h2 className="font-semibold">ประวัติการปรับ AI</h2>
    <p className="text-gray-600">ดูผู้แก้ เหตุผล และค่าก่อน–หลัง รายการเดิมยังเก็บไว้เมื่อมีการแก้อีกครั้ง</p>
    <button type="button" className="mangmee-btn mangmee-btn-secondary min-h-11" onClick={()=>{invalidate();setPages([undefined]);setReload(n=>n+1);}}>โหลดประวัติล่าสุด</button>
    {error?<p role="alert" className="text-red-700">{error}</p>:!history?<p role="status">กำลังโหลดประวัติ…</p>:<>
      {history.items.length===0?<p>ยังไม่มีประวัติการปรับ AI</p>:<ol className="space-y-4">{history.items.map(item=><li key={item.id} data-adjustment-id={item.id} className="space-y-2 rounded-lg border border-gray-200 p-3 break-words">
        <p className="font-medium">{item.source==='ADMIN_ADJUSTMENT'?'ผู้ดูแลปรับให้':'รายการเดิมโดยผู้ดูแล'} · {item.actorName??'ไม่ระบุชื่อผู้แก้'}</p>
        <p className="text-gray-600">{formatThaiDateTime(item.recordedAt)}</p>
        <p className="whitespace-pre-wrap">เหตุผล: {item.reason??'รายการเดิมไม่ได้บันทึกเหตุผล'}</p>
        {item.changes.length?item.changes.map(change=><p key={change.field}>{labels[change.field]}: {value(change.field,change.before)} → {value(change.field,change.after)}</p>):<p>รายละเอียดค่าเดิมไม่ครบ</p>}
        <details className="text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-3">ข้อมูลอ้างอิง</summary><p>รายการ {item.id}</p><p>ผู้แก้ {item.actorId??'ไม่ระบุ'}</p></details>
      </li>)}</ol>}
      <div className="flex flex-wrap gap-2"><button type="button" className="mangmee-btn mangmee-btn-secondary min-h-11" disabled={pages.length<2} onClick={()=>{invalidate();setPages(p=>p.slice(0,-1));}}>หน้าก่อน</button>
        <button type="button" className="mangmee-btn mangmee-btn-secondary min-h-11" disabled={!history.nextCursor} onClick={()=>{if(history.nextCursor){const next=history.nextCursor;invalidate();setPages(p=>[...p,next]);}}}>หน้าถัดไป</button></div>
    </>}
  </section>;
}
