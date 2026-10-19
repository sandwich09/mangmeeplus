'use client';
import { whtCertificateUnsupportedReason, civilDate } from '@watchdog-bms/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isExpenseVoidReason, whtPayerIdentityMissingMessage, whtPayeeAddress, WHT_HANDOFF_PAYEE_ADDRESS_MISSING_MESSAGE, WHT_HANDOFF_MISSING_LABELS, WHT_HANDOFF_PAYEE_ADDRESS_MAX, isCivilDate, todayCivilDate, type WhtCertificateHandoffDto, type WhtCertificateHandoffListRowDto } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeeBadge } from '@/common/components/mangmee';
import { REASON_MAX_LENGTH, sanitizeReasonInput } from '@/common/forms/sanitize';
import { Modal } from '@/common/components/modal/Modal';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { FieldError } from '@/common/components/field';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { useToast } from '@/common/components/toast/use-toast';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { formatMessage } from '@/common/i18n/error-message.logic';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { listWhtHandoffsPaged, removeExternalWhtCertificate, changeExternalWhtCertificate, linkExternalWhtCertificate, setWhtHandoffPayeeAddress } from './expenses.api';
import { baht, btnClass, dangerClass, ghostClass, inputClass, err, ErrorBanner } from './ExpensesUi';
import { ExpenseCertificateHistoryDisclosure, ExpenseCertificateHistoryNotice, ExpenseCertificateExternalRecordNotice, useExpenseCertificateHistoryRefresh } from './ExpenseCertificateHistory';
import { allPaymentCertificatesIssued, certificateCardAction, certificateRecordRefusal, selfIssuedCertificateBody, type SelfIssuedCertificateValues } from './expense-certificate-card.logic';

import { WhtIssueButton } from './WhtIssueButton';
import { SelectField } from '@/common/components/field';
import { WhtPayerIdentityNotice } from './WhtPayerIdentityNotice';
import { ExpensePreviousCertificate } from './ExpensePreviousCertificate';

const WHT_PAYEE_ADDRESS_EXAMPLE = 'เลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์';

const text = (key: string) => t(`expenses.certificate_card.${key}` as DictionaryKey, 'th');
const REMOVE_REASON_REQUIRED = 'ใส่เหตุผลที่ลบการบันทึก อย่างน้อย 3 ตัวอักษร';
export function ExpenseCertificateCard({ companyId, expenseId, revision, handoff, permissions, issueButton, onDownload, busy, error, onChanged, onClearError, onIssuePayment, onCoverageChanged, primaryHidden = false, children }: {
  companyId: string; expenseId: string; revision: string; handoff: WhtCertificateHandoffDto | null; permissions: string[];
  onCoverageChanged?: (complete: boolean | null) => void;
  onIssuePayment?: (handoff: WhtCertificateHandoffDto, paymentId: string) => Promise<void>;
  issueButton: ReactNode; onDownload: (handoff?: WhtCertificateHandoffDto) => void; busy: boolean; error: string | null; onChanged: (handoff: WhtCertificateHandoffDto) => void; onClearError?: () => void; primaryHidden?: boolean; children?: ReactNode;
}) {
  const [read, setRead] = useState<{ rows?: WhtCertificateHandoffListRowDto[]; row: WhtCertificateHandoffListRowDto | null; loading: boolean; error: string | null }>({ row: null, loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<'record' | 'change-record' | 'remove-record' | 'address' | null>(null);
  const [values, setValues] = useState<SelfIssuedCertificateValues>({ number: '', date: '', paymentDate: '', reference: '', note: '' });
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [commandId, setCommandId] = useState('');
  const [removeReason, setRemoveReason] = useState('');
  const [removeVersion, setRemoveVersion] = useState('');
  // What the self-issued form held when it opened: the window knows from it whether something was typed.
  const [opened, setOpened] = useState('');
  const submitting = useRef(false);
  const [paymentId, setPaymentId] = useState('');
  const toast = useToast();
  const refreshHistory = useExpenseCertificateHistoryRefresh();
  // A completed command already knows the certificate identity; the read fills in its full details.
  const issued = handoff?.status === 'SYSTEM_ISSUED' && handoff.certificateNumber && handoff.certificateId !== read.row?.certificateId;
  const sourceRow = issued && read.row ? { ...read.row, ...handoff } : read.row;
  const payments = sourceRow?.payments;
  const selectedPayment = payments?.find(p => p.id === paymentId) ?? payments?.[0];
  const matched = read.rows?.find(r => r.prefill.expensePaymentId === selectedPayment?.id && ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'].includes(r.status))
    ?? (sourceRow && !sourceRow.prefill.expensePaymentId && ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'].includes(sourceRow.status) ? sourceRow : undefined);
  const row = payments?.length && sourceRow ? matched ?? { ...sourceRow, status: 'REQUIRED' as const, certificateId: null, certificateNumber: null, currentCertificate: null,
    prefill: { ...sourceRow.prefill, expensePaymentId: selectedPayment!.id, paymentDate: selectedPayment!.paidAt, grossAmount: selectedPayment!.grossAmount ?? sourceRow.prefill.grossAmount, withheldAmount: selectedPayment!.withheldAmount ?? sourceRow.prefill.withheldAmount } } : sourceRow;
  const waitingPayment = row?.status === 'REQUIRED' && payments !== undefined && (!selectedPayment || !selectedPayment.paidAtConfirmed);
  const certificateRows = read.rows ?? (sourceRow ? [sourceRow] : []);
  const certificatesComplete = read.loading || read.error ? null : allPaymentCertificatesIssued(payments, certificateRows);
  useEffect(() => { onCoverageChanged?.(certificatesComplete); }, [certificatesComplete, onCoverageChanged]);
  const paymentLabels = payments?.map(payment => `${payment.paidAtConfirmed ? formatThaiDate(payment.paidAt) : 'ยังไม่ทราบวันที่จ่ายจริง'} · ${baht(payment.amount)}`) ?? [];

  useEffect(() => {
    let cancelled = false;
    setRead({ row, loading: true, error: null });
    listWhtHandoffsPaged(companyId, { sourcePaymentId: expenseId, page: 1, pageSize: 100 })
      .then(result => { if (!cancelled) {
        const row = result.rows.find(row => row.status !== 'CANCELLED') ?? null;
        setRead({ rows: result.rows, row, loading: false, error: null });
        if (row) {
          const selected = row.payments?.find(p => p.id === paymentId) ?? row.payments?.[0];
          onChanged(result.rows.find(r => r.prefill.expensePaymentId === selected?.id && ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'].includes(r.status)) ?? row);
        }
      } })
      .catch(() => { if (!cancelled) setRead(previous => ({ ...previous, loading: false, error: text('unavailable') })); });
    return () => { cancelled = true; };
  }, [companyId, expenseId, revision, handoff?.status, handoff?.certificateId, attempt]);
  // The page has just issued or replaced the certificate and this card is still re-reading: the old status would be untrue beside the success toast.
  const stale = read.loading && !!row && !!handoff && (handoff.status !== row.status || (handoff.certificateId ?? null) !== (row.certificateId ?? null));
  const loaded = !!row;
  // "เพิ่มที่อยู่" on the list lands here, not at the top of a long page.
  useEffect(() => { if (loaded && (globalThis.location?.hash === '#wht-certificate' || new URLSearchParams(globalThis.location?.search ?? '').get('section') === 'wht-certificate')) document.getElementById('wht-certificate')?.scrollIntoView(); }, [loaded]);
  useEffect(() => { if (error === WHT_HANDOFF_PAYEE_ADDRESS_MISSING_MESSAGE || [['REGISTERED_NAME'], ['TAX_ID'], ['ADDRESS'], ['REGISTERED_NAME', 'TAX_ID'], ['REGISTERED_NAME', 'ADDRESS'], ['TAX_ID', 'ADDRESS'], ['REGISTERED_NAME', 'TAX_ID', 'ADDRESS']].some(missing => error === whtPayerIdentityMissingMessage(missing as ('REGISTERED_NAME' | 'TAX_ID' | 'ADDRESS')[]))) setAttempt(value => value + 1); }, [error]);
  const action = row ? certificateCardAction(row, permissions) : null;
  const payerMissing = row?.payerMissing ?? [];
  const canLink = permissions.includes('wht.external_certificate.link');
  const issuer = !!row?.systemIssuanceOpen && permissions.includes('wht.certificate.issue');
  const payeeAddress = whtPayeeAddress(row?.payeeAddress, row?.prefill.payeeSnapshot.address) || '';
  const canEditAddress = row?.status === 'REQUIRED' && permissions.some(p => ['wht.external_certificate.link', 'wht.certificate.issue'].includes(p));
  const openRecord = (change = false) => {
    const start = change && row ? { number: row.externalCertificateNumber ?? '', date: row.externalIssuedDate?.slice(0, 10) ?? '', paymentDate: row.externalPaymentDate?.slice(0, 10) ?? '', reference: row.externalEvidenceRef ?? '', note: row.linkNote ?? '' } : { number: '', date: '', paymentDate: payments?.length === 1 && payments[0]!.paidAtConfirmed ? civilDate(new Date(payments[0]!.paidAt)) : '', reference: '', note: '' };
    setValues(start); setOpened(JSON.stringify(start));
    setRefusal(null); setCommandId(crypto.randomUUID()); setDialog(change ? 'change-record' : 'record');
  };
  const close = () => { if (!saving) setDialog(null); };
  const retry = () => { onClearError?.(); setAttempt(value => value + 1); };
  async function save() {
    if (!row || submitting.current) return;
    submitting.current = true;
    setRefusal(null); setSaving(true);
    try {
      if (dialog === 'remove-record') {
        if (!isExpenseVoidReason(removeReason) || removeReason.trim().length > REASON_MAX_LENGTH) throw Error(REMOVE_REASON_REQUIRED);
        const result = await removeExternalWhtCertificate(companyId, row.id, { commandId, expectedUpdatedAt: removeVersion, reason: removeReason.trim() });
        const updated = { ...row, ...result, previousCertificate: result.previousCertificate };
        setRead({ row: updated, loading: false, error: null }); onChanged(updated);
        toast.success(text('removed'));
      } else if (dialog === 'record' || dialog === 'change-record') {
        const body = { ...selfIssuedCertificateBody(values, commandId), ...(selectedPayment && { paymentId: selectedPayment.id }) };
        const result = await (dialog === 'change-record' ? changeExternalWhtCertificate : linkExternalWhtCertificate)(companyId, row.id, body);
        const updated = { ...row, ...result, systemIssuanceOpen: row.systemIssuanceOpen, systemCorrectionOpen: row.systemCorrectionOpen, systemReplacementOpen: row.systemReplacementOpen };
        setRead({ row: updated, loading: false, error: null });
        onChanged(updated);
        toast.success(formatMessage(text(dialog === 'change-record' ? 'record_changed' : 'saved'), { number: body.externalCertificateNumber }));
      } else {
        if (!address.trim()) throw Error(text('address_required'));
        const result = await setWhtHandoffPayeeAddress(companyId, row.id, { payeeAddress: address.trim() });
        const updated = { ...row, ...result, systemIssuanceOpen: row.systemIssuanceOpen, systemCorrectionOpen: row.systemCorrectionOpen, systemReplacementOpen: row.systemReplacementOpen };
        setRead({ row: updated, loading: false, error: null });
        onChanged(updated);
        toast.success(text('address_saved'));
      }
      onClearError?.(); refreshHistory?.(); setDialog(null); setAttempt(value => value + 1);
    } catch (cause) {
      const taken = dialog === 'record' ? certificateRecordRefusal(cause) : null;
      setRefusal(taken ?? err(cause));
      if (taken) setAttempt(value => value + 1);
    }
    finally { submitting.current = false; setSaving(false); }
  }
  const dialogError = refusal ?? ((dialog === 'record' || dialog === 'change-record') && isCivilDate(values.date) && values.date > todayCivilDate('Asia/Bangkok') ? text('future_date') : null);
  // A sentence about one box is shown under that box; anything else (a refusal from the server) closes the form.
  const errorField = dialogError === text('number_required') ? 'number' : dialogError === text('date_required') || dialogError === text('future_date') ? 'date'
    : dialogError === text('address_required') ? 'address' : dialogError === REMOVE_REASON_REQUIRED ? 'reason' : null;
  const typed = dialog === 'remove-record' ? removeReason !== '' : dialog === 'address' ? address !== payeeAddress : dialog !== null && JSON.stringify(values) !== opened;
  const missing = row?.missing.map(reason => WHT_HANDOFF_MISSING_LABELS[reason]).join(' และ ') ?? '';
  const number = row?.currentCertificate?.number ?? row?.certificateNumber ?? row?.externalCertificateNumber ?? '—';
  const date = row?.currentCertificate?.issuedAt ?? row?.certificateIssuedAt ?? row?.externalIssuedDate;
  // One word in the badge, the same four names as the tabs of the list; the number and its date are a plain line beside it.
  const numbered = row?.status === 'SYSTEM_ISSUED' || row?.status === 'EXTERNAL_LINKED';
  const status = row?.status === 'SYSTEM_ISSUED' ? t('expenses.certificates.system', 'th')
    : row?.status === 'EXTERNAL_LINKED' ? t('expenses.certificates.external', 'th')
    : missing && issuer ? t('expenses.certificates.incomplete', 'th')
    : action === 'record' && !issuer ? text('external_pending') : missing ? t('expenses.certificates.incomplete', 'th') : t('expenses.certificates.pending', 'th');
  const statusNumber = row?.status === 'EXTERNAL_LINKED' ? row.externalCertificateNumber ?? '—' : number;
  const statusDate = row?.status === 'EXTERNAL_LINKED' ? row.externalIssuedDate : date;
  // What the card is waiting for before it can issue, said once beside the state; the two errands below each carry their own button.
  const waitingFor = action === 'issue' ? [payerMissing.length > 0 && 'ข้อมูลร้าน', !payeeAddress && 'ที่อยู่ผู้รับเงิน'].filter(Boolean).join('และ') : '';
  // Every button of the card has one width: the full card on a phone, one fixed width on a wide screen.
  return <MangmeeCard className="min-w-0 space-y-3 p-4 text-sm text-gray-700 [&_.mangmee-btn]:w-full sm:[&_.mangmee-btn]:max-w-64">
    <h2 id="wht-certificate" className="scroll-mt-60 text-base font-semibold leading-6 text-gray-900">{text('heading')}</h2>
    {read.loading && <p role="status" className="text-sm text-gray-600">{row ? text('refreshing') : t('expenses.loading', 'th')}</p>}
    {read.error && <div className="space-y-2"><ErrorBanner message={read.error} /><button type="button" className={ghostClass} onClick={retry}>{t('expenses.substitute_wizard.retry', 'th')}</button></div>}
    {!read.loading && !read.error && !row && <div className="space-y-2"><p>{text('no_handoff')}</p><button type="button" className={ghostClass} onClick={retry}>{text('reload')}</button></div>}
    {row && <>
      {payments && payments.length > 1 && <SelectField id="certificate-payment" label="รายการจ่าย" value={selectedPayment?.id ?? ''} onChange={e => { setPaymentId(e.target.value); const next = read.rows?.find(r => r.prefill.expensePaymentId === e.target.value && r.status !== 'CANCELLED'); if (next) onChanged(next); }}>{payments.map((p, index) => <option key={p.id} value={p.id}>{paymentLabels[index]}{paymentLabels.filter(label => label === paymentLabels[index]).length > 1 ? ` · รายการจ่ายที่ ${index + 1}` : ''}{certificateRows.some(row => ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'].includes(row.status) && (!row.prefill.expensePaymentId || row.prefill.expensePaymentId === p.id)) ? ' · ออกหนังสือรับรองแล้ว' : ''}</option>)}</SelectField>}
      {waitingPayment && <p>ร่าง · {selectedPayment ? 'ระบุวันที่จ่ายจริงในรายการจ่ายก่อนออกหนังสือรับรอง' : 'บันทึกการจ่ายก่อนออกหนังสือรับรอง'}</p>}
      {!stale && <p className="flex flex-wrap items-center gap-x-2 gap-y-1 break-words leading-6" role="status">
        <MangmeeBadge tone={row?.status === 'SYSTEM_ISSUED' ? 'brand' : row?.status === 'EXTERNAL_LINKED' ? 'sky' : 'amber'}>{status}</MangmeeBadge>{' '}
        {numbered && <span><span className="inline-block max-w-full">เลขที่ <span className={statusNumber.length > 30 ? undefined : 'whitespace-nowrap'}>{statusNumber}</span></span>{' '}<span className="whitespace-nowrap">วันที่ออก {statusDate ? formatThaiDate(statusDate) : '—'}</span></span>}
        {waitingFor && <span>ออกได้เมื่อมี{waitingFor}</span>}
      </p>}
      {numbered && <p>วันที่จ่าย {formatThaiDate(row.currentCertificate?.paymentDate ?? row.externalPaymentDate ?? row.prefill.paymentDate)}</p>}
      {row?.status === 'REQUIRED' && whtCertificateUnsupportedReason(row.prefill.incomeCategoryCode, row.prefill.formType) && <p>{whtCertificateUnsupportedReason(row.prefill.incomeCategoryCode, row.prefill.formType)}</p>}
      {row?.status === 'REQUIRED' && !issuer && canLink && <p>ร้านต้องออกหนังสือรับรองให้ผู้รับเงินและยื่นแบบภาษีหัก ณ ที่จ่ายเอง ระบบเก็บยอดที่หักไว้</p>}
      {row?.status === 'SYSTEM_ISSUED' && <p>{text('issued_next')}</p>}
      {row?.status === 'REQUIRED' && (row.previousCertificate ? <ExpensePreviousCertificate previous={row.previousCertificate} /> : <><ExpenseCertificateHistoryNotice placement="issue" /><ExpenseCertificateExternalRecordNotice /></>)}
      {row?.status === 'EXTERNAL_LINKED' && <div className="space-y-1 break-words">
        {row.externalEvidenceRef && <p>{formatMessage(text('reference_value'), { reference: row.externalEvidenceRef })}</p>}
        {row.linkNote && <p className="whitespace-pre-wrap">{formatMessage(text('note_value'), { note: row.linkNote })}</p>}
        <p>{text('no_file')}</p>
      </div>}
      {row?.status === 'REQUIRED' && missing && <div className="space-y-1 leading-6">{row.missing.map(reason => <p key={reason}>{WHT_HANDOFF_MISSING_LABELS[reason]}</p>)}{issuer && <p>{text('edit_hint')}</p>}</div>}
    </>}
    {error && !read.error && <div className="space-y-2"><ErrorBanner message={error} /><button type="button" className={ghostClass} onClick={retry}>{t('expenses.substitute_wizard.retry', 'th')}</button></div>}
    {row && !read.error && <>
      {(action === 'issue' || row.status === 'SYSTEM_ISSUED' && permissions.some(permission => ['wht.certificate.issue', 'wht.certificate.correct'].includes(permission))) && payerMissing.length > 0 && <WhtPayerIdentityNotice companyId={companyId} missing={payerMissing} permissions={permissions} primary={action === 'issue'} returnTo={`/companies/${encodeURIComponent(companyId)}/expenses/${encodeURIComponent(expenseId)}#wht-certificate`} />}
      {canEditAddress && <div className="space-y-1 border-t border-gray-100 pt-3">
        <p className="font-semibold">{text('address')}</p><p className="whitespace-pre-wrap break-words">{payeeAddress || text('no_address_warning')}</p>
        {!payeeAddress && row.payeeAddressClearedByTaxIdChange && <p>{text('address_cleared')}</p>}
        <button type="button" className={action === 'issue' && !payerMissing.length && !payeeAddress ? btnClass : ghostClass} disabled={busy || stale} aria-busy={false} onClick={() => { setAddress(payeeAddress); setRefusal(null); setDialog('address'); }}>{payeeAddress ? text('edit_address') : t('expenses.certificates.add_address', 'th')}</button>
      </div>}
      {action === 'issue' && !waitingPayment && !payerMissing.length && payeeAddress && (selectedPayment && onIssuePayment ? <WhtIssueButton handoff={row} busy={busy} label="ออกเลขที่และดาวน์โหลด" onIssue={() => onIssuePayment(row, selectedPayment.id)} /> : issueButton)}
      {action === 'download' && !primaryHidden && <button type="button" className={btnClass} disabled={busy} aria-busy={busy} onClick={() => onDownload(row)}>{text('download')}</button>}
      {action === 'record' && !waitingPayment && !issuer && <button type="button" className={btnClass} disabled={busy || stale} aria-busy={false} onClick={() => openRecord()}>{text('record')}</button>}
      {/* The pair is one group: one size, side by side when both names fit. */}
      {row?.status === 'EXTERNAL_LINKED' && row.canChangeExternalRecord && <ActionGroup align="start">
        <button type="button" className={ghostClass} disabled={busy || stale} aria-busy={false} onClick={() => { setRemoveReason(''); setRemoveVersion(row.updatedAt); setRefusal(null); setCommandId(crypto.randomUUID()); setDialog('remove-record'); }}>{text('remove_record')}</button>
        <button type="button" className={ghostClass} disabled={busy || stale} aria-busy={false} onClick={() => openRecord(true)}>{text('change_record')}</button>
      </ActionGroup>}
      {canLink && !waitingPayment && (action === 'issue' || (action === 'record' && issuer)) && <button type="button" className="block min-h-11 text-left font-semibold underline underline-offset-2" disabled={busy || stale} aria-busy={false} onClick={() => openRecord()}>{text('record')}</button>}
    </>}
    {(!payments || row?.status === 'SYSTEM_ISSUED' && row.id === handoff?.id) && children}
    {row && <ExpenseCertificateHistoryDisclosure plain label={text('history')} />}
    {/* The window names the thing; its two buttons name the two outcomes. Typed text is never lost by a stray press: ✕ and Escape ask first. */}
    <Modal open={dialog !== null} onClose={close} closeOnBackdrop={false} dirty={typed && !saving} size="sm"
      title={dialog === 'remove-record' ? <>{text('remove_title')} <span className={statusNumber.length > 30 ? undefined : 'mangmee-unit'}>{statusNumber}</span>?</> : text(dialog === 'address' ? (payeeAddress ? 'edit_address_title' : 'add_address_title') : dialog === 'change-record' ? 'change_record_title' : 'record')}
      footer={<>
        <button type="button" className={ghostClass} disabled={saving} aria-busy={false} onClick={close}>{dialog === 'remove-record' ? t('expenses.disbursement.cancel_delete', 'th') : t('common.cancel', 'th')}</button>
        <button form={`certificate-${expenseId}`} type="submit" className={dialog === 'remove-record' ? dangerClass : btnClass} disabled={saving} aria-busy={saving}>{text(dialog === 'remove-record' ? 'remove_submit' : 'save')}</button>
      </>}>
      <form id={`certificate-${expenseId}`} className="space-y-3" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
        {dialog === 'remove-record' ? <>
          <p>{text('remove_hint')}</p>
          <label className="block" htmlFor={`certificate-remove-reason-${expenseId}`}>{text('remove_reason')}
            <textarea id={`certificate-remove-reason-${expenseId}`} className={`${inputClass} mt-1`} rows={3} required minLength={3} maxLength={REASON_MAX_LENGTH} disabled={saving} aria-invalid={errorField === 'reason' || undefined} value={removeReason} onChange={event => { setRemoveReason(sanitizeReasonInput(event.target.value)); setRefusal(null); setCommandId(crypto.randomUUID()); }} />
          </label>
          {errorField === 'reason' && <FieldError>{dialogError}</FieldError>}
        </> : dialog === 'record' || dialog === 'change-record' ? <>
          {(['number', 'paymentDate', 'date', 'reference', 'note'] as const).map(field => <label key={field} className="block" htmlFor={`certificate-${field}-${expenseId}`}>
            <span className="block text-sm">{field === 'paymentDate' ? 'วันที่จ่ายตามหนังสือรับรองเดิม' : text(field)}</span>
            {field === 'date' || field === 'paymentDate' ? <ThemedDate id={`certificate-${field}-${expenseId}`} aria-label={field === 'paymentDate' ? 'วันที่จ่ายตามหนังสือรับรองเดิม' : text(field)} className={inputClass} value={values[field]} required max={todayCivilDate('Asia/Bangkok')} allowClear={false} disabled={saving} onChange={event => { setValues(v => ({ ...v, [field]: event.target.value })); setRefusal(null); setCommandId(crypto.randomUUID()); }} />
              : field === 'note' ? <textarea id={`certificate-${field}-${expenseId}`} aria-label={text(field)} className={inputClass} rows={3} maxLength={1000} disabled={saving} value={values[field]} onChange={event => { setValues(v => ({ ...v, [field]: event.target.value })); setRefusal(null); setCommandId(crypto.randomUUID()); }} />
              : <input id={`certificate-${field}-${expenseId}`} aria-label={text(field)} className={inputClass} type="text" required={field === 'number'} maxLength={field === 'number' ? 100 : field === 'reference' ? 500 : undefined} disabled={saving} aria-invalid={errorField === field || undefined} value={values[field]} onChange={event => { setValues(v => ({ ...v, [field]: event.target.value })); setRefusal(null); setCommandId(crypto.randomUUID()); }} />}
            {errorField === field && <FieldError>{dialogError}</FieldError>}
          </label>)}
        </> : <label className="block" htmlFor={`certificate-address-${expenseId}`}><span className="block text-sm">{text('address')}</span><textarea id={`certificate-address-${expenseId}`} className={inputClass} rows={4} required maxLength={WHT_HANDOFF_PAYEE_ADDRESS_MAX} disabled={saving} aria-invalid={errorField === 'address' || undefined} placeholder={WHT_PAYEE_ADDRESS_EXAMPLE} value={address} onChange={event => { setAddress(event.target.value); setRefusal(null); }} />
          {errorField === 'address' && <FieldError>{dialogError}</FieldError>}</label>}
        {dialogError && !errorField && <ErrorBanner message={dialogError} />}
      </form>
    </Modal>
  </MangmeeCard>;
}
