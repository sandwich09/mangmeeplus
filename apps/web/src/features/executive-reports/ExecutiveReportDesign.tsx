'use client';

import Link from 'next/link';
import { createContext, useContext, useId, useState, isValidElement, type ReactNode, type CSSProperties } from 'react';
import { executiveMoneyQualifier, type ExecutiveCount, type ExecutiveMoney, type ExecutiveEnvelope, type ExecutiveCoverage } from '@watchdog-bms/contracts';
import { MangmeeCard } from '@/common/components/mangmee';
import { ChevronDownIcon } from '@/common/icons';
import { DesignIcons } from '@/features/web-core-workspace/design-icons';
import { W } from './executive-reports.words';
import { countText, moneyText, reasonText, figureNumber, hoistedSource, reportDate, reportDateTime } from './executive-reports.logic';

export const EXECUTIVE_PAGE_CLASS = 'min-w-0 text-gray-900 [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-brand-700';
export function ExecutivePage({ eyebrow, title, description, actions, controls, children, compact = false, className = '' }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; controls?: ReactNode; children: ReactNode; compact?: boolean; className?: string }) {
  return <div className={`flex min-w-0 flex-col ${compact ? 'gap-2' : 'gap-4'} ${className}`}>
    <header className={`relative flex min-w-0 flex-wrap items-center justify-between after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-linear-to-r after:from-gold-500 after:to-transparent ${compact ? 'gap-2 pb-0' : 'gap-3 pb-3'}`}>
      <div className={compact ? 'min-w-0 flex-1' : 'min-w-0'}>{eyebrow && <div data-breadcrumb className={compact ? 'sr-only' : 'mb-1 text-xs font-semibold text-brand-800'}>{eyebrow}</div>}<h1 className={`font-semibold text-brand-800 ${compact ? 'truncate text-xl leading-7 md:text-2xl md:leading-8' : 'text-2xl sm:text-3xl'}`} title={typeof title === 'string' ? title : undefined}>{title}</h1>{description && <p className={compact ? 'truncate text-sm leading-5 text-gray-600' : 'mt-1 text-sm text-gray-600'} title={typeof description === 'string' ? description : undefined}>{description}</p>}</div>
      {controls && <div className="min-w-0 max-md:order-last max-md:basis-full">{controls}</div>}
      {actions && <div className={`flex min-w-0 flex-wrap items-center gap-2 ${compact && !controls ? 'max-md:basis-full' : ''}`}>{actions}</div>}
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
  return <aside className={`executive-status rounded-lg border px-3 text-xs text-gray-700 ${isIncomplete ? "border-gold-300 bg-gold-100/40" : "border-gray-200 bg-gray-50"}`} aria-label={isIncomplete ? W.incompleteHeading : W.export.notes}>
    <details className="group">
      <summary className="flex min-h-[38px] cursor-pointer list-none items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-brand-700">
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
export type ReportColumn = { label: string; width?: number; align?: 'left' | 'right'; control?: boolean; mobile?: boolean; hide?: 'narrow' | 'always'; sort?: 'ascending' | 'descending'; onSort?: () => void; source?: { coverage: ExecutiveCoverage; reasonCodes: readonly string[] }; sourceName?: string };
type ReportRow = { key: string; cells: ReactNode[]; href?: string; details?: ReactNode; className?: string };
const desktopColumn = (column: ReportColumn, display: 'table-cell' | 'table-column') => column.hide === 'always' ? 'md:hidden' : column.hide === 'narrow' ? display === 'table-cell' ? 'md:hidden @min-[936px]:table-cell' : 'md:hidden @min-[936px]:table-column' : display === 'table-cell' ? 'md:table-cell' : 'md:table-column';
export function ExecutiveTable({ title, columns, rows, remember, nameIndex = 0, compactMobile = false }: { title: string; columns: ReportColumn[]; rows: ReportRow[]; remember?: () => void; nameIndex?: number; compactMobile?: boolean }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const id = useId();
  const toggle = (key: string) => setExpanded(current => current.includes(key) ? current.filter(k => k !== key) : [...current, key]);
  if (!rows.length) return <p role="status" className="py-8 text-center text-sm text-gray-600">{W.noRows}</p>;
  const onMobile = (column: ReportColumn, index: number) => column.mobile ?? (index > nameIndex && index <= nameIndex + 6 && !column.control);
  const hasMore = rows.some(row => row.details) || columns.some((column, i) => column.hide || (i !== nameIndex && !column.control && !onMobile(column, i)));
  const marks = columns.map((column, index) => {
    const values = rows.map(row => isValidElement<FigureProps>(row.cells[index]) && row.cells[index].type === Figure ? row.cells[index].props : null);
    const source = column.source && column.source.coverage !== 'complete' ? column.sourceName ?? 'usage' : values.every(Boolean) ? hoistedSource(values.map(p => ({ coverage: p!.value.coverage, source: p!.source ?? (p!.moneyValue ? 'money' : 'usage') }))) : null;
    const codes = column.source?.reasonCodes ?? (source ? values[0]!.value.reasonCodes.filter(code => values.every(p => p!.value.reasonCodes.includes(code))) : null);
    return source ? { codes: codes ?? [], reason: column.source ? reasons(column.source) : [...new Set(values.flatMap(p => p ? [reasons(p.value)] : []))].join(' · ') } : null;
  });
  const cell = (row: ReportRow, index: number) => <ColumnMark.Provider value={marks[index]?.codes ?? null}>{row.cells[index]}</ColumnMark.Provider>;
  const more = (row: ReportRow) => <button type="button" aria-label={W.details} aria-expanded={expanded.includes(row.key)} aria-controls={`${id}-${row.key}`} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded px-1 text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-700" onClick={event => { event.stopPropagation(); toggle(row.key); }}><span className="text-xs md:hidden">{expanded.includes(row.key) ? W.less : W.more}</span><ChevronDownIcon aria-hidden="true" className={`size-4 shrink-0 ${expanded.includes(row.key) ? 'rotate-180' : ''}`} /></button>;
  return <div className="relative min-w-0 @container">
    <table className="block w-full border-collapse space-y-2 md:table md:table-fixed md:space-y-0">
      <caption className="sr-only">{title}</caption><colgroup className="hidden md:table-column-group">{columns.map((column, i) => <col key={i} className={desktopColumn(column, 'table-column')} style={{ width: column.width ?? 120 }} />)}{hasMore && <col style={{ width: 44 }} />}</colgroup>
      <thead className="hidden md:table-header-group"><tr>{columns.map((column, index) => {
        const label = <>{column.label}{column.sort && <span aria-hidden="true">{column.sort === 'ascending' ? ' ↑' : ' ↓'}</span>}{marks[index] && <IncompleteDot reason={marks[index]!.reason} />}</>;
        return <th key={index} scope="col" aria-sort={column.sort} title={column.label} className={`sticky top-20 z-30 h-11 whitespace-nowrap border-b border-gray-100 bg-gray-50 px-2 text-xs font-semibold text-gray-600 ${columnAlign(column, index, nameIndex)} ${desktopColumn(column, 'table-cell')}`}>{column.onSort ? <button type="button" onClick={column.onSort} className="min-h-11 whitespace-nowrap rounded focus-visible:outline-2 focus-visible:outline-brand-700">{label}</button> : label}</th>;
      })}{hasMore && <th className="sticky top-20 z-30 bg-gray-50"><span className="sr-only">{W.details}</span></th>}</tr></thead>
      {rows.map(row => <tbody key={row.key} className="relative block rounded-lg border border-gray-100 bg-white p-2 md:table-row-group md:rounded-none md:border-0 md:p-0">
        <tr onClick={event => { if (row.href && !(event.target as HTMLElement).closest('a,button,input,label,summary')) event.currentTarget.querySelector<HTMLAnchorElement>('a[href]')?.click(); }} style={compactMobile ? { '--mobile-columns': columns.filter(onMobile).length } as CSSProperties : undefined} className={`relative grid ${compactMobile ? 'grid-cols-[repeat(var(--mobile-columns),minmax(0,1fr))]' : 'grid-cols-2'} gap-x-2 bg-white hover:bg-brand-25 md:table-row ${row.className ?? ''}`}>
          {row.cells.map((value, index) => <td key={index} className={`min-w-0 border-gray-100 text-sm tabular-nums md:h-12 md:border-b md:px-2 md:py-1 ${index === nameIndex ? 'col-span-full block bg-inherit md:sticky md:left-0 md:z-0' : columns[index].control ? 'absolute right-16 top-0 z-10 md:static' : onMobile(columns[index], index) ? 'block whitespace-nowrap' : 'hidden whitespace-nowrap'} ${desktopColumn(columns[index], 'table-cell')} ${columnAlign(columns[index], index, nameIndex)} ${index !== nameIndex && (value === 0 || value === '0' || value === '0.00' || value === '0.0%') ? 'text-gray-600' : ''}`}>
            {index !== nameIndex && <span className={`${columns[index].control ? 'sr-only' : 'block truncate text-xs leading-4 text-gray-600 md:hidden'}`}>{columns[index].label}{marks[index] && <IncompleteDot reason={marks[index]!.reason} />}</span>}
            {index === nameIndex && row.href ? <Link href={row.href} onClick={remember} className="block min-h-11 content-center font-semibold text-brand-800 after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-brand-700">{value}</Link> : cell(row, index)}
          </td>)}
          {hasMore && <td className="absolute right-0 top-0 z-10 block text-right md:relative md:table-cell md:h-12 md:border-b md:border-gray-100">{more(row)}</td>}
        </tr>
        {hasMore && <tr hidden={!expanded.includes(row.key)} id={`${id}-${row.key}`} className="block bg-gray-50 md:table-row"><td colSpan={columns.length + 1} className="block p-2 text-xs md:table-cell"><div data-extra-columns className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:gap-x-4">{columns.map((column, index) => index !== nameIndex && !column.control && <div key={index} className={`min-w-0 ${onMobile(column, index) ? 'hidden' : 'block'} ${column.hide === 'always' ? 'md:block' : column.hide === 'narrow' ? 'md:block @min-[936px]:hidden' : 'md:hidden'}`}><span className="block text-gray-600">{column.label}{marks[index] && <IncompleteDot reason={marks[index]!.reason} />}</span>{cell(row, index)}</div>)}</div>{row.details}</td></tr>}
      </tbody>)}
    </table>
  </div>;
}
function columnAlign(column: ReportColumn, index: number, nameIndex: number) { return column.align === 'left' || column.control || index === nameIndex ? 'text-left' : 'text-right'; }
