'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CoverLoader } from '@/common/components/state/CoverLoader';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { ExpenseDetail } from './expenses.model';
import type { DisbursementVoucherDetail } from './disbursement-vouchers/disbursement-vouchers.model';
import { getDisbursementVoucher } from './disbursement-vouchers/disbursement-vouchers.api';
import { disbursementPaymentsToCancel, expenseDisbursementCancellationWarnings, expenseDisbursementCancellationToast } from './disbursement-vouchers/disbursement-voucher-expense.logic';

export function ExpenseDisbursementCancellation({ companyId, expenseId, payments = [], paymentId, certificate, children }: {
  companyId: string; expenseId: string; payments?: ExpenseDetail['payments']; paymentId?: string;
  certificate?: NonNullable<ExpenseDetail['correctionCapabilities']>['certificateOnExpense'];
  children: (warning: ReactNode, successMessage: (message: string) => string) => ReactNode;
}) {
  const ids = [...new Set(disbursementPaymentsToCancel(payments, paymentId).flatMap(payment => payment.disbursementVoucher?.id ? [payment.disbursementVoucher.id] : []))];
  const key = JSON.stringify(ids);
  const [vouchers, setVouchers] = useState<Record<string, DisbursementVoucherDetail>>({});
  const [loading, setLoading] = useState(ids.length > 0);
  useEffect(() => {
    let active = true;
    setVouchers({}); setLoading(ids.length > 0);
    void Promise.allSettled(ids.map(id => getDisbursementVoucher(companyId, id, { suppressErrorToast: true }))).then(results => {
      if (!active) return;
      setVouchers(Object.fromEntries(results.flatMap((result, index) => result.status === 'fulfilled' ? [[ids[index]!, result.value]] : [])));
      setLoading(false);
    });
    return () => { active = false; };
    // The stable key contains the ids; unrelated typing must not re-read the documents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, key]);
  const warnings = expenseDisbursementCancellationWarnings(payments, vouchers, expenseId, paymentId);
  const certificateWarning = paymentId && certificate
    ? `${certificate.kind === 'SYSTEM' ? 'หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)' : 'การบันทึกหนังสือรับรองที่ทำนอกระบบ'}${certificate.number ? `${certificate.kind === 'SYSTEM' ? ' เลขที่ ' : 'เลขที่ '}${certificate.number}` : ''} ของเอกสารนี้ยังอยู่ การยกเลิกการจ่ายไม่ยกเลิกหนังสือรับรอง`
    : null;
  const warning = <>{warnings.length > 0 && <CoverLoader active={loading} scope="section" label={t('common.loading', 'th')}>
    <div className="space-y-2 text-sm text-warning-800 [overflow-wrap:anywhere]">{warnings.map(sentence => <p key={sentence}>{sentence.split(/(PV-\d{6}-\d+)/g).map((part, index) => /^PV-\d{6}-\d+$/.test(part) ? <span key={index} className="whitespace-nowrap">{part}</span> : part)}</p>)}</div>
  </CoverLoader>}{certificateWarning && <p className="text-sm leading-6 text-gray-700 [overflow-wrap:anywhere]">{certificateWarning}</p>}</>;
  return children(warning, message => expenseDisbursementCancellationToast(message, payments, paymentId, vouchers));
}
