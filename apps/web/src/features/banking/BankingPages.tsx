'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ForbiddenState, LoadingState } from '@/common/components/state';
import { formatThaiDate } from '@/common/i18n/thai-date';
import {
  listBankAccounts, createBankAccount, deactivateBankAccount,
  getCashPosition,
  listReconciliations, createReconciliation, completeReconciliation, reopenReconciliation,
  listAdjustments, createAdjustment, submitAdjustment, approveAdjustment, voidAdjustment,
} from './banking.api';
import { StatementImportPanel } from './StatementImportPanel';
import { MatchingPanel } from './MatchingPanel';
import {
  parseBankingTab,
  visibleBankingTabs,
  type BankingTab,
} from './banking.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { useToast } from '@/common/components/toast';
import { useInputPrompt } from '@/common/components/modal';

function err(e: unknown) { return apiErrorMessage(e); }
const inputClass = 'mangmee-input';
const btnClass = 'mangmee-btn mangmee-btn-primary disabled:opacity-50';
const ghostClass = 'rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const dangerClass = 'rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50';
const BANKING_TAB_LABELS: Record<BankingTab, string> = {
  accounts: 'บัญชีธนาคาร',
  cash: 'สถานะเงินสด',
  import: 'นำเข้า statement',
  matching: 'จับคู่รายการ',
  reconciliations: 'กระทบยอด',
  adjustments: 'รายการปรับปรุง',
};

const ACCOUNT_STATUS_LABELS: Record<string, string> = { ACTIVE: 'ใช้งาน', INACTIVE: 'ไม่ใช้งาน', ARCHIVED: 'เก็บถาวร' };
const RECON_STATUS_LABELS: Record<string, string> = { DRAFT: 'ร่าง', IN_REVIEW: 'กำลังตรวจสอบ', COMPLETED: 'เสร็จสมบูรณ์', REOPENED: 'เปิดใหม่', VOIDED: 'ยกเลิก' };
const ADJ_STATUS_LABELS: Record<string, string> = { DRAFT: 'ร่าง', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', VOIDED: 'ยกเลิก', POSTED: 'บันทึกแล้ว', POSTING_ERROR: 'ผิดพลาด' };

function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
  const colorMap: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-700', INACTIVE: 'bg-gray-100 text-gray-600', ARCHIVED: 'bg-gray-100 text-gray-500',
    DRAFT: 'bg-gray-100 text-gray-700', PENDING_APPROVAL: 'bg-yellow-100 text-yellow-800',
    APPROVED: 'bg-green-100 text-green-700', POSTED: 'bg-green-100 text-green-700',
    VOIDED: 'bg-red-50 text-red-400', POSTING_ERROR: 'bg-red-100 text-red-700',
    COMPLETED: 'bg-green-100 text-green-700', IN_REVIEW: 'bg-yellow-100 text-yellow-700',
    REOPENED: 'bg-orange-100 text-orange-700',
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colorMap[status] ?? 'bg-gray-100 text-gray-600'}`}>{map[status] ?? status}</span>;
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{message}</div>;
}

// ── Bank Accounts ─────────────────────────────────────────────────────────────
function BankAccountList({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ displayName: '', bankName: '', bankCode: '', accountType: 'BANK_SAVINGS', accountNumberMasked: '', accountNumberLast4: '', currency: 'THB', openingBalanceAmount: '' });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await listBankAccounts(companyId); setData(r.data ?? r ?? []); }
    catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setActionLoading(id); setError(null);
    try { await fn(); await load(); if (successMessage) toast.success(successMessage); } catch (e) { setError(err(e)); } finally { setActionLoading(null); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setCreating(true);
    try {
      await createBankAccount(companyId, { ...form, openingBalanceAmount: form.openingBalanceAmount || '0.00' });
      setShowForm(false);
      setForm({ displayName: '', bankName: '', bankCode: '', accountType: 'BANK_SAVINGS', accountNumberMasked: '', accountNumberLast4: '', currency: 'THB', openingBalanceAmount: '' });
      await load();
      toast.success('บันทึกบัญชีธนาคารเรียบร้อยแล้ว');
    } catch (e) { setError(err(e)); } finally { setCreating(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className={btnClass} onClick={() => setShowForm(v => !v)}>{showForm ? 'ยกเลิก' : '+ เพิ่มบัญชีธนาคาร'}</button>
      </div>
      {showForm && (
        <form onSubmit={handleCreate} className="rounded border border-gray-200 p-4 space-y-3 bg-gray-50">
          <h3 className="text-sm font-medium text-gray-900">เพิ่มบัญชีธนาคารใหม่</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-600 mb-1">ชื่อแสดง *</label><input className={inputClass} required value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">ชื่อธนาคาร *</label><input className={inputClass} required value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">รหัสธนาคาร</label><input className={inputClass} value={form.bankCode} onChange={e => setForm(f => ({ ...f, bankCode: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">ประเภทบัญชี</label>
              <ThemedSelect className={inputClass} value={form.accountType} onChange={e => setForm(f => ({ ...f, accountType: e.target.value }))}>
                <option value="BANK_SAVINGS">ออมทรัพย์</option>
                <option value="BANK_CHECKING">กระแสรายวัน</option>
                <option value="CASH">เงินสด</option>
                <option value="E_WALLET">อีวอลเล็ต</option>
                <option value="OTHER">อื่น ๆ</option>
              </ThemedSelect>
            </div>
            <div><label className="block text-xs text-gray-600 mb-1">เลขบัญชี (ปกปิด)</label><input className={inputClass} value={form.accountNumberMasked} onChange={e => setForm(f => ({ ...f, accountNumberMasked: e.target.value }))} placeholder="xxx-x-xxxxx-x" /></div>
            <div><label className="block text-xs text-gray-600 mb-1">4 หลักสุดท้าย</label><input className={inputClass} maxLength={4} value={form.accountNumberLast4} onChange={e => setForm(f => ({ ...f, accountNumberLast4: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">สกุลเงิน</label><input className={inputClass} value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">ยอดยกมา</label><input className={inputClass} type="number" value={form.openingBalanceAmount} onChange={e => setForm(f => ({ ...f, openingBalanceAmount: e.target.value }))} /></div>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex gap-2 justify-end"><button type="button" className={ghostClass} disabled={creating} onClick={() => setShowForm(false)}>ยกเลิก</button><button type="submit" className={btnClass} disabled={creating}>{creating ? 'กำลังบันทึก...' : 'บันทึก'}</button></div>
        </form>
      )}
      {!showForm && error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">ชื่อบัญชี</th><th className="px-4 py-3">ธนาคาร</th>
                <th className="px-4 py-3">ประเภท</th><th className="px-4 py-3">สกุลเงิน</th>
                <th className="px-4 py-3">ยอดยกมา</th><th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3">การกระทำ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td></tr> : data.map((a: any) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{a.displayName}</td>
                  <td className="px-4 py-3 text-gray-600">{a.bankName}</td>
                  <td className="px-4 py-3 text-gray-500">{a.accountType}</td>
                  <td className="px-4 py-3 text-gray-500">{a.currency}</td>
                  <td className="px-4 py-3">{Number(a.openingBalanceAmount ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3"><StatusBadge status={a.status} map={ACCOUNT_STATUS_LABELS} /></td>
                  <td className="px-4 py-3">
                    {a.status === 'ACTIVE' && (
                      <button className={dangerClass + ' text-xs py-1 px-2'} disabled={actionLoading === a.id} onClick={() => action(a.id, () => deactivateBankAccount(companyId, a.id), 'ปิดใช้งานบัญชีธนาคารเรียบร้อยแล้ว')}>ปิดใช้งาน</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Cash Position ─────────────────────────────────────────────────────────────
function CashPositionPanel({ companyId }: { companyId: string }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    getCashPosition(companyId).then(setData).catch(e => setError(err(e))).finally(() => setLoading(false));
  }, [companyId]);

  if (loading) return <LoadingState label="กำลังโหลด..." />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  const accounts: any[] = Array.isArray(data) ? data : (data.accounts ?? data.data ?? []);
  const total = data.totalCashPosition ?? data.total ?? accounts.reduce((s: number, a: any) => s + Number(a.lastReconciledBalance ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between">
        <h2 className="text-lg font-medium text-gray-900">สถานะเงินสด</h2>
        <div className="text-sm text-gray-500">ยอดรวมทั้งหมด: <span className="font-semibold text-gray-900">{Number(total).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</span></div>
      </div>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
            <tr><th className="px-4 py-3">บัญชีธนาคาร</th><th className="px-4 py-3">ธนาคาร</th><th className="px-4 py-3">สกุลเงิน</th><th className="px-4 py-3">ยอดคงเหลือ</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {accounts.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td></tr> : accounts.map((a: any, i: number) => (
              <tr key={a.bankAccountId ?? i} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{a.bankAccountDisplayName ?? a.displayName}</td>
                <td className="px-4 py-3 text-gray-600">{a.bankName ?? '-'}</td>
                <td className="px-4 py-3 text-gray-500">{a.currency}</td>
                <td className="px-4 py-3 font-medium">{Number(a.lastReconciledBalance ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Reconciliations ───────────────────────────────────────────────────────────
function ReconciliationList({ companyId }: { companyId: string }) {
  const toast = useToast();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ bankAccountId: '', periodStartDate: '', periodEndDate: '', openingStatementBalanceAmount: '', closingStatementBalanceAmount: '', currency: 'THB' });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await listReconciliations(companyId); setData(r.data ?? r ?? []); }
    catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setActionLoading(id); setError(null);
    try { await fn(); await load(); if (successMessage) toast.success(successMessage); } catch (e) { setError(err(e)); } finally { setActionLoading(null); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setCreating(true);
    try {
      await createReconciliation(companyId, {
        ...form,
        openingStatementBalanceAmount: form.openingStatementBalanceAmount || '0.00',
        closingStatementBalanceAmount: form.closingStatementBalanceAmount || '0.00',
      });
      setShowForm(false);
      setForm({ bankAccountId: '', periodStartDate: '', periodEndDate: '', openingStatementBalanceAmount: '', closingStatementBalanceAmount: '', currency: 'THB' });
      await load();
      toast.success('สร้างรอบกระทบยอดเรียบร้อยแล้ว');
    } catch (e) { setError(err(e)); } finally { setCreating(false); }
  };

  const reopen = async (id: string) => {
    const reason = await promptInput({ title: 'เปิดรอบกระทบยอดใหม่', label: 'เหตุผลเปิดใหม่' });
    if (!reason) return;
    await action(id, () => reopenReconciliation(companyId, id, reason), 'เปิดรอบกระทบยอดใหม่เรียบร้อยแล้ว');
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className={btnClass} onClick={() => setShowForm(v => !v)}>{showForm ? 'ยกเลิก' : '+ สร้างรอบกระทบยอด'}</button>
      </div>
      {showForm && (
        <form onSubmit={handleCreate} className="rounded border border-gray-200 p-4 space-y-3 bg-gray-50">
          <h3 className="text-sm font-medium text-gray-900">สร้างรอบกระทบยอดใหม่</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-600 mb-1">รหัสบัญชีธนาคาร *</label><input className={inputClass} required value={form.bankAccountId} onChange={e => setForm(f => ({ ...f, bankAccountId: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">สกุลเงิน</label><input className={inputClass} value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">ยอดยกมาตาม statement</label><input className={inputClass} type="number" value={form.openingStatementBalanceAmount} onChange={e => setForm(f => ({ ...f, openingStatementBalanceAmount: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">ยอดปิดตาม statement</label><input className={inputClass} type="number" value={form.closingStatementBalanceAmount} onChange={e => setForm(f => ({ ...f, closingStatementBalanceAmount: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">วันเริ่มต้น *</label><ThemedDate className={inputClass} required value={form.periodStartDate} onChange={e => setForm(f => ({ ...f, periodStartDate: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">วันสิ้นสุด *</label><ThemedDate className={inputClass} required value={form.periodEndDate} onChange={e => setForm(f => ({ ...f, periodEndDate: e.target.value }))} /></div>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex gap-2 justify-end"><button type="button" className={ghostClass} disabled={creating} onClick={() => setShowForm(false)}>ยกเลิก</button><button type="submit" className={btnClass} disabled={creating}>{creating ? 'กำลังสร้าง...' : 'สร้าง'}</button></div>
        </form>
      )}
      {!showForm && error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">รหัส</th><th className="px-4 py-3">บัญชีธนาคาร</th>
                <th className="px-4 py-3">ช่วงเวลา</th><th className="px-4 py-3">ส่วนต่าง</th>
                <th className="px-4 py-3">สถานะ</th><th className="px-4 py-3">การกระทำ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td></tr> : data.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.id?.slice(0, 8)}</td>
                  <td className="px-4 py-3">{r.bankAccountId?.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{r.periodStartDate ? formatThaiDate(r.periodStartDate) : '-'} – {r.periodEndDate ? formatThaiDate(r.periodEndDate) : '-'}</td>
                  <td className="px-4 py-3">{r.differenceAmount != null ? Number(r.differenceAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-'}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} map={RECON_STATUS_LABELS} /></td>
                  <td className="px-4 py-3 flex gap-1 flex-wrap">
                    {['DRAFT', 'IN_REVIEW'].includes(r.status) && (
                      <button className={btnClass + ' text-xs py-1 px-2 bg-green-600 hover:bg-green-700'} disabled={actionLoading === r.id} onClick={() => action(r.id, () => completeReconciliation(companyId, r.id, []), 'ดำเนินการกระทบยอดเสร็จสิ้นเรียบร้อยแล้ว')}>เสร็จสิ้น</button>
                    )}
                    {r.status === 'COMPLETED' && (
                      <button className={ghostClass + ' text-xs py-1 px-2'} disabled={actionLoading === r.id} onClick={() => void reopen(r.id)}>เปิดใหม่</button>
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

// ── Adjustments ───────────────────────────────────────────────────────────────
function AdjustmentList({ companyId }: { companyId: string }) {
  const toast = useToast();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ bankAccountId: '', category: '', description: '', signedAmount: '', currency: 'THB', adjustmentDate: '' });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await listAdjustments(companyId); setData(r.data ?? r ?? []); }
    catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setActionLoading(id); setError(null);
    try { await fn(); await load(); if (successMessage) toast.success(successMessage); } catch (e) { setError(err(e)); } finally { setActionLoading(null); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setCreating(true);
    try {
      await createAdjustment(companyId, { ...form, signedAmount: form.signedAmount });
      setShowForm(false);
      setForm({ bankAccountId: '', category: '', description: '', signedAmount: '', currency: 'THB', adjustmentDate: '' });
      await load();
      toast.success('บันทึกรายการปรับปรุงเรียบร้อยแล้ว');
    } catch (e) { setError(err(e)); } finally { setCreating(false); }
  };

  const approve = async (id: string) => {
    const ledgerDebitAccountId = await promptInput({
      title: 'อนุมัติรายการปรับปรุง',
      label: 'บัญชีเดบิต',
      multiline: false,
      variant: 'primary',
    });
    if (!ledgerDebitAccountId) return;
    const ledgerCreditAccountId = await promptInput({
      title: 'อนุมัติรายการปรับปรุง',
      label: 'บัญชีเครดิต',
      multiline: false,
      variant: 'primary',
    });
    if (!ledgerCreditAccountId) return;
    await action(id, () => approveAdjustment(companyId, id, { ledgerDebitAccountId, ledgerCreditAccountId }), 'อนุมัติรายการปรับปรุงเรียบร้อยแล้ว');
  };

  const voidEntry = async (id: string) => {
    const reason = await promptInput({ title: 'ยกเลิกรายการปรับปรุง', label: 'เหตุผลยกเลิก' });
    if (!reason) return;
    await action(id, () => voidAdjustment(companyId, id, reason), 'ยกเลิกรายการปรับปรุงเรียบร้อยแล้ว');
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className={btnClass} onClick={() => setShowForm(v => !v)}>{showForm ? 'ยกเลิก' : '+ สร้างรายการปรับปรุง'}</button>
      </div>
      {showForm && (
        <form onSubmit={handleCreate} className="rounded border border-gray-200 p-4 space-y-3 bg-gray-50">
          <h3 className="text-sm font-medium text-gray-900">สร้างรายการปรับปรุงใหม่</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-600 mb-1">รหัสบัญชีธนาคาร *</label><input className={inputClass} required value={form.bankAccountId} onChange={e => setForm(f => ({ ...f, bankAccountId: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">หมวดหมู่ *</label><input className={inputClass} required value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} /></div>
            <div className="col-span-2"><label className="block text-xs text-gray-600 mb-1">คำอธิบาย</label><input className={inputClass} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">จำนวนเงิน (+ ฝาก / - ถอน) *</label><input className={inputClass} type="number" required value={form.signedAmount} onChange={e => setForm(f => ({ ...f, signedAmount: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">สกุลเงิน</label><input className={inputClass} value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">วันที่ *</label><ThemedDate className={inputClass} required value={form.adjustmentDate} onChange={e => setForm(f => ({ ...f, adjustmentDate: e.target.value }))} /></div>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex gap-2 justify-end"><button type="button" className={ghostClass} disabled={creating} onClick={() => setShowForm(false)}>ยกเลิก</button><button type="submit" className={btnClass} disabled={creating}>{creating ? 'กำลังบันทึก...' : 'บันทึก'}</button></div>
        </form>
      )}
      {!showForm && error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">หมวดหมู่</th><th className="px-4 py-3">จำนวนเงิน</th>
                <th className="px-4 py-3">วันที่</th><th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3">การกระทำ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td></tr> : data.map((a: any) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{a.category}</td>
                  <td className={`px-4 py-3 font-medium ${Number(a.signedAmount) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {Number(a.signedAmount) >= 0 ? '+' : ''}{Number(a.signedAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{a.adjustmentDate ? formatThaiDate(a.adjustmentDate) : '-'}</td>
                  <td className="px-4 py-3"><StatusBadge status={a.status} map={ADJ_STATUS_LABELS} /></td>
                  <td className="px-4 py-3 flex gap-1 flex-wrap">
                    {a.status === 'DRAFT' && (
                      <button className={btnClass + ' text-xs py-1 px-2'} disabled={actionLoading === a.id} onClick={() => action(a.id, () => submitAdjustment(companyId, a.id), 'ส่งขออนุมัติรายการปรับปรุงเรียบร้อยแล้ว')}>ส่งขออนุมัติ</button>
                    )}
                    {a.status === 'PENDING_APPROVAL' && (
                      <button className={btnClass + ' text-xs py-1 px-2 bg-green-600 hover:bg-green-700'} disabled={actionLoading === a.id} onClick={() => void approve(a.id)}>อนุมัติ</button>
                    )}
                    {['DRAFT', 'PENDING_APPROVAL'].includes(a.status) && (
                      <button className={dangerClass + ' text-xs py-1 px-2'} disabled={actionLoading === a.id} onClick={() => void voidEntry(a.id)}>ยกเลิก</button>
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

// ── Hub Page ──────────────────────────────────────────────────────────────────
export function BankingHubPage({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const searchParams = useSearchParams();
  const tabs = useMemo(() => visibleBankingTabs(permissions), [permissions]);
  // Initial tab only: later clicks are not overwritten by the original deep link.
  const [tab, setTab] = useState<BankingTab>(() => parseBankingTab(searchParams.get('tab'), tabs));

  if (tabs.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold text-gray-900">บัญชีธนาคารและกระทบยอด</h1>
        <ForbiddenState description="บัญชีนี้ยังไม่มีสิทธิ์ใช้งานหน้าธนาคารและกระทบยอด" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">บัญชีธนาคารและกระทบยอด</h1>
      <div className="flex w-full items-center overflow-x-auto border-b border-gray-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:overflow-x-visible">
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{BANKING_TAB_LABELS[t]}</button>
        ))}
      </div>
      <div>
        {tab === 'accounts' && <BankAccountList companyId={companyId} />}
        {tab === 'cash' && <CashPositionPanel companyId={companyId} />}
        {tab === 'import' && <StatementImportPanel companyId={companyId} />}
        {tab === 'matching' && <MatchingPanel companyId={companyId} />}
        {tab === 'reconciliations' && <ReconciliationList companyId={companyId} />}
        {tab === 'adjustments' && <AdjustmentList companyId={companyId} />}
      </div>
    </div>
  );
}
