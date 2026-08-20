'use client';

import { useState, useEffect, useCallback, useMemo, useRef, type MouseEventHandler, type ReactNode } from 'react';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { EmptyState, LoadingState } from '@/common/components/state';
import { pageBounds } from '@/common/table/paging.logic';
import {
  listManageCategories, createExpenseCategory, updateExpenseCategory,
  listSignatureAssets, initSignatureUpload, createSignatureAsset,
  archiveSignatureAsset, setSignatureDerivedAsset, uploadReceiptFile,
  getSharedEvidence, createAccountantPackage, downloadIndexXlsx,
} from './expenses.api';
import {
  SIGNATURE_ASSET_STATUS_LABELS, SOURCE_DOCUMENT_TYPE_LABELS, TAX_EVIDENCE_STATUS_LABELS, TAX_EVIDENCE_REASON_LABELS,
  EXPENSE_STATUS_LABELS, POSTING_STATUS_LABELS, removeLightBackground, expenseValueLabel,
} from './expenses.model';
import type { ExpenseCategorySummary, SignatureAssetSummary, SharedEvidenceView, AccountantPackageResult } from './expenses.model';
import type { ExpenseBackfillBlocker, ExpenseBackfillPreview } from '@watchdog-bms/contracts';
import { MangmeeBadge, MangmeeCard, MangmeeStatCard, cx } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { findForbiddenChars, stripDisallowed } from '@/common/forms/sanitize';
import { IMAGE_UPLOAD_ACCEPT, assertAllowedUploadFile, uploadErrorMessage } from '@/common/files/upload-file.logic';
import { formatThaiDateTime, formatThaiMonth } from '@/common/i18n/thai-date';
import { SignaturePad } from './SignaturePad';
import { err, baht0, dateShort, inputClass, btnClass, ghostClass, dangerClass, ICON, ErrorBanner, InfoBanner, StateBanner, HowItWorks } from './ExpensesUi';
import {
  deriveEvidenceRowFlags,
  evidenceRowState,
  filterRowsByFlag,
  summarizeEvidenceFlags,
  summarizeEvidenceRows,
  TAX_EVIDENCE_TONE,
  type EvidenceFlagKey,
} from './evidence-audit.logic';
import { generateSourceJournal, previewExpenseBackfill, runExpenseBackfill } from '../ledger/ledger.api';
import { showsTaxCapture, useExpenseCapturePolicy } from './expense-capture-policy';
import { listTaxCodeDefinitions } from '../tax/transaction-tax.api';
import { availableTaxDefinitions } from '../tax/transaction-tax.model';
import { useMenuFilterState } from '../web-core-workspace/MenuFilterScope';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';

/** Mirrors `@MaxLength(255)` on the signature-asset label the API accepts. */
const SIGNATURE_LABEL_MAX_LENGTH = 255;
const SIGNATURE_LABEL_TOO_LONG = `ชื่อ/ป้ายกำกับลายเซ็นยาวได้ไม่เกิน ${SIGNATURE_LABEL_MAX_LENGTH} ตัวอักษร กรุณาย่อให้สั้นลง`;

// A category is a label and an id. Nothing on it is inherited by an expense — the
// accountHintKey/taxCategory the ledger reads live on the expense record and line,
// not here — so the panel deliberately shows no per-category tax attribute.
const BACKFILL_BLOCKER_LABELS: Record<ExpenseBackfillBlocker, string> = {
  NO_ACTIVE_EVIDENCE: 'ไม่มีไฟล์หลักฐาน',
  TAX_EVIDENCE_NEEDS_REVIEW: 'รอตรวจหลักฐานภาษี',
  NOT_TAX_EVIDENCE: 'ไม่ใช่หลักฐานภาษี',
  VENDOR_NAME_MISSING: 'ไม่ระบุผู้ขาย',
};

function Toggle({ on, disabled, onToggle }: { on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={onToggle}
      // The pill stays 24px; the button itself carries the 44px touch height on a phone and
      // the negative margin cancels it out of the layout, so no row shifts. A ::after overlay
      // would have looked equivalent and been invisible to getBoundingClientRect — the thing
      // that measures whether this is really a 44px target.
      className="relative -my-2.5 flex h-11 w-11 flex-shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40 sm:my-0 sm:h-6">
      <span className={cx('relative block h-6 w-11 rounded-full transition', on ? 'bg-brand-500' : 'bg-gray-300')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  );
}
export function IconBtn({ title, tone, disabled, onClick, children }: { title: string; tone?: 'primary' | 'danger'; disabled?: boolean; onClick: MouseEventHandler<HTMLButtonElement>; children: ReactNode }) {
  return (
    // Every colour lives in exactly one branch. The neutral base used to carry `bg-white`
    // unconditionally, and `cx` is a plain join, so the primary tone's `bg-brand-500` lost the
    // cascade to it — the button rendered white with a white glyph, i.e. an empty box.
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className={cx('flex h-11 w-11 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8',
        tone === 'primary' ? 'border-brand-500 bg-brand-500 text-white hover:border-brand-600 hover:bg-brand-600'
          : tone === 'danger' ? 'border-gray-200 bg-white text-error-500 hover:border-[#FECDCA] hover:bg-gray-50'
            : 'border-gray-200 bg-white text-gray-500 hover:border-brand-200 hover:bg-gray-50 hover:text-brand-600')}>
      {children}
    </button>
  );
}

// ── Category management ───────────────────────────────────────────────────────
export function CategoryManagePanel({ companyId }: { companyId: string }) {
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
  // Which row is saving, not merely whether one is: `disabled={updating}` on every row dimmed all
  // seven selects and both toggle columns on a single change, so picking one Tax Code flashed the
  // whole table. The single-writer guard below still reads off this.
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const updating = updatingId !== null;
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // `keepVisible` for the refresh that follows a write: `loading` swaps the whole table for the
  // spinner, so re-reading the list after one selection unmounted all eighteen rows and remounted
  // them, which is the jump users see. Only the first load has nothing to keep on screen.
  const load = useCallback(async (keepVisible = false) => {
    if (!keepVisible) setLoading(true);
    setError(null);
    try { setCategories(await listManageCategories(companyId)); }
    catch (e) { setError(err(e)); }
    finally { if (!keepVisible) setLoading(false); }
  }, [companyId]);
  useEffect(() => { void load(); }, [load]);
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
      toast.success('เพิ่มหมวดหมู่เรียบร้อยแล้ว');
    } catch (e) { setCreateError(err(e)); }
    finally { setSaving(false); }
  };

  const runUpdate = async (id: string, body: Parameters<typeof updateExpenseCategory>[2], successMessage?: string) => {
    if (updating) return;
    setUpdatingId(id);
    setActionError(null);
    try { await updateExpenseCategory(companyId, id, body); await load(true); if (successMessage) toast.success(successMessage); }
    catch (e) { setActionError(err(e)); }
    finally { setUpdatingId(null); }
  };
  const saveName = async (id: string) => {
    const trimmed = editName.trim();
    const forbidden = findForbiddenChars(editName);
    if (forbidden.length > 0) { setActionError(`ห้ามใช้อักขระพิเศษ: ${forbidden.join(' ')}`); return; }
    if (trimmed && trimmed !== categories.find((category) => category.id === id)?.name) await runUpdate(id, { name: trimmed }, 'บันทึกชื่อหมวดหมู่เรียบร้อยแล้ว');
    if (trimmed) setEditId(null);
  };

  const confirmTarget = categories.find((c) => c.id === confirmId);

  return (
    <div>
      <MangmeeCard className="overflow-hidden">
        <div className="mangmee-card-header flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-base font-bold text-gray-900">หมวดหมู่ค่าใช้จ่าย</div>
            <div className="mt-0.5 text-sm text-gray-500">AI จะเลือกได้เฉพาะหมวดหมู่ที่เปิดใช้งานเท่านั้น · ระบบไม่อนุญาตให้ AI สร้าง/แก้ไขหมวดหมู่เอง</div>
          </div>
          <button className={btnClass} onClick={() => { setCreateError(null); setShowCreate(true); }}>+ เพิ่มหมวดหมู่ใหม่</button>
        </div>
        {actionError && <div className="p-4 pb-0"><ErrorBanner message={actionError} /></div>}
        {error ? <div className="p-4"><StateBanner error={error} /></div> : loading ? (
          <LoadingState label="กำลังโหลด..." />
        ) : (
          <div className="overflow-x-auto">
            <table className="mangmee-table">
              <thead><tr>{['ชื่อหมวดหมู่', ...(showsTax ? ['Tax Code เริ่มต้น'] : []), 'ที่มา', 'เปิดใช้', ''].map((h) => <th key={h} className={cx('!text-[13px]', (h === 'ที่มา' || h === 'เปิดใช้') && 'whitespace-nowrap', h === '' && 'w-px whitespace-nowrap text-right')}>{h}</th>)}</tr></thead>
              <tbody>
                {categories.length === 0 && <tr><td colSpan={showsTax ? 5 : 4} className="py-8 text-center text-gray-500">ไม่มีหมวดหมู่</td></tr>}
                {categories.map((c) => {
                  const active = c.status === 'ACTIVE';
                  const owned = !!c.companyId;
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
                      {showsTax && <td className="whitespace-nowrap text-xs">
                        {owned ? (
                          <ThemedSelect className={cx(inputClass, 'h-9 w-auto !text-xs')} value={c.defaultInputTaxCode ?? ''}
                            disabled={updatingId === c.id}
                            onChange={(e) => void runUpdate(c.id, { defaultInputTaxCode: e.target.value || null })}>
                            <option value="">ไม่กำหนด</option>
                            {taxCodes.map((code) => <option key={code.externalCode} value={code.externalCode}>{code.externalCode} · {code.displayName}</option>)}
                          </ThemedSelect>
                        ) : <span className="text-gray-400">{c.defaultInputTaxCode ?? '—'}</span>}
                      </td>}
                      <td className="whitespace-nowrap text-xs text-gray-500">{owned ? 'ของบริษัท' : 'ค่าเริ่มต้นระบบ'}</td>
                      <td className="whitespace-nowrap"><Toggle on={active} disabled={!owned || updatingId === c.id} onToggle={() => runUpdate(c.id, { status: active ? 'ARCHIVED' : 'ACTIVE' }, active ? 'เก็บหมวดหมู่ถาวรเรียบร้อยแล้ว' : 'เปิดใช้งานหมวดหมู่เรียบร้อยแล้ว')} /></td>
                      <td className="w-px whitespace-nowrap text-right">
                        {owned ? (
                          <span className="inline-flex items-center justify-end gap-1.5">
                            {editId !== c.id && <IconBtn title="แก้ชื่อ" onClick={() => { setEditId(c.id); setEditName(c.name); }}>{ICON.edit}</IconBtn>}
                            {active && <IconBtn title="เก็บถาวร" tone="danger" onClick={() => setConfirmId(c.id)}>{ICON.trash}</IconBtn>}
                          </span>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </MangmeeCard>

      <Modal open={showCreate} title="เพิ่มหมวดหมู่ใหม่" size="sm" onClose={() => { if (!saving) setShowCreate(false); }}
        footer={<><button className={ghostClass} onClick={() => setShowCreate(false)} disabled={saving}>ยกเลิก</button><button className={btnClass} onClick={() => void create()} disabled={saving || !name.trim()}>{saving ? 'กำลังบันทึก...' : 'เพิ่มหมวดหมู่'}</button></>}>
          <div className="space-y-3">
          {createError && <ErrorBanner message={createError} />}
          <label className="text-sm font-semibold text-gray-700">ชื่อหมวดหมู่ *</label>
          <input className={inputClass} placeholder="เช่น ค่าโฆษณาออนไลน์" value={name} onChange={(e) => setName(stripDisallowed(e.target.value))} />
          {showsTax && <>
            <label className="text-sm font-semibold text-gray-700">Tax Code เริ่มต้น</label>
            <ThemedSelect className={inputClass} value={newTaxCode} onChange={(e) => setNewTaxCode(e.target.value)}>
              <option value="">ไม่กำหนด</option>
              {taxCodes.map((code) => <option key={code.externalCode} value={code.externalCode}>{code.externalCode} · {code.displayName}</option>)}
            </ThemedSelect>
            <p className="text-xs text-gray-500">ใช้เป็นค่าตั้งต้นของรายการที่ยังไม่ได้เลือก Tax Code เท่านั้น ผู้ตรวจเปลี่ยนได้เสมอ</p>
          </>}
          </div>
      </Modal>

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmId(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-bold text-gray-900">เก็บถาวร “{confirmTarget.name}” ?</div>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">หมวดหมู่ที่เก็บถาวรจะไม่แสดงให้ AI หรือผู้ใช้เลือกอีก แต่รายการเดิมที่ใช้หมวดนี้ยังอยู่ครบ · เปิดใช้ใหม่ได้ทุกเมื่อจากปุ่มสวิตช์</p>
            <div className="mt-4 flex justify-end gap-2">
              <button className={ghostClass} disabled={updating} onClick={() => setConfirmId(null)}>ยกเลิก</button>
              <button className={dangerClass} disabled={updating} onClick={async () => { await runUpdate(confirmTarget.id, { status: 'ARCHIVED' }, 'เก็บหมวดหมู่ถาวรเรียบร้อยแล้ว'); setConfirmId(null); }}>{updating ? 'กำลังเก็บถาวร...' : 'เก็บถาวร'}</button>
            </div>
          </div>
        </div>
      )}
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
  const [preview, setPreview] = useState<{ original: string; derived: string } | null>(null);
  const [derivedBlob, setDerivedBlob] = useState<Blob | null>(null);
  const [method, setMethod] = useState<'upload' | 'draw'>('upload');
  const [saving, setSaving] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
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

  const buildPreview = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setActionError('กรุณาเลือกรูปลายเซ็น (PNG/JPEG)'); return; }
    try { assertAllowedUploadFile(file, 'image'); }
    catch (cause) { setActionError(err(cause)); return; }
    setActionError(null);
    try {
      const url = URL.createObjectURL(file);
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
    } catch (cause) {
      setActionError(uploadErrorMessage(cause));
    }
  };

  const resetDraft = () => {
    setLabel(''); setFileName(''); setPreview(null); setDerivedBlob(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  // `source` is the drawn PNG when the pad produced one — already transparent and cropped, so it
  // needs no derived pass — and the chosen file otherwise.
  const submit = async (withDerived: boolean, source?: File) => {
    const file = source ?? fileRef.current?.files?.[0];
    if (!file) { setActionError('กรุณาเลือกรูปลายเซ็น'); return; }
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
      toast.success('บันทึกลายเซ็นแล้ว ใช้ลงนามได้ทันที');
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
  const current = assets.find((a) => a.status === 'ACTIVE');
  const previous = assets.filter((a) => a.id !== current?.id);
  const focusRefFor = (id: string) => (id === focusSignatureId ? (focusRef as React.RefObject<never>) : undefined);
  const openUpload = () => { setActionError(null); resetDraft(); setMethod('upload'); setShowUpload(true); };

  return (
    <div className="space-y-4">
      <HowItWorks title="ลายเซ็นของฉันทำงานอย่างไร" steps={['เซ็นบนหน้าจอ หรืออัปโหลดรูปลายเซ็น/ตราประทับ (ระบบลบพื้นหลังให้)', 'ใช้ลงนามได้ทันที ไม่ต้องรออนุมัติ และเห็นได้เฉพาะคุณ', 'ประทับลงเอกสารค่าใช้จ่ายจากหน้ารีวิว']} />
      {actionError && <ErrorBanner message={actionError} />}
      <StateBanner error={error} />

      {!error && (
        <div className="space-y-4">
          <MangmeeCard className="overflow-hidden">
            <div className="mangmee-card-header flex items-center justify-between gap-3 text-sm font-bold text-gray-800">
              <span className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-[9px]" style={{ background: '#F4EBFF', color: '#6941C6' }}>{ICON.signature}</span>ลายเซ็นของฉัน</span>
              <button className={btnClass} onClick={openUpload}>{current ? 'เปลี่ยนลายเซ็น' : 'เพิ่มลายเซ็น'}</button>
            </div>
            {loading ? <LoadingState label="กำลังโหลด..." /> : (
              <div className="p-4">
                {current ? (
                  <div
                    ref={focusRefFor(current.id)}
                    className={cx('flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-3',
                      current.id === focusSignatureId && 'border-brand-400 ring-2 ring-brand-200')}
                  >
                    <div className="flex items-center gap-3">
                      {current.previewUrl && <SignatureThumb url={current.previewUrl} alt={current.label ?? 'ลายเซ็นของฉัน'} />}
                      <div>
                        <div className="font-semibold text-gray-800">{current.label ?? 'ลายเซ็นของฉัน'}</div>
                        <div className="text-xs text-gray-500">
                          บันทึกจาก {current.submittedFromChannel === 'LINE' ? 'LINE' : 'เว็บ'} · {dateShort(current.createdAt)}
                          {current.derivedAttachmentId && <span className="ml-2 text-brand-600">พื้นหลังโปร่งใส</span>}
                        </div>
                      </div>
                    </div>
                    <button
                      className={cx(dangerClass, 'h-9 px-3 text-xs')}
                      disabled={busyId === current.id}
                      onClick={() => doAction(() => archiveSignatureAsset(companyId, current.id), 'ลบลายเซ็นเรียบร้อยแล้ว', current.id)}
                    >
                      {busyId === current.id ? 'กำลังดำเนินการ...' : 'ลบลายเซ็น'}
                    </button>
                  </div>
                ) : (
                  <EmptyState title="ยังไม่มีลายเซ็นของคุณ" description="เซ็นบนหน้าจอหรืออัปโหลดรูปลายเซ็น แล้วใช้ลงนามเอกสารได้ทันที" />
                )}

                {previous.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-2 text-xs font-semibold text-gray-500">ลายเซ็นเดิมของฉัน</div>
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
                            {a.previewUrl && <SignatureThumb url={a.previewUrl} alt={a.label ?? 'ลายเซ็น'} className="max-h-12" />}
                            <span className="text-gray-700">{a.label ?? 'ลายเซ็นไม่มีชื่อ'}<span className="ml-2 text-xs text-gray-500">{dateShort(a.createdAt)}</span></span>
                          </span>
                          <span className="flex items-center gap-2">
                            <MangmeeBadge tone={a.status === 'ACTIVE' ? 'brand' : 'slate'}>{expenseValueLabel(SIGNATURE_ASSET_STATUS_LABELS, a.status, 'สถานะลายเซ็นอื่น')}</MangmeeBadge>
                            {a.status !== 'ARCHIVED' && <IconBtn title="ลบลายเซ็น" tone="danger" disabled={busyId === a.id} onClick={() => doAction(() => archiveSignatureAsset(companyId, a.id), 'ลบลายเซ็นเรียบร้อยแล้ว', a.id)}>{ICON.trash}</IconBtn>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </MangmeeCard>

          <Modal open={showUpload} title={current ? 'เปลี่ยนลายเซ็นของฉัน' : 'เพิ่มลายเซ็นของฉัน'} size="md" onClose={() => { if (!saving) setShowUpload(false); }}>
            {actionError && <div className="mb-3"><ErrorBanner message={actionError} /></div>}
            <div className="mt-0.5 mb-3 text-sm text-gray-500">ใช้ลงนามได้ทันทีหลังบันทึก · การประทับทำจากหน้ารีวิวค่าใช้จ่าย{current ? ' · ลายเซ็นใหม่จะถูกใช้แทนอันเดิม' : ''}</div>
            <div className="mb-3 flex gap-2">
              {([['upload', 'อัปโหลดรูป'], ['draw', 'เซ็นบนหน้าจอ']] as const).map(([key, text]) => (
                <button key={key} className={cx(method === key ? btnClass : ghostClass, 'h-9 px-3 text-xs')} disabled={saving} onClick={() => { setMethod(key); setActionError(null); }}>{text}</button>
              ))}
            </div>
            {/* maxLength mirrors the API's own limit. Without it a pasted long label passed the
                whole upload, then failed at the final POST with a generic system error — leaving an
                orphaned PNG in storage and no way to retry successfully. */}
            <input className={cx(inputClass, label.length >= SIGNATURE_LABEL_MAX_LENGTH ? 'mb-1' : 'mb-3')} maxLength={SIGNATURE_LABEL_MAX_LENGTH} placeholder="ชื่อ/ป้ายกำกับ เช่น ลายเซ็นกรรมการ (ไม่บังคับ)" value={label} onChange={(e) => setLabel(stripDisallowed(e.target.value))} />
            {label.length >= SIGNATURE_LABEL_MAX_LENGTH && <p className="mb-3 text-xs font-semibold text-warning-700">{SIGNATURE_LABEL_TOO_LONG}</p>}
            {method === 'draw' ? (
              // The pad exports an already-cropped transparent PNG, so it needs no derived pass.
              <SignaturePad
                busy={saving}
                onChange={() => setActionError(null)}
                onConfirm={(file) => void submit(false, file)}
              />
            ) : (
              <>
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 py-8 text-center text-sm text-gray-500 hover:border-brand-300 hover:bg-brand-25">
                  <span className="text-2xl">✍️</span>
                  {fileName ? <span className="font-semibold text-brand-700">✓ {fileName}</span> : 'เลือกรูปลายเซ็น (PNG/JPEG)'}
                  <input ref={fileRef} type="file" accept={IMAGE_UPLOAD_ACCEPT} className="hidden" onChange={(e) => { setPreview(null); setDerivedBlob(null); setFileName(e.target.files?.[0]?.name ?? ''); }} />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className={ghostClass} onClick={buildPreview} disabled={saving}>ลบพื้นหลัง (ดูตัวอย่าง)</button>
                  <button className={btnClass} onClick={() => submit(!!derivedBlob)} disabled={saving}>{saving ? 'กำลังบันทึก...' : derivedBlob ? 'บันทึกลายเซ็น (พร้อมไฟล์โปร่งใส)' : 'บันทึกลายเซ็น'}</button>
                </div>
                {preview && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="mb-1 text-xs text-gray-500">ต้นฉบับ</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={preview.original} alt="original signature" className="max-h-32 rounded-lg border bg-white" />
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-gray-500">พื้นหลังโปร่งใส</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={preview.derived} alt="derived signature" className="max-h-32 rounded-lg border" style={{ backgroundImage: 'repeating-conic-gradient(#f3f4f6 0% 25%, white 0% 50%)', backgroundSize: '16px 16px' }} />
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
export function EvidencePanel({ companyId, canExport, canReadLedger, canPostLedger, onOpenExpense }: {
  companyId: string;
  canExport: boolean;
  canReadLedger: boolean;
  canPostLedger: boolean;
  onOpenExpense: (expenseId: string) => void;
}) {
  const toast = useToast();
  // Company-level screen with no single document date, so the policy is read for today.
  const showsTax = showsTaxCapture(useExpenseCapturePolicy(companyId).mode);
  const [view, setView] = useState<SharedEvidenceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Menu-scoped like the expense list's period: opening an expense from a folder and coming back
  // keeps the folder. '' means "all months" and has to round-trip as a real stored value.
  const [dateField, setDateField] = useMenuFilterState<'uploadedAt' | 'expenseDate'>('expenses.evidence.dateField', () => 'uploadedAt');
  const [yearMonth, setYearMonth] = useMenuFilterState('expenses.evidence.yearMonth', () => '');
  const [documentStatus, setDocumentStatus] = useState('CONFIRMED');
  const [taxEvidenceStatus, setTaxEvidenceStatus] = useState('');
  const [sourceDocumentType, setSourceDocumentType] = useState('');
  // flagFilter replaces the old attentionOnly checkbox: 'attention' is one of its chips, and the
  // other chips narrow to a specific problem. postingStatus stays a separate dimension.
  const [flagFilter, setFlagFilter] = useState<EvidenceFlagKey | 'all' | 'attention'>('all');
  const [postingStatus, setPostingStatus] = useState('');
  const [page, setPage] = useState(1);
  const [folderPage, setFolderPage] = useState(1);
  const [packageResult, setPackageResult] = useState<AccountantPackageResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const [postingExpenseId, setPostingExpenseId] = useState<string | null>(null);
  const [backfillPreview, setBackfillPreview] = useState<ExpenseBackfillPreview | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setView(await getSharedEvidence(companyId, {
        dateField,
        status: documentStatus,
        ...(yearMonth ? { yearMonth } : {}),
        ...(taxEvidenceStatus ? { taxEvidenceStatus } : {}),
        ...(sourceDocumentType ? { sourceDocumentType } : {}),
        ...(postingStatus ? { postingStatus } : {}),
      }));
    } catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  }, [companyId, dateField, documentStatus, yearMonth, taxEvidenceStatus, sourceDocumentType, postingStatus]);
  useEffect(() => { void load(); }, [load]);

  const exportPackage = async () => {
    setConfirmExport(false);
    setExporting(true); setError(null);
    try {
      const result = await createAccountantPackage(companyId, {
        dateField,
        status: documentStatus,
        // ponytail: this panel is the accounting-office view — always the full column set.
        columnSet: 'full',
        ...(yearMonth ? { yearMonth } : {}),
        ...(taxEvidenceStatus ? { taxEvidenceStatus } : {}),
        ...(sourceDocumentType ? { sourceDocumentType } : {}),
        ...(postingStatus ? { postingStatus } : {}),
      });
      // Same guard as the list page (ebed6dfb): a header-only workbook reads as a broken export.
      if (result.rowCount === 0) { toast.warning('ไม่มีรายการตามตัวกรองในช่วงนี้ จึงยังส่งออกไม่ได้'); return; }
      setPackageResult(result);
      downloadIndexXlsx(result, `expense-index-${yearMonth || 'all'}.xlsx`);
    } catch (e) { setError(err(e)); }
    finally { setExporting(false); }
  };

  const postExpense = async (
    expenseId: string,
    sourceType: 'expense.record' | 'expense.payment',
    sourceId: string,
  ) => {
    setPostingExpenseId(expenseId); setError(null);
    try {
      await generateSourceJournal(companyId, sourceType, sourceId);
      await load();
      toast.success('สร้างสมุดรายวันเรียบร้อยแล้ว');
    } catch (e) { setError(err(e)); }
    finally { setPostingExpenseId(null); }
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
      setBackfillMessage(`ลงบัญชีย้อนหลังสำเร็จ ${result.posted} รายการ · ไม่สำเร็จ ${result.failed} · คงเหลือที่พร้อมลง ${result.remaining} · รอตรวจโดยนักบัญชี ${result.skipped}`);
      setBackfillPreview(null);
      await load();
    } catch (e) { setError(err(e)); }
    finally { setBackfillBusy(false); }
  };

  const downloadManifest = () => {
    if (!packageResult) return;
    const blob = new Blob([JSON.stringify(packageResult.evidenceManifest, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'evidence_manifest.json';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const rows = view?.rows ?? [];
  const total = rows.reduce((s, r) => s + Number(r.grandTotalAmount || 0), 0);
  const summary = summarizeEvidenceRows(rows);
  const flagSummary = summarizeEvidenceFlags(rows);
  const visibleRows = filterRowsByFlag(rows, flagFilter);
  const filterOptions: Array<{ key: EvidenceFlagKey | 'all' | 'attention'; label: string; count: number }> = [
    { key: 'all', label: 'ทั้งหมด', count: rows.length },
    ...(summary.attention > 0 ? [{ key: 'attention' as const, label: '⚠ ต้องตรวจ', count: summary.attention }] : []),
    ...flagSummary,
  ];
  const activeFilterCount = flagFilter === 'all'
    ? rows.length
    : flagFilter === 'attention'
      ? summary.attention
      : flagSummary.find((flag) => flag.key === flagFilter)?.count ?? 0;
  const bounds = useMemo(() => pageBounds(visibleRows.length, page), [visibleRows.length, page]);
  const pagedRows = useMemo(() => visibleRows.slice(bounds.start, bounds.end), [visibleRows, bounds]);
  const folderBounds = useMemo(() => pageBounds(view?.folders.length ?? 0, folderPage, 12), [view?.folders.length, folderPage]);
  const pagedFolders = useMemo(() => (view?.folders ?? []).slice(folderBounds.start, folderBounds.end), [view?.folders, folderBounds]);
  useEffect(() => { if (flagFilter !== 'all' && activeFilterCount === 0) setFlagFilter('all'); }, [activeFilterCount, flagFilter]);
  useEffect(() => { setPage(1); }, [yearMonth, documentStatus, taxEvidenceStatus, sourceDocumentType, postingStatus, flagFilter, view?.dateField]);
  useEffect(() => { setFolderPage(1); }, [view?.dateField]);

  return (
    <div className="space-y-4">
      {/* Step 2 used to promise "คลิกเปิดแก้ได้ทันที". This tab only ever lists CONFIRMED
          documents, and CONFIRMED is locked for editing everywhere — API and UI alike — so the
          promise was false for every row it was shown on. */}
      <HowItWorks title="ส่งหลักฐานให้สำนักงานบัญชีอย่างไร" steps={['ยืนยันเอกสารในแท็บรายการ', 'คลิกแถวที่ขึ้น ⚠ เพื่อเปิดดูรายละเอียด (เอกสารที่ยืนยันแล้วแก้ไขไม่ได้)', 'ส่งออก Excel พร้อมรายการลิงก์ดาวน์โหลดหลักฐานให้สำนักงานบัญชี']} />
      <StateBanner error={error} />
      {backfillMessage && <InfoBanner message={backfillMessage} />}

      {!error && (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[180px] flex-1"><MangmeeStatCard tone="brand" icon={ICON.doc} label={EXPENSE_STATUS_LABELS[documentStatus as keyof typeof EXPENSE_STATUS_LABELS] ?? 'เอกสาร'} value={`${view?.total ?? 0} รายการ`} sub={yearMonth ? formatThaiMonth(yearMonth) : 'ทั้งหมด'} /></div>
            <div className="min-w-[180px] flex-1"><MangmeeStatCard tone="indigo" icon={ICON.wallet} label="มูลค่าในหน้าที่โหลด" value={baht0(total)} sub={`${view?.rows.length ?? 0} รายการล่าสุด`} /></div>
            {/* Toggles the same 'attention' state the filter chips below use, so the card and the
                chip row can never disagree about what is currently filtered. */}
            <button type="button" aria-pressed={flagFilter === 'attention'}
              onClick={() => setFlagFilter((current) => (current === 'attention' ? 'all' : 'attention'))}
              className={cx('min-w-[180px] flex-1 rounded-2xl text-left', flagFilter === 'attention' && 'ring-2 ring-warning-500 ring-offset-2')}>
              <MangmeeStatCard tone="amber" icon="⚠" label="ต้องตรวจเพิ่ม" value={`${summary.attention} รายการ`} sub="คลิกเพื่อดูเฉพาะรายการที่ต้องตรวจ" />
            </button>
          </div>

          <MangmeeCard className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div>
              <div className="mb-1 text-xs font-semibold text-gray-600">เกณฑ์วันที่</div>
              <div className="mangmee-segmented">
                <button className={cx('mangmee-tab', dateField === 'uploadedAt' && 'mangmee-tab-active')} onClick={() => { setDateField('uploadedAt'); setYearMonth(''); }}>วันที่ส่งเข้า</button>
                <button className={cx('mangmee-tab', dateField === 'expenseDate' && 'mangmee-tab-active')} onClick={() => { setDateField('expenseDate'); setYearMonth(''); }}>วันที่เอกสาร</button>
              </div>
            </div>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-600">สถานะเอกสาร</span>
              <ThemedSelect className={cx(inputClass, 'w-auto')} value={documentStatus} onChange={(e) => setDocumentStatus(e.target.value)}>
                <option value="CONFIRMED">{EXPENSE_STATUS_LABELS.CONFIRMED}</option>
                <option value="VOIDED">{EXPENSE_STATUS_LABELS.VOIDED}</option>
              </ThemedSelect>
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-600">ประเภทเอกสาร</span>
              <ThemedSelect className={cx(inputClass, 'w-auto')} value={sourceDocumentType} onChange={(e) => setSourceDocumentType(e.target.value)}>
                <option value="">ทุกประเภทเอกสาร</option>
                {Object.entries(SOURCE_DOCUMENT_TYPE_LABELS).map(([key, labelText]) => <option key={key} value={key}>{labelText}</option>)}
              </ThemedSelect>
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-600">สถานะลงบัญชี</span>
              <ThemedSelect className={cx(inputClass, 'w-auto')} value={postingStatus} onChange={(e) => setPostingStatus(e.target.value)}>
                <option value="">ทุกสถานะลงบัญชี</option>
                {Object.entries(POSTING_STATUS_LABELS).map(([key, labelText]) => <option key={key} value={key}>{labelText}</option>)}
              </ThemedSelect>
            </label>
            {showsTax && <label>
              <span className="mb-1 block text-xs font-semibold text-gray-600">สถานะหลักฐานภาษี</span>
              <ThemedSelect className={cx(inputClass, 'w-auto')} value={taxEvidenceStatus} onChange={(e) => setTaxEvidenceStatus(e.target.value)}>
                <option value="">ทุกสถานะหลักฐานภาษี</option>
                {Object.entries(TAX_EVIDENCE_STATUS_LABELS).map(([key, labelText]) => <option key={key} value={key}>{labelText}</option>)}
              </ThemedSelect>
            </label>}
            {/* No attention checkbox here: that filter now lives in the chip row with the others. */}
            {canPostLedger && <button className={cx(ghostClass, 'sm:ml-auto')} onClick={() => void previewHistoricalBackfill()} disabled={backfillBusy}>{backfillBusy ? 'กำลังตรวจ...' : 'ตรวจรายการเก่าก่อน Auto-post'}</button>}
            {canExport && <button className={cx(btnClass, canPostLedger ? '' : 'sm:ml-auto')} onClick={() => setConfirmExport(true)} disabled={exporting}>{exporting ? 'กำลังสร้าง...' : 'ส่งออกชุดเอกสารให้บัญชี'}</button>}
          </MangmeeCard>

          {/* Themed confirm instead of window.confirm(): the browser dialog ignored the app theme. */}
          <Modal
            open={confirmExport}
            title="ส่งออกชุดเอกสารให้บัญชี"
            size="sm"
            onClose={() => setConfirmExport(false)}
            footer={
              <>
                <button className={ghostClass} onClick={() => setConfirmExport(false)}>ยกเลิก</button>
                <button className={btnClass} onClick={() => void exportPackage()} disabled={exporting}>{exporting ? 'กำลังสร้าง...' : 'ยืนยันส่งออก'}</button>
              </>
            }
          >
            <div className="space-y-3 text-sm">
              <p className="text-gray-600">ระบบจะส่งออกเอกสารตามตัวกรองปัจจุบัน</p>
              {summary.attention > 0 ? (
                <div className="rounded-lg border border-warning-100 bg-warning-50 p-3 text-warning-800">
                  ⚠ พบ {summary.attention} รายการที่มีคำเตือนในหน้าที่โหลด ระบบจะรวมรายการเหล่านี้ในชุดส่งออกด้วย
                </div>
              ) : (
                <p className="text-gray-500">หากมีรายการที่มีคำเตือน ระบบจะรวมไว้ในชุดส่งออกด้วย</p>
              )}
            </div>
          </Modal>

          {loading && !view ? <LoadingState label="กำลังโหลด..." /> : view && (
            <div className={cx('grid grid-cols-1 gap-4 transition-opacity 2xl:grid-cols-[220px_1fr]', loading && 'pointer-events-none opacity-50')}>
              <MangmeeCard className="space-y-1 p-3">
                <div className="mb-2 flex items-center gap-1.5 px-1 text-sm font-semibold text-gray-700"><span className="text-gray-400">{ICON.folder}</span>โฟลเดอร์ ({view.dateField === 'uploadedAt' ? 'วันที่ส่งเข้า' : 'วันที่เอกสาร'})</div>
                <FolderBtn active={yearMonth === ''} label="ทั้งหมด" onClick={() => setYearMonth('')} />
                {pagedFolders.map((folder) => <FolderBtn key={folder.yearMonth} active={yearMonth === folder.yearMonth} label={formatThaiMonth(folder.yearMonth)} count={folder.expenseCount} incomplete={folder.evidenceCount < folder.expenseCount} onClick={() => setYearMonth(folder.yearMonth)} />)}
                {view.folders.length === 0 && (
                  <div className="px-2 py-6 text-center">
                    <div className="text-gray-300">{ICON.folder}</div>
                    <p className="mt-1 text-xs text-gray-400">ยังไม่มีเอกสารในช่วงนี้</p>
                  </div>
                )}
                {folderBounds.totalPages > 1 && (
                  <div className="flex items-center justify-between gap-2 px-1 pt-2 text-xs text-gray-500">
                    <button type="button" aria-label="หน้าก่อนหน้า" className="rounded px-2 py-1 hover:bg-gray-100 disabled:opacity-40"
                      disabled={folderBounds.page <= 1} onClick={() => setFolderPage(folderBounds.page - 1)}>‹</button>
                    <span className="tabular-nums">{folderBounds.page} / {folderBounds.totalPages}</span>
                    <button type="button" aria-label="หน้าถัดไป" className="rounded px-2 py-1 hover:bg-gray-100 disabled:opacity-40"
                      disabled={folderBounds.page >= folderBounds.totalPages} onClick={() => setFolderPage(folderBounds.page + 1)}>›</button>
                  </div>
                )}
              </MangmeeCard>

              <MangmeeCard className="overflow-hidden">
                <div className="flex w-full items-center gap-2 overflow-x-auto border-b border-gray-100 p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:flex-wrap sm:overflow-x-visible">
                  {filterOptions.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      aria-pressed={flagFilter === filter.key}
                      onClick={() => setFlagFilter((current) => current === filter.key && filter.key !== 'all' ? 'all' : filter.key)}
                      className={cx(
                        'inline-flex shrink-0 items-center gap-2 min-h-11 whitespace-nowrap rounded-lg border px-3.5 py-2 text-sm font-semibold transition sm:min-h-0',
                        flagFilter === filter.key
                          ? 'border-brand-400 bg-brand-50 text-brand-700'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-brand-200',
                      )}
                    >
                      {filter.label}
                      <span className={cx(
                        'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-extrabold tabular-nums',
                        flagFilter === filter.key ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500',
                      )}>{filter.count}</span>
                    </button>
                  ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                  {/* เลขที่ค่าใช้จ่าย/ประเภท fold into เอกสาร, ส่งเข้า folds into วันที่, and ไฟล์ is
                      covered by the ไม่มีไฟล์ chip — 12 columns down to 9 without losing a signal. */}
                  <table className="mangmee-table [&_td]:!px-3 [&_th]:!px-3">
                    {/* The หลักฐานภาษี header and its cell below are dropped together — dropping one
                        alone silently shifts every column right of it. */}
                    <thead><tr>{['สถานะ', 'เอกสาร', 'ลงบัญชี', 'วันที่', 'ผู้ขาย', 'ยอดรวม', ...(showsTax ? ['หลักฐานภาษี'] : []), 'สิ่งที่ต้องแก้', ''].map((heading) => <th key={heading} className={cx(
                      '!text-[13px]',
                      heading !== 'สิ่งที่ต้องแก้' && 'whitespace-nowrap',
                      heading === 'ยอดรวม' && 'whitespace-nowrap text-right tabular-nums',
                      heading === '' && 'w-px whitespace-nowrap',
                    )}>{heading}</th>)}</tr></thead>
                    <tbody>
                      {visibleRows.length === 0 && (
                        <tr><td colSpan={showsTax ? 9 : 8}>
                          <EmptyState
                            title={flagFilter === 'attention' ? 'ไม่มีรายการที่ต้องตรวจ' : flagFilter === 'all' ? 'ไม่มีรายการ' : 'ไม่มีรายการที่ตรงกับตัวกรอง'}
                            description={flagFilter === 'attention' ? 'ทุกรายการในช่วงนี้มีหลักฐานครบแล้ว' : flagFilter === 'all' ? 'ลองเลือกเดือนอื่น หรือปรับตัวกรองด้านบน' : 'ลองเลือกทั้งหมด หรือปรับตัวกรองด้านบน'}
                          />
                        </td></tr>
                      )}
                      {pagedRows.map((r) => {
                        const flags = deriveEvidenceRowFlags(r);
                        const rowState = evidenceRowState(flags);
                        const actionFlags = flags.filter((flag) => flag.key === 'NO_FILE' || flag.key === 'NO_VENDOR' || flag.key === 'NO_CATEGORY');
                        const amount = Number(r.grandTotalAmount);
                        return (
                        <tr
                          key={r.expenseId}
                          role="link"
                          tabIndex={0}
                          aria-label={`เปิดรายการค่าใช้จ่าย ${r.expenseNumber ?? r.expenseId}`}
                          className={cx(
                            'cursor-pointer hover:bg-brand-25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500',
                            rowState === 'attention' && 'border-l-4 border-warning-500',
                          )}
                          onClick={() => onOpenExpense(r.expenseId)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onOpenExpense(r.expenseId);
                            }
                          }}
                        >
                          <td className="whitespace-nowrap"><MangmeeBadge tone={rowState === 'attention' ? 'amber' : 'brand'}>{rowState === 'attention' ? '⚠ ต้องตรวจ' : '✓ ครบถ้วน'}</MangmeeBadge></td>
                          <td className="whitespace-nowrap">
                            <div className={cx('text-xs font-bold tabular-nums', r.expenseNumber ? 'text-brand-700' : 'text-gray-400')}>{r.expenseNumber || 'รายการเดิม'}</div>
                            <div className="mt-1 text-xs text-gray-500">{expenseValueLabel(SOURCE_DOCUMENT_TYPE_LABELS, r.sourceDocumentType, 'เอกสารค่าใช้จ่าย')}</div>
                          </td>
                          <td className="whitespace-nowrap text-xs" title={r.postingError ?? undefined}><MangmeeBadge tone={r.postingStatus === 'posted' ? 'brand' : r.postingStatus === 'posting_error' ? 'danger' : r.postingStatus === 'pending' ? 'amber' : 'slate'}>{POSTING_STATUS_LABELS[r.postingStatus]}</MangmeeBadge></td>
                          <td className="whitespace-nowrap text-xs">
                            <div>{dateShort(r.expenseDate)}</div>
                            <div className="mt-1 text-gray-500">ส่งเข้า {dateShort(r.uploadedAt)}</div>
                          </td>
                          <td className="whitespace-nowrap text-xs">{r.vendorNameSnapshot?.trim() || <span className="text-gray-400">—</span>}</td>
                          <td className="whitespace-nowrap text-right text-xs font-semibold tabular-nums">{amount === 0 ? <span className="font-normal text-gray-400">—</span> : amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                          {showsTax && <td className="whitespace-nowrap text-xs" title={r.taxEvidenceReasonCode ? TAX_EVIDENCE_REASON_LABELS[r.taxEvidenceReasonCode] : undefined}><MangmeeBadge tone={TAX_EVIDENCE_TONE[r.taxEvidenceStatus]}>{expenseValueLabel(TAX_EVIDENCE_STATUS_LABELS, r.taxEvidenceStatus, 'รอตรวจหลักฐานภาษี')}</MangmeeBadge></td>}
                          <td className="text-xs">
                            {actionFlags.length > 0 && <div className="flex flex-wrap gap-1.5">{actionFlags.map((flag) => (
                              <MangmeeBadge key={flag.key} tone={flag.severity === 'warn' ? 'amber' : 'slate'} className="whitespace-nowrap">{flag.label}</MangmeeBadge>
                            ))}</div>}
                          </td>
                          <td className="w-px whitespace-nowrap text-xs">
                            {canPostLedger && r.pendingPostingSourceType ? (
                              <button type="button" className={cx(ghostClass, '!min-h-8 !px-2 !py-1 !text-xs')} disabled={postingExpenseId === r.expenseId}
                                onClick={(event) => { event.stopPropagation(); if (r.pendingPostingSourceId) void postExpense(r.expenseId, r.pendingPostingSourceType!, r.pendingPostingSourceId); }}>
                                {postingExpenseId === r.expenseId ? 'กำลังลง...' : r.postingStatus === 'posting_error' ? 'ลองอีกครั้ง' : 'ลงบัญชี'}
                              </button>
                            ) : canReadLedger && r.journalEntryId ? (
                              <a className="font-semibold text-brand-700 hover:underline"
                                href={`/companies/${companyId}/journal?sourceId=${encodeURIComponent(r.expenseId)}`}
                                onClick={(event) => event.stopPropagation()}>
                                {r.journalEntryNumber ?? 'ดู JV'}
                              </a>
                            ) : <span className="text-gray-400">›</span>}
                          </td>
                        </tr>
                      );})}
                    </tbody>
                  </table>
                </div>

                {/* หลักฐานทางบัญชี on a phone. The desktop table stays byte-identical above; this
                    list carries the same signals in reading order — state, document, amount,
                    what needs fixing — with the row action last instead of in a ninth column
                    the thumb never reaches. Reuses the shape shipped for the expenses list. */}
                <div className="space-y-3 p-3 md:hidden" data-testid="evidence-card-list">
                  {pagedRows.map((r) => {
                    const flags = deriveEvidenceRowFlags(r);
                    const rowState = evidenceRowState(flags);
                    const actionFlags = flags.filter((flag) => flag.key === 'NO_FILE' || flag.key === 'NO_VENDOR' || flag.key === 'NO_CATEGORY');
                    const amount = Number(r.grandTotalAmount);
                    return (
                      <MangmeeCard key={r.expenseId} className={cx('overflow-hidden p-0', rowState === 'attention' && 'border-l-4 border-l-warning-500')}>
                        <button
                          type="button"
                          data-testid="evidence-card"
                          aria-label={`เปิดรายการค่าใช้จ่าย ${r.expenseNumber ?? r.expenseId}`}
                          className="block min-h-11 w-full p-4 text-left"
                          onClick={() => onOpenExpense(r.expenseId)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className={cx('truncate text-xs font-bold tabular-nums', r.expenseNumber ? 'text-brand-700' : 'text-gray-400')}>{r.expenseNumber || 'ยังไม่มีเลขที่'}</div>
                              <div className="mt-0.5 truncate text-sm font-semibold text-gray-900">{r.vendorNameSnapshot?.trim() || '—'}</div>
                            </div>
                            <div className="shrink-0 text-right text-sm font-bold tabular-nums text-gray-900">{amount === 0 ? <span className="font-normal text-gray-400">—</span> : amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <MangmeeBadge tone={rowState === 'attention' ? 'amber' : 'brand'}>{rowState === 'attention' ? 'ต้องตรวจ' : 'ครบ'}</MangmeeBadge>
                            <MangmeeBadge tone={r.postingStatus === 'posted' ? 'brand' : 'slate'}>{r.postingStatus === 'posted' ? 'ลงบัญชีแล้ว' : 'ยังไม่ลงบัญชี'}</MangmeeBadge>
                            {actionFlags.map((flag) => (
                              <MangmeeBadge key={flag.key} tone={flag.severity === 'warn' ? 'amber' : 'slate'} className="whitespace-nowrap">{flag.label}</MangmeeBadge>
                            ))}
                          </div>
                          <div className="mt-2 text-xs text-gray-500">{dateShort(r.expenseDate)} · ส่งเข้า {dateShort(r.uploadedAt)}</div>
                        </button>
                        {(canPostLedger && r.pendingPostingSourceType) || (canReadLedger && r.journalEntryId) ? (
                          <div className="border-t border-gray-100 px-4 py-2">
                            {canPostLedger && r.pendingPostingSourceType ? (
                              <button type="button" className={cx(ghostClass, 'w-full')} disabled={postingExpenseId === r.expenseId}
                                onClick={() => { if (r.pendingPostingSourceId) void postExpense(r.expenseId, r.pendingPostingSourceType!, r.pendingPostingSourceId); }}>
                                {postingExpenseId === r.expenseId ? 'กำลังลง...' : r.postingStatus === 'posting_error' ? 'ลองอีกครั้ง' : 'ลงบัญชี'}
                              </button>
                            ) : (
                              <a className="flex min-h-11 items-center justify-center font-semibold text-brand-700 hover:underline"
                                href={`/companies/${companyId}/journal?sourceId=${encodeURIComponent(r.expenseId)}`}>
                                {r.journalEntryNumber ?? 'ดู JV'}
                              </a>
                            )}
                          </div>
                        ) : null}
                      </MangmeeCard>
                    );
                  })}
                </div>

                {visibleRows.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-gray-500">
                    <div className="tabular-nums">แสดง {bounds.from}-{bounds.to} จาก {visibleRows.length} รายการ</div>
                    {bounds.totalPages > 1 && (
                      <div className="flex items-center gap-2">
                        <button type="button" className={cx(ghostClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')}
                          disabled={bounds.page <= 1} onClick={() => setPage(bounds.page - 1)}>ก่อนหน้า</button>
                        <span className="tabular-nums rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">{bounds.page} / {bounds.totalPages}</span>
                        <button type="button" className={cx(ghostClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')}
                          disabled={bounds.page >= bounds.totalPages} onClick={() => setPage(bounds.page + 1)}>ถัดไป</button>
                      </div>
                    )}
                  </div>
                )}
              </MangmeeCard>
            </div>
          )}

          {packageResult && (
            <MangmeeCard className="border-brand-100 bg-brand-25 p-4 text-sm">
              <p className="font-semibold text-brand-700">✓ สร้างชุดเอกสารแล้ว: {packageResult.rowCount} รายการ, ไฟล์หลักฐาน {packageResult.evidenceManifest.length} ไฟล์</p>
              {packageResult.truncated && <p className="mt-1 font-semibold text-warning-700">⚠ ส่งออก {packageResult.rowCount} จากทั้งหมด {packageResult.totalMatched} รายการ กรุณาแบ่งช่วงเดือนหรือปรับตัวกรองแล้วส่งออกอีกครั้ง</p>}
              {packageResult.skippedEvidence.length > 0 && <p className="mt-1 font-semibold text-warning-700">⚠ ข้ามไฟล์แนบ {packageResult.skippedEvidence.length} ไฟล์ที่คุณไม่มีสิทธิ์เปิด ชุดเอกสารนี้จึงยังไม่ครบ</p>}
              <p className="mt-1 text-xs text-gray-500">ดาวน์โหลดไฟล์รายการ Excel แล้ว · ไฟล์รายการหลักฐานมีลิงก์ดาวน์โหลดที่ตรวจสิทธิ์รายไฟล์และมีวันหมดอายุ ({formatThaiDateTime(packageResult.generatedAt)})</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-gray-500">รายการหลักฐาน (JSON) — ลิงก์ดาวน์โหลดไฟล์แนบทุกไฟล์ มีวันหมดอายุ</span>
                <button className={ghostClass} onClick={downloadManifest}>ดาวน์โหลดรายการหลักฐาน (JSON)</button>
              </div>
            </MangmeeCard>
          )}

          <Modal
            open={backfillPreview !== null}
            title="ตรวจรายการย้อนหลัง ก่อนลงบัญชี"
            size="md"
            onClose={() => { if (!backfillBusy) setBackfillPreview(null); }}
            footer={backfillPreview ? (
              <>
                <button className={ghostClass} onClick={() => setBackfillPreview(null)} disabled={backfillBusy}>ยกเลิก</button>
                <button className={btnClass} onClick={() => void confirmHistoricalBackfill()} disabled={backfillBusy || backfillPreview.eligibleCount === 0}>
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
                  <MangmeeStatCard tone="indigo" icon={ICON.doc} label="รอดำเนินการทั้งหมด" value={`${backfillPreview.totalHistoricalPending} รายการ`} sub="ก่อนวันเปิดใช้" />
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
                <p className="text-xs font-semibold text-gray-600">การกด “ยืนยันลงบัญชี” จะผ่านกติกาผังบัญชี ภาษี และงวดบัญชีเดิมทุกข้อ รายการที่ไม่ผ่านจะค้างให้แก้ไขและลองใหม่</p>
              </div>
            )}
          </Modal>
        </>
      )}
    </div>
  );
}

function FolderBtn({ active, label, count, incomplete, onClick }: { active: boolean; label: ReactNode; count?: number; incomplete?: boolean; onClick: () => void }) {
  return (
    <button className={cx('flex w-full items-center justify-between gap-2 min-h-11 rounded-lg px-3 py-2 text-left text-sm font-medium sm:min-h-0', active ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100')} onClick={onClick}>
      <span>{label}</span>
      {count != null && <span className="text-xs text-gray-400">{count} รายการ {incomplete && <span className="text-warning-700" title="บางรายการไม่มีไฟล์หลักฐาน">⚠</span>}</span>}
    </button>
  );
}
