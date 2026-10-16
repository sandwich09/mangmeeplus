'use client';

import { useEffect, useId, useState } from 'react';
import { Modal } from '@/common/components/modal/Modal';
import { sanitizeReasonInput } from '@/common/forms/sanitize';
import { cx } from '@/common/components/mangmee';
import { dangerClass, ErrorBanner, ghostClass, inputClass } from './ExpensesUi';

/**
 * The one question asked before a substitute-receipt certificate is cancelled, from the list and
 * from the certificate's own page alike (thai-ux-standard 4.1, 4.2, 4.5). It replaces two dialogs
 * in a row on the list and a one-press cancel with no question on the certificate's page.
 *
 * The title names the document, the body is one sentence about what happens, the buttons name the
 * two outcomes. A typed reason is not lost to a stray tap: the shared `Modal` asks before ✕, Escape
 * or the backdrop close it (`dirty`). A failed cancel keeps the dialog and the reason, with the
 * failure said inside it.
 */
export function SubstituteReceiptCancelDialog({ open, documentNumber, busy, error, onClose, onConfirm }: {
  open: boolean;
  documentNumber: string;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const fieldId = useId();
  // A new question starts empty; the same question reopened after a failure keeps what was typed.
  useEffect(() => { if (open) { setReason(''); setAttempted(false); } }, [open, documentNumber]);
  const missing = attempted && !reason.trim();
  return (
    <Modal open={open} title={`ยกเลิกใบรับรอง ${documentNumber}`} size="sm" dirty={reason.trim() !== '' && !busy} onClose={() => { if (!busy) onClose(); }}
      footer={<>
        <button type="button" className={ghostClass} disabled={busy} onClick={onClose}>ไม่ยกเลิก</button>
        <button type="button" className={dangerClass} disabled={busy} aria-busy={busy}
          onClick={() => { setAttempted(true); if (reason.trim()) onConfirm(reason.trim()); }}>ยกเลิกใบรับรอง</button>
      </>}>
      <p className="mb-4 text-sm text-gray-600">ใบนี้จะใช้ไม่ได้อีก ค่าใช้จ่ายและการจ่ายที่บันทึกไว้ยังอยู่</p>
      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}
      <label className="block text-sm font-semibold text-gray-700" htmlFor={fieldId}>
        เหตุผลที่ยกเลิก <span className="text-error-700" aria-hidden="true">*</span>
      </label>
      <textarea id={fieldId} className={cx(inputClass, 'mt-2')} rows={3} maxLength={500} required value={reason}
        aria-invalid={missing || undefined} aria-describedby={missing ? `${fieldId}-error` : undefined}
        onChange={(event) => setReason(sanitizeReasonInput(event.target.value))} />
      {missing && <p id={`${fieldId}-error`} role="alert" className="mt-1 text-sm text-error-700">กรอกเหตุผลที่ยกเลิก</p>}
    </Modal>
  );
}
