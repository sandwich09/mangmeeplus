'use client';
// 10D: Settings > สาขา — manage branches used as the in-page data scope dimension.
import { useCallback, useEffect, useState } from 'react';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { useToast } from '@/common/components/toast';
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
  return e instanceof Error ? e.message : 'เกิดข้อผิดพลาด';
}

const EMPTY_FORM: CreateBranchInput = { code: '', name: '', type: 'BRANCH', taxBranchCode: '' };

export default function BranchSettingsPage({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateBranchInput>(EMPTY_FORM);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBranches(await listBranches(companyId));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const submitCreate = async () => {
    setBusy(true);
    setError(null);
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
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
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
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const inputClass = 'mangmee-input';

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">สาขา</h1>
          <p className="text-sm text-gray-500">สาขาใช้เป็นตัวกรองในหน้าเดียวกัน และเป็นขอบเขตข้อมูลของพนักงานทั้งเว็บและ LINE</p>
        </div>
        <button
          className="mangmee-btn mangmee-btn-primary"
          onClick={() => { setCreating((c) => !c); setEditing(null); }}
        >
          {creating ? 'ยกเลิก' : '+ เพิ่มสาขา'}
        </button>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {creating && (
        <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
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
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </ThemedSelect>
          </label>
          <label className="text-sm text-gray-700">
            รหัสสาขาภาษี (5 หลัก ไม่บังคับ)
            <input className={inputClass} value={form.taxBranchCode ?? ''} onChange={(e) => setForm({ ...form, taxBranchCode: e.target.value })} placeholder="เช่น 00001" />
          </label>
          <div className="sm:col-span-2 lg:col-span-4">
            <button
              className="mangmee-btn mangmee-btn-primary disabled:opacity-50"
              disabled={busy || !form.code.trim() || !form.name.trim()}
              onClick={() => void submitCreate()}
            >
              บันทึกสาขาใหม่
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">กำลังโหลด...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3">รหัส</th>
                <th className="px-4 py-3">ชื่อสาขา</th>
                <th className="px-4 py-3">ประเภท</th>
                <th className="px-4 py-3">รหัสสาขาภาษี</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {branches.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3 font-mono text-xs">{b.code}</td>
                  <td className="px-4 py-3 text-gray-900">{b.name}</td>
                  <td className="px-4 py-3">{TYPE_LABELS[b.type] ?? b.type}</td>
                  <td className="px-4 py-3">{b.taxBranchCode ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span className={b.status === 'ACTIVE' ? 'text-green-700' : 'text-gray-400'}>{STATUS_LABELS[b.status] ?? b.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-brand-700 hover:underline" onClick={() => { setEditing({ ...b }); setCreating(false); }}>
                      แก้ไข
                    </button>
                  </td>
                </tr>
              ))}
              {branches.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">ยังไม่มีสาขา</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="grid gap-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-4 text-sm font-medium text-gray-900">
            แก้ไขสาขา {editing.code} (รหัสสาขาแก้ไม่ได้หลังมีข้อมูลอ้างอิง)
          </div>
          <label className="text-sm text-gray-700">
            ชื่อสาขา
            <input className={inputClass} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700">
            รหัสสาขาภาษี
            <input className={inputClass} value={editing.taxBranchCode ?? ''} onChange={(e) => setEditing({ ...editing, taxBranchCode: e.target.value })} />
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
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <button
              className="mangmee-btn mangmee-btn-primary disabled:opacity-50"
              disabled={busy || !editing.name.trim()}
              onClick={() => void submitEdit()}
            >
              บันทึก
            </button>
            <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm" onClick={() => setEditing(null)}>ยกเลิก</button>
          </div>
        </div>
      )}
    </div>
  );
}
