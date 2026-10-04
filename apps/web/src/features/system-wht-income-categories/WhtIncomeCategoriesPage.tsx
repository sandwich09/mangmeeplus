'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/common/components/button';
import { ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { useConfirm } from '@/common/components/modal';
import { listWhtIncomeCategories, setWhtIncomeCategoryStatus, type WhtIncomeCategory } from './wht-income-categories.api';
import { W, confirmation, formLabel, rateLabel, statusLabel } from './wht-income-categories.words';

export function WhtIncomeCategoryList({ rows, busy, onToggle }: {
  rows: WhtIncomeCategory[];
  busy: boolean;
  onToggle: (row: WhtIncomeCategory) => void;
}) {
  return <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
    <table className="w-full text-left text-sm">
      <thead className="bg-gray-50 text-gray-600"><tr>
        {[W.name, W.form, W.rate, W.status, W.action].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}
      </tr></thead>
      <tbody>{rows.map(row => {
        const active = row.status === 'ACTIVE';
        return <tr key={row.code} className="border-t border-gray-100">
          <th scope="row" className="p-3 font-medium">{row.nameTh}</th>
          <td className="whitespace-nowrap p-3">{formLabel(row.formType)}</td>
          <td className="p-3">{rateLabel(row.defaultRate)}</td>
          <td className="whitespace-nowrap p-3">{statusLabel(row.status)}</td>
          <td className="p-3"><Button role="switch" aria-checked={active} aria-label={`${active ? W.disable : W.enable} ${row.nameTh}`}
            variant="secondary" loading={busy} disabled={busy} onClick={() => onToggle(row)}>{active ? W.disable : W.enable}</Button></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export default function WhtIncomeCategoriesPage() {
  const [rows, setRows] = useState<WhtIncomeCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const { confirm, confirmDialog } = useConfirm();

  useEffect(() => {
    const controller = new AbortController();
    setRows(null); setError(null); setDenied(false);
    listWhtIncomeCategories(controller.signal).then(result => {
      if (!controller.signal.aborted) setRows(result);
    }).catch((cause: { status?: number }) => {
      if (controller.signal.aborted) return;
      if (cause.status === 403) setDenied(true);
      else setError(W.loadFailed);
    });
    return () => controller.abort();
  }, [reload]);

  const toggle = async (row: WhtIncomeCategory) => {
    if (busy) return;
    setBusy(true);
    const enable = row.status !== 'ACTIVE';
    try {
      if (!(await confirm({ title: enable ? W.enable : W.disable, message: confirmation(row, enable), confirmLabel: W.confirm, cancelLabel: W.cancel, variant: enable ? 'primary' : 'danger' }))) return;
      const saved = await setWhtIncomeCategoryStatus(row.code, enable ? 'ACTIVE' : 'DRAFT');
      setRows(current => current?.map(item => item.code === saved.code ? saved : item) ?? null);
    } catch (cause) {
      if ((cause as { status?: number }).status === 403) setDenied(true);
      else setError(W.saveFailed);
    } finally { setBusy(false); }
  };

  return <section className="space-y-4">
    <h1 className="text-xl font-semibold text-gray-900">{W.title}</h1>
    <p className="text-sm text-gray-600">{W.description}</p>
    {denied ? <ForbiddenState helpText={W.accessHelp} /> : error ? <ErrorState description={error} onRetry={() => setReload(current => current + 1)} />
      : rows === null ? <LoadingState label={W.loading} />
        : rows.length === 0 ? <p className="text-gray-500">{W.empty}</p>
          : <WhtIncomeCategoryList rows={rows} busy={busy} onToggle={row => void toggle(row)} />}
    {confirmDialog}
  </section>;
}
