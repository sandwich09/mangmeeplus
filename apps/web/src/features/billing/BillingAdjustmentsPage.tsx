'use client';
import Link from 'next/link';
import BillingCustomerFrame from './BillingCustomerFrame';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { billingControl, billingField, billingLabel, billingLink, billingSupportReference } from './billing-display';
import { useEffect, useRef, useState } from 'react';
import type { BillingAdjustmentKind, BillingAdjustments, BillingDocumentResendResult, BillingEndPackageReview, BillingRecipientAdminReview } from '@watchdog-bms/contracts';
import { billingRecipientSourceLabel } from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { PLAN_TERM_CONTACT_EMAIL } from '@/features/plan-term/plan-term.logic';
import { billingApi } from './billing.api';
import { billingResendText } from './billing-error-text';

const button=billingControl;
const money=(n:number)=>new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(n/100);
const time=formatThaiDateTime;
const documentError=(cause:unknown)=>{
  const status=(cause as {status?:number})?.status,code=apiErrorCode(cause);
  if(status===401||status===403)return {title:'บัญชีนี้เปิดเอกสารไม่ได้',detail:'กลับไปเลือกรายการที่คุณมีสิทธิ์ดู หากเพิ่งเปลี่ยนบัญชี ให้เข้าสู่ระบบอีกครั้ง',kind:'access'};
  if(status===404)return {title:'ไม่พบเอกสารของรายการนี้',detail:'กลับไปเลือกรายการชำระเงินของบริษัทอีกครั้ง',kind:'missing'};
  if(code==='BILLING_DOCUMENT_BINDING')return {title:'ข้อมูลรายการนี้ยังยืนยันกับ Stripe ไม่ได้',detail:'ระบบยังเปิดเอกสารไม่ได้ เพราะข้อมูลการชำระเงินของรายการนี้ไม่ตรงหรือไม่ครบสำหรับตรวจสอบกับ Stripe',kind:'binding'};
  if(code==='BILLING_DOCUMENT_PENDING')return {title:'เอกสารยังไม่พร้อมเปิด',detail:'Stripe ยังไม่มีเอกสารหรือหลักฐานที่ครบสำหรับรายการนี้ ลองตรวจข้อมูลอีกครั้งภายหลัง',kind:'pending'};
  if(code==='BILLING_NOT_CONFIGURED'||status===503)return {title:'ยังเชื่อมต่อเอกสารจาก Stripe ไม่ได้',detail:'ตรวจสถานะการเชื่อมต่อ แล้วกลับมาอ่านรายการเดิมอีกครั้ง',kind:'connection'};
  return {title:'อ่านข้อมูลจาก Stripe ไม่สำเร็จ',detail:'ลองอ่านข้อมูลอีกครั้ง ระบบยังไม่ได้เปลี่ยนยอดเงินหรือแพ็กเกจ',kind:'retry'};
};
const labels={pending:'รอดำเนินการคืนเงิน',requires_action:'ต้องทำขั้นตอนเพิ่มเติม',succeeded:'Stripe ดำเนินการคืนเงินสำเร็จ',failed:'คืนเงินไม่สำเร็จ',canceled:'ยกเลิกการคืนเงิน',unknown:'ยังยืนยันสถานะคืนเงินไม่ได้',issued:'ออกเอกสารแล้ว',void:'เอกสารถูกยกเลิก'};
export default function BillingAdjustmentsPage({companyId,invoiceId,admin=false,preview}:{companyId:string;invoiceId:string;admin?:boolean;preview?: { read: (kind: BillingAdjustmentKind) => Promise<BillingAdjustments>; open: (kind: string) => void; back: () => void; resend?: () => Promise<BillingDocumentResendResult> }}) {
  const base=admin?`/system/billing/companies/${encodeURIComponent(companyId)}`:`/companies/${encodeURIComponent(companyId)}/billing`;
  const back=admin?`${base}?view=payments`:`/companies/${encodeURIComponent(companyId)}/billing#billing-history`;
  const [kind,setKind]=useState<BillingAdjustmentKind>('refunds'),[cursor,setCursor]=useState<string|null>(null),[reload,setReload]=useState(0);
  const [data,setData]=useState<BillingAdjustments|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<ReturnType<typeof documentError>|null>(null),[opening,setOpening]=useState(false);
  const [adjustmentsOpen,setAdjustmentsOpen]=useState(!admin);
  const [resend,setResend]=useState<{busy:boolean;result:BillingDocumentResendResult|null;error:string}>({busy:false,result:null,error:''});
  const [endReview,setEndReview]=useState<BillingEndPackageReview|null>(null),[endReviewError,setEndReviewError]=useState(false),[endOpen,setEndOpen]=useState(false),[endReason,setEndReason]=useState(''),[endPassword,setEndPassword]=useState(''),[endBusy,setEndBusy]=useState(false),[endMessage,setEndMessage]=useState('');
  // Purchase without setup PR E (R-E1/R-E2): document recipient + resend.
  const [recipientReview,setRecipientReview]=useState<BillingRecipientAdminReview|null>(null),[recipientReviewError,setRecipientReviewError]=useState(false);
  const [resendOpen,setResendOpen]=useState(false),[resendReason,setResendReason]=useState(''),[resendPassword,setResendPassword]=useState(''),[resendSupportRequestId,setResendSupportRequestId]=useState(''),[resendBusy,setResendBusy]=useState(false),[resendMessage,setResendMessage]=useState(''),[resendResult,setResendResult]=useState<BillingDocumentResendResult|null>(null);
  const generation=useRef(0);
  useEffect(()=>{
    if(!admin||preview)return;let active=true;setEndReview(null);setEndReviewError(false);
    void authedApiFetch<BillingEndPackageReview>(`${base}/invoices/${encodeURIComponent(invoiceId)}/end-package`,{cache:'no-store',suppressErrorToast:true}).then(value=>{if(active)setEndReview(value);}).catch(()=>{if(active)setEndReviewError(true);});
    return()=>{active=false;};
  },[admin,preview,base,invoiceId,reload]);
  useEffect(()=>{
    if(!admin||preview)return;let active=true;setRecipientReview(null);setRecipientReviewError(false);
    void authedApiFetch<BillingRecipientAdminReview>(`${base}/invoices/${encodeURIComponent(invoiceId)}/recipient-review`,{cache:'no-store',suppressErrorToast:true}).then(value=>{if(active)setRecipientReview(value);}).catch(()=>{if(active)setRecipientReviewError(true);});
    return()=>{active=false;};
  },[admin,preview,base,invoiceId,reload]);
  async function adminResend(){
    if(resendBusy||!resendReason.trim()||!resendPassword)return;setResendBusy(true);setResendMessage('');
    const post=<T,>(path:string,body:unknown)=>authedApiFetch<T>(path,{method:'POST',cache:'no-store',suppressErrorToast:true,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    try{
      await post(`${base}/reauthenticate`,{password:resendPassword});
      const result=await post<BillingDocumentResendResult>(`${base}/invoices/${encodeURIComponent(invoiceId)}/resend`,
        {reason:resendReason,...resendSupportRequestId.trim()?{supportRequestId:resendSupportRequestId.trim()}:{}});
      setResendResult(result);setResendOpen(false);setResendReason('');setResendSupportRequestId('');
      setResendMessage(`ส่งใบแจ้งหนี้ไปที่ ${result.recipientEmail} แล้ว ${result.receiptUpdated?'และส่งใบเสร็จอีกครั้งแล้ว':'ใบเสร็จไม่ส่งซ้ำเพราะอีเมลไม่เปลี่ยน ให้เปิดใบเสร็จแล้วส่งลิงก์ให้ลูกค้าแทน'}`);
    }catch(cause){setResendMessage(apiErrorMessage(cause));}
    finally{setResendPassword('');setResendBusy(false);}
  }
  async function endPackage(){
    if(endBusy||!endReason.trim()||!endPassword)return;setEndBusy(true);setEndMessage('');
    const post=<T,>(path:string,body:unknown)=>authedApiFetch<T>(path,{method:'POST',cache:'no-store',suppressErrorToast:true,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    try{
      await post(`${base}/reauthenticate`,{password:endPassword});
      setEndReview(await post<BillingEndPackageReview>(`${base}/invoices/${encodeURIComponent(invoiceId)}/end-package`,{reason:endReason}));
      setEndOpen(false);setEndReason('');setEndMessage('ยุติแพ็กเกจแล้ว ร้านเข้าได้เฉพาะหน้าตั้งค่าและหน้าแพ็กเกจ ข้อมูลยังเก็บไว้ครบ');
    }catch(cause){setEndMessage(apiErrorMessage(cause));}
    finally{setEndPassword('');setEndBusy(false);}
  }
  useEffect(()=>{
    let active=true;setData(null);setOpening(false);setLoading(true);setError(null);
    void (preview ? preview.read(kind) : authedApiFetch<BillingAdjustments>(`${base}/invoices/${encodeURIComponent(invoiceId)}/adjustments/${kind}${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{
      cache:'no-store',suppressErrorToast:true,...!admin?{headers:{'X-Company-Id':companyId}}:{}
    })).then(value=>{if(active)setData(value);}).catch(cause=>{if(active)setError(documentError(cause));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;generation.current+=1;};
  },[base,invoiceId,kind,cursor,reload,admin,companyId,preview]);
  async function open(kind:'invoice'|'receipt'|'pdf'|'credit-note',creditNoteId?:string) {
    if(preview) { preview.open(kind); return; }
    if(opening)return;const started=generation.current;setOpening(true);setError(null);
    try {
      const result=await authedApiFetch<{url:string}>(`${base}/documents/${encodeURIComponent(invoiceId)}/open`,{method:'POST',suppressErrorToast:true,
        headers:{'Content-Type':'application/json',...!admin?{'X-Company-Id':companyId}:{}},body:JSON.stringify({kind,...creditNoteId?{creditNoteId}:{}})});
      if(started!==generation.current)return;
      const url=new URL(result.url);
      if(url.protocol!=='https:'||url.username||url.password||url.port||!['invoice.stripe.com','pay.stripe.com','payments.stripe.com'].includes(url.hostname))throw new Error('Unsafe document');
      window.location.assign(url.href);
    } catch(cause) {if(started===generation.current){setData(null);setError(documentError(cause));}}
    finally{if(started===generation.current)setOpening(false);}
  }
  // R-D1: the customer sends this invoice (and, when the email changed, its receipt) to the recipient again.
  async function resendDocument() {
    setResend({busy:true,result:null,error:''});
    try { setResend({busy:false,result:await (preview?.resend ? preview.resend() : billingApi(companyId).resendDocument(invoiceId)),error:''}); }
    catch(cause) { setResend({busy:false,result:null,error:apiErrorMessage(cause)}); }
  }
  const content = <>
    {admin && <><Link className={billingLink} href={back}>กลับไปประวัติการชำระเงิน</Link>
    <header><h1 className="text-2xl font-semibold text-gray-900">ใบแจ้งหนี้และใบเสร็จ</h1><p className="mt-2 text-gray-600">เปิดเอกสารจาก Stripe ของรายการชำระเงินนี้</p></header></>}
    {loading&&<p role="status">กำลังตรวจข้อมูลกับ Stripe…</p>}
    {error&&<section role="alert" className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 sm:p-6"><h2 className="text-lg font-semibold">{error.title}</h2><p className="text-gray-600">{!admin&&error.kind==='connection'?'การเชื่อมต่อยังไม่พร้อม กรุณาลองอีกครั้งภายหลัง':error.detail}</p>
      <div className="flex flex-wrap gap-3">{['retry','pending','connection'].includes(error.kind)&&<button className={button} disabled={loading||opening} onClick={()=>setReload(n=>n+1)}>ลองอ่านข้อมูลอีกครั้ง</button>}
      {admin&&error.kind==='connection'?<Link className={billingLink} href="/system/billing/configuration-checks">ดูสถานะการเชื่อมต่อ Stripe</Link>:<Link className={billingLink} href={back}>ดูรายการชำระเงินของ{admin?'บริษัท':'คุณ'}</Link>}
      {!admin&&<a className={billingLink} href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>ติดต่อทีมงาน</a>}</div>
    </section>}
    {data&&<>
      <section aria-label="เอกสารจาก Stripe" className="mangmee-card space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{data.invoiceNumber??'เอกสารของรายการนี้'}</h2><button className="min-h-11 px-2 text-sm text-gray-600 underline" disabled={loading||opening} onClick={()=>setReload(n=>n+1)}>อัปเดตข้อมูล</button></div>
        {data.canOpenDocuments?<div className="divide-y divide-gray-100">{([['receipt','ใบเสร็จรับเงิน','หลักฐานรับชำระเงินจากลูกค้า'],['invoice','ใบแจ้งหนี้','รายละเอียดราคาและยอดเรียกเก็บ'],['pdf','ไฟล์ PDF ใบแจ้งหนี้','สำหรับดาวน์โหลดและเก็บเอกสาร']] as const).map(([documentKind,title,description])=><div key={documentKind} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><h3 className="font-medium">{title}</h3><p className="mt-1 text-gray-600">{description}</p></div><button className={button} disabled={opening} onClick={()=>void open(documentKind)}>เปิด{title}</button></div>)}
          {!admin&&data.documentActions?.canResend&&<div className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><h3 className="font-medium">ส่งเอกสารไปอีเมลอีกครั้ง</h3><p className="mt-1 break-all text-gray-600">ส่งเอกสารของรายการนี้ไปที่ {data.recipientEmail??'อีเมลรับเอกสารของบริษัท'}</p>
            <a className={billingLink} href={`/companies/${encodeURIComponent(companyId)}/billing#billing-recipient`}>แก้อีเมลรับเอกสาร</a></div>
            <button className={button} disabled={resend.busy||opening} aria-busy={resend.busy} onClick={()=>void resendDocument()}>ส่งเอกสารไปอีเมลอีกครั้ง</button></div>}</div>:<p className="text-gray-600">บัญชีนี้ดูสถานะได้ แต่ไม่มีสิทธิ์เปิดเอกสาร</p>}
        {resend.result&&<p role="status" className="break-all rounded-xl bg-green-50 p-3">{billingResendText(resend.result)}</p>}
        {resend.error&&<p role="alert" className="rounded-xl bg-red-50 p-3">{resend.error}</p>}
        <p className="text-sm text-gray-500">{billingLabel('mode',data.mode)} · ตรวจข้อมูลเมื่อ {time(data.observedAt)}</p>
      </section>
      <details className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" open={adjustmentsOpen} onToggle={e=>setAdjustmentsOpen(e.currentTarget.open)}>
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">ประวัติคืนเงินและเอกสารปรับยอด</summary>
        <section aria-label="รายละเอียดการปรับยอด" className="mt-4 space-y-4">
          <p className="text-gray-600">ดูผลคืนเงินจาก Stripe และเอกสารปรับยอด ธนาคารอาจใช้เวลาบันทึกเงินคืน ส่วนแพ็กเกจลูกค้าต้องตรวจแยก</p>
          <label className="block max-w-sm">รายการที่ต้องการดู<ThemedSelect aria-label="รายการที่ต้องการดู" className="mt-2 min-h-11 w-full !text-base" value={kind} disabled={opening||loading} onChange={e=>{setKind(e.target.value as BillingAdjustmentKind);setCursor(null);}}><option value="refunds">รายการคืนเงิน</option><option value="credit-notes">เอกสารปรับยอด</option></ThemedSelect></label>
          {!data.items.length&&<p className="rounded-lg bg-gray-50 p-4 text-gray-600">{kind==='refunds'?'ยังไม่มีรายการคืนเงิน':'ยังไม่มีเอกสารปรับยอด'}</p>}
          {data.items.map(item=><article key={item.id} className="space-y-2 rounded-lg border border-gray-200 p-4"><h3 className="font-medium">{item.number??(data.kind==='refunds'?'รายการคืนเงิน':'เอกสารปรับยอด')}</h3><p>{money(item.amountSatang)} · {labels[item.status]}</p><p className="text-gray-600">{time(item.createdAt)}</p>
            {item.status==='requires_action'&&<p>{admin?'ตรวจคำแนะนำจาก Stripe และผลคำขอคืนเงินเดิมก่อนดำเนินการต่อ':'ตรวจอีเมลคำแนะนำจาก Stripe หรือติดต่อทีมงาน'}</p>}
            {(item.status==='failed'||item.status==='unknown')&&<p>{admin?'ตรวจผลคืนเงินของรายการเดิมใน Stripe ก่อนสร้างคำขอเพิ่ม':'ติดต่อทีมงานเพื่อตรวจรายการเดิมก่อนดำเนินการต่อ'}</p>}
            {data.kind==='credit-notes'&&data.canOpenDocuments&&<button className={button} disabled={opening} onClick={()=>void open('credit-note',item.id)}>เปิด PDF เอกสารปรับยอด</button>}
          </article>)}
          {data.nextCursor&&<button className={button} disabled={opening||loading} onClick={()=>setCursor(data.nextCursor)}>รายการหน้าถัดไป</button>}{cursor&&<button className={button} disabled={opening||loading} onClick={()=>setCursor(null)}>กลับไปหน้าแรก</button>}
        </section>
      </details>
      {admin&&<details className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6"><summary className="min-h-11 cursor-pointer py-2 font-medium text-gray-700">ต้องการคืนเงินให้ลูกค้า</summary><p className="py-3 text-gray-600">ตรวจคำขอเดิมและยอดที่คืนได้ก่อน ทุกคำขอต้องตรวจผลกระทบและยืนยัน</p><Link className={button} href={`${base}/invoices/${encodeURIComponent(invoiceId)}/refund`}>ตรวจหรือสร้างคำขอคืนเงิน</Link>
        {endReview?.canEnd&&<div className="mt-4 space-y-3 border-t border-gray-100 pt-4"><p className="text-gray-600">รายการนี้คืนเงินครบแล้ว และยังเป็นแพ็กเกจที่ร้านใช้งานอยู่ ยุติแพ็กเกจได้ทันที ร้านจะเข้าได้เฉพาะหน้าตั้งค่าและหน้าแพ็กเกจ ข้อมูลยังเก็บไว้ครบ</p>
          {!endOpen?<button className={button} onClick={()=>setEndOpen(true)}>ยุติแพ็กเกจของรายการนี้</button>:<form className="space-y-3" onSubmit={e=>{e.preventDefault();void endPackage();}}>
            <label className="block">เหตุผลภายใน (ลูกค้าไม่เห็น)<textarea className={billingField} required maxLength={500} value={endReason} disabled={endBusy} onChange={e=>setEndReason(e.target.value)}/></label>
            <label className="block">รหัสผ่านปัจจุบัน<input className={billingField} type="password" autoComplete="current-password" required maxLength={1024} value={endPassword} disabled={endBusy} onChange={e=>setEndPassword(e.target.value)}/></label>
            <div className="flex flex-wrap gap-3"><button className={button} disabled={endBusy||!endReason.trim()||!endPassword} aria-busy={endBusy}>ยืนยันยุติแพ็กเกจ</button><button type="button" className={button} disabled={endBusy} onClick={()=>setEndOpen(false)}>ยกเลิก</button></div>
          </form>}</div>}
        {endReviewError&&<p role="alert" className="mt-3 text-red-700">ยังโหลดข้อมูลส่วนนี้ไม่ได้ <button type="button" className="min-h-11 underline" onClick={()=>setReload(n=>n+1)}>ลองอีกครั้ง</button></p>}
        {endMessage&&<p role="status" className="mt-3">{endMessage}</p>}</details>}
      {admin&&(recipientReview||recipientReviewError)&&<details className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" open><summary className="min-h-11 cursor-pointer py-2 font-medium text-gray-700">เอกสารและผู้รับเอกสาร</summary>
        {recipientReview?<div className="space-y-3 py-3">
          <p className="text-gray-600">อีเมลรับเอกสารปัจจุบัน: {recipientReview.currentEmail??'ยังไม่มี'} · ที่มา: {billingRecipientSourceLabel(recipientReview.currentSource)}</p>
          {recipientReview.bouncedAt&&<p className="text-red-700">อีเมลนี้ตีกลับเมื่อ {time(recipientReview.bouncedAt)}</p>}
          {!resendOpen?<button className={button} onClick={()=>setResendOpen(true)}>ส่งเอกสารซ้ำ</button>:<form className="space-y-3" onSubmit={e=>{e.preventDefault();void adminResend();}}>
            <label className="block">เหตุผลภายใน (ลูกค้าไม่เห็น)<textarea className={billingField} required maxLength={500} value={resendReason} disabled={resendBusy} onChange={e=>setResendReason(e.target.value)}/></label>
            <div><label className="block" htmlFor="document-resend-support-request">เลขคำขอคุยกับเจ้าหน้าที่ (ถ้ามี)</label><input id="document-resend-support-request" className={billingField} maxLength={64} value={resendSupportRequestId} disabled={resendBusy} onChange={e=>setResendSupportRequestId(e.target.value)}/></div>
            <label className="block">รหัสผ่านปัจจุบัน<input className={billingField} type="password" autoComplete="current-password" required maxLength={1024} value={resendPassword} disabled={resendBusy} onChange={e=>setResendPassword(e.target.value)}/></label>
            <div className="flex flex-wrap gap-3"><button className={button} disabled={resendBusy||!resendReason.trim()||!resendPassword} aria-busy={resendBusy}>ส่งอีกครั้ง</button><button type="button" className={button} disabled={resendBusy} onClick={()=>setResendOpen(false)}>ยกเลิก</button></div>
          </form>}
          {resendMessage&&<p role="status">{resendMessage}</p>}
          {resendResult&&<button className={button} disabled={opening} onClick={()=>void open('receipt')}>เปิดใบเสร็จรับเงิน</button>}
          {recipientReview.canChange?<Link className={billingLink} href={`${base}/invoices/${encodeURIComponent(invoiceId)}/recipient`}>เปลี่ยนอีเมลผู้รับเอกสาร</Link>
            :recipientReview.blockedReason&&<p className="text-gray-600">{{BILLING_RECIPIENT_BUSY:'บริษัทมีรายการซื้อ คำสั่งต่ออายุ หรือคำขอเปลี่ยนผู้รับของลูกค้าค้างอยู่ รอให้เสร็จก่อนเปลี่ยนอีเมลผู้รับ',BILLING_RECIPIENT_NO_CUSTOMER:'บริษัทนี้ยังไม่มีบัญชีลูกค้าใน Stripe จึงยังไม่มีผู้รับเอกสารให้เปลี่ยน'}[recipientReview.blockedReason]??'ยังเปลี่ยนผู้รับเอกสารไม่ได้ในตอนนี้'}</p>}
        </div>:<p role="alert" className="py-3 text-red-700">ยังโหลดข้อมูลส่วนนี้ไม่ได้ <button type="button" className="min-h-11 underline" onClick={()=>setReload(n=>n+1)}>ลองอีกครั้ง</button></p>}
      </details>}
    </>}
    <details className="text-sm text-gray-600"><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงสำหรับตรวจสอบ</summary><p className="break-all">รหัสรายการ ใช้ค้นประวัติในระบบ: {billingSupportReference(invoiceId)}</p></details>
  </>;
  return admin ? <main className="mx-auto max-w-4xl space-y-5 break-words p-4 text-base sm:p-8">{content}</main>
    : <BillingCustomerFrame title="เอกสารการชำระเงิน" description="เปิดเอกสารจาก Stripe ของรายการชำระเงินนี้" backHref={back} backLabel="กลับไปประวัติการชำระเงิน" onBack={preview?.back} showBackInWorkspace>{content}</BillingCustomerFrame>;
}
