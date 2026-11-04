'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { PAYOUT_SAVED_ACCOUNT_LIMIT, PAYOUT_SAVED_ACCOUNT_LABEL_MAX_LENGTH, type PayoutHolderFacts, type SavedPayoutAccountSummary, type SavedPayoutAccountListResponse } from '@watchdog-bms/contracts';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { FieldError } from '@/common/components/field/Field';
import { MangmeeCard, cx } from '@/common/components/mangmee';
import { ErrorState, LoadingState } from '@/common/components/state';
import { useConfirm } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { ErrorBanner, btnClass, dangerClass, ghostClass, inputClass } from '../expenses/ExpensesUi';
import { AccountNumberReveal, PayoutAccountFields, PayoutHolderFields, SavedPayoutAccountDetails, labelClass } from './ReimbursementPayout';
import { addMySavedPayoutAccount, deleteMySavedPayoutAccount, getMySavedPayoutAccounts, getMyPayoutAccount, makeMySavedPayoutAccountDefault, revealMySavedPayoutAccount } from './reimbursement-payout.api';
import { emptyPayoutAccountForm, payoutDestinationInput, payoutHolderInput, savedPayoutAccountFormError } from './reimbursement-payout.logic';
import { REIMBURSEMENT_SAVED_PAYOUT_WORDS as W } from '@watchdog-bms/contracts';
import { errorText } from './reimbursements.logic';

/** What the card is doing: nothing, saving the new account, or changing one row (which row, and how). */
type Busy = false | 'save' | { id: string; act: 'default' | 'remove' };

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
  const [busy, setBusy] = useState<Busy>(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string>();
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const labelErrorId = useId();
  useEffect(() => {
    if (error && !invalidField) {
      errorRef.current?.scrollIntoView({ block: 'start' }); errorRef.current?.focus({ preventScroll: true });
    }
  }, [error, invalidField]);
  useEffect(() => {
    let active = true;
    setList(null); setLoadError(null);
    getMySavedPayoutAccounts(companyId).then(response => { if (active) setList(response); })
      .catch(e => { if (active) setLoadError(errorText(e)); });
    return () => { active = false; };
  }, [companyId, reload]);
  useEffect(() => {
    if (!invalidField) return;
    const field = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    field?.scrollIntoView({ block: 'start' }); field?.focus({ preventScroll: true });
  }, [invalidField]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = savedPayoutAccountFormError(account, holder, label);
    if (problem) {
      setError(problem.text); setInvalidField(problem.field);
      requestAnimationFrame(() => {
        const field = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        field?.scrollIntoView({ block: 'start' }); field?.focus({ preventScroll: true });
      });
      return;
    }
    setBusy('save'); setError(null); setInvalidField(undefined);
    try {
      await addMySavedPayoutAccount(companyId, { ...payoutDestinationInput(account), ...payoutHolderInput(holder), ...(label.trim() && { label: label.trim() }) });
      setAdding(false); setAccount(emptyPayoutAccountForm()); setHolder({ holderType: 'SELF' }); setLabel('');
      setReload(value => value + 1); toast.success(W.saved);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const remove = async (row: SavedPayoutAccountSummary, index: number) => {
    if (!(await confirm({ title: W.deleteTitle, message: <span className="block space-y-3"><SavedPayoutAccountDetails account={row} index={index} /><span className="block">{W.deleteNotice}</span></span>, confirmLabel: 'ลบบัญชี', cancelLabel: 'ไม่ลบ', variant: 'danger' }))) return;
    setBusy({ id: row.id, act: 'remove' }); setError(null); setInvalidField(undefined);
    try { await deleteMySavedPayoutAccount(companyId, row.id); setReload(value => value + 1); toast.success(W.removed); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const makeDefault = async (id: string) => {
    setBusy({ id, act: 'default' }); setError(null); setInvalidField(undefined);
    try {
      const previous = await getMyPayoutAccount(companyId);
      await makeMySavedPayoutAccountDefault(companyId, id);
      onDefaultChanged(); setReload(value => value + 1); toast.success(previous.account?.payoutMethod === 'BANK_TRANSFER' ? W.madeDefaultWithPrevious : W.madeDefault);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const cardBusy = busy !== false;
  const full = !!list && list.accounts.length >= Math.min(list.limit, PAYOUT_SAVED_ACCOUNT_LIMIT);
  return <MangmeeCard className="space-y-3 p-4 [overflow-wrap:anywhere] sm:p-5">
    <h2 className="text-base font-bold text-gray-900">{W.title}</h2>
    {loadError ? <ErrorState description={loadError} onRetry={() => setReload(value => value + 1)} />
      : !list ? <LoadingState label={W.loading} /> : <>
        {list.accounts.length === 0 && !adding && <p className="text-sm text-gray-600">{W.empty}</p>}
        {/* Rows with a line between: an account is not a card inside this card. */}
        {list.accounts.length > 0 && <div className="divide-y divide-gray-100">
          {list.accounts.map((row, index) => <SavedPayoutAccountRow key={row.id} companyId={companyId} account={row} index={index} busy={cardBusy}
            working={typeof busy === 'object' && busy.id === row.id ? busy.act : undefined}
            onMakeDefault={() => void makeDefault(row.id)} onRemove={() => void remove(row, index)} />)}
        </div>}
        {/* The limit is said when it is reached, in place of the button it takes away. */}
        {full ? <p className="text-sm text-gray-500">{W.limit}</p> : adding ? <form ref={formRef} className="space-y-3 border-t border-gray-100 pt-3" onSubmit={save} noValidate>
          <h3 className="font-semibold">{W.add}</h3>
          <PayoutAccountFields value={account} onChange={value => { setAccount(value); setInvalidField(undefined); setError(null); }} disabled={cardBusy} invalidField={invalidField} error={error} accountNameHint={W.accountNameHint} />
          <PayoutHolderFields value={holder} onChange={value => { setHolder(value); setInvalidField(undefined); setError(null); }} forSelf disabled={cardBusy} invalidField={invalidField} error={error} />
          <label className={labelClass}>{W.label}<input aria-label={W.label} aria-invalid={invalidField === 'label'} aria-describedby={invalidField === 'label' && error ? labelErrorId : undefined} className={cx(inputClass, 'mt-1.5 min-h-11 w-full scroll-mt-[calc(var(--app-header-h)+1rem)]')} maxLength={PAYOUT_SAVED_ACCOUNT_LABEL_MAX_LENGTH} disabled={cardBusy}
            value={label} onChange={event => { setLabel(event.target.value); setInvalidField(undefined); setError(null); }} />{invalidField === 'label' && error && <FieldError id={labelErrorId}>{error}</FieldError>}</label>
          <ActionGroup>
            <button type="button" className={ghostClass} disabled={cardBusy} onClick={() => { setAdding(false); setError(null); setInvalidField(undefined); }}>ยกเลิก</button>
            <button type="submit" className={btnClass} disabled={cardBusy} aria-busy={busy === 'save'}>บันทึกบัญชีรับเงินคืน</button>
          </ActionGroup>
        </form> : (
          // Never the page's main button: that is setting the standing account above, and only while there is none.
          // A line parts it from the last row, whose own buttons end just above it.
          <div className={list.accounts.length > 0 ? 'border-t border-gray-100 pt-3' : undefined}>
            <ActionGroup>
              <button type="button" className={ghostClass} disabled={cardBusy} onClick={() => { setAdding(true); setError(null); }}>{W.add}</button>
            </ActionGroup>
          </div>
        )}
      </>}
    {/* A field's own problem is said under that field, once; this box is for what no field can be blamed for. */}
    {error && !invalidField && <div ref={errorRef} tabIndex={-1} className="scroll-mt-[calc(var(--app-header-h)+1rem)]"><ErrorBanner message={error} /></div>}
    {confirmDialog}
  </MangmeeCard>;
}

export function SavedPayoutAccountRow({ companyId, account, index, busy, working, onMakeDefault, onRemove }: {
  companyId: string; account: SavedPayoutAccountSummary; index: number; busy: boolean;
  /** The one button of this row that was pressed and is still working: it alone shows the working mark. */
  working?: 'default' | 'remove';
  onMakeDefault: () => void; onRemove: () => void;
}) {
  // From 640 px the row's own actions sit at its right, level with the button that shows the number; on a phone they follow it.
  return <div className="min-w-0 space-y-3 py-3 first:pt-0 last:pb-0 sm:flex sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-4 sm:gap-y-3 sm:space-y-0">
    <div className="min-w-0 space-y-3">
      <SavedPayoutAccountDetails account={account} index={index} />
      <AccountNumberReveal masked="" payoutKind={account.payoutKind} revealKey={`${companyId}:${account.id}`} canReveal last4={account.accountLast4}
        onReveal={async () => (await revealMySavedPayoutAccount(companyId, account.id)).accountNumber} />
    </div>
    {/* Row actions are never the main button; the one that deletes is said in red and comes first. */}
    <ActionGroup>
      <button type="button" className={dangerClass} disabled={busy} aria-busy={working === 'remove'} onClick={onRemove}>ลบบัญชี</button>
      {account.holderType === 'SELF' && <button type="button" className={ghostClass} disabled={busy} aria-busy={working === 'default'} onClick={onMakeDefault}>{W.makeDefault}</button>}
    </ActionGroup>
  </div>;
}
