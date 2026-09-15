'use client';
import { useEffect, useMemo, useState } from 'react';
import type { BillingEmailRecipient, BillingEmailRecipientOperation } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { billingApi } from './billing.api';
const button = 'min-h-11 rounded-xl border px-4 py-3 text-base font-semibold disabled:opacity-50';
export function BillingEmailRecipientPanel({ companyId, email, ready }: { companyId: string; email: string; ready: boolean }) {
  const api = useMemo(() => billingApi(companyId), [companyId]);
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
  return <section className="space-y-3 rounded-2xl border bg-white p-4 sm:p-6">
    <h2 className="text-lg font-semibold">ผู้รับเอกสารการชำระเงินของบริษัทนี้</h2>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3">{error}</p>}
    {current && <p className="break-words">ผู้รับปัจจุบัน: <strong>{current.email ?? 'ยังไม่ระบุ'}</strong></p>}
    <p>การเปลี่ยนอีเมลบัญชีจะไม่เปลี่ยนผู้รับของทุกบริษัทโดยอัตโนมัติ เปลี่ยนที่นี่สำหรับเอกสารในอนาคตของบริษัทนี้ เอกสารเดิม ราคาและสิทธิ์คงเดิม</p>
    {operation && <div className="space-y-3 rounded-xl bg-gray-50 p-3">
      <p className="break-words">จาก {operation.previousEmail ?? 'ยังไม่ระบุ'} เป็น <strong>{operation.newEmail}</strong></p>
      <p role="status">{operation.state === 'COMPLETED' ? 'เปลี่ยนผู้รับเอกสารเรียบร้อยแล้ว' : operation.state === 'PREVIEW' ? 'ตรวจอีเมลแล้วกดยืนยันด้านล่าง' : operation.state === 'BLOCKED' ? 'ข้อมูลเปลี่ยนหรือยังดำเนินการไม่ได้ กรุณายกเลิกคำขอแล้วตรวจใหม่' : operation.state === 'RECONCILING' ? 'กำลังตรวจผลกับผู้ให้บริการ หากยังไม่สำเร็จ ติดต่อทีมมั่งมีพร้อมเลขอ้างอิงด้านล่าง คุณยังยกเลิกต่ออายุได้' : operation.state === 'CANCELLED' ? 'ยกเลิกคำขอแล้ว' : operation.state === 'FAILED' ? 'ดำเนินการไม่สำเร็จ กรุณาตรวจข้อมูลแล้วเริ่มคำขอใหม่' : 'กำลังดำเนินการ'}</p>
      <p className="break-all text-sm">เลขอ้างอิง: {operation.id}</p>
      {operation.canSubmit && <button className={`${button} bg-green-600 text-white`} disabled={busy || !ready || operation.newEmail !== email} onClick={() => void command('submit')}>ยืนยันเปลี่ยนผู้รับเอกสารของบริษัทนี้</button>}
      {operation.canCancel && <button className={button} disabled={busy} onClick={() => void command('cancel')}>ยกเลิกคำขอ</button>}
    </div>}
    {current?.hasCustomer && current.email !== email && (!operation || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(operation.state)) && <button className={button} disabled={busy || !ready || current.busy} onClick={() => void command('preview')}>ใช้เมลที่ยืนยันแล้วสำหรับเอกสารในอนาคต</button>}
    <button className={button} disabled={busy} onClick={() => void command('refresh')}>ตรวจสถานะผู้รับเอกสาร</button>
  </section>;
}
