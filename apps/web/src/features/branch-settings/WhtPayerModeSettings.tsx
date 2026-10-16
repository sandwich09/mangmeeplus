'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { WhtPayerMode, WhtPayerModeDto } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { primaryButtonClass, secondaryButtonClass } from '@/common/components/button';
import { SelectField } from '@/common/components/field';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { MangmeeCard } from '@/common/components/mangmee';
import { Notice } from '@/common/components/notice';
import { formatThaiMonth } from '@/common/i18n/thai-date';
import { answerWhtPayerMode, getWhtPayerMode } from '../tax/tax.api';

export const payerModeLabels = { HEAD_OFFICE_PAYS_ALL: 'สำนักงานใหญ่จ่ายทั้งหมด', EACH_BRANCH_PAYS: 'แต่ละสาขาจ่ายเอง' };
export function withholdingReturn(search: string, companyId: string) {
  const params = new URLSearchParams(search), month = params.get('periodKey');
  return params.get('from') === 'withholding' && month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    ? `/companies/${companyId}/tax/withholding?periodKey=${month}` : null;
}
export function offeredPayerMonth(error: unknown): string | null {
  const month = (error as { details?: { firstAllowedPeriodKey?: unknown } })?.details?.firstAllowedPeriodKey;
  return typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
}
export function WhtPayerModeSettings({ companyId, canAnswer, returnHref, onMode }: {
  companyId: string; canAnswer: boolean; returnHref: string | null; onMode: (mode: WhtPayerMode | null) => void;
}) {
  const [fact, setFact] = useState<WhtPayerModeDto | null>(null);
  const [mode, setMode] = useState<WhtPayerMode | ''>('');
  const [month, setMonth] = useState(returnHref?.split('periodKey=')[1] ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState('');
  async function load() {
    setLoading(true); setReadError('');
    try { const value = await getWhtPayerMode(companyId, month); setFact(value); setMode(value.mode ?? ''); onMode(value.mode); }
    catch (e) { setReadError(apiErrorMessage(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [companyId]);
  async function save() {
    if (!canAnswer || busy || loading) return;
    if (!mode) { setError('เลือกผู้ที่จ่ายเงินและหักภาษีก่อนบันทึก'); return; }
    setBusy(true); setError(''); setSaved('');
    try {
      const value = await answerWhtPayerMode(companyId, { mode, effectiveFromPeriodKey: month });
      setFact(value); onMode(value.mode); setSaved(`บันทึกวิธีจ่ายแล้ว ใช้ตั้งแต่เดือน ${formatThaiMonth(value.periodKey)}`);
    } catch (e) { const offered = offeredPayerMonth(e); if (offered) setMonth(offered); setError(apiErrorMessage(e)); }
    finally { setBusy(false); }
  }
  return <MangmeeCard className="space-y-4 p-4">
    <h2 className="text-lg font-semibold">ใครจ่ายเงินและหักภาษี</h2>
    <p>แบบภาษีหัก ณ ที่จ่ายยื่นในนามผู้ที่จ่ายจริง</p>
    {readError && <Notice tone="error" action={<button className={secondaryButtonClass} type="button" disabled={loading} aria-busy={loading} onClick={() => void load()}>ลองอีกครั้ง</button>}>{readError}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    {saved && <Notice tone="success" action={returnHref ? <Link href={returnHref} className="underline">กลับไปภาษีหัก ณ ที่จ่าย</Link> : undefined}>{saved}</Notice>}
    {canAnswer ? <form onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id="wht-payer-mode" label="ผู้ที่จ่ายเงินและหักภาษี" value={mode} onChange={e => { setMode(e.target.value as WhtPayerMode); setError(''); setSaved(''); }}>
          <option value="">เลือกผู้ที่จ่ายเงินและหักภาษี</option>
          {Object.entries(payerModeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </SelectField>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700"><span>ใช้ตั้งแต่เดือน</span><ThemedDate id="wht-payer-month" aria-label="ใช้ตั้งแต่เดือน" mode="month" allowClear={false} value={month} onChange={e => { setMonth(e.target.value); setError(''); setSaved(''); }} /></label>
      </div>
      <FormActionBar><ActionGroup><button type="submit" className={primaryButtonClass} disabled={busy || loading} aria-busy={busy || loading}>บันทึกวิธีจ่าย</button></ActionGroup></FormActionBar>
    </form> : <p>{fact?.mode ? payerModeLabels[fact.mode] : fact ? 'ยังไม่ได้บอกว่าใครจ่ายเงินและหักภาษี ให้ผู้ที่แก้ไขข้อมูลร้านได้เป็นผู้บันทึก' : 'กำลังโหลด…'}</p>}
  </MangmeeCard>;
}
