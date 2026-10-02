'use client';

// The payout account correction round on the claim page (payout spec §14): the send-back form of whoever
// may send the claim back, the account form of its requester, and the comparison its approvers are shown.
// Both forms open inside the step card, never in a dialog, the way the payment form does on a phone. Each
// makes its own call and, when the API refuses, says so in its own banner and keeps what was typed. A refusal
// because the claim moved on (409) also has the page read the claim again, so what is under the form is true.

import { useEffect, useRef, useState } from 'react';
import { REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH, type ReimbursementPayoutCorrectionReason } from '@watchdog-bms/contracts';
import { cx } from '@/common/components/mangmee';
import { sanitizeReasonInput } from '@/common/forms/sanitize';
import { ErrorBanner, btnClass, ghostClass, inputClass } from '../expenses/ExpensesUi';
import { requestReimbursementPayoutCorrection, submitReimbursementPayoutCorrection } from './reimbursements.api';
import { errorText, payoutCorrectionComparison } from './reimbursements.logic';
import { getMemberPayoutAccount, getMyPayoutAccount } from './reimbursement-payout.api';
import { PayoutAccountFields, choiceClass, labelClass } from './ReimbursementPayout';
import {
  PAYOUT_CORRECTION_FIX_LABEL, PAYOUT_CORRECTION_PREVIOUS_LABEL, PAYOUT_CORRECTION_REASONS, PAYOUT_CORRECTION_REREAD_NOTE, PAYOUT_CORRECTION_SEND_BACK_AGAIN_LABEL,
  PAYOUT_CORRECTION_SEND_BACK_LABEL, PAYOUT_CORRECTION_TYPING_REFUSED, PAYOUT_METHOD_TEXT,
  isClaimChangedRefusal, isClaimStateConflict, isRequesterNotActiveRefusal,
  emptyPayoutCorrectionForm, payoutAccountWithName, payoutCorrectionAccountText, payoutCorrectionFormError, payoutCorrectionInput, payoutCorrectionPreviousAccount,
  payoutCorrectionRequestError, payoutCorrectionRequestInput, payoutCorrectionSendBackNotes, type PayoutCorrectionForm,
} from './reimbursement-payout.logic';

/**
 * The heading of a form that has just opened inside the step card takes focus. The button that opened the form
 * is gone by then, so a keyboard or a screen reader would otherwise be left nowhere, and on a phone the focus
 * brings the form into view.
 */
function useFocusOnOpen() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return heading;
}

/**
 * What a form says when the API refuses it. A refusal because the claim moved on has the page read the claim again
 * (`onConflict` answers whether this form is still offered after that); the banner then says the page is up to date.
 */
async function refusalText(e: unknown, onConflict: () => Promise<boolean>): Promise<string> {
  return isClaimStateConflict(e) && await onConflict() ? `${errorText(e)} · ${PAYOUT_CORRECTION_REREAD_NOTE}` : errorText(e);
}

/**
 * "ส่งกลับให้แก้บัญชีรับเงิน": a reason from the fixed list and an optional note (spec §14.3). The same form
 * sends a claim back again from the step a round waits on, which is how its approvers refuse a new account.
 */
export function PayoutCorrectionRequestForm({ companyId, detail, onCancel, onDone, onConflict }: {
  companyId: string;
  detail: any;
  onCancel: () => void;
  /** The claim moved on (409): the page reads it again, and answers whether this form is still offered. */
  onConflict: () => Promise<boolean>;
  /** The claim detail the API answered with: the claim is with its requester now. */
  onDone: (claim: any) => void;
}) {
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A second press before the first has answered does nothing: one send-back, one request.
  const sending = useRef(false);
  const heading = useFocusOnOpen();
  const again = detail.payoutCorrectionPhase === 'AWAITING_APPROVAL';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    const invalid = payoutCorrectionRequestError(reasonCode, note);
    if (invalid) { setError(invalid); return; }
    sending.current = true; setBusy(true); setError(null);
    try {
      onDone(await requestReimbursementPayoutCorrection(companyId, detail.id, payoutCorrectionRequestInput(reasonCode as ReimbursementPayoutCorrectionReason, note)));
    } catch (e) {
      // A lost race or a refusal: the sentence is shown here, and the reason and note stay as typed.
      setError(await refusalText(e, onConflict));
    } finally { sending.current = false; setBusy(false); }
  };

  return (
    <form className="space-y-3 [overflow-wrap:anywhere]" onSubmit={submit} noValidate data-testid="reimbursement-payout-correction-request">
      <div>
        <h3 ref={heading} tabIndex={-1} className="text-sm font-bold text-gray-900 outline-none">{again ? PAYOUT_CORRECTION_SEND_BACK_AGAIN_LABEL : PAYOUT_CORRECTION_SEND_BACK_LABEL}</h3>
        <ul className="mt-1 space-y-1 text-sm text-gray-600">
          {payoutCorrectionSendBackNotes(detail).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>
      <div>
        <div className={labelClass}>เหตุผลที่ส่งกลับ *</div>
        <div role="radiogroup" aria-label="เหตุผลที่ส่งกลับ" aria-required className="grid gap-2 sm:grid-cols-2">
          {PAYOUT_CORRECTION_REASONS.map(([code, label]) => (
            <label key={code} className={cx(choiceClass, reasonCode === code && 'border-brand-300 bg-brand-25')}>
              <input type="radio" name="payout-correction-reason" className="mt-0.5 h-5 w-5 shrink-0" checked={reasonCode === code} disabled={busy}
                onChange={() => { setReasonCode(code); setError(null); }} />
              <span className="min-w-0">{label}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="reimbursement-payout-correction-note">หมายเหตุ (ไม่บังคับ)</label>
        <textarea id="reimbursement-payout-correction-note" className={cx(inputClass, 'min-h-20 resize-y')} maxLength={REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH}
          disabled={busy} value={note} onChange={(event) => { setNote(sanitizeReasonInput(event.target.value)); setError(null); }}
          placeholder="เช่น ธนาคารแจ้งว่าไม่พบบัญชีนี้" />
        <div className="mt-1 flex justify-between gap-3 text-xs leading-5 text-gray-500">
          <span className="min-w-0">ผู้เบิกและทุกคนที่เปิดใบนี้เห็นหมายเหตุนี้ อย่าพิมพ์เลขบัญชี</span>
          <span className="shrink-0 tabular-nums">{note.length}/{REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH}</span>
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={cx(ghostClass, 'w-full sm:w-auto')} disabled={busy} onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className={cx(btnClass, 'w-full sm:w-auto')} disabled={busy} aria-busy={busy}>{busy ? 'กำลังส่งกลับ...' : 'ยืนยันส่งกลับ'}</button>
      </div>
    </form>
  );
}

/**
 * "แก้บัญชีรับเงิน": the account a claim in a round is to be paid into (spec §14.5), from its requester or from
 * a finance reviewer on their behalf. The three choices of a draft: the requester's default account as the
 * server shows it now, an account typed for this claim, or cash. And one a draft has no use for: the account
 * the claim was approved with, kept as it is, for a claim that was sent back by mistake. Nothing is chosen for
 * them: the account that was sent back may well be their default.
 */
export function PayoutCorrectionAccountForm({ companyId, detail, userId, canEditEmployees, onCancel, onDone, onConflict }: {
  companyId: string;
  detail: any;
  userId: string;
  /** The session may edit employee data: only then is the server asked whether this viewer may set the requester's default. */
  canEditEmployees: boolean;
  onCancel: () => void;
  /**
   * The claim moved on (409): the page reads it again, and answers whether this form stays open. `claimChanged`:
   * the claim is no longer the one this form was opened on, so what it holds is not sent again as it is.
   */
  onConflict: (claimChanged: boolean) => Promise<boolean>;
  /** The claim detail the API answered with: waiting for its approvers, or ready for payment at once. */
  onDone: (claim: any) => void;
}) {
  const forSelf = detail.requesterUserId === userId;
  const [form, setForm] = useState<PayoutCorrectionForm>(emptyPayoutCorrectionForm);
  // "บันทึกเป็นบัญชีประจำ" is offered exactly where the server says the save would go through for this viewer.
  const [canSaveAsDefault, setCanSaveAsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // Typing an account for a requester who is no longer an active member is the server's to refuse, and it says so
  // only when asked: once it has, that choice is not offered again and the form says why.
  const [typing, setTyping] = useState<'offered' | 'refused'>('offered');
  const sending = useRef(false);
  const heading = useFocusOnOpen();
  // The requester's default account as it is now, masked, with the token that names it. Cash as a default is
  // the cash choice below, so only a default that is an account is offered as one.
  const requesterDefault = detail.payoutCorrectionActions?.requesterDefault;
  const defaultAccount = requesterDefault?.payoutMethod === 'BANK_TRANSFER' ? requesterDefault : undefined;
  const previousAccount = payoutCorrectionPreviousAccount(detail);
  const requesterUserId: string = detail.requesterUserId;

  useEffect(() => {
    if (!forSelf && !canEditEmployees) return;
    let active = true;
    void (forSelf ? getMyPayoutAccount(companyId) : getMemberPayoutAccount(companyId, requesterUserId))
      .then((response) => { if (active) setCanSaveAsDefault(response.canEdit === true); })
      // Without the answer the tick is simply not offered; the three choices still work.
      .catch(() => undefined);
    return () => { active = false; };
  }, [companyId, forSelf, canEditEmployees, requesterUserId]);

  const change = (patch: Partial<PayoutCorrectionForm>) => { setForm((current) => ({ ...current, ...patch })); setError(null); setInvalidField(undefined); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    const invalid = payoutCorrectionFormError(form);
    // With the claim the form was opened on (`updatedAt`): a press that arrives after an earlier one was taken is refused.
    const input = invalid ? null : payoutCorrectionInput(form, defaultAccount?.token, canSaveAsDefault, detail.updatedAt);
    if (invalid || !input) { setError(invalid?.text ?? 'กรุณาเลือกวิธีรับเงินคืนของใบนี้'); setInvalidField(invalid?.field); return; }
    sending.current = true; setBusy(true); setError(null); setInvalidField(undefined);
    try {
      onDone(await submitReimbursementPayoutCorrection(companyId, detail.id, input));
    } catch (e) {
      // Not a claim that moved on: the claim is as it was, and what is left to choose from is on the form.
      if (isRequesterNotActiveRefusal(e)) { setTyping('refused'); setForm((current) => ({ ...current, mode: '' })); return; }
      // The account stays as typed: a refusal for one field is fixed and sent again without typing the rest.
      setError(await refusalText(e, () => onConflict(isClaimChangedRefusal(e))));
    } finally { sending.current = false; setBusy(false); }
  };

  const option = (mode: PayoutCorrectionForm['mode'], label: string, hint?: string | null) => (
    <label className={cx(choiceClass, form.mode === mode && 'border-brand-300 bg-brand-25')}>
      <input type="radio" name="payout-correction-mode" className="mt-0.5 h-5 w-5 shrink-0" checked={form.mode === mode} disabled={busy}
        onChange={() => change({ mode })} />
      <span className="min-w-0">
        <span className="block font-semibold text-gray-900">{label}</span>
        {hint && <span className="mt-0.5 block break-words text-xs text-gray-500">{hint}</span>}
      </span>
    </label>
  );

  return (
    <form className="space-y-3 [overflow-wrap:anywhere]" onSubmit={submit} noValidate data-testid="reimbursement-payout-correction-account">
      <div>
        <h3 ref={heading} tabIndex={-1} className="text-sm font-bold text-gray-900 outline-none">{forSelf ? PAYOUT_CORRECTION_FIX_LABEL : `${PAYOUT_CORRECTION_FIX_LABEL}แทนผู้เบิก`}</h3>
        <p className="mt-1 text-sm text-gray-600">เลือกวิธีรับเงินคืนของใบนี้ใหม่ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน</p>
      </div>
      <div role="radiogroup" aria-label="รับเงินคืนทาง" aria-required className="space-y-2">
        {defaultAccount && option('DEFAULT', forSelf ? 'ใช้บัญชีรับเงินคืนประจำของฉัน' : 'ใช้บัญชีรับเงินคืนประจำของผู้เบิก', payoutAccountWithName(defaultAccount))}
        {option('CASH', PAYOUT_METHOD_TEXT.CASH!)}
        {typing === 'offered' && option('SPECIFIED', 'ระบุบัญชีสำหรับใบนี้', forSelf ? null : 'กรอกบัญชีของผู้เบิก หลังบันทึกคุณจะเห็นเฉพาะ 4 ตัวท้าย และผู้เบิกจะได้รับแจ้งเตือน')}
        {previousAccount && option('PREVIOUS', PAYOUT_CORRECTION_PREVIOUS_LABEL, `${payoutCorrectionAccountText(previousAccount)} · เลือกเมื่อตรวจแล้วว่าบัญชีนี้ถูกต้อง`)}
      </div>
      {typing === 'refused' && <ErrorBanner message={PAYOUT_CORRECTION_TYPING_REFUSED} />}
      {form.mode === 'SPECIFIED' && typing === 'offered' && (
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <PayoutAccountFields value={form.account} onChange={(account) => change({ account })} disabled={busy} invalidField={invalidField} />
          {canSaveAsDefault && (
            <label className="flex min-h-11 items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={form.saveAsDefault} disabled={busy}
                onChange={(event) => change({ saveAsDefault: event.target.checked })} />
              <span>{forSelf ? 'บันทึกเป็นบัญชีประจำของฉัน' : 'บันทึกเป็นบัญชีประจำของผู้เบิก'}</span>
            </label>
          )}
        </div>
      )}
      <p className="text-xs leading-5 text-gray-500">
        {detail.payoutCorrectionPhase === 'AWAITING_APPROVAL'
          ? 'เมื่อบันทึกแล้ว บัญชีที่ส่งไปก่อนหน้าจะถูกแทนที่ และผู้อนุมัติจะตรวจบัญชีใหม่นี้แทน'
          : 'เมื่อบันทึกแล้ว ใบจะส่งให้ผู้อนุมัติชุดเดิมอนุมัติบัญชีใหม่ก่อนจ่าย ถ้าใบนี้ไม่ต้องอนุมัติตามนโยบาย ใบจะกลับไปรอจ่ายทันที'}
      </p>
      {error && <ErrorBanner message={error} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={cx(ghostClass, 'w-full sm:w-auto')} disabled={busy} onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className={cx(btnClass, 'w-full sm:w-auto')} disabled={busy} aria-busy={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึกบัญชีรับเงิน'}</button>
      </div>
    </form>
  );
}

/**
 * "สิ่งที่เปลี่ยน: บัญชีรับเงินคืน" (spec §14.6): what a round's approvers approve. The account the claim was
 * approved with beside the one it has now, last 4 digits only, why it was sent back, and that the lines and
 * the amount are what was approved. Shown to every reader of a claim whose new account waits for approval.
 */
export function PayoutCorrectionComparison({ detail }: { detail: any }) {
  const view = payoutCorrectionComparison(detail);
  if (!view) return null;
  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 [overflow-wrap:anywhere]" data-testid="reimbursement-payout-correction-comparison">
      <h3 className="text-sm font-bold text-gray-900">สิ่งที่เปลี่ยน: บัญชีรับเงินคืน</h3>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-gray-600">บัญชีเดิม</dt>
          <dd className="mt-1 break-words text-sm text-gray-700">{view.previous}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-gray-600">บัญชีใหม่</dt>
          <dd className="mt-1 break-words text-sm font-semibold text-gray-900">{view.current}</dd>
        </div>
      </dl>
      <p className="text-sm text-gray-700">{view.unchanged}</p>
      <ul className="space-y-1 text-xs text-gray-600">
        <li>{view.sentBack}</li>
        {view.note && <li>หมายเหตุ: {view.note}</li>}
        {view.submitted && <li>{view.submitted}</li>}
      </ul>
    </div>
  );
}
