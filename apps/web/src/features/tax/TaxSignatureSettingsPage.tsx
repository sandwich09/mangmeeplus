'use client';

import { SIGNATURE_FILE_TYPES_LABEL } from '@watchdog-bms/contracts';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { primaryButtonClass } from '@/common/components/button/button-classes';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { ChoiceRow } from '@/common/components/field/ChoiceRow';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { Notice } from '@/common/components/notice';
import { ErrorState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { getTaxSignature, updateTaxSignature, uploadCompanyTaxSignatureAttachment, type CompanyTaxSignature } from './tax.api';


/**
 * WHT certificate system issuance plan §3.3 (Decision B): the company's authorized-signatory
 * signature for the 50 ทวิ PDF — a company-level setting, deliberately NOT the personal signature
 * library (`CompanySignatureAsset`). OWNER-only: the route/menu that reaches this page must gate on
 * `company.tax_signature.manage`, not `tax.profile.manage` (which FINANCE/ACCOUNTANT already hold).
 * v1 is signature-only (Decision A) — there is no seal/stamp control here at all.
 */
export function TaxSignatureSettingsPage({ companyId, permissions }: { companyId: string; permissions: string[] }) {
  const toast = useToast();
  const canManage = permissions.includes('company.tax_signature.manage');
  const [profile, setProfile] = useState<CompanyTaxSignature | null>(null);
  const [mode, setMode] = useState<'BLANK' | 'AUTO_STAMP'>('BLANK');
  const [pendingAttachmentId, setPendingAttachmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const loadRequest = useRef(0);

  const load = useCallback(async (reset = true) => {
    const request = ++loadRequest.current;
    setLoading(true); setProfile(null); setError('');
    try {
      const next = await getTaxSignature(companyId);
      if (request !== loadRequest.current) return;
      setProfile(next);
      setImageFailed(false);
      if (reset) { setMode(next.signatureMode); setPendingAttachmentId(null); setPickedName(null); }
    } catch (cause) { if (request === loadRequest.current) setError(apiErrorMessage(cause)); } finally { if (request === loadRequest.current) setLoading(false); }
  }, [companyId]);
  useEffect(() => { if (canManage) void load(); return () => { loadRequest.current++; }; }, [load, canManage]);

  if (!canManage) {
    return (
      <MangmeePage title="ลายเซ็นบน 50 ทวิ">
        <MangmeeCard className="p-4 sm:p-5"><p className="text-sm text-gray-600">คุณยังไม่มีสิทธิ์ตั้งลายเซ็นผู้จ่ายเงินของร้าน</p></MangmeeCard>
      </MangmeePage>
    );
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const attachmentId = await uploadCompanyTaxSignatureAttachment(companyId, file);
      setPendingAttachmentId(attachmentId); setPickedName(file.name);
      toast.success('เลือกรูปแล้ว กด “บันทึก” เพื่อใช้รูปนี้');
    } catch (cause) { setError(apiErrorMessage(cause)); } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const signatureAttachmentId = pendingAttachmentId ?? profile?.signatureImageAttachmentId ?? undefined;
      if (mode === 'AUTO_STAMP' && !signatureAttachmentId) {
        setError('เลือกรูปลายเซ็นก่อนบันทึก');
        return;
      }
      await updateTaxSignature(companyId, { signatureMode: mode, ...(mode === 'AUTO_STAMP' ? { signatureAttachmentId } : {}) });
      toast.success('บันทึกแล้ว');
      await load();
    } catch (cause) { setError(apiErrorMessage(cause)); } finally { setBusy(false); }
  }

  return (
    <MangmeePage back={<BackLink href={`/companies/${companyId}/settings`} label="กลับไปตั้งค่า" />}
      title="ลายเซ็นบน 50 ทวิ"
      description="เลือกว่าจะให้ระบบใส่รูปลายเซ็นลงหนังสือรับรอง 50 ทวิ ให้ หรือพิมพ์แล้วเซ็นเอง"
    >
      <MangmeeCard className="p-4 sm:p-5">
        {loading ? <p className="text-sm text-gray-500">กำลังโหลด...</p> : !profile ? (
          <ErrorState description={error} onRetry={() => void load()} />
        ) : (
          <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
            <fieldset className="grid gap-1" disabled={busy}>
              <ChoiceRow name="signatureMode" label="พิมพ์แล้วเซ็นเอง" checked={mode === 'BLANK'} onChange={() => setMode('BLANK')} />
              <ChoiceRow name="signatureMode" label="ใส่รูปลายเซ็นให้อัตโนมัติ" checked={mode === 'AUTO_STAMP'} onChange={() => setMode('AUTO_STAMP')} />
            </fieldset>
            {mode === 'BLANK' && profile.signatureImageAttachmentId && <p className="text-sm text-gray-600">บันทึกแล้วรูปลายเซ็นที่เก็บไว้จะถูกลบ</p>}
            {profile.signatureImageUrl && <figure className="grid gap-2">
              {imageFailed ? <ErrorState description="เปิดรูปลายเซ็นไม่ได้ ลองอีกครั้ง" onRetry={() => void load(false)} />
                : <img src={profile.signatureImageUrl} alt="รูปลายเซ็นที่บันทึกไว้" className="h-32 w-full object-contain object-left" onError={() => setImageFailed(true)} />}
              {profile.signatureStoredAt && <figcaption className="text-sm text-gray-500">เก็บรูปไว้เมื่อ {formatThaiDateTime(profile.signatureStoredAt)}</figcaption>}
            </figure>}
            {mode === 'AUTO_STAMP' && (
              <div className="grid gap-2">
                <span className="text-xs font-medium text-gray-600">รูปลายเซ็น · {SIGNATURE_FILE_TYPES_LABEL}</span>
                <ThemedFile file={pickedName} accept="image/png,image/jpeg" disabled={busy} loading={busy} onChange={(file) => void onFile(file)} />
                {!profile.signatureImageUrl && !pickedName && <p className="text-sm text-gray-500">ยังไม่มีรูปลายเซ็น</p>}
              </div>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <FormActionBar><ActionGroup><button type="submit" className={primaryButtonClass} disabled={busy} aria-busy={busy}>บันทึก</button></ActionGroup></FormActionBar>
          </form>
        )}
      </MangmeeCard>
    </MangmeePage>
  );
}
