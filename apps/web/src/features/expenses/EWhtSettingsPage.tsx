'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { E_WHT_WORDS } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { primaryButtonClass, secondaryButtonClass } from '@/common/components/button';
import { ChoiceRow } from '@/common/components/field';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { Notice } from '@/common/components/notice';
import { LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { getExpenseEWhtSetting, updateExpenseEWhtSetting } from './expenses.api';

export function EWhtSettingsPage({ companyId }: { companyId: string }) {
  const [used, setUsed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const toast = useToast();
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setError(''); setUsed(null);
    try {
      const setting = await getExpenseEWhtSetting(companyId);
      if (current === request.current) setUsed(setting.used);
    } catch (e) { if (current === request.current) setError(apiErrorMessage(e)); }
    finally { if (current === request.current) setLoading(false); }
  }, [companyId]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  async function save() {
    if (used === null || saving || loading) return;
    setSaving(true); setError('');
    try {
      const setting = await updateExpenseEWhtSetting(companyId, { used });
      setUsed(setting.used);
      toast.success(E_WHT_WORDS[setting.used ? 'S-6' : 'S-7']);
    } catch (e) { setError(apiErrorMessage(e)); }
    finally { setSaving(false); }
  }
  return <MangmeePage title={E_WHT_WORDS['S-1']} back={<BackLink href={`/companies/${companyId}/settings`} label="กลับไปตั้งค่า" />}>
    {loading ? <LoadingState /> : used === null ? <Notice tone="error" action={<button type="button" className={secondaryButtonClass} onClick={() => void load()}>ลองอีกครั้ง</button>}>{error}</Notice> :
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
        <MangmeeCard className="space-y-3 p-4 sm:p-6">
          <fieldset disabled={saving} className="min-w-0 space-y-3">
            <legend className="text-base font-semibold">{E_WHT_WORDS['S-3']}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceRow framed name="e-wht-used" label={E_WHT_WORDS['S-4'].no} checked={!used} onChange={() => setUsed(false)} />
              <ChoiceRow framed name="e-wht-used" label={E_WHT_WORDS['S-4'].yes} checked={used} onChange={() => setUsed(true)} />
            </div>
            <p className="text-sm text-gray-600">{E_WHT_WORDS['S-5']}</p>
          </fieldset>
        </MangmeeCard>
        {error && <Notice tone="error">{error}</Notice>}
        <FormActionBar><ActionGroup><button type="submit" className={primaryButtonClass} disabled={saving} aria-busy={saving}>บันทึก</button></ActionGroup></FormActionBar>
      </form>}
  </MangmeePage>;
}
