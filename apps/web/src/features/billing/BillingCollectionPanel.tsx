'use client';
import { formatThaiDate, formatThaiDateTime } from '@/common/i18n/thai-date';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { primaryButtonClass as billingPrimaryControl, secondaryButtonClass as billingControl } from '@/common/components/button';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { shopPlanTierLabel } from '@watchdog-bms/contracts';
import type { BillingCollectionOperation, BillingStatus, BillingCapacityOptions } from '@watchdog-bms/contracts';
import BillingCapacityPicker from './BillingCapacityPicker';
import { billingApi } from './billing.api';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { billingBackControl, billingRenewalLine } from './billing-display';
const button = billingControl;
const labels: Record<string, string> = { PREVIEW: 'ตรวจสอบการต่ออายุ', QUEUED: 'รอตรวจยืนยันการต่ออายุ', RUNNING: 'กำลังตรวจยืนยันกับผู้ให้บริการ',
  UNKNOWN: 'ยังยืนยันผลไม่ได้ เปิดรายการเดิมเพื่อตรวจสอบ', BLOCKED: 'เงื่อนไขเปลี่ยน ต้องตรวจรายการเดิม', CANCELLED: 'ถอนคำขอแล้ว',
  APPLIED: 'เริ่มใช้แพ็กเกจใหม่แล้ว',
  // An ended command (2026-10-10): the sentence states only what is known, and nothing is offered for it.
  FAILED: 'ตรวจกับผู้ให้บริการรับเงินแล้ว คำสั่งนี้ยังไม่มีผล รายการนี้จบแล้ว ถ้ายังต้องการ ให้ทำรายการใหม่',
  NOT_SENT: 'คำสั่งนี้ยังไม่ได้ส่งถึงผู้ให้บริการรับเงิน รายการนี้จบแล้ว ถ้ายังต้องการ ให้ทำรายการใหม่' };
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
    void api.collection(id).then(value => { if (active) setOperation(value); }).catch(() => { if (active) setError('โหลดคำขอไม่ได้ ตรวจสอบสิทธิ์จัดการแพ็กเกจแล้วลองใหม่'); });
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
      const closedPreview = action === 'withdraw' && operation?.action === 'CANCEL_RENEWAL' && operation.state === 'PREVIEW' && value.state === 'CANCELLED';
      setOperation(closedPreview ? null : value); setEnded(false); onChange();
    } catch (cause) { setError(apiErrorMessage(cause)); }
    finally { setBusy(false); }
  }
  if (!operation && !id && !status.collectionPause && !status.pendingPlanChange && !status.planCapacityRepair && !status.allowedActions.includes('portal_cancel_subscription') && status.renewalMode !== 'CARD_AUTO' && status.renewalMode !== 'PROMPTPAY_RENEW') return null;
  const confirming = !!operation && !['SUCCEEDED', 'APPLIED', 'CANCELLED', 'FAILED'].includes(operation.state);
  const prepaidChange = operation?.action === 'PREPAID_PLAN_CHANGE';
  const changingPlan = operation?.action === 'SCHEDULE_DOWNGRADE' || prepaidChange;
  const stopping = operation?.action === 'CANCEL_RENEWAL';
  const qrRenewal = status.renewalMode === 'PROMPTPAY_RENEW';
  const stopLabel = qrRenewal ? 'หยุดออกบิล' : 'หยุดต่ออายุ';
  const stopQuestion = qrRenewal ? 'หยุดออกบิลพร้อมเพย์ทุกงวด?' : 'หยุดต่ออายุอัตโนมัติ?';
  const completed = !!operation && ['SUCCEEDED', 'APPLIED', 'CANCELLED', 'FAILED'].includes(operation.state);
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
  const actionLabel = (value: BillingCollectionOperation['action']) => ({ ADMIN_PAUSE_COLLECTION:'พักเก็บเงิน', ADMIN_RESUME_COLLECTION:'กลับมาเก็บเงิน', EXTEND_TERM: 'เพิ่มวันใช้งานและเลื่อนวันเก็บเงิน', CANCEL_RENEWAL: 'หยุดต่ออายุ', RESUME_RENEWAL: 'กลับมาต่ออายุ', SCHEDULE_DOWNGRADE: 'เปลี่ยนแพ็กเกจรอบถัดไป', CANCEL_DOWNGRADE: 'ยกเลิกการเปลี่ยนแพ็กเกจ', PREPAID_PLAN_CHANGE: 'ซื้อแพ็กเกจรอบถัดไป' })[value];
  const showReviewHeader = !!operationId && !selection;
  const renewalLine = stopping ? null : refreshingStatus ? 'กำลังตรวจสถานะล่าสุด' : billingRenewalLine(status);
  const panelHeading = <h2 ref={heading} tabIndex={-1} className={showReviewHeader ? 'text-xl font-bold text-gray-900 sm:text-2xl' : 'text-base font-semibold'}>{changingPlan ? 'การเปลี่ยนแพ็กเกจ' : 'ต่ออายุอัตโนมัติ'}</h2>;
  return <div className="space-y-6">
    {showReviewHeader && <div ref={backNavigation} className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-1">{canEdit ? <button type="button" className={billingBackControl} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void editSelection()}><span className="text-base leading-none" aria-hidden="true">←</span>กลับไปเลือกสาขาและผู้ใช้</button> : onBack ? <button type="button" className={billingBackControl} disabled={busy} aria-busy={Boolean(busy)} onClick={onBack}><span className="text-base leading-none" aria-hidden="true">←</span>กลับไปแพ็กเกจปัจจุบัน</button> : <Link className={billingBackControl} href={`/companies/${encodeURIComponent(companyId)}/billing`}><span className="text-base leading-none" aria-hidden="true">←</span>กลับไปแพ็กเกจปัจจุบัน</Link>}{panelHeading}</div>}
    <section className="mangmee-card space-y-5 p-5 sm:p-6" aria-label="จัดการการต่ออายุ">
    {(!showReviewHeader || !changingPlan) && <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        {!showReviewHeader && panelHeading}
        {!changingPlan && renewalLine && <p className="text-sm text-gray-500">{renewalLine}</p>}
        {!stopping && status.cancelAtPeriodEnd && status.paidThrough && <p>ใช้แพ็กเกจที่จ่ายไว้ได้ถึง <span className="whitespace-nowrap">{formatThaiDate(status.paidThrough)}</span></p>}
      </div>
      {!confirming && !selection && !operationId && !status.collection && status.allowedActions.includes('portal_cancel_subscription') && <button className={`${button} w-full sm:w-56`} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void act('preview')}>
        {status.cancelAtPeriodEnd ? status.renewalMode === 'PROMPTPAY_RENEW' ? 'เปิดการออกบิล QR ทุกงวด' : 'เปิดต่ออายุอัตโนมัติ' : 'หยุดต่ออายุอัตโนมัติ'}</button>}
    </div>}
    {status.collectionPause && <div className="rounded-xl bg-amber-50 p-4"><p>พักเก็บเงินอยู่ตามสถานะที่ตรวจล่าสุด</p><p>{status.collectionPause.resumesAt?`กำหนดกลับมาเก็บเงิน ${formatThaiDateTime(status.collectionPause.resumesAt)}`:'ยังไม่กำหนดวันกลับมาเก็บเงิน'}</p><p>วันใช้งานและใบเสร็จคงเดิม บิลที่ออกไว้ก่อนพักอาจยังถูกเรียกเก็บ ติดต่อทีมงานหากต้องการปรับการต่ออายุ</p></div>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3">{error}</p>}
    {status.pendingPlanChange && (status.pendingPlanChange.id !== operation?.id || completed) && <section aria-label="แพ็กเกจรอบถัดไป" className="space-y-4 rounded-xl bg-gray-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">แพ็กเกจรอบถัดไป</h3>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">{status.pendingPlanChange.state === 'BLOCKED' ? 'ต้องเลือกสิทธิ์ใหม่' : 'รอเริ่มใช้งาน'}</span>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-sm text-gray-500">แพ็กเกจ</dt><dd className="mt-1 font-semibold text-gray-900">{status.pendingPlanChange.targetOffer ? shopPlanTierLabel(status.pendingPlanChange.targetOffer.offerKey) : 'แพ็กเกจที่เลือกไว้'}{status.pendingPlanChange.targetOffer && <span className="mt-1 block text-sm font-normal text-gray-500">{status.pendingPlanChange.targetOffer.interval === 'year' ? 'รายปี' : 'รายเดือน'}</span>}</dd></div>
        <div><dt className="text-sm text-gray-500">วันที่เปลี่ยนแพ็กเกจ</dt><dd className="mt-1 font-semibold text-gray-900">{formatThaiDate(status.pendingPlanChange.effectiveAt)}</dd></div>
        {status.pendingPlanChange.action === 'PREPAID_PLAN_CHANGE' && <div><dt className="text-sm text-gray-500">แพ็กเกจใหม่ใช้ได้ถึง</dt><dd className="mt-1 font-semibold text-gray-900">{formatThaiDate(status.pendingPlanChange.expiresAt)}</dd></div>}
        <div><dt className="text-sm text-gray-500">{status.pendingPlanChange.action === 'PREPAID_PLAN_CHANGE' ? 'ยอดที่จ่ายแล้ว' : 'ยอดจ่ายรอบถัดไป'}</dt><dd className="mt-1 font-semibold text-gray-900">{`${(status.pendingPlanChange.nextRenewalTotalSatang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`}</dd></div>
      </dl>
      <p className="text-sm text-gray-500">ใช้แพ็กเกจเดิมได้ถึงวันที่ระบุ {status.pendingPlanChange.action === 'PREPAID_PLAN_CHANGE'
        ? status.pendingPlanChange.state === 'BLOCKED' ? 'แพ็กเกจใหม่จ่ายแล้ว กรุณาเลือกสาขาและผู้ใช้ล่าสุดก่อนเริ่มสิทธิ์ใหม่' : 'แพ็กเกจใหม่จ่ายแล้วและจะเริ่มอัตโนมัติในวันดังกล่าว'
        : 'แพ็กเกจใหม่เริ่มเมื่อจ่ายรอบถัดไปสำเร็จ'}</p>
      {!confirming && !selection && <ActionGroup>
        {apiOverride ? <button className={button} disabled={busy} aria-busy={busy} onClick={() => setOperation(status.pendingPlanChange!)}>ดูรายการเปลี่ยนแพ็กเกจ</button> : <Link className={button} href={`/companies/${encodeURIComponent(companyId)}/billing?collection=${status.pendingPlanChange.id}`}>ดูรายการเปลี่ยนแพ็กเกจ</Link>}
        {status.allowedActions.includes('plan_changes') && <button className={`${button} !border-transparent !bg-transparent !text-gray-500 hover:!bg-gray-100`} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void act('cancel-downgrade')}>ยกเลิกการเปลี่ยนแพ็กเกจ</button>}
      </ActionGroup>}
    </section>}    {status.planCapacityRepair && <div className="space-y-2 rounded-xl bg-amber-50 p-4"><p>รับเงินรอบใหม่แล้ว เลือกสาขาและผู้ใช้ก่อนเปิดแพ็กเกจใหม่</p>
      <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => { setBusy(true); const repair = status.planCapacityRepair!;
        void api.capacity(repair.offerKey, repair.interval).then(options => setSelection({ options, repair, key: crypto.randomUUID() })).catch(e => setError(apiErrorMessage(e))).finally(() => setBusy(false)); }}>เลือกสิทธิ์สำหรับรอบที่จ่ายแล้ว</button></div>}
    {selection && <BillingCapacityPicker key={selection.options.sourceHash+selection.key} options={selection.options} repair currentTierKey={status.tierKey} onCancel={() => setSelection(null)}
      onRefresh={async () => { const latest = await api.status(); if (!latest.planCapacityRepair) { setSelection(null); onChange(); return; }
        setSelection({ ...selection, options: await api.capacity(selection.options.offerKey, selection.options.interval), repair: latest.planCapacityRepair, key: crypto.randomUUID() }); }}
      onConfirm={async capacity => {
        await api.repairPlanCapacity(selection.repair.operationId, selection.repair.version, capacity, selection.key); setNotice('บันทึกแล้ว กำลังตรวจเปิดสิทธิ์จากรายการจ่ายเดิม');
        setSelection(null); onChange(); }} />}
    {operation && !selection && <article className={stopping ? "space-y-3" : "space-y-3 rounded-xl bg-gray-50 p-4"}>
      <h3 role="status" className="font-semibold">{stopping && operation.state === 'PREVIEW' ? stopQuestion : stopping && ['QUEUED', 'RUNNING', 'UNKNOWN'].includes(operation.state) ? `กำลังตรวจผลการ${stopLabel}` : operation.state === 'SUCCEEDED' ? operation.action === 'CANCEL_RENEWAL' ? operation.observedAt ? `${stopLabel}แล้ว` : `กำลังตรวจผลการ${stopLabel}` : operation.action === 'RESUME_RENEWAL' ? 'ยืนยันกลับมาต่ออายุแล้ว' : `ยืนยัน${actionLabel(operation.action)}แล้ว` : operation.state === 'PREVIEW' ? `ยืนยัน${actionLabel(operation.action)}` : labels[operation.state === 'FAILED' && operation.errorCode?.endsWith('_NOT_SENT') ? 'NOT_SENT' : operation.state] ?? operation.state}</h3>
      {stopping && <>
        <p>ใช้แพ็กเกจที่จ่ายไว้ได้ถึง <span className="whitespace-nowrap">{formatThaiDate(operation.effectiveAt)}</span>{!completed && ' การหยุดต่ออายุไม่คืนเงิน'}</p>
        {qrRenewal && <p>{status.renewalInvoiceUrl ? 'หยุดเฉพาะบิลรอบถัดไป บิลที่ออกแล้วเปิดจ่ายได้ที่ เปิดบิลพร้อมเพย์' : 'หยุดออกบิลรอบถัดไป'}</p>}
      </>}
      {!completed && <>
      {changingPlan && <p className="rounded-xl bg-brand-50 p-4 font-semibold text-brand-800">{prepaidChange ? 'จ่ายแพ็กเกจรอบถัดไปแล้ว' : 'วันนี้ยังไม่เรียกเก็บเงิน'} ใช้แพ็กเกจเดิมได้จนถึงวันที่ {formatThaiDate(operation.effectiveAt)}</p>}
      {!changingPlan && !stopping && <p>{operation.action==='ADMIN_PAUSE_COLLECTION'?'กำหนดกลับมาเก็บเงิน':operation.action==='ADMIN_RESUME_COLLECTION'?'วันที่ขอกลับมาเก็บเงิน':operation.action==='EXTEND_TERM'?'วันที่ขอขยายการใช้งานถึง':'สิทธิ์ที่ซื้อไว้ถึง'} {formatThaiDateTime(operation.effectiveAt)}</p>}
      {operation.action !== 'CANCEL_RENEWAL' && operation.action !== 'EXTEND_TERM' && !operation.action.startsWith('ADMIN_') && <p>{prepaidChange ? 'ยอดที่จ่ายแล้ว' : 'ยอดต่ออายุถัดไป'} {`${(operation.nextRenewalTotalSatang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`}{changingPlan && ` / ${operation.targetOffer?.interval === 'year' ? 'ปี' : 'เดือน'}`}</p>}
      {operation.targetOffer && <p>{prepaidChange ? 'แพ็กเกจรอบถัดไป' : 'เมื่อจ่ายรอบใหม่สำเร็จ'}: {shopPlanTierLabel(operation.targetOffer.offerKey)} · {operation.targetOffer.branchLimit} สาขา · {operation.targetOffer.employeeLimit} ผู้ใช้ · {operation.targetOffer.receiptAllowance} ใบ</p>}
      {/* Phase 7: a package change moves the menu set on the day it starts; only a package that
          really takes a menu away warns, the same way the purchase screen reads. */}
      {changingPlan && operation.featureImpact && (operation.featureImpact.removed.length > 0 || operation.featureImpact.added.length > 0) &&
        <div className={`space-y-2 rounded-xl border p-4 ${operation.featureImpact.removed.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`} aria-label="การเปลี่ยนสิทธิ์เมนูเมื่อเริ่มแพ็กเกจใหม่">
        <p className="font-semibold">สิทธิ์เมนูตั้งแต่ {formatThaiDate(operation.effectiveAt)}</p>
        {operation.featureImpact.removed.length > 0 && <><p>เมนูต่อไปนี้จะหยุดใช้ตั้งแต่วันนั้น โดยข้อมูลเดิมยังเก็บไว้:</p><ul className="list-disc space-y-1 break-words pl-6">{operation.featureImpact.removed.map(item => <li key={item.featureKey}>{item.labelTh}</li>)}</ul></>}
        {operation.featureImpact.added.length > 0 && <><p>เมนูที่จะเปิดใช้เพิ่มตั้งแต่วันนั้น:</p><ul className="list-disc space-y-1 break-words pl-6">{operation.featureImpact.added.map(item => <li key={item.featureKey}>{item.labelTh}</li>)}</ul></>}
        {operation.featureImpact.preservedAdmin > 0 && <p>สิทธิ์พิเศษที่ผู้ดูแลกำหนดให้เฉพาะร้านนี้ยังคงอยู่</p>}
      </div>}
      {operation.capacity && <div><p>คงสาขา: {operation.capacity.retainedBranches.join(', ')} · พักสาขา: {operation.capacity.suspendedBranches.join(', ') || 'ไม่มี'}</p><p>คงผู้ใช้: {operation.capacity.retainedMembers.join(', ')} · พักผู้ใช้: {operation.capacity.suspendedMembers.join(', ') || 'ไม่มี'}</p><p>ข้อมูลและประวัติยังอยู่ หากรายชื่อเปลี่ยนจะให้ตรวจเลือกอีกครั้ง</p></div>}
      {!stopping && <p>{operation.action.startsWith('ADMIN_') ? 'รายการนี้ปรับเฉพาะการเก็บเงิน ไม่เพิ่มวันใช้งานหรือจำนวนใบเสร็จ และไม่เรียกเก็บบิลร่างย้อนหลัง' : operation.action==='EXTEND_TERM' ? operation.state === 'SUCCEEDED' ? 'เพิ่มวันใช้งานแล้ว รายการนี้ไม่มีค่าใช้จ่ายและไม่เพิ่มจำนวนใบเสร็จ' : 'ผู้ดูแลกำลังดำเนินการแถมวัน ไม่เพิ่มจำนวนใบเสร็จหรือเรียกเก็บเงินจากรายการนี้ ตรวจสถานะล่าสุดเพื่อดูวันที่ยืนยันแล้ว' : prepaidChange ? operation.state === 'BLOCKED' ? 'จ่ายแพ็กเกจใหม่แล้ว กรุณาเลือกสาขาและผู้ใช้ล่าสุดเพื่อเริ่มสิทธิ์จากรายการเดิม โดยไม่ต้องจ่ายซ้ำ' : 'จ่ายแพ็กเกจใหม่แล้ว สิทธิ์เดิมคงอยู่จนถึงวันเริ่มแพ็กเกจรอบถัดไป' : changingPlan ? 'แพ็กเกจใหม่จะเริ่มเมื่อจ่ายรอบถัดไปสำเร็จ สิทธิ์เดิมที่ซื้อไว้ไม่ลดลงในวันนี้' : 'วันและจำนวนใบเสร็จที่ซื้อไว้คงเดิม การเปลี่ยนการต่ออายุไม่เพิ่มจำนวนใบเสร็จหรือคืนเงิน'}</p>}
      {!stopping && operation.state === 'PREVIEW' && <p>ตรวจและยืนยันได้ถึง {new Date(operation.expiresAt).toLocaleTimeString('th-TH')}</p>}
      {!stopping && (ended || operation.state === 'UNKNOWN') && <p>กลับมาเปิดรายการเดิมเพื่อตรวจสถานะ หรือติดต่อทีมงาน</p>}
      </>}
      {(stopping || !completed) && ['past_due', 'unpaid'].includes(status.subscriptionState) && <p>ยอดค้างเดิมยังต้องตรวจแยกกับทีมงาน การหยุดต่ออายุไม่ใช่การยกเว้นหนี้</p>}
      <ActionGroup>{[...operation.allowedActions].sort(action => action === 'withdraw' ? -1 : 1).map(action => <button key={action} className={action === 'submit' ? billingPrimaryControl : button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void act(action)}>
        {action === 'withdraw' ? stopping ? operation.state === 'PREVIEW' ? 'ปิด' : `ถอนคำขอ${stopLabel}` : 'ยกเลิก' : stopping ? stopLabel : `ยืนยัน${actionLabel(operation.action)}`}</button>)}
        {(!completed || (stopping && operation.state === 'SUCCEEDED' && !operation.observedAt)) && operation.state !== 'PREVIEW' && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void act('refresh')}>{qrRenewal ? 'ตรวจผลการออกบิล' : 'ตรวจผลการต่ออายุ'}</button>}</ActionGroup>
    </article>}
    {!operation && id && <button className={button} onClick={() => setReload(v => v + 1)}>โหลดคำขออีกครั้ง</button>}
  </section></div>;
}
