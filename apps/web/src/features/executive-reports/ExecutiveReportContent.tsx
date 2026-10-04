'use client';

import Link from 'next/link';
import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  EXECUTIVE_SHEET_WORDS as S, EXECUTIVE_COMPANY_SHEET_COLUMNS, EXECUTIVE_SORT_OPTIONS, COMPANY_TEAM_NOTE_WORDS as N, EXECUTIVE_NO_PLAN_DATA_LABEL, EXECUTIVE_PERIOD_WORDS as P, EXECUTIVE_HISTORY_EVENT_LABELS, executivePeriodReportLabels, EXECUTIVE_REFERRER_ADMIN_SUFFIX, EXECUTIVE_FLAG_LABELS,
  type ExecutiveOverview, type ExecutiveAnalysis, type ExecutiveCompanies, type ExecutiveCompanyDetail, type ExecutiveCompanyHistory,
  type ExecutiveCount, type ExecutiveMoney, type ExecutiveDrilldownFilters, type ExecutiveReceiptAdoption,
  type ExecutiveAsOfFigures, type ExecutiveAsOfCount, type ExecutivePaidUsage, type ExecutiveSpendConcentration, type ExecutiveCompanyRow,
} from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeeBadge } from '@/common/components/mangmee';
import { ExecutiveSectionCard as Card, ExecutiveKpi, ExecutiveKpiStrip, ExecutiveTable as ReportTable, Figure, IncompleteDot, ReportNotes, ExecutiveTabs, type ReportColumn, type ReportDetailGroup, type ReportDetailItem } from './ExecutiveReportDesign';
import { DesignIcons } from '@/features/web-core-workspace/design-icons';
import { ExecutiveCompanyNote, ExecutiveNoteAction, type NoteChange } from './ExecutiveCompanyNote';
import { Button } from '@/common/components/button';
import { CoverLoader, EmptyState } from '@/common/components/state';
import { W, RANK_LABELS, REPORT_VIEWS, DETAIL_TABS, COMPANY_GROUPS as G, thaiLabel } from './executive-reports.words';
import { money, ratioText, reportDate, reportDateTime, periodText, reasonText, sourceCount, sourceMoney, contactFields, rankingTieText, spendTieText, negativeMoneyNote, drilldownHref, menuHref, executiveHref, reportShortDate, reportShortMonth, reportView, figureNumber, shortFigureNumber, hoistedSource, drillFilters, INFOGRAPHIC_FILTERS } from './executive-reports.logic';

const LABELS = executivePeriodReportLabels();
type Navigation = { params: URLSearchParams; from: string; remember: () => void; navigate: (href: string) => void };
const linkClass = 'flex min-h-11 min-w-11 w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 text-gray-900';
const linkFocus = 'group min-w-0 break-words [overflow-wrap:anywhere] transition-colors hover:bg-brand-25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700';
export function ReportLink({ href, children, remember, className = linkClass }: { href: string; children: ReactNode; remember?: () => void; className?: string }) {
  return <Link href={href} onClick={remember} className={`${className} ${linkFocus}`}>{children}</Link>;
}
export function DrillLink({ filters, children, nav, className }: { filters: ExecutiveDrilldownFilters; children: ReactNode; nav: Navigation; className?: string }) {
  return <ReportLink href={drilldownHref(nav.params, nav.from, filters)} remember={nav.remember} className={className}>{children}</ReportLink>;
}
function openReport(nav: Navigation, href: string) { nav.remember(); nav.navigate(href); }
export function ReportSkeleton() {
  return <div role="status" aria-busy="true" className="space-y-4"><span className="sr-only">{W.loading}</span><div aria-hidden="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(key => <MangmeeCard key={key} className="h-32 bg-gray-50 p-4 motion-safe:animate-pulse"><span className="block h-4 w-2/3 rounded bg-gray-200" /></MangmeeCard>)}</div><MangmeeCard className="h-64 bg-gray-50 p-4 motion-safe:animate-pulse"><span aria-hidden="true" className="block h-4 w-1/3 rounded bg-gray-200" /></MangmeeCard></div>;
}
export { Figure } from './ExecutiveReportDesign';
/**
 * How wide the widest of a chart's labels is, in `ch` of the label's own font: a digit or a letter is about 0.9, the marks between digits about
 * half of that, a Thai mark above or below a letter nothing. Never narrower than the month's name under the bar.
 */
const labelWidth = (labels: string[]) => Math.round(100 * Math.max(4.4, ...labels.map(label => [...label].reduce((width, char) => width + (/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(char) ? 0 : /[.,\s]/.test(char) ? 0.45 : 0.9), 0)))) / 100;
/** A chart wider than its card opens on its latest months. */
const showLatest = (scroller: HTMLDivElement | null) => { if (scroller) scroller.scrollLeft = scroller.scrollWidth; };
/** A tab that needs a read of its own: which tab, and how tall the panel it replaces was. */
export type PanelRead = { view: string; label?: string; minHeight: number };
/** The panel while its tab is being read: everything above it stays in place and in use, and the loading state sits where the answer will be. */
function PanelLoading({ read }: { read: PanelRead }) {
  // As tall as the panel it replaces, so nothing below moves; the loading state itself is at the top, where the reader is looking.
  return <div id="executive-panel" role="tabpanel" aria-labelledby={`executive-tab-${read.view}`} aria-label={read.label} aria-busy="true" style={{ minHeight: read.minHeight }}><div className="relative h-64 overflow-hidden rounded-xl"><CoverLoader active label={W.loading} /></div></div>;
}
function DetailValues({ rows }: { rows: Array<[string, ReactNode]> }) {
  return <dl className="grid min-w-0 gap-3 sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="min-w-0 break-words [overflow-wrap:anywhere]"><dt className="text-xs text-gray-600">{label}</dt><dd className="text-base">{value}</dd></div>)}</dl>;
}
const segmentColours = { EVER: 'brand-700', NEVER: 'gold-500', UNKNOWN: 'gray-200', NOT_ENTITLED: 'gray-200' };
function ReceiptAdoption({ data, nav, actions, children }: { data: ExecutiveReceiptAdoption; nav: Navigation; actions?: ReactNode; children?: ReactNode }) {
  const patternId = useId();
  let offset = 0;
  return <Card title={W.adoptionTitle} actions={actions}>
    {data.population === 0 ? <EmptyState title={W.noRows} description="" /> : <>
      <div className="grid items-center gap-3 xl:grid-cols-[10rem_minmax(0,1fr)]">
        <div className="relative mx-auto size-40" role="group" aria-label={W.adoptionTitle}>
          <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
            <defs><pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--color-gray-200)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-gray-600)" strokeWidth="2" /></pattern></defs>
            <circle cx="60" cy="60" r="46" fill="none" stroke="var(--color-gray-100)" strokeWidth="18" />
            {data.segments.map(segment => {
              const length = segment.count / data.population * 100;
              const start = offset; offset += length;
              const stroke = segment.key === 'UNKNOWN' ? `url(#${patternId})` : `var(--color-${segmentColours[segment.key]})`;
              return length > 0 && <a key={segment.key} href={drilldownHref(nav.params, nav.from, segment.drilldownFilters)} onClick={nav.remember} tabIndex={-1} className="cursor-pointer hover:opacity-80"><circle data-segment={segment.key} cx="60" cy="60" r="46" fill="none" stroke={stroke} strokeWidth="18" pathLength="100" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} /></a>;
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><strong className="executive-donut-total text-4xl text-brand-800 tabular-nums">{data.population.toLocaleString('th-TH')}</strong><span className="text-xs text-gray-600">{W.unitCompany}</span></div>
        </div>
        <ul className="grid gap-0">{data.segments.map(segment => <li key={segment.key} className="min-w-0"><DrillLink nav={nav} filters={segment.drilldownFilters} className="flex min-h-11 items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-brand-25">
          <span data-adoption-swatch={segment.key} className="h-4 w-4 shrink-0 rounded-sm border border-gray-600" style={{ backgroundColor: `var(--color-${segmentColours[segment.key]})`, ...(segment.key === 'UNKNOWN' ? { backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 3px, var(--color-gray-600) 3px, var(--color-gray-600) 5px)' } : {}) }} aria-hidden="true" />
          <span className="flex-1" aria-label={`${LABELS.receiptAdoption[segment.key]} · ${segment.count.toLocaleString('th-TH')} ${W.unitCompany} · ${ratioText(segment.share)}`}>{LABELS.receiptAdoption[segment.key]}<strong className="ml-2 whitespace-nowrap text-sm tabular-nums">{segment.count.toLocaleString('th-TH')} · {ratioText(segment.share)}</strong></span><span aria-hidden="true">→</span>
        </DrillLink></li>)}</ul>
      </div>
    </>}
{children}
<p className="text-xs text-gray-600">{W.receiptDefinition} · {W.current} · {W.base(data.population)} · {W.chartHint}{data.roundingNote && ` · ${W.rounding}`}</p>
  </Card>;
}
function PaidUsage({ data, nav }: { data: ExecutivePaidUsage; nav: Navigation }) {
  const tile = (label: string, n: number, filters: ExecutiveDrilldownFilters) => <DrillLink nav={nav} filters={filters} className="executive-kpi-link relative block rounded-xl pr-0 hover:bg-brand-25"><ExecutiveKpi label={label} iconName="users" value={n.toLocaleString('th-TH')} unit={W.unitCompany} arrow /></DrillLink>;
  return <Card title={W.paidUsage}><p className="text-xs text-gray-600">{W.cumulative}</p><ExecutiveKpiStrip>
    {data.groups.map(group => <div key={group.key}>{tile(LABELS.usageGroup[group.key], group.count, group.drilldownFilters)}</div>)}
    {tile(LABELS.paidEver.YES, data.paidEver.count, data.paidEver.drilldownFilters)}
    {data.usageUnassessed.count > 0 && tile(W.usageUnassessed, data.usageUnassessed.count, data.usageUnassessed.drilldownFilters)}
    {data.paymentUnknown.count > 0 && tile(W.paymentUnassessed, data.paymentUnknown.count, data.paymentUnknown.drilldownFilters)}
    {data.fullyRefunded.count > 0 && tile(refundLabel, data.fullyRefunded.count, data.fullyRefunded.drilldownFilters)}
  </ExecutiveKpiStrip></Card>;
}
// Flag copy comes from the same contract used on drilled chips.
const refundLabel = EXECUTIVE_FLAG_LABELS.fullyRefunded.true;

export function OverviewContent({ data, nav }: { data: ExecutiveOverview; nav: Navigation }) {
  const followUps = data.asOfFigures ? [{ label: S.invite, ...data.asOfFigures.followUp.neverUsed }, { label: S.followExisting, ...data.asOfFigures.followUp.churn }] : [];
  const followUpNeeded = followUps.filter(group => (group.value ?? group.knownValue ?? 0) > 0);
  const cards = [
    { label: W.companyCount, metric: data.metrics.companies, icon: 'store', sub: data.metrics.companies.unclassifiedCount > 0 ? W.unclassified(data.metrics.companies.unclassifiedCount) : undefined },
    { label: W.active, metric: data.metrics.activeCompanies, icon: 'bolt', sub: undefined },
    { label: W.paid, metric: data.metrics.companiesWithReceipts, icon: 'receipt', sub: undefined },
    { label: W.net, metric: data.metrics.netReceiptsSatang, icon: 'money', sub: undefined, money: true },
  ];
  return <ReportNotes data={data}>
    <ExecutiveKpiStrip>{cards.map(card => <Link key={card.label} href={drilldownHref(nav.params, nav.from, card.metric.drilldownFilters)} onClick={nav.remember} className={`executive-kpi-link relative rounded-xl group ${linkFocus}`}>
      <ExecutiveKpi iconName={card.icon} label={card.label} figure={card.metric} moneyValue={card.money} netValue={card.money} unit={card.money ? W.unitBaht : W.unitCompany} sub={card.sub} comparison={card.metric.comparison} arrow />
    </Link>)}{data.churn && <div className="relative min-w-0"><DrillLink nav={nav} filters={data.churn.drilldownFilters} className="executive-kpi-link block rounded-xl"><ExecutiveKpi label={S.churn} figure={data.churn} unit={W.unitCompany} iconName="users" supporting={data.churn.share?.value != null ? S.churnShare(ratioText(data.churn.share)) : undefined} comparison={data.periodComparisons?.churnedCompanies ?? data.churn.comparison} arrow /></DrillLink><details className="absolute bottom-0 right-0 z-10"><summary aria-label={S.churnHelp(reportDate(data.churn.referenceDate))} title={S.churnHelp(reportDate(data.churn.referenceDate))} className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-lg text-brand-800 focus-visible:outline-2 focus-visible:outline-brand-700"><DesignIcons.info className="size-4" /></summary><p className="absolute right-0 top-full z-30 w-72 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-lg">{S.churnHelp(reportDate(data.churn.referenceDate))}</p></details></div>}</ExecutiveKpiStrip>
    <p className="text-xs text-gray-600">{W.excluded} · {W.activityDefinition} · {W.paidDefinition}{data.metrics.netReceiptsSatang.coverage === 'complete' && negativeMoneyNote(data.metrics.netReceiptsSatang.value) && ` · ${W.negative}`}{data.metrics.activeCompanies.breakdown.notPaid > 0 && ` · ${W.unpaidActive(data.metrics.activeCompanies.breakdown.notPaid)}`}{data.metrics.activeCompanies.breakdown.paymentUnknown > 0 && ` · ${W.paymentUnknownActive(data.metrics.activeCompanies.breakdown.paymentUnknown)}`}</p>
    <ReceiptAdoption data={data.expenseReceiptAdoption} nav={nav} actions={<Button variant="secondary" onClick={() => openReport(nav, menuHref('usage', nav.params, { view: 'ranking' }))}>{W.seeRanking}</Button>}>
      <ReportLink href={menuHref('revenue', nav.params, { view: 'top' })} remember={nav.remember} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-gray-100 px-2 py-1"><span className="flex-1"><span className="text-sm font-semibold">{W.top}</span><span className="block text-xs text-gray-600">{W.followUpDescriptions.top}</span></span><strong className="shrink-0 text-xl tabular-nums">{ratioText(data.spendConcentration.topShare)} →</strong></ReportLink>

    </ReceiptAdoption>
    {data.asOfFigures && <AsOfInfographic data={data.asOfFigures} nav={nav} />}
    {followUpNeeded.length > 0 && <aside className="executive-follow-up-band flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-center rounded-xl bg-brand-800 p-4 text-white sm:p-3">
      <h2 className="flex items-center gap-3 font-semibold"><DesignIcons.megaphone className="size-6 shrink-0 text-gold-300" />{S.followUp}{followUpNeeded.some(group => group.coverage !== 'complete') && <IncompleteDot reason={[...new Set(followUpNeeded.flatMap(group => group.reasonCodes))].map(code => reasonText(code)).join(' · ')} />}</h2>
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">{followUpNeeded.map(group => <DrillLink key={group.label} nav={nav} filters={group.drilldownFilters} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-white/30 px-3 py-2 text-white hover:!bg-brand-700">
        <span>{group.label}</span><strong className="shrink-0 tabular-nums"><Figure value={group} mark={false} /> {W.unitCompany} <span aria-hidden="true">→</span></strong>
      </DrillLink>)}</div>
    </aside>}
  </ReportNotes>;
}

function AsOfInfographic({ data, nav }: { data: ExecutiveAsOfFigures; nav: Navigation }) {
  const rows = (list: Array<ExecutiveAsOfCount & { label: string }>, vertical = false) => {
    // "At least 0" says nothing about a group, so it reads as not known yet ("–"), never as zero. A bar is as long as its count is of the largest
    // count beside it; a share is printed only where the API gives one (it gives none while the total itself is still "at least").
    const items = list.map(item => item.value === null && !item.knownValue ? { ...item, knownValue: undefined } : item);
    const count = (item: ExecutiveAsOfCount) => item.value ?? item.knownValue ?? 0;
    const max = Math.max(1, ...items.map(count)), shares = items.some(item => item.share?.value != null);
    return <ul className={vertical ? 'grid grid-cols-3 items-end gap-3 pt-2' : 'grid gap-1'}>{items.map((item, index) => <li key={`${item.label}-${index}`}><DrillLink nav={nav} filters={item.drilldownFilters} className={vertical ? 'flex min-h-11 flex-col items-center gap-1 rounded-lg p-1 text-center text-xs' : 'block min-h-11 rounded-lg px-1 py-1 text-xs'}>
      {vertical ? <><strong className="whitespace-nowrap tabular-nums"><Figure value={item} mark={false} /></strong><div aria-hidden="true" className="flex h-16 w-9 items-end rounded bg-gray-100"><div className="w-full rounded bg-brand-700" style={{ height: `${count(item) / max * 100}%` }} /></div><span>{item.label}</span>{shares && <span className="tabular-nums text-gray-600">{ratioText(item.share)}</span>}</> : <><div className="flex items-baseline justify-between gap-2"><span className="min-w-0">{item.label}</span><strong className="shrink-0 whitespace-nowrap tabular-nums"><Figure value={item} mark={false} />{shares && <> · {ratioText(item.share)}</>}</strong></div><div aria-hidden="true" className="mt-1 h-1 rounded bg-gray-100"><div className="h-full rounded bg-brand-700" style={{ width: `${count(item) / max * 100}%` }} /></div></>}
    </DrillLink></li>)}</ul>;
  };
  const mark = (items: ExecutiveAsOfCount[]) => items.some(item => item.coverage !== 'complete') ? <IncompleteDot reason={[...new Set(items.flatMap(item => item.reasonCodes))].map(code => reasonText(code)).join(' · ')} /> : null;
  return <section data-executive-as-of className="space-y-2">
    <header className="flex items-center justify-between gap-3 border-b border-brand-200 pb-1"><h2 className="text-sm font-semibold text-brand-800">{S.asOf}</h2><span className="whitespace-nowrap text-sm text-gray-600">{reportDate(data.asOf)}</span></header>
    <p className="text-xs text-gray-600">{S.asOfHelp}</p>
    <div className="grid min-w-0 gap-3 min-[1200px]:grid-cols-3">
      <Card title={<>{S.receiptDistribution}{mark(data.receiptBuckets)}</>}>{rows(data.receiptBuckets, true)}</Card>
      <Card title={<>{S.recentUsage}{mark([data.receipts30, data.receipts7, data.receiptDays30AtLeast2])}</>}>{rows([{ ...data.receipts30, label: S.receipts30 }, { ...data.receipts7, label: S.receipts7 }, { ...data.receiptDays30AtLeast2, label: S.receiptDays30AtLeast2 }])}</Card>
      <Card title={<>{S.packagesFound}{mark(data.packages)}</>}>{rows([...data.packages].sort((a, b) => Number(a.label === EXECUTIVE_NO_PLAN_DATA_LABEL) - Number(b.label === EXECUTIVE_NO_PLAN_DATA_LABEL)))}</Card>
    </div>
  </section>;
}

function companyLink(id: string, params: URLSearchParams): string {
  const next = new URLSearchParams(params); next.delete('tab');
  return executiveHref(`/system/executive/companies/${encodeURIComponent(id)}`, next);
}
type StatusRow = Pick<ExecutiveCompanyRow, 'paidEver' | 'usageGroup' | 'usageUnassessedReason'> & { fullyRefunded: boolean | null };
const rowStatusLabel = (row: StatusRow) => row.fullyRefunded ? refundLabel : row.usageGroup ? LABELS.usageGroup[row.usageGroup] : LABELS.paidEver[row.paidEver.value];
const rowStatus = (row: StatusRow) => <MangmeeBadge className="max-w-full" tone={row.fullyRefunded ? 'amber' : row.usageGroup === 'ACTIVE' ? 'brand' : 'slate'}><span className="min-w-0 truncate" title={rowStatusLabel(row)}>{rowStatusLabel(row)}</span>{(row.usageUnassessedReason || row.paidEver.reason) && <IncompleteDot reason={[row.usageUnassessedReason, row.paidEver.reason].filter(Boolean).map(code => reasonText(code!)).join(' · ')} />}</MangmeeBadge>;

function referrer(row: ExecutiveCompanyRow['referrer']): string {
  return `${thaiLabel(row.label, row.salesCode)}${row.source === 'ADMIN' ? ` ${EXECUTIVE_REFERRER_ADMIN_SUFFIX}` : ''}`;
}
const sheetLabel = (key: string) => EXECUTIVE_COMPANY_SHEET_COLUMNS.find(column => column.key === key)!.label;
/** Facts of the selected period, which the owner's sheet does not carry, under the key the API orders the list by. */
const PERIOD_LABELS: Record<string, string> = { netReceipts: W.unitInHeader(W.shortNet, W.unitBaht), expenseReceiptCount: W.receiptCount, activeDays: W.days, aiRequests: W.ai, lastActivityAt: W.lastActivity };
const factLabel = (key: string) => PERIOD_LABELS[key] ?? sheetLabel(key);
/** The sheet's own columns after the name, in the owner's order (2026-10-04). The contact pair and the note follow them. */
const SHEET_COLUMNS = ['businessType', 'plan', 'receiptsLifetime', 'lastReceiptAt', 'planEndsAt'];
const contactLink = 'relative z-10 block truncate text-brand-800 underline decoration-1 underline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-700 max-md:-my-1.5 max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:whitespace-normal max-md:[overflow-wrap:anywhere]';
/** A header on two lines breaks before `part` and nowhere else: left alone, the browser cuts a word it does not know (แพ็กเกจ) in two. */
const brokenBefore = (label: string, part: string): ReactNode => label.endsWith(part) && label.length > part.length ? <><span className="whitespace-nowrap">{label.slice(0, -part.length)}</span><wbr /><span className="whitespace-nowrap">{part}</span></> : label;

const paymentStateLabel = (row: ExecutiveCompanyRow) => row.sheet.paymentState.fullyRefunded ? refundLabel : LABELS.paidEver[row.sheet.paymentState.paidEver];
/** Every fact of one company the list can show, under the key the API orders it by. A fact that is not known reads "–", never 0. */
function companyFacts(row: ExecutiveCompanyRow, data: ExecutiveCompanies): Record<string, ReactNode> {
  const sheet = row.sheet, usage = row.coverage?.usage ?? data.coverage.usage;
  const number = (value: number | null) => value === null ? '–' : value.toLocaleString('th-TH');
  return {
    businessType: sheet.businessTypeLabel ? <span className="whitespace-normal md:line-clamp-2" title={sheet.businessTypeLabel}>{sheet.businessTypeLabel}</span> : '–',
    plan: <span className="flex min-w-0 flex-col items-start gap-1 max-md:items-end"><MangmeeBadge className="max-w-full"><span className="min-w-0 truncate" title={row.planLabel}>{row.planLabel}</span></MangmeeBadge>{row.planState !== 'ACTIVE' && <span className="text-xs leading-4 text-gray-600">{LABELS.planState[row.planState] ?? W.unknown}</span>}</span>,
    receiptsLifetime: <Figure value={sheet.receiptsLifetime} />, lastReceiptAt: reportShortDate(sheet.lastReceiptAt), planEndsAt: reportShortDate(sheet.planEndsAt),
    firstReceiptAt: reportShortDate(sheet.firstReceiptAt), receipts7: <Figure value={sheet.receipts7} />, receipts30: <Figure value={sheet.receipts30} />, receiptDays30: <Figure value={sheet.receiptDays30} />,
    daysSinceLastReceipt: number(sheet.daysSinceLastReceipt), confirmed: <Figure value={sheet.confirmed} />, pending: <Figure value={sheet.pending} />, draft: <Figure value={sheet.draft} />,
    receiptBucket: sheet.receiptBucket ? S.receiptBucket[sheet.receiptBucket] : '–',
    paymentState: paymentStateLabel(row),
    // The sheet says "หมดอายุแล้ว" for a package that has run out, never a negative number of days.
    daysLeft: sheet.packageExpired ? S.expired : number(sheet.daysLeft),
    lifetimeReceiptsSatang: <Figure value={sheet.lifetimeReceiptsSatang} moneyValue />, lifetimeRefundsSatang: <Figure value={sheet.lifetimeRefundsSatang} moneyValue />, lifetimeNetSatang: <Figure value={sheet.lifetimeNetSatang} moneyValue netValue />,
    activeMemberCount: number(sheet.activeMemberCount), branchCount: number(sheet.branchCount), joinedAt: reportShortDate(row.joinedAt),
    signupRail: thaiLabel(LABELS.signupRail[row.signupRail] ?? W.unknown), discovery: [thaiLabel(row.discovery.label), row.discovery.otherText].filter(Boolean).join(' · '), referrer: referrer(row.referrer),
    aiRequests30: <Figure value={sheet.aiRequests30} />, lastUseAt: reportShortDate(row.inactivity.lastUseAt),
    // A number the API gives is shown as it is; where it gives none, the dash says why (the dot).
    daysSinceLastUse: row.inactivity.daysSinceLastUse === null ? <Figure value={sourceCount(null, row.inactivity.coverage)} /> : number(row.inactivity.daysSinceLastUse),
    churned: row.inactivity.churned === null ? <Figure value={sourceCount(null, row.inactivity.coverage)} /> : row.inactivity.churned ? W.yes : W.export.no,
    netReceipts: <Figure value={sourceMoney(row.metrics.netReceiptsSatang, row.coverage?.money ?? data.coverage.money)} moneyValue netValue />,
    expenseReceiptCount: <Figure value={sourceCount(row.metrics.expenseReceiptCountInPeriod, usage)} />, activeDays: <Figure value={sourceCount(row.metrics.activeDays, usage)} />,
    aiRequests: <Figure value={sourceCount(row.metrics.aiRequests, usage)} />, lastActivityAt: reportShortDate(row.lastActivityAt),
  };
}

export function CompaniesContent({ data, nav, sortColumn, onNote }: { data: ExecutiveCompanies; nav: Navigation; sortColumn?: (key: string) => void; onNote?: NoteChange }) {
  const netSort = data.sort.sortBy === 'netReceipts', ranked = ['netReceipts', 'expenseReceiptCount', 'activeDays', 'aiRequests'].includes(data.sort.sortBy);
  const churnFilter = nav.params.get('filter_churned') === 'true' || drillFilters(nav.params)?.churned === 'true';
  // The contact pair exists only where the API returns contacts (the reader holds that right). Without it there is no column: no empty or masked cell.
  const contacts = data.items.some(row => row.ownerContact.status !== 'NOT_PERMITTED');
  // What the list is filtered or ordered by is read right after the name, unless the sheet's own columns (or the name's own line) already show it.
  const lead = [...new Set([...(churnFilter ? ['lastUseAt', 'daysSinceLastUse'] : []), data.sort.sortBy as string])].filter(key => !['companyName', 'joinedAt', ...SHEET_COLUMNS].includes(key));
  const order = (key: string) => EXECUTIVE_SORT_OPTIONS.some(option => option.sortBy === key) ? { sort: data.sort.sortBy === key ? data.sort.sortDir === 'asc' ? 'ascending' as const : 'descending' as const : undefined, onSort: sortColumn && (() => sortColumn(key)) } : {};
  const text = { align: 'left' as const };
  // Sized so the nine columns fit a 1280 px screen (974 px of table); under that the card scrolls sideways and the name stays in place.
  const columns: ReportColumn[] = [
    { label: sheetLabel('company'), width: 150, ...order('companyName') }, ...lead.map(key => ({ label: factLabel(key), width: 104, ...order(key) })),
    { label: sheetLabel('businessType'), width: 112, ...text }, { label: sheetLabel('plan'), width: 100, ...text },
    { label: sheetLabel('receiptsLifetime'), head: brokenBefore(sheetLabel('receiptsLifetime'), '(รายการ)'), width: 100, ...order('receiptsLifetime') },
    { label: sheetLabel('lastReceiptAt'), head: brokenBefore(sheetLabel('lastReceiptAt'), 'ล่าสุด'), width: 84, ...order('lastReceiptAt') },
    { label: sheetLabel('planEndsAt'), head: brokenBefore(sheetLabel('planEndsAt'), 'แพ็กเกจ'), width: 80, ...order('planEndsAt') },
    ...(contacts ? [{ label: sheetLabel('email'), width: 116, ...text }, { label: sheetLabel('phone'), width: 100, ...text }] : []),
    { label: sheetLabel('note'), width: contacts ? 88 : 304, ...text },
  ];
  return <ReportNotes data={data}>
    <div data-executive-quick-filters className="flex min-w-0 items-center gap-2 overflow-x-auto">{INFOGRAPHIC_FILTERS.map(({ key, value, label }) => <DrillLink key={`${key}-${value}`} nav={nav} filters={{ ...(drillFilters(nav.params) ?? {}), [key]: value, ...(['churned'].includes(key) ? {} : { atDataDate: 'true' }) }} className="flex min-h-11 shrink-0 items-center rounded-full border border-gray-200 px-3 text-xs text-brand-800">{label}</DrillLink>)}<Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => { const panel = document.getElementById('executive-filter-packageLabel')?.closest<HTMLElement>('[popover]'); if (panel) document.querySelector<HTMLButtonElement>(`button[popovertarget="${panel.id}"]`)?.click(); }}>{S.package}</Button></div>
    <p role="status" className="text-sm tabular-nums">{W.found(data.pagination.total)} · {W.shortNet} <Figure value={data.summary.netReceiptsSatang} moneyValue netValue unit={W.unitBaht} /></p>
    {data.pagination.total === 0 ? <EmptyState title={W.empty} description="" /> : <section aria-label={W.companies} className="rounded-xl border border-gray-200 bg-white">
      <ReportTable title={W.companies} sheet columns={columns} remember={nav.remember} rows={data.items.map(row => {
        const facts = companyFacts(row, data), fact = (key: string): ReportDetailItem => ({ label: factLabel(key), value: facts[key] });
        // A contact is a link the reader presses to write or call. It goes nowhere else: not into an address of this site, a log or a count.
        const email = row.ownerContact.status === 'OK' && row.ownerContact.email, phone = row.ownerContact.status === 'OK' && row.ownerContact.phoneNumber;
        // Why there is no contact (no owner account, several owners) is said once, in the first of the two cells.
        const noContact = row.ownerContact.status === 'OK' ? null : contactFields(row.ownerContact)[0]?.[1];
        const reasons = [...new Set([row.paidEver.reason, row.usageUnassessedReason].filter((code): code is string => !!code && ![...data.coverage.money.reasonCodes, ...data.coverage.usage.reasonCodes].some(common => common === code)))].map(code => reasonText(code));
        const groups: ReportDetailGroup[] = [
          // Every reader reads the note; an account with the note right also gets the action that opens its editor (so also where there is no note yet).
          ...(row.note.text || row.note.updatedAt || row.canEditNote ? [{ title: N.title, items: [{ label: sheetLabel('note'), value: row.note.text ? <span className="whitespace-pre-wrap">{row.note.text}</span> : N.empty, wide: true },
            ...(row.note.updatedAt ? [{ label: sheetLabel('noteUpdatedBy'), value: row.note.updatedBy?.displayName ?? '–' }, { label: sheetLabel('noteUpdatedAt'), value: reportDateTime(row.note.updatedAt, '–') }] : [])],
            action: row.canEditNote ? <ExecutiveNoteAction companyId={row.id} companyName={row.displayName} note={row.note} canEdit period={data.period} onChange={onNote} /> : undefined }] : []),
          { title: G.receipts, items: ['firstReceiptAt', 'receipts7', 'receipts30', 'receiptDays30', 'daysSinceLastReceipt', 'confirmed', 'pending', 'draft', 'receiptBucket'].map(fact) },
          { title: G.plan, items: ['paymentState', 'daysLeft', 'lifetimeReceiptsSatang', 'lifetimeRefundsSatang', 'lifetimeNetSatang'].map(fact) },
          { title: G.people, items: [...['activeMemberCount', 'branchCount', 'joinedAt', 'signupRail', 'discovery', 'referrer'].map(fact), { label: W.registered, value: row.registeredName || W.unknown }, { label: W.group, value: row.industryGroup.label }, { label: W.filterLabels.companyStatus, value: LABELS.companyStatus[row.companyStatus] ?? W.unknown }] },
          { title: G.usage, items: [...['lastUseAt', 'daysSinceLastUse', 'churned', 'aiRequests30'].map(fact), { label: W.filterLabels.receiptAdoption, value: LABELS.receiptAdoption[row.receiptAdoption] ?? W.unknown }] },
          // The figures of the period chosen above the list, apart from the sheet's own (which are as of the data date).
          { title: periodText(data.period), items: [...(rowStatusLabel(row) === paymentStateLabel(row) ? [] : [{ label: W.filterLabels.usageGroup, value: rowStatus(row) }]), ...['expenseReceiptCount', 'activeDays'].map(fact),
            ...([[W.users, 'activeUsers'], [W.documents, 'documents']] as const).map(([label, key]) => ({ label, value: <Figure value={sourceCount(row.metrics[key], data.coverage.usage)} /> })), ...['aiRequests', 'netReceipts', 'lastActivityAt'].map(fact),
            ...(ranked ? [{ label: W.rank, value: row.rank ?? '–' }] : []),
            ...(netSort ? [{ label: W.cumulativeShare, value: row.cumulativeShare ? ratioText(row.cumulativeShare) : data.coverage.money.coverage === 'complete' && row.metrics.netReceiptsSatang !== null && row.metrics.netReceiptsSatang <= 0 ? W.notInShare : '–' }] : []),
            ...(reasons.length ? [{ label: W.export.notes, value: reasons.join(' · '), wide: true }] : [])] },
        ];
        return { key: row.id, href: companyLink(row.id, nav.params), className: 'executive-company-row', groups, cells: [
          <div key="name" className="min-w-0"><span className="block truncate" title={row.displayName}>{row.displayName}</span><span className="block truncate text-xs font-normal text-gray-600" title={row.provinceLabel}>{W.joinedShort(reportShortDate(row.joinedAt))} · {row.provinceLabel}</span></div>,
          ...lead.map(key => facts[key]), ...SHEET_COLUMNS.map(key => facts[key]),
          ...(contacts ? [email ? <a key="email" href={`mailto:${encodeURI(email)}`} title={email} className={contactLink}>{email}</a> : noContact ? <span key="email" className="whitespace-normal text-gray-600 md:line-clamp-2" title={noContact}>{noContact}</span> : '–',
            phone ? <a key="phone" href={`tel:${phone.replace(/[^\d+]/g, '')}`} className={contactLink}>{phone}</a> : '–'] : []),
          row.note.text ? <span key="note" className="line-clamp-2 whitespace-normal" title={row.note.text}>{row.note.text}</span> : '–',
        ], action: <ReportLink href={companyLink(row.id, nav.params)} remember={nav.remember} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-brand-800 md:w-auto">{W.detail}<span aria-hidden="true">→</span></ReportLink> };
      })} />
      <p className="px-2 py-1 text-xs text-gray-600">{S.asOf} {reportDate(data.items[0]?.sheet.asOf)} · {data.coverage.money.coverage === 'complete' && data.items.some(row => row.metrics.netReceiptsSatang !== null && row.metrics.netReceiptsSatang < 0) && `${W.negative} · `}{W.receiptDefinition} · {W.documentDefinition} · {W.usersDefinition} · {W.aiDefinition}</p>
      {netSort && <p className="px-2 py-1 text-xs text-gray-600">{W.tieOrder}</p>}
    </section>}
  </ReportNotes>;
}

function RevenueContent({ data, nav, tabs, reading }: { data: ExecutiveAnalysis & { revenue: NonNullable<ExecutiveAnalysis['revenue']> }; nav: Navigation; tabs: ReactNode; reading?: PanelRead }) {
  const revenue = data.revenue, view = reportView('revenue', nav.params), pattern = useId();
  const monthly = data.monthlySeries?.find(series => series.metric === 'netReceiptsSatang');
  const trend = monthly ? monthly.points.map(point => ({ month: point.month, netReceiptsSatang: { ...point.metricValue, currency: 'THB' as const, affectedMonths: point.metricValue.affectedMonths ?? [{ month: point.month, reasonCodes: point.metricValue.reasonCodes }] } })) : revenue.trend;
  const columns = { gridTemplateColumns: `repeat(${Math.max(1, trend.length)}, minmax(0, 1fr))` };
  const figures: Array<[string, ExecutiveMoney]> = [[W.shortNet, revenue.netReceiptsSatang], [W.shortReceipts, revenue.receiptsSatang], [W.shortRefunds, revenue.refundsSatang], [W.tax, revenue.taxSatang], [W.shortFees, revenue.feesSatang]];
  const trendSource = hoistedSource(trend.map(point => ({ coverage: point.netReceiptsSatang.coverage, source: 'money' })));
  // Between two values of the chart: a little air, and room for a value's own amber dot where the title does not carry it for all of them.
  const labelGap = trendSource ? '0.625rem' : '1rem';
  const max = Math.max(1, ...trend.map(point => Math.abs(point.netReceiptsSatang.value ?? point.netReceiptsSatang.knownValue ?? 0)));
  const moneyColumn = (label: string, secondary = false) => ({ label: W.unitInHeader(label, W.unitBaht), width: 136, ...(secondary ? { hide: 'narrow' as const, mobile: false } : label === W.shortRefunds ? { hide: 'narrow' as const } : {}) });
  const unmatchedRows: Array<[string, ExecutiveCount, boolean]> = [[W.unmatched, sourceCount(data.unmatchedMoney.count, data.coverage.money), false], [W.shortReceipts, sourceMoney(data.unmatchedMoney.receiptsSatang, data.coverage.money), true], [W.shortRefunds, sourceMoney(data.unmatchedMoney.refundsSatang, data.coverage.money), true], [W.excludedNet, sourceMoney(data.population.excludedTestInternalNetReceiptsSatang, data.coverage.money), true], [W.unclassifiedNet, sourceMoney(data.population.unclassifiedNetReceiptsSatang, data.coverage.money), true], [W.disputes, sourceCount(revenue.disputedInvoiceCount, data.coverage.money), false]];
  return <>
    <ExecutiveKpiStrip>{figures.map(([label, figure], i) => <ExecutiveKpi key={label} iconName="money" label={label} figure={figure} moneyValue netValue={i === 0} unit={W.unitBaht} comparison={figure.comparison ?? data.periodComparisons?.[(["netReceiptsSatang", "receiptsSatang", "refundsSatang", "taxSatang", "feesSatang"] as const)[i]]} emphasis={i === 0} />)}</ExecutiveKpiStrip>
    {tabs}{reading ? <PanelLoading read={reading} /> : <div id="executive-panel" role="tabpanel" aria-labelledby={`executive-tab-${view}`} aria-label={REPORT_VIEWS.revenue.find(tab => tab.value === view)?.label}>
    {view === 'top' && data.spendConcentration && <SpendContent data={data.spendConcentration} nav={nav} />}
    {view === 'summary' && <Card title={W.purchase}><ReportTable title={W.purchase} columns={[{ label: W.purchase, width: 240 }, moneyColumn(W.shortReceipts), moneyColumn(W.shortRefunds), moneyColumn(W.shortNet), moneyColumn(W.tax, true), moneyColumn(W.shortFees, true)]} rows={revenue.byPurchaseGroup.map(row => ({ key: row.key, cells: [row.label, <Figure key="receipts" value={row.receiptsSatang} moneyValue />, <Figure key="refunds" value={row.refundsSatang} moneyValue />, <Figure key="net" value={row.netReceiptsSatang} moneyValue netValue />, <Figure key="tax" value={row.taxSatang} moneyValue />, <Figure key="fees" value={row.feesSatang} moneyValue />] }))} /><p className="text-xs text-gray-600">{W.moneyDefinition} · {W.vatIncluded}{revenue.byPurchaseGroup.some(row => row.netReceiptsSatang.coverage === 'complete' && negativeMoneyNote(row.netReceiptsSatang.value)) && ` · ${W.negative}`}</p></Card>}
    {view === 'unmatched' && <Card title={W.unmatched}><ReportTable title={W.unmatched} compactMobile columns={[{ label: W.item, width: 440 }, { label: W.unitInHeader(W.quantity, `${W.quantity} / ${W.unitBaht}`), width: 180 }]} rows={unmatchedRows.map(([label, value, cash]) => ({ key: label, cells: [label, <Figure key={label} value={value} moneyValue={cash} source="money" />] }))} />{data.population.unclassifiedCount > 0 && <p className="text-xs text-gray-600">{W.unclassified(data.population.unclassifiedCount)}</p>}</Card>}
    {view === 'trend' && <Card title={<span className="relative">{W.unitInHeader(W.trend, W.unitBaht)}{trendSource && <span className="absolute left-full top-1/2 -translate-y-1/2"><IncompleteDot reason={[...new Set(trend.flatMap(point => point.netReceiptsSatang.reasonCodes.map(code => reasonText(code, point.netReceiptsSatang.coverage, [point.month]))))].join(' · ')} /></span>}</span>}>
      {/* Every month is as wide as its value needs (the short value on a phone), so two values never touch and the last one stays inside the card; more months than fit scroll sideways. A value sits over the middle of its bar: the three rows share the same equal columns, with no gap. */}
      <div ref={showLatest} className="overflow-x-auto"><div className="min-w-[var(--chart-phone)] text-sm md:min-w-[var(--chart-desktop)]" style={{ '--chart-phone': `calc(${trend.length} * (${labelWidth(trend.map(point => shortFigureNumber(point.netReceiptsSatang, true)))}ch + ${labelGap}))`, '--chart-desktop': `calc(${trend.length} * (${labelWidth(trend.map(point => figureNumber(point.netReceiptsSatang, true)))}ch + ${labelGap}))` } as CSSProperties}><div className="executive-trend-labels grid items-end tabular-nums" style={columns}>{trend.map(point => <span key={point.month} className="flex min-w-0 justify-center"><Figure value={point.netReceiptsSatang} moneyValue mark={!trendSource} short /></span>)}</div>
      <svg viewBox="0 0 360 200" height="200" preserveAspectRatio="none" role="img" aria-label={W.trend} className="block h-[200px] w-full">
        <defs><pattern id={pattern} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--color-gray-100)" /><line x1="0" x2="0" y1="0" y2="6" stroke="var(--color-gray-400)" strokeWidth="2" /></pattern></defs>
        {[25, 50, 75, 125, 150, 175].map(y => <line key={y} x1="0" x2="360" y1={y} y2={y} stroke="var(--color-gray-100)" />)}
        <line x1="0" x2="360" y1="100" y2="100" stroke="var(--color-gray-400)" />{trend.map((point, index) => {
          const value = point.netReceiptsSatang.value ?? point.netReceiptsSatang.knownValue;
          const step = 360 / Math.max(1, trend.length), x = index * step + step / 4, width = step / 2;
          if (value === undefined) return <rect key={point.month} data-unavailable="true" x={x} y="10" width={width} height="90" fill={`url(#${pattern})`} />;
          const height = Math.abs(value) / max * 90;
          return <g key={point.month}><title>{reportShortMonth(point.month)}: {figureNumber(point.netReceiptsSatang, true)}</title><rect x={x} y={value < 0 ? 100 : 100 - height} width={width} height={Math.max(1, height)} fill={value < 0 ? 'var(--color-red-600)' : 'var(--color-brand-800)'} /></g>;
        })}
      </svg>
      <div className="grid text-center text-xs text-gray-600" style={columns}>{trend.map(point => <p key={point.month}>{reportShortMonth(point.month)}</p>)}</div>
      </div></div>
      {trend.some(point => point.netReceiptsSatang.coverage === 'complete' && negativeMoneyNote(point.netReceiptsSatang.value)) && <p className="text-xs text-red-700">{W.negative}</p>}
      <p className="text-xs text-gray-600">{W.moneyDefinition}</p>
    </Card>}
    </div>}
  </>;
}
function SpendContent({ data, nav }: { data: ExecutiveSpendConcentration; nav: Navigation }) {
  const blocked = data.topCount === null;
  const cohorts = (['TOP20', 'REST', 'TO80'] as const).map(key => {
    const [count, companies, weight] = key === 'TOP20' ? [data.topCount, data.topCompanyShare, data.topShare] : key === 'REST' ? [data.restCount, data.restCompanyShare, data.restShare] : [data.prefix80Count, data.prefix80CompanyShare, data.prefix80Share];
    return { key, href: data.drilldownFilters[key] ? drilldownHref(nav.params, nav.from, data.drilldownFilters[key]!) : undefined, cells: [LABELS.spendCohort[key], count ?? '–', ratioText(companies), <Share key={key} count={null} share={weight} />] };
  });
  return <Card title={P.spendTitle(periodText({ from: nav.params.get('from') ?? undefined, to: nav.params.get('to') ?? undefined, month: nav.params.get('month') ?? undefined }))}>
    <p className="text-xs text-gray-600">{W.base(data.population)} · {W.weight}: {W.weightDefinition}</p>
    {blocked && data.reasonCodes.filter(code => code === 'TOO_FEW_COMPANIES' || code === 'NO_POSITIVE_NET').map(code => <p key={code} role="status" className="text-xs text-gray-600">{reasonText(code)}</p>)}
    {data.reasonCodes.includes('BILLING_SCAN_NOT_COMPLETE') && <p className="text-xs">{W.partialRanking}</p>}
    {blocked ? data.reasonCodes.includes('TOO_FEW_COMPANIES') && <Button variant="secondary" onClick={() => openReport(nav, menuHref('companies', nav.params, { sortBy: 'netReceipts', sortDir: 'desc' }))}>{W.allRanks}</Button> : <>
      <ReportTable title={W.top} remember={nav.remember} columns={[{ label: W.group, width: 360 }, { label: W.unitCompany, width: 100 }, { label: W.unitInHeader(W.unitCompany, '%'), width: 120 }, { label: W.unitInHeader(W.weight, '%'), width: 160 }]} rows={cohorts} />
      {(['TOP20', 'TO80'] as const).map(key => spendTieText(key === 'TOP20' ? data.boundaryTie : data.prefix80BoundaryTie) && <DrillLink key={key} nav={nav} filters={data.drilldownFilters[key === 'TOP20' ? 'BOUNDARY_TIE' : 'TO80_BOUNDARY_TIE']!} className="flex min-h-11 items-center rounded border border-gray-200 px-3 text-xs text-gray-600">{spendTieText(key === 'TOP20' ? data.boundaryTie : data.prefix80BoundaryTie)}</DrillLink>)}
      <p className="text-xs">{W.positive} {data.positiveCompanyCount?.toLocaleString('th-TH') ?? '–'} {W.unitCompany}{data.nonPositiveCount !== null && data.nonPositiveCount > 0 && ` · ${W.nonPositive(data.nonPositiveCount)}`}</p>
      {data.positiveCompanyCount !== null && data.positiveCompanyCount < data.topTargetCount && <p className="text-xs">{W.fewPositive}</p>}{data.roundingNote && <p className="text-xs">{W.rounding}</p>}
    </>}
    <ReportTable title={W.figure} columns={[{ label: W.item, width: 360 }, { label: W.unitInHeader(W.shortNet, W.unitBaht), width: 200 }]} rows={([[W.positiveNet, data.positiveNetTotalSatang], [W.net, data.signedNetTotalSatang], [W.negativeTotal, data.negativeNetSatang]] as Array<[string, number | null]>).map(([label, value]) => ({ key: String(label), cells: [label, <Figure key={String(label)} value={sourceMoney(value, data)} moneyValue netValue />] }))} />
    {data.receiptsWithoutPositiveNet !== null && data.receiptsWithoutPositiveNet > 0 && <p className="text-xs">{W.refundedDifference(data.receiptsWithoutPositiveNet)}</p>}
  </Card>;
}
function Share({ count, share }: { count: number | null; share: Parameters<typeof ratioText>[0] }) {
  return <div className={`ml-auto w-28 whitespace-nowrap text-right tabular-nums ${(count === null || count === 0) && share?.value === 0 ? "text-gray-600" : ""}`}>{count !== null && `${count.toLocaleString('th-TH')} · `}{ratioText(share)}<div aria-hidden="true" className="mt-1 h-1 overflow-hidden rounded bg-gray-100"><div className="h-full rounded bg-brand-700" style={{ width: `${share?.value ?? 0}%` }} /></div></div>;
}
export function AnalysisContent({ data, nav, seller, rankingControl, tabs, reading }: { data: ExecutiveAnalysis; nav: Navigation; seller: string | null; rankingControl?: ReactNode; tabs?: ReactNode; reading?: PanelRead }) {
  const section = data.revenue || data.spendConcentration ? 'revenue' : data.expenseReceiptAdoption || data.usageRanking ? 'usage' : data.groups ? 'customers' : null;
  const selected = section ? reportView(section, nav.params) : '';
  const tabBar = tabs ?? (section && <ExecutiveTabs label={W[section]} tabs={REPORT_VIEWS[section]} value={selected} onChange={view => { const next = new URLSearchParams(nav.params); next.set('view', view); nav.navigate(menuHref(section, next, { view })); }} />);
  let panel: ReactNode;
  if (data.revenue) panel = <RevenueContent data={data as ExecutiveAnalysis & { revenue: NonNullable<ExecutiveAnalysis['revenue']> }} nav={nav} tabs={tabBar} reading={reading} />;
  else if (reading) panel = <>{tabBar}<PanelLoading read={reading} /></>;
  else if (data.expenseReceiptAdoption && data.paidUsage) panel = <>{tabBar}<div id="executive-panel" role="tabpanel" aria-labelledby={`executive-tab-${selected}`} aria-label={REPORT_VIEWS.usage.find(tab => tab.value === selected)?.label}>{selected === 'paid' ? <PaidUsage data={data.paidUsage} nav={nav} /> : <ReceiptAdoption data={data.expenseReceiptAdoption} nav={nav} />}</div></>;
  else if (data.usageRanking) {
    const rank = data.usageRanking;
    panel = <>{tabBar}<div id="executive-panel" role="tabpanel" aria-labelledby="executive-tab-ranking" aria-label={W.ranking}><Card title={W.rankTitle} actions={<div className="flex min-w-0 flex-wrap items-end gap-2">{rankingControl}<Button variant="secondary" onClick={() => openReport(nav, drilldownHref(nav.params, nav.from, rank.drilldownFilters))}>{W.allRanks}</Button></div>}>
      <ReportTable title={W.rankTitle} remember={nav.remember} columns={[{ label: W.company, width: 360 }, { label: W.rank, width: 64 }, { label: W.unitInHeader(RANK_LABELS[rank.metric].label, RANK_LABELS[rank.metric].unit), width: 160, sort: 'descending' }]} rows={rank.items.map(row => ({ key: row.id, href: companyLink(row.id, nav.params), cells: [<div key="name"><span className="block truncate">{row.displayName}</span><span className="block truncate text-xs text-gray-600">{[row.registeredName, row.provinceLabel].filter(Boolean).join(' · ')}</span></div>, row.rank, <Figure key="metric" value={sourceCount(row.value, rank)} />] }))} />
      <p className="text-xs text-gray-600">{W.receiptDefinition} · {W.rankBase(rank.total, RANK_LABELS[rank.metric].label)}</p>{rankingTieText(rank.boundaryTie, rank.metric) && <p className="text-xs text-gray-600">{rankingTieText(rank.boundaryTie, rank.metric)}</p>}
    </Card></div></>;
  } else if (data.spendConcentration) panel = <>{tabBar}<div id="executive-panel" role="tabpanel" aria-labelledby="executive-tab-top" aria-label={W.top}><SpendContent data={data.spendConcentration} nav={nav} /></div></>;
  else if (data.groups) {
    const rowsAre = data.view === 'industry' ? W.group : data.view === 'discovery' ? W.discovery : W.referring;
    panel = <>{tabBar}<div id="executive-panel" role="tabpanel" aria-labelledby={`executive-tab-${selected}`} aria-label={rowsAre}>{seller === 'credited' && data.creditedSellers ? <Card title={`${W.credited} · ${W.current}`}>
      <ReportTable title={W.credited} columns={[{ label: W.creditedSeller, width: 260 }, { label: W.companyCount, width: 120 }, { label: W.waiting, width: 90 }, { label: W.unitInHeader(W.creditAmount, W.unitBaht), width: 200, wide: true /* its name is longer than half a phone card */ }]} rows={data.creditedSellers.rows.map((row, i) => ({ key: String(i), cells: [thaiLabel(row.seller.label ?? W.unknown, row.seller.salesCode), row.companies, row.waiting, figureNumber({ value: row.creditSatang, coverage: 'complete', reasonCodes: [] }, true)] }))} /><p className="text-xs text-gray-600">{W.through(reportDateTime(data.creditedSellers.asOf))}</p>{W.creditNotes.map(note => <p key={note} className="text-xs text-gray-600">{note}</p>)}
    </Card> : <Card title={rowsAre}>
      <ReportTable title={W.customers} remember={nav.remember} columns={[{ label: rowsAre, width: 190 }, { label: W.unitCompany, width: 140, source: data.population.eligibleCount, sourceName: 'company' }, { label: W.paid, width: 100 }, { label: W.filterLabels.paidEver, width: 110, hide: 'narrow' }, { label: W.active, width: 110, hide: 'narrow' }, { label: W.unitInHeader(W.shortNet, W.unitBaht), width: 140 }]} rows={data.groups.map(row => ({ key: row.key, href: drilldownHref(nav.params, nav.from, row.drilldownFilters), cells: [<span key="label" className="block truncate" title={thaiLabel(row.label, row.key)}>{thaiLabel(row.label, row.key)}</span>, <Share key="share" count={row.companies.count} share={row.companies.share} />, <Figure key="paid" value={row.companiesWithReceipts} />, row.paidEverCompanies.toLocaleString('th-TH'), <Figure key="active" value={row.activeCompanies} />, <Figure key="money" value={row.netReceiptsSatang} moneyValue netValue />] }))} />
      <p className="text-xs text-gray-600">{data.groups.some(row => row.netReceiptsSatang.coverage === 'complete' && negativeMoneyNote(row.netReceiptsSatang.value)) && `${W.negative} · `}{W.baseLabel} <Figure value={data.population.eligibleCount} unit={W.unitCompany} /> · {periodText(data.period)}</p>{data.industryCoverage && <p className="text-xs text-gray-600">{W.industryCoverage(data.industryCoverage.numerator, data.industryCoverage.denominator)}</p>}{data.roundingNote && <p className="text-xs text-gray-600">{W.rounding}</p>}
    </Card>}</div></>;
  } else panel = <EmptyState title={W.noRows} description="" />;
  return <ReportNotes data={data} sources={section === 'revenue' ? ['money'] : ['money', 'usage']}>{panel}</ReportNotes>;
}

export function CompanyContent({ data, tab, history, admin, nav, contactReadAt, tabs, onNote, reading }: { data: ExecutiveCompanyDetail; tab: string; history: ExecutiveCompanyHistory | null; admin: boolean; nav: Navigation; contactReadAt: string; tabs?: ReactNode; onNote?: NoteChange; reading?: PanelRead }) {
  const company = data.company;
  const month = data.periodSummary !== undefined ? data.periodSummary : data.month && { ...data.month, coverage: data.coverage, paidInPeriod: data.month.paidInMonth || (data.coverage.money.coverage === 'complete' ? false : null), positiveNetInPeriod: data.month.positiveNetInMonth || (data.coverage.money.coverage === 'complete' ? false : null) };
  const usageCoverage = month?.coverage.usage ?? data.coverage.usage;
  const tabBar = tabs ?? <ExecutiveTabs label={W.detail} tabs={DETAIL_TABS} value={tab} onChange={value => { const next = new URLSearchParams(nav.params); next.delete('tab'); next.set('view', value); nav.navigate(executiveHref(`/system/executive/companies/${encodeURIComponent(company.id)}`, next)); }} />;
  const figures: Array<[string, ExecutiveCount, boolean, string, string]> = month ? [[W.shortNet, month.money.netReceiptsSatang, true, 'money', W.unitBaht], [W.receiptCount, sourceCount(month.usage.expenseReceiptCountInPeriod, usageCoverage), false, 'receipt', W.unitReceipt], [W.days, sourceCount(month.usage.activeDays, usageCoverage), false, 'calendar', W.unitDay], [W.ai, sourceCount(month.usage.aiRequests, usageCoverage), false, 'chat', W.unitRequest]] : [];
  return <ReportNotes data={data} sources={tab === 'usage' ? ['money', 'usage', 'aiCost'] : ['money', 'usage']}>
    {month && <ExecutiveKpiStrip columns={2}>{figures.map(([label, figure, moneyValue, icon, unit]) => <ExecutiveKpi key={label} iconName={icon} label={label} figure={figure} moneyValue={moneyValue} netValue={moneyValue} unit={unit} comparison={figure.comparison ?? data.periodComparisons?.[moneyValue ? "netReceiptsSatang" : icon === "receipt" ? "expenseReceiptCount" : icon === "calendar" ? "activeDays" : "aiRequests"]} />)}</ExecutiveKpiStrip>}
    <p className="text-xs text-gray-600">{W.receiptDefinition}</p>
    {tabBar}{reading ? <PanelLoading read={reading} /> : <div id="executive-panel" role="tabpanel" aria-labelledby={`executive-tab-${tab}`} aria-label={DETAIL_TABS.find(item => item.value === tab)?.label}>
    {tab === 'history' ? history && <Card title={W.history}>{history.items.length === 0 ? <EmptyState title={W.noHistory} description="" /> : <ReportTable title={W.history} columns={[{ label: W.item, width: 340 }, { label: W.historyAt, width: 160, align: 'left' }, { label: W.shortPlan, width: 160, align: 'left' }]} rows={history.items.map((event, index) => ({ key: String(index), cells: [EXECUTIVE_HISTORY_EVENT_LABELS[event.kind], reportDateTime(event.at), event.planLabel || '–'] }))} />}</Card> : tab === 'usage' ? month && <div className="grid min-w-0 gap-3 xl:grid-cols-2">
      <Card title={W.usageTab}>{rowStatus(month)}<p className="text-xs text-gray-600">{W.documentDefinition} · {W.usersDefinition} · {W.aiDefinition}</p>
        <DetailValues rows={[
          [W.filterLabels.receiptAdoption, LABELS.receiptAdoption[company.receiptAdoption] ?? W.unknown], [S.lifetime, <Figure key="lifetime" value={company.sheet.receiptsLifetime} />] /* one receipt total, the list's own: what is in the system on the data date */,
          ...([[W.receiptCount, 'expenseReceiptCountInPeriod'], [W.days, 'activeDays'], [W.users, 'activeUsers'], [W.documents, 'documents'], [W.ai, 'aiRequests']] as const).map(([label, key]): [string, ReactNode] => [label, <Figure key={key} value={sourceCount(month.usage[key], key === 'activeUsers' && 'activeUsersCoverage' in month.usage ? month.usage.activeUsersCoverage : usageCoverage)} />]),
          [W.firstActivity, reportDateTime(company.firstActivityAt)], [W.lastActivity, reportDateTime(company.lastActivityAt)], [W.lastWeb, reportDateTime(company.lastWebEntryAt)], [W.lastLine, reportDateTime(company.lastLineActivityAt)],
        ]} />
        <ReportTable title={W.usage} columns={[{ label: W.discovery, width: 100 }, { label: W.days, width: 80 }, { label: W.users, width: 95 }, { label: W.receiptCount, width: 105 }]} rows={(['Line', 'Web'] as const).map(channel => ({ key: channel, cells: [channel === 'Line' ? W.line : W.web, <Figure key="days" value={sourceCount(month.usage[`activeDays${channel}`], usageCoverage)} />, <Figure key="users" value={sourceCount(month.usage[`activeUsers${channel}`], 'activeUsersCoverage' in month.usage ? month.usage.activeUsersCoverage : usageCoverage)} />, <Figure key="receipts" value={sourceCount(month.usage[`expenseReceipts${channel}`], usageCoverage)} />] }))} />
      </Card>
      <Card title={W.revenue}><p className="text-xs text-gray-600">{W.moneyDefinition} · {W.vatIncluded}{month.money.netReceiptsSatang.coverage === 'complete' && negativeMoneyNote(month.money.netReceiptsSatang.value) && ` · ${W.negative}`}</p><ReportTable title={W.revenue} compactMobile columns={[{ label: W.item, width: 300 }, { label: W.unitInHeader(W.quantity, W.unitBaht), width: 130 }]} rows={([[W.shortReceipts, month.money.receiptsSatang], [W.shortRefunds, month.money.refundsSatang], [W.shortNet, month.money.netReceiptsSatang], [W.tax, month.money.taxSatang], [W.shortFees, month.money.feesSatang], [W.aiCost, month.money.aiCostSatang]] as Array<[string, ExecutiveMoney]>).map(([label, value]) => ({ key: label, cells: [<span key="label" className="block truncate" title={label}>{label}</span>, <Figure key={label} value={value} moneyValue netValue={label === W.shortNet} measured={label === W.aiCost} source={label === W.aiCost ? "aiCost" : "money"} />] }))} />
        <p className="text-sm">{W.paid}: {month.paidInPeriod === true ? W.yes : month.paidInPeriod === false ? W.noReceipts : LABELS.paidEver.UNKNOWN} · {W.positive}: {month.positiveNetInPeriod === true ? W.yes : month.positiveNetInPeriod === false ? W.noPositiveNet : LABELS.paidEver.UNKNOWN}</p>
      </Card>
    </div> : tab === 'company' && <>
      <p className="mb-2 text-xs text-gray-600">{W.current} · {W.through(reportDateTime(data.build.asOf))}</p>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-3">
      <Card title={W.companyTab}><DetailValues rows={[[W.company, company.displayName], [W.registered, company.registeredName || W.unknown], [W.group, company.industryGroup.label], [W.businessType, company.businessTypeLabel || company.businessTypeOtherText || W.unknown], [W.province, company.provinceLabel], [W.joined, reportDate(company.joinedAt)], [W.filterLabels.companyStatus, LABELS.companyStatus[company.companyStatus] ?? W.unknown], ...contactFields(company.ownerContact).map(([field, value]): [string, ReactNode] => {
        // As in the list: a contact is a link the reader presses to write or call, and goes nowhere else.
        const contact = company.ownerContact.status === 'OK' ? company.ownerContact[field] : null;
        return [W[field], contact ? <a key={field} href={field === 'email' ? `mailto:${encodeURI(contact)}` : `tel:${contact.replace(/[^\d+]/g, '')}`} className="text-brand-800 underline decoration-1 underline-offset-2 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-brand-700 max-md:inline-flex max-md:min-h-11 max-md:items-center">{contact}</a> : value];
      })]} />{company.ownerContact.status === 'NOT_PERMITTED' ? <p className="text-sm">{W.contactNotPermitted}</p> : <p className="text-sm">{W.contactAt(reportDateTime(contactReadAt))}</p>}</Card>
      <Card title={W.originTitle}><DetailValues rows={[[W.filterLabels.discovery, thaiLabel(company.discovery.label)], ...(company.discovery.key === 'OTHER' ? [[LABELS.discovery.OTHER!, company.discovery.otherText || W.unknown] as [string, ReactNode]] : []), [W.filterLabels.signupRail, thaiLabel(LABELS.signupRail[company.signupRail] ?? W.unknown)], [W.referring, referrer(company.referrer)], [W.creditedSeller, thaiLabel(company.creditedSeller.label || W.unknown, company.creditedSeller.salesCode)], [W.creditAmount, company.creditedSeller.creditSatang === undefined ? '–' : money(company.creditedSeller.creditSatang)], [W.creditAt, reportDateTime(company.creditedSeller.creditedAt)]]} />{W.creditNotes.map(note => <p key={note} className="text-sm">{note}</p>)}</Card>
      <Card title={W.service}><DetailValues rows={[[W.plan, company.planLabel], [W.filterLabels.planState, <div key="state">{LABELS.planState[company.planState] ?? W.unknown}{company.planState === 'ADMIN_HOLD' && <p>{LABELS.companyStatus[company.companyStatus] ?? W.unknown}</p>}</div>], [W.planEnds, reportDate(company.planEndsAt)], [W.members, company.currentActiveMemberCount], [W.branches, company.currentBranchCount], [W.lastActivity, reportDateTime(company.lastActivityAt)]]} /></Card>
      {/* The team's note, the same one as in the list and in the admin console. A System Admin changes it in the console. */}
      <Card title={N.title} className="col-span-full [overflow-wrap:anywhere]"><ExecutiveCompanyNote key={company.id} companyId={company.id} note={company.note} canEdit={company.canEditNote} period={data.period} onChange={onNote}
        readOnly={admin ? <Link href={`/system/partners/${encodeURIComponent(company.id)}`} onClick={nav.remember} className="inline-flex min-h-11 items-center text-brand-800 underline decoration-1 underline-offset-2 md:min-h-0">{S.noteAdminRoute}</Link> : undefined} /></Card>
      </div>
      {admin && <div className="mt-3"><ReportLink href={`/system/partners/${encodeURIComponent(company.id)}`} remember={nav.remember}>{W.management}</ReportLink></div>}
    </>}
    </div>}
  </ReportNotes>;
}
