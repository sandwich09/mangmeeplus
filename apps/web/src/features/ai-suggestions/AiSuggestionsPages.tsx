'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import {
  listAiSuggestions,
  getAiSuggestion,
  listAiTemplates,
  getAiProviderStatus,
  requestAiSuggestion,
  validateAiAction,
  createAiSourceDraft,
  reviewAiSuggestion,
} from './ai-suggestions.api';
import {
  SUGGESTION_TABS,
  permittedUsageGuidance,
  aiActionLabel,
  aiActionStatusLabel,
  aiDraftPayloadSummary,
  aiNeedsDataReason,
  aiReviewDecisionLabel,
  aiRiskLabel,
  aiSuggestionSummaryText,
  aiSuggestionStatusLabel,
  aiValidationResultLabel,
  aiVisibleDetailSummary,
  canCreateSourceDraft,
  filterSuggestionsForTab,
  formatConfidencePct,
} from './ai-suggestions.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { useToast } from '@/common/components/toast';
import { Modal as SharedModal } from '@/common/components/modal';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { Notice } from '@/common/components/notice';
import { primaryButtonClass, secondaryButtonClass } from '@/common/components/button/button-classes';

// The shared looks (one height, one weight); this page used to carry its own two.
const btnClass = primaryButtonClass;
const ghostClass = secondaryButtonClass;
const inputClass = 'mangmee-input';

function err(e: unknown) { return apiErrorMessage(e); }

const RISK_COLOR: Record<string, string> = { HIGH: 'bg-red-100 text-red-700', MEDIUM: 'bg-amber-100 text-amber-700', LOW: 'bg-gray-100 text-gray-600' };
const STATUS_COLOR: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700', IN_REVIEW: 'bg-indigo-100 text-indigo-700',
  ACCEPTED_FOR_SOURCE_DRAFT: 'bg-emerald-100 text-emerald-700', SOURCE_DRAFT_CREATED: 'bg-emerald-100 text-emerald-800',
  DISMISSED: 'bg-gray-100 text-gray-500', SUPERSEDED: 'bg-gray-100 text-gray-500', EXPIRED: 'bg-gray-100 text-gray-500',
  BLOCKED_BY_SOURCE_STATE: 'bg-orange-100 text-orange-700', BLOCKED_BY_PERMISSION: 'bg-red-100 text-red-700', FAILED: 'bg-red-100 text-red-700',
};

function Badge({ text, cls }: { text: string; cls: string }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{text}</span>;
}
function ErrorBanner({ message }: { message: string }) {
  return <Notice tone="error">{message}</Notice>;
}

/** The work this person can do in the app, as rows a thumb can press (they were 20 px text links inside a closed arrow). */
function TaskLinks({ companyId, items }: { companyId: string; items: ReturnType<typeof permittedUsageGuidance> }) {
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((item) => <li key={item.path}>
        <Link className="flex min-h-11 items-center justify-between gap-3 py-3" href={`/companies/${companyId}/${item.path}`}>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-brand-700">{item.title}</span>
            <span className="mt-0.5 block text-sm text-gray-600">{item.help}</span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-xl text-gray-400">›</span>
        </Link>
      </li>)}
    </ul>
  );
}

const TABS = SUGGESTION_TABS;

export function AiSuggestionsHubPage({ companyId, permissions = [], canOpenManualExpense }: {
  companyId: string; permissions?: string[];
  /** `canOpenManualWeb` of the server session; left out, the permission decides. */
  canOpenManualExpense?: boolean;
}) {
  const guidance = permittedUsageGuidance(permissions, canOpenManualExpense);
  const canRequest = permissions.some((key) => ['ai.suggestion.request', 'ai.draft.request'].includes(key));
  const [tab, setTab] = useState<string>('new');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [provider, setProvider] = useState<{ mode: string; available: boolean; reason?: string } | null>(null);
  const [showRequest, setShowRequest] = useState(false);
  // Read once: whether this shop can ask for anything, and whether anything was ever suggested. With neither there is
  // no list to show and no request to make (every sold package today), so the page says so instead of offering a
  // button that opens an empty dialog. `undefined` = still reading; `null` = the read failed, and the page stays as it was.
  const [askable, setAskable] = useState<boolean | null | undefined>(undefined);
  const [hasAny, setHasAny] = useState<boolean | null | undefined>(undefined);

  const active = TABS.find((t) => t.key === tab)!;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await listAiSuggestions(companyId, { status: active.status, scope: 'all', pageSize: 100 });
      setRows(filterSuggestionsForTab(r.items, active));
    } catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId, active]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getAiProviderStatus(companyId).then(setProvider).catch(() => undefined); }, [companyId]);
  useEffect(() => {
    let current = true;
    listAiTemplates(companyId).then((list) => { if (current) setAskable(list.some((item) => item.enabled)); }).catch(() => { if (current) setAskable(null); });
    listAiSuggestions(companyId, { scope: 'all', pageSize: 1 }).then((page) => { if (current) setHasAny(page.total > 0 || page.items.length > 0); }).catch(() => { if (current) setHasAny(null); });
    return () => { current = false; };
  }, [companyId]);

  // One loading line until the page knows which of its two shapes it has (no flash of seven tabs that then vanish).
  if (askable === undefined || hasAny === undefined) {
    return <MangmeePage title="คำแนะนำจาก AI"><p className="text-sm text-gray-500" role="status">กำลังโหลด…</p></MangmeePage>;
  }

  if (askable === false && hasAny === false) {
    return (
      <MangmeePage title="คำแนะนำจาก AI">
        <p className="text-sm text-gray-600">ยังไม่มีคำแนะนำจาก AI สำหรับร้านนี้</p>
        {guidance.length > 0 && (
          <MangmeeCard className="mt-4 p-4">
            <h2 className="text-base font-bold text-gray-900">งานที่คุณทำได้ในระบบ</h2>
            <TaskLinks companyId={companyId} items={guidance} />
          </MangmeeCard>
        )}
      </MangmeePage>
    );
  }

  return (
    <MangmeePage
      title="คำแนะนำจาก AI"
      description={askable ? 'เลือกเรื่องที่ต้องการให้ช่วย คุณจะได้ตรวจและยืนยันก่อนสร้างร่างในระบบ' : undefined}
      // No button for someone who cannot ask, or when nothing can be asked: a dead button teaches nothing.
      actions={canRequest && askable !== false ? <button type="button" className={btnClass} onClick={() => setShowRequest(true)}>ขอคำแนะนำ</button> : undefined}
    >
      <div className="space-y-5">
      {provider && !provider.available && askable !== false && (
        <Notice tone="warning">ตอนนี้ AI ยังสร้างคำแนะนำใหม่ไม่ได้ คำแนะนำเดิมยังเปิดอ่านได้</Notice>
      )}

      {guidance.length > 0 && (
        <details className="rounded-lg border border-gray-200 bg-white px-4 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-gray-900">งานที่คุณทำได้ในระบบ</summary>
          <TaskLinks companyId={companyId} items={guidance} />
        </details>
      )}

      <div className="flex gap-2 overflow-x-auto border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} />}
      {loading ? (
        <div className="text-sm text-gray-500">กำลังโหลด…</div>
      ) : rows.length === 0 ? (
        <div className="rounded border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500"><p>ยังไม่มีคำแนะนำในหมวดนี้</p>{canRequest && askable !== false && <p className="mt-2">กด “ขอคำแนะนำ” ด้านบน แล้วเลือกเรื่องที่ต้องการให้ช่วย</p>}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">ความเสี่ยง</th>
                <th className="px-4 py-3">หัวข้อ</th>
                <th className="px-4 py-3">ที่มา</th>
                <th className="px-4 py-3">อ้างอิง</th>
                <th className="px-4 py-3">ความมั่นใจ</th>
                <th className="px-4 py-3">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setDetailId(s.id)}>
                  <td className="px-4 py-3"><Badge text={aiRiskLabel(s.riskLevel)} cls={RISK_COLOR[s.riskLevel] ?? RISK_COLOR.LOW!} /></td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-brand-700">{s.title}</div>
                    <div className="max-w-md truncate text-xs text-gray-500">{aiSuggestionSummaryText(s.summary, s.needsData)}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{s.sourceModule ?? '-'}</td>
                  <td className="px-4 py-3">{s.citationCount}</td>
                  <td className="px-4 py-3">{formatConfidencePct(s.confidence)}</td>
                  <td className="px-4 py-3">
                    <Badge text={aiSuggestionStatusLabel(s.status)} cls={STATUS_COLOR[s.status] ?? 'bg-gray-100 text-gray-600'} />
                    {s.needsData && <span className="ml-1"><Badge text="ต้องการข้อมูล" cls="bg-yellow-100 text-yellow-700" /></span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailId && <SuggestionDetailModal companyId={companyId} id={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
      {showRequest && <RequestModal companyId={companyId} onClose={() => setShowRequest(false)} onDone={load} />}
      </div>
    </MangmeePage>
  );
}

function RequestModal({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateKey, setTemplateKey] = useState('');
  const [sourceRecordId, setSourceRecordId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  useEffect(() => { listAiTemplates(companyId).then((t) => { setTemplates(t); setTemplateKey(t.find((x) => x.enabled)?.key ?? ''); }).catch((e) => setError(err(e))).finally(() => setLoadingTemplates(false)); }, [companyId]);
  const selected = templates.find((t) => t.key === templateKey);
  const needsCustomer = templateKey === 'crm_followup_next_action';

  const submit = async () => {
    if (!selected?.enabled || (needsCustomer && !sourceRecordId.trim())) return;
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = { templateKey };
      if (needsCustomer && sourceRecordId) { body.sourceModule = 'crm'; body.sourceRecordType = 'customer'; body.sourceRecordId = sourceRecordId; }
      await requestAiSuggestion(companyId, body);
      setDone(true);
      await onDone();
    } catch (e) { setError(err(e)); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="ขอคำแนะนำจาก AI"
      footer={done
        ? <button type="button" className={ghostClass} onClick={onClose}>ปิด</button>
        : <>
          <button type="button" className={ghostClass} onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="button" className={btnClass} onClick={submit} disabled={busy || loadingTemplates || !selected?.enabled || (needsCustomer && !sourceRecordId.trim())} aria-busy={Boolean(busy)}>ส่งคำขอ</button>
        </>}>
      {error && <ErrorBanner message={error} />}
      {done ? (
        <Notice tone="success">ส่งคำขอแล้ว คำแนะนำจะขึ้นในรายการเมื่อสร้างเสร็จ</Notice>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-gray-600">เรื่องที่ต้องการคำแนะนำ</label>
            {loadingTemplates && <p className="text-sm text-gray-500">กำลังตรวจงานที่ขอคำแนะนำได้...</p>}
            {!loadingTemplates && !error && templates.length === 0 && <p className="text-sm text-gray-600">ยังไม่มีคำขอ AI ที่รองรับสิทธิ์ปัจจุบัน ใช้วิธีใช้งานตามสิทธิ์บนหน้าหลักได้</p>}
            <ThemedSelect aria-label="เรื่องที่ต้องการคำแนะนำ" disabled={loadingTemplates || templates.length === 0} className={inputClass} value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
              {templates.map((t) => <option key={t.key} value={t.key} disabled={!t.enabled}>{t.title}{t.enabled ? '' : ` (${t.unavailableReason ?? 'ไม่พร้อมใช้งาน'})`}</option>)}
            </ThemedSelect>
            {selected && <p className="mt-1 text-xs text-gray-500">{selected.description}</p>}
          </div>
          {needsCustomer && (
            <div>
              <label className="mb-1 block text-sm text-gray-600" htmlFor="ai-request-customer">รหัสลูกค้า</label>
              <input id="ai-request-customer" className={inputClass} value={sourceRecordId} onChange={(e) => setSourceRecordId(e.target.value)} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function SuggestionDetailModal({ companyId, id, onClose, onChanged }: { companyId: string; id: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [d, setD] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setD(await getAiSuggestion(companyId, id)); } catch (e) { setError(err(e)); }
  }, [companyId, id]);
  useEffect(() => { load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setBusy(key); setError(null);
    try { await fn(); if (successMessage) toast.success(successMessage); await load(); await onChanged(); } catch (e) { setError(err(e)); } finally { setBusy(null); }
  };

  if (!d) return <Modal onClose={onClose} title="รายละเอียดคำแนะนำ">{error ? <ErrorBanner message={error} /> : <div className="text-sm text-gray-500">กำลังโหลด...</div>}</Modal>;

  const actionable = ['NEW', 'IN_REVIEW', 'ACCEPTED_FOR_SOURCE_DRAFT'].includes(d.status);
  const visibleSummary = aiVisibleDetailSummary(d.summary, d.needsDataReasons ?? []);
  return (
    <Modal onClose={onClose} title={d.title} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge text={aiRiskLabel(d.riskLevel)} cls={RISK_COLOR[d.riskLevel] ?? RISK_COLOR.LOW!} />
          <Badge text={aiSuggestionStatusLabel(d.status)} cls={STATUS_COLOR[d.status] ?? 'bg-gray-100 text-gray-600'} />
          <span className="text-xs text-gray-500">ความมั่นใจ {formatConfidencePct(d.confidence)}</span>
          {d.expiresAt && <span className="text-xs text-gray-500">หมดอายุ {formatThaiDateTime(d.expiresAt)}</span>}
        </div>

        {error && <ErrorBanner message={error} />}
        {d.sourceStateChanged && (
          <div className="rounded border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">⚠️ ข้อมูลต้นทางเปลี่ยนหลังสร้างคำแนะนำ — ต้องสร้างใหม่หรือยืนยันก่อนสร้างร่าง</div>
        )}
        {d.needsDataReasons?.length > 0 && (
          <div className="rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            <div className="font-medium">ต้องการข้อมูลเพิ่ม</div>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {d.needsDataReasons.map((reason: string) => <li key={reason}>{aiNeedsDataReason(reason)}</li>)}
            </ul>
            <details className="mt-2 text-xs text-yellow-700">
              <summary className="cursor-pointer">รายละเอียดสำหรับฝ่ายสนับสนุน</summary>
              <div className="mt-1 break-words">{d.needsDataReasons.join('; ')}</div>
            </details>
          </div>
        )}

        {visibleSummary && <Section title="สรุป"><p className="whitespace-pre-wrap break-words text-sm text-gray-700">{visibleSummary}</p></Section>}
        {d.recommendation && <Section title="คำแนะนำ"><p className="whitespace-pre-wrap break-words text-sm text-gray-700">{d.recommendation}</p></Section>}

        <Section title={`แหล่งอ้างอิง (${d.citations?.length ?? 0})`}>
          {(d.citations ?? []).length === 0 ? <p className="text-xs text-gray-400">ไม่มีการอ้างอิง</p> : (
            <ul className="space-y-1 text-sm">
              {d.citations.map((c: any) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-100 px-2 py-1">
                  <span className="text-gray-700">{c.label}{c.valuePreview ? ` — ${c.valuePreview}` : ''}</span>
                  {c.webDeepLink && <a className="shrink-0 text-xs text-brand-700 hover:underline" href={c.webDeepLink}>เปิด</a>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="การดำเนินการที่เสนอ">
          {(d.candidateActions ?? []).map((a: any) => {
            const payload = aiDraftPayloadSummary(a.draftPayloadJson);
            const validationLabel = aiValidationResultLabel(a.validationResultJson);
            return <div key={a.id} className="mb-2 rounded border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between">
                <span className="font-medium text-gray-800">{aiActionLabel(a.actionType)}</span>
                <Badge text={aiActionStatusLabel(a.status)} cls="bg-gray-100 text-gray-600" />
              </div>
              {payload.title && <p className="mt-2 text-sm text-gray-700">{payload.title}</p>}
              {payload.items.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {payload.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
              <details className="mt-2 text-xs text-gray-500">
                <summary className="cursor-pointer">รายละเอียดสำหรับฝ่ายสนับสนุน</summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-600">{JSON.stringify(a.draftPayloadJson, null, 2)}</pre>
                {a.validationResultJson && <pre className="mt-1 max-h-40 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-600">{JSON.stringify(a.validationResultJson, null, 2)}</pre>}
              </details>
              {validationLabel && <p className="mt-1 text-xs text-gray-500">ผลตรวจสอบ: {validationLabel}</p>}
              {canCreateSourceDraft(d.status, a.actionType, a.status, d.needsData) && (
                <div className="mt-2 flex gap-2">
                  <button className={ghostClass} disabled={busy !== null} aria-busy={Boolean(busy !== null)} onClick={() => run(`v-${a.id}`, () => validateAiAction(companyId, d.id, a.id), 'ตรวจสอบการดำเนินการเรียบร้อยแล้ว')}>ตรวจสอบ</button>
                  <button className={btnClass} disabled={busy !== null} aria-busy={Boolean(busy !== null)} onClick={() => run(`c-${a.id}`, () => createAiSourceDraft(companyId, d.id, a.id, d.sourceStateChanged ? { acknowledgeSourceStateChanged: true } : {}), 'สร้างร่างในระบบเรียบร้อยแล้ว')}>สร้างร่างในระบบ</button>
                </div>
              )}
              {a.status === 'SOURCE_DRAFT_CREATED' && <p className="mt-2 text-xs text-emerald-600">สร้างร่างในระบบต้นทางแล้ว</p>}
            </div>;
          })}
        </Section>

        {(d.reviews ?? []).length > 0 && (
          <Section title="ประวัติการรีวิว">
            <ul className="space-y-1 text-xs text-gray-600">
              {d.reviews.map((r: any) => (
                <li key={r.id}>{formatThaiDateTime(r.createdAt)} — {aiReviewDecisionLabel(r.decision)}{r.sourceDraftDeepLink ? <> · <a className="text-brand-700 hover:underline" href={r.sourceDraftDeepLink}>ร่างที่สร้าง</a></> : null}</li>
              ))}
            </ul>
          </Section>
        )}

        {actionable && (
          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button className={ghostClass} disabled={busy !== null} aria-busy={Boolean(busy !== null)} onClick={() => run('regen', () => reviewAiSuggestion(companyId, d.id, { decision: 'REQUEST_REGENERATION' }), 'ขอสร้างคำแนะนำใหม่เรียบร้อยแล้ว')}>สร้างใหม่</button>
            <button className={ghostClass} disabled={busy !== null} aria-busy={Boolean(busy !== null)} onClick={() => run('dismiss', () => reviewAiSuggestion(companyId, d.id, { decision: 'DISMISS', note: 'dismissed from web' }), 'ปิดคำแนะนำเรียบร้อยแล้ว')}>ปิดคำแนะนำ</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-gray-800">{title}</h3>
      {children}
    </div>
  );
}

function Modal({ title, children, onClose, wide, footer }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; footer?: React.ReactNode }) {
  return <SharedModal open title={title} onClose={onClose} size={wide ? 'lg' : 'sm'} footer={footer}>{children}</SharedModal>;
}
