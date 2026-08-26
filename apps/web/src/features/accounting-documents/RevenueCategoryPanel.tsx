'use client';

import { useCallback, useEffect, useState, type MouseEventHandler, type ReactNode } from 'react';
import type { RevenueCategorySummary } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { findForbiddenChars, stripDisallowed } from '@/common/forms/sanitize';
import { ErrorBanner, err, inputClass, btnClass, ghostClass, dangerClass, ICON } from '@/features/expenses/ExpensesUi';
import { createRevenueCategory, listManageRevenueCategories, updateRevenueCategory } from './accounting-documents.api';

// หมวดรายรับ (ledger spec F-LED-2) — mirror of the expense CategoryManagePanel, simpler on
// purpose: every row is company-owned (no global defaults by design), and there is no tax-code
// column yet — output-code suggestions wait for accountant-confirmed values (spec §9 answer 5).

function Toggle({ on, disabled, onToggle }: { on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={onToggle}
      className="relative -my-2.5 flex h-11 w-11 flex-shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40 sm:my-0 sm:h-6">
      <span className={cx('relative block h-6 w-11 rounded-full transition', on ? 'bg-brand-500' : 'bg-gray-300')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  );
}

function IconBtn({ title, tone, disabled, onClick, children }: { title: string; tone?: 'danger'; disabled?: boolean; onClick: MouseEventHandler<HTMLButtonElement>; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className={cx('flex h-11 w-11 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8',
        tone === 'danger' ? 'border-gray-200 bg-white text-error-500 hover:border-[#FECDCA] hover:bg-gray-50'
          : 'border-gray-200 bg-white text-gray-500 hover:border-brand-200 hover:bg-gray-50 hover:text-brand-600')}>
      {children}
    </button>
  );
}

export function RevenueCategoryPanel({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [categories, setCategories] = useState<RevenueCategorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const updating = updatingId !== null;
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async (keepVisible = false) => {
    if (!keepVisible) setLoading(true);
    setError(null);
    try { setCategories(await listManageRevenueCategories(companyId)); }
    catch (e) { setError(err(e)); }
    finally { if (!keepVisible) setLoading(false); }
  }, [companyId]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    const forbidden = findForbiddenChars(name);
    if (forbidden.length > 0) { setCreateError(`ห้ามใช้อักขระพิเศษ: ${forbidden.join(' ')}`); return; }
    setSaving(true); setCreateError(null);
    try {
      // accountHintKey is an internal mapping slug, never user-authored — generate it.
      await createRevenueCategory(companyId, { name: name.trim(), accountHintKey: `revenue.custom.${Date.now()}` });
      setName('');
      await load(true);
      setShowCreate(false);
      toast.success('เพิ่มหมวดรายรับเรียบร้อยแล้ว');
    } catch (e) { setCreateError(err(e)); }
    finally { setSaving(false); }
  };

  const runUpdate = async (id: string, body: Parameters<typeof updateRevenueCategory>[2], successMessage?: string) => {
    if (updating) return;
    setUpdatingId(id);
    setActionError(null);
    try { await updateRevenueCategory(companyId, id, body); await load(true); if (successMessage) toast.success(successMessage); }
    catch (e) { setActionError(err(e)); }
    finally { setUpdatingId(null); }
  };
  const saveName = async (id: string) => {
    const trimmed = editName.trim();
    const forbidden = findForbiddenChars(editName);
    if (forbidden.length > 0) { setActionError(`ห้ามใช้อักขระพิเศษ: ${forbidden.join(' ')}`); return; }
    if (trimmed && trimmed !== categories.find((category) => category.id === id)?.name) await runUpdate(id, { name: trimmed }, 'บันทึกชื่อหมวดเรียบร้อยแล้ว');
    if (trimmed) setEditId(null);
  };

  const confirmTarget = categories.find((c) => c.id === confirmId);

  return (
    <MangmeePage
      eyebrow="การเงินและบัญชี"
      title="หมวดรายรับ"
      description="หมวดสำหรับจัดกลุ่มรายรับในเอกสารขายและสมุดรายรับ–รายจ่าย · หมวดที่มีรายการแล้วปิดใช้ได้แต่ลบไม่ได้"
    >
      <MangmeeCard className="overflow-hidden">
        <div className="mangmee-card-header flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-base font-bold text-gray-900">หมวดรายรับของบริษัท</div>
            <div className="mt-0.5 text-sm text-gray-500">รายการที่ปิดใช้จะไม่แสดงในตัวเลือกของเอกสารใหม่ แต่เอกสารเดิมไม่เปลี่ยน</div>
          </div>
          <button className={btnClass} onClick={() => { setCreateError(null); setShowCreate(true); }}>+ เพิ่มหมวดใหม่</button>
        </div>
        {actionError && <div className="p-4 pb-0"><ErrorBanner message={actionError} /></div>}
        {error ? <div className="p-4"><ErrorBanner message={error} /></div> : loading ? (
          <LoadingState label="กำลังโหลด..." />
        ) : (
          <div className="overflow-x-auto">
            <table className="mangmee-table">
              <thead><tr>{['ชื่อหมวด', 'เปิดใช้', ''].map((h) => <th key={h} className={cx('!text-[13px]', h === 'เปิดใช้' && 'whitespace-nowrap', h === '' && 'w-px whitespace-nowrap text-right')}>{h}</th>)}</tr></thead>
              <tbody>
                {categories.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-gray-500">ยังไม่มีหมวดรายรับ</td></tr>}
                {categories.map((c) => {
                  const active = c.status === 'ACTIVE';
                  return (
                    <tr key={c.id} className={active ? '' : 'opacity-60'}>
                      <td className="font-semibold text-gray-900">
                        {editId === c.id ? (
                          <span className="flex min-w-64 items-center gap-2">
                            <input autoFocus className="mangmee-input h-9" value={editName} disabled={updating} onChange={(e) => setEditName(stripDisallowed(e.target.value))}
                              onKeyDown={(e) => { if (e.key === 'Enter') void saveName(c.id); if (e.key === 'Escape') setEditId(null); }} />
                            <button className={cx(btnClass, 'h-9 px-3 text-xs')} disabled={updating || !editName.trim() || editName.trim() === c.name} onClick={() => void saveName(c.id)}>{updating ? 'กำลังบันทึก...' : 'บันทึก'}</button>
                            <button className={cx(ghostClass, 'h-9 px-3 text-xs')} disabled={updating} onClick={() => setEditId(null)}>ยกเลิก</button>
                          </span>
                        ) : c.name}
                      </td>
                      <td className="whitespace-nowrap"><Toggle on={active} disabled={updatingId === c.id} onToggle={() => runUpdate(c.id, { status: active ? 'ARCHIVED' : 'ACTIVE' }, active ? 'ปิดใช้หมวดเรียบร้อยแล้ว' : 'เปิดใช้หมวดเรียบร้อยแล้ว')} /></td>
                      <td className="w-px whitespace-nowrap text-right">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {editId !== c.id && <IconBtn title="แก้ชื่อ" onClick={() => { setEditId(c.id); setEditName(c.name); }}>{ICON.edit}</IconBtn>}
                          {active && <IconBtn title="ปิดใช้" tone="danger" onClick={() => setConfirmId(c.id)}>{ICON.trash}</IconBtn>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </MangmeeCard>

      <Modal open={showCreate} title="เพิ่มหมวดรายรับใหม่" size="sm" onClose={() => { if (!saving) setShowCreate(false); }}
        footer={<><button className={ghostClass} onClick={() => setShowCreate(false)} disabled={saving}>ยกเลิก</button><button className={btnClass} onClick={() => void create()} disabled={saving || !name.trim()}>{saving ? 'กำลังบันทึก...' : 'เพิ่มหมวด'}</button></>}>
        <div className="space-y-3">
          {createError && <ErrorBanner message={createError} />}
          <label className="text-sm font-semibold text-gray-700">ชื่อหมวด *</label>
          <input className={inputClass} placeholder="เช่น ค่าจัดส่ง" value={name} onChange={(e) => setName(stripDisallowed(e.target.value))} />
        </div>
      </Modal>

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmId(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-bold text-gray-900">ปิดใช้ “{confirmTarget.name}” ?</div>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">หมวดที่ปิดใช้จะไม่แสดงให้เลือกในเอกสารใหม่ แต่เอกสารเดิมที่ใช้หมวดนี้ยังอยู่ครบ · เปิดใช้ใหม่ได้ทุกเมื่อจากปุ่มสวิตช์</p>
            <div className="mt-4 flex justify-end gap-2">
              <button className={ghostClass} disabled={updating} onClick={() => setConfirmId(null)}>ยกเลิก</button>
              <button className={dangerClass} disabled={updating} onClick={async () => { await runUpdate(confirmTarget.id, { status: 'ARCHIVED' }, 'ปิดใช้หมวดเรียบร้อยแล้ว'); setConfirmId(null); }}>{updating ? 'กำลังปิดใช้...' : 'ปิดใช้'}</button>
            </div>
          </div>
        </div>
      )}
    </MangmeePage>
  );
}
