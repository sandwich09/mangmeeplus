'use client';

import { useEffect, useMemo, useState } from 'react';
import { CloseLineIcon, PencilIcon } from '@/common/icons';
import { apiErrorMessage } from '@/common/api/api-error-message';
import {
  MangmeeBadge,
  MangmeeBranchChip,
  MangmeeCard,
  cx,
  type MangmeeTone,
} from '@/common/components/mangmee';
import {
  PO_APPROVAL_RULES,
  derivePoApprovalRules,
  getPoApprovalDemo,
  parseApprovalAmount,
  removePoApprovalRule,
  splitOpenEndedPoApprovalRule,
  type PoApprovalRule,
} from './po-approval-settings.model';
import { getPoApprovalPolicy, savePoApprovalPolicy } from './employee-access.api';
import { useConfirm, useInputPrompt } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';

const stepCircleClass: Record<MangmeeTone, string> = {
  brand: 'bg-brand-50 text-brand-700',
  line: 'bg-[#e9fbef] text-[#21ba5f]',
  rose: 'bg-[#fff0f5] text-[#f05a8b]',
  sky: 'bg-[#eef8ff] text-[#0ba5ec]',
  cyan: 'bg-[#ebfbfb] text-[#1fb7c9]',
  amber: 'bg-[#fff6e7] text-[#c56500]',
  lime: 'bg-[#f4faea] text-[#6f9f13]',
  teal: 'bg-[#ecfbf7] text-[#15977c]',
  indigo: 'bg-[#eef1ff] text-[#5d6cf0]',
  purple: 'bg-[#f4f3ff] text-[#6941c6]',
  slate: 'bg-gray-100 text-gray-600',
  danger: 'bg-error-50 text-error-700',
};

function StepCircle({ rule }: { rule: PoApprovalRule }) {
  return (
    <span
      className={cx(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-extrabold',
        stepCircleClass[rule.stepTone],
      )}
    >
      {rule.step}
    </span>
  );
}

function PencilMarker() {
  return <PencilIcon className="ml-1 inline-block h-3.5 w-3.5 text-brand-600" aria-hidden="true" />;
}

function ApprovalRuleRow({ rule, canRemove, onRemove }: { rule: PoApprovalRule; canRemove: boolean; onRemove: () => void }) {
  return (
    <div className="border-t border-gray-100 py-4 first:border-t-0 sm:py-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
        <StepCircle rule={rule} />
        <span className="text-base font-extrabold text-gray-900">{rule.conditionLabel}</span>
        {rule.inputValue && (
          <>
            <span className="text-sm font-extrabold text-gray-400">฿</span>
            {/* Was a readOnly <input>: white, bold, focusable, with a brand focus ring — it read as
                a field you could type a limit into, and nothing on this row edits the rule. Keep
                the boxed look, drop the editing affordance. */}
            <span className="inline-flex h-9 w-28 items-center justify-end rounded-lg border border-gray-200 bg-gray-50 px-3 text-right text-base font-extrabold text-gray-600 tabular-nums">
              {rule.inputValue}
            </span>
          </>
        )}
        <MangmeeBadge tone={rule.badgeTone} className="h-9 px-4 text-sm font-extrabold">
          {rule.badgeLabel}
        </MangmeeBadge>
        <button
          type="button"
          disabled={!canRemove}
          onClick={onRemove}
          className="inline-flex h-8 w-8 self-end items-center justify-center rounded-lg text-gray-300 hover:bg-gray-50 hover:text-gray-500 disabled:cursor-not-allowed disabled:opacity-40 sm:ml-auto sm:self-auto"
          aria-label={`ลบขั้นอนุมัติ ${rule.step}`}
        >
          <CloseLineIcon className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 pl-12 text-sm font-medium text-gray-500">
        ผู้อนุมัติ:{' '}
        <span className="font-extrabold text-gray-800">
          {rule.approverLabel}
          <PencilMarker />
        </span>
      </p>
    </div>
  );
}

function DemoTimeline({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-5 space-y-0">
      {steps.map((step, index) => (
        <li key={step} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
          <div className="relative flex justify-center">
            <span className="z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-sm font-extrabold text-brand-700">
              {index + 1}
            </span>
            {index < steps.length - 1 && <span className="absolute top-7 h-full w-px bg-brand-100" aria-hidden="true" />}
          </div>
          <p className="pb-4 text-sm font-medium leading-6 text-gray-600 last:pb-0">{step}</p>
        </li>
      ))}
    </ol>
  );
}

export function PoApprovalSettingsPage({ companyId }: { companyId: string }) {
  const locale = useWorkspaceLocale();
  const { confirm, confirmDialog } = useConfirm();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const toast = useToast();
  const [demoAmount, setDemoAmount] = useState('100');
  const [rules, setRules] = useState(PO_APPROVAL_RULES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    getPoApprovalPolicy(companyId).then((policy) => {
      setRules(derivePoApprovalRules(policy.rules));
      setSaved(true);
    }).catch((e) => setError(apiErrorMessage(e))).finally(() => setLoading(false));
  }, [companyId]);
  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await savePoApprovalPolicy(companyId, { rules: rules.map(({ id, minExclusive, maxInclusive, approverRoleKeys }) => ({ id, minExclusive, maxInclusive, approverRoleKeys })) });
      setSaved(true);
      toast.success('บันทึกขั้นอนุมัติคำสั่งซื้อแล้ว');
    } catch (e) { setError(apiErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const addRule = async () => {
    const value = await promptInput({
      title: 'เพิ่มขั้นอนุมัติ',
      label: 'วงเงินสูงสุดของขั้นใหม่ (บาท)',
      multiline: false,
      inputMode: 'numeric',
      variant: 'primary',
    });
    if (!value) return;
    const next = splitOpenEndedPoApprovalRule(rules, parseApprovalAmount(value), globalThis.crypto.randomUUID());
    if (!next) {
      setError('วงเงินสูงสุดของขั้นใหม่ต้องมากกว่าวงเงินสูงสุดของขั้นก่อนหน้า');
      return;
    }
    setError(null);
    setRules(next);
    setSaved(false);
  };

  const removeRule = async (rule: PoApprovalRule) => {
    if (rules.length === 1) return;
    if (!(await confirm({
      title: `ลบขั้นอนุมัติ ${rule.step}`,
      message: `ลบขั้นอนุมัติ ${rule.step} ใช่หรือไม่`,
    }))) return;
    setError(null);
    setRules(removePoApprovalRule(rules, rule.id));
    setSaved(false);
  };

  const demo = useMemo(() => getPoApprovalDemo(demoAmount, rules), [demoAmount, rules]);

  return (
    <div className="mangmee-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-500">
            <span>มั่งมี</span>
            <span className="mx-2 text-gray-300">/</span>
            <span className="text-gray-700">อนุมัติคำสั่งซื้อ</span>
          </div>
          <h1 className="mt-7 text-3xl font-extrabold leading-tight text-gray-900">ตั้งค่าอนุมัติคำสั่งซื้อ</h1>
          <p className="mt-3 max-w-[1060px] text-base font-medium leading-7 text-gray-500">
            กำหนดขั้นการอนุมัติใบสั่งซื้อ (PO) ตามวงเงิน · ใบที่อนุมัติครบขั้นแล้ว ระบบจะสร้างรายการซื้อ/รายจ่ายของวันนั้นในเมนู “ค่าใช้จ่าย+ใบเสร็จ” ให้อัตโนมัติ
          </p>
        </div>
        <div className="flex items-center gap-3"><MangmeeBranchChip label={t('branch.scope.company_wide', locale)} /><button type="button" disabled={loading || saving || saved} aria-busy={saving} onClick={() => void save()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-bold text-white disabled:bg-gray-200 disabled:text-gray-400" data-loading-indicator>{saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}{saving ? 'กำลังบันทึก...' : saved ? '✓ บันทึกแล้ว' : 'บันทึก'}</button></div>
      </div>
      {loading && <div className="text-sm text-gray-500">กำลังโหลดนโยบาย...</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.48fr)_minmax(330px,0.96fr)]">
        <MangmeeCard className="p-5 sm:p-6">
          <h2 className="text-xl font-extrabold text-gray-900">ขั้นการอนุมัติตามวงเงิน</h2>
          <p className="mt-2 text-sm font-medium text-gray-500">
            ขั้นที่มีผู้อนุมัติหลายบทบาท คนใดคนหนึ่งอนุมัติก็ผ่าน · ขั้นที่ไม่มีผู้อนุมัติ ไม่ต้องอนุมัติ
          </p>

          <div className="mt-3">
            {rules.map((rule) => (
              <ApprovalRuleRow
                key={rule.id}
                rule={rule}
                canRemove={!loading && rules.length > 1}
                onRemove={() => void removeRule(rule)}
              />
            ))}
          </div>

          <button
            type="button"
            disabled={loading} aria-busy={Boolean(loading)}
            onClick={() => void addRule()}
            className="mt-2 flex h-10 w-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white text-sm font-extrabold text-gray-500 hover:border-brand-200 hover:bg-brand-25 hover:text-brand-700"
          >
            + เพิ่มขั้นอนุมัติ
          </button>
        </MangmeeCard>

        <div className="grid content-start gap-5">
          <MangmeeCard className="p-5 sm:p-6">
            <h2 className="text-xl font-extrabold text-gray-900">ทดลองเงื่อนไข</h2>
            <p className="mt-2 text-sm font-medium text-gray-500">ใส่ยอดใบสั่งซื้อ ดูว่าจะวิ่งผ่านขั้นไหนบ้าง</p>

            <label className="relative mt-5 block">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-extrabold text-gray-400">฿</span>
              <input
                className="mangmee-input h-12 rounded-lg text-lg font-extrabold text-gray-900"
                style={{ paddingLeft: '3rem' }}
                value={demoAmount}
                inputMode="numeric"
                aria-label="ยอดทดลองใบสั่งซื้อ"
                onChange={(event) => setDemoAmount(event.target.value)}
              />
            </label>

            <MangmeeBadge tone={demo.rule.badgeTone} className="mt-4 h-10 px-4 text-sm font-extrabold">
              {demo.statusLabel}
            </MangmeeBadge>

            <DemoTimeline steps={demo.steps} />
          </MangmeeCard>

          <section className="rounded-2xl border border-brand-100 bg-brand-25 p-5 sm:p-6">
            <h2 className="text-xl font-extrabold text-gray-900">เชื่อมกับ “ค่าใช้จ่าย+ใบเสร็จ”</h2>
            <p className="mt-3 text-sm font-medium leading-7 text-gray-500">
              ใบสั่งซื้อที่อนุมัติครบขั้น จะถูกบันทึกเป็นรายการซื้อ/รายจ่ายของวันนั้นอัตโนมัติ พร้อมแนบใบสั่งซื้อเป็นหลักฐาน และเข้าสมุดรายวันตามปกติ
            </p>
          </section>
        </div>
      </div>
      {inputPromptDialog}
      {confirmDialog}
    </div>
  );
}
