'use client';

import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import {
  EXECUTIVE_HISTORY_EVENT_LABELS, EXECUTIVE_REPORT_LABELS as LABELS, EXECUTIVE_REFERRER_ADMIN_SUFFIX, EXECUTIVE_FLAG_LABELS,
  type ExecutiveOverview, type ExecutiveAnalysis, type ExecutiveCompanies, type ExecutiveCompanyDetail, type ExecutiveCompanyHistory,
  type ExecutiveCount, type ExecutiveMoney, type ExecutiveDrilldownFilters, type ExecutiveReceiptAdoption,
  type ExecutivePaidUsage, type ExecutiveSpendConcentration, type ExecutiveCompanyRow,
} from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeeStatCard, MangmeeBadge } from '@/common/components/mangmee';
import { SwitchField } from '@/common/components/field/Field';
import { EmptyState } from '@/common/components/state';
import { W, RANK_LABELS, thaiLabel } from './executive-reports.words';
import { countText, money, moneyText, ratioText, reportDate, reportDateTime, reportMonth, reasonText, sourceCount, sourceMoney, contactFields, rankingTieText, spendTieText, negativeMoneyNote, drilldownHref, menuHref, sortLabel } from './executive-reports.logic';

type Navigation = { params: URLSearchParams; from: string; remember: () => void };
const linkClass = 'inline-flex min-h-11 min-w-11 items-center break-words text-brand-800 underline [overflow-wrap:anywhere]';
export function ReportLink({ href, children, remember }: { href: string; children: ReactNode; remember?: () => void }) {
  return <Link href={href} onClick={remember} className={linkClass}>{children}</Link>;
}
export function DrillLink({ filters, children, nav }: { filters: ExecutiveDrilldownFilters; children: ReactNode; nav: Navigation }) {
  return <ReportLink href={drilldownHref(nav.params, nav.from, filters)} remember={nav.remember}>{children}</ReportLink>;
}
export function Reasons({ codes }: { codes: readonly string[] }) {
  return <>{[...new Set(codes)].map(code => <p key={code} className="text-sm text-gray-600">{reasonText(code)}</p>)}</>;
}
export function Figure({ value, moneyValue = false, netValue = false }: { value: ExecutiveCount | ExecutiveMoney; moneyValue?: boolean; netValue?: boolean }) {
  return <div className="min-w-0 break-words [overflow-wrap:anywhere]">
    <span>{moneyValue ? moneyText(value as ExecutiveMoney) : countText(value)}</span>
    {netValue && value.coverage === 'complete' && negativeMoneyNote(value.value) && <p className="text-sm text-gray-600">{W.negative}</p>}
    <Reasons codes={value.reasonCodes} />
  </div>;
}
function DetailValues({ rows }: { rows: Array<[string, ReactNode]> }) {
  return <dl className="grid min-w-0 gap-3 sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="min-w-0 break-words [overflow-wrap:anywhere]"><dt className="text-sm text-gray-600">{label}</dt><dd className="text-base">{value}</dd></div>)}</dl>;
}
function Card({ title, children }: { title: string; children: ReactNode }) {
  return <MangmeeCard className="min-w-0 space-y-3 p-4"><h2 className="text-lg font-semibold">{title}</h2>{children}</MangmeeCard>;
}
function ReportTable({ title, columns, rows }: { title: string; columns: Array<{ label: string; secondary?: boolean }>; rows: Array<{ key: string; cells: ReactNode[] }> }) {
  if (!rows.length) return <EmptyState title={W.noRows} description="" />;
  return <div className="min-w-0">
    <div className="space-y-3 md:hidden">{rows.map(row => <MangmeeCard key={row.key} className="min-w-0 space-y-2 p-4">
      {row.cells.map((cell, index) => <div key={index} className="flex min-w-0 flex-wrap justify-between gap-2 break-words [overflow-wrap:anywhere]"><span className="text-sm text-gray-600">{columns[index].label}</span><div className="min-w-0 max-w-full text-right">{cell}</div></div>)}
    </MangmeeCard>)}</div>
    <table className="hidden w-full table-fixed border-collapse md:table">
      <caption className="pb-3 text-left font-semibold">{title}</caption>
      <thead><tr>{columns.map(column => <th key={column.label} scope="col" className={`border-b p-2 text-left text-sm ${column.secondary ? 'hidden lg:table-cell' : ''}`}>{column.label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}>{row.cells.map((cell, index) => <td key={index} className={`min-w-0 border-b p-2 align-top text-sm break-words [overflow-wrap:anywhere] ${index ? 'text-right' : ''} ${columns[index].secondary ? 'hidden lg:table-cell' : ''}`}>{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}
const segmentClasses = { EVER: 'bg-brand-800 border-brand-900', NEVER: 'bg-warning-600 border-gray-800', UNKNOWN: 'bg-gray-400 border-gray-800', NOT_ENTITLED: 'bg-gray-100 border-gray-800' };
function ReceiptAdoption({ data, nav }: { data: ExecutiveReceiptAdoption; nav: Navigation }) {
  return <Card title={W.adoptionTitle}>
    <p className="text-sm">{W.receiptDefinition} · {W.current} · {W.base(data.population)}</p>
    {data.population === 0 ? <EmptyState title={W.noRows} description="" /> : <>
      <div className="flex h-11 w-full overflow-hidden rounded border border-gray-700" role="group" aria-label={W.adoptionTitle}>{data.segments.map(segment => segment.share.value !== null && segment.share.value > 0 && <Link key={segment.key} href={drilldownHref(nav.params, nav.from, segment.drilldownFilters)} onClick={nav.remember} aria-label={`${LABELS.receiptAdoption[segment.key]} · ${segment.count.toLocaleString('th-TH')} ${W.unitCompany} · ${ratioText(segment.share)}`} className={`border ${segmentClasses[segment.key]}`} style={{ width: `${segment.share.value}%`, ...(segment.key === 'UNKNOWN' ? { backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 4px, var(--color-gray-700) 4px, var(--color-gray-700) 6px)' } : {}) }} />)}</div>
      <ul>{data.segments.map(segment => <li key={segment.key} className="min-w-0"><DrillLink nav={nav} filters={segment.drilldownFilters}><span className={`mr-2 h-4 w-4 shrink-0 border ${segmentClasses[segment.key]}`} aria-hidden="true" />{LABELS.receiptAdoption[segment.key]} · {segment.count.toLocaleString('th-TH')} {W.unitCompany} · {ratioText(segment.share)}</DrillLink></li>)}</ul>
      <p className="text-sm text-gray-600">{W.chartHint}</p>
    </>}
    <Reasons codes={data.reasonCodes} />{data.roundingNote && <p className="text-sm">{W.rounding}</p>}
  </Card>;
}
function PaidUsage({ data, nav }: { data: ExecutivePaidUsage; nav: Navigation }) {
  return <Card title={W.paidUsage}>
    <p className="text-sm text-gray-600">{W.cumulative}</p>
    <ul>{data.groups.map(group => <li key={group.key}><DrillLink nav={nav} filters={group.drilldownFilters}>{LABELS.usageGroup[group.key]} · {group.count.toLocaleString('th-TH')} {W.unitCompany}</DrillLink></li>)}
      <li><DrillLink nav={nav} filters={data.paidEver.drilldownFilters}>{LABELS.paidEver.YES} · {data.paidEver.count.toLocaleString('th-TH')} {W.unitCompany}</DrillLink></li>
      {data.usageUnassessed.count > 0 && <li><DrillLink nav={nav} filters={data.usageUnassessed.drilldownFilters}>{LABELS.paidEver.UNKNOWN} · {reasonText('ACTIVITY_HISTORY_INCOMPLETE')} · {data.usageUnassessed.count.toLocaleString('th-TH')} {W.unitCompany}</DrillLink></li>}
      {data.paymentUnknown.count > 0 && <li><DrillLink nav={nav} filters={data.paymentUnknown.drilldownFilters}>{LABELS.paidEver.UNKNOWN} · {reasonText('PAYMENT_HISTORY_INCOMPLETE')} · {data.paymentUnknown.count.toLocaleString('th-TH')} {W.unitCompany}</DrillLink>
        {Object.entries(data.paymentUnknown.byReason).map(([code, n]) => <p key={code} className="text-sm">{reasonText(code)} · {n} {W.unitCompany}</p>)}</li>}
      {data.fullyRefunded.count > 0 && <li><DrillLink nav={nav} filters={data.fullyRefunded.drilldownFilters}>{LABELS.paidEver.YES} · {refundLabel} · {data.fullyRefunded.count.toLocaleString('th-TH')} {W.unitCompany}</DrillLink></li>}
    </ul>
  </Card>;
}
// Flag copy comes from the same contract used on drilled chips.
const refundLabel = EXECUTIVE_FLAG_LABELS.fullyRefunded.true;

export function OverviewContent({ data, nav }: { data: ExecutiveOverview; nav: Navigation }) {
  const cards = [
    { label: W.companyCount, metric: data.metrics.companies, sub: W.excluded },
    { label: W.active, metric: data.metrics.activeCompanies, sub: W.activityDefinition },
    { label: W.paid, metric: data.metrics.companiesWithReceipts, sub: W.paidDefinition },
    { label: W.net, metric: data.metrics.netReceiptsSatang, sub: W.moneyDefinition, money: true },
  ];
  return <>
    <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">{cards.map(card => <Link key={card.label} href={drilldownHref(nav.params, nav.from, card.metric.drilldownFilters)} onClick={nav.remember} className="min-w-0 rounded-xl focus-visible:outline-brand-700">
      <MangmeeStatCard label={`${card.label}${card.label === W.companyCount ? '' : ` ${reportMonth(data.period.month)}`}`} value={<Figure value={card.metric} moneyValue={card.money} netValue={card.money} />} sub={card.sub} />
    </Link>)}</div>
    {data.metrics.companies.unclassifiedCount > 0 && <p className="text-sm">{W.unclassified(data.metrics.companies.unclassifiedCount)}</p>}
    {data.metrics.activeCompanies.breakdown.notPaid > 0 && <p className="text-sm">{W.unpaidActive(data.metrics.activeCompanies.breakdown.notPaid)}</p>}
    {data.metrics.activeCompanies.breakdown.paymentUnknown > 0 && <p className="text-sm">{W.paymentUnknownActive(data.metrics.activeCompanies.breakdown.paymentUnknown)}</p>}
    <ReceiptAdoption data={data.expenseReceiptAdoption} nav={nav} />
    <ReportLink href={`${menuHref('usage', nav.params)}&view=ranking`} remember={nav.remember}>{W.ranking}</ReportLink>
    <Card title={W.followUp}>
      {data.paidUsage.groups.filter(group => group.key === 'NOT_STARTED' || group.key === 'INACTIVE').map(group => <div key={group.key}><DrillLink nav={nav} filters={group.drilldownFilters}>{LABELS.usageGroup[group.key]} · {group.count.toLocaleString('th-TH')} {W.unitCompany}</DrillLink></div>)}
      <ReportLink href={`${menuHref('revenue', nav.params)}&view=top`} remember={nav.remember}>{W.top} · {ratioText(data.spendConcentration.topShare)}</ReportLink>
      <Reasons codes={data.spendConcentration.reasonCodes} />
    </Card>
  </>;
}

function companyLink(id: string, params: URLSearchParams): string {
  const next = new URLSearchParams(params); next.delete('tab');
  return `/system/executive/companies/${encodeURIComponent(id)}?${next}`;
}
const rowStatus = (row: Pick<ExecutiveCompanyRow, 'paidEver' | 'usageGroup' | 'usageUnassessedReason' | 'fullyRefunded'>) => <>
  <MangmeeBadge>{LABELS.paidEver[row.paidEver.value]}</MangmeeBadge>
  {row.paidEver.reason && <Reasons codes={[row.paidEver.reason]} />}
  <p>{row.usageGroup ? LABELS.usageGroup[row.usageGroup] : LABELS.paidEver.UNKNOWN}</p>
  {row.usageUnassessedReason && <Reasons codes={[row.usageUnassessedReason]} />}
  {row.fullyRefunded && <MangmeeBadge tone="amber">{refundLabel}</MangmeeBadge>}
</>;
function referrer(row: ExecutiveCompanyRow['referrer']): string {
  return `${thaiLabel(row.label, row.salesCode)}${row.source === 'ADMIN' ? ` ${EXECUTIVE_REFERRER_ADMIN_SUFFIX}` : ''}`;
}
// A row renders twice (phone card and table row): each toggle needs its own id, or every label selects the first company.
function CompareToggle({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: () => void }) {
  return <SwitchField id={useId()} label={W.selectCompare} checked={checked} disabled={disabled} onChange={onChange} />;
}
export function CompaniesContent({ data, nav, selected, select }: { data: ExecutiveCompanies; nav: Navigation; selected: string[]; select: (id: string) => void }) {
  return <>
    <p className="text-sm">{W.receiptDefinition}</p>
    <p role="status">{W.found(data.pagination.total)} · {W.net} <span>{moneyText(data.summary.netReceiptsSatang)}</span> · {W.sort} {sortLabel(data.sort.sortBy, data.sort.sortDir)}</p>
    <Reasons codes={data.summary.netReceiptsSatang.reasonCodes} />
    {data.pagination.total === 0 ? <EmptyState title={W.empty} description="" /> : <ReportTable title={W.companies} columns={[{ label: W.company }, { label: W.origin, secondary: true }, { label: W.service }, { label: W.active }, { label: W.net }]} rows={data.items.map(row => ({ key: row.id, cells: [
      <div key="company" className="text-left"><CompareToggle checked={selected.includes(row.id)} disabled={selected.length === 2 && !selected.includes(row.id)} onChange={() => select(row.id)} />
        <ReportLink href={companyLink(row.id, nav.params)} remember={nav.remember}>{row.displayName}</ReportLink>
        {row.registeredName && <p>{row.registeredName}</p>}<p>{row.provinceLabel} · {row.industryGroup.label}</p><p>{W.joined} {reportDate(row.joinedAt)}</p><p>{LABELS.companyStatus[row.companyStatus] ?? W.unknown}</p>
      </div>,
      <div key="origin"><p>{thaiLabel(row.discovery.label)}</p>{row.discovery.otherText && <p>{row.discovery.otherText}</p>}<p>{thaiLabel(LABELS.signupRail[row.signupRail] ?? W.unknown)}</p><p>{referrer(row.referrer)}</p></div>,
      <div key="plan"><p>{row.planLabel}</p><MangmeeBadge>{LABELS.planState[row.planState] ?? W.unknown}</MangmeeBadge>{row.planState === 'ADMIN_HOLD' && <p>{LABELS.companyStatus[row.companyStatus] ?? W.unknown}</p>}{rowStatus(row)}</div>,
      <div key="usage"><p>{W.receiptCount}</p><Figure value={sourceCount(row.metrics.expenseReceiptCountInPeriod, data.coverage.usage)} /><p>{LABELS.receiptAdoption[row.receiptAdoption] ?? W.unknown}</p>
        <DetailValues rows={[[W.days, <Figure key="days" value={sourceCount(row.metrics.activeDays, data.coverage.usage)} />], [W.users, <Figure key="users" value={sourceCount(row.metrics.activeUsers, data.coverage.usage)} />], [W.documents, <Figure key="docs" value={sourceCount(row.metrics.documents, data.coverage.usage)} />], [W.ai, <Figure key="ai" value={sourceCount(row.metrics.aiRequests, data.coverage.usage)} />], [W.lastActivity, reportDateTime(row.lastActivityAt)]]} />
      </div>,
      <div key="money"><Figure value={sourceMoney(row.metrics.netReceiptsSatang, data.coverage.money)} moneyValue netValue />{row.rank !== undefined && <p>{W.rank} {row.rank}</p>}{data.sort.sortBy === 'netReceipts' && <p>{W.cumulativeShare} {row.cumulativeShare ? ratioText(row.cumulativeShare) : W.notInShare}</p>}</div>,
    ] }))} />}
    <p className="text-sm">{W.documentDefinition} · {W.usersDefinition} · {W.aiDefinition}</p>
    {data.sort.sortBy === 'netReceipts' && <p className="text-sm">{W.tieOrder}</p>}
  </>;
}

function RevenueContent({ data }: { data: ExecutiveAnalysis & { revenue: NonNullable<ExecutiveAnalysis['revenue']> } }) {
  const revenue = data.revenue;
  const figures: Array<[string, ExecutiveMoney]> = [[W.receipts, revenue.receiptsSatang], [W.refunds, revenue.refundsSatang], [W.net, revenue.netReceiptsSatang], [W.tax, revenue.taxSatang], [W.fees, revenue.feesSatang]];
  const max = Math.max(1, ...revenue.trend.map(point => Math.abs(point.netReceiptsSatang.value ?? point.netReceiptsSatang.knownValue ?? 0)));
  return <>
    <p>{W.moneyDefinition} · {W.vatIncluded}</p>
    <div className="grid min-w-0 gap-3 sm:grid-cols-3">{figures.map(([label, value]) => <MangmeeStatCard key={label} label={`${label} ${reportMonth(data.period.month)}`} value={<Figure value={value} moneyValue netValue={label === W.net} />} />)}</div>
    <ReportTable title={W.purchase} columns={[{ label: W.purchase }, { label: W.receipts }, { label: W.refunds }, { label: W.net }]} rows={revenue.byPurchaseGroup.map(row => ({ key: row.key, cells: [row.label, <Figure key="receipts" value={row.receiptsSatang} moneyValue />, <Figure key="refunds" value={row.refundsSatang} moneyValue />, <Figure key="net" value={row.netReceiptsSatang} moneyValue netValue />] }))} />
    <Card title={W.unmatched}><DetailValues rows={[[W.unmatched, <Figure key="unmatched" value={sourceCount(data.unmatchedMoney.count, data.coverage.money)} />], [W.receipts, <Figure key="receipts" value={sourceMoney(data.unmatchedMoney.receiptsSatang, data.coverage.money)} moneyValue />], [W.refunds, <Figure key="refunds" value={sourceMoney(data.unmatchedMoney.refundsSatang, data.coverage.money)} moneyValue />], [W.excludedNet, <Figure key="excluded" value={sourceMoney(data.population.excludedTestInternalNetReceiptsSatang, data.coverage.money)} moneyValue netValue />], [W.unclassifiedNet, <Figure key="unclassified" value={sourceMoney(data.population.unclassifiedNetReceiptsSatang, data.coverage.money)} moneyValue netValue />], [W.disputes, <Figure key="disputes" value={sourceCount(revenue.disputedInvoiceCount, data.coverage.money)} />]]} />{data.unmatchedMoney.count > 0 && <Reasons codes={['UNMATCHED_MONEY']} />}{data.population.unclassifiedCount > 0 && <p>{W.unclassified(data.population.unclassifiedCount)}</p>}</Card>
    <Card title={W.trend}>
      <svg viewBox="0 0 360 200" role="img" aria-label={W.trend} className="w-full"><line x1="0" x2="360" y1="100" y2="100" stroke="var(--color-gray-700)" />{revenue.trend.map((point, index) => {
        const value = point.netReceiptsSatang.value ?? point.netReceiptsSatang.knownValue;
        if (value === undefined) return null;
        const height = Math.abs(value) / max * 90;
        return <g key={point.month}><title>{reportMonth(point.month)}: {moneyText(point.netReceiptsSatang)}{point.isPartialMonth ? ` · ${W.partialMonth}` : ''}</title><rect x={index * 60 + 10} y={value < 0 ? 100 : 100 - height} width="40" height={Math.max(1, height)} fill={value < 0 ? 'var(--color-warning-600)' : 'var(--color-brand-800)'} stroke="var(--color-gray-700)" />{point.isPartialMonth && <path d={`M${index * 60 + 10} ${value < 0 ? 100 : 100 - height} l40 ${height}`} stroke="var(--color-gray-700)" />}</g>;
      })}</svg>
      <DetailValues rows={revenue.trend.map(point => [`${reportMonth(point.month)}${point.isPartialMonth ? ` · ${W.partialMonth}` : ''}`, <Figure key={point.month} value={point.netReceiptsSatang} moneyValue netValue />])} />
    </Card>
  </>;
}
// Counts and both shares of a group as the backend returned them; the page divides nothing.
function spendGroupText(data: ExecutiveSpendConcentration, key: 'TOP20' | 'REST' | 'TO80'): string {
  const [count, companies, weight] = key === 'TOP20' ? [data.topCount, data.topCompanyShare, data.topShare] : key === 'REST' ? [data.restCount, data.restCompanyShare, data.restShare] : [data.prefix80Count, data.prefix80CompanyShare, data.prefix80Share];
  return count === null ? '—' : `${W.groupCompanies(count, data.population, ratioText(companies))} · ${W.ofWeight(ratioText(weight))}`;
}
function SpendContent({ data, nav }: { data: ExecutiveSpendConcentration; nav: Navigation }) {
  const blocked = data.topCount === null;
  return <Card title={W.spendTitle(reportMonth(nav.params.get('month')))}>
    <p>{W.base(data.population)} · {W.weight}: {W.weightDefinition}</p>
    <Reasons codes={data.reasonCodes} />
    {data.reasonCodes.includes('BILLING_SCAN_NOT_COMPLETE') && <p>{W.partialRanking}</p>}
    {blocked ? data.reasonCodes.includes('TOO_FEW_COMPANIES') && <ReportLink href={`${menuHref('companies', nav.params)}&sortBy=netReceipts&sortDir=desc`} remember={nav.remember}>{W.allRanks}</ReportLink> : <>
      <div className="flex h-11 overflow-hidden rounded border border-gray-700" role="group" aria-label={W.top}><Link href={drilldownHref(nav.params, nav.from, data.drilldownFilters.TOP20!)} onClick={nav.remember} aria-label={LABELS.spendCohort.TOP20} className="bg-brand-800" style={{ width: `${data.topShare?.value ?? 0}%` }} /><Link href={drilldownHref(nav.params, nav.from, data.drilldownFilters.REST!)} onClick={nav.remember} aria-label={LABELS.spendCohort.REST} className="flex-1 border bg-gray-100" /></div>
      {(['TOP20', 'REST', 'TO80'] as const).map(key => <div key={key}><DrillLink nav={nav} filters={data.drilldownFilters[key]!}>{LABELS.spendCohort[key]} · {spendGroupText(data, key)}</DrillLink>
        {key !== 'REST' && spendTieText(key === 'TOP20' ? data.boundaryTie : data.prefix80BoundaryTie) && <div><DrillLink nav={nav} filters={data.drilldownFilters[key === 'TOP20' ? 'BOUNDARY_TIE' : 'TO80_BOUNDARY_TIE']!}>{spendTieText(key === 'TOP20' ? data.boundaryTie : data.prefix80BoundaryTie)}</DrillLink></div>}
      </div>)}
      <p>{W.positive} {data.positiveCompanyCount.toLocaleString('th-TH')} {W.unitCompany}{data.nonPositiveCount > 0 && ` · ${W.nonPositive(data.nonPositiveCount)}`}</p>
      {data.positiveCompanyCount < data.topTargetCount && <p>{W.fewPositive}</p>}{data.roundingNote && <p className="text-sm">{W.rounding}</p>}
    </>}
    <DetailValues rows={[[W.positiveNet, moneyText(sourceMoney(data.positiveNetTotalSatang, data))], [W.net, moneyText(sourceMoney(data.signedNetTotalSatang, data))], [W.negativeTotal, moneyText(sourceMoney(data.negativeNetSatang, data))]]} />
    {data.receiptsWithoutPositiveNet > 0 && <p>{W.refundedDifference(data.receiptsWithoutPositiveNet)}</p>}
  </Card>;
}
export function AnalysisContent({ data, nav, seller }: { data: ExecutiveAnalysis; nav: Navigation; seller: string | null }) {
  if (data.expenseReceiptAdoption && data.paidUsage) return <><ReceiptAdoption data={data.expenseReceiptAdoption} nav={nav} /><PaidUsage data={data.paidUsage} nav={nav} /></>;
  if (data.usageRanking) {
    const rank = data.usageRanking;
    return <Card title={W.rankTitle}><p>{W.receiptDefinition} · {W.rankBase(rank.total, RANK_LABELS[rank.metric].label)}</p><Reasons codes={rank.reasonCodes} />
      {!rank.items.length && <EmptyState title={W.noRows} description="" />}
      <ol>{rank.items.map(row => <li key={row.id} className="min-w-0 border-b py-2"><ReportLink href={companyLink(row.id, nav.params)} remember={nav.remember}>{row.rank}. {row.displayName}</ReportLink><p className="text-sm">{[row.registeredName, row.provinceLabel].filter(Boolean).join(' · ')}</p><p>{countText(sourceCount(row.value, rank))} {RANK_LABELS[rank.metric].unit}</p><div className="h-3 rounded border border-gray-700 bg-brand-800" aria-hidden="true" style={{ width: `${row.value / Math.max(1, rank.items[0]?.value ?? 1) * 100}%` }} /></li>)}</ol>
      {rankingTieText(rank.boundaryTie, rank.metric) && <p>{rankingTieText(rank.boundaryTie, rank.metric)}</p>}
      <DrillLink nav={nav} filters={rank.drilldownFilters}>{W.allRanks}</DrillLink>
    </Card>;
  }
  if (data.revenue) return <RevenueContent data={data as ExecutiveAnalysis & { revenue: NonNullable<ExecutiveAnalysis['revenue']> }} />;
  if (data.spendConcentration) return <SpendContent data={data.spendConcentration} nav={nav} />;
  if (data.groups) {
    if (seller === 'credited' && data.creditedSellers) return <Card title={`${W.credited} · ${W.current}`}><p>{W.through(reportDateTime(data.creditedSellers.asOf))}</p>{W.creditNotes.map(note => <p key={note} className="text-sm">{note}</p>)}
      <ReportTable title={W.credited} columns={[{ label: W.creditedSeller }, { label: W.companyCount }, { label: W.creditAmount }]} rows={data.creditedSellers.rows.map((row, i) => ({ key: String(i), cells: [thaiLabel(row.seller.label ?? W.unknown, row.seller.salesCode), <div key="counts">{row.companies}<p>{W.waiting} {row.waiting}</p></div>, money(row.creditSatang)] }))} />
    </Card>;
    const rowsAre = data.view === 'industry' ? W.group : data.view === 'discovery' ? W.discovery : W.referring;
    return <Card title={data.view === 'industry' ? W.group : data.view === 'discovery' ? W.filterLabels.discovery : W.referring}>
      <p>{W.base(countText(data.population.eligibleCount))} · {reportMonth(data.period.month)}</p>
      {data.industryCoverage && <p>{W.industryCoverage(data.industryCoverage.numerator, data.industryCoverage.denominator)}</p>}
      <ReportTable title={W.customers} columns={[{ label: rowsAre }, { label: W.companyCount }, { label: W.paid }, { label: W.filterLabels.paidEver }, { label: W.active }, { label: W.net }]} rows={data.groups.map(row => ({ key: row.key, cells: [<DrillLink key="name" nav={nav} filters={row.drilldownFilters}>{thaiLabel(row.label, row.key)}</DrillLink>, <div key="companies">{row.companies.count} · {ratioText(row.companies.share)}<div aria-hidden="true" className="h-2 border bg-brand-800" style={{ width: `${row.companies.share.value ?? 0}%` }} /></div>, <Figure key="paid" value={row.companiesWithReceipts} />, row.paidEverCompanies, <Figure key="active" value={row.activeCompanies} />, <Figure key="money" value={row.netReceiptsSatang} moneyValue netValue />] }))} />
      {data.roundingNote && <p>{W.rounding}</p>}
    </Card>;
  }
  if (data.comparison) {
    const c = data.comparison;
    const metrics = [
      ['companies', W.companyCount, 'count'], ['netReceiptsSatang', W.net, 'money'], ['netReceiptsPerCompanySatang', W.netPerCompany, 'averageMoney'],
      ['expenseReceiptCount', W.receiptCount, 'count'], ['expenseReceiptsPerCompany', W.receiptsPerCompany, 'average'], ['everAddedReceiptShare', W.adoptionShare, 'ratio'], ['activeCompanies', W.active, 'count'],
    ] as const;
    return <><p>{W.receiptDefinition} · {W.compareBase}</p>
      <div className="flex flex-wrap gap-4">{[c.sideA, c.sideB].map((side, i) => <div key={i}><p>{i === 0 ? W.sideA : W.sideB} · {thaiLabel(side.label, side.key)} · {W.base(countText(side.companies))}</p>{side.drilldownFilters ? <DrillLink filters={side.drilldownFilters} nav={nav}>{W.listGroup}</DrillLink> : <ReportLink href={companyLink(side.key, nav.params)} remember={nav.remember}>{W.detail}</ReportLink>}</div>)}</div>
      <ReportTable title={W.compare} columns={[{ label: W.item }, { label: W.sideA }, { label: W.sideB }, { label: W.difference }]} rows={metrics.map(([key, label, kind]) => ({ key, cells: [label, ...[c.sideA, c.sideB].map(side => {
        const metric = side[key];
        if (kind === 'count' || kind === 'money') return <Figure key={side.key} value={metric as ExecutiveCount} moneyValue={kind === 'money'} netValue={kind === 'money'} />;
        const value = metric?.value;
        return value === null || value === undefined ? '—' : kind === 'averageMoney' ? money(value) : ratioText(metric as Parameters<typeof ratioText>[0], kind === 'ratio' ? '%' : '');
      }), c.difference[key] === null ? '—' : kind === 'money' || kind === 'averageMoney' ? <span>{money(c.difference[key]!)}{negativeMoneyNote(c.difference[key]) && kind === 'money' ? <p>{W.difference}</p> : null}</span> : `${c.difference[key]!.toLocaleString('th-TH', kind === 'count' ? undefined : { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${kind === 'ratio' ? ` ${W.point}` : ''}`] }))} />
    </>;
  }
  return <EmptyState title={W.noRows} description="" />;
}

export function CompanyContent({ data, tab, history, admin, nav, contactReadAt }: { data: ExecutiveCompanyDetail; tab: string; history: ExecutiveCompanyHistory | null; admin: boolean; nav: Navigation; contactReadAt: string }) {
  const company = data.company, month = data.month;
  const monthTitle = reportMonth(data.period.month);
  return <>
    <p>{[company.registeredName, company.provinceLabel, company.industryGroup.label].filter(Boolean).join(' · ')}</p>
    <p className="text-sm">{W.detailBase} · {W.receiptDefinition}</p>
    <Reasons codes={data.monthReasonCodes} />
    {month && <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">{([[W.net, <Figure key="net" value={month.money.netReceiptsSatang} moneyValue netValue />], [W.receiptCount, <Figure key="receipts" value={sourceCount(month.usage.expenseReceiptCountInPeriod, data.coverage.usage)} />], [W.days, <Figure key="days" value={sourceCount(month.usage.activeDays, data.coverage.usage)} />], [W.ai, <Figure key="ai" value={sourceCount(month.usage.aiRequests, data.coverage.usage)} />]] as Array<[string, ReactNode]>).map(([label, value]) => <MangmeeStatCard key={label} label={`${label} ${monthTitle}`} value={value} />)}</div>}
    {tab === 'history' ? history && <Card title={W.history}>{history.items.length === 0 ? <EmptyState title={W.noHistory} description="" /> : <ol className="space-y-3">{history.items.map((event, index) => <li key={index} className="border-b py-3"><p>{reportDateTime(event.at)}</p><p>{EXECUTIVE_HISTORY_EVENT_LABELS[event.kind]} {event.planLabel}</p></li>)}</ol>}</Card> : tab === 'usage' ? month && <>
      <Card title={W.usageTab}>{rowStatus(month)}<p>{W.documentDefinition} · {W.usersDefinition} · {W.aiDefinition}</p>
        <DetailValues rows={[
          [W.filterLabels.receiptAdoption, LABELS.receiptAdoption[company.receiptAdoption] ?? W.unknown], [W.lifetimeReceipts, <Figure key="lifetime" value={sourceCount(company.expenseReceiptCountLifetime, data.coverage.usage)} />],
          ...([[W.receiptCount, 'expenseReceiptCountInPeriod'], [W.days, 'activeDays'], [W.users, 'activeUsers'], [W.documents, 'documents'], [W.ai, 'aiRequests']] as const).map(([label, key]): [string, ReactNode] => [label, <Figure key={key} value={sourceCount(month.usage[key], data.coverage.usage)} />]),
          [W.firstActivity, reportDateTime(company.firstActivityAt)], [W.lastActivity, reportDateTime(company.lastActivityAt)], [W.lastWeb, reportDateTime(company.lastWebEntryAt)], [W.lastLine, reportDateTime(company.lastLineActivityAt)],
        ]} />
        <ReportTable title={W.usage} columns={[{ label: W.discovery }, { label: W.days }, { label: W.users }, { label: W.receiptCount }]} rows={(['Line', 'Web'] as const).map(channel => ({ key: channel, cells: [channel === 'Line' ? W.line : W.web, <Figure key="days" value={sourceCount(month.usage[`activeDays${channel}`], data.coverage.usage)} />, <Figure key="users" value={sourceCount(month.usage[`activeUsers${channel}`], data.coverage.usage)} />, <Figure key="receipts" value={sourceCount(month.usage[`expenseReceipts${channel}`], data.coverage.usage)} />] }))} />
      </Card>
      <Card title={W.revenue}><p>{W.moneyDefinition} · {W.vatIncluded}</p><DetailValues rows={([[W.receipts, month.money.receiptsSatang], [W.refunds, month.money.refundsSatang], [W.net, month.money.netReceiptsSatang], [W.tax, month.money.taxSatang], [W.fees, month.money.feesSatang], [W.aiCost, month.money.aiCostSatang]] as Array<[string, ExecutiveMoney]>).map(([label, value]) => [label, <Figure key={label} value={value} moneyValue netValue={label === W.net} />])} />
        <p>{W.paid}: {month.paidInMonth ? W.paid : data.coverage.money.coverage === 'complete' ? W.noReceipts : LABELS.paidEver.UNKNOWN} · {W.positive}: {month.positiveNetInMonth ? W.positive : data.coverage.money.coverage === 'complete' ? W.noPositiveNet : LABELS.paidEver.UNKNOWN}</p>
      </Card>
    </> : tab === 'company' && <>
      <Card title={W.filterLabels.discovery}><DetailValues rows={[[W.filterLabels.discovery, thaiLabel(company.discovery.label)], [LABELS.discovery.OTHER!, company.discovery.otherText || W.unknown], [W.filterLabels.signupRail, thaiLabel(LABELS.signupRail[company.signupRail] ?? W.unknown)], [W.referring, referrer(company.referrer)], [W.creditedSeller, thaiLabel(company.creditedSeller.label || W.unknown, company.creditedSeller.salesCode)], [W.creditAmount, company.creditedSeller.creditSatang === undefined ? '—' : money(company.creditedSeller.creditSatang)], [W.creditAt, reportDateTime(company.creditedSeller.creditedAt)]]} /><p className="text-sm">{W.current} · {W.through(reportDateTime(data.build.asOf))}</p>{W.creditNotes.map(note => <p key={note} className="text-sm">{note}</p>)}</Card>
      <Card title={W.companyTab}><DetailValues rows={[[W.company, company.displayName], [W.registered, company.registeredName || W.unknown], [W.group, company.industryGroup.label], [W.businessType, company.businessTypeLabel || company.businessTypeOtherText || W.unknown], [W.province, company.provinceLabel], [W.joined, reportDate(company.joinedAt)], [W.filterLabels.companyStatus, LABELS.companyStatus[company.companyStatus] ?? W.unknown], ...contactFields(company.ownerContact).map(([field, value]): [string, ReactNode] => [W[field], value])]} />{company.ownerContact.status !== 'NOT_PERMITTED' && <p className="text-sm">{W.contactAt(reportDateTime(contactReadAt))}</p>}</Card>
      <Card title={W.service}><p>{W.current} · {W.through(reportDateTime(data.build.asOf))}</p><DetailValues rows={[[W.plan, company.planLabel], [W.filterLabels.planState, <div key="state">{LABELS.planState[company.planState] ?? W.unknown}{company.planState === 'ADMIN_HOLD' && <p>{LABELS.companyStatus[company.companyStatus] ?? W.unknown}</p>}</div>], [W.planEnds, reportDate(company.planEndsAt)], [W.members, company.currentActiveMemberCount], [W.branches, company.currentBranchCount], [W.lastActivity, reportDateTime(company.lastActivityAt)]]} /></Card>
      {admin && <ReportLink href={`/system/partners/${encodeURIComponent(company.id)}`} remember={nav.remember}>{W.management}</ReportLink>}
    </>}
  </>;
}
