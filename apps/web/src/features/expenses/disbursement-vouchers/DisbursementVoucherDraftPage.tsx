'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DISBURSEMENT_VOUCHER_ERROR_WORDS, DISBURSEMENT_VOUCHER_WORDS, E_WHT_WORDS, eWhtPaymentMethodAllowed, EXPENSE_PAYMENT_METHODS, type ExpensePaymentMethod } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeePage, MetricGrid, cx } from '@/common/components/mangmee';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { SelectField, TextareaField, TextField } from '@/common/components/field';
import { CoverLoader, EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { ThemedSteps } from '@/common/components/steps/ThemedSteps';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { Modal } from '@/common/components/modal';
import { focusExpenseField } from '../expense-focus.logic';
import { useDisbursementSendKind } from './use-disbursement-send-kind';
import { useToast } from '@/common/components/toast';
import { useUnsavedNavigation } from '@/common/components/unsaved-navigation/use-unsaved-navigation';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { PAYMENT_METHOD_LABELS } from '../expenses.model';
import { amountText, btnClass, ghostClass, inputClass } from '../ExpensesUi';
import { createDisbursementVoucherDraft, getDisbursementPayeeAccount, getDisbursementVoucher, listDisbursementPayableExpenses, updateDisbursementVoucherDraft } from './disbursement-vouchers.api';
import { canPrepareDisbursementVoucher, disbursementSummaryPartial, disbursementVoucherSummary } from './disbursement-vouchers.logic';
import { skipSingleExpenseSelection, amountError, cleanAmountInput, initialAmount, lockOtherBranchRows, nextDraftCommand, payeeRule, selectionAllowed, selectedTotal } from './disbursement-voucher-form.logic';
import type { CreateDisbursementVoucherDraftInput, DisbursementPayableExpense, DisbursementPayee, DisbursementVoucherDetail, DisbursementDialogKind } from './disbursement-vouchers.model';
import { DisbursementVoucherSupportingFiles } from './DisbursementVoucherSupportingFiles';
import { DisbursementVoucherAccountFields } from './DisbursementVoucherAccountFields';
import { disbursementAccountBody, disbursementAccountError, emptyDisbursementAccount, initialDisbursementAccount, type DisbursementPayeeAccountFields } from './disbursement-voucher-account.logic';
import { DisbursementVoucherPayeePicker } from './DisbursementVoucherPayeePicker';
import { DisbursementVoucherExpenseRows, DisbursementVoucherOtherExpenses } from './DisbursementVoucherExpensePicker';
import styles from './disbursement-voucher-form.module.css';
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
  const [draftNumber, setDraftNumber] = useState<string | null>(null);
  const [pendingPayee, setPendingPayee] = useState<Pick<DisbursementPayee, 'payeeKey' | 'displayName'> | null>(null);
  const [fieldError, setFieldError] = useState<{ id: string; message: string } | null>(null);
  const [accountError, setAccountError] = useState<unknown>(null);
  const [accountRetry, setAccountRetry] = useState(0);
  const [accountLoading, setAccountLoading] = useState(false);
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
  /** Expense numbers a reopened draft held that can no longer be paid: dropped from the list, saved away with the next save. */
  const [droppedLines, setDroppedLines] = useState<string[]>([]);
  const loadedContext = useRef<string | null>(null);
  const command = useRef<string | null>(null);
  const saveLock = useRef(false);
  const waitingSave = useRef<{ navigate: boolean; showSavedToast: boolean; resolve: (saved: boolean) => void } | null>(null);
  const sourceLock = useRef(false);
  const savedDraftId = useRef<string | null>(draftId ?? null);
  // Sending a new document saves it first and reloads it under its own address; the person stays on the step they were on.
  const keepStepOnReload = useRef(false);

  const selectedRows = rows.filter(row => amounts[row.expenseId] !== undefined);
  const eWht = selectedRows.some(row => row.whtRemittance === 'E_WHT');
  const total = selectedTotal(Object.values(amounts));
  const rule = forceConfirmation ? 'confirm' : payeeRule(selectedRows);
  const validSelection = selectedRows.length > 0 && selectedRows.length <= 20 && selectedRows.length === Object.keys(amounts).length
    && selectedRows.every(row => row.selectable && !amountError(amounts[row.expenseId]!, row.outstandingAmount))
    && (rule !== 'confirm' || fields.payeeConfirmed);
  const canSave = canPrepare && entryOpen && validSelection && Boolean(fields.payeeName.trim()) && (!['', 'BANK_TRANSFER'].includes(fields.plannedMethod) || !disbursementAccountError(fields)) && !stale && !bootLoading && !sourceLoading;
  const summary = disbursementVoucherSummary({ header: { totalAmount: total }, lines: selectedRows });
  // One document holds one branch (the server refuses a mix at save): say so on the row, before the details step.
  const lockedBranch = selectedRows.find(row => row.branchId)?.branchId ?? null;
  const sendChoice = useDisbursementSendKind(companyId, lockedBranch, permissions.includes('expense.disbursement.approve'), viewerUserId);
  const shown = lockOtherBranchRows(rows, amounts, lockedBranch);

  const changed = () => {
    command.current = nextDraftCommand(command.current, true, () => crypto.randomUUID());
    setDirty(true); setSaveError(null); setSelectionError(null); setFieldError(null);
  };
  const changeFields = (patch: Partial<Fields>) => { changed(); setFields(previous => ({ ...previous, ...patch })); };
  useEffect(() => {
    if (eWht && !eWhtPaymentMethodAllowed(fields.plannedMethod)) changeFields({ plannedMethod: 'BANK_TRANSFER' });
  }, [eWht, fields.plannedMethod]);

  useEffect(() => {
    if (!canPrepare || !entryOpen) return;
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
        setBlocked(DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_not_draft); return;
      }
      const available = await listDisbursementPayableExpenses(companyId, {});
      if (!active) return;
      const entry = expenseId ? available.find(row => row.expenseId === expenseId) : null;
      if (!detail && !entry) { setBlocked(DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_expense_unreadable); return; }
      // A saved line that can no longer be paid (paid elsewhere, cancelled, out of reach) is not offered again.
      const kept = detail ? detail.lines.filter(line => available.some(row => row.expenseId === line.expenseId && row.selectable)) : [];
      const dropped = detail ? detail.lines.filter(line => !kept.includes(line)) : [];
      const chosen = detail ? kept.map(line => available.find(row => row.expenseId === line.expenseId)!) : [entry!];
      const first = chosen[0];
      const group = first ? available.filter(row => row.payeeKey === first.payeeKey && row.selectable) : [];
      setDroppedLines(dropped.map(line => line.expenseNumber ?? line.expenseId));
      setRows([...group, ...chosen.filter(row => !group.some(item => item.expenseId === row.expenseId))]);
      setPayee(first ? { payeeKey: first.payeeKey, displayName: detail?.header.payeeName ?? entry!.vendorName ?? DISBURSEMENT_VOUCHER_WORDS.unnamedPayee } : null);
      setAmounts(detail ? Object.fromEntries(kept.map(line => [line.expenseId, initialAmount(line.amount)]))
        : entry!.selectable ? { [entry!.expenseId]: initialAmount(entry!.outstandingAmount) } : {});
      setFields(detail ? { ...initialDisbursementAccount(detail.header), payeeName: detail.header.payeeName, plannedPayDate: detail.header.plannedPayDate ?? '',
        plannedMethod: detail.header.plannedMethod ?? '', note: detail.header.note ?? '', payeeConfirmed: detail.header.payeeBasis === 'PREPARER_CONFIRMED' }
        : { ...emptyFields, payeeName: entry!.vendorName ?? DISBURSEMENT_VOUCHER_WORDS.unnamedPayee });
      setDraftNumber(detail?.header.documentNumber ?? null);
      setVersion(detail?.header.version ?? 0); if (!keepStepOnReload.current) setStep(!detail && skipSingleExpenseSelection(entry, group) ? 2 : first ? 1 : 0); keepStepOnReload.current = false; setDirty(Boolean(!detail) || dropped.length > 0);
      setStale(false); setSaveError(null); setForceConfirmation(false); command.current = null; loadedContext.current = context;
    })().catch(failure => { if (active) setBootError(failure); }).finally(() => { if (active) setBootLoading(false); });
    return () => { active = false; };
  }, [companyId, draftId, expenseId, canPrepare, entryOpen, reload]);

  const choosePayee = async (chosen: Pick<DisbursementPayee, 'payeeKey' | 'displayName'>) => {
    if (sourceLock.current) return;
    if (chosen.payeeKey === payee?.payeeKey && !sourceError) { setStep(1); return; }
    sourceLock.current = true; setSourceLoading(true); setSourceError(null);
    changed(); setPayee(chosen); setRows([]); setAmounts({});
    setFields(previous => ({ ...previous, ...emptyDisbursementAccount, payeeAccountFromVoucherId: undefined, payeeName: chosen.displayName, payeeConfirmed: false })); setForceConfirmation(false);
    try {
      // Owner 2026-10-15: a bill that cannot be paid (in another sheet, in a claim, …) is not listed.
      const available = (await listDisbursementPayableExpenses(companyId, { payeeKey: chosen.payeeKey })).filter(row => row.selectable);
      setRows(available);
      if (available.length === 1 && available[0]!.selectable) setAmounts({ [available[0]!.expenseId]: initialAmount(available[0]!.outstandingAmount) });
      setStep(1);
    } catch (failure) { setSourceError(failure); }
    finally { sourceLock.current = false; setSourceLoading(false); }
  };
  const requestPayee = (chosen: Pick<DisbursementPayee, 'payeeKey' | 'displayName'>) => {
    if (payee && chosen.payeeKey !== payee.payeeKey && Object.keys(amounts).length) setPendingPayee(chosen);
    else void choosePayee(chosen);
  };
  useEffect(() => {
    if (!payee || fields.payeeAccountLast4 || fields.payeeAccountNumber || fields.payeeAccountCleared || fields.payeeBankName || fields.payeeAccountName) {
      setAccountLoading(false); setAccountError(null); return;
    }
    let active = true;
    setAccountLoading(true); setAccountError(null);
    void getDisbursementPayeeAccount(companyId, payee.payeeKey, lockedBranch ?? undefined).then(account => {
      if (active && account) setFields(previous => previous.payeeAccountCleared || previous.payeeAccountNumber || previous.payeeAccountLast4 || previous.payeeBankName || previous.payeeAccountName ? previous : {
        ...previous, payeeBankName: account.bankName ?? '', payeeAccountName: account.accountName ?? '',
        payeeAccountLast4: account.last4, payeeAccountFromVoucherId: account.sourceVoucherId,
      });
    }).catch(error => { if (active) setAccountError(error); }).finally(() => { if (active) setAccountLoading(false); });
    return () => { active = false; };
  }, [companyId, payee?.payeeKey, lockedBranch, accountRetry]);
  const focusMissing = (nextStep: number, id: string, message: string) => {
    setStep(nextStep); setFieldError({ id, message });
    requestAnimationFrame(() => focusExpenseField(document.getElementById(id)));
    return false;
  };
  const validateSelection = () => {
    if (!selectedRows.length) return focusMissing(1, 'disbursement-expenses', 'เลือกอย่างน้อย 1 รายการ');
    const invalid = selectedRows.find(row => !row.selectable || amountError(amounts[row.expenseId]!, row.outstandingAmount));
    if (invalid) return focusMissing(1, invalid.selectable ? `amount-${invalid.expenseId}` : 'disbursement-expenses',
      invalid.selectable ? amountError(amounts[invalid.expenseId]!, invalid.outstandingAmount)! : 'รายการที่เลือกจ่ายไม่ได้ เลือกรายการใหม่');
    if (rule === 'confirm' && !fields.payeeConfirmed) { setStep(1); setOtherOpen(true); return false; }
    return true;
  };
  const toggleAll = (checked: boolean) => {
    changed(); setForceConfirmation(false); if (!checked) setFields(previous => ({ ...previous, payeeConfirmed: false }));
    const available = shown.rows.filter(row => row.selectable);
    const branch = lockedBranch ?? available[0]?.branchId;
    const choices = available.filter(row => row.branchId === branch);
    if (checked && choices.length > 20) { setSelectionError(DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_too_many_lines); return; }
    setAmounts(previous => { const next = { ...previous }; for (const row of choices) {
      if (checked) next[row.expenseId] ??= initialAmount(row.outstandingAmount); else delete next[row.expenseId];
    } return next; });
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
    setRows(previous => previous.some(item => item.expenseId === row.expenseId) ? previous : [...previous, row]);
    setAmounts(previous => {
      const next = { ...previous };
      if (next[row.expenseId] !== undefined) delete next[row.expenseId]; else next[row.expenseId] = initialAmount(row.outstandingAmount);
      return next;
    });
  };
  const addOther = (added: DisbursementPayableExpense[]) => {
    changed(); setForceConfirmation(false);
    setRows(previous => [...previous, ...added.filter(row => !previous.some(item => item.expenseId === row.expenseId))]);
    setAmounts(previous => ({ ...Object.fromEntries(added.map(row => [row.expenseId, initialAmount(row.outstandingAmount)])), ...previous }));
    setFields(previous => ({ ...previous, payeeConfirmed: true })); setOtherOpen(false);
  };
  const removeOther = (row: DisbursementPayableExpense) => {
    changed(); setForceConfirmation(false);
    setRows(previous => previous.filter(item => item.expenseId !== row.expenseId));
    setAmounts(previous => { const next = { ...previous }; delete next[row.expenseId]; return next; });
    if (!rows.some(item => item.expenseId !== row.expenseId && item.payeeKey !== payee?.payeeKey)) setFields(previous => ({ ...previous, payeeConfirmed: false }));
  };
  async function save(navigate = true, showSavedToast = true): Promise<boolean> {
    if (saveLock.current) return false;
    if (!validateSelection()) return false;
    if (!fields.payeeName.trim()) return focusMissing(2, 'disbursement-payee-name', t('expenses.disbursement.need_payee_name', 'th'));
    if (['', 'BANK_TRANSFER'].includes(fields.plannedMethod) && disbursementAccountError(fields))
      return focusMissing(2, disbursementAccountError(fields) === DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_account_bank_required ? 'disbursement-account-bank' : 'disbursement-account-number', disbursementAccountError(fields)!);
    if (accountLoading && ['', 'BANK_TRANSFER'].includes(fields.plannedMethod)) {
      // The payee's saved account is still being read: the press is kept and the save runs once it arrives.
      waitingSave.current?.resolve(false); setSaving(true);
      return new Promise(resolve => { waitingSave.current = { navigate, showSavedToast, resolve }; });
    }
    if (!canSave) return false;
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
  useEffect(() => {
    const waiting = waitingSave.current;
    if (accountLoading || !waiting) return;
    waitingSave.current = null; setSaving(false);
    void save(waiting.navigate, waiting.showSavedToast).then(waiting.resolve);
  }, [accountLoading]);
  const sendAfterSave = async () => {
    if (!await save(false, false) || !savedDraftId.current) return;
    const savedId = savedDraftId.current;
    keepStepOnReload.current = savedId !== draftId;
    router.replace(`${listHref}/new?draft=${encodeURIComponent(savedId)}`);
    try {
      const detail = await getDisbursementVoucher(companyId, savedId);
      setSendDetail(detail);
      setSendKind(detail.actions.submitAndApprove ? sendChoice : 'submit');
    } catch (failure) { setSaveError(apiErrorMessage(failure)); }
  };
  const navigation = useUnsavedNavigation({ dirty, canSave, saving, error: saveError, onSave: () => save(false), description: draftId ? t('expenses.disbursement.leave_edit', 'th') : undefined, title: draftId ? t('expenses.disbursement.leave_edit_title', 'th') : undefined });
  const back = <Link href={listHref} className="mangmee-btn mangmee-btn-secondary !min-h-9 !py-1.5">กลับไปรายการ</Link>;
  const backAction = <Link href={listHref} className={ghostClass}>{t('expenses.disbursement.back_list', 'th')}</Link>;
  if (!entryOpen && draftId && permissions.includes('expense.disbursement.read')) return <MangmeePage title={t('expenses.disbursement.edit_title', 'th')}>
    <MangmeeCard className={styles.section}><EmptyState title="ปิดการทำใบเตรียมจ่ายแล้ว ร่างนี้ทำต่อไม่ได้" description="" action={backAction} /></MangmeeCard>
    {navigation.dialog}
  </MangmeePage>;
  if (!canPrepare) return <><ForbiddenState titleAs="h1" />{navigation.dialog}</>;
  if (!entryOpen && !draftId) return <MangmeePage title={DISBURSEMENT_VOUCHER_WORDS.title}>
    <MangmeeCard className={styles.section}><EmptyState title={t('expenses.disbursement.hidden', 'th')} description={t('expenses.disbursement.hidden_help', 'th')}
      action={<Link href={`/companies/${companyId}/expenses`} className={ghostClass}>{t('expenses.disbursement.back_expenses', 'th')}</Link>} /></MangmeeCard>
    {navigation.dialog}
  </MangmeePage>;
  if (bootLoading || bootError || blocked) return <MangmeePage title={t(draftId ? 'expenses.disbursement.edit_title' : 'expenses.disbursement.create', 'th')} back={back}>
    {bootLoading ? <LoadingState label={t('expenses.disbursement.loading_document', 'th')} />
      : blocked ? <EmptyState title={blocked} description="" action={backAction} />
        : (bootError as { status?: number })?.status === 403 ? <ForbiddenState />
          : (bootError as { status?: number })?.status === 404 ? <EmptyState title={DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_not_found} description="" action={backAction} />
            : <ErrorState description={apiErrorMessage(bootError)} onRetry={() => setReload(value => value + 1)} />}
    {navigation.dialog}
  </MangmeePage>;

  return <MangmeePage title={draftId ? `แก้ไขใบเตรียมจ่าย ${draftNumber || 'ยังไม่มีเลขที่'}` : t('expenses.disbursement.create', 'th')} description={draftId ? payee?.displayName : undefined} back={back} className={cx('mangmee-flat', styles.page)}>
    <div className="relative">
      <fieldset disabled={saving || sourceLoading} className={styles.form}>
        <ThemedSteps steps={(['who', 'what', 'details'] as const).map((key, index) => ({ key, label: t(`expenses.disbursement.step_${key}`, 'th'), state: index === step ? 'current' : index < step ? 'done' : 'upcoming' }))} />
        <MangmeeCard className={cx(styles.section, styles.stack)}>
          {droppedLines.length > 0 && <p role="status" className={styles.hint}>เอาออก {droppedLines.length} รายการที่จ่ายไม่ได้แล้ว: {droppedLines.join(', ')}</p>}
          <div hidden={step !== 0}>
            <h2>{t('expenses.disbursement.who', 'th')}</h2>
            <DisbursementVoucherPayeePicker search={payeeSearch} onSearch={setPayeeSearch} companyId={companyId} selectedKey={payee?.payeeKey} onChoose={requestPayee} visible={step === 0} />
          </div>
          {step === 0 ? null : step === 1 ? <>
            <h2>{t('expenses.disbursement.choose_lines', 'th').replace('{payee}', payee?.displayName ?? '')}</h2>
            {rows.length === 0 && <EmptyState title={t('expenses.disbursement.empty_payees', 'th')} description={t('expenses.disbursement.empty_payees_help', 'th')} />}
            <div id="disbursement-expenses" tabIndex={-1}>
            {fieldError?.id === 'disbursement-expenses' && <p role="alert" className={styles.error}>{fieldError.message}</p>}
            {selectionError && <p role="alert" className={styles.error}>{selectionError}</p>}
            <DisbursementVoucherExpenseRows companyId={companyId} onSelectAll={toggleAll} otherPayeeKey={payee?.payeeKey} onRemove={removeOther} {...shown} amounts={amounts} onToggle={toggle} disabled={saving} branchId={lockedBranch} payeeName={payee?.displayName}
              onAmount={(id, value) => { changed(); setAmounts(previous => ({ ...previous, [id]: cleanAmountInput(value) })); }} />
            </div>
            <button type="button" className={`${ghostClass} justify-self-start`} onClick={() => setOtherOpen(true)}><span aria-hidden="true">+</span>เพิ่มบิลที่บันทึกไว้คนละชื่อ</button>
            <p className={styles.hint}>{t('expenses.disbursement.add_other_hint', 'th')}</p>
            {rule === 'warning' && <p className={styles.warning}>{t('expenses.disbursement.same_name_warning', 'th')}</p>}
          </> : <>
            <MetricGrid columns={Number(summary.withholding) > 0 ? 3 : 2} items={[
              { key: 'net', label: 'ยอดที่จะจ่าย', value: amountText(summary.payout), unit: 'บาท', dot: 'bg-slate-400' },
              { key: 'gross', label: 'รวมเป็นเงิน', value: amountText(summary.gross), unit: 'บาท', dot: 'bg-slate-400' },
              ...(Number(summary.withholding) > 0 ? [{ key: 'wht', label: 'หัก ณ ที่จ่าย', value: amountText(summary.withholding), unit: 'บาท', dot: 'bg-slate-400' }] : []),
            ]} />
            {disbursementSummaryPartial(summary) && <p className={styles.hint}>{t('expenses.disbursement.partial_note', 'th')}</p>}
            <h2>{t('expenses.disbursement.step_details', 'th')}</h2>
            <div className={styles.fieldGrid}>
            <TextField id="disbursement-payee-name" error={fieldError?.id === 'disbursement-payee-name' ? fieldError.message : undefined} label={t('expenses.disbursement.payee_name', 'th')} value={fields.payeeName} required onChange={event => changeFields({ payeeName: event.target.value })} />
            <div className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
              <label htmlFor="disbursement-planned-date" className="text-sm font-medium text-gray-700">กำหนดจ่าย (ถ้ามี)</label>
              <ThemedDate id="disbursement-planned-date" name="plannedPayDate" className={inputClass} allowClear value={fields.plannedPayDate}
                onChange={event => changeFields({ plannedPayDate: event.target.value })} />
            </div>
            <SelectField label={t('expenses.disbursement.planned_method', 'th')} hint={eWht ? E_WHT_WORDS['W-P1'] : undefined} value={fields.plannedMethod} onChange={event => changeFields({ plannedMethod: event.target.value as Fields['plannedMethod'] })}>
              <option value="">{t('expenses.disbursement.planned_method_unspecified', 'th')}</option>{EXPENSE_PAYMENT_METHODS.filter(method => !eWht || eWhtPaymentMethodAllowed(method)).map(method => <option key={method} value={method}>{PAYMENT_METHOD_LABELS[method]}</option>)}
            </SelectField>
            </div>
            {['', 'BANK_TRANSFER'].includes(fields.plannedMethod) && <div id="disbursement-account">
              {accountLoading && <LoadingState label="กำลังอ่านบัญชีผู้รับเงิน" />}
              {accountError !== null && <ErrorState description={apiErrorMessage(accountError)} onRetry={() => setAccountRetry(n => n + 1)} />}
              <DisbursementVoucherAccountFields key={`${draftId ?? 'new'}:${fields.payeeAccountFromVoucherId ?? 'saved'}`} value={fields} onChange={changeFields} companyId={companyId} voucherId={draftId} permissions={permissions} />
              {fieldError?.id === 'disbursement-account' && <p role="alert" className={styles.error}>{fieldError.message}</p>}
            </div>}
            <TextareaField rows={2} className="!min-h-16" label={t('expenses.disbursement.note', 'th')} value={fields.note} onChange={event => changeFields({ note: event.target.value })} />
            <DisbursementVoucherSupportingFiles companyId={companyId} id={draftId} editable saveDraft={async () => await save(false, false) ? savedDraftId.current : null}
              onDraftSaved={savedId => { keepStepOnReload.current = true; router.replace(`${listHref}/new?draft=${encodeURIComponent(savedId)}`); }} />

          </>}
          {sourceError !== null && <ErrorState description={apiErrorMessage(sourceError)} onRetry={() => { if (payee) void choosePayee(payee); }} />}
        </MangmeeCard>
      </fieldset>
      <CoverLoader active={saving || sourceLoading} scope="section" label={t(saving ? 'expenses.disbursement.saving_draft' : 'expenses.disbursement.loading_sources', 'th')} />
    </div>
    {(step > 0 || draftId || payee && selectedRows.length > 0) && <div className={styles.bottomBar} data-form-action-bar="" data-testid="disbursement-draft-bottom-bar">
      <FormActionBar summary={<>
        {step > 0 && <p>เลือก {Object.keys(amounts).length} รายการ · รวม {amountText(total)} บาท</p>}
        {saveError && <p role="alert" className={styles.error}>{saveError}</p>}
        {stale && <button type="button" className={ghostClass} disabled={saving} aria-busy={saving} onClick={() => setReload(value => value + 1)}>{t('expenses.disbursement.reload_draft', 'th')}</button>}
      </>}>
        <ActionGroup>
        {step > 0 && <button type="button" className={ghostClass} disabled={saving || sourceLoading} aria-busy={saving || sourceLoading} onClick={() => setStep(previous => previous - 1)}>{t('common.back', 'th')}</button>}
        {(draftId || payee && selectedRows.length > 0) && <button type="button" className={ghostClass} disabled={saving || sourceLoading} aria-busy={saving || sourceLoading} onClick={() => void save()}>{t('expenses.disbursement.save_draft', 'th')}</button>}
        {step > 0 && <button type="button" className={btnClass} disabled={saving || sourceLoading} aria-busy={saving || sourceLoading}
          onClick={() => { if (step === 1) { if (validateSelection()) setStep(2); } else void sendAfterSave(); }}>
          {t(step === 2 ? sendChoice === 'selfApprove' ? 'expenses.disbursement.self_approve' : 'expenses.disbursement.submit' : 'expenses.disbursement.next', 'th')}
        </button>}

        </ActionGroup>
      </FormActionBar>
    </div>}
    {pendingPayee && <Modal open title="เปลี่ยนผู้รับเงิน รายการที่เลือกไว้จะถูกล้าง" children={null} onClose={() => setPendingPayee(null)}
      footer={<><button type="button" className={ghostClass} onClick={() => setPendingPayee(null)}>ไม่เปลี่ยน</button>
        <button type="button" className={btnClass} onClick={() => { const chosen = pendingPayee; setPendingPayee(null); void choosePayee(chosen); }}>เปลี่ยน</button></>} />}
    {otherOpen && <DisbursementVoucherOtherExpenses companyId={companyId} amounts={amounts} onAdd={addOther} initialRows={rule === 'confirm' && !fields.payeeConfirmed ? selectedRows : []} onClose={() => { setOtherOpen(false); setSelectionError(null); }} branchId={lockedBranch} payeeName={payee?.displayName}
      excludeIds={rows.map(row => row.expenseId)} />}
    {sendDetail && sendKind && <DisbursementVoucherCommandDialog companyId={companyId} detail={sendDetail} kind={sendKind} viewerUserId={viewerUserId}
      onClose={() => { setSendDetail(null); setSendKind(null); }} onSuccess={() => router.push(`${listHref}/${encodeURIComponent(sendDetail.header.id)}`)}
      onReload={async () => { const detail = await getDisbursementVoucher(companyId, sendDetail.header.id); setSendDetail(detail); }}
      onDeleted={() => router.push(listHref)} />}
    {navigation.dialog}
  </MangmeePage>;
}

