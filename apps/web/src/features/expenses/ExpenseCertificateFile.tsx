'use client';

import { useEffect, useRef, useState } from 'react';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { fetchSignedPreviewBlob, getExternalWhtFile } from './expenses.api';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { ghostClass, err } from './ExpensesUi';

export function ExpenseCertificateFile({ companyId, handoffId, attachmentId }: { companyId: string; handoffId: string; attachmentId: string }) {
  const inFlight = useRef(false);
  const generation = useRef(0);
  const previewUrl = useRef<string | null>(null);
  useEffect(() => () => { generation.current++; if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  const [preview, setPreview] = useState<DocumentPreviewSource | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closePreview = () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null; setPreview(null);
  };
  async function open() {
    if (inFlight.current) return;
    const held = generation.current;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const file = await getExternalWhtFile(companyId, handoffId, attachmentId);
      const blob = await fetchSignedPreviewBlob(file.downloadUrl, file.mimeType);
      if (held !== generation.current) return;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = URL.createObjectURL(blob);
      setPreview({ name: file.name, mimeType: blob.type, url: previewUrl.current });
    } catch (cause) { if (held === generation.current) setError(err(cause)); }
    finally { inFlight.current = false; if (held === generation.current) setBusy(false); }
  }
  return <span className="inline-flex flex-wrap items-center gap-2" onClick={event => event.stopPropagation()}>
    <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => void open()}>ดูไฟล์</button>
    {preview && <DocumentPreviewModal source={preview} closeLabel="ปิด" loadingLabel="กำลังเปิดไฟล์" errorLabel="เปิดไฟล์ไม่ได้ ลองอีกครั้ง" retryLabel="ลองอีกครั้ง" openNewTabLabel="เปิดในแท็บใหม่" onClose={closePreview} onRetry={open}
      zoomOutLabel={t('expenses.disbursement.slip_zoom_out', 'th')} zoomInLabel={t('expenses.disbursement.slip_zoom_in', 'th')} resetZoomLabel={t('expenses.disbursement.slip_zoom_reset', 'th')} />}
    {error && <span role="alert" className="text-sm text-error-700">{error}</span>}
  </span>;
}
