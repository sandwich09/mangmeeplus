'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { CrmDailyBriefWidget } from '@watchdog-bms/contracts';
import { getDashboard, generateSnapshot } from './dashboard-notifications.api';
import { canForceGenerateSnapshot, homeMetrics, homeStartLinks } from './dashboard-home.logic';
import { dashboardMetricValueText } from './dashboard-notifications.logic';
import { getCrmDailyBrief } from '@/features/crm-inbox/crm-inbox.api';
import type { DashboardSnapshot, DashboardMetricValue, DashboardPeriodKind } from './dashboard-notifications.model';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { formatThaiDate, formatThaiTime } from '@/common/i18n/thai-date';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { MangmeePage, MetricGrid, stripThaiTitlePrefix } from '@/common/components/mangmee';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { primaryButtonClass, quietButtonClass, secondaryButtonClass } from '@/common/components/button/button-classes';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { Notice } from '@/common/components/notice';
import { FilterTabs } from '@/common/components/tabs';
import { useBranchFilter } from '@/features/web-core-workspace/WorkspaceScope';
import { isBranchScope403 } from '@/features/web-core-workspace/branch-scope-label.logic';
import { ExpenseMonthsCard } from './ExpenseMonthsCard';

type DashboardTabPeriodKind = Exclude<DashboardPeriodKind, 'last_month' | 'custom'>;

const PERIOD_TABS: { kind: DashboardTabPeriodKind; labelKey: DictionaryKey }[] = [
  { kind: 'today', labelKey: 'dashboard.period.today' },
  { kind: 'week', labelKey: 'dashboard.period.week' },
  { kind: 'month', labelKey: 'dashboard.period.month' },
  { kind: 'quarter', labelKey: 'dashboard.period.quarter' },
];

// Period label used as a suffix on the date-scoped CRM cards.
const PERIOD_LABEL_KEY: Record<DashboardTabPeriodKind, DictionaryKey> = {
  today: 'dashboard.period.today',
  week: 'dashboard.period.last7',
  month: 'dashboard.period.month',
  quarter: 'dashboard.period.quarter',
};

// Map each daily-brief widget key to a localizable label; the server sends Thai
// labels but the client renders by key so the language toggle covers them too.
const CARD_LABEL_KEY: Record<string, DictionaryKey> = {
  unanswered: 'card.unanswered',
  sla_breaches: 'card.sla_breaches',
  new_customers_today: 'card.new_customers',
  appointments_today: 'card.appointments',
  payment_proofs: 'card.payment_proofs',
  open_deals: 'card.open_deals',
  quotations_awaiting_acceptance: 'card.quotations',
  overdue_payments: 'card.overdue',
  unresolved_complaints: 'card.complaints',
  average_first_response_today: 'card.avg_first_response',
};
// Widgets whose label carries a period suffix.
const DATED_CARD_KEYS = new Set(['new_customers_today', 'appointments_today', 'average_first_response_today']);

/** The first name to greet by, or nothing: a made-up name used to stand in when the session had none. */
function firstName(displayName: string | null) {
  return stripThaiTitlePrefix(displayName ?? '').replace(/^คุณ\s*/, '').trim().split(/\s+/)[0] ?? '';
}

/**
 * One number of the home page. The label and the value are one row on a phone and stacked from 640 px; when the number
 * has a list behind it the whole row is the link (one control per destination, thai-ux-standard §2.6).
 */
function MetricTile({ label, metric, children }: { label: string; metric: DashboardMetricValue; children?: ReactNode }) {
  const href = metric.sourceRefs?.[0]?.href;
  const row = (
    <>
      <span className="text-sm font-medium text-gray-600">{label}</span>
      <span className="flex items-center gap-1 text-xl font-bold text-gray-900">
        <span className="mangmee-unit">{metric.freshness === 'unavailable' ? '—' : dashboardMetricValueText(metric)}</span>
        {href && <span aria-hidden="true" className="text-gray-400">›</span>}
      </span>
    </>
  );
  const rowClass = 'flex min-h-11 items-center justify-between gap-3 sm:flex-col sm:items-start sm:justify-start sm:gap-1';
  return (
    <div className="mangmee-card mangmee-card-shadow grid content-start gap-2 p-4">
      {href ? <Link href={href} className={`${rowClass} rounded-lg hover:text-brand-700`}>{row}</Link> : <div className={rowClass}>{row}</div>}
      {children}
    </div>
  );
}

const money = (value: number | string | null) => Number(value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The expense numbers of the home page, as the owner drew them (Figma HOME-01, 2026-10-14): one white card, the period
 * tabs on top, then three columns — each a name, one big number, one line saying what it counts, and the one button to
 * its list. The buttons are one size; the period changes the first number only.
 */
function ExpenseHomeCard({ metrics, periodKind, onPeriod, locale }: {
  metrics: ReturnType<typeof homeMetrics<DashboardMetricValue>>; periodKind: DashboardTabPeriodKind; onPeriod: (kind: DashboardTabPeriodKind) => void;
  locale: ReturnType<typeof useWorkspaceLocale>;
}) {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  const period = t(PERIOD_TABS.find((tab) => tab.kind === periodKind)!.labelKey, locale);
  // Owner 2026-10-15: numbers only, no buttons under them (the menu leads to each list). The name is the quiet line, the
  // number the loud one with its unit after it; a phone gives each number one row, name left and figure right.
  const columns = [
    { key: 'expense_total_in_period', label: `รายจ่าย${period}`, note: 'ยืนยันแล้ว', unit: 'บาท', dot: 'bg-[#5aa95c]', color: 'text-[#3e8a4f]' },
    { key: 'expense_pending_review', label: 'ใบเสร็จรอตรวจ', note: 'ยังไม่ได้ตรวจ จากทุกช่วงเวลา', unit: 'ใบ', dot: 'bg-[#e9ad43]', color: 'text-[#1f3b2c]' },
    { key: 'expense_unpaid_outstanding', label: 'ค้างจ่าย', note: 'ยืนยันแล้ว ยังไม่ได้จ่าย', unit: 'บาท', dot: 'bg-gray-400', color: 'text-[#1f3b2c]' },
  ].flatMap((column) => { const metric = byKey.get(column.key); return metric ? [{ ...column, metric }] : []; });
  return (
    <section aria-label="ตัวเลขรายจ่าย" className="mangmee-card mangmee-card-shadow p-4 sm:px-6 sm:pb-7 sm:pt-4">
      <div role="group" aria-label="ช่วงเวลา" className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2.5">
        {PERIOD_TABS.map((tab) => (
          <button key={tab.kind} type="button" className="mangmee-home-tab" aria-pressed={tab.kind === periodKind} onClick={() => onPeriod(tab.kind)}>
            {t(tab.labelKey, locale)}
          </button>
        ))}
      </div>
      <MetricGrid className="mt-5 sm:mt-7" items={columns.map(({ key, label, note, unit, dot, color, metric }) => ({ key, label, note, unit, dot, color,
        value: metric.freshness === 'unavailable' ? '—' : metric.unit === 'บาท' ? money(metric.value) : Number(metric.value ?? 0).toLocaleString('th-TH') }))} />
    </section>
  );
}

/** A8 CRM daily brief — inbox-operations widgets with deep links, above the dashboard snapshot. */
function CrmDailyBriefCard({ companyId, periodKind, refreshToken }: { companyId: string; periodKind: DashboardTabPeriodKind; refreshToken: number }) {
  const locale = useWorkspaceLocale();
  const [widgets, setWidgets] = useState<CrmDailyBriefWidget[] | null>(null);
  useEffect(() => {
    let alive = true;
    getCrmDailyBrief(companyId, periodKind).then((r) => { if (alive) setWidgets(r.widgets); }).catch(() => { if (alive) setWidgets([]); });
    return () => { alive = false; };
  }, [companyId, periodKind, refreshToken]);
  if (!widgets || widgets.length === 0) return null;
  const sev: Record<string, string> = {
    critical: 'border-red-200 bg-red-50 text-red-700',
    action: 'border-amber-200 bg-amber-50 text-amber-700',
    info: 'border-gray-200 bg-white text-gray-700',
  };
  // Render the widget label by key so the language toggle covers it; date-scoped
  // widgets get the current period appended. Falls back to the server label.
  const cardLabel = (widget: CrmDailyBriefWidget) => {
    const key = CARD_LABEL_KEY[widget.key];
    if (!key) return widget.label;
    const base = t(key, locale);
    return DATED_CARD_KEYS.has(widget.key) ? `${base} ${t(PERIOD_LABEL_KEY[periodKind], locale)}` : base;
  };
  const formatValue = (widget: CrmDailyBriefWidget) => {
    if (widget.amount !== undefined) {
      const amount = Number(widget.amount);
      const formatted = Number.isFinite(amount) ? amount.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : widget.amount;
      return `${widget.currency === 'THB' ? '฿' : ''}${formatted}`;
    }
    if (widget.value === null) return '—';
    return `${widget.value.toLocaleString('th-TH')}${widget.unit === 'minutes' ? ` ${t('dashboard.home.minutes_suffix', locale)}` : ''}`;
  };
  return (
    <div className="mt-2 mb-1">
      <div className="mb-2 text-[13px] font-bold tracking-wide text-gray-400">{t('dashboard.home.crm_summary', locale)}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {widgets.map((w) => (
          <Link key={w.key} href={w.href} className={`rounded-xl border p-3.5 transition hover:shadow-[var(--shadow-theme-sm)] ${sev[w.severity] ?? sev.info}`}>
            <div className="text-[13px] font-medium opacity-80">{cardLabel(w)}</div>
            <div className="mt-1 text-2xl font-extrabold">{formatValue(w)}</div>
            {w.count !== undefined && (w.amount !== undefined || w.unit === 'minutes') && (
              <div className="mt-0.5 text-[11px] font-medium opacity-70">{w.count.toLocaleString('th-TH')} {t('dashboard.home.items_suffix', locale)}</div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function CompanyDashboardPage({
  companyId,
  permissions,
  displayName,
}: {
  companyId: string;
  permissions: string[];
  displayName: string | null;
}) {
  const locale = useWorkspaceLocale();
  const branchFilter = useBranchFilter();
  const branchId = branchFilter?.branchId || undefined;
  const name = firstName(displayName);
  // This month, not today: today's total is zero on most days, and the period changes one number only.
  const [periodKind, setPeriodKind] = useState<DashboardTabPeriodKind>('month');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const snapshotRequestRef = useRef(0);
  const scopeRef = useRef('');

  const load = useCallback(async (kind: DashboardTabPeriodKind) => {
    const requestId = ++snapshotRequestRef.current;
    setLoading(true);
    setRefreshing(false);
    // Another shop or branch: its numbers go at once. Another period of the same scope: the card stays while it loads,
    // so its tabs do not jump away (a failed read clears it below).
    const scope = `${companyId}|${branchId ?? ''}`;
    if (scopeRef.current !== scope) { scopeRef.current = scope; setSnapshot(null); }
    setError(null);
    try {
      const data = await getDashboard(companyId, kind, branchId);
      if (requestId !== snapshotRequestRef.current) return;
      setSnapshot(data);
    } catch (e) {
      if (requestId !== snapshotRequestRef.current) return;
      setSnapshot(null);
      if (isBranchScope403(e, branchId)) { branchFilter?.reportBranchForbidden(); return; }
      setError(t('dashboard.home.load_error', locale));
    } finally {
      if (requestId === snapshotRequestRef.current) setLoading(false);
    }
    // `branchFilter` is deliberately absent: reportBranchForbidden is stable per companyId, which is here.
  }, [companyId, locale, branchId]);

  useEffect(() => {
    void load(periodKind);
    return () => { snapshotRequestRef.current += 1; };
  }, [load, periodKind]);

  const handleRefresh = async () => {
    const requestId = ++snapshotRequestRef.current;
    setRefreshing(true);
    setError(null);
    setRefreshToken((n) => n + 1);
    try {
      const data = canForceGenerateSnapshot(permissions)
        ? await generateSnapshot(companyId, periodKind, branchId)
        : await getDashboard(companyId, periodKind, branchId);
      if (requestId !== snapshotRequestRef.current) return;
      setSnapshot(data);
    } catch (e) {
      if (requestId !== snapshotRequestRef.current) return;
      if (isBranchScope403(e, branchId)) { branchFilter?.reportBranchForbidden(); return; }
      setError(t('dashboard.home.refresh_error', locale));
    } finally {
      if (requestId === snapshotRequestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  // Only widgets whose source feature is enabled for this company: a provider whose permission
  // was stripped by the entitlement gate returns an unavailableReason instead of numbers.
  const availableWidgets = (snapshot?.widgets ?? []).filter((w) => !w.unavailableReason && w.metrics.length > 0);

  const startLinks = homeStartLinks(companyId, permissions);
  const greeting = `${t('dashboard.home.greeting', locale)}${name ? (locale === 'th' ? ` คุณ${name}` : ` ${name}`) : ''}`;
  const expenseWidget = availableWidgets.find((widget) => widget.key === 'expense_summary');
  const otherWidgets = availableWidgets.filter((widget) => widget !== expenseWidget);
  const branchName = branchFilter?.branchId ? branchFilter.branches.find((branch) => branch.id === branchFilter.branchId)?.name
    : branchFilter?.branches.length === 1 ? branchFilter.branches[0]!.name : 'ทุกสาขา';
  // The owner's home (Figma HOME-01): the shop's spending is the page. A person without those numbers keeps the greeting
  // and the two ways to start.
  const expenseHome = Boolean(expenseWidget) || (loading && permissions.includes('expense.read'));
  const updated = snapshot ? `อัปเดตล่าสุด ${formatThaiDate(snapshot.generatedAt)} เวลา ${formatThaiTime(snapshot.generatedAt)}` : null;

  return (
    <MangmeePage title={expenseHome ? 'รายจ่ายของร้าน' : greeting} className={expenseHome ? 'mangmee-home' : undefined}
      description={expenseHome ? <span className="flex flex-wrap gap-x-4">{[branchName, updated].filter(Boolean).map((part) => <span key={part}>{part}</span>)}</span> : undefined}>
      {/* What the person came to do, before any number (thai-ux-standard §3.1). On the owner's home the buttons under the numbers do it. */}
      {!expenseHome && startLinks.length > 0 && (
        <ActionGroup align="start">
          {startLinks.map((link, index) => (
            <Link key={link.key} href={link.href} className={index === startLinks.length - 1 ? primaryButtonClass : secondaryButtonClass}>{link.label}</Link>
          ))}
        </ActionGroup>
      )}

      {/* A failed read shows only itself and its retry, never the "nothing here" sentence under it. */}
      {error && (
        <Notice tone="error" action={<button type="button" className={secondaryButtonClass} onClick={() => void load(periodKind)} aria-busy={Boolean(loading)}>{t('state.error.retry', locale)}</button>}>
          {error}
        </Notice>
      )}

      {loading && !snapshot ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading', locale)} className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="mangmee-card mangmee-card-shadow h-20 animate-pulse" />
          ))}
        </div>
      ) : <>
      {expenseWidget && <ExpenseHomeCard metrics={homeMetrics(expenseWidget.metrics)} periodKind={periodKind} onPeriod={setPeriodKind} locale={locale} />}
      {expenseWidget && <ExpenseMonthsCard companyId={companyId} branchId={branchId} />}
      {otherWidgets.map((widget) => (
        // A person with no number to see (an employee) gets no section, no period and no "no data" sentence.
        <section key={widget.key} aria-labelledby={`home-widget-${widget.key}`} className="grid gap-3">
          <h2 id={`home-widget-${widget.key}`} className="text-base font-bold text-gray-900">{widget.title}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {homeMetrics(widget.metrics).map((metric) => (
              <MetricTile key={metric.key} label={metric.homeLabel} metric={metric}>
                {metric.periodScoped && (
                  <ThemedSelect aria-label="ช่วงเวลา" value={periodKind} onChange={(event) => setPeriodKind(event.target.value as DashboardTabPeriodKind)}>
                    {PERIOD_TABS.map((tab) => <option key={tab.kind} value={tab.kind}>{t(tab.labelKey, locale)}</option>)}
                  </ThemedSelect>
                )}
              </MetricTile>
            ))}
          </div>
        </section>
      ))}
      </>}

      {/* Not part of the owner's drawing (Figma HOME-01): to-dos that still need a place, under the numbers. */}
      {/* P10-L §15.4: OWNER-only, and `company.legal_identity.manage` is exactly that today
          (permission-registry.spec.ts keeps it owner-only pending QP2) — so it gates on the
          authority to fix what the card asks for, not on a role name the dashboard never receives. */}
      {/* Owner 2026-10-15: the shop-details reminder is not on the home page. */}

      {permissions.includes('crm.inbox.read') && <details className="mangmee-card mangmee-card-shadow p-4">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">สรุปงานลูกค้าและการขาย</summary>
        <CrmDailyBriefCard companyId={companyId} periodKind={periodKind} refreshToken={refreshToken} />
      </details>}


      {snapshot && otherWidgets.length > 0 && !expenseWidget && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
          <span>
            {t('dashboard.home.updated_at', locale)}{' '}
            <span className="mangmee-unit">{locale === 'th' ? formatThaiTime(snapshot.generatedAt) : new Date(snapshot.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}</span>
          </span>
          <button type="button" onClick={handleRefresh} disabled={refreshing} aria-busy={Boolean(refreshing)} className={quietButtonClass} data-loading-indicator>
            {t('dashboard.home.refresh', locale)}
          </button>
        </div>
      )}
    </MangmeePage>
  );
}
