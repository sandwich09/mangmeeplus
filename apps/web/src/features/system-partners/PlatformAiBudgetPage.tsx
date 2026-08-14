'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { useToast } from '@/common/components/toast';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { parseBudgetBahtInput, satangToBaht, satangToBahtInput } from './ai-budget.logic';
import { getPlatformAiBudget, setPlatformAiBudget } from './system-partners.api';
import type { PlatformAiBudgetDto } from './system-partners.api';

const inputClass = 'mangmee-input';
const btnPrimary = 'mangmee-btn mangmee-btn-primary disabled:opacity-50';

/** Says where the value in force comes from, so nobody edits a number the platform is ignoring. */
function SourceNote({ source }: { source: 'db' | 'env' }) {
  return (
    <p className="mt-1 text-xs text-gray-400">
      {source === 'db' ? 'from platform settings' : 'environment default'}
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
            ? 'You do not have permission to manage platform AI budget settings.'
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
      toast.success('Platform AI budget settings saved.');
    } catch (err) {
      // Reviewed API codes/messages keep their actionable copy; unknown diagnostics stay hidden.
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink href="/system/partners" label="กลับไปรายชื่อพาร์ทเนอร์" />

        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/system/partners" className="hover:text-brand-700">Partners</Link>
          <span>/</span>
          <span className="text-gray-900 font-medium">Platform AI Budget</span>
        </div>

        <div>
          <h1 className="text-xl font-semibold text-gray-900">Platform AI Budget</h1>
          <p className="text-sm text-gray-500 mt-1">
            The monthly AI spend cap every partner company inherits when it has no company override,
            and the ceiling those overrides cannot exceed. Amounts are in baht, up to two decimals.
          </p>
        </div>

        {loadError ? (
          <p className="text-sm text-red-600">{loadError}</p>
        ) : !budget ? (
          <div className="h-40 rounded-lg border border-gray-100 animate-pulse" />
        ) : (
          <>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <strong>Currently in force:</strong> monthly default {satangToBaht(budget.monthlyBudgetSatang)},
              ceiling {satangToBaht(budget.ceilingSatang)}. Without these settings the platform falls back to
              its environment values ({satangToBaht(budget.envDefaults.monthlyBudgetSatang)} and{' '}
              {satangToBaht(budget.envDefaults.ceilingSatang)}). Lowering the ceiling gates new company
              overrides only — existing higher overrides keep enforcing as they are.
            </div>

            <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5" htmlFor="platform-ai-monthly-budget">
                  Monthly budget default (฿) *
                </label>
                <input
                  id="platform-ai-monthly-budget"
                  className={inputClass}
                  type="number"
                  min={1}
                  step={0.01}
                  inputMode="decimal"
                  value={defaultInput}
                  onChange={(e) => setDefaultInput(e.target.value)}
                  disabled={saving}
                />
                <SourceNote source={budget.source.monthlyBudgetSatang} />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-0.5" htmlFor="platform-ai-ceiling">
                  Company override ceiling (฿) *
                </label>
                <input
                  id="platform-ai-ceiling"
                  className={inputClass}
                  type="number"
                  min={1}
                  step={0.01}
                  inputMode="decimal"
                  value={ceilingInput}
                  onChange={(e) => setCeilingInput(e.target.value)}
                  disabled={saving}
                />
                <SourceNote source={budget.source.ceilingSatang} />
              </div>

              <button type="button" className={btnPrimary} disabled={saving} onClick={() => void handleSave()}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
