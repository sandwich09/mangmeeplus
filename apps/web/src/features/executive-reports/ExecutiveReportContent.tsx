'use client';

import Link from 'next/link';
import { createContext, useContext, useId, type ReactNode } from 'react';
import {
  EXECUTIVE_HISTORY_EVENT_LABELS, EXECUTIVE_REPORT_LABELS as LABELS, EXECUTIVE_REFERRER_ADMIN_SUFFIX, EXECUTIVE_FLAG_LABELS,
  type ExecutiveOverview, type ExecutiveAnalysis, type ExecutiveCompanies, type ExecutiveCompanyDetail, type ExecutiveCompanyHistory,
  type ExecutiveCount, type ExecutiveMoney, type ExecutiveDrilldownFilters, type ExecutiveReceiptAdoption,
  type ExecutivePaidUsage, type ExecutiveSpendConcentration, type ExecutiveCompanyRow, type ExecutiveCoverage, type ExecutiveEnvelope,
} from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeeBadge } from '@/common/components/mangmee';
import { ExecutiveSectionCard as Card, ExecutiveKpi } from './ExecutiveReportDesign';
import { DesignIcons } from '@/features/web-core-workspace/design-icons';
import { Button } from '@/common/components/button';
import { EmptyState } from '@/common/components/state';
import { W, RANK_LABELS, thaiLabel } from './executive-reports.words';
import { countText, money, moneyText, ratioText, reportDate, reportDateTime, reportMonth, reasonText, sourceCount, sourceMoney, contactFields, rankingTieText, spendTieText, negativeMoneyNote, drilldownHref, menuHref, sortLabel } from './executive-reports.logic';

type Navigation = { params: URLSearchParams; from: string; remember: () => void; navigate: (href: string) => void };
const linkClass = 'flex min-h-11 min-w-11 w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 text-gray-900';
const linkFocus = 'min-w-0 break-words [overflow-wrap:anywhere] transition-colors hover:bg-brand-25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700';
export function ReportLink({ href, children, remember, className = linkClass }: { href: string; children: ReactNode; remember?: () => void; className?: string }) {
  return <Link href={href} onClick={remember} className={`${className} ${linkFocus}`}>{children}</Link>;
}
export function DrillLink({ filters, children, nav, className }: { filters: ExecutiveDrilldownFilters; children: ReactNode; nav: Navigation; className?: string }) {
  return <ReportLink href={drilldownHref(nav.params, nav.from, filters)} remember={nav.remember} className={className}>{children}</ReportLink>;
}
function openReport(nav: Navigation, href: string) { nav.remember(); nav.navigate(href); }
function MoneyThrough({ data }: { data: Pick<ExecutiveEnvelope, 'dataThrough'> }) {
  return data.dataThrough?.lagging.includes('billing') && data.dataThrough.billing
    ? <MangmeeBadge tone="slate" className="mt-2 text-sm font-normal">{W.moneyThrough(reportDate(data.dataThrough.billing))}</MangmeeBadge> : null;
}
export function ReportSkeleton() {
  return <div role="status" aria-busy="true" className="space-y-4"><span className="sr-only">{W.loading}</span><div aria-hidden="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(key => <MangmeeCard key={key} className="h-32 bg-gray-50 p-4 motion-safe:animate-pulse"><span className="block h-4 w-2/3 rounded bg-gray-200" /></MangmeeCard>)}</div><MangmeeCard className="h-64 bg-gray-50 p-4 motion-safe:animate-pulse"><span aria-hidden="true" className="block h-4 w-1/3 rounded bg-gray-200" /></MangmeeCard></div>;
}
const ReasonNotes = createContext<{ id: string; notes: string[] } | null>(null);
export function Reasons({ codes, coverage }: { codes: readonly string[]; coverage?: ExecutiveCoverage }) {
  const notes = useContext(ReasonNotes);
  return <>{[...new Set(codes)].map(code => {
    const words = reasonText(code, coverage);
    const index = notes?.notes.indexOf(words) ?? -1;
    return notes && index >= 0
      ? <sup key={code} className="ml-1"><a href={`#${notes.id}-${index + 1}`} aria-label={W.reasonReference(index + 1)} className="-my-3 inline-flex min-h-11 min-w-11 items-center justify-center align-middle text-brand-800 underline">[{index + 1}]</a></sup>
      : <p key={code} className="text-sm text-gray-600">{words}</p>;
  })}</>;
}
export function Figure({ value, moneyValue = false, netValue = false, measured = false }: { value: ExecutiveCount | ExecutiveMoney; moneyValue?: boolean; netValue?: boolean; measured?: boolean }) {
  return <div className="min-w-0 break-words tabular-nums [overflow-wrap:anywhere]">
    <span>{moneyValue ? moneyText(value as ExecutiveMoney, measured) : countText(value)}</span>
    {value.coverage === 'unavailable' && <span className="ml-1 text-sm text-gray-600">{W.unavailableFigure}</span>}
    {netValue && value.coverage === 'complete' && negativeMoneyNote(value.value) && <p className="text-sm text-red-700">{W.negative}</p>}
    <Reasons codes={value.reasonCodes} coverage={value.coverage} />
  </div>;
}
function DetailValues({ rows }: { rows: Array<[string, ReactNode]> }) {
  return <dl className="grid min-w-0 gap-3 sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="min-w-0 break-words [overflow-wrap:anywhere]"><dt className="text-sm text-gray-600">{label}</dt><dd className="text-base">{value}</dd></div>)}</dl>;
}
function ReportTable({ title, columns, rows, remember }: { title: string; columns: Array<{ label: string; secondary?: boolean }>; rows: Array<{ key: string; cells: ReactNode[]; href?: string }>; remember?: () => void }) {
  if (!rows.length) return <EmptyState title={W.noRows} description="" />;
  return <div className="min-w-0">
    <div className="space-y-3 md:hidden">{rows.map(row => <MangmeeCard key={row.key} className={`relative min-w-0 space-y-2 p-4 ${row.href ? 'hover:bg-gray-50' : ''}`}>
      {row.cells.map((cell, index) => <div key={index} className="flex min-w-0 flex-wrap justify-between gap-2 break-words [overflow-wrap:anywhere]"><span className="text-sm text-gray-600">{columns[index].label}</span><div className="min-w-0 max-w-full text-right tabular-nums">{index === 0 && row.href ? <ReportLink href={row.href} remember={remember} className="flex min-h-11 items-center font-semibold after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-brand-700">{cell}</ReportLink> : cell}</div></div>)}
    </MangmeeCard>)}</div>
    <table className="hidden w-full table-fixed border-collapse md:table">
      <caption className="sr-only">{title}</caption>
      <thead><tr>{columns.map(column => <th key={column.label} scope="col" className={`sticky top-0 z-10 border-b border-brand-100 bg-brand-25 p-3 text-sm ${columns.indexOf(column) ? 'text-right' : 'text-left'} ${column.secondary ? 'hidden lg:table-cell' : ''}`}>{column.label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.key} className={`relative ${row.href ? 'hover:bg-gray-50' : ''}`}>{row.cells.map((cell, index) => <td key={index} className={`min-w-0 border-b p-3 align-top text-sm break-words tabular-nums [overflow-wrap:anywhere] ${index ? 'text-right' : ''} ${columns[index].secondary ? 'hidden lg:table-cell' : ''}`}>{index === 0 && row.href ? <ReportLink href={row.href} remember={remember} className="flex min-h-11 items-center font-semibold after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-brand-700">{cell}</ReportLink> : cell}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}
const segmentClasses = { EVER: 'bg-brand-800 border-brand-900', NEVER: 'bg-gold-300 border-gold-500', UNKNOWN: 'bg-gray-400 border-gray-800', NOT_ENTITLED: 'bg-gray-100 border-gray-800' };
function ReceiptAdoption({ data, nav, actions }: { data: ExecutiveReceiptAdoption; nav: Navigation; actions?: ReactNode }) {
  const patternId = useId();
  let offset = 0;
  return <Card title={W.adoptionTitle} actions={actions}>
    <p className="text-sm">{W.receiptDefinition} · {W.current} · {W.base(data.population)}</p>
    {data.population === 0 ? <EmptyState title={W.noRows} description="" /> : <>
      <div className="grid items-center gap-5 xl:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="relative mx-auto size-48" role="group" aria-label={W.adoptionTitle}>
          <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
            <defs><pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--color-gray-200)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-gray-600)" strokeWidth="2" /></pattern></defs>
            <circle cx="60" cy="60" r="46" fill="none" stroke="var(--color-gray-100)" strokeWidth="18" />
            {data.segments.map(segment => {
              const length = segment.count / data.population * 100;
              const start = offset; offset += length;
              const stroke = segment.key === 'EVER' ? 'var(--color-brand-700)' : segment.key === 'NEVER' ? 'var(--color-gold-500)' : segment.key === 'UNKNOWN' ? `url(#${patternId})` : 'var(--color-gray-200)';
              return length > 0 && <a key={segment.key} href={drilldownHref(nav.params, nav.from, segment.drilldownFilters)} onClick={nav.remember} tabIndex={-1} className="cursor-pointer hover:opacity-80"><circle data-segment={segment.key} cx="60" cy="60" r="46" fill="none" stroke={stroke} strokeWidth="18" pathLength="100" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} /></a>;
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><strong className="executive-donut-total text-4xl text-brand-800 tabular-nums">{data.population.toLocaleString('th-TH')}</strong><span className="text-sm text-gray-600">{W.unitCompany}</span></div>
        </div>
        <ul className="grid gap-2">{data.segments.map(segment => <li key={segment.key} className="min-w-0"><DrillLink nav={nav} filters={segment.drilldownFilters}>
          <span className={`h-4 w-4 shrink-0 rounded-sm border ${segmentClasses[segment.key]}`} style={segment.key === 'UNKNOWN' ? { backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 3px, var(--color-gray-600) 3px, var(--color-gray-600) 5px)' } : undefined} aria-hidden="true" />
          <span className="flex-1" aria-label={`${LABELS.receiptAdoption[segment.key]} · ${segment.count.toLocaleString('th-TH')} ${W.unitCompany} · ${ratioText(segment.share)}`}>{LABELS.receiptAdoption[segment.key]}<strong className="block text-xl tabular-nums">{segment.count.toLocaleString('th-TH')} {W.unitCompany}</strong><span className="text-sm text-gray-600">{ratioText(segment.share)}</span></span><span aria-hidden="true">→</span>
        </DrillLink></li>)}</ul>
      </div>
      <p className="text-sm text-gray-600">{W.chartHint}</p>
    </>}
    <Reasons codes={data.reasonCodes} coverage={data.coverage} />{data.roundingNote && <p className="text-sm">{W.rounding}</p>}
  </Card>;
}
function PaidUsage({ data, nav }: { data: ExecutivePaidUsage; nav: Navigation }) {
  const tile = (label: ReactNode, n: number, filters: ExecutiveDrilldownFilters, attention = false) => <DrillLink nav={nav} filters={filters} className={`${linkClass} h-full flex-col items-start ${attention ? '!border-gold-300 !bg-gold-100/40' : ''}`}><span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-brand-50 text-brand-700"><DesignIcons.users className="size-5" /></span><span>{label}</span><strong className="text-2xl tabular-nums">{n.toLocaleString('th-TH')} <span className="text-sm font-normal">{W.unitCompany}</span></strong><span className="text-sm font-semibold text-brand-800">{W.seeCompanies}</span></DrillLink>;
  return <Card title={W.paidUsage}>
    <p className="text-sm text-gray-600">{W.cumulative}</p>
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">{data.groups.map(group => <li key={group.key}>{tile(LABELS.usageGroup[group.key], group.count, group.drilldownFilters, group.key === 'NOT_STARTED' || group.key === 'INACTIVE')}</li>)}
      <li>{tile(LABELS.paidEver.YES, data.paidEver.count, data.paidEver.drilldownFilters)}</li>
      {data.usageUnassessed.count > 0 && <li>{tile(<>{LABELS.paidEver.UNKNOWN} · {reasonText('ACTIVITY_HISTORY_INCOMPLETE')}</>, data.usageUnassessed.count, data.usageUnassessed.drilldownFilters)}</li>}
      {data.paymentUnknown.count > 0 && <li>{tile(<>{LABELS.paidEver.UNKNOWN} · {reasonText('PAYMENT_HISTORY_INCOMPLETE')}</>, data.paymentUnknown.count, data.paymentUnknown.drilldownFilters)}
        {Object.entries(data.paymentUnknown.byReason).map(([code, n]) => <p key={code} className="text-sm">{reasonText(code)} · {n} {W.unitCompany}</p>)}</li>}
      {data.fullyRefunded.count > 0 && <li>{tile(<>{LABELS.paidEver.YES} · {refundLabel}</>, data.fullyRefunded.count, data.fullyRefunded.drilldownFilters)}</li>}
    </ul>
  </Card>;
}
// Flag copy comes from the same contract used on drilled chips.
const refundLabel = EXECUTIVE_FLAG_LABELS.fullyRefunded.true;

export function OverviewContent({ data, nav }: { data: ExecutiveOverview; nav: Navigation }) {
  const followUps = data.paidUsage.groups.filter(group => group.key === 'NOT_STARTED' || group.key === 'INACTIVE');
  const followUpNeeded = followUps.filter(group => group.count > 0);
  const cards = [
    { label: W.companyCount, metric: data.metrics.companies, icon: 'store', sub: <>{W.excluded}{data.metrics.companies.unclassifiedCount > 0 && <p>{W.unclassified(data.metrics.companies.unclassifiedCount)}</p>}</> },
    { label: W.active, metric: data.metrics.activeCompanies, icon: 'bolt', sub: <>{W.activityDefinition}<p>{[data.metrics.activeCompanies.breakdown.notPaid > 0 ? W.unpaidActive(data.metrics.activeCompanies.breakdown.notPaid) : '', data.metrics.activeCompanies.breakdown.paymentUnknown > 0 ? W.paymentUnknownActive(data.metrics.activeCompanies.breakdown.paymentUnknown) : ''].filter(Boolean).join(' · ')}</p></> },
    { label: W.paid, metric: data.metrics.companiesWithReceipts, icon: 'receipt', sub: W.paidDefinition },
    { label: W.net, metric: data.metrics.netReceiptsSatang, icon: 'money', sub: W.moneyDefinition, money: true },
  ];
  return <>
    <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4 [&_.mangmee-stat-card]:h-full">{cards.map(card => <Link key={card.label} href={drilldownHref(nav.params, nav.from, card.metric.drilldownFilters)} onClick={nav.remember} className={`executive-kpi-link relative rounded-xl hover:[&_.mangmee-stat-card]:border-brand-300 hover:[&_.mangmee-stat-card]:bg-brand-25 ${linkFocus}`}>
      <ExecutiveKpi iconName={card.icon} label={`${card.label}${card.label === W.companyCount ? '' : ` ${reportMonth(data.period.month)}`}`} value={<Figure value={card.metric} moneyValue={card.money} netValue={card.money} />} sub={<>{card.sub}{card.money && <MoneyThrough data={data} />}</>} />
      <span aria-hidden="true" className="absolute right-4 top-4 text-brand-700">→</span>
    </Link>)}</div>
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
    <ReceiptAdoption data={data.expenseReceiptAdoption} nav={nav} actions={<Button variant="secondary" onClick={() => openReport(nav, `${menuHref('usage', nav.params)}&view=ranking`)}>{W.seeRanking}</Button>} />
    <Card title={W.followUp}>
      {followUps.map(group => <DrillLink key={group.key} nav={nav} filters={group.drilldownFilters}><span className="flex-1"><span className="font-semibold">{LABELS.usageGroup[group.key]}</span><span className="mt-1 block text-sm text-gray-600">{W.followUpDescriptions[group.key as 'NOT_STARTED' | 'INACTIVE']}</span></span><span className="shrink-0 text-right"><strong className="block text-2xl tabular-nums">{group.count == null ? '—' : group.count.toLocaleString('th-TH')}</strong><span className="text-sm text-brand-800">{W.unitCompany} →</span></span></DrillLink>)}
      <ReportLink href={`${menuHref('revenue', nav.params)}&view=top`} remember={nav.remember}><span className="flex-1"><span className="font-semibold">{W.top}</span><span className="mt-1 block text-sm text-gray-600">{W.followUpDescriptions.top}</span></span><strong className="shrink-0 text-xl tabular-nums">{ratioText(data.spendConcentration.topShare)} →</strong></ReportLink>
      <Reasons codes={data.spendConcentration.reasonCodes} coverage={data.spendConcentration.coverage} />
    </Card>
    </div>
    {followUpNeeded.length > 0 && <aside className="executive-follow-up-band flex min-w-0 flex-wrap items-center gap-4 rounded-xl bg-brand-800 p-4 text-white sm:p-5">
      <h2 className="flex items-center gap-3 font-semibold"><DesignIcons.megaphone className="size-6 shrink-0 text-gold-300" />{W.followUpBand}</h2>
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">{followUpNeeded.map(group => <DrillLink key={group.key} nav={nav} filters={group.drilldownFilters} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-white/30 px-3 py-2 text-white hover:!bg-brand-700">
        <span>{LABELS.usageGroup[group.key]}</span><strong className="shrink-0 tabular-nums">{group.count.toLocaleString('th-TH')} {W.unitCompany} <span aria-hidden="true">→</span></strong>
      </DrillLink>)}</div>
    </aside>}
  </>;
}

function companyLink(id: string, params: URLSearchParams): string {
  const next = new URLSearchParams(params); next.delete('tab');
  return `/system/executive/companies/${encodeURIComponent(id)}?${next}`;
}
const rowStatus = (row: Pick<ExecutiveCompanyRow, 'paidEver' | 'usageGroup' | 'usageUnassessedReason' | 'fullyRefunded'>) => <>
  <MangmeeBadge tone="slate">{LABELS.paidEver[row.paidEver.value]}</MangmeeBadge>
  {row.paidEver.reason && <Reasons codes={[row.paidEver.reason]} />}
  <MangmeeBadge tone={row.usageGroup === 'ACTIVE' ? 'brand' : 'slate'}>{row.usageGroup ? LABELS.usageGroup[row.usageGroup] : LABELS.paidEver.UNKNOWN}</MangmeeBadge>
  {row.usageUnassessedReason && <Reasons codes={[row.usageUnassessedReason]} />}
  {row.fullyRefunded && <MangmeeBadge tone="amber">{refundLabel}</MangmeeBadge>}
</>;
function referrer(row: ExecutiveCompanyRow['referrer']): string {
  return `${thaiLabel(row.label, row.salesCode)}${row.source === 'ADMIN' ? ` ${EXECUTIVE_REFERRER_ADMIN_SUFFIX}` : ''}`;
}
function CompareToggle({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: () => void }) {
  const id = useId();
  return <label htmlFor={id} className="relative z-20 flex shrink-0 min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg hover:bg-gray-100 focus-within:ring-2 focus-within:ring-brand-700"><input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} className="size-4 accent-brand-800" /><span className="sr-only">{W.selectCompare}</span></label>;
}
export function CompaniesContent({ data, nav, selected, select }: { data: ExecutiveCompanies; nav: Navigation; selected: string[]; select: (id: string) => void }) {
  const columns = [W.company, W.group, W.lifetimeReceipts, W.receiptCount, W.days, W.lastActivity, W.plan, W.net];
  return <>
    <p className="text-sm text-gray-600">{W.receiptDefinition}</p>
    <p role="status" className="tabular-nums">{W.found(data.pagination.total)} · {W.net} <span>{moneyText(data.summary.netReceiptsSatang)}</span> · {W.sort} {sortLabel(data.sort.sortBy, data.sort.sortDir)}</p>
    <Reasons codes={data.summary.netReceiptsSatang.reasonCodes} coverage={data.summary.netReceiptsSatang.coverage} />
    {data.pagination.total === 0 ? <EmptyState title={W.empty} description="" /> : <Card title={W.companies}>
      <table className="block w-full table-fixed border-collapse md:table">
        <caption className="sr-only">{W.companies}</caption>
        <thead className="hidden md:table-header-group"><tr>{columns.map((label, i) => <th key={label} scope="col" className={`sticky top-0 z-30 border-b border-brand-100 bg-brand-25 p-2 text-sm ${i === 0 ? 'w-[24%] text-left' : i === 1 || i === 6 ? 'text-left' : 'text-right'}`}>{label}</th>)}</tr></thead>
        <tbody className="block space-y-3 md:table-row-group md:space-y-0">{data.items.map(row => {
          const values = [
            row.industryGroup.label,
            <Figure key="lifetime" value={sourceCount(row.metrics.expenseReceiptCountLifetime, data.coverage.usage)} />,
            <div key="receipts"><Figure value={sourceCount(row.metrics.expenseReceiptCountInPeriod, data.coverage.usage)} /><p className="mt-2 text-sm text-gray-600">{LABELS.receiptAdoption[row.receiptAdoption] ?? W.unknown}</p></div>,
            <div key="days" className="executive-usage-summary space-y-2"><Figure value={sourceCount(row.metrics.activeDays, data.coverage.usage)} />{([[W.users, 'activeUsers'], [W.documents, 'documents'], [W.ai, 'aiRequests']] as const).map(([label, key]) => <div key={key} className="flex flex-wrap items-baseline justify-end gap-x-1 text-sm"><span className="text-gray-600">{label}</span><Figure value={sourceCount(row.metrics[key], data.coverage.usage)} /></div>)}</div>,
            reportDateTime(row.lastActivityAt),
            <div key="plan" className="flex flex-wrap gap-2"><MangmeeBadge>{row.planLabel}</MangmeeBadge><MangmeeBadge tone="slate">{LABELS.planState[row.planState] ?? W.unknown}</MangmeeBadge>{rowStatus(row)}</div>,
            <div key="net"><Figure value={sourceMoney(row.metrics.netReceiptsSatang, data.coverage.money)} moneyValue netValue />{row.rank !== undefined && <p>{W.rank} {row.rank}</p>}{data.sort.sortBy === 'netReceipts' && <p>{W.cumulativeShare} {row.cumulativeShare ? ratioText(row.cumulativeShare) : W.notInShare}</p>}</div>,
          ];
          return <tr key={row.id} className="executive-company-row relative grid min-w-0 grid-cols-2 gap-3 rounded-xl border border-gray-200 p-3 hover:bg-brand-25 md:table-row md:border-0 md:p-0">
            <td className="col-span-2 block min-w-0 align-top md:table-cell md:border-b md:border-gray-100 md:p-3">
              <div className="flex items-start gap-2"><CompareToggle checked={selected.includes(row.id)} disabled={selected.length === 2 && !selected.includes(row.id)} onChange={() => select(row.id)} />
                <ReportLink href={companyLink(row.id, nav.params)} remember={nav.remember} className="flex min-h-11 items-center font-semibold text-brand-800 after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-brand-700">{row.displayName}</ReportLink>
              </div>
              <p className="text-sm text-gray-600">{[row.registeredName, row.provinceLabel].filter(Boolean).join(' · ')}</p>
              <p className="text-sm text-gray-600">{W.joined} {reportDate(row.joinedAt)} · <MangmeeBadge tone="slate">{LABELS.companyStatus[row.companyStatus] ?? W.unknown}</MangmeeBadge></p>
              <p className="mt-2 text-sm text-gray-600">{W.origin} · {[thaiLabel(row.discovery.label), row.discovery.otherText, thaiLabel(LABELS.signupRail[row.signupRail] ?? W.unknown), referrer(row.referrer)].filter(Boolean).join(' · ')}</p>
            </td>
            {values.map((value, i) => <td key={columns[i + 1]} className={`block min-w-0 break-words align-top text-sm tabular-nums md:table-cell md:border-b md:border-gray-100 md:p-2 ${i === 0 || i === 5 ? 'text-left' : 'text-right'}`}>
              <span className="mb-1 block text-left text-sm text-gray-600 md:hidden">{columns[i + 1]}</span>{value}
            </td>)}
          </tr>;
        })}</tbody>
      </table>
      <p className="text-sm text-gray-600">{W.documentDefinition} · {W.usersDefinition} · {W.aiDefinition}</p>
      {data.sort.sortBy === 'netReceipts' && <p className="text-sm text-gray-600">{W.tieOrder}</p>}
    </Card>}
  </>;
}

function RevenueContent({ data }: { data: ExecutiveAnalysis & { revenue: NonNullable<ExecutiveAnalysis['revenue']> } }) {
  const revenue = data.revenue;
  const id = useId();
  const notes = [...new Set(revenue.trend.flatMap(point => point.netReceiptsSatang.reasonCodes.map(code => reasonText(code, point.netReceiptsSatang.coverage))))];
  const columns = { gridTemplateColumns: `repeat(${Math.max(1, revenue.trend.length)}, minmax(0, 1fr))` };
  const figures: Array<[string, ExecutiveMoney]> = [[W.receipts, revenue.receiptsSatang], [W.refunds, revenue.refundsSatang], [W.net, revenue.netReceiptsSatang], [W.tax, revenue.taxSatang], [W.fees, revenue.feesSatang]];
  const max = Math.max(1, ...revenue.trend.map(point => Math.abs(point.netReceiptsSatang.value ?? point.netReceiptsSatang.knownValue ?? 0)));
  return <>
    <p>{W.moneyDefinition} · {W.vatIncluded}</p>
    <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3 [&_.mangmee-stat-card]:h-full">{figures.map(([label, value]) => <ExecutiveKpi key={label} iconName="money" label={`${label} ${reportMonth(data.period.month)}`} value={<Figure value={value} moneyValue netValue={label === W.net} />} sub={label === W.net ? <MoneyThrough data={data} /> : undefined} />)}</div>
    <Card title={W.purchase}><ReportTable title={W.purchase} columns={[{ label: W.purchase }, { label: W.receipts }, { label: W.refunds }, { label: W.net }]} rows={revenue.byPurchaseGroup.map(row => ({ key: row.key, cells: [row.label, <Figure key="receipts" value={row.receiptsSatang} moneyValue />, <Figure key="refunds" value={row.refundsSatang} moneyValue />, <Figure key="net" value={row.netReceiptsSatang} moneyValue netValue />] }))} /></Card>
    <Card title={W.unmatched}><DetailValues rows={[[W.unmatched, <Figure key="unmatched" value={sourceCount(data.unmatchedMoney.count, data.coverage.money)} />], [W.receipts, <Figure key="receipts" value={sourceMoney(data.unmatchedMoney.receiptsSatang, data.coverage.money)} moneyValue />], [W.refunds, <Figure key="refunds" value={sourceMoney(data.unmatchedMoney.refundsSatang, data.coverage.money)} moneyValue />], [W.excludedNet, <Figure key="excluded" value={sourceMoney(data.population.excludedTestInternalNetReceiptsSatang, data.coverage.money)} moneyValue netValue />], [W.unclassifiedNet, <Figure key="unclassified" value={sourceMoney(data.population.unclassifiedNetReceiptsSatang, data.coverage.money)} moneyValue netValue />], [W.disputes, <Figure key="disputes" value={sourceCount(revenue.disputedInvoiceCount, data.coverage.money)} />]]} />{data.unmatchedMoney.count > 0 && <Reasons codes={['UNMATCHED_MONEY']} />}{data.population.unclassifiedCount > 0 && <p>{W.unclassified(data.population.unclassifiedCount)}</p>}</Card>
    <Card title={W.trend}>
      <ReasonNotes.Provider value={{ id, notes }}>
        <div className="executive-trend-labels grid items-end gap-2 text-center text-sm tabular-nums" style={columns}>{revenue.trend.map(point => <Figure key={point.month} value={point.netReceiptsSatang} moneyValue />)}</div>
        <svg viewBox="0 0 360 200" height="200" preserveAspectRatio="none" role="img" aria-label={W.trend} className="block h-[200px] w-full">
          {[25, 50, 75, 125, 150, 175].map(y => <line key={y} x1="0" x2="360" y1={y} y2={y} stroke="var(--color-gray-100)" />)}
          <line x1="0" x2="360" y1="100" y2="100" stroke="var(--color-gray-400)" />{revenue.trend.map((point, index) => {
            const value = point.netReceiptsSatang.value ?? point.netReceiptsSatang.knownValue;
            if (value === undefined) return null;
            const height = Math.abs(value) / max * 90;
            const step = 360 / Math.max(1, revenue.trend.length), x = index * step + step / 4, width = step / 2;
            return <g key={point.month}><title>{reportMonth(point.month)}: {moneyText(point.netReceiptsSatang)}{point.isPartialMonth ? ` · ${W.partialMonth}` : ''}</title><rect x={x} y={value < 0 ? 100 : 100 - height} width={width} height={Math.max(1, height)} fill={value < 0 ? 'var(--color-red-600)' : 'var(--color-brand-800)'} />{point.isPartialMonth && <path d={`M${x} ${value < 0 ? 100 : 100 - height} l${width} ${height}`} stroke="var(--color-gray-700)" />}</g>;
          })}
        </svg>
        <div className="grid gap-2 text-center text-sm text-gray-600" style={columns}>{revenue.trend.map(point => <p key={point.month}>{reportMonth(point.month)}{point.isPartialMonth && <span className="block">{W.partialMonth}</span>}</p>)}</div>
        {revenue.trend.some(point => point.netReceiptsSatang.coverage === 'complete' && negativeMoneyNote(point.netReceiptsSatang.value)) && <p className="text-sm text-red-700">{W.negative}</p>}
        {notes.map((note, index) => <p key={note} id={`${id}-${index + 1}`} className="text-sm text-gray-600">[{index + 1}] {note}</p>)}
      </ReasonNotes.Provider>
    </Card>
  </>;
}
// Counts and both shares of a group as the backend returned them; the page divides nothing.
function spendGroupText(data: ExecutiveSpendConcentration, key: 'TOP20' | 'REST' | 'TO80'): string {
  const [count, companies, weight] = key === 'TOP20' ? [data.topCount, data.topCompanyShare, data.topShare] : key === 'REST' ? [data.restCount, data.restCompanyShare, data.restShare] : [data.prefix80Count, data.prefix80CompanyShare, data.prefix80Share];
  return count === null ? '—' : `${W.groupCompanies(count, data.population, ratioText(companies))} · ${W.ofWeight(ratioText(weight))}`;
}
function SpendContent({ data, nav, report }: { data: ExecutiveSpendConcentration; nav: Navigation; report: ExecutiveEnvelope }) {
  const blocked = data.topCount === null;
  return <Card title={W.spendTitle(reportMonth(nav.params.get('month')))}>
    {!blocked && <div className="executive-spend-headlines grid grid-cols-2 gap-3 lg:grid-cols-3 [&_.mangmee-stat-card]:h-full">
      <ExecutiveKpi iconName="users" label={LABELS.spendCohort.TOP20} value={<span className="text-2xl tabular-nums">{data.topCount?.toLocaleString('th-TH')} {W.unitCompany}</span>} />
      <ExecutiveKpi label={W.topShareTitle} value={<span className="text-2xl tabular-nums">{ratioText(data.topShare)}</span>} />
      <ExecutiveKpi iconName="money" label={W.positiveNet} value={<Figure value={sourceMoney(data.positiveNetTotalSatang, data)} moneyValue />} sub={<MoneyThrough data={report} />} />
    </div>}
    <p>{W.base(data.population)} · {W.weight}: {W.weightDefinition}</p>
    <Reasons codes={data.reasonCodes} coverage={data.coverage} />
    {data.reasonCodes.includes('BILLING_SCAN_NOT_COMPLETE') && <p>{W.partialRanking}</p>}
    {blocked ? data.reasonCodes.includes('TOO_FEW_COMPANIES') && <Button variant="secondary" onClick={() => openReport(nav, `${menuHref('companies', nav.params)}&sortBy=netReceipts&sortDir=desc`)}>{W.allRanks}</Button> : <>
      <div className="flex h-11 overflow-hidden rounded border border-gray-700" role="group" aria-label={W.top}><Link href={drilldownHref(nav.params, nav.from, data.drilldownFilters.TOP20!)} onClick={nav.remember} tabIndex={-1} aria-label={LABELS.spendCohort.TOP20} className="bg-brand-800 hover:opacity-80" style={{ width: `${data.topShare?.value ?? 0}%` }} /><Link href={drilldownHref(nav.params, nav.from, data.drilldownFilters.REST!)} onClick={nav.remember} tabIndex={-1} aria-label={LABELS.spendCohort.REST} className="flex-1 border bg-gray-100 hover:bg-gray-200" /></div>
      {(['TOP20', 'REST', 'TO80'] as const).map(key => <div key={key}>{key === 'TO80' ? <Button variant="secondary" className="h-auto w-full justify-between whitespace-normal py-3 text-left" onClick={() => openReport(nav, drilldownHref(nav.params, nav.from, data.drilldownFilters[key]!))}>{LABELS.spendCohort[key]} · {spendGroupText(data, key)} →</Button> : <DrillLink nav={nav} filters={data.drilldownFilters[key]!}><span className="flex-1">{LABELS.spendCohort[key]} · <strong className="block text-xl tabular-nums">{spendGroupText(data, key)}</strong></span><span aria-hidden="true">→</span></DrillLink>}
        {key !== 'REST' && spendTieText(key === 'TOP20' ? data.boundaryTie : data.prefix80BoundaryTie) && <DrillLink nav={nav} filters={data.drilldownFilters[key === 'TOP20' ? 'BOUNDARY_TIE' : 'TO80_BOUNDARY_TIE']!} className="flex min-h-11 items-center rounded-lg p-2 text-sm text-gray-600">{spendTieText(key === 'TOP20' ? data.boundaryTie : data.prefix80BoundaryTie)}</DrillLink>}
      </div>)}
      <p>{W.positive} {data.positiveCompanyCount.toLocaleString('th-TH')} {W.unitCompany}{data.nonPositiveCount > 0 && ` · ${W.nonPositive(data.nonPositiveCount)}`}</p>
      {data.positiveCompanyCount < data.topTargetCount && <p>{W.fewPositive}</p>}{data.roundingNote && <p className="text-sm">{W.rounding}</p>}
    </>}
    <DetailValues rows={[[W.positiveNet, moneyText(sourceMoney(data.positiveNetTotalSatang, data))], [W.net, moneyText(sourceMoney(data.signedNetTotalSatang, data))], [W.negativeTotal, moneyText(sourceMoney(data.negativeNetSatang, data))]]} />
    {data.receiptsWithoutPositiveNet > 0 && <p>{W.refundedDifference(data.receiptsWithoutPositiveNet)}</p>}
  </Card>;
}
export function AnalysisContent({ data, nav, seller, rankingControl }: { data: ExecutiveAnalysis; nav: Navigation; seller: string | null; rankingControl?: ReactNode }) {
  if (data.expenseReceiptAdoption && data.paidUsage) return <><ReceiptAdoption data={data.expenseReceiptAdoption} nav={nav} /><PaidUsage data={data.paidUsage} nav={nav} /></>;
  if (data.usageRanking) {
    const rank = data.usageRanking;
    return <Card title={W.rankTitle} actions={<div className="flex min-w-0 flex-wrap items-end gap-2">{rankingControl}<Button variant="secondary" onClick={() => openReport(nav, drilldownHref(nav.params, nav.from, rank.drilldownFilters))}>{W.allRanks}</Button></div>}><p className="text-sm text-gray-600">{W.receiptDefinition} · {W.rankBase(rank.total, RANK_LABELS[rank.metric].label)}</p><Reasons codes={rank.reasonCodes} coverage={rank.coverage} />
      {!rank.items.length && <EmptyState title={W.noRows} description="" />}
      <ol className="space-y-2">{rank.items.map(row => <li key={row.id} className="min-w-0"><ReportLink href={companyLink(row.id, nav.params)} remember={nav.remember} className="grid min-h-11 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg p-3"><span className="text-gray-500 tabular-nums">{row.rank}</span><div className="min-w-0"><p className="font-semibold">{row.displayName}</p><p className="text-sm text-gray-600">{[row.registeredName, row.provinceLabel].filter(Boolean).join(' · ')}</p><div className="executive-rank-track mt-2 h-2 overflow-hidden rounded bg-gray-100" aria-hidden="true"><div className="h-full rounded bg-brand-800" style={{ width: `${row.value / Math.max(1, rank.items[0]?.value ?? 1) * 100}%` }} /></div></div><strong className="max-w-24 text-right tabular-nums">{countText(sourceCount(row.value, rank))} <span className="block text-sm font-normal text-gray-600">{RANK_LABELS[rank.metric].unit}</span></strong></ReportLink></li>)}</ol>
      {rankingTieText(rank.boundaryTie, rank.metric) && <p className="text-sm text-gray-600">{rankingTieText(rank.boundaryTie, rank.metric)}</p>}
    </Card>;
  }
  if (data.revenue) return <RevenueContent data={data as ExecutiveAnalysis & { revenue: NonNullable<ExecutiveAnalysis['revenue']> }} />;
  if (data.spendConcentration) return <SpendContent data={data.spendConcentration} nav={nav} report={data} />;
  if (data.groups) {
    if (seller === 'credited' && data.creditedSellers) return <Card title={`${W.credited} · ${W.current}`}><p>{W.through(reportDateTime(data.creditedSellers.asOf))}</p>{W.creditNotes.map(note => <p key={note} className="text-sm">{note}</p>)}
      <ReportTable title={W.credited} columns={[{ label: W.creditedSeller }, { label: W.companyCount }, { label: W.creditAmount }]} rows={data.creditedSellers.rows.map((row, i) => ({ key: String(i), cells: [thaiLabel(row.seller.label ?? W.unknown, row.seller.salesCode), <div key="counts">{row.companies}<p>{W.waiting} {row.waiting}</p></div>, money(row.creditSatang)] }))} />
    </Card>;
    const rowsAre = data.view === 'industry' ? W.group : data.view === 'discovery' ? W.discovery : W.referring;
    return <Card title={data.view === 'industry' ? W.group : data.view === 'discovery' ? W.filterLabels.discovery : W.referring}>
      <p>{W.base(countText(data.population.eligibleCount))} · {reportMonth(data.period.month)}</p>
      {data.industryCoverage && <p>{W.industryCoverage(data.industryCoverage.numerator, data.industryCoverage.denominator)}</p>}
      <ReportTable title={W.customers} remember={nav.remember} columns={[{ label: rowsAre }, { label: W.companyCount }, { label: W.paid }, { label: W.filterLabels.paidEver }, { label: W.active }, { label: W.net }]} rows={data.groups.map(row => ({ key: row.key, href: drilldownHref(nav.params, nav.from, row.drilldownFilters), cells: [thaiLabel(row.label, row.key), <div key="companies" className="space-y-2 text-right tabular-nums">{row.companies.count.toLocaleString('th-TH')} · {ratioText(row.companies.share)}<div aria-hidden="true" className="h-2 overflow-hidden rounded bg-gray-100"><div className="h-full rounded bg-brand-800" style={{ width: `${row.companies.share.value ?? 0}%` }} /></div></div>, <Figure key="paid" value={row.companiesWithReceipts} />, row.paidEverCompanies.toLocaleString('th-TH'), <Figure key="active" value={row.activeCompanies} />, <Figure key="money" value={row.netReceiptsSatang} moneyValue netValue />] }))} />
      {data.roundingNote && <p>{W.rounding}</p>}
    </Card>;
  }
  if (data.comparison) {
    const c = data.comparison;
    const metrics = [
      ['companies', W.companyCount, 'count'], ['netReceiptsSatang', W.net, 'money'], ['netReceiptsPerCompanySatang', W.netPerCompany, 'averageMoney'],
      ['expenseReceiptCount', W.receiptCount, 'count'], ['expenseReceiptsPerCompany', W.receiptsPerCompany, 'average'], ['everAddedReceiptShare', W.adoptionShare, 'ratio'], ['activeCompanies', W.active, 'count'],
    ] as const;
    return <Card title={W.figure} className="executive-compare-result"><p className="text-sm text-gray-600">{W.receiptDefinition}</p>
      <div className="grid grid-cols-2 gap-3">{[c.sideA, c.sideB].map((side, i) => <div key={i} className="min-w-0 space-y-2"><h2 className="font-semibold">{i === 0 ? W.sideA : W.sideB} · {thaiLabel(side.label, side.key)}</h2><p className="text-sm tabular-nums">{countText(side.companies)} {W.unitCompany}</p><Button variant="secondary" className="h-auto w-full whitespace-normal py-3" onClick={() => openReport(nav, side.drilldownFilters ? drilldownHref(nav.params, nav.from, side.drilldownFilters) : companyLink(side.key, nav.params))}>{side.drilldownFilters ? W.listGroup : W.detail}</Button></div>)}</div>
      <ReportTable title={W.compare} columns={[{ label: W.item }, { label: W.sideA }, { label: W.sideB }, { label: W.difference }]} rows={metrics.map(([key, label, kind]) => ({ key, cells: [label, ...[c.sideA, c.sideB].map(side => {
        const metric = side[key];
        if (kind === 'count' || kind === 'money') return <Figure key={side.key} value={metric as ExecutiveCount} moneyValue={kind === 'money'} netValue={kind === 'money'} />;
        const value = metric?.value;
        return value === null || value === undefined ? '—' : kind === 'averageMoney' ? money(value) : ratioText(metric as Parameters<typeof ratioText>[0], kind === 'ratio' ? '%' : '');
      }), c.difference[key] === null ? '—' : kind === 'money' || kind === 'averageMoney' ? money(c.difference[key]!) : `${c.difference[key]!.toLocaleString('th-TH', kind === 'count' ? undefined : { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${kind === 'ratio' ? ` ${W.point}` : ''}`] }))} />
    </Card>;
  }
  return <EmptyState title={W.noRows} description="" />;
}

export function CompanyContent({ data, tab, history, admin, nav, contactReadAt }: { data: ExecutiveCompanyDetail; tab: string; history: ExecutiveCompanyHistory | null; admin: boolean; nav: Navigation; contactReadAt: string }) {
  const company = data.company, month = data.month;
  const monthTitle = reportMonth(data.period.month);
  const id = useId();
  const sources = month ? [data.coverage.usage, month.money.netReceiptsSatang, ...(tab === 'usage' ? Object.values(month.money) : [])] : [];
  const notes = [...new Set([
    ...data.monthReasonCodes.map(code => reasonText(code)),
    ...sources.flatMap(source => source.reasonCodes.map(code => reasonText(code, source.coverage))),
    ...(tab === 'usage' && month ? [month.paidEver.reason, month.usageUnassessedReason].filter((code): code is NonNullable<typeof code> => !!code).map(code => reasonText(code)) : []),
  ])];
  return <ReasonNotes.Provider value={{ id, notes }}>
    <p className="text-sm">{W.receiptDefinition}</p>
    {notes.map((note, index) => <p key={note} id={`${id}-${index + 1}`} className="text-sm text-gray-600">[{index + 1}] {note}</p>)}
    {month && <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4 [&_.mangmee-stat-card]:h-full">{([[W.net, <Figure key="net" value={month.money.netReceiptsSatang} moneyValue netValue />], [W.receiptCount, <Figure key="receipts" value={sourceCount(month.usage.expenseReceiptCountInPeriod, data.coverage.usage)} />], [W.days, <Figure key="days" value={sourceCount(month.usage.activeDays, data.coverage.usage)} />], [W.ai, <Figure key="ai" value={sourceCount(month.usage.aiRequests, data.coverage.usage)} />]] as Array<[string, ReactNode]>).map(([label, value]) => <ExecutiveKpi key={label} iconName={label === W.net ? 'money' : label === W.receiptCount ? 'receipt' : label === W.days ? 'calendar' : 'chat'} label={`${label} ${monthTitle}`} value={value} sub={label === W.net ? <MoneyThrough data={data} /> : undefined} />)}</div>}
    {tab === 'history' ? history && <Card title={W.history}>{history.items.length === 0 ? <EmptyState title={W.noHistory} description="" /> : <ol className="space-y-3">{history.items.map((event, index) => <li key={index} className="border-b py-3"><p>{reportDateTime(event.at)}</p><p>{EXECUTIVE_HISTORY_EVENT_LABELS[event.kind]} {event.planLabel}</p></li>)}</ol>}</Card> : tab === 'usage' ? month && <>
      <Card title={W.usageTab}>{rowStatus(month)}<p>{W.documentDefinition} · {W.usersDefinition} · {W.aiDefinition}</p>
        <DetailValues rows={[
          [W.filterLabels.receiptAdoption, LABELS.receiptAdoption[company.receiptAdoption] ?? W.unknown], [W.lifetimeReceipts, <Figure key="lifetime" value={sourceCount(company.expenseReceiptCountLifetime, data.coverage.usage)} />],
          ...([[W.receiptCount, 'expenseReceiptCountInPeriod'], [W.days, 'activeDays'], [W.users, 'activeUsers'], [W.documents, 'documents'], [W.ai, 'aiRequests']] as const).map(([label, key]): [string, ReactNode] => [label, <Figure key={key} value={sourceCount(month.usage[key], data.coverage.usage)} />]),
          [W.firstActivity, reportDateTime(company.firstActivityAt)], [W.lastActivity, reportDateTime(company.lastActivityAt)], [W.lastWeb, reportDateTime(company.lastWebEntryAt)], [W.lastLine, reportDateTime(company.lastLineActivityAt)],
        ]} />
        <ReportTable title={W.usage} columns={[{ label: W.discovery }, { label: W.days }, { label: W.users }, { label: W.receiptCount }]} rows={(['Line', 'Web'] as const).map(channel => ({ key: channel, cells: [channel === 'Line' ? W.line : W.web, <Figure key="days" value={sourceCount(month.usage[`activeDays${channel}`], data.coverage.usage)} />, <Figure key="users" value={sourceCount(month.usage[`activeUsers${channel}`], data.coverage.usage)} />, <Figure key="receipts" value={sourceCount(month.usage[`expenseReceipts${channel}`], data.coverage.usage)} />] }))} />
      </Card>
      <Card title={W.revenue} actions={<MoneyThrough data={data} />}><p>{W.moneyDefinition} · {W.vatIncluded}</p><DetailValues rows={([[W.receipts, month.money.receiptsSatang], [W.refunds, month.money.refundsSatang], [W.net, month.money.netReceiptsSatang], [W.tax, month.money.taxSatang], [W.fees, month.money.feesSatang], [W.aiCost, month.money.aiCostSatang]] as Array<[string, ExecutiveMoney]>).map(([label, value]) => [label, <Figure key={label} value={value} moneyValue netValue={label === W.net} measured={label === W.aiCost} />])} />
        <p>{W.paid}: {month.paidInMonth ? W.yes : data.coverage.money.coverage === 'complete' ? W.noReceipts : LABELS.paidEver.UNKNOWN} · {W.positive}: {month.positiveNetInMonth ? W.yes : data.coverage.money.coverage === 'complete' ? W.noPositiveNet : LABELS.paidEver.UNKNOWN}</p>
      </Card>
    </> : tab === 'company' && <>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <Card title={W.companyTab}><DetailValues rows={[[W.company, company.displayName], [W.registered, company.registeredName || W.unknown], [W.group, company.industryGroup.label], [W.businessType, company.businessTypeLabel || company.businessTypeOtherText || W.unknown], [W.province, company.provinceLabel], [W.joined, reportDate(company.joinedAt)], [W.filterLabels.companyStatus, LABELS.companyStatus[company.companyStatus] ?? W.unknown], ...contactFields(company.ownerContact).map(([field, value]): [string, ReactNode] => [W[field], value])]} />{company.ownerContact.status === 'NOT_PERMITTED' ? <p className="text-sm">{W.contactNotPermitted}</p> : <p className="text-sm">{W.contactAt(reportDateTime(contactReadAt))}</p>}</Card>
      <Card title={W.originTitle}><DetailValues rows={[[W.filterLabels.discovery, thaiLabel(company.discovery.label)], ...(company.discovery.key === 'OTHER' ? [[LABELS.discovery.OTHER!, company.discovery.otherText || W.unknown] as [string, ReactNode]] : []), [W.filterLabels.signupRail, thaiLabel(LABELS.signupRail[company.signupRail] ?? W.unknown)], [W.referring, referrer(company.referrer)], [W.creditedSeller, thaiLabel(company.creditedSeller.label || W.unknown, company.creditedSeller.salesCode)], [W.creditAmount, company.creditedSeller.creditSatang === undefined ? '—' : money(company.creditedSeller.creditSatang)], [W.creditAt, reportDateTime(company.creditedSeller.creditedAt)]]} /><p className="text-sm">{W.current} · {W.through(reportDateTime(data.build.asOf))}</p>{W.creditNotes.map(note => <p key={note} className="text-sm">{note}</p>)}</Card>
      </div>
      <Card title={W.service}><p>{W.current} · {W.through(reportDateTime(data.build.asOf))}</p><DetailValues rows={[[W.plan, company.planLabel], [W.filterLabels.planState, <div key="state">{LABELS.planState[company.planState] ?? W.unknown}{company.planState === 'ADMIN_HOLD' && <p>{LABELS.companyStatus[company.companyStatus] ?? W.unknown}</p>}</div>], [W.planEnds, reportDate(company.planEndsAt)], [W.members, company.currentActiveMemberCount], [W.branches, company.currentBranchCount], [W.lastActivity, reportDateTime(company.lastActivityAt)]]} /></Card>
      {admin && <ReportLink href={`/system/partners/${encodeURIComponent(company.id)}`} remember={nav.remember}>{W.management}</ReportLink>}
    </>}
  </ReasonNotes.Provider>;
}
