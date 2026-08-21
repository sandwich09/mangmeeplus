'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { EmptyState } from '@/common/components/state/EmptyState';
import { LoadingState } from '@/common/components/state/LoadingState';
import { createReimbursement, getReimbursement, updateReimbursementDraft, uploadReceiptFile } from './reimbursements.api';
import { ICON, ErrorBanner, inputClass, btnClass, ghostClass } from '../expenses/ExpensesUi';
import { RECEIPT_UPLOAD_ACCEPT } from '../expenses/expense-upload.logic';
import { collectReceiptUploadResults, mergeDraftLineEvidence, validateRequestForm, sumLineAmounts, formatMoney, errorText } from './reimbursements.logic';

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'travel', label: 'เดินทาง' },
  { value: 'meals', label: 'อาหาร' },
  { value: 'supplies', label: 'วัสดุอุปกรณ์' },
  { value: 'accommodation', label: 'ที่พัก' },
  { value: 'other', label: 'อื่น ๆ' },
];
const categoryLabel = (key: string) => CATEGORY_OPTIONS.find(c => c.value === key)?.label ?? key;

type FormLine = {
  incurredDate: string;
  description: string;
  purpose: string;
  categoryKey: string;
  amount: string;
  file: File | null;
  attachmentId?: string | null;
  attachmentFileName?: string;
  linkedExpenseId?: string | null;
};
const emptyLine = (): FormLine => ({ incurredDate: '', description: '', purpose: '', categoryKey: 'travel', amount: '', file: null });
const emptyForm = () => ({ reason: '', currency: 'THB', missingReceiptReason: '', lines: [emptyLine()] });

/** One-line preview of a collapsed row: date · description · amount. */
function lineSummary(line: FormLine): string {
  const parts = [line.incurredDate, line.description.trim(), line.amount ? `${formatMoney(line.amount)} บาท` : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'ยังไม่ได้กรอกข้อมูล';
}

export function ReimbursementCreatePage({ companyId, userId = '', canCreate, requestId, canUpdate = false }: {
  companyId: string;
  userId?: string;
  canCreate: boolean;
  requestId?: string;
  canUpdate?: boolean;
}) {
  const router = useRouter();
  const hubHref = `/companies/${companyId}/reimbursements`;
  const editing = Boolean(requestId);
  const [form, setForm] = useState(emptyForm);
  // Collapsed line indices. Lines stay mounted when collapsed; this only hides them.
  const [collapsedLines, setCollapsedLines] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing && canUpdate);
  const [editLoaded, setEditLoaded] = useState(!editing);
  const [error, setError] = useState<string | null>(null);
  const [correctionNote, setCorrectionNote] = useState<string | null>(null);
  // Set only when the draft was created but its receipts failed to attach. Re-submitting would
  // create a second claim, so the primary action becomes "open the draft" instead.
  const [strandedDraftId, setStrandedDraftId] = useState<string | null>(null);

  useEffect(() => {
    if (!requestId || !canUpdate) return;
    let active = true;
    setLoading(true); setError(null);
    void getReimbursement(companyId, requestId).then(detail => {
      if (!active) return;
      if (detail.status !== 'DRAFT') throw new Error('แก้ไขได้เฉพาะคำขอฉบับร่าง');
      if (detail.requesterUserId !== userId) throw new Error('เฉพาะผู้ขอเท่านั้นที่แก้ไขคำขอนี้ได้');
      setForm({
        reason: detail.reason ?? '',
        currency: detail.currency ?? 'THB',
        missingReceiptReason: detail.missingReceiptReason ?? '',
        lines: (detail.lines ?? []).map((line: any) => ({
          incurredDate: String(line.incurredDate ?? '').slice(0, 10),
          description: line.description ?? '',
          purpose: line.purpose ?? '',
          categoryKey: line.categoryKey ?? 'travel',
          amount: String(line.amount ?? ''),
          file: null,
          attachmentId: line.attachmentId ?? null,
          attachmentFileName: line.attachmentFileName,
          linkedExpenseId: line.linkedExpenseId ?? null,
        })),
      });
      setCorrectionNote(detail.financeReviewStatus === 'NEEDS_INFO' ? detail.financeReviewNote ?? null : null);
      setEditLoaded(true);
    }).catch(e => { if (active) setError(errorText(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canUpdate, companyId, requestId, userId]);

  const setLine = (index: number, patch: Partial<FormLine>) =>
    setForm(f => ({ ...f, lines: f.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  const total = sumLineAmounts(form.lines);
  const allLinesCollapsed = form.lines.every((_line, i) => !!collapsedLines[i]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    const v = validateRequestForm({
      reason: form.reason,
      missingReceiptReason: form.missingReceiptReason,
      lines: form.lines.map(l => ({ ...l, hasReceipt: !!l.file || !!l.attachmentId || !!l.linkedExpenseId })),
    });
    // Expand collapsed rows so the field named in the error is actually visible.
    if (v) { setError(v); setCollapsedLines({}); return; }
    setBusy(true);
    let createdId: string | null = null;
    let receiptFailureMessage: string | null = null;
    let linkedReceiptCount = 0;
    try {
      // The server computes the claim total from these rows — no total is sent.
      const lines = form.lines.map((l, i) => ({
        lineNo: i + 1,
        incurredDate: l.incurredDate,
        description: l.description.trim(),
        purpose: l.purpose.trim() || undefined,
        categoryKey: l.categoryKey,
        categoryLabel: categoryLabel(l.categoryKey),
        amount: l.amount,
      }));
      if (requestId) {
        const results = await Promise.allSettled(form.lines.map(l => (l.file ? uploadReceiptFile(companyId, l.file) : Promise.resolve(null))));
        const { attachmentIds, failedLineNumbers, firstFailure } = collectReceiptUploadResults(results);
        if (failedLineNumbers.length > 0) {
          throw new Error(`แนบไฟล์รายการที่ ${failedLineNumbers.join(', ')} ไม่สำเร็จ: ${errorText(firstFailure)}`);
        }
        await updateReimbursementDraft(companyId, requestId, {
          reason: form.reason.trim(),
          currency: form.currency || undefined,
          missingReceiptReason: form.missingReceiptReason.trim() || null,
          lines: lines.map((line, i) => ({
            ...line,
            ...mergeDraftLineEvidence(form.lines[i], attachmentIds[i]),
          })),
        });
        router.push(`${hubHref}?focus=${encodeURIComponent(requestId)}`);
        return;
      }
      const created = await createReimbursement(companyId, {
        reason: form.reason,
        currency: form.currency || undefined,
        missingReceiptReason: form.missingReceiptReason.trim() || undefined,
        lines,
      });
      createdId = created.id;
      const files = form.lines.map(l => l.file);
      if (files.some(Boolean)) {
        const results = await Promise.allSettled(files.map(f => (f ? uploadReceiptFile(companyId, f) : Promise.resolve(null))));
        const { attachmentIds, failedLineNumbers, firstFailure } = collectReceiptUploadResults(results);
        if (attachmentIds.some(Boolean)) {
          await updateReimbursementDraft(companyId, created.id, {
            lines: lines.map((l, i) => ({ ...l, attachmentId: attachmentIds[i] })),
          });
          linkedReceiptCount = attachmentIds.filter(Boolean).length;
        }
        if (failedLineNumbers.length > 0) {
          receiptFailureMessage = `แนบไฟล์รายการที่ ${failedLineNumbers.join(', ')} ไม่สำเร็จ: ${errorText(firstFailure)}`;
          throw new Error('receipt_upload_failed');
        }
      }
      // Same outcome the inline form had: back to the list, where the new draft is now visible.
      router.push(hubHref);
    } catch (e) {
      setError(createdId
        ? `บันทึกร่างคำขอเบิกแล้ว แต่แนบไฟล์ไม่ครบ: ${receiptFailureMessage ?? errorText(e)}${linkedReceiptCount > 0 ? ` ระบบเก็บไฟล์ที่แนบสำเร็จ ${linkedReceiptCount} รายการไว้แล้ว` : ''} กรุณาเปิดร่างและเลือกไฟล์รายการที่ยังขาดใหม่`
        : errorText(e));
      setStrandedDraftId(createdId);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="กำลังโหลดคำขอ..." />;

  if (editing ? !canUpdate : !canCreate) {
    return (
      <MangmeePage eyebrow={<Link href={hubHref}>← กลับไปการเบิกจ่าย</Link>} title={editing ? 'แก้ไขคำขอเบิก' : 'สร้างคำขอเบิก'}>
        <MangmeeCard className="p-6">
          <EmptyState
            title={editing ? 'ไม่มีสิทธิ์แก้ไขคำขอเบิก' : 'ไม่มีสิทธิ์สร้างคำขอเบิก'}
            description={editing ? 'เฉพาะผู้ขอที่มีสิทธิ์แก้ไขร่างเท่านั้น' : 'บัญชีนี้ยังไม่มีสิทธิ์สร้างคำขอเบิกค่าใช้จ่าย ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์'}
          />
        </MangmeeCard>
      </MangmeePage>
    );
  }

  if (editing && !editLoaded) {
    return (
      <MangmeePage eyebrow={<Link href={hubHref}>← กลับไปการเบิกจ่าย</Link>} title="แก้ไขคำขอเบิก">
        <MangmeeCard className="p-6"><ErrorBanner message={error ?? 'โหลดคำขอไม่สำเร็จ'} /></MangmeeCard>
      </MangmeePage>
    );
  }

  return (
    <MangmeePage
      eyebrow={<Link href={hubHref}>← กลับไปการเบิกจ่าย</Link>}
      title={editing ? 'แก้ไขคำขอเบิก' : 'สร้างคำขอเบิก'}
      description={editing ? 'แก้ไขข้อมูลตามเหตุผลที่ส่งกลับ แล้วบันทึกร่างก่อนส่งอนุมัติใหม่' : 'กรอกเหตุผลและรายการที่ขอเบิก ระบบจะบันทึกเป็นฉบับร่างให้ตรวจก่อนส่งอนุมัติ'}
    >
      {/* noValidate: collapsed rows hide required inputs with CSS, and the browser aborts a
          submit it cannot focus — silently, with no message and no request. validateRequestForm
          covers every field with a Thai, line-numbered message instead. */}
      <form onSubmit={handleCreate} noValidate className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {correctionNote && <ErrorBanner message={`ฝ่ายการเงินขอให้แก้ไข: ${correctionNote}`} />}
          <MangmeeCard className="p-4">
            <h3 className="text-sm font-bold text-gray-900">ข้อมูลคำขอ</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-semibold text-gray-600">เหตุผล *</label>
                <input className={inputClass} required value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
              </div>
              {/* One currency per claim, and only THB is supported — a dropdown of one beats a free-text box that can be typed wrong. */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-gray-600">สกุลเงิน</label>
                <ThemedSelect aria-label="สกุลเงิน" className={inputClass} value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                  <option value="THB">บาท (THB)</option>
                </ThemedSelect>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-gray-600">เหตุผลที่ไม่มีใบเสร็จ (จำเป็นเมื่อมีรายการที่ไม่แนบใบเสร็จ)</label>
                <input aria-label="เหตุผลที่ไม่มีใบเสร็จ" className={inputClass} value={form.missingReceiptReason} onChange={e => setForm(f => ({ ...f, missingReceiptReason: e.target.value }))} />
              </div>
            </div>
          </MangmeeCard>

          <MangmeeCard className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-gray-900">รายการที่ขอเบิก</h3>
                <MangmeeBadge tone="slate">{form.lines.length} รายการ</MangmeeBadge>
              </div>
              {form.lines.length >= 2 && (
                <button type="button" className={cx(ghostClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')}
                  onClick={() => setCollapsedLines(allLinesCollapsed ? {} : Object.fromEntries(form.lines.map((_line, i) => [i, true])))}>
                  {allLinesCollapsed ? 'ขยายทั้งหมด' : 'ย่อทั้งหมด'}
                </button>
              )}
            </div>
            <div className="mt-3 space-y-3">
              {form.lines.map((l, i) => (
                <div key={i} className="rounded-xl border border-gray-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      aria-expanded={!collapsedLines[i]} onClick={() => setCollapsedLines(c => ({ ...c, [i]: !c[i] }))}>
                      <span className={cx('text-gray-400 transition-transform', !collapsedLines[i] && 'rotate-90')}>▶</span>
                      <span className="text-sm font-bold text-gray-700">รายการที่ {i + 1}</span>
                      {collapsedLines[i] && <span className="truncate text-xs text-gray-500">{lineSummary(l)}</span>}
                    </button>
                    {form.lines.length > 1 && (
                      <button type="button" aria-label="ลบรายการ" className="shrink-0 text-error-700 hover:text-error-700"
                        onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_x, j) => j !== i) }))}>{ICON.trash}</button>
                    )}
                  </div>
                  <div className={cx('mt-3 grid gap-3 sm:grid-cols-2', collapsedLines[i] && 'hidden')}>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-600">วันที่ *</label>
                      <ThemedDate aria-label="วันที่" className={inputClass} required value={l.incurredDate} onChange={e => setLine(i, { incurredDate: e.target.value })} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-600">หมวด *</label>
                      <ThemedSelect aria-label="หมวด" className={inputClass} value={l.categoryKey} onChange={e => setLine(i, { categoryKey: e.target.value })}>
                        {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </ThemedSelect>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-xs font-semibold text-gray-600">รายการ *</label>
                      <input aria-label="รายการ" className={inputClass} required value={l.description} onChange={e => setLine(i, { description: e.target.value })} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-600">วัตถุประสงค์</label>
                      <input aria-label="วัตถุประสงค์" className={inputClass} value={l.purpose} onChange={e => setLine(i, { purpose: e.target.value })} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-600">จำนวนเงิน *</label>
                      <input aria-label="จำนวนเงิน" className={inputClass} type="number" step="0.01" required value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-xs font-semibold text-gray-600">ใบเสร็จ</label>
                      <ThemedFile aria-label="ใบเสร็จ" file={l.file} accept={RECEIPT_UPLOAD_ACCEPT} onChange={file => setLine(i, { file })} />
                      {l.attachmentId && !l.file && (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                          <span>ไฟล์เดิม: {l.attachmentFileName ?? 'ใบเสร็จที่แนบไว้'}</span>
                          <button type="button" className="text-error-700 hover:underline" onClick={() => setLine(i, { attachmentId: null, attachmentFileName: undefined })}>นำไฟล์เดิมออก</button>
                        </div>
                      )}
                      {l.linkedExpenseId && !l.file && <p className="mt-2 text-xs text-gray-500">เชื่อมกับค่าใช้จ่ายที่บันทึกไว้</p>}
                      <p className="mt-1 text-xs leading-5 text-gray-400">รองรับ PDF, JPG/JPEG, PNG, HEIC/HEIF และ GIF ระบบจะแปลงรูปให้อัตโนมัติก่อนแนบ</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className={cx(ghostClass, 'mt-3')} onClick={() => {
              setForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }));
              setCollapsedLines(c => ({ ...c, [form.lines.length]: false }));
            }}>+ เพิ่มรายการ</button>
          </MangmeeCard>
        </div>

        <MangmeeCard className="sticky top-4 h-fit p-4">
          <h3 className="text-sm font-bold text-gray-900">สรุปคำขอ</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3"><dt className="text-gray-500">จำนวนรายการ</dt><dd className="font-semibold tabular-nums text-gray-900">{form.lines.length}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-gray-500">มีหลักฐานแล้ว</dt><dd className="font-semibold tabular-nums text-gray-900">{form.lines.filter(l => l.file || l.attachmentId || l.linkedExpenseId).length} / {form.lines.length}</dd></div>
          </dl>
          <div className="my-4 border-t border-gray-100 pt-4">
            <div className="text-xs font-semibold text-gray-500">ยอดรวม</div>
            <div className="mt-2 text-[26px] font-extrabold leading-none tracking-tight tabular-nums text-gray-900">{formatMoney(total)} {form.currency}</div>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="mt-4 space-y-2">
            {strandedDraftId
              ? <Link href={`${hubHref}?focus=${encodeURIComponent(strandedDraftId)}`} className={cx(btnClass, 'w-full')}>เปิดร่างเพื่อแก้ไขไฟล์</Link>
              : <button type="submit" className={cx(btnClass, 'w-full')} disabled={busy}>{busy ? 'กำลังเตรียมไฟล์และบันทึก...' : editing ? 'บันทึกการแก้ไข' : 'บันทึกร่างคำขอเบิก'}</button>}
            <Link href={hubHref} className={cx(ghostClass, 'w-full')}>ยกเลิก</Link>
          </div>
          <p className="mt-3 text-xs leading-5 text-gray-500">ระบบจะบันทึกเป็นฉบับร่าง คุณตรวจสอบและกดส่งอนุมัติได้ภายหลัง</p>
        </MangmeeCard>
      </form>
    </MangmeePage>
  );
}
