'use client';

import { t } from '@/common/i18n/workspace-i18n.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { IMAGE_SOURCE_TYPES_LABEL, UPLOAD_HEIC_CONVERSION_MESSAGE } from '@watchdog-bms/contracts';

import { useState, useEffect, useCallback, useRef, type MouseEventHandler, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FilterTabs } from '@/common/components/tabs';
import { expenseDetailUrl } from './expense-list-navigation.logic';
import evidenceStyles from './WhtCertificatesPage.module.css';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { EmptyState, ErrorState, LoadingState } from '@/common/components/state';
import { pageBounds } from '@/common/table/paging.logic';
import {
  listManageCategories, createExpenseCategory, updateExpenseCategory,
  listSignatureAssets, initSignatureUpload, createSignatureAsset,
  archiveSignatureAsset, setSignatureDerivedAsset, uploadReceiptFile,
  getSharedEvidence, createAccountantPackage, downloadIndexXlsx,
} from './expenses.api';
import {
  SIGNATURE_ASSET_STATUS_LABELS, SOURCE_DOCUMENT_TYPE_LABELS, TAX_EVIDENCE_STATUS_LABELS,
  EXPENSE_STATUS_LABELS, POSTING_STATUS_LABELS, removeLightBackground, expenseValueLabel,
} from './expenses.model';
import type { ExpenseCategorySummary, SignatureAssetSummary, SharedEvidenceView, AccountantPackageResult } from './expenses.model';
import type { ExpenseBackfillBlocker, ExpenseBackfillPreview } from '@watchdog-bms/contracts';
import { MangmeeBadge, MangmeeCard, MangmeeStatCard, MetricGrid, cx } from '@/common/components/mangmee';
import { Modal, useConfirm } from '@/common/components/modal';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { quietButtonClass } from '@/common/components/button/button-classes';
import { findForbiddenChars, stripDisallowed } from '@/common/forms/sanitize';
import { assertAllowedUploadFile, uploadErrorMessage } from '@/common/files/upload-file.logic';
import { formatThaiDateTime, formatThaiMonth } from '@/common/i18n/thai-date';
import { SignaturePad } from './SignaturePad';
import { err, baht0, amountText, dateShort, inputClass, btnClass, ghostClass, dangerClass, ICON, ErrorBanner, InfoBanner, WholeWords } from './ExpensesUi';
import { Pagination } from '@/common/components/data-table/Pagination';

/** Labels above the filters of the evidence page: 14 px, like every field label of this workspace. */
const FILTER_LABEL = 'mb-1 block text-sm font-medium text-gray-700';
const TAX_EVIDENCE_FILTER_LABEL = 'หลักฐานรายจ่าย';
import {
  deriveEvidenceRowFlags,
  evidenceRowState,
  filterRowsByFlag,
  summarizeEvidenceRows,
  evidenceRowBadge, evidenceRowsInDateOrder, readEvidenceListState,
} from './evidence-audit.logic';
import { previewExpenseBackfill, runExpenseBackfill } from '../ledger/ledger.api';
import { EvidenceBundleDownload } from './EvidenceBundleDownload';
import { ClaimPaymentPosting } from './ClaimPaymentPosting';
import { showsTaxCapture, useExpenseCapturePolicy } from './expense-capture-policy';
import { listTaxCodeDefinitions } from '../tax/transaction-tax.api';
import { availableTaxDefinitions } from '../tax/transaction-tax.model';
import { useBranchFilter, useBranchScopeLabel } from '../web-core-workspace/WorkspaceScope';
import { isBranchScope403 } from '../web-core-workspace/branch-scope-label.logic';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';
import { classifySignatureUploadFile, HeicDecodeError, prepareSignatureFile, SIGNATURE_UPLOAD_ACCEPT } from './expense-upload.logic';

/** Mirrors `@MaxLength(255)` on the signature-asset label the API accepts. */
const SIGNATURE_LABEL_MAX_LENGTH = 255;
const SIGNATURE_LABEL_TOO_LONG = `ชื่อลายเซ็นยาวได้ไม่เกิน ${SIGNATURE_LABEL_MAX_LENGTH} ตัวอักษร`;

// A category is a label and an id. Nothing on it is inherited by an expense — the
// accountHintKey/taxCategory the ledger reads live on the expense record and line,
// not here — so the panel deliberately shows no per-category tax attribute.
const BACKFILL_BLOCKER_LABELS: Record<ExpenseBackfillBlocker, string> = {
  NO_ACTIVE_EVIDENCE: 'ไม่มีไฟล์หลักฐาน',
  TAX_EVIDENCE_NEEDS_REVIEW: 'รอตรวจ',
  NOT_TAX_EVIDENCE: 'ใช้ไม่ได้',
  VENDOR_NAME_MISSING: 'ไม่ระบุผู้ขาย',
};

function Toggle({ on, disabled, loading = false, label, onToggle }: { on: boolean; disabled?: boolean; loading?: boolean; label?: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled || loading} aria-busy={loading} data-loading-indicator onClick={onToggle}
      // The pill stays 24px; the button itself carries the 44px touch height on a phone and
      // the negative margin cancels it out of the layout, so no row shifts. A ::after overlay
      // would have looked equivalent and been invisible to getBoundingClientRect — the thing
      // that measures whether this is really a 44px target.
      className="relative -my-2.5 flex h-11 w-11 flex-shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40 sm:my-0 sm:h-6">
      <span className={cx('relative block h-6 w-11 rounded-full transition', on ? 'bg-brand-500' : 'bg-gray-300')}>
        <span className={cx('absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')}>
          {loading && <span aria-hidden="true" className="action-loading-spinner h-3 w-3 rounded-full border-2 border-gray-500 border-t-transparent" />}
        </span>
      </span>
    </button>
  );
}
export function IconBtn({ title, tone, disabled, loading = false, onClick, children }: { title: string; tone?: 'primary' | 'danger'; disabled?: boolean; loading?: boolean; onClick: MouseEventHandler<HTMLButtonElement>; children: ReactNode }) {
  return (
    // Every colour lives in exactly one branch. The neutral base used to carry `bg-white`
    // unconditionally, and `cx` is a plain join, so the primary tone's `bg-brand-500` lost the
    // cascade to it — the button rendered white with a white glyph, i.e. an empty box.
    <button type="button" title={title} aria-label={title} disabled={disabled || loading} aria-busy={loading} onClick={onClick}
      className={cx('flex h-11 w-11 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8',
        tone === 'primary' ? 'border-brand-500 bg-brand-500 text-white hover:border-brand-600 hover:bg-brand-600'
          : tone === 'danger' ? 'border-gray-200 bg-white text-error-500 hover:border-[#FECDCA] hover:bg-gray-50'
            : 'border-gray-200 bg-white text-gray-500 hover:border-brand-200 hover:bg-gray-50 hover:text-brand-600')}>
      {children}
    </button>
  );
}

// ── Category management ───────────────────────────────────────────────────────
export function CategoryManagePanel({ companyId, createOpen: showCreate, onCreateOpenChange: setShowCreate }: { companyId: string; createOpen: boolean; onCreateOpenChange: (open: boolean) => void }) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  // Company-level screen with no document date, so the policy is read for today.
  const showsTax = showsTaxCapture(useExpenseCapturePolicy(companyId).mode);
  // Codes offered for a standing setting are the ones effective today. Resolution at use time is
  // still per document date, in the line picker — this list only decides what can be chosen here.
  const [taxCodes, setTaxCodes] = useState<Array<{ externalCode: string; displayName: string }>>([]);
  const [newTaxCode, setNewTaxCode] = useState('');
  const [categories, setCategories] = useState<ExpenseCategorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Hold switches and tax selectors while the single writer runs; only its row shows progress.
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const updating = updatingId !== null;
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const loadRequest = useRef(0);

  // `keepVisible` for the refresh that follows a write: `loading` swaps the whole table for the
  // spinner, so re-reading the list after one selection unmounted all eighteen rows and remounted
  // them, which is the jump users see. Only the first load has nothing to keep on screen.
  const load = useCallback(async (keepVisible = false) => {
    const request = ++loadRequest.current;
    if (!keepVisible) setLoading(true);
    setError(null);
    try {
      const next = await listManageCategories(companyId);
      if (request === loadRequest.current) setCategories(next);
    }
    catch (e) { if (request === loadRequest.current) setError(err(e)); }
    finally { if (request === loadRequest.current) setLoading(false); }
  }, [companyId]);
  useEffect(() => { void load(); return () => { loadRequest.current++; }; }, [load]);
  useEffect(() => {
    if (!showsTax) return;
    let cancelled = false;
    listTaxCodeDefinitions(companyId, { transactionContext: 'DOMESTIC_PURCHASE', sourceType: 'expense.record' })
      .then((items) => {
        if (cancelled) return;
        setTaxCodes(availableTaxDefinitions(items, {
          context: 'DOMESTIC_PURCHASE', direction: 'INPUT', documentDate: todayCivilDate(),
        }).map((item) => ({ externalCode: item.externalCode, displayName: item.displayName })));
      })
      // An empty list must not stand in for a failed read: with the codes swallowed, the Tax Code
      // column silently collapses to "ไม่กำหนด" only, which is indistinguishable from a company
      // that genuinely has no codes — and the setting quietly becomes impossible to make. A stale
      // legal acceptance (403 legal_acceptance_required) reaches here exactly that way.
      .catch((cause) => { if (!cancelled) { setTaxCodes([]); setActionError(err(cause)); } });
    return () => { cancelled = true; };
  }, [companyId, showsTax]);

  // The page header opens the dialog; each opening starts without the last refusal.
  useEffect(() => { if (showCreate) setCreateError(null); }, [showCreate]);

  const create = async () => {
    const forbidden = findForbiddenChars(name);
    if (forbidden.length > 0) { setCreateError(`ห้ามใช้อักขระพิเศษ: ${forbidden.join(' ')}`); return; }
    setSaving(true); setCreateError(null);
    try {
      // ponytail: accountHintKey is an internal mapping slug, never user-authored — generate it.
      await createExpenseCategory(companyId, {
        name: name.trim(),
        accountHintKey: `expense.custom.${Date.now()}`,
        ...(showsTax && newTaxCode ? { defaultInputTaxCode: newTaxCode } : {}),
      });
      setName(''); setNewTaxCode('');
      await load(true);
      setShowCreate(false);
      toast.success('เพิ่มหมวดหมู่แล้ว');
    } catch (e) { setCreateError(err(e)); }
    finally { setSaving(false); }
  };

  const runUpdate = async (id: string, body: Parameters<typeof updateExpenseCategory>[2], successMessage?: string): Promise<boolean> => {
    if (updating) return false;
    setUpdatingId(id);
    setActionError(null);
    try { await updateExpenseCategory(companyId, id, body); await load(true); if (successMessage) toast.success(successMessage); return true; }
    catch (e) { setActionError(err(e)); return false; }
    finally { setUpdatingId(null); }
  };
  const saveName = async (id: string) => {
    const trimmed = editName.trim();
    const forbidden = findForbiddenChars(editName);
    if (forbidden.length > 0) { setActionError(`ห้ามใช้อักขระพิเศษ: ${forbidden.join(' ')}`); return; }
    if (!trimmed) return;
    // The dialog closes only when the name is saved (or was not changed): a refused save keeps what was typed.
    if (trimmed === categories.find((category) => category.id === id)?.name || await runUpdate(id, { name: trimmed }, 'แก้ชื่อหมวดหมู่แล้ว')) setEditId(null);
  };

  // One way to stop using a category: its switch. The bin that did the same thing behind a
  // confirmation is gone (a switch that undoes itself needs no question).
  const toggle = (c: ExpenseCategorySummary) => {
    const active = c.status === 'ACTIVE';
    return runUpdate(c.id, { status: active ? 'ARCHIVED' : 'ACTIVE' }, active ? `ปิดหมวดหมู่ “${c.name}” แล้ว เปิดใช้ใหม่ได้ที่สวิตช์` : `เปิดใช้หมวดหมู่ “${c.name}” แล้ว`);
  };
  const editTarget = categories.find((c) => c.id === editId);
  const openRename = (c: ExpenseCategorySummary) => { setActionError(null); setEditId(c.id); setEditName(c.name); };
  const switchWithWord = (c: ExpenseCategorySummary) => {
    const active = c.status === 'ACTIVE';
    return (
      <span className="flex shrink-0 items-center gap-2 text-sm text-gray-600">
        <span>{active ? 'ใช้อยู่' : 'ปิดไว้'}</span>
        <Toggle label={`ใช้หมวดหมู่ ${c.name}`} on={active} disabled={updating} loading={updatingId === c.id} onToggle={() => void toggle(c)} />
      </span>
    );
  };
  const taxCodeSelect = (c: ExpenseCategorySummary) => (
    <ThemedSelect className={cx(inputClass, 'min-w-0 w-full')} value={c.defaultInputTaxCode ?? ''}
      aria-label={`${t('expenses.category_default_tax_code', locale)} ${c.name}`}
      disabled={updating}
      onChange={(e) => void runUpdate(c.id, { defaultInputTaxCode: e.target.value || null })}>
      <option value="">ไม่กำหนด</option>
      {taxCodes.map((code) => <option key={code.externalCode} value={code.externalCode}>{code.displayName}</option>)}
    </ThemedSelect>
  );
  // No controls on a built-in row already says it cannot be changed; the note only says where it came from.
  const builtInNote = <span className="text-sm text-gray-500">มากับระบบ</span>;

  return (
    <div>
      <MangmeeCard className="overflow-hidden">
        {actionError && !editTarget && <div className="p-4 pb-0"><ErrorBanner message={actionError} /></div>}
        {error ? <ErrorState description={error} onRetry={() => void load()} /> : loading ? (
          <LoadingState label="กำลังโหลด..." />
        ) : (
          <>
            {/* Under 640 px each category is a stacked row: the name on its own line at full width, its
                two controls under it. The table that scrolled sideways here kept the name whole but left
                the row's buttons off the screen (2026-10-13). */}
            <ul className="divide-y divide-gray-100 sm:hidden" data-category-rows>
              {categories.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-500">ยังไม่มีหมวดหมู่</li>}
              {categories.map((c) => {
                const owned = !!c.companyId;
                return (
                  <li key={c.id} className={cx('space-y-2 px-4 py-3', c.status !== 'ACTIVE' && 'opacity-60')}>
                    <div className="min-w-0 flex-1 font-semibold text-gray-900">{c.name}</div>
                    {showsTax && owned && <div>{taxCodeSelect(c)}</div>}
                    {owned ? (
                      <div className="flex items-center justify-between gap-3">
                        <button type="button" className={ghostClass} onClick={() => openRename(c)}>แก้ชื่อ</button>
                        {switchWithWord(c)}
                      </div>
                    ) : <div>{builtInNote}</div>}
                  </li>
                );
              })}
            </ul>
            <div className="mangmee-table-scroll hidden sm:block">
              <table className="mangmee-table">
                <thead><tr>{['ชื่อหมวดหมู่', ...(showsTax ? [t('expenses.category_default_tax_code', locale)] : []), 'ใช้งาน', ''].map((h) => <th key={h} className={cx('!text-[13px]', h === 'ใช้งาน' && 'whitespace-nowrap', h === '' && 'w-px whitespace-nowrap text-right')}>{h}</th>)}</tr></thead>
                <tbody>
                  {categories.length === 0 && <tr><td colSpan={showsTax ? 4 : 3} className="py-8 text-center text-gray-500">ยังไม่มีหมวดหมู่</td></tr>}
                  {categories.map((c) => {
                    const owned = !!c.companyId;
                    return (
                      <tr key={c.id} className={c.status === 'ACTIVE' ? '' : 'opacity-60'}>
                        <td className="font-semibold text-gray-900">{c.name}</td>
                        {showsTax && <td className="whitespace-nowrap text-sm">
                          {owned ? taxCodeSelect(c) : <span className="text-gray-500">{c.defaultInputTaxCode ? taxCodes.find((code) => code.externalCode === c.defaultInputTaxCode)?.displayName ?? 'รหัสภาษีเดิม' : 'ไม่กำหนด'}</span>}
                        </td>}
                        {owned ? <>
                          <td className="whitespace-nowrap">{switchWithWord(c)}</td>
                          <td className="w-px whitespace-nowrap text-right"><button type="button" className={ghostClass} onClick={() => openRename(c)}>แก้ชื่อ</button></td>
                        </> : <td colSpan={2} className="whitespace-nowrap">{builtInNote}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </MangmeeCard>

      <Modal open={showCreate} title="เพิ่มหมวดหมู่" size="sm" onClose={() => { if (!saving) setShowCreate(false); }}
        footer={<><button type="button" className={ghostClass} onClick={() => setShowCreate(false)} disabled={saving}>ยกเลิก</button><button type="button" className={btnClass} onClick={() => { if (!name.trim()) { setCreateError('กรอกชื่อหมวดหมู่'); return; } void create(); }} disabled={saving} aria-busy={Boolean(saving)}>{saving ? 'กำลังบันทึก...' : 'เพิ่มหมวดหมู่'}</button></>}>
          <div className="space-y-3">
          {createError && <ErrorBanner message={createError} />}
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-gray-700">ชื่อหมวดหมู่</span>
            <input className={inputClass} placeholder="เช่น ค่าโฆษณาออนไลน์" value={name} onChange={(e) => { setName(stripDisallowed(e.target.value)); setCreateError(null); }} />
          </label>
          {showsTax && <>
            <label className="text-sm font-medium text-gray-700">{t('expenses.category_default_tax_code', locale)}</label>
            <ThemedSelect className={inputClass} value={newTaxCode} onChange={(e) => setNewTaxCode(e.target.value)}>
              <option value="">ไม่กำหนด</option>
              {taxCodes.map((code) => <option key={code.externalCode} value={code.externalCode}>{code.displayName}</option>)}
            </ThemedSelect>
            <p className="text-sm text-gray-500">ใช้เป็นค่าตั้งต้นของรายการที่ยังไม่ได้เลือกรหัสภาษี เปลี่ยนได้ก่อนยืนยันเอกสาร</p>
          </>}
          </div>
      </Modal>

      {/* Renaming happens in the same small dialog as adding, at every width: a box and two buttons
          inside a table cell were cut off on a phone. */}
      <Modal open={Boolean(editTarget)} title="แก้ชื่อหมวดหมู่" size="sm" onClose={() => { if (!updating) setEditId(null); }}
        footer={<><button type="button" className={ghostClass} onClick={() => setEditId(null)} disabled={updating}>ยกเลิก</button><button type="button" className={btnClass} onClick={() => { if (!editName.trim()) { setActionError('กรอกชื่อหมวดหมู่'); return; } if (editTarget) void saveName(editTarget.id); }} disabled={updating} aria-busy={Boolean(updating)}>{updating ? 'กำลังบันทึก...' : 'บันทึก'}</button></>}>
          <div className="space-y-3">
          {actionError && <ErrorBanner message={actionError} />}
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-gray-700">ชื่อหมวดหมู่</span>
            <input autoFocus className={inputClass} value={editName} disabled={updating} onChange={(e) => { setEditName(stripDisallowed(e.target.value)); setActionError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && editTarget && editName.trim()) void saveName(editTarget.id); }} />
          </label>
          </div>
      </Modal>
    </div>
  );
}
// ── Signature assets ──────────────────────────────────────────────────────────
// No asset id can collide with this, so a whole-panel action stays distinguishable from a row's.
const ALL_ROWS_BUSY = '*';

/** A7/A8: the picture, at a size an approver can judge. Checkerboard behind it so a transparent
 *  background reads as transparent rather than as white paper. */
export function SignatureThumb({ url, alt, className }: { url: string; alt: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className={cx('max-h-20 max-w-[180px] rounded-lg border border-gray-200 object-contain', className)}
      style={{ backgroundImage: 'repeating-conic-gradient(#f3f4f6 0% 25%, white 0% 50%)', backgroundSize: '12px 12px' }}
    />
  );
}

/** A claim id as the claim page's link carries it: letters and digits, nothing that could leave the claim's own path. */
export const RETURN_CLAIM_ID = /^[A-Za-z0-9]{8,64}$/;
/** What a signer who came here from a claim is told: before a signature is saved, and once there is one. */
export function signatureReturnText(hasSignature: boolean): string {
  return hasSignature ? 'ลายเซ็นของคุณพร้อมใช้แล้ว กลับไปกดเซ็นในใบเบิกได้เลย' : 'เมื่อบันทึกลายเซ็นแล้ว กลับไปกดเซ็นในใบเบิกได้ทันที';
}

/**
 * "ลายเซ็นของฉัน" (owner decision 2026-08-20, superseding D10/D11). A signature is a personal asset:
 * you keep your own, you are the only one who ever sees it, and it signs from the moment it is
 * saved. There is no queue, no badge and no approve/reject — those all belonged to a model where a
 * second person had to look at the picture, and nobody can verify handwriting anyway.
 *
 */
export function SignaturePanel({ companyId, focusSignatureId }: {
  companyId: string;
  focusSignatureId?: string;
}) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [assets, setAssets] = useState<SignatureAssetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Which row is busy, not merely whether one is — see CategoryManagePanel. The sentinel covers the
  // modal action that belongs to no single row.
  const [busyId, setBusyId] = useState<string | null>(null);
  const actionBusy = busyId !== null;
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [label, setLabel] = useState('');
  const [fileName, setFileName] = useState('');
  const [preparedFile, setPreparedFile] = useState<File | null>(null);
  const [preparingFile, setPreparingFile] = useState(false);
  const prepareRequestRef = useRef(0);
  const [preview, setPreview] = useState<{ original: string; derived: string } | null>(null);
  useEffect(() => { const url = preview?.original; return () => { if (url) URL.revokeObjectURL(url); }; }, [preview?.original]);
  const [derivedBlob, setDerivedBlob] = useState<Blob | null>(null);
  const [method, setMethod] = useState<'upload' | 'draw'>('upload');
  const [saving, setSaving] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const previewPendingRef = useRef(false);
  // F11: a row the caller does not own is absent from the API and therefore never highlighted.
  const focusRef = useRef<HTMLElement>(null);

  // `keepVisible` as in CategoryManagePanel above: a refresh after a write must not swap the table
  // for the spinner, or archiving one signature unmounts and remounts every row.
  const load = useCallback(async (keepVisible = false) => {
    if (!keepVisible) setLoading(true);
    setError(null);
    try { setAssets(await listSignatureAssets(companyId)); }
    catch (e) { setError(err(e)); }
    finally { if (!keepVisible) setLoading(false); }
  }, [companyId]);
  useEffect(() => { void load(); }, [load]);
  // A2: after the rows exist, bring the named one into view. Runs once per id per load.
  useEffect(() => {
    if (focusSignatureId && !loading) focusRef.current?.scrollIntoView({ block: 'center' });
  }, [focusSignatureId, loading, assets]);
  // The claim a signer came from ("ไปหน้าลายเซ็น" in the claim's dialog, `?fromClaim=`): the way back to sign it. A
  // signer who saved a signature here had nothing leading back to the claim that sent them. Only a plain id is
  // taken, and only ever as the last part of this company's own claim page.
  const [fromClaimId, setFromClaimId] = useState('');
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('fromClaim') ?? '';
    setFromClaimId(RETURN_CLAIM_ID.test(id) ? id : '');
  }, []);

  const selectSignatureFile = async (file: File | null) => {
    if (saving || previewPendingRef.current) return;
    const requestId = ++prepareRequestRef.current;
    setPreparedFile(null); setPreparingFile(false); setPreview(null); setDerivedBlob(null); setFileName(file?.name ?? ''); setActionError(null);
    if (!file) return;
    if (classifySignatureUploadFile(file.name, file.type) === 'unsupported') {
      setActionError(`รองรับรูปภาพ (${IMAGE_SOURCE_TYPES_LABEL})`);
      return;
    }
    setPreparingFile(true);
    try {
      const prepared = (await prepareSignatureFile(file)).file;
      assertAllowedUploadFile(prepared, 'image');
      if (requestId === prepareRequestRef.current) setPreparedFile(prepared);
    } catch (cause) {
      if (requestId === prepareRequestRef.current) {
        setActionError(cause instanceof HeicDecodeError
          ? UPLOAD_HEIC_CONVERSION_MESSAGE
          : uploadErrorMessage(cause));
      }
    } finally {
      if (requestId === prepareRequestRef.current) setPreparingFile(false);
    }
  };

  const buildPreview = async () => {
    if (saving || preparingFile || previewPendingRef.current) return;
    const file = preparedFile;
    if (!file) { setActionError('เลือกรูปลายเซ็นก่อน'); return; }
    previewPendingRef.current = true;
    setPreviewing(true);
    setActionError(null);
    let url = '';
    try {
      url = URL.createObjectURL(file);
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('อ่านรูปไม่สำเร็จ')); image.src = url; });
      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) throw new Error('CANVAS_UNSUPPORTED');
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.drawImage(image, 0, 0);
      const cleaned = removeLightBackground(ctx2d.getImageData(0, 0, canvas.width, canvas.height));
      ctx2d.putImageData(cleaned, 0, 0);
      const derivedUrl = canvas.toDataURL('image/png');
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      setDerivedBlob(blob);
      setPreview({ original: url, derived: derivedUrl });
      url = '';
    } catch (cause) {
      setActionError(uploadErrorMessage(cause));
    } finally {
      if (url) URL.revokeObjectURL(url);
      previewPendingRef.current = false;
      setPreviewing(false);
    }
  };

  // Choosing a picture is enough: the cleaned picture is built at once, so there is one button left to press.
  useEffect(() => { if (preparedFile) void buildPreview(); }, [preparedFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetDraft = () => {
    prepareRequestRef.current += 1;
    setLabel(''); setFileName(''); setPreparedFile(null); setPreparingFile(false); setPreview(null); setDerivedBlob(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  // `source` is the drawn PNG when the pad produced one — already transparent and cropped, so it
  // needs no derived pass — and the chosen file otherwise.
  const submit = async (withDerived: boolean, source?: File) => {
    if (saving || preparingFile || previewPendingRef.current) return;
    const file = source ?? preparedFile;
    if (!file) { setActionError('เลือกรูปลายเซ็นก่อน'); return; }
    const forbidden = findForbiddenChars(label);
    if (forbidden.length > 0) { setActionError(`ห้ามใช้อักขระพิเศษ: ${forbidden.join(' ')}`); return; }
    // Checked BEFORE the upload starts: the API rejects an over-long label at the last call, which
    // used to leave the PNG already written to storage with nothing pointing at it.
    if (label.trim().length > SIGNATURE_LABEL_MAX_LENGTH) { setActionError(SIGNATURE_LABEL_TOO_LONG); return; }
    setSaving(true); setActionError(null);
    try {
      const intent = await initSignatureUpload(companyId, { originalFileName: file.name, mimeType: file.type, byteSize: file.size });
      await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders);
      const asset = await createSignatureAsset(companyId, { attachmentId: intent.attachmentId, label: label.trim() || undefined, byteSize: file.size });
      if (withDerived && derivedBlob) {
        const derivedIntent = await initSignatureUpload(companyId, { originalFileName: `derived-${file.name.replace(/\.[a-z]+$/i, '')}.png`, mimeType: 'image/png', byteSize: derivedBlob.size });
        await uploadReceiptFile(
          derivedIntent.uploadUrl,
          derivedIntent.uploadMethod,
          new File([derivedBlob], 'derived.png', { type: 'image/png' }),
          derivedIntent.uploadHeaders,
        );
        await setSignatureDerivedAsset(companyId, asset.id, { attachmentId: derivedIntent.attachmentId, byteSize: derivedBlob.size });
      }
      resetDraft();
      await load(true);
      setShowUpload(false);
      toast.success('บันทึกลายเซ็นแล้ว ใช้เซ็นได้ทันที');
    } catch (e) { setActionError(err(e)); }
    finally { setSaving(false); }
  };

  // `assetId` names the row the action belongs to, so only that row's buttons go busy instead of
  // every row's at once. Omitted by the modal, whose buttons are already about a single target.
  const doAction = async (fn: () => Promise<unknown>, successMessage?: string, assetId?: string) => {
    if (actionBusy) return;
    setBusyId(assetId ?? ALL_ROWS_BUSY);
    setActionError(null);
    try { await fn(); await load(true); if (successMessage) toast.success(successMessage); }
    catch (e) { setActionError(err(e)); }
    finally { setBusyId(null); }
  };

  // The API returns only the caller's rows. Newest-first is the order certification resolves in, so the first live row IS the signature
  // that signs — replacing simply means saving a newer one.
  //
  // At most one row is ACTIVE (D14, enforced by a partial unique index and by the retire-on-create
  // transaction), so this `find` cannot silently promote a second signature into the card the way it
  // did while several ACTIVE rows could pile up: deleting the current one now empties the card.
  const current = assets.find((a) => a.status === 'ACTIVE');
  const previous = assets.filter((a) => a.id !== current?.id);
  const focusRefFor = (id: string) => (id === focusSignatureId ? (focusRef as React.RefObject<never>) : undefined);
  // On a phone the natural way is to sign on the screen; with a mouse, choosing a picture.
  const openUpload = () => { setActionError(null); resetDraft(); setMethod(typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 'draw' : 'upload'); setShowUpload(true); };
  // Deleting cannot be undone (a deleted signature never signs again), so it asks first.
  const removeSignature = async (asset: SignatureAssetSummary) => {
    if (!(await confirm({ title: 'ลบลายเซ็นของฉัน?', message: 'ลบแล้วเซ็นเอกสารใหม่ไม่ได้ จนกว่าจะเพิ่มลายเซ็นใหม่', confirmLabel: 'ลบลายเซ็น', cancelLabel: 'ไม่ลบ' }))) return;
    await doAction(() => archiveSignatureAsset(companyId, asset.id), 'ลบลายเซ็นแล้ว', asset.id);
  };
  const uploadBusy = saving || preparingFile || previewing;

  return (
    <div className="space-y-4">
      {confirmDialog}
      {actionError && !showUpload && <ErrorBanner message={actionError} />}
      {error && <ErrorState description={error} onRetry={() => void load()} />}
      {fromClaimId && !loading && !error && (
        <div className="rounded-xl border border-brand-100 bg-brand-25 px-4 py-3" data-testid="signature-return-to-claim">
          <p className="text-sm text-gray-700">{signatureReturnText(Boolean(current))}</p>
          <Link href={`/companies/${companyId}/reimbursements/${fromClaimId}#reimbursement-signatures`}
            className={cx(current ? btnClass : ghostClass, 'mt-2 min-h-11 w-full sm:w-auto')}>
            กลับไปที่ใบเบิก
          </Link>
        </div>
      )}

      {!error && (
        <div className="space-y-4">
          <MangmeeCard className="overflow-hidden">
            {loading ? <LoadingState label="กำลังโหลด..." /> : (
              <div className="p-4">
                {current ? (
                  <div
                    ref={focusRefFor(current.id)}
                    className={cx('flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-3',
                      current.id === focusSignatureId && 'border-brand-400 ring-2 ring-brand-200')}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {current.previewUrl && <SignatureThumb url={current.previewUrl} alt="ลายเซ็นของฉัน" />}
                      <p className="text-sm text-gray-600">
                        บันทึกเมื่อ <span className="mangmee-unit">{dateShort(current.createdAt)}</span>{current.submittedFromChannel === 'LINE' && ' · จาก LINE'}
                      </p>
                    </div>
                    {/* Rare once a signature exists: neither is the page's main button. */}
                    <ActionGroup>
                      <button type="button" className={dangerClass} disabled={busyId === current.id} aria-busy={Boolean(busyId === current.id)} onClick={() => void removeSignature(current)}>
                        {busyId === current.id ? 'กำลังลบ…' : 'ลบลายเซ็น'}
                      </button>
                      <button type="button" className={ghostClass} onClick={openUpload}>เปลี่ยนลายเซ็น</button>
                    </ActionGroup>
                  </div>
                ) : (
                  // An empty page says what belongs here and offers the one action that fills it.
                  <div className="space-y-3 py-6 text-center">
                    <p className="font-semibold text-gray-800">ยังไม่มีลายเซ็นของคุณ</p>
                    <ActionGroup align="center">
                      <button type="button" className={btnClass} onClick={openUpload}>เพิ่มลายเซ็น</button>
                    </ActionGroup>
                  </div>
                )}

                {previous.length > 0 && (
                  <div className="mt-4">
                    {/* Named for what these rows ARE, not for when they were saved. They are still
                        pictured here, so without saying it the user reads the list as "my signature
                        is still there" right after pressing ลบลายเซ็น. */}
                    <div className="mb-2">
                      <div className="text-sm font-semibold text-gray-600">ลายเซ็นที่เลิกใช้แล้ว</div>
                      <div className="text-sm text-gray-500">ใช้เซ็นใหม่ไม่ได้ เก็บไว้ให้เอกสารที่เซ็นไปแล้วยังใช้ได้</div>
                    </div>
                    <div className="space-y-2">
                      {previous.map((a) => (
                        <div
                          key={a.id}
                          ref={focusRefFor(a.id)}
                          className={cx('flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm',
                            a.status === 'ARCHIVED' && 'opacity-60',
                            a.id === focusSignatureId && 'border-brand-400 ring-2 ring-brand-200')}
                        >
                          <span className="flex items-center gap-3">
                            {a.previewUrl && <SignatureThumb url={a.previewUrl} alt="ลายเซ็นที่เลิกใช้แล้ว" className="max-h-12" />}
                            <span className="text-gray-600">บันทึกเมื่อ <span className="mangmee-unit">{dateShort(a.createdAt)}</span></span>
                          </span>
                          <span className="flex items-center gap-2">
                            <MangmeeBadge tone={a.status === 'ACTIVE' ? 'brand' : 'slate'}>{expenseValueLabel(SIGNATURE_ASSET_STATUS_LABELS, a.status, 'สถานะลายเซ็นอื่น')}</MangmeeBadge>
                            {a.status !== 'ARCHIVED' && <IconBtn title="ลบลายเซ็น" tone="danger" disabled={busyId === a.id} loading={Boolean(busyId === a.id)} onClick={() => void removeSignature(a)}>{ICON.trash}</IconBtn>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </MangmeeCard>

          <Modal open={showUpload} title={current ? 'เปลี่ยนลายเซ็นของฉัน' : 'เพิ่มลายเซ็นของฉัน'} size="md" onClose={() => { if (!uploadBusy) setShowUpload(false); }}
            footer={method === 'upload' ? (
              <>
                <button type="button" className={ghostClass} disabled={uploadBusy} onClick={() => setShowUpload(false)}>ยกเลิก</button>
                <button type="button" className={btnClass} onClick={() => { if (!preparedFile) { setActionError('เลือกรูปลายเซ็นก่อน'); return; } void submit(!!derivedBlob); }} disabled={uploadBusy} aria-busy={Boolean(uploadBusy)}>{previewing ? 'กำลังลบพื้นหลัง...' : preparingFile ? 'กำลังเตรียมรูป...' : saving ? 'กำลังบันทึก...' : 'บันทึกลายเซ็น'}</button>
              </>
            ) : undefined}>
            {actionError && <div className="mb-3"><ErrorBanner message={actionError} /></div>}
            {current && <p className="mb-3 text-sm text-gray-600">ลายเซ็นใหม่จะใช้แทนอันเดิม</p>}
            {/* A choice between two ways, not two actions: a two-part switch, so the dialog keeps one main button. */}
            <div className="mangmee-segmented mb-3" role="group" aria-label="วิธีเพิ่มลายเซ็น">
              {([['draw', 'เซ็นบนหน้าจอ'], ['upload', 'อัปโหลดรูป']] as const).map(([key, text]) => (
                <button key={key} type="button" aria-pressed={method === key} className={cx('mangmee-tab', method === key && 'mangmee-tab-active')} disabled={uploadBusy} onClick={() => { setMethod(key); setActionError(null); }}>{text}</button>
              ))}
            </div>
            {method === 'draw' ? (
              // The pad exports an already-cropped transparent PNG, so it needs no derived pass.
              <SignaturePad
                busy={saving}
                onChange={() => setActionError(null)}
                onConfirm={(file) => void submit(false, file)}
              />
            ) : (
              <>
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 py-8 text-center text-sm text-gray-600 hover:border-brand-300 hover:bg-brand-25">
                  <span className="text-gray-400 [&>svg]:h-8 [&>svg]:w-8">{ICON.upload}</span>
                  {fileName ? <span className="font-semibold text-brand-700 [overflow-wrap:anywhere]">✓ {fileName}</span> : (
                    <>
                      <span>เลือกรูปลายเซ็นหรือถ่ายรูป</span>
                      <span className="text-sm text-gray-500"><WholeWords text={IMAGE_SOURCE_TYPES_LABEL} /></span>
                    </>
                  )}
                  <input ref={fileRef} type="file" accept={SIGNATURE_UPLOAD_ACCEPT} className="hidden" disabled={uploadBusy} onChange={(e) => void selectSignatureFile(e.target.files?.[0] ?? null)} />
                </label>
                {/* The background is taken out as soon as a picture is chosen; the result is shown before saving. */}
                {(preparingFile || previewing) && <p role="status" className="mt-3 text-sm font-semibold text-brand-700">กำลังลบพื้นหลัง...</p>}
                {preview && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="mb-1 text-sm text-gray-500">รูปที่เลือก</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={preview.original} alt="รูปลายเซ็นที่เลือก" className="max-h-32 rounded-lg border bg-white" />
                    </div>
                    <div>
                      <p className="mb-1 text-sm text-gray-500">ลายเซ็นที่จะบันทึก</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={preview.derived} alt="ลายเซ็นที่ลบพื้นหลังแล้ว" className="max-h-32 rounded-lg border" style={{ backgroundImage: 'repeating-conic-gradient(#f3f4f6 0% 25%, white 0% 50%)', backgroundSize: '16px 16px' }} />
                    </div>
                  </div>
                )}
              </>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </Modal>
        </div>
      )}
    </div>
  );
}
// ── Accountant shared evidence + export package ───────────────────────────────
export function EvidencePanel({ companyId, canExport, canReadLedger, canPostLedger, canPostClaimPayments = false }: {
  companyId: string;
  canExport: boolean;
  canReadLedger: boolean;
  canPostLedger: boolean;
  /** May post to the ledger AND read the claim payout worklist (`reimbursement.finance_review`). */
  canPostClaimPayments?: boolean;
}) {
  const toast = useToast();
  const showPosting = canReadLedger || canPostLedger;
  const branchFilter = useBranchFilter();
  const branchId = branchFilter?.branchId ?? '';
  const branchLabel = useBranchScopeLabel();
  const loadVersion = useRef(0);
  const exportScopeVersion = useRef(0);
  // Company-level screen with no single document date, so the policy is read for today.
  const showsTax = showsTaxCapture(useExpenseCapturePolicy(companyId).mode);
  const [view, setView] = useState<SharedEvidenceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = readEvidenceListState(searchParams ?? new URLSearchParams(), todayCivilDate().slice(0, 7));
  const { dateField, yearMonth, documentStatus, taxEvidenceStatus, sourceDocumentType, flagFilter, postingStatus, page, order } = state;
  const update = (patch: Partial<typeof state>) => {
    const query = new URLSearchParams(searchParams?.toString());
    for (const [key, value] of Object.entries({ ...state, page: 1, ...patch })) query.set(key, String(value));
    router.replace(`/companies/${companyId}/expenses/evidence?${query}`, { scroll: false });
  };
  const setYearMonth = (yearMonth: string) => update({ yearMonth });
  const setDateField = (dateField: typeof state.dateField) => update({ dateField });
  const setDocumentStatus = (documentStatus: string) => update({ documentStatus });
  const setTaxEvidenceStatus = (taxEvidenceStatus: string) => update({ taxEvidenceStatus });
  const setSourceDocumentType = (sourceDocumentType: string) => update({ sourceDocumentType });
  const setPostingStatus = (postingStatus: string) => update({ postingStatus });
  const setFlagFilter = (flagFilter: typeof state.flagFilter) => update({ flagFilter });
  const setPage = (page: number) => update({ page });
  const [packageResult, setPackageResult] = useState<AccountantPackageResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportEmpty, setExportEmpty] = useState(false);
  const [backfillPreview, setBackfillPreview] = useState<ExpenseBackfillPreview | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true); setError(null); setView(null);
    try {
      const filters = {
        ...(branchId ? { branchId } : {}),
        dateField,
        status: documentStatus,
        ...(yearMonth ? { yearMonth } : {}),
        ...(taxEvidenceStatus ? { taxEvidenceStatus } : {}),
        ...(sourceDocumentType ? { sourceDocumentType } : {}),
        ...(postingStatus ? { postingStatus } : {}),
      };
      const next = await getSharedEvidence(companyId, { ...filters, page: 1, pageSize: 200 });
      if (version !== loadVersion.current) return;
      for (let nextPage = 2; next.rows.length < next.total; nextPage += 1) {
        if (nextPage > 50) throw new Error('รายการมากเกินไป เลือกเดือนเพื่อดูข้อมูลให้ครบ');
        const more = await getSharedEvidence(companyId, { ...filters, page: nextPage, pageSize: next.pageSize });
        if (version !== loadVersion.current) return;
        if (!more.rows.length) throw new Error('โหลดหลักฐานไม่ครบ ลองอีกครั้ง');
        next.rows.push(...more.rows);
      }
      setView(next);
    } catch (e) {
      if (version !== loadVersion.current) return;
      if (isBranchScope403(e, branchId)) branchFilter?.reportBranchForbidden();
      setError(err(e));
    }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, [companyId, branchId, dateField, documentStatus, yearMonth, taxEvidenceStatus, sourceDocumentType, postingStatus]);
  useEffect(() => { void load(); return () => { loadVersion.current += 1; }; }, [load]);
  useEffect(() => {
    exportScopeVersion.current += 1;
    setPackageResult(null); setExportEmpty(false);
  }, [branchId, dateField, yearMonth, documentStatus, taxEvidenceStatus, sourceDocumentType, postingStatus, flagFilter]);

  const exportPackage = async () => {
    const version = loadVersion.current;
    const scopeVersion = exportScopeVersion.current;
    setExporting(true); setError(null); setExportEmpty(false); setPackageResult(null);
    try {
      const result = await createAccountantPackage(companyId, exportFilters);
      if (version !== loadVersion.current || scopeVersion !== exportScopeVersion.current) return;
      if (result.rowCount + (result.paymentRowCount ?? 0) + (result.withholdingRowCount ?? 0) === 0) { setExportEmpty(true); return; }
      setPackageResult(result);
      downloadIndexXlsx(result, result.indexFileName);
      // Said where the person is looking, the moment it happens.
      toast.success('ดาวน์โหลด Excel แล้ว');
    } catch (e) {
      if (version !== loadVersion.current || scopeVersion !== exportScopeVersion.current) return;
      if (isBranchScope403(e, branchId)) branchFilter?.reportBranchForbidden();
      setError(err(e));
    }
    finally { setExporting(false); }
  };

  const previewHistoricalBackfill = async () => {
    setBackfillBusy(true); setError(null); setBackfillMessage(null);
    try {
      setBackfillPreview(await previewExpenseBackfill(companyId));
    } catch (e) { setError(err(e)); }
    finally { setBackfillBusy(false); }
  };

  const confirmHistoricalBackfill = async () => {
    if (!backfillPreview) return;
    setBackfillBusy(true); setError(null);
    try {
      const result = await runExpenseBackfill(companyId, { confirmed: true, limit: 50 });
      setBackfillMessage(`ลงบัญชีย้อนหลังแล้ว ${result.posted} รายการ · ไม่สำเร็จ ${result.failed} · คงเหลือที่พร้อมลง ${result.remaining} · รอตรวจโดยนักบัญชี ${result.skipped}`);
      setBackfillPreview(null);
      await load();
    } catch (e) { setError(err(e)); }
    finally { setBackfillBusy(false); }
  };


  const rows = view?.rows ?? [];
  const summary = summarizeEvidenceRows(rows);
  const visibleRows = evidenceRowsInDateOrder(filterRowsByFlag(rows, flagFilter), order);
  const total = visibleRows.reduce((s, r) => s + Number(r.grandTotalAmount || 0), 0);
  const exportAttentionCount = summarizeEvidenceRows(visibleRows).attention;
  // The ทั้งหมด tab sends no selection: the server filters below are the view, and a month whose
  // only facts are payments or filed withholding still exports them (R8 keeps a narrowed tab exact).
  const exportFilters = {
    ...(flagFilter === 'all' ? {} : { expenseIds: visibleRows.map((row) => row.expenseId) }),
    ...(branchId ? { branchId } : {}), dateField, status: documentStatus,
    ...(yearMonth ? { yearMonth } : {}),
    ...(taxEvidenceStatus ? { taxEvidenceStatus } : {}),
    ...(sourceDocumentType ? { sourceDocumentType } : {}),
    ...(postingStatus ? { postingStatus } : {}),
  };
  const filterOptions = [
    { key: 'all' as const, label: 'ทั้งหมด', count: !error && view ? rows.length : undefined },
    { key: 'attention' as const, label: 'ต้องแก้', count: !error && view ? summary.attention : undefined },
    { key: 'ok' as const, label: 'ครบแล้ว', count: !error && view ? summary.ok : undefined },
  ];
  const bounds = pageBounds(visibleRows.length, page, 10);
  const pagedRows = visibleRows.slice(bounds.start, bounds.end);
  const listQuery = new URLSearchParams(searchParams?.toString());
  for (const [key, value] of Object.entries(state)) listQuery.set(key, String(value));
  const back = `/companies/${companyId}/expenses/evidence?${listQuery}`;
  const openRow = (row: typeof rows[number]) => router.push(`${expenseDetailUrl(`/companies/${companyId}/expenses`, row.expenseId, back)}${evidenceRowState(deriveEvidenceRowFlags(row)) === 'attention' ? '&section=checks' : ''}`);
  const sortLabel = order === 'newest' ? 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่' : 'วันที่ เก่าไปใหม่ กดเพื่อเรียงใหม่ไปเก่า';
  const toggleOrder = () => update({ order: order === 'newest' ? 'oldest' : 'newest' });
  const months = [...new Set([yearMonth, ...(view?.folders ?? []).map(folder => folder.yearMonth)])].filter(Boolean).sort().reverse();

  return (
    <div className="space-y-4">
      {backfillMessage && <InfoBanner message={backfillMessage} />}
      {canPostClaimPayments && <ClaimPaymentPosting companyId={companyId} />}

      {!error && (
          view && <MangmeeCard className="p-4"><MetricGrid columns={3} items={[
            { key: 'documents', label: 'เอกสาร', value: String(visibleRows.length), unit: 'รายการ', note: `ยอดรวม ${amountText(total)} บาท`, dot: 'bg-brand-500' },
            { key: 'complete', label: 'ครบแล้ว', value: String(visibleRows.length - exportAttentionCount), unit: 'รายการ', dot: 'bg-success-500' },
            { key: 'attention', label: 'ต้องแก้', value: String(exportAttentionCount), unit: 'รายการ', dot: 'bg-warning-500' },
          ]} /></MangmeeCard>
      )}
          {/* One row of filters: which month, how the month is counted, which documents. */}
          <MangmeeCard className="flex min-w-0 flex-col gap-3 p-4 lg:flex-row lg:items-end">
            <label className="min-w-0 flex-1">
              <span className={FILTER_LABEL}>เดือน</span>
              <ThemedSelect className={cx(inputClass, 'min-w-0 w-full')} id="evidence-export-month" aria-label="เดือน" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)}>
                <option value="">ทุกเดือน</option>
                {months.map(month => <option key={month} value={month}>{`${formatThaiMonth(month)}${view ? ` · ${view.folders.find(folder => folder.yearMonth === month)?.expenseCount ?? 0} รายการ` : ''}`}</option>)}
              </ThemedSelect>
            </label>
            <div className="shrink-0">
              <div className={FILTER_LABEL}>นับเดือนตาม</div>
              <div className="mangmee-segmented">
                <button type="button" className={cx('mangmee-tab', dateField === 'uploadedAt' && 'mangmee-tab-active')} onClick={() => { setDateField('uploadedAt'); }}>วันที่ส่งเข้า</button>
                <button type="button" className={cx('mangmee-tab', dateField === 'expenseDate' && 'mangmee-tab-active')} onClick={() => { setDateField('expenseDate'); }}>วันที่เอกสาร</button>
              </div>
            </div>
            <label className="min-w-0 flex-1">
              <span className={FILTER_LABEL}>สถานะเอกสาร</span>
              <ThemedSelect className={cx(inputClass, 'min-w-0 w-full')} value={documentStatus} onChange={(e) => setDocumentStatus(e.target.value)}>
                <option value="CONFIRMED">{EXPENSE_STATUS_LABELS.CONFIRMED}</option>
                <option value="VOIDED">{EXPENSE_STATUS_LABELS.VOIDED}</option>
              </ThemedSelect>
            </label>
            <label className="min-w-0 flex-1">
              <span className={FILTER_LABEL}>ประเภทเอกสาร</span>
              <ThemedSelect className={cx(inputClass, 'min-w-0 w-full')} value={sourceDocumentType} onChange={(e) => setSourceDocumentType(e.target.value)}>
                <option value="">ทุกประเภทเอกสาร</option>
                {Object.entries(SOURCE_DOCUMENT_TYPE_LABELS).map(([key, labelText]) => <option key={key} value={key}>{labelText}</option>)}
              </ThemedSelect>
            </label>
            {showPosting && <label className="min-w-0 flex-1">
              <span className={FILTER_LABEL}>สถานะลงบัญชี</span>
              <ThemedSelect className={cx(inputClass, 'min-w-0 w-full')} value={postingStatus} onChange={(e) => setPostingStatus(e.target.value)}>
                <option value="">ทุกสถานะลงบัญชี</option>
                {Object.entries(POSTING_STATUS_LABELS).map(([key, labelText]) => <option key={key} value={key}>{labelText}</option>)}
              </ThemedSelect>
            </label>}
            {showsTax && <label className="min-w-0 flex-1">
              <span className={FILTER_LABEL}>{TAX_EVIDENCE_FILTER_LABEL}</span>
              <ThemedSelect className={cx(inputClass, 'min-w-0 w-full')} value={taxEvidenceStatus} onChange={(e) => setTaxEvidenceStatus(e.target.value)}>
                <option value="">ทุกคำตอบ</option>
                {Object.entries(TAX_EVIDENCE_STATUS_LABELS).map(([key, labelText]) => <option key={key} value={key}>{labelText}</option>)}
              </ThemedSelect>
            </label>}
            {/* No attention checkbox here: that filter now lives in the chip row with the others. */}
            {canPostLedger && !error && <button type="button" className={cx(ghostClass, 'sm:ml-auto')} onClick={() => void previewHistoricalBackfill()} disabled={backfillBusy} aria-busy={Boolean(backfillBusy)}>{backfillBusy ? 'กำลังตรวจ...' : 'ตรวจรายการเก่าก่อน Auto-post'}</button>}
          </MangmeeCard>

          {!error && dateField === 'expenseDate' && rows.some(row => row.dateStatus === 'unverified' || row.dateStatus === 'implausible') && <p className="text-sm text-gray-600">รายการที่ยังไม่มีวันที่เอกสารนับตามวันที่ส่งเข้า</p>}

          {/* The export: one line says what the file holds (the filters above say which month), and the result is said right here.
              A download can be repeated and undone by deleting a file, so it asks nothing first. */}
          {canExport && !error && (
            <MangmeeCard className="space-y-3 p-4">
              <EvidenceBundleDownload accountant showCounts companyId={companyId} request={exportFilters} enabled={!loading && !!view} key={JSON.stringify([companyId, exportFilters])}
                excelAction={<button type="button" className={ghostClass} onClick={() => void exportPackage()} disabled={exporting || loading} aria-busy={Boolean(exporting || loading)}>{exporting ? 'กำลังสร้าง...' : 'ดาวน์โหลด Excel'}</button>} />
              {exportEmpty && <div className="space-y-2">
                <p role="status" className="text-sm text-gray-700">ไม่มีรายการตามที่เลือก</p>
                <button type="button" className={ghostClass} onClick={() => document.getElementById('evidence-export-month')?.focus()}>เปลี่ยนช่วงวันที่</button>
              </div>}
              {exportAttentionCount > 0 && <p className="text-sm text-gray-500">มี {exportAttentionCount} รายการต้องแก้ ดาวน์โหลดได้ แต่ควรแก้ก่อนส่ง</p>}
              {packageResult && (
                <div className="space-y-1 rounded-xl border border-brand-100 bg-brand-25 p-3 text-sm" role="status">
                  <p className="font-semibold text-brand-700">✓ ดาวน์โหลด Excel แล้ว</p>
                  {packageResult.truncated && <p className="font-semibold text-warning-700">⚠ ส่งออก {packageResult.rowCount} จากทั้งหมด {packageResult.totalMatched} รายการ เลือกเดือนหรือปรับตัวกรองให้แคบลง แล้วส่งออกอีกครั้ง</p>}
                  <p className="text-gray-500">สร้างเมื่อ {formatThaiDateTime(packageResult.generatedAt)}</p>

                </div>
              )}
            </MangmeeCard>
          )}

          <div className={cx('transition-opacity', loading && 'pointer-events-none opacity-50')}>
              <MangmeeCard className={`p-4 ${evidenceStyles.section}`}>
                <FilterTabs aria-label="ความครบของหลักฐาน" value={flagFilter} onChange={setFlagFilter} tabs={filterOptions} className={evidenceStyles.tabs} />
                <button type="button" className={`${quietButtonClass} ${evidenceStyles.phoneSort}`} aria-label={sortLabel} onClick={toggleOrder}>เรียง: {order === 'newest' ? 'ใหม่ไปเก่า ↓' : 'เก่าไปใหม่ ↑'}</button>
                {error ? <>
                  <ErrorState description={error} onRetry={() => void load()} />
                  <Link href={`/companies/${companyId}/expenses`} className={ghostClass}>กลับไปรายการค่าใช้จ่าย</Link>
                </>
                  : loading && !view ? <LoadingState label="กำลังโหลด..." /> : view && <>
                  <table className={evidenceStyles.table}>
                    <colgroup><col style={{ width: '32%' }} /><col style={{ width: '16%' }} /><col style={{ width: '18%' }} /><col style={{ width: '17%' }} /><col style={{ width: '17%' }} /></colgroup>
                    <thead><tr><th>ผู้ขาย</th><th><button type="button" className="min-h-11 text-left" aria-label={sortLabel} onClick={toggleOrder}>วันที่เอกสาร {order === 'newest' ? '↓' : '↑'}</button></th><th>ประเภทเอกสาร</th><th className={evidenceStyles.money}>ยอดรวม (บาท)</th><th className={evidenceStyles.status}>สถานะ</th></tr></thead>
                    <tbody>{!visibleRows.length && <tr><td colSpan={5}><EmptyState title="ไม่มีรายการที่ตรงกับตัวกรอง" description="ลองเลือกเดือนอื่น หรือปรับตัวกรองด้านบน" /></td></tr>}{pagedRows.map(r => <tr key={r.expenseId} role="link" tabIndex={0} aria-label={`เปิดรายการค่าใช้จ่าย ${r.expenseNumber || 'ยังไม่มีเลขที่'}`}
                      onClick={() => openRow(r)} onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); openRow(r); } }}>
                      <td><div className={evidenceStyles.name}>{r.vendorNameSnapshot?.trim() || 'ไม่มีผู้ขาย'}</div><div className={evidenceStyles.number}>{r.expenseNumber || 'ยังไม่มีเลขที่'}</div></td>
                      <td className={evidenceStyles.date}>{dateShort(r.expenseDate)}</td>
                      <td>{r.sourceDocumentTypeLabel ?? expenseValueLabel(SOURCE_DOCUMENT_TYPE_LABELS, r.sourceDocumentType, 'เอกสารค่าใช้จ่าย')}</td>
                      <td className={evidenceStyles.money}>{amountText(r.grandTotalAmount)}</td>
                      <td className={evidenceStyles.status}><MangmeeBadge className={evidenceStyles.badge} tone={evidenceRowState(deriveEvidenceRowFlags(r)) === 'ok' ? 'brand' : 'amber'}>{evidenceRowBadge(r)}</MangmeeBadge></td>
                    </tr>)}</tbody>
                  </table>
                  <div className={evidenceStyles.cards} data-testid="evidence-card-list">{!visibleRows.length && <EmptyState title="ไม่มีรายการที่ตรงกับตัวกรอง" description="ลองเลือกเดือนอื่น หรือปรับตัวกรองด้านบน" />}{pagedRows.map(r => <article key={r.expenseId} className={`mangmee-card ${evidenceStyles.card}`} data-testid="evidence-card" role="link" tabIndex={0} aria-label={`เปิดรายการค่าใช้จ่าย ${r.expenseNumber || 'ยังไม่มีเลขที่'}`}
                    onClick={() => openRow(r)} onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); openRow(r); } }}>
                    <div className={evidenceStyles.heading}><div className={evidenceStyles.name}>{r.vendorNameSnapshot?.trim() || 'ไม่มีผู้ขาย'}</div><div className={`${evidenceStyles.money} text-[15px] font-bold`}>{amountText(r.grandTotalAmount)} บาท</div></div>
                    <div className={evidenceStyles.number}>{r.expenseNumber || 'ยังไม่มีเลขที่'} · {dateShort(r.expenseDate)} · {r.sourceDocumentTypeLabel ?? expenseValueLabel(SOURCE_DOCUMENT_TYPE_LABELS, r.sourceDocumentType, 'เอกสารค่าใช้จ่าย')}</div>
                    <div className="mt-2 text-right"><MangmeeBadge className={evidenceStyles.badge} tone={evidenceRowState(deriveEvidenceRowFlags(r)) === 'ok' ? 'brand' : 'amber'}>{evidenceRowBadge(r)}</MangmeeBadge></div>
                  </article>)}</div>
                {bounds.totalPages > 1 && <div className={evidenceStyles.pager}><Pagination prominent page={bounds.page} totalPages={bounds.totalPages} onPageChange={setPage} /></div>}
                </>}
              </MangmeeCard>
            </div>

          {!error && <Modal
            open={backfillPreview !== null}
            title="ตรวจรายการย้อนหลัง ก่อนลงบัญชี"
            size="md"
            onClose={() => { if (!backfillBusy) setBackfillPreview(null); }}
            footer={backfillPreview ? (
              <>
                <button className={ghostClass} onClick={() => setBackfillPreview(null)} disabled={backfillBusy}>ยกเลิก</button>
                <button className={btnClass} onClick={() => void confirmHistoricalBackfill()} disabled={backfillBusy || backfillPreview.eligibleCount === 0} aria-busy={Boolean(backfillBusy)}>
                  {backfillBusy ? 'กำลังลงบัญชี...' : `ยืนยันลงบัญชี ${Math.min(backfillPreview.eligibleCount, 50)} รายการ`}
                </button>
              </>
            ) : null}
          >
            {backfillPreview && (
              <div className="space-y-4 text-sm">
                <p className="text-gray-600">เฉพาะเอกสารก่อนเปิด Auto-post เมื่อ {formatThaiDateTime(backfillPreview.activationAt)} ระบบจะไม่แตะรายการที่มีคำเตือน</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <MangmeeStatCard tone="brand" icon="✓" label="พร้อมลงบัญชี" value={`${backfillPreview.eligibleCount} รายการ`} sub="ทำครั้งละไม่เกิน 50 รายการ" />
                  <MangmeeStatCard tone="amber" icon="⚠" label="รอนักบัญชีตรวจ" value={`${backfillPreview.manualReviewCount} รายการ`} sub="ไม่ถูก backfill" />
                  <MangmeeStatCard tone="indigo" icon={ICON.doc} label="รอทำทั้งหมด" value={`${backfillPreview.totalHistoricalPending} รายการ`} sub="ก่อนวันเปิดใช้" />
                </div>
                {backfillPreview.manualReviewCount > 0 && (
                  <div className="rounded-lg border border-warning-100 bg-warning-50 p-3 text-xs text-warning-800">
                    {Object.entries(backfillPreview.blockerCounts)
                      .filter(([, count]) => count > 0)
                      .map(([blocker, count]) => `${BACKFILL_BLOCKER_LABELS[blocker as ExpenseBackfillBlocker]} ${count}`)
                      .join(' · ')}
                  </div>
                )}
                {backfillPreview.samples.length > 0 && (
                  <div>
                    <h4 className="mb-2 font-semibold text-gray-800">ตัวอย่างรายการเก่า</h4>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
                      {backfillPreview.samples.map((sample) => (
                        <div key={sample.expenseId} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 last:border-b-0">
                          <div>
                            <div className="font-semibold text-gray-800">{sample.expenseNumber ?? sample.expenseId}</div>
                            <div className="text-xs text-gray-500">{sample.vendorNameSnapshot?.trim() || 'ไม่ระบุผู้ขาย'} · {dateShort(sample.confirmedAt)}</div>
                          </div>
                          <MangmeeBadge tone={sample.blockers.length > 0 ? 'amber' : 'brand'}>
                            {sample.blockers.length > 0 ? sample.blockers.map((blocker) => BACKFILL_BLOCKER_LABELS[blocker]).join(', ') : 'พร้อมลงบัญชี'}
                          </MangmeeBadge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-xs font-semibold text-gray-600">การกด “ยืนยันลงบัญชี” จะผ่านกติกาผังบัญชี ภาษี และงวดบัญชีเดิมทุกข้อ รายการที่ไม่ผ่านจะค้างให้แก้ไขและลองอีกครั้ง</p>
              </div>
            )}
          </Modal>}
    </div>
  );
}
