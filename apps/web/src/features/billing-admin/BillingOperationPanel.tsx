'use client';
import { billingLeavesPage, billingControl, billingPrimaryControl, billingLabel, billingDeliveryLabel } from '../billing/billing-display';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import BillingOperationDetail, { billingRepairTask } from './BillingOperationDetail';
import type { BillingRepairOperation } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';
const button = billingControl;
const labels: Record<string, string> = { PREVIEW: 'ตรวจสอบก่อนส่งคำสั่ง', QUEUED: 'รอระบบตรวจสอบ', RUNNING: 'กำลังตรวจสอบ', SUCCEEDED: 'ตรวจสอบสถานะล่าสุดแล้ว',
  UNKNOWN: 'ยังยืนยันผลไม่ได้', BLOCKED: 'ต้องตรวจสอบสิทธิ์หรือเงื่อนไข', FAILED: 'ดำเนินการไม่สำเร็จ', CANCELLED: 'ยกเลิกคำสั่งตรวจสอบแล้ว' };
const label=(operation:BillingRepairOperation,guided=false)=>guided&&operation.type==='RETRY_APPLY'&&operation.state==='SUCCEEDED'?'ตรวจยืนยันการให้สิทธิ์จากใบเดิมแล้ว':operation.type==='IMPORT_INVOICE'&&operation.state==='SUCCEEDED'?'บันทึกใบแจ้งหนี้เดิมแล้ว':operation.type==='RETRY_NOTIFICATION'&&operation.state==='SUCCEEDED'?'นำรายการเดิมกลับเข้าคิวแล้ว':labels[operation.state]??'ต้องตรวจสอบสถานะ';
const api = <T,>(path: string, body?: unknown, key?: string) => authedApiFetch<T>(`/system/billing/operations${path}`, {
  cache: 'no-store', suppressErrorToast: true, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) } }),
});
export default function BillingOperationPanel({ operationId, companyId, companyVersion, canReconcile = false,deliveryId,canRetry=false,canCheckDelivery=false,eventId,eventSourceHash,invoiceId,invoiceSourceHash,findingId,findingSourceHash,initialReason='',onSubmittedChange,sourceIssueId,onReloadSource,onCompleted,sourceIssueQuery='',returnHref,returnLabel }: {
  sourceIssueQuery?: string; returnHref?: string; returnLabel?: string; sourceIssueId?: string; onReloadSource?: ()=>void; onCompleted?: ()=>void;
  onSubmittedChange?: (submitted:boolean)=>void; initialReason?: string; operationId?: string; companyId?: string; companyVersion?: number; canReconcile?: boolean;deliveryId?:string;canRetry?:boolean;canCheckDelivery?:boolean;eventId?:string;eventSourceHash?:string;invoiceId?:string;invoiceSourceHash?:string;findingId?:string;findingSourceHash?:string;
}) {
  const guided=Boolean(initialReason),auditSuffix=sourceIssueId?` (ปัญหา ${sourceIssueId})`:'';
  const completed=useRef('');
  const generation=useRef(0),invalidate=()=>{generation.current++;};
  const leaving=(event:React.MouseEvent<HTMLAnchorElement>)=>{if(billingLeavesPage(event))invalidate();};
  const [operation, setOperation] = useState<BillingRepairOperation | null>(null), [reason, setReason] = useState('');
  const accept=(value:BillingRepairOperation)=>setOperation(current=>current?.id===value.id&&current.version>value.version?current:value);
  const [list, setList] = useState<{ items: BillingRepairOperation[]; nextCursor: string | null } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null), [reload, setReload] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pollEnded, setPollEnded] = useState(false);
  const [reading, setReading] = useState(Boolean(operationId));
  const operationHref=(id:string)=>`/system/billing/operations/${id}${sourceIssueId?`?issue=${encodeURIComponent(sourceIssueId)}${sourceIssueQuery.replace(/^\?/, '&')}`:''}`;
  useEffect(()=>{invalidate();setOperation(null);setList(null);setCursor(null);setReason(initialReason);setBusy(false);setError('');setPollEnded(false);completed.current='';return invalidate;},[operationId,companyId,deliveryId,eventId,invoiceId,findingId,initialReason,sourceIssueId]);
  useEffect(() => {
    const token=generation.current;let active = true;
    if(operationId)setReading(true);
    const load = operationId ? api<BillingRepairOperation>(`/${encodeURIComponent(operationId)}`).then(value => { if (active&&token===generation.current) accept(value); }) :
      api<{ items: BillingRepairOperation[]; nextCursor: string | null }>(`?${eventId?`referenceId=${encodeURIComponent(eventId)}`:`companyId=${encodeURIComponent(companyId!)}`}${deliveryId||invoiceId||findingId?`&referenceId=${encodeURIComponent(deliveryId??invoiceId??findingId!)}`:''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        .then(value => { if (active&&token===generation.current) setList(value); });
    load.catch(error => { if (active&&token===generation.current) { if([401,403,404].includes(error?.status)){setOperation(null);setList(null);} setError(operationId ? [401,403,404].includes(error?.status) ? 'เปิดรายการนี้ไม่ได้ อาจไม่มีสิทธิ์เข้าถึงหรือไม่พบรายการ' : 'อัปเดตข้อมูลไม่ได้ หากมีข้อมูลแสดงอยู่จะเป็นผลเดิม กรุณาลองอีกครั้ง' : 'โหลดคำสั่งล่าสุดไม่ได้ ข้อมูลที่แสดงยังเป็นผลเดิม กรุณาลองใหม่'); } }).finally(()=>{if(active&&token===generation.current)setReading(false);});
    return () => { active = false; };
  }, [operationId, companyId, deliveryId, eventId, invoiceId, findingId, cursor, reload]);
  const matches=operationId?operation?.id===operationId:companyId?operation?.scope.kind==='COMPANY'&&operation.scope.companyId===companyId&&
    (!(deliveryId||invoiceId||findingId)||operation.referenceId===(deliveryId??invoiceId??findingId)):!!eventId&&operation?.referenceId===eventId;
  // Server-observed commands only: previews/cancellations do not unlock the result step.
  const hasSubmitted=Boolean((matches&&operation&&['QUEUED','RUNNING','SUCCEEDED','UNKNOWN','BLOCKED','FAILED'].includes(operation.state))||list?.items.some(item=>
    item.type==='RETRY_APPLY'&&item.referenceId===invoiceId&&item.scope.kind==='COMPANY'&&item.scope.companyId===companyId&&['QUEUED','RUNNING','SUCCEEDED','UNKNOWN','BLOCKED','FAILED'].includes(item.state)));
  useEffect(()=>{onSubmittedChange?.(hasSubmitted);},[hasSubmitted,onSubmittedChange]);
  useEffect(()=>{
    if(!matches||!operation||!['SUCCEEDED','FAILED','BLOCKED','UNKNOWN'].includes(operation.state))return;
    const observed=`${operation.id}:${operation.version}`;
    if(completed.current!==observed){completed.current=observed;onCompleted?.();}
  },[matches,operation,onCompleted]);
  function refresh() {invalidate();setError('');setReload(value=>value+1);onReloadSource?.();}
  const inlineOperationId = operationId||!matches ? undefined : operation?.id;
  useEffect(() => {
    if (!inlineOperationId) return;
    const token=generation.current;let active = true;
    void api<BillingRepairOperation>(`/${inlineOperationId}`).then(value => { if (active&&token===generation.current) accept(value); })
      .catch(error => { if (active&&token===generation.current) { if([401,403,404].includes(error?.status))setOperation(null); setError('โหลดคำสั่งล่าสุดไม่ได้ ข้อมูลที่แสดงยังเป็นผลเดิม กรุณาลองใหม่'); } });
    return () => { active = false; };
  }, [inlineOperationId, reload]);
  useEffect(() => {
    if (!operation || !matches || !['QUEUED', 'RUNNING'].includes(operation.state)) return;
    setPollEnded(false);
    const token=generation.current;let active = true, polls = 0;
    const timer = window.setInterval(() => {
      if (++polls > 24) { window.clearInterval(timer); if (active&&token===generation.current) setPollEnded(true); return; }
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      void api<BillingRepairOperation>(`/${operation.id}`).then(value => { if (active&&token===generation.current) accept(value); }).catch(() => {});
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [operation?.id, operation?.state,matches,reload]);
  async function act(action: 'preview' | 'submit' | 'retry' | 'cancel') {
    if (busy||(action!=='preview'&&!matches)) return;const token=generation.current; setBusy(true); setError('');
    try {
      const value = action === 'preview' && eventId ? await authedApiFetch<BillingRepairOperation>(`/system/billing/provider-events/${eventId}/preview`,{method:'POST',suppressErrorToast:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceHash:eventSourceHash,reason})}) : action === 'preview' ? await api<BillingRepairOperation>('/preview', { type: findingId?'IMPORT_INVOICE':invoiceId?'RETRY_APPLY':deliveryId?(canCheckDelivery?'RECONCILE_NOTIFICATION':'RETRY_NOTIFICATION'):'RECONCILE', companyId, expectedVersion: companyVersion, reason:reason.trim()+auditSuffix,...findingId?{referenceId:findingId,findingSourceHash}:invoiceId?{referenceId:invoiceId,invoiceSourceHash}:deliveryId?{referenceId:deliveryId}:{} }) :
        action === 'submit' ? await api<BillingRepairOperation>('', { previewId: operation!.id, previewHash: operation!.previewHash, expectedVersion: operation!.version }, `billing-op-${operation!.id}`) :
          await api<BillingRepairOperation>(`/${operation!.id}/${action}`, { expectedVersion: operation!.version });
      if(token===generation.current){accept(value); setPollEnded(false); setReload(v => v + 1);}
    } catch (error) { if(token===generation.current)setError(apiErrorMessage(error)); }
    finally { if(token===generation.current)setBusy(false); }
  }
  // Keep the command controller shared; history detail only changes presentation.
  if(operationId)return <section aria-label="คำสั่งตรวจสอบการชำระเงิน" aria-busy={busy||reading} className="space-y-4">
    {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"><p>{error}</p><button type="button" className={`${button} mt-3`} disabled={busy||reading} aria-busy={Boolean(busy)} onClick={refresh}>ลองโหลดข้อมูลอีกครั้ง</button></div>}
    {operation&&matches?<BillingOperationDetail operation={operation} busy={busy||reading} stale={Boolean(error)} pollEnded={pollEnded} returnHref={returnHref} returnLabel={returnLabel} onRefresh={refresh} onAct={action=>void act(action)} leaving={leaving}/>
      : <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-6">{reading&&<p role="status">กำลังโหลดรายละเอียด…</p>}<Link onClick={leaving} className={button} href={returnHref??'/system/billing'}>{returnLabel??'กลับหน้าการชำระเงิน'}</Link></div>}
  </section>;
  const reasonField=<label className="block">เหตุผลการตรวจสอบ<input className="mangmee-input mt-2 block w-full !text-base" value={reason} maxLength={500-auditSuffix.length} onChange={e=>setReason(e.target.value)}/></label>;
  const history=<>
    {guided&&sourceIssueId&&<div className="space-y-1 text-sm text-gray-600"><p>เลขปัญหาใช้ค้นประวัติในมั่งมี ระบบแนบให้เอง ไม่ต้องกรอกหรือจำ</p><p className="break-all">เลขปัญหา: {sourceIssueId}</p></div>}
    {guided&&operation&&matches&&<div className="space-y-2 text-sm text-gray-600"><p className="whitespace-pre-wrap break-words">เหตุผลที่บันทึก: {operation.reason}</p><p>เลขการดำเนินการใช้ค้นผลตรวจและประวัติของครั้งนี้</p><p className="break-all">เลขการดำเนินการ: {operation.id}</p><Link onClick={leaving} className="inline-flex min-h-11 items-center text-brand-800 underline" href={operationHref(operation.id)}>เปิดรายละเอียดการดำเนินการนี้</Link></div>}
    {list&&<div className="space-y-2">{list.items.filter(item=>!guided||item.id!==operation?.id||operation?.state==='CANCELLED').map(item=><p key={item.id}><Link onClick={leaving} className="inline-flex min-h-11 items-center break-words text-brand-800 underline" href={operationHref(item.id)}>{label(item)} · {guided?new Date(item.createdAt).toLocaleString('th-TH'):item.reason}</Link></p>)}</div>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} aria-busy={busy} onClick={refresh}>{guided?'อัปเดตข้อมูล':'โหลดคำสั่งล่าสุด'}</button>
      {list?.nextCursor&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>{invalidate();setCursor(list.nextCursor);}}>คำสั่งหน้าถัดไป</button>}
      {cursor&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>{invalidate();setCursor(null);}}>คำสั่งหน้าแรก</button>}</div>
  </>;
  return <section className={guided?'space-y-4':'space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5'} aria-label="คำสั่งตรวจสอบการชำระเงิน">
    {!guided&&<><h2 className="text-lg font-semibold text-gray-900">ตรวจสอบและกู้คืนรายการเดิม</h2>
    <p className="text-gray-600">ระบบตรวจหลักฐานล่าสุดและดำเนินการรายการที่มีอยู่ตามนโยบาย ผลการตรวจแยกจากการปิดเคสและการชำระเงินสำเร็จ</p></>}
    {error && <div role="alert" className="space-y-2 rounded-lg bg-red-50 p-3 text-red-800"><p>{error}</p>{guided&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={refresh}>ลองโหลดข้อมูลอีกครั้ง</button>}</div>}
    {findingId&&<p>ตรวจหลักฐานการจ่ายฉบับเต็มแล้วบันทึกใบแจ้งหนี้เดิมไว้ให้ตรวจสิทธิ์ต่อ คำสั่งนี้ไม่เรียกเก็บเงินและไม่เพิ่มสิทธิ์</p>}
    {deliveryId&&(canRetry||canCheckDelivery)&&<p>{canCheckDelivery?'ตรวจสอบผลอีเมลเดิมกับ Postmark คำสั่งนี้ไม่ส่งอีเมลใหม่':'นำรายการแจ้งเตือนเดิมกลับเข้าคิว โดยคงผู้รับ ข้อความ และประวัติเดิม ไม่มีการเรียกเก็บเงินหรือเพิ่มสิทธิ์'}</p>}
    {guided&&operation?.state==='CANCELLED'&&<p role="status" className="text-gray-600">ยกเลิกการดำเนินการครั้งนี้แล้ว</p>}
    {(companyId||eventId)&&(canReconcile||canRetry||canCheckDelivery)&&(!guided||!operation||operation.state==='CANCELLED')&&<div className="space-y-3">
      {guided?<details><summary className="min-h-11 cursor-pointer py-2 text-sm text-gray-600">บันทึกเหตุผล (ระบบใส่ให้แล้ว)</summary><div className="pb-2">{reasonField}</div></details>:reasonField}
      <button className={guided?billingPrimaryControl:button} disabled={busy||!reason.trim()} aria-busy={busy} onClick={()=>void act('preview')}>{guided?'ตรวจสอบรายการนี้':'ตรวจสอบผลกระทบ'}</button>
    </div>}
    {operation && matches && (!guided||operation.state!=='CANCELLED') && <article className={guided?"space-y-3":"space-y-3 rounded-xl bg-gray-50 p-4"} aria-label="สถานะคำสั่ง">
      <h3 className="font-bold" role="status">{guided&&operation.state==='PREVIEW'?'ตรวจข้อมูลก่อนยืนยัน':label(operation,guided)}</h3>
      {!guided&&<><p>{billingLabel('mode',operation.scope.mode)} · {operation.scope.kind === 'COMPANY' ? 'คำสั่งของบริษัทที่เลือก' : 'คำสั่งระดับระบบ'}</p>
      <p>{operation.reason}</p><details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงคำสั่ง</summary><p className="break-all">เลขคำสั่ง {operation.id} · รุ่นข้อมูล {operation.version}</p><p className="break-all">{operation.scope.kind==='COMPANY'?operation.scope.companyId:'ระดับระบบ'}</p></details></>}
      {guided&&operation.state==='PREVIEW'&&<p className="text-gray-600">{operation.type!=='RETRY_APPLY'?billingRepairTask(operation.type).effect:operation.invoiceImpact?.beforeState==='APPLIED'?'เมื่อยืนยัน ระบบจะตรวจสิทธิ์เดิมเพื่อปิดปัญหาที่ค้าง โดยไม่เพิ่มวันหรือโควตาซ้ำ':'เมื่อยืนยัน ระบบจะตรวจยอดชำระและเงื่อนไขจากรายการเดิม แล้วเปิดใช้แพ็กเกจให้ลูกค้าเมื่อผ่านการตรวจ โดยไม่เรียกเก็บเงินเพิ่ม'}</p>}
      {operation.findingImpact&&<p>ตรวจผลเดิม ใบแจ้งหนี้จากผลตรวจเดิม · สถานะตอนพบ {billingLabel('payment',operation.findingImpact.beforeState)} · สร้างเมื่อ {new Date(operation.findingImpact.invoiceCreatedAt).toLocaleString('th-TH')} · บันทึกหลักฐานอย่างเดียว แล้วตรวจการให้สิทธิ์แยกอีกขั้น</p>}
      {operation.invoiceImpact&&<p>{guided?'รอบของรายการชำระเดิม: ':`ใบเสร็จเดิม · ก่อนตรวจ ${billingLabel('apply',operation.invoiceImpact.beforeState)} · `}{new Date(operation.invoiceImpact.periodStart).toLocaleString('th-TH')} ถึง {new Date(operation.invoiceImpact.periodEnd).toLocaleString('th-TH')}</p>}
      {operation.observed?.invoiceApplyState&&<p>ผลของใบเสร็จเดิม: {billingLabel('apply',operation.observed.invoiceApplyState)} · สิทธิ์ปัจจุบันและเงื่อนไขอื่นตรวจได้ที่ข้อมูลบริษัท</p>}
      {operation.type==='RETRY_APPLY'&&!operation.invoiceImpact&&<p>คำสั่งเก่ายังไม่ได้ผูกใบเสร็จ ยกเลิกคำสั่งนี้แล้วเลือกใบเสร็จเดิมเพื่อตรวจใหม่</p>}
      {operation.eventImpact&&<p>เหตุการณ์ Stripe เดิม · {billingLabel('event',operation.eventImpact.beforeState)} · ตรวจแล้ว {operation.eventImpact.attempts} ครั้ง · ตรวจหลักฐานใหม่จากรายการเดิม</p>}
      {operation.deliveryImpact&&<div className="space-y-2"><p>{billingLabel('channel',operation.deliveryImpact.channel)} · {billingDeliveryLabel(operation.deliveryImpact.beforeState,operation.deliveryImpact.channel)} → {billingDeliveryLabel(operation.deliveryImpact.afterState,operation.deliveryImpact.channel)}</p>
        <p className="break-all">ผู้รับเดิม {operation.deliveryImpact.recipientName??'ตรวจชื่อได้จากรายการส่งต้นทาง'}</p><p>พยายามส่งมาแล้ว {operation.deliveryImpact.attemptCount} ครั้ง</p>
        {operation.deliveryImpact.possibleDuplicate&&<p role="alert">ผลการส่งเดิมยังยืนยันไม่ได้ การส่งใหม่อาจทำให้ผู้รับได้รับซ้ำ</p>}{operation.deliveryImpact.channel==='LINE'&&<p>{operation.deliveryImpact.retryUntil?`นำรายการเดิมกลับเข้าคิวได้ถึง ${new Date(operation.deliveryImpact.retryUntil).toLocaleString('th-TH')}`:'เริ่มนับเวลาส่งซ้ำเมื่อส่งคำขอครั้งแรก'}</p>}</div>}
      {!guided && operation.observed && !operation.observed.eventState && <p>เคสที่ยังเปิด {operation.observed.issueCount} · {operation.observed.pendingAttemptId ? 'ยังมีรายการชำระเงินที่ต้องตามผล' : 'ไม่มีรายการซื้อค้าง'}</p>}
      {operation.observed?.eventState&&<p>ผลตรวจเหตุการณ์: {billingLabel('event',operation.observed.eventState)} · ผลชำระเงินและสิทธิ์ดูได้จากข้อมูลบริษัทที่เชื่อมโยง</p>}
      {operation.observed?.deliveryState&&<p>สถานะรายการส่งที่ตรวจพบ: {billingDeliveryLabel(operation.observed.deliveryState,operation.deliveryImpact?.channel)}</p>}
      {['RETRY_NOTIFICATION','RECONCILE_NOTIFICATION'].includes(operation.type)&&<p>ผลคำสั่งนี้ไม่ใช่หลักฐานว่าลูกค้าได้รับข้อความ ให้ตรวจสถานะรายการส่งเดิม</p>}
      {pollEnded && <p>ยังรอผล สามารถกลับมาเปิดคำสั่งเดิมหรือโหลดข้อมูลล่าสุดได้</p>}
      {operation.errorCode && <p>เปิดรายการต้นทางและเคสเพื่อตรวจเงื่อนไขก่อนดำเนินการต่อ</p>}
      <div className="flex flex-wrap gap-2">{operation.allowedActions.map(action => <button key={action} className={initialReason&&action!=='cancel'?billingPrimaryControl:button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void act(action)}>{action === 'submit' ? guided?'ยืนยันแก้ไขรายการนี้':'ยืนยันส่งคำสั่งตรวจสอบ' : action === 'retry' ? 'ตรวจสอบคำสั่งเดิมอีกครั้ง' : guided?'ยกเลิกการตรวจครั้งนี้':'ยกเลิกคำสั่งตรวจสอบ'}</button>)}</div>
      {!guided&&<div className="flex flex-wrap gap-3"><Link onClick={leaving} className="underline" href={operationHref(operation.id)}>เปิดลิงก์คำสั่งนี้</Link>
        {['RETRY_NOTIFICATION','RECONCILE_NOTIFICATION'].includes(operation.type)&&operation.scope.kind==='COMPANY'&&operation.referenceId&&<Link onClick={leaving} className="underline" href={`/system/billing/companies/${encodeURIComponent(operation.scope.companyId)}/deliveries/${operation.referenceId}`}>เปิดรายการส่งเดิม</Link>}
        {operation.type==='IMPORT_INVOICE'&&operation.scope.kind==='COMPANY'&&operation.referenceId&&<><Link onClick={leaving} className="underline" href={`/system/billing/companies/${encodeURIComponent(operation.scope.companyId)}/invoice-findings/${operation.referenceId}`}>กลับผลตรวจใบแจ้งหนี้เดิม</Link>
          {operation.observed?.invoiceId&&<Link onClick={leaving} className="underline" href={`/system/billing/companies/${encodeURIComponent(operation.scope.companyId)}/apply-invoices/${operation.observed.invoiceId}`}>ตรวจการให้สิทธิ์จากใบแจ้งหนี้ที่บันทึก</Link>}</>}
        {operation.type==='RETRY_APPLY'&&operation.scope.kind==='COMPANY'&&<Link onClick={leaving} className="underline" href={`/system/billing/companies/${encodeURIComponent(operation.scope.companyId)}/apply-invoices${operation.referenceId?`/${operation.referenceId}`:''}`}>กลับไปใบเสร็จเดิมหรือเลือกรายการ</Link>}
        {operation.type==='RETRY_PROVIDER_EVENT'&&operation.referenceId&&<Link onClick={leaving} className="underline" href={`/system/billing/provider-events/${operation.referenceId}`}>กลับไปเหตุการณ์เดิม</Link>}
        {operation.scope.kind === 'COMPANY' && <Link onClick={leaving} className="underline" href={`/system/billing/companies/${encodeURIComponent(operation.scope.companyId)}`}>กลับไปบริษัท</Link>}</div>}
    </article>}
    {guided?<details className="border-t border-gray-100 pt-2"><summary className="min-h-11 cursor-pointer py-2 text-sm text-gray-600">ประวัติและข้อมูลอ้างอิง</summary><div className="space-y-3 pt-2">{history}</div></details>:history}
  </section>;
}
