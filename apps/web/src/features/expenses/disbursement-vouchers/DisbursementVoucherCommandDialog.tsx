'use client';

import { useEffect, useRef, useState } from 'react';
import { DISBURSEMENT_VOUCHER_ERROR_WORDS } from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { TextareaField, TextField } from '@/common/components/field/Field';
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
      .then(data => { if (active) { if (kind === 'submit') data = disbursementOtherApprovers(data, viewerUserId); setPeople(data); setApprover(initialApprover(data, preferredApprover)); commandId.current = null; } })
      .catch(failure => { if (active) setPeopleError(failure); })
      .finally(() => { if (active) setPeopleLoading(false); });
    return () => { active = false; };
  }, [companyId, detail.header.branchId, kind, choosingApprover, preferredApprover, viewerUserId, peopleRetry]);

  const changeAttempt = () => { commandId.current = null; setError(null); };
  // A long list gets a name search and scrolls inside the dialog; the chosen person always stays in view.
  const manyPeople = people.length > DISBURSEMENT_APPROVER_SEARCH_ABOVE;
  const shownPeople = manyPeople ? disbursementApproverMatches(people, approverQuery, approver) : people;
  const onCancel = () => { if (!inFlight.current) onClose(); };
  const canAct = kind === 'selfApprove' ? detail.actions.submitAndApprove : kind === 'remind' ? detail.header.status === 'PENDING_APPROVAL' && detail.actions.remind : detail.actions[kind];
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
      setError(new Error(DISBURSEMENT_VOUCHER_ERROR_WORDS[kind === 'return' ? 'disbursement_return_reason_required' : 'disbursement_cancel_reason_required'])); return;
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
        : await commands[kind](companyId, detail.header.id, disbursementCommandBody(kind, { commandId: commandId.current, expectedVersion: version }, approver, reason));
      // A successful command followed by a failed read is retried as a read, never as another mutation.
      setNeedsRefresh(true);
      await onReload();
      const message = disbursementCommandToast(kind, committed.current, viewerUserId, people);
      if (message) toast.success(message);
      onSuccess?.();
      onClose();
    } catch (failure) { setError(failure); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const code = apiErrorCode(error);
  const stale = code === 'disbursement_version_conflict' || code === 'disbursement_status_changed' || code === 'disbursement_not_draft';
  const busyLabel = word(kind === 'delete' ? 'deleting' : 'working');
  const safeLabel = kind === 'cancel' ? word('cancel_safe') : kind === 'delete' ? word('cancel_delete') : t('common.close', 'th');
  const showAction = !choosingApprover || !peopleLoading && !peopleError && people.length > 0;

  return <Modal open title={kind === 'approve' ? word('approve_confirm').replace('{total}', baht(detail.header.totalAmount)).replace('{payee}', detail.header.payeeName) : word(DISBURSEMENT_DIALOG_TITLES[kind])} size="sm" onClose={onCancel} closeOnBackdrop={false} closeLabel={safeLabel}
    footer={<div className={styles.modalFooter}>
      <button type="button" className={`${ghostClass} w-full sm:w-auto`} disabled={busy} onClick={onCancel}>{safeLabel}</button>
      {showAction && <button type="button" className={`${kind === 'cancel' || kind === 'delete' ? dangerClass : btnClass} w-full sm:w-auto`}
        disabled={busy || kind === 'approve' && !confirmationReady || !ready && !needsRefresh || stale} aria-busy={busy} onClick={() => void run()}>
        {busy ? busyLabel : needsRefresh ? word('reload_latest') : word(DISBURSEMENT_DIALOG_LABELS[kind])}
      </button>}
    </div>}>
    <CoverLoader active={busy} scope="modal" label={busyLabel}>
      <div className={styles.stack}>
        {choosingApprover && <>
          {peopleLoading ? <LoadingState label={word('loading_sources')} /> : peopleError ? <>
            <p role="alert" className={styles.error}>{apiErrorMessage(peopleError)}</p>
            <button type="button" className={ghostClass} onClick={() => setPeopleRetry(n => n + 1)}>{word('reload_latest')}</button>
          </> : people.length === 0 ? <p>{word('no_approvers')}</p> : <>
            {manyPeople && <TextField type="search" label={word('approver_search')} value={approverQuery} onChange={event => setApproverQuery(event.target.value)} />}
            <fieldset className={manyPeople ? `${styles.approvers} ${styles.approversScroll}` : styles.approvers} disabled={busy || needsRefresh}>
              {shownPeople.length === 0 && <p className={styles.muted}>{word('approver_not_found')}</p>}
              {shownPeople.map(person => <label key={person.userId} className={styles.approver}>
                <input type="radio" name="disbursement-approver" value={person.userId} checked={approver === person.userId}
                  onChange={() => { changeAttempt(); setApprover(person.userId); }} />
                <span>{person.displayName}</span>
              </label>)}
            </fieldset>
            {kind === 'submit' && <p className={styles.muted}>{word(viewerUserId && approver && approver !== viewerUserId ? 'send_help' : 'send_help_others')}</p>}
          </>}
        </>}
        {lastReminder && <p className={styles.muted}>{lastReminder}</p>}
        {kind === 'selfApprove' && <p>{word('self_confirm')}</p>}
        {kind === 'withdraw' && <p>{word('withdraw_help')}{detail.header.status === 'APPROVED' && <> {word('withdraw_approved')}</>}</p>}
        {kind === 'cancel' && cancellationSentence && <p>{cancellationSentence}</p>}
        {kind === 'delete' && <p>{word('confirm_delete')}</p>}
        {(kind === 'return' || kind === 'withdraw' || kind === 'cancel') && <TextareaField
          label={word(kind === 'return' ? 'return_reason' : kind === 'cancel' ? 'cancel_reason' : 'optional_reason')}
          value={reason} required={kind !== 'withdraw'} disabled={busy || needsRefresh}
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
