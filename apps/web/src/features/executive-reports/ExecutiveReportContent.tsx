'use client';

import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import {
  executiveComparisonLabel, EXECUTIVE_HISTORY_EVENT_LABELS, EXECUTIVE_REPORT_LABELS as LABELS, EXECUTIVE_REFERRER_ADMIN_SUFFIX, EXECUTIVE_FLAG_LABELS,
  type ExecutiveOverview, type ExecutiveAnalysis, type ExecutiveCompanies, type ExecutiveCompanyDetail, type ExecutiveCompanyHistory,
  type ExecutiveCount, type ExecutiveMoney, type ExecutiveDrilldownFilters, type ExecutiveReceiptAdoption,
  type ExecutivePaidUsage, type ExecutiveSpendConcentration, type ExecutiveCompanyRow,
} from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeeBadge } from '@/common/components/mangmee';
import { ExecutiveSectionCard as Card, ExecutiveKpi, ExecutiveKpiStrip, ExecutiveTable as ReportTable, Figure, IncompleteDot, ReportNotes, ExecutiveTabs, type ReportColumn } from './ExecutiveReportDesign';
import { DesignIcons } from '@/features/web-core-workspace/design-icons';
import { Button } from '@/common/components/button';
import { EmptyState } from '@/common/components/state';
import { W, RANK_LABELS, REPORT_VIEWS, DETAIL_TABS, thaiLabel } from './executive-reports.words';
import { money, ratioText, reportDate, reportDateTime, reportMonth, reasonText, sourceCount, sourceMoney, contactFields, rankingTieText, spendTieText, negativeMoneyNote, drilldownHref, menuHref, executiveHref, reportShortDate, reportShortMonth, reportView, figureNumber, hoistedSource } from './executive-reports.logic';

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
  const followUps = data.paidUsage.groups.filter(group => group.key === 'NOT_STARTED' || group.key === 'INACTIVE');
  const followUpNeeded = followUps.filter(group => group.count > 0);
  const cards = [
    { label: W.companyCount, metric: data.metrics.companies, icon: 'store', sub: data.metrics.companies.unclassifiedCount > 0 ? W.unclassified(data.metrics.companies.unclassifiedCount) : undefined },
    { label: W.active, metric: data.metrics.activeCompanies, icon: 'bolt', sub: undefined },
    { label: W.paid, metric: data.metrics.companiesWithReceipts, icon: 'receipt', sub: undefined },
    { label: W.net, metric: data.metrics.netReceiptsSatang, icon: 'money', sub: undefined, money: true },
  ];
  return <ReportNotes data={data}>
    <ExecutiveKpiStrip columns={2}>{cards.map(card => <Link key={card.label} href={drilldownHref(nav.params, nav.from, card.metric.drilldownFilters)} onClick={nav.remember} className={`executive-kpi-link relative rounded-xl group ${linkFocus}`}>
      <ExecutiveKpi iconName={card.icon} label={`${card.label}${card.label === W.companyCount ? '' : ` ${reportMonth(data.period.month)}`}`} figure={card.metric} moneyValue={card.money} netValue={card.money} unit={card.money ? W.unitBaht : W.unitCompany} sub={card.sub} arrow />
    </Link>)}</ExecutiveKpiStrip>
    <p className="text-xs text-gray-600">{W.excluded} · {W.activityDefinition} · {W.paidDefinition}{data.metrics.netReceiptsSatang.coverage === 'complete' && negativeMoneyNote(data.metrics.netReceiptsSatang.value) && ` · ${W.negative}`}{data.metrics.activeCompanies.breakdown.notPaid > 0 && ` · ${W.unpaidActive(data.metrics.activeCompanies.breakdown.notPaid)}`}{data.metrics.activeCompanies.breakdown.paymentUnknown > 0 && ` · ${W.paymentUnknownActive(data.metrics.activeCompanies.breakdown.paymentUnknown)}`}</p>
    <ReceiptAdoption data={data.expenseReceiptAdoption} nav={nav} actions={<Button variant="secondary" onClick={() => openReport(nav, menuHref('usage', nav.params, { view: 'ranking' }))}>{W.seeRanking}</Button>}>
      <ReportLink href={menuHref('revenue', nav.params, { view: 'top' })} remember={nav.remember} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-gray-100 px-2 py-1"><span className="flex-1"><span className="text-sm font-semibold">{W.top}</span><span className="block text-xs text-gray-600">{W.followUpDescriptions.top}</span></span><strong className="shrink-0 text-xl tabular-nums">{ratioText(data.spendConcentration.topShare)} →</strong></ReportLink>

    </ReceiptAdoption>
    {followUpNeeded.length > 0 && <aside className="executive-follow-up-band flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-center rounded-xl bg-brand-800 p-4 text-white sm:p-3">
      <h2 className="flex items-center gap-3 font-semibold"><DesignIcons.megaphone className="size-6 shrink-0 text-gold-300" />{W.followUpBand}</h2>
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">{followUpNeeded.map(group => <DrillLink key={group.key} nav={nav} filters={group.drilldownFilters} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-white/30 px-3 py-2 text-white hover:!bg-brand-700">
        <span>{LABELS.usageGroup[group.key]}</span><strong className="shrink-0 tabular-nums">{group.count.toLocaleString('th-TH')} {W.unitCompany} <span aria-hidden="true">→</span></strong>
      </DrillLink>)}</div>
    </aside>}
  </ReportNotes>;
}

function companyLink(id: string, params: URLSearchParams): string {
  const next = new URLSearchParams(params); next.delete('tab');
  return executiveHref(`/system/executive/companies/${encodeURIComponent(id)}`, next);
}
type StatusRow = Pick<ExecutiveCompanyRow, 'paidEver' | 'usageGroup' | 'usageUnassessedReason' | 'fullyRefunded'>;
const rowStatusLabel = (row: StatusRow) => row.fullyRefunded ? refundLabel : row.usageGroup ? LABELS.usageGroup[row.usageGroup] : LABELS.paidEver[row.paidEver.value];
const rowStatus = (row: StatusRow) => <MangmeeBadge className="max-w-full" tone={row.fullyRefunded ? 'amber' : row.usageGroup === 'ACTIVE' ? 'brand' : 'slate'}><span className="min-w-0 truncate" title={rowStatusLabel(row)}>{rowStatusLabel(row)}</span>{(row.usageUnassessedReason || row.paidEver.reason) && <IncompleteDot reason={[row.usageUnassessedReason, row.paidEver.reason].filter(Boolean).map(code => reasonText(code!)).join(' · ')} />}</MangmeeBadge>;

function referrer(row: ExecutiveCompanyRow['referrer']): string {
  return `${thaiLabel(row.label, row.salesCode)}${row.source === 'ADMIN' ? ` ${EXECUTIVE_REFERRER_ADMIN_SUFFIX}` : ''}`;
}
function CompareToggle({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: () => void }) {
  const id = useId();
  return <label onClick={event => event.stopPropagation()} htmlFor={id} className="relative z-10 flex shrink-0 min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg hover:bg-gray-100 focus-within:ring-2 focus-within:ring-brand-700"><input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} className="size-4 accent-brand-800" /><span className="sr-only">{W.selectCompare}</span></label>;
}
export function CompaniesContent({ data, nav, selected, select, sortColumn }: { data: ExecutiveCompanies; nav: Navigation; selected: string[]; select: (id: string) => void; sortColumn?: (key: string) => void }) {
  const ranked = ['netReceipts', 'expenseReceiptCount', 'activeDays', 'aiRequests'].includes(data.sort.sortBy);
  const netSort = data.sort.sortBy === 'netReceipts';
  const sort = (key: string) => data.sort.sortBy === key ? data.sort.sortDir === 'asc' ? 'ascending' as const : 'descending' as const : undefined;
  const columns: ReportColumn[] = [
    ...(ranked ? [{ label: W.rank, width: 64, mobile: false, source: netSort ? data.coverage.money : data.coverage.usage, sourceName: netSort ? 'money' : 'usage' }] : []),
    { label: W.shortCompare, width: 44, control: true }, { label: W.company, width: netSort ? 200 : 220, sort: sort('companyName'), onSort: sortColumn && (() => sortColumn('companyName')) },
    { label: W.group, width: 160, hide: 'always', mobile: false, align: 'left' },
    { label: W.plan, width: 136, hide: ranked && data.sort.sortBy !== 'expenseReceiptCount' || data.sort.sortBy === 'lastActivityAt' ? 'always' : 'narrow', mobile: false, align: 'left' },
    { label: W.status, width: 140, hide: 'narrow', mobile: false, align: 'left' },
    { label: W.lifetimeReceipts, width: 116, hide: 'always', mobile: false },
    { label: W.tableReceipts, width: 120, hide: ranked && !netSort && data.sort.sortBy !== 'expenseReceiptCount' ? 'narrow' : undefined, mobile: true, sort: sort('expenseReceiptCount'), onSort: sortColumn && (() => sortColumn('expenseReceiptCount')) },
    { label: W.days, width: 104, hide: data.sort.sortBy === 'activeDays' ? undefined : 'always', mobile: true, sort: sort('activeDays'), onSort: sortColumn && (() => sortColumn('activeDays')) },
    { label: W.ai, width: 128, hide: data.sort.sortBy === 'aiRequests' ? undefined : 'always', mobile: data.sort.sortBy === 'aiRequests', sort: sort('aiRequests'), onSort: sortColumn && (() => sortColumn('aiRequests')) },
    { label: W.lastActivity, width: 120, hide: data.sort.sortBy === 'lastActivityAt' ? undefined : 'always', mobile: false, sort: sort('lastActivityAt'), onSort: sortColumn && (() => sortColumn('lastActivityAt')) },
    { label: W.shortJoined, width: 96, hide: data.sort.sortBy === 'joinedAt' ? undefined : 'always', mobile: false, sort: sort('joinedAt'), onSort: sortColumn && (() => sortColumn('joinedAt')) },
    { label: W.unitInHeader(W.tableNet, W.unitBaht), width: 132, mobile: true, sort: sort('netReceipts'), onSort: sortColumn && (() => sortColumn('netReceipts')) },
    ...(netSort ? [{ label: W.shortCumulative, width: 84, mobile: false, source: data.coverage.money, sourceName: 'money' }] : []),
  ];
  return <ReportNotes data={data}>
    <p role="status" className="text-sm tabular-nums">{W.found(data.pagination.total)} · {W.shortNet} <Figure value={data.summary.netReceiptsSatang} moneyValue netValue unit={W.unitBaht} /></p>
    {data.pagination.total === 0 ? <EmptyState title={W.empty} description="" /> : <section aria-label={W.companies} className="rounded-xl border border-gray-200 bg-white">
      <ReportTable title={W.companies} compactMobile columns={columns} nameIndex={ranked ? 2 : 1} remember={nav.remember} rows={data.items.map(row => ({
        key: row.id, href: companyLink(row.id, nav.params), className: 'executive-company-row', cells: [
          ...(ranked ? [row.rank ?? '–'] : []), <CompareToggle key="compare" checked={selected.includes(row.id)} disabled={selected.length === 2 && !selected.includes(row.id)} onChange={() => select(row.id)} />,
          <div key="name" className="min-w-0 pr-28 md:pr-0"><span className="block truncate" title={row.displayName}>{row.displayName}</span><span className="block truncate text-xs font-normal text-gray-600">{row.provinceLabel} · {W.joinedShort(reportShortDate(row.joinedAt))}</span></div>,
          <span key="group" className="block whitespace-normal" title={row.industryGroup.label}>{row.industryGroup.label}</span>,
          <span key="plan" className="flex min-w-0 flex-col items-start gap-1"><MangmeeBadge className="max-w-full"><span className="min-w-0 truncate" title={row.planLabel}>{row.planLabel}</span></MangmeeBadge>{row.planState !== 'ACTIVE' && <span className="text-xs leading-4 text-gray-600">{LABELS.planState[row.planState] ?? W.unknown}</span>}</span>, rowStatus(row),
          <Figure key="lifetime" value={sourceCount(row.metrics.expenseReceiptCountLifetime, data.coverage.usage)} />,
          <Figure key="receipts" value={sourceCount(row.metrics.expenseReceiptCountInPeriod, data.coverage.usage)} />,
          <Figure key="days" value={sourceCount(row.metrics.activeDays, data.coverage.usage)} />, <Figure key="ai" value={sourceCount(row.metrics.aiRequests, data.coverage.usage)} />, reportShortDate(row.lastActivityAt), reportShortDate(row.joinedAt),
          <Figure key="net" value={sourceMoney(row.metrics.netReceiptsSatang, data.coverage.money)} moneyValue netValue />,
          ...(netSort ? [row.cumulativeShare ? ratioText(row.cumulativeShare) : '–'] : []),
        ], details: <div className="executive-usage-summary flex flex-wrap items-center gap-x-4 gap-y-1"><span>{W.registered}: {row.registeredName || W.unknown}</span><span>{W.origin}: {[thaiLabel(row.discovery.label), row.discovery.otherText, thaiLabel(LABELS.signupRail[row.signupRail] ?? W.unknown), referrer(row.referrer)].filter(Boolean).join(' · ')}</span><span>{LABELS.receiptAdoption[row.receiptAdoption] ?? W.unknown}</span><span>{LABELS.companyStatus[row.companyStatus] ?? W.unknown}</span>{rowStatusLabel(row) !== LABELS.paidEver[row.paidEver.value] && <span>{LABELS.paidEver[row.paidEver.value]}</span>}{netSort && !row.cumulativeShare && data.coverage.money.coverage === "complete" && row.metrics.netReceiptsSatang <= 0 && <span>{W.notInShare}</span>}{[...new Set([row.paidEver.reason, row.usageUnassessedReason].filter((code): code is string => !!code && ![...data.coverage.money.reasonCodes, ...data.coverage.usage.reasonCodes].some(common => common === code)))].map(code => <span key={code}>{reasonText(code)}</span>)}{([[W.users, 'activeUsers'], [W.documents, 'documents']] as const).map(([label, key]) => <span key={key}>{label}: <Figure value={sourceCount(row.metrics[key], data.coverage.usage)} /></span>)}</div>,
      }))} />
      <p className="px-2 py-1 text-xs text-gray-600">{data.coverage.money.coverage === 'complete' && data.items.some(row => row.metrics.netReceiptsSatang < 0) && `${W.negative} · `}{W.receiptDefinition} · {W.documentDefinition} · {W.usersDefinition} · {W.aiDefinition}</p>
      {netSort && <p className="px-2 py-1 text-xs text-gray-600">{W.tieOrder}</p>}
    </section>}
  </ReportNotes>;
}

function RevenueContent({ data, nav, tabs }: { data: ExecutiveAnalysis & { revenue: NonNullable<ExecutiveAnalysis['revenue']> }; nav: Navigation; tabs: ReactNode }) {
  const revenue = data.revenue, view = reportView('revenue', nav.params), pattern = useId();
  const columns = { gridTemplateColumns: `repeat(${Math.max(1, revenue.trend.length)}, minmax(0, 1fr))` };
  const figures: Array<[string, ExecutiveMoney]> = [[W.shortNet, revenue.netReceiptsSatang], [W.shortReceipts, revenue.receiptsSatang], [W.shortRefunds, revenue.refundsSatang], [W.tax, revenue.taxSatang], [W.shortFees, revenue.feesSatang]];
  const trendSource = hoistedSource(revenue.trend.map(point => ({ coverage: point.netReceiptsSatang.coverage, source: 'money' })));
  const max = Math.max(1, ...revenue.trend.map(point => Math.abs(point.netReceiptsSatang.value ?? point.netReceiptsSatang.knownValue ?? 0)));
  const moneyColumn = (label: string) => ({ label: W.unitInHeader(label, W.unitBaht), width: 160, ...(label === W.shortRefunds ? { hide: 'narrow' as const } : {}) });
  const unmatchedRows: Array<[string, ExecutiveCount, boolean]> = [[W.unmatched, sourceCount(data.unmatchedMoney.count, data.coverage.money), false], [W.shortReceipts, sourceMoney(data.unmatchedMoney.receiptsSatang, data.coverage.money), true], [W.shortRefunds, sourceMoney(data.unmatchedMoney.refundsSatang, data.coverage.money), true], [W.excludedNet, sourceMoney(data.population.excludedTestInternalNetReceiptsSatang, data.coverage.money), true], [W.unclassifiedNet, sourceMoney(data.population.unclassifiedNetReceiptsSatang, data.coverage.money), true], [W.disputes, sourceCount(revenue.disputedInvoiceCount, data.coverage.money), false]];
  return <>
    <ExecutiveKpiStrip>{figures.map(([label, figure], i) => <ExecutiveKpi key={label} iconName="money" label={label} figure={figure} moneyValue netValue={i === 0} unit={W.unitBaht} emphasis={i === 0} />)}</ExecutiveKpiStrip>
    {tabs}<div id="executive-panel" role="tabpanel" aria-labelledby={`executive-tab-${view}`} aria-label={REPORT_VIEWS.revenue.find(tab => tab.value === view)?.label}>
    {view === 'top' && data.spendConcentration && <SpendContent data={data.spendConcentration} nav={nav} />}
    {view === 'summary' && <Card title={W.purchase}><ReportTable title={W.purchase} columns={[{ label: W.purchase, width: 240 }, moneyColumn(W.shortReceipts), moneyColumn(W.shortRefunds), moneyColumn(W.shortNet)]} rows={revenue.byPurchaseGroup.map(row => ({ key: row.key, cells: [row.label, <Figure key="receipts" value={row.receiptsSatang} moneyValue />, <Figure key="refunds" value={row.refundsSatang} moneyValue />, <Figure key="net" value={row.netReceiptsSatang} moneyValue netValue />] }))} /><p className="text-xs text-gray-600">{W.moneyDefinition} · {W.vatIncluded}{revenue.byPurchaseGroup.some(row => row.netReceiptsSatang.coverage === 'complete' && negativeMoneyNote(row.netReceiptsSatang.value)) && ` · ${W.negative}`}</p></Card>}
    {view === 'unmatched' && <Card title={W.unmatched}><ReportTable title={W.unmatched} columns={[{ label: W.item, width: 440 }, { label: W.unitInHeader(W.quantity, `${W.quantity} / ${W.unitBaht}`), width: 180 }]} rows={unmatchedRows.map(([label, value, cash]) => ({ key: label, cells: [label, <Figure key={label} value={value} moneyValue={cash} source="money" />] }))} />{data.population.unclassifiedCount > 0 && <p className="text-xs text-gray-600">{W.unclassified(data.population.unclassifiedCount)}</p>}</Card>}
    {view === 'trend' && <Card title={<span className="relative">{W.unitInHeader(W.trend, W.unitBaht)}{trendSource && <span className="absolute left-full top-1/2 -translate-y-1/2"><IncompleteDot reason={[...new Set(revenue.trend.flatMap(point => point.netReceiptsSatang.reasonCodes.map(code => reasonText(code, point.netReceiptsSatang.coverage))))].join(' · ')} /></span>}</span>}>
      <div className="executive-trend-labels grid items-end gap-2 text-center text-sm tabular-nums" style={columns}>{revenue.trend.map(point => <Figure key={point.month} value={point.netReceiptsSatang} moneyValue mark={!trendSource} />)}</div>
      <svg viewBox="0 0 360 200" height="200" preserveAspectRatio="none" role="img" aria-label={W.trend} className="block h-[200px] w-full">
        <defs><pattern id={pattern} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--color-gray-100)" /><line x1="0" x2="0" y1="0" y2="6" stroke="var(--color-gray-400)" strokeWidth="2" /></pattern></defs>
        {[25, 50, 75, 125, 150, 175].map(y => <line key={y} x1="0" x2="360" y1={y} y2={y} stroke="var(--color-gray-100)" />)}
        <line x1="0" x2="360" y1="100" y2="100" stroke="var(--color-gray-400)" />{revenue.trend.map((point, index) => {
          const value = point.netReceiptsSatang.value ?? point.netReceiptsSatang.knownValue;
          const step = 360 / Math.max(1, revenue.trend.length), x = index * step + step / 4, width = step / 2;
          if (value === undefined) return <rect key={point.month} data-unavailable="true" x={x} y="10" width={width} height="90" fill={`url(#${pattern})`} />;
          const height = Math.abs(value) / max * 90;
          return <g key={point.month}><title>{reportShortMonth(point.month)}: {figureNumber(point.netReceiptsSatang, true)}</title><rect x={x} y={value < 0 ? 100 : 100 - height} width={width} height={Math.max(1, height)} fill={value < 0 ? 'var(--color-red-600)' : 'var(--color-brand-800)'} /></g>;
        })}
      </svg>
      <div className="grid gap-2 text-center text-xs text-gray-600" style={columns}>{revenue.trend.map(point => <p key={point.month}>{reportShortMonth(point.month)}</p>)}</div>
      {revenue.trend.some(point => point.netReceiptsSatang.coverage === 'complete' && negativeMoneyNote(point.netReceiptsSatang.value)) && <p className="text-xs text-red-700">{W.negative}</p>}
      <p className="text-xs text-gray-600">{W.moneyDefinition}</p>
    </Card>}
    </div>
  </>;
}
function SpendContent({ data, nav }: { data: ExecutiveSpendConcentration; nav: Navigation }) {
  const blocked = data.topCount === null;
  const cohorts = (['TOP20', 'REST', 'TO80'] as const).map(key => {
    const [count, companies, weight] = key === 'TOP20' ? [data.topCount, data.topCompanyShare, data.topShare] : key === 'REST' ? [data.restCount, data.restCompanyShare, data.restShare] : [data.prefix80Count, data.prefix80CompanyShare, data.prefix80Share];
    return { key, href: data.drilldownFilters[key] ? drilldownHref(nav.params, nav.from, data.drilldownFilters[key]!) : undefined, cells: [LABELS.spendCohort[key], count ?? '–', ratioText(companies), <Share key={key} count={null} share={weight} />] };
  });
  return <Card title={W.spendTitle(reportMonth(nav.params.get('month')))}>
    <p className="text-xs text-gray-600">{W.base(data.population)} · {W.weight}: {W.weightDefinition}</p>
    {data.reasonCodes.includes('BILLING_SCAN_NOT_COMPLETE') && <p className="text-xs">{W.partialRanking}</p>}
    {blocked ? data.reasonCodes.includes('TOO_FEW_COMPANIES') && <Button variant="secondary" onClick={() => openReport(nav, menuHref('companies', nav.params, { sortBy: 'netReceipts', sortDir: 'desc' }))}>{W.allRanks}</Button> : <>
      <ReportTable title={W.top} remember={nav.remember} columns={[{ label: W.group, width: 360 }, { label: W.unitCompany, width: 100 }, { label: W.unitInHeader(W.unitCompany, '%'), width: 120 }, { label: W.unitInHeader(W.weight, '%'), width: 160 }]} rows={cohorts} />
      {(['TOP20', 'TO80'] as const).map(key => spendTieText(key === 'TOP20' ? data.boundaryTie : data.prefix80BoundaryTie) && <DrillLink key={key} nav={nav} filters={data.drilldownFilters[key === 'TOP20' ? 'BOUNDARY_TIE' : 'TO80_BOUNDARY_TIE']!} className="flex min-h-11 items-center rounded border border-gray-200 px-3 text-xs text-gray-600">{spendTieText(key === 'TOP20' ? data.boundaryTie : data.prefix80BoundaryTie)}</DrillLink>)}
      <p className="text-xs">{W.positive} {data.positiveCompanyCount.toLocaleString('th-TH')} {W.unitCompany}{data.nonPositiveCount > 0 && ` · ${W.nonPositive(data.nonPositiveCount)}`}</p>
      {data.positiveCompanyCount < data.topTargetCount && <p className="text-xs">{W.fewPositive}</p>}{data.roundingNote && <p className="text-xs">{W.rounding}</p>}
    </>}
    <ReportTable title={W.figure} columns={[{ label: W.item, width: 360 }, { label: W.unitInHeader(W.shortNet, W.unitBaht), width: 200 }]} rows={[[W.positiveNet, data.positiveNetTotalSatang], [W.net, data.signedNetTotalSatang], [W.negativeTotal, data.negativeNetSatang]].map(([label, value]) => ({ key: String(label), cells: [label, <Figure key={String(label)} value={sourceMoney(Number(value), data)} moneyValue netValue />] }))} />
    {data.receiptsWithoutPositiveNet > 0 && <p className="text-xs">{W.refundedDifference(data.receiptsWithoutPositiveNet)}</p>}
  </Card>;
}
function Share({ count, share }: { count: number | null; share: Parameters<typeof ratioText>[0] }) {
  return <div className={`ml-auto w-28 whitespace-nowrap text-right tabular-nums ${(count === null || count === 0) && share?.value === 0 ? "text-gray-600" : ""}`}>{count !== null && `${count.toLocaleString('th-TH')} · `}{ratioText(share)}<div aria-hidden="true" className="mt-1 h-1 overflow-hidden rounded bg-gray-100"><div className="h-full rounded bg-brand-700" style={{ width: `${share?.value ?? 0}%` }} /></div></div>;
}
export function AnalysisContent({ data, nav, seller, rankingControl, tabs }: { data: ExecutiveAnalysis; nav: Navigation; seller: string | null; rankingControl?: ReactNode; tabs?: ReactNode }) {
  const section = data.revenue || data.spendConcentration ? 'revenue' : data.expenseReceiptAdoption || data.usageRanking ? 'usage' : data.groups ? 'customers' : null;
  const selected = section ? reportView(section, nav.params) : '';
  const tabBar = tabs ?? (section && <ExecutiveTabs label={W[section]} tabs={REPORT_VIEWS[section]} value={selected} onChange={view => { const next = new URLSearchParams(nav.params); next.set('view', view); nav.navigate(menuHref(section, next, { view })); }} />);
  let panel: ReactNode;
  if (data.revenue) panel = <RevenueContent data={data as ExecutiveAnalysis & { revenue: NonNullable<ExecutiveAnalysis['revenue']> }} nav={nav} tabs={tabBar} />;
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
      <ReportTable title={W.credited} columns={[{ label: W.creditedSeller, width: 300 }, { label: W.companyCount, width: 120 }, { label: W.waiting, width: 90 }, { label: W.unitInHeader(W.creditAmount, W.unitBaht), width: 200 }]} rows={data.creditedSellers.rows.map((row, i) => ({ key: String(i), cells: [thaiLabel(row.seller.label ?? W.unknown, row.seller.salesCode), row.companies, row.waiting, figureNumber({ value: row.creditSatang, coverage: 'complete', reasonCodes: [] }, true)] }))} /><p className="text-xs text-gray-600">{W.through(reportDateTime(data.creditedSellers.asOf))}</p>{W.creditNotes.map(note => <p key={note} className="text-xs text-gray-600">{note}</p>)}
    </Card> : <Card title={rowsAre}>
      <ReportTable title={W.customers} remember={nav.remember} columns={[{ label: rowsAre, width: 190 }, { label: W.unitCompany, width: 140, source: data.population.eligibleCount, sourceName: 'company' }, { label: W.paid, width: 100 }, { label: W.filterLabels.paidEver, width: 110 }, { label: W.active, width: 110 }, { label: W.unitInHeader(W.shortNet, W.unitBaht), width: 140 }]} rows={data.groups.map(row => ({ key: row.key, href: drilldownHref(nav.params, nav.from, row.drilldownFilters), cells: [<span key="label" className="block truncate" title={thaiLabel(row.label, row.key)}>{thaiLabel(row.label, row.key)}</span>, <Share key="share" count={row.companies.count} share={row.companies.share} />, <Figure key="paid" value={row.companiesWithReceipts} />, row.paidEverCompanies.toLocaleString('th-TH'), <Figure key="active" value={row.activeCompanies} />, <Figure key="money" value={row.netReceiptsSatang} moneyValue netValue />] }))} />
      <p className="text-xs text-gray-600">{data.groups.some(row => row.netReceiptsSatang.coverage === 'complete' && negativeMoneyNote(row.netReceiptsSatang.value)) && `${W.negative} · `}{W.baseLabel} <Figure value={data.population.eligibleCount} unit={W.unitCompany} /> · {reportMonth(data.period.month)}</p>{data.industryCoverage && <p className="text-xs text-gray-600">{W.industryCoverage(data.industryCoverage.numerator, data.industryCoverage.denominator)}</p>}{data.roundingNote && <p className="text-xs text-gray-600">{W.rounding}</p>}
    </Card>}</div></>;
  } else if (data.comparison) {
    const c = data.comparison;
    const metrics = [['companies', W.companyCount, 'count'], ['netReceiptsSatang', W.shortNet, 'money'], ['netReceiptsPerCompanySatang', W.netPerCompany, 'averageMoney'], ['expenseReceiptCount', W.receiptCount, 'count'], ['expenseReceiptsPerCompany', W.receiptsPerCompany, 'average'], ['everAddedReceiptShare', W.adoptionShare, 'ratio'], ['activeCompanies', W.active, 'count']] as const;
    panel = <Card title={`${W.compare} · ${executiveComparisonLabel(c.sideA, c.dimension)} · ${executiveComparisonLabel(c.sideB, c.dimension)}`} className="executive-compare-result">
      <div className="grid grid-cols-2 gap-3">{[c.sideA, c.sideB].map((side, i) => <div key={i} className="flex min-w-0 flex-wrap items-center justify-between gap-2"><h3 className="truncate text-sm font-semibold">{i === 0 ? W.sideA : W.sideB} · {executiveComparisonLabel(side, c.dimension)}</h3><Button variant="secondary" className="text-xs" onClick={() => openReport(nav, side.drilldownFilters ? drilldownHref(nav.params, nav.from, side.drilldownFilters) : companyLink(side.key, nav.params))}>{side.drilldownFilters ? W.listGroup : W.detail}</Button></div>)}</div>
      <ReportTable title={W.compare} columns={[{ label: W.item, width: 300 }, { label: W.unitInHeader(W.sideA, `${W.quantity} / ${W.unitBaht} / %`), width: 210 }, { label: W.unitInHeader(W.sideB, `${W.quantity} / ${W.unitBaht} / %`), width: 210 }, { label: W.unitInHeader(W.shortDifference, `${W.quantity} / ${W.unitBaht} / ${W.point}`), width: 210 }]} rows={metrics.map(([key, label, kind]) => ({ key, cells: [label, ...[c.sideA, c.sideB].map(side => {
        const metric = side[key];
        if (kind === 'count' || kind === 'money') return <Figure key={side.key} value={metric as ExecutiveCount} moneyValue={kind === 'money'} netValue={kind === 'money'} />;
        const value = metric?.value;
        return value === null || value === undefined ? '–' : kind === 'averageMoney' ? figureNumber({ value, coverage: 'complete', reasonCodes: [] }, true) : ratioText(metric as Parameters<typeof ratioText>[0], '');
      }), c.difference[key] === null ? '–' : kind === 'money' || kind === 'averageMoney' ? figureNumber({ value: c.difference[key]!, coverage: 'complete', reasonCodes: [] }, true) : c.difference[key]!.toLocaleString('th-TH', kind === 'count' ? undefined : { minimumFractionDigits: 1, maximumFractionDigits: 1 })] }))} />
      <p className="text-xs text-gray-600">{W.receiptDefinition} · {W.difference} · {W.point}{[c.sideA, c.sideB].some(side => side.netReceiptsSatang.coverage === 'complete' && negativeMoneyNote(side.netReceiptsSatang.value)) && ` · ${W.negative}`}</p>
    </Card>;
  } else panel = <EmptyState title={W.noRows} description="" />;
  return <ReportNotes data={data}>{panel}</ReportNotes>;
}

export function CompanyContent({ data, tab, history, admin, nav, contactReadAt, tabs }: { data: ExecutiveCompanyDetail; tab: string; history: ExecutiveCompanyHistory | null; admin: boolean; nav: Navigation; contactReadAt: string; tabs?: ReactNode }) {
  const company = data.company, month = data.month;
  const tabBar = tabs ?? <ExecutiveTabs label={W.detail} tabs={DETAIL_TABS} value={tab} onChange={value => { const next = new URLSearchParams(nav.params); next.delete('tab'); next.set('view', value); nav.navigate(executiveHref(`/system/executive/companies/${encodeURIComponent(company.id)}`, next)); }} />;
  const figures: Array<[string, ExecutiveCount, boolean, string, string]> = month ? [[W.shortNet, month.money.netReceiptsSatang, true, 'money', W.unitBaht], [W.receiptCount, sourceCount(month.usage.expenseReceiptCountInPeriod, data.coverage.usage), false, 'receipt', W.unitReceipt], [W.days, sourceCount(month.usage.activeDays, data.coverage.usage), false, 'calendar', W.unitDay], [W.ai, sourceCount(month.usage.aiRequests, data.coverage.usage), false, 'chat', W.unitRequest]] : [];
  return <ReportNotes data={data}>
    {month && <ExecutiveKpiStrip columns={2}>{figures.map(([label, figure, moneyValue, icon, unit]) => <ExecutiveKpi key={label} iconName={icon} label={label} figure={figure} moneyValue={moneyValue} netValue={moneyValue} unit={unit} />)}</ExecutiveKpiStrip>}
    <p className="text-xs text-gray-600">{W.receiptDefinition}</p>
    {tabBar}<div id="executive-panel" role="tabpanel" aria-labelledby={`executive-tab-${tab}`} aria-label={DETAIL_TABS.find(item => item.value === tab)?.label}>
    {tab === 'history' ? history && <Card title={W.history}>{history.items.length === 0 ? <EmptyState title={W.noHistory} description="" /> : <ReportTable title={W.history} columns={[{ label: W.item, width: 340 }, { label: W.historyAt, width: 160, align: 'left' }, { label: W.shortPlan, width: 160, align: 'left' }]} rows={history.items.map((event, index) => ({ key: String(index), cells: [EXECUTIVE_HISTORY_EVENT_LABELS[event.kind], reportDateTime(event.at), event.planLabel] }))} />}</Card> : tab === 'usage' ? month && <div className="grid min-w-0 gap-3 xl:grid-cols-2">
      <Card title={W.usageTab}>{rowStatus(month)}<p>{W.documentDefinition} · {W.usersDefinition} · {W.aiDefinition}</p>
        <DetailValues rows={[
          [W.filterLabels.receiptAdoption, LABELS.receiptAdoption[company.receiptAdoption] ?? W.unknown], [W.lifetimeReceipts, <Figure key="lifetime" value={sourceCount(company.expenseReceiptCountLifetime, data.coverage.usage)} />],
          ...([[W.receiptCount, 'expenseReceiptCountInPeriod'], [W.days, 'activeDays'], [W.users, 'activeUsers'], [W.documents, 'documents'], [W.ai, 'aiRequests']] as const).map(([label, key]): [string, ReactNode] => [label, <Figure key={key} value={sourceCount(month.usage[key], data.coverage.usage)} />]),
          [W.firstActivity, reportDateTime(company.firstActivityAt)], [W.lastActivity, reportDateTime(company.lastActivityAt)], [W.lastWeb, reportDateTime(company.lastWebEntryAt)], [W.lastLine, reportDateTime(company.lastLineActivityAt)],
        ]} />
        <ReportTable title={W.usage} columns={[{ label: W.discovery, width: 100 }, { label: W.days, width: 80 }, { label: W.users, width: 95 }, { label: W.receiptCount, width: 105 }]} rows={(['Line', 'Web'] as const).map(channel => ({ key: channel, cells: [channel === 'Line' ? W.line : W.web, <Figure key="days" value={sourceCount(month.usage[`activeDays${channel}`], data.coverage.usage)} />, <Figure key="users" value={sourceCount(month.usage[`activeUsers${channel}`], data.coverage.usage)} />, <Figure key="receipts" value={sourceCount(month.usage[`expenseReceipts${channel}`], data.coverage.usage)} />] }))} />
      </Card>
      <Card title={W.revenue}><p className="text-xs text-gray-600">{W.moneyDefinition} · {W.vatIncluded}{month.money.netReceiptsSatang.coverage === 'complete' && negativeMoneyNote(month.money.netReceiptsSatang.value) && ` · ${W.negative}`}</p><ReportTable title={W.revenue} columns={[{ label: W.item }, { label: W.unitInHeader(W.quantity, W.unitBaht), width: 130 }]} rows={([[W.shortReceipts, month.money.receiptsSatang], [W.shortRefunds, month.money.refundsSatang], [W.shortNet, month.money.netReceiptsSatang], [W.tax, month.money.taxSatang], [W.shortFees, month.money.feesSatang], [W.aiCost, month.money.aiCostSatang]] as Array<[string, ExecutiveMoney]>).map(([label, value]) => ({ key: label, cells: [<span key="label" className="block truncate" title={label}>{label}</span>, <Figure key={label} value={value} moneyValue netValue={label === W.shortNet} measured={label === W.aiCost} source={label === W.aiCost ? "aiCost" : "money"} />] }))} />
        <p>{W.paid}: {month.paidInMonth ? W.yes : data.coverage.money.coverage === 'complete' ? W.noReceipts : LABELS.paidEver.UNKNOWN} · {W.positive}: {month.positiveNetInMonth ? W.yes : data.coverage.money.coverage === 'complete' ? W.noPositiveNet : LABELS.paidEver.UNKNOWN}</p>
      </Card>
    </div> : tab === 'company' && <>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-3">
      <Card title={W.companyTab}><DetailValues rows={[[W.company, company.displayName], [W.registered, company.registeredName || W.unknown], [W.group, company.industryGroup.label], [W.businessType, company.businessTypeLabel || company.businessTypeOtherText || W.unknown], [W.province, company.provinceLabel], [W.joined, reportDate(company.joinedAt)], [W.filterLabels.companyStatus, LABELS.companyStatus[company.companyStatus] ?? W.unknown], ...contactFields(company.ownerContact).map(([field, value]): [string, ReactNode] => [W[field], value])]} />{company.ownerContact.status === 'NOT_PERMITTED' ? <p className="text-sm">{W.contactNotPermitted}</p> : <p className="text-sm">{W.contactAt(reportDateTime(contactReadAt))}</p>}</Card>
      <Card title={W.originTitle}><DetailValues rows={[[W.filterLabels.discovery, thaiLabel(company.discovery.label)], ...(company.discovery.key === 'OTHER' ? [[LABELS.discovery.OTHER!, company.discovery.otherText || W.unknown] as [string, ReactNode]] : []), [W.filterLabels.signupRail, thaiLabel(LABELS.signupRail[company.signupRail] ?? W.unknown)], [W.referring, referrer(company.referrer)], [W.creditedSeller, thaiLabel(company.creditedSeller.label || W.unknown, company.creditedSeller.salesCode)], [W.creditAmount, company.creditedSeller.creditSatang === undefined ? '—' : money(company.creditedSeller.creditSatang)], [W.creditAt, reportDateTime(company.creditedSeller.creditedAt)]]} /><p className="text-sm">{W.current} · {W.through(reportDateTime(data.build.asOf))}</p>{W.creditNotes.map(note => <p key={note} className="text-sm">{note}</p>)}</Card>
      <Card title={W.service}><p>{W.current} · {W.through(reportDateTime(data.build.asOf))}</p><DetailValues rows={[[W.plan, company.planLabel], [W.filterLabels.planState, <div key="state">{LABELS.planState[company.planState] ?? W.unknown}{company.planState === 'ADMIN_HOLD' && <p>{LABELS.companyStatus[company.companyStatus] ?? W.unknown}</p>}</div>], [W.planEnds, reportDate(company.planEndsAt)], [W.members, company.currentActiveMemberCount], [W.branches, company.currentBranchCount], [W.lastActivity, reportDateTime(company.lastActivityAt)]]} /></Card>
      </div>
      {admin && <ReportLink href={`/system/partners/${encodeURIComponent(company.id)}`} remember={nav.remember}>{W.management}</ReportLink>}
    </>}
    </div>
  </ReportNotes>;
}
