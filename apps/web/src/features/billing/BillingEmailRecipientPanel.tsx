'use client';
import { useEffect, useMemo, useState } from 'react';
import type { BillingEmailRecipient, BillingEmailRecipientOperation } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { billingApi } from './billing.api';
const button = 'mangmee-btn mangmee-btn-secondary min-h-11';
export function BillingEmailRecipientPanel({ companyId, email, ready, accountHref, apiOverride }: { companyId: string; email: string; ready: boolean; accountHref: string; apiOverride?: ReturnType<typeof billingApi> }) {
  const api = useMemo(() => apiOverride ?? billingApi(companyId), [companyId, apiOverride]);
  const [current, setCurrent] = useState<BillingEmailRecipient | null>(null), [operation, setOperation] = useState<BillingEmailRecipientOperation | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api.recipient().then(value => { if (active) { setCurrent(value); setOperation(value.operation); } }).catch(e => { if (active) setError(apiErrorMessage(e)); });
    return () => { active = false; };
  }, [api]);
  useEffect(() => {
    if (!operation || !['QUEUED', 'RUNNING', 'RECONCILING'].includes(operation.state)) return;
    let active = true;
    const timer = window.setInterval(() => { void api.recipientOperation(operation.id).then(value => {
      if (!active) return; setOperation(value);
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(value.state)) void api.recipient().then(result => { if (active) setCurrent(result); }).catch(() => {});
    }).catch(e => { if (active) setError(apiErrorMessage(e)); }); }, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [api, operation?.id, operation?.state]);
  async function command(action: 'preview' | 'submit' | 'cancel' | 'refresh') {
    if (busy) return; setBusy(true); setError('');
    try {
      if (action === 'refresh') { const value = await api.recipient(); setCurrent(value); if (operation) setOperation(await api.recipientOperation(operation.id)); }
      else if (action === 'preview') setOperation(await api.recipientPreview());
      else if (operation) {
        const next = action === 'submit' ? await api.recipientSubmit(operation) : await api.recipientCancel(operation);
        setOperation(next); setCurrent(await api.recipient()); if (action === 'submit') await api.refresh();
      }
    } catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  if (!current?.hasCustomer && !error) return null;
  return <section aria-label="ผู้รับเอกสารของบริษัท" className="mangmee-card space-y-4 p-5 sm:p-6">
    <h2 className="text-base font-semibold">อีเมลรับเอกสารของบริษัท</h2>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3">{error}</p>}
    {current && <p className="break-words">ผู้รับปัจจุบัน: <strong>{current.email ?? 'ยังไม่ระบุ'}</strong></p>}
    {!ready && <p className="text-sm text-gray-600">ต้องยืนยันอีเมลบัญชีก่อนเปลี่ยนผู้รับเอกสาร <a className="inline-flex min-h-11 items-center text-brand-700 underline" href={accountHref}>ไปที่บัญชีของฉัน</a></p>}
    {current?.email !== email && <p className="text-sm leading-6 text-gray-500">ผู้รับเอกสารยังเป็นอีเมลเดิม เลือกใช้อีเมลบัญชีที่ยืนยันแล้วได้ด้านล่าง มีผลเฉพาะเอกสารใหม่ของบริษัทนี้</p>}
    {operation && <div className="space-y-3 rounded-xl bg-gray-50 p-3">
      <p className="break-words">จาก {operation.previousEmail ?? 'ยังไม่ระบุ'} เป็น <strong>{operation.newEmail}</strong></p>
      <p role="status">{operation.state === 'COMPLETED' ? 'เปลี่ยนผู้รับเอกสารเรียบร้อยแล้ว' : operation.state === 'PREVIEW' ? 'ตรวจอีเมลแล้วกดยืนยันด้านล่าง' : operation.state === 'BLOCKED' ? 'ข้อมูลเปลี่ยนหรือยังดำเนินการไม่ได้ กรุณายกเลิกคำขอแล้วตรวจใหม่' : operation.state === 'RECONCILING' ? 'กำลังตรวจผลกับผู้ให้บริการ หากยังไม่สำเร็จ ติดต่อทีมมั่งมีพร้อมเลขอ้างอิงด้านล่าง คุณยังยกเลิกต่ออายุได้' : operation.state === 'CANCELLED' ? 'ยกเลิกคำขอแล้ว' : operation.state === 'FAILED' ? 'ดำเนินการไม่สำเร็จ กรุณาตรวจข้อมูลแล้วเริ่มคำขอใหม่' : 'กำลังดำเนินการ'}</p>
      <details className="text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิง</summary><p className="break-all">{operation.id}</p></details>
      {operation.canSubmit && <button className="mangmee-btn mangmee-btn-primary" disabled={busy || !ready || operation.newEmail !== email} aria-busy={Boolean(busy)} onClick={() => void command('submit')}>ยืนยันเปลี่ยนผู้รับเอกสารของบริษัทนี้</button>}
      {operation.canCancel && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void command('cancel')}>ยกเลิกคำขอ</button>}
    </div>}
    {current?.hasCustomer && current.email !== email && (!operation || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(operation.state)) && <button className={button} disabled={busy || !ready || current.busy} aria-busy={Boolean(busy)} onClick={() => void command('preview')}>ใช้เมลที่ยืนยันแล้วสำหรับเอกสารในอนาคต</button>}
    {(error || (operation && !['COMPLETED', 'CANCELLED'].includes(operation.state))) && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void command('refresh')}>ตรวจสถานะผู้รับเอกสาร</button>}
  </section>;
}
