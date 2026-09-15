'use client';
import {useEffect,useRef,useState} from 'react';
import {PLAN_TIER_PRESETS,type PlanTierKey,type PartnerPlanAdjustmentField,type PartnerPlanAdjustmentHistory as History} from '@watchdog-bms/contracts';
import {apiErrorMessage} from '@/common/api/api-error-message';
import {formatThaiDateTime} from '@/common/i18n/thai-date';
import {getPartnerPlanAdjustments} from './system-partners.api';

const labels:Record<PartnerPlanAdjustmentField,string>={tierKey:'แพ็กเกจ',branchLimit:'สาขา',employeeLimit:'ผู้ใช้',monthlySlipLimit:'ใบเสร็จต่อเดือน',warningDays:'วันแจ้งเตือนล่วงหน้า',termStartAt:'เริ่มใช้งาน',termEndsAt:'ครบกำหนด'};
function value(field:PartnerPlanAdjustmentField,v:string|number|null):string {
  if(v===null)return 'ไม่ระบุ';
  if((field==='termStartAt'||field==='termEndsAt')&&typeof v==='string'&&Number.isFinite(Date.parse(v)))return formatThaiDateTime(v);
  if(field==='tierKey'&&typeof v==='string')return PLAN_TIER_PRESETS[v as PlanTierKey]?.labelTh??'แพ็กเกจเดิม';
  return typeof v==='number'?v.toLocaleString('th-TH'):v;
}
export default function PartnerPlanAdjustmentHistory({companyId}:{companyId:string}) {
  const [history,setHistory]=useState<History|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const [pages,setPages]=useState<Array<string|undefined>>([undefined]);const cursor=pages[pages.length-1];
  const generation=useRef(0);
  const invalidate=()=>{generation.current++;setHistory(null);setError('');};
  useEffect(()=>{const token=++generation.current;setHistory(null);setError('');
    getPartnerPlanAdjustments(companyId,cursor).then(result=>{if(token===generation.current)setHistory(result);})
      .catch(e=>{if(token===generation.current)setError(e?.status===403?'คุณไม่มีสิทธิ์ดูประวัติการปรับแพ็กเกจและวันใช้งาน':apiErrorMessage(e));});
    return ()=>{generation.current++;};
  },[companyId,cursor,reload]);
  return <section aria-label="ประวัติการปรับแพ็กเกจและวันใช้งาน" className="scroll-mt-40 space-y-4 rounded-xl border border-gray-200 bg-white p-4 text-base">
    <h2 className="font-semibold">ประวัติการปรับแพ็กเกจและวันใช้งาน</h2>
    <p className="text-gray-600">ดูผู้แก้ เหตุผล และค่าก่อน–หลัง รายการเดิมยังเก็บไว้เมื่อมีการแก้อีกครั้ง</p>
    <button type="button" className="mangmee-btn mangmee-btn-secondary min-h-11" onClick={()=>{invalidate();setPages([undefined]);setReload(n=>n+1);}}>โหลดประวัติล่าสุด</button>
    {error?<p role="alert" className="text-red-700">{error}</p>:!history?<p role="status">กำลังโหลดประวัติ…</p>:<>
      {history.items.length===0?<p>ยังไม่มีประวัติการปรับแพ็กเกจและวันใช้งาน</p>:<ol className="space-y-4">{history.items.map(item=><li key={item.id} data-adjustment-id={item.id} className="space-y-2 rounded-lg border border-gray-200 p-3 break-words">
        <p className="font-medium">{item.source==='LINE_PACKAGE_REQUEST'?'ตามคำขอจาก LINE':item.source==='SYSTEM_PARTNER_ADMIN'?'ผู้ดูแลปรับให้':'รายการเดิมโดยผู้ดูแล'} · {item.actorName??'ไม่ระบุชื่อผู้แก้'}</p>
        <p className="text-gray-600">{formatThaiDateTime(item.recordedAt)}</p>
        <p>{item.kind==='RENEW'?'ต่ออายุการใช้งาน':'ปรับแพ็กเกจ'}</p>
        <p className="whitespace-pre-wrap">เหตุผล: {item.reason??'รายการเดิมไม่ได้บันทึกเหตุผล'}</p>
        {item.changes.length?item.changes.map(change=><p key={change.field}>{labels[change.field]}: {value(change.field,change.before)} → {value(change.field,change.after)}</p>):<p>รายละเอียดค่าเดิมไม่ครบ</p>}
        <details className="text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-3">ข้อมูลอ้างอิง</summary><p>รายการ {item.id}</p><p>ผู้แก้ {item.actorId??'ไม่ระบุ'}</p></details>
      </li>)}</ol>}
      <div className="flex flex-wrap gap-2"><button type="button" className="mangmee-btn mangmee-btn-secondary min-h-11" disabled={pages.length<2} onClick={()=>{invalidate();setPages(p=>p.slice(0,-1));}}>หน้าก่อน</button>
        <button type="button" className="mangmee-btn mangmee-btn-secondary min-h-11" disabled={!history.nextCursor} onClick={()=>{if(history.nextCursor){const next=history.nextCursor;invalidate();setPages(p=>[...p,next]);}}}>หน้าถัดไป</button></div>
    </>}
  </section>;
}
