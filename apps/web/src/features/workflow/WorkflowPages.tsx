'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ForbiddenState } from '@/common/components/state';
import {
  listWorkflowTemplates, enableWorkflowTemplate,
  listWorkflowRules, getWorkflowRule, updateWorkflowRule, enableWorkflowRule, disableWorkflowRule, testWorkflowRule,
  listWorkflowRuns, getWorkflowRun, explainWorkflowRun, replayWorkflowActionRun,
  listWorkflowTasks, snoozeWorkflowTask, completeWorkflowTask, cancelWorkflowTask,
  listWorkflowDeadLetters, replayWorkflowDeadLetter, ignoreWorkflowDeadLetter,
  listWorkflowWebhooks, createWorkflowWebhook, enableWorkflowWebhook, disableWorkflowWebhook,
} from './workflow.api';
import {
  TEMPLATE_STATUS_LABELS, RULE_STATUS_LABELS, RUN_STATUS_LABELS, ACTION_RUN_STATUS_LABELS,
  TASK_STATUS_LABELS, TASK_PRIORITY_LABELS, DEAD_LETTER_RESOLUTION_LABELS, STATUS_BADGE_COLORS,
  PRIORITY_BADGE_COLORS, TRIGGER_TYPE_LABELS,
} from './workflow.model';
import {
  validateWebhookForm,
  parseAllowedEventTypes,
  parseJsonSafely,
  formatDateTime,
  visibleWorkflowTabs,
  parseWorkflowTab,
  type WorkflowTab,
} from './workflow.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { LoadingState } from '@/common/components/state/LoadingState';
import { useToast } from '@/common/components/toast';
import { useConfirm } from '@/common/components/modal';

function err(e: unknown) { return apiErrorMessage(e); }
const inputClass = 'mangmee-input';
const btnClass = 'mangmee-btn mangmee-btn-primary disabled:opacity-50';
const ghostClass = 'rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const dangerClass = 'rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50';
const WORKFLOW_TAB_LABELS: Record<WorkflowTab, string> = {
  templates: 'เทมเพลต',
  rules: 'กฎอัตโนมัติ',
  runs: 'ประวัติการทำงาน',
  tasks: 'งานที่มอบหมาย',
  'dead-letters': 'ข้อผิดพลาดค้าง',
  webhooks: 'Webhook',
};

function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_COLORS[status] ?? 'bg-gray-100 text-gray-600'}`}>{labels[status] ?? status}</span>;
}
function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGE_COLORS[priority] ?? 'bg-gray-100 text-gray-600'}`}>{TASK_PRIORITY_LABELS[priority] ?? priority}</span>;
}
function ErrorBanner({ message }: { message: string }) {
  return <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>;
}

export function WorkflowHubPage({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const searchParams = useSearchParams();
  const tabs = useMemo(() => visibleWorkflowTabs(permissions), [permissions]);
  // Initial tab only: later clicks are not overwritten by the original deep link.
  const [tab, setTab] = useState<WorkflowTab>(() => parseWorkflowTab(searchParams.get('tab'), tabs));

  if (tabs.length === 0) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ระบบอัตโนมัติ (Workflow Automation)</h1>
          <p className="text-sm text-gray-500">กฎที่ตั้งค่าไว้จะแจ้งเตือนและสร้างงานให้อัตโนมัติ แต่ไม่สามารถอนุมัติ โอนเงิน ตัดสต๊อก หรือยื่นภาษีแทนคุณได้</p>
        </div>
        <ForbiddenState description="บัญชีนี้ยังไม่มีสิทธิ์ใช้งานหน้าระบบอัตโนมัติ" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ระบบอัตโนมัติ (Workflow Automation)</h1>
        <p className="text-sm text-gray-500">กฎที่ตั้งค่าไว้จะแจ้งเตือนและสร้างงานให้อัตโนมัติ แต่ไม่สามารถอนุมัติ โอนเงิน ตัดสต๊อก หรือยื่นภาษีแทนคุณได้</p>
      </div>
      <div className="flex gap-2 overflow-x-auto border-b border-gray-200">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {WORKFLOW_TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {tab === 'templates' && <TemplatesTab companyId={companyId} />}
      {tab === 'rules' && <RulesTab companyId={companyId} />}
      {tab === 'runs' && <RunsTab companyId={companyId} />}
      {tab === 'tasks' && <TasksTab companyId={companyId} />}
      {tab === 'dead-letters' && <DeadLettersTab companyId={companyId} />}
      {tab === 'webhooks' && <WebhooksTab companyId={companyId} />}
    </div>
  );
}

// ── Templates ──────────────────────────────────────────────────────────────────
function TemplatesTab({ companyId }: { companyId: string }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabling, setEnabling] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await listWorkflowTemplates(companyId)); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((t) => (
            <div key={t.id} className="rounded border border-gray-200 p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between">
                <span className="font-medium text-gray-900">{t.name}</span>
                <StatusBadge status={t.status} labels={TEMPLATE_STATUS_LABELS} />
              </div>
              <p className="text-xs text-gray-500">{t.description}</p>
              <div className="text-xs text-gray-400">Trigger: {TRIGGER_TYPE_LABELS[t.triggerType] ?? t.triggerType} · Source: {t.sourceModule}</div>
              {t.status === 'UNAVAILABLE' && t.unavailableReason && <p className="text-xs text-red-500">{t.unavailableReason}</p>}
              {t.status === 'AVAILABLE' && (
                <button className={ghostClass} onClick={() => setEnabling(t)}>เปิดใช้งาน</button>
              )}
            </div>
          ))}
          {data.length === 0 && <div className="text-sm text-gray-400">ไม่มีเทมเพลต</div>}
        </div>
      )}
      {enabling && (
        <EnableTemplateModal companyId={companyId} template={enabling} onClose={() => setEnabling(null)} onDone={async () => { setEnabling(null); await load(); }} />
      )}
    </div>
  );
}

function EnableTemplateModal({ companyId, template, onClose, onDone }: { companyId: string; template: any; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(template.name);
  const [cooldownSeconds, setCooldownSeconds] = useState('3600');
  const [activate, setActivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await enableWorkflowTemplate(companyId, template.key, { name, cooldownSeconds: Number(cooldownSeconds), activate });
      toast.success('เปิดใช้งานเทมเพลตเรียบร้อยแล้ว');
      await onDone();
    } catch (e) { setError(err(e)); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <form className="w-full max-w-md space-y-3 rounded bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="text-lg font-semibold text-gray-900">เปิดใช้งาน: {template.name}</h2>
        {error && <ErrorBanner message={error} />}
        <label className="block text-sm">
          <span className="mb-1 block text-gray-600">ชื่อกฎ</span>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-gray-600">คูลดาวน์ (วินาที)</span>
          <input className={inputClass} type="number" min="0" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
          เปิดใช้งานทันที (ไม่เลือก = บันทึกเป็นร่างก่อน)
        </label>
        <p className="text-xs text-gray-400">การกระทำที่ไม่ปลอดภัย (เช่น อนุมัติ โอนเงิน) จะกลายเป็นงาน/คำขอตรวจสอบเท่านั้น ไม่ใช่การอนุมัติจริง</p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={ghostClass} onClick={onClose}>ยกเลิก</button>
          <button type="submit" className={btnClass} disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        </div>
      </form>
    </div>
  );
}

// ── Rules ──────────────────────────────────────────────────────────────────────
function RulesTab({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await listWorkflowRules(companyId); setData(r.items ?? []); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (rule: any) => {
    setBusy(rule.id); setError(null);
    try {
      if (rule.status === 'ENABLED') await disableWorkflowRule(companyId, rule.id);
      else await enableWorkflowRule(companyId, rule.id);
      toast.success(rule.status === 'ENABLED' ? 'ปิดใช้งานกฎเรียบร้อยแล้ว' : 'เปิดใช้งานกฎเรียบร้อยแล้ว');
      await load();
    } catch (e) { setError(err(e)); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">ชื่อกฎ</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3">รันล่าสุด</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 cursor-pointer text-brand-700" onClick={() => setDetailId(r.id)}>{r.name}</td>
                  <td className="px-4 py-3 text-gray-500">{TRIGGER_TYPE_LABELS[r.triggerType] ?? r.triggerType}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} labels={RULE_STATUS_LABELS} /></td>
                  <td className="px-4 py-3 text-gray-500">{r.lastRunAt ? `${formatDateTime(r.lastRunAt)} (${RUN_STATUS_LABELS[r.lastRunStatus] ?? r.lastRunStatus})` : '-'}</td>
                  <td className="px-4 py-3">
                    {r.status !== 'ARCHIVED' && (
                      <button className={ghostClass} disabled={busy === r.id} onClick={() => toggle(r)}>
                        {r.status === 'ENABLED' ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">ยังไม่มีกฎ</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {detailId && <RuleDetailModal companyId={companyId} ruleId={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
    </div>
  );
}

function RuleDetailModal({ companyId, ruleId, onClose, onChanged }: { companyId: string; ruleId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [rule, setRule] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conditionJson, setConditionJson] = useState('');
  const [actionJson, setActionJson] = useState('');
  const [samplePayload, setSamplePayload] = useState('{}');
  const [testResult, setTestResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getWorkflowRule(companyId, ruleId);
      setRule(r);
      setConditionJson(JSON.stringify(r.conditionJson, null, 2));
      setActionJson(JSON.stringify(r.actionJson, null, 2));
    } catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId, ruleId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true); setError(null);
    const condition = parseJsonSafely(conditionJson);
    const action = parseJsonSafely(actionJson);
    if (condition.error) { setError(`Condition: ${condition.error}`); setBusy(false); return; }
    if (action.error) { setError(`Action: ${action.error}`); setBusy(false); return; }
    try {
      await updateWorkflowRule(companyId, ruleId, { conditionJson: condition.value, actionJson: action.value });
      toast.success('บันทึกแบบร่างเรียบร้อยแล้ว');
      await load(); await onChanged();
    } catch (e) { setError(err(e)); } finally { setBusy(false); }
  };

  const runTest = async () => {
    setError(null);
    const sample = parseJsonSafely(samplePayload);
    if (sample.error) { setError(sample.error); return; }
    setBusy(true);
    try { setTestResult(await testWorkflowRule(companyId, ruleId, sample.value as Record<string, unknown>)); }
    catch (e) { setError(err(e)); }
    finally { setBusy(false); }
  };

  if (!rule || loading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-4 rounded bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {loading ? <LoadingState label="กำลังโหลด..." /> : (
          <>
            {error && <ErrorBanner message={error} />}
            <div className="flex justify-end">
              <button className={ghostClass} onClick={onClose}>ปิด</button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-4 rounded bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{rule.name}</h2>
          <StatusBadge status={rule.status} labels={RULE_STATUS_LABELS} />
        </div>
        {error && <ErrorBanner message={error} />}
        <div>
          <label className="mb-1 block text-sm text-gray-600">Condition JSON (แก้ไขได้เมื่อยังไม่เปิดใช้งาน หรือเปิดใช้งานใหม่หลังแก้ไข)</label>
          <textarea className={`${inputClass} font-mono`} rows={6} value={conditionJson} onChange={(e) => setConditionJson(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600">Action JSON</label>
          <textarea className={`${inputClass} font-mono`} rows={8} value={actionJson} onChange={(e) => setActionJson(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button className={ghostClass} onClick={save} disabled={busy}>บันทึกแบบร่าง</button>
        </div>
        <hr />
        <div>
          <label className="mb-1 block text-sm text-gray-600">ทดสอบ (ไม่มีผลกระทบจริง — ไม่ส่งแจ้งเตือน/สร้างงาน)</label>
          <textarea className={`${inputClass} font-mono`} rows={3} value={samplePayload} onChange={(e) => setSamplePayload(e.target.value)} />
          <button className={`${ghostClass} mt-2`} disabled={busy} onClick={runTest}>{busy ? 'กำลังดำเนินการ...' : 'ทดสอบเงื่อนไข'}</button>
          {testResult && (
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700">{JSON.stringify(testResult, null, 2)}</pre>
          )}
        </div>
        <div className="flex justify-end">
          <button className={ghostClass} onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

// ── Runs ───────────────────────────────────────────────────────────────────────
function RunsTab({ companyId }: { companyId: string }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await listWorkflowRuns(companyId); setData(r.items ?? []); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">กฎ</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">แหล่งข้อมูล</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3">เวลา</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setDetailId(r.id)}>
                  <td className="px-4 py-3 text-blue-600">{r.ruleName}</td>
                  <td className="px-4 py-3 text-gray-500">{TRIGGER_TYPE_LABELS[r.triggerType] ?? r.triggerType}</td>
                  <td className="px-4 py-3 text-gray-500">{r.sourceModule ?? '-'} {r.sourceId ? `#${r.sourceId.slice(-6)}` : ''}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} labels={RUN_STATUS_LABELS} /></td>
                  <td className="px-4 py-3 text-gray-500">{formatDateTime(r.createdAt)}</td>
                </tr>
              ))}
              {data.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">ยังไม่มีประวัติการทำงาน</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {detailId && <RunDetailModal companyId={companyId} runId={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
    </div>
  );
}

function RunDetailModal({ companyId, runId, onClose, onChanged }: { companyId: string; runId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [run, setRun] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [explanation, setExplanation] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, ex] = await Promise.all([getWorkflowRun(companyId, runId), explainWorkflowRun(companyId, runId)]);
      setRun(r); setExplanation(ex);
    } catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId, runId]);
  useEffect(() => { load(); }, [load]);

  const replay = async (actionRunId: string) => {
    setBusy(actionRunId); setError(null);
    try { await replayWorkflowActionRun(companyId, actionRunId); toast.success('เรียกใช้การดำเนินการใหม่เรียบร้อยแล้ว'); await load(); await onChanged(); }
    catch (e) { setError(err(e)); } finally { setBusy(null); }
  };

  if (!run || loading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4 rounded bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {loading ? <LoadingState label="กำลังโหลด..." /> : (
          <>
            {error && <ErrorBanner message={error} />}
            <div className="flex justify-end">
              <button className={ghostClass} onClick={onClose}>ปิด</button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4 rounded bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900">{run.ruleName}</h2>
        {error && <ErrorBanner message={error} />}
        {explanation && (
          <div className="space-y-1 rounded bg-gray-50 p-3 text-sm text-gray-700">
            <p>{explanation.triggerSummary}</p>
            <p>{explanation.conditionSummary}</p>
            {explanation.actionSummaries.map((s: string, i: number) => <p key={i}>{s}</p>)}
            <p className="text-gray-500">{explanation.nextAction}</p>
          </div>
        )}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700">Action runs</h3>
          {(run.actionRuns ?? []).map((a: any) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded border border-gray-200 px-3 py-2 text-sm">
              <span>{a.actionKey} <StatusBadge status={a.status} labels={ACTION_RUN_STATUS_LABELS} /></span>
              {['FAILED_RETRYABLE', 'FAILED_FINAL', 'DEAD_LETTERED'].includes(a.status) && (
                <button className={ghostClass} disabled={busy === a.id} onClick={() => replay(a.id)}>ลองใหม่</button>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <button className={ghostClass} onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

// ── Tasks ──────────────────────────────────────────────────────────────────────
function TasksTab({ companyId }: { companyId: string }) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await listWorkflowTasks(companyId); setData(r.items ?? []); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const complete = async (id: string) => {
    setBusy(id); setError(null);
    try { await completeWorkflowTask(companyId, id); toast.success('ทำงานเสร็จสิ้นเรียบร้อยแล้ว'); await load(); } catch (e) { setError(err(e)); } finally { setBusy(null); }
  };
  const snooze = async (id: string) => {
    setBusy(id); setError(null);
    try {
      const until = new Date(Date.now() + 24 * 3600_000).toISOString();
      await snoozeWorkflowTask(companyId, id, until);
      toast.success('เลื่อนงานออกไป 1 วันเรียบร้อยแล้ว');
      await load();
    } catch (e) { setError(err(e)); } finally { setBusy(null); }
  };
  const cancel = async (id: string) => {
    if (!(await confirm({ title: 'ยกเลิกงาน', message: 'ยกเลิกงานนี้ใช่หรือไม่' }))) return;
    setBusy(id); setError(null);
    try { await cancelWorkflowTask(companyId, id); toast.success('ยกเลิกงานเรียบร้อยแล้ว'); await load(); } catch (e) { setError(err(e)); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="space-y-2">
          {data.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded border border-gray-200 p-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{t.title}</span>
                  <PriorityBadge priority={t.priority} />
                  <StatusBadge status={t.status} labels={TASK_STATUS_LABELS} />
                </div>
                {t.description && <p className="text-xs text-gray-500">{t.description}</p>}
                {t.webDeepLink && <a href={t.webDeepLink} className="text-xs text-brand-700 hover:underline">ไปที่ต้นทาง</a>}
              </div>
              {t.status === 'OPEN' && (
                <div className="flex gap-2">
                  <button className={ghostClass} disabled={busy === t.id} onClick={() => snooze(t.id)}>เลื่อน 1 วัน</button>
                  <button className={btnClass} disabled={busy === t.id} onClick={() => complete(t.id)}>เสร็จสิ้น</button>
                  <button className={dangerClass} disabled={busy === t.id} onClick={() => cancel(t.id)}>ยกเลิก</button>
                </div>
              )}
            </div>
          ))}
          {data.length === 0 && <div className="py-8 text-center text-sm text-gray-400">ไม่มีงานที่มอบหมาย</div>}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

// ── Dead letters ─────────────────────────────────────────────────────────────
function DeadLettersTab({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await listWorkflowDeadLetters(companyId); setData(r.items ?? []); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const replay = async (id: string) => {
    setBusy(id); setError(null);
    try { await replayWorkflowDeadLetter(companyId, id); toast.success('เรียกใช้รายการข้อผิดพลาดใหม่เรียบร้อยแล้ว'); await load(); } catch (e) { setError(err(e)); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="space-y-2">
          {data.map((d) => (
            <div key={d.id} className="rounded border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between">
                <StatusBadge status={d.resolutionStatus} labels={DEAD_LETTER_RESOLUTION_LABELS} />
                <span className="text-xs text-gray-400">{formatDateTime(d.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm text-red-700">{d.errorMessage}</p>
              {d.resolutionStatus === 'OPEN' && (
                <div className="mt-2 flex gap-2">
                  <button className={btnClass} disabled={busy === d.id} onClick={() => replay(d.id)}>ลองใหม่</button>
                  <button className={ghostClass} onClick={() => setNoteFor(d)}>ละเว้น</button>
                </div>
              )}
              {d.resolutionNote && <p className="mt-1 text-xs text-gray-500">หมายเหตุ: {d.resolutionNote}</p>}
            </div>
          ))}
          {data.length === 0 && <div className="py-8 text-center text-sm text-gray-400">ไม่มีข้อผิดพลาดค้าง</div>}
        </div>
      )}
      {noteFor && (
        <IgnoreDeadLetterModal companyId={companyId} deadLetter={noteFor} onClose={() => setNoteFor(null)} onDone={async () => { setNoteFor(null); await load(); }} />
      )}
    </div>
  );
}

function IgnoreDeadLetterModal({ companyId, deadLetter, onClose, onDone }: { companyId: string; deadLetter: any; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) { setError('กรุณาระบุหมายเหตุ'); return; }
    setBusy(true); setError(null);
    try { await ignoreWorkflowDeadLetter(companyId, deadLetter.id, note); toast.success('ละเว้นข้อผิดพลาดเรียบร้อยแล้ว'); await onDone(); }
    catch (e) { setError(err(e)); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <form className="w-full max-w-md space-y-3 rounded bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="text-lg font-semibold text-gray-900">ละเว้นข้อผิดพลาด</h2>
        {error && <ErrorBanner message={error} />}
        <label className="block text-sm">
          <span className="mb-1 block text-gray-600">หมายเหตุ (จำเป็น)</span>
          <textarea className={inputClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} required />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostClass} onClick={onClose}>ยกเลิก</button>
          <button type="submit" className={btnClass} disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        </div>
      </form>
    </div>
  );
}

// ── Webhooks ───────────────────────────────────────────────────────────────────
function WebhooksTab({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const emptyForm = { name: '', url: '', secretRef: '', allowedEventTypes: '' };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await listWorkflowWebhooks(companyId)); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (w: any) => {
    setBusy(w.id); setError(null);
    try {
      if (w.status === 'ENABLED') await disableWorkflowWebhook(companyId, w.id);
      else await enableWorkflowWebhook(companyId, w.id);
      toast.success(w.status === 'ENABLED' ? 'ปิดใช้งาน Webhook เรียบร้อยแล้ว' : 'เปิดใช้งาน Webhook เรียบร้อยแล้ว');
      await load();
    } catch (e) { setError(err(e)); } finally { setBusy(null); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    const v = validateWebhookForm(form);
    if (v) { setError(v); return; }
    setBusy('create');
    try {
      await createWorkflowWebhook(companyId, { ...form, allowedEventTypes: parseAllowedEventTypes(form.allowedEventTypes) });
      toast.success('บันทึก Webhook และ Signing secret เรียบร้อยแล้ว');
      setForm(emptyForm); setShowForm(false); await load();
    } catch (e) { setError(err(e)); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-amber-600">Webhook ปิดใช้งานโดยค่าเริ่มต้นเสมอ ต้องเปิดใช้งานเองหลังตรวจสอบ URL และ event type แล้ว</p>
      {error && <ErrorBanner message={error} />}
      <button className={btnClass} onClick={() => setShowForm((s) => !s)}>{showForm ? 'ปิดฟอร์ม' : '+ เพิ่ม Webhook'}</button>
      {showForm && (
        <form onSubmit={handleCreate} className="space-y-3 rounded border border-gray-200 p-4">
          <input className={inputClass} placeholder="ชื่อ" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className={inputClass} placeholder="https://..." value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
          <input className={inputClass} placeholder="Signing secret" type="password" value={form.secretRef} onChange={(e) => setForm({ ...form, secretRef: e.target.value })} required />
          <input className={inputClass} placeholder="Event types (คั่นด้วย ,) เช่น reimbursement.request_submitted" value={form.allowedEventTypes} onChange={(e) => setForm({ ...form, allowedEventTypes: e.target.value })} required />
          <button type="submit" className={btnClass} disabled={busy === 'create'}>{busy === 'create' ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        </form>
      )}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="space-y-2">
          {data.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded border border-gray-200 p-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{w.name}</span>
                  <StatusBadge status={w.status} labels={{ ENABLED: 'เปิดใช้งาน', DISABLED: 'ปิดใช้งาน' }} />
                </div>
                <p className="text-xs text-gray-500">{w.url}</p>
                <p className="text-xs text-gray-400">{w.allowedEventTypes.join(', ')}</p>
              </div>
              <button className={ghostClass} disabled={busy === w.id} onClick={() => toggle(w)}>{w.status === 'ENABLED' ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
            </div>
          ))}
          {data.length === 0 && <div className="py-8 text-center text-sm text-gray-400">ยังไม่มี Webhook</div>}
        </div>
      )}
    </div>
  );
}
