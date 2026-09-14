'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  SubstituteReceiptApprovalMode,
  SubstituteReceiptCashEvidencePolicy,
  SubstituteReceiptPolicySettings,
  UpdateSubstituteReceiptPolicyInput,
} from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeBadge, MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { getSubstituteReceiptPolicy, updateSubstituteReceiptPolicy } from './expenses.api';
import { ErrorBanner } from './ExpensesUi';
import { validApproverSelection, validateSubstituteReceiptPolicy } from './substitute-receipt-policy.model';

const STRICT = 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE';
const ALLOW = 'ALLOW_SUPPORTING_EVIDENCE_ONLY';

function message(error: unknown): string {
  return apiErrorMessage(error);
}

export function SubstituteReceiptSettingsPage({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [settings, setSettings] = useState<SubstituteReceiptPolicySettings | null>(null);
  const [approvalMode, setApprovalMode] = useState<SubstituteReceiptApprovalMode>('OWNER_SELF');
  const [approverUserIds, setApproverUserIds] = useState<string[]>([]);
  const [cashEvidencePolicy, setCashEvidencePolicy] = useState<SubstituteReceiptCashEvidencePolicy>(ALLOW);
  const [cashEvidenceInstructions, setCashEvidenceInstructions] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const applySettings = useCallback((value: SubstituteReceiptPolicySettings) => {
    setSettings(value);
    setApprovalMode(value.approvalMode);
    setApproverUserIds(validApproverSelection(value.approverUserIds, value.invalidApproverUserIds));
    setCashEvidencePolicy(value.cashEvidencePolicy);
    setCashEvidenceInstructions(value.cashEvidenceInstructions ?? '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applySettings(await getSubstituteReceiptPolicy(companyId));
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoading(false);
    }
  }, [applySettings, companyId]);

  useEffect(() => { void load(); }, [load]);

  const input = useMemo<UpdateSubstituteReceiptPolicyInput>(() => ({
    approvalMode,
    approverUserIds,
    cashEvidencePolicy,
    ...(cashEvidenceInstructions.trim() ? { cashEvidenceInstructions: cashEvidenceInstructions.trim() } : {}),
  }), [approvalMode, approverUserIds, cashEvidenceInstructions, cashEvidencePolicy]);
  const validationError = validateSubstituteReceiptPolicy(input);

  const toggleApprover = (userId: string) => {
    setSaved(false);
    setApproverUserIds((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  };

  const save = async () => {
    if (validationError || saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      applySettings(await updateSubstituteReceiptPolicy(companyId, input));
      setSaved(true);
      toast.success('บันทึกการตั้งค่าใบรับรองแทนใบเสร็จแล้ว');
    } catch (saveError) {
      setError(message(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MangmeePage
      eyebrow={<><Link href={`/companies/${companyId}/settings`}>ตั้งค่า</Link><span className="mx-2">/</span>ใบรับรองแทนใบเสร็จ</>}
      title="ตั้งค่าใบรับรองแทนใบเสร็จรับเงิน"
      description="กำหนดรูปแบบการอนุมัติ ผู้มีอำนาจอนุมัติ และหลักฐานขั้นต่ำสำหรับรายการจ่ายเงินสดของบริษัท"
      meta={settings && <MangmeeBadge tone={settings.configured ? 'brand' : 'amber'}>{settings.configured ? 'ตั้งค่าแล้ว' : 'ยังไม่ตั้งค่า'}</MangmeeBadge>}
    >
      {loading ? (
        <LoadingState label="กำลังโหลด..." />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <div className="grid content-start gap-5">
            <MangmeeCard className="p-5 sm:p-6">
              <h2 className="text-xl font-extrabold text-gray-900">รูปแบบการอนุมัติและตรวจรับ</h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">สำหรับฉบับกระดาษ การตั้งค่านี้กำหนดผู้มีสิทธิ์ตรวจรับด้วย หากต้องการระบุผู้ตรวจรับ ให้เลือกกำหนดรายชื่อด้านล่าง ผู้ตรวจรับต้องมีสิทธิ์ยืนยันค่าใช้จ่าย</p>
              <div className="mt-4 grid gap-3">
                <label className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${approvalMode === 'OWNER_SELF' ? 'border-brand-200 bg-brand-25' : 'border-gray-200'}`}>
                  <input type="radio" name="approval-mode" checked={approvalMode === 'OWNER_SELF'} onChange={() => { setApprovalMode('OWNER_SELF'); setSaved(false); }} className="mt-1 accent-brand-700" />
                  <span>
                    <span className="font-bold text-gray-900">เจ้าของกิจการลงนามและอนุมัติด้วยตนเอง (ค่าเริ่มต้น)</span>
                    <span className="mt-1 block text-sm leading-6 text-gray-500">เหมาะกับกิจการเจ้าของคนเดียว ระบบจะระบุในเอกสารว่าเจ้าของลงนามทั้งในฐานะผู้จ่ายเงินและผู้อนุมัติ และบันทึกประวัติไว้ตรวจสอบย้อนหลัง</span>
                  </span>
                </label>
                <label className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${approvalMode === 'DESIGNATED_APPROVERS' ? 'border-brand-200 bg-brand-25' : 'border-gray-200'}`}>
                  <input type="radio" name="approval-mode" checked={approvalMode === 'DESIGNATED_APPROVERS'} onChange={() => { setApprovalMode('DESIGNATED_APPROVERS'); setSaved(false); }} className="mt-1 accent-brand-700" />
                  <span>
                    <span className="font-bold text-gray-900">กำหนดรายชื่อผู้อนุมัติ / ผู้ตรวจรับ</span>
                    <span className="mt-1 block text-sm leading-6 text-gray-500">เหมาะกับกิจการที่ต้องการแบ่งหน้าที่ ระบบจะบังคับให้ผู้จ่ายเงินและผู้อนุมัติเป็นคนละคน</span>
                  </span>
                </label>
              </div>
            </MangmeeCard>

            <MangmeeCard className="p-5 sm:p-6">
              <h2 className="text-xl font-extrabold text-gray-900">ผู้อนุมัติออนไลน์ / ผู้ตรวจรับฉบับกระดาษ</h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                {approvalMode === 'OWNER_SELF'
                  ? 'ขณะนี้ใช้สิทธิ์ยืนยันค่าใช้จ่ายในการตรวจรับ รายชื่อด้านล่างยังไม่มีผล ให้เลือก “กำหนดรายชื่อผู้อนุมัติ / ผู้ตรวจรับ” ก่อน แล้วเลือกรายชื่อและบันทึก'
                  : 'รายชื่อที่เลือกมีสิทธิ์อนุมัติเอกสารออนไลน์และตรวจรับฉบับกระดาษ โดยต้องเป็นสมาชิกที่ยังใช้งานและมีสิทธิ์ยืนยันค่าใช้จ่าย การลงนามของผู้รับรองและผู้อนุมัติต้องแยกคนกัน'}
              </p>
              {settings?.invalidApproverUserIds.length ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  ผู้อนุมัติเดิมบางคนไม่มีสิทธิ์หรือไม่ active แล้ว กรุณาเลือกผู้อนุมัติใหม่ก่อนบันทึก
                </div>
              ) : null}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {settings?.approverCandidates.map((candidate) => (
                  <label key={candidate.userId} className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-4 hover:border-brand-200 hover:bg-brand-25">
                    <input
                      type="checkbox"
                      checked={approverUserIds.includes(candidate.userId)}
                      onChange={() => toggleApprover(candidate.userId)}
                      className="mt-1 h-4 w-4 shrink-0 accent-brand-700"
                    />
                    <span>
                      <span className="block font-bold text-gray-900">{candidate.displayName}</span>
                      <span className="mt-1 block text-xs text-gray-500">มีสิทธิ์ยืนยันค่าใช้จ่าย</span>
                    </span>
                  </label>
                ))}
              </div>
              {settings?.approverCandidates.length === 0 ? (
                <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-600">
                  ยังไม่มีผู้ใช้ที่มีสิทธิ์อนุมัติ ไปที่ <Link className="font-bold text-brand-700 underline" href={`/companies/${companyId}/settings/roles`}>บทบาทและสิทธิ์</Link> หรือ <Link className="font-bold text-brand-700 underline" href={`/companies/${companyId}/settings/employees`}>พนักงาน</Link>
                </div>
              ) : null}
            </MangmeeCard>

            <MangmeeCard className="p-5 sm:p-6">
              <h2 className="text-xl font-extrabold text-gray-900">หลักฐานเมื่อชำระเงินสด</h2>
              <div className="mt-4 grid gap-3">
                <label className="flex cursor-pointer gap-3 rounded-xl border border-brand-200 bg-brand-25 p-4">
                  <input type="radio" name="cash-policy" checked={cashEvidencePolicy === STRICT} onChange={() => { setCashEvidencePolicy(STRICT); setSaved(false); }} className="mt-1 accent-brand-700" />
                  <span>
                    <span className="font-bold text-gray-900">บังคับหลักฐานการจ่ายเงินแยกอย่างน้อย 1 ไฟล์</span>
                    <span className="mt-1 block text-sm leading-6 text-gray-500">ต้องมีภาพ/PDF ในช่องหลักฐานการจ่าย นอกเหนือจากเอกสารประกอบรายการ</span>
                  </span>
                </label>
                <label className="flex cursor-pointer gap-3 rounded-xl border border-gray-200 p-4">
                  <input type="radio" name="cash-policy" checked={cashEvidencePolicy === ALLOW} onChange={() => { setCashEvidencePolicy(ALLOW); setSaved(false); }} className="mt-1 accent-brand-700" />
                  <span>
                    <span className="font-bold text-gray-900">อนุญาตให้ใช้เอกสารประกอบรายการเพียงอย่างเดียว (ค่าเริ่มต้น)</span>
                    <span className="mt-1 block text-sm leading-6 text-gray-500">ควรใช้เมื่อผู้ทำบัญชีของบริษัทรับรองนโยบายนี้แล้ว ระบบยังคงบังคับให้ผู้จ่ายรับรองและผู้มีสิทธิอนุมัติลงลายมือชื่อตามรูปแบบที่กำหนด</span>
                  </span>
                </label>
              </div>
              <label className="mt-5 block text-sm font-bold text-gray-700">
                คำแนะนำหลักฐานของบริษัท
                <textarea
                  value={cashEvidenceInstructions}
                  onChange={(event) => { setCashEvidenceInstructions(event.target.value); setSaved(false); }}
                  maxLength={500}
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-normal leading-6 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  placeholder="เช่น แนบใบสำคัญจ่ายที่ผู้รับเงินลงชื่อ หรือสำเนาบัตรผู้รับเงินตามที่ผู้ทำบัญชีกำหนด"
                />
              </label>
              <div className="mt-1 text-right text-xs text-gray-400">{cashEvidenceInstructions.length}/500</div>
            </MangmeeCard>
          </div>

          <div className="grid content-start gap-5">
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-7 text-amber-900">
              <h2 className="text-lg font-extrabold">ขอบเขตทางภาษี</h2>
              <p className="mt-2">การตั้งค่านี้เป็น control ภายในบริษัท ไม่ทำให้เอกสารกลายเป็นใบกำกับภาษี และไม่สร้างสิทธิ์ภาษีซื้อโดยอัตโนมัติ</p>
              <a className="mt-3 inline-flex min-h-11 items-center font-bold underline sm:min-h-0" href="https://www.rd.go.th/fileadmin/download/15277290359.pdf" target="_blank" rel="noreferrer">ดูคู่มือกรมสรรพากร</a>
            </section>
            <MangmeeCard className="p-5">
              <h2 className="text-lg font-extrabold text-gray-900">ก่อนเปิดใช้งานจริง</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-gray-600">
                <li>เลือกรูปแบบการอนุมัติให้เหมาะกับบริษัท</li>
                <li>ตกลงหลักฐานเงินสดกับผู้ทำบัญชี</li>
                <li>ทดสอบขั้นตอนลงลายมือชื่อและอนุมัติให้ครบถ้วน</li>
              </ol>
              {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
              {validationError ? <div className="mt-4 text-sm font-bold text-amber-700">{validationError}</div> : null}
              {saved ? <div className="mt-4 text-sm font-bold text-brand-700">บันทึกการตั้งค่าแล้ว</div> : null}
              <button
                type="button"
                onClick={() => void save()}
                disabled={Boolean(validationError) || saving}
                aria-busy={saving}
                className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-extrabold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50" data-loading-indicator
              >
                {saving ? <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" /> : null}
                {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
              </button>
            </MangmeeCard>
          </div>
        </div>
      )}
    </MangmeePage>
  );
}
