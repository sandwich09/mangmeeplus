'use client';

import { useEffect, useRef, useState } from 'react';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { Modal } from '@/common/components/modal';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { CoverLoader } from '@/common/components/state';
import { ATTACHMENT_UPLOAD_ACCEPT } from '@/common/files/upload-file.logic';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { btnClass, ghostClass } from '../ExpensesUi';
import { uploadDisbursementVoucherSlip, attachDisbursementVoucherSlip, fetchDisbursementVoucherSlipBlob } from './disbursement-vouchers.api';
import type { DisbursementVoucherDetail } from './disbursement-vouchers.model';
import styles from './disbursement-vouchers.module.css';

const word = (key: string) => t(`expenses.disbursement.${key}` as DictionaryKey, 'th');
export function DisbursementVoucherSlip({ companyId, id, slip: initialSlip, canAttach, paymentForm = false, disabled = false, refusal = null, onChange, onBusy }: {
  companyId: string; id: string; slip: DisbursementVoucherDetail['slip']; canAttach: boolean; paymentForm?: boolean;
  disabled?: boolean; refusal?: unknown; onChange?: (attachmentId: string | undefined) => void; onBusy?: (busy: boolean) => void;
}) {
  const [slip, setSlip] = useState(initialSlip);
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ failure: unknown; upload: boolean } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<DocumentPreviewSource | null>(null);
  const [localPreview, setLocalPreview] = useState<DocumentPreviewSource | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const previewUrl = useRef<string | null>(null);
  useEffect(() => () => { generation.current++; if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  useEffect(() => {
    setSlip(initialSlip); setFile(null); setUploaded(null);
  }, [initialSlip]);
  useEffect(() => {
    if (!file) { setLocalPreview(null); return; }
    const url = URL.createObjectURL(file);
    setLocalPreview({ name: file.name, mimeType: file.type, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const closePreview = () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null; setPreview(null);
  };
  const open = async () => {
    if (inFlight.current) return;
    const held = generation.current; inFlight.current = true; setBusy(true); setError(null);
    try {
      const blob = await fetchDisbursementVoucherSlipBlob(companyId, id);
      if (held !== generation.current) return;
      closePreview(); previewUrl.current = URL.createObjectURL(blob);
      setPreview({ name: word('slip_view'), mimeType: blob.type, url: previewUrl.current });
    } catch (failure) { if (held === generation.current) setError({ failure, upload: false }); }
    finally { if (held === generation.current) { inFlight.current = false; setBusy(false); } }
  };
  const choose = async (next: File | null, retry = false) => {
    if (inFlight.current || disabled || !canAttach) return;
    closePreview(); setError(null); setFile(next); if (!retry) setUploaded(null); onChange?.(undefined);
    if (!next) return;
    const held = generation.current; inFlight.current = true; setBusy(true); onBusy?.(true);
    try {
      const attachmentId = retry && uploaded ? uploaded : await uploadDisbursementVoucherSlip(companyId, id, next);
      if (held !== generation.current) return;
      setUploaded(attachmentId);
      if (paymentForm) onChange?.(attachmentId);
      else {
        const answer = await attachDisbursementVoucherSlip(companyId, id, attachmentId);
        if (held !== generation.current) return;
        closePreview(); setSlip(answer.slip); setFile(null); setUploaded(null);
      }
    } catch (failure) { if (held === generation.current) setError({ failure, upload: true }); }
    finally { if (held === generation.current) { inFlight.current = false; setBusy(false); onBusy?.(false); } }
  };
  const invalidFile = apiErrorCode(error?.failure) === 'disbursement_slip_invalid';
  const shownError = refusal ?? error?.failure ?? null;
  const askToPick = () => { if (slip && !paymentForm) setConfirmOpen(true); else picker.current?.click(); };
  return <section className={paymentForm ? styles.payDate : styles.stack} data-testid="disbursement-voucher-slip">
    {paymentForm && <label htmlFor="disbursement-slip" className="text-sm font-medium text-gray-700">แนบหลักฐานการจ่าย (ถ้ามี)</label>}
    {/* The evidence is one statement with its buttons beside it. A paid document without evidence says so: attaching later is allowed, and a lone button would read as an unfinished step. */}
    <div className={paymentForm ? styles.stack : styles.statementRow}>
    {slip && <p>{word('slip_attached').replace('{name}', slip.attachedByName ?? word('removed_member')).replace('{time}', formatThaiDateTime(slip.attachedAt))}</p>}
    {!paymentForm && !slip && !file && <p>หลักฐานการจ่าย · ยังไม่ได้แนบ</p>}
    {(slip || canAttach) && <CoverLoader active={busy} scope="section" label={word(file ? 'slip_uploading' : 'slip_opening')}>
      {(slip || canAttach && !paymentForm && !file) && <ActionGroup>
        {slip && <button type="button" className={ghostClass} disabled={busy || disabled} aria-busy={busy} onClick={() => void open()}>ดูไฟล์</button>}
        {/* The statement beside these buttons already names the evidence: a short name fits half a phone row. */}
        {canAttach && !paymentForm && !file && <button type="button" className={ghostClass} disabled={busy || disabled} aria-busy={busy} onClick={askToPick}>{word(slip ? 'slip_change' : 'slip_attach')}</button>}
      </ActionGroup>}
      {canAttach && <ThemedFile id="disbursement-slip" inputRef={picker} className={!paymentForm && !file ? styles.slipPickerHidden : styles.slipInput}
        file={file} accept={ATTACHMENT_UPLOAD_ACCEPT} disabled={busy || disabled} loading={busy} aria-label="แนบหลักฐานการจ่าย (ถ้ามี)"
        labels={{ pick: word('slip_attach'), change: word('slip_change'), clear: word('slip_remove'), loading: word('slip_uploading') }}
        onChange={next => void choose(next)} />}
    </CoverLoader>}
    </div>
    {file && localPreview && <div className="flex min-w-0 flex-wrap items-center gap-3" data-testid="disbursement-local-slip">
      {file.type.startsWith('image/') ? <img src={localPreview.url} alt={file.name} className="h-16 w-16 rounded-md object-cover" />
        : <svg aria-hidden="true" className="h-10 w-10 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h8" /></svg>}
      <span className="min-w-0 flex-1 break-all text-sm">{file.name}</span>
      <ActionGroup>
        <button type="button" className={ghostClass} onClick={() => setPreview(localPreview)}>ดูไฟล์</button>
        <button type="button" className={ghostClass} disabled={busy || disabled} aria-busy={busy} onClick={() => void choose(null)}>เอาออก</button>
      </ActionGroup>
    </div>}
    {busy && <p role="status" className={styles.muted}>{word(file ? 'slip_uploading' : 'slip_opening')}</p>}
    {shownError !== null && <div className={styles.stack}>
      {error?.upload && !invalidFile && <p className={styles.error}>{word('slip_failed')}</p>}
      <p role="alert" className={styles.error}>{apiErrorMessage(shownError).replaceAll('สลิป', 'หลักฐานการจ่าย')}</p>
      {paymentForm && <p className={styles.muted}>{word('slip_without')}</p>}
      {file && !invalidFile && <button type="button" className={ghostClass} disabled={busy || disabled} aria-busy={busy} onClick={() => void choose(file, true)}>{word('slip_retry')}</button>}
    </div>}
    <Modal open={confirmOpen} title={`${word('slip_replace')}?`} size="sm" onClose={() => setConfirmOpen(false)} closeOnBackdrop={false}
      footer={<>
        <button type="button" className={ghostClass} onClick={() => setConfirmOpen(false)}>{word('slip_keep')}</button>
        <button type="button" className={btnClass} onClick={() => { setConfirmOpen(false); picker.current?.click(); }}>{word('slip_replace')}</button>
      </>}><p>{word('slip_replace_confirm')}</p></Modal>
    {preview && <DocumentPreviewModal source={preview} closeLabel={t('common.close', 'th')} loadingLabel={word('slip_opening')}
      errorLabel={word('slip_preview_failed')} retryLabel={word('slip_retry')} openNewTabLabel={word('slip_new_tab')}
      onClose={closePreview} onRetry={localPreview && preview.url === localPreview.url ? undefined : () => void open()} zoomOutLabel={word('slip_zoom_out')} zoomInLabel={word('slip_zoom_in')} resetZoomLabel={word('slip_zoom_reset')} />}
  </section>;
}
