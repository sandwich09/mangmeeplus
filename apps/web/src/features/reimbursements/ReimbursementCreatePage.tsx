'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { reimbursementIncurredDateError, todayCivilDate, type ReimbursementSourceOption, type ReimbursementSourceOptions, type ReimbursementSourceSnapshot } from '@watchdog-bms/contracts';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { EmptyState } from '@/common/components/state/EmptyState';
import { LoadingState } from '@/common/components/state/LoadingState';
import { createReimbursement, getReimbursementSourceOptions, getReimbursement, updateReimbursementDraft, uploadReceiptFile } from './reimbursements.api';
import { ICON, ErrorBanner, inputClass, btnClass, ghostClass } from '../expenses/ExpensesUi';
import { RECEIPT_UPLOAD_ACCEPT } from '../expenses/expense-upload.logic';
import { collectReceiptUploadResults, mergeDraftLineEvidence, validateRequestForm, errorMessage, sumLineAmounts, formatMoney, errorText } from './reimbursements.logic';
import { TransactionBranchField, useTransactionCreateBranchId } from '../web-core-workspace/TransactionBranchField';
import { ReimbursementSourceFacts } from './ReimbursementSourceFacts';
import { REIMBURSEMENT_CREATE_UNAVAILABLE } from './reimbursements.model';

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
  sourceExpenseUpdatedAt?: string;
  sourceExpenseSnapshot?: ReimbursementSourceSnapshot;
  categoryLabel?: string;
};
const emptyLine = (): FormLine => ({ incurredDate: '', description: '', purpose: '', categoryKey: 'travel', amount: '', file: null,
  attachmentId: null, attachmentFileName: undefined, linkedExpenseId: null, sourceExpenseUpdatedAt: undefined, sourceExpenseSnapshot: undefined, categoryLabel: undefined });
const emptyForm = () => ({ reason: '', currency: 'THB', missingReceiptReason: '', lines: [emptyLine()] });

/** One-line preview of a collapsed row: date · description · amount. */
function lineSummary(line: FormLine): string {
  const parts = [line.incurredDate, line.description.trim(), line.amount ? `${formatMoney(line.amount)} บาท` : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'ยังไม่ได้กรอกข้อมูล';
}

export function ReimbursementCreatePage({ companyId, userId = '', canCreate, requestId, canUpdate = false, canPrepareForOthers = false, sourceExpenseId }: {
  companyId: string;
  userId?: string;
  canCreate: boolean;
  requestId?: string;
  canUpdate?: boolean;
  canPrepareForOthers?: boolean;
  /** `?expenseId=` — the source "เตรียมใบเบิก" was pressed on (capture appendix §13.4/§12.3). */
  sourceExpenseId?: string;
}) {
  const router = useRouter();
  const branchId = useTransactionCreateBranchId();
  const hubHref = `/companies/${companyId}/reimbursements`;
  const editing = Boolean(requestId);
  const [form, setForm] = useState(emptyForm);
  const [requesterUserId, setRequesterUserId] = useState(userId);
  const [sourceOptions, setSourceOptions] = useState<ReimbursementSourceOptions>({ requesters: [], items: [] });
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [refreshingSource, setRefreshingSource] = useState<number | null>(null);
  const [sourceReload, setSourceReload] = useState(0);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const previousBranchRef = useRef(branchId);
  /** The `?expenseId=` answer: null while nothing is owed, a Thai reason when it cannot be used. */
  const [sourceLinkNotice, setSourceLinkNotice] = useState<string | null>(null);
  const preselectedRef = useRef(false);
  // Collapsed line indices. Lines stay mounted when collapsed; this only hides them.
  const [collapsedLines, setCollapsedLines] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing && canUpdate);
  const [editLoaded, setEditLoaded] = useState(!editing);
  const [error, setError] = useState<string | null>(null);
  const [correctionNote, setCorrectionNote] = useState<string | null>(null);
  const [sourceBranchId, setSourceBranchId] = useState<string | null>(null);
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
      if (detail.requesterUserId !== userId && !canPrepareForOthers) throw new Error('เฉพาะผู้ขอหรือฝ่ายการเงินเท่านั้นที่แก้ไขคำขอนี้ได้');
      setRequesterUserId(detail.requesterUserId);
      setSourceBranchId(detail.branchId ?? null);
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
          sourceExpenseUpdatedAt: line.sourceExpenseSnapshot?.expenseUpdatedAt,
          sourceExpenseSnapshot: line.sourceExpenseSnapshot,
          categoryLabel: line.categoryLabelSnapshot,
        })),
      });
      setCorrectionNote(detail.financeReviewStatus === 'NEEDS_INFO' ? detail.financeReviewNote ?? null : null);
      setEditLoaded(true);
    }).catch(e => { if (active) setError(errorText(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canUpdate, canPrepareForOthers, companyId, requestId, userId]);

  useEffect(() => {
    if (!editing && previousBranchRef.current !== branchId) {
      setForm(current => ({ ...current, lines: current.lines.map(line => line.linkedExpenseId ? emptyLine() : line) }));
      setRequesterUserId(userId);
      previousBranchRef.current = branchId;
    }
  }, [branchId, editing, userId]);

  useEffect(() => {
    const selectedBranch = editing ? sourceBranchId : branchId;
    if (!selectedBranch || !requesterUserId || (editing && !editLoaded)) return;
    let active = true;
    setSourcesLoading(true); setSourcesError(null); setSourceOptions(current => ({ requesters: current.requesters, items: [] }));
    const timer = setTimeout(() => {
      void getReimbursementSourceOptions(companyId, { branchId: selectedBranch, requesterUserId, search: sourceSearch })
        .then(options => { if (active) setSourceOptions(options); })
        .catch(error => { if (active) setSourcesError(errorText(error)); })
        .finally(() => { if (active) setSourcesLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [branchId, sourceBranchId, companyId, requesterUserId, sourceSearch, editing, editLoaded, sourceReload]);

  /** What a chosen source becomes, in ONE place, so the picker and the `?expenseId=` link agree. */
  const lineFromSource = (source: ReimbursementSourceOption): Partial<FormLine> => ({
    incurredDate: source.incurredDate, description: source.description, purpose: source.purpose, categoryKey: source.categoryKey,
    categoryLabel: source.categoryLabel, amount: source.amount, file: null, attachmentId: null, attachmentFileName: undefined,
    linkedExpenseId: source.expenseId, sourceExpenseUpdatedAt: source.updatedAt, sourceExpenseSnapshot: source.snapshot,
  });

  const selectSource = (index: number, expenseId: string) => {
    if (!expenseId) { setLine(index, emptyLine()); return; }
    const source = sourceOptions.items.find(item => item.expenseId === expenseId && item.eligible);
    if (!source) return;
    if (source.currency !== form.currency) { setError('สกุลเงินของรายการต้องตรงกับใบเบิก'); return; }
    setLine(index, lineFromSource(source));
  };

  /**
   * "เตรียมใบเบิก" on the group page / the expense page sends the reviewer here WITH the source it
   * wants claimed. Until now the id was ignored and they landed on an empty draft, then had to find
   * the same expense again in a search-paged picker that may not list it at all.
   *
   * The SERVER decides whether it may be claimed: `getReimbursementSourceOptions(…, { expenseId })`
   * answers `eligible` plus the reason, and an ineligible one says that reason here rather than
   * leaving a blank form with no explanation. Once only — a person who then clears the line meant
   * to clear it.
   */
  useEffect(() => {
    const selectedBranch = editing ? sourceBranchId : branchId;
    if (!sourceExpenseId || editing || preselectedRef.current || !selectedBranch || !requesterUserId) return;
    preselectedRef.current = true;
    let active = true;
    void getReimbursementSourceOptions(companyId, { branchId: selectedBranch, requesterUserId, expenseId: sourceExpenseId })
      .then(options => {
        if (!active) return;
        const source = options.items.find(item => item.expenseId === sourceExpenseId);
        if (!source) { setSourceLinkNotice(errorMessage('reimbursement_source_unavailable')); return; }
        // Keep it in the picker too, so the row shows what it is bound to and can be changed.
        setSourceOptions(current => ({
          requesters: current.requesters.length > 0 ? current.requesters : options.requesters,
          items: current.items.some(item => item.expenseId === source.expenseId) ? current.items : [source, ...current.items],
        }));
        if (!source.eligible) { setSourceLinkNotice(errorMessage(source.reason ?? 'reimbursement_source_unavailable')); return; }
        if (source.currency !== form.currency) { setSourceLinkNotice('สกุลเงินของรายการต้องตรงกับใบเบิก'); return; }
        setLine(0, lineFromSource(source));
      })
      .catch(error => { if (active) setSourceLinkNotice(errorText(error)); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, sourceBranchId, companyId, editing, requesterUserId, sourceExpenseId]);

  const refreshSource = async (index: number, expenseId: string) => {
    const selectedBranch = editing ? sourceBranchId : branchId;
    if (!selectedBranch) return;
    setRefreshingSource(index); setSourcesError(null); setError(null);
    try {
      const options = await getReimbursementSourceOptions(companyId, { branchId: selectedBranch, requesterUserId, expenseId });
      const source = options.items.find(item => item.expenseId === expenseId);
      if (!source?.eligible) throw new Error(errorMessage(source?.reason ?? 'reimbursement_source_unavailable'));
      setForm(current => ({ ...current, lines: current.lines.map((line, i) => {
        if (i !== index || line.linkedExpenseId !== expenseId || current.currency !== source.currency) return line;
        const previous = line.sourceExpenseSnapshot;
        const importedDescription = previous?.lines.map(row => row.description).join('; ').slice(0, 500);
        const importedCategory = previous?.classification.expenseCategoryId ?? 'other';
        return { ...line, incurredDate: source.incurredDate, amount: source.amount, sourceExpenseUpdatedAt: source.updatedAt, sourceExpenseSnapshot: source.snapshot,
          description: line.description === importedDescription ? source.description : line.description,
          purpose: line.purpose === (previous?.certificate?.businessPurpose ?? '') ? source.purpose : line.purpose,
          ...(line.categoryKey === importedCategory ? { categoryKey: source.categoryKey, categoryLabel: source.categoryLabel } : {}),
        };
      }) }));
      setSourceReload(value => value + 1);
    } catch (error) { setSourcesError(errorText(error)); }
    finally { setRefreshingSource(null); }
  };

  const setLine = (index: number, patch: Partial<FormLine>) =>
    setForm(f => ({ ...f, lines: f.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  const total = sumLineAmounts(form.lines);
  const maxIncurredDate = todayCivilDate();
  const allLinesCollapsed = form.lines.every((_line, i) => !!collapsedLines[i]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!editing && !branchId) { setError('กรุณาเลือกสาขาของรายการ'); return; }
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
        categoryLabel: l.categoryLabel ?? categoryLabel(l.categoryKey),
        amount: l.amount,
        linkedExpenseId: l.linkedExpenseId ?? null,
        sourceExpenseUpdatedAt: l.sourceExpenseUpdatedAt,
      }));
      if (requestId) {
        if (!sourceBranchId) throw new Error('คำขอเดิมยังไม่ระบุสาขา กรุณาตรวจสอบสาขาของเอกสารก่อนบันทึก');
        const results = await Promise.allSettled(form.lines.map(l => (l.file ? uploadReceiptFile(companyId, l.file, sourceBranchId) : Promise.resolve(null))));
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
        router.push(`${hubHref}/${requestId}`);
        return;
      }
      const created = await createReimbursement(companyId, {
        branchId,
        requesterUserId,
        reason: form.reason,
        currency: form.currency || undefined,
        missingReceiptReason: form.missingReceiptReason.trim() || undefined,
        lines,
      });
      createdId = created.id;
      const files = form.lines.map(l => l.file);
      if (files.some(Boolean)) {
        const results = await Promise.allSettled(files.map(f => (f ? uploadReceiptFile(companyId, f, created.branchId ?? branchId) : Promise.resolve(null))));
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
      // The draft opens on its journey page at step 1, where it is checked and sent for approval.
      router.push(`${hubHref}/${created.id}`);
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
            description={editing ? 'เฉพาะผู้ขอที่มีสิทธิ์แก้ไขร่างเท่านั้น' : REIMBURSEMENT_CREATE_UNAVAILABLE}
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
          {!editing && <TransactionBranchField value={branchId} />}
          {correctionNote && <ErrorBanner message={`ฝ่ายการเงินขอให้แก้ไข: ${correctionNote}`} />}
          {/* `?expenseId=`: why the source the link named is not on line 1 — never a blank draft. */}
          {sourceLinkNotice && <ErrorBanner message={`รายการต้นทางที่เลือกมายังเบิกไม่ได้: ${sourceLinkNotice}`} />}
          <MangmeeCard className="p-4">
            <h3 className="text-sm font-bold text-gray-900">ข้อมูลคำขอ</h3>
            <label className="mt-3 block text-xs font-semibold text-gray-600">ผู้สำรองจ่ายและรับเงินคืน
              <ThemedSelect aria-label="ผู้รับเงินคืน" className={cx(inputClass, 'mt-1.5')} value={requesterUserId} disabled={editing || !canPrepareForOthers || sourcesLoading}
                onChange={event => { setRequesterUserId(event.target.value); setForm(current => ({ ...current, lines: [emptyLine()] })); }}>
                {!sourceOptions.requesters.some(member => member.userId === requesterUserId) && <option value={requesterUserId}>{requesterUserId === userId ? 'ฉัน' : 'ผู้รับเงินคืนตามใบเบิก'}</option>}
                {sourceOptions.requesters.map(member => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
              </ThemedSelect>
            </label>
            <p className="mt-1 text-xs text-gray-500">ผู้จัดทำอาจเป็นคนละคนกับผู้สำรองจ่าย บริษัทจะคืนเงินให้ผู้ที่ระบุข้างต้น</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-semibold text-gray-600">เหตุผล *</label>
                <input aria-label="เหตุผล" className={inputClass} required value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
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
            <label className="mt-3 block text-xs font-semibold text-gray-600">ค้นหาค่าใช้จ่ายเดิม
              <input className={cx(inputClass, 'mt-1.5')} aria-label="ค้นหาค่าใช้จ่ายเดิม" value={sourceSearch} onChange={event => setSourceSearch(event.target.value)} placeholder="ชื่อผู้ขายหรือเลขที่เอกสาร" />
            </label>
            {sourcesLoading && <p role="status" className="mt-2 text-xs text-gray-500">กำลังโหลดรายการต้นทาง...</p>}
            {sourcesError && <ErrorBanner message={sourcesError} />}
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
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-xs font-semibold text-gray-600">หลักฐานต้นทาง</label>
                      <ThemedSelect aria-label={`หลักฐานต้นทางรายการ ${i + 1}`} className={inputClass} value={l.linkedExpenseId ?? ''} disabled={sourcesLoading}
                        onChange={event => selectSource(i, event.target.value)}>
                        <option value="">กรอกและแนบใบเสร็จเอง</option>
                        {l.linkedExpenseId && !sourceOptions.items.some(source => source.expenseId === l.linkedExpenseId) && <option value={l.linkedExpenseId}>รายการต้นทางที่บันทึกไว้</option>}
                        {sourceOptions.items.map(source => <option key={source.expenseId} value={source.expenseId} disabled={!source.eligible || source.currency !== form.currency || form.lines.some((other, j) => j !== i && other.linkedExpenseId === source.expenseId)}>
                          {source.label} · {formatMoney(source.amount)} {source.currency} {source.reason ? `— ${errorMessage(source.reason)}` : source.currency !== form.currency ? '— สกุลเงินไม่ตรงกับใบเบิก' : ''}
                        </option>)}
                      </ThemedSelect>
                      {l.sourceExpenseSnapshot && <ReimbursementSourceFacts source={l.sourceExpenseSnapshot} />}
                      {l.linkedExpenseId && <button type="button" className="mt-2 text-xs font-semibold text-brand-700" disabled={refreshingSource !== null} aria-busy={Boolean(refreshingSource === i)} onClick={() => void refreshSource(i, l.linkedExpenseId!)}>{refreshingSource === i ? 'กำลังโหลดข้อมูลล่าสุด...' : 'โหลดข้อมูลต้นทางล่าสุดและตรวจใหม่'}</button>}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-600">วันที่ *</label>
                      <ThemedDate aria-label="วันที่" className={inputClass} disabled={!!l.linkedExpenseId} required value={l.incurredDate} max={maxIncurredDate} today={maxIncurredDate}
                        aria-invalid={!!l.incurredDate && !!reimbursementIncurredDateError(l.incurredDate, maxIncurredDate)}
                        aria-describedby={`incurred-date-help-${i}`}
                        onChange={e => setLine(i, { incurredDate: e.target.value })} />
                      <p id={`incurred-date-help-${i}`} className="mt-1 text-xs text-gray-500">วันที่รายการเบิกต้องไม่เกินวันนี้ (เวลาไทย)</p>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-600">หมวดใบเบิก *</label>
                      <ThemedSelect aria-label="หมวด" className={inputClass} value={l.categoryKey} onChange={e => setLine(i, { categoryKey: e.target.value, categoryLabel: undefined })}>
                        {!CATEGORY_OPTIONS.some(category => category.value === l.categoryKey) && <option value={l.categoryKey}>{l.categoryLabel ?? l.categoryKey}</option>}
                        {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </ThemedSelect>
                      {l.linkedExpenseId && <p className="mt-1 text-xs text-gray-500">หมวดบัญชีใช้ตามค่าใช้จ่ายต้นทาง</p>}
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
                      <input aria-label="จำนวนเงิน" className={inputClass} readOnly={!!l.linkedExpenseId} type="number" step="0.01" required value={l.amount} onChange={e => setLine(i, { amount: e.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-xs font-semibold text-gray-600">ใบเสร็จ</label>
                      {!l.linkedExpenseId && <ThemedFile aria-label="ใบเสร็จ" file={l.file} accept={RECEIPT_UPLOAD_ACCEPT} onChange={file => setLine(i, { file })} />}
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
              ? <Link href={`${hubHref}/${strandedDraftId}`} className={cx(btnClass, 'w-full')}>เปิดร่างเพื่อแก้ไขไฟล์</Link>
              : <button type="submit" className={cx(btnClass, 'w-full')} disabled={busy || refreshingSource !== null} aria-busy={Boolean(busy)}>{busy ? 'กำลังเตรียมไฟล์และบันทึก...' : editing ? 'บันทึกการแก้ไข' : 'บันทึกร่างคำขอเบิก'}</button>}
            <Link href={hubHref} className={cx(ghostClass, 'w-full')}>ยกเลิก</Link>
          </div>
          <p className="mt-3 text-xs leading-5 text-gray-500">ระบบจะบันทึกเป็นฉบับร่าง คุณตรวจสอบและกดส่งอนุมัติได้ภายหลัง</p>
        </MangmeeCard>
      </form>
    </MangmeePage>
  );
}
