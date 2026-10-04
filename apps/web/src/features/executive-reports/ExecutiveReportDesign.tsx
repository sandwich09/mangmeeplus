'use client';

import Link from 'next/link';
import { createContext, useContext, useId, useState, isValidElement, Fragment, type ReactNode, type CSSProperties } from 'react';
import { executiveMoneyQualifier, type ExecutiveCount, type ExecutiveMoney, type ExecutiveEnvelope, type ExecutiveCoverage } from '@watchdog-bms/contracts';
import { MangmeeCard } from '@/common/components/mangmee';
import { DesignIcons } from '@/features/web-core-workspace/design-icons';
import { W } from './executive-reports.words';
import { countText, moneyText, reasonText, figureNumber, hoistedSource, reportDate, reportDateTime } from './executive-reports.logic';

export const EXECUTIVE_PAGE_CLASS = 'min-w-0 text-gray-900 [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-brand-700';
export function ExecutivePage({ eyebrow, title, description, actions, children, className = '' }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`flex min-w-0 flex-col gap-4 ${className}`}>
    <header className="relative flex min-w-0 flex-wrap items-center justify-between gap-3 pb-3 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-linear-to-r after:from-gold-500 after:to-transparent">
      <div className="min-w-0">{eyebrow && <div data-breadcrumb className="mb-1 text-xs font-semibold text-brand-800">{eyebrow}</div>}<h1 className="text-2xl font-semibold text-brand-800 sm:text-3xl">{title}</h1>{description && <p className="mt-1 text-sm text-gray-600">{description}</p>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>{children}
  </div>;
}
export const ReasonNotes = createContext(false);
const ColumnMark = createContext<readonly string[] | null>(null);
type FigureProps = { value: ExecutiveCount | ExecutiveMoney; moneyValue?: boolean; netValue?: boolean; measured?: boolean; source?: string; mark?: boolean };
const reasons = (value: { reasonCodes: readonly string[]; coverage: ExecutiveCoverage }) => [...new Set(value.reasonCodes.map(code => reasonText(code, value.coverage)))].join(' · ');
export function IncompleteDot({ reason }: { reason: string }) {
  return <span role="img" aria-label={`${W.incompleteLegend}${reason ? ` — ${reason}` : ''}`} title={reason || W.incompleteLegend} className="executive-dot ml-1 inline-block size-1.5 shrink-0 rounded-full bg-gold-500 align-middle" />;
}
export function Figure({ value, moneyValue = false, netValue = false, measured = false, mark = true }: FigureProps) {
  const columnCodes = useContext(ColumnMark);
  const reason = reasons(value);
  const qualified = value.value === null && value.knownValue === undefined ? W.unavailableFigure : moneyValue ? moneyText(value as ExecutiveMoney, measured) : countText(value);
  const negative = netValue && value.coverage === 'complete' && (value.value ?? 0) < 0 ? W.negative : '';
  const showDot = mark && value.coverage !== 'complete' && (columnCodes === null || value.reasonCodes.some(code => !columnCodes.includes(code)));
  return <span className={`executive-figure inline-flex items-center whitespace-nowrap tabular-nums ${(value.value ?? value.knownValue) === 0 ? 'text-gray-600' : moneyValue && (value.value ?? value.knownValue ?? 0) < 0 ? 'text-red-700' : ''}`} aria-label={[qualified, reason, negative].filter(Boolean).join(' — ')}>
    {figureNumber(value, moneyValue)}{showDot && <IncompleteDot reason={reason} />}
  </span>;
}
// The old ReasonNotes mechanism now has one expandable, unnumbered detail per page.
export function reportNotes(data: unknown): string[] {
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
export function ReportStatus({ data }: { data: ExecutiveEnvelope }) {
  const sourceStale = data.reasonCodes?.includes('SOURCE_STALE');
  const notes = reportNotes(data).filter(note => !sourceStale || note !== reasonText('SOURCE_STALE'));
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
  return <aside className={`executive-status rounded-lg border px-3 py-2 text-xs text-gray-700 ${isIncomplete ? "border-gold-300 bg-gold-100/40" : "border-gray-200 bg-gray-50"}`} aria-label={isIncomplete ? W.incompleteHeading : W.export.notes}>
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-brand-700">
        <DesignIcons.info className="size-4 shrink-0 text-gold-500" />
        <div className="min-w-0 flex-1 line-clamp-2 sm:line-clamp-none"><strong className="font-semibold">{isIncomplete ? W.incompleteHeading : W.export.notes}</strong><span className="ml-2">{[sourceStale ? reasonText('SOURCE_STALE') : '', summaries.join(' · ') || (isIncomplete ? W.incompleteLegend : '')].filter(Boolean).join(' · ')}</span></div>
        {isIncomplete && <span className="inline-flex items-center whitespace-nowrap"><IncompleteDot reason={W.incompleteLegend} />{W.incompleteLegend}</span>}<span className="shrink-0 font-semibold text-brand-800">{W.details}</span>
      </summary>
      <div className="space-y-1 border-t border-gold-300 pt-2">
        {notes.map(note => <p key={note}>{note}</p>)}
        {data.period.isPartialMonth && !notes.includes(W.partialMonth) && <p>{W.partialMonth}</p>}
        {billingLag && <p>{W.moneyThrough(reportDate(billingLag))}</p>}
      </div>
    </details>
  </aside>;
}
export function ReportNotes({ data, children }: { data: ExecutiveEnvelope; children: ReactNode }) {
  const alreadyShown = useContext(ReasonNotes);
  return <ReasonNotes.Provider value={true}>{!alreadyShown && <ReportStatus data={data} />}{children}</ReasonNotes.Provider>;
}
export function ExecutiveSectionCard({ title, children, actions, className = '' }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return <MangmeeCard className={`min-w-0 space-y-2 p-3 ${className}`}>
    <header className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold text-brand-800"><span aria-hidden="true" className="h-5 w-1 shrink-0 rounded-full bg-brand-600" />{title}</h2>{actions}
    </header>{children}
  </MangmeeCard>;
}
export function ExecutiveKpi({ label, figure, moneyValue = false, netValue = false, measured = false, unit, value, sub, iconName = 'chart', emphasis = false }: { label: string; figure?: ExecutiveCount | ExecutiveMoney; moneyValue?: boolean; netValue?: boolean; measured?: boolean; unit?: string; value?: ReactNode; sub?: ReactNode; iconName?: string; emphasis?: boolean }) {
  const Icon = DesignIcons[iconName];
  const incomplete = figure && figure.coverage !== 'complete';
  const digits = figure ? figureNumber(figure, moneyValue).length : 0;
  return <section data-executive-kpi className={`flex h-24 min-w-0 items-center gap-2 rounded-xl border px-2 py-2 shadow-theme-sm transition-colors group-hover:border-brand-300 group-hover:bg-brand-25 sm:gap-3 sm:px-3 ${emphasis ? 'border-brand-300 bg-brand-25' : 'border-gray-200 bg-white'}`}>
    <span data-executive-icon aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><Icon className="size-5" /></span>
    <div className="min-w-0 flex-1 [container-type:inline-size]">
      <div data-executive-label className="truncate text-[13px] font-normal leading-4 text-gray-600" title={label}>{label}</div>
      <div className="flex flex-wrap items-baseline gap-x-1"><div data-executive-value className={`whitespace-nowrap ${digits > 6 ? 'text-[length:min(26px,calc(100cqw/var(--executive-digits)))]' : 'text-[26px]'} font-semibold leading-8 tabular-nums ${value === 0 || value === "0" ? "text-gray-600" : ""}`} style={digits > 6 ? { "--executive-digits": digits * 0.62 } as CSSProperties : undefined}>{figure ? <Figure value={figure} moneyValue={moneyValue} measured={measured} netValue={netValue} mark={false} /> : value}</div>{unit && <span className="whitespace-nowrap text-[13px] leading-4 text-gray-600">{unit}</span>}</div>
      <div data-executive-sub className="flex h-4 items-center truncate text-xs text-gray-600 has-[.executive-dot]:text-warning-700">{incomplete ? <><IncompleteDot reason={reasons(figure)} /><span className="ml-1">{figure.coverage === 'unavailable' ? W.unavailableFigure : moneyValue ? (executiveMoneyQualifier(figure, measured) === W.addOnNotSold ? W.addOnNotSold : measured ? W.measuredOnly : W.confirmedOnly) : W.countAtLeast}</span></> : <span className="ml-1">{sub}</span>}</div>
    </div>
  </section>;
}

export function ExecutiveTabs({ label, tabs, value, onChange }: { label: string; tabs: Array<{ value: string; label: string }>; value: string; onChange: (value: string, keyboard?: boolean) => void }) {
  return <div role="tablist" aria-label={label} className="executive-view-tabs flex min-w-0 overflow-x-auto border-b border-gray-200">
    {tabs.map((tab, index) => <button key={tab.value} type="button" role="tab" id={`executive-tab-${tab.value}`} aria-controls="executive-panel" aria-selected={value === tab.value} tabIndex={value === tab.value ? 0 : -1} className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brand-700 ${value === tab.value ? 'border-brand-700 text-brand-800' : 'border-transparent text-gray-600 hover:text-brand-700'}`} onClick={() => onChange(tab.value)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); onChange(tabs[next].value, true); (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
    }}>{tab.label}</button>)}
  </div>;
}
export type ReportColumn = { label: string; width?: number; align?: 'left' | 'right'; srOnly?: boolean; sort?: 'ascending' | 'descending'; onSort?: () => void; source?: { coverage: ExecutiveCoverage; reasonCodes: readonly string[] }; sourceName?: string };
type ReportRow = { key: string; cells: ReactNode[]; href?: string; details?: ReactNode; className?: string };
export function ExecutiveTable({ title, columns, rows, remember, nameIndex = 0 }: { title: string; columns: ReportColumn[]; rows: ReportRow[]; remember?: () => void; nameIndex?: number }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const id = useId();
  const toggle = (key: string) => setExpanded(current => current.includes(key) ? current.filter(k => k !== key) : [...current, key]);
  if (!rows.length) return <p role="status" className="py-8 text-center text-sm text-gray-600">{W.noRows}</p>;
  const hasMore = rows.some(row => row.details || row.cells.length > nameIndex + 6);
  const totalWidth = columns.reduce((sum, column) => sum + (column.width ?? 120), hasMore ? 44 : 0);
  const marks = columns.map((column, index) => {
    const values = rows.map(row => isValidElement<FigureProps>(row.cells[index]) && row.cells[index].type === Figure ? row.cells[index].props : null);
    const source = column.source && column.source.coverage !== 'complete' ? column.sourceName ?? 'usage' : values.every(Boolean) ? hoistedSource(values.map(p => ({ coverage: p!.value.coverage, source: p!.source ?? (p!.moneyValue ? 'money' : 'usage') }))) : null;
    const codes = column.source?.reasonCodes ?? (source ? values[0]!.value.reasonCodes.filter(code => values.every(p => p!.value.reasonCodes.includes(code))) : null);
    return source ? { codes: codes ?? [], reason: column.source ? reasons(column.source) : [...new Set(values.flatMap(p => p ? [reasons(p.value)] : []))].join(' · ') } : null;
  });
  return <div className="relative isolate min-w-0 overflow-auto overscroll-contain md:max-h-[560px]">
    <table className="block w-full border-collapse md:table md:table-fixed md:[min-width:var(--report-table-width)] xl:min-w-0" style={{ "--report-table-width": `${Math.min(1080, totalWidth)}px` } as import("react").CSSProperties}>
      <caption className="sr-only">{title}</caption><colgroup>{columns.map((column, i) => <col key={i} style={{ width: `${(column.width ?? 120) / totalWidth * 100}%` }} />)}{hasMore && <col style={{ width: `${44 / totalWidth * 100}%` }} />}</colgroup>
      <thead className="hidden md:table-header-group"><tr>{columns.map((column, index) => {
        const label = <><span className={column.srOnly ? 'sr-only' : undefined}>{column.label}</span>{column.sort && <span aria-hidden="true">{column.sort === 'ascending' ? ' ↑' : ' ↓'}</span>}{marks[index] && <IncompleteDot reason={marks[index]!.reason} />}</>;
        return <th key={index} scope="col" aria-sort={column.sort} className={`sticky top-0 z-10 h-11 whitespace-nowrap border-b border-gray-100 bg-gray-50 px-2 text-xs font-semibold text-gray-600 ${column.align === 'left' || index === nameIndex ? 'text-left' : 'text-right'} ${index === nameIndex ? 'left-0 z-20' : ''}`}>{column.onSort ? <button type="button" onClick={column.onSort} className="min-h-11 whitespace-nowrap rounded focus-visible:outline-2 focus-visible:outline-brand-700">{label}</button> : label}</th>;
      })}{hasMore && <th className="sticky top-0 bg-gray-50"><span className="sr-only">{W.details}</span></th>}</tr></thead>
      <tbody className="block space-y-3 md:table-row-group md:space-y-0">{rows.map(row => <Fragment key={row.key}>
        <tr onClick={event => { if (row.href && !(event.target as HTMLElement).closest('a,button,input,label,summary')) event.currentTarget.querySelector<HTMLAnchorElement>('a[href]')?.click(); }} className={`relative grid grid-cols-2 gap-x-3 rounded-lg border border-gray-100 bg-white p-3 hover:bg-brand-25 md:table-row md:p-0 ${row.className ?? ''}`}>
          {row.cells.map((cell, index) => <td key={index} className={`min-w-0 border-gray-100 text-sm tabular-nums md:h-12 md:border-b md:px-2 md:py-1 ${index === nameIndex ? 'col-span-2 bg-inherit md:sticky md:left-0 md:z-10' : columns[index].srOnly ? 'absolute right-3 top-3 z-20 md:static md:table-cell' : 'whitespace-nowrap'} ${columnAlign(columns[index], index, nameIndex)} ${index !== nameIndex && (cell === 0 || cell === '0' || cell === '0.00' || cell === '0.0%') ? 'text-gray-600' : ''} ${index !== nameIndex && !columns[index].srOnly && index > nameIndex + 6 && !expanded.includes(row.key) ? 'hidden md:table-cell' : 'block md:table-cell'}`}>
            {index !== nameIndex && <span className={`${columns[index].srOnly ? "sr-only" : "block truncate text-xs text-gray-600 md:hidden"}`}>{columns[index].label}{marks[index] && <IncompleteDot reason={marks[index]!.reason} />}</span>}
            <ColumnMark.Provider value={marks[index]?.codes ?? null}>{index === nameIndex && row.href ? <Link href={row.href} onClick={remember} className="block min-h-11 content-center font-semibold text-brand-800 after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-brand-700">{cell}</Link> : cell}</ColumnMark.Provider>
          </td>)}
          {(row.details || row.cells.length > nameIndex + 6) && <td className="relative z-20 col-span-2 block text-right md:table-cell md:h-12 md:border-b md:border-gray-100"><button type="button" aria-label={W.details} aria-expanded={expanded.includes(row.key)} aria-controls={`${id}-${row.key}`} className="min-h-11 min-w-11 rounded text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-700" onClick={event => { event.stopPropagation(); toggle(row.key); }}><span className="md:hidden">{W.more}</span><span aria-hidden="true">{expanded.includes(row.key) ? '⌃' : '⌄'}</span></button></td>}
        </tr>
        {row.details && <tr hidden={!expanded.includes(row.key)} id={`${id}-${row.key}`} className="block bg-gray-50 md:table-row"><td colSpan={columns.length + 1} className="block px-3 py-2 text-xs md:table-cell">{row.details}</td></tr>}
      </Fragment>)}</tbody>
    </table>
  </div>;
}
function columnAlign(column: ReportColumn, index: number, nameIndex: number) { return column.align === 'left' || index === nameIndex ? 'text-left' : 'text-right'; }
