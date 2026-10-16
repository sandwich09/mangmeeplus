'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { reimbursementIncurredDateError, todayCivilDate, type SavedPayoutAccountSummary, type MemberPayoutAccountSummary, type ReimbursementPayoutSummary, type ReimbursementSourceOption, type ReimbursementSourceOptions, type ReimbursementSourceSnapshot } from '@watchdog-bms/contracts';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { FieldError } from '@/common/components/field/Field';
import { Notice } from '@/common/components/notice';
import { useToast } from '@/common/components/toast';
import { EmptyState } from '@/common/components/state/EmptyState';
import { LoadingState } from '@/common/components/state/LoadingState';
import { createReimbursement, getReimbursementSourceOptions, getReimbursement, updateReimbursementDraft, submitReimbursement, uploadReceiptFile } from './reimbursements.api';
import { ICON, ErrorBanner, inputClass, btnClass, ghostClass } from '../expenses/ExpensesUi';
import { RECEIPT_UPLOAD_ACCEPT } from '../expenses/expense-upload.logic';
import { suggestReimbursementCategory, claimHubQuery, collectReceiptUploadResults, draftSentBackNote, mergeDraftLineEvidence, requestFormProblems, typedAmount, validateRequestForm, errorMessage, sumLineAmounts, formatMoney, errorText, money, categoryText } from './reimbursements.logic';
import { TransactionBranchField, useTransactionCreateBranchId } from '../web-core-workspace/TransactionBranchField';
import { ReimbursementSourceFacts } from './ReimbursementSourceFacts';
import { REIMBURSEMENT_CREATE_UNAVAILABLE } from './reimbursements.model';
import { BackToClaimsLink, ClaimPayoutFormSection } from './ReimbursementPayout';
import { getMySavedPayoutAccounts, getMemberPayoutAccount, getMyPayoutAccount } from './reimbursement-payout.api';
import { claimPayoutFieldError, claimPayoutSavedRefusal, resetClaimPayoutForRequester, claimPayoutFormError, claimPayoutFormOf, claimPayoutInput, emptyClaimPayoutForm, type ClaimPayoutForm } from './reimbursement-payout.logic';

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'travel', label: 'เดินทาง' },
  { value: 'meals', label: 'อาหาร' },
  { value: 'supplies', label: 'วัสดุอุปกรณ์' },
  { value: 'accommodation', label: 'ที่พัก' },
  { value: 'other', label: 'อื่น ๆ' },
];
/** The required mark of every field on this form, red like the shared fields' (owner 2026-10-16). */
const req = <span className="text-red-600"> *</span>;
const categoryLabel = (key: string) => CATEGORY_OPTIONS.find(c => c.value === key)?.label ?? key;

type FormLine = {
  incurredDate: string;
  description: string;
  purpose: string;
  categoryKey: string;
  categoryChosen: boolean;
  amount: string;
  file: File | null;
  attachmentId?: string | null;
  attachmentFileName?: string;
  linkedExpenseId?: string | null;
  sourceExpenseUpdatedAt?: string;
  sourceExpenseSnapshot?: ReimbursementSourceSnapshot;
  categoryLabel?: string;
};
// A new line starts on today (most receipts are today's) and with no category: "เดินทาง" was chosen for every claim
// nobody looked at, so bags and drinking water were filed as travel.
const emptyLine = (): FormLine => ({ incurredDate: todayCivilDate(), description: '', purpose: '', categoryKey: '', categoryChosen: false, amount: '', file: null,
  attachmentId: null, attachmentFileName: undefined, linkedExpenseId: null, sourceExpenseUpdatedAt: undefined, sourceExpenseSnapshot: undefined, categoryLabel: undefined });
/** A line has its evidence: a file chosen now, one attached before, or the saved expense it is taken from. */
const hasReceipt = (line: FormLine) => !!line.file || !!line.attachmentId || !!line.linkedExpenseId;
const labelClass = 'mb-1.5 block text-sm font-semibold text-gray-700';
const hintClass = 'mt-1 text-sm text-gray-500';
const textLinkClass = 'inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-4';
const emptyForm = () => ({ reason: '', currency: 'THB', missingReceiptReason: '', lines: [emptyLine()] });

/** One-line preview of a collapsed row: date · description · amount. */
function lineSummary(line: FormLine): string {
  const parts = [formatThaiDate(line.incurredDate, ''), line.description.trim(), line.amount ? money(typedAmount(line.amount)) : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'ยังไม่ได้กรอกข้อมูล';
}

export function ReimbursementCreatePage({ companyId, userId = '', canCreate, requestId, canUpdate = false, canPrepareForOthers = false, canEditEmployees = false, sourceExpenseId }: {
  companyId: string;
  userId?: string;
  canCreate: boolean;
  requestId?: string;
  canUpdate?: boolean;
  canPrepareForOthers?: boolean;
  /** Holds the employee-edit right, so the server is asked whether "save as the requester's default" may be offered when preparing for someone else. */
  canEditEmployees?: boolean;
  /** `?expenseId=` — the source "เตรียมใบเบิก" was pressed on (capture appendix §13.4/§12.3). */
  sourceExpenseId?: string;
}) {
  const router = useRouter();
  const branchId = useTransactionCreateBranchId();
  const hubHref = `/companies/${companyId}/reimbursements`;
  const searchParams = useSearchParams();
  const returnQuery = claimHubQuery(searchParams?.get('tab') ?? null, searchParams?.get('filter') ?? null);
  const editing = Boolean(requestId);
  const [form, setForm] = useState(emptyForm);
  const [requesterUserId, setRequesterUserId] = useState(userId);
  // Where the money goes back to. A claim follows the REQUESTER's default account unless it says otherwise.
  const [payout, setPayout] = useState<ClaimPayoutForm>(emptyClaimPayoutForm);
  const [currentPayout, setCurrentPayout] = useState<ReimbursementPayoutSummary | null>(null);
  const [myPayoutAccount, setMyPayoutAccount] = useState<MemberPayoutAccountSummary | null | undefined>(undefined);
  const [savedAccounts, setSavedAccounts] = useState<SavedPayoutAccountSummary[]>([]);
  const [savedAccountsLoading, setSavedAccountsLoading] = useState(false);
  const [savedAccountsError, setSavedAccountsError] = useState<string | null>(null);
  const [savedAccountsReload, setSavedAccountsReload] = useState(0);
  const [payoutInvalidField, setPayoutInvalidField] = useState<string>();
  const [maySaveAsDefault, setMaySaveAsDefault] = useState(false);
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
  const errorRef = useRef<HTMLDivElement>(null);
  const [correctionNote, setCorrectionNote] = useState<string | null>(null);
  const [sourceBranchId, setSourceBranchId] = useState<string | null>(null);
  // Set only when the draft was created but its receipts failed to attach. Re-submitting would
  // create a second claim, so the primary action becomes "open the draft" instead.
  const [strandedDraftId, setStrandedDraftId] = useState<string | null>(null);
  // After the first press of the save button every field that is still wrong says so under itself, until it is fixed.
  const [showProblems, setShowProblems] = useState(false);
  /** The line whose "choose from saved expenses" is open; a line taken from one shows it always. */
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const [showUnclaimable, setShowUnclaimable] = useState(false);
  const toast = useToast();
  // The person's own default could not be read: "follow my default" stays offered, since the server reads it at submit.
  const defaultUnreadRef = useRef(false);
  const payoutChosenRef = useRef(false);
  // A refusal that belongs to no field is brought into view. A field's own problem is said at the field, which is
  // scrolled to instead (`toFirstProblem`).
  useEffect(() => {
    if (error && !payoutInvalidField && !showProblems) {
      errorRef.current?.scrollIntoView({ block: 'start' }); errorRef.current?.focus({ preventScroll: true });
    }
  }, [error, payoutInvalidField, showProblems]);

  useEffect(() => {
    if (!requestId || !canUpdate) return;
    let active = true;
    setLoading(true); setError(null);
    void getReimbursement(companyId, requestId).then(detail => {
      if (!active) return;
      if (detail.status !== 'DRAFT') throw new Error('แก้ไขได้เฉพาะใบเบิกที่ยังเป็นร่าง');
      if (detail.requesterUserId !== userId && !canPrepareForOthers) throw new Error('ใบเบิกนี้แก้ไขได้เฉพาะผู้เบิก หรือผู้ที่มีสิทธิ์ทำใบเบิกแทนผู้เบิก');
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
          categoryKey: line.categoryKey ?? '',
          categoryChosen: Boolean(line.categoryKey),
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
      setCorrectionNote(draftSentBackNote(detail));
      setCurrentPayout(detail.payout ?? null);
      setPayout(claimPayoutFormOf(detail.payout));
      setEditLoaded(true);
    }).catch(e => { if (active) setError(errorText(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canUpdate, canPrepareForOthers, companyId, requestId, userId]);

  // The form previews the default only for the person's own claim; another member's is theirs to see.
  // Either way the server says whether THIS viewer may save a typed account as the requester's default
  // (its own answer to "would the save go through"), and the tick box is offered exactly then.
  useEffect(() => {
    setMaySaveAsDefault(false);
    if (!userId || !requesterUserId || (editing ? !canUpdate : !canCreate)) return;
    const forSelf = requesterUserId === userId;
    if (!forSelf && !canEditEmployees) return;
    let active = true;
    void (forSelf ? getMyPayoutAccount(companyId) : getMemberPayoutAccount(companyId, requesterUserId))
      .then((response) => {
        if (!active) return;
        // Only the person's own default is put into the form.
        if (forSelf) setMyPayoutAccount(response.account);
        setMaySaveAsDefault(response.canEdit === true);
      })
      // Without the preview the choice still works: the server reads the default at submit.
      .catch(() => { if (active && forSelf) { defaultUnreadRef.current = true; setMyPayoutAccount(null); } });
    return () => { active = false; };
  }, [canCreate, canEditEmployees, canUpdate, companyId, editing, requesterUserId, userId]);

  // A person who is known to have no default account is not left on "follow my default": that choice let the draft be
  // saved and then blocked it on the next page. Nothing is chosen for them, and saving asks for the choice here.
  const noDefaultAccount = requesterUserId === userId && myPayoutAccount === null && !defaultUnreadRef.current;
  useEffect(() => {
    if (!noDefaultAccount || payoutChosenRef.current) return;
    setPayout(current => (current.mode === 'DEFAULT' ? { ...current, mode: '' } : current));
  }, [noDefaultAccount]);

  useEffect(() => {
    let active = true;
    setSavedAccounts([]); setSavedAccountsError(null); setSavedAccountsLoading(false);
    if (!userId || requesterUserId !== userId || (editing ? !canUpdate : !canCreate)) return;
    setSavedAccountsLoading(true);
    getMySavedPayoutAccounts(companyId).then(response => { if (active) setSavedAccounts(response.accounts); })
      .catch(e => { if (active) setSavedAccountsError(errorText(e)); })
      .finally(() => { if (active) setSavedAccountsLoading(false); });
    return () => { active = false; };
  }, [companyId, requesterUserId, userId, editing, canCreate, canUpdate, savedAccountsReload]);

  useEffect(() => {
    if (!editing && previousBranchRef.current !== branchId) {
      setForm(current => ({ ...current, lines: current.lines.map(line => line.linkedExpenseId ? emptyLine() : line) }));
      setRequesterUserId(userId);
      if (requesterUserId !== userId) { setPayout(resetClaimPayoutForRequester); setPayoutInvalidField(undefined); }
      previousBranchRef.current = branchId;
    }
  }, [branchId, editing, userId, requesterUserId]);

  useEffect(() => {
    const selectedBranch = editing ? sourceBranchId : branchId;
    if (!selectedBranch || !requesterUserId || (editing && !editLoaded)) return;
    let active = true;
    setSourcesLoading(true); setSourcesError(null); setSourceOptions(current => ({ ...current, items: [] }));
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
    categoryLabel: source.categoryLabel, categoryChosen: true, amount: source.amount, file: null, attachmentId: null, attachmentFileName: undefined,
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
          ...current, receiptPolicy: options.receiptPolicy,
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
    setForm(f => ({ ...f, lines: f.lines.map((line, i) => {
      if (i !== index) return line;
      const next = { ...line, ...patch };
      if (patch.description !== undefined && patch.categoryKey === undefined && !next.categoryChosen && !next.linkedExpenseId) {
        next.categoryKey = suggestReimbursementCategory(next.description);
        next.categoryLabel = undefined;
      }
      return next;
    }) }));
  // What is checked, summed and sent: the amounts without the separators a person types.
  const checkedLines = form.lines.map(l => ({ ...l, amount: typedAmount(l.amount), hasReceipt: hasReceipt(l) }));
  const total = sumLineAmounts(checkedLines);
  const maxIncurredDate = todayCivilDate();
  const allLinesCollapsed = form.lines.every((_line, i) => !!collapsedLines[i]);
  const [validationIntent, setValidationIntent] = useState<'draft' | 'send'>('send');
  const checked = { intent: validationIntent, reason: form.reason, missingReceiptReason: form.missingReceiptReason, receiptPolicy: sourceOptions.receiptPolicy, lines: checkedLines };
  const problems = showProblems ? requestFormProblems(checked) : null;
  const branchMissing = showProblems && !editing && !branchId;
  const modeMissing = showProblems && payoutInvalidField === 'mode';
  const problemFields = (problems?.count ?? 0) + (branchMissing ? 1 : 0) + (modeMissing ? 1 : 0);
  // One field: its own sentence. Several: how many, since each says its own under itself.
  const shownError = problemFields > 1 ? `ยังกรอกไม่ครบ ${problemFields} ช่อง`
    : problemFields === 1 ? (branchMissing ? 'เลือกสาขา' : modeMissing ? error : (problems?.lines.some(line => line.receipt) ? 'แนบใบเสร็จในรายการที่ระบุ' : validateRequestForm(checked))) : error;
  const asksReceiptReason = sourceOptions.receiptPolicy?.allowMissingReceiptWithReason === true
    && form.lines.some(l => !hasReceipt(l) && (l.description.trim() !== '' || l.amount.trim() !== ''));
  const claimable = (source: ReimbursementSourceOption) => source.eligible && source.currency === form.currency;

  const finishSavedDraft = async (id: string, send: boolean) => {
    if (send) {
      const saved = await getReimbursement(companyId, id);
      await submitReimbursement(companyId, id, saved.payout?.submitToken);
    }
    toast.success(send ? 'ส่งอนุมัติแล้ว' : 'บันทึกร่างแล้ว');
    router.push(`${hubHref}/${id}${returnQuery}`);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const send = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') !== 'draft';
    setValidationIntent(send ? 'send' : 'draft');
    setError(null); setPayoutInvalidField(undefined);
    const formElement = e.currentTarget;
    const toFirstProblem = () => requestAnimationFrame(() => {
      const field = formElement.querySelector<HTMLElement>('[aria-invalid="true"]');
      field?.scrollIntoView({ block: 'start' }); field?.focus({ preventScroll: true });
    });
    // Every field is checked at once, marked, and says its own problem; rows are expanded so the marked field is visible.
    if (requestFormProblems({ ...checked, intent: send ? 'send' : 'draft' }).count > 0 || (!editing && !branchId)) {
      setShowProblems(true); setCollapsedLines({});
      // A receiving method not chosen yet is said in the same pass, at its own section.
      if (!payout.mode) { setError('เลือกวิธีรับเงินคืน'); setPayoutInvalidField('mode'); }
      toFirstProblem(); return;
    }
    if (!sourceOptions.receiptPolicy) { setError(sourcesError ?? 'กำลังโหลดกติกาใบเสร็จ ลองอีกครั้ง'); return; }
    setShowProblems(false);
    const payoutError = !payout.mode ? 'เลือกวิธีรับเงินคืน' : claimPayoutFormError(payout);
    if (payoutError) {
      setError(payoutError); setPayoutInvalidField(!payout.mode ? 'mode' : claimPayoutFieldError(payout)?.field);
      toFirstProblem();
      return;
    }
    // Undefined leaves an existing draft's receiving choice as it is.
    const payoutInput = claimPayoutInput(payout, maySaveAsDefault, requesterUserId === userId);
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
        categoryLabel: l.categoryLabel?.trim() || categoryLabel(l.categoryKey),
        amount: typedAmount(l.amount),
        linkedExpenseId: l.linkedExpenseId ?? null,
        sourceExpenseUpdatedAt: l.sourceExpenseUpdatedAt,
      }));
      if (requestId) {
        if (!sourceBranchId) throw new Error('ใบเบิกนี้ยังไม่ระบุสาขา ตรวจสอบสาขาของเอกสารก่อนบันทึก');
        const results = await Promise.allSettled(form.lines.map(l => (l.file ? uploadReceiptFile(companyId, l.file, sourceBranchId) : Promise.resolve(null))));
        const { attachmentIds, failedLineNumbers, firstFailure } = collectReceiptUploadResults(results);
        if (failedLineNumbers.length > 0) {
          throw new Error(`แนบไฟล์รายการที่ ${failedLineNumbers.join(', ')} ไม่สำเร็จ: ${errorText(firstFailure)}`);
        }
        await updateReimbursementDraft(companyId, requestId, {
          reason: form.reason.trim(),
          currency: form.currency || undefined,
          missingReceiptReason: form.missingReceiptReason.trim() || null,
          ...(payoutInput && { payout: payoutInput }),
          lines: lines.map((line, i) => ({
            ...line,
            ...mergeDraftLineEvidence(form.lines[i], attachmentIds[i]),
          })),
        });
        createdId = requestId;
        await finishSavedDraft(requestId, send);
        return;
      }
      const created = await createReimbursement(companyId, {
        branchId,
        requesterUserId,
        reason: form.reason,
        currency: form.currency || undefined,
        missingReceiptReason: form.missingReceiptReason.trim() || undefined,
        ...(payoutInput && { payout: payoutInput }),
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
      await finishSavedDraft(created.id, send);
    } catch (e) {
      if (send && createdId) {
        const message = receiptFailureMessage ?? errorText(e);
        try { window.sessionStorage.setItem(`claim-submit:${createdId}`, message); } catch { /* The saved draft is still reachable. */ }
        router.push(`${hubHref}/${createdId}${returnQuery}`);
        return;
      }
      const recovery = !createdId && claimPayoutSavedRefusal(payout, e);
      if (recovery) { setPayout(recovery.form); setSavedAccountsReload(value => value + 1); }
      setError(createdId
        ? `บันทึกร่างแล้ว แต่แนบไฟล์ไม่ครบ: ${receiptFailureMessage ?? errorText(e)}${linkedReceiptCount > 0 ? ` ระบบเก็บไฟล์ที่แนบแล้ว ${linkedReceiptCount} รายการไว้แล้ว` : ''} เปิดร่างแล้วเลือกไฟล์ของรายการที่ยังขาดอีกครั้ง`
        : errorText(e));
      setStrandedDraftId(createdId);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="กำลังโหลดใบเบิก..." />;

  if (editing ? !canUpdate : !canCreate) {
    return (
      <MangmeePage className="mangmee-flat" back={<BackToClaimsLink href={`${hubHref}${returnQuery}`} />} title={editing ? 'แก้ไขใบเบิก' : 'สร้างใบเบิก'}>
        <MangmeeCard className="p-6">
          <EmptyState
            title={editing ? 'บัญชีนี้แก้ไขใบเบิกนี้ไม่ได้' : 'บัญชีนี้สร้างใบเบิกไม่ได้'}
            description={editing ? 'ร่างแก้ไขได้เฉพาะผู้เบิกของใบนั้น' : REIMBURSEMENT_CREATE_UNAVAILABLE}
          />
        </MangmeeCard>
      </MangmeePage>
    );
  }

  if (editing && !editLoaded) {
    return (
      <MangmeePage back={<BackToClaimsLink href={`${hubHref}${returnQuery}`} />} title="แก้ไขใบเบิก">
        <MangmeeCard className="p-6"><ErrorBanner message={error ?? 'โหลดใบเบิกไม่สำเร็จ'} /></MangmeeCard>
      </MangmeePage>
    );
  }

  return (
    <MangmeePage className="mangmee-flat" back={<BackToClaimsLink href={`${hubHref}${returnQuery}`} />} title={editing ? 'แก้ไขใบเบิก' : 'สร้างใบเบิก'}>
      {/* noValidate: collapsed rows hide required inputs with CSS, and the browser aborts a
          submit it cannot focus — silently, with no message and no request. requestFormProblems
          covers every field in Thai, under the field itself, instead. */}
      {/* One column that fills the page; the buttons end the form in the page's action bar (owner 2026-10-13). */}
      <form onSubmit={handleCreate} noValidate className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <div className="space-y-4">
          {/* Why the draft came back, said once, beside the fields it asks to change. */}
          {correctionNote && <Notice tone="warning">{correctionNote}</Notice>}
          {/* `?expenseId=`: why the source the link named is not on line 1 — never a blank draft. */}
          {sourceLinkNotice && <ErrorBanner message={`รายการต้นทางที่เลือกมายังเบิกไม่ได้: ${sourceLinkNotice}`} />}
          <MangmeeCard className="grid gap-3 p-4 sm:grid-cols-2">
            {/* Only someone who may prepare a claim for another person chooses whose it is: anyone else saw their own
                name in a greyed-out list. */}
            {canPrepareForOthers && (
              <div>
                <label className={labelClass}>ผู้เบิก</label>
                <ThemedSelect searchable aria-label="ผู้เบิก" className={inputClass} value={requesterUserId} disabled={editing || sourcesLoading}
                  onChange={event => { setRequesterUserId(event.target.value); setForm(current => ({ ...current, lines: [emptyLine()] })); setPayout(resetClaimPayoutForRequester); setPayoutInvalidField(undefined); }}>
                  {!sourceOptions.requesters.some(member => member.userId === requesterUserId) && <option value={requesterUserId}>{requesterUserId === userId ? 'ฉัน' : 'ผู้เบิกของใบนี้'}</option>}
                  {sourceOptions.requesters.map(member => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
                </ThemedSelect>
                <p className={hintClass}>คนที่จ่ายเงินไปก่อน และจะได้เงินคืน</p>
              </div>
            )}
            {!canPrepareForOthers && <div><label className={labelClass}>ผู้เบิก</label><p className="min-h-11 py-2 text-sm">{sourceOptions.requesters.find(member => member.userId === requesterUserId)?.displayName ?? 'ฉัน'}</p></div>}
            {!editing && <TransactionBranchField fill value={branchId} invalid={branchMissing} hint={branchMissing ? 'เลือกสาขา' : undefined} />}
            <div className="sm:col-span-2">
              <label className={labelClass}>เหตุผล{req}</label>
              <input aria-label="เหตุผล" className={inputClass} required value={form.reason} placeholder="เช่น ค่าเดินทางไปส่งของให้ลูกค้า"
                aria-invalid={problems?.reason ? true : undefined} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
              {problems?.reason && <FieldError>{problems.reason}</FieldError>}
            </div>
          </MangmeeCard>

          <MangmeeCard className="p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-gray-900">รายการที่ขอเบิก{form.lines.length > 1 ? ` (${form.lines.length})` : ''}</h3>
              {form.lines.length >= 2 && (
                <button type="button" className={ghostClass}
                  onClick={() => setCollapsedLines(allLinesCollapsed ? {} : Object.fromEntries(form.lines.map((_line, i) => [i, true])))}>
                  {allLinesCollapsed ? 'ขยายทั้งหมด' : 'ย่อทั้งหมด'}
                </button>
              )}
            </div>
            {problems?.form && <div className="mt-2"><FieldError>{problems.form}</FieldError></div>}
            <div className="mt-3 space-y-3">
              {form.lines.map((l, i) => {
                const lineProblems = problems?.lines[i];
                const unclaimable = sourceOptions.items.filter(source => !claimable(source) && source.expenseId !== l.linkedExpenseId).length;
                return (
                <div key={i} className="rounded-xl border border-gray-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    {form.lines.length === 1 ? <h4 className="text-sm font-bold text-gray-700">รายการที่ 1</h4> : <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                      aria-expanded={!collapsedLines[i]} onClick={() => setCollapsedLines(c => ({ ...c, [i]: !c[i] }))}>
                      <span className={cx('text-gray-400 transition-transform', !collapsedLines[i] && 'rotate-90')}>▶</span>
                      <span className="shrink-0 text-sm font-bold text-gray-700">รายการที่ {i + 1}</span>
                      {collapsedLines[i] && <span className="min-w-0 break-words text-sm text-gray-500">{lineSummary(l)}</span>}
                    </button>}
                    {form.lines.length > 1 && (
                      <button type="button" aria-label="ลบรายการ" className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-error-700 hover:text-error-700"
                        onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_x, j) => j !== i) }))}>{ICON.trash}</button>
                    )}
                  </div>

                  <div className={cx('mt-3 grid gap-3 lg:grid-cols-3', form.lines.length > 1 && collapsedLines[i] && 'hidden')}>
                    {/* The receipt first: it is what the person holds, and the rest is read off it. */}
                    <div className="lg:col-span-3 scroll-mt-[calc(var(--app-header-h)+1rem)]" tabIndex={-1} aria-invalid={Boolean(lineProblems?.receipt)}>
                      <label className={labelClass}>ใบเสร็จ</label>

                      {!l.linkedExpenseId && <ThemedFile aria-label="ใบเสร็จ" file={l.file} accept={RECEIPT_UPLOAD_ACCEPT} onChange={file => setLine(i, { file })} />}
                    {sourceOptions.receiptPolicy?.requireReceipt && !sourceOptions.receiptPolicy.allowMissingReceiptWithReason
                      && !hasReceipt(l) && (l.description.trim() || l.amount.trim()) && <div className="mt-2"><FieldError>ร้านนี้ต้องแนบใบเสร็จทุกรายการก่อนส่งอนุมัติ</FieldError></div>}
                      {l.attachmentId && !l.file && (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500">
                          <span className="min-w-0 break-words">ไฟล์เดิม: {l.attachmentFileName ?? 'ใบเสร็จที่แนบไว้'}</span>
                          <button type="button" className="inline-flex min-h-11 items-center font-semibold text-error-700 underline underline-offset-4" onClick={() => setLine(i, { attachmentId: null, attachmentFileName: undefined })}>นำไฟล์เดิมออก</button>
                        </div>
                      )}
                      {l.linkedExpenseId ? <p className={hintClass}>ใช้ใบเสร็จของค่าใช้จ่ายที่เลือกไว้ด้านล่าง</p>
                        : <p className={hintClass}>PDF หรือรูปภาพ</p>}
                      {!l.linkedExpenseId && pickerOpen !== i && (
                        <button type="button" className={textLinkClass} onClick={() => setPickerOpen(i)}>เลือกจากค่าใช้จ่ายที่บันทึกไว้</button>
                      )}
                    </div>
                    {/* A line taken from a saved expense: chosen from the ones that can be claimed; the rest are behind one line. */}
                    {(l.linkedExpenseId || pickerOpen === i) && (
                      <div className="rounded-xl bg-gray-50 p-3 lg:col-span-3">
                        <label className={labelClass}>ค่าใช้จ่ายที่บันทึกไว้</label>
                        <input className={cx(inputClass, 'mb-2')} aria-label="ค้นหาค่าใช้จ่ายที่บันทึกไว้" value={sourceSearch} onChange={event => setSourceSearch(event.target.value)} placeholder="ค้นหาชื่อผู้ขายหรือเลขที่เอกสาร" />
                        <ThemedSelect aria-label={`ค่าใช้จ่ายที่บันทึกไว้ของรายการที่ ${i + 1}`} className={inputClass} value={l.linkedExpenseId ?? ''} disabled={sourcesLoading}
                          onChange={event => selectSource(i, event.target.value)}>
                          <option value="">กรอกและแนบใบเสร็จเอง</option>
                          {l.linkedExpenseId && !sourceOptions.items.some(source => source.expenseId === l.linkedExpenseId) && <option value={l.linkedExpenseId}>รายการต้นทางที่บันทึกไว้</option>}
                          {sourceOptions.items.filter(source => claimable(source) || source.expenseId === l.linkedExpenseId || showUnclaimable).map(source => <option key={source.expenseId} value={source.expenseId} disabled={!claimable(source) || form.lines.some((other, j) => j !== i && other.linkedExpenseId === source.expenseId)}>
                            {source.label} · {money(source.amount, source.currency)} {source.reason ? `— ${errorMessage(source.reason)}` : source.currency !== form.currency ? '— สกุลเงินไม่ตรงกับใบเบิก' : ''}
                          </option>)}
                        </ThemedSelect>
                        {sourcesLoading && <p role="status" className={hintClass}>กำลังโหลดค่าใช้จ่ายที่บันทึกไว้...</p>}
                        {sourcesError && <div className="mt-2"><ErrorBanner message={sourcesError} /></div>}
                        {unclaimable > 0 && (
                          <button type="button" aria-expanded={showUnclaimable} className={textLinkClass} onClick={() => setShowUnclaimable(shown => !shown)}>
                            {showUnclaimable ? 'ซ่อนรายการที่เบิกไม่ได้' : `ดูรายการที่เบิกไม่ได้ ${unclaimable} รายการ`}
                          </button>
                        )}
                        {l.sourceExpenseSnapshot && <ReimbursementSourceFacts source={l.sourceExpenseSnapshot} />}
                        {l.linkedExpenseId && <div><button type="button" className={textLinkClass} disabled={refreshingSource !== null} aria-busy={Boolean(refreshingSource === i)} onClick={() => void refreshSource(i, l.linkedExpenseId!)}>โหลดข้อมูลต้นทางล่าสุดและตรวจใหม่</button></div>}
                      </div>
                    )}
                    <div className="lg:col-span-3">
                      <label className={labelClass}>รายการ{req}</label>
                      <input aria-label="รายการ" className={inputClass} required value={l.description} aria-invalid={lineProblems?.description ? true : undefined}
                        onChange={e => setLine(i, { description: e.target.value })} />
                      {lineProblems?.description && <FieldError>{lineProblems.description}</FieldError>}
                    </div>
                    <div>
                      <label className={labelClass}>จำนวนเงิน{req}</label>
                      {/* Text with the number keypad: a typed "1,200" stays as typed (a number field dropped it without a word). */}
                      <div className="relative">
                        <input aria-label="จำนวนเงิน" className={cx(inputClass, 'mangmee-input-icon-end text-right tabular-nums')} readOnly={!!l.linkedExpenseId} type="text" inputMode="decimal" autoComplete="off" required
                          value={l.amount} aria-invalid={lineProblems?.amount ? true : undefined} onChange={e => setLine(i, { amount: e.target.value })} />
                        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-500">บาท</span>
                      </div>
                      {lineProblems?.amount && <FieldError>{lineProblems.amount}</FieldError>}
                    </div>
                    <div>
                      <label className={labelClass}>วันที่{req}</label>
                      <ThemedDate aria-label="วันที่" className={inputClass} disabled={!!l.linkedExpenseId} required value={l.incurredDate} max={maxIncurredDate} today={maxIncurredDate}
                        aria-invalid={Boolean(lineProblems?.incurredDate) || (!!l.incurredDate && !!reimbursementIncurredDateError(l.incurredDate, maxIncurredDate))}
                        onChange={e => setLine(i, { incurredDate: e.target.value })} />
                      {lineProblems?.incurredDate && <FieldError>{lineProblems.incurredDate}</FieldError>}
                    </div>
                    <div>
                      <label className={labelClass}>หมวด{req}</label>
                      <ThemedSelect aria-label="หมวด" className={inputClass} value={l.categoryKey} aria-invalid={lineProblems?.categoryKey ? true : undefined}
                        onChange={e => setLine(i, { categoryKey: e.target.value, categoryLabel: undefined, categoryChosen: true })}>
                        {l.categoryKey === '' && <option value="">เลือกหมวด</option>}
                        {l.categoryKey !== '' && !CATEGORY_OPTIONS.some(category => category.value === l.categoryKey) && <option value={l.categoryKey}>{categoryText(l.categoryLabel)}</option>}
                        {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </ThemedSelect>
                      {lineProblems?.categoryKey && <FieldError>{lineProblems.categoryKey}</FieldError>}
                      {l.linkedExpenseId && <p className={hintClass}>หมวดบัญชีใช้ตามค่าใช้จ่ายที่เลือกไว้</p>}
                    </div>
                    {l.categoryKey === 'other' && !l.linkedExpenseId && (
                      <div className="lg:col-span-3">
                        <label className={labelClass}>ระบุหมวดอื่น{req}</label>
                        <input aria-label="ระบุหมวดอื่น" className={inputClass} required maxLength={160} placeholder="เช่น ค่าจอดรถ" value={l.categoryLabel ?? ''}
                          aria-invalid={lineProblems?.categoryLabel ? true : undefined} onChange={e => setLine(i, { categoryLabel: e.target.value })} />
                        {lineProblems?.categoryLabel && <FieldError>{lineProblems.categoryLabel}</FieldError>}
                      </div>
                    )}
                    <div className="lg:col-span-3">
                      <label className={labelClass}>วัตถุประสงค์ (ไม่บังคับ)</label>
                      <input aria-label="วัตถุประสงค์" className={inputClass} value={l.purpose} onChange={e => setLine(i, { purpose: e.target.value })} />
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
            <ActionGroup align="start" className="mt-3">
              <button type="button" className={ghostClass} onClick={() => {
                setForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }));
                setCollapsedLines(c => ({ ...c, [form.lines.length]: false }));
              }}>+ เพิ่มรายการ</button>
            </ActionGroup>
            {asksReceiptReason && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <label className={labelClass}>เหตุผลที่ไม่มีใบเสร็จ</label>
                <input aria-label="เหตุผลที่ไม่มีใบเสร็จ" className={inputClass} value={form.missingReceiptReason} aria-invalid={problems?.missingReceiptReason ? true : undefined}
                  onChange={e => setForm(f => ({ ...f, missingReceiptReason: e.target.value }))} />
                {problems?.missingReceiptReason ? <FieldError>{problems.missingReceiptReason}</FieldError>
                  : <p className={hintClass}>กรอกเมื่อมีรายการที่ไม่มีใบเสร็จ ใช้ได้เมื่อร้านรับเหตุผลแทนใบเสร็จ</p>}
              </div>
            )}
          </MangmeeCard>

          <ClaimPayoutFormSection
            value={payout}
            onChange={value => { payoutChosenRef.current = true; setPayout(value); setPayoutInvalidField(undefined); setError(null); }}
            invalidField={payoutInvalidField}
            error={error}
            savedAccounts={savedAccounts}
            savedAccountsLoading={savedAccountsLoading}
            savedAccountsError={savedAccountsError}
            onReloadSaved={() => setSavedAccountsReload(value => value + 1)}
            forSelf={requesterUserId === userId}
            defaultAccount={requesterUserId === userId ? myPayoutAccount : null}
            noDefaultAccount={noDefaultAccount}
            current={currentPayout}
            canSaveAsDefault={maySaveAsDefault}
            payoutAccountHref={`${hubHref}/payout-account`}
          />
        </div>

        {shownError && <div ref={errorRef} tabIndex={-1} className="scroll-mt-[calc(var(--app-header-h)+1rem)]"><ErrorBanner message={shownError} /></div>}
        <FormActionBar
          // The total only where there is something to add up: with one line it repeated the amount typed above it.
          summary={form.lines.length > 1 ? (
            <p className="flex items-baseline gap-3">
              <span className="text-sm font-semibold text-gray-600">ยอดรวม</span>
              <span className="mangmee-unit text-xl font-bold text-gray-900">{formatMoney(total, form.currency)}</span>
            </p>
          ) : undefined}>
          <ActionGroup>
            {/* Leaving the edit of a draft goes back to that draft, not to the list. */}
            <Link href={editing ? `${hubHref}/${requestId}${returnQuery}` : `${hubHref}${returnQuery}`} className={ghostClass}>ยกเลิก</Link>
            {strandedDraftId
              ? <Link href={`${hubHref}/${strandedDraftId}${returnQuery}`} className={btnClass}>เปิดร่างเพื่อแก้ไขไฟล์</Link>
              : <>
                <button type="submit" name="intent" value="draft" className={ghostClass} disabled={busy || refreshingSource !== null} aria-busy={Boolean(busy)}>บันทึกร่าง</button>
                <button type="submit" name="intent" value="send" className={btnClass} disabled={busy || sourcesLoading || refreshingSource !== null} aria-busy={Boolean(busy)}>ส่งอนุมัติ</button>
              </>}
          </ActionGroup>
        </FormActionBar>
      </form>
    </MangmeePage>
  );
}
