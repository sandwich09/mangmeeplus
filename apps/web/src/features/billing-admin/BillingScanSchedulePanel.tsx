'use client';
import { billingField, billingControl, billingLabel } from '../billing/billing-display';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import Link from 'next/link';
import { useRouter,useSearchParams } from 'next/navigation';
import { useEffect,useRef,useState } from 'react';
import type { BillingScanSchedule,BillingScanScheduleOperation } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';
const base='/system/billing/provider-scans',button=billingControl;
const field=billingField,time=(value:string|null)=>value?formatThaiDateTime(value):'ยังไม่มี';
const states={PREVIEW:'รอยืนยันการตั้งค่า',SUCCEEDED:'เผยแพร่การตั้งค่าแล้ว',CANCELLED:'ยกเลิกฉบับตั้งค่าแล้ว'};
const api=<T,>(path:string,body?:unknown,key?:string)=>authedApiFetch<T>(`${base}/schedule${path}`,{cache:'no-store',suppressErrorToast:true,
  ...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)})});
export function BillingScanSchedulePanel() {
  const router=useRouter(),selected=useSearchParams().get('schedule');
  const [schedule,setSchedule]=useState<BillingScanSchedule|null>(null),[record,setRecord]=useState<BillingScanScheduleOperation|null>(null);
  const [history,setHistory]=useState<{items:BillingScanScheduleOperation[];nextCursor:string|null}|null>(null),[cursor,setCursor]=useState<string|null>(null);
  const [enabled,setEnabled]=useState(false),[interval,setInterval]=useState(24),[lookback,setLookback]=useState(48),[reason,setReason]=useState(''),[password,setPassword]=useState('');
  const [reload,setReload]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),initialized=useRef(false),intent=useRef<{body:string;key:string}|null>(null);
  useEffect(()=>{
    let active=true;setRecord(null);
    void Promise.all([api<BillingScanSchedule>(''),api<{items:BillingScanScheduleOperation[];nextCursor:string|null}>(`/history${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`),
      selected?api<BillingScanScheduleOperation>(`/operations/${encodeURIComponent(selected)}`):null]).then(([current,items,chosen])=>{
      if(!active)return;setSchedule(current);setHistory(items);setRecord(chosen);
      if(!initialized.current){setEnabled(current.enabled);setInterval(current.intervalHours);setLookback(current.initialLookbackHours);initialized.current=true;}
    }).catch(error=>{if(active)setError(apiErrorMessage(error));});return()=>{active=false;};
  },[selected,cursor,reload]);
  async function act(action:'preview'|'publish'|'cancel') {
    if(busy||!schedule)return;setBusy(true);setError('');
    try{
      let result:BillingScanScheduleOperation;
      if(action==='preview'){
        const body={enabled,intervalHours:interval,initialLookbackHours:lookback,reason:reason.trim(),expectedVersion:schedule.revision},encoded=JSON.stringify(body);
        if(intent.current?.body!==encoded)intent.current={body:encoded,key:crypto.randomUUID()};
        result=await api<BillingScanScheduleOperation>('/preview',body,intent.current.key);
      }else{
        if(action==='publish'&&password)await authedApiFetch('/system/billing/reauthenticate',{method:'POST',body:JSON.stringify({password}),suppressErrorToast:true});
        setPassword('');
        result=await api<BillingScanScheduleOperation>(`/operations/${record!.id}/${action}`,{expectedVersion:record!.version,previewHash:record!.previewHash});
      }
      setRecord(result);router.replace(`${base}?schedule=${result.id}`,{scroll:false});setReload(v=>v+1);
    }catch(error){setError(apiErrorMessage(error));}finally{setPassword('');setBusy(false);}
  }
  return <section aria-label="การตรวจ Stripe ตามรอบ" className="space-y-4 rounded-xl border border-gray-200 p-4 bg-white">
    <h2 className="text-lg font-bold">ตรวจรายการที่ตกหล่นตามรอบ</h2>
    <p>เปิดเพื่อตรวจเหตุการณ์ใหม่ต่อจากรอบที่เสร็จแล้ว ระบบจะหยุดรอให้งานเดิมกู้คืนหรือยกเลิกก่อนเริ่มรอบใหม่ ประวัติใบแจ้งหนี้ที่เก่ากว่าช่วงค้นหายังต้องตรวจแยก</p>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {!schedule?<p role="status">{error?'ยังโหลดการตั้งค่าไม่ได้':'กำลังโหลดการตั้งค่า…'}</p>:<>
      <p>{billingLabel('mode',schedule.mode)} · การตั้งค่ารุ่น {schedule.revision} · {schedule.enabled?'เปิดตรวจตามรอบ':'ปิดตรวจตามรอบ'}</p>
      <p>{schedule.ownerUserId?'มีผู้รับผิดชอบรอบตรวจแล้ว':'ยังไม่ได้กำหนดผู้รับผิดชอบ'}</p>{schedule.ownerUserId&&<details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงผู้รับผิดชอบ</summary><p className="break-all">{schedule.ownerUserId}</p></details>}
      <p>กำหนดรอบถัดไป {time(schedule.nextDueAt)} · ตรวจครบล่าสุดถึง {time(schedule.lastCompletedWindowEnd)}</p>
      {schedule.blockedReason&&<p role="status">{schedule.blockedReason==='CONTROL_SCAN_PENDING'?'มีงานเดิมยังไม่จบ เปิดงานเดิมเพื่อดูผล กู้คืน หรือยกเลิกก่อน':schedule.blockedReason==='CONTROL_PERMISSION_CHANGED'?'ผู้รับผิดชอบไม่มีสิทธิ์ปัจจุบัน ให้ผู้ดูแลที่มีสิทธิ์ตรวจและเผยแพร่การตั้งค่าใหม่':schedule.blockedReason==='BILLING_NOT_CONFIGURED'?'ยังไม่พร้อมเชื่อมต่อ Stripe':'ค่าที่บันทึกไม่สมบูรณ์ ให้ตรวจและเผยแพร่การตั้งค่าใหม่'}</p>}
      {schedule.lastRun&&<Link className="block underline" href={`${base}/${schedule.lastRun.id}`}>เปิดงานตรวจอัตโนมัติล่าสุด</Link>}
      {schedule.canManage&&<form className="space-y-3" onSubmit={event=>{event.preventDefault();void act('preview');}}>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>เปิดการตรวจตามรอบ</label>
        <label className="block" htmlFor="scan-interval">ตรวจทุกกี่ชั่วโมง (1–168)</label><input id="scan-interval" className={field} type="number" required min={1} max={168} value={interval} onChange={e=>setInterval(Number(e.target.value))}/>
        <label className="block" htmlFor="scan-lookback">ครั้งแรกตรวจย้อนหลังกี่ชั่วโมง (1–672)</label><input id="scan-lookback" className={field} type="number" required min={1} max={672} value={lookback} onChange={e=>setLookback(Number(e.target.value))}/>
        <label className="block" htmlFor="scan-schedule-reason">เหตุผลปรับรอบตรวจ</label><textarea id="scan-schedule-reason" className={field} required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/>
        <p>รอบต่อไปใช้ช่วงที่ตรวจสำเร็จล่าสุดและตรวจซ้ำขอบช่วง 5 นาที การปิดหยุดเฉพาะงานใหม่ งานเดิมยังเปิดตรวจต่อได้</p>
        <button className={button} disabled={busy} aria-busy={Boolean(busy)}>ตรวจการตั้งค่าก่อนยืนยัน</button>
      </form>}
    </>}
    {record&&<article aria-label="ฉบับตั้งค่าที่เลือก" className="space-y-3 rounded-lg bg-gray-50 p-3">
      <h3 role="status" className="font-semibold">{states[record.state]}</h3><p>{billingLabel('mode',record.mode)} · อ้างอิงรุ่น {record.sourceRevision}</p>
      <p>{record.enabled?'เปิด':'ปิด'} · ทุก {record.intervalHours} ชั่วโมง · ครั้งแรกย้อนหลัง {record.initialLookbackHours} ชั่วโมง</p>
      <p className="whitespace-pre-wrap">{record.reason}</p><p>ยืนยันได้ถึง {time(record.expiresAt)}</p>
      {record.state==='PREVIEW'&&!record.canPublish&&<p>ข้อมูลหรือสิทธิ์เปลี่ยน หรือหมดเวลายืนยันแล้ว นำค่ามาตรวจใหม่ได้</p>}
      {record.canPublish&&<><label htmlFor="scan-schedule-password">รหัสผ่านปัจจุบันเพื่อเผยแพร่</label><input id="scan-schedule-password" className={field} type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></>}
      <div className="flex flex-wrap gap-2">
        {record.canPublish&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act('publish')}>ยืนยันเผยแพร่รอบตรวจ</button>}
        {record.canCancel&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act('cancel')}>ยกเลิกฉบับตั้งค่า</button>}
        {schedule?.canManage&&<button className={button} disabled={busy} onClick={()=>{setEnabled(record.enabled);setInterval(record.intervalHours);setLookback(record.initialLookbackHours);setReason(record.reason);intent.current=null;setReload(v=>v+1);}}>นำค่ามาตรวจใหม่</button>}
        <Link className="underline" href={`${base}?schedule=${record.id}`}>ลิงก์ฉบับตั้งค่านี้</Link><Link className="underline" href={base}>กลับประวัติรอบตรวจ</Link>
      </div>
    </article>}
    {selected&&!record&&<Link className="block underline" href={base}>กลับประวัติรอบตรวจ</Link>}
    {history&&<div aria-label="ประวัติการตั้งค่ารอบตรวจ" className="space-y-2">{history.items.map(row=><Link key={row.id} className="block underline" href={`${base}?schedule=${row.id}`}>{states[row.state]} · {row.reason} · {time(row.publishedAt??row.createdAt)}</Link>)}
      {!history.items.length&&<p>ยังไม่มีประวัติการตั้งค่ารอบตรวจ</p>}</div>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>{setError('');setReload(v=>v+1);}}>โหลดรอบตรวจล่าสุด</button>
      {history?.nextCursor&&<button className={button} disabled={busy} onClick={()=>setCursor(history.nextCursor)}>การตั้งค่าหน้าถัดไป</button>}
      {cursor&&<button className={button} disabled={busy} onClick={()=>setCursor(null)}>การตั้งค่าหน้าแรก</button>}</div>
  </section>;
}
