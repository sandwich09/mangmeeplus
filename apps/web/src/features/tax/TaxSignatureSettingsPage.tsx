'use client';

import { useCallback, useEffect, useState } from 'react';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { useToast } from '@/common/components/toast';
import { getTaxProfile, updateTaxSignature, uploadCompanyTaxSignatureAttachment, type CompanyTaxProfile } from './tax.api';

const field = 'mangmee-input w-full';
const button = 'rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50';

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
  const [profile, setProfile] = useState<CompanyTaxProfile | null>(null);
  const [mode, setMode] = useState<'BLANK' | 'AUTO_STAMP'>('BLANK');
  const [pendingAttachmentId, setPendingAttachmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const next = await getTaxProfile(companyId);
      setProfile(next);
      setMode(next.signatureMode);
      setPendingAttachmentId(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { void load(); }, [load]);

  if (!canManage) {
    return (
      <MangmeePage title="ลายเซ็นผู้จ่ายเงินสำหรับ 50 ทวิ">
        <MangmeeCard><p className="text-sm text-gray-600">หน้านี้สำหรับเจ้าของบริษัทเท่านั้น</p></MangmeeCard>
      </MangmeePage>
    );
  }

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try {
      const attachmentId = await uploadCompanyTaxSignatureAttachment(companyId, file);
      setPendingAttachmentId(attachmentId);
      toast.success('อัปโหลดรูปลายเซ็นแล้ว — กด “บันทึก” เพื่อยืนยัน');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const signatureAttachmentId = pendingAttachmentId ?? profile?.signatureImageAttachmentId ?? undefined;
      if (mode === 'AUTO_STAMP' && !signatureAttachmentId) {
        setError('กรุณาอัปโหลดรูปลายเซ็นก่อนเปิดใช้การประทับอัตโนมัติ');
        return;
      }
      await updateTaxSignature(companyId, { signatureMode: mode, ...(mode === 'AUTO_STAMP' ? { signatureAttachmentId } : {}) });
      toast.success('บันทึกการตั้งค่าลายเซ็นเรียบร้อยแล้ว');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  const hasStoredSignature = Boolean(pendingAttachmentId || profile?.signatureImageAttachmentId);

  return (
    <MangmeePage
      title="ลายเซ็นผู้จ่ายเงินสำหรับ 50 ทวิ"
      description="เลือกว่าจะให้ระบบประทับรูปลายเซ็นลงหนังสือรับรองหัก ณ ที่จ่ายที่ออกในระบบโดยอัตโนมัติ หรือเว้นว่างไว้ให้พิมพ์แล้วเซ็นเอง"
    >
      <MangmeeCard>
        {loading ? <p className="text-sm text-gray-500">กำลังโหลด...</p> : (
          <div className="grid gap-4 sm:max-w-md">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="signatureMode" checked={mode === 'BLANK'} onChange={() => setMode('BLANK')} disabled={busy} />
              เว้นว่างไว้ให้พิมพ์แล้วเซ็นเอง
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="signatureMode" checked={mode === 'AUTO_STAMP'} onChange={() => setMode('AUTO_STAMP')} disabled={busy} />
              ประทับรูปลายเซ็นที่อัปโหลดไว้อัตโนมัติ
            </label>
            {mode === 'AUTO_STAMP' && (
              <div className="grid gap-2">
                <span className="text-xs font-medium text-gray-600">รูปลายเซ็น (PNG หรือ JPEG)</span>
                <input className={field} type="file" accept="image/png,image/jpeg" onChange={onFileChange} disabled={busy} />
                {hasStoredSignature && <p className="text-xs text-gray-500">มีรูปลายเซ็นที่บันทึกไว้แล้ว — อัปโหลดใหม่เพื่อเปลี่ยน</p>}
              </div>
            )}
            {error && <p className="text-sm font-bold text-error-600">{error}</p>}
            <button type="button" className={button} onClick={() => void save()} disabled={busy}>บันทึก</button>
          </div>
        )}
      </MangmeeCard>
    </MangmeePage>
  );
}
