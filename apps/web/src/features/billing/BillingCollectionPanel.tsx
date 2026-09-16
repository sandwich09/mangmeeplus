'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { BillingCollectionOperation, BillingStatus, BillingCatalog, BillingCapacityOptions } from '@watchdog-bms/contracts';
import BillingCapacityPicker from './BillingCapacityPicker';
import { billingApi } from './billing.api';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { billingControl, billingPrimaryControl } from './billing-display';
const button = billingControl;
const labels: Record<string, string> = { PREVIEW: 'ตรวจสอบการต่ออายุ', QUEUED: 'รอตรวจยืนยันการต่ออายุ', RUNNING: 'กำลังตรวจยืนยันกับผู้ให้บริการ',
  UNKNOWN: 'ยังยืนยันผลไม่ได้ กรุณาเปิดรายการเดิมเพื่อตรวจสอบ', BLOCKED: 'เงื่อนไขเปลี่ยน ต้องตรวจรายการเดิม', CANCELLED: 'ถอนคำขอที่ยังไม่ดำเนินการแล้ว' };
export default function BillingCollectionPanel({ companyId, status, catalog, operationId, onChange, apiOverride }: { companyId: string; status: BillingStatus; catalog: BillingCatalog; operationId?: string; onChange: () => void; apiOverride?: ReturnType<typeof billingApi> }) {
  const api = useMemo(() => apiOverride ?? billingApi(companyId), [companyId, apiOverride]), [operation, setOperation] = useState<BillingCollectionOperation | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0), [ended, setEnded] = useState(false);
  const [selection, setSelection] = useState<{ options: BillingCapacityOptions; repair?: { operationId: string; version: number }; key: string } | null>(null);
  const [notice, setNotice] = useState('');
  const id = operationId ?? status.collection?.id ?? operation?.id;
  const refreshingStatus = operation?.state === 'SUCCEEDED' && operation.observedAt &&
    (!status.observedAt || Date.parse(status.observedAt) < Date.parse(operation.observedAt));
  useEffect(() => {
    if (!id) return;
    let active = true;
    void api.collection(id).then(value => { if (active) setOperation(value); }).catch(() => { if (active) setError('โหลดคำขอไม่ได้ ตรวจสอบสิทธิ์เจ้าของบริษัทแล้วลองใหม่'); });
    return () => { active = false; };
  }, [api, id, reload]);
  useEffect(() => {
    if (!operation || !['QUEUED', 'RUNNING', 'UNKNOWN'].includes(operation.state)) return;
    let active = true, polls = 0;
    const timer = window.setInterval(() => {
      if (++polls > 24) { clearInterval(timer); if (active) setEnded(true); return; }
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      void api.collection(operation.id).then(value => { if (active) { setOperation(value); if (value.state === 'SUCCEEDED') onChange(); } }).catch(() => {});
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [api, operation?.id, operation?.state, onChange]);
  async function act(action: 'preview' | 'submit' | 'withdraw' | 'refresh' | 'cancel-downgrade') {
    if (busy) return; setBusy(true); setError('');
    try {
      const value = action === 'cancel-downgrade' ? await api.collectionPreview('CANCEL_DOWNGRADE') : action === 'preview' ? await api.collectionPreview(status.cancelAtPeriodEnd ? 'RESUME_RENEWAL' : 'CANCEL_RENEWAL') :
        action === 'submit' ? await api.collectionSubmit(operation!) : action === 'withdraw' ? await api.collectionWithdraw(operation!) : await api.collection(id!);
      setOperation(value); setEnded(false); onChange();
    } catch (cause) { setError(apiErrorMessage(cause)); }
    finally { setBusy(false); }
  }
  if (!operation && !id && !status.collectionPause && !status.pendingPlanChange && !status.allowedActions.includes('plan_changes') && !status.allowedActions.includes('portal_cancel_subscription')) return null;
  const confirming = !!operation && !['SUCCEEDED', 'CANCELLED'].includes(operation.state);
  const completed = operation?.state === 'SUCCEEDED' || operation?.state === 'CANCELLED';
  const targetTiers = ['STARTER_249', 'BASIC_499', 'PRO_999'];
  const targetOffers = catalog.offers.filter(o => o.interval === status.interval && targetTiers.indexOf(o.offerKey) >= 0 && targetTiers.indexOf(o.offerKey) < targetTiers.indexOf(status.tierKey ?? ''));
  const actionLabel = (value: BillingCollectionOperation['action']) => ({ ADMIN_PAUSE_COLLECTION:'พักเก็บเงิน', ADMIN_RESUME_COLLECTION:'กลับมาเก็บเงิน', EXTEND_TERM: 'เพิ่มวันใช้งานและเลื่อนวันเก็บเงิน', CANCEL_RENEWAL: 'หยุดต่ออายุ', RESUME_RENEWAL: 'กลับมาต่ออายุ', SCHEDULE_DOWNGRADE: 'ลดแพ็กเกจสิ้นรอบ', CANCEL_DOWNGRADE: 'ยกเลิกการลดแพ็กเกจ' })[value];
  return <section className="mangmee-card space-y-3 p-5 sm:p-6" aria-label="จัดการการต่ออายุ">
    <h2 className="text-lg font-bold">การต่ออายุแพ็กเกจ</h2>
    <p>{refreshingStatus ? 'กำลังตรวจสถานะล่าสุด' : status.cancelAtPeriodEnd ? 'หยุดต่ออายุเมื่อครบระยะที่จ่ายแล้ว' : 'ระบบต่ออายุตามสัญญาที่เลือกไว้'}</p>
    {status.collectionPause && <div className="rounded-xl bg-amber-50 p-4"><p>พักเก็บเงินอยู่ตามสถานะที่ตรวจล่าสุด</p><p>{status.collectionPause.resumesAt?`กำหนดกลับมาเก็บเงิน ${new Date(status.collectionPause.resumesAt).toLocaleString('th-TH')}`:'ยังไม่กำหนดวันกลับมาเก็บเงิน'}</p><p>วันใช้งานและใบเสร็จคงเดิม บิลที่ออกไว้ก่อนพักอาจยังถูกเรียกเก็บ ติดต่อทีมงานหากต้องการปรับการต่ออายุ</p></div>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {operationId && <Link className="inline-block underline" href={`/companies/${encodeURIComponent(companyId)}/billing`}>กลับหน้าจัดการแพ็กเกจ</Link>}
    {!confirming && !selection && !operationId && !status.collection && status.allowedActions.includes('portal_cancel_subscription') && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void act('preview')}>
      {status.cancelAtPeriodEnd ? 'เปิดต่ออายุอัตโนมัติ' : 'หยุดต่ออายุอัตโนมัติ'}</button>}
    {status.pendingPlanChange && (status.pendingPlanChange.id !== operation?.id || completed) && <div className="space-y-2 rounded-xl bg-amber-50 p-4"><p>รอเปลี่ยนเป็น {status.pendingPlanChange.targetOffer?.label} วันที่ {new Date(status.pendingPlanChange.effectiveAt).toLocaleString('th-TH')}</p>
      <p>ยอดต่ออายุ {new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(status.pendingPlanChange.nextRenewalTotalSatang / 100)} · สิทธิ์เดิมถึงวันมีผล</p>
      {apiOverride ? <button className="inline-block underline" onClick={() => setOperation(status.pendingPlanChange!)}>ดูคำสั่งลดแพ็กเกจ</button> : <Link className="inline-block underline" href={`/companies/${encodeURIComponent(companyId)}/billing?collection=${status.pendingPlanChange.id}`}>ดูคำสั่งลดแพ็กเกจ</Link>}
      {status.allowedActions.includes('plan_changes') && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void act('cancel-downgrade')}>ตรวจสอบการยกเลิกลดแพ็กเกจ</button>}</div>}
    {status.planCapacityRepair && <div className="space-y-2 rounded-xl bg-amber-50 p-4"><p>รับชำระรอบใหม่แล้ว กรุณาตรวจเลือกสาขาและผู้ใช้ก่อนเปิดสิทธิ์แพ็กเกจใหม่</p>
      <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => { setBusy(true); const repair = status.planCapacityRepair!;
        void api.capacity(repair.offerKey, repair.interval).then(options => setSelection({ options, repair, key: crypto.randomUUID() })).catch(e => setError(apiErrorMessage(e))).finally(() => setBusy(false)); }}>เลือกสิทธิ์สำหรับรอบที่จ่ายแล้ว</button></div>}
    {!confirming && !selection && !operationId && status.purchaseEligibility !== 'COMPANY_SALES_CLOSED' && status.allowedActions.includes('plan_changes') && targetOffers.length > 0 && <div className="space-y-2"><p>ลดแพ็กเกจเมื่อครบเวลาที่ซื้อไว้ทั้งหมด โดยเลือกรายชื่อที่จะคงสิทธิ์ก่อน</p>
      <div className="flex flex-wrap gap-2">{targetOffers.map(offer => <button key={offer.offerKey} className={button} disabled={busy || offer.availability !== 'AVAILABLE' || Date.parse(catalog.validUntil) <= Date.now()} aria-busy={Boolean(busy)} onClick={() => {
        setBusy(true); setError(''); void api.capacity(offer.offerKey, offer.interval).then(options => setSelection({ options, key: crypto.randomUUID() })).catch(e => setError(apiErrorMessage(e))).finally(() => setBusy(false));
      }}>ตรวจลดเป็น {offer.label}</button>)}</div></div>}
    {selection && <BillingCapacityPicker key={selection.options.sourceHash+selection.key} options={selection.options} repair={!!selection.repair} onCancel={() => setSelection(null)}
      onRefresh={async () => { const latest = await api.status(); if (selection.repair && !latest.planCapacityRepair) { setSelection(null); onChange(); return; }
        setSelection({ ...selection, options: await api.capacity(selection.options.offerKey, selection.options.interval), ...(selection.repair ? { repair: latest.planCapacityRepair! } : {}), key: crypto.randomUUID() }); }}
      onConfirm={async capacity => { if (selection.repair) {
        await api.repairPlanCapacity(selection.repair.operationId, selection.repair.version, capacity, selection.key); setNotice('บันทึกแล้ว กำลังตรวจเปิดสิทธิ์จากรายการชำระเดิม');
      } else setOperation(await api.collectionPreview('SCHEDULE_DOWNGRADE', { offerKey: selection.options.offerKey, interval: selection.options.interval, capacity }));
        setSelection(null); onChange(); }} />}
    {operation && !selection && <article className="space-y-3 rounded-xl bg-gray-50 p-4">
      <h3 role="status" className="font-semibold">{operation.state === 'SUCCEEDED' ? operation.action === 'CANCEL_RENEWAL' ? 'ยืนยันหยุดการต่ออายุแล้ว' : operation.action === 'RESUME_RENEWAL' ? 'ยืนยันกลับมาต่ออายุแล้ว' : `ยืนยัน${actionLabel(operation.action)}แล้ว` : operation.state === 'PREVIEW' ? `ยืนยัน${actionLabel(operation.action)}` : labels[operation.state] ?? operation.state}</h3>
      {!completed && <>
      <p>{operation.action==='ADMIN_PAUSE_COLLECTION'?'กำหนดกลับมาเก็บเงิน':operation.action==='ADMIN_RESUME_COLLECTION'?'วันที่ขอกลับมาเก็บเงิน':operation.action==='EXTEND_TERM'?'วันที่ขอขยายการใช้งานถึง':'สิทธิ์ที่ซื้อไว้ถึง'} {new Date(operation.effectiveAt).toLocaleString('th-TH')}</p>
      {operation.action !== 'CANCEL_RENEWAL' && operation.action !== 'EXTEND_TERM' && !operation.action.startsWith('ADMIN_') && <p>ยอดต่ออายุถัดไป {new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(operation.nextRenewalTotalSatang / 100)}</p>}
      {operation.targetOffer && <p>เมื่อชำระรอบใหม่สำเร็จ: {operation.targetOffer.label} · {operation.targetOffer.branchLimit} สาขา · {operation.targetOffer.employeeLimit} ผู้ใช้ · {operation.targetOffer.receiptAllowance} ใบ</p>}
      {operation.capacity && <div><p>คงสาขา: {operation.capacity.retainedBranches.join(', ')} · พักสาขา: {operation.capacity.suspendedBranches.join(', ') || 'ไม่มี'}</p><p>คงผู้ใช้: {operation.capacity.retainedMembers.join(', ')} · พักผู้ใช้: {operation.capacity.suspendedMembers.join(', ') || 'ไม่มี'}</p><p>ข้อมูลและประวัติยังอยู่ หากรายชื่อเปลี่ยนจะให้ตรวจเลือกอีกครั้ง</p></div>}
      <p>{operation.action.startsWith('ADMIN_') ? 'รายการนี้ปรับเฉพาะการเก็บเงิน ไม่เพิ่มวันใช้งานหรือโควตา และไม่เรียกเก็บบิลร่างย้อนหลัง' : operation.action==='EXTEND_TERM' ? operation.state === 'SUCCEEDED' ? 'เพิ่มวันใช้งานแล้ว รายการนี้ไม่มีค่าใช้จ่ายและไม่เพิ่มโควตา' : 'ผู้ดูแลกำลังดำเนินการแถมวัน ไม่เพิ่มโควตาหรือเรียกเก็บเงินจากรายการนี้ ตรวจสถานะล่าสุดเพื่อดูวันที่ยืนยันแล้ว' : 'วันและจำนวนใบเสร็จที่ซื้อไว้คงเดิม การเปลี่ยนการต่ออายุไม่เพิ่มโควตาหรือคืนเงิน'}</p>
      {['past_due', 'unpaid'].includes(status.subscriptionState) && <p>ยอดค้างเดิมยังต้องตรวจแยกกับทีมงาน การหยุดต่ออายุไม่ใช่การยกเว้นหนี้</p>}
      {operation.state === 'PREVIEW' && <p>ตรวจและยืนยันได้ถึง {new Date(operation.expiresAt).toLocaleTimeString('th-TH')}</p>}
      {(ended || operation.state === 'UNKNOWN') && <p>กลับมาเปิดลิงก์รายการเดิมหรือติดต่อทีมงานพร้อมเลขอ้างอิงได้</p>}
      </>}
      <details className="text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิง</summary><p className="break-all">{operation.id}</p>{!apiOverride && <Link className="inline-flex min-h-11 items-center underline" href={`/companies/${encodeURIComponent(companyId)}/billing?collection=${operation.id}`}>เปิดรายการต่ออายุนี้</Link>}</details>
      <div className="flex flex-wrap gap-3">{operation.allowedActions.map(action => <button key={action} className={action === 'submit' ? billingPrimaryControl : button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void act(action)}>
        {action === 'withdraw' ? 'ยกเลิก' : `ยืนยัน${actionLabel(operation.action)}`}</button>)}
        {!completed && operation.state !== 'PREVIEW' && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void act('refresh')}>ตรวจผลการต่ออายุ</button>}</div>
    </article>}
    {!operation && id && <button className={button} onClick={() => setReload(v => v + 1)}>โหลดคำขออีกครั้ง</button>}
  </section>;
}
