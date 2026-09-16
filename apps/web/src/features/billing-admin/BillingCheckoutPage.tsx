'use client';
import { billingLink, billingControl as button, billingLabel } from '../billing/billing-display';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import type {BillingCheckoutAttempts,BillingCheckoutReview,BillingCheckoutExpiryOperation} from '@watchdog-bms/contracts';
import {authedApiFetch} from '@/common/api/authed-fetch';
import {apiErrorCode,apiErrorMessage} from '@/common/api/api-error-message';
const time=(v:string|null)=>v?formatThaiDateTime(v):'ยังไม่มีเวลาที่บันทึกไว้';
const states:Record<string,string>={PREVIEW:'ตรวจผลกระทบก่อนยืนยัน',QUEUED:'รับคำขอแล้ว รอดำเนินการ',RUNNING:'กำลังตรวจหน้าชำระเดิม',SUCCEEDED:'ตรวจผลจาก Stripe แล้ว',UNKNOWN:'ยังยืนยันผลไม่ได้',BLOCKED:'ต้องตรวจข้อมูลก่อนดำเนินการ',CANCELLED:'ยกเลิกคำขอแล้ว'};
const providerStates={open:'หน้าชำระยังเปิดอยู่',expired:'หน้าชำระนี้ปิดแล้ว',complete:'ลูกค้าทำรายการผ่านหน้าชำระแล้ว'};
const paymentStates={paid:'Stripe แจ้งว่าจ่ายแล้ว',unpaid:'ยังไม่มีผลจ่ายสำเร็จ',no_payment_required:'Stripe ระบุว่าไม่ต้องจ่ายเพิ่ม'};
const errors:Record<string,string>={CONTROL_PREVIEW_STALE:'ข้อมูลเปลี่ยนหรือคำขอหมดอายุ โหลดรายการล่าสุดแล้วตรวจใหม่',CONTROL_CHECKOUT_SOURCE_CHANGED:'ข้อมูลหน้าชำระเดิมยังไม่ครบหรือเปลี่ยนไป กลับไปตรวจสถานะบริษัทก่อน',CONTROL_CHECKOUT_REFERENCE_PENDING:'ยังหารายการหน้าชำระเดิมไม่ครบ กลับไปตรวจสถานะบริษัท',CONTROL_PERMISSION_CHANGED:'สิทธิ์ดำเนินการเปลี่ยน ติดต่อผู้ดูแลสิทธิ์หรือกลับไปบริษัท',CONTROL_OPERATION_IN_PROGRESS:'มีคำขอเดิมที่ยังตรวจไม่จบ เปิดประวัติคำขอด้านล่าง',CONTROL_CHECKOUT_REVIEW:'ต้องตรวจหน้าชำระเดิมอีกครั้ง หากยังตรวจไม่ได้ ให้เปิดเคสหรือติดต่อผู้ดูแล',CONTROL_CHECKOUT_ALREADY_CLOSED:'หน้าชำระนี้ไม่อยู่ในสถานะที่ยุติได้ ตรวจผลจาก Stripe และสถานะบริษัทต่อ'};
const message=(e:unknown)=>{const code=apiErrorCode(e);return code&&Object.hasOwn(errors,code)?errors[code]!:apiErrorMessage(e);};
const state=(v:string)=>Object.hasOwn(states,v)?states[v]!:'ต้องตรวจสอบรายการ';
const api=<T,>(path:string,body?:unknown,key?:string)=>authedApiFetch<T>(`/system/billing${path}`,{cache:'no-store',suppressErrorToast:true,...body===undefined?{}:{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json',...key?{'Idempotency-Key':key}:{}}}});

export default function BillingCheckoutPage({companyId,attemptId,operationId}:{companyId?:string;attemptId?:string;operationId?:string}){
  const router=useRouter(),generation=useRef(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const [attempts,setAttempts]=useState<BillingCheckoutAttempts|null>(null),[review,setReview]=useState<BillingCheckoutReview|null>(null),[operation,setOperation]=useState<BillingCheckoutExpiryOperation|null>(null),[history,setHistory]=useState<BillingCheckoutExpiryOperation[]>([]);
  const [cursor,setCursor]=useState<string|null>(null),[nextCursor,setNextCursor]=useState<string|null>(null),[reason,setReason]=useState('');
  const company=companyId??(operation?.scope.kind==='COMPANY'?operation.scope.companyId:undefined),attempt=attemptId??operation?.referenceId;
  const path=company&&attempt?`/companies/${encodeURIComponent(company)}/checkouts/${encodeURIComponent(attempt)}`:null;
  useEffect(()=>{
    const g=++generation.current;setLoading(true);setBusy(false);setError('');setAttempts(null);setReview(null);setOperation(null);setHistory([]);setNextCursor(null);
    void (async()=>{
      if(operationId){const row=await api<BillingCheckoutExpiryOperation>(`/checkout-expiry/${encodeURIComponent(operationId)}`);if(g===generation.current)setOperation(row);}
      else if(companyId&&attemptId){const base=`/companies/${encodeURIComponent(companyId)}/checkouts/${encodeURIComponent(attemptId)}`;
        const [r,h]=await Promise.allSettled([api<BillingCheckoutReview>(base),api<{items:BillingCheckoutExpiryOperation[];nextCursor:string|null}>(`${base}/requests${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`)]);
        if(g!==generation.current)return;
        if(r.status==='fulfilled')setReview(r.value);else setError(message(r.reason));
        if(h.status==='fulfilled'){setHistory(h.value.items);setNextCursor(h.value.nextCursor);}else setError(message(h.reason));
      }else if(companyId){const rows=await api<BillingCheckoutAttempts>(`/companies/${encodeURIComponent(companyId)}/checkouts${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`);if(g===generation.current){setAttempts(rows);setNextCursor(rows.nextCursor);}}
    })().catch(e=>{if(g===generation.current)setError(message(e));}).finally(()=>{if(g===generation.current)setLoading(false);});
    return()=>{generation.current++;};
  },[companyId,attemptId,operationId,cursor,reload]);
  function refresh(next=cursor){generation.current++;setReview(null);setOperation(null);setAttempts(null);setHistory([]);setLoading(true);setCursor(next);setReload(n=>n+1);}
  async function act(action:'preview'|'submit'|'cancel'|'run'){
    if(busy||loading)return;const g=generation.current;setBusy(true);setError('');
    try{
      if(action==='preview'){if(!review?.canExpire||!reason.trim())return;const row=await api<BillingCheckoutExpiryOperation>(`${path}/preview`,{reason,sourceHash:review.sourceHash});if(g===generation.current)router.push(`/system/billing/checkout-expiry/${encodeURIComponent(row.id)}`);}
      else if(operation){const row=await api<BillingCheckoutExpiryOperation>(`/checkout-expiry/${encodeURIComponent(operation.id)}/${action}`,{expectedVersion:operation.version,...action==='run'?{}:{previewHash:operation.previewHash}},action==='submit'?`checkout-expiry-submit-${operation.id}`:undefined);if(g===generation.current)setOperation(row);}
    }catch(e){if(g===generation.current)setError(message(e));}finally{if(g===generation.current)setBusy(false);}
  }
  const leave=()=>{generation.current++;};
  return <main className="mx-auto max-w-3xl space-y-5 break-words p-4 text-base sm:p-8">
    <h1 className="text-2xl font-bold">ตรวจหน้าชำระและรายการค้าง</h1>
    <p>ยุติได้เฉพาะหน้าที่ยังไม่จ่าย หากลูกค้าจ่ายสำเร็จก่อน ระบบจะตรวจการจ่ายและเปิดสิทธิ์ตามรายการเดิม</p>
    <nav className="flex flex-wrap gap-3">{company?<Link onClick={leave} className={billingLink} href={`/system/billing/companies/${encodeURIComponent(company)}`}>กลับไปบริษัท</Link>:<Link onClick={leave} className={billingLink} href="/system/billing">กลับหน้าดูแลการชำระเงิน</Link>}
      {company&&attempt&&<Link onClick={leave} className={billingLink} href={`/system/billing/companies/${encodeURIComponent(company)}/checkouts`}>รายการหน้าชำระของบริษัท</Link>}
      <button className={button} disabled={loading||busy} aria-busy={Boolean(loading || busy)} onClick={()=>refresh()}>โหลดรายการล่าสุด</button></nav>
    {loading&&<p role="status">กำลังตรวจข้อมูล…</p>}{busy&&<p role="status">กำลังดำเนินการกับคำขอนี้…</p>}{error&&<p role="alert" className="rounded-xl bg-red-50 p-3">{error}</p>}
    {attempts&&<section className="space-y-3" aria-label="หน้าชำระของบริษัท"><h2 className="font-bold">{attempts.companyName}</h2>{!attempts.items.length&&<p>ยังไม่มีรายการหน้าชำระ</p>}
      {attempts.items.map(a=><Link onClick={leave} className="block min-h-11 space-y-2 rounded-xl border border-gray-200 p-4 underline bg-white" key={a.id} href={`/system/billing/companies/${encodeURIComponent(a.companyId)}/checkouts/${encodeURIComponent(a.id)}`}>
        {time(a.createdAt)} · {a.channel==='line'?'จาก LINE':'จากเว็บ'}<span className="block">{billingLabel('attempt',a.state)} · {a.hasCheckout?'มีรายการให้ตรวจ':'กำลังหารายการเดิม'}</span></Link>)}
    </section>}
    {review&&<section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white"><h2 className="font-bold">{review.companyName}</h2><p>{review.mode==='TEST'?'โหมดทดสอบ · ไม่มีการรับเงินจริง':'โหมดใช้งานจริง'}</p>
      {review.providerState&&<p className="font-bold">{providerStates[review.providerState]}</p>}{review.paymentState&&<p>{paymentStates[review.paymentState]}</p>}{review.expiresAt&&<p>หน้าชำระหมดอายุ {time(review.expiresAt)}</p>}
      {review.canExpire?<form className="space-y-3" onSubmit={e=>{e.preventDefault();void act('preview');}}><div><label className="block" htmlFor="checkout-expiry-reason">เหตุผลที่ต้องยุติหน้าชำระ</label><textarea id="checkout-expiry-reason" className="mangmee-input !text-base mt-1 block min-h-11 w-full rounded-lg border border-gray-200 p-2" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} required disabled={busy}/></div>
        <button className={button} disabled={busy||loading} aria-busy={Boolean(busy || loading)}>ตรวจผลกระทบก่อนยืนยัน</button></form>:<p>{errors[review.blockedReason??'']??'ตรวจสถานะล่าสุดที่หน้าบริษัท'}</p>}
    </section>}
    {operation&&<section className="space-y-3 rounded-xl border border-gray-200 p-4 bg-white" aria-label="คำขอยุติหน้าชำระ"><h2 className="font-bold" aria-live="polite">{state(operation.state)}</h2><p>{operation.companyName} · {operation.scope.mode==='TEST'?'โหมดทดสอบ · ไม่มีการรับเงินจริง':'โหมดใช้งานจริง'}</p>
      <p>เหตุผล: {operation.reason}</p><p>เมื่อยุติสำเร็จ ลูกค้าจะใช้ลิงก์ชำระเดิมไม่ได้ วันและใบเสร็จที่เคยซื้อยังอยู่ตามเดิม</p>
      <p>คำขอนี้ไม่ยกเลิกแพ็กเกจและไม่คืนเงิน หากต้องหยุดต่ออายุ ให้กลับไปตรวจที่หน้าบริษัท</p>
      {operation.providerState&&<p className="font-bold">{providerStates[operation.providerState]}</p>}{operation.paymentState&&<p>{paymentStates[operation.paymentState]}</p>}
      {operation.providerState&&operation.providerState!=='open'&&<p role="status">{operation.reconciliationPending?'ยังตรวจสถานะในระบบไม่ครบ กลับไปบริษัทแล้วตรวจรายการเดิมต่อ':'ระบบตรวจสถานะรายการเดิมแล้ว ดูสิทธิ์ล่าสุดที่หน้าบริษัท'}</p>}
      {operation.errorCode&&<p role="alert">{errors[operation.errorCode]??'ยังตรวจผลไม่ครบ เปิดคำขอเดิมหรือเคสเพื่อตรวจต่อ'}</p>}
      <div className="flex flex-wrap gap-3">{operation.allowedActions.map(action=><button className={button} key={action} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>void act(action)}>{({submit:'ยืนยันยุติหน้าชำระ',cancel:'ยกเลิกคำขอที่ยังไม่ส่ง',run:'ตรวจและดำเนินการคำขอเดิม'})[action]}</button>)}</div>
      {operation.state==='PREVIEW'&&<p>ยังไม่ยุติจนกว่าคุณจะกดยืนยัน ตรวจคำขอได้ถึง {time(operation.expiresAt)}</p>}
      {path&&<Link onClick={leave} className={button} href={`/system/billing${path}`}>เปิดหน้าชำระเดิมและประวัติคำขอ</Link>}
      {operation.reviewCaseId&&<Link onClick={leave} className={button} href={`/system/billing/issues/${encodeURIComponent(operation.reviewCaseId)}`}>เปิดเคสให้เจ้าหน้าที่ตรวจ</Link>}
      <details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิง</summary><p className="break-all">เลขคำขอ {operation.id}</p><p>บันทึก {time(operation.createdAt)} · ตรวจผล {time(operation.observedAt)}</p></details>
    </section>}
    {companyId&&attemptId&&!loading&&<section className="space-y-3" aria-label="ประวัติคำขอของหน้าชำระนี้"><h2 className="font-bold">ประวัติคำขอของหน้าชำระนี้</h2>{!history.length&&<p>ไม่พบคำขอในหน้านี้</p>}
      {history.map(op=><Link onClick={leave} className="block min-h-11 space-y-2 rounded-xl border border-gray-200 p-4 underline bg-white" key={op.id} href={`/system/billing/checkout-expiry/${encodeURIComponent(op.id)}`}>{state(op.state)} · {time(op.createdAt)}<span className="block">{op.reason}</span></Link>)}
    </section>}
    {!operationId&&<div className="flex flex-wrap gap-3">{nextCursor&&<button className={button} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>refresh(nextCursor)}>รายการหน้าถัดไป</button>}{cursor&&<button className={button} disabled={busy||loading} aria-busy={Boolean(busy || loading)} onClick={()=>refresh(null)}>กลับไปหน้าแรก</button>}</div>}
  </main>;
}
