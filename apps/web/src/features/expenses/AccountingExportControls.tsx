'use client';

import { useState } from 'react';
import type { AccountingSoftwareExportResult } from '@watchdog-bms/contracts';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { inputClass, ghostClass } from './ExpensesUi';

export type AccountingExportFormat = 'accountant' | 'purchase_journal';

export function AccountingExportFormatSelect({ value, onChange, disabled }: { value: AccountingExportFormat; onChange: (value: AccountingExportFormat) => void; disabled?: boolean }) {
  const locale = useWorkspaceLocale();
  return <label className="block w-full space-y-1.5">
    <span className="block text-sm font-medium text-gray-700">{t('expenses.export_format', locale)}</span>
    <ThemedSelect className={`${inputClass} w-full`} aria-label={t('expenses.export_format', locale)} value={value} disabled={disabled}
      onChange={event => onChange(event.target.value as AccountingExportFormat)}>
      <option value="accountant">{t('expenses.export_accountant', locale)}</option>
      <option value="purchase_journal">{t('expenses.export_purchase_journal', locale)}</option>
    </ThemedSelect>
    {value === 'purchase_journal' && <span className="block text-sm text-gray-500">{t('expenses.export_purchase_hint', locale)}</span>}
  </label>;
}

export function AccountingExportFeedback({ result, onFallback, onChangeDates, busy }: {
  result: AccountingSoftwareExportResult; onFallback: () => void; onChangeDates: () => void; busy: boolean;
}) {
  const locale = useWorkspaceLocale();
  const [expanded, setExpanded] = useState(false);
  const message = (key: Parameters<typeof t>[0], count: number) => t(key, locale).replace('{count}', String(count));
  return <div className="space-y-3 text-sm" role="status">
    {result.files.length > 0 && <p className="font-semibold text-brand-700">{message('expenses.export_software_done', result.documentCount - result.excluded.length)}</p>}
    {result.unmappedCategories.length > 0 && <p>{message('expenses.export_unmapped', result.unmappedCategories.length)}</p>}
    {result.excluded.length > 0 ? <>
      <p>{message('expenses.export_excluded', result.excluded.length)}</p>
      <ActionGroup align="start">
        <button type="button" className={ghostClass} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t('expenses.export_view_items', locale)}</button>
        <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={onFallback}>{t('expenses.export_accountant_fallback', locale)}</button>
      </ActionGroup>
      {expanded && <ul className="space-y-2">{result.excluded.map((entry, index) => <li key={index}><span className="mangmee-unit">{entry.expenseNumber}</span> · {entry.detail}</li>)}</ul>}
    </> : result.documentCount === 0 && <>
      <p>{t('expenses.export_software_empty', locale)}</p>
      <ActionGroup align="start"><button type="button" className={ghostClass} onClick={onChangeDates}>{t('expenses.export_change_dates', locale)}</button></ActionGroup>
    </>}
  </div>;
}
