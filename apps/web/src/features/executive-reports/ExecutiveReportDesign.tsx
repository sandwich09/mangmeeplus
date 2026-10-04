'use client';

import Link from 'next/link';
import { createContext, useContext, useEffect, useId, useState, isValidElement, Children, type ReactNode, type CSSProperties } from 'react';
import { EXECUTIVE_PERIOD_WORDS as P, executiveMonthLabel, executivePeriodComparisonQualifier, executiveMoneyQualifier, type ExecutiveCount, type ExecutiveMoney, type ExecutiveEnvelope, type ExecutiveCoverage, type ExecutivePeriodComparison } from '@watchdog-bms/contracts';
import { MangmeeCard } from '@/common/components/mangmee';
import { ChevronDownIcon } from '@/common/icons';
import { DesignIcons } from '@/features/web-core-workspace/design-icons';
import { W } from './executive-reports.words';
import { countText, moneyText, reasonText, figureNumber, shortFigureNumber, hoistedSource, reportDate, reportDateTime } from './executive-reports.logic';

export const EXECUTIVE_PAGE_CLASS = 'min-w-0 text-gray-900 [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-brand-700';
export function ExecutivePage({ eyebrow, title, description, actions, controls, children, compact = false, className = '' }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; controls?: ReactNode; children: ReactNode; compact?: boolean; className?: string }) {
  return <div className={`flex min-w-0 flex-col ${compact ? 'gap-2' : 'gap-4'} ${className}`}>
    <header className={`relative flex min-w-0 flex-wrap items-center justify-between after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-linear-to-r after:from-gold-500 after:to-transparent ${compact ? 'gap-2 pb-1' : 'gap-3 pb-3'}`}>
      <div className={compact ? 'min-w-0 flex-1' : 'min-w-0'}>{eyebrow && <div data-breadcrumb className={compact ? 'sr-only' : 'mb-1 text-xs font-semibold text-brand-800'}>{eyebrow}</div>}<h1 className={`font-semibold text-brand-800 ${compact ? 'truncate text-xl leading-7 md:text-2xl md:leading-8' : 'text-2xl sm:text-3xl'}`} title={typeof title === 'string' ? title : undefined}>{title}</h1>{description && <p className={compact ? 'truncate text-sm leading-5 text-gray-600' : 'mt-1 text-sm text-gray-600'} title={typeof description === 'string' ? description : undefined}>{description}</p>}</div>
      {controls && <div className="min-w-0 max-xl:order-last max-xl:basis-full">{controls}</div>}
      {actions && <div className={`flex min-w-0 flex-wrap items-center gap-2 ${compact && !controls ? 'max-md:basis-full' : ''}`}>{actions}</div>}
    </header>{children}
  </div>;
}
export const ReasonNotes = createContext(false);
const ColumnMark = createContext<Record<string, readonly string[]> | null>(null);
const KpiScale = createContext({ digits: 11, size: 18 });
type FigureProps = { value: ExecutiveCount | ExecutiveMoney; moneyValue?: boolean; netValue?: boolean; measured?: boolean; source?: string; mark?: boolean; unit?: string; /** A chart label: a phone prints the short figure; the full one stays in the accessible name. */ short?: boolean };
const reasons = (value: { reasonCodes: readonly string[]; coverage: ExecutiveCoverage; affectedMonths?: Array<{ month: string; reasonCodes: readonly string[] }> }) => [...new Set(value.reasonCodes.map(code => reasonText(code, value.coverage, value.affectedMonths?.filter(m => m.reasonCodes.includes(code)).map(m => m.month))))].join(' · ');
export function IncompleteDot({ reason }: { reason: string }) {
  return <span role="img" aria-label={`${W.incompleteLegend}${reason && reason !== W.incompleteLegend ? ` — ${reason}` : ''}`} title={reason || W.incompleteLegend} className="executive-dot ml-1 inline-block size-1.5 shrink-0 rounded-full bg-gold-500 align-middle" />;
}
export function Figure({ value, moneyValue = false, netValue = false, measured = false, source = measured ? 'aiCost' : moneyValue ? 'money' : 'usage', mark = true, unit, short = false }: FigureProps) {
  const columnCodes = useContext(ColumnMark)?.[source];
  const reason = reasons(value);
  const qualified = value.value === null && value.knownValue === undefined ? W.unavailableFigure : moneyValue ? moneyText(value as ExecutiveMoney, measured) : countText(value);
  const negative = netValue && value.coverage === 'complete' && (value.value ?? 0) < 0 ? W.negative : '';
  const showDot = mark && value.coverage !== 'complete' && (columnCodes === undefined || value.reasonCodes.some(code => !columnCodes.includes(code)));
  return <span className={`executive-figure relative inline-flex items-center whitespace-nowrap tabular-nums ${unit ? 'mr-3' : ''} ${(value.value ?? value.knownValue) === 0 ? 'text-gray-600' : moneyValue && (value.value ?? value.knownValue ?? 0) < 0 ? 'text-red-700' : ''}`} aria-label={[`${qualified}${unit && !moneyValue ? ` ${unit}` : ''}`, reason, negative].filter(Boolean).join(' — ')}>
    {short ? <><span className="md:hidden">{shortFigureNumber(value, moneyValue)}</span><span className="max-md:hidden">{figureNumber(value, moneyValue)}</span></> : figureNumber(value, moneyValue)}{unit && <span className="ml-1">{unit}</span>}{showDot && <span className="absolute left-full top-1/2 -translate-y-1/2"><IncompleteDot reason={reason} /></span>}
  </span>;
}
// The old ReasonNotes mechanism now has one expandable, unnumbered detail per page.
export function reportNotes(data: unknown): string[] {
  const envelope = data as ExecutiveEnvelope;
  if (envelope?.sourceStatus) return sourceStatusNotes(envelope, ['money', 'usage', 'aiCost']).map(note => note.text);
  const notes = new Set<string>();
  const noteCounts = new Map<string, number>();
  function visit(node: unknown) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const object = node as Record<string, unknown>;
    if (Array.isArray(object.reasonCodes)) for (const code of object.reasonCodes) if (typeof code === 'string') notes.add(reasonText(code, object.coverage as ExecutiveCoverage | undefined));
    for (const key of ['reason', 'usageUnassessedReason']) if (typeof object[key] === 'string') notes.add(reasonText(object[key] as string));
    if (Array.isArray(object.monthReasonCodes)) for (const code of object.monthReasonCodes) notes.add(reasonText(String(code)));
    if (object.byReason && typeof object.byReason === 'object') for (const [code, n] of Object.entries(object.byReason)) if (Number(n) > 0) noteCounts.set(reasonText(code), Number(n));
    for (const [key, child] of Object.entries(object)) if (!(key === 'items' && object.pagination && object.summary)) visit(child);
  }
  visit(data);
  const paid = (data as { paidUsage?: { usageUnassessed?: { count: number }; paymentUnknown?: { count: number } } })?.paidUsage;
  if (paid?.usageUnassessed?.count) notes.add(reasonText('ACTIVITY_HISTORY_INCOMPLETE'));
  if (paid?.paymentUnknown?.count) notes.add(reasonText('PAYMENT_HISTORY_INCOMPLETE'));
  for (const [note, n] of noteCounts) { notes.delete(note); notes.add(`${note} · ${n.toLocaleString('th-TH')} ${W.unitCompany}`); }
  return [...notes];
}
type StatusSource = keyof ExecutiveEnvelope['sourceStatus'];
export function sourceStatusNotes(data: ExecutiveEnvelope, sources: StatusSource[], periodOnly = false): Array<{ source: string; text: string }> {
  const seen = new Set<string>();
  const notes: Array<{ source: string; text: string }> = sources.flatMap(source => {
    const status = data.sourceStatus[source];
    return status.reasonCodes.flatMap(code => {
      const months = status.affectedMonths?.filter(m => m.reasonCodes.includes(code)).map(m => m.month) ?? [];
      const shownMonths = periodOnly ? months.filter(month => month >= (data.period.from ?? data.period.month) && month <= (data.period.to ?? data.period.month)) : months;
      if (periodOnly && months.length && !shownMonths.length) return [];
      const sentence = reasonText(code, status.coverage, shownMonths);
      const text = shownMonths.length && !['RANGE_MONTH_NOT_BUILT', 'MONTH_SUMMARY_INCOMPLETE'].includes(code) ? `${sentence} · ${P.affectedMonths(shownMonths.map(executiveMonthLabel).join(', '))}` : sentence;
      if (seen.has(text)) return [];
      seen.add(text); return [{ source, text }];
    });
  });
  const detail = data as ExecutiveEnvelope & { periodReasonCodes?: string[]; periodSummary?: { usage: { activeUsersCoverage: { reasonCodes: string[]; coverage: ExecutiveCoverage } } } | null };
  const extra = [...(data.population?.eligibleCount.reasonCodes ?? []).map(code => ({ code, source: 'company', coverage: data.population.eligibleCount.coverage })), ...(detail.periodReasonCodes ?? []).map(code => ({ code, source: 'company', coverage: undefined })), ...(sources.includes('aiCost') ? (detail.periodSummary?.usage.activeUsersCoverage?.reasonCodes ?? []).map(code => ({ code, source: 'usage', coverage: detail.periodSummary!.usage.activeUsersCoverage.coverage })) : [])];
  for (const { code, source, coverage } of extra) {
    if (sources.some(source => data.sourceStatus[source].reasonCodes.some(reason => reason === code))) continue;
    const text = code === 'NOT_YET_REGISTERED' ? P.periodNotRegistered : reasonText(code, coverage);
    if (!seen.has(text)) { notes.push({ source, text }); seen.add(text); }
  }
  return notes;
}
function SourceStatus({ data, sources, periodOnly }: { data: ExecutiveEnvelope; sources: StatusSource[]; periodOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const notes = sourceStatusNotes(data, sources, periodOnly);
  const labels: Record<string, string> = { money: W.moneySource, usage: W.usage, aiCost: W.aiCostSource, company: W.companyTab };
  const incomplete = sources.filter(source => (periodOnly ? data.coverage[source] : data.sourceStatus[source]).coverage !== 'complete');
  const openMonth = data.period.includesOpenMonth ?? data.period.isPartialMonth;
  if (!incomplete.length && !notes.length && !openMonth) return null;
  const summary = incomplete.map(source => `${labels[source]}: ${(periodOnly ? data.coverage[source] : data.sourceStatus[source]).coverage === 'unavailable' ? W.unavailableFigure : source === 'money' ? W.confirmedSummary : source === 'usage' ? W.countAtLeast : W.measuredOnly}`).join(' · ');
  return <aside className={`executive-status rounded-lg border px-3 text-xs text-gray-700 ${openMonth ? 'border-gold-300 bg-gold-100/40' : 'border-gray-200 bg-gray-50'}`} aria-label={openMonth ? P.openMonth : W.export.notes}>
    <details className="group" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary aria-expanded={open} className="flex min-h-[38px] cursor-pointer list-none items-center gap-2 rounded py-1 focus-visible:outline-2 focus-visible:outline-brand-700">
        <DesignIcons.info className="size-4 shrink-0 text-warning-700" />
        <div className="min-w-0 flex-1"><strong className="font-semibold">{openMonth ? P.openMonth : W.export.notes}</strong><span className="block sm:ml-2 sm:inline">{openMonth ? summary : notes[0] ? `${labels[notes[0].source]}: ${notes[0].text}` : summary}</span></div>
        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">{incomplete.length > 0 && <span className="inline-flex items-center gap-1 whitespace-nowrap"><IncompleteDot reason={W.incompleteLegend} />{W.incompleteLegend}</span>}<span className="inline-flex items-center gap-1 font-semibold text-brand-800">{W.details}<ChevronDownIcon aria-hidden="true" className="size-4 group-open:rotate-180" /></span></span>
      </summary>
      <dl className="grid gap-x-6 gap-y-2 border-t border-gray-200 py-3 md:grid-cols-2">
        {notes.slice(openMonth ? 0 : 1).map(({ source, text }) => <div key={text} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2"><dt className="font-semibold text-gray-600">{labels[source]}</dt><dd>{text}</dd></div>)}
        {sources.filter(source => data.sourceStatus[source].dataThrough).map(source => <div key={source} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2"><dt className="font-semibold text-gray-600">{labels[source]}</dt><dd>{source === 'money' ? W.moneyThrough(reportDate(data.sourceStatus[source].dataThrough)) : W.through(reportDateTime(data.sourceStatus[source].dataThrough))}</dd></div>)}
      </dl>
    </details>
  </aside>;
}
export function ReportStatus({ data, sources = ['money', 'usage', ...((data as { periodSummary?: unknown }).periodSummary ? ['aiCost' as const] : [])], periodOnly = false }: { data: ExecutiveEnvelope; sources?: StatusSource[]; periodOnly?: boolean }) {
  return data.sourceStatus ? <SourceStatus data={data} sources={sources} periodOnly={periodOnly} /> : <LegacyStatus data={data} />;
}
function LegacyStatus({ data }: { data: ExecutiveEnvelope }) {
  const [open, setOpen] = useState(false);
  const notes = reportNotes(data);
  const companies = (data as ExecutiveEnvelope & { metrics?: { companies: ExecutiveCount & { unclassifiedCount: number } } }).metrics?.companies;
  if (companies && companies.coverage !== 'complete' && companies.unclassifiedCount > 0) notes.push(W.unclassified(companies.unclassifiedCount));
  if (data.unmatchedMoney?.count > 0 && !notes.includes(reasonText('UNMATCHED_MONEY'))) notes.push(reasonText('UNMATCHED_MONEY'));
  if (data.reasonCodes?.includes('SOURCE_STALE')) notes.push(W.staleAt(reportDateTime(data.build.asOf)));
  for (const source of data.dataThrough?.lagging ?? []) if (source !== 'billing') notes.push(`${source === 'activity' ? W.usage : source === 'aiCost' ? W.aiCost : W.companyTab} · ${W.through(reportDateTime(data.dataThrough[source]))}`);
  const detail = data as ExecutiveEnvelope & { month?: { money?: { aiCostSatang?: ExecutiveMoney } } };
  const sources: Array<readonly [string, { coverage: ExecutiveCoverage; reasonCodes: readonly string[] }, string]> = [[W.moneySource, data.coverage.money, W.confirmedSummary], [W.usage, data.coverage.usage, W.countAtLeast], ...(detail.month?.money?.aiCostSatang ? [[W.aiCostSource, detail.month.money.aiCostSatang, W.measuredOnly]] as const : [])];
  const summaries = sources.filter(([, source]) => source.coverage !== 'complete').map(([label, source, words]) => `${label}: ${source.coverage === 'unavailable' ? W.unavailableFigure : words}`);
  function incomplete(node: unknown): boolean {
    if (!node || typeof node !== 'object') return false;
    const object = node as Record<string, unknown>;
    return object.coverage === 'partial' || object.coverage === 'unavailable' || Object.values(object).some(incomplete);
  }
  const isIncomplete = data.period.isPartialMonth || incomplete(data);
  const billingLag = data.dataThrough?.lagging.includes('billing') && data.dataThrough.billing;
  if (!notes.length && !summaries.length && !data.period.isPartialMonth && !billingLag) return null;
  const heading = data.period.isPartialMonth ? W.partialMonth : W.export.notes;
  const summary = data.period.isPartialMonth ? summaries.join(' · ') : notes[0] || summaries.join(' · ');
  const detailNotes = notes.filter(note => note !== heading && note !== summary);
  const sourceLabel = (note: string) => sources.filter(([, source]) => source.reasonCodes.some(code => note.startsWith(reasonText(code, source.coverage)))).map(([label]) => label).join(' · ') || W.export.notes;
  return <aside className={`executive-status rounded-lg border px-3 text-xs text-gray-700 ${data.period.isPartialMonth ? "border-gold-300 bg-gold-100/40" : "border-gray-200 bg-gray-50"}`} aria-label={heading}>
    <details className="group" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary aria-expanded={open} className="flex min-h-[38px] cursor-pointer list-none items-center gap-2 rounded py-1 focus-visible:outline-2 focus-visible:outline-brand-700">
        <DesignIcons.info className="size-4 shrink-0 text-warning-700" />
        <div className="min-w-0 flex-1"><strong className="font-semibold">{heading}</strong><span className="block sm:ml-2 sm:inline">{summary}</span></div>
        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">{isIncomplete && <span className="inline-flex items-center gap-1 whitespace-nowrap"><IncompleteDot reason={W.incompleteLegend} />{W.incompleteLegend}</span>}<span className="inline-flex items-center gap-1 font-semibold text-brand-800">{W.details}<ChevronDownIcon aria-hidden="true" className="size-4 group-open:rotate-180" /></span></span>
      </summary>
      <dl className="grid gap-x-6 gap-y-2 border-t border-gray-200 py-3 md:grid-cols-2">
        {detailNotes.map(note => <div key={note} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2"><dt className="font-semibold text-gray-600">{sourceLabel(note)}</dt><dd>{note}</dd></div>)}
        {billingLag && <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2"><dt className="font-semibold text-gray-600">{W.moneySource}</dt><dd>{W.moneyThrough(reportDate(billingLag))}</dd></div>}
      </dl>
    </details>
  </aside>;
}
export function ReportNotes({ data, children, sources, periodOnly }: { data: ExecutiveEnvelope; children: ReactNode; sources?: StatusSource[]; periodOnly?: boolean }) {
  const alreadyShown = useContext(ReasonNotes);
  return <ReasonNotes.Provider value={true}>{!alreadyShown && <ReportStatus data={data} sources={sources} periodOnly={periodOnly} />}{children}</ReasonNotes.Provider>;
}
export function ExecutiveSectionCard({ title, children, actions, className = '' }: { title: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return <MangmeeCard className={`min-w-0 space-y-2 p-3 ${className}`}>
    <header className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold text-brand-800"><span aria-hidden="true" className="h-5 w-1 shrink-0 rounded-full bg-brand-600" />{title}</h2>{actions}
    </header>{children}
  </MangmeeCard>;
}
export function ExecutiveKpiStrip({ children, columns = 3 }: { children: ReactNode; columns?: 2 | 3 }) {
  const tiles = (node: ReactNode): Array<{ figure?: ExecutiveCount; moneyValue?: boolean; value?: ReactNode; unit?: string }> => Children.toArray(node).flatMap(child => isValidElement<{ children?: ReactNode; figure?: ExecutiveCount; moneyValue?: boolean; value?: ReactNode; unit?: string }>(child) ? child.type === ExecutiveKpi ? [child.props] : tiles(child.props.children) : []);
  const values = tiles(children);
  const scale = { digits: Math.max(1, ...values.map(p => p.figure ? figureNumber(p.figure, p.moneyValue).length : String(p.value ?? '').length)), size: 26 };
  // One size for the whole strip, small enough for its longest figure in the narrowest tile (five in a row at 1200 px): digits never wrap.
  scale.size = scale.digits > 12 ? 14 : scale.digits > 10 ? 16 : scale.digits > 7 ? 18 : 26;
  const five = values.length === 5, four = values.length === 4;
  // Five tiles: two a row on a phone with the last one across the row, 3 + 2 from 768 px, one row of five from 1200 px. No empty slot at any width.
  return <KpiScale.Provider value={scale}><div data-executive-kpi-strip className={`grid min-w-0 grid-cols-2 gap-2 ${five ? 'max-md:[&>*:last-child]:col-span-2 md:max-[1200px]:grid-cols-6 md:max-[1200px]:[&>*]:col-span-2 md:max-[1200px]:[&>*:nth-child(n+4)]:col-span-3 min-[1200px]:grid-cols-5' : `${columns === 3 ? 'md:grid-cols-3' : ''} ${four ? 'min-[1200px]:grid-cols-4' : ''}`}`}>{children}</div></KpiScale.Provider>;
}
export function comparisonLine(comparison: ExecutivePeriodComparison): string {
  const qualifier = executivePeriodComparisonQualifier(comparison);
  const change = comparison.status === 'COMPLETE' && comparison.percentChange !== null ? P.change(`${comparison.percentChange > 0 ? '+' : ''}${comparison.percentChange.toLocaleString('th-TH', { maximumFractionDigits: 1 })}%`) : '';
  return [change, qualifier].filter(Boolean).join(' · ');
}
export function ExecutiveKpi({ label, figure, moneyValue = false, netValue = false, measured = false, unit, value, sub, supporting, comparison, iconName = 'chart', emphasis = false, arrow = false }: { label: string; figure?: ExecutiveCount | ExecutiveMoney; moneyValue?: boolean; netValue?: boolean; measured?: boolean; unit?: string; value?: ReactNode; sub?: ReactNode; supporting?: string; comparison?: ExecutivePeriodComparison; iconName?: string; emphasis?: boolean; arrow?: boolean }) {
  const Icon = DesignIcons[iconName];
  const incomplete = figure && figure.coverage !== 'complete';
  const scale = useContext(KpiScale);
  return <section data-executive-kpi className={`relative flex h-26 min-w-0 flex-col justify-center gap-1 rounded-xl border px-2 py-2 shadow-theme-sm transition-colors group-hover:border-brand-300 group-hover:bg-brand-25 ${emphasis ? 'border-brand-300 bg-brand-25' : 'border-gray-200 bg-white'}`}>
    <div className="min-w-0 w-full">
      <div className="grid grid-cols-[minmax(0,1fr)_1rem] gap-1"><div data-executive-label className="min-h-8 text-pretty text-[13px] font-normal leading-4 text-gray-600" title={label}>{label}</div><span aria-hidden="true" className="text-brand-700">{arrow ? '→' : ''}</span></div>
      <div className="flex flex-nowrap items-center gap-2"><span data-executive-icon aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><Icon className="size-4" /></span><div className="flex min-w-0 flex-nowrap items-baseline gap-x-1"><div data-executive-value style={{ fontSize: scale.size }} className={`whitespace-nowrap font-semibold leading-7 tabular-nums ${value === 0 || value === "0" ? "text-gray-600" : ""}`}>{figure ? <Figure value={figure} moneyValue={moneyValue} measured={measured} netValue={netValue} mark={false} /> : value}</div>{unit && <span className="shrink-0 whitespace-nowrap text-[13px] leading-4 text-gray-600">{unit}</span>}</div></div>
      {supporting && <div data-executive-supporting className="h-3 truncate pr-7 text-[11px] leading-3 text-gray-600" title={supporting}>{supporting}</div>}
      <div data-executive-sub className="flex h-4 items-center text-xs text-gray-600" style={incomplete ? { color: 'var(--color-warning-700)' } : undefined}>{incomplete ? <><IncompleteDot reason={reasons(figure)} /><span className="ml-1 truncate">{figure.coverage === 'unavailable' ? W.unavailableFigure : moneyValue ? (executiveMoneyQualifier(figure, measured) === W.addOnNotSold ? W.addOnNotSold : measured ? W.measuredOnly : W.confirmedOnly) : W.countAtLeast}</span></> : <span className="ml-1 truncate" title={comparison ? comparisonLine(comparison) : undefined}>{comparison ? <><span aria-hidden="true" className={comparison.absoluteChange !== null && comparison.absoluteChange > 0 ? "text-brand-700" : comparison.absoluteChange !== null && comparison.absoluteChange < 0 ? "text-red-700" : "text-gray-600"}>{comparison.status === "COMPLETE" && comparison.absoluteChange !== null ? comparison.absoluteChange > 0 ? "↑ " : "↓ " : ""}</span>{comparisonLine(comparison)}</> : sub}</span>}</div>
    </div>
  </section>;
}

/** Keeps the chosen item of a row that scrolls sideways in view (a phone shows only part of the row). Sideways only: the page itself never moves. */
export function keepInView(item: Element | null | undefined) {
  const row = item?.parentElement;
  if (!item || !row) return;
  const a = item.getBoundingClientRect(), b = row.getBoundingClientRect();
  if (a.left < b.left) row.scrollLeft -= b.left - a.left; else if (a.right > b.right) row.scrollLeft += a.right - b.right;
}
/** Mounted inside such a row: keeps its chosen item in view whenever the choice changes. Draws nothing. */
function ChosenInView({ id }: { id: string }) {
  useEffect(() => keepInView(document.getElementById(id)), [id]);
  return null;
}
export function ExecutiveTabs({ label, tabs, value, onChange }: { label: string; tabs: Array<{ value: string; label: string }>; value: string; onChange: (value: string, keyboard?: boolean) => void }) {
  return <div role="tablist" aria-label={label} className="executive-view-tabs flex min-w-0 overflow-x-auto border-b border-gray-200">
    {tabs.map((tab, index) => <button key={tab.value} type="button" role="tab" id={`executive-tab-${tab.value}`} aria-controls="executive-panel" aria-selected={value === tab.value} tabIndex={value === tab.value ? 0 : -1} className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brand-700 ${value === tab.value ? 'border-brand-700 text-brand-800' : 'border-transparent text-gray-600 hover:text-brand-700'}`} onClick={() => onChange(tab.value)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); onChange(tabs[next].value, true); (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
    }}>{tab.label}</button>)}
    <ChosenInView id={`executive-tab-${value}`} />
  </div>;
}
export type ReportColumn = { label: string; /** A long text: on the phone card it takes a whole line and wraps. */ wide?: boolean; /** What the header shows when it is not the plain label (a label with its own line break). */ head?: ReactNode; width?: number; align?: 'left' | 'right'; control?: boolean; mobile?: boolean; hide?: 'narrow' | 'always'; sort?: 'ascending' | 'descending'; onSort?: () => void; source?: { coverage: ExecutiveCoverage; reasonCodes: readonly string[] }; sourceName?: string };
/** A fact of an opened row, under its own label. With `column`, it stands in for that column and shows only where the column itself is not on screen. */
export type ReportDetailItem = { label: string; value: ReactNode; column?: number; /** A long text takes the whole line. */ wide?: boolean };
export type ReportDetailGroup = { title?: string; items: ReportDetailItem[]; /** What the reader can do about these facts, under them. */ action?: ReactNode };
type ReportRow = { key: string; cells: ReactNode[]; href?: string; groups?: ReportDetailGroup[]; action?: ReactNode; className?: string };
// A table has three layouts: cards on a phone, a desktop table in a narrow card, and one in a wide card (936 px and up).
// `shownOn` shows an element only on the layouts where it has something to show. Tailwind reads the names from here, so they are spelled out.
type Layouts = readonly [phone: boolean, narrow: boolean, wide: boolean];
const SHOWN = { block: ['block', 'md:block', '@min-[936px]:block'], cell: ['block', 'md:table-cell', '@min-[936px]:table-cell'], row: ['block', 'md:table-row', '@min-[936px]:table-row'], column: ['', 'md:table-column', '@min-[936px]:table-column'] } as const;
const HIDDEN = ['hidden', 'md:hidden', '@min-[936px]:hidden'] as const;
const shownOn = (kind: keyof typeof SHOWN, on: Layouts) => on.map((yes, layout) => yes ? SHOWN[kind][layout] : HIDDEN[layout]).join(' ');
const desktopColumn = (column: ReportColumn, display: 'table-cell' | 'table-column') => column.hide === 'always' ? 'md:hidden' : column.hide === 'narrow' ? display === 'table-cell' ? 'md:hidden @min-[936px]:table-cell' : 'md:hidden @min-[936px]:table-column' : display === 'table-cell' ? 'md:table-cell' : 'md:table-column';
/**
 * `sheet`: a list read like a spreadsheet (the company list). Every column stays on screen: the card scrolls sideways where they do not fit,
 * with the first column held in place, and a header may take two lines. On a phone each row is a card of lines, label left and value right.
 */
export function ExecutiveTable({ title, columns, rows, remember, nameIndex = 0, compactMobile = false, sheet = false }: { title: string; columns: ReportColumn[]; rows: ReportRow[]; remember?: () => void; nameIndex?: number; compactMobile?: boolean; sheet?: boolean }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const id = useId();
  const toggle = (key: string) => setExpanded(current => current.includes(key) ? current.filter(k => k !== key) : [...current, key]);
  if (!rows.length) return <p role="status" className="py-8 text-center text-sm text-gray-600">{W.noRows}</p>;
  const onMobile = (column: ReportColumn, index: number) => column.mobile ?? (index > nameIndex && (sheet || index <= nameIndex + 6) && !column.control);
  // Where a column's value is NOT in the row itself; an opened row shows it there, under its label.
  const offRow = (index: number): Layouts => [!onMobile(columns[index], index), !!columns[index].hide, columns[index].hide === 'always'];
  const anyOn = (parts: Layouts[]): Layouts => [parts.some(part => part[0]), parts.some(part => part[1]), parts.some(part => part[2])];
  const groupsOf = (row: ReportRow) => (row.groups ?? [{ items: columns.flatMap((column, index) => index !== nameIndex && !column.control ? [{ label: column.label, value: row.cells[index], column: index }] : []) }] as ReportDetailGroup[])
    .map(group => ({ ...group, items: group.items.filter(item => item.column === undefined || offRow(item.column).some(Boolean)) }))
    .map(group => ({ ...group, on: anyOn(group.items.map(item => item.column === undefined ? [true, true, true] as const : offRow(item.column))) }));
  // The control that opens a row exists only on the layouts where opening shows something (owner 2026-10-05: no control that does nothing).
  const moreOn = anyOn(rows.flatMap(row => [...groupsOf(row).map(group => group.on), ...(row.action ? [[true, true, true] as const] : [])]));
  const hasMore = moreOn.some(Boolean);
  const figures = (node: ReactNode): FigureProps[] => Children.toArray(node).flatMap(child => isValidElement<FigureProps & { children?: ReactNode }>(child) ? child.type === Figure ? [child.props] : figures(child.props.children) : []);
  const marks = columns.map((column, index) => {
    const values = rows.flatMap(row => figures(row.cells[index]));
    const sources: Record<string, readonly string[]> = {};
    if (column.source && column.source.coverage !== 'complete') sources[column.sourceName ?? 'usage'] = column.source.reasonCodes;
    for (const source of new Set(values.map(p => p.source ?? (p.measured ? 'aiCost' : p.moneyValue ? 'money' : 'usage')))) {
      const group = values.filter(p => (p.source ?? (p.measured ? 'aiCost' : p.moneyValue ? 'money' : 'usage')) === source);
      if (!sources[source] && hoistedSource(group.map(p => ({ coverage: p.value.coverage, source })))) sources[source] = [...new Set(group.flatMap(p => p.value.reasonCodes))];
    }
    return Object.keys(sources).length ? { sources, reason: [...new Set([...(column.source?.reasonCodes.map(code => reasonText(code, column.source?.coverage)) ?? []), ...values.filter(p => sources[p.source ?? (p.measured ? 'aiCost' : p.moneyValue ? 'money' : 'usage')]).flatMap(p => p.value.reasonCodes.map(code => reasonText(code, p.value.coverage)))])].filter(Boolean).join(' · ') } : null;
  });
  const cell = (row: ReportRow, index: number) => <ColumnMark.Provider value={marks[index]?.sources ?? null}>{row.cells[index]}</ColumnMark.Provider>;
  const more = (row: ReportRow) => <button type="button" aria-label={W.details} aria-expanded={expanded.includes(row.key)} aria-controls={`${id}-${row.key}`} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded px-1 text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-700" onClick={event => { event.stopPropagation(); toggle(row.key); }}><span className="text-xs md:hidden">{expanded.includes(row.key) ? W.less : W.more}</span><ChevronDownIcon aria-hidden="true" className={`size-4 shrink-0 ${expanded.includes(row.key) ? 'rotate-180' : ''}`} /></button>;
  // A sheet is never narrower than its columns: under that width its card scrolls sideways (so its header cannot also stick to the page top).
  const sheetWidth = columns.reduce((total, column) => total + (column.hide ? 0 : column.width ?? 120), hasMore ? 44 : 0);
  const head = sheet ? 'whitespace-normal leading-4' : 'sticky top-20 z-30 whitespace-nowrap';
  // The first column of a sheet stays in place while the rest scrolls under it: above the cells' own raised content, with a hairline at its edge.
  const held = sheet ? 'md:z-20 md:shadow-[inset_-1px_0_0_var(--color-gray-200)]' : 'md:z-0';
  return <div className={`relative min-w-0 @container ${sheet ? 'md:overflow-x-auto' : ''}`}>
    <table style={sheet ? { '--sheet-width': `${sheetWidth}px` } as CSSProperties : undefined} className={`block w-full border-collapse space-y-2 md:table md:table-fixed md:space-y-0 ${sheet ? 'md:min-w-[var(--sheet-width)]' : ''}`}>
      <caption className="sr-only">{title}</caption><colgroup className="hidden md:table-column-group">{columns.map((column, i) => <col key={i} className={desktopColumn(column, 'table-column')} style={{ width: column.width ?? 120 }} />)}{hasMore && <col className={shownOn('column', moreOn)} style={{ width: 44 }} />}{/* An opened row spans every column, also the ones a layout hides: these empty columns take that span, or the table would stop short of its card. */}{hasMore && columns.filter(column => column.hide).map((_, i) => <col key={`span-${i}`} style={{ width: 0 }} />)}</colgroup>
      <thead className="hidden md:table-header-group"><tr>{columns.map((column, index) => {
        const label = <span className="relative inline-flex items-center">{column.head ? <span>{column.head}</span> : column.label}{column.sort && <span aria-hidden="true" className="ml-1">{column.sort === 'ascending' ? '↑' : '↓'}</span>}{marks[index] && <span className="absolute left-full top-1/2 -ml-0.5 -translate-y-1/2">{/* 2 px closer than a figure's own dot: it ends inside its column, where the next header cannot cover it */}<IncompleteDot reason={marks[index]!.reason} /></span>}</span>;
        return <th key={index} scope="col" aria-sort={column.sort} title={column.label} className={`${head} ${sheet && index === nameIndex ? `md:sticky md:left-0 ${held}` : ''} h-11 border-b border-gray-100 bg-gray-50 px-2 text-xs font-semibold text-gray-600 ${columnAlign(column, index, nameIndex)} ${desktopColumn(column, 'table-cell')}`}>{column.onSort ? <button type="button" onClick={column.onSort} className={`min-h-11 rounded focus-visible:outline-2 focus-visible:outline-brand-700 ${sheet ? '' : 'whitespace-nowrap'}`}>{label}</button> : label}</th>;
      })}{hasMore && <th className={`${sheet ? '' : 'sticky top-20 z-30'} bg-gray-50 ${shownOn('cell', moreOn)}`}><span className="sr-only">{W.details}</span></th>}</tr></thead>
      {rows.map(row => <tbody key={row.key} className="relative block rounded-lg border border-gray-100 bg-white p-2 md:table-row-group md:rounded-none md:border-0 md:p-0">
        <tr onClick={event => { if (row.href && !(event.target as HTMLElement).closest('a,button,input,label,summary')) event.currentTarget.querySelector<HTMLAnchorElement>('a[href]')?.click(); }} style={compactMobile ? { '--mobile-columns': columns.filter(onMobile).length } as CSSProperties : undefined} className={`relative grid ${sheet ? 'grid-cols-1' : compactMobile ? 'grid-cols-[repeat(var(--mobile-columns),minmax(0,1fr))]' : 'grid-cols-2'} gap-x-2 bg-white hover:bg-brand-25 md:table-row ${row.className ?? ''}`}>
          {row.cells.map((value, index) => <td key={index} className={`min-w-0 border-gray-100 text-sm tabular-nums md:h-12 md:border-b md:px-2 md:py-1 ${index === nameIndex ? `col-span-full block bg-inherit md:sticky md:left-0 ${held} ${moreOn[0] ? 'min-h-11 content-center pr-16 md:min-h-0 md:pr-2' : ''}` : columns[index].control ? 'absolute right-16 top-0 z-10 md:static' : onMobile(columns[index], index) ? sheet ? 'flex items-baseline justify-between gap-3 border-t border-gray-100 py-1.5 md:whitespace-nowrap md:border-t-0' : columns[index].wide ? 'col-span-full block' : 'block whitespace-nowrap' : 'hidden whitespace-nowrap'} ${desktopColumn(columns[index], 'table-cell')} ${columnAlign(columns[index], index, nameIndex)} ${index !== nameIndex && (value === 0 || value === '0' || value === '0.00' || value === '0.0%') ? 'text-gray-600' : ''}`}>
            {index !== nameIndex && <span className={`${columns[index].control ? 'sr-only' : sheet ? 'shrink-0 text-xs leading-5 text-gray-600 md:hidden' : 'block truncate text-xs leading-4 text-gray-600 md:hidden'}`}>{columns[index].label}</span>}
            {index === nameIndex && row.href ? <Link href={row.href} onClick={remember} className="block min-h-11 content-center font-semibold text-brand-800 after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-brand-700">{value}</Link> : sheet && index !== nameIndex ? <span className="min-w-0 [overflow-wrap:anywhere] max-md:text-right md:contents">{cell(row, index)}</span> : cell(row, index)}
          </td>)}
          {hasMore && <td className={`absolute right-0 top-0 z-10 text-right md:relative md:h-12 md:border-b md:border-gray-100 ${shownOn('cell', moreOn)}`}>{more(row)}</td>}
        </tr>
        {hasMore && <tr hidden={!expanded.includes(row.key)} id={`${id}-${row.key}`} className={`bg-gray-50 ${shownOn('row', moreOn)}`}><td colSpan={columns.length + 1} className="block p-3 md:table-cell md:px-4"><div data-row-details className="space-y-3">
          {groupsOf(row).map((group, index) => <section key={index} className={shownOn('block', group.on)}>
            {group.title && <h3 className="mb-1.5 text-xs font-semibold text-brand-800">{group.title}</h3>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @min-[640px]:grid-cols-3 @min-[936px]:grid-cols-4">{group.items.map((item, i) => <div key={i} className={`min-w-0 ${item.wide ? 'col-span-full' : ''} ${item.column === undefined ? '' : shownOn('block', offRow(item.column))}`}><dt className="text-pretty text-xs leading-4 text-gray-600">{item.label}</dt><dd className="break-words text-sm leading-5 tabular-nums [overflow-wrap:anywhere]">{item.value}</dd></div>)}</dl>
            {group.action && <div className="mt-2 flex">{group.action}</div>}
          </section>)}
          {row.action && <div className="flex md:justify-end">{row.action}</div>}
        </div></td></tr>}
      </tbody>)}
    </table>
  </div>;
}
function columnAlign(column: ReportColumn, index: number, nameIndex: number) { return column.align === 'left' || column.control || index === nameIndex ? 'text-left' : 'text-right'; }
