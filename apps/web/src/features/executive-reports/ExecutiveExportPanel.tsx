'use client';
import { useEffect, useRef, useState } from 'react';
import { EXECUTIVE_EXPORT_SHEETS, EXECUTIVE_WORDS as W, executivePeriodExportColumns, type ExecutiveContext } from '@watchdog-bms/contracts';
import { Button } from '@/common/components/button';
import { ChevronDownIcon } from '@/common/icons';
import { ExecutiveSectionCard, ReportNotes } from './ExecutiveReportDesign';
import { reportDateTime, periodText, type ReportSection } from './executive-reports.logic';
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
  const n = 'pagination' in data ? data.pagination.total : 'company' in data ? 1 : data.population.eligibleCount.value ?? data.population.eligibleCount.knownValue ?? 0;
  const labels = [...Object.values(data.appliedFilters.global), ...Object.values(data.appliedFilters.directory)].filter(option => option.value !== 'ALL').map(option => thaiLabel(option.label, option.value));
  if (search) labels.push(`${W.search} · ${search}`);
  const unavailable = 'company' in data && !(data.periodSummary === undefined ? data.month : data.periodSummary);
  const blocked = unavailable ? W.noData : !n ? W.export.empty : null;
  return <ReportNotes data={data}><ExecutiveSectionCard title={W.export.action} actions={<Button variant="secondary" onClick={close}>{W.back(W[section])}</Button>}><section className="space-y-4" aria-label={W.export.action}>
    <p>{W[section]} · {periodText(data.period)}</p>
    <p>{W.through(reportDateTime(data.dataThrough.oldest))} · {W.found(n)}</p>
    <p>{W.filters} · {labels.join(' · ') || W.export.none}</p>
    <p>{W.excluded}</p>
    {canExportContacts(section, context) && <label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={contacts} disabled={state?.kind === 'preparing'} onChange={event => setContacts(event.target.checked)} className="mt-1 size-5 accent-brand-700 focus-visible:outline-brand-700" /><span>{W.export.contacts}<span className="block text-sm">{W.export.contactHint}</span></span></label>}
    <Button loading={state?.kind === 'preparing'} disabled={!!blocked || state?.kind === 'preparing' || wait > 0} onClick={() => {
      if (abort.current && action.current) void action.current.run(body, exportFileName(section, body.from!, new Date(), body.to), abort.current.signal);
    }}>{state?.kind === 'preparing' ? W.export.preparing : W.export.create}</Button>
    {blocked && <p role="status">{blocked}</p>}
    {state && <p role={state.kind === 'error' || state.kind === 'denied' ? 'alert' : 'status'}>{state.text}</p>}
    {wait > 0 && <p role="status">{W.wait(wait)}</p>}
    <div className="executive-export-sheets"><p className="text-sm font-semibold text-gray-600">{W.export.sheets}</p><ul className="mt-2 list-inside list-disc text-sm text-gray-700">{EXECUTIVE_EXPORT_SHEETS.map(sheet => <li key={sheet}>{sheet}</li>)}</ul></div>
    <details className="group"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg p-2 font-semibold text-brand-800 hover:bg-gray-50 focus-visible:outline-brand-700">{W.export.columns}<ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 group-open:rotate-180" /></summary><ul className="list-inside list-disc py-3 text-sm text-gray-600">{executivePeriodExportColumns(section, body.subview, body.includeContacts).map(column => <li key={column}>{column}</li>)}</ul></details>
    <p>{W.export.format}</p>
  </section></ExecutiveSectionCard></ReportNotes>;
}
