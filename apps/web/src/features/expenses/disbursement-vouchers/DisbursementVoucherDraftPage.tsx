'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DISBURSEMENT_VOUCHER_ERROR_WORDS, DISBURSEMENT_VOUCHER_WORDS, EXPENSE_PAYMENT_METHODS, type ExpensePaymentMethod } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { SelectField, TextareaField, TextField } from '@/common/components/field';
import { CoverLoader, EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { ThemedSteps } from '@/common/components/steps/ThemedSteps';
import { useToast } from '@/common/components/toast';
import { useUnsavedNavigation } from '@/common/components/unsaved-navigation/use-unsaved-navigation';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { MoneyRow } from '../ExpensesPages';
import { PAYMENT_METHOD_LABELS } from '../expenses.model';
import { baht, btnClass, ghostClass, inputClass } from '../ExpensesUi';
import { createDisbursementVoucherDraft, getDisbursementVoucher, listDisbursementPayableExpenses, updateDisbursementVoucherDraft } from './disbursement-vouchers.api';
import { canPrepareDisbursementVoucher, disbursementSummaryPartial, disbursementVoucherSummary, disbursementSameAmount } from './disbursement-vouchers.logic';
import { amountError, cleanAmountInput, initialAmount, lockOtherBranchRows, nextDraftCommand, payeeRule, selectionAllowed, selectedTotal } from './disbursement-voucher-form.logic';
import type { CreateDisbursementVoucherDraftInput, DisbursementPayableExpense, DisbursementPayee, DisbursementVoucherDetail, DisbursementDialogKind } from './disbursement-vouchers.model';
import { DisbursementVoucherAccountFields } from './DisbursementVoucherAccountFields';
import { disbursementAccountBody, disbursementAccountError, emptyDisbursementAccount, initialDisbursementAccount, type DisbursementPayeeAccountFields } from './disbursement-voucher-account.logic';
import { DisbursementVoucherPayeePicker } from './DisbursementVoucherPayeePicker';
import { DisbursementVoucherExpenseRows, DisbursementVoucherOtherExpenses } from './DisbursementVoucherExpensePicker';
import styles from './disbursement-voucher-form.module.css';
import { disbursementVoucherSteps } from './disbursement-voucher-journey.logic';
import { DisbursementVoucherCommandDialog } from './DisbursementVoucherCommandDialog';

type Fields = DisbursementPayeeAccountFields & { payeeName: string; plannedPayDate: string; plannedMethod: ExpensePaymentMethod | ''; note: string; payeeConfirmed: boolean };
const emptyFields: Fields = { ...emptyDisbursementAccount, payeeName: '', plannedPayDate: '', plannedMethod: '', note: '', payeeConfirmed: false };

export function DisbursementVoucherDraftPage({ companyId, permissions, entryOpen, draftId, expenseId, viewerUserId }: {
  companyId: string; permissions: string[]; entryOpen: boolean; draftId?: string; expenseId?: string; viewerUserId?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const canPrepare = canPrepareDisbursementVoucher(permissions);
  const listHref = `/companies/${companyId}/expenses/disbursement-vouchers`;
  const [payeeSearch, setPayeeSearch] = useState('');
  const [step, setStep] = useState(0);
  const [payee, setPayee] = useState<Pick<DisbursementPayee, 'payeeKey' | 'displayName'> | null>(null);
  const [rows, setRows] = useState<DisbursementPayableExpense[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [bootLoading, setBootLoading] = useState(Boolean(draftId || expenseId));
  const [bootError, setBootError] = useState<unknown>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<unknown>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [forceConfirmation, setForceConfirmation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [sendDetail, setSendDetail] = useState<DisbursementVoucherDetail | null>(null);
  const [sendKind, setSendKind] = useState<DisbursementDialogKind | null>(null);
  const loadedContext = useRef<string | null>(null);
  const command = useRef<string | null>(null);
  const saveLock = useRef(false);
  const sourceLock = useRef(false);
  const savedDraftId = useRef<string | null>(draftId ?? null);
  // Sending a new document saves it first and reloads it under its own address; the person stays on the step they were on.
  const keepStepOnReload = useRef(false);

  const selectedRows = rows.filter(row => amounts[row.expenseId] !== undefined);
  const total = selectedTotal(Object.values(amounts));
  const rule = forceConfirmation ? 'confirm' : payeeRule(selectedRows);
  const validSelection = selectedRows.length > 0 && selectedRows.length <= 20 && selectedRows.length === Object.keys(amounts).length
    && selectedRows.every(row => row.selectable && !amountError(amounts[row.expenseId]!, row.outstandingAmount))
    && (rule !== 'confirm' || fields.payeeConfirmed);
  const canSave = canPrepare && (entryOpen || Boolean(draftId)) && validSelection && Boolean(fields.payeeName.trim()) && !disbursementAccountError(fields) && !stale && !bootLoading && !sourceLoading;
  const summary = disbursementVoucherSummary({ header: { totalAmount: total }, lines: selectedRows });
  // One document holds one branch (the server refuses a mix at save): say so on the row, before the details step.
  const lockedBranch = selectedRows.find(row => row.branchId)?.branchId ?? null;
  const shown = lockOtherBranchRows(rows, amounts, lockedBranch);
  // A greyed primary button always has its reason beside it.
  const blockReason = saving || sourceLoading || bootLoading ? null
    : step === 0 ? payee ? null : 'expenses.disbursement.need_payee'
    : step === 1 ? selectedRows.length === 0 ? 'expenses.disbursement.need_selection'
      : selectedRows.some(row => amountError(amounts[row.expenseId]!, row.outstandingAmount)) ? 'expenses.disbursement.need_amount'
      : rule === 'confirm' && !fields.payeeConfirmed ? 'expenses.disbursement.need_confirm' : null
    : !fields.payeeName.trim() ? 'expenses.disbursement.need_payee_name' : disbursementAccountError(fields) ? 'expenses.disbursement.need_account' : null;

  const changed = () => {
    command.current = nextDraftCommand(command.current, true, () => crypto.randomUUID());
    setDirty(true); setSaveError(null); setSelectionError(null);
  };
  const changeFields = (patch: Partial<Fields>) => { changed(); setFields(previous => ({ ...previous, ...patch })); };

  useEffect(() => {
    if (!canPrepare || !entryOpen && !draftId) return;
    const context = JSON.stringify([companyId, draftId, expenseId, reload]);
    if (loadedContext.current === context) return;
    let active = true;
    setBootError(null); setBlocked(null);
    if (!draftId && !expenseId) {
      setStep(0); setPayee(null); setRows([]); setAmounts({}); setFields(emptyFields); setDirty(false);
      setStale(false); command.current = null; loadedContext.current = context; setBootLoading(false); return;
    }
    setBootLoading(true);
    void (async () => {
      const detail = draftId ? await getDisbursementVoucher(companyId, draftId) : null;
      if (!active) return;
      if (detail && (detail.header.status !== 'DRAFT' || !detail.actions.edit)) {
        setBlocked(!entryOpen ? t('expenses.disbursement.hidden', 'th') : DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_not_draft); return;
      }
      const available = await listDisbursementPayableExpenses(companyId, {});
      if (!active) return;
      const entry = expenseId ? available.find(row => row.expenseId === expenseId) : null;
      if (!detail && !entry) { setBlocked(DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_expense_unreadable); return; }
      const chosen = detail ? detail.lines.map(line => available.find(row => row.expenseId === line.expenseId) ?? unavailableSource(line)) : [entry!];
      const first = chosen[0]!;
      const key = first.payeeKey;
      const group = available.filter(row => row.payeeKey === key);
      setRows([...group, ...chosen.filter(row => !group.some(item => item.expenseId === row.expenseId))]);
      setPayee({ payeeKey: key, displayName: detail?.header.payeeName ?? entry!.vendorName ?? DISBURSEMENT_VOUCHER_WORDS.unnamedPayee });
      setAmounts(detail ? Object.fromEntries(detail.lines.map(line => [line.expenseId, initialAmount(line.amount)]))
        : entry!.selectable ? { [entry!.expenseId]: initialAmount(entry!.outstandingAmount) } : {});
      setFields(detail ? { ...initialDisbursementAccount(detail.header), payeeName: detail.header.payeeName, plannedPayDate: detail.header.plannedPayDate ?? '',
        plannedMethod: detail.header.plannedMethod ?? '', note: detail.header.note ?? '', payeeConfirmed: detail.header.payeeBasis === 'PREPARER_CONFIRMED' }
        : { ...emptyFields, payeeName: entry!.vendorName ?? DISBURSEMENT_VOUCHER_WORDS.unnamedPayee });
      setVersion(detail?.header.version ?? 0); if (!keepStepOnReload.current) setStep(1); keepStepOnReload.current = false; setDirty(Boolean(!detail));
      setStale(false); setSaveError(null); setForceConfirmation(false); command.current = null; loadedContext.current = context;
    })().catch(failure => { if (active) setBootError(failure); }).finally(() => { if (active) setBootLoading(false); });
    return () => { active = false; };
  }, [companyId, draftId, expenseId, canPrepare, entryOpen, reload]);

  const choosePayee = async (chosen: Pick<DisbursementPayee, 'payeeKey' | 'displayName'>) => {
    if (sourceLock.current) return;
    if (chosen.payeeKey === payee?.payeeKey && !sourceError) { setStep(1); return; }
    sourceLock.current = true; setSourceLoading(true); setSourceError(null);
    changed(); setPayee(chosen); setRows([]); setAmounts({});
    setFields(previous => ({ ...previous, payeeName: chosen.displayName, payeeConfirmed: false })); setForceConfirmation(false);
    try {
      const available = await listDisbursementPayableExpenses(companyId, { payeeKey: chosen.payeeKey });
      setRows(available);
      if (available.length === 1 && available[0]!.selectable) setAmounts({ [available[0]!.expenseId]: initialAmount(available[0]!.outstandingAmount) });
      setStep(1);
    } catch (failure) { setSourceError(failure); }
    finally { sourceLock.current = false; setSourceLoading(false); }
  };
  const toggle = (row: DisbursementPayableExpense) => {
    if (!row.selectable || saving) return;
    if (amounts[row.expenseId] === undefined && !selectionAllowed(Object.keys(amounts).length)) {
      setSelectionError(DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_too_many_lines); return;
    }
    if (amounts[row.expenseId] === undefined && lockedBranch && row.branchId && row.branchId !== lockedBranch) {
      setSelectionError(t('expenses.disbursement.other_branch', 'th')); return;
    }
    changed(); setForceConfirmation(false);
    setFields(previous => ({ ...previous, payeeConfirmed: false }));
    setRows(previous => previous.some(item => item.expenseId === row.expenseId) ? previous : [...previous, row]);
    setAmounts(previous => {
      const next = { ...previous };
      if (next[row.expenseId] !== undefined) delete next[row.expenseId]; else next[row.expenseId] = initialAmount(row.outstandingAmount);
      return next;
    });
  };
  async function save(navigate = true, showSavedToast = true): Promise<boolean> {
    if (!canSave || saveLock.current) return false;
    saveLock.current = true; setSaving(true); setSaveError(null);
    command.current = nextDraftCommand(command.current, false, () => crypto.randomUUID());
    const input: CreateDisbursementVoucherDraftInput = {
      commandId: command.current, lines: selectedRows.map(row => ({ expenseId: row.expenseId, amount: amounts[row.expenseId]! })),
      payeeName: fields.payeeName.trim(), payeeConfirmed: fields.payeeConfirmed, ...disbursementAccountBody(fields),
      ...(fields.plannedPayDate ? { plannedPayDate: fields.plannedPayDate } : {}),
      ...(fields.plannedMethod ? { plannedMethod: fields.plannedMethod } : {}), ...(fields.note ? { note: fields.note } : {}),
    };
    try {
      const header = draftId ? await updateDisbursementVoucherDraft(companyId, draftId, { ...input, expectedVersion: version })
        : await createDisbursementVoucherDraft(companyId, input);
      savedDraftId.current = header.id;
      setDirty(false); setVersion(header.version); if (showSavedToast) toast.success(t('expenses.disbursement.saved_draft', 'th'));
      if (navigate) { navigation.allowNavigation(); router.push(`${listHref}/${encodeURIComponent(header.id)}`); }
      return true;
    } catch (failure) {
      setSaveError(apiErrorMessage(failure));
      if (apiErrorCode(failure) === 'disbursement_version_conflict') setStale(true);
      if (apiErrorCode(failure) === 'disbursement_payee_confirmation_required') { setForceConfirmation(true); setStep(1); }
      return false;
    } finally { saveLock.current = false; setSaving(false); }
  }
  const sendAfterSave = async () => {
    if (!await save(false, false) || !savedDraftId.current) return;
    const savedId = savedDraftId.current;
    keepStepOnReload.current = savedId !== draftId;
    router.replace(`${listHref}/new?draft=${encodeURIComponent(savedId)}`);
    try {
      const detail = await getDisbursementVoucher(companyId, savedId);
      setSendDetail(detail);
      setSendKind(detail.actions.submitAndApprove ? 'selfApprove' : 'submit');
    } catch (failure) { setSaveError(apiErrorMessage(failure)); }
  };
  const navigation = useUnsavedNavigation({ dirty, canSave, saving, error: saveError, onSave: () => save(false), description: draftId ? t('expenses.disbursement.leave_edit', 'th') : undefined, title: draftId ? t('expenses.disbursement.leave_edit_title', 'th') : undefined });
  const back = <Link href={listHref} className={ghostClass}>{t('expenses.disbursement.back_list', 'th')}</Link>;
  if (!canPrepare) return <><ForbiddenState />{navigation.dialog}</>;
  if (!entryOpen && !draftId || blocked === t('expenses.disbursement.hidden', 'th')) return <MangmeePage title={DISBURSEMENT_VOUCHER_WORDS.title}>
    <MangmeeCard className={styles.section}><EmptyState title={t('expenses.disbursement.hidden', 'th')} description={t('expenses.disbursement.hidden_help', 'th')}
      action={<Link href={`/companies/${companyId}/expenses`} className={ghostClass}>{t('expenses.disbursement.back_expenses', 'th')}</Link>} /></MangmeeCard>
    {navigation.dialog}
  </MangmeePage>;
  if (bootLoading || bootError || blocked) return <MangmeePage title={t(draftId ? 'expenses.disbursement.edit_title' : 'expenses.disbursement.create', 'th')} eyebrow={back}>
    {bootLoading ? <LoadingState label={t('expenses.disbursement.loading_document', 'th')} />
      : blocked ? <EmptyState title={blocked} description="" action={back} />
        : (bootError as { status?: number })?.status === 403 ? <ForbiddenState />
          : (bootError as { status?: number })?.status === 404 ? <EmptyState title={DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_not_found} description="" action={back} />
            : <ErrorState description={apiErrorMessage(bootError)} onRetry={() => setReload(value => value + 1)} />}
    {navigation.dialog}
  </MangmeePage>;

  return <MangmeePage title={t(draftId ? 'expenses.disbursement.edit_title' : 'expenses.disbursement.create', 'th')} eyebrow={back} className={styles.page}>
    <div className="relative">
      <fieldset disabled={saving || sourceLoading} className={styles.form}>
        <ThemedSteps steps={disbursementVoucherSteps('DRAFT')} />
        <p className={styles.hint}>{t('expenses.disbursement.create_progress', 'th').replace('{n}', String(step + 1)).replace('{step}', t(`expenses.disbursement.step_${(['who', 'what', 'details'] as const)[step]}`, 'th'))}</p>
        {step > 0 && <button type="button" className={ghostClass} onClick={() => setStep(previous => previous - 1)}>{t('common.back', 'th')}</button>}
        <MangmeeCard className={cx(styles.section, styles.stack)}>
          <div hidden={step !== 0}>
            <h2>{t('expenses.disbursement.who', 'th')}</h2>
            <DisbursementVoucherPayeePicker search={payeeSearch} onSearch={setPayeeSearch} companyId={companyId} selectedKey={payee?.payeeKey} onChoose={chosen => void choosePayee(chosen)} visible={step === 0} />
            {payee && <p>{payee.displayName}</p>}
          </div>
          {step === 0 ? null : step === 1 ? <>
            <h2>{t('expenses.disbursement.choose_lines', 'th').replace('{payee}', payee?.displayName ?? '')}</h2>
            {rows.length === 0 && <EmptyState title={t('expenses.disbursement.empty_payees', 'th')} description={t('expenses.disbursement.empty_payees_help', 'th')} />}
            <DisbursementVoucherExpenseRows {...shown} amounts={amounts} onToggle={toggle} disabled={saving} branchId={lockedBranch} payeeName={payee?.displayName}
              onAmount={(id, value) => { changed(); setAmounts(previous => ({ ...previous, [id]: cleanAmountInput(value) })); }} />
            <button type="button" className={ghostClass} onClick={() => setOtherOpen(true)}>{t('expenses.disbursement.add_other', 'th')}</button>
            {rule === 'warning' && <p className={styles.warning}>{t('expenses.disbursement.same_name_warning', 'th')}</p>}
            {rule === 'confirm' && <label className={styles.tickRow}>
              <input type="checkbox" checked={fields.payeeConfirmed} onChange={event => changeFields({ payeeConfirmed: event.target.checked })} />
              <span>{t('expenses.disbursement.confirm_payee', 'th')}</span>
            </label>}
          </> : <>
            <h2>{t('expenses.disbursement.step_details', 'th')}</h2>
            <div className={styles.fieldGrid}>
            <TextField label={t('expenses.disbursement.payee_name', 'th')} value={fields.payeeName} required onChange={event => changeFields({ payeeName: event.target.value })} />
            <div className="space-y-1.5">
              <label htmlFor="disbursement-planned-date" className="text-sm font-medium text-gray-700">{t('expenses.disbursement.planned_date', 'th')}</label>
              <ThemedDate id="disbursement-planned-date" name="plannedPayDate" className={inputClass} allowClear value={fields.plannedPayDate}
                aria-describedby="disbursement-planned-date-hint" onChange={event => changeFields({ plannedPayDate: event.target.value })} />
              <p id="disbursement-planned-date-hint" className="text-xs text-gray-500">{t('expenses.disbursement.planned_hint', 'th')}</p>
            </div>
            <SelectField label={t('expenses.disbursement.planned_method', 'th')} value={fields.plannedMethod} onChange={event => changeFields({ plannedMethod: event.target.value as Fields['plannedMethod'] })}>
              <option value="">{t('expenses.disbursement.planned_method_unspecified', 'th')}</option>{EXPENSE_PAYMENT_METHODS.map(method => <option key={method} value={method}>{PAYMENT_METHOD_LABELS[method]}</option>)}
            </SelectField>
            </div>
            <DisbursementVoucherAccountFields value={fields} onChange={changeFields} />
            <TextareaField label={t('expenses.disbursement.note', 'th')} value={fields.note} onChange={event => changeFields({ note: event.target.value })} />
            {!disbursementSameAmount(summary.gross, summary.payout) && <div><MoneyRow label={t('expenses.disbursement.gross', 'th')} value={summary.gross} />
              <MoneyRow label={t('expenses.disbursement.wht', 'th')} value={summary.withholding} />
              <MoneyRow label={t('expenses.disbursement.net', 'th')} value={summary.payout} />
              {disbursementSummaryPartial(summary) && <p className={styles.hint}>{t('expenses.disbursement.partial_note', 'th')}</p>}</div>}
          </>}
          {sourceError !== null && <ErrorState description={apiErrorMessage(sourceError)} onRetry={() => { if (payee) void choosePayee(payee); }} />}
        </MangmeeCard>
      </fieldset>
      <CoverLoader active={saving || sourceLoading} scope="section" label={t(saving ? 'expenses.disbursement.saving_draft' : 'expenses.disbursement.loading_sources', 'th')} />
    </div>
    <div className={styles.bottomBar} data-testid="disbursement-draft-bottom-bar">
      <div className={styles.barInner}>
        <p>{t('expenses.disbursement.selection_total', 'th').replace('{n}', String(Object.keys(amounts).length)).replace('{amount}', baht(total))}</p>
        {(saveError || selectionError) && <p role="alert" className={styles.error}>{saveError ?? selectionError}</p>}
        {blockReason && !saveError && !selectionError && <p className={styles.hint}>{t(blockReason, 'th')}</p>}
        {stale && <button type="button" className={ghostClass} disabled={saving} onClick={() => setReload(value => value + 1)}>{t('expenses.disbursement.reload_draft', 'th')}</button>}
        {step === 2 && <button type="button" className={ghostClass} disabled={saving || !canSave} aria-busy={saving} onClick={() => void save()}>{t('expenses.disbursement.save_draft', 'th')}</button>}
        <button type="button" className={cx(btnClass, styles.primary)} disabled={saving || sourceLoading || (step === 0 ? !payee || Boolean(sourceError) : step === 1 ? !validSelection : !canSave)} aria-busy={saving}
          onClick={() => { if (step < 2) setStep(previous => previous + 1); else void sendAfterSave(); }}>
          {t(step === 2 ? permissions.includes('expense.disbursement.approve') ? 'expenses.disbursement.self_approve' : 'expenses.disbursement.send_to_approver' : 'expenses.disbursement.next', 'th')}
        </button>
      </div>
    </div>
    {otherOpen && <DisbursementVoucherOtherExpenses companyId={companyId} amounts={amounts} onToggle={toggle} onClose={() => { setOtherOpen(false); setSelectionError(null); }} error={selectionError} branchId={lockedBranch} payeeName={payee?.displayName} />}
    {sendDetail && sendKind && <DisbursementVoucherCommandDialog companyId={companyId} detail={sendDetail} kind={sendKind} viewerUserId={viewerUserId}
      onClose={() => { setSendDetail(null); setSendKind(null); }} onSuccess={() => router.push(`${listHref}/${encodeURIComponent(sendDetail.header.id)}`)}
      onReload={async () => { const detail = await getDisbursementVoucher(companyId, sendDetail.header.id); setSendDetail(detail); }}
      onDeleted={() => router.push(listHref)} />}
    {navigation.dialog}
  </MangmeePage>;
}

function unavailableSource(line: DisbursementVoucherDetail['lines'][number]): DisbursementPayableExpense {
  return { ...line, description: null, vendorInvoiceNumber: null, branchName: null, payeeKey: '', payeeKeyKind: null, selectable: false, reasonCode: null, reservation: null };
}
