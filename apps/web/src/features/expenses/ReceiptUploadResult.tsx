'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { isCivilDate } from '@watchdog-bms/contracts';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { MangmeeCard } from '@/common/components/mangmee';
import { useToast } from '@/common/components/toast/use-toast';
import { useConfirm } from '@/common/components/modal';
import { LoadingState } from '@/common/components/state';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { findForbiddenChars, normalizeDecimalInput, stripDisallowed } from '@/common/forms/sanitize';
import { deleteExpense, getExpense, updateExpenseDraft } from './expenses.api';
import { canDeleteExpense, expenseDeleteErrorMessage, expenseDeleteTargetLabel, receiptDraftMissingFields, receiptDraftFillPayload, type ExpenseCapabilities, type ExpenseDetail } from './expenses.model';
import { btnClass, dangerClass, ErrorBanner, ghostClass, inputClass, err } from './ExpensesUi';

export function ReceiptUploadResult({ companyId, expenseIds, userId, caps, onSendAnother }: {
  companyId: string; expenseIds: string[]; userId: string; caps: ExpenseCapabilities; onSendAnother: () => void;
}) {
  const toast = useToast();
  const locale = useWorkspaceLocale();
  const headingFocused = useRef(false);
  const { confirm, confirmDialog } = useConfirm();
  const [details, setDetails] = useState<ExpenseDetail[] | null>(null);
  const [editing, setEditing] = useState<ExpenseDetail | null>(null);
  const [values, setValues] = useState({ vendor: '', date: '', amount: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationShown, setValidationShown] = useState(false);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const load = async () => {
    setError(null);
    try { setDetails(await Promise.all(expenseIds.filter(id => !deletedIds.includes(id)).map(id => getExpense(companyId, id)))); }
    catch (cause) { setError(err(cause, locale)); }
  };
  useEffect(() => { void load(); }, [companyId, expenseIds]);
  const missing = editing && receiptDraftMissingFields(editing, userId, caps);
  const amountInvalid = values.amount !== '' && !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(values.amount);
  const dateInvalid = values.date !== '' && !isCivilDate(values.date);
  const save = async () => {
    if (!editing || !missing || busy) return;
    setValidationShown(true);
    if (amountInvalid || dateInvalid) return;
    const forbidden = findForbiddenChars(values.vendor);
    if (forbidden.length) { setError(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' '))); return; }
    const patch = receiptDraftFillPayload(editing, missing, values);
    if (!Object.keys(patch).length) { setError('เติมข้อมูลอย่างน้อยหนึ่งช่อง หรือกดกลับ'); return; }
    setBusy(true); setError(null);
    try {
      await updateExpenseDraft(companyId, editing.id, { expectedUpdatedAt: editing.updatedAt, ...patch });
      toast.success('บันทึกข้อมูลแล้ว');
      setEditing(null);
      await load();
    } catch (cause) { setError(err(cause, locale)); }
    finally { setBusy(false); }
  };
  const remove = async (detail: ExpenseDetail) => {
    if (busy || !await confirm({ title: `ลบร่างใบเสร็จ ${expenseDeleteTargetLabel(detail) ?? ''}`.trim(), message: 'รูปและข้อมูลของรายการนี้จะถูกลบ', confirmLabel: 'ลบร่างใบเสร็จ', cancelLabel: 'ไม่ลบ', variant: 'danger' })) return;
    setBusy(true); setError(null);
    try { await deleteExpense(companyId, detail.id); setDeletedIds(ids => [...ids, detail.id]); setDetails(rows => rows!.filter(row => row.id !== detail.id)); }
    catch (cause) { setError(expenseDeleteErrorMessage(cause, locale, detail.status)); }
    finally { setBusy(false); }
  };
  return <div className="mangmee-flat space-y-4 [overflow-anchor:none]">
    {error && <ErrorBanner message={error} />}
    {editing && missing ? <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4">
      <MangmeeCard className="space-y-4 p-4 sm:p-6">
        <h2 className="text-base font-semibold">เติมข้อมูลใบเสร็จ</h2>
        <div className="grid items-start gap-3 md:grid-cols-3">
          {missing.vendor && <label className="block"><span className="mb-1 block min-h-6 text-sm font-medium">{t('expenses.vendor_name', locale)}</span>
            <input className={inputClass} value={values.vendor} onChange={event => setValues(v => ({ ...v, vendor: stripDisallowed(event.target.value) }))} disabled={busy} />
          </label>}
          {missing.date && <div><label htmlFor="receipt-fill-date" className="mb-1 block min-h-6 text-sm font-medium">{t('expenses.expense_date', locale)}</label>
            <ThemedDate id="receipt-fill-date" className={inputClass} value={values.date} disabled={busy} onChange={event => setValues(v => ({ ...v, date: event.target.value }))} />
            {validationShown && dateInvalid && <p role="alert" className="text-sm text-error-700">วันที่เอกสารไม่ถูกต้อง เลือกวันที่ใหม่</p>}
          </div>}
          {missing.amount && <label className="block"><span className="mb-1 block min-h-6 text-sm font-medium">จำนวนเงิน</span>
            <input className={inputClass} inputMode="decimal" value={values.amount} aria-invalid={validationShown && amountInvalid || undefined} disabled={busy} onChange={event => setValues(v => ({ ...v, amount: normalizeDecimalInput(event.target.value) }))} />
            {validationShown && amountInvalid && <span role="alert" className="block text-sm text-error-700">จำนวนเงินไม่ถูกต้อง กรอกตัวเลขใหม่</span>}
          </label>}
        </div>
      </MangmeeCard>
      <FormActionBar><ActionGroup>
        <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => { setEditing(null); setError(null); }}>กลับ</button>
        <button type="submit" className={btnClass} disabled={busy} aria-busy={busy}>{busy ? t('expenses.saving', locale) : 'บันทึกข้อมูล'}</button>
      </ActionGroup></FormActionBar>
    </form> : <>
      <MangmeeCard className="space-y-4 p-4 sm:p-6">
        <h2 tabIndex={-1} ref={node => { if (node && !headingFocused.current) { headingFocused.current = true; node.focus({ preventScroll: true }); } }} className="text-base font-semibold"><span role="status">{details?.length === 0 ? 'ลบร่างใบเสร็จแล้ว' : 'ส่งใบเสร็จแล้ว ผู้ตรวจจะตรวจและยืนยันให้'}</span></h2>
        {!details && !error && <LoadingState />}
        {!details && error && <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => void load()}>ลองอีกครั้ง</button>}
        {details?.map((detail, index) => <div key={detail.id} className="space-y-2">
          {details.length > 1 && <p className="text-sm font-medium">ใบเสร็จที่ {index + 1}</p>}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {receiptDraftMissingFields(detail, userId, caps) && <p className="text-sm">ระบบอ่านบางช่องไม่ออก</p>}
            <ActionGroup>
              {canDeleteExpense(detail, userId, caps) && <button type="button" className={dangerClass} disabled={busy} aria-busy={busy} onClick={() => void remove(detail)}>ลบร่างใบเสร็จ</button>}
              {receiptDraftMissingFields(detail, userId, caps) && <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => { setValues({ vendor: '', date: '', amount: '' }); setValidationShown(false); setError(null); setEditing(detail); }}>เติมข้อมูล</button>}
            </ActionGroup>
          </div>
        </div>)}
      </MangmeeCard>
      <ActionGroup className="!grid !grid-flow-col !auto-cols-fr">
        <Link className={ghostClass} href={`/companies/${companyId}/expenses`}>ดูรายการที่ส่ง</Link>
        <button type="button" className={btnClass} disabled={busy} aria-busy={busy} onClick={onSendAnother}>ส่งอีกใบ</button>
      </ActionGroup>
    </>}
    {confirmDialog}
  </div>;
}
