'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { BillingOperatorIssue, BillingSupportOutcome, BillingSupportOutcomeKind } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';
const button='rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-50';
const kinds:Record<BillingSupportOutcomeKind,string>={CUSTOMER_CONTACTED:'ติดต่อลูกค้าแล้ว',PROVIDER_CONTACTED:'ติดต่อผู้ให้บริการแล้ว',REPLY_RECORDED:'ได้รับคำตอบแล้ว',REVIEW_REQUESTED:'ขอให้ตรวจสอบเพิ่มเติม'};
const statuses={PREVIEW:'รอยืนยันบันทึก',SUCCEEDED:'บันทึกผลติดต่อแล้ว',CANCELLED:'ยกเลิกฉบับตรวจสอบแล้ว'};
const api=<T,>(path:string,body?:unknown,key?:string)=>authedApiFetch<T>(`/system/billing/issues${path}`,{cache:'no-store',suppressErrorToast:true,
  ...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)})});
export default function BillingSupportOutcomesPanel({issue,canManage,onRecorded}:{issue:BillingOperatorIssue;canManage:boolean;onRecorded:()=>void}) {
  const router=useRouter(),params=useSearchParams(),selected=params.get('outcome');
  const [note,setNote]=useState(''),[kind,setKind]=useState<BillingSupportOutcomeKind>('REVIEW_REQUESTED');
  const [record,setRecord]=useState<BillingSupportOutcome|null>(null),[list,setList]=useState<{items:BillingSupportOutcome[];nextCursor:string|null}|null>(null);
  const [cursor,setCursor]=useState<string|null>(null),[reload,setReload]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const command=useRef<{key:string;body:string}|null>(null);
  useEffect(()=>{
    let active=true;setList(null);setRecord(null);
    void Promise.all([api<{items:BillingSupportOutcome[];nextCursor:string|null}>(`/${issue.id}/outcomes${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`),
      selected?api<BillingSupportOutcome>(`/${issue.id}/outcomes/${encodeURIComponent(selected)}`):null]).then(([items,current])=>{if(active){setList(items);setRecord(current);}})
      .catch(error=>{if(active)setError(apiErrorMessage(error));});
    return()=>{active=false;};
  },[issue.id,issue.version,selected,cursor,reload]);
  const open=(id:string)=>router.replace(`/system/billing/issues/${issue.id}?outcome=${encodeURIComponent(id)}`,{scroll:false});
  async function act(action:'preview'|'submit'|'cancel') {
    if(busy)return;setBusy(true);setError('');
    try{
      let result:BillingSupportOutcome;
      if(action==='preview'){
        const body={expectedVersion:issue.version,kind,note:note.trim()},encoded=JSON.stringify(body);
        if(command.current?.body!==encoded)command.current={key:crypto.randomUUID(),body:encoded};
        result=await api<BillingSupportOutcome>(`/${issue.id}/outcomes/preview`,body,command.current!.key);
      }else result=await api<BillingSupportOutcome>(`/${issue.id}/outcomes/${record!.id}/${action}`,{expectedVersion:record!.version,previewHash:record!.previewHash});
      setRecord(result);open(result.id);setReload(v=>v+1);
      if(result.state==='SUCCEEDED')onRecorded();
    }catch(error){setError(apiErrorMessage(error));}
    finally{setBusy(false);}
  }
  return <section className="space-y-4 rounded-xl border bg-white p-4" aria-label="ผลการติดต่อของเคส">
    <h2 className="text-lg font-bold">ผลการติดต่อและขอตรวจสอบ</h2>
    <p className="text-sm">บันทึกคำตอบและงานติดตามของเคสนี้ ผลติดต่อยังไม่ใช่หลักฐานว่าจ่ายสำเร็จ และไม่เปลี่ยนสิทธิ์แพ็กเกจหรือปิดเคส</p>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {canManage&&<div className="space-y-3"><label className="block" htmlFor="support-outcome-kind">ประเภทผลติดต่อ</label><select id="support-outcome-kind" className="mt-2 block w-full rounded-lg border p-3" value={kind} onChange={e=>setKind(e.target.value as BillingSupportOutcomeKind)}>
      {Object.entries(kinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
      <label className="block" htmlFor="support-outcome-note">รายละเอียดผลติดต่อ</label><textarea id="support-outcome-note" className="mt-2 block w-full rounded-lg border p-3" value={note} maxLength={1000} onChange={e=>setNote(e.target.value)}/>
      <p className="text-xs text-gray-600">ระบุข้อเท็จจริงและงานที่ต้องติดตามต่อ หลีกเลี่ยงรหัสผ่าน ข้อมูลบัตร และข้อมูลลับ</p>
      <button className={button} disabled={busy||!note.trim()} onClick={()=>void act('preview')}>ตรวจบันทึกก่อนยืนยัน</button></div>}
    {record&&<article className="space-y-3 rounded-xl bg-gray-50 p-4" aria-label="บันทึกผลติดต่อที่เลือก">
      <h3 role="status" className="font-bold">{statuses[record.state]}</h3>
      <p>{record.mode} · รอบปัญหา {record.episode} · {kinds[record.kind]}</p><p className="whitespace-pre-wrap break-words">{record.note}</p>
      <p className="break-all text-sm">ผู้บันทึก {record.actorUserId} · {new Date(record.recordedAt??record.createdAt).toLocaleString('th-TH')}</p>
      {record.state==='PREVIEW'&&!record.canSubmit&&<p>ข้อมูลหรือสิทธิ์เปลี่ยน หรือหมดเวลาตรวจสอบแล้ว โหลดเคสล่าสุดและนำข้อความนี้ไปตรวจใหม่</p>}
      <div className="flex flex-wrap gap-2">
        {canManage&&record.canSubmit&&<button className={button} disabled={busy} onClick={()=>void act('submit')}>ยืนยันบันทึกผลติดต่อ</button>}
        {canManage&&record.canCancel&&<button className={button} disabled={busy} onClick={()=>void act('cancel')}>ยกเลิกฉบับตรวจสอบ</button>}
        {canManage&&<button className={button} disabled={busy} onClick={()=>{setNote(record.note);setKind(record.kind);command.current=null;onRecorded();}}>นำข้อความมาตรวจใหม่</button>}
        <Link className="underline" href={`/system/billing/issues/${issue.id}?outcome=${record.id}`}>ลิงก์บันทึกนี้</Link>
        <Link className="underline" href={`/system/billing/issues/${issue.id}`}>กลับไปเคสเดิม</Link>
      </div>
    </article>}
    {selected&&!record&&<Link className="inline-block underline" href={`/system/billing/issues/${issue.id}`}>กลับไปประวัติของเคส</Link>}
    {!list?<p role="status">{error?'ยังโหลดประวัติไม่ได้ ใช้ปุ่มโหลดล่าสุดเพื่อลองใหม่':'กำลังโหลดประวัติผลติดต่อ…'}</p>:list.items.length===0?<p>ยังไม่มีบันทึกผลติดต่อ</p>:<div className="space-y-3" aria-label="ประวัติผลติดต่อ">{list.items.map(item=><p key={item.id}>
      <Link className="break-words underline" href={`/system/billing/issues/${issue.id}?outcome=${item.id}`}>{statuses[item.state]} · {kinds[item.kind]} · {new Date(item.recordedAt??item.createdAt).toLocaleString('th-TH')}</Link></p>)}</div>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>{setError('');setReload(v=>v+1);onRecorded();}}>โหลดประวัติผลติดต่อล่าสุด</button>
      {list?.nextCursor&&<button className={button} disabled={busy} onClick={()=>setCursor(list.nextCursor)}>ผลติดต่อหน้าถัดไป</button>}
      {cursor&&<button className={button} disabled={busy} onClick={()=>setCursor(null)}>ผลติดต่อหน้าแรก</button>}</div>
  </section>;
}
