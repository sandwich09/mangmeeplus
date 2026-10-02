'use client';

// หน้า journey: one claim as 4–5 steps with the current step's actions (spec §5, §6, §12).
// Every action still goes through its own endpoint; this page re-reads the claim afterwards.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { EXPENSE_VOID_REASON_MIN_LENGTH, reimbursementPayoutRoundApproves } from '@watchdog-bms/contracts';
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
import { POLICY_TAB_LABEL, claimDeskText, reimbursementSubmitReadiness, type ClaimSignatureRole } from './reimbursements.model';
import {
  activeJourneyStep, approvalComparable, approverNotReadyHelp, buildJourneySteps, diffApprovalFields, errorText, isMissingSavedSignatureError,
  isStaleApprovalError, opensPaymentFormOnArrival, signedCopyMoveConfirmText, type JourneyAction, type JourneyStepState,
} from './reimbursements.logic';
import {
  ClaimDetailSections, ClaimSummaryCard, MissingSavedSignatureModal, PaymentForm, ReasonDialog, RejectDialog,
  StaleApprovalDialog, StatusBadge, VoidPaymentDialog, financeActionLabel, useClaimDocumentPreview,
} from './ReimbursementDetailSections';
import { BackToClaimsLink, ClaimPayoutCard, PayoutAttestationCheck } from './ReimbursementPayout';
import { PAYOUT_ATTESTATION_REQUIRED, claimNeedsPayoutAttestation, claimPayoutSubmitBlock } from './reimbursement-payout.logic';
// The payout account correction round (payout spec §14): its forms and card, and the words of its buttons.
import { PayoutCorrectionAccountForm, PayoutCorrectionComparison, PayoutCorrectionRequestForm } from './ReimbursementPayoutCorrection';
import {
  PAYOUT_CORRECTION_SAVE_LABEL, PAYOUT_CORRECTION_STALE_PRESS, PAYOUT_CORRECTION_SUPERSEDED, payoutCorrectionAnswerWords, payoutCorrectionSendBackTitle, payoutRoundTexts,
} from './reimbursement-payout.logic';

const STEPPER_STATE: Record<JourneyStepState, ThemedStepState> = {
  done: 'done', current: 'current', upcoming: 'upcoming', 'needs-fix': 'attention', ended: 'attention',
};

// The two actions of a payout round have no fixed words: they follow what the claim holds (`payoutCorrectionSendBackTitle`,
// `payoutCorrectionAnswerWords`).
const ACTION_LABELS: Record<Exclude<JourneyAction, 'send-back' | 'correct-payout'>, string> = {
  submit: 'ส่งอนุมัติ', edit: 'แก้ไขคำขอ', cancel: 'ยกเลิกคำขอ', reopen: 'แก้ไขและส่งใหม่',
  'resume-cancel': 'ดำเนินการยกเลิกต่อ', 'withdraw-cancel': 'ถอนการยกเลิก',
  approve: 'อนุมัติ', reject: 'ปฏิเสธ', resume: 'ดำเนินการต่อ', 'policy-settings': `ไปที่${POLICY_TAB_LABEL}`,
  'finance-approve': 'อนุมัติจ่าย', 'finance-return': 'ส่งกลับให้แก้ไข', 'finance-block': 'ระงับการจ่าย',
  'resolve-duplicate': 'ปลดรายการซ้ำ', pay: 'บันทึกจ่าย', sign: 'ลงนามในใบเบิก', print: 'พิมพ์ใบเบิก',
  'attach-signed-copy': 'แนบสำเนาที่เซ็นแล้ว', 'void-payment': 'ยกเลิกการจ่าย',
};

/** An approval that arrived after the claim had moved on, where nothing is left for this viewer to approve. */
const STALE_APPROVAL_NOTHING_TO_APPROVE = 'ยังไม่ได้อนุมัติ เพราะมีผู้ทำรายการกับใบนี้ไปก่อนแล้ว หน้านี้แสดงสถานะล่าสุดของใบ';

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
  const back = <BackToClaimsLink href={hubHref} />;
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
  // Which form of a correction round is open inside the step card: sending the claim back, or giving its account.
  const [correctionForm, setCorrectionForm] = useState<'send-back' | 'correct-payout' | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const { previewLoadingKey, openClaimForm, openAttachment, openPaymentSlip, openSlipChoice, previewModals } = useClaimDocumentPreview(companyId, setActionError);

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
      // The claim moved on: a form of the correction round left open is for the claim as it was. Without this, a
      // send-back form opened beside "อนุมัติ" was open again at the pay step the approval led to.
      setCorrectionForm(null);
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
      // In a payout round the same call approves what was answered alone, and the claim is back at its pay step: said of
      // that thing, a new account, the account the claim had, a first one, or cash.
      target.payoutCorrectionPhase ? `อนุมัติ${reimbursementPayoutRoundApproves(target.payoutCorrectionAnswer)}แล้ว ใบกลับไปรอจ่ายเงินคืน` : 'อนุมัติคำขอเรียบร้อยแล้ว',
      (e) => { stale = !review && isStaleApprovalError(e); return stale; },
    );
    if (stale) {
      // Changed since this page read it. Where this viewer may still approve the claim as it is now, they compare
      // and decide again. Where they may not (someone else decided it, sent it back for its payout account or
      // cancelled it meanwhile) there is nothing left to approve: the page already shows where the claim stands.
      if (activeJourneyStep(buildJourneySteps(latest, permissions, userId))?.actions.includes('approve')) setStaleReview({ before, detail: latest });
      else setActionError(STALE_APPROVAL_NOTHING_TO_APPROVE);
      return;
    }
    if (!ok) {
      // Refused from the dialog of an edited claim, and nothing is left for this viewer to approve (decided, cancelled or
      // taken back meanwhile): that dialog can do nothing more, so it closes and the step card says what was not done.
      if (review && !activeJourneyStep(buildJourneySteps(latest, permissions, userId))?.actions.includes('approve')) setStaleReview(null);
      return;
    }
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

  /**
   * A form of a correction round was taken by the API. Its answer is the claim without this viewer's flags, so
   * the claim is read again; a read that fails keeps the answer, which at least says where the claim stands now.
   */
  const afterCorrection = async (answered: any, success: string) => {
    setCorrectionForm(null); setActionError(null);
    toast.success(success);
    let latest = Array.isArray(answered?.lines) ? answered : null;
    try { latest = await getReimbursement(companyId, requestId); } catch { /* keep what the call answered */ }
    if (latest) setDetail(latest);
    setFocusTick((tick) => tick + 1);
  };

  /**
   * A form of a correction round was refused because the claim moved on (409). The page reads the claim again, so what
   * is under the form is true. A form still offered stays, with what was typed; one no longer offered is closed, and
   * the page says what was not done and where to read what can be done now. Answers whether the form stays.
   *
   * `claimChanged`: the account form was opened on a claim that has changed since, perhaps by an earlier press of the
   * same form. It is closed even where it is still offered, so the account typed for the claim as it was is not sent
   * to the claim as it is, and the page says to look at the account the claim has now before giving one again.
   */
  const afterCorrectionConflict = async (form: 'send-back' | 'correct-payout', claimChanged = false) => {
    let latest: any;
    try { latest = await getReimbursement(companyId, requestId); } catch { return false; /* the form's own banner says why */ }
    setDetail(latest);
    const offered = activeJourneyStep(buildJourneySteps(latest, permissions, userId))?.actions.includes(form) === true;
    if (offered && !claimChanged) return true;
    setCorrectionForm(null); setActionError(offered ? PAYOUT_CORRECTION_STALE_PRESS : PAYOUT_CORRECTION_SUPERSEDED[form]);
    setFocusTick((tick) => tick + 1);
    return false;
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
  // The server's own answer to "would this claim's payment be refused for a duplicate": the fact the pay-queue row
  // marks (`hasDuplicateBlocker`). The finance approval clears the block exactly when there is one, as the queue's does.
  const duplicateBlocks = detail.duplicateBlocksPayment === true;
  const duplicateResolutionBlocked = duplicateBlocks && !permissions.includes('reimbursement.duplicate.resolve');
  const recordedPayment = (detail.payments ?? []).filter((row: any) => row.status === 'RECORDED').at(-1);
  const desk = claimDeskText(detail);
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
      resolveDuplicate: duplicateBlocks,
      duplicateResolutionReason: duplicateBlocks ? 'ตรวจสอบแล้วไม่ซ้ำ' : undefined,
    }), detail.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ดำเนินการคำขอจ่ายต่อเรียบร้อยแล้ว' : 'อนุมัติจ่ายเรียบร้อยแล้ว'),
    'finance-return': () => { setActionError(null); setReasonAction('finance-return'); },
    'finance-block': () => { setActionError(null); setReasonAction('finance-block'); },
    'resolve-duplicate': () => { setActionError(null); setReasonAction('resolve-duplicate'); },
    pay: () => { setCorrectionForm(null); setPayOpen(true); },
    // One form at a time in the step card: sending the claim back closes a payment form left open.
    'send-back': () => { setActionError(null); setPayOpen(false); setCorrectionForm('send-back'); },
    'correct-payout': () => { setActionError(null); setCorrectionForm('correct-payout'); },
    print: () => void openClaimForm(detail),
    'void-payment': () => { setActionError(null); setVoidingPayment(recordedPayment); },
  };

  const actionButton = (action: JourneyAction) => {
    // The step's first action is its primary one. While a form is open in the card the form's own save is, so no
    // button left beside it reads as the main thing to press ("ยกเลิกคำขอ" did, above an open form).
    const className = cx(action === primaryAction ? btnClass : ghostClass, 'w-full sm:w-auto');
    const label = action === 'edit' && detail.financeReviewStatus === 'NEEDS_INFO' ? 'แก้ไขตามคำขอ'
      : action === 'reopen' && detail.status === 'PENDING_APPROVAL' ? 'แก้ไข (เปิดกลับเป็นร่าง)'
        : action === 'finance-approve' ? financeActionLabel(detail)
          // From the step a round waits on, sending back is how its approvers do not take what was answered: said as
          // that, of an account to correct again or of cash to choose again.
          : action === 'send-back' ? payoutCorrectionSendBackTitle(detail)
            : action === 'correct-payout' ? correctPayoutLabel
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
  // A form of the correction round is open only while the server still offers its action to this viewer.
  const openCorrectionForm = correctionForm && step?.actions.includes(correctionForm) ? correctionForm : null;
  // The requester answers for themselves; a finance reviewer answers on their behalf. Again, once an answer was given.
  // The words say what is asked by what the claim holds: an account to correct, one to add, or the method to choose.
  const correctPayoutLabel = payoutCorrectionAnswerWords(detail, detail.requesterUserId === userId).button;
  // At the pay step the send-back is no button of this card: it sits at the foot of the account box, as a line of text,
  // away from "บันทึกจ่าย". From the step a round waits on it stays here: there it is how the new account is refused.
  const sendBackAtAccountBox = step?.key === 'payment' && !detail.payoutCorrectionPhase && step.actions.includes('send-back');
  // A form replaces its own button while it is open: the payment form, and the two of a correction round.
  const cardActions = (step?.actions ?? []).filter((action) => !(action === 'pay' && payOpen) && action !== openCorrectionForm
    && !(action === 'send-back' && sendBackAtAccountBox));
  const formOpen = openCorrectionForm !== null || (payOpen && Boolean(step?.actions.includes('pay')));
  // Giving the account again while it already waits for its approvers is allowed, and is not what the claim waits
  // for: it starts the approvers' wait over, so it is offered without the look of the thing to do next.
  const givingAgain = step?.actions[0] === 'correct-payout' && detail.payoutCorrectionPhase === 'AWAITING_APPROVAL';
  // The first action still shown as a button: a viewer who can only send the claim back has no main thing to press here.
  const primaryAction = formOpen || givingAgain ? undefined : cardActions[0] === step?.actions[0] ? cardActions[0] : undefined;
  const reasonDialog = reasonAction ? REASON_DIALOGS[reasonAction] : null;

  return (
    <MangmeePage
      // A display name with no spaces (an email used as a name) must wrap at 390 px, not push the page wide.
      className="[overflow-wrap:anywhere]"
      eyebrow={back}
      title={detail.requestNo ?? 'คำขอเบิกฉบับร่าง'}
      description={desk ? `อยู่ที่ ${desk}` : undefined}
      meta={<StatusBadge claim={detail} />}
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
                    <button type="button" className="min-h-11 min-w-11 text-brand-700 hover:underline" aria-label={`แก้ไขโน้ตของ ${note.authorName}`} disabled={noteBusy} aria-busy={noteBusy}
                      onClick={() => { setEditingNote(note.id); setNoteBody(note.body); setNoteError(null); }}>แก้ไข</button>
                    <button type="button" className="min-h-11 min-w-11 text-red-700 hover:underline" aria-label={`ลบโน้ตของ ${note.authorName}`} disabled={noteBusy} aria-busy={noteBusy}
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
        // Its form opens in the step card below, and replaces this line while it is open.
        {...(sendBackAtAccountBox && openCorrectionForm !== 'send-back' && {
          sendBack: { onPress: () => handlers['send-back']?.(), disabled: busyAction !== null || previewLoadingKey !== null },
        })}
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
          {/* Spec §14.6: what a round's approvers approve. What the claim was approved with beside what was answered. */}
          {step.key === 'approval' && <PayoutCorrectionComparison detail={detail} />}
          {needsAttestation && (
            <PayoutAttestationCheck checked={attested} disabled={busyAction !== null} payoutKind={detail.payout?.payoutKind}
              onChange={(checked) => setAttestedVersion(checked ? detail.payout?.version ?? null : null)} />
          )}
          {cardActions.length > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{cardActions.map(actionButton)}</div>
          )}
          {payOpen && step.actions.includes('pay') && (
            <div className="border-t border-gray-100 pt-3">
              <PaymentForm companyId={companyId} request={detail} onCancel={() => setPayOpen(false)} onDone={() => void afterPayment()}
                // A file already on the claim is opened before it is chosen as the slip (the pay queue's dialog uses the same handler).
                onOpenFile={(choice) => void openSlipChoice(detail.id, choice)} />
            </div>
          )}
          {/* The two forms of a correction round open here too, inside the step card and never in a dialog. */}
          {openCorrectionForm === 'send-back' && (
            <div className="border-t border-gray-100 pt-3">
              <PayoutCorrectionRequestForm companyId={companyId} detail={detail} onCancel={() => setCorrectionForm(null)}
                onConflict={() => afterCorrectionConflict('send-back')}
                // Said of what the claim held when it was sent back: the claim on this page, before the answer replaces it.
                onDone={(answered) => void afterCorrection(answered, payoutRoundTexts(detail).sentBackToast)} />
            </div>
          )}
          {openCorrectionForm === 'correct-payout' && (
            <div className="border-t border-gray-100 pt-3">
              <PayoutCorrectionAccountForm companyId={companyId} detail={detail} userId={userId} canEditEmployees={permissions.includes('access.employee.update')}
                onCancel={() => setCorrectionForm(null)} onConflict={(claimChanged) => afterCorrectionConflict('correct-payout', claimChanged)}
                // A claim nobody has to approve is ready for payment in the same call (spec §14.5).
                // Otherwise it waits for its approvers, who approve what was answered: said by the answer the API returned.
                onDone={(answered) => void afterCorrection(answered, answered?.status === 'READY_FOR_PAYMENT'
                  ? `${PAYOUT_CORRECTION_SAVE_LABEL}แล้ว ใบกลับไปรอจ่ายเงินคืน`
                  : `${PAYOUT_CORRECTION_SAVE_LABEL}แล้ว รอผู้อนุมัติอนุมัติ${reimbursementPayoutRoundApproves(answered?.payoutCorrectionAnswer)}`)} />
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
          // The file changes hands for good and a paper-signature declaration may go with it, so it asks first;
          // the yes goes with the call, which the API refuses for a declared copy without it.
          if (!(await confirm({
            title: 'ใช้ไฟล์นี้เป็นสลิปการจ่าย', message: signedCopyMoveConfirmText(copy, payment),
            confirmLabel: 'ย้ายเป็นสลิปการจ่าย', cancelLabel: 'กลับ', variant: 'primary',
          }))) return;
          await act('move-slip', () => attachReimbursementPaymentSlip(companyId, requestId, payment.id, copy.attachmentId, true), 'ย้ายไฟล์ไปเป็นสลิปการจ่ายแล้ว');
        })()}
      />

      {previewModals}
      {missingSignatureFor && <MissingSavedSignatureModal companyId={companyId} requestId={requestId} onClose={() => setMissingSignatureFor(null)} />}
      {rejecting && <RejectDialog
        requestNo={detail.requestNo}
        busy={busyAction === 'reject'}
        error={actionError}
        onClose={() => setRejecting(false)}
        onConfirm={async (reason) => {
          const { ok, latest } = await act('reject', () => rejectReimbursement(companyId, requestId, reason), 'ปฏิเสธคำขอเรียบร้อยแล้ว');
          // Refused because the claim is no longer this viewer's to reject (decided, cancelled or taken back meanwhile):
          // the dialog can do nothing more, so it closes and the step card says what was not done, over the claim as it is now.
          if (ok || !activeJourneyStep(buildJourneySteps(latest, permissions, userId))?.actions.includes('reject')) setRejecting(false);
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
