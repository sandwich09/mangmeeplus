'use client';

import { useState } from 'react';
import { EXPENSE_VOID_REASON_MIN_LENGTH, type ReimbursementRequestDetail, type ReimbursementCancellationCertificate } from '@watchdog-bms/contracts';
import { Modal } from '@/common/components/modal/Modal';
import { findForbiddenChars, REASON_MAX_LENGTH, sanitizeReasonInput } from '@/common/forms/sanitize';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { dangerClass, ErrorBanner, ghostClass, inputClass } from '../expenses/ExpensesUi';
import { TAX_FILING_ATTESTATION, TAX_FILING_HELP } from '../expenses/ExpenseCertificateReopen';

export function reimbursementCertificatesCancelledMessage(certificates: Pick<ReimbursementCancellationCertificate, 'kind' | 'number'>[]): string {
  return certificates.map(certificate => {
    const number = certificate.number ? `เลขที่ ${certificate.number}` : '';
    return certificate.kind === 'SYSTEM' ? `ยกเลิกคำขอและหนังสือรับรอง${number} แล้ว`
      : `ยกเลิกคำขอแล้ว และยกเลิกการบันทึกหนังสือรับรอง${number} แล้ว`;
  }).join(' ') || 'ยกเลิกคำขอเรียบร้อยแล้ว';
}

export function ReimbursementCertificateCancelDialog({ title, certificates, blocker, continuation = false, attestationRequired = false, initialReason = '', busy, error, onClose, onConfirm }: {
  title: string; certificates: ReimbursementCancellationCertificate[]; blocker?: ReimbursementRequestDetail['certificateCancelBlocker'];
  continuation?: boolean; attestationRequired?: boolean; initialReason?: string; busy?: boolean; error?: string | null;
  onClose: () => void; onConfirm: (reason: string, taxFilingAttested?: true) => void;
}) {
  const [reason, setReason] = useState(initialReason);
  const [attested, setAttested] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const externalOnly = certificates.every(certificate => certificate.kind === 'EXTERNAL');
  const needsAttestation = !continuation || attestationRequired;
  const refusalMessage = (message: string) => {
    // The heading already states the certificate facts; keep the permission and next step.
    const refusal = message.replace(/^คำขอนี้มีรายจ่ายที่.+? (การยกเลิกคำขอ)/, '$1');
    const expenseNumber = certificates.find(certificate => certificate.expenseNumber)?.expenseNumber;
    return expenseNumber ? refusal.replace('ที่หน้ารายจ่าย', `ที่หน้ารายจ่ายเลขที่ ${expenseNumber}${certificates.length > 1 ? ` และอีก ${certificates.length - 1} รายการ` : ''}`) : refusal;
  };
  const disabled = Boolean(busy || reason.trim().length < EXPENSE_VOID_REASON_MIN_LENGTH || (needsAttestation && !attested));
  const submit = () => {
    if (blocker || disabled) return;
    const forbidden = findForbiddenChars(reason);
    if (forbidden.length) { setLocalError(t('common.forbidden_chars', 'th').replace('{chars}', forbidden.join(' '))); return; }
    onConfirm(reason.trim(), needsAttestation ? true : undefined);
  };
  return <Modal open title={title} size="sm" closeOnBackdrop={false} closeLabel="ปิด" onClose={() => { if (!busy) onClose(); }}
    footer={<div className="mangmee-safe-bottom flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
      <button type="button" className={`${ghostClass} w-full sm:w-auto`} disabled={busy} onClick={onClose}>{/* Closing a continuation takes nothing back: the cancellation stays started ("ถอนการยกเลิก" is the way to stop it). */}{blocker || continuation ? 'ปิด' : 'ไม่ยกเลิก'}</button>
      {!blocker && <button type="submit" form="reimbursement-certificate-cancel-form" className={`${dangerClass} w-full sm:w-auto`} disabled={disabled} aria-busy={Boolean(busy)}>{externalOnly ? 'ยกเลิกคำขอ' : 'ยกเลิกคำขอและหนังสือรับรอง'}</button>}
    </div>}>
    <div className="space-y-3 text-sm leading-6 text-gray-700">
      {certificates.map((certificate, index) => <div key={index} className="space-y-3">
        <p className="font-semibold">{certificate.kind === 'SYSTEM' ? 'คำขอนี้มีรายจ่ายที่ออกหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) แล้ว' : 'คำขอนี้มีรายจ่ายที่บันทึกไว้ว่าออกหนังสือรับรองหัก ณ ที่จ่ายเองแล้ว'}{certificate.number && <> <span className="whitespace-nowrap">เลขที่ {certificate.number}</span></>}</p>
        {!blocker && <p>{certificate.kind === 'SYSTEM' ? 'ถ้ายกเลิกคำขอ ระบบจะยกเลิกหนังสือรับรองใบนี้ด้วยและเก็บไว้ในประวัติ' : 'ถ้ายกเลิกคำขอ ระบบจะยกเลิกการบันทึกนี้และเก็บไว้ในประวัติ ระบบยกเลิกหนังสือรับรองที่คุณออกเองให้ไม่ได้ กรุณายกเลิกใบนั้นเอง'}</p>}
      </div>)}
      {blocker ? <ErrorBanner message={refusalMessage(blocker.message)} /> :
      <form id="reimbursement-certificate-cancel-form" className="space-y-3" onSubmit={event => { event.preventDefault(); submit(); }}>
        {/* A shop that issues its certificates itself records the new one; the print button issues one in the system. */}
        <p>{externalOnly ? 'ถ้าข้อมูลผิด ให้ทำคำขอเบิกใหม่ด้วยข้อมูลที่ถูก แล้วบันทึกหนังสือรับรองใบใหม่'
          : `ถ้าข้อมูลผิด ให้ทำคำขอเบิกใหม่ด้วยข้อมูลที่ถูก แล้วกด “${t('wht.print_certificate', 'th')}” เพื่อออกใบใหม่`}</p>
        <p>ถ้าเคยส่งใบให้ผู้รับเงินแล้ว กรุณาแจ้งผู้รับเงินว่าใบนี้ยกเลิก</p>
        <p>คำขอที่ยกเลิกแล้วนำกลับมาใช้อีกไม่ได้</p>
        {(localError || error) && <ErrorBanner message={refusalMessage(localError || error!)} />}
        <label className="block">เหตุผลที่ยกเลิกคำขอ
          <textarea autoFocus className={`${inputClass} mt-1 min-h-24 resize-y`} value={reason} disabled={busy} onChange={event => { setReason(sanitizeReasonInput(event.target.value)); setLocalError(null); }} maxLength={REASON_MAX_LENGTH} placeholder="ระบุเหตุผลให้ชัดเจน" />
        </label>
        <div className="flex justify-between gap-3 text-xs text-gray-400"><span>อย่างน้อย {EXPENSE_VOID_REASON_MIN_LENGTH} ตัวอักษร</span><span className="tabular-nums">{reason.length}/{REASON_MAX_LENGTH}</span></div>
        {needsAttestation && <div className="space-y-2">
          <label className="flex min-h-11 items-start gap-2"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" required checked={attested} disabled={busy} onChange={event => setAttested(event.target.checked)} /><span>{TAX_FILING_ATTESTATION}</span></label>
          <p className="text-xs text-gray-600">{TAX_FILING_HELP}</p>
        </div>}
      </form>}
    </div>
  </Modal>;
}
