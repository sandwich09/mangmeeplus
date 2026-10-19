'use client';

import { ATTACHMENT_SOURCE_TYPES_LABEL, REIMBURSEMENT_SELF_APPROVED_NOTE, reimbursementDuplicateBlockNotice, isReimbursementClaimApprover } from '@watchdog-bms/contracts';

// The claim detail as sections, shared by the hub drawer and the journey page while both exist
// (the drawer goes in Phase 6). Markup moved from the drawer; test ids are kept on it.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { looksLikeAccountNumber, todayCivilDate, isFuturePaymentDate, PAYMENT_DATE_IN_FUTURE, reimbursementPaymentReferenceField, REIMBURSEMENT_PAYMENT_REFERENCE_TEXT } from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { ChoiceRow } from '@/common/components/field/ChoiceRow';
import { FieldError } from '@/common/components/field/Field';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { MangmeeBadge, MangmeeCard, MetricGrid, cx } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { MoreActions } from '@/common/components/actions/MoreActions';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { Notice } from '@/common/components/notice';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { useToast } from '@/common/components/toast';
import { downloadDocumentAsPdf } from '@/common/files/download-document-pdf';
import { ATTACHMENT_UPLOAD_ACCEPT } from '@/common/files/upload-file.logic';
import { REASON_MAX_LENGTH, sanitizeReasonInput } from '@/common/forms/sanitize';
import { RECEIPT_UPLOAD_ACCEPT } from '../expenses/expense-upload.logic';
import {
  amountText, baht, dateShort, ErrorBanner, InfoBanner, inputClass, btnClass, ghostClass, dangerClass,
} from '../expenses/ExpensesUi';
import { ReimbursementSourceFacts, WholeWords } from './ReimbursementSourceFacts';
import {
  fetchAttachmentPreviewBlob, fetchReimbursementPaymentSlipBlob, previewReimbursementClaimForm, recordReimbursementPayment,
  uploadReimbursementPaymentSlip, getReimbursement,
} from './reimbursements.api';
import {
  PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES,
  FINANCE_REVIEW_LABELS, PAYMENT_METHOD_LABELS, DUPLICATE_STATUS_LABELS,
  APPROVAL_STEP_STATUS_LABELS, CLAIM_SIGNATURE_ROLE_LABELS, CURRENT_DESK_LABELS,
  canUploadSignedCopy, canVoidRecordedPayment, claimHasNoApprover, claimInPayoutCorrection, claimSelfApproved, claimSignAction, claimSignatureSlots, reimbursementOwnActions,
  type ClaimSignatureRole,
  claimStatusBadge, currentDeskText,
} from './reimbursements.model';
import {
  NOTE_HAS_ACCOUNT_NUMBER,
  approvalStepCorrectionNote, attachedFileKindText, buildClaimTimeline, canAttachPaymentSlip, categoryText, chosenPaymentSlipChoice, duplicateNoticeForViewer, errorText, formatMoney as fallbackMoney, paperSignedLine, paymentSlipChoices, paymentSlipCount,
  rowHasFinanceReview, savePaymentForm, signedCopyMisfiledHint, slipTargetPayment, sumLineAmounts, timelineDateText,
  type ApprovalFieldDiff, type PaymentFormSession, type PaymentFormSlip, type PaymentSlipChoice,
} from './reimbursements.logic';
// Which field a refusal of the payment form is about (its own import, apart from the block above).
import { paymentFormProblem, type PaymentFormField } from './reimbursements.logic';
import { payoutHolderLine } from '@watchdog-bms/contracts';
import { DisclosureChevron, PayoutHolderNotice, PayerConfirmationCheck } from './ReimbursementPayout';
import {
  PAID_DIFFERENTLY_LABEL, PAYMENT_NO_CLAIM_ACCOUNT, SIGNED_COPY_BEFORE_CORRECTION_LABEL, paymentDestinationText, paymentFormPayout, requestedPayout,
} from './reimbursement-payout.logic';
// The one wording for a voided payment (its own import, apart from the model block above).
import { PAYMENT_VOIDED_LABEL } from './reimbursements.model';

/**
 * The status badge of a claim, as its list or queue row or as its detail. It takes the whole claim, because the words
 * are not the status alone: a claim the system holds reads "รอระบบปรับสถานะ" (its `currentDesk`), and a claim sent back
 * from its pay step reads what it waits for, by what it holds and what was answered (`claimStatusBadge`).
 */
/** Claim screens use the expense list's baht formatter; other currencies retain their label. */
export function formatClaimMoney(value: unknown, currency = 'THB'): string {
  return currency === 'THB' ? baht(String(value ?? 0)) : fallbackMoney(value, currency);
}
export function formatClaimDetailMoney(value: unknown, currency = 'THB'): string {
  return fallbackMoney(value, currency);
}
const formatMoney = formatClaimDetailMoney;

export function StatusBadge({ claim }: { claim: Parameters<typeof claimStatusBadge>[0] }) {
  const badge = claimStatusBadge(claim);
  return <MangmeeBadge tone={badge.tone}>{badge.label}</MangmeeBadge>;
}
export function PaymentBadge({ status }: { status: string }) {
  return <MangmeeBadge tone={PAYMENT_STATUS_TONES[status] ?? 'slate'}>{PAYMENT_STATUS_LABELS[status] ?? 'ยังไม่ระบุ'}</MangmeeBadge>;
}

/**
 * FINANCE_REVIEW + อนุมัติจ่าย means the decision is already durable and only the expense
 * projections are missing (the saga threw between its two phases). The same finance-decision
 * endpoint resumes it, so the button offers to continue rather than to approve twice.
 */
export const financeActionLabel = (row: { financeReviewStatus?: string }) =>
  (row.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ทำต่อ' : 'อนุมัติจ่าย');

export function RejectDialog({ requestNo, busy, error, onClose, onConfirm }: {
  requestNo?: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = reason.trim();
  // `autoFocus` loses to Modal's own mount effect, which focuses the dialog container.
  // Modal is the child component, so its effect runs first and this one wins.
  useEffect(() => { reasonRef.current?.focus(); }, []);
  return (
    // `dirty`: a reason typed and not sent is not lost to a stray tap or to ✕ without a question.
    <Modal open title={`ส่งกลับให้แก้ ${requestNo ?? ''}`.trim()} size="sm" closeLabel="ยกเลิก" dirty={trimmed !== ''} onClose={onClose}
      footer={(
        <>
          <button type="button" className={ghostClass} onClick={onClose}>ยกเลิก</button>
          <button type="button" className={dangerClass} disabled={busy || !trimmed} aria-busy={Boolean(busy)}
            onClick={() => onConfirm(trimmed)}>ส่งกลับให้แก้</button>
        </>
      )}>
      <div className="space-y-2">
        {error && <ErrorBanner message={error} />}
        <label className={FORM_LABEL} htmlFor="reimbursement-reject-reason">เหตุผล (ผู้เบิกจะเห็น)<span className="text-red-600" aria-hidden="true"> *</span></label>
        <textarea id="reimbursement-reject-reason" ref={reasonRef} aria-required className={cx(inputClass, 'min-h-24 resize-y')} value={reason}
          onChange={e => setReason(sanitizeReasonInput(e.target.value))} maxLength={REASON_MAX_LENGTH}
          placeholder="เช่น ยอดไม่ตรงกับใบเสร็จ" />
        <div className="mangmee-unit text-right text-sm text-gray-500">{reason.length}/{REASON_MAX_LENGTH}</div>
      </div>
    </Modal>
  );
}

export function ReasonDialog({ title, description, confirmLabel, closeLabel = 'ปิด', reasonLabel = 'เหตุผล', busy, error, danger = false, minLength = 1, initialReason = '', onClose, onConfirm }: {
  title: string;
  /** One sentence: what the press does. */
  description: string;
  confirmLabel: string;
  /** The button that backs out, named for what it leaves undone: "ไม่ยกเลิก" beside "ยกเลิกใบเบิก", else "ปิด". Never a second "ยกเลิก". */
  closeLabel?: string;
  /** The name of the one field. */
  reasonLabel?: string;
  busy?: boolean;
  error?: string | null;
  danger?: boolean;
  /** The shortest reason the API takes for this action; the confirm button stays off below it. */
  minLength?: number;
  /** A reason already on record that the person is asked to correct. */
  initialReason?: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(initialReason);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = reason.trim();
  useEffect(() => { reasonRef.current?.focus(); }, []);
  return (
    // `dirty`: a reason typed and not sent is not lost to a stray tap or to ✕ without a question.
    <Modal open title={title} size="sm" closeLabel="ปิด" dirty={trimmed !== initialReason.trim()} onClose={onClose}
      footer={(
        <>
          <button type="button" className={ghostClass} onClick={onClose}>{closeLabel}</button>
          <button type="button" className={danger ? dangerClass : btnClass} disabled={busy || trimmed.length < minLength} aria-busy={Boolean(busy)}
            onClick={() => onConfirm(trimmed)}>{confirmLabel}</button>
        </>
      )}>
      <div className="space-y-2">
        <p className="text-sm text-gray-600">{description}</p>
        {error && <ErrorBanner message={error} />}
        {/* The button stays off until a reason is typed: the mark on the label says the field is what it waits for. */}
        <label className={FORM_LABEL} htmlFor="reimbursement-reason">{reasonLabel}<span className="text-red-600" aria-hidden="true"> *</span></label>
        <textarea id="reimbursement-reason" ref={reasonRef} aria-required className={cx(inputClass, 'min-h-24 resize-y')} value={reason}
          onChange={e => setReason(sanitizeReasonInput(e.target.value))} maxLength={REASON_MAX_LENGTH} />
        <div className="flex justify-between gap-3 text-sm text-gray-500">
          <span>{minLength > 1 ? `อย่างน้อย ${minLength} ตัวอักษร` : ''}</span>
          <span className="mangmee-unit">{reason.length}/{REASON_MAX_LENGTH}</span>
        </div>
      </div>
    </Modal>
  );
}

export function VoidPaymentDialog({ payment, claim, busy, error, onClose, onConfirm }: {
  payment: any;
  claim?: any;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const trimmed = reason.trim();
  // The reason is shown on the payment row to every reader of the claim, so the API refuses one that looks like an
  // account number ("โอนเข้าบัญชีผิด" is where a number gets typed). Said at the field while it is typed, by the API's
  // own rule, and at the field again when the refusal comes from the server.
  const typedAccountNumber = looksLikeAccountNumber(reason);
  const reasonRefused = typedAccountNumber || error === NOTE_HAS_ACCOUNT_NUMBER;
  return (
    // Named for the thing and the amount: the title of a void says what is voided. `dirty`: a typed reason is not lost to a stray tap.
    <Modal open title={`ยกเลิกรายการจ่ายนี้ ${formatMoney(payment.paidAmount, payment.currency)}`} size="sm" closeLabel="ปิด" dirty={trimmed !== '' || acknowledged} onClose={onClose}
      footer={(
        <>
          <button type="button" className={ghostClass} onClick={onClose}>ไม่ยกเลิก</button>
          <button type="button" className={dangerClass} disabled={busy || !trimmed || !acknowledged || typedAccountNumber} aria-busy={Boolean(busy)}
            onClick={() => onConfirm(trimmed)}>ยกเลิกรายการจ่ายนี้</button>
        </>
      )}>
      <div className="space-y-4">
        <p className="break-words text-sm text-gray-600">{[payment.paymentNo, claim?.requesterDisplayNameSnapshot && `จ่ายให้ ${claim.requesterDisplayNameSnapshot}`].filter(Boolean).join(' · ')}</p>
        {/* What the void does to the claim, in one sentence (a confirmed duplicate says its own next step). */}
        <Notice tone="warning">{claim?.duplicateReasons?.includes('EXPENSE_CONFIRMED_DUPLICATE') ? reimbursementDuplicateBlockNotice(claim.duplicateReasons, false, { status: claim.status }) : 'ใบเบิกจะกลับไปรอจ่าย'}</Notice>
        {error && error !== NOTE_HAS_ACCOUNT_NUMBER && <ErrorBanner message={error} />}
        <div>
          <label className={FORM_LABEL} htmlFor="reimbursement-void-reason">เหตุผล<span className="text-red-600"> *</span></label>
          <textarea id="reimbursement-void-reason" className={cx(inputClass, 'min-h-24 resize-y')} value={reason} aria-required
            aria-invalid={reasonRefused || undefined} aria-describedby="reimbursement-void-reason-note"
            onChange={e => setReason(sanitizeReasonInput(e.target.value))} maxLength={REASON_MAX_LENGTH}
            placeholder="เช่น บันทึกเลขอ้างอิงผิด หรือยกเลิกรายการโอนแล้ว" />
          <div className="mt-1 flex justify-between gap-3 text-sm">
            <span id="reimbursement-void-reason-note" role={reasonRefused ? 'alert' : undefined}
              className={cx('min-w-0 [overflow-wrap:anywhere]', reasonRefused ? 'font-medium text-error-700' : 'text-gray-500')}>
              {reasonRefused ? NOTE_HAS_ACCOUNT_NUMBER : 'ทุกคนที่เปิดใบนี้เห็นเหตุผลนี้ อย่าพิมพ์เลขบัญชี'}
            </span>
            <span className="mangmee-unit shrink-0 text-gray-500">{reason.length}/{REASON_MAX_LENGTH}</span>
          </div>
        </div>
        <label className="flex min-h-11 items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm text-gray-700">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />
          <span>ยืนยันว่าตรวจและจัดการเงินจริงกับธนาคารหรือผู้รับเงินแล้ว</span>
        </label>
      </div>
    </Modal>
  );
}

export function StaleApprovalDialog({ requestNo, diff, lines, currency, busy, error, onClose, onConfirm, confirmLabel = 'อนุมัติ', beforePayout, payout }: {
  requestNo?: string;
  diff: ApprovalFieldDiff[];
  lines: any[];
  currency: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  /** A claim now paid by transfer is not approved from here: the caller sends the approver to check the account first. */
  confirmLabel?: string;
  beforePayout?: Parameters<typeof PayoutHolderNotice>[0]['account'];
  payout?: Parameters<typeof PayoutHolderNotice>[0]['account'];
}) {
  const accountText = (text: string, account: typeof payout) => {
    const line = account?.accountName && payoutHolderLine(account);
    if (text === '—') return 'ยังไม่ระบุ';
    return line && text.endsWith(` · ${line}`) ? text.slice(0, -line.length - 3) : text;
  };
  const changed = diff.filter(row => row.changed);
  return (
    <Modal
      open
      // The number is one unit: on a phone the title wraps before it, never inside it.
      title={<>ใบเบิกถูกแก้หลังส่งอนุมัติ{requestNo && <> <span className="mangmee-unit">{requestNo}</span></>}</>}
      size="lg"
      closeLabel="ปิด"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={ghostClass} onClick={onClose}>ปิด</button>
          <button type="button" className={btnClass} disabled={busy} aria-busy={Boolean(busy)} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        {/* Advice, not an error of the approver's: what happened and what to look at before pressing. */}
        <Notice tone="warning">ใบนี้ถูกแก้หลังส่งอนุมัติ ดูสิ่งที่เปลี่ยนก่อนอนุมัติ</Notice>
        {/* Only what changed, each as it was and as it is now. Before: a three-column table that also listed the four
            rows nothing had happened to, and broke a date and an amount over two lines in a phone sheet. */}
        {changed.length > 0 ? (
          <dl className="divide-y divide-gray-100" data-testid="reimbursement-stale-changes">
            {changed.map(row => (
              <div key={row.key} className="py-3 first:pt-0 last:pb-0">
                <dt className="text-sm font-semibold text-gray-900">{row.label}</dt>
                <dd className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                  <span className="text-gray-500">เดิม</span>
                  <span className="min-w-0 break-words text-gray-600">
                    <span className={row.key === 'amount' ? 'mangmee-unit' : undefined}>{row.key === 'payout' ? accountText(row.before, beforePayout) : row.key === 'amount' ? row.before.replace(/^฿(.+)$/, '$1 บาท') : row.before === '—' ? 'ยังไม่ระบุ' : row.before}</span>
                    {row.key === 'payout' && <PayoutHolderNotice account={beforePayout} />}
                  </span>
                  <span className="text-gray-500">ใหม่</span>
                  <span className="min-w-0 break-words font-semibold text-gray-900">
                    <span className={row.key === 'amount' ? 'mangmee-unit' : undefined}>{row.key === 'payout' ? accountText(row.after, payout) : row.key === 'amount' ? row.after.replace(/^฿(.+)$/, '$1 บาท') : row.after === '—' ? 'ยังไม่ระบุ' : row.after}</span>
                    {row.key === 'payout' && <PayoutHolderNotice account={payout} />}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <InfoBanner message="ใบเบิกถูกแก้ไข แต่ระบุจุดที่เปลี่ยนจากข้อมูลในรายการไม่ได้ (เช่น แก้ไขรายละเอียดรายการหรือวันที่) ตรวจรายการทั้งหมดด้านล่าง" />
        )}
        <div>
          <h3 className="mb-1 text-sm font-bold text-gray-900">รายการปัจจุบัน</h3>
          {/* One row per line at every width: the description, then its date and category, with the amount at the right. */}
          {lines.length === 0 ? <p className="text-sm text-gray-500">ไม่มีรายการ</p> : (
            <ul className="divide-y divide-gray-100 border-y border-gray-100" data-testid="reimbursement-stale-lines">
              {lines.map((line: any) => (
                <li key={line.id ?? line.lineNo} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="break-words font-semibold text-gray-900">{line.description}</div>
                    <div className="text-gray-500"><span className="mangmee-unit">{dateShort(line.incurredDate)}</span><span aria-hidden="true"> · </span><span>{categoryText(line.categoryLabelSnapshot)}</span></div>
                  </div>
                  <div className="mangmee-unit shrink-0 font-semibold text-gray-900">{formatMoney(line.amount, currency)}</div>
                </li>
              ))}
            </ul>
          )}
          {/* A total only where there is something to add up. */}
          {lines.length > 1 && (
            <div className="mt-2 flex items-baseline justify-between gap-3 text-sm font-semibold text-gray-900">
              <span>ยอดรวม</span><span className="mangmee-unit">{formatMoney(sumLineAmounts(lines), currency)}</span>
            </div>
          )}
        </div>
        {error && <ErrorBanner message={error} />}
      </div>
    </Modal>
  );
}

/**
 * Signing was refused because the signer has saved no signature. A signature saved on "ลายเซ็นของฉัน" is usable at
 * once: nothing is waited for and nobody approves it, so the dialog says where to save one and to come back.
 */
export function MissingSavedSignatureModal({ companyId, requestId, onClose }: {
  companyId: string;
  /** The claim the signer is on: the signature page offers the way back to it once a signature is saved. */
  requestId?: string;
  onClose: () => void;
}) {
  return (
    <Modal open title="ยังไม่มีลายเซ็นของคุณ" size="sm" closeLabel="ปิด" onClose={onClose}
      footer={(
        <>
          <button type="button" className={ghostClass} onClick={onClose}>ปิด</button>
          <Link href={`/companies/${companyId}/expenses/signatures${requestId ? `?fromClaim=${encodeURIComponent(requestId)}` : ''}`} className={btnClass}>ไปบันทึกลายเซ็น</Link>
        </>
      )}>
      <p className="text-sm text-gray-600">บันทึกลายเซ็นก่อน แล้วกลับมาเซ็นใบนี้ ลายเซ็นที่บันทึกแล้วใช้ได้ทันที</p>
    </Modal>
  );
}

/**
 * Owner 2026-10-01: six transfer slips were attached here and declared as signed forms, because the
 * payment step had nowhere to put a slip. It has now; this says so at the uploader and in its dialog.
 */
const SIGNED_COPY_NOT_FOR_SLIPS = 'ใบเบิกที่เซ็นแล้วเท่านั้น สลิปโอนเงินแนบที่เมนูเพิ่มเติมของรายการจ่าย';

/**
 * Payout spec §14.4: while a claim is in a payout round its form prints no destination and no approver, so nobody
 * signs it in the system and no scan is declared as signed. Said wherever signing is, with what the claim waits for
 * in the words of its badge: a claim with no account, one that asked for cash, and an answer that kept the account
 * have no "account being corrected" and no "new account" to wait for. Signing is offered after payment in the document step.
 */
const signingWaitsForRound = (detail: Parameters<typeof claimStatusBadge>[0]) =>
  `ใบนี้${claimStatusBadge(detail).label} ยังเซ็นหรือยืนยันสำเนาที่เซ็นครบไม่ได้ ${detail?.duplicateReasons?.includes('EXPENSE_CONFIRMED_DUPLICATE') ? reimbursementDuplicateBlockNotice(detail.duplicateReasons, false, { status: detail.status }) : 'ทำได้อีกครั้งหลังจ่ายครบที่ขั้นเอกสาร'}`;

/**
 * A4: a scan counts as the signed record only after the attacher declares the claim's signatures are on it for
 * THIS claim number. Without the declaration it is kept as an ordinary attachment that signs nothing.
 */
export function SignedCopyDialog({ requestNo, fileName, detail, waitsForRound, onClose, onSend }: {
  requestNo: string;
  fileName: string;
  detail?: any;
  /** While the claim is in a payout round: why no declaration is taken (the API takes the file and refuses the declaration). */
  waitsForRound?: string;
  onClose: () => void;
  onSend: (declared: boolean) => void;
}) {
  const [declared, setDeclared] = useState(false);
  const canDeclare = !waitsForRound;
  const signers = claimSignatureSlots(detail).filter(role => role !== 'APPROVER' || !claimHasNoApprover(detail)).map(role => CLAIM_SIGNATURE_ROLE_LABELS[role]);
  const signerText = signers.length > 2 ? `${signers.slice(0, -1).join(' ')} และ${signers.at(-1)}` : signers.join('และ');
  return (
    // One button, always pressable, named for what it will do: the tick decides whether the file is declared as the
    // signed form or kept as an ordinary attachment. (Before: two buttons in the body, the main one greyed out on top.)
    <Modal open title="แนบใบเบิกที่เซ็นแล้ว" size="sm" closeLabel="ปิด" onClose={onClose}
      footer={(
        <>
          <button type="button" className={ghostClass} onClick={onClose}>ปิด</button>
          <button type="button" className={btnClass} onClick={() => onSend(canDeclare && declared)}>{canDeclare && declared ? 'แนบสำเนาที่เซ็นครบ' : 'แนบเป็นไฟล์แนบทั่วไป'}</button>
        </>
      )}>
      <div className="space-y-4">
        <p className="break-words text-sm font-semibold text-gray-900">{fileName}</p>
        {/* Advice, not an error of the person's: amber, and said here too because slips were attached here by mistake. */}
        <Notice tone="warning">{SIGNED_COPY_NOT_FOR_SLIPS}</Notice>
        {canDeclare ? (
          <ChoiceRow type="checkbox" checked={declared} onChange={e => setDeclared(e.target.checked)}
            label={<>{`สำเนานี้มีลายเซ็น${signerText}ครบ และตรงกับใบเบิกเลขที่ `}<span className="mangmee-unit">{requestNo}</span></>}
            description="ถ้ายังเซ็นไม่ครบ ไม่ต้องติ๊ก ระบบเก็บเป็นไฟล์แนบทั่วไปไว้ในประวัติ แต่ยังไม่นับว่าเซ็นแล้ว" />
        ) : (
          <p className="text-sm text-gray-600">{waitsForRound} ตอนนี้แนบเป็นไฟล์แนบทั่วไปได้ ระบบจะเก็บไว้ในประวัติ แต่ยังไม่นับว่าเซ็นแล้ว</p>
        )}
      </div>
    </Modal>
  );
}

/** The label of a field on a form of this area: 14 px, like the text it stands above. */
const FORM_LABEL = 'mb-1.5 block text-sm font-semibold text-gray-700';

/**
 * Full payment only (MVP). A modal in the hub queue; inline in the journey card, never a modal on mobile.
 * `request` is the claim detail where the host has it: files already attached to the claim can serve as the slip.
 */
export function PaymentForm({ companyId, request, onCancel, onDone, onOpenFile, onClaimChanged, onBusyChange }: {
  companyId: string;
  request: any;
  onCancel: () => void;
  onDone: () => void;
  onClaimChanged?: (latest: any) => void;
  onBusyChange?: (busy: boolean) => void;
  /**
   * Opens a file already on the claim, so the payer sees what it is before choosing it as the slip. Every host gives
   * it (`useClaimDocumentPreview().openSlipChoice`): the form never lists files that cannot be looked at.
   */
  onOpenFile: (choice: PaymentSlipChoice) => void;
}) {
  const toast = useToast();
  // The method starts from what the requester asked for (spec §12.2): the claim's own receiving method.
  // A legacy claim asked for nothing, so nothing is chosen for its payer. เงินสด is never a fallback
  // (owner 2026-10-01): a transfer saved under a pre-selected เงินสด is recorded wrongly and without its slip.
  const [form, setForm] = useState({
    paidAmount: String(request.outstandingAmount), paymentMethod: requestedPayout(request)?.payoutMethod ?? '', paidAt: todayCivilDate(), paymentReference: '',
  });
  // What the payer says about the account: the tick is kept with the key of the account it was given
  // for, so it is no tick for another account version, another default or another method.
  const [payer, setPayer] = useState({ confirmedFor: '', mismatchReason: '' });
  const [slip, setSlip] = useState<PaymentFormSlip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setWorking = (value: boolean) => { setBusy(value); onBusyChange?.(value); };
  // One session for this opened form: its key makes บันทึกจ่าย after a lost answer the same payment, never a
  // second one, and its in-flight flag makes a second press before the first has finished do nothing.
  const session = useRef<PaymentFormSession>({ idempotencyKey: null, saving: false });
  const today = todayCivilDate();
  const futurePaidAt = Boolean(form.paidAt && isFuturePaymentDate(form.paidAt, today));
  const attached = paymentSlipChoices(request);
  // One rule for the fields shown and the payment the API takes (`reimbursementPaymentRule`): the
  // slip, the confirmation of the account and the reason for another method than the one asked for.
  const payout = paymentFormPayout(request, form.paymentMethod);
  const slipRequired = payout.rule.slipRequired;
  const chosen = chosenPaymentSlipChoice(slip, attached);
  const reference = reimbursementPaymentReferenceField(form.paymentMethod, slip !== null);
  const referenceId = useId();
  // Like a missing slip, a missing cheque number is said when the payer presses บันทึกจ่าย, not while the form is still being filled.
  const validationError = futurePaidAt ? PAYMENT_DATE_IN_FUTURE.message : error;
  // A refusal of the form's own check is said at the field it is about, where it is put right. The form is as it was
  // when it was refused (any change takes the refusal away), so the same check names that field again; a refusal the
  // check does not give (the API's, an upload's) names none and is said in the box above the buttons.
  const problem = error ? paymentFormProblem({
    ...form, outstandingAmount: String(request.outstandingAmount), hasSlip: slip !== null,
    payout: { rule: payout.rule, confirmed: !!payout.confirmation && payer.confirmedFor === payout.confirmation.key, mismatchReason: payer.mismatchReason },
  }) : null;
  const errorAt: PaymentFormField | null = futurePaidAt ? 'date' : problem && problem.text === error ? problem.field : null;
  const errorFor = (field: PaymentFormField) => (errorAt === field ? validationError : null);
  // A refusal is about the form as it was pressed. Whatever the payer then changes takes it away, so the red box never contradicts the
  // form in front of them (the slip the form itself swaps in after an upload is not the payer's change: `onSlipUploaded` keeps `setSlip`).
  const edited = <T,>(set: React.Dispatch<React.SetStateAction<T>>): React.Dispatch<React.SetStateAction<T>> => (next) => { setError(null); set(next); };
  const editForm = edited(setForm), editPayer = edited(setPayer), editSlip = edited(setSlip);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await savePaymentForm({ form, outstandingAmount: String(request.outstandingAmount), slip, slipChoices: attached, session: session.current, payout, payer }, {
      uploadSlip: (file) => uploadReimbursementPaymentSlip(companyId, request.id, file),
      recordPayment: (body) => recordReimbursementPayment(companyId, request.id, body),
      // Kept once uploaded: if saving then fails, the retry sends this same slip instead of uploading again.
      onSlipUploaded: setSlip,
      newIdempotencyKey: () => crypto.randomUUID(),
      onBusy: (sending) => { setWorking(sending); if (sending) setError(null); },
    });
    if (result.status === 'refused') setError(result.text);
    if (result.status === 'refused' && result.refreshClaim) {
      setWorking(true);
      let notice = result.text;
      try {
        const latest = await getReimbursement(companyId, request.id);
        if (onClaimChanged) onClaimChanged(latest); else onCancel();
      } catch (error) { onCancel(); notice = `${notice} · ${errorText(error)}`; }
      finally { setWorking(false); }
      toast.error(notice);
    }
    // Done is said of the thing done: which claim, and how much.
    if (result.status === 'saved') { onDone(); toast.success(`บันทึกจ่าย${request.requestNo ? ` ${request.requestNo}` : ''} ${formatMoney(request.outstandingAmount, request.currency)} แล้ว`); }
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      {/* Who is paid and how much, first and large: the costliest mistake here is paying the wrong person or twice. The
          amount is the claim's whole outstanding amount and nothing else is taken, so it is said, not asked for (before:
          an editable field holding "1420.5" under a sentence that said the same). */}
      <p className="text-base font-semibold text-gray-900" data-testid="reimbursement-payment-payee">
        {request.requesterDisplayNameSnapshot ? `จ่ายให้ ${request.requesterDisplayNameSnapshot} ` : 'จ่าย '}
        <span className="mangmee-unit">{formatMoney(request.outstandingAmount, request.currency)}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className={FORM_LABEL}>วิธีจ่าย<span className="text-red-600"> *</span></label>
          <ThemedSelect className={inputClass} aria-label="วิธีจ่าย" required aria-invalid={errorFor('method') ? true : undefined} value={form.paymentMethod} onChange={e => editForm(f => ({ ...f, paymentMethod: e.target.value }))}>
            <option value="" disabled>เลือกวิธีจ่าย</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </ThemedSelect>
          {errorFor('method') && <p className="mt-1"><FieldError>{errorFor('method')}</FieldError></p>}
        </div>
        <div><label className={FORM_LABEL}>วันที่จ่าย<span className="text-red-600"> *</span></label><ThemedDate className={inputClass} required max={today} today={today} aria-invalid={errorFor('date') ? true : undefined} value={form.paidAt} onChange={e => editForm(f => ({ ...f, paidAt: e.target.value }))} />
          {errorFor('date') && <p className="mt-1"><FieldError>{errorFor('date')}</FieldError></p>}
        </div>
      </div>
      {/* Spec §12.4: paying another way than the claim states is allowed, and says why. Said of the claim: no fact says
          who chose its method (whoever prepared it, or answered a round for the requester, may have). */}
      {payout.rule.mismatchReasonRequired && (
        <div data-testid="reimbursement-payment-mismatch">
          <label className={FORM_LABEL} htmlFor="reimbursement-payment-mismatch-reason">เหตุผลที่จ่ายต่างจากที่ระบุในใบ<span className="text-red-600"> *</span></label>
          <textarea id="reimbursement-payment-mismatch-reason" className={cx(inputClass, 'min-h-20 resize-y')} aria-required maxLength={REASON_MAX_LENGTH} disabled={busy}
            value={payer.mismatchReason} onChange={e => editPayer(p => ({ ...p, mismatchReason: sanitizeReasonInput(e.target.value) }))}
            aria-invalid={errorFor('mismatch') ? true : undefined}
            placeholder="เช่น ผู้เบิกขอรับเป็นเงินสดแทน" />
          {/* One line under a field: what is wrong with it when something is, else what it is for. */}
          {errorFor('mismatch') ? <p className="mt-1"><FieldError>{errorFor('mismatch')}</FieldError></p> : (
            <p className="mt-1 text-sm text-gray-500">
              ใบนี้ระบุ{payout.requestedMethodText} ประวัติการจ่ายจะแสดงว่า{PAID_DIFFERENTLY_LABEL} พร้อมเหตุผลนี้ อย่าพิมพ์เลขบัญชีในช่องนี้
            </p>
          )}
        </div>
      )}
      <div>
        <label className={FORM_LABEL} htmlFor={referenceId}>{reference.label.replaceAll('แนบสลิป', 'แนบหลักฐานการจ่าย')}</label>
        <input id={referenceId} className={inputClass} aria-label={reference.name} aria-required={reference.required} aria-invalid={errorFor('reference') ? true : undefined} aria-describedby={`${referenceId}-hint`} value={form.paymentReference} onChange={e => editForm(f => ({ ...f, paymentReference: e.target.value }))} />
        {errorFor('reference') ? <p className="mt-1"><FieldError id={`${referenceId}-hint`}>{errorFor('reference')}</FieldError></p>
          : <p id={`${referenceId}-hint`} className="mt-1 text-pretty text-sm text-gray-500">{reference.hint}</p>}
      </div>
      <div data-testid="reimbursement-payment-slip">
        <div className={FORM_LABEL}>หลักฐานการจ่าย{slipRequired && <span className="text-red-600"> *</span>}</div>
        {/* No capture attribute, like the receipt upload: a phone offers its camera and its photo library. */}
        <ThemedFile file={slip ? ('file' in slip ? slip.file : slip.name) : null} accept={RECEIPT_UPLOAD_ACCEPT} aria-label="หลักฐานการจ่าย"
          aria-required={slipRequired} disabled={busy} loading={busy && !!slip && 'file' in slip}
          onChange={file => editSlip(file ? { file } : null)} />
        {/* One line: that it is missing when the form was pressed without it, else whether it is needed for the method
            chosen and what a file may be. */}
        {errorFor('slip') ? <p className="mt-1"><FieldError>{errorFor('slip')}</FieldError></p> : (
          <p className="mt-1 text-sm text-gray-500">
            {slipRequired ? 'โอนเงินต้องแนบหลักฐานการจ่าย' : 'ไม่บังคับ'} · PDF หรือรูปภาพ ไม่เกิน <span className="mangmee-unit">10 เมกะไบต์</span>
          </p>
        )}
        {attached.length > 0 && (
          <div className="mt-3 [overflow-wrap:anywhere]" data-testid="reimbursement-payment-slip-choices">
            <div className="text-sm font-semibold text-gray-700">เลือกจากไฟล์ที่แนบไว้ในใบนี้</div>
            <p className="mb-2 mt-1 text-sm text-gray-500">ใช้แทนการแนบไฟล์ใหม่ได้ เลือกเฉพาะไฟล์ที่เป็นสลิปหรือหลักฐานการโอน เปิดดูก่อนเลือกได้</p>
            {/* A list, not a drop-down: each file says what it is on this claim and can be opened before it is chosen. */}
            <div role="radiogroup" aria-label="เลือกจากไฟล์ที่แนบไว้ในใบนี้" className="space-y-2">
              {attached.map(choice => (
                <div key={choice.attachmentId} className={cx('rounded-xl border px-3 py-2', chosen?.attachmentId === choice.attachmentId ? 'border-brand-300 bg-brand-25' : 'border-gray-200')}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-3">
                    <input type="radio" name="reimbursement-payment-slip-choice" className="mt-0.5 h-5 w-5 shrink-0" disabled={busy}
                      checked={chosen?.attachmentId === choice.attachmentId}
                      onChange={() => editSlip({ attachmentId: choice.attachmentId, name: choice.label })} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-900">{choice.label}</span>
                      <span className="mt-0.5 block text-sm text-gray-500">{choice.what}</span>
                    </span>
                  </label>
                  <button type="button" className="ml-8 min-h-11 text-left text-sm text-brand-700 underline decoration-1 underline-offset-4 hover:decoration-2 disabled:opacity-50"
                    disabled={busy} aria-busy={Boolean(busy)} onClick={() => onOpenFile(choice)}>
                    เปิดดูไฟล์นี้
                  </button>
                </div>
              ))}
            </div>
            {chosen?.kind === 'signed-copy' && (
              <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="reimbursement-payment-slip-move-note">
                เมื่อบันทึกจ่าย ไฟล์ <span className="font-semibold">{chosen.label}</span> จะย้ายออกจากรายการใบเบิกที่เซ็นแล้วมาเป็นหลักฐานการจ่ายนี้ และย้ายกลับไม่ได้ ถ้าเคยยืนยันว่าไฟล์นี้คือใบเบิกที่เซ็นครบ ระบบจะถอนการยืนยันนั้น
              </p>
            )}
          </div>
        )}
      </div>
      {/* Spec §12.3: the transfer went into the account shown. Given per account, never carried over to another. */}
      {payout.confirmation && (
        <PayerConfirmationCheck confirmation={payout.confirmation} checked={payer.confirmedFor === payout.confirmation.key} disabled={busy}
          onChange={(checked) => editPayer(p => ({ ...p, confirmedFor: checked ? payout.confirmation!.key : '' }))} />
      )}
      {errorFor('confirmation') && <p><FieldError>{errorFor('confirmation')}</FieldError></p>}
      {/* What no field of the form answers (the API's refusal, a failed upload): above the buttons, inside the form. */}
      {validationError && !errorAt && <ErrorBanner message={validationError} />}
      <ActionGroup>
        <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => { if (!session.current.saving) onCancel(); }}>ยกเลิก</button>
        <button type="submit" className={btnClass} disabled={busy || futurePaidAt} aria-busy={Boolean(busy)}>บันทึกจ่าย {formatMoney(request.outstandingAmount, request.currency)}</button>
      </ActionGroup>
    </form>
  );
}

const attachmentPreviewMimeType = (fileName: string): 'application/pdf' | 'image/png' | 'image/jpeg' => (
  /\.pdf$/i.test(fileName) ? 'application/pdf' : /\.png$/i.test(fileName) ? 'image/png' : 'image/jpeg'
);
type ReimbursementDocumentPreviewTarget =
  | { kind: 'claim-form'; reimbursementId: string; name: string }
  | { kind: 'attachment'; reimbursementId: string; attachmentId: string; fileName: string; mimeType: 'application/pdf' | 'image/png' | 'image/jpeg' }
  // A slip is fetched through the claim's own slip endpoint, never the generic attachment download.
  | { kind: 'payment-slip'; reimbursementId: string; paymentId: string; attachmentId: string; name: string };

/**
 * ใบเบิกค่าใช้จ่าย (rendered server-side as SVG, saved as PDF from the viewer) and authenticated
 * attachments, behind one latest-request gate. `onError(null)` clears the host's banner.
 */
export function useClaimDocumentPreview(companyId: string, onError: (message: string | null) => void) {
  const [claimForm, setClaimForm] = useState<{ name: string; url: string; pages: string[] } | null>(null);
  const [claimFormSaving, setClaimFormSaving] = useState(false);
  const [claimFormError, setClaimFormError] = useState<string | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<DocumentPreviewSource | null>(null);
  const [previewTarget, setPreviewTarget] = useState<ReimbursementDocumentPreviewTarget | null>(null);
  const [previewLoadingKey, setPreviewLoadingKey] = useState<string | null>(null);
  const previewRequestRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const claimFormSaveRequestRef = useRef(0);

  const releaseAttachmentPreviewUrl = useCallback(() => {
    const url = previewUrlRef.current;
    previewUrlRef.current = null;
    if (url) URL.revokeObjectURL(url);
  }, []);

  const closeDocumentPreview = useCallback(() => {
    previewRequestRef.current += 1;
    claimFormSaveRequestRef.current += 1;
    releaseAttachmentPreviewUrl();
    setClaimForm(null);
    setClaimFormError(null);
    setClaimFormSaving(false);
    setAttachmentPreview(null);
    setPreviewTarget(null);
    setPreviewLoadingKey(null);
  }, [releaseAttachmentPreviewUrl]);

  useEffect(() => () => {
    previewRequestRef.current += 1;
    claimFormSaveRequestRef.current += 1;
    releaseAttachmentPreviewUrl();
  }, [releaseAttachmentPreviewUrl]);

  const loadDocumentPreview = async (target: ReimbursementDocumentPreviewTarget) => {
    const requestId = ++previewRequestRef.current;
    claimFormSaveRequestRef.current += 1;
    const loadingKey = target.kind === 'claim-form' ? `claim-form:${target.reimbursementId}` : `${target.kind}:${target.attachmentId}`;
    setPreviewLoadingKey(loadingKey);
    onError(null);
    try {
      if (target.kind === 'claim-form') {
        const nextPreview = await previewReimbursementClaimForm(companyId, target.reimbursementId);
        if (requestId !== previewRequestRef.current) return;
        releaseAttachmentPreviewUrl();
        setAttachmentPreview(null);
        setClaimFormError(null);
        setClaimFormSaving(false);
        const pages = nextPreview.pageSvgDataUrls?.length ? nextPreview.pageSvgDataUrls : [nextPreview.svgDataUrl];
        setClaimForm({ name: target.name, url: pages[0]!, pages });
      } else {
        const blob = target.kind === 'payment-slip'
          ? await fetchReimbursementPaymentSlipBlob(companyId, target.reimbursementId, target.paymentId, target.attachmentId)
          : await fetchAttachmentPreviewBlob(companyId, target.attachmentId, target.mimeType);
        if (requestId !== previewRequestRef.current) return;
        const url = URL.createObjectURL(blob);
        releaseAttachmentPreviewUrl();
        previewUrlRef.current = url;
        setClaimForm(null);
        setClaimFormError(null);
        setAttachmentPreview({ name: target.kind === 'payment-slip' ? target.name : target.fileName, mimeType: blob.type, url });
      }
      setPreviewTarget(target);
    } catch (e) {
      if (requestId !== previewRequestRef.current) return;
      onError(errorText(e));
      throw e;
    } finally {
      if (requestId === previewRequestRef.current) {
        setPreviewLoadingKey((current) => current === loadingKey ? null : current);
      }
    }
  };

  const openClaimForm = async (claim: { id: string; requestNo?: string }) => {
    try {
      await loadDocumentPreview({ kind: 'claim-form', reimbursementId: claim.id, name: `ใบเบิกค่าใช้จ่าย ${claim.requestNo ?? ''}`.trim() });
    } catch {
      // The active request already reports its localized failure through onError.
    }
  };

  /** Fetch first so storage 404/MIME errors are visible before opening the document viewer. */
  const openAttachment = async (reimbursementId: string, attachmentId: string, fileName: string) => {
    try {
      await loadDocumentPreview({ kind: 'attachment', reimbursementId, attachmentId, fileName, mimeType: attachmentPreviewMimeType(fileName) });
    } catch {
      // The active request already reports its localized failure through onError.
    }
  };

  /** The viewer names the slip by its payment, so no file name has to leave the API for people who cannot open it. */
  const openPaymentSlip = async (reimbursementId: string, paymentId: string, attachmentId: string, name: string) => {
    try {
      await loadDocumentPreview({ kind: 'payment-slip', reimbursementId, paymentId, attachmentId, name });
    } catch {
      // The active request already reports its localized failure through onError.
    }
  };

  const downloadClaimForm = async () => {
    if (!claimForm) return;
    const requestId = ++claimFormSaveRequestRef.current;
    const target = claimForm;
    setClaimFormSaving(true);
    setClaimFormError(null);
    try {
      await downloadDocumentAsPdf(target.pages, target.name, { vector: true });
    } catch (e) {
      if (requestId === claimFormSaveRequestRef.current) setClaimFormError(errorText(e));
    } finally {
      if (requestId === claimFormSaveRequestRef.current) setClaimFormSaving(false);
    }
  };

  // Siblings of the host's claim view, so closing a preview never closes the claim behind it.
  const previewModals = (
    <>
      {claimForm && <DocumentPreviewModal
        source={{ name: claimForm.name, mimeType: 'image/svg+xml', url: claimForm.url }}
        imagePageUrls={claimForm.pages}
        printSurface
        hideOpenNewTab
        closeLabel="ปิด"
        loadingLabel="กำลังเปิดเอกสาร..."
        errorLabel="แสดงเอกสารนี้ไม่สำเร็จ ลองสร้างตัวอย่างใหม่"
        retryLabel="ลองอีกครั้ง"
        openNewTabLabel="เปิดในแท็บใหม่"
        onClose={closeDocumentPreview}
        onRetry={previewTarget?.kind === 'claim-form' ? () => loadDocumentPreview(previewTarget) : undefined}
        // The dialog's main button is its own "พิมพ์" (it is opened by "พิมพ์ใบเบิก"): saving a PDF is the plain button
        // beside it, so the dialog has one filled button. The name stays while the file is made, so the width does too.
        footer={(
          <>
            {claimFormError && <p role="alert" className="mr-auto text-sm font-semibold text-error-700">{claimFormError}</p>}
            <button type="button" className={ghostClass} disabled={claimFormSaving} aria-busy={Boolean(claimFormSaving)} onClick={() => void downloadClaimForm()}>ดาวน์โหลด PDF</button>
          </>
        )}
      />}
      {attachmentPreview && <DocumentPreviewModal
        source={attachmentPreview}
        closeLabel="ปิด"
        loadingLabel="กำลังเปิดเอกสาร..."
        errorLabel="แสดงเอกสารนี้ไม่สำเร็จ ลองอีกครั้ง"
        retryLabel="ลองอีกครั้ง"
        openNewTabLabel="เปิดในแท็บใหม่"
        onClose={closeDocumentPreview}
        onRetry={previewTarget && previewTarget.kind !== 'claim-form' ? () => loadDocumentPreview(previewTarget) : undefined}
      />}
    </>
  );

  /**
   * A file already on the claim, opened before it is chosen as a payment's slip (`PaymentForm`'s `onOpenFile`): a
   * slip of an earlier payment through the slip's own endpoint, a signed copy as an attachment of the claim. One
   * handler for every host of the payment form, so none of them lists files that cannot be looked at.
   */
  const openSlipChoice = (reimbursementId: string, choice: PaymentSlipChoice) => (choice.kind === 'previous-slip' && choice.paymentId
    ? openPaymentSlip(reimbursementId, choice.paymentId, choice.attachmentId, choice.label)
    : openAttachment(reimbursementId, choice.attachmentId, choice.fileName ?? choice.label));

  return { previewLoadingKey, closeDocumentPreview, openClaimForm, openAttachment, openPaymentSlip, openSlipChoice, previewModals };
}

/**
 * Who is paid back, why, and how much — the head of every claim view. Each fact once: who prepared the claim is said
 * only when it was someone else, and what is still owed only when it is neither nothing nor the whole amount
 * (the status already says "จ่ายแล้ว" or "ยกเลิกแล้ว").
 */
export function ClaimSummaryCard({ detail }: { detail: any }) {
  const preparedByOther = detail.createdByName && detail.createdByName !== detail.requesterDisplayNameSnapshot;
  const outstanding = Number(detail.outstandingAmount), total = Number(detail.amount);
  const partlyPaid = !['CANCELLED', 'VOIDED'].includes(detail.status) && outstanding > 0 && outstanding < total;
  return (
    <MangmeeCard className="p-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-gray-500">ผู้เบิก</dt><dd className="mt-1 font-semibold text-gray-900">{detail.requesterDisplayNameSnapshot ?? 'ยังไม่ระบุ'}</dd></div>
        <div className="min-w-0"><dt className="text-gray-500">เหตุผล</dt><dd className="mt-1 text-gray-900">{detail.reason ?? 'ยังไม่ระบุ'}</dd></div>
        {preparedByOther && <div><dt className="text-gray-500">ผู้จัดทำ</dt><dd className="mt-1 text-gray-900">{detail.createdByName}</dd></div>}
      </dl>
      <MetricGrid className="mt-4 sm:!grid-cols-1" items={[{ key: 'total', label: 'ยอดรวม', value: amountText(detail.amount),
        unit: !detail.currency || detail.currency === 'THB' ? 'บาท' : detail.currency, dot: 'bg-brand-500',
        note: partlyPaid ? `คงค้าง ${formatMoney(detail.outstandingAmount, detail.currency)}` : undefined }]} />
    </MangmeeCard>
  );
}

type ClaimSectionProps = {
  detail: any;
  userId: string;
  permissions: readonly string[];
  busy: boolean;
  onOpenAttachment: (attachmentId: string, fileName: string) => void;
  /** Opens one slip of one payment; offered only to viewers the slip endpoint serves. */
  onOpenPaymentSlip: (payment: any, attachmentId: string, name: string) => void;
  /** Adds a slip to a payment already recorded (add-only). */
  onAttachPaymentSlip: (payment: any, file: File) => void;
  /** Moves a file out of ใบเบิกที่เซ็นแล้ว to be the slip of that payment (a slip attached there by mistake). */
  onUseSignedCopyAsSlip: (copy: any, payment: any) => void;
  onLineReceipt: (lineNo: number, file: File | null) => void;
  /** Every block this viewer may sign, from one tap (spec §9). */
  onSign: (roles: ClaimSignatureRole[]) => void;
  /** `confirmedRequestNo` = the A4 declaration was made; without it the scan is an ordinary attachment. */
  onUploadSignedCopy: (file: File, confirmedRequestNo?: string) => void;
  onRequestVoidPayment: (payment: any) => void;
};

/**
 * What is claimed: the lines with their evidence. Shown right under the summary, before anything is decided, because
 * it is what an approver and a payer look at. The few facts of the old "ข้อมูลใบเบิก" card that are not said anywhere
 * else follow the lines, each only when there is something to say.
 */
export function ClaimLines({ detail, userId, permissions, busy, onOpenAttachment, onLineReceipt, receiptError, missingReceiptsOnly = false }: Pick<ClaimSectionProps, 'detail' | 'userId' | 'permissions' | 'busy' | 'onOpenAttachment' | 'onLineReceipt'> & { receiptError?: string; missingReceiptsOnly?: boolean }) {
  const receiptId = useId();
  const lines: any[] = detail.lines ?? [];
  const firstMissingReceipt = lines.find(line => !line.attachmentId && !line.linkedExpenseId)?.lineNo;
  const { canEditDraft } = reimbursementOwnActions(detail, userId, permissions);
  const duplicateFact = detail.duplicateReasons?.includes('EXPENSE_CONFIRMED_DUPLICATE') ? duplicateNoticeForViewer(detail, permissions, userId)
    : ['POSSIBLE_DUPLICATE', 'CONFIRMED_DUPLICATE', 'OVERRIDDEN'].includes(detail.duplicateStatus) ? DUPLICATE_STATUS_LABELS[detail.duplicateStatus] : null;
  // One receipt block for the phone card and the table cell, so the upload rules live in one place.
  const lineReceipt = (l: any, view: 'card' | 'table') => (
    <>
      {l.sourceExpenseSnapshot ? l.sourceExpenseSnapshot.attachments.map((file: { id: string; fileName: string }) => (
        <button type="button" key={file.id} className="block min-h-11 max-w-48 truncate text-brand-700 hover:underline" onClick={() => onOpenAttachment(file.id, file.fileName)}>📎 {file.fileName}</button>
      )) : l.attachmentId ? (
        <button type="button" className="min-h-11 max-w-40 truncate text-brand-700 hover:underline" onClick={() => onOpenAttachment(l.attachmentId, l.attachmentFileName ?? 'receipt.jpg')}>
          📎 {l.attachmentFileName ?? 'เปิดไฟล์แนบ'}
        </button>
        // A line with no receipt says so in words: it is what stops the claim, and a dash said nothing.
      ) : <div className={l.linkedExpenseId ? 'text-gray-600' : 'font-medium text-warning-700'}>{l.linkedExpenseId ? '🔗 ค่าใช้จ่ายที่บันทึกไว้' : 'ยังไม่มีใบเสร็จ'}</div>}
      {missingReceiptsOnly && canEditDraft && !l.sourceExpenseSnapshot && (
        <div className="mt-1 space-y-1" data-claim-missing-receipt={!l.attachmentId && !l.linkedExpenseId ? true : undefined}>
          <ThemedFile aria-label={`ใบเสร็จรายการที่ ${l.lineNo}`} aria-describedby={receiptError && l.lineNo === firstMissingReceipt ? `${receiptId}-${view}-${l.lineNo}` : undefined} file={null} accept={RECEIPT_UPLOAD_ACCEPT} disabled={busy} loading={Boolean(busy)} onChange={file => { if (file) onLineReceipt(l.lineNo, file); }} />
          {receiptError && l.lineNo === firstMissingReceipt && <p id={`${receiptId}-${view}-${l.lineNo}`} role="alert" className="text-sm text-error-700">{receiptError}</p>}
          <p className="text-gray-500"><WholeWords text={ATTACHMENT_SOURCE_TYPES_LABEL} /></p>
          {l.attachmentId && <button type="button" className="min-h-11 text-red-600 hover:underline" disabled={busy} aria-busy={Boolean(busy)} onClick={() => onLineReceipt(l.lineNo, null)}>นำไฟล์ออก</button>}
        </div>
      )}
    </>
  );
  if (missingReceiptsOnly) {
    const missing = lines.filter(line => !line.attachmentId && !line.linkedExpenseId && !line.sourceExpenseSnapshot);
    if (!canEditDraft || missing.length === 0) return null;
    return <div className="space-y-3" data-testid="claim-step-receipts">
      {missing.map(line => <div key={line.id ?? line.lineNo} className="space-y-1 text-sm">
        <p className="font-semibold text-gray-900">รายการที่ {line.lineNo} · {line.description}</p>
        {lineReceipt(line, 'card')}
      </div>)}
    </div>;
  }
  return (
    <MangmeeCard className="p-4">
      <h2 className="mb-2 text-sm font-bold text-gray-900">รายการ ({lines.length})</h2>
      {/* By the width of this card, not of the screen: beside the step card on a laptop it is as narrow as a tablet,
          and seven columns then squeezed Thai text and amounts to a letter or two per row. */}
      <div className="[container-type:inline-size]">
        {/* One row per line with a line between: a line is not a box inside this card. */}
        <div className="divide-y divide-gray-100 @[44rem]:hidden" data-testid="reimbursement-line-cards">
          {lines.length === 0 ? <p className="py-3 text-center text-sm text-gray-500">ไม่มีรายการ</p> : lines.map((l: any) => (
            <div key={l.id ?? l.lineNo} className="py-3 first:pt-1 last:pb-0" data-testid="reimbursement-line-card">
              <div className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0 break-words font-medium text-gray-900">{l.description}</div>
                <div className="mangmee-unit shrink-0 font-semibold text-gray-900">{formatMoney(l.amount, detail.currency)}</div>
              </div>
              <div className="mt-1 break-words text-sm text-gray-500">{`${dateShort(l.incurredDate)} · ${categoryText(l.categoryLabelSnapshot)}`}</div>
              {l.purpose && <div className="mt-0.5 break-words text-sm text-gray-500">{`วัตถุประสงค์: ${l.purpose}`}</div>}
              {l.sourceExpenseSnapshot && <ReimbursementSourceFacts source={l.sourceExpenseSnapshot} formatAmount={(value, currency) => formatMoney(value, typeof currency === 'string' ? currency : undefined)} />}
              <div className="mt-2 text-sm">{lineReceipt(l, 'card')}</div>
            </div>
          ))}
          {lines.length > 1 && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2.5 text-sm font-medium">
              <span>รวมเป็นเงิน</span>
              <span className="mangmee-unit">{formatMoney(detail.amount, detail.currency)}</span>
            </div>
          )}
        </div>
        {/* Plain overflow-x-auto so the columns wrap to fit: mangmee-table-scroll's max-content pushed the amount and
            receipt columns off a desktop card. `relative` keeps the receipt picker's hidden input inside this box;
            `break-normal` undoes the page's overflow-wrap:anywhere, which split Thai words mid-word in narrow columns. */}
        <div className="relative hidden overflow-x-auto break-normal @[44rem]:block" data-testid="reimbursement-lines-table">
          <table className="mangmee-table">
            <thead>
              <tr>
                <th>ลำดับ</th><th>วันที่</th><th>รายการ</th><th>วัตถุประสงค์</th><th>หมวด</th>
                <th className="text-right">ยอดเงิน ({!detail.currency || detail.currency === 'THB' ? 'บาท' : detail.currency})</th><th>ใบเสร็จ</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? <tr><td colSpan={7} className="text-center text-gray-500">ไม่มีรายการ</td></tr> : lines.map((l: any) => (
                <tr key={l.id ?? l.lineNo}>
                  <td className="text-gray-500">{l.lineNo}</td>
                  <td className="whitespace-nowrap">{dateShort(l.incurredDate)}</td>
                  <td>{l.description}{l.sourceExpenseSnapshot && <ReimbursementSourceFacts source={l.sourceExpenseSnapshot} formatAmount={(value, currency) => formatMoney(value, typeof currency === 'string' ? currency : undefined)} />}</td>
                  <td className="text-gray-500">{l.purpose ?? ''}</td>
                  <td className="text-gray-500">{categoryText(l.categoryLabelSnapshot)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{amountText(l.amount)}</td>
                  <td className="text-sm">{lineReceipt(l, 'table')}</td>
                </tr>
              ))}
            </tbody>
            {lines.length > 1 && (
              <tfoot>
                <tr className="bg-gray-50 font-medium">
                  <td colSpan={5}>รวมเป็นเงิน</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{amountText(detail.amount)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {(detail.missingReceiptReason || rowHasFinanceReview(detail) || detail.financeReviewedByName || duplicateFact) && (
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-gray-100 pt-3 text-sm" data-testid="reimbursement-claim-facts">
          {detail.missingReceiptReason && <><dt className="text-gray-500">เหตุผลที่ไม่มีใบเสร็จ</dt><dd className="text-gray-900">{detail.missingReceiptReason}</dd></>}
          {/* Only for a claim that is at, or went through, the finance review. A claim with no such step has none to speak of. */}
          {rowHasFinanceReview(detail) && <><dt className="text-gray-500">ตรวจการเงิน</dt><dd className="text-gray-900">{FINANCE_REVIEW_LABELS[detail.financeReviewStatus] ?? 'ยังไม่ระบุ'}</dd></>}
          {detail.financeReviewedByName && <><dt className="text-gray-500">ผู้ตรวจการเงิน</dt><dd className="text-gray-900">{detail.financeReviewedByName}</dd></>}
          {duplicateFact && <><dt className="text-gray-500">ตรวจรายการซ้ำ</dt><dd className="text-gray-900">{duplicateFact}</dd></>}
        </dl>
      )}
    </MangmeeCard>
  );
}

/**
 * The document step offers two ways to finish; the record below keeps the signatures and copies readable.
 * Only the active document step offers signing or an upload. Existing signatures remain visible before payment.
 */
export function ClaimDocuments({ detail, userId, permissions, busy, onOpenAttachment, onSign, onUploadSignedCopy, onUseSignedCopyAsSlip, mode = 'records', print }: Pick<ClaimSectionProps, 'detail' | 'userId' | 'permissions' | 'busy' | 'onOpenAttachment' | 'onSign' | 'onUploadSignedCopy' | 'onUseSignedCopyAsSlip'> & {
  mode?: 'step' | 'records';
  print?: { onPress: () => void; working: boolean };
}) {
  const [pendingCopy, setPendingCopy] = useState<File | null>(null);
  const signatures: any[] = detail.signatures ?? [];
  const signedCopies: any[] = detail.signedCopies ?? [];
  // No approver block where there is no approver: a claim that needed no approval read as finished beside a block
  // "ผู้อนุมัติ · ยังไม่เซ็น" that nobody could ever sign.
  const noApprover = claimHasNoApprover(detail);
  const slots = claimSignatureSlots(detail).filter((role) => role !== 'APPROVER' || !noApprover);
  const signAction = claimSignAction(detail, userId);
  // A4: a declared paper scan signs the ผู้เบิก/ผู้อนุมัติ blocks. Newest first, so this is the copy that counts.
  const digitallySigned = detail.documentSignedVia === 'DIGITAL' || detail.documentSignedVia === 'BOTH';
  const paperSigned = detail.documentSignedVia === 'PAPER' || detail.documentSignedVia === 'BOTH';
  const paperCopy = signedCopies.find((copy: any) => copy.acknowledgedAt);
  const activeDocument = mode === 'step' && detail.status === 'PAID' && !detail.pendingCancellation;
  const approval = (detail.approvalSteps ?? []).filter((row: any) => row.decisionByUserId && isReimbursementClaimApprover(row.decisionByUserId, { submittedAt: detail.submittedAt, approvalSteps: [row] })).at(-1);
  const payment = (detail.payments ?? []).filter((row: any) => row.status === 'RECORDED').at(-1);
  const signerNames: Partial<Record<ClaimSignatureRole, string>> = { REQUESTER: detail.requesterDisplayNameSnapshot, APPROVER: approval?.decidedByName ?? approval?.approverName, FINANCE_REVIEW: detail.financeReviewedByName, PAYER: payment?.paidByName };
  const canAttachSignedCopy = activeDocument && canUploadSignedCopy(detail, userId, permissions);
  const correcting = claimInPayoutCorrection(detail);
  const slipTarget = slipTargetPayment(detail, permissions);
  const misfiledHint = signedCopyMisfiledHint(detail, permissions);
  if (!detail.requestNo || (mode === 'step' && !activeDocument)) return null;
  if (!activeDocument && detail.status !== 'PAID' && signatures.length === 0 && signedCopies.length === 0) return null;
  // While the step card offers the signing and nothing is signed or attached yet, a record card would only repeat it.
  if (mode === 'records' && detail.status === 'PAID' && !detail.pendingCancellation && signatures.length === 0 && signedCopies.length === 0) return null;
  const Frame = activeDocument ? 'div' : MangmeeCard;
  return (
    <>
      <div id={activeDocument ? undefined : 'reimbursement-signatures'} className="scroll-mt-24">
        <Frame className={activeDocument ? 'space-y-3' : 'p-4'}>
          {activeDocument ? <p className="text-sm text-gray-600">{digitallySigned ? 'เซ็นในระบบครบแล้ว' : 'เลือกวิธีใดวิธีหนึ่ง'}</p>
            : <h2 className="mb-2 text-sm font-bold text-gray-900">ลายเซ็นและใบเบิกที่เซ็นแล้ว</h2>}
          <div className={activeDocument && !digitallySigned ? 'grid gap-6 sm:grid-cols-2' : undefined}>
          <div className="min-w-0">
          {activeDocument && <h3 className="mb-3 font-semibold text-gray-900">เซ็นในระบบ</h3>}
          <div className={cx('grid gap-x-4 gap-y-3', slots.length > 1 && 'grid-cols-2', slots.length > 2 && 'sm:grid-cols-4')}>
            {slots.map(role => {
              const signed = signatures.find((s: any) => s.role === role);
              return (
                // min-w-0 + break-words: a long value must wrap inside its own cell — on a
                // narrow grid an unbroken string overflowed the card and sat on top of the
                // neighbouring slot, swallowing its taps. (A cell of the grid, not a box inside the card.)
                <div key={role} className="min-w-0 text-sm">
                  <div className="text-gray-500">{CLAIM_SIGNATURE_ROLE_LABELS[role]}</div>
                  <div className="mt-1">
                    {signed ? (
                      <>
                        <MangmeeBadge tone="brand">เซ็นแล้ว</MangmeeBadge>
                        {/* A missing name never exposes the user id. */}
                        <div className="mt-2 break-words text-gray-600">{signed.signedByName ?? 'ยังไม่ระบุ'}</div>
                        <div className="text-gray-500">{dateShort(signed.signedAt)}</div>
                      </>
                    ) : paperSigned && (role === 'REQUESTER' || role === 'APPROVER') ? (
                      <>
                        <MangmeeBadge tone="brand">เซ็นบนกระดาษ</MangmeeBadge>
                        {paperCopy && (
                          <button type="button" className="mt-1 block min-h-11 min-w-11 text-left text-brand-700 underline decoration-1 underline-offset-4 hover:decoration-2"
                            onClick={() => onOpenAttachment(paperCopy.attachmentId, paperCopy.fileName)}>
                            ดูสำเนา
                          </button>
                        )}
                      </>
                    ) : <><MangmeeBadge tone="slate">รอเซ็น</MangmeeBadge>{signerNames[role] && <p className="mt-2 break-words text-gray-600">{signerNames[role]}</p>}</>}
                  </div>
                </div>
              );
            })}
          </div>
          {noApprover && <p className="mt-3 text-sm text-gray-600">ใบนี้ไม่ต้องอนุมัติตามนโยบาย จึงมีเฉพาะลายเซ็นของผู้เบิก</p>}
          {slots.length === 2 && claimSelfApproved(detail) && (
            <p className="mt-3 text-sm text-gray-600">{REIMBURSEMENT_SELF_APPROVED_NOTE}</p>
          )}
          {correcting && <p className="mt-3 text-sm text-gray-600">{signingWaitsForRound(detail)}</p>}
          {/* One tap signs every block this viewer really acted on; the server re-checks each role. */}
          {activeDocument && signAction && (
            <ActionGroup align="start" className="mt-3">
              <button type="button" className={btnClass} disabled={busy} aria-busy={Boolean(busy)}
                onClick={() => onSign(signAction.roles)}>
                {signAction.label}
              </button>
            </ActionGroup>
          )}
          </div>
          {activeDocument && !digitallySigned && <div className="min-w-0 space-y-3">
            <h3 className="font-semibold text-gray-900">เซ็นบนกระดาษ</h3>
            <ol className="list-decimal space-y-3 pl-5 text-sm text-gray-700">
              <li>{print ? <ActionGroup align="start"><button type="button" className={ghostClass} disabled={busy} aria-busy={Boolean(busy)} onClick={print.onPress}>พิมพ์ใบเบิก</button></ActionGroup> : 'พิมพ์ใบเบิก'}</li>
              <li>{noApprover ? 'ให้ผู้เบิกเซ็น' : 'ให้ผู้เบิกและผู้อนุมัติเซ็น'}</li>
              <li>
                <p>ถ่ายรูปหรือสแกน แล้วแนบที่นี่</p>
                {canAttachSignedCopy && <div className="mt-2">
                  <ThemedFile file={null} labels={{ pick: 'แนบใบที่เซ็นแล้ว' }} aria-label="แนบใบที่เซ็นแล้ว" accept={ATTACHMENT_UPLOAD_ACCEPT} disabled={busy} loading={Boolean(busy)} onChange={file => { if (file) setPendingCopy(file); }} />
                  <p className="mt-1.5 text-gray-500">{SIGNED_COPY_NOT_FOR_SLIPS}</p>
                </div>}
              </li>
            </ol>
          </div>}
          </div>
          {activeDocument && digitallySigned && print && <ActionGroup align="start">
            <button type="button" className={ghostClass} disabled={busy || print.working} aria-busy={Boolean(busy || print.working)} onClick={print.onPress}>พิมพ์ใบเบิก</button>
          </ActionGroup>}
          {!activeDocument && <div id="reimbursement-signed-copies" className="mt-4 scroll-mt-24 space-y-2">
          <p className="text-sm font-semibold text-gray-700">ไฟล์ที่แนบกลับ ({signedCopies.length})</p>
          {signedCopies.length === 0
            ? <p className="text-sm text-gray-500">ยังไม่มีไฟล์ที่แนบกลับ</p>
            : (
              <ul className="divide-y divide-gray-100 text-sm">
                {/* Attaching again never deletes: the newest declared scan counts, older ones stay viewable. */}
                {signedCopies.map((copy: any) => (
                  <li key={copy.attachmentId} className="min-w-0 py-2 first:pt-0 last:pb-0">
                    <button type="button" className="block min-h-11 max-w-full truncate text-brand-700 hover:underline" onClick={() => onOpenAttachment(copy.attachmentId, copy.fileName)}>📄 {copy.fileName}</button>
                    {/* A scan declared as signed before a correction round showed the account that was then corrected. */}
                    {/* What the file is, before anyone opens it: a picture or a PDF, then what it was attached as. */}
                    <div className="break-words text-gray-500">
                      {`${attachedFileKindText(copy.fileName)} · ${copy.beforePayoutCorrection ? `${SIGNED_COPY_BEFORE_CORRECTION_LABEL} · ไม่นับว่าเซ็นแล้ว · แนบเมื่อ ${dateShort(copy.uploadedAt)}`
                        : copy.acknowledgedAt ? paperSignedLine(copy) : `ไฟล์แนบทั่วไป · แนบเมื่อ ${dateShort(copy.uploadedAt)}`}`}
                    </div>
                    {/* A slip attached here by mistake, where the row has no button of its own: what to do about it, for whoever pays. */}
                    {misfiledHint && <div className="mt-1 break-words text-gray-500" data-testid="reimbursement-signed-copy-misfiled-hint">{misfiledHint}</div>}
                    {/* A slip attached here by mistake moves to the payment without being uploaded again (spec §16). */}
                    {slipTarget && (
                      <button type="button" className="mt-1 min-h-11 text-left text-brand-700 underline decoration-1 underline-offset-4 hover:decoration-2 disabled:opacity-50"
                        disabled={busy} aria-busy={Boolean(busy)} onClick={() => onUseSignedCopyAsSlip(copy, slipTarget)}>
                        ใช้ไฟล์นี้เป็นหลักฐานการจ่าย
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>}
        </Frame>
        {pendingCopy && (
          <SignedCopyDialog
            requestNo={detail.requestNo}
            detail={detail}
            fileName={pendingCopy.name}
            {...(correcting && { waitsForRound: signingWaitsForRound(detail) })}
            onClose={() => setPendingCopy(null)}
            onSend={(declared) => { onUploadSignedCopy(pendingCopy, declared ? detail.requestNo : undefined); setPendingCopy(null); }}
          />
        )}
      </div>
    </>
  );
}

/** The payments recorded for the claim, each with its slips and, for whoever may, the way to take it back. */
export function ClaimPayments({ detail, permissions, busy, onRequestVoidPayment, onOpenPaymentSlip, onAttachPaymentSlip }: Pick<ClaimSectionProps, 'detail' | 'permissions' | 'busy' | 'onRequestVoidPayment' | 'onOpenPaymentSlip' | 'onAttachPaymentSlip'>) {
  const [attachingPayment, setAttachingPayment] = useState<any>(null);
  if (!(detail.payments?.length > 0)) return null;
  return (
    <MangmeeCard className="p-4">
      <h2 className="mb-2 text-sm font-bold text-gray-900">การจ่ายเงิน</h2>
      {/* One row per payment with a line between: a payment is not a box inside this card. */}
      <ul className="divide-y divide-gray-100">
        {detail.payments.map((p: any) => {
          // Every fact on this row comes from the one payment record. Everyone is told how many slips it
          // carries; the files themselves are listed only for a viewer who may open them.
          const slips: any[] = p.slips ?? [];
          const slipCount = paymentSlipCount(p);
          // The API's own verdict for this viewer, from the rule its slip endpoint enforces: ดูหลักฐานการจ่าย is
          // never worked out here from the session's permissions, so it cannot be offered and then refused.
          const canOpenSlip = p.viewerCanOpenSlips === true;
          const slipName = `${p.status === 'VOIDED' ? 'หลักฐานการจ่ายที่ยกเลิกแล้ว' : 'หลักฐานการจ่าย'} ${p.paymentNo ?? ''}`.trim();
          return (
          <li key={p.id} className="min-w-0 py-3 text-sm text-gray-600 first:pt-0 last:pb-0" data-testid="reimbursement-payment-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="mangmee-unit font-semibold text-gray-700">{p.paymentNo}</span>
              <span className="mangmee-unit font-semibold text-gray-900">{formatMoney(p.paidAmount, p.currency)}</span>
            </div>
            <p className="mt-1 text-gray-500">{p.status === 'RECORDED' ? 'บันทึกแล้ว' : p.status === 'VOIDED' ? PAYMENT_VOIDED_LABEL : 'สถานะการจ่าย'}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              <div><dt className="text-gray-500">วิธีจ่าย</dt><dd className="mt-1 text-gray-900">{PAYMENT_METHOD_LABELS[p.paymentMethod] ?? 'ยังไม่ระบุ'}</dd></div>
              <div><dt className="text-gray-500">วันที่จ่าย</dt><dd className="mt-1 text-gray-900">{dateShort(p.paidAt)}</dd></div>
              {p.paymentReference && <div><dt className="text-gray-500">{REIMBURSEMENT_PAYMENT_REFERENCE_TEXT.neutralLabel}</dt><dd className="mt-1 break-words text-gray-900">{p.paymentReference}</dd></div>}
              {(paymentDestinationText(p) || p.paymentMethod === 'BANK_TRANSFER') && <div className="col-span-2 min-w-0">
                <dt className="text-gray-500">บัญชีปลายทาง</dt>
                <dd className="mt-1 break-words text-gray-900">
                  {paymentDestinationText(p) ?? PAYMENT_NO_CLAIM_ACCOUNT}
                  {p.payoutConfirmedAt && <p className="mt-1 text-gray-500">ยืนยันเมื่อ {formatThaiDateTime(p.payoutConfirmedAt)}</p>}
                  <PayoutHolderNotice account={p.payoutDestination} />
                </dd>
              </div>}
              {p.paidByName && <div><dt className="text-gray-500">จ่ายโดย</dt><dd className="mt-1 text-gray-900">{p.paidByName}</dd></div>}
              <div><dt className="text-gray-500">หลักฐาน</dt><dd className="mt-1">
                {slipCount > 0 ? <>
                  <div>{p.status === 'VOIDED' ? 'หลักฐานการจ่ายที่ยกเลิกแล้ว' : 'มีหลักฐานการจ่ายแนบ'} {slipCount} ไฟล์</div>
                  {canOpenSlip && <div className="flex flex-wrap gap-x-4">
                    {slips.map((slip: any, index: number) => {
                      const label = slips.length > 1 ? `ดูหลักฐานการจ่าย ${index + 1}` : 'ดูหลักฐานการจ่าย';
                      return <button key={slip.attachmentId} type="button" className="min-h-11 min-w-11 text-left text-brand-700 underline decoration-1 underline-offset-4 hover:decoration-2 disabled:opacity-50"
                        disabled={busy} aria-busy={Boolean(busy)} onClick={() => onOpenPaymentSlip(p, slip.attachmentId, slips.length > 1 ? `${slipName} (${index + 1})` : slipName)}>
                        {label}
                      </button>;
                    })}
                  </div>}
                </> : 'ไม่มีหลักฐานการจ่ายแนบ'}
              </dd></div>
            </dl>
            {p.methodMismatchReason && (
              <div className="mt-3 break-words text-gray-600">
                <MangmeeBadge tone="amber">{PAID_DIFFERENTLY_LABEL}</MangmeeBadge>
                <span className="ml-2">เหตุผล: {p.methodMismatchReason}</span>
              </div>
            )}
            {p.status === 'VOIDED' && p.voidReason && <div className="mt-1 text-error-700">เหตุผลที่ยกเลิก: {p.voidReason}</div>}
            {(canAttachPaymentSlip(p, permissions) || canVoidRecordedPayment(p, permissions)) && (
              <div className="mt-3">
                <MoreActions label="เพิ่มเติม" closeOnPress busy={busy}>
                  {canAttachPaymentSlip(p, permissions) && <button type="button" className={ghostClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => setAttachingPayment(p)}>แนบหลักฐานการจ่ายเพิ่ม</button>}
                  {canVoidRecordedPayment(p, permissions) && <button type="button" className={dangerClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => onRequestVoidPayment(p)}>
                    ยกเลิกรายการจ่ายนี้
                  </button>}
                </MoreActions>
              </div>
            )}
          </li>
          );
        })}
      </ul>
      {attachingPayment && <Modal open title={`แนบหลักฐานการจ่ายเพิ่ม ${attachingPayment.paymentNo ?? ''}`.trim()} onClose={() => setAttachingPayment(null)}
        footer={<button type="button" className={ghostClass} onClick={() => setAttachingPayment(null)}>ปิด</button>}>
        <ThemedFile file={null} accept={RECEIPT_UPLOAD_ACCEPT} aria-label="แนบหลักฐานการจ่ายเพิ่ม" disabled={busy} loading={Boolean(busy)}
          onChange={file => { if (file) { onAttachPaymentSlip(attachingPayment, file); setAttachingPayment(null); } }} />
      </Modal>}
    </MangmeeCard>
  );
}

/**
 * What happened to the claim so far, behind one disclosure: the header, the step strip and the step card already say
 * where it stands now, so the past is one press away and never three tellings on one screen. The rounds of approval
 * keep their own list under the journey: a refusal's reason and an approver's comment are read there.
 */
export function ClaimHistory({ detail, defaultOpen = false }: { detail: any; defaultOpen?: boolean }) {
  const timeline = buildClaimTimeline(detail);
  return (
    <details className="mangmee-card group p-4" open={defaultOpen || undefined} data-testid="reimbursement-history">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-gray-900 [&::-webkit-details-marker]:hidden">
        ประวัติใบเบิก
        <DisclosureChevron />
      </summary>
      <ol className="mt-2 space-y-2" data-testid="reimbursement-timeline">
        {timeline.map(step => (
          <li key={step.key} className="flex items-start gap-2 text-sm">
            <span aria-hidden className={cx('shrink-0', step.state === 'done' ? 'text-brand-600' : step.state === 'current' ? 'text-amber-600' : 'text-gray-300')}>
              {step.state === 'done' ? '✓' : step.state === 'current' ? '●' : '○'}
            </span>
            <span className={cx('min-w-0 flex-1', step.state === 'current' ? 'font-semibold text-gray-900' : step.state === 'done' ? 'text-gray-700' : 'text-gray-500')}>
              {step.label}
            </span>
            {step.date && <span className="mangmee-unit shrink-0 text-sm text-gray-500">{timelineDateText(timeline, step)}</span>}
          </li>
        ))}
      </ol>
      {detail.approvalSteps?.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <h3 className="mb-2 text-sm font-bold text-gray-900">ขั้นตอนอนุมัติ</h3>
          <ul className="divide-y divide-gray-100">
            {detail.approvalSteps.map((s: any) => (
              <li key={s.id} className="py-2.5 text-sm text-gray-600 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-gray-700">ขั้นที่ {s.sequenceNo}</span>
                  {/* An approval a correction round set aside is history: it keeps its words and loses the colour of one in force. */}
                  <MangmeeBadge tone={approvalStepCorrectionNote(s) ? 'slate' : s.status === 'APPROVED' ? 'brand' : s.status === 'REJECTED' ? 'danger' : 'slate'}>
                    {APPROVAL_STEP_STATUS_LABELS[s.status] ?? 'ยังไม่ระบุ'}
                  </MangmeeBadge>
                </div>
                {/* Who decided, or who is asked. A round nobody decided and that names nobody says only its status: a dash said nothing. */}
                {(s.decidedByName || (s.id === detail.currentApprovalStepId && s.status === 'PENDING') || s.approverName) && (
                  <div className="mt-1">{s.decidedByName ? `โดย ${s.decidedByName}` : s.id === detail.currentApprovalStepId && s.status === 'PENDING'
                    ? `ผู้อนุมัติ: ${currentDeskText(detail.currentDesk) ?? CURRENT_DESK_LABELS.APPROVER}`
                    : `ผู้อนุมัติ: ${s.approverName}`}</div>
                )}
                {approvalStepCorrectionNote(s) && <div className="mt-1 text-gray-500">{approvalStepCorrectionNote(s)}</div>}
                {s.comment && <div className="mt-1 text-gray-500">{s.comment}</div>}
                {s.rejectionReason && <div className="mt-1 text-error-700">{s.rejectionReason}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

/**
 * Every part of a claim below its summary, in the order the claim page shows them when it has one column: the lines
 * with their evidence, the document, the payments, the history. The claim page places the parts itself (the step card
 * sits between the lines and the rest); this is the whole of them for a host that wants one block.
 * Every write control repeats its own actor/permission/state check; the server re-checks.
 */
export function ClaimDetailSections(props: ClaimSectionProps) {
  return (
    <>
      <ClaimLines {...props} />
      <ClaimDocuments {...props} />
      <ClaimPayments {...props} />
      <ClaimHistory detail={props.detail} />
    </>
  );
}
