'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { useToast } from '@/common/components/toast';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { parseBudgetBahtInput, satangToBaht, satangToBahtInput } from './ai-budget.logic';
import { getPlatformAiBudget, setPlatformAiBudget } from './system-partners.api';
import type { PlatformAiBudgetDto } from './system-partners.api';

const inputClass = 'mangmee-input min-h-11 text-base';
const btnPrimary = 'mangmee-btn mangmee-btn-primary min-h-11 text-base disabled:opacity-50';

/** Says where the value in force comes from, so nobody edits a number the platform is ignoring. */
function SourceNote({ source }: { source: 'db' | 'env' }) {
  return (
    <p className="mt-1 text-xs text-gray-400">
      {source === 'db' ? 'ค่าที่ผู้ดูแลบันทึก' : 'ค่าเริ่มต้นของระบบ'}
    </p>
  );
}

export default function PlatformAiBudgetPage() {
  const toast = useToast();
  const [budget, setBudget] = useState<PlatformAiBudgetDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [defaultInput, setDefaultInput] = useState('');
  const [ceilingInput, setCeilingInput] = useState('');
  const [saving, setSaving] = useState(false);
  const apply = (result: PlatformAiBudgetDto) => {
    setBudget(result);
    setDefaultInput(satangToBahtInput(result.monthlyBudgetSatang));
    setCeilingInput(satangToBahtInput(result.ceilingSatang));
  };

  useEffect(() => {
    void (async () => {
      try {
        apply(await getPlatformAiBudget());
        setLoadError(null);
      } catch (err) {
        const e = err as Error & { status?: number };
        setLoadError(
          e.status === 403
            ? 'คุณไม่มีสิทธิ์ตั้งค่างบ AI กลาง กรุณาติดต่อผู้ดูแลระบบ'
            : apiErrorMessage(err),
        );
      }
    })();
  }, []);

  const handleSave = async () => {
    const satang: number[] = [];
    for (const raw of [defaultInput, ceilingInput]) {
      const parsed = parseBudgetBahtInput(raw);
      if (!parsed.ok) {
        toast.error(parsed.message);
        return;
      }
      // Empty means "inherit" for a company override; the platform itself has nothing to inherit.
      if (parsed.monthlyBudgetSatang === null) {
        toast.error('กรุณาระบุงบประมาณรายเดือนเริ่มต้นและเพดานรายเดือนให้ครบ');
        return;
      }
      satang.push(parsed.monthlyBudgetSatang);
    }
    const [monthlyBudgetSatang, ceilingSatang] = satang as [number, number];

    setSaving(true);
    try {
      apply(await setPlatformAiBudget({ monthlyBudgetSatang, ceilingSatang }));
      toast.success('บันทึกงบ AI กลางแล้ว');
    } catch (err) {
      // Reviewed API codes/messages keep their actionable copy; unknown diagnostics stay hidden.
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink href="/system/partners" label="กลับไปรายชื่อพาร์ทเนอร์" />

        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/system/partners" className="hover:text-brand-700">บริษัท</Link>
          <span>/</span>
          <span className="text-gray-900 font-medium">งบ AI กลาง</span>
        </div>

        <div>
          <h1 className="text-xl font-semibold text-gray-900">งบ AI กลาง</h1>
          <p className="text-sm text-gray-500 mt-1">
            บริษัทที่ไม่ได้ตั้งงบเฉพาะจะใช้งบเริ่มต้นนี้ ส่วนเพดานใช้จำกัดงบที่ผู้ดูแลตั้งให้แต่ละบริษัท
          </p>
        </div>

        {loadError ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-red-600">{loadError}</p>
            <button type="button" className={btnPrimary} onClick={() => window.location.reload()}>ลองโหลดใหม่</button>
          </div>
        ) : !budget ? (
          <div className="h-40 rounded-lg border border-gray-100 animate-pulse" />
        ) : (
          <>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <strong>ค่าที่ใช้อยู่:</strong> งบเริ่มต้น {satangToBaht(budget.monthlyBudgetSatang)} ต่อเดือน
              เพดาน {satangToBaht(budget.ceilingSatang)} ต่อบริษัท
              การลดเพดานมีผลกับการตั้งงบครั้งต่อไป งบเฉพาะบริษัทที่ตั้งสูงไว้แล้วจะยังคงเดิม
            </div>

            <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1" htmlFor="platform-ai-monthly-budget">
                  งบเริ่มต้นต่อเดือน (บาท) *
                </label>
                <input
                  id="platform-ai-monthly-budget"
                  className={inputClass}
                  type="text"
                  inputMode="decimal"
                  value={defaultInput}
                  onChange={(e) => setDefaultInput(e.target.value)}
                  disabled={saving}
                />
                <SourceNote source={budget.source.monthlyBudgetSatang} />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1" htmlFor="platform-ai-ceiling">
                  เพดานงบที่ตั้งให้แต่ละบริษัท (บาท) *
                </label>
                <input
                  id="platform-ai-ceiling"
                  className={inputClass}
                  type="text"
                  inputMode="decimal"
                  value={ceilingInput}
                  onChange={(e) => setCeilingInput(e.target.value)}
                  disabled={saving}
                />
                <SourceNote source={budget.source.ceilingSatang} />
              </div>

              <button type="button" className={btnPrimary} disabled={saving} onClick={() => void handleSave()}>
                {saving ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
