'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { CrmDuplicateWarning } from '@watchdog-bms/contracts';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ForbiddenState, LoadingState } from '@/common/components/state';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { formatThaiDate } from '@/common/i18n/thai-date';
import {
  getCrmDashboard, getCrmFollowUpPriorities,
  listCrmLeads, createCrmLead, convertCrmLead, disqualifyCrmLead,
  getCrmBoard, listCrmStages, createCrmOpportunity, getCrmOpportunity,
  moveCrmOpportunityStage, closeCrmOpportunity, createCrmQuotationDraft, createCrmActivity,
  listCrmFollowUps, createCrmFollowUp, completeCrmFollowUp,
} from './crm.api';
import { customerDuplicateErrorState } from './customers-prototype.model';
import { parseCrmTab, visibleCrmTabs, type CrmTab } from './crm.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { useToast } from '@/common/components/toast';
import { useInputPrompt } from '@/common/components/modal';

function err(e: unknown) { return apiErrorMessage(e); }
function money(v?: string) { const n = Number(v ?? 0); return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n); }
function shortDate(v?: string) { return formatThaiDate(v); }

const inputClass = 'mangmee-input';
const btnClass = 'mangmee-btn mangmee-btn-primary disabled:opacity-50';
const ghostClass = 'rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

function ErrorBanner({ message }: { message: string }) {
  return <div className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{message}</div>;
}
function Empty({ text }: { text: string }) {
  return <div className="rounded border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400">{text}</div>;
}

export function CrmWorkspacePage({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const locale = useWorkspaceLocale();
  const searchParams = useSearchParams();
  const visibleTabs = useMemo(() => visibleCrmTabs(permissions), [permissions]);
  const canViewCustomers = permissions.includes('crm.customer.read');
  const [tab, setTab] = useState<CrmTab>(() => parseCrmTab(searchParams.get('tab'), visibleTabs));
  const tabs = ([
    { key: 'overview', label: t('customers.tab_overview', locale) },
    { key: 'leads', label: t('customers.tab_leads', locale) },
    { key: 'pipeline', label: t('customers.tab_pipeline', locale) },
    { key: 'followups', label: t('customers.tab_followups', locale) },
  ] satisfies Array<{ key: CrmTab; label: string }>).filter((item) => visibleTabs.includes(item.key));
  useEffect(() => {
    const requested = searchParams.get('tab');
    if ((requested === 'customers' || visibleTabs.length === 0) && canViewCustomers) {
      window.location.replace(`/companies/${companyId}/customers`);
      return;
    }
    setTab(parseCrmTab(requested, visibleTabs));
  }, [canViewCustomers, companyId, searchParams, visibleTabs]);

  if (!canViewCustomers && visibleTabs.length === 0) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('customers.crm_title', locale)}</h1>
          <p className="text-sm text-gray-500">{t('customers.crm_subtitle', locale)}</p>
        </div>
        <ForbiddenState description="บัญชีของคุณไม่มีสิทธิ์ใช้งานเมนู CRM" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('customers.crm_title', locale)}</h1>
        <p className="text-sm text-gray-500">{t('customers.crm_subtitle', locale)}</p>
      </div>
      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {canViewCustomers && (
          <Link
            href={`/companies/${companyId}/customers`}
            className="whitespace-nowrap border-b-2 border-transparent px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            {t('customers.tab_customers', locale)}
          </Link>
        )}
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {visibleTabs.includes(tab) && tab === 'overview' && <Overview companyId={companyId} />}
      {visibleTabs.includes(tab) && tab === 'leads' && <Leads companyId={companyId} />}
      {visibleTabs.includes(tab) && tab === 'pipeline' && <Pipeline companyId={companyId} />}
      {visibleTabs.includes(tab) && tab === 'followups' && <FollowUps companyId={companyId} />}
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────
function Overview({ companyId }: { companyId: string }) {
  const locale = useWorkspaceLocale();
  const [summary, setSummary] = useState<any | null>(null);
  const [priorities, setPriorities] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, p] = await Promise.all([
          getCrmDashboard(companyId).catch(() => null),
          getCrmFollowUpPriorities(companyId).catch(() => ({ items: [] })),
        ]);
        if (!alive) return;
        setSummary(s);
        setPriorities(p?.items ?? []);
      } catch (e) { if (alive) setError(err(e)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [companyId]);

  if (loading) return <LoadingState label="กำลังโหลด..." />;
  if (error) return <ErrorBanner message={error} />;

  const cards = summary ? [
    { label: t('customers.open_deals', locale), value: summary.pipelineOpenCount },
    { label: t('customers.pipeline_value', locale), value: `฿${money(summary.pipelineTotalAmount)}` },
    { label: t('customers.followups_due_today', locale), value: summary.followUpsDueToday },
    { label: t('customers.overdue_tasks', locale), value: summary.followUpsOverdue },
    { label: t('customers.unassigned_leads', locale), value: summary.unassignedLeads },
    { label: t('customers.stuck_deals', locale), value: summary.stuckOpportunities },
  ] : [];

  return (
    <div className="space-y-6">
      {!summary && <Empty text={t('customers.no_crm_summary_permission', locale)} />}
      {summary && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {cards.map(c => (
            <div key={c.label} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs text-gray-500">{c.label}</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">{c.value}</div>
            </div>
          ))}
        </div>
      )}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('customers.priority_followups', locale)}</h2>
        {priorities.length === 0 ? <Empty text={t('customers.no_followups_to_do', locale)} /> : (
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {priorities.slice(0, 8).map((it: any) => (
              <div key={it.followUp.id} className="flex flex-wrap items-center justify-between px-4 py-2 text-sm">
                <div>
                  <div className="font-medium text-gray-900">{it.followUp.title}</div>
                  <div className="text-xs text-gray-500">{it.reason} · {t('customers.due_label', locale)} {shortDate(it.followUp.dueAt)}</div>
                </div>
                <span className="text-xs text-gray-400">{t('customers.score_label', locale)} {it.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Leads ─────────────────────────────────────────────────────────────────────
function Leads({ companyId }: { companyId: string }) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const empty = { rawName: '', rawPhone: '', rawEmail: '', note: '' };
  const [form, setForm] = useState(empty);
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    leadId: string;
    leadName: string;
    restricted: boolean;
    warnings: CrmDuplicateWarning[];
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const d = await listCrmLeads(companyId, {}); setRows(d.items ?? []); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setBusy('create'); setError(null);
    try { await createCrmLead(companyId, form); toast.success('บันทึกลีดเรียบร้อยแล้ว'); setForm(empty); setShowForm(false); await load(); }
    catch (e) { setError(err(e)); } finally { setBusy(null); }
  };
  const convert = async (id: string, existingCustomerId?: string) => {
    setBusy(id); setError(null);
    if (!existingCustomerId) setDuplicatePrompt(null);
    try {
      await convertCrmLead(companyId, id, { opportunityTitle: 'ดีลใหม่', existingCustomerId });
      toast.success(existingCustomerId ? 'เชื่อมลีดกับลูกค้าเรียบร้อยแล้ว' : 'เปลี่ยนลีดเป็นลูกค้าเรียบร้อยแล้ว');
      setDuplicatePrompt(null);
      await load();
    } catch (e) {
      const duplicate = customerDuplicateErrorState(e);
      if (duplicate) {
        const lead = rows.find((row) => row.id === id);
        setDuplicatePrompt({
          leadId: id,
          leadName: lead?.rawName ?? lead?.rawPhone ?? lead?.rawEmail ?? 'ลีดนี้',
          ...duplicate,
        });
      } else setError(err(e));
    } finally { setBusy(null); }
  };
  const disqualify = async (id: string) => {
    const reason = await promptInput({
      title: t('customers.disqualify', locale),
      label: t('customers.disqualify_reason_prompt', locale),
    });
    if (!reason) return;
    setBusy(id); setError(null);
    try { await disqualifyCrmLead(companyId, id, reason); toast.success('ตัดลีดออกเรียบร้อยแล้ว'); await load(); }
    catch (e) { setError(err(e)); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {duplicatePrompt && (
        <div className={`rounded-lg border p-4 ${duplicatePrompt.restricted ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className={`font-semibold ${duplicatePrompt.restricted ? 'text-red-800' : 'text-amber-900'}`}>
            {duplicatePrompt.restricted ? 'พบข้อมูลซ้ำที่คุณไม่มีสิทธิ์เปิด กรุณาให้ผู้จัดการตรวจสอบ' : `พบลูกค้าที่อาจเป็นคนเดียวกับ ${duplicatePrompt.leadName}`}
          </div>
          {!duplicatePrompt.restricted && (
            <div className="mt-3 space-y-2">
              {duplicatePrompt.warnings.map((warning) => (
                <div key={warning.customerId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-100 bg-white px-3 py-2">
                  <div>
                    <div className="font-medium text-gray-900">{warning.displayName}</div>
                    <div className="text-xs text-gray-500">
                      {warning.matchType === 'PHONE' ? 'เบอร์โทรตรงกัน' : warning.matchType === 'EMAIL' ? 'อีเมลตรงกัน' : warning.matchType === 'TAX_ID' ? 'เลขผู้เสียภาษีตรงกัน' : 'ชื่อตรงกัน'}
                      {' · '}{warning.status === 'ACTIVE' ? 'ใช้งาน' : 'ไม่ใช้งาน'}
                    </div>
                  </div>
                  <button className={btnClass} disabled={busy === duplicatePrompt.leadId} onClick={() => void convert(duplicatePrompt.leadId, warning.customerId)}>
                    {busy === duplicatePrompt.leadId ? 'กำลังเชื่อม...' : 'ใช้ลูกค้ารายนี้'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <Link href={`/companies/${companyId}/customers`} className="text-sm font-medium text-brand-700 hover:underline">เปิดฐานลูกค้า</Link>
            <button className={ghostClass} onClick={() => setDuplicatePrompt(null)}>ปิด</button>
          </div>
        </div>
      )}
      <div className="flex justify-end"><button className={btnClass} onClick={() => setShowForm(s => !s)}>{showForm ? t('customers.close', locale) : t('customers.add_lead', locale)}</button></div>
      {showForm && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-2">
          <input className={inputClass} placeholder={t('customers.name', locale)} value={form.rawName} onChange={e => setForm({ ...form, rawName: e.target.value })} />
          <input className={inputClass} placeholder={t('customers.phone', locale)} value={form.rawPhone} onChange={e => setForm({ ...form, rawPhone: e.target.value })} />
          <input className={inputClass} placeholder={t('customers.email', locale)} value={form.rawEmail} onChange={e => setForm({ ...form, rawEmail: e.target.value })} />
          <input className={inputClass} placeholder={t('customers.notes', locale)} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
          <div className="md:col-span-2"><button className={btnClass} disabled={busy === 'create'} onClick={create}>{t('customers.save', locale)}</button></div>
        </div>
      )}
      {loading ? <LoadingState label="กำลังโหลด..." />
        : rows.length === 0 ? <Empty text={t('customers.no_leads', locale)} />
        : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-4 py-2">{t('customers.col_name', locale)}</th><th className="px-4 py-2">{t('customers.col_channel', locale)}</th><th className="px-4 py-2">{t('customers.col_status', locale)}</th><th className="px-4 py-2" /></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((l: any) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2 font-medium text-gray-900">{l.rawName ?? l.rawPhone ?? l.rawEmail}</td>
                    <td className="px-4 py-2 text-gray-600">{l.source}</td>
                    <td className="px-4 py-2"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{l.status}</span></td>
                    <td className="px-4 py-2 text-right">
                      {l.status !== 'CONVERTED' && l.status !== 'DISQUALIFIED' && (
                        <span className="flex justify-end gap-2">
                          <button className={ghostClass} disabled={busy === l.id} onClick={() => convert(l.id)}>{t('customers.convert_to_customer', locale)}</button>
                          <button className={ghostClass} disabled={busy === l.id} onClick={() => disqualify(l.id)}>{t('customers.disqualify', locale)}</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {inputPromptDialog}
    </div>
  );
}

// ── Pipeline ──────────────────────────────────────────────────────────────────
function Pipeline({ companyId }: { companyId: string }) {
  const locale = useWorkspaceLocale();
  const [board, setBoard] = useState<any | null>(null);
  const [stages, setStages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [loadingOpportunityId, setLoadingOpportunityId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [b, s] = await Promise.all([getCrmBoard(companyId), listCrmStages(companyId)]);
      setBoard(b); setStages(s ?? []);
    } catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { void load(); }, [load]);

  const openOpportunity = async (opportunityId: string) => {
    setLoadingOpportunityId(opportunityId);
    try { setSelected(await getCrmOpportunity(companyId, opportunityId)); }
    catch (e) { setError(err(e)); }
    finally { setLoadingOpportunityId(null); }
  };

  if (loading) return <LoadingState label="กำลังโหลด..." />;
  if (error) return <ErrorBanner message={error} />;
  const columns = board?.columns ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-4 overflow-x-auto pb-2">
        {columns.map((col: any) => (
          <div key={col.stage.id} className="min-w-[220px] flex-1 rounded-lg bg-gray-50 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">{col.stage.name}</span>
              <span className="text-xs text-gray-400">{col.count} · ฿{money(col.totalAmount)}</span>
            </div>
            <div className="space-y-2">
              {col.opportunities.length === 0 ? <p className="text-xs text-gray-300">—</p>
                : col.opportunities.map((o: any) => {
                  const isLoading = loadingOpportunityId === o.id;
                  return (
                    <button key={o.id} disabled={isLoading} aria-busy={isLoading} onClick={() => void openOpportunity(o.id)}
                      className={`block w-full rounded border border-gray-200 bg-white p-2 text-left text-sm hover:border-brand-300 ${isLoading ? 'pointer-events-none opacity-60' : ''}`}>
                      <div className="font-medium text-gray-900">{o.title}</div>
                      <div className="text-xs text-gray-500">{o.customerDisplayName ?? ''} · ฿{money(o.amountEstimate)}</div>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      {selected && <OpportunityDetail companyId={companyId} opportunity={selected} stages={stages} onClose={() => setSelected(null)} onChange={load} />}
    </div>
  );
}

function OpportunityDetail({ companyId, opportunity, stages, onClose, onChange }: { companyId: string; opportunity: any; stages: any[]; onClose: () => void; onChange: () => void }) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [o, setO] = useState(opportunity);
  const refresh = async () => { setO(await getCrmOpportunity(companyId, o.id)); onChange(); };
  const move = async (stageId: string) => {
    setBusy(true); setError(null);
    try { await moveCrmOpportunityStage(companyId, o.id, stageId); toast.success('ย้ายดีลไปยังขั้นตอนที่เลือกเรียบร้อยแล้ว'); await refresh(); }
    catch (e) { setError(err(e)); } finally { setBusy(false); }
  };
  const close = async (result: 'WON' | 'LOST') => {
    const reason = await promptInput({
      title: t(result === 'LOST' ? 'customers.close_lost' : 'customers.close_won', locale),
      label: t(result === 'LOST' ? 'customers.lost_reason_prompt' : 'customers.won_reason_prompt', locale),
      variant: result === 'WON' ? 'primary' : 'danger',
    });
    if (!reason) return;
    setBusy(true); setError(null);
    try { await closeCrmOpportunity(companyId, o.id, { result, reason, winReason: result === 'WON' ? reason : undefined }); toast.success(result === 'WON' ? 'ปิดดีลโดยระบุว่าชนะเรียบร้อยแล้ว' : 'ปิดดีลโดยระบุว่าแพ้เรียบร้อยแล้ว'); await refresh(); }
    catch (e) { setError(err(e)); } finally { setBusy(false); }
  };
  const quote = async () => {
    setBusy(true); setError(null);
    try { await createCrmQuotationDraft(companyId, o.id, {}); toast.success('สร้างร่างใบเสนอราคาเรียบร้อยแล้ว'); await refresh(); }
    catch (e) { setError(err(e)); } finally { setBusy(false); }
  };
  const logActivity = async () => {
    const note = await promptInput({
      title: t('customers.log_activity', locale),
      label: t('customers.log_activity_prompt', locale),
      variant: 'primary',
    });
    if (!note) return;
    setBusy(true); setError(null);
    try { await createCrmActivity(companyId, { opportunityId: o.id, type: 'NOTE', note }); toast.success('บันทึกกิจกรรมเรียบร้อยแล้ว'); await refresh(); }
    catch (e) { setError(err(e)); } finally { setBusy(false); }
  };
  const open = o.status === 'OPEN';
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{o.title}</h3>
            <p className="text-xs text-gray-500">{o.customerDisplayName} · ฿{money(o.amountEstimate)} · {o.status}</p>
          </div>
          <button className={ghostClass} onClick={onClose}>{t('customers.close', locale)}</button>
        </div>
        {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
        {open && (
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs text-gray-500">{t('customers.move_to_stage', locale)}</label>
              <ThemedSelect className={inputClass} disabled={busy} value="" onChange={e => e.target.value && move(e.target.value)}>
                <option value="">{t('customers.select_stage', locale)}</option>
                {stages.filter(s => s.isActive && !s.isTerminalWon && !s.isTerminalLost).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </ThemedSelect>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <button className={btnClass} disabled={busy} onClick={quote}>{t('customers.create_quotation_draft', locale)}</button>
              <button className={ghostClass} disabled={busy} onClick={logActivity}>{t('customers.log_activity', locale)}</button>
              <button className={ghostClass} disabled={busy} onClick={() => close('WON')}>{t('customers.close_won', locale)}</button>
              <button className={ghostClass} disabled={busy} onClick={() => close('LOST')}>{t('customers.close_lost', locale)}</button>
            </div>
          </div>
        )}
        <div className="mt-5">
          <h4 className="mb-2 text-sm font-semibold text-gray-700">{t('customers.quotations', locale)}</h4>
          {(o.quotationLinks ?? []).length === 0 ? <p className="text-xs text-gray-400">{t('customers.no_quotations', locale)}</p>
            : <ul className="space-y-1 text-sm">{o.quotationLinks.map((q: any) => <li key={q.id}>{q.accountingDocumentNumber ?? q.accountingDocumentId} · {q.status}</li>)}</ul>}
        </div>
        <div className="mt-5">
          <h4 className="mb-2 text-sm font-semibold text-gray-700">{t('customers.activity_timeline', locale)}</h4>
          {(o.activities ?? []).length === 0 ? <p className="text-xs text-gray-400">{t('customers.no_activities', locale)}</p>
            : <ul className="space-y-1 text-sm">{o.activities.map((a: any) => <li key={a.id} className="text-gray-600"><span className="text-xs text-gray-400">{shortDate(a.occurredAt)}</span> · {a.note}</li>)}</ul>}
        </div>
      </div>
      {inputPromptDialog}
    </div>
  );
}

// ── Follow-ups ────────────────────────────────────────────────────────────────
function FollowUps({ companyId }: { companyId: string }) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const [view, setView] = useState<'due_today' | 'overdue' | 'upcoming'>('due_today');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const empty = { title: '', dueAt: '', priority: 'NORMAL', channel: 'PHONE', customerId: '' };
  const [form, setForm] = useState(empty);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const d = await listCrmFollowUps(companyId, { view }); setRows(d.items ?? []); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId, view]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setBusy('create'); setError(null);
    try { await createCrmFollowUp(companyId, { ...form, dueAt: new Date(form.dueAt).toISOString() }); toast.success('บันทึกงานติดตามเรียบร้อยแล้ว'); setForm(empty); setShowForm(false); await load(); }
    catch (e) { setError(err(e)); } finally { setBusy(null); }
  };
  const complete = async (id: string) => {
    setBusy(id); setError(null);
    try { await completeCrmFollowUp(companyId, id, {}); toast.success('ทำงานติดตามเสร็จสิ้นเรียบร้อยแล้ว'); await load(); }
    catch (e) { setError(err(e)); } finally { setBusy(null); }
  };

  const views: { key: typeof view; label: string }[] = [
    { key: 'due_today', label: t('customers.view_today', locale) }, { key: 'overdue', label: t('customers.view_overdue', locale) }, { key: 'upcoming', label: t('customers.view_upcoming', locale) },
  ];

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      <div className="flex flex-wrap items-center justify-between">
        <div className="flex gap-2">
          {views.map(v => (
            <button key={v.key} onClick={() => setView(v.key)}
              className={`rounded px-3 py-1 text-sm ${view === v.key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{v.label}</button>
          ))}
        </div>
        <button className={btnClass} onClick={() => setShowForm(s => !s)}>{showForm ? t('customers.close', locale) : t('customers.add_followup', locale)}</button>
      </div>
      {showForm && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-2">
          <input className={inputClass} placeholder={t('customers.title_required', locale)} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <input className={inputClass} type="datetime-local" value={form.dueAt} onChange={e => setForm({ ...form, dueAt: e.target.value })} />
          <ThemedSelect className={inputClass} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
            {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map(p => <option key={p} value={p}>{p}</option>)}
          </ThemedSelect>
          <input className={inputClass} placeholder={t('customers.customer_id_optional', locale)} value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })} />
          <div className="md:col-span-2"><button className={btnClass} disabled={busy === 'create' || !form.title.trim() || !form.dueAt} onClick={create}>{t('customers.save', locale)}</button></div>
        </div>
      )}
      {loading ? <LoadingState label="กำลังโหลด..." />
        : rows.length === 0 ? <Empty text={t('customers.no_followups', locale)} />
        : (
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {rows.map((f: any) => (
              <div key={f.id} className="flex flex-wrap items-center justify-between px-4 py-2 text-sm">
                <div>
                  <div className="font-medium text-gray-900">{f.title}</div>
                  <div className="text-xs text-gray-500">{t('customers.due_label', locale)} {shortDate(f.dueAt)} · {f.priority} · {f.status}</div>
                </div>
                {f.status !== 'DONE' && f.status !== 'CANCELED' && (
                  <button className={ghostClass} disabled={busy === f.id} onClick={() => complete(f.id)}>{t('customers.done', locale)}</button>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
