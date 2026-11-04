'use client';
import { useState } from 'react';
import { useToast } from '@/common/components/toast/use-toast';
import { formatThaiMonth } from '@/common/i18n/thai-date';
import { E_WHT_WORDS, todayCivilDate } from '@watchdog-bms/contracts';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { confirmExpensePaymentDate } from './expenses.api';
import { expenseEWhtPaymentWarning } from './expenses.model';
import { btnClass, inputClass, err } from './ExpensesUi';

export function PaymentDateConfirmation({ companyId, expenseId, paymentId, canRecord, whtRemittance, whtCategoryCode, whtRate, onSaved, onConfirmed }: { companyId: string; expenseId: string; paymentId: string; canRecord: boolean; whtRemittance?: string | null; whtCategoryCode?: string | null; whtRate?: string | null; onSaved: () => void | Promise<void>; onConfirmed?: (periodKey: string, message: string) => void }) {
  const toast = useToast();
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="space-y-2">
    <p>{whtRemittance === 'E_WHT' ? E_WHT_WORDS['W-PD1'] : 'ยังไม่ทราบวันที่จ่ายเงินจริง ระบุวันที่จากหลักฐานก่อนนำไปยื่นภาษี'}</p>
    {canRecord ? <form className="space-y-2" onSubmit={async event => {
      event.preventDefault(); if (!date || busy) return; setBusy(true); setError('');
      try {
        await confirmExpensePaymentDate(companyId, expenseId, paymentId, date);
        try { await onSaved(); }
        finally {
          const periodKey = date.slice(0, 7);
          const message = whtRemittance === 'E_WHT' ? E_WHT_WORDS['W-PD2'] : `บันทึกวันที่จ่ายแล้ว รายการนี้อยู่ในแบบเดือน ${formatThaiMonth(periodKey)}`;
          if (onConfirmed) onConfirmed(periodKey, message);
          else toast.success(message);
        }
      }
      catch (e) { setError(err(e)); } finally { setBusy(false); }
    }}>
      <label className="block" htmlFor={`actual-payment-${paymentId}`}>วันที่จ่ายจริงจากหลักฐาน</label>
      <ThemedDate id={`actual-payment-${paymentId}`} className={inputClass} value={date} max={todayCivilDate('Asia/Bangkok')} required disabled={busy} onChange={e => setDate(e.target.value)} />
      {expenseEWhtPaymentWarning(whtRemittance, whtCategoryCode, whtRate, date) && <p role="status" className="text-sm text-warning-700">{E_WHT_WORDS['W-P2']}</p>}
      {error && <p role="alert">{error}</p>}
      <FormActionBar><ActionGroup><button type="submit" className={btnClass} disabled={busy} aria-busy={busy}>บันทึกวันที่จ่ายจริง</button></ActionGroup></FormActionBar>
    </form> : <p>ให้ผู้ที่บันทึกการจ่ายได้ระบุวันที่จากหลักฐาน</p>}
  </div>;
}
