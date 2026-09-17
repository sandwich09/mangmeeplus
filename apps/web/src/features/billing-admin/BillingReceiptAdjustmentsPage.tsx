'use client';
import { billingField } from '../billing/billing-display';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {BillingReceiptAdjustments,BillingReceiptAdjustmentOperation,BillingReceiptAdjustmentInput} from '@watchdog-bms/contracts';
import {authedApiFetch} from '@/common/api/authed-fetch';
import {apiErrorCode,apiErrorMessage} from '@/common/api/api-error-message';
import {billingApprovalLabel, billingControl as button,billingMonthlyAllowanceText} from '@/features/billing/billing-display';

const field=billingField;
const date=(value:string)=>new Date(value).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
const state:Record<string,string>={PREVIEW:'ตรวจจำนวนก่อนส่งคำขอ',AWAITING_APPROVAL:'รอยืนยันรายการ',SUCCEEDED:'ปรับใบเสร็จแล้ว',CANCELLED:'ยกเลิกคำขอแล้ว'};
const api=<T,>(path:string,body?:unknown,key?:string)=>authedApiFetch<T>(`/system/billing${path}`,{cache:'no-store',suppressErrorToast:true,...body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...key?{'Idempotency-Key':key}:{}},body:JSON.stringify(body)}});
const errors:Record<string,string>={CONTROL_RECEIPT_TERM_REQUIRED:'ร้านนี้ยังไม่มีระยะใช้งานหรือหมดอายุแล้ว กลับไปตรวจและต่ออายุแพ็กเกจก่อน',CONTROL_PAID_RECEIPTS_REQUIRED:'หน้านี้เพิ่มใบเสร็จให้แพ็กเกจที่ชำระเงินและยังไม่หมดอายุ กรุณากลับไปดูสถานะแพ็กเกจ',CONTROL_COMPANY_HELD:'บริษัทนี้ถูกพักใช้งาน กรุณาตรวจสถานะบริษัทก่อน',CONTROL_OPERATION_IN_PROGRESS:'มีรายการเดิมกำลังดำเนินการ เปิดสถานะแพ็กเกจเพื่อตรวจให้เสร็จก่อน',CONTROL_PREVIEW_STALE:'ข้อมูลหรือวันหมดอายุเปลี่ยนแล้ว ยกเลิกคำขอเดิมและตรวจข้อมูลใหม่'};
const readWarnings={OCR_DISABLED:'ร้านนี้ปิดการอ่านเอกสารด้วย AI อยู่',OCR_LIMIT_REACHED:'ร้านนี้ใช้จำนวนครั้งอ่านเอกสารครบแล้ว',AI_BUDGET_REACHED:'ร้านนี้ใช้งบ AI ครบแล้ว',
  // Spec §11.4: the total still has money, but the share this shop allocated to reading documents
  // does not — so "ยังมีงบเหลือ" must not read as "อ่านใบเสร็จต่อได้". Neutral about the cause (used
  // up, or a cap of 0) and about the other shares, either of which may also be gone.
  AI_OCR_BUDGET_REACHED:'เดือนนี้ร้านนี้ไม่มีงบ AI สำหรับอ่านเอกสารเหลือแล้ว (ใช้ครบหรือตั้งเพดานไว้ 0 บาท) งบส่วนอื่นที่เหลืออยู่ใช้อ่านเอกสารไม่ได้'};
function message(error:unknown){return errors[apiErrorCode(error)??'']??apiErrorMessage(error);}

export default function BillingReceiptAdjustmentsPage({companyId,operationId}:{companyId?:string;operationId?:string}){
  const router=useRouter(),generation=useRef(0),key=useRef<string|null>(null);
  const [data,setData]=useState<BillingReceiptAdjustments|null>(null),[operation,setOperation]=useState<BillingReceiptAdjustmentOperation|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [units,setUnits]=useState(''),[reason,setReason]=useState(''),[expires,setExpires]=useState(''),[password,setPassword]=useState(''),[cursor,setCursor]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
  const target=companyId??(operation?.scope.kind==='COMPANY'?operation.scope.companyId:undefined);
  const companyPath=target?`/system/billing/companies/${encodeURIComponent(target)}`:'/system/billing';
  useEffect(()=>{const token=++generation.current;setLoading(true);setError('');setData(null);setOperation(null);
    const load=operationId?api<BillingReceiptAdjustmentOperation>(`/receipt-adjustments/${encodeURIComponent(operationId)}`).then(value=>{if(token===generation.current)setOperation(value);}):
      api<BillingReceiptAdjustments>(`/companies/${encodeURIComponent(companyId!)}/receipt-adjustments${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`).then(value=>{if(token===generation.current)setData(value);});
    load.catch(e=>{if(token===generation.current)setError(message(e));}).finally(()=>{if(token===generation.current)setLoading(false);});
    return ()=>{generation.current++;};
  },[companyId,operationId,cursor,refresh]);
  const leaving=()=>{generation.current++;};
  async function preview(grantId?:string){
    if(!data||busy)return;
    if(!reason.trim()){setError('กรุณาระบุเหตุผลที่ปรับใบเสร็จ');return;}
    if(!grantId&&(!/^\d{1,10}$/.test(units)||Number(units)<1||Number(units)>2147483647)){setError('กรุณากรอกจำนวนใบเสร็จเป็นจำนวนเต็มตั้งแต่ 1 ใบ');return;}
    const token=generation.current;setBusy(true);setError('');
    try{
      const input:BillingReceiptAdjustmentInput=grantId?{type:'REVOKE_RECEIPTS',grantId,sourceHash:data.sourceHash,reason}:{type:'GRANT_RECEIPTS',units:Number(units),expiresAt:expires?new Date(`${expires}+07:00`).toISOString():data.maxGrantExpiresAt!,sourceHash:data.sourceHash,reason};
      const result=await api<BillingReceiptAdjustmentOperation>(`/companies/${encodeURIComponent(data.companyId)}/receipt-adjustments/preview`,input);
      if(token===generation.current){leaving();router.push(`/system/billing/receipt-adjustments/${encodeURIComponent(result.id)}`);}
    }catch(e){if(token===generation.current)setError(message(e));}finally{if(token===generation.current)setBusy(false);}
  }
  async function act(action:'submit'|'approve'|'cancel'|'reauthenticate'){
    if(!operation||!target||busy)return;const token=generation.current;setBusy(true);setError('');setNotice('');
    try{
      if(action==='reauthenticate'){
        await api(`/companies/${encodeURIComponent(target)}/reauthenticate`,{password});if(token===generation.current){setPassword('');setNotice('ยืนยันรหัสผ่านแล้ว ดำเนินการต่อได้ภายใน 5 นาที');}
      }else{
        if(action==='submit')key.current??=crypto.randomUUID();
        const result=await api<BillingReceiptAdjustmentOperation>(`/receipt-adjustments/${encodeURIComponent(operation.id)}/${action}`,{expectedVersion:operation.version,previewHash:operation.previewHash},action==='submit'?key.current!:undefined);
        if(token===generation.current){setOperation(result);setNotice(state[result.state]??'บันทึกคำขอแล้ว');}
      }
    }catch(e){if(token===generation.current)setError(message(e));}finally{if(token===generation.current)setBusy(false);}
  }
  return <main className="mx-auto max-w-3xl space-y-5 p-4 text-base">
    <Link onClick={leaving} className={button} href={companyPath}>กลับไปสถานะแพ็กเกจ</Link>
    <h1 className="text-2xl font-bold">ใบเสร็จที่ผู้ดูแลเพิ่มให้</h1>
    <p>เพิ่มจำนวนใบที่อ่านได้ โดยตรวจผลกระทบและยืนยันก่อน รายการนี้ไม่เรียกเก็บเงินและไม่ออกใบเสร็จรับเงินใหม่</p>
    <button className={button} disabled={busy||loading} onClick={()=>{generation.current++;setData(null);setOperation(null);setLoading(true);setRefresh(n=>n+1);}}>โหลดข้อมูลล่าสุด</button>
    {loading&&<p role="status">กำลังโหลดข้อมูล…</p>}{error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}{notice&&<p role="status" className="rounded-lg bg-green-50 p-3">{notice}</p>}
    {(data?.readWarnings??operation?.readWarnings??[]).length>0&&<section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label="การตั้งค่าที่จำกัดการอ่านเอกสาร">
      {(data?.readWarnings??operation?.readWarnings??[]).map(w=><p key={w}>{readWarnings[w]}</p>)}<p>เพิ่มใบเสร็จแล้วก็ยังติดการตั้งค่านี้ ตรวจที่เมนูงบการใช้ AI ก่อนให้ร้านอ่านเอกสารเพิ่ม</p>
    </section>}
    {data&&<>
      <section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white"><h2 className="font-bold">{data.companyName}</h2><p>อ่านใบเสร็จได้อีก {data.remaining?.toLocaleString('th-TH')??'ไม่จำกัด'}{data.remaining!==null&&' ใบ'}</p>
        {data.paidThrough&&<p>แพ็กเกจที่จ่ายแล้วใช้ได้ถึง {date(data.paidThrough)}</p>}
        {data.monthlyAllowance&&<p>{billingMonthlyAllowanceText(data)}</p>}
        {data.blockedReason&&<p>{errors[data.blockedReason]??'กรุณาตรวจสถานะแพ็กเกจก่อนดำเนินการ'}</p>}
        {data.canCreate&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void preview();}}>
          <label className="block">เพิ่มใบเสร็จจำนวน<input className={field} inputMode="numeric" value={units} onChange={e=>setUnits(e.target.value)} disabled={busy} maxLength={10}/></label>
          <label className="block">ใช้ได้ถึง (เวลาประเทศไทย)<input className={field} type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)} disabled={busy}/></label>
          <p>ไม่ระบุวัน: ใช้ได้ถึง {data.maxGrantExpiresAt?date(data.maxGrantExpiresAt):'วันหมดอายุแพ็กเกจปัจจุบัน'}</p>
          <div><label className="block" htmlFor="receipt-adjustment-reason">เหตุผลที่ปรับใบเสร็จ</label><textarea id="receipt-adjustment-reason" className={`${field} min-h-24`} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/></div>
          <p>ใบที่เพิ่มใช้ได้ไม่เกินวันหมดอายุแพ็กเกจปัจจุบัน การซื้อแพ็กเกจเพิ่มจะไม่ต่ออายุใบที่ผู้ดูแลเพิ่มให้</p>
          <button className={button} disabled={busy} aria-busy={Boolean(busy)}>ตรวจจำนวนก่อนส่งคำขอ</button>
        </form>}
      </section>
      <section className="scroll-mt-40 space-y-3" aria-label="ประวัติการเพิ่มใบเสร็จ"><h2 className="font-bold">ประวัติคำขอและผู้แก้</h2>
        {!data.items.length&&<p>ยังไม่มีคำขอ</p>}
        {data.items.map(item=><article key={item.id} className="space-y-2 rounded-xl border border-gray-200 p-4 bg-white"><Link onClick={leaving} className="block min-h-11 underline" href={`/system/billing/receipt-adjustments/${encodeURIComponent(item.id)}`}>{item.type==='GRANT_RECEIPTS'?'เพิ่มใบเสร็จ':'ถอนใบที่ยังไม่ใช้'} {item.units.toLocaleString('th-TH')} ใบ · {state[item.state]??'ต้องตรวจสอบ'}</Link>
          <p>ผู้ขอ: {item.requesterName??'ไม่พบชื่อ'} · {date(item.createdAt)}</p><p>ผู้อนุมัติ: {item.approverName??'ยังไม่มี'}</p>{item.approvalMode&&<p>{billingApprovalLabel(item.approvalMode)}</p>}<p>เหตุผล: {item.reason}</p>
          {item.grant&&<p>จากรายการนี้ ใช้แล้ว {item.grant.used} ใบ · เหลือ {item.grant.remaining} ใบ · {item.grant.revokedAt?'ถอนสิทธิ์แล้ว':item.grant.active?`ใช้ได้ถึง ${date(item.grant.expiresAt)}`:'หมดอายุแล้ว'}</p>}
          {data.canCreate&&item.type==='GRANT_RECEIPTS'&&item.grant?.active&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void preview(item.grant!.id)}>ขอถอนใบที่ยังไม่ใช้จากรายการนี้</button>}
        </article>)}
        <div className="flex flex-wrap gap-3">{cursor&&<button className={button} disabled={busy} onClick={()=>{generation.current++;setData(null);setLoading(true);setCursor(null);}}>กลับหน้าแรก</button>}{data.nextCursor&&<button className={button} disabled={busy} onClick={()=>{generation.current++;setLoading(true);setCursor(data.nextCursor);setData(null);}}>ประวัติหน้าถัดไป</button>}</div>
      </section>
    </>}
    {operation&&<>
      <section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white" aria-label="ผลกระทบการปรับใบเสร็จ"><h2 className="font-bold">{state[operation.state]??'ต้องตรวจสอบคำขอ'}</h2><p>{operation.companyName}</p>
        <p>{operation.type==='GRANT_RECEIPTS'?'เพิ่ม':'ขอถอนส่วนที่ยังไม่ใช้จาก'} {operation.units.toLocaleString('th-TH')} ใบ · ใช้ได้ถึง {date(operation.grantExpiresAt)}</p>
        <p>ตอนตรวจคำขอ เหลือทั้งหมด {operation.beforeRemaining?.toLocaleString('th-TH')??'ไม่จำกัด'}{operation.beforeRemaining!==null&&' ใบ'}</p>{operation.state==='SUCCEEDED'&&<p>หลังดำเนินการ เหลือทั้งหมด {operation.observedRemaining?.toLocaleString('th-TH')??'ไม่จำกัด'}{operation.observedRemaining!==null&&' ใบ'}</p>}
        <p>ผู้ขอ: {operation.requesterName??'ไม่พบชื่อ'} · ผู้อนุมัติ: {operation.approverName??'ยังไม่มี'}</p><p>เหตุผล: {operation.reason}</p>
        {operation.grant&&<p>รายการที่ผู้ดูแลเพิ่มนี้ ใช้แล้ว {operation.grant.used.toLocaleString('th-TH')} ใบ · เหลือที่ยังใช้ได้ {operation.grant.remaining.toLocaleString('th-TH')} ใบ</p>}
        <p>วันหมดอายุแพ็กเกจและวันเก็บเงินครั้งถัดไปยังคงเดิม จำนวนที่ใช้แล้วเก็บไว้ในประวัติ</p>
        {operation.approvalMode&&<p>{billingApprovalLabel(operation.approvalMode)}</p>}
        {operation.state==='AWAITING_APPROVAL'&&<p>{operation.allowedActions.includes('approve')?'ตรวจข้อมูลและยืนยันรหัสผ่าน แล้วกดอนุมัติรายการนี้':'ให้ผู้ดูแลระบบหรือผู้มีสิทธิ์อีกคนเปิดลิงก์คำขอนี้เพื่อตรวจและอนุมัติ'}</p>}
      </section>
      {!!operation.allowedActions.length&&<section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white"><h2 className="font-bold">ยืนยันตัวตนก่อนดำเนินการ</h2><p>ยืนยันครั้งเดียวใช้ได้ 5 นาที หากยืนยันแล้ว กดดำเนินการต่อได้เลย</p>
        <form onSubmit={e=>{e.preventDefault();void act('reauthenticate');}} className="space-y-3"><label className="block">รหัสผ่านปัจจุบัน<input className={field} type="password" autoComplete="current-password" maxLength={1024} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label><button className={button} disabled={busy||!password} aria-busy={Boolean(busy)}>ยืนยันรหัสผ่าน</button><Link className={button} onClick={leaving} href="/forgot-password">กู้รหัสผ่าน</Link></form>
        <div className="flex flex-wrap gap-3">{operation.allowedActions.map(action=><button key={action} className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act(action)}>{({submit:'บันทึกคำขอก่อนยืนยัน',approve:'อนุมัติและปรับใบเสร็จ',cancel:'ยกเลิกคำขอ'})[action]}</button>)}</div>
      </section>}
      <Link onClick={leaving} className={button} href={`${companyPath}/receipt-adjustments`}>กลับไปประวัติการเพิ่มใบเสร็จ</Link>
    </>}
  </main>;
}
