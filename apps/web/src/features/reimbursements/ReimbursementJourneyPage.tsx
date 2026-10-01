'use client';

// หน้า journey: one claim as 4–5 steps with the current step's actions (spec §5, §6, §12).
// Every action still goes through its own endpoint; this page re-reads the claim afterwards.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { EXPENSE_VOID_REASON_MIN_LENGTH } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { ThemedSteps, type ThemedStepState } from '@/common/components/steps/ThemedSteps';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { useConfirm } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { ErrorBanner, btnClass, ghostClass, inputClass } from '../expenses/ExpensesUi';
import {
  addReimbursementInternalNote, approveReimbursement, attachReimbursementPaymentSlip, cancelReimbursement, deleteReimbursementInternalNote,
  editReimbursementInternalNote, financeReviewReimbursement, getReimbursement, rejectReimbursement,
  reopenReimbursement, resumeReimbursement, setLineReceipt, signReimbursementClaimForm, submitReimbursement, uploadReimbursementPaymentSlip, uploadSignedClaimFormCopy,
  voidReimbursementPayment, withdrawReimbursementCancellation,
} from './reimbursements.api';
import { currentDeskText, reimbursementSubmitReadiness, type ClaimSignatureRole } from './reimbursements.model';
import {
  activeJourneyStep, approvalComparable, approverNotReadyHelp, buildJourneySteps, diffApprovalFields, errorText, isMissingSavedSignatureError,
  isStaleApprovalError, opensPaymentFormOnArrival, signedCopyMoveConfirmText, type JourneyAction, type JourneyStepState,
} from './reimbursements.logic';
import {
  ClaimDetailSections, ClaimSummaryCard, MissingSavedSignatureModal, PaymentForm, ReasonDialog, RejectDialog,
  StaleApprovalDialog, StatusBadge, VoidPaymentDialog, financeActionLabel, useClaimDocumentPreview,
} from './ReimbursementDetailSections';
import { ClaimPayoutCard, PayoutAttestationCheck } from './ReimbursementPayout';
import { PAYOUT_ATTESTATION_REQUIRED, claimNeedsPayoutAttestation, claimPayoutSubmitBlock } from './reimbursement-payout.logic';

const STEPPER_STATE: Record<JourneyStepState, ThemedStepState> = {
  done: 'done', current: 'current', upcoming: 'upcoming', 'needs-fix': 'attention', ended: 'attention',
};

const ACTION_LABELS: Record<JourneyAction, string> = {
  submit: 'ส่งอนุมัติ', edit: 'แก้ไขคำขอ', cancel: 'ยกเลิกคำขอ', reopen: 'แก้ไขและส่งใหม่',
  'resume-cancel': 'ดำเนินการยกเลิกต่อ', 'withdraw-cancel': 'ถอนการยกเลิก',
  approve: 'อนุมัติ', reject: 'ปฏิเสธ', resume: 'ดำเนินการต่อ', 'policy-settings': 'ไปที่ตั้งค่าเบิกจ่าย',
  'finance-approve': 'อนุมัติจ่าย', 'finance-return': 'ส่งกลับให้แก้ไข', 'finance-block': 'ระงับการจ่าย',
  'resolve-duplicate': 'ปลดรายการซ้ำ', pay: 'บันทึกจ่าย', sign: 'ลงนามในใบเบิก', print: 'พิมพ์ใบเบิก',
  'attach-signed-copy': 'แนบสำเนาที่เซ็นแล้ว', 'void-payment': 'ยกเลิกการจ่าย',
};

type ReasonAction = 'cancel' | 'resume-cancel' | 'finance-return' | 'finance-block' | 'resolve-duplicate';
const REASON_DIALOGS: Record<ReasonAction, { title: string; description: string; confirmLabel: string; success: string; danger?: boolean; minLength?: number }> = {
  cancel: {
    title: 'ยกเลิกคำขอ', confirmLabel: 'ยืนยันยกเลิกคำขอ', success: 'ยกเลิกคำขอเรียบร้อยแล้ว', danger: true,
    description: 'ระบุเหตุผล ระบบจะปิดคำขอและยกเลิกรายการที่เกี่ยวข้อง คำขอนี้จะนำกลับมาใช้ต่อไม่ได้',
    // The reason also voids the claim's expense records, which take no shorter one: the API refuses it too.
    minLength: EXPENSE_VOID_REASON_MIN_LENGTH,
  },
  // A cancellation whose stored reason is what blocks it (audit B3): the same cancel call, with the corrected reason.
  'resume-cancel': {
    title: 'ดำเนินการยกเลิกต่อ', confirmLabel: 'ยืนยันยกเลิกคำขอ', success: 'ยกเลิกคำขอเรียบร้อยแล้ว', danger: true,
    description: 'เหตุผลที่ระบุไว้เดิมสั้นเกินไป ระบุเหตุผลที่ยกเลิกใหม่ ระบบจะปิดคำขอและยกเลิกรายการที่เกี่ยวข้อง คำขอนี้จะนำกลับมาใช้ต่อไม่ได้',
    minLength: EXPENSE_VOID_REASON_MIN_LENGTH,
  },
  'finance-return': {
    title: 'ส่งกลับให้แก้ไข', confirmLabel: 'ส่งกลับให้แก้ไข', success: 'ส่งใบเบิกกลับให้แก้ไขแล้ว',
    description: 'ระบุข้อมูลที่ต้องแก้ไข ใบเบิกจะกลับเป็นฉบับร่างและต้องผ่านการอนุมัติใหม่',
  },
  'finance-block': {
    title: 'ระงับการจ่าย', confirmLabel: 'ระงับการจ่าย', success: 'ระงับการจ่ายแล้ว', danger: true,
    description: 'ระบุเหตุผล ใบเบิกจะค้างที่ขั้นตรวจการเงินจนกว่าฝ่ายการเงินจะอนุมัติจ่ายหรือส่งกลับให้แก้ไข',
  },
  'resolve-duplicate': {
    title: 'ปลดรายการซ้ำ', confirmLabel: 'ยืนยันว่าไม่ซ้ำ', success: 'ปลดรายการซ้ำแล้ว',
    description: 'ตรวจแล้วว่าใบนี้ไม่ได้เบิกซ้ำกับคำขออื่น ระบุเหตุผลที่ยืนยันว่าไม่ซ้ำ ระบบจะบันทึกชื่อคุณและเหตุผลนี้ไว้ แล้วจึงบันทึกจ่ายได้',
  },
};

export function ReimbursementJourneyPage({ companyId, requestId, userId, permissions, roles = [], payOnOpen = false }: {
  companyId: string;
  requestId: string;
  userId: string;
  permissions: readonly string[];
  roles?: readonly string[];
  /** The finance queue's quick pay on a phone lands here: the payment form opens in the step card, never in a dialog. */
  payOnOpen?: boolean;
}) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const hubHref = `/companies/${companyId}/reimbursements`;
  const back = <Link href={hubHref}>← กลับไปการเบิกจ่าย</Link>;
  const [detail, setDetail] = useState<any | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const [voidingPayment, setVoidingPayment] = useState<any | null>(null);
  const [staleReview, setStaleReview] = useState<{ before: any; detail: any } | null>(null);
  const [missingSignatureFor, setMissingSignatureFor] = useState<ClaimSignatureRole | null>(null);
  const [approverHelp, setApproverHelp] = useState<ReturnType<typeof approverNotReadyHelp>>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [noteBody, setNoteBody] = useState('');
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  // "ตรวจบัญชีแล้ว" is given for one account version; a claim sent again with another version unticks it.
  const [attestedVersion, setAttestedVersion] = useState<number | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const { previewLoadingKey, openClaimForm, openAttachment, openPaymentSlip, previewModals } = useClaimDocumentPreview(companyId, setActionError);

  const saveNote = async () => {
    if (!noteBody.trim() || noteBusy) return;
    setNoteBusy(true); setNoteError(null);
    try {
      const wasEditing = editingNote;
      if (wasEditing) {
        await editReimbursementInternalNote(companyId, requestId, wasEditing, noteBody.trim());
        setDetail((current: any) => ({ ...current, internalNotes: (current.internalNotes ?? []).map((note: any) =>
          note.id === wasEditing ? { ...note, body: noteBody.trim(), updatedAt: new Date().toISOString() } : note) }));
      } else {
        const note = await addReimbursementInternalNote(companyId, requestId, noteBody.trim());
        setDetail((current: any) => ({ ...current, internalNotes: [...(current.internalNotes ?? []), note] }));
      }
      setNoteBody(''); setEditingNote(null);
      toast.success(wasEditing ? 'แก้ไขโน้ตแล้ว' : 'เพิ่มโน้ตแล้ว');
    } catch (error) { setNoteError(errorText(error)); }
    finally { setNoteBusy(false); }
  };

  const removeNote = async (noteId: string) => {
    if (!(await confirm({ title: 'ลบโน้ตภายใน', message: 'ลบโน้ตนี้ออกจากรายการเบิก?', confirmLabel: 'ลบโน้ต', cancelLabel: 'กลับ', variant: 'danger' }))) return;
    setNoteBusy(true); setNoteError(null);
    try {
      await deleteReimbursementInternalNote(companyId, requestId, noteId);
      setDetail((current: any) => ({ ...current, internalNotes: (current.internalNotes ?? []).filter((note: any) => note.id !== noteId) }));
      if (editingNote === noteId) { setEditingNote(null); setNoteBody(''); }
      toast.success('ลบโน้ตแล้ว');
    } catch (error) { setNoteError(errorText(error)); }
    finally { setNoteBusy(false); }
  };

  // Asked for once, on arrival: a later re-read of the claim never reopens a form the payer closed.
  const payRequested = useRef(payOnOpen);
  useEffect(() => {
    let active = true;
    setLoadError(null);
    getReimbursement(companyId, requestId)
      .then((next) => {
        if (!active) return;
        setDetail(next);
        if (opensPaymentFormOnArrival(payRequested.current, activeJourneyStep(buildJourneySteps(next, permissions, userId)))) {
          setPayOpen(true);
          // The step card holding the form comes into view, as it does after an action.
          setFocusTick((tick) => tick + 1);
        }
        payRequested.current = false;
      })
      .catch((e) => { if (active) setLoadError(e); });
    return () => { active = false; };
  }, [companyId, requestId, reloadKey, permissions, userId]);

  // The card of the step the claim moved to takes focus (and scrolls into view) after an action.
  useEffect(() => { if (focusTick) cardRef.current?.focus(); }, [focusTick]);

  const steps = useMemo(() => (detail ? buildJourneySteps(detail, permissions, userId) : []), [detail, permissions, userId]);
  const step = activeJourneyStep(steps);
  const signature = (claim: any) => {
    const active = activeJourneyStep(buildJourneySteps(claim, permissions, userId));
    return `${active?.key}:${active?.state}`;
  };

  /**
   * One action, then a re-read of the claim — on failure too: a two-phase action (finance
   * อนุมัติจ่าย) commits its decision before projecting, so a thrown error can still leave the claim
   * changed (BUG-7). A failed re-read keeps what the action returned: a frozen assignee may lose
   * read permission the moment they decide. `handled` takes errors that open their own dialog.
   */
  const act = async (key: string, fn: () => Promise<any>, success: string, handled?: (e: unknown) => boolean) => {
    const before = signature(detail);
    setBusyAction(key); setActionError(null);
    let ok = false;
    let dialogOpened = false;
    let latest: any = null;
    try {
      const result = await fn();
      if (Array.isArray(result?.lines)) latest = result;
      ok = true;
      toast.success(success);
    } catch (e) {
      dialogOpened = handled?.(e) ?? false;
      if (!dialogOpened) setActionError(errorText(e));
    }
    try { latest = await getReimbursement(companyId, requestId); } catch { /* keep what is on screen */ }
    const shown = latest ?? detail;
    if (latest) setDetail(latest);
    setBusyAction(null);
    if ((!ok && !dialogOpened) || signature(shown) !== before) setFocusTick((tick) => tick + 1);
    return { ok, latest: shown };
  };

  const approve = async (review?: { detail: any }) => {
    const before = detail;
    const target = review?.detail ?? detail;
    // The server refuses a transfer claim without the attestation of its current account version.
    const verified = claimNeedsPayoutAttestation(target) ? attestedVersion : null;
    if (claimNeedsPayoutAttestation(target) && verified !== target.payout?.version) {
      setStaleReview(null);
      setActionError(PAYOUT_ATTESTATION_REQUIRED);
      return;
    }
    let stale = false;
    const { ok, latest } = await act(
      'approve',
      () => approveReimbursement(companyId, requestId, undefined, target.approvalSnapshotHash, verified ?? undefined),
      'อนุมัติคำขอเรียบร้อยแล้ว',
      (e) => { stale = !review && isStaleApprovalError(e); return stale; },
    );
    if (stale) { setStaleReview({ before, detail: latest }); return; }
    if (!ok) return;
    setStaleReview(null);
    // AC03: an approver who may also pay gets the form at once; everyone else just sees the next step.
    if (activeJourneyStep(buildJourneySteps(latest, permissions, userId))?.actions.includes('pay')) setPayOpen(true);
  };

  /** One tap, one call per block with the same saved signature (spec §9); a refusal stops the rest. */
  const sign = (roles: ClaimSignatureRole[]) => {
    const snapshotHash = detail?.claimSignatureAckHash;
    if (!snapshotHash) { setActionError('ไม่พบข้อมูลคำขอล่าสุด กรุณาเปิดคำขอใหม่'); return; }
    void act('sign', async () => { for (const role of roles) await signReimbursementClaimForm(companyId, requestId, { role, snapshotHash }); },
      'ลงนามใบเบิกเรียบร้อยแล้ว',
      (e) => { if (!isMissingSavedSignatureError(e)) return false; setMissingSignatureFor(roles[0] ?? null); return true; });
  };

  const afterPayment = async () => {
    setPayOpen(false);
    try { setDetail(await getReimbursement(companyId, requestId)); } catch { /* keep what is on screen */ }
    setFocusTick((tick) => tick + 1);
  };

  if (!detail) {
    const status = (loadError as { status?: number } | null)?.status;
    return (
      <MangmeePage eyebrow={back} title="คำขอเบิก">
        <MangmeeCard className="p-6">
          {!loadError ? <LoadingState label="กำลังเปิดใบเบิก..." />
            : status === 403 ? <ForbiddenState />
              : status === 404 ? (
                <EmptyState
                  title="ไม่พบคำขอเบิกนี้"
                  description="คำขออาจถูกลบ หรือไม่ได้อยู่ในบริษัทนี้"
                  action={<Link href={hubHref} className={ghostClass}>กลับไปการเบิกจ่าย</Link>}
                />
              )
                : <ErrorState description={errorText(loadError)} onRetry={() => setReloadKey((key) => key + 1)} />}
        </MangmeeCard>
      </MangmeePage>
    );
  }

  const stepIndex = step ? steps.indexOf(step) : -1;
  const receiptReadiness = reimbursementSubmitReadiness(detail);
  const payoutBlock = claimPayoutSubmitBlock(detail);
  // One reason at a time: the receipt rule first, then the receiving method.
  const readiness = receiptReadiness.blocked || !payoutBlock ? receiptReadiness : { blocked: true, message: payoutBlock };
  const needsAttestation = Boolean(step?.actions.includes('approve')) && claimNeedsPayoutAttestation(detail);
  const attested = needsAttestation && attestedVersion === detail.payout?.version;
  const staleReviewNeedsAttestation = !!staleReview && claimNeedsPayoutAttestation(staleReview.detail)
    && attestedVersion !== staleReview.detail.payout?.version;
  const duplicateResolutionBlocked = detail.duplicateStatus === 'POSSIBLE_DUPLICATE'
    && !permissions.includes('reimbursement.duplicate.resolve');
  const recordedPayment = (detail.payments ?? []).filter((row: any) => row.status === 'RECORDED').at(-1);
  const desk = currentDeskText(detail.currentDesk, detail.paymentDesk);
  const handlers: Partial<Record<JourneyAction, () => void>> = {
    // No approver at all: the answer names who fixes it and, for a policy manager, links there.
    // The token names the account shown in the card above: the server sends the claim with that one or refuses.
    submit: () => { setApproverHelp(null); void act('submit', () => submitReimbursement(companyId, requestId, detail.payout?.submitToken), 'ส่งขออนุมัติเรียบร้อยแล้ว',
      (e) => { const help = approverNotReadyHelp(e, permissions); setApproverHelp(help); return help !== null; }); },
    cancel: () => { setActionError(null); setReasonAction('cancel'); },
    // The reason on record stays; only a stored reason the system cannot cancel with is asked for again.
    'resume-cancel': () => {
      setActionError(null);
      if (detail.pendingCancellation?.blocker?.code === 'reason_too_short') setReasonAction('resume-cancel');
      else void act('resume-cancel', () => cancelReimbursement(companyId, requestId), 'ยกเลิกคำขอเรียบร้อยแล้ว');
    },
    'withdraw-cancel': () => void (async () => {
      if (!(await confirm({
        title: 'ถอนการยกเลิก',
        message: 'คำขอนี้จะกลับไปเดินต่อตามขั้นตอนเดิม เหมือนยังไม่เคยกดยกเลิก',
        confirmLabel: 'ถอนการยกเลิก',
        cancelLabel: 'กลับ',
        variant: 'primary',
      }))) return;
      await act('withdraw-cancel', () => withdrawReimbursementCancellation(companyId, requestId), 'ถอนการยกเลิกแล้ว คำขอกลับไปเดินต่อตามเดิม');
    })(),
    reopen: () => void (async () => {
      // Withdrawing takes the claim off the approver's desk, so it asks first; reopening a refusal does not.
      if (detail.status === 'PENDING_APPROVAL' && !(await confirm({
        title: 'เปิดคำขอกลับเป็นร่าง',
        message: 'ผู้อนุมัติจะไม่เห็นคำขอนี้จนกว่าคุณจะส่งอนุมัติอีกครั้ง เลขที่ใบเบิกยังเป็นเลขเดิม ถ้าลงนามหรือแนบสำเนาใบเบิกไว้แล้ว ต้องทำใหม่หลังส่ง',
        confirmLabel: 'เปิดกลับเป็นร่าง',
        cancelLabel: 'กลับ',
        variant: 'primary',
      }))) return;
      await act('reopen', () => reopenReimbursement(companyId, requestId), 'เปิดคำขอกลับเป็นร่างแล้ว แก้ไขและส่งอนุมัติได้อีกครั้ง');
    })(),
    approve: () => void approve(),
    reject: () => { setActionError(null); setRejecting(true); },
    // Audit B4: the decision is on record; this has the system carry it out now. Nothing is approved or attested again.
    resume: () => void act('resume', () => resumeReimbursement(companyId, requestId), 'ดำเนินการต่อเรียบร้อยแล้ว'),
    'finance-approve': () => void act('finance-approve', () => financeReviewReimbursement(companyId, requestId, {
      decision: 'APPROVED_FOR_PAYMENT',
      resolveDuplicate: detail.duplicateStatus === 'POSSIBLE_DUPLICATE',
      duplicateResolutionReason: detail.duplicateStatus === 'POSSIBLE_DUPLICATE' ? 'ตรวจสอบแล้วไม่ซ้ำ' : undefined,
    }), detail.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ดำเนินการคำขอจ่ายต่อเรียบร้อยแล้ว' : 'อนุมัติจ่ายเรียบร้อยแล้ว'),
    'finance-return': () => { setActionError(null); setReasonAction('finance-return'); },
    'finance-block': () => { setActionError(null); setReasonAction('finance-block'); },
    'resolve-duplicate': () => { setActionError(null); setReasonAction('resolve-duplicate'); },
    pay: () => setPayOpen(true),
    print: () => void openClaimForm(detail),
    'void-payment': () => { setActionError(null); setVoidingPayment(recordedPayment); },
  };

  const actionButton = (action: JourneyAction, index: number) => {
    const className = cx(index === 0 ? btnClass : ghostClass, 'w-full sm:w-auto');
    const label = action === 'edit' && detail.financeReviewStatus === 'NEEDS_INFO' ? 'แก้ไขตามคำขอ'
      : action === 'reopen' && detail.status === 'PENDING_APPROVAL' ? 'แก้ไข (เปิดกลับเป็นร่าง)'
        : action === 'finance-approve' ? financeActionLabel(detail)
          : ACTION_LABELS[action];
    if (action === 'edit') return <Link key={action} className={className} href={`${hubHref}/${detail.id}/edit`}>{label}</Link>;
    if (action === 'policy-settings') return <Link key={action} className={className} href={`${hubHref}?tab=policy`}>{label}</Link>;
    // Signing and the signed copy live in their sections below; the card points there.
    if (action === 'sign') return <a key={action} className={className} href="#reimbursement-signatures">{label}</a>;
    if (action === 'attach-signed-copy') return <a key={action} className={className} href="#reimbursement-signed-copies">{label}</a>;
    const working = busyAction === action || (action === 'print' && previewLoadingKey !== null);
    const blockedReason = action === 'submit' && readiness.blocked ? readiness.message
      : action === 'approve' && needsAttestation && !attested ? PAYOUT_ATTESTATION_REQUIRED
        : action === 'finance-approve' && duplicateResolutionBlocked ? 'รายการนี้อาจซ้ำ ต้องให้ผู้มีสิทธิ์แก้รายการซ้ำตรวจสอบ' : undefined;
    return (
      <button key={action} type="button" className={className} title={blockedReason}
        disabled={busyAction !== null || previewLoadingKey !== null || Boolean(blockedReason)} aria-busy={working}
        onClick={handlers[action]}>
        {working ? 'กำลังดำเนินการ...' : label}
      </button>
    );
  };
  // The payment form replaces its own button while it is open.
  const cardActions = (step?.actions ?? []).filter((action) => !(action === 'pay' && payOpen));
  const reasonDialog = reasonAction ? REASON_DIALOGS[reasonAction] : null;

  return (
    <MangmeePage
      // A display name with no spaces (an email used as a name) must wrap at 390 px, not push the page wide.
      className="[overflow-wrap:anywhere]"
      eyebrow={back}
      title={detail.requestNo ?? 'คำขอเบิกฉบับร่าง'}
      description={desk ? `อยู่ที่ ${desk}` : undefined}
      meta={<StatusBadge status={detail.status} />}
    >
      <ClaimSummaryCard detail={detail} />

      <MangmeeCard className="space-y-3 p-4 sm:p-5">
        <div>
          <h2 className="font-bold text-gray-900">โน้ตภายในบริษัท</h2>
          <p className="text-xs text-gray-500">เห็นได้เฉพาะผู้ที่มีสิทธิ์ดูใบเบิกนี้ ไม่ปรากฏในใบเบิกที่พิมพ์</p>
        </div>
        {(detail.internalNotes ?? []).length === 0 && <p className="text-sm text-gray-500">ยังไม่มีโน้ต</p>}
        <ul className="space-y-3">
          {(detail.internalNotes ?? []).map((note: any) => (
            <li key={note.id} className="rounded-lg border border-gray-200 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-xs text-gray-500">{note.authorName} · {formatThaiDateTime(note.createdAt)}</div>
                {(note.authorUserId === userId || roles.includes('OWNER')) && (
                  <div className="flex gap-2">
                    <button type="button" className="text-brand-700 hover:underline" aria-label={`แก้ไขโน้ตของ ${note.authorName}`} disabled={noteBusy} aria-busy={noteBusy}
                      onClick={() => { setEditingNote(note.id); setNoteBody(note.body); setNoteError(null); }}>แก้ไข</button>
                    <button type="button" className="text-red-700 hover:underline" aria-label={`ลบโน้ตของ ${note.authorName}`} disabled={noteBusy} aria-busy={noteBusy}
                      onClick={() => void removeNote(note.id)}>ลบ</button>
                  </div>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-gray-800">{note.body}</p>
              {note.updatedAt !== note.createdAt && <p className="mt-1 text-xs text-gray-400">แก้ไขแล้ว {formatThaiDateTime(note.updatedAt)}</p>}
            </li>
          ))}
        </ul>
        <label htmlFor="reimbursement-internal-note" className="block text-sm font-semibold text-gray-700">
          {editingNote ? 'แก้ไขโน้ต' : 'เพิ่มโน้ต'}
        </label>
        <textarea id="reimbursement-internal-note" className={cx(inputClass, 'min-h-24 w-full resize-y')}
          value={noteBody} onChange={(event) => setNoteBody(event.target.value)} maxLength={2000}
          placeholder="เขียนข้อมูลสำหรับคนในบริษัท" disabled={noteBusy} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnClass} disabled={noteBusy || !noteBody.trim()} aria-busy={noteBusy} onClick={() => void saveNote()}>
            {noteBusy ? 'กำลังบันทึก...' : editingNote ? 'บันทึกการแก้ไข' : 'เพิ่มโน้ต'}
          </button>
          {editingNote && <button type="button" className={ghostClass} disabled={noteBusy}
            onClick={() => { setEditingNote(null); setNoteBody(''); setNoteError(null); }}>ยกเลิก</button>}
          <span className="text-xs text-gray-400">{noteBody.length}/2000</span>
        </div>
        {noteError && <ErrorBanner message={noteError} />}
      </MangmeeCard>

      <MangmeeCard className="p-4 sm:p-5">
        <p className="mb-4 text-sm font-semibold text-gray-500">
          {step?.state === 'ended' ? 'คำขอนี้ปิดแล้ว' : `ขั้นตอน ${stepIndex + 1} จาก ${steps.length}`}
        </p>
        <ThemedSteps
          aria-label="ขั้นตอนของคำขอเบิก"
          steps={steps.map((row) => ({
            key: row.key,
            label: row.label,
            state: STEPPER_STATE[row.state],
            ...(row.state === 'done' && row.note ? { description: row.note } : {}),
          }))}
        />
      </MangmeeCard>

      <ClaimPayoutCard
        companyId={companyId}
        detail={detail}
        userId={userId}
        payoutAccountHref={`${hubHref}/payout-account`}
        // The same condition as the withdraw button of the approval step below.
        canWithdraw={detail.status === 'PENDING_APPROVAL' && Boolean(step?.actions.includes('reopen'))}
        // At the payment step, for whoever is offered to record the payment, the card is the account to transfer into.
        payStep={step?.key === 'payment' && step.actions.includes('pay')}
        {...(step?.actions.includes('edit') && { editHref: `${hubHref}/${detail.id}/edit` })}
      />

      {step && (
        <section ref={cardRef} tabIndex={-1} aria-labelledby="journey-step-title"
          className="mangmee-card space-y-3 p-4 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:p-5">
          <div>
            <p className="text-xs font-bold text-brand-700">ขั้นตอน {stepIndex + 1}</p>
            <h2 id="journey-step-title" className="mt-1 text-lg font-bold text-gray-900">{step.label}</h2>
            {step.note && <p className="mt-1 text-sm text-gray-600">{step.note}</p>}
          </div>
          {step.actions.includes('submit') && readiness.blocked && readiness.message && <ErrorBanner message={readiness.message} />}
          {needsAttestation && (
            <PayoutAttestationCheck checked={attested} disabled={busyAction !== null}
              onChange={(checked) => setAttestedVersion(checked ? detail.payout?.version ?? null : null)} />
          )}
          {cardActions.length > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{cardActions.map(actionButton)}</div>
          )}
          {payOpen && step.actions.includes('pay') && (
            <div className="border-t border-gray-100 pt-3">
              <PaymentForm companyId={companyId} request={detail} onCancel={() => setPayOpen(false)} onDone={() => void afterPayment()} />
            </div>
          )}
          {approverHelp && step.actions.includes('submit') && (
            <div className="space-y-2">
              <ErrorBanner message={approverHelp.text} focus />
              {approverHelp.policyLink && (
                <Link className={cx(ghostClass, 'w-full sm:w-auto')} href={`${hubHref}?tab=policy`}>{ACTION_LABELS['policy-settings']}</Link>
              )}
            </div>
          )}
          {actionError && <ErrorBanner message={actionError} />}
        </section>
      )}

      <ClaimDetailSections
        detail={detail}
        userId={userId}
        permissions={permissions}
        busy={busyAction !== null || previewLoadingKey !== null}
        onOpenAttachment={(attachmentId, fileName) => void openAttachment(detail.id, attachmentId, fileName)}
        onLineReceipt={(lineNo, file) => void act('receipt', () => setLineReceipt(companyId, requestId, detail.lines ?? [], lineNo, file, detail.branchId), 'แนบใบเสร็จเรียบร้อยแล้ว')}
        onSign={sign}
        onUploadSignedCopy={(file, confirmedRequestNo) => void act('signed-copy',
          () => uploadSignedClaimFormCopy(companyId, requestId, file, detail.branchId, confirmedRequestNo),
          confirmedRequestNo ? 'แนบสำเนาใบเบิกที่ลงนามครบเรียบร้อยแล้ว' : 'แนบไฟล์เรียบร้อยแล้ว')}
        onRequestVoidPayment={(payment) => { setActionError(null); setVoidingPayment(payment); }}
        onOpenPaymentSlip={(payment, attachmentId, name) => void openPaymentSlip(detail.id, payment.id, attachmentId, name)}
        onAttachPaymentSlip={(payment, file) => void act('attach-slip', async () => attachReimbursementPaymentSlip(
          companyId, requestId, payment.id, await uploadReimbursementPaymentSlip(companyId, requestId, file),
        ), 'แนบสลิปเรียบร้อยแล้ว')}
        onUseSignedCopyAsSlip={(copy, payment) => void (async () => {
          // The file changes hands and a paper-signature declaration may go with it, so it asks first.
          if (!(await confirm({
            title: 'ใช้ไฟล์นี้เป็นสลิปการจ่าย', message: signedCopyMoveConfirmText(copy, payment),
            confirmLabel: 'ย้ายเป็นสลิปการจ่าย', cancelLabel: 'กลับ', variant: 'primary',
          }))) return;
          await act('move-slip', () => attachReimbursementPaymentSlip(companyId, requestId, payment.id, copy.attachmentId), 'ย้ายไฟล์ไปเป็นสลิปการจ่ายแล้ว');
        })()}
      />

      {previewModals}
      {missingSignatureFor && <MissingSavedSignatureModal companyId={companyId} onClose={() => setMissingSignatureFor(null)} />}
      {rejecting && <RejectDialog
        requestNo={detail.requestNo}
        busy={busyAction === 'reject'}
        error={actionError}
        onClose={() => setRejecting(false)}
        onConfirm={async (reason) => {
          if ((await act('reject', () => rejectReimbursement(companyId, requestId, reason), 'ปฏิเสธคำขอเรียบร้อยแล้ว')).ok) setRejecting(false);
        }}
      />}
      {reasonAction && reasonDialog && <ReasonDialog
        title={`${reasonDialog.title} ${detail.requestNo ?? ''}`.trim()}
        description={reasonDialog.description}
        confirmLabel={reasonDialog.confirmLabel}
        danger={reasonDialog.danger}
        minLength={reasonDialog.minLength}
        initialReason={reasonAction === 'resume-cancel' ? detail.pendingCancellation?.reason : undefined}
        busy={busyAction === reasonAction}
        error={actionError}
        onClose={() => setReasonAction(null)}
        onConfirm={async (reason) => {
          const request = reasonAction === 'cancel' || reasonAction === 'resume-cancel'
            ? () => cancelReimbursement(companyId, requestId, reason)
            // No decision: the payment-step duplicate clear on the finance-review endpoint.
            : reasonAction === 'resolve-duplicate'
              ? () => financeReviewReimbursement(companyId, requestId, { resolveDuplicate: true, duplicateResolutionReason: reason })
              : () => financeReviewReimbursement(companyId, requestId, { decision: reasonAction === 'finance-return' ? 'NEEDS_INFO' : 'BLOCKED', note: reason });
          if ((await act(reasonAction, request, reasonDialog.success)).ok) setReasonAction(null);
        }}
      />}
      {confirmDialog}
      {voidingPayment && <VoidPaymentDialog
        payment={voidingPayment}
        busy={busyAction === 'void-payment'}
        error={actionError}
        onClose={() => setVoidingPayment(null)}
        onConfirm={async (reason) => {
          if ((await act('void-payment', () => voidReimbursementPayment(companyId, requestId, voidingPayment.id, reason),
            'ยกเลิกการจ่ายแล้ว ใบเบิกกลับไปรอจ่าย คุณสามารถบันทึกจ่ายใหม่หรือยกเลิกคำขอต่อได้')).ok) setVoidingPayment(null);
        }}
      />}
      {staleReview && <StaleApprovalDialog
        requestNo={staleReview.detail.requestNo ?? staleReview.before.requestNo}
        diff={diffApprovalFields(
          approvalComparable(staleReview.before, (staleReview.before.lines ?? []).length),
          approvalComparable(staleReview.detail, (staleReview.detail.lines ?? []).length),
        )}
        lines={staleReview.detail.lines ?? []}
        currency={staleReview.detail.currency}
        busy={busyAction === 'approve'}
        error={actionError}
        onClose={() => setStaleReview(null)}
        // The page behind already shows the latest claim. An account the approver has not ticked
        // (it changed, or was never ticked) is checked there, not approved from this dialog.
        {...(staleReviewNeedsAttestation && { confirmLabel: 'ปิดเพื่อตรวจบัญชีรับเงิน' })}
        onConfirm={() => (staleReviewNeedsAttestation ? setStaleReview(null) : void approve({ detail: staleReview.detail }))}
      />}
    </MangmeePage>
  );
}
