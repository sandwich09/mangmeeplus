'use client';

import { useRef, useState } from 'react';
import { Modal } from '@/common/components/modal';
import { TextField } from '@/common/components/field';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { createSalesDemoLink, type SalesDemoLink } from './sales.api';

export function SalesDemoLinkDialog({ link: initialLink, onClose }: { link?: SalesDemoLink; onClose: () => void }) {
  const [link, setLink] = useState<SalesDemoLink | null>(initialLink ?? null);
  const [credit, setCredit] = useState('80');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creating = useRef(false);
  async function create() {
    if (creating.current) return;
    const aiCredit = Number(credit);
    if (!/^\d+$/.test(credit) || !Number.isInteger(aiCredit) || aiCredit < 1 || aiCredit > 300) {
      setValidation('กรอกเครดิต AI ของลิงก์นี้เป็นจำนวนเต็มตั้งแต่ 1 ถึง 300');
      return;
    }
    creating.current = true;
    setValidation(undefined); setError(null); setBusy(true);
    try { setLink(await createSalesDemoLink(aiCredit)); }
    catch (cause) { setError(apiErrorMessage(cause)); }
    finally { creating.current = false; setBusy(false); }
  }
  async function copy() {
    if (!link) return;
    setError(null);
    try { await navigator.clipboard.writeText(link.url); setCopied(true); }
    catch { setError('คัดลอกไม่สำเร็จ เลือกลิงก์ในช่องแล้วคัดลอกได้'); }
  }
  return <Modal open title={link ? 'ลิงก์เดโม่' : 'สร้างลิงก์เดโม่'} onClose={busy ? () => {} : onClose} size="sm" footer={<>
    <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={busy} onClick={onClose}>ปิด</button>
    <button type="button" className="mangmee-btn mangmee-btn-primary" disabled={busy} aria-busy={busy} onClick={() => void (link ? copy() : create())}>{link ? copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์' : busy ? 'กำลังสร้างลิงก์…' : 'สร้างลิงก์เดโม่'}</button>
  </>}>
    <div className="space-y-4">
      {link ? <>
        <TextField label="ลิงก์เดโม่" value={link.url} readOnly onFocus={event => event.target.select()} />
        <p className="text-sm leading-relaxed text-gray-600">ใช้ได้ถึง {formatThaiDateTime(link.expiresAt)} (3 วัน) · เครดิต {link.aiCredit}</p>
      </> : <TextField label="เครดิต AI ของลิงก์นี้" type="number" inputMode="numeric" min={1} max={300} step={1} value={credit} disabled={busy} error={validation} onChange={event => { setCredit(event.target.value); setValidation(undefined); }} />}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {copied && <p role="status" className="sr-only">คัดลอกแล้ว</p>}
    </div>
  </Modal>;
}
