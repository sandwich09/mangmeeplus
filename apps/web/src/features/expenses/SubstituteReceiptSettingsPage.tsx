'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';
import type {
  SubstituteReceiptApprovalMode,
  SubstituteReceiptCashEvidencePolicy,
  SubstituteReceiptPolicySettings,
  UpdateSubstituteReceiptPolicyInput,
} from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { ChoiceRow } from '@/common/components/field';
import { Notice } from '@/common/components/notice';
import { primaryButtonClass, secondaryButtonClass } from '@/common/components/button/button-classes';
import { LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { getSubstituteReceiptPolicy, updateSubstituteReceiptPolicy } from './expenses.api';
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
  // The list's error shows after the first press of the save button, under the list it is about.
  const [attempted, setAttempted] = useState(false);
  const [adviceOpen, setAdviceOpen] = useState(false);
  const loadRequest = useRef(0);
  const dirty = useRef(false);

  const applySettings = useCallback((value: SubstituteReceiptPolicySettings) => {
    dirty.current = false;
    setSettings(value);
    setApprovalMode(value.approvalMode);
    setApproverUserIds(validApproverSelection(value.approverUserIds, value.invalidApproverUserIds));
    setCashEvidencePolicy(value.cashEvidencePolicy);
    setCashEvidenceInstructions(value.cashEvidenceInstructions ?? '');
    setAdviceOpen(Boolean(value.cashEvidenceInstructions));
  }, []);

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getSubstituteReceiptPolicy(companyId);
      if (request === loadRequest.current && !dirty.current) applySettings(next);
    } catch (loadError) {
      if (request === loadRequest.current) setError(message(loadError));
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, [applySettings, companyId]);

  useEffect(() => { void load(); return () => { loadRequest.current++; }; }, [load]);

  const input = useMemo<UpdateSubstituteReceiptPolicyInput>(() => ({
    approvalMode,
    approverUserIds,
    cashEvidencePolicy,
    ...(cashEvidenceInstructions.trim() ? { cashEvidenceInstructions: cashEvidenceInstructions.trim() } : {}),
  }), [approvalMode, approverUserIds, cashEvidenceInstructions, cashEvidencePolicy]);
  const validationError = validateSubstituteReceiptPolicy(input);

  const toggleApprover = (userId: string) => {
    dirty.current = true;
    setApproverUserIds((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  };

  const save = async () => {
    if (saving) return;
    setAttempted(true);
    if (validationError) {
      document.getElementById('substitute-approvers')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await updateSubstituteReceiptPolicy(companyId, input);
      loadRequest.current++; // A read started before this save must not replace its new pristine baseline.
      setLoading(false);
      applySettings(next);
      setAttempted(false);
      toast.success('บันทึกการตั้งค่าใบรับรองแทนใบเสร็จแล้ว');
    } catch (saveError) {
      setError(message(saveError));
    } finally {
      setSaving(false);
    }
  };

  const sectionTitle = 'text-base font-semibold text-gray-900';
  return (
    <MangmeePage
      back={<BackLink href={`/companies/${companyId}/settings`} label="กลับไปตั้งค่า" />}
      title="ตั้งค่าใบรับรองแทนใบเสร็จ"
    >
      {loading ? (
        <LoadingState label="กำลังโหลด..." />
      ) : !settings ? (
        <Notice tone="error" action={<button type="button" className={secondaryButtonClass} onClick={() => void load()}>ลองอีกครั้ง</button>}>
          {error ?? 'โหลดการตั้งค่าไม่สำเร็จ'}
        </Notice>
      ) : (
        <MangmeeCard className="grid gap-6 p-4 sm:p-6">
          <fieldset className="min-w-0">
            <legend className={sectionTitle}>ใครอนุมัติใบรับรอง</legend>
            <div className="mt-2 grid gap-2">
              <ChoiceRow framed name="approval-mode" checked={approvalMode === 'OWNER_SELF'} onChange={() => { dirty.current = true; setApprovalMode('OWNER_SELF'); }}
                label={`${THAI_SYSTEM_ROLE_NAMES.OWNER}เซ็นและอนุมัติเอง`} description="เหมาะกับร้านที่เจ้าของทำเอง" />
              <ChoiceRow framed name="approval-mode" checked={approvalMode === 'DESIGNATED_APPROVERS'} onChange={() => { dirty.current = true; setApprovalMode('DESIGNATED_APPROVERS'); }}
                label="กำหนดผู้อนุมัติ" description="ผู้รับรองการจ่ายกับผู้อนุมัติต้องเป็นคนละคน" />
            </div>
          </fieldset>

          {/* The people are asked for only where they count: under the choice that uses them. */}
          {approvalMode === 'DESIGNATED_APPROVERS' && (
            <fieldset id="substitute-approvers" className="min-w-0 scroll-mt-24">
              <legend className={sectionTitle}>ผู้อนุมัติ (ใช้ตรวจรับฉบับกระดาษด้วย)</legend>
              {settings.invalidApproverUserIds.length > 0 && (
                <Notice tone="warning" className="mt-2">ผู้อนุมัติเดิมบางคนไม่มีสิทธิ์หรือไม่ได้ใช้งานแล้ว เลือกผู้อนุมัติใหม่ก่อนบันทึก</Notice>
              )}
              <div className="mt-1 grid gap-x-6 sm:grid-cols-2">
                {settings.approverCandidates.map((candidate) => (
                  <ChoiceRow key={candidate.userId} type="checkbox" label={candidate.displayName}
                    checked={approverUserIds.includes(candidate.userId)} onChange={() => toggleApprover(candidate.userId)} />
                ))}
              </div>
              {settings.approverCandidates.length === 0 && (
                <Notice tone="info" action={<Link className={secondaryButtonClass} href={`/companies/${companyId}/settings/permissions`}>ไปบทบาทและสิทธิ์</Link>}>
                  ยังไม่มีใครมีสิทธิ์ยืนยันค่าใช้จ่าย เพิ่มสิทธิ์นี้ให้บทบาทของเขาก่อน
                </Notice>
              )}
              {attempted && validationError && <p role="alert" className="mt-1 text-sm text-red-600">{validationError}</p>}
            </fieldset>
          )}

          <fieldset className="min-w-0">
            <legend className={sectionTitle}>จ่ายเงินสดต้องแนบอะไร</legend>
            <div className="mt-2 grid gap-2">
              <ChoiceRow framed name="cash-policy" checked={cashEvidencePolicy === STRICT} onChange={() => { dirty.current = true; setCashEvidencePolicy(STRICT); }}
                label="ต้องมีหลักฐานการจ่ายอย่างน้อย 1 ไฟล์" description="แนบแยกจากหลักฐานประกอบ" />
              <ChoiceRow framed name="cash-policy" checked={cashEvidencePolicy === ALLOW} onChange={() => { dirty.current = true; setCashEvidencePolicy(ALLOW); }}
                label="ใช้หลักฐานประกอบอย่างเดียวได้" description="ควรตกลงกับผู้ทำบัญชีของร้านก่อน ผู้รับรองการจ่ายยังต้องเซ็นรับรองทุกใบ" />
            </div>
            <details className="mt-2" open={adviceOpen} onToggle={(event) => setAdviceOpen(event.currentTarget.open)}>
              <summary className="cursor-pointer py-2.5 text-sm font-semibold text-gray-700">เพิ่มคำแนะนำให้พนักงาน</summary>
              <label htmlFor="substitute-cash-advice" className="block text-sm font-medium text-gray-700">คำแนะนำเรื่องหลักฐาน</label>
              <textarea
                id="substitute-cash-advice"
                value={cashEvidenceInstructions}
                onChange={(event) => { dirty.current = true; setCashEvidenceInstructions(event.target.value); }}
                maxLength={500}
                rows={3}
                className="mangmee-input mt-1.5"
                placeholder="เช่น ให้ผู้รับเงินเซ็นชื่อรับเงินบนกระดาษ แล้วถ่ายรูปแนบ"
              />
              <p className="mt-1 text-right text-xs text-gray-500">{cashEvidenceInstructions.length}/500</p>
            </details>
          </fieldset>

          <Notice tone="info" action={<a className={secondaryButtonClass} href="https://www.rd.go.th/fileadmin/download/15277290359.pdf" target="_blank" rel="noreferrer">คู่มือกรมสรรพากร</a>}>
            ใบรับรองแทนใบเสร็จใช้ VAT ตอนยื่นภาษีไม่ได้
          </Notice>

          {error && <Notice tone="error">{error}</Notice>}
          <ActionGroup>
            <button type="button" className={primaryButtonClass} disabled={saving} aria-busy={saving} onClick={() => void save()}>บันทึกการตั้งค่า</button>
          </ActionGroup>
        </MangmeeCard>
      )}
    </MangmeePage>
  );
}
