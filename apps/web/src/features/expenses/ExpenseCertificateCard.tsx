'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { WHT_EXTERNAL_RECORD_WORDS, isExpenseVoidReason, whtPayerIdentityMissingMessage, whtPayeeAddress, WHT_HANDOFF_PAYEE_ADDRESS_MISSING_MESSAGE, WHT_HANDOFF_MISSING_LABELS, WHT_HANDOFF_PAYEE_ADDRESS_MAX, isCivilDate, todayCivilDate, type WhtCertificateHandoffDto, type WhtCertificateHandoffListRowDto } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeeBadge } from '@/common/components/mangmee';
import { REASON_MAX_LENGTH, sanitizeReasonInput } from '@/common/forms/sanitize';
import { Modal } from '@/common/components/modal/Modal';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { useToast } from '@/common/components/toast/use-toast';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { formatMessage } from '@/common/i18n/error-message.logic';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { listWhtHandoffsPaged, removeExternalWhtCertificate, changeExternalWhtCertificate, linkExternalWhtCertificate, setWhtHandoffPayeeAddress } from './expenses.api';
import { btnClass, dangerClass, ghostClass, inputClass, err, ErrorBanner } from './ExpensesUi';
import { ExpenseCertificateHistoryDisclosure, ExpenseCertificateHistoryNotice, ExpenseCertificateExternalRecordNotice, useExpenseCertificateHistoryRefresh } from './ExpenseCertificateHistory';
import { certificateCardAction, certificateRecordRefusal, selfIssuedCertificateBody, type SelfIssuedCertificateValues } from './expense-certificate-card.logic';

import { WhtPayerIdentityNotice } from './WhtPayerIdentityNotice';
import { ExpensePreviousCertificate } from './ExpensePreviousCertificate';

const text = (key: string) => t(`expenses.certificate_card.${key}` as DictionaryKey, 'th');
export function ExpenseCertificateCard({ companyId, expenseId, revision, handoff, permissions, issueButton, onDownload, busy, error, onChanged, onClearError, primaryHidden = false, children }: {
  companyId: string; expenseId: string; revision: string; handoff: WhtCertificateHandoffDto | null; permissions: string[];
  issueButton: ReactNode; onDownload: () => void; busy: boolean; error: string | null; onChanged: (handoff: WhtCertificateHandoffDto) => void; onClearError?: () => void; primaryHidden?: boolean; children?: ReactNode;
}) {
  const [read, setRead] = useState<{ row: WhtCertificateHandoffListRowDto | null; loading: boolean; error: string | null }>({ row: null, loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<'record' | 'change-record' | 'remove-record' | 'address' | null>(null);
  const [values, setValues] = useState<SelfIssuedCertificateValues>({ number: '', date: todayCivilDate('Asia/Bangkok'), reference: '', note: '' });
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [commandId, setCommandId] = useState('');
  const [removeReason, setRemoveReason] = useState('');
  const [removeVersion, setRemoveVersion] = useState('');
  const submitting = useRef(false);
  const toast = useToast();
  const refreshHistory = useExpenseCertificateHistoryRefresh();
  // A completed command already knows the certificate identity; the read fills in its full details.
  const issued = handoff?.status === 'SYSTEM_ISSUED' && handoff.certificateNumber && handoff.certificateId !== read.row?.certificateId;
  const row = issued && read.row ? { ...read.row, ...handoff } : read.row;
  useEffect(() => {
    let cancelled = false;
    setRead({ row, loading: true, error: null });
    listWhtHandoffsPaged(companyId, { sourcePaymentId: expenseId, page: 1, pageSize: 100 })
      .then(result => { if (!cancelled) {
        const row = result.rows.find(row => row.status !== 'CANCELLED') ?? null;
        setRead({ row, loading: false, error: row ? null : text('unavailable') });
        if (row) onChanged(row);
      } })
      .catch(cause => { if (!cancelled) setRead(previous => ({ ...previous, loading: false, error: err(cause) })); });
    return () => { cancelled = true; };
  }, [companyId, expenseId, revision, handoff?.status, handoff?.certificateId, attempt]);
  // The page has just issued or replaced the certificate and this card is still re-reading: the old status would be untrue beside the success toast.
  const stale = read.loading && !!row && !!handoff && (handoff.status !== row.status || (handoff.certificateId ?? null) !== (row.certificateId ?? null));
  const loaded = !!row;
  // "เพิ่มที่อยู่" on the list lands here, not at the top of a long page.
  useEffect(() => { if (loaded && (globalThis.location?.hash === '#wht-certificate' || new URLSearchParams(globalThis.location?.search ?? '').get('section') === 'wht-certificate')) document.getElementById('wht-certificate')?.scrollIntoView(); }, [loaded]);
  useEffect(() => { if (error === WHT_HANDOFF_PAYEE_ADDRESS_MISSING_MESSAGE || [['TAX_ID'], ['ADDRESS'], ['TAX_ID', 'ADDRESS']].some(missing => error === whtPayerIdentityMissingMessage(missing as ('TAX_ID' | 'ADDRESS')[]))) setAttempt(value => value + 1); }, [error]);
  const action = row ? certificateCardAction(row, permissions) : null;
  const payerMissing = row?.payerMissing ?? [];
  const canLink = permissions.includes('wht.external_certificate.link');
  const issuer = !!row?.systemIssuanceOpen && permissions.includes('wht.certificate.issue');
  const payeeAddress = whtPayeeAddress(row?.payeeAddress, row?.prefill.payeeSnapshot.address) || '';
  const canEditAddress = row?.status === 'REQUIRED' && permissions.some(p => ['wht.external_certificate.link', 'wht.certificate.issue'].includes(p));
  const openRecord = (change = false) => {
    setValues(change && row ? { number: row.externalCertificateNumber ?? '', date: row.externalIssuedDate?.slice(0, 10) ?? '', reference: row.externalEvidenceRef ?? '', note: row.linkNote ?? '' } : { number: '', date: todayCivilDate('Asia/Bangkok'), reference: '', note: '' });
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
        if (!isExpenseVoidReason(removeReason) || removeReason.trim().length > REASON_MAX_LENGTH) throw Error(WHT_EXTERNAL_RECORD_WORDS.removeInvalid);
        const result = await removeExternalWhtCertificate(companyId, row.id, { commandId, expectedUpdatedAt: removeVersion, reason: removeReason.trim() });
        const updated = { ...row, ...result, previousCertificate: result.previousCertificate };
        setRead({ row: updated, loading: false, error: null }); onChanged(updated);
        toast.success(text('removed'));
      } else if (dialog === 'record' || dialog === 'change-record') {
        const body = selfIssuedCertificateBody(values, commandId);
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
  const missing = row?.missing.map(reason => WHT_HANDOFF_MISSING_LABELS[reason]).join(' และ ') ?? '';
  const number = row?.currentCertificate?.number ?? row?.certificateNumber ?? row?.externalCertificateNumber ?? '—';
  const date = row?.currentCertificate?.issuedAt ?? row?.certificateIssuedAt ?? row?.externalIssuedDate;
  const status = row?.status === 'SYSTEM_ISSUED' ? formatMessage(text('issued'), { number, date: date ? formatThaiDate(date) : '—' })
    : row?.status === 'EXTERNAL_LINKED' ? formatMessage(text('external'), { number: row.externalCertificateNumber ?? '—', date: row.externalIssuedDate ? formatThaiDate(row.externalIssuedDate) : '—' })
    : missing && issuer ? formatMessage(text('incomplete'), { missing })
    : action === 'record' && !issuer ? text('external_pending') : missing ? formatMessage(text('incomplete'), { missing }) : text('pending');
  const statusNumber = row?.status === 'EXTERNAL_LINKED' ? row.externalCertificateNumber ?? '—' : number;
  const statusNumberUnit = `เลขที่ ${statusNumber}`;
  const statusNumberIndex = ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'].includes(row?.status ?? '') ? status.indexOf(statusNumberUnit) : -1;
  // Every button of the card has one width: the full card on a phone, one fixed width on a wide screen.
  return <MangmeeCard className="min-w-0 space-y-3 p-4 text-sm text-gray-700 [&_.mangmee-btn]:w-full sm:[&_.mangmee-btn]:max-w-64">
    <h2 id="wht-certificate" className="scroll-mt-60 text-base font-semibold leading-6 text-gray-900">{text('heading')}</h2>
    {read.loading && <p role="status" className="text-sm text-gray-600">{row ? text('refreshing') : t('expenses.loading', 'th')}</p>}
    {read.error && <div className="space-y-2"><ErrorBanner message={read.error} /><button type="button" className={ghostClass} onClick={retry}>{t('expenses.substitute_wizard.retry', 'th')}</button></div>}
    {row && <>
      {!stale && <p className="break-words leading-6" role="status"><MangmeeBadge tone={row?.status === 'SYSTEM_ISSUED' ? 'brand' : row?.status === 'EXTERNAL_LINKED' ? 'sky' : 'amber'} className="max-w-full !text-sm !leading-6 text-left"><span>{statusNumberIndex < 0 ? status : <>{status.slice(0, statusNumberIndex)}<span className="inline-block max-w-full">เลขที่ <span className={statusNumber.length > 30 ? undefined : 'whitespace-nowrap'}>{statusNumber}</span></span>{' '}<span className="whitespace-nowrap">{status.slice(statusNumberIndex + statusNumberUnit.length).trim()}</span></>}</span></MangmeeBadge></p>}
      {row?.status === 'SYSTEM_ISSUED' && <p>{text('issued_next')}</p>}
      {row?.status === 'REQUIRED' && (row.previousCertificate ? <ExpensePreviousCertificate previous={row.previousCertificate} /> : <><ExpenseCertificateHistoryNotice placement="issue" /><ExpenseCertificateExternalRecordNotice /></>)}
      {row?.status === 'EXTERNAL_LINKED' && <div className="space-y-1 break-words">
        {row.externalEvidenceRef && <p>{formatMessage(text('reference_value'), { reference: row.externalEvidenceRef })}</p>}
        {row.linkNote && <p className="whitespace-pre-wrap">{formatMessage(text('note_value'), { note: row.linkNote })}</p>}
        <p>{text('no_file')}</p>
      </div>}
      <ExpenseCertificateHistoryDisclosure plain label={text('history')} />
      {row?.status === 'REQUIRED' && missing && <div className="space-y-1 leading-6">{row.missing.map(reason => <p key={reason}>{WHT_HANDOFF_MISSING_LABELS[reason]}</p>)}{issuer && <p>{text('edit_hint')}</p>}</div>}
    </>}
    {error && !read.error && <div className="space-y-2"><ErrorBanner message={error} /><button type="button" className={ghostClass} onClick={retry}>{t('expenses.substitute_wizard.retry', 'th')}</button></div>}
    {row && !read.error && <>
      {action === 'issue' && payerMissing.length > 0 && <WhtPayerIdentityNotice companyId={companyId} missing={payerMissing} permissions={permissions} primary returnTo={`/companies/${encodeURIComponent(companyId)}/expenses/${encodeURIComponent(expenseId)}#wht-certificate`} />}
      {canEditAddress && <div className="space-y-1 border-t border-gray-100 pt-3">
        <p className="font-semibold">{text('address')}</p><p className="whitespace-pre-wrap break-words">{payeeAddress || text('no_address_warning')}</p>
        {!payeeAddress && row.payeeAddressClearedByTaxIdChange && <p>{text('address_cleared')}</p>}
        <button type="button" className={action === 'issue' && !payerMissing.length && !payeeAddress ? `${btnClass} w-full sm:w-auto` : ghostClass} disabled={busy || stale} aria-busy={false} onClick={() => { setAddress(payeeAddress); setRefusal(null); setDialog('address'); }}>{payeeAddress ? text('edit_address') : t('expenses.certificates.add_address', 'th')}</button>
      </div>}
      {action === 'issue' && !payerMissing.length && payeeAddress && issueButton && <div className="[&>button]:w-full sm:[&>button]:w-auto">{issueButton}</div>}
      {action === 'download' && !primaryHidden && <button type="button" className={`${btnClass} w-full sm:w-auto`} disabled={busy} aria-busy={busy} onClick={onDownload}>{t('expenses.certificates.download', 'th')}</button>}
      {action === 'record' && !issuer && <button type="button" className={`${btnClass} w-full sm:w-auto`} disabled={busy || stale} aria-busy={false} onClick={() => openRecord()}>{text('record')}</button>}
      {row?.status === 'EXTERNAL_LINKED' && row.canChangeExternalRecord && <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <button type="button" className={ghostClass} disabled={busy || stale} aria-busy={false} onClick={() => openRecord(true)}>{text('change_record')}</button>
        <button type="button" className={ghostClass} disabled={busy || stale} aria-busy={false} onClick={() => { setRemoveReason(''); setRemoveVersion(row.updatedAt); setRefusal(null); setCommandId(crypto.randomUUID()); setDialog('remove-record'); }}>{text('remove_record')}</button>
      </div>}
      {canLink && (action === 'issue' || (action === 'record' && issuer)) && <button type="button" className="block min-h-11 text-left font-semibold underline underline-offset-2" disabled={busy || stale} aria-busy={false} onClick={() => openRecord()}>{text('record')}</button>}
    </>}
    {children}
    <Modal open={dialog !== null} onClose={close} closeOnBackdrop={false} size="sm" title={text(dialog === 'remove-record' ? 'remove_title' : dialog === 'address' ? (payeeAddress ? 'edit_address_title' : 'add_address_title') : dialog === 'change-record' ? 'change_record_title' : 'record')}
      footer={<div className="grid w-full gap-2 sm:ml-auto sm:w-max sm:max-w-full sm:auto-cols-[minmax(8rem,1fr)] sm:grid-flow-col" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {dialog === 'remove-record' && <button type="button" className={`${ghostClass} w-full`} disabled={saving} aria-busy={false} onClick={close}>{text('close')}</button>}
        <button form={`certificate-${expenseId}`} type="submit" className={`${dialog === 'remove-record' ? dangerClass : btnClass} w-full`} disabled={saving || (dialog === 'remove-record' && !isExpenseVoidReason(removeReason))} aria-busy={saving}>{text(dialog === 'remove-record' ? 'remove_submit' : 'save')}</button>
      </div>}>
      <form id={`certificate-${expenseId}`} className="space-y-3" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
        {dialog === 'remove-record' ? <>
          <p className="break-words"><span className="inline-block max-w-full">เลขที่ <span className={statusNumber.length > 30 ? undefined : 'whitespace-nowrap'}>{statusNumber}</span></span></p>
          <p>{text('remove_hint')}</p>
          <label className="block" htmlFor={`certificate-remove-reason-${expenseId}`}>{text('remove_reason')}
            <textarea id={`certificate-remove-reason-${expenseId}`} className={inputClass} rows={3} required minLength={3} maxLength={REASON_MAX_LENGTH} disabled={saving} value={removeReason} onChange={event => { setRemoveReason(sanitizeReasonInput(event.target.value)); setRefusal(null); setCommandId(crypto.randomUUID()); }} />
          </label>
        </> : dialog === 'record' || dialog === 'change-record' ? <>
          {(['number', 'date', 'reference', 'note'] as const).map(field => <label key={field} className="block" htmlFor={`certificate-${field}-${expenseId}`}>
            <span className="block text-sm">{text(field)}</span>
            {field === 'date' ? <ThemedDate id={`certificate-${field}-${expenseId}`} className={inputClass} value={values.date} max={todayCivilDate('Asia/Bangkok')} allowClear={false} disabled={saving} onChange={event => { setValues(v => ({ ...v, date: event.target.value })); setRefusal(null); setCommandId(crypto.randomUUID()); }} />
              : field === 'note' ? <textarea id={`certificate-${field}-${expenseId}`} className={inputClass} rows={3} maxLength={1000} disabled={saving} value={values[field]} onChange={event => { setValues(v => ({ ...v, [field]: event.target.value })); setRefusal(null); setCommandId(crypto.randomUUID()); }} />
              : <input id={`certificate-${field}-${expenseId}`} className={inputClass} type="text" required={field === 'number'} maxLength={field === 'number' ? 100 : field === 'reference' ? 500 : undefined} disabled={saving} value={values[field]} onChange={event => { setValues(v => ({ ...v, [field]: event.target.value })); setRefusal(null); setCommandId(crypto.randomUUID()); }} />}
          </label>)}
        </> : <label className="block" htmlFor={`certificate-address-${expenseId}`}><span className="block text-sm">{text('address')}</span><textarea id={`certificate-address-${expenseId}`} className={inputClass} rows={4} required maxLength={WHT_HANDOFF_PAYEE_ADDRESS_MAX} disabled={saving} value={address} onChange={event => { setAddress(event.target.value); setRefusal(null); }} /></label>}
        {dialogError && <ErrorBanner message={dialogError} />}
      </form>
    </Modal>
  </MangmeeCard>;
}
