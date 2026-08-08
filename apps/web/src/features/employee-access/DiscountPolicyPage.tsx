'use client';

import { useEffect, useState } from 'react';
import { MangmeeCard, cx } from '@/common/components/mangmee';
import { useToast } from '@/common/components/toast';
import { apiErrorMessage } from '@/common/api/api-error-message';
import {
  DISCOUNT_OVERRIDE_OPTIONS,
  DISCOUNT_POLICY_DEFAULTS,
  setDiscountOverrideRole,
  stepDiscountPolicy,
  toggleDiscountAllowAuto,
  type DiscountPolicyState,
  type DiscountStepField,
} from './discount-policy.model';
import { getDiscountPolicy, saveDiscountPolicyApi } from './employee-access.api';

function StepButton({
  dir,
  label,
  small,
  onClick,
  disabled,
}: {
  dir: 'dec' | 'inc';
  label: string;
  small?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex shrink-0 items-center justify-center border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:hover:bg-white',
        small ? 'h-[30px] w-[30px] rounded-lg text-lg' : 'h-[34px] w-[34px] rounded-[9px] text-xl',
      )}
    >
      {dir === 'dec' ? '−' : '+'}
    </button>
  );
}

function CentralValueBox({
  title,
  value,
  valueClass,
  onStep,
}: {
  title: string;
  value: number;
  valueClass: string;
  onStep: (delta: 1 | -1) => void;
}) {
  return (
    <div className="rounded-[14px] border border-gray-200 p-4">
      <div className="text-[13.5px] font-semibold text-gray-500">{title}</div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
        <StepButton dir="dec" label={`ลด${title}`} onClick={() => onStep(-1)} />
        <div className={cx('text-3xl font-extrabold tracking-tight', valueClass)}>
          {value}
          <span className="text-lg">%</span>
        </div>
        <StepButton dir="inc" label={`เพิ่ม${title}`} onClick={() => onStep(1)} />
      </div>
    </div>
  );
}

type TierRow = {
  field?: DiscountStepField;
  label: string;
  hint: string;
  dot: string;
  dotClass: string;
  valueClass: string;
};

const TIER_ROWS: TierRow[] = [
  {
    field: 'vipPct',
    label: 'ลูกค้า VIP',
    hint: 'ยอดสะสมสูง / เครดิตดีเยี่ยม',
    dot: '★',
    dotClass: 'bg-[#FEF0C7] text-[#DC6803]',
    valueClass: 'text-[#DC6803]',
  },
  {
    field: 'regularPct',
    label: 'ลูกค้าประจำ',
    hint: 'ซื้อซ้ำสม่ำเสมอ',
    dot: '♥',
    dotClass: 'bg-[#F4EBFF] text-[#6941C6]',
    valueClass: 'text-[#6941C6]',
  },
  {
    label: 'ลูกค้าทั่วไป',
    hint: 'ไม่ให้ส่วนลดอัตโนมัติ',
    dot: '•',
    dotClass: 'bg-gray-100 text-gray-500',
    valueClass: 'text-gray-400',
  },
];

export function DiscountPolicyPage({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [policy, setPolicy] = useState<DiscountPolicyState>(DISCOUNT_POLICY_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getDiscountPolicy(companyId)
      .then((value) => setPolicy({ ...value, saved: true }))
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false));
  }, [companyId]);
  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const { saved: _saved, ...body } = policy;
      const value = await saveDiscountPolicyApi(companyId, body);
      setPolicy({ ...value, saved: true });
      toast.success('บันทึกนโยบายส่วนลดแล้ว');
    } catch (e) { setError(apiErrorMessage(e)); }
    finally { setSaving(false); }
  };
  const step = (field: DiscountStepField, delta: 1 | -1) =>
    setPolicy((state) => stepDiscountPolicy(state, field, delta));

  return (
    <div className="mangmee-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-500">
            <span>มั่งมี</span>
            <span className="mx-2 text-gray-300">/</span>
            <span className="text-gray-700">นโยบายส่วนลด</span>
          </div>
          <h1 className="mt-7 text-3xl font-extrabold leading-tight text-gray-900">นโยบายส่วนลด</h1>
          <p className="mt-3 max-w-[1060px] text-base font-medium leading-7 text-gray-500">
            ค่ากลางของส่วนลดทั้งร้าน — หน้าอื่น (เช่น Auto AI ในกล่องข้อความ, การขาย) จะดึงค่านี้ไปใช้แบบอ้างอิง
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={loading || saving || policy.saved}
          aria-busy={saving}
          className={cx(
            'flex h-11 shrink-0 items-center gap-2 rounded-[11px] px-[22px] text-[15px] font-bold',
            policy.saved || saving
              ? 'bg-gray-100 text-gray-400'
              : 'bg-brand-500 text-white shadow-[0_4px_12px_rgba(22,163,74,0.28)]',
          )}
        >
          {saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
          {saving ? 'กำลังบันทึก...' : policy.saved ? '✓ บันทึกแล้ว' : 'บันทึกนโยบาย'}
        </button>
      </div>
      {loading && <div className="text-sm text-gray-500">กำลังโหลดนโยบาย...</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <MangmeeCard className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3.5">
              <div className="min-w-0">
                <h2 className="text-lg font-extrabold text-gray-900">อนุญาตให้ AI ให้ส่วนลดอัตโนมัติ</h2>
                <p className="mt-1 text-sm font-medium leading-6 text-gray-500">
                  เมื่อเปิด ระบบจะเสนอส่วนลดให้ลูกค้าเครดิตดี/ประจำ ตามค่ากลางด้านล่างโดยไม่ต้องให้แอดมินกดเอง
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={policy.allowAuto}
                aria-label="อนุญาตให้ AI ให้ส่วนลดอัตโนมัติ"
                onClick={() => setPolicy(toggleDiscountAllowAuto)}
                className={cx(
                  'flex h-[27px] w-[46px] shrink-0 rounded-full p-[3px] transition-all duration-150',
                  policy.allowAuto ? 'justify-end bg-brand-500' : 'justify-start bg-gray-300',
                )}
              >
                <span className="h-[21px] w-[21px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)]" />
              </button>
            </div>
          </MangmeeCard>

          <MangmeeCard className="p-5 sm:p-6">
            <h2 className="text-lg font-extrabold text-gray-900">ค่ากลางของส่วนลด</h2>
            <p className="mt-1 text-sm font-medium text-gray-500">
              ปรับทีละ 1% · เพดานคือส่วนลดสูงสุดที่พนักงานหรือ AI ให้ได้
            </p>
            <div className="mt-[18px] grid grid-cols-1 gap-4 sm:grid-cols-2">
              <CentralValueBox
                title="ส่วนลดเริ่มต้น (Auto AI)"
                value={policy.defaultPct}
                valueClass="text-[#6941C6]"
                onStep={(delta) => step('defaultPct', delta)}
              />
              <CentralValueBox
                title="เพดานสูงสุด"
                value={policy.maxPct}
                valueClass="text-gray-900"
                onStep={(delta) => step('maxPct', delta)}
              />
            </div>
          </MangmeeCard>

          <MangmeeCard className="p-5 sm:p-6">
            <h2 className="text-lg font-extrabold text-gray-900">ส่วนลดตามระดับลูกค้า</h2>
            <p className="mb-4 mt-1 text-sm font-medium text-gray-500">ใช้เมื่อเปิดส่วนลดอัตโนมัติให้ลูกค้าแต่ละกลุ่ม</p>
            {TIER_ROWS.map((tier) => (
              <div key={tier.label} className="flex flex-col items-start gap-2 border-t border-gray-100 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-[11px]">
                  <span
                    className={cx(
                      'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] text-[15px]',
                      tier.dotClass,
                    )}
                  >
                    {tier.dot}
                  </span>
                  <div>
                    <div className="text-[15.5px] font-semibold text-gray-800">{tier.label}</div>
                    <div className="text-[13px] text-gray-400">{tier.hint}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <StepButton
                    dir="dec"
                    small
                    label={`ลดส่วนลด${tier.label}`}
                    disabled={!tier.field}
                    onClick={tier.field ? () => step(tier.field!, -1) : undefined}
                  />
                  <div className={cx('min-w-[46px] text-center text-[19px] font-extrabold', tier.valueClass)}>
                    {tier.field ? policy[tier.field] : 0}%
                  </div>
                  <StepButton
                    dir="inc"
                    small
                    label={`เพิ่มส่วนลด${tier.label}`}
                    disabled={!tier.field}
                    onClick={tier.field ? () => step(tier.field!, 1) : undefined}
                  />
                </div>
              </div>
            ))}
          </MangmeeCard>
        </div>

        <div className="grid content-start gap-5">
          <MangmeeCard className="p-5 sm:p-6">
            <h2 className="text-lg font-extrabold text-gray-900">ให้ส่วนลดเกินเพดานได้</h2>
            <p className="mb-3.5 mt-1 text-sm font-medium text-gray-500">
              ตำแหน่งที่อนุมัติส่วนลดเกิน {policy.maxPct}% ได้เป็นกรณีพิเศษ
            </p>
            {DISCOUNT_OVERRIDE_OPTIONS.map((option) => {
              const selected = policy.overrideRole === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setPolicy((state) => setDiscountOverrideRole(state, option.id))}
                  className={cx(
                    'mb-2 flex w-full items-center gap-[11px] rounded-[11px] border-[1.5px] px-3.5 py-3 text-left',
                    selected ? 'border-brand-400 bg-brand-25' : 'border-gray-200 bg-white hover:border-gray-300',
                  )}
                >
                  <span
                    className={cx(
                      'h-[18px] w-[18px] shrink-0 rounded-full border-2',
                      selected
                        ? 'border-brand-500 shadow-[inset_0_0_0_3px_#fff,inset_0_0_0_5px_var(--color-brand-500)]'
                        : 'border-gray-300',
                    )}
                  />
                  <span className="text-[15px] font-semibold text-gray-800">{option.label}</span>
                </button>
              );
            })}
          </MangmeeCard>

          <section className="rounded-2xl border border-brand-100 bg-brand-25 p-5">
            <h2 className="text-[16.5px] font-extrabold text-gray-900">หน้าที่อ้างอิงค่านี้</h2>
            <div className="mt-3 flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5 text-sm font-medium text-gray-700">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#7A5AF8]" />
                Auto AI ในกล่องข้อความ — ใช้ “ส่วนลดเริ่มต้น {policy.defaultPct}%”
              </div>
              <div className="flex items-center gap-2.5 text-sm font-medium text-gray-700">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#12B76A]" />
                หน้าการขาย / ออกบิล — เตือนเมื่อกรอกเกินเพดาน {policy.maxPct}%
              </div>
              <div className="flex items-center gap-2.5 text-sm font-medium text-gray-700">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#F79009]" />
                โปรโมชั่นอัตโนมัติ — คิดตามระดับลูกค้า
              </div>
            </div>
            <div className="mt-3.5 border-t border-brand-100 pt-3.5 text-[13px] font-medium leading-6 text-gray-500">
              แก้ค่าได้ที่หน้านี้ที่เดียว — เปลี่ยนแล้วมีผลกับทุกหน้าที่อ้างอิงทันที
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
