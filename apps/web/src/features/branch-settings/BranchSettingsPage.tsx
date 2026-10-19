'use client';
// 10D: Settings > สาขา — manage branches used as the in-page data scope dimension.
import Link from 'next/link';
import { WhtPayerModeSettings, withholdingReturn } from './WhtPayerModeSettings';
import type { WhtPayerMode } from '@watchdog-bms/contracts';
import { useCallback, useEffect, useState } from 'react';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { primaryButtonClass, secondaryButtonClass } from '@/common/components/button/button-classes';
import { TextField } from '@/common/components/field';
import { MangmeeBadge, MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { Notice } from '@/common/components/notice';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { useToast } from '@/common/components/toast';
import { useBranchFilter } from '@/features/web-core-workspace/WorkspaceScope';
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
  ARCHIVED: 'ปิดใช้งาน',
};

function errMsg(e: unknown): string {
  return apiErrorMessage(e);
}


const EMPTY_FORM: CreateBranchInput = { code: '', name: '', type: 'BRANCH', taxBranchCode: '' };

export default function BranchSettingsPage({ companyId, permissions = [], roles = [] }: { companyId: string; permissions?: readonly string[]; roles?: readonly string[] }) {
  const toast = useToast();
  // The top bar's branch list is read once per page; a branch added or renamed here must show there without a reload.
  const branchFilter = useBranchFilter();
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
  // The save button is always enabled; what is missing is said under its field once it has been pressed.
  const [pressed, setPressed] = useState(false);
  const [payerMode, setPayerMode] = useState<WhtPayerMode | null>(null);
  const [returnHref, setReturnHref] = useState<string | null>(null);
  const [originBranch, setOriginBranch] = useState('');
  const [savedFromTax, setSavedFromTax] = useState(false);
  useEffect(() => {
    setReturnHref(withholdingReturn(window.location.search, companyId));
    setOriginBranch(new URLSearchParams(window.location.search).get('branchId') ?? '');
  }, [companyId]);
  useEffect(() => {
    if (!returnHref || !originBranch || !canManage) return;
    const branch = branches.find(row => row.id === originBranch);
    if (branch) { setEditing({ ...branch }); setOriginBranch(''); }
  }, [branches, originBranch, returnHref, canManage]);
  useEffect(() => {
    if (!editing || !returnHref || new URLSearchParams(window.location.search).get('branchId') !== editing.id) return;
    const frame = requestAnimationFrame(() => document.getElementById('branch-tax-code')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editing?.id, returnHref]);
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

  const focusFirstInvalid = () => requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus();
  });

  const submitCreate = async () => {
    setPressed(true);
    if (!canManage || busy || createTaxError || !form.code.trim() || !form.name.trim()) { focusFirstInvalid(); return; }
    setBusy(true);
    setError(null); setErrorCode(null);
    try {
      const name = form.name.trim();
      await createBranch(companyId, {
        code: form.code.trim().toUpperCase(),
        name,
        type: form.type,
        ...(form.taxBranchCode?.trim() ? { taxBranchCode: form.taxBranchCode.trim() } : {}),
      });
      setForm(EMPTY_FORM);
      setCreating(false);
      setPressed(false);
      await load();
      branchFilter?.reloadScope();
      toast.success(`เพิ่มสาขา ${name} แล้ว`);
    } catch (e) {
      setError(errMsg(e)); setErrorCode(apiErrorCode(e));
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    setPressed(true);
    if (!canManage || busy || !editing || editTaxError || !editing.name.trim()) { focusFirstInvalid(); return; }
    setBusy(true);
    setError(null); setErrorCode(null);
    try {
      const name = editing.name.trim();
      const statusChanged = branches.find(branch => branch.id === editing.id)?.status !== editing.status;
      const action = statusChanged ? editing.status === 'ACTIVE' ? 'เปิดใช้งาน' : 'ปิดใช้งาน' : 'บันทึก';
      await updateBranch(companyId, editing.id, {
        name: editing.name.trim(),
        taxBranchCode: editing.taxBranchCode?.trim() || null,
        phone: editing.phone?.trim() ?? '',
        email: editing.email?.trim() || undefined,
        status: editing.status,
      });
      setEditing(null);
      setSavedFromTax(!!returnHref);
      setPressed(false);
      await load();
      branchFilter?.reloadScope();
      toast.success(`${action}สาขา ${name} แล้ว`);
      if (returnHref && new URLSearchParams(window.location.search).get('branchId') === editing.id) window.location.assign(returnHref);
    } catch (e) {
      setError(errMsg(e)); setErrorCode(apiErrorCode(e));
    } finally {
      setBusy(false);
    }
  };

  // Named for what it is: it only closes the dialog, it starts no request (the loading audit reads the name).
  const onCancel = () => {
    if (busy) return;
    setCreating(false); setEditing(null); setError(null); setErrorCode(null); setPressed(false);
  };
  const openCreate = () => {
    setCreating(true); setEditing(null); setError(null); setErrorCode(null); setPressed(false);
  };
  const openEdit = (branch: Branch) => {
    setEditing({ ...branch }); setCreating(false); setError(null); setErrorCode(null); setPressed(false);
  };
  // Typed text is not lost by a stray press on ✕, Escape or the backdrop (the dialog asks first).
  const saved = editing ? branches.find((branch) => branch.id === editing.id) : undefined;
  const dirty = creating
    ? form.code !== '' || form.name !== '' || (form.taxBranchCode ?? '') !== '' || form.type !== EMPTY_FORM.type
    : Boolean(editing && saved && (editing.name !== saved.name || (editing.taxBranchCode ?? '') !== (saved.taxBranchCode ?? '')
      || (editing.phone ?? '') !== (saved.phone ?? '') || editing.status !== saved.status));

  const errorBanner = error && <Notice tone="error" action={
    errorCode === 'plan_branch_limit_exceeded' && permissions.includes('company.plan.manage')
      ? <Link href={`/companies/${companyId}/billing`} className={secondaryButtonClass}>ดูหรือเปลี่ยนแพ็กเกจ</Link>
      : errorCode === 'branch_last_active_required' && canManage && !creating
        ? <button type="button" className={secondaryButtonClass} onClick={openCreate}>สร้างสาขาใหม่ก่อน</button>
        : !creating && !editing
          ? <button type="button" className={secondaryButtonClass} onClick={() => void load()} aria-busy={Boolean(loading)}>ลองอีกครั้ง</button>
          : undefined
  }>{error}</Notice>;

  return (
    <MangmeePage eyebrow="ตั้งค่า" title="สาขา"
      actions={canManage && <button type="button" className={primaryButtonClass} onClick={openCreate}>+ เพิ่มสาขา</button>}>
      {!creating && !editing && errorBanner}
      {savedFromTax && returnHref && <Notice tone="success" action={<Link className="underline" href={returnHref}>กลับไปภาษีหัก ณ ที่จ่าย</Link>}>บันทึกสาขาแล้ว</Notice>}
      {branches.filter(branch => branch.status === 'ACTIVE').length > 1 && <WhtPayerModeSettings companyId={companyId} canAnswer={permissions.includes('company.legal_identity.manage')} returnHref={returnHref} onMode={setPayerMode} />}
      {loading ? <p role="status" className="text-sm text-gray-500">กำลังโหลด…</p> : error && !creating && !editing ? null : branches.length === 0 ?
        <MangmeeCard><p className="p-10 text-center text-sm text-gray-500">ยังไม่มีสาขา{canManage ? ' กดเพิ่มสาขาเพื่อเริ่มต้น' : ''}</p></MangmeeCard> :
      <MangmeeCard className="overflow-hidden">
          <div className="mangmee-table-scroll hidden md:block">
            <table className="mangmee-table">
              <thead><tr><th>ชื่อสาขา</th><th>รหัสสาขา</th><th>ประเภท</th><th>รหัสสาขาภาษี</th><th>สถานะ</th>{canManage && <th><span className="sr-only">จัดการ</span></th>}</tr></thead>
              <tbody>{branches.map(b => <tr key={b.id} data-testid="branch-entry">
                <td className="font-semibold text-gray-900">{b.name}{b.phone && <span className="mangmee-unit block text-sm font-normal text-gray-500">{b.phone}</span>}</td>
                <td>{b.code}</td>
                <td>{TYPE_LABELS[b.type] ?? 'ไม่ทราบประเภท'}</td>
                <td>{b.taxBranchCode ?? 'ยังไม่ระบุ'}</td>
                <td><MangmeeBadge tone={b.status === 'ACTIVE' ? 'brand' : 'slate'}>{STATUS_LABELS[b.status] ?? 'ไม่ทราบสถานะ'}</MangmeeBadge></td>
                {canManage && <td className="text-right"><button type="button" className="mangmee-btn mangmee-btn-secondary" aria-label={`แก้ไขสาขา ${b.name}`} onClick={() => openEdit(b)}>แก้ไข</button></td>}
              </tr>)}</tbody>
            </table>
          </div>
          <div className="divide-y divide-gray-100 md:hidden">{branches.map(b => <div key={b.id} data-testid="branch-entry" className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-3"><h2 className="min-w-0 break-words font-semibold text-gray-900">{b.name}</h2><MangmeeBadge tone={b.status === 'ACTIVE' ? 'brand' : 'slate'}>{STATUS_LABELS[b.status] ?? 'ไม่ทราบสถานะ'}</MangmeeBadge></div>
            <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-gray-500">รหัสสาขา</dt><dd className="mt-1 break-words text-gray-900">{b.code}</dd></div><div><dt className="text-gray-500">ประเภท</dt><dd className="mt-1 text-gray-900">{TYPE_LABELS[b.type] ?? 'ไม่ทราบประเภท'}</dd></div><div><dt className="text-gray-500">รหัสสาขาภาษี</dt><dd className="mt-1 text-gray-900">{b.taxBranchCode ?? 'ยังไม่ระบุ'}</dd></div>{b.phone && <div><dt className="text-gray-500">โทรศัพท์</dt><dd className="mangmee-unit mt-1 text-gray-900">{b.phone}</dd></div>}</dl>
            {canManage && <button type="button" className="mangmee-btn mangmee-btn-secondary w-full" aria-label={`แก้ไขสาขา ${b.name}`} onClick={() => openEdit(b)}>แก้ไข</button>}
          </div>)}</div>
      </MangmeeCard>}
      <Modal open={canManage && (creating || Boolean(editing))} title={creating ? 'เพิ่มสาขา' : `แก้ไขสาขา ${editing?.name ?? ''}`} onClose={onCancel} size="md" dirty={dirty}
        footer={<>
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onCancel}>ยกเลิก</button>
          {creating
            ? <button type="button" className={primaryButtonClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void submitCreate()}>เพิ่มสาขา</button>
            : <button type="button" className={primaryButtonClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void submitEdit()}>บันทึก</button>}
        </>}>
        <div className="grid gap-4">
        {errorBanner}
        {creating && <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="branch-name" label="ชื่อสาขา" value={form.name} placeholder="เช่น สาขาลาดพร้าว"
            error={pressed && !form.name.trim() ? 'กรอกชื่อสาขา' : undefined}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField id="branch-code" label="รหัสสาขา" value={form.code} placeholder="เช่น SIAM"
            hint="ชื่อย่อ ตัวอักษรอังกฤษหรือตัวเลข"
            error={pressed && !form.code.trim() ? 'กรอกรหัสสาขา' : undefined}
            onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <div>
            <span className="mb-2 block text-sm font-medium text-gray-900">ประเภท</span>
            <ThemedSelect aria-label="ประเภท" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as BranchType })}>
              {Object.entries(TYPE_LABELS).filter(([type]) => type !== 'WAREHOUSE').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </ThemedSelect>
          </div>
          <TextField id="branch-tax-code" label="รหัสสาขาภาษี" value={form.taxBranchCode ?? ''} placeholder="เช่น 00001" inputMode="numeric"
            hint="5 หลักตามใบทะเบียนภาษี เว้นว่างได้"
            error={createTaxError ?? undefined}
            onChange={(e) => setForm({ ...form, taxBranchCode: e.target.value })} />
        </div>}
        {editing && <div className="grid gap-4 sm:grid-cols-2">
          <p className="text-sm text-gray-500 sm:col-span-2">รหัสสาขา <span className="mangmee-unit">{editing.code}</span> · {TYPE_LABELS[editing.type]} (แก้ไม่ได้)</p>
          <TextField id="branch-name" label="ชื่อสาขา" value={editing.name}
            error={pressed && !editing.name.trim() ? 'กรอกชื่อสาขา' : undefined}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <TextField id="branch-tax-code" label="รหัสสาขาภาษี" value={editing.taxBranchCode ?? ''} inputMode="numeric"
            hint={payerMode === 'EACH_BRANCH_PAYS' ? 'ใช้รหัส 5 หลักนี้ยื่นแบบภาษีหัก ณ ที่จ่ายในนามสาขาที่จ่าย' : undefined}
            error={editTaxError ?? undefined}
            onChange={(e) => setEditing({ ...editing, taxBranchCode: e.target.value })} />
          <TextField id="branch-phone" label="โทรศัพท์" value={editing.phone ?? ''} inputMode="tel"
            onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
          <div>
            {editing.status !== 'ACTIVE' && branches.find(branch => branch.id === editing.id)?.status === 'ACTIVE' && <p className="mb-3 text-sm text-gray-600">ปิดใช้งานแล้วจะเพิ่มรายการในสาขานี้ไม่ได้ รายการเดิมยังอยู่</p>}
            <span className="mb-2 block text-sm font-medium text-gray-900">สถานะ</span>
            <ThemedSelect aria-label="สถานะ" value={editing.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED'} onChange={(e) => setEditing({ ...editing, status: e.target.value as Branch['status'] })}>
              <option value="ACTIVE">{STATUS_LABELS.ACTIVE}</option>
              <option value="DISABLED">{STATUS_LABELS.DISABLED}</option>
            </ThemedSelect>
          </div>
        </div>}
        </div>
      </Modal>
    </MangmeePage>
  );
}
