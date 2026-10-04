'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/common/components/button';
import { ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { useConfirm } from '@/common/components/modal';
import { listWhtIncomeCategories, setWhtIncomeCategoryStatus, type WhtIncomeCategory } from './wht-income-categories.api';
import { W, confirmation, formLabel, rateLabel, statusLabel } from './wht-income-categories.words';

// One markup for both widths. A phone reads each kind as two lines with its switch beside them, so
// nothing scrolls sideways; from `sm` the same cells line up under the column headings.
// The switch column has a fixed width so the headings and every row share the same tracks.
const COLUMNS = 'sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_5.5rem]';

export function WhtIncomeCategoryList({ rows, busyCode, savedCode, onToggle }: {
  rows: WhtIncomeCategory[];
  /** The one kind being switched: only its button shows the busy state. */
  busyCode: string | null;
  /** The kind whose switch was just saved, so the result is said where the admin is looking. */
  savedCode?: string | null;
  onToggle: (row: WhtIncomeCategory) => void;
}) {
  return <div className="rounded-xl border border-gray-200 bg-white text-sm">
    <div className={`hidden gap-x-3 rounded-t-xl bg-gray-50 p-3 font-semibold text-gray-600 sm:grid ${COLUMNS}`}>
      {[W.name, W.form, W.rate, W.status, W.action].map(label => <span key={label}>{label}</span>)}
    </div>
    <ul>{rows.map(row => {
      const active = row.status === 'ACTIVE';
      return <li key={row.code} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-gray-100 p-3 first:border-t-0 sm:first:border-t ${COLUMNS}`}>
        <span className="font-medium text-gray-900 [overflow-wrap:anywhere]">{row.nameTh}</span>
        <span className="col-start-1 flex flex-wrap gap-x-2 text-gray-600 sm:contents">
          <span>{formLabel(row.formType)}</span>
          <span><span className="sm:hidden">{W.rate} </span>{rateLabel(row.defaultRate)}</span>
          <span>{statusLabel(row.status)}{savedCode === row.code && <span role="status" className="ml-2 font-medium text-brand-800">{W.saved}</span>}</span>
        </span>
        <Button role="switch" aria-checked={active} aria-label={`${active ? W.disable : W.enable} ${row.nameTh}`}
          className="col-start-2 row-span-2 row-start-1 whitespace-nowrap sm:col-start-5 sm:row-span-1 sm:justify-self-start"
          variant="secondary" loading={busyCode === row.code} disabled={busyCode !== null} onClick={() => onToggle(row)}>{active ? W.disable : W.enable}</Button>
      </li>;
    })}</ul>
  </div>;
}

export default function WhtIncomeCategoriesPage() {
  const [rows, setRows] = useState<WhtIncomeCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [savedCode, setSavedCode] = useState<string | null>(null);
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
    if (busyCode) return;
    const enable = row.status !== 'ACTIVE';
    // Nothing is busy while the admin is still reading the confirmation; the dialog itself blocks the list.
    if (!(await confirm({ title: enable ? W.enable : W.disable, message: confirmation(row, enable), confirmLabel: W.confirm, cancelLabel: W.cancel, variant: enable ? 'primary' : 'danger' }))) return;
    setBusyCode(row.code); setSavedCode(null);
    try {
      const saved = await setWhtIncomeCategoryStatus(row.code, enable ? 'ACTIVE' : 'DRAFT');
      setRows(current => current?.map(item => item.code === saved.code ? saved : item) ?? null);
      setSavedCode(saved.code);
    } catch (cause) {
      if ((cause as { status?: number }).status === 403) setDenied(true);
      else setError(W.saveFailed);
    } finally { setBusyCode(null); }
  };

  return <section className="space-y-4">
    <h1 className="text-xl font-semibold text-gray-900">{W.title}</h1>
    <p className="text-sm text-gray-600">{W.description}</p>
    {denied ? <ForbiddenState helpText={W.accessHelp} /> : error ? <ErrorState description={error} onRetry={() => setReload(current => current + 1)} />
      : rows === null ? <LoadingState label={W.loading} />
        : rows.length === 0 ? <p className="text-gray-500">{W.empty}</p>
          : <WhtIncomeCategoryList rows={rows} busyCode={busyCode} savedCode={savedCode} onToggle={row => void toggle(row)} />}
    {confirmDialog}
  </section>;
}
