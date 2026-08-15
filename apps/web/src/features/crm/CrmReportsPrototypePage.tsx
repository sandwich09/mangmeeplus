'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CrmReportsSummary, CrmDailyBriefWidget, DashboardPeriodKind } from '@watchdog-bms/contracts';
import { getCrmDailyBrief } from '@/features/crm-inbox/crm-inbox.api';
import { ForbiddenState } from '@/common/components/state';
import { ApiError } from '@/common/models/api-error.model';
import { MangmeeCard } from '@/common/components/mangmee';
import { formatMessage } from '@/common/i18n/error-message.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import type { DictionaryKey, SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useBranchFilter, useBranchScopeLabel } from '@/features/web-core-workspace/WorkspaceScope';
import { isBranchScope403 } from '@/features/web-core-workspace/branch-scope-label.logic';
import { avatarColor, avatarInitial } from '@/features/crm-inbox/crm-inbox.logic';
import { DesignIcons } from '@/features/web-core-workspace/design-icons';
import { getCrmReportsSummary } from './crm.api';
import {
  CONV_STATUS_META,
  REPORT_STAFF_COLORS,
  TIER_META,
  contractStatusKey,
  formatLifetimeValueAmount,
} from './crm-reports-prototype.model';

type KpiCard = { label: string; value: string; sub: string; c: string; bg: string };
type BriefState = 'loading' | 'ready' | 'forbidden' | 'error';

// Period filter tabs — chat metrics (KPIs, status, staff) are
// scoped to the selected range; LTV/retention stay lifetime-cumulative.
const PERIOD_TABS: { kind: DashboardPeriodKind; labelKey: DictionaryKey }[] = [
  { kind: 'today', labelKey: 'crm_reports.period.today' },
  { kind: 'week', labelKey: 'crm_reports.period.week' },
  { kind: 'month', labelKey: 'crm_reports.period.month' },
  { kind: 'quarter', labelKey: 'crm_reports.period.quarter' },
  { kind: 'last_month', labelKey: 'crm_reports.period.last_month' },
];

function isForbiddenError(error: unknown): boolean {
  return error instanceof ApiError
    ? error.kind === 'forbidden'
    : typeof error === 'object' && error !== null && 'status' in error && (error as { status?: unknown }).status === 403;
}

function reportKpis(summary: CrmReportsSummary, locale: SupportedLocale): KpiCard[] {
  return [
    { label: t('crm_reports.kpi.total', locale), value: String(summary.total), sub: t('crm_reports.kpi.period_sub', locale), c: '#1570EF', bg: '#EFF8FF' },
    { label: t('crm_reports.kpi.resolved', locale), value: `${summary.resolvedRate}%`, sub: formatMessage(t('crm_reports.kpi.resolved_sub', locale), { resolved: summary.resolved, total: summary.total }), c: '#027A48', bg: '#ECFDF3' },
    { label: t('crm_reports.kpi.avg_response', locale), value: summary.avgResponseMin != null ? formatMessage(t('crm_reports.kpi.avg_response_value', locale), { minutes: summary.avgResponseMin }) : '—', sub: t('crm_reports.kpi.avg_response_sub', locale), c: '#B54708', bg: '#FEF3C7' },
    { label: t('crm_reports.kpi.overdue', locale), value: String(summary.overdue), sub: t('crm_reports.kpi.overdue_sub', locale), c: '#D92D20', bg: '#FEE4E2' },
  ];
}

function fmtBaht(v: number): string {
  return v >= 1000 ? `฿${(v / 1000).toFixed(1)}K` : `฿${v.toLocaleString('en-US')}`;
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-4 py-6 text-center text-[14px] font-semibold text-gray-400">
      {children}
    </div>
  );
}

function LoadingCard() {
  return (
    <MangmeeCard className="min-w-0 px-5 py-[18px]">
      <div className="h-4 w-24 animate-pulse rounded bg-gray-100" />
      <div className="mt-3 h-9 w-20 animate-pulse rounded bg-gray-100" />
      <div className="mt-3 h-6 w-28 animate-pulse rounded-full bg-gray-100" />
    </MangmeeCard>
  );
}

export function CrmReportsPrototypePage({ companyId, permissions }: { companyId: string; permissions: string[] }) {
  const locale = useWorkspaceLocale();
  const branchFilter = useBranchFilter();
  const branchId = branchFilter?.branchId || undefined;
  // The one derived branch-scope label (spec R1); `null` while the context is unresolved (R3).
  const branchLabel = useBranchScopeLabel();
  const canReadReports = permissions.includes('crm.report.read');
  const [period, setPeriod] = useState<DashboardPeriodKind>('today');
  const [summaryState, setSummaryState] = useState<{ period: DashboardPeriodKind; data: CrmReportsSummary } | null>(null);
  const [brief, setBrief] = useState<CrmDailyBriefWidget[]>([]);
  const [briefState, setBriefState] = useState<BriefState>('loading');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [forbidden, setForbidden] = useState(!canReadReports);
  const loadAbort = useRef(0);
  const summary = summaryState?.data ?? null;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const requested = new URLSearchParams(window.location.search).get('period');
    if (PERIOD_TABS.some((tab) => tab.kind === requested)) setPeriod(requested as DashboardPeriodKind);
  }, []);

  const loadSummary = useCallback(async () => {
    if (!canReadReports) {
      setForbidden(true);
      setLoading(false);
      return;
    }

    const token = ++loadAbort.current;
    setLoading(true);
    try {
      const next = await getCrmReportsSummary(companyId, { branchId, period });
      if (token !== loadAbort.current) return;
      setSummaryState({ period, data: next });
      setError(false);
      setForbidden(false);
    } catch (e) {
      if (token !== loadAbort.current) return;
      if (isBranchScope403(e, branchId)) { branchFilter?.reportBranchForbidden(); return; }
      if (isForbiddenError(e)) setForbidden(true);
      else setError(true);
    } finally {
      if (token === loadAbort.current) setLoading(false);
    }
  }, [branchId, canReadReports, companyId, period]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!canReadReports) return;
    let alive = true;
    setBriefState('loading');
    getCrmDailyBrief(companyId, period)
      .then((r) => {
        if (!alive) return;
        setBrief(r.widgets);
        setBriefState('ready');
      })
      .catch((e) => {
        if (alive) setBriefState(isForbiddenError(e) ? 'forbidden' : 'error');
      });
    return () => { alive = false; };
  }, [companyId, canReadReports, period]);

  if (forbidden) return <ForbiddenState />;

  const w = (key: string) => brief.find((x) => x.key === key);
  const wNum = (key: string) => { const x = w(key); return Number(x?.value ?? x?.count ?? 0) || 0; };
  const wBaht = (key: string) => { const x = w(key); return fmtBaht(x?.amount != null ? Number(x.amount) : Number(x?.value ?? 0)); };
  const briefReady = briefState === 'ready';

  const salesOps = [
    { Icon: DesignIcons.tag, c: '#6941C6', bg: '#F4EBFF', value: briefReady ? String(w('open_deals')?.count ?? 0) : '—', label: t('crm_reports.sales_ops.open_deals', locale), href: briefReady ? w('open_deals')?.href : undefined },
    { Icon: DesignIcons.money, c: '#027A48', bg: '#ECFDF3', value: briefReady ? wBaht('open_deals') : '—', label: t('crm_reports.sales_ops.open_value', locale), href: briefReady ? w('open_deals')?.href : undefined },
    { Icon: DesignIcons.doc, c: '#B54708', bg: '#FEF3C7', value: briefReady ? String(w('quotations_awaiting_acceptance')?.count ?? 0) : '—', label: t('crm_reports.sales_ops.quotations', locale), href: briefReady ? w('quotations_awaiting_acceptance')?.href : undefined },
    { Icon: DesignIcons.receipt, c: '#1570EF', bg: '#EFF8FF', value: briefReady ? String(wNum('payment_proofs')) : '—', label: t('crm_reports.sales_ops.payment_proofs', locale), href: briefReady ? w('payment_proofs')?.href : undefined },
    { Icon: DesignIcons.bell, c: '#D92D20', bg: '#FEE4E2', value: briefReady ? String(wNum('unresolved_complaints')) : '—', label: t('crm_reports.sales_ops.complaints', locale), href: briefReady ? w('unresolved_complaints')?.href : undefined },
  ];
  const rt = summary?.retention;
  const retentionCards = rt ? [
    { label: t('crm_reports.retention.repeat', locale), value: `${rt.repeatRatePct}%`, sub: formatMessage(t('crm_reports.retention.repeat_sub', locale), { returning: rt.returningCount, total: rt.totalCount }), c: '#027A48', bg: '#ECFDF3', glyph: '♻' },
    { label: t('crm_reports.retention.new', locale), value: formatMessage(t('crm_reports.retention.people_value', locale), { count: rt.newCount }), sub: t('crm_reports.retention.new_sub', locale), c: '#1570EF', bg: '#EFF8FF', glyph: '＋' },
    { label: t('crm_reports.retention.at_risk', locale), value: formatMessage(t('crm_reports.retention.people_value', locale), { count: rt.atRiskCount }), sub: formatMessage(t('crm_reports.retention.at_risk_sub', locale), { rate: rt.churnRatePct }), c: '#B42318', bg: '#FEE4E2', glyph: '⚠' },
    { label: t('crm_reports.retention.avg_ltv', locale), value: `฿${Number(rt.avgLtvAmount).toLocaleString('en-US')}`, sub: t('crm_reports.retention.avg_ltv_sub', locale), c: '#6941C6', bg: '#F4EBFF', glyph: '฿' },
  ] : [];
  const statusBars = summary?.statusBreakdown
    .map((item) => {
      const key = contractStatusKey(item.status);
      return key ? { item, key, meta: CONV_STATUS_META[key] } : null;
    })
    .filter((bar): bar is NonNullable<typeof bar> => bar !== null) ?? [];
  const periodLabelKey = PERIOD_TABS.find((tab) => tab.kind === period)?.labelKey;
  const periodLabel = periodLabelKey ? t(periodLabelKey, locale) : '';
  const storedPeriod = summaryState?.period;
  const storedPeriodLabelKey = PERIOD_TABS.find((tab) => tab.kind === storedPeriod)?.labelKey;
  const storedPeriodLabel = storedPeriodLabelKey ? t(storedPeriodLabelKey, locale) : '';

  const handleDownload = () => {
    if (!summary || !storedPeriod) return;
    const rows: (string | number)[][] = [
      [t('crm_reports.title', locale)],
      [t('crm_reports.csv.branch', locale), branchLabel ?? ''],
      [t('crm_reports.csv.period', locale), storedPeriodLabel],
      [],
      [t('crm_reports.chat_summary', locale)],
      [t('crm_reports.kpi.total', locale), summary.total],
      [t('crm_reports.kpi.resolved', locale), `${summary.resolved} (${summary.resolvedRate}%)`],
      [t('crm_reports.csv.avg_response_minutes', locale), summary.avgResponseMin != null ? summary.avgResponseMin : '-'],
      [t('crm_reports.kpi.overdue', locale), summary.overdue],
      [],
      [t('crm_reports.status.title', locale)],
      ...summary.statusBreakdown.map((s) => [s.status, `${s.count} (${s.pct}%)`]),
      [],
      [t('crm_reports.csv.retention_title', locale)],
      [t('crm_reports.csv.repeat_rate', locale), summary.retention?.repeatRatePct ?? '—'],
      [t('crm_reports.retention.new', locale), summary.retention?.newCount ?? '—'],
      [t('crm_reports.retention.at_risk', locale), summary.retention?.atRiskCount ?? '—'],
      [t('crm_reports.retention.avg_ltv', locale), summary.retention?.avgLtvAmount ?? '—'],
      [],
      [t('crm_reports.top_customers.title', locale)],
      ...summary.topCustomers.map((c) => [c.displayName, c.lifetimeValueAmount]),
      [],
      [t('crm_reports.staff.title', locale)],
      ...summary.staffPerformance.map((s) => [s.displayName ?? s.userId ?? t('crm_reports.staff.unassigned', locale), `${formatMessage(t('crm_reports.staff.performance', locale), { assigned: s.assigned, resolved: s.resolved })} (${s.rate}%)`]),
    ];
    const csv = '﻿' + rows
      .map((r) => r.map((cell) => {
        const value = String(cell ?? '');
        const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
        return `"${safeValue.replace(/"/g, '""')}"`;
      }).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-report-${storedPeriod}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mangmee-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold leading-tight text-gray-900">{t('crm_reports.title', locale)}</h1>
          <p className="mt-3 text-base font-medium text-gray-500">{t('crm_reports.subtitle', locale)}{branchLabel && ` · ${branchLabel}`} · {periodLabel}</p>
        </div>
      </div>

      <div className="flex w-full items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:flex-wrap sm:overflow-x-visible">
        {PERIOD_TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            onClick={() => setPeriod(tab.kind)}
            className={`shrink-0 whitespace-nowrap rounded-[10px] px-[17px] py-[9px] text-[15px] font-bold shadow-[var(--shadow-theme-sm)] ${
              tab.kind === period
                ? 'bg-brand-600 text-white'
                : 'border border-gray-200 bg-white text-gray-600 shadow-none'
            }`}
          >
            {t(tab.labelKey, locale)}
          </button>
        ))}
        <button
          type="button"
          onClick={handleDownload}
          disabled={!summary || loading || storedPeriod !== period}
          className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-gray-200 bg-white px-[17px] py-[9px] text-[15px] font-bold text-gray-600 shadow-[var(--shadow-theme-sm)] disabled:opacity-60"
        >
          <DesignIcons.doc className="h-4 w-4" />
          {t('crm_reports.download', locale)}
        </button>
      </div>

      {loading && !summary ? (
        <>
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <LoadingCard key={i} />)}
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-[1.3fr_1fr]">
            <MangmeeCard className="px-[22px] py-5">
              <div className="h-5 w-36 animate-pulse rounded bg-gray-100" />
              <div className="mt-4 h-36 animate-pulse rounded-xl bg-gray-100" />
            </MangmeeCard>
            <MangmeeCard className="px-[22px] py-5">
              <div className="h-5 w-40 animate-pulse rounded bg-gray-100" />
              <div className="mt-4 h-36 animate-pulse rounded-xl bg-gray-100" />
            </MangmeeCard>
          </div>
          <MangmeeCard className="px-[22px] py-5">
            <div className="h-5 w-48 animate-pulse rounded bg-gray-100" />
            <div className="mt-4 h-28 animate-pulse rounded-xl bg-gray-100" />
          </MangmeeCard>
        </>
      ) : error && !summary ? (
        <MangmeeCard className="px-[22px] py-8 text-center">
          <div className="text-[15px] font-semibold text-gray-600">{t('crm_reports.load_error', locale)}</div>
          <button
            type="button"
            onClick={() => void loadSummary()}
            className="mt-4 rounded-xl bg-brand-500 px-5 py-2.5 text-[14px] font-bold text-white"
          >
            {t('crm_reports.retry', locale)}
          </button>
        </MangmeeCard>
      ) : summary ? (
        <>
          <MangmeeCard className="px-[26px] py-[22px]">
            <div className="mb-4 text-[18px] font-bold text-gray-900">{t('crm_reports.sales_ops.title', locale)}</div>
            {briefState !== 'ready' && (
              <div className="-mt-2 mb-4 text-sm text-gray-500">
                {t(`crm_reports.sales_ops.${briefState}` as DictionaryKey, locale)}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-5">
              {salesOps.map((c) => {
                const body = (
                  <>
                    <span className="flex h-9 w-9 items-center justify-center rounded-[11px]" style={{ background: c.bg, color: c.c }}><c.Icon className="h-[18px] w-[18px]" /></span>
                    <div>
                      <div className="text-[26px] font-extrabold tabular-nums text-gray-900">{c.value}</div>
                      <div className="mt-0.5 flex items-center gap-1 text-[13.5px] text-gray-500">
                        {c.label}
                        {c.href && <span className="opacity-0 transition-opacity group-hover:opacity-100" style={{ color: c.c }}>→</span>}
                      </div>
                    </div>
                  </>
                );
                return c.href ? (
                  <Link
                    key={c.label}
                    href={c.href}
                    className="group flex flex-col gap-2.5 rounded-[14px] border border-gray-100 bg-[var(--color-gray-25)] p-[15px] transition hover:border-brand-200 hover:bg-white hover:shadow-[var(--shadow-theme-sm)]"
                  >
                    {body}
                  </Link>
                ) : (
                  <div key={c.label} className="flex flex-col gap-2.5 rounded-[14px] border border-gray-100 bg-[var(--color-gray-25)] p-[15px]">
                    {body}
                  </div>
                );
              })}
            </div>
          </MangmeeCard>

          <div className="mt-2 text-[15px] font-bold tracking-[.02em] text-gray-500">{t('crm_reports.chat_summary', locale)}</div>
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            {reportKpis(summary, locale).map((kpi) => (
              <MangmeeCard key={kpi.label} className="min-w-0 px-5 py-[18px]">
                <div className="text-sm text-gray-500">{kpi.label}</div>
                <div className="mt-1.5 text-[30px] font-extrabold leading-tight" style={{ color: kpi.c }}>
                  {kpi.value}
                </div>
                <div
                  className="mt-2 inline-flex rounded-[20px] px-2.5 py-[3px] text-xs font-bold"
                  style={{ background: kpi.bg, color: kpi.c }}
                >
                  {kpi.sub}
                </div>
              </MangmeeCard>
            ))}
          </div>

          <div className="mt-2 text-[15px] font-bold tracking-[.02em] text-gray-500">{t('crm_reports.retention.title', locale)}</div>
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            {retentionCards.map((k) => (
              <MangmeeCard key={k.label} className="px-5 py-[18px]">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] text-[19px] font-extrabold" style={{ background: k.bg, color: k.c }}>{k.glyph}</span>
                  <div className="text-sm text-gray-500">{k.label}</div>
                </div>
                <div className="mt-3 text-[28px] font-extrabold leading-none tabular-nums" style={{ color: k.c }}>{k.value}</div>
                <div className="mt-1.5 text-[13.5px] text-gray-400">{k.sub}</div>
              </MangmeeCard>
            ))}
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-[1.3fr_1fr]">
            <MangmeeCard className="px-[22px] py-5">
              <h2 className="text-base font-bold text-gray-800">{t('crm_reports.status.title', locale)}</h2>
              {summary.total === 0 || statusBars.length === 0 ? (
                <div className="mt-4"><EmptyState>{t('crm_reports.status.empty', locale)}</EmptyState></div>
              ) : (
                <div className="mt-4 flex flex-col gap-[13px]">
                  {statusBars.map(({ item, key, meta }) => {
                    return (
                      <div key={item.status}>
                        <div className="mb-[5px] flex items-center gap-2 text-[13.5px] text-gray-600">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.c }} />
                          <span className="flex-1">{t(`crm_reports.status.${key}` as DictionaryKey, locale)}</span>
                          <span className="font-bold text-gray-800">
                            {item.count} · {item.pct}%
                          </span>
                        </div>
                        <div className="h-[9px] overflow-hidden rounded-[20px] bg-gray-100">
                          <div className="h-full rounded-[20px]" style={{ width: `${item.pct}%`, background: meta.c }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </MangmeeCard>

            <MangmeeCard className="px-[22px] py-5">
              <h2 className="text-base font-bold text-gray-800">{t('crm_reports.top_customers.title', locale)}</h2>
              <div className="mt-3.5 flex flex-col gap-3">
                {summary.topCustomers.length === 0 ? (
                  <EmptyState>{t('crm_reports.top_customers.empty', locale)}</EmptyState>
                ) : summary.topCustomers.map((cust, i) => {
                  const tier = TIER_META[cust.tier];
                  return (
                    <div key={cust.customerId} className="flex items-center gap-[11px]">
                      <div className="w-4 text-sm font-extrabold text-gray-300">{i + 1}</div>
                      <div
                        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                        style={{ background: avatarColor(cust.customerId) }}
                      >
                        {avatarInitial(cust.displayName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14.5px] font-semibold text-gray-800">{cust.displayName}</div>
                        <span
                          className="inline-flex rounded-[20px] px-2.5 py-[2px] text-xs font-bold"
                          style={{ background: tier.bg, color: tier.c }}
                        >
                          {t(`crm_reports.tier.${cust.tier}` as DictionaryKey, locale)}
                        </span>
                      </div>
                      <div className="text-[15px] font-extrabold text-brand-600">฿{formatLifetimeValueAmount(cust.lifetimeValueAmount)}</div>
                    </div>
                  );
                })}
              </div>
            </MangmeeCard>
          </div>

          <MangmeeCard className="px-[22px] py-5">
            <h2 className="text-base font-bold text-gray-800">{t('crm_reports.staff.title', locale)}</h2>
            <div className="mt-3.5 flex flex-col gap-1.5">
              {summary.staffPerformance.length === 0 ? (
                <EmptyState>{t('crm_reports.staff.empty', locale)}</EmptyState>
              ) : summary.staffPerformance.map((staff, i) => {
                const name = staff.userId === null ? t('crm_reports.staff.unassigned', locale) : (staff.displayName ?? staff.userId);
                return (
                  <div key={staff.userId ?? 'unassigned'} className="flex items-center gap-3 border-b border-gray-100 py-2.5 last:border-b-0">
                    <div
                      className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-white"
                      style={{ background: REPORT_STAFF_COLORS[i % REPORT_STAFF_COLORS.length] ?? '#12B76A' }}
                    >
                      {avatarInitial(name)}
                    </div>
                    <div className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-gray-800">{name}</div>
                    <div className="text-[13.5px] text-gray-500">
                      {formatMessage(t('crm_reports.staff.performance', locale), { assigned: staff.assigned, resolved: staff.resolved })}
                    </div>
                    <div className="w-[52px] text-right text-sm font-extrabold text-brand-600">{staff.rate}%</div>
                  </div>
                );
              })}
            </div>
          </MangmeeCard>
        </>
      ) : null}
    </div>
  );
}
