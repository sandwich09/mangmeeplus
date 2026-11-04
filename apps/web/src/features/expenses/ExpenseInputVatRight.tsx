'use client';
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import Link from 'next/link';
import { companyProfilePath, INPUT_VAT_REVIEWER_CONDITIONS, INPUT_VAT_RIGHT_LABEL, INPUT_VAT_RIGHT_LABELS, type DecideExpenseInputVatInput } from '@watchdog-bms/contracts';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { decideExpenseInputVat } from './expenses.api';
import { btnClass, ghostClass, inputClass, err } from './ExpensesUi';
import type { ExpenseDetail } from './expenses.model';
import { inputVatRightLabel, inputVatReviewerConditionLabel, showInputVatQuestion, inputVatChangedConditions, savedInputVatAnswers, INPUT_VAT_FIXED_REASONS, INPUT_VAT_POSTED_NOTICE } from './expense-input-vat-right.logic';

export function InputVatDecisionHistory({ detail, showLabel = true }: { detail: ExpenseDetail; showLabel?: boolean }) {
  if (!showInputVatQuestion(detail)) return null;
  const decision = detail.inputVatRight?.latestDecision;
  return <div className="space-y-1 text-sm"><p>{showLabel && `${INPUT_VAT_RIGHT_LABEL}: `}{inputVatRightLabel(detail)}</p>
    {decision && <><p>ตรวจโดย {decision.decidedByName} {formatThaiDateTime(decision.decidedAt)}</p>{decision.reason && <p>เหตุผล: {decision.reason}</p>}</>}
  </div>;
}

/** The ordinary step's Next saves this field; confirmed documents use their own action. */
export function ExpenseInputVatRight({ companyId, detail, canReview, saveRef, onSaved, fixAction, onDirtyChange, showLabel = true, renderReadOnly = content => content, canAnswerVatStatus = false, canEditShopIdentity = false, canReadTaxPeriods = false }: {
  companyId: string; detail: ExpenseDetail; canReview: boolean;
  saveRef?: MutableRefObject<(() => Promise<boolean>) | null>;
  renderReadOnly?: (content: ReactNode) => ReactNode;
  showLabel?: boolean; canAnswerVatStatus?: boolean; canEditShopIdentity?: boolean; canReadTaxPeriods?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => Promise<void>; fixAction?: (key: string) => ReactNode;
}) {
  const right = detail.inputVatRight;
  const anchor = `expense-input-vat-${detail.id}`;
  const profileHref = `${companyProfilePath(companyId)}?${new URLSearchParams({ returnTo: `/companies/${companyId}/expenses/${detail.id}#${anchor}` })}#shop`;
  const returnedExpense = useRef<string | null>(null);
  const [status, setStatus] = useState(detail.inputVatClaimStatus);
  const [ticks, setTicks] = useState<string[]>(() => savedInputVatAnswers(right).ticks);
  const [buyerConfirmed, setBuyerConfirmed] = useState(() => savedInputVatAnswers(right).buyerConfirmed);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverBlocker, setServerBlocker] = useState<string | null>(null);
  const [editing, setEditing] = useState(Boolean(saveRef));
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || returnedExpense.current === detail.id || window.location?.hash !== `#${anchor}`) return;
    if (!editing && canReview && !right?.fixed && !right?.decisionBlocker) { setEditing(true); return; }
    const target = document.getElementById(anchor);
    if (target) { target.scrollIntoView({ block: 'start' }); target.focus({ preventScroll: true }); returnedExpense.current = detail.id; }
  }, [anchor, detail.id, editing, canReview, right?.fixed, right?.decisionBlocker]);
  useEffect(() => {
    if (!changed) {
      setStatus(right?.status ?? detail.inputVatClaimStatus);
      const saved = savedInputVatAnswers(right); setTicks(saved.ticks); setBuyerConfirmed(saved.buyerConfirmed);
    }
  }, [detail.inputVatClaimStatus, right, changed]);
  useEffect(() => { onDirtyChange?.(changed); }, [changed, onDirtyChange]);
  const save = async () => {
    if (!changed || status === 'NEEDS_REVIEW') return true;
    setBusy(true); setError('');
    try {
      await decideExpenseInputVat(companyId, detail.id, { toStatus: status, reason, reviewerConditions: ticks, buyerConfirmed } satisfies DecideExpenseInputVatInput);
      setChanged(false); setEditing(Boolean(saveRef));
      return true;
    } catch (cause) {
      const code = (cause as { code?: string; details?: { code?: string } })?.code ?? (cause as { details?: { code?: string } })?.details?.code;
      if (code === 'tax_period_locked' || code === 'input_vat_posted_journal_immutable') setServerBlocker(code);
      setError(err(cause)); return false;
    }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = save;
    return () => { saveRef.current = null; };
  });
  if (!showInputVatQuestion(detail)) return null;
  if (detail.sourceDocumentType === 'NEEDS_REVIEW') return <p className="text-sm">{canReview ? 'เลือกประเภทเอกสารแล้วกด “ถัดไป” เพื่อตรวจ VAT' : 'ผู้ตรวจจะเลือกประเภทเอกสารก่อนตรวจ VAT'}</p>;
  if (!canReview || right?.fixed) return renderReadOnly(<div id={anchor} tabIndex={-1} className="space-y-1 text-sm"><InputVatDecisionHistory detail={detail} showLabel={showLabel} />
    {right?.reasonCode && INPUT_VAT_FIXED_REASONS[right.reasonCode] && <p>{INPUT_VAT_FIXED_REASONS[right.reasonCode]}</p>}
  </div>);
  const blocked = serverBlocker ?? right?.decisionBlocker;
  if (blocked) return renderReadOnly(<div id={anchor} tabIndex={-1} className="space-y-2 text-sm"><InputVatDecisionHistory detail={detail} showLabel={showLabel} />
    <p>{blocked === 'input_vat_posted_journal_immutable' ? INPUT_VAT_POSTED_NOTICE : 'แก้คำตอบเรื่อง VAT ของเดือนนี้ไม่ได้ ให้ผู้ทำบัญชีตรวจต่อ'}</p>
    {blocked === 'tax_period_locked' && (canReadTaxPeriods ? <Link href={`/companies/${companyId}/tax`} className="underline">เปิดงานภาษี</Link> : <p>ให้ผู้ทำบัญชีของร้านตรวจการปรับปรุงหรือยื่นแบบเพิ่มเติม</p>)}
  </div>);
  if (!editing) return renderReadOnly(<div id={anchor} tabIndex={-1} className="space-y-2"><InputVatDecisionHistory detail={detail} showLabel={showLabel} />
    <button type="button" className={ghostClass} onClick={() => setEditing(true)}>{right?.latestDecision ? 'เปลี่ยนคำตอบเรื่อง VAT' : 'ตรวจ VAT สำหรับยื่นภาษี'}</button>
  </div>);
  const conditionLabels: Record<string, [string, string]> = {
    SHOP_REGISTERED: ['ร้านจด VAT ณ วันที่ของเอกสาร', 'shop'],
    CLAIMABLE_TYPE: ['ประเภทเอกสารใช้ VAT ตอนยื่นภาษีได้', 'evidence'],
    PAPER_ATTACHED: [(right?.conditions?.find(condition => condition.code === 'PAPER_ATTACHED')?.fact as { originalDocumentAvailable?: boolean } | undefined)?.originalDocumentAvailable ? 'มีเอกสารตัวจริง' : 'แนบเอกสารแล้ว', 'receipt'],
    SELLER_TAX_ID: ['เลขผู้เสียภาษีผู้ขายครบ 13 หลัก', 'vendor_tax_id'],
    DOCUMENT_NUMBER: ['มีเลขที่เอกสาร', 'document_number'],
    USABLE_EVIDENCE: ['หลักฐานรายจ่ายใช้ได้', 'tax_evidence'],
    BUYER_MATCH: ['ชื่อและเลขผู้เสียภาษีของร้านบนใบตรงกับข้อมูลร้าน', 'buyer'],
  };
  const changedConditions = inputVatChangedConditions(right);
  const reasonField = status !== 'NEEDS_REVIEW' && (status === 'NON_CLAIMABLE' || right?.latestDecision) && <label className="block"><span className="mb-1 block text-sm font-medium">เหตุผล</span>
      <textarea aria-label="เหตุผลที่เลือกใช้ VAT ตอนยื่นภาษี" className={inputClass} rows={2} maxLength={500} value={reason} disabled={busy} onChange={event => { setReason(event.target.value); setChanged(true); }} />
    </label>;
  return <section id={anchor} tabIndex={-1} aria-label={INPUT_VAT_RIGHT_LABEL} className="w-full space-y-3 border-t border-gray-200 pt-3 text-left">
    {right?.latestDecision && reasonField}
    <label className="block"><span className="mb-1 block text-sm font-medium">{INPUT_VAT_RIGHT_LABEL}</span>
      <ThemedSelect aria-label={INPUT_VAT_RIGHT_LABEL} className={inputClass} value={status} disabled={busy} onChange={event => { setStatus(event.target.value as typeof status); setChanged(event.target.value !== 'NEEDS_REVIEW'); setError(''); }}>
        {Object.entries(INPUT_VAT_RIGHT_LABELS).map(([code, label]) => <option key={code} value={code} disabled={code === 'NEEDS_REVIEW' && Boolean(right?.latestDecision)}>{label}</option>)}
      </ThemedSelect>
    </label>
    {status === 'CLAIMABLE' && <div className="space-y-3">
      {(right?.conditions ?? []).filter(condition => conditionLabels[condition.code]).map(condition => {
        const [label, fix] = conditionLabels[condition.code];
        const registry = (condition.fact as { registry?: { registeredName?: string; taxId?: string } } | null)?.registry;
        const missingIdentity = fix === 'buyer' && (!registry?.registeredName?.trim() || !registry?.taxId?.trim());
        const answered = !missingIdentity && (condition.answer || condition.code === 'BUYER_MATCH' && buyerConfirmed);
        const reviewerBuyer = fix === 'buyer' && !missingIdentity && !condition.answer && right?.buyerMatchStatus !== 'MATCH' && right?.buyerMatchStatus !== 'MISMATCH';
        return <div key={condition.code} className="flex flex-wrap items-center gap-2 text-sm">
          <span>{missingIdentity ? 'กรอกชื่อจดทะเบียนและเลขผู้เสียภาษีของร้านที่ข้อมูลร้าน' : `${answered ? '✓' : 'ยังไม่ครบ:'} ${label}`}</span>
          {changedConditions.includes(condition.code) && <p className="w-full text-sm text-warning-700">ข้อมูลเปลี่ยนจากครั้งที่ตรวจไว้ ตรวจเงื่อนไขนี้อีกครั้ง</p>}
          {(!answered || reviewerBuyer) && (fix === 'shop' || missingIdentity ? (missingIdentity ? canEditShopIdentity : canAnswerVatStatus) ? <Link className="underline" href={profileHref}>ตั้งค่าร้าน › ข้อมูลร้าน</Link> : <span>{missingIdentity ? 'ให้เจ้าของกิจการหรือผู้ดูแลร้านกรอกข้อมูลร้านก่อน' : 'ให้เจ้าของกิจการหรือผู้ดูแลร้านตอบคำถาม “ร้านจดทะเบียน VAT หรือยัง” ที่ตั้งค่าร้าน › ข้อมูลร้าน'}</span>
            : fix === 'buyer' ? right?.buyerMatchStatus === 'MISMATCH' ? <span>ขอเอกสารที่ถูกต้องจากผู้ขาย</span>
              : <label className="flex items-start gap-2"><input type="checkbox" checked={buyerConfirmed} onChange={event => { setBuyerConfirmed(event.target.checked); setChanged(true); }} />ตรวจชื่อและเลขผู้เสียภาษีของร้านบนใบแล้ว ตรงกับข้อมูลร้าน</label>
            : fixAction?.(fix))}
        </div>;
      })}
      {INPUT_VAT_REVIEWER_CONDITIONS.map(condition => <label key={condition.code} className="flex items-start gap-2 text-sm">
        <input type="checkbox" disabled={busy} checked={ticks.includes(condition.code)} onChange={event => { setChanged(true); setTicks(value => event.target.checked ? [...value, condition.code] : value.filter(code => code !== condition.code)); }} />{inputVatReviewerConditionLabel(condition)}
      </label>)}
    </div>}
    {!right?.latestDecision && reasonField}
    {error && <p role="alert" className="text-sm text-error-700">{error}</p>}
    {!saveRef && <FormActionBar><ActionGroup>
      <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => { setEditing(false); setChanged(false); setError(''); }}>กลับ</button>
      <button type="button" className={btnClass} disabled={busy} aria-busy={busy} onClick={async () => { if (await save()) { setEditing(false); await onSaved?.(); } }}>บันทึกคำตอบเรื่อง VAT</button>
    </ActionGroup></FormActionBar>}
  </section>;
}
