'use client';

// The payout account correction round on the claim page (payout spec §14): the send-back form of whoever
// may send the claim back, the account form of its requester, and the comparison its approvers are shown.
// Both forms open inside the step card, never in a dialog, the way the payment form does on a phone. Each
// makes its own call and, when the API refuses, says so in its own banner and keeps what was typed. A refusal
// because the claim moved on (409) also has the page read the claim again, so what is under the form is true.

import { useEffect, useRef, useState } from 'react';
import { REIMBURSEMENT_SAVED_PAYOUT_WORDS as SAVED_WORDS, REIMBURSEMENT_PAYOUT_HOLDER_WORDS as HOLDER_WORDS, type SavedPayoutAccountSummary, reimbursementDuplicateBlockNotice, REIMBURSEMENT_PAYOUT_TYPING_ON_BEHALF_NOTE, REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH, type ReimbursementPayoutCorrectionReason } from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';
import { LoadingState, ErrorState } from '@/common/components/state';
import { cx } from '@/common/components/mangmee';
import { sanitizeReasonInput } from '@/common/forms/sanitize';
import { ErrorBanner, btnClass, ghostClass, inputClass } from '../expenses/ExpensesUi';
import { requestReimbursementPayoutCorrection, submitReimbursementPayoutCorrection } from './reimbursements.api';
import { errorText, payoutCorrectionComparison } from './reimbursements.logic';
import { getMySavedPayoutAccounts, getMemberPayoutAccount, getMyPayoutAccount } from './reimbursement-payout.api';
import { SavedPayoutAccountOption, PayoutHolderNotice, PayoutHolderFields, PayoutAccountFields, choiceClass, labelClass } from './ReimbursementPayout';
import {
  PAYOUT_CORRECTION_ON_BEHALF_NOTICE, PAYOUT_CORRECTION_PREVIOUS_LABEL, PAYOUT_CORRECTION_REREAD_NOTE, PAYOUT_CORRECTION_SAVE_LABEL,
  PAYOUT_CORRECTION_TYPING_REFUSED, PAYOUT_METHOD_TEXT,
  claimPayoutSavedRefusal, setClaimPayoutHolder, setClaimPayoutSaving, isClaimChangedRefusal, isClaimStateConflict, isRequesterNotActiveRefusal,
  emptyPayoutCorrectionForm, payoutAccountWithName, payoutCorrectionAccountText, payoutCorrectionAnswerWords, payoutCorrectionFormError, payoutCorrectionInput, payoutCorrectionPreviousAccount,
  payoutCorrectionOffers, payoutCorrectionReasons, payoutCorrectionRequestError, payoutCorrectionRequestInput, payoutCorrectionSendBackNotes, payoutCorrectionSendBackTitle,
  payoutCorrectionTypingRefusedUpFront, payoutRoundTexts, type PayoutCorrectionForm,
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
 * The send-back: a reason from the fixed list and an optional note (spec §14.3). The same form sends a claim back again
 * from the step a round waits on, which is how its approvers do not take what was answered. Its title, what it says
 * will happen, the reasons it lists and the note's hint all follow what the claim holds: an account to correct, cash
 * to choose again, or none yet. A claim with no account is sent back for that one reason, so the form says the reason
 * and asks for none.
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
  const reasons = payoutCorrectionReasons(detail);
  // One reason only (a claim with no account of its own): it is what the form sends, said and not asked.
  const onlyReason = reasons.length === 1 ? reasons[0] : undefined;
  const chosen = onlyReason?.[0] ?? reasonCode;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    const invalid = payoutCorrectionRequestError(chosen, note);
    if (invalid) { setError(invalid); return; }
    sending.current = true; setBusy(true); setError(null);
    try {
      onDone(await requestReimbursementPayoutCorrection(companyId, detail.id, payoutCorrectionRequestInput(chosen as ReimbursementPayoutCorrectionReason, note)));
    } catch (e) {
      // A lost race or a refusal: the sentence is shown here, and the reason and note stay as typed.
      setError(await refusalText(e, onConflict));
    } finally { sending.current = false; setBusy(false); }
  };

  return (
    <form className="space-y-3 [overflow-wrap:anywhere]" onSubmit={submit} noValidate data-testid="reimbursement-payout-correction-request">
      <div>
        <h3 ref={heading} tabIndex={-1} className="text-sm font-bold text-gray-900 outline-none">{payoutCorrectionSendBackTitle(detail)}</h3>
        <ul className="mt-1 space-y-1 text-sm text-gray-600">
          {payoutCorrectionSendBackNotes(detail).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>
      {onlyReason ? (
        <p className="text-sm font-semibold text-gray-900" data-testid="reimbursement-payout-correction-reason">{`เหตุผล: ${onlyReason[1]}`}</p>
      ) : (
        <div>
          <div className={labelClass}>เหตุผลที่ส่งกลับ *</div>
          <div role="radiogroup" aria-label="เหตุผลที่ส่งกลับ" aria-required className="grid gap-2 sm:grid-cols-2">
            {reasons.map(([code, label]) => (
              <label key={code} className={cx(choiceClass, reasonCode === code && 'border-brand-300 bg-brand-25')}>
                <input type="radio" name="payout-correction-reason" className="mt-0.5 h-5 w-5 shrink-0" checked={reasonCode === code} disabled={busy}
                  onChange={() => { setReasonCode(code); setError(null); }} />
                <span className="min-w-0">{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className={labelClass} htmlFor="reimbursement-payout-correction-note">หมายเหตุ (ไม่บังคับ)</label>
        <textarea id="reimbursement-payout-correction-note" className={cx(inputClass, 'min-h-20 resize-y')} maxLength={REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH}
          disabled={busy} value={note} onChange={(event) => { setNote(sanitizeReasonInput(event.target.value)); setError(null); }}
          placeholder={payoutRoundTexts(detail).notePlaceholder} />
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
 * The answer to a send-back: how a claim in a round is to be paid back (spec §14.5), from its requester or from a
 * finance reviewer on their behalf. Its title says what is asked, by what the claim holds: "แก้บัญชีรับเงิน",
 * "เพิ่มบัญชีรับเงิน" or "เลือกวิธีรับเงินคืน". The three choices of a draft: the requester's default account as the
 * server shows it now, an account typed for this claim, or cash. And one a draft has no use for: the account
 * the claim was approved with, kept as it is, for a claim that was sent back by mistake. Nothing is chosen for
 * them: the account that was sent back may well be their default. What is saved may be cash, so the button that
 * saves it, and every sentence about what is saved, names the method and never "the account".
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
  // Typing an account for a requester who is no longer an active member is the server's to refuse. The claim detail
  // says so up front (`submitModes`), and the form then never offers the choice; a page read before the requester
  // left learns it from the refusal, after which the choice is not offered again. Either way the form says why.
  const [typing, setTyping] = useState<'offered' | 'refused'>('offered');
  const thirdPartyAllowed = detail.payoutCorrectionActions?.thirdPartyRefusal !== 'APPROVAL_NOT_REQUIRED';
  const [savedAccounts, setSavedAccounts] = useState<SavedPayoutAccountSummary[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [savedReload, setSavedReload] = useState(0);
  const offers = (mode: Exclude<PayoutCorrectionForm['mode'], ''>) => payoutCorrectionOffers(detail, mode);
  const typingOffered = typing === 'offered' && offers('SPECIFIED');
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

  useEffect(() => {
    if (!forSelf || !payoutCorrectionOffers(detail, 'SAVED')) return;
    let active = true;
    setSavedLoading(true); setSavedError(null);
    getMySavedPayoutAccounts(companyId).then(response => { if (active) setSavedAccounts(response.accounts); })
      .catch(e => { if (active) setSavedError(errorText(e)); }).finally(() => { if (active) setSavedLoading(false); });
    return () => { active = false; };
  }, [companyId, forSelf, detail.payoutCorrectionActions?.submitModes, savedReload]);
  const selectedHolder = form.mode === 'SPECIFIED' ? form.holder : form.mode === 'SAVED' ? savedAccounts.find(account => account.id === form.savedAccountId) : form.mode === 'PREVIOUS' ? previousAccount : undefined;

  const change = (patch: Partial<PayoutCorrectionForm>) => { setForm((current) => ({ ...current, ...patch })); setError(null); setInvalidField(undefined); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    const invalid = payoutCorrectionFormError(form);
    // With the claim the form was opened on (`updatedAt`): a press that arrives after an earlier one was taken is refused.
    const input = invalid ? null : payoutCorrectionInput(form, defaultAccount?.token, canSaveAsDefault, detail.updatedAt, forSelf);
    if (!thirdPartyAllowed && selectedHolder?.holderType === 'THIRD_PARTY') { setError(translateApiError('payout_third_party_needs_approval')); return; }
    if (!offers(form.mode as Exclude<PayoutCorrectionForm['mode'], ''>)) { setError(SAVED_WORDS.choose); return; }
    if (invalid || !input) { setError(invalid?.text ?? 'กรุณาเลือกวิธีรับเงินคืนของใบนี้'); setInvalidField(invalid?.field); return; }
    sending.current = true; setBusy(true); setError(null); setInvalidField(undefined);
    try {
      onDone(await submitReimbursementPayoutCorrection(companyId, detail.id, input));
    } catch (e) {
      if (form.mode === 'SAVED' && claimPayoutSavedRefusal({ ...form, mode: 'SAVED' }, e)) { setForm(current => ({ ...current, mode: '', savedAccountId: undefined })); setSavedReload(value => value + 1); setError(SAVED_WORDS.notFound); return; }
      // Not a claim that moved on: the claim is as it was, and what is left to choose from is on the form.
      if (isRequesterNotActiveRefusal(e)) { setTyping('refused'); setForm((current) => ({ ...current, mode: '' })); return; }
      // The account stays as typed: a refusal for one field is fixed and sent again without typing the rest.
      setError(await refusalText(e, () => onConflict(isClaimChangedRefusal(e))));
    } finally { sending.current = false; setBusy(false); }
  };

  const option = (mode: PayoutCorrectionForm['mode'], label: string, hint?: string | null, account?: Parameters<typeof PayoutHolderNotice>[0]['account']) => (
    <label className={cx(choiceClass, form.mode === mode && 'border-brand-300 bg-brand-25')}>
      <input type="radio" name="payout-correction-mode" className="mt-0.5 h-5 w-5 shrink-0" checked={form.mode === mode} disabled={busy}
        onChange={() => change({ mode })} />
      <span className="min-w-0">
        <span className="block font-semibold text-gray-900">{label}</span>
        {hint && <span className="mt-0.5 block break-words text-xs text-gray-500">{hint}</span>}
        <PayoutHolderNotice account={account} />
      </span>
    </label>
  );

  return (
    <form className="space-y-3 [overflow-wrap:anywhere]" onSubmit={submit} noValidate data-testid="reimbursement-payout-correction-account">
      <div>
        <h3 ref={heading} tabIndex={-1} className="text-sm font-bold text-gray-900 outline-none">{payoutCorrectionAnswerWords(detail, forSelf).title}</h3>
        {/* Not "ใหม่": a claim with no account of its own never chose one before. */}
        <p className="mt-1 text-sm text-gray-600">เลือกวิธีรับเงินคืนของใบนี้ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน</p>
      </div>
      <div role="radiogroup" aria-label="รับเงินคืนทาง" aria-required className="space-y-2">
        {defaultAccount && offers('DEFAULT') && option('DEFAULT', forSelf ? 'ใช้บัญชีรับเงินคืนประจำของฉัน' : 'ใช้บัญชีรับเงินคืนประจำของผู้เบิก', payoutAccountWithName(defaultAccount))}
        {forSelf && offers('SAVED') && savedAccounts.filter(account => thirdPartyAllowed || account.holderType !== 'THIRD_PARTY').map((account, index) => <SavedPayoutAccountOption key={account.id} account={account} index={index} name="payout-correction-mode" checked={form.mode === 'SAVED' && form.savedAccountId === account.id} disabled={busy} onChange={() => change({ mode: 'SAVED', savedAccountId: account.id })} />)}
        {forSelf && offers('SAVED') && savedLoading && <LoadingState label={SAVED_WORDS.loading} />}
        {forSelf && offers('SAVED') && savedError && <ErrorState description={savedError} onRetry={() => setSavedReload(value => value + 1)} />}
        {offers('CASH') && option('CASH', PAYOUT_METHOD_TEXT.CASH!)}
        {typingOffered && option('SPECIFIED', 'ระบุบัญชีสำหรับใบนี้', forSelf ? null : REIMBURSEMENT_PAYOUT_TYPING_ON_BEHALF_NOTE)}
        {previousAccount && (thirdPartyAllowed || previousAccount.holderType !== 'THIRD_PARTY') && offers('PREVIOUS') && option('PREVIOUS', PAYOUT_CORRECTION_PREVIOUS_LABEL, `${payoutCorrectionAccountText(previousAccount)} · เลือกเมื่อตรวจแล้วว่าบัญชีนี้ถูกต้อง`, previousAccount)}
      </div>
      {!thirdPartyAllowed && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{translateApiError('payout_third_party_needs_approval')}</p>}
      {thirdPartyAllowed && selectedHolder?.holderType === 'THIRD_PARTY' && <p className="text-sm text-amber-800">{HOLDER_WORDS.thirdPartyApprovalNotice}</p>}
      {/* Known before anyone typed: said as what the form is, not as something that went wrong. */}
      {typing === 'refused' ? <ErrorBanner message={PAYOUT_CORRECTION_TYPING_REFUSED} />
        : payoutCorrectionTypingRefusedUpFront(detail) && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="reimbursement-payout-correction-typing-note">{PAYOUT_CORRECTION_TYPING_REFUSED}</p>
        )}
      {form.mode === 'SPECIFIED' && typingOffered && (
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <PayoutAccountFields value={form.account} onChange={(account) => change({ account })} disabled={busy} invalidField={invalidField} accountNameHint={SAVED_WORDS.accountNameHint} />
          <PayoutHolderFields value={form.holder ?? { holderType: 'SELF' }} forSelf={forSelf} disabled={busy} invalidField={invalidField} allowThirdParty={thirdPartyAllowed}
            onChange={holder => { const next = setClaimPayoutHolder({ ...form, mode: 'SPECIFIED' }, holder); change({ holder: next.holder, saveAsDefault: next.saveAsDefault }); }} />
          {canSaveAsDefault && form.holder?.holderType !== 'THIRD_PARTY' && (
            <label className="flex min-h-11 items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={form.saveAsDefault} disabled={busy}
                onChange={(event) => change(setClaimPayoutSaving({ ...form, mode: 'SPECIFIED' }, 'saveAsDefault', event.target.checked) as PayoutCorrectionForm)} />
              <span>{forSelf ? 'บันทึกเป็นบัญชีประจำของฉัน' : 'บันทึกเป็นบัญชีประจำของผู้เบิก'}</span>
            </label>
          )}
          {forSelf && <label className="flex min-h-11 items-start gap-3 text-sm text-gray-700"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={form.saveForLater === true} disabled={busy} onChange={event => change(setClaimPayoutSaving({ ...form, mode: 'SPECIFIED' }, 'saveForLater', event.target.checked) as PayoutCorrectionForm)} /><span>{SAVED_WORDS.saveForLater}</span></label>}
        </div>
      )}
      {/* True of every choice: what is approved may be the same account, a first one, or cash, and the step that
          approves it keeps only those of the claim's approvers who are still on its route. */}
      <p className="text-xs leading-5 text-gray-500">
        {detail.duplicateReasons?.includes('EXPENSE_CONFIRMED_DUPLICATE')
          ? reimbursementDuplicateBlockNotice(detail.duplicateReasons, false, { status: detail.status })
          : detail.payoutCorrectionPhase === 'AWAITING_APPROVAL'
          ? 'เมื่อบันทึกแล้ว วิธีรับเงินคืนที่ส่งไปก่อนหน้าจะถูกแทนที่ และผู้อนุมัติจะตรวจวิธีรับเงินคืนที่เลือกครั้งนี้แทน'
          : 'เมื่อบันทึกแล้ว ผู้อนุมัติของใบนี้ต้องอนุมัติวิธีรับเงินคืนนี้ก่อนจึงจ่ายได้ ถ้าใบนี้ไม่ต้องอนุมัติตามนโยบาย ใบจะกลับไปรอจ่ายทันที'}
      </p>
      {/* Whoever answers for the requester: the requester is told of it, whatever is chosen. Said only where a notice can
          reach them: a requester who is no longer an active member is told nothing, and the form says that case above. */}
      {!forSelf && typingOffered && (
        <p className="text-xs leading-5 text-gray-500" data-testid="reimbursement-payout-correction-on-behalf-notice">{PAYOUT_CORRECTION_ON_BEHALF_NOTICE}</p>
      )}
      {error && <ErrorBanner message={error} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={cx(ghostClass, 'w-full sm:w-auto')} disabled={busy} onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className={cx(btnClass, 'w-full sm:w-auto')} disabled={busy} aria-busy={busy}>{busy ? 'กำลังบันทึก...' : PAYOUT_CORRECTION_SAVE_LABEL}</button>
      </div>
    </form>
  );
}

/**
 * "สิ่งที่รออนุมัติ: …" (spec §14.6): what a round's approvers approve, named by what was answered. What the claim was
 * approved with beside what it has now (an account by its last 4 digits only), why it was sent back, who answered, and
 * that the lines and the amount are what was approved. Shown to every reader of a claim whose answer waits for approval.
 */
export function PayoutCorrectionComparison({ detail }: { detail: any }) {
  const view = payoutCorrectionComparison(detail);
  if (!view) return null;
  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 [overflow-wrap:anywhere]" data-testid="reimbursement-payout-correction-comparison">
      <h3 className="text-sm font-bold text-gray-900">{view.title}</h3>
      {/* The destination that was kept: once, under the words that it did not change, never two that read alike. */}
      {view.labels.length === 1 ? (
        <dl>
          <div className="min-w-0" data-testid="reimbursement-payout-correction-same-account">
            <dt className="text-xs font-semibold text-gray-600">{view.labels[0]}</dt>
            <dd className="mt-1 break-words text-sm font-semibold text-gray-900">{view.current}<PayoutHolderNotice account={detail.payout} /></dd>
          </div>
        </dl>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-gray-600">{view.labels[0]}</dt>
            <dd className="mt-1 break-words text-sm text-gray-700">{view.previous}<PayoutHolderNotice account={detail.payoutCorrection?.previous} /></dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-gray-600">{view.labels[1]}</dt>
            <dd className="mt-1 break-words text-sm font-semibold text-gray-900">{view.current}<PayoutHolderNotice account={detail.payout} /></dd>
          </div>
        </dl>
      )}
      <p className="text-sm text-gray-700">{view.unchanged}</p>
      <ul className="space-y-1 text-xs text-gray-600">
        <li>{view.sentBack}</li>
        {view.note && <li>หมายเหตุ: {view.note}</li>}
        {view.submitted && <li>{view.submitted}</li>}
      </ul>
    </div>
  );
}
