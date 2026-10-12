'use client';

import { ExpenseDisbursementCancellation } from './ExpenseDisbursementCancellation';
import type { ExpenseDetail } from './expenses.model';

import { useState } from 'react';
import { EXPENSE_VOID_CERTIFICATE_WORDS, EXPENSE_CORRECTION_WORDS, expenseVoidCertificatePermissionMessage, isExpenseVoidReason, type ExpenseCorrectionCapabilities } from '@watchdog-bms/contracts';
import { Modal } from '@/common/components/modal/Modal';
import { useToast } from '@/common/components/toast';
import { findForbiddenChars, REASON_MAX_LENGTH, sanitizeReasonInput } from '@/common/forms/sanitize';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { voidExpense } from './expenses.api';
import { dangerClass, err, ErrorBanner, ghostClass, inputClass } from './ExpensesUi';
import { ExpenseTaxFilingChoice, type TaxFilingChoice, type ExpenseCertificate } from './ExpenseCertificateReopen';

export function expenseCertificateVoidedMessage(certificate: Pick<ExpenseCertificate, 'kind' | 'number'>): string {
  const number = certificate.number ? `เลขที่ ${certificate.number}` : '';
  return certificate.kind === 'SYSTEM'
    ? `ยกเลิกเอกสารและหนังสือรับรอง${number} แล้ว`
    : `ยกเลิกเอกสารแล้ว และยกเลิกการบันทึกหนังสือรับรอง${number} แล้ว`;
}

export function ExpenseCertificateVoidDialog({ companyId, expenseId, certificate, payments = [], lockedTaxPeriods, open = true, onClose, onVoided }: {
  open?: boolean; companyId: string; expenseId: string; certificate: ExpenseCertificate; payments?: ExpenseDetail['payments'];
  /** From the page's capabilities: a filed withholding month is refused by the server, so it is said before any form. */
  lockedTaxPeriods?: ExpenseCorrectionCapabilities['lockedTaxPeriods'];
  onClose: () => void; onVoided: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [choice, setChoice] = useState<TaxFilingChoice>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const external = certificate.kind === 'EXTERNAL';
  const number = certificate.number ? ` เลขที่ ${certificate.number}` : '';
  // The server's own order: the certificate permission, then the filed withholding month.
  const filed = lockedTaxPeriods?.find(period => period.formType === 'PND3' || period.formType === 'PND53');
  const refusal = !certificate.canCancel ? expenseVoidCertificatePermissionMessage(certificate.kind, certificate.number)
    : filed ? EXPENSE_VOID_CERTIFICATE_WORDS.periodLocked(certificate.kind, filed.periodKey, filed.formType) : null;
  const submit = async (successMessage: (message: string) => string) => {
    if (refusal || busy || !choice) return;
    if (!isExpenseVoidReason(reason) || reason.trim().length > REASON_MAX_LENGTH) { setError(EXPENSE_CORRECTION_WORDS.reasonRequired); return; }
    const forbidden = findForbiddenChars(reason);
    if (forbidden.length) { setError(t('common.forbidden_chars', 'th').replace('{chars}', forbidden.join(' '))); return; }
    setBusy(true); setError(null);
    try {
      const answer = await voidExpense(companyId, expenseId, reason.trim(), true);
      toast.success(successMessage(expenseCertificateVoidedMessage(answer?.cancelledCertificate ?? certificate)));
      setReason(''); setChoice('');
      await onVoided();
      onClose();
    } catch (cause) { setError(err(cause)); }
    finally { setBusy(false); }
  };
  if (!open) return null;
  if (refusal) return <Modal open title={external ? 'ยกเลิกเอกสารที่บันทึกหนังสือรับรองไว้' : 'ยกเลิกเอกสารที่ออกหนังสือรับรองแล้ว'}
    size="sm" closeOnBackdrop={false} onClose={onClose}
    footer={<div className="mangmee-safe-bottom w-full"><button type="button" className={`${ghostClass} w-full`} onClick={onClose}>ปิด</button></div>}>
    <ErrorBanner message={refusal} />
  </Modal>;
  return <ExpenseDisbursementCancellation companyId={companyId} expenseId={expenseId} payments={payments}>{(warning, successMessage) => <Modal open title={external ? 'ยกเลิกเอกสารที่บันทึกหนังสือรับรองไว้' : 'ยกเลิกเอกสารที่ออกหนังสือรับรองแล้ว'}
    size="sm" closeOnBackdrop={false} onClose={() => { if (!busy) onClose(); }}
    /* The action's name is long: the two buttons stack at one width instead of wrapping inside two narrow columns. */
    footer={<div className="mangmee-safe-bottom grid w-full gap-2">
      <button type="button" className={`${ghostClass} w-full`} disabled={busy} aria-busy={false} onClick={onClose}>ไม่ยกเลิก</button>
      <button type="submit" form="expense-certificate-void-form" className={`${dangerClass} w-full`} disabled={busy || !choice} aria-busy={busy}>{external ? 'ยกเลิกเอกสาร' : 'ยกเลิกเอกสารและหนังสือรับรอง'}</button>
    </div>}>
    <form noValidate id="expense-certificate-void-form" className="space-y-3 text-sm leading-6 text-gray-700" onSubmit={event => { event.preventDefault(); void submit(successMessage); }}>
      <p className="font-semibold">{external ? 'เอกสารนี้บันทึกไว้ว่าออกหนังสือรับรองหัก ณ ที่จ่ายเองแล้ว' : 'เอกสารนี้ออกหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) แล้ว'} <span className="whitespace-nowrap">{number.trim()}</span></p>
      {external && <p>ระบบยกเลิกใบที่ร้านออกเองให้ไม่ได้ ร้านต้องยกเลิกเอง</p>}
      {error && <ErrorBanner message={error} />}
      {warning}
      <label className="block">{t('expenses.void_reason', 'th')}
        <textarea autoFocus className={`${inputClass} mt-1`} rows={3} value={reason} required maxLength={REASON_MAX_LENGTH} disabled={busy} onChange={event => { setReason(sanitizeReasonInput(event.target.value)); setError(null); }} />
      </label>
      <ExpenseTaxFilingChoice name="expense-void-tax-filing" value={choice} onChange={setChoice} busy={busy} />
    </form>
  </Modal>}</ExpenseDisbursementCancellation>;
}
