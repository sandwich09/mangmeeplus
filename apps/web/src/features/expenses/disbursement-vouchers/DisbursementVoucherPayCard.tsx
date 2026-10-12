'use client';

import { useEffect, useRef, useState } from 'react';
import { DISBURSEMENT_VOUCHER_ERROR_WORDS, todayCivilDate } from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { SelectField, TextField } from '@/common/components/field';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { MangmeeCard, cx } from '@/common/components/mangmee';
import { CoverLoader } from '@/common/components/state';
import { Modal } from '@/common/components/modal';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { useToast } from '@/common/components/toast';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { baht, btnClass, ghostClass, inputClass } from '../ExpensesUi';
import { PAYMENT_METHOD_LABELS } from '../expenses.model';
import { DisbursementVoucherSlip } from './DisbursementVoucherSlip';
import { DisbursementVoucherAccount } from './DisbursementVoucherAccount';
import { attachDisbursementVoucherSlip, payDisbursementVoucher } from './disbursement-vouchers.api';
import { nextDraftCommand } from './disbursement-voucher-form.logic';
import { disbursementPaymentBody, disbursementPaymentDateError, disbursementPaymentMethodError, initialDisbursementPayment } from './disbursement-voucher-payment.logic';
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
  const bar = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const commandId = useRef<string | null>(null);
  const committed = useRef<DisbursementVoucherHeader | null>(null);
  const slipInFlight = useRef(false);
  const attachedSlip = useRef({ id: detail.slip?.attachmentId, version: detail.header.version });
  const refusalBox = useRef<HTMLDivElement>(null);
  const today = todayCivilDate('Asia/Bangkok');
  const dateError = disbursementPaymentDateError(fields.paidDate);
  const methodError = disbursementPaymentMethodError(fields.paymentMethod);
  const code = apiErrorCode(error);
  const slipError = Boolean(code?.startsWith('disbursement_slip_') || code === 'disbursement_file_link_conflict');
  const stale = code === 'disbursement_version_conflict' || code === 'disbursement_status_changed';

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      card.current?.scrollIntoView({ block: 'start' });
      heading.current?.focus({ preventScroll: true });
    });
    // Mobile keyboards shrink the visual viewport without necessarily shrinking the layout viewport.
    const viewport = window.visualViewport;
    const place = () => {
      if (bar.current) bar.current.style.bottom = `${Math.max(0, window.innerHeight - (viewport ? viewport.height + viewport.offsetTop : window.innerHeight))}px`;
    };
    place();
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    return () => {
      cancelAnimationFrame(frame);
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
      // The paid state starts at the top of the page: its number, its badge and the sentence of what it is now.
      if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
    } catch (failure) { setError(failure); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const requestConfirmation = () => {
    if (inFlight.current || actionBlocked || slipInFlight.current || dateError || methodError || stale) return;
    setConfirmOpen(true);
  };
  const closeConfirmation = () => { if (!inFlight.current) setConfirmOpen(false); };

  return <div id="disbursement-voucher-pay" ref={card} className={styles.payCard}>
    <MangmeeCard className={cx(styles.section, styles.stack)}>
      <h2 ref={heading} tabIndex={-1} className={cx(styles.payee, 'outline-none')}>{word('pay')}</h2>
      <form onSubmit={event => { event.preventDefault(); if (needsRefresh) void save(); else requestConfirmation(); }}>
        <CoverLoader active={busy} scope="form" label={word('working')}>
          <div className={styles.payFields}>
            <p>{word('pay_readonly').replace('{number}', detail.header.documentNumber!).replace('{payee}', detail.header.payeeName).replace('{total}', baht(detail.header.totalAmount))}</p>
            <DisbursementVoucherAccount key={`${detail.header.id}:${detail.header.payeeAccountLast4}`} companyId={companyId} header={detail.header} permissions={permissions} />
            <fieldset disabled={busy || needsRefresh} className={styles.payFields}>
              <div className={styles.payDate}>
                <label htmlFor="disbursement-paid-date" className="text-sm font-medium text-gray-700">{word('actual_paid_date')}</label>
                <ThemedDate id="disbursement-paid-date" name="paidDate" className={inputClass} value={fields.paidDate} max={today} today={today}
                  aria-invalid={Boolean(dateError)} aria-describedby={dateError ? 'disbursement-paid-date-error' : undefined}
                  disabled={busy || needsRefresh} onChange={event => change({ paidDate: event.target.value })} />
                {dateError && <p id="disbursement-paid-date-error" role="alert" className={styles.error}>{dateError}</p>}
              </div>
              <SelectField label={word('paid_method')} value={fields.paymentMethod} disabled={busy || needsRefresh}
                onChange={event => change({ paymentMethod: event.target.value as DisbursementPaymentFields['paymentMethod'] })}>
                <option value="">{word('choose_paid_method')}</option>{Object.entries(PAYMENT_METHOD_LABELS).map(([method, label]) => <option key={method} value={method}>{label}</option>)}
              </SelectField>
              <TextField label={word('paid_from_optional')} value={fields.paidFromRef} maxLength={128}
                placeholder={word('paid_from_placeholder')} hint={word('paid_from_hint')} onChange={event => change({ paidFromRef: event.target.value })} />
              <DisbursementVoucherSlip companyId={companyId} id={detail.header.id} slip={preparedSlip?.slip ?? detail.slip} canAttach={detail.canAttachSlip} paymentForm
                disabled={busy || needsRefresh} refusal={slipError ? error : null}
                onChange={slipAttachmentId => change({ slipAttachmentId })}
                onBusy={uploading => { slipInFlight.current = uploading; setSlipUploading(uploading); }} />
            </fieldset>
            <p className={styles.muted}>{detail.actions.withdraw && onWithdraw ? <>{word('pay_amount_hint_short')}<button type="button" className="min-h-11 text-brand-700 underline" disabled={busy || needsRefresh || slipUploading} aria-busy={busy} onClick={onWithdraw}>{word('withdraw')}</button></> : word('pay_amount_hint_ask')}</p>
            {error !== null && !dateError && !slipError && <div ref={refusalBox} className={styles.stack}>
              <p role="alert" className={styles.error}>{apiErrorMessage(error)}</p>
              {stale && <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => void reload()}>{word('reload_latest')}</button>}
            </div>}
          </div>
        </CoverLoader>
        <div ref={bar} className={styles.journeyBar}>
          <div className={styles.journeyBarInner}>
            {methodError && !busy && !needsRefresh && <p className={styles.muted}>{word('choose_method_first')}</p>}
            <button type="submit" className={cx(btnClass, styles.action)} disabled={busy || actionBlocked || slipUploading || Boolean(dateError) || Boolean(methodError) && !needsRefresh || stale} aria-busy={busy || actionBlocked || slipUploading}>
              {slipUploading ? word('slip_uploading') : busy ? word('working') : needsRefresh ? word('reload_latest') : word('pay_total').replace('{total}', baht(detail.header.totalAmount))}
            </button>
          </div>
        </div>
      </form>
    </MangmeeCard>
    <Modal open={confirmOpen} title={word('pay')} size="sm" onClose={closeConfirmation} closeOnBackdrop={false} closeLabel={word('pay_review')}
      footer={<div className={styles.modalFooter}>
        <button type="button" className={`${ghostClass} w-full sm:w-auto`} disabled={busy} aria-busy={busy} onClick={closeConfirmation}>{word('pay_review')}</button>
        <button type="button" className={`${btnClass} w-full sm:w-auto`} disabled={busy || actionBlocked || slipUploading || !confirmationReady} aria-busy={busy || actionBlocked || slipUploading} onClick={() => void save()}>{word('pay_confirm').replace('{total}', baht(detail.header.totalAmount))}</button>
      </div>}>
      <div className={styles.stack}>
        <p>{word('pay_confirm_fact').replace('{total}', baht(detail.header.totalAmount)).replace('{payee}', detail.header.payeeName)}</p>
        <p>{formatThaiDate(fields.paidDate)} · {fields.paymentMethod && PAYMENT_METHOD_LABELS[fields.paymentMethod]}</p>
        {!fields.slipAttachmentId && !detail.slip && !preparedSlip?.slip && <p>{word('pay_no_evidence')}</p>}
      </div>
    </Modal>
  </div>;
}
