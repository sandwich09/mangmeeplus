'use client';

import { useEffect, useRef, useState } from 'react';
import type { DisbursementVoucherSupportingFile } from '@watchdog-bms/contracts';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { Modal } from '@/common/components/modal';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { useUnsavedNavigation } from '@/common/components/unsaved-navigation/use-unsaved-navigation';
import { ATTACHMENT_UPLOAD_ACCEPT } from '@/common/files/upload-file.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { ghostClass } from '../ExpensesUi';
import { attachDisbursementSupportingFile, fetchDisbursementSupportingBlob, listDisbursementSupportingFiles, removeDisbursementSupportingFile, uploadDisbursementSupportingFile } from './disbursement-vouchers.api';

type PendingFile = { file: File; attachmentId?: string };
export function DisbursementVoucherSupportingFiles({ companyId, id: shownId, editable = false, initialFiles, saveDraft, onDraftSaved }: {
  companyId: string; id?: string; editable?: boolean; initialFiles?: DisbursementVoucherSupportingFile[];
  /** A new voucher: choosing a file saves the draft first and answers its id (null when the save was refused). */
  saveDraft?: () => Promise<string | null>; onDraftSaved?: (id: string) => void;
}) {
  const [files, setFiles] = useState(initialFiles ?? []);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(shownId && !initialFiles));
  const [preview, setPreview] = useState<DocumentPreviewSource | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string>();
  const id = shownId ?? savedId;
  const picker = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null);
  const locked = useRef(false), previewUrl = useRef<string | null>(null);
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  const reload = async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try { setFiles(await listDisbursementSupportingFiles(companyId, id)); }
    catch (failure) { setError(apiErrorMessage(failure)); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (initialFiles) setFiles(initialFiles); else void reload(); }, [companyId, id, initialFiles]);
  const upload = async (queue = pending, target = id) => {
    if (!target || locked.current || !editable) return false;
    locked.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      for (const item of queue) {
        item.attachmentId ??= await uploadDisbursementSupportingFile(companyId, target, item.file);
        setFiles(await attachDisbursementSupportingFile(companyId, target, item.attachmentId));
        setPending(previous => previous.filter(p => p !== item));
      }
      setNotice('แนบเอกสารประกอบการจ่ายแล้ว'); return true;
    } catch (failure) { setError(apiErrorMessage(failure)); return false; }
    finally { locked.current = false; setBusy(false); }
  };
  const discardPending = async (queue: PendingFile[]) => {
    if (!id || locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      for (const item of queue) {
        // Attachment may have committed even if its response was lost. Unlink before discarding.
        if (item.attachmentId) setFiles(await removeDisbursementSupportingFile(companyId, id, item.attachmentId));
        setPending(previous => previous.filter(p => p !== item));
      }
    } catch (failure) { setError(apiErrorMessage(failure)); }
    finally { locked.current = false; setBusy(false); }
  };
  const navigation = useUnsavedNavigation({ dirty: pending.length > 0, canSave: true, saving: busy, error, onSave: () => upload(),
    description: 'ไฟล์ที่ยังแนบไม่ครบจะไม่ถูกเก็บ หากออกจากหน้านี้' });
  const pick = async (chosen: FileList | null) => {
    if (!chosen?.length || locked.current) return;
    const queue = Array.from(chosen, file => ({ file }));
    if (id) { setPending(queue); void upload(queue); return; }
    locked.current = true; setBusy(true);
    const created = await saveDraft?.().catch(() => null) ?? null;
    locked.current = false; setBusy(false);
    if (!created) return; // The page shows why the draft could not be saved.
    setSavedId(created); setPending(queue); await upload(queue, created); onDraftSaved?.(created);
  };
  const open = async (file: DisbursementVoucherSupportingFile) => {
    if (!id || locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      const blob = await fetchDisbursementSupportingBlob(companyId, id, file.id);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = URL.createObjectURL(blob); setPreview({ name: file.name, mimeType: blob.type, url: previewUrl.current });
    } catch (failure) { setError(apiErrorMessage(failure)); }
    finally { locked.current = false; setBusy(false); }
  };
  const remove = async (file: DisbursementVoucherSupportingFile) => {
    if (!id || locked.current || !editable) return;
    locked.current = true; setBusy(true); setError(null);
    try { setFiles(await removeDisbursementSupportingFile(companyId, id, file.id)); setNotice('เอาไฟล์ประกอบการจ่ายออกแล้ว'); }
    catch (failure) { setError(apiErrorMessage(failure)); }
    finally { locked.current = false; setBusy(false); }
  };
  return <div className="grid gap-3" data-testid="disbursement-supporting-files">
    {editable ? <><h3 className="text-sm leading-relaxed font-medium">แนบไฟล์ประกอบการจ่าย (ถ้ามี)</h3>
      <p className="text-sm leading-relaxed text-gray-500">เช่น รูปหน้าสมุดบัญชีหรือ QR ของผู้รับ ใบแจ้งหนี้ หรือรูปเช็ค</p>
      <ActionGroup align="start">
        <button type="button" className={ghostClass} disabled={busy || loading} aria-busy={busy || loading} onClick={() => camera.current?.click()}>ถ่ายรูป</button>
        <button type="button" className={ghostClass} disabled={busy || loading} aria-busy={busy || loading} onClick={() => picker.current?.click()}>เลือกไฟล์</button>
      </ActionGroup>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" aria-label="ถ่ายรูปประกอบการจ่าย" onChange={event => { void pick(event.target.files); event.target.value = ''; }} />
      <input ref={picker} type="file" multiple accept={ATTACHMENT_UPLOAD_ACCEPT} className="hidden" aria-label="เลือกไฟล์ประกอบการจ่าย" onChange={event => { void pick(event.target.files); event.target.value = ''; }} />
    </> : <p>ไฟล์ประกอบ {files.length} ไฟล์</p>}
    {loading && <p role="status">กำลังอ่านไฟล์ประกอบการจ่าย</p>}
    {files.map(file => <div key={file.id} className="flex flex-wrap items-center gap-3">
      <SupportingThumbnail companyId={companyId} id={id!} file={file} />
      <div className="min-w-0 flex-1"><p className="break-words">{file.name}</p><p className="text-sm leading-relaxed text-gray-500">{file.uploadedByName ?? 'ไม่พบชื่อผู้แนบ'} · <span className="whitespace-nowrap">{formatThaiDateTime(file.uploadedAt)}</span></p></div>
      <ActionGroup><button type="button" className={ghostClass} disabled={busy || loading} aria-busy={busy || loading} onClick={() => void open(file)}>ดูไฟล์</button>
        {editable && <button type="button" className={ghostClass} disabled={busy || loading} aria-busy={busy || loading} onClick={() => void remove(file)}>เอาออก</button>}</ActionGroup>
    </div>)}
    {notice && <p role="status" className="text-sm leading-relaxed text-green-700">{notice}</p>}
    {error && pending.length === 0 && <div><p role="alert">{error}</p>{id && <a className={ghostClass} href={`/companies/${companyId}/expenses/disbursement-vouchers/${encodeURIComponent(id)}`}>เปิดใบนี้</a>}<button type="button" className={ghostClass} disabled={busy || loading} aria-busy={busy || loading} onClick={() => void reload()}>ลองอีกครั้ง</button></div>}
    <Modal open={pending.length > 0} title="เอกสารประกอบการจ่าย" dirty={pending.length > 0} onClose={() => void discardPending(pending)} closeOnBackdrop={false}
      footer={<button type="button" className={ghostClass} disabled={busy || loading} aria-busy={busy || loading} onClick={() => void upload()}>ลองอีกครั้ง</button>}>
      {busy && <p role="status">กำลังแนบไฟล์ประกอบการจ่าย</p>}
      {pending.map((item, index) => <div key={index} className="flex flex-wrap items-center gap-3"><span className="min-w-0 flex-1 break-words">{item.file.name}</span><button type="button" className={ghostClass} disabled={busy || loading} aria-busy={busy || loading} onClick={() => void discardPending([item])}>เอาออก</button></div>)}
      {error && <><p role="alert">{error} ไฟล์ที่เลือกยังอยู่ ลองอีกครั้งหรือเอาออก</p>{id && <a className={ghostClass} href={`/companies/${companyId}/expenses/disbursement-vouchers/${encodeURIComponent(id)}`}>เปิดใบนี้</a>}</>}
    </Modal>
    {preview && <DocumentPreviewModal source={preview} closeLabel="ปิด" loadingLabel="กำลังเปิดไฟล์" errorLabel="เปิดไฟล์ไม่ได้ ลองอีกครั้ง" retryLabel="ลองอีกครั้ง" openNewTabLabel="เปิดไฟล์ในหน้าต่างใหม่" zoomOutLabel="ย่อ" zoomInLabel="ขยาย" resetZoomLabel="ขนาดเดิม" onClose={() => { setPreview(null); if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; }} />}
    {navigation.dialog}
  </div>;
}

function SupportingThumbnail({ companyId, id, file }: { companyId: string; id: string; file: DisbursementVoucherSupportingFile }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.mimeType.startsWith('image/')) return;
    let active = true, objectUrl: string | undefined;
    void fetchDisbursementSupportingBlob(companyId, id, file.id).then(blob => {
      if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    }).catch(() => {}); // The view action reports access/download failures; a thumbnail is optional.
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [companyId, id, file.id, file.mimeType]);
  return <>{url && <img src={url} alt="" className="hidden h-16 w-16 object-cover sm:block" />}<svg aria-hidden="true" className={`${url ? 'sm:hidden ' : ''}h-8 w-8 text-gray-500`} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h8" /></svg></>;
}
