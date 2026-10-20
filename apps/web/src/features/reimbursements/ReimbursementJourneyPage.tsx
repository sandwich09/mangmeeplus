'use client';
import { formatClaimDetailMoney as formatMoney } from './ReimbursementDetailSections';

// หน้า journey: one claim as 4–5 steps with the current step's actions (spec §5, §6, §12).
// Every action still goes through its own endpoint; this page re-reads the claim afterwards.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReimbursementCancellationCertificate, REIMBURSEMENT_DUPLICATE_RESOLUTION_SAVED, EXPENSE_VOID_REASON_MIN_LENGTH, REIMBURSEMENT_PAYOUT_HOLDER_WORDS as HOLDER_WORDS, reimbursementPayoutRoundApproves } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { formatThaiDate, formatThaiDateTime } from '@/common/i18n/thai-date';
import { ThemedSteps, type ThemedStepState } from '@/common/components/steps/ThemedSteps';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { useConfirm } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { Button } from '@/common/components/button/Button';
import { reimbursementIncurredDateError, todayCivilDate } from '@watchdog-bms/contracts';
import { focusExpenseField } from '../expenses/expense-focus.logic';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { ErrorBanner, btnClass, ghostClass, inputClass } from '../expenses/ExpensesUi';
import {
  addReimbursementInternalNote, approveReimbursement, attachReimbursementPaymentSlip, cancelReimbursement, deleteReimbursementDraft, deleteReimbursementInternalNote,
  editReimbursementInternalNote, financeReviewReimbursement, getReimbursement, rejectReimbursement,
  reopenReimbursement, resumeReimbursement, setLineReceipt, signReimbursementClaimForm, submitReimbursement, uploadReimbursementPaymentSlip, uploadSignedClaimFormCopy,
  voidReimbursementPayment, withdrawReimbursementCancellation,
} from './reimbursements.api';
import { POLICY_TAB_LABEL, CLAIM_SIGN_LABEL, claimWaitingText, claimSignAction, reimbursementSubmitReadiness, type ClaimSignatureRole } from './reimbursements.model';
import {
  activeJourneyStep, claimHubQuery, approvalComparable, approverNotReadyHelp, buildJourneySteps, diffApprovalFields, duplicateCanBeCleared, duplicateNoticeForViewer,  paymentVoidedMessage, errorText, isMissingSavedSignatureError,
  isStaleApprovalError, opensPaymentFormOnArrival, signedCopyMoveConfirmText, type JourneyAction, type JourneyStepState,
} from './reimbursements.logic';
import {
  ClaimDocuments, ClaimHistory, ClaimLines, ClaimPayments, ClaimSummaryCard, MissingSavedSignatureModal, PaymentForm, ReasonDialog, RejectDialog,
  StaleApprovalDialog, StatusBadge, VoidPaymentDialog, financeActionLabel, useClaimDocumentPreview,
} from './ReimbursementDetailSections';
import { ReimbursementCertificateCancelDialog, reimbursementCertificatesCancelledMessage } from './ReimbursementCertificateCancelDialog';
import { BackToClaimsLink, ClaimPayoutCard, PayoutAttestationCheck } from './ReimbursementPayout';
import { PAYOUT_ATTESTATION_REQUIRED, isThirdPartyAcceptanceRefusal, needsThirdPartyAcceptance, payoutApprovalKey, claimNeedsPayoutAttestation, claimPayoutSubmitBlock } from './reimbursement-payout.logic';
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
  submit: 'ส่งอนุมัติ', edit: 'แก้ไขใบเบิก', cancel: 'ยกเลิกใบเบิกนี้', reopen: 'แก้ไขใบเบิก',
  'resume-cancel': 'ทำต่อเพื่อยกเลิก', 'withdraw-cancel': 'ถอนการยกเลิก',
  approve: 'อนุมัติ', reject: 'ส่งกลับให้แก้', resume: 'ทำต่อ', 'policy-settings': `ไปที่${POLICY_TAB_LABEL}`,
  'finance-approve': 'อนุมัติจ่าย', 'finance-return': 'ส่งกลับให้แก้ไข', 'finance-block': 'ระงับการจ่าย',
  'resolve-duplicate': 'ปลดรายการซ้ำ', pay: 'จ่ายเงิน', sign: CLAIM_SIGN_LABEL, print: 'พิมพ์ใบเบิก',
  'attach-signed-copy': 'แนบใบเบิกที่เซ็นแล้ว', 'void-payment': 'ยกเลิกรายการจ่ายนี้',
};

/**
 * Actions that are never the step's main button, even when they are the only one left: backing out of the claim,
 * its paper, and the way to the settings. A person who only waits is shown no green button (a requester whose claim
 * was with its approver read one green button, and it took the claim back).
 */
const QUIET_ACTIONS: ReadonlySet<JourneyAction> = new Set<JourneyAction>(['cancel', 'print', 'policy-settings', 'attach-signed-copy', 'void-payment', 'send-back']);

/** The header's one line when the step is the reader's own to take, by the step's first action: said to them, not as a list of names that includes their own. */
const READER_TURN: Partial<Record<JourneyAction, string>> = {
  'finance-approve': 'รอคุณตรวจการเงิน', pay: 'รอคุณบันทึกจ่าย', 'resolve-duplicate': 'รอคุณตรวจรายการที่อาจซ้ำ',
};

/**
 * The clearing of a possible duplicate was taken and the claim is still held: the reason is recorded and the document's
 * own confirmation has not finished. Said as that, in the dialog, with the reason kept (2026-10-13: the page said
 * "บันทึกการตรวจรายการซ้ำแล้ว" over a claim that read exactly as before, and only a second press cleared it).
 */
const DUPLICATE_STILL_HELD = 'ยังตรวจรายการซ้ำไม่สำเร็จ ตรวจเอกสารที่อาจซ้ำแล้วลองอีกครั้ง';

/** An approval that arrived after the claim had moved on, where nothing is left for this viewer to approve. */
const STALE_APPROVAL_NOTHING_TO_APPROVE = 'ยังไม่ได้อนุมัติ เพราะมีผู้ทำรายการกับใบนี้ไปก่อนแล้ว หน้านี้แสดงสถานะล่าสุดของใบ';

type ReasonAction = 'cancel' | 'resume-cancel' | 'finance-return' | 'finance-block' | 'resolve-duplicate';
const REASON_DIALOGS: Record<ReasonAction, { title: string; description: string; confirmLabel: string; closeLabel?: string; reasonLabel?: string; success: string; danger?: boolean; minLength?: number }> = {
  cancel: {
    // The button that backs out is named for what it leaves undone: never a second "ยกเลิก" beside the one that cancels.
    title: 'ยกเลิกใบเบิก', confirmLabel: 'ยกเลิกใบเบิก', closeLabel: 'ไม่ยกเลิก', success: 'ยกเลิกใบเบิกแล้ว', danger: true,
    description: 'ยกเลิกแล้วนำกลับมาใช้ไม่ได้',
    // The reason also voids the claim's expense records, which take no shorter one: the API refuses it too.
    minLength: EXPENSE_VOID_REASON_MIN_LENGTH,
  },
  // A cancellation whose stored reason is what blocks it (audit B3): the same cancel call, with the corrected reason.
  'resume-cancel': {
    // Closing this one takes nothing back (the cancellation stays started), so its safe button is "ปิด".
    title: 'ยกเลิกใบเบิกต่อ', confirmLabel: 'ยกเลิกใบเบิก', success: 'ยกเลิกใบเบิกแล้ว', danger: true,
    description: 'เหตุผลเดิมสั้นเกินไป พิมพ์เหตุผลที่ยกเลิกอีกครั้ง ยกเลิกแล้วนำกลับมาใช้ไม่ได้',
    minLength: EXPENSE_VOID_REASON_MIN_LENGTH,
  },
  'finance-return': {
    title: 'ส่งกลับให้แก้ไข', confirmLabel: 'ส่งกลับให้แก้ไข', reasonLabel: 'สิ่งที่ต้องแก้ไข (ผู้เบิกจะเห็น)', success: 'ส่งใบเบิกกลับให้แก้ไขแล้ว',
    description: 'ใบเบิกจะกลับเป็นร่าง และต้องอนุมัติใหม่',
  },
  'finance-block': {
    title: 'ระงับการจ่าย', confirmLabel: 'ระงับการจ่าย', success: 'ระงับการจ่ายแล้ว', danger: true,
    description: 'ใบเบิกจะค้างที่ขั้นตรวจการเงิน จนกว่าจะอนุมัติจ่ายหรือส่งกลับให้แก้ไข',
  },
  'resolve-duplicate': {
    title: 'ปลดรายการซ้ำ', confirmLabel: 'ยืนยันว่าไม่ซ้ำ', success: REIMBURSEMENT_DUPLICATE_RESOLUTION_SAVED,
    // The step note behind the dialog already says what to check; the dialog says only what the press records.
    description: 'ระบบบันทึกชื่อคุณและเหตุผลนี้',
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
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const hubHref = `/companies/${companyId}/reimbursements`;
  const [detail, setDetail] = useState<any | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const returnQuery = claimHubQuery(searchParams?.get('tab') ?? null, searchParams?.get('filter') ?? null);
  const back = <BackToClaimsLink href={`${hubHref}${returnQuery}`} />;
  const [actionError, setActionError] = useState<string | null>(null);
  const linesBoxRef = useRef<HTMLDivElement>(null);
  const [submitFailure, setSubmitFailure] = useState<string | null>(null);
  useEffect(() => {
    try {
      const key = `claim-submit:${requestId}`;
      const message = window.sessionStorage.getItem(key);
      window.sessionStorage.removeItem(key);
      if (message) setSubmitFailure(message);
    } catch { /* A notice must not block reading the saved draft. */ }
  }, [requestId]);
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
  // The note box is the last thing on the page and stays shut until someone wants it, or a note exists.
  const [noteOpen, setNoteOpen] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // "ตรวจบัญชีแล้ว" is given for one account version; a claim sent again with another version unticks it.
  const [attestedVersion, setAttestedVersion] = useState<number | null>(null);
  const [acceptance, setAcceptance] = useState<{ acceptedFor: string | null }>({ acceptedFor: null });
  const payoutTickRef = useRef<HTMLInputElement>(null);
  const [focusAcceptance, setFocusAcceptance] = useState(false);
  // Which form of a correction round is open inside the step card: sending the claim back, or giving its account.
  const [correctionForm, setCorrectionForm] = useState<'send-back' | 'correct-payout' | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  // The box that shows where the money goes. Whoever arrives to record a payment is shown it first: the transfer is
  // made into that account before anything is typed into the form under it.
  const payoutBoxRef = useRef<HTMLDivElement>(null);
  const accountFirst = useRef(false);
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
    if (!(await confirm({ title: 'ลบโน้ตภายใน', message: 'ลบโน้ตนี้ออกจากใบเบิก', confirmLabel: 'ลบโน้ต', cancelLabel: 'ไม่ลบ', variant: 'danger' }))) return;
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
          // The step card holding the form takes focus, as it does after an action; what comes into view is the account
          // box above it, with the form right under it (the page used to scroll past the account to transfer into).
          accountFirst.current = true;
          setFocusTick((tick) => tick + 1);
        }
        payRequested.current = false;
      })
      .catch((e) => { if (active) setLoadError(e); });
    return () => { active = false; };
  }, [companyId, requestId, reloadKey, permissions, userId]);

  // The card of the step the claim moved to takes focus (and scrolls into view) after an action.
  useEffect(() => {
    if (!focusTick) return;
    if (!accountFirst.current) { cardRef.current?.focus(); return; }
    accountFirst.current = false;
    cardRef.current?.focus({ preventScroll: true });
    // A claim whose account box is not drawn has nothing above the form to show first.
    (payoutBoxRef.current?.childElementCount ? payoutBoxRef.current : cardRef.current)?.scrollIntoView({ block: 'start' });
  }, [focusTick]);
  useEffect(() => {
    if (focusAcceptance && detail) { payoutTickRef.current?.focus(); setFocusAcceptance(false); }
  }, [focusAcceptance, detail]);


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
  // `success` as a function reads the claim after the action; it answers null where there is nothing to call done yet.
  const act = async (key: string, fn: () => Promise<any>, success: string | ((latest: any, answer: any) => string | null), handled?: (e: unknown) => boolean) => {
    const before = signature(detail);
    setBusyAction(key); setActionError(null);
    let ok = false;
    let dialogOpened = false;
    let latest: any = null;
    let answer: any;
    try {
      const result = await fn();
      answer = result;
      if (Array.isArray(result?.lines)) latest = result;
      ok = true;
      // The claim moved on: a form of the correction round left open is for the claim as it was. Without this, a
      // send-back form opened beside "อนุมัติ" was open again at the pay step the approval led to.
      setCorrectionForm(null);
      if (typeof success === 'string') toast.success(success);
    } catch (e) {
      dialogOpened = handled?.(e) ?? false;
      if (!dialogOpened) setActionError(errorText(e));
    }
    try { latest = await getReimbursement(companyId, requestId); } catch { /* keep what is on screen */ }
    const shown = latest ?? detail;
    const done = ok && typeof success === 'function' ? success(shown, answer) : null;
    if (done) toast.success(done);
    if (latest) setDetail(latest);
    setBusyAction(null);
    if ((!ok && !dialogOpened) || (ok && ['receipt', 'signed-copy', 'attach-slip', 'sign'].includes(key)) || signature(shown) !== before) setFocusTick((tick) => tick + 1);
    return { ok, latest: shown };
  };

  const approve = async (review?: { detail: any }) => {
    const before = detail;
    const target = review?.detail ?? detail;
    // The server refuses a transfer claim without the attestation of its current account version.
    const verified = claimNeedsPayoutAttestation(target) ? attestedVersion : null;
    if (claimNeedsPayoutAttestation(target) && (verified !== target.payout?.version || (needsThirdPartyAcceptance(target) && acceptance.acceptedFor !== payoutApprovalKey(target)))) {
      setStaleReview(null);
      setActionError(needsThirdPartyAcceptance(target) ? HOLDER_WORDS.thirdPartyAcceptanceRequired : PAYOUT_ATTESTATION_REQUIRED);
      setFocusAcceptance(true);
      return;
    }
    let stale = false;
    let acceptanceRefused = false;
    const { ok, latest } = await act(
      'approve',
      () => approveReimbursement(companyId, requestId, undefined, target.approvalSnapshotHash, verified ?? undefined, needsThirdPartyAcceptance(target) ? true : undefined),
      // In a payout round the same call approves what was answered alone, and the claim is back at its pay step: said of
      // that thing, a new account, the account the claim had, a first one, or cash.
      target.payoutCorrectionPhase ? (latest) => `อนุมัติ${reimbursementPayoutRoundApproves(target.payoutCorrectionAnswer)}แล้ว ${latest?.duplicateReasons?.includes('EXPENSE_CONFIRMED_DUPLICATE') ? duplicateNoticeForViewer(latest, permissions, userId) : 'ใบกลับไปรอจ่ายเงินคืน'}` : 'อนุมัติใบเบิกแล้ว',
      (e) => { acceptanceRefused = isThirdPartyAcceptanceRefusal(e); stale = !review && isStaleApprovalError(e); return stale; },
    );
    if (acceptanceRefused) {
      setAttestedVersion(null); setAcceptance({ acceptedFor: null }); setStaleReview(null); setFocusAcceptance(true);
      return;
    }
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
    if (!snapshotHash) { setActionError('ไม่พบข้อมูลล่าสุดของใบเบิก เปิดใบเบิกนี้ใหม่'); return; }
    void act('sign', async () => { for (const role of roles) await signReimbursementClaimForm(companyId, requestId, { role, snapshotHash }); },
      'เซ็นใบเบิกแล้ว',
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
  const afterCorrection = async (answered: any, success: string | ((latest: any) => string)) => {
    setCorrectionForm(null); setActionError(null);
    if (typeof success === 'string') toast.success(success);
    let latest = Array.isArray(answered?.lines) ? answered : null;
    try { latest = await getReimbursement(companyId, requestId); } catch { /* keep what the call answered */ }
    if (typeof success === 'function') toast.success(success(latest ?? answered));
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
      <MangmeePage back={back} title="ใบเบิก">
        <MangmeeCard className="p-6">
          {!loadError ? <LoadingState label="กำลังเปิดใบเบิก..." />
            : status === 403 ? <ForbiddenState />
              : status === 404 ? (
                <EmptyState
                  title="ไม่พบใบเบิกนี้"
                  description="ใบเบิกอาจถูกลบ หรือไม่ได้อยู่ในร้านนี้"
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
  const receiptDateInvalid = (detail.lines ?? []).some((line: any) => reimbursementIncurredDateError(line.incurredDate, todayCivilDate()));
  const payoutBlock = claimPayoutSubmitBlock(detail);
  // One reason at a time: the receipt rule first, then the receiving method.
  const readiness = receiptReadiness.blocked || !payoutBlock ? receiptReadiness : { blocked: true, message: payoutBlock };
  const needsAttestation = Boolean(step?.actions.includes('approve')) && claimNeedsPayoutAttestation(detail);
  const attested = needsAttestation && attestedVersion === detail.payout?.version && (!needsThirdPartyAcceptance(detail) || acceptance.acceptedFor === payoutApprovalKey(detail));
  const attestationRequired = needsThirdPartyAcceptance(detail) ? HOLDER_WORDS.thirdPartyAcceptanceRequired : PAYOUT_ATTESTATION_REQUIRED;
  const staleReviewNeedsAttestation = !!staleReview && claimNeedsPayoutAttestation(staleReview.detail)
    && (attestedVersion !== staleReview.detail.payout?.version || (needsThirdPartyAcceptance(staleReview.detail) && acceptance.acceptedFor !== payoutApprovalKey(staleReview.detail)));
  // The server's own answer to "would this claim's payment be refused for a duplicate": the fact the pay-queue row
  // marks (`hasDuplicateBlocker`). The finance approval clears the block exactly when there is one, as the queue's does.
  const duplicateBlocks = duplicateCanBeCleared(detail);
  const duplicateResolutionBlocked = duplicateBlocks && !permissions.includes('reimbursement.duplicate.resolve');
  const recordedPayment = (detail.payments ?? []).filter((row: any) => row.status === 'RECORDED').at(-1);
  const neverSentDraft = detail.status === 'DRAFT' && !detail.requestNo && !detail.submittedAt && !detail.approvalSteps?.length;
  const handlers: Partial<Record<JourneyAction, () => void>> = {
    // No approver at all: the answer names who fixes it and, for a policy manager, links there.
    // The token names the account shown in the card above: the server sends the claim with that one or refuses.
    submit: () => {
      if (readiness.blocked) {
        setSubmitAttempted(true);
        requestAnimationFrame(() => {
          const target = receiptDateInvalid ? cardRef.current : receiptReadiness.blocked
            ? Array.from(linesBoxRef.current?.querySelectorAll<HTMLElement>('[data-claim-missing-receipt]') ?? []).find(field => field.getClientRects().length > 0)
            : payoutBoxRef.current;
          focusExpenseField(target ?? cardRef.current);
        });
        return;
      }
      setApproverHelp(null); void act('submit', () => submitReimbursement(companyId, requestId, detail.payout?.submitToken), 'ส่งอนุมัติแล้ว',
      (e) => { const help = approverNotReadyHelp(e, permissions); setApproverHelp(help); return help !== null; }); },
    cancel: () => { void (async () => {
      setActionError(null);
      if (!neverSentDraft) { setReasonAction('cancel'); return; }
      if (!(await confirm({ title: 'ลบร่างใบเบิก', message: `${detail.reason} · ${formatMoney(detail.amount, detail.currency)}`, confirmLabel: 'ลบร่าง', cancelLabel: 'ไม่ลบ', variant: 'danger' }))) return;
      setBusyAction('cancel');
      try { await deleteReimbursementDraft(companyId, requestId); toast.success('ลบร่างแล้ว'); router.push(`${hubHref}${returnQuery}`); }
      catch (error) { setActionError(errorText(error)); }
      finally { setBusyAction(null); }
    })(); },
    // The reason on record stays; only a stored reason the system cannot cancel with is asked for again.
    'resume-cancel': () => {
      setActionError(null);
      if (['reason_too_short', 'certificate_attestation_required'].includes(detail.pendingCancellation?.blocker?.code) || detail.certificateCancelBlocker) setReasonAction('resume-cancel');
      else void act('resume-cancel', () => cancelReimbursement(companyId, requestId), (_, answer) => reimbursementCertificatesCancelledMessage(answer?.cancelledCertificates ?? detail.certificates ?? []));
    },
    'withdraw-cancel': () => void (async () => {
      if (!(await confirm({
        title: 'ถอนการยกเลิก',
        message: 'ใบเบิกจะกลับไปเดินต่อตามขั้นตอนเดิม เหมือนยังไม่เคยกดยกเลิก',
        confirmLabel: 'ถอนการยกเลิก',
        cancelLabel: 'ปิด',
        variant: 'primary',
      }))) return;
      await act('withdraw-cancel', () => withdrawReimbursementCancellation(companyId, requestId), 'ถอนการยกเลิกแล้ว ใบเบิกกลับไปเดินต่อตามเดิม');
    })(),
    reopen: () => void (async () => {
      // Withdrawing takes the claim off the approver's desk, so it asks first; reopening a refusal does not.
      if (detail.status === 'PENDING_APPROVAL' && !(await confirm({
        title: 'แก้ไขใบเบิกที่ส่งแล้ว',
        message: 'ผู้อนุมัติจะไม่เห็นใบนี้จนกว่าคุณจะส่งอีกครั้ง ถ้าเซ็นหรือแนบใบเบิกที่เซ็นแล้วไว้ ต้องทำใหม่หลังส่ง',
        confirmLabel: 'แก้ไขใบเบิก',
        cancelLabel: 'ปิด',
        variant: 'primary',
      }))) return;
      // The button says "แก้ไข": once the claim is a draft again its form opens, with no second press on this page.
      const { ok } = await act('reopen', () => reopenReimbursement(companyId, requestId), 'เปิดใบเบิกกลับเป็นร่างแล้ว แก้ไขแล้วส่งอนุมัติอีกครั้ง');
      if (ok) router.push(`${hubHref}/${requestId}/edit${returnQuery}`);
    })(),
    approve: () => void approve(),
    reject: () => { setActionError(null); setRejecting(true); },
    // Audit B4: the decision is on record; this has the system carry it out now. Nothing is approved or attested again.
    resume: () => void act('resume', () => resumeReimbursement(companyId, requestId), 'ทำขั้นตอนที่ค้างต่อแล้ว'),
    'finance-approve': () => void act('finance-approve', () => financeReviewReimbursement(companyId, requestId, {
      decision: 'APPROVED_FOR_PAYMENT',
      resolveDuplicate: duplicateBlocks,
      duplicateResolutionReason: duplicateBlocks ? 'ตรวจสอบแล้วไม่ซ้ำ' : undefined,
    }), detail.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ทำขั้นตอนอนุมัติจ่ายต่อแล้ว' : 'อนุมัติจ่ายแล้ว'),
    'finance-return': () => { setActionError(null); setReasonAction('finance-return'); },
    'finance-block': () => { setActionError(null); setReasonAction('finance-block'); },
    'resolve-duplicate': () => { setActionError(null); setReasonAction('resolve-duplicate'); },
    pay: () => { setCorrectionForm(null); setPayOpen(true); },
    // One form at a time in the step card: sending the claim back closes a payment form left open.
    'send-back': () => { setActionError(null); setPayOpen(false); setCorrectionForm('send-back'); },
    'correct-payout': () => { setActionError(null); setCorrectionForm('correct-payout'); },
    print: () => void openClaimForm(detail),
    // One tap signs every block this viewer may sign: the step card's own button, not a jump to a second one below.
    sign: () => { const signing = claimSignAction(detail, userId); if (signing) sign(signing.roles); },
    'void-payment': () => { setActionError(null); setVoidingPayment(recordedPayment); },
  };

  const actionButton = (action: JourneyAction) => {
    // The step's first action is its primary one. While a form is open in the card the form's own save is, so no
    // button left beside it reads as the main thing to press ("ยกเลิกใบเบิก" did, above an open form).
    const className = action === primaryAction ? btnClass : ghostClass;
    const label = action === 'finance-approve' ? financeActionLabel(detail)
          // From the step a round waits on, sending back is how its approvers do not take what was answered: said as
          // that, of an account to correct again or of cash to choose again.
      : action === 'send-back' ? payoutCorrectionSendBackTitle(detail)
        : action === 'correct-payout' ? correctPayoutLabel
          : action === 'sign' ? claimSignAction(detail, userId)?.label ?? CLAIM_SIGN_LABEL
            : ACTION_LABELS[action];
    if (action === 'edit') return <Link key={action} className={className} href={`${hubHref}/${detail.id}/edit${returnQuery}`}>{label}</Link>;
    if (action === 'policy-settings') return <Link key={action} className={className} href={`${hubHref}?tab=policy`}>{label}</Link>;
    const working = busyAction === action || (action === 'print' && previewLoadingKey !== null);
    // "อนุมัติ" is never greyed out for a missing tick: pressed without it, the tick says what is missing and takes focus.
    const blockedReason = action === 'submit' && readiness.blocked ? readiness.message
      : action === 'finance-approve' && duplicateResolutionBlocked ? 'รายการนี้อาจซ้ำ ต้องให้ผู้มีสิทธิ์แก้รายการซ้ำตรวจสอบ' : undefined;
    return (
      <button key={action} type="button" className={className} title={action === 'submit' ? undefined : blockedReason}
        aria-describedby={action === 'submit' && blockedReason ? 'claim-submit-readiness' : action === 'approve' && needsAttestation && !attested ? 'claim-payout-attestation' : undefined}
        disabled={busyAction !== null || previewLoadingKey !== null || (action !== 'submit' && Boolean(blockedReason))} aria-busy={working}
        onClick={handlers[action]}>
        {label}
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
  const formOpen = openCorrectionForm !== null || (payOpen && Boolean(step?.actions.includes('pay')));
  // What the step card offers as buttons. While a form is open in the card it offers none: the form's own two buttons
  // are the only ones there (with the payment form open, "ยกเลิกใบเบิก" sat where "บันทึกจ่าย" had just been pressed).
  // Document actions live in its two options; payments are taken back from their own menu.
  const documentInStep = step?.key === 'document' && !detail.pendingCancellation && step.state !== 'ended';
  const cardActions = formOpen ? [] : (step?.actions ?? []).filter((action) => action !== 'cancel' && action !== 'attach-signed-copy' && action !== 'void-payment'
    && !(documentInStep && (action === 'print' || action === 'sign')) && !(action === 'reject' && detail.requesterUserId === userId)
    && !(action === 'send-back' && sendBackAtAccountBox));
  // The same press as the button it replaces: offered where the step still lists it and no form is open in the card.
  const canCancelClaim = !formOpen && Boolean(step?.actions.includes('cancel'));
  // Giving the account again while it already waits for its approvers is allowed, and is not what the claim waits
  // for: it starts the approvers' wait over, so it is offered without the look of the thing to do next.
  const givingAgain = step?.actions[0] === 'correct-payout' && detail.payoutCorrectionPhase === 'AWAITING_APPROVAL';
  // The first action still shown as a button, when it is something to do: a viewer who can only send the claim back,
  // print it or take their own claim back from its approver has no main thing to press here.
  const first = cardActions[0];
  // Answering a send-back for the requester is something a reviewer may do, not what the claim waits for from them:
  // it is the requester's to answer, so only the requester reads it as the thing to press.
  const answeringForRequester = first === 'correct-payout' && detail.requesterUserId !== userId;
  const primaryAction = formOpen || givingAgain || answeringForRequester || first === undefined || first !== step?.actions[0] || QUIET_ACTIONS.has(first)
    || (first === 'reopen' && detail.status === 'PENDING_APPROVAL') ? undefined : first;
  // Whose turn it is, said to the reader when it is theirs; otherwise the desk the claim is on, as the lists say it.
  const isRequester = detail.requesterUserId === userId;
  const stepFirst = step?.state === 'ended' ? undefined : step?.actions[0];
  const readerTurn = stepFirst === undefined ? undefined
    : stepFirst === 'submit' || stepFirst === 'edit' ? (isRequester ? 'รอคุณส่งอนุมัติ' : undefined)
      : stepFirst === 'reopen' ? (detail.status === 'REJECTED' ? 'รอคุณแก้ไขแล้วส่งอนุมัติอีกครั้ง' : undefined)
        : stepFirst === 'correct-payout' ? (isRequester && detail.payoutCorrectionPhase === 'AWAITING_REQUESTER' ? `รอคุณ${correctPayoutLabel}` : undefined)
          : stepFirst === 'approve' ? claimWaitingText(detail) : READER_TURN[stepFirst];
  const reasonDialog = reasonAction ? REASON_DIALOGS[reasonAction] : null;
  // A cancellation says what is cancelled: the claim's number (a draft has none) and its amount.
  const reasonDialogTitle = !reasonDialog ? '' : reasonAction === 'cancel'
    ? `${reasonDialog.title} ${detail?.requestNo ?? '(ร่าง)'} ${formatMoney(detail?.amount, detail?.currency)}`
    : `${reasonDialog.title} ${detail?.requestNo ?? ''}`.trim();
  const cancellationCertificates: ReimbursementCancellationCertificate[] = detail.certificates ?? [];
  const certificateCancellation = (reasonAction === 'cancel' || reasonAction === 'resume-cancel') && cancellationCertificates.length > 0;

  const noteCount = (detail.internalNotes ?? []).length;
  const sectionProps = {
    detail, userId, permissions, busy: busyAction !== null || previewLoadingKey !== null,
    onOpenAttachment: (attachmentId: string, fileName: string) => void openAttachment(detail.id, attachmentId, fileName),
  };

  const payoutInStep = step?.key === 'items' || step?.key === 'payment';
  const payoutCard = !detail.hasVoidedProjections && (
    <div ref={payoutBoxRef} className="scroll-mt-[calc(var(--app-header-h)+1rem)] empty:hidden">
      <ClaimPayoutCard plain={payoutInStep}
      companyId={companyId}
      detail={detail}
      userId={userId}
      payoutAccountHref={`${hubHref}/payout-account`}
      // The same condition as the withdraw button of the approval step below.
      canWithdraw={detail.status === 'PENDING_APPROVAL' && Boolean(step?.actions.includes('reopen'))}
      // At the payment step, for whoever is offered to record the payment, the card is the account to transfer into.
      payStep={step?.key === 'payment' && step.actions.includes('pay')}
      {...(step?.actions.includes('edit') && { editHref: `${hubHref}/${detail.id}/edit${returnQuery}` })}
      // Its form opens in the step card below, and replaces this line while it is open.
      {...(sendBackAtAccountBox && openCorrectionForm !== 'send-back' && {
        sendBack: { onPress: () => handlers['send-back']?.(), disabled: busyAction !== null || previewLoadingKey !== null },
      })}
      />
    </div>
  );
  const documentSection = (mode: 'step' | 'records') => (
    <ClaimDocuments {...sectionProps}
      mode={mode}
      {...(mode === 'step' && step?.actions.includes('print') && { print: { onPress: () => handlers.print?.(), working: previewLoadingKey !== null } })}
      onSign={sign}
      onUploadSignedCopy={(file, confirmedRequestNo) => void act('signed-copy',
        () => uploadSignedClaimFormCopy(companyId, requestId, file, detail.branchId, confirmedRequestNo),
        confirmedRequestNo ? 'แนบใบเบิกที่เซ็นครบแล้ว' : 'แนบไฟล์แล้ว')}
      onUseSignedCopyAsSlip={(copy, payment) => void (async () => {
        // The file changes hands for good and a paper-signature declaration may go with it, so it asks first;
        // the yes goes with the call, which the API refuses for a declared copy without it.
        if (!(await confirm({
          title: 'ใช้ไฟล์นี้เป็นหลักฐานการจ่าย', message: signedCopyMoveConfirmText(copy, payment),
          confirmLabel: 'ย้ายเป็นหลักฐานการจ่าย', cancelLabel: 'ปิด', variant: 'primary',
        }))) return;
        await act('move-slip', () => attachReimbursementPaymentSlip(companyId, requestId, payment.id, copy.attachmentId, true), 'ย้ายไฟล์ไปเป็นหลักฐานการจ่ายแล้ว');
      })()} />
  );

  return (
    <MangmeePage
      // A display name with no spaces (an email used as a name) must wrap at 390 px, not push the page wide.
      className="mangmee-flat [overflow-wrap:anywhere]"
      back={back}
      title={detail.requestNo ? <>ใบเบิก <span className="mangmee-unit">{detail.requestNo}</span></> : 'ใบเบิก (ร่าง)'}
      description={<span className="flex flex-wrap items-center gap-2"><StatusBadge claim={detail} /><span>{readerTurn ?? claimWaitingText(detail)}</span></span>}
    >
      <MangmeeCard className="p-4">
        <ThemedSteps
          aria-label="ขั้นตอนของใบเบิก"
          steps={steps.map((row) => ({
            key: row.key,
            label: row.label,
            state: STEPPER_STATE[row.state],
            ...(row.state === 'done' && row.note ? { description: row.note } : {}),
          }))}
        />
      </MangmeeCard>

      {/* Current work first, then the claim facts and history, at every screen width. */}
      <div className="space-y-5">
          {step && (
            <section ref={cardRef} tabIndex={-1} aria-labelledby="journey-step-title"
              className="mangmee-card space-y-3 p-4 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:p-5">
              <div>
                <p className="text-xs font-bold text-brand-700">{step.state === 'ended' ? 'ใบเบิกนี้ปิดแล้ว' : `ขั้นตอน ${stepIndex + 1} จาก ${steps.length}`}</p>
                <h2 id="journey-step-title" className="mt-1 text-lg font-bold text-gray-900">{step.label}</h2>
                {step.note && <p className="mt-1 text-sm text-gray-600">{step.note}</p>}
                {needsThirdPartyAcceptance(detail) && ['DRAFT', 'PENDING_APPROVAL'].includes(detail.status) && <p className="mt-1 text-sm text-amber-800">{HOLDER_WORDS.thirdPartyApprovalNotice}</p>}
              </div>
              {step.actions.includes('submit') && readiness.blocked && readiness.message && <div id="claim-submit-readiness"><ErrorBanner message={readiness.message} /></div>}
              {/* Spec §14.6: what a round's approvers approve. What the claim was approved with beside what was answered. */}
              {step.key === 'approval' && <PayoutCorrectionComparison detail={detail} />}
              {needsAttestation && (
                <div id="claim-payout-attestation" className="space-y-1">
                  <PayoutAttestationCheck checked={attested} disabled={busyAction !== null} payoutKind={detail.payout?.payoutKind} holderType={detail.payout?.holderType} forSelf={detail.requesterUserId === userId} inputRef={payoutTickRef}
                    onChange={(checked) => { setActionError(null); setAttestedVersion(checked ? detail.payout?.version ?? null : null); setAcceptance({ acceptedFor: checked ? payoutApprovalKey(detail) : null }); }} />
                  {/* Said only once "อนุมัติ" was pressed without the tick: before that it read as an error nobody had made. */}
                  {!attested && actionError === attestationRequired && <p role="alert" className="text-sm font-medium text-error-700">{attestationRequired}</p>}
                </div>
              )}
              {step.key === 'items' && (
                <div ref={linesBoxRef}>
                  <ClaimLines {...sectionProps} missingReceiptsOnly receiptError={submitAttempted && receiptReadiness.blocked && !receiptDateInvalid ? receiptReadiness.message : undefined}
                    onLineReceipt={(lineNo, file) => void act('receipt', () => setLineReceipt(companyId, requestId, detail.lines ?? [], lineNo, file, detail.branchId), 'แนบใบเสร็จแล้ว')} />
                </div>
              )}
              {payoutInStep && payoutCard}
              {documentInStep && documentSection('step')}
              {detail.status === 'DRAFT' && submitFailure && <ErrorBanner message={`บันทึกร่างแล้ว แต่ยังส่งไม่ได้: ${submitFailure}`} />}
              {(cardActions.length > 0 || canCancelClaim) && (
                // Back-out first, the step's own action last: the group puts the acting button at the right, or on top when stacked.
                <ActionGroup>
                  {canCancelClaim && <Button type="button" variant="danger" loading={busyAction !== null || previewLoadingKey !== null} onClick={handlers.cancel}>
                    {neverSentDraft ? 'ลบร่าง' : ACTION_LABELS.cancel}
                  </Button>}
                  {[...cardActions].reverse().map(actionButton)}
                </ActionGroup>
              )}
              {payOpen && step.actions.includes('pay') && (
                <div className="border-t border-gray-100 pt-3">
                  <PaymentForm companyId={companyId} request={detail} onCancel={() => setPayOpen(false)} onDone={() => void afterPayment()}
                    onClaimChanged={(latest) => { setPayOpen(false); setDetail(latest); setFocusTick(tick => tick + 1); }}
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
                    onDone={(answered) => void afterCorrection(answered, (latest) => `${PAYOUT_CORRECTION_SAVE_LABEL}แล้ว ${latest?.duplicateReasons?.includes('EXPENSE_CONFIRMED_DUPLICATE')
                      ? duplicateNoticeForViewer(latest, permissions, userId)
                      : latest?.status === 'READY_FOR_PAYMENT' ? 'ใบกลับไปรอจ่ายเงินคืน'
                        : `รอผู้อนุมัติอนุมัติ${reimbursementPayoutRoundApproves(latest?.payoutCorrectionAnswer)}`}`)} />
                </div>
              )}
              {approverHelp && step.actions.includes('submit') && (
                <div className="space-y-2">
                  <ErrorBanner message={approverHelp.text} focus />
                  {approverHelp.policyLink && (
                    <ActionGroup align="start"><Link className={ghostClass} href={`${hubHref}?tab=policy`}>{ACTION_LABELS['policy-settings']}</Link></ActionGroup>
                  )}
                </div>
              )}
              {actionError && actionError !== attestationRequired && !certificateCancellation && !(step.actions.includes('submit') && readiness.blocked && actionError === readiness.message) && <ErrorBanner message={actionError} />}
            </section>
          )}
        <div className="min-w-0 space-y-5">
          <ClaimSummaryCard detail={detail} />
          {(detail.duplicateCandidates ?? []).some((candidate: any) => ['OPEN', 'OVERRIDDEN', 'DISMISSED'].includes(candidate.status)) && (
            <MangmeeCard className="p-4 sm:p-5">
              <h2 className="mb-3 font-semibold text-gray-900">เอกสารที่อาจซ้ำ</h2>
              <ul className="divide-y divide-gray-100">{detail.duplicateCandidates.filter((candidate: any) => ['OPEN', 'OVERRIDDEN', 'DISMISSED'].includes(candidate.status)).map((candidate: any) => (
                <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    {candidate.status !== 'OPEN' ? <p className="text-sm text-gray-600">ตรวจแล้วว่าไม่ซ้ำกับ {candidate.documentNumber ?? 'เอกสารเดิม'} โดย {candidate.resolvedByName ?? 'ผู้ตรวจรายการซ้ำ'} เมื่อ {candidate.resolvedAt ? formatThaiDateTime(candidate.resolvedAt) : 'ไม่ระบุเวลา'}</p> : <>
                    <p className="font-semibold">{candidate.documentNumber ?? 'เอกสารที่อาจซ้ำ'}</p>
                    <p className="text-sm text-gray-600">{[candidate.requesterOrPayee,
                      candidate.amount ? formatMoney(candidate.amount, candidate.currency) : null,
                      candidate.date ? formatThaiDate(candidate.date) : null].filter(Boolean).join(' · ')}</p>
                    <p className="text-sm text-gray-600">{candidate.reason?.replaceAll('คำขอเบิก', 'ใบเบิก')}</p></>}
                  </div>
                  {candidate.canOpen && (candidate.candidateRequestId || candidate.candidateExpenseId) && <Link className={ghostClass}
                    href={candidate.candidateRequestId ? `${hubHref}/${candidate.candidateRequestId}` : `/companies/${companyId}/expenses/${candidate.candidateExpenseId}`}>เปิด</Link>}
                </li>
              ))}</ul>
            </MangmeeCard>
          )}
          <ClaimLines {...sectionProps} onLineReceipt={(lineNo, file) => void act('receipt', () => setLineReceipt(companyId, requestId, detail.lines ?? [], lineNo, file, detail.branchId), 'แนบใบเสร็จแล้ว')} />
        </div>

        {!payoutInStep && payoutCard}

        <div className="min-w-0 space-y-5">
          {documentSection('records')}
          <ClaimPayments detail={detail} permissions={permissions} busy={sectionProps.busy}
            onRequestVoidPayment={(payment) => { setActionError(null); setVoidingPayment(payment); }}
            onOpenPaymentSlip={(payment, attachmentId, name) => void openPaymentSlip(detail.id, payment.id, attachmentId, name)}
            onAttachPaymentSlip={(payment, file) => void act('attach-slip', async () => attachReimbursementPaymentSlip(
              companyId, requestId, payment.id, await uploadReimbursementPaymentSlip(companyId, requestId, file),
            ), 'แนบหลักฐานการจ่ายแล้ว')} />
          {/* Open once the claim is paid or closed: what is left to read then is what happened. */}
          <ClaimHistory detail={detail} defaultOpen={step?.key === 'document' || step?.state === 'ended'} />

          {noteCount === 0 && !noteOpen ? (
            <ActionGroup align="start">
              <button type="button" className={ghostClass} onClick={() => setNoteOpen(true)}>เพิ่มโน้ตภายใน</button>
            </ActionGroup>
          ) : (
            <MangmeeCard className="space-y-3 p-4 sm:p-5">
              <div>
                <h2 className="text-sm font-bold text-gray-900">โน้ตภายใน</h2>
                <p className="text-sm text-gray-500">เห็นเฉพาะคนที่เปิดใบเบิกนี้ได้ ไม่อยู่ในใบเบิกที่พิมพ์</p>
              </div>
              <ul className="space-y-3">
                {(detail.internalNotes ?? []).map((note: any) => (
                  <li key={note.id} className="rounded-lg border border-gray-200 p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="text-sm text-gray-500">{note.authorName} · {formatThaiDateTime(note.createdAt)}</div>
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
                    {note.updatedAt !== note.createdAt && <p className="mt-1 text-xs text-gray-500">แก้ไขแล้ว {formatThaiDateTime(note.updatedAt)}</p>}
                  </li>
                ))}
              </ul>
              <label htmlFor="reimbursement-internal-note" className="block text-sm font-semibold text-gray-700">
                {editingNote ? 'แก้ไขโน้ต' : 'เพิ่มโน้ต'}
              </label>
              <textarea id="reimbursement-internal-note" className={cx(inputClass, 'min-h-24 w-full resize-y')}
                value={noteBody} onChange={(event) => setNoteBody(event.target.value)} maxLength={2000}
                placeholder="เขียนถึงคนในร้าน" disabled={noteBusy} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-gray-500">{noteBody.length}/2000</span>
                <ActionGroup>
                  {editingNote && <button type="button" className={ghostClass} disabled={noteBusy}
                    onClick={() => { setEditingNote(null); setNoteBody(''); setNoteError(null); }}>ยกเลิก</button>}
                  {/* A note is never the page's main thing to do: its save is a plain button beside the step's green one. */}
                  <button type="button" className={ghostClass} disabled={noteBusy || !noteBody.trim()} aria-busy={noteBusy} onClick={() => void saveNote()}>
                    {editingNote ? 'บันทึกการแก้ไข' : 'เพิ่มโน้ต'}
                  </button>
                </ActionGroup>
              </div>
              {noteError && <ErrorBanner message={noteError} />}
            </MangmeeCard>
          )}

        </div>
      </div>

      {previewModals}
      {missingSignatureFor && <MissingSavedSignatureModal companyId={companyId} requestId={requestId} onClose={() => setMissingSignatureFor(null)} />}
      {rejecting && <RejectDialog
        requestNo={detail.requestNo}
        busy={busyAction === 'reject'}
        error={actionError}
        onClose={() => setRejecting(false)}
        onConfirm={async (reason) => {
          const { ok, latest } = await act('reject', () => rejectReimbursement(companyId, requestId, reason), 'ส่งกลับให้แก้แล้ว');
          // Refused because the claim is no longer this viewer's to reject (decided, cancelled or taken back meanwhile):
          // the dialog can do nothing more, so it closes and the step card says what was not done, over the claim as it is now.
          if (ok || !activeJourneyStep(buildJourneySteps(latest, permissions, userId))?.actions.includes('reject')) setRejecting(false);
        }}
      />}
      {reasonAction && reasonDialog && (certificateCancellation ? <ReimbursementCertificateCancelDialog
        title={reasonDialogTitle}
        certificates={cancellationCertificates} blocker={detail.certificateCancelBlocker}
        continuation={Boolean(detail.pendingCancellation)} attestationRequired={detail.pendingCancellation?.blocker?.code === 'certificate_attestation_required'} initialReason={detail.pendingCancellation?.reason}
        busy={busyAction === reasonAction} error={actionError}
        onClose={() => setReasonAction(null)}
        onConfirm={async (reason, taxFilingAttested) => {
          if ((await act(reasonAction, () => cancelReimbursement(companyId, requestId, reason, taxFilingAttested),
            (_, answer) => reimbursementCertificatesCancelledMessage(answer?.cancelledCertificates ?? cancellationCertificates))).ok) setReasonAction(null);
        }}
      /> : <ReasonDialog
        title={reasonDialogTitle}
        description={reasonDialog.description}
        confirmLabel={reasonDialog.confirmLabel}
        closeLabel={reasonDialog.closeLabel ?? 'ยกเลิก'}
        reasonLabel={reasonDialog.reasonLabel}
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
          if (reasonAction !== 'resolve-duplicate') { if ((await act(reasonAction, request, reasonDialog.success)).ok) setReasonAction(null); return; }
          // Done is said only of a claim that is no longer held. One still held keeps the dialog, with the reason typed
          // and what to do, and never a "saved" over an unchanged page.
          const { ok, latest } = await act(reasonAction, request, (shown) => (duplicateCanBeCleared(shown) ? null : reasonDialog.success));
          if (ok && duplicateCanBeCleared(latest)) setActionError(DUPLICATE_STILL_HELD);
          else if (ok) setReasonAction(null);
        }}
      />)}
      {confirmDialog}
      {voidingPayment && <VoidPaymentDialog
        payment={voidingPayment} claim={detail}
        busy={busyAction === 'void-payment'}
        error={actionError}
        onClose={() => setVoidingPayment(null)}
        onConfirm={async (reason) => {
          if ((await act('void-payment', () => voidReimbursementPayment(companyId, requestId, voidingPayment.id, reason),
            (latest) => paymentVoidedMessage(latest, permissions, userId))).ok) setVoidingPayment(null);
        }}
      />}
      {staleReview && <StaleApprovalDialog
        requestNo={staleReview.detail.requestNo ?? staleReview.before.requestNo}
        beforePayout={staleReview.before.payout} payout={staleReview.detail.payout}
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
