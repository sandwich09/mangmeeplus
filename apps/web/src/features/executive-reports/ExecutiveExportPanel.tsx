'use client';
import { useEffect, useRef, useState } from 'react';
import { EXECUTIVE_EXPORT_SHEETS, EXECUTIVE_WORDS as W, executiveExportColumns, executiveComparisonLabel, type ExecutiveContext } from '@watchdog-bms/contracts';
import { Button } from '@/common/components/button';
import { reportDateTime, reportMonth, type ReportSection } from './executive-reports.logic';
import { canExportContacts, createExportAction, exportBody, exportFileName, type ExportState } from './executive-export.logic';
import { getExecutiveExport, downloadExecutiveExport, type ReportData } from './executive-reports.api';
import { thaiLabel } from './executive-reports.words';

export function ExecutiveExportPanel({ section, params, context, data, search, targetCompanyId, close, reload, deny }: {
  section: ReportSection; params: URLSearchParams; context: ExecutiveContext; data: ReportData; search: string; targetCompanyId?: string;
  close: () => void; reload: () => void; deny: () => void;
}) {
  const [contacts, setContacts] = useState(false), [state, setState] = useState<ExportState | null>(null), [wait, setWait] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const action = useRef<ReturnType<typeof createExportAction> | null>(null);
  useEffect(() => {
    abort.current = new AbortController();
    action.current = createExportAction({ request: getExecutiveExport, download: downloadExecutiveExport, reload,
      state: next => { setState(next); setWait(next.retryAfterSeconds ?? 0); if (next.kind === 'denied') deny(); } });
    return () => abort.current?.abort();
  }, [context, data.build.id, reload, deny]);
  useEffect(() => { if (!wait) return; const timer = setTimeout(() => setWait(n => n - 1), 1000); return () => clearTimeout(timer); }, [wait]);
  const body = exportBody(section, params, context, data.build.id, search, targetCompanyId, contacts);
  const n = 'pagination' in data ? data.pagination.total : 'company' in data ? 1 : 'comparison' in data && data.comparison ? (data.comparison.sideA.companies.value ?? data.comparison.sideA.companies.knownValue ?? 0) + (data.comparison.sideB.companies.value ?? data.comparison.sideB.companies.knownValue ?? 0) : data.population.eligibleCount.value ?? data.population.eligibleCount.knownValue ?? 0;
  const labels = [...Object.values(data.appliedFilters.global), ...Object.values(data.appliedFilters.directory)].filter(option => option.value !== 'ALL').map(option => thaiLabel(option.label, option.value));
  if ('comparison' in data && data.comparison) labels.push(`${W.sideA} · ${executiveComparisonLabel(data.comparison.sideA, data.comparison.dimension)}`, `${W.sideB} · ${executiveComparisonLabel(data.comparison.sideB, data.comparison.dimension)}`);
  if (search) labels.push(`${W.search} · ${search}`);
  const unavailable = 'company' in data && !data.month;
  const blocked = unavailable ? W.noData : !n ? W.export.empty : null;
  return <section className="min-w-0 space-y-3" aria-label={W.export.action}>
    <Button variant="secondary" onClick={close}>{W.back(W[section])}</Button>
    <p>{W[section]} · {reportMonth(data.period.month)}</p>
    <p>{W.through(reportDateTime(data.dataThrough.oldest))} · {W.found(n)}</p>
    <p>{W.filters} · {labels.join(' · ') || W.export.none}</p>
    <p>{W.excluded}</p>
    <Button loading={state?.kind === 'preparing'} disabled={!!blocked || state?.kind === 'preparing' || wait > 0} onClick={() => {
      if (abort.current && action.current) void action.current.run(body, exportFileName(section, body.month), abort.current.signal);
    }}>{state?.kind === 'preparing' ? W.export.preparing : W.export.create}</Button>
    {blocked && <p role="status">{blocked}</p>}
    {state && <p role={state.kind === 'error' || state.kind === 'denied' ? 'alert' : 'status'}>{state.text}</p>}
    {wait > 0 && <p role="status">{W.wait(wait)}</p>}
    {canExportContacts(section, context) && <label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={contacts} disabled={state?.kind === 'preparing'} onChange={event => setContacts(event.target.checked)} className="mt-1 size-5" /><span>{W.export.contacts}<span className="block text-sm">{W.export.contactHint}</span></span></label>}
    <p>{W.export.sheets} · {EXECUTIVE_EXPORT_SHEETS.join(' · ')}</p>
    <p>{W.export.columns} · {executiveExportColumns(section, body.subview, body.includeContacts).join(' · ')}</p>
    <p>{W.export.format}</p>
  </section>;
}
