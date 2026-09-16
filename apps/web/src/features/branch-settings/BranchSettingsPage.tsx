'use client';
// 10D: Settings > สาขา — manage branches used as the in-page data scope dimension.
import { useCallback, useEffect, useState } from 'react';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeBadge, MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { useToast } from '@/common/components/toast';
import { taxBranchCodeError } from './branch-form.logic';
import {
  createBranch,
  listBranches,
  updateBranch,
  type Branch,
  type BranchType,
  type CreateBranchInput,
} from './branches.api';

const TYPE_LABELS: Record<BranchType, string> = {
  HEAD_OFFICE: 'สำนักงานใหญ่',
  BRANCH: 'สาขา',
  ONLINE: 'ออนไลน์',
  WAREHOUSE: 'คลังสินค้า',
};

const STATUS_LABELS: Record<Branch['status'], string> = {
  ACTIVE: 'ใช้งาน',
  DISABLED: 'ปิดใช้งาน',
  ARCHIVED: 'เก็บถาวร',
};

function errMsg(e: unknown): string {
  return apiErrorMessage(e);
}


const EMPTY_FORM: CreateBranchInput = { code: '', name: '', type: 'BRANCH', taxBranchCode: '' };

export default function BranchSettingsPage({ companyId, permissions = [] }: { companyId: string; permissions?: readonly string[] }) {
  const toast = useToast();
  const canManage = permissions.includes('company.branch.manage');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Kept beside the message so the banner can offer the way out, not just state the rule.
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateBranchInput>(EMPTY_FORM);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [busy, setBusy] = useState(false);
  const createTaxError = taxBranchCodeError(form.taxBranchCode);
  const editTaxError = taxBranchCodeError(editing?.taxBranchCode);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null); setErrorCode(null);
    try {
      setBranches(await listBranches(companyId));
    } catch (e) {
      setError(errMsg(e)); setErrorCode(apiErrorCode(e));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const submitCreate = async () => {
    if (!canManage || busy || createTaxError || !form.code.trim() || !form.name.trim()) return;
    setBusy(true);
    setError(null); setErrorCode(null);
    try {
      await createBranch(companyId, {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        type: form.type,
        ...(form.taxBranchCode?.trim() ? { taxBranchCode: form.taxBranchCode.trim() } : {}),
      });
      setForm(EMPTY_FORM);
      setCreating(false);
      await load();
      toast.success('สร้างสาขาเรียบร้อยแล้ว');
    } catch (e) {
      setError(errMsg(e)); setErrorCode(apiErrorCode(e));
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!canManage || busy || !editing || editTaxError || !editing.name.trim()) return;
    setBusy(true);
    setError(null); setErrorCode(null);
    try {
      await updateBranch(companyId, editing.id, {
        name: editing.name.trim(),
        taxBranchCode: editing.taxBranchCode?.trim() || null,
        phone: editing.phone?.trim() || undefined,
        email: editing.email?.trim() || undefined,
        status: editing.status,
      });
      setEditing(null);
      await load();
      toast.success('บันทึกการแก้ไขสาขาเรียบร้อยแล้ว');
    } catch (e) {
      setError(errMsg(e)); setErrorCode(apiErrorCode(e));
    } finally {
      setBusy(false);
    }
  };

  const inputClass = 'mangmee-input mt-2 w-full';
  const closeEditor = () => {
    if (busy) return;
    setCreating(false); setEditing(null); setError(null); setErrorCode(null);
  };
  const openEdit = (branch: Branch) => {
    setEditing({ ...branch }); setCreating(false); setError(null); setErrorCode(null);
  };
  const errorBanner = error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
    {error}
    {errorCode === 'branch_last_active_required' && canManage && !creating && <button
      type="button" className="ml-2 font-semibold underline"
      onClick={() => { setCreating(true); setEditing(null); setError(null); setErrorCode(null); }}
    >สร้างสาขาใหม่ก่อน</button>}
  </div>;

  return (
    <MangmeePage eyebrow="ตั้งค่า" title="สาขา" description="จัดการชื่อ ข้อมูลติดต่อ และสถานะของแต่ละสาขา"
      actions={canManage && <button type="button" className="mangmee-btn mangmee-btn-primary"
        onClick={() => { setCreating(true); setEditing(null); setError(null); setErrorCode(null); }}
      >+ เพิ่มสาขา</button>}>
      {!creating && !editing && errorBanner}
      <MangmeeCard className="overflow-hidden">
        <div className="mangmee-card-header flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">รายชื่อสาขา</h2>
          {!loading && !error && <MangmeeBadge tone="slate">{branches.length} สาขา</MangmeeBadge>}
        </div>
        {loading ? <p role="status" className="p-6 text-sm text-gray-500">กำลังโหลดสาขา…</p> : error && !creating && !editing ?
          <div className="p-5"><button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={() => void load()}>ลองโหลดอีกครั้ง</button></div> : branches.length === 0 ?
          <p className="p-10 text-center text-sm text-gray-500">ยังไม่มีสาขา{canManage ? ' กดเพิ่มสาขาเพื่อเริ่มต้น' : ''}</p> : <>
          <div className="mangmee-table-scroll hidden md:block">
            <table className="mangmee-table">
              <thead><tr><th>ชื่อสาขา</th><th>รหัสสาขา</th><th>ประเภท</th><th>รหัสสาขาภาษี</th><th>สถานะ</th>{canManage && <th><span className="sr-only">จัดการ</span></th>}</tr></thead>
              <tbody>{branches.map(b => <tr key={b.id}>
                <td className="font-semibold text-gray-900">{b.name}</td>
                <td>{b.code}</td>
                <td>{TYPE_LABELS[b.type] ?? b.type}</td>
                <td>{b.taxBranchCode ?? 'ยังไม่ระบุ'}</td>
                <td><MangmeeBadge tone={b.status === 'ACTIVE' ? 'brand' : 'slate'}>{STATUS_LABELS[b.status] ?? b.status}</MangmeeBadge></td>
                {canManage && <td className="text-right"><button type="button" className="mangmee-btn mangmee-btn-secondary" aria-label={`แก้ไขสาขา ${b.name}`} onClick={() => openEdit(b)}>แก้ไข</button></td>}
              </tr>)}</tbody>
            </table>
          </div>
          <div className="divide-y divide-gray-100 md:hidden">{branches.map(b => <div key={b.id} className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words font-semibold text-gray-900">{b.name}</h3><MangmeeBadge tone={b.status === 'ACTIVE' ? 'brand' : 'slate'}>{STATUS_LABELS[b.status] ?? b.status}</MangmeeBadge></div>
            <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-gray-500">รหัสสาขา</dt><dd className="mt-1 break-words text-gray-900">{b.code}</dd></div><div><dt className="text-gray-500">ประเภท</dt><dd className="mt-1 text-gray-900">{TYPE_LABELS[b.type] ?? b.type}</dd></div><div><dt className="text-gray-500">รหัสสาขาภาษี</dt><dd className="mt-1 text-gray-900">{b.taxBranchCode ?? 'ยังไม่ระบุ'}</dd></div></dl>
            {canManage && <button type="button" className="mangmee-btn mangmee-btn-secondary w-full" aria-label={`แก้ไขสาขา ${b.name}`} onClick={() => openEdit(b)}>แก้ไข</button>}
          </div>)}</div>
        </>}
      </MangmeeCard>
      <Modal open={canManage && (creating || Boolean(editing))} title={creating ? 'เพิ่มสาขา' : `แก้ไขสาขา ${editing?.name ?? ''}`} onClose={closeEditor} size="md">
        {errorBanner}
        {creating && <div className="grid gap-5 py-2 sm:grid-cols-2">
          <label className="text-sm text-gray-700">
            รหัสสาขา (A-Z, 0-9)
            <input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="เช่น BKK01" />
          </label>
          <label className="text-sm text-gray-700">
            ชื่อสาขา
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น สาขาลาดพร้าว" />
          </label>
          <label className="text-sm text-gray-700">
            ประเภท
            <ThemedSelect className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as BranchType })}>
              {Object.entries(TYPE_LABELS).filter(([type]) => type !== 'WAREHOUSE').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </ThemedSelect>
          </label>
          <label className="text-sm text-gray-700">
            รหัสสาขาภาษี (5 หลัก ไม่บังคับ)
            <input className={inputClass} value={form.taxBranchCode ?? ''} onChange={(e) => setForm({ ...form, taxBranchCode: e.target.value })} placeholder="เช่น 00001" inputMode="numeric" aria-invalid={Boolean(createTaxError)} aria-describedby={createTaxError ? 'create-tax-error' : undefined} />
            {createTaxError && <span id="create-tax-error" className="mt-1 block text-xs text-red-700">{createTaxError}</span>}
          </label>
          <div className="flex flex-wrap justify-end gap-3 border-t border-gray-100 pt-4 sm:col-span-2">
            <button
              className="mangmee-btn mangmee-btn-primary disabled:opacity-50"
              disabled={busy || Boolean(createTaxError) || !form.code.trim() || !form.name.trim()} aria-busy={Boolean(busy)}
              onClick={() => void submitCreate()}
            >
              บันทึกสาขาใหม่
            </button>
            <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={busy} aria-busy={Boolean(busy)} onClick={closeEditor}>ยกเลิก</button>
          </div>

        </div>}
        {editing && <div className="grid gap-5 py-2 sm:grid-cols-2">
          <p className="text-sm text-gray-500 sm:col-span-2">รหัสสาขา {editing.code} · ประเภท {TYPE_LABELS[editing.type]}<br />รหัสและประเภทสาขาเปลี่ยนจากหน้านี้ไม่ได้</p>
          <label className="text-sm text-gray-700">
            ชื่อสาขา
            <input className={inputClass} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700">
            รหัสสาขาภาษี
            <input className={inputClass} value={editing.taxBranchCode ?? ''} onChange={(e) => setEditing({ ...editing, taxBranchCode: e.target.value })} inputMode="numeric" aria-invalid={Boolean(editTaxError)} aria-describedby={editTaxError ? 'edit-tax-error' : undefined} />
            {editTaxError && <span id="edit-tax-error" className="mt-1 block text-xs text-red-700">{editTaxError}</span>}
          </label>
          <label className="text-sm text-gray-700">
            โทรศัพท์
            <input className={inputClass} value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700">
            สถานะ
            <ThemedSelect className={inputClass} value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as Branch['status'] })}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </ThemedSelect>
          </label>
          <div className="flex flex-wrap justify-end gap-3 border-t border-gray-100 pt-4 sm:col-span-2">
            <button
              className="mangmee-btn mangmee-btn-primary disabled:opacity-50"
              disabled={busy || Boolean(editTaxError) || !editing.name.trim()} aria-busy={Boolean(busy)}
              onClick={() => void submitEdit()}
            >
              บันทึก
            </button>
            <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={busy} aria-busy={Boolean(busy)} onClick={closeEditor}>ยกเลิก</button>
          </div>

        </div>}
      </Modal>
    </MangmeePage>
  );
}
