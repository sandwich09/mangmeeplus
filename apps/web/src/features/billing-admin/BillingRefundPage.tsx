'use client';
import { billingLink, billingField } from '../billing/billing-display';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BillingRefundReview, BillingRefundOperation } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { billingApprovalLabel, billingControl as button } from '@/features/billing/billing-display';
const field=billingField;
const money=(value:number)=>new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(value/100);
const time=(value:string|null)=>value?formatThaiDateTime(value):'ยังไม่มีผลตรวจ';

const states:Record<string,string>={PREVIEW:'ตรวจยอดก่อนส่งคำขอ',AWAITING_APPROVAL:'รอยืนยันรายการ',QUEUED:'รับคำขอแล้ว รอตรวจผลจาก Stripe',RUNNING:'กำลังตรวจรายการเดิมกับ Stripe',SUCCEEDED:'Stripe ดำเนินการคืนเงินสำเร็จ',UNKNOWN:'ยังยืนยันผลคืนเงินไม่ได้',BLOCKED:'ต้องตรวจข้อมูลก่อนดำเนินการ',FAILED:'คืนเงินไม่สำเร็จ ต้องให้เจ้าหน้าที่ตรวจ',CANCELLED:'ยกเลิกคำขอแล้ว'};
const refundStates:Record<string,string>={pending:'Stripe รับเรื่องแล้ว กำลังรอผลคืนเงิน',requires_action:'ต้องให้เจ้าหน้าที่ตรวจขั้นตอนเพิ่มเติม',succeeded:'Stripe ดำเนินการคืนเงินสำเร็จ',failed:'Stripe แจ้งว่าคืนเงินไม่สำเร็จ',canceled:'Stripe ยกเลิกการคืนเงิน',unknown:'ยังยืนยันผลคืนเงินไม่ได้'};
const errors:Record<string,string>={CONTROL_REFUND_PENDING:'มีเงินที่กำลังรอคืน ตรวจคำขอเดิมก่อนเริ่มคำขอเพิ่มเติม',CONTROL_REFUND_FULL:'คืนเงินหรือปรับยอดครบแล้ว เปิดเอกสารเดิมเพื่อตรวจรายละเอียด',CONTROL_REFUNDS_CLOSED:'ยังไม่เปิดรับคำขอคืนเงิน ตรวจวงเงินในหน้าตั้งค่าการชำระเงิน',CONTROL_REFUND_CONFIG_REQUIRED:'ยังไม่ได้กำหนดวงเงินคืนเงิน ตรวจหน้าตั้งค่าการชำระเงิน',CONTROL_REFUND_LIMIT:'ยอดนี้เกินวงเงินต่อคำขอ ตรวจวงเงินในหน้าตั้งค่าการชำระเงิน',CONTROL_REFUND_DISPUTED:'รายการนี้มีข้อพิพาท ต้องให้เจ้าหน้าที่ตรวจแยกก่อน',BILLING_REFUND_PENDING:'มีรายการเดิมที่ยังต้องตรวจสอบ เปิดคำขอเดิมเพื่อตรวจผล',CONTROL_REAUTH_REQUIRED:'กรุณายืนยันรหัสผ่านปัจจุบันก่อน',CONTROL_REAUTH_FAILED:'ยืนยันไม่ได้ กรุณาตรวจรหัสผ่านหรือใช้หน้ากู้บัญชี',CONTROL_PREVIEW_STALE:'ข้อมูลเปลี่ยนหรือรายการหมดอายุ โหลดข้อมูลล่าสุดแล้วตรวจใหม่',CONTROL_REFUND_SOURCE_CHANGED:'หลักฐานการคืนเงินเปลี่ยนหรือยังไม่ครบ โหลดรายการล่าสุดและตรวจหลักฐานจากใบแจ้งหนี้เดิม',CONTROL_PERMISSION_CHANGED:'สิทธิ์ผู้ดำเนินการเปลี่ยน กรุณาติดต่อผู้ดูแลสิทธิ์',CONTROL_REFUND_AGED_UNKNOWN:'ต้องให้เจ้าหน้าที่ตรวจรายการ Stripe เดิมก่อน ระบบจะไม่สร้างรายการคืนเงินใหม่',CONTROL_REFUND_FAILED:'ตรวจผลคืนเงินของรายการเดิมใน Stripe ก่อนดำเนินการเพิ่มเติม'};
const api=<T,>(path:string,body?:unknown,key?:string)=>authedApiFetch<T>(`/system/billing${path}`,{cache:'no-store',suppressErrorToast:true,...body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...key?{'Idempotency-Key':key}:{}},body:JSON.stringify(body)}});
function message(error:unknown){const code=apiErrorCode(error);return code&&errors[code]||apiErrorMessage(error);}
function amountValue(value:string){const parts=value.trim().split('.');return /^\d{1,8}(?:\.\d{1,2})?$/.test(value.trim())?Number(parts[0])*100+Number((parts[1]??'').padEnd(2,'0')):NaN;}

export default function BillingRefundPage({companyId,invoiceId,operationId}:{companyId?:string;invoiceId?:string;operationId?:string}){
  const router=useRouter(),generation=useRef(0),amountInput=useRef<HTMLInputElement>(null);
  const [review,setReview]=useState<BillingRefundReview|null>(null),[operation,setOperation]=useState<BillingRefundOperation|null>(null),[history,setHistory]=useState<BillingRefundOperation[]>([]),[cursor,setCursor]=useState<string|null>(null),[nextCursor,setNextCursor]=useState<string|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0),[password,setPassword]=useState(''),[proof,setProof]=useState<string|null>(null);
  const [amount,setAmount]=useState(''),[reason,setReason]=useState(''),[memo,setMemo]=useState(''),[notifyCustomer,setNotifyCustomer]=useState(false);
  const company=companyId??(operation?.scope.kind==='COMPANY'?operation.scope.companyId:undefined),invoice=invoiceId??operation?.referenceId;
  const invoicePath=company&&invoice?`/companies/${encodeURIComponent(company)}/invoices/${encodeURIComponent(invoice)}`:null;
  useEffect(()=>{
    const started=++generation.current;setLoading(true);setError('');setReview(null);setOperation(null);setHistory([]);setNextCursor(null);setProof(null);
    void (async()=>{
      if(operationId){const value=await api<BillingRefundOperation>(`/refunds/${encodeURIComponent(operationId)}`);if(started===generation.current)setOperation(value);}
      else if(companyId&&invoiceId){const path=`/companies/${encodeURIComponent(companyId)}/invoices/${encodeURIComponent(invoiceId)}`;
        const [value,list]=await Promise.all([api<BillingRefundReview>(`${path}/refund-review`),api<{items:BillingRefundOperation[];nextCursor:string|null}>(`${path}/refund-requests${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`)]);
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
    if(busy||loading)return;if(action==='preview'&&(!amountInput.current?.reportValidity()||!reason.trim()))return;
    const started=generation.current;setBusy(true);setError('');
    try{
      if(action==='preview'){
        const value=await api<BillingRefundOperation>(`${invoicePath}/refund-preview`,{amountSatang:amountValue(amount),reason,memo,notifyCustomer,sourceHash:review!.sourceHash});
        if(started===generation.current)router.push(`/system/billing/refunds/${encodeURIComponent(value.id)}`);
      }else if(action==='reauthenticate'){
        const value=await api<{reauthenticatedUntil:string}>(`/companies/${encodeURIComponent(company!)}/reauthenticate`,{password});if(started===generation.current)setProof(value.reauthenticatedUntil);
      }else{
        const op=operation!,body={expectedVersion:op.version,...action==='run'?{}:{previewHash:op.previewHash}};
        const value=await api<BillingRefundOperation>(`/refunds/${encodeURIComponent(op.id)}/${action}`,body,action==='submit'?`refund-submit-${op.id}`:undefined);
        if(started===generation.current)setOperation(value);
      }
    }catch(e){if(started===generation.current)setError(message(e));}
    finally{if(action==='reauthenticate')setPassword('');if(started===generation.current)setBusy(false);}
  }
  return <main className="mx-auto max-w-3xl space-y-5 break-words p-4 text-base sm:p-8">
    <h1 className="text-2xl font-bold">คำขอคืนเงิน</h1>
    <nav className="flex flex-wrap gap-3">{company?<Link className={billingLink} href={`/system/billing/companies/${encodeURIComponent(company)}`}>กลับไปบริษัท</Link>:<Link className={billingLink} href="/system/billing">กลับหน้าดูแลการชำระเงิน</Link>}
      {invoicePath&&<Link className={billingLink} href={`/system/billing${invoicePath}`}>เปิดใบแจ้งหนี้เดิมและเอกสาร</Link>}
      <button className={button} disabled={loading||busy} onClick={()=>{generation.current++;setReload(n=>n+1);}}>โหลดรายการล่าสุด</button></nav>
    {loading&&<p role="status">กำลังตรวจข้อมูล…</p>}{busy&&<p role="status">กำลังดำเนินการกับคำขอนี้…</p>}{error&&<p role="alert" className="rounded-xl bg-red-50 p-3">{error}</p>}
    {review&&<>
      <section className="space-y-2 rounded-xl border border-gray-200 p-4 bg-white"><h2 className="font-bold">{review.companyName}</h2><p>{review.mode==='TEST'?'โหมดทดสอบ · ไม่มีการคืนเงินจริง':'โหมดใช้งานจริง'}</p>
        <p>ใบแจ้งหนี้ {review.invoiceNumber??'ยังไม่มีเลขเอกสาร'} · จ่ายแล้ว {money(review.paidSatang)}</p><p>Stripe บันทึกคืนเงินแล้ว {money(review.refundedSatang)}</p>
        <p>วงเงินต่อคำขอ {review.refundLimitSatang==null?'ยังไม่กำหนด':money(review.refundLimitSatang)} · ตรวจเมื่อ {time(review.observedAt)}</p>
        {review.adjustments.length>0&&<p>มีรายการคืนเงินหรือเอกสารปรับยอดเดิม {review.adjustments.length} รายการ ตรวจได้จากปุ่มเปิดใบแจ้งหนี้เดิม</p>}
      </section>
      {review.canCreate?<form className="space-y-4 rounded-xl border border-gray-200 p-4 bg-white" onSubmit={e=>{e.preventDefault();void act('preview');}}>
        <label className="block">จำนวนเงินที่ต้องการคืน (บาท)<input ref={amountInput} className={field} inputMode="decimal" required value={amount} disabled={busy} onChange={e=>{
          setAmount(e.target.value);const n=amountValue(e.target.value);e.target.setCustomValidity(Number.isSafeInteger(n)&&n>0&&n<=Math.min(review.refundLimitSatang!,review.paidSatang-review.refundedSatang)?'':'กรอกยอดที่คืนได้ ไม่เกินวงเงิน และทศนิยมไม่เกิน 2 ตำแหน่ง');}}/></label>
        <div><label className="block" htmlFor="refund-private-reason">เหตุผลภายใน (ลูกค้าไม่เห็น)</label><textarea id="refund-private-reason" className={field} required maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></div>
        <div><label className="block" htmlFor="refund-customer-memo">ข้อความบนเอกสารให้ลูกค้า (ไม่บังคับ)</label><textarea id="refund-customer-memo" className={field} maxLength={500} value={memo} disabled={busy} onChange={e=>setMemo(e.target.value)}/></div>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={notifyCustomer} disabled={busy} onChange={e=>setNotifyCustomer(e.target.checked)}/>ให้ Stripe ส่งอีเมลเอกสารปรับยอดให้ลูกค้า</label>
        <p>ขั้นต่อไปตรวจยอดและผลกระทบ ยังไม่คืนเงินจนกว่าจะยืนยันคำขอ</p><button className={button} disabled={busy} aria-busy={Boolean(busy)}>ตรวจยอดและผลกระทบ</button>
      </form>:<p role="status" className="rounded-xl border border-gray-200 p-4 bg-white">{errors[review.blockedReason??'']??'ยังเริ่มคำขอไม่ได้ ตรวจวงเงินและช่องทางคืนเงินในหน้าตั้งค่าการชำระเงิน'}</p>}
      <section className="space-y-3" aria-label="คำขอคืนเงินเดิม"><h2 className="font-bold">คำขอของใบแจ้งหนี้นี้</h2>{!history.length&&<p>ไม่พบคำขอในหน้านี้</p>}
        {history.map(op=><Link key={op.id} className="block min-h-11 rounded-xl border border-gray-200 p-4 underline bg-white" href={`/system/billing/refunds/${encodeURIComponent(op.id)}`}>{states[op.state]??'ต้องตรวจสอบ'} · {money(op.amountSatang)} · {time(op.createdAt)}<span className="block">{op.reason}</span></Link>)}
        {nextCursor&&<button className={button} disabled={loading||busy} onClick={()=>setCursor(nextCursor)}>คำขอหน้าถัดไป</button>}{cursor&&<button className={button} disabled={loading||busy} onClick={()=>setCursor(null)}>กลับไปหน้าแรก</button>}
      </section>
    </>}
    {operation&&<>
      <section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white" aria-label="ผลกระทบการคืนเงิน"><h2 className="font-bold" role="status">{states[operation.state]??'ต้องตรวจสอบรายการ'}</h2>
        <p>{operation.companyName} · {operation.scope.mode==='TEST'?'โหมดทดสอบ · ไม่มีการคืนเงินจริง':'โหมดใช้งานจริง'}</p><p>ใบแจ้งหนี้ {operation.invoiceNumber??'ยังไม่มีเลขเอกสาร'}</p>
        <p>ขอคืน {money(operation.amountSatang)} · ภาษีในเอกสารปรับยอด {money(operation.taxSatang)}</p><p>ยอดจ่ายเดิม {money(operation.paidSatang)} · เคยคืนแล้ว ณ เวลาตรวจ {money(operation.previousRefundedSatang)}</p>
        <p>ใช้สิทธิ์อ่านใบเสร็จแล้ว {operation.usage.used.toLocaleString('th-TH')} ใบ ณ เวลาตรวจคำขอ</p><p>วันหมดอายุ โควตา สาขา และผู้ใช้ของแพ็กเกจยังคงเดิม</p>
        <p>เหตุผลภายใน: {operation.reason}</p><p>ข้อความให้ลูกค้า: {operation.memo||'ไม่มีข้อความเพิ่มเติม'}</p><p>{operation.notifyCustomer?'ให้ Stripe ส่งอีเมลเอกสารปรับยอด':'ไม่ส่งอีเมลเอกสารปรับยอด'}</p>
        {operation.approvalMode&&<p>{billingApprovalLabel(operation.approvalMode)}</p>}
        {operation.state==='AWAITING_APPROVAL'&&<p>{operation.allowedActions.includes('approve')?'ตรวจข้อมูลและยืนยันรหัสผ่าน แล้วกดอนุมัติรายการนี้':'ให้ผู้ดูแลระบบหรือผู้มีสิทธิ์อีกคนเปิดลิงก์คำขอนี้เพื่อตรวจและอนุมัติ'}</p>}
        {operation.errorCode&&<p>{errors[operation.errorCode]??'ต้องตรวจรายการเดิมอีกครั้ง จากใบแจ้งหนี้เดิมและข้อมูลอ้างอิงด้านล่าง'}</p>}
        {operation.refundState&&<p className="font-semibold">{refundStates[operation.refundState]??'ยังยืนยันผลคืนเงินไม่ได้'}</p>}
        {operation.creditNoteId&&<p>ออกเอกสารปรับยอดแล้ว {operation.creditNoteNumber} เปิดเอกสารได้จากใบแจ้งหนี้เดิม</p>}
        {operation.dispatchedAt&&<p>ส่งคำสั่งครั้งแรก {time(operation.dispatchedAt)} · ตรวจผลล่าสุด {time(operation.observedAt)}</p>}
        <p>ผลจาก Stripe ยังไม่ใช่หลักฐานว่าเงินเข้าบัญชีธนาคารลูกค้าแล้ว</p>
        <details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิง</summary><p className="break-all">เลขคำขอ {operation.id}</p><p>ตรวจได้ถึง {time(operation.expiresAt)}</p>{operation.refundId&&<p className="break-all">เลขคืนเงิน {operation.refundId}</p>}</details>
        {operation.reviewCaseId&&<Link className={button} href={`/system/billing/issues/${encodeURIComponent(operation.reviewCaseId)}`}>เปิดเคสให้เจ้าหน้าที่ตรวจ</Link>}
      </section>
      {canAct&&<section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white"><h2 className="font-bold">ยืนยันตัวตนก่อนดำเนินการ</h2><p>ใช้รหัสผ่านปัจจุบัน การยืนยันใช้ได้ 5 นาทีในอุปกรณ์นี้</p>
        {proof&&<p role="status">ยืนยันแล้วถึง {time(proof)}</p>}
        <form className="space-y-3" onSubmit={e=>{e.preventDefault();void act('reauthenticate');}}><label className="block">รหัสผ่านปัจจุบัน<input className={field} type="password" autoComplete="current-password" maxLength={1024} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
          <button className={button} disabled={busy||!password} aria-busy={Boolean(busy)}>ยืนยันรหัสผ่าน</button><Link className={button} href="/forgot-password">กู้รหัสผ่าน</Link></form>
        <div className="flex flex-wrap gap-3">{operation.allowedActions.map(action=><button key={action} className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act(action)}>{({submit:'บันทึกคำขอก่อนยืนยัน',approve:'อนุมัติคำขอคืนเงิน',cancel:'ยกเลิกคำขอที่ยังไม่ส่ง',run:'ตรวจและดำเนินการคำขอเดิม'})[action]}</button>)}</div>
      </section>}
      {invoicePath&&<Link className={button} href={`/system/billing${invoicePath}/refund`}>กลับไปคำขอของใบแจ้งหนี้นี้</Link>}
    </>}
  </main>;
}
