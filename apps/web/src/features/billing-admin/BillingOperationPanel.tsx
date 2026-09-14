'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { BillingRepairOperation } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
const button = 'inline-block rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-50';
const labels: Record<string, string> = { PREVIEW: 'ตรวจสอบก่อนส่งคำสั่ง', QUEUED: 'รอระบบตรวจสอบ', RUNNING: 'กำลังตรวจสอบ', SUCCEEDED: 'ตรวจสอบสถานะล่าสุดแล้ว',
  UNKNOWN: 'ยังยืนยันผลไม่ได้', BLOCKED: 'ต้องตรวจสอบสิทธิ์หรือเงื่อนไข', FAILED: 'ดำเนินการไม่สำเร็จ', CANCELLED: 'ยกเลิกคำสั่งตรวจสอบแล้ว' };
const label=(operation:BillingRepairOperation)=>operation.type==='RETRY_NOTIFICATION'&&operation.state==='SUCCEEDED'?'นำรายการเดิมกลับเข้าคิวแล้ว':labels[operation.state]??operation.state;
const api = <T,>(path: string, body?: unknown, key?: string) => authedApiFetch<T>(`/system/billing/operations${path}`, {
  cache: 'no-store', suppressErrorToast: true, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) } }),
});
export default function BillingOperationPanel({ operationId, companyId, companyVersion, canReconcile = false,deliveryId,canRetry=false,canCheckDelivery=false,eventId,eventSourceHash,invoiceId,invoiceSourceHash }: {
  operationId?: string; companyId?: string; companyVersion?: number; canReconcile?: boolean;deliveryId?:string;canRetry?:boolean;canCheckDelivery?:boolean;eventId?:string;eventSourceHash?:string;invoiceId?:string;invoiceSourceHash?:string;
}) {
  const [operation, setOperation] = useState<BillingRepairOperation | null>(null), [reason, setReason] = useState('');
  const accept=(value:BillingRepairOperation)=>setOperation(current=>current?.id===value.id&&current.version>value.version?current:value);
  const [list, setList] = useState<{ items: BillingRepairOperation[]; nextCursor: string | null } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null), [reload, setReload] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pollEnded, setPollEnded] = useState(false);
  useEffect(() => {
    let active = true;
    const load = operationId ? api<BillingRepairOperation>(`/${encodeURIComponent(operationId)}`).then(value => { if (active) accept(value); }) :
      api<{ items: BillingRepairOperation[]; nextCursor: string | null }>(`?${eventId?`referenceId=${encodeURIComponent(eventId)}`:`companyId=${encodeURIComponent(companyId!)}`}${deliveryId||invoiceId?`&referenceId=${encodeURIComponent(deliveryId??invoiceId!)}`:''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        .then(value => { if (active) setList(value); });
    load.catch(() => { if (active) { setOperation(null); setList(null); setError('โหลดคำสั่งไม่ได้ กรุณาตรวจสอบสิทธิ์และลองใหม่'); } });
    return () => { active = false; };
  }, [operationId, companyId, deliveryId, eventId, invoiceId, cursor, reload]);
  const inlineOperationId = operationId ? undefined : operation?.id;
  useEffect(() => {
    if (!inlineOperationId) return;
    let active = true;
    void api<BillingRepairOperation>(`/${inlineOperationId}`).then(value => { if (active) accept(value); })
      .catch(() => { if (active) { setOperation(null); setError('โหลดคำสั่งไม่ได้ กรุณาตรวจสิทธิ์และเปิดรายการเดิมอีกครั้ง'); } });
    return () => { active = false; };
  }, [inlineOperationId, reload]);
  useEffect(() => {
    if (!operation || !['QUEUED', 'RUNNING'].includes(operation.state)) return;
    let active = true, polls = 0;
    const timer = window.setInterval(() => {
      if (++polls > 24) { window.clearInterval(timer); if (active) setPollEnded(true); return; }
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      void api<BillingRepairOperation>(`/${operation.id}`).then(value => { if (active) accept(value); }).catch(() => {});
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [operation?.id, operation?.state]);
  async function act(action: 'preview' | 'submit' | 'retry' | 'cancel') {
    if (busy) return; setBusy(true); setError('');
    try {
      const value = action === 'preview' && eventId ? await authedApiFetch<BillingRepairOperation>(`/system/billing/provider-events/${eventId}/preview`,{method:'POST',suppressErrorToast:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceHash:eventSourceHash,reason})}) : action === 'preview' ? await api<BillingRepairOperation>('/preview', { type: invoiceId?'RETRY_APPLY':deliveryId?(canCheckDelivery?'RECONCILE_NOTIFICATION':'RETRY_NOTIFICATION'):'RECONCILE', companyId, expectedVersion: companyVersion, reason,...invoiceId?{referenceId:invoiceId,invoiceSourceHash}:deliveryId?{referenceId:deliveryId}:{} }) :
        action === 'submit' ? await api<BillingRepairOperation>('', { previewId: operation!.id, previewHash: operation!.previewHash, expectedVersion: operation!.version }, `billing-op-${operation!.id}`) :
          await api<BillingRepairOperation>(`/${operation!.id}/${action}`, { expectedVersion: operation!.version });
      accept(value); setPollEnded(false); setReload(v => v + 1);
    } catch { setError('ยังยืนยันคำสั่งไม่ได้ กรุณาโหลดรายการเดิมหรือข้อมูลบริษัทล่าสุดก่อนดำเนินการต่อ'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-xl border bg-white p-5" aria-label="คำสั่งตรวจสอบการชำระเงิน">
    <h2 className="text-lg font-bold">ตรวจสอบและกู้คืนรายการเดิม</h2>
    <p>ระบบตรวจหลักฐานล่าสุดและดำเนินการรายการที่มีอยู่ตามนโยบาย ผลการตรวจแยกจากการปิดเคสและการชำระเงินสำเร็จ</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {deliveryId&&(canRetry||canCheckDelivery)&&<p>{canCheckDelivery?'ตรวจสอบผลอีเมลเดิมกับ Postmark คำสั่งนี้ไม่ส่งอีเมลใหม่':'นำรายการแจ้งเตือนเดิมกลับเข้าคิว โดยคงผู้รับ ข้อความ และประวัติเดิม ไม่มีการเรียกเก็บเงินหรือเพิ่มสิทธิ์'}</p>}
    {(companyId||eventId) && (canReconcile||canRetry||canCheckDelivery) && <div className="space-y-3"><label className="block">เหตุผลการตรวจสอบ<input className="mt-2 block w-full rounded-lg border p-3" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
      <button className={button} disabled={busy || !reason.trim()} onClick={() => void act('preview')}>ตรวจสอบผลกระทบ</button></div>}
    {operation && <article className="space-y-3 rounded-xl bg-gray-50 p-4" aria-label="สถานะคำสั่ง">
      <h3 className="font-bold" role="status">{label(operation)}</h3>
      <p className="break-all">{operation.scope.mode} · บริษัท {operation.scope.kind === 'COMPANY' ? operation.scope.companyId : 'ระดับระบบ'}</p>
      <p>{operation.reason}</p><p className="break-all text-sm">เลขคำสั่ง {operation.id} · เวอร์ชัน {operation.version}</p>
      {operation.invoiceImpact&&<p>ใบเสร็จเดิม {operation.invoiceImpact.id} · ก่อนตรวจ {operation.invoiceImpact.beforeState} · {new Date(operation.invoiceImpact.periodStart).toLocaleString('th-TH')} ถึง {new Date(operation.invoiceImpact.periodEnd).toLocaleString('th-TH')}</p>}
      {operation.observed?.invoiceApplyState&&<p>ผลของใบเสร็จเดิม: {operation.observed.invoiceApplyState} · สิทธิ์ปัจจุบันและเงื่อนไขอื่นตรวจได้ที่ข้อมูลบริษัท</p>}
      {operation.type==='RETRY_APPLY'&&!operation.invoiceImpact&&<p>คำสั่งเก่ายังไม่ได้ผูกใบเสร็จ ยกเลิกคำสั่งนี้แล้วเลือกใบเสร็จเดิมเพื่อตรวจใหม่</p>}
      {operation.eventImpact&&<p>{operation.eventImpact.eventType} · {operation.eventImpact.beforeState} · ตรวจแล้ว {operation.eventImpact.attempts} ครั้ง · ตรวจหลักฐานใหม่จากรายการเดิม</p>}
      {operation.deliveryImpact&&<div className="space-y-2"><p>{operation.deliveryImpact.channel} · {operation.deliveryImpact.beforeState} → {operation.deliveryImpact.afterState}</p>
        <p className="break-all">ผู้รับเดิม {operation.deliveryImpact.recipientUserId} · รายการส่ง {operation.referenceId}</p><p>พยายามส่งมาแล้ว {operation.deliveryImpact.attemptCount} ครั้ง</p>
        {operation.deliveryImpact.possibleDuplicate&&<p role="alert">ผลการส่งเดิมยังยืนยันไม่ได้ การส่งใหม่อาจทำให้ผู้รับได้รับซ้ำ</p>}{operation.deliveryImpact.channel==='LINE'&&<p>{operation.deliveryImpact.retryUntil?`ส่งซ้ำด้วย key เดิมได้ถึง ${new Date(operation.deliveryImpact.retryUntil).toLocaleString('th-TH')}`:'เริ่มนับเวลาส่งซ้ำเมื่อส่งคำขอครั้งแรก'}</p>}</div>}
      {operation.observed && !operation.observed.eventState && <p>เคสที่ยังเปิด {operation.observed.issueCount} · {operation.observed.pendingAttemptId ? 'ยังมีรายการชำระเงินที่ต้องตามผล' : 'ไม่มีรายการซื้อค้าง'}</p>}
      {operation.observed?.eventState&&<p>ผลการตรวจ event: {operation.observed.eventState} · ผลชำระเงินและสิทธิ์ดูได้จากข้อมูลบริษัทที่เชื่อมโยง</p>}
      {operation.observed?.deliveryState&&<p>สถานะรายการส่งที่ตรวจพบ: {operation.observed.deliveryState}</p>}
      {['RETRY_NOTIFICATION','RECONCILE_NOTIFICATION'].includes(operation.type)&&<p>ผลคำสั่งนี้ไม่ใช่หลักฐานว่าลูกค้าได้รับข้อความ ให้ตรวจสถานะรายการส่งเดิม</p>}
      {pollEnded && <p>ยังรอผล สามารถกลับมาเปิดคำสั่งเดิมหรือโหลดข้อมูลล่าสุดได้</p>}
      {operation.errorCode && <p>เปิดรายการต้นทางและเคสเพื่อตรวจเงื่อนไขก่อนดำเนินการต่อ</p>}
      <div className="flex flex-wrap gap-2">{operation.allowedActions.map(action => <button key={action} className={button} disabled={busy} onClick={() => void act(action)}>{action === 'submit' ? 'ยืนยันส่งคำสั่งตรวจสอบ' : action === 'retry' ? 'ตรวจสอบคำสั่งเดิมอีกครั้ง' : 'ยกเลิกคำสั่งตรวจสอบ'}</button>)}</div>
      <div className="flex flex-wrap gap-3"><Link className="underline" href={`/system/billing/operations/${operation.id}`}>เปิดลิงก์คำสั่งนี้</Link>
        {['RETRY_NOTIFICATION','RECONCILE_NOTIFICATION'].includes(operation.type)&&operation.scope.kind==='COMPANY'&&operation.referenceId&&<Link className="underline" href={`/system/billing/companies/${encodeURIComponent(operation.scope.companyId)}/deliveries/${operation.referenceId}`}>เปิดรายการส่งเดิม</Link>}
        {operation.type==='RETRY_APPLY'&&operation.scope.kind==='COMPANY'&&<Link className="underline" href={`/system/billing/companies/${encodeURIComponent(operation.scope.companyId)}/apply-invoices${operation.referenceId?`/${operation.referenceId}`:''}`}>กลับไปใบเสร็จเดิมหรือเลือกรายการ</Link>}
        {operation.type==='RETRY_PROVIDER_EVENT'&&operation.referenceId&&<Link className="underline" href={`/system/billing/provider-events/${operation.referenceId}`}>กลับไป event เดิม</Link>}
        {operation.scope.kind === 'COMPANY' && <Link className="underline" href={`/system/billing/companies/${encodeURIComponent(operation.scope.companyId)}`}>กลับไปบริษัท</Link>}</div>
    </article>}
    {list && <div className="space-y-2">{list.items.map(item => <p key={item.id}><Link className="break-all underline" href={`/system/billing/operations/${item.id}`}>{label(item)} · {item.reason}</Link></p>)}</div>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => { setError(''); setReload(v => v + 1); }}>โหลดคำสั่งล่าสุด</button>
      {list?.nextCursor && <button className={button} onClick={() => setCursor(list.nextCursor)}>คำสั่งหน้าถัดไป</button>}
      {cursor && <button className={button} onClick={() => setCursor(null)}>คำสั่งหน้าแรก</button>}</div>
  </section>;
}
