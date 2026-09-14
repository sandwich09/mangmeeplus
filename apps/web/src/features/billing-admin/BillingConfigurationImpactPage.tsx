'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BILLING_CONFIGURATION_IMPACT_KINDS, type BillingConfigurationImpactKind, type BillingConfigurationImpactPage as ImpactPage } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';

const labels: Record<BillingConfigurationImpactKind,string> = { SUBSCRIPTION:'สมาชิกเดิม',ATTEMPT:'รายการชำระที่กำลังดำเนินการ',QUOTE:'ใบเสนอราคาที่ยังไม่ใช้',PLAN_CHANGE:'คำสั่งลดแพ็กเกจ',COLLECTION:'คำสั่งต่ออายุที่ยังดำเนินการ' };
const button='inline-block rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50';

export default function BillingConfigurationImpactPage({operationId}:{operationId:string}) {
  const [selection,setSelection]=useState<{kind:BillingConfigurationImpactKind;cursor?:string;sourceHash?:string}>({kind:'SUBSCRIPTION'});
  const [data,setData]=useState<ImpactPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{let active=true;setLoading(true);setData(null);setError('');
    const query=new URLSearchParams(selection);
    authedApiFetch<ImpactPage>(`/system/billing/configuration-changes/${encodeURIComponent(operationId)}/affected?${query}`,{cache:'no-store',suppressErrorToast:true})
      .then(result=>{if(active)setData(result);}).catch(cause=>{if(active)setError(apiErrorMessage(cause));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[operationId,selection,reload]);
  return <main className="mx-auto max-w-5xl space-y-5 break-words p-4 sm:p-8">
    <h1 className="text-2xl font-bold">รายการที่ต้องตรวจประกอบการตั้งค่า</h1>
    <Link className={button} href={`/system/billing/configuration-changes/${encodeURIComponent(operationId)}`}>กลับคำขอการตั้งค่าเดิม</Link>
    <p>ตรวจรายการปัจจุบันเทียบกับตอนตรวจผลกระทบ การเปลี่ยนการตั้งค่าสำหรับรายการใหม่ไม่แก้สัญญาที่จ่ายแล้ว</p>
    <label className="block" htmlFor="billing-impact-kind">ประเภทที่ต้องตรวจ</label>
    <select id="billing-impact-kind" className="w-full rounded-xl border p-3" value={selection.kind} onChange={e=>setSelection({kind:e.target.value as BillingConfigurationImpactKind})}>
      {BILLING_CONFIGURATION_IMPACT_KINDS.map(kind=><option key={kind} value={kind}>{labels[kind]}</option>)}
    </select>
    <button className={button} disabled={loading} onClick={()=>{setSelection({kind:selection.kind});setReload(n=>n+1);}}>โหลดรายการใหม่จากหน้าแรก</button>
    {loading&&<p role="status">กำลังโหลดรายการที่เกี่ยวข้อง…</p>}{error&&<p role="alert">{error}</p>}
    {data&&<>
      <p role={data.matchesPreview?'status':'alert'}>{data.matchesPreview?'รายการยังตรงกับฉบับที่ตรวจผลกระทบ':'รายการเปลี่ยนหรือคำขอเดิมไม่มีหลักฐานรายชื่อ กลับคำขอเดิมแล้วสร้างฉบับร่างเพื่อตรวจผลกระทบใหม่ก่อนอนุมัติ'}</p>
      <p className="text-sm">ตรวจล่าสุด {new Date(data.observedAt).toLocaleString('th-TH')}</p>
      <section aria-label="รายการผลกระทบ" className="space-y-3">{data.items.map(item=><article key={item.reference} className="space-y-2 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">{item.companyName}</h2><p>{labels[item.kind]} · {item.state}</p>
        <p className="break-all text-sm">เลขรายการ {item.recordId}</p>
        {item.boundary&&<p>{item.kind==='QUOTE'?'ใช้ใบเสนอราคาได้ถึง':'สิ้นช่วงที่จ่ายแล้ว'} {new Date(item.boundary).toLocaleString('th-TH')}</p>}
        {item.nextChargeAt&&<p>เรียกเก็บครั้งถัดไป {new Date(item.nextChargeAt).toLocaleString('th-TH')}</p>}
        <Link className="underline" href={`/system/billing/companies/${encodeURIComponent(item.companyId)}`}>ดูบริษัท {item.companyName}</Link>
      </article>)}{!data.items.length&&<p>ไม่มีรายการประเภทนี้ในหน้านี้</p>}</section>
      {data.nextCursor&&<button className={button} onClick={()=>setSelection({kind:selection.kind,cursor:data.nextCursor!,sourceHash:data.sourceHash})}>รายการผลกระทบหน้าถัดไป</button>}
    </>}
  </main>;
}
