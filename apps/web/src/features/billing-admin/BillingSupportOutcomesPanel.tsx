'use client';
import { billingControl, billingLabel } from '../billing/billing-display';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { BillingOperatorIssue, BillingSupportOutcome, BillingSupportOutcomeKind } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
const button=billingControl;
const kinds:Record<BillingSupportOutcomeKind,string>={CUSTOMER_CONTACTED:'ติดต่อลูกค้าแล้ว',PROVIDER_CONTACTED:'ติดต่อผู้ให้บริการแล้ว',REPLY_RECORDED:'ได้รับคำตอบแล้ว',REVIEW_REQUESTED:'ขอให้ตรวจสอบเพิ่มเติม'};
const statuses={PREVIEW:'รอยืนยันบันทึก',SUCCEEDED:'บันทึกผลติดต่อแล้ว',CANCELLED:'ยกเลิกฉบับตรวจสอบแล้ว'};
const api=<T,>(path:string,body?:unknown,key?:string)=>authedApiFetch<T>(`/system/billing/issues${path}`,{cache:'no-store',suppressErrorToast:true,
  ...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)})});
export default function BillingSupportOutcomesPanel({issue,canManage,onRecorded}:{issue:BillingOperatorIssue;canManage:boolean;onRecorded:()=>Promise<void>}) {
  const params=useSearchParams(),selected=params.get('outcome');
  const [note,setNote]=useState(''),[kind,setKind]=useState<BillingSupportOutcomeKind>('REVIEW_REQUESTED');
  const [record,setRecord]=useState<BillingSupportOutcome|null>(null),[list,setList]=useState<{items:BillingSupportOutcome[];nextCursor:string|null}|null>(null);
  const [cursor,setCursor]=useState<string|null>(null),[reload,setReload]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const generation=useRef(0),reads=useRef(0);
  useEffect(()=>()=>{generation.current++;reads.current++;},[issue.id]);
  const command=useRef<{key:string;body:string}|null>(null);
  useEffect(()=>{
    let active=true;const read=++reads.current;
    void Promise.all([api<{items:BillingSupportOutcome[];nextCursor:string|null}>(`/${issue.id}/outcomes${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`),
      selected?api<BillingSupportOutcome>(`/${issue.id}/outcomes/${encodeURIComponent(selected)}`):null]).then(([items,current])=>{if(active&&read===reads.current){setList(items);setRecord(previous=>previous&&current&&previous.id===current.id&&previous.version>current.version?previous:current);}})
      .catch(error=>{if(active&&read===reads.current){if([401,403,404].includes(error?.status)){setList(null);setRecord(null);}setError(apiErrorMessage(error));}});
    return()=>{active=false;};
  },[issue.id,issue.version,selected,cursor,reload]);
  function href(id?:string) {
    const next=new URLSearchParams(params.toString());
    if(id)next.set('outcome',id);else next.delete('outcome');
    return `/system/billing/issues/${issue.id}${next.size?`?${next}`:''}`;
  }
  const open=(id?:string)=>{setError('');window.history.replaceState(null,'',href(id));};
  const selectRecord=(event:React.MouseEvent<HTMLAnchorElement>,id?:string)=>{
    if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    event.preventDefault();if(!busy)open(id);
  };
  async function refresh() {
    if(busy)return;
    const token=generation.current;setBusy(true);setError('');
    try{await onRecorded();if(token===generation.current)setReload(value=>value+1);}
    finally{if(token===generation.current)setBusy(false);}
  }
  async function act(action:'preview'|'submit'|'cancel') {
    if(busy)return;const token=generation.current;++reads.current;setBusy(true);setError('');
    try{
      let result:BillingSupportOutcome;
      if(action==='preview'){
        const body={expectedVersion:issue.version,kind,note:note.trim()},encoded=JSON.stringify(body);
        if(command.current?.body!==encoded)command.current={key:crypto.randomUUID(),body:encoded};
        result=await api<BillingSupportOutcome>(`/${issue.id}/outcomes/preview`,body,command.current!.key);
      }else result=await api<BillingSupportOutcome>(`/${issue.id}/outcomes/${record!.id}/${action}`,{expectedVersion:record!.version,previewHash:record!.previewHash});
      if(token!==generation.current)return;
      if(result.state!=='PREVIEW')command.current=null;
      setRecord(result);open(result.id);setReload(v=>v+1);
      if(result.state==='SUCCEEDED')await onRecorded();
    }catch(error){if(token===generation.current){setError(apiErrorMessage(error));setReload(v=>v+1);}}
    finally{if(token===generation.current)setBusy(false);}
  }
  return <section className="space-y-4 pt-3" aria-label="ผลการติดต่อของเคส">
    <h2 className="text-lg font-semibold text-gray-900">ผลการติดต่อและขอตรวจสอบ</h2>
    <p className="text-gray-600">บันทึกสิ่งที่ติดต่อและงานที่ต้องทำต่อ การบันทึกนี้ไม่เปลี่ยนยอดเงิน สิทธิ์ลูกค้า หรือปิดปัญหา</p>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {canManage&&<div className="space-y-3"><label className="block" htmlFor="support-outcome-kind">ประเภทผลติดต่อ</label><ThemedSelect id="support-outcome-kind" aria-label="ประเภทผลติดต่อ" disabled={busy} className="mangmee-input mt-2 min-h-11 w-full !text-base" value={kind} onChange={e=>setKind(e.target.value as BillingSupportOutcomeKind)}>
      {Object.entries(kinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</ThemedSelect>
      <label className="block" htmlFor="support-outcome-note">รายละเอียดผลติดต่อ</label><textarea id="support-outcome-note" className="mangmee-input mt-2 block min-h-28 w-full !text-base" value={note} maxLength={1000} onChange={e=>setNote(e.target.value)}/>
      <p className="text-base text-gray-600">ระบุข้อเท็จจริงและงานที่ต้องติดตามต่อ หลีกเลี่ยงรหัสผ่าน ข้อมูลบัตร และข้อมูลลับ</p>
      <button className={button} disabled={busy||!note.trim()} aria-busy={Boolean(busy)} onClick={()=>void act('preview')}>ตรวจบันทึกก่อนยืนยัน</button></div>}
    {record&&record.id===selected&&<article className="space-y-3 rounded-xl bg-gray-50 p-4" aria-label="บันทึกผลติดต่อที่เลือก">
      <h3 role="status" className="font-bold">{statuses[record.state]}</h3>
      <p>{billingLabel('mode',record.mode)} · รอบปัญหา {record.episode} · {kinds[record.kind]}</p><p className="whitespace-pre-wrap break-words">{record.note}</p>
      <p>บันทึก {new Date(record.recordedAt??record.createdAt).toLocaleString('th-TH')}</p><details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงผู้บันทึก</summary><p className="break-all">ผู้บันทึก {record.actorUserId}</p></details>
      {record.state==='PREVIEW'&&!record.canSubmit&&<p>ข้อมูลหรือสิทธิ์เปลี่ยน หรือหมดเวลาตรวจสอบแล้ว โหลดเคสล่าสุดและนำข้อความนี้ไปตรวจใหม่</p>}
      <div className="flex flex-wrap gap-2">
        {canManage&&record.canSubmit&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act('submit')}>ยืนยันบันทึกผลติดต่อ</button>}
        {canManage&&record.canCancel&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act('cancel')}>ยกเลิกฉบับตรวจสอบ</button>}
        {canManage&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>{setNote(record.note);setKind(record.kind);command.current=null;void refresh();}}>นำข้อความมาตรวจใหม่</button>}
        <Link className="inline-flex min-h-11 items-center text-brand-800 underline" onClick={e=>selectRecord(e,record.id)} href={href(record.id)}>ลิงก์บันทึกนี้</Link>
        <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>open()}>ปิดบันทึกที่เลือก</button>
      </div>
    </article>}
    {selected&&!record&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>open()}>กลับไปประวัติของเคส</button>}
    {!list?<p role="status">{error?'ยังโหลดประวัติไม่ได้ ใช้ปุ่มโหลดล่าสุดเพื่อลองใหม่':'กำลังโหลดประวัติผลติดต่อ…'}</p>:list.items.length===0?<p>ยังไม่มีบันทึกผลติดต่อ</p>:<div className="space-y-3" aria-label="ประวัติผลติดต่อ">{list.items.map(item=><p key={item.id}>
      <Link className="inline-flex min-h-11 items-center break-words text-brand-800 underline" onClick={e=>selectRecord(e,item.id)} href={href(item.id)}>{statuses[item.state]} · {kinds[item.kind]} · {new Date(item.recordedAt??item.createdAt).toLocaleString('th-TH')}</Link></p>)}</div>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void refresh()}>โหลดประวัติผลติดต่อล่าสุด</button>
      {list?.nextCursor&&<button className={button} disabled={busy} onClick={()=>setCursor(list.nextCursor)}>ผลติดต่อหน้าถัดไป</button>}
      {cursor&&<button className={button} disabled={busy} onClick={()=>setCursor(null)}>ผลติดต่อหน้าแรก</button>}</div>
  </section>;
}
