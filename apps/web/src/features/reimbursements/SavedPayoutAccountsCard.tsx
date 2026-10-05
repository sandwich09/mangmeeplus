'use client';

import { useEffect, useRef, useState } from 'react';
import { PAYOUT_SAVED_ACCOUNT_LIMIT, PAYOUT_SAVED_ACCOUNT_LABEL_MAX_LENGTH, type PayoutHolderFacts, type SavedPayoutAccountSummary, type SavedPayoutAccountListResponse } from '@watchdog-bms/contracts';
import { MangmeeCard, cx } from '@/common/components/mangmee';
import { ErrorState, LoadingState } from '@/common/components/state';
import { useConfirm } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { ErrorBanner, btnClass, ghostClass, inputClass } from '../expenses/ExpensesUi';
import { AccountNumberReveal, PayoutAccountFields, PayoutHolderFields, SavedPayoutAccountDetails, labelClass } from './ReimbursementPayout';
import { addMySavedPayoutAccount, deleteMySavedPayoutAccount, getMySavedPayoutAccounts, makeMySavedPayoutAccountDefault, revealMySavedPayoutAccount } from './reimbursement-payout.api';
import { emptyPayoutAccountForm, payoutDestinationInput, payoutHolderInput, savedPayoutAccountFormError } from './reimbursement-payout.logic';
import { REIMBURSEMENT_SAVED_PAYOUT_WORDS as W } from '@watchdog-bms/contracts';
import { errorText } from './reimbursements.logic';

export function SavedPayoutAccountsCard({ companyId, onDefaultChanged }: { companyId: string; onDefaultChanged: () => void }) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [list, setList] = useState<SavedPayoutAccountListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [account, setAccount] = useState(emptyPayoutAccountForm);
  const [holder, setHolder] = useState<PayoutHolderFacts>({ holderType: 'SELF' });
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string>();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    let active = true;
    setList(null); setLoadError(null);
    getMySavedPayoutAccounts(companyId).then(response => { if (active) setList(response); })
      .catch(e => { if (active) setLoadError(errorText(e)); });
    return () => { active = false; };
  }, [companyId, reload]);
  useEffect(() => {
    if (invalidField) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [invalidField]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = savedPayoutAccountFormError(account, holder, label);
    if (problem) {
      setError(problem.text); setInvalidField(problem.field);
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setBusy(true); setError(null); setInvalidField(undefined);
    try {
      await addMySavedPayoutAccount(companyId, { ...payoutDestinationInput(account), ...payoutHolderInput(holder), ...(label.trim() && { label: label.trim() }) });
      setAdding(false); setAccount(emptyPayoutAccountForm()); setHolder({ holderType: 'SELF' }); setLabel('');
      setReload(value => value + 1); toast.success(W.saved);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!(await confirm({ title: W.deleteTitle, message: W.deleteNotice, confirmLabel: 'ลบบัญชี', cancelLabel: 'กลับ', variant: 'danger' }))) return;
    setBusy(true); setError(null);
    try { await deleteMySavedPayoutAccount(companyId, id); setReload(value => value + 1); toast.success(W.removed); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const makeDefault = async (id: string) => {
    setBusy(true); setError(null);
    try {
      await makeMySavedPayoutAccountDefault(companyId, id);
      onDefaultChanged(); setReload(value => value + 1); toast.success(W.madeDefault);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const full = !!list && list.accounts.length >= Math.min(list.limit, PAYOUT_SAVED_ACCOUNT_LIMIT);
  return <MangmeeCard className="space-y-3 p-4 [overflow-wrap:anywhere] sm:p-5">
    <h2 className="text-base font-bold text-gray-900">{W.title}</h2>
    <p className="text-sm text-gray-500">{W.limit}</p>
    {loadError ? <ErrorState description={loadError} onRetry={() => setReload(value => value + 1)} />
      : !list ? <LoadingState label={W.loading} /> : <>
        {list.accounts.length === 0 && <p className="text-sm text-gray-600">{W.empty}</p>}
        {list.accounts.map((row, index) => <SavedPayoutAccountRow key={row.id} companyId={companyId} account={row} index={index} busy={busy}
          onMakeDefault={() => void makeDefault(row.id)} onRemove={() => void remove(row.id)} />)}
        {adding && !full ? <form ref={formRef} className="space-y-3 border-t border-gray-100 pt-3" onSubmit={save} noValidate>
          <h3 className="font-semibold">{W.add}</h3>
          <PayoutAccountFields value={account} onChange={value => { setAccount(value); setInvalidField(undefined); setError(null); }} disabled={busy} invalidField={invalidField} accountNameHint={W.accountNameHint} />
          <PayoutHolderFields value={holder} onChange={value => { setHolder(value); setInvalidField(undefined); setError(null); }} forSelf disabled={busy} invalidField={invalidField} />
          <label className={labelClass}>{W.label}<input aria-label={W.label} aria-invalid={invalidField === 'label'} className={cx(inputClass, 'mt-1.5 min-h-11 w-full')} maxLength={PAYOUT_SAVED_ACCOUNT_LABEL_MAX_LENGTH} disabled={busy}
            value={label} onChange={event => { setLabel(event.target.value); setInvalidField(undefined); setError(null); }} /></label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className={cx(ghostClass, 'min-h-11')} disabled={busy} onClick={() => { setAdding(false); setError(null); setInvalidField(undefined); }}>ยกเลิก</button>
            <button type="submit" className={cx(btnClass, 'min-h-11')} disabled={busy} aria-busy={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึกบัญชี'}</button>
          </div>
        </form> : !full && <button type="button" className={cx(btnClass, 'min-h-11 w-full sm:w-auto')} disabled={busy} onClick={() => { setAdding(true); setError(null); }}>{W.add}</button>}
      </>}
    {error && <ErrorBanner message={error} />}
    {confirmDialog}
  </MangmeeCard>;
}

export function SavedPayoutAccountRow({ companyId, account, index, busy, onMakeDefault, onRemove }: {
  companyId: string; account: SavedPayoutAccountSummary; index: number; busy: boolean; onMakeDefault: () => void; onRemove: () => void;
}) {
  return <div className="min-w-0 space-y-3 rounded-xl border border-gray-200 p-3">
    <SavedPayoutAccountDetails account={account} index={index} />
    <AccountNumberReveal masked="" payoutKind={account.payoutKind} revealKey={`${companyId}:${account.id}`} canReveal last4={account.accountLast4}
      onReveal={async () => (await revealMySavedPayoutAccount(companyId, account.id)).accountNumber} />
    <div className="flex flex-col gap-2 sm:flex-row">
      {account.holderType === 'SELF' && <button type="button" className={cx(btnClass, 'min-h-11 w-full sm:w-auto')} disabled={busy} aria-busy={busy} onClick={onMakeDefault}>{W.makeDefault}</button>}
      <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} disabled={busy} aria-busy={busy} onClick={onRemove}>ลบบัญชี</button>
    </div>
  </div>;
}
