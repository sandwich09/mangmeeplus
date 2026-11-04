'use client';

import { useEffect, useRef, useState } from 'react';
import { DISBURSEMENT_VOUCHER_ERROR_WORDS, E_WHT_WORDS, eWhtPaymentMethodAllowed, todayCivilDate } from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { SelectField, TextField } from '@/common/components/field';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { cx } from '@/common/components/mangmee';
import { CoverLoader } from '@/common/components/state';
import { Modal } from '@/common/components/modal';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { useToast } from '@/common/components/toast';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { baht, btnClass, ghostClass, inputClass } from '../ExpensesUi';
import { PAYMENT_METHOD_LABELS } from '../expenses.model';
import { DisbursementVoucherAccount } from './DisbursementVoucherAccount';
import { DisbursementVoucherSlip } from './DisbursementVoucherSlip';
import { attachDisbursementVoucherSlip, payDisbursementVoucher } from './disbursement-vouchers.api';
import { nextDraftCommand } from './disbursement-voucher-form.logic';
import { disbursementPaymentCorrectionHint, disbursementEWhtPaymentWarning, disbursementPaymentBody, disbursementPaymentDateError, disbursementPaymentMethodError, initialDisbursementPayment } from './disbursement-voucher-payment.logic';
import type { DisbursementPaymentFields, DisbursementVoucherDetail, DisbursementVoucherHeader } from './disbursement-vouchers.model';
import styles from './disbursement-vouchers.module.css';

const word = (key: string) => t(`expenses.disbursement.${key}` as DictionaryKey, 'th');

export function DisbursementVoucherPayCard({ companyId, detail, onReload, onWithdraw, onSuccess, actionBlocked = false, permissions = [] }: {
  companyId: string; detail: DisbursementVoucherDetail; permissions?: readonly string[]; onReload: () => Promise<void>; onWithdraw?: () => void; onSuccess?: () => void; actionBlocked?: boolean;
}) {
  const toast = useToast();
  const [fields, setFields] = useState(() => initialDisbursementPayment(detail.header));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmationReady, setConfirmationReady] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [slipUploading, setSlipUploading] = useState(false);
  const [preparedSlip, setPreparedSlip] = useState<Pick<DisbursementVoucherDetail, 'header' | 'slip'> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const commandId = useRef<string | null>(null);
  const committed = useRef<DisbursementVoucherHeader | null>(null);
  const slipInFlight = useRef(false);
  const attachedSlip = useRef({ id: detail.slip?.attachmentId, version: detail.header.version });
  const refusalBox = useRef<HTMLDivElement>(null);
  const today = todayCivilDate('Asia/Bangkok');
  const eWht = detail.lines.some(line => line.whtRemittance === 'E_WHT');
  const dateError = disbursementPaymentDateError(fields.paidDate);
  const methodError = disbursementPaymentMethodError(fields.paymentMethod);
  const code = apiErrorCode(error);
  const slipError = Boolean(code?.startsWith('disbursement_slip_') || code === 'disbursement_file_link_conflict');
  const stale = code === 'disbursement_version_conflict' || code === 'disbursement_status_changed';

  useEffect(() => {
    // Nothing is focused on arrival (owner 2026-10-15): focusing the date field opened its calendar by itself.
    // Mobile keyboards shrink the visual viewport without necessarily shrinking the layout viewport.
    const viewport = window.visualViewport;
    const place = () => {
      const actionBar = bar.current?.querySelector<HTMLElement>('[data-form-action-bar]');
      if (actionBar) actionBar.style.bottom = `${Math.max(0, window.innerHeight - (viewport ? viewport.height + viewport.offsetTop : window.innerHeight))}px`;
    };
    place();
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    return () => {
      viewport?.removeEventListener('resize', place);
      viewport?.removeEventListener('scroll', place);
    };
  }, []);
  useEffect(() => {
    if (!confirmOpen) { setConfirmationReady(false); return; }
    setConfirmationReady(false);
    const timer = setTimeout(() => setConfirmationReady(true), 600);
    return () => clearTimeout(timer);
  }, [confirmOpen]);
  // The button is fixed at the bottom while the refusal sits inside the card: bring the refusal to the person.
  useEffect(() => { if (error !== null) refusalBox.current?.scrollIntoView?.({ block: 'center' }); }, [error]);
  const change = (patch: Partial<DisbursementPaymentFields>) => {
    commandId.current = null; setError(null); setFields(current => ({ ...current, ...patch }));
  };
  useEffect(() => {
    if (eWht && !eWhtPaymentMethodAllowed(fields.paymentMethod)) change({ paymentMethod: 'BANK_TRANSFER' });
  }, [eWht, fields.paymentMethod]);
  const reload = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await onReload(); commandId.current = null; setError(null); }
    catch (failure) { setError(failure); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const save = async () => {
    if (inFlight.current || !confirmationReady || stale || !detail.actions.pay || detail.header.status !== 'APPROVED') return;
    if (actionBlocked || !confirmOpen && !committed.current) return;
    if (slipInFlight.current) return;
    const refusal = disbursementPaymentDateError(fields.paidDate) ?? disbursementPaymentMethodError(fields.paymentMethod);
    if (refusal) { setError(new Error(refusal)); return; }
    inFlight.current = true; setBusy(true); setError(null);
    setConfirmOpen(false);
    try {
      commandId.current = nextDraftCommand(commandId.current, false, () => crypto.randomUUID());
      if (!committed.current && fields.slipAttachmentId && attachedSlip.current.id !== fields.slipAttachmentId) {
        const answer = await attachDisbursementVoucherSlip(companyId, detail.header.id, fields.slipAttachmentId);
        setPreparedSlip(answer);
        if (answer.header.status !== 'APPROVED' || answer.header.version !== attachedSlip.current.version + 1) {
          throw Object.assign(new Error(DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_version_conflict), { code: 'disbursement_version_conflict' });
        }
        attachedSlip.current = { id: fields.slipAttachmentId, version: answer.header.version };
      }
      if (!committed.current) committed.current = await payDisbursementVoucher(companyId, detail.header.id,
        disbursementPaymentBody({ commandId: commandId.current, expectedVersion: attachedSlip.current.version }, fields));
      setNeedsRefresh(true);
      await onReload();
      onSuccess?.();
      if (committed.current.documentFileReady === false) toast.success(word('file_pending'));
      else toast.success(word('paid_toast').replace('{number}', committed.current.documentNumber!));
    } catch (failure) { setError(failure); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const requestConfirmation = () => {
    if (inFlight.current || actionBlocked || slipInFlight.current || dateError || methodError || stale) return;
    setConfirmOpen(true);
  };
  const closeConfirmation = () => { if (!inFlight.current) setConfirmOpen(false); };

  return <div id="disbursement-voucher-pay" ref={card} className={styles.payCard}>
    {detail.header.payeeAccountLast4
      ? <DisbursementVoucherAccount companyId={companyId} header={detail.header} permissions={permissions} expanded />
      : fields.paymentMethod === 'BANK_TRANSFER' && <p role="status" className="mb-4 text-warning-700">ใบนี้ไม่มีบัญชีผู้รับ ถามผู้จัดทำ{detail.preparerName ? ` ${detail.preparerName}` : ''} ก่อนโอน</p>}
    <form ref={bar} className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); if (needsRefresh) void reload(); else requestConfirmation(); }}>
    <div className={styles.stack}>
      <h2 ref={heading} tabIndex={-1} className={cx(styles.payee, 'outline-none')}>{word('pay')}</h2>
        <CoverLoader active={busy} scope="form" label={word('working')}>
          <div className={styles.payFields}>
            <fieldset disabled={busy || needsRefresh} className={styles.payFields}>
              <div className={styles.payDate}>
                <label htmlFor="disbursement-paid-date" className="text-sm font-medium text-gray-700">{word('actual_paid_date')}</label>
                <ThemedDate id="disbursement-paid-date" name="paidDate" className={inputClass} value={fields.paidDate} max={today} today={today}
                  aria-invalid={Boolean(dateError)} aria-describedby={dateError ? 'disbursement-paid-date-error' : undefined}
                  disabled={busy || needsRefresh} onChange={event => change({ paidDate: event.target.value })} />
                {disbursementEWhtPaymentWarning(detail, fields.paidDate) && <p role="status" className="text-sm text-warning-700">{E_WHT_WORDS['W-P2']}</p>}
                {dateError && <p id="disbursement-paid-date-error" role="alert" className={styles.error}>{dateError}</p>}
              </div>
              <SelectField label={word('paid_method')} hint={eWht ? E_WHT_WORDS['W-P1'] : undefined} value={fields.paymentMethod} disabled={busy || needsRefresh}
                onChange={event => change({ paymentMethod: event.target.value as DisbursementPaymentFields['paymentMethod'] })}>
                {Object.entries(PAYMENT_METHOD_LABELS).filter(([method]) => !eWht || eWhtPaymentMethodAllowed(method)).map(([method, label]) => <option key={method} value={method}>{label}</option>)}
              </SelectField>
              <TextField className={inputClass} label="จ่ายจาก (ถ้ามี)" value={fields.paidFromRef} maxLength={128}
                placeholder={word('paid_from_placeholder')} onChange={event => change({ paidFromRef: event.target.value })} />
              <DisbursementVoucherSlip companyId={companyId} id={detail.header.id} slip={preparedSlip?.slip ?? detail.slip} canAttach={detail.canAttachSlip} paymentForm
                disabled={busy || needsRefresh} refusal={slipError ? error : null}
                onChange={slipAttachmentId => change({ slipAttachmentId })}
                onBusy={uploading => { slipInFlight.current = uploading; setSlipUploading(uploading); }} />
            </fieldset>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className={styles.muted}>{disbursementPaymentCorrectionHint(detail, Boolean(detail.actions.withdraw && onWithdraw))}</p>
              {detail.actions.withdraw && onWithdraw && <button type="button" className={ghostClass} disabled={busy || needsRefresh || slipUploading} aria-busy={busy || slipUploading} onClick={onWithdraw}>{word('withdraw')}</button>}
            </div>
            {error !== null && !dateError && !slipError && <div ref={refusalBox} className={styles.stack}>
              <p role="alert" className={styles.error}>{apiErrorMessage(error)}</p>
              {stale && <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => void reload()}>{word('reload_latest')}</button>}
            </div>}
          </div>
        </CoverLoader>
    </div>
        <FormActionBar><ActionGroup>
            <button type="submit" className={btnClass} disabled={busy || actionBlocked || slipUploading || Boolean(methodError) && !needsRefresh || stale} aria-busy={busy || actionBlocked || slipUploading}>
              {slipUploading ? word('slip_uploading') : busy ? word('working') : needsRefresh ? word('reload_latest') : word('pay')}
            </button>
        </ActionGroup></FormActionBar>
    </form>
    <Modal open={confirmOpen} title={word('pay')} size="sm" onClose={closeConfirmation} closeOnBackdrop={false} closeLabel={word('pay_review')}
      footer={<>
        <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={closeConfirmation}>{word('pay_review')}</button>
        <button type="button" className={btnClass} disabled={busy || actionBlocked || slipUploading || !confirmationReady} aria-busy={busy || actionBlocked || slipUploading} onClick={() => void save()}>{word('pay_confirm').replace('{total}', baht(detail.header.totalAmount))}</button>
      </>}>
      <div className={styles.stack}>
        {detail.hasOwnSignature && <p>ลายเซ็นของคุณจะอยู่ในใบนี้</p>}
        <p>{word('pay_confirm_fact').replace('{total}', baht(detail.header.totalAmount)).replace('{payee}', detail.header.payeeName)}</p>
        <p>{formatThaiDate(fields.paidDate)} · {fields.paymentMethod && PAYMENT_METHOD_LABELS[fields.paymentMethod]}</p>
        {!fields.slipAttachmentId && !detail.slip && !preparedSlip?.slip && <p>{word('pay_no_evidence')}</p>}
      </div>
    </Modal>
  </div>;
}
