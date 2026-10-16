'use client';

import { useEffect, useRef, useState } from 'react';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { TextareaField, TextField } from '@/common/components/field/Field';
import { ChoiceRow } from '@/common/components/field/ChoiceRow';
import { cx } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { CoverLoader, LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { baht, btnClass, dangerClass, ghostClass } from '../ExpensesUi';
import { approveDisbursementVoucher, cancelDisbursementVoucher, deleteDisbursementVoucherDraft, listDisbursementApprovers, returnDisbursementVoucher, remindDisbursementVoucher, submitDisbursementVoucher, withdrawDisbursementVoucher } from './disbursement-vouchers.api';
import { DISBURSEMENT_DIALOG_TITLES, DISBURSEMENT_DIALOG_LABELS } from './disbursement-vouchers.constants';
import { nextDraftCommand } from './disbursement-voucher-form.logic';
import { DISBURSEMENT_APPROVER_SEARCH_ABOVE, disbursementApproverMatches, disbursementOtherApprovers, disbursementReturnedApprover, disbursementCancellationSentence, disbursementCommandBody, disbursementCommandToast, disbursementReminderLast, initialApprover } from './disbursement-voucher-journey.logic';
import type { DisbursementApprover, DisbursementDialogKind, DisbursementVoucherDetail, DisbursementVoucherHeader } from './disbursement-vouchers.model';
import styles from './disbursement-vouchers.module.css';

const word = (key: string) => t(`expenses.disbursement.${key}` as DictionaryKey, 'th');
const commands = { submit: submitDisbursementVoucher, selfApprove: submitDisbursementVoucher, approve: approveDisbursementVoucher,
  return: returnDisbursementVoucher, withdraw: withdrawDisbursementVoucher, cancel: cancelDisbursementVoucher };

export function DisbursementVoucherCommandDialog({ companyId, detail, kind, viewerUserId, onClose, onReload, onDeleted, onSuccess }: {
  companyId: string; detail: DisbursementVoucherDetail; viewerUserId?: string | null; kind: DisbursementDialogKind; onClose: () => void;
  onReload: () => Promise<void>; onDeleted: () => void; onSuccess?: () => void;
}) {
  const toast = useToast();
  const canSelfApprove = kind === 'submit' && detail.actions.submitAndApprove && Boolean(viewerUserId);
  const choosingApprover = kind === 'submit' || kind === 'remind';
  const lastReminder = kind === 'remind' ? disbursementReminderLast(detail) : null;
  const [people, setPeople] = useState<DisbursementApprover[]>([]);
  const [approver, setApprover] = useState('');
  const [peopleLoading, setPeopleLoading] = useState(choosingApprover);
  const [peopleError, setPeopleError] = useState<unknown>(null);
  const [peopleRetry, setPeopleRetry] = useState(0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmationReady, setConfirmationReady] = useState(false);
  const inFlight = useRef(false);
  const commandId = useRef<string | null>(null);
  const committed = useRef<DisbursementVoucherHeader | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [approverQuery, setApproverQuery] = useState('');
  const version = detail.header.version;
  const preferredApprover = kind === 'submit' ? disbursementReturnedApprover(detail, viewerUserId) ?? detail.header.requestedApproverUserId : detail.header.requestedApproverUserId;
  const cancellationSentence = disbursementCancellationSentence(detail);

  useEffect(() => { commandId.current = null; }, [version]);
  useEffect(() => {
    if (kind !== 'approve') return;
    setConfirmationReady(false);
    const timer = setTimeout(() => setConfirmationReady(true), 600);
    return () => clearTimeout(timer);
  }, [kind]);
  useEffect(() => {
    if (!choosingApprover) return;
    let active = true;
    setPeopleLoading(true); setPeopleError(null);
    void listDisbursementApprovers(companyId, detail.header.branchId)
      .then(data => { if (active) { data = disbursementOtherApprovers(data, viewerUserId); if (canSelfApprove) data = [{ userId: viewerUserId!, displayName: 'ฉันอนุมัติเลย' }, ...data]; setPeople(data); setApprover(canSelfApprove ? viewerUserId! : initialApprover(data, preferredApprover)); commandId.current = null; } })
      .catch(failure => { if (active) setPeopleError(failure); })
      .finally(() => { if (active) setPeopleLoading(false); });
    return () => { active = false; };
  }, [companyId, detail.header.branchId, kind, choosingApprover, preferredApprover, viewerUserId, peopleRetry, canSelfApprove]);

  const dialogHeading = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const frame = requestAnimationFrame(() => {
      const heading = dialogHeading.current;
      const reasonBox = heading?.closest('[role="dialog"]')?.querySelector<HTMLTextAreaElement>('textarea');
      (window.matchMedia('(max-width: 639px), (pointer: coarse)').matches ? heading : reasonBox ?? heading)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [kind]);

  const changeAttempt = () => { commandId.current = null; setError(null); };
  // A long list gets a name search and scrolls inside the dialog; the chosen person always stays in view.
  const manyPeople = people.length > DISBURSEMENT_APPROVER_SEARCH_ABOVE;
  const shownPeople = manyPeople ? disbursementApproverMatches(people, approverQuery, approver) : people;
  const onCancel = () => { if (!inFlight.current) onClose(); };
  const effectiveKind = canSelfApprove && approver === viewerUserId ? 'selfApprove' : kind;
  const canAct = kind === 'selfApprove' || canSelfApprove && approver === viewerUserId ? detail.actions.submitAndApprove : kind === 'remind' ? detail.header.status === 'PENDING_APPROVAL' && detail.actions.remind : detail.actions[kind];
  const ready = canAct && !peopleLoading && !peopleError && (!choosingApprover || people.length > 0 && Boolean(approver));
  const reload = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await onReload(); commandId.current = null; setError(null); onClose(); }
    catch (failure) { setError(failure); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const run = async () => {
    if (inFlight.current || kind === 'approve' && !confirmationReady || !ready && !needsRefresh) return;
    if ((kind === 'return' || kind === 'cancel') && reason.trim().length < 3) {
      setError(new Error(word(kind === 'return' ? 'return_reason_required' : 'cancel_reason_required'))); return;
    }
    inFlight.current = true; setBusy(true); setError(null);
    try {
      if (kind === 'delete') {
        await deleteDisbursementVoucherDraft(companyId, detail.header.id);
        toast.success(word('deleted')); onDeleted(); return;
      }
      commandId.current = nextDraftCommand(commandId.current, false, () => crypto.randomUUID());
      if (!committed.current) committed.current = kind === 'remind'
        ? await remindDisbursementVoucher(companyId, detail.header.id, { commandId: commandId.current, expectedVersion: version, approverUserId: approver })
        : await commands[kind](companyId, detail.header.id, disbursementCommandBody(kind === 'submit' && effectiveKind === 'selfApprove' ? 'selfApprove' : kind, { commandId: commandId.current, expectedVersion: version }, approver, reason));
      // A successful command followed by a failed read is retried as a read, never as another mutation.
      setNeedsRefresh(true);
      await onReload();
      const message = disbursementCommandToast(kind === 'submit' && effectiveKind === 'selfApprove' ? 'selfApprove' : kind, committed.current, viewerUserId, people);
      if (message) toast.success(message);
      onSuccess?.();
      onClose();
    } catch (failure) { setError(failure); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const code = apiErrorCode(error);
  const stale = code === 'disbursement_version_conflict' || code === 'disbursement_status_changed' || code === 'disbursement_not_draft';
  const busyLabel = word(kind === 'delete' ? 'deleting' : 'working');
  // The button that backs out says what backing out means: nothing is cancelled, nothing is deleted, what was typed is dropped, or the window only closes.
  const safeLabel = kind === 'cancel' ? word('cancel_safe') : kind === 'delete' ? word('cancel_delete') : kind === 'return' ? t('common.cancel', 'th') : t('common.close', 'th');
  const showAction = !choosingApprover || !peopleLoading && !peopleError && people.length > 0;

  // A question before a numbered or irreversible step names the thing: the amount and the payee, or the document's number.
  const numbered = { cancel: 'cancel_title_numbered', return: 'return_title_numbered', withdraw: 'withdraw_title_numbered' }[kind as string];
  const title = kind === 'submit' ? 'ให้ใครอนุมัติ' : kind === 'delete' ? 'ลบร่างใบเตรียมจ่ายนี้?' : kind === 'approve' || kind === 'selfApprove' ? word(kind === 'approve' ? 'approve_confirm' : 'self_confirm_title').replace('{total}', baht(detail.header.totalAmount)).replace('{payee}', detail.header.payeeName)
    : numbered && detail.header.documentNumber ? word(numbered).replace('{number}', detail.header.documentNumber) : word(DISBURSEMENT_DIALOG_TITLES[kind]);
  // A typed reason is asked about before ✕ or Escape closes the window.
  return <Modal open title={<span ref={dialogHeading} className={styles.commandHeading} data-expense-dialog-heading role="heading" aria-level={2} tabIndex={-1}>{title}</span>} size="sm" onClose={onCancel} closeOnBackdrop={false} closeLabel={safeLabel} dirty={reason.trim() !== '' && !busy}
    footer={<>
      <button type="button" className={ghostClass} disabled={busy} onClick={onCancel}>{safeLabel}</button>
      {showAction && <button type="button" className={kind === 'cancel' || kind === 'delete' ? dangerClass : btnClass}
        disabled={busy || kind === 'approve' && !confirmationReady || !ready && !needsRefresh || stale} aria-busy={busy} onClick={() => void run()}>
        {busy ? busyLabel : needsRefresh ? word('reload_latest') : kind === 'submit' ? 'ส่งอนุมัติ' : word(DISBURSEMENT_DIALOG_LABELS[kind])}
      </button>}
    </>}>
    <CoverLoader active={busy} scope="modal" label={busyLabel}>
      <div className={cx(styles.stack, 'mangmee-flat')}>
        {choosingApprover && <>
          {peopleLoading ? <LoadingState label={word('loading_sources')} /> : peopleError ? <>
            <p role="alert" className={styles.error}>{apiErrorMessage(peopleError)}</p>
            <button type="button" className={ghostClass} onClick={() => setPeopleRetry(n => n + 1)}>{word('reload_latest')}</button>
          </> : people.length === 0 ? <p>{word('no_approvers')}</p> : <>
            {manyPeople && <TextField type="search" label={word('approver_search')} value={approverQuery} onChange={event => setApproverQuery(event.target.value)} />}
            <fieldset className={manyPeople ? `${styles.approvers} ${styles.approversScroll}` : styles.approvers} disabled={busy || needsRefresh}>
              {shownPeople.length === 0 && <p className={styles.muted}>{word('approver_not_found')}</p>}
              {shownPeople.map(person => <ChoiceRow key={person.userId} name="disbursement-approver" value={person.userId} label={person.displayName}
                checked={approver === person.userId} onChange={() => { changeAttempt(); setApprover(person.userId); }} />)}
            </fieldset>
            {kind === 'submit' && effectiveKind !== 'selfApprove' && <p className={styles.muted}>{word(viewerUserId && approver && approver !== viewerUserId ? 'send_help' : 'send_help_others')}</p>}
          </>}
        </>}
        {lastReminder && <p className={styles.muted}>{lastReminder}</p>}
        {detail.hasOwnSignature && (effectiveKind === 'approve' || effectiveKind === 'selfApprove' || effectiveKind === 'submit' && detail.header.preparedByUserId === viewerUserId) && <p>ลายเซ็นของคุณจะอยู่ในใบนี้</p>}
        {effectiveKind === 'selfApprove' && <p>{word('self_confirm')}</p>}
        {kind === 'withdraw' && <p>{word('withdraw_help')}{detail.header.status === 'APPROVED' && <> {word('withdraw_approved')}</>}</p>}
        {(kind === 'delete' || kind === 'cancel') && <><p>{detail.header.payeeName}</p><p>{baht(detail.header.totalAmount)}</p></>}
        {kind === 'cancel' && cancellationSentence && <p>{cancellationSentence}</p>}
        {(kind === 'return' || kind === 'cancel') && <TextareaField
          rows={2} className="!min-h-16"
          label={word(kind === 'return' ? 'return_reason' : 'cancel_reason')}
          value={reason} required disabled={busy || needsRefresh}
          onChange={event => { changeAttempt(); setReason(event.target.value); }} />}
        {error !== null && <div className={styles.stack}>
          <p role="alert" className={styles.error}>{apiErrorMessage(error)}</p>
          {stale && <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => void reload()}>{word('reload_latest')}</button>}
          {code === 'disbursement_approver_ineligible' && <button type="button" className={ghostClass} disabled={busy || peopleLoading}
            onClick={() => { setError(null); setPeopleRetry(n => n + 1); }}>{word('reload_latest')}</button>}
        </div>}
      </div>
    </CoverLoader>
  </Modal>;
}
