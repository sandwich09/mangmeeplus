'use client';

// Item 15A Phase 3 — Customer 360 (spec §10.3): header + tabs over the
// summary360/timeline aggregates. Blocks the API redacted (no source
// permission) render a lock card; sources without a backend yet render a
// placeholder-with-reason per the plan pattern.
import { useState, useEffect, useCallback } from 'react';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { formatThaiDate, formatThaiDateTime } from '@/common/i18n/thai-date';
import { getCrmCustomer360, getCrmCustomerTimeline, listCrmOpportunities, eraseCrmCustomer, listCustomerBookings } from './crm.api';
import { lineIdentityText } from './customers-prototype.model';
import { listConversations } from '@/features/crm-inbox/crm-inbox.api';
import { CONVERSATION_STATUS_META } from '@/features/crm-inbox/crm-inbox.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { useConfirm } from '@/common/components/modal';
import { LoadingState } from '@/common/components/state';

function err(e: unknown) { return apiErrorMessage(e); }
function localeName(locale: SupportedLocale) { return locale === 'th' ? 'th-TH' : 'en-US'; }
function money(v: string | undefined, locale: SupportedLocale) { const n = Number(v ?? 0); return new Intl.NumberFormat(localeName(locale), { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n); }
function shortDate(v: string | undefined, _locale: SupportedLocale) { return formatThaiDate(v); }
function dateTime(v: string | undefined, _locale: SupportedLocale) { return formatThaiDateTime(v); }

const CONSENT_META = (locale: SupportedLocale): Record<string, { label: string; cls: string }> => ({
  GRANTED: { label: t('customers.consent_granted', locale), cls: 'bg-green-50 text-green-700 border-green-200' },
  REVOKED: { label: t('customers.consent_revoked', locale), cls: 'bg-red-50 text-red-700 border-red-200' },
  NOT_REQUIRED: { label: t('customers.consent_not_required', locale), cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  UNKNOWN: { label: t('customers.consent_unknown', locale), cls: 'bg-amber-50 text-amber-700 border-amber-200' },
});

const CUSTOMER_STATUS_LABEL = (locale: SupportedLocale): Record<string, string> => ({
  ACTIVE: t('customers.status_active', locale), INACTIVE: t('customers.status_inactive', locale), ARCHIVED: t('customers.status_archived', locale), MERGED: t('customers.status_merged', locale),
});

const DOC_TYPE_LABEL = (locale: SupportedLocale): Record<string, string> => ({
  QUOTATION: t('customers.doc_quotation', locale), INVOICE: t('customers.doc_invoice', locale), TAX_INVOICE: t('customers.doc_tax_invoice', locale), RECEIPT: t('customers.doc_receipt', locale),
  CREDIT_NOTE: t('customers.doc_credit_note', locale), DEBIT_NOTE: t('customers.doc_debit_note', locale), BILL: t('customers.doc_bill', locale), PURCHASE_ORDER: t('customers.doc_purchase_order', locale),
});

const PAYMENT_STATUS_LABEL = (locale: SupportedLocale): Record<string, string> => ({
  PAID: t('customers.pay_paid', locale), PARTIALLY_PAID: t('customers.pay_partially_paid', locale), UNPAID: t('customers.pay_unpaid', locale), OVERPAID: t('customers.pay_overpaid', locale),
});

const TIMELINE_META = (locale: SupportedLocale): Record<string, { icon: string; label: string }> => ({
  ACTIVITY: { icon: '📝', label: t('customers.timeline_activity', locale) },
  CONVERSATION_STARTED: { icon: '💬', label: t('customers.timeline_conversation_started', locale) },
  DEAL_CREATED: { icon: '💼', label: t('customers.timeline_deal_created', locale) },
  TASK_CREATED: { icon: '⏰', label: t('customers.timeline_task_created', locale) },
  FINANCE_DOCUMENT: { icon: '🧾', label: t('customers.timeline_finance_document', locale) },
  CONSENT_CHANGED: { icon: '🛡️', label: t('customers.timeline_consent_changed', locale) },
});

type TabKey =
  | 'overview' | 'timeline' | 'conversations' | 'deals' | 'quotations' | 'finance'
  | 'appointments' | 'servicejobs' | 'notes' | 'consent';

const TABS = (locale: SupportedLocale): { key: TabKey; label: string }[] => [
  { key: 'overview', label: t('customers.tab_overview', locale) },
  { key: 'timeline', label: t('customers.tab_timeline', locale) },
  { key: 'conversations', label: t('customers.tab_conversations', locale) },
  { key: 'deals', label: t('customers.tab_deals', locale) },
  { key: 'quotations', label: t('customers.tab_quotations', locale) },
  { key: 'finance', label: t('customers.tab_finance', locale) },
  { key: 'appointments', label: t('customers.tab_appointments', locale) },
  { key: 'servicejobs', label: t('customers.tab_servicejobs', locale) },
  { key: 'notes', label: t('customers.tab_notes', locale) },
  { key: 'consent', label: t('customers.tab_consent', locale) },
];

function LockedCard({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
      🔒 {text}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="rounded border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400">{text}</div>;
}
function PlaceholderCard({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
      <div className="text-sm font-semibold text-gray-500">{title}</div>
      <div className="mt-1 text-sm text-gray-400">{reason}</div>
    </div>
  );
}

export function Customer360Page({ companyId, customerId, permissions = [] }: { companyId: string; customerId: string; permissions?: string[] }) {
  const locale = useWorkspaceLocale();
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getCrmCustomer360(companyId, customerId)
      .then((s) => { if (alive) { setSummary(s); setError(null); setErrorStatus(null); } })
      .catch((e) => { if (alive) { setError(err(e)); setErrorStatus((e as any)?.status ?? null); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [companyId, customerId]);

  if (loading) return <LoadingState label="กำลังโหลด..." />;
  if (error || !summary) {
    return (
      <div className="space-y-4 p-6">
        <a href={`/companies/${companyId}/crm`} className="text-sm text-brand-700 hover:underline">{t('customers.back_to_crm', locale)}</a>
        {errorStatus === 403 ? (
          <LockedCard text={t('customers.customer_no_permission', locale)} />
        ) : errorStatus === 404 ? (
          <Empty text={t('customers.customer_not_found', locale)} />
        ) : (
          <div className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error ?? t('customers.error_generic', locale)}</div>
        )}
      </div>
    );
  }

  const c = summary.customer;
  const redacted: string[] = summary.redactedSources ?? [];
  const consentMeta = CONSENT_META(locale);
  const consent = consentMeta[c.consentStatus] ?? consentMeta.UNKNOWN;
  const statusLabels = CUSTOMER_STATUS_LABEL(locale);

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <a href={`/companies/${companyId}/customers`} className="text-sm text-brand-700 hover:underline">{locale === 'th' ? 'กลับไปฐานลูกค้า' : 'Back to customers'}</a>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{c.displayName}</h1>
            {c.code && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{c.code}</span>}
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
              {statusLabels[c.status] ?? c.status}
            </span>
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${consent.cls}`}>{consent.label}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
            {c.primaryPhone && <span>{t('customers.phone_label', locale)} {c.primaryPhone}</span>}
            {c.primaryEmail && <span>{t('customers.email_label', locale)} {c.primaryEmail}</span>}
            <span>{lineIdentityText(c.lineIdentities, locale === 'th' ? 'ยังไม่เชื่อม LINE' : 'LINE not linked')}</span>
            {c.ownerUserId ? <span>{t('customers.owner_label', locale)} {locale === 'th' ? 'มีผู้ดูแล' : 'Assigned'}</span> : <span>{t('customers.no_owner', locale)}</span>}
          </div>
          {/* Advisory AI fields (lead score / sentiment / risk / LTV) land with Phase 4 AI Assist. */}
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-xs text-purple-600">
            {t('customers.ai_insights_coming', locale)}
          </div>
        </div>
        <a
          href={`/companies/${companyId}/inbox`}
          className="mangmee-btn mangmee-btn-primary"
        >
          {t('customers.open_inbox', locale)}
        </a>
      </div>

      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {TABS(locale).map((tb) => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === tb.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab summary={summary} redacted={redacted} />}
      {tab === 'timeline' && <TimelineTab companyId={companyId} customerId={customerId} />}
      {tab === 'conversations' && <ConversationsTab companyId={companyId} customerId={customerId} redacted={redacted} />}
      {tab === 'deals' && <DealsTab companyId={companyId} customerId={customerId} redacted={redacted} />}
      {tab === 'quotations' && <QuotationsTab quotations={summary.quotations} redacted={redacted} />}
      {tab === 'finance' && <FinanceTab finance={summary.finance} redacted={redacted} />}
      {tab === 'appointments' && <AppointmentsTab companyId={companyId} customerId={customerId} />}
      {tab === 'servicejobs' && (
        <PlaceholderCard title={t('customers.tab_servicejobs', locale)} reason={t('customers.servicejobs_placeholder', locale)} />
      )}
      {tab === 'notes' && <NotesTab customer={c} />}
      {tab === 'consent' && <ConsentTab companyId={companyId} customerId={customerId} customer={c} canErase={permissions.includes('crm.customer.erase')} />}
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────
function OverviewTab({ summary, redacted }: { summary: any; redacted: string[] }) {
  const locale = useWorkspaceLocale();
  const tiles: { label: string; value: string; sub?: string; locked?: boolean }[] = [
    summary.conversations
      ? {
          label: t('customers.tile_conversations', locale),
          value: `${summary.conversations.total}`,
          sub: `${t('customers.tile_open', locale)} ${summary.conversations.open} · ${t('customers.tile_unread', locale)} ${summary.conversations.unread}`,
        }
      : { label: t('customers.tile_conversations', locale), value: '—', locked: redacted.includes('conversations') },
    summary.deals
      ? { label: t('customers.tile_open_deals', locale), value: `${summary.deals.openCount}`, sub: `${t('customers.tile_total_value', locale)} ฿${money(summary.deals.openAmountTotal, locale)}` }
      : { label: t('customers.tile_open_deals', locale), value: '—', locked: redacted.includes('deals') },
    summary.tasks
      ? {
          label: t('customers.tile_open_tasks', locale),
          value: `${summary.tasks.openCount}`,
          sub: summary.tasks.next ? `${t('customers.tile_next', locale)} ${shortDate(summary.tasks.next.dueAt, locale)} · ${summary.tasks.next.title}` : undefined,
        }
      : { label: t('customers.tile_open_tasks', locale), value: '—', locked: redacted.includes('tasks') },
    summary.finance
      ? { label: t('customers.tile_finance_docs', locale), value: `${summary.finance.documents.length}`, sub: t('customers.tile_see_finance_tab', locale) }
      : { label: t('customers.tile_finance_docs', locale), value: '🔒', sub: t('customers.no_finance_permission', locale), locked: true },
  ];
  const latest = summary.deals?.latest;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-400">{tile.label}</div>
            <div className="mt-1 text-xl font-bold text-gray-900">{tile.value}</div>
            {tile.sub && <div className="mt-0.5 truncate text-xs text-gray-500" title={tile.sub}>{tile.sub}</div>}
            {tile.locked && !tile.sub && <div className="mt-0.5 text-xs text-gray-400">{t('customers.no_section_permission', locale)}</div>}
          </div>
        ))}
      </div>
      {latest && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-bold tracking-wide text-gray-400">{t('customers.latest_deal', locale)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">{latest.title}</span>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{latest.canonicalStageGroup}</span>
            <span className="text-sm text-gray-600">฿{money(latest.amountEstimate, locale)}</span>
            {latest.expectedCloseDate && <span className="text-xs text-gray-400">{t('customers.expected_close', locale)} {shortDate(latest.expectedCloseDate, locale)}</span>}
          </div>
        </div>
      )}
      {summary.customer.notes && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-bold tracking-wide text-gray-400">{t('customers.notes', locale)}</div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{summary.customer.notes}</div>
        </div>
      )}
      {(summary.customer.contacts ?? []).length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-bold tracking-wide text-gray-400">{t('customers.contacts', locale)}</div>
          <div className="mt-2 space-y-1.5">
            {summary.customer.contacts.map((p: any) => (
              <div key={p.id} className="text-sm text-gray-700">
                <span className="font-medium">{p.name}</span>
                {p.role && <span className="text-gray-400"> · {p.role}</span>}
                {p.phone && <span className="text-gray-500"> · {p.phone}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────
function TimelineTab({ companyId, customerId }: { companyId: string; customerId: string }) {
  const locale = useWorkspaceLocale();
  const [events, setEvents] = useState<any[]>([]);
  const [nextBefore, setNextBefore] = useState<string | undefined>(undefined);
  const [redacted, setRedacted] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (before?: string) => {
    setLoading(true);
    try {
      const page = await getCrmCustomerTimeline(companyId, customerId, before ? { before } : undefined);
      setEvents((prev) => (before ? [...prev, ...page.events] : page.events));
      setNextBefore(page.nextBefore);
      setRedacted(page.redactedSources ?? []);
      setError(null);
    } catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId, customerId]);

  useEffect(() => { void load(); }, [load]);

  const timelineMeta = TIMELINE_META(locale);
  return (
    <div className="space-y-3">
      {redacted.length > 0 && (
        <div className="rounded bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-500">
          🔒 {t('customers.some_sources_redacted', locale)}: {redacted.join(', ')}
        </div>
      )}
      {error && <div className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!error && events.length === 0 && !loading && <Empty text={t('customers.no_timeline_events', locale)} />}
      <div className="space-y-2">
        {events.map((e) => {
          const meta = timelineMeta[e.type] ?? { icon: '•', label: e.type };
          const row = (
            <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="text-lg leading-none">{meta.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-900">
                  <span className="font-semibold">{meta.label}</span>
                  {e.title && <span className="text-gray-700"> — {e.title}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-400">
                  <span>{dateTime(e.occurredAt, locale)}</span>
                  {e.detail && <span>{e.detail}</span>}
                  {e.amount && <span>฿{money(e.amount, locale)}</span>}
                </div>
              </div>
              {e.refType === 'conversation' && <span className="text-xs text-brand-700">{t('customers.open_chat', locale)}</span>}
            </div>
          );
          return e.refType === 'conversation' ? (
            <a key={e.id} href={`/companies/${companyId}/inbox?conversation=${e.refId}`} className="block hover:opacity-90">{row}</a>
          ) : (
            <div key={e.id}>{row}</div>
          );
        })}
      </div>
      {loading && <div className="text-center text-sm text-gray-400">{t('customers.loading', locale)}</div>}
      {!loading && nextBefore && (
        <button
          onClick={() => void load(nextBefore)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('customers.load_older_events', locale)}
        </button>
      )}
    </div>
  );
}

// ── Conversations ─────────────────────────────────────────────────────────────
function ConversationsTab({ companyId, customerId, redacted }: { companyId: string; customerId: string; redacted: string[] }) {
  const locale = useWorkspaceLocale();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (redacted.includes('conversations')) { setLoading(false); return; }
    let alive = true;
    listConversations(companyId, { customerId, pageSize: 50 })
      .then((r) => { if (alive) setRows(r.items); })
      .catch((e) => { if (alive) setError(err(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [companyId, customerId, redacted]);

  if (redacted.includes('conversations')) return <LockedCard text={t('customers.no_inbox_permission', locale)} />;
  if (loading) return <LoadingState label="กำลังโหลด..." />;
  if (error) return <div className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (rows.length === 0) return <Empty text={t('customers.no_conversations', locale)} />;
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const meta = CONVERSATION_STATUS_META[r.status as keyof typeof CONVERSATION_STATUS_META];
        return (
          <a key={r.id} href={`/companies/${companyId}/inbox?conversation=${r.id}`}
            className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 hover:bg-gray-50">
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: meta?.color, background: meta?.bg }}>
              {meta?.label ?? r.status}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{r.lastMessagePreview ?? '—'}</span>
            {r.unreadCount > 0 && (
              <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-bold text-white">{r.unreadCount}</span>
            )}
            <span className="text-xs text-gray-400">{shortDate(r.lastMessageAt, locale)}</span>
          </a>
        );
      })}
    </div>
  );
}

// ── Deals ─────────────────────────────────────────────────────────────────────
function DealsTab({ companyId, customerId, redacted }: { companyId: string; customerId: string; redacted: string[] }) {
  const locale = useWorkspaceLocale();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (redacted.includes('deals')) { setLoading(false); return; }
    let alive = true;
    listCrmOpportunities(companyId, { customerId, pageSize: 50 })
      .then((r) => { if (alive) setRows(r.items ?? []); })
      .catch((e) => { if (alive) setError(err(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [companyId, customerId, redacted]);

  if (redacted.includes('deals')) return <LockedCard text={t('customers.no_deals_permission', locale)} />;
  if (loading) return <LoadingState label="กำลังโหลด..." />;
  if (error) return <div className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (rows.length === 0) return <Empty text={t('customers.no_customer_deals', locale)} />;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th className="px-4 py-2">{t('customers.col_deal', locale)}</th><th className="px-4 py-2">{t('customers.col_status', locale)}</th><th className="px-4 py-2">{t('customers.col_stage', locale)}</th>
            <th className="px-4 py-2 text-right">{t('customers.col_value', locale)}</th><th className="px-4 py-2">{t('customers.col_expected_close', locale)}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((o) => (
            <tr key={o.id}>
              <td className="px-4 py-2 font-medium text-gray-900">{o.title}</td>
              <td className="px-4 py-2"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{o.status}</span></td>
              <td className="px-4 py-2 text-gray-600">{o.canonicalStageGroup}</td>
              <td className="px-4 py-2 text-right text-gray-700">฿{money(o.amountEstimate, locale)}</td>
              <td className="px-4 py-2 text-gray-500">{shortDate(o.expectedCloseDate, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Quotations (CRM-side links; the finance tab shows the accounting view) ────
function QuotationsTab({ quotations, redacted }: { quotations: any[] | null; redacted: string[] }) {
  const locale = useWorkspaceLocale();
  if (redacted.includes('quotations') || quotations === null) {
    return <LockedCard text={t('customers.no_quotations_permission', locale)} />;
  }
  if (quotations.length === 0) return <Empty text={t('customers.no_customer_quotations', locale)} />;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th className="px-4 py-2">{t('customers.col_number', locale)}</th><th className="px-4 py-2">{t('customers.col_status', locale)}</th>
            <th className="px-4 py-2 text-right">{t('customers.col_value', locale)}</th><th className="px-4 py-2">{t('customers.col_created_at', locale)}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {quotations.map((q) => (
            <tr key={q.id}>
              <td className="px-4 py-2 font-medium text-gray-900">{q.accountingDocumentNumber ?? t('customers.draft_label', locale)}</td>
              <td className="px-4 py-2"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{q.status}</span></td>
              <td className="px-4 py-2 text-right text-gray-700">{q.grandTotalAmount ? `฿${money(q.grandTotalAmount, locale)}` : '—'}</td>
              <td className="px-4 py-2 text-gray-500">{shortDate(q.createdAt, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Finance (redacted for callers without accounting.document.read) ──────────
function FinanceTab({ finance, redacted }: { finance: any | null; redacted: string[] }) {
  const locale = useWorkspaceLocale();
  if (redacted.includes('finance') || finance === null) {
    return <LockedCard text={t('customers.no_finance_data_permission', locale)} />;
  }
  if (finance.documents.length === 0) return <Empty text={t('customers.no_finance_documents', locale)} />;
  const docTypeLabels = DOC_TYPE_LABEL(locale);
  const payStatusLabels = PAYMENT_STATUS_LABEL(locale);
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th className="px-4 py-2">{t('customers.col_document', locale)}</th><th className="px-4 py-2">{t('customers.col_number', locale)}</th><th className="px-4 py-2">{t('customers.col_status', locale)}</th>
            <th className="px-4 py-2 text-right">{t('customers.col_total', locale)}</th><th className="px-4 py-2 text-right">{t('customers.col_outstanding', locale)}</th>
            <th className="px-4 py-2">{t('customers.col_date', locale)}</th><th className="px-4 py-2">{t('customers.col_due_date', locale)}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {finance.documents.map((d: any) => (
            <tr key={d.id}>
              <td className="px-4 py-2 font-medium text-gray-900">{docTypeLabels[d.documentType] ?? d.documentType}</td>
              <td className="px-4 py-2 text-gray-600">{d.documentNumber ?? '—'}</td>
              <td className="px-4 py-2">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                  {d.paymentStatus ? (payStatusLabels[d.paymentStatus] ?? d.paymentStatus) : d.status}
                </span>
              </td>
              <td className="px-4 py-2 text-right text-gray-700">฿{money(d.grandTotalAmount, locale)}</td>
              <td className={`px-4 py-2 text-right ${Number(d.outstandingAmount) > 0 ? 'font-semibold text-amber-700' : 'text-gray-500'}`}>
                ฿{money(d.outstandingAmount, locale)}
              </td>
              <td className="px-4 py-2 text-gray-500">{shortDate(d.documentDate, locale)}</td>
              <td className="px-4 py-2 text-gray-500">{shortDate(d.dueDate, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Notes / Consent ───────────────────────────────────────────────────────────
function AppointmentsTab({ companyId, customerId }: { companyId: string; customerId: string }) {
  const locale = useWorkspaceLocale();
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    listCustomerBookings(companyId, customerId)
      .then((r) => { if (alive) setItems(r.items); })
      .catch((e) => { if (alive) setError(err(e)); });
    return () => { alive = false; };
  }, [companyId, customerId]);

  if (error) return <div className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!items) return <LoadingState label="กำลังโหลด..." />;
  if (items.length === 0) return <Empty text={t('customers.no_appointments', locale)} />;

  const statusMeta: Record<string, { label: string; cls: string }> = {
    BOOKED: { label: t('customers.appt_booked', locale), cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    DONE: { label: t('customers.appt_done', locale), cls: 'bg-green-50 text-green-700 border-green-200' },
    CANCELLED: { label: t('customers.appt_cancelled', locale), cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  };
  return (
    <div className="space-y-2">
      {items.map((b) => {
        const st = statusMeta[b.status] ?? { label: b.status, cls: 'bg-gray-50 text-gray-600 border-gray-200' };
        return (
          <div key={b.id} className="flex flex-wrap items-center justify-between rounded-lg border border-gray-200 bg-white p-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-800">{b.serviceName}</div>
              <div className="text-xs text-gray-500">{formatThaiDateTime(b.startAt)}</div>
            </div>
            <span className={`ml-3 flex-shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function NotesTab({ customer }: { customer: any }) {
  const locale = useWorkspaceLocale();
  if (!customer.notes) return <Empty text={t('customers.no_customer_notes', locale)} />;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="whitespace-pre-wrap text-sm text-gray-700">{customer.notes}</div>
    </div>
  );
}

function ConsentTab({ companyId, customerId, customer, canErase }: { companyId: string; customerId: string; customer: any; canErase: boolean }) {
  const locale = useWorkspaceLocale();
  const consentMeta = CONSENT_META(locale);
  const consent = consentMeta[customer.consentStatus] ?? consentMeta.UNKNOWN;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const onErase = useCallback(async () => {
    // PDPA erasure is irreversible; require an explicit confirm before the call.
    const confirmed = await confirm({
      title: t('customers.erase_title', locale),
      message: t('customers.erase_confirm', locale),
      confirmLabel: t('customers.erase_button', locale),
      cancelLabel: t('common.cancel', locale),
    });
    if (!confirmed) return;
    setBusy(true); setFailed(null);
    try {
      const r = await eraseCrmCustomer(companyId, customerId, 'PDPA erasure request');
      setDone(`${t('customers.erase_done_prefix', locale)}: ${t('customers.erase_done_messages', locale)} ${r.messagesRedacted} · ${t('customers.erase_done_media', locale)} ${r.mediaPurged} ${t('customers.erase_done_refresh', locale)}`);
    } catch (e) {
      setFailed(err(e));
    } finally {
      setBusy(false);
    }
  }, [companyId, confirm, customerId, locale]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${consent.cls}`}>{consent.label}</span>
          {customer.consentUpdatedAt && <span className="text-xs text-gray-400">{t('customers.updated_label', locale)} {dateTime(customer.consentUpdatedAt, locale)}</span>}
        </div>
        {customer.consentNote && <div className="mt-2 text-sm text-gray-600">{customer.consentNote}</div>}
        <div className="mt-3 text-xs leading-relaxed text-gray-400">
          {t('customers.consent_disclaimer', locale)}
        </div>
      </div>

      {canErase && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-sm font-semibold text-red-700">{t('customers.erase_title', locale)}</div>
          <div className="mt-1 text-xs leading-relaxed text-red-600">
            {t('customers.erase_description', locale)}
          </div>
          {done ? (
            <div className="mt-2 rounded bg-white/70 px-3 py-2 text-xs text-red-700">{done}</div>
          ) : (
            <button
              onClick={onErase}
              disabled={busy}
              className="mt-3 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? t('customers.erasing', locale) : t('customers.erase_button', locale)}
            </button>
          )}
          {failed && <div className="mt-2 text-xs text-red-700">{failed}</div>}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
