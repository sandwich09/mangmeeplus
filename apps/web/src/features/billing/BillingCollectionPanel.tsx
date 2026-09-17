'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { BillingCollectionOperation, BillingStatus, BillingCapacityOptions } from '@watchdog-bms/contracts';
import BillingCapacityPicker from './BillingCapacityPicker';
import { billingApi } from './billing.api';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { billingBackControl, billingControl, billingPrimaryControl } from './billing-display';
const button = billingControl;
const labels: Record<string, string> = { PREVIEW: 'ตรวจสอบการต่ออายุ', QUEUED: 'รอตรวจยืนยันการต่ออายุ', RUNNING: 'กำลังตรวจยืนยันกับผู้ให้บริการ',
  UNKNOWN: 'ยังยืนยันผลไม่ได้ กรุณาเปิดรายการเดิมเพื่อตรวจสอบ', BLOCKED: 'เงื่อนไขเปลี่ยน ต้องตรวจรายการเดิม', CANCELLED: 'ถอนคำขอที่ยังไม่ดำเนินการแล้ว' };
export default function BillingCollectionPanel({ companyId, status, operationId, onChange, onBack, onEdit, apiOverride }: { companyId: string; status: BillingStatus; operationId?: string; onChange: () => void; onBack?: () => void; onEdit?: () => void; apiOverride?: ReturnType<typeof billingApi> }) {
  const api = useMemo(() => apiOverride ?? billingApi(companyId), [companyId, apiOverride]), [operation, setOperation] = useState<BillingCollectionOperation | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0), [ended, setEnded] = useState(false);
  const [selection, setSelection] = useState<{ options: BillingCapacityOptions; repair: { operationId: string; version: number }; key: string } | null>(null);
  const [notice, setNotice] = useState('');
  const id = operation?.id ?? operationId ?? status.collection?.id;
  const heading = useRef<HTMLHeadingElement>(null);
  const backNavigation = useRef<HTMLDivElement>(null);
  useEffect(() => { if (operationId && operation) { backNavigation.current?.scrollIntoView({ block: 'start' }); heading.current?.focus({ preventScroll: true }); } }, [operationId, operation?.id]);
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
  if (!operation && !id && !status.collectionPause && !status.pendingPlanChange && !status.planCapacityRepair && !status.allowedActions.includes('portal_cancel_subscription')) return null;
  const confirming = !!operation && !['SUCCEEDED', 'CANCELLED'].includes(operation.state);
  const changingPlan = operation?.action === 'SCHEDULE_DOWNGRADE';
  const completed = operation?.state === 'SUCCEEDED' || operation?.state === 'CANCELLED';
  const canEdit = onEdit && changingPlan && operation?.state === 'PREVIEW' && operation.allowedActions.includes('withdraw');
  async function editSelection() {
    if (busy || !canEdit || !operation) return;
    setBusy(true); setError('');
    try {
      const withdrawn = await api.collectionWithdraw(operation);
      setOperation(withdrawn); onChange();
      if (withdrawn.state === 'CANCELLED') onEdit?.();
    } catch (cause) { setError(apiErrorMessage(cause)); }
    finally { setBusy(false); }
  }
  const actionLabel = (value: BillingCollectionOperation['action']) => ({ ADMIN_PAUSE_COLLECTION:'พักเก็บเงิน', ADMIN_RESUME_COLLECTION:'กลับมาเก็บเงิน', EXTEND_TERM: 'เพิ่มวันใช้งานและเลื่อนวันเก็บเงิน', CANCEL_RENEWAL: 'หยุดต่ออายุ', RESUME_RENEWAL: 'กลับมาต่ออายุ', SCHEDULE_DOWNGRADE: 'เปลี่ยนแพ็กเกจรอบถัดไป', CANCEL_DOWNGRADE: 'ยกเลิกการเปลี่ยนแพ็กเกจ' })[value];
  const showReviewHeader = !!operationId && !selection;
  const panelHeading = <h2 ref={heading} tabIndex={-1} className={showReviewHeader ? 'text-xl font-bold text-gray-900 sm:text-2xl' : 'text-lg font-bold'}>{changingPlan ? 'การเปลี่ยนแพ็กเกจ' : 'การต่ออายุแพ็กเกจ'}</h2>;
  return <div className="space-y-6">
    {showReviewHeader && <div ref={backNavigation} className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-1">{canEdit ? <button type="button" className={billingBackControl} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void editSelection()}><span className="text-base leading-none" aria-hidden="true">←</span>กลับไปเลือกสาขาและผู้ใช้</button> : onBack ? <button type="button" className={billingBackControl} disabled={busy} aria-busy={Boolean(busy)} onClick={onBack}><span className="text-base leading-none" aria-hidden="true">←</span>กลับไปแพ็กเกจปัจจุบัน</button> : <Link className={billingBackControl} href={`/companies/${encodeURIComponent(companyId)}/billing`}><span className="text-base leading-none" aria-hidden="true">←</span>กลับไปแพ็กเกจปัจจุบัน</Link>}{panelHeading}</div>}
    <section className="mangmee-card space-y-5 p-5 sm:p-6" aria-label="จัดการการต่ออายุ">
    {(!showReviewHeader || !changingPlan) && <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        {!showReviewHeader && panelHeading}
        {!changingPlan && <p className="text-sm text-gray-500">{refreshingStatus ? 'กำลังตรวจสถานะล่าสุด' : status.cancelAtPeriodEnd ? 'ปิดการต่ออายุอัตโนมัติแล้ว ใช้แพ็กเกจได้จนครบระยะที่ชำระไว้' : status.collectionPause ? 'พักการเรียกเก็บเงินชั่วคราว' : 'ต่ออายุอัตโนมัติเปิดอยู่'}</p>}
      </div>
      {!confirming && !selection && !operationId && !status.collection && status.allowedActions.includes('portal_cancel_subscription') && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void act('preview')}>
        {status.cancelAtPeriodEnd ? 'เปิดต่ออายุอัตโนมัติ' : 'หยุดต่ออายุอัตโนมัติ'}</button>}
    </div>}
    {status.collectionPause && <div className="rounded-xl bg-amber-50 p-4"><p>พักเก็บเงินอยู่ตามสถานะที่ตรวจล่าสุด</p><p>{status.collectionPause.resumesAt?`กำหนดกลับมาเก็บเงิน ${new Date(status.collectionPause.resumesAt).toLocaleString('th-TH')}`:'ยังไม่กำหนดวันกลับมาเก็บเงิน'}</p><p>วันใช้งานและใบเสร็จคงเดิม บิลที่ออกไว้ก่อนพักอาจยังถูกเรียกเก็บ ติดต่อทีมงานหากต้องการปรับการต่ออายุ</p></div>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {status.pendingPlanChange && (status.pendingPlanChange.id !== operation?.id || completed) && <section aria-label="แพ็กเกจรอบถัดไป" className="space-y-4 rounded-xl bg-gray-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">แพ็กเกจรอบถัดไป</h3>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">รอเริ่มใช้งาน</span>
      </div>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div><dt className="text-sm text-gray-500">แพ็กเกจ</dt><dd className="mt-1 font-semibold text-gray-900">{status.pendingPlanChange.targetOffer?.label ?? 'แพ็กเกจที่เลือกไว้'}{status.pendingPlanChange.targetOffer && <span className="mt-1 block text-sm font-normal text-gray-500">{status.pendingPlanChange.targetOffer.interval === 'year' ? 'รายปี' : 'รายเดือน'}</span>}</dd></div>
        <div><dt className="text-sm text-gray-500">วันที่เปลี่ยนแพ็กเกจ</dt><dd className="mt-1 font-semibold text-gray-900">{new Date(status.pendingPlanChange.effectiveAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}</dd></div>
        <div><dt className="text-sm text-gray-500">ยอดชำระรอบถัดไป</dt><dd className="mt-1 font-semibold text-gray-900">{new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(status.pendingPlanChange.nextRenewalTotalSatang / 100)}</dd></div>
      </dl>
      <p className="text-sm text-gray-500">ใช้แพ็กเกจเดิมได้ถึงวันที่ระบุ แพ็กเกจใหม่เริ่มเมื่อชำระรอบถัดไปสำเร็จ</p>
      {!confirming && !selection && <div className="flex flex-wrap items-center gap-3">
        {apiOverride ? <button className={button} disabled={busy} onClick={() => setOperation(status.pendingPlanChange!)}>ดูรายการเปลี่ยนแพ็กเกจ</button> : <Link className={button} href={`/companies/${encodeURIComponent(companyId)}/billing?collection=${status.pendingPlanChange.id}`}>ดูรายการเปลี่ยนแพ็กเกจ</Link>}
        {status.allowedActions.includes('plan_changes') && <button className={`${button} !border-transparent !bg-transparent !text-gray-500 hover:!bg-gray-100`} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void act('cancel-downgrade')}>ยกเลิกการเปลี่ยนแพ็กเกจ</button>}
      </div>}
    </section>}
    {status.planCapacityRepair && <div className="space-y-2 rounded-xl bg-amber-50 p-4"><p>รับชำระรอบใหม่แล้ว กรุณาตรวจเลือกสาขาและผู้ใช้ก่อนเปิดสิทธิ์แพ็กเกจใหม่</p>
      <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => { setBusy(true); const repair = status.planCapacityRepair!;
        void api.capacity(repair.offerKey, repair.interval).then(options => setSelection({ options, repair, key: crypto.randomUUID() })).catch(e => setError(apiErrorMessage(e))).finally(() => setBusy(false)); }}>เลือกสิทธิ์สำหรับรอบที่จ่ายแล้ว</button></div>}
    {selection && <BillingCapacityPicker key={selection.options.sourceHash+selection.key} options={selection.options} repair currentTierKey={status.tierKey} onCancel={() => setSelection(null)}
      onRefresh={async () => { const latest = await api.status(); if (!latest.planCapacityRepair) { setSelection(null); onChange(); return; }
        setSelection({ ...selection, options: await api.capacity(selection.options.offerKey, selection.options.interval), repair: latest.planCapacityRepair, key: crypto.randomUUID() }); }}
      onConfirm={async capacity => {
        await api.repairPlanCapacity(selection.repair.operationId, selection.repair.version, capacity, selection.key); setNotice('บันทึกแล้ว กำลังตรวจเปิดสิทธิ์จากรายการชำระเดิม');
        setSelection(null); onChange(); }} />}
    {operation && !selection && <article className="space-y-3 rounded-xl bg-gray-50 p-4">
      <h3 role="status" className="font-semibold">{operation.state === 'SUCCEEDED' ? operation.action === 'CANCEL_RENEWAL' ? 'ยืนยันหยุดการต่ออายุแล้ว' : operation.action === 'RESUME_RENEWAL' ? 'ยืนยันกลับมาต่ออายุแล้ว' : `ยืนยัน${actionLabel(operation.action)}แล้ว` : operation.state === 'PREVIEW' ? `ยืนยัน${actionLabel(operation.action)}` : labels[operation.state] ?? operation.state}</h3>
      {!completed && <>
      {changingPlan && <p className="rounded-xl bg-brand-50 p-4 font-semibold text-brand-800">วันนี้ยังไม่เรียกเก็บเงิน ใช้แพ็กเกจเดิมได้จนถึงวันที่ {new Date(operation.effectiveAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
      {!changingPlan && <p>{operation.action==='ADMIN_PAUSE_COLLECTION'?'กำหนดกลับมาเก็บเงิน':operation.action==='ADMIN_RESUME_COLLECTION'?'วันที่ขอกลับมาเก็บเงิน':operation.action==='EXTEND_TERM'?'วันที่ขอขยายการใช้งานถึง':'สิทธิ์ที่ซื้อไว้ถึง'} {new Date(operation.effectiveAt).toLocaleString('th-TH')}</p>}
      {operation.action !== 'CANCEL_RENEWAL' && operation.action !== 'EXTEND_TERM' && !operation.action.startsWith('ADMIN_') && <p>ยอดต่ออายุถัดไป {new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(operation.nextRenewalTotalSatang / 100)}{changingPlan && ` / ${operation.targetOffer?.interval === 'year' ? 'ปี' : 'เดือน'}`}</p>}
      {operation.targetOffer && <p>เมื่อชำระรอบใหม่สำเร็จ: {operation.targetOffer.label} · {operation.targetOffer.branchLimit} สาขา · {operation.targetOffer.employeeLimit} ผู้ใช้ · {operation.targetOffer.receiptAllowance} ใบ</p>}
      {operation.capacity && <div><p>คงสาขา: {operation.capacity.retainedBranches.join(', ')} · พักสาขา: {operation.capacity.suspendedBranches.join(', ') || 'ไม่มี'}</p><p>คงผู้ใช้: {operation.capacity.retainedMembers.join(', ')} · พักผู้ใช้: {operation.capacity.suspendedMembers.join(', ') || 'ไม่มี'}</p><p>ข้อมูลและประวัติยังอยู่ หากรายชื่อเปลี่ยนจะให้ตรวจเลือกอีกครั้ง</p></div>}
      <p>{operation.action.startsWith('ADMIN_') ? 'รายการนี้ปรับเฉพาะการเก็บเงิน ไม่เพิ่มวันใช้งานหรือโควตา และไม่เรียกเก็บบิลร่างย้อนหลัง' : operation.action==='EXTEND_TERM' ? operation.state === 'SUCCEEDED' ? 'เพิ่มวันใช้งานแล้ว รายการนี้ไม่มีค่าใช้จ่ายและไม่เพิ่มโควตา' : 'ผู้ดูแลกำลังดำเนินการแถมวัน ไม่เพิ่มโควตาหรือเรียกเก็บเงินจากรายการนี้ ตรวจสถานะล่าสุดเพื่อดูวันที่ยืนยันแล้ว' : changingPlan ? 'แพ็กเกจใหม่จะเริ่มเมื่อชำระรอบถัดไปสำเร็จ สิทธิ์เดิมที่ซื้อไว้ไม่ลดลงในวันนี้' : 'วันและจำนวนใบเสร็จที่ซื้อไว้คงเดิม การเปลี่ยนการต่ออายุไม่เพิ่มโควตาหรือคืนเงิน'}</p>
      {['past_due', 'unpaid'].includes(status.subscriptionState) && <p>ยอดค้างเดิมยังต้องตรวจแยกกับทีมงาน การหยุดต่ออายุไม่ใช่การยกเว้นหนี้</p>}
      {operation.state === 'PREVIEW' && <p>ตรวจและยืนยันได้ถึง {new Date(operation.expiresAt).toLocaleTimeString('th-TH')}</p>}
      {(ended || operation.state === 'UNKNOWN') && <p>กลับมาเปิดรายการเดิมเพื่อตรวจสถานะ หรือติดต่อทีมงาน</p>}
      </>}
      <div className="flex flex-wrap gap-3">{operation.allowedActions.map(action => <button key={action} className={action === 'submit' ? billingPrimaryControl : button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void act(action)}>
        {action === 'withdraw' ? 'ยกเลิก' : `ยืนยัน${actionLabel(operation.action)}`}</button>)}
        {!completed && operation.state !== 'PREVIEW' && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void act('refresh')}>ตรวจผลการต่ออายุ</button>}</div>
    </article>}
    {!operation && id && <button className={button} onClick={() => setReload(v => v + 1)}>โหลดคำขออีกครั้ง</button>}
  </section></div>;
}
