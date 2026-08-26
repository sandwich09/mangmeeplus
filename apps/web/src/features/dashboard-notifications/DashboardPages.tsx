'use client';

import { useCallback, useEffect, useState, type SVGProps } from 'react';
import Link from 'next/link';
import type { CrmDailyBriefWidget } from '@watchdog-bms/contracts';
import { getDashboard, generateSnapshot } from './dashboard-notifications.api';
import { canForceGenerateSnapshot } from './dashboard-home.logic';
import { getCrmDailyBrief } from '@/features/crm-inbox/crm-inbox.api';
import type { DashboardSnapshot, DashboardWidget, DashboardMetricValue, DashboardPeriodKind } from './dashboard-notifications.model';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { formatThaiTime } from '@/common/i18n/thai-date';
import type { DictionaryKey, SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { stripThaiTitlePrefix } from '@/common/components/mangmee';
import { useBranchFilter, useBranchScopeLabel } from '@/features/web-core-workspace/WorkspaceScope';
import { isBranchScope403 } from '@/features/web-core-workspace/branch-scope-label.logic';

type DashboardTabPeriodKind = Exclude<DashboardPeriodKind, 'last_month' | 'custom'>;

const PERIOD_TABS: { kind: DashboardTabPeriodKind; labelKey: DictionaryKey }[] = [
  { kind: 'today', labelKey: 'dashboard.period.today' },
  { kind: 'week', labelKey: 'dashboard.period.last7' },
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

function firstName(displayName: string | null) {
  const cleaned = stripThaiTitlePrefix(displayName ?? 'นภา').replace(/^คุณ\s*/, '').trim();
  return cleaned.split(/\s+/)[0] || 'นภา';
}

function companyHref(companyId: string, path: string) {
  return `/companies/${companyId}/${path}`;
}

function StoreIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M4.75 10.25h14.5M6.25 10.25v8h11.5v-8M7.25 10.25V6.75h9.5v3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 18.25v-4.5h6v4.5M9.5 6.75V5.5h5v1.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4.5 12a7.5 7.5 0 0 1 12.6-5.5M19.5 12a7.5 7.5 0 0 1-12.6 5.5M17.5 4.5v3.5H14M6.5 19.5V16H10"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Card({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-gray-200 bg-white shadow-[var(--shadow-theme-sm)] ${className}`}>{children}</section>;
}

// Plan P4.2: the brain answers on LINE this launch, so the CTA points at the OA. Read as a static
// literal — Next only inlines NEXT_PUBLIC_* into the client bundle through property access.
const LINE_OA_URL = process.env.NEXT_PUBLIC_LINE_OA_URL ?? '';

const HERO_EXAMPLE_KEYS: DictionaryKey[] = [
  'dashboard.hero.example_cashflow',
  'dashboard.hero.example_category',
  'dashboard.hero.example_receipt',
];

// Plan P4.1–P4.3 (WEB-01/WEB-02): the two things a new user should be able to start from the
// landing page without reading the menu. Both targets are one tap; nothing here is a placeholder.
function StartHereHero({ companyId, locale, canUploadReceipts, canOpenLedger }: { companyId: string; locale: SupportedLocale; canUploadReceipts: boolean; canOpenLedger: boolean }) {
  const ctaClass =
    'flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-center text-base font-extrabold';
  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <Card className="flex flex-col gap-3 p-5">
        <div>
          <h2 className="text-[19px] font-extrabold text-gray-900">{t('dashboard.hero.brain_title', locale)}</h2>
          <p className="mt-1 text-base leading-7 text-gray-600">{t('dashboard.hero.brain_desc', locale)}</p>
        </div>
        {/* No OA link configured: say when it opens instead of shipping a dead button (plan P4 fallback). */}
        {LINE_OA_URL ? (
          <a href={LINE_OA_URL} target="_blank" rel="noopener noreferrer" className={`${ctaClass} bg-brand-600 text-white`}>
            {t('dashboard.hero.brain_title', locale)}
          </a>
        ) : (
          <p className={`${ctaClass} border border-dashed border-gray-300 bg-gray-50 !font-semibold text-gray-500`}>
            {t('dashboard.hero.brain_soon', locale)}
          </p>
        )}
        <div>
          <p className="text-sm font-bold text-gray-500">{t('dashboard.hero.brain_examples', locale)}</p>
          {/* Text, not buttons: a chip that looks pressable but does nothing is worse than none. */}
          <ul className="mt-2 flex flex-wrap gap-2">
            {HERO_EXAMPLE_KEYS.map((key) => (
              <li key={key} className="rounded-full bg-brand-25 px-3 py-1.5 text-base text-gray-700">
                “{t(key, locale)}”
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* Without expense.receipt.upload the tab refuses the visitor, so the card is not offered. */}
      {canUploadReceipts && (
        <Card className="flex flex-col gap-3 p-5">
          <div>
            <h2 className="text-[19px] font-extrabold text-gray-900">{t('dashboard.hero.receipt_title', locale)}</h2>
            <p className="mt-1 text-base leading-7 text-gray-600">{t('dashboard.hero.receipt_desc', locale)}</p>
          </div>
          <Link href={companyHref(companyId, 'expenses/upload')} className={`${ctaClass} mt-auto bg-brand-600 text-white`}>
            {t('dashboard.hero.receipt_title', locale)}
          </Link>
        </Card>
      )}
      {canOpenLedger && (
        <Card className="flex flex-col gap-3 p-5">
          <div>
            <h2 className="text-[19px] font-extrabold text-gray-900">{locale === 'th' ? 'สมุดรายรับ–รายจ่าย' : 'Income & expense book'}</h2>
            <p className="mt-1 text-base leading-7 text-gray-600">{locale === 'th' ? 'ดูยอดตามเอกสาร เงินที่รับ–จ่าย และรายการย้อนหลังในหน้าเดียว' : 'Review document totals, cash movements, and source records in one place.'}</p>
          </div>
          <Link href={companyHref(companyId, 'income-expense-ledger')} className={`${ctaClass} mt-auto bg-brand-600 text-white`}>
            {locale === 'th' ? 'เปิดสมุด' : 'Open book'}
          </Link>
        </Card>
      )}
    </div>
  );
}

function SectionTitle({ tone, title }: { tone: string; title: string }) {
  return (
    <div className="mb-3 mt-8 flex items-center gap-[11px]">
      <span className="h-[22px] w-[5px] rounded-[3px]" style={{ backgroundColor: tone }} />
      <span className="text-[19px] font-extrabold text-gray-900">{title}</span>
      <span className="h-px flex-1 bg-gray-200" />
    </div>
  );
}

const SEVERITY_TONE: Record<NonNullable<DashboardMetricValue['severity']>, { text: string; bg: string }> = {
  critical: { text: '#D92D20', bg: '#FEE4E2' },
  warning: { text: '#B54708', bg: '#FEF3C7' },
  info: { text: '#0E7090', bg: '#F0F9FF' },
  normal: { text: '#027A48', bg: '#ECFDF3' },
};

function formatMetricValue(metric: DashboardMetricValue): string {
  if (metric.value === null || metric.value === undefined || metric.value === '') return '—';
  if (typeof metric.value === 'number') return `${metric.value.toLocaleString('en-US')}${metric.unit ? ` ${metric.unit}` : ''}`;
  return metric.unit ? `${metric.value} ${metric.unit}` : String(metric.value);
}

function MetricRow({ metric }: { metric: DashboardMetricValue }) {
  const tone = SEVERITY_TONE[metric.severity ?? 'normal'];
  const href = metric.sourceRefs?.[0]?.href;
  const content = (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <span className="text-[15px] font-medium text-gray-600">{metric.label}</span>
      <span
        className="tabular-nums rounded-full px-3 py-1 text-[15px] font-extrabold"
        style={metric.freshness === 'unavailable' ? undefined : { color: tone.text, backgroundColor: tone.bg }}
      >
        {metric.freshness === 'unavailable' ? '—' : formatMetricValue(metric)}
      </span>
    </div>
  );
  if (!href) return content;
  return (
    <Link href={href} className="-mx-2 block rounded-xl px-2 transition hover:bg-[var(--color-gray-25)]">
      {content}
    </Link>
  );
}

function WidgetCard({ widget }: { widget: DashboardWidget }) {
  return (
    <Card className="p-6">
      <div className="text-lg font-bold text-gray-900">{widget.title}</div>
      <div className="mt-1 divide-y divide-gray-100">
        {widget.metrics.map((metric) => (
          <MetricRow key={metric.key} metric={metric} />
        ))}
      </div>
    </Card>
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
  const scopeLabel = useBranchScopeLabel();
  const name = firstName(displayName);
  const [periodKind, setPeriodKind] = useState<DashboardTabPeriodKind>('today');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async (kind: DashboardTabPeriodKind) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDashboard(companyId, kind, branchId);
      setSnapshot(data);
    } catch (e) {
      if (isBranchScope403(e, branchId)) { branchFilter?.reportBranchForbidden(); return; }
      setError(t('dashboard.home.load_error', locale));
    } finally {
      setLoading(false);
    }
    // `branchFilter` is deliberately absent: reportBranchForbidden is stable per companyId, which is here.
  }, [companyId, locale, branchId]);

  useEffect(() => {
    void load(periodKind);
  }, [load, periodKind]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    setRefreshToken((n) => n + 1);
    try {
      const data = canForceGenerateSnapshot(permissions)
        ? await generateSnapshot(companyId, periodKind, branchId)
        : await getDashboard(companyId, periodKind, branchId);
      setSnapshot(data);
    } catch (e) {
      if (isBranchScope403(e, branchId)) { branchFilter?.reportBranchForbidden(); return; }
      setError(t('dashboard.home.refresh_error', locale));
    } finally {
      setRefreshing(false);
    }
  };

  // Only widgets whose source feature is enabled for this company: a provider whose permission
  // was stripped by the entitlement gate returns an unavailableReason instead of numbers.
  const availableWidgets = (snapshot?.widgets ?? []).filter((w) => !w.unavailableReason && w.metrics.length > 0);

  return (
    <div className="mangmee-page" style={{ gap: 0 }}>
      <div className="mb-[18px] flex flex-wrap items-center justify-between gap-4">
        <div className="text-[15px] text-gray-500">
          <Link href={companyHref(companyId, 'dashboard')} className="hover:text-brand-700">{t('shell.workspace', locale)}</Link>
          <span className="mx-1.5 text-gray-300">/</span>
          <span className="font-medium text-gray-700">{t('dashboard.title', locale)}</span>
        </div>
        {/* No resolved branch context: claim no scope at all rather than a wrong one (spec R3). */}
        {scopeLabel && (
          <span className="inline-flex items-center gap-[7px] rounded-full border border-brand-100 bg-brand-25 px-3 py-[5px] text-sm font-semibold text-brand-600">
            <StoreIcon className="h-4 w-4" />
            {scopeLabel}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-extrabold leading-tight tracking-normal text-gray-900">{t('dashboard.home.greeting', locale)} {locale === 'th' && 'คุณ '}{name}</h1>
          <p className="mt-1 text-base text-gray-500">
            {t('dashboard.home.business_overview', locale)}{scopeLabel && ` · ${scopeLabel}`}
            {snapshot && ` · ${t('dashboard.home.updated_at', locale)} ${locale === 'th' ? formatThaiTime(snapshot.generatedAt) : new Date(snapshot.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}`}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:flex-wrap sm:overflow-x-visible">
          {PERIOD_TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              onClick={() => setPeriodKind(tab.kind)}
              className={`shrink-0 whitespace-nowrap min-h-11 rounded-[10px] px-[17px] py-[9px] text-[15px] font-bold sm:min-h-0 shadow-[var(--shadow-theme-sm)] ${
                tab.kind === periodKind
                  ? 'bg-brand-600 text-white'
                  : 'border border-gray-200 bg-white text-gray-600 shadow-none'
              }`}
            >
              {t(tab.labelKey, locale)}
            </button>
          ))}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="shrink-0 whitespace-nowrap flex min-h-11 items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-[17px] py-[9px] sm:min-h-0 text-[15px] font-bold text-gray-600 shadow-[var(--shadow-theme-sm)] disabled:opacity-60"
          >
            <RefreshIcon className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {t('dashboard.home.refresh', locale)}
          </button>
        </div>
      </div>

      <StartHereHero
        companyId={companyId}
        locale={locale}
        canUploadReceipts={permissions.includes('expense.receipt.upload')}
        canOpenLedger={permissions.includes('accounting.document.read') || permissions.includes('expense.read')}
      />

      {permissions.includes('crm.inbox.read') && <CrmDailyBriefCard companyId={companyId} periodKind={periodKind} refreshToken={refreshToken} />}

      {error && (
        <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] font-medium text-red-700">{error}</div>
      )}

      {loading && !snapshot ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading', locale)} className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="h-40 animate-pulse p-6" />
          ))}
        </div>
      ) : (
        <>
          <SectionTitle tone="var(--color-brand-500)" title={t('dashboard.home.overview', locale)} />
          {availableWidgets.length === 0 ? (
            <Card className="p-6 text-[15px] text-gray-500">{t('dashboard.home.no_data', locale)}</Card>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {availableWidgets.map((widget) => (
                <WidgetCard key={widget.key} widget={widget} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
