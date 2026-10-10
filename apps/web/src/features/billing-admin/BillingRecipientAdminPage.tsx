'use client';
import { billingLink, billingField } from '../billing/billing-display';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BillingRecipientAdminReview, BillingRecipientAdminOperation } from '@watchdog-bms/contracts';
import { billingRecipientSourceLabel } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { billingApprovalLabel, billingControl as button } from '@/features/billing/billing-display';
const field=billingField;
const time=(value:string|null)=>value?formatThaiDateTime(value):'ยังไม่มีผลตรวจ';

// Purchase without setup PR E (R-E1/R-E2). Cloned from BillingRefundPage.tsx's reviewed-op shape.
const states:Record<string,string>={PREVIEW:'ตรวจข้อมูลก่อนส่งคำขอ',AWAITING_APPROVAL:'รอยืนยันรายการ',QUEUED:'รับคำขอแล้ว รอตรวจผลจาก Stripe',RUNNING:'กำลังเปลี่ยนอีเมลผู้รับกับ Stripe',SUCCEEDED:'เปลี่ยนอีเมลรับเอกสารแล้ว ระบบส่งอีเมลแจ้งอีเมลเดิมและอีเมลใหม่ และแจ้งผู้มีสิทธิ์จัดการแพ็กเกจของร้าน',UNKNOWN:'ยังยืนยันผลเปลี่ยนอีเมลไม่ได้',BLOCKED:'ต้องตรวจข้อมูลก่อนดำเนินการ',FAILED:'เปลี่ยนอีเมลผู้รับไม่สำเร็จ ต้องให้เจ้าหน้าที่ตรวจ',CANCELLED:'ยกเลิกคำขอแล้ว'};
const errors:Record<string,string>={
  BILLING_RECIPIENT_BUSY:'บริษัทมีรายการซื้อ คำสั่งต่ออายุ หรือคำขอเปลี่ยนผู้รับของลูกค้าค้างอยู่ รอให้เสร็จก่อน',
  BILLING_RECIPIENT_NO_CUSTOMER:'บริษัทนี้ยังไม่มีบัญชีลูกค้าใน Stripe จึงยังไม่มีผู้รับเอกสารให้เปลี่ยน',
  BILLING_RECIPIENT_INVALID:'รูปแบบอีเมลไม่ถูกต้อง',
  BILLING_RECIPIENT_UNCHANGED:'อีเมลนี้เป็นอีเมลรับเอกสารปัจจุบันอยู่แล้ว ไม่ต้องเปลี่ยน',
  CONTROL_PREVIEW_STALE:'ข้อมูลเปลี่ยนหรือรายการหมดอายุ โหลดข้อมูลล่าสุดแล้วตรวจใหม่',
  CONTROL_PERMISSION_CHANGED:'สิทธิ์ผู้ดำเนินการเปลี่ยน กรุณาติดต่อผู้ดูแลสิทธิ์',
  CONTROL_IDEMPOTENCY_CONFLICT:'ข้อมูลคำขอต่างจากรายการเดิม กรุณาเปิดคำขอเดิมหรือตรวจใหม่',
  CONTROL_RECIPIENT_PROVIDER_REJECTED:'Stripe ปฏิเสธการเปลี่ยนอีเมล ต้องให้เจ้าหน้าที่ตรวจ',
  CONTROL_RECIPIENT_REVIEW:'ต้องตรวจรายการนี้กับ Stripe อีกครั้งก่อนดำเนินการต่อ',
  CONTROL_RECIPIENT_AGED_UNKNOWN:'ยังยืนยันผลกับ Stripe ไม่ได้เกิน 23 ชั่วโมง ให้ตรวจที่ Stripe ก่อนทำรายการต่อ',
  CONTROL_RECIPIENT_NOT_CHANGED:'ตรวจกับผู้ให้บริการรับชำระเงินแล้ว อีเมลผู้รับเอกสารยังไม่ถูกเปลี่ยนจากคำขอนี้ สร้างคำขอใหม่ได้',
  CONTROL_REAUTH_REQUIRED:'กรุณายืนยันรหัสผ่านปัจจุบันก่อน',
  CONTROL_REAUTH_FAILED:'ยืนยันไม่ได้ กรุณาตรวจรหัสผ่านหรือใช้หน้ากู้บัญชี',
};
const api=<T,>(path:string,body?:unknown,key?:string)=>authedApiFetch<T>(`/system/billing${path}`,{cache:'no-store',suppressErrorToast:true,...body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...key?{'Idempotency-Key':key}:{}},body:JSON.stringify(body)}});
function message(error:unknown){const code=apiErrorCode(error);return code&&errors[code]||apiErrorMessage(error);}

export default function BillingRecipientAdminPage({companyId,invoiceId,operationId}:{companyId?:string;invoiceId?:string;operationId?:string}){
  const router=useRouter(),generation=useRef(0),emailInput=useRef<HTMLInputElement>(null);
  const [review,setReview]=useState<BillingRecipientAdminReview|null>(null),[operation,setOperation]=useState<BillingRecipientAdminOperation|null>(null),[history,setHistory]=useState<BillingRecipientAdminOperation[]>([]),[cursor,setCursor]=useState<string|null>(null),[nextCursor,setNextCursor]=useState<string|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0),[password,setPassword]=useState(''),[proof,setProof]=useState<string|null>(null);
  const [newEmail,setNewEmail]=useState(''),[reason,setReason]=useState(''),[supportRequestId,setSupportRequestId]=useState('');
  const company=companyId??(operation?.scope.kind==='COMPANY'?operation.scope.companyId:undefined),invoice=invoiceId??operation?.referenceId;
  const invoicePath=company&&invoice?`/companies/${encodeURIComponent(company)}/invoices/${encodeURIComponent(invoice)}`:null;
  useEffect(()=>{
    const started=++generation.current;setLoading(true);setError('');setReview(null);setOperation(null);setHistory([]);setNextCursor(null);setProof(null);
    void (async()=>{
      if(operationId){const value=await api<BillingRecipientAdminOperation>(`/recipient-changes/${encodeURIComponent(operationId)}`);if(started===generation.current)setOperation(value);}
      else if(companyId&&invoiceId){const path=`/companies/${encodeURIComponent(companyId)}/invoices/${encodeURIComponent(invoiceId)}`;
        const [value,list]=await Promise.all([api<BillingRecipientAdminReview>(`${path}/recipient-review`),api<{items:BillingRecipientAdminOperation[];nextCursor:string|null}>(`${path}/recipient-requests${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`)]);
        if(started===generation.current){setReview(value);setHistory(list.items);setNextCursor(list.nextCursor);}}
    })().catch(e=>{if(started===generation.current)setError(message(e));}).finally(()=>{if(started===generation.current)setLoading(false);});
    return()=>{generation.current++;};
  },[companyId,invoiceId,operationId,cursor,reload]);
  const canAct=Boolean(operation?.allowedActions.length);
  useEffect(()=>{
    if(!company||!canAct)return;let active=true;
    void api<{reauthenticatedUntil:string|null}>(`/companies/${encodeURIComponent(company)}/reauthenticate`).then(value=>{if(active)setProof(value.reauthenticatedUntil);}).catch(()=>{});
    return()=>{active=false;};
  },[company,canAct,reload]);
  async function act(action:'preview'|'reauthenticate'|'submit'|'approve'|'cancel'|'run'){
    if(busy||loading)return;if(action==='preview'&&(!emailInput.current?.reportValidity()||!reason.trim()))return;
    const started=generation.current;setBusy(true);setError('');
    try{
      if(action==='preview'){
        const value=await api<BillingRecipientAdminOperation>(`${invoicePath}/recipient-preview`,{newEmail,reason,sourceHash:review!.sourceHash,...supportRequestId.trim()?{supportRequestId:supportRequestId.trim()}:{}});
        if(started===generation.current)router.push(`/system/billing/recipient-changes/${encodeURIComponent(value.id)}`);
      }else if(action==='reauthenticate'){
        const value=await api<{reauthenticatedUntil:string}>(`/companies/${encodeURIComponent(company!)}/reauthenticate`,{password});if(started===generation.current)setProof(value.reauthenticatedUntil);
      }else{
        const op=operation!,body={expectedVersion:op.version,...action==='run'?{}:{previewHash:op.previewHash}};
        const value=await api<BillingRecipientAdminOperation>(`/recipient-changes/${encodeURIComponent(op.id)}/${action}`,body,action==='submit'?`recipient-submit-${op.id}`:undefined);
        if(started===generation.current)setOperation(value);
      }
    }catch(e){if(started===generation.current)setError(message(e));}
    finally{if(action==='reauthenticate')setPassword('');if(started===generation.current)setBusy(false);}
  }
  return <main className="mx-auto max-w-3xl space-y-5 break-words p-4 text-base sm:p-8">
    <h1 className="text-2xl font-bold">เปลี่ยนอีเมลผู้รับเอกสาร</h1>
    <nav className="flex flex-wrap gap-3">{company?<Link className={billingLink} href={`/system/billing/companies/${encodeURIComponent(company)}`}>กลับไปบริษัท</Link>:<Link className={billingLink} href="/system/billing">กลับหน้าดูแลการชำระเงิน</Link>}
      {invoicePath&&<Link className={billingLink} href={`/system/billing${invoicePath}`}>เปิดใบแจ้งหนี้เดิมและเอกสาร</Link>}
      <button className={button} disabled={loading||busy} onClick={()=>{generation.current++;setReload(n=>n+1);}}>โหลดรายการล่าสุด</button></nav>
    {loading&&<p role="status">กำลังตรวจข้อมูล…</p>}{busy&&<p role="status">กำลังดำเนินการกับคำขอนี้…</p>}{error&&<p role="alert" className="rounded-xl bg-red-50 p-3">{error}</p>}
    {review&&<>
      <section className="space-y-2 rounded-xl border border-gray-200 p-4 bg-white"><h2 className="font-bold">{review.companyName}</h2><p>{review.mode==='TEST'?'โหมดทดสอบ · ไม่มีการเปลี่ยนแปลงจริงกับลูกค้า':'โหมดใช้งานจริง'}</p>
        <p>ใบแจ้งหนี้ {review.invoiceNumber??'ยังไม่มีเลขเอกสาร'}</p>
        <p>อีเมลผู้รับเอกสารปัจจุบัน: {review.currentEmail??'ยังไม่มี'} · ที่มา: {billingRecipientSourceLabel(review.currentSource)}</p>
        {review.bouncedAt&&<p className="text-red-700">อีเมลนี้ตีกลับเมื่อ {time(review.bouncedAt)}</p>}
        <p>ตรวจเมื่อ {time(review.observedAt)}</p>
      </section>
      {review.canChange?<form className="space-y-4 rounded-xl border border-gray-200 p-4 bg-white" onSubmit={e=>{e.preventDefault();void act('preview');}}>
        <label className="block">อีเมลผู้รับเอกสารใหม่<input ref={emailInput} className={field} type="email" required maxLength={254} value={newEmail} disabled={busy} onChange={e=>setNewEmail(e.target.value)}/></label>
        <div><label className="block" htmlFor="recipient-private-reason">เหตุผลภายใน (ลูกค้าไม่เห็น)</label><textarea id="recipient-private-reason" className={field} required maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></div>
        <div><label className="block" htmlFor="recipient-support-request">เลขคำขอคุยกับเจ้าหน้าที่ (ถ้ามี)</label><input id="recipient-support-request" className={field} maxLength={64} value={supportRequestId} disabled={busy} onChange={e=>setSupportRequestId(e.target.value)}/></div>
        <p>ขั้นต่อไปตรวจข้อมูลก่อนบันทึกคำขอ ยังไม่เปลี่ยนอีเมลจนกว่าจะยืนยันคำขอ</p><button className={button} disabled={busy} aria-busy={Boolean(busy)}>ตรวจข้อมูลก่อนบันทึก</button>
      </form>:<p role="status" className="rounded-xl border border-gray-200 p-4 bg-white">{errors[review.blockedReason??'']??'ยังเริ่มคำขอไม่ได้ในตอนนี้'}</p>}
      <section className="space-y-3" aria-label="คำขอเปลี่ยนผู้รับเดิม"><h2 className="font-bold">คำขอของบัญชีนี้</h2><p className="text-sm text-gray-600">ผู้รับเป็นของบัญชี ไม่ใช่ของใบแจ้งหนี้ใบเดียว จึงแสดงทุกคำขอของบริษัทนี้</p>{!history.length&&<p>ไม่พบคำขอ</p>}
        {history.map(op=><Link key={op.id} className="block min-h-11 rounded-xl border border-gray-200 p-4 underline bg-white" href={`/system/billing/recipient-changes/${encodeURIComponent(op.id)}`}>{states[op.state]??'ต้องตรวจสอบ'}{op.approvalMode&&` · ${op.approvalMode==='SINGLE_ADMIN'?'ยืนยันโดยผู้ดูแลคนเดียว':'ตรวจโดยคนที่สอง'}`} · {time(op.createdAt)}<span className="block">{op.reason}</span></Link>)}
        {nextCursor&&<button className={button} disabled={loading||busy} onClick={()=>setCursor(nextCursor)}>คำขอหน้าถัดไป</button>}{cursor&&<button className={button} disabled={loading||busy} onClick={()=>setCursor(null)}>กลับไปหน้าแรก</button>}
      </section>
    </>}
    {operation&&<>
      <section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white" aria-label="ผลของคำขอเปลี่ยนผู้รับ"><h2 className="font-bold" role="status">{states[operation.state]??'ต้องตรวจสอบรายการ'}</h2>
        <p>{operation.companyName} · {operation.scope.mode==='TEST'?'โหมดทดสอบ · ไม่มีการเปลี่ยนแปลงจริงกับลูกค้า':'โหมดใช้งานจริง'}</p><p>ใบแจ้งหนี้ {operation.invoiceNumber??'ยังไม่มีเลขเอกสาร'}</p>
        <p>เปลี่ยนจาก {operation.previousEmail??'ยังไม่มี'} เป็น {operation.newEmail}</p>
        <p>เหตุผลภายใน: {operation.reason}</p>{operation.supportRequestId&&<p>อ้างอิงคำขอคุยกับเจ้าหน้าที่: {operation.supportRequestId}</p>}
        {operation.approvalMode&&<p>{billingApprovalLabel(operation.approvalMode)}</p>}
        {operation.state==='AWAITING_APPROVAL'&&<p>{operation.allowedActions.includes('approve')?'ตรวจข้อมูลและยืนยันรหัสผ่าน แล้วกดยืนยันเปลี่ยนอีเมลผู้รับ':'ให้ผู้ดูแลระบบหรือผู้มีสิทธิ์อีกคนเปิดลิงก์คำขอนี้เพื่อตรวจและอนุมัติ'}</p>}
        {operation.errorCode&&<p>{errors[operation.errorCode]??'ต้องตรวจรายการนี้อีกครั้ง'}</p>}
        {operation.dispatchedAt&&<p>ส่งคำสั่งครั้งแรก {time(operation.dispatchedAt)} · ตรวจผลล่าสุด {time(operation.observedAt)}</p>}
        {operation.notifiedAt&&<p>ส่งคำแจ้งเข้าคิวเมื่อ {time(operation.notifiedAt)}</p>}
        <details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิง</summary><p className="break-all">เลขคำขอ {operation.id}</p><p>ตรวจได้ถึง {time(operation.expiresAt)}</p></details>
        {operation.reviewCaseId&&<Link className={button} href={`/system/billing/issues/${encodeURIComponent(operation.reviewCaseId)}`}>เปิดเคสให้เจ้าหน้าที่ตรวจ</Link>}
      </section>
      {canAct&&<section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white"><h2 className="font-bold">ยืนยันตัวตนก่อนดำเนินการ</h2><p>ใช้รหัสผ่านปัจจุบัน การยืนยันใช้ได้ 5 นาทีในอุปกรณ์นี้</p>
        {proof&&<p role="status">ยืนยันแล้วถึง {time(proof)}</p>}
        <form className="space-y-3" onSubmit={e=>{e.preventDefault();void act('reauthenticate');}}><label className="block">รหัสผ่านปัจจุบัน<input className={field} type="password" autoComplete="current-password" maxLength={1024} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
          <button className={button} disabled={busy||!password} aria-busy={Boolean(busy)}>ยืนยันรหัสผ่าน</button><Link className={button} href="/forgot-password">กู้รหัสผ่าน</Link></form>
        <div className="flex flex-wrap gap-3">{operation.allowedActions.map(action=><button key={action} className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act(action)}>{({submit:'บันทึกคำขอก่อนยืนยัน',approve:'ยืนยันเปลี่ยนอีเมลผู้รับ',cancel:'ยกเลิกคำขอที่ยังไม่ส่ง',run:'ตรวจและดำเนินการคำขอเดิม'})[action]}</button>)}</div>
      </section>}
      {invoicePath&&<Link className={button} href={`/system/billing${invoicePath}/recipient`}>กลับไปคำขอของใบแจ้งหนี้นี้</Link>}
    </>}
  </main>;
}
