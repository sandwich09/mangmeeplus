'use client';

import { useCallback, useEffect, useState } from 'react';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { useToast } from '@/common/components/toast';
import { useInputPrompt } from '@/common/components/modal';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import type {
  MessagingChannelSummary,
  RevealMessagingChannelCredentialResult,
  CrmInboxPolicyDto,
  EmployeeSummary,
} from '@watchdog-bms/contracts';
import { listEmployees } from '@/features/employee-access/employee-access.api';
import { listBranches, type Branch } from '@/features/branch-settings/branches.api';
import {
  listChannels,
  connectChannel,
  testChannel,
  rotateChannel,
  disableChannel,
  revealChannelCredential,
  getInboxPolicy,
  updateInboxPolicy,
  updateChannelSettings,
} from './crm-inbox.api';
import {
  validateConnectForm,
  validateInboxPolicyForm,
  channelStatusLabel,
  channelErrorMessage,
  webhookDisplayUrl,
  type ChannelConnectForm,
} from './crm-inbox.logic';

const cardClass = 'rounded-lg border border-gray-200 bg-white p-5';
const labelClass = 'block text-sm font-medium text-gray-700';
const inputClass = 'mt-1 mangmee-input';
const primaryBtn = 'mangmee-btn mangmee-btn-primary disabled:opacity-50';
const secondaryBtn = 'rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const dangerBtn = 'rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50';

const EMPTY_FORM: ChannelConnectForm = { displayName: '', lineChannelId: '', channelSecret: '', accessToken: '' };

function toneClass(tone: 'green' | 'amber' | 'red' | 'gray'): string {
  switch (tone) {
    case 'green': return 'bg-green-100 text-green-800';
    case 'amber': return 'bg-amber-100 text-amber-800';
    case 'red': return 'bg-red-100 text-red-800';
    case 'gray': return 'bg-gray-100 text-gray-600';
  }
}

function TwoOaWarningCard() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="font-semibold">LINE OA นี้ต้องเป็นของบริษัทคุณ สำหรับ &ldquo;ลูกค้าของคุณ&rdquo; เท่านั้น</div>
      <p className="mt-1">
        ห้ามใช้ WatchDog OA หลัก (ที่พนักงานใช้ login/รับแจ้งเตือน) กับลูกค้าปลายทาง —
        ลูกค้าควรเห็นแบรนด์ร้านของคุณ และข้อความลูกค้าทั้งหมดจะไหลเข้า CRM Inbox ของบริษัทคุณโดยอัตโนมัติ
      </p>
    </div>
  );
}

function ChannelAutonomySettings({ companyId, channel }: { companyId: string; channel: MessagingChannelSummary }) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(channel.autoReplyEnabled ?? false);
  const [dailyCap, setDailyCap] = useState(String(channel.autoReplyDailyCap ?? 0));
  const [staffUserId, setStaffUserId] = useState(channel.defaultBookingStaffUserId ?? '');
  const [branchId, setBranchId] = useState(channel.defaultBookingBranchId ?? '');
  const [employees, setEmployees] = useState<EmployeeSummary[] | null>(null);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([listEmployees(companyId), listBranches(companyId)])
      .then(([employeeRows, branchRows]) => {
        if (!alive) return;
        setEmployees(employeeRows.filter((employee) => employee.status === 'ACTIVE'));
        setBranches(branchRows);
        setOptionsError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const status = (e as { status?: number }).status;
        setOptionsError(status === 403
          ? 'คุณไม่มีสิทธิ์ดูรายชื่อพนักงานหรือสาขา กรุณาติดต่อ Admin'
          : (e as Error).message || 'โหลดรายชื่อพนักงานและสาขาไม่สำเร็จ');
      });
    return () => { alive = false; };
  }, [companyId]);

  if (channel.autoReplyEnabled === undefined || channel.autoReplyDailyCap === undefined) return null;

  const save = async () => {
    const cap = Number(dailyCap);
    if (!dailyCap.trim() || !Number.isInteger(cap) || cap < 0) {
      setError('จำนวนตอบอัตโนมัติต่อวันต้องเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateChannelSettings(companyId, channel.id, {
        autoReplyEnabled: enabled,
        autoReplyDailyCap: cap,
        defaultBookingStaffUserId: staffUserId || null,
        defaultBookingBranchId: branchId || null,
      });
      setEnabled(updated.autoReplyEnabled ?? false);
      setDailyCap(String(updated.autoReplyDailyCap ?? 0));
      setStaffUserId(updated.defaultBookingStaffUserId ?? '');
      setBranchId(updated.defaultBookingBranchId ?? '');
      toast.success('บันทึกการตั้งค่าระบบตอบอัตโนมัติแล้ว');
    } catch (e) {
      setError((e as Error).message || 'บันทึกการตั้งค่าไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const optionsLoading = employees === null || branches === null;
  return (
    <div className="mt-4 rounded border border-blue-200 bg-blue-50/50 p-4">
      <h3 className="text-sm font-semibold text-gray-900">ระบบตอบอัตโนมัติและค่าเริ่มต้นการจอง</h3>
      <p className="mt-1 text-xs text-gray-500">0 ข้อความต่อวัน = พักระบบตอบอัตโนมัติของช่องทางนี้</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className={`${labelClass} flex items-center gap-2`}>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="เปิดระบบตอบอัตโนมัติ"
            onClick={() => setEnabled((value) => !value)}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
              enabled ? 'bg-brand-500' : 'bg-gray-300'
            }`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
          <span>เปิดระบบตอบอัตโนมัติ</span>
        </div>
        <label className={labelClass}>
          จำนวนตอบอัตโนมัติสูงสุดต่อวัน
          <input className={inputClass} type="number" min={0} step={1} value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} />
        </label>
        <label className={labelClass}>
          พนักงานเริ่มต้นสำหรับการจอง
          <ThemedSelect className={inputClass} value={staffUserId} disabled={optionsLoading || Boolean(optionsError)} onChange={(e) => setStaffUserId(e.target.value)}>
            <option value="">ไม่กำหนด</option>
            {employees?.map((employee) => <option key={employee.userId} value={employee.userId}>{employee.displayName}</option>)}
          </ThemedSelect>
        </label>
        <label className={labelClass}>
          สาขาเริ่มต้นสำหรับการจอง
          <ThemedSelect className={inputClass} value={branchId} disabled={optionsLoading || Boolean(optionsError)} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">ไม่กำหนด</option>
            {branches?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </ThemedSelect>
        </label>
      </div>
      {optionsLoading && !optionsError ? <div className="mt-2 text-xs text-gray-500">กำลังโหลดรายชื่อพนักงานและสาขา...</div> : null}
      {optionsError ? <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{optionsError}</div> : null}
      {error ? <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div> : null}
      <button className={`${primaryBtn} mt-3`} disabled={saving || optionsLoading || Boolean(optionsError)} onClick={() => void save()}>
        {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
      </button>
    </div>
  );
}

function ConnectWizard({ companyId, onConnected }: { companyId: string; onConnected: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<ChannelConnectForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof ChannelConnectForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    const validation = validateConnectForm(form);
    if (validation) { setError(validation); return; }
    setSubmitting(true);
    setError(null);
    try {
      await connectChannel(companyId, form);
      toast.success('เชื่อมต่อ LINE OA เรียบร้อยแล้ว');
      setForm(EMPTY_FORM);
      onConnected();
    } catch (e) {
      setError((e as Error).message || 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองใหม่');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={cardClass}>
      <h2 className="text-lg font-semibold text-gray-900">เชื่อมต่อ LINE OA ของบริษัท</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600">
        <li>เปิด <a className="text-brand-700 underline" href="https://developers.line.biz/console/" target="_blank" rel="noreferrer">LINE Developers Console</a> แล้วเลือก Messaging API channel ของร้านคุณ</li>
        <li>คัดลอก Channel ID และ Channel Secret จากแท็บ Basic settings</li>
        <li>ออก Channel Access Token (long-lived) จากแท็บ Messaging API</li>
        <li>กรอกข้อมูลด้านล่างแล้วกดเชื่อมต่อ — ระบบจะทดสอบกับ LINE ให้ทันที</li>
      </ol>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>ชื่อที่แสดงในระบบ</label>
          <input className={inputClass} value={form.displayName} onChange={set('displayName')} placeholder="เช่น LINE OA ร้านของฉัน" />
        </div>
        <div>
          <label className={labelClass}>Channel ID</label>
          <input className={inputClass} value={form.lineChannelId} onChange={set('lineChannelId')} placeholder="เช่น 1234567890" />
        </div>
        <div>
          <label className={labelClass}>Channel Secret</label>
          <input className={inputClass} type="password" value={form.channelSecret} onChange={set('channelSecret')} autoComplete="off" />
        </div>
        <div>
          <label className={labelClass}>Channel Access Token</label>
          <input className={inputClass} type="password" value={form.accessToken} onChange={set('accessToken')} autoComplete="off" />
        </div>
      </div>
      {error ? <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <div className="mt-4">
        <button className={primaryBtn} onClick={submit} disabled={submitting}>
          {submitting ? 'กำลังเชื่อมต่อ...' : 'เชื่อมต่อ LINE OA'}
        </button>
      </div>
    </div>
  );
}

function ChannelCard({ companyId, channel, onChanged }: {
  companyId: string;
  channel: MessagingChannelSummary;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealMessagingChannelCredentialResult | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateForm, setRotateForm] = useState({ channelSecret: '', accessToken: '' });
  const [copied, setCopied] = useState(false);

  const status = channelStatusLabel(channel.status);
  const lastError = channelErrorMessage(channel.lastErrorCode);
  const webhookUrl = webhookDisplayUrl(channel);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message || 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  };

  const copyWebhook = async () => {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{channel.displayName}</h2>
          <div className="text-sm text-gray-500">Channel ID: {channel.lineChannelId}</div>
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${toneClass(status.tone)}`}>
          {status.text}
        </span>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-gray-500">Credential</dt>
          <dd className="font-mono text-gray-900">••••••••{channel.credentialLast4} (v{channel.secretVersion})</dd>
        </div>
        <div>
          <dt className="text-gray-500">Webhook ล่าสุด</dt>
          <dd className="text-gray-900">{channel.lastWebhookAt ? formatThaiDateTime(channel.lastWebhookAt) : 'ยังไม่เคยได้รับ'}</dd>
        </div>
        {webhookUrl ? (
          <div className="sm:col-span-2">
            <dt className="text-gray-500">Webhook URL (วางใน LINE Developers Console แล้วเปิด Use webhook)</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-gray-100 px-2 py-1 text-xs text-gray-800">{webhookUrl}</code>
              <button className={secondaryBtn} onClick={copyWebhook}>{copied ? 'คัดลอกแล้ว ✓' : 'คัดลอก'}</button>
            </dd>
          </div>
        ) : null}
      </dl>

      {lastError ? <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{lastError}</div> : null}
      {notice ? <div className="mt-3 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</div> : null}
      {error ? <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      {channel.autoReplyEnabled !== undefined && channel.autoReplyDailyCap !== undefined
        ? <ChannelAutonomySettings companyId={companyId} channel={channel} />
        : null}

      {channel.status !== 'DISABLED' ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className={secondaryBtn}
            disabled={busy !== null}
            onClick={() => run('test', async () => {
              const result = await testChannel(companyId, channel.id);
              if (result.ok) setNotice(`เชื่อมต่อสำเร็จ — บอท "${result.botDisplayName}" พร้อมใช้งาน`);
              else setError(channelErrorMessage(result.error) ?? 'ทดสอบไม่สำเร็จ');
              onChanged();
            })}
          >
            {busy === 'test' ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
          </button>
          <button className={secondaryBtn} disabled={busy !== null} onClick={() => setRotateOpen((v) => !v)}>
            เปลี่ยน Credential
          </button>
          <button
            className={secondaryBtn}
            disabled={busy !== null}
            onClick={() => run('reveal', async () => {
              setRevealed(await revealChannelCredential(companyId, channel.id));
            })}
          >
            {busy === 'reveal' ? 'กำลังดึงข้อมูล...' : 'ดู Credential (บันทึก audit)'}
          </button>
          <button
            className={dangerBtn}
            disabled={busy !== null}
            onClick={async () => {
              const reason = await promptInput({
                title: 'ปิดการใช้งานช่องทาง',
                label: 'เหตุผลในการปิดการใช้งาน',
              });
              if (!reason) return;
              void run('disable', async () => {
                await disableChannel(companyId, channel.id, reason);
                toast.success('ปิดการใช้งาน LINE OA เรียบร้อยแล้ว');
                onChanged();
              });
            }}
          >
            ปิดการใช้งาน
          </button>
        </div>
      ) : (
        <div className="mt-4 text-sm text-gray-500">ปิดการใช้งานแล้ว: {channel.disableReason}</div>
      )}

      {revealed ? (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <div className="font-semibold text-amber-900">Credential (การเปิดดูถูกบันทึกใน audit log)</div>
          <dl className="mt-2 space-y-1 font-mono text-xs text-gray-800">
            <div>Channel ID: {revealed.lineChannelId}</div>
            <div>Channel Secret: {revealed.channelSecret}</div>
            <div className="break-all">Access Token: {revealed.accessToken}</div>
          </dl>
          <button className={`${secondaryBtn} mt-2`} onClick={() => setRevealed(null)}>ซ่อน</button>
        </div>
      ) : null}

      {rotateOpen ? (
        <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4">
          <div className="text-sm font-semibold text-gray-900">เปลี่ยน Channel Secret / Access Token</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Channel Secret ใหม่</label>
              <input className={inputClass} type="password" value={rotateForm.channelSecret} autoComplete="off"
                onChange={(e) => setRotateForm((f) => ({ ...f, channelSecret: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Access Token ใหม่</label>
              <input className={inputClass} type="password" value={rotateForm.accessToken} autoComplete="off"
                onChange={(e) => setRotateForm((f) => ({ ...f, accessToken: e.target.value }))} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className={primaryBtn}
              disabled={busy !== null}
              onClick={() => run('rotate', async () => {
                await rotateChannel(companyId, channel.id, rotateForm);
                setRotateOpen(false);
                setRotateForm({ channelSecret: '', accessToken: '' });
                setNotice('เปลี่ยน credential สำเร็จ');
                onChanged();
              })}
            >
              {busy === 'rotate' ? 'กำลังบันทึก...' : 'บันทึก credential ใหม่'}
            </button>
            <button className={secondaryBtn} onClick={() => setRotateOpen(false)}>ยกเลิก</button>
          </div>
        </div>
      ) : null}
      {inputPromptDialog}
    </div>
  );
}

/**
 * First-response SLA policy (CrmInboxPolicy). Renders only for holders of
 * crm.inbox.policy_manage — a 403 on load hides the card silently.
 */
function SlaPolicyCard({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [policy, setPolicy] = useState<CrmInboxPolicyDto | null>(null);
  const [hidden, setHidden] = useState(false);
  const [minutes, setMinutes] = useState('30');
  const [hoursEnabled, setHoursEnabled] = useState(true);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const p = await getInboxPolicy(companyId);
        if (!alive) return;
        setPolicy(p);
        setMinutes(String(p.firstResponseMinutes));
        setHoursEnabled(p.businessHours !== null);
        if (p.businessHours) {
          setStart(p.businessHours.start);
          setEnd(p.businessHours.end);
        }
      } catch (e) {
        if (!alive) return;
        if ((e as { status?: number }).status === 403) setHidden(true);
        else setError((e as Error).message || 'โหลดการตั้งค่า SLA ไม่สำเร็จ');
      }
    })();
    return () => { alive = false; };
  }, [companyId]);

  if (hidden) return null;

  const save = async () => {
    const validation = validateInboxPolicyForm({ firstResponseMinutes: minutes, businessHoursEnabled: hoursEnabled, start, end });
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError(null);
    try {
      const timezone = policy?.businessHours?.timezone ?? 'Asia/Bangkok';
      const updated = await updateInboxPolicy(companyId, {
        firstResponseMinutes: Number(minutes),
        businessHours: hoursEnabled ? { start, end, timezone } : null,
      });
      setPolicy(updated);
      toast.success('บันทึกการตั้งค่า SLA แล้ว — มีผลกับแชทใหม่ตั้งแต่ตอนนี้');
    } catch (e) {
      setError((e as Error).message || 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">SLA การตอบกลับลูกค้า</h2>
        {policy?.isDefault ? (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">ค่าเริ่มต้น</span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-gray-500">
        กำหนดเวลาที่ทีมต้องตอบข้อความแรกของลูกค้า — เกินกำหนดระบบจะแจ้งเตือนผู้รับผิดชอบและผู้จัดการ
      </p>
      {policy === null && !error ? (
        <div className="mt-3 text-sm text-gray-500">กำลังโหลด...</div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>ต้องตอบภายใน (นาที)</label>
              <input
                className={inputClass}
                type="number"
                min={1}
                max={1440}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>
                <input
                  type="checkbox"
                  className="mr-2 align-middle"
                  checked={hoursEnabled}
                  onChange={(e) => setHoursEnabled(e.target.checked)}
                />
                นับเฉพาะเวลาทำการ (เวลาไทย)
              </label>
              {hoursEnabled ? (
                <div className="mt-1 flex items-center gap-2">
                  <input className={`${inputClass} mt-0`} type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                  <span className="text-sm text-gray-500">ถึง</span>
                  <input className={`${inputClass} mt-0`} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
                </div>
              ) : (
                <div className="mt-2 text-sm text-gray-500">นับเวลาตลอด 24 ชม.</div>
              )}
            </div>
          </div>
          {error ? <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
          <div className="mt-4">
            <button className={primaryBtn} onClick={() => void save()} disabled={saving || policy === null}>
              {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า SLA'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function LineOaSettingsPage({ companyId }: { companyId: string }) {
  const [channels, setChannels] = useState<MessagingChannelSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setChannels(await listChannels(companyId));
      setLoadError(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setLoadError(
        status === 403
          ? 'คุณไม่มีสิทธิ์เข้าถึงการตั้งค่านี้ กรุณาติดต่อ Admin ของบริษัท'
          : (e as Error).message || 'โหลดข้อมูลไม่สำเร็จ',
      );
    }
  }, [companyId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (alive) await load();
    })();
    return () => { alive = false; };
  }, [load]);

  const activeChannels = channels?.filter((c) => c.status !== 'DISABLED') ?? [];

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">เชื่อมต่อ LINE OA</h1>
        <p className="text-sm text-gray-500">
          เชื่อม LINE OA ของบริษัทเพื่อให้ข้อความลูกค้าเข้าสู่ CRM Inbox โดยอัตโนมัติ
        </p>
      </div>

      <TwoOaWarningCard />

      {loadError ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{loadError}</div>
      ) : channels === null ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">กำลังโหลด...</div>
      ) : (
        <>
          {channels.map((channel) => (
            <ChannelCard key={channel.id} companyId={companyId} channel={channel} onChanged={() => void load()} />
          ))}
          {activeChannels.length === 0 ? (
            <ConnectWizard companyId={companyId} onConnected={() => void load()} />
          ) : null}
          <SlaPolicyCard companyId={companyId} />
        </>
      )}
    </div>
  );
}
